/**
 * The rules engine core. Each routine follows a documented original routine (docs/rules, section noted),
 * in the original order. Subsystems live in ./modules and are called at the original moments.
 * Turn flow is a generator: it yields events for the screen and questions for human players.
 */
import { companyOf, facilityOf, landOf, nodeById, type Board, type BoardNode, type Facility, type Land } from './board';
import { CHARACTERS, playerName } from './characters';
import { addDays, addMonths, daysBetween, day as dayOf, nextDay, weekday, type PackedDate } from './date';
import { ask, type Flow } from './flow';
import { Rng, daySeed } from './rng';
import { BlackMarket } from './modules/blackmarket';
import { Forks } from './modules/forks';
import { Cards } from './modules/cards';
import { Events } from './modules/events';
import { Objects } from './modules/objects';
import { Places } from './modules/places';
import { Stocks } from './modules/stocks';
import { Tools, type ToolDef } from './modules/tools';
import { runWheel, WHEEL_AUTO_STOP, WheelKind } from './modules/wheel';
import { SmartAi } from './smart-ai';
import { ledgerOf, observed, type Ledger } from './stats';
import {
  DAY_LIMITS, FUNDS, LAND_LIMIT_MONTHS, VICTORY_MULTIPLES,
  type GameSettings, type Option, type Player, type TurnAnswer,
} from './types';

export type { Flow } from './flow';

/**
 * 大富豪模式 (docs/rules/17): a Game is one city of a World. The world shares one players array between its cities and
 * answers for what spans them (wealth, bankruptcy, travel squares, full hospitals and prisons, the bank operators).
 * A normal game has none of this: `world` is undefined and every rule runs as before.
 */
export interface WorldHooks {
  /** Total assets over every city and the nationwide market (02 §7.1 summed). */
  wealth(p: Player): number;
  /** Bankruptcy in the world (17 §9): properties in every city, the end of the game. */
  bankrupt(p: Player, g: Game): Flow;
  /** A station / airport square stopped at (17 §3: passing does nothing); true when the player left the city. */
  travelSquare(g: Game, p: Player, left: number): Flow<boolean>;
  /** Hospital / prison full (8 places): moves the player to another city's; true when it did (17 §8). */
  overflow(g: Game, p: Player, place: 'hospital' | 'prison', days: number): Flow<boolean>;
  /** Players running a bank in some city (special financing, 02 §8.7, 17 §6). */
  bankOperators(): Player[];
  /** The game whose map a player is on (gods and bombs live in that city's objects). */
  cityOf(p: Player): Game | undefined;
  /** The nationwide stock market screen (17 §5). */
  humanMarket(p: Player, g: Game): Flow;
  /** Every city's engine, in world order. */
  allCities(): Game[];
  /**
   * 飛行卡 / 電車卡 (17 §3.5): the travel dialog with a free ticket from where the player stands; `dest` is the
   * computer's choice (undefined: ask the human). True when the player left.
   */
  travelCard(g: Game, p: Player, via: 'station' | 'airport', dest?: number): Flow<boolean>;
  /** The computer's destination for a travel card, or -1 to keep it. */
  aiCardTrip(g: Game, p: Player, via: 'station' | 'airport'): number;
  /** 遣返卡: `victim` flies to a random other city (17 §3.5); `by` used the card. */
  deport(g: Game, victim: Player, by: Player): Flow<boolean>;
  /** 獨裁卡: who would be sent away, the sending, the computer's wish. */
  dictateVictims(g: Game, p: Player): Player[];
  dictate(g: Game, p: Player): Flow;
  aiDictate(g: Game, p: Player): boolean;
  /** 召集卡: the rivals elsewhere who can be summoned, the summoning, the computer's wish. */
  summonable(g: Game, p: Player): Player[];
  summon(g: Game, p: Player): Flow;
  aiSummon(g: Game, p: Player): boolean;
  /** 通緝卡: the twelve faces (who can be chosen), the arrest, the computer's target (-1 none). */
  wantedOptions(p: Player): Option[];
  wanted(g: Game, p: Player, q: Player): Flow;
  aiWanted(g: Game, p: Player): number;
  /** 通緝卡 is one per city (17 §3.5): a copy bought here / used by p; `syncWanted` sets each city's pool. */
  wantedTaken(g: Game, p: Player): void;
  wantedUsed(p: Player): void;
  syncWanted(): void;
  /** 洲際飛彈 (17 §3.6): the cities and another city's lots to choose from, the strike there, the computer's target. */
  icbmCities(p: Player): Option[];
  icbmTargets(p: Player, city: number): Option[];
  icbm(g: Game, p: Player, city: number, ref: number): Flow;
  /** The road squares of a city (洲際飛彈 picks one on that city's map). */
  cityRoadNodes(city: number): number[];
  aiIcbm(p: Player): number;
  /** 時空機 (17 §3.6): the cities to cross to, the crossing, the computer's city (-1 none). */
  spaceTimeCities(p: Player): Option[];
  spaceTime(g: Game, p: Player, city: number, by?: Player): Flow;
  /** 時空機: the object lying on `node` of g to a random free square of `city`; false when it cannot go there. */
  spaceTimeObject(g: Game, p: Player, node: number, city: number): Flow<boolean>;
  aiSpaceTime(g: Game, p: Player): number;
  /** 城市霸主 (17 §3.8): released the same day instead of a stay in this city's hospital / prison; true when so. */
  overlordRelease(g: Game, p: Player, place: 'hospital' | 'prison'): Flow<boolean>;
  /** The cities a player is 霸主 of (「東京霸主」…). */
  overlordTitles(p: Player): string[];
  /** Hotel income multiplier of a city (沖繩's resort bonus, 17 §2.4; 1 elsewhere). */
  resort(g: Game): number;
  /** A computer aiming at a travel square with the remote dice; true when it used it. */
  aiAim(g: Game, p: Player): Flow<boolean>;
}
export interface WorldLink { index: number; hooks: WorldHooks; players: Player[] }

/**
 * A map's own rules in place of some of the original's (大富翁城, docs/rules/19, core/casino-rules.ts): its finale
 * city in 大富豪模式 (the world link) or the map played in a normal game. Every other map has none.
 */
export interface MapRules {
  /** A stop on a large plot handled by the map (the casinos: buy, build, visit); true when handled. */
  landOnFacility?(g: Game, p: Player, f: Facility): Flow<boolean>;
  /** The facility type an effect builds on an empty plot here (a card or tool: no choice), for 大富翁城's halls. */
  facilityType?(f: Facility): number;
  /**
   * A human's free building on an empty large plot of this map (機器工人, 超級工人, 天使卡, 魔法屋): its own picker
   * (歌舞伎町's five shops, 大富翁城's halls), as the original asks for the facility type there (05 §3.8,
   * fcn_0040b110 → fcn_00440aac). A cancel gives the map's default (`facilityType`).
   */
  pickFacilityType?(g: Game, p: Player, f: Facility): Flow<number>;
  /** 改建卡 on a facility here: the new type (-1 cancelled), the level kept. */
  rebuildFacility?(g: Game, p: Player, f: Facility, human: boolean): Flow<number>;
  /** News / fate entries that do not happen here (skipped like a failed precondition). */
  finaleDeny?(kind: 'news' | 'fate', id: number): boolean;
  /** After the day's settlement of a normal game (the world calls its own). */
  daily?(g: Game): void;
  /** The bank counter is closed (no loans: 大富翁城's finale plays in chips); the ATM stays open. */
  readonly noLoans?: boolean;
  /** A plot's worth in the total assets here (大富翁城's halls: plot + build + token upgrades). */
  facilityWorth?(f: Facility): number;
  /** Gods and objects that may appear here (大富翁城: no 天使 / 小惡魔 / 土地公 / 死神). */
  godAllowed?(type: number): boolean;
  /** Days a god stays here (undefined: the original's). */
  godDays?(type: number): number | undefined;
  /** Gods here have none of their original effects (luck values, attach effects): only the map's own. */
  readonly godsCasinoOnly?: boolean;
  /** What a god does here, said when it attaches (「：必勝」). */
  godNote?(type: number): string;
  /**
   * The cards and tools reworked for this map (大富翁城, docs/rules/19 §3.6): 購地卡 at the hall's worth, 惡魔卡 on all
   * of one owner's halls, 查稅卡 only on hall owners, 漲價卡 on one's own hall; 免費卡 / 嫁禍卡 at the tables.
   */
  readonly casinoItems?: boolean;
  /** Damage of a blast here (飛彈 / 核子飛彈 / 洲際飛彈) on a large plot: Game.damageProperty's mode. */
  blastMode?(nuke: boolean): 0 | 1 | 2;
  /** 工程車 here: Game.damageProperty's mode on the building it stops on. */
  readonly constructionMode?: 0 | 1 | 2;
  /** 機器工人 / 超級工人 here: free levels after the first (undefined: the original's). */
  workerExtra?(tool: number): number;
  /** A stop on any square, before the original's handling (大富翁城's finale: road tax, chip coupons); true when handled. */
  landSquare?(g: Game, p: Player, n: BoardNode): Flow<boolean>;
  /** The computer's remote dice here (the die value, null none); undefined: the original's judgement. */
  aiRemoteDice?(g: Game, p: Player, nodes: number[]): number | null | undefined;

  // ---- 歌舞伎町 (docs/rules/21, core/kabukicho.ts): every hook below is absent on every other map.
  /** Before the dice: true when the player sits this turn out (a shop owner's 「處理事務中」). */
  turnHold?(g: Game, p: Player): Flow<boolean>;
  /** After each step's own handling: the steps left (0 stops the walk). 黑幫's possession and the prison square. */
  step?(g: Game, p: Player, left: number): Flow<number>;
  /** After Game.sendTo moved (or kept) a player in the hospital / prison. */
  afterSend?(g: Game, p: Player, place: 'hospital' | 'prison'): Flow;
  /** The map's own news / fate decks: true when handled (the original decks are not read). */
  news?(g: Game, p: Player): Flow<boolean>;
  fate?(g: Game, p: Player): Flow<boolean>;
  /** The dice of this turn (the exclusive dice tools); undefined: the original's roll. */
  rollDice?(g: Game, p: Player): Flow<number[] | undefined>;
  /** Player p's next node out of fork `at` (after the original's draw gave `next`): a possessed computer avoids the prison. */
  walkNext?(g: Game, p: number, at: number, from: number, next: number): number;
  /** The map's own tools (ids above the original's): definitions, use, the computer's use before the original's. */
  readonly extraTools?: readonly ToolDef[];
  useTool?(g: Game, p: Player, tool: number, param?: number): Flow<boolean>;
  aiTools?(g: Game, p: Player): Flow<boolean>;
  /** A facility type of this map that is a hotel too (歌舞伎町's 情人酒店 13): guests stay as in the original's 旅館. */
  readonly hotelType?: number;
  /** What a staying player is said to be doing instead of 住宿中 (歌舞伎町: a child taken to the amusement park, §3). */
  stayLabel?(g: Game, p: Player): string | undefined;
  /** What a vanished player is said to be doing instead of 消失中 (激情歲月, docs/rules/24 §6: 下鄉中 / 下放中). */
  vanishLabel?(g: Game, p: Player): string | undefined;
  /**
   * The bubble when a god changes a payment (歌舞伎町, docs/rules/21 §2: the reason first, 「大財神附身，消費免付！」);
   * without it the original's 「…免付！」 / 「…改為N元」.
   */
  godFeeText?(g: Game, p: Player, fee: string, total: number, amount: number): string;
  /** This map's own cards, outside the pool (歌舞伎町's 37 保鑣卡, 38 暴走卡): they can be held. */
  readonly ownCards?: readonly number[];
  /** Plays one of `ownCards` that is not passive (暴走卡); false: nothing happened, the card is kept. */
  playCard?(g: Game, p: Player, id: number, human: boolean): Flow<boolean>;
  /** Whether a computer plays one of `ownCards` now. */
  aiPlayCard?(g: Game, p: Player, id: number): boolean;
  /** After a player's turn: true when they take one more whole turn now (暴走卡; no day passes between). */
  extraTurn?(g: Game, p: Player): boolean;
  /** A factor on a street toll (news of the day). */
  tollFactor?(g: Game, land: Land): number;
  /** Someone was moved by a 傳送機 (no landing; the map may still react, the prison square). */
  teleported?(g: Game, q: Player): Flow;
  /**
   * 黑幫 works like a god (docs/rules/21 §4.1): `possessed` counts it as one (the magic house's 「有神附身者」), 送神符
   * sends it away (`sendAway`), 請神符 can call it (`invite`, with the computer's choice `aiInvite` / `aiSendAway`).
   */
  possessed?(p: Player): boolean;
  sendAway?(g: Game, p: Player): Flow<boolean>;
  invite?(g: Game, p: Player, node?: number): Flow<boolean>;
  aiInvite?(g: Game, p: Player): number | null;
  aiSendAway?(g: Game, p: Player): boolean;
  /** The map's own state in a saved game. */
  saveState?(): unknown;
  loadState?(s: unknown): void;
}
/** Map rules of normal games by map id, registered by the map's module (core/casino-rules.ts: 105 大富翁城). */
export const MAP_RULES: Record<number, (g: Game) => MapRules> = {};

