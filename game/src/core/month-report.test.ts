import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBoard, type RawMap } from './board';
import { pack } from './date';
import type { Flow } from './flow';
import { Game, type MonthReport } from './game';
import type { GameEvent, GameSettings } from './types';

const mapFile = (id: number) => fileURLToPath(new URL(`../../../editor/site/assets/map-${id}.json`, import.meta.url));
const haveMaps = existsSync(mapFile(1));

/** Four placed players on map 1, the day before a new month, no money and no land. */
function newGame(date = pack(2026, 10, 31)): Game {
  const board = parseBoard(JSON.parse(readFileSync(mapFile(1), 'utf8')) as RawMap);
  const players = [0, 4, 9, 6].map((character, i) => ({ character, human: i === 0 }));
  const settings: GameSettings = {
    mapId: 1, players, fundIndex: 1, traffic: 0, landLimitIndex: 0, daysLimitIndex: 0, victoryIndex: 0, startDate: date, seed: 1,
  };
  const g = new Game(settings, board);
  const road = g.board.nodes.find(n => n.event === 1 || (n.event === 0 && !n.ref))!;
  for (const p of g.players) {
    p.placed = true; p.whoPlays = p.human ? 1 : 2;
    p.node = road.id; p.lastNode = road.adjacent.find(Boolean)!;
    p.cash = 0; p.bank = 0;
  }
  for (const o of g.objects.slots) o.node = 0;
  return g;
}

function settle(g: Game): GameEvent[] {
  const flow = (g as unknown as { dailySettlement(): Flow }).dailySettlement();
  const events: GameEvent[] = [];
  for (let r = flow.next(); !r.done; r = flow.next()) if (!('ask' in r.value)) events.push(r.value);
  return events;
}
const reportOf = (events: GameEvent[]) =>
  events.flatMap(e => (e.t === 'fx' && e.kind === 'month-report' ? [e.data as unknown as MonthReport] : []));

describe.skipIf(!haveMaps)('monthly bank report fcn_00439bfa (02 §8.5, 09 §7.12)', () => {
  it('only on the first of a month: one report per living player, figures before and after the 10%', () => {
    const g = newGame(pack(2026, 10, 30));
    expect(reportOf(settle(g))).toHaveLength(0);
    const [a, b, c, d] = g.players;
    a.bank = 12345; b.bank = 50000; b.loan = 20000; c.bank = 7; d.whoPlays = 0; d.bankrupt = true; d.bank = 900;
    const events = settle(g);
    const [rep] = reportOf(events);
    expect(rep.rows).toEqual([
      { p: 0, character: 0, bank: 12345, loan: false, interest: 1234, after: 13579 },
      { p: 1, character: 4, bank: 50000, loan: true, interest: 0, after: 50000 },
      { p: 2, character: 9, bank: 7, loan: false, interest: 0, after: 7 },
    ]);
    // The rule is unchanged: trunc(bank × 1.1) without a loan, nothing with one, nothing for the bankrupt.
    expect([a.bank, b.bank, c.bank, d.bank]).toEqual([13579, 50000, 7, 900]);
    expect(rep.animation).toBe(true);
    // Shown after the day's stock update and before the month's object moves / board redraw.
    const at = events.findIndex(e => e.t === 'fx' && e.kind === 'month-report');
    expect(events.findIndex(e => e.t === 'day')).toBeLessThan(at);
    expect(events.findIndex(e => e.t === 'board')).toBeGreaterThan(at);
  });

  it('本月冠軍 is the richest after the interest (first of equals); the board shows cash, deposit and total', () => {
    const g = newGame();
    const [a, b, c] = g.players;
    a.cash = 100000; b.bank = 100000; c.cash = 109000;
    const [rep] = reportOf(settle(g));
    expect(rep.champion).toBe(1); // 100000 × 1.1 = 110000 > 109000
    expect(rep.championStats).toEqual({ cash: 0, bank: 110000, wealth: 110000 });
    const h = newGame();
    const [rep2] = reportOf(settle(h));
    expect(rep2.champion).toBe(0); // nobody has anything: the first player
  });

  it('本月悲情人物: loss − windfall + bad days × PI × 2500 + bad luck × 10, the lead over the runner-up above 40%', () => {
    const g = newGame();
    const [a, b, c, d] = g.players;
    a.monthLoss = 30000; a.monthGain = 5000; // 25000
    b.monthBadDays = 4; // 10000
    c.monthLoss = 1000; d.luckBad = 50; // 1000, 500
    const [rep] = reportOf(settle(g));
    expect(rep.unlucky).toBe(0); // (25000 − 10000) / 25000 = 0.6
    expect(rep.unluckyStats).toEqual({ loss: 30000, gain: 5000, badDays: 0 });
    // The monthly counters are cleared after the report.
    expect([a.monthLoss, a.monthGain, b.monthBadDays]).toEqual([0, 0, 0]);
  });

  it('no 悲情人物 when the lead is 40% or less, when only one player scored, or when nobody did', () => {
    const close = newGame();
    close.players[0].monthLoss = 10000; close.players[1].monthLoss = 6000; // 0.4: not above
    expect(reportOf(settle(close))[0].unlucky).toBe(-1);
    const alone = newGame();
    alone.players[2].monthLoss = 50000;
    expect(reportOf(settle(alone))[0].unlucky).toBe(-1);
    expect(reportOf(settle(newGame()))[0].unlucky).toBe(-1);
    // Players tied at the top drop out of the runner-up: the third decides, the first of the tied is named.
    const tie = newGame();
    tie.players[1].monthLoss = 9000; tie.players[2].monthLoss = 9000; tie.players[3].monthLoss = 1000;
    const [rep] = reportOf(settle(tie));
    expect(rep.unlucky).toBe(1);
    expect(rep.unluckyStats).toEqual({ loss: 9000, gain: 0, badDays: 0 });
  });

  it('carries the 動畫過程 setting: off, the screen shows only the deposits', () => {
    const g = newGame();
    g.animation = false;
    expect(reportOf(settle(g))[0].animation).toBe(false);
  });
});
