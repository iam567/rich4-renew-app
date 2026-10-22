/**
 * 激情歲月's rules (docs/rules/24, the remake's addition; 自製地圖 #8, map 107, classic mode only), registered in
 * MAP_RULES like 歌舞伎町's (core/kabukicho.ts). Every other map has none of this.
 *
 *  - The large plots are five facilities the owner chooses (§2): 人民公園 0, 招待所 1, 供銷社 2, 研究所 4 — the original
 *    types renamed — and the 宣傳站 14 in the 加油站's place (up to level 5). The original 加油站 (3) is never built here.
 *  - 宣傳站 (§2.4): someone riding a scooter or driving a car stops on another's: fined the original gas fee ×
 *    (1 + 0.5 × (level − 1)), paid to the owner (免費卡 / 嫁禍卡 / the gods as on any facility fee), then 2 turns in a
 *    學習班 where they stand (`turnHold`, as 歌舞伎町's 處理事務中); the 工程車 is let through.
 *  - 人民公園 (§2.1): its owner stopping there draws a good card, anyone else a bad card (an ally: nothing).
 *  - Its own 24 news and 24 fate (§6) and the park's two decks of 8.
 *
 * Every random choice of its own (the decks, a computer's facility, the cards' targets) comes from streams made of the
 * game's seed, the day, the player and a counter (saved), never Math.random or the clock: watching or not, saving and
 * loading, and 派對模式's phones all play the same game. The original's dice and wheels stay the game's rand().
 */
import type { BoardNode, Facility, Land } from './board';
import { ask, type Flow } from './flow';
import { MAP_RULES, type Game, type MapRules } from './game';
import { Rng, daySeed } from './rng';
import { WheelKind } from './modules/wheel';
import { shuffleDeck, type ResultLine } from './modules/events';
import {
  DAQING_SLOT, JQ_CARDS, JQ_FAC_NAMES, JQ_FAC_RULES, JQ_FAC_TYPES, JQ_FATE, JQ_ID_BASE, JQ_MINORS, JQ_NEWS, JQ_PARK_BAD, JQ_PARK_GOOD,
  RENMIN_ROAD, STUDY_DAYS, SUBWAY_STREETS, T_XUAN, XUAN, xuanFactor, type JqCard,
} from './modules/jq-data';
import type { Player } from './types';

export const JQ_MAP = 107;
export const JQ_NAME = '激情歲月';
export { T_XUAN };

/** What this map keeps beside the board (saved with the game, `mapRules`). */
export interface JqState {
  /** Turns still to sit out in a 學習班 (§2.4), by player. */
  study: number[];
  /** What a vanished player is doing here (「下鄉中」, 「下放中」) instead of 消失中, by player (cleared on return). */
  away: string[];
  /** The news still in force (name → days). */
  mods: Record<string, number>;
  /** The decks: order and next position. */
  news: { deck: number[]; next: number };
  fate: { deck: number[]; next: number };
  good: { deck: number[]; next: number };
  bad: { deck: number[]; next: number };
  /** Draw counter of the own streams. */
  draws: number;
}

const fmt = (n: number) => Math.trunc(n).toLocaleString('en-US');

export class JiqingRules implements MapRules {
  s: JqState;

  constructor(readonly g: Game) {
    const n = g.players.length;
    this.s = {
      study: new Array(n).fill(0), away: new Array(n).fill(''), mods: {},
      news: { deck: [], next: 0 }, fate: { deck: [], next: 0 }, good: { deck: [], next: 0 }, bad: { deck: [], next: 0 }, draws: 0,
    };
    const r = this.stream(0x5eed, -1);
    this.s.news.deck = shuffleDeck(r, JQ_NEWS.length);
    this.s.fate.deck = shuffleDeck(r, JQ_FATE.length);
    this.s.good.deck = shuffleDeck(r, JQ_PARK_GOOD.length);
    this.s.bad.deck = shuffleDeck(r, JQ_PARK_BAD.length);
  }

  saveState(): JqState { return this.s; }
  loadState(s: unknown): void {
    if (s && typeof s === 'object') this.s = { ...this.s, ...(s as JqState) };
    const n = this.g.players.length;
    while (this.s.study.length < n) this.s.study.push(0);
    while (this.s.away.length < n) this.s.away.push('');
  }

  /** An own stream (§ header): seed, salt, player, day and the draw counter. */
  stream(salt: number, p: number): Rng {
    const g = this.g;
    this.s.draws = (this.s.draws + 1) >>> 0;
    return new Rng(daySeed((g.rollSeed() ^ salt ^ Math.imul(p + 2, 0x9e3779b1) ^ Math.imul(this.s.draws, 0x85ebca6b)) >>> 0, g.daysElapsed));
  }

  // ---------------------------------------------------------------- helpers

  minor(p: Player): boolean { return JQ_MINORS.has(p.character); }
  mod(name: string): boolean { return (this.s.mods[name] ?? 0) > 0; }
  facilityNode(f: Facility): BoardNode | undefined { return this.g.board.nodes.find(n => n.ref === f.id + 4000); }
  /** The facility's name as this map calls it (「宣傳站」…). */
  facName(type: number): string { return JQ_FAC_NAMES[type] ?? ''; }

  // ---------------------------------------------------------------- turns

  /** 學習班 (§2.4): the turn is sat out where the player stands. */
  *turnHold(g: Game, p: Player): Flow<boolean> {
    const n = this.s.study[p.id] ?? 0;
    if (n <= 0) return false;
    this.s.study[p.id] = n - 1;
    const lesson = XUAN.lessons[(g.daysElapsed + p.id) % XUAN.lessons.length];
    yield { t: 'fx', kind: 'jq-study', p: p.id, data: { turns: n - 1, sitting: true } };
    yield* g.say(p.id, `學習班中，還剩${n}天`, `${g.name(p.id)}在學習班：${lesson}（還剩${n}天）`);
    return true;
  }

