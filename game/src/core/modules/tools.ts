/**
 * Tools and the shop — docs/rules/05-tools-and-shop.md. Owns: the shop's global stock of tools 1-8,
 * tool effects (vehicles, roadblock/mine/bomb placement, missiles, robot doll and worker, time machine,
 * teleporter, construction vehicle, remote dice), the shop, and the computer's tool choices.
 *
 * Screen ranges: the original picks targets from the 440×440 px viewport pick buffer (05 §2.6) and hits every
 * instance with a pixel inside the blast square (05 §3.6). The remake measures from the anchor coordinates of
 * nodes, lots and players instead: the viewport is ±220 px around the current player's node, a missile hits
 * anchors within ±100 px of the target, a nuclear missile within ±220 px (sprite extents are not modelled).
 */
import type { Flow } from '../flow';
import { ask } from '../flow';
import type { Game } from '../game';
import { CHARACTERS } from '../characters';
import type { Option, PickSpot, Player } from '../types';
import { COPY_CARD, deckSupply, TYCOON_SHOP_ALWAYS } from './cards';
import { OBJECT_NAMES } from './objects';

export interface ToolDef {
  id: number;
  name: string;
  /** Price in points (05 §1, §8.2: never price-indexed). */
  price: number;
  /** Global supply: 10 for tools 1-8, 0 = not pooled (9-13). */
  supply: number;
  /** f6, unused by the rules (05 §1). */
  tier: 0 | 1 | 2;
  /** f7 aggressiveness, compared with the computer's personality (05 §10.1.2, §10.2). */
  aggression: 0 | 1 | 2;
  inShop: boolean;
}

/** Tool table rich4_tool_table.c (05 §1), by id - 1. */
export const TOOLS: readonly ToolDef[] = [
  { id: 1, name: '機器娃娃', price: 15, supply: 10, tier: 0, aggression: 0, inShop: true },
  { id: 2, name: '路障', price: 30, supply: 10, tier: 0, aggression: 1, inShop: true },
  { id: 3, name: '地雷', price: 25, supply: 10, tier: 0, aggression: 1, inShop: true },
  { id: 4, name: '定時炸彈', price: 25, supply: 10, tier: 0, aggression: 1, inShop: true },
  { id: 5, name: '機車', price: 80, supply: 10, tier: 0, aggression: 0, inShop: true },
  { id: 6, name: '汽車', price: 150, supply: 10, tier: 1, aggression: 0, inShop: true },
  { id: 7, name: '飛彈', price: 100, supply: 10, tier: 1, aggression: 2, inShop: true },
  { id: 8, name: '遙控骰子', price: 30, supply: 10, tier: 1, aggression: 0, inShop: true },
  { id: 9, name: '機器工人', price: 30, supply: 0, tier: 2, aggression: 1, inShop: false },
  { id: 10, name: '時光機', price: 40, supply: 0, tier: 2, aggression: 2, inShop: false },
  { id: 11, name: '傳送機', price: 95, supply: 0, tier: 2, aggression: 1, inShop: false },
  { id: 12, name: '工程車', price: 150, supply: 0, tier: 2, aggression: 2, inShop: false },
  { id: 13, name: '核子飛彈', price: 250, supply: 0, tier: 2, aggression: 2, inShop: false },
];

/**
 * 大富豪模式's lab tools (docs/rules/17 §3.6), only from the 研究所 of some cities: 14 超級工人 (+2 levels),
 * 15 洲際飛彈 (a nuclear missile on any lot of any city), 16 時空機 (a 傳送機 that also crosses to another city).
 * Never in the shop nor in the black market (TOOLS stays the original 13).
 */
export const TYCOON_TOOLS: readonly ToolDef[] = [
  { id: 14, name: '超級工人', price: 60, supply: 0, tier: 2, aggression: 1, inShop: false },
  { id: 15, name: '洲際飛彈', price: 400, supply: 0, tier: 2, aggression: 2, inShop: false },
  { id: 16, name: '時空機', price: 160, supply: 0, tier: 2, aggression: 1, inShop: false },
];
/** 歌舞伎町's 柏青哥店 / 拉霸店 tools (docs/rules/21 §7.5), registered by core/kabukicho.ts: ids 17–20. */
export const MAP_TOOLS: ToolDef[] = [];
export const toolDef = (id: number): ToolDef | undefined => TOOLS[id - 1] ?? TYCOON_TOOLS[id - 14] ?? MAP_TOOLS.find(t => t.id === id);
export const isTycoonTool = (id: number) => id > TOOLS.length;
/** A tool's icon: Panel#11.(id+1) for the original 13, Data#614..616 (maps/remake/tools/) for the lab tools. */
export const toolIcon = (id: number): { archive: 'Panel' | 'Data'; id: number; frame: number } =>
  id > TOOLS.length ? { archive: 'Data', id: 600 + id, frame: 0 } : { archive: 'Panel', id: 11, frame: id + 1 };
/**
 * 大富豪模式's city labs (17 §3.6) by map id: still five slots, some replaced by the advanced tools (「限定」). 東京
 * keeps the original list.
 */
export const TYCOON_LABS: Record<number, number[]> = {
  101: [14, 10, 11, 12, 13], 102: [14, 10, 11, 12, 13], 103: [9, 10, 11, 12, 15], 104: [14, 10, 16, 12, 15],
};

export const MAX_HELD = 9;
/** Starting tools (01 §2.3, 05 §2.1). */
export const STARTING_TOOLS = [1, 2, 3, 4, 8, 9];
/** Robot doll walks a fixed 9 steps (01 §3.6, 05 §3.1). */
export const DOLL_STEPS = 9;
/** Construction vehicle traffic byte: low bits 3, high bits the count (05 §3.11). */
export const CONSTRUCTION_TRAFFIC = 0x1f;
/** Computer's fixed shopping order for tools 8, 2, 7, 1, 4, 3 (ref_004755f0, 05 §10.2). */
const AI_SHOP_ORDER = [8, 2, 7, 1, 4, 3];
const VIEW_HALF = 220;
const MISSILE_HALF = 100;
/** Facility level caps by type (ref_00474940). */
const FACILITY_MAX = [1, 5, 5, 1, 5, 5, 5, 5, 5, 5]; // + 5..9 大富翁城's halls (docs/rules/19)
FACILITY_MAX[14] = 5; // 激情歲月's 宣傳站 (docs/rules/24 §2.4); 10..13 stay as they were
/** Objects that hurt whoever stops on them (remote dice AI, 05 §10.1.3). */
const HARMFUL = new Set([5, 6, 7, 8, 10, 11, 16, 17, 18]);
/** Lab options 1..5 (05 §7). */
const LAB_OPTIONS = [9, 10, 11, 12, 13];

/** Card price and f7 by id - 1 (docs/rules/04 §1), needed for the shop shelves and the computer's selling. */
const CARD_INFO: readonly [name: string, price: number, f7: number][] = [
  ['均富卡', 200, 2], ['均貧卡', 200, 2], ['購地卡', 35, 1], ['換地卡', 25, 0], ['換屋卡', 20, 0],
  ['轉向卡', 20, 0], ['改建卡', 15, 0], ['拍賣卡', 20, 1], ['天使卡', 160, 0], ['惡魔卡', 180, 2],
  ['怪獸卡', 60, 2], ['拆除卡', 15, 1], ['搶奪卡', 25, 2], ['停留卡', 20, 0], ['冬眠卡', 100, 2],
  ['夢遊卡', 25, 1], ['陷害卡', 20, 2], ['復仇卡', 20, 0], ['嫁禍卡', 40, 0], ['免費卡', 25, 0],
  ['免罪卡', 25, 0], ['送神符', 10, 0], ['請神符', 20, 0], ['紅卡', 50, 0], ['黑卡', 30, 1],
  ['查稅卡', 35, 1], ['漲價卡', 35, 0], ['查封卡', 35, 1], ['同盟卡', 40, 0], ['烏龜卡', 70, 0],
  ['飛行卡', 20, 0], ['電車卡', 10, 0], ['遣返卡', 15, 1], ['獨裁卡', 300, 2], ['召集卡', 25, 1], ['通緝卡', 60, 2], // 大富豪模式 only (cards.ts TYCOON_CARDS)
  ['保鑣卡', 25, 0], ['暴走卡', 80, 0], // 歌舞伎町 only (cards.ts KB_CARDS)
  ['複製卡', 100, 0], // 大富豪模式: never on the shelf, the owner's gift only (cards.ts COPY_CARD)
];
const cardPrice = (id: number) => CARD_INFO[id - 1]?.[1] ?? 0;
/** 通緝卡: one per city even in 大富豪模式's unlimited shop (17 §3.5, §3.10). */
const WANTED_CARD = 36;
const shopAlways = (id: number) => TYCOON_SHOP_ALWAYS.includes(id);
/**
 * The computer buys at most one copy of each card per shop visit, in both modes (the user 2026-10-19; docs/rules/05
 * §10.2): off, the original's one candidate per remaining copy (the golden test checks it).
 */
export const REMAKE_AI_ONE_CARD = { on: true };

/**
 * Answer to the `shop` question (types.ts): buy the shelf cell `index` of the card or tool shelf, sell the card at
 * hand position `index`, sell one of tool `id`, or -1 to leave.
 */
export type ShopAnswer =
  | { buy: 'card' | 'tool'; index: number }
  | { sell: 'card'; index: number }
  | { sell: 'tool'; id: number }
  | -1;

/** Sale price ⌊0.9 × price × n⌋ in double precision (05 §8.4). */
export const sellPrice = (price: number, n = 1) => Math.trunc(0.9 * price * n);

