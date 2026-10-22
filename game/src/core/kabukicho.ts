/**
 * 歌舞伎町's rules (docs/rules/21, the remake's addition; 自製地圖 #7, map 106, classic mode only), registered in
 * MAP_RULES like 大富翁城's (core/casino-rules.ts). Every other map has none of this.
 *
 *  - The large plots are five shops the owner chooses (§2): 居酒屋 10, 陪酒店 11 (夜總會 / 牛郎店 by the visitor's sex),
 *    泡泡浴 12 (women pay nothing), 情人酒店 13 (a hotel: the original 旅館's stay, no incidents) and the original 研究所 4.
 *    A visit to the first three first draws an incident from the shop's table (kb-data.ts); without one the shopping
 *    wheel (×1–6).
 *    Owners are never jailed: an incident may pause them in place (「處理事務中」, 1–2 turns, `turnHold`).
 *  - 黑幫 (§4.1): met on the road like a god, 7 days; a rival's property the possessed player stops on pays HIM
 *    (保護費, from the owner's cash; nothing in cash: the property loses a level); passing or stopping on the prison
 *    square (or being put there) → 違反暴力團對策法: the takings are confiscated, 7 days in prison. Back 7 days later.
 *  - 拉客仔 (§4.2): stopping on its square drags the player into a random rival shop.
 *  - Its own 24 news and 24 fate (§6); the 柏青哥店 (19) / 拉霸店 (20) pads (§7) and their four exclusive tools (§7.5).
 *  - Minors (§3): the five children are turned away at 陪酒店 / 泡泡浴 / 情人酒店 and never meet alcohol or 黑幫.
 *
 * Every random choice of its own (incidents, the machines, the decks, the NPCs' squares) comes from streams made of the
 * game's seed, the day, the player and a counter, so watching or not, saving and loading do not change a game.
 */
import type { Facility, Land, BoardNode } from './board';
import { facilityOf, landOf } from './board';
import { CHARACTERS } from './characters';
import { ask, type Flow } from './flow';
import { MAP_RULES, type Game, type MapRules } from './game';
import { Rng, daySeed } from './rng';
import { MAP_TOOLS, type ToolDef } from './modules/tools';
import { WheelKind } from './modules/wheel';
import { shuffleDeck, type ResultLine } from './modules/events';
import {
  GANG_AWAY, GANG_DAYS, GANG_PRISON_DAYS, GANG_SPAWNS, INCIDENTS, KB_CARD, KB_CARDS, KB_CARDS_OWN, KB_FATE, KB_RAMPAGE, KB_ID_BASE, KB_NEWS, KB_TOOLS, MERCH, MERCH_LINE, MINOR_REFUSED, MINORS,
  OLD_BODYGUARD, OLD_NEON, OLD_NEON_POINTS, SHOP_NAMES, SHOP_RULES, SHOP_TYPES, TOUT_SPAWNS, isKbShop, shopNameFor, type Incident, type KbCard,
} from './modules/kb-data';
import * as M from './modules/kb-machines';
import { HAND_LIMIT } from './modules/cards';
import type { Player } from './types';

export const KB_MAP = 106;
export const KB_NAME = '歌舞伎町';
/** Events of the two pads (§7; 17 / 18 are 大富豪模式's station / airport). */
export const EV_PACHINKO = 19, EV_PACHISLOT = 20;
const T_KAKUHEN = 17, T_TAXI = 18, T_TELEPORT = 11;

for (const t of KB_TOOLS) if (!MAP_TOOLS.some(m => m.id === t.id)) MAP_TOOLS.push(t);

/** What this map keeps beside the board (saved with the game). */
export interface KbState {
  /** Turns a shop owner still sits out (「處理事務中」), by player. */
  busy: number[];
  /** 黑幫: on `node` (0 none), held by `holder` (-1 none) for `days`, `take` collected this time, back in `back` days. */
  gang: { node: number; holder: number; days: number; take: number; back: number };
  /** 拉客仔: on `node`, gone for `gone` days. */
  tout: { node: number; gone: number };
  /** Shops closed for some days (facility id → days). */
  closed: Record<string, number>;
  /** The news of the day still in force (name → days). */
  mods: Record<string, number>;
  /** VIP card (fate): the next shop visit has no incident and pays ×1. */
  vip: number[];
  /** 計程車券 put on a rival: their next throw is five dice (1 pending), by player. */
  taxi: number[];
  /** 暴走卡: extra turns still to take right after this one, by player. */
  extra: number[];
  /** The dice tool used this turn (17 確變骰子, 18 計程車券), by player. */
  roll: number[];
  /** The decks: order and next position. */
  news: { deck: number[]; next: number };
  fate: { deck: number[]; next: number };
  /** Stored balls / medals at the counters (存玉), by player. */
  tama: number[];
  medals: number[];
  /** Draw counter of the own streams. */
  draws: number;
}

const fmt = (n: number) => Math.trunc(n).toLocaleString('en-US');

export class KabukichoRules implements MapRules {
  s: KbState;
  /** 情人酒店 is a hotel (Game.damageProperty sends its guests out like the original 旅館's). */
  readonly hotelType = 13;
  readonly extraTools: readonly ToolDef[] = KB_TOOLS;
  /** The prizes of the last counter visit (the result notice shows them with their pictures). */
  prizes: { id: number; card: boolean; n: number }[] = [];
  /** 保鑣卡, 暴走卡 (§4.1, §7.5): held outside the card pool, only from the prize counter. */
  readonly ownCards = KB_CARDS_OWN;

  constructor(readonly g: Game) {
    const n = g.players.length;
    this.s = {
      busy: new Array(n).fill(0), gang: { node: 0, holder: -1, days: 0, take: 0, back: 0 }, tout: { node: 0, gone: 0 },
      closed: {}, mods: {}, taxi: new Array(n).fill(0), extra: new Array(n).fill(0), vip: new Array(n).fill(0), roll: new Array(n).fill(0),
      news: { deck: [], next: 0 }, fate: { deck: [], next: 0 }, tama: new Array(n).fill(0), medals: new Array(n).fill(0), draws: 0,
    };
    // The exclusive tools need room in every player's tool counts (ids 17, 18; 19 and 20 were 保鑣 and 霓虹燈箱).
    for (const p of g.players) while (p.tools.length < 20) p.tools.push(0);
    const r = this.stream(0x5eed, -1);
    this.s.news.deck = shuffleDeck(r, KB_NEWS.length);
    this.s.fate.deck = shuffleDeck(r, KB_FATE.length);
    this.s.gang.node = GANG_SPAWNS[r.below(GANG_SPAWNS.length)];
    this.s.tout.node = TOUT_SPAWNS[r.below(TOUT_SPAWNS.length)];
  }

  saveState(): KbState { return this.s; }
  loadState(s: unknown): void {
    if (s && typeof s === 'object') this.s = { ...this.s, ...(s as KbState) };
    delete (this.s as unknown as { neon?: unknown }).neon;
    // A save from before a card was added (2026-10-18: kb-n-raid, kb-f-casino): the new ones go to the bottom of the deck.
    for (const [deck, n] of [[this.s.news, KB_NEWS.length], [this.s.fate, KB_FATE.length]] as const) for (let i = 0; i < n; i++) if (!deck.deck.includes(i)) deck.deck.push(i);
    // A save from before 2026-10-18: the tool 保鑣 becomes the card, a 霓虹燈箱 (dropped) its price back in 點券.
    for (const p of this.g.players) {
      for (let n = p.tools[OLD_BODYGUARD - 1] ?? 0; n > 0; n--) this.g.cards.receive(p, KB_CARD);
      p.points = Math.min(0xffff, p.points + (p.tools[OLD_NEON - 1] ?? 0) * OLD_NEON_POINTS);
      if (p.tools.length >= OLD_NEON) p.tools[OLD_BODYGUARD - 1] = p.tools[OLD_NEON - 1] = 0;
    }
  }

  /** 暴走卡 (§7.5): one more whole turn after this one (state `extra`, by player). */
  *playCard(g: Game, p: Player, id: number): Flow<boolean> {
    if (id !== KB_RAMPAGE || !g.cards.consume(p, id)) return false;
    this.s.extra[p.id] = (this.s.extra[p.id] ?? 0) + 1;
    yield { t: 'fx', kind: 'kb-rampage', p: p.id, data: { turns: this.s.extra[p.id] } };
    yield* g.say(p.id, '暴走！再來一回合', `${g.name(p.id)}使用暴走卡：這回合走完，馬上再來一整個回合`);
    return true;
  }

  /**
   * The computer plays a 暴走卡 when another turn is worth it: cash to buy or build (on hand above 15,000 × the price
   * index, with an unowned plot or an own building below level 5 on the map), or the 黑幫 on it (more 保護費).
   */
  aiPlayCard(g: Game, p: Player, id: number): boolean {
    if (id !== KB_RAMPAGE || (this.s.extra[p.id] ?? 0) > 0) return false;
    if (this.s.gang.holder === p.id) return true;
    const me = p.id + 1;
    const room = g.board.lands.some(l => !l.owner || (l.owner === me && l.level < 5)) || g.board.facilities.some(f => !f.owner || (f.owner === me && f.level < 5));
    return p.cash >= 15000 * g.priceIndex && room;
  }

  extraTurn(_g: Game, p: Player): boolean {
    const n = this.s.extra[p.id] ?? 0;
    if (n <= 0) return false;
    this.s.extra[p.id] = n - 1;
    return !this.g.offRoad(p);
  }


  /** An own stream (§ header): seed, salt, player, day and the draw counter. */
  stream(salt: number, p: number): Rng {
    const g = this.g;
    this.s.draws = (this.s.draws + 1) >>> 0;
    return new Rng(daySeed((g.rollSeed() ^ salt ^ Math.imul(p + 2, 0x9e3779b1) ^ Math.imul(this.s.draws, 0x85ebca6b)) >>> 0, g.daysElapsed));
  }

  // ---------------------------------------------------------------- helpers

  female(p: Player): boolean { return !!CHARACTERS[p.character]?.female; }
  minor(p: Player): boolean { return MINORS.has(p.character); }
  /** The shop's rate R (§2): its fee at its level × the price index. */
  rate(f: Facility): number { return (f.fees[f.level] ?? 0) * this.g.priceIndex; }
  mod(name: string): boolean { return (this.s.mods[name] ?? 0) > 0; }
  prisonSquare(): BoardNode | undefined { return this.g.board.nodes.find(n => n.event === 4); }
  facilityNode(f: Facility): BoardNode | undefined { return this.g.board.nodes.find(n => n.ref === f.id + 4000); }

  *pause(owner: Player, turns: number): Flow {
    if (!owner.whoPlays) return;
    this.s.busy[owner.id] = Math.min(2, (this.s.busy[owner.id] ?? 0) + turns);
    yield { t: 'fx', kind: 'kb-busy', p: owner.id, data: { turns: this.s.busy[owner.id] } };
  }

  /** Level −1 for an incident or a smashed shop (never below 1 for a shop: it stays; a lot down to 0). */
  lower(ref: number): boolean {
    const g = this.g;
    if (ref > 4000 && ref < 6000) { const f = g.board.facilities[ref - 4001]; if (f.level > 1) { f.level -= 1; return true; } return false; }
    if (ref > 2000 && ref < 4000) { const l = g.board.lands[ref - 2001]; if (l.level > 0) { l.level -= 1; return true; } }
    return false;
  }

