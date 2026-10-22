/**
 * 大富翁城's rules (docs/rules/19, a remake addition): the eight large plots are casinos (facility type 5, levels 1–5),
 * the only building there; whoever stops on someone else's casino plays one game against its banker
 * (core/modules/casino.ts) for at most the level's cap, won from or paid to the banker. No stock market; the
 * original news, fate, cards and tools that make no sense there are left out (DENY).
 *
 * Two users: the finale of 大富豪模式 (core/finale.ts, the world's sixth city) and a normal game on map 105 (§9:
 * ClassicCasino, registered in game.ts MAP_RULES below). Both share everything here.
 *
 * Each visit plays from its own random stream, made from the game's seed, the day, the player and the square (so a
 * visit plays the same however it is watched, and a saved game replays it the same); the city's rand() is untouched.
 */
import type { Facility } from './board';
import { CHARACTERS } from './characters';
import { addMonths } from './date';
import { ask, type Flow } from './flow';
import { MAP_RULES, type Game, type MapRules } from './game';
import { Rng, daySeed } from './rng';
import * as C from './modules/casino';
import { OBJECT_NAMES } from './modules/objects';
import { LAND_LIMIT_MONTHS, type Player } from './types';

/** 大富翁城's map (editor/finale_layout.py) and its name. */
export const FINALE_MAP = 105;
export const FINALE_NAME = '大富翁城';
/**
 * The five game halls (facility types after the original's 0..4, 02 §4.1, five like the original's five): the owner
 * chooses which to build, a visitor plays that game. 5 輪盤館, 6 二十一點館, 7 百家樂館, 8 德州撲克館, 9 骰寶館.
 */
export const HALLS = [5, 6, 7, 8, 9] as const;
export const HALL_GAME: Record<number, C.CasinoGame> = { 5: 'roulette', 6: 'blackjack', 7: 'baccarat', 8: 'holdem', 9: 'sicbo' };
export const HALL_TYPE: Record<C.CasinoGame, number> = { roulette: 5, blackjack: 6, baccarat: 7, holdem: 8, sicbo: 9 };
export const HALL_NAMES: Record<number, string> = { 5: '輪盤館', 6: '二十一點館', 7: '百家樂館', 8: '德州撲克館', 9: '骰寶館' };
export const isHall = (t: number) => t >= 5 && t <= 9;
/** The hall a card or tool builds on an empty plot (no choice there): each plot's own, round the five. */
export const defaultHall = (f: Facility) => 5 + ((f.id - 1) % 5);
/** Win / loss cap of one visit by casino level (the user's table, 19 §5.1). */
export const CAPS = [0, 10000, 20000, 30000, 50000, 80000];
/** The lowest stake at a table: one chip (19 §5.1); the visitor chooses freely up to the cap. */
export const MIN_STAKE = 1000;
/** Plot price and building cost (level 1) (× the price index, as every price; 19 §4). */
export const PLOT_PRICE = 10000;
export const BUILD_COST = 10000;
/** Each further level (2–5) costs a token amount (the user, 2026-10-17): 1,000 × the price index (10 chips; no blinds). */
export const UPGRADE_COST = 1000;
/** A hall's worth for total assets and rankings: the plot, the build and the upgrades paid (19 §4.3). */
export const hallWorth = (f: Facility) => f.price + (f.level ? BUILD_COST + (f.level - 1) * UPGRADE_COST : 0);
/**
 * Gods on 大富翁城 (19 §5.6, the user): only the eight money and luck gods appear (types 1–8: 小/大財神, 小/大福神,
 * 小/大窮神, 小/大衰神); 天使, 小惡魔, 土地公 and 死神 never do. A possession lasts 3 days and has only casino effects.
 */
export const CASINO_GODS = new Set([1, 2, 3, 4, 5, 6, 7, 8]);
export const NO_GODS_HERE = new Set([9, 10, 12, 15]);
export const CASINO_GOD_DAYS = 3;
/** What each god does to its holder at someone else's table (the line on the table and when it attaches). */
export const GOD_CASINO: Record<number, string> = {
  4: '必勝', 3: '贏的機會 ×1.5', 8: '必輸', 7: '輸的機會 ×1.5',
  2: '輸了與門票都不用付', 1: '輸了與門票只付一半', 6: '輸了與門票付兩倍', 5: '輸了與門票付 1.5 倍',
};
/** The payment factor of 財神 / 窮神 on the visitor's loss and 門票 (still at most what the visitor holds). */
export const GOD_PAY: Record<number, number> = { 2: 0, 1: 0.5, 6: 2, 5: 1.5 };

