/**
 * Cards — docs/rules/04-cards.md. Owns: the card pool (remaining copies), card table, card effects,
 * the passive card chain (free toll, frame, pardon, revenge) and the computer's card choices.
 *
 * Bug decisions (docs/rules/README): #2 hostility from buy/auction/black cards uses trunc(x) instead of the
 * double's low dword; #3 robbing a tool counts the tool's own price; #4 the computer's stay card always has a
 * target (itself) instead of a stale parameter.
 */
import type { BoardNode, Facility, Land } from '../board';
import { CHARACTERS } from '../characters';
import { addMonths } from '../date';
import { ask, type Flow } from '../flow';
import type { Game } from '../game';
import { LAND_LIMIT_MONTHS, type Option, type PickSpot, type Player } from '../types';
import { OBJECT_NAMES } from './objects';
import { NPC_NAMES, type Npc } from './places';

export interface CardDef {
  id: number;
  name: string;
  /** Price in points (player.points). */
  price: number;
  /** Copies in the global pool at a new game (100 in all). */
  supply: number;
  /** Unused by the original (04 §4.5), kept for completeness. */
  f6: number;
  /** Aggressiveness f7: the computer uses the card when f7 − personality ≤ 0 (1 = one time in three). */
  f7: number;
  passive: boolean;
  text: string;
}

const def = (id: number, name: string, price: number, supply: number, f6: number, f7: number, text: string, passive = false): CardDef =>
  ({ id, name, price, supply, f6, f7, passive, text });

/** Card table (04 §1), index = id - 1. */
export const CARDS: readonly CardDef[] = [
  def(1, '均富卡', 200, 1, 2, 2, '所有玩家現金平均分配'),
  def(2, '均貧卡', 200, 2, 2, 2, '與指定玩家平分現金'),
  def(3, '購地卡', 35, 4, 0, 1, '以原價強行買下腳下的土地'),
  def(4, '換地卡', 25, 4, 0, 0, '交換腳下與另一塊土地的地主'),
  def(5, '換屋卡', 20, 4, 0, 0, '交換腳下與另一塊土地的建築'),
  def(6, '轉向卡', 20, 3, 0, 0, '使目標調頭'),
  def(7, '改建卡', 15, 8, 0, 0, '改變腳下建築的類型'),
  def(8, '拍賣卡', 20, 3, 0, 1, '強制拍賣腳下的土地'),
  def(9, '天使卡', 160, 2, 2, 0, '整條路段的房屋升一級'),
  def(10, '惡魔卡', 180, 1, 2, 2, '整條路段的建築夷為平地'),
  def(11, '怪獸卡', 60, 2, 0, 2, '摧毀一棟建築'),
  def(12, '拆除卡', 15, 5, 0, 1, '建築降一級，或移除路障、地雷、定時炸彈'),
  def(13, '搶奪卡', 25, 4, 0, 2, '搶走對手一張卡片或一個道具'),
  def(14, '停留卡', 20, 4, 0, 0, '目標原地停留一回合'),
  def(15, '冬眠卡', 100, 2, 2, 2, '其他人冬眠五回合'),
  def(16, '夢遊卡', 25, 4, 0, 1, '目標夢遊五回合'),
  def(17, '陷害卡', 20, 4, 0, 2, '目標入獄五天'),
  def(18, '復仇卡', 20, 4, 0, 0, '被夢遊或陷害時以牙還牙', true),
  def(19, '嫁禍卡', 40, 4, 0, 0, '把懲罰或高額費用轉嫁給別人', true),
  def(20, '免費卡', 25, 4, 0, 0, '免付一次高額費用', true),
  def(21, '免罪卡', 25, 4, 0, 0, '抵消一次懲罰', true),
  def(22, '送神符', 10, 3, 0, 0, '送走身上的壞神與定時炸彈'),
  def(23, '請神符', 20, 3, 0, 0, '把最近的神明請到身上'),
  def(24, '紅卡', 50, 3, 0, 0, '指定股票漲停'),
  def(25, '黑卡', 30, 3, 0, 1, '指定股票跌停'),
  def(26, '查稅卡', 35, 4, 0, 1, '向對手收取現金兩成的稅金'),
  def(27, '漲價卡', 35, 3, 0, 0, '過路費加倍五天'),
  def(28, '查封卡', 35, 3, 0, 1, '停止收取過路費五天'),
  def(29, '同盟卡', 40, 2, 0, 0, '與對手結盟七回合'),
  def(30, '烏龜卡', 70, 3, 0, 0, '目標每回合只走一步，共三回合'),
];

/**
 * 大富豪模式's own cards (docs/rules/17 §3.5), only in a tycoon world's pool (sold on the shop's card shelf; never
 * drawn on a card square): 31 飛行卡 = a free flight from wherever one stands, 32 電車卡 = a free 新幹線 ride from a
 * city with a station (both cost the turn 在路上 like any trip), 33 遣返卡, 34 獨裁卡, 35 召集卡, 36 通緝卡 (one copy
 * per city at a time, World.syncWanted).
 */
export const TYCOON_CARDS: readonly CardDef[] = [
  def(31, '飛行卡', 20, 4, 0, 0, '大富豪模式：立刻搭飛機去另一座城市（免機票，在路上一回合）'),
  def(32, '電車卡', 10, 4, 0, 0, '大富豪模式：在有車站的城市立刻搭新幹線（免車票，在路上一回合）'),
  def(33, '遣返卡', 15, 4, 0, 1, '大富豪模式：把同城一位對手用飛機遣返到別的城市（在路上一回合）'),
  def(34, '獨裁卡', 300, 1, 0, 2, '大富豪模式：同城所有對手都被送上飛機，分散到其他城市'),
  def(35, '召集卡', 25, 3, 0, 1, '大富豪模式：別的城市隨機一位對手搭飛機來到你所在城市的機場（在路上一回合）'),
  def(36, '通緝卡', 60, 1, 0, 2, '大富豪模式：任選一座城市的一位對手，在他所在城市坐牢五天（每座城市同時只有一張）'),
];
const ALL_CARDS: readonly CardDef[] = [...CARDS, ...TYCOON_CARDS];
export const cardDef = (id: number): CardDef | undefined => ALL_CARDS[id - 1];
/**
 * 大富豪模式's own cards (ids above the original 30): effects that sell or drop a whole hand (魔法屋 變賣所有卡片,
 * 命運 32, 死神) leave them in the hand — only bankruptcy clears them (docs/rules/17 §3.7).
 */
export const isTycoonCard = (id: number) => id > CARDS.length;

export const HAND_LIMIT = 15;
export const cardName = (id: number) => ALL_CARDS[id - 1]?.name ?? '';
export const cardPrice = (id: number) => ALL_CARDS[id - 1]?.price ?? 0;

/** Tool names and prices (docs/rules/05 §1), used when a card takes a tool (bug decision #3). */
const TOOL_NAMES = ['機器娃娃', '路障', '地雷', '定時炸彈', '機車', '汽車', '飛彈', '遙控骰子', '機器工人', '時光機', '傳送機', '工程車', '核子飛彈', '超級工人', '洲際飛彈', '時空機'];
const TOOL_PRICES = [15, 30, 25, 25, 80, 150, 100, 30, 30, 40, 95, 150, 250, 60, 400, 160]; // 14-16: 大富豪模式 (tools.ts TYCOON_TOOLS)
/** Facility cap by type (ref_00474940), same as the core's table. */
/** Gods 送神符 sends away (04 §3.22) and gods the computer wants to invite (04 §6 #23). */
const BAD_GODS = [5, 6, 7, 8, 10, 15];
const GOOD_GODS = [1, 2, 3, 4, 12];
/** Object types a god card can attach (fcn_0040ea62): 1..10, 12, 15. */
const ATTACHABLE = (t: number) => (t >= 1 && t <= 10) || t === 12 || t === 15;
/** 440 × 440 map viewport (04 §5.3 "画面内"). */
const VIEW_HALF = 220;
/** AI target encoding for a road object (card 12): node id + this. */
const OBJECT_TARGET = 0x10000;

/** Something on the map the computer can "see" (04 §5.3), in screen row order. */
type Seen =
  | { k: 'land'; x: number; y: number; land: Land }
  | { k: 'fac'; x: number; y: number; fac: Facility }
  | { k: 'player'; x: number; y: number; q: Player }
  | { k: 'npc'; x: number; y: number; actor: number; npc: Npc }
  | { k: 'obj'; x: number; y: number; slot: number; node: number; type: number };

/** Anything that walks: a player or an NPC (same node / lastNode / dir fields). */
interface Walker { node: number; lastNode: number; dir: number }

export class Cards {
  /** Copies left in the pool by card id - 1 (04 §2.1). */
  remaining: number[] = [];
  /** AI parameters ref_0048be58[0] and [1] (04 §5.2). */
  aiArg0 = 0;
  aiArg1 = 0;

  constructor(readonly g: Game) {}

