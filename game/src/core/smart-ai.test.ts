import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { haveSimMaps, simMapFile, simMatch } from './ai-sim';
import { parseBoard, type RawMap } from './board';
import { pack } from './date';
import { Game } from './game';
import { saveGame } from './save';
import { SmartAi } from './smart-ai';
import type { GameSettings } from './types';

/**
 * 派對模式's smarter computer (core/smart-ai.ts): only there. A normal game never reaches it (and the golden runs of
 * regional-golden.test.ts stay as they were); in a party it plays the same from the same seed on every phone, and it
 * beats the original's computer clearly (the long run: `npx vite-node scripts/ai-sim.ts`).
 */
const MAPS = [0, 1, 100, 106];
const have = haveSimMaps(MAPS);

/** Hash of every step and the final save of a game of `days` days; the first two seats humans on 托管 when `human`. */
function run(mapId: number, seed: number, opts: { party?: boolean; human?: boolean; smart?: number[]; days?: number }): string {
  const board = parseBoard(JSON.parse(readFileSync(simMapFile(mapId), 'utf8')) as RawMap);
  const settings: GameSettings = {
    mapId, players: [0, 4, 9, 11].map((character, i) => ({ character, human: !!opts.human && i < 2 })),
    fundIndex: 1, traffic: 0, landLimitIndex: 0, daysLimitIndex: 0, victoryIndex: 0, startDate: pack(2026, 10, 14), seed,
    ...(opts.party ? { party: true } : {}),
  };
  const game = new Game(settings, board);
  game.animation = false;
  for (const p of game.players) if (p.human) p.autopilot = true;
  if (opts.smart) game.smartSeats = new Set(opts.smart);
  const h = createHash('sha256'), flow = game.run();
  for (let r = flow.next(); !r.done && game.daysElapsed < (opts.days ?? 200); ) {
    h.update(JSON.stringify(r.value));
    const s = r.value as { ask?: boolean; t?: string };
    if ('ask' in s) { expect(s.t).toBe('auto-turn'); r = flow.next(0); } else r = flow.next();
  }
  const save = saveGame(game) as unknown as Record<string, unknown>;
  delete save.savedAt;
  h.update(JSON.stringify(save));
  return h.digest('hex').slice(0, 16);
}

describe.skipIf(!have)('派對模式 smart computer', () => {
  afterEach(() => vi.restoreAllMocks());

  it('a normal game never asks it: the same game, bit for bit, with the test hook on every seat', () => {
    const spies = Object.getOwnPropertyNames(SmartAi.prototype).filter(k => k !== 'constructor')
      .map(k => vi.spyOn(SmartAi.prototype as unknown as Record<string, () => unknown>, k));
    for (const mapId of MAPS) {
      // Four computers, and two humans on 托管 with two computers: smartSeats (a party's test hook) changes nothing.
      expect(run(mapId, 9000 + mapId, { smart: [0, 1, 2, 3] })).toBe(run(mapId, 9000 + mapId, {}));
      expect(run(mapId, 77 + mapId, { human: true, smart: [0, 1, 2, 3] })).toBe(run(mapId, 77 + mapId, { human: true }));
    }
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  }, 60_000);

  it('plays a party the same from the same seed (every phone), and differently from the original computer', () => {
    for (const mapId of [1, 106]) {
      const a = run(mapId, 4242, { party: true, human: true, days: 150 });
      expect(run(mapId, 4242, { party: true, human: true, days: 150 })).toBe(a);
      expect(run(mapId, 4242, { party: true, human: true, smart: [], days: 150 })).not.toBe(a);
    }
  }, 60_000);

  it('beats the original computer: two smart seats against two classic ones', () => {
    const s = simMatch([0, 1, 100], [1000, 1001, 1002], 365);
    expect(s.games).toBe(18);
    expect(s.smartWins).toBeGreaterThan(2 * s.classicWins);
    expect(s.smartWealth).toBeGreaterThan(2 * s.classicWealth);
    expect(s.smartBankrupt).toBeLessThan(s.classicBankrupt);
  }, 60_000);
});
