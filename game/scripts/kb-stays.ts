// 歌舞伎町 (docs/rules/21 §10): days in hospital / prison per player per game in the real engine, by cause.
// npx vite-node scripts/kb-stays.ts [games=30] [days=365]
const { fileURLToPath } = await import('node:url');
const G = fileURLToPath(new URL('../src/core/', import.meta.url));
const { readFileSync } = await import('node:fs');
const { parseBoard } = await import(G + 'board.ts');
const { pack } = await import(G + 'date.ts');
const { Game } = await import(G + 'game.ts');
await import(G + 'kabukicho.ts');
const { attachLedger } = await import(G + 'stats.ts');

const file = fileURLToPath(new URL('../../editor/site/assets/remake/kabukicho.json', import.meta.url));
const raw = JSON.parse(readFileSync(file, 'utf8'));
const games = Number(process.argv[2] ?? 30), days = Number(process.argv[3] ?? 365);
const CH = [[0, 4, 9, 11], [1, 2, 3, 5], [6, 7, 8, 10], [0, 1, 7, 9], [2, 3, 4, 8]];
const cnt: Record<string, number> = {};
let hosp = 0, pris = 0, hs = 0, ps = 0, pd = 0, n = 0;
const src: Record<string, { h: number; p: number; hn: number; pn: number }> = {};
for (let seed = 1; seed <= games; seed++) {
  const chars = CH[seed % CH.length];
  const g = new Game({ mapId: 106, players: chars.map(character => ({ character, human: false })), fundIndex: 1, traffic: 0, landLimitIndex: 0, daysLimitIndex: 0, victoryIndex: 0, startDate: pack(2026, 10, 17), seed }, parseBoard(raw));
  const L = attachLedger(g.players);
  let ctx = 'other';
  const flow = g.run();
  for (let r = flow.next(); !r.done && g.daysElapsed < days && !g.over; r = flow.next()) {
    const s = r.value as any;
    if (s.t === 'turn') ctx = 'other';
    if (s.t !== 'fx') continue;
    cnt[s.kind] = (cnt[s.kind] ?? 0) + 1;
    if (s.kind === 'kb-incident') ctx = 'inc:' + s.data.id;
    else if (s.kind === 'news' || s.kind === 'fate') ctx = (s.data.local ?? `${s.kind}#${s.data.id}`);
    else if (s.kind === 'kb-gang-arrest') ctx = 'gang-arrest';
    else if (s.kind === 'to-hospital' || s.kind === 'to-prison') {
      const k = src[ctx] ??= { h: 0, p: 0, hn: 0, pn: 0 };
      if (s.kind === 'to-hospital') { k.h += s.data.days; k.hn++; } else { k.p += s.data.days; k.pn++; }
    } else if (/missile|bomb|mine|dog|nuke|ufo|tank/.test(s.kind)) ctx = s.kind;
  }
  for (const x of L.players) { hosp += x.hospitalDays; pris += x.prisonDays; hs += x.hospitalStays; ps += x.prisonStays; n++; }
  pd += g.daysElapsed * g.players.length;
}
console.log(`${games} games × ≤${days} days, ${n} player-games`);
console.log(`per player per game: hospital ${(hosp / n).toFixed(1)} days (${(hs / n).toFixed(2)} stays), prison ${(pris / n).toFixed(1)} days (${(ps / n).toFixed(2)} stays)`);
console.log(`share of player-days: hospital ${(100 * hosp / pd).toFixed(2)}%, prison ${(100 * pris / pd).toFixed(2)}%`);
const rows = Object.entries(src).sort((a, b) => (b[1].h + b[1].p) - (a[1].h + a[1].p));
for (const [k, v] of rows) console.log(`  ${k.padEnd(22)} hospital ${(v.h / n).toFixed(2)} d/${v.hn}  prison ${(v.p / n).toFixed(2)} d/${v.pn}`);

for (const k of ['fate','news','kb-incident','kb-merch','kb-tout','kb-machine-result','kb-gang','kb-protection']) console.log(k, ((cnt[k] ?? 0) / n).toFixed(2), 'per player-game');
