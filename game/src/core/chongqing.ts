/**
 * 重慶's rules (docs/rules/33, the remake's addition; 自製地圖 map 109, the city on three stacked levels), registered in
 * MAP_RULES like 激情歲月's (core/jiqing.ts). Every other map has none of this.
 *
 *  - The links between the levels (§2), taken only by stopping exactly on their square (passing by does nothing):
 *    the escalator between level 2 and level 3, both ways; the elevator: level 3 → 2, 2 → 1, 1 → 3. The 公路 between
 *    level 1 and 2 is plain road (its forks at both ends). The move does not count as a new stop (no loop: the other
 *    end is a link square too).
 *  - Its own 18 news and 22 fate (§5), mixed with the original decks by their counts.
 *  - The large plots (§6): 公園 (0) is a 麻將館 and 加油站 (3) a 火鍋店, both up to level 5. Someone else stopping on a
 *    麻將館 answers a 聽牌 puzzle first (5 s) and pays half, the toll or double; on a 火鍋店 pays the bill and may end up
 *    in the hospital (0 / 5 / 20 / 30 / 50 % by level, 1–3 days). The owner stopping on their own builds up.
 *
 * Every random choice of its own comes from streams of the game's seed, the day, the player and a counter (saved), as
 * 激情歲月's: watching or not, saving and loading, and 派對模式's phones all play the same game.
 */
import type { BoardNode, Facility } from './board';
import { ask, type Flow } from './flow';
import { MAP_RULES, type Game, type MapRules } from './game';
import { Rng, daySeed } from './rng';
import { shuffleDeck, type ResultLine } from './modules/events';
import { CQ_CARDS, CQ_FATE, CQ_ID_BASE, CQ_NEWS, ORIGINAL_FATE, ORIGINAL_NEWS, type CqCard } from './modules/cq-data';
import { judge, makePuzzle, TILE_IDS } from './modules/mahjong';
import type { Player } from './types';

export const CQ_MAP = 109;
export const CQ_NAME = '重慶';
export const LEVEL_NAME = ['', '第一層', '第二層', '第三層'];
/** The large plots as 重慶 calls them (§6): 公園 → 麻將館, 商場 → 夜市小吃街, 加油站 → 火鍋店. */
export const CQ_FAC_NAMES: Record<number, string> = { 0: '麻將館', 1: '旅館', 2: '夜市小吃街', 3: '火鍋店', 4: '研究所' };
/** 火鍋店: the chance (%) to end up in the 肛腸科 by level (§6.2). */
const HOTPOT_HOSPITAL = [0, 0, 5, 20, 30, 50];

export interface CqState {
  news: { deck: number[]; next: number };
  fate: { deck: number[]; next: number };
  draws: number;
}

const fmt = (n: number) => Math.trunc(n).toLocaleString('en-US');

/** Where a stop on node `id` takes the player and how (null: it is no link). */
export function cqLink(g: Game, id: number): { to: number; how: '扶梯' | '直梯' } | null {
  const lv = g.board.levels;
  if (!lv) return null;
  const [e2, e3] = lv.escalator;
  if (id === e2) return { to: e3, how: '扶梯' };
  if (id === e3) return { to: e2, how: '扶梯' };
  const [v3, v2, v1] = lv.elevator;
  if (id === v3) return { to: v2, how: '直梯' };
  if (id === v2) return { to: v1, how: '直梯' };
  if (id === v1) return { to: v3, how: '直梯' };
  return null;
}

export class ChongqingRules implements MapRules {
  s: CqState;

  constructor(readonly g: Game) {
    this.s = { news: { deck: [], next: 0 }, fate: { deck: [], next: 0 }, draws: 0 };
    const r = this.stream(0xc9e5, -1);
    this.s.news.deck = shuffleDeck(r, CQ_NEWS.length);
    this.s.fate.deck = shuffleDeck(r, CQ_FATE.length);
  }

  saveState(): CqState { return this.s; }
  loadState(s: unknown): void { if (s && typeof s === 'object') this.s = { ...this.s, ...(s as CqState) }; }

  stream(salt: number, p: number): Rng {
    const g = this.g;
    this.s.draws = (this.s.draws + 1) >>> 0;
    return new Rng(daySeed((g.rollSeed() ^ salt ^ Math.imul(p + 2, 0x9e3779b1) ^ Math.imul(this.s.draws, 0x85ebca6b)) >>> 0, g.daysElapsed));
  }

