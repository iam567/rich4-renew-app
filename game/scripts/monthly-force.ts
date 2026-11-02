// 每月任務 (docs/rules/27), every card forced in turn: each card is the card of every month in a few one-year games of
// four 挑戰模式 computers, rotating maps; prints how many months someone took it and by how much.
// npx vite-node scripts/monthly-force.ts [games=3] [ids=all] [out.json]
import { readFileSync, writeFileSync } from 'node:fs';
import { simMapFile } from '../src/core/ai-sim';
import { parseBoard, type RawMap } from '../src/core/board';
import { Challenge } from '../src/core/challenge';
import { pack } from '../src/core/date';
import { Game } from '../src/core/game';
import { MONTHLY_TASKS, monthlyById, monthlyPool } from '../src/core/monthly';
import { attachLedger } from '../src/core/stats';
import type { GameSettings } from '../src/core/types';

const args = process.argv.slice(2);
const games = Number(args[0] ?? 3);
const ids = args[1] && args[1] !== 'all' ? args[1].split(',') : MONTHLY_TASKS.map(t => t.id);
const MAPS = [0, 1, 2, 3, 4, 5, 6, 7, 100, 101, 102, 103, 104, 106, 107];
const rows: Record<string, { months: number; won: number; winners: number; best: number[]; maps: number[] }> = {};
let k = 0;
for (const id of ids) {
  const t = monthlyById.get(id)!;
  const row = (rows[id] = { months: 0, won: 0, winners: 0, best: [] as number[], maps: [] as number[] });
  for (let i = 0; i < games; i++) {
    // A map that has the card (stocks, plots …).
    let mapId = MAPS[(k++) % MAPS.length], g!: Game;
    for (let tries = 0; tries < MAPS.length; tries++) {
      const board = parseBoard(JSON.parse(readFileSync(simMapFile(mapId), 'utf8')) as RawMap);
      const settings: GameSettings = {
        mapId, players: [9, 4, 3, 0].map(character => ({ character, human: false })),
        fundIndex: 1, traffic: 0, landLimitIndex: 0, daysLimitIndex: 0, victoryIndex: 0, startDate: pack(2026, 1, 1), seed: 7000 + k * 13, challenge: true, challengeYears: 1,
      };
      Challenge.forceMonthly = id;
      g = new Game(settings, board);
      if (monthlyPool(g).includes(t)) break;
      mapId = MAPS[(k++) % MAPS.length];
    }
    g.animation = false;
    attachLedger(g.players);
    const ch = g.challengeTracker!;
    // The best value anyone reached each month, read at the month's end.
    const origNew = ch.newDay.bind(ch);
    ch.newDay = () => {
      const m = ch.month;
      if (m && g.date && ((g.date & 0xff) === 1)) row.best.push(Math.max(...g.players.map(p => ch.monthValue(p))));
      void m; origNew();
    };
    const flow = g.run();
    for (let r = flow.next(); !r.done; r = flow.next()) if ('ask' in r.value) throw new Error('question');
    for (const l of ch.monthLog) { row.months++; if (l.won.length) { row.won++; row.winners += l.won.length; } }
    row.maps.push(mapId);
  }
  const best = row.best.length ? `${Math.min(...row.best)}..${Math.max(...row.best)}` : '-';
  console.log(`${id} ${t.kind.padEnd(4)} ${t.name.padEnd(7, '　')} goal ${String(t.goal).padStart(6)} months ${row.months} won ${row.won} winners ${row.winners} best/month ${best}`);
}
if (args[2]) writeFileSync(args[2], JSON.stringify(rows));
