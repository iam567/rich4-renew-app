import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBoard, type RawMap } from './board';
import { Challenge } from './challenge';
import { pack } from './date';
import { Game, type Flow } from './game';
import { MONTHLY_TASKS, monthlyPool } from './monthly';
import { attachLedger } from './stats';
import type { GameEvent, GameSettings } from './types';

const mapFile = (id: number) => fileURLToPath(new URL(`../../../editor/site/assets/map-${id}.json`, import.meta.url));

/** A four-computer challenge game on map 2 with `card` as every month's card, played to day 3 (everyone on the board). */
function start(card: string): { g: Game; flow: Flow } {
  Challenge.forceMonthly = card;
  const settings: GameSettings = {
    mapId: 2, players: [0, 4, 9, 11].map(character => ({ character, human: false })),
    fundIndex: 1, traffic: 0, landLimitIndex: 0, daysLimitIndex: 0, victoryIndex: 0, startDate: pack(2026, 1, 1), seed: 5, challenge: true, challengeYears: 1,
  };
  const g = new Game(settings, parseBoard(JSON.parse(readFileSync(mapFile(2), 'utf8')) as RawMap));
  attachLedger(g.players);
  const flow: Flow = g.run();
  for (let r = flow.next(); !r.done && g.daysElapsed < 3; r = flow.next()) if ('ask' in r.value) throw new Error('question');
  return { g, flow };
}
/** The same, this month's counters back to nothing (what the first days' play did is forgotten). */
const game = (card: string) => {
  const g = start(card).g, c = g.challengeTracker!, m = c.month!;
  m.mo = g.players.map(() => ({})); m.won = []; m.done = false; c.monthStars = g.players.map(() => 0);
  return g;
};
/** Plays on until the month's card changes. */
function nextMonth(g: Game, flow: Flow) {
  const seq = g.challengeTracker!.month!.seq;
  for (let r = flow.next(); !r.done && g.challengeTracker!.month!.seq === seq; r = flow.next()) if ('ask' in r.value) throw new Error('question');
  return seq;
}
const see = (g: Game, ...es: GameEvent[]) => es.forEach(e => g.challengeTracker!.see(e));
const fx = (kind: string, p: number, data: Record<string, unknown> = {}): GameEvent => ({ t: 'fx', kind, p, data } as GameEvent);
const toll = (from: number, to: number): GameEvent => ({ t: 'pay', from, to, amount: 100, reason: '過路費' });

afterEach(() => { Challenge.forceMonthly = ''; });

describe('每月任務 cards', () => {
  it('every card has a name, words and a measure; 100 of them, ids unique', () => {
    expect(MONTHLY_TASKS.length).toBe(100);
    expect(new Set(MONTHLY_TASKS.map(t => t.id)).size).toBe(100);
    for (const t of MONTHLY_TASKS) { expect(t.name && t.desc && typeof t.v === 'function').toBeTruthy(); expect(t.desc.includes('{n}') || t.kind !== 'race' || t.goal <= 1).toBe(true); }
  });
});

describe.skipIf(!existsSync(mapFile(2)))('每月任務 measures', () => {
  it('全員收押: every rival sent to prison by the player on turn; a news sending someone in does not count', () => {
    const g = game('M026'), c = g.challengeTracker!;
    see(g, { t: 'turn', p: 0 }, fx('to-prison', 1), fx('to-prison', 2));
    expect(c.month!.done).toBe(false);
    see(g, fx('news', 0, { id: 1 }), fx('to-prison', 3));
    expect(c.month!.done).toBe(false);
    see(g, { t: 'turn', p: 1 }, { t: 'turn', p: 0 }, fx('to-prison', 3));
    expect(c.month!.won).toEqual([0]);
    expect(c.monthStars[0]).toBe(3);
  });

  it('雨露均霑 / 路霸 / 雙喜臨門: tolls by payer and by day', () => {
    let g = game('M029');
    see(g, toll(1, 0), toll(2, 0));
    expect(g.challengeTracker!.month!.done).toBe(false);
    see(g, toll(3, 0));
    expect(g.challengeTracker!.month!.won).toEqual([0]);
    g = game('M065');
    see(g, toll(1, 0), toll(2, 0), toll(1, 0));
    expect(g.challengeTracker!.month!.done).toBe(false);
    see(g, toll(1, 0));
    expect(g.challengeTracker!.month!.won).toEqual([0]);
    g = game('M067');
    see(g, toll(1, 2), toll(3, 2));
    expect(g.challengeTracker!.month!.won).toEqual([2]);
  });

  it('遠行 / 骰神: steps and pips this month', () => {
    let g = game('M053');
    for (let i = 0; i < 119; i++) see(g, { t: 'step', p: 1, from: 0, to: 0, dir: 1, left: 1 });
    see(g, { t: 'dice', p: 1, values: [1] });
    expect(g.challengeTracker!.month!.done).toBe(false);
    see(g, { t: 'step', p: 1, from: 0, to: 0, dir: 1, left: 1 }, { t: 'dice', p: 1, values: [1] });
    expect(g.challengeTracker!.month!.won).toEqual([1]);
    g = game('M054');
    for (let i = 0; i < 17; i++) see(g, { t: 'dice', p: 3, values: [6] });
    expect(g.challengeTracker!.monthValue(g.players[3])).toBeGreaterThanOrEqual(102);
    expect(g.challengeTracker!.month!.won).toContain(3);
  });

  it('a month ends on the 1st: the card goes into the log and a new month starts', () => {
    const { g, flow } = start('M046'), c = g.challengeTracker!;
    const seq = nextMonth(g, flow);
    expect(c.monthLog.at(-1)!.seq).toBe(seq);
    expect(c.month!.seq).toBe(seq + 1);
    expect(g.date & 0xff).toBe(1);
  });

  it('比拼 at the month end: the most takes it (a tie: all of the best); 堅持: everyone who kept it', () => {
    for (const card of ['M089', 'M095']) {
      const { g, flow } = start(card), c = g.challengeTracker!;
      const vals = () => g.players.map(p => c.monthValue(p));
      let last: number[] = [];
      const seq = c.month!.seq;
      for (let r = flow.next(); !r.done && c.month!.seq === seq; r = flow.next()) { if ('ask' in r.value) throw new Error('question'); if (c.month!.seq === seq) last = vals(); }
      const log = c.monthLog.at(-1)!;
      expect(log.seq).toBe(seq);
      const want = card === 'M089' ? last.flatMap((v, i) => (v === Math.max(...last) ? [i] : [])) : last.flatMap((v, i) => (v === 0 ? [i] : []));
      expect(log.won).toEqual(want);
    }
  });

  it('every 挑戰模式 map can draw almost every card', () => {
    for (const mapId of [0, 1, 2, 3, 4, 5, 6, 7, 100, 101, 102, 103, 104, 106, 107]) {
      if (!existsSync(mapFile(mapId))) continue;
      const g = new Game({ mapId, players: [0, 4].map(character => ({ character, human: false })), fundIndex: 1, traffic: 0, landLimitIndex: 0,
        daysLimitIndex: 0, victoryIndex: 0, startDate: pack(2026, 1, 1), seed: 1, challenge: true, challengeYears: 1 }, parseBoard(JSON.parse(readFileSync(mapFile(mapId), 'utf8')) as RawMap));
      expect(monthlyPool(g).length).toBeGreaterThanOrEqual(97);
    }
  });
});