  private level(id: number): number { return this.g.board.levels?.node[id - 1] ?? 1; }
  private nodeOfRef(ref: number): number | undefined { return this.g.board.nodes.find(n => n.ref === ref)?.id; }

  // ---------------------------------------------------------------- the links (§2)

  *landSquare(g: Game, p: Player, n: BoardNode): Flow<boolean> {
    const link = cqLink(g, n.id);
    if (!link) return false;
    const from = this.level(n.id), to = this.level(link.to);
    const up = to > from ? '上' : '下';
    // a little scene (the user 2026-11-09: 「坐直梯坐扶梯的時候能不能有一個小動畫…提醒玩家從幾層移動到幾層」)
    yield { t: 'fx', kind: 'cq-link', p: p.id, data: { how: link.how, from, to, text: `搭${link.how}${up}到${LEVEL_NAME[to]}`,
      log: `${g.name(p.id)}搭${link.how}從${LEVEL_NAME[from]}${up}到${LEVEL_NAME[to]}` } };
    yield* this.moveTo(p, link.to);
    return true;
  }

  /** Puts a player on another square at once (a link, a card); it is not a stop there. */
  private *moveTo(p: Player, id: number): Flow {
    const n = this.g.board.nodes[id - 1];
    p.lastNode = n.adjacent.find(Boolean) ?? p.node;   // walks on away from a neighbour: either way is fine
    p.node = id;
    yield { t: 'teleport', p: p.id, node: id };
  }

  /** The plain road squares of a level (no link, no 公路, no hospital or prison): where a card sets someone down. */
  private roadOf(level: number, not = 0): BoardNode[] {
    const lv = this.g.board.levels!;
    const links = new Set([...lv.escalator, ...lv.elevator, ...lv.ramp]);
    return this.g.board.nodes.filter(n => lv.node[n.id - 1] === level && !links.has(n.id) && n.id !== not && n.ref < 8000 && n.event !== 5);
  }

  // ---------------------------------------------------------------- news and fate (§5)

  *news(g: Game, p: Player): Flow<boolean> {
    if (this.stream(0x6e05, p.id).below(CQ_NEWS.length + ORIGINAL_NEWS) >= CQ_NEWS.length) return false;   // the original's
    for (let i = 0; i < CQ_NEWS.length; i++) {
      const c = CQ_NEWS[this.s.news.deck[this.s.news.next]];
      this.s.news.next = (this.s.news.next + 1) % CQ_NEWS.length;
      if (yield* this.runNews(g, p, c)) return true;
    }
    return false;
  }

  *fate(g: Game, p: Player): Flow<boolean> {
    if (this.stream(0xfa7e, p.id).below(CQ_FATE.length + ORIGINAL_FATE) >= CQ_FATE.length) return false;
    for (let i = 0; i < CQ_FATE.length; i++) {
      const c = CQ_FATE[this.s.fate.deck[this.s.fate.next]];
      this.s.fate.next = (this.s.fate.next + 1) % CQ_FATE.length;
      if (yield* this.runFate(g, p, c)) return true;
    }
    return false;
  }

  private fill(text: string, v: Record<string, string | number>): string {
    return text.replace(/\{(\w+)\}/g, (_, k) => (typeof v[k] === 'number' ? fmt(v[k] as number) : String(v[k] ?? '')));
  }

  private *board(p: Player, c: CqCard, text: string, node?: number): Flow {
    yield { t: 'fx', kind: c.kind, p: p.id, ...(node ? { node } : {}), data: { id: CQ_ID_BASE + CQ_CARDS.indexOf(c), text, local: c.id, city: CQ_NAME } };
  }

  private *result(g: Game, p: Player, c: CqCard, fx: string, lines: ResultLine[], extra: Record<string, unknown> = {}): Flow {
    if (g.over) return;
    yield { t: 'fx', kind: 'event-result', p: p.id, data: {
      src: c.kind, id: CQ_ID_BASE + CQ_CARDS.indexOf(c), fx, title: c.kind === 'news' ? '重慶新聞' : '命運', head: c.head,
      lines: lines.length ? lines : [{ text: '沒有影響' }], tag: CQ_NAME, local: c.id, ...(c.kind === 'fate' ? { focus: [p.id] } : {}), ...extra } };
  }

