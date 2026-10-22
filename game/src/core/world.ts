/**
 * 大富豪模式 (docs/rules/17, a remake mode, not in the original): one human against the other eleven characters in
 * one world of the five Japanese remake cities (東京, 大阪, 札幌, 九州, 沖繩).
 *
 * The world holds one rules engine (`Game`) per city: its own board, objects, gods, NPCs, fork arrows, lottery,
 * black market and its 12 local stocks. The twelve players are shared by all five, each in one city at a time
 * (`Player.map`). The world runs the turn order, the calendar, the price index, the month-end interest and the
 * nationwide market (the five cities' 60 stocks), travel between the cities and the end of the game.
 *
 * Only the city the human is in is shown: everything that happens elsewhere runs headless (the same generators,
 * drained without the screen) and becomes lines of the ticker. The engine never depends on which city is shown,
 * so a game plays the same whether it is watched or not.
 */
import { nodeById, type Board, type BoardNode, type Landscape } from './board';
import { CHARACTERS } from './characters';
import { daysBetween, day as dayOf, nextDay, type PackedDate } from './date';
import { ask, type Flow } from './flow';
import { Finale, FINALE_MAP } from './finale'; // 大富翁城, the finale (docs/rules/19)
import { Game, type WorldHooks } from './game';
import { deckSupply } from './modules/cards';
import { OBJECT_NAMES } from './modules/objects';
import { TYCOON_LABS } from './modules/tools';
import { Rng, daySeed } from './rng';
import { ledgerOf, type Ledger } from './stats';
import { FUNDS, type Answer, type Ask, type GameEvent, type GameSettings, type Option, type Player, type Step, type TravelOption } from './types';

/** 通緝卡's id (cards.ts TYCOON_CARDS). */
const WANTED = 36;

// ------------------------------------------------------------------ the world's data

/** The five cities by map id, in world order (index = `Player.map`). */
export const TYCOON_MAPS = [100, 101, 102, 103, 104] as const;
export const CITY_NAMES: Record<number, string> = { 100: '東京', 101: '大阪', 102: '札幌', 103: '九州', 104: '沖繩' };
/** Cities on the 新幹線 network (17 §3.1): 東京, 大阪, 九州; 札幌 and 沖繩 have only an airport. */
export const STATION_MAPS = [100, 101, 103];

/** Base fares before the price index (17 §3.2); the airport always costs more than the train on the same pair. */
const RAIL_FARE: Record<string, number> = {
  '100-101': 3000, '100-102': 5000, '100-103': 5000, '101-102': 7000, '101-103': 3000, '102-103': 9000,
};
const AIR_FARE: Record<string, number> = {
  '100-101': 5000, '100-102': 6000, '100-103': 6000, '100-104': 8000, '101-102': 8000, '101-103': 5000,
  '101-104': 7000, '102-103': 10000, '102-104': 12000, '103-104': 5000,
};
const pairKey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);
export function fare(fromMap: number, toMap: number, via: 'station' | 'airport'): number {
  return (via === 'station' ? RAIL_FARE : AIR_FARE)[pairKey(fromMap, toMap)] ?? 0;
}

/**
 * 地價指數 (17 §2.3): each city's land prices in the tycoon world, from the 2025/2026 地価公示 (average and highest
 * commercial price per city, log-compressed into ×1.0 .. ×1.5 as the user asked): lot prices, building costs, tolls,
 * large plots and their fees are multiplied. The normal maps keep their prices.
 */
export const LAND_INDEX: Record<number, number> = { 100: 1.5, 101: 1.3, 102: 1.1, 103: 1.2, 104: 1.0 };
/**
 * 度假勝地 (17 §2.4): 沖繩's hotels (旅館 on its large plots) earn ×1.5 a night, ×1.8 in summer (June–September). Only
 * the tycoon world; the AI builds hotels there and values the free large plots of a resort when it travels.
 */
export const RESORT: Record<number, { base: number; summer: number }> = { 104: { base: 1.5, summer: 1.8 } };
export function resortRate(mapId: number, date: PackedDate): number {
  const r = RESORT[mapId];
  if (!r) return 1;
  const m = (date >>> 8) & 0xff;
  return m >= 6 && m <= 9 ? r.summer : r.base;
}
const scaled = (v: number, k: number) => (k === 1 ? v : Math.max(10, Math.round((v * k) / 10) * 10));

/** Places in a hospital or a prison (the eight beds / cells of the original scenes, ui/screens/bail.ts). */
export const PLACES_PER_HOUSE = 8;

/**
 * One travel square of the tycoon overlay (17 §2): node id, what it becomes, and where it is expected (map px) with
 * the event it replaces, so a renumbered map is caught (the nearest event square to x, y is taken then).
 */
export interface TravelSquare { node: number; via: 'station' | 'airport'; x: number; y: number; was?: number }
/**
 * A landmark that only stands in 大富豪模式 (airport terminal, station building). `resource` is the sprite number
 * (map/NNNN, e.g. 1501); the landscape record stores it − 38 as the originals do.
 */
export interface TycoonLandmark { name: string; x: number; y: number; facing?: number; resource: number }
/** The map JSON's optional `tycoon` section (editor/city_tycoon.py). */
export interface TycoonOverlay { travel: TravelSquare[]; landmarks?: TycoonLandmark[] }

/**
 * The squares chosen by the user (17 §2.1). Used when a map JSON has no `tycoon` section yet (the city builders add
 * it from editor/city_tycoon.py, which holds the same table).
 */
export const TYCOON_SQUARES: Record<number, TravelSquare[]> = {
  100: [ // 東京: 車站 on the 銀座/丸之內 leg below 東京站 (news), 機場 at 築地 toward 羽田 (news)
    { node: 6, via: 'station', x: 1200, y: 1312, was: 2 },
    { node: 122, via: 'airport', x: 1488, y: 1600, was: 2 },
  ],
  101: [ // 大阪: 機場 on the north side of the loop (天神橋筋/櫻之宮, toward 伊丹), 車站 on the west line (news)
    { node: 8, via: 'airport', x: 1444, y: 620, was: 2 },
    { node: 72, via: 'station', x: 760, y: 1544, was: 2 },
  ],
  102: [ // 札幌: only the 機場 on the 豐平 east leg (新千歲 side)
    { node: 106, via: 'airport', x: 1994, y: 1732, was: 2 },
  ],
  103: [ // 九州: 車站 on the 新幹線 spine (久留米–熊本), 機場 on the 唐津 side (佐賀)
    { node: 15, via: 'station', x: 1550, y: 1347, was: 13 },
    { node: 194, via: 'airport', x: 549, y: 778, was: 2 },
  ],
  104: [ // 沖繩: 機場 on the 慶良間 speedboat loop (a water square)
    { node: 98, via: 'airport', x: 650, y: 1706, was: 3 },
  ],
};

/**
 * The airport / station buildings beside the travel squares (editor/city_tycoon.py place → city_tycoon_placed.json),
 * for maps whose JSON has no `tycoon` section yet. Sprites 1501 airport, 1502 snowy airport, 1503 新幹線 station.
 */
export const TYCOON_LANDMARKS: Record<number, TycoonLandmark[]> = {
  100: [{ name: '羽田機場', x: 1680, y: 1510, resource: 1501 }],
  101: [{ name: '伊丹機場', x: 1294, y: 410, resource: 1501 }, { name: '新大阪站', x: 560, y: 1724, resource: 1503 }],
  102: [{ name: '新千歲機場', x: 1800, y: 2150, resource: 1502 }],
  103: [{ name: '福岡機場', x: 719, y: 790, resource: 1501 }, { name: '新幹線車站', x: 1680, y: 1147, resource: 1503 }],
  104: [{ name: '那霸機場', x: 400, y: 1690, resource: 1501 }],
};
/** Every sprite the overlay draws (pads and buildings), for the screen to register (maps/remake/sprites/NNNN). */
export const TYCOON_SPRITES = [9017, 9018, 1501, 1502, 1503];

/** Map sprites of the tycoon overlay (icons of the two new squares), registered by the screen. */
export const TRAVEL_ICON = { station: 9017, airport: 9018 } as const;

/**
 * Titles for the human, one per rival gone bankrupt (17 §11, phase 3): the eleventh is the winner's.
 */
export const TITLES = [
  '町內小富翁', '街坊有錢人', '區域地主', '城市新貴', '地方財主', '商界名流',
  '地產大亨', '金融巨鱷', '財閥總裁', '全國富豪', '首富大富豪',
];

/** Settings of a world (17 §1): no map choice, no time limit, no victory multiple. */
export interface TycoonSettings {
  mode: 'tycoon';
  /** Map ids of the cities in world order (TYCOON_MAPS). */
  maps: number[];
  /** Twelve players; exactly one human in the game (all computers in tests). */
  players: { character: number; human: boolean }[];
  fundIndex: number;
  traffic: 0 | 1 | 2;
  landLimitIndex: number;
  startDate: PackedDate;
  seed: number;
}

/** A computer's view of a city for travelling (17 §3.4). */
export interface CityView { score: number; own: number; room: number; free: number; danger: number; chase: string | null }

/** One line of the ticker (17 §10). */
export interface TickerLine {
  day: number; map: number; text: string; p?: number; kind: string;
  /** Shown in bold / colour, and kept by the 「只看重要」 setting (17 §10). */
  important?: boolean;
  /** Mergeable money lines (tolls and fees received): who paid and how much; `count` once merged. */
  from?: number; amount?: number; count?: number;
}

/** Kinds that are always important (17 §10). */
const IMPORTANT = new Set(['bankrupt', 'title', 'travel', 'arrive', 'overflow', 'confine', 'auction', 'lottery', 'stock', 'dictator', 'summon', 'wanted']);

/**
 * Merges a city's repeated small lines for the chat box (17 §10): consecutive fees received by the same player in the
 * same city become one 「糖糖 收租 ×3 +2,400」.
 */
export function mergeLines(lines: TickerLine[], name: (p: number) => string): TickerLine[] {
  const out: TickerLine[] = [];
  for (const l of lines) {
    const last = out[out.length - 1];
    if (l.kind === 'toll' && last && last.kind === 'toll' && last.map === l.map && last.p === l.p && !last.important && !l.important) {
      last.count = (last.count ?? 1) + 1;
      last.amount = (last.amount ?? 0) + (l.amount ?? 0);
      last.text = `${name(l.p!)}收租 ×${last.count} +${(last.amount ?? 0).toLocaleString('en-US')}`;
      continue;
    }
    out.push({ ...l });
  }
  return out;
}

/** How a city's flow is played: shown (passed to the screen) or headless (drained into the ticker). */
type Mode = 'shown' | 'headless';