  /** New game: fill the pool from the card table (04 §1). */
  init(): void {
    this.remaining = (this.g.world ? ALL_CARDS : CARDS).map(c => c.supply);
    for (const p of this.g.players) p.cards = [];
  }

  // ---------------------------------------------------------------- hand rules (04 §2.1, §4.1)

  has(p: Player, id: number): boolean { return p.cards.includes(id); }

  /** _rich4_find_player_cheapest_card: lowest price, the first one on ties; -1 for an empty hand. */
  cheapestSlot(p: Player): number {
    let best = -1, price = 10000;
    p.cards.forEach((id, i) => { if (cardPrice(id) < price) { price = cardPrice(id); best = i; } });
    return best;
  }

  /** Add a card to a hand: a full hand of 15 first drops its cheapest card (04 §2.1). No pool check. */
  receive(p: Player, id: number): boolean {
    if (id < 1 || id > this.remaining.length) return false;
    if (p.cards.length >= HAND_LIMIT) this.dropSlot(p, this.cheapestSlot(p));
    p.cards.push(id);
    this.remaining[id - 1] = (this.remaining[id - 1] - 1) & 0xff;
    return true;
  }

  /** _rich4_consume_card: remove the first copy and return it to the pool; nothing when absent. */
  consume(p: Player, id: number): boolean {
    const i = p.cards.indexOf(id);
    if (i < 0) return false;
    this.dropSlot(p, i);
    return true;
  }

  private dropSlot(p: Player, i: number): number {
    const [id] = p.cards.splice(i, 1);
    if (id) this.remaining[id - 1] = (this.remaining[id - 1] + 1) & 0xff;
    return id ?? 0;
  }

  /** One card drawn weighted by the pool (04 §4.1); returns 0 without drawing when the pool is empty. */
  drawId(): number {
    const pool: number[] = [];
    for (let i = 0; i < CARDS.length; i++) for (let k = 0; k < this.remaining[i] && pool.length < 128; k++) pool.push(i + 1);
    return pool.length ? pool[this.g.rng.below(pool.length)] : 0;
  }

  /** Card tile, holidays, lab …: one card drawn weighted by the pool (06 §1 t=13). Returns the id or 0. */
  *receiveRandom(p: Player): Flow<number> {
    const id = this.drawId();
    if (id) this.receive(p, id);
    return id;
  }

  /** Sell or drop every card of a player (死神, bankruptcy 02 §9.3 with `all`): no points. */
  *dropAll(p: Player, all = false): Flow { this.sellAll(p, all); }

  /**
   * _rich4_player_sell_all_the_card: empty the hand into the pool, return the summed prices (caller decides on
   * points). 大富豪模式's own cards stay unless `all` (bankruptcy, 17 §3.7).
   */
  sellAll(p: Player, all = false): number {
    let sum = 0;
    for (let i = 0; i < p.cards.length;) {
      if (!all && isTycoonCard(p.cards[i])) i++;
      else sum += cardPrice(this.dropSlot(p, i));
    }
    return sum;
  }

  /** Lose one random card (robber NPC, 小衰神, 01 §7.1, 04 §4.1); returns its id or 0. */
  dropRandom(p: Player): number {
    if (!p.cards.length) return 0;
    return this.dropSlot(p, this.g.rng.below(p.cards.length));
  }

  /** _rich4_player_drop_half_the_card (大衰神): drops original slots 0, 2, 4 … (⌊n/2⌋ cards); false under 2 cards. */
  dropHalf(p: Player): boolean {
    const n = p.cards.length;
    if (n < 2) return false;
    for (let i = 0; i < n >> 1; i++) this.dropSlot(p, i);
    return true;
  }

  // ---------------------------------------------------------------- using a card

  /** Computer's card use for this turn (04 §2.3, §5.1): first card of an 8-card window that passes. */
  *aiUse(p: Player): Flow {
    const n = p.cards.length;
    if (!n) return;
    const window = n <= 8 ? p.cards.slice(0, 8) : (() => {
      const s = this.g.rng.below(n);
      return Array.from({ length: 8 }, (_, k) => p.cards[(s + k) % n]);
    })();
    for (const id of window) {
      if (!this.aiWants(p, id)) continue;
      yield { t: 'fx', kind: 'card', p: p.id, data: { card: id } };
      yield* this.say(p, `使用${cardName(id)}`);
      yield* this.play(p, id, false);
      return;
    }
  }

  /** Human picks and plays a card from the turn menu (04 §2.2, §2.4): failures and cancels keep the card. */
  *humanUse(p: Player): Flow {
    for (;;) {
      if (!p.cards.length) {
        // The card screen still opens with an empty hand (as the original's card grid does).
        yield ask({ t: 'choose', p: p.id, title: '使用卡片', text: '沒有卡片', options: [], cancellable: true, layout: 'cards' });
        return;
      }
      const options: Option[] = p.cards.map((id, i) => ({ label: cardName(id), value: i, detail: cardDef(id)?.text, icon: { archive: 'Data', id: 570 + id } }));
      const a = yield ask({ t: 'choose', p: p.id, title: '使用卡片', options, cancellable: true, layout: 'cards' });
      if (typeof a !== 'number' || a < 0 || a >= p.cards.length) return;
      const id = p.cards[a];
      if (cardDef(id)?.passive) { yield* this.say(p, `${cardName(id)}會自動使用`); continue; }
      yield { t: 'fx', kind: 'card', p: p.id, data: { card: id } };
      yield* this.say(p, `使用${cardName(id)}`);
      if (yield* this.play(p, id, true)) return;
      yield { t: 'fx', kind: 'card-failed', p: p.id, data: { card: id } };
    }
  }

