/**
 * Stock market and listed companies — docs/rules/03-stocks.md, company tiles in docs/rules/02 §5.
 * Owns: the 12 stocks of the map, player holdings, price history, market rest counter, company controllers.
 *
 * Prices, momentum and average costs are float32 like the original's `fstp dword` stores (03 §0 note):
 * every stored value goes through Math.fround, intermediate maths is double.
 */
import type { Company } from '../board';
import { ruleOn } from '../compat';
import { day as dayOf, daysBetween, weekday } from '../date';
import { CHARACTERS } from '../characters';
import { ask, type Flow } from '../flow';
import type { Game } from '../game';
import type { Player, StockOrder } from '../types';

/** 槓桿 (the user 2026-11-07): the multiples a position may have. */
export const LEVERAGE = [2, 3, 5];

/**
 * A 槓桿 position: `shares` bought (long) or sold short at `entry`, held with `margin` of the player's money (shares ×
 * entry / lev). Losing the whole margin closes it (爆倉).
 */
export interface Position { id: number; p: number; slot: number; long: boolean; lev: number; shares: number; entry: number; margin: number }

/** The official maps made in the map editor (exported as map files): their own companies link like a player's map's. */
export const EDITOR_MADE_MAPS = new Set([110, 111]);   // 長安, 清明上河
import { WheelKind } from './wheel';

const f32 = Math.fround;

/** One entry of the original 96-stock table (asm/rich4_all_stocks.c, 03 §2.2). */
export interface StockDef {
  name: string;
  /** Table flag f4: the slot is meant to be linked to a company of the map. */
  linked: boolean;
  /** f8: initial market float. */
  float: number;
  /** f12 = f16 = f20: initial price. */
  price: number;
  /** f24: volatility. */
  vol: number;
}

const d = (name: string, price: number, vol: number, float = 10000, linked = false): StockDef => ({ name, linked, float, price, vol });
const L = (name: string, price: number, vol: number, float: number): StockDef => d(name, price, vol, float, true);

/** The table group a map uses: its own pick (自建地圖), else its map number's (03 §2.1). */
export const stockGroup = (b: { mapId: number; stockGroup?: number }) => b.stockGroup ?? (((b.mapId | 0) % 8) + 8) % 8;

/** The eight stock groups, group = map number (03 §2.1, §2.2). */
export const STOCK_TABLE: readonly (readonly StockDef[])[] = [
  [ // 0 台灣
    L('中國信託', 100, 1, 10000), L('台灣人壽', 40, 0.6, 5000), L('大宇百貨', 25, 1.5, 10000), d('台積電', 180, 1.6),
    d('大宇資訊', 80, 1.2), d('台灣塑膠', 60, 1), d('裕隆汽車', 60, 1.4), d('遠東紡織', 27, 0.9),
    d('統一超商', 310, 0.7), d('震旦行', 66, 1), d('萊爾富', 171, 1.4), d('聯合報', 280, 0.8),
  ],
  [ // 1 中國大陸
    L('上海銀行', 70, 1.2, 10000), L('中國人壽', 36, 1, 5000), L('王府井百貨', 20, 1.6, 10000), L('中國石油', 15, 1.5, 0),
    d('聯想科技', 300, 2), d('頂新食品', 296, 1.8), d('東方實業', 133, 1.4), d('匯豐證券', 170, 1.5),
    d('大慶石油', 121, 0.8), d('長城電機', 60, 0.4), d('長江建設', 92, 0.6), d('大眾軟件', 366, 1),
  ],
  [ // 2 日本
    L('富士銀行', 160, 0.8, 10000), L('三井生命', 99, 1.4, 5000), L('三越百貨', 22, 2, 10000), L('日產建設', 28, 2, 5000),
    L('ＳＥＧＡ', 300, 1, 5000), L('豐田汽車', 35, 1.2, 5000), d('松下電機', 540, 1), d('日立機電', 830, 1),
    d('ＳＯＮＹ', 300, 1.2), d('三菱工業', 225, 0.7), d('任天堂', 300, 1), d('德間書店', 150, 0.8),
  ],
  [ // 3 美國
    L('花旗銀行', 200, 1, 10000), L('喬治亞人壽', 55, 0.8, 5000), L('環球百貨', 20, 2, 10000), L('聯合航空', 18, 1, 5000),
    L('福特汽車', 16, 1.4, 5000), L('ＩＢＭ', 550, 2, 5000), d('德州儀器', 245, 1.5), d('摩扥羅拉', 166, 1.3),
    d('迪士尼', 955, 1.4), d('可口可樂', 1030, 0.8), d('麥當勞', 1440, 1), d('百事可樂', 310, 1.2),
  ],
  [ // 4 星際
    L('行星銀行', 50, 1, 10000), L('銀河保險', 40, 0.6, 5000), L('宇宙百貨', 25, 1.5, 10000), d('火星移民', 90, 1.6),
    d('隕石礦業', 45, 1.2), d('星球電視', 60, 1), d('金星科技', 60, 1.4), d('星海通訊', 27, 0.9),
    d('銀河航運', 110, 0.7), d('月世界旅遊', 66, 1), d('宇宙地產', 71, 1.4), d('太陽能電力', 80, 0.8),
  ],
  [ // 5 武俠
    L('聚寶銀樓', 70, 1.2, 10000), L('狂徒鏢局', 70, 1, 5000), L('南北貨場', 20, 1.6, 10000), L('少林派', 250, 1.5, 3000),
    L('武當派', 101, 2, 3000), L('蜀山派', 96, 1.8, 5000), L('嵩山派', 120, 1.4, 6000), L('恆山派', 47, 1.5, 4000),
    L('泰山派', 40, 0.8, 5000), L('衡山派', 30, 0.4, 4000), L('華山派', 90, 0.6, 5000), L('逍遙客棧', 300, 1, 4000),
  ],
  [ // 6 恐龍
    L('黃金銀行', 60, 0.8, 10000), L('肥龍保險', 33, 1.4, 5000), L('飛龍百貨', 22, 2, 10000), d('雷龍電子', 18, 2),
    d('侏羅紀影業', 100, 1), d('長毛象紡織', 15, 1.2), d('迅猛汽車', 40, 1), d('恐龍蛋食品', 30, 1),
    d('火山岩保險', 100, 1.2), d('三葉蟲百貨', 25, 0.7), d('始祖化石', 100, 1), d('翼龍航空', 50, 0.8),
  ],
  [ // 7 假期
    L('假期銀行', 100, 1, 10000), L('假期百貨', 33, 0.8, 10000), L('狂徒大飯店', 500, 2, 3000), L('豪華大飯店', 100, 1, 5000),
    L('第一大飯店', 130, 1.4, 5000), L('金金大飯店', 150, 2, 5000), L('世界大飯店', 70, 1.5, 5000), d('百事可樂', 66, 1.3),
    d('狄士尼', 55, 1.4), d('可口可樂', 30, 0.8), d('麥當勞', 44, 1), d('愛迪達', 30, 1.2),
  ],
];

/**
 * ＨＯＴＥＬ１１ (the user 2026-11-07, 派對模式 only): the hotels' alliance. It takes the place of a stock no company of
 * the map points to; its 董事長 (the largest holder) stays at every hotel of the others for free (Game.hotelBossFree).
 */
export const HOTEL_STOCK: StockDef = d('ＨＯＴＥＬ１１', 110, 1.2);

/** One stock of the current map, `stocks_on_map` (03 §1.1). */
export interface Stock {
  name: string;
  /** +4: 0 = not a company stock, otherwise the linked company index (1-based). */
  companyId: number;
  /** +6: days left suspended. */
  suspendDays: number;
  /** +7: high nibble = days of forced limit up, low nibble = days of forced limit down. */
  forced: number;
  /** +8: shares that can be bought on the market. */
  floatPool: number;
  /** +10: shares that can be bought this turn (交易量). */
  turnQuota: number;
  basePrice: number;
  prevClose: number;
  price: number;
  volatility: number;
  /** Percent, -10..+10, kept across days. */
  momentum: number;
  lastImpulse: number;
  /** 144 daily closes, ring buffer; 0 = no data. */
  history: number[];
}