  daily(g: Game = this.g): void {
    const s = this.s;
    for (const k of Object.keys(s.mods)) if (--s.mods[k] <= 0) delete s.mods[k];
    for (const p of g.players) if (!p.vanish && s.away[p.id]) s.away[p.id] = '';
  }

  /** A vanished player here is 「下鄉中」 / 「下放中」 (§6). */
  vanishLabel(_g: Game, p: Player): string | undefined { return this.s.away[p.id] || undefined; }

  tollFactor(_g: Game, _land: Land): number { return this.mod('dazibao') ? 0.5 : 1; }

  /** A god's change to a payment, with its reason (as 歌舞伎町's): 「大財神附身，罰款免付！」. */
  godFeeText(g: Game, p: Player, fee: string, _total: number, amount: number): string {
    const god = g.objects.godName(p) || '神明';
    const t = g.objects.godType(p), n = `${fmt(amount)}元`;
    const how = amount === 0 ? '免付！' : t === 1 ? `減半\n${n}` : t === 6 ? `加倍\n${n}` : t === 5 ? `×1.5\n${n}` : `改為\n${n}`;
    return `${god}附身，${fee}${how}`;
  }

  // ---------------------------------------------------------------- the large plots (§2)

  *landOnFacility(g: Game, p: Player, f: Facility): Flow<boolean> {
    const me = p.id + 1, human = g.isHuman(p);
    if (f.owner === 0) return false;                                   // buying: the original's
    if (f.owner === me) {
      if (f.level === 0) {
        if (p.sleepwalk) return true;
        const cost = f.price * g.priceIndex;
        if (cost > p.cash) { if (human) yield* g.say(p.id, '您的現金不足！'); return true; }
        if (!human && g.smartAi(p) && !g.smart.wantsToBuild(p, cost)) return true;
        const type = human ? yield* this.askFacility(p, f, `建設費用 ${fmt(cost)}元`) : this.aiFacility(g, p);
        if (type < 0) return true;
        if (yield* g.investmentBlocked(p)) return true;
        f.type = type; f.level = 1; p.cash -= cost;
        yield { t: 'build', p: p.id, kind: 'facility', id: f.id, level: 1, cost };
        yield* g.blessing(p, f.id + 4000);
        return true;
      }
      if (f.type === 0 && f.level >= 1) { if (!p.sleepwalk) yield* this.parkCard(g, p, f, true); return true; }
      return false;                                                     // upgrades, the lab: the original's
    }
    const owner = g.players[f.owner - 1];
    if (!owner || !owner.whoPlays || f.level < 1) return false;
    if (f.type === 0) {
      if (owner.ally === me || p.ally === f.owner) { yield* g.say(p.id, '同盟的公園，散散步'); return true; }
      yield* this.parkCard(g, p, f, false);
      return true;
    }
    if (f.type === T_XUAN) { yield* this.xuanVisit(g, p, owner, f); return true; }
    if (f.type === 1 && (this.mod('nixon') || this.mod('chuanlian'))) { yield* this.hotelVisit(g, p, owner, f); return true; }
    if (f.type === 2 && this.mod('supply')) { yield* this.shopVisit(g, p, owner, f); return true; }
    return false;                                                       // 招待所 / 供銷社 / 研究所: the original's
  }

  /**
   * The 宣傳站 (§2.4, §2.5): the owner's exemptions (02 §3.4: nothing at all), the fine on a scooter / car, the passive
   * cards and the gods (Game.hotelPay: 免費卡 waives the fine but not the class; 嫁禍卡: the framed one pays and studies
   * where they are; framed onto the owner: nobody), then 2 turns in the 學習班. Walking: nothing; the 工程車 goes free.
   */
  *xuanVisit(g: Game, p: Player, owner: Player, f: Facility): Flow {
    const vehicle = p.traffic & 3;
    if (!vehicle) return;
    if (vehicle === 3) { yield* g.say(p.id, XUAN.truck); return; }
    if (!(yield* g.ownerCollects(owner, f.tmpState, '罰款'))) return;
    const k = xuanFactor(f.level) * (this.mod('opera') ? 2 : 1);
    const amount = Math.trunc(500 * (1 << (vehicle - 1)) * g.diceTotal * g.priceIndex * k);
    const text = vehicle === 1 ? XUAN.scooter(fmt(amount)) : XUAN.car(fmt(amount));
    yield { t: 'fx', kind: 'jq-verdict', p: p.id, target: owner.id, node: p.node, data: { facility: f.id, level: f.level, vehicle, amount, dice: g.diceTotal, k, text } };
    yield* g.say(p.id, XUAN.bubble);
    yield* g.say(undefined, text, `${g.name(owner.id)}的${f.name}宣傳站：${g.name(p.id)}${vehicle === 1 ? '騎幸福摩托' : '坐上海轎車'}，罰款${fmt(amount)}元・學習班${STUDY_DAYS}天`);
    const free = p.cards.filter(c => c === 20).length;
    const stayer = yield* g.hotelPay(p, owner, f, amount, '罰款');
    if (g.over) return;
    yield* g.say(owner.id, XUAN.owner);
    if (!stayer || !stayer.whoPlays) return;
    if (stayer === p && p.cards.filter(c => c === 20).length < free) { yield { t: 'fx', kind: 'jq-free', p: p.id }; yield* g.say(p.id, XUAN.free); }
    yield* this.sendToClass(g, stayer);
  }

  /** Into the 學習班 where they stand (§2.4): 2 turns (more do not add up past 2). */
  *sendToClass(g: Game, q: Player): Flow {
    this.s.study[q.id] = Math.max(this.s.study[q.id] ?? 0, STUDY_DAYS);
    yield { t: 'fx', kind: 'jq-study', p: q.id, node: q.node, data: { turns: this.s.study[q.id], start: true } };
    yield* g.say(q.id, XUAN.start, `${g.name(q.id)}進了學習班，${STUDY_DAYS}回合原地學習`);
  }

