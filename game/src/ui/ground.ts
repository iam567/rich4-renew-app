/**
 * Redrawn map grounds (tools/ground-redraw/ground.py): the 2304×2304 ground of a map in another style, stored
 * as tiles (576 original px each, at `scale` times the resolution) plus a 1× preview. The board draws the
 * preview under everything and, when the view is close enough to need more, only the tiles it shows, loaded on
 * demand and dropped when far away, so a phone never holds the whole high-resolution picture.
 */
import { ASSETS } from './assets';
import { decodeImage, releasePic, type Pic } from './decode';

/** Style ids in the order of the settings; '' is the original ground. */
export const GROUND_STYLES: { id: string; name: string }[] = [
  { id: '', name: '原版' },
  { id: 'ghibli', name: '吉卜力手繪' },
  { id: 'monopoly', name: '休閒桌遊' },
  { id: 'genshin', name: '原神風3D' },
];
const KEY = 'rich4.groundStyle';
/** The redrawn grounds replace the original: a player who never chose gets this style; 原版 stays selectable. */
export const DEFAULT_GROUND_STYLE = 'ghibli';

/** The chosen style ('' the original); an explicit choice, 原版 included, is remembered over the default. */
export function groundStyle(): string {
  try {
    const v = localStorage.getItem(KEY) ?? DEFAULT_GROUND_STYLE;
    return GROUND_STYLES.some(s => s.id === v) ? v : DEFAULT_GROUND_STYLE;
  } catch { return DEFAULT_GROUND_STYLE; }
}
export function setGroundStyle(id: string) {
  try { localStorage.setItem(KEY, id); } catch { /* not kept */ }
}
export const groundStyleName = (id: string) => GROUND_STYLES.find(s => s.id === id)?.name ?? '原版';

interface Index { maps: Record<string, string[]> }
let index: Promise<Index> | null = null;
/** Which maps have which styles (ground/index.json); empty when no redrawn grounds are installed. */
export function groundIndex(): Promise<Index> {
  index ??= fetch(`${ASSETS}/ground/index.json`).then(r => (r.ok ? r.json() as Promise<Index> : { maps: {} }), () => ({ maps: {} }));
  return index;
}
/** Styles redrawn for a map (without the original). */
export async function groundStylesFor(mapId: number): Promise<string[]> {
  return (await groundIndex()).maps[String(mapId)] ?? [];
}

interface Manifest { size: number; scale: number; tile: number; cols: number; rows: number; tiles: string[][]; preview: string }

/** Decoded tiles may use this much memory together (the 2304 preview comes on top). */
const BUDGET = 100 * 1024 * 1024;
/** Tiles kept beyond the ones on screen, so panning back and forth does not decode them again. */
const SPARE = 2;
/** Below this many device pixels per original pixel the 1× preview is sharp enough. */
const TILE_FROM = 1.15;
/** At most this many tiles decoding at once. */
const PARALLEL = 2;
/** Frames a prefetched tile is kept for although not on screen yet (the camera is on its way). */
const SOON_FRAMES = 120;

/** Whether a convex quad overlaps the square [x, x+s]×[y, y+s] (separating axes: the square's two, the quad's four). */
function overlaps(quad: { x: number; y: number }[], x: number, y: number, s: number): boolean {
  const sq = [{ x, y }, { x: x + s, y }, { x: x + s, y: y + s }, { x, y: y + s }];
  const axes = [{ x: 1, y: 0 }, { x: 0, y: 1 }];
  for (let i = 0; i < quad.length; i++) {
    const a = quad[i], b = quad[(i + 1) % quad.length];
    axes.push({ x: a.y - b.y, y: b.x - a.x });
  }
  for (const n of axes) {
    const pa = quad.map(p => p.x * n.x + p.y * n.y), pb = sq.map(p => p.x * n.x + p.y * n.y);
    if (Math.max(...pa) < Math.min(...pb) || Math.max(...pb) < Math.min(...pa)) return false;
  }
  return true;
}

interface Tile { pic: Pic; used: number; /** Pixels per original pixel it holds. */ px: number }