export interface Holding { shares: number; avgCost: number }

/** Trend states fcn_004295ea (03 §4.5). */
export const Trend = { Up: 0, LimitUp: 1, Down: 2, LimitDown: 3, Flat: 4 } as const;
export type Trend = (typeof Trend)[keyof typeof Trend];

/** Price display format (03 §4.4): < 15 two decimals, < 150 one, otherwise whole. */
export function formatPrice(p: number): string {
  return p < 15 ? p.toFixed(2) : p < 150 ? p.toFixed(1) : Math.trunc(p).toString();
}

/** Price step fcn_00428ec5 (03 §4.4): the change is rounded towards zero to the tick of the candidate price. */
export function adjustPrice(prev: number, pct: number): number {
  const cand = (prev * (pct + 100)) / 100;
  const tick = cand < 5 ? 0.01 : cand < 15 ? 0.05 : cand < 50 ? 0.1 : cand < 150 ? 0.5 : 1;
  let r = pct > 0 ? cand - ((cand - prev) % tick) : cand + ((prev - cand) % tick);
  if (r < 1) r = 1;
  else if (r > 9999) r = 9999;
  return f32(r);
}

/** Five states fcn_004295ea (03 §4.5). */
export function trendOf(s: Stock): Trend {
  if (s.price > s.prevClose) return s.price >= adjustPrice(s.prevClose, 10) ? Trend.LimitUp : Trend.Up;
  if (s.price < s.prevClose) return s.price <= adjustPrice(s.prevClose, -10) ? Trend.LimitDown : Trend.Down;
  return Trend.Flat;
}

/** Facility level caps by type (ref_00474940), copied from the core to avoid an import cycle. */
const FACILITY_MAX = [1, 5, 5, 1, 5, 5, 5, 5, 5, 5]; // + 5..9 大富翁城's halls (docs/rules/19)
/** The same with 10..13 歌舞伎町's shops (docs/rules/21), as the core's FACILITY_MAX_LEVEL (REMAKE_FREE_BUILD). */
const FACILITY_TOP = [...FACILITY_MAX, 5, 5, 5, 5];
/** Fee names by company category (ref_0047528e → ref_0047517c, 02 §6). */
const FEE_NAME: Record<number, string> = { 1: '旅遊費', 3: '電腦費', 4: '保險費', 5: '修車費', 6: '加油費', 11: '工程費', 12: '過路費' };

export class Stocks {
  /** Market closed for N days (0x4990dc, bit 7 = reopens tomorrow). */
  restDays = 0;
  stocks: Stock[] = [];
  /** holdings[player][slot] (0x4971a0). */
  holdings: Holding[][] = [];
  /** Shareholder ranking per company (company +0x1c..+0x1f), player id + 1, [0] = controller. */
  ranks: number[][] = [];
  /** Next history slot 0..143 (0x499100). */
  cursor = 0;
  /** Today's market drift (0x4990ec). */
  drift = 0;
  /** trunc(Σ prices × 10), today (0x499078) and at the start (0x49907c). */
  index = 0;
  baseIndex = 0;

  /** 槓桿 positions (the user 2026-11-07), every player's; saved with the module. */
  positions: Position[] = [];
  /** The next position's id. */
  nextPosition = 1;

  /** The slot ＨＯＴＥＬ１１ took (派對模式), -1 none. */
  hotelSlot = -1;
  /** Its 董事長, player id + 1 (0 none): the largest holder; a tie keeps the one already there. */
  hotelBoss = 0;

  constructor(readonly g: Game) {}

  // ---------------------------------------------------------------- setup

  /** New game: stock table for the map and company links (03 §2-§3), then the first price update (03 §4.1). */
  init(): void {
    const g = this.g;
    const group = stockGroup(g.board);
    // A remake city names the slots itself (its local firms, 03 §2.4); the numbers are the table's.
    const names = g.board.stockNames;
    // a player's map's own companies (企業大樓) may stand on a stock the table does not flag: theirs too
    // (and an official map made in the editor, exported as a map file — 長安: its 企業大樓 on stocks the table does not
    // flag were left unlinked, no shares to subscribe, no fee: the user 2026-11-19 「好多公司的建築停了之後都沒反應」)
    const own = (g.board.mapId >= 5000 && ruleOn(g.settings.level, 'maker-companies')) || EDITOR_MADE_MAPS.has(g.board.mapId)
      ? new Set(g.board.companies.map(c => c.stockSlot)) : new Set<number>();
    this.stocks = STOCK_TABLE[group].map((t, i): Stock => ({
      name: names?.[i] || t.name, companyId: t.linked || own.has(i) ? 1 : 0, suspendDays: 0, forced: 0, floatPool: t.float, turnQuota: 0,
      basePrice: f32(t.price), prevClose: f32(t.price), price: f32(t.price), volatility: f32(t.vol),
      momentum: 0, lastImpulse: 0, history: new Array(144).fill(0),
    }));
    this.holdings = g.players.map(() => Array.from({ length: 12 }, () => ({ shares: 0, avgCost: 0 })));
    this.hotelSlot = g.settings.party && !g.world ? this.freeSlot(group) : -1;
    this.hotelBoss = 0;
    if (this.hotelSlot >= 0) {
      const h = HOTEL_STOCK;
      Object.assign(this.stocks[this.hotelSlot], { name: h.name, companyId: 0, floatPool: h.float, basePrice: f32(h.price), prevClose: f32(h.price), price: f32(h.price), volatility: f32(h.vol) });
    }
    this.restDays = 0;
    this.cursor = 0;
    this.baseIndex = Math.trunc(this.stocks.reduce((s, x) => f32(s + x.basePrice), 0) * 10);
    // _rich4_init_stock_commercial (03 §3.1): the last company pointing at a flagged slot; none leaves 1 (quirk).
    this.stocks.forEach((s, slot) => {
      if (!s.companyId) return;
      g.board.companies.forEach((c, j) => { if (c.stockSlot === slot) s.companyId = j + 1; });
    });
    // an editor-made official map's new companies (長安's 西域駝隊, 長安車坊, 將作監: stocks the table floats whole) keep
    // half their shares to subscribe, as the template companies do — a stop on them asks 是否認購股份
    if (EDITOR_MADE_MAPS.has(g.board.mapId)) for (const c of g.board.companies) {
      const t = STOCK_TABLE[group][c.stockSlot];
      if (t && !t.linked && c.stockSlot < 12) this.stocks[c.stockSlot].floatPool = Math.min(this.stocks[c.stockSlot].floatPool, 5000);
    }
    if (EDITOR_MADE_MAPS.has(g.board.mapId)) this.ownShares = true;
    for (const c of g.board.companies) c.freeShares = c.stockSlot < 12 ? 10000 - this.stocks[c.stockSlot].floatPool : 0;
    this.ranks = g.board.companies.map(c => [c.controller, 0, 0, 0]);
    this.refreshQuotas();
    this.update();
  }

  /** A slot no company of the map points to, the last one, one the table does not mean for a company first; -1 none. */
  private freeSlot(group: number): number {
    const used = new Set(this.g.board.companies.map(c => c.stockSlot));
    const free = [11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0].filter(i => !used.has(i));
    return free.find(i => !STOCK_TABLE[group][i].linked) ?? free[0] ?? -1;
  }

  /** ＨＯＴＥＬ１１'s 董事長 again: someone holding more than the one there now takes it; none left with shares, nobody. */
  private rankHotel(): void {
    const slot = this.hotelSlot, n = (k: number) => this.holdings[k]?.[slot]?.shares ?? 0;
    const ps = this.g.players;
    let boss = this.hotelBoss && !ps[this.hotelBoss - 1]?.bankrupt && n(this.hotelBoss - 1) > 0 ? this.hotelBoss : 0;
    ps.forEach((q, k) => { if (!q.bankrupt && n(k) > (boss ? n(boss - 1) : 0)) boss = k + 1; });
    this.hotelBoss = boss;
  }

