/**
 * 隨機創建 (the user 2026-11-12): for a player with no idea yet — pick a theme (海島, 城市, 沙漠, 雪地, 鄉村) and the
 * editor makes a whole playable map in the current size, the theme's grounds, roads, buildings and trees, for the
 * player to 微調 after. One undo step takes it back.
 *
 * What it makes, every time (the editor's own 檢查 passes, else it tries again):
 * - a loop of road (one corner stepped in now and then) with a road or two across it — every square two ways on, the
 *   steps all one cell (the map rules: uniform steps, events spread, the bank on a crossing);
 * - the events spread by farthest point, the corners and crossings first; hospital and prison once;
 * - small lots beside the straight road in streets of three or four, a few large plots on two squares of their own;
 * - the theme's ground with its patches (woods, flowers, fields, rock …), a lake now and then, the island in the sea;
 * - the theme's buildings in the open and its trees about, none on the road or a lot (layers.covers).
 */
import { problemList } from './check';
import { covers, framesReady, type Frames } from './layers';
import { G, isWater, PLOT_PRICES, type MakerMap, type MkLot, type MkNode } from './model';

export interface Theme {
  key: string; name: string; desc: string;
  /** the ground everywhere, the land's (an island: land in the sea), patches [ground, how much 0..1] */
  base: number; land: number; patches: [number, number][];
  /** a lake's ground (none: no lake) */
  lake?: number;
  road: number;
  /** the sprite groups (hundreds of the sprite number) for buildings and for trees and props */
  build: number[]; decor: number[];
  streets: string[]; prices: number[];
}

export const THEMES: Theme[] = [
  { key: 'island', name: '海島', desc: '四面環海的小島，椰子樹和海邊的房子', base: G['deep-sea'], land: G.grass, patches: [[G.forest, .22], [G.flowers, .12], [G.beach, .1]],
    road: 0, build: [14, 31], decor: [23, 24], streets: ['海濱路', '椰林街', '燈塔路', '珊瑚街', '漁港路', '貝殼街', '南灣路', '日落大道'], prices: [800, 1000, 1500, 2000] },
  { key: 'city', name: '城市', desc: '高樓、商店和車水馬龍的大街', base: G['stone-brick'], land: G['stone-brick'], patches: [[G.grass, .22], [G.flagstone, .18], [G.forest, .08]],
    road: 1, build: [26, 27, 28, 30, 10, 11], decor: [25, 19, 20], streets: ['中央大道', '商業街', '銀座路', '時代廣場', '金融街', '站前路', '新天地', '環城路'], prices: [1500, 2000, 2500] },
  { key: 'desert', name: '沙漠', desc: '黃沙、紅岩和綠洲，沙漠裡的賭城', base: G.desert, land: G.desert, patches: [[G['red-earth'], .2], [G.rock, .1], [G.gravel, .1]], lake: G.lake,
    road: 4, build: [16, 31], decor: [24, 23], streets: ['綠洲路', '駱駝街', '金沙大道', '仙人掌路', '紅岩街', '黃沙路', '日光大道', '風沙街'], prices: [500, 800, 1000, 1500] },
  { key: 'snow', name: '雪地', desc: '白雪覆蓋的小鎮，結冰的湖', base: G.snow, land: G.snow, patches: [[G.rock, .08], [G.gravel, .06]], lake: G.ice,
    road: 5, build: [29, 12], decor: [21], streets: ['雪松路', '冰湖街', '白樺路', '北極街', '雪原大道', '暖爐街', '馴鹿路', '極光街'], prices: [800, 1000, 1500, 2000] },
  { key: 'country', name: '鄉村', desc: '田野、果園、花叢和小河邊的村子', base: G.grass, land: G.grass, patches: [[G.farmland, .2], [G.forest, .16], [G.flowers, .1], [G.mud, .05]], lake: G.lake,
    road: 3, build: [31, 30], decor: [42, 35, 20], streets: ['稻香路', '果園街', '小河路', '麥田街', '菜園路', '柳樹街', '池塘路', '豐收大道'], prices: [500, 800, 1000, 1500] },
];

