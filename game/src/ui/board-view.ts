/**
 * The board as the original draws it (docs/rules/08): an 8-way rotatable oblique projection of the
 * 2304×2304 ground, with every sprite anchored at its projected world point and drawn in screen-y order.
 * Everything is drawn at the device's real resolution; redrawn (4x) frames are used where they exist.
 */
import { CHARACTERS } from '../core/characters';
import type { Game } from '../core/game';
import { nodeById, worldSize } from '../core/board';
import { month } from '../core/date';
import type { PickSpot, Player } from '../core/types';
import type { MapArt } from './assets';
import type { Archive, Frame, SpriteBank } from './sprites';
import { audio, Sfx } from './audio';
import { Effects, type FxHost } from './effects';
import { describe, InfoBubble } from './map-info';
import { drawForkArrows } from './fork-arrows';
import type { TiledGround } from './ground';
import { GroundCache } from './ground-cache';
import { casinoSprite } from './casino-sprite'; // 大富翁城 (docs/rules/19)
import { kbBadges, kbFigures, kbHouseSprite, kbPadSprite, kbRules, kbShopSprite, KbStreet } from './kabukicho'; // 歌舞伎町 (docs/rules/21)
import type { StreetView } from './kb-ambient';
import { timeout, watch } from './watchdog';
import { pickAt, visible as shapeVisible, type Piece, type Shape } from './pick-hit';

const S = 1.2175, K = Math.SQRT1_2;
/** Original view: 440×440, the camera point at its centre. */
const VIEW = 440;

/** Frames per direction [character][slot] = resource frames / 8 (08 §1.4); the code derives it the same way. */
const CHAR_BASE = 128, CHAR_STRIDE = 21;
/** Attached god / carried bomb offsets in screen pixels by the player's screen direction (08 §3.5). */
const ATTACH = [[-10, -22], [-22, -10], [-22, 10], [-10, 22], [10, 22], [22, 10], [22, -10], [10, -22]];
const ATTACH_FAR = [[-18, -44], [-44, -18], [-44, 18], [-18, 44], [18, 44], [44, 18], [44, -18], [18, -44]];
/** Dice tumble offset by screen direction (08 §2.4, 0x475224). */
const DICE_T = [[4, 12], [12, 12], [8, 6], [-4, -6], [-12, -12], [-24, -12], [-20, -6], [-12, 6]];
/** Size of the dice animation relative to the board. */
const DICE_SCALE = 0.6;
const Layer = { building: 0, npc: 8, player: 0xc, current: 0xd, zzz: 0xe } as const;

/** Animation state of one actor (08 §1.1): 0..3 players, 4..7 thief/robber/hooligan/spy, 8 robot doll. */
interface Actor {
  x: number;
  y: number;
  /** Where the actor stood at the start of the last tick, so drawing can slide between ticks. */
  px?: number;
  py?: number;
  dir: number;
  /** 0 still, 1 moving, 2 dice, 3 demolish. */
  phase: number;
  anim: number;
  /** ZZZ frame while sleepwalking. */
  zzz: number;
  visible: boolean;
}

interface Item { key: number; draw: () => void }

/**
 * Who may move the map (09 §1.4: the original's main screen ignores the mouse unless a human decides, `0x46cafd`;
 * 09 §7.5: the target selector scrolls only with flag 0x80, the missiles):
 *  - `locked`: a computer acts, someone walks, an effect or a message plays. No dragging, turning or info taps;
 *    the camera follows the actor. A tap only skips what is playing (a cloud, a caption).
 *  - `free`: a human's turn before throwing (the GO button is up): drag, turn, tap for the info box.
 *  - `pick`: a card or tool picks on the player's screen: taps pick, the map stays still.
 *  - `pick-scroll`: a missile picks anywhere: taps pick, dragging and turning look around.
 */
export type InputMode = 'locked' | 'free' | 'pick' | 'pick-scroll';

export const screenDir = (dir: number, rot: number) => (dir + 8 - rot) & 7;
const buildingFrame = (facing: number, rot: number) => (8 - facing - rot) & 7;

export class BoardView {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private actors = new Map<number, Actor>();
  /** Camera in world pixels, view rotation 0..7, zoom = screen px per original px. */
  private cam = { x: 1152, y: 1152 };
  rot = 0;
  private zoom = 1;
  private userZoom = 1;
  private follow: number | null = null;
  private pointers = new Map<number, { x: number; y: number }>();
  private drag: { x: number; y: number; cx: number; cy: number; dist: number; zoom: number } | null = null;
  private dpr = 1;
  private W = 1;
  private H = 1;
  private overlay: (() => void) | null = null;
  /**
   * Drawn over the world (ground, buildings, figures) and under the picking glows and counters, in CSS px of the
   * canvas: the remake's weather (ui/weather-fx.ts, docs/rules/16). Never touches the ground cache.
   */
  overWorld: ((ctx: CanvasRenderingContext2D, w: number, h: number, dpr: number, zoom: number) => void) | null = null;
  /** Steps left shown under the view while someone walks (08 §2.4 item 4). */
  stepsLeft: number | null = null;
  highlight: number | null = null;
  current = -1;
  /** Where the camera point sits on the canvas, as a fraction of its height; raised while a dialog covers the bottom. */
  private fy = 0.5;
  focusY = 0.5;
  /** Milliseconds per animation tick: 120/80/40 by game speed (08 §2.3). */
  tickMs = 60;
  /** On-map effects (docs/rules/11): flights, clips, rising numbers. */
  readonly fx: Effects;
  /** Nodes whose object is not drawn on the node right now (it is still flying there). */
  readonly hiddenObjects = new Set<number>();
  /** The map info box (09 §6.4) shown by a plain tap. */
  private readonly info: InfoBubble;
  /** A redrawn ground style drawn instead of the original (null: the original). */
  private tiled: TiledGround | null = null;
  /** 歌舞伎町's passers-by and neon (docs/rules/21 §8); null on every other map. */
  private readonly street: KbStreet | null;

