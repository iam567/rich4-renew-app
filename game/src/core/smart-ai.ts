/**
 * The smarter computer (the user 2026-10-22). It plays every seat the computer plays in 派對模式 — computer seats,
 * humans on 托管, players voted out or dropped — and a normal game's computers at 中級 / 困難 (`settings.aiLevel`,
 * Game.aiLevel): 中級 (`Game.smartAi`) takes the money, buying, building and dice below and keeps the original's
 * random cards, tools, shop and passive cards; 困難 (`Game.smartTactics`) all of it. At 簡單 (a normal game's
 * default) and in 大富豪模式 the computer keeps the original's rules bit for bit.
 *
 * Every phone of a party runs the same simulation, so each decision is a pure function of the game state (and, where
 * a rule draws one, the game's own rng): no clock, no Math.random, lists walked in a fixed order.
 *
 * What it does better than the original's computer:
 *  - money: a reserve sized to the worst toll / fee within reach of its next rolls before it buys or builds; the rest
 *    in the bank (10% a month) instead of the character's cash ratio; no loans unless short of that reserve, repaid as
 *    soon as it can; shares sold when the reserve runs short; nothing from the black market (50× prices);
 *  - movement: the number of dice (scooter / car) and the remote dice by the expected value of where each roll ends
 *    (its walk is known: the fork arrows as they stand), avoiding rivals' expensive lots;
 *  - cards and tools aimed with purpose (core: cards.ts / tools.ts call back here): the leader and the rival streets
 *    on its way, its own streets, the free / frame cards on the payments that hurt;
 *  - facilities: the type that earns most; the shop's points on the cards and tools it uses.
 */
import { companyOf, facilityOf, landOf, type Facility, type Land } from './board';
import { daysBetween } from './date';
import type { Flow } from './flow';
import type { Game } from './game';
import type { Player } from './types';

/** Facility level caps by type (ref_00474940; the core's FACILITY_MAX_LEVEL, copied to keep the import one way). */
const FAC_MAX = [1, 5, 5, 1, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5];
/** Object types (objects.ts OBJ). */
const O = { SmallWealth: 1, BigWealth: 2, SmallFortune: 3, BigFortune: 4, SmallPoor: 5, BigPoor: 6, SmallBad: 7, BigBad: 8, Angel: 9, Devil: 10, Dog: 11, EarthGod: 12, Gift: 13, Chest: 14, Death: 15, Roadblock: 16, Mine: 17, TimeBomb: 18 } as const;

/** Probability of each total of `n` six-sided dice, index = total. */
function diceDist(n: number): number[] {
  let d = [1];
  for (let k = 0; k < n; k++) {
    const next = new Array(d.length + 6).fill(0);
    d.forEach((pr, s) => { if (pr) for (let f = 1; f <= 6; f++) next[s + f] += pr / 6; });
    d = next;
  }
  return d;
}
const DIST = [diceDist(0), diceDist(1), diceDist(2), diceDist(3)];

export class SmartAi {
  constructor(private readonly g: Game) {}

  // ---------------------------------------------------------------- what it knows

  money(p: Player): number { return p.cash + p.bank; }

  /** The rival with the most total assets (-1 none), lowest id on ties. */
  leader(p: Player): number {
    let best = -1, w = -Infinity;
    for (const q of this.g.players) {
      if (q.id === p.id || !q.whoPlays) continue;
      const v = this.g.wealth(q);
      if (v > w) { w = v; best = q.id; }
    }
    return best;
  }

  /** One step of q's walk as it will happen: the fork arrows as they stand (no rng; Game.walkNext draws its own). */
  nextOf(q: Player, at: number, from: number): number {
    const g = this.g;
    if (g.forks.isFork(at)) return g.forks.follow(q.id, at, from);
    const n = g.node(at);
    if (!n) return from;
    const exits = n.adjacent.filter((a, j) => a && a !== from && !(n.oneWay & (8 >> j)));
    return exits[0] ?? from;
  }

  /** The next `n` squares of q's walk (index 0 = one step). */
  route(q: Player, n: number): number[] {
    const out: number[] = [];
    let at = q.node, from = q.lastNode;
    for (let i = 0; i < n; i++) {
      const next = this.nextOf(q, at, from);
      if (!next || !this.g.node(next)) break;
      from = at; at = next;
      out.push(at);
    }
    return out;
  }

  /** Dice q can throw now (the scooter 2, the car 3, walking or the construction vehicle 1). */
  maxDice(q: Player): number {
    const v = q.traffic & 3;
    return v === 1 ? 2 : v === 2 ? 3 : 1;
  }

  /** The owner collects nothing (Game.ownerCollects): sealed, allied, 死神, away, asleep. */
  private exempt(p: Player, owner: Player, tmpState: number): boolean {
    return (!!(tmpState >> 4) && !!(tmpState & 0xf)) || owner.ally === p.id + 1 || p.ally === owner.id + 1 || this.g.objects.godType(owner) === O.Death
      || !!owner.hotel || !!owner.vanish || !!owner.prison || !!owner.hospital || !!owner.sleep || !!owner.sleepwalk || !owner.whoPlays;
  }

  /** The street toll p pays on `land` (Game.payToll before the payment chain), 0 when nothing is due. */
  toll(p: Player, land: Land): number {
    const g = this.g;
    if (!land.owner || land.owner === p.id + 1) return 0;
    const owner = g.players[land.owner - 1];
    if (!owner || this.exempt(p, owner, land.tmpState)) return 0;
    let base = g.calcToll(land.owner, land.chain ? null : land.name);
    const allyPart = owner.ally ? g.calcToll(owner.ally, land.chain ? null : land.name) : 0;
    if (land.tmpState) base *= 2;
    if (g.rules?.tollFactor) base = Math.round(base * g.rules.tollFactor(g, land));
    return g.godModify(p, base + allyPart);
  }