export class TiledGround {
  /** The whole ground at 1× (also the minimap's picture); null until loaded. */
  preview: Pic | null = null;
  private tiles = new Map<string, Tile>();
  private loading = new Set<string>();
  private failed = new Set<string>();
  private frame = 0;
  /** Tiles the last frame wanted (0 when the preview was enough). */
  private wanted = 0;
  /** Pixels per original pixel tiles are decoded at: what the view shows, at most what the files hold. */
  private px = 0;
  /** Tiles wanted soon (a camera glide's end), kept until the given frame. */
  private soon = new Map<string, number>();
  /** Tiles to decode, most wanted first (rebuilt every frame). */
  private queue: string[] = [];
  /** Changes whenever what `paint` draws changes (a tile or the preview arrived). */
  version = 0;
  /** What changed at each recent version: a tile's world square, or null for everything (the preview). */
  private changes: { v: number; sq: { x: number; y: number; s: number } | null }[] = [];
  private disposed = false;
  /** Called when a picture arrives, so a still view can redraw. */
  onLoad: (() => void) | null = null;

  private constructor(readonly style: string, private base: string, private m: Manifest) {}

  static async load(mapId: number, style: string): Promise<TiledGround | null> {
    if (!style || !(await groundStylesFor(mapId)).includes(style)) return null;
    const base = `${ASSETS}/ground/${mapId}/${style}`;
    try {
      const r = await fetch(`${base}/manifest.json`);
      if (!r.ok) return null;
      const g = new TiledGround(style, base, await r.json() as Manifest);
      g.preview = await decodeImage(`${base}/${g.m.preview}`, undefined, 'ground');
      g.changed(null);
      return g;
    } catch { return null; }
  }

  private changed(sq: { x: number; y: number; s: number } | null) {
    this.version++;
    this.changes.push({ v: this.version, sq });
    if (this.changes.length > 32) this.changes.shift();
  }

  /** The world squares drawn differently since `version` (null: everything, or too long ago to tell). */
  changedSince(version: number): { x: number; y: number; s: number }[] | null {
    if (version >= this.version) return [];
    if (!this.changes.length || this.changes[0].v > version + 1) return null;
    const out: { x: number; y: number; s: number }[] = [];
    for (const ch of this.changes) {
      if (ch.v <= version) continue;
      if (!ch.sq) return null;
      out.push(ch.sq);
    }
    return out;
  }

  /** How many tiles fit the memory budget at the current density. */
  private get maxTiles() {
    const side = Math.round(this.m.tile * (this.px || this.m.scale));
    return Math.max(4, Math.min(this.m.cols * this.m.rows, Math.floor(BUDGET / (side * side * 4))));
  }

  /** Decoded tiles and tiles on their way (for checks). */
  stats() { return { wanted: this.wanted, decoded: this.tiles.size, loading: this.loading.size, max: this.maxTiles, px: this.px }; }

