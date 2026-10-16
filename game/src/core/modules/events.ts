/**
 * News and fate — docs/rules/06 §3 and §4. Owns: the two fixed shuffled decks and their read positions.
 *
 * Both decks are shuffled once at a new game and then read in a fixed cycle forever (06 §3.2, §4.1). An entry
 * whose precondition fails is skipped and consumed; the fate check may also rewrite an entry (10 → 11 …).
 * Fate money is × the price index at that moment and goes through the god luck check (06 §2.1, §3.3);
 * news never asks the gods (06 §4.1). Texts are short summaries, not the original wording. After every entry an
 * `event-result` fx says who got or paid what and what happened where (the remake's result box).
 */
import { ask, type Flow } from '../flow';
import type { Game } from '../game';
import type { Rng } from '../rng';
import type { Player } from '../types';
import { cardName, cardPrice, isTycoonCard } from './cards';
import { regionalDraw } from './regional-events'; // 大富豪模式 local news / fate (docs/rules/18)

/** Card points and tools selling the fate entry 32 needs (04 §4.4, 05 §2.4); used when the modules provide them. */
interface SellAllHook { sellAllForPoints(p: Player): number }

/** Card table prices and names (docs/rules/04 §1), for the fallback of fate 32 and the birthday choice. */
const CARD_PRICES = [200, 200, 35, 25, 20, 20, 15, 20, 160, 180, 60, 15, 25, 20, 100, 25, 20, 20, 40, 25, 25, 10, 20, 50, 30, 35, 35, 35, 40, 70];
const CARD_NAMES = [
  '均富卡', '均貧卡', '購地卡', '換地卡', '換屋卡', '轉向卡', '改建卡', '拍賣卡', '天使卡', '惡魔卡',
  '怪獸卡', '拆除卡', '搶奪卡', '停留卡', '冬眠卡', '夢遊卡', '陷害卡', '復仇卡', '嫁禍卡', '免費卡',
  '免罪卡', '送神符', '請神符', '紅卡', '黑卡', '查稅卡', '漲價卡', '查封卡', '同盟卡', '烏龜卡',
];
/** Tool table prices (docs/rules/05 §1). */
const TOOL_PRICES = [15, 30, 25, 25, 80, 150, 100, 30, 30, 40, 95, 150, 250];

type ResultFn = (fx: string, lines: ResultLine[], o?: Partial<EventResult> & { node?: number }) => Flow;

export const FATE_COUNT = 37;
export const NEWS_COUNT = 36;

/** Fate entries 0..32 (06 §3.1), short texts. */
const FATE_TEXT = [
  '政府強制拆除房屋一棟', '政府強制徵收土地一處', '被人冒名貸款', '支票跳票，銀行拒絕往來一個月',
  '入侵銀行電腦，挪用他人存款一成', '生日快樂，每人送你一張卡片', '被迫出國觀光3天', '被外星人綁架3天',
  '股票違約交割，損失一成股票', '變賣所有股票求現', '機車被偷了', '汽車撞上電線桿全毀',
  '掉進水溝，住院3天', '騎機車摔傷，住院3天', '行人闖越馬路，罰款', '騎機車未戴安全帽，罰款',
  '開車超速，罰款', '請所有人吃大餐', '亂丟垃圾，罰款', '小狗隨地便溺，罰款',
  '路邊撿到錢', '路邊撿到錢', '路邊撿到錢', '遺失錢包', '遺失錢包', '意外獲得一筆遺產', '被倒會',
  '發票中獎', '發票中獎', '發票中獎', '繳交保險金', '領取保險金', '變賣所有卡片道具換成點券',
];
/** Per-map prison entries 33..36 by game_map (06 §3.4); days 3, 5, 7, 9. */
const PRISON_TEXT = [
  ['酒醉大鬧警局', '妨害風化', '走私毒品', '販賣大補帖'],
  ['酒醉大鬧警局', '違法聚眾示威', '獵捕保育動物', '盜賣國寶'],
  ['誘騙未成年少女', '妨害風化', '走私毒品', '施放毒氣'],
  ['非法持有槍械', '毆打警員', '獵捕保育動物', '盜賣國家機密'],
];
const PRISON_DAYS = [3, 5, 7, 9];
/** Fines to the system (luck "loss", insurance refunds) and gains (luck "gain") in units of 1000 × F. */
const FINES: Record<number, number> = { 14: 3, 15: 3, 16: 3, 17: 6, 18: 0.6, 19: 1.5, 23: 1, 24: 2, 26: 8, 30: 5 };
const GAINS: Record<number, number> = { 20: 1, 21: 2, 22: 3, 25: 10, 27: 4, 28: 6, 29: 8, 31: 5 };

/** One line of an event's result box: who (optional), what happened to them, money received (+) or paid (−). */
export interface ResultLine { p?: number; text: string; amount?: number }

/**
 * What a news or fate entry did, shown after it (the `event-result` fx; presentation only, no rules). `fx` names
 * the kind of event for its map effect; `refs` are the lots hit, `focus` the players concerned; `line` is the
 * original's money line that follows (fcn_0044f354 received / fcn_0044f42d paid / fcn_0044f567 waived, for
 * `amount`) or the lot owner's cry (event[3 | 4]).
 */
export interface EventResult {
  src: 'news' | 'fate';
  id: number;
  fx: string;
  /** The category (news) or 命運, and the event in a few words. */
  title: string;
  head: string;
  lines: ResultLine[];
  refs?: number[];
  focus?: number[];
  line?: 'gain' | 'loss' | 'free' | 'cry';
  amount?: number;
}

/** Players listed on a news board with their faces, as the original draws them (news.asm fcn_004562a5 at x 390). */
export interface BoardFace { p: number; amount?: number }

const NEWS_CATEGORY = (ev: number) =>
  ev <= 5 ? '無責任新聞' : ev <= 13 ? '政府公告' : ev <= 15 ? '社會新聞' : ev <= 17 ? '路況報導' : ev <= 21 ? '氣象報導' : '財經新聞';

/** Uniform shuffle of 0..n-1 the original way (fcn_0044baea / fcn_00448b81): step k takes the (rand() % (n-k))-th unused number. */
export function shuffleDeck(rng: Rng, n: number): number[] {
  const left = Array.from({ length: n }, (_, i) => i);
  const deck: number[] = [];
  for (let k = 0; k < n; k++) deck.push(left.splice(rng.rand() % (n - k), 1)[0]);
  return deck;
}