/** 8-way facing, same as Game.direction (01 §6.3); copied to avoid a runtime import cycle. */
function direction(dx: number, dy: number): number {
  let angle = Math.round((Math.atan2(-dy, dx) / (2 * Math.PI)) * 65536);
  if (angle < 0) angle += 65536;
  const sector = (((angle >> 12) + 1) >> 1) & 7;
  return (sector + 2) & 7;
}

/** Deep copy that keeps prototypes and leaves the listed shared objects (the game, rng …) as references. */
function deepClone<T>(value: T, keep: Set<unknown>): T {
  const seen = new Map<unknown, unknown>();
  const c = (x: unknown): unknown => {
    if (x === null || typeof x !== 'object' || keep.has(x)) return x;
    if (seen.has(x)) return seen.get(x);
    if (ArrayBuffer.isView(x)) { const y = (x as unknown as Uint8Array).slice(); seen.set(x, y); return y; }
    if (x instanceof Map) { const y = new Map(); seen.set(x, y); for (const [k, v] of x) y.set(c(k), c(v)); return y; }
    if (x instanceof Set) { const y = new Set(); seen.set(x, y); for (const v of x) y.add(c(v)); return y; }
    if (x instanceof Date) return new Date(x.getTime());
    const y: Record<string, unknown> = Array.isArray(x) ? ([] as unknown as Record<string, unknown>) : Object.create(Object.getPrototypeOf(x));
    seen.set(x, y);
    for (const k of Object.keys(x)) y[k] = c((x as Record<string, unknown>)[k]);
    return y;
  };
  return c(value) as T;
}

const SNAPSHOT_MODULES = ['stocks', 'cards', 'objects', 'events', 'places'] as const;

/** Time machine snapshot _rich4_store_current_state (05 §3.10): the whole game state except the turn phase. */
interface Snapshot {
  players: Player[];
  lands: unknown[];
  facilities: unknown[];
  companies: unknown[];
  nodes: unknown[];
  modules: Record<string, Record<string, unknown>>;
  shopStock: number[];
  game: { date: number; daysElapsed: number; monthsElapsed: number; priceIndex: number; lotteryPool: number };
}

/** A pick target for the teleporter source (05 §3.9). */
type Source =
  | { kind: 'player'; id: number }
  | { kind: 'npc'; id: number }
  | { kind: 'object'; node: number }
  | { kind: 'land'; ref: number }
  | { kind: 'facility'; ref: number };

export class Tools {
  /** Shop stock of tools 1..8 by id - 1 (05 §2.1). */
  shopStock: number[] = [];
  /** Remote dice value chosen this turn (0x475dd8), 0 = roll normally; read and cleared at departure. */
  remoteDice = 0;
  /**
   * Set when a tool ends the pre-move phase; the core reads and resets it after humanUse/aiUse.
   * 'depart': remote dice chose the roll — depart now (no more tools, no AI dice choice).
   * 'land': the player teleported themself — run the stop event at the new node and end the turn without dice.
   */
  pending: 'none' | 'depart' | 'land' = 'none';
  /** Time machine snapshots, one per player slot (05 §3.10). Not part of the snapshot itself. */
  snapshots: (Snapshot | null)[] = [null, null, null, null];
  /** The remote dice already stored the snapshot before its departure (05 §3.7). */
  private skipNextStore = false;

  constructor(readonly g: Game) {}

  // ---------------------------------------------------------------- stock and inventory (05 §2)

  /** New game: shop stock, each player's starting tools 1,2,3,4,8,9 and vehicle (01 §2.3, 05 §2.1). */
  init(): void {
    this.shopStock = TOOLS.slice(0, 8).map(t => t.supply);
    this.snapshots = [null, null, null, null];
    for (const p of this.g.players) {
      for (const t of STARTING_TOOLS) this.receive(p, t);
      const v = p.traffic & 3;
      if (v === 1 || v === 2) this.shopStock[v + 3] -= 1;
    }
  }

  /** Give a tool if under the cap of 9 and in stock for tools 1-8 (05 §2.1, fcn_00445a4d). */
  receive(p: Player, tool: number): boolean {
    const own = this.g.rules?.extraTools?.some(t => t.id === tool) ?? false;   // a map's own tool (歌舞伎町 17, 18)
    if (tool < 1 || (tool > (this.g.world ? 16 : 13) && !own) || p.tools[tool - 1] >= MAX_HELD) return false;
    if (tool <= 8) {
      if (this.shopStock[tool - 1] <= 0) return false;
      this.shopStock[tool - 1] -= 1;
    }
    p.tools[tool - 1] += 1;
    return true;
  }

  /** After using a tool rich4_after_player_use_tool (05 §2.1): one fewer, tools 1-8 go back to the stock. */
  consume(p: Player, tool: number): void {
    if (p.tools[tool - 1] <= 0) return;
    p.tools[tool - 1] -= 1;
    if (tool <= 8) this.shopStock[tool - 1] += 1;
  }

  /** A roadblock / mine / time bomb object left the map (rich4_objects.asm:158-169): back to the stock. */
  restock(tool: number, n = 1): void {
    if (tool >= 1 && tool <= 8) this.shopStock[tool - 1] += n;
  }

  /**
   * Gift object, shop owner gift: random tool rich4_receive_random_tool (05 §2.3). Weighted by the stock of 1..8;
   * no rand() when the stock is empty. Returns the drawn id even when the player already holds 9 of it.
   */
  *receiveRandom(p: Player): Flow<number> {
    const total = this.shopStock.reduce((a, b) => a + b, 0);
    if (total <= 0) return 0;
    let r = this.g.rng.below(total), id = 0;
    for (let i = 0; i < 8; i++) {
      if (r < this.shopStock[i]) { id = i + 1; break; }
      r -= this.shopStock[i];
    }
    this.receive(p, id);
    return id;
  }

  /**
   * rich4_player_sell_all_tools (05 §2.4): get off any vehicle (it goes back into the inventory), then clear all
   * 13 tools; tools 1-8 return to the stock. Returns Σ price × count at full price (fate and magic house add it
   * to the points; bankruptcy and Death do not).
   */
  sellAll(p: Player, all = false): number {
    const v = p.traffic & 3;
    if (v === 1 || v === 2) p.tools[v + 3] += 1;
    else if (v === 3) p.tools[11] += 1;
    if (v) { p.traffic = 0; p.dice = 1; }
    let sum = 0;
    // 大富豪模式's lab tools (ids 14-16) stay, except on bankruptcy (`all`, 17 §3.7).
    for (let i = 0; i < (all ? p.tools.length : 13); i++) {
      const n = p.tools[i];
      if (!n) continue;
      sum += (TOOLS[i] ?? toolDef(i + 1))!.price * n;
      if (i < 8) this.shopStock[i] += n;
      p.tools[i] = 0;
    }
    return sum;
  }

  /** Fate / magic house "sell all tools": the same, the caller adds the value to the points. */
  sellAllForPoints(p: Player): number { return this.sellAll(p); }

  /** Sell every tool of a player (死神; bankruptcy with `all`). */
  *dropAll(p: Player, all = false): Flow { this.sellAll(p, all); }

  /**
   * Vehicle destroyed fcn_0040cd07 (01 §5.2, 05 §5.4): on the road a scooter or car is scrapped (back to the shop
   * stock), the construction vehicle ends; walking, 1 die. Returns true when the player is hurt (the 0x40 flag
   * used by missiles); off the road or out of the game nothing happens.
   */
  destroyVehicle(p: Player): boolean {
    if (!p.whoPlays || this.g.offRoad(p)) return false;
    const v = p.traffic & 3;
    if (v === 1 || v === 2) this.shopStock[v + 3] += 1;
    if (v) { p.traffic = 0; p.dice = 1; }
    return true;
  }

  // ---------------------------------------------------------------- time machine (05 §3.10)

  /**
   * _rich4_store_current_state: only for a human player (whoPlays 1) during their own turn. The core calls this
   * at departure (before the stay check) and when a human's turn is skipped; the teleporter calls it itself.
   */
  storeState(p: Player): void {
    if (this.skipNextStore) { this.skipNextStore = false; return; }
    if (p.id >= this.g.npcBase || p.whoPlays !== 1) return;
    const g = this.g, keep = this.shared();
    const modules: Snapshot['modules'] = {};
    for (const name of SNAPSHOT_MODULES) {
      const mod = g[name] as unknown as Record<string, unknown>;
      const saved: Record<string, unknown> = {};
      for (const k of Object.keys(mod)) if (k !== 'g' && typeof mod[k] !== 'function') saved[k] = deepClone(mod[k], keep);
      modules[name] = saved;
    }
    this.snapshots[p.id] = {
      players: deepClone(g.players, keep),
      lands: deepClone(g.board.lands, keep),
      facilities: deepClone(g.board.facilities, keep),
      companies: deepClone(g.board.companies, keep),
      nodes: deepClone(g.board.nodes, keep),
      modules,
      shopStock: [...this.shopStock],
      game: { date: g.date, daysElapsed: g.daysElapsed, monthsElapsed: g.monthsElapsed, priceIndex: g.priceIndex, lotteryPool: g.lotteryPool },
    };
  }

  /** _rich4_restore_last_state: copies the snapshot back (it stays valid for another use). False when none. */
  restoreState(p: Player): boolean {
    const s = this.snapshots[p.id];
    if (!s) return false;
    const g = this.g, keep = this.shared();
    // 大富豪模式 (docs/rules/17 §7): only this city rewinds; players elsewhere, the calendar and the nationwide
    // market keep going.
    const world = !!g.world;
    s.players.forEach((q, i) => { if (!world || (g.here(g.players[i]) && g.here(q))) Object.assign(g.players[i], deepClone(q, keep)); });
    const back = (into: unknown[], from: unknown[]) => from.forEach((r, i) => Object.assign(into[i] as object, deepClone(r, keep)));
    back(g.board.lands, s.lands);
    back(g.board.facilities, s.facilities);
    back(g.board.companies, s.companies);
    back(g.board.nodes, s.nodes);
    for (const name of SNAPSHOT_MODULES) {
      if (world && name === 'stocks') continue;
      const mod = g[name] as unknown as Record<string, unknown>;
      for (const [k, v] of Object.entries(s.modules[name])) mod[k] = deepClone(v, keep);
    }
    this.shopStock = [...s.shopStock];
    if (world) g.lotteryPool = s.game.lotteryPool; else Object.assign(g, s.game);
    return true;
  }

