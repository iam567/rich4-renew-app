/**
 * 挑戰模式 (docs/rules/26): which tasks a game draws (random tasks of the map's pool until their full marks add up to
 * 120 stars; the first to 100 stars wins) and the tracker that measures every player's progress on them.
 *
 * The tracker only watches, like the statistics ledger (core/stats.ts, which it reads): the events the engine yields
 * (`see`) and the state at each new day (`newDay`). It never draws from the game's random stream and never changes the
 * rules state. A task's measure is a number (times, days, money, a level 0..3); a player keeps the best value seen, so
 * stars once earned stay. Tasks without a measure yet are listed by `unmeasured` (the simulation reports them).
 */
import { CHALLENGE_TASKS, type ChallengeTask } from './challenge-tasks';
import { day as dayOf, month as monthOf } from './date';
import type { Game } from './game';
import { ledgerOf, TOLL_REASONS, type PlayerStats } from './stats';
import type { GameEvent, Player } from './types';

export { CHALLENGE_TASKS, type ChallengeTask };

export const CHALLENGE_TOTAL = 120;
export const CHALLENGE_WIN = 100;

/** The tasks a game on `mapId` can draw: the shared library (less those the map skips) and the map's own. */
export const taskPool = (mapId: number) => CHALLENGE_TASKS.filter(t => (t.map === -1 && !t.skip?.includes(mapId)) || t.map === mapId);

/** Full marks of a task. */
export const fullStars = (t: ChallengeTask) => (t.once ? t.stars : 3);

/**
 * The tasks of one game (26 §2): drawn at random from the pool until their full marks add up to exactly 120; a 3-star
 * task that no longer fits is passed over for a 1-star one. Its own random stream from `seed`, not the game's.
 */
export function drawTasks(mapId: number, seed: number): ChallengeTask[] {
  let s = (seed ^ 0x5eed7a5c) >>> 0;
  const rnd = () => { s = (s + 0x6d2b79f5) >>> 0; let x = s; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
  const pool = taskPool(mapId).slice();
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const out: ChallengeTask[] = [];
  let sum = 0;
  for (const t of pool) {
    if (sum + fullStars(t) > CHALLENGE_TOTAL) continue;
    out.push(t); sum += fullStars(t);
    if (sum === CHALLENGE_TOTAL) break;
  }
  return out;
}

/** Stars for a measured value (`all` the count a "全部" threshold means on this map). */
export function starsFor(t: ChallengeTask, value: number, all = Infinity): number {
  if (t.once) return value >= 1 ? t.stars : 0;
  let n = 0;
  for (const need of t.need) if (value >= (need < 0 ? all : need)) n++;
  return n;
}

// ---------------------------------------------------------------- what the measures read

const GOOD_GODS = new Set([1, 2, 3, 4, 9]);
const BAD_GODS = new Set([5, 6, 7, 8, 10]);
const ALL_GODS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12];
const FINE_FATES = [14, 15, 16, 18, 19];

/** A player's own counters (beyond the ledger's). */
interface Own {
  n: Record<string, number>;
  /** Best value seen per task id. */
  best: Record<string, number>;
  gods: Set<number>; godRounds: number; god: number;
  magic: Set<number>;
  stops: Set<string>; stopRounds: Record<string, number>;
  offRoadDays: number; cashLowTurns: number; debtMax: number;
  dayCash: number | null; fatesSeen: Set<number>; newsSeen: Set<number>;
  route: Record<string, number>;
  chair: Record<string, number>;
  rich: number; poor: number; clean: number; walk: number; car: number;
  lastTurnMissiles: number; carStreak: number;
  godsToday: Set<number>; fateRun: number;
}
const blankOwn = (): Own => ({
  n: {}, best: {}, gods: new Set(), godRounds: 0, god: 0, magic: new Set(), stops: new Set(), stopRounds: {},
  offRoadDays: 0, cashLowTurns: 0, debtMax: 0, dayCash: null, fatesSeen: new Set(), newsSeen: new Set(), route: {}, chair: {},
  rich: 0, poor: 0, clean: 0, walk: 0, car: 0, lastTurnMissiles: 0, carStreak: 0, godsToday: new Set(), fateRun: 0,
});

type Measure = (c: Challenge, p: Player) => number | undefined;

export class Challenge {
  readonly tasks: ChallengeTask[];
  readonly own: Own[];
  /** Mines / bombs on the map by node: who placed them (tool 3 / 4). */
  private placed = new Map<number, number>();
  /** Mines still on the map by node: who laid them. */
  private mines = new Map<number, number>();
  /** The players a carried bomb has passed through, by bomb holder. */
  private bombChain = new Map<number, number[]>();
  private allHospital = false; private allPrison = false;
  private current = -1;
  /** Set when `p` reaches 100 stars (the first only). */
  winner = -1;

  constructor(readonly g: Game, tasks?: ChallengeTask[]) {
    this.tasks = tasks ?? drawTasks(g.board.mapId, g.settings.seed);
    this.own = g.players.map(() => blankOwn());
  }

  /** The ledger's counters of `p` (the simulation and the game attach one). */
  stats(p: Player): PlayerStats | undefined { return ledgerOf(this.g.players)?.of(p.id); }

