import { describe, expect, it } from 'vitest';
import { autoFix, joinEnds } from './fix';
import { problems } from './check';
import { G, newMap, type MkNode } from './model';

/** A straight road of squares from (x0, y) to (x1, y), linked in a row. */
function row(m: ReturnType<typeof newMap>, x0: number, x1: number, y: number): MkNode[] {
  const out: MkNode[] = [];
  for (let x = x0; x <= x1; x++) {
    const n: MkNode = { id: m.nextId++, cx: x, cy: y, links: [], ev: 0, style: 0 };
    const p = out[out.length - 1];
    if (p) { p.links.push(n.id); n.links.push(p.id); }
    m.nodes.push(n); out.push(n);
  }
  return out;
}

describe('強制修復', () => {
  it('joins two ends a quarter step apart into one square (issue #95)', () => {
    const m = newMap('t', 20, 20, G.grass);
    const a = row(m, 2, 6, 5);
    const b = row(m, 6, 10, 5);
    b[0].cx = 6.25;  // the corner: two squares almost on one spot
    expect(joinEnds(m)).toBeGreaterThan(0);
    expect(m.nodes.length).toBe(a.length + b.length - 1);
  });

  it('makes a broken map playable: road joined and looped, hospital, prison, bank, lots', () => {
    const m = newMap('t', 24, 24, G.grass);
    row(m, 3, 12, 4);
    row(m, 3, 12, 10);   // a second road apart from the first, both with dead ends
    expect(problems(m).length).toBeGreaterThan(0);
    const did = autoFix(m);
    expect(did.length).toBeGreaterThan(0);
    expect(problems(m)).toEqual([]);
  });

  it('says it cannot invent a road', () => {
    const m = newMap('t', 20, 20, G.grass);
    row(m, 2, 6, 5);
    expect(autoFix(m)[0]).toMatch(/沒辦法自動修/);
  });
});
