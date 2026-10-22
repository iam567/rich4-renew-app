// The computer's levels against each other (Game.aiLevel; core/smart-ai.ts, core/ai-sim.ts): paired headless games.
// npx vite-node scripts/ai-sim.ts [seeds=10] [days=365] [maps=0,1,2,3,4,5,6,7,100,106] [a=2] [b=0] [-v] [--party]
const { fileURLToPath } = await import('node:url');
const G = fileURLToPath(new URL('../src/core/', import.meta.url));
const { simMatch } = await import(G + 'ai-sim.ts');

const args = process.argv.slice(2).filter(a => !a.startsWith('-'));
const verbose = process.argv.includes('-v'), party = process.argv.includes('--party');
const seeds = Array.from({ length: Number(args[0] ?? 10) }, (_, i) => 1000 + i);
const days = Number(args[1] ?? 365);
const maps = (args[2] ?? '0,1,2,3,4,5,6,7,100,106').split(',').map(Number);
const a = Number(args[3] ?? 2) as 0 | 1 | 2, b = Number(args[4] ?? 0) as 0 | 1 | 2;
const NAMES = ['簡單', '中級', '困難'];
const t0 = Date.now();
const s = simMatch(maps, seeds, days, a, b, verbose ? (l: string) => console.log(l) : undefined, party);
const pct = (x: number) => `${((100 * x) / Math.max(1, s.games)).toFixed(1)}%`;
console.log(`${s.games} games (${maps.length} maps × ${seeds.length} seeds × 2 seatings, ${days} days${party ? ', 派對模式' : ''}), 2 × ${NAMES[a]} (A) vs 2 × ${NAMES[b]} (B), ${((Date.now() - t0) / 1000).toFixed(0)} s`);
console.log(`wins: A ${s.aWins} (${pct(s.aWins)}), B ${s.bWins} (${pct(s.bWins)})`);
console.log(`average final assets per player: A ${s.aWealth.toLocaleString('en-US')}, B ${s.bWealth.toLocaleString('en-US')}`);
console.log(`bankruptcies: A ${s.aBankrupt}, B ${s.bBankrupt} (of ${s.games * 2} players each)`);
