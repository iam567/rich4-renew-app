import { describe, expect, it } from 'vitest';
import { G, newMap } from './model';
import { plantTrees } from './woods';

// 樹林 planted tree by tree: where each tree stands comes from its own place, so painting elsewhere moves nothing.
function wood() {
  const m = newMap('樹', 30, 30, G.grass);
  for (let y = 5; y < 15; y++) for (let x = 5; x < 15; x++) m.cells[y * 30 + x] = G.forest;
  return m;
}
const key = (t: { x: number; y: number; d: number }) => `${t.x.toFixed(2)},${t.y.toFixed(2)},${t.d.toFixed(2)}`;

describe('樹林 種樹', () => {
  it('plants a wood full of trees, a few strays outside, the same each time', () => {
    const m = wood(), a = plantTrees(m);
    expect(a.length).toBeGreaterThan(200);
    expect(plantTrees(m).map(key)).toEqual(a.map(key));
    const out = a.filter(t => t.x < 5 * 48 || t.x > 15 * 48 || t.y < 5 * 48 || t.y > 15 * 48);
    expect(out.length).toBeGreaterThan(0);
    expect(out.length).toBeLessThan(a.length * .1);
  });

  it('painting a second wood far off leaves the first one\'s trees where they were', () => {
    const m = wood(), before = new Set(plantTrees(m).map(key));
    for (let y = 22; y < 28; y++) for (let x = 22; x < 28; x++) m.cells[y * 30 + x] = G.forest;
    const after = plantTrees(m).filter(t => t.x < 17 * 48 && t.y < 17 * 48).map(key);
    expect(after.every(k => before.has(k))).toBe(true);
  });

  it('the sliders: fewer trees at a lower density, none in 貼圖 mode, none stray onto a square', () => {
    const m = wood(), full = plantTrees(m).length;
    m.wood = { mode: 0, density: .2, size: 1, spread: .6, colour: .6, strays: 1, seed: 1 };
    expect(plantTrees(m).length).toBeLessThan(full * .6);
    m.nodes.push({ id: 1, cx: 16, cy: 10, links: [], ev: 0, style: 0 });
    expect(plantTrees(m).some(t => Math.floor(t.x / 48) === 16 && Math.floor(t.y / 48) === 10)).toBe(false);
    m.wood = { ...m.wood, mode: 1 };
    expect(plantTrees(m)).toEqual([]);
  });
});