/**
 * Data of the `month-report` fx (fcn_00439bfa, docs/rules/09 §7.12): one row per living player in id order with
 * the deposit and interest as shown (before the interest is added; `interest` 0 and `loan` set for 貸款中) and the
 * deposit after; `unlucky` / `champion` index those rows (−1 = no 悲情人物), with the figures the stats board shows.
 * `animation` is RICH4.CFG +1: off, the original skips the first line and both awards.
 */
export interface MonthReport {
  rows: { p: number; character: number; bank: number; loan: boolean; interest: number; after: number }[];
  unlucky: number;
  champion: number;
  animation: boolean;
  unluckyStats: { loss: number; gain: number; badDays: number } | null;
  championStats: { cash: number; bank: number; wealth: number } | null;
}

/** Original 0x80 counter convention (docs/rules/01 §3.2): N days left; 0x80 = expires at the next turn start. */
export function tick(counter: number): number {
  if (counter === 0 || counter === 0x80) return 0;
  const left = (counter & 0x7f) - 1;
  return left <= 0 ? 0x80 : left;
}

/** Facility level caps by type (ref_00474940). */
/**
 * The remake's hotel rules (the user 2026-10-18; docs/rules/02 §4.3, 06 §5.5): a hotel stay takes 免費卡 / 嫁禍卡 like
 * the other facility fees (framed, the other player stays), and 土地公 takes a hotel only at check-out. `on: false`
 * plays the original (the golden test proves that everything else is unchanged).
 */
export const REMAKE_HOTEL = { on: true };

/**
 * The card pool doesn't wrap below 0 (the user 2026-10-18; docs/rules/04 §2.1): the original keeps each card's copies in
 * a byte, so a card handed out when none is left wraps to 255 and then fills the whole 128-slot draw pool (every
 * shelf and draw became 均富卡). `on: false` plays the original's byte (the golden test checks it).
 */
export const REMAKE_CARD_POOL = { on: true };

/**
 * The construction company's free floors on the remake's terms (the user 2026-10-18; docs/rules/02 §5): own large plots
 * can be picked too — an empty one is built first (the facility-type picker, as for 機器工人) — on every map, each type
 * up to its own top, with fireworks whenever the floors top a property out. `on: false` plays the remake's earlier
 * rule (own lots and built facilities of the original types only; fireworks only when the first floor tops it out);
 * the golden test proves that nothing else changed.
 */
export const REMAKE_FREE_BUILD = { on: true };

/**
 * The walk out of the hospital / prison as in the original (GitHub issue #2, 2026-10-22; docs/rules/06 §9.3.1): the one
 * released at the turn start first steps onto the door square, which is resolved (a mine there sends them back), and
 * only then plays the turn. `on: false` is a test hook only: the remake's earlier release (out on the square at the
 * turn start, nothing resolved there), with which the golden test proves that nothing else changed.
 */
export const DOOR_STEP = { on: true };

export const FACILITY_MAX_LEVEL = [1, 5, 5, 1, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5]; // + 5..9 大富翁城's halls (docs/rules/19), 10..13 歌舞伎町's shops (21), 14 激情歲月's 宣傳站 (24), not in the original
/** Walking/scooter/car/construction speed in px per frame (0x4749d8), used for animation length. */
export const SPEED = [8, 12, 16, 8];

export class Game {
  readonly settings: GameSettings;
  readonly board: Board;
  readonly players: Player[];
  readonly rng: Rng;
  /**
   * Mixed into the random streams' seeds after a save is loaded (issue #5: reloading a save rolled exactly the same
   * dice every time — the original reseeds from the clock on loading, rich4_save_files.asm). 0 in a fresh game, so
   * new games, replays and the golden tests are unchanged; kept in the save.
   */
  rngSalt = 0;
  /** The seed the day's random streams derive from: the game seed, salted after a load. */
  rollSeed(): number { return (this.settings.seed ^ this.rngSalt) >>> 0; }
  readonly fund: number;
  readonly stocks: Stocks;
  readonly cards: Cards;
  readonly tools: Tools;
  readonly objects: Objects;
  readonly events: Events;
  readonly places: Places;
  /** 黑市: the remake's addition replacing the trade board (docs/rules/10). */
  readonly blackMarket: BlackMarket;
  /** 岔路箭頭: the remake's arrows at forks and crossroads (docs/rules/14). */
  readonly forks: Forks;
  /** The smarter computer (core/smart-ai.ts): 派對模式, and a normal game's 中級 / 困難 (`aiLevel`). */
  readonly smart: SmartAi;
  date: PackedDate;
  daysElapsed = 0;
  monthsElapsed = 0;
  priceIndex = 1;
  /** Current actor: players 0..n-1, NPCs npcBase..npcBase+3, the robot doll dollId (4..7 and 8 with up to 4 players). */
  current = 0;
  /** Sum of the dice thrown this turn (ref_0048bafc), used by gas stations and some companies. */
  diceTotal = 0;
  lotteryPool = 0;
  /**
   * RICH4.CFG +1 「動畫過程」 (07 §6): when off, nobody plays the mini games and everyone takes the automatic
   * points (06 §7.1). The player's preference, set by the screen; not part of a save.
   */
  animation = true;
  over: { winner: number; code: number } | null = null;
  readonly daysLimit: number;
  readonly victoryTarget: number;

  /** 大富豪模式: this city's index and the world (docs/rules/17); undefined in a normal game. */
  readonly world?: { index: number; hooks: WorldHooks };
  /** The map's own rules (大富翁城, docs/rules/19): the world link's, or a normal game's from MAP_RULES; else none. */
  readonly rules?: MapRules;

  constructor(settings: GameSettings, board: Board, link?: WorldLink) {
    this.settings = settings;
    if (link) this.world = { index: link.index, hooks: link.hooks };
    this.board = structuredClone(board);
    this.rng = new Rng(settings.seed);
    this.fund = FUNDS[settings.fundIndex];
    this.date = settings.startDate;
    this.daysLimit = DAY_LIMITS[settings.daysLimitIndex];
    this.victoryTarget = VICTORY_MULTIPLES[settings.victoryIndex] * this.fund;
    // New game (docs/rules/01 §2.3): humans split the fund in half, computers by their cash ratio.
    this.players = link ? link.players : settings.players.map((s, id): Player => {
      const ch = CHARACTERS[s.character];
      const cash = s.human ? Math.trunc(this.fund / 2) : Math.trunc((ch.cashRatio * this.fund) / 100);
      return {
        id, character: s.character, human: s.human, whoPlays: 0, autopilot: false, bankrupt: false, placed: false,
        node: 0, lastNode: 0, dir: 0, traffic: settings.traffic, dice: settings.traffic + 1,
        cash, bank: this.fund - cash, loan: 0, specialFinance: 0, loanDue: 0, points: 0,
        hotel: 0, vanish: 0, prison: 0, hospital: 0, sleep: 0, sleepwalk: 0, stay: 0, turtle: 0,
        bankRefused: 0, noLoan: 0, allyDays: 0, insurance: 0, god: 0, bomb: 0, ally: 0,
        hostility: new Array(Math.max(4, settings.players.length)).fill(0), monthLoss: 0, monthGain: 0, monthBadDays: 0,
        luckBad: 0, luckMoney: 0, luckFate: 0, facility: 0,
        savedTraffic: 0, savedDice: 0, sleepTraffic: 0, sleepDice: 0,
        tools: new Array(15).fill(0), cards: [],
        ...(s.nick ? { nick: s.nick } : {}),
      };
    });
    this.stocks = new Stocks(this);
    this.cards = new Cards(this);
    this.tools = new Tools(this);
    this.objects = new Objects(this);
    this.events = new Events(this);
    this.places = new Places(this);
    this.blackMarket = new BlackMarket(this);
    this.forks = new Forks(this);
    this.smart = new SmartAi(this);
    this.cards.init();
    this.tools.init();
    this.places.init();
    this.stocks.init();
    this.events.init();
    this.objects.init();
    this.blackMarket.init();
    this.forks.init();
    // 大富翁城 (docs/rules/19): its finale city gets the world link's rules, a normal game on it the map's own.
    this.rules = link ? (link.hooks as unknown as MapRules) : MAP_RULES[settings.mapId]?.(this);
  }

  // ---------------------------------------------------------------- helpers for the modules

  node(id: number): BoardNode { return nodeById(this.board, id); }
  /**
   * The original map slot whose map-specific tables apply (prison fates, their pictures and voices, holiday music).
   * A remake map (id 8..999, e.g. 東京 = 100) is built on an original slot (its records' map_id); workshop maps
   * (id ≥ 1000) keep their own id, which matches no slot.
   */
  get mapSlot(): number { return this.settings.mapId >= 8 && this.settings.mapId < 1000 ? this.board.mapId : this.settings.mapId; }
  name(p: number): string { return playerName(this.players[p]); }
  isHuman(p: Player): boolean { return p.whoPlays === 1 && !p.autopilot; }
  /**
   * Test hook only (never set by the game): the computer's level by seat, in place of the settings'. The simulation
   * (core/ai-sim.ts, scripts/ai-sim.ts, smart-ai.test.ts) pits the levels against each other.
   */
  testLevels?: readonly (0 | 1 | 2)[];
  /**
   * The level a computer-played seat (a computer, a human on 托管, in 派對模式 also a player voted out or dropped) plays
   * at (core/smart-ai.ts): 0 簡單 = the original's rules bit for bit, 1 中級 = the smarter money, buying, building and
   * dice with the original's cards, tools and shop, 2 困難 = the smarter computer in full. A normal game takes
   * `settings.aiLevel` (none: 0, as every game before it); 派對模式 always 2 (the user 2026-10-22); 大富豪模式 always 0.
   * A human playing by hand: 0.
   */
  aiLevel(p: Player): 0 | 1 | 2 {
    if (this.world || this.isHuman(p) || !p.whoPlays) return 0;
    if (this.testLevels) return this.testLevels[p.id] ?? 0;
    return this.settings.party ? 2 : this.settings.aiLevel ?? 0;
  }
  /** 中級 and up: the smarter money, buying, building and dice (core/smart-ai.ts). */
  smartAi(p: Player): boolean { return this.aiLevel(p) >= 1; }
  /** 困難: also the smarter cards, tools, shop and passive cards (core/smart-ai.ts). */
  smartTactics(p: Player): boolean { return this.aiLevel(p) >= 2; }
  /** Not on the road: hotel, vanished, prison or hospital (+50..+53). */
  offRoad(p: Player): boolean { return p.hotel !== 0 || p.vanish !== 0 || p.prison !== 0 || p.hospital !== 0 || !!p.trip; }
  living(): Player[] { return this.players.filter(p => p.whoPlays !== 0); }
  /**
   * Actor ids (01 §0.3): players 0..n-1, the four NPCs from `npcBase` (4 in a normal game, 12 in 大富豪模式), the
   * robot doll at `dollId`.
   */
  get npcBase(): number { return Math.max(4, this.players.length); }
  get dollId(): number { return this.npcBase + 4; }
  isPlayerId(id: number): boolean { return id >= 0 && id < this.players.length; }
  /** In this city (大富豪模式: on its map, its hospital or prison); always true in a normal game. */
  here(p: Player): boolean { return !this.world || p.map === this.world.index; }
  /**
   * The living players this city's rules touch when they say "everyone" (news, fate, cards, magic, NPCs): in a
   * normal game all living players, in 大富豪模式 those in this city (docs/rules/17 §4).
   */
  locals(): Player[] { return this.players.filter(p => p.whoPlays !== 0 && this.here(p)); }
  /** The boards whose properties count as a player's (every city's in 大富豪模式). */
  boards(): Board[] { return this.world ? this.world.hooks.allCities().map(c => c.board) : [this.board]; }
  /** The stock markets of the game (the five cities' in 大富豪模式: one nationwide market, 17 §5). */
  markets(): Stocks[] { return this.world ? this.world.hooks.allCities().map(c => c.stocks) : [this.stocks]; }
  hospitalNode(): BoardNode { return this.board.nodes.find(n => n.ref === 8001) ?? this.board.nodes.find(n => n.event === 5)!; }
  prisonNode(): BoardNode { return this.board.nodes.find(n => n.ref === 8002) ?? this.board.nodes.find(n => n.event === 4)!; }