  /** 招待所 while a news changes its fee (×2 尼克松訪華, free 紅衛兵大串聯): the original 旅館's stay (02 §4.3, REMAKE_HOTEL). */
  *hotelVisit(g: Game, p: Player, owner: Player, f: Facility): Flow {
    if (!(yield* g.ownerCollects(owner, f.tmpState, '住宿費'))) return;
    let rate = f.fees[f.level] * g.priceIndex;
    if (f.tmpState) rate *= 2;
    rate = this.mod('chuanlian') ? 0 : rate * (this.mod('nixon') ? 2 : 1);
    const days = yield* g.spin(WheelKind.hotel, g.name(owner.id));
    const amount = rate * days;
    yield* g.say(undefined, this.mod('chuanlian') ? `大串聯，休息${days}天\n\n免費！` : `休息${days}天\n\n費用${amount}元！`);
    const stayer = amount ? yield* g.hotelPay(p, owner, f, amount, '住宿費') : p;
    if (stayer && days && stayer.whoPlays && !g.over) yield* g.checkIn(stayer, p, f, days, false);
  }

  /** 供銷社 while 供銷社到貨啦 is on: the original 購物中心 (02 §4.4), the bill × 2. */
  *shopVisit(g: Game, p: Player, owner: Player, f: Facility): Flow {
    if (!(yield* g.ownerCollects(owner, f.tmpState, '購物費'))) return;
    let rate = f.fees[f.level] * g.priceIndex;
    if (f.tmpState) rate *= 2;
    const mult = yield* g.spin(WheelKind.shopping, g.name(owner.id));
    const amount = rate * mult * 2;
    yield* g.say(undefined, `憑票購買（到貨×2）\n\n${rate}x${mult}倍x2=${amount}元`);
    const paid = yield* g.collect(p, owner, amount, '購物費', true);
    if (paid) f.lastFee = yield* g.transfer(paid.payer, owner.id, paid.amount, 0, '購物費');
  }

  /** A computer's facility (§2: each of the five 1/5, its own stream). */
  aiFacility(_g: Game, p: Player): number { return JQ_FAC_TYPES[this.stream(0xfac, p.id).below(JQ_FAC_TYPES.length)]; }

  /** The facility a card or tool builds on an empty plot here (no choice): each of the five, drawn. */
  facilityType(f: Facility): number { return JQ_FAC_TYPES[this.stream(0xfa7 + f.id, -1).below(JQ_FAC_TYPES.length)]; }

  /** A human's free building there: the five-plate picker; a cancel builds the drawn one. */
  *pickFacilityType(_g: Game, p: Player, f: Facility): Flow<number> {
    const t = yield* this.askFacility(p, f, '免費建設（取消：隨機蓋一種）');
    return t >= 0 ? t : this.facilityType(f);
  }

  /** 改建卡 on a facility: another of the five (a human picks; a computer's original choice, 加油站 read as 宣傳站). */
  *rebuildFacility(g: Game, p: Player, f: Facility, human: boolean): Flow<number> {
    if (human) return yield* this.askFacility(p, f, '改建成哪一種設施？');
    const t = g.cards.aiArg0;
    return t === 3 ? T_XUAN : (JQ_FAC_TYPES as readonly number[]).includes(t) ? t : 4;
  }

  /** The picker (screen 'jq-fac', the five plates in one row); -1 cancels. */
  *askFacility(p: Player, f: Facility, text: string): Flow<number> {
    const options = JQ_FAC_TYPES.map(t => ({ label: JQ_FAC_NAMES[t], value: t, detail: JQ_FAC_RULES[t] }));
    const a = yield ask({ t: 'choose', p: p.id, title: `${f.name}：選擇要蓋的設施`, text, options, cancellable: true, screen: 'jq-fac' });
    return typeof a === 'number' && (JQ_FAC_TYPES as readonly number[]).includes(a) ? a : -1;
  }

  // ---------------------------------------------------------------- 人民公園 (§2.1)

  *parkCard(g: Game, p: Player, f: Facility, good: boolean): Flow {
    const deck = good ? this.s.good : this.s.bad, list = good ? JQ_PARK_GOOD : JQ_PARK_BAD;
    const c = list[deck.deck[deck.next] ?? 0];
    deck.next = (deck.next + 1) % list.length;
    const owner = g.players[f.owner - 1];
    const F = g.priceIndex;
    const amounts: Record<string, number> = {
      'jq-pg-taiji': 2000 * F, 'jq-pg-boat': 3000 * F, 'jq-pg-icepop': 1500 * F, 'jq-pg-bench': 1000 * F,
      'jq-pb-lawn': 1000 * F, 'jq-pb-ticket': 2000 * F, 'jq-pb-letter': 2000 * F,
    };
    const text = this.fill(c.text, { amount: amounts[c.id] ?? 0 });
    yield { t: 'fx', kind: 'jq-card', p: p.id, target: owner?.id, node: p.node, data: { id: c.id, pic: c.pic, head: c.head, text, good, facility: f.id, name: f.name } };
    const lines = yield* this.parkEffect(g, p, owner, c, amounts[c.id] ?? 0);
    yield { t: 'board' };
    yield* this.result(g, p, c, good ? 'gain' : lines.some(l => (l.amount ?? 0) < 0) ? 'fine' : 'none', lines, { title: `${g.name(f.owner - 1)}的人民公園` });
  }

