import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseBoard, type RawMap } from './board';
import { pack } from './date';
import { Game } from './game';
import { Recorder, replay } from './replay';
import { scores } from './ranks';
import { attachLedger } from './stats';
import { simMapFile } from './ai-sim';
import type { Answer, GameSettings } from './types';

/**
 * A human seat played by a fixed little policy (rolls, buys every other offer, first options), the rest the computers;
 * the phone's record is kept as the screen keeps it, then the game is played again from it: the same figures.
 */
function play(mapId: number, seed: number, level: 0 | 1 | 2 | 3, cheat?: (g: Game, step: number) => void, byHand = false) {
  const raw = JSON.parse(readFileSync(simMapFile(mapId), 'utf8')) as RawMap;
  const settings: GameSettings = { mapId, players: [0, 4, 9, 11].map((character, i) => ({ character, human: i === 0 })), fundIndex: 1, traffic: 0,
    landLimitIndex: 0, daysLimitIndex: 2, victoryIndex: 0, startDate: pack(2026, 1, 1), seed, aiLevel: level };
  const g = new Game(JSON.parse(JSON.stringify(settings)), parseBoard(raw));
  attachLedger(g.players);
  g.animation = false;
  const rec = new Recorder(false);
  const flow = g.run();
  let answer: Answer = undefined, yes = 0, step = 0, turns = 0, autoAt = 0;
  for (;;) {
    rec.step(answer);
    cheat?.(g, step);
    if (autoAt && step === autoAt + 3000 && g.players[0].autopilot) { rec.autoOff(0); g.players[0].autopilot = false; } // 取消托管 (the screen sets it, logged)
    const r = flow.next(answer);
    step++;
    answer = undefined;
    if (r.done) break;
    const s = r.value as { ask?: boolean; t?: string; options?: { value: number; disabled?: boolean }[] };
    if (!('ask' in s)) continue;
    if (s.t === 'turn' && ++turns === 20 && !byHand) { answer = { action: 'autopilot' } as Answer; autoAt = step; } // 托管 from the menu
    else if (s.t === 'yesno') answer = (yes++ & 1) === 0;
    else if (s.t === 'choose') answer = s.options?.find(o => !o.disabled)?.value ?? 0;
    else if (s.t === 'facility-type') answer = 1;
    if (step > 2_000_000) throw new Error('no end');
  }
  return { g, settings, raw, log: rec.log };
}

describe('排行榜 replay', () => {
  it('a game played again from its record comes to the same figures', () => {
    const { g, settings, raw, log } = play(0, 11, 2);
    expect(g.over).toBeTruthy();
    const r = replay(settings, raw, log);
    expect(r.days).toBe(g.daysElapsed);
    expect(r.winner).toBe(g.over!.winner);
    expect(r.money).toEqual(g.players.map(p => p.cash + p.bank));
    const mine = scores(g.stats!.of(0)), again = replay(settings, raw, log);
    expect(again).toEqual(r);
    expect(mine.fierce + mine.woe).toBeGreaterThan(0);
    // the record's size (the user: 流量): a whole game's answers, as JSON
    console.log(`days ${g.daysElapsed}, answers ${log.a.length}, ${JSON.stringify(log).length} bytes`);
  });

  it('money changed during the game does not come out the same', () => {
    const honest = play(0, 11, 2);
    const cheated = play(0, 11, 2, (g, step) => { if (step === 3000) g.players[0].cash += 500000; });
    const r = replay(cheated.settings, cheated.raw, cheated.log), g = cheated.g;
    expect(r.days === g.daysElapsed && JSON.stringify(r.money) === JSON.stringify(g.players.map(p => p.cash + p.bank))).toBe(false);
    expect(honest.g.daysElapsed).toBeGreaterThan(0);
  });

  it('a game played by hand all the way: the same, and the record stays small', () => {
    const { g, settings, raw, log } = play(1, 7, 3, undefined, true);
    const r = replay(settings, raw, log);
    expect([r.days, r.winner]).toEqual([g.daysElapsed, g.over!.winner]);
    expect(r.money).toEqual(g.players.map(p => p.cash + p.bank));
    const bytes = JSON.stringify(log).length;
    console.log(`by hand: days ${g.daysElapsed}, answers ${log.a.length}, ${bytes} bytes`);
    expect(bytes).toBeLessThan(200_000);
  });
});