  /** Everyone (or each owner) pays `each(q)`; nothing when it is 0. */
  private *payAll(g: Game, who: Player[], each: (q: Player) => number, reason: string): Flow<ResultLine[]> {
    const lines: ResultLine[] = [];
    for (const q of who) {
      const x = Math.min(Math.round(each(q)), Math.max(0, q.cash + q.bank));
      if (x <= 0) continue;
      yield* g.transfer(q.id, -1, x, 0, reason, true);
      lines.push({ p: q.id, text: reason, amount: -x });
    }
    return lines;
  }

  /** A street at random (lots by name). */
  private street(salt: number): string | undefined {
    const names = [...new Set(this.g.board.lands.map(l => l.name))];
    return names.length ? names[this.stream(salt, -1).below(names.length)] : undefined;
  }

  private *runNews(g: Game, p: Player, c: CqCard): Flow<boolean> {
    const F = g.priceIndex, b = g.board, all = g.living(), lv = b.levels!;
    const show = (v: Record<string, string | number> = {}, node?: number) => this.board(p, c, this.fill(c.text, v), node);
    const houses = (q: Player) => b.lands.filter(l => l.owner === q.id + 1 && l.level > 0);
    const plots = (q: Player, level = 0) => b.facilities.filter((f, i) => f.owner === q.id + 1 && f.level > 0 && (!level || lv.facilities[i] === level));
    const owners = all.filter(q => houses(q).length || plots(q).length);
    switch (c.id) {
      case 'cq-n-hotpotfest': {
        const a = 600 * F, who = all.filter(q => houses(q).length);
        if (!who.length) return false;
        yield* show({ amount: a });
        for (const q of who) g.gain(q, a * houses(q).length, 0);
        yield* this.result(g, p, c, 'gain', who.map(q => ({ p: q.id, text: `${houses(q).length}棟房子`, amount: a * houses(q).length }))); return true;
      }
      case 'cq-n-hongyadong': {
        const a = 1000 * F, who = all.filter(q => plots(q).length);
        if (!who.length) return false;
        yield* show({ amount: a });
        const sum = (q: Player) => plots(q).reduce((s, f) => s + f.level, 0) * a;
        for (const q of who) g.gain(q, sum(q), 0);
        yield* this.result(g, p, c, 'gain', who.map(q => ({ p: q.id, text: '大型用地', amount: sum(q) }))); return true;
      }
      case 'cq-n-lightrail': case 'cq-n-roadworks': {
        const st = this.street(c.id === 'cq-n-lightrail' ? 0x11 : 0x12);
        if (!st) return false;
        const k = c.id === 'cq-n-lightrail' ? 1.2 : 0.8, lots = b.lands.filter(l => l.name === st);
        yield* show({ street: st });
        for (const l of lots) { l.price = Math.max(100, Math.round(l.price * k / 10) * 10); l.tolls = l.tolls.map(t => Math.max(1, Math.round(t * k))); }
        yield { t: 'board' };
        yield* this.result(g, p, c, k > 1 ? 'gain' : 'fine', [{ text: `${st}地價${k > 1 ? '上漲' : '下跌'}20%` }], { refs: lots.map(l => l.id + 2000) }); return true;
      }
      case 'cq-n-changan': {
        const slot = g.stocks.stocks.findIndex(s => s.name === '長安汽車');
        if (slot < 0) return false;
        yield* show(); g.stocks.forceLimit(slot, true, 2);
        yield* this.result(g, p, c, 'stock-up', [{ text: '長安汽車漲停兩天' }]); return true;
      }
      case 'cq-n-newyear': {
        const a = 2000 * F; yield* show({ amount: a });
        for (const q of all) g.gain(q, a, 0);
        yield* this.result(g, p, c, 'gain', all.map(q => ({ p: q.id, text: '紅包', amount: a }))); return true;
      }
      case 'cq-n-heat': case 'cq-n-oldestate': {
        const who = all.filter(q => houses(q).length);
        if (!who.length) return false;
        yield* show();
        const per = c.id === 'cq-n-heat' ? 200 : 300, why = c.id === 'cq-n-heat' ? '電費' : '改造費';
        const lines = yield* this.payAll(g, who, q => houses(q).reduce((s, l) => s + l.level, 0) * per * F, why);
        yield* this.result(g, p, c, 'tax', lines); return true;
      }
      case 'cq-n-flood': case 'cq-n-landslide': {
        const at = c.id === 'cq-n-flood' ? 1 : 2;
        const hit = b.lands.filter((l, i) => l.level > 0 && lv.lands[i] === at);
        if (!hit.length) return false;
        const r = this.stream(0xf100d, at), pick: typeof hit = [];
        while (pick.length < 3 && hit.length) pick.push(hit.splice(r.below(hit.length), 1)[0]);
        yield* show({}, this.nodeOfRef(pick[0].id + 2000));
        for (const l of pick) l.level -= 1;
        yield { t: 'board' };
        yield* this.result(g, p, c, 'demolish', pick.map(l => ({ p: l.owner - 1, text: `${l.name}的房子降一級` })), { refs: pick.map(l => l.id + 2000) }); return true;
      }
      case 'cq-n-fog': case 'cq-n-nightmarket': {
        const at = c.id === 'cq-n-fog' ? 1 : 0, who = all.filter(q => plots(q, at).length);
        if (!who.length) return false;
        const per = (c.id === 'cq-n-fog' ? 1000 : 800) * F;
        yield* show({ amount: per });
        const lines = yield* this.payAll(g, who, q => plots(q, at).reduce((s, f) => s + f.level, 0) * per, c.id === 'cq-n-fog' ? '停航賠償' : '罰款');
        yield* this.result(g, p, c, 'fine', lines); return true;
      }
      case 'cq-n-proptax': {
        if (!owners.length) return false;
        yield* show();
        const worth = (q: Player) => houses(q).reduce((s, l) => s + l.price * (l.level + 1), 0) + plots(q).reduce((s, f) => s + f.price * (f.level + 1), 0);
        const lines = yield* this.payAll(g, owners, q => worth(q) * F * 0.02, '房產稅');
        yield* this.result(g, p, c, 'tax', lines); return true;
      }
      case 'cq-n-jam': {
        const a = 500 * F; yield* show({ amount: a });
        const lines = yield* this.payAll(g, all, () => a, '擁堵費');
        yield* this.result(g, p, c, 'jam', lines); return true;
      }
      case 'cq-n-stocks': {
        yield* show(); g.stocks.forceLimit(-1, false, 2);
        yield* this.result(g, p, c, 'stock-down', [{ text: '全部股票跌停兩天' }]); return true;
      }
      case 'cq-n-expropriate': case 'cq-n-bankfall': case 'cq-n-illegal': {
        const pool = b.lands.filter((l, i) => l.owner && (c.id !== 'cq-n-bankfall' || lv.lands[i] === 1) && (c.id !== 'cq-n-illegal' || l.level > 0));
        if (!pool.length) return false;
        const l = pool[this.stream(0x5ec1, -1).below(pool.length)], q = g.players[l.owner - 1];
        const pay = c.id === 'cq-n-expropriate' ? l.price * F : 0;
        yield* this.board(p, c, this.fill(c.text, { name: g.name(q.id), street: l.name, amount: pay }), this.nodeOfRef(l.id + 2000));
        l.owner = 0; l.level = 0; l.expire = 0;
        if (pay) g.gain(q, pay, 0);
        yield { t: 'board' };
        yield* this.result(g, p, c, 'demolish', [{ p: q.id, text: `${l.name}的地被收回`, ...(pay ? { amount: pay } : {}) }], { refs: [l.id + 2000], focus: [q.id], node: this.nodeOfRef(l.id + 2000) }); return true;
      }
    }
    return false;
  }

