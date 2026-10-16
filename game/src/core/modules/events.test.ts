import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBoard, type RawMap } from '../board';
import { pack } from '../date';
import type { Flow } from '../flow';
import { Game } from '../game';
import { Rng } from '../rng';
import type { Answer, GameSettings, Player, Step } from '../types';
import { FATE_COUNT, NEWS_COUNT, shuffleDeck, type BoardFace, type EventResult } from './events';

const mapFile = (id: number) => fileURLToPath(new URL(`../../../../editor/site/assets/map-${id}.json`, import.meta.url));
const haveMaps = existsSync(mapFile(0)) && existsSync(mapFile(4));

function newGame(mapId = 0, seed = 99): Game {
  const board = parseBoard(JSON.parse(readFileSync(mapFile(mapId), 'utf8')) as RawMap);
  const settings: GameSettings = {
    mapId, players: [0, 4, 9, 11].map(character => ({ character, human: false })),
    fundIndex: 1, traffic: 0, landLimitIndex: 0, daysLimitIndex: 0, victoryIndex: 0, startDate: pack(2026, 10, 14), seed,
  };
  const g = new Game(settings, board);
  // Put everyone on the road, cleanly, whatever the other modules did at the start.
  g.players.forEach((p, i) => {
    Object.assign(p, { placed: true, whoPlays: 2, node: g.board.nodes[i * 7].id, traffic: 0, dice: 1, cash: 50000, bank: 50000, loan: 0, insurance: 0, god: 0, cards: [] as number[] });
    p.tools.fill(0);
  });
  for (const l of g.board.lands) { l.owner = 0; l.level = 0; l.chain = false; }
  for (const f of g.board.facilities) { f.owner = 0; f.level = 0; f.type = 0; }
  g.objects.luck = function* () { return 0; };
  g.cards.pardonOrFrame = function* (p: Player) { return p.id; };
  return g;
}

/** Runs a flow to the end, answering questions with the given answers; returns everything it yielded. */
function run(flow: Flow, answers: Answer[] = []): Step[] {
  const out: Step[] = [];
  for (let r = flow.next(); !r.done; r = flow.next('ask' in r.value ? answers.shift() : undefined)) out.push(r.value);
  return out;
}

const results = (steps: Step[]) =>
  steps.filter(s => s.t === 'fx' && s.kind === 'event-result').map(s => (s as unknown as { data: EventResult; node?: number }));

/** Every precondition of the news (06 §4.2) met at once. */
function richState(g: Game) {
  const [a, b, c, d] = g.players;
  b.prison = 3; c.hospital = 2; d.traffic = 1;
  const street = g.board.lands.filter(l => l.name === g.board.lands[0].name);
  for (const l of street) { l.owner = 2; l.level = 2; }
  g.board.lands[street.length + 3].owner = 1;
  g.stocks.holdings[a.id][0].shares = 2000;
  g.stocks.holdings[b.id][1].shares = 500;
  g.stocks.suspend(2, 5);
  const co = g.board.companies[0];
  co.controller = a.id + 1; co.fundA = 30000;
}

const shown = (steps: Step[], kind: 'fate' | 'news') =>
  steps.filter(s => s.t === 'fx' && s.kind === kind).map(s => (s as unknown as { data: { id: number } }).data.id);

describe('deck shuffle', () => {
  it('is the original pick-the-r-th-unused shuffle with one rand() per step', () => {
    const deck = shuffleDeck(new Rng(1), 5);
    // srand(1): 16838 % 5 = 3 → [0,1,2,4]; 5758 % 4 = 2 → [0,1,4]; 10113 % 3 = 0 → [1,4]; next % 2, % 1.
    const r = new Rng(1); r.rand(); r.rand(); r.rand();
    const fourth = r.rand() % 2;
    expect(deck).toEqual([3, 2, 0, ...(fourth ? [4, 1] : [1, 4])]);
  });
});