export class Events {
  /** Deck orders (permutations) and next read positions (06 §3.2, §4.1). */
  newsDeck: number[] = [];
  newsNext = 0;
  fateDeck: number[] = [];
  fateNext = 0;

  constructor(readonly g: Game) {}

  /** New game: shuffle both decks (06 §3.2, §4.1); the news deck first, as in rich4_new_game.asm:4284-4285. */
  init(): void {
    this.newsDeck = shuffleDeck(this.g.rng, NEWS_COUNT);
    this.newsNext = 0;
    this.fateDeck = shuffleDeck(this.g.rng, FATE_COUNT);
    this.fateNext = 0;
  }

  /**
   * The decks read (大富豪模式, docs/rules/18 §2 / 17 §4): one nationwide news deck and one fate deck, the first city's
   * (saved with it); every city still shuffles its own at the start (same rand() use) but reads the world's. A normal
   * game reads its own.
   */
  private deck(): Events { return this.g.world ? this.g.world.hooks.allCities()[0]?.events ?? this : this; }

  // ================================================================ fate (06 §3)

  /** Fate tile, t = 3 (06 §3): draw the next eligible entry, show it, then apply it. */
  *fate(p: Player): Flow {
    // 大富豪模式 hook (docs/rules/18 §2): a tycoon city may draw one of its own fate events instead; never in a normal game.
    if (this.g.world && (yield* regionalDraw(this.g, p, 'fate'))) return;
    const t = this.drawFate(p);
    if (t < 0) return;
    yield* this.applyFate(p, t);
  }

  /** Read the deck until an entry passes its check (fcn_0044db81); skipped entries are consumed. Returns the entry or -1. */
  drawFate(p: Player): number {
    const d = this.deck();
    for (let i = 0; i < FATE_COUNT; i++) {
      const raw = d.fateDeck[d.fateNext];
      d.fateNext = (d.fateNext + 1) % FATE_COUNT;
      const t = this.fateCheck(p, raw);
      if (t >= 0) return t;
    }
    return -1;
  }

  /** Precondition fcn_0044bb4b (06 §3.1): the entry to run (possibly rewritten), or -1 to skip. */
  fateCheck(p: Player, t: number): number {
    const g = this.g, me = p.id + 1;
    if (g.rules?.finaleDeny?.('fate', t)) return -1; // 大富翁城 (docs/rules/19 §3): not there
    switch (t) {
      case 0: return g.board.lands.some(l => l.owner === me && l.level !== 0) ? t : -1;
      case 1: return g.board.lands.some(l => l.owner === me && l.level === 0) ? t : -1;
      case 5: return g.players.some(q => q.id !== p.id && q.cards.length > 0) ? t : -1;
      case 8: case 9: return this.shares(p) > 0 ? t : -1;
      case 10: case 11: return p.traffic === 1 ? 10 : p.traffic === 2 ? 11 : -1;
      case 12: case 13: return p.traffic === 0 ? 12 : p.traffic === 1 ? 13 : -1;
      case 14: case 15: case 16: return p.traffic === 0 ? 14 : p.traffic === 1 ? 15 : p.traffic === 2 ? 16 : -1;
      case 33: case 34: case 35: case 36: return g.mapSlot >> 2 === 0 ? t : -1; // game_stage 0 only
      default: return t;
    }
  }

  /** Text shown for a fate entry (phase 0). */
  fateText(t: number): string {
    const F = this.g.priceIndex;
    if (t >= 33) return `${PRISON_TEXT[this.g.mapSlot & 3][t - 33]}，坐牢${PRISON_DAYS[t - 33]}天`;
    if (t === 2) return `${FATE_TEXT[t]}${10000 * F}元`;
    if (t in FINES) return `${FATE_TEXT[t]}${FINES[t] * 1000 * F}元`;
    if (t in GAINS) return `${FATE_TEXT[t]}${GAINS[t] * 1000 * F}元`;
    return FATE_TEXT[t];
  }

