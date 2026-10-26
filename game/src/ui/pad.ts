/**
 * 手把／鍵盤操作 (issue #15: a player on a Retroid Pocket): the whole game played with a D-pad / sticks and face buttons —
 * Android handhelds (Retroid, AYN Odin, Anbernic …) hand their controls to the web view as a standard gamepad — and the
 * same on a computer with a gamepad or the keyboard (arrows, Enter / Space, Esc, Tab).
 *
 * Nothing here knows the screens. A press is turned into a logical action, and the action works on what is on screen:
 *  - the focus moves between the clickable things of the top-most layer (the open dialog / scene / sheet, otherwise the
 *    toolbar, GO and the map's buttons) to the nearest one in the pressed direction (pad-nav.ts);
 *  - 確定 is a tap at the focused thing's centre (the pointer and mouse events the screens listen to), 返回 the layer's
 *    取消 / 離開 / 關閉 / NO button, or a tap that skips a notice;
 *  - a pick on the map (tool and card targets, missiles) moves a cursor between the glowing choices;
 *  - a screen with only a canvas to tap (the mini games) gets a pointer moved by the stick.
 * Board play: GO has the focus at the start of your turn, ←/→ there change the dice count; the shoulders go along the
 * toolbar, the triggers turn the map, the right stick moves it, X puts it back on the player.
 *
 * Idle until a gamepad or key is used: the focus ring and the button hints show after such an input and hide again at
 * the first touch or mouse press (the game's touch play is untouched). The Android app forwards its controller's back
 * key here (MainActivity: `window.__rich4PadBack`) instead of closing the app.
 */
import { liveViews, type BoardView } from './board-view';
import { nearestTo, pickInDirection, readingOrder, type Dir, type Rect } from './pad-nav';
import { audio } from './audio';
import './pad.css';

type Action = Dir | 'confirm' | 'back' | 'next' | 'prev' | 'lb' | 'rb' | 'lt' | 'rt' | 'x' | 'y' | 'start' | 'select' | 'recentre';
type Source = 'pad' | 'key' | 'native';

// ---------------------------------------------------------------- what can take the focus

/** Native controls and anything marked as a button; the rest is found by `cursor: pointer` (tiles, cells, overlays). */
const BASE = 'button, a[href], input:not([type=hidden]), select, textarea, summary, [role=button], [tabindex]:not([tabindex="-1"])';
/** Layers that hold the input while they show (the first on top wins; the dialog layer over the map before the rest). */
const MODALS = '.pl-scene:not(.out), .fx-overlay, .slots-overlay, .rd-ov, .tc, .icf, .te-cover, .jq-intro, .shop, .ng';

interface Cand { el: HTMLElement; r: Rect; scroller?: HTMLElement }

const vw = () => window.innerWidth || document.documentElement.clientWidth;
const vh = () => window.innerHeight || document.documentElement.clientHeight;
const toRect = (r: DOMRect): Rect => ({ x: r.left, y: r.top, w: r.width, h: r.height });

/** Whether a tap at any of a few points of `r` (kept on screen) lands on `el` (nothing covers it there). */
function reachable(el: Element, r: Rect): boolean {
  const W = vw(), H = vh();
  for (const [fx, fy] of [[0.5, 0.5], [0.3, 0.3], [0.7, 0.3], [0.3, 0.7], [0.7, 0.7]]) {
    const x = Math.min(W - 1, Math.max(0, r.x + r.w * fx)), y = Math.min(H - 1, Math.max(0, r.y + r.h * fy));
    if (x < r.x || x > r.x + r.w || y < r.y || y > r.y + r.h) continue;
    const hit = document.elementFromPoint(x, y);
    if (hit && (hit === el || el.contains(hit))) return true;
  }
  return false;
}

/** The nearest scrolling box around `el` (a list longer than its window: save slots, long menus). */
function scrollerOf(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    if (p.scrollHeight <= p.clientHeight + 2 && p.scrollWidth <= p.clientWidth + 2) continue;
    const s = getComputedStyle(p);
    if (/(auto|scroll)/.test(s.overflowY + s.overflowX)) return p;
  }
  return null;
}

function disabled(el: HTMLElement): boolean {
  return (el as HTMLButtonElement).disabled === true || el.getAttribute('aria-disabled') === 'true' || !!el.closest('[inert], [hidden]');
}

/**
 * Everything on screen a tap can reach, in document order: the native controls, plus every element where
 * `cursor: pointer` starts (its children inherit it). Containers of other choices and screen-sized tap surfaces (a
 * notice's "tap anywhere") are left out of the focus; the surfaces are kept for 確定 without a focus.
 */
