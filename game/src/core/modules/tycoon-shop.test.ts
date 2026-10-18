/**
 * 大富豪模式's shops (docs/rules/17 §3.10, the user 2026-10-19): the card shelf has 轉向卡, 停留卡 and the mode's own
 * cards always (bought as often as wanted), the 通緝卡 while its city's one copy is in, then 6–15 cells drawn from one
 * nationwide pool (each card's copies × 5, shared by the five cities, a cell bought once per visit); the tool shelf
 * has all eight, bought as often as wanted up to the stack of 9. The normal game keeps the original shelves (05 §8.3).
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBoard, type Board, type RawMap } from '../board';
import { pack } from '../date';
import type { Ask, Step } from '../types';
import { applyOverlay, TYCOON_MAPS, World, type TycoonOverlay } from '../world';

const KEYS: Record<number, string> = { 100: 'tokyo', 101: 'osaka', 102: 'sapporo', 103: 'kyushu', 104: 'okinawa' };
const file = (id: number) => fileURLToPath(new URL(`../../../../editor/site/assets/remake/${KEYS[id]}.json`, import.meta.url));
const have = TYCOON_MAPS.every(id => existsSync(file(id)));
const boards = (): Board[] => TYCOON_MAPS.map(id => { const r = JSON.parse(readFileSync(file(id), 'utf8')) as RawMap & { tycoon?: TycoonOverlay }; return applyOverlay(parseBoard(r), r.tycoon, id); });

function world() {
  const w = new World({
    mode: 'tycoon', maps: [...TYCOON_MAPS], players: Array.from({ length: 12 }, (_, i) => ({ character: i, human: i === 0 })),
    fundIndex: 1, traffic: 1, landLimitIndex: 0, startDate: pack(2026, 10, 16), seed: 7,
  }, boards());
  const g = w.cities[0], me = w.players[0];
  me.map = 0; me.placed = true; me.whoPlays = 1;
  me.node = g.board.nodes.find(n => n.event === 15)!.id;
  return { w, g, me };
}

/** Runs the shop with a list of answers; returns the shelves of every question. */
function shop(g: World['cities'][number], me: World['players'][number], answers: unknown[]) {
  const flow = g.tools.shop(me), asks: Extract<Ask, { t: 'shop' }>[] = [];
  let r = flow.next();
  while (!r.done) {
    const s = r.value as Step;
    if ('ask' in s && s.t === 'shop') { asks.push(s); r = flow.next(answers.shift() as never); } else r = flow.next();
  }
  return asks;
}

const ALWAYS = [6, 14, 31, 32, 33, 35];

