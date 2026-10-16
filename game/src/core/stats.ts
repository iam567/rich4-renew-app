/**
 * The whole-game statistics ledger (docs/rules/20-statistics.md): per player, what happened over a game of the classic
 * mode, 大富豪模式 and its 大富翁城 finale, for the results screen and the finale's chips.
 *
 * It only watches. It reads the events the engine yields and a few explicit `stats?.x()` calls at moments that have no
 * event (shop purchases, tool use, stock trades, mini games, the new day); it never draws a random number and never
 * changes the rules state, so a game plays bit for bit the same with or without it. It is opt-in: a game has a ledger
 * only when the screen attaches one (`attachLedger`), and a save stores it only then (old saves load without one; the
 * screen then starts an empty ledger).
 *
 * Read API (stable names, used by the results screen and the finale's chips):
 *   ledger.of(p)                    the raw counters of player p (PlayerStats, below)
 *   ledger.finish(game | world)     stamps the final money / assets / unrealized stock profit (call once at the end)
 *   chipInputs(ledger, p)           the figures the chip formula reads, by name (ChipInputs)
 *   gameResults(g, winner) / worldResults(w, winner)   the ranked results of a finished game
 */
import type { Board } from './board';
import type { Flow } from './flow';
import type { Game } from './game';
import { REGIONAL_EVENTS, REGIONAL_ID_BASE } from './modules/regional-data';
import type { Answer, GameEvent, Player, Step } from './types';
import type { World } from './world';

export type Tone = 'good' | 'bad' | 'neutral';

/** Counters of one player. Money is in 元; maps of id → count use the card / tool / god / facility type ids. */
export interface PlayerStats {
  /** Regular lots bought (buy squares, auctions, the black market, 購地卡) and what they cost. */
  landsBought: number; landSpent: number;
  /** Large plots (大型用地) bought and what they cost. */
  plotsBought: number; plotSpent: number;
  /** Paid building steps (a lot or a facility one level up) and their cost. */
  buildings: number; buildSpent: number;
  /** Building levels added in all (paid steps + free ones: 福神, company perks, robot worker, magic house …). */
  levelsAdded: number;
  /** Large-plot facilities built from an empty plot, by facility type (1 旅館 … 4 研究所, 5..9 大富翁城's halls). */
  facilitiesBuilt: Record<number, number>;
  /** Tolls and fees between players (過路費, 住宿費, 購物費, 加油費, 賭場門票): count and money, paid / received. */
  tollsPaid: number; tollsPaidCount: number; tollsReceived: number; tollsReceivedCount: number;
  /** Shares bought / sold and the money; realized profit = sale money − average cost of the shares sold. */
  sharesBought: number; stockBuyMoney: number; sharesSold: number; stockSellMoney: number; stockProfit: number;
  /** Cards / tools bought (shop, black market) and used, by id. */
  cardsBought: Record<number, number>; cardsUsed: Record<number, number>;
  toolsBought: Record<number, number>; toolsUsed: Record<number, number>;
  /** Points / cash spent in the shop (points) and at the black market (元). */
  shopPoints: number; blackMarketSpent: number;
  /** Lucky / unlucky / neutral events met (news, fate, local news and fate, gods, map objects, NPCs, magic house). */
  lucky: number; unlucky: number; neutral: number;
  /** The same by source key ('fate:20', 'news:8', 'local:tokyo-f3', 'god:1', 'object:mine', 'magic:2' …): [good, bad, neutral]. */
  events: Record<string, [number, number, number]>;
  /** Gods that attached to the player, by type (06 §5.1). */
  gods: Record<number, number>;
  /** Lottery draws won and the prize money. */
  lotteryWins: number; lotteryPrize: number;
  /** Mini games (企鵝挖寶 / 射氣球 / 喜從天降, played or automatic): games, points, games with points. */
  miniGames: number; miniGamePoints: number; miniGameWins: number;
  /** 大富翁城's casinos: games, games won, net money. */
  casinoGames: number; casinoWins: number; casinoNet: number;
  /** Days spent in hospital / prison (counted each new day) and the stays begun. */
  hospitalDays: number; prisonDays: number; hospitalStays: number; prisonStays: number;
  /** Rivals whose bankruptcy came from a payment to this player; the day this player went bankrupt (−1 = never). */
  rivalsBankrupted: number; bankruptDay: number;
  /** 大富豪模式: city indexes visited, trips taken, cities whose 霸主 title the player ever held. */
  cities: number[]; trips: number; overlordCities: number[];
  /** Highest total assets (02 §7.1) seen at a new day or at the end, and the day it was seen. */
  maxAssets: number; maxAssetsDay: number;
  /** Most Lv5 buildings (lots at level 5, facilities at their top level) owned at the same time (sampled daily). */
  maxLv5: number;
  /** Set by `finish`: cash + deposit, loans, total assets, unrealized stock profit at the end. */
  finalCash: number; finalBank: number; finalLoan: number; finalAssets: number; unrealized: number;
}