  /** Card effect functions (04 §3). Returns false when nothing happened; the card is then kept. */
  private *play(p: Player, id: number, human: boolean): Flow<boolean> {
    const g = this.g, pi = g.priceIndex, me = p.id;
    switch (id) {
      case 1: { // 均富卡 §3.1
        this.consume(p, 1);
        // 大富豪模式: every living player of the world shares (the user's rule, docs/rules/17 §4).
        const all = g.living();
        const avg = Math.trunc(all.reduce((s, q) => s + q.cash, 0) / all.length);
        const before = all.map(q => [q.id, q.cash]);
        for (const q of all) { if (q.cash > avg) g.addHostility(q.id, me, Math.trunc((q.cash - avg) / 100)); q.cash = avg; }
        // The remake's result box (the original only redraws the side panel); nobody else speaks (junfuka.c).
        yield { t: 'fx', kind: 'card-result', p: me, data: { card: 1, before, avg } };
        return true;
      }
      case 2: { // 均貧卡 §3.2
        const t = yield* this.pickPlayer(p, human, '請選擇均貧對象', this.opponents(p).map(q => q.id));
        if (t < 0) return false;
        this.consume(p, 2);
        const q = g.players[t];
        const avg = Math.trunc((p.cash + q.cash) / 2);
        if (q.cash > avg) g.addHostility(t, me, Math.trunc((q.cash - avg) / 100));
        const before = [[me, p.cash], [t, q.cash]];
        p.cash = avg; q.cash = avg;
        // junpinka.c: the target's line card[2][1] (face 1) after the cash is shared.
        yield { t: 'fx', kind: 'card-result', p: me, target: t, data: { card: 2, before, avg } };
        return true;
      }
      case 3: { // 購地卡 §3.3
        const ref = g.node(p.node).ref, plot = this.plot(ref);
        if (!plot || plot.owner === 0 || plot.owner === me + 1) return false;
        const level = plot.level;
        const price = (plot.price + level * this.perLevel(ref)) * pi;
        if (price > p.cash) { yield* this.say(p, '您的現金不足！'); return false; }
        const seller = plot.owner - 1;
        g.addHostility(seller, me, Math.trunc((plot.price * pi * (level + 2)) / 5));
        // rich4_card_goudika.asm: the buyer's line card[0][2] (face 3) only once the purchase goes through, then
        // the lot changes hands and the money moves, then the seller's card[2][2] (face 1).
        yield { t: 'fx', kind: 'card-line', p: me, data: { card: 3, role: 0 } };
        plot.owner = me + 1;
        const months = LAND_LIMIT_MONTHS[g.settings.landLimitIndex];
        if (months) plot.expire = addMonths(g.date, months);
        yield { t: 'board' };
        yield* g.transfer(me, seller, price, 0, '購地卡');
        yield { t: 'fx', kind: 'card-result', p: me, target: seller, data: { card: 3, ref, price } };
        this.consume(p, 3);
        return true;
      }
      case 4: case 5: { // 換地卡 §3.4 / 換屋卡 §3.5
        const ref = g.node(p.node).ref;
        if (!this.plot(ref)) return false;
        const big = ref > 4000;
        const other = yield* this.pickRef(p, human, '請選擇另一塊土地', this.plotRefs(r => r !== ref && (r > 4000) === big));
        if (other <= 0) return false;
        // Owners and levels before the swap decide who gloats and who complains (huandika / huanwuka.asm).
        const pa = this.plot(ref)!, pb = this.plot(other)!;
        const before = { ownerA: pa.owner, ownerB: pb.owner, levelA: pa.level, levelB: pb.level };
        if (id === 4) {
          const a = this.plot(ref)!, b = this.plot(other)!;
          [a.owner, b.owner] = [b.owner, a.owner];
        } else if (big) {
          const a = g.board.facilities[ref - 4001], b = g.board.facilities[other - 4001];
          [a.level, b.level] = [b.level, a.level];
          [a.type, b.type] = [b.type, a.type];
        } else {
          const a = g.board.lands[ref - 2001], b = g.board.lands[other - 2001];
          [a.level, b.level] = [b.level, a.level];
          [a.chain, b.chain] = [b.chain, a.chain];
        }
        yield { t: 'fx', kind: id === 4 ? 'swap-land' : 'swap-house', p: me, data: { a: ref, b: other, ...before } };
        yield { t: 'board' };
        this.consume(p, id);
        return true;
      }
      case 6: { // 轉向卡 §3.6
        const t = yield* this.pickPlayer(p, human, '請選擇轉向對象', this.actors(p, true));
        if (t < 0) return false;
        this.consume(p, 6);
        g.places.turnAround(this.walker(t));
        yield { t: 'fx', kind: 'turn-around', p: me, target: t };
        return true;
      }
      case 7: { // 改建卡 §3.7
        const ref = g.node(p.node).ref, plot = this.plot(ref);
        if (!plot || plot.level === 0) return false;
        if (ref < 4000) {
          const l = plot as Land;
          l.chain = !l.chain;
          if (l.chain && l.level > 1) l.level = 1;
        } else {
          const f = plot as Facility;
          // 大富翁城 (docs/rules/19): its halls switch among the four games, the level kept.
          const type = g.rules?.rebuildFacility ? yield* g.rules.rebuildFacility(g, p, f, human) : human ? yield* this.chooseFacilityType(p) : this.aiArg0;
          if (type < 0) return false;
          f.type = type;
          if ((type === 0 || type === 3) && f.level > 1) f.level = 1;
        }
        yield { t: 'board' };
        this.consume(p, 7);
        return true;
      }
      case 8: { // 拍賣卡 §3.8
        const ref = g.node(p.node).ref, plot = this.plot(ref);
        if (!plot) return false;
        if (plot.owner) g.addHostility(plot.owner - 1, me, Math.trunc((plot.price * pi * (plot.level + 2)) / 5));
        // rich4_card_paimaika.asm: the owner's card[2][7] (face 1) before the auction opens.
        if (plot.owner && plot.owner !== me + 1) yield { t: 'fx', kind: 'card-line', p: plot.owner - 1, data: { card: 8, role: 2 } };
        const buyer: unknown = yield* g.places.auction(me, ref);
        if (typeof buyer !== 'number' || buyer < 0) { plot.owner = 0; plot.expire = 0; yield { t: 'board' }; } // unsold: ownerless, buildings stay
        this.consume(p, 8);
        return true;
      }
      case 9: { // 天使卡 §3.9
        const ref = yield* this.pickRef(p, human, '請選擇土地', this.plotRefs(() => true));
        if (ref <= 0) return false;
        this.consume(p, 9);
        const lots = ref < 4000 ? this.street(g.board.lands[ref - 2001].name).map(l => l.id + 2000) : [ref];
        const was = lots.map(r => this.plot(r)!.level);
        if (ref < 4000) {
          let topped = false;
          for (const l of this.street(g.board.lands[ref - 2001].name)) {
            if (l.level >= 5) continue;
            if (!l.chain) { l.level += 1; if (l.level === 5) topped = true; } else if (l.level === 0) l.level = 1;
          }
          if (topped) yield { t: 'fx', kind: 'angel-top', p: me, data: { ref } };
        } else {
          const f = g.board.facilities[ref - 4001];
          if (f.level === 0) {
            // 大富翁城 (docs/rules/19): only casinos are built there, no type to choose.
            const only = g.rules?.facilityType?.(f);
            const type = only !== undefined ? only : human ? yield* this.chooseFacilityType(p, false) : f.owner === me + 1 ? g.rng.rand() % 4 + 1 : 0;
            f.type = Math.max(0, type);
            f.level = 1;
          } else g.freeUpgrade(ref);
        }
        yield { t: 'fx', kind: 'angel', p: me, data: { ref, lots, was } };
        yield { t: 'board' };
        return true;
      }
      case 10: { // 惡魔卡 §3.10
        const ref = yield* this.pickRef(p, human, '請選擇土地', this.plotRefs(() => true));
        if (ref <= 0) return false;
        this.consume(p, 10);
        const refs = ref < 4000 ? this.street(g.board.lands[ref - 2001].name).map(l => l.id + 2000) : [ref];
        const was = refs.map(r => this.plot(r)!.level);
        for (const r of refs) {
          const plot = this.plot(r)!;
          if (plot.owner) g.addHostility(plot.owner - 1, me, plot.level * 30 * pi);
          g.damageProperty(r, 2);
        }
        yield { t: 'fx', kind: 'devil', p: me, data: { ref, lots: refs, was } };
        yield { t: 'board' };
        return true;
      }
      case 11: { // 怪獸卡 §3.11
        const ref = yield* this.pickRef(p, human, '請選擇建築', this.plotRefs(r => this.builtNotMine(p, r)));
        if (ref <= 0) return false;
        this.consume(p, 11);
        const plot = this.plot(ref)!, from = plot.level;
        if (plot.owner) g.addHostility(plot.owner - 1, me, plot.level * 30 * pi);
        g.damageProperty(ref, 2);
        yield { t: 'fx', kind: 'monster', p: me, data: { ref, from } };
        yield { t: 'board' };
        return true;
      }
      case 12: { // 拆除卡 §3.12: a built lot that is not one's own, or a roadblock / mine / time bomb (also a carried one)
        let ref = 0, slot = 0, objectNode = 0;
        if (human) {
          const t = yield* this.pickDemolish(p);
          if (!t) return false;
          ref = t.ref; slot = t.slot;
        } else if (this.aiArg0 >= OBJECT_TARGET) { objectNode = this.aiArg0 - OBJECT_TARGET; slot = g.objects.idAt(objectNode); }
        else ref = this.aiArg0;
        if (!slot && !objectNode && !this.plot(ref)) return false;
        this.consume(p, 12);
        if (slot || objectNode) {
          // _rich4_remove_object: back to the shop's supply; a carried bomb also leaves its carrier (+0x40 = 0).
          const o = slot ? g.objects.slots[slot - 1] : undefined;
          const carrier = o?.owner ? g.players[o.owner - 1] : undefined;
          const node = o?.node || carrier?.node || objectNode;
          if (slot) g.objects.remove(slot);
          yield { t: 'fx', kind: 'demolish-object', p: me, node, target: carrier?.id };
          if (carrier) yield { t: 'fx', kind: 'bomb-removed', p: carrier.id };
        } else {
          const plot = this.plot(ref)!, from = plot.level;
          if (plot.owner) g.addHostility(plot.owner - 1, me, 30 * pi);
          g.damageProperty(ref, 0);
          yield { t: 'fx', kind: 'demolish', p: me, data: { ref, from } };
        }
        yield { t: 'board' };
        return true;
      }
      case 13: { // 搶奪卡 §3.13
        const t = yield* this.pickPlayer(p, human, '請選擇搶奪對象', this.opponents(p).map(q => q.id));
        if (t < 0) return false;
        const q = g.players[t];
        let pick: number;
        if (human) {
          const options: Option[] = [
            ...q.cards.map(c => ({ label: cardName(c), value: c })),
            ...q.tools.flatMap((n, i) => (n > 0 ? [{ label: `${TOOL_NAMES[i]} ×${n}`, value: 100 + i + 1 }] : [])),
          ];
          if (!options.length) { yield* this.say(p, `${g.name(t)}沒有卡片和道具`); return false; }
          const a = yield ask({ t: 'choose', p: me, title: `搶奪${g.name(t)}的卡片或道具`, options, cancellable: true });
          if (typeof a !== 'number' || !options.some(o => o.value === a)) return false;
          pick = a;
        } else pick = this.aiArg1;
        let hostility: number;
        if (pick > 100) {
          const tool = pick - 100;
          if (!q.tools[tool - 1]) return false;
          q.tools[tool - 1] -= 1;
          if (tool <= 8 && g.tools.shopStock.length >= tool) g.tools.shopStock[tool - 1] += 1;
          g.tools.receive(p, tool);
          hostility = TOOL_PRICES[tool - 1];
        } else {
          if (!this.consume(q, pick)) return false;
          this.receive(p, pick);
          hostility = cardPrice(pick);
        }
        g.addHostility(t, me, hostility);
        this.consume(p, 13); // silently nothing when a full hand already dropped it (04 Q11)
        // rich4_card_qiangduoka.asm: the robbed player's card[2][12] (face 1) once the card is used up.
        yield { t: 'fx', kind: 'card-result', p: me, target: t, data: { card: 13, ...(pick > 100 ? { tool: pick - 100 } : { got: pick }) } };
        return true;
      }
      case 14: { // 停留卡 §3.14
        const t = yield* this.pickPlayer(p, human, '請選擇停留對象', this.actors(p, true));
        if (t < 0) return false;
        this.consume(p, 14);
        if (t === me) p.stay = 0x80;
        else if (t < g.npcBase) g.players[t].stay = 1;
        else this.npc(t).stay = 1;
        yield { t: 'fx', kind: 'stay', p: me, target: t };
        return true;
      }
      case 15: { // 冬眠卡 §3.15
        this.consume(p, 15);
        const who: number[] = [];
        for (const q of g.players) {
          if (q.id === me || q.whoPlays === 0 || !q.placed || g.offRoad(q)) continue;
          g.addHostility(q.id, me, 150 * pi);
          q.sleepwalk = 0; q.sleep = 5; q.monthBadDays += 5;
          who.push(q.id);
        }
        for (const n of g.places.npcs) if (n.where === 0) { n.sleepwalk = 0; n.sleep = 5; }
        yield { t: 'fx', kind: 'hibernate', p: me, data: { who } };
        return true;
      }
      case 16: case 17: { // 夢遊卡 §3.16 / 陷害卡 §3.17 with 復仇卡 §3.18
        const t = yield* this.pickPlayer(p, human, id === 16 ? '請選擇夢遊對象' : '請選擇陷害對象', this.actors(p, false));
        if (t < 0) return false;
        this.consume(p, id);
        if (t >= g.npcBase) {
          const n = this.npc(t);
          if (id === 16) { if (n.sleep === 0) n.sleepwalk = 5; } else g.places.npcTo(t, 'prison');
          yield { t: 'fx', kind: id === 16 ? 'sleepwalk' : 'frame', p: me, target: t };
          return true;
        }
        const q = g.players[t];
        if (id === 16 && q.sleep) return true; // a hibernating target: the card is spent for nothing
        g.addHostility(t, me, 150 * pi);
        const sufferer = yield* this.pardonOrFrame(q);
        if (sufferer < 0) return true;
        const s = g.players[sufferer];
        if (id === 16) { this.sleepwalk(s, sufferer === me ? 4 : 5); s.monthBadDays += 5; yield { t: 'fx', kind: 'sleepwalk', p: me, target: sufferer }; }
        else {
          yield* g.sendTo(s, 'prison', sufferer === me ? 4 : 5);
          // rich4_card_xianhaika.asm: whoever went to prison says card[2][16] (face 1) after the prison sequence.
          yield { t: 'fx', kind: 'card-line', p: sufferer, data: { card: 17, role: 2 } };
        }
        if (sufferer === t && this.has(q, 18) && p.whoPlays) {
          this.consume(q, 18);
          // _rich4_use_card_fuchouka: the announcement, the holder's card[0][17] (with the announcement), then the
          // attacker's card[2][17] (face 2), then the same punishment for the attacker.
          yield { t: 'fx', kind: 'card', p: t, data: { card: 18 } };
          yield { t: 'fx', kind: 'card-line', p: me, data: { card: 18, role: 2 } };
          if (id === 16) { this.sleepwalk(p, 5); yield { t: 'fx', kind: 'sleepwalk', p: t, target: me, data: { revenge: true } }; }
          else yield* g.sendTo(p, 'prison', 5);
        }
        return true;
      }
      case 22: { // 送神符 §3.22
        if (!(yield* g.objects.sendAwayGod(p))) return false; // carried bomb, then a bad god (objects module)
        yield { t: 'fx', kind: 'send-god', p: me };
        this.consume(p, 22);
        return true;
      }
      case 23: { // 請神符 §3.23
        // Not picked by hand: the nearest free god on the screen (fcn_00444d1a over fcn_0040a45c(-1)).
        const node = human ? this.nearestGod(p)?.node ?? 0 : this.aiArg0;
        const o = g.objects.at(node);
        if (!o || o.owner || !ATTACHABLE(o.type)) { if (human) yield* this.say(p, '附近沒有神明'); return false; }
        this.consume(p, 23);
        yield* g.objects.inviteGod(p, node);
        return true;
      }
      case 24: case 25: { // 紅卡 §3.24 / 黑卡 §3.25
        const market = g.stocks;
        const before = market.stocks.map(x => x.price);
        let slot: number;
        if (human) {
          const options: Option[] = market.stocks.map((x, value) => ({ label: x.name, value }));
          const a = yield ask({ t: 'choose', p: me, title: id === 24 ? '請選擇要漲停的股票' : '請選擇要跌停的股票', options, cancellable: true });
          if (typeof a !== 'number' || !market.stocks[a]) return false;
          slot = a;
        } else slot = this.aiArg0;
        if (!market.stocks[slot]) return false;
        if (id === 24) this.consume(p, 24);
        market.forceLimit(slot, id === 24);
        if (id === 25) {
          const drop = before[slot] - market.stocks[slot].price;
          for (const q of g.players) {
            const shares = q.whoPlays ? market.holding(q.id, slot).shares : 0;
            if (shares) g.addHostility(q.id, me, Math.trunc((shares * drop) / 200));
          }
          this.consume(p, 25);
        }
        // The remake's stock card panel (the original: the stock screen for a human, 「對%s使用%s！」 for a computer).
        const after = market.stocks[slot].price;
        const holders = g.players.filter(q => q.whoPlays && market.holding(q.id, slot).shares).map(q => [q.id, market.holding(q.id, slot).shares]);
        yield { t: 'fx', kind: id === 24 ? 'stock-up' : 'stock-down', p: me, data: { slot, card: id, before: before[slot], after, holders } };
        return true;
      }
      case 26: { // 查稅卡 §3.26
        const t = yield* this.pickPlayer(p, human, '請選擇查稅對象', this.opponents(p).map(q => q.id));
        if (t < 0) return false;
        this.consume(p, 26);
        const q = g.players[t];
        let tax = Math.trunc(q.cash * 0.2);
        g.addHostility(t, me, Math.trunc(tax / 100));
        if (this.has(q, 20) && (yield* this.tryFree(q, me, tax))) return true;
        let payer = t;
        if (this.has(q, 19) && tax > 2000) { const r = yield* this.tryFrame(q, 2, tax); if (r >= 0) payer = r; }
        if (payer === me) return true;
        tax = Math.trunc(g.players[payer].cash * 0.2);
        if (tax > 0) yield* g.transfer(payer, me, tax, 0, '稅金');
        // rich4_card_chashuika.asm: 「抽取%s\n\n%d元稅金！」 1500 ms, then the payer's card[2][25] (face 2).
        yield { t: 'fx', kind: 'card-result', p: me, target: payer, data: { card: 26, tax } };
        return true;
      }
      case 27: case 28: { // 漲價卡 §3.27 / 查封卡 §3.28
        const ref = yield* this.pickRef(p, human, '請選擇土地', this.plotRefs(() => true));
        if (ref <= 0) return false;
        this.consume(p, id);
        const state = id === 27 ? 0x50 : 0x51;
        if (ref < 4000) for (const l of this.street(g.board.lands[ref - 2001].name)) l.tmpState = state;
        else {
          const f = g.board.facilities[ref - 4001];
          f.tmpState = state;
          if (id === 28 && f.type === 4) f.labDays = 0;
        }
        yield { t: 'fx', kind: id === 27 ? 'price-up' : 'seal', p: me, data: { ref } };
        yield { t: 'board' };
        return true;
      }
      case 29: { // 同盟卡 §3.29
        const t = yield* this.pickPlayer(p, human, '請選擇同盟對象', this.opponents(p).map(q => q.id));
        if (t < 0) return false;
        this.consume(p, 29);
        const q = g.players[t];
        g.endAlly(p); g.endAlly(q);
        p.ally = t + 1; q.ally = me + 1;
        p.allyDays = 7; q.allyDays = 7;
        // rich4_card_tongmengka.asm: the partner's card[2][28] (face 0).
        yield { t: 'fx', kind: 'card-result', p: me, target: t, data: { card: 29 } };
        return true;
      }
      case 30: { // 烏龜卡 §3.30
        const t = yield* this.pickPlayer(p, human, '請選擇烏龜對象', this.actors(p, true));
        if (t < 0) return false;
        this.consume(p, 30);
        if (t === me) p.turtle = 2;
        else if (t < g.npcBase) g.players[t].turtle = 3;
        else this.npc(t).turtle = 3;
        yield { t: 'fx', kind: 'turtle', p: me, target: t };
        return true;
      }
      case 33: { // 遣返卡 (大富豪模式, 17 §3.5): a rival on screen, 免罪卡 / 嫁禍卡 apply as for the harmful cards
        if (!g.world) return false;
        const t = yield* this.pickPlayer(p, human, '請選擇遣返對象', this.actors(p, false).filter(a => a < g.npcBase));
        if (t < 0) return false;
        this.consume(p, 33);
        const q = g.players[t];
        g.addHostility(t, me, 150 * pi);
        const sufferer = yield* this.pardonOrFrame(q);
        if (sufferer < 0) return true;
        yield* g.world.hooks.deport(g, g.players[sufferer], p);
        return true;
      }
      case 34: { // 獨裁卡 (17 §3.5): everyone else on this city's squares flies off, as 冬眠卡 with no 免罪卡
        if (!g.world) return false;
        if (!g.world.hooks.dictateVictims(g, p).length) { if (human) yield* this.say(p, '這裡沒有其他人'); return false; }
        this.consume(p, 34);
        yield* g.world.hooks.dictate(g, p);
        return true;
      }
      case 35: { // 召集卡 (17 §3.5): a random rival from another city flies to this city's airport
        if (!g.world) return false;
        if (!g.world.hooks.summonable(g, p).length) { if (human) yield* this.say(p, '別的城市沒有可以召集的對手'); return false; }
        this.consume(p, 35);
        yield* g.world.hooks.summon(g, p);
        return true;
      }
      case 36: { // 通緝卡 (17 §3.5): any rival anywhere, 5 days in prison in their city; 免罪卡 / 嫁禍卡 apply
        if (!g.world) return false;
        let t = human ? -1 : this.aiArg0;
        if (human) {
          const a = yield ask({ t: 'choose', p: me, title: '通緝卡：通緝哪一位？', text: '在他所在城市的監獄坐牢五天', options: g.world.hooks.wantedOptions(p), cancellable: true, layout: 'faces' });
          t = typeof a === 'number' ? a : -1;
        }
        const q = g.players[t];
        if (!q || !g.world.hooks.wantedOptions(p).some(o => o.value === t && !o.disabled)) return false;
        this.consume(p, 36);
        g.world.hooks.wantedUsed(p);
        g.addHostility(t, me, 150 * pi);
        yield* g.world.hooks.wanted(g, p, q);
        return true;
      }
      case 31: case 32: { // 飛行卡 / 電車卡 (大富豪模式, 17 §3.5)
        if (!g.world) return false;
        const left = yield* g.world.hooks.travelCard(g, p, id === 31 ? 'airport' : 'station', human ? undefined : this.aiArg0);
        if (!left) return false;
        this.consume(p, id);
        return true;
      }
      default: return false; // passive cards 18-21 (fcn_004420d5)
    }
  }

