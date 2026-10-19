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
import type { Flow } from '../flow';
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

  it('the magic house works on its own city only: a 嫁禍卡 cannot send its 住院 to someone in another city', () => {
    const { w } = world();
    const osaka = w.cities[1], ai = w.players[1], me = w.players[0], local = w.players[2];
    for (const q of w.players) if (q.id > 2) q.map = 4;
    me.map = 0; ai.map = 1; local.map = 1;
    for (const q of [ai, local]) { q.placed = true; q.node = osaka.board.nodes.find(n => n.event === 1)?.id ?? osaka.board.nodes[0].id; }
    ai.human = false; ai.whoPlays = 2; local.whoPlays = 2; ai.cards = [19]; ai.hostility[0] = 9999; // hates the human in 東京 most
    const flow = osaka.places.castMagic(local, 10, [ai]);
    for (let r = flow.next(); !r.done; r = flow.next()) { /* no question for a computer */ }
    expect(me.hospital).toBe(0);
    expect(ai.cards).toEqual([]); // the 嫁禍卡 went to someone here instead
    expect(local.hospital).toBeGreaterThan(0);
  });

  it('stacked hand (the user 2026-10-19): 3 of a card to a slot, a 4th opens another; 15 slots; a full hand drops a lone cheap card', async () => {
    const { handSlots, handStacks, handRoom } = await import('./cards');
    const hand = [14, 14, 14, 14, 6, 6, 1, 21, 21, 21, 21, 21, 21, 21];
    expect(handStacks(hand, 3).map(s => [s.id, s.n])).toEqual([[14, 3], [14, 1], [6, 2], [1, 1], [21, 3], [21, 3], [21, 1]]);
    expect(handSlots(hand, 3)).toBe(7);
    expect(handSlots(hand, 1)).toBe(14);
    const { g, me } = world();
    // 15 slots full: 14 slots of 3 停留卡… and one lone 均富卡
    me.cards = [...Array.from({ length: 13 }, () => [14, 14, 14]).flat(), 6, 6, 1];
    expect(handSlots(me.cards, 3)).toBe(15);
    expect(handRoom(me.cards, 6, 3)).toBe(true);    // the 轉向卡 slot has room for a third
    expect(handRoom(me.cards, 20, 3)).toBe(false);  // a new card needs a slot
    g.cards.receive(me, 6);
    expect(me.cards.filter(c => c === 6)).toHaveLength(3);
    expect(me.cards).toContain(1);
    g.cards.receive(me, 20);                          // full: the card alone in its slot goes (that frees a slot)
    expect(handSlots(me.cards, 3)).toBe(15);
    expect(me.cards).toContain(20);
    expect(me.cards).not.toContain(1);                // the only card alone in its slot
    // The shop: a full hand still takes one more of a card with room in its slot.
    me.points = 5000; g.tools.shopStock.fill(0);
    const asks = shop(g, me, [{ buy: 'card', index: 0 }, null]);     // 轉向卡: its slot is full (3) → no room
    expect(asks.length).toBeGreaterThan(0);
    expect(me.cards.filter(c => c === 6)).toHaveLength(3);
  });

  it('stacked hands: 搶奪卡 takes one copy (×3 → ×2); 小衰神 loses one card, not a slot; 大衰神 half the cards', () => {
    const { w, g, me } = world();
    const q = w.players[1];
    for (const x of [me, q]) { x.map = 0; x.placed = true; x.whoPlays = x.human ? 1 : 2; x.prison = x.hospital = x.hotel = x.vanish = 0; }
    q.human = false;
    q.node = me.node;
    w.mask(0);
    // 搶奪卡: the human takes a 停留卡 from q's stack of three
    q.cards = [14, 14, 14, 6]; me.cards = [13];
    const cards = g.cards as unknown as { play(p: unknown, id: number, human: boolean): Flow<boolean> };
    const f = cards.play(me, 13, true);
    for (let r = f.next(); !r.done; ) {
      const s = r.value as Step & { t: string; title?: string; spots?: { id: number }[] };
      let a: unknown;
      if ('ask' in s) a = s.t === 'pick-map' ? s.spots!.findIndex(x => x.id === q.id) : s.t === 'choose' ? 14 : undefined;
      r = f.next(a as never);
    }
    expect(q.cards.filter(c => c === 14)).toHaveLength(2);
    expect(q.cards).toHaveLength(3);
    expect(me.cards).toEqual([14]);
    // 小衰神 (slot 7): one card goes, whatever stack it was in
    q.cards = [14, 14, 14, 21, 21, 21, 1];
    const f2 = g.objects.attach(q, 7); for (let r = f2.next(); !r.done; r = f2.next()) { /* computer */ }
    expect(q.cards).toHaveLength(6);
    // 大衰神 (slot 8): half the cards (⌊7/2⌋ = 3), counted by card, not by slot
    q.cards = [14, 14, 14, 21, 21, 21, 1];
    const f3 = g.objects.attach(q, 8); for (let r = f3.next(); !r.done; r = f3.next()) { /* computer */ }
    expect(q.cards).toHaveLength(4);
  });

  it('stacks merge by themselves: 停留卡×3 + ×1 less one is one slot of ×3', async () => {
    const { handStacks } = await import('./cards');
    const hand = [14, 14, 14, 14];
    hand.splice(hand.indexOf(14), 1);
    expect(handStacks(hand, 3).map(s => [s.id, s.n])).toEqual([[14, 3]]);
  });

  it('複製卡 (39): copies any card or tool once and is gone; never on the shelf; the owner\'s gift may be one; old pools get its copies', async () => {
    const { COPY_CARD } = await import('./cards');
    const { w, g, me } = world();
    expect(g.cards.remaining[COPY_CARD - 1]).toBe(20);            // 4 a map × 5
    for (let k = 0; k < 30; k++) expect(g.tools.cardShelf()).not.toContain(COPY_CARD);
    const cards = g.cards as unknown as { play(p: unknown, id: number, human: boolean): Flow<boolean> };
    const use = (answers: unknown[]) => { const f = cards.play(me, COPY_CARD, true); let r = f.next(); while (!r.done) r = f.next(('ask' in (r.value as object) ? answers.shift() : undefined) as never); return r.value; };
    // a card held: 獨裁卡, from nowhere (the pool keeps its count)
    me.tools = me.tools.map(() => 0);
    me.cards = [COPY_CARD, 34]; const before = g.cards.remaining[33];
    expect(use([34])).toBe(true);                                  // cards only: no 卡片／道具 question
    expect(me.cards).toEqual([34, 34]);
    expect(g.cards.remaining[33]).toBe(before);
    // a card not held cannot be copied
    me.cards = [COPY_CARD, 6];
    expect(use([34])).toBe(false);
    expect(me.cards).toEqual([COPY_CARD, 6]);
    // a tool held: 洲際飛彈 (15)
    me.cards = [COPY_CARD]; me.tools[14] = 1;
    expect(use([15])).toBe(true);
    expect(me.tools[14]).toBe(2);
    expect(me.cards).toEqual([]);
    // nothing to copy: kept
    me.cards = [COPY_CARD]; me.tools = me.tools.map(() => 0);
    expect(use([])).toBe(false);
    expect(me.cards).toEqual([COPY_CARD]);
    // a tool already held 9 times: not copied, the card kept
    me.cards = [COPY_CARD]; me.tools[7] = 9;
    expect(use([8])).toBe(false);
    expect(me.cards).toEqual([COPY_CARD]);
    // the owner's gift draws it among the others (its copies only)
    g.cards.remaining.fill(0); g.cards.remaining[COPY_CARD - 1] = 3;
    expect(g.cards.drawId(true)).toBe(COPY_CARD);
    expect(g.cards.drawId(false)).toBe(0);
    // a save from before the card: the pool gets its 20 copies
    const { saveWorld, loadWorld } = await import('../save');
    const sv = saveWorld(w);
    for (const c of sv.cities) (c.modules.cards as { remaining: number[] }).remaining = (c.modules.cards as { remaining: number[] }).remaining.slice(0, 36);
    const v = loadWorld(sv);
    expect(v.cities[0].cards.remaining).toHaveLength(39);
    expect(v.cities[0].cards.remaining[COPY_CARD - 1]).toBe(20);
  });

  it('時空機 sends a thing on the road (a god, a mine) or a rival to a random square of another city', () => {
    const { w, g, me } = world();
    const q = w.players[1];
    for (const x of [me, q]) { x.map = 0; x.placed = true; x.whoPlays = x.human ? 1 : 2; x.prison = x.hospital = x.hotel = x.vanish = 0; }
    q.human = false; w.landed[q.id] = true; w.landed[me.id] = true;
    q.node = g.board.nodes.find(n => n.adjacent.some(Boolean) && n.id !== me.node)!.id;
    w.mask(0);
    const road = g.board.nodes.filter(n => n.adjacent.some(Boolean) && !g.objects.at(n.id) && n.id !== me.node && n.id !== q.node).map(n => n.id);
    // a 小惡魔 (slot 10) and a mine on the road here
    for (const c of w.cities) for (const o of c.objects.slots) if (o.type === 10 || o.type === 17) Object.assign(o, { node: 0, owner: 0 });
    Object.assign(g.objects.slots[9], { node: road[0], owner: 0 });
    const mine = g.objects.slots.findIndex(o => o.type === 17); Object.assign(g.objects.slots[mine], { node: road[1], owner: 0 });
    const tools = g.tools as unknown as { use(p: unknown, t: number): Flow<boolean> };
    const send = (pick: (s: { spots: { at: string; id: number }[] }) => number, city: number) => {
      me.tools[15] = 1;
      const f = tools.use(me, 16);
      for (let r = f.next(); !r.done; ) { const s = r.value as Step & { t: string; spots?: { at: string; id: number }[] }; r = f.next(('ask' in s ? (s.t === 'pick-map' ? pick(s as never) : s.t === 'choose' ? city : undefined) : undefined) as never); }
      return me.tools[15] === 0;
    };
    expect(send(s => s.spots.findIndex(x => x.at === 'node' && x.id === road[0]), 2)).toBe(true);
    expect(g.objects.slots[9].node).toBe(0);
    expect(w.cities[2].objects.slots[9].node).toBeGreaterThan(0);
    expect(send(s => s.spots.findIndex(x => x.at === 'node' && x.id === road[1]), 3)).toBe(true);
    expect(w.cities[3].objects.slots.some(o => o.type === 17 && o.node > 0)).toBe(true);
    expect(g.objects.slots[mine].node).toBe(0);
    expect(send(s => s.spots.findIndex(x => x.at === 'actor' && x.id === q.id), 4)).toBe(true);
    expect(q.map).toBe(4);
    expect(w.cities[4].board.nodes.find(n => n.id === q.node)?.adjacent.some(Boolean)).toBe(true);
    expect(me.map).toBe(0);
  });
});