  private shared(): Set<unknown> {
    const g = this.g;
    return new Set<unknown>([g, g.rng, g.board, g.settings, g.stocks, g.cards, g.tools, g.objects, g.events, g.places]);
  }

  // ---------------------------------------------------------------- turn hooks

  /**
   * Turn start (01 §3.2 step 12-13): the construction vehicle counts down and the old vehicle comes back when
   * still held; a lab order larger than the lab's current level (it was damaged) is cancelled before the core
   * counts the labs down.
   */
  *turnStart(p: Player): Flow {
    this.pending = 'none';
    this.skipNextStore = false;
    if ((p.traffic & 3) === 3) {
      p.traffic -= 4;
      if ((p.traffic & 0xfc) === 0) {
        const v = p.savedTraffic;
        if ((v === 1 || v === 2) && p.tools[v + 3] > 0) { p.tools[v + 3] -= 1; p.traffic = v; p.dice = p.savedDice; }
        else { p.traffic = 0; p.dice = 1; }
        yield { t: 'fx', kind: 'construction-end', p: p.id };
      }
    }
    for (const f of this.g.board.facilities) {
      if (f.type === 4 && f.owner === p.id + 1 && f.labDays && f.labTool > f.level) f.labDays = 0;
    }
  }

  /** After stopping on property: the construction vehicle demolishes another player's building (fcn_00448a7e, 05 §3.11). */
  *construction(p: Player): Flow {
    const g = this.g;
    if (!p.whoPlays || (p.traffic & 0x83) !== 3 || p.sleepwalk || p.hotel) return;
    const ref = g.node(p.node).ref;
    const prop = ref > 2000 && ref < 4000 ? g.board.lands[ref - 2001] : ref > 4000 && ref < 6000 ? g.board.facilities[ref - 4001] : undefined;
    if (!prop || prop.owner === p.id + 1 || prop.level === 0) return;
    if (prop.owner) g.addHostility(prop.owner - 1, p.id, 30 * g.priceIndex);
    yield { t: 'fx', kind: 'demolish', p: p.id, node: p.node, data: { ref } };
    g.damageProperty(ref, g.rules?.constructionMode ?? 2); // 大富翁城: one level (docs/rules/19 §3.6)
    yield { t: 'board' };
  }

  // ---------------------------------------------------------------- lab (02 §4.5, 05 §7)

  /** The lab's five tools (05 §7; a tycoon city's own list, 17 §3.6). */
  labOptions(): number[] { return (this.g.world && TYCOON_LABS[this.g.settings.mapId]) || LAB_OPTIONS; }
  /** The tool a lab order (1..5) delivers: 9..13 in a normal game. */
  labToolId(choice: number): number { return this.labOptions()[choice - 1] ?? choice + 8; }

  /** Owner stops on a built lab: start developing a tool, 5 turns (fcn_0044101d). */
  *labStop(p: Player, facility: number): Flow {
    const f = this.g.board.facilities.find(x => x.id === facility) ?? this.g.board.facilities[facility - 1];
    if (!f || f.level < 1) return;
    const top = Math.min(f.level, 5);
    let choice = top;
    if (this.g.isHuman(p)) {
      // All five with their icons Panel#11.10-14, those above the lab's level greyed (fcn_0044101d draws every
      // icon and darkens the boxes from the level on).
      const options: Option[] = this.labOptions().map((t, i) => ({
        label: toolDef(t)!.name, value: i + 1, disabled: i >= top, detail: i >= top ? `需 ${i + 1} 級` : '5 天完成',
        icon: toolIcon(t), ...(isTycoonTool(t) ? { badge: '限定' } : {}),
      }));
      choice = Number(yield ask({ t: 'choose', p: p.id, title: '請選擇欲開發道具', text: `研究所 ${top} 級：可開發前 ${top} 種道具`, options, cancellable: true, layout: 'lab' }));
      if (!(choice >= 1 && choice <= top)) return;
    }
    f.labTool = choice;
    f.labDays = 5;
    yield { t: 'fx', kind: 'lab-order', p: p.id, data: { facility: f.id, tool: this.labToolId(choice) } };
  }

  /** Lab finished: the developed tool (02 §4.5, 05 §7); not delivered when 9 are already held. */
  *labDone(p: Player, tool: number): Flow {
    // Message box 「%s開發完成！」 1500 ms (core_actions:4590-4605).
    // The remake names the owner: with up to 12 players it isn't clear whose lab finished (user, 2026-10-18).
    yield* this.g.say(undefined, `${this.g.name(p.id)}的${toolDef(tool)?.name ?? ''}開發完成！`);
    this.receive(p, tool);
  }

  // ---------------------------------------------------------------- using tools (05 §2.5, §3)

  /** Human picks and uses a tool from the turn menu (05 §2.5-§2.6): one success per opening of the panel. */
  *humanUse(p: Player): Flow {
    for (;;) {
      // The held tools packed in tool order, each with its icon Panel#11.(id+1) and count (09 §7.3).
      const options: Option[] = [...TOOLS, ...(this.g.world ? TYCOON_TOOLS : []), ...(this.g.rules?.extraTools ?? [])].filter(t => p.tools[t.id - 1] > 0)
        .map(t => ({ label: t.name, value: t.id, detail: `×${p.tools[t.id - 1]}`, icon: toolIcon(t.id), ...((t as { short?: string }).short ? { hint: (t as { short?: string }).short } : {}) }));
      const v = p.traffic;
      if (v === 1 || v === 2) options.push({ label: '下車', value: 99, icon: { archive: 'Panel', id: 11, frame: v === 1 ? 15 : 16 } });
      const a = Number(yield ask({ t: 'choose', p: p.id, title: '道具', options, cancellable: true, layout: 'tiles' }));
      if (a === 99 && (v === 1 || v === 2)) { this.getOff(p); yield { t: 'fx', kind: 'get-off', p: p.id }; return; }
      const extra = this.g.rules?.extraTools?.some(t => t.id === a) ?? false;
      if (!(extra || (a >= 1 && a <= (this.g.world ? 16 : 13))) || !(p.tools[a - 1] > 0)) return;
      if (yield* this.use(p, a)) return;
    }
  }

  /** "下車" fcn_00447c00: the scooter or car goes back to the inventory; walking, 1 die. */
  getOff(p: Player): void {
    const v = p.traffic & 3;
    if (v === 1 || v === 2) p.tools[v + 3] += 1;
    if (v) { p.traffic = 0; p.dice = 1; }
  }

  /**
   * Runs one tool. `param` is the computer's pre-chosen target (_rich4_get_ai_tool_param_value); without it a
   * human is asked. Returns false when nothing happened (cancelled or not applicable): the tool is kept.
   */
  *use(p: Player, tool: number, param?: number): Flow<boolean> {
    const used = yield* this.apply(p, tool, param);
    if (used) this.g.stats?.toolUsed(p.id, tool); // statistics only (core/stats.ts)
    return used;
  }

  private *apply(p: Player, tool: number, param?: number): Flow<boolean> {
    if (p.tools[tool - 1] <= 0) return false;
    switch (tool) {
      case 1: return yield* this.robotDoll(p);
      case 2: case 3: case 4: return yield* this.placeObject(p, tool, param);
      case 5: case 6: return yield* this.mount(p, tool);
      case 7: case 13: return yield* this.missile(p, tool, param);
      case 8: return yield* this.useRemoteDice(p, param);
      case 9: return yield* this.robotWorker(p, param);
      case 10: return yield* this.timeMachine(p);
      case 11: return yield* this.teleporter(p, param);
      case 12: return yield* this.constructionVehicle(p);
      case 14: return !!this.g.world && (yield* this.robotWorker(p, param, 14));
      case 15: return yield* this.icbm(p, param);
      case 16: return yield* this.spaceTime(p, param);
    }
    if (this.g.rules?.useTool) return yield* this.g.rules.useTool(this.g, p, tool, param); // 歌舞伎町 (docs/rules/21 §7.5)
    return false;
  }

  /**
   * 洲際飛彈 (大富豪模式, 17 §3.6): a nuclear missile anywhere in any city (another city's square tapped on its map).
   * Param: city × 10000 + lot ref. In the
   * player's own city it is the nuclear missile without the screen limit; elsewhere that city's blast runs there.
   */
  private *icbm(p: Player, param?: number): Flow<boolean> {
    const g = this.g, w = g.world;
    if (!w) return false;
    let city: number, target: number;
    if (param !== undefined) { city = Math.floor(param / 10000); target = param % 10000; }
    else {
      city = Number(yield ask({ t: 'choose', p: p.id, title: '洲際飛彈：打哪一座城市？', options: w.hooks.icbmCities(p), cancellable: true }));
      if (!(city >= 0)) return false;
      target = city === w.index
        ? Number(yield ask({ t: 'pick-node', p: p.id, title: '洲際飛彈', nodes: g.board.nodes.filter(n => n.adjacent.some(Boolean)).map(n => n.id), cancellable: true }))
        // Another city: its map opens and the square is tapped there, as in one's own city (the user 2026-10-19).
        : (n => (n > 0 ? 100000 + n : 0))(Number(yield ask({ t: 'pick-city-node', p: p.id, title: '洲際飛彈：點選要轟炸的位置', city, nodes: w.hooks.cityRoadNodes(city), cancellable: true })));
    }
    if (!target || target < 0) return false;
    if (city === w.index) {
      const at = this.position(target);
      if (!at) return false;
      this.consume(p, 15);
      const before = this.holdings();
      yield { t: 'fx', kind: 'nuke', p: p.id, data: { x: at.x, y: at.y, icbm: true } };
      yield* this.blast(p, at.x, at.y, VIEW_HALF, true);
      const hurt = this.hurtSince(before);
      if (hurt.length) yield { t: 'fx', kind: 'icbm-hit', p: p.id, data: { victims: hurt } };
      return true;
    }
    this.consume(p, 15);
    yield* w.hooks.icbm(g, p, city, target);
    return true;
  }

