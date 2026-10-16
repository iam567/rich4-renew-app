/**
 * The three mini games of the original (docs/rules/13-mini-games.md, rich4_small_games.asm) as plain state
 * machines: `tick()` is one WM_TIMER of the game's window procedure, `start()` the 0x405 message sent after
 * READY GO, and the input handlers are its WM_LBUTTONDOWN. Each tick leaves the sprites that tick draws in
 * `sprites`; `hud()` gives the digit strip. No DOM here: mini-games.ts paints the lists and plays the sounds.
 * Coordinates are the original's 640×480 screen; a sprite (x, y) puts the frame's anchor there.
 */

/** libc `rand()`: 0..32767. */
export type Rand = () => number;
export const libcRand: Rand = () => Math.floor(Math.random() * 32768);

/** Effect.mkf numbers of the games' slot tables (0x475057, 0x47509f, 0x4750bf): play (loop) / stop. */
export interface Sound { play(id: number, loop?: boolean): void; stop(id: number): void }
export const SILENT: Sound = { play() {}, stop() {} };

/** A frame to draw: Panel.mkf unless `archive` says otherwise; `scale` (16.16 / 65536) keeps the anchor unscaled. */
export interface Sprite { archive?: 'Panel' | 'Data'; id: number; frame: number; x: number; y: number; scale?: number }
/** Size and anchor of an original frame (the manifest's width / height / anchor_x / anchor_y). */
export interface Box { w: number; h: number; ax: number; ay: number }

/**
 * intro: the first ticks before READY GO (the penguin's treasure is on show); ready: the screen plays READY GO
 * (Panel #78) and then calls start(); play; result: the big score; done: the screen closes.
 */
export type Phase = 'intro' | 'ready' | 'play' | 'result' | 'done';

export interface MiniGame {
  readonly phase: Phase;
  /** Timer period in ms (SetTimer 100 / 100 / 50). */
  readonly tickMs: number;
  readonly score: number;
  sprites: Sprite[];
  tick(): void;
  start(): void;
  hud(): Sprite[];
}

// ---------------------------------------------------------------- shared drawing

/** The digit strip: Panel #79 frames 0..9 (15×28, anchor 0,0) at y 0x1a5 (fcn_00413a4a / 413f07 / 41417e). */
const HUD_Y = 0x1a5;
const pad = (n: number, w: number) => String(n).padStart(w, '0');
function digits(out: Sprite[], text: string, xs: number[]) {
  xs.forEach((x, i) => out.push({ id: 79, frame: (text.charCodeAt(i) - 48) | 0, x, y: HUD_Y }));
}
/** The clock box: '%03d' of the counter at x 49, 69, 94 and a fixed frame 0 at 114 (150 ticks read 15.00). */
function clock(out: Sprite[], t: number) {
  digits(out, pad(t, 3), [0x31, 0x45, 0x5e]);
  out.push({ id: 79, frame: 0, x: 0x72, y: HUD_Y });
}

/** The final score (fcn_00414789): Panel #79 frames 10..19 ('0' − 0x26), 66 px apart, centred on x 353, y 150. */
export function bigScore(score: number): Sprite[] {
  const t = String(score), x0 = 0x161 - Math.trunc((t.length * 66) / 2);
  return [...t].map((ch, i) => ({ id: 79, frame: ch.charCodeAt(0) - 0x26, x: x0 + 66 * i, y: 0x96 }));
}

// ---------------------------------------------------------------- 企鵝挖寶 (t = 6)

/**
 * The 9×9 field (ref_00474d80, 8 bytes a cell: x, y, flags): 64 walkable cells, row r / column c. Centres follow
 * x = 48(c + r) − 64, y = 24(r − c) + 225; the hit map Panel #81 holds r·9 + c under each diamond.
 */
