/**
 * Headless 派對模式 games pitting the smart computer (core/smart-ai.ts) against the classic one (the original's rules):
 * every seat is a human on 托管 (as a party plays them), `Game.smartSeats` (a test hook) picks the smart ones. Used by
 * smart-ai.test.ts and by scripts/ai-sim.ts (the long run: `npx vite-node scripts/ai-sim.ts`).
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBoard, type RawMap } from './board';
import { pack } from './date';
import { Game } from './game';
import './casino-rules'; // 大富翁城's map rules (MAP_RULES[105])
import './kabukicho'; // 歌舞伎町's map rules (MAP_RULES[106])
import type { GameSettings } from './types';

const FILES: Record<number, string> = { 100: 'remake/tokyo', 101: 'remake/osaka', 102: 'remake/sapporo', 103: 'remake/kyushu', 104: 'remake/okinawa', 105: 'remake/finale', 106: 'remake/kabukicho' };
export const simMapFile = (id: number) => fileURLToPath(new URL(`../../../editor/site/assets/${FILES[id] ?? `map-${id}`}.json`, import.meta.url));
export const haveSimMaps = (ids: number[]) => ids.every(id => existsSync(simMapFile(id)));

export interface SimResult {
  /** Winner's seat (richest at the end, or last standing); -1 none. */
  winner: number;
  days: number;
  /** Final total assets by seat (0 when bankrupt). */
  wealth: number[];
  bankrupt: boolean[];
  smart: boolean[];
}

/**
 * One game on `mapId` from `seed`: `characters` by seat, `smart` the smart seats; it ends at `days` (the richest
 * wins), when one is left, or after `maxSteps` engine steps (a guard: never reached).
 */
export function simGame(mapId: number, seed: number, characters: number[], smart: number[], days: number, maxSteps = 5_000_000): SimResult {
  const board = parseBoard(JSON.parse(readFileSync(simMapFile(mapId), 'utf8')) as RawMap);
  const settings: GameSettings = {
    mapId, players: characters.map(character => ({ character, human: true })),
    fundIndex: 1, traffic: 0, landLimitIndex: 0, daysLimitIndex: 0, victoryIndex: 0, startDate: pack(2026, 10, 14), seed, party: true,
  };
  const game = new Game(settings, board);
  game.animation = false;
  for (const p of game.players) p.autopilot = true;
  game.smartSeats = new Set(smart);
  const flow = game.run();
  let r = flow.next(), steps = 0;
  while (!r.done && game.daysElapsed < days && !game.over) {
    if (++steps > maxSteps) throw new Error(`map ${mapId} seed ${seed}: no end after ${maxSteps} steps`);
    const s = r.value as { ask?: boolean; t?: string };
    if ('ask' in s) {
      // Only 托管's question reaches a computer-played seat (0: the computer keeps playing).
      if (s.t !== 'auto-turn') throw new Error(`map ${mapId} seed ${seed}: unexpected question ${JSON.stringify(s)}`);
      r = flow.next(0);
    } else r = flow.next();
  }
  for (const p of game.players) if (p.cash < 0 || p.bank < 0) throw new Error(`map ${mapId} seed ${seed}: negative money`);
  const wealth = game.players.map(p => (p.bankrupt ? 0 : game.wealth(p)));
  let winner = game.over ? game.over.winner : -1;
  if (!game.over) wealth.forEach((w, i) => { if (!game.players[i].bankrupt && (winner < 0 || w > wealth[winner])) winner = i; });
  return { winner, days: game.daysElapsed, wealth, bankrupt: game.players.map(p => p.bankrupt), smart: game.players.map(p => smart.includes(p.id)) };
}

export interface SimSummary {
  games: number;
  smartWins: number;
  classicWins: number;
  smartWealth: number;
  classicWealth: number;
  smartBankrupt: number;
  classicBankrupt: number;
}

/**
 * Paired games: for every map and seed, four characters drawn from the seed and two games, smart on seats 0 and 2,
 * then on 1 and 3 (the same seed, so seat order and characters even out).
 */
export function simMatch(maps: number[], seeds: number[], days: number, log?: (line: string) => void): SimSummary {
  const sum: SimSummary = { games: 0, smartWins: 0, classicWins: 0, smartWealth: 0, classicWealth: 0, smartBankrupt: 0, classicBankrupt: 0 };
  for (const mapId of maps) for (const seed of seeds) {
    const pool = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
    const chars: number[] = [];
    for (let k = 0, x = seed * 2654435761 >>> 0; k < 4; k++) { x = (Math.imul(x, 1103515245) + 12345) >>> 0; chars.push(pool.splice((x >>> 8) % pool.length, 1)[0]); }
    for (const smart of [[0, 2], [1, 3]]) {
      const r = simGame(mapId, seed, chars, smart, days);
      sum.games++;
      if (r.winner >= 0) { if (r.smart[r.winner]) sum.smartWins++; else sum.classicWins++; }
      r.wealth.forEach((w, i) => { if (r.smart[i]) sum.smartWealth += w / 2; else sum.classicWealth += w / 2; });
      r.bankrupt.forEach((b, i) => { if (b) { if (r.smart[i]) sum.smartBankrupt++; else sum.classicBankrupt++; } });
      log?.(`map ${mapId} seed ${seed} smart ${smart.join('+')}: winner ${r.winner} (${r.winner >= 0 && r.smart[r.winner] ? 'smart' : 'classic'}) day ${r.days} wealth ${r.wealth.map((w, i) => `${r.smart[i] ? 'S' : 'C'}${Math.round(w / 1000)}k${r.bankrupt[i] ? '†' : ''}`).join(' ')}`);
    }
  }
  sum.smartWealth = Math.round(sum.smartWealth / sum.games);
  sum.classicWealth = Math.round(sum.classicWealth / sum.games);
  return sum;
}