  /** Show and apply one fate entry (call_table[t], or call_table[game_map × 4 + t] for 33..36), then its result. */
  *applyFate(p: Player, t: number): Flow {
    const g = this.g, F = g.priceIndex;
    yield { t: 'fx', kind: 'fate', p: p.id, data: { id: t, text: this.fateText(t) } };
    const head = t >= 33 ? PRISON_TEXT[g.mapSlot & 3][t - 33] : FATE_TEXT[t];
    const done = (fx: string, lines: ResultLine[], o: Partial<EventResult> & { node?: number } = {}) =>
      this.result(p, { src: 'fate', id: t, fx, title: '命運', head, lines, focus: [p.id], ...o });
    if (t in FINES) { yield* this.fine(p, FINES[t] * 1000 * F, FATE_TEXT[t], done); return; }
    if (t in GAINS) { yield* this.bonus(p, GAINS[t] * 1000 * F, FATE_TEXT[t], done); return; }
    if (t >= 33) {
      // fortune.asm fcn_0044d783: escaping by a god's luck says event[0] (face 0) after the god's message box.
      yield* this.misfortune(p, PRISON_DAYS[t - 33], (q, days) => g.sendTo(q, 'prison', days), 'prison', d => `坐牢${d}天`, done, true);
      return;
    }
    switch (t) {
      case 0: { // own built lot: building cleared, level × build cost back in cash, not × F
        const lots = g.board.lands.filter(l => l.owner === p.id + 1 && l.level !== 0);
        const l = lots[g.rng.below(lots.length)];
        const pay = l.level * l.perLevel;
        l.level = 0; l.chain = false;
        g.gain(p, pay, 1);
        yield { t: 'board' };
        yield { t: 'pay', from: -1, to: p.id, amount: pay, reason: '拆除補償', quiet: true };
        // fortune.asm fcn_0044be16: the camera on the lot, the flash, then the owner's event[3 | 4].
        yield* done('demolish', [{ p: p.id, text: `${l.name}的房屋被拆除`, amount: pay }], { refs: [l.id + 2000], node: this.nodeOf(l.id + 2000), line: 'cry' });
        return;
      }
      case 1: { // own empty lot: owner cleared, land price back in cash, not × F
        const lots = g.board.lands.filter(l => l.owner === p.id + 1 && l.level === 0);
        const l = lots[g.rng.below(lots.length)];
        l.owner = 0; l.expire = 0;
        g.gain(p, l.price, 1);
        yield { t: 'board' };
        yield { t: 'pay', from: -1, to: p.id, amount: l.price, reason: '徵收補償', quiet: true };
        // fortune.asm fcn_0044bfb1 has no line (only fate 0 makes the owner cry, docs/rules/15 §3).
        yield* done('expropriate', [{ p: p.id, text: `${l.name}的土地被徵收`, amount: l.price }], { refs: [l.id + 2000], node: this.nodeOf(l.id + 2000) });
        return;
      }
      case 2: { // fake loan: the loan grows, the bank does not
        const r = yield* g.objects.luck(p, 0, 1);
        if (r === 1) { yield* done('blessed', [{ p: p.id, text: this.luckText(p, true, '逃過冒名貸款') }]); return; }
        const amount = 10000 * F * (r === 2 ? 2 : 1);
        p.loan += amount;
        g.setLoanDue(p);
        yield* g.say(p.id, `貸款增加${amount}元`);
        yield* done('loan', [{ p: p.id, text: `被冒名貸款，貸款增加${amount}元${r === 2 ? '（加倍）' : ''}` }]);
        yield* g.insurancePayout(p, amount);
        return;
      }
      case 3: { // bank refuses for 30 days; r = 2 has no doubling
        const r = yield* g.objects.luck(p, 0, 1);
        if (r === 1) { yield* done('blessed', [{ p: p.id, text: this.luckText(p, true, '支票沒有跳票') }]); return; }
        p.bankRefused = (p.bankRefused + 30) & 0xff;
        yield* done('bank-refuse', [{ p: p.id, text: '銀行拒絕往來30天' }]);
        return;
      }
      case 4: { // 10% of every other living player's deposit, deposit to deposit
        const lines: ResultLine[] = [];
        let sum = 0;
        for (const q of g.players) {
          if (q.id === p.id || !q.whoPlays || q.bank === 0) continue;
          const x = Math.trunc(q.bank * 0.1);
          if (x > 0) { yield* g.transfer(q.id, p.id, x, 4, '挪用存款', true); lines.push({ p: q.id, text: '存款被挪用', amount: -x }); sum += x; }
          if (!p.whoPlays || g.over) break;
        }
        if (g.over) return;
        yield* done('steal', [...lines, { p: p.id, text: lines.length ? '存款共增加' : '沒有挪用到存款', amount: lines.length ? sum : undefined }],
          { focus: [p.id, ...lines.map(l => l.p!)] });
        return;
      }
      case 5: {
        const got = yield* this.birthday(p);
        yield* done('birthday', got.length ? got.map(([q, card]) => ({ p: q, text: `送給${g.name(p.id)}${CARD_NAMES[card - 1] ?? (cardName(card) || '卡片')}` })) : [{ p: p.id, text: '沒有收到卡片' }],
          { focus: [p.id, ...got.map(([q]) => q)] });
        return;
      }
      case 6: case 7: // trip abroad / alien abduction 3 days
        yield* this.misfortune(p, 3, (q, days) => g.vanish(q, days, t === 7), t === 7 ? 'abduct' : 'abroad', d => (t === 7 ? `被外星人綁架${d}天` : `出國觀光${d}天`), done);
        return;
      case 8: { // 10% of every stock sold into the lottery pool; r = 2 has no doubling
        const r = yield* g.objects.luck(p, 0, 1);
        if (r === 1) { yield* done('blessed', [{ p: p.id, text: this.luckText(p, true, '股票沒有損失') }]); return; }
        const before = this.shares(p);
        for (const m of g.markets()) yield* m.confiscate(p, 10);
        yield* g.financeRecall(); // rich4_fortune.asm:974
        yield* done('stock-loss', [{ p: p.id, text: `違約交割，股票少了${before - this.shares(p)}股` }]);
        return;
      }
      case 9: { // sell every share for money; r = 2 has no doubling
        const r = yield* g.objects.luck(p, 0, 1);
        if (r === 1) { yield* done('blessed', [{ p: p.id, text: this.luckText(p, true, '不必變賣股票') }]); return; }
        const cash = p.cash + p.bank, shares = this.shares(p);
        for (const m of g.markets()) yield* m.sellAll(p, false);
        yield* g.financeRecall(); // rich4_fortune.asm:1089
        if (g.over) return;
        yield* done('stock-sell', [{ p: p.id, text: `賣掉全部${shares}股股票`, amount: p.cash + p.bank - cash }]);
        return;
      }
      case 10: case 11: { // vehicle lost to the shop stock; r = 2 has no doubling
        const r = yield* g.objects.luck(p, 1, 1);
        if (r === 1) { yield* done('blessed', [{ p: p.id, text: this.luckText(p, true, t === 11 ? '汽車完好無缺' : '機車失而復得') }]); return; }
        g.tools.destroyVehicle(p);
        yield* done('vehicle', [{ p: p.id, text: t === 11 ? '汽車全毀，只能走路了' : '機車被偷，只能走路了' }]);
        // The loser's line (fortune.asm fcn_0044ca46 / fcn_0044cb53): scooter stolen event[3 | 4], car wrecked event[3].
        yield { t: 'fx', kind: 'vehicle-lost', p: p.id, data: { car: t === 11 } };
        return;
      }
      case 12: case 13: // ditch / scooter crash: vehicle wrecked, hospital 3 days
        yield* this.misfortune(p, 3, function* (q, days) {
          g.tools.destroyVehicle(q);
          yield* g.sendTo(q, 'hospital', days);
        }, 'hospital', d => `住院${d}天`, done);
        return;
      case 32: { // every card and tool sold at the full price for points (u16); r = 2 has no extra effect
        const r = yield* g.objects.luck(p, 1, 1);
        if (r === 1) { yield* done('blessed', [{ p: p.id, text: this.luckText(p, true, '卡片道具都保住了') }]); return; }
        const points = this.sellAllForPoints(p);
        p.points = (p.points + points) & 0xffff;
        yield { t: 'points', p: p.id, amount: points };
        yield* done('cards', [{ p: p.id, text: `卡片道具全部賣掉，換得${points}點券` }]);
        // fortune.asm fcn_0044d677 (2185-2205): then the player's event[3] (face 2).
        yield { t: 'fx', kind: 'lament', p: p.id, data: { slot: 3, face: 2 } };
        return;
      }
    }
  }

