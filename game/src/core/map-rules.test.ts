/** 自建地圖's rule switches (GameSettings.mapRules, the user 2026-11-12): each holds through a whole game of computers. */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBoard, type RawMap } from './board';
import { pack, weekday } from './date';
import { Game } from './game';
import { GODS, OBJ } from './modules/objects';
import type { GameEvent, MapSwitches } from './types';

const mapFile = (id: number) => fileURLToPath(new URL(`../../../editor/site/assets/map-${id}.json`, import.meta.url));

function play(sw: MapSwitches, days = 200, seed = 3) {
  const g = new Game({ mapId: 1, players: [0, 4, 9, 11].map(c => ({ character: c, human: false })), fundIndex: 1, traffic: 0, landLimitIndex: 0, daysLimitIndex: 0, victoryIndex: 0,
    startDate: pack(2026, 1, 1), seed, mapRules: sw }, parseBoard(JSON.parse(readFileSync(mapFile(1), 'utf8')) as RawMap));
  const seen = { gods: 0, chests: 0, shares: 0, weekendBank: 0, loans: 0 };
  const flow = g.run();
  for (let r = flow.next(), n = 0; !r.done && g.daysElapsed < days && !g.over && n < 3_000_000; r = flow.next(), n++) {
    const e = r.value as GameEvent;
    if ('ask' in e) throw new Error('a question for a computer');
    for (const o of g.objects.slots) if (o.node) { if (GODS.has(o.type)) seen.gods++; if (o.type === OBJ.Gift || o.type === OBJ.Chest) seen.chests++; }
    for (const h of g.stocks.holdings) for (const x of h) seen.shares += x.shares;
    for (const p of g.players) if (p.loan) seen.loans++;
  }
  return seen;
}

describe.skipIf(!existsSync(mapFile(1)))('自建地圖 特殊規則', () => {
  it('with none, gods, chests and shares turn up as ever', () => {
    const s = play({});
    expect(s.gods).toBeGreaterThan(0);
    expect(s.chests).toBeGreaterThan(0);
    expect(s.shares).toBeGreaterThan(0);
  });
  it('沒有神仙 / 沒有禮物寶箱 / 不能炒股', () => {
    const s = play({ noGods: true, noChests: true, noStocks: true, noLoans: true });
    expect(s).toMatchObject({ gods: 0, chests: 0, shares: 0 }); // (a loan may still come by the 冒名貸款 fate: not the bank's lending)
  });
  it('假日銀行不開門: closed on Saturday and Sunday only', () => {
    const g = new Game({ mapId: 1, players: [0, 4].map(c => ({ character: c, human: false })), fundIndex: 1, traffic: 0, landLimitIndex: 0, daysLimitIndex: 0, victoryIndex: 0,
      startDate: pack(2026, 11, 14), seed: 1, mapRules: { bankHoliday: true } }, parseBoard(JSON.parse(readFileSync(mapFile(1), 'utf8')) as RawMap));
    expect(weekday(g.date)).toBe(6);
    expect(g.bankClosed()).toBe(true);
    g.date = pack(2026, 11, 16);
    expect(g.bankClosed()).toBe(false);
  });
});
