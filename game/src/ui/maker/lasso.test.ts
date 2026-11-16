import { describe, expect, it } from 'vitest';
import { lassoCells, type Edge, type Pt } from './lasso';

// 圈地: a loop drawn by the finger takes the cells inside it, its edge in one of four ways.
const ring = (cx: number, cy: number, r: number): Pt[] => Array.from({ length: 48 }, (_, i) => ({ x: cx + r * Math.cos(i / 48 * Math.PI * 2), y: cy + r * Math.sin(i / 48 * Math.PI * 2) }));

describe('圈地', () => {
  it('each edge style takes about the circle\'s area, inside the map, no cell twice', () => {
    for (const e of [0, 1, 2, 3] as Edge[]) {
      const cells = lassoCells(ring(20, 20, 8), e, 40, 40, 7);
      expect(cells.length).toBeGreaterThan(Math.PI * 64 * .7);
      expect(cells.length).toBeLessThan(Math.PI * 64 * 1.35);
      expect(new Set(cells.map(([x, y]) => y * 40 + x)).size).toBe(cells.length);
      expect(cells.every(([x, y]) => x >= 0 && y >= 0 && x < 40 && y < 40)).toBe(true);
      expect(cells.some(([x, y]) => x === 20 && y === 20)).toBe(true);
    }
  });

  it('方正 comes in 3 × 3 blocks; a loop past the map\'s edge is cut at it', () => {
    const cells = lassoCells(ring(20, 20, 8), 2, 40, 40), xs = new Set(cells.map(([x]) => x - Math.min(...cells.map(c => c[0]))));
    expect([...xs].length % 3).toBe(0);
    const cut = lassoCells(ring(2, 2, 6), 0, 40, 40);
    expect(cut.length).toBeGreaterThan(10);
    expect(cut.every(([x, y]) => x >= 0 && y >= 0)).toBe(true);
  });

  it('a stroke too short for a loop takes nothing', () => {
    expect(lassoCells([{ x: 1, y: 1 }, { x: 2, y: 2 }], 0, 10, 10)).toEqual([]);
  });
});