  /** Whether p is ＨＯＴＥＬ１１'s 董事長 (派對模式). */
  isHotelBoss(p: Player): boolean {
    if (this.hotelSlot < 0) return false;
    this.rankHotel();
    return this.hotelBoss === p.id + 1;
  }

  // ---------------------------------------------------------------- queries

  /** Linked company of a slot, if any. */
  companyOf(slot: number): Company | undefined {
    const s = this.stocks[slot];
    return s?.companyId ? this.g.board.companies[s.companyId - 1] : undefined;
  }

  /** Stock slot of a company when that stock is linked back to it. */
  slotOf(c: Company): number {
    const idx = this.g.board.companies.indexOf(c) + 1;
    return c.stockSlot < 12 && this.stocks[c.stockSlot]?.companyId === idx ? c.stockSlot : -1;
  }

  holding(p: number, slot: number): Holding { return this.holdings[p][slot]; }
  trend(slot: number): Trend { return trendOf(this.stocks[slot]); }

  /** Value of a player's shares at today's prices, added the original way (02 §7.1): truncated per stock, float32. */
  holdingsValue(w: number, p: Player): number {
    const h = this.holdings[p.id];
    if (!h) return w;
    for (let i = 0; i < 12; i++) w = Math.trunc(f32(f32(w) + h[i].shares * this.stocks[i].price));
    return w;
  }

  // ---------------------------------------------------------------- 槓桿 (the user 2026-11-07)

  /** What a position is worth now: its margin plus the gain (less the loss), never below 0. */
  positionValue(x: Position): number {
    const price = this.stocks[x.slot]?.price ?? x.entry;
    return Math.max(0, x.margin + Math.trunc((price - x.entry) * x.shares * (x.long ? 1 : -1)));
  }
  /** The price at which a position loses its whole margin (爆倉). */
  liquidationPrice(x: Position): number { return x.entry * (x.long ? 1 - 1 / x.lev : 1 + 1 / x.lev); }
  /** All of a player's positions at what they are worth now. */
  positionsValue(p: Player): number {
    return this.positions.reduce((v, x) => (x.p === p.id ? v + this.positionValue(x) : v), 0);
  }

  /**
   * Opens a position: `shares` at today's price, `lev` times the margin, which comes from the deposit. It owns no
   * shares (no dividends, no say in a company) and moves no price; it only gains or loses with the price. Refused like
   * a trade: a closed market, a suspended stock, 做多 at 漲停, 做空 at 跌停.
   */
  *openPosition(p: Player, slot: number, long: boolean, lev: number, count: number): Flow<string> {
    if (this.g.settings.noLeverage) return '這一局沒有開放槓桿'; // (派對模式's 追加玩法)
    const g = this.g, s = this.stocks[slot];
    // 派對模式 only (the user 2026-11-07)
    if (!s || !LEVERAGE.includes(lev) || g.world || !g.settings.party || !(count > 0)) return '無法開倉';
    if (!this.open()) return '本日休市';
    if (s.suspendDays) return '暫停交易';
    if (long && trendOf(s) === Trend.LimitUp) return '漲停無法做多';
    if (!long && trendOf(s) === Trend.LimitDown) return '跌停無法做空';
    const shares = Math.min(Math.trunc(count), Math.trunc((p.bank * lev) / s.price));
    if (!(shares > 0)) return '存款不足';
    const margin = Math.ceil((shares * s.price) / lev);
    p.bank -= margin;
    const x: Position = { id: this.nextPosition++, p: p.id, slot, long, lev, shares, entry: s.price, margin };
    this.positions.push(x);
    yield { t: 'fx', kind: 'position-open', p: p.id, data: { ...x } };
    return '';
  }

  /** Closes a position of `p`: what it is worth goes into the deposit. */
  *closePosition(p: Player, id: number): Flow<number> {
    const x = this.positions.find(y => y.id === id && y.p === p.id);
    if (!x) return -1;
    const v = this.positionValue(x);
    this.positions = this.positions.filter(y => y !== x);
    p.bank += v;
    yield { t: 'fx', kind: 'position-close', p: p.id, data: { ...x, value: v } };
    return v;
  }

  /** Every position that lost its whole margin is gone (爆倉); a bankrupt player's go with the rest. */
  *liquidate(): Flow {
    const g = this.g;
    for (const x of [...this.positions]) {
      const p = g.players[x.p];
      if (!p || p.bankrupt) { this.positions = this.positions.filter(y => y !== x); continue; }
      if (this.positionValue(x) > 0) continue;
      this.positions = this.positions.filter(y => y !== x);
      yield { t: 'fx', kind: 'position-liquidated', p: p.id, data: { ...x } };
      yield* g.say(p.id, `${g.name(p.id)}的${this.stocks[x.slot].name}${x.long ? '做多' : '做空'}${x.lev}倍爆倉！\n保證金${x.margin.toLocaleString('en-US')}元全部賠光`);
      if (g.over) return;
    }
  }

  /** Is the market open today (03 §4.2)? Sundays close it; holidays join once the holiday table is remade. */
  open(): boolean {
    return this.restDays === 0 && weekday(this.g.date) !== 0;
  }

  /** Total shares and share value per player, for news and taxes (06 §4.3 #10, #13). */
  shareCount(p: Player): number {
    return this.holdings[p.id].reduce((s, h) => s + h.shares, 0);
  }
  shareValue(p: Player): number {
    let v = 0;
    this.holdings[p.id].forEach((h, i) => { v = Math.trunc(v + h.shares * this.stocks[i].price); });
    return v;
  }

  /** Average of the most recent n history slots that hold a close (03 §9.2 avg6 / avg24). */
  recentAverage(slot: number, n: number): number {
    const hist = this.stocks[slot].history;
    let sum = 0, count = 0;
    for (let k = 1; k <= n; k++) {
      const v = hist[(this.cursor - k + 144 * 2) % 144];
      if (v) { sum += v; count++; }
    }
    return count ? sum / count : 0;
  }

  /** Lowest close in the 144-day history (0 when empty). */
  historyLow(slot: number): number {
    let low = 0;
    for (const v of this.stocks[slot].history) if (v && (!low || v < low)) low = v;
    return low;
  }

  // ---------------------------------------------------------------- daily

  /** Per-turn trading volume reset at each player's turn start (03 §4.7). */
  turnStart(_p: Player): void { this.refreshQuotas(); }

  /** fcn_0042915a: quota = float when ≤ 1000, else 10%..29.99% of it. */
  refreshQuotas(): void {
    for (const [i, s] of this.stocks.entries()) {
      const pool = this.onMarket(i);
      s.turnQuota = pool <= 1000 ? pool : Math.trunc((pool * (1000 + this.g.rng.rand() % 2000)) / 10000);
    }
    if (this.openShares()) this.openQuotas = true;
  }
  /** The editor-made map's own companies have their stocks and their 保留股份 (in the save; none in an older one). */
  declare ownShares?: boolean;
  /**
   * An editor-made official map's companies in a save from before they were linked (長安 2026-11-19, 清明上河 2026-11-25):
   * each its stock, up to half the shares of those the table floats whole taken out of what is still on the market as
   * its 保留股份 — whoever has bought some already (the user 2026-11-25: 「為啥我停在官窯這裡沒提示我是否認購」) — and the
   * biggest holder its 董事長. Once (`ownShares`).
   */
  relink(saved: { ownShares?: boolean } | undefined): void {
    const g = this.g;
    if (!EDITOR_MADE_MAPS.has(g.board.mapId) || saved?.ownShares) return;
    const table = STOCK_TABLE[stockGroup(g.board)];
    g.board.companies.forEach((c, j) => {
      const st = this.stocks[c.stockSlot];
      if (!st || c.stockSlot >= 12) return;
      st.companyId ||= j + 1;
      if (table?.[c.stockSlot]?.linked) return;
      if (c.freeShares <= 0) { const n = Math.min(5000, st.floatPool); st.floatPool -= n; c.freeShares = n; }
      for (const p of g.players) if (p.whoPlays && this.holdings[p.id]?.[c.stockSlot]?.shares > 0) this.rerank(p.id, c.stockSlot);
    });
    this.ownShares = true;
  }
  /** The turn's volumes were counted with the 保留股份 (in the save; no field of its own until then: a save takes no undefined). */
  declare openQuotas?: boolean;
  /**
   * A save from before open-shares has this turn's volumes without the 保留股份 — none at all for a stock whose shares are
   * all the company's (the user 2026-11-25, loading one: 「為啥股票還是買不了」): a fifth of them is added at once.
   */
  afterLoad(saved: { openQuotas?: boolean } | undefined): void {
    if (saved?.openQuotas || !this.openShares()) return;
    for (const [i, s] of this.stocks.entries()) {
      const own = this.onMarket(i) - s.floatPool;
      if (own > 0) s.turnQuota += own <= 1000 ? own : Math.trunc(own / 5);
    }
    this.openQuotas = true;
  }

