/**
 * 清明上河's three 梁山 mini-games (core/qingming.ts tiger / boar / wrestle; docs/rules/35, the user 2026-11-20), played
 * by the human who stopped there (a computer's result, and 十字坡, only show the board 'qm-game-result'):
 *
 * - { t: 'qm-tiger', p, secs, per } → { hits, full }: 景陽岡打虎 — red spots light up on the tiger's head, rump, paws,
 *   tail …, each to be tapped before it goes out (quicker, shorter and more of them as the 15 s run); a hit and the tiger
 *   flinches under a fist, a miss and it pounces.
 * - { t: 'qm-boar', p, secs } → { points, full }: 野豬林射野豬 — boars charge down the forest track; a tap shoots an
 *   arrow at one (1 / 2 / 3 arrows for 普通 / 高級 / 野豬王, 3 / 5 / 10 點券); one over the line and it is over (the
 *   core adds the 30 for 15 s itself).
 * - { t: 'qm-shell', p, bowls, per, all, hold } → { cleared }: 十字坡 — 孫二娘 shows the bowl without 蒙汗藥 and shuffles
 *   (3 … 7 bowls, ever faster); a tap picks; a wrong bowl ends it.
 * - { t: 'qm-wrestle', p } → { won, points }: 相撲擂台 — 15 s, you (your own character's 立繪) against 燕青: every stop
 *   of the slider on the power bar a shove (red 50 %, orange 34 %, yellow 25 %, else 10 % off him, as many 點券), 燕青
 *   throws you at 4, 8 and 12 s and floors you at 15 s unless you floored him first.
 *
 * The players' 立繪 (games/chars/<character>-<pose>.webp: ready, push, hit, down, bow) and 燕青's (games/yanqing-<pose>)
 * are all at one scale (tools/tycoon-art/qingming_screens.py chars), shown at FIG_K of their pixels.
 *
 * Landscape 1600 × 900, upright 900 × 1600 (fitOverlay); taps by pointerdown (mouse and touch alike). Pictures:
 * tools/tycoon-art/qingming_screens.py → maps/remake/qingming/games.
 */
import { askScreens, fxScreens, onStuck, type ScreenContext } from './registry';
import { fitOverlay } from './bank';
import { audio } from '../audio';
import { ASSETS } from '../assets';
import { cnPreload, cnSound } from '../cn-sound';
import {
  bandAt, bandsAt, boarKind, boarWave, BOARS, HIT_DAMAGE, MIN_RUN, pickSpot, redZone, sliderAt, spotXY, STRIKE_RECOVER, sweepSecs,
  THROW_STUN, tigerPace, WRESTLE_SECS, YAN_AT, YAN_DAMAGE, type Area, type Band, type SpotAt,
} from './qm-logic';
import { QM_THEME } from '../jq-music';
import { HOLD_SECS, HOLD_WRESTLE } from '../../core/qingming';
import { screenMusic } from '../screen-music';
import './cn-ui.css';
import './qm-games.css';

const ART = `${ASSETS}/maps/remake/qingming/games`;
const FACES = `${ASSETS}/maps/remake/faces`;
const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/**
 * The tiger's areas on each picture (fractions of the picture; tools/tycoon-art/qingming_screens.py tiger-wide /
 * tiger-tall, measured on the pictures): a spot sits inside one of them.
 */
const TIGER_AREAS: Record<'wide' | 'tall', Area[]> = {
  wide: [
    { part: 'head', x: 0.263, y: 0.37, rx: 0.045, ry: 0.07 },
    { part: 'shoulder', x: 0.42, y: 0.39, rx: 0.04, ry: 0.06 },
    { part: 'back', x: 0.575, y: 0.41, rx: 0.05, ry: 0.05 },
    { part: 'rump', x: 0.72, y: 0.44, rx: 0.035, ry: 0.06 },
    { part: 'tail', x: 0.935, y: 0.27, rx: 0.012, ry: 0.05 },
    { part: 'front paw', x: 0.205, y: 0.71, rx: 0.025, ry: 0.025 },
    { part: 'front paw', x: 0.375, y: 0.765, rx: 0.025, ry: 0.025 },
    { part: 'hind paw', x: 0.63, y: 0.755, rx: 0.025, ry: 0.025 },
    { part: 'hind paw', x: 0.84, y: 0.78, rx: 0.025, ry: 0.025 },
  ],
  tall: [
    { part: 'head', x: 0.513, y: 0.49, rx: 0.08, ry: 0.05 },
    { part: 'front paw', x: 0.19, y: 0.615, rx: 0.05, ry: 0.02 },
    { part: 'front paw', x: 0.8, y: 0.655, rx: 0.05, ry: 0.02 },
    { part: 'shoulder', x: 0.26, y: 0.45, rx: 0.05, ry: 0.04 },
    { part: 'back', x: 0.55, y: 0.3, rx: 0.07, ry: 0.03 },
    { part: 'hind leg', x: 0.83, y: 0.46, rx: 0.04, ry: 0.05 },
    { part: 'tail', x: 0.86, y: 0.19, rx: 0.025, ry: 0.04 },
  ],
};
/** Where the tiger's head is (its pounce zooms in there). */
const TIGER_HEAD = { wide: TIGER_AREAS.wide[0], tall: TIGER_AREAS.tall[0] };
/** The boars' sheet sizes (px, one scale: tools/tycoon-art/qingming_screens.py install cuts them from one picture). */
const BOAR_PX: [number, number][] = [[346, 628], [463, 822], [585, 944]];
/** The forest track: its far end and the line (fractions of the stage), each orientation. */
const TRACK = { wide: { vx: 0.5, vy: 0.33, line: 0.8, spread: 0.42, king: 240 }, tall: { vx: 0.55, vy: 0.37, line: 0.8, spread: 0.4, king: 280 } };

/** The player who just played a game on this phone (the board for the same result, if the rules send one, is skipped). */
let played: { p: number; at: number } | null = null;

interface Stage {
  ctx: ScreenContext;
  ov: ReturnType<typeof fitOverlay>;
  $: (s: string) => HTMLElement;
  tall: () => boolean;
  /** Sizes of the stage now. */
  W: () => number;
  H: () => number;
  flip: ((tall: boolean) => void)[];
  closed: boolean;
  onClose: (() => void)[];
}
let open: Stage | null = null;
function shut() {
  const o = open;
  if (!o) return;
  open = null;
  o.closed = true;
  o.ov.close();
  for (const f of o.onClose.splice(0)) f();
}
onStuck(shut);

function faceSrc(ctx: ScreenContext, p: number, expr = 0): string {
  const ch = ctx.game.players[p]?.character ?? 0;
  return `${FACES}/${ch}-${expr}.webp`;
}
function faceImg(ctx: ScreenContext, p: number, cls: string, expr = 0): string {
  const old = ctx.bank.art('Data', 2, ctx.game.players[p]?.character ?? 0)?.src ?? '';
  return `<img class="${cls}" src="${faceSrc(ctx, p, expr)}" alt="" draggable="false" onerror="this.onerror=null;this.src='${old}'">`;
}

/** A player's 立繪 in a pose, or 燕青's (p = -1). */
type Pose = 'ready' | 'push' | 'hit' | 'down' | 'bow' | 'throw' | 'win';
const figSrc = (ctx: ScreenContext, p: number, pose: Pose) => (p < 0 ? `${ART}/yanqing-${pose}.webp` : `${ART}/chars/${ctx.game.players[p]?.character ?? 0}-${pose}.webp`);
/**
 * A figure standing at its feet: a box at (x, y) = the middle of its feet, the picture above it at k × its own pixels
 * (one scale for every pose and every character), never stretched.
 */
