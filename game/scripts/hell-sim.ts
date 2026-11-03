// 地獄 vs 困難 (core/smart-ai.ts HELL): one 地獄 seat among three 困難, the seat rotating, the same seeds with all four
// at 困難 for comparison. npx vite-node scripts/hell-sim.ts [days=360] [seeds=8] [map=2] ['[{"reserve":3},{"acts":4}]']
import { readFileSync } from 'node:fs';
import { simMapFile } from '../src/core/ai-sim';
import { parseBoard, type RawMap } from '../src/core/board';
import { pack } from '../src/core/date';
import { Game } from '../src/core/game';
import type { GameSettings } from '../src/core/types';
import { HELL } from '../src/core/smart-ai';
const days = Number(process.argv[2] ?? 360), seeds = Number(process.argv[3] ?? 8), mapId = Number(process.argv[4] ?? 2);
type Lv = 0 | 1 | 2 | 3;
function run(seed: number, levels: Lv[], humans = [true, true, true, true]) {
  const board = parseBoard(JSON.parse(readFileSync(simMapFile(mapId), 'utf8')) as RawMap);
  const settings: GameSettings = { mapId, players: [0, 4, 9, 11].map((character, i) => ({ character, human: humans[i] })), fundIndex: 1, traffic: 0, landLimitIndex: 0, daysLimitIndex: 0, victoryIndex: 0, startDate: pack(2026, 10, 14), seed };
  const g = new Game(settings, board); g.animation = false;
  for (const p of g.players) if (p.human) p.autopilot = true;
  g.testLevels = levels;
  const st = { buys: [0, 0, 0, 0], sells: [0, 0, 0, 0], profit: [0, 0, 0, 0] };
  const sell = g.stocks.sell.bind(g.stocks);
  g.stocks.sell = (p, slot, n, toBank) => { const basis = Math.trunc(n * g.stocks.holding(p.id, slot).avgCost); const r = sell(p, slot, n, toBank); st.profit[p.id] += r - basis; return r; };
  const flow = g.run();
  for (let r = flow.next(); !r.done && g.daysElapsed < days && !g.over; ) {
    const s = r.value as { t?: string; kind?: string; p?: number; data?: { buy?: boolean } };
    if (s.t === 'fx' && s.kind === 'stock-trade' && s.p !== undefined) (s.data?.buy ? st.buys : st.sells)[s.p]++;
    r = 'ask' in s ? flow.next(0) : flow.next();
  }
  return { ...st, wealth: g.players.map(p => (p.bankrupt ? 0 : g.wealth(p))), shares: g.players.map(p => g.stocks.shareValue(p)) };
}
const configs: Partial<typeof HELL>[] = JSON.parse(process.argv[5] ?? '[{}]');
const DEFAULT = { ...HELL };
const top = (w: number[]) => w.indexOf(Math.max(...w));
const base = Array.from({ length: seeds }, (_, k) => run(1000 + k, [2, 2, 2, 2]));
for (const cfg of configs) {
  Object.assign(HELL, DEFAULT, cfg);
  let ratio = 0, wins = 0, bwins = 0, broke = 0, prof = 0, bprof = 0;
  for (let k = 0; k < seeds; k++) {
    const seat = k % 4, h = run(1000 + k, [0, 1, 2, 3].map(i => (i === seat ? 3 : 2)) as Lv[]), b = base[k];
    ratio += (h.wealth[seat] + 1) / (b.wealth[seat] + 1e5); if (top(h.wealth) === seat) wins++; if (top(b.wealth) === seat) bwins++; if (!h.wealth[seat]) broke++;
    prof += h.profit[seat]; bprof += b.profit[seat];
  }
  console.log(`${JSON.stringify(cfg)}: 地獄 richest ${wins}/${seeds} (困難 same seat ${bwins}/${seeds}), bankrupt ${broke}, assets ×${(ratio / seeds).toFixed(2)}, share profit ${Math.round(prof / seeds)} vs ${Math.round(bprof / seeds)}`);
}

// One player (a 困難 computer on 托管 for the human) against three computers: 困難 or 地獄 (ganging up).
if (process.env.TEAM) {
  const H = [true, false, false, false];
  let w2 = 0, w3 = 0, b2 = 0, b3 = 0, a2 = 0, a3 = 0;
  for (let k = 0; k < seeds; k++) {
    const r2 = run(2000 + k, [2, 2, 2, 2], H), r3 = run(2000 + k, [2, 3, 3, 3], H);
    if (top(r2.wealth) === 0) w2++; if (top(r3.wealth) === 0) w3++;
    if (!r2.wealth[0]) b2++; if (!r3.wealth[0]) b3++;
    a2 += r2.wealth[0]; a3 += r3.wealth[0];
  }
  console.log(`the player vs 3 困難: richest ${w2}/${seeds}, bankrupt ${b2}, avg assets ${Math.round(a2 / seeds)}`);
  console.log(`the player vs 3 地獄: richest ${w3}/${seeds}, bankrupt ${b3}, avg assets ${Math.round(a3 / seeds)}`);
}