  /** The expected fee of a rival's facility (wheel averages: hotel 2.5 days, shop ×3.5), 0 when nothing is due. */
  facilityFee(p: Player, f: Facility, steps: number): number {
    const g = this.g, PI = g.priceIndex;
    if (!f.owner || f.owner === p.id + 1 || f.level < 1) return 0;
    const owner = g.players[f.owner - 1];
    if (!owner || this.exempt(p, owner, f.tmpState)) return 0;
    let rate = (f.fees[f.level] ?? 0) * PI;
    if (g.rules?.landOnFacility) return g.godModify(p, rate * 3); // a map's own plots (歌舞伎町's shops, 大富翁城's halls)
    if (f.type < 1 || f.type > 3) return 0;
    if (f.tmpState && f.type !== 3) rate *= 2;
    const v = p.traffic & 3;
    const amount = f.type === 1 ? rate * 2.5 : f.type === 2 ? rate * 3.5 : v && v < 3 ? 500 * (1 << (v - 1)) * steps * PI : 0;
    return g.godModify(p, amount);
  }

  /** What p pays stopping on square `node` after `steps` steps (lots, facilities, companies; an estimate for wheels). */
  fee(p: Player, node: number, steps: number): number {
    const g = this.g, n = g.node(node), PI = g.priceIndex;
    if (!n || n.event !== 0) return 0;
    const land = landOf(g.board, n);
    if (land) return this.toll(p, land);
    const f = facilityOf(g.board, n);
    if (f) return this.facilityFee(p, f, steps);
    const c = companyOf(g.board, n);
    if (c && c.controller && c.controller !== p.id + 1) {
      const v = p.traffic & 3;
      const amount = c.category === 1 || c.category === 4 ? c.baseFee * 3 * PI
        : c.category === 3 ? c.baseFee * g.daysElapsed
        : c.category === 5 || c.category === 6 ? (v && v < 3 ? c.baseFee * (1 << (v - 1)) * steps * PI : 0)
        : c.category === 12 ? c.baseFee * steps * PI : c.category === 11 ? 2000 * PI : 0;
      return g.godModify(p, amount);
    }
    return 0;
  }

  /**
   * Money p should keep before buying or building: the worst payment within reach of its next roll, most of the worst
   * one a roll later, and a floor.
   */
  reserve(p: Player): number {
    const g = this.g, PI = g.priceIndex, d = this.maxDice(p);
    const r = this.route(p, 12 * d);
    let now = 0, later = 0;
    r.forEach((node, i) => {
      const f = this.fee(p, node, i + 1);
      if (i < 6 * d) now = Math.max(now, f); else later = Math.max(later, f);
    });
    return Math.max(5000 * PI, now, later * 0.7);
  }

  // ---------------------------------------------------------------- where a roll ends

  /** A turn spent away (hospital, prison): the turns lost, with the tolls not collected meanwhile. */
  private turnCost(p: Player): number { return 2500 * this.g.priceIndex + 0.01 * this.money(p); }

  /** The value for p of stopping on `node` after `steps` steps: minus what it pays, plus what it can do there. */
  stopValue(p: Player, node: number, steps: number): number {
    const g = this.g, PI = g.priceIndex, n = g.node(node), me = p.id + 1, money = this.money(p);
    if (!n) return 0;
    const fee = this.fee(p, node, steps);
    let v = -fee;
    if (fee > money) v -= 2 * money + 100000 * PI; // bankruptcy
    else if (fee > money * 0.5) v -= fee - money * 0.5;
    if (n.event === 0) {
      const land = landOf(g.board, n), f = facilityOf(g.board, n);
      if (land && !land.owner && (land.price + land.level * land.perLevel) * PI <= p.cash) v += (land.tolls[Math.min(5, land.level + 1)] ?? 0) * PI * 0.4 + this.ownOnStreet(p, land.name) * 1500 * PI;
      else if (land && land.owner === me && !land.chain && land.level < 5 && land.perLevel * PI <= p.cash) v += ((land.tolls[land.level + 1] ?? 0) - (land.tolls[land.level] ?? 0)) * PI * 0.4 * Math.max(1, this.ownOnStreet(p, land.name) / 2);
      else if (f && !f.owner && f.price * PI <= p.cash) v += f.price * PI * 0.3;
      else if (f && f.owner === me && f.level < (FAC_MAX[f.type] ?? 5) && (f.level ? f.fees[0] : f.price) * PI <= p.cash) v += ((f.fees[f.level + 1] ?? f.fees[f.level] ?? 0) - (f.level ? f.fees[f.level] : 0)) * PI * 1.5;
    } else if (n.event === 13) v += 1500 * PI;
    else if (n.event === 15) v += 1000 * PI;
    else if (n.event >= 10 && n.event <= 12) v += (n.event === 10 ? 800 : n.event === 11 ? 500 : 200) * PI;
    else if (n.event >= 6 && n.event <= 8) v += 600 * PI;
    else if (n.event === 14) v += 300 * PI;
    const o = g.objects.at(node);
    if (o) {
      const t = o.type;
      if (t === O.Mine || t === O.Dog && !(p.traffic & 3)) v -= 3 * this.turnCost(p);
      else if (t === O.TimeBomb) v -= 3000 * PI;
      else if (t === O.SmallPoor || t === O.BigPoor || t === O.SmallBad || t === O.BigBad || t === O.Devil || t === O.Death) v -= 3000 * PI;
      else if (t === O.SmallWealth || t === O.BigWealth || t === O.SmallFortune || t === O.BigFortune || t === O.Angel || t === O.EarthGod) v += 3000 * PI;
      else if (t === O.Gift || t === O.Chest) v += 1000 * PI;
    }
    return v;
  }

