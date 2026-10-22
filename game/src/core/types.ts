import type { PackedDate } from './date';

/** New-game settings (docs/rules/01 §2.1). Index fields select from the original option tables. */
export interface GameSettings {
  mapId: number;
  /** `nick`: 派對模式's own name for the player (the user 2026-10-19), shown instead of the character's. */
  players: { character: number; human: boolean; nick?: string }[];
  fundIndex: number;
  traffic: 0 | 1 | 2;
  landLimitIndex: number;
  daysLimitIndex: number;
  victoryIndex: number;
  startDate: PackedDate;
  seed: number;
  /** 派對模式 (ui/party-net.ts): a 托管 player's turn starts with the 'auto-turn' question, so 取消托管 reaches every phone. */
  party?: boolean;
  /**
   * A normal game's computer level (core/smart-ai.ts, Game.aiLevel): 0 簡單 (the original's computer; none = 0, as every
   * game and save before it), 1 中級, 2 困難. 派對模式 plays 困難, 大富豪模式 簡單, whatever this says.
   */
  aiLevel?: 0 | 1 | 2;
}

export const FUNDS = [300000, 200000, 100000, 50000, 30000, 10000];
export const DAY_LIMITS = [0, 730, 365, 182, 91, 30];
export const VICTORY_MULTIPLES = [0, 100, 50, 10, 5, 3];
/** 土地權限 in months (0 = unlimited): 無限期/二年/一年/六個月/三個月/一個月. */
export const LAND_LIMIT_MONTHS = [0, 24, 12, 6, 3, 1];

/** Player state (docs/rules/07 §2 player structure). */
export interface Player {
  id: number;
  character: number;
  human: boolean;
  /** 派對模式: the name the player gave themself (shown instead of the character's name). */
  nick?: string;
  /** 0 out (bankrupt or not yet landed), 1 human, 2 computer. Autopilot (托管) is `autopilot`. */
  whoPlays: 0 | 1 | 2;
  autopilot: boolean;
  bankrupt: boolean;
  placed: boolean;
  node: number;
  lastNode: number;
  dir: number;
  /** 0 walk, 1 scooter, 2 car, 3 construction vehicle (traffic >> 2 = days left on it). */
  traffic: number;
  dice: number;
  cash: number;
  bank: number;
  loan: number;
  specialFinance: number;
  loanDue: PackedDate;
  /** 大富豪模式: the loan's due date was put off once already (a second time it is collected). */
  loanRenewed?: boolean;
  points: number;
  /** Day counters use the original convention: N = days left, 0x80 = ends at the next turn start. */
  hotel: number;
  /** Low 6 bits days; bit 6 = alien (vs trip abroad); bit 7 = reappears next turn. */
  vanish: number;
  prison: number;
  hospital: number;
  /**
   * Released from there at this turn start (who_plays 0x10, fcn_0040d6be; the byte above stays 0x80 meanwhile): the
   * walk out onto the door square, which is resolved first, comes at the dispatch (docs/rules/06 §9.3.1). Set only
   * between the two, so never in a save.
   */
  leaving?: 'hospital' | 'prison';
  sleep: number;
  sleepwalk: number;
  stay: number;
  turtle: number;
  bankRefused: number;
  noLoan: number;
  allyDays: number;
  insurance: number;
  /** Attached god: object slot id (1-based) or 0 (docs/rules/07: +63 holds the object id). */
  god: number;
  /** Time bomb object slot carried, 0 = none. */
  bomb: number;
  /** Ally's id + 1. */
  ally: number;
  /** hostility[q] = how much this player resents q (AI target choice). */
  hostility: number[];
  monthLoss: number;
  monthGain: number;
  monthBadDays: number;
  /** Luck modifiers from the attached god (+68 bad luck, +70 money luck, +72 fortune luck). */
  luckBad: number;
  luckMoney: number;
  luckFate: number;
  /** Facility the player stays in (hotel). */
  facility: number;
  /** Saved traffic/dice while on the construction vehicle (+100/+101) and while sleepwalking (+102/+103). */
  savedTraffic: number;
  savedDice: number;
  sleepTraffic: number;
  sleepDice: number;
  /** Tool counts by tool id - 1 (max 9 each). */
  tools: number[];
  /** Card ids in hand, up to 15, in the order received. */
  cards: number[];
  /** 大富豪模式 (docs/rules/17): index of the world city the player is in; missing in a normal game. */
  map?: number;
  /** 大富豪模式: on the way to city `to` (one turn 在路上), arriving on its station / airport square. */
  trip?: { to: number; via: 'station' | 'airport' };
}