  private *runFate(g: Game, p: Player, c: CqCard): Flow<boolean> {
    const F = g.priceIndex, here = this.level(p.node);
    const show = (v: Record<string, string | number> = {}) => this.board(p, c, this.fill(c.text, v));
    const pay = function* (this: ChongqingRules, a: number, why: string): Flow<boolean> {
      yield* show({ amount: a });
      const x = Math.min(a, Math.max(0, p.cash + p.bank));
      if (x > 0) yield* g.transfer(p.id, -1, x, 0, why, true);
      yield* this.result(g, p, c, 'fine', [{ p: p.id, text: why, amount: -x }]);
      return true;
    }.bind(this);
    const gain = function* (this: ChongqingRules, a: number, why: string): Flow<boolean> {
      yield* show({ amount: a }); g.gain(p, a, 0);
      yield* this.result(g, p, c, 'gain', [{ p: p.id, text: why, amount: a }]);
      return true;
    }.bind(this);
    const points = function* (this: ChongqingRules, n: number): Flow<boolean> {
      yield* show();
      const x = n < 0 ? -Math.min(-n, p.points) : n;
      p.points = Math.max(0, Math.min(0xffff, p.points + x));
      if (x) yield { t: 'points', p: p.id, amount: x };
      yield* this.result(g, p, c, x >= 0 ? 'gain' : 'fine', [{ p: p.id, text: `點券 ${x >= 0 ? '+' : '−'}${Math.abs(x)}` }]);
      return true;
    }.bind(this);
    const toLevel = function* (this: ChongqingRules, level: number): Flow<boolean> {
      const road = this.roadOf(level);
      if (!road.length || g.offRoad(p)) return false;
      yield* show();
      const n = road[this.stream(0x1e7e1, p.id).below(road.length)];
      yield* this.moveTo(p, n.id);
      yield* this.result(g, p, c, 'none', [{ p: p.id, text: `到了${LEVEL_NAME[level]}` }]);
      return true;
    }.bind(this);
    const hospital = function* (this: ChongqingRules, days: number): Flow<boolean> {
      if (g.offRoad(p)) return false;
      yield* show(); yield* g.sendTo(p, 'hospital', days);
      yield* this.result(g, p, c, 'hospital', [{ p: p.id, text: `住院${days}天` }]); return true;
    }.bind(this);
    switch (c.id) {
      case 'cq-f-bangbang': return here < 3 ? yield* toLevel(here + 1) : false;
      case 'cq-f-bangbangdown': return here > 1 ? yield* toLevel(here - 1) : false;
      case 'cq-f-lost8d': { const other = [1, 2, 3].filter(k => k !== here); return yield* toLevel(other[this.stream(0x8d, p.id).below(2)]); }
      case 'cq-f-shortcut': {
        const forks = this.roadOf(here, p.node).filter(n => n.adjacent.filter(Boolean).length >= 3);
        if (!forks.length || g.offRoad(p)) return false;
        yield* show();
        yield* this.moveTo(p, forks[this.stream(0x5c, p.id).below(forks.length)].id);
        yield* this.result(g, p, c, 'none', [{ p: p.id, text: '到了另一個路口' }]); return true;
      }
      case 'cq-f-hotpot': return yield* points(30);
      case 'cq-f-hotpotboss': return yield* points(50);
      case 'cq-f-noodle': return yield* points(-20);
      case 'cq-f-ciqikou': {
        yield* show();
        const id = yield* g.cards.receiveRandom(p);
        if (id) yield { t: 'fx', kind: 'card-received', p: p.id, data: { card: id } };
        yield* this.result(g, p, c, 'gain', [{ p: p.id, text: id ? '得到一張卡片' : '卡片已經發完了' }]); return true;
      }
      case 'cq-f-lottery': return yield* gain(5000 * F, '福彩獎金');
      case 'cq-f-spicycontest': return yield* gain(3000 * F, '吃辣冠軍');
      case 'cq-f-spicyhosp': return yield* hospital(2);
      case 'cq-f-ankle': case 'cq-f-lazichicken': return yield* hospital(1);
      case 'cq-f-ninegrid': return yield* hospital(3);
      case 'cq-f-crackdown': {
        if (g.offRoad(p)) return false;
        yield* show(); yield* g.sendTo(p, 'prison', 5);
        yield* this.result(g, p, c, 'prison', [{ p: p.id, text: '行政拘留5天' }]); return true;
      }
      case 'cq-f-shibati': return yield* pay(1000 * F, '按摩費');
      case 'cq-f-redlight': return yield* pay(500 * F, '罰款');
      case 'cq-f-wrongtrain': return yield* pay(800 * F, '車費');
      case 'cq-f-mahjong': return yield* pay(1500 * F, '麻將輸了');
      case 'cq-f-motortaxi': return yield* pay(600 * F, '車費');
      case 'cq-f-suanlafen': return yield* pay(400 * F, '冰粉錢');
      case 'cq-f-maoxuewang': return yield* pay(2000 * F, '錢包掉了');
    }
    return false;
  }

