/**
 * The wheel (转盘) for hotel days, shopping multiplier, travel days and insurance days over the map — docs/rules/02
 * §4.4, 09 §6.5, rich4.asm fcn_0044090e / fcn_0043f7c6. The original draws, on the map view: the message box
 * Data#517.5 at (220,140) with "%s的旅館\n\n請進來休息..." (or the shopping / travel / insurance line), the wheel
 * Panel#(68 + kind) frame cell + 2 (165×165, anchor centred) at (220,320) and the angel frame 0 at (265,230);
 * when the stop is pressed the angel turns to frame 1 (its wand points at the cell that counts, at about two
 * o'clock). One frame per 36 ms; Effect#52 loops while the wheel turns, the stop clicks UI[1].
 *
 * The rules (core/modules/wheel.ts) replay the loop and send every frame's cell in the 'wheel' fx. A human first
 * gets the 'wheel' question: the wheel turns here from the rules' start cell (one cell per 36 ms, as the original)
 * until a tap or a key release anywhere, which answers the frame of the stop; the same wheel then slows down and
 * stops on the rules' frames. A computer's wheel plays the whole run from frame 0 (the original shows it to
 * everybody; a tap here jumps to the result, and the game speed shortens it).
 *
 * The twelve wheel pictures are the same wheel turned 30° apart, so the remake turns frame 2 (cell 0) smoothly by
 * 30° per cell between the rules' frames instead of swapping pictures: at each frame boundary it shows exactly the
 * cell the original shows.
 */
import type { Ask, GameEvent } from '../../core/types';
import { WHEEL_FRAME_MS, WHEEL_HOLD_FRAMES, WHEEL_TEXT } from '../../core/modules/wheel';
import { askScreens, fxScreens, onStuck, type ScreenContext } from './registry';
import { esc, openScene, preload, type Scene } from './place-scene';
import { audio, Sfx } from '../audio';
import './wheel.css';

type WheelAsk = Extract<Ask, { t: 'wheel' }>;
type Fx = Extract<GameEvent, { t: 'fx' }>;
interface Timeline { cells: number[]; start: number; stop: number; result: number; end: number; value: number; human: boolean }

/** Two layouts in original pixels: box over wheel (as the original), or side by side for wide map areas. */
const BOX = { x: 97, y: 39, w: 249, h: 170 };
/** Wheel (138..303, 238..403) and angel (265..352, 230..291). */
const WHEEL = { x: 138, y: 230, w: 214, h: 173 };
const STACK = { w: 272, h: 384, box: [-88, -30], wheel: [-88, -30] };
const SIDE = { w: 495, h: 189, box: [8 - BOX.x, 10 - BOX.y], wheel: [8 + BOX.w + 16 - WHEEL.x, 8 - WHEEL.y] };
/** What the number means, for the badge in the hub. */
const UNIT = [(v: number) => `${v}天`, (v: number) => `${v}天`, (v: number) => `×${v}`, (v: number) => `${v}天`];

/** The wheel left open by the question for the fx that follows it. */
let live: Wheel | null = null;
/** Every wheel on screen (the hang guard closes them all when it gives up on an event). */
const wheels = new Set<Wheel>();
onStuck(() => { for (const w of [...wheels]) w.close(); });

class Wheel {
  scene!: Scene;
  closed = false;
  private side = false;
  private img: HTMLImageElement | null = null;
  private angel: HTMLImageElement | null = null;
  private hint: HTMLElement | null = null;
  private badge: HTMLElement | null = null;
  private raf = 0;
  /** Time of frame 0 and the length of one frame (ms). */
  private t0 = 0;
  private frameMs = WHEEL_FRAME_MS;
  /** Cells turned so far, counted on from `start` (not wrapped), as drawn. */
  private shown: number;
  /** The human's free spin (before the tap). */
  private waiting = false;
  private stopped = false;
  private landed = false;
  private onTap: (() => void) | null = null;
  /** Answers the human's spin without a stop (the wheel closed before the tap). */
  private unspin: (() => void) | null = null;
  /** The rules' frames: (frame, cells turned) at every move, and the timeline. */
  private moves: [number, number][] = [];
  private t: Timeline | null = null;
  private holdMs = 0;
  private done: (() => void) | null = null;

  constructor(readonly ctx: ScreenContext, readonly kind: number, readonly name: string, readonly start: number) {
    this.shown = start;
  }