/** One option of a choice question. */
/** Picture for an option: a frame of an original resource (the screen uses the redrawn one when there is one). */
export interface OptionIcon { archive: 'Data' | 'Panel' | 'map'; id: number; frame?: number }
/** `badge`: a small corner tag (大富豪模式's 「限定」 lab tools); `hint`: a short effect line under the name in a tool grid. */
export interface Option { label: string; value: number; disabled?: boolean; detail?: string; icon?: OptionIcon; badge?: string; hint?: string }

/**
 * One choice of a map pick (`pick-map`): `node` a road node (id = node id, e.g. a roadblock on it), `plot` a lot or
 * facility tapped on its building (id = plot reference 2001.. / 4001..), `actor` a player 0-3 or NPC 4-7 tapped on
 * the figure. `label` names it in lists and when stacked choices must be told apart.
 */
export interface PickSpot { at: 'node' | 'plot' | 'actor'; id: number; label: string }

/** Questions the engine asks a human player; computer players are answered by the AI rules. */
export type Ask =
  | { t: 'turn'; p: number; maxDice: number; canUseCard: boolean; canUseTool: boolean }
  /** 派對模式: a human on 托管 at the start of their turn: 1 (取消托管) plays this turn by hand, anything else lets the computer. */
  | { t: 'auto-turn'; p: number }
  | { t: 'yesno'; p: number; kind: string; text: string; price?: number }
  | { t: 'facility-type'; p: number; price: number; title?: string; text?: string; cancellable?: boolean }
  /**
   * ATM or counter (02 §8). `finance` is set at the counter when the player controls this bank's company: the
   * chairman's room (02 §8.7) with the other players' deposits `total` and the player's special financing `used`.
   * Answers: ATM { deposit } | { withdraw }, counter { borrow } | { repay } | { finance } | { financeRepay }.
   */
  | { t: 'bank'; p: number; counter: boolean; maxLoan: number; canWithdraw: boolean; canBorrow: boolean; finance?: { total: number; used: number } }
  /** Pick one option; answer: the option value, or -1 to cancel when cancellable. */
  | { t: 'choose'; p: number; title: string; text?: string; options: Option[]; cancellable: boolean; layout?: 'tiles' | 'cards' | 'lab' | 'faces'; screen?: string }
  /**
   * The shop (05 §8, 09 §7.4): card shelf `cards` and tool shelf `tools` (ids, 0 = sold), the player's points.
   * Answer: { buy: 'card' | 'tool', index } (shelf position), { sell: 'card', index } (hand position),
   * { sell: 'tool', id }, or -1 to leave.
   */
  /** `always`: 大富豪模式's always-stocked cards, bought again and again (17 §3.10); not on a normal game's shop. */
  | { t: 'shop'; p: number; cards: number[]; tools: number[]; points: number; always?: number[] }
  /**
   * A mini game played by the human (06 §7, 13-mini-games.md): `game` is the tile type, 6 企鵝挖寶, 7 射氣球,
   * 8 喜從天降. Answer: the points it earned (the original's return value).
   */
  | { t: 'mini-game'; p: number; game: number }
  /**
   * The wealth / poverty gods' slot machine (06 §5.7): the reels spin until the player taps. Answer: the frame
   * (30 ms each, from 0) in which the lever is pulled, i.e. the frame after the tap (≥ 1). `god` is the type 1/2/5/6.
   */
  | { t: 'slot-machine'; p: number; god: number; big: boolean }
  /**
   * The wheel (02 §4.4): hotel days (kind 1), shopping multiplier (2), travel days (0), insurance days (3). The wheel
   * turns from cell `start` + 1 one cell per 36 ms frame until the player taps. Answer: the frame (from 0) of the
   * stop, i.e. the frame after the tap (≥ 1). `name`: the owner's or the company's name for the message box.
   */
  | { t: 'wheel'; p: number; kind: number; name: string; start: number }
  /** Lottery ticket (06 §8, 09 §7.8): numbers 1..36, `taken` already sold. Answer: the number, or -1. */
  | { t: 'lottery'; p: number; taken: number[]; pool: number; price: number }
  /** 黑市 (docs/rules/10): answer { buy: listing index } for one purchase, or -1 to leave. */
  | { t: 'black-market'; p: number }
  /** The stock market screen (09 §7.6); answer: { slot, buy, n } for one trade, or -1 to leave. */
  | { t: 'stock-market'; p: number }
  /**
   * Pick a node on the board; answer: node id, or 0 to cancel. `onScreen`: only the listed nodes visible on the
   * player's screen may be picked (the original's viewport pick buffer, 05 §2.6); otherwise anywhere (missiles).
   * `plot`: the choices are lots / facilities, picked on the building (each node stands for the plot it borders).
   */
  | { t: 'pick-node'; p: number; title: string; nodes: number[]; cancellable: boolean; onScreen?: boolean; plot?: boolean }
  /** 大富豪模式: a square of another city, tapped on that city's map (the city viewer): 洲際飛彈's target. 0: none. */
  | { t: 'pick-city-node'; p: number; title: string; city: number; nodes: number[]; cancellable: boolean }
  /**
   * Pick something on the map, as the original's card selector does (04 §2.4): the spots may mix road nodes,
   * lots / facilities and players / NPCs. `onScreen`: only the spots on the player's screen may be picked (the
   * card selector cannot scroll). Answer: the index into `spots`, or -1 to cancel.
   */
  | { t: 'pick-map'; p: number; title: string; spots: PickSpot[]; cancellable: boolean; onScreen?: boolean }
  /** Pick a player; answer: player id, or -1 to cancel. */
  | { t: 'pick-player'; p: number; title: string; players: number[]; cancellable: boolean }
  /**
   * 大富豪模式 travel (docs/rules/17 §3): a station or airport square offers the trip. Answer: the destination's city
   * index, or -1 to stay.
   */
  | { t: 'travel'; p: number; via: 'station' | 'airport'; from: string; options: TravelOption[]; card?: boolean }
  /** Enter an amount; answer: number, or -1 to cancel. */
  | { t: 'amount'; p: number; title: string; text?: string; min: number; max: number; step: number };