  /** Daily settlement part (01 §4.2 steps 7, 8 and 10): rest counter, temporary counters, price update. */
  *daily(): Flow {
    if (this.restDays & 0x80) this.restDays = 0;
    else if (this.restDays) { this.restDays -= 1; if (!this.restDays) this.restDays = 0x80; }
    for (const s of this.stocks) {
      if (s.suspendDays) s.suspendDays -= 1;
      if (s.forced & 0xf0) s.forced -= 0x10;
      if (s.forced & 0x0f) s.forced -= 1;
    }
    if (this.update()) yield { t: 'fx', kind: 'stocks-updated' };
    yield* this.liquidate();
  }

  /** Daily price update fcn_004291d6 (03 §4.3). Returns false when the market is closed. */
  update(): boolean {
    if (!this.open()) return false;
    const rng = this.g.rng;
    const m = f32((rng.rand() - 16384) / 4097);
    this.drift = m;
    let sum = 0;
    this.stocks.forEach((s, i) => {
      s.prevClose = s.price;
      if (s.suspendDays) s.momentum = 0;
      else if (s.forced) s.momentum = s.forced & 0xf0 ? 10 : -10;
      else {
        const r = (rng.rand() - 16384) / 1171;
        s.lastImpulse = f32(r);
        // 地獄 (the user 2026-11-16: 「要不就連漲，要不就連跌」 — one could read where a share was going): yesterday's
        // move counts a quarter, today's draw more — a share wanders day by day like a real one; the same numbers drawn
        let mom = this.g.hellRules() ? f32(f32(s.momentum * 0.25 + r * s.volatility * 1.6) + m) : f32(f32(s.momentum + r * s.volatility) + m);
        const c = this.companyOf(i);
        const ref = c ? c.value / 10000 : s.basePrice;
        const hi = c ? 3 : 8, lo = c ? 0.85 : 0.5;
        if (s.prevClose > ref) { if (s.prevClose > ref * hi) mom = f32(mom * (mom > 0 ? 0.5 : 2)); }
        else if (s.prevClose < ref * lo) mom = f32(mom * (mom > 0 ? 2 : 0.5));
        s.momentum = Math.max(-10, Math.min(10, mom));
      }
      s.price = adjustPrice(s.prevClose, s.momentum);
      s.history[this.cursor] = s.price;
      sum = f32(sum + s.price);
    });
    this.cursor = (this.cursor + 1) % 144;
    this.index = Math.trunc(sum * 10);
    return true;
  }

  // ---------------------------------------------------------------- card and news hooks (03 §4.6, §8)

  /**
   * Red/black card and news: force limit up (true) or down for a stock slot, or all when slot < 0 (03 §4.6).
   * days defaults to the callers' originals: 1 for the all-stock news (#0173/#0174), 2 for the red/black card.
   * The forced byte is overwritten, then the limit applies at once (fcn_00429040: no closure or suspension check).
   */
  forceLimit(slot: number, up: boolean, days = slot < 0 ? 1 : 2): void {
    const n = Math.max(0, Math.min(15, days | 0));
    const v = up ? n << 4 : n;
    for (const [i, s] of this.stocks.entries()) if (slot < 0 || i === slot) s.forced = v;
    this.applyForced(slot);
  }

  /** fcn_00429040: forced stocks jump to their limit now and overwrite today's history slot. */
  applyForced(slot = -1): void {
    const today = (this.cursor + 143) % 144;
    for (const [i, s] of this.stocks.entries()) {
      if ((slot >= 0 && i !== slot) || !s.forced) continue;
      s.momentum = s.forced & 0xf0 ? 10 : -10;
      s.price = adjustPrice(s.prevClose, s.momentum);
      s.history[today] = s.price;
    }
  }

  /** News #0175: the whole market closes (counter 10: today and the next 10 day changes). */
  closeMarket(days = 10): void { this.restDays = days; }

  /**
   * News #0176: one stock suspended; the price goes back to yesterday's close and today's history is rewritten.
   * Bug decision #6: 10 days like the message (the original code wrote 15).
   */
  suspend(slot: number, days = 10): void {
    const s = this.stocks[slot];
    s.suspendDays = days;
    s.price = s.prevClose;
    s.history[(this.cursor + 143) % 144] = s.price;
  }

  /** News #0177: trading resumes. */
  resume(slot: number): void { this.stocks[slot].suspendDays = 0; }

  /** Slots currently suspended (news #0177 candidates). */
  suspendedSlots(): number[] { return this.stocks.flatMap((s, i) => (s.suspendDays ? [i] : [])); }

  /** News #0179-#0184: change a company's month and total surplus (not price indexed). */
  adjustProfit(c: Company, delta: number): void { c.fundA += delta; c.fundB += delta; }

  // ---------------------------------------------------------------- trading primitives

  /** A company's 保留股份 can be bought on the market as well (the user 2026-11-25, compat 'open-shares'). */
  private openShares(): boolean { return ruleOn(this.g.settings.level, 'open-shares'); }
  /** What the market holds of a stock: the floating shares and, with open-shares, the company's own. */
  onMarket(slot: number): number { return this.stocks[slot].floatPool + (this.openShares() ? Math.max(0, this.companyOf(slot)?.freeShares ?? 0) : 0); }

  /** _rich4_buy_stock market mode (03 §5.2): from the bank deposit, within the turn quota. */
  buyMarket(p: Player, slot: number, n: number): boolean {
    const s = this.stocks[slot];
    const cost = Math.trunc(n * s.price);
    s.turnQuota -= n; s.floatPool -= n;
    // (the floating ones first, then the company's own — open-shares)
    const c = s.floatPool < 0 && this.openShares() ? this.companyOf(slot) : undefined;
    if (c) { c.freeShares += s.floatPool; s.floatPool = 0; }
    p.bank -= cost;
    return this.addShares(p.id, slot, n, cost);
  }

  /** _rich4_buy_stock subscription mode (03 §5.5): cash, at trunc(valuation / 10000), from the primary shares. */
  buyPrimary(p: Player, c: Company, n: number): boolean {
    const cost = n * Math.trunc(c.value / 10000);
    c.freeShares -= n;
    p.cash -= cost;
    return this.addShares(p.id, c.stockSlot, n, cost);
  }

  private addShares(pid: number, slot: number, n: number, cost: number): boolean {
    const h = this.holdings[pid][slot];
    const old = Math.trunc(h.shares * h.avgCost);
    h.shares += n;
    h.avgCost = f32((old + cost) / h.shares);
    this.g.stats?.stockBought(pid, n, cost);
    return this.rerank(pid, slot);
  }

  /** _rich4_sell_stock (03 §5.3): proceeds to the bank deposit, or to the lottery pool when toBank is false. */
  sell(p: Player, slot: number, n: number, toBank: boolean): number {
    const s = this.stocks[slot], h = this.holdings[p.id][slot];
    const basis = Math.trunc(n * h.avgCost);
    h.shares -= n;
    if (h.shares === 0) h.avgCost = 0;
    const proceeds = Math.trunc(n * s.price);
    this.g.stats?.stockSold(p.id, n, toBank ? proceeds : 0, basis);
    s.turnQuota += n; s.floatPool += n;
    if (toBank) p.bank += proceeds; else this.g.lotteryPool += proceeds;
    this.rerank(p.id, slot);
    return proceeds;
  }

