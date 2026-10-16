/**
 * 大富翁城, the finale of 大富豪模式 (docs/rules/19, a remake addition): when only four players are left in the world,
 * all of them are taken to a small golden casino city for the final battle. Their holdings in the five cities are
 * valued (the total assets of 02 §7.1 / 17 §5) and paid out as cash; the holdings themselves stay frozen where they
 * are and are recorded for the results. In 大富翁城 the only building is the casino on its eight large plots
 * (core/casino-rules.ts, shared with a normal game on the map).
 *
 * The finale city is the world's sixth city (index 5, map 105, editor/build_finale.py), run by its own rules engine
 * like the others; this object is its link to the world (WorldHooks and the map's rules): travel, the other cities'
 * cards and the stock market do not reach it, the decks and the shop are the original ones without what makes no
 * sense there (§3). Hooks into the world: World.finale (start check, frozen cities, wealth), save.ts (state).
 */
import type { Board } from './board';
import { CasinoRules, CAPS, DENY, emptyStats, FINALE_MAP, FINALE_NAME, type CasinoStats } from './casino-rules';
import { type Flow } from './flow';
import { Game, type WorldHooks } from './game';
import { cardName, cardPrice } from './modules/cards';
import { sellPrice, toolDef } from './modules/tools';
import { chipScore, FINALE_CHIP, type ChipScore } from './chips';
import { attachLedger, ledgerOf } from './stats';
import { CITY_NAMES, type World } from './world';
import type { GameEvent, GameSettings, Option, Player, TravelOption } from './types';

export { HALLS, HALL_GAME, HALL_NAMES, HALL_TYPE, isHall, CAPS, DENY, FINALE_MAP, FINALE_NAME, MIN_STAKE, PLOT_PRICE, BUILD_COST, SLOT_TOP, type CasinoChoice, type CasinoStats } from './casino-rules';

/** The finale starts when this many players (or fewer, at least two) are left. */
export const FINALE_PLAYERS = 4;
/**
 * Scale of the caps in the finale (19 §5.1): 'flat' the user's table as it is (the default); 'index' × the price
 * index (02 §1); 'wealth' × the finalists' average cash on arrival in units of WEALTH_UNIT (fixed for the finale).
 */
export type ScaleMode = 'flat' | 'index' | 'wealth';
export const WEALTH_UNIT = 100000;

/** One player's holdings in one city when the finale started (the results show them). */
export interface CityHolding { map: number; name: string; lots: number; houses: number; facilities: { name: string; type: number; level: number }[]; value: number; stocks: number }
/** The valuation of a finalist (19 §2). */
export interface Valuation {
  p: number; cash: number; bank: number; loan: number; stocks: number; property: number; total: number;
  cities: CityHolding[];
  sold: { kind: 'card' | 'tool'; id: number; name: string; n: number; points: number }[];
  points: number;
}

/** A finalist's chips on arrival (core/chips.ts, the whole game's score). */
export type FinalistChips = ChipScore & { p: number };

export interface FinaleState {
  active: boolean; startDay: number; finalists: number[]; valuations: Valuation[]; chips?: FinalistChips[]; visits: number;
  stats: CasinoStats[]; scaleMode?: ScaleMode; wealthScale?: number;
}

/** The board of 大富翁城 (the screen and the tests load it; the finale cannot start without it). */
let finaleBoard: Board | null = null;
export function setFinaleBoard(b: Board | null): void { finaleBoard = b; }
export function getFinaleBoard(): Board | null { return finaleBoard; }

const fmt = (x: number) => x.toLocaleString('en-US');

/** The 大富翁城 link to the world. */
export class Finale extends CasinoRules implements WorldHooks {
  active = false;
  startDay = 0;
  finalists: number[] = [];
  valuations: Valuation[] = [];
  /** Each finalist's chips on arrival and how they were counted (the entry screen and the results show it). */
  chips: FinalistChips[] = [];
  scaleMode: ScaleMode = 'flat';
  wealthScale = 1;
  /** Turned off by tests that want the world to run without a finale. */
  static enabled = true;