  /** Another city's nuclear blast (洲際飛彈 from elsewhere): the nuke's damage around (x, y). */
  /** What each player has in this city a blast can take: building levels and lots, and whether in hospital. */
  holdings(): { lv: number[]; lots: number[]; hosp: boolean[] } {
    const g = this.g, n = g.players.length, lv = new Array(n).fill(0), lots = new Array(n).fill(0);
    for (const l of [...g.board.lands, ...g.board.facilities]) if (l.owner && l.owner <= n) { lv[l.owner - 1] += l.level; lots[l.owner - 1] += 1; }
    return { lv, lots, hosp: g.players.map(q => q.hospital > 0) };
  }
  /** The players a blast hurt (buildings or lots gone, or sent to hospital): for 洲際飛彈's 「？？？」 (the user 2026-10-19). */
  hurtSince(before: { lv: number[]; lots: number[]; hosp: boolean[] }): number[] {
    const now = this.holdings();
    return this.g.players.filter(q => !q.bankrupt && (now.lv[q.id] < before.lv[q.id] || now.lots[q.id] < before.lots[q.id] || (now.hosp[q.id] && !before.hosp[q.id]))).map(q => q.id);
  }

  *nukeAt(p: Player, x: number, y: number): Flow {
    yield { t: 'fx', kind: 'nuke', p: p.id, data: { x, y, icbm: true } };
    yield* this.blast(p, x, y, VIEW_HALF, true);
  }

  /**
   * 時空機 (大富豪模式, 17 §3.6): either the 傳送機 in this city, or at once to a random square of another city (no
   * fare, no turn 在路上; the turn ends there; the god goes along). Param: a node for the teleporter, 100000 + city.
   */
  private *spaceTime(p: Player, param?: number): Flow<boolean> {
    const g = this.g, w = g.world;
    if (!w) return false;
    let a = param;
    // A human (the user 2026-10-19): tap anything on the road (oneself, a rival, a god, a mine …), then send it to a
    // chosen square here or to a random square of another city (teleporter, tool 16).
    if (a === undefined) return yield* this.teleporter(p, undefined, 16);
    if (a < 100000) return yield* this.teleporter(p, a, 16);
    const city = a - 100000;
    if (city === w.index || !w.hooks.spaceTimeCities(p).some(o => o.value === city && !o.disabled)) return false;
    this.consume(p, 16);
    yield* w.hooks.spaceTime(g, p, city);
    return true;
  }

  /** Robot doll (05 §3.1): actor 8 walks 9 steps from the owner, removing every object it reaches. */
  private *robotDoll(p: Player): Flow<boolean> {
    const g = this.g;
    this.consume(p, 1);
    yield { t: 'fx', kind: 'robot-doll', p: p.id, node: p.node };
    let at = p.node, from = p.lastNode;
    for (let i = 0; i < DOLL_STEPS; i++) {
      // The doll goes the owner's way at forks (clearing the road the owner will take) without redrawing (14 §2).
      const next = g.peekNext(p.id, at, from);
      const a = g.node(at), b = g.node(next);
      yield { t: 'actor-step', actor: g.dollId, from: at, to: next, dir: direction(b.x - a.x, b.y - a.y) };
      from = at; at = next;
      if (g.objects.at(at)) {
        yield { t: 'fx', kind: 'doll-clear', node: at, data: { type: g.objects.at(at)!.type } };
        g.objects.removeAt(at);
      }
    }
    yield { t: 'fx', kind: 'robot-doll-end', p: p.id, node: at };
    return true;
  }

  /** Roadblock / mine / time bomb (05 §3.2-§3.4): an empty node on screen; the inventory drops, no stock return. */
  private *placeObject(p: Player, tool: number, param?: number): Flow<boolean> {
    const node = param ?? Number(yield ask({ t: 'pick-node', p: p.id, title: `使用${TOOLS[tool - 1].name}`, nodes: this.roadNodes().filter(n => this.emptyNode(n)), cancellable: true, onScreen: true }));
    if (!node || !this.g.node(node)) return false;
    this.g.objects.place(tool + 14, node);
    p.tools[tool - 1] -= 1;
    yield { t: 'fx', kind: 'place-object', p: p.id, node, data: { type: tool + 14 } };
    return true;
  }

  /** Scooter / car (05 §3.5): the ridden vehicle leaves the inventory; switching puts the other one back. */
  private *mount(p: Player, tool: number): Flow<boolean> {
    const want = tool - 4; // 1 scooter, 2 car
    if (p.traffic === want) return false;
    if (p.traffic === 1 || p.traffic === 2) p.tools[p.traffic + 3] += 1;
    p.traffic = want;
    p.dice = want + 1;
    p.tools[tool - 1] -= 1;
    yield { t: 'fx', kind: tool === 5 ? 'scooter' : 'car', p: p.id };
    return true;
  }

  /** Missile (7) and nuclear missile (13), 05 §3.6 / §3.12. Param: node id, or a lot ref 2001.. / 4001.. */
  private *missile(p: Player, tool: number, param?: number): Flow<boolean> {
    const g = this.g;
    const target = param ?? Number(yield ask({ t: 'pick-node', p: p.id, title: `使用${TOOLS[tool - 1].name}`, nodes: g.board.nodes.filter(n => n.adjacent.some(Boolean)).map(n => n.id), cancellable: true }));
    const at = this.position(target);
    if (!at) return false;
    this.consume(p, tool);
    yield { t: 'fx', kind: tool === 7 ? 'missile' : 'nuke', p: p.id, data: { x: at.x, y: at.y } };
    yield* this.blast(p, at.x, at.y, tool === 7 ? MISSILE_HALF : VIEW_HALF, tool === 13);
    return true;
  }

  /** Damage fcn_0040ac7b (05 §3.6 step 4-5, §3.12). */
  private *blast(p: Player, cx: number, cy: number, half: number, nuke: boolean): Flow {
    const g = this.g, PI = g.priceIndex;
    const hit = (x: number, y: number) => Math.abs(x - cx) <= half && Math.abs(y - cy) <= half;
    for (const l of g.board.lands) {
      if (!hit(l.x, l.y)) continue;
      if (l.owner) g.addHostility(l.owner - 1, p.id, nuke ? 30 * l.level * PI : 30 * PI);
      g.damageProperty(l.id + 2000, nuke ? 1 : 0);
    }
    for (const f of g.board.facilities) {
      if (!hit(f.x, f.y)) continue;
      if (f.owner) g.addHostility(f.owner - 1, p.id, nuke ? 30 * f.level * PI : 30 * PI);
      g.damageProperty(f.id + 4000, g.rules?.blastMode?.(nuke) ?? (nuke ? 1 : 0)); // 大富翁城 (19 §3.6)
    }
    const hurt: Player[] = [];
    for (const q of g.players) {
      if (!q.placed || q.vanish) continue;
      const n = g.node(q.node);
      if (!hit(n.x, n.y)) continue;
      if (!q.whoPlays) {
        // A beggar's remains move to a distant random node (fcn_0040cc56).
        if (q.bankrupt) { const to = g.randomFreeNode(n); q.node = to.id; yield { t: 'teleport', p: q.id, node: to.id }; }
        continue;
      }
      if (g.offRoad(q)) continue;
      // 推测: the attached god and carried bomb are drawn on the player and are hit with them (05 §4.3).
      g.objects.detachAll(q);
      if (this.destroyVehicle(q)) hurt.push(q);
    }
    // NPCs 4..7 in range: _rich4_add_player_days_in_hospital(k, 0).
    g.places.npcs.forEach((c, i) => {
      if (c && c.where === 0 && c.node && hit(g.node(c.node).x, g.node(c.node).y)) g.places.npcTo(g.npcBase + i, 'hospital');
    });
    for (const o of g.objects.slots) {
      if (!o || !o.node || o.owner) continue;
      const n = g.node(o.node);
      if (n && hit(n.x, n.y)) g.objects.removeAt(o.node);
    }
    yield { t: 'board' };
    for (const q of hurt) {
      g.addHostility(q.id, p.id, 90 * PI);
      yield* g.sendTo(q, 'hospital', 3);
    }
  }

  /** Remote dice (05 §3.7): stores the snapshot, uses the die, then the core departs with one die of that value. */
  private *useRemoteDice(p: Player, param?: number): Flow<boolean> {
    let v = param;
    if (v === undefined) {
      const options = [1, 2, 3, 4, 5, 6].map(n => ({ label: String(n), value: n }));
      v = Number(yield ask({ t: 'choose', p: p.id, title: '遙控骰子', options, cancellable: true, screen: 'remote-dice' }));
    }
    if (!(v >= 1 && v <= 6)) return false;
    // fcn_0040dd1f runs before the tool is used up, so the snapshot still holds the remote dice.
    this.storeState(p);
    this.skipNextStore = p.id < this.g.npcBase && p.whoPlays === 1;
    this.consume(p, 8);
    this.remoteDice = v;
    this.pending = 'depart';
    yield { t: 'fx', kind: 'remote-dice', p: p.id, data: { value: v } };
    return true;
  }