  /** A fine to the lottery pool (as the originals' fines), never more than the payer holds. */
  *fine(p: Player, amount: number, why: string): Flow<number> {
    const a = Math.min(Math.trunc(amount), Math.max(0, p.cash + p.bank));
    if (a <= 0) return 0;
    return yield* this.g.transfer(p.id, -1, a, 0, why);
  }

  /** The hospital wheel of the incidents (§2.2): 0–3 days, 0 = nothing. */
  *hospitalWheel(p: Player, rng: Rng): Flow<number> {
    const d = rng.below(4);
    yield { t: 'fx', kind: 'kb-hospital-wheel', p: p.id, data: { days: d } };
    if (d) yield* this.g.sendTo(p, 'hospital', d);
    else yield* this.g.say(p.id, '0 天：沒事！', `${this.g.name(p.id)}的住院轉盤停在 0：沒事`);
    return d;
  }

  /**
   * Prison for something the player did (the user 2026-10-18; never an owner for his shop's doings): `luck` the god's
   * check first (06 §2.1: escaped, or twice the days), then 免罪卡 / 嫁禍卡 (06 §2.2), then `days` in prison. Returns
   * the result lines.
   */
  *jail(g: Game, p: Player, days: number, luck = true): Flow<ResultLine[]> {
    if (!p.whoPlays || g.over) return [];
    if (luck) {
      const r = yield* g.objects.luck(p, 1, 1);
      if (r === 1) return [{ p: p.id, text: `${g.objects.godName(p) || '神明'}保佑，逃過此劫` }];
      if (r === 2) days *= 2;
    }
    const target = yield* g.cards.pardonOrFrame(p);
    if (target < 0) return [{ p: p.id, text: '免罪卡生效，逃過此劫' }];
    yield* g.sendTo(g.players[target], 'prison', days);
    const lines: ResultLine[] = [];
    if (target !== p.id) lines.push({ p: p.id, text: `用嫁禍卡嫁禍給${g.name(target)}` });
    lines.push({ p: target, text: `坐牢${days}天` });
    return lines;
  }

  // ---------------------------------------------------------------- turns

  *turnHold(g: Game, p: Player): Flow<boolean> {
    if (this.s.gang.holder === p.id && p.god) { this.gangLeaves(); yield { t: 'fx', kind: 'kb-gang', p: p.id, data: { on: false } }; } // a god came: 黑幫 leaves
    const n = this.s.busy[p.id] ?? 0;
    if (n <= 0) return false;
    this.s.busy[p.id] = n - 1;
    yield { t: 'fx', kind: 'kb-busy', p: p.id, data: { turns: n - 1, sitting: true } };
    yield* g.say(p.id, '處理事務中！', `${g.name(p.id)}處理事務中，這回合停下${n > 1 ? `（之後還要停${n - 1}回合）` : ''}`);
    return true;
  }

  daily(g: Game = this.g): void {
    const s = this.s;
    for (const k of Object.keys(s.mods)) if (--s.mods[k] <= 0) delete s.mods[k];
    for (const k of Object.keys(s.closed)) if (--s.closed[k] <= 0) delete s.closed[k];
    if (s.tout.gone > 0) s.tout.gone -= 1;
    const h = s.gang.holder;
    if (h >= 0) {
      const q = g.players[h];
      if (!q || !q.whoPlays) this.gangLeaves();
      else if (--s.gang.days <= 0) this.gangLeaves();
    } else if (!s.gang.node && s.gang.back > 0 && --s.gang.back === 0) {
      const taken = new Set(g.players.filter(q => q.placed).map(q => q.node));
      const free = GANG_SPAWNS.filter(n => !taken.has(n));
      s.gang.node = (free.length ? free : GANG_SPAWNS)[this.stream(0x9a9, -1).below((free.length ? free : GANG_SPAWNS).length)];
    }
  }

  // ---------------------------------------------------------------- 黑幫 (§4.1)

  gangLeaves(): void {
    const s = this.s.gang;
    s.holder = -1; s.days = 0; s.take = 0; s.node = 0; s.back = GANG_AWAY;
  }

  *step(g: Game, p: Player, left: number): Flow<number> {
    const s = this.s.gang;
    // Only on the square the walk ends on, exactly as the gods (objects.ts step: the objects' table runs when no steps are
    // left, rich4_player_core_actions.asm:2888); passing by does nothing.
    if (left === 0 && s.holder < 0 && s.node && p.node === s.node && p.whoPlays && !g.offRoad(p)) yield* this.possess(g, p);
    if (s.holder === p.id && p.god) {          // a god drives 黑幫 off (one possession at a time, as gods do)
      yield { t: 'fx', kind: 'kb-gang', p: p.id, data: { on: false } };
      yield* g.say(p.id, '神明來了，黑幫走了！');
      this.gangLeaves();
    }
    if (s.holder === p.id && g.node(p.node).event === 4) { yield* this.arrest(g, p, true); return 0; }
    return left;
  }

  /**
   * 黑幫 possesses p (§4.1), as a god attaches (06 §5.2): one possession at a time, so a god p holds leaves first.
   * Everyone, children too (the user, 2026-10-17).
   */
  *possess(g: Game, p: Player): Flow<boolean> {
    if (this.s.gang.holder >= 0) return false;
    if (p.god) yield* g.objects.detachGod(p);
    Object.assign(this.s.gang, { holder: p.id, days: GANG_DAYS, take: 0, node: 0, back: 0 });
    yield { t: 'fx', kind: 'kb-gang', p: p.id, node: p.node, data: { on: true } };
    yield* g.say(p.id, '黑幫附身！', `${g.name(p.id)}被黑幫附身！七天內停在對手的地上，地主要付你保護費`);
    return true;
  }

  possessed(p: Player): boolean { return this.s.gang.holder === p.id; }

  /** 送神符 (04 §3.22): a possessing 黑幫 is sent away like a bad god; its 30 days off the map start. Takings kept. */
  *sendAway(g: Game, p: Player): Flow<boolean> {
    if (this.s.gang.holder !== p.id) return false;
    this.gangLeaves();
    yield { t: 'fx', kind: 'kb-gang', p: p.id, data: { on: false, sent: true } };
    yield* g.say(p.id, '送神符：黑幫走了！');
    return true;
  }

  /** The free god nearest to p (the original's 請神符 picks the nearest; 06 §5.4), with its distance. */
  private nearestFreeGod(g: Game, p: Player): number {
    const c = g.node(p.node);
    let d = Infinity;
    for (const o of g.objects.slots) {
      if (!o.node || o.owner || !((o.type >= 1 && o.type <= 10) || o.type === 12 || o.type === 15)) continue;
      const n = g.node(o.node);
      d = Math.min(d, Math.hypot(n.x - c.x, n.y - c.y));
    }
    return d;
  }

  /**
   * 請神符 (04 §3.23): calls 黑幫 onto p when it is on the map and nearer than any free god (a human), or when the
   * computer chose its square (`node`). Not on cooldown (then it is not on the map).
   */
  *invite(g: Game, p: Player, node?: number): Flow<boolean> {
    const s = this.s.gang;
    if (!s.node || s.holder >= 0) return false;
    if (node !== undefined) { if (node !== s.node) return false; }
    else {
      const c = g.node(p.node), n = g.node(s.node), d = Math.hypot(n.x - c.x, n.y - c.y);
      if (d >= 10000 || d >= this.nearestFreeGod(g, p)) return false;
    }
    return yield* this.possess(g, p);
  }

  /** The computer's 請神符 on 黑幫: when it has no good god, owns little and 黑幫 is about (half the time). */
  aiInvite(g: Game, p: Player): number | null {
    const s = this.s.gang;
    if (!s.node || s.holder >= 0 || p.god) return null;
    const mine = g.board.lands.filter(l => l.owner === p.id + 1).length + g.board.facilities.filter(f => f.owner === p.id + 1).length;
    const theirs = g.board.lands.filter(l => l.owner && l.owner !== p.id + 1).length + g.board.facilities.filter(f => f.owner && f.owner !== p.id + 1).length;
    return theirs > mine && this.stream(0x1a1, p.id).below(2) === 0 ? s.node : null;
  }

  /** The computer's 送神符 on 黑幫: once it has collected 10,000 × F (keep the money before the prison takes it). */
  aiSendAway(g: Game, p: Player): boolean {
    return this.s.gang.holder === p.id && this.s.gang.take >= 10000 * g.priceIndex;
  }

  /** 違反暴力團對策法 (§4.1): the takings confiscated (cash first), 7 days in prison, the possession over. */
  *arrest(g: Game, p: Player, send: boolean): Flow {
    const take = Math.min(this.s.gang.take, Math.max(0, p.cash + p.bank));
    this.gangLeaves();
    yield { t: 'fx', kind: 'kb-gang-arrest', p: p.id, node: p.node, data: { take } };
    yield* g.say(p.id, `違反暴力團對策法！\n沒收${fmt(take)}・坐牢${GANG_PRISON_DAYS}天`, `違反暴力團對策法！${g.name(p.id)}的保護費 ${fmt(take)}元 全部沒收，坐牢${GANG_PRISON_DAYS}天`);
    if (take > 0) yield* g.transfer(p.id, -1, take, 0, '沒收保護費');
    if (!p.whoPlays || g.over) return;
    if (send) yield* g.sendTo(p, 'prison', GANG_PRISON_DAYS);
    else if ((p.prison & 0x7f) < GANG_PRISON_DAYS) p.prison = GANG_PRISON_DAYS;
  }

  *afterSend(g: Game, p: Player, place: 'hospital' | 'prison'): Flow {
    if (place === 'prison' && this.s.gang.holder === p.id) yield* this.arrest(g, p, false);
  }

  *teleported(g: Game, q: Player): Flow {
    if (this.s.gang.holder === q.id && g.node(q.node).event === 4) yield* this.arrest(g, q, true);
  }

  /** The owner pays the possessed visitor (§4.1): cash only; none → the property loses a level (店被砸了). */
  *protection(g: Game, p: Player, owner: Player, ref: number, amount: number): Flow {
    if (owner.cards.includes(KB_CARD)) {
      g.cards.consume(owner, KB_CARD);
      yield { t: 'fx', kind: 'kb-bodyguard', p: owner.id, target: p.id, node: p.node };
      yield* g.say(owner.id, '保鑣出面！保護費免了', `${g.name(owner.id)}的保鑣卡：保鑣出面，保護費免了！`);
      return;
    }
    if (owner.cash <= 0) {
      const hit = this.lower(ref);
      yield { t: 'fx', kind: 'kb-smash', p: p.id, target: owner.id, node: p.node, data: { ref, hit } };
      yield* g.say(p.id, `店被砸了！${hit ? '降一級' : ''}`, `${g.name(owner.id)}沒有現金付保護費……店被砸了！${hit ? '（降一級）' : ''}`);
      yield { t: 'board' };
      return;
    }
    const a = Math.min(owner.cash, Math.max(0, Math.trunc(amount)));
    yield { t: 'fx', kind: 'kb-protection', p: p.id, target: owner.id, node: p.node, data: { amount: a } };
    yield* g.say(p.id, `保護費 +${fmt(a)}`, `黑幫上門！${g.name(owner.id)}付${g.name(p.id)}保護費${fmt(a)}元`);
    yield* g.transfer(owner.id, p.id, a, 1, '保護費');
    this.s.gang.take += a;
  }