/** One destination of the travel dialog: city index, its name, the fare (price-indexed), whether it can be paid. */
export interface TravelOption { map: number; mapId: number; name: string; price: number; affordable: boolean; owned: number; rivals: number; landIndex?: number }

/** Turn menu answer: throw the dice, or open one of the pre-departure actions. */
export type TurnAnswer = { dice: number } | { action: 'card' | 'tool' | 'stock' | 'trade' | 'surrender' | 'autopilot' };

export type Answer =
  | undefined
  | boolean
  | number
  | TurnAnswer
  | { deposit?: number; withdraw?: number; borrow?: number; repay?: number; finance?: number; financeRepay?: number }
  /** Stock market trade, black market purchase, shop actions. */
  | { slot: number; buy: boolean; n: number }
  | { buy: number }
  | { buy: 'card' | 'tool'; index: number }
  | { sell: 'card'; index: number }
  | { sell: 'tool'; id: number };

/** Things that happened, in order, for the screen to show. */
export type GameEvent =
  | { t: 'airdrop'; p: number; node: number }
  | { t: 'turn'; p: number }
  | { t: 'dice'; p: number; values: number[] }
  | { t: 'step'; p: number; from: number; to: number; dir: number; left: number }
  /** An actor other than a player (NPC 4-7, robot doll 8) stepped. */
  | { t: 'actor-step'; actor: number; from: number; to: number; dir: number }
  | { t: 'teleport'; p: number; node: number }
  | { t: 'say'; p?: number; text: string; log?: string }
  | { t: 'buy'; p: number; kind: 'land' | 'facility'; id: number; price: number }
  | { t: 'build'; p: number; kind: 'land' | 'facility'; id: number; level: number; cost: number }
  /** `quiet`: the original moves the money without a message box of its own (its notice came before). */
  | { t: 'pay'; from: number; to: number; amount: number; reason: string; quiet?: boolean }
  | { t: 'points'; p: number; amount: number }
  | { t: 'bank'; p: number }
  | { t: 'bankrupt'; p: number }
  | { t: 'day'; date: PackedDate; newMonth: boolean }
  | { t: 'gameover'; winner: number; code: number }
  /** Presentation-only effect (card used, god appears, explosion …); kind names come from the modules. */
  | { t: 'fx'; kind: string; p?: number; node?: number; target?: number; data?: Record<string, unknown> }
  /** Board state changed outside the usual events; redraw. */
  | { t: 'board' }
  /**
   * 大富豪模式 (docs/rules/17 §10): a line of the live ticker. `map` the city (index) it happened in, `p` the player
   * concerned; `kind` groups lines (buy, build, pay, bankrupt, travel, arrive, title …) for icons and filters.
   */
  | { t: 'ticker'; map: number; text: string; p?: number; kind: string; day: number; important?: boolean; from?: number; amount?: number; count?: number }
  /** 大富豪模式: the screen should show city `map` now (the human travelled); the engine's `game` there. */
  | { t: 'world-view'; map: number }
  /** 大富豪模式: players came or went on the shown city out of sight (arrivals, a full hospital); redraw them. */
  | { t: 'world-sync' };

export type Step = GameEvent | (Ask & { ask: true });