export interface LedgerData { version: 1; days: number; finished: boolean; players: PlayerStats[] }

const blank = (): PlayerStats => ({
  landsBought: 0, landSpent: 0, plotsBought: 0, plotSpent: 0, buildings: 0, buildSpent: 0, levelsAdded: 0, facilitiesBuilt: {},
  tollsPaid: 0, tollsPaidCount: 0, tollsReceived: 0, tollsReceivedCount: 0,
  sharesBought: 0, stockBuyMoney: 0, sharesSold: 0, stockSellMoney: 0, stockProfit: 0,
  cardsBought: {}, cardsUsed: {}, toolsBought: {}, toolsUsed: {}, shopPoints: 0, blackMarketSpent: 0,
  lucky: 0, unlucky: 0, neutral: 0, events: {}, gods: {},
  lotteryWins: 0, lotteryPrize: 0, miniGames: 0, miniGamePoints: 0, miniGameWins: 0, casinoGames: 0, casinoWins: 0, casinoNet: 0,
  hospitalDays: 0, prisonDays: 0, hospitalStays: 0, prisonStays: 0, rivalsBankrupted: 0, bankruptDay: -1,
  cities: [], trips: 0, overlordCities: [], maxAssets: 0, maxAssetsDay: 0, maxLv5: 0,
  finalCash: 0, finalBank: 0, finalLoan: 0, finalAssets: 0, unrealized: 0,
});

// ---------------------------------------------------------------- classification (docs/rules/20 §3)

const G = 'good', B = 'bad', N = 'neutral';
/** Fate 0..36 for the player who drew it (06 §3.1). */
export const FATE_TONE: Tone[] = [
  B, B, B, B, G, G, B, B, B, B, B, B, B, B, B, B, B, B, B, B, // 0-19
  G, G, G, B, B, G, B, G, G, G, B, G, B, B, B, B, B, //          20-36
];
/** News 0..35 for the players it names (06 §4.3); market-wide news names nobody and counts for nobody. */
export const NEWS_TONE: Tone[] = [
  G, B, G, B, B, B, G, N, G, G, G, B, B, B, B, B, B, B, // 0-17
  B, B, B, B, B, G, B, G, N, N, N, B, B, G, B, B, B, G, // 18-35
];
/** Gods by type (06 §5.1): 財神 / 福神 / 天使 / 土地公 good, 窮神 / 衰神 / 惡魔 / 死神 bad. */
export const GOD_TONE: Record<number, Tone> = { 1: G, 2: G, 3: G, 4: G, 5: B, 6: B, 7: B, 8: B, 9: G, 10: B, 12: G, 15: B, 16: B };
/** Magic house 0..11 for its targets (06 §6.2). */
export const MAGIC_TONE: Tone[] = [N, N, B, B, N, G, G, N, N, B, B, N];
/** Map objects and NPCs, for the player concerned. */
export const OBJECT_TONE: Record<string, Tone> = {
  gift: G, chest: G, 'earth-god': G, blessing: G, mine: B, dog: B, 'bomb-explode': B, 'npc-steal': B, 'npc-rob-card': B,
};
/** Fees between players that count as tolls. */
export const TOLL_REASONS = new Set(['過路費', '住宿費', '購物費', '加油費', '賭場門票']);

/** The tone of a news / fate entry (original ids, or a local one ≥ REGIONAL_ID_BASE with its own tone). */
export function eventTone(src: 'news' | 'fate', id: number): Tone {
  if (id >= REGIONAL_ID_BASE) return REGIONAL_EVENTS[id - REGIONAL_ID_BASE]?.tone ?? N;
  return (src === 'news' ? NEWS_TONE[id] : FATE_TONE[id]) ?? N;
}

const bump = (m: Record<number, number>, k: number, n = 1) => { m[k] = (m[k] ?? 0) + n; };