  /** A computer holding 黑幫 avoids the prison at forks (§4.1). */
  walkNext(g: Game, pid: number, at: number, from: number, next: number): number {
    if (this.s.gang.holder !== pid || g.isHuman(g.players[pid])) return next;
    const bad = (first: number) => this.reaches(g, pid, at, first, 12);
    if (!bad(next)) return next;
    const other = g.node(at).adjacent.filter(a => a && a !== from && a !== next && !bad(a));
    return other[0] ?? next;
  }

  /** Whether walking from `at` to `first` and on (forks by p's choices) meets the prison square within `steps`. */
  reaches(g: Game, pid: number, at: number, first: number, steps: number): boolean {
    let from = at, cur = first;
    for (let i = 0; i < steps; i++) {
      const n = g.node(cur);
      if (!n) return false;
      if (n.event === 4) return true;
      const ways = n.adjacent.filter(a => a && a !== from);
      const nx = g.forks.isFork(cur) ? g.forks.follow(pid, cur, from) : ways[0] ?? from;
      from = cur; cur = nx;
    }
    return false;
  }

  // ---------------------------------------------------------------- squares

  *landSquare(g: Game, p: Player, n: BoardNode): Flow<boolean> {
    if (n.event === EV_PACHINKO || n.event === EV_PACHISLOT) { yield* this.machine(g, p, n.event === EV_PACHINKO ? 'pachinko' : 'pachislot'); return true; }
    if (n.event === 0 && !n.ref && n.id === this.s.tout.node && !this.s.tout.gone) { yield* this.drag(g, p); return true; }
    if (this.s.gang.holder === p.id) {
      const land = landOf(g.board, n), f = facilityOf(g.board, n);
      if (land && land.owner && land.owner !== p.id + 1) {
        const owner = g.players[land.owner - 1];
        let amount = g.calcToll(land.owner, land.chain ? null : land.name);
        if (land.tmpState) amount *= 2;
        amount = Math.round(amount * this.tollFactor(g, land));
        yield* this.protection(g, p, owner, land.id + 2000, amount);
        return true;
      }
      if (f && f.owner && f.owner !== p.id + 1 && f.level >= 1 && isKbShop(f.type)) {
        const owner = g.players[f.owner - 1];
        const mult = yield* g.spin(f.type === 13 ? WheelKind.hotel : WheelKind.shopping, this.wheelName(g, owner, f, p));
        yield* this.protection(g, p, owner, f.id + 4000, this.rate(f) * mult);
        return true;
      }
    }
    return false;
  }

  tollFactor(_g: Game, _land: Land): number {
    let k = 1;
    if (this.mod('tourists')) k *= 1.5;
    if (this.mod('blackout')) k *= 0.5;
    return k;
  }

  /** 拉客仔 (§4.2): into a random rival shop (a child only into a 居酒屋); then it moves to its other corner. */
  *drag(g: Game, p: Player): Flow {
    const kid = this.minor(p);
    const shops = g.board.facilities.filter(f => f.owner && f.owner !== p.id + 1 && f.level >= 1 && isKbShop(f.type) && (!kid || f.type === 10));
    this.s.tout.node = TOUT_SPAWNS.find(x => x !== this.s.tout.node) ?? this.s.tout.node;
    if (!shops.length) {
      yield { t: 'fx', kind: 'kb-tout', p: p.id, node: p.node, data: { ok: false } };
      yield* g.say(p.id, '拉客失敗！', '拉客仔搭訕失敗，沒有店可以去');
      return;
    }
    const f = shops[this.stream(0x70a7, p.id).below(shops.length)], node = this.facilityNode(f);
    if (!node) return;
    yield { t: 'fx', kind: 'kb-tout', p: p.id, node: node.id, data: { ok: true, facility: f.id, name: f.name, shop: shopNameFor(f.type, this.female(p)) } };
    yield* g.say(p.id, `被拉進${shopNameFor(f.type, this.female(p))}！`, `${g.name(p.id)}被拉客仔拉進${f.name}的${shopNameFor(f.type, this.female(p))}`);
    p.lastNode = p.node; p.node = node.id;
    yield { t: 'teleport', p: p.id, node: node.id };
    // Dragged in counts as stopping there (the user 2026-10-18): the landing exactly as on a stop (Game.land) — a 黑幫
    // holder's 保護費 or the shop, then the gods' stop effect in the original's order (06 §5.5: 土地公 takes it over,
    // 天使 builds, 惡魔 demolishes).
    yield* g.land(p);
  }

  // ---------------------------------------------------------------- the shops (§2)

  *landOnFacility(g: Game, p: Player, f: Facility): Flow<boolean> {
    const me = p.id + 1, human = g.isHuman(p);
    if (f.owner === 0 || (f.owner === me && f.level >= 1 && f.type === 4)) return false; // buying, and the lab: the original's
    if (f.owner === me) {
      if (p.sleepwalk) return true;
      if (f.level === 0) {
        const cost = f.price * g.priceIndex;
        if (cost > p.cash) { if (human) yield* g.say(p.id, '您的現金不足！'); return true; }
        const type = human ? yield* this.askShop(p, f, cost) : this.aiShop(g, p, f);
        if (type < 0) return true;
        if (yield* g.investmentBlocked(p)) return true;
        f.type = type; f.level = 1; p.cash -= cost;
        yield { t: 'build', p: p.id, kind: 'facility', id: f.id, level: 1, cost };
        yield* g.blessing(p, f.id + 4000);
        return true;
      }
      if (f.level >= 5) return true;
      const cost = f.fees[0] * g.priceIndex;
      if (cost > p.cash) { if (human) yield* g.say(p.id, '您的現金不足！'); return true; }
      const yes = human
        ? (yield ask({ t: 'yesno', p: p.id, kind: 'upgrade-facility', text: `${f.name}${SHOP_NAMES[f.type] ?? ''}\n\n升級費用:${cost}元\n\n是否升級？`, price: cost })) as boolean
        : true;
      if (!yes || (yield* g.investmentBlocked(p))) return true;
      p.cash -= cost; f.level += 1;
      yield { t: 'build', p: p.id, kind: 'facility', id: f.id, level: f.level, cost };
      yield* g.blessing(p, f.id + 4000);
      return true;
    }
    if (f.level >= 1 && isKbShop(f.type) && !((p.traffic & 0x83) === 3)) yield* this.visitShop(g, p, f);
    return true;
  }

  /** The shop a computer's free building puts on an empty plot (天使卡, 機器工人 …): each plot's own, round the four shops. */
  facilityType(f: Facility): number { return 10 + ((f.id - 1) % 4); }

  /** A human's free building there: the five-shop picker (as when buying it); a cancel builds the plot's default shop. */
  *pickFacilityType(_g: Game, p: Player, f: Facility): Flow<number> {
    const t = yield* this.askShop(p, f, 0, '免費建設（取消：蓋這塊地預設的店）');
    return t >= 0 ? t : this.facilityType(f);
  }

  /** 改建卡 on a shop: another of the five (the level kept); a computer turns a rival's into the 研究所 (no income). */
  *rebuildFacility(g: Game, p: Player, f: Facility, human: boolean): Flow<number> {
    if (human) return yield* this.askShop(p, f, 0);
    void g;
    return f.owner === p.id + 1 ? 10 : 4;
  }

  /** The human picks the shop (the original facility picker's row, screen 'kb-shop'); -1 cancels. */
  *askShop(p: Player, f: Facility, cost: number, text?: string): Flow<number> {
    const options = SHOP_TYPES.map(t => ({ label: SHOP_NAMES[t], value: t, detail: SHOP_RULES[t] }));
    const a = yield ask({ t: 'choose', p: p.id, title: `${f.name}：選擇要蓋的店`, text: text ?? `建設費用 ${fmt(cost)}元`, options, cancellable: true, screen: 'kb-shop' });
    return typeof a === 'number' && (SHOP_TYPES as readonly number[]).includes(a) ? a : -1;
  }

  /** A computer's shop: weighed, one of each first (§2). */
  aiShop(g: Game, p: Player, f: Facility): number {
    const w: Record<number, number> = { 10: 3, 11: 3, 12: 2, 13: 3, 4: 2 };
    for (const o of g.board.facilities) if (o !== f && o.level && w[o.type] !== undefined) w[o.type] = Math.max(1, w[o.type] - 1);
    let r = this.stream(0x5409, p.id).below(SHOP_TYPES.reduce((a, t) => a + w[t], 0));
    for (const t of SHOP_TYPES) { r -= w[t]; if (r < 0) return t; }
    return 10;
  }

  /** The incident drawn on a visit (§2.1 step 4), or null (‰ weights out of 1000). */
  drawIncident(rng: Rng, type: number): Incident | null {
    let r = rng.below(1000);
    for (const i of INCIDENTS) if (i.shop === type) { r -= i.w; if (r < 0) return i; }
    return null;
  }

  /** The shopping wheel's title for a shop (「阿土伯的居酒屋」, the screen's ribbon; the original's 「…的購物中心」). */
  wheelName(g: Game, owner: Player, f: Facility, p: Player): string { return `${g.name(owner.id)}的${shopNameFor(f.type, this.female(p))}`; }

  /** A visit to someone else's shop (§2.1). */
  *visitShop(g: Game, p: Player, f: Facility): Flow {
    const owner = g.players[f.owner - 1];
    if (!owner || owner.bankrupt || !owner.whoPlays) return;
    const female = this.female(p), shop = shopNameFor(f.type, female), where = `${g.name(owner.id)}的${f.name}${shop}`;
    if (this.s.closed[f.id]) { yield* g.say(undefined, `${shop}停業中！`, `${where}停業中，今天不營業`); return; }
    if (this.s.gang.holder === p.id) {
      const mult = yield* g.spin(f.type === 13 ? WheelKind.hotel : WheelKind.shopping, this.wheelName(g, owner, f, p));
      yield* this.protection(g, p, owner, f.id + 4000, this.rate(f) * mult);
      return;
    }
    if (this.minor(p) && f.type !== 10) { yield* this.kidVisit(g, p, owner, f, where); return; }
    if (f.type === 13) { yield* this.hotelStay(g, p, owner, f); return; }
    if (!(yield* g.ownerCollects(owner, f.tmpState, '消費'))) return;
    const rng = this.stream(0x5b0b + f.id, p.id);
    const vip = this.s.vip[p.id] > 0;
    if (vip) this.s.vip[p.id] = 0;
    let inc = vip ? null : this.drawIncident(rng, f.type);
    if (inc && inc.alcohol && this.minor(p)) inc = null;          // §3: no alcohol for a child
    if (inc && inc.id === 'extend' && female) inc = null;         // a woman's 延長服務 changed nothing: the free visit
    if (inc) { yield* this.incident(g, p, owner, f, inc, rng); return; }
    let mult: number;
    if ((f.type === 12 && female) || (f.type === 11 && female && this.mod('hostweek'))) {
      yield { t: 'fx', kind: 'kb-free', p: p.id, target: owner.id, data: { facility: f.id, shop } };
      yield* g.say(undefined, '女性顧客免費！', `${where}：女性顧客免費`);
      return;
    }
    if (vip) { mult = 1; yield* g.say(p.id, 'VIP：只付一倍', 'VIP會員：不轉盤，只付一倍'); }
    else mult = yield* g.spin(WheelKind.shopping, this.wheelName(g, owner, f, p));
    let rate = this.rate(f);
    if (f.tmpState) rate *= 2;
    const k = (f.type === 10 && this.mod('matsuri') ? 2 : 1) * (this.mod('typhoon') ? 0.5 : 1);
    const amount = Math.round(rate * mult * k);
    yield* g.say(undefined, `消費 −${fmt(amount)}元`, `${where}：消費 ${fmt(rate)}×${mult}倍${k !== 1 ? `×${k}` : ''}＝${fmt(amount)}元`);
    const paid = yield* g.collect(p, owner, amount, '消費', true);
    if (paid) f.lastFee = yield* g.transfer(paid.payer, owner.id, paid.amount, 0, '消費');
  }