  // ---------------------------------------------------------------- passive cards (02 §3.7, 04 §2.6, 06 §2.2)

  /**
   * Passive cards when paying a fee (02 §3.7, 04 §2.6): free card (20) waives, frame card (19) moves the bill.
   * Only fees of at least 2000 × F, or more than cash + deposit, qualify. Returns who pays now and how much.
   */
  *tollPassive(payer: Player, ownerId: number, amount: number): Flow<{ payer: number; amount: number }> {
    const big = () => amount >= 2000 * this.g.priceIndex || amount > payer.cash + payer.bank;
    let who = payer.id;
    if (big() && this.has(payer, 20) && (yield* this.tryFree(payer, ownerId, amount))) amount = 0;
    if (big() && this.has(payer, 19)) {
      const r = yield* this.tryFrame(payer, 1, amount);
      if (r >= 0) who = r;
    }
    return { payer: who, amount };
  }

  /** Pardon (21) or frame (19) before a punishment (06 §2.2): -1 = cancelled, otherwise who suffers it. */
  *pardonOrFrame(p: Player): Flow<number> {
    if (this.consume(p, 21)) {
      // _rich4_use_card_mianzuika: the announcement and the holder's card[0][20]; nobody else speaks.
      yield { t: 'fx', kind: 'card', p: p.id, data: { card: 21 } };
      return -1;
    }
    const r = yield* this.tryFrame(p, 0, 0);
    return r >= 0 ? r : p.id;
  }

