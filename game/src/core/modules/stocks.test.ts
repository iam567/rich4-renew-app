import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBoard, type RawMap } from '../board';
import { addDays, pack, weekday, type PackedDate } from '../date';
import type { Flow } from '../flow';
import { Game } from '../game';
import type { Answer, GameSettings, Step } from '../types';
import { adjustPrice, formatPrice, STOCK_TABLE, Trend, trendOf } from './stocks';

const mapFile = (id: number) => fileURLToPath(new URL(`../../../../editor/site/assets/map-${id}.json`, import.meta.url));
const haveMaps = existsSync(mapFile(2));

/** A weekday (Wednesday) and a Sunday. */
const WED = pack(2026, 10, 14);
const SUN = pack(2026, 10, 18);

function makeGame(mapId = 2, seed = 1, startDate: PackedDate = WED, characters = [0, 1, 3, 4]): Game {
  const board = parseBoard(JSON.parse(readFileSync(mapFile(mapId), 'utf8')) as RawMap);
  const settings: GameSettings = {
    mapId, players: characters.map(character => ({ character, human: false })),
    fundIndex: 1, traffic: 0, landLimitIndex: 0, daysLimitIndex: 0, victoryIndex: 0, startDate, seed,
  };
  const g = new Game(settings, board);
  for (const p of g.players) { p.whoPlays = 2; p.placed = true; }
  return g;
}

/** Runs a flow to the end, answering questions from the list. */
function drive<T>(flow: Flow<T>, answers: Answer[] = []): { result: T; steps: Step[] } {
  const steps: Step[] = [];
  let r = flow.next();
  while (!r.done) {
    steps.push(r.value);
    r = flow.next('ask' in r.value ? answers.shift() : undefined);
  }
  return { result: r.value, steps };
}

/** Next weekday on or after a date. */
function weekdayFrom(d: PackedDate): PackedDate {
  while (weekday(d) === 0) d = addDays(d, 1);
  return d;
}

describe('price step and trend states (03 §4.4-§4.5)', () => {
  it('rounds the change towards zero to the tick', () => {
    expect(adjustPrice(100, 10)).toBe(Math.fround(110));
    expect(adjustPrice(100, 0)).toBe(100);
    expect(adjustPrice(200, 3.7)).toBe(207);
    expect(adjustPrice(200, -3.7)).toBe(193);
    expect(adjustPrice(20, 2.6)).toBe(Math.fround(20.5)); // cand 20.52, tick 0.1
    expect(adjustPrice(1, -10)).toBe(1);
    expect(adjustPrice(9500, 10)).toBe(9999);
  });

  it('never moves more than the momentum and always by whole ticks of the candidate', () => {
    let seed = 12345;
    const next = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) >>> 8) / 16777216;
    for (let i = 0; i < 2000; i++) {
      const prev = Math.fround(1 + next() * 2000), pct = Math.fround(next() * 20 - 10);
      const r = adjustPrice(prev, pct);
      expect(Math.abs(r - prev)).toBeLessThanOrEqual(Math.abs((prev * pct) / 100) + 1e-3);
      const cand = (prev * (pct + 100)) / 100;
      const tick = cand < 5 ? 0.01 : cand < 15 ? 0.05 : cand < 50 ? 0.1 : cand < 150 ? 0.5 : 1;
      const k = (r - prev) / tick;
      if (r > 1 && r < 9999) expect(Math.abs(k - Math.round(k))).toBeLessThan(1e-2);
    }
  });

  it('classifies the five states', () => {
    const s = { price: 0, prevClose: 100 } as Parameters<typeof trendOf>[0];
    s.price = adjustPrice(100, 10); expect(trendOf(s)).toBe(Trend.LimitUp);
    s.price = 105; expect(trendOf(s)).toBe(Trend.Up);
    s.price = adjustPrice(100, -10); expect(trendOf(s)).toBe(Trend.LimitDown);
    s.price = 95; expect(trendOf(s)).toBe(Trend.Down);
    s.price = 100; expect(trendOf(s)).toBe(Trend.Flat);
    expect(formatPrice(12.345)).toBe('12.35');
    expect(formatPrice(43.94)).toBe('43.9');
    expect(formatPrice(207.9)).toBe('207');
  });
});