  /** Robot worker (05 §3.8): one free level on any lot on screen; used up even when the lot is topped out. */
  private *robotWorker(p: Player, param?: number, tool = 9): Flow<boolean> {
    const g = this.g;
    let ref = param;
    if (ref === undefined) {
      const refs = new Map<number, number>();
      for (const n of this.roadNodes()) {
        const r = g.node(n).ref;
        if (((r > 2000 && r < 4000) || (r > 4000 && r < 6000)) && !refs.has(r)) refs.set(r, n);
      }
      const node = Number(yield ask({ t: 'pick-node', p: p.id, title: `使用${toolDef(tool)!.name}`, nodes: [...refs.values()], cancellable: true, onScreen: true, plot: true }));
      ref = node ? g.node(node)?.ref : 0;
    }
    if (!ref || !((ref > 2000 && ref < 4000) || (ref > 4000 && ref < 6000))) return false;
    this.consume(p, tool);
    let level = -1;
    if (ref > 4000) {
      const f = g.board.facilities[ref - 4001];
      // An empty large plot: choose the facility type first (human dialog, or that map's own picker on 歌舞伎町 /
      // 大富翁城; a computer's own plot rand() % 4 + 1), then level 1.
      if (f.level === 0) level = yield* g.buildEmptyPlot(p, f);
      else level = g.freeUpgrade(ref);
    } else level = g.freeUpgrade(ref);
    // 超級工人 (17 §3.6): a second free level, when there is room.
    // 大富翁城 (docs/rules/19 §3.6): 機器工人 +2, 超級工人 to the top.
    for (let k = g.rules?.workerExtra?.(tool) ?? (tool === 14 ? 1 : 0); k > 0 && level >= 0 && !(level & 0x80); k--) { const l2 = g.freeUpgrade(ref); if (l2 < 0) break; level = l2; }
    yield { t: 'fx', kind: 'robot-worker', p: p.id, data: { ref, level: level < 0 ? -1 : level & 0x7f, done: level >= 0 && (level & 0x80) !== 0 } };
    yield { t: 'board' };
    return true;
  }

  /** Time machine (05 §3.10): restore, then use one from the restored inventory. */
  private *timeMachine(p: Player): Flow<boolean> {
    if (!this.snapshots[p.id]) return false;
    yield { t: 'fx', kind: 'time-machine', p: p.id };
    this.restoreState(p);
    if (p.tools[9] > 0) p.tools[9] -= 1;
    yield { t: 'board' };
    return true;
  }

  /** Teleporter (05 §3.9). A computer always moves itself to its pre-chosen node. */
  private *teleporter(p: Player, param?: number, tool = 11): Flow<boolean> {
    const g = this.g;
    let src: Source;
    let dest = 0;
    if (param !== undefined) { src = { kind: 'player', id: p.id }; dest = param; }
    else {
      // A human taps what to move on the map (select(0x1200036), rich4_tool_chuansongji.asm:60-90): lots and
      // facilities on their building, people and NPCs on their figure, and any object lying on the road (gifts,
      // chests, gods, roadblocks, mines, bombs); an object carried by someone moves with its host, so the host is
      // what is tapped. Only what is on the screen counts.
      const view = this.roadNodes();
      const sources: Source[] = [], spots: PickSpot[] = [];
      for (const q of g.players) if (q.placed && q.whoPlays && !g.offRoad(q)) { sources.push({ kind: 'player', id: q.id }); spots.push({ at: 'actor', id: q.id, label: g.name(q.id) }); }
      g.places.npcs.forEach((c, i) => { if (c && c.where === 0 && c.node) { sources.push({ kind: 'npc', id: g.npcBase + i }); spots.push({ at: 'actor', id: g.npcBase + i, label: ['小偷', '強盜', '流氓', '間諜'][i] }); } });
      for (const o of g.objects.slots) if (o.type && o.node && !o.owner) { sources.push({ kind: 'object', node: o.node }); spots.push({ at: 'node', id: o.node, label: OBJECT_NAMES[o.type - 1] ?? '物品' }); }
      for (const l of g.board.lands) { sources.push({ kind: 'land', ref: l.id + 2000 }); spots.push({ at: 'plot', id: l.id + 2000, label: l.name }); }
      for (const f of g.board.facilities) { sources.push({ kind: 'facility', ref: f.id + 4000 }); spots.push({ at: 'plot', id: f.id + 4000, label: f.name }); }
      const k = Number(yield ask({ t: 'pick-map', p: p.id, title: `使用${toolDef(tool)!.name}`, spots, cancellable: true, onScreen: true }));
      if (!(k >= 0 && k < sources.length)) return false;
      src = sources[k];
      // 時空機 (大富豪模式): a person or a thing on the road may also go to another city, to a random square there.
      if (tool === 16 && g.world && (src.kind === 'player' || src.kind === 'object')) {
        const w = g.world, what = src.kind === 'player' ? g.name(src.id) : OBJECT_NAMES[(g.objects.at(src.node)?.type ?? 1) - 1];
        const options: Option[] = [{ label: '本城（點選位置）', value: -2 }, ...w.hooks.spaceTimeCities(p)];
        const c = Number(yield ask({ t: 'choose', p: p.id, title: `把${what}傳送到哪裡？`, text: `本城：點選位置・別的城市：隨機一格${src.kind === 'player' ? '（附身的神明一起去）' : ''}`, options, cancellable: true }));
        if (c >= 0) {
          if (!w.hooks.spaceTimeCities(p).some(o => o.value === c && !o.disabled)) return false;
          if (src.kind === 'object') {
            if (!(yield* w.hooks.spaceTimeObject(g, p, src.node, c))) { yield* g.say(p.id, '那座城市放不下了'); return false; }
            this.consume(p, tool);
            return true;
          }
          const q = g.players[src.id];
          this.consume(p, tool);
          yield* w.hooks.spaceTime(g, q, c, p);
          return true;
        }
        if (c !== -2) return false;
      }
      const targets = src.kind === 'land'
        ? view.filter(n => { const r = g.node(n).ref; const l = r > 2000 && r < 4000 ? g.board.lands[r - 2001] : null; return !!l && !l.owner && !l.level; })
        : src.kind === 'facility'
          ? view.filter(n => { const r = g.node(n).ref; const f = r > 4000 && r < 6000 ? g.board.facilities[r - 4001] : null; return !!f && !f.owner && !f.level; })
          : view.filter(n => this.emptyNode(n));
      dest = Number(yield ask({ t: 'pick-node', p: p.id, title: '傳送到', nodes: targets, cancellable: true, onScreen: true, plot: src.kind === 'land' || src.kind === 'facility' }));
      if (!dest || !g.node(dest)) return false;
    }
    if (!g.node(dest)) return false;
    if (src.kind === 'land') {
      const to = g.board.lands[g.node(dest).ref - 2001], from = g.board.lands[src.ref - 2001];
      if (!to) return false;
      Object.assign(to, { owner: from.owner, level: from.level, chain: from.chain, expire: from.expire });
      Object.assign(from, { owner: 0, level: 0, chain: false, expire: 0, lastToll: 0 });
    } else if (src.kind === 'facility') {
      const to = g.board.facilities[g.node(dest).ref - 4001], from = g.board.facilities[src.ref - 4001];
      if (!to) return false;
      Object.assign(to, { owner: from.owner, level: from.level, type: from.type, expire: from.expire });
      Object.assign(from, { owner: 0, level: 0, type: 0, expire: 0, lastFee: 0 });
    } else if (src.kind === 'object') {
      const o = g.objects.at(src.node);
      if (!o) return false;
      const n = g.node(dest), first = n.adjacent.find(Boolean);
      o.node = dest;
      if (first) { const b = g.node(first); o.dir = direction(b.x - n.x, b.y - n.y); }
    } else {
      const mover = src.kind === 'player' ? g.players[src.id] : g.places.npcs[src.id - g.npcBase];
      const self = src.kind === 'player' && src.id === p.id;
      if (self) this.storeState(p);
      const way = this.arrival(dest, mover.dir);
      mover.node = dest; mover.lastNode = way.lastNode; mover.dir = way.dir;
      yield { t: 'teleport', p: src.id, node: dest };
      if (self) this.pending = 'land';
      else if (src.kind === 'player' && g.rules?.teleported) yield* g.rules.teleported(g, g.players[src.id]); // 歌舞伎町 (21 §4.1)
    }
    this.consume(p, tool);
    yield { t: 'board' };
    return true;
  }

  /**
   * Facing after a teleport (05 §3.9 person step 1): the usable exit closest to the old facing; the way in is
   * another usable exit (the same one when it is the only one).
   */
  private arrival(dest: number, dir: number): { dir: number; lastNode: number } {
    const g = this.g, n = g.node(dest);
    const exits = n.adjacent.filter((a, j) => a && !(n.oneWay & (8 >> j)));
    if (!exits.length) return { dir, lastNode: n.adjacent.find(Boolean) ?? dest };
    let best = 0, bestDiff = 9, bestDir = dir;
    exits.forEach((e, i) => {
      const b = g.node(e), d = direction(b.x - n.x, b.y - n.y);
      const diff = Math.min((d - dir) & 7, (dir - d) & 7);
      if (diff < bestDiff) { best = i; bestDiff = diff; bestDir = d; }
    });
    const other = exits.find((_, i) => i !== best) ?? exits[best];
    return { dir: bestDir, lastNode: other };
  }