  /**
   * A child at a rival's 陪酒店 / 泡泡浴 / 情人酒店 (§3, the user's balance rules): turned away, no incident, nothing adult,
   * but the owner is paid as by an adult at that level. At the 陪酒店 / 泡泡浴 the front counter sells one of the shop's
   * goods (MERCH): the shopping wheel × the rate (the adult's factors; no 女性顧客免費, that is the shop's service, not
   * its goods). At the 情人酒店 the staff take the child to the amusement park nearby: the stay wheel's N days, rate × N
   * as the adult stay, and N turns held there exactly as a stay (stayLabel: 在遊樂場玩).
   */
  *kidVisit(g: Game, p: Player, owner: Player, f: Facility, where: string): Flow {
    const shop = shopNameFor(f.type, this.female(p));
    yield { t: 'fx', kind: 'kb-refused', p: p.id, target: owner.id, data: { facility: f.id, shop } };
    if (f.type === 13) {
      yield* g.say(p.id, '未成年禁止入場！\n去遊樂場玩囉', `${where}：${MINOR_REFUSED}…被店員帶去附近的遊樂場玩`);
      yield* this.hotelStay(g, p, owner, f, true);
      return;
    }
    yield* g.say(p.id, '未成年禁止入場！', `${where}：${MINOR_REFUSED}${MERCH_LINE}`);
    if (!(yield* g.ownerCollects(owner, f.tmpState, '消費'))) return;
    const goods = MERCH[f.type] ?? MERCH[11], item = goods[this.stream(0x3e7c + f.id, p.id).below(goods.length)];
    const vip = this.s.vip[p.id] > 0;
    if (vip) this.s.vip[p.id] = 0;
    const mult = vip ? 1 : yield* g.spin(WheelKind.shopping, this.wheelName(g, owner, f, p));
    let rate = this.rate(f);
    if (f.tmpState) rate *= 2;
    const k = this.mod('typhoon') ? 0.5 : 1;
    const amount = Math.round(rate * mult * k);
    yield { t: 'fx', kind: 'kb-merch', p: p.id, target: owner.id, node: p.node, data: { facility: f.id, shop, name: f.name, pic: item.pic, item: item.name, line: item.line, amount } };
    yield* g.say(undefined, `買了周邊 −${fmt(amount)}元`, `${where}：${item.name} ${fmt(rate)}×${mult}倍${k !== 1 ? `×${k}` : ''}＝${fmt(amount)}元`);
    const paid = yield* g.collect(p, owner, amount, '消費', true);
    if (paid) f.lastFee = yield* g.transfer(paid.payer, owner.id, paid.amount, 0, '消費');
  }

  /**
   * A god's change to a payment, with its reason (the user 2026-10-18): 「大財神附身，消費免付！」, 「小財神附身，消費減半／
   * 3,000元」, 「大窮神附身，消費加倍／12,000元」, 「小窮神附身，消費×1.5／9,000元」 (the amount on its own line).
   */
  godFeeText(g: Game, p: Player, fee: string, total: number, amount: number): string {
    const god = g.objects.godName(p) || '神明';
    const t = g.objects.godType(p), n = `${fmt(amount)}元`;
    const how = amount === 0 ? '免付！' : t === 1 ? `減半\n${n}` : t === 6 ? `加倍\n${n}` : t === 5 ? `×1.5\n${n}` : `改為\n${n}`;
    void total;
    return `${god}附身，${fee}${how}`;
  }

  /** A child held at a 情人酒店 is playing at the amusement park nearby (§3). */
  stayLabel(g: Game, p: Player): string | undefined { return this.parked(g, p) ? '在遊樂場玩' : undefined; }
  /** A child staying at a 情人酒店 (only ever the amusement park, §3): the board shows no walk into the building. */
  parked(g: Game, p: Player): boolean { return this.minor(p) && g.board.facilities.find(x => x.id === p.facility)?.type === 13; }

  /**
   * 情人酒店 (§2.6): exactly the original 旅館's stay (02 §4.3): the owner's exemptions, the stay wheel (1–4 days), rate × days
   * (×2 for 漲價卡 and the news 情人節), paid without the passive cards, then the guest stays that many turns there
   * (hostility, insurance, bad days as the original). No incidents. A VIP card: one day.
   */
  *hotelStay(g: Game, p: Player, owner: Player, f: Facility, park = false): Flow {
    const fee = park ? '遊樂場費用' : '住宿費';
    if (!(yield* g.ownerCollects(owner, f.tmpState, fee))) return;
    let rate = this.rate(f);
    if (f.tmpState) rate *= 2;
    rate = Math.round(rate * (this.mod('valentine') ? 2 : 1) * (this.mod('typhoon') ? 0.5 : 1));
    const vip = this.s.vip[p.id] > 0;
    if (vip) this.s.vip[p.id] = 0;
    const days = vip ? 1 : yield* g.spin(WheelKind.hotel, this.wheelName(g, owner, f, p));
    const amount = rate * days;
    if (park) yield { t: 'fx', kind: 'kb-park', p: p.id, target: owner.id, node: p.node, data: { facility: f.id, days, amount } };
    yield* g.say(undefined, `${park ? `遊樂場${days}天` : `休息${days}天`}\n−${fmt(amount)}元`, `${g.name(p.id)}${park ? `在遊樂場玩${days}天` : `在${this.wheelName(g, owner, f, p)}休息${days}天`}，費用${fmt(amount)}元`);
    // The passive cards as on the other facility fees (Game.hotelPay, docs/rules/02 §4.3 remake): framed, the other
    // player stays — at this 情人酒店, or a child at the amusement park; the visitor goes on free.
    const stayer = yield* g.hotelPay(p, owner, f, amount, fee);
    if (!days || g.over || !stayer || !stayer.whoPlays) return;
    yield* g.checkIn(stayer, p, f, days, this.minor(stayer));
  }

  /** An incident (§2.2–2.6): the card first, then what it does to the visitor and to the owner. */
  *incident(g: Game, p: Player, owner: Player, f: Facility, inc: Incident, rng: Rng): Flow {
    const R = this.rate(f), female = this.female(p), ref = f.id + 4000;
    const bill = R * (rng.below(6) + 1);
    const pic = inc.gendered ? `${inc.pic}-${female ? 'f' : 'm'}` : inc.pic;
    const shop = shopNameFor(f.type, female);
    // 喝霸王酒: caught or not, drawn before the card so it can say what happens.
    const caught = inc.id === 'dash' ? rng.below(2) === 1 : false;
    const lockerTake = Math.max(0, Math.min(5 * R, Math.max(1000 * g.priceIndex, Math.trunc(p.cash / 10)), p.cash));
    // The card says what happens in plain words and real amounts (the user 2026-10-18; the R formulas only in the docs).
    const y = (n: number) => `${fmt(n)} 元`;
    const say: Record<string, [string, string]> = {
      poison: ['住院轉盤 0–3 天', `罰款 ${y(3 * R)}・停 1 回合`],
      drunk: [`付 ${y(bill)}・住院轉盤`, `收 ${y(bill)}`], cdrunk: [`付 ${y(bill)}・住院轉盤`, `收 ${y(bill)}`],
      dash: caught ? [`被抓：付 ${y(2 * bill)}・坐牢 2 天`, `收 ${y(2 * bill)}`] : ['跑掉了，一毛不付', '沒收到錢'],
      tv: [`付 ${y(bill)}`, `收 ${y(bill)}＋宣傳費 ${y(4 * R)}`],
      treat: ['免單（隔壁桌請客）', `收 ${y(bill)}`],
      ripoff: [`付 ${y(bill)}`, `罰款 ${y(4 * R)}・停 1 回合`],
      tower: [`付 ${y(bill + 5 * R)}`, `收 ${y(bill + 5 * R)}`],
      love: ['免單＋1 張卡片', '—'],
      minor: ['免單', `罰款 ${y(5 * R)}・降一級・停 2 回合`],
      late: ['免單', `罰款 ${y(3 * R)}・停業 3 天`],
      slip: ['住院轉盤 0–3 天', `罰款 ${y(2 * R)}`],
      locker: [`被偷 ${y(lockerTake)}`, '—'],
      vip: ['免單・點券 +30', '招待，不收錢'],
      licence: ['免單', `罰款 ${y(4 * R)}・降一級・停 1 回合`],
      extend: [`付 ${y(2 * bill)}`, `收 ${y(2 * bill)}`],
    };
    const [visitorLine, ownerLine] = say[inc.id] ?? [inc.visitor, inc.owner];
    yield { t: 'fx', kind: 'kb-incident', p: p.id, target: owner.id, node: p.node, data: {
      facility: f.id, shop, name: f.name, title: inc.title, pic, visitor: visitorLine, owner: ownerLine, id: inc.id, R } };
    const lines: ResultLine[] = [];
    const pay = function* (this: KabukichoRules, from: Player, to: Player, amount: number, why: string) {
      const a = Math.min(Math.trunc(amount), Math.max(0, from.cash + from.bank));
      if (a > 0) yield* g.transfer(from.id, to.id, a, 0, why);
      return a;
    }.bind(this);
    let wheel = false, jail = 0;
    switch (inc.id) {
      case 'poison': lines.push({ p: owner.id, text: '罰款', amount: -(yield* this.fine(owner, 3 * R, '食物中毒罰款')) }); yield* this.pause(owner, 1); wheel = true; break;
      case 'drunk': case 'cdrunk': lines.push({ p: p.id, text: '付帳', amount: -(yield* pay(p, owner, bill, '消費')) }); wheel = true; break;
      case 'dash': if (caught) { lines.push({ p: p.id, text: '被抓到，付 2 倍', amount: -(yield* pay(p, owner, 2 * bill, '霸王酒')) }); jail = 2; } else lines.push({ p: p.id, text: '跑掉了！一毛不付' }); break;
      case 'tv': lines.push({ p: p.id, text: '付帳', amount: -(yield* pay(p, owner, bill, '消費')) }); g.gain(owner, 4 * R, 0); lines.push({ p: owner.id, text: '宣傳費', amount: 4 * R }); break;
      case 'treat': g.gain(owner, bill, 0); lines.push({ p: owner.id, text: '隔壁桌付了帳單', amount: bill }); break;
      case 'ripoff': lines.push({ p: p.id, text: '只付正常帳單', amount: -(yield* pay(p, owner, bill, '消費')) }); lines.push({ p: owner.id, text: '罰款', amount: -(yield* this.fine(owner, 4 * R, '敲竹槓罰款')) }); yield* this.pause(owner, 1); break;
      case 'tower': lines.push({ p: p.id, text: '香檳塔', amount: -(yield* pay(p, owner, bill + 5 * R, '香檳塔')) }); break;
      case 'love': { const id = yield* g.cards.receiveRandom(p); if (id) yield { t: 'fx', kind: 'card-received', p: p.id, data: { card: id } }; lines.push({ p: p.id, text: id ? '不用付錢，還收到一張卡片' : '不用付錢' }); break; }
      case 'minor': lines.push({ p: owner.id, text: '罰款', amount: -(yield* this.fine(owner, 5 * R, '僱用未成年罰款')) }); if (this.lower(ref)) lines.push({ p: owner.id, text: '店降一級' }); yield* this.pause(owner, 2); break;
      case 'late': lines.push({ p: owner.id, text: '罰款，停業 3 天', amount: -(yield* this.fine(owner, 3 * R, '超時營業罰款')) }); this.s.closed[f.id] = 3; break;
      case 'slip': lines.push({ p: owner.id, text: '罰款', amount: -(yield* this.fine(owner, 2 * R, '地板太滑罰款')) }); wheel = true; break;
      case 'locker': { const a = lockerTake; if (a > 0) yield* g.transfer(p.id, -1, a, 0, '置物櫃被撬'); lines.push({ p: p.id, text: '現金被偷了', amount: -a }); break; }
      case 'vip': p.points = (p.points + 30) & 0xffff; yield { t: 'points', p: p.id, amount: 30 }; lines.push({ p: p.id, text: '免單・點券 +30' }); break;
      case 'licence': lines.push({ p: owner.id, text: '罰款', amount: -(yield* this.fine(owner, 4 * R, '無照營業罰款')) }); if (this.lower(ref)) lines.push({ p: owner.id, text: '店降一級' }); yield* this.pause(owner, 1); break;
      case 'extend': lines.push({ p: p.id, text: '付 2 倍帳單', amount: -(yield* pay(p, owner, 2 * bill, '延長服務')) }); break;
      case 'cheat': lines.push({ p: p.id, text: '得到賠償', amount: yield* pay(owner, p, 3 * R, '出千賠償') }); yield* this.pause(owner, 1); break;
      case 'streak': lines.push({ p: p.id, text: '手氣大旺', amount: yield* pay(owner, p, 3 * R, '賭場彩金') }); break;
      case 'bust': lines.push({ p: p.id, text: '輸到脫褲', amount: -(yield* pay(p, owner, 3 * R, '賭場輸款')) }); break;
      case 'report': lines.push({ p: owner.id, text: '罰款', amount: -(yield* this.fine(owner, 5 * R, '經營賭場罰款')) }); lines.push({ p: p.id, text: '賭客罰款', amount: -(yield* this.fine(p, R, '賭博罰款')) }); if (this.lower(ref)) lines.push({ p: owner.id, text: '店降一級' }); yield* this.pause(owner, 2); break;
      case 'comp': p.points = (p.points + 40) & 0xffff; yield { t: 'points', p: p.id, amount: 40 }; lines.push({ p: p.id, text: '點券 +40' }); break;
    }
    if ((this.s.busy[owner.id] ?? 0) > 0 && ['poison', 'ripoff', 'minor', 'licence', 'cheat', 'report'].includes(inc.id)) lines.push({ p: owner.id, text: `處理事務中 ${this.s.busy[owner.id]} 回合` });
    yield { t: 'board' };
    yield { t: 'fx', kind: 'event-result', p: p.id, node: p.node, data: { src: 'fate', id: 0, fx: lines.some(l => (l.amount ?? 0) < 0 && l.p === p.id) ? 'fine' : 'gain', title: shop, head: inc.title, lines, tag: KB_NAME, local: pic } };
    if (wheel && p.whoPlays && !g.over) yield* this.hospitalWheel(p, rng);
    // 喝霸王酒 caught: the visitor broke the law (the user 2026-10-18); 免罪卡 / 嫁禍卡 as on any prison.
    if (jail && p.whoPlays && !g.over) {
      const out = yield* this.jail(g, p, jail, false);
      if (!out.some(l => l.text.startsWith('坐牢'))) yield* g.say(p.id, out[0]?.text ?? '');
    }
  }

