import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBoard, type RawMap } from './board';
import { day as dayOf, pack } from './date';
import { Challenge } from './challenge';
import { Game, type Flow } from './game';
import { monthlyById } from './monthly';
import { playReward, REWARD_CARDS } from './rewards';
import { attachLedger } from './stats';
import type { GameEvent, GameSettings } from './types';

const mapFile = (id: number) => fileURLToPath(new URL(`../../../editor/site/assets/map-${id}.json`, import.meta.url));

function make(monthTasks: 1 | 2 | 3, seed = 7, mapId = 2): Game {
  const settings: GameSettings = {
    mapId, players: [0, 4, 9, 11].map(character => ({ character, human: false })), aiLevel: 2,
    fundIndex: 1, traffic: 0, landLimitIndex: 0, daysLimitIndex: 0, victoryIndex: 0, startDate: pack(2026, 1, 1), seed, monthTasks,
  };
  const g = new Game(settings, parseBoard(JSON.parse(readFileSync(mapFile(mapId), 'utf8')) as RawMap));
  attachLedger(g.players);
  return g;
}
/** Plays until `until` (or the game ends); the events seen. */
function play(g: Game, flow: Flow, until: (g: Game) => boolean): GameEvent[] {
  const seen: GameEvent[] = [];
  for (let r = flow.next(); !r.done && !until(g); r = flow.next()) { if ('ask' in r.value) throw new Error('question'); seen.push(r.value as GameEvent); }
  return seen;
}
/** As drain, every event also shown to the game's task tracker (as Game.run does). */
const seen = (g: Game, f: Flow) => { for (let r = f.next(); !r.done; r = f.next()) { if ('ask' in r.value) throw new Error('question'); g.challengeTracker!.see(r.value as GameEvent); } };
const drain = (f: Flow) => { const out: GameEvent[] = []; for (let r = f.next(); !r.done; r = f.next()) { if ('ask' in r.value) throw new Error('question'); out.push(r.value as GameEvent); } return out; };

