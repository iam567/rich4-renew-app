/**
 * The board's ground, kept drawn. Drawing the ground (a full-screen picture resampled at high quality under the
 * view's rotation, and the redrawn tiles over it) is most of a frame where the canvas is drawn by the CPU, as in
 * WebKit; but between turns, rotations and zooms only the camera moves, which shifts the ground on screen.
 *
 * So the ground is drawn once into square chunks of device pixels, laid on a grid that moves with the ground,
 * and each frame copies the chunks the canvas shows, at whole-pixel offsets (no resampling). Chunks coming into
 * view are drawn as they are needed, the ring round the view a few at a time in quiet frames, and a chunk is
 * redrawn when a tile under it arrives. A frame's cost no longer depends on the ground, and a camera glide only
 * draws the strips it uncovers.
 */

export interface Pt { x: number; y: number }
/** World → device pixels: x' = a x + c y + e, y' = b x + d y + f. */
export interface Affine { a: number; b: number; c: number; d: number; e: number; f: number }
/** Draws the ground of a world area under the context's current (world) transform. */
export type PaintGround = (ctx: CanvasRenderingContext2D, area: Pt[]) => void;

/** Chunk side in device pixels. */
const SIZE = 256;
/** Chunks drawn ahead in a quiet frame, and redrawn for an arrived tile per frame. */
const AHEAD = 1, REFRESH = 8;

interface Chunk { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; used: number; dirty: boolean }

export class GroundCache {
  private chunks = new Map<string, Chunk>();
  private spare: Chunk[] = [];
  private key = '';
  /** The grid's origin: the ground's device translation when the grid was laid. */
  private e0 = 0;
  private f0 = 0;
  private m: Affine = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  private frame = 0;
  private edge = '#000';

