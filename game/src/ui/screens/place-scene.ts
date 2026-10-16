/**
 * Shared frame for the special-place scenes (lottery, hospital / prison, magic house, auction): a full-screen
 * overlay with a fixed design canvas in original pixels (640×480 landscape, a taller canvas in portrait) that is
 * scaled to fit, so everything shows on one page at every size. Art is placed the way the original draws it:
 * frame (x, y) puts the frame's anchor at (x, y).
 */
import { CHARACTERS } from '../../core/characters';
import type { ScreenContext } from './registry';
import './place-scene.css';

export const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};
export const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
export const money = (n: number) => n.toLocaleString('zh-Hant');
export const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

type Archive = 'Data' | 'Panel' | 'map';

export interface Scene {
  ctx: ScreenContext;
  /** Full-screen overlay (taps anywhere for skipping waits). */
  root: HTMLElement;
  /** The design canvas, in original pixels. */
  stage: HTMLElement;
  /** Where art() / box() put things without an explicit parent (the stage unless a build moves it). */
  layer: HTMLElement;
  portrait: boolean;
  /** Design size of the canvas. */
  w: number;
  h: number;
  /** An art frame as an <img>, anchor at (x, y) on the canvas (or inside `parent`); null when the art is missing. */
  art(archive: Archive, id: number, frame: number, x: number, y: number, cls?: string, parent?: HTMLElement): HTMLImageElement | null;
  /** Swap an <img> made by art() to another frame, keeping the same anchor point. */
  swap(img: HTMLImageElement | null, archive: Archive, id: number, frame: number): void;
  /** Absolutely placed box on the canvas. */
  box(cls: string, x: number, y: number, w: number, h: number, html?: string, parent?: HTMLElement): HTMLElement;
  /** Waits ms × game speed, or until the player taps. */
  wait(ms: number): Promise<void>;
  /** Plain timer (× game speed), not skippable. */
  sleep(ms: number): Promise<void>;
  /** Repeating timer cleared on close. */
  every(ms: number, fn: () => void): void;
  close(): void;
  closed: boolean;
}

/**
 * Opens a scene (over the whole game screen, or inside `opts.parent`). `size(portrait)` gives the canvas size; `build` fills it and is called again when the
 * orientation flips (the canvas is emptied first).
 */