describe.skipIf(!have)('大富豪模式 shops (17 §3.10)', () => {
  it('one nationwide card pool: copies × 5, the same array in the five cities, kept by a save', async () => {
    const { w } = world();
    const pool = w.cities[0].cards.remaining;
    expect(w.cities.every(c => c.cards.remaining === pool)).toBe(true);
    expect(pool[0]).toBe(10); // 均富卡 2 × 5
    expect(pool[1]).toBe(10); // 均貧卡 2 × 5
    expect(pool[6]).toBe(20); // 改建卡 4 × 5
    expect(pool[33]).toBe(5); // 獨裁卡: one per map
    expect(pool[35]).toBe(0); // the 通緝卡 is one per city, apart from the pool
    pool[0] = 3;
    const { saveWorld, loadWorld } = await import('../save');
    const v = loadWorld(saveWorld(w));
    expect(v.cities.every(c => c.cards.remaining === v.cities[0].cards.remaining)).toBe(true);
    expect(v.cities[0].cards.remaining[0]).toBe(3);
  });

  it('an older save (one pool per city) adds the cities\' pools up', async () => {
    const { w } = world();
    const { saveWorld, loadWorld } = await import('../save');
    const s = saveWorld(w);
    delete s.world.sharedPool;
    s.cities.forEach((c, i) => { (c.modules.cards as { remaining: number[] }).remaining = Array.from({ length: 36 }, () => i); });
    const v = loadWorld(s);
    expect(v.cities[2].cards.remaining[0]).toBe(0 + 1 + 2 + 3 + 4);
    expect(v.cities[2].cards.remaining[35]).toBe(0);
    expect(v.cities.map(c => c.cards.wanted)).toEqual([1, 1, 1, 1, 1]);
  });

  it('the shelf: the always-stocked cards first, then 6–15 drawn from the pool; all eight tools', () => {
    const { g } = world();
    g.tools.shopStock.fill(0);
    for (let k = 0; k < 20; k++) {
      const shelf = g.tools.cardShelf();
      expect(shelf.slice(0, 7)).toEqual([...ALWAYS, 36]);
      const drawn = shelf.slice(7);
      expect(drawn.length).toBeGreaterThanOrEqual(6);
      expect(drawn.length).toBeLessThanOrEqual(15);
      expect(drawn.every(id => (id >= 1 && id <= 30 && id !== 6 && id !== 14) || id === 34)).toBe(true);
    }
    expect(g.tools.toolShelf()).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    g.cards.remaining.fill(0); // the nationwide pool is empty: only the always-stocked cards
    g.cards.wanted = 0; // this city's 通緝卡 is out
    expect(g.tools.cardShelf()).toEqual(ALWAYS);
  });

  it('always-stocked cards and tools again and again; a pool card once per visit, taken from the pool of every city', () => {
    const { w, g, me } = world();
    me.points = 5000; me.cards = []; me.tools = me.tools.map(() => 0);
    g.tools.shopStock.fill(0);
    const pool = g.cards.remaining;
    pool.fill(0);
    pool[2] = 1; // one 購地卡 left in the whole country
    const asks = shop(g, me, [
      { buy: 'card', index: 0 }, { buy: 'card', index: 0 }, { buy: 'card', index: 1 }, { buy: 'card', index: 7 }, { buy: 'card', index: 7 },
      ...Array.from({ length: 10 }, () => ({ buy: 'tool', index: 7 })), null,
    ]);
    expect(asks[0].cards).toEqual([...ALWAYS, 36, 3]);
    expect(me.cards).toEqual([6, 6, 14, 3]);
    expect(asks.at(-1)!.cards[7]).toBe(0);
    expect(asks.at(-1)!.cards[0]).toBe(6);
    expect(me.tools[7]).toBe(9); // up to the stack of 9
    expect(asks.at(-1)!.tools[7]).toBe(8);
    expect(w.cities[3].cards.remaining[2]).toBe(0);
    expect(pool[5]).toBe(0); // the always-stocked 轉向卡 is not taken from the pool
    expect(Math.min(...g.tools.shopStock)).toBe(0);
  });

  it('the 獨裁卡 is one per map: five in the nationwide pool, a shelf cell once per visit', () => {
    const { w, g, me } = world();
    me.points = 5000; me.cards = [];
    const pool = g.cards.remaining;
    pool.fill(0);
    pool[33] = 1; // the last 獨裁卡 in the country
    const asks = shop(g, me, [{ buy: 'card', index: 7 }, { buy: 'card', index: 7 }, null]);
    expect(asks[0].cards.slice(7)).toEqual([34]);
    expect(me.cards).toEqual([34]);
    expect(w.cities[4].cards.remaining[33]).toBe(0);
    expect(w.cities[4].tools.cardShelf()).not.toContain(34);
  });

  it('the computer buys from the same shelf, at most one of each card (no buying again and again)', () => {
    const { w, g } = world();
    const ai = w.players[1];
    ai.map = 0; ai.placed = true; ai.human = false;
    ai.node = g.board.nodes.find(n => n.event === 15)!.id;
    for (let k = 0; k < 10; k++) {
      ai.points = 9000; ai.cards = [];
      const flow = g.tools.shop(ai);
      for (let r = flow.next(); !r.done; r = flow.next()) { /* the computer asks nothing */ }
      expect(new Set(ai.cards).size).toBe(ai.cards.length);
      expect(ai.cards.length).toBeGreaterThan(0);
    }
  });

  it('a card sold goes back to the nationwide pool, never above its copies', () => {
    const { g, me } = world();
    me.cards = [1, 1];
    g.tools.sellCard(me, 0);
    expect(g.cards.remaining[0]).toBe(10);
    g.cards.remaining[0] = 8;
    g.tools.sellCard(me, 0);
    expect(g.cards.remaining[0]).toBe(9);
  });

  it('the 通緝卡 is sold once per city', () => {
    const { w, g, me } = world();
    me.points = 2000; me.cards = [];
    w.syncWanted();
    const asks = shop(g, me, [{ buy: 'card', index: 6 }, null]);
    expect(me.cards).toEqual([36]);
    expect(asks[0].cards[6]).toBe(36);
    expect(asks[1].cards[6]).toBe(0);
    expect(w.cities.map(c => c.cards.wanted)).toEqual([0, 1, 1, 1, 1]);
    expect(g.tools.cardShelf()).not.toContain(36);
  });
});
