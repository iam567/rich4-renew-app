import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBoard, type Board, type RawMap } from './board';
import { Game } from './game';
import { pack } from './date';
import { loadGame, saveGame, type SaveData } from './save';
import { STOCK_TABLE } from './modules/stocks';
import type { GameSettings } from './types';

// The remake's five Japanese cities run on the Japan slot (its stock table's numbers and the Japan map's 6 company
// records) but each names its 12 stocks and 6 companies after local firms (editor/city_companies.py, 03 §2.4).
const dir = '../../../editor/site/assets/remake/';
const raw = (key: string): RawMap => JSON.parse(readFileSync(fileURLToPath(new URL(`${dir}${key}.json`, import.meta.url)), 'utf8')) as RawMap;
const CITIES = { tokyo: 100, osaka: 101, sapporo: 102, kyushu: 103, okinawa: 104 } as const;
const have = Object.keys(CITIES).every(k => existsSync(fileURLToPath(new URL(`${dir}${k}.json`, import.meta.url))));
const japanFile = fileURLToPath(new URL('../../../editor/site/assets/map-2.json', import.meta.url));
const JAPAN = STOCK_TABLE[2];

function settings(mapId: number, seed: number): GameSettings {
  return {
    mapId, players: [1, 3, 6, 10].map(character => ({ character, human: false })),
    fundIndex: 1, traffic: 0, landLimitIndex: 0, daysLimitIndex: 0, victoryIndex: 0, startDate: pack(2026, 10, 16), seed,
  };
}

