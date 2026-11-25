// 排行榜's check by hand: a game whose human answers every question (a fixed little policy, as replay.test.ts), the
// record as the phone keeps it (films included) — npx vite-node scripts/rank-sample-hand.ts OUT.json MAP SEED LEVEL
import { readFileSync, writeFileSync } from 'node:fs';
import { parseBoard, type RawMap } from '../src/core/board';
import { pack } from '../src/core/date';
import { Game } from '../src/core/game';
import { Recorder } from '../src/core/replay';
import { attachLedger } from '../src/core/stats';
import { simMapFile } from '../src/core/ai-sim';
import type { Answer, GameSettings } from '../src/core/types';

const [out, mapArg, seedArg, levelArg] = process.argv.slice(2);
const mapId = Number(mapArg ?? 0), seed = Number(seedArg ?? 11), level = Number(levelArg ?? 2) as 0 | 1 | 2 | 3;
const settings: GameSettings = { mapId, players: [0, 4, 9, 11].map((character, i) => ({ character, human: i === 0 })), fundIndex: 1, traffic: 0,
  landLimitIndex: 0, daysLimitIndex: 2, victoryIndex: 0, startDate: pack(2026, 1, 1), seed, aiLevel: level };
const g = new Game(JSON.parse(JSON.stringify(settings)), parseBoard(JSON.parse(readFileSync(simMapFile(mapId), 'utf8')) as RawMap));
attachLedger(g.players);
g.animation = false;
const rec = new Recorder(false), flow = g.run();
let answer: Answer = undefined, yes = 0, films = 0;
for (let n = 0; n < 3_000_000; n++) {
  rec.step(answer);
  const r = flow.next(answer);
  answer = undefined;
  if (r.done) break;
  const s = r.value as { ask?: boolean; t?: string; kind?: string; options?: { value: number; disabled?: boolean }[] };
  if (s.t === 'fx' && s.kind === 'cinema') films++;
  if (!('ask' in s)) continue;
  if (s.t === 'yesno') answer = (yes++ & 1) === 0;
  else if (s.t === 'choose') answer = s.options?.find(o => !o.disabled)?.value ?? 0;
  else if (s.t === 'facility-type') answer = 1;
}
const me = g.players[0];
writeFileSync(out, JSON.stringify({ rich: Math.round(g.wealth(me)), days: g.daysElapsed, winner: g.over?.winner, films, log: rec.log, settings: JSON.stringify(settings) }));
console.log('winner', g.over?.winner, 'days', g.daysElapsed, 'films', films, 'answers', rec.log.a.length);
