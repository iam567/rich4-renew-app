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
/** Plot price, building cost and the cost of each further level (× the price index, as every price; 19 §4). */
export const PLOT_PRICE = 10000;
export const BUILD_COST = 10000;
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
    [24, '紅卡：沒有股市'], [25, '黑卡：沒有股市'], [27, '漲價卡：賭場不收過路費'],
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

  cap(level: number): number { return CAPS[Math.max(0, Math.min(5, level))] * this.scale(); }
  minStake(_level: number): number { return MIN_STAKE * this.scale(); }
  plotPrice(g: Game): number { return PLOT_PRICE * g.priceIndex; }
  buildCost(g: Game): number { return BUILD_COST * g.priceIndex; }

  facilityType(f: Facility): number { return defaultHall(f); }
  /** News and fate entries that do not happen in 大富翁城 (events.ts: skipped like a failed precondition). */
  finaleDeny(kind: 'news' | 'fate', id: number): boolean { return DENY[kind].has(id); }

  /** The city's setup (a new city, a load): its plots made casino plots, no stock market, nothing denied in its pool. */
  setup(g: Game, fresh: boolean): void {
    if (fresh) for (const f of g.board.facilities) { f.price = PLOT_PRICE; f.fees = [BUILD_COST, ...CAPS.slice(1)]; f.type = f.level && !isHall(f.type) ? defaultHall(f) : f.level ? f.type : 0; }
    for (const id of DENY.cards.keys()) if (g.cards.remaining.length >= id) g.cards.remaining[id - 1] = 0;
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
    if (g) for (const f of g.board.facilities) if (f.owner === owner) w += f.price + f.level * f.fees[0];
    return w;
  }

  /** The visit's own random stream (§5.3): seed, day, player, square. */
  visitRng(g: Game, p: Player): Rng {
    return new Rng(daySeed((g.settings.seed ^ 0xca5170 ^ Math.imul(p.id + 1, 0x9e3779b1) ^ Math.imul(p.node + 1, 0x85ebca6b)) >>> 0, g.daysElapsed));
  }

  /**
   * A stop on a casino plot (19 §4): buy the plot (from cash), build the casino, raise it a level (up to 5);
   * someone else's casino: the visit (§5). Always handled here.
   */
  *landOnFacility(g: Game, p: Player, f: Facility): Flow<boolean> {
    const me = p.id + 1, god = g.objects.godType(p), human = g.isHuman(p);
    const priv = g as unknown as { investmentBlocked(p: Player): Flow<boolean>; blessing(p: Player, ref: number): Flow };
    if (f.owner === 0) {
      if (p.sleepwalk || god === 12) return true;
      const price = this.plotPrice(g);
      if (price > p.cash) { if (human) yield* g.say(p.id, '您的現金不足！'); return true; }
      const yes = human
        ? (yield ask({ t: 'yesno', p: p.id, kind: 'buy-facility', text: `${f.name}賭場用地\n\n費用:${this.price(price)}\n\n是否買下此地？`, price })) as boolean
        : this.aiInvest(g, p, price);
      if (!yes) return true;
      if (yield* priv.investmentBlocked(p)) return true;
      f.owner = me;
      const months = LAND_LIMIT_MONTHS[g.settings.landLimitIndex];
      if (months) f.expire = addMonths(g.date, months);
      p.cash -= price;
      yield { t: 'buy', p: p.id, kind: 'facility', id: f.id, price };
      return true;
    }
    if (f.owner === me) {
      if (p.sleepwalk || f.level >= 5) return true;
      const cost = this.buildCost(g), next = f.level + 1;
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
      if (yield* priv.investmentBlocked(p)) return true;
      f.type = type;
      f.level = next;
      p.cash -= cost;
      yield { t: 'build', p: p.id, kind: 'facility', id: f.id, level: f.level, cost };
      yield* priv.blessing(p, f.id + 4000);
      return true;
    }
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
  static settle(result: C.CasinoResult, cap: number, money: number): { net: number; big: { mult: number; all: boolean; why: string } } {
    const big = C.bankerMultiplier(result), have = Math.max(0, money);
    const net = result.net > 0 ? Math.min(cap, result.net) : result.net === 0 ? 0 : -Math.min(have, big.all ? have : -result.net * big.mult);
    return { net, big };
  }

  /** What the visitor can put on the table (19 §5.1): all their money (cash + bank), in whole chips (100 元). */
  static holding(p: Player): number { return Math.max(0, Math.floor((p.cash + p.bank) / 100) * 100); }

  /** 門票: 500..5,000 in hundreds (19 §5.0). */
  entryFee(rng: Rng): number { return 100 * (5 + rng.below(46)); }

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
    // Never more than the visitor holds (19 §5.1).
    const fee = Math.min(this.entryFee(rng), CasinoRules.holding(p));
    yield { t: 'fx', kind: 'casino-fee', p: p.id, target: banker.id, node: p.node, data: { facility: f.id, name: f.name, hall: HALL_NAMES[f.type], level, cap, fee, text: `${where}門票 ${this.price(fee)}` } };
    yield* g.transfer(p.id, banker.id, fee, 1, '賭場門票', true);
    (this.stats[banker.id] ??= emptyStats()).bankerIn += fee;
    st.lost += fee;
    if (!p.whoPlays || g.over || banker.bankrupt) return;
    const away = this.bankerAway(banker);
    if (away) {
      const digits = this.slotDigits(rng, level);
      const amount = (digits[0] * 1000 + digits[1] * 100 + digits[2] * 10 + digits[3]) * 10 * this.scale();
      yield { t: 'fx', kind: 'casino-auto', p: p.id, target: banker.id, node: p.node, data: { facility: f.id, level, cap, digits, amount, away, scale: this.scale(), text: `莊家${g.name(banker.id)}${away}，${g.name(p.id)}自動獲勝 ${this.price(amount)}！` } };
      yield* this.payout(g, p, banker, amount);
      return;
    }
    const human = g.isHuman(p);
    // The stake (19 §5.1): from the table's minimum up to the cap, never more than the visitor holds (all-in below
    // the minimum); with nothing left the visitor only pays the 門票.
    const have = CasinoRules.holding(p);
    if (have <= 0) { if (human) yield* g.say(p.id, `${this.moneyWord()}不足，無法下注！`); return; }
    const hi = Math.min(cap, have), lo = Math.min(this.minStake(level), hi);
    let choice: CasinoChoice;
    if (human) {
      const a = (yield ask({ t: 'casino', p: p.id, phase: 'choose', game, hall: HALL_NAMES[f.type], banker: banker.id, facility: f.id, name: f.name, level, cap, min: lo, max: hi, cash: p.cash + p.bank, fee } as never)) as unknown as CasinoChoice | undefined;
      choice = this.validChoice(game, a, lo, hi) ?? this.aiChoice(rng, game, p, lo, hi);
    } else choice = this.aiChoice(rng, game, p, lo, hi);
    const result = yield* this.play(rng, p, choice, human, have);
    // The visitor's win is capped by the level; what the visitor loses is the stake (×2 for a double or a call)
    // times the banker's big hand (19 §5.2), not capped: all the visitor's money for a royal flush.
    const { net, big } = CasinoRules.settle(result, cap, p.cash + p.bank);
    const text = net > 0 ? `${g.name(p.id)}在${where}贏了 ${this.price(net)}！`
      : net < 0 ? `${g.name(p.id)}在${where}輸了 ${this.price(-net)}${big.why ? `（${big.why}${big.all ? `，全部${this.moneyWord()}` : ` ×${big.mult}`}）` : ''}` : `${g.name(p.id)}在${where}打平`;
    yield { t: 'fx', kind: 'casino-result', p: p.id, target: banker.id, node: p.node, data: { facility: f.id, name: f.name, hall: HALL_NAMES[f.type], fee, level, cap, stake: choice.stake, result: result as unknown as Record<string, unknown>, net, raw: result.net, clipped: result.net > cap, mult: big.mult, all: big.all, why: big.why, human, text } };
    if (Math.abs(net) >= cap / 2) this.note(text, p.id, Math.abs(net) >= cap);
    if (net > 0) yield* this.payout(g, p, banker, net);
    else if (net < 0) {
      const bs = this.stats[banker.id] ??= emptyStats();
      st.lost += -net; bs.bankerIn += -net;
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
  aiChoice(rng: Rng, game: C.CasinoGame, p: Player, lo: number, hi: number): CasinoChoice {
    const style = CHARACTERS[p.character]?.personality ?? 1;
    // About an eighth of its money (乖寶寶 half that, 大老奸 half again more), in thousands, within lo..hi.
    const stake = Math.min(hi, Math.max(lo, round(((p.cash + p.bank) / 8) * [0.5, 1, 1.5][style], 1000)));
    if (game === 'roulette') {
      const k = rng.below(10);
      return { game, stake, bet: k < 4 ? { kind: 'red' } : k < 8 ? { kind: 'black' } : { kind: 'dozen', n: 1 + rng.below(3) } };
    }
    if (game === 'baccarat') return { game, stake, bet: rng.below(4) === 0 ? 'player' : 'banker' };
    if (game === 'sicbo') return { game, stake, bet: rng.below(2) ? 'big' : 'small' };
    return { game, stake };
  }

  /**
   * Plays the chosen game (19 §5.2): the human answers the blackjack and hold'em moves, a computer by its strategy.
   * `have` is what the visitor holds: a double or a call adds at most what is left after the stake (doubling for
   * less / all-in); with nothing left there is no double, and hold'em goes to the showdown without a choice.
   */
  private *play(rng: Rng, p: Player, c: CasinoChoice, human: boolean, have = Infinity): Flow<C.CasinoResult> {
    const extra = Math.max(0, Math.min(c.stake, have - c.stake));
    switch (c.game) {
      case 'roulette': return C.playRoulette(rng, c.stake, c.bet as C.RouletteBet);
      case 'baccarat': return C.playBaccarat(rng, c.stake, c.bet as C.BaccaratBet);
      case 'sicbo': return C.playSicbo(rng, c.stake, c.bet as C.SicboBet);
      case 'blackjack': {
        const t = C.bjDeal(rng), moves: C.BjMove[] = [];
        while (!t.done) {
          let m: C.BjMove;
          if (human) {
            const a = (yield ask({ t: 'casino', p: p.id, phase: 'blackjack', player: [...t.player], up: t.dealer[0], canDouble: t.player.length === 2 && extra > 0, double: extra, stake: c.stake } as never)) as unknown;
            m = a === 'hit' || a === 'stand' || a === 'double' ? a : C.bjBasic(t.player, t.dealer[0]);
          } else m = C.bjBasic(t.player, t.dealer[0]);
          if (m === 'double' && (extra <= 0 || t.player.length !== 2)) m = 'hit';
          moves.push(m);
          C.bjMove(t, m);
        }
        return C.bjSettle(t, c.stake, moves, extra);
      }
      case 'holdem': {
        const t = C.holdemDeal(rng);
        let call: boolean;
        if (extra <= 0) call = true; // all-in on the ante: the showdown costs nothing more
        else if (human) {
          const a = (yield ask({ t: 'casino', p: p.id, phase: 'holdem', hole: [...t.hole], board: [...t.board], stake: c.stake, call: extra } as never)) as unknown;
          call = a === 'call' ? true : a === 'fold' ? false : C.holdemCall(t);
        } else call = C.holdemCall(t);
        return C.holdemSettle(t, c.stake, call, extra);
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