  // ---------------------------------------------------------------- 柏青哥店 / 拉霸店 (§7)

  *machine(g: Game, p: Player, kind: M.MachineKind): Flow {
    const name = kind === 'pachinko' ? '柏青哥店' : '拉霸店', human = g.isHuman(p);
    if (p.points < M.BUY_POINTS) {
      yield { t: 'fx', kind: 'kb-machine-result', p: p.id, node: p.node, data: { kind, skipped: true, text: `${g.name(p.id)}　${name}：點券不足，只能路過看看` } };
      if (human) yield* g.say(p.id, '點券不足！', '點券不足，不能玩');
      return;
    }
    const rng = this.stream(kind === 'pachinko' ? 0x9ac1 : 0x5107, p.id);
    const boost = this.mod(kind === 'pachinko' ? 'newmachine' : 'setting6');
    let buys: number, left: number, summary: string;
    if (human) {
      const maxBuys = Math.min(M.MAX_BUYS, Math.floor(p.points / M.BUY_POINTS));
      const seed = rng.rand() * 32768 + rng.rand();
      const stored = kind === 'pachinko' ? this.s.tama[p.id] : this.s.medals[p.id];
      const a = (yield ask({ t: 'kb-machine', p: p.id, kind, maxBuys, seed, boost, stored, points: p.points } as never)) as unknown as { buys?: number; left?: number; a?: number; b?: number; played?: number } | undefined;
      buys = Math.max(0, Math.min(maxBuys, Math.trunc(Number(a?.buys) || 0)));
      left = Math.max(0, Math.trunc(Number(a?.left) || 0));
      if (stored) { if (kind === 'pachinko') this.s.tama[p.id] = 0; else this.s.medals[p.id] = 0; }
      summary = kind === 'pachinko' ? `大當たり ${a?.b ?? 0} 次` : `BIG ${a?.a ?? 0}・REG ${a?.b ?? 0}`;
    } else {
      const need = [80, 50, 40][CHARACTERS[p.character]?.personality ?? 1];
      if (p.points < need) {
        yield { t: 'fx', kind: 'kb-machine-result', p: p.id, node: p.node, data: { kind, skipped: true, text: `${g.name(p.id)}　${name}：路過看看（點券 ${p.points}）` } };
        return;
      }
      const units = Math.max(1, Math.min(3, Math.floor((p.points - 30) / 20)));
      const r = M.aiSession(rng, kind, units, boost);
      buys = r.buys; left = r.left;
      summary = kind === 'pachinko' ? (r.b ? `大當たり ${r.b} 次${r.b > r.a ? `（確變・時短連 ${r.b - r.a}）` : ''}` : '沒中') : (r.a + r.b ? `BIG ${r.a}・REG ${r.b}` : '沒中獎');
    }
    const cost = buys * M.BUY_POINTS;
    p.points = Math.max(0, p.points - cost);
    const unit = kind === 'pachinko' ? '顆' : '枚', per = kind === 'pachinko' ? M.BALLS_PER_BUY : M.MEDALS_PER_BUY;
    this.prizes = [];
    const got = yield* this.exchange(g, p, kind, left, rng);
    const text = `${g.name(p.id)}　${kind === 'pachinko' ? '柏青哥' : '拉霸'}　花 ${cost} 點券（${buys * per}${unit}）→ ${summary} → 剩 ${fmt(left)}${unit} → 換：${got}`;
    yield { t: 'fx', kind: 'kb-machine-result', p: p.id, node: p.node, data: { kind, buys, cost, left, text, human, items: this.prizes } };
  }

  /**
   * The prize counter (§7.4): the halls are arcade games, no cash for anyone. The prizes: the exclusive tools, 保鑣卡,
   * the original tools 1–8 from the shop's stock, at their value in 點券 (news 景品交換所改裝: 30 % off). The human
   * picks them; what is left goes back as 點券 at the rate they were bought (a good session ends with more), or is
   * kept at the hall (存玉／存幣); odd balls are candy. A computer takes an exclusive tool it lacks (保鑣卡 first while
   * 黑幫 is about), then 點券. Returns the line of what was taken.
   */
  *exchange(g: Game, p: Player, kind: M.MachineKind, left: number, rng: Rng): Flow<string> {
    void rng;
    const per = kind === 'pachinko' ? M.BALLS_PER_POINT : M.MEDALS_PER_POINT;
    let value = Math.floor(left / per);
    const got: string[] = [];
    const take = (id: number): boolean => {
      const def = this.prize(id);
      if (!def || value < def.price) return false;
      if (KB_CARDS_OWN.includes(id)) { if (p.cards.length >= HAND_LIMIT || !g.cards.receive(p, id)) return false; }
      else if (id >= 17) { if (p.tools[id - 1] >= 9) return false; p.tools[id - 1] += 1; }
      else if (!g.tools.receive(p, id)) return false;
      value -= def.price; got.push(def.name);
      const had = this.prizes.find(x => x.id === id);
      if (had) had.n += 1; else this.prizes.push({ id, card: KB_CARDS_OWN.includes(id), n: 1 });
      return true;
    };
    if (g.isHuman(p)) {
      const options = [...KB_TOOLS.map(t => t.id), KB_CARD, KB_RAMPAGE, 8, 2, 1, 3, 4, 7, 5, 6].map(id => {
        const d = this.prize(id)!, card = KB_CARDS_OWN.includes(id), have = card ? p.cards.filter(c => c === id).length : p.tools[id - 1] ?? 0;
        const stock = id <= 8 ? g.tools.shopStock[id - 1] ?? 0 : 99;
        return { id, name: d.name, price: d.price, card, have, max: card ? HAND_LIMIT - p.cards.length : Math.min(9 - have, stock), stock };
      });
      const a = (yield ask({ t: 'kb-exchange', p: p.id, kind, left, per, value, sale: this.mod('exchange'), options } as never)) as unknown as { tools?: number[]; store?: boolean } | undefined;
      for (const id of Array.isArray(a?.tools) ? a!.tools! : []) take(Number(id));
      if (a?.store && value > 0) {
        const keep = value * per + (left % per);
        if (kind === 'pachinko') this.s.tama[p.id] += keep; else this.s.medals[p.id] += keep;
        got.push(`存${kind === 'pachinko' ? '玉' : '幣'} ${fmt(keep)}`);
        value = 0;
      }
    } else {
      const order = [...(this.s.gang.holder >= 0 || this.s.gang.node ? [KB_CARD] : []), T_KAKUHEN, T_TAXI, KB_RAMPAGE];
      for (const id of order) if (KB_CARDS_OWN.includes(id) ? !p.cards.includes(id) : (p.tools[id - 1] ?? 0) === 0) take(id);
    }
    const back = value;
    if (back > 0) { p.points = Math.min(0xffff, p.points + back); got.push(`點券 ${back}`); }
    else if (value > 0 || left % per) got.push('糖果');
    return got.length ? got.join('、') : '糖果';
  }