  private *parkEffect(g: Game, p: Player, owner: Player | undefined, c: JqCard, amount: number): Flow<ResultLine[]> {
    const F = g.priceIndex;
    switch (c.id) {
      case 'jq-pg-taiji': case 'jq-pg-boat': case 'jq-pg-icepop': return yield* this.gain(g, p, amount);
      case 'jq-pg-coupon': return this.points(p, 20);
      case 'jq-pg-clean': return this.points(p, 30);
      case 'jq-pg-bench': return [...this.points(p, 10), ...(yield* this.gain(g, p, amount))];
      case 'jq-pg-date': return yield* this.card(g, p);
      case 'jq-pg-kite': {
        const id = yield* g.tools.receiveRandom(p);
        if (id && p.tools[id - 1] > 0) { yield { t: 'fx', kind: 'tool-received', p: p.id, data: { tool: id } }; return [{ p: p.id, text: '得到一件道具' }]; }
        return yield* this.gain(g, p, 1500 * F);
      }
      case 'jq-pb-lawn': case 'jq-pb-letter': return yield* this.lose(g, p, amount, c.head);
      case 'jq-pb-ticket': {
        const r = yield* g.objects.luck(p, 0, 1);
        if (r === 1) return [{ p: p.id, text: `${g.objects.godName(p) || '神明'}保佑，免付` }];
        const a = Math.min(r === 2 ? amount * 2 : amount, Math.max(0, p.cash + p.bank));
        if (a > 0 && owner) yield* g.transfer(p.id, owner.id, a, 0, '公園門票');
        return [{ p: p.id, text: '補票給地主', amount: -a }, ...(owner ? [{ p: owner.id, text: '收到門票錢', amount: a }] : [])];
      }
      case 'jq-pb-capsize': {
        const r = yield* this.misfortune(g, p); if (!r) return this.escaped(g, p);
        const d = yield* this.hospitalWheel(g, p);
        return [{ p: p.id, text: d ? `住院${d}天` : '轉盤停在 0：沒事' }];
      }
      case 'jq-pb-leaves': case 'jq-pb-report': {
        const r = yield* this.misfortune(g, p); if (!r) return this.escaped(g, p);
        p.stay = r; return [{ p: p.id, text: `停留${r}回合` }];
      }
      case 'jq-pb-goose': {
        if (!p.cards.length) return yield* this.lose(g, p, 500 * F, '大鵝追著跑');
        const id = p.cards[this.stream(0x9005e, p.id).below(p.cards.length)];
        g.cards.consume(p, id);
        return [{ p: p.id, text: '掉了一張卡片' }];
      }
      case 'jq-pb-cards': {
        const r = yield* this.misfortune(g, p); if (!r) return this.escaped(g, p);
        return yield* this.jail(g, p, 2 * r);
      }
    }
    return [];
  }

  // ---------------------------------------------------------------- shared effects

  private fill(text: string, v: Record<string, string | number>): string {
    return text.replace(/\{(\w+)\}/g, (_, k) => (v[k] === undefined ? '' : typeof v[k] === 'number' ? fmt(v[k] as number) : String(v[k])));
  }

  /** 票證 (the 點券, §3) + n. */
  points(p: Player, n: number): ResultLine[] {
    p.points = Math.min(0xffff, p.points + n);
    return [{ p: p.id, text: `票證 +${n}` }];
  }

  /** A gain with the god's luck (06 §2.1: doubled, or void). */
  *gain(g: Game, p: Player, base: number): Flow<ResultLine[]> {
    const r = yield* g.objects.luck(p, 0, 0);
    if (r === 1) return [{ p: p.id, text: `${g.objects.godName(p) || '神明'}作祟，${fmt(base)}元泡湯了` }];
    const a = r === 2 ? base * 2 : base;
    g.gain(p, a, 1);
    yield { t: 'pay', from: -1, to: p.id, amount: a, reason: '進帳', quiet: true };
    return [{ p: p.id, text: r === 2 ? `${g.objects.godName(p) || '神明'}保佑，加倍` : '進帳', amount: a }];
  }

  /** A loss to the bank with the god's luck (spared, or doubled). */
  *lose(g: Game, p: Player, base: number, why: string): Flow<ResultLine[]> {
    const r = yield* g.objects.luck(p, 0, 1);
    if (r === 1) return [{ p: p.id, text: `${g.objects.godName(p) || '神明'}保佑，免付` }];
    const a = Math.min(r === 2 ? base * 2 : base, Math.max(0, p.cash + p.bank));
    if (a > 0) yield* g.transfer(p.id, -1, a, 0, why);
    return [{ p: p.id, text: why, amount: -a }];
  }

  /** Misfortune's luck (06 §2.1): 0 spared, else the factor (1, 2 doubled). */
  *misfortune(g: Game, p: Player): Flow<number> {
    const r = yield* g.objects.luck(p, 1, 1);
    return r === 1 ? 0 : r === 2 ? 2 : 1;
  }
  escaped(g: Game, p: Player): ResultLine[] { return [{ p: p.id, text: `${g.objects.godName(p) || '神明'}保佑，逃過此劫` }]; }

  *card(g: Game, p: Player): Flow<ResultLine[]> {
    const id = yield* g.cards.receiveRandom(p);
    if (id) yield { t: 'fx', kind: 'card-received', p: p.id, data: { card: id } };
    return [{ p: p.id, text: id ? '得到一張卡片' : '卡片已經發完了' }];
  }

  /** The hospital wheel (0–3 days, 歌舞伎町's screen 'kb-hospital-wheel'). */
  *hospitalWheel(g: Game, p: Player): Flow<number> {
    const d = this.stream(0xd0c, p.id).below(4);
    yield { t: 'fx', kind: 'kb-hospital-wheel', p: p.id, data: { days: d } };
    if (d) yield* g.sendTo(p, 'hospital', d);
    else yield* g.say(p.id, '0 天：沒事！', `${g.name(p.id)}的住院轉盤停在 0：沒事`);
    return d;
  }

