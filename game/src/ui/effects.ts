/**
 * Small on-map effects of the original (docs/rules/11): flying objects, FLC clips played at a spot of the map,
 * numbers rising over a head and the speech cloud with an expression face. The board view owns one `Effects`
 * and calls `tick()` once per animation tick (120/80/40 ms) and `draw()` once per frame.
 */
import { ASSETS } from './assets';
import type { Archive, Frame, SpriteBank } from './sprites';
import { decodeCropped, picSize } from './decode';
import { watch } from './watchdog';

/** Frame delays of the Data.mkf FLC clips in ms, from their headers (`fcn_00450ced` reads header +0x10). */
const FLC_DELAY: Record<number, number> = {
  523: 42, 524: 100, 525: 114, 526: 114, 527: 71, 528: 114, 529: 71, 530: 114, 531: 114, 532: 114, 533: 71, 534: 71,
  535: 71, 536: 71, 537: 71, 538: 71, 539: 71, 540: 100, 541: 100, 542: 128, 543: 100, 544: 100, 545: 100, 546: 100,
  547: 100, 548: 100, 549: 100, 550: 71, 551: 100, 552: 71, 553: 57, 554: 85, 555: 71, 556: 71, 557: 71, 558: 42,
};
export const flcDelay = (res: number) => FLC_DELAY[res] ?? (res >= 559 && res <= 570 ? 42 : res >= 416 && res <= 439 ? 71 : 71);

export interface Pt { x: number; y: number }

/** What an effect needs from the board view. */
export interface FxHost {
  readonly bank: SpriteBank;
  readonly ctx: CanvasRenderingContext2D;
  /** Screen px per original px. */
  readonly scale: number;
  readonly rot: number;
  /** World px → CSS px on the canvas. */
  project(x: number, y: number): Pt;
  /** An actor's world position (players 0..3, NPCs 4..7, doll 8). */
  actorPos(id: number): (Pt & { visible: boolean }) | undefined;
}

/** Depth-sorted drawing (08 §4.5): key = screen y × 16 + layer. */
export type AddItem = (sy: number, layer: number, draw: () => void) => void;

interface Effect {
  /** One animation tick (game-speed dependent). */
  tick?(): void;
  /** Draw this frame; `now` is performance.now(). */
  draw(add: AddItem, now: number): void;
  done: boolean;
  end?: () => void;
  /** performance.now() after which it ends whatever happens (an effect never holds the game for good). */
  deadline?: number;
  /** Runs when it ends in any way (a clip's frame callbacks that did not come yet run then). */
  finish?: () => void;
}

/** Layer above everything sorted (flying objects use the fixed key 0x7ff0, 08 §3.5). */
export const TOP = 1e9;

export class Effects {
  private list: Effect[] = [];
  /** How far the frame being drawn is into the current tick (0..1), so flights slide between ticks. */
  alpha = 0;
  constructor(private host: FxHost) {}

  get busy() { return this.list.length > 0; }

  tick() {
    for (const e of this.list) {
      try { e.tick?.(); } catch { e.done = true; }
    }
    this.sweep();
  }

  draw(add: AddItem) {
    const now = performance.now();
    for (const e of this.list) {
      if (e.done) continue;
      if (e.deadline !== undefined && now > e.deadline) { e.done = true; continue; }
      // An effect that cannot draw (its picture gone) ends instead of stopping the frame.
      try { e.draw(add, now); } catch { e.done = true; }
    }
    this.sweep();
  }

  private sweep() {
    if (!this.list.some(e => e.done)) return;
    const gone = this.list.filter(e => e.done);
    this.list = this.list.filter(e => !e.done);
    for (const e of gone) {
      try { e.finish?.(); } catch { /* the wait below must still end */ }
      e.end?.();
    }
  }

  /** Runs an effect until it is done, or at the latest `limit` ms from now. */
  private add(e: Effect, label: string, limit: number): Promise<void> {
    e.deadline = performance.now() + limit;
    return watch(label, new Promise(resolve => { e.end = resolve; this.list.push(e); }));
  }

  /** Ends every running effect now (the watchdog's rescue). */
  finishAll() {
    for (const e of this.list) e.done = true;
    this.sweep();
  }

  /** Draws one sprite frame anchored at a screen point (08 §4.4), with optional alpha. */
  sprite(archive: Archive, res: number, frame: number, sx: number, sy: number, alpha = 1, extra = 1) {
    const f = this.host.bank.board(archive, res)?.[frame];
    if (!f) return;
    this.frame(f, sx, sy, alpha, extra);
  }