  /** Total assets (docs/rules/02 §7.1): money minus loans, shares, original (not price-indexed) property values. */
  wealth(p: Player): number {
    if (this.world) return this.world.hooks.wealth(p);
    let w = this.stocks.holdingsValue(p.cash + p.bank - p.loan, p);
    const owner = p.id + 1;
    for (const l of this.board.lands) if (l.owner === owner) w += l.price + (l.chain ? l.perLevel : l.level * l.perLevel);
    for (const f of this.board.facilities) if (f.owner === owner) w += this.rules?.facilityWorth?.(f) ?? f.price + f.level * f.fees[0];
    return w;
  }

  /** Players standing on a node, lowest id first; bankrupt players stay as beggars. */
  occupants(nodeId: number): Player[] {
    return this.players.filter(p => p.placed && !this.offRoad(p) && p.node === nodeId);
  }

  /** 8-way facing (docs/rules/01 §6.3): 0 down, 1 down-right, 2 right … 7 down-left. */
  static direction(dx: number, dy: number): number {
    let angle = Math.round((Math.atan2(-dy, dx) / (2 * Math.PI)) * 65536);
    if (angle < 0) angle += 65536;
    const sector = (((angle >> 12) + 1) >> 1) & 7;
    return (sector + 2) & 7;
  }

  /**
   * Next node fcn_0040c05c (docs/rules/01 §6.2): random among exits except the way in; dead ends turn back.
   * As the original: one rand() per step even with one way out. NPCs walk by this rule (they ignore the arrows).
   */
  nextNode(at: number, from: number): number {
    const n = this.node(at);
    const exits = n.adjacent.filter((a, j) => a && a !== from && !(n.oneWay & (8 >> j)));
    return exits.length ? exits[this.rng.below(exits.length)] : from;
  }

  /**
   * Player `p`'s step (docs/rules/14 §2): out of a fork by the player's own choice there (直走/左轉/右轉), which
   * this step's rand() then draws again; anywhere else the original rule. Same rand() count as the original.
   */
  walkNext(p: number, at: number, from: number): number {
    if (!this.forks.isFork(at)) return this.nextNode(at, from);
    const next = this.forks.pass(p, at, from);
    return this.rules?.walkNext ? this.rules.walkNext(this, p, at, from, next) : next; // 歌舞伎町 (docs/rules/21 §4.1)
  }

  /**
   * A predicted step of player `p`'s route (route predictions fcn_0040b221 / fcn_0040b343, the robot doll of owner
   * `p`): forks by p's choices, which stay as they are; the original's rand() for the step is still drawn.
   */
  peekNext(p: number, at: number, from: number): number {
    if (!this.forks.isFork(at)) return this.nextNode(at, from);
    this.rng.rand();
    return this.forks.follow(p, at, from);
  }

  /** Random free node _rich4_find_random_unoccupied_(distant_)node (docs/rules/01 §6.6). */
  randomFreeNode(near?: BoardNode): BoardNode {
    const taken = new Set([...this.players.filter(q => q.placed).map(q => q.node), ...this.objects.slots.filter(o => o.node).map(o => o.node)]);
    const free = this.board.nodes.filter(n => !n.noDrop && !taken.has(n.id) && n.adjacent.some(Boolean));
    // A small map can have no node 300 px away (大富翁城, docs/rules/19): after many misses the last draw is taken
    // (never reached on the original maps, so their rand() sequence is unchanged).
    for (let tries = 0; ; tries++) {
      const n = free[this.rng.below(free.length)];
      if (!near || Math.abs(n.x - near.x) >= 300 || Math.abs(n.y - near.y) >= 300 || tries >= 2000) return n;
    }
  }

  /** A line in a speech cloud / message box; `log`: the longer line for the log instead (歌舞伎町's short clouds). */
  *say(p: number | undefined, text: string, log?: string): Flow { yield log ? { t: 'say', p, text, log } : { t: 'say', p, text }; }

  /** Hostility _rich4_update_hostility (docs/rules/07 §8). Raising it against one's ally ends the alliance. */
  addHostility(a: number, b: number, delta: number) {
    if (a < 0 || a >= this.players.length || b < 0 || b >= this.players.length || a === b) return;
    const p = this.players[a];
    if (delta < 0 && p.hostility[b] === 0) return;
    p.hostility[b] = Math.max(0, p.hostility[b] + Math.trunc(delta));
    if (delta > 0 && p.ally === b + 1) this.endAlly(p);
  }

  endAlly(p: Player) {
    if (!p.ally) return;
    const q = this.players[p.ally - 1];
    if (q.ally === p.id + 1) { q.ally = 0; q.allyDays = 0; }
    p.ally = 0; p.allyDays = 0;
  }

  // ---------------------------------------------------------------- money

  /**
   * Universal transfer fcn_0041d2c6 (docs/rules/02 §9.1). to: player id, -1 lottery pool, or 100 + company index.
   * flags & 4: take from the bank account first; flags & 1: the receiver gets cash instead of a deposit.
   */
  *transfer(from: number, to: number, amount: number, flags: number, reason: string, quiet = false): Flow<number> {
    if (from >= 100) {
      const c = this.board.companies[from - 101];
      c.fundA -= amount; c.fundB -= amount;
    } else if (from >= 0) {
      const p = this.players[from];
      const first = flags & 4 ? 'bank' : 'cash', second = flags & 4 ? 'cash' : 'bank';
      let need = amount;
      const a = Math.min(p[first], need); p[first] -= a; need -= a;
      const b = Math.min(p[second], need); p[second] -= b; need -= b;
      if (need > 0 && this.canRaise()) { yield* this.raiseCash(p, need); const c = Math.min(p.bank, need); p.bank -= c; need -= c; }
      if (need > 0) {
        amount -= need;
        p.cash = 0; p.bank = 0;
        yield { t: 'pay', from, to, amount, reason, ...(quiet ? { quiet } : {}) };
        yield* this.bankrupt(p);
        this.credit(to, amount, flags);
        return amount;
      }
      p.monthLoss += amount;
    }
    this.credit(to, amount, flags);
    yield { t: 'pay', from, to, amount, reason, ...(quiet ? { quiet } : {}) };
    return amount;
  }

  private credit(to: number, amount: number, flags: number) {
    if (to === -1) this.lotteryPool += amount;
    else if (to >= 100) { const c = this.board.companies[to - 101]; c.fundA += amount; c.fundB += amount; }
    else if (to >= 0) {
      const q = this.players[to];
      if (flags & 1) q.cash += amount; else q.bank += amount;
      q.monthGain += amount;
    }
  }

  /** Money from nowhere fcn_0041d3f4 (docs/rules/02 §9.1): flags & 1 cash, else deposit. */
  gain(p: Player, amount: number, flags: number) {
    if (flags & 1) p.cash += amount; else p.bank += amount;
    p.monthGain += amount;
  }

  /** Forced debit fcn_00433bd8 (docs/rules/02 §8.4): bank first, then cash; bankrupt when both run out. */
  *forcedDebit(p: Player, amount: number): Flow {
    p.bank -= amount;
    if (p.bank < 0) { p.cash += p.bank; p.bank = 0; }
    if (p.cash < 0 && this.canRaise()) { const owe = -p.cash; p.cash = 0; yield* this.raiseCash(p, owe); const c = Math.min(p.bank, owe); p.bank -= c; p.cash = c - owe; }
    if (p.cash < 0) { p.cash = 0; yield* this.bankrupt(p); }
  }

  /** 大富豪模式 outside 大富翁城 (chips there): a player short of money sells before going bankrupt (raiseCash). */
  private canRaise(): boolean { return !!this.world && !this.rules?.noLoans; }

  /**
   * 大富豪模式 (the user 2026-10-19: games ended too soon; the original has no selling before bankruptcy, 02 §9.3): short
   * of `need` for a payment, every share is sold (into the deposit), then lots and facilities in any city go back to
   * the bank at half their value, the cheapest first, until it is covered. Bankruptcy only when nothing is left.
   */
  private *raiseCash(p: Player, need: number): Flow<number> {
    let got = 0;
    for (const m of this.markets()) for (let slot = 0; slot < 12 && got < need; slot++) {
      const n = m.holdings[p.id]?.[slot]?.shares ?? 0;
      if (n > 0) got += m.sell(p, slot, n, true);
    }
    if (got) yield* this.say(p.id, `${this.name(p.id)}資金不足，賣出股票還債（${got.toLocaleString('en-US')}元）`);
    if (got >= need) return got;
    const me = p.id + 1, PI = this.priceIndex;
    const plots = this.boards().flatMap(b => [
      ...b.lands.filter(l => l.owner === me).map(l => ({ o: l as { owner: number; expire: number }, name: l.name, v: Math.trunc((l.price + l.level * l.perLevel) * PI / 2) })),
      ...b.facilities.filter(f => f.owner === me).map(f => ({ o: f as { owner: number; expire: number }, name: f.name, v: Math.trunc((f.price + f.level * (f.fees[0] ?? 0)) * PI / 2) })),
    ]).sort((x, y) => x.v - y.v);
    const sold: string[] = [];
    let money = 0;
    for (const x of plots) {
      if (got >= need) break;
      x.o.owner = 0; x.o.expire = 0;
      p.bank += x.v; got += x.v; money += x.v;
      sold.push(x.name);
    }
    if (sold.length) {
      yield { t: 'board' };
      yield* this.say(p.id, `${this.name(p.id)}資金不足，把${sold.length > 2 ? `${sold.slice(0, 2).join('、')}等${sold.length}處` : sold.join('、')}地產半價賣給銀行（${money.toLocaleString('en-US')}元）`);
    }
    return got;
  }

  /** Insurance payout fcn_0044ba63 (docs/rules/06 §2.3): from the first insurance company into cash. */
  *insurancePayout(p: Player, amount: number): Flow {
    if (!p.insurance || amount <= 0) return;
    const company = this.board.companies.findIndex(c => c.category === 4);
    if (company < 0) return; // bug decision #14: no insurer, no payout (the original reads out of bounds)
    yield* this.say(p.id, `保險期間 得到理賠金 ${amount}元`);
    yield* this.transfer(101 + company, p.id, amount, 1, '理賠金');
  }

  // ---------------------------------------------------------------- shared property helpers

  /** Free upgrade fcn_0040b110 (docs/rules/02 §3.2): returns the new level | 0x80 when topped out, or -1. */
  freeUpgrade(ref: number): number {
    if (ref > 2000 && ref < 4000) {
      const l = this.board.lands[ref - 2001];
      if (l.chain ? l.level >= 1 : l.level >= 5) return -1;
      l.level += 1;
      return l.level | (l.level >= 5 ? 0x80 : 0);
    }
    if (ref > 4000 && ref < 6000) {
      const f = this.board.facilities[ref - 4001];
      if (!f.level || f.level >= FACILITY_MAX_LEVEL[f.type]) return -1;
      f.level += 1;
      return f.level | (f.level >= FACILITY_MAX_LEVEL[f.type] ? 0x80 : 0);
    }
    return -1;
  }

  /**
   * Free building on an empty large plot (fcn_0040b110 at level 0, docs/rules/05 §3.8; 機器工人, the construction
   * company): the facility type first — a human's picker (this map's own on 歌舞伎町 / 大富翁城), a computer's own plot
   * rand() % 4 + 1 (the map's default type here), someone else's type 0 — then level 1. Returns 1, | 0x80 when that
   * is already the type's top.
   */
  *buildEmptyPlot(p: Player, f: Facility): Flow<number> {
    const only = this.isHuman(p) && this.rules?.pickFacilityType ? yield* this.rules.pickFacilityType(this, p, f) : this.rules?.facilityType?.(f);
    f.type = only !== undefined ? only : this.isHuman(p)
      ? Math.max(0, Math.min(4, Number(yield ask({ t: 'facility-type', p: p.id, price: 0 })) || 0))
      : f.owner === p.id + 1 ? (this.smartAi(p) ? this.smart.facilityType() : this.rng.rand() % 4 + 1) : 0;
    f.level = 1;
    return 1 | (f.level >= FACILITY_MAX_LEVEL[f.type] ? 0x80 : 0);
  }