  /** 關牛棚 (prison) with 免罪卡 / 嫁禍卡 (06 §2.2); the luck is the caller's. */
  *jail(g: Game, p: Player, days: number): Flow<ResultLine[]> {
    if (!p.whoPlays || g.over) return [];
    const target = yield* g.cards.pardonOrFrame(p);
    if (target < 0) return [{ p: p.id, text: '免罪卡生效，逃過此劫' }];
    yield* g.sendTo(g.players[target], 'prison', days);
    const lines: ResultLine[] = [];
    if (target !== p.id) lines.push({ p: p.id, text: `用嫁禍卡嫁禍給${g.name(target)}` });
    lines.push({ p: target, text: `關牛棚${days}天` });
    return lines;
  }

  /** Away for some days (出國's way, 06 §2.4) under this map's label. */
  *away(g: Game, q: Player, days: number, label: string): Flow {
    yield* g.vanish(q, days, false);
    if (q.vanish) this.s.away[q.id] = label;
  }

  // ---------------------------------------------------------------- news and fate (§6)

  *news(g: Game, p: Player): Flow<boolean> {
    for (let i = 0; i < JQ_NEWS.length; i++) {
      const c = JQ_NEWS[this.s.news.deck[this.s.news.next]];
      this.s.news.next = (this.s.news.next + 1) % JQ_NEWS.length;
      if (yield* this.runNews(g, p, c)) return true;
    }
    return true;
  }

  *fate(g: Game, p: Player): Flow<boolean> {
    for (let i = 0; i < JQ_FATE.length; i++) {
      const c = JQ_FATE[this.s.fate.deck[this.s.fate.next]];
      this.s.fate.next = (this.s.fate.next + 1) % JQ_FATE.length;
      if (yield* this.runFate(g, p, c)) return true;
    }
    return true;
  }

  /** The board (廣播站快訊 / 大字報) with the card's own picture (maps/remake/events/<id>.webp). */
  *board(p: Player, c: JqCard, text: string, node?: number): Flow {
    const data: Record<string, unknown> = { id: JQ_ID_BASE + JQ_CARDS.indexOf(c), text, local: c.pic ?? c.id, city: JQ_NAME, jq: true };
    if (c.kind === 'news') data.category = c.category;
    yield { t: 'fx', kind: c.kind === 'news' ? 'news' : 'fate', p: p.id, ...(node ? { node } : {}), data };
  }

  *result(g: Game, p: Player, c: JqCard, fx: string, lines: ResultLine[], extra: Record<string, unknown> = {}): Flow {
    if (g.over) return;
    yield { t: 'fx', kind: 'event-result', p: p.id, data: {
      src: c.kind === 'news' ? 'news' : 'fate', id: JQ_ID_BASE + JQ_CARDS.indexOf(c), fx, title: c.kind === 'news' ? c.category : c.kind === 'park' ? '人民公園' : '大字報',
      head: c.head, lines: lines.length ? lines : [{ text: '沒有影響' }], tag: JQ_NAME, local: c.pic ?? c.id, ...(c.kind !== 'news' ? { focus: [p.id] } : {}), ...extra } };
  }