/** The ledger shared by every engine of one game (the cities of a world share it), keyed by the players array. */
const LEDGERS = new WeakMap<Player[], Ledger>();
export const ledgerOf = (players: Player[]): Ledger | undefined => LEDGERS.get(players);
export function attachLedger(players: Player[], ledger: Ledger = new Ledger(players.length)): Ledger {
  LEDGERS.set(players, ledger);
  return ledger;
}

/** Passes a flow through unchanged, showing every event (not the questions) to `see`. */
export function* observed<T>(flow: Generator<Step, T, Answer>, see: (s: GameEvent) => void): Flow<T> {
  let a: Answer;
  for (;;) {
    const r = flow.next(a);
    if (r.done) return r.value;
    if (!('ask' in r.value)) see(r.value);
    a = yield r.value;
  }
}

export class Ledger {
  players: PlayerStats[];
  /** Days counted (new days seen). */
  days = 0;
  finished = false;
  /** Transient (not saved): the last payment between players and the last auctioned property. */
  private lastPay: { from: number; to: number } | null = null;
  private auctionRef = 0;

  constructor(n: number) { this.players = Array.from({ length: n }, blank); }

  of(p: number): PlayerStats {
    while (this.players.length <= p) this.players.push(blank());
    return this.players[p];
  }

  save(): LedgerData { return JSON.parse(JSON.stringify({ version: 1, days: this.days, finished: this.finished, players: this.players })); }

  static load(d: LedgerData | undefined, n: number): Ledger {
    const l = new Ledger(n);
    if (!d || d.version !== 1) return l;
    l.days = d.days ?? 0;
    l.finished = !!d.finished;
    d.players.forEach((s, i) => { l.players[i] = { ...blank(), ...s }; });
    return l;
  }

  private tone(p: number, key: string, t: Tone) {
    if (p < 0) return;
    const s = this.of(p), e = (s.events[key] ??= [0, 0, 0]);
    if (t === G) { s.lucky++; e[0]++; } else if (t === B) { s.unlucky++; e[1]++; } else { s.neutral++; e[2]++; }
  }

  // ---------------------------------------------------------------- events

  /** One event of engine `g` (the city it happened in). */
  observe(s: GameEvent, g: Game): void {
    const isP = (x: number | undefined): x is number => x !== undefined && x >= 0 && x < g.players.length;
    switch (s.t) {
      case 'buy':
        if (s.kind === 'land') { const x = this.of(s.p); x.landsBought++; x.landSpent += s.price; }
        else { const x = this.of(s.p); x.plotsBought++; x.plotSpent += s.price; }
        break;
      case 'build': {
        const x = this.of(s.p);
        x.levelsAdded++;
        if (s.cost > 0) { x.buildings++; x.buildSpent += s.cost; }
        if (s.kind === 'facility' && s.level === 1) bump(x.facilitiesBuilt, g.board.facilities[s.id - 1]?.type ?? 0);
        break;
      }
      case 'pay':
        if (isP(s.from) && isP(s.to) && s.from !== s.to) {
          this.lastPay = { from: s.from, to: s.to };
          if (TOLL_REASONS.has(s.reason)) {
            const a = this.of(s.from), b = this.of(s.to);
            a.tollsPaid += s.amount; a.tollsPaidCount++;
            b.tollsReceived += s.amount; b.tollsReceivedCount++;
          }
          if (s.reason === '購地卡') { const x = this.of(s.from); x.landsBought++; x.landSpent += s.amount; }
        } else if (isP(s.from)) this.lastPay = null;
        break;
      case 'bankrupt': {
        this.of(s.p).bankruptDay = g.daysElapsed;
        const by = this.lastPay && this.lastPay.from === s.p ? this.lastPay.to : -1;
        if (by >= 0) this.of(by).rivalsBankrupted++;
        this.lastPay = null;
        break;
      }
      case 'fx': this.fx(s, g, isP); break;
      default: break;
    }
  }

