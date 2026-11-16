// 地獄's 1.2.3 rules (the user 2026-11-16) in whole games: one human seat on 托管 (it plays 困難) against three 地獄
// computers, with the rules on and at level 1.2.2 (off). Checks the pools never go above the number of players and
// every game runs to the end. npx vite-node scripts/hell-rules-sim.ts [days=360] [seeds=6] [maps=1,2,3]
import { readFileSync } from 'node:fs';
import { simMapFile } from '../src/core/ai-sim';
import { parseBoard, type RawMap } from '../src/core/board';
import { pack } from '../src/core/date';
import { Game } from '../src/core/game';
import { HELL_PER_HEAD, HELL_RARE } from '../src/core/modules/cards';
import type { GameSettings } from '../src/core/types';
const days = Number(process.argv[2] ?? 360), seeds = Number(process.argv[3] ?? 6), maps = (process.argv[4] ?? '1,2,3').split(',').map(Number);
function run(mapId: number, seed: number, level?: string) {
  const board = parseBoard(JSON.parse(readFileSync(simMapFile(mapId), 'utf8')) as RawMap);
  const settings: GameSettings = { mapId, players: [0, 4, 9, 11].map((character, i) => ({ character, human: i === seed % 4 })), fundIndex: 1, traffic: 0, landLimitIndex: 0, daysLimitIndex: 0, victoryIndex: 0, startDate: pack(2026, 10, 14), seed, aiLevel: 3, ...(level ? { level } : {}) };
  const g = new Game(settings, board); g.animation = false;
  for (const p of g.players) if (p.human) p.autopilot = true;
  const n = g.players.length, hell = g.hellRules();
  let magic = 0, magicHuman = 0, earth = 0, steps = 0;
  const flow = g.run();
  for (let r = flow.next(); !r.done && g.daysElapsed < days && !g.over; ) {
    if (++steps > 5_000_000) throw new Error('no end');
    const s = r.value as { t?: string; kind?: string; p?: number; data?: { magic?: number; targets?: number[]; type?: number } };
    if (s.t === 'fx' && s.kind === 'magic' && s.p !== undefined && !g.players[s.p].human) { magic++; if (s.data?.targets?.some(t => g.players[t].human)) magicHuman++; }
    if (s.t === 'fx' && s.kind === 'earth-god' ) earth++;
    if (hell && steps % 500 === 0) {
      for (let t = 1; t <= 8; t++) {
        const held = g.players.reduce((a, p) => a + p.tools[t - 1] + ((p.traffic & 3) === 1 && t === 5 ? 1 : 0) + ((p.traffic & 3) === 2 && t === 6 ? 1 : 0), 0);
        if (g.tools.shopStock[t - 1] + held > n) throw new Error(`map ${mapId} seed ${seed} day ${g.daysElapsed}: tool ${t} ${g.tools.shopStock[t - 1]} + ${held} > ${n}`);
      }
      for (let c = 1; c <= 30; c++) {
        if (!HELL_RARE.has(c) && !HELL_PER_HEAD.has(c)) continue;
        for (const p of g.players) if (p.cards.filter(x => x === c).length > 1) throw new Error(`map ${mapId} seed ${seed}: ${p.id} holds two of card ${c}`);
        const held = g.players.reduce((a, p) => a + p.cards.filter(x => x === c).length, 0), cap = HELL_RARE.has(c) ? 1 : n;
        if (held > cap) throw new Error(`map ${mapId} seed ${seed}: card ${c} ${held} held > ${cap}`);
      }
    }
    r = 'ask' in s ? flow.next(0) : flow.next();
  }
  const human = g.players.find(p => p.human)!;
  return { humanWealth: human.bankrupt ? 0 : g.wealth(human), humanBroke: human.bankrupt, days: g.daysElapsed, magic, magicHuman };
}
for (const level of [undefined, '1.2.2']) {
  let w = 0, broke = 0, games = 0, d = 0;
  for (const m of maps) for (let k = 0; k < seeds; k++) { const r = run(m, 500 + k, level); w += r.humanWealth; broke += +r.humanBroke; games++; d += r.days; }
  console.log(`${level ? 'at 1.2.2 (old)' : '1.2.3 hell rules'}: ${games} games, the human seat (困難 on 托管) broke ${broke}, average wealth ${Math.round(w / games).toLocaleString()}, average days ${Math.round(d / games)}`);
}