  /** Where a walk of `steps` along `r` stops (a roadblock on the way stops it there): the index in `r`. */
  private stopIndex(r: number[], steps: number): number {
    const g = this.g;
    for (let i = 0; i < steps && i < r.length; i++) if (g.objects.at(r[i])?.type === O.Roadblock) return i;
    return Math.min(steps, r.length) - 1;
  }

  /** The value of walking exactly `steps` along `r`. */
  walkValue(p: Player, r: number[], steps: number): number {
    const i = this.stopIndex(r, steps);
    return i < 0 ? 0 : this.stopValue(p, r[i], i + 1);
  }

  /** The expected value of throwing `dice` dice from where p stands. */
  rollValue(p: Player, dice: number, r = this.route(p, 6 * dice)): number {
    let ev = 0;
    DIST[dice].forEach((pr, s) => { if (pr) ev += pr * this.walkValue(p, r, s); });
    return ev;
  }

  /** The number of dice (Game.aiChooseDice's moment): the best expected stop; a carried time bomb as the original. */
  chooseDice(p: Player): void {
    const vehicle = p.traffic & 3;
    if (vehicle !== 1 && vehicle !== 2) return;
    if (p.bomb) { const life = this.g.objects.slots[p.bomb - 1]?.life ?? 0; p.dice = life < 15 ? 1 : vehicle === 2 ? 3 : 2; return; }
    const max = this.maxDice(p), r = this.route(p, 6 * max);
    let best = max, bestV = -Infinity;
    for (let d = max; d >= 1; d--) {
      const v = this.rollValue(p, d, r);
      if (v > bestV + 1e-9) { bestV = v; best = d; }
    }
    p.dice = best;
  }

  /** The remote dice's value (1..6) when one is clearly better than throwing; null to throw. */
  remoteDice(p: Player): number | null {
    const g = this.g, PI = g.priceIndex;
    if (p.turtle || p.stay || p.tools[7] <= 0) return null;
    const max = this.maxDice(p), r = this.route(p, 6 * max);
    let normal = -Infinity;
    for (let d = 1; d <= max; d++) normal = Math.max(normal, this.rollValue(p, d, r));
    let best = 0, bestV = -Infinity;
    for (let v = 1; v <= 6; v++) {
      const x = this.walkValue(p, r, v);
      if (x > bestV) { bestV = x; best = v; }
    }
    const margin = 3000 * PI + 0.02 * this.money(p);
    return best && bestV - normal > margin ? best : null;
  }

  private ownOnStreet(p: Player, name: string): number {
    let n = 0;
    for (const l of this.g.board.lands) if (l.owner === p.id + 1 && l.name === name) n++;
    return n;
  }

  // ---------------------------------------------------------------- buying and building (Game.landOnLot / landOnFacility)

  /** Buy an empty lot or plot for `price` (already ≤ cash)? */
  wantsToBuy(p: Player, price: number, land?: Land): boolean {
    const spare = this.money(p) - price, reserve = this.reserve(p);
    if (spare >= reserve) return true;
    // A lot on a street it already has a foot in (the tolls add up): a smaller margin.
    return !!land && this.ownOnStreet(p, land.name) > 0 && spare >= reserve * 0.6;
  }

  /** Build one more level for `cost` (already ≤ cash)? Levels pay back many times: half the reserve is enough. */
  wantsToBuild(p: Player, cost: number): boolean {
    return this.money(p) - cost >= this.reserve(p) * 0.5;
  }

  /** The facility type for an empty plot of its own: a shopping mall (the highest expected fee, upgrades to 5). */
  facilityType(): number { return 2; }

  // ---------------------------------------------------------------- money (Game.atm / bankCounter, stocks)

  /** The ATM: what is not needed for buying soon goes into the bank (10% a month). */
  atm(p: Player): void {
    const PI = this.g.priceIndex, total = p.cash + p.bank;
    if (total <= 0) return;
    const want = Math.trunc(Math.min(total, Math.max(10000 * PI, Math.min(total * 0.15, 50000 * PI))));
    if (p.noLoan && want > p.cash) return; // 不能提款: a deposit only
    p.cash = want;
    p.bank = total - p.cash;
  }

  /** The bank counter: repay a loan once it can (interest stops while one runs), borrow only when short of the reserve. */
  bankCounter(p: Player): void {
    const g = this.g, money = this.money(p), reserve = this.reserve(p);
    if (p.loan) {
      if (money - p.loan >= reserve * 0.8 || (money >= p.loan * 1.05 && daysBetween(g.date, p.loanDue) <= 10)) {
        const x = p.loan, fromBank = Math.min(x, p.bank);
        p.bank -= fromBank; p.cash -= x - fromBank;
        p.loan = 0; p.loanDue = 0;
      }
      return;
    }
    if (p.noLoan || money >= reserve) return;
    const room = Math.max(0, g.wealth(p) - p.loan);
    const x = Math.trunc(Math.min(room, reserve * 1.5 - money));
    if (x > 0) { p.bank += x; p.loan += x; g.setLoanDue(p); }
  }