  // ---------------------------------------------------------------- the large plots (§6)

  /** 麻將館 (type 0) and 火鍋店 (3) go up to level 5 here, not the original's one floor (no fireworks at level 1). */
  facilityTop(f: Facility): number | undefined { return f.type === 0 || f.type === 3 ? 5 : undefined; }

  *landOnFacility(g: Game, p: Player, f: Facility): Flow<boolean> {
    const me = p.id + 1;
    if (f.owner === 0 || f.level < 1) return false;                     // buying, building: the original's
    if (f.type !== 0 && f.type !== 3) return false;                     // 旅館 / 小吃街 / 研究所: the original's
    if (f.owner === me) { yield* this.buildUp(g, p, f); return true; }
    const owner = g.players[f.owner - 1];
    if (!owner?.whoPlays) return true;
    const fee = f.type === 0 ? '麻將館租金' : '火鍋錢';
    if (!(yield* g.ownerCollects(owner, f.tmpState, fee))) return true;
    let rate = f.fees[Math.min(5, f.level)] * g.priceIndex * g.tollBoost();
    if (f.tmpState) rate *= 2;
    rate = g.debtToll(owner, rate);
    if (f.type === 0) {
      const k = yield* this.mahjong(g, p, f);
      const amount = Math.round(rate * k);
      yield* g.say(undefined, `${k < 1 ? '聽牌答對！付一半租金' : k > 1 ? '答錯了！付雙倍租金' : '只對一部分，付正常租金'}\n\n${fmt(amount)}元`);
      const paid = yield* g.collect(p, owner, amount, fee, true);
      if (paid) f.lastFee = yield* g.transfer(paid.payer, f.owner - 1, paid.amount, 0, fee);
      return true;
    }
    yield* g.say(undefined, `${f.name}的火鍋店\n\n請付${fmt(rate)}元火鍋錢`);
    const paid = yield* g.collect(p, owner, rate, fee, true);
    if (paid) f.lastFee = yield* g.transfer(paid.payer, f.owner - 1, paid.amount, 0, fee);
    const r = this.stream(0x407, p.id);
    if (!g.over && p.whoPlays && !g.offRoad(p) && r.below(100) < HOTPOT_HOSPITAL[Math.min(5, f.level)]) {
      const days = 1 + r.below(3);
      yield* g.say(p.id, '太辣了！辣進肛腸科…', `${g.name(p.id)}在${f.name}吃火鍋太辣，辣進肛腸科`);
      yield* g.sendTo(p, 'hospital', days);
    }
    return true;
  }