/** First reel's highest digit by level for the banker-absent slot (19 §5.4): Lv1 0–1 … Lv5 0–8. */
export const SLOT_TOP = [0, 1, 2, 3, 5, 8];

/**
 * What is not in 大富翁城 (19 §3): the original news, fate, cards and tools that only touch stocks, companies, the
 * ordinary lots and their streets, travel or another city's things. They never come up there; in the finale, held
 * cards and tools among them are sold on arrival (shop price, 90%, as points).
 */
export const DENY = {
  news: new Map<number, string>([
    [6, '地價上漲：一般土地與路段的地價（只有賭場用地）'], [10, '表揚股市大戶：沒有股市'], [13, '證交稅：沒有股市'],
    [14, '地價下跌：一般土地與路段的地價'], [15, '瓦斯爆炸：只炸一般土地的房屋，這裡沒有'],
    [24, '股市崩盤：沒有股市'], [25, '股市全面上漲：沒有股市'], [26, '股市暫停交易：沒有股市'], [27, '個股停牌：沒有股市'],
    [28, '個股恢復上市：沒有股市'], [29, '企業違法超貸：沒有企業'], [30, '工廠排污罰款：沒有企業'], [31, '海外投資獲利：沒有企業'],
    [32, '海外投資虧損：沒有企業'], [33, '違規開發山坡地：沒有企業'], [34, '製造噪音：沒有企業'], [35, '企業獲利倍增：沒有企業'],
  ]),
  fate: new Map<number, string>([
    [0, '強制拆除房屋：只拆一般土地的房屋'], [1, '徵收土地：只收一般土地'], [8, '股票違約交割：沒有股市'], [9, '變賣所有股票：沒有股市'],
  ]),
  cards: new Map<number, string>([
    [24, '紅卡：沒有股市'], [25, '黑卡：沒有股市'],
    [31, '飛行卡：大富翁城不能離開'], [32, '電車卡：大富翁城不能離開'], [33, '遣返卡：不能送人去別的城市'], [34, '獨裁卡：不能送人去別的城市'],
    [35, '召集卡：其他城市已經沒有人'],
  ]),
  tools: new Map<number, string>([
    [10, '時光機：會讓賭局重來（賭場的結果不能倒回）'], [16, '時空機：大富翁城不能離開'],
  ]),
};

/** The casino results of a player (the finale's results screen). */
export interface CasinoStats { visits: number; won: number; lost: number; biggest: number; bankerIn: number; bankerOut: number }
export const emptyStats = (): CasinoStats => ({ visits: 0, won: 0, lost: 0, biggest: 0, bankerIn: 0, bankerOut: 0 });

/** The visitor's choice at the table (the `casino` question's answer). */
export interface CasinoChoice { game: C.CasinoGame; stake: number; bet?: C.RouletteBet | C.BaccaratBet | C.SicboBet }

const fmt = (x: number) => x.toLocaleString('en-US');
const round = (x: number, step: number) => Math.floor(x / step) * step;

/** The casino plots and tables of 大富翁城 (the finale's and a normal game's). */
export abstract class CasinoRules implements MapRules {
  /** Games played (both modes); per-player results (shown by the finale). */
  visits = 0;
  stats: CasinoStats[] = [];
  /** Where the money went, in 元, this session (not saved; the simulations' report): buy, build, fee, lost, won, slot, tax, coupon. */
  flows: Record<string, number> = {};
  protected flow(k: string, n: number): void { this.flows[k] = (this.flows[k] ?? 0) + n; }

  /** The city of the casinos. */
  abstract game(): Game | undefined;
  /** Scale of the caps (1: the user's table). */
  scale(): number { return 1; }
  /** A line for the record (the finale's ticker; nothing in a normal game). */
  protected note(_text: string, _p: number, _important: boolean): void { /* none */ }

  /** Money in the texts: 元 (a normal game), 籌碼 in the finale (Finale overrides). */
  price(n: number): string { return `${fmt(n)}元`; }
  /** What the visitor bets with: 現金 (籌碼 in the finale). */
  moneyWord(): string { return '現金'; }

  /** Gods here (19 §5.6): the eight money / luck gods only, 3 days, no original effects (core/modules/objects.ts). */
  godAllowed(type: number): boolean { return !NO_GODS_HERE.has(type); }
  godDays(type: number): number | undefined { return CASINO_GODS.has(type) ? CASINO_GOD_DAYS : undefined; }
  readonly godsCasinoOnly = true;
  godNote(type: number): string { return GOD_CASINO[type] ? `：${GOD_CASINO[type]}` : ''; }

