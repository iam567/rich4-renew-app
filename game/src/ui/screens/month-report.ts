/**
 * The monthly bank report on the first of every month (fcn_00439bfa and its window procedure fcn_00437e61,
 * docs/rules/09 §7.12, 02 §8.5): the bank girl of Panel #25 announces the 10% interest, every living player's
 * deposit and interest are listed, then she names 本月悲情人物 and 本月冠軍 under a spotlight on the stage with
 * their Data #417+2c / #416+2c animation and a stats board. Positions are the original's 640×480 pixels.
 * A tap ends the current line or wait (as a click does in the original); the 跳過 button ends the whole report.
 */
import type { GameEvent } from '../../core/types';
import type { MonthReport } from '../../core/game';
import { playerName } from '../../core/characters';
import { month } from '../../core/date';
import type { Frame } from '../sprites';
import { fxScreens, type ScreenContext } from './registry';
import { el, money, openScene, preload, type Scene } from './place-scene';
import { audio, Sfx, Theme } from '../audio';
import { eraLine, eraOn } from '../era-line';
import { centreWords } from '../bubble-text';
import './month-report.css';

type Fx = Extract<GameEvent, { t: 'fx' }>;

/** The girl's lines (voices #0092-#0122, strings 0x464d60..0x464e66). */
const LINES = {
  hello: '各位客戶辛苦了！\n又到了每月銀行\n結算的日子。',
  interest: '大富翁銀行將\n根據您的存款，\n加發１０％的儲金利息。',
  unlucky: '本月悲情人物是．．。',
  cheer: '別灰心，\n再加油喔！', // one line in the original: two fit the round balloon's body
  champion: '本月冠軍是．．。',
  others: '其他人還要\n更努力喔！',
};

/** By number of living players (tables 0x475928 / 0x475940 / 0x475958 / 0x475970; 1 is the remake's). */
const PLAQUE_Y: Record<number, number[]> = { 1: [240], 2: [120, 360], 3: [100, 240, 380], 4: [60, 180, 300, 420] };
const STAND_X: Record<number, number[]> = { 1: [407], 2: [407, 490], 3: [324, 407, 490], 4: [324, 407, 490, 573] };
const SPOT_X: Record<number, number[]> = { 1: [334], 2: [334, 414], 3: [259, 334, 414], 4: [259, 334, 414, 494] };
const SPOT_F: Record<number, number[]> = { 1: [16], 2: [16, 17], 3: [15, 16, 17], 4: [15, 16, 17, 18] };
/** The stage line the standing figures (#25.47+3c) stand on: y = 330 − height + anchor. */
const BASE = 330;
/**
 * Per character (0x4759f7, 24 bytes): champion animation dx, dy, flags; unlucky animation dx, dy, flags. The
 * animation's top-left is (stand x + dx, 330 + dy); flags bits 8-15 = times played (fcn_0045144f, 11 §0.1).
 */
const FLC_AT = [
  [-50, -94, 0x603, -77, -148, 3], [-48, -97, 0x403, -48, -90, 0x603], [-38, -97, 0x603, -50, -87, 0x603],
  [-31, -61, 0x603, -64, -109, 0x303], [-41, -87, 0x403, -42, -77, 0x603], [-44, -76, 0x403, -31, -60, 0x203],
  [-36, -100, 0x603, -36, -103, 0x603], [-50, -89, 0x403, -50, -87, 3], [-51, -90, 0x403, -51, -92, 3],
  [-31, -60, 0x403, -51, -95, 0x303], [-103, -188, 0x403, -39, -87, 0x603], [-40, -75, 0x403, -40, -75, 0x403],
];

/**
 * The girl's pictures (Panel #25 frame at (x, y)) and the original's eye / mouth patches drawn over them
 * (jump tables 0x437e35 / 0x437e49): blink frames then the eyes put back (`rest`, or the picture's own pixels);
 * the mouth opens with `open` (pose #19: 50% its own pixels) and closes with `closed`.
 */
