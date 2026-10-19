/**
 * 大富豪模式 local news and fate (docs/rules/18, the remake's addition; a normal game never comes here).
 *
 * When a player stops on a news or fate square in a tycoon city (or the magic house draws fate), `regionalDraw` decides
 * first whether this draw is one of the city's own events:
 *
 *   1. With LOCAL_CHANCE (40 %) the draw is local, else the world deck is read as before (one nationwide deck, 18 §2).
 *   2. A local draw is bad with the city's BAD_SHARE (東京 60 %, 大阪 55 %, 九州 50 %, 札幌 40 %, 沖繩 30 %), else good.
 *   3. Among that tone's events of the city and kind whose conditions hold today (month, today's weather, something to
 *      act on), one is taken uniformly; none → the other tone; none at all → the world deck after all.
 *
 * Every choice here (local or not, the tone, the event, the lots and players it picks, a drawn card) comes from the
 * module's own stream: a hash of the city's seed, the day, the player, the kind and how many draws that player made
 * that day. The city's rand() is not read for any of it, so the original deck and its rules run on unchanged; only the
 * shared mechanisms an event goes through use the city's stream as they always do (the god luck check of fate money
 * and misfortunes, the computer's frame card, a full hospital's transfer). The weather is read from ui/weather.ts
 * `weatherOf`, a pure function of the city's seed, map and date (the one the calendar shows; the display setting and
 * the debug override do not count), so it never draws random numbers either.
 */
import { month as monthOf } from '../date';
import type { Flow } from '../flow';
import type { Game } from '../game';
import { Rng } from '../rng';
import type { Player } from '../types';
import { weatherOf } from '../../ui/weather';
import { CARDS, cardName } from './cards';
import { MAX_HELD, TOOLS } from './tools';
import type { BoardFace, EventResult, ResultLine } from './events';
import {
  BAD_SHARE, LOCAL_CHANCE, REGIONAL_EVENTS, REGIONAL_ID_BASE,
  type FateEffect, type NewsEffect, type RegionalEvent, type RegionalKind, type Tone,
} from './regional-data';

export { REGIONAL_EVENTS, BAD_SHARE, LOCAL_CHANCE, REGIONAL_ID_BASE };

/** Switch for tests and balance runs (an all-AI world with and without the local events). */
export const regional: {
  enabled: boolean;
  /** Local events run so far (statistics for tests). */
  fired: number;
  /** Balance runs: told every event with the change of all players' money and building levels it made. */
  observe?: (e: RegionalEvent, money: number, levels: number) => void;
} = { enabled: true, fired: 0 };

const CITY: Record<number, string> = { 100: '東京', 101: '大阪', 102: '札幌', 103: '九州', 104: '沖繩' };

/** The event behind a board id (1000 + index), for the screens. */
export function regionalEvent(id: number): RegionalEvent | undefined {
  return id >= REGIONAL_ID_BASE ? REGIONAL_EVENTS[id - REGIONAL_ID_BASE] : undefined;
}

// ------------------------------------------------------------------ the module's own random stream