  bump(p: number, key: string, by = 1) { const o = this.own[p]; o.n[key] = (o.n[key] ?? 0) + by; }
  n(p: Player, key: string) { return this.own[p.id].n[key] ?? 0; }

  // ---------------------------------------------------------------- events

  see(e: GameEvent): void {
    const g = this.g, isP = (x?: number): x is number => x !== undefined && x >= 0 && x < g.players.length;
    switch (e.t) {
      case 'turn': {
        this.current = e.p;
        const p = g.players[e.p], o = this.own[e.p];
        o.lastTurnMissiles = this.missiles(p);
        if (p.cash <= 0) o.cashLowTurns++; else o.cashLowTurns = 0;
        this.bestOf(p, 'G18', o.cashLowTurns);
        break;
      }
      case 'dice': {
        const v = e.values, o = this.own[e.p], sum = v.reduce((a, b) => a + b, 0);
        if (v.length === 3) {
          if (v[0] === v[1] && v[1] === v[2]) this.bump(e.p, 'leopard');
          if (sum >= 15) this.bump(e.p, 'car15');
          if (sum >= 16) this.bump(e.p, 'car16');
          if (sum === 18) this.bump(e.p, 'car18');
          o.carStreak = sum >= 15 ? o.carStreak + 1 : 0;
          if (o.carStreak >= 3) { this.bump(e.p, 'car15x3'); o.carStreak = 0; }
        } else o.carStreak = 0;
        if (v.length === 2) {
          if (v[0] === v[1]) this.bump(e.p, 'pair');
          if (sum === 12) this.bump(e.p, 'moto12');
        }
        break;
      }
      case 'step':
        if (isP(e.p)) { this.passed(e.p, e.to); if (e.left === 0) this.stopped(e.p, e.to); }
        break;
      case 'pay': this.pay(e); break;
      case 'buy': case 'build': break;
      case 'fx': this.fx(e, isP); break;
      default: break;
    }
  }