  /** Construction vehicle (05 §3.11): 7 turns on 1 die; a ridden scooter/car goes back to the inventory first. */
  private *constructionVehicle(p: Player): Flow<boolean> {
    if ((p.traffic & 3) === 3) return false;
    if (p.traffic === 1 || p.traffic === 2) p.tools[p.traffic + 3] += 1;
    p.savedTraffic = p.traffic;
    p.savedDice = p.dice;
    p.traffic = CONSTRUCTION_TRAFFIC;
    p.dice = 1;
    p.tools[11] -= 1;
    yield { t: 'fx', kind: 'construction', p: p.id };
    return true;
  }

  // ---------------------------------------------------------------- screen helpers

  /** Every road node of the board; for a human the screen limits the choice (`onScreen` picks, 05 §2.6). */
  private roadNodes(): number[] {
    return this.g.board.nodes.filter(n => n.adjacent.some(Boolean)).map(n => n.id);
  }

  /** Road nodes inside the viewport around a player (05 §2.6, simplified to ±220 px around the player's node). */
  private viewNodes(p: Player): number[] {
    const c = this.g.node(p.node);
    return this.g.board.nodes.filter(n => n.adjacent.some(Boolean) && Math.abs(n.x - c.x) <= VIEW_HALF && Math.abs(n.y - c.y) <= VIEW_HALF).map(n => n.id);
  }

  private inView(p: Player, x: number, y: number, half = VIEW_HALF): boolean {
    const c = this.g.node(p.node);
    return Math.abs(x - c.x) <= half && Math.abs(y - c.y) <= half;
  }

  /** No player, NPC or object on the node (node status & 0xffff00 == 0). */
  private emptyNode(id: number): boolean {
    const g = this.g;
    return g.occupants(id).length === 0 && !g.places.npcs.some(c => c && c.where === 0 && c.node === id) && !g.objects.at(id);
  }

  /** Coordinates of a node id or a lot ref. */
  private position(target: number): { x: number; y: number } | null {
    const g = this.g;
    if (!target) return null;
    if (target > 2000 && target < 4000) return g.board.lands[target - 2001] ?? null;
    if (target > 4000 && target < 6000) return g.board.facilities[target - 4001] ?? null;
    return g.node(target) ?? null;
  }

  /** fcn_0040b221 / fcn_0040b343: predicted route of n nodes with the movement rule (uses rand()); fork = some step had 2+ exits. */
  private route(p: number, at: number, from: number, n: number): { nodes: number[]; fork: boolean } {
    const g = this.g, nodes: number[] = [];
    let fork = false;
    for (let i = 0; i < n; i++) {
      const node = g.node(at);
      // No square to start from (a piece just placed or teleported has no way in, lastNode 0): the route ends here.
      if (!node) break;
      if (node.adjacent.filter((a, j) => a && a !== from && !(node.oneWay & (8 >> j))).length >= 2) fork = true;
      const next = g.peekNext(p, at, from);
      from = at; at = next;
      nodes.push(at);
    }
    return { nodes, fork };
  }
  private ahead(p: Player, n: number) { return this.route(p.id, p.node, p.lastNode, n); }
  /** Behind: starts from the way in, so it yields the 2nd .. (n+1)th nodes behind. */
  private behind(p: Player, n: number) { return this.route(p.id, p.lastNode, p.node, n); }

  private ownOnStreet(p: Player, name: string): number {
    return this.g.board.lands.filter(l => l.owner === p.id + 1 && l.name === name).length;
  }

  // ---------------------------------------------------------------- computer (05 §10.1)

  /** Computer's tool use for this turn (05 §10.1.2): up to 4 tools tried from a random start. */
  *aiUse(p: Player): Flow {
    const g = this.g;
    if (!p.whoPlays || g.isHuman(p)) return;
    if (g.rules?.aiTools && (yield* g.rules.aiTools(g, p))) return; // 歌舞伎町: its tools and the 傳送機 on 黑幫 (21 §4.1, §7.5)
    const list: number[] = [];
    for (let t = 1; t <= (g.world ? 16 : 13); t++) if (t !== 10 && p.tools[t - 1] > 0) list.push(t);
    const n = list.length;
    if (!n) return;
    const temper = this.temper(p);
    const start = n > 4 ? g.rng.below(n) : 0;
    for (let k = 0; k < 4; k++) {
      const t = list[(start + k) % n];
      const d = toolDef(t)!.aggression - temper;
      if (d >= 2) continue;
      if (d === 1 && g.rng.below(3) !== 0) continue;
      const param = this.judge(p, t);
      if (param === null) continue;
      yield* g.say(p.id, `使用${toolDef(t)!.name}`);
      yield* this.use(p, t, param);
      return;
    }
  }

  /** The original computer's judgement of tool `t` (its parameter, null to skip), for the smarter one at 困難 (core/smart-ai.ts). */
  judgeFor(p: Player, t: number): number | null { return this.judge(p, t); }

  /** Personality +0x17 (0 乖寶寶, 1 普通人, 2 大老奸) from the character template. */
  private temper(p: Player): number {
    return CHARACTERS[p.character]?.personality ?? 1;
  }

  /** Decision functions (table ref_004753a0, 05 §10.1.3). Returns the tool parameter, or null to skip. */
  private judge(p: Player, t: number): number | null {
    switch (t) {
      case 1: return this.judgeDoll(p);
      case 2: return this.judgeRoadblock(p);
      case 3: return this.judgeMineOrBomb(p, true);
      case 4: return this.judgeMineOrBomb(p, false);
      case 5: return p.traffic === 0 && this.g.rng.below(4) === 0 ? 0 : null;
      case 6: return (p.traffic === 0 || p.traffic === 1) && this.g.rng.below(4) === 0 ? 0 : null;
      case 7: return this.judgeMissile(p);
      case 8: return this.judgeRemoteDice(p);
      case 9: return this.judgeWorker(p);
      case 11: return this.judgeTeleporter(p);
      case 12: return (p.traffic & 3) !== 3 && this.g.rng.below(15) <= this.temper(p) ? 0 : null;
      case 13: return this.judgeNuke(p);
      // 大富豪模式's lab tools (17 §3.6).
      case 14: return this.judgeWorker(p);
      case 15: { const v = this.g.world?.hooks.aiIcbm(p) ?? -1; return v >= 0 ? v : null; }
      case 16: { const c = this.g.world?.hooks.aiSpaceTime(this.g, p) ?? -1; return c >= 0 ? 100000 + c : this.judgeTeleporter(p); }
    }
    return null;
  }

  /** fcn_00420efa: the first object within 4 nodes ahead (no fork) decides. */
  private judgeDoll(p: Player): number | null {
    const g = this.g, { nodes, fork } = this.ahead(p, 4);
    if (fork) return null;
    for (const id of nodes) {
      const o = g.objects.at(id);
      if (!o) continue;
      if ([5, 6, 7, 8, 11].includes(o.type)) return 0;
      const r = g.node(id).ref, land = r > 2000 && r < 4000 ? g.board.lands[r - 2001] : null;
      if (o.type === 17 && land && land.owner === p.id + 1) return 0;
      // 推测: "过路费" is the merged street toll of that lot's owner.
      if (o.type === 16 && land && land.owner && land.owner !== p.id + 1 && g.calcToll(land.owner, land.chain ? null : land.name) > 3000 * g.priceIndex) return 0;
      return null;
    }
    return null;
  }

  /** fcn_0042107f: stop oneself in front of something worth buying, or block a rich own street behind. */
  private judgeRoadblock(p: Player): number | null {
    const g = this.g, PI = g.priceIndex, me = p.id + 1;
    const front = this.ahead(p, 4);
    if (!front.fork) {
      const rich = p.cash + p.bank > 10000 && p.luckMoney >= 0 && !p.turtle;
      for (const id of front.nodes) {
        if (!this.emptyNode(id)) continue;
        const n = g.node(id), r = n.ref;
        if (r > 2000 && r < 4000) {
          const l = g.board.lands[r - 2001];
          if (!l.owner && (this.ownOnStreet(p, l.name) >= 2 || l.level !== 0) && rich && l.price * PI < p.cash) return id;
        } else if (r > 4000 && r < 6000) {
          const f = g.board.facilities[r - 4001];
          if (!f.owner && rich && f.price * PI < p.cash) return id;
        }
        if (n.event === 15 && p.points > 200) return id;
      }
    }
    let best: number | null = null, bestToll = 6000 * PI;
    for (const id of this.behind(p, 6).nodes) {
      const n = g.node(id);
      if (!this.inView(p, n.x, n.y) || !this.emptyNode(id)) continue;
      const l = n.ref > 2000 && n.ref < 4000 ? g.board.lands[n.ref - 2001] : null;
      if (!l || l.owner !== me) continue;
      const toll = g.calcToll(me, l.chain ? null : l.name);
      if (toll > bestToll) { best = id; bestToll = toll; }
    }
    return best;
  }

  /** fcn_004213c5 (mine) / fcn_00421574 (time bomb): a visible empty node 2..7 behind. */
  private judgeMineOrBomb(p: Player, mine: boolean): number | null {
    const g = this.g, me = p.id + 1;
    const cands = this.behind(p, 6).nodes.filter(id => { const n = g.node(id); return this.inView(p, n.x, n.y) && this.emptyNode(id); });
    // 推测: the "someone inside" flags 0x496b30 / 0x496b60 count players and NPCs.
    const inPrison = g.locals().some(q => q.prison) || g.places.npcs.some(c => c && c.where === 1);
    const inHospital = g.locals().some(q => q.hospital) || g.places.npcs.some(c => c && c.where === 2);
    const prison = g.prisonNode()?.id, hospital = g.hospitalNode()?.id;
    for (const id of cands) if ((id === prison && inPrison) || (id === hospital && inHospital)) return id;
    const pool = mine ? cands.filter(id => {
      const r = g.node(id).ref;
      const owner = r > 2000 && r < 4000 ? g.board.lands[r - 2001].owner : r > 4000 && r < 6000 ? g.board.facilities[r - 4001].owner : 0;
      return owner !== 0 && owner !== me;
    }) : cands;
    return pool.length ? pool[g.rng.below(pool.length)] : null;
  }