interface Pose {
  frame: number; x: number; y: number;
  eyes?: { x: number; y: number; blink: number[]; rest?: number; gaze?: boolean };
  mouth?: { x: number; y: number; open: number; closed: number; either?: boolean };
}
const POSES: Record<number, Pose> = {
  19: { frame: 19, x: 24, y: 70, eyes: { x: 76, y: 120, blink: [21, 20, 21] }, mouth: { x: 76, y: 160, open: 22, closed: 23, either: true } },
  24: { frame: 24, x: 28, y: 70, eyes: { x: 103, y: 120, blink: [28, 27, 28], rest: 25, gaze: true }, mouth: { x: 103, y: 155, open: 30, closed: 29 } },
  32: { frame: 32, x: 35, y: 67, eyes: { x: 87, y: 118, blink: [34, 33, 34] }, mouth: { x: 87, y: 161, open: 35, closed: 36 } },
  37: { frame: 37, x: 0, y: 89 },
  38: { frame: 38, x: 17, y: 65, eyes: { x: 83, y: 123, blink: [39, 40, 39] } },
  42: { frame: 42, x: 27, y: 64, mouth: { x: 90, y: 134, open: 44, closed: 43 } },
  45: { frame: 45, x: 6, y: 60 },
};
/**
 * Speech balloons (fcn_0044ec30): frame at (x, y). The original centres its 20 px text on the frame's centre +
 * (0, −30) / (0, 20) / (0, 20); here it is centred on the balloon's body (bubble-text.ts), which the tails of the
 * round and heart balloons (left) and the box's (down) push off the frame's centre.
 */
const BALLOONS: Record<number, { x: number; y: number }> = {
  1: { x: 190, y: 10 },
  3: { x: 190, y: 10 },
  4: { x: 213, y: 37 },
};

interface View {
  pose: number;
  balloon: { frame: number; text: string } | null;
  /** intro: neutral faces (#25.47+3c) on the right; deposits: happy faces (49+3c) and the plaques; stage: the line-up. */
  phase: 'intro' | 'deposits' | 'stage';
  spot: number;
  /** Row not standing on the stage (its animation plays there instead). */
  away: number;
  stats: 'unlucky' | 'champion' | null;
  flc: { id: number; frame: number; x: number; y: number } | null;
}

/**
 * Frames #25.24 (the girl with the pen) and #25.15-18 (the spotlight columns) carry the original background
 * baked in, drawn opaque over the background (fcn_004563f5). Once the background is redrawn they would show as
 * rectangles: a frame whose four corners are opaque is replaced (#25.31, the same pose without background, one
 * pixel lower; a drawn light beam).
 */
const baked = new Map<string, Promise<boolean>>();
function hasBakedBg(src: string | undefined): Promise<boolean> {
  if (!src) return Promise.resolve(false);
  let p = baked.get(src);
  if (!p) {
    p = new Promise<boolean>(res => {
      const im = new Image();
      im.onload = () => {
        try {
          const c = document.createElement('canvas');
          c.width = im.naturalWidth; c.height = im.naturalHeight;
          const g = c.getContext('2d', { willReadFrequently: true })!;
          g.drawImage(im, 0, 0);
          const dx = Math.max(1, Math.round(c.width * 0.03)), dy = Math.max(1, Math.round(c.height * 0.03));
          const corners = [[dx, dy], [c.width - 1 - dx, dy], [dx, c.height - 1 - dy], [c.width - 1 - dx, c.height - 1 - dy]];
          res(corners.every(([x, y]) => g.getImageData(x, y, 1, 1).data[3] > 128));
        } catch { res(false); }
      };
      im.onerror = () => res(false);
      im.src = src;
    });
    baked.set(src, p);
  }
  return p;
}

/**
 * The spotlight drawn in place of #25.15-18 (142×348 at (SPOT_X, 0)): a soft cone from the top of the stage to a
 * pool of light on the stage line (y 330) where the figure stands, with blurred edges and a faint halo.
 */
