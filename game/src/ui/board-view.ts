/**
 * The board as the original draws it (docs/rules/08): an 8-way rotatable oblique projection of the
 * 2304×2304 ground, with every sprite anchored at its projected world point and drawn in screen-y order.
 * Everything is drawn at the device's real resolution; redrawn (4x) frames are used where they exist.
 */
import { CHARACTERS } from '../core/characters';
import { REVIVE, type Game } from '../core/game';
import { shortMoney } from './rt-rank';
import { nodeById, worldSize } from '../core/board';
import { month } from '../core/date';
import type { PickSpot, Player } from '../core/types';
import { ASSETS, type MapArt } from './assets';
import type { Archive, Frame, SpriteBank } from './sprites';
import { audio, Sfx } from './audio';
import { Effects, TOP, type FxHost } from './effects';
import { describe, InfoBubble } from './map-info';
import { drawForkArrows } from './fork-arrows';
import type { TiledGround } from './ground';
import { GroundCache } from './ground-cache';
import { casinoSprite } from './casino-sprite'; // 大富翁城 (docs/rules/19)
import { hotelSprite } from './hotels'; // the redrawn 旅館 levels 4 and 5
import { ah11Hides, ah11Placements } from './ah11'; // the APARTMENT HOTEL 11 towers (decoration)
import { cityLotSprite } from './city-lots'; // the five cities' own shops on the small lots
import { kbBadges, kbFigures, kbHouseSprite, kbPadSprite, kbRules, kbShopSprite, KbStreet } from './kabukicho'; // 歌舞伎町 (docs/rules/21)
import type { StreetView } from './kb-ambient';
import { jqBadges, jqFacSprite, jqHouseSprite, jqPadSprite, jqRules } from './jiqing'; // 激情歲月 (docs/rules/24)
import { JqStreet } from './jq-street';
import { MkStreet } from './mk-street';
import { cqCompanySprite, cqFacSprite, cqHouseSprite, LEVEL_NAMES, nodeLevel } from './chongqing'; // 重慶's stacked levels (docs/rules/33)
import type { BoardNode } from '../core/board';
import { timeout, watch } from './watchdog';

/** A map made in the editor (a player's, ids 5000.., or an official one such as 長安): its bank and store companies have no plot. */
import { EDITOR_MADE_MAPS } from '../core/modules/stocks';
const plotless = (mapId: number) => mapId >= 5000 || EDITOR_MADE_MAPS.has(mapId);
import { pickAt, visible as shapeVisible, type Piece, type Shape } from './pick-hit';
import { SMALL_PAD_GROW, SMALL_PAD_W } from './maker/model';

const S = 1.2175, K = Math.SQRT1_2;
/** Original view: 440×440, the camera point at its centre. */
const VIEW = 440;

/** Frames per direction [character][slot] = resource frames / 8 (08 §1.4); the code derives it the same way. */
const CHAR_BASE = 128, CHAR_STRIDE = 21;
/**
 * Pictures the original drew out of scale, drawn at this size: the 間諜's speedboat (Data#394) shows him about twice his
 * walking size (87×110 against the other NPCs' 43–64 wide boats) — the user 2026-11-24: 「間諜坐船這個建模…變大了」. At 0.6
 * his head is his walking head's size and his boat the other NPCs' (one character, one scale).
 */
const SPRITE_SIZE: Record<number, number> = { 394: 0.6 };
/** Attached god / carried bomb offsets in screen pixels by the player's screen direction (08 §3.5). */
const ATTACH = [[-10, -22], [-22, -10], [-22, 10], [-10, 22], [10, 22], [22, 10], [22, -10], [10, -22]];
const ATTACH_FAR = [[-18, -44], [-44, -18], [-44, 18], [-18, 44], [18, 44], [44, 18], [44, -18], [18, -44]];
/** Dice tumble offset by screen direction (08 §2.4, 0x475224). */
const DICE_T = [[4, 12], [12, 12], [8, 6], [-4, -6], [-12, -12], [-24, -12], [-20, -6], [-12, 6]];
/** Size of the dice animation relative to the board. */
const DICE_SCALE = 0.6;
const Layer = { building: 0, npc: 8, player: 0xc, current: 0xd, zzz: 0xe } as const;

/** Large plots (facility ids) whose square the redrawn grounds do not show, by map (issue #73). */
const MISSING_PLOT_ART: Record<number, number[]> = { 7: [7] };

/** The board views on screen now (ui/pad.ts: a controller picks and pans on the one in front). */
export const liveViews = new Set<BoardView>();

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
  /** 即時制: the squares of a walk laid on the clock (BoardView.glide), drawn where the time says (BoardView.walkTimed). */
  segs?: Seg[];
  /** When its last square was reached (performance.now ms): standing a moment, it stops walking in place. */
  idleAt?: number;
}

/** One square of a glide: from, to, when it starts (performance.now ms), how long, the way it faces. */
interface Seg { fx: number; fy: number; tx: number; ty: number; t0: number; ms: number; dir: number; done: () => void }

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

/**
 * Whose original houses and facilities a map's lots show (39 + set × 5 + level − 1, chains 79 + set; facilities by
 * set >> 2 and set & 3): the original maps their own;
 * a player's map (自建地圖, ids from 5000) its stock template's map (the user 2026-11-12: 阿土伯's lots showed no
 * houses — there are no house pictures for id 5000).
 */
const houseSet = (b: { mapId: number; stockGroup?: number }) => (b.mapId >= 5000 ? ((b.stockGroup ?? 0) % 8 + 8) % 8 : b.mapId);

/** Pads drawn at the 小事件's size whatever their picture (清明上河's 梁山 mini-games: 景陽岡, 野豬林, 相撲, 黃泥岡, 十字坡). */
const MINI_GAME_PAD = /\/pad-(tiger|pig|wrestle|gang|inn)\.webp$/;

export class BoardView {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  /** 清明上河's 梁山旗 (MapRules.lotFlag), loaded the first time a lot carries one. */
  private flagImg: HTMLImageElement | null = null;
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
  /**
   * What an effect is about, ringed on the map while it shows (camera rules, docs/rules/11 §7.1): lots and
   * facilities by ref (2001.. / 4001..), and squares by node id (a patient's hospital, a prisoner's cell).
   */
  readonly marks = new Set<number>();
  readonly markNodes = new Set<number>();
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
  /** Actors not drawn yet (an NPC falling from the sky, map-fx 'qm-npc-drop'). */
  readonly falling = new Set<number>();
  /** The map info box (09 §6.4) shown by a plain tap. */
  private readonly info: InfoBubble;
  /** A redrawn ground style drawn instead of the original (null: the original). */
  private tiled: TiledGround | null = null;
  /** 歌舞伎町's passers-by and neon (docs/rules/21 §8), 激情歲月's street (24 §8); null on every other map. */
  private readonly street: KbStreet | JqStreet | MkStreet | null;

  constructor(parent: HTMLElement, readonly game: Game, readonly art: MapArt, readonly bank: SpriteBank) {
    if (import.meta.env.DEV) (window as unknown as { __board?: BoardView }).__board = this;   // (dev only: tests drive the view)
    if (art.reveal) this.revealMode = (() => { try { const v = localStorage.getItem('rich4.reveal'); return v === 'fade' || v === 'off' ? v : 'cutout'; } catch { return 'cutout'; } })();
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'board';
    parent.append(this.canvas);
    liveViews.add(this);
    this.info = new InfoBubble(parent, bank);
    this.street = kbRules(game) ? new KbStreet(game, art.walkers ?? []) : jqRules(game) ? new JqStreet(game, art.walkers ?? [])
      : art.walkerKinds?.length ? new MkStreet(game, art.walkers ?? [], art.walkerKinds, art.walkerHot, art.walkerAreas) : null;   // (長安's passers-by)
    // 激情歲月's street keeps its people and vehicles off the players' and NPCs' tokens (the user 2026-10-23).
    if (this.street instanceof JqStreet || this.street instanceof MkStreet) this.street.tokens = () => [...this.actors.values()].filter(x => x.visible).map(x => this.at(x));
    if (this.street instanceof KbStreet) this.street.ambient.frameInfo = (res, fr) => { const f = this.bank.board('map', res)?.[fr]; return f ? { img: f.img, ax: f.ax, ay: f.ay, w: f.w, h: f.h, scale: f.scale } : null; };
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
    this.looping = true;
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
      // About twice a second: the canvas's pixels still match its size on screen (see `backingStale`).
      if (++this.checks % 30 === 0 && this.backingStale()) this.resize();
      try { this.glideFrame(performance.now()); } catch (e) { this.oops('glide', e); }
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
    const r = this.size();
    // At most 2×: a phone's 3× canvas has 2.25 times the pixels to fill every frame for no visible gain.
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.W = Math.max(1, r.width); this.H = Math.max(1, r.height);
    const pw = Math.round(this.W * this.dpr), ph = Math.round(this.H * this.dpr);
    const changed = this.canvas.width !== pw || this.canvas.height !== ph;
    if (changed) { this.canvas.width = pw; this.canvas.height = ph; }
    this.zoom = Math.max(0.6, Math.min(this.W, this.H) / VIEW) * this.userZoom;
    // Sprites for the board are kept at the density it draws at (a phone: half the redrawn pixels each way).
    this.bank.setBoardDensity(this.zoom * this.dpr);
    // Setting a canvas's size clears it, and the frame loop draws only on the next frame: dragging a window's edge
    // flashed black every step (the user, the Windows build). Drawn again at once instead (the observer runs before
    // the browser paints).
    if (changed && this.alive && this.looping) { try { this.draw(); } catch (e) { this.oops('draw', e); } }
  }

  private checks = 0;
  /**
   * The canvas's pixels no longer match its size on screen (or the screen's pixel ratio): it is then shown
   * stretched — the whole map blurry — until the next resize. The resize observer only reports a change of the
   * element's size, so a size taken at an unlucky moment (iPad, issue #10: blurry after a fate board until the save
   * was loaded again) stayed; the frame loop checks it now and then.
   */
  private backingStale(): boolean {
    const r = this.size();
    if (!r.width || !r.height) return false; // hidden: nothing to match
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    return Math.abs(this.canvas.width - r.width * dpr) > 1.5 || Math.abs(this.canvas.height - r.height * dpr) > 1.5;
  }

