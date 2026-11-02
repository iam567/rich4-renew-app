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
import { eventTone, ledgerOf, TOLL_REASONS, type PlayerStats } from './stats';
import type { GameEvent, Player } from './types';

export { CHALLENGE_TASKS, type ChallengeTask };

export const CHALLENGE_TOTAL = 120;
export const CHALLENGE_WIN = 100;
/** The maps with a task list (docs/rules/26-challenge-tasks.md §2–§16), in the list's order. */
export const CHALLENGE_MAPS = [0, 1, 2, 3, 4, 5, 6, 7, 100, 101, 102, 103, 104, 106, 107];
/** The deadlines to pick (26 §1): 0 = none (the first to 100 stars wins). */
export const CHALLENGE_YEARS = [0, 1, 3, 5];

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
/** 春節 (lunar new year) 2026–2032, packed dates. */
const LUNAR_NEW_YEAR = new Set([[2026, 2, 17], [2027, 2, 6], [2028, 1, 26], [2029, 2, 13], [2030, 2, 3], [2031, 1, 23], [2032, 2, 11]].map(([y, m, d]) => (y << 16) | (m << 8) | d));

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
  goodFates: number; lastNode: number; sameTurns: number; monthClean: boolean;
  lv5Lots: Set<number>; fallen: Set<number>; cardDays: number; lostDay: number;
  dash: boolean; gotPrizes: Set<number>; crashBuy: Record<number, number>; redDay: number; cashBefore: number | null;
  lastStop: Record<string, number>; t18: number; traffic: number;
  /** The angel's, devil's or earth god's stay now (G77–G79): since when, lots it raised or knocked down (the player's / others'), lots taken, tools used before. */
  stay: { type: number; day: number; mine: number; others: number; seized: number; tools: number } | null;
  /** The god that just left (replaced in the same move), till the next turn or day (G80 / G81). */
  justLeft: number;
}
const blankOwn = (): Own => ({
  n: {}, best: {}, gods: new Set(), godRounds: 0, god: 0, magic: new Set(), stops: new Set(), stopRounds: {},
  offRoadDays: 0, cashLowTurns: 0, debtMax: 0, dayCash: null, fatesSeen: new Set(), newsSeen: new Set(), route: {}, chair: {},
  rich: 0, poor: 0, clean: 0, walk: 0, car: 0, lastTurnMissiles: 0, carStreak: 0, godsToday: new Set(), fateRun: 0,
  goodFates: 0, lastNode: -1, sameTurns: 0, monthClean: true, lv5Lots: new Set(), fallen: new Set(), cardDays: 0, lostDay: -99,
  dash: false, gotPrizes: new Set(), crashBuy: {}, redDay: -1, cashBefore: null, lastStop: {}, t18: 0, traffic: 0, stay: null, justLeft: 0,
});

type Measure = (c: Challenge, p: Player) => number | undefined;

/** A saved tracker (core/save.ts). */
export interface ChallengeData { version: 1; tasks: string[]; state: Record<string, unknown> }