  /** The cards and tools on this map (19 §3.6, the user's OK of 2026-10-17). */
  readonly casinoItems = true;
  /** 飛彈 takes a hall down one level, 核子飛彈 / 洲際飛彈 back to an empty plot (owned). */
  blastMode(nuke: boolean): 0 | 1 | 2 { return nuke ? 2 : 0; }
  /** 工程車 takes the hall it stops on down one level (and does not go in). */
  readonly constructionMode = 0 as const;
  /** 機器工人 +2 levels, 超級工人 straight to Lv5. */
  workerExtra(tool: number): number { return tool === 14 ? 4 : tool === 9 ? 1 : 0; }

  /** The blinds' multiplier (the finale's 盲注遞增, 19 §5.5; 1 elsewhere). */
  blind(): number { return 1; }
  cap(level: number): number { return CAPS[Math.max(0, Math.min(5, level))] * this.scale(); }
  minStake(_level: number): number { return MIN_STAKE * this.scale(); }
  plotPrice(g: Game): number { return PLOT_PRICE * g.priceIndex; }
  buildCost(g: Game): number { return BUILD_COST * g.priceIndex; }
  /** Raising a hall one level (2–5): a token amount (19 §4.3). */
  upgradeCost(g: Game): number { return UPGRADE_COST * g.priceIndex; }
  /** A plot's worth here (Game.wealth: the classic game's total assets and ranking). */
  facilityWorth(f: Facility): number { return hallWorth(f); }

  facilityType(f: Facility): number { return defaultHall(f); }

  /** A human's free building on an empty plot (機器工人 …): the hall picker; a cancel builds the plot's default hall. */
  *pickFacilityType(_g: Game, p: Player, f: Facility): Flow<number> {
    const t = yield* this.askHall(p, f, '免費建設', true);
    return t >= 0 ? t : defaultHall(f);
  }
  /** News and fate entries that do not happen in 大富翁城 (events.ts: skipped like a failed precondition). */
  finaleDeny(kind: 'news' | 'fate', id: number): boolean { return DENY[kind].has(id); }

  /** The city's setup (a new city, a load): its plots made casino plots, no stock market, nothing denied in its pool. */
  setup(g: Game, fresh: boolean): void {
    if (fresh) for (const f of g.board.facilities) { f.price = PLOT_PRICE; f.fees = [UPGRADE_COST, ...CAPS.slice(1)]; f.type = f.level && !isHall(f.type) ? defaultHall(f) : f.level ? f.type : 0; }
    // fees[0] is the per-level cost the original's effects read (拆除卡's refund, the computers' worker): an upgrade here.
    else for (const f of g.board.facilities) if (f.fees.length) f.fees[0] = UPGRADE_COST;
    for (const id of DENY.cards.keys()) if (g.cards.remaining.length >= id) g.cards.remaining[id - 1] = 0;
    // Gods (19 §5.6): the city's 天使 / 小惡魔 / 土地公 / 死神 leave the map (the others stay where they were put).
    if (fresh) for (const o of g.objects.slots) if (NO_GODS_HERE.has(o.type) && !o.owner) o.node = 0;
    this.daily(g);
  }

  /**
   * Every day: the market stays closed (Stocks.daily counts its rest days down; 0x80 would open it again) and the
   * black market's monthly stock may not keep a denied card or tool.
   */
  daily(g: Game | undefined = this.game()): void {
    if (!g) return;
    g.stocks.restDays = 0x40;
    g.blackMarket.listings = g.blackMarket.listings.filter(l => !(l.kind === 'card' && DENY.cards.has(l.id)) && !(l.kind === 'tool' && DENY.tools.has(l.id)));
  }

  /** The total of a player's casinos (plot price and the levels built, as 02 §7.1 counts plots). */
  casinoWorth(p: Player): number {
    let w = 0;
    const g = this.game(), owner = p.id + 1;
    if (g) for (const f of g.board.facilities) if (f.owner === owner) w += hallWorth(f);
    return w;
  }

  /** The visit's own random stream (§5.3): seed, day, player, square. */
  visitRng(g: Game, p: Player): Rng {
    return new Rng(daySeed((g.rollSeed() ^ 0xca5170 ^ Math.imul(p.id + 1, 0x9e3779b1) ^ Math.imul(p.node + 1, 0x85ebca6b)) >>> 0, g.daysElapsed));
  }