  private frame(f: Frame, sx: number, sy: number, alpha = 1, extra = 1) {
    const ctx = this.host.ctx, s = this.host.scale * f.scale * extra;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(f.img, sx - f.ax * s, sy - f.ay * s, f.w * s, f.h * s);
    ctx.restore();
  }

  // ---------------------------------------------------------------- flights

  /**
   * An object sprite flying from one world point to another, `ticks` ticks long, rising `lift` original px at
   * the middle (0 = straight). Drawn over everything (sort key 0x7ff0, 08 §3.5).
   */
  fly(o: { archive?: Archive; res: number; frame?: number; dir?: number; from: Pt; to: Pt; ticks: number; lift?: number; spin?: boolean; fade?: boolean; sorted?: boolean }): Promise<void> {
    const host = this.host;
    let t = 0;
    const e: Effect = {
      done: false,
      tick: () => { if (++t >= o.ticks) e.done = true; },
      draw: (add) => {
        const k = Math.min(1, (t + this.alpha) / o.ticks);
        const x = o.from.x + (o.to.x - o.from.x) * k, y = o.from.y + (o.to.y - o.from.y) * k;
        const q = host.project(x, y), lift = (o.lift ?? 0) * 4 * k * (1 - k) * host.scale;
        const base = o.dir !== undefined ? (o.dir + 8 - host.rot) & 7 : o.frame ?? 0;
        const frame = o.spin ? (base + t) & 7 : base;
        const draw = () => this.sprite(o.archive ?? 'Data', o.res, frame, q.x, q.y - lift, o.fade ? 1 - k * k : 1);
        if (o.sorted) add(q.y, 0xd, draw); else add(TOP, 0, draw);
      },
    };
    return this.add(e, `fx.fly ${o.res}`, o.ticks * 250 + 2000);
  }

  /**
   * `_rich4_animate_object` (animate_object.asm): a sprite moved in a straight line on screen from one world
   * point to another, steps = screen distance / 8 + 1 at 24 ms each (real time, not game ticks), drawn over
   * everything; then `wait` ms with the sprite at the end. `from`/`to` may follow moving points.
   */
  glide(o: { archive?: Archive; res: number; frame?: number; dir?: number; from: Pt | (() => Pt); to: Pt | (() => Pt); wait?: number; lift?: number }): Promise<void> {
    const host = this.host, pt = (v: Pt | (() => Pt)) => (typeof v === 'function' ? v() : v);
    const a0 = pt(o.from), b0 = pt(o.to), qa = host.project(a0.x, a0.y), qb = host.project(b0.x, b0.y);
    // Distance in original screen px (the projection's zoom divided out).
    const dist = Math.hypot(qb.x - qa.x, qb.y - qa.y) / host.scale, steps = Math.trunc(dist * 0.125 + 1), ms = steps * 24;
    let start = -1;
    const e: Effect = {
      done: false,
      draw: (add, now) => {
        if (start < 0) start = now;
        const t = now - start;
        if (t >= ms + (o.wait ?? 0)) { e.done = true; return; }
        // The first drawn position is already one step along.
        const k = Math.min(1, (Math.floor(t / 24) + 1) / steps), kk = Math.min(1, (t + 24) / ms);
        const a = pt(o.from), b = pt(o.to);
        const s = Math.min(k, kk) > 0 ? kk : k;
        const q = host.project(a.x + (b.x - a.x) * s, a.y + (b.y - a.y) * s);
        const lift = (o.lift ?? 0) * 4 * s * (1 - s) * host.scale;
        const frame = o.dir !== undefined ? (o.dir + 8 - host.rot) & 7 : o.frame ?? 0;
        add(TOP, 1, () => this.sprite(o.archive ?? 'Data', o.res, frame, q.x, q.y - lift));
      },
    };
    return this.add(e, `fx.glide ${o.res}`, ms + (o.wait ?? 0) + 2000);
  }

  /**
   * A god leaves (`_rich4_detach_god`, rich4_gods.asm:138-415): from where it was drawn it rises 10 px every
   * 60 ms turning through its 8 facings, at most 24 steps, until it is above the view.
   */
  rise(o: { res: number; frame: number; at: Pt; screenOffset: [number, number] }): Promise<void> {
    const host = this.host;
    let start = -1;
    const e: Effect = {
      done: false,
      draw: (add, now) => {
        if (start < 0) start = now;
        const step = Math.floor((now - start) / 60);
        const q = host.project(o.at.x, o.at.y), z = host.scale;
        const y = q.y + (o.screenOffset[1] - 10 * step) * z;
        if (step >= 24 || y < -60 * z) { e.done = true; return; }
        add(TOP, 1, () => this.sprite('Data', o.res, (o.frame + step) & 7, q.x + o.screenOffset[0] * z, y));
      },
    };
    return this.add(e, `fx.rise ${o.res}`, 24 * 60 + 2000);
  }

