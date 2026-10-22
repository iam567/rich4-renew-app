import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { haveSimMaps, simMapFile, simMatch } from './ai-sim';
import { parseBoard, type RawMap } from './board';
import { pack } from './date';
import { Game } from './game';
import { loadGame, saveGame } from './save';
import { SmartAi } from './smart-ai';
import type { GameSettings } from './types';

/**
 * The smarter computer (core/smart-ai.ts) and the computer's levels (Game.aiLevel): a normal game at its default
 * 簡單 never reaches it (and the golden runs of regional-golden.test.ts stay as they were); 中級 / 困難 are saved with
 * the game; a party plays it at 困難, the same from the same seed on every phone; and 簡單 < 中級 < 困難 (the long run:
 * `npx vite-node scripts/ai-sim.ts`).
 */
const MAPS = [0, 1, 100, 106];
const have = haveSimMaps(MAPS);

interface RunOpts { party?: boolean; human?: boolean; level?: 0 | 1 | 2; levels?: (0 | 1 | 2)[]; days?: number }

function newGame(mapId: number, seed: number, opts: RunOpts): Game {
  const board = parseBoard(JSON.parse(readFileSync(simMapFile(mapId), 'utf8')) as RawMap);
  const settings: GameSettings = {
    mapId, players: [0, 4, 9, 11].map((character, i) => ({ character, human: !!opts.human && i < 2 })),
    fundIndex: 1, traffic: 0, landLimitIndex: 0, daysLimitIndex: 0, victoryIndex: 0, startDate: pack(2026, 10, 14), seed,
    ...(opts.party ? { party: true } : {}), ...(opts.level !== undefined ? { aiLevel: opts.level } : {}),
  };
  const game = new Game(settings, board);
  game.animation = false;
  for (const p of game.players) if (p.human) p.autopilot = true;
  if (opts.levels) game.testLevels = opts.levels;
  return game;
}

/** Hash of every step and the final save of a game of `days` days; the first two seats humans on 托管 when `human`. */
function run(mapId: number, seed: number, opts: RunOpts): string {
  const game = newGame(mapId, seed, opts);
  const h = createHash('sha256'), flow = game.run();
  for (let r = flow.next(); !r.done && game.daysElapsed < (opts.days ?? 200); ) {
    h.update(JSON.stringify(r.value));
    const s = r.value as { ask?: boolean; t?: string };
    if ('ask' in s) { expect(s.t).toBe('auto-turn'); r = flow.next(0); } else r = flow.next();
  }
  const save = saveGame(game) as unknown as Record<string, unknown>;
  delete save.savedAt;
  h.update(JSON.stringify(save).replace(/,"aiLevel":0/, ''));
  return h.digest('hex').slice(0, 16);
}

describe.skipIf(!have)('the smarter computer and the computer levels', () => {
  afterEach(() => vi.restoreAllMocks());

  it('簡單 (a normal game\'s default) never asks it: the same game, bit for bit, with or without aiLevel 0', () => {
    const spies = Object.getOwnPropertyNames(SmartAi.prototype).filter(k => k !== 'constructor')
      .map(k => vi.spyOn(SmartAi.prototype as unknown as Record<string, () => unknown>, k));
    for (const mapId of MAPS) {
      // Four computers, and two humans on 托管 with two computers.
      const plain = run(mapId, 9000 + mapId, {});
      expect(run(mapId, 9000 + mapId, { level: 0 })).toBe(plain);
      expect(run(mapId, 9000 + mapId, { levels: [0, 0, 0, 0] })).toBe(plain);
      expect(run(mapId, 77 + mapId, { human: true, level: 0 })).toBe(run(mapId, 77 + mapId, { human: true }));
    }
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  }, 60_000);

  it('中級 and 困難 play differently, also humans on 托管, and the level is saved with the game', () => {
    const plain = run(1, 31, { human: true });
    const mid = run(1, 31, { human: true, level: 1 }), hard = run(1, 31, { human: true, level: 2 });
    expect(new Set([plain, mid, hard]).size).toBe(3);
    // Only the 托管 humans at 困難: their own level reaches them too.
    const g = newGame(1, 31, { human: true, level: 2 });
    for (const p of g.players) { p.whoPlays = p.human ? 1 : 2; p.autopilot = false; }
    expect(g.players.map(p => g.aiLevel(p))).toEqual([0, 0, 2, 2]); // humans playing by hand: none
    for (const p of g.players) p.autopilot = true;
    expect(g.players.map(p => g.aiLevel(p))).toEqual([2, 2, 2, 2]); // on 托管: the game's level
    const back = loadGame(JSON.parse(JSON.stringify(saveGame(newGame(1, 31, { level: 1 })))));
    expect(back.settings.aiLevel).toBe(1);
  }, 60_000);

  it('plays a party at 困難, the same from the same seed (every phone), whatever aiLevel says', () => {
    for (const mapId of [1, 106]) {
      const a = run(mapId, 4242, { party: true, human: true, days: 150 });
      expect(run(mapId, 4242, { party: true, human: true, days: 150 })).toBe(a);
      expect(run(mapId, 4242, { party: true, human: true, level: 0, days: 150 })).toBe(a);
      expect(run(mapId, 4242, { party: true, human: true, levels: [2, 2, 2, 2], days: 150 })).toBe(a);
      expect(run(mapId, 4242, { party: true, human: true, levels: [0, 0, 0, 0], days: 150 })).not.toBe(a);
    }
  }, 60_000);

  it('簡單 < 中級 < 困難: two seats of one level against two of another', () => {
    const maps = [0, 1, 100], seeds = [1000, 1001, 1002];
    for (const [a, b] of [[1, 0], [2, 0], [2, 1]] as const) {
      const s = simMatch(maps, seeds, 365, a, b);
      expect(s.games).toBe(18);
      expect(s.aWins).toBeGreaterThan(s.bWins);
      expect(s.aWealth).toBeGreaterThan(s.bWealth);
    }
  }, 120_000);
});
