/**
 * 「下一局」 after the results, the way the original goes on after a game (docs/rules/01 §8.3, docs/rules/20 §5): the
 * original marks the map as cleared (0x4990f0, stamped on the stage picture JUMP.MKF), marks the beaten characters
 * (0x4990f4 = 2) and comes back to the new-game screen with the last game's settings (init_new_game(1): players,
 * fund, traffic, land term, days, victory) and the player's character already chosen. Here the player picks the next
 * map (the eight originals and the 自製地圖), three computer opponents are drawn at random (characters not beaten yet
 * first) and the game starts with the same settings. Pure logic; the screen is results.ts.
 */
import type { GameResults } from '../core/stats';
import type { GameSettings } from '../core/types';

/** What the run of games so far has done (memory only, like the original's tables): maps cleared, characters beaten. */
export interface RunRecord { cleared: number[]; defeated: number[] }

/** The settings that carry over to the next game (01 §2.1: the new-game screen's six options; the remake's 電腦難度). */
export type CarriedSettings = Pick<GameSettings, 'fundIndex' | 'traffic' | 'landLimitIndex' | 'daysLimitIndex' | 'victoryIndex' | 'aiLevel'>;

export const OPPONENTS = 3;

/** A human won: the map counts as cleared and every other character as beaten (01 §8.1 code 2). */
export function recordResult(run: RunRecord, r: GameResults): RunRecord {
  const win = r.players.find(p => p.winner);
  if (!win?.human) return run;
  const cleared = run.cleared.includes(r.mapId) ? run.cleared : [...run.cleared, r.mapId];
  const defeated = [...run.defeated];
  for (const p of r.players) if (!p.human && !defeated.includes(p.character)) defeated.push(p.character);
  return { cleared, defeated };
}

/**
 * Three random computer opponents for the human characters `humans`: characters not beaten in this run first, the
 * beaten ones only when too few are left. `random` returns [0, 1).
 */
export function drawOpponents(humans: number[], defeated: number[], random: () => number, characters = 12): number[] {
  const free = Array.from({ length: characters }, (_, i) => i).filter(c => !humans.includes(c));
  const fresh = free.filter(c => !defeated.includes(c)), beaten = free.filter(c => defeated.includes(c));
  const pick = (pool: number[]) => pool.splice(Math.floor(random() * pool.length), 1)[0];
  const out: number[] = [];
  const need = Math.max(0, Math.min(OPPONENTS, 4 - humans.length));
  while (out.length < need && fresh.length) out.push(pick(fresh));
  while (out.length < need && beaten.length) out.push(pick(beaten));
  return out;
}

/** The next game's settings: the same options, the humans first with their characters, then the drawn opponents. */
export function nextSettings(carried: CarriedSettings, mapId: number, humans: number[], opponents: number[], startDate: number, seed: number): GameSettings {
  return {
    mapId,
    players: [...humans.map(character => ({ character, human: true })), ...opponents.map(character => ({ character, human: false }))],
    fundIndex: carried.fundIndex, traffic: carried.traffic, landLimitIndex: carried.landLimitIndex,
    daysLimitIndex: carried.daysLimitIndex, victoryIndex: carried.victoryIndex, startDate, seed,
    ...(carried.aiLevel ? { aiLevel: carried.aiLevel } : {}),
  };
}