  /** _rich4_try_use_card_mianfeika (04 §2.6): human is asked, computer uses it on a fee above cash or a random bar. */
  *tryFree(p: Player, payee: number, fee: number): Flow<boolean> {
    if (!this.has(p, 20)) return false;
    const g = this.g;
    const use = g.isHuman(p)
      ? (yield ask({ t: 'yesno', p: p.id, kind: 'free-card', text: `需付${fee}元\n\n是否使用免費卡？` })) === true
      : fee > p.cash || (g.rng.rand() % 3000 + 3000) * g.priceIndex < fee;
    if (!use) return false;
    this.consume(p, 20);
    yield { t: 'fx', kind: 'card', p: p.id, data: { card: 20 } };
    yield* this.say(undefined, g.isPlayerId(payee) ? `${g.name(p.id)}使用免費卡\n\n免付${g.name(payee)}${fee}元` : `${g.name(p.id)}使用免費卡\n\n免付${fee}元`);
    // _rich4_try_use_card_mianfeika: the holder's card[0][19], then the payee's card[2][19] (face 1).
    if (g.isPlayerId(payee)) yield { t: 'fx', kind: 'card-line', p: payee, data: { card: 20, role: 2 } };
    return true;
  }

  /**
   * _rich4_try_use_card_jiahuoka (04 §2.6): mode 0 punishment, 1 fee, 2 tax. Returns the new sufferer or -1.
   * A human picks among the other living players (the attacker included); with one candidate a yes/no question.
   */
  *tryFrame(p: Player, mode: 0 | 1 | 2, amount: number): Flow<number> {
    if (!this.has(p, 19)) return -1;
    const g = this.g, pi = g.priceIndex;
    let target: number;
    if (g.isHuman(p)) {
      const cands = g.players.filter(q => q.id !== p.id && q.whoPlays !== 0);
      if (!cands.length) return -1;
      if (cands.length === 1) {
        const yes = yield ask({ t: 'yesno', p: p.id, kind: 'frame-card', text: `是否使用嫁禍卡嫁禍給${g.name(cands[0].id)}？` });
        if (yes !== true) return -1;
        target = cands[0].id;
      } else {
        const a = yield ask({ t: 'choose', p: p.id, title: '使用嫁禍卡嫁禍給誰？', options: cands.map(q => ({ label: g.name(q.id), value: q.id })), cancellable: true });
        if (typeof a !== 'number' || !cands.some(q => q.id === a)) return -1;
        target = a;
      }
    } else {
      const use = mode === 0 ? true
        : mode === 1 ? amount > p.cash || (g.rng.rand() % 4000 + 4000) * pi < amount
        : p.cash * 0.2 > 4000 * pi;
      if (!use) return -1;
      target = this.mostHostile(p);
      if (target < 0) {
        const others = g.players.filter(q => q.id !== p.id && q.whoPlays !== 0 && !g.offRoad(q));
        if (!others.length) return -1;
        target = others[g.rng.below(others.length)].id;
      }
    }
    this.consume(p, 19);
    yield { t: 'fx', kind: 'card', p: p.id, data: { card: 19 } };
    // _rich4_try_use_card_jiahuoka: 「嫁禍給%s！」 1500 ms, the holder's card[0][18], the new sufferer's card[2][18] (face 2).
    yield* this.say(undefined, `嫁禍給${g.name(target)}！`);
    yield { t: 'fx', kind: 'card-line', p: target, data: { card: 19, role: 2 } };
    return target;
  }

  // ---------------------------------------------------------------- computer choices (04 §5-§6)

  /** fcn_0041e69e: personality threshold, then the card's own rule; sets aiArg0/aiArg1. */
  aiWants(p: Player, id: number): boolean {
    const card = cardDef(id);
    if (!card || card.passive) return false;
    const d = card.f7 - CHARACTERS[p.character].personality;
    if (d >= 2) return false;
    if (d === 1 && this.g.rng.rand() % 3 !== 0) return false;
    return this.aiJudge(p, id);
  }