  /** fcn_00421717: the most hostile opponent (else a random active one) if on screen and not next to oneself. */
  private judgeMissile(p: Player): number | null {
    const g = this.g, me = p.id + 1;
    let target = -1, best = 0;
    for (let i = 0; i < g.players.length; i++) if (p.hostility[i] > best) { best = p.hostility[i]; target = i; }
    if (target < 0) {
      const active = g.players.filter(q => q.id !== p.id && q.whoPlays);
      if (!active.length) return null;
      target = active[g.rng.below(active.length)].id;
    }
    const q = g.players[target];
    if (!q || !q.placed || !q.whoPlays || g.offRoad(q)) return null;
    const c = g.node(q.node);
    if (!this.inView(p, c.x, c.y)) return null;
    const near = (x: number, y: number) => Math.abs(x - c.x) <= MISSILE_HALF && Math.abs(y - c.y) <= MISSILE_HALF;
    const self = g.node(p.node);
    if (near(self.x, self.y)) return null;
    if (g.board.lands.some(l => l.owner === me && near(l.x, l.y)) || g.board.facilities.some(f => f.owner === me && near(f.x, f.y))) return null;
    return q.node;
  }

  /** fcn_00421827: pick a value 1..6 landing on something worth buying or building. Prices not price-indexed. */
  private judgeRemoteDice(p: Player): number | null {
    const g = this.g, me = p.id + 1, god = g.objects.godType(p);
    if (g.rules?.aiRemoteDice) {
      // 大富翁城's squares and gods (docs/rules/19 §6): its own judgement, whatever god is attached.
      const ahead = this.ahead(p, 6);
      if (ahead.fork || p.turtle) return null;
      const own = g.rules.aiRemoteDice(g, p, ahead.nodes);
      if (own !== undefined) return own;
    }
    if (god === 7 || god === 8 || god === 15 || p.turtle || p.cash + p.bank < 10000 || p.luckMoney < 0) return null;
    const { nodes, fork } = this.ahead(p, 6);
    if (fork) return null;
    let cand: number | null = null, candLevel = -1;
    for (let v = 1; v <= 6; v++) {
      const id = nodes[v - 1], n = g.node(id);
      const o = g.objects.at(id);
      if (g.places.npcs.some(c => c && c.where === 0 && c.node === id) || (o && HARMFUL.has(o.type))) continue;
      if (n.ref > 2000 && n.ref < 4000) {
        const l = g.board.lands[n.ref - 2001];
        if (!l.owner && this.ownOnStreet(p, l.name) >= 2 && p.cash > l.price * 2.5) return v;
        if (l.owner === me && !l.chain && l.level < 5 && this.ownOnStreet(p, l.name) >= 2 && p.cash > l.perLevel * 2.5 && l.level > candLevel) { cand = v; candLevel = l.level; }
      } else if (n.ref > 4000 && n.ref < 6000) {
        const f = g.board.facilities[n.ref - 4001];
        if (!f.owner && p.cash > f.price * 2.5) return v;
        if (f.owner === me && f.type !== 0 && f.type !== 3 && f.level < 5 && p.cash > f.fees[0] * 2.5) return v;
      }
    }
    return cand;
  }

  /** fcn_00421ba6: own lot on screen with the best next-level value (推测: the toll/fee table). */
  private judgeWorker(p: Player): number | null {
    const g = this.g, me = p.id + 1;
    let best: number | null = null, score = -1;
    for (const l of g.board.lands) {
      if (l.owner !== me || l.chain || l.level >= 5 || !this.inView(p, l.x, l.y)) continue;
      if (l.tolls[l.level] > score) { score = l.tolls[l.level]; best = l.id + 2000; }
    }
    for (const f of g.board.facilities) {
      if (f.owner !== me || f.level >= FACILITY_MAX[f.type] || !this.inView(p, f.x, f.y)) continue;
      if (f.fees[f.level] > score) { score = f.fees[f.level]; best = f.id + 4000; }
    }
    return best;
  }

  /** fcn_00421cb6: move oneself next to an ownerless built lot (level ≥ 3) one can pay for. */
  private judgeTeleporter(p: Player): number | null {
    const g = this.g, PI = g.priceIndex;
    if (p.cash + p.bank <= 10000 || p.luckMoney < 0) return null;
    let best: number | null = null, bestLevel = 2;
    for (const id of this.viewNodes(p)) {
      if (!this.emptyNode(id)) continue;
      const r = g.node(id).ref;
      if (r > 2000 && r < 4000) {
        const l = g.board.lands[r - 2001];
        if (!l.owner && l.level > bestLevel && (l.price + l.level * l.perLevel) * PI < p.cash) { best = id; bestLevel = l.level; }
      } else if (r > 4000 && r < 6000) {
        const f = g.board.facilities[r - 4001];
        if (!f.owner && f.level > bestLevel && f.price * PI < p.cash) { best = id; bestLevel = f.level; }
      }
    }
    return best;
  }

  /** fcn_00421e62: up to 10 random tries at others' built lots where one has little to lose. */
  private judgeNuke(p: Player): number | null {
    const g = this.g, me = p.id + 1;
    type Lot = { x: number; y: number; owner: number; level: number; ref: number };
    const lots: Lot[] = [
      ...g.board.lands.map(l => ({ x: l.x, y: l.y, owner: l.owner, level: l.level, ref: l.id + 2000 })),
      ...g.board.facilities.map(f => ({ x: f.x, y: f.y, owner: f.owner, level: f.level, ref: f.id + 4000 })),
    ];
    const cands = lots.filter(l => l.owner && l.owner !== me && l.level !== 0);
    if (!cands.length) return null;
    const self = g.node(p.node), k = 1 / (g.living().length + 2);
    for (let i = 0; i < 10; i++) {
      const c = cands[g.rng.below(cands.length)];
      const near = (x: number, y: number) => Math.abs(x - c.x) <= VIEW_HALF && Math.abs(y - c.y) <= VIEW_HALF;
      if (near(self.x, self.y)) continue;
      let mine = 0, theirs = 0, mineLv = 0, theirLv = 0;
      for (const l of lots) {
        if (!l.owner || !near(l.x, l.y)) continue;
        if (l.owner === me) { mine++; mineLv += l.level; } else { theirs++; theirLv += l.level; }
      }
      if (mine / theirs < k && mineLv / theirLv < k) return c.ref;
    }
    return null;
  }

  // ---------------------------------------------------------------- the shop (05 §8, §10.2)

  /** Shop tile, t = 15 (05 §8): owner's gift, then the human shelves or the computer's shopping. */
  *shop(p: Player): Flow {
    const g = this.g, ref = g.node(p.node).ref;
    const company = ref > 6000 && ref < 8000 ? g.board.companies[ref - 6001] : undefined;
    if (company && company.controller === p.id + 1) {
      // Owner's gift (05 §8.5): rand() & 1 → a random tool, else a random card.
      if (g.rng.rand() & 1) {
        const id = yield* this.receiveRandom(p);
        // 「歡迎董事長光臨\n\n送您%s！」 for 1500 ms, then the player's line (rich4_shop.asm:1898-1971).
        if (id) yield { t: 'fx', kind: 'tool-received', p: p.id, data: { tool: id, chairman: true } };
      } else {
        // 大富豪模式: the gift may be a 複製卡 (its copies among the others in the nationwide pool; the user 2026-10-19).
        const id = yield* g.cards.receiveRandom(p, true);
        if (id) yield { t: 'fx', kind: 'card-received', p: p.id, data: { card: id, chairman: true } };
      }
    }
    const turnover = { buy: 0, sell: 0 };
    g.world?.hooks.syncWanted(); // 大富豪模式: one 通緝卡 per city (17 §3.5)
    if (g.isHuman(p)) yield* this.humanShop(p, turnover);
    else if (g.smartTactics(p)) g.smart.shop(p, turnover); // the smarter computer at 困難 (core/smart-ai.ts)
    else this.aiShop(p, turnover);
    // Turnover (05 §8.6): purchases count price × 10, sales full price × count, on the shop's company record.
    if (company) { const sum = turnover.buy + turnover.sell; company.fundA += sum; company.fundB += sum; }
  }

  /**
   * Card shelf of rand() % 10 + 6 cards drawn by the remaining copies, without replacement (05 §8.3). 大富豪模式
   * (17 §3.10, the user 2026-10-19): 轉向卡, 停留卡 and the mode's own cards (TYCOON_SHOP_ALWAYS) are always on the
   * shelf first, then the 通緝卡 while its city's copy is in, then the same 6–15 cells drawn from the nationwide pool.
   */
  cardShelf(): number[] {
    const g = this.g;
    const always = g.world ? [...TYCOON_SHOP_ALWAYS, ...((g.cards.wanted ?? 1) > 0 ? [WANTED_CARD] : [])] : [];
    const copies = [...g.cards.remaining];
    if (g.world) for (const id of [...TYCOON_SHOP_ALWAYS, WANTED_CARD, COPY_CARD]) if (id <= copies.length) copies[id - 1] = 0; // 複製卡: a gift only
    const n = g.rng.below(10) + 6, shelf: number[] = [];
    for (let i = 0; i < n; i++) {
      const total = copies.reduce((a, b) => a + b, 0);
      if (total <= 0) break; // the original divides by zero here
      let r = g.rng.below(total);
      for (let id = 0; id < copies.length; id++) {
        if (r < copies[id]) { copies[id] -= 1; shelf.push(id + 1); break; }
        r -= copies[id];
      }
    }
    return [...always, ...shelf];
  }

