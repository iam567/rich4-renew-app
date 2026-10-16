/**
 * Map picking (09 §7.5, 05 §2.6) without the DOM: what is visible and what a tap picks.
 *
 * The original's selector looks the tapped pixel up in a pick buffer: road nodes first, then every drawn sprite
 * (buildings, people, objects) painted over them in drawing order, so any visible pixel of a target picks it and
 * the frontmost one wins where they overlap (rich4.asm:2829 fcn_00409b18). What is selectable is what that
 * buffer holds: everything inside the view. The remake does the same on screen and is a little more forgiving
 * (a finger is not a mouse pointer):
 *  1. an opaque pixel of a target's sprite under the finger — the frontmost sprite wins;
 *  2. an opaque pixel within `margin` px of the finger — the nearest;
 *  3. inside a target's glow (the ellipse on the ground) — the most central;
 *  4. inside a sprite's box (a transparent part of the picture) — the frontmost;
 *  5. within `margin` px of a glow — the nearest;
 *  6. within `near` px of a glow's centre — the nearest.
 * Targets standing on the same spot as the chosen one (people on one square, a god and a player on one node) and
 * also under the finger are returned as a stack, to be told apart by name.
 */

export interface Rect { x: number; y: number; w: number; h: number }
export interface Glow { x: number; y: number; rx: number; ry: number }

/** One drawn picture of a target, in CSS px of the canvas; `order` = its drawing order (larger is in front). */
export interface Piece extends Rect {
  order: number;
  /** Alpha test around a canvas point: `hit` an opaque pixel exactly there, `near` one within radius r. */
  opaque?: (x: number, y: number, r: number) => { hit: boolean; near: boolean; d: number };
}

/** What a target looks like on screen: its glow on the ground, its pictures and the point it stands on. */
export interface Shape { glow: Glow; pieces: Piece[]; anchor: { x: number; y: number } }

/** The box round everything a shape draws. */
export function bounds(s: Shape): Rect {
  let x0 = s.glow.x - s.glow.rx, x1 = s.glow.x + s.glow.rx, y0 = s.glow.y - s.glow.ry, y1 = s.glow.y + s.glow.ry;
  for (const p of s.pieces) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x + p.w); y1 = Math.max(y1, p.y + p.h); }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * Whether any of a shape shows on a `W`×`H` canvas: at least `min` px of its box (glow or picture) inside on both
 * axes. A sliver at the edge counts, as in the original's pick buffer.
 */
export function visible(s: Shape | null, W: number, H: number, min = 2): boolean {
  if (!s) return false;
  const parts: Rect[] = [{ x: s.glow.x - s.glow.rx, y: s.glow.y - s.glow.ry, w: s.glow.rx * 2, h: s.glow.ry * 2 }, ...s.pieces];
  return parts.some(r => Math.min(r.x + r.w, W) - Math.max(r.x, 0) >= min && Math.min(r.y + r.h, H) - Math.max(r.y, 0) >= min);
}

/** Normalised distance from a glow's centre (1 = on its rim). */
export function glowDist(g: Glow, x: number, y: number): number {
  return Math.hypot((x - g.x) / Math.max(1, g.rx), (y - g.y) / Math.max(1, g.ry));
}

interface Cand { i: number; tier: number; key: number }

/**
 * The target a tap at (x, y) picks among `allowed` (indices into `shapes`), or null for a miss. `stack` holds the
 * chosen one and the others standing at the same spot (anchors within `stackPx`) that the tap also reached.
 */
export function pickAt(shapes: (Shape | null)[], allowed: Iterable<number>, x: number, y: number,
  o: { margin: number; near: number; stackPx: number }): { best: number; stack: number[] } | null {
  const cands: Cand[] = [];
  for (const i of allowed) {
    const s = shapes[i];
    if (!s) continue;
    let tier = 9, key = 0;
    const better = (t: number, k: number) => { if (t < tier || (t === tier && k < key)) { tier = t; key = k; } };
    for (const p of s.pieces) {
      const inBox = x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h;
      const nearBox = x >= p.x - o.margin && x <= p.x + p.w + o.margin && y >= p.y - o.margin && y <= p.y + p.h + o.margin;
      if (!nearBox) continue;
      const a = p.opaque?.(x, y, o.margin);
      if (a?.hit) better(0, -p.order);
      else if (a?.near) better(1, a.d);
      else if (inBox && !p.opaque) better(0, -p.order); // no pixels to test: the box is the picture
      else if (inBox) better(3, -p.order);
    }
    const e = glowDist(s.glow, x, y);
    if (e <= 1) better(2, e);
    else {
      const px = Math.hypot(x - s.glow.x, y - s.glow.y) * (1 - 1 / e); // px outside the rim along the ray
      if (px <= o.margin) better(4, px);
      else if (Math.hypot(x - s.glow.x, y - s.glow.y) <= o.near) better(5, Math.hypot(x - s.glow.x, y - s.glow.y));
    }
    if (tier < 9) cands.push({ i, tier, key });
  }
  if (!cands.length) return null;
  cands.sort((a, b) => a.tier - b.tier || a.key - b.key || a.i - b.i);
  const best = cands[0], at = shapes[best.i]!.anchor;
  // Others on the same spot that the finger reached as well (anything but the far fallback).
  const stack = cands.filter(c => c.i === best.i || (c.tier <= 4 && Math.hypot(shapes[c.i]!.anchor.x - at.x, shapes[c.i]!.anchor.y - at.y) <= o.stackPx)).map(c => c.i);
  return { best: best.i, stack };
}