  /** A prize's name and price in 點券 at the counter (§7.4; news 景品交換所改裝: −30 %). */
  prize(id: number): { name: string; price: number } | undefined {
    const d = id === KB_CARD ? { name: '保鑣卡', price: 25 } : id === KB_RAMPAGE ? { name: '暴走卡', price: 80 } : toolInfo(id);
    return d && { name: d.name, price: this.mod('exchange') ? Math.ceil(d.price * 0.7) : d.price };
  }

  // ---------------------------------------------------------------- the exclusive tools (§7.5)

  *useTool(g: Game, p: Player, tool: number, param?: number): Flow<boolean> {
    if ((p.tools[tool - 1] ?? 0) <= 0) return false;
    const taxiBound = (this.s.taxi?.[p.id] ?? 0) > 0;
    switch (tool) {
      case T_KAKUHEN:
        if (this.s.roll[p.id] || taxiBound) { if (taxiBound) yield* g.say(p.id, '已被塞上計程車！'); return false; }
        this.s.roll[p.id] = tool; p.tools[tool - 1] -= 1;
        yield { t: 'fx', kind: 'kb-tool', p: p.id, data: { tool } };
        g.stats?.toolUsed(p.id, tool);
        return true;
      case T_TAXI: {
        if (this.mod('taxistrike')) { yield* g.say(p.id, '罷工中，叫不到車！', '計程車大罷工中，叫不到車'); return false; }
        // Yourself (this throw) or anyone else on the road (their next throw), §7.5.
        let who = param ?? -1;
        if (who < 0) {
          // Picked on the map like the missiles (the user 2026-10-18): a glowing spot on everyone who can ride — oneself
          // and every rival on the road (not in hospital / prison / away, not already holding a taxi), anywhere on the map.
          const cands = g.players.filter(q => q.whoPlays && q.placed && !g.offRoad(q) && (q.id === p.id ? !this.s.roll[p.id] && !taxiBound : !(this.s.taxi[q.id] > 0))).map(q => q.id);
          if (g.isHuman(p)) {
            const spots = cands.map(id => ({ at: 'actor' as const, id, label: id === p.id ? `${g.name(id)}（自己）` : g.name(id) }));
            const i = Number(yield ask({ t: 'pick-map', p: p.id, title: '計程車券（自己或對手）', spots, cancellable: true }));
            who = cands[i] ?? -1;
          } else who = p.id;
          if (!cands.includes(who)) return false;
        }
        const q = g.players[who];
        if (!q) return false;
        if (q.id === p.id) {
          if (this.s.roll[p.id] || taxiBound) return false;
          this.s.roll[p.id] = tool;
        } else {
          if (g.offRoad(q) || !q.whoPlays) return false;
          if ((this.s.taxi[q.id] ?? 0) > 0) { yield* g.say(p.id, '對方已有計程車！', `${g.name(q.id)}已經被塞上計程車了`); return false; }
          this.s.taxi[q.id] = 1;
        }
        p.tools[tool - 1] -= 1;
        yield { t: 'fx', kind: 'kb-tool', p: p.id, target: q.id, data: { tool } };
        if (q.id !== p.id) yield* g.say(p.id, `${g.name(q.id)}被塞上計程車！\n下回合擲5顆`, `${g.name(q.id)}被塞上了計程車！下回合擲 5 顆骰子`);
        g.stats?.toolUsed(p.id, tool);
        return true;
      }
    }
    return false;
  }

  /** The computer (§4.1, §7.5): a 傳送機 on a rich 黑幫 holder, else its own tools now and then; false: the original's. */
  *aiTools(g: Game, p: Player): Flow<boolean> {
    const h = this.s.gang.holder, prison = this.prisonSquare();
    if (h >= 0 && h !== p.id && p.tools[T_TELEPORT - 1] > 0 && prison) {
      const q = g.players[h];
      if (q && q.whoPlays && !g.offRoad(q) && this.s.gang.take >= 10000 * g.priceIndex) {
        p.tools[T_TELEPORT - 1] -= 1;
        yield* g.say(p.id, `傳送機：${g.name(q.id)}送監獄！`, `使用傳送機：把${g.name(q.id)}送到監獄門口`);
        q.lastNode = q.node; q.node = prison.id;
        yield { t: 'teleport', p: q.id, node: prison.id };
        yield* this.arrest(g, q, true);
        g.stats?.toolUsed(p.id, T_TELEPORT);
        return true;
      }
    }
    const r = this.stream(0xa1, p.id);
    if (p.tools[T_TAXI - 1] > 0 && !this.mod('taxistrike')) {
      if (!(this.s.taxi[p.id] > 0) && this.taxiWorth(g, p)) { yield* g.say(p.id, '使用計程車券'); return yield* this.useTool(g, p, T_TAXI, p.id); }
      const q = this.taxiVictim(g, p);
      if (q) { yield* g.say(p.id, '使用計程車券', `使用計程車券：送${g.name(q.id)}一程`); return yield* this.useTool(g, p, T_TAXI, q.id); }
    }
    if (p.tools[T_KAKUHEN - 1] > 0 && r.below(3) === 0) { yield* g.say(p.id, '使用確變骰子'); return yield* this.useTool(g, p, T_KAKUHEN); }
    return false;
  }

  /**
   * Whether a computer takes the taxi (5 dice, 5–30 steps, §7.5): good squares 15–30 steps ahead (a plot to buy or
   * build on with the cash for it, its own shops, the two pads) outnumber those its own dice reach (up to 6 a die), or
   * the near stretch is a rival's expensive street to cross (two built rival plots of level 3+ within 12).
   */
  taxiWorth(g: Game, p: Player): boolean {
    if (this.s.roll[p.id]) return false;
    const me = p.id + 1, F = g.priceIndex;
    const good = (n: BoardNode): boolean => {
      if (n.event === EV_PACHINKO || n.event === EV_PACHISLOT) return true;
      const l = landOf(g.board, n), f = facilityOf(g.board, n);
      if (l) return (!l.owner && p.cash > l.price * F * 2) || (l.owner === me && l.level < 5 && p.cash > 5000 * F);
      if (f) return (!f.owner && p.cash > f.price * F * 2) || f.owner === me;
      return false;
    };
    const bad = (n: BoardNode): boolean => {
      const l = landOf(g.board, n), f = facilityOf(g.board, n);
      return !!((l && l.owner && l.owner !== me && l.level >= 3) || (f && f.owner && f.owner !== me && f.level >= 3));
    };
    let near = 0, nearBad = 0, far = 0;
    const reach = 6 * Math.max(1, p.dice || 1);
    this.ahead(g, p, 30, (n, d) => {
      if (d <= reach && good(n)) near++;
      if (d <= 12 && bad(n)) nearBad++;
      if (d >= 15 && good(n)) far++;
    });
    return (p.traffic & 3) < 2 && (far > near || nearBad >= 2);
  }

  /**
   * A rival the computer sends off by taxi (5 dice next turn): one standing just before a stretch of the computer's
   * own big plots would rather stop there — so the taxi goes to a rival whose 15–30 steps ahead hold more of the
   * computer's level-3+ plots than their next 2–12 do (more chances to land on them), the richest such rival.
   */
  taxiVictim(g: Game, p: Player): Player | undefined {
    const me = p.id + 1;
    const mine = (n: BoardNode) => {
      const l = landOf(g.board, n), f = facilityOf(g.board, n);
      return !!((l && l.owner === me && l.level >= 3) || (f && f.owner === me && f.level >= 3));
    };
    const cands = g.players.filter(q => q.id !== p.id && q.whoPlays && q.placed && !g.offRoad(q) && !(this.s.taxi[q.id] > 0) && this.s.gang.holder !== q.id);
    let best: Player | undefined, bestW = -1;
    for (const q of cands) {
      let near = 0, far = 0;
      this.ahead(g, q, 30, (n, d) => { if (mine(n)) { if (d >= 15) far++; else if (d >= 2 && d <= 12) near++; } });
      if (far >= 2 && far > near && g.wealth(q) > bestW) { best = q; bestW = g.wealth(q); }
    }
    return best;
  }

  /** The squares along the road ahead of `q` (no turning back) up to `max` steps, with their distance. */
  ahead(g: Game, q: Player, max: number, see: (n: BoardNode, d: number) => void) {
    let front = [{ at: q.node, from: q.lastNode }];
    const seen = new Set<number>([q.node]);
    for (let d = 1; d <= max && front.length; d++) {
      const next: { at: number; from: number }[] = [];
      for (const { at, from } of front) for (const id of g.node(at).adjacent) {
        if (!id || id === from || seen.has(id)) continue;
        seen.add(id); next.push({ at: id, from: at }); see(g.node(id), d);
      }
      front = next;
    }
  }

  /**
   * The dice of a turn: 計程車券 (5 dice, on oneself this turn or put on by a rival for this one), 確變骰子 (one more
   * die, one dropped); news 計程車大罷工: 1 die (a taxi put on someone waits for the strike to end).
   */
  *rollDice(g: Game, p: Player): Flow<number[] | undefined> {
    const strike = this.mod('taxistrike');
    if (!strike && (this.s.taxi?.[p.id] ?? 0) > 0) {
      this.s.taxi[p.id] = 0;
      yield { t: 'fx', kind: 'kb-taxi-ride', p: p.id };
      return Array.from({ length: 5 }, () => g.rng.rand() % 6 + 1);
    }
    const t = this.s.roll[p.id];
    if (!t && !strike) return undefined;
    this.s.roll[p.id] = 0;
    if (t === T_TAXI && !strike) return Array.from({ length: 5 }, () => g.rng.rand() % 6 + 1);
    const n = this.mod('taxistrike') ? 1 : p.dice;
    if (t !== T_KAKUHEN) return Array.from({ length: n }, () => g.rng.rand() % 6 + 1);
    const vals = Array.from({ length: n + 1 }, () => g.rng.rand() % 6 + 1);
    let drop: number;
    if (g.isHuman(p)) {
      // The dice as faces: the player taps the ones to keep (n of n + 1, screen kb-dice-keep); the other is dropped.
      const a = (yield ask({ t: 'kb-dice-keep', p: p.id, values: vals, keep: vals.length - 1 } as never)) as unknown;
      const kept = Array.isArray(a) ? [...new Set(a.map(Number).filter(i => i >= 0 && i < vals.length))] : [];
      drop = kept.length === vals.length - 1 ? vals.findIndex((_, i) => !kept.includes(i)) : 0;
    } else {
      let best = -Infinity; drop = 0;
      vals.forEach((v, i) => { const s = this.landingScore(g, p, vals.reduce((a, b) => a + b, 0) - v); if (s > best) { best = s; drop = i; } });
    }
    yield { t: 'fx', kind: 'kb-kakuhen', p: p.id, data: { values: vals, drop } };
    return vals.filter((_, i) => i !== drop);
  }

  /** How good a landing `steps` ahead looks to a computer (its own land, free land, the pads: good; a rival's: bad). */
  landingScore(g: Game, p: Player, steps: number): number {
    let from = p.lastNode, at = p.node;
    for (let i = 0; i < steps; i++) {
      const n = g.node(at), ways = n.adjacent.filter(a => a && a !== from);
      const nx = g.forks.isFork(at) ? g.forks.follow(p.id, at, from) : ways[0] ?? from;
      from = at; at = nx;
    }
    const n = g.node(at), land = landOf(g.board, n), f = facilityOf(g.board, n), owner = land ? land.owner : f ? f.owner : -1;
    if (owner === 0 || owner === p.id + 1) return 2;
    if (owner > 0) return -1 - (land ? land.level : f ? f.level : 0);
    if (n.event === 4) return this.s.gang.holder === p.id ? -10 : 0;
    return n.event === EV_PACHINKO || n.event === EV_PACHISLOT || (n.event >= 10 && n.event <= 12) ? 1 : 0;
  }