  /** Tool shelf: tools 1..8 still in stock, one cell each (05 §8.3); 大富豪模式 all eight, never out (17 §3.10). */
  toolShelf(): number[] {
    return [1, 2, 3, 4, 5, 6, 7, 8].filter(t => this.g.world || this.shopStock[t - 1] > 0);
  }

  /** 大富豪模式 (17 §3.10): the shop is never out of a tool 1-8 — a bought one is not taken from the 10 copies. */
  private unlimited(tool: number) { if (this.g.world && tool >= 1 && tool <= 8 && this.shopStock[tool - 1] <= 0) this.shopStock[tool - 1] = 1; }

  /**
   * A card bought at the shop goes from the pool to the hand (_rich4_receive_card). 大富豪模式 (17 §3.10): the
   * always-stocked cards and the 通緝卡 are not taken from the nationwide pool.
   */
  shopCard(p: Player, id: number) {
    const pool = this.g.cards.remaining, had = pool[id - 1];
    this.g.cards.receive(p, id);
    if (this.g.world && (shopAlways(id) || id === WANTED_CARD) && id <= pool.length) pool[id - 1] = had ?? 0;
  }

  /** _rich4_player_buy_tool: receive first, then pay (the UI already refused a full stack). */
  buyTool(p: Player, tool: number): boolean {
    this.unlimited(tool);
    const ok = this.receive(p, tool);
    p.points = (p.points - TOOLS[tool - 1].price) & 0xffff;
    this.g.stats?.toolBought(p.id, tool, TOOLS[tool - 1].price);
    return ok;
  }

  /** Sell n of a tool at 90% (05 §8.4): tools 1-8 return to the stock, 9-13 vanish. Returns the points. */
  sellTool(p: Player, tool: number, n = 1): number {
    n = Math.min(n, p.tools[tool - 1]);
    if (n <= 0) return 0;
    p.tools[tool - 1] -= n;
    if (tool <= 8) this.shopStock[tool - 1] += n;
    const pts = sellPrice(TOOLS[tool - 1].price, n);
    p.points = (p.points + pts) & 0xffff;
    return pts;
  }

  /** Sell one card from the hand at 90%; the card returns to the pool (_rich4_consume_card). */
  sellCard(p: Player, slot: number): number {
    const id = p.cards[slot];
    if (!id) return 0;
    p.cards.splice(slot, 1);
    // 大富豪模式: back to the nationwide pool, never above its copies (five cities at most); the 通緝卡 has none.
    const pool = this.g.cards.remaining, cap = this.g.world ? deckSupply(true)[id - 1] * 5 : Infinity;
    if (pool.length >= id && !(this.g.world && id === WANTED_CARD)) pool[id - 1] = Math.min(pool[id - 1] + 1, cap);
    const pts = sellPrice(cardPrice(id));
    p.points = (p.points + pts) & 0xffff;
    return pts;
  }

  /**
   * The human's shop screen (05 §8.3-8.4, 09 §7.4): one `shop` question per action until the player leaves.
   * A purchase greys out its shelf cell (cells are bought once per visit); a refused purchase (points, a full hand
   * or a full stack of 9) changes nothing and asks again, as the original only has the shopkeeper complain.
   */
  private *humanShop(p: Player, turnover: { buy: number; sell: number }): Flow {
    const g = this.g;
    const cards = this.cardShelf(), tools = this.toolShelf();
    for (;;) {
      const a = (yield ask({ t: 'shop', p: p.id, cards: [...cards], tools: [...tools], points: p.points, ...(g.world ? { always: [...TYCOON_SHOP_ALWAYS] } : {}) })) as unknown as ShopAnswer;
      if (!a || typeof a !== 'object') break;
      if ('buy' in a && a.buy === 'card') {
        const id = cards[a.index] ?? 0, price = cardPrice(id);
        if (!id || p.points < price || !g.cards.room(p, id)) continue;
        p.points = (p.points - price) & 0xffff;
        this.shopCard(p, id);
        g.stats?.cardBought(p.id, id, price);
        if (g.world && id === 36) g.world.hooks.wantedTaken(g, p);
        // A bought cell is sold out for this visit; 大富豪模式's always-stocked cards are bought as often as wanted.
        if (!g.world || !shopAlways(id)) cards[a.index] = 0;
        turnover.buy += price * 10;
      } else if ('buy' in a && a.buy === 'tool') {
        const id = tools[a.index] ?? 0, price = id ? TOOLS[id - 1].price : 0;
        if (!id || p.points < price || p.tools[id - 1] >= MAX_HELD) continue;
        this.buyTool(p, id);
        // 大富豪模式 (the user 2026-10-19): tools are bought as often as wanted, up to the stack of 9.
        if (!g.world) tools[a.index] = 0;
        turnover.buy += price * 10;
      } else if ('sell' in a && a.sell === 'card') {
        if (!p.cards[a.index]) continue;
        turnover.sell += cardPrice(p.cards[a.index]);
        this.sellCard(p, a.index);
      } else if ('sell' in a && a.sell === 'tool') {
        if (!(a.id >= 1 && a.id <= TOOLS.length) || !(p.tools[a.id - 1] > 0)) continue;
        turnover.sell += TOOLS[a.id - 1].price;
        this.sellTool(p, a.id);
      } else break;
      yield { t: 'fx', kind: 'shop', p: p.id };
    }
  }

  /** Computer's shopping (05 §10.2), no random numbers. Bug #1 fixed: cards are judged by their id. */
  private aiShop(p: Player, turnover: { buy: number; sell: number }) {
    const g = this.g, A = this.temper(p);
    const hated = (f7: number) => f7 - A === 2;
    const sellCard = (slot: number) => { turnover.sell += cardPrice(p.cards[slot]); this.sellCard(p, slot); };
    const sellTool = (t: number, n: number) => { n = Math.min(n, p.tools[t - 1]); if (n > 0) { turnover.sell += TOOLS[t - 1].price * n; this.sellTool(p, t, n); } };
    // 1. Hated cards.
    for (let i = p.cards.length - 1; i >= 0; i--) if (hated(CARD_INFO[p.cards[i] - 1]?.[2] ?? 0)) sellCard(i);
    // 2. Hated tools.
    for (const t of TOOLS) if (hated(t.aggression)) sellTool(t.id, p.tools[t.id - 1]);
    // 3. Short of points: the cheapest card, extra tools, spare copies of the ridden vehicle.
    if (p.points < 100) {
      let cheapest = -1, low = 10000;
      p.cards.forEach((id, i) => { if (cardPrice(id) < low) { low = cardPrice(id); cheapest = i; } });
      if (cheapest >= 0) sellCard(cheapest);
      for (const t of TOOLS) if (p.tools[t.id - 1] > 1) sellTool(t.id, p.tools[t.id - 1] - 1);
      if (p.traffic === 1) sellTool(5, p.tools[4]);
      if (p.traffic === 2) sellTool(6, p.tools[5]);
    }
    // 4. Budgets.
    const P = p.points;
    if (P === 0) return;
    let bc = P >> 1, bt = P - (P >> 1);
    // 5. Cards: one candidate per remaining copy, most expensive first (stable sort; Watcom qsort order 推测); the
    // remake: one per card (REMAKE_AI_ONE_CARD).
    // 大富豪模式 (17 §3.10, the user 2026-10-19): the computer sees the same shelf as the human and buys at most one of
    // each card on it — the always-stocked cards too (buying again and again is the human's alone).
    const cands: number[] = [];
    const inShop = (id: number) => (!g.world ? g.cards.remaining[id - 1] > 0 : id === WANTED_CARD ? (g.cards.wanted ?? 1) > 0 : shopAlways(id) || g.cards.remaining[id - 1] > 0);
    const shelf = g.world ? new Set(this.cardShelf()) : null;
    g.cards.remaining.forEach((n, i) => {
      const [, price, f7] = CARD_INFO[i] ?? ['', 0, 0];
      if (shelf) n = shelf.has(i + 1) ? 1 : 0;
      else if (REMAKE_AI_ONE_CARD.on) n = Math.min(n, 1);
      if (price <= bc && !hated(f7)) for (let k = 0; k < n; k++) cands.push(i + 1);
    });
    cands.sort((a, b) => cardPrice(b) - cardPrice(a));
    for (const id of cands) {
      if (!g.cards.room(p, id)) continue; // a full hand (大富豪模式: a full slot of this card too)
      const price = cardPrice(id);
      if (price > bc || p.points < price || !inShop(id)) continue;
      p.points = (p.points - price) & 0xffff;
      this.shopCard(p, id);
      g.stats?.cardBought(p.id, id, price);
      if (g.world && id === 36) g.world.hooks.wantedTaken(g, p);
      bc -= price;
      turnover.buy += price * 10;
    }
    // 6. Vehicles (strictly cheaper than the budget).
    for (const [t, ride] of [[5, 1], [6, 2]] as const) {
      const price = TOOLS[t - 1].price;
      if (p.traffic !== ride && p.tools[t - 1] === 0 && price < bt && (g.world || this.shopStock[t - 1] > 0)) {
        this.buyTool(p, t); bt -= price; turnover.buy += price * 10;
      }
    }
    // 7. One each of 8, 2, 7, 1, 4, 3.
    for (const t of AI_SHOP_ORDER) {
      const d = TOOLS[t - 1];
      if (p.tools[t - 1] < MAX_HELD && !hated(d.aggression) && d.price <= bt && (g.world || this.shopStock[t - 1] > 0)) {
        this.buyTool(p, t); bt -= d.price; turnover.buy += d.price * 10;
      }
    }
  }
}