  /**
   * The canvas's size in CSS px as laid out: the bounding box (fractional), unless a transform on the way up
   * scales it (a zooming intro, an animation caught mid-way), which the layout size leaves out.
   */
  private size(): { width: number; height: number } {
    const r = this.canvas.getBoundingClientRect(), w = this.canvas.offsetWidth, h = this.canvas.offsetHeight;
    return Math.abs(r.width - w) > 1 || Math.abs(r.height - h) > 1 ? { width: w, height: h } : r;
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
      // A finger whose lifting never arrived (seen on the iPhone) would stay held for good: with one finger counted as
      // down no tap reaches the map again (傳送機's glow, a sign's name), while GO, a button of its own, still works.
      if (e.isPrimary) this.pointers.clear();
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
    // No finger left on the glass: none is held, whatever the pointer events said.
    const lifted = (e: TouchEvent) => { if (!e.touches.length) { this.pointers.clear(); this.drag = null; } };
    c.addEventListener('touchend', lifted);
    c.addEventListener('touchcancel', lifted);
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
  /** The frame loop runs (a redraw on resize only then: the first resize comes from the constructor). */
  private looping = false;
  private resizer = new ResizeObserver(() => this.resize());
  private onKey = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement | null)?.closest?.('input, textarea')) return;
    if (e.key === 'q' || e.key === 'Q' || e.key === '[') this.rotate(-1);
    if (e.key === 'e' || e.key === 'E' || e.key === ']') this.rotate(1);
  };

  /** Stops drawing and input handling (the game was left or another one loaded). */
  destroy() {
    this.alive = false;
    liveViews.delete(this);
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
      const pad = this.street instanceof KbStreet ? kbPadSprite(g, n.event) : jqPadSprite(g, n);
      if (n.event === 17 || n.event === 18) { if (near(n.x, n.y, 60)) add('map', n.event === 17 ? 9017 : 9018); }
      else if (pad) { if (near(n.x, n.y, 60)) add('map', pad); }
      else if (n.aux && near(n.x, n.y, 60)) add('map', 24);
      const lv = this.art.levels;   // 重慶's 扶梯 / 直梯 pads
      if (lv && (lv.escalator.includes(n.id) || lv.elevator.includes(n.id)) && near(n.x, n.y, 60)) add('map', lv.escalator.includes(n.id) ? 9201 : 9202);
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
    for (const [ci, co] of b.companies.entries()) if (co.resource && near(co.x, co.y, 260)) add('map', this.art.levels ? cqCompanySprite(this.art.levels, ci, co.resource + 38) : co.resource + 38);
    for (const ls of b.landscapes) if (ls.resource && near(ls.x, ls.y, 300)) add('map', ls.resource + 38);
    const towers = ah11Placements(g, this.art.decor);
    for (const t of towers) if (near(t.x, t.y, 300)) add('map', t.res);
    for (const d of this.art.decor ?? []) if (!ah11Hides(towers, d) && near(d.x, d.y, 90)) add('map', d.res);
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
  private piece(f: Frame | undefined, sx: number, sy: number, order: number, size = 1): Piece | null {
    if (!f) return null;
    const s = this.zoom * f.scale * size, x = sx - f.ax * s, y = sy - f.ay * s, w = f.w * s, h = f.h * s;
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
    const b = this.game.board, lv = this.art.levels, id = (l as { id?: number }).id;
    if (lv && id && l.level) { const res = cqHouseSprite(lv, id - 1, l.level); if (res) return { res, frame: buildingFrame(lv.facing.lands[id - 1][0], this.rot) }; }
    const mkh = l.level ? this.mkHouse(l as { id?: number; level: number; chain: number | boolean }) : null;
    const at = l as { x?: number; y?: number };
    if (mkh) return { res: mkh, frame: buildingFrame(id && at.x !== undefined && at.y !== undefined ? this.doorToRoad(id + 2000, at.x, at.y) : 0, this.rot) };
    if (l.level) return { res: kbHouseSprite(this.game, l) ?? jqHouseSprite(this.game, l) ?? cityLotSprite(this.game, l) ?? (l.chain ? 79 + houseSet(b) : 39 + houseSet(b) * 5 + l.level - 1), frame: buildingFrame(l.facing, this.rot) };
    if (l.owner) return { res: 25, frame: this.game.players[l.owner - 1]?.character ?? 0 };
    return null;
  }

  /**
   * 長安 (MakerMap.builds): a small lot's house at its level — one of that level's looks, the same for the lot all game
   * (by its id) — and a large plot's building; both stand square to the grid, their door to the road
   * (`doorToRoad`, the user 2026-11-19: 「大門應該沖馬路」).
   */
  private mkHouse(l: { id?: number; level: number; chain?: number | boolean }): number | null {
    // (a 連鎖店 its own piece — the user 2026-11-23: 「長安和清明上河沒單獨做連鎖店的圖標」)
    if (l.chain && this.art.builds?.chain) return this.art.builds.chain;
    const row = this.art.builds?.lots[Math.min(5, l.level) - 1];
    if (!row?.length) return null;
    const h = Math.imul((l.id ?? 0) ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
    return row[(h >>> 7) % row.length];
  }
  private mkFac(fa: { type: number; level: number }): number | null {
    const row = this.art.builds?.fac[String(fa.type)];
    return row?.length ? row[Math.min(fa.level, row.length) - 1] : null;
  }
  /**
   * 長安's buildings: the facing whose door looks at the plot's road — its pieces' front is the world's +y at facing 0
   * (tools/tycoon-art/changan_turn.py paints the four turns square to the grid). A plot by a diagonal road (24 lots and
   * 4 plots: the city's corners, the country roads) lies at 45°: an odd facing, the mirrored frame, stands square on it
   * (the user 2026-11-20: 「個別的小房子還是斜的」).
   */
  private doorToRoad(ref: number, x: number, y: number): number {
    return this.roadFacing(ref, x, y);
  }

  private facilitySprite(fa: { level: number; type: number; owner: number }): { res: number; frame: number } | null {
    const b = this.game.board, stage = houseSet(b) >> 2, inStage = houseSet(b) & 3, lv = this.art.levels, fid = (fa as { id?: number }).id;
    if (lv && fid && fa.level && fa.type !== 1) { const res = cqFacSprite(lv, fid - 1, fa); if (res) return { res, frame: buildingFrame(lv.facing.facilities[fid - 1][0], this.rot) }; }
    if (fa.level) {
      const mkf = this.mkFac(fa), fat = fa as { x?: number; y?: number };
      if (mkf) return { res: mkf, frame: buildingFrame(fid && fat.x !== undefined && fat.y !== undefined ? this.doorToRoad(fid + 4000, fat.x, fat.y) : 0, this.rot) };
      const jq = jqFacSprite(this.game, fa); // 激情歲月's five facilities (docs/rules/24 §2)
      if (jq) return { res: jq, frame: buildingFrame(0, this.rot) };
      const own = casinoSprite(fa) ?? kbShopSprite(this.game, fa) ?? hotelSprite(fa, this.game.settings.mapId); // 大富翁城's casino (docs/rules/19), 歌舞伎町's shops (21), the redrawn hotels
      const id = (fa as { id?: number }).id, at = fa as { x?: number; y?: number };
      if (own && hotelSprite(fa, this.game.settings.mapId) && id !== undefined && at.x !== undefined && at.y !== undefined) return { res: own, frame: buildingFrame(this.roadFacing(id + 4000, at.x, at.y), this.rot) };
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
        add(this.piece(frames[screenDir(a.dir, this.rot) * fpd + Math.min(a.anim, fpd - 1)], q.x, q.y, q.y * 16 + layer, SPRITE_SIZE[spr.res]));
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
    // 重慶: only what the level looked at shows, so only that can be tapped (the 公路's spots on every level).
    const k = this.art.levels ? this.viewLevel() : 0;
    return [...pk.all].filter(i => shapes[i] && (!pk.onScreen || shapeVisible(shapes[i], this.W, this.H)) && (!k || [0, k].includes(this.spotLevelOf(pk.spots[i]))));
  }

  /** 重慶: the level a pick's spot is on (0: the 公路, or another map). */
  private spotLevelOf(s: PickSpot): number {
    const w = this.spotPos(s, false);
    return w ? this.levelAt(w.x, w.y) : 0;
  }

  /** 重慶: how many of the open pick's spots are on each level (1–3), for the pick's level buttons; null otherwise. */
  pickLevels(): number[] | null {
    const pk = this.picking;
    if (!pk || !this.art.levels) return null;
    const n = [0, 0, 0, 0];
    for (const i of pk.all) n[this.spotLevelOf(pk.spots[i])]++;
    return [n[1] + n[0], n[2] + n[0], n[3] + n[0]];
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
    // 重慶: nothing to pick on the level looked at: the first level that has some comes up.
    if (!pk.onScreen && all.size && this.art.levels && !this.pickAllowed().length) {
      const k = this.pickLevels()!.findIndex(n => n > 0);
      if (k >= 0) this.showLevel(k + 1);
    }
    // Look at the first choice if none is on screen.
    if (!pk.onScreen && all.size) {
      const shapes = pk.spots.map(s => this.spotShape(s));
      const can = this.art.levels ? this.pickAllowed() : [...all];
      if (can.length && !can.some(i => shapeVisible(shapes[i], this.W, this.H))) { const w = this.spotPos(spots[can[0]])!; this.follow = null; this.endGlide(); this.cam.x = w.x; this.cam.y = w.y; }
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

  // ---------- controller (ui/pad.ts, issue #15) ----------

  /**
   * The open pick's choices for a controller's cursor: each allowed spot's index and its glow's centre and radius in
   * client px (an off-screen one too while the map may be moved: pad.ts then looks there). Null when nothing is picked.
   */
  padSpots(): { i: number; x: number; y: number; r: number }[] | null {
    const pk = this.picking;
    if (!pk || pk.busy) return null;
    const shapes = this.pickShapes(), c = this.canvas.getBoundingClientRect();
    return this.pickAllowed().map(i => ({ i, x: c.left + shapes[i]!.glow.x, y: c.top + shapes[i]!.glow.y, r: Math.max(10, shapes[i]!.glow.rx) }));
  }

  /** Picks spot `i` as a tap on it would (several on one spot: which one is asked, as for a tap). */
  padPick(i: number) {
    const pk = this.picking;
    if (!pk || pk.busy) return;
    const allowed = this.pickAllowed();
    if (!allowed.includes(i)) { pk.onMiss(); return; }
    const shapes = this.pickShapes(), a = shapes[i]!.anchor, z = this.zoom;
    const stack = [i, ...allowed.filter(j => j !== i && Math.hypot(shapes[j]!.anchor.x - a.x, shapes[j]!.anchor.y - a.y) <= 12 * z)];
    if (stack.length > 1 && pk.choose) {
      pk.busy = true;
      void pk.choose(stack).then(k => { pk.busy = false; if (this.picking === pk && stack.includes(k)) pk.resolve(k); }, () => { pk.busy = false; });
      return;
    }
    pk.resolve(i);
  }

  /** Brings spot `i` of the open pick into view when it is off the canvas (only while the map may be moved). */
  padReveal(i: number) {
    const pk = this.picking, s = pk?.spots[i];
    if (!s || !this.canPan) return;
    const g = this.pickShapes()[i]?.glow, m = 40;
    if (g && g.x > m && g.y > m && g.x < this.W - m && g.y < this.H - m) return;
    const w = this.spotPos(s);
    if (w) this.lookAt(w.x, w.y);
  }

  /** Moves the view by (dx, dy) screen px, as a drag the other way would; false while the map may not move. */
  padPan(dx: number, dy: number): boolean {
    if (!this.canPan) return false;
    const { a, b, c, d } = this.basis(), det = a * d - b * c;
    this.follow = null; this.endGlide(); this.info.hide();
    this.cam.x += (d * dx - c * dy) / det;
    this.cam.y += (-b * dx + a * dy) / det;
    this.keepOnBoard();
    return true;
  }

  /** Puts the view back on the player whose turn it is (after a look round). */
  padRecentre() {
    if (this.current < 0) return;
    this.follow = null;
    this.followActor(this.current);
  }

  /** A tap's skip of what plays on the map (a cloud, a caption); false when nothing waits for one. */
  padSkip(): boolean {
    const l = this.tapListeners;
    if (!l.length) return false;
    this.tapListeners = [];
    for (const f of l) f();
    return true;
  }

  /** Whether a pick is open on this view. */
  get padPicking(): boolean { return !!this.picking; }

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
    // 重慶: the spot's own level comes up (a line, a jail, a missile on another level is not left floating in the air).
    this.spotLevel(this.levelAt(x, y));
    // 鏡頭跟隨「少動」(issue #11): a spot already well inside the view is shown where it is, the camera stays on the
    // actor; only farther spots (a missile's target, another street) are travelled to.
    if (this.calm && this.alive && this.nearCentre(x, y)) return Promise.resolve();
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

  /** 鏡頭跟隨: false 標準 (every effect's spot is centred, as in the original), true 少動 (see panTo). */
  calm = false;

  /** Whether a world point shows in the middle part of the view now (where a 440×440 clip round it still fits). */
  private nearCentre(x: number, y: number): boolean {
    const { a, b, c, d } = this.basis(), dx = x - this.cam.x, dy = y - this.cam.y;
    const u = a * dx + c * dy, v = b * dx + d * dy;
    return Math.abs(u) <= this.W * 0.3 && v >= -this.H * 0.3 && v <= this.H * 0.25;
  }

  /** Camera waits by game speed (慢 1 … 快 0.5 of the time, 極快 a quarter). */
  get pace(): number { return Math.max(this.tickMs <= 10 ? 0.25 : 0.5, Math.min(1, this.tickMs / 60)); }

  /**
   * Whether all `pts` show well on the canvas (inside a margin: the top bar, the edges, the lower part where boxes
   * open) with the camera aimed at `at` (kept on the board as always).
   */
  private fitsAt(at: { x: number; y: number }, pts: { x: number; y: number }[]): boolean {
    const c = this.clampCam(at.x, at.y), { a, b, c: cc, d } = this.basis();
    const mx = Math.max(36, this.W * 0.1), top = Math.max(70, this.H * 0.16), bottom = Math.max(50, this.H * 0.14);
    return pts.every(p => {
      const dx = p.x - c.x, dy = p.y - c.y, u = a * dx + cc * dy, v = b * dx + d * dy;
      return Math.abs(u) <= this.W / 2 - mx && v >= -this.H * this.fy + top && v <= this.H * (1 - this.fy) - bottom;
    });
  }

  /**
   * The camera goes to where an effect happens (docs/rules/11 §7.1): one spot → centred on it; several that fit
   * on the screen together (a street, two swapped lots) → on the middle of them; otherwise they are visited in
   * groups that fit, in order along the longer screen axis, with a short stop at each but the last (the map's
   * scale is fixed, as in the original, so the view never zooms out for it). Resolves on the last group.
   */
  async showSpots(pts: { x: number; y: number }[], dwell = 450): Promise<void> {
    if (!pts.length) return;
    const mid = (q: { x: number; y: number }[]) => {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const p of q) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
      return { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
    };
    const all = mid(pts);
    if (pts.length === 1 || this.fitsAt(all, pts)) { await this.panTo(all.x, all.y); return; }
    // Along the screen axis the spots spread most on.
    const { a, b, c, d } = this.basis();
    const u = (p: { x: number; y: number }) => a * p.x + c * p.y, v = (p: { x: number; y: number }) => b * p.x + d * p.y;
    const spread = (f: (p: { x: number; y: number }) => number) => Math.max(...pts.map(f)) - Math.min(...pts.map(f));
    const key = spread(u) / this.W >= spread(v) / this.H ? u : v;
    const order = [...pts].sort((p, q) => key(p) - key(q));
    const groups: { x: number; y: number }[][] = [];
    for (const p of order) {
      const g = groups[groups.length - 1];
      if (g && this.fitsAt(mid([...g, p]), [...g, p])) g.push(p); else groups.push([p]);
    }
    // Many stops (a nationwide list in 大富豪模式) go quicker; never more than six.
    const stops = groups.slice(0, 6), wait = (stops.length > 3 ? 0.6 : 1) * dwell * this.pace;
    for (const [i, g] of stops.entries()) {
      const m = mid(g);
      await this.panTo(m.x, m.y);
      if (i < stops.length - 1) await new Promise(r => setTimeout(r, wait));
    }
  }

  /** Clears the effect's rings (`marks`, `markNodes`). */
  unmark() { this.marks.clear(); this.markNodes.clear(); }

  /** Turns the view (only while the map may be moved). */
  rotate(by: number) { if (this.canPan) this.rot = (this.rot + by + 8) & 7; }

  /** Keep the camera on an actor, as the original does every tick; a new actor is reached by a glide. */
  followActor(id: number) {
    const changed = this.follow !== id;
    this.follow = id; this.current = id;
    if (this.levelPick?.spot) this.levelPick = null;   // back from a spot elsewhere: the person's own level again
    if (!changed) return;
    this.levelPick = null;   // 重慶: back on a person, back on their level
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
    for (const a of this.actors.values()) this.endGlides(a);
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
      if (a.phase || a.segs?.length) continue;
      // 大富豪模式: a player still standing on another city's square (one arriving, summoned, deported) is not drawn
      // here until the rules put them on this map — that square may not exist on it.
      const n = p.placed && p.node ? nodeById(this.game.board, p.node) : undefined;
      a.visible = !!n && p.placed && (!this.game.offRoad(p) || p.bankrupt);
      if (n) { a.x = n.x; a.y = n.y; }
      // A standing player faces the way the rules say (a turn-around card turns them at once).
      a.dir = p.dir;
    }
    for (const [i, npc] of this.npcs()) {
      const a = this.actor(i);
      if (a.phase) continue;
      const n = npc.where === 0 && npc.node > 0 ? nodeById(this.game.board, npc.node) : undefined;
      a.visible = !!n && !this.falling.has(i);
      if (n) { a.x = n.x; a.y = n.y; a.dir = npc.dir; }
    }
  }

  private npcs(): [number, { node: number; dir: number; where: number }][] {
    const list = (this.game as unknown as { places?: { npcs?: { node: number; dir: number; where: number }[] } }).places?.npcs ?? [];
    const base = this.game.npcBase;   // NPC actors npcBase.. (4..7; 12..15 in 大富豪模式)
    return list.map((n, i) => [base + i, n] as [number, typeof n]).filter(([id]) => id < base + 4);
  }

  /**
   * 即時制 (the user 2026-11-08: walks as smooth as an RPG's — everyone at their pace, nobody jumping): one square over
   * `ms`, right after the square queued before it; drawn every frame where the time says, so it never jumps. One that
   * starts behind (the screen fell behind the rules) goes quicker until it has caught up.
   */
  walkTimed(id: number, to: number, dir: number, ms: number, startAt?: number): Promise<void> {
    const a = this.actor(id), n = nodeById(this.game.board, to);
    if (!n) return Promise.resolve();
    this.finishMove(id);
    this.pose.delete(id);
    const q = a.segs ?? (a.segs = []), last = q[q.length - 1], now = performance.now();
    const fx = last ? last.tx : a.x, fy = last ? last.ty : a.y;
    // `startAt`: when the rules' clock says it starts (a little behind it, so the next square is known before this
    // one ends: no stop at each square); never before the square before it ends
    const t0 = Math.max(last ? last.t0 + last.ms : now, startAt ?? now, now - 30);
    const behind = t0 - now;
    const dur = behind > ms ? Math.max(ms * 0.35, ms - (behind - ms) / 2) : ms;
    a.visible = true;
    if (a.phase !== 1) { a.phase = 1; a.anim = 0; }
    return new Promise(done => q.push({ fx, fy, tx: n.x, ty: n.y, t0, ms: dur, dir, done }));
  }

  /** Every frame: each gliding actor where its walk is now; finished squares let their waiters go on. */
  private glideFrame(now: number) {
    for (const a of this.actors.values()) {
      const q = a.segs;
      if (!q) continue;
      if (!q.length) {
        // arrived and no square follows within a moment: standing still, not walking in place
        if (a.idleAt !== undefined && now - a.idleAt > 150) { if (a.phase === 1) { a.phase = 0; a.anim = 0; } a.idleAt = undefined; }
        continue;
      }
      while (q.length && now >= q[0].t0 + q[0].ms) {
        const s = q.shift()!;
        a.x = a.px = s.tx; a.y = a.py = s.ty; a.dir = s.dir;
        s.done();
      }
      const s = q[0];
      if (!s) { a.idleAt ??= now; continue; }
      a.idleAt = undefined;
      const k = Math.max(0, Math.min(1, (now - s.t0) / s.ms));
      a.x = a.px = s.fx + (s.tx - s.fx) * k;
      a.y = a.py = s.fy + (s.ty - s.fy) * k;
      a.dir = s.dir;
      if (a.phase !== 1) { a.phase = 1; a.anim = 0; }
    }
  }

  /** Ends an actor's glide where it is going (put elsewhere, or the walk is over). */
  private endGlides(a: Actor) {
    const q = a.segs;
    if (!q?.length) return;
    const last = q[q.length - 1];
    a.x = a.px = last.tx; a.y = a.py = last.ty;
    a.segs = [];
    for (const s of q) s.done();
  }

  place(id: number, node: number) {
    const a = this.actor(id), n = nodeById(this.game.board, node);
    // A walk still running ends where it is (whoever waits on it goes on).
    const m = this.movers.get(id);
    if (m) { this.movers.delete(id); m.done(); }
    this.endGlides(a);
    if (!n) { a.visible = false; return; } // a square of another city (大富豪模式)
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

  /**
   * 激情歲月's 解放 truck takes a player away (or drops them back): false on other maps (the caller plays the original's
   * clip). The road's direction at the player's square from its neighbours.
   */
  takeAway(id: number, back: boolean): Promise<boolean> {
    if (!(this.street instanceof JqStreet)) return Promise.resolve(false);
    const p = this.game.players[id], n = p ? this.game.board.nodes.find(x => x.id === p.node) : undefined;
    if (!n) return Promise.resolve(false);
    const nb = n.adjacent.map(k => this.game.board.nodes.find(x => x.id === k)).filter((x): x is NonNullable<typeof x> => !!x);
    const to = nb[0] ?? n;
    const dir = { x: to.x - n.x || 1, y: to.y - n.y };
    return this.street.takeAway({ x: n.x, y: n.y }, dir, back, this.pace, () => this.hide(id), () => this.show(id)).then(() => true);
  }

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
    // The walk in equal ticks (issue #69: a car's 16 px left a short last tick on every square, a stop each time).
    const dist = Math.hypot(to.x - a.x, to.y - a.y), steps = Math.max(1, Math.ceil(dist / Math.max(1, speed)));
    const even = dist > 0 ? dist / steps : speed, ticks = steps + 1;
    return watch(label, new Promise<void>(resolve => {
      const timer = setTimeout(() => this.finishMove(id), ticks * Math.max(this.tickMs, 20) * 4 + 2000);
      this.movers.set(id, { tx: to.x, ty: to.y, speed: even, done: () => { clearTimeout(timer); after?.(); resolve(); } });
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
          if (dist <= m.speed + 1e-6) this.finishMove(id);
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
    const water = p.node ? nodeById(this.game.board, p.node)?.noDrop ?? false : false;
    let slot: number;
    if (p.sleepwalk) slot = phase === 1 ? 17 : phase === 2 ? 2 : 16;
    else if (water) slot = 13 + (phase === 1 ? 1 : phase === 2 ? 2 : 0);
    else if (phase === 3) slot = 12;
    else slot = (p.traffic & 3) * 3 + (phase === 1 ? 1 : phase === 2 ? 2 : 0);
    return { res: B + slot, frozen: p.sleep > 0 && phase === 0 };
  }

  // ---------- drawing ----------

  /**
   * A tall piece (a landscape: a city wall, a tower) in front of an actor opens a soft round hole round it (the user
   * 2026-11-19 chose 挖洞 over fading: 「挖洞效果有意思」), on the maps that ask for it (MapArt.reveal: 長安 and the new
   * maps after it, 「先只針對以後的新地圖打開」). localStorage rich4.reveal = off | fade to compare.
   */
  private revealMode: 'off' | 'fade' | 'cutout' = 'off';
  private revealPts: { x: number; y: number }[] = [];
  private revealCanvas: HTMLCanvasElement | null = null;

  /**
   * A landscape drawn so the actors behind it stay visible: true when it was drawn here (some actor behind it), false when
   * the caller draws it as usual. An actor is behind when its foot is above the piece's own on the screen (drawn before
   * it) and inside the picture; 'fade' draws the piece at 35 %, 'cutout' clears a soft round hole round each such actor.
   */
  private revealSprite(archive: Archive, res: number, frame: number, sx: number, sy: number, size: number): boolean {
    if (this.revealMode === 'off' || !this.revealPts.length) return false;
    const f = this.bank.board(archive, res)?.[frame];
    if (!f) return false;
    const s = this.zoom * f.scale * size, x0 = sx - f.ax * s, y0 = sy - f.ay * s, w = f.w * s, h = f.h * s;
    // (an actor's point is near its head: the figure is drawn below it, so the hole's centre is a little below the point)
    const r = 66 * this.zoom, lift = -8 * this.zoom;
    const behind = this.revealPts.filter(q => q.y < sy && q.x > x0 - r && q.x < x0 + w + r && q.y - lift > y0 - r && q.y - lift < y0 + h + r);
    if (!behind.length) return false;
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = f.scale !== 1;
    if (this.revealMode === 'fade') {
      ctx.save(); ctx.globalAlpha = 0.35; ctx.drawImage(f.img, x0, y0, w, h); ctx.restore();
      return true;
    }
    const cv = (this.revealCanvas ??= document.createElement('canvas'));
    const W = Math.ceil(w), H = Math.ceil(h);
    if (cv.width < W || cv.height < H) { cv.width = Math.max(cv.width, W); cv.height = Math.max(cv.height, H); }
    const o = cv.getContext('2d')!;
    o.clearRect(0, 0, W, H);
    o.globalCompositeOperation = 'source-over';
    o.imageSmoothingEnabled = f.scale !== 1;
    o.drawImage(f.img, 0, 0, w, h);
    o.globalCompositeOperation = 'destination-out';
    for (const q of behind) {
      const cx = q.x - x0, cy = q.y - lift - y0;
      const gr = o.createRadialGradient(cx, cy, r * 0.55, cx, cy, r);
      gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      o.fillStyle = gr; o.beginPath(); o.arc(cx, cy, r, 0, Math.PI * 2); o.fill();
    }
    o.globalCompositeOperation = 'source-over';
    ctx.drawImage(cv, 0, 0, W, H, x0, y0, W, H);
    return true;
  }

  private sprite(archive: Archive, res: number, frame: number, sx: number, sy: number, tint?: number, frozen = false, size = 1) {
    const frames = this.bank.board(archive, res);
    const f = frames?.[frame];
    if (!f) return;
    const s = this.zoom * f.scale * size;
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
  // ---------------------------------------------------------------- 重慶's stacked levels (docs/rules/33 §1)

  /** The level of the person the camera follows; 0 on every other map. */
  autoLevel(): number {
    const lv = this.art.levels;
    if (!lv) return 0;
    const g = this.game, p = g.players[this.current] ?? g.players[g.current];
    return p ? nodeLevel(lv, p.node) : 3;
  }

  /**
   * A level picked on the small map's buttons, kept until the camera's person changes or changes level; `spot`: the
   * level of a spot the camera was sent to (panTo, `spotLevel`), until it follows a person again.
   */
  private levelPick: { level: number; who: number; auto: number; spot?: boolean } | null = null;

  /**
   * The level of a world point the camera is sent to: of the square, lot or building there (within 40 px); 0 when
   * none is that near, or on the 公路, or on other maps. The levels' plates overlap in world pixels, so the nearest
   * thing decides.
   */
  levelAt(x: number, y: number): number {
    const lv = this.art.levels;
    if (!lv) return 0;
    const b = this.game.board, ramp = lv.ramp;
    let best = 0, d = 40;
    const near = (px: number, py: number, k: number) => { const e = Math.hypot(px - x, py - y); if (e < d) { d = e; best = k; } };
    for (const n of b.nodes) near(n.x, n.y, ramp.includes(n.id) ? 0 : nodeLevel(lv, n.id));
    b.lands.forEach((l, i) => near(l.x, l.y, lv.lands[i]));
    b.facilities.forEach((f, i) => near(f.x, f.y, lv.facilities[i]));
    b.companies.forEach((c, i) => near(c.x, c.y, lv.companies[i]));
    return best;
  }

  /**
   * Shows level k for a spot away from the camera's person (0: leaves the view as it is); `followActor` / `refollow`
   * go back to the person's level.
   */
  spotLevel(k: number) {
    if (!k || !this.art.levels) return;
    const auto = this.autoLevel();
    if (k === auto) { if (this.levelPick?.spot) this.levelPick = null; }
    else this.levelPick = { level: k, who: this.current, auto, spot: true };
    this.noteLevel(this.viewLevel());
  }
  /** Called with the level looked at whenever it changes (the small map's buttons). */
  readonly levelListeners = new Set<(level: number) => void>();
  private shownLevel = 0;

  /** The level looked at (§1: drawn sharp, the ones under it soft, the ones above it not at all); 0 on other maps. */
  viewLevel(): number {
    const auto = this.autoLevel(), pk = this.levelPick;
    if (pk && (pk.who !== this.current || pk.auto !== auto)) this.levelPick = null;
    return this.levelPick?.level ?? auto;
  }

  private lift = -1;
  private rampTop: number | null = null;
  /**
   * How far the second level has come in (0..1, §2): on the 公路 the share of its squares climbed, eased frame by frame;
   * 1 on the second level and above or when a level is picked, 0 elsewhere on the first.
   */
  private liftOf(seen: number): number {
    const lv = this.art.levels!, b = this.game.board, r = lv.ramp;
    if (this.rampTop === null) {   // the end of the 公路 next to the second level
      const up = (id: number) => (b.nodes[id - 1]?.adjacent ?? []).some(m => m && !r.includes(m) && nodeLevel(lv, m) === 2);
      this.rampTop = up(r[0]) ? 0 : r.length - 1;
    }
    const g = this.game, p = g.players[this.current] ?? g.players[g.current];
    const i = p && !this.levelPick && seen <= 2 ? r.indexOf(p.node) : -1;
    const target = i >= 0 ? (r.length - Math.abs(i - this.rampTop)) / (r.length + 1) : seen >= 2 ? 1 : 0;
    if (this.lift < 0 || i < 0 && Math.abs(target - this.lift) > 0.5) this.lift = target;
    else this.lift += (target - this.lift) * 0.12;
    return this.lift;
  }

  /**
   * Looks at level k (the small map's 一層 / 二層 / 三層): the camera goes to that level's square nearest to it; the
   * camera's own person's level follows them again.
   */
  showLevel(k: number) {
    const lv = this.art.levels;
    if (!lv) return;
    const auto = this.autoLevel(), who = this.current;
    if (k === auto) {
      this.levelPick = null;
      if (who >= 0) { this.follow = null; this.followActor(who); }
    } else {
      const ramp = new Set(lv.ramp);
      let best: BoardNode | null = null, d = Infinity;
      for (const n of this.game.board.nodes) {
        if (nodeLevel(lv, n.id) !== k || (k > 1 && ramp.has(n.id))) continue;
        const e = Math.hypot(n.x - this.cam.x, n.y - this.cam.y);
        if (e < d) { d = e; best = n; }
      }
      this.follow = null;
      if (best) { const to = { x: best.x, y: best.y }; if (!this.startGlide(() => to, 700)) { this.cam.x = to.x; this.cam.y = to.y; } }
      this.levelPick = { level: k, who, auto };
    }
    this.noteLevel(this.viewLevel());
  }

  /** The level the board shows now (the small map lights its button). */
  get levelShown(): number { return this.shownLevel; }

  private noteLevel(k: number) {
    if (k === this.shownLevel) return;
    this.shownLevel = k;
    for (const fn of this.levelListeners) fn(k);
  }

  private blurBuf: HTMLCanvasElement | null = null;
  private blurBuf2: HTMLCanvasElement | null = null;
  /**
   * Everything drawn so far, softened and darkened a step (重慶 §1: done before each plate up to the one looked at,
   * so the background is the softest and the level under it the least): shrunk to a quarter, then to a tenth, and drawn
   * back over (the user on the phone: 「下層的模糊效果還是不夠強」 — a phone's canvas has no blur filter, so the
   * shrinking does it). `strength` < 1 blends it in part (the 公路, §2).
   */
  private blurBelow(ctx: CanvasRenderingContext2D, strength = 1) {
    if (strength <= 0.01) return;
    const W = this.canvas.width, H = this.canvas.height;
    const size = (c: HTMLCanvasElement | null, k: number) => {
      const cv = c ?? document.createElement('canvas'), w = Math.max(1, Math.round(W / k)), h = Math.max(1, Math.round(H / k));
      if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
      return cv;
    };
    const c1 = this.blurBuf = size(this.blurBuf, 4), c2 = this.blurBuf2 = size(this.blurBuf2, 10);
    for (const [from, to] of [[this.canvas, c1], [c1, c2]] as const) {
      const x = to.getContext('2d')!;
      x.imageSmoothingEnabled = true;
      x.imageSmoothingQuality = 'medium';
      if ('filter' in x) x.filter = 'blur(1px)';   // where the canvas has filters (not a phone's): softer still
      x.clearRect(0, 0, to.width, to.height);
      x.drawImage(from, 0, 0, to.width, to.height);
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.globalAlpha = strength;
    ctx.drawImage(c2, 0, 0, W, H);
    ctx.fillStyle = 'rgba(10, 14, 32, .26)';
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  private cliffs = new Map<number, HTMLCanvasElement>();
  /** 重慶's plate walls, made for the view's turn (`wallOf`). */
  private walls = new Map<string, { c: HTMLCanvasElement; x: number; y: number; w: number; h: number }>();
  /** How tall each level's wall stands on screen at zoom 1 (px). */
  private static WALL_H = [0, 150, 200, 250];

  /**
   * Level k's side wall (the user 2026-11-09: 「邊緣…圍上高樓或山…立交…穿山輕軌，純邊框多少有點醜」): its strip
   * (洪崖洞's stilt houses, the high-rises with the 立交 and the 李子壩 train, the hilltop cliff) repeated along every
   * edge that faces the viewer, standing straight down on screen under the edge; drawn once per turn of the view, in
   * map pixels (a drop on screen is the same map step at any zoom), the plate drawn over it.
   */
  private wallOf(k: number): { c: HTMLCanvasElement; x: number; y: number; w: number; h: number } | null {
    const img = this.art.walls?.[k], poly = this.game.board.levels?.plates[String(k)];
    if (!img?.naturalWidth || !poly || poly.length < 3) return null;
    const key = `${k}|${this.rot}`;
    const had = this.walls.get(key);
    if (had) return had;
    const { a, b: bb, c, d } = this.basis(), det = a * d - c * bb || 1, H = BoardView.WALL_H[k] * this.zoom;
    const wx = -c * H / det, wy = a * H / det, th = img.naturalHeight;
    const xs = poly.flatMap(([x]) => [x, x + wx]), ys = poly.flatMap(([, y]) => [y, y + wy]);
    const ox = Math.min(...xs), oy = Math.min(...ys), w = Math.max(...xs) - ox, h = Math.max(...ys) - oy;
    const SC = Math.min(1, 2600 / Math.max(w, h));
    const cv = document.createElement('canvas');
    cv.width = Math.ceil(w * SC); cv.height = Math.ceil(h * SC);
    const x = cv.getContext('2d')!, pat = x.createPattern(img, 'repeat');
    const inside = (px: number, py: number) => {
      let r = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [x0, y0] = poly[i], [x1, y1] = poly[j];
        if ((y0 > py) !== (y1 > py) && px < (x1 - x0) * (py - y0) / (y1 - y0) + x0) r = !r;
      }
      return r;
    };
    let u = 0;
    if (pat) for (let i = 0; i < poly.length; i++) {
      const [x0, y0] = poly[i], [x1, y1] = poly[(i + 1) % poly.length];
      const ex = x1 - x0, ey = y1 - y0, du = Math.hypot(a * ex + c * ey, bb * ex + d * ey) * th / H;
      if (du < 0.01) continue;
      // facing the viewer: just under the edge on screen is outside the plate
      if (!inside((x0 + x1) / 2 + wx * 0.05, (y0 + y1) / 2 + wy * 0.05)) {
        const Ex = ex / du, Ey = ey / du, Wx = wx / th, Wy = wy / th;
        x.setTransform(Ex * SC, Ey * SC, Wx * SC, Wy * SC, (x0 - Ex * u - ox) * SC, (y0 - Ey * u - oy) * SC);
        x.fillStyle = pat;
        x.fillRect(u, 0, du + 0.6, th);
      }
      u += du;
    }
    const out = { c: cv, x: ox, y: oy, w, h };
    this.walls.set(key, out);
    return out;
  }

  /** A plate's outline in the cliff's dark (half size), made once. */
  private cliffOf(k: number, img: HTMLImageElement, x0: number, y0: number, w: number, h: number): HTMLCanvasElement {
    let c = this.cliffs.get(k);
    if (!c) {
      c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(w / 2)); c.height = Math.max(1, Math.round(h / 2));
      const x = c.getContext('2d')!;
      x.drawImage(img, x0, y0, w, h, 0, 0, c.width, c.height);
      x.globalCompositeOperation = 'source-in';
      x.fillStyle = 'rgb(34, 26, 24)';
      x.fillRect(0, 0, c.width, c.height);
      this.cliffs.set(k, c);
    }
    return c;
  }

  /**
   * Level k's plate (重慶): its cliff dropped under it on screen, the picture, then on it that level's step marks,
   * owner plates and pads, and the current player's fork arrows when they stand on it.
   */
  private drawPlate(ctx: CanvasRenderingContext2D, k: number, e: number, f: number, pads: (only: (n: BoardNode) => boolean) => void, ramp: Set<number>, arrows: () => void) {
    const lv = this.art.levels!, img = this.art.plates?.[k];
    if (!img) return;
    const [x0, y0, x1, y1] = lv.layer_box[String(k)], w = x1 - x0, h = y1 - y0;
    const { a, b: bb, c, d } = this.basis(), dpr = this.dpr, det = a * d - c * bb || 1;
    ctx.setTransform(a * dpr, bb * dpr, c * dpr, d * dpr, e * dpr, f * dpr);
    const drop = (10 + 6 * k) * this.zoom, wx = -c * drop / det, wy = a * drop / det;   // a screen drop as a map step
    const wall = this.wallOf(k);
    if (wall) ctx.drawImage(wall.c, wall.x, wall.y, wall.w, wall.h);
    else { const cliff = this.cliffOf(k, img, x0, y0, w, h); for (const t of [0.34, 0.67, 1]) ctx.drawImage(cliff, x0 + wx * t, y0 + wy * t, w, h); }
    ctx.drawImage(img, x0, y0, w, h, x0, y0, w, h);
    const own = (id: number) => nodeLevel(lv, id) === k && !ramp.has(id);
    if (this.art.stepMarks) this.stepMarks(ctx, own);
    const refLevel = (ref: number) => (ref > 6000 ? lv.companies : ref > 4000 ? lv.facilities : lv.lands)[(ref % 2000) - 1];
    this.ownerPlates(ctx, ref => refLevel(ref) === k);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    pads(n => own(n.id));
    const cur = this.game.players[this.game.current];
    if (cur && nodeLevel(lv, cur.node) === k) arrows();
  }

  private rampLine: { pts: [number, number][]; up: number[]; span: [number, number] } | null = null;
  /**
   * The 公路's course (map points): from the first level's road square next to it, over its 12 squares, to the second
   * level's, rounded off (two passes of corner cutting); with each point's share of the way up (0 at the first level).
   */
  private rampCourse(): { pts: [number, number][]; up: number[]; span: [number, number] } {
    if (this.rampLine) return this.rampLine;
    const lv = this.art.levels!, b = this.game.board, r = lv.ramp;
    const at = (id: number): [number, number] => { const n = b.nodes[id - 1]; return [n.x, n.y]; };
    const beyond = (id: number) => (b.nodes[id - 1]?.adjacent ?? []).find(m => m && !r.includes(m));
    const lo = this.rampTop === 0 ? r[r.length - 1] : r[0], ids = this.rampTop === 0 ? [...r].reverse() : [...r];
    const a = beyond(lo), z = beyond(ids[ids.length - 1]);
    let pts: [number, number][] = [...(a ? [at(a)] : []), ...ids.map(at), ...(z ? [at(z)] : [])];
    // the share of the way where the bridge itself runs: from its first square to its last (the ends are the levels' roads)
    const raw = [0];
    for (let i = 1; i < pts.length; i++) raw.push(raw[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const T = raw[raw.length - 1] || 1, span: [number, number] = [a ? raw[1] / T : 0, z ? raw[raw.length - 2] / T : 1];
    for (let pass = 0; pass < 2; pass++) {
      const q: [number, number][] = [pts[0]];
      for (let i = 0; i < pts.length - 1; i++) {
        const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
        q.push([x0 * 0.75 + x1 * 0.25, y0 * 0.75 + y1 * 0.25], [x0 * 0.25 + x1 * 0.75, y0 * 0.25 + y1 * 0.75]);
      }
      q.push(pts[pts.length - 1]);
      pts = q;
    }
    const len = [0];
    for (let i = 1; i < pts.length; i++) len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    return (this.rampLine = { pts, up: len.map(l => l / (len[len.length - 1] || 1)), span });
  }

  /**
   * The 公路's viaduct (the user 2026-11-09: 「這都飛橋外面了」「鏈接處還是要優化」), drawn along its squares themselves so
   * they always sit on its deck whichever way the view turns: piers dropping into the river (as deep as the first
   * level's wall at its foot, the second's at its top, fading out like the walls), the girder under the deck's edge, the
   * deck (a road as wide as the levels' roads, kerbs and railings, lamps, one dash a square) running onto both levels'
   * roads; then its squares' pads.
   */
  private drawViaduct(pads: (only: (n: BoardNode) => boolean) => void, ramp: Set<number>, e: number, f: number) {
    this.rampTop ??= 0;
    const { pts, up, span } = this.rampCourse(), ctx = this.ctx, z = this.zoom, dpr = this.dpr;
    const P = pts.map(([x, y]) => this.project(x, y));
    if (P.every(p => p.x < -400 || p.x > this.W + 400 || p.y < -400 || p.y > this.H + 400)) { pads(n => ramp.has(n.id)); return; }
    const { a, b: bb, c, d } = this.basis(), det = a * d - c * bb || 1;
    const down = (h: number) => [-c * h / det, a * h / det];   // a drop of h screen px as a map step
    const H0 = BoardView.WALL_H[1] * z, H1 = BoardView.WALL_H[2] * z;
    ctx.save();
    // piers, every 70 map px along the course
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    let next = 0, run = 0;
    for (let i = 1; i < pts.length; i++) {
      const seg = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      while (next <= run + seg) {
        const t = (next - run) / (seg || 1), u = up[i - 1] + (up[i] - up[i - 1]) * t;
        const p = { x: P[i - 1].x + (P[i].x - P[i - 1].x) * t, y: P[i - 1].y + (P[i].y - P[i - 1].y) * t };
        if (u > span[0] + 0.02 && u < span[1] - 0.02) {
          const h = H0 + (H1 - H0) * u, w = 16 * z;
          const gr = ctx.createLinearGradient(0, p.y, 0, p.y + h);
          gr.addColorStop(0, '#a9adb8'); gr.addColorStop(0.55, 'rgba(70, 76, 96, .85)'); gr.addColorStop(1, 'rgba(20, 24, 40, 0)');
          ctx.fillStyle = gr;
          ctx.fillRect(p.x - w / 2, p.y, w, h);
          ctx.fillStyle = 'rgba(0, 0, 0, .22)';
          ctx.fillRect(p.x, p.y, w / 2, h * 0.7);
          ctx.fillStyle = 'rgba(255, 196, 96, .9)';   // a lamp under the deck on the pier's head
          ctx.beginPath(); ctx.ellipse(p.x, p.y + 10 * z, 7 * z, 3 * z, 0, 0, Math.PI * 2); ctx.fill();
        }
        next += 70;
      }
      run += seg;
    }
    // the deck, in map pixels under the board's turn
    ctx.setTransform(a * dpr, bb * dpr, c * dpr, d * dpr, e * dpr, f * dpr);
    // the bridge's own part (girder, kerbs) from its first square to its last; the asphalt on to both levels' roads,
    // round-ended, so it runs into them
    const line = (dx: number, dy: number, whole = false) => {
      ctx.beginPath();
      pts.forEach(([x, y], i) => { if (whole || up[i] >= span[0] - 0.001 && up[i] <= span[1] + 0.001) ctx.lineTo(x + dx, y + dy); });
    };
    ctx.lineJoin = 'round'; ctx.lineCap = 'butt';
    const [gx, gy] = down(11 * z);
    line(gx, gy); ctx.lineWidth = 54; ctx.strokeStyle = '#4c5060'; ctx.stroke();   // the girder's face
    line(gx * 0.45, gy * 0.45); ctx.lineWidth = 56; ctx.strokeStyle = '#6d717f'; ctx.stroke();
    line(0, 0); ctx.lineWidth = 56; ctx.strokeStyle = '#b9bcc6'; ctx.stroke();   // kerbs and railings
    line(0, 0, true); ctx.lineCap = 'round'; ctx.lineWidth = 44; ctx.strokeStyle = '#363945'; ctx.stroke();   // asphalt
    ctx.lineCap = 'butt';
    ctx.lineWidth = 1.6; ctx.strokeStyle = 'rgba(255, 255, 255, .14)';
    for (const s of [-15, 15]) {   // worn wheel tracks
      ctx.beginPath();
      for (let i = 0; i < pts.length; i++) {
        const [x0, y0] = pts[Math.max(0, i - 1)], [x1, y1] = pts[Math.min(pts.length - 1, i + 1)], L = Math.hypot(x1 - x0, y1 - y0) || 1;
        ctx.lineTo(pts[i][0] - (y1 - y0) / L * s, pts[i][1] + (x1 - x0) / L * s);
      }
      ctx.stroke();
    }
    // one dash a square, like every road (chongqing_ground.square_dashes)
    const b = this.game.board, ids = [...ramp].sort((m, n) => m - n);
    ctx.lineWidth = 4; ctx.lineCap = 'butt'; ctx.strokeStyle = 'rgba(244, 242, 232, .92)';
    ctx.beginPath();
    for (const id of ids) for (const m of b.nodes[id - 1].adjacent) {
      if (!m || m < id && ramp.has(m)) continue;
      const n0 = b.nodes[id - 1], n1 = b.nodes[m - 1];
      if (!n1) continue;
      const mx = (n0.x + n1.x) / 2, my = (n0.y + n1.y) / 2, dx = (n1.x - n0.x) * 0.15, dy = (n1.y - n0.y) * 0.15;
      ctx.moveTo(mx - dx, my - dy); ctx.lineTo(mx + dx, my + dy);
    }
    ctx.stroke();
    // lamps on the railings
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (let i = 4; i < pts.length - 4; i += 6) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i + 1], L = Math.hypot(x1 - x0, y1 - y0) || 1;
      for (const s of [-26, 26]) {
        const q = this.project(pts[i][0] - (y1 - y0) / L * s, pts[i][1] + (x1 - x0) / L * s);
        ctx.fillStyle = 'rgba(70, 70, 80, .9)'; ctx.fillRect(q.x - 1.2 * z, q.y - 16 * z, 2.4 * z, 16 * z);
        const gl = ctx.createRadialGradient(q.x, q.y - 17 * z, 0, q.x, q.y - 17 * z, 12 * z);
        gl.addColorStop(0, 'rgba(255, 226, 150, 1)'); gl.addColorStop(0.3, 'rgba(255, 190, 90, .6)'); gl.addColorStop(1, 'rgba(255, 170, 60, 0)');
        ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(q.x, q.y - 17 * z, 12 * z, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
    // its squares' pads, and the two squares at its ends again (the deck's asphalt runs over them)
    pads(n => ramp.has(n.id) || n.adjacent.some(m => m && ramp.has(m)));
  }

  /** Just the level on screen, 「第X層」 (or 「公路」 on the viaduct): the same words for everyone's turn, the computers' too (the user 2026-11-09). */
  private levelBadge(ctx: CanvasRenderingContext2D, k: number) {
    const name = LEVEL_NAMES[k];
    if (!name) return;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const g = this.game, p = g.players[this.current] ?? g.players[g.current];
    const onRoad = !this.levelPick && !!p && !!this.art.levels?.ramp.includes(p.node);
    const text = onRoad ? '公路' : name, x = 12, y = Math.round(this.H * 0.22);
    ctx.font = '600 15px "PingFang TC", "Noto Sans TC", sans-serif';
    const w = ctx.measureText(text).width + 22;
    ctx.fillStyle = 'rgba(20, 16, 40, .72)';
    ctx.beginPath(); ctx.roundRect(x, y, w, 28, 14); ctx.fill();
    ctx.strokeStyle = ['', '#4fc3f7', '#ffb74d', '#ef5350'][k]; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle';
    ctx.fillText(text, x + 11, y + 14.5);
    ctx.restore();
  }

  private stepMarks(ctx: CanvasRenderingContext2D, only?: (id: number) => boolean) {
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
        if (!m || m.noDrop || (only && (!only(n.id) || !only(id)))) continue;
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

  /** A plot's angle: from its road squares to it (the map compiler draws the outlines the same way). */
  plotAngle(ref: number, x: number, y: number): number {
    const b = this.game.board, lv = this.art.levels;
    if (lv) {   // 重慶: each plot's own turn (22.5° steps, the map file)
      const k = ref > 6000 ? 'companies' : ref > 4000 ? 'facilities' : 'lands', own = lv.plot_angle[k]?.[(ref % 2000) - 1];
      if (own !== undefined) return own;
    }
    let a = this.plateAngle.get(ref);
    if (a === undefined) {
      const own = b.nodes.filter(n => n.ref === ref);
      let tx = 0, ty = 0;
      if (own.length) { for (const n of own) { tx += n.x; ty += n.y; } tx /= own.length; ty /= own.length; }
      else { let d = Infinity; for (const n of b.nodes) { const e = Math.hypot(n.x - x, n.y - y); if (e < d) { d = e; tx = n.x; ty = n.y; } } }
      a = Math.atan2(y - ty, x - tx); this.plateAngle.set(ref, a);
    }
    return a;
  }

  /**
   * The facing (0..7) that turns a redrawn building's front door to its road (the user: the hotels face the street).
   * Frame (8 − facing − rot) & 7 shows the model turned by 45°·facing in the world; the model's front is +y turned by
   * `turn` degrees (tools/tycoon-art/hotels.py TURN, 0: plots lie at multiples of 45°), i.e. the world angle
   * 90 + turn + 45·facing.
   */
  roadFacing(ref: number, x: number, y: number, turn = 0): number {
    const toRoad = this.plotAngle(ref, x, y) * 180 / Math.PI + 180;
    return ((Math.round((toRoad - 90 - turn) / 45) % 8) + 8) % 8;
  }

  private ownerPlates(ctx: CanvasRenderingContext2D, only?: (ref: number) => boolean) {
    const g = this.game, b = g.board;
    const angle = (ref: number, x: number, y: number) => this.plotAngle(ref, x, y);
    const plate = (ref: number, x: number, y: number, owner: number, side: number) => {
      if (only && !only(ref)) return;
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
    // Large plots the redrawn ground left out (issue #73: 地圖08's 北海岸 by the item shop): the same dark square as the
    // others, so the plot shows where it is.
    if (this.tiled) for (const id of MISSING_PLOT_ART[g.settings.mapId] ?? []) {
      const f = b.facilities[id - 1];
      if (!f || f.owner) continue;
      const a = angle(f.id + 4000, f.x, f.y), c = Math.cos(a), sn = Math.sin(a), h = 43;
      ctx.beginPath();
      for (const [u, v] of [[-h, -h], [h, -h], [h, h], [-h, h]]) ctx.lineTo(f.x + u * c - v * sn, f.y + u * sn + v * c);
      ctx.closePath();
      ctx.fillStyle = 'rgba(12, 58, 6, .55)'; ctx.fill();
    }
    if (this.art.levels) { this.cqPlots(ctx, only); return; }
    for (const l of b.lands) if (l.owner) plate(l.id + 2000, l.x, l.y, l.owner, 44);
    for (const f of b.facilities) if (f.owner) plate(f.id + 4000, f.x, f.y, f.owner, 86);
    for (const co of b.companies) if (co.controller && (!plotless(b.mapId) || co.resource)) plate(co.id + 6000, co.x, co.y, co.controller, 86); // (a map made in the editor — a player's, 長安: its bank and store have no plot, its 企業大樓 one; the user 2026-11-19 「斜的方塊直接覆蓋在圓形的地塊上，很醜」)
  }

  /**
   * 重慶's plots (docs/rules/33 §1, the user 2026-11-09: 「能買的地塊再醒目一些，拼合的再嚴絲合縫一些」): every lot and
   * large plot framed in a clean gold band over the edge of its pad in the ground picture (54 / 102 px, turned with it, the band 8 / 12 px wide over it),
   * so the pad's turned, ragged edge never shows; an owned one framed and tinted in the owner's colour instead.
   */
  private cqPlots(ctx: CanvasRenderingContext2D, only?: (ref: number) => boolean) {
    const g = this.game, b = g.board;
    const own = (k: 'lands' | 'facilities' | 'companies', i: number, d: number): [number, number] => this.art.levels?.plot_size?.[k]?.[i] ?? [d, d];
    const frame = (ref: number, x: number, y: number, owner: number, [wide, deep]: [number, number], band: number) => {
      if (only && !only(ref)) return;
      const p = owner ? g.players[owner - 1] : undefined, color = p && !p.bankrupt ? CHARACTERS[p.character].color : null;
      if (!color && ref > 6000) return;   // a company is not bought by stopping on it
      const a = this.plotAngle(ref, x, y), c = Math.cos(a), s = Math.sin(a);
      // a frame `inset` px inside the plot's edge; the map editor's sizes: `wide` along the road, `deep` away from it
      // (the plot's angle points from its road to it)
      const path = (inset: number) => {
        const hw = deep / 2 - inset, hd = wide / 2 - inset;
        ctx.beginPath();
        for (const [u, v] of [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]]) ctx.lineTo(x + u * c - v * s, y + u * s + v * c);
        ctx.closePath();
      };
      const rgb = color === null ? '255, 214, 92' : `${color >> 16 & 255}, ${color >> 8 & 255}, ${color & 255}`;
      let glow = 0;
      if (color !== null && this.flashing?.refs.has(ref)) { const k = Math.min(1, (performance.now() - this.flashing.start) / 480); glow = Math.sin(k * Math.PI * 2) * 0.32; }
      ctx.lineJoin = 'miter';
      if (color === null) {
        // an empty plot as the originals mark it (the user 2026-11-11: 「畫成和原版似的，像粉筆描地邊那種感覺…醒目一點，
        // 還細一點」): a thin chalk line, a little broken, over a faint shadow that hides the pad's own edge
        path(0.5);
        ctx.setLineDash([]); ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(24, 20, 16, .45)'; ctx.stroke();
        path(1.5);
        ctx.setLineDash([9, 2.5, 4, 2]); ctx.lineCap = 'round';
        ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(236, 248, 222, .92)'; ctx.stroke();
        ctx.setLineDash([]); ctx.lineCap = 'butt';
        return;
      }
      // an owned plot: its owner's colour inside, a thin line of it round (the empty plot's chalk, in colour)
      path(band / 2);
      ctx.fillStyle = `rgba(${rgb}, ${0.38 + Math.max(0, glow)})`; ctx.fill();
      if (glow > 0) { ctx.fillStyle = `rgba(255, 255, 255, ${glow * 0.6})`; ctx.fill(); }
      path(1);
      ctx.lineWidth = band / 2 + 2; ctx.strokeStyle = 'rgba(36, 22, 8, .8)'; ctx.stroke();
      ctx.lineWidth = band / 2; ctx.strokeStyle = `rgb(${rgb})`; ctx.stroke();
    };
    for (const l of b.lands) frame(l.id + 2000, l.x, l.y, l.owner, own('lands', l.id - 1, 54), 8);
    for (const f of b.facilities) frame(f.id + 4000, f.x, f.y, f.owner, own('facilities', f.id - 1, 104), 12);
    for (const co of b.companies) if (!plotless(b.mapId) || co.resource) frame(co.id + 6000, co.x, co.y, co.controller, own('companies', co.id - 1, 104), 12);
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
    // The same easing per 60th of a second whatever the frame rate: the camera 0.25 of the way; the dialog offset
    // 0.1 (0.2 until issue #11: the map slid up for a box too quickly).
    this.fy += (this.focusY - this.fy) * (1 - Math.pow(0.9, dt / 16.7));
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
    const g = this.game, ctx = this.ctx, b = g.board, lv = this.art.levels;
    this.frameNo++;
    this.moveCamera();

    // 1. Ground: the whole texture under one affine transform (08 §4.3), kept drawn in chunks (`GroundCache`).
    const { a, b: bb, c, d } = this.basis();
    const e = this.W / 2 - a * this.cam.x - c * this.cam.y, f = this.H * this.fy - bb * this.cam.x - d * this.cam.y;
    try { this.drawGround(ctx, e, f); } catch (err) { this.oops('ground', err); }
    ctx.setTransform(a * this.dpr, bb * this.dpr, c * this.dpr, d * this.dpr, e * this.dpr, f * this.dpr);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    if (!lv) {   // 重慶: each plate draws its own (drawPlate)
      if (this.art.stepMarks) this.stepMarks(ctx);
      this.ownerPlates(ctx);
    }
    this.street?.drawGround(ctx); // 歌舞伎町's avenues and rails round the board (docs/rules/21 §8.3)
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    const visible = (x: number, y: number, m = 200) => {
      const p = this.project(x, y);
      return p.x > -m && p.x < this.W + m && p.y > -m && p.y < this.H + m * 1.5 ? p : null;
    };
    // Who a tall piece (a city wall, a tower) must not hide (the user 2026-11-19: 「角色在城牆根下被擋住」): the
    // actors' screen points; the pieces in front of them fade or open a hole round them (revealMode).
    this.revealPts = [];
    if (this.revealMode !== 'off') for (const [id, a] of this.actors) {
      if (!a.visible) continue;
      const w = this.at(a), q = visible(w.x, w.y);
      if (q && (id >= g.npcBase || g.players[id])) this.revealPts.push({ x: q.x, y: q.y });
    }

    // 2. Event icons, flat on the ground (map#24, frame aux - 1, never rotated).
    const drawPad = (n: BoardNode) => {
      // 大富豪模式 (docs/rules/17 §2): 車站 / 機場 have their own pads (map sprites 9017 / 9018, the size of map#24's).
      if (n.event === 17 || n.event === 18) {
        const p = visible(n.x, n.y, 60);
        if (p) {
          this.sprite('map', n.event === 17 ? 9017 : 9018, 0, p.x, p.y);
        }
        return;
      }
      // 歌舞伎町 (docs/rules/21 §7.1): 柏青哥店 / 拉霸店 have their own pads (map sprites 9019 / 9020, the same size).
      // 激情歲月 (docs/rules/24 §4): every pad redrawn in the era's look (map sprites 9100 + aux, 9150 the branch bank).
      const pad = this.street instanceof KbStreet ? kbPadSprite(g, n.event) : jqPadSprite(g, n);
      if (pad) {
        const p = visible(n.x, n.y, 60);
        if (p) this.sprite('map', pad, 0, p.x, p.y);
        return;
      }
      // 重慶's 扶梯 / 直梯 squares (docs/rules/33 §2): pads of their own (map 9201 / 9202, smaller: lots close by)
      if (lv && (lv.escalator.includes(n.id) || lv.elevator.includes(n.id))) {
        const p = visible(n.x, n.y, 60);
        if (p) this.sprite('map', lv.escalator.includes(n.id) ? 9201 : 9202, 0, p.x, p.y);
        return;
      }
      // 官方地圖 in the editor's format (長安): its own pads, 4× pictures the size of map#24's (MapArt.padImages)
      const own = this.art.padImages?.[n.id];
      if (own) {
        const p = visible(n.x, n.y, 60);
        if (p) {
          // (each picture made the size of map#24's own: 點券 180 px wide, its coin as big as a blank square's dot (the user: 「要和小黃點大小一樣」), 小遊戲 248, the rest 496 — the user 2026-11-19:
          // 「原版的點券地也沒這麼大的圓」)
          // (the 小事件 and 點券 pads, the 200 px pictures, a quarter bigger — on every map with its own pads, the standard
          // from now on: the user 2026-11-23 on 清明上河: 「小事件跟這個點券的這個小地標還是有點小…再稍微大一點」, then
          // 「這個大小可以，以後都按這個標準來…長安…也改過來」)
          const small = own.width <= SMALL_PAD_W ? SMALL_PAD_GROW : 1;
          // 清明上河's 梁山 mini-games at the 小事件's size (the user 2026-11-24: 「小遊戲的圓地標的大小也改成和小事件一樣大吧」)
          const game = MINI_GAME_PAD.test(own.src) ? (SMALL_PAD_W * SMALL_PAD_GROW) / own.width : 1;
          const s = this.zoom * 0.25 * (this.art.padScale ?? 1) * small * game;
          this.ctx.imageSmoothingEnabled = true;
          this.ctx.drawImage(own, p.x - (own.width * s) / 2, p.y - (own.height * s) / 2, own.width * s, own.height * s);
        }
        return;
      }
      if (!n.aux) return;
      const p = visible(n.x, n.y, 60);
      // 自建地圖 (ui/maker): the pads at the size the editor shows (a square a step away stays clear of them)
      if (p) this.sprite('map', 24, n.aux - 1, p.x, p.y, undefined, false, this.art.padScale ?? 1);
    };
    if (!lv) for (const n of b.nodes) drawPad(n);   // 重慶: each plate's own (drawPlate)
    // 岔路箭頭 (docs/rules/14): a small arrow on the grass beside every fork, under buildings and players
    // (歌舞伎町: bigger and glowing, over its busy street, after the sprites below).
    const arrows = () => drawForkArrows(ctx, g, (x, y) => this.project(x, y), this.zoom, this.W, this.H, this.art.decor);
    const busyStreet = !!this.street && !(this.street instanceof MkStreet);   // (歌舞伎町 / 激情歲月: arrows over the crowd)
    if (!busyStreet && !lv) arrows();

    // 3. Surcharge / seizure diamonds pressed into the ground, then the y-sorted sprites.
    const items: Item[] = [];
    // 重慶 (docs/rules/33 §1): one level looked at. Every level's items after its own plate, the levels bottom to top,
    // what is drawn so far softened before each plate (so the ones under the level looked at blur, the deeper the
    // more); nothing of a level above it. Everything else (effects, marks) goes with the level looked at.
    // Up the 公路 (§2): the second level comes in and the first blurs away square by square (`lift`), the viaduct and
    // whoever is on it always sharp, laid over the second level so it meets its road.
    const LV = 1e7, ramp = new Set(lv?.ramp ?? []), seen = lv ? this.viewLevel() : 0, lift = lv ? this.liftOf(seen) : 1;
    const top = lv && seen <= 2 && !this.levelPick ? (lift > 0.02 ? 2 : 1) : seen, R = Math.min(top, 2);
    if (lv) this.noteLevel(top === 2 && seen <= 2 && !this.levelPick && lift < 0.5 ? 1 : top);
    const faded = (draw: () => void) => () => { const al = ctx.globalAlpha; ctx.globalAlpha = al * lift; try { draw(); } finally { ctx.globalAlpha = al; } };
    const addAt = (level: number, sy: number, layer: number, draw: () => void, fade = true) => {
      if (level <= top) items.push({ key: level * LV + sy * 16 + layer, draw: fade && level === 2 && lift < 0.999 ? faded(draw) : draw });
    };
    const add = (sy: number, layer: number, draw: () => void) => addAt(top, sy, layer, draw);
    if (lv) {
      const padsOf = (only: (n: BoardNode) => boolean) => { for (const n of b.nodes) if (only(n)) drawPad(n); };
      for (let k = 1; k <= top; k++) {
        const lk = k, half = lk === 2 && lift < 0.999;
        items.push({ key: lk * LV - LV / 2 - 1, draw: () => this.blurBelow(ctx, half ? lift : 1) });
        const plate = () => this.drawPlate(ctx, lk, e, f, padsOf, ramp, arrows);
        items.push({ key: lk * LV - LV / 2, draw: half ? faded(plate) : plate });
      }
      items.push({ key: R * LV - LV / 2 + 1, draw: () => this.drawViaduct(padsOf, ramp, e, f) });
    }
    const nodeLv = (id: number) => (!lv ? 0 : ramp.has(id) ? R : nodeLevel(lv, id));
    const addOn = (id: number, sy: number, layer: number, draw: () => void) => addAt(nodeLv(id), sy, layer, draw, !ramp.has(id));
    const stage = houseSet(b) >> 2, inStage = houseSet(b) & 3;
    const ownerColor = (o: number) => (o ? CHARACTERS[g.players[o - 1]?.character ?? 0].color : 0);

    // While a clip plays, the lots keep their look until the clip's redraw frame (11 §0.2): draw a snapshot.
    if (!this.lotsFrozen) this.lotSnap = { lands: b.lands.map(l => ({ level: l.level, chain: l.chain, owner: l.owner })), facilities: b.facilities.map(f => ({ level: f.level, type: f.type, owner: f.owner })) };
    const snap = this.lotsFrozen ? this.lotSnap : null;
    for (const [li, live] of b.lands.entries()) {
      const l = { ...live, ...snap?.lands[li] };
      const lvl = lv ? lv.lands[li] : 0;
      if (lvl > top) continue;
      const p = visible(l.x, l.y);
      if (!p) continue;
      let fr = buildingFrame(lv ? lv.facing.lands[li][0] : l.facing, this.rot);
      if (l.tmpState && !lv) this.decal(fr & 1, l.tmpState & 1, p.x, p.y);
      if (l.level) {
        const mkh = this.mkHouse(l); if (mkh) fr = buildingFrame(this.doorToRoad(l.id + 2000, l.x, l.y), this.rot);
        const res = mkh ?? (lv ? cqHouseSprite(lv, li, l.level) : undefined) ?? kbHouseSprite(g, l) ?? jqHouseSprite(g, l) ?? cityLotSprite(g, l) ?? (l.chain ? 79 + houseSet(b) : 39 + houseSet(b) * 5 + l.level - 1); // 歌舞伎町's houses (21)
        addAt(lvl, p.y, Layer.building, () => { this.sprite('map', res, fr, p.x, p.y, ownerColor(l.owner)); this.neon(res, fr, p.x, p.y, l.id + 2000); this.flashOver(l.id + 2000, 'map', res, fr, p.x, p.y); });
      } else if (l.owner) {
        const ch = g.players[l.owner - 1]?.character ?? 0;
        addAt(lvl, p.y, Layer.building, () => this.sprite('map', 25, ch, p.x, p.y));
      }
      if (g.rules?.lotFlag?.(l.id + 2000)) addAt(lvl, p.y + 1, Layer.building, () => this.lotFlag(p.x, p.y));
      if (this.highlight === l.id - 1) addAt(lvl, p.y, Layer.zzz + 1, () => this.ring(p.x, p.y));
    }
    for (const [fi, live] of b.facilities.entries()) {
      const fa = { ...live, ...snap?.facilities[fi] };
      const lvl = lv ? lv.facilities[fi] : 0;
      if (lvl > top) continue;
      const p = visible(fa.x, fa.y, 260);
      if (!p) continue;
      let fr = buildingFrame(lv ? lv.facing.facilities[fi][0] : 0, this.rot);
      if (fa.tmpState && !lv) this.decal(2 + (fr & 1), fa.tmpState & 1, p.x, p.y);
      if (fa.level) {
        const cq = lv && fa.type !== 1 ? cqFacSprite(lv, fi, fa) : undefined; // 重慶's 麻將館, 小吃街, 火鍋店, 研究所 (docs/rules/33 §6)
        const mkf = this.mkFac(fa);
        if (mkf) fr = buildingFrame(this.doorToRoad(fa.id + 4000, fa.x, fa.y), this.rot);   // 長安's: the door to the road
        const jq = mkf ?? cq ?? jqFacSprite(g, fa); // 長安's (MakerMap.builds), 激情歲月's five facilities (docs/rules/24 §2)
        if (!jq && !lv && hotelSprite(fa, this.game.settings.mapId)) fr = buildingFrame(this.roadFacing(fa.id + 4000, fa.x, fa.y), this.rot); // the new hotels face their road
        const i = fa.type === 0 ? 0 : fa.type === 1 ? fa.level : fa.type === 2 ? 5 + fa.level : fa.type === 3 ? 11 : 11 + fa.level;
        // 大富翁城's casino (docs/rules/19), 歌舞伎町's shops (21)
        const res = jq ?? casinoSprite(fa) ?? kbShopSprite(g, fa) ?? hotelSprite(fa, this.game.settings.mapId) ?? (stage === 0 ? 87 + i : 104 + inStage * 17 + i);
        addAt(lvl, p.y, Layer.building, () => { this.sprite('map', res, fr, p.x, p.y, ownerColor(fa.owner)); this.neon(res, fr, p.x, p.y, fa.id + 4000); this.flashOver(fa.id + 4000, 'map', res, fr, p.x, p.y); });
      } else if (fa.owner) {
        const ch = g.players[fa.owner - 1]?.character ?? 0;
        addAt(lvl, p.y, Layer.building, () => this.sprite('map', 25, ch, p.x, p.y));
      }
      if (g.rules?.lotFlag?.(fa.id + 4000)) addAt(lvl, p.y + 1, Layer.building, () => this.lotFlag(p.x, p.y));
    }
    for (const [ci, co] of b.companies.entries()) {
      if (!co.resource) continue;
      const lvl = lv ? lv.companies[ci] : 0;
      const p = visible(co.x, co.y, 260);
      const res = lv ? cqCompanySprite(lv, ci, co.resource + 38) : co.resource + 38, fr = buildingFrame(lv ? lv.facing.companies[ci][0] : co.facing, this.rot);
      if (p) addAt(lvl, p.y, Layer.building, () => this.sprite('map', res, fr, p.x, p.y, ownerColor(co.controller)));
    }
    for (const [li, ls] of b.landscapes.entries()) {
      if (!ls.resource) continue;
      const p = visible(ls.x, ls.y, 300);
      // Landscapes keep their own outline colour (09 §3.4); a magenta placeholder is drawn as a dark line.
      if (p) addAt(lv ? lv.landscapes[li] : 0, p.y, Layer.building, () => {
        // 重慶: a landmark's own size and facing from the map editor (editor/site/remake.html)
        const res = ls.resource + 38, fr = buildingFrame(lv?.landscape_face?.[li] ?? ls.facing, this.rot);
        const sz = lv?.landscape_scale?.[li] ?? this.art.landscapeScale?.[li] ?? 1;
        if (!this.revealSprite('map', res, fr, p.x, p.y, sz)) this.sprite('map', res, fr, p.x, p.y, this.bank.placeholderOutline('map', res) ? 0x202020 : undefined, false, sz);
        this.neon(res, fr, p.x, p.y, 8000 + li);
      });
    }
    // The APARTMENT HOTEL 11 towers (ui/ah11.ts): decoration drawn like the landscapes.
    const towers = ah11Placements(g, this.art.decor);
    for (const t of towers) {
      const p = visible(t.x, t.y, 300);
      if (p) add(p.y, Layer.building, () => this.sprite('map', t.res, buildingFrame(t.facing, this.rot), p.x, p.y));
    }

    // Decorations (plants; the remake's own maps): sorted with the buildings, the season from the calendar.
    if (this.art.decor?.length) {
      const m = month(g.date), season = m >= 3 && m <= 5 ? 0 : m >= 6 && m <= 8 ? 1 : m >= 9 && m <= 11 ? 2 : 3;
      for (const [di, d] of this.art.decor.entries()) {
        const p = visible(d.x, d.y, 90);
        if (!p || this.street?.covers(d.x, d.y) || ah11Hides(towers, d)) continue;
        addAt(lv ? lv.decorations[di] : 0, p.y, Layer.building, () => {
          const n = this.bank.board('map', d.res)?.length ?? 0;
          if (n) { this.sprite('map', d.res, Math.min(season, n - 1), p.x, p.y, undefined, false, d.s ?? 1); this.neon(d.res, Math.min(season, n - 1), p.x, p.y, 9000 + di); }
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
        addOn(pl.node, y, Layer.building, () => this.sprite('Data', 395 + o.type, (sd + 4) & 7, x, y));
      } else if (o.node && !this.hiddenObjects.has(o.node)) {
        const n = nodeById(b, o.node), p = visible(n.x, n.y);
        if (p) addOn(o.node, p.y, Layer.building, () => this.sprite('Data', 395 + o.type, screenDir(o.dir, this.rot), p.x, p.y));
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
      const on = (draw: () => void) => (pl ? addOn(pl.node, p.y, layer, draw) : addAt(top, p.y, layer, draw));
      on(() => {
        const frames = this.bank.board('Data', spr.res);
        if (!frames) return;
        const fpd = Math.max(1, frames.length >> 3);
        const anim = Math.min(a.anim, fpd - 1);
        this.sprite('Data', spr.res, screenDir(a.dir, this.rot) * fpd + anim, p.x, p.y, undefined, spr.frozen, SPRITE_SIZE[spr.res]);
      });
      if (pl?.sleepwalk) on(() => this.sprite('Data', 414, a.zzz, p.x, p.y));
    }

    this.fx.draw(add);
    // The discs of what an effect is about lie on the ground, under whatever stands on them (11 §7.1).
    for (const sp of this.markSpots()) { const p = visible(sp.x, sp.y, 120); if (p) add(p.y, -1, () => this.markDisc(p.x, p.y, sp.r)); }
    // The street maps' glowing fork arrows (over their busy sidewalks) go over every board item but under the
    // effects' speech clouds and pop-ups (TOP + 1, ui/effects.ts): a line is never covered by an arrow.
    if (busyStreet) add(TOP - 1, 0, () => drawForkArrows(ctx, g, (x, y) => this.project(x, y), this.zoom, this.W, this.H, this.art.decor, { scale: 1.6, glow: true }));
    items.sort((x, y) => x.key - y.key);
    // One picture that fails (released, not decodable) must not take the rest of the frame with it.
    for (const it of items) { try { it.draw(); } catch (err) { this.oops('sprite', err); } }
    if (lv) this.levelBadge(ctx, top);
    if (this.overWorld) {
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      try { this.overWorld(ctx, this.W, this.H, this.dpr, this.zoom); } catch (err) { this.oops('weather', err); }
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }
    if (this.street || this.game.rt || this.game.players.some(p => this.game.isBeggar(p))) this.badges();
    if (this.marks.size || this.markNodes.size) this.drawMarks();

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
    if (!(this.street instanceof KbStreet) || !KbStreet.glows(res)) return;
    const f = this.bank.board('map', res)?.[frame];
    if (!f) return;
    const s = this.zoom * f.scale;
    this.street.glow(this.ctx, f.img, id, sx - f.ax * s, sy - f.ay * s, f.w * s, f.h * s);
  }

  /**
   * 歌舞伎町's signs over the heads (docs/rules/21 §2.2 「處理事務中」, §4.1 「黑幫附身」): small rounded tags; 即時制's
   * 「購物中」 over a player in a shop, the bank, the magic house or the lottery, 「保護中」 over one hit enough this turn
   * (簡單 / 中等) — cards cannot pick them meanwhile.
   */
  private badges() {
    const g = this.game, ctx = this.ctx, z = this.zoom;
    const fs = Math.max(11, Math.min(15, 11 * z));
    for (const p of g.players) {
      // 派對模式's 乞丐 (Game.beggarRule): 「乞丐 1.2萬／5萬」, how far from coming back
      const beg = g.isBeggar(p) ? [{ text: `乞丐 ${shortMoney(p.cash + p.bank)}／${shortMoney(REVIVE)}`, kind: 'beggar' }] : [];
      const list = [...beg, ...kbBadges(g, p.id), ...jqBadges(g, p.id), ...(g.rt?.isIndoors(p.id) ? [{ text: '購物中', kind: 'busy' }] : g.rt?.isShielded(p.id) ? [{ text: '保護中', kind: 'busy' }] : [])], a = this.actors.get(p.id);
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
        ctx.fillStyle = t.kind === 'gang' ? 'rgba(28, 24, 30, .92)' : t.kind === 'taxi' ? 'rgba(255, 196, 0, .95)' : t.kind === 'beggar' ? 'rgba(120, 78, 40, .94)' : 'rgba(64, 82, 212, .92)';
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
  /**
   * 清明上河's 梁山旗 (the 替天行道 banner, maps/remake/qingming/liangshan-flag.webp) standing at the back corner of a lot
   * that carries one (MapRules.lotFlag), about a house and a half tall (the user 2026-11-24: 「插上梁山旗子的效果為啥沒做出來呢？」).
   */
  private lotFlag(x: number, y: number) {
    if (!this.flagImg) { this.flagImg = new Image(); this.flagImg.src = `${ASSETS}/maps/remake/qingming/liangshan-flag.webp`; }
    const img = this.flagImg;
    if (!img.complete || !img.naturalWidth) return;
    const h = 92 * this.zoom, w = (h * img.naturalWidth) / img.naturalHeight;
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.drawImage(img, x + 14 * this.zoom - w / 2, y + 6 * this.zoom - h, w, h);
  }

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

  /** The lots, facilities and squares of `marks` / `markNodes`: world point, disc radius, pointer height (world px). */
  private markSpots(): { x: number; y: number; r: number; up: number }[] {
    const b = this.game.board, spots: { x: number; y: number; r: number; up: number }[] = [];
    for (const ref of this.marks) {
      const l = ref > 2000 && ref < 4000 ? b.lands[ref - 2001] : undefined, f = ref > 4000 && ref < 6000 ? b.facilities[ref - 4001] : undefined;
      if (l) spots.push({ x: l.x, y: l.y, r: 30, up: 34 + 13 * Math.min(5, l.level) });
      else if (f) spots.push({ x: f.x, y: f.y, r: 52, up: f.level ? 110 : 40 });
    }
    for (const id of this.markNodes) {
      const n = b.nodes.find(m => m.id === id);
      if (n) spots.push({ x: n.x, y: n.y, r: 34, up: 76 });
    }
    return spots;
  }

  /** A mark's glowing disc on the ground (drawn in the y-sorted pass, under the building standing on it). */
  private markDisc(x: number, y: number, r0: number) {
    const ctx = this.ctx, z = this.zoom, pulse = 0.5 + 0.5 * Math.sin(performance.now() / 220);
    ctx.save();
    ctx.shadowColor = '#ffd23f'; ctx.shadowBlur = 14;
    ctx.lineWidth = 3.5;
    ctx.fillStyle = `rgba(255, 226, 60, ${0.28 + 0.16 * pulse})`;
    ctx.strokeStyle = `rgba(255, 246, 160, ${0.8 + 0.2 * pulse})`;
    const r = (r0 + 4 * pulse) * z;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * K, 0, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  /**
   * The marks' pointers (docs/rules/11 §7.1): a bouncing golden pointer above each lot, facility or square an
   * effect is about, drawn over the board so no building hides it (the discs lie on the ground under them).
   */
  private drawMarks() {
    const ctx = this.ctx, z = this.zoom, pulse = 0.5 + 0.5 * Math.sin(performance.now() / 220);
    for (const sp of this.markSpots()) {
      const q = this.project(sp.x, sp.y);
      if (q.x < -120 || q.x > this.W + 120 || q.y < -200 || q.y > this.H + 120) continue;
      const y = q.y - (sp.up + 8 * pulse) * z;
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = 4;
      ctx.beginPath();
      ctx.moveTo(q.x, y + 16 * z); ctx.lineTo(q.x - 12 * z, y); ctx.lineTo(q.x + 12 * z, y); ctx.closePath();
      ctx.fillStyle = 'rgba(255, 214, 40, .98)';
      ctx.strokeStyle = 'rgba(120, 60, 0, .95)'; ctx.lineWidth = 2;
      ctx.fill(); ctx.stroke();
      ctx.restore();
    }
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