function collect(): { cands: Cand[]; surfaces: HTMLElement[] } {
  const W = vw(), H = vh();
  const found: HTMLElement[] = [];
  const pointer = new Map<Element, boolean>();
  const isPointer = (e: Element | null): boolean => {
    if (!e || e === document.body || e === document.documentElement) return false;
    let v = pointer.get(e);
    if (v === undefined) { v = getComputedStyle(e).cursor === 'pointer'; pointer.set(e, v); }
    return v;
  };
  for (const e of document.body.querySelectorAll<HTMLElement>('*')) {
    if (e.matches(BASE)) { found.push(e); continue; }
    if (e instanceof SVGElement || e.tagName === 'IMG' || e.tagName === 'CANVAS' && e.classList.contains('board')) continue;
    if (isPointer(e) && !isPointer(e.parentElement)) found.push(e);
  }
  const cands: Cand[] = [], surfaces: HTMLElement[] = [];
  for (const el of found) {
    if (el.closest('.pad-ring, .pad-hint') || disabled(el)) continue;
    const b = el.getBoundingClientRect();
    if (b.width < 3 || b.height < 3) continue;
    const r = toRect(b);
    const onScreen = r.x + r.w > 0 && r.y + r.h > 0 && r.x < W && r.y < H;
    if (onScreen && reachable(el, r)) {
      if (r.w * r.h > W * H * 0.4 && el.tagName !== 'BUTTON') surfaces.push(el);
      else cands.push({ el, r });
      continue;
    }
    // Outside its list's window: reachable by scrolling the list (when the list itself shows).
    const sc = scrollerOf(el);
    if (sc && getComputedStyle(el).visibility !== 'hidden') {
      const s = sc.getBoundingClientRect();
      if (s.width > 4 && s.height > 4 && reachable(sc, toRect(s))) cands.push({ el, r, scroller: sc });
    }
  }
  // Containers of other choices are not choices themselves (a card whose buttons are inside it).
  const inner = new Set<Element>();
  const set = new Set(cands.map(c => c.el));
  for (const c of cands) for (let p = c.el.parentElement; p; p = p.parentElement) if (set.has(p)) inner.add(p);
  return { cands: cands.filter(c => !inner.has(c.el)), surfaces };
}

/** Whether `el` is what shows at some of its points (not covered by something on top). */
function onTop(el: Element): boolean {
  const b = el.getBoundingClientRect();
  return b.width > 2 && b.height > 2 && reachable(el, toRect(b));
}

/** The layer that holds the input now (a dialog, a scene, an overlay), or null for the game screen / page itself. */
function modalRoot(): HTMLElement | null {
  for (const l of document.querySelectorAll<HTMLElement>('.ui-layer.show')) {
    const n = l.firstElementChild as HTMLElement | null;
    if (n && onTop(n)) return n;
  }
  const list = [...document.querySelectorAll<HTMLElement>(MODALS)].reverse();
  // (`.tc` is also the calendar's class in the side column: only the tool cinema's counts)
  for (const m of list) if (!m.closest('.side') && !m.parentElement?.closest(MODALS) && onTop(m)) return m;
  return null;
}

/** The board view in front (its canvas reachable), the main one otherwise. */
function topView(): BoardView | null {
  let last: BoardView | null = null;
  for (const v of liveViews) {
    if (!v.canvas.isConnected) continue;
    last = v;
    if (v.padPicking && onTop(v.canvas)) return v;
  }
  for (const v of liveViews) if (v.canvas.isConnected && onTop(v.canvas)) return v;
  return last;
}

// ---------------------------------------------------------------- the state

let shown = false;              // focus ring and hints on (after a pad / key input)
let source: Source = 'pad';
let focus: HTMLElement | null = null;
let focusRect: Rect | null = null;
let spot: number | null = null;  // map pick: the chosen spot's index
let cursor: { x: number; y: number; on: HTMLElement } | null = null; // pointer over a canvas
let lastRoot: Element | null | undefined, lastKey = '';
let goShown = false, wantGo = false;
/** The focus was moved there by the player (a direction, the shoulders), not put there by a screen opening. */
let chosen = false;
/** Last focus per screen (key: the layer's class and title) as a signature. */
const memory = new Map<string, string>();

/** A choice's identity across a re-drawn screen: its data attributes, else its class, and its text. */
function signature(el: HTMLElement): string {
  const data = Object.entries(el.dataset).map(([k, v]) => `${k}=${v}`).join('&');
  const text = (el.getAttribute('aria-label') ?? el.title ?? '') + (el.textContent ?? '').trim().slice(0, 24);
  const cls = [...el.classList].filter(c => !/^(on|mine|taken|down|sel|selected|active|hover|lit|cur|now|pressed|picked|chosen)$/.test(c)).join('.');
  return `${el.tagName}|${data || cls}|${text}`;
}

function rootKey(root: Element | null): string {
  if (!root) return document.querySelector('.game') ? 'board' : `page:${document.querySelector('#app > *')?.className ?? ''}`;
  const title = root.querySelector('.ribbon')?.textContent?.trim() ?? '';
  return `${root.className}|${title}`;
}

/** The first choice of a layer: GO, a YES / start button, else the first in reading order. */
function defaultFocus(cands: Cand[], root: HTMLElement | null): HTMLElement | null {
  if (!cands.length) return null;
  const pref = ['[data-pad-default]', '.go-hit', '.candy.yes', '[data-go]', '.title-btn'];
  for (const sel of pref) {
    const c = cands.find(k => k.el.matches(sel) && !k.scroller);
    if (c && (!root || root.contains(c.el))) return c.el;
  }
  const visible = cands.filter(c => !c.scroller);
  const list = visible.length ? visible : cands;
  return list[readingOrder(list.map(c => c.r))[0]].el;
}

interface Ctx {
  root: HTMLElement | null;
  cands: Cand[];          // in the layer
  all: Cand[];            // everything reachable (the toolbar beside a map dialog)
  surfaces: HTMLElement[];
  view: BoardView | null;
  picking: boolean;
  canvas: HTMLCanvasElement | null; // a canvas to point at (mini games)
  /** A scene whose one button is 跳過 (the month report …): not focused; 確定 taps the scene on, 返回 skips. */
  skip: HTMLElement | null;
}

