import { describe, expect, it } from 'vitest';
import { pickAt, visible, type Piece, type Shape } from './pick-hit';

/** A sprite whose opaque pixels are the given rectangles (canvas px); the rest of its box is transparent. */
function sprite(x: number, y: number, w: number, h: number, order: number, solid: { x: number; y: number; w: number; h: number }[] = [{ x, y, w, h }]): Piece {
  const inSolid = (px: number, py: number) => solid.some(r => px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h);
  return {
    x, y, w, h, order,
    opaque: (tx, ty, r) => {
      let best = Infinity;
      for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) {
        const d = Math.hypot(i, j);
        if (d <= r && d < best && inSolid(tx + i, ty + j)) best = d;
      }
      return { hit: best <= 1, near: best <= r, d: best };
    },
  };
}

/** A target standing at (x, y): glow radius 16 (flattened), optional pictures. */
const shape = (x: number, y: number, pieces: Piece[] = [], r = 16): Shape => ({ glow: { x, y, rx: r, ry: r * 0.7 }, pieces, anchor: { x, y } });

const opts = { margin: 8, near: 40, stackPx: 10 };
const W = 400, H = 300;

describe('what an on-screen pick allows (everything visible)', () => {
  it('counts a target whose figure or glow shows even by a sliver at an edge', () => {
    expect(visible(shape(200, 150), W, H)).toBe(true);
    // Feet below the bottom edge, the head still showing.
    expect(visible(shape(200, 330, [sprite(185, 280, 30, 50, 1)]), W, H)).toBe(true);
    // Only the top of the glow shows at the bottom edge.
    expect(visible(shape(200, H + 8), W, H)).toBe(true);
    // A god standing on the road at the top edge: its node a little inside, its figure cut off above.
    expect(visible(shape(200, 4, [sprite(186, -24, 28, 30, 1)]), W, H)).toBe(true);
    // Under the hint pill at the top-left: still on the canvas, so still allowed.
    expect(visible(shape(40, 20, [sprite(26, -5, 28, 28, 1)]), W, H)).toBe(true);
  });

  it('leaves out what is entirely off the canvas', () => {
    expect(visible(shape(200, -40, [sprite(186, -70, 28, 30, 1)]), W, H)).toBe(false);
    expect(visible(shape(-30, 100), W, H)).toBe(false);
    expect(visible(null, W, H)).toBe(false);
  });
});

describe('what a tap picks (generous, frontmost)', () => {
  it('a tap on any opaque part of a figure picks it, far above its glow (the 土地公 on the road)', () => {
    const god = shape(100, 100, [sprite(86, 64, 28, 38, 100 * 16)]);
    const lot = shape(160, 60, [], 34);
    // The head of the god, 30 px above its feet: outside its glow, inside its picture.
    expect(pickAt([god, lot], [0, 1], 100, 70, opts)?.best).toBe(0);
  });

  it('the frontmost picture wins where two overlap (a person in front of a building)', () => {
    const house = shape(100, 100, [sprite(60, 20, 80, 85, 100 * 16)], 34);
    const person = shape(105, 130, [sprite(90, 90, 30, 42, 130 * 16 + 12)], 22);
    expect(pickAt([house, person], [0, 1], 105, 100, opts)?.best).toBe(1);
    // Above the person's head only the house is there.
    expect(pickAt([house, person], [0, 1], 105, 40, opts)?.best).toBe(0);
  });

  it('a transparent corner of a picture does not steal the tap from a glow there', () => {
    // A tall building whose box covers a road square's glow, but whose pixels are only in its middle.
    const tower = shape(100, 100, [sprite(40, 0, 120, 105, 100 * 16, [{ x: 80, y: 0, w: 40, h: 105 }])], 34);
    const square = shape(55, 90);
    expect(pickAt([tower, square], [0, 1], 52, 88, opts)?.best).toBe(1);
  });

  it('a tap just beside a figure (within the margin) still picks it', () => {
    const p = shape(100, 100, [sprite(90, 60, 20, 40, 1)]);
    expect(pickAt([p], [0], 116, 70, opts)?.best).toBe(0);
  });

  it('a tap near a glow picks the nearest; far from everything misses', () => {
    const a = shape(100, 100), b = shape(200, 100);
    expect(pickAt([a, b], [0, 1], 125, 100, opts)?.best).toBe(0);  // 25 px from a: outside its glow, near it
    expect(pickAt([a, b], [0, 1], 175, 100, opts)?.best).toBe(1);
    expect(pickAt([a, b], [0, 1], 150, 200, opts)).toBeNull();
  });

  it('only allowed targets count', () => {
    const a = shape(100, 100), b = shape(110, 100);
    expect(pickAt([a, b], [1], 100, 100, opts)?.best).toBe(1);
    expect(pickAt([a, b], [], 100, 100, opts)).toBeNull();
  });

  it('people on one square (or a god lying under a player) come back as a stack to tell apart', () => {
    const p1 = shape(100, 100, [sprite(88, 60, 24, 42, 100 * 16 + 12)], 22);
    const p2 = shape(100, 100, [sprite(88, 60, 24, 42, 100 * 16 + 13)], 22);
    const far = shape(180, 100, [sprite(168, 60, 24, 42, 100 * 16)], 22);
    const hit = pickAt([p1, p2, far], [0, 1, 2], 100, 80, opts)!;
    expect(hit.best).toBe(1);
    expect(hit.stack.sort()).toEqual([0, 1]);
  });
});