  /** Fine to the system (06 §3.1 entry 14): luck "loss", then the insurer refunds the whole fine. */
  private *fine(p: Player, base: number, reason: string, done: ResultFn): Flow {
    const r = yield* this.g.objects.luck(p, 0, 1);
    // fortune.asm loc_0044ce35: r = 1 → the waived line fcn_0044f567; else pay, the paid line fcn_0044f42d, insurance.
    if (r === 1) { yield* done('blessed', [{ p: p.id, text: this.luckText(p, true, `免付${base}元`) }], { line: 'free', amount: base }); return; }
    const amount = r === 2 ? base * 2 : base;
    yield* this.g.transfer(p.id, -1, amount, 0, reason, true);
    if (this.g.over) return;
    yield* done('fine', [{ p: p.id, text: r === 2 ? `${reason}（${this.luckText(p, false, '罰金加倍')}）` : reason, amount: -amount }], { line: 'loss', amount });
    if (p.whoPlays && !this.g.over) yield* this.g.insurancePayout(p, amount);
  }

  /** Money found (06 §3.1 entry 20): luck "gain", r = 1 voids it, r = 2 doubles it; into cash. */
  private *bonus(p: Player, base: number, reason: string, done: ResultFn): Flow {
    const r = yield* this.g.objects.luck(p, 0, 0);
    if (r === 1) { yield* done('cursed', [{ p: p.id, text: this.luckText(p, false, `${base}元泡湯了`) }]); return; }
    const amount = r === 2 ? base * 2 : base;
    this.g.gain(p, amount, 1);
    yield { t: 'pay', from: -1, to: p.id, amount, reason, quiet: true };
    yield* done('gain', [{ p: p.id, text: r === 2 ? `${reason}（${this.luckText(p, true, '獎金加倍')}）` : reason, amount }], { line: 'gain', amount });
  }

  /** Misfortune with days (06 §2.2): luck first (r = 1 escapes, r = 2 doubles), then pardon / frame cards. */
  private *misfortune(p: Player, days: number, apply: (q: Player, days: number) => Flow, fx: string, what: (days: number) => string, done: ResultFn, escapeLine = false): Flow {
    const r = yield* this.g.objects.luck(p, 1, 1);
    if (r === 1) {
      yield* done('blessed', [{ p: p.id, text: this.luckText(p, true, '逃過此劫') }]);
      if (escapeLine) yield { t: 'fx', kind: 'lament', p: p.id, data: { slot: 0, face: 0 } };
      return;
    }
    if (r === 2) days *= 2;
    const target = yield* this.g.cards.pardonOrFrame(p);
    if (target < 0) { yield* done('blessed', [{ p: p.id, text: '免罪卡生效，逃過此劫' }]); return; }
    const q = this.g.players[target];
    yield* apply(q, days);
    if (this.g.over) return;
    const lines: ResultLine[] = [];
    if (target !== p.id) lines.push({ p: p.id, text: `用嫁禍卡嫁禍給${this.g.name(target)}` });
    lines.push({ p: target, text: what(days) + (r === 2 ? '（倒楣加倍）' : '') });
    yield* done(fx, lines, { focus: [target] });
  }

  /** The god's words after the luck check (fcn_0044b896), for the result box. */
  private luckText(p: Player, good: boolean, what: string): string {
    return `${this.g.objects.godName(p) || '神明'}${good ? '保佑' : '作祟'}，${what}`;
  }

  /** Birthday (06 §3.1 entry 5, 04 §4.2): one card from each other living player holding cards. Returns [giver, card]s. */
  private *birthday(p: Player): Flow<[number, number][]> {
    const g = this.g;
    // fortune.asm fcn_0044c3b7: the givers are fixed before the first card moves (their hands only shrink);
    // after the last one the birthday player says event[0 | 1] (`last`).
    const givers = g.players.filter(q => q.id !== p.id && q.whoPlays && q.cards.length);
    const got: [number, number][] = [];
    for (const [k, q] of givers.entries()) {
      let i: number;
      if (g.isHuman(p)) {
        const a = yield ask({
          t: 'choose', p: p.id, title: `向${g.name(q.id)}收一張卡片`, cancellable: false, // fortune.asm ref_004659c9
          options: q.cards.map((id, k) => ({ label: CARD_NAMES[id - 1] ?? (cardName(id) || `卡片${id}`), value: k })),
        });
        i = typeof a === 'number' && a >= 0 && a < q.cards.length ? a : 0;
      } else i = g.rng.below(q.cards.length);
      const [id] = q.cards.splice(i, 1);
      g.cards.receive(p, id);
      yield { t: 'fx', kind: 'card-taken', p: p.id, target: q.id, data: { card: id, last: k === givers.length - 1 } };
      got.push([q.id, id]);
    }
    return got;
  }

  /**
   * rich4_player_sell_all_tools + the card sale of fate 32 (05 §2.4, 04 §4.4): every tool and card at the full table
   * price. Uses the modules' own sale when they offer one; otherwise gets off the vehicle (back to the shop),
   * returns tools 1..8 and the cards to their pools and sums the prices.
   */
  private sellAllForPoints(p: Player): number {
    const g = this.g;
    const tools = g.tools as unknown as Partial<SellAllHook>, cards = g.cards as unknown as Partial<SellAllHook>;
    let sum = 0;
    if (tools.sellAllForPoints) sum += tools.sellAllForPoints(p);
    else {
      if (p.traffic) g.tools.destroyVehicle(p);
      p.tools.forEach((n, i) => {
        if (!n) return;
        sum += n * (TOOL_PRICES[i] ?? 0);
        if (i < 8 && g.tools.shopStock.length > i) g.tools.shopStock[i] += n;
        p.tools[i] = 0;
      });
    }
    if (cards.sellAllForPoints) sum += cards.sellAllForPoints(p);
    else {
      for (const id of p.cards) {
        if (isTycoonCard(id)) continue; // 大富豪模式's own cards stay in the hand (17 §3.7)
        sum += CARD_PRICES[id - 1] ?? cardPrice(id);
        if (g.cards.remaining.length >= id) g.cards.remaining[id - 1] += 1;
      }
      p.cards = p.cards.filter(isTycoonCard);
    }
    return sum;
  }

  // ================================================================ news (06 §4)

  /** News tile, t = 2 (06 §4): draw the next eligible entry and run it. */
  *news(p: Player): Flow {
    // 大富豪模式 hook (docs/rules/18 §2): a tycoon city may draw one of its own news events instead; never in a normal game.
    if (this.g.world && (yield* regionalDraw(this.g, p, 'news'))) return;
    const ev = this.drawNews();
    if (ev < 0) return;
    yield* this.applyNews(p, ev);
  }

  /** Read the news deck until an entry passes its check (fcn_00448be2); skipped entries are consumed. */
  drawNews(): number {
    const d = this.deck();
    for (let i = 0; i < NEWS_COUNT; i++) {
      const ev = d.newsDeck[d.newsNext];
      d.newsNext = (d.newsNext + 1) % NEWS_COUNT;
      if (this.newsCheck(ev)) return ev;
    }
    return -1;
  }

