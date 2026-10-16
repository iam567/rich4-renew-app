import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBoard, type RawMap } from './board';
import { pack } from './date';
import type { Flow } from './flow';
import { Game } from './game';
import type { Answer, Ask, GameEvent, GameSettings } from './types';

const mapFile = (id: number) => fileURLToPath(new URL(`../../../editor/site/assets/map-${id}.json`, import.meta.url));
const haveMaps = existsSync(mapFile(1));

/** A placed game on map 1 (bank tile 110 → company 3 上海銀行, category 7); everyone on a plain road node. */
function newGame(players: { character: number; human: boolean }[], date = pack(2026, 10, 14)): Game {
  const board = parseBoard(JSON.parse(readFileSync(mapFile(1), 'utf8')) as RawMap);
  const settings: GameSettings = {
    mapId: 1, players, fundIndex: 1, traffic: 0, landLimitIndex: 0, daysLimitIndex: 0, victoryIndex: 0, startDate: date, seed: 1,
  };
  const g = new Game(settings, board);
  const road = g.board.nodes.find(n => n.event === 1 || (n.event === 0 && !n.ref))!;
  for (const p of g.players) {
    p.placed = true; p.whoPlays = p.human ? 1 : 2;
    p.node = road.id; p.lastNode = road.adjacent.find(Boolean)!;
    p.cash = 0; p.bank = 0;
  }
  for (const o of g.objects.slots) o.node = 0;
  return g;
}

function drive<T>(flow: Flow<T>, answer: (a: Ask) => Answer = () => undefined) {
  const events: GameEvent[] = [], asks: Ask[] = [];
  let r = flow.next();
  while (!r.done) {
    const s = r.value;
    if ('ask' in s) { asks.push(s); r = flow.next(answer(s)); } else { events.push(s); r = flow.next(); }
  }
  return { events, asks, value: r.value };
}

const said = (events: GameEvent[]) => events.flatMap(e => (e.t === 'say' ? [e.text] : []));
type BankAsk = Extract<Ask, { t: 'bank' }>;