  /**
   * Player-to-player share sale (03 §5.6): the buyer's average cost uses the deal price; only the buyer is re-ranked
   * (the original's leftover ranking for the seller is kept). Money is moved by the trade screen. Returns true when
   * the buyer became the controller.
   */
  transferShares(seller: number, buyer: number, slot: number, n: number, price: number): boolean {
    const h = this.holdings[seller][slot];
    this.g.stats?.stockSold(seller, n, Math.trunc(n * price), Math.trunc(n * h.avgCost));
    h.shares -= n;
    if (h.shares === 0) h.avgCost = 0;
    return this.addShares(buyer, slot, n, Math.trunc(n * price));
  }

  /**
   * _rich4_update_commercial_owner (03 §3.2): only the player whose holding changed moves; ties keep the earlier
   * player ahead. Returns true when the controller changed.
   */
  rerank(pid: number, slot: number): boolean {
    if (slot === this.hotelSlot) { this.rankHotel(); return false; }
    const c = this.companyOf(slot);
    if (!c) return false;
    const ci = this.g.board.companies.indexOf(c);
    const me = pid + 1;
    const list = this.ranks[ci].filter(x => x && x !== me);
    while (list.length < 4) list.push(0);
    const mine = this.holdings[pid][slot].shares;
    if (mine > 0) {
      let pos = 0;
      for (let k = 2; k >= 0; k--) {
        const o = list[k];
        if (!o) continue;
        if (this.holdings[o - 1][slot].shares < mine) list[k + 1] = o;
        else { pos = k + 1; break; }
      }
      list[pos] = me;
    }
    this.ranks[ci] = list.slice(0, 4);
    const owner = this.ranks[ci][0];
    if (owner === c.controller) return false;
    c.controller = owner;
    return true;
  }

  /** Sell every share of a player (03 §5.4). Bankrupt players' shares always go to the lottery pool. */
  *sellAll(p: Player, toPool: boolean): Flow {
    const pool = toPool || p.bankrupt;
    let total = 0;
    for (let slot = 0; slot < 12; slot++) {
      const n = this.holdings[p.id][slot].shares;
      if (n > 0) total += this.sell(p, slot, n, !pool);
    }
    if (total) yield { t: 'fx', kind: 'stock-sell-all', p: p.id, data: { total, toPool: pool } };
  }

  /** Fate #0193: lose trunc(shares × percent / 100) of every stock, the proceeds go to the lottery pool. */
  *confiscate(p: Player, percent = 10): Flow {
    let total = 0;
    for (let slot = 0; slot < 12; slot++) {
      const n = Math.trunc((this.holdings[p.id][slot].shares * percent) / 100);
      if (n > 0) total += this.sell(p, slot, n, false);
    }
    if (total) yield { t: 'fx', kind: 'stock-confiscated', p: p.id, data: { total } };
  }

  // ---------------------------------------------------------------- dividends (03 §6.2)

  /** Day 15: company dividends fcn_0042ba97, also on market holidays; negative surplus is charged. */
  *dividends(): Flow {
    const g = this.g;
    const pay = g.players.map(() => 0);
    // One row per linked stock for the 「上市公司分紅」 table (rich4_ui_stock.asm:3052-3330): every player's share
    // of this month's surplus (`each`, by player id) and the surplus itself.
    const rows: { company: string; profit: number; each: number[] }[] = [];
    this.stocks.forEach((_s, slot) => {
      const c = this.companyOf(slot);
      if (!c) return;
      const living = g.players.filter(p => p.whoPlays !== 0);
      const total = living.reduce((a, p) => a + this.holdings[p.id][slot].shares, 0);
      const each = g.players.map(() => 0);
      for (const p of living) {
        const sh = this.holdings[p.id][slot].shares;
        const ratio = sh ? f32(sh / total) : 0;
        each[p.id] = Math.trunc(c.fundA * ratio);
        pay[p.id] += each[p.id];
      }
      rows.push({ company: c.name, profit: c.fundA, each });
      if (total) c.fundA = 0;
    });
    yield { t: 'fx', kind: 'dividends', data: { rows, pay: [...pay] } };
    for (const p of g.players) {
      if (!p.whoPlays) continue;
      p.bank += pay[p.id];
      if (p.bank < 0) {
        p.cash += p.bank; p.bank = 0;
        if (p.cash < 0 && !g.challenge) { p.cash = 0; yield* g.bankrupt(p); if (g.over) return; }
      }
    }
  }

  // ---------------------------------------------------------------- computer (03 §9)

  /** Computer's stock trading at the start of its turn (03 §9.2-§9.3). */
  *aiTrade(p: Player): Flow {
    if (this.g.settings.mapRules?.noStocks) return; // 自建地圖's 不能炒股
    yield* this.aiBuy(p);
    if (this.g.over || !p.whoPlays) return;
    yield* this.aiSell(p);
  }

  /** The player's stock ratio (+0x1a, 03 §9.1). */
  private stockRatio(p: Player): number { return CHARACTERS[p.character]?.stockRatio ?? 0; }

  /** fcn_0042bf03 (03 §9.2). */
  *aiBuy(p: Player): Flow {
    const g = this.g, rng = g.rng, PI = g.priceIndex;
    if (rng.rand() % 3 !== 0) return;
    const ratio = this.stockRatio(p);
    if (!ratio || !this.open()) return;
    if (p.loanDue && daysBetween(g.date, p.loanDue) < 15) return;
    let value = 0;
    this.holdings[p.id].forEach((h, i) => { value = Math.trunc(value + h.shares * this.stocks[i].price); });
    const target = Math.trunc(((p.bank + p.cash + value) * ratio) / 100);
    if (value >= target) return;
    const budget = Math.min(target - value, p.bank);
    const scores = this.stocks.map((s, slot) => {
      if (s.suspendDays || trendOf(s) === Trend.LimitUp || s.turnQuota === 0) return 0;
      const c = this.companyOf(slot);
      const mine = this.holdings[p.id][slot].shares;
      let sc = 0;
      if (c) {
        if (p.bank <= 20000 * PI) return 0;
        const avgProfit = g.monthsElapsed ? Math.trunc(c.fundB / g.monthsElapsed) : c.fundB;
        const nav = Math.trunc(c.value / 10000);
        if (avgProfit > 0 && avgProfit < 5000 * PI) sc += 1;
        else if (avgProfit >= 5000 * PI && avgProfit < 10000 * PI) sc += 2;
        else if (avgProfit >= 10000 * PI) sc += 3;
        if (c.fundA > 0 && mine < 5000 && s.price <= nav * 1.2) {
          sc += 1;
          if (c.controller && c.controller !== p.id + 1) {
            const ctl = this.holdings[c.controller - 1][slot].shares;
            if (s.floatPool + mine + c.freeShares > ctl) sc += 1;
            if (mine + s.turnQuota > ctl) sc += 2;
          }
        }
        if (s.price < nav * 0.85) sc += 3;
        if (s.price < nav * 0.7) sc += 5;
      } else {
        if (p.bank <= 30000 * PI) return 0;
        const avg24 = this.recentAverage(slot, 24), avg6 = this.recentAverage(slot, 6);
        if (s.price < s.basePrice * 2.5 && s.momentum > 2 && avg6 > avg24) sc += 2;
        if (s.price < s.basePrice * 0.6 && avg6 > avg24) sc += 4;
        if (avg6 < avg24 * 0.5) sc += 2;
      }
      return sc;
    });
    // Watcom qsort is not stable; the remake breaks ties by slot (推测).
    const order = scores.map((sc, slot) => ({ sc, slot })).sort((a, b) => b.sc - a.sc || a.slot - b.slot);
    let pick = -1;
    for (let rank = 0; rank < 12; rank++) {
      if (!order[rank].sc) continue;
      if (rng.rand() % 24 <= 12 - rank) { pick = order[rank].slot; break; }
    }
    if (pick < 0) return;
    const s = this.stocks[pick];
    const n = Math.min(Math.trunc(budget / s.price), s.turnQuota);
    if (n <= 0) return;
    const changed = this.buyMarket(p, pick, n);
    yield { t: 'fx', kind: 'stock-trade', p: p.id, data: { slot: pick, n, buy: true } };
    // Message box 「%s\n\n買進%s%d張」 1500 ms (rich4.asm:15335).
    yield* g.say(undefined, `${g.name(p.id)}\n\n買進${s.name}${n}張`);
    if (changed) yield { t: 'board' };
  }