export function openScene(ctx: ScreenContext, cls: string, size: (portrait: boolean) => [number, number], build: (s: Scene) => void,
                          opts: { parent?: HTMLElement } = {}): Scene {
  const root = el('div', `pl-scene ${cls}${opts.parent ? ' in-area' : ''}`);
  const stage = el('div', 'pl-stage');
  root.append(stage);
  const timers: number[] = [];
  let skip: (() => void) | null = null;
  const s: Scene = {
    ctx, root, stage, layer: stage, portrait: false, w: 640, h: 480, closed: false,
    art(archive, id, frame, x, y, c, parent) {
      const a = ctx.bank.art(archive, id, frame);
      if (!a) return null;
      const img = el('img', `pl-art${c ? ` ${c}` : ''}`);
      img.src = a.src; img.alt = ''; img.draggable = false;
      img.dataset.x = String(x); img.dataset.y = String(y);
      Object.assign(img.style, { left: `${x - a.ax}px`, top: `${y - a.ay}px`, width: `${a.w}px`, height: `${a.h}px` });
      (parent ?? s.layer).append(img);
      return img;
    },
    swap(img, archive, id, frame) {
      const a = img && ctx.bank.art(archive, id, frame);
      if (!img || !a) return;
      const x = Number(img.dataset.x), y = Number(img.dataset.y);
      img.src = a.src;
      Object.assign(img.style, { left: `${x - a.ax}px`, top: `${y - a.ay}px`, width: `${a.w}px`, height: `${a.h}px` });
    },
    box(c, x, y, w, h, html, parent) {
      const b = el('div', c, html);
      Object.assign(b.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
      (parent ?? s.layer).append(b);
      return b;
    },
    wait(ms) {
      return new Promise(resolve => {
        const end = () => { if (skip === end) skip = null; clearTimeout(t); resolve(); };
        const t = window.setTimeout(end, ms * ctx.scale());
        skip = end;
      });
    },
    sleep(ms) { return new Promise(resolve => { timers.push(window.setTimeout(resolve, ms * ctx.scale())); }); },
    every(ms, fn) { timers.push(window.setInterval(fn, ms)); },
    close() {
      if (s.closed) return;
      s.closed = true;
      ro.disconnect();
      for (const t of timers) { clearTimeout(t); clearInterval(t); }
      root.classList.add('out');
      setTimeout(() => root.remove(), 160);
    },
  };
  // A tap skips the current wait (09 §6.1: notices end early on a click).
  root.addEventListener('pointerup', () => skip?.());
  const fit = () => {
    const W = root.clientWidth, H = root.clientHeight;
    if (!W || !H) return;
    const portrait = H > W * 1.05;
    if (portrait !== s.portrait || !stage.childElementCount) {
      s.portrait = portrait;
      [s.w, s.h] = size(portrait);
      for (const t of timers.splice(0)) { clearTimeout(t); clearInterval(t); }
      stage.replaceChildren();
      s.layer = stage;
      stage.style.width = `${s.w}px`; stage.style.height = `${s.h}px`;
      root.classList.toggle('portrait', portrait);
      build(s);
    }
    // Scale to fit, centred, letterboxed: the whole canvas always shows (never cropped).
    const k = Math.min(W / s.w, H / s.h);
    stage.style.left = `${(W - s.w * k) / 2}px`;
    stage.style.top = `${(H - s.h * k) / 2}px`;
    stage.style.transform = `scale(${k})`;
  };
  const ro = new ResizeObserver(fit);
  // A scene in the map area (the auction room) stays under the message layer, so the game's notices show on it.
  (opts.parent ?? (ctx.shell.isConnected ? ctx.shell : document.body)).append(root);
  ro.observe(root);
  fit();
  return s;
}

/** Player face (Data #2, frame = character id) as an <img> tag, or ''. */
export function face(ctx: ScreenContext, character: number, cls = ''): string {
  const a = ctx.bank.art('Data', 2, character);
  return a ? `<img class="pl-face ${cls}" src="${a.src}" alt="">` : '';
}

export const charName = (ctx: ScreenContext, p: number) => CHARACTERS[ctx.game.players[p]?.character ?? 0]?.name ?? '';
export const charColor = (ctx: ScreenContext, p: number) => hex(CHARACTERS[ctx.game.players[p]?.character ?? 0]?.color ?? 0xffffff);

/**
 * Number in the original's gold digit font (Panel #13: 0..9, 10 comma, 11 $), as inline images.
 * `height` is the digit height in canvas px (the art is 18 high).
 */
export function goldDigits(ctx: ScreenContext, text: string, height = 18): string {
  const k = height / 18;
  return [...text].map(ch => {
    const f = ch === ',' ? 10 : ch === '$' ? 11 : /\d/.test(ch) ? Number(ch) : -1;
    const a = f >= 0 ? ctx.bank.art('Panel', 13, f) : null;
    if (!a) return `<span class="pl-gd-t">${esc(ch)}</span>`;
    // The comma's anchor sits 3 px under the digits' middle line: its top is 12 px below theirs.
    const style = `width:${a.w * k}px;height:${a.h * k}px${f === 10 ? `;margin-top:${12 * k}px` : ''}`;
    return `<img class="pl-gd" src="${a.src}" alt="${ch}" style="${style}">`;
  }).join('');
}

/** Loads and decodes images (an FLC's frames before playing it); resolves when done or after `timeout` ms. */
export function preload(srcs: (string | undefined)[], timeout = 2500): Promise<void> {
  const all = Promise.all(srcs.filter((s): s is string => !!s).map(src => {
    const im = new Image();
    im.src = src;
    return im.decode().catch(() => undefined);
  }));
  return Promise.race([all.then(() => undefined), new Promise<void>(r => setTimeout(r, timeout))]);
}

/** Every frame's source of an animation resource (FLC / SMP), for preload(). */
export function frameSrcs(ctx: ScreenContext, archive: Archive, id: number, from: number, to: number): (string | undefined)[] {
  const out: (string | undefined)[] = [];
  for (let f = from; f <= to; f++) out.push(ctx.bank.art(archive, id, f)?.src);
  return out;
}