  /** Short of the reserve at the start of its turn: shares are sold (into the bank) until it is covered. */
  *sellShares(p: Player): Flow {
    const g = this.g, m = g.stocks;
    if (!m.open()) return;
    const need = this.reserve(p) * 1.2;
    while (this.money(p) < need) {
      let best = -1, value = 0;
      for (let slot = 0; slot < 12; slot++) {
        const s = m.stocks[slot], h = m.holding(p.id, slot);
        if (!h.shares || s.suspendDays) continue;
        const v = h.shares * s.price;
        if (v > value) { value = v; best = slot; }
      }
      if (best < 0) return;
      const n = m.holding(p.id, best).shares;
      m.sell(p, best, n, true);
      yield { t: 'fx', kind: 'stock-trade', p: p.id, data: { slot: best, n, buy: false } };
      yield* g.say(undefined, `${g.name(p.id)}\n\n賣出${m.stocks[best].name}${n}張`);
    }
  }

  // ---------------------------------------------------------------- passive cards (Cards.tryFree / tryFrame)

  /** 免費卡 on a fee that hurts: more than it has, or a good part of it. */
  useFreeCard(p: Player, fee: number): boolean {
    const money = this.money(p);
    return fee > money || fee >= Math.max(12000 * this.g.priceIndex, money * 0.12);
  }

  /**
   * 嫁禍卡: who takes the punishment / fee / tax instead (-1: not used). A fee framed onto its payee is simply not paid
   * (Game.collect), so that is the default; the leader takes it instead when the leader is the bigger rival or cannot
   * pay it (bankrupt). Punishments and taxes go to the leader.
   */
  frameTarget(p: Player, mode: 0 | 1 | 2, amount: number, payee: number, local: boolean): number {
    const g = this.g, PI = g.priceIndex;
    const others = g.players.filter(q => q.id !== p.id && q.whoPlays !== 0 && (!local || g.here(q)));
    if (!others.length) return -1;
    if (mode === 1 && !this.useFreeCard(p, amount)) return -1;
    if (mode === 2 && !(p.cash * 0.2 > 4000 * PI)) return -1;
    let lead = -1, w = -Infinity;
    for (const q of others) { const v = g.wealth(q); if (v > w) { w = v; lead = q.id; } }
    if (mode === 1 && others.some(q => q.id === payee)) {
      if (lead >= 0 && lead !== payee && (amount > this.money(g.players[lead]) || g.wealth(g.players[lead]) > g.wealth(g.players[payee]))) return lead;
      return payee;
    }
    return lead;
  }

  // ---------------------------------------------------------------- the shop (Tools.shop)

  /**
   * The shop with the same shelves as a human's (Tools.cardShelf / toolShelf, each cell once a visit): the cards and
   * tools it plays, most useful first, while the points last.
   */
  shop(p: Player, turnover: { buy: number; sell: number }): void {
    const g = this.g, t = g.tools;
    const cards = t.cardShelf(), tools = t.toolShelf();
    const held = (id: number) => p.cards.filter(c => c === id).length;
    for (const [kind, id, cap] of SHOP_WISHES) {
      if (kind === 'tool') {
        const i = tools.indexOf(id), price = TOOL_POINTS[id - 1];
        if (i < 0 || p.points < price || p.tools[id - 1] >= Math.min(cap, 9)) continue;
        if (id === 6 && (p.traffic === 2 || p.tools[5] > 0)) continue;
        t.buyTool(p, id);
        tools[i] = 0;
        turnover.buy += price * 10;
      } else {
        const i = cards.indexOf(id), price = CARD_POINTS[id - 1];
        if (i < 0 || p.points < price || held(id) >= cap || !g.cards.room(p, id) || p.cards.length >= 15) continue;
        p.points = (p.points - price) & 0xffff;
        t.shopCard(p, id);
        g.stats?.cardBought(p.id, id, price);
        cards[i] = 0;
        turnover.buy += price * 10;
      }
    }
  }

  // ---------------------------------------------------------------- the turn (Game.playerTurn's computer branch)

  /**
   * Before the dice: shares for the reserve, the bank operator check, the map's own tools, then up to three cards or
   * tools by their value (a human may use several in a turn too), the remote dice last. 中級: the original's one card
   * or tool.
   */
  *beforeDice(p: Player): Flow {
    const g = this.g;
    yield* this.sellShares(p);
    if (g.over || !p.whoPlays) return;
    // Shares as the original's computer trades them (by the character's stock ratio), only with money to spare.
    if (this.money(p) >= this.reserve(p) * 2) { yield* g.stocks.aiTrade(p); if (g.over || !p.whoPlays) return; }
    yield* g.financeRecall(); // rich4.asm:11632, as after the computer's trading
    if (g.over || !p.whoPlays) return;
    // 中級: a card or a tool as the original's computer picks them (01 §3.5).
    if (!g.smartTactics(p)) { if (g.rng.rand() & 1) yield* g.cards.aiUse(p); else yield* g.tools.aiUse(p); return; }
    const stopped = () => g.over || !p.whoPlays || g.offRoad(p) || !!p.sleep || !!p.sleepwalk || g.tools.pending !== 'none';
    if (g.rules?.aiTools && (yield* g.rules.aiTools(g, p))) { if (stopped()) return; } // 歌舞伎町's own tools (21 §7.5)
    for (let k = 0; k < 3; k++) {
      let best: Act | null = null;
      for (const a of this.actions(p)) if (a.score > 0 && (!best || a.score > best.score)) best = a;
      if (!best) break;
      yield* best.run();
      if (stopped() || p.stay) return;
    }
    const v = this.remoteDice(p);
    if (v !== null) { yield* g.say(p.id, '使用遙控骰子'); yield* g.tools.use(p, 8, v); }
  }

  // ---------------------------------------------------------------- cards and tools