  /** fcn_0042c79f (03 §9.3); per bug decision #5 the holding ratio is own / all players' shares. */
  *aiSell(p: Player): Flow {
    const g = this.g, PI = g.priceIndex;
    const urgent = p.loan > 0 && p.loanDue !== 0 && daysBetween(g.date, p.loanDue) <= 6 && p.bank + p.cash < p.loan;
    if (!urgent && g.rng.rand() % 3 !== 0) return;
    if (!this.open()) return;
    for (;;) {
      let best = -1, bestScore = 0;
      for (let slot = 0; slot < 12; slot++) {
        const s = this.stocks[slot], h = this.holdings[p.id][slot];
        if (!h.shares || s.suspendDays || trendOf(s) === Trend.LimitDown) continue;
        const sc = this.sellScore(p, slot, urgent, PI);
        if (sc > bestScore) { best = slot; bestScore = sc; }
      }
      if (best < 0) return;
      const s = this.stocks[best], n = this.holdings[p.id][best].shares;
      this.sell(p, best, n, true);
      yield { t: 'fx', kind: 'stock-trade', p: p.id, data: { slot: best, n, buy: false } };
      // Message box 「%s\n\n賣出%s%d張」 1500 ms (rich4.asm:16035).
      yield* g.say(undefined, `${g.name(p.id)}\n\n賣出${s.name}${n}張`);
      if (!(urgent && p.bank + p.cash < p.loan * 1.1)) return;
    }
  }

  private sellScore(p: Player, slot: number, urgent: boolean, PI: number): number {
    const g = this.g, s = this.stocks[slot], h = this.holdings[p.id][slot];
    const c = this.companyOf(slot);
    const cost = h.avgCost;
    let sc = 0;
    if (c) {
      const all = g.players.reduce((a, q) => a + this.holdings[q.id][slot].shares, 0);
      const ratio = all ? h.shares / all : 0;
      const today = dayOf(g.date);
      const me = p.id + 1;
      const isCtl = c.controller === me;
      const nav = Math.trunc(c.value / 10000);
      const avgProfit = g.monthsElapsed ? Math.trunc(c.fundB / g.monthsElapsed) : c.fundB;
      if (c.fundA <= -10000 * PI && ratio > 0.6 && today > 10 && today < 15) sc += 3;
      if (c.fundA <= -6000 * PI && s.price > cost * 1.2 && !isCtl && today > 8 && today < 15) sc += 2;
      if (avgProfit <= 10000 * PI && nav * 2 <= s.price && s.price > cost * 1.3 && ratio < 0.4) sc += 1;
      if (c.controller && !isCtl) {
        const ctl = this.holdings[c.controller - 1][slot].shares;
        if (h.shares + s.floatPool + c.freeShares < ctl && c.fundA <= 0 && s.price >= cost * 1.5) sc += 1;
      }
      if (s.price > nav * 2 && s.price > cost * 2 && s.price < s.prevClose && !isCtl) sc += 2;
      if (s.price > nav * 3 && s.price > cost * 3 && s.price < s.prevClose && isCtl) sc += 2;
      if (urgent) sc += 1;
    } else {
      const pr = cost ? s.price / cost : 0;
      const low = this.historyLow(slot);
      const avg24 = this.recentAverage(slot, 24), avg6 = this.recentAverage(slot, 6);
      const money = p.cash + p.bank;
      if (pr > 1.6 && s.momentum < 1) sc += 2;
      if (s.price > low * 8 && low * 8 > cost * 1.25) sc += 2;
      if (avg24 > avg6 && s.price < s.prevClose) sc += 2;
      if (pr >= 2) sc += Math.trunc((pr - 2) / 0.5 + 1);
      if (money < 30000 * PI && pr > 0) sc += Math.trunc(pr / 0.5 + 1);
      if (money < 16000 * PI && pr > 0) sc += Math.trunc(pr / 0.5 + 1);
      if (urgent) sc *= 2;
    }
    return sc;
  }

  /** Red card choice fcn_00420055 (03 §9.5): own stock with the largest position cost, not suspended or limit up. */
  aiRedCardSlot(p: Player): number {
    if (!this.open()) return -1;
    let best = -1, bestCost = 0;
    this.holdings[p.id].forEach((h, slot) => {
      const s = this.stocks[slot];
      if (!h.shares || s.suspendDays || trendOf(s) === Trend.LimitUp) return;
      const cost = h.shares * h.avgCost;
      if (best < 0 || cost > bestCost) { best = slot; bestCost = cost; }
    });
    return best;
  }

  /**
   * Black card choice fcn_004200ea (03 §9.5): B = the most hostile player's biggest position (any stock),
   * else A = the biggest linked position of the opponent controlling most companies; never a stock the user holds.
   */
  aiBlackCardSlot(p: Player): { slot: number; target: number } | null {
    if (!this.open()) return null;
    const g = this.g;
    const others = g.players.filter(q => q.id !== p.id && q.whoPlays !== 0);
    const pickFor = (q: Player | undefined, linkedOnly: boolean) => {
      if (!q) return -1;
      let best = -1, bestCost = 0;
      this.holdings[q.id].forEach((h, slot) => {
        const s = this.stocks[slot];
        if (!h.shares || s.suspendDays || this.holdings[p.id][slot].shares || trendOf(s) === Trend.LimitDown) return;
        if (linkedOnly && !s.companyId) return;
        const cost = h.shares * h.avgCost;
        if (best < 0 || cost > bestCost) { best = slot; bestCost = cost; }
      });
      return best;
    };
    let hostile: Player | undefined;
    for (const q of others) if (p.hostility[q.id] > 0 && (!hostile || p.hostility[q.id] > p.hostility[hostile.id])) hostile = q;
    const b = pickFor(hostile, false);
    if (b >= 0) return { slot: b, target: hostile!.id };
    let tycoon: Player | undefined, most = 0;
    for (const q of others) {
      const n = g.board.companies.filter(c => c.controller === q.id + 1).length;
      if (n > most) { tycoon = q; most = n; }
    }
    const a = pickFor(tycoon, true);
    return a >= 0 ? { slot: a, target: tycoon!.id } : null;
  }

  // ---------------------------------------------------------------- human market (03 §5.2-§5.3)

  /** Human's stock market screen from the turn menu. */
  *humanMarket(p: Player): Flow {
    const g = this.g;
    // 大富豪模式: one screen for the five cities' 60 stocks (docs/rules/17 §5).
    if (g.world) { yield* g.world.hooks.humanMarket(p, g); return; }
    if (g.settings.mapRules?.noStocks) { yield* g.say(undefined, '這張地圖不能炒股'); return; }
    if (!this.open()) { yield* g.say(undefined, '本日休市'); return; }
    // 即時制 (the user 2026-11-08): the prices of the moment the market was opened hold for every trade in it, however the
    // days go on meanwhile (the screen leaves by itself after three days)
    const lock = g.rt ? this.stocks.map(s => s.price) : undefined;
    // 即時制: once between two rolls (the user 2026-11-08: no sitting in the market instead of playing the board)
    // and a day after leaving it (the user: rolling alone is not enough)
    if (g.rt && !g.rt.marketIn(p.id)) { yield* g.say(p.id, '要擲一次骰子、再過一天，才能再進股市'); return; }
    try { yield* this.market(p, lock); } finally { g.rt?.marketOut(p.id); }
  }