const FIELD = ['000111100', '011111110', '011111111', '111111111', '111101111', '111111111', '111111110', '011111110', '001111000'];
/** Flag 0x10: cells behind the igloo, which then covers the penguin (Panel #80.3 at (320, 225)). */
const BEHIND = new Set([3 * 9 + 3, 3 * 9 + 4, 3 * 9 + 5, 4 * 9 + 5, 5 * 9 + 5]);
export const walkable = (c: number, r: number) => c >= 0 && c < 9 && r >= 0 && r < 9 && FIELD[r][c] === '1';
export const cellXY = (c: number, r: number) => ({ x: 48 * (c + r) - 64, y: 24 * (r - c) + 225 });
/** The cell under a screen point (the diamonds of Panel #81), or null off the field. */
export function cellAt(x: number, y: number): { c: number; r: number } | null {
  const u = (x + 64) / 48, v = (y - 225) / 24;
  const r = Math.floor((u + v) / 2 + 0.5), c = Math.floor((u - v) / 2 + 0.5);
  return walkable(c, r) ? { c, r } : null;
}
/** Items buried, kinds 1..5 (ref_00411fc8): 1 is the bomb. */
export const PENGUIN_ITEMS = [3, 12, 3, 9, 1];
/** Points by kind (fcn_00413a4a: 5·kind2 + 12·kind3 + 8·kind4 + 20·kind5). */
export const PENGUIN_POINTS = [0, 0, 5, 12, 8, 20];
/** Sound when a kind comes out (ref_00475051 → slots of 0x475057): 16, 17, 17, 18. */
const DIG_SOUND = [0, 0, 16, 17, 17, 18];
const sign = (n: number) => (n < 0 ? -1 : 1);

/** Penguin dig (fcn_00414858 window procedure, fcn_004124c8 per tick). */
export class Penguin implements MiniGame {
  readonly tickMs = 100;
  phase: Phase = 'intro';
  /** Kind buried under each cell r·9 + c. */
  readonly items = new Array<number>(81).fill(0);
  /** Dug cells, in order (the hole Panel #80.9 is painted into the background). */
  readonly holes: number[] = [];
  /** Found items by kind (0x48bbb4.. = kinds 2..5). */
  readonly counts = [0, 0, 0, 0, 0, 0];
  /** 0x48bd2c: 150 ticks of play. */
  ticks = 150;
  /** 0x48bd7c: ticks showing the treasure before READY GO. */
  private wait = 10;
  /** Position, next cell and steps in 16.16 cells (0x48bd04/08, bd10/0c, bcfc/bd00); target cell (bcdc/bce0). */
  px = 0x20000; py = 0x60000; private nx = 0x20000; private ny = 0x60000; private sx = 0; private sy = 0; private tx = 0; private ty = 0;
  /** 0x48bd5b: the last step went round something; aim again at the next cell. */
  private detour = false;
  /** 0x48bccc: 0 idle, 1 found the bomb, 2 walking, 3 digging, 4 happy end, 5 sad end, 6 plain end. */
  mode = 0;
  /** 0x48bcc4: bits 0-3 frame, 4-7 facing / loop count, 8-11 the item rising out of the hole. */
  private anim = 0;
  /** 0x48bd58: 1 ending, 2 showing the score. */
  private end = 0;
  private found = 0;
  private pop = { kind: 0, x: 0, y: 0 };
  /** The score is painted into the background from the end animation on (412dc0). */
  scoreShown = false;
  private resultTicks = 0;
  sprites: Sprite[] = [];

  constructor(private readonly rand: Rand = libcRand, private readonly sound: Sound = SILENT) { this.bury(); }

  get score() { return this.counts.reduce((s, n, k) => s + n * PENGUIN_POINTS[k], 0); }