  // ---------------------------------------------------------------- news and fate (§6)

  *news(g: Game, p: Player): Flow<boolean> {
    for (let i = 0; i < KB_NEWS.length; i++) {
      const c = KB_NEWS[this.s.news.deck[this.s.news.next]];
      this.s.news.next = (this.s.news.next + 1) % KB_NEWS.length;
      if (yield* this.runNews(g, p, c)) return true;
    }
    return true;
  }

  *fate(g: Game, p: Player): Flow<boolean> {
    for (let i = 0; i < KB_FATE.length; i++) {
      const c = KB_FATE[this.s.fate.deck[this.s.fate.next]];
      this.s.fate.next = (this.s.fate.next + 1) % KB_FATE.length;
      if (yield* this.runFate(g, p, c)) return true;
    }
    return true;
  }

  /** The board (news / fate box) with the card's own picture (maps/remake/events/<id>.webp). */
  *board(_g: Game, p: Player, c: KbCard, text: string, node?: number): Flow {
    const idx = KB_CARDS.indexOf(c);
    const data: Record<string, unknown> = { id: KB_ID_BASE + idx, text, local: c.id, city: KB_NAME };
    if (c.kind === 'news') data.category = c.category;
    yield { t: 'fx', kind: c.kind, p: p.id, ...(node ? { node } : {}), data };
  }

  *result(g: Game, p: Player, c: KbCard, fx: string, lines: ResultLine[], extra: Record<string, unknown> = {}): Flow {
    if (g.over) return;
    const idx = KB_CARDS.indexOf(c);
    yield { t: 'fx', kind: 'event-result', p: p.id, data: { src: c.kind, id: KB_ID_BASE + idx, fx, title: c.kind === 'news' ? c.category : '命運', head: c.head, lines, tag: KB_NAME, local: c.id, ...(c.kind === 'fate' ? { focus: [p.id] } : {}), ...extra } };
  }

  private fill(text: string, v: Record<string, string | number>): string {
    return text.replace(/\{(\w+)\}/g, (_, k) => (v[k] === undefined ? '' : typeof v[k] === 'number' ? fmt(v[k] as number) : String(v[k])));
  }

  /** Runs one news card; false when it has nothing to act on (the next card is read, as the originals' preconditions). */
  *runNews(g: Game, p: Player, c: KbCard): Flow<boolean> {
    const F = g.priceIndex, s = this.s, b = g.board, all = g.living();
    const shops = (t: number) => b.facilities.filter(f => f.owner && f.level >= 1 && f.type === t);
    const days = (k: string, d: number) => { s.mods[k] = Math.max(s.mods[k] ?? 0, d); };
    const show = (text = c.text) => this.board(g, p, c, this.fill(text, {}));
    switch (c.id) {
      case 'kb-n-matsuri': yield* show(); days('matsuri', 3); yield* this.result(g, p, c, 'bonus', [{ text: '居酒屋3天收費×2' }]); return true;
      case 'kb-n-hygiene': {
        const list = shops(10); if (!list.length) return false;
        yield* this.board(g, p, c, this.fill(c.text, { amount: 2 * this.rate(list[0]) }));
        const lines: ResultLine[] = [];
        for (const f of list) { const o = g.players[f.owner - 1]; lines.push({ p: o.id, text: `${f.name}居酒屋罰款`, amount: -(yield* this.fine(o, 2 * this.rate(f), '衛生罰款')) }); }
        yield* this.result(g, p, c, 'fine', lines, { refs: list.map(f => f.id + 4000) }); return true;   // refs: the camera (UI only)
      }
      case 'kb-n-award': {
        const f = shops(11).sort((a, b2) => b2.level - a.level)[0]; if (!f) return false;
        const o = g.players[f.owner - 1], amount = 10000 * F;
        yield* this.board(g, p, c, this.fill(c.text, { owner: g.name(o.id), shop: `${f.name}陪酒店`, amount }));
        g.gain(o, amount, 0); yield* this.result(g, p, c, 'award', [{ p: o.id, text: '獎金', amount }], { refs: [f.id + 4000] }); return true;
      }
      case 'kb-n-newmachine': yield* show(); days('newmachine', 3); yield* this.result(g, p, c, 'bonus', [{ text: '柏青哥3天易中獎' }]); return true;
      case 'kb-n-setting6': yield* show(); days('setting6', 3); yield* this.result(g, p, c, 'bonus', [{ text: '拉霸3天易中BIG' }]); return true;
      case 'kb-n-gangwar': {
        if (s.gang.holder < 0 && !s.gang.node) return false;
        yield* show(); const h = s.gang.holder; this.gangLeaves();
        if (h >= 0) yield { t: 'fx', kind: 'kb-gang', p: h, data: { on: false } };
        yield* this.result(g, p, c, 'release', [{ ...(h >= 0 ? { p: h } : {}), text: '黑幫離開了' }]); return true;
      }
      case 'kb-n-touts': yield* show(); s.tout.gone = 5; yield* this.result(g, p, c, 'none', [{ text: '拉客仔消失 5 天' }]); return true;
      case 'kb-n-kaiju': yield* this.board(g, p, c, this.fill(c.text, { amount: 20 })); for (const q of all) { q.points = (q.points + 20) & 0xffff; yield { t: 'points', p: q.id, amount: 20 }; } yield* this.result(g, p, c, 'gain', all.map(q => ({ p: q.id, text: '點券 +20' }))); return true;
      case 'kb-n-tower': {
        const owned = b.facilities.filter(f => f.owner); if (!owned.length) return false;
        yield* this.board(g, p, c, this.fill(c.text, { amount: 2000 * F }));
        const by = new Map<number, number>(); for (const f of owned) by.set(f.owner - 1, (by.get(f.owner - 1) ?? 0) + 2000 * F);
        const lines: ResultLine[] = []; for (const [q, a] of by) { g.gain(g.players[q], a, 0); lines.push({ p: q, text: '開幕紀念', amount: a }); }
        yield* this.result(g, p, c, 'gain', lines); return true;
      }
      case 'kb-n-typhoon': yield* show(); days('typhoon', 2); yield* this.result(g, p, c, 'typhoon', [{ text: '2天店收費減半' }]); return true;
      case 'kb-n-tax': {
        yield* show(); const lines: ResultLine[] = [];
        for (const q of all) { const a = Math.min(Math.trunc(q.bank * 0.05), 20000 * F); if (a > 0) { yield* g.transfer(q.id, -1, a, 4, '消費稅'); lines.push({ p: q.id, text: '繳稅', amount: -a }); } }
        yield* this.result(g, p, c, 'tax', lines.length ? lines : [{ text: '沒有人有存款' }]); return true;
      }
      case 'kb-n-tourists': yield* show(); days('tourists', 3); yield* this.result(g, p, c, 'bonus', [{ text: '3天過路費×1.5' }]); return true;
      case 'kb-n-bathclose': {
        const list = shops(12); if (!list.length) return false;
        yield* show(); for (const f of list) s.closed[f.id] = Math.max(s.closed[f.id] ?? 0, 2);
        yield* this.result(g, p, c, 'fine', list.map(f => ({ p: f.owner - 1, text: `${f.name}泡泡浴停業兩天` })), { refs: list.map(f => f.id + 4000) }); return true;
      }
      case 'kb-n-valentine': yield* show(); days('valentine', 3); yield* this.result(g, p, c, 'bonus', [{ text: '情人酒店3天×2' }]); return true;
      case 'kb-n-subsidy': {
        const q = [...all].sort((a, b2) => g.wealth(a) - g.wealth(b2))[0]; if (!q) return false;
        const amount = 20000 * F; yield* this.board(g, p, c, this.fill(c.text, { name: g.name(q.id), amount }));
        g.gain(q, amount, 0); yield* this.result(g, p, c, 'subsidy', [{ p: q.id, text: '振興補助', amount }]); return true;
      }
      case 'kb-n-viral': {
        const list = [...shops(10), ...shops(11)].filter(f => f.level < 5); if (!list.length) return false;
        const f = list[this.stream(0x7172, p.id).below(list.length)], o = g.players[f.owner - 1];
        yield* this.board(g, p, c, this.fill(c.text, { owner: g.name(o.id), shop: `${f.name}${SHOP_NAMES[f.type]}` }));
        f.level += 1; yield { t: 'board' }; yield* this.result(g, p, c, 'award', [{ p: o.id, text: `${f.name}${SHOP_NAMES[f.type]}升到${f.level}級` }], { refs: [f.id + 4000] }); return true;
      }
      case 'kb-n-torinoichi': {
        yield* show(); const lines: ResultLine[] = [];
        for (const q of all) { const id = yield* g.cards.receiveRandom(q); if (id) { yield { t: 'fx', kind: 'card-received', p: q.id, data: { card: id } }; lines.push({ p: q.id, text: '得到一張卡片' }); } }
        yield* this.result(g, p, c, 'gain', lines.length ? lines : [{ text: '卡片已經發完了' }]); return true;
      }
      case 'kb-n-goldenfire': {
        const lots = b.lands.filter(l => l.name === '黃金街' && l.level > 0); if (!lots.length) return false;
        yield* show(); for (const l of lots) l.level -= 1; yield { t: 'board' };
        yield* this.result(g, p, c, 'explosion', lots.map(l => ({ p: l.owner - 1, text: '黃金街的房子降一級' })), { refs: lots.map(l => l.id + 2000) }); return true;
      }
      case 'kb-n-taxistrike': yield* show(); days('taxistrike', 3); yield* this.result(g, p, c, 'jam', [{ text: '3天只擲1顆骰子' }]); return true;
      case 'kb-n-blackout': yield* show(); days('blackout', 3); yield* this.result(g, p, c, 'none', [{ text: '3天過路費減半' }]); return true;
      case 'kb-n-exchange': yield* show(); days('exchange', 3); yield* this.result(g, p, c, 'bonus', [{ text: '景品3天七折' }]); return true;
      case 'kb-n-ordinance': {
        const h = s.gang.holder; if (h < 0) return false;
        // The holder is arrested as at the prison square (§4.1: 違反暴力團對策法, the takings confiscated, prison).
        const q = g.players[h], take = Math.min(s.gang.take, Math.max(0, q.cash + q.bank));
        yield* show(); yield* this.arrest(g, q, true);
        yield* this.result(g, p, c, 'prison', [{ p: h, text: `沒收保護費・坐牢${GANG_PRISON_DAYS}天`, amount: -take }], { focus: [h] }); return true;
      }
      case 'kb-n-hostweek': yield* show(); days('hostweek', 3); yield* this.result(g, p, c, 'bonus', [{ text: '陪酒店3天女客免費' }]); return true;
      case 'kb-n-raid': {
        // The grown-ups on the board each were there two times in three (at least one); a god's luck, 免罪卡 / 嫁禍卡
        // as on any prison (06 §2.2). A child is never at an underground casino.
        const adults = all.filter(q => !this.minor(q) && !g.offRoad(q));
        if (!adults.length) return false;
        const r = this.stream(0x4a1d, p.id);
        let caught = adults.filter(() => r.below(3) < 2);
        if (!caught.length) caught = [adults[r.below(adults.length)]];
        yield* show();
        const lines: ResultLine[] = [];
        for (const q of caught) lines.push(...(yield* this.jail(g, q, 2)));
        yield* this.result(g, p, c, 'prison', lines, { focus: caught.map(q => q.id) }); return true;
      }
      case 'kb-n-stocks': {
        // The game centre's stock (slot 4: ＴＡＩＴＯ on this map, editor/city_companies.py; the Japan table's ＳＥＧＡ).
        const slot = 4, name = g.stocks.stocks[slot]?.name;
        if (!name) return false;
        yield* this.board(g, p, c, this.fill(c.text, { stock: name })); g.stocks.forceLimit(slot, true, 2);
        yield* this.result(g, p, c, 'stock-up', [{ text: `${name}漲停兩天` }]); return true;
      }
    }
    return false;
  }