describe.skipIf(!existsSync(mapFile(2)))('挑戰模式 switch (task cards and 獎勵卡)', () => {
  it('a year with a card a month: all three kinds, winners draw 獎勵卡, bankruptcy as ever, no stars', () => {
    let rewards = 0, months = 0;
    const kinds: string[] = [];
    for (const seed of [1, 2, 3]) {
      const g = make(1, seed), c = g.challengeTracker!;
      expect(c.monthly && c.rewards).toBe(true);
      const seen = play(g, g.run(), x => x.daysElapsed >= 365);
      rewards += seen.filter(e => e.t === 'fx' && e.kind === 'reward').length;
      months += c.monthLog.length;
      kinds.push(...c.monthLog.map(l => monthlyById.get(l.id)!.kind));
      expect(c.monthStars.every(s => s === 0)).toBe(true);
      expect(c.rewardsDue).toEqual([]);
    }
    expect(months).toBeGreaterThanOrEqual(24);
    expect(rewards).toBeGreaterThan(5);
    expect(new Set(kinds).size).toBeGreaterThan(1);
  });

  it('a 比拼 card is decided on the 1st: the most draws a 獎勵卡 (ties all)', () => {
    Challenge.forceMonthly = 'M076';   // 地產王: the most lots bought
    try {
      const g = make(1, 14), c = g.challengeTracker!, flow = g.run();
      play(g, flow, x => x.daysElapsed >= 3);
      expect(c.month!.id).toBe('M076');
      const seq = c.month!.seq, at = g.daysElapsed;
      // to the 1st (the card decided) and a few days on (its 獎勵卡 played)
      const seen = play(g, flow, x => x.challengeTracker!.monthLog.some(l => l.seq === seq) && x.daysElapsed > at + 32);
      const log = c.monthLog.find(l => l.seq === seq)!;
      expect(seen.filter(e => e.t === 'fx' && e.kind === 'reward').length).toBe(log.won.length);
    } finally { Challenge.forceMonthly = ''; }
  });

  it('完成就抽: a 比拼 card is decided after its 30 days, then the next is drawn', () => {
    Challenge.forceMonthly = 'M076';   // 地產王
    try {
      const g = make(3, 15), c = g.challengeTracker!, flow = g.run();
      play(g, flow, x => x.daysElapsed >= 2);
      const first = c.month!.seq, since = c.month!.since;
      play(g, flow, x => x.challengeTracker!.month!.seq !== first);
      expect(g.daysElapsed - since).toBe(30);
      expect(c.monthLog.at(-1)!.seq).toBe(first);
    } finally { Challenge.forceMonthly = ''; }
  });

  it('two a month: drawn on the 1st and the 16th, goals halved', () => {
    const g = make(2, 4), c = g.challengeTracker!, flow = g.run();
    const drawnOn: number[] = [];
    let seq = c.month?.seq ?? -1;
    play(g, flow, x => {
      const m = x.challengeTracker!.month;
      if (m && m.seq !== seq) { seq = m.seq; drawnOn.push(dayOf(x.date)); const t = monthlyById.get(m.id)!; if (t.goal > 1) expect(m.goal).toBeLessThan(t.money ? t.goal * x.priceIndex : t.goal); }
      return x.daysElapsed >= 120;
    });
    expect(drawnOn.length).toBeGreaterThanOrEqual(7);
    for (const d of drawnOn) expect([1, 16]).toContain(d);
  });

  it('完成就抽: the next card as soon as one is taken, never on a date', () => {
    const g = make(3, 6), c = g.challengeTracker!, flow = g.run();
    expect(c.month).not.toBeNull();
    const seen = play(g, flow, x => x.daysElapsed >= 200);
    expect(c.month).not.toBeNull();
    // a card ends when taken (a 獎勵卡 each) or after 30 days nobody did it
    expect(c.monthLog.length).toBeGreaterThan(3);
    expect(c.monthLog.some(l => l.won.length)).toBe(true);
    expect(seen.filter(e => e.t === 'fx' && e.kind === 'reward').length).toBe(c.monthLog.reduce((n, l) => n + l.won.length, 0) - c.rewardsDue.length);
  });

  it('完成就抽: a card nobody does is replaced after 30 days', () => {
    Challenge.forceMonthly = 'M026';   // 全員收押: computers hardly ever do it
    try {
      const g = make(3, 8), c = g.challengeTracker!, flow = g.run();
      play(g, flow, x => x.daysElapsed >= 3);
      const first = c.month!.seq, since = c.month!.since;
      play(g, flow, x => x.challengeTracker!.month!.seq !== first || x.daysElapsed > since + 40);
      if (!c.monthLog.at(-1)?.won.length) expect(g.daysElapsed - since).toBe(30);
      expect(c.month!.seq).toBe(first + 1);
    } finally { Challenge.forceMonthly = ''; }
  });

  it('the countdown: the days left in the month; to the 15th, then to the end; 30 days for 完成就抽', () => {
    const g = make(1, 21), c = g.challengeTracker!;
    g.date = pack(2027, 2, 1); expect(c.daysLeft()).toBe(28);
    g.date = pack(2028, 2, 1); expect(c.daysLeft()).toBe(29);
    g.date = pack(2027, 3, 1); expect(c.daysLeft()).toBe(31);
    g.date = pack(2027, 3, 31); expect(c.daysLeft()).toBe(1);
    c.perMonth = 2;
    g.date = pack(2027, 3, 1); expect(c.daysLeft()).toBe(15);
    g.date = pack(2027, 3, 16); expect(c.daysLeft()).toBe(16);
    g.date = pack(2027, 2, 16); expect(c.daysLeft()).toBe(13);
    c.perMonth = 3; c.month!.since = g.daysElapsed - 12; expect(c.daysLeft()).toBe(18);
  });

  it('every 獎勵卡 does what it says: the winner gains, every rival loses', () => {
    const g = make(1, 9), flow = g.run();
    play(g, flow, x => x.daysElapsed >= 3);
    const [p, ...rivals] = g.players;
    const lots = g.board.lands;
    for (const l of lots) { l.owner = 0; l.level = 0; l.chain = false; }
    rivals.forEach((q, i) => {
      q.cards = [8, 2]; q.tools = q.tools.map(() => 0); q.luckFate = 0; q.luckMoney = 0; q.tools[1] = 1; q.points = 150; q.cash = 50000; q.bank = 40000;
      const l = lots[i * 3]; l.owner = q.id + 1; l.level = 2; l.chain = false;
    });
    const l0 = lots.find(l => l.owner === 0)!; l0.owner = p.id + 1; l0.level = 1; l0.chain = false;
    const run = (id: string) => drain(playReward(g, p, 0, id, 0));
    // R01: a card and a tool from each
    const cards0 = p.cards.length, tools0 = p.tools[1];
    run('RW01');
    expect(p.cards.length).toBeGreaterThan(cards0);
    expect(p.tools[1]).toBe(Math.min(9, tools0 + 3));
    for (const q of rivals) { expect(q.cards.length).toBe(1); expect(q.tools[1]).toBe(0); }
    // R02: a lot each
    run('RW02');
    for (const [i] of rivals.entries()) expect(lots[i * 3].owner).toBe(p.id + 1);
    // R03 / R04 / R05: money
    let w = p.cash + p.bank;
    run('RW03');
    expect(p.cash + p.bank - w).toBe(3 * 5000 * g.priceIndex);
    w = p.cash + p.bank; const cash = rivals.map(q => q.cash);
    run('RW04');
    expect(p.cash + p.bank - w).toBe(cash.reduce((a, x) => a + Math.trunc(x * 0.1), 0));
    const bank0 = p.bank, banks = rivals.map(q => q.bank);
    run('RW05');
    expect(p.bank - bank0).toBe(banks.reduce((a, x) => a + Math.trunc(x * 0.1), 0));
    // R06: 100 points each
    const pts = p.points;
    run('RW06');
    expect(p.points - pts).toBe(300);
    for (const q of rivals) expect(q.points).toBe(50);
    // R10: a rival's building down to nothing, three floors for the winner
    rivals.forEach((q, i) => { const l = lots[i * 3 + 1]; l.owner = q.id + 1; l.level = 3; l.chain = false; });
    const mine = lots.filter(l => l.owner === p.id + 1 && l.level < 5).map(l => l.level);
    run('RW10');
    for (const [i] of rivals.entries()) expect(lots[i * 3 + 1].level).toBe(0);
    expect(lots.filter(l => l.owner === p.id + 1 && l.level < 5).map(l => l.level).length).toBeLessThanOrEqual(mine.length);
    // R09: 冬眠 5
    run('RW09');
    for (const q of rivals) if (q.placed && !g.offRoad(q)) expect(q.sleep).toBe(5);
    // R07: prison 5 (a 免罪卡 saves its holder)
    rivals[0].cards = [21];
    run('RW07');
    expect(rivals[0].prison).toBe(0);
    expect(rivals[0].cards).toEqual([]);
    for (const q of rivals.slice(1)) expect(q.prison & 0x7f).toBe(5);
    run('RW08');
    expect(rivals[0].hospital & 0x7f).toBe(5);
    expect(REWARD_CARDS.length).toBe(10);
  });

  it('grades: N 7/10, R 2/10, SR 1/10; the amount grows with the grade; the draw stops on a back of its grade', () => {
    const g = make(1, 3), n = [0, 0, 0], ids: Record<string, number> = {};
    for (let seq = 0; seq < 4000; seq++) {
      const fx = playReward(g, g.players[0], seq).next().value as Extract<GameEvent, { t: 'fx' }>;
      const d = fx.data as { grade: 0 | 1 | 2; backs: number[]; at: number; id: string };
      n[d.grade]++; ids[d.id] = (ids[d.id] ?? 0) + 1;
      expect([...d.backs].sort()).toEqual([0, 0, 0, 0, 0, 0, 0, 1, 1, 2]);
      expect(d.backs[d.at]).toBe(d.grade);
    }
    // by weight of 27: money and points 4, 雁過拔毛 3, prison / hospital / 冬眠 2, 圈地為王 and 拆遷令 1
    for (const c of REWARD_CARDS) expect(ids[c.id] / 4000).toBeCloseTo(c.weight / 27, 1);
    expect(ids.RW03).toBeGreaterThan(ids.RW01); expect(ids.RW01).toBeGreaterThan(ids.RW07); expect(ids.RW07).toBeGreaterThan(ids.RW10);
    expect(n[0] / 4000).toBeCloseTo(0.7, 1); expect(n[1] / 4000).toBeCloseTo(0.2, 1); expect(n[2] / 4000).toBeCloseTo(0.1, 1);
    play(g, g.run(), x => x.daysElapsed >= 3);
    const p = g.players[0], q = g.players[1];
    for (const o of g.players.slice(2)) { o.cards = []; o.tools = o.tools.map(() => 0); }
    q.cards = [8, 2, 6, 7]; q.tools = q.tools.map(() => 0); q.tools[1] = 3; p.cards = []; p.tools[1] = 0;
    drain(playReward(g, p, 0, 'RW01', 2));
    expect(q.cards.length).toBe(1); expect(q.tools[1]).toBe(0); expect(p.tools[1]).toBe(3);
    const w = p.cash + p.bank;
    drain(playReward(g, p, 0, 'RW03', 1));
    expect(p.cash + p.bank - w).toBe(3 * 10000 * g.priceIndex);
  });

  it("a human's 全員住院 counts for them (送進醫院 task); a computer's counts for nobody, nor its money gains", () => {
    Challenge.forceMonthly = 'M028';   // 全員掛號: every rival sent to hospital by you
    try {
      for (const human of [true, false]) {
        const g = make(1, 11), c = g.challengeTracker!;
        play(g, g.run(), x => x.daysElapsed >= 3);
        const m = c.month!; m.mo = g.players.map(() => ({})); m.won = []; m.done = false; c.rewardsDue.length = 0;
        const p = g.players[0];
        p.human = human;
        for (const q of g.players) { q.cards = q.cards.filter(x => x !== 21 && x !== 19); q.luckFate = 0; q.luckMoney = 0; }
        c.see({ t: 'turn', p: 2 });            // someone else's turn ends; player 0 draws
        seen(g, playReward(g, p, 0, 'RW08', 0));
        expect(g.players.slice(1).every(q => (q.hospital & 0x7f) > 0)).toBe(true);
        expect(c.month!.won).toEqual(human ? [0] : []);
      }
      // a computer's 紅包 does not count toward its 小金庫 (cash up) card
      Challenge.forceMonthly = 'M051';
      const g = make(1, 12), c = g.challengeTracker!;
      play(g, g.run(), x => x.daysElapsed >= 3);
      const m = c.month!; m.won = []; m.done = false; c.rewardsDue.length = 0;
      const p = g.players[0];
      for (const q of g.players) { q.luckMoney = 0; q.cash = 500000; }
      for (const [i, q] of g.players.entries()) m.base[i].cash = q.cash;
      seen(g, playReward(g, p, 0, 'RW03', 2));
      expect(c.monthValue(p)).toBe(0);
      expect(c.month!.won).toEqual([]);
    } finally { Challenge.forceMonthly = ''; }
  });

  it('prison / hospital as a fate: a good god spares, a bad one doubles, a 免罪卡 cancels', () => {
    const g = make(1, 13);
    play(g, g.run(), x => x.daysElapsed >= 3);
    const [p, a, b, c] = g.players;
    for (const q of [a, b, c]) { q.cards = []; q.luckFate = 0; q.hospital = 0; q.prison = 0; }
    a.luckFate = 200; b.luckFate = -10; c.cards = [21];
    drain(playReward(g, p, 0, 'RW07', 0));
    expect(a.prison).toBe(0);
    expect(b.prison & 0x7f).toBe(10);
    expect(c.prison).toBe(0); expect(c.cards).toEqual([]);
  });

  it('a save in the middle keeps the cards owed and the card count', async () => {
    const { saveGame, loadGame } = await import('./save');
    const g = make(1, 5), flow = g.run();
    play(g, flow, x => x.daysElapsed >= 40);
    const c = g.challengeTracker!;
    c.rewardsDue.push(2); c.rewardSeq = 3;
    const s = JSON.parse(JSON.stringify(saveGame(g)));
    const h = loadGame(s, parseBoard(JSON.parse(readFileSync(mapFile(2), 'utf8')) as RawMap));
    expect(h.challengeTracker!.rewardsDue).toEqual([2]);
    expect(h.challengeTracker!.rewardSeq).toBe(3);
    expect(h.challengeTracker!.monthly).toBe(true);
    expect(h.challengeTracker!.month?.id).toBe(c.month?.id);
  });
});
