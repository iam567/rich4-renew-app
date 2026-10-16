import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBoard, type Board, type RawMap } from './board';
import { CAPS, CasinoRules, ClassicCasino, DENY, HALLS, isHall, SLOT_TOP } from './casino-rules';
import { pack } from './date';
import type { Flow } from './flow';
import { FINALE_MAP, setFinaleBoard } from './finale';
import { CHIP_BADGES, CHIP_LINES, chipScore, FINALE_CHIP } from './chips';
import { attachLedger, Ledger } from './stats';
import { Game } from './game';
import * as C from './modules/casino';
import { Rng } from './rng';
import { loadWorld, saveWorld } from './save';
import type { Answer, GameSettings, Step } from './types';
import { applyOverlay, TYCOON_MAPS, World, type TycoonOverlay, type TycoonSettings } from './world';

// 大富翁城, the finale of 大富豪模式 and a normal map (docs/rules/19).
const KEYS: Record<number, string> = { 100: 'tokyo', 101: 'osaka', 102: 'sapporo', 103: 'kyushu', 104: 'okinawa', 105: 'finale' };
const file = (id: number) => fileURLToPath(new URL(`../../../editor/site/assets/remake/${KEYS[id]}.json`, import.meta.url));
const haveFinale = existsSync(file(FINALE_MAP));
const have = haveFinale && TYCOON_MAPS.every(id => existsSync(file(id)));
const raw = (id: number) => JSON.parse(readFileSync(file(id), 'utf8')) as RawMap & { tycoon?: TycoonOverlay };
const boards = (): Board[] => TYCOON_MAPS.map(id => { const r = raw(id); return applyOverlay(parseBoard(r), r.tycoon, id); });
const finaleBoard = () => applyOverlay(parseBoard(raw(FINALE_MAP)), undefined, FINALE_MAP);
const c = (rank: number, suit = 0) => suit * 13 + rank;   // 0 = 2 … 8 = 10, 9 J, 10 Q, 11 K, 12 A

function settings(seed: number, human = -1): TycoonSettings {
  return {
    mode: 'tycoon', maps: [...TYCOON_MAPS], players: Array.from({ length: 12 }, (_, i) => ({ character: i, human: i === human })),
    fundIndex: 1, traffic: 1, landLimitIndex: 0, startDate: pack(2026, 10, 16), seed,
  };
}

function play(w: { over: unknown }, flow: Flow, stop: (s: Step) => boolean, answer?: (s: Step) => Answer): Step[] {
  const seen: Step[] = [];
  let a: Answer;
  for (let r = flow.next(); !r.done; r = flow.next(a)) {
    const s = r.value;
    a = undefined;
    if ('ask' in s) {
      if (!answer) throw new Error(`computer players never ask: ${s.t}`);
      a = answer(s);
    }
    seen.push(s);
    if (stop(s) || w.over) break;
  }
  return seen;
}

function drain(flow: Flow<unknown>): Step[] { const out: Step[] = []; for (let r = flow.next(); !r.done; r = flow.next(undefined)) out.push(r.value); return out; }

/** A world where all but `keep` players have gone bankrupt (in their own cities), after some days of play. */
function nearFinale(seed: number, keep: number[], days = 40): World {
  const w = new World(settings(seed), boards());
  attachLedger(w.players);   // the whole game's statistics (the finale's chips come from them)
  play(w, w.run(), () => w.daysElapsed >= days);
  for (const p of w.players) if (!keep.includes(p.id) && !p.bankrupt) { w.mask(Math.max(0, p.map ?? 0)); drain(w.bankrupt(p, w.cities[Math.max(0, p.map ?? 0)])); }
  w.mask(w.view());
  return w;
}