  /**
   * Building damage fcn_0040ab4a (docs/rules/06 §4.4): mode 0 one level down (chain stores and topped-out
   * special buildings to 0, a facility at 0 loses its type), mode 1 back to an ownerless empty lot,
   * mode 2 flattened but owned. A damaged hotel sends its guests out.
   */
  damageProperty(ref: number, mode: 0 | 1 | 2) {
    if (ref > 2000 && ref < 4000) {
      const l = this.board.lands[ref - 2001];
      if (mode === 1) { l.owner = 0; l.level = 0; l.chain = false; l.expire = 0; }
      else if (mode === 2 || l.chain) { l.level = 0; l.chain = false; }
      else if (l.level > 0) l.level -= 1;
    } else if (ref > 4000 && ref < 6000) {
      const f = this.board.facilities[ref - 4001];
      if (mode === 1) { f.owner = 0; f.level = 0; f.type = 0; f.expire = 0; }
      else if (mode === 2) { f.level = 0; f.type = 0; }
      else if (f.level > 0 && --f.level === 0) f.type = 0;
      if (f.level === 0 || (f.type !== 1 && f.type !== this.rules?.hotelType)) for (const p of this.players) if (p.hotel && p.facility === ref - 4000 && this.here(p)) { p.hotel = 0x80; }
    }
  }

  /** Clear hotel/vanish/prison/hospital before a new stay fcn_0040d761. */
  clearStays(p: Player) { p.hotel = 0; p.vanish = 0; p.prison = 0; p.hospital = 0; }

  /**
   * Hospital / prison _rich4_add_player_days_in_hospital|prison (docs/rules/06 §2.4): already inside adds the days,
   * otherwise the player is moved there. Either way: insurance pays days × 2000 × F and bad days add up.
   */
  *sendTo(p: Player, place: 'hospital' | 'prison', days: number): Flow {
    if (!p.whoPlays) return;
    // 大富豪模式: someone in another city goes to that city's hospital / prison; nobody on the way (docs/rules/17 §8).
    if (this.world && !this.here(p)) { const c = this.world.hooks.cityOf(p); if (c && c !== this) yield* c.sendTo(p, place, days); return; }
    if (this.world && (yield* this.world.hooks.overlordRelease(this, p, place))) return; // 城市霸主: out the same day
    // Presentation only (docs/rules/11 §6.1): the victim's line and the ambulance / police car before the move.
    yield { t: 'fx', kind: place === 'hospital' ? 'to-hospital' : 'to-prison', p: p.id, data: { days, fresh: !p[place] } };
    if (p[place]) p[place] = ((p[place] & 0x7f) + days) & 0x7f;
    else if (this.world && (yield* this.world.hooks.overflow(this, p, place, days))) return;
    else {
      this.clearStays(p);
      const n = place === 'hospital' ? this.hospitalNode() : this.prisonNode();
      p.node = n.id; p.lastNode = n.adjacent.find(Boolean) ?? n.id;
      p[place] = days;
      yield { t: 'teleport', p: p.id, node: n.id };
    }
    yield* this.say(p.id, `${this.name(p.id)}${place === 'hospital' ? '住院' : '坐牢'}${days}天`);
    yield* this.insurancePayout(p, days * 2000 * this.priceIndex);
    p.monthBadDays += days;
    if (this.rules?.afterSend) yield* this.rules.afterSend(this, p, place); // 歌舞伎町: 違反暴力團對策法 (docs/rules/21 §4.1)
  }

  /** Trip abroad / alien abduction fcn_0040d375 (docs/rules/06 §2.4). */
  *vanish(p: Player, days: number, alien: boolean): Flow {
    if (!p.whoPlays) return;
    if (p.vanish) p.vanish = (p.vanish & 0x40) | (((p.vanish & 0x3f) + days) & 0x3f);
    else { this.clearStays(p); p.vanish = (alien ? 0x40 : 0) | days; }
    yield { t: 'fx', kind: alien ? 'alien' : 'abroad', p: p.id, data: { days } };
    yield* this.insurancePayout(p, days * 2000 * this.priceIndex);
    p.monthBadDays += days;
  }

  // ---------------------------------------------------------------- main loop

  /**
   * The statistics ledger (core/stats.ts) when the screen attached one: it only watches (events and a few explicit
   * calls), so the game plays the same with or without it. The cities of a world share theirs.
   */
  get stats(): Ledger | undefined { return ledgerOf(this.players); }

  /** Runs the whole game (watched by the ledger when there is one). */
  *run(): Flow {
    const stats = this.stats;
    if (stats) { yield* observed(this.loop(), s => stats.observe(s, this)); return; }
    yield* this.loop();
  }

  private *loop(): Flow {
    while (!this.over) {
      if (this.current < this.npcBase) {
        const p = this.players[this.current];
        yield* this.playerTurn(p);
        // 歌舞伎町's 暴走卡 (docs/rules/21 §7.5): another whole turn at once, the day not ended in between.
        while (!this.over && p.whoPlays && this.rules?.extraTurn?.(this, p)) yield* this.playerTurn(p);
      } else yield* this.places.npcTurn(this.current);
      if (this.over) break;
      yield* this.endTurn();
    }
  }

  /** End of turn and rotation fcn_00418ebd (docs/rules/01 §3.1): players, then active NPCs 4..7, then a new day. */
  private *endTurn(): Flow {
    let newDay = false;
    for (;;) {
      this.current += 1;
      // npcBase is 4 up to four players (the original's 4..7); 派對模式 with five to eight has the NPCs after them.
      const base = this.npcBase;
      if (this.current === this.players.length && this.current < base) this.current = base;
      if (this.current >= base + 4) { this.current = 0; newDay = true; }
      if (this.current >= base) { if (this.places.npcActive(this.current)) break; continue; }
      if (this.players[this.current].bankrupt) continue;
      break;
    }
    if (newDay) yield* this.dailySettlement();
    if (this.over) return;
    if (this.current < this.npcBase) yield* this.turnStart(this.players[this.current]);
  }

  /** Daily settlement fcn_0041cf67 (docs/rules/01 §4.2). */
  *dailySettlement(): Flow {
    const { date, newMonth } = nextDay(this.date);
    this.date = date;
    this.daysElapsed += 1;
    this.stats?.newDay(this.players, p => this.wealth(p), [this.board], this.daysElapsed);
    yield { t: 'day', date, newMonth };
    yield* this.checkVictory();
    if (this.over) return;
    this.rules?.daily?.(this); // 大富翁城 (docs/rules/19): no stock market, nothing denied on sale
    this.updatePriceIndex();
    // The original reseeds from the clock here; the remake derives the seed from the game seed and day.
    this.rng.reseed(daySeed(this.rollSeed(), this.daysElapsed));
    yield* this.stocks.daily();
    if (dayOf(this.date) === 15) {
      yield* this.stocks.dividends();
      yield* this.places.lotteryDraw();
    }
    if (newMonth) {
      // Monthly bank settlement fcn_00439bfa (docs/rules/02 §8.5): 10% on deposits for players without a loan.
      // Special-financing money sits in the deposit and earns it too (bug decision #13: kept as in the original).
      // The original shows its report screen here (09 §7.12): the figures are taken before and after the interest.
      const rows = this.living().map(p => ({ p: p.id, character: p.character, bank: p.bank, loan: p.loan !== 0, interest: p.loan ? 0 : Math.trunc(p.bank * 0.1) }));
      for (const p of this.players) if (p.whoPlays && p.loan === 0) p.bank = Math.trunc(p.bank * 1.1);
      yield { t: 'fx', kind: 'month-report', data: this.monthReport(rows) as unknown as Record<string, unknown> };
      for (const p of this.players) { p.monthLoss = 0; p.monthGain = 0; p.monthBadDays = 0; }
      yield* this.objects.monthly();
      yield* this.blackMarket.monthly();
      this.monthsElapsed += 1;
    }
    for (const l of [...this.board.lands, ...this.board.facilities]) {
      if (l.tmpState >> 4) l.tmpState = (l.tmpState >> 4) - 1 ? l.tmpState - 0x10 : 0;
      // Per the bug decision #12 the expiry triggers on or after the date instead of only on it.
      if (l.expire && daysBetween(l.expire, this.date) >= 0) { l.owner = 0; l.expire = 0; }
    }
    yield { t: 'board' };
  }

  /**
   * The month report's picks (fcn_00439bfa state 2, docs/rules/02 §8.5): 本月悲情人物 fcn_00437d1a and 本月冠軍
   * fcn_00437dfe over the living players in id order, after the interest and before the monthly counters are cleared.
   */
  monthReport(rows: Omit<MonthReport['rows'][number], 'after'>[]): MonthReport {
    const list = rows.map(r => this.players[r.p]);
    // Bad luck score: loss − windfall + bad days × PI × 2500 + bad-luck value × 10 (32-bit, as the original).
    const score = list.map(p => ((p.monthLoss - p.monthGain) + Math.imul(Math.imul(p.monthBadDays & 0xff, this.priceIndex), 2500) + Math.imul(p.luckBad, 10)) | 0);
    let top = 0, at = 0;
    score.forEach((v, i) => { if (v > top) { top = v; at = i; } });
    // Everyone tied with the top drops out of the runner-up; named only when someone else scored and the lead is > 40%.
    const second = score.reduce((m, v) => (v !== top && v > m ? v : m), 0);
    const unlucky = top !== 0 && second !== 0 && (top - second) / top > 0.4 ? at : -1;
    let best = 0, champion = 0;
    list.forEach((p, i) => { const w = this.wealth(p); if (w > best) { best = w; champion = i; } });
    const u = list[unlucky], c = list[champion];
    return {
      rows: rows.map(r => ({ ...r, after: this.players[r.p].bank })),
      unlucky, champion, animation: this.animation,
      unluckyStats: u ? { loss: u.monthLoss, gain: u.monthGain, badDays: u.monthBadDays & 0xff } : null,
      championStats: c ? { cash: c.cash, bank: c.bank, wealth: this.wealth(c) } : null,
    };
  }

  /** Price index _rich4_update_price_index (docs/rules/02 §1): only ever rises. */
  updatePriceIndex() {
    const living = this.living();
    if (!living.length) return;
    const avg = Math.trunc(living.reduce((s, p) => s + this.wealth(p), 0) / living.length);
    const candidate = Math.trunc(avg / this.fund);
    if (candidate > this.priceIndex) this.priceIndex = candidate;
  }

  /** Daily victory check fcn_0041d89e (docs/rules/01 §8.1). */
  private *checkVictory(): Flow {
    if (!this.daysLimit && !this.victoryTarget) return;
    let best: Player | null = null, bestWealth = 0;
    for (const p of this.living()) {
      const w = this.wealth(p);
      if (!best || w > bestWealth) { best = p; bestWealth = w; }
    }
    if (!best) return;
    const timeUp = this.daysLimit && bestWealth !== 0 && this.daysElapsed >= this.daysLimit;
    const rich = this.victoryTarget && bestWealth >= this.victoryTarget;
    if (timeUp || rich) yield* this.finish(best.id);
  }

  private *finish(winner: number): Flow {
    for (const p of this.players) if (p.id !== winner) p.whoPlays = 0;
    const humans = this.players.filter(p => p.human).length;
    const humanWon = this.players[winner]?.human ?? false;
    const code = humans === 1 ? (humanWon ? 2 : 1) : humanWon ? 3 : 1;
    this.over = { winner, code };
    yield { t: 'gameover', winner, code };
  }