function figure(ctx: ScreenContext, p: number, pose: Pose, cls: string, k: number) {
  const box = document.createElement('div');
  box.className = `qmg-fig ${cls}`;
  const img = document.createElement('img');
  img.alt = ''; img.draggable = false;
  const size = () => { if (img.naturalWidth) { img.style.width = `${img.naturalWidth * k}px`; img.style.height = `${img.naturalHeight * k}px`; } };
  img.onload = size;
  box.append(img);
  const set = (q: Pose) => { if (img.dataset.pose === q) return; img.dataset.pose = q; img.src = figSrc(ctx, p, q); if (img.complete) size(); };
  set(pose);
  for (const q of (p < 0 ? ['ready', 'throw', 'hit', 'down', 'win'] : ['ready', 'push', 'hit', 'down']) as Pose[]) { const pre = new Image(); pre.src = figSrc(ctx, p, q); }
  return { box, img, set, stand(x: number, y: number) { Object.assign(box.style, { left: `${x}px`, top: `${y}px` }); }, scale(n: number) { k = n; size(); } };
}

/** The games' own pieces while one is played (清明上河's set, jq-music.ts QM_THEME; the result board keeps the track). */
const music = screenMusic();
function stage(ctx: ScreenContext, cls: string, html: string, theme?: number): Stage {
  shut();
  const flip: ((tall: boolean) => void)[] = [];
  const ov = fitOverlay(ctx.shell, `qmg-ov ${cls}-ov`, tall => (tall ? [900, 1600] : [1600, 900]), tall => flip.forEach(f => f(tall)), 0);
  ov.scene.classList.add('cn-scene', 'qmg-scene', cls);
  ov.scene.innerHTML = html;
  const o: Stage = {
    ctx, ov, flip, closed: false, onClose: [],
    $: (s: string) => ov.scene.querySelector<HTMLElement>(s)!,
    tall: () => ov.isTall(), W: () => (ov.isTall() ? 900 : 1600), H: () => (ov.isTall() ? 1600 : 900),
  };
  open = o;
  if (theme !== undefined) { music(true, theme); o.onClose.push(() => music(false, theme)); }
  return o;
}

/** A picture covering the stage (its aspect kept, centred, the overflow cut): spots placed on it in % stay on it. */
function cover(o: Stage, pic: HTMLElement, aspect: () => number) {
  const fit = () => {
    const W = o.W(), H = o.H(), a = aspect();
    const w = Math.max(W, H * a), h = w / a;
    Object.assign(pic.style, { width: `${w}px`, height: `${h}px`, left: `${(W - w) / 2}px`, top: `${(H - h) / 2}px` });
  };
  fit();
  o.flip.push(() => requestAnimationFrame(fit));
  return fit;
}

const HUD = (title: string, sub: string) => `
  <div class="qmg-top">
    <div class="qmg-who"></div>
    <div class="cn-frame qmg-title"><div class="cn-lbl">${title}</div></div>
    <div class="qmg-score"><span>點券</span><b>0</b></div>
  </div>
  <div class="qmg-clock"><i></i><span></span></div>
  <div class="qmg-sub">${sub}</div>`;

function hudWho(o: Stage, p: number) {
  o.$('.qmg-who').innerHTML = `${faceImg(o.ctx, p, 'qmg-who-face')}<span>${esc(o.ctx.game.name(p))}</span>`;
}

/** The rules on a panel; a tap starts (or it starts by itself after a few seconds). */
function intro(o: Stage, title: string, lines: string[], secs = 5): Promise<void> {
  const box = document.createElement('div');
  box.className = 'qmg-intro';
  box.innerHTML = `<div class="cn-card qmg-intro-card"><h2>${title}</h2>${lines.map(l => `<p>${l}</p>`).join('')}<div class="qmg-go"><button class="cn-btn">開始</button><i></i></div></div>`;
  o.ov.scene.append(box);
  const ring = box.querySelector<HTMLElement>('.qmg-go i')!;
  ring.style.animationDuration = `${secs}s`;
  return new Promise(res => {
    let done = false;
    const go = () => {
      if (done) return;
      done = true; clearTimeout(t); audio.ui('yes');
      box.classList.add('out'); setTimeout(() => box.remove(), 250);
      // the one-line rule under the clock goes with the rules (it would sit on the tiger's head)
      o.ov.scene.querySelector('.qmg-sub')?.remove();
      res();
    };
    const t = window.setTimeout(go, secs * 1000);
    box.addEventListener('pointerdown', go);
    o.onClose.push(go);
  });
}

/** The end banner: a big line and what it means; a tap or a moment and it is done. */
function banner(o: Stage, good: boolean, big: string, small: string, ms = 2200): Promise<void> {
  const b = document.createElement('div');
  b.className = `qmg-banner ${good ? 'good' : 'bad'}`;
  b.innerHTML = `<div class="cn-frame qmg-banner-box"><b>${big}</b><span>${small}</span></div>`;
  o.ov.scene.append(b);
  audio.ui(good ? 'yes' : 'no');
  if (good) { cnSound('cheer', 0.6); cnSound('coins', 0.6); } else cnSound('boo', 0.5);
  return new Promise(res => {
    let done = false;
    const end = () => { if (done) return; done = true; clearTimeout(t); res(); };
    const t = window.setTimeout(end, ms * Math.max(0.7, o.ctx.scale()));
    setTimeout(() => b.addEventListener('pointerdown', end), 400);
    o.onClose.push(end);
  });
}