  private fx(e: Extract<GameEvent, { t: 'fx' }>, isP: (x?: number) => x is number) {
    const g = this.g, d = (e.data ?? {}) as Record<string, unknown>, num = (k: string) => Number(d[k] ?? 0);
    const p = isP(e.p) ? e.p : -1, tgt = isP(e.target) ? e.target : -1;
    switch (e.kind) {
      case 'fate': if (p >= 0) {
        const id = num('id'), o = this.own[p];
        this.bump(p, `fate:${id}`); o.fatesSeen.add(id);
        o.fateRun++;
        break;
      } break;
      case 'news': if (p >= 0) { this.bump(p, `drew-news:${num('id')}`); this.own[p].newsSeen.add(num('id')); } break;
      case 'god-attach': if (p >= 0) {
        const t = num('type'), o = this.own[p];
        if (BAD_GODS.has(o.god) && GOOD_GODS.has(t) || (BAD_GODS.has(o.god) && t === 12)) this.bump(p, 'turnLuck');
        if (o.godsToday.size && !o.godsToday.has(t)) this.bump(p, 'twoGodsDay');
        o.godsToday.add(t);
        if (t === 2 || t === 4) this.bump(p, 'bigGood');
        o.god = t; o.gods.add(t);
        if (ALL_GODS.every(x => o.gods.has(x))) { o.godRounds++; o.gods.clear(); }
        if (this.n(g.players[p], 'pray') > this.n(g.players[p], 'prayGot') && GOOD_GODS.has(t)) this.bump(p, 'prayGot');
        break;
      } break;
      case 'god-detach': if (p >= 0) this.own[p].god = 0; break;
      case 'card': if (p >= 0) {
        const id = num('card');
        this.bump(p, `card:${id}`);
        if (id === 22 && BAD_GODS.has(this.own[p].god)) this.bump(p, 'sendBadGod');
        if (id === 23) this.bump(p, 'pray');
        break;
      } break;
      case 'sleepwalk': if (tgt >= 0 && tgt !== p) this.bump(tgt, 'got:sleepwalk'); break;
      case 'turtle': if (tgt >= 0 && tgt !== p) this.bump(tgt, 'got:turtle'); break;
      case 'turn-around': if (tgt >= 0 && tgt !== p) this.bump(tgt, 'got:turn'); break;
      case 'hibernate': { const who = Array.isArray(d.who) ? (d.who as number[]) : []; for (const q of who) if (isP(q) && q !== p) this.bump(q, 'got:hibernate'); if (p >= 0 && who.length >= g.living().length - 1) this.bump(p, 'hibernateAll'); break; }
      case 'card-taken': if (p >= 0 && tgt >= 0) { this.bump(p, 'grab'); this.bump(p, `grabFrom:${tgt}`); } break;
      case 'magic': if (p >= 0) { this.own[p].magic.add(num('magic')); this.bump(p, 'magic'); } break;
      case 'lottery-draw': { const w = num('winner'); if (d.winner !== undefined && isP(w)) this.bump(w, 'lotto'); break; }
      case 'mini-game': if (p >= 0) { this.bestOf(g.players[p], 'G64', num('points')); this.bump(p, 'mini'); this.bump(p, `mini:${String(d.game)}`); } break;
      case 'chest': if (p >= 0) this.bump(p, 'chest'); break;
      case 'gift': if (p >= 0) this.bump(p, 'gift'); break;
      case 'dog': if (p >= 0) this.bump(p, 'dog'); break;
      case 'earth-god': if (p >= 0) this.bump(p, 'earthGod'); break;
      case 'angel': if (p >= 0 && e.node !== undefined) { const ref = num('ref'); if (this.ownerOfRef(ref) >= 0 && this.ownerOfRef(ref) !== p) this.bump(p, 'kindAngel'); } break;
      case 'devil': if (p >= 0 && e.node !== undefined) { const ref = num('ref'); if (this.ownerOfRef(ref) === p) this.bump(p, 'selfDevil'); } break;
      case 'monster': case 'demolish': { const ref = num('ref'), o = this.ownerOfRef(ref); if (o >= 0) this.bump(o, 'lostBuilding'); break; }
      case 'place-object': if (p >= 0 && e.node !== undefined) {
        this.placed.set(e.node, p);
        if (num('type') === 17) { this.mines.set(e.node, p); this.bestOf(g.players[p], 'G58', [...this.mines.values()].filter(x => x === p).length); }
      } break;
      case 'mine': if (p >= 0 && e.node !== undefined) {
        const by = this.placed.get(e.node);
        this.placed.delete(e.node); this.mines.delete(e.node);
        this.bump(p, 'mineHit');
        if (by === p) this.bump(p, 'selfHarm');
        else if (by !== undefined) this.bump(by, 'mineGot');
        if (g.players[p].traffic & 2) this.bump(p, 'carMine');
        break;
      } break;
      case 'bomb-pickup': if (p >= 0 && e.node !== undefined) { const by = this.placed.get(e.node); this.bombChain.set(p, by !== undefined && by !== p ? [by] : []); if (by !== undefined && by !== p) this.bump(by, 'bombPlanted'); } break;
      case 'bomb-pass': if (p >= 0 && tgt >= 0) { this.bombChain.set(tgt, [...(this.bombChain.get(p) ?? []), p]); this.bombChain.delete(p); } break;
      case 'bomb-explode': if (p >= 0) {
        const chain = this.bombChain.get(p) ?? [];
        this.bombChain.delete(p);
        for (const h of new Set(chain)) if (h !== p) this.bump(h, 'bombOnOther');
        if (chain.some(h => h !== p)) this.bump(p, 'bombOnMe');
        if (chain.length === 1 && chain[0] === p) this.bump(p, 'selfHarm');
        break;
      } break;
      case 'to-hospital': if (p >= 0) {
        const cur = this.current;
        if (cur >= 0 && cur !== p && this.missiles(g.players[cur]) > this.own[cur].lastTurnMissiles) this.bump(cur, 'missileHit');
        this.checkAll();
        break;
      } break;
      case 'to-prison': this.checkAll(); break;
      case 'enter-hotel': if (p >= 0) {
        const f = g.board.facilities[num('facility') - 1], days = num('days');
        if (!f) break;
        this.bump(p, `stayAt:${f.name}`);
        if (f.owner && f.owner - 1 !== p) {
          if (days >= 4) { this.bump(p, 'stay4'); this.bump(f.owner - 1, 'guest4'); this.bump(f.owner - 1, `guest4:${f.name}`); }
          this.bump(p, `hotels:${f.id}`);
        }
        break;
      } break;
      case 'wheel': if (d.wheel === 2 && p >= 0) {
        // The shopping wheel (WheelKind.shopping = 2): the visitor's multiplier at the facility under their feet.
        const f = this.facilityAt(g.players[p].node), v = num('value');
        if (f && f.owner && f.owner - 1 !== p) {
          if (v >= 6) { this.bump(p, 'mall6'); this.bump(f.owner - 1, 'mall6Owner'); this.bump(f.owner - 1, `mall6:${f.name}`); }
          if (v >= 5) this.bump(f.owner - 1, `mall5:${f.name}`);
        }
        break;
      } break;
      case 'lab-order': if (p >= 0) { const f = g.board.facilities[num('facility') - 1]; this.bump(p, 'lab'); if (f) this.bump(p, `lab:${f.name}`); } break;
      case 'auction-end': { const b = num('buyer'); if (isP(b) && d.buyer !== -1) this.bump(b, 'auctionWin'); break; }
      default: break;
    }
  }

  private pay(e: Extract<GameEvent, { t: 'pay' }>) {
    const g = this.g, from = e.from, to = e.to;
    const isP = (x: number) => x >= 0 && x < g.players.length;
    if (isP(from)) this.bestOf(g.players[from], 'G20', e.amount);
    if (isP(to) && e.reason === '理賠金') this.bump(to, 'insurance');
    if (!(isP(from) && isP(to) && from !== to && TOLL_REASONS.has(e.reason))) return;
    this.bestOf(g.players[to], 'O05', e.amount);
    const payer = g.players[from], at = g.node(payer.node);
    const land = at.ref > 2000 && at.ref < 4000 ? g.board.lands[at.ref - 2001] : undefined;
    const fac = this.facilityAt(payer.node);
    this.bump(to, 'tollIn');
    this.bump(to, `paidBy:${from}:${this.g.daysElapsed}`);
    if (land) { this.bump(to, `tollAt:${land.name}`); if (land.tmpState && (land.tmpState & 0xf) === 1) this.bump(to, `raisedToll:${land.name}`); }
    if (fac && fac.type === 3 && (payer.traffic & 3) === 2) this.bump(to, `gasCar:${fac.name}`);
    if (fac && fac.type === 3) this.bump(to, 'gas');
    this.bump(from, 'paidToll');
    this.own[from].clean = 0;
    const living = g.living().filter(q => q.id !== to);
    if (living.length && living.every(q => this.n(g.players[to], `paidBy:${q.id}:${g.daysElapsed}`) > 0)) this.bump(to, `allPaid:${g.daysElapsed}`);
  }