  /** fcn_00412014: kind k goes under the pick-th free cell, pick = rand()·left >> 15. */
  private bury() {
    let left = 64;
    PENGUIN_ITEMS.forEach((n, k) => {
      for (let i = 0; i < n; i++) {
        const pick = (this.rand() * left) >> 15;
        let seen = 0;
        found: for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
          if (!walkable(c, r) || this.items[r * 9 + c]) continue;
          if (seen++ === pick) { this.items[r * 9 + c] = k + 1; left -= 1; break found; }
        }
      }
    });
  }

  /** What fcn_0041461b(1) shows before the start: every buried item (Panel #80 frame kind + 3) on its cell. */
  treasure(): Sprite[] {
    const out: Sprite[] = [];
    for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
      const k = this.items[r * 9 + c];
      if (k) out.push({ id: 80, frame: k + 3, ...cellXY(c, r) });
    }
    return out;
  }

  /** The background paint: holes. */
  paint(): Sprite[] { return this.holes.map(i => ({ id: 80, frame: 9, ...cellXY(i % 9, Math.floor(i / 9)) })); }

  hud(): Sprite[] {
    const out: Sprite[] = [], k = this.counts;
    clock(out, this.ticks);
    digits(out, pad(k[5], 2), [0xb9, 0xcd]);
    digits(out, pad(k[3], 2), [0x114, 0x128]);
    digits(out, pad(k[4], 2), [0x16f, 0x183]);
    digits(out, pad(k[2], 2), [0x1ca, 0x1de]);
    digits(out, pad(this.score, 3), [0x225, 0x239, 0x24d]);
    return out;
  }

  start() { if (this.phase === 'ready') this.phase = 'play'; }

  /** WM_TIMER (414900). */
  tick() {
    switch (this.phase) {
      case 'intro': if (--this.wait <= 0) this.phase = 'ready'; break;
      case 'play':
        if (this.ticks > 0 && --this.ticks === 0) this.timeUp();
        this.update();
        if (this.end === 1) { this.end = 2; this.phase = 'result'; this.resultTicks = 20; }
        break;
      case 'result': if (--this.resultTicks <= 0) this.phase = 'done'; break;
    }
  }

  /** WM_LBUTTONDOWN (414aa9): a click ends the score early; while idle, walk to the clicked cell and dig there. */
  click(x: number, y: number) {
    if (this.phase === 'result') { this.resultTicks = 1; return; }
    if (this.phase !== 'play' || this.mode !== 0 || this.end !== 0) return;
    const cell = cellAt(x, y);
    if (!cell || !this.aim(cell.c, cell.r)) return;
    this.step();
    this.mode = 2;
    this.sound.play(11, true);
  }

  /** Time is up (414986): the end animation by score, < 40 sad (#14), > 55 happy (#13), else plain. */
  private timeUp() {
    this.sound.stop(11);
    this.anim &= 0xf00;
    const s = this.score;
    if (s < 40) { this.mode = 5; this.sound.play(14, true); }
    else if (s > 55) { this.mode = 4; this.sound.play(13, true); }
    else this.mode = 6;
  }

  /** fcn_0041211c: a straight line from the current cell's centre, one cell a step along the longer axis. */
  private aim(c: number, r: number): boolean {
    if (!walkable(c, r) || (c === this.px >> 16 && r === this.py >> 16)) return false;
    this.px = (this.px & ~0xffff) + 0x8000;
    this.py = (this.py & ~0xffff) + 0x8000;
    this.tx = c; this.ty = r;
    const dx = c - (this.px >> 16), dy = r - (this.py >> 16);
    const n = Math.abs(dy) < Math.abs(dx) ? Math.abs(dx) : Math.abs(dy);
    this.sx = Math.trunc((dx << 16) / n);
    this.sy = Math.trunc((dy << 16) / n);
    return true;
  }

  /**
   * fcn_00412287: the next cell. Blocked (the igloo, the field's edge): keep the main axis' step and move a whole
   * cell sideways instead of the fraction (or not at all when the fraction already changed row / column), then
   * aim again from there.
   */
  private step() {
    const nx = this.px + this.sx, ny = this.py + this.sy;
    if (walkable(nx >> 16, ny >> 16)) { this.nx = nx; this.ny = ny; return; }
    if (Math.abs(this.sx) === 0x10000) {
      this.nx = nx;
      if (this.ny >> 16 === ny >> 16) { if (this.sy === 0) this.sy = 1; this.ny += sign(this.sy) << 16; }
    } else {
      this.ny = ny;
      if (this.nx >> 16 === nx >> 16) { if (this.sx === 0) this.sx = 1; this.nx += sign(this.sx) << 16; }
    }
    this.detour = true;
    // The original does not look where the side step lands; it never leaves the field there, but should it, the
    // remake takes the walkable neighbour nearest the target instead of walking off the table (重製取捨).
    if (!walkable(this.nx >> 16, this.ny >> 16)) {
      const c0 = this.px >> 16, r0 = this.py >> 16;
      let best: [number, number] | null = null, bestD = Infinity;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const c = c0 + dc, r = r0 + dr;
        if ((dc || dr) && walkable(c, r)) {
          const d = (c - this.tx) ** 2 + (r - this.ty) ** 2;
          if (d < bestD) { bestD = d; best = [c, r]; }
        }
      }
      if (best) { this.nx = (best[0] << 16) + 0x8000; this.ny = (best[1] << 16) + 0x8000; }
    }
  }

  /** fcn_004124c8: one tick of the penguin. */
  private update() {
    const s: Sprite[] = [];
    const cc = this.px >> 16, cr = this.py >> 16, at = cellXY(cc, cr);
    switch (this.mode) {
      case 0: s.push({ id: 80, frame: 1, ...at }); break;
      case 1: // the bomb: standing 3 ticks, startled until 15
        s.push({ id: 80, frame: (this.anim & 0xf) < 3 ? 1 : 2, ...at });
        if ((++this.anim & 0xf) === 0xf) this.end = 1;
        break;
      case 2: { // walking: Panel #82 frame facing·4 + step, a quarter of the way a tick
        let dir: number;
        if (!(this.anim & 3)) {
          const dc = (this.nx >> 16) - cc, dr = (this.ny >> 16) - cr;
          dir = dc > 0 ? 3 - dr : dc === 0 ? (dr > 0 ? 1 : 5) : (dr + 7) & 7;
          this.anim = (this.anim & 0xf0f) | (dir << 4);
        } else dir = (this.anim >> 4) & 0xf;
        const to = cellXY(this.nx >> 16, this.ny >> 16), k = this.anim & 3;
        s.push({ id: 82, frame: dir * 4 + k, x: at.x + ((to.x - at.x) >> 2) * k, y: at.y + ((to.y - at.y) >> 2) * k });
        this.anim = (this.anim + 1) & 0xff3;
        if (!(this.anim & 3)) {
          this.px = this.nx; this.py = this.ny;
          if (this.px >> 16 === this.tx && this.py >> 16 === this.ty) {
            this.sound.stop(11);
            this.sound.play(12);
            this.mode = 3;
          } else {
            if (this.detour) { this.aim(this.tx, this.ty); this.detour = false; }
            this.step();
          }
        }
        break;
      }
      case 3: { // digging: Panel #83; the hole at step 2, what is under it at step 3
        const k = this.anim & 3, i = cr * 9 + cc;
        if (k === 2) this.holes.push(i);
        if (k === 3) {
          if (this.items[i]) {
            this.anim = (this.anim & 0xff) | 0x100;
            this.found = this.items[i];
            this.pop = { kind: this.found, ...at };
            this.items[i] = 0;
          } else this.found = 0;
        }
        s.push({ id: 83, frame: ((this.anim & 0xf0) >> 4) * 4 + (this.anim & 3), ...at });
        this.anim = (this.anim + 1) & 0xff3;
        if (!(this.anim & 3)) {
          if (!this.found) this.mode = 0;
          else if (this.found === 1) { this.mode = 1; this.sound.play(15); }
          else { this.mode = 0; this.sound.play(DIG_SOUND[this.found]); this.counts[this.found] += 1; }
        }
        break;
      }
      case 4: case 5: { // happy (#84, 8 frames) / sad (#85, 6 frames), four times
        const n = this.mode === 4 ? 8 : 6;
        s.push({ id: this.mode === 4 ? 84 : 85, frame: this.anim & 0xf, ...at });
        this.anim += 1;
        if ((this.anim & 0xf) === n) this.anim = (this.anim & 0xf0) + 0x10;
        if ((this.anim & 0xf0) === 0x40) { this.sound.stop(this.mode === 4 ? 13 : 14); this.end = 1; }
        break;
      }
      case 6:
        s.push({ id: 80, frame: 1, ...at });
        if ((++this.anim & 0xf) === 0xf) this.end = 1;
        break;
    }
    // The item rising out of the hole: Panel #(85 + kind) frames 0..5 (the bomb's #86 is its blast).
    if (this.anim & 0xf00) {
      s.push({ id: 85 + this.pop.kind, frame: ((this.anim & 0xf00) >> 8) - 1, x: this.pop.x, y: this.pop.y });
      this.anim += 0x100;
      if ((this.anim & 0xf00) === 0x700) this.anim &= 0xff;
    }
    if (BEHIND.has(cr * 9 + cc)) s.push({ id: 80, frame: 3, x: 0x140, y: 0xe1 });
    if (((this.mode === 1 || this.mode === 6) && (this.anim & 0xf) === 4) || this.mode === 4 || this.mode === 5) this.scoreShown = true;
    this.sprites = s;
  }
}