  /** On p's screen (the 440 × 440 view around its square, as a human picks on the map). */
  inView(p: Player, x: number, y: number): boolean {
    const c = this.g.node(p.node);
    return !!c && Math.abs(x - c.x) <= VIEW && Math.abs(y - c.y) <= VIEW;
  }
  private plot(ref: number): Land | Facility | undefined {
    const b = this.g.board;
    return ref > 2000 && ref < 4000 ? b.lands[ref - 2001] : ref > 4000 && ref < 6000 ? b.facilities[ref - 4001] : undefined;
  }
  /** Lots and plots some road square borders (what a human can pick), in ref order. */
  private plotRefs(): number[] {
    if (!this.refs) {
      const set = new Set<number>();
      for (const n of this.g.board.nodes) if (this.plot(n.ref)) set.add(n.ref);
      this.refs = [...set].sort((a, b) => a - b);
    }
    return this.refs;
  }
  private refs?: number[];
  private street(name: string): Land[] { return this.g.board.lands.filter(l => l.name === name); }
  /** No player, NPC or object on a road square (Tools.emptyNode). */
  private empty(id: number): boolean {
    const g = this.g;
    return g.occupants(id).length === 0 && !g.places.npcs.some(c => c && c.where === 0 && c.node === id) && !g.objects.at(id);
  }
  private onRoad(q: Player): boolean { return q.placed && !!q.whoPlays && !this.g.offRoad(q); }
  /** Rivals standing on p's screen (pickable on the map). */
  private rivalsInView(p: Player): Player[] {
    return this.g.players.filter(q => q.id !== p.id && this.onRoad(q) && (n => !!n && this.inView(p, n.x, n.y))(this.g.node(q.node)));
  }
  /** How much hurting rival q counts: the leader most. */
  private weight(_p: Player, q: number, lead: number): number { return q === lead ? 1.5 : 1; }

  /**
   * The toll value of a lot at `level` for its street (what each landing pays more): a lot adds its own toll to the
   * owner's street sum. Chain stores 2000 each. × PI.
   */
  private lotToll(l: Land, level: number, chain = l.chain): number { return (chain ? (level ? 2000 : 0) : l.tolls[Math.max(0, Math.min(5, level))] ?? 0) * this.g.priceIndex; }
  private facToll(f: Facility, level: number): number { return f.type >= 1 && f.type <= 2 && level > 0 ? (f.fees[level] ?? 0) * 3 * this.g.priceIndex : 0; }
  /** Landings a toll is worth over the rest of the game, roughly (the value of a toll change). */
  private readonly LANDINGS = 2;

  /** Value for p of a change of toll on a property of owner `owner` (player id + 1): +mine, −(weighted) rivals'. */
  private tollDelta(p: Player, owner: number, delta: number, lead: number): number {
    if (!owner) return 0;
    if (owner === p.id + 1) return delta * this.LANDINGS;
    if (p.ally === owner) return 0;
    return -delta * this.LANDINGS * this.weight(p, owner - 1, lead) * 0.8;
  }