/** Applies the overlay to a city's board (a copy): travel squares get events 17 / 18, landmarks are added. */
export function applyOverlay(board: Board, overlay: TycoonOverlay | undefined, mapId: number): Board {
  const b = structuredClone(board);
  const squares = overlay?.travel?.length ? overlay.travel : TYCOON_SQUARES[mapId] ?? [];
  const used = new Set<number>();
  for (const sq of squares) {
    const n = resolveSquare(b, sq, used);
    if (!n) continue;
    used.add(n.id);
    n.event = sq.via === 'station' ? 17 : 18;
    n.aux = 0;
  }
  const k = LAND_INDEX[mapId] ?? 1;
  for (const l of b.lands) { l.price = scaled(l.price, k); l.perLevel = scaled(l.perLevel, k); l.tolls = l.tolls.map(t => scaled(t, k)); }
  for (const f of b.facilities) { f.price = scaled(f.price, k); f.fees = f.fees.map(t => scaled(t, k)); }
  const landmarks = overlay?.travel?.length ? overlay.landmarks ?? [] : TYCOON_LANDMARKS[mapId] ?? [];
  for (const lm of landmarks) {
    const rec: Landscape = { id: b.landscapes.length + 1, x: lm.x, y: lm.y, name: lm.name, facing: lm.facing ?? 0, resource: lm.resource - 38 };
    b.landscapes.push(rec);
  }
  return b;
}

/** The node of a travel square: the listed id when it is still where expected, else the nearest event square there. */
function resolveSquare(b: Board, sq: TravelSquare, used: Set<number>): BoardNode | undefined {
  const n = nodeById(b, sq.node);
  if (n && Math.hypot(n.x - sq.x, n.y - sq.y) <= 8 && !used.has(n.id)) return n;
  let best: BoardNode | undefined, d = Infinity;
  for (const m of b.nodes) {
    if (used.has(m.id) || m.ref === 8001 || m.ref === 8002 || !m.adjacent.some(Boolean)) continue;
    if (!(m.event >= 2 && m.event <= 13) && !(m.event === 0 && m.ref === 0)) continue;
    if (m.event === 4 || m.event === 5) continue;
    const e = Math.hypot(m.x - sq.x, m.y - sq.y);
    if (e < d) { d = e; best = m; }
  }
  return best;
}

// ------------------------------------------------------------------ the world

export class World implements WorldHooks {
  readonly settings: TycoonSettings;
  readonly players: Player[];
  readonly cities: Game[];
  readonly fund: number;
  /** The world's own decisions (start cities, the computers' trips, full hospitals); the cities keep their rand(). */
  readonly rng: Rng;
  date: PackedDate;
  daysElapsed = 0;
  monthsElapsed = 0;
  priceIndex = 1;
  /** Whose turn: player id; NPC turns run between the last player and the new day. */
  current = 0;
  /** Placed on a map at least once (the cities' `placed` is this, limited to the city being played). */
  landed: boolean[];
  /** Recent ticker lines (17 §10), newest last, kept to LOG_MAX. */
  log: TickerLine[] = [];
  /** Rivals in the order they went bankrupt, with the day and the title it gave the human (17 §11). */
  fallen: { p: number; day: number; map: number; title: string }[] = [];
  /** Month-end total assets of every player (the ending's curve, 17 §11). */
  history: { day: number; wealth: number[] }[] = [];
  /** Cities each player has been in (index sets as arrays). */
  visited: number[][];
  over: { winner: number; code: number } | null = null;
  /**
   * Which city is shown when there is no human (tests): -1 none (everything headless), else that city's index.
   * With a human it is the human's city (the destination while 在路上).
   */
  watch = -1;
  /** Set by a load: the first turn resumes at the saved turn menu (its turn start already ran). */
  resumeAtTurn = false;
  static readonly LOG_MAX = 3000;
  /** Computers do not travel to a city with this many players (17 §3.4); forced moves may exceed it. */
  static readonly CROWD = 6;
  /** Days a computer stays after a trip before it considers another (17 §3.4). */
  static readonly TRIP_REST = 15;
  /** Day of each player's last departure and the city it left (no ping-pong, 17 §3.4). */
  lastTrip: number[] = [];
  lastFrom: number[] = [];
  /**
   * 通緝卡 (17 §3.5): the cities whose copy each player took from a card shop (one copy per city at a time); a city's
   * copy is back in its pool once it is used or has left play (syncWanted).
   */
  wantedFrom: number[][] = [];
  /** The city whose players count as placed now (mask). */
  private masked = -1;
  /** 大富翁城, the finale with the last four (docs/rules/19, core/finale.ts): its start, its city's link, its state. */
  readonly finale: Finale = new Finale(this);
  /** Lines ever written to the log (the log itself keeps the last LOG_MAX). */
  private logged = 0;

  constructor(settings: TycoonSettings, boards: Board[]) {
    if (boards.length !== settings.maps.length) throw new Error('world: one board per city');
    this.settings = settings;
    this.fund = FUNDS[settings.fundIndex];
    this.date = settings.startDate;
    this.rng = new Rng(daySeed((settings.seed ^ 0x7c0ffee) >>> 0, 0));
    const n = settings.players.length;
    // New game (01 §2.3 as in a normal game): humans split the fund in half, computers by their cash ratio.
    this.players = settings.players.map((s, id): Player => {
      const ch = CHARACTERS[s.character];
      const cash = s.human ? Math.trunc(this.fund / 2) : Math.trunc((ch.cashRatio * this.fund) / 100);
      return {
        id, character: s.character, human: s.human, whoPlays: 0, autopilot: false, bankrupt: false, placed: false,
        node: 0, lastNode: 0, dir: 0, traffic: settings.traffic, dice: settings.traffic + 1,
        cash, bank: this.fund - cash, loan: 0, specialFinance: 0, loanDue: 0, points: 0,
        hotel: 0, vanish: 0, prison: 0, hospital: 0, sleep: 0, sleepwalk: 0, stay: 0, turtle: 0,
        bankRefused: 0, noLoan: 0, allyDays: 0, insurance: 0, god: 0, bomb: 0, ally: 0,
        hostility: new Array(Math.max(4, n)).fill(0), monthLoss: 0, monthGain: 0, monthBadDays: 0,
        luckBad: 0, luckMoney: 0, luckFate: 0, facility: 0,
        savedTraffic: 0, savedDice: 0, sleepTraffic: 0, sleepDice: 0,
        tools: new Array(16).fill(0), cards: [], map: 0,
      };
    });
    this.landed = this.players.map(() => false);
    this.visited = this.players.map(() => []);
    this.wantedFrom = this.players.map(() => []);
    // One engine per city; each deals the starting tools again, so the first city's deal is kept (17 §1).
    let tools: number[][] | null = null;
    this.cities = settings.maps.map((mapId, index) => {
      const s: GameSettings = {
        mapId, players: settings.players, fundIndex: settings.fundIndex, traffic: settings.traffic,
        landLimitIndex: settings.landLimitIndex, daysLimitIndex: 0, victoryIndex: 0, startDate: settings.startDate,
        seed: this.citySeed(index),
      };
      const g = new Game(s, boards[index], { index, hooks: mapId === FINALE_MAP ? this.finale : this, players: this.players });
      if (!tools) tools = this.players.map(p => [...p.tools]);
      return g;
    });
    this.players.forEach((p, i) => { p.tools = [...tools![i]]; });
    this.sharePool();
    // Start (17 §1): everyone to a random city, as evenly as twelve over five goes (3, 3, 2, 2, 2).
    const order = this.shuffle(this.players.map(p => p.id));
    const cityOrder = this.shuffle(this.cities.map((_, i) => i));
    order.forEach((id, k) => { this.players[id].map = cityOrder[k % cityOrder.length]; });
    for (const p of this.players) this.visit(p);
    this.mask(this.view());
  }

  /**
   * One nationwide card pool (17 §3.10, the user 2026-10-19): the five cities share one `remaining`, each card's copies
   * × the number of cities (均富卡 2 × 5 = 10 …), so a card bought or drawn in 東京 is gone in 大阪 too. A loaded save
   * links its cities' copies again ('saved'), a save from before adds the cities' own pools up ('merge'). The 通緝卡
   * stays one per city (Cards.wanted); 大富翁城 keeps its own pool (its casino rules empty some slots).
   */
  sharePool(how: 'new' | 'saved' | 'merge' = 'new'): void {
    const cities = this.cities.filter(c => c.settings.mapId !== FINALE_MAP);
    const fresh = deckSupply(true).map(n => n * cities.length);
    const pool = how === 'saved' ? [...cities[0].cards.remaining]
      : how === 'merge' ? deckSupply(true).map((_, i) => cities.reduce((a, c) => a + (c.cards.remaining[i] ?? 0), 0))
      : fresh;
    // A save from before a card was added (複製卡, 39): its copies join the pool.
    for (let i = pool.length; i < fresh.length; i++) pool.push(fresh[i]);
    if (how !== 'saved') pool[WANTED - 1] = 0; // unused (Cards.wanted); a used copy may count up there, kept as saved
    for (const c of cities) c.cards.remaining = pool;
  }

  // ---------------------------------------------------------------- queries

  /** Like Game.rngSalt (issue #5): mixed into the cities' daily seeds after a load; 0 in a fresh world. */
  rngSalt = 0;
  citySeed(index: number): number { return (this.settings.seed + Math.imul(index + 1, 0x632be5ab)) >>> 0; }
  mapId(index: number): number { return this.settings.maps[index]; }
  cityName(index: number): string { return CITY_NAMES[this.mapId(index)] ?? `城市${index + 1}`; }
  name(p: number): string { return CHARACTERS[this.players[p].character].name; }
  human(): Player | undefined { return this.players.find(p => p.human); }
  /** The city on screen: the human's (where they are going while 在路上), or `watch` without a human. */
  view(): number {
    const h = this.human();
    if (!h) return this.watch;
    return h.trip ? h.trip.to : h.map ?? -1;
  }
  /** The game of the city on screen. */
  viewGame(): Game | undefined { const v = this.view(); return v >= 0 ? this.cities[v] : undefined; }
  rivalsLeft(): number { const h = this.human(); return this.players.filter(p => !p.bankrupt && p !== h).length; }
  /** Travel squares of a city: node ids by kind. */
  travelNodes(index: number, via?: 'station' | 'airport'): BoardNode[] {
    return this.cities[index].board.nodes.filter(n => (via ? n.event === (via === 'station' ? 17 : 18) : n.event === 17 || n.event === 18));
  }
  /** Where a player is, in words (查詢, 17 §12): city, 在路上, or a city's hospital / prison. */
  whereText(p: Player): string {
    if (p.bankrupt) return '已破產';
    if (p.trip) return `在路上（往${this.cityName(p.trip.to)}）`;
    const c = p.map !== undefined && p.map >= 0 ? this.cityName(p.map) : '';
    if (p.hospital) return `${c}醫院`;
    if (p.prison) return `${c}監獄`;
    return c;
  }