  /** The owner on their own 麻將館 / 火鍋店: builds a level on (up to 5), the original's upgrade price. */
  private *buildUp(g: Game, p: Player, f: Facility): Flow {
    if (p.sleepwalk || f.level >= 5) return;
    const cost = f.fees[0] * g.priceIndex;
    if (cost > p.cash) { if (g.isHuman(p)) yield* g.say(p.id, '您的現金不足！'); return; }
    const yes = g.isHuman(p)
      ? (yield ask({ t: 'yesno', p: p.id, kind: 'upgrade-facility', text: `${f.name}的${CQ_FAC_NAMES[f.type]}\n\n升級費用:${cost}元\n\n是否升級？`, price: cost })) as boolean
      : g.smartAi(p) ? g.smart.wantsToBuild(p, cost) : true;
    if (!yes) return;
    if (yield* g.investmentBlocked(p)) return;
    p.cash -= cost; f.level += 1;
    yield { t: 'build', p: p.id, kind: 'facility', id: f.id, level: f.level, cost };
    yield* g.blessing(p, f.id + 4000);
  }

  /** The 聽牌 puzzle (§6.1): the factor on the toll — 0.5 right, 1 partly right, 2 wrong or out of time. */
  private *mahjong(g: Game, p: Player, f: Facility): Flow<number> {
    const r = this.stream(0x3a7e, p.id), level = Math.min(5, f.level);
    if (!g.isHuman(p)) {   // the computer does not play: its result at random (1, 2: half and half; 3+: thirds)
      const k = level <= 2 ? r.below(2) * 2 : r.below(3);
      return [0.5, 1, 2][k];
    }
    const pz = makePuzzle(r, level);
    const picked = (yield ask({ t: 'cq-mahjong', p: p.id, level, name: f.name, hand: pz.hand.map(t => TILE_IDS[t]),
      choices: pz.choices.map(t => TILE_IDS[t]), many: level >= 3, seconds: 5 } as never)) as unknown as number[] | null;
    const tiles = (picked ?? []).map(i => pz.choices[i]).filter(t => t !== undefined);
    const v = judge(level, pz.waits, tiles);
    yield { t: 'fx', kind: 'cq-mahjong-result', p: p.id, data: { result: v, waits: pz.waits.map(t => TILE_IDS[t]) } };
    return v === 'right' ? 0.5 : v === 'part' ? 1 : 2;
  }
}

/** 重慶's rules of a game, or null. */
export const cqRules = (g: Game): ChongqingRules | null => (g.rules instanceof ChongqingRules ? g.rules : null);

MAP_RULES[CQ_MAP] = g => new ChongqingRules(g);
