/**
 * Headless games pitting the computer's levels (Game.aiLevel: 0 簡單 = the original's rules, 1 中級, 2 困難 = the smarter
 * computer in full, core/smart-ai.ts) against each other: every seat is a human on 托管 (so the game runs until one is
 * left or the days are up), `Game.testLevels` (a test hook) sets each seat's level. Used by smart-ai.test.ts and by
 * scripts/ai-sim.ts (the long run: `npx vite-node scripts/ai-sim.ts`).
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBoard, type RawMap } from './board';
import { pack } from './date';
import { Game } from './game';
import './casino-rules'; // 大富翁城's map rules (MAP_RULES[105])
import './kabukicho'; // 歌舞伎町's map rules (MAP_RULES[106])
import './jiqing'; // 激情歲月's map rules (MAP_RULES[107])
import type { GameSettings } from './types';

const FILES: Record<number, string> = { 100: 'remake/tokyo', 101: 'remake/osaka', 102: 'remake/sapporo', 103: 'remake/kyushu', 104: 'remake/okinawa', 105: 'remake/finale', 106: 'remake/kabukicho', 107: 'remake/jiqing' };
export const simMapFile = (id: number) => fileURLToPath(new URL(`../../../editor/site/assets/${FILES[id] ?? `map-${id}`}.json`, import.meta.url));
export const haveSimMaps = (ids: number[]) => ids.every(id => existsSync(simMapFile(id)));

export interface SimResult {
  /** Winner's seat (richest at the end, or last standing); -1 none. */
  winner: number;
  days: number;
  /** Final total assets by seat (0 when bankrupt). */
  wealth: number[];
  bankrupt: boolean[];
}

/**
 * One game on `mapId` from `seed`: `characters` and `levels` by seat; it ends at `days` (the richest wins), when one
 * is left, or after `maxSteps` engine steps (a guard: never reached). `party`: a 派對模式 game.
 */
export function simGame(mapId: number, seed: number, characters: number[], levels: (0 | 1 | 2)[], days: number, party = false, maxSteps = 5_000_000): SimResult {
  const board = parseBoard(JSON.parse(readFileSync(simMapFile(mapId), 'utf8')) as RawMap);
  const settings: GameSettings = {
    mapId, players: characters.map(character => ({ character, human: true })),
    fundIndex: 1, traffic: 0, landLimitIndex: 0, daysLimitIndex: 0, victoryIndex: 0, startDate: pack(2026, 10, 14), seed, ...(party ? { party } : {}),
  };
  const game = new Game(settings, board);
  game.animation = false;
  for (const p of game.players) p.autopilot = true;
  game.testLevels = levels;
  const flow = game.run();
  let r = flow.next(), steps = 0;
  while (!r.done && game.daysElapsed < days && !game.over) {
    if (++steps > maxSteps) throw new Error(`map ${mapId} seed ${seed}: no end after ${maxSteps} steps`);
    const s = r.value as { ask?: boolean; t?: string };
    if ('ask' in s) {
      // Only 派對模式's 托管 question reaches a computer-played seat (0: the computer keeps playing).
      if (s.t !== 'auto-turn') throw new Error(`map ${mapId} seed ${seed}: unexpected question ${JSON.stringify(s)}`);
      r = flow.next(0);
    } else r = flow.next();
  }
  for (const p of game.players) if (p.cash < 0 || p.bank < 0) throw new Error(`map ${mapId} seed ${seed}: negative money`);
  const wealth = game.players.map(p => (p.bankrupt ? 0 : game.wealth(p)));
  let winner = game.over ? game.over.winner : -1;
  if (!game.over) wealth.forEach((w, i) => { if (!game.players[i].bankrupt && (winner < 0 || w > wealth[winner])) winner = i; });
  return { winner, days: game.daysElapsed, wealth, bankrupt: game.players.map(p => p.bankrupt) };
}

/** Side A against side B: wins, average final assets per player, bankruptcies. */
export interface SimSummary {
  games: number;
  aWins: number;
  bWins: number;
  aWealth: number;
  bWealth: number;
  aBankrupt: number;
  bBankrupt: number;
}

/**
 * Paired games, level `a` against level `b`: for every map and seed, four characters drawn from the seed and two
 * games, `a` on seats 0 and 2, then on 1 and 3 (the same seed, so seat order and characters even out).
 */
export function simMatch(maps: number[], seeds: number[], days: number, a: 0 | 1 | 2 = 2, b: 0 | 1 | 2 = 0, log?: (line: string) => void, party = false): SimSummary {
  const sum: SimSummary = { games: 0, aWins: 0, bWins: 0, aWealth: 0, bWealth: 0, aBankrupt: 0, bBankrupt: 0 };
  for (const mapId of maps) for (const seed of seeds) {
    const pool = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
    const chars: number[] = [];
    for (let k = 0, x = seed * 2654435761 >>> 0; k < 4; k++) { x = (Math.imul(x, 1103515245) + 12345) >>> 0; chars.push(pool.splice((x >>> 8) % pool.length, 1)[0]); }
    for (const sideA of [[0, 2], [1, 3]]) {
      const isA = (i: number) => sideA.includes(i);
      const r = simGame(mapId, seed, chars, chars.map((_, i) => (isA(i) ? a : b)), days, party);
      sum.games++;
      if (r.winner >= 0) { if (isA(r.winner)) sum.aWins++; else sum.bWins++; }
      r.wealth.forEach((w, i) => { if (isA(i)) sum.aWealth += w / 2; else sum.bWealth += w / 2; });
      r.bankrupt.forEach((x, i) => { if (x) { if (isA(i)) sum.aBankrupt++; else sum.bBankrupt++; } });
      log?.(`map ${mapId} seed ${seed} A on ${sideA.join('+')}: winner ${r.winner} (${r.winner >= 0 && isA(r.winner) ? 'A' : 'B'}) day ${r.days} wealth ${r.wealth.map((w, i) => `${isA(i) ? 'A' : 'B'}${Math.round(w / 1000)}k${r.bankrupt[i] ? '†' : ''}`).join(' ')}`);
    }
  }
  sum.aWealth = Math.round(sum.aWealth / sum.games);
  sum.bWealth = Math.round(sum.bWealth / sum.games);
  return sum;
}