  /** The candidate cards and tools of this moment, each with its value (above its threshold) and its play. */
  actions(p: Player): Act[] {
    const g = this.g, PI = g.priceIndex, out: Act[] = [];
    const lead = this.leader(p), money = this.money(p);
    const card = (id: number, score: number, a0: number, a1 = 0) => { if (p.cards.includes(id) && score > 0) out.push({ score, run: () => g.cards.playAs(p, id, a0, a1) }); };
    const tool = (id: number, score: number, param: number) => { if (p.tools[id - 1] > 0 && score > 0) out.push({ score, run: () => this.useTool(p, id, param) }); };
    const has = (id: number) => p.cards.includes(id);
    const standing = g.node(p.node)?.ref ?? 0, here = this.plot(standing);
    const view = this.plotRefs().filter(r => { const x = this.plot(r)!; return this.inView(p, x.x, x.y); });
    const rivals = this.rivalsInView(p);
    const max = this.maxDice(p), route = this.route(p, 6 * max);
    let rollNow = -Infinity;
    for (let d = 1; d <= max; d++) rollNow = Math.max(rollNow, this.rollValue(p, d, route));

    // 1 均富卡: everyone's cash to the average.
    if (has(1)) {
      const all = g.living(), avg = all.reduce((x, q) => x + q.cash, 0) / all.length;
      card(1, avg - p.cash - 15000 * PI, 0);
    }
    // 2 均貧卡 / 26 查稅卡: the rival on screen with the most cash.
    if (has(2) || has(26)) for (const q of rivals) {
      card(2, (q.cash - p.cash) / 2 * this.weight(p, q.id, lead) - 10000 * PI, q.id);
      if (!g.rules?.casinoItems) card(26, q.cash * 0.2 * this.weight(p, q.id, lead) * (q.cards.includes(20) || q.cards.includes(19) ? 0.3 : 1) - 5000 * PI, q.id);
    }
    // 3 購地卡: the rival's lot under it, at its price.
    if (has(3) && here && here.owner && here.owner !== p.id + 1 && !g.rules?.casinoItems) {
      const lvl = here.level, worth = (here.price + lvl * (standing < 4000 ? (here as Land).perLevel : (here as Facility).fees[0])) * PI;
      if (worth <= p.cash && money - worth >= this.reserve(p) * 0.5) {
        const t = standing < 4000 ? this.lotToll(here as Land, lvl) * (1 + this.ownOnStreet(p, (here as Land).name)) : this.facToll(here as Facility, lvl);
        card(3, t * this.LANDINGS * 1.5 - worth * (PI - 1) / PI - 3000 * PI, 0);
      }
    }
    // 4 換地卡 / 5 換屋卡: its own lot under it for a rival's better one on screen (owners / buildings swapped).
    if ((has(4) || has(5)) && here && !g.rules?.casinoItems) {
      const big = standing > 4000;
      for (const r of view) {
        if (r === standing || (r > 4000) !== big) continue;
        const o = this.plot(r)!;
        if (has(4)) card(4, this.swapValue(p, standing, r, true, lead) - 3000 * PI, r);
        if (has(5) && (big ? (here as Facility).level !== (o as Facility).level : !(here as Land).chain && !(o as Land).chain)) card(5, this.swapValue(p, standing, r, false, lead) - 3000 * PI, r);
      }
    }
    // 9 天使卡: a street on screen up one level (its own most), or one facility.
    if (has(9)) for (const r of view) {
      if (r < 4000) {
        const l = this.plot(r) as Land;
        let v = 0;
        for (const x of this.street(l.name)) if (x.owner && !x.chain && x.level < 5) v += this.tollDelta(p, x.owner, this.lotToll(x, x.level + 1) - this.lotToll(x, x.level), lead);
        card(9, v - 4000 * PI, r);
      } else {
        const f = this.plot(r) as Facility;
        if (f.owner === p.id + 1 && f.level > 0 && f.level < (FAC_MAX[f.type] ?? 5)) card(9, this.facToll(f, f.level + 1) - this.facToll(f, f.level) - 4000 * PI, r);
      }
    }
    // 10 惡魔卡: a street on screen flattened (all owners). 11 怪獸卡: one rival building down to the ground. 12 拆除卡: one level.
    if ((has(10) || has(11) || has(12)) && !g.rules?.casinoItems) for (const r of view) {
      const x = this.plot(r)!;
      if (r < 4000) {
        const l = x as Land;
        if (has(10)) {
          let v = 0;
          for (const y of this.street(l.name)) if (y.owner && (y.level || y.chain)) v += this.tollDelta(p, y.owner, this.lotToll(y, 0, false) - this.lotToll(y, y.level), lead);
          card(10, v - 8000 * PI, r);
        }
        if (l.owner && l.owner !== p.id + 1 && l.level > 0) {
          if (has(11)) card(11, this.tollDelta(p, l.owner, this.lotToll(l, 0, false) - this.lotToll(l, l.level), lead) - 4000 * PI, r);
          if (has(12)) card(12, this.tollDelta(p, l.owner, l.chain ? -this.lotToll(l, 1) : this.lotToll(l, l.level - 1) - this.lotToll(l, l.level), lead) - 2000 * PI, r);
        }
      } else {
        const f = x as Facility;
        if (f.owner && f.owner !== p.id + 1 && f.level > 0) {
          if (has(11)) card(11, this.tollDelta(p, f.owner, -this.facToll(f, f.level), lead) - 4000 * PI, r);
          if (has(12)) card(12, this.tollDelta(p, f.owner, this.facToll(f, f.level - 1) - this.facToll(f, f.level), lead) - 2000 * PI, r);
        }
      }
    }
    // 13 搶奪卡: the dearest card or tool of a rival on screen.
    if (has(13)) for (const q of rivals) {
      let pick = 0, worth = 0;
      for (const c of q.cards) if ((CARD_POINTS[c - 1] ?? 0) > worth) { worth = CARD_POINTS[c - 1]; pick = c; }
      q.tools.forEach((n, i) => { if (n > 0 && i < 13 && i !== 9 && (TOOL_POINTS[i] ?? 0) > worth) { worth = TOOL_POINTS[i]; pick = 100 + i + 1; } });
      if (pick) card(13, worth * 60 * PI * this.weight(p, q.id, lead) - 2500 * PI, q.id, pick);
    }
    // 14 停留卡: a rival standing on its lot pays it again; or itself, when staying beats moving.
    if (has(14)) {
      for (const q of rivals) {
        const n = g.node(q.node), x = this.plot(n.ref);
        if (q.stay || q.sleep || !x || x.owner !== p.id + 1 || n.event !== 0) continue;
        card(14, this.fee(q, q.node, this.maxDice(q) * 3.5) * this.weight(p, q.id, lead) - 3000 * PI, q.id);
      }
      if (!p.turtle) card(14, this.stopValue(p, p.node, 0) - rollNow - 3000 * PI, p.id);
    }
    // 15 冬眠卡: everyone else sleeps five turns (nobody collects from it then): when its road is dangerous.
    if (has(15)) card(15, this.reserve(p) - money * 0.4, 0);
    // 16 夢遊卡 / 17 陷害卡: the leader (else the richest) on screen: no tolls while away.
    if (has(16) || has(17)) for (const q of rivals) {
      if (q.cards.includes(18) || q.cards.includes(21)) continue;
      const w = (g.wealth(q) / Math.max(1, g.wealth(p))) * this.weight(p, q.id, lead);
      if (has(17)) card(17, w * 5000 * PI - 3000 * PI, q.id);
      if (has(16) && !q.sleep) card(16, w * 4000 * PI - 3000 * PI, q.id);
    }
    // 27 漲價卡: its own street on screen, tolls doubled for five days.
    if (has(27) && !g.rules?.casinoItems) {
      const seen = new Set<string>();
      for (const r of view) {
        if (r > 4000) continue;
        const l = this.plot(r) as Land;
        if (seen.has(l.name)) continue;
        seen.add(l.name);
        let mine = 0, theirs = 0;
        for (const x of this.street(l.name)) if (x.owner === p.id + 1) mine += this.lotToll(x, x.level); else if (x.owner) theirs += this.lotToll(x, x.level);
        card(27, mine - theirs * 1.5 - 8000 * PI, r);
      }
    }
    // 28 查封卡: the worst rival street (or facility) within reach: nothing due there for five days.
    if (has(28)) {
      const dist = DIST[max], seen = new Set<number>();
      for (let i = 0; i < route.length; i++) {
        const n = g.node(route[i]), x = this.plot(n.ref);
        if (!x || !x.owner || x.owner === p.id + 1 || !this.inView(p, x.x, x.y)) continue;
        const key = n.ref < 4000 ? -this.street((x as Land).name)[0].id : n.ref;
        if (seen.has(key)) continue;
        seen.add(key);
        // The chance of stopping on any square of that street within this roll, times its toll.
        let pr = 0;
        route.forEach((id, j) => { const y = this.plot(g.node(id).ref); if (y && (n.ref < 4000 ? g.node(id).ref < 4000 && (y as Land).name === (x as Land).name : g.node(id).ref === n.ref)) pr += dist[j + 1] ?? 0; });
        const fee = this.fee(p, route[i], i + 1);
        card(28, pr * fee * 1.5 + (fee > money ? pr * 50000 * PI : 0) - 3000 * PI, n.ref);
      }
    }
    // 22 送神符, 23 請神符, 24 紅卡, 25 黑卡, 30 烏龜卡, 7 改建卡 and a map's own cards: the original's judgement,
    // without its personality limit.
    for (const id of [22, 23, 24, 25, 30, 7, ...(g.rules?.ownCards ?? [])]) {
      if (!has(id)) continue;
      const before = [g.cards.aiArg0, g.cards.aiArg1];
      if (this.classicWants(p, id)) { const a0 = g.cards.aiArg0, a1 = g.cards.aiArg1; card(id, 2500 * PI, a0, a1); }
      [g.cards.aiArg0, g.cards.aiArg1] = before;
    }

    // ---- tools
    // 5 機車 / 6 汽車: more dice, more choice.
    if (p.traffic === 0 && p.tools[5] > 0) tool(6, 6000 * PI, 0);
    else if (p.traffic === 0 && p.tools[4] > 0) tool(5, 5000 * PI, 0);
    else if (p.traffic === 1 && p.tools[5] > 0) tool(6, 4000 * PI, 0);
    // 9 機器工人: its best property on screen one level up.
    if (p.tools[8] > 0) {
      let best = 0, v = 0;
      for (const r of view) {
        const x = this.plot(r)!;
        if (x.owner !== p.id + 1) continue;
        const gain = r < 4000 ? ((x as Land).chain || x.level >= 5 ? 0 : (this.lotToll(x as Land, x.level + 1) - this.lotToll(x as Land, x.level)) * this.LANDINGS)
          : x.level < (FAC_MAX[(x as Facility).type] ?? 5) ? (x.level ? this.facToll(x as Facility, x.level + 1) - this.facToll(x as Facility, x.level) : 3000 * PI) * this.LANDINGS : 0;
        if (gain > v) { v = gain; best = r; }
      }
      if (best) tool(9, v - 1000 * PI, best);
    }
    // 1 機器娃娃: clears what would hurt it on the road ahead.
    if (p.tools[0] > 0) {
      const dist = DIST[max];
      let harm = 0;
      route.slice(0, 9).forEach((id, i) => {
        const t = g.objects.at(id)?.type ?? 0;
        if (t === O.Mine || t === O.TimeBomb || t === O.Dog || t === O.SmallPoor || t === O.BigPoor || t === O.SmallBad || t === O.BigBad || t === O.Devil) harm += (dist[i + 1] ?? 0) * 3 * this.turnCost(p);
      });
      tool(1, harm - 1500 * PI, 0);
    }
    // 2 路障: in front of a rival on its own expensive lot (they stop and pay), or in front of itself before the danger.
    if (p.tools[1] > 0) {
      let best = 0, v = 0;
      const consider = (node: number, gain: number) => { if (gain > v && this.empty(node) && (n => !!n && this.inView(p, n.x, n.y))(g.node(node))) { v = gain; best = node; } };
      for (const q of g.players) {
        if (q.id === p.id || !this.onRoad(q) || q.sleep || q.stay || q.turtle) continue;
        const d = this.maxDice(q), r = this.route(q, 6 * d);
        r.forEach((node, i) => {
          const x = this.plot(g.node(node).ref);
          if (!x || x.owner !== p.id + 1 || g.node(node).event !== 0) return;
          let reach = 0;
          DIST[d].forEach((pr, s) => { if (s > i) reach += pr; });
          consider(node, reach * this.fee(q, node, i + 1) * this.weight(p, q.id, lead));
        });
      }
      route.forEach((node, k) => {
        let ev = 0;
        DIST[max].forEach((pr, s) => { if (pr) ev += pr * this.walkValue(p, route, Math.min(s, k + 1)); });
        consider(node, ev - rollNow);
      });
      if (best) tool(2, v - 2500 * PI, best);
    }
    // 3 地雷: where a rival (the leader most) is likely to stop, off its own way.
    if (p.tools[2] > 0) {
      let best = 0, v = 0;
      const mine = new Set(route);
      for (const q of g.players) {
        if (q.id === p.id || !this.onRoad(q) || q.sleep || q.stay) continue;
        const d = this.maxDice(q), r = this.route(q, 6 * d);
        r.forEach((node, i) => {
          const n = g.node(node);
          if (mine.has(node) || !this.empty(node) || !this.inView(p, n.x, n.y)) return;
          const gain = (DIST[d][i + 1] ?? 0) * 3 * (2500 * PI + 0.01 * this.money(q)) * this.weight(p, q.id, lead);
          if (gain > v) { v = gain; best = node; }
        });
      }
      if (best) tool(3, v - 1200 * PI, best);
    }
    // 7 飛彈 / 13 核子飛彈: where the blast hurts the rivals most and it least.
    for (const t of [7, 13]) if (p.tools[t - 1] > 0) { const b = this.bestBlast(p, t === 13, lead); tool(t, b.v - (t === 13 ? 15000 : 5000) * PI, b.node); }
    // 4 定時炸彈, 11 傳送機, 12 工程車: the original's judgement.
    for (const t of [4, 11, 12]) if (p.tools[t - 1] > 0) { const param = g.tools.judgeFor(p, t); if (param !== null) tool(t, 2000 * PI, param); }
    return out;
  }