  /** Preconditions (06 §4.2). */
  newsCheck(ev: number): boolean {
    const g = this.g, b = g.board;
    if (g.rules?.finaleDeny?.('news', ev)) return false; // 大富翁城 (docs/rules/19 §3): not there
    switch (ev) {
      case 0: case 1: return g.players.some(q => q.prison !== 0 && g.here(q));
      case 2: case 3: return g.players.some(q => q.hospital !== 0 && g.here(q));
      case 4: case 5: case 15: return this.builtRefs().length > 0;
      case 7: return b.lands.some(l => !l.owner) || b.facilities.some(f => !f.owner);
      case 8: case 9: case 12: return b.lands.some(l => l.owner) || b.facilities.some(f => f.owner);
      case 10: case 13: return g.living().some(q => this.shares(q) > 0);
      case 16: return g.locals().some(q => q.traffic === 0);
      case 17: return g.locals().some(q => q.traffic !== 0);
      case 28: return g.stocks.suspendedSlots().length > 0;
      case 29: return b.companies.some(c => {
        const q = c.controller ? g.players[c.controller - 1] : undefined;
        return !!q && !!q.whoPlays && g.here(q) && !q.hotel && !q.vanish && !q.prison && !q.hospital;
      });
      case 35: return b.companies.some(c => c.fundA > 10000);
      default: return true;
    }
  }