  /** The market's trades, one question each (humanMarket). */
  private *market(p: Player, lock?: number[]): Flow {
    const g = this.g;
    for (;;) {
      if (g.over || !p.whoPlays) return;
      // The screen shows the tables and the company pages; each trade it asks for is checked here (03 §5.2-5.3).
      const a = (yield ask({ t: 'stock-market', p: p.id })) as { slot: number; buy: boolean; n: number; lev?: number } | { close: number } | number | undefined;
      if (!a || typeof a !== 'object') return;
      if ('close' in a) { yield* this.closePosition(p, a.close); continue; }
      const slot = a.slot;
      if (a.lev && a.lev > 1) {
        if (Number.isInteger(slot) && slot >= 0 && slot < 12) { const why = yield* this.openPosition(p, slot, !!a.buy, a.lev, a.n); if (why) yield* g.say(p.id, why); }
        continue;
      }
      if (!Number.isInteger(slot) || slot < 0 || slot >= 12) return;
      yield* this.trade(p, slot, a.buy, a.n, slot, lock);
    }
  }

  /** One trade the market screen asked for, checked as the original does (03 §5.2-5.3); `shown`: the slot the screen knows it by. */
  *trade(p: Player, slot: number, buy: boolean, count: number, shown = slot, lock?: number[]): Flow {
    const g = this.g, s = this.stocks[slot], h = this.holdings[p.id][slot];
    if (s.suspendDays || g.settings.mapRules?.noStocks) return;
    // `lock`: 即時制's prices of the moment the market was opened, used for this one trade (put back at once)
    const at = <T>(f: () => T): T => { const real = s.price; if (lock?.[slot]) s.price = lock[slot]; try { return f(); } finally { s.price = real; } };
    if (buy) {
      if (trendOf(s) === Trend.LimitUp) { yield* g.say(p.id, '漲停無法買進！'); return; }
      const n = Math.min(s.turnQuota, Math.trunc(p.bank / (lock?.[slot] || s.price)), Math.trunc(count));
      if (!(n > 0)) return;
      at(() => this.buyMarket(p, slot, n));
      yield { t: 'fx', kind: 'stock-trade', p: p.id, data: { slot: shown, n, buy: true } };
    } else {
      if (trendOf(s) === Trend.LimitDown) { yield* g.say(p.id, '跌停無法賣出！'); return; }
      const n = Math.min(h.shares, Math.trunc(count));
      if (!(n > 0)) return;
      at(() => this.sell(p, slot, n, true));
      yield { t: 'fx', kind: 'stock-trade', p: p.id, data: { slot: shown, n, buy: false } };
    }
  }

  /**
   * 派對模式's 等待中下單 (the user 2026-11-07): the orders placed during the turn that just ended, oldest first, under the
   * rules of the market screen (the deposit, the volume, 漲停 / 跌停) at the price of this moment. In step on every
   * phone: all come in one answer, between two turns, so no toll, no controller and no bankruptcy changes halfway.
   * Each order says how it went ('stock-order'; `why` when nothing was traded, the owner's phone tells them).
   */
  *fillOrders(orders: unknown): Flow {
    if (!Array.isArray(orders)) return;
    const g = this.g;
    let traded = false;
    for (const o of orders as Partial<StockOrder>[]) {
      const p = g.players[o?.seat ?? -1], slot = o?.slot ?? -1, s = this.stocks[slot];
      // (not `whoPlays`: it is 0 too for a player not landed yet, in the first round)
      if (!p || p.bankrupt) continue;
      if (Number.isInteger(o.close)) {
        const v = yield* this.closePosition(p, o.close!);
        if (v < 0) yield { t: 'fx', kind: 'stock-order', p: p.id, data: { close: o.close, n: 0, why: '已經爆倉或平倉', id: o.id } };
        continue;
      }
      if (!s || !Number.isInteger(o.n)) continue;
      if (o.lev && o.lev > 1) {
        const why = yield* this.openPosition(p, slot, !!o.buy, o.lev, o.n!);
        if (why) yield { t: 'fx', kind: 'stock-order', p: p.id, data: { slot, n: 0, buy: !!o.buy, lev: o.lev, why, id: o.id } };
        continue;
      }
      const buy = !!o.buy, r = this.orderSize(p, slot, buy, o.n!);
      if (r.n > 0) {
        const price = s.price;
        if (buy) this.buyMarket(p, slot, r.n); else this.sell(p, slot, r.n, true);
        traded = true;
        yield { t: 'fx', kind: 'stock-trade', p: p.id, data: { slot, n: r.n, buy } };
        yield { t: 'fx', kind: 'stock-order', p: p.id, data: { slot, n: r.n, buy, price, id: o.id } };
      } else yield { t: 'fx', kind: 'stock-order', p: p.id, data: { slot, n: 0, buy, why: r.why, id: o.id } };
    }
    if (traded && !g.over) yield* g.financeRecall();
  }

  /** How much of an order can be traded now (`trade`'s checks); nothing: why not. */
  private orderSize(p: Player, slot: number, buy: boolean, count: number): { n: number; why?: string } {
    const s = this.stocks[slot], h = this.holdings[p.id][slot];
    if (!this.open()) return { n: 0, why: '本日休市' };
    if (s.suspendDays) return { n: 0, why: '暫停交易' };
    if (buy) {
      if (trendOf(s) === Trend.LimitUp) return { n: 0, why: '漲停' };
      const n = Math.min(s.turnQuota, Math.trunc(p.bank / s.price), Math.trunc(count));
      return n > 0 ? { n } : { n: 0, why: '存款或交易量不足' };
    }
    if (trendOf(s) === Trend.LimitDown) return { n: 0, why: '跌停' };
    const n = Math.min(h.shares, Math.trunc(count));
    return n > 0 ? { n } : { n: 0, why: '持股不足' };
  }

  // ---------------------------------------------------------------- company tiles (02 §5, 03 §5.5, §7)

  /** Stopping on a company tile: controller services, fees, then the share subscription offer (02 §5, 03 §5.5). */
  *landOnCompany(p: Player, c: Company): Flow {
    const g = this.g, at = p.node;
    if (c.controller === p.id + 1) { const ship = g.rules?.companyShip?.(g, p, c); if (ship) yield* ship.boss(); else yield* this.controllerService(p, c); }
    else if (c.controller) yield* this.companyFee(p, c);
    if (g.over || !p.whoPlays || p.node !== at) return;   // (shipped off: no shares from there)
    yield* this.subscribe(p, c);
  }

  /** Controller's own visit (02 §5): insurance days for free, or the construction company's free building. */
  private *controllerService(p: Player, c: Company): Flow {
    const g = this.g;
    if (c.category === 4) {
      const n = yield* g.spin(WheelKind.insurance, c.name);
      p.insurance = (p.insurance + n) & 0x7f;
      yield* g.say(p.id, `免費增加保險${n}天`);
    } else if (c.category === 11) {
      const ref = yield* this.pickBuilding(p, '選擇免費加蓋的地產');
      if (!ref) return;
      const first = yield* this.freeFloor(p, ref);
      let level = first;
      if (first >= 0 && !(first & 0x80)) { const second = g.freeUpgrade(ref); if (second >= 0) level = second; }
      // core_actions:1810-1861: the robot crew Data#553; when the first floor topped it out, the owner's event[15]
      // and fireworks (only the first call's 0x80 is tested, so a top reached by the second floor stays quiet).
      // The remake (REMAKE_FREE_BUILD): fireworks whenever the floors top it out.
      const top = level >= 0 && (level & 0x80) !== 0 && ((first & 0x80) !== 0 || g.remakeFreeBuild);
      if (level >= 0) { yield { t: 'fx', kind: 'free-upgrade', p: p.id, data: { ref, level: level & 0x7f, top, own: true } }; yield { t: 'board' }; }
    }
  }