  /** Every living player in hospital / in prison at once (counted once per time it happens, for everyone). */
  private checkAll() {
    const live = this.g.living();
    const h = live.length > 1 && live.every(q => q.hospital !== 0), pr = live.length > 1 && live.every(q => q.prison !== 0);
    if (h && !this.allHospital) for (const q of live) this.bump(q.id, 'allHospital');
    if (pr && !this.allPrison) for (const q of live) this.bump(q.id, 'allPrison');
    this.allHospital = h; this.allPrison = pr;
  }

  private passed(p: number, node: number) {
    const name = this.placeName(node);
    if (!name) return;
    for (const [id, seq] of Object.entries(ROUTES)) {
      if (!this.tasks.some(t => t.id === id)) continue;
      const o = this.own[p], at = o.route[id] ?? 0, k = seq.length;
      // Either direction: progress counts up the list; a negative value counts down it.
      if (at === 0) { if (name === seq[0]) o.route[id] = 1; else if (name === seq[k - 1] && k > 2) o.route[id] = -1; continue; }
      if (at > 0 && name === seq[at]) { o.route[id] = at + 1; if (at + 1 === k) { this.bump(p, `route:${id}`); o.route[id] = 0; } }
      else if (at < 0 && name === seq[k - 1 + at]) { o.route[id] = at - 1; if (-(at - 1) === k) { this.bump(p, `route:${id}`); o.route[id] = 0; } }
    }
  }

  private stopped(p: number, node: number) {
    const g = this.g, pl = g.players[p], o = this.own[p], n = g.node(node);
    const name = this.placeName(node);
    if (name) this.bump(p, `stop:${name}`);
    if (n.event) this.bump(p, `ev:${n.event}`);
    if (n.event !== 3) o.fateRun = 0;
    o.stops.add(name ? `s:${name}` : '');
    if (n.event) o.stops.add(`e:${n.event}`);
    // Stopping in a 'god' state (財神 / 福神 / 衰神 …) at a named place.
    if (name) {
      if (GOOD_GODS.has(o.god) && (o.god <= 4)) this.bump(p, `luckyStop:${name}`);
      if (o.god === 7 || o.god === 8) this.bump(p, `badStop:${name}`);
      if ((pl.traffic & 3) === 0) this.bump(p, `walkStop:${name}`);
      const m = monthOf(g.date);
      this.bump(p, `stopMonth:${m}:${name}`);
    }
    // Same square: every living player / three or more.
    const here = g.living().filter(q => q.placed && !g.offRoad(q) && q.node === node);
    if (here.length >= 3) for (const q of here) this.bump(q.id, 'crowd3');
    if (here.length >= 2) this.bump(p, 'sumo');
    if (here.length === g.living().length && here.length > 1) for (const q of here) this.bump(q.id, 'allSame');
  }

  // ---------------------------------------------------------------- the day

  newDay(): void {
    const g = this.g;
    const live = g.living();
    const assets = live.map(p => g.wealth(p));
    const top = Math.max(...assets), bottom = Math.min(...assets);
    const sameStreet = live.length > 1 && live.every(q => this.placeName(q.node) && this.placeName(q.node) === this.placeName(live[0].node) && !g.offRoad(q));
    for (const p of g.players) {
      if (!p.whoPlays) continue;
      const o = this.own[p.id];
      o.offRoadDays = g.offRoad(p) ? o.offRoadDays + 1 : 0;
      o.debtMax = Math.max(o.debtMax, -p.cash);
      if (p.cash >= 0 && o.debtMax > 0) { this.bestOf(p, 'G17', o.debtMax); }
      if (o.dayCash === null) o.dayCash = p.cash;
      this.bestOf(p, 'G19', p.cash - o.dayCash);
      o.dayCash = p.cash;
      const w = g.wealth(p);
      o.rich = w === top ? o.rich + 1 : 0;
      o.poor = w === bottom && live.length > 1 ? o.poor + 1 : 0;
      o.clean++;
      o.walk = (p.traffic & 3) === 0 ? o.walk + 1 : 0;
      o.car = (p.traffic & 3) === 2 ? o.car + 1 : 0;
      if (sameStreet) this.bump(p.id, 'sameStreet');
      if (Math.abs(p.cash - p.bank) <= Math.max(p.cash, p.bank) * 0.01 && p.cash >= 10000 && p.bank >= 10000) this.bump(p.id, 'balance');
      o.godsToday.clear();
      for (const c of g.board.companies) o.chair[c.name] = c.controller === p.id + 1 ? (o.chair[c.name] ?? 0) + 1 : 0;
      this.measureAll(p);
    }
    this.checkAll();
    const best = this.leader();
    if (best >= 0 && this.winner < 0) this.winner = best;
  }