// ---------------------------------------------------------------- 射氣球 (t = 7)

/** Rise per tick by kind (ref_00475004). */
const BALLOON_SPEED = [15, 15, 15, 15, 18, 18, 18, 24, 24, 24, 24, 18];
/** rand() % 1000 = 28, 29: ×2 (9), ÷2 (10) or ? (11) by rand() % 10 (ref_00475039). */
const BALLOON_SPECIAL = [9, 9, 10, 10, 10, 10, 10, 11, 11, 11];
/** Panel #91 frames: 1..6 the big balloons (kinds 0..5), 7..12 the small ones, 13 the burst. */
const balloonBox = (frame: number): Box =>
  frame <= 6 ? { w: 44, h: 141, ax: 22, ay: 30 } : frame <= 12 ? { w: 36, h: 116, ax: 18, ay: 26 } : { w: 60, h: 122, ax: 28, ay: 40 };
/** Balloons rise in the 640×387 picture above the digit strip (ref_00411fdc). */
const SKY = { w: 640, h: 0x183 };

export interface Balloon { x: number; y: number; w: number }

/** Balloons (fcn_00414bbc window procedure, fcn_00412f6f per tick). */
export class Balloons implements MiniGame {
  readonly tickMs = 100;
  phase: Phase = 'intro';
  /** 16 slots (0x48bc44): x (0 = empty), y, kind | burst counter << 4. */
  readonly slots: Balloon[] = Array.from({ length: 16 }, () => ({ x: 0, y: 0, w: 0 }));
  score = 0;
  ticks = 150;
  /** 0x48bd59: frozen ticks; 0x48bcc8: −1 double speed, 1 half speed. */
  freeze = 0;
  speed = 0;
  private end = 0;
  /** 0x48bd84 = 99 until the first paint, then 5 ticks. */
  private wait = 5;
  private resultTicks = 0;
  sprites: Sprite[] = [];

