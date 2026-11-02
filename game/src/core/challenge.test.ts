import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBoard, type RawMap } from './board';
import { CHALLENGE_TOTAL, drawTasks, fullStars } from './challenge';
import { pack } from './date';
import { Game, type Flow } from './game';
import { loadGame, saveGame } from './save';
import { attachLedger } from './stats';
import type { GameSettings } from './types';

const mapFile = (id: number) => fileURLToPath(new URL(`../../../editor/site/assets/map-${id}.json`, import.meta.url));

function until(flow: Flow, stop: () => boolean): boolean {
  for (let r = flow.next(); !r.done; r = flow.next()) {
    if ('ask' in r.value) throw new Error('unexpected question');
    if (r.value.t === 'turn' && stop()) return true;
  }
  return false;
}

const settings = (mapId: number, seed: number, years: number): GameSettings => ({
  mapId, players: [0, 4, 9, 11].map(character => ({ character, human: false })),
  fundIndex: 1, traffic: 0, landLimitIndex: 0, daysLimitIndex: 0, victoryIndex: 0, startDate: pack(2026, 1, 1), seed,
  challenge: true, challengeYears: years,
});

describe('挑戰模式 tasks', () => {
  it('every map draws tasks worth 120 stars', () => {
    for (const mapId of [0, 1, 2, 3, 4, 5, 6, 7, 100, 101, 102, 103, 104, 106, 107])
      for (const seed of [1, 2, 3]) expect(drawTasks(mapId, seed).reduce((n, t) => n + fullStars(t), 0)).toBe(CHALLENGE_TOTAL);
  });
});

describe.skipIf(!existsSync(mapFile(2)))('挑戰模式 games', () => {
  it('a one-year game ends on day 365 with the most stars winning', () => {
    const g = new Game(settings(2, 31, 1), parseBoard(JSON.parse(readFileSync(mapFile(2), 'utf8')) as RawMap));
    attachLedger(g.players);
    const flow = g.run();
    for (let r = flow.next(); !r.done; r = flow.next()) if ('ask' in r.value) throw new Error('unexpected question');
    expect(g.daysElapsed).toBe(365);
    const ch = g.challengeTracker!;
    const stars = g.players.map(p => ch.stars(p));
    expect(ch.stars(g.players[g.over!.winner])).toBe(Math.max(...stars));
    expect(g.players.every(p => !p.bankrupt)).toBe(true);
  });

  it('每月任務: a card each month, decided and logged, its stars in the totals', () => {
    const g = new Game(settings(2, 31, 1), parseBoard(JSON.parse(readFileSync(mapFile(2), 'utf8')) as RawMap));
    attachLedger(g.players);
    const flow = g.run();
    for (let r = flow.next(); !r.done; r = flow.next()) if ('ask' in r.value) throw new Error('unexpected question');
    const ch = g.challengeTracker!;
    expect(ch.monthLog.length).toBeGreaterThanOrEqual(12);
    expect(new Set(ch.monthLog.map(l => l.id)).size).toBe(ch.monthLog.length);
    const won = ch.monthLog.filter(l => l.won.length).length;
    expect(won).toBeGreaterThan(3);
    const fromLog = g.players.map(p => ch.monthLog.filter(l => l.won.includes(p.id)).length * 3);
    expect(ch.monthStars).toEqual(fromLog);
  });

  it('a loaded game keeps its tasks and stars and goes on like the original', () => {
    const board = parseBoard(JSON.parse(readFileSync(mapFile(2), 'utf8')) as RawMap);
    const a = new Game(settings(2, 57, 3), board);
    attachLedger(a.players);
    const fa = a.run();
    expect(until(fa, () => a.daysElapsed >= 60)).toBe(true);
    const b = loadGame(JSON.parse(JSON.stringify(saveGame(a))));
    expect(b.challengeTracker!.tasks.map(t => t.id)).toEqual(a.challengeTracker!.tasks.map(t => t.id));
    expect(b.players.map(p => b.challengeTracker!.stars(p))).toEqual(a.players.map(p => a.challengeTracker!.stars(p)));
    const fb = b.run();
    expect(until(fa, () => a.daysElapsed >= 200)).toBe(true);
    expect(until(fb, () => b.daysElapsed >= 200)).toBe(true);
    expect(b.players.map(p => b.challengeTracker!.stars(p))).toEqual(a.players.map(p => a.challengeTracker!.stars(p)));
    expect(b.challengeTracker!.save()).toEqual(a.challengeTracker!.save());
  });
});
