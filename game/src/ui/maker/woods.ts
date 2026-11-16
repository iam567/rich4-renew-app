/**
 * 樹林 planted tree by tree (the user 2026-11-12: 「一棵樹一棵樹最清晰的那種」, sizes and greens varied, and 「都保留…可以讓人
 * 來調這個隨機值」). Every wood cell has four places for a tree (a 2 × 2 grid, each jittered); whether a place holds one,
 * how big and how green, all come from the map's seed and that place alone — so painting a wood here never moves the
 * trees over there. Trees deep in a wood grow bigger, those on its edge smaller, and a few strays stand just outside.
 * The trees are drawn once into a picture of the whole map (again when the wood or a setting changes), each with its
 * shadow by the map's light; the editor and the game's ground picture draw that picture under the roads.
 * MkWood.mode 1 keeps the old look: the forest texture alone (ground-gl.ts).
 */
import { ASSETS } from '../assets';
import { CELL, DEFAULT_LIGHT, DEFAULT_WOOD, G, type MakerMap, type MkWood } from './model';

const TREE_FILES = ['01', '02', '04', '05', '06', '07', '08', '10', '11', '12', '13', '14'];
/** The grounds a stray tree may stand on (not water, sand, rock or paving). */
const STRAY_ON = new Set<number>([G.grass, G.flowers, G.mud, G.snow, G.farmland, G['red-earth']]);

export interface Tree { x: number; y: number; d: number; k: number; tint: number; flip: boolean; turn: number }

const hash = (a: number, b: number, c: number) => {
  let n = (a * 374761393 + b * 668265263 + c * 2246822519) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
};

/** Where the trees stand, in world px (sorted top to bottom, the order they are drawn). */
export function plantTrees(m: MakerMap): Tree[] {
  const W: MkWood = { ...DEFAULT_WOOD, ...m.wood };
  if (W.mode === 1) return [];
  const forest = (x: number, y: number) => x >= 0 && y >= 0 && x < m.w && y < m.h && m.cells[y * m.w + x] === G.forest;
  // the cells a stray must leave free: squares and lots
  const busy = new Set<number>();
  for (const n of m.nodes) busy.add(Math.round(n.cy) * m.w + Math.round(n.cx));
  for (const l of m.lots) for (let j = 0; j <= l.kind; j++) for (let i = 0; i <= l.kind; i++) busy.add((l.cy + j) * m.w + l.cx + i);
  const out: Tree[] = [];
  const s = W.seed * 7919;
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
    const inWood = forest(x, y);
    let near = 0;
    for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) if (forest(x + i, y + j)) near++;
    if (!inWood && (!near || !STRAY_ON.has(m.cells[y * m.w + x]) || busy.has(y * m.w + x))) continue;
    const deep = Math.max(0, Math.min(1, (near - 12) / 12));                     // 0 on the edge .. 1 well inside
    for (let k = 0; k < 4; k++) {
      const h = (n: number) => hash(x + n * 101, y, s + k * 13 + n);
      if (inWood) { if (h(1) > .3 + .7 * W.density) continue; }
      else if (h(1) > W.strays * .1 * (near / 25 + .2)) continue;              // strays, thinner farther out
      // sizes spread: a few big ones (more inside), mostly middling, small ones (more on the edge)
      const u = h(2), big = .18 + .2 * deep;
      let r = u < big ? 1.15 + .35 * h(3) : u < .7 ? .8 + .3 * h(3) : .5 + .25 * h(3);
      r = 1 + (r - 1) * W.spread * 1.6;
      if (!inWood) r = .45 + .25 * h(3);
      r *= .8 + .25 * deep;
      out.push({
        x: (x + .25 + (k % 2) * .5 + (h(4) - .5) * .4) * CELL, y: (y + .25 + (k >> 1) * .5 + (h(5) - .5) * .4) * CELL,
        d: Math.max(10, 34 * W.size * r), k: Math.floor(h(6) * TREE_FILES.length), tint: Math.floor(h(7) * TINTS), flip: h(8) < .5, turn: Math.floor(h(9) * 4),
      });
    }
  }
  return out.sort((a, b) => a.y - b.y);
}

const TINTS = 6;
let sprites: HTMLImageElement[] | null = null, loading: Promise<HTMLImageElement[]> | null = null;
function loadSprites(): Promise<HTMLImageElement[]> {
  loading ??= Promise.all(TREE_FILES.map(f => new Promise<HTMLImageElement>((ok, fail) => {
    const img = new Image();
    img.onload = () => ok(img); img.onerror = () => fail(new Error(`tree-${f}`));
    img.src = `${ASSETS}/maps/remake/maker/tree-${f}.webp`;
  }))).then(s => (sprites = s));
  return loading;
}