  /**
   * Run one news entry, then its result box. Entries 0-3, 16, 17 and 22-35 act while their text shows; the
   * others after it (06 §4.1).
   */
  *applyNews(p: Player, ev: number): Flow {
    const g = this.g, F = g.priceIndex, b = g.board, rng = g.rng;
    let head = '';
    const show = (text: string, ref?: number, faces?: BoardFace[]): Flow => { head = text.split('\n')[0]; return this.show(p, ev, text, ref, faces); };
    const done = (fx: string, lines: ResultLine[], o: Partial<EventResult> & { node?: number } = {}) =>
      this.result(p, { src: 'news', id: ev, fx, title: NEWS_CATEGORY(ev), head, lines, ...o });
    switch (ev) {
      case 0: case 2: { // released at the next turn start
        const key = ev === 0 ? 'prison' : 'hospital';
        const who = g.players.filter(q => q[key] && g.here(q));
        for (const q of who) q[key] = 0x80;
        // news.asm fcn_00448eca / fcn_00449006: the faces of those let out on the board.
        yield* show(ev === 0 ? '監獄囚犯無罪開釋' : '醫院病患提前出院', undefined, who.map(q => ({ p: q.id })));
        yield* done('release', who.map(q => ({ p: q.id, text: ev === 0 ? '無罪開釋，即將出獄' : '提前出院' })), { focus: who.map(q => q.id) });
        return;
      }
      case 1: case 3: {
        const key = ev === 1 ? 'prison' : 'hospital';
        const who = g.players.filter(q => q[key] && g.here(q));
        for (const q of who) q[key] = (q[key] + 3) & 0x7f;
        yield* show(ev === 1 ? '監獄囚犯延長刑期3天' : '醫院病患延長住院3天', undefined, who.map(q => ({ p: q.id })));
        yield* done('extend', who.map(q => ({ p: q.id, text: `${ev === 1 ? '刑期' : '住院'}延長3天，還要${q[key] & 0x7f}天` })), { focus: who.map(q => q.id) });
        return;
      }
      case 4: { // aliens: everything around a built property is wiped, people there go to hospital
        const refs = this.builtRefs();
        const center = refs[rng.below(refs.length)];
        yield* show('外星人攻打地球', center);
        const hit = yield* this.area(center, function* (ref) { g.damageProperty(ref, 1); }, true);
        if (g.over) return;
        yield* done('alien', [
          { text: `${this.refName(center)}一帶${hit.changed.length}處房地被夷為空地` },
          ...this.byOwner(hit.owners, n => `失去${n}處地產`),
          ...hit.hurt.map(id => ({ p: id, text: '被外星人打傷，住院3天' })),
        ], { node: this.nodeOf(center), refs: hit.changed, focus: hit.hurt });
        return;
      }
      case 5: {
        const refs = this.builtRefs();
        const ref = refs[rng.below(refs.length)];
        const owner = this.refOwner(ref);
        yield* show('外星怪獸摧毀建築一棟', ref);
        g.damageProperty(ref, 1);
        yield { t: 'board' };
        // news.asm fcn_004492a0: the clip, then the owner's event[3 | 4].
        yield* done('monster', [{ p: owner, text: `${this.refName(ref)}被外星怪獸夷平，土地也沒了` }], { node: this.nodeOf(ref), refs: [ref], ...this.cry(owner) });
        return;
      }
      case 6: case 14: { // street land prices × 1.3 / × 0.7 (u16 fields); a facility alone
        const refs = this.allRefs();
        const ref = refs[rng.below(refs.length)];
        yield* show(ev === 6 ? `${this.refName(ref)}地段地價上漲` : `${this.refName(ref)}鬧鬼，地價下跌`, ref);
        const k = ev === 6 ? 1.3 : 0.7;
        const hit: number[] = [];
        const old = this.refPrice(ref);
        if (ref < 4000) {
          const name = b.lands[ref - 2001].name;
          for (const l of b.lands) if (l.name === name) { l.price = Math.trunc(l.price * k) & 0xffff; hit.push(l.id + 2000); }
        } else {
          const f = b.facilities[ref - 4001];
          f.price = Math.trunc(f.price * k) & 0xffff;
          hit.push(ref);
        }
        yield { t: 'board' };
        yield* done(ev === 6 ? 'price-up' : 'haunt', [{ text: `${this.refName(ref)}地價${ev === 6 ? '上漲' : '下跌'}30％（${old * F}→${this.refPrice(ref) * F}元）` }],
          { node: this.nodeOf(ref), refs: hit });
        return;
      }
      case 7: { // public auction of an ownerless property
        const refs = [...b.lands.filter(l => !l.owner).map(l => l.id + 2000), ...b.facilities.filter(f => !f.owner).map(f => f.id + 4000)];
        const ref = refs[rng.below(refs.length)];
        yield* show(`公開拍賣公有土地：${this.refName(ref)}`, ref);
        const before = g.players.map(q => q.cash + q.bank);
        const buyer = yield* g.places.auction(-1, ref);
        if (g.over) return;
        const q = buyer >= 0 ? g.players[buyer] : undefined;
        yield* done('auction', q
          ? [{ p: q.id, text: `標得${this.refName(ref)}`, amount: -(before[q.id] - q.cash - q.bank) }]
          : [{ text: `${this.refName(ref)}無人出價，流標` }], { node: this.nodeOf(ref), refs: [ref], focus: q ? [q.id] : [] });
        return;
      }
      case 8: case 9: { // most / fewest properties among the living, ties to the lower id
        let best: Player | null = null, bestN = 0;
        for (const q of g.living()) {
          const n = this.propertyCount(q);
          if (!best || (ev === 8 ? n > bestN : n < bestN)) { best = q; bestN = n; }
        }
        const amount = (ev === 8 ? 10000 : 5000) * F, why = ev === 8 ? '表揚獎金' : '補助金';
        // news.asm #0157 / #0158: the board names the winner and the sum, with the winner's face.
        yield* show((ev === 8 ? '政府表揚第一大地主' : '政府補助土地最少者') + (best ? `\n${g.name(best.id)}獲得${amount}元` : ''),
          undefined, best ? [{ p: best.id, amount }] : []);
        if (best) yield* this.award(best, amount, why, done, ev === 8 ? 'award' : 'subsidy');
        return;
      }
      case 10: {
        let best: Player | null = null, bestN = 0;
        for (const q of g.living()) {
          const n = this.shares(q);
          if (!best || n > bestN) { best = q; bestN = n; }
        }
        const amount = 10000 * F;
        yield* show('政府表揚股市大戶' + (best ? `\n${g.name(best.id)}獲得${amount}元` : ''), undefined, best ? [{ p: best.id, amount }] : []);
        if (best) yield* this.award(best, amount, '表揚獎金', done, 'award');
        return;
      }
      case 11: // income tax: 5% of cash, not × F
        yield* this.taxEveryone(q => Math.trunc(q.cash * 0.05), '所得稅', '政府開徵所得稅，每人繳交現金的5%', show, done);
        return;
      case 12: // land tax: 5% of the original property values, × F
        yield* this.taxEveryone(q => Math.trunc(this.propertyValue(q) * 0.05) * F, '地價稅', '政府開徵地價稅', show, done);
        return;
      case 13: // securities tax: 5% of the share value, × F
        yield* this.taxEveryone(q => Math.trunc(this.shareValue(q) * 0.05) * F, '證交稅', '政府開徵證券交易稅', show, done);
        return;
      case 15: { // gas explosion: an ordinary built lot one level down (bug #8: no candidates, nothing happens)
        const lots = b.lands.filter(l => l.level !== 0);
        if (!lots.length) { yield* show('瓦斯氣爆，所幸無人傷亡'); yield* done('none', [{ text: '所幸沒有房屋受損' }]); return; }
        const l = lots[rng.below(lots.length)];
        yield* show(`${l.name}瓦斯氣爆，房屋受損`, l.id + 2000);
        g.damageProperty(l.id + 2000, 0);
        yield { t: 'board' };
        yield* done('explosion', [{ p: l.owner ? l.owner - 1 : undefined, text: `${l.name}瓦斯氣爆，${this.levelText(l.id + 2000)}` }],
          { node: this.nodeOf(l.id + 2000), refs: [l.id + 2000], ...this.cry(l.owner ? l.owner - 1 : undefined) });
        return;
      }
      case 16: case 17: { // heavy rain / traffic jam: stay for one turn (overwrites)
        const who = g.locals().filter(q => (q.traffic === 0) === (ev === 16));
        for (const q of who) q.stay = 1;
        // news.asm fcn_0044a5d6 / fcn_0044a657: the faces of those held up on the board.
        yield* show(ev === 16 ? '豪雨成災，行人停留一回合' : '交通阻塞，車輛停留一回合', undefined, who.map(q => ({ p: q.id })));
        yield* done(ev === 16 ? 'rain' : 'jam', who.map(q => ({ p: q.id, text: ev === 16 ? '冒雨難行，停留一回合' : '塞在車陣中，停留一回合' })), { focus: who.map(q => q.id) });
        return;
      }
      case 18: { // earthquake: a whole street (or one facility) one level down
        const refs = this.allRefs();
        const ref = refs[rng.below(refs.length)];
        yield* show(`${this.refName(ref)}發生強烈地震`, ref);
        const street = ref < 4000 ? b.lands.filter(l => l.name === b.lands[ref - 2001].name).map(l => l.id + 2000) : [ref];
        const built = street.filter(r => this.refLevel(r) > 0);
        for (const r of street) g.damageProperty(r, 0);
        yield { t: 'board' };
        yield* done('quake', [{ text: built.length ? `${this.refName(ref)}強烈地震，${built.length}棟房屋各降一級` : `${this.refName(ref)}強烈地震，所幸沒有房屋` }],
          { node: this.nodeOf(ref), refs: street });
        return;
      }
      case 19: case 21: {
        const refs = this.allRefs();
        const ref = refs[rng.below(refs.length)];
        const owner = this.refOwner(ref), wasBuilt = this.refLevel(ref) > 0;
        yield* show(ev === 19 ? `${this.refName(ref)}山洪暴發，土地流失` : `龍捲風襲擊${this.refName(ref)}`, ref);
        g.damageProperty(ref, ev === 19 ? 1 : 0);
        yield { t: 'board' };
        const lines: ResultLine[] = ev === 19
          ? [{ p: owner, text: owner !== undefined ? `${this.refName(ref)}土地流失，地產沒了` : `${this.refName(ref)}土地流失` }]
          : [{ p: owner, text: `龍捲風襲擊${this.refName(ref)}，${wasBuilt ? this.levelText(ref) : '所幸沒有房屋'}` }];
        // news.asm fcn_0044a91e / fcn_0044ac99: the owner's event[3 | 4] after the flash / the clip.
        yield* done(ev === 19 ? 'flood' : 'tornado', lines, { node: this.nodeOf(ref), refs: [ref], ...this.cry(owner) });
        return;
      }
      case 20: { // typhoon: everything around a property one level down, nobody hurt
        const refs = this.allRefs();
        const center = refs[rng.below(refs.length)];
        yield* show('超級颱風過境', center);
        const hit = yield* this.area(center, function* (ref) { g.damageProperty(ref, 0); }, false);
        yield* done('typhoon', [{ text: hit.changed.length ? `${this.refName(center)}一帶${hit.changed.length}棟房屋各降一級` : `${this.refName(center)}一帶所幸沒有房屋受損` },
          ...this.byOwner(hit.owners, n => `${n}棟房屋受損`)],
          { node: this.nodeOf(center), refs: hit.changed });
        return;
      }
      case 22: {
        const who = g.living();
        for (const q of who) q.noLoan = 15;
        yield* show('銀行停止放款15天');
        yield* done('bank-stop', [{ text: '15天內所有人都不能貸款' }], { focus: who.map(q => q.id) });
        return;
      }
      case 23: { // 10% bonus on deposits for the living without a loan, not × F
        const got: BoardFace[] = [];
        for (const q of g.living()) if (q.loan === 0) { const x = Math.trunc(q.bank * 0.1); q.bank += x; got.push({ p: q.id, amount: x }); }
        // news.asm fcn_0044aedb: 「%s得到%d元」 with each face on the board.
        yield* show('銀行發放儲金紅利10%', undefined, got);
        yield* done('bonus', got.length ? got.map(x => ({ p: x.p, text: '得到儲金紅利', amount: x.amount })) : [{ text: '有貸款的人拿不到紅利' }],
          { focus: got.map(x => x.p) });
        return;
      }
      case 24: case 25:
        g.stocks.forceLimit(-1, ev === 25, 1);
        yield* show(ev === 24 ? '股市崩盤，全面跌停' : '股市全面上漲');
        yield* done(ev === 24 ? 'stock-down' : 'stock-up', [{ text: ev === 24 ? '所有股票下跌一成' : '所有股票上漲一成' }]);
        return;
      case 26:
        g.stocks.closeMarket(10);
        yield* show('股市暫停交易10天');
        yield* done('stock-halt', [{ text: '股市休市10天，不能買賣股票' }]);
        return;
      case 27: { // bug #6: suspended 10 days as the text says (the original wrote 15)
        const slot = rng.below(12);
        g.stocks.suspend(slot, 10);
        yield* show(`${this.stockName(slot)}股票暫停交易10天`);
        yield* done('stock-halt', [{ text: `${this.stockName(slot)}停止交易10天` }]);
        return;
      }
      case 28: {
        const slots = g.stocks.suspendedSlots();
        const slot = slots[rng.below(slots.length)];
        g.stocks.resume(slot);
        yield* show(`${this.stockName(slot)}股票恢復交易`);
        yield* done('stock-resume', [{ text: `${this.stockName(slot)}恢復交易` }]);
        return;
      }
      case 29: { // a controller (active or not) goes to prison 5 days; pardon / frame cards apply
        const cs = b.companies.filter(c => c.controller && g.here(g.players[c.controller - 1]));
        const c = cs[rng.below(cs.length)];
        const q = g.players[c.controller - 1];
        yield* show(`${c.name}違法超貸，董事長${g.name(q.id)}入獄5天`, undefined, [{ p: q.id }]);
        const target = yield* g.cards.pardonOrFrame(q);
        if (target >= 0) yield* g.sendTo(g.players[target], 'prison', 5);
        if (g.over) return;
        const lines: ResultLine[] = target < 0 ? [{ p: q.id, text: '免罪卡生效，逃過牢獄之災' }]
          : target !== q.id ? [{ p: q.id, text: `用嫁禍卡嫁禍給${g.name(target)}` }, { p: target, text: '代替入獄，坐牢5天' }]
          : [{ p: q.id, text: `${c.name}董事長，坐牢5天` }];
        yield* done(target < 0 ? 'blessed' : 'prison', lines, { focus: [target < 0 ? q.id : target] });
        return;
      }
      case 30: case 31: case 32: case 33: case 34: { // company surplus changes, not × F; the stock is forced
        const [delta, forced, text] = ({
          30: [-10000, 3, '工廠排放廢水被罰'], 31: [20000, 0x30, '海外投資獲利'], 32: [-20000, 4, '海外投資虧損'],
          33: [-10000, 3, '違規開發山坡地被罰'], 34: [-5000, 3, '製造噪音被罰'],
        } as Record<number, [number, number, string]>)[ev];
        if (!b.companies.length) return;
        const c = b.companies[rng.below(b.companies.length)];
        g.stocks.adjustProfit(c, delta);
        if (c.stockSlot < 12) this.setForced(c.stockSlot, forced);
        yield* show(`${c.name}${text}`);
        yield* done(delta > 0 ? 'company-up' : 'company-down',
          [{ text: `${c.name}盈餘${delta > 0 ? '增加' : '減少'}${Math.abs(delta)}元${c.stockSlot < 12 ? `，股價${delta > 0 ? '上漲' : '下跌'}` : ''}` }]);
        return;
      }
      case 35: { // profit doubled; bug #7: the cumulative surplus gains only the added amount
        const cs = b.companies.filter(c => c.fundA > 10000);
        const c = cs[rng.below(cs.length)];
        const m = c.fundA;
        c.fundA = 2 * m;
        c.fundB += m;
        if (c.stockSlot < 12) this.setForced(c.stockSlot, (Math.trunc(m / 10000) << 4) & 0xff);
        yield* show(`${c.name}獲利調高一倍`);
        yield* done('company-up', [{ text: `${c.name}獲利倍增，盈餘增加${m}元${c.stockSlot < 12 ? '，股價上漲' : ''}` }]);
        return;
      }
    }
  }

