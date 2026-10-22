// 派對模式's smart computer against the classic one (core/smart-ai.ts, core/ai-sim.ts): paired headless games.
// npx vite-node scripts/ai-sim.ts [seeds=10] [days=365] [maps=0,1,2,3,4,5,6,7,100,106] [-v]
const { fileURLToPath } = await import('node:url');
const G = fileURLToPath(new URL('../src/core/', import.meta.url));
const { simMatch } = await import(G + 'ai-sim.ts');

const args = process.argv.slice(2).filter(a => a !== '-v');
const verbose = process.argv.includes('-v');
const seeds = Array.from({ length: Number(args[0] ?? 10) }, (_, i) => 1000 + i);
const days = Number(args[1] ?? 365);
const maps = (args[2] ?? '0,1,2,3,4,5,6,7,100,106').split(',').map(Number);
const t0 = Date.now();
const s = simMatch(maps, seeds, days, verbose ? (l: string) => console.log(l) : undefined);
const pct = (a: number, b: number) => `${((100 * a) / Math.max(1, b)).toFixed(1)}%`;
console.log(`${s.games} games (${maps.length} maps × ${seeds.length} seeds × 2 seatings, ${days} days), 2 smart vs 2 classic, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
console.log(`wins: smart ${s.smartWins} (${pct(s.smartWins, s.games)}), classic ${s.classicWins} (${pct(s.classicWins, s.games)})`);
console.log(`average final assets per player: smart ${s.smartWealth.toLocaleString('en-US')}, classic ${s.classicWealth.toLocaleString('en-US')}`);
console.log(`bankruptcies: smart ${s.smartBankrupt}, classic ${s.classicBankrupt} (of ${s.games * 2} players each)`);
