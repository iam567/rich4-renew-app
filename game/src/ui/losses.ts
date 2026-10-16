/**
 * Loss notices (the remake's, docs/rules/15 §4.1): when a human player loses cards or tools in any way — 小衰神 /
 * 大衰神, 死神, 搶奪卡, the robber, fate and news, the magic house, a birthday, a full hand — a box lists exactly
 * what went (icon, name, ×count), in the same box as the news and fate results. A computer's losses get a line in
 * the log (and in 大富豪模式's chat box).
 *
 * Presentation only: it compares the players' hands between the steps the flow yields and never touches the
 * game. What a player gives up themselves (a card or tool used, a sale at the shop, getting on or off a vehicle,
 * the time machine) is not a loss: a human's own turn menu, their shop visits and every `card` / `使用…` they
 * announce are left out; a computer's change is reported only when an event that takes things from it was seen.
 */
import type { Game } from '../core/game';
import type { Player, Step } from '../core/types';
import { cardName } from '../core/modules/cards';
import { toolDef, toolIcon } from '../core/modules/tools';
import { MAGIC_NAMES } from '../core/modules/places';
import { OBJECT_NAMES } from '../core/modules/objects';
import type { TickerLine } from '../core/world';
import { resultBox } from './screens/event-result';
import type { ScreenContext } from './screens/registry';
import './losses.css';

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** A hand: cards by id, tools by id (a ridden scooter or car counts as held, so getting on or off changes nothing). */
interface Hand { cards: Map<number, number>; tools: Map<number, number> }
/** What one player lost between two steps. */
export interface Loss { p: number; cards: [number, number][]; tools: [number, number][]; cause: string }

/** How many steps back an event still explains a change (the rules move things a few steps after announcing). */
const CAUSE_REACH = 8;

function handOf(p: Player): Hand {
  const cards = new Map<number, number>(), tools = new Map<number, number>();
  for (const id of p.cards) cards.set(id, (cards.get(id) ?? 0) + 1);
  p.tools.forEach((n, i) => { if (n > 0) tools.set(i + 1, n); });
  const v = p.traffic & 3;
  if (v === 1 || v === 2) tools.set(v + 4, (tools.get(v + 4) ?? 0) + 1); // 機車 5 / 汽車 6
  return { cards, tools };
}

export class LossNotices {
  private hands = new Map<number, Hand>();
  private n = 0;
  /** Recent events that take things away: [step, victims, label]. */
  private causes: { at: number; who: Set<number> | 'all'; label: string }[] = [];
  /** Uses a player announced and that have not shown in the hand yet ('c' + card id / 't' + tool id). */
  private credit = new Map<number, Map<string, number>>();
  /** Humans in their own turn menu (from the turn question to the dice): what changes is their own doing. */
  private menu = new Set<number>();
  /** Players whose change at this step is their own (a sale at the shop); `ownNext`: at the next step (a question
   * they answer now, the time machine about to restore). */
  private own = new Set<number>();
  private ownNext = new Set<number>();
  private menuNext = new Set<number>();
  /** Losses found at the last step, shown once that step has been presented. */
  private due: Loss[] = [];

  constructor(private game: Game, private ctx: () => ScreenContext, private o: {
    idle?: () => Promise<void>;
    /** 大富豪模式: a line for the chat box. */
    chat?: (l: TickerLine) => void;
    mapIndex?: () => number;
    note?: (text: string, color?: number) => void;
    /** Tests: receives each loss instead of the box / the line. */
    show?: (l: Loss) => void;
  } = {}) {
    this.resync();
  }

  private resync(only?: number) {
    for (const p of this.game.players) if (only === undefined || p.id === only) this.hands.set(p.id, handOf(p));
  }

  private name(p: number) { return this.game.name(p); }

  private give(p: number | undefined, key: string) {
    if (p === undefined) return;
    const m = this.credit.get(p) ?? new Map<string, number>();
    m.set(key, (m.get(key) ?? 0) + 1);
    this.credit.set(p, m);
  }