/** Each tree sprite in TINTS greens — darker, yellower, fresher — as far apart as the 顏色差異 slider says. */
function tinted(colour: number): HTMLCanvasElement[][] {
  return sprites!.map(img => Array.from({ length: TINTS }, (_, t) => {
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const x = c.getContext('2d')!;
    x.drawImage(img, 0, 0);
    if (t === 0 || colour <= 0) return c;
    const d = x.getImageData(0, 0, c.width, c.height), p = d.data;
    const bright = 1 + ([0, -.2, .08, -.1, .02, -.14][t]) * colour, warm = ([0, .02, -.04, .1, .06, -.06][t]) * colour;
    for (let i = 0; i < p.length; i += 4) {
      p[i] = Math.min(255, p[i] * bright * (1 + warm)); p[i + 1] = Math.min(255, p[i + 1] * bright); p[i + 2] = Math.min(255, p[i + 2] * bright * (1 - Math.abs(warm)));
    }
    x.putImageData(d, 0, 0);
    return c;
  }));
}

/** Draws the trees into `c` at `q` canvas px per world px (the whole map from its top-left). */
export function paintTrees(c: CanvasRenderingContext2D, m: MakerMap, trees: Tree[], q: number) {
  if (!sprites || !trees.length) return;
  const W: MkWood = { ...DEFAULT_WOOD, ...m.wood }, L = { ...DEFAULT_LIGHT, ...m.light }, a = (L.angle * Math.PI) / 180;
  const set = tinted(W.colour);
  c.save();
  c.shadowColor = `rgba(8, 36, 8, ${Math.min(.85, .25 + L.strength * 1.1)})`;
  for (const t of trees) {
    const img = set[t.k][t.tint], s = (t.d / Math.max(img.width, img.height)) * q, w = img.width * s, h = img.height * s;
    const len = (L.length * .5 + 2 + t.d * .08) * q;
    c.shadowOffsetX = Math.cos(a) * len; c.shadowOffsetY = Math.sin(a) * len; c.shadowBlur = (1 + L.soft * 5) * q;
    c.setTransform(1, 0, 0, 1, t.x * q, t.y * q);
    c.rotate((t.turn * Math.PI) / 2);
    if (t.flip) c.scale(-1, 1);
    c.drawImage(img, -w / 2, -h / 2, w, h);
  }
  c.restore();
}

/** The editor's trees: one picture of the whole map, redrawn a moment after the wood or a setting changes. */
export class Woods {
  private pic: HTMLCanvasElement | null = null;
  private q = 1;
  private timer = 0;
  private key = '';
  constructor(private m: MakerMap, private onReady: () => void) { loadSprites().then(() => this.changed(true)).catch(() => {}); }

  /** Something changed that may move trees (cells, squares, lots, the settings); `now`: no waiting. */
  changed(now = false) {
    clearTimeout(this.timer);
    if (now) this.build(); else this.timer = window.setTimeout(() => this.build(), 140);
  }

  private build() {
    if (!sprites) return;
    const m = this.m, key = JSON.stringify([m.wood, m.light, m.w, m.h]) + m.cells.join('') + m.nodes.length + m.lots.length;
    if (key === this.key) return;
    this.key = key;
    const trees = plantTrees(m);
    if (!trees.length) { this.pic = null; this.onReady(); return; }
    // up to 3000 px a side (a phone's canvas limit), full size on small maps
    this.q = Math.min(1, 3000 / (Math.max(m.w, m.h) * CELL));
    const c = this.pic ?? document.createElement('canvas');
    c.width = Math.round(m.w * CELL * this.q); c.height = Math.round(m.h * CELL * this.q);
    paintTrees(c.getContext('2d')!, m, trees, this.q);
    this.pic = c;
    this.onReady();
  }

  /** Draws the trees into `c`, whose transform is in world px. */
  draw(c: CanvasRenderingContext2D) {
    if (this.pic) c.drawImage(this.pic, 0, 0, this.m.w * CELL, this.m.h * CELL);
  }
}

/** For the game's ground picture: the trees at full size, once the sprites are in. */
export async function drawWoodsFull(c: CanvasRenderingContext2D, m: MakerMap) {
  await loadSprites().catch(() => null);
  paintTrees(c, m, plantTrees(m), 1);
}
