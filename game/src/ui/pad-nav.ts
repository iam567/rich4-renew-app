/**
 * 手把／鍵盤操作 (issue #15): the spatial focus picker, without the DOM. Given the focused box and the boxes that may
 * take the focus, which one a press of up / down / left / right moves to (ui/pad.ts collects the boxes on screen).
 *
 * The rule, close to the browsers' spatial navigation:
 *  - only boxes whose centre lies ahead in the pressed direction count (a box straight beside the focus is not "below");
 *  - the gap along the direction (edge to edge, 0 when they overlap) is the main distance;
 *  - a box that shares the focus's row (left / right) or column (up / down) — overlapping it by at least half the
 *    smaller box — costs nothing sideways; any other pays three times its sideways miss, so the next cell of a grid
 *    wins over a nearer one in another row, and a wide box barely touching the row does not;
 *  - ties go to the box whose centre lines up best, then to the earlier one in the list (reading order).
 */

export interface Rect { x: number; y: number; w: number; h: number }
export type Dir = 'up' | 'down' | 'left' | 'right';

const cx = (r: Rect) => r.x + r.w / 2;
const cy = (r: Rect) => r.y + r.h / 2;

/** Score of moving from `a` to `b` in `dir` (lower is better), or null when `b` is not ahead. */
export function navScore(a: Rect, b: Rect, dir: Dir): number | null {
  const horiz = dir === 'left' || dir === 'right';
  const sign = dir === 'right' || dir === 'down' ? 1 : -1;
  // ahead: the centre moved at least 1 px the pressed way, and the box does not reach back past the focus's far edge
  const dc = horiz ? (cx(b) - cx(a)) * sign : (cy(b) - cy(a)) * sign;
  if (dc < 1) return null;
  const a0 = horiz ? a.x : a.y, a1 = horiz ? a.x + a.w : a.y + a.h;
  const b0 = horiz ? b.x : b.y, b1 = horiz ? b.x + b.w : b.y + b.h;
  const gap = Math.max(0, sign > 0 ? b0 - a1 : a0 - b1);
  // sideways
  const s0 = horiz ? a.y : a.x, s1 = horiz ? a.y + a.h : a.x + a.w;
  const t0 = horiz ? b.y : b.x, t1 = horiz ? b.y + b.h : b.x + b.w;
  // 0 when the spans overlap by half the smaller one; a sliver of overlap counts almost as none
  const overlap = Math.min(s1, t1) - Math.max(s0, t0), half = Math.min(s1 - s0, t1 - t0) / 2;
  const side = Math.max(0, half - overlap);
  const align = Math.abs(horiz ? cy(b) - cy(a) : cx(b) - cx(a));
  return gap + side * 3 + align * 0.05 + dc * 0.05 + (side > 0 ? 4 : 0);
}

/**
 * Whether `b` lies mostly the pressed way from `a`: it shares the row / column, or its centre is within a cone of
 * about 63° round the direction (sideways at most twice as far as ahead).
 */
export function inCone(a: Rect, b: Rect, dir: Dir): boolean {
  const horiz = dir === 'left' || dir === 'right';
  const ahead = Math.abs(horiz ? cx(b) - cx(a) : cy(b) - cy(a));
  const sideways = Math.abs(horiz ? cy(b) - cy(a) : cx(b) - cx(a));
  const overlap = horiz ? Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) : Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  return overlap > 0 || sideways <= ahead * 2;
}

/** Whether `b`'s centre is past `a`'s edge in `dir` (clearly that way, not just a little further along). */
export function beyond(a: Rect, b: Rect, dir: Dir): boolean {
  switch (dir) {
    case 'left': return cx(b) < a.x;
    case 'right': return cx(b) > a.x + a.w;
    case 'up': return cy(b) < a.y;
    case 'down': return cy(b) > a.y + a.h;
  }
}

/**
 * Index in `cands` of the box a press of `dir` moves to from `from`, or −1 when nothing is that way. Boxes in the
 * direction's cone first; only when there is none, anything clearly that way (the one way to a lone button off to
 * the side).
 */
export function pickInDirection(from: Rect, dir: Dir, cands: Rect[], skip = -1): number {
  for (const cone of [true, false]) {
    let best = -1, bestScore = Infinity;
    cands.forEach((r, i) => {
      if (i === skip || (cone ? !inCone(from, r, dir) : !beyond(from, r, dir))) return;
      const s = navScore(from, r, dir);
      if (s !== null && s < bestScore - 1e-6) { best = i; bestScore = s; }
    });
    if (best >= 0) return best;
  }
  return -1;
}

/** Index of the box whose centre is nearest the centre of `to` (focus kept across a re-drawn screen), or −1. */
export function nearestTo(to: Rect, cands: Rect[], maxDist = Infinity): number {
  let best = -1, bestD = maxDist;
  cands.forEach((r, i) => {
    const d = Math.hypot(cx(r) - cx(to), cy(r) - cy(to));
    if (d < bestD) { best = i; bestD = d; }
  });
  return best;
}

/** Indices of `cands` in reading order: rows from the top (boxes whose middles are within half a box count as one row), left to right. */
export function readingOrder(cands: Rect[]): number[] {
  const idx = cands.map((_, i) => i).sort((i, j) => cy(cands[i]) - cy(cands[j]) || cx(cands[i]) - cx(cands[j]));
  const rows: number[][] = [];
  for (const i of idx) {
    const row = rows[rows.length - 1];
    const ref = row && cands[row[0]];
    if (ref && Math.abs(cy(cands[i]) - cy(ref)) <= Math.max(6, Math.min(ref.h, cands[i].h) / 2)) row.push(i);
    else rows.push([i]);
  }
  return rows.flatMap(r => r.sort((i, j) => cx(cands[i]) - cx(cands[j])));
}