  /** Runs one news card; false when it has nothing to act on (the next card is read, as the originals' preconditions). */
  *runNews(g: Game, p: Player, c: JqCard): Flow<boolean> {
    const F = g.priceIndex, s = this.s, b = g.board, all = g.living();
    const days = (k: string, d: number) => { s.mods[k] = Math.max(s.mods[k] ?? 0, d); };
    const show = (v: Record<string, string | number> = {}) => this.board(p, c, this.fill(c.text, v));
    const pointsAll = function* (this: JiqingRules, n: number): Flow {
      yield* show({ amount: n });
      for (const q of all) { q.points = Math.min(0xffff, q.points + n); yield { t: 'points', p: q.id, amount: n }; }
      yield* this.result(g, p, c, 'gain', all.map(q => ({ p: q.id, text: `票證 +${n}` })));
    }.bind(this);
    switch (c.id) {
      case 'jq-n-satellite': yield* pointsAll(20); return true;
      case 'jq-n-exercise': yield* pointsAll(10); return true;
      case 'jq-n-zaoqing': yield* pointsAll(20); return true;
      case 'jq-n-bridge': {
        yield* show(); const lines: ResultLine[] = [];
        for (const q of all) { const id = yield* g.cards.receiveRandom(q); if (id) { yield { t: 'fx', kind: 'card-received', p: q.id, data: { card: id } }; lines.push({ p: q.id, text: '得到一張卡片' }); } }
        yield* this.result(g, p, c, 'gain', lines.length ? lines : [{ text: '卡片已經發完了' }]); return true;
      }
      case 'jq-n-pingpong': {
        const a = 2000 * F; yield* show({ amount: a });
        for (const q of all) g.gain(q, a, 0);
        yield* this.result(g, p, c, 'gain', all.map(q => ({ p: q.id, text: '友誼獎金', amount: a }))); return true;
      }
      case 'jq-n-nixon': yield* show(); days('nixon', 3); yield* this.result(g, p, c, 'bonus', [{ text: '招待所3天收費×2' }]); return true;
      case 'jq-n-opera': yield* show(); days('opera', 3); yield* this.result(g, p, c, 'bonus', [{ text: '宣傳站3天罰款×2' }]); return true;
      case 'jq-n-fanan': yield* show(); days('dazibao', 3); yield* this.result(g, p, c, 'none', [{ text: '3天過路費減半' }]); return true;
      case 'jq-n-chuanlian': yield* show(); days('chuanlian', 3); yield* this.result(g, p, c, 'none', [{ text: '招待所3天免費住' }]); return true;
      case 'jq-n-supply': yield* show(); days('supply', 3); yield* this.result(g, p, c, 'bonus', [{ text: '供銷社3天消費×2' }]); return true;
      case 'jq-n-panda': {
        const parks = b.facilities.filter(f => f.owner && f.level >= 1 && f.type === 0);
        if (!parks.length) return false;
        const a = 5000 * F; yield* show({ amount: a });
        const lines: ResultLine[] = [];
        for (const f of parks) { const o = g.players[f.owner - 1]; g.gain(o, a, 0); lines.push({ p: o.id, text: `${f.name}人民公園`, amount: a }); }
        yield* this.result(g, p, c, 'gain', lines, { refs: parks.map(f => f.id + 4000) }); return true;
      }
      case 'jq-n-dazhai': {
        const who = g.locals().filter(q => q.traffic === 0 && !g.offRoad(q));
        if (!who.length) return false;
        yield* show(); for (const q of who) q.stay = 1;
        yield* this.result(g, p, c, 'rain', who.map(q => ({ p: q.id, text: '修梯田，停留一回合' })), { focus: who.map(q => q.id) }); return true;
      }
      case 'jq-n-daqing': {
        const name = g.stocks.stocks[DAQING_SLOT]?.name;
        if (!name) return false;
        yield* show({ stock: name }); g.stocks.forceLimit(DAQING_SLOT, true, 2);
        yield* this.result(g, p, c, 'stock-up', [{ text: `${name}漲停兩天` }]); return true;
      }
      case 'jq-n-zhiqing': {
        const kids = all.filter(q => this.minor(q) && !g.offRoad(q));
        if (!kids.length) return false;
        yield* show();
        for (const q of kids) yield* this.away(g, q, 3, '下鄉中');
        yield* this.result(g, p, c, 'abroad', kids.map(q => ({ p: q.id, text: '下鄉3天' })), { focus: kids.map(q => q.id) }); return true;
      }
      case 'jq-n-barefoot': {
        const who = g.players.filter(q => q.hospital && g.here(q));
        if (!who.length) return false;
        for (const q of who) q.hospital = 0x80;
        yield* show(); yield* this.result(g, p, c, 'release', who.map(q => ({ p: q.id, text: '提前出院' })), { focus: who.map(q => q.id) }); return true;
      }
      case 'jq-n-yida': {
        yield* show(); const lines: ResultLine[] = [];
        for (const q of all) { const a = Math.min(Math.trunc(q.cash * 0.05), 20000 * F); if (a > 0) { yield* g.transfer(q.id, -1, a, 0, '布票', true); lines.push({ p: q.id, text: '繳交現金5%', amount: -a }); } }
        yield* this.result(g, p, c, 'tax', lines.length ? lines : [{ text: '沒有人有現金' }]); return true;
      }
      case 'jq-n-dousi': {
        const got: ResultLine[] = [];
        for (const q of all) if (q.loan === 0) { const x = Math.trunc(q.bank * 0.1); if (x > 0) { q.bank += x; got.push({ p: q.id, text: '有獎儲蓄', amount: x }); } }
        yield* show(); yield* this.result(g, p, c, 'bonus', got.length ? got : [{ text: '有貸款的人拿不到' }]); return true;
      }
      case 'jq-n-yiku': {
        const a = 1000 * F; yield* show({ amount: a }); const lines: ResultLine[] = [];
        for (const q of all) { const x = Math.min(a, Math.max(0, q.cash + q.bank)); if (x > 0) { yield* g.transfer(q.id, -1, x, 0, '憶苦飯', true); lines.push({ p: q.id, text: '憶苦飯錢', amount: -x }); } }
        yield* this.result(g, p, c, 'fine', lines.length ? lines : [{ text: '大家都沒錢' }]); return true;
      }
      case 'jq-n-tunnel': {
        const streets = [...new Set(b.lands.filter(l => l.level > 0).map(l => l.name))];
        if (!streets.length) return false;
        const name = streets[this.stream(0x7a, p.id).below(streets.length)];
        const lots = b.lands.filter(l => l.name === name);
        yield* this.board(p, c, this.fill(c.text, { street: name }), this.nodeOfRef(lots[0].id + 2000));
        const built = lots.filter(l => l.level > 0);
        for (const l of lots) g.damageProperty(l.id + 2000, 0);
        yield { t: 'board' };
        yield* this.result(g, p, c, 'quake', [{ text: `${name}${built.length}棟房屋各降一級` }], { refs: lots.map(l => l.id + 2000), node: this.nodeOfRef(lots[0].id + 2000) }); return true;
      }
      case 'jq-n-wudou': {   // (no longer in the deck: 批林批孔 took its place; kept for a fate-like use)
        const refs = [...b.lands.filter(l => l.level > 0).map(l => l.id + 2000), ...b.facilities.filter(f => f.level > 0).map(f => f.id + 4000)];
        if (!refs.length) return false;
        const center = refs[this.stream(0xd0d, p.id).below(refs.length)], cc = this.refXY(center), name = this.refName(center);
        yield* this.board(p, c, this.fill(c.text, { street: name }), this.nodeOfRef(center));
        const changed: number[] = [], lines: ResultLine[] = [];
        const near = (x: number, y: number) => Math.abs(x - cc.x) <= 100 && Math.abs(y - cc.y) <= 100;
        for (const l of b.lands) if (near(l.x, l.y) && l.level > 0) { g.damageProperty(l.id + 2000, 0); changed.push(l.id + 2000); if (l.owner) lines.push({ p: l.owner - 1, text: `${l.name}的房子降一級` }); }
        for (const f of b.facilities) if (near(f.x, f.y) && f.level > 0) { g.damageProperty(f.id + 4000, 0); changed.push(f.id + 4000); if (f.owner) lines.push({ p: f.owner - 1, text: `${f.name}降一級` }); }
        yield { t: 'board' };
        yield* this.result(g, p, c, 'typhoon', lines.length ? lines : [{ text: `${name}一帶所幸沒有房屋受損` }], { refs: changed, node: this.nodeOfRef(center) }); return true;
      }
      case 'jq-n-qingli': {
        const q = [...all].filter(x => !g.offRoad(x)).sort((a, b2) => g.wealth(b2) - g.wealth(a))[0];
        if (!q) return false;
        yield* this.board(p, c, this.fill(this.minor(q) && c.kid ? c.kid : c.text, { name: g.name(q.id) }));
        const r = yield* this.misfortune(g, q);
        if (!r) { yield* this.result(g, p, c, 'blessed', this.escaped(g, q), { focus: [q.id] }); return true; }
        q.stay = 2 * r;
        yield* this.result(g, p, c, 'jam', [{ p: q.id, text: this.minor(q) ? `罰站${2 * r}回合` : `查成分，停留${2 * r}回合` }], { focus: [q.id] }); return true;
      }
      case 'jq-n-pilin': {
        const who = g.locals().filter(q => q.traffic !== 0 && !g.offRoad(q));
        if (!who.length) return false;
        yield* show(); for (const q of who) q.stay = 1;
        yield* this.result(g, p, c, 'jam', who.map(q => ({ p: q.id, text: '開學習會，停留一回合' })), { focus: who.map(q => q.id) }); return true;
      }
      case 'jq-n-sijiu': {
        const who = all.filter(q => q.cards.length);
        if (!who.length) return false;
        yield* show(); const lines: ResultLine[] = [];
        for (const q of who) { const id = q.cards[this.stream(0x4a1, q.id).below(q.cards.length)]; g.cards.consume(q, id); lines.push({ p: q.id, text: '燒掉一張卡片' }); }
        yield* this.result(g, p, c, 'fine', lines, { focus: who.map(q => q.id) }); return true;
      }
      case 'jq-n-subway': {
        const names = SUBWAY_STREETS.filter(n => b.lands.some(l => l.name === n));
        if (!names.length) return false;
        const name = names[this.stream(0x5ab, p.id).below(names.length)], lots = b.lands.filter(l => l.name === name);
        const old = lots[0].price;
        yield* this.board(p, c, this.fill(c.text, { street: name }), this.nodeOfRef(lots[0].id + 2000));
        for (const l of lots) l.price = Math.trunc(l.price * 1.3) & 0xffff;
        yield { t: 'board' };
        yield* this.result(g, p, c, 'price-up', [{ text: `${name}地價上漲30％（${old * F}→${lots[0].price * F}元）` }], { refs: lots.map(l => l.id + 2000), node: this.nodeOfRef(lots[0].id + 2000) }); return true;
      }
      case 'jq-n-zhenbao': yield* show(); g.stocks.closeMarket(10); yield* this.result(g, p, c, 'stock-halt', [{ text: '內部認購暫停10天' }]); return true;
    }
    return false;
  }

