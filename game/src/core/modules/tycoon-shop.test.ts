/**
 * 大富豪模式's shop has no stock for the human (docs/rules/17 §3.10): every card and tool on the shelves, nothing
 * sold out, except the one 通緝卡 per city. The normal game keeps the original shelves (05 §8.3).
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

describe.skipIf(!have)('大富豪模式 shop without stock (17 §3.10)', () => {
  it('shows every card and all eight tools, even when the pool and the stock are empty', () => {
    const { g } = world();
    g.cards.remaining.fill(0);
    g.cards.remaining[35] = 1;
    g.tools.shopStock.fill(0);
    expect(g.tools.cardShelf()).toEqual(Array.from({ length: 36 }, (_, i) => i + 1));
    expect(g.tools.toolShelf()).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    g.cards.remaining[35] = 0; // this city's 通緝卡 is out
    expect(g.tools.cardShelf()).not.toContain(36);
  });

  it('a bought card or tool stays on the shelf; the pool and the stock never go below 0', () => {
    const { g, me } = world();
    me.points = 2000; me.cards = []; me.tools = me.tools.map(() => 0);
    g.tools.shopStock.fill(0);
    g.cards.remaining.fill(0);
    const asks = shop(g, me, [{ buy: 'card', index: 2 }, { buy: 'card', index: 2 }, { buy: 'tool', index: 7 }, { buy: 'tool', index: 7 }, null]);
    expect(me.cards).toEqual([3, 3]);
    expect(me.tools[7]).toBe(2);
    expect(asks.at(-1)!.cards[2]).toBe(3);
    expect(asks.at(-1)!.tools[7]).toBe(8);
    expect(Math.min(...g.cards.remaining)).toBe(0);
    expect(Math.min(...g.tools.shopStock)).toBe(0);
  });

  it('the 通緝卡 is sold once per city', () => {
    const { w, g, me } = world();
    me.points = 2000; me.cards = [];
    w.syncWanted();
    const asks = shop(g, me, [{ buy: 'card', index: 35 }, null]);
    expect(me.cards).toEqual([36]);
    expect(asks[0].cards[35]).toBe(36);
    expect(asks[1].cards[35]).toBe(0);
    expect(g.tools.cardShelf()).not.toContain(36);
  });
});