  /**
   * A stop on a casino plot (19 §4): buy the plot (from cash), build the casino, raise it a level (up to 5);
   * someone else's casino: the visit (§5). Always handled here.
   */
  *landOnFacility(g: Game, p: Player, f: Facility): Flow<boolean> {
    const me = p.id + 1, god = g.objects.godType(p), human = g.isHuman(p);
    if (f.owner === 0) {
      if (p.sleepwalk || god === 12) return true;
      const price = this.plotPrice(g);
      if (price > p.cash) { if (human) yield* g.say(p.id, '您的現金不足！'); return true; }
      const yes = human
        ? (yield ask({ t: 'yesno', p: p.id, kind: 'buy-facility', text: `${f.name}賭場用地\n\n費用:${this.price(price)}\n\n是否買下此地？`, price })) as boolean
        : this.aiInvest(g, p, price);
      if (!yes) return true;
      f.owner = me;
      const months = LAND_LIMIT_MONTHS[g.settings.landLimitIndex];
      if (months) f.expire = addMonths(g.date, months);
      p.cash -= price; this.flow('buy', price);
      yield { t: 'buy', p: p.id, kind: 'facility', id: f.id, price };
      return true;
    }
    if (f.owner === me) {
      if (p.sleepwalk || f.level >= 5) return true;
      const cost = f.level === 0 ? this.buildCost(g) : this.upgradeCost(g), next = f.level + 1;
      if (cost > p.cash) { if (human) yield* g.say(p.id, '您的現金不足！'); return true; }
      const text = f.level === 0
        ? `${f.name}\n\n建設賭場（1級）:${this.price(cost)}\n每次贏錢上限 ${this.price(this.cap(1))}\n\n是否建設？`
        : `${f.name}${HALL_NAMES[f.type] ?? '賭場'}\n\n升到${next}級:${this.price(cost)}\n每次贏錢上限 ${this.price(this.cap(next))}\n\n是否升級？`;
      const yes = human ? (yield ask({ t: 'yesno', p: p.id, kind: f.level ? 'upgrade-facility' : 'build-casino', text, price: cost })) as boolean : this.aiInvest(g, p, cost);
      if (!yes) return true;
      let type = f.type;
      if (f.level === 0) {
        // The hall (19 §4): the human picks from the four plates, a computer by its own judgement.
        type = human ? yield* this.askHall(p, f, `建設費用 ${this.price(cost)}`, false) : this.aiHall(g, p, f);
        if (type < 0) return true;
      }
      f.type = type;
      f.level = next;
      p.cash -= cost; this.flow('build', cost);
      yield { t: 'build', p: p.id, kind: 'facility', id: f.id, level: f.level, cost };
      return true;
    }
    // 工程車 (19 §3.6): it does not go in; Tools.construction takes the hall down a level after the stop.
    if (f.level >= 1 && (p.traffic & 0x83) === 3 && !p.sleepwalk && !p.hotel) return true;
    if (f.level >= 1) yield* this.visit(g, p, f);
    return true;
  }

  /** The human's choice of hall (the four plates, 19 §4): the hall's type, or -1 when cancelled. */
  *askHall(p: Player, f: Facility, text: string, cancellable: boolean, except?: number): Flow<number> {
    const options = HALLS.map(t => ({ label: HALL_NAMES[t], value: t, disabled: t === except, detail: C.GAME_NAMES[HALL_GAME[t]] }));
    const a = yield ask({ t: 'choose', p: p.id, title: `${f.name}：選擇賭場`, text, options, cancellable, screen: 'casino-hall' });
    return typeof a === 'number' && isHall(a) && a !== except ? a : cancellable ? -1 : this.aiHall(undefined, p, f);
  }

  /**
   * A computer's hall (19 §6): weighed by what the banker keeps (roulette's zero ×5 and hold'em's big hands most),
   * its character (乖寶寶 the steady baccarat, 大老奸 hold'em) and the halls already standing (one of each first).
   */
  aiHall(g: Game | undefined, p: Player, f: Facility): number {
    const style = CHARACTERS[p.character]?.personality ?? 1;
    const w: Record<number, number> = { 5: 4, 6: 3, 7: 3, 8: 4, 9: 4 };
    if (style === 0) w[7] += 3; else if (style === 2) { w[8] += 2; w[9] += 2; } else w[5] += 2;
    for (const o of g?.board.facilities ?? []) if (o !== f && o.level && isHall(o.type)) w[o.type] = Math.max(1, w[o.type] - 1);
    const rng = this.visitRng(g ?? this.game()!, p);
    let r = rng.below(HALLS.reduce((a, t) => a + w[t], 0));
    for (const t of HALLS) { r -= w[t]; if (r < 0) return t; }
    return 5;
  }