  private aiJudge(p: Player, id: number): boolean {
    const g = this.g, pi = g.priceIndex, me = p.id + 1;
    const H = this.mostHostile(p);
    const view = () => this.view(p);
    const seesPlayer = (v: Seen[], id2: number) => v.some(s => s.k === 'player' && s.q.id === id2);
    const set = (a: number, b = this.aiArg1) => { this.aiArg0 = a; this.aiArg1 = b; return true; };
    const standing = g.node(p.node).ref;
    switch (id) {
      case 1: { // fcn_0041e6fe
        const all = g.living();
        const avg = Math.trunc(all.reduce((s, q) => s + q.cash, 0) / all.length);
        return avg > p.cash * 10 && p.cash < 3000 * pi;
      }
      case 2: { // fcn_0041e779
        const v = view();
        if (H >= 0 && seesPlayer(v, H)) {
          const h = g.players[H];
          if (h.cash > 30000 * pi && h.cash > p.cash * 2) return set(H);
        }
        let pick = -1;
        for (const s of v) if (s.k === 'player' && s.q.id !== p.id && s.q.whoPlays && s.q.cash > 50000 * pi && s.q.cash > p.cash * 3) pick = s.q.id;
        return pick >= 0 && set(pick);
      }
      case 3: { // fcn_0041e9e2
        const plot = this.plot(standing);
        return !!plot && this.willingToPay(p, H, standing) && (plot.level * this.perLevel(standing) + plot.price) * pi < p.cash;
      }
      case 4: { // fcn_0041eae2
        const plot = this.plot(standing);
        if (!plot || plot.owner !== me || plot.level > 1) return false;
        if (standing < 4000) {
          const l = plot as Land;
          if (this.street(l.name).some(o => o !== l && o.owner === me)) return false;
          for (const s of view()) {
            if (s.k === 'land' && s.land.name !== l.name && s.land.price > l.price && s.land.level > l.level && this.willingToPay(p, H, s.land.id + 2000)) return set(s.land.id + 2000);
          }
        } else {
          for (const s of view()) {
            if (s.k === 'fac' && s.fac.price > plot.price && s.fac.level > plot.level && this.willingToPay(p, H, s.fac.id + 4000)) return set(s.fac.id + 4000);
          }
        }
        return false;
      }
      case 7: { // fcn_0041ed3e
        const plot = this.plot(standing);
        if (!plot) return false;
        if (standing < 4000) {
          const l = plot as Land;
          if (l.owner !== me) return false;
          const others = this.street(l.name).filter(o => o !== l);
          if (l.chain) return others.some(o => o.owner === me);
          if (l.level !== 1) return false;
          return CHARACTERS[p.character].personality === 0 || others.every(o => o.owner !== 0 && o.owner !== me);
        }
        const f = plot as Facility;
        if (f.owner === me && f.type === 0 && f.level === 1) return set(g.rng.rand() % 4 + 1);
        if (f.owner !== 0 && f.owner !== me && ((f.type !== 0 && f.level >= 3) || (f.owner === H + 1 && f.level >= 2))) return set(0);
        return false;
      }
      case 8: { // fcn_0041ef26
        const plot = this.plot(standing);
        return !!plot && plot.owner !== 0 && plot.owner !== me && (plot.level >= 3 || (plot.owner === H + 1 && plot.level >= 2));
      }
      case 9: { // fcn_0041f037
        const groups = new Map<string, Land[]>();
        for (const s of view()) {
          if (s.k !== 'land' || s.land.owner !== me || s.land.chain || s.land.level >= 5) continue;
          groups.set(s.land.name, [...(groups.get(s.land.name) ?? []), s.land]);
        }
        const cands = [...groups.values()].filter(ls => ls.length >= 3);
        if (!cands.length) return false;
        return set(cands[g.rng.below(cands.length)][0].id + 2000);
      }
      case 10: { // fcn_0041f1b3
        type Stat = { first: Land; count: number[]; levels: number[] };
        const stats = new Map<string, Stat>();
        for (const s of view()) {
          if (s.k !== 'land' || !s.land.owner || s.land.chain) continue;
          const st = stats.get(s.land.name) ?? { first: s.land, count: g.players.map(() => 0), levels: g.players.map(() => 0) };
          st.count[s.land.owner - 1] += 1; st.levels[s.land.owner - 1] += s.land.level;
          stats.set(s.land.name, st);
        }
        for (const st of stats.values()) {
          const mine = st.levels[p.id];
          if (H >= 0) {
            if (st.count[H] >= 2 && st.levels[H] >= 7 && mine <= 1) return set(st.first.id + 2000);
          } else {
            const others = (a: number[]) => a.reduce((x, y, i) => x + (i === p.id ? 0 : y), 0);
            if (mine === 0 && others(st.count) >= 3 && others(st.levels) >= 9) return set(st.first.id + 2000);
          }
        }
        return false;
      }
      case 11: return this.aiMonster(p, H);
      case 12: { // fcn_0041f6a9
        if (this.aiMonster(p, H)) return true;
        const pers = CHARACTERS[p.character].personality;
        const chains = g.players.map(() => 0);
        for (const l of g.board.lands) if (l.owner && l.chain) chains[l.owner - 1] += 1;
        const vehicle = p.traffic & 3;
        for (const s of view()) {
          if (s.k === 'land' && pers !== 0 && s.land.chain && s.land.level && s.land.owner && s.land.owner !== me && chains[s.land.owner - 1] >= 4) return set(s.land.id + 2000);
          if (s.k === 'fac' && (vehicle === 1 || vehicle === 2) && s.fac.owner !== me && s.fac.type === 3 && s.fac.level === 1) return set(s.fac.id + 4000);
          if (s.k === 'obj') {
            const owner = this.plot(g.node(s.node).ref)?.owner ?? 0;
            if (s.type === 16 && owner && owner !== me) return set(OBJECT_TARGET + s.node);
            if (s.type === 17 && owner === me) return set(OBJECT_TARGET + s.node);
          }
        }
        return false;
      }
      case 13: { // fcn_0041f901
        const v = view();
        const best = (q: Player, ok: (f7: number) => boolean) => {
          let id2 = 0;
          for (const c of q.cards) if (ok(cardDef(c)?.f7 ?? 0) && cardPrice(c) > cardPrice(id2)) id2 = c;
          return id2;
        };
        if (H >= 0 && seesPlayer(v, H)) { const c = best(g.players[H], f => f >= 1); if (c) return set(H, c); }
        let who = -1, card = 0;
        for (const s of v) {
          if (s.k !== 'player' || s.q.id === p.id || !s.q.whoPlays) continue;
          const c = best(s.q, f => f === 2);
          if (c && cardPrice(c) > cardPrice(card)) { who = s.q.id; card = c; }
        }
        return who >= 0 && set(who, card);
      }
      case 14: { // fcn_0041facc (bug decision #4: the stale-target branch targets oneself)
        const wealthy = p.cash + p.bank > 10000 && p.luckMoney >= 0;
        if (!p.turtle) {
          const l = standing > 2000 && standing < 4000 ? g.board.lands[standing - 2001] : undefined;
          if (l && l.owner === me && !l.chain && l.level < 5 && l.perLevel * pi < p.cash && wealthy) {
            if (this.street(l.name).some(o => o !== l && o.owner === me) || l.level >= 2) return set(p.id);
          }
          const f = standing > 4000 && standing < 6000 ? g.board.facilities[standing - 4001] : undefined;
          if (f && f.owner === me && f.type !== 0 && f.type !== 3 && f.level < 5 && f.fees[0] * pi < p.cash && p.cash > 10000 && p.luckMoney >= 0) return set(p.id);
        }
        for (const s of view()) {
          if (s.k !== 'player' || s.q.id === p.id || !s.q.whoPlays) continue;
          const ref = g.node(s.q.node).ref;
          const f = ref > 4000 && ref < 6000 ? g.board.facilities[ref - 4001] : undefined;
          const c = ref > 6000 && ref < 8000 ? g.board.companies[ref - 6001] : undefined;
          if ((f && f.owner === me && f.type !== 0 && f.level >= 2) || (c && c.controller === me)) return set(s.q.id);
        }
        return false;
      }
      case 15: return g.rng.rand() % 4 === 0; // fcn_0041fe4e
      case 16: case 17: { // fcn_0041fe6f
        const cands = view().flatMap(s => (s.k === 'player' && s.q.id !== p.id && s.q.whoPlays && !s.q.sleep && !this.has(s.q, 18) ? [s.q.id] : []));
        if (!cands.length) return false;
        return set(cands.includes(H) ? H : cands[g.rng.below(cands.length)]);
      }
      case 22: { // fcn_0041ff77
        const god = g.objects.godType(p);
        if (BAD_GODS.includes(god)) return true;
        return god === 0 && p.bomb !== 0 && (g.objects.slots[p.bomb - 1]?.life ?? 0) < 13;
      }
      case 23: { // fcn_0041fff8
        if (GOOD_GODS.includes(g.objects.godType(p))) return false;
        const o = this.nearestGod(p);
        return !!o && GOOD_GODS.includes(o.type) && set(o.node);
      }
      case 24: { // fcn_00420055 (choice owned by the stock module, 03 §9.5)
        const slot = g.stocks.aiRedCardSlot(p);
        return slot >= 0 && set(slot);
      }
      case 25: { // fcn_004200ea (choice owned by the stock module, 03 §9.5)
        const r = g.stocks.aiBlackCardSlot(p);
        return !!r && set(r.slot);
      }
      case 26: { // fcn_004202d2
        const v = view();
        if (H >= 0 && seesPlayer(v, H) && g.players[H].cash > 30000 * pi) return set(H);
        let pick = -1;
        for (const s of v) if (s.k === 'player' && s.q.id !== p.id && s.q.whoPlays && s.q.cash > 50000 * pi) pick = s.q.id;
        return pick >= 0 && set(pick);
      }
      case 27: { // fcn_0042040e
        for (const s of view()) {
          if (s.k === 'land') {
            const st = this.street(s.land.name);
            if (H >= 0 && st.some(l => l.owner === H + 1)) continue;
            const mine = st.filter(l => l.owner === me);
            const myLevels = mine.reduce((x, l) => x + l.level, 0);
            const theirLevels = st.filter(l => l.owner && l.owner !== me).reduce((x, l) => x + l.level, 0);
            if (myLevels >= 7 && theirLevels <= 3 && mine.length / st.length >= 0.66) return set(s.land.id + 2000);
          } else if (s.k === 'fac' && s.fac.owner === me && s.fac.type !== 0 && s.fac.type !== 4 && s.fac.level >= 3) return set(s.fac.id + 4000);
        }
        return false;
      }
      case 28: { // fcn_0042062b
        for (const nodeId of this.predict(p, 6).nodes) {
          const ref = g.node(nodeId).ref;
          if (ref > 2000 && ref < 4000) {
            const st = this.street(g.board.lands[ref - 2001].name);
            if (!st.some(l => l.owner === me) && st.filter(l => l.owner).reduce((x, l) => x + l.level, 0) >= 7) return set(ref);
          } else if (ref > 4000 && ref < 6000) {
            const f = g.board.facilities[ref - 4001];
            if (H >= 0 && f.owner === H + 1 && f.type !== 0 && f.level >= 3) return set(ref);
          }
        }
        return false;
      }
      case 29: { // fcn_004207cc
        let P = -1, most = 0;
        for (const q of this.opponents(p)) {
          const n = g.board.lands.filter(l => l.owner === q.id + 1).length + g.board.facilities.filter(f => f.owner === q.id + 1).length;
          if (n > most) { most = n; P = q.id; }
        }
        return P >= 0 && P !== H && p.ally !== P + 1 && seesPlayer(view(), P) && set(P);
      }
      case 30: return this.aiTurtle(p);
      case 33: { // 遣返: the most resented rival on screen, else a richer one standing in view (17 §3.5)
        if (!g.world) return false;
        const v = view().filter(s => s.k === 'player' && s.q.id !== p.id && s.q.whoPlays && !g.offRoad(s.q)) as Extract<Seen, { k: 'player' }>[];
        if (H >= 0 && v.some(s => s.q.id === H)) return set(H);
        const rich = v.map(s => s.q).filter(q => g.wealth(q) > g.wealth(p) * 0.8).sort((a, b) => g.wealth(b) - g.wealth(a))[0];
        return !!rich && set(rich.id);
      }
      case 34: return !!g.world && g.world.hooks.aiDictate(g, p);
      case 35: return !!g.world && g.world.hooks.aiSummon(g, p);
      case 36: { const t = g.world ? g.world.hooks.aiWanted(g, p) : -1; return t >= 0 && set(t); }
      case 31: case 32: { // 大富豪模式: the computer's own travel evaluation with a free ticket (17 §3.5)
        const d = g.world ? g.world.hooks.aiCardTrip(g, p, id === 31 ? 'airport' : 'station') : -1;
        return d >= 0 && set(d);
      }
      default: return false; // 5 換屋, 6 轉向: never (fcn_0041e6e3)
    }
  }