const BEAM = `<svg viewBox="0 0 142 348" width="142" height="348" aria-hidden="true">
  <defs>
    <linearGradient id="mrb-v" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fffdf0" stop-opacity=".95"/><stop offset=".6" stop-color="#fff8dc" stop-opacity=".62"/>
      <stop offset="1" stop-color="#fff4c8" stop-opacity=".5"/></linearGradient>
    <linearGradient id="mrb-h" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".9"/>
      <stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
    <radialGradient id="mrb-pool"><stop offset="0" stop-color="#fff" stop-opacity="1"/><stop offset=".6" stop-color="#fffbe0" stop-opacity=".75"/>
      <stop offset="1" stop-color="#fff6c8" stop-opacity="0"/></radialGradient>
    <filter id="mrb-blur" x="-30%" y="-10%" width="160%" height="120%"><feGaussianBlur stdDeviation="4"/></filter>
    <filter id="mrb-glow" x="-50%" y="-10%" width="200%" height="120%"><feGaussianBlur stdDeviation="10"/></filter>
  </defs>
  <polygon points="50,-6 92,-6 142,334 0,334" fill="#fffbe0" opacity=".28" filter="url(#mrb-glow)"/>
  <g filter="url(#mrb-blur)">
    <polygon points="58,-6 84,-6 130,330 12,330" fill="url(#mrb-v)"/>
    <polygon points="64,-6 78,-6 102,330 40,330" fill="url(#mrb-h)"/>
  </g>
  <ellipse cx="71" cy="330" rx="68" ry="16" fill="url(#mrb-pool)"/>
</svg>`;