  constructor(private readonly rand: Rand = libcRand, private readonly sound: Sound = SILENT) {}

  hud(): Sprite[] {
    const out: Sprite[] = [];
    clock(out, this.ticks);
    digits(out, pad(this.score, 4), [0x211, 0x225, 0x239, 0x24d]);
    return out;
  }

  start() { if (this.phase === 'ready') this.phase = 'play'; }

  /** WM_TIMER (414c69). */
  tick() {
    switch (this.phase) {
      case 'intro': if (--this.wait <= 0) this.phase = 'ready'; break;
      case 'play':
        if (this.freeze) this.freeze -= 1;
        if (this.ticks && --this.ticks === 0) this.end = 1;
        this.update();
        // No more balloons after the time: the score for 2 s (fcn_0045285e(2000), not skippable).
        if (this.end === 2) { this.phase = 'result'; this.resultTicks = 20; }
        break;
      case 'result': if (--this.resultTicks <= 0) this.phase = 'done'; break;
    }
  }

  /** fcn_00412f6f: move, draw, drop the gone; empty slots may get a new balloon until the time is up. */
  private update() {
    const s: Sprite[] = [];
    let any = false;
    for (const b of this.slots) {
      if (b.x) {
        if (b.w & 0xf0) {
          b.w -= 0x10;
          if (!(b.w & 0xf0)) { b.x = 0; continue; }
        } else if (!this.freeze) {
          let v = BALLOON_SPEED[b.w];
          if (this.speed === -1) v *= 2; else if (this.speed === 1) v >>= 1;
          b.y -= v;
        }
        const frame = (b.w & 0xf) + 1, box = balloonBox(frame), left = b.x - box.ax, top = b.y - box.ay;
        if (left >= SKY.w || top >= SKY.h || left + box.w <= 0 || top + box.h <= 0) b.x = 0;
        else s.push({ id: 91, frame, x: b.x, y: b.y });
        if (b.x) any = true;
      } else if (!this.end) {
        const r = this.rand() % 1000;
        const kind = r < 20 ? r >> 2 : r < 28 ? ((27 - r) >> 1) + 5 : r < 30 ? BALLOON_SPECIAL[this.rand() % 10] : -1;
        if (kind < 0) continue;
        // Eight columns x = 40 + 80n; one is free when no balloon there is still low (y > 300).
        const free: number[] = [];
        for (let x = 0x28; x < 0x280; x += 0x50) if (!this.slots.some(o => o.x === x && o.y > 0x12c)) free.push(x);
        if (!free.length) continue;
        this.sound.play(19);
        b.x = free[this.rand() % free.length]; b.y = 0x1a4; b.w = kind;
      }
    }
    if (!any && this.end === 1) this.end = 2;
    this.sprites = s;
  }