  constructor(readonly w: World) {
    super();
    CITY_NAMES[FINALE_MAP] ??= FINALE_NAME;
  }

  /** The city's index in the world (always the sixth). */
  get index(): number { return this.w.settings.maps.indexOf(FINALE_MAP); }
  game(): Game | undefined { const i = this.index; return i >= 0 ? this.w.cities[i] : undefined; }
  /** Whether a city still plays: during the finale only 大富翁城 (the five are frozen). */
  runs(i: number): boolean { return !this.active || i === this.index; }

  scale(): number { return this.scaleMode === 'index' ? Math.max(1, this.w.priceIndex) : this.scaleMode === 'wealth' ? this.wealthScale : 1; }
  /** The finale's texts in chips (1 chip = 100 元). */
  price(n: number): string { return this.active ? `${fmt(Math.trunc(n / FINALE_CHIP))}籌碼` : `${fmt(n)}元`; }
  moneyWord(): string { return this.active ? '籌碼' : '現金'; }

  protected note(text: string, p: number, important: boolean): void { this.w.ticker(this.index, text, 'casino', p, { important }); }

  /** Total assets in the finale: money and the casinos. */
  wealth(p: Player): number { return p.cash + p.bank - p.loan + this.casinoWorth(p); }

  /** Every day (World.run): the city's closed market and black market. */
  tidy(): void {
    if (!this.active) return;
    const g = this.game();
    this.daily(g);
    if (g) g.priceIndex = 1;   // fixed chip prices (World.updatePriceIndex sets every city's each day)
  }

  /** The bank counter is closed in the finale (chips: no loans); the ATM still takes and gives back chips. */
  get noLoans(): boolean { return this.active; }

  /** A finalist with no chips left is out (19 §2): the original bankruptcy (their halls back to the bank, unowned). */
  private *outOfChips(): Flow {
    const g = this.game();
    if (!g || this.w.over) return;
    for (const id of this.finalists) {
      const p = this.w.players[id];
      // Out below one chip (19 §2): what the screen shows as 0 籌碼.
      if (p.whoPlays && !p.bankrupt && p.cash + p.bank < FINALE_CHIP && p.loan === 0) yield* this.bankrupt(p, g);
      if (this.w.over) return;
    }
  }

  // ---------------------------------------------------------------- start

  /** After every turn and every day (World.run): starts the finale once four players (or fewer) are left. */
  *check(): Flow {
    if (this.active) { yield* this.outOfChips(); return; }
    if (!Finale.enabled || this.w.over || !finaleBoard || this.index >= 0) return;
    const left = this.w.players.filter(p => !p.bankrupt);
    if (left.length > FINALE_PLAYERS || left.length < 2) return;
    yield* this.start(left);
  }

  /** The valuation of one finalist (19 §2): the same sums as the world's total assets, city by city. */
  value(p: Player): Valuation {
    const owner = p.id + 1;
    let stocks = 0, property = 0;
    const cities: CityHolding[] = this.w.cities.map((c, i) => {
      const lands = c.board.lands.filter(l => l.owner === owner), facs = c.board.facilities.filter(f => f.owner === owner);
      const lv = lands.reduce((s, l) => s + l.price + (l.chain ? l.perLevel : l.level * l.perLevel), 0);
      const fv = facs.reduce((s, f) => s + f.price + f.level * f.fees[0], 0);
      const sv = c.stocks.holdingsValue(0, p);
      stocks += sv; property += lv + fv;
      return {
        map: c.settings.mapId, name: this.w.cityName(i), lots: lands.length, houses: lands.reduce((s, l) => s + l.level, 0),
        facilities: facs.map(f => ({ name: f.name, type: f.type, level: f.level })), value: lv + fv, stocks: sv,
      };
    });
    const total = p.cash + p.bank - p.loan + stocks + property;
    return { p: p.id, cash: p.cash, bank: p.bank, loan: p.loan, stocks, property, total, cities, sold: [], points: 0 };
  }