  /** Turn start fcn_0041c84f (docs/rules/01 §3.2) with the loan due check fcn_00436a5a (02 §8.4). */
  *turnStart(p: Player): Flow {
    this.stocks.turnStart(p);
    if (!p.whoPlays) return;
    if (p.loanDue) {
      const d = daysBetween(this.date, p.loanDue);
      if (d >= 1 && d <= 3 && this.isHuman(p)) yield* this.say(p.id, d === 3 ? '您向銀行借貸的貸款即將到期，請不要忘記喔！' : `距貸款到期日還剩${d}天！`);
      if (d <= 0 && this.world && !p.loanRenewed && p.cash + p.bank < p.loan) {
        // 大富豪模式 (the user 2026-10-19: loans ended too many games): short at the due date, the bank puts it off once,
        // 30 days, the loan 10% more; then it is collected as in the original.
        p.loan = Math.trunc(p.loan * 1.1);
        p.loanDue = addDays(this.date, 30);
        p.loanRenewed = true;
        yield* this.say(p.id, '貸款到期，存款不足：銀行同意展期30天（加收10%）');
      } else if (d <= 0) {
        yield* this.say(p.id, '貸款到期日強制執行！');
        yield* this.forcedDebit(p, p.loan);
        p.loan = 0; p.loanDue = 0;
        if (this.world) p.loanRenewed = undefined;
        if (!p.whoPlays) return;
      }
    }
    if (p.hotel === 0x80) { p.hotel = 0; yield { t: 'fx', kind: 'leave-hotel', p: p.id }; yield* this.checkOut(p); } else p.hotel = tick(p.hotel);
    if (p.vanish & 0x80) { const alien = (p.vanish & 0x40) !== 0; p.vanish = 0; yield { t: 'fx', kind: 'reappear', p: p.id, data: { alien } }; }
    else if (p.vanish) { p.vanish = ((p.vanish & 0x3f) - 1) ? p.vanish - 1 : p.vanish | 0x80; }
    if (p.prison === 0x80) yield* this.release(p, 'prison'); else p.prison = tick(p.prison);
    if (p.hospital === 0x80) yield* this.release(p, 'hospital'); else p.hospital = tick(p.hospital);
    if (!this.offRoad(p)) {
      if (p.sleep === 0x80) p.sleep = 0;
      if (p.sleepwalk === 0x80) {
        p.sleepwalk = 0;
        const own = p.sleepTraffic === 1 ? p.tools[4] : p.sleepTraffic === 2 ? p.tools[5] : 1;
        if (p.sleepTraffic && own) { p.tools[p.sleepTraffic + 3] -= 1; p.traffic = p.sleepTraffic; p.dice = p.sleepDice; }
        else { p.traffic = 0; p.dice = 1; }
      }
      if (p.turtle === 0x80) p.turtle = 0;
    }
    if (p.stay === 0x80) p.stay = 0;
    if (p.bankRefused === 0x80) p.bankRefused = 0;
    if (p.noLoan === 0x80) p.noLoan = 0;
    if (p.insurance === 0x80) p.insurance = 0;
    if (p.allyDays === 0x80) this.endAlly(p);
    if (!this.offRoad(p)) { p.sleep = tick(p.sleep); p.sleepwalk = tick(p.sleepwalk); p.turtle = tick(p.turtle); }
    p.stay = tick(p.stay);
    p.bankRefused = tick(p.bankRefused);
    p.noLoan = tick(p.noLoan);
    if (p.allyDays) {
      this.addHostility(p.id, p.ally - 1, -20 * this.priceIndex);
      this.addHostility(p.ally - 1, p.id, -20 * this.priceIndex);
      p.allyDays = tick(p.allyDays);
    }
    p.insurance = tick(p.insurance);
    yield* this.objects.turnStart(p);
    yield* this.tools.turnStart(p);
    // Labs owned by this player count down and deliver their tool (01 §3.2 step 13).
    for (const f of this.board.facilities) {
      if (f.type === 4 && f.owner === p.id + 1 && f.labDays) {
        f.labDays -= 1;
        if (!f.labDays) yield* this.tools.labDone(p, this.tools.labToolId(f.labTool));
      }
    }
  }

  /**
   * A hospital / prison stay ends at the turn start: _rich4_release_player_from_hospital|prison → fcn_0040d6be
   * (hospital_utils.asm:202-213, player_utils.asm:469-508) only sets who_plays 0x10 and faces the door square; the
   * byte stays 0x80 (so the rest of this turn start counts no sleep / sleepwalk / turtle, core_actions.asm:4199) until
   * the walk out at the dispatch (walkOut, docs/rules/06 §9.3.1).
   */
  private *release(p: Player, place: 'hospital' | 'prison'): Flow {
    if (!DOOR_STEP.on) { p[place] = 0; yield { t: 'fx', kind: place === 'hospital' ? 'leave-hospital' : 'leave-prison', p: p.id }; return; }
    p.leaving = place;
  }

  /**
   * The walk out (docs/rules/06 §9.3.1): fcn_0040c912 sees 0x10 and calls fcn_0040dd1f (rich4.asm:6584-6587), one step
   * with no dice from the building onto the door square p.node (fcn_0040c05c 0x10 branch, rich4.asm:5929-5941; the
   * stay bytes +50..+53 are cleared on the way, rich4.asm:6142-6146). That step is handled as the last step of a walk
   * (R = 0, _rich4_player_move_one_step_done): beggar, the carried bomb, the object on the square (mine, roadblock,
   * dog, gift, chest, time bomb, gods). There is no stop event (fcn_00418e7f: fcn_0040c912(1) is 0 with 0x30). The end
   * of that walk (fcn_00418ebd, rich4.asm:11729-11764) runs fcn_0040f381 and fcn_00448a7e on the square, clears 0x30
   * and gives the same player the turn again — unless the square sent them back in (admission clears 0x30,
   * hospital_utils.asm:66), which ends the turn.
   */
  private *walkOut(p: Player): Flow {
    const place = p.leaving!;
    delete p.leaving;
    this.clearStays(p);
    yield { t: 'fx', kind: place === 'hospital' ? 'leave-hospital' : 'leave-prison', p: p.id };
    yield* this.stepDone(p, 0);
    if (!p.whoPlays || this.over || this.offRoad(p)) return;
    yield* this.objects.landEffect(p); // fcn_0040f381 (rich4.asm:11750): nothing on a hospital / prison square
    yield* this.tools.construction(p); // fcn_00448a7e (rich4.asm:11758): likewise
  }

  // ---------------------------------------------------------------- one turn

  /** Dispatch fcn_00418c55 (docs/rules/01 §3.3-§3.5). */
  *playerTurn(p: Player): Flow {
    if (p.bankrupt) return;
    yield { t: 'turn', p: p.id };
    // 派對模式: 取消托管 is an answer, so every phone takes it at the same point (the user 2026-10-19).
    if (this.settings.party && p.whoPlays === 1 && p.autopilot && (yield ask({ t: 'auto-turn', p: p.id })) === 1) p.autopilot = false; // 1 = 取消托管
    if (!p.placed) yield* this.airdrop(p);
    if (p.leaving) {
      // Out of the hospital / prison: the door square first; sent back in by it, the turn is over (06 §9.3.1).
      yield* this.walkOut(p);
      if (this.over || !p.whoPlays || this.offRoad(p) || (this.world && !this.here(p))) return;
    }
    if (this.offRoad(p) || p.sleep) {
      const [what, n] = p.hotel ? [this.rules?.stayLabel?.(this, p) ?? '住宿中', p.hotel] : p.prison ? ['坐牢中', p.prison] : p.hospital ? ['住院中', p.hospital] : p.sleep ? ['冬眠中', p.sleep] : [this.rules?.vanishLabel?.(this, p) ?? '消失中', p.vanish & 0x3f];
      this.tools.storeState(p);
      yield* this.say(p.id, `${this.name(p.id)}${what}……還剩${(n & 0x7f) + 1}天！`);
      return;
    }
    if (p.sleepwalk) { yield* this.depart(p); return; }
    if (this.rules?.turnHold && (yield* this.rules.turnHold(this, p))) return; // 歌舞伎町: 處理事務中 (docs/rules/21 §2.2)
    let human = this.isHuman(p);
    if (human) {
      for (;;) {
        const maxDice = p.traffic === 3 ? 1 : p.traffic + 1;
        const a = (yield ask({ t: 'turn', p: p.id, maxDice, canUseCard: p.cards.length > 0, canUseTool: p.tools.some(Boolean) })) as TurnAnswer | undefined;
        if (!a || 'dice' in a) { if (a?.dice) p.dice = Math.max(1, Math.min(maxDice, a.dice)); break; }
        if (a.action === 'card') yield* this.cards.humanUse(p);
        else if (a.action === 'tool') yield* this.tools.humanUse(p);
        // Leaving the stock screen or the trade board checks for a new bank operator (rich4_ui_stock.asm:3043,
        // rich4_ui_sale.asm:5627).
        else if (a.action === 'stock') { yield* this.stocks.humanMarket(p); if (!this.over) yield* this.financeRecall(); }
        else if (a.action === 'trade') { yield* this.blackMarket.humanMarket(p); if (!this.over) yield* this.financeRecall(); }
        else if (a.action === 'surrender') { yield* this.surrender(p); return; }
        else if (a.action === 'autopilot') { p.autopilot = true; break; } // 托管: the computer plays from here
        if (this.over || !p.whoPlays) return;
        if (this.world && !this.here(p)) return; // 大富豪模式: gone to another city (時空機, 17 §3.6)
        const pending = this.tools.pending;
        this.tools.pending = 'none';
        if (pending === 'land') { yield* this.land(p); return; }
        if (pending === 'depart') break;
        if (this.offRoad(p) || p.sleep || p.sleepwalk) return;
        // A stay card on oneself only sets +0x38 = 0x80: the turn stays open (other cards and tools can still be
        // used) and GO shows its stopped face; pressing GO then stays in place (rich4_card_tingliuka.asm, fcn_0040dd1f).
      }
      human = this.isHuman(p);
    }
    if (!human && this.smartAi(p)) {
      // The smarter computer (派對模式, 中級 / 困難; core/smart-ai.ts): its own stock, card and tool play, then its dice.
      yield* this.smart.beforeDice(p);
      if (this.over || !p.whoPlays || this.offRoad(p) || p.sleep || p.sleepwalk) return;
      const pending = this.tools.pending;
      this.tools.pending = 'none';
      if (pending === 'land') { yield* this.land(p); return; }
      if (pending !== 'depart') this.smart.chooseDice(p);
    } else if (!human) {
      // Computer turn (01 §3.5): stocks, then a card or a tool, then dice.
      yield* this.stocks.aiTrade(p);
      if (this.over) return;
      yield* this.financeRecall(); // rich4.asm:11632, right after the computer's buying and selling
      if (this.over) return;
      // Where the original runs the trade board for computers; the black market uses its own random stream.
      yield* this.blackMarket.aiTurn(p);
      if (this.over) return;
      // 大富豪模式 (docs/rules/17 §3.4): a computer that wants to travel may aim at the station / airport with the
      // remote dice first (world only; a normal game draws its rand() here as before).
      if (this.world && (yield* this.world.hooks.aiAim(this, p))) { /* the remote dice is set */ }
      else if (this.rng.rand() & 1) yield* this.cards.aiUse(p); else yield* this.tools.aiUse(p);
      if (this.over || !p.whoPlays || this.offRoad(p) || p.sleep || p.sleepwalk || (this.world && !this.here(p))) return;
      const pending = this.tools.pending;
      this.tools.pending = 'none';
      if (pending === 'land') { yield* this.land(p); return; }
      // The remote dice fixes the roll, so the dice-count choice (and its rand call) is skipped.
      if (pending !== 'depart') this.aiChooseDice(p);
    }
    yield* this.depart(p);
  }

  /** First landing fcn_0040829d (docs/rules/01 §2.5): a random free node and a random neighbour as the way in. */
  private *airdrop(p: Player): Flow {
    const node = this.randomFreeNode();
    const ways = node.adjacent.filter(Boolean);
    p.node = node.id;
    p.lastNode = ways[this.rng.below(ways.length)];
    const from = this.node(p.lastNode);
    p.dir = Game.direction(node.x - from.x, node.y - from.y);
    p.placed = true;
    p.whoPlays = p.human ? 1 : 2;
    yield { t: 'airdrop', p: p.id, node: node.id };
  }

  /** AI dice choice fcn_004221c0 (docs/rules/01 §5.3), predicting five nodes ahead (fcn_0040b221). */
  private aiChooseDice(p: Player) {
    const vehicle = p.traffic & 3;
    if (vehicle !== 1 && vehicle !== 2) return;
    const bomb = p.bomb ? this.objects.slots[p.bomb - 1]?.life ?? 0 : 0;
    if (p.bomb) { p.dice = bomb < 15 ? 1 : vehicle === 2 ? 3 : 2; return; }
    let at = p.node, from = p.lastNode, good = 0, bad = 0;
    for (let i = 0; i < 5; i++) {
      const next = this.peekNext(p.id, at, from);
      from = at; at = next;
      const n = this.node(at), land = landOf(this.board, n), fac = facilityOf(this.board, n);
      const owner = land ? land.owner : fac ? fac.owner : -1;
      if (owner === 0 || owner === p.id + 1) good++; else if (owner > 0) bad++;
    }
    if (vehicle === 2) {
      p.dice = 3;
      if (good === 0 && bad > 2) p.dice = 2 + (this.rng.rand() & 1);
      else if (good >= 2 && bad <= 1) p.dice = 1;
    } else {
      p.dice = 2;
      if (good >= 2 && bad <= 1) p.dice = 1;
    }
  }