  /** Runs one fate card for player `p` (a child gets its `kid` text). */
  *runFate(g: Game, p: Player, c: JqCard): Flow<boolean> {
    const F = g.priceIndex, kid = this.minor(p), me = p.id + 1;
    const show = (v: Record<string, string | number> = {}) => this.board(p, c, this.fill(kid && c.kid ? c.kid : c.text, v));
    const money = function* (this: JiqingRules, base: number, good: boolean): Flow {
      yield* show({ amount: base });
      const lines = good ? yield* this.gain(g, p, base) : yield* this.lose(g, p, base, c.head);
      yield* this.result(g, p, c, good ? 'gain' : 'fine', lines, good ? {} : { line: 'loss', amount: base });
    }.bind(this);
    const points = function* (this: JiqingRules, n: number): Flow {
      yield* show({ amount: n }); this.points(p, n); yield { t: 'points', p: p.id, amount: n };
      yield* this.result(g, p, c, 'gain', [{ p: p.id, text: `票證 +${n}` }]);
    }.bind(this);
    const hold = function* (this: JiqingRules, turns: number): Flow {
      yield* show(); const r = yield* this.misfortune(g, p);
      if (!r) { yield* this.result(g, p, c, 'blessed', this.escaped(g, p)); return; }
      p.stay = turns * r; yield* this.result(g, p, c, 'jam', [{ p: p.id, text: `停留${turns * r}回合` }]);
    }.bind(this);
    switch (c.id) {
      case 'jq-f-quanguo': yield* money(2000 * F, true); return true;
      case 'jq-f-model': yield* money(5000 * F, true); return true;
      case 'jq-f-fenhong': yield* money(4000 * F, true); return true;
      case 'jq-f-tijian': yield* money(2000 * F, true); return true;
      case 'jq-f-biaoyang': yield* money(3000 * F, true); return true;
      case 'jq-f-dazibao': yield* money(3000 * F, false); return true;
      case 'jq-f-chicken': yield* money(1500 * F, false); return true;
      case 'jq-f-yulu': yield* points(30); return true;
      case 'jq-f-movie': yield* points(20); return true;
      case 'jq-f-ticao': {
        yield* show({ amount: 1000 * F }); this.points(p, 10); yield { t: 'points', p: p.id, amount: 10 };
        const lines = yield* this.gain(g, p, 1000 * F);
        yield* this.result(g, p, c, 'gain', [{ p: p.id, text: '票證 +10' }, ...lines]); return true;
      }
      case 'jq-f-sanzhuan': { yield* show(); yield* this.result(g, p, c, 'gain', yield* this.card(g, p)); return true; }
      case 'jq-f-bike': {
        yield* show();
        if (g.tools.receive(p, 5)) { yield { t: 'fx', kind: 'tool-received', p: p.id, data: { tool: 5 } }; yield* this.result(g, p, c, 'gain', [{ p: p.id, text: '得到幸福摩托' }]); return true; }
        yield* this.result(g, p, c, 'gain', yield* this.gain(g, p, 3000 * F)); return true;
      }
      case 'jq-f-heishi': {
        yield* show();
        const id = yield* g.tools.receiveRandom(p);
        if (id) { yield { t: 'fx', kind: 'tool-received', p: p.id, data: { tool: id } }; yield* this.result(g, p, c, 'gain', [{ p: p.id, text: '得到一件道具' }]); return true; }
        yield* this.result(g, p, c, 'gain', yield* this.gain(g, p, 1500 * F)); return true;
      }
      case 'jq-f-xiafang': {
        yield* show(); const r = yield* this.misfortune(g, p);
        if (!r) { yield* this.result(g, p, c, 'blessed', this.escaped(g, p)); return true; }
        const target = yield* g.cards.pardonOrFrame(p);
        if (target < 0) { yield* this.result(g, p, c, 'blessed', [{ p: p.id, text: '免罪卡生效，逃過此劫' }]); return true; }
        const q = g.players[target], d = 3 * r;
        yield* this.away(g, q, d, kid ? '下鄉中' : '下放中');
        yield* this.result(g, p, c, 'abroad', [...(target !== p.id ? [{ p: p.id, text: `用嫁禍卡嫁禍給${g.name(target)}` }] : []), { p: target, text: `${this.minor(q) ? '下鄉' : '下放'}${d}天` }], { focus: [target] }); return true;
      }
      case 'jq-f-pidou': yield* hold(2); return true;
      case 'jq-f-yikufan': yield* hold(1); return true;
      case 'jq-f-pingfa': yield* hold(1); return true;
      case 'jq-f-paidui': yield* hold(1); return true;
      case 'jq-f-chaojia': {
        const tools = p.tools.map((n, i) => (n > 0 && i < 13 ? i + 1 : 0)).filter(Boolean);
        if (!tools.length && !p.cards.length) return false;
        yield* show(); const r = yield* this.misfortune(g, p);
        if (!r) { yield* this.result(g, p, c, 'blessed', this.escaped(g, p)); return true; }
        const rng = this.stream(0xc4a, p.id), lines: ResultLine[] = [];
        for (let k = 0; k < r; k++) {
          const ts = p.tools.map((n, i) => (n > 0 && i < 13 ? i + 1 : 0)).filter(Boolean);
          if (ts.length) { g.tools.consume(p, ts[rng.below(ts.length)]); lines.push({ p: p.id, text: '道具被抄走了' }); }
          if (p.cards.length) { g.cards.consume(p, p.cards[rng.below(p.cards.length)]); lines.push({ p: p.id, text: '卡片被抄走了' }); }
        }
        yield* this.result(g, p, c, 'fine', lines.length ? lines : [{ p: p.id, text: '家裡空空的，沒什麼可抄' }]); return true;
      }
      case 'jq-f-wudou': {
        yield* show(); const r = yield* this.misfortune(g, p);
        if (!r) { yield* this.result(g, p, c, 'blessed', this.escaped(g, p)); return true; }
        const d = yield* this.hospitalWheel(g, p);
        yield* this.result(g, p, c, d ? 'hospital' : 'none', [{ p: p.id, text: d ? `住院${d}天` : '轉盤停在 0：沒事' }]); return true;
      }
      case 'jq-f-touji': case 'jq-f-xiuzhang': {
        yield* show(); const r = yield* this.misfortune(g, p);
        if (!r) { yield* this.result(g, p, c, 'blessed', this.escaped(g, p)); return true; }
        const lines = yield* this.jail(g, p, (c.id === 'jq-f-touji' ? 3 : 2) * r);
        yield* this.result(g, p, c, lines.some(l => l.text.startsWith('關牛棚')) ? 'prison' : 'blessed', lines, { focus: [...new Set(lines.map(l => l.p ?? p.id))] }); return true;
      }
      case 'jq-f-fancheng': {
        const nodes = g.board.nodes.filter(n => { const l = n.ref > 2000 && n.ref < 4000 ? g.board.lands[n.ref - 2001] : undefined; return !!l && RENMIN_ROAD.includes(l.name); });
        if (!nodes.length || g.offRoad(p)) return false;
        const n = nodes[this.stream(0xfa4, p.id).below(nodes.length)];
        yield* show(); p.lastNode = p.node; p.node = n.id; yield { t: 'teleport', p: p.id, node: n.id };
        yield* g.land(p); return true;   // stops there (that square's flow, as on a stop)
      }
      case 'jq-f-sanxian': {
        const lots = g.board.lands.filter(l => l.owner === me && l.level === 0);
        if (!lots.length) return false;
        const l = lots[this.stream(0x3a1, p.id).below(lots.length)];
        yield* show(); l.owner = 0; l.expire = 0; g.gain(p, l.price, 1);
        yield { t: 'board' };
        yield { t: 'pay', from: -1, to: p.id, amount: l.price, reason: '補償', quiet: true };
        yield* this.result(g, p, c, 'gain', [{ p: p.id, text: `捐出${l.name}的空地，得到補償`, amount: l.price }], { refs: [l.id + 2000] }); return true;
      }
    }
    return false;
  }

  private nodeOfRef(ref: number): number | undefined { return this.g.board.nodes.find(n => n.ref === ref)?.id; }
  private refXY(ref: number): { x: number; y: number } { return ref < 4000 ? this.g.board.lands[ref - 2001] : this.g.board.facilities[ref - 4001]; }
  private refName(ref: number): string { return ref < 4000 ? this.g.board.lands[ref - 2001].name : this.g.board.facilities[ref - 4001].name; }
}

/** The rules of a game on 激情歲月, or undefined. */
export const jqRules = (g: Game | null | undefined): JiqingRules | undefined => (g?.rules instanceof JiqingRules ? g.rules : undefined);


MAP_RULES[JQ_MAP] = g => new JiqingRules(g);