  /** Opens the scene once its art is loaded (or after a short wait) and starts the clock at frame 0. */
  async open(frameMs = WHEEL_FRAME_MS) {
    wheels.add(this);
    const id = 68 + (this.kind & 3);
    await preload([0, 1, 2].map(f => this.ctx.bank.art('Panel', id, f)?.src).concat([]), 1500);
    if (this.closed) return;
    const area = this.ctx.area;
    this.scene = openScene(this.ctx, 'wh-scene', () => {
      const W = area.clientWidth || 440, H = area.clientHeight || 440;
      this.side = Math.min(W / SIDE.w, H / SIDE.h) > Math.min(W / STACK.w, H / STACK.h) * 1.08;
      return this.side ? [SIDE.w, SIDE.h] : [STACK.w, STACK.h];
    }, s => this.build(s), { parent: area });
    this.scene.root.addEventListener('pointerup', e => { e.preventDefault(); this.tap(); });
    window.addEventListener('keyup', this.key); // WM_KEYUP counts as a click too
    audio.loop(Sfx.wheel);
    this.frameMs = frameMs;
    this.t0 = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  private build(s: Scene) {
    this.scene = s;
    s.root.classList.toggle('side', this.side);
    const L = this.side ? SIDE : STACK, id = 68 + (this.kind & 3);
    const boxG = s.box('wh-group', L.box[0], L.box[1], 0, 0);
    const wheelG = s.box('wh-group', L.wheel[0], L.wheel[1], 0, 0);
    // The game's own toy message box (blue, dashed, ribbon) instead of the original's Data#517.5 frame:
    // the first line ("阿土伯的購物中心") on the ribbon, the rest ("您的消費倍數為...") inside.
    // A full place name (歌舞伎町's shops: 「阿土伯的居酒屋」) takes the template's first line ('%s的購物中心').
    const text = WHEEL_TEXT[this.kind & 3] ?? '%s';
    const [head, ...rest] = ((this.kind & 3) === 2 && this.name.includes('的') ? text.replace(/^[^\n]*/, this.name) : text.replace('%s', this.name)).split('\n');
    s.box('msg scene-msg wh-panel', 104, 70, 232, 128,
      `<div class="ribbon">${esc(head)}</div><div class="scene-msg-text wh-text">${esc(rest.filter(Boolean).join('\n')).replace(/\n/g, '<br>')}</div>`, boxG);
    this.hint = s.box('wh-hint', 109, 160, 224, 22, '', boxG);
    s.box('wh-shadow', 138, 238, 165, 165, '', wheelG);
    this.img = s.art('Panel', id, 2, 220, 320, 'wh-wheel', wheelG);
    const a = this.ctx.bank.art('Panel', id, 2);
    if (this.img && a) this.img.style.transformOrigin = `${a.ax}px ${a.ay}px`;
    s.box('wh-hub', 220 - 26, 320 - 26, 52, 52, '', wheelG);
    this.badge = s.box('wh-badge', 220 - 40, 320 - 22, 80, 44, '', wheelG);
    this.angel = s.art('Panel', id, this.stopped ? 1 : 0, 265, 230, 'wh-angel', wheelG);
    this.render();
  }

  private render() {
    if (!this.scene || this.closed) return;
    if (this.img) this.img.style.transform = `rotate(${this.shown * 30}deg)`;
    if (this.hint) {
      this.hint.classList.toggle('on', this.waiting);
      this.hint.textContent = this.waiting ? '點一下畫面，停止轉盤！' : '';
    }
    this.img?.classList.toggle('spin', !this.landed);
    if (this.landed && this.badge && !this.badge.textContent && this.t) {
      this.badge.textContent = UNIT[this.kind & 3](this.t.value);
      this.badge.classList.add('on');
      this.scene.root.classList.add('landed');
    }
  }

  /** Cells turned at frame time φ (frames since frame 0 was drawn), continuous between the rules' moves. */
  private turned(phi: number): number {
    if (!this.t) return this.start + 1 + phi; // free spin: one cell per frame, cell start + f + 1 after frame f
    const m = this.moves;
    let prev: [number, number] = [-1, this.start];
    for (let i = 0; i < m.length; i++) {
      const [f, n] = m[i];
      if (phi < f) {
        let k = (phi - prev[0]) / (f - prev[0]);
        if (i === m.length - 1) k = 1 - (1 - k) * (1 - k); // the last cell eases in
        return prev[1] + k * (n - prev[1]);
      }
      prev = m[i];
    }
    return prev[1];
  }

  private frame = (now: number) => {
    if (this.closed) return;
    const phi = (now - this.t0) / this.frameMs;
    const t = this.t;
    // Never turn back (the free spin runs a little ahead of the rules' first slow move).
    this.shown = Math.max(this.shown, this.turned(phi));
    if (t) {
      if (!this.stopped && phi >= t.stop) this.press(false);
      if (!this.landed && phi >= t.result) {
        this.landed = true;
        this.shown = this.moves.length ? this.moves[this.moves.length - 1][1] : this.shown;
        audio.stop(Sfx.wheel);
        this.holdMs = Math.max(this.holdMs, now + WHEEL_HOLD_FRAMES * WHEEL_FRAME_MS * Math.max(0.5, this.ctx.scale()));
      }
      if (this.landed && now >= this.holdMs) { this.render(); this.close(); return; }
    }
    this.render();
    this.raf = requestAnimationFrame(this.frame);
  };

  /** State 2: the angel raises its wand; UI[1]. */
  private press(sound: boolean) {
    if (this.stopped) return;
    this.stopped = true;
    this.waiting = false;
    if (sound || !this.t?.human) audio.ui('click');
    this.scene?.swap(this.angel, 'Panel', 68 + (this.kind & 3), 1);
    this.angel?.classList.add('wave');
  }

  private key = () => this.tap();

  private tap() {
    if (!this.closed) this.onTap?.();
  }

  /** The human's spin: resolves with the stop frame on the first tap; the wheel goes on turning until play(). */
  spin(): Promise<number> {
    this.waiting = true;
    this.render();
    return new Promise(resolve => {
      // Closed before the tap (the hang guard, a new game): no stop of the player's — the rules stop it at frame 39.
      if (this.closed) { resolve(0); return; }
      this.unspin = () => resolve(0);
      this.onTap = () => {
        if (this.stopped) return;
        // The click is seen during the wait after frame f: the stop is frame f + 1 (at least 1).
        const phi = (performance.now() - this.t0) / this.frameMs;
        const stop = Math.max(1, Math.floor(phi) + 1);
        this.press(true);
        this.onTap = null;
        this.unspin = null;
        resolve(stop);
      };
    });
  }

  /** Plays the rules' frames to the end, then closes. */
  play(t: Timeline): Promise<void> {
    if (this.closed) return Promise.resolve();
    this.t = t;
    this.moves = [];
    let n = t.start, prev = t.start;
    t.cells.forEach((c, f) => { if (c !== prev) { n += (c - prev + 12) % 12; this.moves.push([f, n]); prev = c; } });
    if (this.stopped) this.waiting = false;
    // A computer's wheel: a tap jumps to the result; once it rests, a tap closes it (the original's click in state 5).
    this.onTap = () => {
      const now = performance.now(), phi = (now - this.t0) / this.frameMs;
      if (phi >= t.result) this.holdMs = now;
      else if (!t.human) this.t0 = now - t.result * this.frameMs;
    };
    return new Promise(resolve => { this.done = resolve; });
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keyup', this.key);
    audio.stop(Sfx.wheel);
    this.scene?.close();
    if (live === this) live = null;
    wheels.delete(this);
    this.unspin?.();
    this.unspin = null;
    this.done?.();
    this.done = null;
  }
}

askScreens.wheel = async (ctx, a) => {
  const q = a as WheelAsk;
  live?.close();
  const w = new Wheel(ctx, q.kind, q.name, q.start);
  live = w;
  await w.open();
  const stop = await w.spin();
  // Should the rules' frames never come (a new game was loaded meanwhile), the wheel does not stay up.
  setTimeout(() => { if (live === w && !w.closed) w.close(); }, 6000);
  return stop;
};

fxScreens.wheel = async (ctx, fx: Fx) => {
  const d = fx.data ?? {};
  const t: Timeline = {
    cells: (d.cells as number[]) ?? [], start: Number(d.start) || 0, stop: Number(d.stop), result: Number(d.result),
    end: Number(d.end), value: Number(d.value), human: !!d.human,
  };
  if (!t.cells.length) return;
  const kind = Number(d.wheel) & 3;
  let w = live && !live.closed && live.kind === kind ? live : null;
  live = null;
  if (!w) {
    w = new Wheel(ctx, kind, String(d.name ?? ''), t.start);
    // A computer's run follows the game speed (the original's 36 ms frames at the slowest).
    await w.open(WHEEL_FRAME_MS * (t.human ? 1 : Math.max(0.5, ctx.scale())));
  }
  await w.play(t);
};

export {};