  /**
   * 改建卡 on a hall (19 §4): another of the four games, the level kept. The human picks; a computer on a rival's hall
   * turns it into 二十一點館 (the hall the banker wins least at), or 百家樂館 if it is one already.
   */
  *rebuildFacility(g: Game, p: Player, f: Facility, human: boolean): Flow<number> {
    if (human) return yield* this.askHall(p, f, `改建成哪一種賭場？（等級 ${f.level} 不變）`, true, f.type);
    void g;
    return f.type === 6 ? 7 : 6;
  }

  /**
   * What a game's result is worth to the visitor (19 §5.2): a win at most the cap; a loss the stake (×2 for a double
   * or a call) times the banker's big hand, without the level's cap — all the visitor's money for the biggest ones —
   * but never more than the visitor holds (`money`, 19 §5.1: nobody loses more than they have at the table).
   */
  static settle(result: C.CasinoResult, cap: number, money: number, pay = 1): { net: number; big: { mult: number; all: boolean; why: string } } {
    const big = C.bankerMultiplier(result), have = Math.max(0, money);
    // 財神 / 窮神 (19 §5.6): × what the visitor pays on a loss, then at most what they hold.
    const net = result.net > 0 ? Math.min(cap, result.net) : result.net === 0 ? 0 : -Math.min(have, Math.trunc((big.all ? have : -result.net * big.mult) * pay));
    return { net, big };
  }

  /** What the visitor can put on the table (19 §5.1): all their money (cash + bank), in whole chips (100 元). */
  static holding(p: Player): number { return Math.max(0, Math.floor((p.cash + p.bank) / 100) * 100); }

  /** 門票: 500..5,000 in hundreds (19 §5.0); the finale's by level (19 §5.5). */
  entryFee(rng: Rng, _level = 1): number { return 100 * (5 + rng.below(46)); }

  /** A computer's buy / build / upgrade (19 §6): when it keeps at least the level-1 cap in cash for the tables. */
  aiInvest(_g: Game, p: Player, cost: number): boolean {
    return p.cash - cost >= this.cap(1);
  }

  /** Why the banker is not at the table (19 §5.4): hospital, prison, 冬眠, 夢遊; else null. */
  bankerAway(b: Player): string | null {
    return b.hospital ? '住院中' : b.prison ? '坐牢中' : b.sleep ? '冬眠中' : b.sleepwalk ? '夢遊中' : null;
  }

  /**
   * The banker-absent slot (19 §5.4): four reels; the first stops on 0..top by level (Lv1 1, Lv2 2, Lv3 3, Lv4 5,
   * Lv5 8), the others on 0..9 — all three on 0 when the first is on its top, so the amount (the number × 10) never
   * passes the cap. Below 1,000 it is 1,000 (the reels show 0100).
   */
  slotDigits(rng: Rng, level: number): number[] {
    const top = SLOT_TOP[Math.max(1, Math.min(5, level))];
    const d0 = rng.below(top + 1);
    const d = d0 === top ? [d0, 0, 0, 0] : [d0, rng.below(10), rng.below(10), rng.below(10)];
    const n = d[0] * 1000 + d[1] * 100 + d[2] * 10 + d[3];
    return n < 100 ? [0, 1, 0, 0] : d;
  }