/** The game's clock (performance.now, in seconds) and a frame loop that stops when the screen goes. */
function loop(o: Stage, frame: (t: number, dt: number) => boolean): Promise<void> {
  return new Promise(res => {
    const t0 = performance.now();
    let last = t0, raf = 0, done = false;
    const end = () => { if (done) return; done = true; cancelAnimationFrame(raf); res(); };
    const step = (now: number) => {
      if (o.closed || !o.ov.root.isConnected) return end();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (!frame((now - t0) / 1000, dt)) return end();
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    o.onClose.push(end);
  });
}

function showClock(o: Stage, left: number, secs: number) {
  o.$('.qmg-clock i').style.width = `${Math.max(0, (left / secs) * 100)}%`;
  o.$('.qmg-clock span').textContent = `${Math.max(0, left).toFixed(1)} 秒`;
}
function showScore(o: Stage, n: number) {
  const b = o.$('.qmg-score b');
  b.textContent = String(n);
  b.animate([{ transform: 'scale(1.5)' }, { transform: 'scale(1)' }], { duration: 220 });
}
/** A "+n" rising from (x, y). */
function float(layer: HTMLElement, x: number, y: number, text: string, cls = '') {
  const f = document.createElement('div');
  f.className = `qmg-float ${cls}`; f.textContent = text;
  Object.assign(f.style, { left: `${x}px`, top: `${y}px` });
  layer.append(f);
  f.animate([{ transform: 'translate(-50%,-50%) scale(.6)', opacity: 0 }, { transform: 'translate(-50%,-90%) scale(1.15)', opacity: 1, offset: 0.25 },
    { transform: 'translate(-50%,-190%) scale(1)', opacity: 0 }], { duration: 800, easing: 'ease-out' }).onfinish = () => f.remove();
}
function shake(el: HTMLElement, px = 16, ms = 360) {
  el.animate([{ transform: 'translate(0,0)' }, { transform: `translate(${px}px,${-px / 2}px)` }, { transform: `translate(${-px}px,${px / 2}px)` },
    { transform: `translate(${px / 2}px,${px / 3}px)` }, { transform: 'translate(0,0)' }], { duration: ms });
}
/** A burst (a star of light) at (x, y), with a fist in it when `fist`. */
function burst(layer: HTMLElement, x: number, y: number, size: number, fist = false) {
  const b = document.createElement('div');
  b.className = 'qmg-burst';
  Object.assign(b.style, { left: `${x}px`, top: `${y}px`, width: `${size}px`, height: `${size}px` });
  b.innerHTML = `<svg viewBox="-50 -50 100 100"><polygon points="${Array.from({ length: 24 }, (_, i) => { const r = i % 2 ? 22 : 48, a = (i / 24) * Math.PI * 2; return `${(Math.cos(a) * r).toFixed(1)},${(Math.sin(a) * r).toFixed(1)}`; }).join(' ')}"/></svg>${fist ? FIST : ''}`;
  layer.append(b);
  b.animate([{ transform: 'translate(-50%,-50%) scale(.3) rotate(-20deg)', opacity: 1 }, { transform: 'translate(-50%,-50%) scale(1.1) rotate(0)', opacity: 1, offset: 0.35 },
    { transform: 'translate(-50%,-50%) scale(1.3) rotate(8deg)', opacity: 0 }], { duration: 420, easing: 'ease-out' }).onfinish = () => b.remove();
}
/** A drawn fist (the 打虎 hit). */
const FIST = `<svg class="qmg-fist" viewBox="0 0 100 100"><g stroke="#3a1a08" stroke-width="5" stroke-linejoin="round" fill="#f2c08a">
  <path d="M18 46 q0-14 14-14 h40 q12 0 12 12 v22 q0 18-18 18 h-30 q-18 0-18-18z"/>
  <path d="M32 32 v22 M46 32 v22 M60 32 v22" fill="none"/><path d="M18 54 q-8-6 2-16 l16 4 v10z"/></g></svg>`;

// ================================================================ 景陽岡打虎

interface TigerAsk { t: 'qm-tiger'; p: number; secs: number; per: number }

askScreens['qm-tiger'] = async (ctx, ask) => {
  const a = ask as unknown as TigerAsk;
  const secs = a.secs || 15, per = a.per || 5;
  cnPreload('kick', 'cheer', 'boo', 'coins', 'ko');
  const o = stage(ctx, 'qmg-g-tiger', `
    <div class="qmg-shake"><div class="qmg-pic"><div class="qmg-spots"></div></div></div>
    <div class="qmg-claws"><i></i><i></i><i></i></div>
    <div class="qmg-fx"></div>
    ${HUD('景陽岡打虎', `點中老虎身上的紅點！每個 ${per} 點券，漏一個就輸`)}`, QM_THEME.tiger);
  hudWho(o, a.p);
  const pic = o.$('.qmg-pic'), spotsEl = o.$('.qmg-spots'), fx = o.$('.qmg-fx');
  const kind = () => (o.tall() ? 'tall' : 'wide') as 'wide' | 'tall';
  const setPic = () => { pic.style.backgroundImage = `url(${ART}/tiger-${kind()}.webp)`; };
  setPic();
  cover(o, pic, () => (o.tall() ? 1024 / 1536 : 1536 / 1024));
  showClock(o, secs, secs);

  interface Spot { at: SpotAt; born: number; life: number; el: HTMLElement }
  const lit: Spot[] = [];
  let hits = 0, lost = false, last = -1, next = 0.5, now = 0;
  const place = (s: Spot) => { const p = spotXY(TIGER_AREAS[kind()], s.at); Object.assign(s.el.style, { left: `${p.x * 100}%`, top: `${p.y * 100}%` }); };
  o.flip.push(() => { setPic(); lit.forEach(place); });
  await intro(o, '景陽岡打虎', [`老虎身上會冒出<b>紅點</b>：頭、屁股、爪子、尾巴……`, `在紅點消失前<b>點中</b>它，每個得 <b>${per} 點券</b>`, `<b>漏掉一個就輸</b>，點券照拿：撐過 <b>${HOLD_SECS} 秒</b>再輸人還在梁山，${HOLD_SECS} 秒內輸進醫院 3 天`, `撐滿 <b>${secs} 秒</b>就留在景陽岡`]);
  if (o.closed) return { hits, full: false };

  const hit = (s: Spot) => {
    if (lost || !lit.includes(s)) return;
    lit.splice(lit.indexOf(s), 1);
    hits += 1;
    const r = s.el.getBoundingClientRect(), sr = o.ov.scene.getBoundingClientRect(), k = sr.width / o.W();
    const x = (r.left + r.width / 2 - sr.left) / k, y = (r.top + r.height / 2 - sr.top) / k;
    s.el.remove();
    burst(fx, x, y, 220, true);
    float(fx, x, y - 40, `+${per}`);
    showScore(o, hits * per);
    // the tiger flinches
    pic.animate([{ transform: 'scale(1)' }, { transform: 'scale(.975) translate(4px,6px)' }, { transform: 'scale(1)' }], { duration: 200 });
    cnSound('kick', 0.7);
  };
  const spawn = (t: number, life: number) => {
    const at = pickSpot(TIGER_AREAS[kind()], lit.map(s => s.at), last, Math.random);
    last = at.area;
    const el = document.createElement('div');
    el.className = 'qmg-spot';
    el.style.setProperty('--life', `${life}s`);
    el.innerHTML = '<i></i><b></b>';
    const s: Spot = { at, born: t, life, el };
    el.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); hit(s); });
    spotsEl.append(el);
    lit.push(s);
    place(s);
  };
  await loop(o, t => {
    now = t;
    if (t >= secs) return false;
    showClock(o, secs - t, secs);
    for (const s of lit) if (t - s.born > s.life) { lost = true; s.el.classList.add('missed'); return false; }
    const pace = tigerPace(t, secs);
    if (t >= next && lit.length < pace.max) { for (let i = 0; i < pace.burst && lit.length < pace.max; i++) spawn(t, pace.life); next = t + pace.every; }
    return true;
  });
  if (o.closed) return { hits, full: false, lasted: 0 };
  const full = !lost && now >= secs, held = full || now >= HOLD_SECS;
  showClock(o, full ? 0 : secs - now, secs);
  for (const s of lit) if (!s.el.classList.contains('missed')) s.el.remove();
  played = { p: a.p, at: Date.now() };
  if (full) {
    await banner(o, true, `撐滿 ${secs} 秒！`, `打虎得 ${hits * per} 點券　留在景陽岡`);
  } else {
    // the tiger pounces: in on its head, claws across the screen
    const h = TIGER_HEAD[kind()];
    pic.style.transformOrigin = `${h.x * 100}% ${h.y * 100}%`;
    await wait(300);
    pic.animate([{ transform: 'scale(1)' }, { transform: 'scale(.94)', offset: 0.3 }, { transform: 'scale(2.3)' }], { duration: 420, easing: 'ease-in', fill: 'forwards' });
    cnSound('ko', 0.9);
    await wait(330);
    o.$('.qmg-claws').classList.add('on');
    shake(o.$('.qmg-shake'), 26, 500);
    await wait(500);
    await banner(o, false, '被老虎撲倒了…', held ? `撐過 ${HOLD_SECS} 秒　得 ${hits * per} 點券　人還在梁山` : `得 ${hits * per} 點券　進醫院 3 天`);
  }
  if (open === o) shut();
  return { hits, full, lasted: now };
};