describe.skipIf(!have)('local companies of the remake cities', () => {
  const boards = Object.fromEntries(Object.keys(CITIES).map(k => [k, parseBoard(raw(k))])) as Record<keyof typeof CITIES, Board>;

  it('each city has its own 12 stock names, none shared with another city', () => {
    const seen = new Map<string, string>();
    for (const [key, b] of Object.entries(boards)) {
      expect(b.mapId, key).toBe(2);
      expect(b.stockNames, key).toHaveLength(12);
      for (const n of b.stockNames!) {
        expect(seen.get(n), `${n} in ${key}`).toBeUndefined();
        seen.set(n, key);
      }
    }
    expect(seen.size).toBe(60);
    // Not the Japan set: at most the few Tokyo firms the Japan table already had (三越百貨, ＳＥＧＡ …) stay.
    for (const [key, b] of Object.entries(boards)) {
      const same = b.stockNames!.filter((n, i) => n === JAPAN[i].name).length;
      expect(same, key).toBeLessThanOrEqual(key === 'tokyo' ? 4 : 0);
    }
  });

  it('companies keep the Japan records (category, slot, fee, value) and take their slot\'s stock name', () => {
    const japan = parseBoard(JSON.parse(readFileSync(japanFile, 'utf8')) as RawMap);
    const sig = (b: Board) => b.companies.map(c => [c.stockSlot, c.category, c.baseFee, c.value].join('/')).sort();
    for (const [key, b] of Object.entries(boards)) {
      expect(sig(b), key).toEqual(sig(japan));
      for (const c of b.companies) expect(c.name, `${key} slot ${c.stockSlot}`).toBe(b.stockNames![c.stockSlot]);
      expect(b.companies.find(c => c.category === 7)?.name, `${key} bank`).toMatch(/銀行$/);
    }
  });

  it('a new game shows the city\'s names in the stock market and companies, with the table\'s numbers', () => {
    for (const [key, mapId] of Object.entries(CITIES)) {
      const b = boards[key as keyof typeof CITIES];
      const g = new Game(settings(mapId, 7), parseBoard(raw(key)));
      expect(g.stocks.stocks.map(s => s.name), key).toEqual(b.stockNames);
      g.stocks.stocks.forEach((s, i) => {
        expect(s.basePrice, `${key} ${s.name}`).toBe(Math.fround(JAPAN[i].price));
        expect(s.volatility).toBe(Math.fround(JAPAN[i].vol));
        expect(!!s.companyId).toBe(JAPAN[i].linked);
        // every linked stock is linked to the company of its own name (no fall-back to company 1, 03 §3.1)
        if (s.companyId) expect(g.stocks.companyOf(i)?.name).toBe(s.name);
      });
    }
  });

  it('the original maps keep the stock table\'s names', () => {
    const japan = parseBoard(JSON.parse(readFileSync(japanFile, 'utf8')) as RawMap);
    expect(japan.stockNames).toBeUndefined();
    const g = new Game(settings(2, 3), japan);
    expect(g.stocks.stocks.map(s => s.name)).toEqual(JAPAN.map(s => s.name));
  });

  it('saves and loads across a game on every city; an old save (Japan names) takes the city\'s names when loaded', () => {
    for (const [key, mapId] of Object.entries(CITIES)) {
      const b = boards[key as keyof typeof CITIES];
      const game = new Game(settings(mapId, 41), parseBoard(raw(key)));
      const flow = game.run();
      let checked = false;
      for (let r = flow.next(); !r.done && game.daysElapsed < 80 && !checked; r = flow.next()) {
        const s = r.value;
        if ('ask' in s) throw new Error('computer players never ask');
        if (game.daysElapsed >= 60 && s.t === 'turn') {
          checked = true;
          const data = JSON.parse(JSON.stringify(saveGame(game))) as SaveData;
          const copy = loadGame(data, parseBoard(raw(key)));
          expect(copy.stocks.stocks, key).toEqual(game.stocks.stocks);
          expect(copy.stocks.holdings).toEqual(game.stocks.holdings);
          expect(copy.board.companies).toEqual(game.board.companies);
          expect(copy.stocks.stocks.map(x => x.name)).toEqual(b.stockNames);
          // the game goes on from the loaded copy
          const f2 = copy.run();
          for (let i = 0, r2 = f2.next(); i < 200 && !r2.done; i++, r2 = f2.next()) if ('ask' in r2.value) throw new Error('ask');
          // A save made before the city had its own names: the Japan names in the stocks and the board.
          const old = JSON.parse(JSON.stringify(data)) as SaveData;
          delete old.board.stockNames;
          (old.modules.stocks.stocks as { name: string }[]).forEach((x, i) => { x.name = JAPAN[i].name; });
          old.board.companies.forEach(c => { c.name = JAPAN[c.stockSlot].name; });
          const plain = loadGame(JSON.parse(JSON.stringify(old)) as SaveData);
          expect(plain.stocks.stocks[0].name).toBe('富士銀行');
          const renamed = loadGame(JSON.parse(JSON.stringify(old)) as SaveData, parseBoard(raw(key)));
          expect(renamed.stocks.stocks.map(x => x.name)).toEqual(b.stockNames);
          expect(renamed.board.companies.map(c => c.name)).toEqual(b.companies.map(c => c.name));
          expect(renamed.board.stockNames).toEqual(b.stockNames);
          // state by slot is untouched
          expect(renamed.stocks.stocks.map(x => x.price)).toEqual(game.stocks.stocks.map(x => x.price));
          expect(renamed.stocks.holdings).toEqual(game.stocks.holdings);
          expect(renamed.board.companies.map(c => [c.controller, c.fundA, c.fundB, c.freeShares]))
            .toEqual(game.board.companies.map(c => [c.controller, c.fundA, c.fundB, c.freeShares]));
        }
      }
      expect(checked, key).toBe(true);
    }
  });

  it('a save is not renamed by a map with other company records', () => {
    const game = new Game(settings(101, 5), parseBoard(raw('osaka')));
    const data = JSON.parse(JSON.stringify(saveGame(game))) as SaveData;
    const other = parseBoard(raw('osaka'));
    other.companies[0].category = 1;
    other.companies.forEach(c => { c.name = 'X'; });
    const g = loadGame(data, other);
    expect(g.board.companies.map(c => c.name)).toEqual(game.board.companies.map(c => c.name));
  });
});