  /** Someone else's company (02 §5): fee by category into the company funds, through the payment chain. */
  private *companyFee(p: Player, c: Company): Flow {
    const g = this.g, PI = g.priceIndex;
    if (g.rules?.companyFeeOff?.(g, c)) return;
    const idx = g.board.companies.indexOf(c) + 1;
    const boss = g.name(c.controller - 1);
    const ship = g.rules?.companyShip?.(g, p, c);
    const fee = ship?.fee ?? g.rules?.companyFeeName?.(c) ?? FEE_NAME[c.category] ?? '過路費';
    const price = c.baseFee;
    let amount = 0, travel = 0;
    switch (c.category) {
      case 1: {
        travel = yield* g.spin(WheelKind.travel, c.name);
        if (!travel) { yield* g.say(p.id, '不用出國！'); break; }
        amount = price * travel * PI;
        yield* g.say(p.id, `出國旅遊${travel}天\n\n${fee}${amount}元`);
        break;
      }
      case 3: amount = price * g.daysElapsed; break;
      case 4: {
        const n = yield* g.spin(WheelKind.insurance, c.name);
        p.insurance = (p.insurance + n) & 0x7f;
        amount = price * n * PI;
        yield* g.say(p.id, `保險${n}天\n\n${fee}${amount}元`);
        break;
      }
      case 5: case 6: {
        // (the shipper: on foot as on a motorbike, as at a 漕運處)
        const v = ship ? Math.min(2, Math.max(1, p.traffic & 3)) : p.traffic & 3;
        amount = v ? price * (1 << (v - 1)) * g.diceTotal * PI : 0;
        break;
      }
      case 11: {
        const ref = yield* this.pickBuilding(p, '選擇要加蓋的地產');
        const level = ref ? yield* this.freeFloor(p, ref) : -1;
        if (ref && level >= 0) {
          // core_actions:2014-2043: the robot crew Data#553, fireworks at the top, no line.
          yield { t: 'fx', kind: 'free-upgrade', p: p.id, data: { ref, level: level & 0x7f, top: (level & 0x80) !== 0, own: false } };
          yield { t: 'board' };
        }
        amount = ref ? (ref < 4000 ? g.board.lands[ref - 2001].price : g.board.facilities[ref - 4001].price) * PI : 1000 * PI;
        break;
      }
      case 12: amount = price * g.diceTotal * PI; break;
    }
    if (amount > 0) {
      yield* g.say(undefined, c.category === 12 ? `幫主${boss} 請付${amount}元${fee}` : `董事長${boss} 請付${amount}元${fee}`);
      const paid = yield* this.collect(p, c.controller - 1, amount, fee);
      if (paid) yield* g.transfer(paid.payer, 100 + idx, paid.amount, 0, fee);
    }
    if (travel && p.whoPlays && !g.over) yield* g.vanish(p, travel, false);
    if (ship && p.whoPlays && !g.over) yield* ship.go();
  }

  /** The core's payment chain for company fees (02 §5): payer's god, passive cards, then Death/chest paying instead. */
  private *collect(p: Player, ownerId: number, total: number, fee: string): Flow<{ payer: number; amount: number } | null> {
    const g = this.g;
    let amount = g.godModify(p, total);
    if (amount !== total) yield* g.say(p.id, g.rules?.godFeeText?.(g, p, fee, total, amount) ?? (amount === 0 ? `${fee}免付！` : `${fee}改為${amount}元`));
    if (amount === 0) return null;
    const r = yield* g.cards.tollPassive(p, ownerId, amount);
    let payer = r.payer;
    amount = r.amount;
    if (amount === 0) return null;
    const death = g.objects.deathPayer(g.players[payer]);
    if (death !== null) { yield* g.say(undefined, `死神顯靈\n\n由${g.name(death)}賠償${fee}`); payer = death; }
    return { payer, amount };
  }

  /**
   * Properties the player can have built up for free: own lots below the top and own large plots — an empty one
   * (built first) or a facility below its type's top, on every map (REMAKE_FREE_BUILD; off: built facilities of the
   * original types and 大富翁城's halls only).
   */
  upgradableRefs(p: Player): number[] {
    const me = p.id + 1, refs: number[] = [], all = this.g.remakeFreeBuild;
    this.g.board.lands.forEach((l, i) => { if (l.owner === me && (l.chain ? l.level < 1 : l.level < 5)) refs.push(2001 + i); });
    this.g.board.facilities.forEach((f, i) => {
      if (f.owner === me && (all ? f.level === 0 || f.level < FACILITY_TOP[f.type] : f.level >= 1 && f.level < FACILITY_MAX[f.type])) refs.push(4001 + i);
    });
    return refs;
  }

  /** One free floor (fcn_0040b110): an empty large plot is built first (the facility type asked as for 機器工人). */
  private *freeFloor(p: Player, ref: number): Flow<number> {
    const f = ref > 4000 && ref < 6000 ? this.g.board.facilities[ref - 4001] : undefined;
    if (f && f.level === 0 && this.g.remakeFreeBuild) return yield* this.g.buildEmptyPlot(p, f);
    return this.g.freeUpgrade(ref);
  }

  /**
   * Building target for the construction company, from `upgradableRefs` for both (the original lets a human pick any
   * lot or large plot, select flags 0x2090086, and the computer's fcn_0040b455 takes its own lots and large plots,
   * empty ones too): a human taps one, the computer takes the one whose toll/fee at its current level is highest
   * (the original rates a large plot by its price +0x22, docs/rules/02 §5). Returns the ref or 0.
   */
  private *pickBuilding(p: Player, title: string): Flow<number> {
    const g = this.g;
    const refs = this.upgradableRefs(p);
    if (!refs.length) return 0;
    if (g.isHuman(p)) {
      // One choice per property, glowing on the building itself (lots and large plots alike, as for 機器工人).
      const at = new Map<number, number>();
      for (const n of g.board.nodes) if (refs.includes(n.ref) && !at.has(n.ref)) at.set(n.ref, n.id);
      const id = Number(yield ask({ t: 'pick-node', p: p.id, title, nodes: [...at.values()], cancellable: true, plot: true }));
      const node = id > 0 ? g.board.nodes.find(n => n.id === id) : undefined;
      return node && refs.includes(node.ref) ? node.ref : 0;
    }
    let best = 0, bestScore = -1;
    for (const ref of refs) {
      const score = ref < 4000 ? g.board.lands[ref - 2001].tolls[g.board.lands[ref - 2001].level] : g.board.facilities[ref - 4001].fees[g.board.facilities[ref - 4001].level];
      if (score > bestScore) { best = ref; bestScore = score; }
    }
    return best;
  }

  /** Share subscription fcn_0041d1a9 (03 §5.5): cash, trunc(valuation / 10000) each, at most 1000 per visit. */
  private *subscribe(p: Player, c: Company): Flow {
    const g = this.g;
    if (p.sleepwalk || !p.whoPlays || c.freeShares <= 0 || this.slotOf(c) < 0 || g.settings.mapRules?.noStocks) return;
    const unit = Math.trunc(c.value / 10000);
    if (unit <= 0) return;
    const max = Math.min(Math.trunc(p.cash / unit), 1000, c.freeShares);
    let n: number;
    if (g.isHuman(p)) {
      if (max <= 0) return;
      const yes = (yield ask({ t: 'yesno', p: p.id, kind: 'subscribe', text: `${c.name}\n\n每股售價${unit}\n\n是否認購股份？`, price: unit })) as boolean;
      if (!yes) return;
      n = Math.trunc(Number(yield ask({ t: 'amount', p: p.id, title: `認購${c.name}`, text: `每股${unit}元`, min: 0, max, step: 1 })));
      n = n > 0 ? Math.min(n, max) : 0;
    } else {
      const reserve = Math.trunc(g.fund * 0.3) * g.priceIndex;
      n = p.cash - reserve > 0 ? Math.min(max, Math.trunc((p.cash - reserve) / unit)) : 0;
    }
    if (n <= 0) return;
    const changed = this.buyPrimary(p, c, n);
    yield { t: 'fx', kind: 'stock-subscribe', p: p.id, data: { slot: c.stockSlot, n, price: unit } };
    if (changed) {
      yield { t: 'board' };
      // Message box 1500 ms (core_actions:5033-5043).
      if (c.controller === p.id + 1) yield* g.say(undefined, c.category === 12 ? '恭喜您成為幫主！' : '恭喜您獲得經營權！');
    }
  }
}