describe.skipIf(!haveMaps)('special financing (02 §8.7)', () => {
  const setup = (humanFirst = true) => {
    const g = newGame([{ character: 0, human: humanFirst }, { character: 4, human: false }, { character: 9, human: false }]);
    const bankNode = g.board.nodes.find(n => n.event === 14)!;
    const bank = g.board.companies[bankNode.ref - 6001];
    const [p, q, r] = g.players;
    p.node = bankNode.id;
    return { g, bank, p, q, r };
  };

  it('the chairman\'s room is offered only to the human controlling this bank\'s company', () => {
    const { g, bank, p, q, r } = setup();
    expect(bank.category).toBe(7);
    q.bank = 30000; r.bank = 20000;
    let run = drive(g.bankCounter(p));
    expect((run.asks[0] as BankAsk).finance).toBeUndefined();
    bank.controller = p.id + 1;
    p.specialFinance = 1000;
    run = drive(g.bankCounter(p));
    expect((run.asks[0] as BankAsk).finance).toEqual({ total: 50000, used: 1000 });
    // A stray answer without the room does nothing.
    bank.controller = q.id + 1;
    drive(g.bankCounter(p), () => ({ finance: 5000 }));
    expect(p).toMatchObject({ bank: 0, specialFinance: 1000 });
  });

  it('週轉現金 adds to the deposit and the financing, up to the deposits of the others less what is out', () => {
    const { g, bank, p, q, r } = setup();
    bank.controller = p.id + 1;
    q.bank = 30000; r.bank = 20000; p.bank = 700; p.cash = 100;
    drive(g.bankCounter(p), () => ({ finance: 20000 }));
    expect(p).toMatchObject({ bank: 20700, cash: 100, specialFinance: 20000, loan: 0, loanDue: 0 });
    // The others' deposits are not touched; the limit is now 50000 - 20000.
    expect(q.bank + r.bank).toBe(50000);
    drive(g.bankCounter(p), () => ({ finance: 99999 }));
    expect(p.specialFinance).toBe(50000);
    expect(p.bank).toBe(50700);
    drive(g.bankCounter(p), () => ({ finance: 1 }));
    expect(p.specialFinance).toBe(50000);
  });

  it('suspended lending blocks 週轉現金 but not 歸還款項', () => {
    const { g, bank, p, q } = setup();
    bank.controller = p.id + 1;
    q.bank = 30000; p.noLoan = 5; p.specialFinance = 10000; p.bank = 10000;
    drive(g.bankCounter(p), () => ({ finance: 5000 }));
    expect(p.specialFinance).toBe(10000);
    drive(g.bankCounter(p), () => ({ financeRepay: 4000 }));
    expect(p).toMatchObject({ specialFinance: 6000, bank: 6000 });
  });

  it('歸還款項 takes the deposit first, then cash; more than both together is refused', () => {
    const { g, bank, p } = setup();
    bank.controller = p.id + 1;
    p.specialFinance = 9000; p.bank = 3000; p.cash = 4000;
    drive(g.bankCounter(p), () => ({ financeRepay: 8000 }));
    expect(p).toMatchObject({ specialFinance: 9000, bank: 3000, cash: 4000 });
    drive(g.bankCounter(p), () => ({ financeRepay: 5000 }));
    expect(p).toMatchObject({ specialFinance: 4000, bank: 0, cash: 2000 });
    // Never more than what is out.
    p.bank = 10000;
    drive(g.bankCounter(p), () => ({ financeRepay: 9000 }));
    expect(p).toMatchObject({ specialFinance: 0, bank: 6000, cash: 2000 });
  });

  it('computers and players on autopilot never use it', () => {
    const { g, bank, p, q } = setup(false);
    bank.controller = p.id + 1;
    q.bank = 1_000_000; p.bank = 50_000; p.cash = 50_000;
    const run = drive(g.bankCounter(p));
    expect(run.asks).toHaveLength(0);
    expect(p.specialFinance).toBe(0);
    const h = setup();
    h.bank.controller = h.p.id + 1;
    h.p.autopilot = true;
    expect(drive(h.g.bankCounter(h.p)).asks).toHaveLength(0);
  });

  it('financed money is not debt: it earns the monthly 10% and raises the loan limit (bug decision #13)', () => {
    const g = newGame([{ character: 0, human: true }, { character: 4, human: false }], pack(2026, 10, 31));
    const [p, q] = g.players;
    const bankNode = g.board.nodes.find(n => n.event === 14)!;
    g.board.companies[bankNode.ref - 6001].controller = 1;
    p.node = bankNode.id;
    q.bank = 100000;
    const before = g.wealth(p);
    drive(g.bankCounter(p), () => ({ finance: 100000 }));
    expect(g.wealth(p)).toBe(before + 100000);
    const ask = drive(g.bankCounter(p)).asks[0] as BankAsk;
    expect(ask.maxLoan).toBe(before + 100000);
    drive((g as unknown as { dailySettlement(): Flow }).dailySettlement());
    expect(p.bank).toBe(110000);
    expect(p.specialFinance).toBe(100000);
  });

  it('reserve check: when an ATM withdrawal leaves the deposits short, the operator covers the gap', () => {
    const { g, bank, p, q, r } = setup();
    bank.controller = p.id + 1;
    p.specialFinance = 50000; p.bank = 30000; p.cash = 5000;
    q.bank = 40000; r.bank = 15000; q.cash = 0;
    // A computer's ATM adjustment pulls q's deposit down to its cash ratio.
    const run = drive(g.atm(q));
    const deposits = q.bank + r.bank;
    expect(deposits).toBeLessThan(50000);
    const short = 50000 - deposits;
    expect(said(run.events)).toContain(`銀行資金準備\n\n不足${short}元\n\n由經營者${g.name(p.id)}墊付！`);
    expect(p.specialFinance).toBe(deposits);
    expect(p.bank).toBe(30000 - short);
  });

  it('reserve check: the operator\'s own withdrawals and deposits never trigger it; bankrupt players do not count', () => {
    const { g, bank, p, q, r } = setup();
    bank.controller = p.id + 1;
    p.specialFinance = 50000; p.bank = 60000;
    q.bank = 10000; r.bank = 0;
    drive(g.atm(p), () => ({ withdraw: 1000 }));
    expect(p.specialFinance).toBe(50000);
    // A human deposit does not check either; a human withdrawal does.
    q.whoPlays = 1; q.human = true; q.cash = 100;
    drive(g.atm(q), () => ({ deposit: 100 }));
    expect(p.specialFinance).toBe(50000);
    r.bank = 99999; r.whoPlays = 0; // out of the game: its deposit is no reserve
    drive(g.atm(q), () => ({ withdraw: 100 }));
    expect(p.specialFinance).toBe(10000);
    expect(p.bank).toBe(59000 - 40000);
  });

  it('reserve check can bankrupt the operator', () => {
    const { g, bank, p, q, r } = setup(false);
    bank.controller = p.id + 1;
    p.specialFinance = 50000; p.bank = 1000; p.cash = 1000;
    q.whoPlays = 1; q.human = true; q.bank = 20000; r.bank = 0;
    drive(g.atm(q), () => ({ withdraw: 20000 }));
    expect(p.bankrupt).toBe(true);
    expect(p.specialFinance).toBe(0);
  });

  it('change of operator: the former controller repays everything at once', () => {
    const { g, bank, p, q } = setup();
    bank.controller = q.id + 1;
    p.specialFinance = 30000; p.bank = 10000; p.cash = 25000;
    const run = drive(g.financeRecall());
    expect(said(run.events)).toEqual(['銀行經營權易主！', `${g.name(p.id)}\n\n強制償還30000元\n\n銀行特別融資！`]);
    expect(p).toMatchObject({ specialFinance: 0, bank: 0, cash: 5000 });
    // The operator keeps his own.
    q.specialFinance = 1000;
    drive(g.financeRecall());
    expect(q.specialFinance).toBe(1000);
    // Without any operator everybody's is recalled.
    bank.controller = 0; q.bank = 5000;
    drive(g.financeRecall());
    expect(q).toMatchObject({ specialFinance: 0, bank: 4000 });
  });

  it('the fate card that sells all shares hands the bank over and recalls the financing (rich4_fortune.asm:1089)', () => {
    const { g, bank, p, q } = setup();
    const slot = g.stocks.slotOf(bank);
    expect(slot).toBeGreaterThanOrEqual(0);
    g.stocks.stocks[slot].prevClose = g.stocks.stocks[slot].price;
    g.stocks.holding(q.id, slot).shares = 50; g.stocks.rerank(q.id, slot);
    g.stocks.holding(p.id, slot).shares = 100; g.stocks.rerank(p.id, slot);
    expect(bank.controller).toBe(p.id + 1);
    p.specialFinance = 1000; p.bank = 0; p.cash = 0;
    const price = g.stocks.stocks[slot].price;
    const run = drive(g.events.applyFate(p, 9));
    expect(bank.controller).toBe(q.id + 1);
    expect(said(run.events)).toContain('銀行經營權易主！');
    expect(p.specialFinance).toBe(0);
    expect(p.bank).toBe(Math.trunc(100 * price) - 1000);
  });

  it('bankruptcy clears the financing', () => {
    const { g, p, q } = setup();
    p.specialFinance = 1000; q.specialFinance = 0;
    drive(g.bankrupt(p));
    expect(p.specialFinance).toBe(0);
  });
});
