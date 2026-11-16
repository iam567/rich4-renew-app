import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBoard, type RawMap } from './board';
import { pack } from './date';
import { Game } from './game';
import { adoptMapNames, loadGame, saveGame } from './save';
import { HOTEL_STOCK } from './modules/stocks';
import type { Step } from './types';

// ＨＯＴＥＬ１１ (the user 2026-11-07): in 派對模式 a stock no company points to becomes the hotels' alliance; its
// 董事長 stays at the others' hotels as anyone but pays nothing.
const assets = fileURLToPath(new URL('../../../editor/site/assets/', import.meta.url));
const tokyo = `${assets}remake/tokyo.json`;
const have = existsSync(tokyo);

function setup(party = true, file = tokyo, mapId = 100) {
  const g = new Game({ mapId, players: [0, 4, 9, 11].map(character => ({ character, human: false })), fundIndex: 1, traffic: 0, landLimitIndex: 0,
    daysLimitIndex: 0, victoryIndex: 0, startDate: pack(2026, 10, 18), seed: 7, ...(party ? { party: true } : {}) }, parseBoard(JSON.parse(readFileSync(file, 'utf8')) as RawMap));
  for (const q of g.players) { q.placed = true; q.whoPlays = 2; q.cash = 500000; q.cards = []; }
  return g;
}
const run = (flow: Generator<Step, unknown, unknown>) => { const out: Step[] = []; let r = flow.next(); while (!r.done) { out.push(r.value as Step); r = flow.next(); } return out; };
const land = (g: Game, p: Game['players'][number]) => run((g as unknown as { land(q: unknown): Generator<Step, unknown, unknown> }).land(p));
const give = (g: Game, k: number, n: number) => { g.stocks.holdings[k][g.stocks.hotelSlot].shares += n; g.stocks.rerank(k, g.stocks.hotelSlot); };

describe.skipIf(!have)('ＨＯＴＥＬ１１', () => {
  it('only in 派對模式: a slot no company points to, renamed and unlinked', () => {
    const g = setup(), slot = g.stocks.hotelSlot;
    expect(slot).toBeGreaterThanOrEqual(0);
    expect(g.board.companies.some(c => c.stockSlot === slot)).toBe(false);
    expect(g.stocks.stocks[slot]).toMatchObject({ name: HOTEL_STOCK.name, companyId: 0, price: HOTEL_STOCK.price });
    const solo = setup(false);
    expect(solo.stocks.hotelSlot).toBe(-1);
    expect(solo.stocks.stocks.some(s => s.name === HOTEL_STOCK.name)).toBe(false);
  });

  it('every map but one whose twelve stocks all have companies has the slot', () => {
    const files = [
      ...readdirSync(assets).filter(f => /^map-\d\.json$/.test(f)).map(f => [assets + f, +f.slice(4, 5)] as const),
      ...readdirSync(`${assets}remake`).filter(f => /^(tokyo|osaka|sapporo|kyushu|okinawa|kabukicho|jiqing)\.json$/.test(f)).map(f => [`${assets}remake/${f}`, 100] as const),
    ];
    const none: string[] = [];
    for (const [f, id] of files) { const g = setup(true, f, id); if (g.stocks.hotelSlot < 0) none.push(f.split('/').pop()!); else expect(g.stocks.stocks[g.stocks.hotelSlot].name).toBe(HOTEL_STOCK.name); }
    expect(none).toEqual(['map-5.json']);   // 武俠: all twelve are its companies' (the sects)
  });

  it('董事長: the largest holder; a tie keeps the one there; selling all hands it on', () => {
    const g = setup(), [a, b] = g.players;
    give(g, 1, 100);
    expect(g.stocks.isHotelBoss(b)).toBe(true);
    give(g, 0, 100);
    expect(g.stocks.isHotelBoss(b)).toBe(true);
    give(g, 0, 1);
    expect([g.stocks.isHotelBoss(a), g.stocks.isHotelBoss(b)]).toEqual([true, false]);
    g.stocks.sell(a, g.stocks.hotelSlot, 101, true);
    expect(g.stocks.isHotelBoss(b)).toBe(true);
  });

  it('the 董事長 stays at another player\'s 旅館 and pays nothing; anyone else pays', () => {
    const g = setup(), f = g.board.facilities[0], node = g.board.nodes.find(n => n.ref === f.id + 4000)!;
    f.owner = 1; f.type = 1; f.level = 5;
    const guest = g.players[1], other = g.players[2];
    give(g, 1, 50);
    guest.node = node.id;
    const cash = guest.cash + guest.bank;
    const out = land(g, guest);
    expect(out.some(s => s.t === 'say' && /歡迎董事長光臨本酒店/.test(String((s as { text?: string }).text)))).toBe(true);
    expect(out.some(s => s.t === 'pay' && s.from === guest.id)).toBe(false);
    expect(guest.cash + guest.bank).toBe(cash);
    expect(guest.hotel).toBeGreaterThan(0);
    other.node = node.id;
    const out2 = land(g, other);
    expect(out2.some(s => s.t === 'pay' && s.from === other.id)).toBe(true);
    expect(other.hotel).toBeGreaterThan(0);
  });

  it('kept by a save, its name too when the map names its stocks', () => {
    const g = setup();
    give(g, 2, 10);
    const h = loadGame(saveGame(g));
    expect([h.stocks.hotelSlot, h.stocks.hotelBoss]).toEqual([g.stocks.hotelSlot, 3]);
    adoptMapNames(h, parseBoard(JSON.parse(readFileSync(tokyo, 'utf8')) as RawMap));
    expect(h.stocks.stocks[h.stocks.hotelSlot].name).toBe(HOTEL_STOCK.name);
  });
});