  constructor(parent: HTMLElement, readonly game: Game, readonly art: MapArt, readonly bank: SpriteBank) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'board';
    parent.append(this.canvas);
    this.info = new InfoBubble(parent, bank);
    this.street = kbRules(game) ? new KbStreet(game, art.walkers ?? []) : null;
    if (this.street) this.street.ambient.frameInfo = (res, fr) => { const f = this.bank.board('map', res)?.[fr]; return f ? { img: f.img, ax: f.ax, ay: f.ay, w: f.w, h: f.h, scale: f.scale } : null; };
    // Opaque: every frame covers the whole canvas, so the page need not blend it with what is behind.
    this.ctx = this.canvas.getContext('2d', { alpha: false })!;
    const view = this;
    const host: FxHost = {
      bank, ctx: this.ctx,
      get scale() { return view.zoom; },
      get rot() { return view.rot; },
      project: (x, y) => this.project(x, y),
      actorPos: id => this.actors.get(id),
    };
    this.fx = new Effects(host);
    this.fx.onTap = fn => this.tapListeners.push(fn);
    this.resizer.observe(this.canvas);
    this.resize();
    this.bindInput();
    for (const p of game.players) this.actors.set(p.id, { x: 0, y: 0, dir: p.dir, phase: 0, anim: 0, zzz: 0, visible: false });
    this.syncAll();
    this.warm();
    let last = performance.now(), acc = 0;
    const loop = (t: number) => {
      if (!this.alive) return;
      // Scheduled first: a frame that throws (a picture released under it …) must not stop the loop, or every
      // walk, camera move and effect the game waits on would never finish.
      requestAnimationFrame(loop);
      acc += t - last; last = t;
      if (acc > 1000) acc = this.tickMs;
      try {
        while (acc >= this.tickMs) { acc -= this.tickMs; this.tick(); }
      } catch (e) { this.oops('tick', e); }
      this.alpha = Math.min(1, acc / this.tickMs);
      this.fx.alpha = this.alpha;
      try { this.draw(); } catch (e) { this.oops('draw', e); }
    };
    requestAnimationFrame(loop);
  }

  private oopsSeen = new Set<string>();
  /** Logs a failed frame once per message (the loop goes on). */
  private oops(where: string, e: unknown) {
    const m = `${where}: ${(e as Error)?.message ?? e}`;
    if (this.oopsSeen.has(m)) return;
    this.oopsSeen.add(m);
    console.warn('[board]', m);
  }

  // ---------- geometry ----------

  private resize() {
    const r = this.canvas.getBoundingClientRect();
    // At most 2×: a phone's 3× canvas has 2.25 times the pixels to fill every frame for no visible gain.
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.W = Math.max(1, r.width); this.H = Math.max(1, r.height);
    this.canvas.width = Math.round(this.W * this.dpr);
    this.canvas.height = Math.round(this.H * this.dpr);
    this.zoom = Math.max(0.6, Math.min(this.W, this.H) / VIEW) * this.userZoom;
    // Sprites for the board are kept at the density it draws at (a phone: half the redrawn pixels each way).
    this.bank.setBoardDensity(this.zoom * this.dpr);
  }

  private basis() {
    const th = (-22.5 + 45 * this.rot) * Math.PI / 180, z = this.zoom;
    const cos = Math.cos(th), sin = Math.sin(th);
    return { a: z * S * cos, b: z * K * S * sin, c: -z * S * sin, d: z * K * S * cos };
  }

  /** World pixel → CSS pixel on the canvas. */
  project(x: number, y: number) {
    const { a, b, c, d } = this.basis(), dx = x - this.cam.x, dy = y - this.cam.y;
    return { x: this.W / 2 + a * dx + c * dy, y: this.H * this.fy + b * dx + d * dy };
  }

  /** CSS pixel → world pixel. */
  unproject(sx: number, sy: number) {
    const { a, b, c, d } = this.basis(), det = a * d - b * c;
    const u = sx - this.W / 2, v = sy - this.H * this.fy;
    return { x: this.cam.x + (d * u - c * v) / det, y: this.cam.y + (-b * u + a * v) / det };
  }

  // ---------- input ----------

  private inputMode: InputMode = 'locked';
  /** The input state (see `InputMode`). */
  get mode(): InputMode { return this.inputMode; }
  /** Dragging and turning the map are allowed. */
  get canPan(): boolean { return this.inputMode === 'free' || this.inputMode === 'pick-scroll'; }
  /** Kept for callers of the old flag: true while the map may not be moved. */
  get panLocked(): boolean { return !this.canPan; }

  /**
   * Switches the input state. Leaving a state that could move the map ends any drag at once; when it locks, the
   * camera goes back to the actor (smoothly) if the player had looked elsewhere.
   */
  setMode(m: InputMode) {
    if (m === this.inputMode) return;
    this.inputMode = m;
    if (!this.canPan) {
      this.drag = null;
      if (this.tap) this.tap.moved = true;
    }
    if (m === 'locked') { this.info.hide(); if (this.follow === null && this.current >= 0 && !this.glide) this.followActor(this.current); }
  }

  private bindInput() {
    const c = this.canvas;
    c.addEventListener('pointerdown', e => {
      this.info.hide();
      if (this.pointers.size === 0) this.tap = { x: e.clientX, y: e.clientY, moved: false };
      c.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.startDrag();
    });
    c.addEventListener('pointermove', e => {
      if (!this.pointers.has(e.pointerId) || !this.drag) return;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const [p, q] = [...this.pointers.values()];
      const mid = q ? { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 } : p;
      const { a, b, c: cc, d } = this.basis(), det = a * d - b * cc;
      const u = mid.x - this.drag.x, v = mid.y - this.drag.y;
      // Only a human deciding (or a missile looking for its target) moves the map (09 §1.4, 05 §2.6).
      if (!this.canPan) { if (Math.abs(u) + Math.abs(v) > 12 && this.tap) this.tap.moved = true; return; }
      if (Math.abs(u) + Math.abs(v) > 4) { this.follow = null; this.endGlide(); if (this.tap) this.tap.moved = true; }
      this.cam.x = this.drag.cx - (d * u - cc * v) / det;
      this.cam.y = this.drag.cy - (-b * u + a * v) / det;
    });
    const up = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId); this.drag = null;
      if (this.pointers.size) { this.startDrag(); if (this.tap) this.tap.moved = true; return; }
      const t = this.tap;
      this.tap = null;
      if (t && !t.moved && Math.hypot(e.clientX - t.x, e.clientY - t.y) < 10 && e.type === 'pointerup') this.tapAt(e.clientX, e.clientY);
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    // The map scale is fixed, as in the original (the view only pans); the wheel does nothing.
    c.addEventListener('wheel', e => e.preventDefault(), { passive: false });
    window.addEventListener('keydown', this.onKey);
  }

  private startDrag() {
    if (!this.pointers.size) { this.drag = null; return; }
    const [p, q] = [...this.pointers.values()];
    const mid = q ? { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 } : p;
    this.drag = { x: mid.x, y: mid.y, cx: this.cam.x, cy: this.cam.y, dist: q ? Math.hypot(p.x - q.x, p.y - q.y) : 0, zoom: this.userZoom };
  }

  private alive = true;
  private resizer = new ResizeObserver(() => this.resize());
  private onKey = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement | null)?.closest?.('input, textarea')) return;
    if (e.key === 'q' || e.key === 'Q' || e.key === '[') this.rotate(-1);
    if (e.key === 'e' || e.key === 'E' || e.key === ']') this.rotate(1);
  };

  /** Stops drawing and input handling (the game was left or another one loaded). */
  destroy() {
    this.alive = false;
    this.unstick();
    this.street?.destroy();
    this.ground.dispose();
    this.tiled?.dispose();
    this.tiled = null;
    this.resizer.disconnect();
    window.removeEventListener('keydown', this.onKey);
  }

  /** Switches the ground to a redrawn style (null: the original); the previous one is released. */
  setGround(g: TiledGround | null) {
    if (g === this.tiled) return;
    this.tiled?.dispose();
    this.tiled = g;
    this.groundGen++;
  }
  /** Counts ground switches (the cached ground is redrawn). */
  private groundGen = 0;

  /** Decoded high-resolution ground tiles right now (for checks). */
  groundStats() { return this.tiled ? { style: this.tiled.style, ...this.tiled.stats() } : null; }

  // ---------- the loading screen (ui/board-preload.ts) ----------

  /** The redrawn ground drawn now (null: the original). */
  get groundTiles(): TiledGround | null { return this.tiled; }

  /** Redraws the whole cached ground on the next frame (the loading screen, once the first view's tiles are in). */
  refreshGround() { this.groundGen++; }

  /** Puts the camera where the game opens, at once: on the current player when they are on the map. */
  aimAtStart() {
    const a = this.actors.get(this.game.current);
    if (a?.visible) this.snapTo(this.game.current); else this.keepOnBoard();
  }

  /** The world quad the canvas shows, widened by the ground cache's ring and `ring` more CSS px each way. */
  preloadQuad(ring: number): { x: number; y: number }[] {
    const r = 256 / this.dpr + ring;
    return [this.unproject(-r, -r), this.unproject(this.W + r, -r), this.unproject(this.W + r, this.H + r), this.unproject(-r, this.H + r)];
  }

  /** The whole map as a world quad. */
  mapQuad(): { x: number; y: number }[] {
    const S = worldSize(this.game.board);
    return [{ x: 0, y: 0 }, { x: S, y: 0 }, { x: S, y: S }, { x: 0, y: S }];
  }

  /**
   * The sprites the board draws for the map as it is now (archive, resource, scale as `bank.board` takes them):
   * event pads, lots' buildings and flags, facilities, companies, landscapes, decorations, objects and gods, the
   * players' still / walking / throwing figures and the NPCs, the dice. `d`: how far (CSS px) the nearest use is
   * outside the area the board draws for the view now (0 inside; the figures and the dice 0).
   */
  boardSprites(): { a: Archive; res: number; mul: number; d: number }[] {
    const g = this.game, b = g.board, out = new Map<string, { a: Archive; res: number; mul: number; d: number }>();
    let at = 0;
    const add = (a: Archive, res: number, mul = 1) => {
      const k = `${a}/${res}@${mul}`, e = out.get(k);
      if (!e) out.set(k, { a, res, mul, d: at }); else e.d = Math.min(e.d, at);
    };
    // The same culling as `draw` (`m` the sprite's reach), as a distance.
    const near = (x: number, y: number, m = 200) => {
      const p = this.project(x, y);
      at = Math.max(0, -m - p.x, p.x - this.W - m, -m - p.y, p.y - this.H - m * 1.5);
      return true;
    };
    for (const n of b.nodes) {
      const pad = this.street ? kbPadSprite(g, n.event) : 0;
      if (n.event === 17 || n.event === 18) { if (near(n.x, n.y, 60)) add('map', n.event === 17 ? 9017 : 9018); }
      else if (pad) { if (near(n.x, n.y, 60)) add('map', pad); }
      else if (n.aux && near(n.x, n.y, 60)) add('map', 24);
    }
    for (const o of kbFigures(g)) { const n = nodeById(b, o.node); if (near(n.x, n.y)) add('map', o.res); }
    for (const l of b.lands) {
      if (!near(l.x, l.y)) continue;
      const sp = this.landSprite(l);
      if (sp) add('map', sp.res);
      if (l.tmpState) add('map', 26);
    }
    for (const f of b.facilities) {
      if (!near(f.x, f.y, 260)) continue;
      const sp = this.facilitySprite(f);
      if (sp) add('map', sp.res);
      if (f.tmpState) add('map', 26);
    }
    for (const co of b.companies) if (co.resource && near(co.x, co.y, 260)) add('map', co.resource + 38);
    for (const ls of b.landscapes) if (ls.resource && near(ls.x, ls.y, 300)) add('map', ls.resource + 38);
    for (const d of this.art.decor ?? []) if (near(d.x, d.y, 90)) add('map', d.res);
    at = 0;
    for (const res of this.street?.walkerSprites() ?? []) add('map', res);
    for (const o of this.objectSlots()) if (o.type) add('Data', 395 + o.type);
    for (const [id, a] of this.actors) {
      if (id >= g.npcBase) {
        if (a.visible) { const r = this.spriteOf(id); if (r) add('Data', r.res); }
        continue;
      }
      const p = g.players[id];
      if (!p || (g.world && !p.placed)) continue;
      const phase = a.phase;
      for (const ph of [0, 1, 2]) { a.phase = ph; const r = this.spriteOf(id); if (r) add('Data', r.res); }
      a.phase = phase;
      if (p.sleepwalk) add('Data', 414);
    }
    for (const id of [3, 4, 5, 6]) add('Panel', id, DICE_SCALE);
    for (const res of [521, 522, 517]) add('Data', res);
    return [...out.values()];
  }

  private overview: { userZoom: number; follow: number | null } | null = null;

  /** 工具列「地圖」: zoom out to the whole board, or back to the followed actor. */
  toggleOverview() {
    if (this.overview) {
      this.userZoom = this.overview.userZoom;
      this.follow = this.overview.follow ?? this.current;
      this.overview = null;
    } else {
      this.overview = { userZoom: this.userZoom, follow: this.follow };
      this.endGlide();
      this.userZoom = 1;
      this.resize();
      const base = this.zoom;
      void base;
      this.userZoom = this.clampZoom(0);
      this.follow = null;
      this.cam.x = this.cam.y = worldSize(this.game.board) / 2;
    }
    this.resize();
  }

  /**
   * Zoom limits: zooming out stops at half the normal size (2×), zooming in at 4×.
   */
  private clampZoom(z: number): number {
    // At most 2× smaller than the normal view, at most 4× larger.
    return Math.max(0.5, Math.min(4, z));
  }

  private tap: { x: number; y: number; moved: boolean } | null = null;
  /** One-shot listeners for a plain tap on the map (skipping a cloud or a god's words). */
  private tapListeners: (() => void)[] = [];
  /**
   * The map picker's state: the spots, which of them may be picked, and how a tap ends it. An on-screen pick
   * (`onScreen`) allows what is visible right now (the map cannot move meanwhile, so that is what the player's
   * screen showed when the pick started); a missile allows every spot. `choose` tells stacked spots apart.
   */
  private picking: {
    spots: PickSpot[]; all: Set<number>; onScreen: boolean; resolve: (i: number) => void; onMiss: () => void;
    choose?: (indices: number[]) => Promise<number>; busy?: boolean;
  } | null = null;

  /** World point of a spot: the node, the lot / facility's centre, or where the actor stands; null when not drawn. */
  private spotPos(s: PickSpot, drawn = true): { x: number; y: number } | null {
    const b = this.game.board;
    if (s.at === 'actor') {
      const a = this.actors.get(s.id);
      if (!a?.visible) return null;
      if (s.id < this.game.npcBase && !this.game.players[s.id]) return null;
      return drawn ? this.at(a) : { x: a.x, y: a.y };
    }
    if (s.at === 'plot') {
      const rec = s.id > 2000 && s.id < 4000 ? b.lands[s.id - 2001] : s.id > 4000 && s.id < 6000 ? b.facilities[s.id - 4001]
        : s.id > 6000 && s.id < 8000 ? b.companies[s.id - 6001] : undefined;
      return rec ? { x: rec.x, y: rec.y } : null;
    }
    const n = b.nodes[s.id - 1]?.id === s.id ? b.nodes[s.id - 1] : b.nodes.find(m => m.id === s.id);
    return n ? { x: n.x, y: n.y } : null;
  }

  /** World radius of a spot's glow. */
  private static spotRadius(s: PickSpot): number { return s.at === 'plot' ? 34 : s.at === 'actor' ? 22 : 16; }

  /** Screen rectangle of a board frame drawn at (sx, sy), with an alpha test on its picture. */
  private piece(f: Frame | undefined, sx: number, sy: number, order: number): Piece | null {
    if (!f) return null;
    const s = this.zoom * f.scale, x = sx - f.ax * s, y = sy - f.ay * s, w = f.w * s, h = f.h * s;
    return { x, y, w, h, order, opaque: (tx, ty, r) => this.alphaAround(f.img, x, y, w, h, tx, ty, r) };
  }

  private probe: CanvasRenderingContext2D | null = null;
  /**
   * Whether a picture drawn at (x, y, w, h) has an opaque pixel at the canvas point (tx, ty) or within r px of it
   * (the picture's pixels, as the original's pick buffer holds them).
   */
  private alphaAround(img: CanvasImageSource, x: number, y: number, w: number, h: number, tx: number, ty: number, r: number): { hit: boolean; near: boolean; d: number } {
    const n = 2 * Math.ceil(r) + 1;
    try {
      if (!this.probe) { const c = document.createElement('canvas'); c.width = c.height = 64; this.probe = c.getContext('2d', { willReadFrequently: true }); }
      const p = this.probe!;
      p.setTransform(1, 0, 0, 1, 0, 0);
      p.clearRect(0, 0, n, n);
      // The canvas point (tx − r, ty − r) at the probe's origin, one probe pixel per CSS px.
      p.drawImage(img, x - (tx - r), y - (ty - r), w, h);
      const px = p.getImageData(0, 0, n, n).data, c = Math.floor(n / 2);
      let best = Infinity;
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        if (px[(j * n + i) * 4 + 3] < 48) continue;
        const d = Math.hypot(i - c, j - c);
        if (d <= r && d < best) best = d;
      }
      return { hit: best <= 1, near: best <= r, d: best };
    } catch {
      // A picture that cannot be read: its box counts.
      const inside = tx >= x && tx <= x + w && ty >= y && ty <= y + h;
      return { hit: inside, near: inside, d: inside ? 0 : Infinity };
    }
  }

  /** The sprite a lot shows now (a building, or the owner's flag on an empty one), as `draw` draws it. */
  private landSprite(l: { level: number; chain: number | boolean; owner: number; facing: number }): { res: number; frame: number; tint?: number } | null {
    const b = this.game.board;
    if (l.level) return { res: kbHouseSprite(this.game, l) ?? (l.chain ? 79 + b.mapId : 39 + b.mapId * 5 + l.level - 1), frame: buildingFrame(l.facing, this.rot) };
    if (l.owner) return { res: 25, frame: this.game.players[l.owner - 1]?.character ?? 0 };
    return null;
  }

  private facilitySprite(fa: { level: number; type: number; owner: number }): { res: number; frame: number } | null {
    const b = this.game.board, stage = b.mapId >> 2, inStage = b.mapId & 3;
    if (fa.level) {
      const own = casinoSprite(fa) ?? kbShopSprite(this.game, fa); // 大富翁城's casino (docs/rules/19), 歌舞伎町's shops (21)
      if (own) return { res: own, frame: buildingFrame(0, this.rot) };
      const i = fa.type === 0 ? 0 : fa.type === 1 ? fa.level : fa.type === 2 ? 5 + fa.level : fa.type === 3 ? 11 : 11 + fa.level;
      return { res: stage === 0 ? 87 + i : 104 + inStage * 17 + i, frame: buildingFrame(0, this.rot) };
    }
    if (fa.owner) return { res: 25, frame: this.game.players[fa.owner - 1]?.character ?? 0 };
    return null;
  }

  /**
   * How a spot shows on screen now: its glow on the ground and the pictures drawn for it — a person's figure (and
   * the god or bomb riding with them, and the marker over the head), an object lying on a node, a lot's building.
   */
  private spotShape(s: PickSpot): Shape | null {
    const w = this.spotPos(s);
    if (!w) return null;
    const q = this.project(w.x, w.y), z = this.zoom, r = BoardView.spotRadius(s) + 4;
    const glow = { x: q.x, y: q.y, rx: r * z, ry: r * z * K };
    const pieces: Piece[] = [];
    const add = (p: Piece | null) => { if (p) pieces.push(p); };
    const g = this.game, b = g.board;
    if (s.at === 'actor') {
      const a = this.actors.get(s.id)!, spr = this.spriteOf(s.id), frames = spr && this.bank.board('Data', spr.res);
      const layer = s.id === this.current ? Layer.current : s.id < g.npcBase ? Layer.player : Layer.npc;
      if (frames) {
        const fpd = Math.max(1, frames.length >> 3);
        add(this.piece(frames[screenDir(a.dir, this.rot) * fpd + Math.min(a.anim, fpd - 1)], q.x, q.y, q.y * 16 + layer));
      } else add({ x: q.x - 18 * z, y: q.y - 60 * z, w: 36 * z, h: 64 * z, order: q.y * 16 + layer });
      // What rides with the person (a god, a time bomb) is picked as the person (05 §3.9).
      for (const o of this.objectSlots()) {
        if (!o.type || o.owner !== s.id + 1) continue;
        const sd = screenDir(a.dir, this.rot), [ox, oy] = (o.type === 18 && g.players[s.id]?.god > 0 ? ATTACH_FAR : ATTACH)[sd];
        const x = q.x + ox * z, y = q.y + oy * z;
        add(this.piece(this.bank.board('Data', 395 + o.type)?.[(sd + 4) & 7], x, y, y * 16));
      }
      // The bouncing marker over the head.
      const my = q.y - ((g.players[s.id]?.bomb ? 84 : 66) + 6) * z;
      pieces.push({ x: q.x - 12 * z, y: my - 4 * z, w: 24 * z, h: 20 * z, order: 1e9 });
    } else if (s.at === 'node') {
      const o = this.objectSlots().find(x => x.type && !x.owner && x.node === s.id);
      if (o && !this.hiddenObjects.has(s.id)) add(this.piece(this.bank.board('Data', 395 + o.type)?.[screenDir(o.dir, this.rot)], q.x, q.y, q.y * 16));
    } else {
      const ref = s.id;
      if (ref > 2000 && ref < 4000) {
        const sp = this.landSprite(b.lands[ref - 2001]);
        if (sp) add(this.piece(this.bank.board('map', sp.res)?.[sp.frame], q.x, q.y, q.y * 16));
      } else if (ref > 4000 && ref < 6000) {
        const sp = this.facilitySprite(b.facilities[ref - 4001]);
        if (sp) add(this.piece(this.bank.board('map', sp.res)?.[sp.frame], q.x, q.y, q.y * 16));
      } else if (ref > 6000 && ref < 8000) {
        const co = b.companies[ref - 6001];
        if (co?.resource) add(this.piece(this.bank.board('map', co.resource + 38)?.[buildingFrame(co.facing, this.rot)], q.x, q.y, q.y * 16));
      }
    }
    return { glow, pieces, anchor: q };
  }

  private objectSlots(): { type: number; node: number; dir: number; owner: number }[] {
    return (this.game as unknown as { objects?: { slots?: { type: number; node: number; dir: number; owner: number }[] } }).objects?.slots ?? [];
  }

  /** Shapes of the picker's spots for this frame (computed once per frame, used by the glow and by taps). */
  private shapes: { frame: number; list: (Shape | null)[] } = { frame: -1, list: [] };
  private frameNo = 0;
  private pickShapes(): (Shape | null)[] {
    const pk = this.picking;
    if (!pk) return [];
    if (this.shapes.frame !== this.frameNo) this.shapes = { frame: this.frameNo, list: pk.spots.map(s => this.spotShape(s)) };
    return this.shapes.list;
  }

  /** The spots that may be picked right now: an on-screen pick, every one visible on the canvas; otherwise all. */
  private pickAllowed(): number[] {
    const pk = this.picking;
    if (!pk) return [];
    const shapes = this.pickShapes();
    return [...pk.all].filter(i => shapes[i] && (!pk.onScreen || shapeVisible(shapes[i], this.W, this.H)));
  }

  /** Runs `fn` with the camera where the view of actor `self` puts it (kept on the board), then puts it back. */
  private withCameraOn<T>(self: number | undefined, fn: () => T): T {
    const me = self !== undefined ? this.actors.get(self) : undefined, cam = { ...this.cam }, fy = this.fy;
    if (me?.visible) { this.fy = this.focusY; this.cam.x = me.x; this.cam.y = me.y; this.keepOnBoard(); }
    try { return fn(); } finally { this.cam.x = cam.x; this.cam.y = cam.y; this.fy = fy; }
  }

  /** Where an actor is drawn now, in CSS px of the canvas, and the view's zoom (CSS px per original pixel). */
  screenOf(id: number): { x: number; y: number; zoom: number } | null {
    const a = this.actors.get(id);
    if (!a?.visible) return null;
    const w = this.at(a), q = this.project(w.x, w.y);
    return { x: q.x, y: q.y, zoom: this.zoom };
  }

  /**
   * Whether an actor shows on screen (any part of the figure) with the view on another (kept on the board as
   * always): card targets are picked on the map in the original, so only what the player's view shows counts.
   */
  inViewOf(self: number, id: number): boolean {
    return this.withCameraOn(self, () => shapeVisible(this.spotShape({ at: 'actor', id, label: '' }), this.W, this.H));
  }

  /**
   * The original's map picker (09 §7.5, 04 §2.4): the valid spots glow, a tap on one picks it. `onScreen` limits
   * the choice to what the screen shows (the caller puts the view on the player first and keeps the map still);
   * otherwise every spot may be picked and the map can be moved to find it. Resolves with the spot's index, or −1
   * when cancelled; `count` is how many spots can be picked at the start.
   */
  pickSpots(spots: PickSpot[], opts: { onMiss: () => void; onScreen?: boolean; self?: number; choose?: (indices: number[]) => Promise<number> }):
    { done: Promise<number>; cancel: () => void; count: number } {
    let resolve!: (i: number) => void;
    const done = new Promise<number>(r => { resolve = r; });
    const all = new Set(spots.map((_, i) => i).filter(i => this.spotPos(spots[i])));
    const pk = { spots, all, onScreen: !!opts.onScreen, resolve: (i: number) => { if (this.picking === pk) this.picking = null; resolve(i); }, onMiss: opts.onMiss, choose: opts.choose };
    this.picking = pk;
    this.shapes.frame = -1;
    const count = pk.onScreen ? this.withCameraOn(opts.self, () => { this.shapes.frame = -1; const n = this.pickAllowed().length; this.shapes.frame = -1; return n; }) : all.size;
    // Look at the first choice if none is on screen.
    if (!pk.onScreen && all.size) {
      const shapes = pk.spots.map(s => this.spotShape(s));
      if (![...all].some(i => shapeVisible(shapes[i], this.W, this.H))) { const w = this.spotPos(spots[[...all][0]])!; this.follow = null; this.endGlide(); this.cam.x = w.x; this.cam.y = w.y; }
    }
    return { done: watch('view.pick', done), cancel: () => { if (this.picking === pk) pk.resolve(-1); }, count };
  }

  /**
   * Node picking (tools): `plot` shows each node's choice on the lot / facility it borders. Resolves with the node
   * id, or 0 when cancelled.
   */
  pickNode(nodes: number[], onMiss: () => void, onScreen = false, plot = false, self?: number): { done: Promise<number>; cancel: () => void; count: number } {
    const b = this.game.board;
    const spots: PickSpot[] = nodes.map(id => {
      const ref = nodeById(b, id).ref;
      return plot && ref > 2000 && ref < 8000 ? { at: 'plot', id: ref, label: '' } : { at: 'node', id, label: '' };
    });
    const pick = this.pickSpots(spots, { onMiss, onScreen, self });
    return { done: pick.done.then(i => nodes[i] ?? 0), cancel: pick.cancel, count: pick.count };
  }

  private tapAt(clientX: number, clientY: number) {
    const pk = this.picking;
    if (!pk) {
      // A tap first skips what is playing; otherwise, while a human decides, it tells what is there.
      const l = this.tapListeners; this.tapListeners = [];
      if (l.length) { for (const f of l) f(); return; }
      if (this.inputMode === 'free') this.showInfo(clientX, clientY);
      return;
    }
    if (pk.busy) return;
    const r = this.canvas.getBoundingClientRect(), tx = clientX - r.left, ty = clientY - r.top, z = this.zoom;
    this.shapes.frame = -1;
    const shapes = this.pickShapes();
    // A fingertip of slack round every picture and glow; a tap anywhere near a glow still finds it.
    const hit = pickAt(shapes, this.pickAllowed(), tx, ty, { margin: Math.max(8, 7 * z), near: Math.max(40, 34 * z), stackPx: 12 * z });
    if (!hit) { pk.onMiss(); return; }
    // Stacked choices (players on one square, a god lying under a player …): ask which one.
    if (hit.stack.length > 1 && pk.choose) {
      pk.busy = true;
      const stack = hit.stack;
      void pk.choose(stack).then(i => { pk.busy = false; if (this.picking === pk && stack.includes(i)) pk.resolve(i); }, () => { pk.busy = false; });
      return;
    }
    pk.resolve(hit.best);
  }

  /** The info box for a tap, with its tail on the tapped point. */
  private showInfo(clientX: number, clientY: number) {
    const r = this.canvas.getBoundingClientRect(), host = this.canvas.parentElement!.getBoundingClientRect();
    const d = describe(this.game, this.unproject(clientX - r.left, clientY - r.top), id => this.actors.get(id));
    if (!d) return;
    audio.ui('click');
    this.info.show(clientX - host.left, clientY - host.top, this.zoom, d.lines);
  }

  /**
   * Puts the camera on an actor at once and settles it there (an on-screen pick must show exactly what the
   * player's view shows: no camera still easing in, no dialog offset still easing out).
   */
  snapTo(id: number) {
    const a = this.actors.get(id);
    this.followActor(id);
    this.endGlide();
    this.fy = this.focusY;
    if (a?.visible) { const w = this.at(a); this.cam.x = w.x; this.cam.y = w.y; this.keepOnBoard(); }
  }

  /** Looks at a spot without following anyone (tapping the small map); false while the map may not move. */
  lookAt(x: number, y: number): boolean {
    if (!this.canPan) return false;
    this.follow = null; this.endGlide(); this.cam.x = x; this.cam.y = y;
    return true;
  }

  /**
   * A camera move to another spot, timed and eased (slow start, slow stop) instead of a fixed fraction per frame,
   * so it looks the same at any frame rate and dropped frames do not show as jumps. `to` is read every frame (a
   * walking actor); `follow` takes over at the end. The ground tiles at the end are asked for when it starts.
   * Whoever waits on it (`done`) is told when it ends in any way: arrived, replaced, or broken off.
   */
  private glide: { x0: number; y0: number; t0: number; ms: number; to: () => { x: number; y: number } | null; done?: () => void } | null = null;

  /** Ends the camera move in progress (wherever the camera is) and tells whoever waits on it. */
  private endGlide() { const g = this.glide; this.glide = null; g?.done?.(); }

  private startGlide(to: () => { x: number; y: number } | null, maxMs: number, done?: () => void): boolean {
    const p = to();
    this.endGlide();
    if (!p) return false;
    const end = this.clampCam(p.x, p.y), { a, b, c, d } = this.basis();
    const dx = end.x - this.cam.x, dy = end.y - this.cam.y, dist = Math.hypot(a * dx + c * dy, b * dx + d * dy);
    // Short hops keep the plain follow (a walk step); longer ones take 0.3–0.7 s by screen distance.
    if (dist < 24) return false;
    this.glide = { x0: this.cam.x, y0: this.cam.y, t0: performance.now(), ms: Math.min(maxMs, 260 + dist * 0.32), to, done };
    this.tiled?.prefetch(this.viewQuad(end.x, end.y));
    return true;
  }

  /**
   * Moves the camera smoothly onto a world point, as the original centres the view on the spot of an effect
   * (`fcn_0041d476`); resolves once it is there (at most ~0.45 s). It always resolves: a move broken off or
   * replaced, or frames that stop coming, end the wait (the camera is then put on the spot).
   */
  panTo(x: number, y: number): Promise<void> {
    this.follow = null;
    return watch('view.panTo', new Promise<void>(resolve => {
      let over = false;
      const finish = () => { if (over) return; over = true; clearTimeout(timer); resolve(); };
      const timer = setTimeout(() => {
        if (over) return;
        if (this.glide?.done === finish) this.glide = null;
        this.cam.x = x; this.cam.y = y; this.keepOnBoard();
        finish();
      }, 1200);
      if (!this.alive || !this.startGlide(() => ({ x, y }), 450, finish)) { this.cam.x = x; this.cam.y = y; this.keepOnBoard(); finish(); }
    }));
  }

  /** Turns the view (only while the map may be moved). */
  rotate(by: number) { if (this.canPan) this.rot = (this.rot + by + 8) & 7; }

  /** Keep the camera on an actor, as the original does every tick; a new actor is reached by a glide. */
  followActor(id: number) {
    const changed = this.follow !== id;
    this.follow = id; this.current = id;
    if (!changed) return;
    const a = this.actors.get(id);
    if (!a?.visible || !this.startGlide(() => { const q = this.actors.get(id); return q?.visible ? this.at(q) : null; }, 700)) this.endGlide();
  }

  /** What the view holds right now (the watchdog's dump). */
  debugState() {
    return {
      mode: this.inputMode, follow: this.follow, current: this.current, glide: this.glide ? Math.round(performance.now() - this.glide.t0) : null,
      movers: [...this.movers.keys()], dice: this.diceWait?.id ?? null, demolish: this.demolishWait?.id ?? null,
      fx: this.fx.busy, picking: !!this.picking, cam: { x: Math.round(this.cam.x), y: Math.round(this.cam.y) },
      actors: [...this.actors].filter(([, a]) => a.phase).map(([id, a]) => `${id}:p${a.phase}`),
    };
  }

  /** Finishes everything the view holds (the watchdog's rescue): camera moves, walks, the dice, effects. */
  unstick() {
    this.endGlide();
    for (const id of [...this.movers.keys()]) this.finishMove(id);
    const d = this.diceWait; this.diceWait = null; d?.done();
    const w = this.demolishWait; this.demolishWait = null; w?.done();
    this.fx.finishAll();
  }

  // ---------- actors ----------

  private actor(id: number): Actor {
    let a = this.actors.get(id);
    if (!a) { a = { x: 0, y: 0, dir: 0, phase: 0, anim: 0, zzz: 0, visible: false }; this.actors.set(id, a); }
    return a;
  }

  /** Snap every actor that is not animating to its node in the game state. */
  syncAll() {
    for (const p of this.game.players) {
      const a = this.actor(p.id);
      if (a.phase) continue;
      a.visible = p.placed && (!this.game.offRoad(p) || p.bankrupt);
      if (p.placed && p.node) { const n = nodeById(this.game.board, p.node); a.x = n.x; a.y = n.y; }
      // A standing player faces the way the rules say (a turn-around card turns them at once).
      a.dir = p.dir;
    }
    for (const [i, npc] of this.npcs()) {
      const a = this.actor(i);
      if (a.phase) continue;
      a.visible = npc.where === 0 && npc.node > 0;
      if (a.visible) { const n = nodeById(this.game.board, npc.node); a.x = n.x; a.y = n.y; a.dir = npc.dir; }
    }
  }

  private npcs(): [number, { node: number; dir: number; where: number }][] {
    const list = (this.game as unknown as { places?: { npcs?: { node: number; dir: number; where: number }[] } }).places?.npcs ?? [];
    const base = this.game.npcBase;   // NPC actors npcBase.. (4..7; 12..15 in 大富豪模式)
    return list.map((n, i) => [base + i, n] as [number, typeof n]).filter(([id]) => id < base + 4);
  }

  place(id: number, node: number) {
    const a = this.actor(id), n = nodeById(this.game.board, node);
    // A walk still running ends where it is (whoever waits on it goes on).
    const m = this.movers.get(id);
    if (m) { this.movers.delete(id); m.done(); }
    a.x = n.x; a.y = n.y; a.phase = 0; a.anim = 0; a.visible = true;
    this.pose.delete(id);
  }

  /** Still-pose override of a player: 18 knocked down, 19 hospital gown, 20 prison clothes; null clears it. */
  setPose(id: number, slot: number | null) { if (slot === null) this.pose.delete(id); else this.pose.set(id, slot); }
  private pose = new Map<number, number>();

  /** Shows an actor at its spot even if the rules already took it off the road (until the next sync). */
  show(id: number, visible = true) { this.actor(id).visible = visible; }

  /** Where an actor is drawn (world px). */
  actorAt(id: number): { x: number; y: number; visible: boolean; dir: number } | undefined { return this.actors.get(id); }

  /**
   * The engineering car's demolish action (08 §2.2, player_utils.asm:757-990): phase 3 on sprite B+12, one
   * frame per tick; resolves at the last frame.
   */
  demolishPose(id: number, dir?: number): Promise<void> {
    const a = this.actor(id);
    if (dir !== undefined) a.dir = dir;
    a.phase = 3; a.anim = 0;
    this.demolishWait?.done();
    const fpd = this.fpd(id) || 8;
    // Resolves at the last frame; never later than the frames would take with some slack.
    return watch('view.demolish', timeout(new Promise<void>(done => { this.demolishWait = { id, done }; }), fpd * this.tickMs * 3 + 2000, undefined))
      .then(() => { if (this.demolishWait?.id === id) this.demolishWait = null; });
  }
  private demolishWait: { id: number; done: () => void } | null = null;

  /** Lots keep the look they had when this was called, until `thawLots()` (a clip's redraw frame). */
  freezeLots() { this.lotsFrozen = true; }
  thawLots() { this.lotsFrozen = false; }
  private lotsFrozen = false;
  private lotSnap: { lands: { level: number; chain: number | boolean; owner: number }[]; facilities: { level: number; type: number; owner: number }[] } = { lands: [], facilities: [] };

  /**
   * Building flash `fcn_00451985`: the marked buildings brighten and darken in 16 steps of 30 ms
   * (+4 … +16 … −16 … 0 on 5-bit channels), then 400 ms. Resolves when done.
   */
  flashLots(refs: number[]): Promise<void> {
    this.flashing = { refs: new Set(refs), start: performance.now() };
    return new Promise(done => setTimeout(() => { this.flashing = null; done(); }, 16 * 30 + 400));
  }
  private flashing: { refs: Set<number>; start: number } | null = null;
  private static FLASH = [4, 8, 12, 16, 12, 8, 4, 0, -4, -8, -12, -16, -12, -8, -4, 0];

  private flashOver(ref: number, archive: Archive, res: number, frame: number, sx: number, sy: number) {
    const fl = this.flashing;
    if (!fl || !fl.refs.has(ref)) return;
    const step = Math.floor((performance.now() - fl.start) / 30), v = BoardView.FLASH[step] ?? 0;
    const f = this.bank.board(archive, res)?.[frame];
    if (!v || !f) return;
    const s = this.zoom * f.scale, ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = Math.min(1, Math.abs(v) / 31 * 1.6);
    ctx.globalCompositeOperation = v > 0 ? 'lighter' : 'source-over';
    ctx.drawImage(this.bank.silhouette(archive, res, f, frame, v > 0 ? 0xffffff : 0x000000), sx - f.ax * s, sy - f.ay * s, f.w * s, f.h * s);
    ctx.restore();
  }

  hide(id: number) { this.actor(id).visible = false; }

  /** Walk from the current spot to a node at `speed` world px per tick (01 §6.1). */
  move(id: number, to: number, dir: number, speed: number): Promise<void> {
    const n = nodeById(this.game.board, to);
    return this.walk(id, { x: n.x, y: n.y }, dir, speed, `view.move ${id}→${to}`);
  }

  /**
   * One walk to a world point, `speed` world px per tick (01 §6.1). It always ends: a newer walk of the same actor,
   * a change of the actor's phase (placed, posed …) or frames that stop coming finish it at its end point.
   */
  private walk(id: number, to: { x: number; y: number }, dir: number, speed: number, label: string, after?: () => void): Promise<void> {
    const a = this.actor(id);
    this.finishMove(id);
    a.dir = dir; a.visible = true;
    this.pose.delete(id);
    if (a.phase !== 1) { a.phase = 1; a.anim = 0; }
    const ticks = Math.ceil(Math.hypot(to.x - a.x, to.y - a.y) / Math.max(1, speed)) + 1;
    return watch(label, new Promise<void>(resolve => {
      const timer = setTimeout(() => this.finishMove(id), ticks * Math.max(this.tickMs, 20) * 4 + 2000);
      this.movers.set(id, { tx: to.x, ty: to.y, speed, done: () => { clearTimeout(timer); after?.(); resolve(); } });
    }));
  }

  /** Ends an actor's walk now, at its end point. */
  private finishMove(id: number) {
    const m = this.movers.get(id);
    if (!m) return;
    this.movers.delete(id);
    const a = this.actors.get(id);
    if (a) { a.x = m.tx; a.y = m.ty; }
    m.done();
  }

  /**
   * Walk to a world point off the road (the hotel guest's extra step into or out of the building, who_plays
   * 0x20 / 0x10), from `from` when given, facing `dir`; ends in the still pose there.
   */
  walkTo(id: number, to: { x: number; y: number }, dir: number, speed: number, from?: { x: number; y: number }): Promise<void> {
    const a = this.actor(id);
    this.finishMove(id);
    if (from) { a.x = from.x; a.y = from.y; }
    return this.walk(id, to, dir, speed, `view.walkTo ${id}`, () => this.stop(id));
  }

  /** Back to the still pose once a walk ends. */
  stop(id: number) { const a = this.actor(id); a.phase = 0; a.anim = 0; }

  private movers = new Map<number, { tx: number; ty: number; speed: number; done: () => void }>();
  private diceWait: { id: number; done: () => void } | null = null;

  /** The dice throw: the character's throw animation once, then the tumbling dice and the faces (08 §2.4). */
  async dice(id: number, values: number[]) {
    const a = this.actor(id);
    // The first throw must not find its pictures still loading (it used to skip the whole animation).
    const spr = this.spriteOf(id);
    // …but never waits for them for long (a picture that does not come must not stop the game).
    await watch('view.dice sprites', timeout(Promise.all([spr && this.bank.boardReady('Data', spr.res), this.bank.boardReady('Panel', 3 + Math.min(3, values.length), DICE_SCALE), this.bank.boardReady('Panel', 3, DICE_SCALE),
      values.length > 3 && this.bank.boardReady('Panel', values.length, DICE_SCALE)]), 3000, null));
    const fpd = this.fpd(id);
    if (fpd) {
      a.phase = 2; a.anim = 0;
      this.diceWait?.done();
      await watch('view.dice', timeout(new Promise<void>(done => { this.diceWait = { id, done }; }), fpd * this.tickMs * 3 + 2000, undefined));
      if (this.diceWait?.id === id) this.diceWait = null;
    }
    a.phase = 0; a.anim = 0;
    const tumble = this.bank.board('Panel', 3 + Math.min(3, values.length), DICE_SCALE);
    // 4 or 5 dice (歌舞伎町's 確變骰子 on a car, 計程車券): the 3-dice throw and a 1- or 2-dice throw in a second row.
    const ROW2: [number, number] = [24, 66];
    const tumble2 = values.length > 3 ? this.bank.board('Panel', 3 + Math.min(2, values.length - 3), DICE_SCALE) : null;
    const faces = this.bank.board('Panel', 3, DICE_SCALE);
    const sd = screenDir(a.dir, this.rot), [tx, ty] = DICE_T[sd];
    // Top-left of the 189×285 box in original view pixels, relative to the view centre (220, 260).
    const ox = 136 + tx - 220, oy = 48 + ty - 260;
    const box = (f: Frame, dx: number, dy: number) => {
      // Smaller than the original's full-size tumble so it does not cover the board on a phone.
      // Relative to where the thrower is drawn: the original's view is centred on them at (220, 260), but here the
      // camera stops at the map's edge, so near an edge they are off centre.
      const z = this.zoom * DICE_SCALE, s = z * f.scale, w = this.at(a), q = this.project(w.x, w.y);
      this.ctx.drawImage(f.img, q.x + (ox + dx) * z - f.ax * s, q.y + (oy + dy) * z - f.ay * s, f.w * s, f.h * s);
    };
    if (tumble?.length) {
      // The frame shown follows the clock (one per `frameMs`), so the tumble runs evenly whatever the timers do.
      const frameMs = Math.max(16, this.tickMs / 3), n = tumble.length, t0 = performance.now();
      let sounded = n < 30;
      this.overlay = () => {
        const i = Math.min(n - 1, Math.floor((performance.now() - t0) / frameMs));
        // fcn_00419572: the tumble FLC sounds slot 2 (Effect#10) at frame 30 (flags 0x1e000000)…
        if (i >= 29 && !sounded) { sounded = true; audio.sfx(Sfx.dice); }
        box(tumble[i], 0, 0);
        if (tumble2?.length) box(tumble2[Math.min(tumble2.length - 1, i)], ...ROW2);
      };
      await wait(frameMs * n);
      if (!sounded) audio.sfx(Sfx.dice);
    }
    // …and again when it has stopped.
    audio.sfx(Sfx.dice);
    if (faces?.length) {
      // The faces' three places (Panel#3); a 4th and 5th die (歌舞伎町's 計程車券) in a second row below the first two.
      this.overlay = () => values.forEach((v, i) => { const f = faces[(i % 3) * 6 + v - 1]; if (f) box(f, 85 + (i >= 3 ? ROW2[0] : 0), 145 + (i >= 3 ? ROW2[1] : 0)); });
    }
    // The faces stay long enough to read even at the doubled speeds.
    await wait(Math.max(400, 1000 * this.tickMs / 120));
    this.overlay = null;
  }

  /**
   * Loads what every turn needs before the first one: each player's still, walking and throwing sprites for the
   * current vehicle, the robot doll, the tumbling dice and the faces.
   */
  warm() {
    const keep = new Map(this.actors);
    for (const [id, a] of keep) {
      if (id >= this.game.npcBase) continue;
      if (this.game.world && !this.game.players[id]?.placed) continue;   // 大富豪模式: only who is in this city
      const phase = a.phase;
      for (const ph of [0, 1, 2]) { a.phase = ph; const r = this.spriteOf(id); if (r) void this.bank.boardReady('Data', r.res); }
      a.phase = phase;
    }
    for (const id of [3, 4, 5, 6]) void this.bank.boardReady('Panel', id, DICE_SCALE);
    for (const res of [521, 522]) void this.bank.boardReady('Data', res);
  }

  /** Frames per direction of the actor's current sprite (0 if not loaded yet). */
  private fpd(id: number): number {
    const r = this.spriteOf(id);
    const f = r && this.bank.board('Data', r.res);
    return f ? Math.max(1, f.length >> 3) : 0;
  }

  /** How far the frame being drawn is into the current tick (0..1). */
  private alpha = 0;

  /**
   * An actor's drawn position: walking advances only once per tick (01 §6.1; 120 ms at the slow speed), so the
   * picture slides from the tick's start to its end instead of jumping 8 times a second. A jump longer than any
   * walk step (placing, teleporting) is drawn at once.
   */
  private at(a: Actor): { x: number; y: number } {
    const px = a.px ?? a.x, py = a.py ?? a.y;
    if (Math.abs(a.x - px) + Math.abs(a.y - py) > 80) return { x: a.x, y: a.y };
    return { x: px + (a.x - px) * this.alpha, y: py + (a.y - py) * this.alpha };
  }

  private tick() {
    // A walk whose actor was put elsewhere or posed meanwhile ends at once.
    for (const id of [...this.movers.keys()]) if (this.actors.get(id)?.phase !== 1) this.finishMove(id);
    this.fx.tick();
    for (const a of this.actors.values()) { a.px = a.x; a.py = a.y; }
    for (const [id, a] of this.actors) {
      if (a.phase === 1) {
        const m = this.movers.get(id);
        if (m) {
          const dx = m.tx - a.x, dy = m.ty - a.y, dist = Math.hypot(dx, dy);
          if (dist <= m.speed) this.finishMove(id);
          else { a.x += dx / dist * m.speed; a.y += dy / dist * m.speed; }
        }
        const fpd = this.fpd(id);
        if (fpd) a.anim = (a.anim + 1) % fpd;
        if (this.sleepwalking(id)) a.zzz = (a.zzz + 1) % 6;
      } else if (a.phase === 2) {
        const fpd = this.fpd(id);
        if (this.diceWait?.id === id && (!fpd || a.anim + 1 >= fpd)) { const w = this.diceWait; this.diceWait = null; w.done(); }
        else if (fpd) a.anim++;
      } else if (a.phase === 3) {
        const fpd = this.fpd(id);
        if (fpd && a.anim + 1 < fpd) a.anim++;
        else if (this.demolishWait?.id === id) { const w = this.demolishWait; this.demolishWait = null; w.done(); }
      }
    }
  }

  private sleepwalking(id: number): boolean {
    if (id < this.game.npcBase) return this.game.players[id]?.sleepwalk > 0;
    return false;
  }

  /** Which Data.mkf resource an actor shows now (08 §1.2 priority, §1.5). */
  private spriteOf(id: number): { res: number; frozen: boolean } | null {
    const a = this.actor(id);
    const base = this.game.npcBase;
    if (id === this.game.dollId) return { res: a.phase === 1 ? 522 : 521, frozen: false };
    if (id >= base) {
      const node = this.npcs().find(([i]) => i === id)?.[1].node;
      const water = node ? nodeById(this.game.board, node).noDrop : false;
      // The NPCs' sprites follow their original actor numbers 4..7.
      return { res: 0x16c + (id - base + 4) * 4 + (water ? 2 : a.phase === 1 ? 1 : 0), frozen: false };
    }
    const p = this.game.players[id];
    if (!p) return null;
    const B = CHAR_BASE + p.character * CHAR_STRIDE;
    if (p.bankrupt) return { res: B + 18, frozen: false };
    const phase = a.phase;
    // Knocked down (18), hospital gown (19), prison clothes (20): still poses set by an effect (08 §1.2).
    const pose = this.pose.get(id);
    if (pose !== undefined && phase === 0) return { res: B + pose, frozen: false };
    if (phase === 3) return { res: B + 12, frozen: false };
    // Node status bit 31 is the water route: the character rides a speedboat there (08 §1.2).
    const water = p.node ? nodeById(this.game.board, p.node).noDrop : false;
    let slot: number;
    if (p.sleepwalk) slot = phase === 1 ? 17 : phase === 2 ? 2 : 16;
    else if (water) slot = 13 + (phase === 1 ? 1 : phase === 2 ? 2 : 0);
    else if (phase === 3) slot = 12;
    else slot = (p.traffic & 3) * 3 + (phase === 1 ? 1 : phase === 2 ? 2 : 0);
    return { res: B + slot, frozen: p.sleep > 0 && phase === 0 };
  }

  // ---------- drawing ----------

  private sprite(archive: Archive, res: number, frame: number, sx: number, sy: number, tint?: number, frozen = false) {
    const frames = this.bank.board(archive, res);
    const f = frames?.[frame];
    if (!f) return;
    const s = this.zoom * f.scale;
    let img = tint !== undefined ? this.bank.tint(archive, res, f, frame, tint) : f.img;
    if (frozen) img = this.bank.frozen(archive, res, f, frame);
    this.ctx.imageSmoothingEnabled = f.scale !== 1;
    this.ctx.drawImage(img, sx - f.ax * s, sy - f.ay * s, f.w * s, f.h * s);
  }

  /**
   * Keeps the whole view over the ground (2304×2304; a bigger remake map its own size), so no empty space shows past the map's edge: the four view
   * corners move with the camera, so each axis allows the camera only where every corner stays inside. When the
   * view is larger than the map (the whole-map overview) it centres instead.
   */
  private keepOnBoard() {
    const c = this.clampCam(this.cam.x, this.cam.y);
    this.cam.x = c.x; this.cam.y = c.y;
  }

  /** Where the camera may be for a wanted point (the view corners' offsets from the camera do not depend on it). */
  private clampCam(x: number, y: number): { x: number; y: number } {
    const { a, b, c, d } = this.basis(), det = a * d - b * c, out = { x, y };
    let lx = Infinity, hx = -Infinity, ly = Infinity, hy = -Infinity;
    for (let i = 0; i < 4; i++) {
      const u = (i & 1 ? this.W : 0) - this.W / 2, v = (i & 2 ? this.H : 0) - this.H * this.fy;
      const ox = (d * u - c * v) / det, oy = (-b * u + a * v) / det;
      lx = Math.min(lx, ox); hx = Math.max(hx, ox); ly = Math.min(ly, oy); hy = Math.max(hy, oy);
    }
    const S = worldSize(this.game.board);
    const loX = -lx, hiX = S - hx, loY = -ly, hiY = S - hy;
    out.x = loX > hiX ? S / 2 : Math.max(loX, Math.min(hiX, x));
    out.y = loY > hiY ? S / 2 : Math.max(loY, Math.min(hiY, y));
    return out;
  }

  /** The world quad the canvas shows with the camera at (x, y), corners in order round it. */
  private viewQuad(x: number, y: number): { x: number; y: number }[] {
    const cx = this.cam.x, cy = this.cam.y;
    this.cam.x = x; this.cam.y = y;
    const q = [this.unproject(0, 0), this.unproject(this.W, 0), this.unproject(this.W, this.H), this.unproject(0, this.H)];
    this.cam.x = cx; this.cam.y = cy;
    return q;
  }

  private plateAngle = new Map<number, number>();
  /**
   * Owned plots tinted in the owner's colour on the ground (under the world transform), so whose house it is
   * shows at a glance: a lot is a 48 px square, a facility or company plot 96 px, turned to face its road.
   */
  /**
   * Step marks (the remake's own maps): a pale notch across both edges of the road halfway between two squares, so
   * a throw can be counted square by square in every ground style. Drawn on the ground, in world pixels.
   */
  private stepMarks(ctx: CanvasRenderingContext2D) {
    const b = this.game.board;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = 'rgba(255, 246, 214, 0.9)';
    ctx.beginPath();
    for (const n of b.nodes) {
      if (n.noDrop) continue;
      for (const id of n.adjacent) {
        if (!id || id < n.id) continue;
        const m = b.nodes[id - 1];
        if (!m || m.noDrop) continue;
        const dx = m.x - n.x, dy = m.y - n.y, L = Math.hypot(dx, dy);
        if (L < 1) continue;
        const mx = (n.x + m.x) / 2, my = (n.y + m.y) / 2, px = -dy / L, py = dx / L;
        for (const s of [-1, 1]) {
          ctx.moveTo(mx + px * s * 21, my + py * s * 21);
          ctx.lineTo(mx + px * s * 11, my + py * s * 11);
        }
      }
    }
    ctx.stroke();
    ctx.restore();
  }

  private ownerPlates(ctx: CanvasRenderingContext2D) {
    const g = this.game, b = g.board;
    // The plot faces the road squares that belong to it (the map compiler draws the outlines the same way).
    const angle = (ref: number, x: number, y: number) => {
      let a = this.plateAngle.get(ref);
      if (a === undefined) {
        const own = b.nodes.filter(n => n.ref === ref);
        let tx = 0, ty = 0;
        if (own.length) { for (const n of own) { tx += n.x; ty += n.y; } tx /= own.length; ty /= own.length; }
        else { let d = Infinity; for (const n of b.nodes) { const e = Math.hypot(n.x - x, n.y - y); if (e < d) { d = e; tx = n.x; ty = n.y; } } }
        a = Math.atan2(y - ty, x - tx); this.plateAngle.set(ref, a);
      }
      return a;
    };
    const plate = (ref: number, x: number, y: number, owner: number, side: number) => {
      const p = g.players[owner - 1];
      if (!p || p.bankrupt) return;
      const a = angle(ref, x, y), c = Math.cos(a), s = Math.sin(a), h = side / 2;
      const color = CHARACTERS[p.character].color, rgb = `${color >> 16 & 255}, ${color >> 8 & 255}, ${color & 255}`;
      ctx.beginPath();
      for (const [u, v] of [[-h, -h], [h, -h], [h, h], [-h, h]]) ctx.lineTo(x + u * c - v * s, y + u * s + v * c);
      ctx.closePath();
      // Flashing lots (a street's toll, angel/devil cards…) pulse on the plate too, so empty lots show it.
      let glow = 0;
      if (this.flashing?.refs.has(ref)) { const k = Math.min(1, (performance.now() - this.flashing.start) / 480); glow = Math.sin(k * Math.PI * 2) * 0.32; }
      ctx.fillStyle = `rgba(${rgb}, ${0.38 + Math.max(0, glow)})`; ctx.fill();
      if (glow > 0) { ctx.fillStyle = `rgba(255, 255, 255, ${glow * 0.6})`; ctx.fill(); }
      ctx.lineWidth = 3; ctx.strokeStyle = `rgba(${rgb}, .95)`; ctx.stroke();
    };
    for (const l of b.lands) if (l.owner) plate(l.id + 2000, l.x, l.y, l.owner, 44);
    for (const f of b.facilities) if (f.owner) plate(f.id + 4000, f.x, f.y, f.owner, 86);
    for (const co of b.companies) if (co.controller) plate(co.id + 6000, co.x, co.y, co.controller, 86);
  }

  private edge: string | null = null;
  /** The ground's average border colour, filling what lies past the map when the view is larger than it. */
  private edgeColor(): string {
    if (this.edge) return this.edge;
    try {
      const c = document.createElement('canvas'); c.width = c.height = 64;
      // The redrawn style's preview when there is one: drawing the original picture would decode all of it.
      const x = c.getContext('2d', { willReadFrequently: true })!; x.drawImage(this.tiled?.preview ?? this.art.ground, 0, 0, 64, 64);
      const px = x.getImageData(0, 0, 64, 64).data; let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < 64; i++) for (const [u, v] of [[i, 0], [i, 63], [0, i], [63, i]]) { const o = (v * 64 + u) * 4; r += px[o]; g += px[o + 1]; b += px[o + 2]; n++; }
      this.edge = `rgb(${Math.round(r / n * .8)}, ${Math.round(g / n * .8)}, ${Math.round(b / n * .8)})`;
    } catch { this.edge = '#0b2427'; }
    return this.edge;
  }

  private lastDraw = 0;

  /** The ground as last drawn, in chunks that follow the camera (see `GroundCache`). */
  private ground = new GroundCache();
  /** Which ground and which of its versions the cache shows. */
  private groundSeen = { gen: -1, version: 0 };

  private drawGround(ctx: CanvasRenderingContext2D, e: number, f: number) {
    const dpr = this.dpr, t = this.tiled, { a, b, c, d } = this.basis(), W = this.canvas.width, H = this.canvas.height;
    // The tiles under the view and the ring of chunks round it (the next ones a pan uncovers).
    if (t) t.update(this.ground.area(W, H, (x, y) => this.unproject(x / dpr, y / dpr)), this.zoom * S * dpr);
    const seen = this.groundSeen, version = t?.version ?? 0;
    const changed = seen.gen !== this.groundGen ? null : t && version !== seen.version ? t.changedSince(seen.version) : [];
    this.groundSeen = { gen: this.groundGen, version };
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ground.draw(ctx, { a: a * dpr, b: b * dpr, c: c * dpr, d: d * dpr, e: e * dpr, f: f * dpr }, W, H,
      `${this.rot}|${this.zoom}|${dpr}|${this.groundGen}`, this.edgeColor(),
      (x, area) => { if (t) t.paint(x, area, this.art.ground); else x.drawImage(this.art.ground, 0, 0); }, changed);
  }

  /** Camera for this frame: a glide in progress, else easing after the followed actor (time-based, see `glide`). */
  private moveCamera() {
    const now = performance.now(), dt = this.lastDraw ? Math.min(100, now - this.lastDraw) : 16.7;
    this.lastDraw = now;
    // The same easing per 60th of a second as before (0.2 and 0.25 of the way), whatever the frame rate.
    this.fy += (this.focusY - this.fy) * (1 - Math.pow(0.8, dt / 16.7));
    const g = this.glide;
    if (g) {
      const to = g.to(), u = Math.min(1, (now - g.t0) / g.ms);
      if (to) {
        const end = this.clampCam(to.x, to.y), e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
        this.cam.x = g.x0 + (end.x - g.x0) * e; this.cam.y = g.y0 + (end.y - g.y0) * e;
      }
      if (u >= 1 || !to) { this.glide = null; g.done?.(); }
    } else if (this.follow !== null) {
      const a = this.actors.get(this.follow);
      if (a?.visible) {
        const q = this.at(a), k = 1 - Math.pow(0.75, dt / 16.7);
        this.cam.x += (q.x - this.cam.x) * k; this.cam.y += (q.y - this.cam.y) * k;
      }
    }
    this.keepOnBoard();
  }

  private draw() {
    const g = this.game, ctx = this.ctx, b = g.board;
    this.frameNo++;
    this.moveCamera();

    // 1. Ground: the whole texture under one affine transform (08 §4.3), kept drawn in chunks (`GroundCache`).
    const { a, b: bb, c, d } = this.basis();
    const e = this.W / 2 - a * this.cam.x - c * this.cam.y, f = this.H * this.fy - bb * this.cam.x - d * this.cam.y;
    try { this.drawGround(ctx, e, f); } catch (err) { this.oops('ground', err); }
    ctx.setTransform(a * this.dpr, bb * this.dpr, c * this.dpr, d * this.dpr, e * this.dpr, f * this.dpr);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    if (this.art.stepMarks) this.stepMarks(ctx);
    this.ownerPlates(ctx);
    this.street?.drawGround(ctx); // 歌舞伎町's avenues and rails round the board (docs/rules/21 §8.3)
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    const visible = (x: number, y: number, m = 200) => {
      const p = this.project(x, y);
      return p.x > -m && p.x < this.W + m && p.y > -m && p.y < this.H + m * 1.5 ? p : null;
    };

    // 2. Event icons, flat on the ground (map#24, frame aux - 1, never rotated).
    for (const n of b.nodes) {
      // 大富豪模式 (docs/rules/17 §2): 車站 / 機場 have their own pads (map sprites 9017 / 9018, the size of map#24's).
      if (n.event === 17 || n.event === 18) {
        const p = visible(n.x, n.y, 60);
        if (p) {
          this.sprite('map', n.event === 17 ? 9017 : 9018, 0, p.x, p.y);
        }
        continue;
      }
      // 歌舞伎町 (docs/rules/21 §7.1): 柏青哥店 / 拉霸店 have their own pads (map sprites 9019 / 9020, the same size).
      const pad = this.street ? kbPadSprite(g, n.event) : 0;
      if (pad) {
        const p = visible(n.x, n.y, 60);
        if (p) this.sprite('map', pad, 0, p.x, p.y);
        continue;
      }
      if (!n.aux) continue;
      const p = visible(n.x, n.y, 60);
      if (p) this.sprite('map', 24, n.aux - 1, p.x, p.y);
    }
    // 岔路箭頭 (docs/rules/14): a small arrow on the grass beside every fork, under buildings and players
    // (歌舞伎町: bigger and glowing, over its busy street, after the sprites below).
    if (!this.street) drawForkArrows(ctx, g, (x, y) => this.project(x, y), this.zoom, this.W, this.H, this.art.decor);

    // 3. Surcharge / seizure diamonds pressed into the ground, then the y-sorted sprites.
    const items: Item[] = [];
    const add = (sy: number, layer: number, draw: () => void) => items.push({ key: sy * 16 + layer, draw });
    const stage = b.mapId >> 2, inStage = b.mapId & 3;
    const ownerColor = (o: number) => (o ? CHARACTERS[g.players[o - 1]?.character ?? 0].color : 0);

    // While a clip plays, the lots keep their look until the clip's redraw frame (11 §0.2): draw a snapshot.
    if (!this.lotsFrozen) this.lotSnap = { lands: b.lands.map(l => ({ level: l.level, chain: l.chain, owner: l.owner })), facilities: b.facilities.map(f => ({ level: f.level, type: f.type, owner: f.owner })) };
    const snap = this.lotsFrozen ? this.lotSnap : null;
    for (const [li, live] of b.lands.entries()) {
      const l = { ...live, ...snap?.lands[li] };
      const p = visible(l.x, l.y);
      if (!p) continue;
      const fr = buildingFrame(l.facing, this.rot);
      if (l.tmpState) this.decal(fr & 1, l.tmpState & 1, p.x, p.y);
      if (l.level) {
        const res = kbHouseSprite(g, l) ?? (l.chain ? 79 + b.mapId : 39 + b.mapId * 5 + l.level - 1); // 歌舞伎町's houses (21)
        add(p.y, Layer.building, () => { this.sprite('map', res, fr, p.x, p.y, ownerColor(l.owner)); this.neon(res, fr, p.x, p.y, l.id + 2000); this.flashOver(l.id + 2000, 'map', res, fr, p.x, p.y); });
      } else if (l.owner) {
        const ch = g.players[l.owner - 1]?.character ?? 0;
        add(p.y, Layer.building, () => this.sprite('map', 25, ch, p.x, p.y));
      }
      if (this.highlight === l.id - 1) add(p.y, Layer.zzz + 1, () => this.ring(p.x, p.y));
    }
    for (const [fi, live] of b.facilities.entries()) {
      const fa = { ...live, ...snap?.facilities[fi] };
      const p = visible(fa.x, fa.y, 260);
      if (!p) continue;
      const fr = buildingFrame(0, this.rot);
      if (fa.tmpState) this.decal(2 + (fr & 1), fa.tmpState & 1, p.x, p.y);
      if (fa.level) {
        const i = fa.type === 0 ? 0 : fa.type === 1 ? fa.level : fa.type === 2 ? 5 + fa.level : fa.type === 3 ? 11 : 11 + fa.level;
        // 大富翁城's casino (docs/rules/19), 歌舞伎町's shops (21)
        const res = casinoSprite(fa) ?? kbShopSprite(g, fa) ?? (stage === 0 ? 87 + i : 104 + inStage * 17 + i);
        add(p.y, Layer.building, () => { this.sprite('map', res, fr, p.x, p.y, ownerColor(fa.owner)); this.neon(res, fr, p.x, p.y, fa.id + 4000); this.flashOver(fa.id + 4000, 'map', res, fr, p.x, p.y); });
      } else if (fa.owner) {
        const ch = g.players[fa.owner - 1]?.character ?? 0;
        add(p.y, Layer.building, () => this.sprite('map', 25, ch, p.x, p.y));
      }
    }
    for (const co of b.companies) {
      if (!co.resource) continue;
      const p = visible(co.x, co.y, 260);
      if (p) add(p.y, Layer.building, () => this.sprite('map', co.resource + 38, buildingFrame(co.facing, this.rot), p.x, p.y, ownerColor(co.controller)));
    }
    for (const [li, ls] of b.landscapes.entries()) {
      if (!ls.resource) continue;
      const p = visible(ls.x, ls.y, 300);
      // Landscapes keep their own outline colour (09 §3.4); a magenta placeholder is drawn as a dark line.
      if (p) add(p.y, Layer.building, () => {
        const res = ls.resource + 38, fr = buildingFrame(ls.facing, this.rot);
        this.sprite('map', res, fr, p.x, p.y, this.bank.placeholderOutline('map', res) ? 0x202020 : undefined);
        this.neon(res, fr, p.x, p.y, 8000 + li);
      });
    }

    // Decorations (plants; the remake's own maps): sorted with the buildings, the season from the calendar.
    if (this.art.decor?.length) {
      const m = month(g.date), season = m >= 3 && m <= 5 ? 0 : m >= 6 && m <= 8 ? 1 : m >= 9 && m <= 11 ? 2 : 3;
      for (const [di, d] of this.art.decor.entries()) {
        const p = visible(d.x, d.y, 90);
        if (!p || this.street?.covers(d.x, d.y)) continue;
        add(p.y, Layer.building, () => {
          const n = this.bank.board('map', d.res)?.length ?? 0;
          if (n) { this.sprite('map', d.res, Math.min(season, n - 1), p.x, p.y); this.neon(d.res, Math.min(season, n - 1), p.x, p.y, 9000 + di); }
        });
      }
    }

    // 歌舞伎町 (docs/rules/21 §4): 黑幫 and 拉客仔 stand on their road squares like the gods; the passers-by (§8.1)
    // walk the sidewalks, sorted with the buildings and under the figures (never picked).
    if (this.street) {
      const fr = buildingFrame(0, this.rot);
      for (const o of kbFigures(g)) {
        const n = nodeById(b, o.node), p = visible(n.x, n.y);
        if (p) add(p.y, Layer.building, () => this.sprite('map', o.res, fr, p.x, p.y));
      }
      this.street.advance();
      this.street.beginFrame();
      this.street.collect(this.streetView(a, bb, c, d, visible), (y, draw) => add(y, Layer.building, draw));
    }

    // Map objects: on a node, or following a player (08 §3.5).
    const slots = (g as unknown as { objects?: { slots?: { type: number; node: number; dir: number; owner: number }[] } }).objects?.slots ?? [];
    for (const o of slots) {
      if (!o.type) continue;
      if (o.owner) {
        const pl = g.players[o.owner - 1], a = pl && this.actors.get(pl.id);
        if (!pl || !a?.visible || g.offRoad(pl)) continue;
        const sd = screenDir(a.dir, this.rot), w = this.at(a), q = this.project(w.x, w.y);
        const far = o.type === 18 && pl.god > 0;
        const [ox, oy] = (far ? ATTACH_FAR : ATTACH)[sd];
        const x = q.x + ox * this.zoom, y = q.y + oy * this.zoom;
        add(y, Layer.building, () => this.sprite('Data', 395 + o.type, (sd + 4) & 7, x, y));
      } else if (o.node && !this.hiddenObjects.has(o.node)) {
        const n = nodeById(b, o.node), p = visible(n.x, n.y);
        if (p) add(p.y, Layer.building, () => this.sprite('Data', 395 + o.type, screenDir(o.dir, this.rot), p.x, p.y));
      }
    }

    // Players and NPCs.
    for (const [id, a] of this.actors) {
      if (!a.visible) continue;
      const pl = id < g.npcBase ? g.players[id] : undefined;
      if (id < g.npcBase && !pl) continue;
      const w = this.at(a), p = visible(w.x, w.y);
      if (!p) continue;
      const spr = this.spriteOf(id);
      if (!spr) continue;
      const layer = id === this.current ? Layer.current : id < g.npcBase ? Layer.player : Layer.npc;
      add(p.y, layer, () => {
        const frames = this.bank.board('Data', spr.res);
        if (!frames) return;
        const fpd = Math.max(1, frames.length >> 3);
        const anim = Math.min(a.anim, fpd - 1);
        this.sprite('Data', spr.res, screenDir(a.dir, this.rot) * fpd + anim, p.x, p.y, undefined, spr.frozen);
      });
      if (pl?.sleepwalk) add(p.y, Layer.zzz, () => this.sprite('Data', 414, a.zzz, p.x, p.y));
    }

    this.fx.draw(add);
    items.sort((x, y) => x.key - y.key);
    // One picture that fails (released, not decodable) must not take the rest of the frame with it.
    for (const it of items) { try { it.draw(); } catch (err) { this.oops('sprite', err); } }
    if (this.street) drawForkArrows(ctx, g, (x, y) => this.project(x, y), this.zoom, this.W, this.H, this.art.decor, { scale: 1.6, glow: true });
    if (this.overWorld) {
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      try { this.overWorld(ctx, this.W, this.H, this.dpr, this.zoom); } catch (err) { this.oops('weather', err); }
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }
    if (this.street) this.badges();

    // Picking (09 §7.5): the spots that may be picked glow, drawn over the board so icons do not hide them.
    if (this.picking) {
      const t = performance.now() / 220, z = this.zoom, pulse = 0.5 + 0.5 * Math.sin(t), shapes = this.pickShapes();
      for (const i of this.pickAllowed()) {
        const s = this.picking.spots[i], sh = shapes[i];
        if (!sh) continue;
        const q = sh.glow, r = BoardView.spotRadius(s);
        ctx.save();
        // A figure keeps showing through its ring.
        const fill = s.at === 'actor' ? 0.1 + 0.08 * pulse : 0.22 + 0.18 * pulse;
        ctx.fillStyle = `rgba(255, 236, 90, ${fill})`;
        ctx.strokeStyle = `rgba(255, 250, 160, ${0.7 + 0.3 * pulse})`;
        ctx.shadowColor = '#ffd23f'; ctx.shadowBlur = 10;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.ellipse(q.x, q.y, (r + 4 * pulse) * z, (r + 4 * pulse) * z * K, 0, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
        if (s.at === 'actor') {
          // A bouncing marker over the figure, so a person to tap reads apart from a square.
          const y = q.y - ((g.players[s.id]?.bomb ? 84 : 66) + 6 * pulse) * z; // above the head (and a bomb's count)
          ctx.beginPath();
          ctx.moveTo(q.x, y + 12 * z); ctx.lineTo(q.x - 9 * z, y); ctx.lineTo(q.x + 9 * z, y); ctx.closePath();
          ctx.fillStyle = 'rgba(255, 226, 60, .95)'; ctx.fill(); ctx.stroke();
        }
        ctx.restore();
      }
    }

    // Carried time bombs show their steps left above them.
    for (const o of slots) {
      if (o.type !== 18 || !o.owner) continue;
      const pl = g.players[o.owner - 1], a = pl && this.actors.get(pl.id);
      if (!a?.visible) continue;
      const w = this.at(a), q = this.project(w.x, w.y);
      ctx.font = `700 ${Math.round(14 * this.zoom)}px system-ui`;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 3;
      const life = (o as { life?: number }).life ?? 0;
      ctx.strokeText(String(life), q.x, q.y - 60 * this.zoom);
      ctx.fillText(String(life), q.x, q.y - 60 * this.zoom);
    }

    // Steps left: Data#517 digits under the view.
    if (this.stepsLeft !== null && this.stepsLeft > 0) {
      const digits = String(this.stepsLeft), z = this.zoom;
      digits.split('').forEach((ch, i) => {
        const x = this.W / 2 + (25 - digits.length * 25 + 50 * i) * z, y = Math.min(this.H - 20, this.H * this.fy + 140 * z);
        this.sprite('Data', 517, 8 + Number(ch), x, y);
      });
    }
    this.overlay?.();
  }

  /** What 歌舞伎町's street draws with this frame (docs/rules/21 §8): the projection, the view and the map sprites. */
  private streetView(a: number, b: number, c: number, d: number, visible: (x: number, y: number, m?: number) => { x: number; y: number } | null): StreetView {
    return {
      ctx: this.ctx, zoom: this.zoom, rot: this.rot, W: this.W, H: this.H, visible,
      project: (x, y) => this.project(x, y),
      toScreen: (dx, dy) => ({ x: a * dx + c * dy, y: b * dx + d * dy }),
      sprite: (res, frame, sx, sy, flip = false, alpha = 1) => {
        if (!flip && alpha === 1) { this.sprite('map', res, frame, sx, sy); return; }
        this.ctx.save();
        this.ctx.globalAlpha = alpha;
        if (flip) { this.ctx.translate(sx, 0); this.ctx.scale(-1, 1); sx = 0; }
        this.sprite('map', res, frame, sx, sy);
        this.ctx.restore();
      },
    };
  }

  /** 歌舞伎町's neon (docs/rules/21 §8.2) over a landmark, shop or house just drawn at (sx, sy). */
  private neon(res: number, frame: number, sx: number, sy: number, id: number) {
    if (!this.street || !KbStreet.glows(res)) return;
    const f = this.bank.board('map', res)?.[frame];
    if (!f) return;
    const s = this.zoom * f.scale;
    this.street.glow(this.ctx, f.img, id, sx - f.ax * s, sy - f.ay * s, f.w * s, f.h * s);
  }

  /** 歌舞伎町's signs over the heads (docs/rules/21 §2.2 「處理事務中」, §4.1 「黑幫附身」): small rounded tags. */
  private badges() {
    const g = this.game, ctx = this.ctx, z = this.zoom;
    const fs = Math.max(11, Math.min(15, 11 * z));
    for (const p of g.players) {
      const list = kbBadges(g, p.id), a = this.actors.get(p.id);
      if (!list.length || !a?.visible || g.offRoad(p)) continue;
      const w = this.at(a), q = this.project(w.x, w.y);
      // Above the head, and above a carried bomb's count.
      let y = q.y - ((p.bomb ? 78 : 64) * z) - fs * 0.4;
      ctx.save();
      ctx.font = `800 ${fs}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const t of list) {
        const tw = ctx.measureText(t.text).width, h = fs + 6, bw = tw + 12, x0 = q.x - bw / 2, y0 = y - h;
        ctx.beginPath();
        ctx.roundRect(x0, y0, bw, h, h / 2);
        ctx.fillStyle = t.kind === 'gang' ? 'rgba(28, 24, 30, .92)' : t.kind === 'taxi' ? 'rgba(255, 196, 0, .95)' : 'rgba(64, 82, 212, .92)';
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = t.kind === 'gang' ? '#ffd84a' : '#fff';
        ctx.stroke();
        ctx.fillStyle = t.kind === 'gang' ? '#ffd84a' : t.kind === 'taxi' ? '#2a1a00' : '#fff';
        ctx.fillText(t.text, q.x, y0 + h / 2 + 0.5);
        y = y0 - 3;
      }
      ctx.restore();
    }
  }

  /** map#26 diamond ORed into the ground: red for a surcharge, blue for a seizure (08 §3.2). */
  private decal(frame: number, kind: number, sx: number, sy: number) {
    const frames = this.bank.board('map', 26), f = frames?.[frame];
    if (!f) return;
    const s = this.zoom * f.scale, ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.bank.silhouette('map', 26, f, frame, kind ? 0x0010ff : 0xff0000), sx - f.ax * s, sy - f.ay * s, f.w * s, f.h * s);
    ctx.restore();
  }

  private ring(x: number, y: number) {
    const ctx = this.ctx, t = performance.now() / 300, z = this.zoom;
    ctx.save();
    ctx.strokeStyle = `rgba(255,194,62,${0.6 + 0.4 * Math.sin(t)})`;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.ellipse(x, y, 30 * z, 30 * z * K, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // ---------- effects (docs/rules/11) ----------

  /** Back to following the current actor after an effect looked elsewhere. */
  refollow() { if (this.current >= 0) this.followActor(this.current); }

  /** Screen px per original px (for effects drawn in CSS px over the map). */
  get zoomLevel() { return this.zoom; }

  /** World anchor of a lot (land 2001.., facility 4001..), as its building is drawn. */
  lotPos(ref: number): { x: number; y: number } | null {
    const b = this.game.board;
    const l = ref > 2000 && ref < 4000 ? b.lands[ref - 2001] : ref > 4000 && ref < 6000 ? b.facilities[ref - 4001] : undefined;
    return l ? { x: l.x, y: l.y } : null;
  }

  /**
   * Where a player's attached god is drawn (08 §3.5): world point of the player, screen offset by the
   * attach table, frame = (player's screen direction + 4) & 7.
   */
  attachedAt(id: number): { at: { x: number; y: number }; offset: [number, number]; frame: number } | null {
    const a = this.actors.get(id);
    if (!a) return null;
    const sd = screenDir(a.dir, this.rot), [ox, oy] = ATTACH[sd];
    return { at: { x: a.x, y: a.y }, offset: [ox, oy], frame: (sd + 4) & 7 };
  }

  private objectAt(node: number): { type: number; dir: number } | undefined {
    const slots = (this.game as unknown as { objects?: { slots?: { type: number; node: number; dir: number; owner: number }[] } }).objects?.slots ?? [];
    return slots.find(o => o.type && !o.owner && o.node === node);
  }

  /**
   * The robot doll knocks an object away (`fcn_0040fafd`, 11 §2.1): it leaves its node in the doll's walking
   * direction at half the node distance per tick, keeps its own facing, is drawn over everything (key 0x7ff0)
   * and stops being drawn once it leaves the ±14-cell window. Not blocking.
   */
  knockAway(node: number, from: number) {
    const o = this.objectAt(node);
    if (!o) return;
    const a = nodeById(this.game.board, node), b = nodeById(this.game.board, from);
    let dx = (a.x - b.x) / 2, dy = (a.y - b.y) / 2;
    if (!dx && !dy) dy = 16;
    // Ticks until it is 14 cells (448 px) away from the doll's spot, as the original's window test.
    const ticks = Math.min(255, Math.ceil(448 / Math.max(Math.abs(dx), Math.abs(dy))));
    this.hiddenObjects.add(node);
    const res = 395 + o.type;
    void this.fx.fly({ res, dir: o.dir, from: { x: a.x + dx, y: a.y + dy }, to: { x: a.x + dx * (ticks + 1), y: a.y + dy * (ticks + 1) }, ticks });
    // The rules remove the object right after this event; show the node empty from now on.
    setTimeout(() => this.hiddenObjects.delete(node), 2 * this.tickMs);
  }

  /** Map coordinates of the player, for UI that needs it. */
  playerAt(p: Player) { return this.actors.get(p.id); }
}

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