  private fx(s: Extract<GameEvent, { t: 'fx' }>, g: Game, isP: (x: number | undefined) => x is number) {
    const d = (s.data ?? {}) as Record<string, unknown>, num = (k: string) => Number(d[k] ?? 0);
    const p = isP(s.p) ? s.p : -1;
    switch (s.kind) {
      case 'card': if (p >= 0) bump(this.of(p).cardsUsed, num('card')); break;
      case 'card-failed': if (p >= 0) bump(this.of(p).cardsUsed, num('card'), -1); break;
      case 'black-market-buy': {
        if (p < 0) break;
        const x = this.of(p), id = num('id');
        x.blackMarketSpent += num('price');
        if (d.kind === 'card') bump(x.cardsBought, id);
        else if (d.kind === 'tool') bump(x.toolsBought, id);
        else { x.landsBought++; x.landSpent += num('price'); }
        break;
      }
      case 'auction': this.auctionRef = num('ref'); break;
      case 'auction-end': {
        const buyer = num('buyer');
        if (d.buyer === undefined || !isP(buyer)) break;
        const x = this.of(buyer);
        if (this.auctionRef > 4000) { x.plotsBought++; x.plotSpent += num('price'); } else { x.landsBought++; x.landSpent += num('price'); }
        break;
      }
      case 'free-upgrade': case 'blessing': case 'robot-worker':
        if (p >= 0 && num('level') >= 0 && d.level !== undefined) this.of(p).levelsAdded++;
        if (s.kind === 'blessing' && p >= 0) this.tone(p, 'object:blessing', G);
        break;
      case 'event-result': this.eventResult(d, p, isP); break;
      case 'god-attach': {
        if (p < 0) break;
        const type = num('type');
        bump(this.of(p).gods, type);
        this.tone(p, `god:${type}`, GOD_TONE[type] ?? N);
        break;
      }
      case 'magic': {
        const e = num('magic'), targets = Array.isArray(d.targets) ? (d.targets as number[]) : [];
        for (const q of targets) if (isP(q)) this.tone(q, `magic:${e}`, MAGIC_TONE[e] ?? N);
        break;
      }
      case 'lottery-draw': {
        const w = num('winner');
        if (d.winner !== undefined && isP(w)) { const x = this.of(w); x.lotteryWins++; x.lotteryPrize += num('prize'); this.tone(w, 'lottery', G); }
        break;
      }
      case 'casino-result': {
        if (p < 0) break;
        const x = this.of(p), net = num('net');
        x.casinoGames++; x.casinoNet += net;
        if (net > 0) x.casinoWins++;
        break;
      }
      case 'to-hospital': if (p >= 0 && d.fresh) this.of(p).hospitalStays++; break;
      case 'to-prison': if (p >= 0 && d.fresh) this.of(p).prisonStays++; break;
      case 'travel-arrive': {
        if (p < 0) break;
        const x = this.of(p);
        x.trips++;
        const city = g.world?.index;
        if (city !== undefined && !x.cities.includes(city)) x.cities.push(city);
        break;
      }
      default:
        if (OBJECT_TONE[s.kind] && p >= 0) this.tone(p, `object:${s.kind}`, OBJECT_TONE[s.kind]);
        break;
    }
  }

  /**
   * A news / fate result (events.ts / regional-events.ts `event-result`): each player named in its lines counts once,
   * by the sign of their money line, else by the entry's tone; escaping by a god's luck ('blessed') is lucky.
   */
  private eventResult(d: Record<string, unknown>, p: number, isP: (x: number | undefined) => x is number) {
    const src = d.src === 'news' ? 'news' : 'fate', id = Number(d.id ?? 0);
    const key = id >= REGIONAL_ID_BASE ? `local:${String(d.local ?? id)}` : `${src}:${id}`;
    const base = eventTone(src, id);
    const lines = Array.isArray(d.lines) ? (d.lines as { p?: number; amount?: number }[]) : [];
    const seen = new Map<number, Tone>();
    for (const l of lines) {
      if (!isP(l.p)) continue;
      const t: Tone = d.fx === 'blessed' ? G : typeof l.amount === 'number' && l.amount !== 0 ? (l.amount > 0 ? G : B) : base;
      if (!seen.has(l.p) || t !== N) seen.set(l.p, t);
    }
    if (!seen.size) {
      const focus = Array.isArray(d.focus) ? (d.focus as number[]).filter(isP) : src === 'fate' && p >= 0 ? [p] : [];
      for (const q of focus) seen.set(q, d.fx === 'blessed' ? G : base);
    }
    for (const [q, t] of seen) this.tone(q, key, t);
  }

  // ---------------------------------------------------------------- explicit calls from the engine

