/**
 * 黑市 — the remake's replacement for the original trade board (docs/rules/10-black-market.md).
 *
 * Once a month the market stocks one random tool and one random card at very high cash prices, and a lot that
 * has had no owner for three months in a row at 50× its land price. At most 6 listings stay up, oldest out
 * first. Everyone (computers included, same conditions) can buy in their own turn, cash only.
 *
 * The market draws from its own random stream (seeded from the game seed and the day), so the original
 * rules and their rand() sequence are untouched.
 */
import { addMonths } from '../date';
import { ask, type Flow } from '../flow';
import type { Game } from '../game';
import { Rng, daySeed } from '../rng';
import { LAND_LIMIT_MONTHS, type Player } from '../types';
import { CARDS, TYCOON_CARDS, cardName } from './cards';
import { MAX_HELD, TOOLS } from './tools';

export const MAX_LISTINGS = 6;
/** Months a lot must stay unowned before it is offered here. */
export const UNSOLD_MONTHS = 3;
/** 大富豪模式 (docs/rules/17 §5.2): six months, and of its own items only 飛行卡 / 電車卡 can turn up. */
export const TYCOON_UNSOLD_MONTHS = 6;
const TYCOON_DECK = [...CARDS, ...TYCOON_CARDS.filter(c => c.id === 31 || c.id === 32)];
export const LAND_MULTIPLE = 50;
/** Cash price of each tool before the price index (tool id - 1). */
export const TOOL_PRICES = [8000, 6000, 8000, 12000, 20000, 40000, 100000, 10000, 30000, 80000, 60000, 50000, 300000];
/** Cards cost their point price × 1000. */
export const CARD_PRICE_FACTOR = 1000;

export interface Listing {
  kind: 'tool' | 'card' | 'land';
  /** Tool id, card id, or land id (1-based). */
  id: number;
  /** Price before the price index. */
  base: number;
  /** Packed date it went up. */
  since: number;
}

export class BlackMarket {
  listings: Listing[] = [];
  /** Consecutive months each lot (index = land id - 1) has stayed unowned. */
  unsold: number[] = [];

  constructor(readonly g: Game) {}

  init(): void {
    this.unsold = this.g.board.lands.map(() => 0);
  }

  private rng(salt: number): Rng {
    return new Rng(daySeed((this.g.rollSeed() ^ 0x6b1ac4 ^ salt) >>> 0, this.g.daysElapsed));
  }

  price(l: Listing): number {
    return l.base * this.g.priceIndex;
  }

  name(l: Listing): string {
    if (l.kind === 'tool') return TOOLS[l.id - 1]?.name ?? '';
    if (l.kind === 'card') return cardName(l.id);
    return this.g.board.lands[l.id - 1]?.name ?? '';
  }

  /** Why a player cannot buy a listing now, or '' when they can. */
  blocked(p: Player, l: Listing): string {
    if (p.cash < this.price(l)) return '現金不足';
    if (l.kind === 'tool' && p.tools[l.id - 1] >= MAX_HELD) return '道具欄已滿';
    // Tools 1-8 exist 10 times in the whole game (05 §2.1): a black-market one comes out of that supply.
    // 大富豪模式 has no tool stock (17 §3.10).
    if (l.kind === 'tool' && l.id <= 8 && !this.g.world && this.g.tools.shopStock[l.id - 1] <= 0) return '缺貨';
    if (l.kind === 'card' && !this.g.cards.room(p, l.id)) return '卡片欄已滿';
    if (l.kind === 'land' && this.g.board.lands[l.id - 1]?.owner) return '已有地主';
    return '';
  }