// ================================================================ 野豬林射野豬

interface BoarAsk { t: 'qm-boar'; p: number; secs: number }

askScreens['qm-boar'] = async (ctx, ask) => {
  const a = ask as unknown as BoarAsk;
  const secs = a.secs || 15;
  cnPreload('whoosh', 'peck', 'ko', 'cheer', 'boo', 'coins', 'land');
  const o = stage(ctx, 'qmg-g-boar', `
    <div class="qmg-shake"><div class="qmg-pic"></div>
      <div class="qmg-field"></div>
      <div class="qmg-line"></div>
      <div class="qmg-archer"></div>
    </div>
    <div class="qmg-flash"></div>
    <div class="qmg-fx"></div>
    ${HUD('野豬林射野豬', '點野豬射箭！普通 1 箭、高級 2 箭、野豬王 3 箭；別讓牠衝過線')}`, QM_THEME.boar);
  hudWho(o, a.p);
  // you, from behind, drawing the bow at the bottom of the track
  const archer = figure(ctx, a.p, 'bow', 'qmg-archer-fig', 0.5);
  o.$('.qmg-archer').append(archer.box);
  const pic = o.$('.qmg-pic'), field = o.$('.qmg-field'), fx = o.$('.qmg-fx');
  const kind = () => (o.tall() ? 'tall' : 'wide') as 'wide' | 'tall';
  const setPic = () => { pic.style.backgroundImage = `url(${ART}/forest-${kind()}.webp)`; };
  setPic();
  cover(o, pic, () => (o.tall() ? 1024 / 1536 : 1536 / 1024));
  o.flip.push(setPic);
  showClock(o, secs, secs);
  for (let i = 1; i <= 3; i++) { const im = new Image(); im.src = `${ART}/boar-${i}.webp`; }
  await intro(o, '野豬林射野豬', ['野豬從林子深處朝你衝過來', `<b>點哪頭就射哪頭</b>：普通 1 箭 <b>${BOARS[0].points} 點券</b>、高級 2 箭 <b>${BOARS[1].points} 點券</b>、野豬王 3 箭 <b>${BOARS[2].points} 點券</b>`,
    `<b>任何一頭衝過線就輸</b>，點券照拿：撐過 <b>${HOLD_SECS} 秒</b>再輸人還在梁山，${HOLD_SECS} 秒內輸進醫院 3 天`, `撐滿 <b>${secs} 秒</b>留在原地，再加 30 點券`]);
  if (o.closed) return { points: 0, full: false };

  interface Boar { kind: 0 | 1 | 2; hp: number; p: number; cross: number; lane: number; x0: number; el: HTMLElement; img: HTMLImageElement; dead: boolean; x: number; y: number; w: number }
  const boars: Boar[] = [];
  let points = 0, lost: Boar | null = null, lastSpawn = -9, now = 0;
  const geo = () => {
    const T = TRACK[kind()], W = o.W(), H = o.H();
    return { W, H, vx: T.vx * W, vy: T.vy * H, line: T.line * H, spread: T.spread * W, k: T.king / BOAR_PX[2][0] };
  };
  o.$('.qmg-line').style.top = `${TRACK.wide.line * 100}%`;
  const ease = (p: number) => 0.35 * p + 0.65 * p * p;
  const place = (b: Boar) => {
    const g = geo(), e = ease(Math.max(0, Math.min(1, b.p)));
    const s = 0.22 + 0.78 * e;
    b.w = BOAR_PX[b.kind][0] * g.k * s;
    const h = BOAR_PX[b.kind][1] * g.k * s;
    b.x = g.vx + b.x0 * g.spread * 0.12 + (b.lane * g.spread - b.x0 * g.spread * 0.12) * e;
    b.y = g.vy + (g.line - g.vy) * e;
    Object.assign(b.el.style, { left: `${b.x - b.w / 2}px`, top: `${b.y - h}px`, width: `${b.w}px`, height: `${h}px`, zIndex: String(10 + Math.round(e * 900)) });
  };
  const shoot = (b: Boar) => {
    if (lost || b.dead) return;
    const g = geo();
    b.hp -= 1;
    // the arrow flies from the bow to the boar
    const arrow = document.createElement('div'); arrow.className = 'qmg-arrow';
    const ax = g.W / 2 + 40, ay = g.H - 230, tx = b.x, ty = b.y - b.w * 0.9, ang = Math.atan2(ty - ay, tx - ax);
    Object.assign(arrow.style, { left: `${ax}px`, top: `${ay}px`, transform: `rotate(${ang}rad)` });
    fx.append(arrow);
    arrow.animate([{ left: `${ax}px`, top: `${ay}px` }, { left: `${tx}px`, top: `${ty}px` }], { duration: 110, easing: 'linear', fill: 'forwards' }).onfinish = () => arrow.remove();
    cnSound('whoosh', 0.5);
    setTimeout(() => {
      if (!b.el.isConnected) return;
      cnSound('peck', 0.8);
      if (b.dead) return;
      const stuck = document.createElement('i'); stuck.className = 'qmg-stuck';
      Object.assign(stuck.style, { left: `${30 + Math.random() * 40}%`, top: `${35 + Math.random() * 25}%`, transform: `rotate(${-120 + Math.random() * 60}deg)` });
      b.el.append(stuck);
    }, 110);
    if (b.hp > 0) {
      // a stagger: knocked back a little
      b.p = Math.max(0, b.p - 0.05);
      b.img.animate([{ transform: `${b.img.dataset.flip ?? ''} rotate(0)` }, { transform: `${b.img.dataset.flip ?? ''} rotate(-9deg) translateY(-6%)` }, { transform: `${b.img.dataset.flip ?? ''} rotate(0)` }], { duration: 260 });
      return;
    }
    b.dead = true;
    const pts = BOARS[b.kind].points;
    points += pts;
    showScore(o, points);
    float(fx, b.x, b.y - b.w * 1.4, `+${pts}`);
    b.el.classList.add('dead');
    b.img.animate([{ transform: `${b.img.dataset.flip ?? ''} rotate(0)`, opacity: 1 }, { transform: `${b.img.dataset.flip ?? ''} translateY(10%) rotate(-100deg)`, opacity: 1, offset: 0.45 },
      { transform: `${b.img.dataset.flip ?? ''} translateY(20%) rotate(-200deg) scale(.8)`, opacity: 0 }], { duration: 650, easing: 'ease-in', fill: 'forwards' });
    const smoke = document.createElement('div'); smoke.className = 'qmg-smoke'; b.el.append(smoke);
    setTimeout(() => b.el.remove(), 700);
  };
  const spawn = (t: number) => {
    const w = boarWave(t), k = boarKind(w, Math.random);
    // a lane away from the boars already near the far end
    let lane = 0;
    for (let i = 0; i < 6; i++) { lane = Math.random() * 2 - 1; if (!boars.some(b => !b.dead && b.p < 0.3 && Math.abs(b.lane - lane) < 0.35)) break; }
    const el = document.createElement('div'); el.className = `qmg-boar k${k}`;
    const img = document.createElement('img'); img.src = `${ART}/boar-${k + 1}.webp`; img.alt = ''; img.draggable = false;
    if (lane < -0.15) img.dataset.flip = 'scaleX(-1)';
    if (img.dataset.flip) img.style.transform = img.dataset.flip;
    el.append(img);
    const b: Boar = { kind: k, hp: BOARS[k].arrows, p: 0, cross: w.cross, lane, x0: lane, el, img, dead: false, x: 0, y: 0, w: 0 };
    el.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); shoot(b); });
    field.append(el);
    boars.push(b);
    place(b);
    el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 250 });
  };
  await loop(o, (t, dt) => {
    now = t;
    if (t >= secs) return false;
    showClock(o, secs - t, secs);
    for (const b of boars) {
      if (b.dead) continue;
      b.p += dt / b.cross;
      place(b);
      if (b.p >= 1) { lost = b; return false; }
    }
    for (let i = boars.length - 1; i >= 0; i--) if (boars[i].dead && !boars[i].el.isConnected) boars.splice(i, 1);
    const w = boarWave(t), out = boars.filter(b => !b.dead).length;
    if (out < w.target && t - lastSpawn >= w.gap) { spawn(t); lastSpawn = t; }
    return true;
  });
  if (o.closed) return { points, full: false, lasted: 0 };
  played = { p: a.p, at: Date.now() };
  const full = !lost && now >= secs, held = full || now >= HOLD_SECS;
  if (full) {
    showClock(o, 0, secs);
    boars.forEach(b => b.el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 400, fill: 'forwards' }));
    await banner(o, true, '守住了野豬林！', `射野豬得 ${points} 點券　再加 30 點券`);
  } else if (lost) {
    // the close-up: the boar fills the screen
    const b = lost as Boar;
    b.el.style.zIndex = '2000';
    b.el.animate([{ transform: 'scale(1)' }, { transform: `scale(${o.tall() ? 3.2 : 2.6}) translateY(10%)` }], { duration: 380, easing: 'ease-in', fill: 'forwards' });
    cnSound('ko', 1);
    await wait(300);
    o.$('.qmg-flash').animate([{ opacity: 0 }, { opacity: 0.85 }, { opacity: 0 }], { duration: 420 });
    shake(o.$('.qmg-shake'), 30, 500);
    await wait(600);
    await banner(o, false, '被野豬頂翻了…', held ? `撐過 ${HOLD_SECS} 秒　得 ${points} 點券　人還在梁山` : `得 ${points} 點券　進醫院 3 天`);
  }
  if (open === o) shut();
  return { points, full, lasted: now };
};