  /** A plain timed sprite or drawing callback (e.g. the knocked-down sparkle); resolves after `ms`. */
  hold(ms: number, draw: (add: AddItem, t: number) => void): Promise<void> {
    let start = -1;
    const e: Effect = {
      done: false,
      draw: (add, now) => {
        if (start < 0) start = now;
        if (now - start >= ms) { e.done = true; return; }
        draw(add, now - start);
      },
    };
    return this.add(e, 'fx.hold', ms + 2000);
  }

  // ---------------------------------------------------------------- speech cloud

  /**
   * `_rich4_player_say` (rich4.asm:23534): the cloud Data#517 frame 6 at view (220, 130), the expression face
   * map#(27 + character) frame face + 1 at (170, 130), the text at (200, 130) — or, for '@NN', the icon
   * Data#519 frame NN − 1 at (240, 130) — for 1000 ms. The view is centred on the speaker (camera point
   * (220, 260)), so here everything is placed relative to the speaker's feet. A tap ends it early.
   */
  cloud(at: () => Pt, character: number, face: number, text: string, ms: number, onTap?: (end: () => void) => void): Promise<void> {
    const host = this.host;
    const icon = /^@(\d\d)$/.exec(text);
    const start = performance.now();
    let lines: string[] | null = null;
    const e: Effect = {
      done: false,
      draw: (add, now) => {
        if (now - start >= ms) { e.done = true; return; }
        add(TOP + 1, 0, () => {
          const z = host.scale, ctx = host.ctx, p = at(), q = host.project(p.x, p.y);
          const cw = ctx.canvas.width / (ctx.getTransform().a || 1), ch = ctx.canvas.height / (ctx.getTransform().d || 1);
          // Cloud anchor (220, 130) is 130 px above the speaker; keep the whole cloud on the canvas.
          let cx = q.x, cy = q.y - 130 * z;
          cx = Math.max(130 * z, Math.min(cw - 147 * z, cx));
          cy = Math.max(94 * z, Math.min(ch - 110 * z, cy));
          const k = Math.min(1, (now - start) / 120), pop = 0.85 + 0.15 * (1 - (1 - k) ** 3);
          ctx.save();
          ctx.translate(cx, cy); ctx.scale(pop, pop); ctx.translate(-cx, -cy);
          ctx.globalAlpha = Math.min(1, k * 1.5, (ms - (now - start)) / 120);
          this.sprite('Data', 517, 6, cx, cy);
          this.sprite('map', 27 + character, face + 1, cx - 50 * z, cy, 1, 1.35);
          if (icon) this.sprite('Data', 519, Number(icon[1]) - 1, cx + 20 * z, cy, 1, 1.4);
          else {
            const size = 17 * z;
            ctx.font = `600 ${size}px "Huninn", "PingFang TC", "Noto Sans TC", system-ui, sans-serif`;
            ctx.fillStyle = '#101010';
            ctx.textBaseline = 'middle';
            ctx.textAlign = 'left';
            lines ??= wrap(ctx, text, 150 * z);
            const lh = size * 1.25, top = cy - (lines.length - 1) * lh / 2;
            const x0 = cx - 22 * z;
            lines.forEach((l, i) => ctx.fillText(l, x0, top + i * lh));
          }
          ctx.restore();
        });
      },
    };
    onTap?.(() => { e.done = true; });
    return this.add(e, 'fx.cloud', ms + 2000);
  }

  // ---------------------------------------------------------------- FLC clips