function report(ctx: ScreenContext, fx: Fx): Promise<void> {
  const g = ctx.game;
  const rep = fx.data as unknown as MonthReport;
  const rows = rep.rows;
  const n = Math.min(4, Math.max(1, rows.length));
  const unl = rep.unlucky, champ = rep.champion;
  /** 激情歲月's cloth banner: a red 橫幅 with tie ends, the words evenly spaced in big white upright strokes. */
  const banner = (text: string) => `<div class="mr-cloth"><i class="tie l"></i><div class="mr-cloth-words">${[...text].map(c => `<b>${c}</b>`).join('')}</div><i class="tie r"></i></div>`;
  const eraMonth = () => eraLine(`${month(g.date)}月份 銀行結算`).replace(/ .*$/, '');
  const view: View = { pose: 19, balloon: null, phase: 'intro', spot: -1, away: -1, stats: null, flc: null };
  const flcFrames = new Map<number, Frame[]>();
  const flcIds = [416 + 2 * (rows[champ]?.character ?? 0), ...(unl >= 0 && unl !== champ ? [417 + 2 * rows[unl].character] : [])];
  for (const id of flcIds) void ctx.bank.ready('Data', id).then(f => { if (f) flcFrames.set(id, f); });
  const hdBg = !!ctx.bank.art('Panel', 25, 0)?.hd;
  /** Background baked into the frame while the background itself is not the original's (see hasBakedBg). */
  const swapped = new Set<number>();
  const checkBaked = async () => {
    if (!ctx.bank.art('Panel', 25, 0)?.hd) return;
    await Promise.all([24, 15, 16, 17, 18].map(async f => { if (await hasBakedBg(ctx.bank.art('Panel', 25, f)?.src)) swapped.add(f); }));
  };
  const srcs: (string | undefined)[] = [0, 1, 2, 3, 4, 11, 12, 13, 14, 15, 16, 17, 18, 19, 24, 32, 37, 38, 42, 45]
    .map(f => ctx.bank.art('Panel', 25, f)?.src);
  for (const r of rows) for (const k of [47, 49]) srcs.push(ctx.bank.art('Panel', 25, k + 3 * r.character)?.src);

  // fcn_004549cf(9): the report plays MIDI10; the sounds are table 0x475b17 = Effect #27, #28, #60.
  audio.theme(Theme.monthly);
  return new Promise<void>(resolve => {
    let scene: Scene | null = null;
    let world: HTMLElement | null = null;
    let eyesEl: HTMLImageElement | null = null, mouthEl: HTMLImageElement | null = null;
    let flcCanvas: HTMLCanvasElement | null = null;
    const timers = new Set<number>();
    /** Things that already popped in: a later redraw shows them still. */
    const shown = new Set<string>();
    const pop = (key: string) => (shown.has(key) ? '' : (shown.add(key), ' pl-pop'));
    let skip: (() => void) | null = null;
    let done = false;
    // Patch animation state (0x48c42c flags, 0x48c42b mouth hold).
    let flags = 0, hold = 0;

    const after = (ms: number, fn: () => void) => { const t = window.setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); return t; };
    /** Waits ms × game speed; a tap ends it. */
    const wait = (ms: number) => new Promise<void>(res => {
      if (done) return res();
      const end = () => { if (skip === end) skip = null; clearTimeout(t); res(); };
      const t = after(ms * ctx.scale(), end);
      skip = end;
    });
    const finish = () => {
      if (done) return;
      done = true;
      for (const t of timers) clearTimeout(t);
      timers.clear();
      audio.stopVoice();
      scene?.close();
      audio.restore();
      resolve();
    };

    const hdGirl = (pose: number) => !!ctx.bank.art('Panel', 25, POSES[pose].frame)?.hd || (POSES[pose].frame === 24 && swapped.has(24));
    const patch = (slot: 'eyes' | 'mouth', frame: number | null, x = 0, y = 0) => {
      const s = scene;
      if (!s || !world) return;
      const old = slot === 'eyes' ? eyesEl : mouthEl;
      old?.remove();
      const img = frame === null ? null : s.art('Panel', 25, frame, x, y, 'mr-patch', world);
      if (slot === 'eyes') eyesEl = img; else mouthEl = img;
    };
    /** One 100 ms tick of the original's girl animation (only over the original art). */
    const tick = () => {
      const p = POSES[view.pose];
      if (!p || hdGirl(view.pose)) return;
      if (!(flags & 0xf)) { const r = Math.floor(Math.random() * 32); if (r === 0) flags |= 1; else if (r === 1) flags |= 2; }
      if ((flags & 0xf) === 1) {
        const step = (flags >> 4) & 3;
        if (!p.eyes) flags = 0;
        else if (step === 3) { patch('eyes', p.eyes.rest ?? null, p.eyes.x, p.eyes.y); flags = 0; }
        else { patch('eyes', p.eyes.blink[step], p.eyes.x, p.eyes.y); flags += 0x10; }
      } else if ((flags & 0xf) === 2) {
        // Pose #24 looks the other way now and then (frames 25 / 26).
        const b = Math.random() < 0.5 ? 0 : 1;
        if (p.eyes?.gaze && b !== flags >> 6) { patch('eyes', 25 + b, p.eyes.x, p.eyes.y); flags |= b << 6; }
        flags &= 0x40;
      }
      if (p.mouth && (view.balloon || hold)) {
        if (hold) { if (--hold === 0) patch('mouth', p.mouth.closed, p.mouth.x, p.mouth.y); }
        else if (Math.random() < 0.25) {
          patch('mouth', p.mouth.either && Math.random() < 0.5 ? null : p.mouth.open, p.mouth.x, p.mouth.y);
          hold = 1 + Math.floor(Math.random() * 8);
        }
      }
    };

    /** Draws the scene for the current view (called after every step and on rotation). */
    const render = () => {
      const s = scene;
      if (!s || done) return;
      const P = s.portrait;
      s.stage.replaceChildren();
      s.layer = s.stage;
      eyesEl = mouthEl = null; flags = 0; hold = 0;
      world = P ? s.box('mr-world', 0, 0, 640, 480) : s.stage;
      if (P) world.style.transform = `scale(${440 / 640})`;
      const W = world;
      s.art('Panel', 25, 0, 0, 0, 'mr-bg', W);
      // 激情歲月 (docs/rules/24 §11): the meeting's cloth banner (橫幅) across the whole top of the stage; the girl's
      // balloons sit lower on this map so it is never covered (portrait: the banner is the title under the scene).
      if (eraOn() && !P) s.box('mr-banner', 0, 0, 640, 58, banner(`熱烈慶祝${eraMonth()}先進工作者評比大會`), W);
      if (view.phase === 'stage' && view.spot >= 0) {
        const f = SPOT_F[n][view.spot];
        // Over the redrawn background the columns' baked-in pattern would show as a panel: always the drawn beam.
        if (hdBg || swapped.has(f)) {
          const key = `beam${view.spot}`, fresh = !shown.has(key);
          shown.add(key);
          s.box(`mr-beam${fresh ? ' in' : ''}`, SPOT_X[n][view.spot], 0, 142, 348, BEAM, W);
        }
        else s.art('Panel', 25, f, SPOT_X[n][view.spot], 0, 'mr-spot', W);
      }
      const pose = POSES[view.pose];
      if (pose.frame === 24 && swapped.has(24)) s.art('Panel', 25, 31, pose.x, pose.y + 1, 'mr-girl', W);
      else s.art('Panel', 25, pose.frame, pose.x, pose.y, pose.frame === 24 ? 'mr-girl baked' : 'mr-girl', W);
      // The deposit column (landscape; in portrait it is the list under the scene).
      if (view.phase !== 'stage' && !P) {
        rows.forEach((r, i) => {
          const y = PLAQUE_Y[n][i];
          s.art('Panel', 25, (view.phase === 'intro' ? 47 : 49) + 3 * r.character, 600, y, 'mr-icon', W);
          if (view.phase === 'deposits') plaque(s, r, i, 360, y - 36, 160, 71, W);
        });
      }
      if (view.phase === 'stage') {
        rows.forEach((r, i) => {
          if (i === view.away) return;
          const f = 47 + 3 * r.character, a = ctx.bank.art('Panel', 25, f);
          if (a) s.art('Panel', 25, f, STAND_X[n][i], BASE - a.h + a.ay, 'mr-stand', W);
        });
        if (view.flc) {
          flcCanvas = el('canvas', 'mr-flc');
          Object.assign(flcCanvas.style, { left: `${view.flc.x}px`, top: `${view.flc.y}px` });
          W.append(flcCanvas);
          drawFlc();
        }
      }
      if (view.stats && !P) stats(s, 440, 405, 1, W);
      if (view.balloon) {
        const b0 = BALLOONS[view.balloon.frame], b = eraOn() && !P ? { x: b0.x, y: b0.y + 66 } : b0, a = ctx.bank.art('Panel', 25, view.balloon.frame);
        const w = a?.w ?? 290, h = a?.h ?? 200;
        const box = s.box(`mr-balloon f${view.balloon.frame}${pop(`b${view.balloon.frame}:${view.balloon.text}`)}`, b.x, b.y, w, h, '', W);
        if (a) box.style.backgroundImage = `url('${a.src}')`;
        const said = eraLine(view.balloon.text);
        // (本月勞動模範 too in the ordinary balloon lettering — the user 2026-10-22: only the meeting's banner is big.)
        const t = el('div', 'mr-say', said.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!));
        centreWords(t, `Panel/25/${view.balloon.frame}`);
        box.append(t);
      }
      if (P) {
        // Under the scene: the month's title or the stats board, then everyone's deposit.
        if (view.stats) stats(s, 220, 405, 1.42, s.stage);
        else if (eraOn()) s.box('mr-title era', 0, 342, 440, 126, `${banner(`${eraMonth()}先進工作者評比大會`)}<span>${eraLine('大富翁銀行・存款加發 10% 利息')}</span>`);
        else s.box('mr-title', 0, 342, 440, 126, `<b>${month(g.date)}月份 銀行結算</b><span>大富翁銀行・存款加發 10% 利息</span>`);
        const top = 480 + (316 - n * 78) / 2;
        rows.forEach((r, i) => {
          const y = top + i * 78;
          s.box(`mr-row${view.phase === 'stage' && i === view.spot ? ' on' : ''}`, 6, y, 428, 74);
          s.art('Panel', 25, (view.phase === 'intro' ? 47 : 49) + 3 * r.character, 46, y + 38, 'mr-icon');
          if (view.phase !== 'intro') plaque(s, r, i, 90, y + 2, 338, 70, s.stage, true);
        });
      }
      const btn = el('button', 'candy ghost mr-skip', '跳過');
      btn.onpointerup = e => { e.stopPropagation(); finish(); };
      Object.assign(btn.style, P ? { right: '10px', top: '8px' } : { left: '8px', bottom: '6px' });
      s.stage.append(btn);
    };

    /** A deposit plaque (#25.11+i, the text the original writes into it: 存款 / 利息 or a red 貸款中). */
    const plaque = (s: Scene, r: MonthReport['rows'][number], i: number, x: number, y: number, w: number, h: number, parent: HTMLElement, big = false) => {
      const a = ctx.bank.art('Panel', 25, 11 + i);
      const box = s.box(`mr-plaque${big ? ' big' : ''}${pop(`p${i}`)}`, x, y, w, h, '', parent);
      if (a) box.style.backgroundImage = `url('${a.src}')`;
      box.title = `${playerName(ctx.game.players[r.p])}：存款 ${money(r.bank)} → ${money(r.after)} 元`;
      box.innerHTML = `<span class="mr-l l1">存款：</span><span class="mr-v l1">$${money(r.bank)}</span>
        <span class="mr-l l2">利息：</span>${r.loan ? '<span class="mr-v l2 loan">貸款中</span>' : `<span class="mr-v l2">$${money(r.interest)}</span>`}`;
    };
    /**
     * The stats board (#25.2 centred at (440,405)): 16 px lines at (320, 370 + 18k), figures right-aligned to x 560.
     * The original leaves 獲獎原因： blank (a heading for the lines under it); here it names the reason.
     */
    const stats = (s: Scene, cx: number, cy: number, k: number, parent: HTMLElement) => {
      const a = ctx.bank.art('Panel', 25, 2);
      const w = (a?.w ?? 278) * k, h = (a?.h ?? 98) * k;
      const box = s.box(`mr-stats${pop(`s:${view.stats}`)}`, cx - w / 2, cy - h / 2, w, h, '', parent);
      box.style.setProperty('--k', String(k));
      if (a) box.style.backgroundImage = `url('${a.src}')`;
      const u = rep.unluckyStats, c = rep.championStats;
      const lines: [string, string][] = view.stats === 'unlucky' && u
        ? [['獲獎原因：', '本月最倒楣'], ['本月意外損失：', `$${money(u.loss)}`], ['本月意外之財：', `$${money(u.gain)}`], ['本月倒楣天數：', `${u.badDays}天`]]
        : c ? [['獲獎原因：', '總資產最多'], ['現金：', `$${money(c.cash)}`], ['存款：', `$${money(c.bank)}`], ['總資產：', `$${money(c.wealth)}`]] : [];
      box.innerHTML = lines.map(([l, v], j) => `<span class="mr-sl" style="top:${(14 + 18 * j) * k}px">${l}</span><span class="mr-sv" style="top:${(14 + 18 * j) * k}px">${v}</span>`).join('');
    };

    const drawFlc = () => {
      const f = view.flc && flcFrames.get(view.flc.id)?.[view.flc.frame];
      if (!f || !flcCanvas) return;
      if (flcCanvas.width !== f.w || flcCanvas.height !== f.h) { flcCanvas.width = f.w; flcCanvas.height = f.h; }
      Object.assign(flcCanvas.style, { width: `${f.w * f.scale}px`, height: `${f.h * f.scale}px` });
      const c = flcCanvas.getContext('2d');
      c?.clearRect(0, 0, f.w, f.h);
      c?.drawImage(f.img, 0, 0);
    };
    /** The award animation fcn_0045144f: N plays at the FLC's 71 ms, the last frame stays; a tap ends it. */
    const playFlc = async (row: number, id: number, dx: number, dy: number, flagsOf: number) => {
      await Promise.race([ctx.bank.ready('Data', id).then(f => { if (f) flcFrames.set(id, f); }), new Promise(r => after(2500, () => r(null)))]);
      const frames = flcFrames.get(id);
      if (!frames?.length || done) return;
      const flc = { id, frame: 0, x: STAND_X[n][row] + dx, y: BASE + dy };
      view.flc = flc;
      render();
      const plays = ((flagsOf >> 8) & 0xff) || 1;
      let stop = false;
      skip = () => { stop = true; };
      for (let k = 0; k < plays * frames.length && !stop && !done; k++) {
        flc.frame = k % frames.length;
        drawFlc();
        await new Promise<void>(r => after(71, r));
      }
      flc.frame = frames.length - 1;
      drawFlc();
      skip = null;
    };
    /** A balloon line: shown at least 2 s and until its voice ends; a tap ends it (fcn_0044ee18). */
    const line = async (frame: number, text: string, voice: number) => {
      if (done) return;
      view.balloon = { frame, text };
      render();
      const spoken = audio.voice(voice);
      await new Promise<void>(res => {
        let left = 2;
        const one = () => { if (--left === 0) end(); };
        const end = () => { if (skip === end) skip = null; res(); };
        skip = end;
        after(2000 * ctx.scale(), one);
        void spoken.then(one);
      });
      audio.stopVoice();
      view.balloon = null;
      render();
    };
    const set = (v: Partial<View>) => { Object.assign(view, v); render(); };
    const nameOf = (row: number) => playerName(ctx.game.players[rows[row].p]);

    const script = async () => {
      await Promise.all([preload(srcs, 1500), checkBaked()]);
      if (done) return;
      render();
      if (rep.animation) await line(1, LINES.hello, 92);
      set({ pose: 24 });
      await line(1, LINES.interest, 93);
      set({ phase: 'deposits' });
      // 動畫過程 off: the deposits for 3 s, then back to the game (state 2 → 0x16 with 30 ticks).
      if (!rep.animation) { await wait(3000); return finish(); }
      await wait(2000);
      set({ pose: 19, phase: 'stage' });
      await wait(1000);
      if (unl >= 0 && unl !== champ) {
        const c = rows[unl].character, at = FLC_AT[c] ?? FLC_AT[0];
        set({ pose: 32 });
        audio.sfx(Sfx.monthly);
        await line(1, LINES.unlucky, 95);
        set({ pose: 37, spot: unl });
        audio.sfx(Sfx.monthlyHigh);
        await line(1, nameOf(unl), 96 + c);
        set({ pose: 32, stats: 'unlucky', away: unl });
        await playFlc(unl, 417 + 2 * c, at[3], at[4], at[5]);
        set({ pose: 38 });
        await line(3, LINES.cheer, 108);
        set({ pose: 19, spot: -1, stats: null, away: -1, flc: null });
        await wait(1000);
      }
      if (done) return;
      const c = rows[champ]?.character ?? 0, at = FLC_AT[c] ?? FLC_AT[0];
      set({ pose: 38 });
      audio.sfx(Sfx.monthly);
      await line(1, LINES.champion, 109);
      set({ pose: 42, spot: champ });
      audio.sfx(Sfx.monthlyLow);
      await line(1, nameOf(champ), 110 + c);
      set({ stats: 'champion', away: champ });
      await playFlc(champ, 416 + 2 * c, at[0], at[1], at[2]);
      set({ pose: 45 });
      await line(4, LINES.others, 122);
      await wait(1000);
      finish();
    };

    scene = openScene(ctx, 'mr-scene', p => (p ? [440, 800] : [640, 480]), s => {
      scene = s;
      s.every(100, tick);
      render();
    });
    scene.root.addEventListener('pointerup', () => skip?.());
    void script();
  });
}

fxScreens['month-report'] = report;