  private cause(who: number[] | 'all', label: string) {
    this.causes.push({ at: this.n, who: who === 'all' ? 'all' : new Set(who), label });
    while (this.causes.length > 16) this.causes.shift();
  }

  /** What the step says about who gives up or loses what (before the hands are compared). */
  private read(s: Step) {
    if ('ask' in s) {
      if (s.t === 'turn') this.menuNext.add(s.p);
      if (s.t === 'shop' || s.t === 'black-market' || s.t === 'stock-market') this.ownNext.add(s.p);
      return;
    }
    switch (s.t) {
      case 'dice': case 'step': this.menu.delete(s.p); break;
      // A new turn: what was announced and never spent (a card that failed) no longer explains anything.
      case 'turn': this.menu.clear(); this.credit.clear(); break;
      case 'say': {
        // A computer's 「使用…」: the card or tool it is about to spend.
        const m = s.p !== undefined && /^使用(.+)$/.exec(s.text);
        if (m && s.p !== undefined) {
          const name = m[1];
          for (let id = 1; id <= 16; id++) if (toolDef(id)?.name === name) this.give(s.p, `t${id}`);
          for (let id = 1; id <= 40; id++) if (cardName(id) === name) this.give(s.p, `c${id}`);
        }
        break;
      }
      case 'fx': {
        const d = (s.data ?? {}) as Record<string, unknown>;
        switch (s.kind) {
          case 'card': if (s.p !== undefined && Number(d.card)) this.give(s.p, `c${Number(d.card)}`); break;
          case 'construction': this.give(s.p, 't12'); break;
          case 'shop': case 'black-market-buy': case 'black-market': case 'lab-order': if (s.p !== undefined) this.own.add(s.p); break;
          case 'time-machine': if (s.p !== undefined) { this.own.add(s.p); this.ownNext.add(s.p); } break;
          case 'god-attach': if (s.p !== undefined) this.cause([s.p], `${OBJECT_NAMES[Number(d.type) - 1] ?? '神明'}附身`); break;
          case 'npc-rob-card': if (s.p !== undefined) this.cause([s.p], '被強盜搶走'); break;
          case 'card-taken': if (s.target !== undefined && s.p !== undefined) this.cause([s.target], `${this.name(s.p)}生日，送出卡片`); break;
          case 'card-result':
            if (Number(d.card) === 13 && s.target !== undefined && s.p !== undefined) this.cause([s.target], `被${this.name(s.p)}的搶奪卡搶走`);
            else if (s.target !== undefined) this.cause([s.target], '卡片');
            break;
          case 'magic': {
            const t = (d.targets as number[] | undefined) ?? [];
            this.cause(t, `魔法屋「${MAGIC_NAMES[Number(d.magic)] ?? ''}」`);
            break;
          }
          case 'fate': if (s.p !== undefined) this.cause([s.p], '命運'); break;
          case 'news': this.cause('all', '新聞'); break;
          case 'vehicle-lost': if (s.p !== undefined) this.cause([s.p], '命運'); break;
          case 'finale-start': case 'finale': this.resync(); this.due = []; return;
        }
        break;
      }
      case 'world-view': case 'world-sync': this.resync(); break;
    }
  }