  /** Runs one fate card for player `p` (a child gets its `kid` text, §3). */
  *runFate(g: Game, p: Player, c: KbCard): Flow<boolean> {
    const F = g.priceIndex, kid = this.minor(p), me = p.id + 1;
    const text = (v: Record<string, string | number> = {}) => this.fill(kid && c.kid ? c.kid : c.text, { host: this.female(p) ? '牛郎' : '小姐', ...v });
    const show = (v: Record<string, string | number> = {}) => this.board(g, p, c, text(v));
    const gain = function* (this: KabukichoRules, base: number): Flow {
      const r = yield* g.objects.luck(p, 0, 0);
      if (r === 1) { yield* this.result(g, p, c, 'cursed', [{ p: p.id, text: `${g.objects.godName(p) || '神明'}作祟，${fmt(base)}元泡湯了` }]); return; }
      const a = r === 2 ? base * 2 : base;
      g.gain(p, a, 1); yield { t: 'pay', from: -1, to: p.id, amount: a, reason: c.head, quiet: true };
      yield* this.result(g, p, c, 'gain', [{ p: p.id, text: r === 2 ? `${g.objects.godName(p) || '神明'}保佑，加倍` : c.head, amount: a }], { line: 'gain', amount: a });
    }.bind(this);
    const lose = function* (this: KabukichoRules, base: number): Flow {
      const r = yield* g.objects.luck(p, 0, 1);
      if (r === 1) { yield* this.result(g, p, c, 'blessed', [{ p: p.id, text: `${g.objects.godName(p) || '神明'}保佑，免付` }]); return; }
      const a = Math.min(r === 2 ? base * 2 : base, p.cash + p.bank);
      if (a > 0) yield* g.transfer(p.id, -1, a, 0, c.head);
      yield* this.result(g, p, c, 'fine', [{ p: p.id, text: c.head, amount: -a }], { line: 'loss', amount: a });
    }.bind(this);
    const misfortune = function* (this: KabukichoRules): Flow<number> {
      const r = yield* g.objects.luck(p, 1, 1);
      if (r === 1) { yield* this.result(g, p, c, 'blessed', [{ p: p.id, text: `${g.objects.godName(p) || '神明'}保佑，逃過此劫` }]); return 0; }
      return r === 2 ? 2 : 1;
    }.bind(this);
    switch (c.id) {
      case 'kb-f-tamacard': yield* show(); this.s.tama[p.id] += 500; yield* this.result(g, p, c, 'gain', [{ p: p.id, text: '柏青哥存玉 +500 顆' }]); return true;
      case 'kb-f-classmate': yield* show({ amount: 3000 * F }); yield* gain(3000 * F); return true;
      case 'kb-f-tout': yield* show(); yield* this.drag(g, p); return true;
      case 'kb-f-drunk': case 'kb-f-slip': {
        yield* show(); const r = yield* misfortune(); if (!r) return true;
        const rng = this.stream(0xd0c, p.id); const d = yield* this.hospitalWheel(p, rng);
        yield* this.result(g, p, c, d ? 'hospital' : 'none', [{ p: p.id, text: d ? `住院${d}天` : '轉盤停在 0：沒事' }]); return true;
      }
      case 'kb-f-wallet': yield* show({ amount: 5000 * F }); yield* gain(5000 * F); return true;
      case 'kb-f-kaiju': yield* show({ amount: 2000 * F }); yield* lose(2000 * F); return true;
      case 'kb-f-parttime': yield* show({ amount: 4000 * F }); yield* gain(4000 * F); return true;
      case 'kb-f-gang': {
        if (!this.s.gang.node || this.s.gang.holder >= 0) return false;
        yield* show(); yield* this.possess(g, p);
        yield* this.result(g, p, c, 'none', [{ p: p.id, text: '黑幫附身 7 天' }]); return true;
      }
      // Prison (the user 2026-10-18: as often as hospital; children too, with their own reason): 鬧事 2 days, 賣假名牌
      // and 賭博現行犯 3, 出千 4, 酒後打架 5; a god's luck, 免罪卡 / 嫁禍卡 as the original's prison fates (06 §2.2).
      case 'kb-f-trouble': case 'kb-f-fake': case 'kb-f-casino': case 'kb-f-cheat': case 'kb-f-fight': {
        yield* show(); const r = yield* misfortune(); if (!r) return true;
        const days = ({ 'kb-f-trouble': 2, 'kb-f-fake': 3, 'kb-f-casino': 3, 'kb-f-cheat': 4, 'kb-f-fight': 5 } as Record<string, number>)[c.id] * r;
        const lines = yield* this.jail(g, p, days, false);
        yield* this.result(g, p, c, lines.some(l => l.text.startsWith('坐牢')) ? 'prison' : 'blessed', lines, { focus: [...new Set(lines.map(l => l.p ?? p.id))] }); return true;
      }
      case 'kb-f-photo': yield* show(); p.points = (p.points + 30) & 0xffff; yield { t: 'points', p: p.id, amount: 30 }; yield* this.result(g, p, c, 'gain', [{ p: p.id, text: '點券 +30' }]); return true;
      case 'kb-f-lottery': {
        // The exclusive goods come only from the prize counter (the user 2026-10-18): 50 點券 instead.
        yield* show({ amount: 50 }); p.points = Math.min(0xffff, p.points + 50);
        yield* this.result(g, p, c, 'gain', [{ p: p.id, text: '點券 +50' }]); return true;
      }
      case 'kb-f-taxi': {
        const pads = g.board.nodes.filter(n => n.event === EV_PACHINKO || n.event === EV_PACHISLOT);
        if (!pads.length) return false;
        const n = pads[this.stream(0x7a1, p.id).below(pads.length)];
        yield* show(); p.lastNode = p.node; p.node = n.id; yield { t: 'teleport', p: p.id, node: n.id };
        yield* g.land(p); return true;   // stops there (the pad's flow, as on a stop)
      }
      case 'kb-f-lovehotel': {
        if (kid) { yield* show(); yield* this.result(g, p, c, 'none', [{ p: p.id, text: '繞了一圈又回到原地' }]); return true; }
        const list = g.board.facilities.filter(f => f.owner && f.owner !== me && f.level >= 1 && f.type === 13);
        if (!list.length) return false;
        const here = g.node(p.node);
        const f = list.sort((a, b2) => Math.hypot(a.x - here.x, a.y - here.y) - Math.hypot(b2.x - here.x, b2.y - here.y))[0], n = this.facilityNode(f)!;
        yield* show(); p.lastNode = p.node; p.node = n.id; yield { t: 'teleport', p: p.id, node: n.id };
        void f; yield* g.land(p); return true;   // stops there, as on a stop: the stay (§2.6), then the gods' effect
      }
      case 'kb-f-lasttrain': {
        yield* show(); const r = yield* misfortune(); if (!r) return true;
        p.stay = r; yield* this.result(g, p, c, 'jam', [{ p: p.id, text: `停留${r}回合` }]); return true;
      }
      case 'kb-f-referral': {
        const others = g.living().filter(q => q.id !== p.id);
        yield* show({ amount: 1000 * F }); const lines: ResultLine[] = [];
        for (const q of others) { const a = yield* g.transfer(q.id, p.id, Math.min(1000 * F, q.cash + q.bank), 0, '介紹費'); lines.push({ p: q.id, text: '介紹費', amount: -a }); }
        yield* this.result(g, p, c, 'gain', lines); return true;
      }
      case 'kb-f-sign': {
        const lots = g.board.lands.filter(l => l.owner === me && l.level > 0);
        if (!lots.length) return false;
        yield* show(); const r = yield* misfortune(); if (!r) return true;
        const l = lots[this.stream(0x5197, p.id).below(lots.length)]; l.level -= 1; yield { t: 'board' };
        yield* this.result(g, p, c, 'demolish', [{ p: p.id, text: `${l.name}的房子降一級` }], { refs: [l.id + 2000] }); return true;
      }
      case 'kb-f-vip': yield* show(); this.s.vip[p.id] = 1; yield* this.result(g, p, c, 'gain', [{ p: p.id, text: '下次進店只付一倍' }]); return true;
      case 'kb-f-omikuji': { yield* show(); const ok = yield* g.cards.take(p, 21); if (ok) yield { t: 'fx', kind: 'card-received', p: p.id, data: { card: 21 } }; yield* this.result(g, p, c, 'blessed', [{ p: p.id, text: ok ? '得到免罪卡' : '卡片已滿' }]); return true; }
      case 'kb-f-flyers': yield* show(); p.points = (p.points + 10) & 0xffff; yield { t: 'points', p: p.id, amount: 10 }; g.gain(p, 1000 * F, 1); yield* this.result(g, p, c, 'gain', [{ p: p.id, text: '點券 +10', amount: 1000 * F }]); return true;
      case 'kb-f-gift': { yield* show(); const id = yield* g.cards.receiveRandom(p); if (id) yield { t: 'fx', kind: 'card-received', p: p.id, data: { card: id } }; yield* this.result(g, p, c, 'gain', [{ p: p.id, text: id ? '得到一張卡片' : '卡片已經發完了' }]); return true; }
      case 'kb-f-skimming': { const a = Math.min(Math.trunc(p.bank * 0.08), 20000 * F); if (a <= 0) return false; yield* show(); yield* lose(a); return true; }
    }
    return false;
  }
}

/** A tool's name and price for the counter (the original 1..8 from the tool table). */
function toolInfo(id: number): { name: string; price: number } | undefined {
  const t = KB_TOOLS.find(x => x.id === id);
  if (t) return t;
  const ORIG: Record<number, [string, number]> = { 1: ['機器娃娃', 15], 2: ['路障', 30], 3: ['地雷', 25], 4: ['定時炸彈', 25], 5: ['機車', 80], 6: ['汽車', 150], 7: ['飛彈', 100], 8: ['遙控骰子', 30] };
  return ORIG[id] ? { name: ORIG[id][0], price: ORIG[id][1] } : undefined;
}

/** The rules of a game on 歌舞伎町, or undefined. */
export const kbRules = (g: Game | null | undefined): KabukichoRules | undefined => (g?.rules instanceof KabukichoRules ? g.rules : undefined);

MAP_RULES[KB_MAP] = g => new KabukichoRules(g);