  /** Departure fcn_0040dd1f and the movement state machine (docs/rules/01 §3.6-§3.7, §5.1, §6, §7). */
  private *depart(p: Player): Flow {
    this.tools.storeState(p);
    if (p.stay) { yield* this.land(p); return; }
    let steps: number;
    if (p.turtle) steps = 1;
    else {
      const forced = this.tools.remoteDice;
      this.tools.remoteDice = 0;
      const own = !forced && this.rules?.rollDice ? yield* this.rules.rollDice(this, p) : undefined; // 歌舞伎町's dice tools
      const values = forced ? [forced] : own ?? Array.from({ length: p.dice }, () => this.rng.rand() % 6 + 1);
      yield { t: 'dice', p: p.id, values };
      steps = values.reduce((a, b) => a + b, 0);
    }
    this.diceTotal = steps;
    while (steps > 0) {
      const next = this.walkNext(p.id, p.node, p.lastNode);
      const from = this.node(p.node), to = this.node(next);
      p.lastNode = p.node; p.node = next;
      p.dir = Game.direction(to.x - from.x, to.y - from.y);
      steps -= 1;
      yield { t: 'step', p: p.id, from: from.id, to: to.id, dir: p.dir, left: steps };
      steps = yield* this.stepDone(p, steps);
      if (!p.whoPlays || this.over || this.offRoad(p)) return;
    }
    yield* this.land(p);
  }

  /** Per-step handling _rich4_player_move_one_step_done (docs/rules/01 §7.1). Returns the remaining steps. */
  private *stepDone(p: Player, left: number): Flow<number> {
    const n = this.node(p.node);
    if (n.event === 14 && !p.sleepwalk && left !== 0 && this.objects.at(n.id)?.type !== 16) {
      yield* this.atm(p);
      if (this.over) return 0;
    }
    const other = this.players.find(q => q.id !== p.id && q.placed && q.node === n.id && !this.offRoad(q));
    if (other && other.bankrupt && left === 0) {
      const alms = 1000 * this.priceIndex;
      yield* this.say(p.id, `施捨給乞丐${alms}元`);
      yield* this.transfer(p.id, -1, alms, 0, '施捨');
      const to = this.randomFreeNode(n);
      other.node = to.id;
      yield { t: 'teleport', p: other.id, node: to.id };
      if (!p.whoPlays) return 0;
    }
    const rest = yield* this.objects.step(p, left);
    return this.rules?.step ? yield* this.rules.step(this, p, rest) : rest; // 歌舞伎町: 黑幫 (docs/rules/21 §4.1)
  }

  // ---------------------------------------------------------------- stopping

  /**
   * Stop event dispatch _rich4_handle_player_land_on_node (docs/rules/01 §7.2, 02 §2, 06 §1). Public for a map's
   * forced arrivals that count as a stop (歌舞伎町's 拉客仔 and its fate moves: the square, then the gods' effect).
   */
  *land(p: Player): Flow {
    const n = this.node(p.node);
    this.checkedIn = false;
    if (p.sleepwalk && n.event !== 0) return;
    if (this.rules?.landSquare && (yield* this.rules.landSquare(this, p, n))) return; // 大富翁城 (docs/rules/19 §4.4)
    switch (n.event) {
      case 0:
        yield* this.landOnProperty(p, n);
        if (!p.whoPlays || this.over) return;
        yield* this.objects.landEffect(p);
        yield* this.tools.construction(p);
        { const f = facilityOf(this.board, n);
          if (f && f.owner === p.id + 1 && f.type === 4 && f.level >= 1 && !(f.tmpState & 0xf) && !p.sleepwalk) yield* this.tools.labStop(p, f.id); }
        break;
      case 2: yield* this.events.news(p); break;
      case 3: yield* this.events.fate(p); break;
      case 4: yield* this.places.prisonStop(p); break;
      case 5: yield* this.places.hospitalStop(p); break;
      case 6: case 7: case 8: yield* this.places.miniGame(p, n.event); break;
      case 9: yield* this.places.lotteryStop(p); break;
      case 10: case 11: case 12: {
        const amount = n.event === 10 ? 50 : n.event === 11 ? 30 : 10;
        p.points = (p.points + amount) & 0xffff;
        yield { t: 'points', p: p.id, amount };
        break;
      }
      case 13: {
        const id = yield* this.cards.receiveRandom(p);
        if (id) yield { t: 'fx', kind: 'card-received', p: p.id, data: { card: id } };
        break;
      }
      case 14: yield* this.atm(p); if (!this.over && p.whoPlays) yield* this.bankCounter(p); break;
      case 15: yield* this.tools.shop(p); break;
      case 16: yield* this.places.magicHouse(p); break;
      case 17: case 18: if (this.world) yield* this.world.hooks.travelSquare(this, p, 0); break;
    }
  }

  private *landOnProperty(p: Player, n: BoardNode): Flow {
    const land = landOf(this.board, n), fac = facilityOf(this.board, n), company = companyOf(this.board, n);
    if (land) yield* this.landOnLot(p, land);
    else if (fac) yield* this.landOnFacility(p, fac);
    else if (company) yield* this.stocks.landOnCompany(p, company);
  }

  private landLimit(): number { return LAND_LIMIT_MONTHS[this.settings.landLimitIndex]; }

  /** Ordinary land: buy, build, or pay the street toll (docs/rules/02 §3). */
  *landOnLot(p: Player, land: Land): Flow {
    const me = p.id + 1, god = this.objects.godType(p);
    if (land.owner === 0) {
      if (p.sleepwalk || god === 12) return;
      const price = (land.price + land.level * land.perLevel) * this.priceIndex;
      if (price > p.cash) { if (this.isHuman(p)) yield* this.say(p.id, '您的現金不足！'); return; }
      const yes = this.isHuman(p)
        ? (yield ask({ t: 'yesno', p: p.id, kind: 'buy-land', text: `${land.name}\n\n費用:${price}元\n\n是否買下此地？`, price })) as boolean
        : this.smartAi(p) ? this.smart.wantsToBuy(p, price, land) : this.aiCanAfford(p, price);
      if (!yes) return;
      if (yield* this.investmentBlocked(p)) return;
      land.owner = me;
      if (this.landLimit()) land.expire = addMonths(this.date, this.landLimit());
      p.cash -= price;
      yield { t: 'buy', p: p.id, kind: 'land', id: land.id, price };
      yield* this.blessing(p, land.id + 2000);
      return;
    }
    if (land.owner === me) {
      if (land.level >= 5 || land.chain || p.sleepwalk) return;
      const cost = land.perLevel * this.priceIndex;
      if (cost > p.cash) { if (this.isHuman(p)) yield* this.say(p.id, '您的現金不足！'); return; }
      const yes = this.isHuman(p)
        ? (yield ask({ t: 'yesno', p: p.id, kind: 'upgrade-land', text: `${land.name}\n\n升級費用:${cost}元\n\n是否升級？`, price: cost })) as boolean
        : this.smartAi(p) ? this.smart.wantsToBuild(p, cost) : true; // computers always build when they have the cash
      if (!yes) return;
      if (yield* this.investmentBlocked(p)) return;
      p.cash -= cost;
      land.level += 1;
      yield { t: 'build', p: p.id, kind: 'land', id: land.id, level: land.level, cost };
      yield* this.blessing(p, land.id + 2000);
      return;
    }
    yield* this.payToll(p, land);
  }

  /** Street toll (docs/rules/02 §3.3): one owner's lots sharing the street name add up; chain stores count 2000 each. */
  calcToll(ownerPlus1: number, name: string | null): number {
    let sum = 0;
    for (const l of this.board.lands) {
      if (l.owner !== ownerPlus1) continue;
      if (name === null) { if (l.chain) sum += 2000; } else if (!l.chain && l.name === name) sum += l.tolls[l.level];
    }
    return sum * this.priceIndex;
  }

  private *payToll(p: Player, land: Land): Flow {
    const owner = this.players[land.owner - 1];
    if (!(yield* this.ownerCollects(owner, land.tmpState, '過路費'))) return;
    let base = this.calcToll(land.owner, land.chain ? null : land.name);
    const allyPart = owner.ally ? this.calcToll(owner.ally, land.chain ? null : land.name) : 0;
    if (land.tmpState) base *= 2;
    if (this.rules?.tollFactor) base = Math.round(base * this.rules.tollFactor(this, land)); // 歌舞伎町 (docs/rules/21 §6, §7.5)
    const total = base + allyPart;
    // The owner's (and ally's) lots of this street, or all their chain stores, flash first when there is more
    // than one, to show the toll is the whole street's (rich4_player_core_actions.asm:550-661, fcn_00451985).
    const linked = this.board.lands.filter(l => (l.owner === land.owner || (owner.ally > 0 && l.owner === owner.ally))
      && (land.chain ? l.chain : !l.chain && l.name === land.name)).map(l => l.id + 2000);
    if (linked.length > 1) yield { t: 'fx', kind: 'toll-street', p: p.id, data: { refs: linked } };
    // A message box naming the owner (the original shows 「請付%d元」; the remake says whose land it is).
    yield* this.say(undefined, `這塊地屬於${this.name(owner.id)}\n請付過路費${total}元`);
    const paid = yield* this.collect(p, owner, total, '過路費', true);
    if (paid === null) return;
    if (owner.ally && total) {
      const allyShare = Math.trunc((paid.amount * allyPart) / total);
      yield* this.transfer(paid.payer, land.owner - 1, paid.amount - allyShare, 0, '過路費');
      yield* this.transfer(paid.payer, owner.ally - 1, allyShare, 0, '過路費');
    } else {
      yield* this.transfer(paid.payer, land.owner - 1, paid.amount, 0, '過路費');
    }
    land.lastToll = paid.amount;
  }

  /**
   * The payment chain shared by tolls and fees (docs/rules/02 §3.7): payer's god, hostility, passive cards,
   * Death/treasure chest paying instead, and nobody pays oneself or one's ally. Returns null when nothing is paid.
   */
  *collect(p: Player, owner: Player, total: number, fee: string, cardsAllowed: boolean): Flow<{ payer: number; amount: number } | null> {
    let amount = this.godModify(p, total);
    if (amount !== total) yield* this.say(p.id, this.rules?.godFeeText?.(this, p, fee, total, amount) ?? (amount === 0 ? `${fee}免付！` : `${fee}改為${amount}元`));
    if (amount === 0) return null;
    this.addHostility(p.id, owner.id, Math.trunc(amount / 100));
    let payer = p.id;
    if (cardsAllowed) {
      const r = yield* this.cards.tollPassive(p, owner.id, amount);
      payer = r.payer; amount = r.amount;
      if (amount === 0) return null;
    }
    const death = this.objects.deathPayer(this.players[payer]);
    if (death !== null) { yield* this.say(undefined, `死神顯靈\n\n由${this.name(death)}賠償${fee}`); payer = death; }
    if (payer === owner.id || payer === owner.ally - 1) return null;
    return { payer, amount };
  }

  /** Owner exemptions _rich4_check_pay_toll_to_owner (docs/rules/02 §3.4). Returns true when the fee is due. */
  *ownerCollects(owner: Player, tmpState: number, fee: string): Flow<boolean> {
    const name = this.name(owner.id);
    const reason =
      tmpState >> 4 && tmpState & 0xf ? `房屋查封中，免收${fee}！`
      : owner.ally === this.current + 1 ? `與${name}同盟中，免收${fee}！`
      : this.objects.godType(owner) === 15 ? `死神顯靈，免收${fee}！`
      : owner.hotel ? `${name}住宿中，免收${fee}！`
      : owner.vanish ? `${name}消失中，免收${fee}！`
      : owner.prison ? `${name}坐牢中，免收${fee}！`
      : owner.hospital ? `${name}住院中，免收${fee}！`
      : owner.sleep ? `${name}冬眠中，免收${fee}！`
      : owner.sleepwalk ? `${name}夢遊中，免收${fee}！`
      : null;
    if (reason) { yield* this.say(undefined, reason); return false; }
    return true;
  }

  /** Payer's god fcn_0041d709 (docs/rules/02 §3.5). */
  godModify(p: Player, amount: number): number {
    switch (this.objects.godType(p)) {
      case 1: return amount >> 1;
      case 2: return 0;
      case 5: return amount + (amount >> 1);
      case 6: return amount * 2;
      default: return amount;
    }
  }