  /** The first player with 100 stars, or −1. */
  leader(): number {
    let who = -1, most = 0;
    for (const p of this.g.players) { const s = this.stars(p); if (s >= CHALLENGE_WIN && s > most) { most = s; who = p.id; } }
    return who;
  }

  stars(p: Player): number { return this.tasks.reduce((n, t) => n + starsFor(t, this.own[p.id].best[t.id] ?? 0, this.allOf(t)), 0); }

  private allOf(t: ChallengeTask): number {
    if (t.id === 'G33' || t.id === 'W01') return this.g.board.companies.length;
    return Infinity;
  }

  bestOf(p: Player, id: string, v: number) { const b = this.own[p.id].best; if (v > (b[id] ?? 0)) b[id] = v; }

  private measureAll(p: Player) {
    for (const t of this.tasks) {
      const m = MEASURES[t.id] ?? mapMeasure(t.id);
      if (!m) continue;
      const v = m(this, p);
      if (v !== undefined) this.bestOf(p, t.id, v);
    }
  }

  /** The tasks of this game without a measure yet. */
  unmeasured(): ChallengeTask[] { return this.tasks.filter(t => !MEASURES[t.id] && !mapMeasure(t.id) && !BEST_OF.has(t.id)); }

  // ---------------------------------------------------------------- helpers

  missiles(p: Player): number { const s = this.stats(p); return (s?.toolsUsed[7] ?? 0) + (s?.toolsUsed[13] ?? 0); }

  ownerOfRef(ref: number): number {
    const b = this.g.board;
    if (ref > 2000 && ref < 4000) return (b.lands[ref - 2001]?.owner ?? 0) - 1;
    if (ref > 4000 && ref < 6000) return (b.facilities[ref - 4001]?.owner ?? 0) - 1;
    return -1;
  }

  facilityAt(node: number) {
    const n = this.g.node(node);
    return n.ref > 4000 && n.ref < 6000 ? this.g.board.facilities[n.ref - 4001] : undefined;
  }

  /** The street (lot name) or large plot name a road square belongs to ('' none). */
  placeName(node: number): string {
    const n = this.g.node(node);
    if (n.ref > 2000 && n.ref < 4000) return this.g.board.lands[n.ref - 2001]?.name ?? '';
    if (n.ref > 4000 && n.ref < 6000) return this.g.board.facilities[n.ref - 4001]?.name ?? '';
    return '';
  }

  /** 0..3: a street wholly the player's / all at level ≥ 3 / all at 5. */
  streetLevel(p: Player, name: string): number {
    const lots = this.g.board.lands.filter(l => l.name === name);
    if (!lots.length || !lots.every(l => l.owner === p.id + 1)) return 0;
    return lots.every(l => l.level >= 5) ? 3 : lots.every(l => l.level >= 3) ? 2 : 1;
  }
  streetsOwned(p: Player, names: string[]) { return names.filter(n => this.streetLevel(p, n) > 0).length; }
  plotsOwned(p: Player, names: string[]) { return this.g.board.facilities.filter(f => names.includes(f.name) && f.owner === p.id + 1).length; }
  /** Rounds of stopping at every name of `names` (streets or plots). */
  stopRounds(p: Player, names: string[]): number {
    return Math.min(...names.map(n => this.n(p, `stop:${n}`)));
  }
}

// ---------------------------------------------------------------- measures

/** Tasks whose best value is set where it happens (bestOf in the event / day handlers). */
const BEST_OF = new Set(['G17', 'G18', 'G19', 'G20', 'G58', 'G64', 'O05']);

const fate = (c: Challenge, p: Player, ...ids: number[]) => ids.reduce((n, id) => n + c.n(p, `fate:${id}`), 0);
const newsHit = (c: Challenge, p: Player, ...ids: number[]) => ids.reduce((n, id) => n + (c.stats(p)?.events[`news:${id}`]?.reduce((a, b) => a + b, 0) ?? 0), 0);
const used = (c: Challenge, p: Player, id: number) => c.n(p, `card:${id}`);
const tool = (c: Challenge, p: Player, id: number) => c.stats(p)?.toolsUsed[id] ?? 0;
const cardKinds = (p: Player) => new Set(p.cards.filter(Boolean)).size;
const toolKinds = (p: Player) => new Set(p.tools.filter(Boolean)).size;
const lv5 = (c: Challenge, p: Player) => c.g.board.lands.filter(l => l.owner === p.id + 1 && l.level >= 5).length + c.g.board.facilities.filter(f => f.owner === p.id + 1 && f.level >= 5).length;
const chairs = (c: Challenge, p: Player) => c.g.board.companies.filter(x => x.controller === p.id + 1).length;
const allStops = (c: Challenge, p: Player) => {
  const evs = new Set(c.g.board.nodes.map(n => n.event).filter(e => e > 1 && e !== 14 && e !== 15));
  return Math.min(...[...evs].map(e => c.n(p, `ev:${e}`)));
};