  /** A visit to someone else's casino (19 §5): one game, its result capped by the level, paid to / by the banker. */
  *visit(g: Game, p: Player, f: Facility): Flow {
    const banker = g.players[f.owner - 1], level = f.level, cap = this.cap(level);
    if (!banker || banker.bankrupt) return;
    const where = `${g.name(banker.id)}的${f.name}${HALL_NAMES[f.type] ?? '賭場'}`;
    const game = HALL_GAME[f.type] ?? 'roulette';
    if (f.tmpState >> 4 && f.tmpState & 0xf) { yield* g.say(undefined, `${where}查封中，今天不營業！`); return; }
    if (banker.ally === p.id + 1) { yield* g.say(undefined, `與${g.name(banker.id)}同盟中，免賭！`); return; }
    this.visits += 1;
    const st = this.stats[p.id] ??= emptyStats();
    st.visits += 1;
    const rng = this.visitRng(g, p);
    // 門票 (19 §5.0): 500..5,000 in hundreds to the owner first, also when the banker is away.
    // Never more than the visitor holds (19 §5.1); 財神 / 窮神 change what the visitor pays (19 §5.6).
    const god = g.objects.godType(p), pay = GOD_PAY[god] ?? 1, godLine = GOD_CASINO[god] ? `${OBJECT_NAMES[god - 1]}附身：${GOD_CASINO[god]}` : '';
    // 漲價卡 on the hall (19 §3.6): 門票 ×2 while it lasts.
    const priceUp = f.tmpState >> 4 && !(f.tmpState & 0xf) ? 2 : 1;
    let fee = Math.min(round(this.entryFee(rng, level) * pay * priceUp, 100), CasinoRules.holding(p));
    // 免費卡 (19 §3.6): no 門票 and one free bet of the minimum (a loss of it is not paid).
    let free = false;
    if (p.cards.includes(20) && (yield* g.cards.tryFree(p, banker.id, fee, { text: `進入${where}\n門票 ${this.price(fee)}\n\n是否使用免費卡？\n（免門票，送一注最低注的免費注）` }))) { fee = 0; free = true; }
    // 嫁禍卡 (19 §3.6): only the 門票 can be passed on (never the gamble).
    let feePayer = p.id;
    if (!free && fee > 0 && p.cards.includes(19)) {
      const r = yield* g.cards.tryFrame(p, 1, fee);
      if (r >= 0) { feePayer = r; fee = Math.min(fee, CasinoRules.holding(g.players[r])); }
    }
    const note = free ? '（免費卡）' : feePayer !== p.id ? `（嫁禍給${g.name(feePayer)}）` : pay !== 1 ? `（${OBJECT_NAMES[god - 1]}附身）` : priceUp > 1 ? '（漲價中 ×2）' : '';
    yield { t: 'fx', kind: 'casino-fee', p: p.id, target: banker.id, node: p.node, data: { facility: f.id, name: f.name, hall: HALL_NAMES[f.type], level, cap, fee, god, godLine, free, payer: feePayer, priceUp, text: `${where}門票 ${this.price(fee)}${note}` } };
    if (fee > 0 && feePayer !== banker.id) {
      yield* g.transfer(feePayer, banker.id, fee, 1, '賭場門票', true);
      (this.stats[banker.id] ??= emptyStats()).bankerIn += fee;
      if (feePayer === p.id) st.lost += fee;
      this.flow('fee', fee);
    }
    if (!p.whoPlays || g.over || banker.bankrupt) return;
    const away = this.bankerAway(banker);
    if (away) {
      const digits = this.slotDigits(rng, level);
      const amount = (digits[0] * 1000 + digits[1] * 100 + digits[2] * 10 + digits[3]) * 10 * this.scale();
      yield { t: 'fx', kind: 'casino-auto', p: p.id, target: banker.id, node: p.node, data: { facility: f.id, level, cap, digits, amount, away, scale: this.scale(), text: `莊家${g.name(banker.id)}${away}，${g.name(p.id)}自動獲勝 ${this.price(amount)}！` } };
      this.flow('slot', amount);
      yield* this.payout(g, p, banker, amount);
      return;
    }
    const human = g.isHuman(p);
    // The stake (19 §5.1): from the table's minimum up to the cap, never more than the visitor holds (all-in below
    // the minimum); with nothing left the visitor only pays the 門票.
    const have = CasinoRules.holding(p);
    if (have <= 0) { if (human) yield* g.say(p.id, `${this.moneyWord()}不足，無法下注！`); return; }
    const lo = Math.min(this.minStake(level), Math.min(cap, have)), hi = free ? lo : Math.min(cap, have);
    let choice: CasinoChoice;
    if (human) {
      const a = (yield ask({ t: 'casino', p: p.id, phase: 'choose', game, hall: HALL_NAMES[f.type], banker: banker.id, facility: f.id, name: f.name, level, cap, min: lo, max: hi, mult: this.blind(), cash: p.cash + p.bank, fee, godLine, free } as never)) as unknown as CasinoChoice | undefined;
      choice = this.validChoice(game, a, lo, hi) ?? this.aiChoice(rng, game, p, lo, hi);
    } else choice = this.aiChoice(rng, game, p, lo, hi, god);
    // 福神 / 衰神 (19 §5.6): the outcome they force, the table dealt to match it (C.rigged and friends).
    const rig = this.godRig(rng, god, choice);
    const result = yield* this.play(rng, p, choice, human, have, rig);
    // The visitor's win is capped by the level; what the visitor loses is the stake (×2 for a double or a call)
    // times the banker's big hand (19 §5.2), not capped: all the visitor's money for a royal flush.
    const settled = CasinoRules.settle(result, cap, p.cash + p.bank, pay), big = settled.big;
    // The free bet's loss is not paid (免費卡).
    const net = free && settled.net < 0 ? 0 : settled.net;
    // One line with the bet and the arithmetic (the ticker, the replay's caption).
    const line = C.resultLine(result, { net, cap, mult: big.mult, all: big.all, why: big.why }, n => this.price(n), this.moneyWord());
    const text = `${g.name(p.id)}在${where}${C.betLabel(result)} ${this.price(choice.stake)}：${line}${godLine && (rig || (pay !== 1 && result.net < 0)) ? `（${godLine}）` : ''}${free ? '（免費卡的免費注）' : ''}`;
    const extra = Math.max(0, Math.min(choice.stake, have - choice.stake));
    yield { t: 'fx', kind: 'casino-result', p: p.id, target: banker.id, node: p.node, data: { facility: f.id, name: f.name, hall: HALL_NAMES[f.type], fee, level, cap, stake: choice.stake, extra, line, god, godLine, pay, result: result as unknown as Record<string, unknown>, net, raw: result.net, clipped: result.net > cap, mult: big.mult, all: big.all, why: big.why, human, text } };
    this.note(text, p.id, Math.abs(net) >= cap); // every visit on the ticker (a city off screen stays headless)
    if (net > 0) { this.flow('won', net); yield* this.payout(g, p, banker, net); }
    else if (net < 0) {
      const bs = this.stats[banker.id] ??= emptyStats();
      st.lost += -net; bs.bankerIn += -net; this.flow('lost', -net);
      g.addHostility(p.id, banker.id, Math.trunc(-net / 100));
      yield* g.transfer(p.id, banker.id, -net, 1, '賭場輸款', true);
    }
  }