const rngOf = (seed: number) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
/** Smooth value noise in 0..1 over cells, `scale` cells a bump. */
function noise(seed: number, scale: number) {
  const h = (x: number, y: number) => { let n = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 982451653); n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
  const s = (t: number) => t * t * (3 - 2 * t);
  return (x: number, y: number) => {
    const fx = x / scale, fy = y / scale, ix = Math.floor(fx), iy = Math.floor(fy), tx = s(fx - ix), ty = s(fy - iy);
    const a = h(ix, iy), b = h(ix + 1, iy), c = h(ix, iy + 1), d = h(ix + 1, iy + 1);
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
  };
}

/** The events a map gets, in order of need (as many as the road has room for, a fifth of its squares). */
const EVENT_ORDER = [14, 5, 4, 15, 2, 3, 13, 9, 16, 1, 6, 10, 2, 3, 13, 7, 11, 8, 12, 9];
const BUSY = new Set<number>([G.forest, G.flowers, G.farmland, G.rock, G.mud, G.gravel]);

export interface RandomOpts { theme: Theme; seed: number; pieces: number[]; frames?: (res: number) => Promise<Frames | null> }

/** Fills `m` (its size kept; its cards, stocks and looks kept) with a random map of the theme. */
export async function randomize(m: MakerMap, o: RandomOpts): Promise<void> {
  const getFrames = o.frames ?? framesReady;
  const build = o.pieces.filter(id => o.theme.build.includes(Math.floor(id / 100)));
  const decor = o.pieces.filter(id => o.theme.decor.includes(Math.floor(id / 100)));
  await Promise.all([...build, ...decor].map(getFrames));
  for (let k = 0; k < 8; k++) {
    layout(m, o.theme, o.seed + k * 7919);
    if (!problemList(m).length) break;
  }
  dress(m, o.theme, o.seed, build, decor);
}