  private shuffle<T>(xs: T[]): T[] {
    const a = [...xs];
    for (let i = a.length - 1; i > 0; i--) { const j = this.rng.below(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  private visit(p: Player) {
    const m = p.map ?? -1;
    if (m >= 0 && !this.visited[p.id].includes(m)) this.visited[p.id].push(m);
  }

  /**
   * The cities' rules read `placed` as "on this board": while a city's flow runs, only the players in it count as
   * placed (17 §4). Whatever is shown on screen always has the shown city's view.
   */
  mask(index: number) {
    this.masked = index;
    for (const p of this.players) if (p.placed) this.landed[p.id] = true;
    for (const p of this.players) p.placed = this.landed[p.id] && p.map === index && !p.trip;
  }

  // ---------------------------------------------------------------- hooks for the cities (WorldHooks)

  wealth(p: Player): number {
    if (this.finale.active) return this.finale.wealth(p); // 大富翁城: everything was paid out as cash (19 §2)
    // 02 §7.1 over the whole world: money, the shares of all five markets, then every city's properties.
    let w = p.cash + p.bank - p.loan;
    for (const c of this.cities) w = c.stocks.holdingsValue(w, p);
    const owner = p.id + 1;
    for (const c of this.cities) {
      for (const l of c.board.lands) if (l.owner === owner) w += l.price + (l.chain ? l.perLevel : l.level * l.perLevel);
      for (const f of c.board.facilities) if (f.owner === owner) w += f.price + f.level * f.fees[0];
    }
    return w;
  }

  allCities(): Game[] { return this.cities; }

  resort(g: Game): number { return resortRate(this.mapId(g.world!.index), this.date); }

  cityOf(p: Player): Game | undefined {
    return p.map !== undefined && p.map >= 0 && !p.trip ? this.cities[p.map] : undefined;
  }

  bankOperators(): Player[] {
    return this.cities.map(c => c.bankOperator()).filter((x): x is Player => !!x);
  }

  /** Moves a player into city `to` at node `node` (arrivals, full hospitals); `placed` follows the mask. */
  private relocate(p: Player, to: number, node: BoardNode) {
    p.map = to;
    p.node = node.id;
    const ways = node.adjacent.filter(Boolean);
    p.lastNode = ways[0] ?? node.id;
    const from = this.cities[to].node(p.lastNode);
    p.dir = from ? Game.direction(node.x - from.x, node.y - from.y) : 0;
    this.landed[p.id] = true;
    p.placed = false; // the city being played now is another one; the next mask sets it
    this.visit(p);
  }

  /** Destinations from a city by train or plane (17 §3.1), with the fares (× price index). */
  destinations(from: number, via: 'station' | 'airport', p: Player): TravelOption[] {
    const fromMap = this.mapId(from);
    return this.cities.flatMap((c, i): TravelOption[] => {
      if (i === from) return [];
      const mapId = this.mapId(i);
      if (via === 'station' && (!STATION_MAPS.includes(fromMap) || !STATION_MAPS.includes(mapId))) return [];
      if (!this.travelNodes(i, via).length) return [];
      const price = fare(fromMap, mapId, via) * this.priceIndex;
      const owned = c.board.lands.filter(l => l.owner === p.id + 1).length + c.board.facilities.filter(f => f.owner === p.id + 1).length;
      const rivals = this.players.filter(q => !q.bankrupt && q.id !== p.id && q.map === i && !q.trip).length;
      return [{ map: i, mapId, name: CITY_NAMES[mapId] ?? '', price, affordable: p.cash + p.bank >= price, owned, rivals, landIndex: LAND_INDEX[mapId] ?? 1 }];
    });
  }

  /**
   * A station / airport square (17 §3): the human chooses in the travel dialog, a computer by its prospects (17 §3.4).
   * A trip pays the fare, sends the attached god and a carried bomb away, takes the player off the map, and costs
   * the next turn (在路上); then the player starts from the destination's square of the same kind.
   */
  *travelSquare(g: Game, p: Player, left: number): Flow<boolean> {
    if (!p.whoPlays || g.offRoad(p) || p.trip) return false;
    const from = g.world!.index, n = g.node(p.node), via = n.event === 17 ? 'station' : 'airport';
    const options = this.destinations(from, via, p);
    if (!options.length) return false;
    let dest = -1;
    if (g.isHuman(p)) {
      const a = yield ask({ t: 'travel', p: p.id, via, from: this.cityName(from), options });
      dest = typeof a === 'number' ? a : -1;
    }
    let why = '';
    if (!g.isHuman(p)) { const t = this.aiTrip(p, from, options, left); dest = t?.map ?? -1; why = t ? `（${t.reason}）` : ''; }
    const o = options.find(x => x.map === dest);
    if (!o || !o.affordable) return false;
    return yield* this.leave(g, p, o, via, true, why, n.id);
  }

  /** The trip itself (17 §3.3): the fare unless a card is the ticket, god and bomb away, off the map, 在路上. */
  private *leave(g: Game, p: Player, o: TravelOption, via: 'station' | 'airport', pay: boolean, why: string, node: number): Flow<boolean> {
    const from = g.world!.index, dest = o.map;
    if (pay) yield* g.transfer(p.id, -3, o.price, 0, via === 'station' ? '新幹線車票' : '機票');
    if (!p.whoPlays) return true;
    g.objects.detachAll(p);
    p.trip = { to: dest, via };
    p.map = -1;
    p.placed = false;
    this.lastTrip[p.id] = this.daysElapsed;
    this.lastFrom[p.id] = from;
    const text = `${this.name(p.id)}搭${via === 'station' ? '新幹線' : '飛機'}前往${this.cityName(dest)}${why}`;
    yield { t: 'fx', kind: 'travel-depart', p: p.id, node, data: { to: dest, via, text, city: this.cityName(dest) } };
    this.ticker(from, text, 'travel', p.id);
    yield { t: 'board' };
    return true;
  }

  /** Destinations for a travel card: the same as from the square, no fare (17 §3.5). */
  private cardOptions(from: number, via: 'station' | 'airport', p: Player): TravelOption[] {
    if (via === 'station' && !STATION_MAPS.includes(this.mapId(from))) return [];
    return this.destinations(from, via, p).map(o => ({ ...o, price: 0, affordable: true }));
  }

  *travelCard(g: Game, p: Player, via: 'station' | 'airport', dest?: number): Flow<boolean> {
    if (!p.whoPlays || g.offRoad(p) || p.trip) return false;
    const from = g.world!.index;
    const options = this.cardOptions(from, via, p);
    if (!options.length) {
      if (g.isHuman(p)) yield* g.say(p.id, via === 'station' ? `${this.cityName(from)}沒有新幹線車站` : '現在不能搭飛機');
      return false;
    }
    let why = '（使用卡片）';
    if (dest === undefined) {
      const a = yield ask({ t: 'travel', p: p.id, via, from: this.cityName(from), options, card: true });
      dest = typeof a === 'number' ? a : -1;
    }
    const o = options.find(x => x.map === dest);
    if (!o || !o.affordable) return false;
    if (!g.isHuman(p)) why = `（用${via === 'station' ? '電車卡' : '飛行卡'}）`;
    return yield* this.leave(g, p, o, via, false, why, p.node);
  }

  aiCardTrip(g: Game, p: Player, via: 'station' | 'airport'): number {
    const from = g.world!.index, options = this.cardOptions(from, via, p);
    if (!options.length) return -1;
    return this.aiTrip(p, from, options, 0)?.map ?? -1;
  }

  /**
   * Computer's trip (17 §3.4): the computer weighs every city it can reach against staying, from its own view. A city's
   * worth: its own properties there (toll income, room to build), the lots it can afford there, the rivals' tolls it
   * would risk there, who is there (by the character's personality, 07 §1: 乖寶寶 avoids rivals, 大老奸 chases the one
   * it resents most), and a crowded hospital and prison. A destination costs its fare and the turn 在路上, and the city
   * just left counts less (no ping-pong); a little noise from the world's stream keeps them from flocking. Within
   * TRIP_REST days of its last trip a computer stays. It goes when the best destination beats staying (stopping on the
   * square: passing does nothing), and only with three fares in hand. Returns the city, -1 to stay.
   */
  aiTravel(p: Player, from: number, options: TravelOption[], left: number): number {
    return this.aiTrip(p, from, options, left)?.map ?? -1;
  }

  /** aiTravel with the reason (for the ticker). */
  aiTrip(p: Player, from: number, options: TravelOption[], left: number): { map: number; reason: string } | null {
    // More than CROWD players here: a computer always leaves (17 §3.5), to the best city under CROWD, else the least
    // crowded one; it still has to pay the fare.
    if (this.population(from) > World.CROWD) {
      const can = options.filter(o => p.cash + p.bank >= o.price);
      if (!can.length) return null;
      const open = can.filter(o => this.population(o.map) < World.CROWD);
      const pool = open.length ? open : [can.reduce((a, b) => (this.population(b.map) < this.population(a.map) ? b : a))];
      const go = pool.reduce((a, b) => (this.cityView(p, b.map).score > this.cityView(p, a.map).score ? b : a));
      return { map: go.map, reason: `${this.cityName(from)}人太多了` };
    }
    if (this.daysElapsed - (this.lastTrip[p.id] ?? -999) < World.TRIP_REST) return null;
    // A city with CROWD players or more is not a computer's destination (the human's city stays watchable).
    const ok = options.filter(o => p.cash + p.bank >= o.price * 3 && this.population(o.map) < World.CROWD);
    if (!ok.length) return null;
    const here = this.cityView(p, from);
    let best: { o: TravelOption; v: CityView; score: number } | null = null;
    for (const o of ok) {
      const v = this.cityView(p, o.map);
      let score = v.score - o.price / (3000 * this.priceIndex) - 1;
      if (o.map === this.lastFrom[p.id]) score -= 5;
      if (!this.visited[p.id].includes(o.map)) score += 3;       // a city it has not seen yet
      score += this.rng.below(8);
      if (!best || score > best.score) best = { o, v, score };
    }
    if (!best || best.score < here.score + (left > 0 ? 3 : -1)) return null;
    const v = best.v;
    const reasons: [number, string][] = [
      [0.5 * v.own + v.room, `那裡有${v.own}塊地`],
      [0.5 * v.free, `那裡還有${v.free}塊空地`],
      [v.chase ? 3 : 0, v.chase ? `追著${v.chase}去` : ''],
      [here.danger - v.danger, '避開這裡的高價地段'],
    ];
    const reason = reasons.filter(r => r[1] && r[0] > 0).sort((a, b) => b[0] - a[0])[0]?.[1] ?? '換個地方發展';
    return { map: best.o.map, reason };
  }

  /**
   * A computer with a remote dice that sees its city's station or airport 1..6 squares ahead on its own route (forks
   * by its arrows) and would rather be elsewhere uses the dice to stop there (17 §3.4).
   */
  *aiAim(g: Game, p: Player): Flow<boolean> {
    if (!p.tools[7] || p.trip || this.daysElapsed - (this.lastTrip[p.id] ?? -999) < World.TRIP_REST) return false;
    const from = g.world!.index;
    let at = p.node, back = p.lastNode, k = 0, via: 'station' | 'airport' | null = null;
    for (k = 1; k <= 6; k++) {
      const n = g.node(at);
      let next: number;
      if (g.forks.isFork(at)) next = g.forks.follow(p.id, at, back);
      else {
        const ways = n.adjacent.filter((a, j) => a && a !== back && !(n.oneWay & (8 >> j)));
        if (ways.length > 1) return false;
        next = ways[0] ?? back;
      }
      back = at; at = next;
      const e = g.node(at).event;
      if (e === 17 || e === 18) { via = e === 17 ? 'station' : 'airport'; break; }
    }
    if (!via || k > 6) return false;
    const options = this.destinations(from, via, p);
    if (!options.length || !this.aiTrip(p, from, options, 0)) return false;
    yield* g.say(p.id, '使用遙控骰子');
    return yield* g.tools.use(p, 8, k);
  }

  // ---------------------------------------------------------------- 遣返卡, 獨裁卡, 召集卡, 通緝卡 (17 §3.5)

  /** A city to send someone to: under CROWD players (else the least crowded), not `from`; even spread. */
  private sendTarget(from: number): number {
    const open = this.cities.map((_, i) => i).filter(i => i !== from);
    if (!open.length) return -1;
    const low = Math.min(...open.map(i => this.population(i)));
    const room = open.filter(i => this.population(i) < World.CROWD);
    const pool = room.length ? room.filter(i => this.population(i) === Math.min(...room.map(j => this.population(j)))) : open.filter(i => this.population(i) === low);
    return pool[this.rng.below(pool.length)];
  }

  private option(i: number, p: Player): TravelOption {
    const mapId = this.mapId(i);
    return { map: i, mapId, name: CITY_NAMES[mapId] ?? '', price: 0, affordable: true, owned: 0, rivals: 0, landIndex: LAND_INDEX[mapId] ?? 1 };
    void p;
  }

  *deport(g: Game, victim: Player, by: Player): Flow<boolean> {
    if (!victim.whoPlays || victim.trip || victim.map === undefined || victim.map < 0) return false;
    const c = this.cities[victim.map];
    if (c.offRoad(victim)) return false;
    const to = this.sendTarget(victim.map);
    if (to < 0) return false;
    yield* g.say(undefined, `${this.name(victim.id)}被遣返到${this.cityName(to)}！`);
    yield { t: 'fx', kind: 'card-line', p: victim.id, data: { card: 17, role: 2 } };
    return yield* this.leave(c, victim, this.option(to, victim), 'airport', false, `（被${this.name(by.id)}遣返）`, victim.node);
  }

  dictateVictims(g: Game, p: Player): Player[] {
    const here = g.world!.index;
    return this.players.filter(q => q !== p && !q.bankrupt && q.whoPlays && q.map === here && !q.trip && !g.offRoad(q));
  }

  /** 獨裁卡: everyone else on this city's squares flies off, spread over the open cities with room. */
  *dictate(g: Game, p: Player): Flow {
    const victims = this.dictateVictims(g, p), here = g.world!.index;
    const plan: [Player, number][] = [];
    for (const q of victims) {
      const to = this.sendTarget(here);
      if (to < 0) break;
      q.trip = { to, via: 'airport' };          // counted where it goes before the next one is placed
      plan.push([q, to]);
    }
    for (const [q] of plan) q.trip = undefined;
    yield { t: 'fx', kind: 'dictator', p: p.id, data: { victims: plan.map(([q, to]) => [q.id, to]), city: this.cityName(here) } };
    this.ticker(here, `${this.name(p.id)}使用獨裁卡！同城${plan.length}人被送走`, 'dictator', p.id, { important: true });
    for (const [q, to] of plan) {
      g.addHostility(q.id, p.id, 100 * this.priceIndex);
      yield* this.leave(g, q, this.option(to, q), 'airport', false, `（${this.name(p.id)}的獨裁卡）`, q.node);
    }
  }

  /** A computer dictates when three rivals or more stand in its city and it owns more lots there than any of them. */
  aiDictate(g: Game, p: Player): boolean {
    const v = this.dictateVictims(g, p);
    if (v.length < 3) return false;
    const owns = (q: Player) => g.board.lands.filter(l => l.owner === q.id + 1).length + g.board.facilities.filter(f => f.owner === q.id + 1).length;
    const mine = owns(p);
    return mine > 0 && this.players.every(q => q === p || q.bankrupt || owns(q) < mine);
  }

  /** Rivals in another city who can be summoned (召集卡): on its squares, not in hospital, prison, 消失 or 在路上. */
  summonable(g: Game, p: Player): Player[] {
    const here = g.world!.index;
    return this.players.filter(q => q !== p && !q.bankrupt && q.whoPlays && !q.trip && q.map !== undefined && q.map >= 0 && q.map !== here && !this.cities[q.map].offRoad(q));
  }

  /**
   * 召集卡 (17 §3.5): a random rival from another city flies to this city — one turn 在路上, then they start from this
   * city's airport, as after any flight. No fare. A 免罪卡 in the rival's hand turns it down once (the user
   * 2026-10-19), used up as against 通緝卡; the 召集卡 is spent all the same.
   */
  *summon(g: Game, p: Player): Flow {
    const list = this.summonable(g, p);
    if (!list.length) return;
    const q = list[this.rng.below(list.length)], here = g.world!.index, from = q.map!;
    const text = `${this.name(p.id)}使用召集卡，把${this.name(q.id)}從${this.cityName(from)}叫來${this.cityName(here)}！`;
    yield { t: 'fx', kind: 'summon', p: p.id, target: q.id, data: { from: this.cityName(from), to: this.cityName(here), text } };
    // A notice on the screen when the summoner's city is not the one shown but it concerns the human or the city
    // on screen (the summoned one is there) — the user 2026-10-19: not only the summoner's city sees it.
    const shown = this.view();
    if (shown !== here && (q.human || p.human || shown === from)) yield { t: 'fx', kind: 'tycoon-notice', p: p.id, target: q.id, data: { text, icon: 'summon' } };
    this.ticker(here, text, 'summon', p.id);
    g.addHostility(q.id, p.id, 50 * this.priceIndex);
    if (q.cards.includes(21)) {
      const fc = this.cities[from], no = `${this.name(q.id)}使用免罪卡，拒絕了${this.name(p.id)}的召集！`;
      yield* this.across(from, (function* () { fc.cards.consume(q, 21); yield { t: 'fx', kind: 'card', p: q.id, data: { card: 21 } } as GameEvent; })());
      if (p.human || q.human || shown === from || shown === here) yield { t: 'fx', kind: 'tycoon-notice', p: q.id, target: p.id, data: { text: no, icon: 'summon' } };
      this.ticker(from, no, 'summon', q.id);
      return;
    }
    yield* this.across(from, this.leave(this.cities[from], q, this.option(here, q), 'airport', false, `（被${this.name(p.id)}召集）`, q.node));
  }

  /** A computer summons when it has built up this city (4+ properties at level 2 or more) and the city has room. */
  aiSummon(g: Game, p: Player): boolean {
    const me = p.id + 1, b = g.board, here = g.world!.index;
    const built = b.lands.filter(l => l.owner === me && (l.level >= 2 || l.chain)).length + b.facilities.filter(f => f.owner === me && f.level >= 2).length;
    return built >= 4 && this.population(here) < World.CROWD && this.summonable(g, p).length > 0;
  }

  /** 通緝卡's list (17 §3.5): the other eleven with where they are; those in hospital, prison, 消失 or 在路上 greyed. */
  wantedOptions(p: Player): Option[] {
    return this.players.filter(q => q !== p).map(q => {
      const away = q.bankrupt || !q.whoPlays || !!q.trip || q.map === undefined || q.map < 0 || this.cities[q.map].offRoad(q);
      return { label: this.name(q.id), value: q.id, disabled: away, detail: this.whereText(q), icon: { archive: 'Data' as const, id: 2, frame: q.character } };
    });
  }

  /**
   * 通緝卡 (17 §3.5): the target goes to prison for 5 days in the city they are in (a full prison sends them on, §8);
   * 免罪卡 cancels it, 嫁禍卡 passes it on (asked in the target's city; a human asked from another city's turn is
   * answered "no", as every question there).
   */
  *wanted(g: Game, p: Player, q: Player): Flow {
    const at = q.map!, c = this.cities[at];
    const text = `${this.name(p.id)}發出通緝令：${this.name(q.id)}在${this.cityName(at)}被捕！`;
    yield { t: 'fx', kind: 'wanted', p: p.id, target: q.id, data: { city: this.cityName(at), text } };
    // A notice when the 通緝 comes from another city than the one shown and concerns the human or the city on screen.
    const shown = this.view(), here = g.world!.index, seen = p.human || q.human || shown === at || shown === here;
    if (shown !== here && (q.human || p.human || shown === at)) yield { t: 'fx', kind: 'tycoon-notice', p: p.id, target: q.id, data: { text, icon: 'wanted' } };
    this.ticker(at, text, 'wanted', q.id);
    let sufferer = q.id;
    yield* this.across(at, (function* () { sufferer = yield* c.cards.pardonOrFrame(q); })());
    // 免罪卡 / 嫁禍卡: said on screen too (the user 2026-10-19), and in the log.
    if (sufferer !== q.id) {
      const said = sufferer < 0 ? `${this.name(q.id)}使用免罪卡，躲過了${this.name(p.id)}的通緝！` : `${this.name(q.id)}使用嫁禍卡，把通緝轉給${this.name(sufferer)}！`;
      this.ticker(at, said, 'wanted', q.id);
      if (seen || (sufferer >= 0 && this.players[sufferer].human)) yield { t: 'fx', kind: 'tycoon-notice', p: q.id, target: p.id, data: { text: said, icon: 'wanted' } };
    }
    const s = this.players[sufferer];
    if (sufferer < 0 || !s?.whoPlays || s.trip || s.map === undefined || s.map < 0) return;
    yield* this.across(s.map, this.cities[s.map].sendTo(s, 'prison', 5));
  }

  /** The computer's 通緝: the rival it resents most, else one clearly richer than itself; -1 for none. */
  aiWanted(g: Game, p: Player): number {
    const ok = new Set(this.wantedOptions(p).filter(o => !o.disabled).map(o => o.value));
    let best = -1;
    for (const q of this.players) if (ok.has(q.id) && p.hostility[q.id] > 0 && (best < 0 || p.hostility[q.id] > p.hostility[best])) best = q.id;
    if (best >= 0) return best;
    const rich = this.players.filter(q => ok.has(q.id) && this.wealth(q) > this.wealth(p) * 1.2).sort((a, b) => this.wealth(b) - this.wealth(a))[0];
    void g;
    return rich ? rich.id : -1;
  }

  /** A 通緝卡 bought in g's card shop: that city's copy is out until it is used (17 §3.5). */
  wantedTaken(g: Game, p: Player): void {
    (this.wantedFrom[p.id] ??= []).push(g.world!.index);
    this.syncWanted();
  }

  /** A 通緝卡 used by p: the copy's city gets it back (p's own entry, else one of a copy p was handed). */
  wantedUsed(p: Player): void {
    const held = (q: Player) => q.cards.filter(c => c === WANTED).length;
    const own = this.wantedFrom[p.id];
    if (own?.length) own.shift();
    else { const q = this.players.find(x => (this.wantedFrom[x.id]?.length ?? 0) > held(x)); q && this.wantedFrom[q.id].pop(); }
    this.syncWanted();
  }

  /**
   * One 通緝卡 per city (17 §3.5): copies that left play otherwise (sold, bankruptcy) give their city's back too; each
   * city's card pool then has its copy exactly when none of its is out.
   */
  syncWanted(): void {
    const held = (q: Player) => q.cards.filter(c => c === WANTED).length;
    const total = this.players.reduce((a, q) => a + held(q), 0);
    let out = this.wantedFrom.reduce((a, l) => a + (l?.length ?? 0), 0);
    while (out > total) {
      const q = this.players.find(x => (this.wantedFrom[x.id]?.length ?? 0) > held(x)) ?? this.players.find(x => this.wantedFrom[x.id]?.length);
      if (!q) break;
      this.wantedFrom[q.id].pop();
      out -= 1;
    }
    this.cities.forEach((c, i) => { c.cards.wanted = this.wantedFrom.some(l => l?.includes(i)) ? 0 : 1; });
  }

  /**
   * Another city's flow run from inside a city's (cross-city cards and tools, 17 §3.5-3.6): headless, its lines in the
   * log (and on the chat box at once when the caller's city is the one on screen); the caller's view again after.
   */
  *across(index: number, flow: Flow<unknown>): Flow {
    const was = this.masked;
    if (index === was) { yield* flow; return; }
    this.mask(index);
    const surfaced: GameEvent[] = [];
    let lines: TickerLine[] = [];
    try { lines = this.drain(index, flow, surfaced); } finally { this.mask(was); }
    if (was === this.view()) {
      for (const l of mergeLines(lines, p => this.name(p))) yield { t: 'ticker', ...l };
      yield { t: 'world-sync' };
    }
    for (const s of surfaced) yield s;
  }

  // ---------------------------------------------------------------- 城市霸主 (17 §3.8)

  /** The player owning more than half of a city's regular lots (大型用地 and companies do not count), or -1. */
  overlordOf(index: number): number {
    const lands = this.cities[index].board.lands, count = new Map<number, number>();
    for (const l of lands) if (l.owner) count.set(l.owner, (count.get(l.owner) ?? 0) + 1);
    for (const [owner, n] of count) if (n * 2 > lands.length) return owner - 1;
    return -1;
  }

  overlordTitles(p: Player): string[] {
    return this.cities.map((_, i) => i).filter(i => this.overlordOf(i) === p.id).map(i => `${this.cityName(i)}霸主`);
  }

  /** The statistics ledger shared by the cities (core/stats.ts), when the screen attached one. */
  get stats(): Ledger | undefined { return ledgerOf(this.players); }

  /** 霸主 per city as last announced (ticker lines when it changes). */
  overlords: number[] = [];

  /** New and lost 霸主 titles since the last check: a line each, a banner when it is the human. */
  private *checkOverlords(): Flow {
    for (const [i] of this.cities.entries()) {
      const now = this.overlordOf(i), was = this.overlords[i] ?? -1;
      if (now === was) continue;
      this.overlords[i] = now;
      for (const [who, gained] of [[was, false], [now, true]] as const) {
        if (who < 0 || this.players[who].bankrupt) continue;
        if (gained) this.stats?.overlord(who, i);
        const text = gained ? `${this.name(who)}成為${this.cityName(i)}霸主！` : `${this.name(who)}失去${this.cityName(i)}霸主`;
        this.ticker(i, text, 'overlord', who, { important: true });
        this.outbox.push(this.log[this.log.length - 1]);
        if (this.players[who].human) yield { t: 'fx', kind: 'tycoon-overlord', p: who, data: { city: this.cityName(i), gained, text } };
      }
    }
  }

  /**
   * 城市霸主's privilege (17 §3.8): sent to hospital or prison in the city they rule, they are out the same day (no days,
   * no lost turn). Not when sent on to another city's (full house, §8): only where they rule.
   */
  *overlordRelease(g: Game, p: Player, place: 'hospital' | 'prison'): Flow<boolean> {
    const at = g.world!.index;
    if (this.overlordOf(at) !== p.id) return false;
    const line = place === 'hospital' ? '特護病房，當天出院' : '有檢察官罩著，當天出獄';
    p[place] = 0;
    yield { t: 'fx', kind: 'overlord-release', p: p.id, data: { place, city: this.cityName(at), text: line } };
    this.ticker(at, `${this.cityName(at)}霸主${this.name(p.id)}：${line}`, 'overlord', p.id);
    yield* g.say(p.id, `${this.cityName(at)}霸主\n${line}！`);
    return true;
  }

  // ---------------------------------------------------------------- 洲際飛彈, 時空機 (17 §3.6)

  /** Built properties of a city (lands and facilities) as `[ref, x, y, owner, level, worth]`. */
  private built(index: number): { ref: number; x: number; y: number; owner: number; level: number; name: string; worth: number }[] {
    const b = this.cities[index].board;
    return [
      ...b.lands.filter(l => l.level > 0).map(l => ({ ref: l.id + 2000, x: l.x, y: l.y, owner: l.owner, level: l.level, name: l.name, worth: l.price + l.level * l.perLevel })),
      ...b.facilities.filter(f => f.level > 0).map(f => ({ ref: f.id + 4000, x: f.x, y: f.y, owner: f.owner, level: f.level, name: f.name, worth: f.price + f.level * (f.fees[0] ?? 0) })),
    ];
  }

  icbmCities(p: Player): Option[] {
    return this.cities.map((_, i) => {
      const rivals = this.built(i).filter(x => x.owner && x.owner !== p.id + 1).length;
      return { label: this.cityName(i), value: i, detail: `對手建築 ${rivals} 處` };
    });
  }

  /** Another city's buildings, dearest first (the list stands in for the far city's map). */
  icbmTargets(p: Player, city: number): Option[] {
    return this.built(city).sort((a, b) => b.worth - a.worth).slice(0, 40).map(x => ({
      label: x.name, value: x.ref,
      detail: `${x.owner ? (x.owner === p.id + 1 ? '自己的' : this.name(x.owner - 1)) : '無主'} ${x.level}級`,
      icon: x.owner ? { archive: 'Data' as const, id: 2, frame: this.players[x.owner - 1].character } : undefined,
    }));
  }

  cityRoadNodes(city: number): number[] { return this.cities[city]?.board.nodes.filter(n => n.adjacent.some(Boolean)).map(n => n.id) ?? []; }

  /**
   * 洲際飛彈 on another city: the launch here, the nuclear blast there (headless), news for everyone. `ref`: a lot or
   * facility (the computer's), or 100000 + a road square tapped on that city's map (the human's).
   */
  *icbm(g: Game, p: Player, city: number, ref: number): Flow {
    const c = this.cities[city];
    const node = ref >= 100000 ? c.board.nodes.find(n => n.id === ref - 100000) : undefined;
    const lot = node ? undefined : ref > 4000 ? c.board.facilities[ref - 4001] : c.board.lands[ref - 2001];
    // A square's name for the news: its own lot, else the nearest lot or facility.
    const plots = [...c.board.lands, ...c.board.facilities];
    const near = node && plots.reduce<(typeof plots)[number] | undefined>((b, l) => (!b || Math.hypot(l.x - node.x, l.y - node.y) < Math.hypot(b.x - node.x, b.y - node.y) ? l : b), undefined);
    const at = node ? { x: node.x, y: node.y, name: near?.name ?? '' } : lot;
    if (!at) return;
    const text = at.name ? `${this.name(p.id)}的洲際飛彈落在${this.cityName(city)}的${at.name}！` : `${this.name(p.id)}的洲際飛彈落在${this.cityName(city)}！`;
    // The full-screen flight (ui/icbm-flight.ts): from this city over the globe onto that city's map, zooming on the spot.
    yield { t: 'fx', kind: 'icbm-launch', p: p.id, data: { city: this.cityName(city), target: at.name, text, from: this.cityName(g.world!.index), mapId: this.mapId(city), x: at.x, y: at.y, size: c.board.size ?? 2304 } };
    this.ticker(city, text, 'icbm', p.id, { important: true });
    const h = this.human();
    if (h && this.view() === city && g.world!.index !== city) yield { t: 'fx', kind: 'tycoon-notice', p: p.id, data: { text, icon: 'icbm' } };
    const before = c.tools.holdings();
    yield* this.across(city, c.tools.nukeAt(p, at.x, at.y));
    // Those it hit, each with a 「？？？」 (the user 2026-10-19).
    const hurt = c.tools.hurtSince(before);
    yield { t: 'fx', kind: 'icbm-hit', p: p.id, data: { victims: hurt, text, city: this.cityName(city) } };
  }

  /** The computer's 洲際飛彈: the rivals' building cluster hurting it most, away from its own (-1 none). */
  aiIcbm(p: Player): number {
    const me = p.id + 1, ally = p.ally, half = 220;
    let best = -1, top = 5;
    this.cities.forEach((_, i) => {
      const all = this.built(i);
      for (const t of all) {
        if (!t.owner || t.owner === me || t.owner === ally || t.level < 3) continue;
        let score = 0;
        for (const o of all) if (Math.abs(o.x - t.x) <= half && Math.abs(o.y - t.y) <= half) score += o.owner === me ? -2 * o.level : o.owner && o.owner !== ally ? o.level : 0;
        if (score > top) { top = score; best = i * 10000 + t.ref; }
      }
    });
    return best;
  }

  /** 時空機's other cities (no fare, no turn 在路上). */
  spaceTimeCities(p: Player): Option[] {
    const here = p.map ?? -1;
    return this.cities.map((_, i) => ({ label: this.cityName(i), value: i, disabled: i === here, detail: i === here ? '現在所在' : `地價×${(LAND_INDEX[this.mapId(i)] ?? 1).toFixed(1)}・${this.population(i)}人` })).filter(o => o.value !== here);
  }

  /**
   * 時空機's crossing (17 §3.6; the user 2026-10-19): to a random square of the city's roads (the world's stream), the
   * god attached going along (土地公 from 東京 takes lots in 沖繩); a carried bomb is left behind as on any trip.
   */
  *spaceTime(g: Game, p: Player, city: number, by?: Player): Flow {
    const from = p.map ?? g.world!.index, dc = this.cities[city];
    const road = dc.board.nodes.filter(n => n.adjacent.some(Boolean) && !n.noDrop);
    const node = road.length ? road[this.rng.below(road.length)] : (this.travelNodes(city, 'airport')[0] ?? dc.board.nodes[0]);
    const text = by && by !== p ? `${this.name(by.id)}用時空機把${this.name(p.id)}送到${this.cityName(city)}` : `${this.name(p.id)}用時空機瞬間來到${this.cityName(city)}`;
    if (p.human && by && by !== p) yield { t: 'fx', kind: 'tycoon-notice', p: by.id, target: p.id, data: { text, icon: 'travel' } };
    yield { t: 'fx', kind: 'space-time', p: p.id, node: p.node, data: { city: this.cityName(city), text } };
    const god = p.god ? OBJECT_NAMES[g.objects.godType(p) - 1] : '';
    const carried = !!p.god && g.objects.carryGod(p, dc.objects);
    if (p.bomb) g.objects.remove(p.bomb);
    if (!carried) g.objects.detachAll(p);
    if (carried) this.ticker(city, `${god}跟著${this.name(p.id)}一起來到${this.cityName(city)}`, 'travel', p.id);
    this.lastTrip[p.id] = this.daysElapsed;
    this.lastFrom[p.id] = from;
    this.relocate(p, city, node);
    this.ticker(from, text, 'travel', p.id);
    yield { t: 'board' };
    yield { t: 'world-sync' };
  }

  /** 時空機 (the user 2026-10-19): a god, a mine, a gift … on g's road to a random free road square of `city`. */
  *spaceTimeObject(g: Game, p: Player, node: number, city: number): Flow<boolean> {
    const dc = this.cities[city], o = g.objects.at(node);
    if (!o || city === g.world!.index) return false;
    const free = dc.board.nodes.filter(n => n.adjacent.some(Boolean) && !n.noDrop && !dc.objects.at(n.id) && !dc.occupants(n.id).length);
    if (!free.length) return false;
    const dest = free[this.rng.below(free.length)].id, name = OBJECT_NAMES[o.type - 1] ?? '物品';
    if (!g.objects.sendAway(node, dc.objects, dest)) return false;
    const text = `${this.name(p.id)}用時空機把${name}送到${this.cityName(city)}`;
    yield { t: 'fx', kind: 'space-time', p: p.id, node, data: { city: this.cityName(city), text, object: o.type } };
    this.ticker(g.world!.index, text, 'travel', p.id);
    if (this.view() === city) this.ticker(city, `${name}從${this.cityName(g.world!.index)}被送來了`, 'travel', p.id);
    yield { t: 'board' };
    return true;
  }

  /** The computer's crossing: its own travel judgement with a free ticket (-1 stays). */
  aiSpaceTime(g: Game, p: Player): number {
    const from = g.world!.index;
    const options = this.cities.map((_, i) => i).filter(i => i !== from).map(i => ({ ...this.option(i, p), price: 0 }));
    return this.aiTrip(p, from, options, 0)?.map ?? -1;
  }

  /** How a computer sees a city (17 §3.4). */
  cityView(p: Player, index: number): CityView {
    const c = this.cities[index], b = c.board, me = p.id + 1, ally = p.ally;
    const budget = p.cash + p.bank, PI = this.priceIndex;
    let own = 0, room = 0, free = 0, danger = 0;
    for (const l of b.lands) {
      if (l.owner === me) { own++; if (!l.chain && l.level < 5) room++; }
      else if (!l.owner) { if ((l.price + l.level * l.perLevel) * PI <= budget * 0.3) free++; }
      else if (l.owner !== ally) danger += l.tolls[l.level] / 1000;
    }
    for (const f of b.facilities) {
      if (f.owner === me) { own++; if (f.level < 5) room++; }
      else if (!f.owner) { if (f.price * PI <= budget * 0.3) free++; }
      else if (f.owner !== ally && f.level) danger += f.fees[f.level] / 1000;
    }
    free = Math.min(free, 60);
    const style = CHARACTERS[p.character]?.personality ?? 1;
    const rivals = this.players.filter(q => q.id !== p.id && !q.bankrupt && q.map === index && !q.trip);
    let hated: Player | undefined;
    for (const q of rivals) if (p.hostility[q.id] > 0 && (!hated || p.hostility[q.id] > p.hostility[hated.id])) hated = q;
    const crowd = this.occupancy(index, 'hospital') + this.occupancy(index, 'prison');
    // Tolls come in wherever the owner is, so own lots count for the building they still allow (room) more than for
    // themselves; unowned lots it can afford are what a trip is for.
    let score = 0.5 * own + room + 0.5 * free - danger * [1.5, 1, 0.7][style] - 0.3 * crowd;
    // A resort's unowned large plots are worth a hotel each.
    if (RESORT[this.mapId(index)]) score += 1.5 * b.facilities.filter(f => !f.owner && f.price * PI <= budget * 0.3).length;
    score += rivals.length * [-1, 0, 0.5][style];
    if (hated) score += [-1, 1, 2.5][style];
    // 城市霸主 (17 §3.8): ruling a city is worth staying for, being close to it worth going for.
    const mineLots = b.lands.filter(l => l.owner === me).length, need = Math.floor(b.lands.length / 2) + 1;
    if (mineLots >= need) score += 2;
    else if (mineLots * 10 >= need * 6 && b.lands.some(l => !l.owner && l.price * PI <= budget * 0.3)) score += 3;
    // A lab with 「限定」 tools (17 §3.6, 沖繩 most): worth more with an own lab there, a little otherwise.
    const advanced = (TYCOON_LABS[this.mapId(index)] ?? []).filter(t => t > 13).length;
    if (advanced) score += b.facilities.some(f => f.owner === me && f.type === 4 && f.level >= 1) ? advanced : 0.3 * advanced;
    return { score, own, room, free, danger, chase: style === 2 && hated ? this.name(hated.id) : null };
  }

  /**
   * Full hospital or prison (17 §8): with eight inside already (players and NPCs), the patient or prisoner goes to a
   * random other city that has a place, and plays on there once out. True when moved.
   */
  *overflow(g: Game, p: Player, place: 'hospital' | 'prison', days: number): Flow<boolean> {
    const at = g.world!.index;
    if (this.occupancy(at, place) < PLACES_PER_HOUSE) return false;
    const room = this.cities.map((_, i) => i).filter(i => i !== at && this.occupancy(i, place) < PLACES_PER_HOUSE);
    if (!room.length) return false;
    const to = room[this.rng.below(room.length)], c = this.cities[to];
    g.objects.detachAll(p);
    p.hotel = 0; p.vanish = 0; p.prison = 0; p.hospital = 0;
    this.relocate(p, to, place === 'hospital' ? c.hospitalNode() : c.prisonNode());
    p[place] = days;
    const house = place === 'hospital' ? '醫院' : '監獄';
    const text = `${this.cityName(at)}${house}客滿，${this.name(p.id)}被送到${this.cityName(to)}${house}`;
    this.ticker(at, text, 'overflow', p.id);
    yield { t: 'fx', kind: 'house-full', p: p.id, data: { place, from: at, to, text, days } };
    yield* g.say(undefined, `${house}客滿！\n送到${this.cityName(to)}${house}`, text);
    yield* g.insurancePayout(p, days * 2000 * this.priceIndex);
    p.monthBadDays += days;
    yield { t: 'world-sync' };
    return true;
  }

  /** Players in a city (on its squares, its hospital or prison) and those on their way there (17 §3.4). */
  population(index: number): number {
    return this.players.filter(q => !q.bankrupt && (q.trip ? q.trip.to === index : q.map === index)).length;
  }

  /** Players and NPCs in a city's hospital or prison. */
  occupancy(index: number, place: 'hospital' | 'prison'): number {
    const c = this.cities[index];
    const people = this.players.filter(q => q.whoPlays && q.map === index && !q.trip && q[place] !== 0).length;
    return people + c.places.npcs.filter(n => n.where === (place === 'prison' ? 1 : 2)).length;
  }

  /** The nationwide market screen (17 §5): slot = city × 12 + the city's slot. */
  *humanMarket(p: Player, g: Game): Flow {
    for (;;) {
      if (this.over || !p.whoPlays) return;
      const a = (yield ask({ t: 'stock-market', p: p.id })) as { slot: number; buy: boolean; n: number } | number | undefined;
      if (!a || typeof a !== 'object') return;
      const city = Math.floor(a.slot / 12), slot = a.slot % 12, market = this.cities[city]?.stocks;
      if (!market || !Number.isInteger(a.slot) || a.slot < 0) return;
      if (!market.open()) { yield* g.say(undefined, `${this.cityName(city)}股市本日休市`); continue; }
      yield* market.trade(p, slot, a.buy, a.n, a.slot);
    }
  }

  /**
   * Bankruptcy in the world (17 §9, 02 §9.3 otherwise): the properties in every city go back to the bank, the shares
   * of all five markets to the lottery pools, the NPCs of every city return; three released properties of the city
   * the bankruptcy happens in go to public auction there. The human's bankruptcy ends the game, as does the last
   * rival's.
   */
  *bankrupt(p: Player, g: Game): Flow {
    if (p.bankrupt) return;
    p.whoPlays = 0;
    p.bankrupt = true;
    this.cityOf(p)?.objects.detachAll(p);
    g.endAlly(p);
    for (const c of this.cities) c.places.returnNpcsOf(p);
    Object.assign(p, {
      cash: 0, bank: 0, loan: 0, specialFinance: 0, loanDue: 0, points: 0, hotel: 0, vanish: 0, prison: 0, hospital: 0,
      sleep: 0, sleepwalk: 0, stay: 0, turtle: 0, bankRefused: 0, noLoan: 0, allyDays: 0, insurance: 0, god: 0, bomb: 0,
      ally: 0, hostility: new Array(p.hostility.length).fill(0), luckBad: 0, luckMoney: 0, luckFate: 0,
    });
    for (const q of this.players) q.hostility[p.id] = 0;
    const at = p.map !== undefined && p.map >= 0 ? p.map : g.world!.index;
    yield { t: 'bankrupt', p: p.id };
    this.ticker(at, `${this.name(p.id)}破產了！`, 'bankrupt', p.id);
    const h = this.human();
    if (h && p === h) { yield* this.end(-1, 1); return; }
    const standing = this.players.filter(q => !q.bankrupt);
    if (h && !p.human) {
      const title = TITLES[Math.min(TITLES.length - 1, this.fallen.length)];
      this.fallen.push({ p: p.id, day: this.daysElapsed, map: at, title });
      this.ticker(at, `你獲得新稱號「${title}」`, 'title', h.id);
      yield { t: 'fx', kind: 'tycoon-title', p: h.id, data: { title, rank: this.fallen.length, fallen: p.id, left: standing.length - 1 } };
    } else this.fallen.push({ p: p.id, day: this.daysElapsed, map: at, title: '' });
    if (standing.length <= 1) { yield* this.end(standing[0]?.id ?? -1, standing[0]?.human ? 2 : 1); return; }
    const owner = p.id + 1, released: number[] = [];
    for (const c of this.cities) {
      for (const l of c.board.lands) if (l.owner === owner) { l.owner = 0; l.expire = 0; if (c === g) released.push(l.id + 2000); }
      for (const f of c.board.facilities) if (f.owner === owner) { f.owner = 0; f.expire = 0; if (c === g) released.push(f.id + 4000); }
      for (const co of c.board.companies) if (co.controller === owner) co.controller = 0;
      c.places.lottery = c.places.lottery.map(b => (b === owner ? 0 : b));
    }
    yield { t: 'board' };
    for (const c of this.cities) yield* c.stocks.sellAll(p, true);
    yield* g.tools.dropAll(p, true);
    yield* g.cards.dropAll(p, true);
    // 大富翁城 (docs/rules/19 §2): a finalist out of chips leaves the halls unowned, no auction.
    if (released.length > 3 && !(this.finale.active && g === this.finale.game())) {
      const picked = new Set<number>();
      while (picked.size < 3) picked.add(released[g.rng.below(released.length)]);
      // Bid on by everyone alive in the whole world, after the turn (17 §9): the human live, wherever they are.
      this.pendingAuctions.push({ city: g.world!.index, refs: [...picked] });
    }
  }

  /** Bankruptcy auctions waiting for the end of the turn (17 §9); empty between turns (not saved). */
  private pendingAuctions: { city: number; refs: number[] }[] = [];

  /**
   * The waiting bankruptcy auctions: run by their city's engine but on screen wherever the human is (every living
   * player bids; the human through the auction room), always after the turn so that headless = shown.
   */
  private *auctions(): Flow {
    while (this.pendingAuctions.length && !this.over) {
      const { city, refs } = this.pendingAuctions.shift()!;
      const g = this.cities[city];
      for (const ref of refs) {
        if (this.over) return;
        const flow = g.places.auction(-1, ref, true);
        let r = flow.next();
        while (!r.done) {
          const s = r.value;
          if (!('ask' in s)) this.toTicker(city, s);
          r = flow.next((yield s) as Answer);
        }
      }
    }
  }

  private *end(winner: number, code: number): Flow {
    if (this.over) return;
    for (const p of this.players) if (p.id !== winner) p.whoPlays = 0;
    this.over = { winner, code };
    for (const c of this.cities) c.over = this.over;
    yield { t: 'gameover', winner, code };
  }

  // ---------------------------------------------------------------- running

  /** The whole world: each player's turn in id order, then the NPCs of every city, then the new day (17 §2). */
  *run(): Flow {
    while (!this.over) {
      for (; this.current < this.players.length && !this.over; this.current++) {
        const resumed = this.resumeAtTurn;
        this.resumeAtTurn = false;
        yield* this.playerTurn(this.players[this.current], resumed);
        yield* this.auctions();
        yield* this.checkOverlords();
        yield* this.finale.check(); // four left: 大富翁城 (docs/rules/19)
      }
      if (this.over) break;
      for (const [i, c] of this.cities.entries()) {
        if (!this.finale.runs(i)) continue; // the five cities are frozen during the finale
        for (let k = 0; k < 4 && !this.over; k++) {
          const actor = c.npcBase + k;
          if (!c.places.npcActive(actor)) continue;
          c.current = actor;
          yield* this.onCity(i, c.places.npcTurn(actor));
        }
      }
      yield* this.auctions();
      if (this.over) break;
      // The other cities' news of the round, after the shown city's moves (17 §10).
      yield* this.flushTicker();
      yield* this.daily();
      yield* this.auctions();
      yield* this.checkOverlords();
      yield* this.finale.check();
      this.finale.tidy();
      yield* this.flushTicker();
      this.current = 0;
    }
  }

  /** One player's turn: 在路上 (arrival at its end) or a turn in their city, run by that city's engine. */
  private *playerTurn(p: Player, resumed: boolean): Flow {
    if (p.bankrupt) return;
    const before = this.view();
    if (p.trip) { yield* this.arrive(p); }
    else {
      const i = p.map ?? 0, c = this.cities[i];
      const self = this;
      yield* this.onCity(i, (function* () {
        c.current = p.id;
        if (!resumed) yield* c.turnStart(p);
        if (!self.over) yield* c.playerTurn(p);
      })());
    }
    // The human travelled (or arrived): the screen loads the city now shown.
    if (!this.over && this.view() !== before && this.view() >= 0) yield { t: 'world-view', map: this.view() };
  }

  /** The skipped turn of a trip ends with the arrival on the destination's square (17 §3.3). */
  private *arrive(p: Player): Flow {
    const trip = p.trip!;
    const to = trip.to;
    const node = this.travelNodes(to, trip.via)[0] ?? this.travelNodes(to)[0] ?? this.cities[to].board.nodes[0];
    p.trip = undefined;
    this.relocate(p, to, node);
    const text = `${this.name(p.id)}抵達${this.cityName(to)}${trip.via === 'station' ? '車站' : '機場'}`;
    const c = this.cities[to], self = this;
    // The human's skipped turn shows the trip (在路上); computers elsewhere only get their ticker line.
    if (p.human) yield { t: 'fx', kind: 'travel-onway', p: p.id, data: { via: trip.via, to, city: this.cityName(to) } };
    yield* this.onCity(to, (function* () {
      self.ticker(to, text, 'arrive', p.id);
      c.current = p.id;
      yield { t: 'turn', p: p.id };
      yield { t: 'fx', kind: 'travel-arrive', p: p.id, node: node.id, data: { via: trip.via, text } } as GameEvent;
      yield { t: 'teleport', p: p.id, node: node.id } as GameEvent;
      yield { t: 'world-sync' } as GameEvent;
    })());
  }

  /**
   * Runs a city's flow: on screen when it is the shown city, else headless (17 §10), each event turned into ticker
   * lines and any question answered by `autoAnswer` (none come up for computers). The rules see the same either way.
   */
  *onCity(index: number, flow: Flow): Flow {
    this.mask(index);
    const mode: Mode = index === this.view() ? 'shown' : 'headless';
    try {
      if (mode === 'shown') {
        // On screen as it happens; the log (the recent-events list) records it the same way as a headless city's.
        let r = flow.next();
        while (!r.done) {
          const s = r.value;
          if (!('ask' in s)) this.toTicker(index, s);
          r = flow.next((yield s) as Answer);
        }
        return;
      }
      const surfaced: GameEvent[] = [];
      const lines = this.drain(index, flow, surfaced);
      this.mask(this.view());
      // The chat box gets these at the end of the round (flushTicker), merged and one by one.
      this.outbox.push(...lines);
      if (lines.some(l => ['overflow', 'arrive', 'bankrupt', 'travel', 'summon', 'wanted', 'icbm', 'dictator'].includes(l.kind))) yield { t: 'world-sync' };
      // What the human must see even from another city: a new title, the end of the game.
      for (const s of surfaced) yield s;
    } finally {
      this.mask(this.view());
    }
  }

  /** Plays a flow to its end without the screen; returns the ticker lines it made. */
  drain(index: number, flow: Generator<Step, unknown, Answer>, surfaced?: GameEvent[]): TickerLine[] {
    const start = this.logged;
    let r = flow.next();
    while (!r.done) {
      const s: Step = r.value;
      let answer: Answer;
      if ('ask' in s) answer = autoAnswer(s);
      else {
        this.toTicker(index, s);
        if (surfaced && (s.t === 'gameover' || (s.t === 'fx' && (s.kind === 'tycoon-title' || s.kind === 'tycoon-notice')))) surfaced.push(s);
      }
      r = flow.next(answer);
    }
    const n = this.logged - start;
    return n > 0 ? this.log.slice(-Math.min(n, this.log.length)) : [];
  }

  ticker(map: number, text: string, kind: string, p?: number, extra: Partial<TickerLine> = {}) {
    this.logged += 1;
    this.log.push({ day: this.daysElapsed, map, text, p, kind, ...(IMPORTANT.has(kind) ? { important: true } : {}), ...extra });
    if (this.log.length > World.LOG_MAX) this.log.splice(0, this.log.length - World.LOG_MAX);
  }

  /** Lines of headless cities waiting for the chat box (17 §10); not saved (the log has them). */
  private outbox: TickerLine[] = [];

  /** The round's remote lines, merged, to the screen (after the shown city's moves of the day). */
  private *flushTicker(): Flow {
    if (!this.outbox.length) return;
    const lines = mergeLines(this.outbox, p => this.name(p));
    this.outbox = [];
    for (const l of lines) yield { t: 'ticker', ...l };
  }

  /** What of a headless city's events is worth a ticker line (17 §10). */
  private toTicker(index: number, s: GameEvent) {
    const c = this.cities[index], n = (p: number) => this.name(p);
    this.stats?.observe(s, c); // the statistics ledger sees every city's events here (core/stats.ts)
    const fmt = (x: number) => x.toLocaleString('en-US');
    switch (s.t) {
      case 'buy': {
        const what = s.kind === 'land' ? c.board.lands[s.id - 1]?.name : c.board.facilities[s.id - 1]?.name;
        const big = s.kind === 'facility' || s.price >= 5000 * this.priceIndex;
        this.ticker(index, `${n(s.p)}買下${what} ${fmt(s.price)}`, 'buy', s.p, big ? { important: true } : {});
        break;
      }
      case 'build':
        if (s.level >= 3) this.ticker(index, `${n(s.p)}把${s.kind === 'land' ? c.board.lands[s.id - 1]?.name : c.board.facilities[s.id - 1]?.name}蓋到${s.level}級`, 'build', s.p, s.level >= 5 ? { important: true } : {});
        break;
      case 'pay': {
        const isP = (x: number) => x >= 0 && x < this.players.length;
        if (!isP(s.from) || !isP(s.to)) break;
        const human = this.players[s.to].human || this.players[s.from].human;
        const big = s.amount >= 10000 * this.priceIndex;
        // Fees received (tolls, hotel, shop …): one line each, merged per receiver in the chat; big ones or the
        // human's stand out.
        if (/費$/.test(s.reason)) this.ticker(index, `${n(s.to)}收${s.reason} +${fmt(s.amount)}（${n(s.from)}付）`, 'toll', s.to, { from: s.from, amount: s.amount, ...(big || human ? { important: true } : {}) });
        else if (big || human) this.ticker(index, `${n(s.from)}付給${n(s.to)}${s.reason}${fmt(s.amount)}元`, 'pay', s.from, { important: true });
        break;
      }
      case 'fx': {
        const d = s.data ?? {};
        if (s.kind === 'to-hospital' || s.kind === 'to-prison') {
          if (s.p !== undefined) this.ticker(index, `${n(s.p)}${s.kind === 'to-hospital' ? '住院' : '坐牢'}${d.days}天`, 'confine', s.p);
        } else if (s.kind === 'god-attach' && s.p !== undefined) {
          this.ticker(index, `${n(s.p)}被神明附身`, 'god', s.p);
        } else if (s.kind === 'lottery-draw' && typeof d.winner === 'number' && d.winner >= 0) {
          this.ticker(index, `樂透開獎，${n(d.winner)}獨得${fmt(Number(d.prize))}元`, 'lottery', d.winner);
        } else if (s.kind === 'event-result') {
          const head = typeof d.head === 'string' ? d.head : '';
          const src = d.src === 'news' ? '新聞' : '命運';
          if (head && (d.src === 'news' || (s.p !== undefined && this.players[s.p]?.human))) this.ticker(index, `${src}：${head}`, d.src === 'news' ? 'news' : 'fate', s.p);
        } else if ((s.kind === 'stock-up' || s.kind === 'stock-down') && s.p !== undefined) {
          this.ticker(index, `${n(s.p)}讓${c.stocks.stocks[Number(d.slot)]?.name ?? '股票'}${s.kind === 'stock-up' ? '漲停' : '跌停'}`, 'stock', s.p);
        } else if (s.kind === 'auction-end' && typeof d.buyer === 'number' && d.buyer >= 0) {
          this.ticker(index, `${n(d.buyer)}標得拍賣地產（${fmt(Number(d.price))}元）`, 'auction', d.buyer);
        }
        break;
      }
      default: break;
    }
  }

  /** The new day for the whole world (01 §4.2, 17 §6): calendar, prices, market, the 15th, the month end. */
  private *daily(): Flow {
    const { date, newMonth } = nextDay(this.date);
    this.date = date;
    this.daysElapsed += 1;
    for (const c of this.cities) { c.date = date; c.daysElapsed = this.daysElapsed; }
    this.stats?.newDay(this.players, p => this.wealth(p), this.cities.map(c => c.board), this.daysElapsed);
    this.mask(this.view());
    yield { t: 'day', date, newMonth };
    this.updatePriceIndex();
    this.cities.forEach((c, i) => c.rng.reseed(daySeed((this.citySeed(i) ^ this.rngSalt) >>> 0, this.daysElapsed)));
    for (const [i, c] of this.cities.entries()) { if (!this.finale.runs(i)) continue; this.mask(i); this.drain(i, c.stocks.daily()); }
    this.mask(this.view());
    yield { t: 'fx', kind: 'stocks-updated' };
    if (dayOf(this.date) === 15) {
      if (!this.finale.active) yield* this.dividends(); // no stocks in 大富翁城
      for (const [i, c] of this.cities.entries()) if (this.finale.runs(i)) yield* this.onCity(i, c.places.lotteryDraw());
      if (this.over) return;
    }
    if (newMonth) {
      // Monthly bank settlement (02 §8.5) for all twelve: 10% on deposits for players without a loan.
      const g0 = this.cities[0];
      const rows = this.players.filter(p => p.whoPlays).map(p => ({ p: p.id, character: p.character, bank: p.bank, loan: p.loan !== 0, interest: p.loan ? 0 : Math.trunc(p.bank * 0.1) }));
      for (const p of this.players) if (p.whoPlays && p.loan === 0) p.bank = Math.trunc(p.bank * 1.1);
      // One quick nationwide sheet, then 本月全國富豪榜 (top 5 and the human's place, 17 §6).
      const ranking = this.players.filter(p => !p.bankrupt).map(p => ({ p: p.id, wealth: this.wealth(p) })).sort((a, b) => b.wealth - a.wealth || a.p - b.p);
      yield { t: 'fx', kind: 'month-report', data: { ...g0.monthReport(rows), world: true, ranking } as unknown as Record<string, unknown> };
      for (const p of this.players) { p.monthLoss = 0; p.monthGain = 0; p.monthBadDays = 0; }
      for (const [i, c] of this.cities.entries()) {
        if (!this.finale.runs(i)) continue;
        yield* this.onCity(i, c.objects.monthly());
        yield* this.onCity(i, c.blackMarket.monthly());
        c.monthsElapsed += 1;
      }
      this.monthsElapsed += 1;
      yield* this.roamingDeath();
      this.history.push({ day: this.daysElapsed, wealth: this.players.map(p => (p.bankrupt ? 0 : this.wealth(p))) });
    }
    for (const c of this.cities) {
      for (const l of [...c.board.lands, ...c.board.facilities]) {
        if (l.tmpState >> 4) l.tmpState = (l.tmpState >> 4) - 1 ? l.tmpState - 0x10 : 0;
        if (l.expire && daysBetween(l.expire, this.date) >= 0) { l.owner = 0; l.expire = 0; }
      }
    }
    yield { t: 'board' };
  }

  /**
   * The roaming Death (17 §7, the user 2026-10-19): once six or more players are bankrupt (before 大富翁城), each new
   * month with no Death out in any city puts one on a random free road square of a random city; when it has left the
   * one it attached to, the next month brings another. Stopping on it, it attaches as any god (13 days, its usual
   * effects); 時空機 can send it to another city.
   */
  private *roamingDeath(): Flow {
    if (this.finale.active || this.players.filter(p => p.bankrupt).length < 6) return;
    const cities = this.cities.map((c, i) => ({ c, i })).filter(({ i }) => this.finale.runs(i) && this.mapId(i) !== FINALE_MAP);
    if (!cities.length || cities.some(({ c }) => c.objects.deathOut())) return;
    const { c, i } = cities[this.rng.below(cities.length)];
    const free = c.board.nodes.filter(n => n.adjacent.some(Boolean) && !n.noDrop && !c.objects.at(n.id) && !c.occupants(n.id).length);
    if (!free.length) return;
    const node = free[this.rng.below(free.length)];
    if (!c.objects.putDeath(node.id)) return;
    const text = `死神出現在${this.cityName(i)}了！小心別停在祂的格子上`;
    this.ticker(i, text, 'news');
    if (this.view() === i) yield { t: 'board' };
    yield { t: 'fx', kind: 'tycoon-notice', p: -1, data: { text, icon: 'death' } };
  }

  /** Price index (02 §1) over the whole world; only ever rises. */
  updatePriceIndex() {
    const living = this.players.filter(p => p.whoPlays !== 0);
    if (living.length) {
      const avg = Math.trunc(living.reduce((s, p) => s + this.wealth(p), 0) / living.length);
      const candidate = Math.trunc(avg / this.fund);
      if (candidate > this.priceIndex) this.priceIndex = candidate;
    }
    for (const c of this.cities) c.priceIndex = this.priceIndex;
  }

  /**
   * Day 15: every city's companies pay their shareholders (03 §6.2, all twelve players); one combined table for the
   * screen (17 §5).
   */
  private *dividends(): Flow {
    const rows: unknown[] = [];
    const pay = this.players.map(() => 0);
    for (const [i, c] of this.cities.entries()) {
      const self = this;
      const flow = (function* (): Flow {
        const inner = c.stocks.dividends();
        let r = inner.next();
        while (!r.done) {
          const s = r.value;
          if (!('ask' in s) && s.t === 'fx' && s.kind === 'dividends') {
            const d = s.data as { rows: { company: string; profit: number; each: number[] }[]; pay: number[] };
            for (const row of d.rows) rows.push({ ...row, city: self.cityName(i) });
            d.pay.forEach((x, k) => { pay[k] += x; });
            r = inner.next(undefined);
            continue;
          }
          r = inner.next((yield s) as Answer);
        }
      })();
      yield* this.onCity(i, flow);
      if (this.over) return;
    }
    this.mask(this.view());
    yield { t: 'fx', kind: 'dividends', data: { rows, pay, world: true } };
    const h = this.human();
    if (h && pay[h.id]) this.ticker(this.view(), `股票分紅：你${pay[h.id] >= 0 ? '得到' : '支付'}${Math.abs(pay[h.id]).toLocaleString('en-US')}元`, 'dividend', h.id);
  }
}

/** A question in a headless city (none should come up: computers do not ask): the safest "no". */
export function autoAnswer(s: Ask): Answer {
  switch (s.t) {
    case 'turn': return { dice: s.maxDice };
    case 'yesno': return false;
    case 'choose': return s.cancellable ? -1 : (s.options.find(o => !o.disabled)?.value ?? s.options[0]?.value ?? 0);
    case 'facility-type': return 1;
    case 'pick-node': case 'pick-city-node': return 0;
    case 'mini-game': return 60;
    case 'slot-machine': case 'wheel': return 39;
    default: return -1;
  }
}

/** Default new-world settings for a human playing `character` (17 §1). */
export function tycoonSettings(character: number, opts: Partial<Omit<TycoonSettings, 'mode' | 'players'>> = {}): TycoonSettings {
  const others = CHARACTERS.map(c => c.id).filter(id => id !== character);
  return {
    mode: 'tycoon', maps: [...TYCOON_MAPS],
    players: [{ character, human: true }, ...others.map(c => ({ character: c, human: false }))],
    fundIndex: opts.fundIndex ?? 1, traffic: opts.traffic ?? 0, landLimitIndex: opts.landLimitIndex ?? 0,
    startDate: opts.startDate ?? 0, seed: opts.seed ?? 1,
  };
}