describe('大富翁城 table games (deterministic streams)', () => {
  it("roulette pays 1:1, 2:1 and 35:1; zero loses the outside bets and is the house's ×5", () => {
    expect(C.rouletteWins({ kind: 'red' }, 1)).toBe(true);
    expect(C.rouletteWins({ kind: 'black' }, 0)).toBe(false);
    expect(C.rouletteWins({ kind: 'dozen', n: 3 }, 36)).toBe(true);
    expect(C.rouletteOdds({ kind: 'number', n: 7 })).toBe(35);
    const r = C.playRoulette(new Rng(7), 1000, { kind: 'number', n: 17 });
    expect(r.number).toBe(new Rng(7).below(37));
    expect(r.net).toBe(r.number === 17 ? 35000 : -1000);
    const zero: C.RouletteResult = { game: 'roulette', bet: { kind: 'red' }, number: 0, win: false, net: -1000 };
    expect(C.bankerMultiplier(zero)).toMatchObject({ mult: 5 });
  });

  it('blackjack: values, naturals 3:2, doubles, dealer stands on 17; dealer blackjack ×2, 五小龍 ×3', () => {
    expect(C.bjValue([c(12), c(5)])).toEqual({ total: 18, soft: true });
    expect(C.bjValue([c(12), c(12), c(9)])).toEqual({ total: 12, soft: false });
    expect(C.isBlackjack([c(12), c(10)])).toBe(true);
    // A double takes one card and settles at twice the stake: 6 + 4 + 10 = 20 against the dealer's 10 + 9 = 19.
    const t: C.BjTable = { deck: [c(3), c(8)], player: [c(4), c(2)], dealer: [c(8), c(7)], doubled: false, done: false };
    C.bjMove(t, 'double');
    expect(t.doubled && t.done).toBe(true);
    expect(C.bjSettle(t, 1000, ['double']).net).toBe(2000);
    expect(C.bjSettle({ deck: [], player: [c(12), c(9)], dealer: [c(8), c(7)], doubled: false, done: true }, 1000, []).net).toBe(1500);
    const soft = { deck: [c(0)], player: [c(8), c(7)], dealer: [c(12), c(4)], doubled: false, done: true };
    expect(C.bjSettle(soft, 1000, ['stand']).outcome).toBe('win');   // 19 against A-6 (soft 17, stands)
    expect(soft.dealer.length).toBe(2);
    expect(C.bjBasic([c(7), c(0)], c(4))).toBe('double');      // 11 vs 6
    expect(C.bjBasic([c(8), c(4)], c(8))).toBe('hit');         // 16 vs 10
    expect(C.bjBasic([c(8), c(4)], c(3))).toBe('stand');       // 16 vs 5
    expect(C.bjBasic([c(12), c(5)], c(5))).toBe('stand');      // soft 18 vs 7
    const dbj = C.bjSettle({ deck: [], player: [c(8), c(7)], dealer: [c(12), c(10)], doubled: false, done: true }, 1000, []);
    expect(C.bankerMultiplier(dbj)).toMatchObject({ mult: 2, all: false });
    const five: C.BlackjackResult = { game: 'blackjack', player: [c(8), c(6)], dealer: [c(0), c(1), c(0), c(0), c(7)], doubled: false, moves: ['stand'], outcome: 'lose', net: -1000 };
    expect(C.bjValue(five.dealer).total).toBe(18);
    expect(C.bankerMultiplier(five)).toMatchObject({ mult: 3 });
  });

  it("baccarat follows the tableau, pays the banker less 5%; the winner's natural ×2, pair ×3", () => {
    for (let seed = 1; seed < 200; seed++) {
      const r = C.playBaccarat(new Rng(seed), 1000, 'banker');
      expect(r.pt).toBe(C.bacTotal(r.player));
      expect(r.bt).toBe(C.bacTotal(r.banker));
      if (r.winner === 'banker') expect(r.net).toBe(950);
      if (r.winner === 'tie') expect(r.net).toBe(0);
      if (r.winner === 'player') expect(r.net).toBe(-1000);
      if (r.pt >= 8 && r.player.length === 2) expect(r.banker.length).toBe(2);
    }
    const lost = (player: number[], banker: number[]): C.BaccaratResult =>
      ({ game: 'baccarat', bet: 'player', player, banker, pt: C.bacTotal(player), bt: C.bacTotal(banker), winner: 'banker', net: -1000 });
    expect(C.bankerMultiplier(lost([c(0), c(1)], [c(4), c(1, 1)]))).toMatchObject({ mult: 2 });   // banker 6 + 3 = 9
    expect(C.bankerMultiplier(lost([c(0), c(1)], [c(2), c(2, 1)]))).toMatchObject({ mult: 3 });   // banker pair of 4s
    expect(C.bankerMultiplier(lost([c(0), c(1)], [c(2), c(1, 1), c(0)]))).toMatchObject({ mult: 1 });
  });

  it("hold'em ranks hands, settles a call 1:1 on both stakes; the dealer's 葫蘆 ×2 … 皇家同花順 all", () => {
    expect(C.bestHand([c(12), c(11), c(10), c(9), c(8), c(0, 1), c(1, 2)]).name).toBe('同花順');
    expect(C.bestHand([c(12, 0), c(12, 1), c(3, 2), c(3, 3), c(3, 0), c(5), c(7)]).name).toBe('葫蘆');
    expect(C.bestHand([c(12, 0), c(0, 1), c(1, 2), c(2, 3), c(3, 0), c(9), c(10, 2)]).name).toBe('順子');
    const r = C.holdemSettle(C.holdemDeal(new Rng(9)), 1000, true);
    expect(r.board.length).toBe(5);
    expect([2000, -2000, 0]).toContain(r.net);
    expect(C.holdemSettle(C.holdemDeal(new Rng(9)), 1000, false).net).toBe(-1000);
    const lose = (dealer: number[], board: number[]): C.HoldemResult => ({ game: 'holdem', hole: [c(0, 3), c(1, 3)], dealer, board, called: true, outcome: 'lose', playerHand: '', dealerHand: '', net: -2000 });
    expect(C.bankerMultiplier(lose([c(5), c(5, 1)], [c(5, 2), c(9), c(9, 1), c(1, 2), c(2, 2)]))).toMatchObject({ mult: 2 });
    expect(C.bankerMultiplier(lose([c(5), c(5, 1)], [c(5, 2), c(5, 3), c(9, 1), c(1, 2), c(2, 2)]))).toMatchObject({ mult: 5 });
    expect(C.bankerMultiplier(lose([c(4), c(5)], [c(6), c(7), c(8), c(1, 2), c(2, 3)]))).toMatchObject({ mult: 10 });
    expect(C.bankerMultiplier(lose([c(12), c(11)], [c(10), c(9), c(8), c(1, 2), c(2, 3)]))).toMatchObject({ all: true });
  });

  it('骰寶 pays 大/小 1:1; any triple loses ×10, three sixes take everything', () => {
    for (let seed = 1; seed < 300; seed++) {
      const r = C.playSicbo(new Rng(seed), 1000, 'big');
      expect(r.total).toBe(r.dice[0] + r.dice[1] + r.dice[2]);
      expect(r.win).toBe(!r.triple && r.total >= 11);
    }
    const t = (d: number): C.SicboResult => ({ game: 'sicbo', bet: 'small', dice: [d, d, d], total: 3 * d, triple: true, win: false, net: -1000 });
    expect(C.bankerMultiplier(t(2))).toMatchObject({ mult: 10, all: false });
    expect(C.bankerMultiplier(t(6))).toMatchObject({ all: true });
  });

  it('settles a visit: the win capped by the level, the loss uncapped (up to all the money)', () => {
    const win: C.RouletteResult = { game: 'roulette', bet: { kind: 'number', n: 7 }, number: 7, win: true, net: 35 * 3000 };
    expect(CasinoRules.settle(win, CAPS[2], 500000).net).toBe(20000);
    const royal: C.HoldemResult = { game: 'holdem', hole: [], dealer: [c(12), c(11)], board: [c(10), c(9), c(8), c(1, 2), c(2, 3)], called: true, outcome: 'lose', playerHand: '', dealerHand: '', net: -20000 };
    expect(CasinoRules.settle(royal, CAPS[1], 345678).net).toBe(-345678);
    const sic: C.SicboResult = { game: 'sicbo', bet: 'big', dice: [3, 3, 3], total: 9, triple: true, win: false, net: -8000 };
    // Never more than the visitor holds (19 §5.1): 1,000 left, the ×10 triple takes the 1,000.
    expect(CasinoRules.settle(sic, CAPS[1], 1000).net).toBe(-1000);
    expect(CasinoRules.settle(sic, CAPS[1], 500000).net).toBe(-80000);
  });

  it('the banker-away slot: first reel by level, the rest 0 when it tops out, never past the cap, at least 1,000', () => {
    const rules = new (class extends CasinoRules { game() { return undefined; } })();
    for (let level = 1; level <= 5; level++) {
      for (let seed = 1; seed < 400; seed++) {
        const d = rules.slotDigits(new Rng(seed * 31 + level), level);
        const amount = (d[0] * 1000 + d[1] * 100 + d[2] * 10 + d[3]) * 10;
        expect(d[0]).toBeLessThanOrEqual(SLOT_TOP[level]);
        if (d[0] === SLOT_TOP[level]) expect(d.slice(1)).toEqual([0, 0, 0]);
        expect(amount).toBeLessThanOrEqual(CAPS[level]);
        expect(amount).toBeGreaterThanOrEqual(1000);
      }
    }
    for (let seed = 1; seed < 200; seed++) {
      const fee = rules.entryFee(new Rng(seed));
      expect(fee % 100).toBe(0);
      expect(fee).toBeGreaterThanOrEqual(500);
      expect(fee).toBeLessThanOrEqual(5000);
    }
  });
});