  /** Monster card choice fcn_0041f400 (also the first try of the demolish card). */
  private aiMonster(p: Player, H: number): boolean {
    const better = (a: { level: number; price: number } | undefined, b: { level: number; price: number }) =>
      !a || b.level > a.level || (b.level === a.level && b.price > a.price);
    const lands: (Land | undefined)[] = [], facs: (Facility | undefined)[] = [];
    for (const s of this.view(p)) {
      if (s.k === 'land' && s.land.owner && s.land.owner !== p.id + 1 && s.land.level >= 3 && better(lands[s.land.owner - 1], s.land)) lands[s.land.owner - 1] = s.land;
      if (s.k === 'fac' && s.fac.owner && s.fac.owner !== p.id + 1 && s.fac.level >= 3 && better(facs[s.fac.owner - 1], s.fac)) facs[s.fac.owner - 1] = s.fac;
    }
    let target = 0;
    if (H >= 0) target = facs[H] ? facs[H]!.id + 4000 : lands[H] ? lands[H]!.id + 2000 : 0;
    else {
      let f: Facility | undefined, l: Land | undefined;
      for (const x of facs) if (x && better(f, x)) f = x;
      for (const x of lands) if (x && x.level >= 4 && better(l, x)) l = x;
      target = f ? f.id + 4000 : l ? l.id + 2000 : 0;
    }
    if (!target) return false;
    this.aiArg0 = target;
    return true;
  }

  /** Turtle card choice fcn_00420970. */
  private aiTurtle(p: Player): boolean {
    const g = this.g, pi = g.priceIndex, me = p.id + 1;
    const self = this.predict(p, 3);
    if (!self.forked) {
      let count = 0, sum = 0, bad = false;
      for (const nodeId of self.nodes) {
        const n = g.node(nodeId), ref = n.ref;
        if (ref > 2000 && ref < 4000) {
          const l = g.board.lands[ref - 2001];
          if (l.owner === 0) { count++; sum += l.price; }
          else if (l.owner === me) { if (!l.chain && l.level < 5) { count++; sum += l.perLevel; } }
          else if (g.calcToll(l.owner, l.chain ? null : l.name) > 1000 * pi) bad = true;
        } else if (ref > 4000 && ref < 6000) {
          const f = g.board.facilities[ref - 4001];
          if (f.owner === 0) { count++; sum += f.price; }
          else if (f.owner === me) { if (f.type !== 0 && f.type !== 3 && f.level < 5) { count++; sum += f.fees[0]; } }
          else if (f.type !== 0 && f.type !== 4 && f.level) bad = true;
        } else if (ref > 6000 && ref < 8000) {
          const c = g.board.companies[ref - 6001];
          if (c.controller && c.controller !== me) bad = true;
        }
      }
      if (!bad && p.cash > 1.5 * sum && count >= 2 && p.cash + p.bank > 10000 && p.luckMoney >= 0) { this.aiArg0 = p.id; return true; }
    }
    for (const s of this.view(p)) {
      if (s.k !== 'player' || s.q.id === p.id || !s.q.whoPlays) continue;
      const path = this.predict(s.q, 3);
      if (path.forked) continue;
      let mine = 0, toll = 0, ok = true;
      for (const nodeId of path.nodes) {
        const ref = g.node(nodeId).ref, plot = this.plot(ref);
        if (!plot) continue;
        if (plot.owner !== me) { ok = false; break; }
        mine++;
        if (ref < 4000) { const l = plot as Land; toll += g.calcToll(me, l.chain ? null : l.name); }
        else { const f = plot as Facility; if (f.type === 1 || f.type === 2) toll += f.fees[f.level] * pi; }
      }
      if (ok && mine >= 2 && toll >= 10000 * pi) { this.aiArg0 = s.q.id; return true; }
    }
    return false;
  }

  // ---------------------------------------------------------------- helpers

  /** _rich4_find_most_hostile_player: strictly highest hostility above 0, lowest id on ties; -1 when none. */
  mostHostile(p: Player): number {
    let best = -1, v = 0;
    for (const q of this.g.players) if (q.id !== p.id && q.whoPlays !== 0 && p.hostility[q.id] > v) { v = p.hostility[q.id]; best = q.id; }
    return best;
  }

  /** "愿意出钱的地" fcn_0041e8e6 (04 §5.3). */
  private willingToPay(p: Player, H: number, ref: number): boolean {
    if (H < 0) return false;
    const me = p.id + 1, plot = this.plot(ref);
    if (!plot || plot.owner === 0 || plot.owner === me) return false;
    if (ref > 4000) return plot.level !== 0;
    const l = plot as Land;
    return (l.level !== 0 && this.street(l.name).some(o => o.owner === me)) || (l.owner === H + 1 && l.level >= 2);
  }

  /** What the 440 × 440 viewport centred on the player shows, in screen row order (04 §5.3, 推测 Q20). */
  private view(p: Player): Seen[] {
    const g = this.g, c = g.node(p.node);
    const inside = (x: number, y: number) => Math.abs(x - c.x) <= VIEW_HALF && Math.abs(y - c.y) <= VIEW_HALF;
    const out: Seen[] = [];
    for (const land of g.board.lands) if (inside(land.x, land.y)) out.push({ k: 'land', x: land.x, y: land.y, land });
    for (const fac of g.board.facilities) if (inside(fac.x, fac.y)) out.push({ k: 'fac', x: fac.x, y: fac.y, fac });
    for (const q of g.players) {
      if (!q.placed || q.whoPlays === 0 || g.offRoad(q)) continue;
      const n = g.node(q.node);
      if (inside(n.x, n.y)) out.push({ k: 'player', x: n.x, y: n.y, q });
    }
    g.places.npcs.forEach((npc, i) => {
      if (npc.where !== 0 || !npc.node) return;
      const n = g.node(npc.node);
      if (inside(n.x, n.y)) out.push({ k: 'npc', x: n.x, y: n.y, actor: g.npcBase + i, npc });
    });
    g.objects.slots.forEach((o, slot) => {
      if (!o.node || o.owner) return;
      const n = g.node(o.node);
      if (inside(n.x, n.y)) out.push({ k: 'obj', x: n.x, y: n.y, slot, node: o.node, type: o.type });
    });
    return out.sort((a, b) => a.y - b.y || a.x - b.x);
  }