  /**
   * The finale begins (19 §2): the valuation and the cash payout, denied cards and tools sold, gods, bombs and the
   * NPCs sent home, everyone out of hospitals, prisons, hotels and trips, the city built and the finalists set down
   * on four squares of it; the human's screen goes there.
   */
  *start(left: Player[]): Flow {
    const w = this.w;
    this.valuations = left.map(p => this.value(p));
    // The chips (19 §2): the whole game's score from the statistics ledger (the screen attaches it; without one, as in
    // the tests, an empty ledger only counts the final money). Stamped before anything changes.
    const ledger = ledgerOf(w.players) ?? attachLedger(w.players);
    ledger.finish(w);
    const everyone = w.players.map(p => p.id);
    this.chips = left.map(p => ({ p: p.id, ...chipScore(ledger, p.id, everyone) }));
    this.finalists = left.map(p => p.id);
    const avg = this.valuations.reduce((a, v) => a + Math.max(0, v.total), 0) / Math.max(1, left.length);
    this.wealthScale = Math.max(1, Math.round(avg / WEALTH_UNIT));
    this.startDay = w.daysElapsed;
    this.stats = w.players.map(emptyStats);
    for (const [k, p] of left.entries()) {
      const v = this.valuations[k], chips = this.chips[k].total;
      const from = w.cityOf(p) ?? w.cities[Math.max(0, p.map ?? 0)];
      from?.objects.detachAll(p);
      for (const c of w.cities) c.places.returnNpcsOf(p);
      v.sold = this.sellDenied(p, from);
      v.points = v.sold.reduce((s, x) => s + x.points, 0);
      Object.assign(p, {
        // Chips are all they have (1 chip = 100 元, FINALE_CHIP): no money, deposit or loan from before.
        cash: chips * FINALE_CHIP, bank: 0, loan: 0, specialFinance: 0, loanDue: 0,
        hotel: 0, vanish: 0, prison: 0, hospital: 0, sleep: 0, sleepwalk: 0, stay: 0, turtle: 0, facility: 0,
      });
      p.trip = undefined;
    }
    w.syncWanted();
    // The city: a new engine linked to this object (like World's constructor builds the five); a new engine deals
    // starting tools and empties hands, so the players are put back as they are.
    const keep = structuredClone(w.players);
    const s: GameSettings = {
      mapId: FINALE_MAP, players: w.settings.players, fundIndex: w.settings.fundIndex, traffic: w.settings.traffic,
      landLimitIndex: w.settings.landLimitIndex, daysLimitIndex: 0, victoryIndex: 0, startDate: w.date,
      seed: w.citySeed(w.cities.length),
    };
    const g = new Game(s, finaleBoard!, { index: w.cities.length, hooks: this, players: w.players });
    w.players.forEach((p, i) => Object.assign(p, keep[i]));
    w.settings.maps.push(FINALE_MAP);
    w.cities.push(g);
    // Chips have fixed prices (19 §2.3): the city's price index stays 1 (the world's goes on for the frozen cities).
    Object.assign(g, { date: w.date, daysElapsed: w.daysElapsed, monthsElapsed: w.monthsElapsed, priceIndex: 1 });
    // The eight plots: the casino's plot price and level cost (× the price index where it is used, as every price),
    // fees[1..5] its caps (19 §4-§5).
    this.setup(g, true);
    this.active = true;
    // Four squares round the loop for the four (the plain squares, evenly spread), facing the way on.
    const spots = g.board.nodes.filter(n => n.event === 0 && n.ref === 0 && n.adjacent.filter(Boolean).length === 2);
    left.forEach((p, k) => {
      const n = spots[Math.floor((k * spots.length) / left.length)] ?? g.board.nodes[0];
      p.map = this.index; p.node = n.id;
      const ways = n.adjacent.filter(Boolean);
      p.lastNode = ways[0] ?? n.id;
      const from = g.node(p.lastNode);
      p.dir = from ? Game.direction(n.x - from.x, n.y - from.y) : 0;
      w.landed[p.id] = true;
      if (!w.visited[p.id].includes(this.index)) w.visited[p.id].push(this.index);
    });
    w.mask(w.view());
    const names = left.map(p => w.name(p.id)).join('、');
    const text = `最終決戰！${names}前往${FINALE_NAME}`;
    w.ticker(this.index, text, 'finale', undefined, { important: true });
    const lines: GameEvent[] = [{ t: 'ticker', day: w.daysElapsed, map: this.index, text, kind: 'finale', important: true }];
    for (const v of this.valuations) {
      const line = `${w.name(v.p)}帶著 ${fmt(this.chips.find(c => c.p === v.p)?.total ?? 0)} 籌碼進城`;
      w.ticker(this.index, line, 'finale', v.p, { important: true });
      lines.push({ t: 'ticker', day: w.daysElapsed, map: this.index, text: line, p: v.p, kind: 'finale', important: true });
      if (v.sold.length) {
        const sold = `${w.name(v.p)}賣出不能帶進${FINALE_NAME}的${v.sold.map(x => `${x.name}×${x.n}`).join('、')}，得 ${v.points} 點券`;
        w.ticker(this.index, sold, 'finale', v.p);
        lines.push({ t: 'ticker', day: w.daysElapsed, map: this.index, text: sold, p: v.p, kind: 'finale' });
      }
    }
    yield {
      t: 'fx', kind: 'finale-start', p: w.human()?.id,
      data: { city: FINALE_NAME, finalists: this.finalists, valuations: this.valuations, chips: this.chips, chip: FINALE_CHIP, caps: CAPS.map((_, l) => this.cap(l)), text },
    };
    for (const l of lines) yield l;
    yield { t: 'board' };
    yield { t: 'world-sync' };
    if (w.human() && !w.human()!.bankrupt) yield { t: 'world-view', map: this.index };
  }