describe.skipIf(!haveFinale)('大富翁城 as a normal map (19 §9)', () => {
  const classic = (n: number, seed: number): GameSettings => ({
    mapId: FINALE_MAP, players: Array.from({ length: n }, (_, i) => ({ character: i * 3, human: false })),
    fundIndex: 1, traffic: 1, landLimitIndex: 0, daysLimitIndex: 3, victoryIndex: 0, startDate: pack(2026, 10, 16), seed,
  });

  it('builds a small map: 44 squares, 10 plots, one of each special square, no lots or companies', () => {
    const b = finaleBoard();
    expect(b.nodes.length).toBe(44);
    expect(b.lands.length).toBe(0);
    expect(b.companies.length).toBe(0);
    expect(b.facilities.length).toBe(10);
    for (const e of [2, 3, 4, 5, 10, 11, 14, 15]) expect(b.nodes.filter(n => n.event === e).length, `event ${e}`).toBe(1);
    expect(b.nodes.filter(n => n.event === 12 || n.event === 13).length).toBe(0);
    const bank = b.nodes.find(n => n.event === 14)!;
    expect(bank.adjacent.filter(Boolean).length).toBeGreaterThanOrEqual(3);
  });

  for (const n of [2, 4]) {
    it(`plays a computers' game of ${n} on it to the end (halls only, no stocks, nothing denied)`, () => {
      const g = new Game(classic(n, 40 + n), finaleBoard());
      expect(g.rules).toBeInstanceOf(ClassicCasino);
      const steps = play(g, g.run(), () => g.daysElapsed > 400);
      expect(g.over).toBeTruthy();
      const halls = g.board.facilities.filter(f => f.level);
      for (const f of halls) expect(isHall(f.type), `${f.name} type ${f.type}`).toBe(true);
      expect(steps.some(s => s.t === 'fx' && (s.kind === 'casino-result' || s.kind === 'casino-auto'))).toBe(true);
      expect(steps.some(s => s.t === 'fx' && s.kind === 'stock-trade')).toBe(false);
      for (const s of steps) {
        if (s.t === 'fx' && s.kind === 'news') expect(DENY.news.has(Number(s.data?.id)), `news ${s.data?.id}`).toBe(false);
        if (s.t === 'fx' && s.kind === 'fate') expect(DENY.fate.has(Number(s.data?.id)), `fate ${s.data?.id}`).toBe(false);
      }
      for (const p of g.players) for (const id of p.cards) expect(DENY.cards.has(id)).toBe(false);
    });
  }

  it('leaves every other map alone (no map rules there)', () => {
    const r = JSON.parse(readFileSync(file(100), 'utf8')) as RawMap;
    const g = new Game({ ...classic(2, 1), mapId: 100 }, parseBoard(r));
    expect(g.rules).toBeUndefined();
  });
});