  private *payout(g: Game, p: Player, banker: Player, amount: number): Flow {
    const st = this.stats[p.id] ??= emptyStats(), bs = this.stats[banker.id] ??= emptyStats();
    st.won += amount; st.biggest = Math.max(st.biggest, amount); bs.bankerOut += amount;
    g.addHostility(banker.id, p.id, Math.trunc(amount / 100));
    yield* g.transfer(banker.id, p.id, amount, 1, '賭場彩金', true);
  }

  /** The human's choice made safe: the hall's game, a known bet, the stake within lo..hi (hi = min(cap, holding)). */
  validChoice(game: C.CasinoGame, a: CasinoChoice | undefined, lo: number, hi: number): CasinoChoice | null {
    if (!a || typeof a !== 'object') return null;
    a = { ...a, game };
    const stake = Math.max(lo, Math.min(hi, Math.round(Number(a.stake) || 0)));
    if (a.game === 'roulette') {
      const b = a.bet as C.RouletteBet | undefined;
      const ok = b && ((['red', 'black', 'odd', 'even', 'low', 'high'] as string[]).includes(b.kind)
        || (b.kind === 'dozen' && [1, 2, 3].includes(b.n)) || (b.kind === 'number' && Number.isInteger(b.n) && b.n >= 0 && b.n <= 36));
      return { game: 'roulette', stake, bet: ok ? b : { kind: 'red' } };
    }
    if (a.game === 'baccarat') return { game: 'baccarat', stake, bet: (['player', 'banker', 'tie'] as string[]).includes(a.bet as string) ? a.bet : 'banker' };
    if (a.game === 'sicbo') return { game: 'sicbo', stake, bet: a.bet === 'small' ? 'small' : 'big' };
    return { game: a.game, stake };
  }

  /**
   * The computer at the table (19 §6): the hall's game, about an eighth of its money (乖寶寶 half that, 大老奸 half again
   * more) within the table's limits; roulette on red or black (a dozen now and then), baccarat on the banker (the player now and then).
   */
  aiChoice(rng: Rng, game: C.CasinoGame, p: Player, lo: number, hi: number, god = 0): CasinoChoice {
    const style = CHARACTERS[p.character]?.personality ?? 1;
    // About an eighth of its money (乖寶寶 half that, 大老奸 half again more), in thousands, within lo..hi; with a god
    // (19 §5.6): all it may under 大福神 / 大財神, twice under 小福神 / 小財神, the least under 衰神 / 窮神.
    const base = round(((p.cash + p.bank) / 8) * [0.5, 1, 1.5][style], 1000);
    const want = god === 4 || god === 2 ? hi : god === 3 || god === 1 ? base * 2 : god >= 5 && god <= 8 ? lo : base;
    const stake = Math.min(hi, Math.max(lo, want));
    if (game === 'roulette') {
      const k = rng.below(10);
      return { game, stake, bet: k < 4 ? { kind: 'red' } : k < 8 ? { kind: 'black' } : { kind: 'dozen', n: 1 + rng.below(3) } };
    }
    if (game === 'baccarat') return { game, stake, bet: rng.below(4) === 0 ? 'player' : 'banker' };
    if (game === 'sicbo') return { game, stake, bet: rng.below(2) ? 'big' : 'small' };
    return { game, stake };
  }