/** 32-bit mix (murmur3 finaliser over the values), independent of every other stream. */
function mix(...values: number[]): number {
  let h = 0x2f6b9a1d;
  for (const v of values) {
    h = Math.imul(h ^ (v >>> 0), 0xcc9e2d51) >>> 0;
    h = ((h << 15) | (h >>> 17)) >>> 0;
    h = (Math.imul(h, 0x1b873593) + 0xe6546b64) >>> 0;
  }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** Draws made today per city engine: `${player}:${kind}` → count (a new day starts over; nothing to save). */
const drawsToday = new WeakMap<Game, { day: number; n: Map<string, number> }>();

/** The stream of one draw: city seed, day, player, kind and the player's draws of that kind today. */
export function drawStream(g: Game, p: Player, kind: RegionalKind): Rng {
  let d = drawsToday.get(g);
  if (!d || d.day !== g.daysElapsed) { d = { day: g.daysElapsed, n: new Map() }; drawsToday.set(g, d); }
  const key = `${p.id}:${kind}`, k = d.n.get(key) ?? 0;
  d.n.set(key, k + 1);
  return new Rng(mix(g.settings.seed, g.settings.mapId, g.daysElapsed, p.id, kind === 'news' ? 1 : 2, k));
}

const unit = (r: Rng) => r.rand() / 32768;

// ------------------------------------------------------------------ choosing

/** The city's local events of a kind and tone. */
export function pool(mapId: number, kind: RegionalKind, tone?: Tone): RegionalEvent[] {
  return REGIONAL_EVENTS.filter(e => e.map === mapId && e.kind === kind && (!tone || e.tone === tone));
}

/** Today's weather of a city as the calendar shows it (null on a map without weather). */
export function cityWeather(g: Game) {
  return weatherOf(g.settings.seed, g.settings.mapId, g.date)?.kind ?? null;
}

/** Whether an event can happen now for player `p` (its month, today's weather, and something for it to act on). */
export function eligible(g: Game, p: Player, e: RegionalEvent): boolean {
  if (e.when?.months && !e.when.months.includes(monthOf(g.date))) return false;
  if (e.when?.weather) { const w = cityWeather(g); if (!w || !e.when.weather.includes(w)) return false; }
  const me = p.id + 1, b = g.board;
  if (e.kind === 'fate') {
    switch (e.effect.t) {
      case 'upgrade': return upgradable(g, me).length > 0;
      case 'repair': return levelsOf(g, me) > 0;
      case 'lose-card': return p.cards.length > 0;
      case 'points': return e.effect.amount > 0 || p.points > 0;
      case 'card': return cardPool(g).length > 0;
      default: return true;
    }
  }
  switch (e.effect.t) {
    case 'stay': return onRoad(g, e.effect.who).length > 0;
    case 'per-lot': case 'per-level': case 'value-tax': return builtRefs(g).length > 0 || (e.effect.t === 'value-tax' && b.lands.some(l => l.owner));
    case 'facility': { const hotels = e.effect.hotels; return b.facilities.some(x => x.owner && x.level && (!hotels || x.type === 1)); }
    case 'damage': case 'area': case 'typhoon': return builtRefs(g).length > 0;
    case 'top-owner': return b.lands.some(l => l.owner) || b.facilities.some(x => x.owner);
    case 'renovate': return upgradable(g).length > 0;
    case 'company': return b.companies.length > 0;
    case 'street': return b.lands.length > 0;
    case 'everyone': case 'cards-all': return g.locals().length > 0 && (e.effect.t !== 'cards-all' || cardPool(g).length > 0);
    case 'one-hospital': return onRoad(g, 'all').length > 0;
    default: return true;
  }
}

/**
 * The choice of 18 §2 for one draw: the local event, or null for the world deck. `rng` is the draw's stream; the
 * same stream then picks inside the event.
 */
export function choose(g: Game, p: Player, kind: RegionalKind, rng: Rng): RegionalEvent | null {
  const mapId = g.settings.mapId;
  if (!(mapId in BAD_SHARE)) return null;
  if (unit(rng) >= LOCAL_CHANCE) return null;
  const tone: Tone = unit(rng) < BAD_SHARE[mapId] ? 'bad' : 'good';
  for (const t of [tone, tone === 'bad' ? 'good' : 'bad'] as Tone[]) {
    const ok = pool(mapId, kind, t).filter(e => eligible(g, p, e));
    if (ok.length) return ok[rng.below(ok.length)];
  }
  return null;
}

/**
 * Hook of Events.news / Events.fate in 大富豪模式: runs a local event and returns true, or false to let the world
 * deck be read.
 */
export function* regionalDraw(g: Game, p: Player, kind: RegionalKind): Flow<boolean> {
  if (!regional.enabled || !g.world) return false;
  const rng = drawStream(g, p, kind);
  const e = choose(g, p, kind, rng);
  if (!e) return false;
  regional.fired++;
  const look = regional.observe ? () => [g.players.reduce((x, q) => x + q.cash + q.bank, 0), g.board.lands.reduce((x, l) => x + l.level, 0)] : null;
  const before = look?.();
  yield* runEvent(g, p, e, rng);
  if (look && before) { const after = look(); regional.observe!(e, after[0] - before[0], after[1] - before[1]); }
  return true;
}

/** Shows and applies one local event for player `p` (who stopped on the square), picking with `rng`. */
export function* runEvent(g: Game, p: Player, e: RegionalEvent, rng: Rng): Flow {
  if (e.kind === 'fate') yield* runFate(g, p, e, e.effect, rng);
  else yield* runNews(g, p, e, e.effect, rng);
}

// ------------------------------------------------------------------ helpers on this city's board

/** Refs of the built properties here (lands 2001.., facilities 4001..). */
function builtRefs(g: Game): number[] {
  const b = g.board;
  return [...b.lands.filter(l => l.level > 0).map(l => l.id + 2000), ...b.facilities.filter(f => f.level > 0).map(f => f.id + 4000)];
}
/** Lots (and facilities) here that a free upgrade can raise, of `owner` (1-based) or of anyone. */
function upgradable(g: Game, owner?: number): number[] {
  const b = g.board;
  return [
    ...b.lands.filter(l => l.owner && (!owner || l.owner === owner) && l.level > 0 && l.level < 5 && !l.chain).map(l => l.id + 2000),
    ...b.facilities.filter(f => f.owner && (!owner || f.owner === owner) && f.level > 0 && f.level < (f.type === 0 || f.type === 3 ? 1 : 5)).map(f => f.id + 4000),
  ];
}
function levelsOf(g: Game, owner: number): number {
  const b = g.board;
  return b.lands.filter(l => l.owner === owner).reduce((s, l) => s + (l.chain ? 1 : l.level), 0) + b.facilities.filter(f => f.owner === owner).reduce((s, f) => s + f.level, 0);
}
function builtCount(g: Game, owner: number): number {
  const b = g.board;
  return b.lands.filter(l => l.owner === owner && l.level > 0).length + b.facilities.filter(f => f.owner === owner && f.level > 0).length;
}
function valueHere(g: Game, owner: number): number {
  const b = g.board;
  return b.lands.filter(l => l.owner === owner).reduce((s, l) => s + l.price + (l.chain ? 1 : l.level) * l.perLevel, 0)
    + b.facilities.filter(f => f.owner === owner).reduce((s, f) => s + f.price + f.level * f.fees[0], 0);
}
/** Local players on the road (not in hotel, abroad, hospital, prison, nor 在路上). */
function onRoad(g: Game, who: 'all' | 'walk' | 'ride'): Player[] {
  return g.locals().filter(q => q.placed && !g.offRoad(q) && (who === 'all' || (q.traffic === 0) === (who === 'walk')));
}
function refName(g: Game, ref: number): string { return ref < 4000 ? g.board.lands[ref - 2001].name : g.board.facilities[ref - 4001].name; }
function refOwner(g: Game, ref: number): number | undefined {
  const o = ref < 4000 ? g.board.lands[ref - 2001].owner : g.board.facilities[ref - 4001].owner;
  return o ? o - 1 : undefined;
}
function refLevel(g: Game, ref: number): number { return ref < 4000 ? g.board.lands[ref - 2001].level : g.board.facilities[ref - 4001].level; }
function nodeOf(g: Game, ref: number): number | undefined { return g.board.nodes.find(n => n.ref === ref)?.id; }
/** The card pool weighted by the copies left (04 §4.1), drawn with the module's stream. */
function cardPool(g: Game): number[] {
  const out: number[] = [];
  for (let i = 0; i < CARDS.length; i++) for (let k = 0; k < (g.cards.remaining[i] ?? 0) && out.length < 128; k++) out.push(i + 1);
  return out;
}
function pickN<T>(xs: T[], n: number, rng: Rng): T[] {
  const left = [...xs], out: T[] = [];
  while (out.length < n && left.length) out.push(left.splice(rng.below(left.length), 1)[0]);
  return out;
}
/** The text with its placeholders: {amount}, {s<slot>}, {street}, {lot}. */
function fill(g: Game, text: string, v: { amount?: number; street?: string; lot?: string }): string {
  return text
    .replace(/\{amount\}/g, String(v.amount ?? ''))
    .replace(/\{s(\d+)\}/g, (_, s) => g.stocks.stocks[Number(s)]?.name ?? '在地企業')
    .replace(/\{street\}/g, v.street ?? '')
    .replace(/\{lot\}/g, v.lot ?? '');
}

// ------------------------------------------------------------------ presentation helpers

function boardId(e: RegionalEvent): number { return REGIONAL_ID_BASE + REGIONAL_EVENTS.indexOf(e); }

/** The board (news / fate picture box) with the event's own picture (`local`) and the city's name. */
function* show(g: Game, p: Player, e: RegionalEvent, text: string, ref?: number, faces?: BoardFace[]): Flow {
  const node = ref ? nodeOf(g, ref) : undefined;
  const data: Record<string, unknown> = { id: boardId(e), text, local: e.id, city: CITY[e.map] ?? '' };
  if (e.kind === 'news') data.category = e.category;
  if (faces?.length) data.faces = faces;
  yield { t: 'fx', kind: e.kind, p: p.id, ...(node ? { node } : {}), data };
}

/** The result box (the same `event-result` as the originals: ticker line, map effect, the victim's line). */
function* result(g: Game, p: Player, e: RegionalEvent, fx: string, lines: ResultLine[], o: Partial<EventResult> & { node?: number } = {}): Flow {
  if (g.over) return;
  const { node, ...rest } = o;
  const data = {
    src: e.kind, id: boardId(e), fx, title: e.kind === 'news' ? e.category : '命運', head: e.head, lines,
    tag: CITY[e.map], local: e.id, ...(e.kind === 'fate' ? { focus: [p.id] } : {}), ...rest,
  };
  yield { t: 'fx', kind: 'event-result', p: p.id, ...(node ? { node } : {}), data: data as unknown as Record<string, unknown> };
}

function luckWords(g: Game, p: Player, good: boolean, what: string): string {
  return `${g.objects.godName(p) || '神明'}${good ? '保佑' : '作祟'}，${what}`;
}

// ------------------------------------------------------------------ fate

function* runFate(g: Game, p: Player, e: RegionalEvent, fx: FateEffect, rng: Rng): Flow {
  const F = g.priceIndex;
  switch (fx.t) {
    case 'gain': {
      const base = fx.amount * F;
      yield* show(g, p, e, fill(g, e.text, { amount: base }));
      const r = yield* g.objects.luck(p, 0, 0);
      if (r === 1) { yield* result(g, p, e, 'cursed', [{ p: p.id, text: luckWords(g, p, false, `${base}元泡湯了`) }]); return; }
      const amount = r === 2 ? base * 2 : base;
      g.gain(p, amount, 1);
      yield { t: 'pay', from: -1, to: p.id, amount, reason: e.head, quiet: true };
      yield* result(g, p, e, 'gain', [{ p: p.id, text: r === 2 ? luckWords(g, p, true, '獎金加倍') : e.head, amount }], { line: 'gain', amount });
      return;
    }
    case 'fine': case 'repair': {
      const base = fx.t === 'fine' ? fx.amount * F : Math.min(fx.cap, fx.perLevel * levelsOf(g, p.id + 1)) * F;
      yield* show(g, p, e, fill(g, e.text, { amount: fx.t === 'fine' ? base : fx.perLevel * F }));
      yield* pay(g, p, e, base);
      return;
    }
    case 'hospital': case 'prison': case 'stay': {
      yield* show(g, p, e, fill(g, e.text, {}));
      const r = yield* g.objects.luck(p, 1, 1);
      if (r === 1) { yield* result(g, p, e, 'blessed', [{ p: p.id, text: luckWords(g, p, true, '逃過此劫') }]); return; }
      if (fx.t === 'stay') {
        p.stay = r === 2 ? 2 : 1;
        yield* result(g, p, e, 'jam', [{ p: p.id, text: `停留${p.stay}回合${r === 2 ? '（倒楣加倍）' : ''}` }]);
        return;
      }
      const days = fx.days * (r === 2 ? 2 : 1);
      const target = yield* g.cards.pardonOrFrame(p);
      if (target < 0) { yield* result(g, p, e, 'blessed', [{ p: p.id, text: '免罪卡生效，逃過此劫' }]); return; }
      const q = g.players[target];
      yield* g.sendTo(q, fx.t, days);
      if (g.over) return;
      const lines: ResultLine[] = [];
      if (target !== p.id) lines.push({ p: p.id, text: `用嫁禍卡嫁禍給${g.name(target)}` });
      lines.push({ p: target, text: `${fx.t === 'hospital' ? '住院' : '坐牢'}${days}天${r === 2 ? '（倒楣加倍）' : ''}` });
      yield* result(g, p, e, fx.t, lines, { focus: [target] });
      return;
    }
    case 'card': {
      yield* show(g, p, e, fill(g, e.text, {}));
      const got: number[] = [];
      for (let k = 0; k < (fx.n ?? 1); k++) {
        const ids = fx.id ? [fx.id] : cardPool(g);
        const id = ids.length ? ids[rng.below(ids.length)] : 0;
        if (!id || !(yield* g.cards.take(p, id))) continue;
        got.push(id);
        yield { t: 'fx', kind: 'card-received', p: p.id, data: { card: id } };
      }
      yield* result(g, p, e, 'blessed', got.length ? got.map(id => ({ p: p.id, text: `得到${cardName(id)}` })) : [{ p: p.id, text: '卡片沒了' }]);
      return;
    }
    case 'tool': {
      yield* show(g, p, e, fill(g, e.text, {}));
      const name = TOOLS[fx.id - 1]?.name ?? '道具';
      if (p.tools[fx.id - 1] < MAX_HELD) {
        p.tools[fx.id - 1] += 1;
        yield { t: 'fx', kind: 'tool-received', p: p.id, data: { tool: fx.id } };
        yield* result(g, p, e, 'blessed', [{ p: p.id, text: `得到${name}` }]);
      } else {
        // The tool bag is full: the tool's price in points instead (as selling it).
        const pts = TOOLS[fx.id - 1]?.price ?? 0;
        p.points = (p.points + pts) & 0xffff;
        yield { t: 'points', p: p.id, amount: pts };
        yield* result(g, p, e, 'blessed', [{ p: p.id, text: `${name}已滿，換成${pts}點券` }]);
      }
      return;
    }
    case 'points': {
      const amount = fx.amount > 0 ? fx.amount : -Math.min(p.points, -fx.amount);
      yield* show(g, p, e, fill(g, e.text, { amount: Math.abs(fx.amount) }));
      p.points = Math.max(0, Math.min(0xffff, p.points + amount));
      yield { t: 'points', p: p.id, amount };
      yield* result(g, p, e, amount >= 0 ? 'blessed' : 'cursed', [{ p: p.id, text: amount >= 0 ? `獲得${amount}點券` : `捐出${-amount}點券` }]);
      return;
    }
    case 'upgrade': {
      const refs = upgradable(g, p.id + 1);
      const ref = refs[rng.below(refs.length)];
      yield* show(g, p, e, fill(g, e.text, {}), ref);
      g.freeUpgrade(ref);
      yield { t: 'board' };
      yield* result(g, p, e, 'price-up', [{ p: p.id, text: `${refName(g, ref)}免費加蓋到${refLevel(g, ref)}級` }], { node: nodeOf(g, ref), refs: [ref] });
      return;
    }
    case 'lose-card': {
      yield* show(g, p, e, fill(g, e.text, {}));
      const r = yield* g.objects.luck(p, 1, 1);
      if (r === 1) { yield* result(g, p, e, 'blessed', [{ p: p.id, text: luckWords(g, p, true, '卡片保住了') }]); return; }
      const lost: number[] = [];
      for (let k = 0; k < (r === 2 ? 2 : 1) && p.cards.length; k++) {
        const id = p.cards[rng.below(p.cards.length)];
        g.cards.consume(p, id);
        lost.push(id);
      }
      yield* result(g, p, e, 'cursed', lost.map(id => ({ p: p.id, text: `失去${cardName(id)}` })));
      yield { t: 'fx', kind: 'lament', p: p.id, data: { slot: 3, face: 2 } };
      return;
    }
  }
}

/** A fate payment to the lottery pool (as fate 14: luck "loss" waives or doubles it; insurance refunds it). */
function* pay(g: Game, p: Player, e: RegionalEvent, base: number): Flow {
  const r = yield* g.objects.luck(p, 0, 1);
  if (r === 1) { yield* result(g, p, e, 'blessed', [{ p: p.id, text: luckWords(g, p, true, `免付${base}元`) }], { line: 'free', amount: base }); return; }
  const amount = r === 2 ? base * 2 : base;
  yield* g.transfer(p.id, -1, amount, 0, e.head, true);
  if (g.over) return;
  yield* result(g, p, e, 'fine', [{ p: p.id, text: r === 2 ? luckWords(g, p, false, '花費加倍') : e.head, amount: -amount }], { line: 'loss', amount });
  if (p.whoPlays && !g.over) yield* g.insurancePayout(p, amount);
}

// ------------------------------------------------------------------ news

function* runNews(g: Game, p: Player, e: RegionalEvent, fx: NewsEffect, rng: Rng): Flow {
  const F = g.priceIndex, b = g.board;
  const text = (v: { amount?: number; street?: string; lot?: string } = {}) => fill(g, e.text, v);
  switch (fx.t) {
    case 'stay': case 'typhoon': {
      const who = onRoad(g, fx.t === 'stay' ? fx.who : 'all');
      let ref: number | undefined;
      if (fx.t === 'typhoon') { const refs = builtRefs(g); ref = refs[rng.below(refs.length)]; }
      yield* show(g, p, e, text({ lot: ref ? refName(g, ref) : '' }), ref, who.map(q => ({ p: q.id })));
      for (const q of who) q.stay = 1;
      const lines: ResultLine[] = who.map(q => ({ p: q.id, text: '停留一回合' }));
      let owner: number | undefined;
      if (ref) {
        owner = refOwner(g, ref);
        g.damageProperty(ref, 0);
        yield { t: 'board' };
        lines.push({ p: owner, text: `${refName(g, ref)}${levelText(g, ref)}` });
      }
      const wet = cityWeather(g);
      yield* result(g, p, e, wet === 'rain' || wet === 'storm' || wet === 'typhoon' || wet === 'snow' ? 'rain' : 'jam', lines,
        { focus: who.map(q => q.id), ...(ref ? { node: nodeOf(g, ref), refs: [ref] } : {}) });
      return;
    }
    case 'per-lot': case 'per-level': case 'value-tax': case 'facility': {
      // Each owner's sum over this city's properties (owners anywhere: properties are theirs wherever they are).
      const due = g.living().map(q => {
        const me = q.id + 1;
        let x = 0;
        if (fx.t === 'per-lot') x = Math.min(fx.cap, Math.abs(fx.amount) * builtCount(g, me));
        else if (fx.t === 'per-level') x = Math.min(fx.cap, fx.amount * levelsOf(g, me));
        else if (fx.t === 'value-tax') x = Math.min(fx.cap, Math.trunc((valueHere(g, me) * fx.percent) / 100));
        else x = Math.min(fx.cap, Math.abs(fx.amount) * b.facilities.filter(f => f.owner === me && (!fx.hotels || f.type === 1)).reduce((s, f) => s + f.level, 0));
        return [q, x * F] as const;
      }).filter(([, x]) => x > 0);
      const gain = (fx.t === 'per-lot' || fx.t === 'facility') && fx.amount > 0;
      const unitAmount = fx.t === 'value-tax' ? 0 : Math.abs(fx.amount) * F;
      yield* show(g, p, e, text({ amount: unitAmount }), undefined, due.map(([q, x]) => ({ p: q.id, amount: gain ? x : -x })));
      const lines: ResultLine[] = [];
      for (const [q, x] of due) {
        if (gain) { g.gain(q, x, 1); yield { t: 'pay', from: -1, to: q.id, amount: x, reason: e.head, quiet: true }; }
        else { yield* g.transfer(q.id, -1, x, 0, e.head, true); if (g.over) return; }
        lines.push({ p: q.id, text: gain ? '獲得收入' : '繳交費用', amount: gain ? x : -x });
      }
      yield* result(g, p, e, gain ? 'award' : 'tax', lines.length ? lines : [{ text: '沒有人受到影響' }], { focus: due.map(([q]) => q.id) });
      return;
    }
    case 'everyone': {
      const who = g.locals(), x = Math.abs(fx.amount) * F, gain = fx.amount > 0;
      yield* show(g, p, e, text({ amount: x }), undefined, who.map(q => ({ p: q.id, amount: gain ? x : -x })));
      const lines: ResultLine[] = [];
      for (const q of who) {
        if (gain) { g.gain(q, x, 1); yield { t: 'pay', from: -1, to: q.id, amount: x, reason: e.head, quiet: true }; }
        else { yield* g.transfer(q.id, -1, x, 0, e.head, true); if (g.over) return; }
        lines.push({ p: q.id, text: gain ? '得到' : '付出', amount: gain ? x : -x });
      }
      yield* result(g, p, e, gain ? 'bonus' : 'tax', lines, { focus: who.map(q => q.id) });
      return;
    }
    case 'damage': {
      const hit = pickN(builtRefs(g), fx.lots, rng);
      yield* show(g, p, e, text({ lot: hit.map(r => refName(g, r)).join('、') }), hit[0]);
      const lines: ResultLine[] = [];
      for (const ref of hit) {
        const owner = refOwner(g, ref);
        for (let k = 0; k < fx.levels; k++) g.damageProperty(ref, 0);
        lines.push({ p: owner, text: `${refName(g, ref)}${levelText(g, ref)}` });
      }
      yield { t: 'board' };
      const owner = lines.find(l => l.p !== undefined)?.p;
      yield* result(g, p, e, e.id.includes('landslide') || e.id.includes('guerrilla') ? 'flood' : 'quake', lines,
        { node: nodeOf(g, hit[0]), refs: hit, ...(owner !== undefined ? { line: 'cry' } : {}) });
      return;
    }
    case 'area': {
      const refs = builtRefs(g), center = refs[rng.below(refs.length)];
      const c = center < 4000 ? b.lands[center - 2001] : b.facilities[center - 4001];
      yield* show(g, p, e, text({ lot: refName(g, center) }), center);
      const near = (x: number, y: number) => Math.abs(x - c.x) <= fx.radius && Math.abs(y - c.y) <= fx.radius;
      const hit: number[] = [], owners: number[] = [];
      for (const ref of [...b.lands.map(l => l.id + 2000), ...b.facilities.map(f => f.id + 4000)]) {
        const r = ref < 4000 ? b.lands[ref - 2001] : b.facilities[ref - 4001];
        if (!near(r.x, r.y) || refLevel(g, ref) === 0) continue;
        const o = refOwner(g, ref);
        g.damageProperty(ref, 0);
        hit.push(ref);
        if (o !== undefined) owners.push(o);
      }
      yield { t: 'board' };
      const lines: ResultLine[] = [{ text: `${refName(g, center)}一帶${hit.length}棟房屋各降一級` },
        ...[...new Set(owners)].map(o => ({ p: o, text: `${owners.filter(x => x === o).length}棟房屋受損` }))];
      yield* result(g, p, e, 'quake', lines, { node: nodeOf(g, center), refs: hit });
      return;
    }
    case 'stocks': {
      yield* show(g, p, e, text());
      if (fx.slots === 'all') g.stocks.forceLimit(-1, fx.up, fx.days);
      else for (const s of fx.slots) if (g.stocks.stocks[s]) g.stocks.forceLimit(s, fx.up, fx.days);
      const names = fx.slots === 'all' ? `${CITY[e.map]}的12支股票` : fx.slots.map(s => g.stocks.stocks[s]?.name).filter(Boolean).join('、');
      yield* result(g, p, e, fx.up ? 'stock-up' : 'stock-down', [{ text: `${names}${fx.up ? '上漲' : '下跌'}一成${fx.days > 1 ? `，連${fx.days}天` : ''}` }]);
      return;
    }
    case 'company': {
      const c = b.companies[rng.below(b.companies.length)];
      yield* show(g, p, e, text());
      g.stocks.adjustProfit(c, fx.delta);
      if (c.stockSlot < 12) g.stocks.forceLimit(c.stockSlot, fx.up, 3);
      yield* result(g, p, e, fx.up ? 'company-up' : 'company-down',
        [{ text: `${c.name}盈餘${fx.delta > 0 ? '增加' : '減少'}${Math.abs(fx.delta)}元${c.stockSlot < 12 ? `，股價${fx.up ? '上漲' : '下跌'}` : ''}` }]);
      return;
    }
    case 'street': {
      const l0 = b.lands[rng.below(b.lands.length)];
      yield* show(g, p, e, text({ street: l0.name }), l0.id + 2000);
      const old = l0.price;
      const hit: number[] = [];
      for (const l of b.lands) if (l.name === l0.name) { l.price = Math.max(10, Math.min(0xffff, Math.trunc(l.price * fx.factor))); hit.push(l.id + 2000); }
      yield { t: 'board' };
      yield* result(g, p, e, fx.factor > 1 ? 'price-up' : 'company-down',
        [{ text: `${l0.name}地價${fx.factor > 1 ? '上漲' : '下跌'}（${old * F}→${l0.price * F}元）` }], { node: nodeOf(g, l0.id + 2000), refs: hit });
      return;
    }
    case 'top-owner': {
      let best: Player | null = null, bestN = 0;
      for (const q of g.living()) {
        const me = q.id + 1, n = b.lands.filter(l => l.owner === me).length + b.facilities.filter(f => f.owner === me).length;
        if (n > bestN) { best = q; bestN = n; }
      }
      const amount = fx.amount * F;
      yield* show(g, p, e, text({ amount }) + (best ? `\n${g.name(best.id)}獲得${amount}元` : ''), undefined, best ? [{ p: best.id, amount }] : []);
      if (!best) return;
      g.gain(best, amount, 1);
      yield { t: 'pay', from: -1, to: best.id, amount, reason: '表揚獎金', quiet: true };
      yield* result(g, p, e, 'award', [{ p: best.id, text: `${CITY[e.map]}第一大地主（${bestN}處）`, amount }], { focus: [best.id], line: 'gain', amount });
      return;
    }
    case 'renovate': {
      const refs = upgradable(g), ref = refs[rng.below(refs.length)];
      yield* show(g, p, e, text({ lot: refName(g, ref) }), ref);
      g.freeUpgrade(ref);
      yield { t: 'board' };
      const owner = refOwner(g, ref);
      yield* result(g, p, e, 'price-up', [{ p: owner, text: `${refName(g, ref)}免費加蓋到${refLevel(g, ref)}級` }], { node: nodeOf(g, ref), refs: [ref], focus: owner !== undefined ? [owner] : [] });
      return;
    }
    case 'cards-all': {
      const who = g.locals();
      yield* show(g, p, e, text(), undefined, who.map(q => ({ p: q.id })));
      const lines: ResultLine[] = [];
      for (const q of who) {
        const ids = cardPool(g);
        if (!ids.length) break;
        const id = ids[rng.below(ids.length)];
        if (yield* g.cards.take(q, id)) lines.push({ p: q.id, text: `得到${cardName(id)}` });
      }
      yield* result(g, p, e, 'birthday', lines, { focus: who.map(q => q.id) });
      return;
    }
    case 'one-hospital': {
      const who = onRoad(g, 'all'), q = who[rng.below(who.length)];
      yield* show(g, p, e, text(), undefined, [{ p: q.id }]);
      yield* g.sendTo(q, 'hospital', fx.days);
      if (g.over) return;
      yield* result(g, p, e, 'hospital', [{ p: q.id, text: `被咬傷，住院${fx.days}天` }], { focus: [q.id] });
      return;
    }
  }
}

function levelText(g: Game, ref: number): string { const n = refLevel(g, ref); return n ? `房屋降為${n}級` : '房屋全毀'; }