// ================================================================ 相撲擂台

interface WrestleAsk { t: 'qm-wrestle'; p: number }
const BAND_TEXT: Record<Band, string> = { red: '正中紅區！', orange: '好推！', yellow: '推中了', miss: '擦到一下' };
/** Where the two stand (their feet) and how big (× the sheets' pixels): landscape, upright. */
const RING = { wide: { you: [540, 680], yan: [1070, 680], k: 1.0, dx: 250 }, tall: { you: [250, 1080], yan: [655, 1080], k: 0.82, dx: 150 } };

askScreens['qm-wrestle'] = async (ctx, ask) => {
  const a = ask as unknown as WrestleAsk;
  cnPreload('kick', 'whoosh', 'land', 'ko', 'cheer', 'boo', 'coins');
  const name = esc(ctx.game.name(a.p));
  const o = stage(ctx, 'qmg-g-wrestle', `
    <div class="qmg-shake"><div class="qmg-pic"></div><div class="qmg-ring"></div></div>
    <div class="qmg-fx"></div>
    <div class="qmg-hp l"><span class="n">${faceImg(ctx, a.p, 'qmg-hp-face')}${name}</span><div class="track"><i></i></div></div>
    <div class="qmg-hp r"><span class="n">浪子 燕青</span><div class="track"><i></i></div></div>
    <div class="cn-frame qmg-title"><div class="cn-lbl">相撲擂台</div></div>
    <div class="qmg-clock"><i></i><span></span></div>
    <div class="qmg-score"><span>點券</span><b>0</b></div>
    <div class="qmg-round"></div>
    <div class="qmg-power"><div class="qmg-bar"><i class="y1"></i><i class="o1"></i><i class="r"></i><i class="o2"></i><i class="y2"></i><b class="qmg-needle"></b></div><div class="qmg-tap">點一下出手！</div></div>`, QM_THEME.wrestle);
  const pic = o.$('.qmg-pic'), fx = o.$('.qmg-fx'), ring = o.$('.qmg-ring');
  const kind = () => (o.tall() ? 'tall' : 'wide') as 'wide' | 'tall';
  const setPic = () => { pic.style.backgroundImage = `url(${ART}/stage-${kind()}.webp)`; };
  setPic();
  cover(o, pic, () => (o.tall() ? 1024 / 1536 : 1536 / 1024));
  const you = figure(ctx, a.p, 'ready', 'qmg-you', RING.wide.k), yan = figure(ctx, -1, 'ready', 'qmg-yan', RING.wide.k);
  ring.append(you.box, yan.box);
  const place = () => { const R = RING[kind()]; you.stand(R.you[0], R.you[1]); yan.stand(R.yan[0], R.yan[1]); you.scale(R.k); yan.scale(R.k); };
  place();
  o.flip.push(() => { setPic(); place(); });
  const hpBar = (side: 'l' | 'r', v: number) => { o.$(`.qmg-hp.${side} .track i`).style.width = `${Math.max(0, v)}%`; };
  const round = (text: string) => { const r = o.$('.qmg-round'); r.textContent = text; r.animate([{ transform: 'translateX(-50%) scale(1.5)', opacity: 0 }, { transform: 'translateX(-50%) scale(1)', opacity: 1 }], { duration: 260 }); };
  showClock(o, WRESTLE_SECS, WRESTLE_SECS);
  await intro(o, '相撲擂台', ['跟<b>浪子燕青</b>摔 <b>15 秒</b>！', '滑塊在蓄力條上來回晃，<b>點一下</b>就出手：<b>紅區</b>打掉 50%、<b>橙區</b> 34%、<b>黃區</b> 25%、其他 10%；剛開始色塊寬、滑塊慢，每出手一次色塊變窄、滑塊更快、紅區換地方',
    '打掉燕青 1% 的血得 <b>1 點券</b>，輸贏都照拿', '燕青第 4、8、12 秒各摔你一次，<b>15 秒到了還沒打倒他，他最後一摔你就倒</b>', `打倒燕青：得 100 點券，人還在梁山；沒打倒但打掉他 <b>${HOLD_WRESTLE}%</b> 以上，人還在梁山；不到 ${HOLD_WRESTLE}% 進醫院 3 天`]);
  if (o.closed) return { won: false, points: 0 };

  const bar = o.$('.qmg-bar'), needle = o.$('.qmg-needle'), power = o.$('.qmg-power');
  const zone = (red: number, B: ReturnType<typeof bandsAt>) => {
    const set = (cls: string, l: number, w: number) => { const e = bar.querySelector<HTMLElement>(`.${cls}`)!; e.style.left = `${l * 100}%`; e.style.width = `${w * 100}%`; };
    set('y1', red - B.orange - B.yellow, B.yellow); set('o1', red - B.orange, B.orange); set('r', red, B.red);
    set('o2', red + B.red, B.orange); set('y2', red + B.red + B.orange, B.yellow);
  };
  let yanHp = 100, youHp = 100, dealt = 0, n = 0, ti = 0, won = false, over = false;
  let busyTill = 0, struckAt = 0, aimAt = -1, red = 0.5, sweep = sweepSecs(0), now = 0, w = bandsAt(0);
  const ahead = () => (o.tall() ? RING.tall.dx : RING.wide.dx);
  const aim = (t: number) => { aimAt = t; w = bandsAt(n); red = redZone(Math.random, w); sweep = sweepSecs(n); zone(red, w); power.classList.add('on'); };
  const strike = (t: number, pos: number) => {
    const b = bandAt(pos, red, w), dmg = Math.min(yanHp, HIT_DAMAGE[b]);
    // the shove counts at the tap (one at 14.9 s floors him even though the picture lands after 15 s)
    yanHp -= dmg; dealt += dmg; struckAt = t;
    aimAt = -1; power.classList.remove('on'); n += 1; busyTill = t + STRIKE_RECOVER;
    needle.style.left = `${pos * 100}%`;
    needle.animate([{ transform: 'translateX(-50%) scale(1.6)' }, { transform: 'translateX(-50%) scale(1)' }], { duration: 250 });
    // you rush in and shove
    you.set('push');
    you.box.animate([{ transform: 'translateX(0)' }, { transform: `translateX(${ahead()}px)`, offset: 0.4 }, { transform: `translateX(${ahead()}px)`, offset: 0.6 }, { transform: 'translateX(0)' }], { duration: 700, easing: 'ease-in-out' });
    setTimeout(() => {
      if (o.closed) return;
      cnSound('kick', 1);
      const yr = yan.img.getBoundingClientRect(), sr = o.ov.scene.getBoundingClientRect(), k = sr.width / o.W();
      const hx = (yr.left + yr.width * 0.35 - sr.left) / k, hy = (yr.top + yr.height * 0.45 - sr.top) / k, top = (yr.top - sr.top) / k;
      burst(fx, hx, hy, b === 'red' ? 320 : 230);
      // the words above his head, never on his face
      float(fx, (yr.left + yr.width / 2 - sr.left) / k, Math.max(top - 50, o.tall() ? 420 : 230), `${BAND_TEXT[b]} -${HIT_DAMAGE[b]}%`, `band-${b}`);
      hpBar('r', yanHp);
      if (dmg) { showScore(o, dealt); float(fx, hx + 60, hy + 120, `+${dmg} 點券`, 'pts'); }
      if (dmg >= 34) cnSound('cheer', 0.55);
      yan.set('hit');
      yan.box.animate([{ transform: 'translateX(0)' }, { transform: `translateX(${30 + HIT_DAMAGE[b]}px)`, offset: 0.3 }, { transform: 'translateX(0)' }], { duration: 650, easing: 'ease-out' });
      setTimeout(() => { if (!over || won) you.set('ready'); if (yanHp > 0) yan.set('ready'); }, 650);
    }, 280);
  };
  const thrown = (final: boolean) => {
    aimAt = -1; power.classList.remove('on'); busyTill = now + THROW_STUN;
    round(final ? '燕青最後一摔！' : '燕青出手！');
    yan.set('throw');
    yan.box.animate([{ transform: 'translateX(0)' }, { transform: `translateX(${-ahead()}px)`, offset: 0.35 }, { transform: `translateX(${-ahead()}px)`, offset: 0.7 }, { transform: 'translateX(0)' }], { duration: 1100, easing: 'ease-in-out' });
    setTimeout(() => {
      if (o.closed) return;
      cnSound('whoosh', 0.8);
      you.set('hit');
      // over 燕青's shoulder: up and over, turning about the figure's middle
      you.img.style.transformOrigin = '50% 55%';
      const b = 'translateX(-50%) ';
      you.img.animate([{ transform: `${b}translate(0,0) rotate(0)` }, { transform: `${b}translate(${ahead() * 0.6}px,-260px) rotate(-200deg)`, offset: 0.5 },
        { transform: `${b}translate(${final ? -40 : 0}px,0) rotate(-360deg)` }], { duration: 650, easing: 'ease-in-out' });
      setTimeout(() => {
        if (o.closed) return;
        you.set('down'); cnSound('land', 1); shake(o.$('.qmg-shake'), 22, 420);
        youHp = final ? 0 : Math.max(0, youHp - YAN_DAMAGE); hpBar('l', youHp);
        const yr = you.img.getBoundingClientRect(), sr = o.ov.scene.getBoundingClientRect(), k = sr.width / o.W();
        float(fx, (yr.left + yr.width / 2 - sr.left) / k, (yr.top - sr.top) / k - 60, `-${final ? youHp + YAN_DAMAGE : YAN_DAMAGE}%`, 'band-hurt');
        if (final) { yan.set('win'); return; }
        setTimeout(() => { if (!o.closed && !over) { yan.set('ready'); you.set('ready'); } }, 450);
      }, 650);
    }, 380);
  };
  const tap = () => {
    if (aimAt < 0 || over) return;
    const run = (performance.now() - t0) / 1000 - aimAt;
    if (run < MIN_RUN) return;
    strike(aimAt + run, sliderAt(run, sweep));
  };
  const t0 = performance.now();
  o.ov.scene.addEventListener('pointerdown', tap);
  await loop(o, () => {
    now = (performance.now() - t0) / 1000;
    showClock(o, WRESTLE_SECS - now, WRESTLE_SECS);
    if (yanHp <= 0) { won = true; return now < struckAt + 0.7; }
    if (now >= WRESTLE_SECS) return false;
    if (aimAt >= 0) needle.style.left = `${sliderAt(now - aimAt, sweep) * 100}%`;
    if (now < busyTill) return true;
    if (ti < YAN_AT.length && now >= YAN_AT[ti]) { ti += 1; thrown(false); return true; }
    if (aimAt < 0) { aim(now); round(n ? `第 ${n + 1} 下` : '出手！'); }
    return true;
  });
  o.ov.scene.removeEventListener('pointerdown', tap);
  over = true;
  const points = Math.min(won ? 100 : 99, dealt);
  if (o.closed) return { won, points };
  played = { p: a.p, at: Date.now() };
  power.classList.remove('on');
  showClock(o, Math.max(0, WRESTLE_SECS - now), WRESTLE_SECS);
  if (won) {
    await wait(350);
    yan.set('down'); you.set('ready');
    yan.box.animate([{ transform: 'translate(0,0)' }, { transform: 'translate(160px, 30px)' }], { duration: 600, easing: 'ease-out', fill: 'forwards' });
    cnSound('ko', 0.9);
    await wait(700);
    await banner(o, true, '打贏燕青！', '得 100 點券　人還在梁山');
  } else {
    thrown(true);
    await wait(1500);
    await banner(o, false, '被燕青摔下擂台…', points >= HOLD_WRESTLE ? `打掉燕青 ${points}%　得 ${points} 點券　人還在梁山` : `得 ${points} 點券　進醫院 3 天`);
  }
  if (open === o) shut();
  return { won, points };
};