  /**
   * The outcome the visitor's god forces (19 §5.6): 大福神 a win, 大衰神 a loss; 小福神 / 小衰神 force it on a share x of
   * the visits so that the chance becomes 1.5 × the plain one (x = 0.5·q / (1 − q), at most all): P = x + (1 − x)·q.
   */
  godRig(rng: Rng, god: number, c: CasinoChoice): C.Rig {
    if (god === 4) return 'win';
    if (god === 8) return 'lose';
    if (god !== 3 && god !== 7) return null;
    const odds = C.baseOdds(c.game, c.bet), q = god === 3 ? odds.win : odds.lose;
    const x = q >= 2 / 3 ? 1 : (0.5 * q) / (1 - q);
    return rng.rand() / 32768 < x ? (god === 3 ? 'win' : 'lose') : null;
  }

  /**
   * Plays the chosen game (19 §5.2): the human answers the blackjack and hold'em moves, a computer by its strategy.
   * `have` is what the visitor holds: a double or a call adds at most what is left after the stake (doubling for
   * less / all-in); with nothing left there is no double, and hold'em goes to the showdown without a choice.
   */
  private *play(rng: Rng, p: Player, c: CasinoChoice, human: boolean, have = Infinity, rig: C.Rig = null): Flow<C.CasinoResult> {
    const extra = Math.max(0, Math.min(c.stake, have - c.stake));
    switch (c.game) {
      case 'roulette': return C.rigged(rig, () => C.playRoulette(rng, c.stake, c.bet as C.RouletteBet));
      case 'baccarat': return C.rigged(rig, () => C.playBaccarat(rng, c.stake, c.bet as C.BaccaratBet));
      case 'sicbo': return C.rigged(rig, () => C.playSicbo(rng, c.stake, c.bet as C.SicboBet));
      case 'blackjack': {
        const t = C.bjDealFor(rng, rig), moves: C.BjMove[] = [];
        while (!t.done) {
          let m: C.BjMove;
          if (human) {
            const a = (yield ask({ t: 'casino', p: p.id, phase: 'blackjack', player: [...t.player], up: t.dealer[0], canDouble: t.player.length === 2 && extra > 0, double: extra, stake: c.stake } as never)) as unknown;
            m = a === 'hit' || a === 'stand' || a === 'double' ? a : C.bjBasic(t.player, t.dealer[0]);
          } else m = C.bjBasic(t.player, t.dealer[0]);
          if (m === 'double' && (extra <= 0 || t.player.length !== 2)) m = 'hit';
          if (m !== 'stand') C.bjRigDraw(t, rig);
          moves.push(m);
          C.bjMove(t, m);
        }
        return C.bjSettleFor(t, c.stake, moves, extra, rig, rng);
      }
      case 'holdem': {
        const t = C.holdemDealFor(rng, rig);
        let call: boolean;
        if (extra <= 0 || (!human && rig === 'win')) call = true; // all-in on the ante: the showdown costs nothing more
        else if (human) {
          const a = (yield ask({ t: 'casino', p: p.id, phase: 'holdem', hole: [...t.hole], board: [...t.board], stake: c.stake, call: extra } as never)) as unknown;
          call = a === 'call' ? true : a === 'fold' ? false : C.holdemCall(t);
        } else call = C.holdemCall(t);
        return C.holdemSettleFor(t, c.stake, call, extra, rig, rng);
      }
    }
  }
}

/** 大富翁城 in a normal game (19 §9): the same casinos with the user's caps; normal money, settings and victory. */
export class ClassicCasino extends CasinoRules {
  constructor(readonly g: Game) {
    super();
    this.setup(g, true);
  }
  game(): Game { return this.g; }
}

MAP_RULES[FINALE_MAP] = g => new ClassicCasino(g);