  /** Nearest free attachable god in view (fcn_00444d1a, distance < 10000 px). */
  private nearestGod(p: Player): { node: number; type: number } | undefined {
    const c = this.g.node(p.node);
    let best: { node: number; type: number } | undefined, dist = 10000;
    for (const s of this.view(p)) {
      if (s.k !== 'obj' || !ATTACHABLE(s.type)) continue;
      const d = Math.hypot(s.x - c.x, s.y - c.y);
      if (d < dist) { dist = d; best = { node: s.node, type: s.type }; }
    }
    return best;
  }

  /** Exits of a node except the way in (same filter as Game.nextNode). */
  private exits(n: BoardNode, from: number): number[] {
    return n.adjacent.filter((a, j) => a && a !== from && !(n.oneWay & (8 >> j)));
  }

  /** Path prediction fcn_0040b221: n nodes ahead, random at forks (uses rand like a real step). */
  predict(w: Walker, n: number): { nodes: number[]; forked: boolean } {
    let at = w.node, from = w.lastNode, forked = false;
    const nodes: number[] = [], player = (this.g.players as Walker[]).indexOf(w);
    for (let i = 0; i < n; i++) {
      if (this.exits(this.g.node(at), from).length >= 2) forked = true;
      // A player's route follows that player's own fork choices (14 §2), as it will happen; an NPC's stays random.
      const next = player >= 0 ? this.g.peekNext(player, at, from) : this.g.nextNode(at, from);
      from = at; at = next;
      nodes.push(at);
    }
    return { nodes, forked };
  }

  private walker(actor: number): Walker { return actor < this.g.npcBase ? this.g.players[actor] : this.npc(actor); }
  private npc(actor: number): Npc { return this.g.places.npcs[actor - this.g.npcBase]; }

  /** Sleepwalk (04 §3.16): save the vehicle and dice, put a scooter or car back into the tools, walk with one die. */
  private sleepwalk(q: Player, days: number) {
    q.sleepwalk = days;
    const v = q.traffic & 3;
    q.sleepTraffic = v === 1 || v === 2 ? v : 0;
    q.sleepDice = q.dice;
    if (v === 1 || v === 2) { q.tools[v + 3] += 1; q.traffic = 0; q.dice = 1; }
  }

  /** Land (2001..) or facility (4001..) record by reference. */
  private plot(ref: number): Land | Facility | undefined {
    if (ref > 2000 && ref < 4000) return this.g.board.lands[ref - 2001];
    if (ref > 4000 && ref < 6000) return this.g.board.facilities[ref - 4001];
    return undefined;
  }

  private perLevel(ref: number): number {
    return ref < 4000 ? (this.plot(ref) as Land).perLevel : (this.plot(ref) as Facility).fees[0];
  }

  private street(name: string): Land[] { return this.g.board.lands.filter(l => l.name === name); }

  private builtNotMine(p: Player, ref: number): boolean {
    const plot = this.plot(ref);
    return !!plot && plot.owner !== p.id + 1 && plot.level !== 0;
  }

  /** Plot references (lots 2001.., facilities 4001..) that some road node borders and that pass a test. */
  private plotRefs(ok: (ref: number) => boolean): number[] {
    const refs = new Set(this.g.board.nodes.map(n => n.ref).filter(r => this.plot(r)));
    return [...refs].filter(ok).sort((a, b) => a - b);
  }

  private plotName(ref: number): string { return this.plot(ref)?.name ?? ''; }

  /** On the map where the selector can click it (drawn: placed and not in a hotel, vanished, in prison or hospital). */
  private onMap(actor: number): boolean {
    if (actor < this.g.npcBase) { const q = this.g.players[actor]; return !!q && q.placed && q.whoPlays !== 0 && !this.g.offRoad(q); }
    const n = this.g.places.npcs[actor - this.g.npcBase];
    return !!n && n.where === 0 && n.node > 0;
  }

  private actorName(actor: number): string { return actor < this.g.npcBase ? this.g.name(actor) : NPC_NAMES[actor - this.g.npcBase] ?? ''; }

  /**
   * 拆除卡's human pick (flags 0x0e0c0626, condition 6 at ui_use_tool.asm:769-820): lots / facilities not one's own with a
   * building, roadblocks, mines and time bombs on the road, and time bombs carried by a player on the map
   * (README bug decision #17). Returns the plot reference or the object slot id, null when cancelled.
   */
  private *pickDemolish(p: Player): Flow<{ ref: number; slot: number } | null> {
    const g = this.g, spots: PickSpot[] = [], targets: { ref: number; slot: number }[] = [];
    for (const ref of this.plotRefs(r => this.builtNotMine(p, r))) {
      spots.push({ at: 'plot', id: ref, label: this.plotName(ref) });
      targets.push({ ref, slot: 0 });
    }
    g.objects.slots.forEach((o, i) => {
      if (o.type < 16 || o.type > 18) return;
      if (o.node && !o.owner) {
        spots.push({ at: 'node', id: o.node, label: OBJECT_NAMES[o.type - 1] });
        targets.push({ ref: 0, slot: i + 1 });
      } else if (o.type === 18 && o.owner && g.players[o.owner - 1]?.bomb === i + 1 && this.onMap(o.owner - 1)) {
        spots.push({ at: 'actor', id: o.owner - 1, label: `${g.name(o.owner - 1)}身上的定時炸彈` });
        targets.push({ ref: 0, slot: i + 1 });
      }
    });
    if (!spots.length) return null;
    const a = yield ask({ t: 'pick-map', p: p.id, title: '請選擇拆除目標', spots, cancellable: true, onScreen: true });
    return typeof a === 'number' && targets[a] ? targets[a] : null;
  }

  private opponents(p: Player): Player[] {
    return this.g.players.filter(q => q.id !== p.id && q.whoPlays !== 0);
  }

  /** Players and NPCs on the board (selector type 0x10); NPCs are npcBase.. (4..7 with up to 4 players). */
  private actors(p: Player, self: boolean): number[] {
    const list = this.g.players.filter(q => q.placed && q.whoPlays !== 0 && (self || q.id !== p.id)).map(q => q.id);
    this.g.places.npcs.forEach((n, i) => { if (n.where === 0 && n.node) list.push(this.g.npcBase + i); });
    return list;
  }

  /**
   * A player or NPC target (selector type 0x10): picked on the map like the original, among those drawn on the
   * player's screen; the computer's choice is aiArg0.
   */
  private *pickPlayer(p: Player, human: boolean, title: string, list: number[]): Flow<number> {
    if (!human) return list.includes(this.aiArg0) ? this.aiArg0 : -1;
    const ids = list.filter(id => this.onMap(id));
    if (!ids.length) return -1;
    const spots: PickSpot[] = ids.map(id => ({ at: 'actor', id, label: this.actorName(id) }));
    const a = yield ask({ t: 'pick-map', p: p.id, title, spots, cancellable: true, onScreen: true });
    return typeof a === 'number' && ids[a] !== undefined ? ids[a] : -1;
  }

  /** Human picks a lot / facility among `refs` on its building (selector types 0x02 / 0x04); the computer's choice is aiArg0. */
  private *pickRef(p: Player, human: boolean, title: string, refs: number[]): Flow<number> {
    if (!human) return this.plot(this.aiArg0) ? this.aiArg0 : -1;
    if (!refs.length) return -1;
    // Picked on the map as in the original: only what is on the player's screen.
    const spots: PickSpot[] = refs.map(ref => ({ at: 'plot', id: ref, label: this.plotName(ref) }));
    const a = yield ask({ t: 'pick-map', p: p.id, title, spots, cancellable: true, onScreen: true });
    return typeof a === 'number' && refs[a] !== undefined ? refs[a] : -1;
  }

  private *chooseFacilityType(p: Player, cancellable = true): Flow<number> {
    // The same picture row of the five facilities as building on an empty large plot (hud 'facility-type').
    const a = yield ask({ t: 'facility-type', p: p.id, price: 0, title: '請選擇設施類型', text: '改建成哪一種設施？', cancellable });
    return typeof a === 'number' && a >= 0 && a <= 4 ? a : cancellable ? -1 : 0;
  }

  private *say(p: Player | undefined, text: string): Flow { yield { t: 'say', p: p?.id, text }; }
}
