/**
 * 圈地 (the user 2026-11-11: 「用畫筆描出邊緣來…在這個框裡面填充」): the finger draws a loop, the ground inside it changes.
 * The loop's edge comes out in one of four ways — 圓滑 (smoothed), 有稜有角 (straight cuts between corners),
 * 方正 (square blocks) and 隨機起伏 (a wandering edge). Points are in cells (world px / CELL).
 */
export type Pt = { x: number; y: number };
export const EDGES = ['圓滑', '有稜有角', '方正', '隨機起伏'] as const;
export type Edge = 0 | 1 | 2 | 3;

/** Whether `p` lies inside the closed polygon (even-odd). */
function inside(poly: Pt[], x: number, y: number) {
  let r = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) r = !r;
  }
  return r;
}

/** Distance from (x, y) to the polygon's outline. */
function edgeDist(poly: Pt[], x: number, y: number) {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j], b = poly[i], dx = b.x - a.x, dy = b.y - a.y, l = dx * dx + dy * dy;
    const t = l ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / l)) : 0;
    best = Math.min(best, Math.hypot(x - a.x - t * dx, y - a.y - t * dy));
  }
  return best;
}

/** Chaikin's corner cutting on a closed loop. */
function smooth(poly: Pt[], rounds: number) {
  let p = poly;
  for (let k = 0; k < rounds; k++) {
    const q: Pt[] = [];
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length];
      q.push({ x: a.x * .75 + b.x * .25, y: a.y * .75 + b.y * .25 }, { x: a.x * .25 + b.x * .75, y: a.y * .25 + b.y * .75 });
    }
    p = q;
  }
  return p;
}

/** Douglas–Peucker on a closed loop: the few corners that carry its shape. */
function corners(poly: Pt[], eps: number): Pt[] {
  const far = (pts: Pt[]): Pt[] => {
    if (pts.length < 3) return pts;
    const a = pts[0], b = pts[pts.length - 1];
    let best = -1, at = 0;
    for (let i = 1; i < pts.length - 1; i++) { const d = edgeDist([a, b], pts[i].x, pts[i].y); if (d > best) { best = d; at = i; } }
    if (best < eps) return [a, b];
    return [...far(pts.slice(0, at + 1)).slice(0, -1), ...far(pts.slice(at))];
  };
  // split the loop at the point farthest from the first, so both halves are open runs
  let at = 0, best = -1;
  poly.forEach((p, i) => { const d = Math.hypot(p.x - poly[0].x, p.y - poly[0].y); if (d > best) { best = d; at = i; } });
  const out = [...far(poly.slice(0, at + 1)).slice(0, -1), ...far([...poly.slice(at), poly[0]]).slice(0, -1)];
  return out.length >= 3 ? out : poly;
}

/** A smooth 0..1 noise over the plane (value noise on a 1-cell lattice scaled by `scale`). */
function noise(seed: number, scale: number) {
  const h = (x: number, y: number) => {
    let n = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  const f = (t: number) => t * t * (3 - 2 * t);
  return (x: number, y: number) => {
    x /= scale; y /= scale;
    const ix = Math.floor(x), iy = Math.floor(y), u = f(x - ix), v = f(y - iy);
    const a = h(ix, iy), b = h(ix + 1, iy), c = h(ix, iy + 1), d = h(ix + 1, iy + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}

/** The cells the loop takes, by the edge style; `seed` makes 隨機起伏 differ from loop to loop. */
export function lassoCells(path: Pt[], edge: Edge, w: number, h: number, seed = 1): [number, number][] {
  if (path.length < 3) return [];
  // 有稜有角: few corners — the bigger the loop, the longer its straight cuts
  const span = Math.max(Math.max(...path.map(p => p.x)) - Math.min(...path.map(p => p.x)), Math.max(...path.map(p => p.y)) - Math.min(...path.map(p => p.y)));
  const poly = edge === 0 ? smooth(path, 4) : edge === 1 ? corners(path, Math.max(1.6, span * .09)) : path;
  const xs = poly.map(p => p.x), ys = poly.map(p => p.y), pad = edge === 3 ? 3 : 1;
  const x0 = Math.max(0, Math.floor(Math.min(...xs)) - pad), x1 = Math.min(w - 1, Math.ceil(Math.max(...xs)) + pad);
  const y0 = Math.max(0, Math.floor(Math.min(...ys)) - pad), y1 = Math.min(h - 1, Math.ceil(Math.max(...ys)) + pad);
  const out: [number, number][] = [];
  if (edge === 2) {
    // 方正: blocks of 3 × 3 cells, each taken when most of it lies inside
    const B = 3;
    for (let by = y0; by <= y1; by += B) for (let bx = x0; bx <= x1; bx += B) {
      let n = 0;
      for (let y = by; y < by + B; y++) for (let x = bx; x < bx + B; x++) if (inside(poly, x + .5, y + .5)) n++;
      if (n * 2 > B * B) for (let y = by; y < Math.min(by + B, h); y++) for (let x = bx; x < Math.min(bx + B, w); x++) out.push([x, y]);
    }
    return out;
  }
  const wave = noise(seed, 3.5), fine = noise(seed + 7, 1.3);
  if (edge !== 3) {
    const W = x1 - x0 + 1, H = y1 - y0 + 1;
    let mask = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) mask[y * W + x] = +inside(poly, x0 + x + .5, y0 + y + .5);
    // 圓滑: no one-cell notches or knobs left on the edge
    for (let k = 0; edge === 0 && k < 2; k++) {
      const next = mask.slice();
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        let n = 0;
        for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) if ((i || j) && mask[(y + j) * W + x + i] && x + i >= 0 && x + i < W && y + j >= 0 && y + j < H) n++;
        if (n >= 5) next[y * W + x] = 1; else if (n <= 3) next[y * W + x] = 0;
      }
      mask = next;
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (mask[y * W + x]) out.push([x0 + x, y0 + y]);
    return out;
  }
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const cx = x + .5, cy = y + .5, inn = inside(poly, cx, cy);
    // 隨機起伏: the edge moves in and out by up to ~2½ cells, big swells with small ripples on them
    const d = (inn ? -1 : 1) * edgeDist(poly, cx, cy), push = (wave(cx, cy) - .5) * 4 + (fine(cx, cy) - .5) * 1.4;
    if (d < push) out.push([x, y]);
  }
  return out;
}