// ================================================================ 十字坡 鬼手

interface ShellAsk { t: 'qm-shell'; p: number; bowls: number[]; per: number; all: number; hold: number }
/**
 * Where the bowls stand on the table, in fractions of each picture (tools/tycoon-art/qingming_shell.py, measured on the
 * pictures): the row's left and right ends and the bowls' feet; the bowl's width at 3 bowls.
 */
const SHELL_TABLE = { wide: { x0: 0.07, x1: 0.93, y: 0.83, w: 0.12, back: 0 }, tall: { x0: 0.12, x1: 0.88, y: 0.76, w: 0.24, back: 0.63 } };
/** Upright, from this many bowls on they stand in two staggered rows (front and back), so they stay big enough to tap. */
const SHELL_TWO_ROWS = 5;
/**
 * A round's swaps and how long one takes (ms), and from which round two pairs swap at once; the seconds to pick. The first
 * three rounds are gentle, the fourth jumps (two pairs at once, quicker) — most people fall there (the user 2026-11-24:
 * 「8秒以內，一般人玩到4局就開始上難度」); the showing and shuffling stay within about 5 s a round.
 */
const SHELL_SWAPS = [4, 5, 6, 10, 12], SHELL_MS = [520, 460, 400, 260, 210], SHELL_PAIRS_FROM = 3, SHELL_PICK_SECS = 8;