  private *show(p: Player, ev: number, text: string, ref?: number, faces?: BoardFace[]): Flow {
    const node = ref ? this.nodeOf(ref) : undefined;
    yield { t: 'fx', kind: 'news', p: p.id, node, data: { id: ev, category: NEWS_CATEGORY(ev), text, ...(faces?.length ? { faces } : {}) } };
  }

  /** The result box after a news or fate entry (nothing once the game is over). */
  private *result(p: Player, r: EventResult & { node?: number }): Flow {
    if (this.g.over) return;
    const { node, ...data } = r;
    yield { t: 'fx', kind: 'event-result', p: p.id, ...(node ? { node } : {}), data: data as unknown as Record<string, unknown> };
  }

  /** news.asm fcn_004498b3 phase 1: the camera on the winner, the money, then the winner's line fcn_0044f354. */
  private *award(q: Player, amount: number, reason: string, done: ResultFn, fx: string): Flow {
    this.g.gain(q, amount, 1);
    yield { t: 'pay', from: -1, to: q.id, amount, reason, quiet: true };
    yield* done(fx, [{ p: q.id, text: `獲得${reason}`, amount }], { focus: [q.id], line: 'gain', amount });
  }

  /**
   * Taxes (news.asm fcn_00449c7c …): every living player's amount is worked out while the board shows them
   * (「%s繳交%d元」 with the faces), then paid to the system without a word.
   */
  private *taxEveryone(amount: (q: Player) => number, reason: string, text: string, show: (text: string, ref?: number, faces?: BoardFace[]) => Flow, done: ResultFn): Flow {
    const due = this.g.living().map(q => [q, amount(q)] as const);
    const payers = due.filter(([, x]) => x > 0);
    yield* show(text, undefined, payers.map(([q, x]) => ({ p: q.id, amount: -x })));
    for (const [q, x] of due) {
      if (x > 0) yield* this.g.transfer(q.id, -1, x, 0, reason, true);
      if (this.g.over) return;
    }
    yield* done('tax', payers.length ? payers.map(([q, x]) => ({ p: q.id, text: `繳交${reason}`, amount: -x })) : [{ text: `沒有人需要繳${reason}` }],
      { focus: payers.map(([q]) => q.id) });
  }