  /** Month start (after the original's monthly work): count unowned lots, drop sold ones, restock. */
  *monthly(): Flow {
    const g = this.g, b = g.board;
    if (this.unsold.length !== b.lands.length) this.unsold = b.lands.map((_, i) => this.unsold[i] ?? 0);
    b.lands.forEach((l, i) => { this.unsold[i] = l.owner ? 0 : this.unsold[i] + 1; });
    this.listings = this.listings.filter(l => l.kind !== 'land' || !b.lands[l.id - 1]?.owner);
    const rng = this.rng(1), added: Listing[] = [];
    const deck = g.world ? TYCOON_DECK : CARDS, months = g.world ? TYCOON_UNSOLD_MONTHS : UNSOLD_MONTHS;
    const tool = TOOLS[rng.below(TOOLS.length)], card = deck[rng.below(deck.length)];
    added.push({ kind: 'tool', id: tool.id, base: TOOL_PRICES[tool.id - 1], since: g.date });
    added.push({ kind: 'card', id: card.id, base: card.price * CARD_PRICE_FACTOR, since: g.date });
    // The longest-unsold lot not already on offer (ties drawn at random).
    const listed = new Set(this.listings.filter(l => l.kind === 'land').map(l => l.id));
    const candidates = b.lands.filter((l, i) => !l.owner && this.unsold[i] >= months && !listed.has(l.id));
    if (candidates.length) {
      const top = Math.max(...candidates.map(l => this.unsold[l.id - 1]));
      const longest = candidates.filter(l => this.unsold[l.id - 1] === top);
      const lot = longest[rng.below(longest.length)];
      added.push({ kind: 'land', id: lot.id, base: lot.price * LAND_MULTIPLE, since: g.date });
    }
    this.listings.push(...added);
    while (this.listings.length > MAX_LISTINGS) this.listings.shift();
    yield { t: 'fx', kind: 'black-market', data: { text: `黑市進了新貨：${added.map(l => this.name(l)).join('、')}`, added: added.length } };
  }

  /** Buys listing `index` for player `p` (cash only). Returns false when it cannot be bought. */
  *buy(p: Player, index: number): Flow<boolean> {
    const g = this.g, l = this.listings[index];
    if (!l) return false;
    const why = this.blocked(p, l);
    if (why) { if (g.isHuman(p)) yield* g.say(p.id, `${why}！`); return false; }
    const price = this.price(l);
    p.cash -= price;
    this.listings.splice(index, 1);
    if (l.kind === 'tool') {
      if (l.id <= 8 && (!g.world || this.g.tools.shopStock[l.id - 1] > 0)) this.g.tools.shopStock[l.id - 1] -= 1;
      p.tools[l.id - 1] += 1;
    }
    else if (l.kind === 'card') p.cards.push(l.id);
    else {
      const lot = g.board.lands[l.id - 1];
      lot.owner = p.id + 1;
      const months = LAND_LIMIT_MONTHS[g.settings.landLimitIndex];
      if (months) lot.expire = addMonths(g.date, months);
      this.unsold[l.id - 1] = 0;
      yield { t: 'board' };
    }
    yield { t: 'pay', from: p.id, to: -2, amount: price, reason: `黑市購買${this.name(l)}` };
    yield { t: 'fx', kind: 'black-market-buy', p: p.id, data: { text: `${g.name(p.id)}在黑市買下${this.name(l)}！`, kind: l.kind, id: l.id, price } };
    return true;
  }

  /** The human's market screen from the turn menu; each purchase is checked here. */
  *humanMarket(p: Player): Flow {
    for (;;) {
      if (this.g.over || !p.whoPlays) return;
      const a = (yield ask({ t: 'black-market', p: p.id })) as { buy: number } | number | undefined;
      if (!a || typeof a !== 'object' || !Number.isInteger(a.buy)) return;
      yield* this.buy(p, a.buy);
    }
  }

  /**
   * A computer's turn, under the same conditions as a human: it buys at most one listing, the first it can
   * afford while keeping its reserve (30 % of the starting fund × price index, as for share purchases,
   * 02 §12.3), lots first, then the dearest item.
   */
  *aiTurn(p: Player): Flow {
    const g = this.g;
    if (!this.listings.length) return;
    const reserve = Math.trunc(g.fund * 0.3) * g.priceIndex;
    const order = this.listings.map((l, i) => ({ l, i }))
      .sort((a, b) => (a.l.kind === 'land' ? 0 : 1) - (b.l.kind === 'land' ? 0 : 1) || this.price(b.l) - this.price(a.l));
    for (const { l, i } of order) {
      if (this.blocked(p, l) || p.cash - this.price(l) < reserve) continue;
      yield* this.buy(p, i);
      return;
    }
  }
}