askScreens['qm-shell'] = async (ctx, ask) => {
  const a = ask as unknown as ShellAsk;
  const counts = a.bowls?.length ? a.bowls : [3, 4, 5, 6, 7], per = a.per || 20, all = a.all ?? 20, hold = a.hold || 3;
  cnPreload('kick', 'cheer', 'boo', 'coins', 'ko');
  const o = stage(ctx, 'qmg-g-shell', `
    <div class="qmg-shake"><div class="qmg-pic"><div class="qmg-bowls"></div></div></div>
    <div class="qmg-fx"></div>
    <div class="qmg-round"></div>
    <div class="cn-frame qmg-shell-say"><div class="cn-lbl"></div></div>
    ${HUD('十字坡', '孫二娘說哪碗沒下藥，盯緊它！')}`, QM_THEME.slot);
  hudWho(o, a.p);
  const pic = o.$('.qmg-pic'), layer = o.$('.qmg-bowls'), fx = o.$('.qmg-fx');
  const kind = () => (o.tall() ? 'tall' : 'wide') as 'wide' | 'tall';
  const setPic = () => { pic.style.backgroundImage = `url(${ART}/shell-${kind()}.webp)`; };
  setPic();
  cover(o, pic, () => (o.tall() ? 1067 / 1600 : 1600 / 1067));
  const sayLine = (html: string) => { o.$('.qmg-shell-say .cn-lbl').innerHTML = html; };
  const roundLine = (text: string) => { const r = o.$('.qmg-round'); r.textContent = text; r.animate([{ transform: 'translateX(-50%) scale(1.5)', opacity: 0 }, { transform: 'translateX(-50%) scale(1)', opacity: 1 }], { duration: 260 }); };
  o.$('.qmg-clock').style.visibility = 'hidden';

  // the bowls: slot k of n along the table; each bowl element keeps whether it is the safe one
  interface Bowl { el: HTMLElement; slot: number; safe: boolean }
  let bowls: Bowl[] = [], n = 0;
  const rows = () => (SHELL_TABLE[kind()].back && n >= SHELL_TWO_ROWS ? 2 : 1);
  /** Slot k: in one row left to right; in two rows zigzag — even slots the front row, odd ones the back row, each spread evenly. */
  const slotXY = (k: number) => {
    const t = SHELL_TABLE[kind()];
    if (rows() === 1) return { x: t.x0 + ((t.x1 - t.x0) * (k + 0.5)) / n, y: t.y };
    const back = k % 2 === 1, count = back ? Math.floor(n / 2) : Math.ceil(n / 2), c = Math.floor(k / 2);
    return { x: t.x0 + ((t.x1 - t.x0) * (c + 0.5)) / count, y: back ? t.back : t.y };
  };
  const bowlW = () => { const t = SHELL_TABLE[kind()]; return Math.min(t.w, ((t.x1 - t.x0) / Math.ceil(n / rows())) * 0.86); };
  const place = (b: Bowl) => { const s = slotXY(b.slot); Object.assign(b.el.style, { left: `${s.x * 100}%`, top: `${s.y * 100}%`, width: `${bowlW() * 100}%`, zIndex: String(Math.round(s.y * 100)) }); };
  o.flip.push(() => { setPic(); bowls.forEach(place); });
  const lay = (count: number) => {
    layer.innerHTML = ''; n = count;
    const safe = Math.floor(Math.random() * count);
    bowls = Array.from({ length: count }, (_, k) => {
      const el = document.createElement('div');
      el.className = 'qmg-bowl';
      el.innerHTML = `<img src="${ART}/shell-bowl.webp" alt="" draggable="false"><i></i>`;
      layer.append(el);
      const b = { el, slot: k, safe: k === safe };
      place(b);
      el.animate([{ transform: 'translate(-50%,-100%) translateY(-60px)', opacity: 0 }, { transform: 'translate(-50%,-100%)', opacity: 1 }], { duration: 260, delay: k * 60, easing: 'ease-out', fill: 'backwards' });
      return b;
    });
  };
  /** Two bowls trade places along two arcs (one over, one under), `ms` long. */
  const swap = (b1: Bowl, b2: Bowl, ms: number) => {
    const w = parseFloat(pic.style.width) || o.W(), h = parseFloat(pic.style.height) || o.H();
    const p1 = slotXY(b1.slot), p2 = slotXY(b2.slot);
    const dx = (p2.x - p1.x) * w, dy = (p2.y - p1.y) * h, lift = Math.min(90, Math.hypot(dx, dy) * 0.35 + 24);
    const go = (b: Bowl, x: number, y: number, up: number) => b.el.animate([{ transform: 'translate(-50%,-100%)' }, { transform: `translate(calc(-50% + ${x / 2}px), calc(-100% + ${y / 2 + up}px))` }, { transform: `translate(calc(-50% + ${x}px), calc(-100% + ${y}px))` }],
      { duration: ms, easing: 'ease-in-out' }).finished;
    return Promise.all([go(b1, dx, dy, -lift), go(b2, -dx, -dy, lift * 0.5)]).then(() => { const t = b1.slot; b1.slot = b2.slot; b2.slot = t; place(b1); place(b2); });
  };
  const shuffle = async (r: number) => {
    const ms = SHELL_MS[r] ?? 220;
    for (let i = 0; i < (SHELL_SWAPS[r] ?? 13) && !o.closed; i++) {
      const order = [...bowls].sort(() => Math.random() - 0.5);
      const pairs = r >= SHELL_PAIRS_FROM && n >= 4 ? [[order[0], order[1]], [order[2], order[3]]] : [[order[0], order[1]]];
      cnSound('kick', 0.35);
      await Promise.all(pairs.map(([x, y]) => swap(x, y, ms * Math.max(0.7, ctx.scale()))));
    }
  };
  const pick = () => new Promise<Bowl | null>(res => {
    let done = false;
    const t0 = performance.now();
    o.$('.qmg-clock').style.visibility = '';
    const end = (b: Bowl | null) => { if (done) return; done = true; clearInterval(tick); bowls.forEach(x => x.el.classList.remove('can')); o.$('.qmg-clock').style.visibility = 'hidden'; res(b); };
    bowls.forEach(b => { b.el.classList.add('can'); b.el.onpointerdown = e => { e.preventDefault(); e.stopPropagation(); audio.ui('yes'); end(b); }; });
    const tick = window.setInterval(() => { const left = SHELL_PICK_SECS - (performance.now() - t0) / 1000; showClock(o, left, SHELL_PICK_SECS); if (left <= 0) end(null); }, 100);
    showClock(o, SHELL_PICK_SECS, SHELL_PICK_SECS);
    o.onClose.push(() => end(null));
  });
  const at = (b: Bowl) => {
    const r = b.el.getBoundingClientRect(), sr = o.ov.scene.getBoundingClientRect(), k = sr.width / o.W();
    return { x: (r.left + r.width / 2 - sr.left) / k, y: (r.top + r.height * 0.3 - sr.top) / k };
  };

  await intro(o, '十字坡　孫二娘的鬼手', ['孫二娘指著一碗說：<b>「只有這碗沒下蒙汗藥」</b>，然後飛快地換碗',
    `盯緊那一碗，換完了<b>點它</b>：喝對了得 <b>${per} 點券</b>，進下一局`, `第一局 ${counts[0]} 碗，每局多一碗、換得更快，共 ${counts.length} 局；全中再加 ${all}，最多 <b>${counts.length * per + all} 點券</b>`,
    `喝錯就倒：撐過 <b>${hold} 局</b>人還在梁山，不到 ${hold} 局醒來已在汴京、住院 2 天`]);
  if (o.closed) return { cleared: 0 };
  let cleared = 0;
  for (let r = 0; r < counts.length && !o.closed; r++) {
    roundLine(`第 ${r + 1} 局　${counts[r]} 碗`);
    lay(counts[r]);
    await wait(500);
    const safe = bowls.find(b => b.safe)!;
    safe.el.classList.add('shown');
    sayLine('客官，<b>只有這碗</b>沒下蒙汗藥喲～');
    await wait(1500);
    safe.el.classList.remove('shown');
    sayLine('看好囉，換——！');
    await shuffle(r);
    if (o.closed) break;
    sayLine('客官，挑一碗吧！');
    const got = await pick();
    if (o.closed) break;
    safe.el.classList.add('shown');
    if (got?.safe) {
      cleared += 1;
      const p = at(got);
      burst(fx, p.x, p.y, 220);
      float(fx, p.x, p.y - 40, `+${per}`);
      cnSound('coins', 0.7);
      showScore(o, cleared * per);
      sayLine(cleared < counts.length ? '好眼力！再來——' : '哎喲，五碗全讓你喝了！');
      await wait(900);
    } else {
      if (got) got.el.classList.add('bad');
      sayLine(got ? '嘻嘻，倒也、倒也！' : '不挑？那就這碗吧——倒也！');
      cnSound('ko', 0.9);
      o.ov.scene.classList.add('dizzy');
      shake(o.$('.qmg-shake'), 22, 600);
      await wait(1300);
      break;
    }
  }
  const points = cleared * per + (cleared >= counts.length ? all : 0);
  if (o.closed) return { cleared };
  played = { p: a.p, at: Date.now() };
  if (cleared >= counts.length) await banner(o, true, '五碗全中！', `得 ${points} 點券　留在十字坡`);
  else if (cleared >= hold) await banner(o, false, '中了蒙汗藥…', `撐過 ${cleared} 局　得 ${points} 點券　人還在梁山`);
  else await banner(o, false, '中了蒙汗藥…', `${points ? `得 ${points} 點券　` : ''}醒來已在汴京　住院 2 天`);
  if (open === o) shut();
  return { cleared };
};