  /**
   * Draws the ground onto `ctx` (device pixels, identity transform) for the world → device transform `m` on a
   * `W`×`H` canvas. `key` names everything but the translation (rotation, zoom, which ground); when it changes
   * every chunk is dropped. `changed` lists the world squares redrawn since the last call (null: everything).
   */
  draw(ctx: CanvasRenderingContext2D, m: Affine, W: number, H: number, key: string, edge: string, paint: PaintGround, changed: { x: number; y: number; s: number }[] | null) {
    this.frame++;
    // A new view (or a new picture under all of it) starts over: every visible chunk is drawn this frame.
    if (key !== this.key || edge !== this.edge || changed === null) {
      if (key !== this.key || edge !== this.edge) { this.e0 = m.e; this.f0 = m.f; }
      this.key = key; this.edge = edge;
      for (const c of this.chunks.values()) this.spare.push(c);
      this.chunks.clear();
    }
    this.m = m;
    for (const sq of changed ?? []) this.dirtyWorld(sq.x, sq.y, sq.s);
    // Grid cell (i, j) covers [i·SIZE, (i+1)·SIZE) of grid space; grid space + (ox, oy) is the canvas.
    const ox = Math.round(m.e - this.e0), oy = Math.round(m.f - this.f0);
    const i0 = Math.floor(-ox / SIZE), i1 = Math.floor((W - 1 - ox) / SIZE);
    const j0 = Math.floor(-oy / SIZE), j1 = Math.floor((H - 1 - oy) / SIZE);
    let refresh = REFRESH, drawn = 0;
    ctx.imageSmoothingEnabled = false;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        let c = this.chunks.get(`${i},${j}`);
        // What the canvas shows must be there; a stale chunk is shown until its turn to be redrawn.
        if (!c) { c = this.render(i, j, paint); drawn++; }
        else if (c.dirty && refresh > 0) { this.paintChunk(c, i, j, paint); refresh--; drawn++; }
        c.used = this.frame;
        ctx.drawImage(c.canvas, i * SIZE + ox, j * SIZE + oy);
      }
    }
    // Quiet frame: the ring round the view, nearest the centre first, so a pan finds it drawn.
    if (!drawn) {
      let ahead = AHEAD;
      const ci = (i0 + i1) / 2, cj = (j0 + j1) / 2, ring: [number, number, number][] = [];
      for (let j = j0 - 1; j <= j1 + 1; j++) {
        for (let i = i0 - 1; i <= i1 + 1; i++) {
          const c = this.chunks.get(`${i},${j}`);
          if (i >= i0 && i <= i1 && j >= j0 && j <= j1) continue;
          if (!c || c.dirty) ring.push([i, j, Math.hypot(i - ci, j - cj)]);
          else c.used = this.frame;
        }
      }
      ring.sort((p, q) => p[2] - q[2]);
      for (const [i, j] of ring) {
        if (ahead-- <= 0) break;
        const c = this.chunks.get(`${i},${j}`);
        if (c) this.paintChunk(c, i, j, paint); else this.render(i, j, paint).used = this.frame;
      }
    }
    // Keep about two views' worth: the visible chunks and the ring, the oldest go first.
    const limit = 2 * (i1 - i0 + 3) * (j1 - j0 + 3);
    if (this.chunks.size > limit) {
      const old = [...this.chunks].filter(([, c]) => c.used < this.frame).sort((p, q) => p[1].used - q[1].used);
      for (const [k, c] of old) {
        if (this.chunks.size <= limit) break;
        this.chunks.delete(k); this.spare.push(c);
      }
    }
    this.spare.length = Math.min(this.spare.length, 8);
  }

  /** The world area the view and the ring of chunks round it cover (what the ground's tiles are wanted for). */
  area(W: number, H: number, unproject: (x: number, y: number) => Pt): Pt[] {
    const r = SIZE;
    return [unproject(-r, -r), unproject(W + r, -r), unproject(W + r, H + r), unproject(-r, H + r)];
  }

  /** Releases the chunks' pixels. */
  dispose() {
    for (const c of [...this.chunks.values(), ...this.spare]) c.canvas.width = c.canvas.height = 0;
    this.chunks.clear(); this.spare = []; this.key = '';
  }

  private render(i: number, j: number, paint: PaintGround): Chunk {
    let c = this.spare.pop();
    if (!c) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = SIZE;
      c = { canvas, ctx: canvas.getContext('2d', { alpha: false })!, used: this.frame, dirty: false };
    }
    this.paintChunk(c, i, j, paint);
    this.chunks.set(`${i},${j}`, c);
    return c;
  }

  private paintChunk(c: Chunk, i: number, j: number, paint: PaintGround) {
    const x = c.ctx, { a, b, c: cc, d } = this.m;
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.fillStyle = this.edge;
    x.fillRect(0, 0, SIZE, SIZE);
    x.setTransform(a, b, cc, d, this.e0 - i * SIZE, this.f0 - j * SIZE);
    x.imageSmoothingEnabled = true;
    x.imageSmoothingQuality = 'high';
    // The chunk's world area (its corners mapped back).
    const det = a * d - b * cc, back = (u: number, v: number) => {
      const p = u - (this.e0 - i * SIZE), q = v - (this.f0 - j * SIZE);
      return { x: (d * p - cc * q) / det, y: (-b * p + a * q) / det };
    };
    paint(x, [back(0, 0), back(SIZE, 0), back(SIZE, SIZE), back(0, SIZE)]);
    c.dirty = false;
  }

  /** Marks the chunks over a world square for redrawing. */
  private dirtyWorld(x: number, y: number, s: number) {
    const { a, b, c, d } = this.m;
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const [px, py] of [[x, y], [x + s, y], [x + s, y + s], [x, y + s]]) {
      const u = a * px + c * py + this.e0, v = b * px + d * py + this.f0;
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
    }
    for (const [k, ch] of this.chunks) {
      const [i, j] = k.split(',').map(Number);
      if ((i + 1) * SIZE >= u0 - 2 && i * SIZE <= u1 + 2 && (j + 1) * SIZE >= v0 - 2 && j * SIZE <= v1 + 2) ch.dirty = true;
    }
  }
}