  /** fcn_0040fa61: misfortune gods and Death make investments fail. */
  *investmentBlocked(p: Player): Flow<boolean> {
    const god = this.objects.godType(p);
    if (god !== 7 && god !== 8 && god !== 15) return false;
    yield* this.say(p.id, `${['', '', '', '', '', '', '', '小衰神', '大衰神', '', '', '', '', '', '', '死神'][god]}顯靈\n\n投資失敗！`);
    return true;
  }

  /** fcn_0040f8be: a fortune god adds one more level for free after paying to buy or build. */
  *blessing(p: Player, ref: number): Flow {
    const god = this.objects.godType(p);
    if (god !== 3 && god !== 4) return;
    const level = this.freeUpgrade(ref);
    if (level >= 0) yield { t: 'fx', kind: 'blessing', p: p.id, data: { ref, level: level & 0x7f } };
  }

  /** Computer's buy rule fcn_0041d7d4 (docs/rules/02 §12.1). */
  aiCanAfford(p: Player, price: number): boolean {
    const reserve = Math.min(Math.trunc(this.fund * 0.05), 7000) * this.priceIndex;
    return p.cash + p.bank - price > reserve;
  }

  /** Large plots (docs/rules/02 §4). */
  *landOnFacility(p: Player, f: Facility): Flow {
    // 大富翁城 (docs/rules/19): its plots are casinos, handled by core/finale.ts.
    if (this.rules?.landOnFacility && (yield* this.rules.landOnFacility(this, p, f))) return;
    const me = p.id + 1, god = this.objects.godType(p);
    if (f.owner === 0) {
      if (p.sleepwalk || god === 12) return;
      const price = f.price * this.priceIndex;
      if (price > p.cash) { if (this.isHuman(p)) yield* this.say(p.id, '您的現金不足！'); return; }
      const yes = this.isHuman(p)
        ? (yield ask({ t: 'yesno', p: p.id, kind: 'buy-facility', text: `${f.name}\n\n費用:${price}元\n\n是否買下此地？`, price })) as boolean
        : this.smartAi(p) ? this.smart.wantsToBuy(p, price) : this.aiCanAfford(p, price);
      if (!yes) return;
      if (yield* this.investmentBlocked(p)) return;
      f.owner = me;
      if (this.landLimit()) f.expire = addMonths(this.date, this.landLimit());
      p.cash -= price;
      yield { t: 'buy', p: p.id, kind: 'facility', id: f.id, price };
      return;
    }
    if (f.owner === me) {
      if (p.sleepwalk) return;
      if (f.level === 0) {
        const cost = f.price * this.priceIndex;
        if (cost > p.cash) { if (this.isHuman(p)) yield* this.say(p.id, '您的現金不足！'); return; }
        if (this.smartAi(p) && !this.smart.wantsToBuild(p, cost)) return;
        const resort = this.world ? this.world.hooks.resort(this) : 1;
        f.type = this.isHuman(p)
          ? Math.max(0, Math.min(4, Number(yield ask({ t: 'facility-type', p: p.id, price: cost,
            ...(resort > 1 ? { text: `建設費用 ${cost} 元・度假勝地：旅館收入×${resort}` } : {}) })) || 0))
          : this.smartAi(p) ? this.smart.facilityType() : this.rng.rand() % 4 + 1;
        // A computer builds a hotel in a resort city (the draw above is kept, so the rand() sequence is the same).
        if (resort > 1 && !this.isHuman(p)) f.type = 1;
        if (yield* this.investmentBlocked(p)) return;
        f.level = 1;
        p.cash -= cost;
        yield { t: 'build', p: p.id, kind: 'facility', id: f.id, level: 1, cost };
        yield* this.blessing(p, f.id + 4000);
        return;
      }
      if (f.level >= FACILITY_MAX_LEVEL[f.type]) return;
      const cost = f.fees[0] * this.priceIndex;
      if (cost > p.cash) { if (this.isHuman(p)) yield* this.say(p.id, '您的現金不足！'); return; }
      const yes = this.isHuman(p)
        ? (yield ask({ t: 'yesno', p: p.id, kind: 'upgrade-facility', text: `${f.name}\n\n升級費用:${cost}元\n\n是否升級？`, price: cost })) as boolean
        : this.smartAi(p) ? this.smart.wantsToBuild(p, cost) : true;
      if (!yes) return;
      if (yield* this.investmentBlocked(p)) return;
      p.cash -= cost;
      f.level += 1;
      yield { t: 'build', p: p.id, kind: 'facility', id: f.id, level: f.level, cost };
      yield* this.blessing(p, f.id + 4000);
      return;
    }
    if (f.level < 1 || f.type < 1 || f.type > 3) return;
    const owner = this.players[f.owner - 1];
    const fee = ['', '住宿費', '購物費', '加油費'][f.type];
    if (!(yield* this.ownerCollects(owner, f.tmpState, fee))) return;
    let rate = f.fees[f.level] * this.priceIndex;
    // 大富豪模式: a resort city's hotels earn more (沖繩, docs/rules/17 §2.4).
    if (this.world && f.type === 1) rate = Math.round(rate * this.world.hooks.resort(this));
    if (f.tmpState && f.type !== 3) rate *= 2;
    let amount = 0, days = 0;
    // Message boxes, 1500 ms (core_actions:1296-1382).
    // The wheel first (fcn_0044090e with the owner's name, core_actions:1270-1330), then the message box.
    if (f.type === 1) { days = yield* this.spin(WheelKind.hotel, this.name(owner.id)); amount = rate * days; yield* this.say(undefined, `休息${days}天\n\n費用${amount}元！`); }
    else if (f.type === 2) { const mult = yield* this.spin(WheelKind.shopping, this.name(owner.id)); amount = rate * mult; yield* this.say(undefined, `您的消費金額為\n\n${rate}x${mult}倍=${amount}元`); }
    else {
      const vehicle = p.traffic & 3;
      amount = vehicle && vehicle < 3 ? 500 * (1 << (vehicle - 1)) * this.diceTotal * this.priceIndex : 0;
      if (amount) yield* this.say(undefined, `董事長${this.name(owner.id)} 請付${amount}元加油費`);
    }
    if (f.type === 1 && REMAKE_HOTEL.on) {
      // The remake (02 §4.3): the stay takes the passive cards; framed, the other player stays.
      const stayer = amount ? yield* this.hotelPay(p, owner, f, amount, fee) : p;
      if (stayer && days && stayer.whoPlays && !this.over) yield* this.checkIn(stayer, p, f, days, false);
      return;
    }
    const paid = amount ? yield* this.collect(p, owner, amount, fee, f.type !== 1) : null;
    if (paid) f.lastFee = yield* this.transfer(paid.payer, f.owner - 1, paid.amount, 0, fee);
    if (f.type === 1 && days && p.whoPlays && !this.over) yield* this.checkIn(p, p, f, days, false);
  }

  /** Set by a stay begun on this landing (土地公 then waits for the check-out, REMAKE_HOTEL). */
  checkedIn = false;

  /**
   * A hotel stay's fee with the passive cards (REMAKE_HOTEL; 歌舞伎町's 情人酒店): the payer's god, then 免費卡 /
   * 嫁禍卡 as on the other facility fees (04 §2.6: the same thresholds, order and questions), then 死神. Returns who
   * stays: the visitor, or the framed player (who pays); null when framed onto the owner (nobody stays).
   */
  *hotelPay(p: Player, owner: Player, f: Facility, total: number, fee: string): Flow<Player | null> {
    let amount = this.godModify(p, total), stayer: Player | null = p;
    if (amount !== total) yield* this.say(p.id, this.rules?.godFeeText?.(this, p, fee, total, amount) ?? (amount === 0 ? `${fee}免付！` : `${fee}改為${amount}元`));
    if (amount <= 0) return stayer;
    this.addHostility(p.id, owner.id, Math.trunc(amount / 100));
    const r = yield* this.cards.tollPassive(p, owner.id, amount);
    let payer = r.payer;
    amount = r.amount;
    if (payer !== p.id) stayer = payer === owner.id ? null : this.players[payer];
    if (amount > 0) {
      const death = this.objects.deathPayer(this.players[payer]);
      if (death !== null) { yield* this.say(undefined, `死神顯靈\n\n由${this.name(death)}賠償${fee}`); payer = death; }
      if (payer !== owner.id && payer !== owner.ally - 1) f.lastFee = yield* this.transfer(payer, owner.id, amount, 0, fee);
    }
    return stayer;
  }

  /**
   * A hotel stay begins (02 §4.3): the guest skips days - 1 more turns; insurance pays 2000 × days × F. A framed
   * stayer (≠ the visitor) is first taken to the hotel's square. `park`: 歌舞伎町's child at the amusement park.
   */
  *checkIn(stayer: Player, visitor: Player, f: Facility, days: number, park: boolean): Flow {
    const owner = this.players[f.owner - 1];
    if (stayer !== visitor) {
      const n = this.board.nodes.find(x => x.ref === f.id + 4000);
      if (!n) return;
      const where = park ? '遊樂場' : f.type === 1 ? '旅館' : '情人酒店';
      yield* this.say(stayer.id, `被嫁禍！住進${where}`, `${this.name(stayer.id)}被嫁禍，代替${this.name(visitor.id)}去${where}${days}天`);
      stayer.lastNode = stayer.node; stayer.node = n.id;
      yield { t: 'teleport', p: stayer.id, node: n.id };
    }
    if (owner) this.addHostility(stayer.id, owner.id, 20 * days * this.priceIndex);
    this.clearStays(stayer);
    stayer.hotel = days - 1 || 0x80;
    stayer.facility = f.id;
    stayer.monthBadDays += days;
    this.checkedIn = true;
    // The guest's bad-days line comes before the stay is set (core_actions:1600-1610, fcn_0044f2c2); then
    // fcn_0040d5a5 turns them to the hotel and they walk in.
    yield { t: 'fx', kind: 'enter-hotel', p: stayer.id, data: { days, facility: f.id, ...(park ? { park } : {}) } };
    yield* this.insurancePayout(stayer, 2000 * days * this.priceIndex);
  }

  /** Whether the remake's hotel rules are on (REMAKE_HOTEL; read by the modules, which cannot import it). */
  get remakeHotel(): boolean { return REMAKE_HOTEL.on; }
  /** Whether the construction company also builds on large plots (REMAKE_FREE_BUILD; read by the stock module). */
  get remakeFreeBuild(): boolean { return REMAKE_FREE_BUILD.on; }
  /** A hotel of this map (the original 旅館, 歌舞伎町's 情人酒店). */
  isHotel(f: Facility): boolean { return f.type === 1 || f.type === this.rules?.hotelType; }

  /** Check-out (REMAKE_HOTEL, 06 §5.5): 土地公 still on the guest takes the hotel now (not on the day they stopped). */
  private *checkOut(p: Player): Flow {
    if (!REMAKE_HOTEL.on) return;
    const f = this.board.facilities.find(x => x.id === p.facility);
    if (!f || !f.level || !this.isHotel(f) || !f.owner || f.owner === p.id + 1) return;
    if (this.objects.godType(p) !== 12) return;
    const n = this.board.nodes.find(x => x.ref === f.id + 4000);
    yield* this.objects.earthGodTakes(p, f, f.id + 4000, n?.id ?? p.node);
  }

  /**
   * The wheel fcn_0044090e / fcn_0043f7c6 (docs/rules/02 §4.4, core/modules/wheel.ts): rand() % 12 picks the start
   * cell; a human (the current player, not on autopilot or sleepwalking: +21 == 1 and +55 == 0) stops it with a
   * tap, everyone else at frame 39. The 'wheel' fx carries every frame for the screen. Returns the number.
   */
  *spin(kind: number, name: string): Flow<number> {
    const cur = this.current < this.npcBase ? this.players[this.current] : undefined;
    const human = !!cur && this.isHuman(cur) && !cur.sleepwalk;
    const start = this.rng.below(12);
    const stop = human ? Number(yield ask({ t: 'wheel', p: cur.id, kind, name, start })) : WHEEL_AUTO_STOP;
    const run = runWheel(kind, start, stop > 0 ? stop : WHEEL_AUTO_STOP);
    yield {
      t: 'fx', kind: 'wheel', p: cur?.id,
      data: { wheel: kind, name, human, start, stop: run.stop, cells: run.cells, result: run.result, end: run.end, value: run.value },
    };
    return run.value;
  }