describe.skipIf(!have)('大富翁城 in the world (the finale)', () => {
  it('counts chips from the whole-game ledger: each line rounded down, the badges once', () => {
    const l = new Ledger(12);
    Object.assign(l.of(0), { finalCash: 125000, finalBank: 4999, landsBought: 52, levelsAdded: 7, facilitiesBuilt: { 1: 2, 4: 1 }, stockProfit: 1234567,
      tollsReceived: 99999, cardsUsed: { 3: 50 }, toolsUsed: { 1: 4 }, lucky: 9, unlucky: 2, cities: [0, 1, 2, 3, 4, 5], rivalsBankrupted: 3,
      overlordCities: [0, 2], maxLv5: 10, prisonDays: 31 });
    Object.assign(l.of(1), { lucky: 9, unlucky: 5 });
    const s = chipScore(l, 0, Array.from({ length: 12 }, (_, i) => i));
    const line = (k: string) => s.lines.find(x => x.key === k)!.chips;
    expect(line('money')).toBe(24);                 // 129,999 元 → 12 × 2
    expect(line('lands')).toBe(520);
    expect(line('levels')).toBe(28);
    expect(line('facilities')).toBe(90);
    expect(line('stock')).toBe(369);                // 123 × 3
    expect(line('tolls')).toBe(9);
    expect(line('cards') + line('tools')).toBe(162);
    expect(line('lucky') + line('unlucky')).toBe(51);
    expect(line('cities')).toBe(100);               // the five cities, not 大富翁城
    expect(line('rivals') + line('overlord')).toBe(440);
    expect(s.badges.map(b => b.key).sort()).toEqual(['builder', 'cards', 'japan', 'killer', 'lucky', 'prison', 'stocks', 'tycoon']);   // 天選之人 tied at 9: both
    expect(s.total).toBe(s.lines.reduce((a, x) => a + x.chips, 0) + s.badges.reduce((a, b) => a + b.chips, 0));
    expect(CHIP_LINES.length).toBe(13);
    expect(CHIP_BADGES.length).toBe(10);
  });

  it('starts when four players are left: chips from the ledger, denied things sold, holdings frozen, all in 大富翁城', () => {
    setFinaleBoard(finaleBoard());
    const keep = [0, 3, 6, 9];
    const w = nearFinale(21, keep);
    w.players[3].cards.push(31, 24); w.players[3].tools[9] = 2;   // 飛行卡, 紅卡, two 時光機
    const before = keep.map(id => w.wealth(w.players[id]));
    const points = w.players[3].points;
    const ledger = (w as unknown as { stats: Ledger }).stats;
    const bought = ledger.of(3).landsBought;
    const frozen = JSON.stringify(w.cities.map(x => x.board));
    const steps = drain(w.finale.check());
    expect(steps.some(s => s.t === 'fx' && s.kind === 'finale-start')).toBe(true);
    expect(w.finale.active).toBe(true);
    expect(w.cities.length).toBe(6);
    expect(w.settings.maps[5]).toBe(FINALE_MAP);
    keep.forEach((id, k) => {
      const p = w.players[id], v = w.finale.valuations.find(x => x.p === id)!;
      expect(v.total).toBe(before[k]);
      expect(v.cash + v.bank - v.loan + v.stocks + v.property).toBe(before[k]);
      const chips = w.finale.chips.find(x => x.p === id)!;
      expect(chips.lines.find(x => x.key === 'money')!.figure).toBe(Math.max(0, v.cash + v.bank));
      expect(chips.total).toBeGreaterThan(0);
      expect(p.cash).toBe(chips.total * FINALE_CHIP);
      expect(p.bank + p.loan).toBe(0);
      expect(p.map).toBe(5);
      expect(w.wealth(p)).toBe(p.cash);
      for (const id2 of DENY.cards.keys()) expect(p.cards).not.toContain(id2);
      expect(p.tools[9]).toBe(0);
    });
    const v3 = w.finale.valuations.find(x => x.p === 3)!;
    expect(v3.sold.map(x => `${x.name}×${x.n}`)).toEqual(['飛行卡×1', '紅卡×1', '時光機×2']);
    expect(w.players[3].points - points).toBe(18 + 45 + 72);
    expect(JSON.stringify(w.cities.slice(0, 5).map(x => x.board))).toBe(frozen);
    expect(w.cities[5].stocks.open()).toBe(false);
    expect(w.finale.chips.find(x => x.p === 3)!.lines.find(x => x.key === 'lands')!.chips).toBe(bought * 10);
    expect(w.cities[5].rules?.noLoans).toBe(true);
    // A finalist with no chips left is out at the next check, the halls back to the bank.
    const out = w.players[6];
    // Four halls (more than three: elsewhere a bankruptcy auction), and 99 元 — less than one chip.
    for (const k of [2, 3, 4, 5]) Object.assign(w.cities[5].board.facilities[k], { owner: out.id + 1, level: 2, type: 6 });
    out.cash = 99; out.bank = 0;
    drain(w.finale.check());
    expect(out.bankrupt).toBe(true);
    for (const k of [2, 3, 4, 5]) expect(w.cities[5].board.facilities[k].owner).toBe(0);
    expect((w as unknown as { pendingAuctions: { city: number }[] }).pendingAuctions.filter(a => a.city === 5)).toEqual([]);
    setFinaleBoard(null);
  });

  it('a banker in hospital pays the slot amount (within the cap) after the entry fee', () => {
    setFinaleBoard(finaleBoard());
    const w = nearFinale(23, [0, 3, 6, 9]);
    drain(w.finale.check());
    const g = w.cities[5], f = g.board.facilities[0];
    const v = w.players[0], b = w.players[3];
    Object.assign(f, { owner: b.id + 1, level: 4, type: HALLS[2] });
    b.hospital = 3; b.cash = 10_000_000;
    const cash0 = v.cash + v.bank, bank0 = b.cash + b.bank;
    w.mask(5);
    const steps = drain(w.finale.visit(g, v, f));
    const fee = steps.find(s => s.t === 'fx' && s.kind === 'casino-fee') as { data: { fee: number } } | undefined;
    const auto = steps.find(s => s.t === 'fx' && s.kind === 'casino-auto') as { data: { amount: number } } | undefined;
    expect(fee && auto).toBeTruthy();
    expect(auto!.data.amount).toBeLessThanOrEqual(CAPS[4]);
    expect(v.cash + v.bank).toBe(cash0 - fee!.data.fee + auto!.data.amount);
    expect(b.cash + b.bank).toBe(bank0 + fee!.data.fee - auto!.data.amount);
    setFinaleBoard(null);
  });

  it('盲注遞增: every 20 finale days the caps, minimum bets, 門票 and the slot double, announced once', () => {
    setFinaleBoard(finaleBoard());
    const w = nearFinale(23, [0, 3, 6, 9]);
    drain(w.finale.check());
    const f = w.finale, g = w.cities[5];
    const announced = (steps: Step[]) => steps.filter(s => s.t === 'fx' && s.kind === 'finale-blinds') as unknown as { data: { mult: number } }[];
    expect(f.blind()).toBe(1);
    expect([1, 2, 3, 4, 5].map(l => f.minStake(l) / FINALE_CHIP)).toEqual([50, 100, 150, 250, 400]);
    expect(f.cap(5)).toBe(CAPS[5]);
    for (const [day, mult] of [[19, 1], [20, 2], [39, 2], [40, 4], [60, 8], [80, 16]] as const) {
      w.daysElapsed = f.startDay + day;
      const fx = announced(drain(f.check()));
      expect(f.blind()).toBe(mult);
      expect(fx.map(x => x.data.mult)).toEqual(day % 20 === 0 ? [mult] : []);
      expect(announced(drain(f.check()))).toEqual([]);   // once
      for (let level = 1; level <= 5; level++) {
        expect(f.cap(level)).toBe(CAPS[level] * mult);
        expect(f.minStake(level)).toBe([0, 50, 100, 150, 250, 400][level] * FINALE_CHIP * mult);
        const [lo, hi] = [[0, 0], [20, 50], [40, 100], [60, 150], [80, 200], [100, 300]][level];
        for (let seed = 1; seed < 60; seed++) {
          const fee = f.entryFee(new Rng(seed * 7 + level), level);
          expect(fee % (FINALE_CHIP * mult)).toBe(0);
          expect(fee).toBeGreaterThanOrEqual(lo * FINALE_CHIP * mult);
          expect(fee).toBeLessThanOrEqual(hi * FINALE_CHIP * mult);
        }
      }
    }
    // The banker away: the slot pays up to the doubled cap (×16 here).
    const fac = g.board.facilities[0], v = w.players[0], b = w.players[3];
    Object.assign(fac, { owner: b.id + 1, level: 5, type: HALLS[0], tmpState: 0 });
    Object.assign(b, { hospital: 3, cash: 100_000_000 });
    w.mask(5);
    let top = 0;
    for (let i = 0; i < 40; i++) {
      v.node = g.board.nodes[i % g.board.nodes.length].id; v.cash = 5_000_000;
      const auto = drain(f.visit(g, v, fac)).find(s => s.t === 'fx' && s.kind === 'casino-auto') as { data: { amount: number } } | undefined;
      expect(auto!.data.amount).toBeLessThanOrEqual(CAPS[5] * 16);
      expect(auto!.data.amount % 16).toBe(0);
      top = Math.max(top, auto!.data.amount);
    }
    expect(top).toBeGreaterThan(CAPS[5]);
    setFinaleBoard(null);
  });

  it('過路稅 and 籌碼券: a plain road square takes 50 chips × the blinds, the coupon squares give 300 / 500 × the blinds', () => {
    setFinaleBoard(finaleBoard());
    const w = nearFinale(23, [0, 3, 6, 9]);
    drain(w.finale.check());
    const f = w.finale, g = w.cities[5], v = w.players[0];
    w.mask(5);
    const road = g.board.nodes.find(n => n.event === 0 && !n.ref)!, c30 = g.board.nodes.find(n => n.event === 11)!, c50 = g.board.nodes.find(n => n.event === 10)!;
    const run = (n: typeof road) => { let handled = false; const fl = f.landSquare(g, v, n); for (let r = fl.next(); ; r = fl.next(undefined)) if (r.done) { handled = r.value; break; } return handled; };
    for (const [day, mult] of [[0, 1], [45, 4]] as const) {
      w.daysElapsed = f.startDay + day;
      Object.assign(v, { cash: 100_000, bank: 20_000 });
      const points = v.points;
      expect(run(road)).toBe(false);                              // the road's objects still apply
      expect(v.cash + v.bank).toBe(120_000 - 50 * FINALE_CHIP * mult);
      expect(run(c30)).toBe(true);
      expect(run(c50)).toBe(true);
      expect(v.cash + v.bank).toBe(120_000 - 50 * FINALE_CHIP * mult + 800 * FINALE_CHIP * mult);
      expect(v.points).toBe(points);                              // chips in place of points
    }
    // At most what the visitor holds (out at the next check).
    Object.assign(v, { cash: 3_050, bank: 0 });
    run(road);
    expect(v.cash).toBe(50);
    drain(f.check());
    expect(v.bankrupt).toBe(true);
    // The computer's remote dice: a coupon within reach beats the road.
    const p = w.players[3];
    const ahead = [road.id, road.id, c50.id, road.id, road.id, road.id];
    expect(f.aiRemoteDice(g, p, ahead)).toBe(3);
    // Not on the classic map 105 (money; no road tax).
    expect((new ClassicCasino(g) as unknown as { landSquare?: unknown }).landSquare).toBeUndefined();
    setFinaleBoard(null);
  });

  it('stakes, doubles and calls never pass what the visitor holds, in all five halls (human and computer)', () => {
    setFinaleBoard(finaleBoard());
    const w = nearFinale(29, [0, 3, 6, 9]);
    drain(w.finale.check());
    const g = w.cities[5], f = g.board.facilities[0];
    const v = w.players[0], b = w.players[3];
    w.mask(5);
    let visits = 0, allIn = 0;
    for (const type of HALLS) for (const human of [true, false]) for (let i = 0; i < 60; i++) {
      Object.assign(f, { owner: b.id + 1, level: 5, type, tmpState: 0 });
      Object.assign(b, { cash: 50_000_000, bank: 0, hospital: 0, prison: 0, sleep: 0, sleepwalk: 0 });
      Object.assign(v, { cash: [51_100, 35_000, 21_100, 3_000, 640_000][i % 5] + i * 100, bank: 0, whoPlays: human ? 1 : 2, autopilot: false, ally: 0 });
      v.node = g.board.nodes[i % g.board.nodes.length].id;
      const before = v.cash;
      let held = before, stake = 0;
      const steps = play(w, w.finale.visit(g, v, f), () => false, s => {
        const q = s as unknown as { t: string; phase?: string; stake?: number; call?: number; double?: number; canDouble?: boolean; max?: number };
        if (q.t !== 'casino') return undefined;
        if (q.phase === 'choose') { expect(q.max!).toBeLessThanOrEqual(held); return { game: 'roulette', stake: 99_999_999, bet: { kind: 'number', n: 0 } } as unknown as Answer; }
        if (q.phase === 'blackjack') { if (q.canDouble) expect(q.stake! + q.double!).toBeLessThanOrEqual(held); return 'double' as Answer; }
        if (q.phase === 'holdem') { expect(q.stake! + q.call!).toBeLessThanOrEqual(held); return 'call' as Answer; }
        return undefined;
      });
      const fee = steps.find(s => s.t === 'fx' && s.kind === 'casino-fee') as { data: { fee: number } } | undefined;
      held = before - (fee?.data.fee ?? 0);
      const res = steps.find(s => s.t === 'fx' && s.kind === 'casino-result') as { data: { stake: number; net: number } } | undefined;
      if (res) {
        visits++;
        stake = res.data.stake;
        expect(stake).toBeLessThanOrEqual(Math.min(CAPS[5], held));
        expect(-res.data.net).toBeLessThanOrEqual(held);
        if (-res.data.net === held) allIn++;
      }
      expect(v.cash).toBeGreaterThanOrEqual(0);
      expect(fee?.data.fee ?? 0).toBeLessThanOrEqual(before);
    }
    expect(visits).toBeGreaterThan(250);
    expect(allIn).toBeGreaterThan(0);
    setFinaleBoard(null);
  });

  it('saves and loads during the finale and plays on the same', () => {
    setFinaleBoard(finaleBoard());
    const w = nearFinale(31, [1, 4, 7, 10]);
    play(w, w.run(), () => w.finale.active && w.daysElapsed > w.finale.startDay + 6);
    const save = saveWorld(w);
    const b = loadWorld(JSON.parse(JSON.stringify(save)), [...boards(), finaleBoard()]);
    expect(b.finale.active).toBe(true);
    expect(b.cities.length).toBe(6);
    const fp = (x: World) => { const s = saveWorld(x); s.savedAt = 0; s.settings.mapId = 0; return JSON.stringify(s); };
    expect(fp(b)).toBe(fp(w));
    setFinaleBoard(null);
  });

  it('plays a whole computers\' 大富豪 game into the finale with the real chips (ledger from day one)', () => {
    setFinaleBoard(finaleBoard());
    const w = new World(settings(2), boards());
    attachLedger(w.players);
    let chips: { total: number; lines: { chips: number }[] }[] = [];
    play(w, w.run(), s => {
      if (s.t === 'fx' && s.kind === 'finale-start') chips = (s.data as { chips: typeof chips }).chips;
      return w.daysElapsed > 3000;
    });
    expect(chips.length).toBe(4);
    // A whole game's chips are well above a Lv5 hall's cap (800 籌碼), not the shortcut's few dozen.
    for (const c of chips) expect(c.total).toBeGreaterThan(CAPS[5] / FINALE_CHIP);
    expect(w.over).toBeTruthy();
    expect(w.players.filter(p => !p.bankrupt).length).toBe(1);
    expect(w.finale.visits).toBeGreaterThan(0);
    setFinaleBoard(null);
  });

  it('runs an all-computer finale to a single winner (halls only)', () => {
    setFinaleBoard(finaleBoard());
    // Seed 6: with 大富豪模式's stock-free shops (17 §3.10) seed 5's finale ended before any hall visit.
    const w = nearFinale(6, [1, 4, 7, 10]);
    play(w, w.run(), () => w.daysElapsed > 3000);
    expect(w.over).toBeTruthy();
    expect(w.finale.active).toBe(true);
    expect(w.players.filter(p => !p.bankrupt).length).toBe(1);
    expect(w.finale.visits).toBeGreaterThan(0);
    expect(w.cities[5].board.facilities.every(f => !f.level || isHall(f.type))).toBe(true);
    setFinaleBoard(null);
  });
});
