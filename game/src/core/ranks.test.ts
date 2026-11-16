import { describe, expect, it } from 'vitest';
import { Game } from './game';
import { parseBoard } from './board';
import { pack } from './date';
import { mapKey, notRanked, scores } from './ranks';
import { attachLedger, ledgerOf } from './stats';
import type { GameSettings } from './types';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const raw = JSON.parse(readFileSync(fileURLToPath(new URL('../../../editor/site/assets/map-0.json', import.meta.url)), 'utf8'));
const game = (s: Partial<GameSettings> = {}, humans = 1, n = 4) => {
  const g = new Game({ mapId: 0, players: Array.from({ length: n }, (_, i) => ({ character: i, human: i < humans })), fundIndex: 1, traffic: 0,
    landLimitIndex: 0, daysLimitIndex: 0, victoryIndex: 0, startDate: pack(2026, 1, 1), seed: 5, aiLevel: 3, ...s } as GameSettings, parseBoard(raw));
  attachLedger(g.players);
  return g;
};
const broke = (g: Game) => { g.players.forEach(p => { if (!p.human) p.bankrupt = true; }); return g; };

// 排行榜 (the user 2026-11-16): one human, three computers, all broke — nothing else ranks.
describe('排行榜 who ranks', () => {
  it('one human beating three computers ranks on the map m0', () => {
    const g = broke(game());
    expect(notRanked(g, 0)).toBe('');
    expect(mapKey(g)).toBe('m0');
  });
  it('not two humans, not two computers, not a computer standing, not 派對 / 試玩 / 挑戰', () => {
    expect(notRanked(broke(game({}, 2)), 0)).toBe('players');
    expect(notRanked(broke(game({}, 1, 3)), 0)).toBe('players');
    expect(notRanked(game(), 0)).toBe('not all broke');
    expect(notRanked(broke(game({ party: true })), 0)).toBe('mode');
    expect(notRanked(broke(game({ trial: true })), 0)).toBe('mode');
    expect(notRanked(broke(game({ challenge: true })), 0)).toBe('challenge');
    expect(notRanked(broke(game()), 1)).toBe('lost');
  });
  it("no player's map ranks, 創作樂園's neither (the user 2026-11-16)", () => {
    expect(notRanked(broke(game({ myMap: { name: 'x', id: 'abc' } as never })), 0)).toBe('own map');
    expect(notRanked(broke(game({ myMap: { name: 'x', id: 'lib-abcd1234' } as never })), 0)).toBe('own map');
  });
  it('狠分 and 慘分 from the ledger', () => {
    const g = game(), x = ledgerOf(g.players)!.of(0);
    x.rivalsBankrupted = 3; x.cardsUsed = { 17: 2, 20: 5 }; x.toolsUsed = { 2: 1, 8: 4 }; x.gods = { 1: 1, 5: 2 }; x.lucky = 4; x.unlucky = 6;
    x.tollsReceived = 55000; x.tollsPaid = 21000; x.attacked = 3; x.hospitalDays = 2; x.prisonDays = 1;
    // 狠: 300 + 陷害 2×20 (免費卡 is no attack) + 路障 15 (遙控骰子 is none) + 財神 30 + 4×5 + 5
    // 慘: 窮神 2×30 + 3×20 + 3 days ×3 + 6×5 + 2
    expect(scores(x)).toEqual({ fierce: 300 + 40 + 15 + 30 + 20 + 5, woe: 60 + 60 + 9 + 30 + 2 });
  });
});

describe('排行榜 hostile lists', () => {
  it('match the card table (f7 > 0)', async () => {
    const { CARDS } = await import('./modules/cards');
    expect(CARDS.filter(c => c.f7 > 0).map(c => c.id)).toEqual([1, 2, 3, 8, 10, 11, 12, 13, 15, 16, 17, 25, 26, 28]);
  });
});