  /**
   * WM_LBUTTONDOWN (414d9f), also after the time while balloons are left: every balloon whose body is under the
   * point bursts (±22×±30, the small ones ±18×±26): kinds 0..8 add kind + 1 (up to 999), 9 doubles, 10 halves,
   * 11 is a surprise (rand() % 6). Missing plays #20, a hit #21.
   */
  click(x: number, y: number, slack = 0) {
    if (this.phase !== 'play' || this.end === 2) return;
    let hit = false, miss = false;
    const box = (b: Balloon) => (b.w >= 6 ? [0x12, 0x1a] : [0x16, 0x1e]);
    // The drawn body reaches lower than the original box (its tapered bottom: to +44 for the small ones, +50 for
    // the big): that part counts too, so a tap on any part of the balloon you can see hits.
    const under = (b: Balloon, m: number) => {
      const [hw, hh] = box(b), dy = y - b.y;
      return Math.abs(x - b.x) <= hw + m && dy >= -hh - m && dy <= hh + 18 + m;
    };
    const live = this.slots.filter(b => b.x && !(b.w & 0xf0));
    // Remake: a finger is not a mouse pointer. When the tap is not on a balloon's body, the nearest balloon whose
    // body is within `slack` (game px, the caller's finger tolerance) bursts — one balloon only.
    let targets = live.filter(b => under(b, 0));
    if (!targets.length && slack > 0) {
      const near = live.filter(b => under(b, slack))
        .sort((a, b) => Math.hypot(x - a.x, y - a.y) - Math.hypot(x - b.x, y - b.y));
      targets = near.slice(0, 1);
    }
    for (const b of live) {
      if (!targets.includes(b)) { miss = true; continue; }
      hit = true;
      switch (b.w) {
        case 9: this.score *= 2; break;
        case 10: this.score >>= 1; break;
        case 11:
          this.freeze = 0; this.speed = 0;
          switch (this.rand() % 6) {
            case 0: this.ticks = 1; break; // the time ends at the next tick
            case 1: this.freeze = 20; break;
            case 2: this.speed = -1; break;
            case 3: this.speed = 1; break;
            case 4: this.score = 0; break;
            default: this.score *= 2;
          }
          break;
        default: this.score = Math.min(999, this.score + b.w + 1);
      }
      b.w = 0x3c; // the burst frame 13 for two ticks
    }
    if (hit) this.sound.play(21);
    if (miss) this.sound.play(20);
  }
}

// ---------------------------------------------------------------- 喜從天降 (t = 8)

/** Fall per tick below y 130 by kind (ref_00475010): chest, bag, ingot, coin, bomb. */
const GIFT_FALL = [24, 18, 15, 12, 15];
/** Points by kind (fcn_0041417e: 10·chest + 5·bag + 3·ingot + coin). */
export const GIFT_POINTS = [10, 5, 3, 1];
/** The thrower's frames (Panel #93) by state·6 + step (ref_00475015). */
const THROWER = [0, 1, 2, 3, 5, 6, 0, 1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 0, 11, 10, 9, 8, 7, 0, 12, 13, 14, 15, 17, 18, 12, 13, 14, 16, 17, 18];
/** The catcher stands on y 380. */
const FLOOR = 0x17c;

export interface Gift { x: number; y: number; w: number; vy: number }

/**
 * Falling gifts (fcn_00414fcd window procedure, fcn_00413248 per tick). The god of wealth (Panel #93) walks
 * along the top throwing one gift every six ticks; a green imp (#94) sometimes pops up and throws a bomb into the
 * other half. The player's character (Panel #100 + character) runs 10 px a tick toward the pointer.
 */