describe.skipIf(!haveMaps)('stocks on the original maps', () => {
  it('loads the map group, links companies and sets the primary shares (03 §2-§3.1)', () => {
    for (let mapId = 0; mapId < 8; mapId++) {
      const g = makeGame(mapId);
      const st = g.stocks;
      expect(st.stocks.map(s => s.name)).toEqual(STOCK_TABLE[mapId].map(t => t.name));
      g.board.companies.forEach((c, j) => {
        const s = st.stocks[c.stockSlot];
        expect(s.companyId).toBe(j + 1);
        expect(c.freeShares).toBe(10000 - STOCK_TABLE[mapId][c.stockSlot].float);
        expect(st.slotOf(c)).toBe(c.stockSlot);
      });
      expect(st.stocks.filter(s => s.companyId).length).toBe(g.board.companies.length);
      for (const s of st.stocks) {
        if (s.floatPool <= 1000) expect(s.turnQuota).toBe(s.floatPool);
        else { expect(s.turnQuota).toBeGreaterThanOrEqual(s.floatPool / 10); expect(s.turnQuota).toBeLessThan(s.floatPool * 0.3); }
      }
    }
    // 日產建設 sells 5000 primary shares at 24 each, the stock opens at 28.
    const g = makeGame(2);
    const nissan = g.board.companies[2];
    expect(nissan.name).toBe('日產建設');
    expect(nissan.freeShares).toBe(5000);
  });

  it('updates prices once at the start on an open day, not on a Sunday (03 §4.1-§4.2)', () => {
    const open = makeGame(2, 1, WED);
    expect(open.stocks.cursor).toBe(1);
    expect(open.stocks.stocks.every(s => s.history[0] === s.price)).toBe(true);
    const sunday = makeGame(2, 1, SUN);
    expect(sunday.stocks.open()).toBe(false);
    expect(sunday.stocks.cursor).toBe(0);
    expect(sunday.stocks.stocks.every(s => s.price === s.basePrice)).toBe(true);
  });

  it('draws the market drift, then one impulse per free stock, in slot order (03 §4.3)', () => {
    const g = makeGame(2);
    const st = g.stocks;
    st.stocks[0].suspendDays = 3;
    st.stocks[1].forced = 0x10;
    st.stocks[2].forced = 0x01;
    const before = st.stocks.map(s => ({ price: s.price, momentum: s.momentum }));
    const seed = 777;
    g.rng.reseed(seed);
    let calls = 0;
    const rand = g.rng.rand.bind(g.rng);
    g.rng.rand = () => { calls++; return rand(); };
    expect(st.update()).toBe(true);
    expect(calls).toBe(1 + 9);
    // Recompute independently with the same generator sequence.
    g.rng.rand = rand;
    g.rng.reseed(seed);
    const f = Math.fround;
    const m = f((g.rng.rand() - 16384) / 4097);
    expect(st.drift).toBe(m);
    st.stocks.forEach((s, i) => {
      const prev = before[i].price;
      expect(s.prevClose).toBe(prev);
      if (i === 0) { expect(s.momentum).toBe(0); expect(s.price).toBe(prev); return; }
      if (i === 1) { expect(s.price).toBe(adjustPrice(prev, 10)); expect(trendOf(s)).toBe(Trend.LimitUp); return; }
      if (i === 2) { expect(s.price).toBe(adjustPrice(prev, -10)); expect(trendOf(s)).toBe(Trend.LimitDown); return; }
      const r = (g.rng.rand() - 16384) / 1171;
      let mom = f(f(before[i].momentum + r * s.volatility) + m);
      const c = st.companyOf(i);
      const ref = c ? c.value / 10000 : s.basePrice, hi = c ? 3 : 8, lo = c ? 0.85 : 0.5;
      if (prev > ref) { if (prev > ref * hi) mom = f(mom * (mom > 0 ? 0.5 : 2)); }
      else if (prev < ref * lo) mom = f(mom * (mom > 0 ? 2 : 0.5));
      mom = Math.max(-10, Math.min(10, mom));
      expect(s.momentum).toBe(mom);
      expect(s.price).toBe(adjustPrice(prev, mom));
    });
    const sum = st.stocks.reduce((a, s) => f(a + s.price), 0);
    expect(st.index).toBe(Math.trunc(sum * 10));
    expect(st.cursor).toBe(2);
  });

  it('pulls prices back towards the company value or the base price (03 §4.3)', () => {
    const g = makeGame(2);
    const st = g.stocks;
    g.rng.rand = () => 16384; // no impulse, no drift
    const set = (slot: number, price: number, momentum: number) => { const s = st.stocks[slot]; s.price = Math.fround(price); s.momentum = momentum; };
    set(1, 300, 8); // 三井生命, worth 79: above 3 × 79 positive momentum halves
    set(3, 300, -3); // 日產建設, worth 24.4: above 3 × 24.4 negative momentum doubles
    set(4, 100, 4); // ＳＥＧＡ, worth 240: below 0.85 × 240 positive momentum doubles
    set(5, 20, -6); // 豐田汽車, worth 27: below 0.85 × 27 negative momentum halves
    set(6, 5000, 6); // 松下電機, not linked, base 540: above 8 × 540 halves
    set(7, 400, -7); // 日立機電, base 830: below 0.5 × 830 halves
    set(8, 300, 7); // ＳＯＮＹ, at its base: unchanged
    set(9, 225, 30); // clamped to 10
    st.update();
    expect([1, 3, 4, 5, 6, 7, 8, 9].map(i => st.stocks[i].momentum)).toEqual([4, -6, 8, -3, 3, -3.5, 7, 10]);
  });

  it('closes the market for news day + 10 day changes and counts down suspensions anyway (03 §4.1, §4.2)', () => {
    const g = makeGame(2);
    const st = g.stocks;
    st.closeMarket();
    st.stocks[4].suspendDays = 2;
    const cursor = st.cursor;
    let closedDays = 0;
    for (let i = 0; i < 11; i++) {
      g.date = weekdayFrom(addDays(g.date, 1));
      drive(st.daily());
      if (!st.open()) closedDays++;
    }
    expect(closedDays).toBe(10);
    expect(st.stocks[4].suspendDays).toBe(0);
    expect(st.cursor).toBe((cursor + 1) % 144); // only the 11th day updated
  });

  it('forces limits at once and keeps them for the set number of days (03 §4.6, §8)', () => {
    const g = makeGame(2);
    const st = g.stocks;
    st.forceLimit(7, true); // red card: 2 days including today
    expect(st.trend(7)).toBe(Trend.LimitUp);
    expect(st.stocks[7].history[(st.cursor + 143) % 144]).toBe(st.stocks[7].price);
    g.date = weekdayFrom(addDays(g.date, 1));
    drive(st.daily());
    expect(st.trend(7)).toBe(Trend.LimitUp);
    expect(st.stocks[7].forced).toBe(0x10);
    g.date = weekdayFrom(addDays(g.date, 1));
    drive(st.daily());
    expect(st.stocks[7].forced).toBe(0);
    expect(st.stocks[7].momentum).not.toBe(10 + 1); // momentum carries on from +10 (03 §4.3)
    st.forceLimit(-1, false); // news: every stock limit down today only
    expect(st.stocks.every(s => trendOf(s) === Trend.LimitDown || s.price === 1)).toBe(true);
    expect(st.stocks.every(s => s.forced === 1)).toBe(true);
    g.date = weekdayFrom(addDays(g.date, 1));
    drive(st.daily());
    expect(st.stocks.every(s => s.forced === 0)).toBe(true);
  });

  it('suspends a stock for 10 days per bug decision #6', () => {
    const g = makeGame(2);
    const st = g.stocks;
    st.forceLimit(9, true);
    st.suspend(9);
    expect(st.stocks[9].price).toBe(st.stocks[9].prevClose);
    expect(st.suspendedSlots()).toEqual([9]);
    st.resume(9);
    expect(st.suspendedSlots()).toEqual([]);
  });

  it('ranks shareholders: ties keep the earlier player, only the mover is re-ranked (03 §3.2)', () => {
    const g = makeGame(2);
    const st = g.stocks;
    const c = g.board.companies[3]; // 三井生命, slot 1
    const [a, b, c2] = g.players;
    for (const p of g.players) p.bank = 10_000_000;
    st.stocks[1].turnQuota = 5000;
    expect(st.buyMarket(a, 1, 100)).toBe(true);
    expect(c.controller).toBe(1);
    expect(st.buyMarket(b, 1, 100)).toBe(false); // tie: a stays first
    expect(c.controller).toBe(1);
    expect(st.buyMarket(b, 1, 1)).toBe(true);
    expect(c.controller).toBe(2);
    st.buyMarket(c2, 1, 50);
    expect(st.ranks[3]).toEqual([2, 1, 3, 0]);
    st.sell(b, 1, 101, true);
    expect(st.ranks[3]).toEqual([1, 3, 0, 0]);
    expect(c.controller).toBe(1);
    // A private sale only re-ranks the buyer: the seller keeps its place.
    st.transferShares(a.id, c2.id, 1, 60, 40);
    expect(st.holding(0, 1).shares).toBe(40);
    expect(st.holding(2, 1).shares).toBe(110);
    expect(st.ranks[3]).toEqual([3, 1, 0, 0]);
  });

  it('keeps market money in the deposit and subscriptions in cash (03 §5.2-§5.5)', () => {
    const g = makeGame(2);
    const st = g.stocks;
    const p = g.players[0];
    p.bank = 10000; p.cash = 500;
    const s = st.stocks[6];
    s.turnQuota = 100;
    const pool = s.floatPool;
    st.buyMarket(p, 6, 10);
    expect(p.bank).toBe(10000 - Math.trunc(10 * s.price));
    expect(p.cash).toBe(500);
    expect(s.floatPool).toBe(pool - 10);
    expect(s.turnQuota).toBe(90);
    expect(st.holding(0, 6).avgCost).toBe(Math.fround(Math.trunc(10 * s.price) / 10));
    const pot = g.lotteryPool;
    drive(st.sellAll(p, true));
    expect(g.lotteryPool).toBe(pot + Math.trunc(10 * s.price));
    expect(st.holding(0, 6)).toEqual({ shares: 0, avgCost: 0 });
    expect(s.floatPool).toBe(pool);
  });

  it('pays dividends by holding, charges negative surplus and keeps surplus without holders (03 §6.2)', () => {
    const g = makeGame(2);
    const st = g.stocks;
    const [a, b, c] = g.players;
    const toyota = g.board.companies[1], sega = g.board.companies[4], nissan = g.board.companies[2];
    st.holding(0, 5).shares = 3000; st.holding(1, 5).shares = 1000;
    toyota.fundA = 10001; toyota.fundB = 10001;
    sega.fundA = 5000;
    nissan.fundA = -2500; st.holding(2, 3).shares = 10;
    a.bank = 0; b.bank = 0; c.bank = 1000; c.cash = 2000;
    const { steps } = drive(st.dividends());
    // The 「上市公司分紅」 table gets every company's surplus and each player's share of it.
    const table = steps.find(s => s.t === 'fx' && s.kind === 'dividends') as unknown as { data: { rows: { company: string; profit: number; each: number[] }[]; pay: number[] } };
    const row = table.data.rows.find(r => r.company === toyota.name)!;
    expect(row).toEqual({ company: toyota.name, profit: 10001, each: [Math.trunc(10001 * Math.fround(0.75)), Math.trunc(10001 * Math.fround(0.25)), 0, 0] });
    expect(table.data.pay[0]).toBe(row.each[0]);
    expect(a.bank).toBe(Math.trunc(10001 * Math.fround(0.75)));
    expect(b.bank).toBe(Math.trunc(10001 * Math.fround(0.25)));
    expect(toyota.fundA).toBe(0);
    expect(toyota.fundB).toBe(10001);
    expect(sega.fundA).toBe(5000);
    expect(c.bank).toBe(0);
    expect(c.cash).toBe(2000 - 1500);
    expect(nissan.fundA).toBe(0);
  });

  it('negative dividends can bankrupt a player', () => {
    const g = makeGame(2);
    const st = g.stocks;
    const p = g.players[3];
    st.holding(3, 3).shares = 10;
    g.board.companies[2].fundA = -50000;
    p.bank = 100; p.cash = 100;
    const { steps } = drive(st.dividends());
    expect(p.bankrupt).toBe(true);
    expect(steps.some(s => s.t === 'bankrupt')).toBe(true);
  });

  it('adds share values with per-stock truncation (02 §7.1)', () => {
    const g = makeGame(2);
    const st = g.stocks;
    const p = g.players[0];
    st.stocks[0].price = Math.fround(33.3);
    st.stocks[1].price = Math.fround(10.5);
    st.holding(0, 0).shares = 3;
    st.holding(0, 1).shares = 1;
    // 1000 + 99.9 → 1099, + 10.5 → 1109 (one sum would give 1110)
    expect(st.holdingsValue(1000, p)).toBe(1109);
    expect(st.shareCount(p)).toBe(4);
    expect(st.shareValue(p)).toBe(1109 - 1000);
  });

  it('charges company fees into company funds and offers the subscription (02 §5, 03 §5.5)', () => {
    const g = makeGame(2);
    const st = g.stocks;
    const sega = g.board.companies[4]; // 電腦 category 3, fee 150 × days elapsed
    const [visitor, boss] = g.players;
    st.holding(1, 4).shares = 1; st.rerank(1, 4);
    expect(sega.controller).toBe(boss.id + 1);
    g.daysElapsed = 12;
    visitor.cash = 500_000; visitor.bank = 0;
    drive(st.landOnCompany(visitor, sega));
    expect(sega.fundA).toBe(150 * 12);
    expect(sega.fundB).toBe(150 * 12);
    // Computer subscription: keeps 30% of the fund × PI in cash, at most 1000 shares, 240 each.
    expect(st.holding(0, 4).shares).toBe(1000);
    expect(sega.freeShares).toBe(4000);
    expect(visitor.cash).toBe(500_000 - 150 * 12 - 1000 * 240);
    expect(sega.controller).toBe(visitor.id + 1);
  });

  it('gives a free double build to the construction company controller and charges visitors (02 §5)', () => {
    const g = makeGame(2);
    const st = g.stocks;
    const nissan = g.board.companies[2]; // 建設 category 11
    const [boss, visitor] = g.players;
    st.holding(0, 3).shares = 1; st.rerank(0, 3);
    const lot = g.board.lands[0];
    lot.owner = boss.id + 1; lot.level = 1;
    boss.cash = 0;
    const upgrade = (steps: Step[]) => steps.find(e => e.t === 'fx' && e.kind === 'free-upgrade') as unknown as { data: { level: number; top: boolean; own: boolean } };
    expect(upgrade(drive(st.landOnCompany(boss, nissan)).steps).data).toMatchObject({ level: 3, top: false, own: true });
    expect(lot.level).toBe(3);
    // The first floor tops it out: line 15 and fireworks (only the first call's 0x80 counts, core_actions:1838).
    lot.level = 4;
    expect(upgrade(drive(st.landOnCompany(boss, nissan)).steps).data).toMatchObject({ level: 5, top: true, own: true });
    lot.level = 3;
    expect(upgrade(drive(st.landOnCompany(boss, nissan)).steps).data).toMatchObject({ level: 5, top: false });
    lot.level = 3;
    const own = g.board.lands[5];
    own.owner = visitor.id + 1; own.level = 0;
    visitor.cash = 0; visitor.bank = 100_000;
    drive(st.landOnCompany(visitor, nissan));
    expect(own.level).toBe(1);
    expect(nissan.fundA).toBe(own.price * g.priceIndex);
    // Nothing to build: 1000 × PI.
    own.owner = 0;
    drive(st.landOnCompany(visitor, nissan));
    expect(nissan.fundA).toBe(own.price * g.priceIndex + 1000 * g.priceIndex);
  });

  it('asks a human through the stock market screen', () => {
    const g = makeGame(2);
    const st = g.stocks;
    const p = g.players[0];
    p.whoPlays = 1;
    p.bank = 100_000;
    const s = st.stocks[8];
    s.turnQuota = 500;
    // buy 20 shares of stock 8 → leave
    const { steps } = drive(st.humanMarket(p), [{ slot: 8, buy: true, n: 20 }, -1]);
    expect(steps.filter(x => 'ask' in x).map(x => x.t)).toEqual(['stock-market', 'stock-market']);
    expect(st.holding(0, 8).shares).toBe(20);
    expect(p.bank).toBe(100_000 - Math.trunc(20 * s.price));
    // Limit down: selling is refused.
    st.forceLimit(8, false);
    drive(st.humanMarket(p), [{ slot: 8, buy: false, n: 5 }, -1]);
    expect(st.holding(0, 8).shares).toBe(20);
    // Closed on Sundays.
    g.date = SUN;
    const closed = drive(st.humanMarket(p));
    expect(closed.steps).toEqual([{ t: 'say', p: undefined, text: '本日休市' }]);
  });

  it('computer trading is deterministic and follows the investment ratio (03 §9)', () => {
    const run = (seed: number) => {
      const g = makeGame(3, seed);
      const st = g.stocks;
      const log: string[] = [];
      for (let day = 0; day < 60; day++) {
        g.date = weekdayFrom(addDays(g.date, 1));
        drive(st.daily());
        for (const p of g.players) {
          st.turnStart(p);
          for (const s of drive(st.aiTrade(p)).steps) if (s.t === 'say') log.push(s.text);
        }
      }
      return { g, log };
    };
    const a = run(5), b = run(5);
    expect(a.log).toEqual(b.log);
    expect(a.log.some(t => t.includes('買進'))).toBe(true);
    // 0% characters never buy; others stay within their deposit.
    const g = makeGame(3, 9, WED, [2, 9, 11, 2]);
    for (let i = 0; i < 50; i++) for (const p of g.players) drive(g.stocks.aiTrade(p));
    expect(g.players.every(p => g.stocks.shareCount(p) === 0)).toBe(true);
    for (const p of a.g.players) expect(p.bank).toBeGreaterThanOrEqual(0);
  });

  it('computer sells everything of one stock when a loan is due (03 §9.3)', () => {
    const g = makeGame(2);
    const st = g.stocks;
    const p = g.players[0];
    st.holding(0, 8).shares = 100; st.holding(0, 8).avgCost = 100;
    st.holding(0, 9).shares = 100; st.holding(0, 9).avgCost = 100;
    for (const i of [8, 9]) st.stocks[i].prevClose = st.stocks[i].price; // flat, so not limit down
    st.stocks[10].prevClose = st.stocks[10].price * 1.2; // limit down: never sold
    st.holding(0, 10).shares = 5; st.holding(0, 10).avgCost = 1;
    p.cash = 0; p.bank = 0; p.loan = 1_000_000; p.loanDue = addDays(g.date, 3);
    drive(st.aiSell(p));
    expect(st.holding(0, 8).shares + st.holding(0, 9).shares).toBe(0);
    expect(st.holding(0, 10).shares).toBe(5);
    expect(p.bank).toBeGreaterThan(0);
  });
});