/** Plain data for JSON: a Set as {$set: […]}, a Map as {$map: [[k, v]…]}. */
function enc(v: unknown): unknown {
  if (v instanceof Set) return { $set: [...v].map(enc) };
  if (v instanceof Map) return { $map: [...v].map(([k, x]) => [k, enc(x)]) };
  if (Array.isArray(v)) return v.map(enc);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)]));
  return v;
}
function dec(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(dec);
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (Array.isArray(o.$set)) return new Set(o.$set.map(dec));
    if (Array.isArray(o.$map)) return new Map((o.$map as [unknown, unknown][]).map(([k, x]) => [k, dec(x)]));
    return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, dec(x)]));
  }
  return v;
}

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
  /** News drawn today (ids), the day of the last stock crash, the owners of lots / plots at the last new day (by ref). */
  private newsToday = new Set<number>();
  private crashDay = -1;
  private owners = new Map<number, number>();
  /** Who stopped where today (place name → player ids). */
  private stopsToday = new Map<string, Set<number>>();
  private current = -1;
  /** Set when `p` reaches 100 stars (the first only). */
  winner = -1;

  constructor(readonly g: Game, tasks?: ChallengeTask[]) {
    this.tasks = tasks ?? drawTasks(g.board.mapId, g.settings.seed);
    this.own = g.players.map(() => blankOwn());
  }

  /** The tracker's state for a save: the drawn tasks by id and every counter (sets and maps as tagged arrays). */
  save(): ChallengeData {
    const state: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(this)) if (k !== 'g' && k !== 'tasks') state[k] = enc(v);
    return { version: 1, tasks: this.tasks.map(t => t.id), state };
  }

  /** Restores a save's state (a game built from the same settings); tasks no longer in the table are dropped. */
  load(d: ChallengeData): void {
    const byId = new Map(CHALLENGE_TASKS.map(t => [t.id, t]));
    (this as { tasks: ChallengeTask[] }).tasks = d.tasks.map(id => byId.get(id)).filter((t): t is ChallengeTask => !!t);
    const own = dec(d.state.own) as Partial<Own>[] | undefined;
    for (const [k, v] of Object.entries(d.state)) if (k !== 'own') (this as unknown as Record<string, unknown>)[k] = dec(v);
    own?.forEach((o, i) => { if (this.own[i]) Object.assign(this.own[i], o); });
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
        for (const o of this.own) o.justLeft = 0;
        const p = g.players[e.p], o = this.own[e.p];
        o.lastTurnMissiles = this.missiles(p);
        if (o.dash) { o.dash = false; this.bump(e.p, 'dashAway'); }
        if (o.cashBefore !== null) { this.bestOf(p, 'G53', p.cash - o.cashBefore); o.cashBefore = null; }
        if (!g.offRoad(p) && p.node === o.lastNode) { o.sameTurns++; if (o.sameTurns >= 2) { this.bump(e.p, 'spin3'); o.sameTurns = 0; } } else o.sameTurns = 0;
        o.lastNode = p.node;
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
        if (isP(e.p)) { this.own[e.p].traffic = g.players[e.p].traffic & 3; this.passed(e.p, e.to); if (e.left === 0) this.stopped(e.p, e.to); }
        break;
      case 'pay': this.pay(e); break;
      case 'points': if (isP(e.p) && e.amount < 0) { const ev = g.node(g.players[e.p].node).event; if (ev === 4 || ev === 5) this.bump(e.p, 'bail'); } break;
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
        if (id < 1000) { if (eventTone('fate', id) === 'good') { o.goodFates++; if (o.goodFates >= 3) { this.bump(p, 'goodFate3'); o.goodFates = 0; } } else o.goodFates = 0; }
        break;
      } break;
      case 'news': {
        const id = num('id');
        if (p >= 0) { this.bump(p, `drew-news:${id}`); this.own[p].newsSeen.add(id); }
        this.newsToday.add(id);
        if (id === 24) this.crashDay = g.daysElapsed;
        // 鬧鬼 (news 14) on a lot or plot: its owner was haunted (鬼陰山).
        if (id === 14 && e.node !== undefined) { const o = this.ownerOfRef(g.node(e.node).ref); if (o >= 0) this.bump(o, 'haunted'); }
        break;
      }
      case 'god-attach': if (p >= 0) {
        const t = num('type'), o = this.own[p];
        // 財上加財 / 喜上加喜 (G80 / G81): the big god coming while its small one was still on (the small one leaves
        // just before, or quietly while the player was off the road).
        const before = o.justLeft || o.god;
        if (before === 1 && t === 2) this.bump(p, 'wealthOnWealth');
        if (before === 3 && t === 4) this.bump(p, 'joyOnJoy');
        o.justLeft = 0;
        this.endStay(p);
        if (t === 9 || t === 10 || t === 12) o.stay = { type: t, day: g.daysElapsed, mine: 0, others: 0, seized: 0, tools: this.toolsUsed(p) };
        if (BAD_GODS.has(o.god) && GOOD_GODS.has(t) || (BAD_GODS.has(o.god) && t === 12)) this.bump(p, 'turnLuck');
        if (o.godsToday.size && !o.godsToday.has(t)) this.bump(p, 'twoGodsDay');
        o.godsToday.add(t);
        if (t === 2 || t === 4) this.bump(p, 'bigGood');
        o.god = t; o.gods.add(t);
        if (ALL_GODS.every(x => o.gods.has(x))) { o.godRounds++; o.gods.clear(); }
        if (this.n(g.players[p], 'pray') > this.n(g.players[p], 'prayGot') && GOOD_GODS.has(t)) this.bump(p, 'prayGot');
        break;
      } break;
      case 'god-detach': if (p >= 0) { this.endStay(p); this.own[p].justLeft = num('type'); this.own[p].god = 0; this.own[p].t18 = 0; } break;
      case 'card': if (p >= 0) {
        const id = num('card');
        this.bump(p, `card:${id}`);
        if (id === 22 && BAD_GODS.has(this.own[p].god)) this.bump(p, 'sendBadGod');
        if (id === 23) this.bump(p, 'pray');
        if (id === 1) this.own[p].cashBefore = g.players[p].cash;
        if (id === 24) this.own[p].redDay = g.daysElapsed;
        break;
      } break;
      case 'sleepwalk': if (tgt >= 0 && tgt !== p) this.bump(tgt, 'got:sleepwalk'); break;
      case 'turtle': if (tgt >= 0 && tgt !== p) this.bump(tgt, 'got:turtle'); break;
      case 'turn-around': if (tgt >= 0 && tgt !== p) this.bump(tgt, 'got:turn'); break;
      case 'hibernate': { const who = Array.isArray(d.who) ? (d.who as number[]) : []; for (const q of who) if (isP(q) && q !== p) this.bump(q, 'got:hibernate'); if (p >= 0 && who.length >= g.living().length - 1) this.bump(p, 'hibernateAll'); break; }
      case 'card-result': if (num('card') === 26 && tgt >= 0) this.bump(tgt, 'taxed'); break;
      case 'card-taken': if (p >= 0 && tgt >= 0) { this.bump(p, 'grab'); this.bump(p, `grabFrom:${tgt}`); } break;
      case 'magic': if (p >= 0) { this.own[p].magic.add(num('magic')); this.bump(p, 'magic'); } break;
      case 'lottery-draw': { const w = num('winner'); if (d.winner !== undefined && isP(w)) this.bump(w, 'lotto'); break; }
      case 'mini-game': if (p >= 0) { this.bestOf(g.players[p], 'G64', num('points')); this.bump(p, 'mini'); this.bump(p, `mini:${String(d.game)}`); } break;
      case 'chest': if (p >= 0) this.bump(p, 'chest'); break;
      case 'gift': if (p >= 0) this.bump(p, 'gift'); break;
      case 'dog': if (p >= 0) this.bump(p, 'dog'); break;
      case 'earth-god': if (p >= 0) { this.bump(p, 'earthGod'); if (this.own[p].stay?.type === 12) this.own[p].stay!.seized++; const was = this.owners.get(num('ref')); if (was !== undefined && was >= 0 && was !== p) this.bump(was, 'seized'); } break;
      case 'angel': if (p >= 0 && e.node === undefined && Array.isArray(d.lots)) { const nm = this.placeNameOfRef(num('ref')); if (nm) this.bump(p, `angelOn:${nm}`); }
        if (p >= 0 && e.node !== undefined) {
          const ref = num('ref'), o = this.ownerOfRef(ref), st = this.own[p].stay;
          if (o >= 0 && o !== p) this.bump(p, 'kindAngel');
          if (st?.type === 9) { if (o === p) st.mine++; else if (o >= 0) st.others++; }
        } break;
      case 'devil': if (p >= 0 && e.node !== undefined) {
        const ref = num('ref'), o = this.ownerOfRef(ref), st = this.own[p].stay;
        if (o === p) this.bump(p, 'selfDevil');
        if (st?.type === 10) { if (o === p) st.mine++; else if (o >= 0) st.others++; }
      } break;
      case 'monster': case 'demolish': { const ref = num('ref'), o = this.ownerOfRef(ref); if (o >= 0) { this.bump(o, 'lostBuilding'); this.own[o].lostDay = g.daysElapsed; const nm = this.placeNameOfRef(ref); if (nm) this.bump(o, `lostAt:${nm}`); } break; }
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
        if (this.own[p].traffic === 2) this.bump(p, 'carMine'); // the vehicle as it was before the mine destroyed it
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
        if (cur >= 0 && cur !== p && this.missiles(g.players[cur]) > this.own[cur].lastTurnMissiles) { this.bump(cur, 'missileHit'); this.bump(p, 'missiled'); }
        this.checkAll();
        break;
      } break;
      case 'to-prison': if (p >= 0) { this.own[p].dash = false; if (this.own[p].god === 10) this.bump(p, 'devilJail'); } this.checkAll(); break;
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
      case 'slot-machine': if (p >= 0) { const god = num('god'), a = num('amount'); if (god === 2 && a >= 5000) this.bump(p, 'slotRich'); if (god === 6 && a >= 5000) this.bump(p, 'slotPoor'); if (num('mult') > 1) this.bump(p, `slotSame:${god}`); } break;
      case 'stock-trade': if (p >= 0) { const sl = num('slot'), o = this.own[p]; if (d.buy && this.crashDay === g.daysElapsed) o.crashBuy[sl] = 1; if (!d.buy && o.crashBuy[sl]) { this.bump(p, 'bottomFish'); delete o.crashBuy[sl]; } if (!d.buy && o.redDay === g.daysElapsed) this.bump(p, 'redFlip'); } break;
      case 'remote-dice': if (p >= 0) this.bump(p, `remoteAt:${this.placeName(g.players[p].node)}`); break;
      case 'kb-incident': { const id = String(d.id); if (p >= 0) { this.bump(p, `kbv:${id}`); if (id === 'dash') this.own[p].dash = true; } if (tgt >= 0) this.bump(tgt, `kbo:${id}`); break; }
      case 'kb-protection': if (p >= 0) this.bump(p, 'protection'); break;
      case 'kb-smash': if (p >= 0) this.bump(p, 'smash'); break;
      case 'kb-gang-arrest': if (p >= 0) this.bump(p, 'gangArrest'); break;
      case 'kb-bodyguard': if (p >= 0) this.bump(p, 'bodyguard'); break;
      case 'kb-tout': if (p >= 0 && d.ok) this.bump(p, 'touted'); break;
      case 'kb-busy': if (p >= 0 && !d.sitting) this.bump(p, 'busy'); break;
      case 'kb-taxi-ride': if (p >= 0) this.bump(p, 'taxi'); break;
      case 'kb-tool': if (p >= 0) this.own[p].gotPrizes.add(100 + num('tool')); break;
      case 'card-received': if (p >= 0 && (num('card') === 37 || num('card') === 38)) this.own[p].gotPrizes.add(num('card')); break;
      case 'kb-machine-result': if (p >= 0 && !d.skipped) { const left = num('left'); if (d.kind === 'pachinko') this.bestOf(g.players[p], 'B09', Math.floor(left / 25)); const big = /BIG (\d+)/.exec(String(d.text ?? '')); if (big && Number(big[1]) > 0) this.bump(p, 'big777'); } break;
      case 'jq-study': if (p >= 0 && d.start) this.bump(p, 'study'); break;
      case 'jq-verdict': if (tgt >= 0) this.bump(tgt, 'verdict'); break;
      case 'jq-card': if (p >= 0 && d.good && tgt === p) this.bump(p, 'parkGood'); break;
      case 'lab-order': if (p >= 0) { const f = g.board.facilities[num('facility') - 1]; this.bump(p, 'lab'); if (f) this.bump(p, `lab:${f.name}`); } break;
      case 'auction-end': { const b = num('buyer'); if (isP(b) && d.buyer !== -1) this.bump(b, 'auctionWin'); break; }
      default: break;
    }
  }

  private pay(e: Extract<GameEvent, { t: 'pay' }>) {
    const g = this.g, from = e.from, to = e.to;
    const isP = (x: number) => x >= 0 && x < g.players.length;
    if (isP(from)) this.bestOf(g.players[from], 'G20', e.amount + (e.owed ?? 0));
    if (isP(to) && e.reason === '理賠金') this.bump(to, 'insurance');
    if (isP(from) && isP(to) && from !== to) {
      const at = g.node(g.players[from].node), day = g.daysElapsed;
      if (at.ref > 6000) { const c = g.board.companies[at.ref - 6001]; if (c) this.bump(to, `coPaid:${c.name}:${from}:${day}`); }
      const f = this.facilityAt(g.players[from].node);
      if (f) this.bump(to, `facPaid:${f.name}:${from}:${day}`);
      const land = at.ref > 2000 && at.ref < 4000 ? g.board.lands[at.ref - 2001] : undefined;
      if (land) this.bump(to, `streetPaid:${land.name}:${from}:${day}`);
    }
    if (!(isP(from) && isP(to) && from !== to && TOLL_REASONS.has(e.reason))) return;
    this.bestOf(g.players[to], 'O05', e.amount);
    const payer = g.players[from], at = g.node(payer.node);
    const land = at.ref > 2000 && at.ref < 4000 ? g.board.lands[at.ref - 2001] : undefined;
    const fac = this.facilityAt(payer.node);
    this.bump(to, 'tollIn');
    this.bump(to, `paidBy:${from}:${this.g.daysElapsed}`);
    if (land) { this.bump(to, `tollAt:${land.name}`); if (land.tmpState && (land.tmpState & 0xf) === 0) this.bump(to, `raisedToll:${land.name}`); } // tmpState 0x?0 漲價卡, 0x?1 查封卡
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
    // 媽祖遶境 (T18): the round-island route while a god is attached (reset when it leaves).
    const o = this.own[p], ring = ROUTES.T01;
    if (o.god && this.tasks.some(t => t.id === 'T18')) {
      if (o.t18 === 0 ? name === ring[0] : name === ring[o.t18]) { o.t18++; if (o.t18 === ring.length) { this.bump(p, 'mazu'); o.t18 = 0; } }
    }
    for (const [id, seq] of Object.entries(ROUTES)) {
      if (!this.tasks.some(t => t.id === id)) continue;
      const at = o.route[id] ?? 0, k = seq.length;
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
    if (name) {
      const day = g.daysElapsed;
      (this.stopsToday.get(name) ?? this.stopsToday.set(name, new Set()).get(name)!).add(p);
      o.lastStop[name] = day;
      const recent = Object.values(o.lastStop).filter(d => day - d < 30).length;
      this.bestOf(pl, 'C01', recent);
      if (o.lastStop['紐約'] !== undefined && o.lastStop['洛杉磯'] !== undefined && Math.abs(o.lastStop['紐約'] - o.lastStop['洛杉磯']) < 30 && (name === '紐約' || name === '洛杉磯')) this.bump(p, 'coast2coast');
      const f = this.facilityAt(node);
      if (f && f.name === '荷蘭風車村' && f.type === 0 && f.owner && f.owner - 1 !== p) this.bump(f.owner - 1, 'windmill');
      if (g.living().every(q => !g.offRoad(q) && this.placeName(q.node) === '華山派')) for (const q of g.living()) this.bump(q.id, 'huashan');
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
      if (o.stay && !p.god) this.endStay(p.id);
      o.justLeft = 0;
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
    this.dayExtras();
    this.checkAll();
    const best = this.leader();
    if (best >= 0 && this.winner < 0) this.winner = best;
  }

  /** Tools used so far (the ledger's count). */
  private toolsUsed(p: number): number { return Object.values(this.stats(this.g.players[p])?.toolsUsed ?? {}).reduce((a, b) => a + b, 0); }

  /**
   * The end of an angel's, devil's or earth god's stay (left, replaced, or gone while the player was off the road): a
   * whole stay of 7 days counts — 天使 raising only others' lots (G77), 土地公 taking nothing with no tool used (G78),
   * 惡魔 knocking down only the player's own buildings (G79).
   */
  private endStay(p: number) {
    const st = this.own[p].stay;
    if (!st) return;
    this.own[p].stay = null;
    if (this.g.daysElapsed - st.day < 7) return;
    if (st.type === 9 && st.others > 0 && st.mine === 0) this.bump(p, 'angelForOthers');
    if (st.type === 12 && st.seized === 0 && this.toolsUsed(p) === st.tools) this.bump(p, 'earthGodIdle');
    if (st.type === 10 && st.mine > 0 && st.others === 0) this.bump(p, 'devilAtHome');
  }

  /** The day's state-based counters (called by newDay before the measures are read on the next day). */
  private dayExtras() {
    const g = this.g, b = g.board, day = g.daysElapsed, live = g.living();
    const crash = this.newsToday;
    for (const p of live) {
      const o = this.own[p.id], me = p.id + 1;
      // 浴火重生 (G14): a lot of the player's reached 5, fell to 0, and is at 5 again.
      b.lands.forEach((l, i) => {
        if (l.owner === me && l.level >= 5) { if (o.fallen.has(i)) { this.bump(p.id, 'rebuilt5'); o.fallen.delete(i); } o.lv5Lots.add(i); }
        else if (o.lv5Lots.has(i) && l.level === 0) { o.lv5Lots.delete(i); o.fallen.add(i); }
      });
      // 完美的一個月 (G35): a month without hospital, prison, a bad god or debt.
      if (g.offRoad(p) && (p.hospital || p.prison) || BAD_GODS.has(o.god) || p.cash < 0) o.monthClean = false;
      if (dayOf(g.date) === 1) { if (o.monthClean) this.bump(p.id, 'perfectMonth'); o.monthClean = true; }
      // 劍龍裝甲 / 風獅爺: buildings kept for 30 days.
      const levels = b.lands.filter(l => l.owner === me).reduce((n, l) => n + l.level, 0) + b.facilities.filter(f => f.owner === me).reduce((n, f) => n + f.level, 0);
      if (day - o.lostDay >= 30 && day % 30 === 0) { if (levels >= 20) this.bump(p.id, 'armor20'); if (levels >= 10) this.bump(p.id, 'armor10'); }
      // 押鏢 (W07): 10 cards or more, none lost, for 30 days.
      const cards = p.cards.filter(Boolean).length;
      o.cardDays = cards >= 10 && cards >= (o.n.lastCards ?? 0) ? o.cardDays + 1 : 0;
      o.n.lastCards = cards;
      if (o.cardDays >= 30) { this.bump(p.id, 'escort'); o.cardDays = 0; }
      // News of the day that hit the player's own buildings or spared them.
      if (crash.has(18) && levels >= 10 && o.lostDay !== day) this.bump(p.id, 'quakeProof');
      if (crash.has(4) && b.lands.some(l => l.owner === me && l.name === '地球區') && o.lostDay !== day) this.bump(p.id, 'earthSafe');
      if ((crash.has(15) || crash.has(18)) && this.n(p, 'lostAt:火山區') > (o.n.volcanoSeen ?? 0)) { this.bump(p.id, 'volcano'); o.n.volcanoSeen = this.n(p, 'lostAt:火山區'); }
      if (crash.has(17) && (p.traffic & 3) === 2) this.bump(p.id, 'jam');
      if (crash.has(8) && this.streetLevel(p, '華盛頓') > 0 && (this.stats(p)?.events['news:8']?.[0] ?? 0) > (o.n.praised ?? 0)) this.bump(p.id, 'whiteHouse');
      if (crash.has(8) && this.streetLevel(p, '獅子座區') > 0 && (this.stats(p)?.events['news:8']?.[0] ?? 0) > (o.n.praised ?? 0)) this.bump(p.id, 'lionKing');
      o.n.praised = this.stats(p)?.events['news:8']?.[0] ?? 0;
      // 大滅絕 (D18): every opponent in hospital or prison at once.
      const others = live.filter(q => q.id !== p.id);
      if (others.length && others.every(q => q.hospital || q.prison) && !(p.hospital || p.prison)) this.bump(p.id, 'extinct');
      // 春運 (C13): in hospital or prison on 春節 (lunar new year 2026–2032).
      if (LUNAR_NEW_YEAR.has(g.date) && (p.hospital || p.prison)) this.bump(p.id, 'springFest');
      // Dated stops in a place (1 月 1 日…): counted in the measures (DATE).
      // Ownership snapshot for 地被搶了 (G47).
    }
    b.lands.forEach(l => this.owners.set(l.id + 2000, l.owner - 1));
    b.facilities.forEach(f => this.owners.set(f.id + 4000, f.owner - 1));
    // Same-day counts (yesterday's, as newDay runs at the start of a day): 澀谷 visitors.
    // 三越特賣 (J16): the chairman of 三越百貨 saw every rival stop there today.
    const mitsu = this.stopsToday.get('三越百貨');
    for (const p of live) if (mitsu && (this.own[p.id].chair['三越百貨'] ?? 0) > 0 && live.every(q => q.id === p.id || mitsu.has(q.id))) this.bump(p.id, 'mitsukoshiDay');
    const shibuya = this.stopsToday.get('澀谷')?.size ?? 0;
    for (const q of this.stopsToday.get('澀谷') ?? []) this.bestOf(g.players[q], 'K05', shibuya);
    this.stopsToday.clear();
    this.newsToday.clear();
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

  placeNameOfRef(ref: number): string {
    const b = this.g.board;
    if (ref > 2000 && ref < 4000) return b.lands[ref - 2001]?.name ?? '';
    if (ref > 4000 && ref < 6000) return b.facilities[ref - 4001]?.name ?? '';
    return '';
  }

  /** Opponents (other living players) who paid `to` today under `key` (a `${kind}:${name}` prefix). */
  paidToday(to: Player, prefix: string): number {
    const day = this.g.daysElapsed - 1;
    return this.g.living().filter(q => q.id !== to.id && this.n(to, `${prefix}:${q.id}:${day}`) > 0).length;
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
    if (n.ref > 6000 && n.ref < 8000) return this.g.board.companies[n.ref - 6001]?.name ?? '';
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
const BEST_OF = new Set(['G17', 'G18', 'G19', 'G20', 'G53', 'G58', 'G64', 'O05', 'C01', 'K05', 'B09']);

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
  G14: (c, p) => c.n(p, 'rebuilt5'),
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
  G31: (c, p) => c.n(p, 'taxed'),
  G32: (c, p) => c.n(p, 'bottomFish'),
  G33: (c, p) => chairs(c, p),
  G35: (c, p) => c.n(p, 'perfectMonth'),
  G34: (c, p) => [18, 20, 21, 19, 15].filter(id => newsHit(c, p, id) > 0).length,
  G36: (c, p) => c.n(p, 'auctionWin'),
  G37: (c, p) => (c.own[p.id].debtMax >= 1_000_000 ? 1 : 0),
  G38: (c, p) => c.g.board.lands.filter(l => l.owner === p.id + 1).length + c.g.board.facilities.filter(f => f.owner === p.id + 1).length,
  G39: (c, p) => lv5(c, p),
  G40: (c, p) => c.n(p, 'kindAngel'),
  G41: (c, p) => c.n(p, 'selfDevil'),
  G42: (c, p) => c.n(p, 'slotRich'),
  G43: (c, p) => c.n(p, 'slotPoor'),
  G44: (c, p) => c.n(p, 'sendBadGod'),
  G45: (c, p) => c.n(p, 'prayGot'),
  G46: (c, p) => c.n(p, 'twoGodsDay'),
  G47: (c, p) => c.n(p, 'seized'),
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
  G61: (c, p) => c.n(p, 'bail'),
  G62: (c, p) => tool(c, p, 11),
  G63: (c, p) => c.n(p, 'stay4'),
  G65: (c, p) => c.own[p.id].poor,
  G66: (c, p) => c.n(p, 'insurance'),
  G67: (c, p) => fate(c, p, 6),
  G68: (c, p) => used(c, p, 29),
  G69: (c, p) => (c.own[p.id].fateRun >= 3 ? 1 : 0),
  G70: (c, p) => c.n(p, 'spin3'),
  G71: (c, p) => c.n(p, 'allSame'),
  G72: (c, p) => c.n(p, 'selfHarm'),
  // 豹子號 (G73–G76): the god's slot machine with every reel the same (slotBonus: the 大 gods' four, the 小 gods' three).
  G73: (c, p) => c.n(p, 'slotSame:2'),
  G74: (c, p) => c.n(p, 'slotSame:1'),
  G75: (c, p) => c.n(p, 'slotSame:6'),
  G76: (c, p) => c.n(p, 'slotSame:5'),
  G77: (c, p) => c.n(p, 'angelForOthers'),
  G78: (c, p) => c.n(p, 'earthGodIdle'),
  G79: (c, p) => c.n(p, 'devilAtHome'),
  G80: (c, p) => c.n(p, 'wealthOnWealth'),
  G81: (c, p) => c.n(p, 'joyOnJoy'),
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
  R01: N('study'), R02: N('verdict'), R03: N('parkGood'),
  R08: (c, p) => Object.values(c.stats(p)?.toolsBought ?? {}).reduce((a, b) => a + b, 0), R10: (c, p) => Math.min(c.n(p, 'mini:6'), c.n(p, 'mini:7'), c.n(p, 'mini:8')),
  R20: (c, p) => Object.values(c.stats(p)?.cardsBought ?? {}).reduce((a, b) => a + b, 0),
  // the rest of the maps' tasks
  C09: (c, p) => c.paidToday(p, 'facPaid:武漢'), C13: N('springFest'), C20: DATE(1, 1, ['北京']),
  D04: N('volcano'), D08: N('armor20'), D10: N('missiled'), D18: N('extinct'),
  J11: N('angelOn:倉敷'), J14: N('quakeProof'), J16: N('mitsukoshiDay'),
  J18: (c, p) => (c.own[p.id].clean >= 30 ? 1 : 0), N10: N('armor10'), O11: (c, p) => (c.paidToday(p, 'streetPaid:心齋橋筋') >= c.g.living().length - 1 ? 1 : 0),
  Q15: N('windmill'), S04: (c, p) => { const fs = c.g.board.facilities.filter(f => f.owner === p.id + 1 && f.level > 0); const have = [0, 1, 2, 3, 4].map(t => fs.filter(f => f.type === t)); if (have.some(x => !x.length)) return 0; const top = (t: number, f: { level: number }) => f.level >= (t === 0 || t === 3 ? 1 : 5); const mid = (t: number, f: { level: number }) => f.level >= (t === 0 || t === 3 ? 1 : 3); return have.every((x, t) => x.some(f => top(t, f))) ? 3 : have.every((x, t) => x.some(f => mid(t, f))) ? 2 : 1; },
  S10: (c, p) => { const f = c.g.board.facilities.find(x => x.name === '千禧城'); if (f && f.owner === p.id + 1 && monthOf(c.g.date) === 1 && dayOf(c.g.date) === 1) c.bump(p.id, 'millennium'); return c.n(p, 'millennium'); },
  S12: (c, p) => { const fs = c.g.board.facilities.filter(x => x.name === '星月城' || x.name === '流星城'); return fs.length >= 2 && fs.every(f => f.owner === p.id + 1 && f.type === 1) && (c.n(p, 'guest4:星月城') + c.n(p, 'guest4:流星城')) > 0 ? 1 : 0; },
  S19: N('jam'), T18: N('mazu'), U01: N('coast2coast'), U10: N('redFlip'), U14: N('whiteHouse'),
  W04: N('huashan'), W05: N('devilJail'), W07: N('escort'), W13: N('haunted'), Z04: N('earthSafe'), Z10: N('remoteAt:射手座區'),
  Z11: (c, p) => (c.own[p.id].clean >= 30 ? 1 : 0), Z13: N('lionKing'), Z15: N('goodFate3'),
  // 歌舞伎町
  B01: N('dashAway'), B02: N('kbv:tower'), B03: N('kbv:love'), B04: N('touted'), B05: N('protection'), B06: N('smash'), B07: N('gangArrest'), B08: N('bodyguard'),
  B10: N('big777'), B11: (c, p) => ([117, 118, 37, 38].every(x => c.own[p.id].gotPrizes.has(x)) ? 1 : 0), B12: (c, p) => used(c, p, 38), B13: (c, p) => c.n(p, 'kbv:drunk') + c.n(p, 'kbv:cdrunk'),
  B14: N('taxi'), B15: N('busy'), B16: N('kbo:tv'), B19: N('tollAt:黃金街'), B20: N('luckyStop:花園'),
  B17: (c, p) => { const fs = c.g.board.facilities.filter(f => f.owner === p.id + 1 && f.level > 0); const types = [10, 11, 12, 13, 4]; if (!types.every(t => fs.some(f => f.type === t))) return 0; return types.every(t => fs.some(f => f.type === t && f.level >= 5)) ? 3 : types.every(t => fs.some(f => f.type === t && f.level >= 3)) ? 2 : 1; },
};

function mapMeasure(id: string): Measure | undefined { return MAP_MEASURES[id]; }

