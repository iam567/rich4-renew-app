import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBoard, landOf, nodeById, type RawMap } from './board';
import { Rng } from './rng';
import { addMonths, nextDay, pack, weekday } from './date';

// Original map data is extracted locally from the player's own game (never committed).
const mapFile = (id: number) => fileURLToPath(new URL(`../../../editor/site/assets/map-${id}.json`, import.meta.url));
const haveMaps = existsSync(mapFile(0));
const load = (id: number) => parseBoard(JSON.parse(readFileSync(mapFile(id), 'utf8')) as RawMap);

describe('rand', () => {
  it('matches the C runtime sequence for srand(1)', () => {
    const r = new Rng(1);
    // Well-known first values of this LCG with seed 1.
    expect([r.rand(), r.rand(), r.rand()]).toEqual([16838, 5758, 10113]);
  });
});

describe('dates', () => {
  it('rolls months and years and knows weekdays', () => {
    expect(nextDay(pack(2026, 12, 31))).toEqual({ date: pack(2027, 1, 1), newMonth: true });
    expect(nextDay(pack(2028, 2, 28)).date).toBe(pack(2028, 2, 29));
    expect(weekday(pack(1998, 1, 1))).toBe(4); // Thursday, as in the original
    expect(addMonths(pack(2026, 8, 31), 1)).toBe(pack(2026, 9, 30));
  });
});

describe.skipIf(!haveMaps)('original maps', () => {
  it('parses Taiwan streets with the documented prices and tolls', () => {
    const board = load(0);
    expect(board.nodes).toHaveLength(103);
    expect(board.lands).toHaveLength(50);
    const taipei = board.lands.filter(l => l.name === '台北市');
    expect(taipei.length).toBeGreaterThan(0);
    for (const l of taipei) {
      expect(l.price).toBe(2500);
      expect(l.perLevel).toBe(500);
      expect(l.tolls).toEqual([500, 1200, 3000, 7500, 16000, 30000]);
    }
  });

  it('links nodes both ways and resolves land references', () => {
    for (const id of [0, 1, 2, 3]) {
      const board = load(id);
      board.nodes.forEach((n, i) => expect(n.id).toBe(i + 1));
      for (const n of board.nodes) {
        for (const a of n.adjacent.filter(Boolean)) expect(nodeById(board, a).adjacent).toContain(n.id);
        if (n.ref > 2000 && n.ref < 4000) expect(landOf(board, n)).toBeDefined();
      }
      expect(board.nodes.filter(n => n.event === 5)).toHaveLength(1);
      expect(board.nodes.filter(n => n.event === 4)).toHaveLength(1);
    }
  });
});