  /**
   * Plays an FLC clip (Data.mkf). The original draws the 440×440 clips over the whole map view with the camera
   * on the spot (`fcn_0045144f(flc, 0, 40, …)`), i.e. clip pixel (220, 220) on the spot; other clips are placed
   * by `origin` (the clip pixel that sits on the spot) plus `offset` in original screen px. Real-time frame
   * delays from the FLC header. `at[frame]` callbacks run when that frame shows (flags bits 16–23: the map
   * under the clip is redrawn with the new state at that frame). `hold` keeps the last frame (ms), with an
   * optional `caption` drawn over it (the god text, `fcn_0040e2a2`).
   */
  async clip(res: number, spot: Pt | (() => Pt), o: {
    origin?: [number, number]; offset?: [number, number]; delay?: number; hold?: number; sorted?: boolean; layer?: number;
    at?: Record<number, () => void>; caption?: string; skippable?: boolean;
    /** Drawn this much larger around the clip's bottom centre (small clips on a high-resolution screen). */
    grow?: number;
  } = {}): Promise<void> {
    const clip = await withTimeout(loadClip(this.host.bank, res), 6000).catch(() => null);
    const fire = (upTo: number) => { for (const k of Object.keys(o.at ?? {})) if (Number(k) <= upTo) { o.at![Number(k)](); delete o.at![Number(k)]; } };
    if (!clip?.frames.length) { fire(1e9); return; }
    const host = this.host, delay = o.delay ?? flcDelay(res), n = clip.frames.length;
    let start = -1, skip = false;
    const e: Effect = {
      done: false,
      finish: () => fire(1e9),
      draw: (add, now) => {
        if (start < 0) start = now;
        const i = skip ? 1e9 : Math.floor((now - start) / delay);
        fire(Math.min(i, n - 1));
        if (i >= n + Math.ceil((o.hold ?? 0) / delay)) { e.done = true; return; }
        const k = Math.min(i, n - 1), img = clip.frames[k], r = clip.rects[k];
        const p = typeof spot === 'function' ? spot() : spot, q = host.project(p.x, p.y), z = host.scale;
        const [ox, oy] = o.origin ?? [clip.w / 2, clip.h / 2];
        const [dx, dy] = o.offset ?? [0, 0];
        const g = o.grow ?? 1, x = q.x + (dx - ox) * z - (g - 1) * clip.w * z / 2, y = q.y + (dy - oy) * z - (g - 1) * clip.h * z;
        const draw = () => {
          const ctx = host.ctx;
          ctx.save();
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          // A cropped frame sits at its place in the clip's square.
          if (r) ctx.drawImage(img, x + r.x * z * g, y + r.y * z * g, r.w * z * g, r.h * z * g);
          else ctx.drawImage(img, x, y, clip.w * z * g, clip.h * z * g);
          if (o.caption && i >= n) caption(ctx, o.caption, q.x, q.y + 200 * z, z);
          ctx.restore();
        };
        if (o.sorted) add(q.y, o.layer ?? 0xe, draw); else add(TOP, o.layer ?? 0, draw);
      },
    };
    if (o.skippable) this.onTap(() => { if (start >= 0 && performance.now() - start > 150) skip = true; });
    return this.add(e, `fx.clip ${res}`, (n + 2) * delay + (o.hold ?? 0) + 3000);
  }

  /** One tap on the map ends skippable effects (set by the board view). */
  onTap: (fn: () => void) => void = () => {};
}