function context(): Ctx {
  const { cands: all, surfaces } = collect();
  const root = modalRoot();
  let cands = root ? all.filter(c => root.contains(c.el)) : all;
  const view = topView();
  const picking = !!view?.padPicking && (!root || root.contains(view.canvas)) && !document.querySelector('.ui-layer.show > .msg.ask');
  let canvas: HTMLCanvasElement | null = null;
  const scope = root ?? document.body;
  for (const c of scope.querySelectorAll<HTMLCanvasElement>('canvas.mn-canvas')) if (onTop(c)) canvas = c;
  let skip: HTMLElement | null = null;
  if (root?.matches('.pl-scene, .fx-overlay') && cands.length === 1 && BACK_TEXT.test(words(cands[0].el))) { skip = cands[0].el; cands = []; }
  return { root, cands, all, surfaces: root ? surfaces.filter(s => root.contains(s) || s.contains(root)) : surfaces, view, picking, canvas, skip };
}

// ---------------------------------------------------------------- taps

const PID = 1;

function fire(target: Element, type: string, x: number, y: number, buttons: number, pointerType = 'mouse') {
  const init: PointerEventInit = {
    bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, screenX: x, screenY: y, button: 0, buttons,
    pointerId: PID, pointerType, isPrimary: true, width: 1, height: 1, pressure: buttons ? 0.5 : 0, view: window,
  };
  target.dispatchEvent(type.startsWith('pointer') ? new PointerEvent(type, init) : new MouseEvent(type, init));
}

/** Runs `fn` with pointer capture that cannot throw (a synthetic pointer is not an active one). */
function safeCapture(fn: () => void) {
  const P = Element.prototype, set = P.setPointerCapture, rel = P.releasePointerCapture;
  P.setPointerCapture = function (id: number) { try { set.call(this, id); } catch { /* not a live pointer */ } };
  P.releasePointerCapture = function (id: number) { try { rel.call(this, id); } catch { /* not a live pointer */ } };
  try { fn(); } finally { P.setPointerCapture = set; P.releasePointerCapture = rel; }
}

/** A press held down (確定 while the button / key is held: hold-to-fire buttons, pressed looks), let go by `release`. */
let pressing: { down: Element; x: number; y: number; el?: HTMLElement; kind: string; timer: number } | null = null;

/**
 * Presses at (x, y) as the mouse does — on what is there (inside `el` when given) — and keeps it pressed until
 * `release` (the button or key let go). `touch`: as a finger (the canvas pointer of the mini games: as rough as a
 * fingertip, so it gets the games' finger tolerance).
 */
function pressAt(x: number, y: number, el?: HTMLElement, touch = false) {
  release();
  const h = document.elementFromPoint(x, y);
  const down = h && (!el || el === h || el.contains(h)) ? h : el ?? h;
  if (!down) return;
  const kind = touch ? 'touch' : 'mouse';
  safeCapture(() => {
    fire(down, 'pointerover', x, y, 0, kind);
    fire(down, 'pointerdown', x, y, 1, kind);
    fire(down, 'mousedown', x, y, 1);
  });
  // a pad that goes away mid-press (or a lost key-up) lets go after a while
  pressing = { down, x, y, el, kind, timer: window.setTimeout(release, 4000) };
}

/** Lets the held press go: up and click where it is, as a finger lifting there. */
function release() {
  const p = pressing;
  if (!p) return;
  pressing = null;
  clearTimeout(p.timer);
  const { down, x, y, el, kind } = p;
  safeCapture(() => {
    down.releasePointerCapture(PID); // (a desktop's real mouse is pointer 1 too: never leave it captured)
    const h = document.elementFromPoint(x, y);
    const up = (h && (!el || el === h || el.contains(h)) ? h : null) ?? (down.isConnected ? down : el ?? h);
    if (!up) return;
    fire(up, 'pointerup', x, y, 0, kind);
    fire(up, 'mouseup', x, y, 0);
    let c: Element | null = up;
    if (down.isConnected) while (c && !c.contains(down)) c = c.parentElement;
    fire(c && c.isConnected ? c : up, 'click', x, y, 0);
  });
}

/** A whole tap at (x, y): pressed and let go at once. */
function tapAt(x: number, y: number, el?: HTMLElement, touch = false) {
  pressAt(x, y, el, touch);
  release();
}

function centre(r: Rect) { return { x: r.x + r.w / 2, y: r.y + r.h / 2 }; }

/** Scrolls `el`'s list so it shows (only that list, never the page). */
function reveal(el: HTMLElement) {
  const sc = scrollerOf(el);
  if (!sc) return;
  const s = sc.getBoundingClientRect(), r = el.getBoundingClientRect();
  if (r.top < s.top) sc.scrollTop -= s.top - r.top + 6;
  else if (r.bottom > s.bottom) sc.scrollTop += r.bottom - s.bottom + 6;
  if (r.left < s.left) sc.scrollLeft -= s.left - r.left + 6;
  else if (r.right > s.right) sc.scrollLeft += r.right - s.right + 6;
}

/**
 * 確定 on an element: a tap (`hold`: pressed until the button / key is let go), or the native control's own change.
 */
