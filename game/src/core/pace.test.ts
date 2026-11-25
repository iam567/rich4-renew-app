/**
 * 遊戲節奏 (the user 2026-11-23, docs/rules/36; core/game.ts PACE): 慢節奏 the 物價指數 by the fund × 2 and 資產清算
 * before bankruptcy, 快節奏 by the fund × 0.5 and the prices × 1.2, 原版 the game exactly as before.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBoard, type RawMap } from './board';
import { pack } from './date';
import { Game, LIQUIDATE_RENT, paceOf } from './game';
import { loadGame, saveGame } from './save';
import type { GameSettings, Step } from './types';

const mapFile = fileURLToPath(new URL('../../../editor/site/assets/map-2.json', import.meta.url));
const have = existsSync(mapFile);
const raw = () => JSON.parse(readFileSync(mapFile, 'utf8')) as RawMap;
const settings = (s: Partial<GameSettings> = {}): GameSettings => ({ mapId: 2, players: [0, 4, 9, 11].map(character => ({ character, human: false })), fundIndex: 1,
  traffic: 0, landLimitIndex: 0, daysLimitIndex: 0, victoryIndex: 0, startDate: pack(2026, 11, 23), seed: 31, ...s });
const run = (flow: Generator<Step, unknown, unknown>) => { const said: string[] = []; for (let r = flow.next(); !r.done; r = flow.next()) { const v = r.value as { t: string; text?: string }; if (v.t === 'say' && v.text) said.push(v.text); } return said; };

describe('遊戲節奏 in force', () => {
  it('慢 / 快 as set; 原版 for none, 1, 挑戰模式, 大富豪模式 and a room with an older phone', () => {
    expect(paceOf(settings({ pace: 0 }))).toBe(0);
    expect(paceOf(settings({ pace: 2 }))).toBe(2);
    expect(paceOf(settings())).toBe(1);
    expect(paceOf(settings({ pace: 1 }))).toBe(1);
    expect(paceOf(settings({ pace: 2, challenge: true }))).toBe(1);
    expect(paceOf(settings({ pace: 2 }), true)).toBe(1);
    expect(paceOf(settings({ pace: 2, party: true, level: '1.2.5' }))).toBe(1);
    expect(paceOf(settings({ pace: 2, party: true, level: '1.3.0' }))).toBe(2);
  });
});

describe.skipIf(!have)('遊戲節奏 rules', () => {
  it('慢: the street tolls and big plot fees × 0.6 (原版 and 快 as ever)', () => {
    expect(new Game(settings({ pace: 0 }), parseBoard(raw())).tollBoost()).toBe(0.6);
    expect(new Game(settings(), parseBoard(raw())).tollBoost()).toBe(1);
    expect(new Game(settings({ pace: 2 }), parseBoard(raw())).tollBoost()).toBe(1);
  });
  it('原版 (pace 1) plays exactly as a game without the field', () => {
    const play = (s: GameSettings) => {
      const g = new Game(s, parseBoard(raw()));
      g.animation = false;
      const f = g.run();
      for (let r = f.next(), n = 0; !r.done && g.daysElapsed < 200; r = f.next(), n++);
      const { settings: _s, savedAt: _t, ...rest } = saveGame(g);
      return JSON.stringify(rest);
    };
    expect(play(settings({ pace: 1 }))).toBe(play(settings()));
  });

  it('the 物價指數: 原版 avg ÷ fund, 慢 ÷ (fund × 2), 快 ÷ (fund × 0.5); only rising', () => {
    const at = (pace: 0 | 1 | 2 | undefined, k: number) => {
      const g = new Game(settings(pace === undefined ? {} : { pace }), parseBoard(raw()));
      g.players.forEach(p => { p.placed = true; p.whoPlays = 2; p.cash = 0; p.bank = Math.trunc(g.fund * k); });
      g.updatePriceIndex();
      return g.priceIndex;
    };
    expect([at(undefined, 1), at(undefined, 2.5), at(undefined, 4)]).toEqual([1, 2, 4]);
    expect([at(0, 1), at(0, 2.5), at(0, 4), at(0, 6)]).toEqual([1, 1, 2, 3]);
    expect([at(2, 0.4), at(2, 1), at(2, 2.5)]).toEqual([1, 2, 5]);
  });

  it('快: the prices and building costs × 1.2, the tolls as they were; a save keeps them, not ×1.2 again', () => {
    const map = parseBoard(raw()), g = new Game(settings({ pace: 2 }), map);
    const l = g.board.lands.find(x => !x.chain)!, m = map.lands[l.id - 1], f = g.board.facilities[0], mf = map.facilities[0];
    expect(l.price).toBe(Math.round(m.price * 1.2 / 10) * 10);
    expect(l.perLevel).toBe(Math.round(m.perLevel * 1.2 / 10) * 10);
    expect(l.tolls).toEqual(m.tolls);
    expect(f.price).toBe(Math.round(mf.price * 1.2 / 10) * 10);
    expect(f.fees.slice(1)).toEqual(mf.fees.slice(1));
    const back = loadGame(JSON.parse(JSON.stringify(saveGame(g))));
    expect(back.board.lands[l.id - 1].price).toBe(l.price);
    expect(back.pace).toBe(2);
    // 原版 and 慢: the map's prices
    expect(new Game(settings({ pace: 0 }), map).board.lands[l.id - 1].price).toBe(m.price);
    expect(new Game(settings(), map).board.lands[l.id - 1].price).toBe(m.price);
  });

  it('慢: short of money, everything is sold (LIQUIDATE_RENT × the toll, shares at the price) into the deposit, the debt paid, not bankrupt', () => {
    const g = new Game(settings({ pace: 0 }), parseBoard(raw()));
    g.players.forEach(q => { q.placed = true; q.whoPlays = 2; q.cash = 1000; q.bank = 0; });
    g.priceIndex = 2;
    const p = g.players[0], [a, b] = g.board.lands.filter(x => !x.chain);
    a.owner = 1; b.owner = 1; b.level = 3;
    const f = g.board.facilities[0];
    f.owner = 1;
    const slot = g.stocks.stocks.findIndex(s => s.price > 0);
    g.stocks.holdings[0][slot].shares = 100;
    const shares = Math.trunc(100 * g.stocks.stocks[slot].price);
    const got = LIQUIDATE_RENT * (a.tolls[0] + b.tolls[3] + (f.fees[Math.max(1, f.level)] ?? 0)) * 2 + shares;
    const said = run(g.transfer(0, 1, 3000, 0, '過路費'));
    expect(p.bankrupt).toBe(false);
    expect(g.board.lands.some(x => x.owner === 1) || g.board.facilities.some(x => x.owner === 1)).toBe(false);
    expect(b.level).toBe(3); // the houses stay, nobody's
    expect(g.stocks.holdings[0][slot].shares).toBe(0);
    expect(p.cash).toBe(0);
    expect(p.bank).toBe(1000 + got - 3000);
    expect(g.players[1].bank).toBe(3000);
    expect(said.some(t => t.includes(`資產清算：賣掉3處房地產和股票，得${got.toLocaleString('en-US')}元存入銀行`))).toBe(true);
  });

  it('慢: still short after selling, or nothing to sell: bankrupt; 原版: bankrupt with no selling', () => {
    const mk = (pace?: 0) => { const g = new Game(settings(pace === 0 ? { pace } : {}), parseBoard(raw())); g.players.forEach(q => { q.placed = true; q.whoPlays = 2; q.cash = 1000; q.bank = 0; }); return g; };
    const g = mk(0);
    g.board.lands[0].owner = 1;
    run(g.transfer(0, 1, 10_000_000, 0, 'x'));
    expect(g.players[0].bankrupt).toBe(true);
    const h = mk(0);
    expect(run(h.transfer(0, 1, 3000, 0, 'x')).some(t => t.includes('資產清算'))).toBe(false);
    expect(h.players[0].bankrupt).toBe(true);
    const o = mk();
    o.board.lands[0].owner = 1;
    expect(run(o.transfer(0, 1, 3000, 0, 'x')).some(t => t.includes('資產清算'))).toBe(false);
    expect(o.players[0].bankrupt).toBe(true);
  });
});