describe.skipIf(!haveMaps)('news and fate', () => {
  it('shuffles both decks once into permutations, the same for the same seed', () => {
    const a = newGame(0, 5), b = newGame(0, 5), c = newGame(0, 6);
    expect([...a.events.fateDeck].sort((x, y) => x - y)).toEqual(Array.from({ length: FATE_COUNT }, (_, i) => i));
    expect([...a.events.newsDeck].sort((x, y) => x - y)).toEqual(Array.from({ length: NEWS_COUNT }, (_, i) => i));
    expect(a.events.fateDeck).toEqual(b.events.fateDeck);
    expect(a.events.newsDeck).toEqual(b.events.newsDeck);
    expect(c.events.fateDeck).not.toEqual(a.events.fateDeck);
  });

  it('cycles the fate deck and consumes skipped entries', () => {
    const g = newGame();
    const p = g.players[0];
    // 0 (no built lot), 8 (no shares), 5 (nobody has cards) are skipped; 20 runs.
    g.events.fateDeck = [0, 8, 5, 20, ...Array.from({ length: 33 }, (_, i) => 21 + (i % 12))];
    g.events.fateNext = 0;
    const cash = p.cash;
    const steps = run(g.events.fate(p));
    expect(shown(steps, 'fate')).toEqual([20]);
    expect(g.events.fateNext).toBe(4);
    expect(p.cash).toBe(cash + 1000 * g.priceIndex);
    // The read position wraps around after the last entry.
    g.events.fateDeck = Array.from({ length: FATE_COUNT }, (_, i) => (i === 36 ? 21 : i === 0 ? 22 : 0));
    g.events.fateNext = 36;
    expect(shown(run(g.events.fate(p)), 'fate')).toEqual([21]);
    expect(g.events.fateNext).toBe(0);
    expect(shown(run(g.events.fate(p)), 'fate')).toEqual([22]);
    expect(g.events.fateNext).toBe(1);
  });

  it('rewrites vehicle entries by the current vehicle and skips the map prison entries on stage 1 maps', () => {
    const g = newGame(0), p = g.players[0];
    expect(g.events.fateCheck(p, 10)).toBe(-1);
    expect(g.events.fateCheck(p, 13)).toBe(12);
    expect(g.events.fateCheck(p, 16)).toBe(14);
    p.traffic = 2;
    expect(g.events.fateCheck(p, 10)).toBe(11);
    expect(g.events.fateCheck(p, 12)).toBe(-1);
    expect(g.events.fateCheck(p, 14)).toBe(16);
    expect(g.events.fateCheck(p, 35)).toBe(35);
    const h = newGame(4);
    expect(h.events.fateCheck(h.players[0], 35)).toBe(-1);
  });

  it('cycles the news deck, skipping unmet entries', () => {
    const g = newGame();
    // 0 (nobody in prison), 4 (no buildings), 28 (no suspended stock) are skipped; 22 runs.
    g.events.newsDeck = [0, 4, 28, 22, ...Array.from({ length: 32 }, () => 23)];
    g.events.newsNext = 0;
    const steps = run(g.events.news(g.players[1]));
    expect(shown(steps, 'news')).toEqual([22]);
    expect(g.events.newsNext).toBe(4);
    for (const p of g.players) expect(p.noLoan).toBe(15);
  });

  it('charges fines × price index to the lottery pool and refunds insured players', () => {
    const g = newGame(), p = g.players[0];
    g.priceIndex = 2;
    run(g.events.applyFate(p, 26));
    expect(p.cash + p.bank).toBe(100000 - 16000);
    expect(g.lotteryPool).toBe(16000);
    // Insured: the first insurance company pays the whole fine back into cash.
    const insurer = g.board.companies.find(c => c.category === 4);
    p.insurance = 5;
    const before = p.cash + p.bank;
    run(g.events.applyFate(p, 18));
    expect(p.cash + p.bank).toBe(before - (insurer ? 0 : 1200));
  });

  it('lets the god luck check void, double or waive money and misfortune', () => {
    const g = newGame(), p = g.players[0];
    let r = 1;
    g.objects.luck = function* () { return r; };
    const cash = p.cash;
    run(g.events.applyFate(p, 25)); // inheritance voided
    expect(p.cash).toBe(cash);
    run(g.events.applyFate(p, 23)); // lost wallet waived
    expect(p.cash + p.bank).toBe(100000);
    r = 2;
    run(g.events.applyFate(p, 27)); // invoice prize doubled
    expect(p.cash).toBe(cash + 8000);
    run(g.events.applyFate(p, 24)); // lost wallet doubled
    expect(g.lotteryPool).toBe(4000);
    run(g.events.applyFate(p, 7)); // alien abduction doubled to 6 days
    expect(p.vanish).toBe(0x40 | 6);
    const q = g.players[1];
    run(g.events.applyFate(q, 3)); // no doubling branch for the bank refusal
    expect(q.bankRefused).toBe(30);
    r = 1;
    run(g.events.applyFate(q, 12)); // escaped
    expect(q.hospital).toBe(0);
  });

  it('birthday takes one card from each holder and marks the last; the lost vehicle says which one (fortune.asm)', () => {
    const g = newGame();
    const [p, a, b, c] = g.players;
    a.cards = [3]; b.cards = []; c.cards = [5, 6];
    const taken = run(g.events.applyFate(p, 5)).filter(s => s.t === 'fx' && s.kind === 'card-taken') as unknown as { target: number; data: { last: boolean } }[];
    expect(taken.map(s => [s.target, s.data.last])).toEqual([[a.id, false], [c.id, true]]);
    expect(p.cards.length).toBe(2);
    p.traffic = 2;
    expect(run(g.events.applyFate(p, 11))).toContainEqual({ t: 'fx', kind: 'vehicle-lost', p: p.id, data: { car: true } });
    expect(p.traffic & 3).toBe(0);
  });

  it('lets a pardon card cancel and a frame card move a fate prison sentence', () => {
    const g = newGame(), p = g.players[0];
    g.cards.pardonOrFrame = function* () { return -1; };
    run(g.events.applyFate(p, 36));
    expect(p.prison).toBe(0);
    g.cards.pardonOrFrame = function* () { return 2; };
    run(g.events.applyFate(p, 34));
    expect(p.prison).toBe(0);
    expect(g.players[2].prison).toBe(5);
    expect(g.players[2].node).toBe(g.prisonNode().id);
  });

  it('demolishes and compensates without the price index (fate 0, 1)', () => {
    const g = newGame(), p = g.players[0];
    g.priceIndex = 3;
    const [a, b] = g.board.lands;
    a.owner = 1; a.level = 3; b.owner = 1; b.level = 0;
    const cash = p.cash;
    run(g.events.applyFate(p, 0));
    expect(a.level).toBe(0);
    expect(a.owner).toBe(1);
    expect(p.cash).toBe(cash + 3 * a.perLevel);
    run(g.events.applyFate(p, 1));
    expect(a.owner + b.owner).toBe(1); // one of the two empty lots taken back
  });

  it('runs the demolition news on a whole street and with the documented modes', () => {
    const g = newGame();
    const name = g.board.lands[0].name;
    const street = g.board.lands.filter(l => l.name === name);
    for (const l of street) { l.owner = 2; l.level = 2; }
    const f = g.board.facilities[0];
    if (f) { f.owner = 3; f.level = 1; f.type = 2; }
    const ref = street[0].id + 2000;
    // Monster (5) with only one candidate: back to an ownerless lot.
    for (const l of street.slice(1)) l.level = 0;
    if (f) f.level = 0;
    run(g.events.applyNews(g.players[0], 5));
    expect(street[0]).toMatchObject({ owner: 0, level: 0 });
    // Earthquake (18) on that street: every lot one level down.
    for (const l of street) { l.owner = 2; l.level = 2; }
    const all = [...g.board.lands.map(l => l.id + 2000), ...g.board.facilities.map(x => x.id + 4000)];
    const pick = all.indexOf(ref);
    // Find a seed state that picks our street: drive rand() until rand() % n hits it.
    for (let tries = 0; tries < 100000; tries++) {
      const s = g.rng.seed;
      if (g.rng.rand() % all.length === pick) { g.rng.reseed(s); break; }
    }
    run(g.events.applyNews(g.players[0], 18));
    for (const l of street) expect(l).toMatchObject({ owner: 2, level: 1 });
    // Gas explosion (15) with no built lot: nothing happens (bug #8), only a text.
    for (const l of g.board.lands) l.level = 0;
    if (f) { f.level = 1; f.type = 2; }
    const steps = run(g.events.applyNews(g.players[0], 15));
    expect(shown(steps, 'news')).toEqual([15]);
  });

  it('pays news awards and taxes', () => {
    const g = newGame();
    g.priceIndex = 2;
    g.board.lands[0].owner = 2; g.board.lands[1].owner = 2; g.board.lands[2].owner = 3;
    run(g.events.applyNews(g.players[0], 8));
    expect(g.players[1].cash).toBe(50000 + 20000);
    run(g.events.applyNews(g.players[0], 9));
    expect(g.players[0].cash).toBe(50000 + 10000); // fewest (0), ties to the lower id
    run(g.events.applyNews(g.players[0], 11)); // 5% of cash, not × F
    expect(g.players[3].cash).toBe(50000 - 2500);
    expect(g.lotteryPool).toBe(3000 + 3500 + 2500 + 2500);
    run(g.events.applyNews(g.players[0], 23)); // 10% deposit bonus for those without a loan
    expect(g.players[3].bank).toBe(55000);
  });

  it('stays everyone walking for one turn on heavy rain', () => {
    const g = newGame();
    g.players[2].traffic = 1;
    run(g.events.applyNews(g.players[0], 16));
    expect(g.players.map(p => p.stay)).toEqual([1, 1, 0, 1]);
  });

  it('runs the stock news: suspension 10 days (bug #6), resumption, profit doubling (bug #7)', () => {
    const g = newGame();
    const steps = run(g.events.applyNews(g.players[0], 27));
    expect(shown(steps, 'news')).toEqual([27]);
    const slots = g.stocks.suspendedSlots();
    expect(slots).toHaveLength(1);
    expect(g.stocks.stocks[slots[0]].suspendDays).toBe(10);
    expect(g.events.newsCheck(28)).toBe(true);
    run(g.events.applyNews(g.players[0], 28));
    expect(g.stocks.suspendedSlots()).toEqual([]);
    const c = g.board.companies.find(x => x.stockSlot < 12)!;
    for (const x of g.board.companies) x.fundA = 0;
    c.fundA = 30000; c.fundB = 50000;
    run(g.events.applyNews(g.players[0], 35));
    expect(c.fundA).toBe(60000);
    expect(c.fundB).toBe(80000);
    expect(g.stocks.stocks[c.stockSlot].forced).toBe(0x30);
  });

  it('plays a deterministic sequence for the same seed', () => {
    const trace = (seed: number) => {
      const g = newGame(1, seed), out: number[] = [];
      for (let i = 0; i < 80; i++) {
        const p = g.players[i % 4];
        out.push(...shown(run(i & 1 ? g.events.fate(p) : g.events.news(p)), i & 1 ? 'fate' : 'news'));
        for (const q of g.players) if (!q.whoPlays && !q.bankrupt) q.whoPlays = 2;
      }
      return { out, cash: g.players.map(p => p.cash + p.bank) };
    };
    expect(trace(11)).toEqual(trace(11));
  });

  it('ends every news entry with one result box after the board (event-result fx)', () => {
    for (let ev = 0; ev < NEWS_COUNT; ev++) {
      const g = newGame();
      richState(g);
      expect(g.events.newsCheck(ev), `news ${ev}`).toBe(true);
      const steps = run(g.events.applyNews(g.players[0], ev));
      const rs = results(steps);
      expect(rs, `news ${ev}`).toHaveLength(1);
      const r = rs[0].data;
      expect(r).toMatchObject({ src: 'news', id: ev });
      expect(typeof r.fx).toBe('string');
      expect(r.head.length, `news ${ev}`).toBeGreaterThan(0);
      expect(r.lines.length, `news ${ev}`).toBeGreaterThan(0);
      for (const l of r.lines) expect(l.text.length).toBeGreaterThan(0);
      // The board comes first; money of a news entry moves without a message box of its own (the auction
      // room of news 7 keeps its own).
      expect(steps.findIndex(s => s.t === 'fx' && s.kind === 'news')).toBeLessThan(steps.indexOf(rs[0] as unknown as Step));
      for (const s of steps) if (s.t === 'pay' && s.reason !== '拍賣') expect(s.quiet, `news ${ev} ${s.reason}`).toBe(true);
    }
  });

  it('names who got and paid what in the news results and on the board', () => {
    const g = newGame();
    g.priceIndex = 2;
    g.board.lands[0].owner = 2; g.board.lands[1].owner = 2; g.board.lands[2].owner = 3;
    let steps = run(g.events.applyNews(g.players[0], 9));
    // news.asm #0158: the board names the winner and the sum, with the face.
    const board = steps.find(s => s.t === 'fx' && s.kind === 'news') as unknown as { data: { text: string; faces: BoardFace[] } };
    expect(board.data.text).toContain(`${g.name(0)}獲得10000元`);
    expect(board.data.faces).toEqual([{ p: 0, amount: 10000 }]);
    expect(results(steps)[0].data).toMatchObject({ fx: 'subsidy', line: 'gain', amount: 10000, lines: [{ p: 0, amount: 10000 }], focus: [0] });
    // Income tax: one box for everyone, with each sum (the original's 「%s繳交%d元」 lines on the board).
    g.players[2].cash = 0;
    steps = run(g.events.applyNews(g.players[0], 11));
    const r = results(steps)[0].data;
    expect(r.fx).toBe('tax');
    expect(r.lines.map(l => [l.p, l.amount])).toEqual([[0, -3000], [1, -2500], [3, -2500]]);
    const faces = (steps.find(s => s.t === 'fx' && s.kind === 'news') as unknown as { data: { faces: BoardFace[] } }).data.faces;
    expect(faces).toEqual([{ p: 0, amount: -3000 }, { p: 1, amount: -2500 }, { p: 3, amount: -2500 }]);
    // Gas explosion: where and how, at the lot's node.
    const l = g.board.lands[5];
    l.owner = 4; l.level = 3;
    steps = run(g.events.applyNews(g.players[0], 15));
    const gas = results(steps)[0];
    expect(gas.data).toMatchObject({ fx: 'explosion', refs: [l.id + 2000], line: 'cry', lines: [{ p: 3, text: `${l.name}瓦斯氣爆，房屋降為2級` }] });
    expect(gas.node).toBe(g.board.nodes.find(n => n.ref === l.id + 2000)?.id);
  });

  it('ends every fate entry with one result box', () => {
    const traffic: Record<number, number> = { 10: 1, 11: 2, 13: 1, 15: 1, 16: 2 };
    for (let t = 0; t < FATE_COUNT; t++) {
      const g = newGame(0), p = g.players[0];
      p.traffic = traffic[t] ?? 0;
      g.board.lands[0].owner = 1; g.board.lands[0].level = 2; g.board.lands[1].owner = 1;
      g.players[1].cards = [3, 4];
      g.stocks.holdings[p.id][0].shares = 100;
      const e = g.events.fateCheck(p, t);
      expect(e, `fate ${t}`).toBe(t);
      const steps = run(g.events.applyFate(p, t));
      const rs = results(steps);
      expect(rs, `fate ${t}`).toHaveLength(1);
      expect(rs[0].data).toMatchObject({ src: 'fate', id: t, title: '命運' });
      expect(rs[0].data.lines.length, `fate ${t}`).toBeGreaterThan(0);
      for (const s of steps) if (s.t === 'pay' && s.reason !== '理賠金') expect(s.quiet, `fate ${t}`).toBe(true);
    }
  });

  it('tells the fate result with the god luck: waived, voided, doubled, escaped', () => {
    const g = newGame(), p = g.players[0];
    let r = 1;
    g.objects.luck = function* () { return r; };
    const one = (t: number) => results(run(g.events.applyFate(p, t)))[0].data;
    expect(one(14)).toMatchObject({ fx: 'blessed', line: 'free', amount: 3000 });
    expect(one(25)).toMatchObject({ fx: 'cursed' });
    expect(one(7)).toMatchObject({ fx: 'blessed' });
    r = 2;
    expect(one(18)).toMatchObject({ fx: 'fine', line: 'loss', amount: 1200, lines: [{ p: 0, amount: -1200 }] });
    expect(one(20)).toMatchObject({ fx: 'gain', line: 'gain', amount: 2000, lines: [{ p: 0, amount: 2000 }] });
    expect(one(6)).toMatchObject({ fx: 'abroad', lines: [{ p: 0, text: '出國觀光6天（倒楣加倍）' }] });
    // A frame card moves the sentence: both are named.
    r = 0;
    g.cards.pardonOrFrame = function* () { return 2; };
    expect(one(33).lines.map(l => l.p)).toEqual([0, 2]);
    // Demolition: the lot, its node and the compensation, then the owner's cry.
    const l = g.board.lands[0];
    l.owner = 1; l.level = 2;
    const res = results(run(g.events.applyFate(p, 0)))[0];
    expect(res.data).toMatchObject({ fx: 'demolish', refs: [l.id + 2000], line: 'cry', lines: [{ p: 0, amount: 2 * l.perLevel }] });
    expect(res.node).toBe(g.board.nodes.find(n => n.ref === l.id + 2000)?.id);
  });
});