  /** Sells what does not fit the finale (19 §3): cards and tools at the shop's 90% in points, back to their pool. */
  private sellDenied(p: Player, from: Game | undefined): Valuation['sold'] {
    const out: Valuation['sold'] = [];
    const add = (kind: 'card' | 'tool', id: number, name: string, pts: number) => {
      const x = out.find(o => o.kind === kind && o.id === id);
      if (x) { x.n += 1; x.points += pts; } else out.push({ kind, id, name, n: 1, points: pts });
    };
    for (let i = p.cards.length - 1; i >= 0; i--) {
      const id = p.cards[i];
      if (!DENY.cards.has(id)) continue;
      p.cards.splice(i, 1);
      if (from && from.cards.remaining.length >= id) from.cards.remaining[id - 1] += 1;
      const pts = sellPrice(cardPrice(id));
      p.points = (p.points + pts) & 0xffff;
      add('card', id, cardName(id), pts);
    }
    out.reverse();
    for (const id of DENY.tools.keys()) {
      const n = p.tools[id - 1] ?? 0;
      if (!n) continue;
      p.tools[id - 1] = 0;
      if (id <= 8 && from) from.tools.shopStock[id - 1] += n;
      const pts = sellPrice(toolDef(id)?.price ?? 0, n);
      p.points = (p.points + pts) & 0xffff;
      out.push({ kind: 'tool', id, name: toolDef(id)?.name ?? '', n, points: pts });
    }
    return out;
  }

  // ---------------------------------------------------------------- save

  save(): FinaleState | undefined {
    if (!this.active) return undefined;
    return { active: true, startDay: this.startDay, finalists: [...this.finalists], valuations: structuredClone(this.valuations), chips: structuredClone(this.chips), visits: this.visits, stats: structuredClone(this.stats), scaleMode: this.scaleMode, wealthScale: this.wealthScale };
  }