// ================================================================ the board: a computer's game, 十字坡

interface GameResult { game: 'tiger' | 'boar' | 'wrestle' | 'inn'; ok: boolean; points: number; human?: boolean; /** a loss held out: stays on 梁山 */ held?: boolean; /** 十字坡: rounds read */ cleared?: number }

fxScreens['qm-game-result'] = async (ctx, fx) => {
  const d = (fx.data ?? {}) as unknown as GameResult, p = fx.p ?? 0;
  // this phone's player has just seen it on the game's own screen
  if (played && played.p === p && Date.now() - played.at < 20000) { played = null; return; }
  const name = esc(ctx.game.name(p));
  const after = d.held ? '撐得夠久　人還在梁山' : '進醫院 3 天';
  const said: Record<GameResult['game'], [string, string, string]> = {
    tiger: d.ok ? ['景陽岡打虎', `${name}打虎撐滿15秒`, `得 ${d.points} 點券　留在景陽岡`] : ['景陽岡打虎', `${name}被老虎撲倒了`, `得 ${d.points} 點券　${after}`],
    boar: d.ok ? ['野豬林射野豬', `${name}守住了野豬林`, `得 ${d.points} 點券　留在原地`] : ['野豬林射野豬', `${name}被野豬頂翻了`, `得 ${d.points} 點券　${after}`],
    wrestle: d.ok ? ['相撲擂台', `${name}打贏了燕青！`, `得 ${d.points} 點券　人還在梁山`] : ['相撲擂台', `${name}被燕青摔下擂台`, `得 ${d.points} 點券　${after}`],
    inn: d.ok ? ['十字坡', `${name}識破了孫二娘的鬼手`, `五碗全中　得 ${d.points} 點券`] : d.held ? ['十字坡', `${name}喝到第 ${(d.cleared ?? 3) + 1} 碗才倒`, `得 ${d.points} 點券　人還在梁山`] : ['十字坡', `${name}喝了孫二娘的蒙汗酒`, `${d.points ? `得 ${d.points} 點券　` : ''}醒來已在汴京　住院 2 天`],
  };
  const [title, big, small] = said[d.game] ?? said.inn;
  const bg = d.game === 'tiger' ? 'tiger' : d.game === 'boar' ? 'forest' : d.game === 'wrestle' ? 'stage' : 'inn';
  const o = stage(ctx, 'qmg-board', `
    <div class="qmg-pic"></div>
    ${d.game === 'boar' ? `<img class="qmg-board-boar" src="${ART}/boar-3.webp" alt="">` : ''}
    <div class="qmg-board-figs"></div>
    <div class="qmg-board-panel ${d.ok ? 'good' : 'bad'}">
      <div class="cn-frame qmg-title"><div class="cn-lbl">${title}</div></div>
      <div class="cn-card qmg-board-card">${faceImg(ctx, p, 'qmg-board-face', d.ok ? 7 : 2)}<div><b>${big}</b><span>${small}</span></div></div>
    </div>`);
  o.ov.scene.classList.add(`qmg-for-${d.game}`);
  // the player's 立繪 (and 燕青's) above the panel, at one scale
  const pose: Pose = !d.ok ? 'down' : d.game === 'boar' ? 'bow' : d.game === 'inn' ? 'down' : 'push';
  const me = figure(ctx, p, pose, 'qmg-board-me', 0.9), figs = o.$('.qmg-board-figs');
  figs.append(me.box);
  const him = d.game === 'wrestle' ? figure(ctx, -1, d.ok ? 'down' : 'win', 'qmg-board-yan', 0.9) : null;
  if (him) figs.append(him.box);
  const placeFigs = () => {
    const tall = o.tall(), k = tall ? 0.75 : 0.9, y = tall ? 1090 : 555;
    me.scale(k); me.stand(tall ? 270 : 430, y);
    if (him) { him.scale(k); him.stand(tall ? 650 : 1130, y); }
  };
  placeFigs();
  o.flip.push(placeFigs);
  const pic = o.$('.qmg-pic');
  const setPic = () => { pic.style.backgroundImage = `url(${ART}/${bg}${bg === 'inn' ? '' : o.tall() ? '-tall' : '-wide'}.webp)`; };
  setPic();
  cover(o, pic, () => (bg === 'inn' ? 1.5 : o.tall() ? 1024 / 1536 : 1536 / 1024));
  o.flip.push(setPic);
  audio.ui(d.ok ? 'yes' : 'no');
  if (d.ok) cnSound('cheer', 0.5); else cnSound('boo', 0.4);
  await new Promise<void>(res => {
    let done = false;
    const end = () => { if (done) return; done = true; clearTimeout(t); res(); };
    const t = window.setTimeout(end, Math.max(1800, 2800 * ctx.scale()));
    setTimeout(() => o.ov.root.addEventListener('pointerdown', end), 300);
    o.onClose.push(end);
  });
  if (open === o) shut();
};