  cardBought(p: number, id: number, points: number) { const x = this.of(p); bump(x.cardsBought, id); x.shopPoints += points; }
  toolBought(p: number, id: number, points: number) { const x = this.of(p); bump(x.toolsBought, id); x.shopPoints += points; }
  toolUsed(p: number, id: number) { bump(this.of(p).toolsUsed, id); }
  stockBought(p: number, n: number, cost: number) { const x = this.of(p); x.sharesBought += n; x.stockBuyMoney += cost; }
  /** `money` what the player got (0 when it went to the lottery pool), `basis` the average cost of the shares. */
  stockSold(p: number, n: number, money: number, basis: number) {
    const x = this.of(p);
    x.sharesSold += n; x.stockSellMoney += money; x.stockProfit += money - basis;
  }
  miniGame(p: number, points: number) {
    const x = this.of(p);
    x.miniGames++; x.miniGamePoints += points;
    if (points > 0) x.miniGameWins++;
  }
  overlord(p: number, city: number) { const x = this.of(p); if (!x.overlordCities.includes(city)) x.overlordCities.push(city); }

  /** A new day: days in hospital / prison, the city each is in, the most assets and Lv5 buildings. */
  newDay(players: Player[], wealth: (p: Player) => number, boards: Board[], day: number) {
    this.days = day;
    for (const p of players) {
      if (p.bankrupt || !p.whoPlays) continue;
      const x = this.of(p.id);
      if (p.hospital) x.hospitalDays++;
      if (p.prison) x.prisonDays++;
      if (p.map !== undefined && p.map >= 0 && !p.trip && !x.cities.includes(p.map)) x.cities.push(p.map);
      this.sample(p, wealth(p), boards, day);
    }
  }

  private sample(p: Player, assets: number, boards: Board[], day: number) {
    const x = this.of(p.id), me = p.id + 1;
    if (assets > x.maxAssets) { x.maxAssets = assets; x.maxAssetsDay = day; }
    let lv5 = 0;
    for (const b of boards) {
      for (const l of b.lands) if (l.owner === me && l.level >= 5) lv5++;
      for (const f of b.facilities) if (f.owner === me && f.level >= 5) lv5++;
    }
    if (lv5 > x.maxLv5) x.maxLv5 = lv5;
  }

  /** The end of the game: final money, assets and unrealized stock profit of everyone (classic Game or World). */
  finish(src: Game | World): void {
    const markets = 'cities' in src ? src.cities.map(c => c.stocks) : [src.stocks];
    const boards = 'cities' in src ? src.cities.map(c => c.board) : [src.board];
    for (const p of src.players) {
      const x = this.of(p.id);
      x.finalCash = p.cash; x.finalBank = p.bank; x.finalLoan = p.loan;
      x.finalAssets = p.bankrupt ? 0 : src.wealth(p);
      let u = 0;
      for (const m of markets) {
        const h = m.holdings[p.id];
        if (h) h.forEach((k, i) => { if (k.shares) u += Math.trunc(k.shares * m.stocks[i].price) - Math.trunc(k.shares * k.avgCost); });
      }
      x.unrealized = u;
      if (!p.bankrupt) this.sample(p, x.finalAssets, boards, src.daysElapsed);
      if ('cities' in src && p.map !== undefined && p.map >= 0 && !x.cities.includes(p.map)) x.cities.push(p.map);
    }
    this.days = src.daysElapsed;
    this.finished = true;
  }
}

// ---------------------------------------------------------------- read API for the chips (大富翁城 finale)

/** The figures the chip formula reads, by name. Call `ledger.finish(...)` first for the final figures. */
export interface ChipInputs {
  finalMoney: number; landsBought: number; levelsAdded: number; facilitiesBuilt: number; stockProfit: number;
  tollIncome: number; cardsUsed: number; toolsUsed: number; luckyEvents: number; unluckyEvents: number;
  citiesVisited: number[]; rivalsBankrupted: number; overlordCities: number[]; maxLv5: number; prisonDays: number;
}

export const sum = (m: Record<number, number>) => Object.values(m).reduce((a, b) => a + Math.max(0, b), 0);

export function chipInputs(ledger: Ledger, p: number): ChipInputs {
  const x = ledger.of(p);
  return {
    finalMoney: x.finalCash + x.finalBank, landsBought: x.landsBought, levelsAdded: x.levelsAdded,
    facilitiesBuilt: sum(x.facilitiesBuilt), stockProfit: x.stockProfit, tollIncome: x.tollsReceived,
    cardsUsed: sum(x.cardsUsed), toolsUsed: sum(x.toolsUsed), luckyEvents: x.lucky, unluckyEvents: x.unlucky,
    citiesVisited: [...x.cities], rivalsBankrupted: x.rivalsBankrupted, overlordCities: [...x.overlordCities],
    maxLv5: x.maxLv5, prisonDays: x.prisonDays,
  };
}