  /**
   * About 200 × 200 px around a property (news 4 and 20): every land and facility there, and for news 4 also the
   * players on the road there (vehicle wrecked, hospital 3 days) and the map objects. Returns the properties
   * that changed and who was hurt.
   */
  private *area(center: number, hit: (ref: number) => Flow, people: boolean): Flow<{ changed: number[]; owners: number[]; hurt: number[] }> {
    const g = this.g, b = g.board;
    const c = center < 4000 ? b.lands[center - 2001] : b.facilities[center - 4001];
    const near = (x: number, y: number) => Math.abs(x - c.x) <= 100 && Math.abs(y - c.y) <= 100;
    const changed: number[] = [], owners: number[] = [], hurt: number[] = [];
    const look = (ref: number) => `${this.refOwner(ref)}:${this.refLevel(ref)}`;
    const owner = (ref: number) => this.refOwner(ref) ?? -1;
    const one = function* (ref: number): Flow {
      const was = look(ref), by = owner(ref);
      yield* hit(ref);
      if (look(ref) !== was) { changed.push(ref); owners.push(by); }
    };
    for (const l of b.lands) if (near(l.x, l.y)) yield* one(l.id + 2000);
    for (const f of b.facilities) if (near(f.x, f.y)) yield* one(f.id + 4000);
    yield { t: 'board' };
    if (!people) return { changed, owners, hurt };
    for (const q of g.players) {
      if (!q.whoPlays || !q.placed || g.offRoad(q)) continue;
      const n = g.node(q.node);
      if (!near(n.x, n.y)) continue;
      g.tools.destroyVehicle(q);
      yield* g.sendTo(q, 'hospital', 3);
      hurt.push(q.id);
      if (g.over) return { changed, owners, hurt };
    }
    for (const n of b.nodes) if (near(n.x, n.y) && g.objects.at(n.id)) g.objects.removeAt(n.id);
    yield { t: 'board' };
    return { changed, owners, hurt };
  }

  // ================================================================ helpers

  /** Lands then facilities, as refs 2001.. / 4001.. (candidate order guessed). */
  private allRefs(): number[] {
    return [...this.g.board.lands.map(l => l.id + 2000), ...this.g.board.facilities.map(f => f.id + 4000)];
  }

  private builtRefs(): number[] {
    const b = this.g.board;
    return [...b.lands.filter(l => l.level !== 0).map(l => l.id + 2000), ...b.facilities.filter(f => f.level !== 0).map(f => f.id + 4000)];
  }

  /** One line per owner (player ids in order) with how many of their properties were hit. */
  private byOwner(owners: number[], text: (n: number) => string): ResultLine[] {
    return this.g.players.map((_, i) => i).map(p => [p, owners.filter(o => o === p).length] as const).filter(([, n]) => n > 0).map(([p, n]) => ({ p, text: text(n) }));
  }

  /** The lot owner's cry event[3 | 4] after the result (none for an ownerless lot). */
  private cry(owner: number | undefined): Partial<EventResult> { return owner !== undefined ? { line: 'cry' } : {}; }

  private nodeOf(ref: number): number | undefined { return this.g.board.nodes.find(n => n.ref === ref)?.id; }
  private refOwner(ref: number): number | undefined {
    const o = ref < 4000 ? this.g.board.lands[ref - 2001].owner : this.g.board.facilities[ref - 4001].owner;
    return o ? o - 1 : undefined;
  }
  private refLevel(ref: number): number { return ref < 4000 ? this.g.board.lands[ref - 2001].level : this.g.board.facilities[ref - 4001].level; }
  private refPrice(ref: number): number { return ref < 4000 ? this.g.board.lands[ref - 2001].price : this.g.board.facilities[ref - 4001].price; }
  /** The building's state after damage, for the result box. */
  private levelText(ref: number): string { const n = this.refLevel(ref); return n ? `房屋降為${n}級` : '房屋全毀'; }

  private refName(ref: number): string {
    return ref < 4000 ? this.g.board.lands[ref - 2001].name : this.g.board.facilities[ref - 4001].name;
  }

  private propertyCount(q: Player): number {
    const me = q.id + 1;
    let n = 0;
    for (const b of this.g.boards()) n += b.lands.filter(l => l.owner === me).length + b.facilities.filter(f => f.owner === me).length;
    return n;
  }

  /** Shares held (03), over the nationwide market in 大富豪模式 (17 §5). */
  private shares(q: Player): number { return this.g.markets().reduce((n, m) => n + m.shareCount(q), 0); }
  private shareValue(q: Player): number { return this.g.markets().reduce((n, m) => n + m.shareValue(q), 0); }

  /** Σ(land price + level × build cost) at the original (not price-indexed) values. */
  private propertyValue(q: Player): number {
    const me = q.id + 1;
    let sum = 0;
    for (const b of this.g.boards()) {
      for (const l of b.lands) if (l.owner === me) sum += l.price + l.level * l.perLevel;
      for (const f of b.facilities) if (f.owner === me) sum += f.price + f.level * f.fees[0];
    }
    return sum;
  }

  /** Write a stock's +7 forced byte as the news does and apply it at once (03 §4.6); a byte overflow is kept. */
  private setForced(slot: number, forced: number) {
    const s = this.g.stocks.stocks[slot];
    if (!s) return;
    s.forced = forced & 0xff;
    this.g.stocks.applyForced(slot);
  }

  private stockName(slot: number): string {
    return this.g.stocks.stocks[slot]?.name ?? `第${slot + 1}支`;
  }
}