/** The road, the events, the lots and the ground. */
function layout(m: MakerMap, th: Theme, seed: number) {
  const W = m.w, H = m.h, rnd = rngOf(seed), ri = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
  m.nodes = []; m.lots = []; m.streets = []; m.things = []; m.nextId = 1;
  const at = new Map<number, MkNode>(), key = (x: number, y: number) => y * W + x;
  const node = (x: number, y: number) => {
    let n = at.get(key(x, y));
    if (!n) { n = { id: m.nextId++, cx: x, cy: y, links: [], ev: 0, style: th.road }; at.set(key(x, y), n); m.nodes.push(n); }
    return n;
  };
  const link = (a: MkNode, b: MkNode) => { if (!a.links.includes(b.id)) a.links.push(b.id); if (!b.links.includes(a.id)) b.links.push(a.id); };
  const line = (x0: number, y0: number, x1: number, y1: number) => {
    const n = Math.abs(x1 - x0) + Math.abs(y1 - y0), sx = Math.sign(x1 - x0), sy = Math.sign(y1 - y0);
    let prev = node(x0, y0);
    for (let i = 1; i <= n; i++) { const c = node(x0 + sx * i, y0 + sy * i); link(prev, c); prev = c; }
  };

  // the loop: a rectangle, a corner stepped in now and then
  const island = th.base !== th.land && isWater(th.base);
  const mg = Math.max(3, Math.min(island ? 6 : 4, Math.floor(Math.min(W, H) / 7)));
  const x0 = mg + ri(0, 2), x1 = W - 1 - mg - ri(0, 2), y0 = mg + ri(0, 2), y1 = H - 1 - mg - ri(0, 2);
  let vs: [number, number][] = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  if (x1 - x0 >= 14 && y1 - y0 >= 14 && rnd() < .7) {
    const c = ri(0, 3), k1 = ri(3, Math.floor((x1 - x0) / 3)), k2 = ri(3, Math.floor((y1 - y0) / 3));
    const v = vs[c], pv = vs[(c + 3) % 4], nx = vs[(c + 1) % 4];
    const din = [Math.sign(v[0] - pv[0]), Math.sign(v[1] - pv[1])], dout = [Math.sign(nx[0] - v[0]), Math.sign(nx[1] - v[1])];
    const kin = din[0] ? k1 : k2, kout = dout[0] ? k1 : k2;
    const p1: [number, number] = [v[0] - din[0] * kin, v[1] - din[1] * kin];
    vs = [...vs.slice(0, c), p1, [p1[0] + dout[0] * kout, p1[1] + dout[1] * kout], [v[0] + dout[0] * kout, v[1] + dout[1] * kout], ...vs.slice(c + 1)];
  }
  vs.forEach((v, i) => { const w = vs[(i + 1) % vs.length]; line(v[0], v[1], w[0], w[1]); });
  const ring = new Set(m.nodes.map(n => key(n.cx, n.cy)));
  const ringIn = (x: number, y: number) => ring.has(key(x, y));
  // a road across, top to bottom, and maybe one from it to a side
  const across = (vertical: boolean) => {
    for (let k = 0; k < 12; k++) {
      const c = vertical ? ri(x0 + 5, x1 - 5) : ri(y0 + 5, y1 - 5);
      const hits: number[] = [];
      for (let t = 0; t < (vertical ? H : W); t++) if (vertical ? ringIn(c, t) : ringIn(t, c)) hits.push(t);
      if (hits.length !== 2 || hits[1] - hits[0] < 8) continue;
      // no road beside it along the way (lots need the room)
      let clear = true;
      for (let t = hits[0] + 1; t < hits[1] && clear; t++) for (const d of [-2, -1, 0, 1, 2]) if (vertical ? ringIn(c + d, t) : ringIn(t, c + d)) clear = false;
      if (!clear) continue;
      if (vertical) line(c, hits[0], c, hits[1]); else line(hits[0], c, hits[1], c);
      return c;
    }
    return -1;
  };
  if (x1 - x0 >= 12) {
    const xm = across(true);
    if (xm >= 0 && y1 - y0 >= 14 && rnd() < .6) {
      // a road from the one across to the left or right side
      const left = rnd() < .5;
      for (let k = 0; k < 10; k++) {
        const ym = ri(y0 + 5, y1 - 5);
        let xs = -1;
        for (let x = xm + (left ? -1 : 1); x >= 0 && x < W; x += left ? -1 : 1) if (ringIn(x, ym)) { xs = x; break; }
        if (xs < 0 || Math.abs(xs - xm) < 6) continue;
        let clear = true;
        for (let x = Math.min(xs, xm) + 1; x < Math.max(xs, xm) && clear; x++) for (const d of [-2, -1, 1, 2]) if (at.has(key(x, ym + d))) clear = false;
        if (!clear) continue;
        line(xm, ym, xs, ym);
        break;
      }
    }
  }

  // the events: the bank on a crossing, the rest spread (farthest from those placed), corners and crossings first
  const byId = new Map(m.nodes.map(n => [n.id, n]));
  const straight = (n: MkNode) => {
    if (n.links.length !== 2) return false;
    const [a, b] = n.links.map(id => byId.get(id)!);
    return a.cx === b.cx || a.cy === b.cy;
  };
  const placed: MkNode[] = [];
  const count = Math.min(EVENT_ORDER.length, Math.max(12, Math.floor(m.nodes.length / 5)));
  for (const ev of EVENT_ORDER.slice(0, count)) {
    let best: MkNode | null = null, score = -1;
    for (const n of m.nodes) {
      if (n.ev) continue;
      if (ev === 14 && n.links.length < 3 && m.nodes.some(x => x.links.length >= 3)) continue;
      const d = placed.length ? Math.min(...placed.map(p => Math.abs(p.cx - n.cx) + Math.abs(p.cy - n.cy))) : 0;
      const s = d + (straight(n) ? 0 : 4) + rnd() * 2;
      if (s > score) { score = s; best = n; }
    }
    if (!best) break;
    best.ev = ev; placed.push(best);
  }

  // the ground first (an island's land, a lake), so the lots know where the water is
  const cells = m.cells;
  cells.fill(th.base);
  if (island) {
    const nz = noise(seed ^ 0x51, 5);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const dx = Math.max(x0 - x, 0, x - x1), dy = Math.max(y0 - y, 0, y - y1);
      if (Math.hypot(dx, dy) < 3.2 + nz(x, y) * 3) cells[key(x, y)] = th.land;
    }
  } else cells.fill(th.land);
  const lots: { x: number; y: number }[] = [];
  const free = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && !at.has(key(x, y)) && !isWater(cells[key(x, y)]) && !lots.some(c => c.x === x && c.y === y);

  // the lots: a few large plots on two squares of their own, then small lots beside the straight road
  const own = new Set<number>();
  const dirOf = (n: MkNode) => { const o = byId.get(n.links[0])!; return o.cx === n.cx ? { ax: 0, ay: 1 } : { ax: 1, ay: 0 }; };
  const plain = m.nodes.filter(n => !n.ev && straight(n));
  let big = 0;
  const bigs = Math.max(1, Math.floor(plain.length / 22));
  for (const a of [...plain].sort(() => rnd() - .5)) {
    if (big >= bigs) break;
    const { ax, ay } = dirOf(a), b = at.get(key(a.cx + ax, a.cy + ay));
    if (!b || b.ev || !straight(b) || own.has(a.id) || own.has(b.id)) continue;
    for (const side of rnd() < .5 ? [1, -1] : [-1, 1]) {
      // the 2 × 2 beside the two squares
      const px = ay * side, py = ax * side;
      const c0 = { x: a.cx + px, y: a.cy + py }, cs = [c0, { x: c0.x + ax, y: c0.y + ay }, { x: c0.x + px, y: c0.y + py }, { x: c0.x + ax + px, y: c0.y + ay + py }];
      if (!cs.every(c => free(c.x, c.y))) continue;
      // nothing of the road right beyond it either (the plot would touch another road's lots)
      if (cs.some(c => at.has(key(c.x + px, c.y + py)))) continue;
      const tl = { x: Math.min(...cs.map(c => c.x)), y: Math.min(...cs.map(c => c.y)) };
      m.lots.push({ id: m.nextId++, kind: 1, cx: tl.x, cy: tl.y, nodes: [a.id, b.id], price: PLOT_PRICES[Math.floor(rnd() * PLOT_PRICES.length)], name: `大型用地${++big}` });
      lots.push(...cs); own.add(a.id); own.add(b.id);
      break;
    }
  }
  const small: MkLot[] = [];
  let lastSide = 1;
  for (const n of plain) {
    if (own.has(n.id)) continue;
    const { ax, ay } = dirOf(n);
    for (const side of [lastSide, -lastSide]) {
      const x = n.cx + ay * side, y = n.cy + ax * side;
      if (!free(x, y)) continue;
      const l: MkLot = { id: m.nextId++, kind: 0, cx: x, cy: y, nodes: [n.id], price: 1000, name: '' };
      m.lots.push(l); small.push(l); lots.push({ x, y }); own.add(n.id); lastSide = side;
      break;
    }
  }
  // streets: small lots side by side, three or four a street
  const seen = new Set<MkLot>();
  let sn = 0;
  for (const l of small) {
    if (seen.has(l)) continue;
    const group = [l]; seen.add(l);
    for (let i = 0; i < group.length; i++) {
      const g = group[i], gn = byId.get(g.nodes[0])!;
      for (const o of small) if (!seen.has(o) && Math.max(Math.abs(o.cx - g.cx), Math.abs(o.cy - g.cy)) === 1 && gn.links.includes(o.nodes[0])) { group.push(o); seen.add(o); }
    }
    for (let i = 0; i < group.length; i += 4) {
      const part = group.length - i === 5 ? group.slice(i, i + 3) : group.slice(i, i + 4);
      if (group.length - i === 5) { i -= 1; }
      const st = { id: m.nextId++, name: sn < th.streets.length ? th.streets[sn] : `${th.streets[sn % th.streets.length]}${Math.floor(sn / th.streets.length) + 1}`, price: th.prices[Math.floor(rnd() * th.prices.length)] };
      sn++;
      m.streets.push(st);
      for (const p of part) { p.street = st.id; p.price = st.price; }
    }
  }
  small.forEach((l, i) => { l.name = `地段${i + 1}`; });

  // the theme's patches and a lake, kept off the road and the lots
  const near = new Set<number>();
  for (const n of m.nodes) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) near.add(key(n.cx + dx, n.cy + dy));
  for (const c of lots) near.add(key(c.x, c.y));
  th.patches.forEach(([g, much], i) => {
    const nz = noise(seed ^ (0x9e37 * (i + 3)), 4 + i);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const k = key(x, y);
      if (!near.has(k) && cells[k] === th.land && nz(x, y) > 1 - much) cells[k] = g;
    }
  });
  if (th.lake !== undefined && rnd() < .8) {
    // the open spot furthest from the road and the lots, a blob round it
    let bx = -1, by = -1, bd = 0;
    for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) {
      if (near.has(key(x, y))) continue;
      let d = 99;
      for (const n of m.nodes) d = Math.min(d, Math.max(Math.abs(n.cx - x), Math.abs(n.cy - y)));
      for (const c of lots) d = Math.min(d, Math.max(Math.abs(c.x - x), Math.abs(c.y - y)));
      if (d > bd) { bd = d; bx = x; by = y; }
    }
    if (bd >= 3) {
      const nz = noise(seed ^ 0x77, 3), r = Math.min(bd - 1.5, 5);
      for (let y = by - 6; y <= by + 6; y++) for (let x = bx - 6; x <= bx + 6; x++) {
        if (x < 0 || y < 0 || x >= W || y >= H || near.has(key(x, y))) continue;
        if (Math.hypot(x - bx, y - by) < r * (.75 + nz(x, y) * .5)) cells[key(x, y)] = th.lake;
      }
    }
  }
  for (const k of near) if (k >= 0 && k < cells.length && (BUSY.has(cells[k]) || (isWater(cells[k]) && !island))) cells[k] = th.land;
}