  /** Compares the hands with the last step's; returns the losses (own uses taken out). */
  private compare(): Loss[] {
    const g = this.game, out: Loss[] = [];
    for (const p of g.players) {
      const before = this.hands.get(p.id), now = handOf(p);
      this.hands.set(p.id, now);
      if (!before || p.bankrupt || !p.whoPlays || g.over) continue;
      if (this.own.has(p.id) || (p.human && this.menu.has(p.id))) continue;
      const credit = this.credit.get(p.id);
      const drop = (a: Map<number, number>, b: Map<number, number>, k: 'c' | 't') => {
        const lost: [number, number][] = [];
        for (const [id, n] of a) {
          let d = n - (b.get(id) ?? 0);
          const c = credit?.get(`${k}${id}`) ?? 0;
          const used = Math.min(c, Math.max(0, d));
          if (used) { d -= used; credit!.set(`${k}${id}`, c - used); }
          if (d > 0) lost.push([id, d]);
        }
        return lost;
      };
      const cards = drop(before.cards, now.cards, 'c'), tools = drop(before.tools, now.tools, 't');
      if (!cards.length && !tools.length) continue;
      const c = [...this.causes].reverse().find(x => this.n - x.at <= CAUSE_REACH && (x.who === 'all' || x.who.has(p.id)));
      // A full hand: a new card pushed the cheapest out (04 §4.1).
      const full = !c && cards.length === 1 && !tools.length && p.cards.length >= 15 && [...now.cards].some(([id, k]) => k > (before.cards.get(id) ?? 0));
      // A computer's change (or a human's on autopilot, played by the computer) counts only with an event that takes
      // things: its own sales at the shop and some of its uses are silent.
      if (!g.isHuman(p) && !c && !full) continue;
      if (!g.here(p)) continue;
      out.push({ p: p.id, cards, tools, cause: c?.label ?? (full ? '卡片已滿，捨棄最便宜的一張' : '') });
    }
    this.own = this.ownNext;
    this.ownNext = new Set();
    for (const id of this.menuNext) this.menu.add(id);
    this.menuNext.clear();
    return out;
  }

  /**
   * Called with every step the flow yields, before it is shown: the losses of the step before (now that it has
   * been shown) appear first; those found now appear before a question or a new turn, else after this step.
   */
  async before(s: Step): Promise<void> {
    this.n++;
    const shown = this.due;
    this.due = [];
    this.read(s);
    const found = this.compare();
    // A walk or a new turn ends whatever was happening: later changes (a computer's silent shop) are not its doing.
    if (!('ask' in s) && (s.t === 'step' || s.t === 'turn')) this.causes = [];
    const now = 'ask' in s || s.t === 'turn' || s.t === 'gameover' || s.t === 'world-view';
    const show = now ? [...shown, ...found] : shown;
    if (!now) this.due = found;
    if (!show.length) return;
    await this.o.idle?.();
    for (const l of show) await this.tell(l);
  }

  private async tell(l: Loss) {
    if (this.o.show) { this.o.show(l); return; }
    const g = this.game, p = g.players[l.p];
    if (!p) return;
    const items = [
      ...l.cards.map(([id, n]) => ({ name: cardName(id) || `卡片${id}`, n, icon: { archive: 'Data' as const, id: 570 + id, frame: 0 }, card: true })),
      ...l.tools.map(([id, n]) => ({ name: toolDef(id)?.name ?? `道具${id}`, n, icon: toolIcon(id), card: false })),
    ];
    const list = items.map(i => `${i.name}${i.n > 1 ? `×${i.n}` : ''}`).join('、');
    const text = `${this.name(l.p)}${l.cause ? `（${l.cause}）` : ''}失去${list}`;
    this.o.note?.(text);
    if (!p.human) {
      if (this.o.chat) this.o.chat({ day: g.daysElapsed, map: this.o.mapIndex?.() ?? 0, text, p: l.p, kind: 'loss' });
      return;
    }
    const ctx = this.ctx();
    const chips = items.map(i => {
      const a = ctx.bank.art(i.icon.archive, i.icon.id, i.icon.frame);
      return `<span class="ls-item${i.card ? ' card' : ''}"><span class="ls-pic">${a ? `<img src="${a.src}" alt="">` : ''}</span><span class="ls-name">${esc(i.name)}</span>${i.n > 1 ? `<b class="ls-n">×${i.n}</b>` : ''}</span>`;
    }).join('');
    const what = l.cards.length && l.tools.length ? '卡片和道具' : l.cards.length ? '卡片' : '道具';
    await resultBox(ctx, {
      fx: 'card-bad', title: '損失', tag: `失去${what}`,
      head: `${this.name(l.p)}失去了${items.reduce((s, i) => s + i.n, 0)}${l.cards.length && !l.tools.length ? '張' : '樣'}${what}`,
      hero: `<div class="ls-items">${chips}</div>`,
      lines: [{ p: l.p, text: l.cause || '失去以下物品' }],
    });
  }
}