/** The god's words over the last clip frame (`fcn_0040e2a2`): 28 px white with a dark outline, centred, bottom at y. */
function caption(ctx: CanvasRenderingContext2D, text: string, x: number, bottom: number, z: number) {
  const size = 28 * z * 0.9, lh = size * 1.2;
  const lines = text.split('\n');
  ctx.font = `700 ${size}px "Huninn", "PingFang TC", "Noto Sans TC", system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(2, 3 * z);
  ctx.strokeStyle = '#101010';
  ctx.fillStyle = '#fff';
  const maxW = ctx.canvas.width / (ctx.getTransform().a || 1) - 16;
  lines.forEach((l, k) => {
    const y = bottom - (lines.length - 1 - k) * lh;
    ctx.strokeText(l, x, y, maxW); ctx.fillText(l, x, y, maxW);
  });
}

const withTimeout = <T>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<T>((_, no) => setTimeout(() => no(new Error('timeout')), ms))]);

/** Frame counts of the FLC clips (rich4-assets manifest), for the originals that have no redrawn frames. */
const FLC_FRAMES: Record<number, number> = {
  523: 66, 524: 62, 525: 8, 526: 8, 527: 41, 528: 19, 529: 68, 530: 26, 531: 36, 532: 38, 533: 46, 534: 15, 535: 15,
  536: 14, 537: 14, 538: 35, 539: 46, 540: 21, 541: 21, 542: 21, 543: 35, 544: 28, 545: 30, 546: 14, 547: 19, 548: 16,
  549: 12, 550: 23, 551: 15, 552: 18, 553: 68, 554: 90, 555: 10, 556: 14, 557: 22, 558: 40, 559: 34, 560: 35, 561: 34,
  562: 39, 563: 30, 564: 40, 565: 33, 566: 39, 567: 30, 568: 39, 569: 33, 570: 35,
};
/** Sizes in original px (440×440 unless listed). */
const FLC_SIZE: Record<number, [number, number]> = { 524: [440, 74], 526: [110, 110], 536: [28, 40], 537: [31, 39] };

/**
 * A clip's frames, `w`×`h` original px. A redrawn frame is cropped to its visible pixels: `rects[i]` is where it
 * sits in the clip's square (original px); null for a whole frame.
 */
export interface Clip { frames: CanvasImageSource[]; rects: ({ x: number; y: number; w: number; h: number } | null)[]; w: number; h: number }
const clips = new Map<number, Promise<Clip>>();
/** Decoded size of the cached clips: a 440×440 clip at 2× is ~3 MB a frame, 100+ MB for a long one. */
const clipBytes = new Map<number, number>();
const CLIP_BUDGET = 160 * 1024 * 1024;

/**
 * Loads a clip's frames: the 4× redraws (already transparent) scaled to at most 2× the original size, so a
 * 440×440 clip keeps a sharp look without holding hundreds of MB; else the originals with the key colour
 * (pixel 0,0) made transparent. The last few clips stay cached.
 */
export function loadClip(bank: SpriteBank, res: number): Promise<Clip> {
  let c = clips.get(res);
  if (c) { clips.delete(res); clips.set(res, c); return c; }
  c = (async () => {
    const [w, h] = FLC_SIZE[res] ?? [440, 440], n = FLC_FRAMES[res] ?? 0;
    const cap = Math.min(4, Math.max(1, Math.floor(1024 / Math.max(w, h))));
    const rects: Clip['rects'] = [];
    const frames = await Promise.all(Array.from({ length: n }, async (_, i) => {
      const a = bank.art('Data', res, i);
      if (a?.hd) {
        // Decoded off the main thread (a clip is 40+ large frames) and cropped to what shows: a 440×440 clip
        // frame is mostly transparent, and a whole one at 2× is 3 MB to hold and to hand to the GPU.
        const c = await decodeCropped(a.src, { w: w * cap, h: h * cap });
        const sx = w / c.fw, sy = h / c.fh;
        rects[i] = c.w === c.fw && c.h === c.fh ? null : { x: c.x * sx, y: c.y * sy, w: c.w * sx, h: c.h * sy };
        return c.pic;
      }
      rects[i] = null;
      const blob = await (await fetch(`${ASSETS}/orig/Data/${String(res).padStart(4, '0')}-FLC/frame-${String(i).padStart(3, '0')}.png`)).blob();
      return keyOut(await createImageBitmap(blob));
    }));
    return { frames, rects, w, h };
  })();
  clips.set(res, c);
  c.then(clip => {
    clipBytes.set(res, clip.frames.reduce((n, f) => { const { w, h } = picSize(f); return n + w * h * 4; }, 0));
    // Least recently played first, while over the budget (the newest always stays).
    for (const k of clips.keys()) {
      if (k === res || [...clipBytes.values()].reduce((a, b) => a + b, 0) <= CLIP_BUDGET) break;
      clips.delete(k); clipBytes.delete(k);
    }
  }, () => { clips.delete(res); clipBytes.delete(res); });
  while (clips.size > 4) { const k = clips.keys().next().value!; clips.delete(k); clipBytes.delete(k); }
  return c;
}

/**
 * Starts loading clips ahead of their use (a tool chosen, a menu opened, an event about to play), one after the
 * other so they do not crowd out the pictures the board needs now. Already cached ones cost nothing.
 */
export function preloadClips(bank: SpriteBank, ids: number[]): Promise<void> {
  let chain = Promise.resolve();
  for (const id of ids) chain = chain.then(() => loadClip(bank, id).then(() => undefined, () => undefined));
  return chain;
}

/** Whether a clip is decoded and ready to play. */
export function clipReady(res: number): boolean { return clipBytes.has(res); }

/** Original FLC frames keep the palette's key colour as background: make it transparent. */
function keyOut(im: ImageBitmap): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = im.width; c.height = im.height;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(im, 0, 0);
  const data = ctx.getImageData(0, 0, c.width, c.height), px = data.data;
  const [r, g, b] = [px[0], px[1], px[2]];
  for (let i = 0; i < px.length; i += 4) if (px[i] === r && px[i + 1] === g && px[i + 2] === b) px[i + 3] = 0;
  ctx.putImageData(data, 0, 0);
  return c;
}

/** Breaks a line into pieces at most `max` px wide (CJK text breaks anywhere; '\n' always breaks). */
function wrap(ctx: CanvasRenderingContext2D, text: string, max: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    if (!para) continue;
    let line = '';
    for (const ch of para) {
      if (line && ctx.measureText(line + ch).width > max) { out.push(line); line = ''; }
      line += ch;
    }
    if (line) out.push(line);
  }
  return out.length ? out : [''];
}