export class Gifts implements MiniGame {
  readonly tickMs = 50;
  phase: Phase = 'intro';
  /** 16 slots (0x48bbc4): x (0 = empty), y, kind | turn << 4 | drift << 8 (int16), vertical speed. */
  readonly items: Gift[] = Array.from({ length: 16 }, () => ({ x: 0, y: 0, w: 0, vy: 0 }));
  /** Caught by kind (0x48bbb4..c0). */
  readonly counts = [0, 0, 0, 0];
  /** 0x48bd2c: 360 ticks of 50 ms. */
  ticks = 360;
  /** The thrower: x (0x48bd4c), state 0 right / 2 turn left / 4 left / 3 turn right (bd44), step (bd46), throw step (bd40). */
  readonly thrower = { x: 0x6e, st: 3, step: 4, at: 0 };
  /** The bomb thrower (bd42 frame, −1 = away; bd4a x); bombs falling (bd54). */
  readonly bomber = { f: -1, x: 0 };
  private bombs = 0;
  /** The catcher: x (bd4e), 1 left / 2 right / 0 never moved yet or stopped by the bomb (bd48), walk frame (bd50), pose (bd56). */
  px = 0x140; dir = 0; private pf = 0; pose = 0;
  /** The bomb's blast Data#526 (fcn_00450ced at (x − 55, 295)), one frame a tick. */
  boom: { x: number; y: number; frame: number } | null = null;
  private end = 0;
  /** Where the pointer is (the original follows the cursor's x). */
  target = 0x140;
  /** 0x48bd8c = 99 until the first paint, then 10 ticks. */
  private wait = 10;
  private resultTicks = 0;
  /** bd52: walking frames each way. */
  readonly walkFrames: number;
  sprites: Sprite[] = [];

  /** `body`: the original boxes of the character's frames (Panel #100 + character), `bodyId` that resource. */
  constructor(private readonly body: Box[], readonly bodyId: number, private readonly rand: Rand = libcRand, private readonly sound: Sound = SILENT) {
    this.walkFrames = Math.max(1, (body.length - 5) >> 1);
    this.update(); // fcn_0041473b draws the first picture through the tick routine
  }

  get score() { return this.counts.reduce((s, n, k) => s + n * GIFT_POINTS[k], 0); }

  hud(): Sprite[] {
    const out: Sprite[] = [], k = this.counts;
    clock(out, this.ticks >> 1);
    digits(out, pad(k[0], 2), [0xb9, 0xcd]);
    digits(out, pad(k[1], 2), [0x114, 0x128]);
    digits(out, pad(k[2], 2), [0x16f, 0x183]);
    digits(out, pad(k[3], 2), [0x1ca, 0x1de]);
    digits(out, pad(this.score, 3), [0x225, 0x239, 0x24d]);
    return out;
  }

  start() { if (this.phase === 'ready') this.phase = 'play'; }

  /** The pointer's x (the remake's control, 13-mini-games.md §4.4). */
  aim(x: number) { this.target = Math.max(0, Math.min(639, Math.round(x))); }

  /** WM_TIMER (415051). */
  tick() {
    switch (this.phase) {
      case 'intro': if (--this.wait <= 0) this.phase = 'ready'; break;
      case 'play':
        if (this.ticks && --this.ticks === 0) this.end = 1;
        this.update();
        if (this.end === 2) {
          // The pose by score (bd56): < 40 #1, < 50 #2, < 60 #0, else #3; hit by the bomb keeps #4.
          if (this.pose !== 4) {
            const s = this.score;
            this.dir = 0;
            this.pose = s < 40 ? 1 : s < 50 ? 2 : s < 60 ? 0 : 3;
          }
          this.update();
          this.phase = 'result';
          this.resultTicks = 40;
          this.boom = null;
          return;
        }
        // The blast runs one frame a tick (fcn_00450f04); when it is over the game ends.
        if (this.boom && ++this.boom.frame >= 8) { this.boom = null; this.end = 2; }
        break;
      case 'result': if (--this.resultTicks <= 0) this.phase = 'done'; break;
    }
  }

  /** fcn_004123d7: a gift (rand() % 20: < 9 coin, < 15 ingot, < 18 bag, else chest) or a bomb thrown from x. */
  private spawn(x: number, bomb: boolean) {
    const it = this.items.find(i => !i.x);
    if (!it) return;
    let kind = 4;
    if (!bomb) { const r = this.rand() % 20; kind = r < 9 ? 3 : r < 15 ? 2 : r < 18 ? 1 : 0; } else this.bombs += 1;
    // It drifts outward as it comes nearer: (x − 320) / 210 · 260 − (x − 320) px by the floor.
    const t = x - 0x140, drift = Math.trunc((t / 210) * 260 - t);
    Object.assign(it, { x, y: 0x64, vy: -16, w: (kind + (drift << 8)) & 0xffff });
  }