  restore(s: FinaleState | undefined): void {
    if (!s?.active) return;
    Object.assign(this, { active: true, startDay: s.startDay, finalists: [...s.finalists], valuations: structuredClone(s.valuations), chips: structuredClone(s.chips ?? []), visits: s.visits, stats: structuredClone(s.stats), scaleMode: s.scaleMode ?? 'flat', wealthScale: s.wealthScale ?? 1 });
    const g = this.game();
    if (g) this.setup(g, false);
  }

  // ---------------------------------------------------------------- WorldHooks: the world as 大富翁城 sees it

  *bankrupt(p: Player, g: Game): Flow {
    yield* this.w.bankrupt(p, g);
    // The frozen cities' plots that went back to the bank change no 霸主 title on the ticker.
    this.w.cities.forEach((_, i) => { if (i !== this.index) this.w.overlords[i] = this.w.overlordOf(i); });
  }
  *travelSquare(): Flow<boolean> { return false; }
  *overflow(): Flow<boolean> { return false; }
  bankOperators(): Player[] { return []; }
  cityOf(p: Player): Game | undefined { return this.w.cityOf(p); }
  *humanMarket(p: Player, g: Game): Flow { yield* g.say(p.id, `${FINALE_NAME}沒有股市`); }
  allCities(): Game[] { const g = this.game(); return g ? [g] : []; }
  *travelCard(g: Game, p: Player): Flow<boolean> { yield* g.say(p.id, `${FINALE_NAME}不能離開`); return false; }
  aiCardTrip(): number { return -1; }
  *deport(): Flow<boolean> { return false; }
  dictateVictims(): Player[] { return []; }
  *dictate(): Flow { /* nobody can be sent away */ }
  aiDictate(): boolean { return false; }
  summonable(): Player[] { return []; }
  *summon(): Flow { /* nobody is elsewhere */ }
  aiSummon(): boolean { return false; }
  wantedOptions(p: Player): Option[] { return this.w.wantedOptions(p); }
  *wanted(g: Game, p: Player, q: Player): Flow { yield* this.w.wanted(g, p, q); }
  aiWanted(g: Game, p: Player): number { return this.w.aiWanted(g, p); }
  wantedTaken(g: Game, p: Player): void { this.w.wantedTaken(g, p); }
  wantedUsed(p: Player): void { this.w.wantedUsed(p); }
  syncWanted(): void { this.w.syncWanted(); }
  icbmCities(): Option[] { return [{ label: FINALE_NAME, value: this.index, detail: '只能打大富翁城' }]; }
  icbmTargets(p: Player): Option[] { return this.w.icbmTargets(p, this.index); }
  *icbm(g: Game, p: Player, _city: number, ref: number): Flow { yield* this.w.icbm(g, p, this.index, ref); }
  /** The rivals' casinos hurting it most (as the world's, only this city). */
  aiIcbm(p: Player): number {
    const g = this.game();
    if (!g) return -1;
    const me = p.id + 1, half = 220;
    const all = g.board.facilities.filter(f => f.level > 0);
    let best = -1, top = 5;
    for (const t of all) {
      if (!t.owner || t.owner === me || t.owner === p.ally || t.level < 3) continue;
      let score = 0;
      for (const o of all) if (Math.abs(o.x - t.x) <= half && Math.abs(o.y - t.y) <= half) score += o.owner === me ? -2 * o.level : o.owner !== p.ally ? o.level : 0;
      if (score > top) { top = score; best = this.index * 10000 + t.id + 4000; }
    }
    return best;
  }
  spaceTimeCities(): Option[] { return []; }
  *spaceTime(): Flow { /* no crossing */ }
  aiSpaceTime(): number { return -1; }
  *overlordRelease(): Flow<boolean> { return false; }
  overlordTitles(): string[] { return []; }
  resort(): number { return 1; }
  *aiAim(): Flow<boolean> { return false; }
}

export type { TravelOption }