function activate(el: HTMLElement, hold = false) {
  reveal(el);
  if (el instanceof HTMLSelectElement) { step(el, 1); return; }
  if (el instanceof HTMLInputElement && /^(text|number|search|tel|email|password|)$/.test(el.type) || el instanceof HTMLTextAreaElement) { el.focus(); return; }
  if (el instanceof HTMLInputElement && el.type === 'range') return;
  const r = el.getBoundingClientRect(), c = centre(toRect(r));
  pressAt(c.x, c.y, el);
  if (!hold) release();
}

/**
 * A drawn drag bar (the bank's amount bars: wide, `touch-action: none`): ←/→ tap it 10 % either side of its fill (an
 * inner box sized in %), as a finger dragging it would.
 */
function stepBar(el: HTMLElement, d: number): boolean {
  const r = el.getBoundingClientRect();
  if (el.tagName === 'BUTTON' || r.width < r.height * 2.5 || getComputedStyle(el).touchAction !== 'none') return false;
  const fill = [...el.querySelectorAll<HTMLElement>('[style*="width"]')].find(e => e.style.width.endsWith('%'));
  const now = fill ? parseFloat(fill.style.width) / 100 : 0.5;
  const f = Math.max(0, Math.min(1, now + d * 0.1));
  tapAt(r.left + Math.max(1, Math.min(r.width - 1, r.width * f)), r.top + r.height / 2, el);
  return true;
}