  /** fcn_00413248: gifts, the throwers, the catcher. */
  private update() {
    const s: Sprite[] = [];
    let any = false;
    for (const it of this.items) {
      if (!it.x) continue;
      // Perspective: from y 130 to 380 the gift grows from half size and drifts out (f = (y − 130) / 250).
      const f = Math.fround((it.y >= 0x82 ? it.y - 0x82 : 0) / 250);
      const drift = (it.w << 16) >> 24;
      const xd = it.x + Math.trunc(drift * f), kind = it.w & 0xf;
      const scale = Math.trunc(f * 32768 + 32768);
      if (this.dir) {
        const b = this.body[(this.dir - 1) * this.walkFrames + 5 + this.pf] ?? this.body[0];
        const left = this.px - b.ax, top = FLOOR - b.ay;
        if (xd > left && xd < left + b.w && it.y > top && it.y < top + b.h && !this.boom) {
          if (kind === 4) {
            this.sound.stop(24);
            this.sound.play(15);
            this.boom = { x: this.px - 55, y: 0x127, frame: 0 };
            this.dir = 0; this.pose = 4; this.end = 1;
          } else this.counts[kind] += 1;
          it.x = 0;
        }
      }
      if (it.x) {
        s.push({ id: 95 + kind, frame: (it.w >> 4) & 7, x: xd, y: it.y, scale: scale / 65536 });
        it.w = (it.w & 0xff00) | ((it.w + 0x10) & 0x7f);
        if (it.y < 0x82) { it.vy = Math.min(16, it.vy + 2); it.y += it.vy; } else it.y += GIFT_FALL[kind];
        if (it.y > FLOOR) {
          if (kind === 4 && --this.bombs === 0) this.sound.stop(24);
          it.x = 0;
        }
      }
      if (it.x) any = true;
    }
    if (this.bomber.f !== -1) s.push({ id: 94, frame: this.bomber.f, x: this.bomber.x, y: 0x7d });
    const th = this.thrower;
    s.push({ id: 93, frame: THROWER[th.st * 6 + th.step], x: th.x, y: 0x7e });
    // The catcher runs 10 px toward the pointer when it is more than 8 px away; it keeps facing that way after.
    if (this.end !== 2 && !this.boom) {
      const d = this.px - this.target;
      if (Math.abs(d) > 8) {
        if (d > 0) { this.dir = 1; this.px -= 10; } else { this.dir = 2; this.px += 10; }
        if (++this.pf === this.walkFrames) this.pf = 0;
      }
    }
    s.push({ id: this.bodyId, frame: this.dir ? (this.dir - 1) * this.walkFrames + 5 + this.pf : this.pose, x: this.px, y: FLOOR });
    // The bomb thrower comes into the other half 30% of the ticks the god of wealth walks away from it.
    const bm = this.bomber;
    if (bm.f === -1) {
      if ((th.st < 2 && th.x > 0x140) || (th.st > 3 && th.x < 0x140)) {
        if (this.rand() % 10 >= 7 && !this.end) {
          const r = this.rand() % 140;
          bm.f = 0; bm.x = r + (th.x > 0x140 ? 0xa0 : 0x168);
        }
      }
    } else {
      bm.f += 1;
      if (bm.f === 8 && !this.boom) { this.sound.play(22); this.sound.play(24, true); this.spawn(bm.x, true); }
      if (bm.f === 12) bm.f = -1;
    }
    if (this.end === 1) { th.st = 2; th.step = 2; } // facing front
    else switch (th.st) {
      case 0: case 4: { // walking right / left, one throw at step `at` of five; turning at random past the middle or at the end
        const v = th.st === 0 ? 12 : -12;
        if (th.step < 5) {
          if (th.step === th.at) this.spawn(th.x, false);
          th.step += 1; th.x += v;
        } else if ((th.st === 0 ? th.x > 0x140 : th.x < 0x140) && this.rand() % 4 === 0 || th.x === (th.st === 0 ? 0x212 : 0x6e)) {
          th.st = th.st === 0 ? 2 : 3; th.step = 0;
        } else {
          th.at = this.rand() % 5; th.x += v; th.step = 0;
        }
        break;
      }
      case 2: if (++th.step === 5) { th.st = 4; th.step = 0; } break;
      case 3: if (++th.step === 5) { th.st = 0; th.step = 0; } break;
    }
    if (!any && this.end === 1) this.end = 2;
    this.sprites = s;
  }
}