// ---------------------------------------------------------------- results of a finished game (the results screen)

/** One row of the results: who, the place, the end state and the ledger's counters. */
export interface PlayerResult {
  p: number; character: number; human: boolean; rank: number; winner: boolean; bankrupt: boolean;
  /** Total assets at the end (0 when bankrupt), money = cash + deposit − loans. */
  assets: number; money: number;
  /** Owned at the end: lots, building levels on them, large plots. */
  lots: number; houses: number; plots: number;
  /** Day of the bankruptcy (−1 none). */
  fellDay: number;
  /** Titles: 大富豪模式's award titles and 城市霸主 cities, 首富大富豪 for the winner. */
  titles: string[];
  stats: PlayerStats;
}

export interface GameResults {
  mode: 'classic' | 'tycoon' | 'finale';
  /** The map played (classic) or the city shown (大富豪模式). */
  mapId: number;
  winner: number;
  /** Days played and the final date. */
  days: number; date: number;
  /** In ranking order. */
  players: PlayerResult[];
  /** 大富豪模式: the city names by index (for the cities visited). */
  cityNames?: string[];
}

function owned(boards: Board[], p: Player) {
  let lots = 0, houses = 0, plots = 0;
  const me = p.id + 1;
  for (const b of boards) {
    for (const l of b.lands) if (l.owner === me) { lots++; houses += l.chain ? 1 : l.level; }
    for (const f of b.facilities) if (f.owner === me) plots++;
  }
  return { lots, houses, plots };
}

function rows(ledger: Ledger, players: Player[], boards: Board[], winner: number, wealth: (p: Player) => number, fellOrder: (p: Player) => number,
  titles: (p: Player) => string[]): PlayerResult[] {
  const list = players.map(p => {
    const x = ledger.of(p.id);
    return {
      p: p.id, character: p.character, human: p.human, rank: 0, winner: p.id === winner, bankrupt: p.bankrupt,
      assets: p.bankrupt ? 0 : wealth(p), money: p.cash + p.bank - p.loan, ...owned(boards, p), fellDay: x.bankruptDay,
      titles: titles(p), stats: x,
    };
  });
  // The winner, then the players still in by assets, then the fallen, the last to fall first.
  list.sort((a, b) => (a.winner ? -1 : b.winner ? 1 : 0)
    || Number(a.bankrupt) - Number(b.bankrupt)
    || (a.bankrupt ? fellOrder(players[b.p]) - fellOrder(players[a.p]) : b.assets - a.assets)
    || a.p - b.p);
  list.forEach((r, i) => { r.rank = i + 1; });
  return list;
}

/** Results of a classic game (also 大富翁城 played as a classic map). Finishes the ledger if it was not. */
export function gameResults(g: Game, winner: number, ledger: Ledger = g.stats ?? new Ledger(g.players.length)): GameResults {
  if (!ledger.finished) ledger.finish(g);
  const players = rows(ledger, g.players, [g.board], winner, p => g.wealth(p),
    p => ledger.of(p.id).bankruptDay * 16 + p.id, () => []);
  return { mode: g.settings.mapId === 105 ? 'finale' : 'classic', mapId: g.settings.mapId, winner, days: g.daysElapsed, date: g.date, players };
}

/** Results of a 大富豪模式 world (its finale included). */
export function worldResults(w: World, winner: number, ledger: Ledger = w.stats ?? new Ledger(w.players.length)): GameResults {
  if (!ledger.finished) ledger.finish(w);
  const cityNames = w.cities.map((_, i) => w.cityName(i));
  const fell = (p: Player) => { const i = w.fallen.findIndex(f => f.p === p.id); return i < 0 ? 1e9 : i; };
  const titles = (p: Player) => {
    const t = p.id === winner ? ['首富大富豪'] : [];
    if (p.human) for (const f of w.fallen) if (f.title && f.p !== p.id && !t.includes(f.title)) t.push(f.title);
    for (const c of ledger.of(p.id).overlordCities) t.push(`${cityNames[c] ?? ''}霸主`);
    return t;
  };
  const players = rows(ledger, w.players, w.cities.map(c => c.board), winner, p => w.wealth(p), fell, titles);
  for (const r of players) { const f = w.fallen.find(x => x.p === r.p); if (f) r.fellDay = f.day; }
  return { mode: w.finale.active ? 'finale' : 'tycoon', mapId: w.mapId(Math.max(0, w.view())), winner, days: w.daysElapsed, date: w.date, players, cityNames };
}