/** ←/→ on a value control: the next option, the next step of a slider or number. */
function step(el: HTMLElement, d: number): boolean {
  if (stepBar(el, d)) return true;
  const changed = () => { el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
  if (el instanceof HTMLSelectElement) {
    const n = el.options.length;
    if (n) { el.selectedIndex = (el.selectedIndex + d + n) % n; changed(); }
    return true;
  }
  if (el instanceof HTMLInputElement && (el.type === 'range' || el.type === 'number')) {
    if (d > 0) el.stepUp(); else el.stepDown();
    changed();
    return true;
  }
  return false;
}

// ---------------------------------------------------------------- focus

function setFocus(el: HTMLElement | null, ctx?: Ctx) {
  focus = el;
  if (el) {
    reveal(el);
    focusRect = toRect(el.getBoundingClientRect());
    memory.set(rootKey(ctx ? ctx.root : modalRoot()), signature(el));
  }
  draw();
}

/** The focus still valid in this context, or its stand-in: the same choice re-drawn, the one nearest it, the layer's first. */
function ensureFocus(ctx: Ctx): HTMLElement | null {
  const key = rootKey(ctx.root);
  // a new layer, or another page in the same one (its title changed): not a re-drawn screen
  const rootChanged = ctx.root !== lastRoot || key !== lastKey;
  lastRoot = ctx.root; lastKey = key;
  // GO comes up (your turn): it takes the focus as soon as nothing covers it (an intro, a notice).
  const goEl = document.querySelector<HTMLElement>('.go');
  const goUp = !!goEl && !goEl.hidden;
  if (goUp && !goShown) wantGo = true;
  goShown = goUp;
  if (!goUp) wantGo = false;
  const go = wantGo && !ctx.root ? ctx.cands.find(c => c.el.classList.contains('go-hit')) : undefined;
  if (go) { wantGo = false; return go.el; }
  // The game screen while nobody asks you anything (the computers' turns, things playing on the map): no focus
  // unless you went to the toolbar yourself, so 確定 skips what plays instead of opening a menu.
  if (!ctx.root && !goUp && document.querySelector('.game') && (rootChanged || !chosen)) { chosen = false; return null; }
  if (rootChanged || goUp) chosen = false;
  if (focus && !rootChanged && ctx.cands.some(c => c.el === focus)) return focus;
  // Remembered for this screen (not for yes / no questions: they start on YES).
  const sig = ctx.root?.querySelector('.choices.yesno') ? undefined : memory.get(key);
  if (sig) { const c = ctx.cands.find(k => signature(k.el) === sig); if (c) return c.el; }
  if (focus && !rootChanged && focusRect) {
    if (focus.isConnected) { const c = ctx.cands.find(k => signature(k.el) === signature(focus!)); if (c) return c.el; }
    const i = nearestTo(focusRect, ctx.cands.map(c => c.r), 160);
    if (i >= 0) return ctx.cands[i].el;
  }
  return defaultFocus(ctx.cands, ctx.root);
}

// ---------------------------------------------------------------- actions

// (both scripts: 简体 converts the page's words, lang.ts)
const BACK_TEXT = /^(取消|離開|离开|關閉|关闭|返回|跳過|跳过|放棄|放弃|不要|不買|不买|算了|結束|结束|回上頁|回上页|稍後|稍后|NO\b|否$|EXIT$|×|✕|✖)/i;

const words = (e: HTMLElement) => `${e.getAttribute('aria-label') ?? ''}${e.title ?? ''}${(e.textContent ?? '').trim()}`.trim();

/** The layer's way out: a close / cancel button (by mark, then by its words, then by its look). */
function backButton(ctx: Ctx): HTMLElement | null {
  if (ctx.skip) return ctx.skip;
  const list = ctx.cands.map(c => c.el);
  const by = (f: (e: HTMLElement) => boolean) => list.find(f) ?? null;
  return by(e => e.matches('[data-close], [data-back], [data-pad-back]') || Object.values(e.dataset).some(v => /^(exit|esc|back|close|cancel|leave|quit)$/i.test(v ?? '')))
    ?? by(e => BACK_TEXT.test(words(e)) || BACK_TEXT.test((e.title ?? '').trim()) || BACK_TEXT.test((e.getAttribute('aria-label') ?? '').trim()))
    ?? by(e => e.matches('.candy.ghost'))
    ?? by(e => e.matches('.candy.no'));
}

/** 確定 with nothing to focus: the notice / scene / overlay is tapped (skips it), or the map's caption is skipped. */
function tapThrough(ctx: Ctx): boolean {
  const target = ctx.root ?? ctx.surfaces[ctx.surfaces.length - 1];
  if (target) {
    const r = target.getBoundingClientRect(), c = centre(toRect(r));
    tapAt(c.x, c.y, target);
    return true;
  }
  return !!ctx.view?.padSkip();
}

function toolbarButton(key: string): HTMLElement | null {
  const b = document.querySelector<HTMLElement>(`.toolbar .tb[data-key="${key}"]`);
  return b && onTop(b) ? b : null;
}

/** GO's dice count one up / down (the lit dice slots). */
function stepDice(d: number): boolean {
  const go = document.querySelector<HTMLElement>('.go:not([hidden])');
  if (!go) return false;
  const slots = [...go.querySelectorAll<HTMLElement>('.go-slots [data-n]')];
  if (slots.length < 2) return true;
  const now = go.querySelectorAll('.go-slots [data-on]').length;
  if (!now) return true; // stopped this turn
  const n = Math.max(1, Math.min(slots.length, now + d));
  if (n === now) return true;
  const s = slots[n - 1], r = s.getBoundingClientRect(), c = centre(toRect(r));
  tapAt(c.x, c.y, s);
  return true;
}

function moveSpot(ctx: Ctx, dir: Dir | null) {
  const spots = ctx.view!.padSpots() ?? [];
  if (!spots.length) { spot = null; return; }
  const rects = spots.map(s => ({ x: s.x - s.r, y: s.y - s.r * 0.6, w: s.r * 2, h: s.r * 1.2 }));
  let k = spots.findIndex(s => s.i === spot);
  if (k < 0) {
    // start at the player (the choices nearest them), else nearest the middle of the map
    const c = ctx.view!.canvas.getBoundingClientRect(), me = ctx.view!.screenOf(ctx.view!.current);
    const at = me ? { x: c.left + me.x, y: c.top + me.y } : { x: c.left + c.width / 2, y: c.top + c.height / 2 };
    k = nearestTo({ x: at.x - 1, y: at.y - 1, w: 2, h: 2 }, rects);
  } else if (dir) {
    const j = pickInDirection(rects[k], dir, rects, k);
    if (j >= 0) { k = j; audio.ui('hover'); }
  }
  spot = spots[k].i;
  ctx.view!.padReveal(spot);
}

function act(a: Action, src: Source) {
  if (!dedupe(a, src)) return;
  source = src;
  const wasShown = shown;
  show();
  const ctx = context();

  // A pick on the map: the cursor goes between the glowing choices.
  if (ctx.picking && ctx.view) {
    if (a === 'up' || a === 'down' || a === 'left' || a === 'right') { moveSpot(ctx, spot === null ? null : a); draw(); return; }
    if (a === 'confirm') {
      if (spot === null) { moveSpot(ctx, null); draw(); return; }
      ctx.view.padPick(spot); spot = null; draw(); return;
    }
    if (a === 'back') {
      const b = (ctx.root ? backButton(ctx) : null) ?? document.querySelector<HTMLElement>('.pick-hint button');
      if (b) activate(b);
      spot = null; draw(); return;
    }
  } else spot = null;

  // A canvas to point at (the mini games): the stick moves a pointer, 確定 taps there.
  if (ctx.canvas && !ctx.cands.length) {
    const r = ctx.canvas.getBoundingClientRect();
    if (!cursor || cursor.on !== ctx.canvas) cursor = { x: r.left + r.width / 2, y: r.top + r.height / 2, on: ctx.canvas };
    if (a === 'confirm') { pressAt(cursor.x, cursor.y, ctx.canvas, true); if (src === 'native') release(); return; }
    if (a === 'up' || a === 'down' || a === 'left' || a === 'right') {
      const d = Math.max(12, r.width / 24);
      moveCursor(a === 'left' ? -d : a === 'right' ? d : 0, a === 'up' ? -d : a === 'down' ? d : 0);
      return;
    }
    if (a === 'back') { const b = backButton(ctx); if (b) activate(b); return; }
    return;
  }
  cursor = null;

  const f = ensureFocus(ctx);
  if (f !== focus) setFocus(f, ctx);
  else draw();
  const dirs: Dir[] = ['up', 'down', 'left', 'right'];
  if ((dirs as string[]).includes(a)) {
    const dir = a as Dir;
    // The first press after touch play only shows where the focus is.
    if (!wasShown) return;
    if (!focus) { const d = defaultFocus(ctx.cands, ctx.root); if (d) { setFocus(d, ctx); chosen = true; audio.ui('hover'); } return; }
    if ((dir === 'left' || dir === 'right') && focus.closest('.go') && stepDice(dir === 'left' ? -1 : 1)) return;
    if ((dir === 'left' || dir === 'right') && step(focus, dir === 'left' ? -1 : 1)) return;
    const from = toRect(focus.getBoundingClientRect());
    const list = ctx.cands;
    const j = pickInDirection(from, dir, list.map(c => c.r), list.findIndex(c => c.el === focus));
    if (j >= 0) { setFocus(list[j].el, ctx); chosen = true; audio.ui('hover'); }
    return;
  }
  switch (a) {
    case 'confirm':
      if (focus) activate(focus, src !== 'native');
      else tapThrough(ctx);
      return;
    case 'back': {
      const b = backButton(ctx);
      if (b) { activate(b); return; }
      if (ctx.root && !ctx.cands.length) { tapThrough(ctx); return; }
      if (!ctx.root) ctx.view?.padSkip();
      return;
    }
    case 'next': case 'prev': {
      const list = ctx.cands;
      if (!list.length) return;
      const i = list.findIndex(c => c.el === focus);
      const j = i < 0 ? 0 : (i + (a === 'next' ? 1 : -1) + list.length) % list.length;
      setFocus(list[j].el, ctx);
      chosen = true; audio.ui('hover');
      return;
    }
    case 'lb': case 'rb': {
      // Along the toolbar (and GO) on the game screen; through the layer's choices in a dialog.
      const bar = !ctx.root ? [...document.querySelectorAll<HTMLElement>('.toolbar .tb, .go:not([hidden]) .go-hit')].filter(e => ctx.cands.some(c => c.el === e)) : [];
      const list = bar.length ? bar : ctx.cands.map(c => c.el);
      if (!list.length) return;
      const i = focus ? list.indexOf(focus) : -1;
      const j = i < 0 ? (a === 'rb' ? 0 : list.length - 1) : (i + (a === 'rb' ? 1 : -1) + list.length) % list.length;
      setFocus(list[j], ctx);
      chosen = true; audio.ui('hover');
      return;
    }
    case 'lt': ctx.view?.rotate(-1); return;
    case 'rt': ctx.view?.rotate(1); return;
    case 'x': case 'recentre': ctx.view?.padRecentre(); return;
    case 'y': { if (ctx.root) return; const b = toolbarButton('map'); if (b) activate(b); return; }
    case 'select': { if (ctx.root) return; const b = toolbarButton('info'); if (b) activate(b); return; }
    case 'start': {
      // In a layer: its main button (施法！, 開始遊戲, 買 13 號 …); a settings sheet without one closes.
      if (ctx.root) {
        const main = ctx.cands.find(c => c.el.matches('.candy.yes, [data-go], [data-pad-default]'))?.el;
        const b = main ?? (ctx.root.matches('.sys-sheet, .sheet') ? backButton(ctx) : null);
        if (b) { setFocus(b, ctx); activate(b); }
        return;
      }
      const b = toolbarButton('system');
      if (b) activate(b);
      return;
    }
  }
}

function moveCursor(dx: number, dy: number) {
  if (!cursor) return;
  const r = cursor.on.getBoundingClientRect();
  cursor.x = Math.max(r.left + 1, Math.min(r.right - 1, cursor.x + dx));
  cursor.y = Math.max(r.top + 1, Math.min(r.bottom - 1, cursor.y + dy));
  safeCapture(() => fire(document.elementFromPoint(cursor!.x, cursor!.y) ?? cursor!.on, 'pointermove', cursor!.x, cursor!.y, 0));
  draw();
}

/** A second press of the same action from another source right after (the handheld sends a key and a pad button). */
const lastPress = new Map<Action, { t: number; src: Source }>();
function dedupe(a: Action, src: Source): boolean {
  const now = performance.now(), l = lastPress.get(a);
  if (l && l.src !== src && now - l.t < 200) return false;
  lastPress.set(a, { t: now, src });
  return true;
}

// ---------------------------------------------------------------- drawing

let ring: HTMLElement | null = null;
let hint: HTMLElement | null = null;
let hintTimer = 0;

function show() {
  if (!ring) {
    ring = document.createElement('div'); ring.className = 'pad-ring'; ring.hidden = true;
    hint = document.createElement('div'); hint.className = 'pad-hint'; hint.hidden = true;
    document.body.append(ring, hint);
  }
  if (!shown) document.documentElement.classList.add('pad-on');
  shown = true;
  hint!.classList.remove('idle');
  clearTimeout(hintTimer);
  hintTimer = window.setTimeout(() => hint?.classList.add('idle'), 5000);
  wake();
}

function hide() {
  if (!shown) return;
  shown = false;
  document.documentElement.classList.remove('pad-on');
  if (ring) ring.hidden = true;
  if (hint) hint.hidden = true;
}

const PAD_NAMES = { a: 'A', b: 'B', x: 'X', y: 'Y', lb: 'LB', rb: 'RB', lt: 'LT', rt: 'RT', start: 'START', rs: '右搖桿' };
const KEY_NAMES = { a: 'Enter', b: 'Esc', x: 'C', y: 'M', lb: 'PgUp', rb: 'PgDn', lt: 'Q', rt: 'E', start: 'F10', rs: 'Shift+方向' };

function hintText(): string {
  const n = source === 'key' ? KEY_NAMES : PAD_NAMES;
  const k = (s: string) => `<kbd>${s}</kbd>`;
  if (spot !== null) return `${k('方向')}選目標 ${k(n.a)}確定 ${k(n.b)}取消${source === 'pad' ? ` ${k(n.rs)}看地圖` : ''}`;
  if (cursor) return `${k('方向')}移動 ${k(n.a)}點擊`;
  if (!focus) return `${k(n.a)}繼續 ${k(n.b)}跳過`;
  if (focus?.closest('.go')) return `${k('←→')}骰子數 ${k(n.a)}出發 ${k(n.lb)}${k(n.rb)}工具列 ${k(n.lt)}${k(n.rt)}旋轉 ${k(n.rs)}看地圖 ${k(n.x)}回到角色`;
  if (focus?.closest('.toolbar')) return `${k(n.a)}開啟 ${k(n.lb)}${k(n.rb)}工具列 ${k(n.start)}系統`;
  return `${k(n.a)}確定 ${k(n.b)}返回`;
}

function draw() {
  if (!ring || !hint) return;
  if (!shown) { ring.hidden = true; hint.hidden = true; return; }
  let r: Rect | null = null, round = '12px', kind = '';
  if (spot !== null) {
    const v = topView(), s = v?.padSpots()?.find(q => q.i === spot);
    if (s) { r = { x: s.x - s.r - 6, y: s.y - s.r * 0.7 - 6, w: s.r * 2 + 12, h: s.r * 1.4 + 12 }; round = '50%'; kind = 'spot'; }
  } else if (cursor) {
    r = { x: cursor.x - 14, y: cursor.y - 14, w: 28, h: 28 }; round = '50%'; kind = 'cursor';
  } else if (focus && focus.isConnected) {
    // GO: the ring goes round the whole button with its dice tube
    const b = (focus.matches('.go-hit') ? focus.closest('.go') ?? focus : focus).getBoundingClientRect();
    if (b.width > 0) {
      r = { x: b.left - 4, y: b.top - 4, w: b.width + 8, h: b.height + 8 };
      const br = parseFloat(getComputedStyle(focus).borderTopLeftRadius) || 0;
      round = !focus.matches('.go-hit') && getComputedStyle(focus).borderTopLeftRadius.endsWith('%') ? '50%' : `${Math.min(br + 4, Math.min(r.w, r.h) / 2)}px`;
    }
  }
  if (r) {
    // kept on screen (the toolbar along the top edge)
    const W = vw(), H = vh(), x0 = Math.max(1, r.x), y0 = Math.max(1, r.y);
    r = { x: x0, y: y0, w: Math.max(8, Math.min(W - 1, r.x + r.w) - x0), h: Math.max(8, Math.min(H - 1, r.y + r.h) - y0) };
    ring.hidden = false;
    ring.dataset.kind = kind;
    Object.assign(ring.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px`, borderRadius: round });
  } else ring.hidden = true;
  const t = hintText();
  if (hint.dataset.t !== t) { hint.dataset.t = t; hint.innerHTML = t; }
  hint.hidden = false;
}

// ---------------------------------------------------------------- gamepads

const REPEAT_FIRST = 360, REPEAT_EVERY = 110;
/** Standard mapping: buttons by index. */
const BUTTONS: [number, Action][] = [[0, 'confirm'], [1, 'back'], [2, 'x'], [3, 'y'], [4, 'lb'], [5, 'rb'], [6, 'lt'], [7, 'rt'], [8, 'select'], [9, 'start'], [10, 'recentre'], [11, 'recentre'], [12, 'up'], [13, 'down'], [14, 'left'], [15, 'right']];
const held = new Map<Action, number>();  // action → next repeat time
let lastBack = 0;
let raf = 0, lastT = 0, lastCheck = 0, padsSeen = false;

function pads(): Gamepad[] {
  try { return [...(navigator.getGamepads?.() ?? [])].filter((g): g is Gamepad => !!g && g.connected); } catch { return []; }
}

function poll(t: number) {
  const list = pads();
  const dt = Math.min(0.05, Math.max(0, (t - lastT) / 1000));
  lastT = t;
  if (!list.length) { held.clear(); release(); return; }
  padsSeen = true;
  const now = new Set<Action>();
  let rx = 0, ry = 0, lx = 0, ly = 0;
  for (const g of list) {
    for (const [i, a] of BUTTONS) {
      const b = g.buttons[i];
      if (b && (b.pressed || b.value > 0.5)) now.add(a);
    }
    const ax = g.axes;
    if (Math.abs(ax[0] ?? 0) > Math.abs(lx)) lx = ax[0];
    if (Math.abs(ax[1] ?? 0) > Math.abs(ly)) ly = ax[1];
    if (Math.abs(ax[2] ?? 0) > Math.abs(rx)) rx = ax[2];
    if (Math.abs(ax[3] ?? 0) > Math.abs(ry)) ry = ax[3];
  }
  // The left stick as the D-pad (on its main axis); in a canvas pointer it moves the pointer smoothly instead.
  const mag = Math.hypot(lx, ly);
  if (cursor && shown && mag > 0.2) {
    const sp = 700 * dt * Math.min(1, (mag - 0.2) / 0.8);
    moveCursor(lx / mag * sp * mag, ly / mag * sp * mag);
  } else if (mag > 0.55) {
    if (Math.abs(lx) > Math.abs(ly)) now.add(lx > 0 ? 'right' : 'left'); else now.add(ly > 0 ? 'down' : 'up');
  }
  for (const a of now) {
    const next = held.get(a);
    const dir = a === 'up' || a === 'down' || a === 'left' || a === 'right';
    if (next === undefined) {
      held.set(a, dir ? t + REPEAT_FIRST : Infinity);
      if (a === 'back') lastBack = t;
      act(a, 'pad');
    } else if (dir && t >= next) {
      held.set(a, t + REPEAT_EVERY);
      act(a, 'pad');
    }
  }
  for (const a of [...held.keys()]) if (!now.has(a)) { held.delete(a); if (a === 'confirm') release(); }
  // The right stick looks round the map (or moves the canvas pointer).
  const rm = Math.hypot(rx, ry);
  if (rm > 0.2) {
    const k = Math.min(1, (rm - 0.2) / 0.8), sp = 900 * dt * k * k;
    if (cursor && shown) moveCursor(rx / rm * sp, ry / rm * sp);
    else if (topView()?.padPan(rx / rm * sp, ry / rm * sp)) { if (!shown) show(); }
  }
}

function loop(t: number) {
  raf = 0;
  if (document.visibilityState === 'hidden') return;
  poll(t);
  if (shown) {
    // The focus follows the screen: a dialog opening / closing, GO coming up, a list re-drawn.
    if (t - lastCheck > 150) {
      lastCheck = t;
      const ctx = context();
      if (ctx.picking && ctx.view) { if (spot === null || !ctx.view.padSpots()?.some(s => s.i === spot)) moveSpot(ctx, null); }
      else {
        spot = null;
        if (ctx.canvas && !ctx.cands.length) {
          if (!cursor || cursor.on !== ctx.canvas) { const r = ctx.canvas.getBoundingClientRect(); cursor = { x: r.left + r.width / 2, y: r.top + r.height / 2, on: ctx.canvas }; }
        } else {
          cursor = null;
          const f = ensureFocus(ctx);
          if (f !== focus) setFocus(f, ctx);
        }
      }
    }
    draw();
  }
  if (shown || padsSeen || pads().length) raf = requestAnimationFrame(loop);
}

function wake() { if (!raf) raf = requestAnimationFrame(loop); }

// ---------------------------------------------------------------- keyboard

const KEYS: Record<string, Action> = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  Enter: 'confirm', ' ': 'confirm', Escape: 'back', Backspace: 'back',
  Tab: 'next', PageUp: 'lb', PageDown: 'rb', Home: 'recentre', c: 'recentre', C: 'recentre', m: 'y', M: 'y', i: 'select', I: 'select', F10: 'start',
};

/** Screens that answer some keys themselves (the bank's keypad, the shop's Esc, the wheel / slot machine's any key). */
function ownsKey(key: string): boolean {
  if (document.querySelector('.bk-atm-ov, .bk-counter-ov') && (key === 'Enter' || key === 'Escape' || key === 'Backspace' || key === 'c' || key === 'C' || key === 'm' || key === 'M')) return true;
  if (document.querySelector('.shop') && key === 'Escape') return true;
  const sm = document.querySelector('.wh-scene:not(.out), .sm-scene:not(.out)');
  if (sm && onTop(sm) && (key === 'Enter' || key === ' ')) return true;
  // the mini games' ← / → (喜從天降)
  if (document.querySelector('canvas.mn-canvas') && (key === 'ArrowLeft' || key === 'ArrowRight')) return true;
  return false;
}

function onKey(e: KeyboardEvent) {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target as HTMLElement | null;
  const typing = !!t?.closest?.('input:not([type=range]):not([type=checkbox]):not([type=radio]), textarea, select, [contenteditable=""], [contenteditable="true"]');
  if (typing) {
    if (e.key === 'Escape' || e.key === 'Tab') { (t as HTMLElement).blur(); e.preventDefault(); show(); draw(); }
    return;
  }
  let a = KEYS[e.key];
  if (e.shiftKey && e.key === 'Tab') a = 'prev';
  // Shift + arrows look round the map.
  if (e.shiftKey && e.key.startsWith('Arrow')) {
    const d = 60, v = topView();
    if (v?.padPan(e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0, e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0)) e.preventDefault();
    return;
  }
  if (!a || ownsKey(e.key)) return;
  if (e.repeat && !(a === 'up' || a === 'down' || a === 'left' || a === 'right' || a === 'next' || a === 'prev')) { e.preventDefault(); return; }
  e.preventDefault();
  act(a, 'key');
}

// ---------------------------------------------------------------- start

function install() {
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', e => { if (e.key === 'Enter' || e.key === ' ') release(); });
  // Touch or the mouse: back to pointer play, the ring and hints go.
  const off = (e: Event) => { if (e.isTrusted) hide(); };
  window.addEventListener('pointerdown', off, true);
  window.addEventListener('touchstart', off, { capture: true, passive: true });
  window.addEventListener('gamepadconnected', () => { padsSeen = true; wake(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') wake(); });
  // Android: the controller's back key (B as the system's back) comes here instead of closing the app.
  (window as unknown as { __rich4PadBack?: () => boolean }).__rich4PadBack = () => {
    if (performance.now() - lastBack < 300) return true; // the same press already seen as the pad's B
    act('back', 'native');
    return true;
  };
  // Some browsers only list a pad after a button press: look once now in case one is already there.
  if (pads().length) { padsSeen = true; wake(); }
}

install();

/** For tests / the debug handle: the current focus and mode. */
export function padState() {
  return { shown, focus, spot, cursor: cursor && { x: cursor.x, y: cursor.y }, source };
}
(window as unknown as { __rich4Pad?: unknown }).__rich4Pad = { state: padState, act: (a: Action) => act(a, 'pad'), context };