  // ---------------------------------------------------------------- bank (docs/rules/02 §8)

  *atm(p: Player): Flow {
    if (p.bankRefused) {
      if (this.isHuman(p)) yield* this.say(p.id, `銀行拒絕往來還剩${(p.bankRefused & 0x7f) + 1}天`);
      return;
    }
    if (this.isHuman(p)) {
      const a = (yield ask({ t: 'bank', p: p.id, counter: false, maxLoan: 0, canWithdraw: !p.noLoan, canBorrow: false })) as { deposit?: number; withdraw?: number } | undefined;
      if (a?.deposit) { const x = Math.min(a.deposit, p.cash); p.cash -= x; p.bank += x; }
      if (a?.withdraw && !p.noLoan) {
        const x = Math.min(a.withdraw, p.bank); p.bank -= x; p.cash += x;
        yield { t: 'bank', p: p.id };
        yield* this.financeReserve(p); // only after a withdrawal (rich4_ui_bank.asm:4930)
        return;
      }
      yield { t: 'bank', p: p.id };
      return;
    }
    if (this.smartAi(p)) { this.smart.atm(p); yield { t: 'bank', p: p.id }; yield* this.financeReserve(p); return; }
    // Computer ATM: steer cash towards the character's cash ratio (more early in the month, less late).
    const total = p.cash + p.bank;
    if (total <= 0) return;
    let target = CHARACTERS[p.character].cashRatio / 100;
    const d = dayOf(this.date);
    if (d <= 7) target *= 1.5; else if (d >= 26) target *= 0.5;
    if (target >= 1) target = 0.9; else if (target <= 0) target = 0.1;
    if (Math.abs(p.cash / total - target) < 0.25 && p.cash !== 0) return;
    p.cash = Math.trunc(total * target);
    p.bank = total - p.cash;
    yield { t: 'bank', p: p.id };
    yield* this.financeReserve(p); // after every adjustment, deposit or withdrawal (:5211)
  }

  /** Loan due date fcn_00433b7e: 90 days, moved past Sundays (holidays join once the holiday table is remade). */
  setLoanDue(p: Player) {
    if (p.loanDue) return;
    let due = addDays(this.date, 90);
    while (weekday(due) === 0) due = addDays(due, 1);
    p.loanDue = due;
  }

  /**
   * The counter _rich4_ui_bank_entry (02 §8.4, §8.6, §8.7). Only a human (not on autopilot) whose bank tile
   * belongs to a company he controls gets the chairman's room; computers never use special financing.
   */
  *bankCounter(p: Player): Flow {
    if (p.bankRefused || this.rules?.noLoans) return; // 大富翁城's finale: chips, no loans (docs/rules/19 §2)
    const wealth = this.wealth(p);
    if (this.isHuman(p)) {
      const company = companyOf(this.board, this.node(p.node));
      const finance = company && company.controller === p.id + 1 ? { total: this.otherDeposits(p), used: p.specialFinance } : undefined;
      const a = (yield ask({ t: 'bank', p: p.id, counter: true, maxLoan: Math.max(0, wealth - p.loan), canWithdraw: !p.noLoan, canBorrow: !p.noLoan, finance })) as
        { borrow?: number; repay?: number; finance?: number; financeRepay?: number } | undefined;
      if (finance && a?.finance && !p.noLoan) {
        // 週轉現金 (fcn_00434492, rich4_ui_bank.asm:1080-1105): up to the other players' deposits less what is out, into the deposit.
        const x = Math.min(Math.trunc(a.finance), finance.total - p.specialFinance);
        if (x > 0) { p.bank += x; p.specialFinance += x; }
      }
      if (finance && a?.financeRepay) {
        // 歸還款項 (:1107-1145): deposit first, then cash; refused when both together are short.
        const x = Math.min(Math.trunc(a.financeRepay), p.specialFinance);
        if (x > 0 && x <= p.cash + p.bank) {
          p.bank -= x;
          if (p.bank < 0) { p.cash += p.bank; p.bank = 0; }
          p.specialFinance -= x;
        }
      }
      if (a?.borrow && !p.noLoan) {
        const x = Math.min(a.borrow, Math.max(0, wealth - p.loan));
        if (x > 0) { p.bank += x; p.loan += x; this.setLoanDue(p); }
      }
      if (a?.repay) {
        const x = Math.min(a.repay, p.loan);
        if (x <= p.cash + p.bank) {
          const fromBank = Math.min(x, p.bank); p.bank -= fromBank; p.cash -= x - fromBank;
          p.loan -= x;
          if (!p.loan) p.loanDue = 0;
        }
      }
      yield { t: 'bank', p: p.id };
      return;
    }
    if (this.smartAi(p)) { this.smart.bankCounter(p); yield { t: 'bank', p: p.id }; return; }
    const ch = CHARACTERS[p.character], money = p.cash + p.bank;
    // 大富豪模式 (the user 2026-10-19: computers borrowed against their land and went bankrupt at the due date): it repays
    // as soon as it can, borrows only when short, and never more than the money it already has.
    const tycoon = !!this.world;
    if (p.loan) {
      const d = daysBetween(this.date, p.loanDue);
      if (tycoon ? money >= 1.2 * p.loan : 2 * p.loan < p.bank || (d <= 6 && p.cash + p.bank >= 1.1 * p.loan)) {
        yield* this.forcedDebit(p, p.loan);
        p.loan = 0; // the original leaves the due date in place here
        if (tycoon) { p.loanDue = 0; p.loanRenewed = undefined; }
      }
    } else if (this.rng.below(10) !== 0 && p.cash + p.bank >= 30000) {
      // enough money: no loan
    } else if (tycoon && money >= 20000 * this.priceIndex) {
      // 大富豪模式: not short of money: no loan
    } else if (!p.noLoan && ch.loanRatio) {
      let loan = Math.trunc((ch.loanRatio * wealth) / 100);
      if (tycoon) loan = Math.min(loan, Math.max(10000 * this.priceIndex, money));
      if (loan > 0) { p.loan = loan; p.bank += loan; this.setLoanDue(p); }
    }
    yield { t: 'bank', p: p.id };
  }

  // ---------------------------------------------------------------- special financing (docs/rules/02 §8.7)

  /** 客戶存款總額 of the chairman's room: every other player's deposit (:970-1005, bankrupt players hold 0). */
  otherDeposits(p: Player): number {
    return this.players.reduce((a, q) => (q.id === p.id ? a : a + q.bank), 0);
  }

  /** The bank's operator for fcn_00436b0a: the controller of the last category-7 company that has one, or null. */
  bankOperator(): Player | null {
    let op: Player | null = null;
    for (const c of this.board.companies) if (c.category === 7 && c.controller) op = this.players[c.controller - 1] ?? null;
    return op;
  }

  /**
   * Reserve check fcn_00436b0a(1) (rich4_ui_bank.asm:3855-3970), after an ATM withdrawal or a computer's ATM
   * adjustment by `p`: when the other living players' deposits fall below the operator's special financing,
   * the operator covers the gap by forced debit (can bankrupt him) and his financing shrinks by it.
   */
  *financeReserve(p: Player): Flow {
    const op = this.bankOperator();
    if (!op || op.id === p.id || !op.specialFinance) return;
    const deposits = this.players.reduce((a, q) => (q.id === op.id || !q.whoPlays ? a : a + q.bank), 0);
    if (deposits >= op.specialFinance) return;
    const short = op.specialFinance - deposits;
    yield* this.say(undefined, `銀行資金準備\n\n不足${short}元\n\n由經營者${this.name(op.id)}墊付！`);
    yield* this.forcedDebit(op, short);
    op.specialFinance = Math.max(0, op.specialFinance - short);
    yield { t: 'bank', p: op.id };
  }

  /**
   * Change of operator fcn_00436b0a(0) (:3971-4030): every living player other than the operator who still has
   * special financing repays it at once by forced debit. Runs where control can change hands: after a
   * computer's share trading, after the human's stock market and trade screens, after the two fate cards that
   * sell shares. Without any operator, everybody's financing is recalled.
   */
  *financeRecall(): Flow {
    const op = this.bankOperator();
    // 大富豪模式: each city's bank has its operator; only who runs none of them repays (docs/rules/17 §6).
    const ops = this.world ? this.world.hooks.bankOperators() : [];
    for (const q of this.players) {
      if (q === op || ops.includes(q) || !q.whoPlays || !q.specialFinance) continue;
      yield* this.say(undefined, '銀行經營權易主！');
      yield* this.say(undefined, `${this.name(q.id)}\n\n強制償還${q.specialFinance}元\n\n銀行特別融資！`);
      const s = q.specialFinance;
      yield* this.forcedDebit(q, s);
      q.specialFinance = 0;
      yield { t: 'bank', p: q.id };
      if (this.over) return;
    }
  }

  // ---------------------------------------------------------------- bankruptcy (docs/rules/02 §9.3, 01 §8.2)

  *bankrupt(p: Player): Flow {
    if (this.world) { yield* this.world.hooks.bankrupt(p, this); return; }
    if (p.bankrupt || !p.placed) return;
    p.whoPlays = 0;
    p.bankrupt = true;
    this.objects.detachAll(p);
    this.endAlly(p);
    this.places.returnNpcsOf(p);
    Object.assign(p, {
      cash: 0, bank: 0, loan: 0, specialFinance: 0, loanDue: 0, points: 0, hotel: 0, vanish: 0, prison: 0, hospital: 0,
      sleep: 0, sleepwalk: 0, stay: 0, turtle: 0, bankRefused: 0, noLoan: 0, allyDays: 0, insurance: 0, god: 0, bomb: 0,
      ally: 0, hostility: new Array(p.hostility.length).fill(0), luckBad: 0, luckMoney: 0, luckFate: 0,
    });
    for (const q of this.players) q.hostility[p.id] = 0;
    yield { t: 'bankrupt', p: p.id };
    const living = this.living(), humans = living.filter(q => q.human);
    if (this.players.filter(q => q.human).length === 1 && p.human) { yield* this.lose(); return; }
    if (!humans.length) { this.over = { winner: living[0]?.id ?? -1, code: 1 }; yield { t: 'gameover', winner: living[0]?.id ?? -1, code: 1 }; return; }
    if (living.length === 1) { yield* this.finish(living[0].id); return; }
    const owner = p.id + 1, released: number[] = [];
    for (const l of this.board.lands) if (l.owner === owner) { l.owner = 0; l.expire = 0; released.push(l.id + 2000); }
    for (const f of this.board.facilities) if (f.owner === owner) { f.owner = 0; f.expire = 0; released.push(f.id + 4000); }
    for (const c of this.board.companies) if (c.controller === owner) c.controller = 0;
    yield { t: 'board' };
    yield* this.stocks.sellAll(p, true);
    yield* this.tools.dropAll(p);
    yield* this.cards.dropAll(p);
    this.places.lottery = this.places.lottery.map(b => (b === owner ? 0 : b));
    if (released.length > 3) {
      // Three random released properties go to public auction; the proceeds go to the lottery pool.
      const picked = new Set<number>();
      while (picked.size < 3) picked.add(released[this.rng.below(released.length)]);
      for (const ref of picked) yield* this.places.auction(-1, ref);
    }
  }

  /**
   * Surrender _rich4_player_surrender (01 §8.2, 06 §5.3): with more than one human in the game the one who
   * gives up first names a player for Death (type 15) to haunt, then goes bankrupt.
   */
  private *surrender(p: Player): Flow {
    const others = this.living().filter(q => q.id !== p.id);
    if (this.players.filter(q => q.human && !q.bankrupt).length > 1 && others.length) {
      const target = (yield ask({ t: 'pick-player', p: p.id, title: '請死神去找誰？', players: others.map(q => q.id), cancellable: true })) as number;
      if (target >= 0 && this.players[target]) yield* this.objects.callDeath(this.players[target]);
    }
    yield* this.bankrupt(p);
  }

  private *lose(): Flow {
    this.over = { winner: -1, code: 1 };
    yield { t: 'gameover', winner: -1, code: 1 };
  }
}

const EVENT_NAMES: Record<number, string> = {
  2: '新聞', 3: '命運', 4: '監獄', 5: '醫院', 6: '企鵝挖寶', 7: '七彩氣球', 8: '喜從天降', 9: '樂透',
  10: '點券50', 11: '點券30', 12: '點券10', 13: '卡片', 14: '銀行', 15: '道具店', 16: '魔法屋',
  17: '車站', 18: '機場',
};
export function eventName(e: number): string { return EVENT_NAMES[e] ?? ''; }