const MEASURES: Record<string, Measure> = {
  G01: (c, p) => c.n(p, 'leopard'),
  G02: (c, p) => c.own[p.id].godRounds,
  G03: (c, p) => c.n(p, 'allHospital'),
  G04: (c, p) => c.n(p, 'allPrison'),
  G05: (c, p) => (c.own[p.id].offRoadDays >= 10 ? 1 : 0),
  G06: (c, p) => allStops(c, p),
  G07: (_c, p) => cardKinds(p),
  G08: (_c, p) => toolKinds(p),
  G09: (c, p) => c.n(p, 'lotto'),
  G10: (c, p) => c.own[p.id].magic.size,
  G11: (c, p) => Object.keys(c.own[p.id].n).filter(k => k.startsWith('allPaid:')).length,
  G12: (c, p) => c.n(p, 'missileHit'),
  G13: (c, p) => c.n(p, 'bombOnOther'),
  G15: (c, p) => c.n(p, 'turnLuck'),
  G16: (c, p) => fate(c, p, 7) + newsHit(c, p, 4),
  G21: (c, p) => c.n(p, 'bombOnMe'),
  G22: (c, p) => fate(c, p, 20, 21, 22),
  G23: (c, p) => c.own[p.id].rich,
  G24: (c, p) => fate(c, p, 26),
  G25: (c, p) => fate(c, p, 5) + (c.g.living().filter(q => q.id !== p.id).every(q => c.n(p, `grabFrom:${q.id}`) > 0) ? 1 : 0),
  G26: (c, p) => (fate(c, p, 10) && fate(c, p, 11) && fate(c, p, 13) ? 1 : 0),
  G27: (c, p) => FINE_FATES.filter(id => fate(c, p, id) > 0).length,
  G28: (c, p) => newsHit(c, p, 10),
  G29: (c, p) => newsHit(c, p, 8),
  G30: (c, p) => newsHit(c, p, 9),
  G33: (c, p) => chairs(c, p),
  G34: (c, p) => [18, 20, 21, 19, 15].filter(id => newsHit(c, p, id) > 0).length,
  G36: (c, p) => c.n(p, 'auctionWin'),
  G37: (c, p) => (c.own[p.id].debtMax >= 1_000_000 ? 1 : 0),
  G38: (c, p) => c.g.board.lands.filter(l => l.owner === p.id + 1).length + c.g.board.facilities.filter(f => f.owner === p.id + 1).length,
  G39: (c, p) => lv5(c, p),
  G40: (c, p) => c.n(p, 'kindAngel'),
  G41: (c, p) => c.n(p, 'selfDevil'),
  G44: (c, p) => c.n(p, 'sendBadGod'),
  G45: (c, p) => c.n(p, 'prayGot'),
  G46: (c, p) => c.n(p, 'twoGodsDay'),
  G48: (c, p) => c.n(p, 'got:sleepwalk'),
  G49: (c, p) => used(c, p, 17),
  G50: (c, p) => c.stats(p)?.events['card:19']?.[0] ?? used(c, p, 19),
  G51: (c, p) => used(c, p, 21),
  G52: (c, p) => c.n(p, 'got:turtle'),
  G54: (c, p) => used(c, p, 2),
  G55: (c, p) => c.n(p, 'grab'),
  G56: (c, p) => used(c, p, 28),
  G57: (c, p) => used(c, p, 3),
  G59: (c, p) => c.n(p, 'bombPlanted'),
  G60: (c, p) => tool(c, p, 1),
  G62: (c, p) => tool(c, p, 11),
  G63: (c, p) => c.n(p, 'stay4'),
  G65: (c, p) => c.own[p.id].poor,
  G66: (c, p) => c.n(p, 'insurance'),
  G67: (c, p) => fate(c, p, 6),
  G68: (c, p) => used(c, p, 29),
  G69: (c, p) => (c.own[p.id].fateRun >= 3 ? 1 : 0),
  G71: (c, p) => c.n(p, 'allSame'),
  G72: (c, p) => c.n(p, 'selfHarm'),
};

/** Ordered routes (either direction): task id → the places in order (the first again at the end for a round trip). */
const ROUTES: Record<string, string[]> = {
  T01: ['台北市', '台中市', '高雄市', '台東縣', '台北市'],
  J01: ['東京', '名古屋', '京都', '大阪'],
  Q01: ['天神', '熊本城下', '天文館', '宮崎橘通', '大分府內', '天神'],
};

// Map tasks by template (streets, plots, companies, stops, events…): id → measure.
const S = (names: string[]): Measure => (c, p) => c.streetsOwned(p, names);
const L = (name: string): Measure => (c, p) => c.streetLevel(p, name);
const CH = (name: string): Measure => (c, p) => c.own[p.id].chair[name] ?? 0;
const CH1 = (name: string): Measure => (c, p) => ((c.own[p.id].chair[name] ?? 0) > 0 ? 1 : 0);
const N = (key: string): Measure => (c, p) => c.n(p, key);
const TOUR = (names: string[]): Measure => (c, p) => c.stopRounds(p, names);
const FATE = (...ids: number[]): Measure => (c, p) => fate(c, p, ...ids);
const NEWS = (...ids: number[]): Measure => (c, p) => newsHit(c, p, ...ids);
const DEPOSIT: Measure = (_c, p) => p.bank;
const INS: Measure = (c, p) => c.n(p, 'insurance');
const BUILDERS: Measure = (c, p) => (c.stats(p)?.toolsUsed[9] ?? 0) + (c.stats(p)?.toolsUsed[12] ?? 0);
const DATE = (m: number, d: number, names: string[]): Measure => (c, p) => {
  const g = c.g;
  if (monthOf(g.date) === m && dayOf(g.date) === d && names.includes(c.placeName(p.node))) c.bump(p.id, `date:${m}${d}`);
  return c.n(p, `date:${m}${d}`);
};
const PLOTS = (names: string[]): Measure => (c, p) => c.plotsOwned(p, names);
const CAR_DAYS: Measure = (c, p) => c.own[p.id].car;
const WALK_DAYS: Measure = (c, p) => c.own[p.id].walk;