  /** The tiles under a world quad, nearest to its centre first. */
  private under(quad: { x: number; y: number }[]): { key: string; c: number; r: number }[] {
    const m = this.m, t = m.tile;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, cx = 0, cy = 0;
    for (const p of quad) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); cx += p.x / quad.length; cy += p.y / quad.length; }
    const out: { key: string; c: number; r: number; d: number }[] = [];
    for (let r = Math.max(0, Math.floor(y0 / t)); r <= Math.min(m.rows - 1, Math.floor(y1 / t)); r++) {
      for (let c = Math.max(0, Math.floor(x0 / t)); c <= Math.min(m.cols - 1, Math.floor(x1 / t)); c++) {
        if (overlaps(quad, c * t, r * t, t)) out.push({ key: `${c}-${r}`, c, r, d: Math.hypot((c + 0.5) * t - cx, (r + 0.5) * t - cy) });
      }
    }
    return out.sort((a, b) => a.d - b.d);
  }

  /**
   * Starts decoding the tiles a view at `quad` will need (the camera is about to glide there), so they are
   * ready when it arrives instead of popping in from the blurry preview on the way.
   */
  prefetch(quad: { x: number; y: number }[]) {
    if (!this.px || this.disposed) return;
    for (const w of this.under(quad)) {
      this.soon.set(w.key, this.frame + SOON_FRAMES);
      if (!this.tiles.has(w.key) && !this.queue.includes(w.key)) this.queue.push(w.key);
    }
    this.pump();
  }

  /**
   * Per-frame upkeep: which tiles the area around the view needs (`quad`, the world area the board keeps drawn,
   * corners in order round it), nearest to its centre first, within the memory budget; starts their decoding and
   * drops far ones. `density` is the device pixels per original pixel.
   */
  update(quad: { x: number; y: number }[], density: number) {
    const m = this.m;
    this.frame++;
    for (const [k, until] of this.soon) if (until < this.frame) this.soon.delete(k);
    if (density < TILE_FROM) { this.wanted = 0; this.queue = []; this.trim(new Set(this.soon.keys()), SPARE); return; }
    // Decoded no sharper than the view shows (a quarter pixel up), never sharper than the files.
    this.px = Math.min(m.scale, Math.ceil(density * 4 - 1e-6) / 4);
    const want = this.under(quad), max = this.maxTiles;
    this.wanted = want.length;
    // Nearest first; beyond the budget the preview stands in.
    const keep = new Set(want.slice(0, max).map(w => w.key));
    for (const k of this.soon.keys()) if (keep.size < max) keep.add(k);
    this.trim(keep, Math.min(max, keep.size + SPARE));
    const queue: string[] = [];
    for (const w of want) {
      const have = this.tiles.get(w.key);
      if (have) have.used = this.frame;
      // A tile decoded for a less sharp view is drawn until the sharper one has arrived.
      if ((!have || have.px < this.px - 1e-6) && keep.has(w.key)) queue.push(w.key);
    }
    for (const k of keep) if (!this.tiles.has(k) && !queue.includes(k)) queue.push(k);
    this.queue = queue;
    this.pump();
  }

  /**
   * Draws the ground of a world quad under the current world transform: the preview (`fallback` until it has
   * arrived), then the decoded tiles over it. Only tiles at least `TILE_FROM` dense are drawn (see `update`).
   */
  paint(ctx: CanvasRenderingContext2D, quad: { x: number; y: number }[], fallback: CanvasImageSource) {
    const m = this.m, t = m.tile;
    ctx.drawImage(this.preview ?? fallback, 0, 0, m.size, m.size);
    if (!this.wanted) return;
    for (const w of this.under(quad)) {
      const have = this.tiles.get(w.key);
      if (have) ctx.drawImage(have.pic, w.c * t, w.r * t, t, t);
    }
  }

  /** Drops decoded tiles that are not wanted now, oldest first, until at most `limit` stay. */
  private trim(keep: Set<string>, limit: number) {
    if (this.tiles.size + this.loading.size <= limit) return;
    const spare = [...this.tiles].filter(([k]) => !keep.has(k)).sort((a, b) => a[1].used - b[1].used);
    while (this.tiles.size + this.loading.size > limit && spare.length) {
      const [k, v] = spare.shift()!;
      releasePic(v.pic); this.tiles.delete(k);
    }
  }

  /** Starts the next decodes in the queue, within the parallel and memory limits. */
  private pump() {
    for (const key of this.queue) {
      if (this.loading.size >= PARALLEL) return;
      if (this.loading.has(key) || this.failed.has(key)) continue;
      const have = this.tiles.get(key);
      if (have && have.px >= this.px - 1e-6) continue;
      if (!have && this.tiles.size + this.loading.size >= this.maxTiles) return;
      this.request(key);
    }
  }

  private request(key: string) {
    const [c, r] = key.split('-').map(Number), px = this.px, side = Math.round(this.m.tile * px);
    this.loading.add(key);
    decodeImage(`${this.base}/${this.m.tiles[r][c]}`, px < this.m.scale ? { w: side, h: side } : undefined, 'ground').then(pic => {
      this.loading.delete(key);
      if (this.disposed) { releasePic(pic); return; }
      const old = this.tiles.get(key);
      if (old) releasePic(old.pic);
      this.tiles.set(key, { pic, used: this.frame, px });
      this.changed({ x: c * this.m.tile, y: r * this.m.tile, s: this.m.tile });
      this.onLoad?.();
      this.pump();
    }, () => { this.loading.delete(key); this.failed.add(key); this.pump(); });
  }

  dispose() {
    this.disposed = true;
    for (const v of this.tiles.values()) releasePic(v.pic);
    this.tiles.clear();
    this.queue = [];
    if (this.preview) releasePic(this.preview);
    this.preview = null;
  }
}