  /** The original computer's wish to play card `id` (its own rule, no personality limit); sets aiArg0 / aiArg1. */
  private classicWants(p: Player, id: number): boolean {
    return this.g.cards.judgeFor(p, id);
  }

  private *useTool(p: Player, id: number, param: number): Flow<boolean> {
    yield* this.g.say(p.id, `使用${TOOL_NAMES[id - 1] ?? ''}`);
    return yield* this.g.tools.use(p, id, param);
  }

  /** 換地卡 (owners) / 換屋卡 (buildings) between `a` (under it) and `b`: the change in tolls for it and its rivals. */
  private swapValue(p: Player, a: number, b: number, owners: boolean, lead: number): number {
    const x = this.plot(a)!, y = this.plot(b)!;
    const val = (r: number, owner: number, level: number, chain: boolean) => r < 4000 ? this.tollDelta(p, owner, this.lotToll(this.plot(r) as Land, level, chain), lead) : this.tollDelta(p, owner, this.facToll(this.plot(r) as Facility, level), lead);
    const ca = a < 4000 && (x as Land).chain, cb = b < 4000 && (y as Land).chain;
    const before = val(a, x.owner, x.level, ca) + val(b, y.owner, y.level, cb);
    const after = owners ? val(a, y.owner, x.level, ca) + val(b, x.owner, y.level, cb) : val(a, x.owner, y.level, cb) + val(b, y.owner, x.level, ca);
    // A street sum: the lot also joins (or leaves) the owner's other lots on that street.
    let street = 0;
    if (owners && a < 4000 && b < 4000) {
      street += (this.ownOnStreet(p, (y as Land).name) - this.ownOnStreet(p, (x as Land).name)) * 1500 * this.g.priceIndex;
    }
    return after - before + street;
  }