/** The theme's buildings in the open and its trees about. */
function dress(m: MakerMap, th: Theme, seed: number, build: number[], decor: number[]) {
  const rnd = rngOf(seed ^ 0xb00b), W = m.w, H = m.h;
  m.things = [];
  const land = (x: number, y: number) => { const cx = Math.floor(x / 48), cy = Math.floor(y / 48); return cx >= 0 && cy >= 0 && cx < W && cy < H && !isWater(m.cells[cy * W + cx]); };
  const put = (pool: number[], n: number, gap: number, s: () => number) => {
    for (let k = 0, got = 0; k < n * 40 && got < n && pool.length; k++) {
      const t = { res: pool[Math.floor(rnd() * pool.length)], x: Math.round((1 + rnd() * (W - 2)) * 48), y: Math.round((1 + rnd() * (H - 2)) * 48), s: s(), face: 0 };
      if (!land(t.x, t.y) || m.things.some(o => Math.hypot(o.x - t.x, o.y - t.y) < gap) || covers(m, t)) continue;
      m.things.push(t); got++;
    }
  };
  put(build, Math.max(4, Math.round((W * H) / 130)), 90, () => 1);
  put(decor, Math.max(10, Math.round((W * H) / 45)), 34, () => Math.round((.8 + rnd() * .35) * 10) / 10);
  void th;
}