const MAP_MEASURES: Record<string, Measure> = {
  // 台灣
  T01: N('route:T01'), T02: L('台北市'), T03: S(['桃園市', '新竹市', '台中市', '彰化市', '台南市']), T04: S(['宜蘭市', '花蓮縣', '台東縣']), T05: L('高雄市'),
  T06: N('guest4:知本'), T07: N('stayAt:墾丁'), T08: N('mall6:基隆市'), T09: N('gasCar:花蓮市'),
  T10: (c, p) => c.stats(p)?.prisonDays ?? 0, T11: (c, p) => [33, 34, 35, 36].filter(id => fate(c, p, id) > 0).length,
  T12: CH1('大宇百貨'), T13: INS, T15: DATE(1, 1, ['台北市']), T16: FATE(27, 28, 29), T17: N('moto12'),
  T19: N('earthGod'), T20: TOUR(['台北市', '桃園市', '新竹市', '台中市', '彰化市', '台南市', '高雄市', '屏東市', '台東縣', '花蓮縣', '花蓮市', '太魯閣', '宜蘭市']),
  // 中國大陸
  C02: S(['北京', '天津', '承德']), C03: (c, p) => { const n = c.streetsOwned(p, ['成都', '重慶']); return n === 2 && c.streetLevel(p, '成都') === 3 && c.streetLevel(p, '重慶') === 3 ? 3 : n; },
  C04: L('桂林'), C05: S(['歸綏', '銀川', '蘭州']), C07: N('guest4:康定'), C08: N('mall6:上海'), C10: CH('中國石油'),
  C11: (c, p) => [33, 34, 35, 36].filter(id => fate(c, p, id) > 0).length, C12: N('walkStop:成都'),
  C14: (_c, p) => p.tools.filter(t => t === 1).length, C15: (c, p) => c.n(p, 'lostBuilding'), C16: DEPOSIT, C17: FATE(17), C18: NEWS(19),
  C19: N('tollAt:昆明'),
  // 日本
  J01: N('route:J01'), J02: S(['盛岡', '仙台', '福島', '秋田']), J03: S(['京都', '大阪', '神戶']), J04: (c, p) => (c.plotsOwned(p, ['姬路']) >= 2 ? 1 : 0),
  J05: N('guest4:青森'), J07: CH('ＳＥＧＡ'), J08: N('car15'), J10: N('luckyStop:宮島'), J12: (c, p) => Object.keys(c.own[p.id].n).filter(k => k.startsWith('hotels:')).length,
  J13: DATE(1, 1, ['京都']), J15: NEWS(20, 21), J17: BUILDERS, J20: INS,
  // 美國
  U02: S(['波士頓', '紐約', '華盛頓']), U03: S(['西雅圖', '洛杉磯', '聖地牙哥']), U04: N('mall6:拉斯維加斯'), U05: N('mall5:奧蘭度'),
  U06: N('guest4:邁阿密'), U07: N('gasCar:鳳凰城'), U09: (c, p) => tool(c, p, 13), U11: N('lab'), J06: N('lab:廣島'), U12: (c, p) => tool(c, p, 11), U15: (c, p) => tool(c, p, 2),
  U16: DATE(7, 4, ['華盛頓', '紐約']), U17: DEPOSIT, U18: N('raisedToll:新紐奧良'), U19: N('carMine'), U20: INS,
  // 星座
  Z01: TOUR(['魔羯座區', '獅子座區', '雙子座區', '水瓶座區', '白羊座區', '天秤座區', '巨蟹座區', '射手座區', '雙魚座區', '金牛座區', '處女座區', '天蠍座區']),
  Z05: N('badStop:水星區'), Z06: N('pair'), Z07: N('balance'), Z08: N('mineGot'), Z09: (c, p) => c.n(p, 'car18') + c.n(p, 'moto12'),
  Z14: (_c, p) => p.cash, Z16: N('sameStreet'), Z17: N('chest'), Z18: INS, Z19: CH('宇宙百貨'),
  // 武俠
  W01: (c, p) => c.g.board.companies.filter(x => ['蜀山派', '武當派', '嵩山派', '恆山派', '泰山派', '衡山派', '少林派', '華山派'].includes(x.name) && x.controller === p.id + 1).length,
  W02: S(['嵩山派', '恆山派', '泰山派', '衡山派', '華山派']), W06: CH('逍遙客棧'), W08: DEPOSIT, W10: N('mall6:長安城'),
  W12: (c, p) => used(c, p, 16) + used(c, p, 17), W14: (c, p) => used(c, p, 6), W15: (c, p) => tool(c, p, 8), W16: (c, p) => used(c, p, 18),
  W17: (c, p) => used(c, p, 15), W18: (c, p) => used(c, p, 19),
  // 恐龍
  D01: TOUR(['凸頭龍區', '腕龍區', '角蓋龍區', '火山區', '暴爪龍區', '迅猛龍區', '三觭龍區', '劍龍區']), D02: N('car15x3'), D05: (c, p) => c.g.board.facilities.filter(f => f.owner === p.id + 1 && f.type === 0 && f.level > 0).length,
  D06: (c, p) => used(c, p, 11), D07: (c, p) => used(c, p, 13), D09: N('gift'), D12: INS, D13: CH('飛龍百貨'), D14: DEPOSIT, D15: N('hibernateAll'), D19: (c, p) => used(c, p, 7),
  // 城市
  S01: (c, p) => c.g.board.companies.filter(x => x.name.endsWith('大飯店') && x.controller === p.id + 1).length,
  S02: PLOTS(['新香港', '北澳門', '新東京都', '小巴黎', '小紐約', '上海街']), S03: PLOTS(['凱薩大道', '陽光大道', '日落大道', '狂徒大道']),
  S05: N('gas'), S06: N('mall6'), S07: N('lab'), S08: (c, p) => c.g.board.facilities.filter(f => f.owner === p.id + 1 && f.type === 0 && f.level > 0).length,
  S09: FATE(6), S11: PLOTS(['北海岸', '東北角', '南灣道', '南海街', '珊瑚城']), S14: (c, p) => used(c, p, 4), S15: N('auctionWin'), S16: CH('狂徒大飯店'), S17: DEPOSIT,
  S18: (c, p) => used(c, p, 12),
  // 東京
  K01: TOUR(['上野', '池袋', '新宿', '澀谷', '品川']), K04: N('tollAt:歌舞伎町'), K09: S(['阿美橫町', '淺草雷門通', '押上', '兩國國技館通']), K10: N('got:turn'),
  K11: N('crowd3'), K12: CH('ＳＥＧＡ'), K13: BUILDERS, K14: N('moto12'), K15: INS, K16: DEPOSIT, K18: S(['表參道', '惠比壽', '道玄坡']), K19: N('sumo'),
  K06: DATE(1, 1, ['淺草雷門通']),
  // 大阪
  O01: TOUR(['道頓堀', '黑門市場', '新世界', '鶴橋']), O04: S(['黑門市場', '鶴橋', '新世界']), O06: (c, p) => used(c, p, 20), O07: (c, p) => used(c, p, 29),
  O08: CH('卡普空'), O13: CH('阪急百貨'), O14: INS, O15: (c, p) => used(c, p, 7), O16: CAR_DAYS, O17: DATE(7, 25, ['天神橋筋商店街']), O18: N('gift'),
  O19: TOUR(['京橋', '天王寺', '梅田', '難波']),
  // 札幌
  P01: (c, p) => c.n(p, 'stopMonth:2:大通西') + c.n(p, 'stopMonth:2:大通東'), P03: N('tollAt:狸小路'), P05: CH('哈德森'), P06: N('got:hibernate'), P07: NEWS(16),
  P08: N('car18'), P11: WALK_DAYS, P12: INS, P13: DEPOSIT, P14: S(['豐平', '平岸', '月寒']), P15: CH('丸井今井'), P16: BUILDERS, P17: N('dog'), P18: N('guest4:藻岩山麓'), P19: FATE(17),
  // 九州
  Q01: N('route:Q01'), Q02: S(['別府溫泉', '黑川溫泉', '由布院', '嬉野']), Q07: CH('ＬＥＶＥＬ５'), Q08: BUILDERS, Q09: CAR_DAYS, Q10: INS, Q11: DEPOSIT, Q12: CH('岩田屋'),
  Q13: N('car16'), Q14: N('bigGood'), Q16: N('chest'), Q17: NEWS(20), Q19: S(['有田', '唐津', '嬉野']),
  // 沖繩
  N01: N('tollAt:國際通'), N08: NEWS(20), N09: S(['首里', '南城', '壺屋']), N11: CAR_DAYS, N12: BUILDERS, N13: INS, N14: DEPOSIT, N15: CH('ＯＣＣ'),
  N18: (c, p) => c.n(p, 'stopMonth:8:國際通'), N19: (c, p) => used(c, p, 30), N20: CH('琉貿百貨'),
  N04: (c, p) => c.streetsOwned(p, ['古宇利島', '伊江島']) + c.plotsOwned(p, ['瀨底島', '慶良間']),
  N05: (c, p) => c.g.board.facilities.filter(f => ['那霸新都心', '美國村', '瀨底島', '慶良間'].includes(f.name) && f.owner === p.id + 1 && f.type === 1 && f.level > 0).length,
  // 激情歲月
  R04: (c, p) => c.stats(p)?.prisonDays ?? 0, R05: (c, p) => c.stats(p)?.hospitalDays ?? 0, R06: WALK_DAYS, R07: (_c, p) => p.points,
  R09: N('mini:6'), R11: N('magic'), R12: (c, p) => c.own[p.id].fatesSeen.size, R13: (c, p) => c.own[p.id].newsSeen.size, R15: N('guest4'), R16: N('mall6Owner'),
  R17: (c, p) => chairs(c, p), R19: N('ev:10'),
};

function mapMeasure(id: string): Measure | undefined { return MAP_MEASURES[id]; }