  /** The best square for a missile (±100 px, buildings one level down) or a nuke (±220 px, back to empty lots). */
  private bestBlast(p: Player, nuke: boolean, lead: number): { node: number; v: number } {
    const g = this.g, PI = g.priceIndex, half = nuke ? VIEW : 100, me = p.id + 1;
    let best = 0, v = 0;
    for (const n of g.board.nodes) {
      if (!n.adjacent.some(Boolean)) continue;
      // A missile is picked anywhere on the map (Tools.missile asks every road square).
      const hit = (x: number, y: number) => Math.abs(x - n.x) <= half && Math.abs(y - n.y) <= half;
      const self = g.node(p.node);
      if (hit(self.x, self.y)) continue;
      let score = 0;
      for (const l of g.board.lands) {
        if (!l.owner || !hit(l.x, l.y)) continue;
        const loss = nuke ? -(this.lotToll(l, l.level) + l.price * PI * 0.5) : (l.level ? this.lotToll(l, l.level - 1) - this.lotToll(l, l.level) : 0);
        score += l.owner === me ? loss * this.LANDINGS * 1.5 : this.tollDelta(p, l.owner, loss, lead);
      }
      for (const f of g.board.facilities) {
        if (!f.owner || !hit(f.x, f.y)) continue;
        const loss = nuke ? -(this.facToll(f, f.level) + f.price * PI * 0.5) : (f.level ? this.facToll(f, f.level - 1) - this.facToll(f, f.level) : 0);
        score += f.owner === me ? loss * this.LANDINGS * 1.5 : this.tollDelta(p, f.owner, loss, lead);
      }
      for (const q of g.players) {
        if (q.id === p.id || !this.onRoad(q)) continue;
        const m = g.node(q.node);
        if (hit(m.x, m.y) && p.ally !== q.id + 1) score += 3 * (2500 * PI + 0.01 * this.money(q)) * this.weight(p, q.id, lead);
      }
      if (score > v) { v = score; best = n.id; }
    }
    return { node: best, v };
  }
}

interface Act { score: number; run: () => Flow<unknown> }
/** The 440 × 440 view (±220 px). */
const VIEW = 220;
const TOOL_NAMES = ['機器娃娃', '路障', '地雷', '定時炸彈', '機車', '汽車', '飛彈', '遙控骰子', '機器工人', '時光機', '傳送機', '工程車', '核子飛彈'];
/** Prices in points (cards.ts CARDS, tools.ts TOOLS), what 搶奪卡 weighs. */
const CARD_POINTS = [200, 200, 35, 25, 20, 20, 15, 20, 160, 180, 60, 15, 25, 20, 100, 25, 20, 20, 40, 25, 25, 10, 20, 50, 30, 35, 35, 35, 40, 70];
const TOOL_POINTS = [15, 30, 25, 25, 80, 150, 100, 30, 30, 40, 95, 150, 250];
/** What the shop buys, in order: [kind, id, most held]. */
const SHOP_WISHES: readonly (readonly ['card' | 'tool', number, number])[] = [
  ['tool', 8, 4], ['tool', 6, 1], ['card', 20, 2], ['card', 21, 1], ['card', 28, 2], ['card', 19, 1], ['card', 14, 2],
  ['tool', 2, 3], ['card', 10, 1], ['card', 9, 1], ['card', 17, 1], ['card', 5, 1], ['card', 4, 1], ['card', 11, 1],
  ['tool', 7, 2], ['card', 3, 1], ['card', 26, 1], ['tool', 3, 2], ['card', 12, 1], ['tool', 1, 1], ['card', 13, 1],
];
