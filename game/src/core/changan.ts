/**
 * 長安's own rules (the user 2026-11-19), for a game on the 長安 map in the editor's format (GameSettings.ruleSet
 * 'changan'): the large plots' five kinds are 博戲坊 (the park, type 0, one level), 客舍 (hotel), 市肆 (mall), 油坊
 * (petrol station, one level) and 集賢院 (institute) — names only, the original's rules — except 博戲坊:
 *
 *   its owner stopping there: nothing (as the park). Anyone else must bet 大 or 小 on three dice (5 seconds, then a
 *   side at random): 小 is 3–10, 大 is 11–18, exactly even (108 of the 216 throws each; no triple rule, that would
 *   tilt it). Right: the owner pays them 5,000 × the price index; wrong: they pay the owner 10,000 × the index, by
 *   the usual payment chain (gods, 免費卡 / 嫁禍卡, 死神 …). The dice are the game's own random numbers, thrown after
 *   the bet; a computer's side is drawn the same way, before the throw (it never sees the dice).
 */
import { MAP_RULES, RULE_SETS, type MapRules } from './game';
import type { BoardNode, Facility } from './board';

import { ask, type Flow } from './flow';
import { Game } from './game';
import type { Answer, Player, Step } from './types';
import { month as monthOf } from './date';
import { CHANGAN_FATE, CHANGAN_NEWS, type CnEvent } from './changan-events';
import { eligible, runEvent } from './modules/regional-events';
import type { RegionalEvent } from './modules/regional-data';
import { NEWS_COUNT } from './modules/events';
import { MoveEngine, type MoveEvent, type MoveKind } from './move-events';

export const CHANGAN_FAC_NAMES = ['博戲坊', '客舍', '市肆', '油坊', '集賢院'];
export const BET_WIN = 5000, BET_LOSE = 10000;

/** The question: { t: 'cn-dice-bet', p, win, lose, owner, name }; the answer 1 大, 0 小 (anything else: at random). */
export interface DiceBetAsk { t: 'cn-dice-bet'; p: number; win: number; lose: number; owner: number; name: string }

/** 長安's 驛站 (the user 2026-11-18): west of the city by the Wei, by 朱雀大街 in the city, east by 灞橋. */
export const POSTS: Record<string, { name: string; text: string }> = {
  'post-w': { name: '臨皋驛', text: '城西渭水邊，西行送別的第一站' },
  'post-c': { name: '都亭驛', text: '城中朱雀大街旁，京城總驛' },
  'post-e': { name: '長樂驛', text: '城東灞橋邊，東出長安必經' },
};
export const POST_FARE = 1000;

/** The 驛站 question: { t: 'cn-post', p, at, fare, can, dests: [{ key, node, name, text }] }; the answer the square ridden to, 0 none. */
export interface PostAsk { t: 'cn-post'; p: number; at: string; fare: number; can: boolean; dests: { key: string; node: number; name: string; text: string }[] }

/**
 * 貢院 (the user 2026-11-18/19): one question per exact stop, its tier by the unbroken run of right answers (across
 * visits) — 平民 → 進士 → 探花 → 榜眼 → 狀元 (and 狀元 again and again); right: the prize of that tier × (1 + (index −
 * 1) / 2) and up a rank; wrong: nothing, back to 平民. The banks (maps/remake/changan/exam/tierN.json, the right option
 * first) have these many questions; the time per question by tier.
 */
export const EXAM_COUNTS = [474, 329, 275, 217, 213];
export const EXAM_PRIZE = [1000, 2000, 5000, 10000, 20000];
export const EXAM_SECS = [15, 12, 10, 9, 8];
export const EXAM_RANKS = ['平民', '進士', '探花', '榜眼', '狀元'];
/**
 * A computer's chance by its level and the tier (the user 2026-11-23: 「按電腦的不同難度答對正確率也有相對的變化，地獄級別
 * 的答對的概率大幅提高」): 平民 / 進士 / 探花 / 榜眼 questions — 簡單 80 50 30 10 %, 中等 80 60 40 20 %, 困難 90 70 50 30 %,
 * 地獄 90 70 50 40 %; 狀元 questions start at the 榜眼 figure and lose 10 points for every stop the computer has already
 * answered there in this run (the 2026-11-19 rule).
 */
export const EXAM_AI = [[0.8, 0.5, 0.3, 0.1], [0.8, 0.6, 0.4, 0.2], [0.9, 0.7, 0.5, 0.3], [0.9, 0.7, 0.5, 0.4]];
export const examRate = (tier: number, topStops: number, level = 0, off = 0) => {
  const t = EXAM_AI[Math.max(0, Math.min(3, level))], r = tier < 5 ? t[tier - 1] : Math.max(0, t[3] - 0.1 * topStops);
  return r + (1 - r) * (off / 3);   // (a god took `off` of the three wrong answers away: so many fewer of its mistakes)
};
/** The run's title: 平民 until two right in a row, then 進士 … 狀元. */
export const examTitle = (run: number) => EXAM_RANKS[Math.max(0, Math.min(run, 5) - 1)];

/**
 * 鬥雞場 (the user 2026-11-18/19): four roosters with 1–5 stars, a knockout (two semi-finals drawn at random, the
 * third-place match, the final); one bet per exact stop — 獨贏 / 位置 (top two) / 連贏 (top two, any order) / 二重彩
 * (1st and 2nd in order) / 三重彩 (1st, 2nd, 3rd in order) — of 10 點券 or 1,000 文 × the price index; the odds from
 * the stars, the house keeping 10 %; the bouts drawn with those same chances (fair: no rigging).
 */
export const COCK_TYPES = ['win', 'place', 'quin', 'ex', 'tri'] as const;
export type CockType = typeof COCK_TYPES[number];
export const COCK_PICKS: Record<CockType, number> = { win: 1, place: 1, quin: 2, ex: 2, tri: 3 };
export const COCK_NAMES: Record<CockType, string> = { win: '獨贏', place: '位置', quin: '連贏', ex: '二重彩', tri: '三重彩' };
export const COCK_CASH = 1000, COCK_POINTS = 10;
const beat = (stars: number[], a: number, b: number) => { const sa = (stars[a] + 1) ** 2, sb = (stars[b] + 1) ** 2; return sa / (sa + sb); };
/** Every finishing order the knockout can give, with its chance. */
export function cockOutcomes(stars: number[], pairs: number[][]): { rank: number[]; p: number }[] {
  const [[a, b], [c, d]] = pairs, out: { rank: number[]; p: number }[] = [];
  for (const w1 of [a, b]) for (const w2 of [c, d]) {
    const l1 = w1 === a ? b : a, l2 = w2 === c ? d : c;
    const p12 = (w1 === a ? beat(stars, a, b) : beat(stars, b, a)) * (w2 === c ? beat(stars, c, d) : beat(stars, d, c));
    for (const f of [[w1, w2], [w2, w1]]) for (const t of [[l1, l2], [l2, l1]])
      out.push({ rank: [f[0], f[1], t[0], t[1]], p: p12 * beat(stars, f[0], f[1]) * beat(stars, t[0], t[1]) });
  }
  return out;
}
export function cockHits(rank: number[], k: CockType, ps: number[]): boolean {
  if (k === 'win') return rank[0] === ps[0];
  if (k === 'place') return rank[0] === ps[0] || rank[1] === ps[0];
  if (k === 'quin') return ps.includes(rank[0]) && ps.includes(rank[1]);
  if (k === 'ex') return rank[0] === ps[0] && rank[1] === ps[1];
  return rank[0] === ps[0] && rank[1] === ps[1] && rank[2] === ps[2];
}
/** The payout multiple (the stake included): 90 % of the fair odds, at least 1.1; 0 for a bet that can never come in. */
export function cockOdds(stars: number[], pairs: number[][], k: CockType, ps: number[]): number {
  const p = cockOutcomes(stars, pairs).filter(o => cockHits(o.rank, k, ps)).reduce((s, o) => s + o.p, 0);
  return p > 0 ? Math.max(1.1, Math.floor((0.9 / p) * 10) / 10) : 0;
}
/** The 鬥雞場 question: { t: 'cn-cock', p, stars, pairs, cash, points, canCash, canPoints }; the answer { type, picks, stake: 'cash' | 'points' } or null. */
export interface CockAsk { t: 'cn-cock'; p: number; stars: number[]; pairs: number[][]; cash: number; points: number; canCash: boolean; canPoints: boolean }

/** The 貢院 question: { t: 'cn-exam', p, tier, q, order, secs, run, prize }; the answer the bank index picked (0 is right), -1 none. */
export interface ExamAsk { t: 'cn-exam'; p: number; tier: number; q: number; order: number[]; secs: number; run: number; prize: number; off?: number[]; god?: string }
/**
 * A god riding along takes wrong answers away at 貢院 (the user 2026-11-25): 小福神 one, 大福神 two, 天使 all three. `off`: the
 * bank indices taken away, `god` who did.
 */
export const EXAM_GODS: Record<number, number> = { 3: 1, 4: 2, 9: 3 };
export function examHelp(g: Game, p: Player): { off: number[]; god?: string } {
  const k = EXAM_GODS[g.objects.godType(p)] ?? 0, off = [1, 2, 3];
  if (!k) return { off: [] };
  while (off.length > k) off.splice(g.rng.below(off.length), 1);
  return { off, god: g.objects.godName(p) };
}

/**
 * 小事件 (the user 2026-11-23): 30 of the blank squares; an exact stop draws one of these 30 at random — moves only, never
 * money, 點券, the hospital or the prison (「不住院、不進監獄、不涉及金錢和點券，就是單純的移動性的事件」), the steps 1–6
 * (「統一隨機前進和後退都是1-6步吧，別太多了，容易急眼」, the user 2026-11-23; each had its own range before). The kinds and the
 * engine: core/move-events.ts (shared with 清明上河).
 */
export type { MoveKind, MoveEvent };
export const MOVES: MoveEvent[] = [
  // on
  { id: 'ca-m-horse', head: '搭上驛馬', text: '驛卒的快馬順路捎你一程\n前進{n}步', t: 'fwd', lo: 1, hi: 6 },
  { id: 'ca-m-donkey', head: '毛驢慢慢走', text: '借來的毛驢走兩步歇一步\n前進{n}步', t: 'fwd', lo: 1, hi: 6 },
  { id: 'ca-m-kite', head: '抓住大紙鳶', text: '一陣風把孩子們的大紙鳶連人帶線吹起\n飛過{n}格', t: 'fwd', lo: 1, hi: 6 },
  { id: 'ca-m-cart', head: '搭胡商馬車', text: '西域胡商的馬車正好順路\n前進{n}步', t: 'fwd', lo: 1, hi: 6 },
  { id: 'ca-m-oxcart', head: '坐上牛車', text: '趕集的牛車慢悠悠地走\n前進{n}步', t: 'fwd', lo: 1, hi: 6 },
  { id: 'ca-m-bing', head: '追胡餅攤', text: '剛出爐的胡餅香得不得了，一路追著攤子走\n前進{n}步', t: 'fwd', lo: 1, hi: 6 },
  { id: 'ca-m-scholar', head: '與書生同行', text: '跟趕考的書生邊走邊對詩，不知不覺\n前進{n}步', t: 'fwd', lo: 1, hi: 6 },
  { id: 'ca-m-lion', head: '跟著舞獅隊', text: '舞獅隊鑼鼓喧天，跟著看熱鬧\n前進{n}步', t: 'fwd', lo: 1, hi: 6 },
  { id: 'ca-m-guard', head: '金吾衛開道', text: '金吾衛清道，一路暢通無阻\n前進{n}步', t: 'fwd', lo: 1, hi: 6 },
  { id: 'ca-m-stilts', head: '踩上高蹺', text: '上元百戲借來一副高蹺，一步跨好遠\n前進{n}步', t: 'fwd', lo: 1, hi: 6 },
  { id: 'ca-m-boat', head: '漕渠搭船', text: '順著漕渠搭了一段小船\n前進{n}步', t: 'fwd', lo: 1, hi: 6 },
  { id: 'ca-m-wedding', head: '遇上迎親隊', text: '撞見迎親的隊伍，被拉去一起熱鬧\n前進{n}步', t: 'fwd', lo: 1, hi: 6 },
  { id: 'ca-m-polo', head: '追帽子', text: '馬球一桿打飛了你的襆頭\n追著帽子跑了{n}步', t: 'fwd', lo: 1, hi: 6 },
  // back
  { id: 'ca-m-fish', head: '忘了帶魚符', text: '出門忘了帶魚符\n回頭去拿，後退{n}步', t: 'back', lo: 1, hi: 6 },
  { id: 'ca-m-crowd', head: '人潮擠退', text: '看百戲的人潮湧過來\n被擠得後退{n}步', t: 'back', lo: 1, hi: 6 },
  { id: 'ca-m-spook', head: '驚馬衝撞', text: '馬球場的馬受了驚衝上街\n嚇得連退{n}步', t: 'back', lo: 1, hi: 6 },
  { id: 'ca-m-shoe', head: '鞋子掉了', text: '走著走著鞋子掉了\n回頭去找，後退{n}步', t: 'back', lo: 1, hi: 6 },
  { id: 'ca-m-dog', head: '被大黃狗追', text: '坊裡的大黃狗追著你跑\n慌不擇路，後退{n}步', t: 'back', lo: 1, hi: 6 },
  { id: 'ca-m-drunk', head: '醉漢糾纏', text: '酒肆門口的醉漢拉著你要對飲\n連躲帶退，後退{n}步', t: 'back', lo: 1, hi: 6 },
  { id: 'ca-m-slip', head: '雨後路滑', text: '下過雨的坊街濕滑\n一跤滑回{n}步', t: 'back', lo: 1, hi: 6 },
  // the others
  { id: 'ca-m-spin', head: '胡旋舞轉暈了', text: '跟著胡旋舞轉了一圈又一圈\n暈頭轉向，往一邊走了{n}步', t: 'spin', lo: 1, hi: 6 },
  { id: 'ca-m-gossip', head: '回頭看熱鬧', text: '身後有人吵架，忍不住回頭去看\n掉頭走了{n}步', t: 'turnwalk', lo: 1, hi: 6 },
  { id: 'ca-m-drum', head: '坊門未閉', text: '街鼓還沒敲完，坊門還開著\n再擲一次骰子', t: 'dice', lo: 1, hi: 1 },
  { id: 'ca-m-cheer', head: '百戲喝彩', text: '百戲演得精彩，大家一路喝彩\n連擲兩次骰子', t: 'dice', lo: 2, hi: 2 },
  { id: 'ca-m-curfew', head: '暮鼓催行', text: '暮鼓響起，快要宵禁了\n一口氣趕到下一個路口', t: 'cross' },
  { id: 'ca-m-wrongway', head: '聽錯了路', text: '問路聽錯了方向\n退回上一個路口', t: 'crossback' },
  { id: 'ca-m-camel', head: '跟著胡商駝隊', text: '跟著西域駝隊一路走\n走到沒人買的空地才停', t: 'lot' },
  { id: 'ca-m-lost', head: '坊巷迷路', text: '七拐八繞走錯了巷子\n向後轉，下一回合往回走', t: 'turn' },
  { id: 'ca-m-wind', head: '平地起旋風', text: '平地捲起一陣大旋風\n把你吹到了別的地方', t: 'wind' },
  { id: 'ca-m-swap', head: '認錯了人', text: '人群裡認錯了人，追了半天\n和最近的對手換了位置', t: 'swap' },
];

export class ChanganRules implements MapRules {
  readonly facilityNames = CHANGAN_FAC_NAMES;
  constructor(readonly g: Game) {}

  /** Per player: the unbroken run of right answers at 貢院, and a computer's stops answered as 狀元 in it. */
  examRun: number[] = [];
  examTop: number[] = [];
  saveState(): unknown { return { examRun: this.examRun, examTop: this.examTop }; }
  loadState(s: unknown): void {
    const v = s as { examRun?: number[]; examTop?: number[] } | null;
    this.examRun = [...(v?.examRun ?? [])]; this.examTop = [...(v?.examTop ?? [])];
  }

  /** The map's own squares (Board.specials): 驛站 now; 貢院 and 鬥雞場 next. 發配所 does nothing on a stop. */
  *landSquare(g: Game, p: Player, n: BoardNode): Flow<boolean> {
    const kind = g.board.specials?.[n.id];
    if (!kind) return false;
    if (kind in POSTS) { yield* this.post(g, p, kind); return true; }
    if (kind === 'exam') { yield* this.exam(g, p); return true; }
    if (kind === 'cock') { yield* this.cock(g, p); return true; }
    if (kind === 'move') { if (!this.mover.moving) yield* this.move(g, p); return true; }
    return false;
  }

  /** 小事件 (core/move-events.ts): the move engine over 長安's list. */
  readonly mover = new MoveEngine(MOVES);
  *move(g: Game, p: Player): Flow { yield* this.mover.move(g, p); }

  // ---------------------------------------------------------------- 長安's own decks (core/changan-events.ts)
  *news(g: Game, p: Player): Flow<boolean> { return yield* this.draw(g, p, 'news'); }
  *fate(g: Game, p: Player): Flow<boolean> { return yield* this.draw(g, p, 'fate'); }

  /** A card at random from 長安's deck until one applies (drawCnDeck). */
  *draw(g: Game, p: Player, kind: 'news' | 'fate'): Flow<boolean> {
    return yield* drawCnDeck(g, p, kind === 'news' ? CHANGAN_NEWS : CHANGAN_FATE, kind, '開元雜報', (gg, pp, e, to) => this.exile(gg, pp, e, to));
  }

  /**
   * 發配所 (the user 2026-11-18/19: 「發配城外」): the fate board, then the player is marched to the 發配所 square in
   * the south country — no stay, nothing else; the next turn goes on from there.
   */
  *exile(g: Game, p: Player, e: CnEvent, node: number): Flow {
    yield { t: 'fx', kind: 'fate', p: p.id, data: { id: -1, text: e.text, local: e.id, city: '' } };
    const r = yield* g.objects.luck(p, 1, 1);
    if (r === 1) { yield* g.say(p.id, '吉人天相，逃過一劫'); return; }
    const n = g.node(node);
    yield { t: 'fx', kind: 'cn-exile', p: p.id, data: { from: p.node, to: n.id } };
    p.node = n.id; p.lastNode = n.adjacent.find(Boolean) ?? n.id;
    yield { t: 'teleport', p: p.id, node: n.id };
    yield* g.say(p.id, `${g.name(p.id)}被押到發配所`);
  }

  *cock(g: Game, p: Player): Flow {
    const stars = [0, 1, 2, 3].map(() => 1 + g.rng.below(5));
    const o = [0, 1, 2, 3];
    for (let i = 3; i > 0; i--) { const j = g.rng.below(i + 1); [o[i], o[j]] = [o[j], o[i]]; }
    const pairs = [[o[0], o[1]], [o[2], o[3]]];
    const cash = COCK_CASH * g.priceIndex, canCash = p.cash >= cash, canPoints = p.points >= COCK_POINTS;
    type Bet = { type: CockType; picks: number[]; stake: 'cash' | 'points' };
    let bet: Bet | null = null;
    if (g.isHuman(p)) {
      const a = (yield ask({ t: 'cn-cock', p: p.id, stars, pairs, cash, points: COCK_POINTS, canCash, canPoints } as never)) as unknown as Bet | null;
      if (a && COCK_TYPES.includes(a.type) && Array.isArray(a.picks) && a.picks.length === COCK_PICKS[a.type]
        && new Set(a.picks).size === a.picks.length && a.picks.every(i => i >= 0 && i < 4) && cockOdds(stars, pairs, a.type, a.picks)
        && (a.stake === 'cash' ? canCash : canPoints)) bet = a;
    } else if (g.rng.below(2) === 1 && (canCash || canPoints)) {
      // a computer: 獨贏 on the bird with the most stars (the first of them), with money when it has some to spare
      const best = stars.indexOf(Math.max(...stars));
      bet = { type: 'win', picks: [best], stake: canCash && p.cash >= cash * 5 ? 'cash' : canPoints ? 'points' : 'cash' };
    }
    if (!bet) { if (!g.isHuman(p)) yield* g.say(p.id, '鬥雞場：今天不押了'); return; }
    const odds = cockOdds(stars, pairs, bet.type, bet.picks);
    // the stake first, then the bouts with the stars' chances
    if (bet.stake === 'cash') yield* g.transfer(p.id, -1, cash, 1, '鬥雞', true); else p.points -= COCK_POINTS;
    if (g.over || !p.whoPlays) return;
    const fight = (a: number, b: number) => (g.rng.below(10000) < Math.round(beat(stars, a, b) * 10000) ? [a, b] : [b, a]);
    const [w1, l1] = fight(pairs[0][0], pairs[0][1]), [w2, l2] = fight(pairs[1][0], pairs[1][1]);
    const [third, fourth] = fight(l1, l2), [first, second] = fight(w1, w2);
    const rank = [first, second, third, fourth], hit = cockHits(rank, bet.type, bet.picks);
    const prize = hit ? (bet.stake === 'cash' ? Math.round(cash * odds) : Math.round(COCK_POINTS * odds)) : 0;
    yield { t: 'fx', kind: 'cn-cock-fight', p: p.id, data: { stars, pairs, bouts: [[pairs[0][0], pairs[0][1], w1], [pairs[1][0], pairs[1][1], w2], [l1, l2, third], [w1, w2, first]],
      rank, type: bet.type, picks: bet.picks, stake: bet.stake, odds, hit, prize, cash, human: g.isHuman(p) } };
    const what = `${COCK_NAMES[bet.type]}${bet.picks.map(i => '一二三四'[i]).join('')}號`;
    if (hit) {
      if (bet.stake === 'cash') g.gain(p, prize, 1); else p.points += prize;
      yield* g.say(undefined, `鬥雞押中了！\n得${prize}${bet.stake === 'cash' ? '元' : '點券'}`, `${g.name(p.id)}在鬥雞場押${what}，中了，得${prize}${bet.stake === 'cash' ? '元' : '點券'}`);
    } else yield* g.say(undefined, `鬥雞沒押中…`, `${g.name(p.id)}在鬥雞場押${what}，沒中`);
  }

  *exam(g: Game, p: Player): Flow {
    const run = this.examRun[p.id] ?? 0, tier = Math.min(run + 1, 5);
    const q = g.rng.below(EXAM_COUNTS[tier - 1]);
    const order = [0, 1, 2, 3];
    for (let i = 3; i > 0; i--) { const j = g.rng.below(i + 1); [order[i], order[j]] = [order[j], order[i]]; }
    const prize = Math.round(EXAM_PRIZE[tier - 1] * (1 + (g.priceIndex - 1) / 2));
    let right: boolean;
    const help = examHelp(g, p);
    if (g.isHuman(p)) {
      const a = (yield ask({ t: 'cn-exam', p: p.id, tier, q, order, secs: EXAM_SECS[tier - 1], run, prize, ...help } as never)) as unknown;
      right = a === 0;
    } else {
      right = g.rng.below(1000) < Math.round(examRate(tier, this.examTop[p.id] ?? 0, g.aiLevel(p), help.off.length) * 1000);
      if (tier === 5) this.examTop[p.id] = (this.examTop[p.id] ?? 0) + 1;
    }
    const was = examTitle(run), now = right ? run + 1 : 0;
    // the scene: a new rank's picture; as 狀元, the 雁塔題名 after 5 more wins in a row and the 曲江宴 after 10; a fall
    // from a rank its own picture
    const top = now - 5;
    const scene = right
      ? (tier < 5 ? ['rank-0-commoner', 'rank-1-jinshi', 'rank-2-tanhua', 'rank-3-bangyan'][tier - 1] : top === 5 ? 'rank-5-yanta' : top === 10 ? 'rank-7-feast' : 'rank-4-zhuangyuan')
      : run >= 2 ? ['demote-1-jinshi', 'demote-2-tanhua', 'demote-3-bangyan', 'demote-4-zhuangyuan'][Math.min(run, 5) - 2] : 'rank-6-fail';
    this.examRun[p.id] = now;
    if (!right) this.examTop[p.id] = 0;
    yield { t: 'fx', kind: 'cn-exam-result', p: p.id, data: { right, tier, q, order, run: now, prize: right ? prize : 0, was, title: examTitle(now), scene, human: g.isHuman(p) } };
    if (right) {
      yield* g.say(undefined, `${g.name(p.id)}在貢院答對了！\n${tier === 1 ? '' : `升為${EXAM_RANKS[tier - 1]}　`}獲得${prize}元`, `${g.name(p.id)}在貢院答對${EXAM_RANKS[tier - 1]}題，獲得${prize}元`);
      g.gain(p, prize, 1);   // from the court, in cash
    } else yield* g.say(undefined, run >= 2 ? `${g.name(p.id)}落第了…\n${was}打回平民` : `${g.name(p.id)}答錯了…`, `${g.name(p.id)}在貢院答錯，${run >= 2 ? `${was}打回平民` : '沒有獎金'}`);
  }

  /**
   * 驛站快馬 (the user 2026-11-18): an exact stop offers a fast horse to either of the other two stations for 1,000 文 ×
   * the price index; not enough cash, no ride; the turn ends at the station ridden to (nothing happens there).
   */
  *post(g: Game, p: Player, kind: string): Flow {
    const fare = POST_FARE * g.priceIndex, can = p.cash >= fare;
    const dests = Object.entries(g.board.specials ?? {}).filter(([, k]) => k in POSTS && k !== kind)
      .map(([node, key]) => ({ key, node: Number(node), name: POSTS[key].name, text: POSTS[key].text }))
      .sort((a, b) => a.key.localeCompare(b.key));
    let to = 0;
    if (g.isHuman(p)) to = Number((yield ask({ t: 'cn-post', p: p.id, at: kind, fare, can, dests } as never)) ?? 0);
    else if (can && p.cash >= fare * 3 && dests.length && g.rng.below(2) === 1) to = dests[g.rng.below(dests.length)].node;
    const dest = dests.find(d => d.node === to);
    if (!dest || !can) {
      if (!g.isHuman(p)) yield* g.say(p.id, `${POSTS[kind].name}：不騎快馬了`);
      return;
    }
    yield* g.transfer(p.id, -1, fare, 0, '驛站快馬', true);
    if (g.over || !p.whoPlays) return;
    yield { t: 'fx', kind: 'cn-post-ride', p: p.id, data: { from: kind, to: dest.key, fare } };
    const there = g.node(dest.node);
    p.node = there.id; p.lastNode = there.adjacent.find(Boolean) ?? there.id;
    yield { t: 'teleport', p: p.id, node: there.id };
    yield* g.say(p.id, `騎快馬到了${dest.name}`);
  }

  *landOnFacility(g: Game, p: Player, f: Facility): Flow<boolean> { return yield* diceHall(g, p, f); }
}

/**
 * The dice hall on the large plots' first kind (長安's 博戲坊; 清明上河's 瓦舍勾欄, the user 2026-11-24: 「瓦舍勾欄還做成和大唐一樣的
 * 賭坊吧」): anyone else stopping bets 大 / 小 with its owner; false: not one (the original's handling).
 */
export function* diceHall(g: Game, p: Player, f: Facility): Flow<boolean> {
  if (f.type !== 0 || f.level < 1 || f.owner === 0 || f.owner === p.id + 1) return false;   // the original's
  const owner = g.players[f.owner - 1];
  if (!owner || owner.bankrupt || !owner.whoPlays) return true;
  yield* diceBet(g, p, owner, f);
  return true;
}

function* diceBet(g: Game, p: Player, owner: Player, f: Facility): Flow {
  const win = BET_WIN * g.priceIndex, lose = BET_LOSE * g.priceIndex;
  let big: boolean;
  if (g.isHuman(p)) {
    const a = (yield ask({ t: 'cn-dice-bet', p: p.id, win, lose, owner: owner.id, name: f.name } as never)) as unknown;
    big = a === 1 ? true : a === 0 ? false : g.rng.below(2) === 1;
  } else big = g.rng.below(2) === 1;
  const dice = [1 + g.rng.below(6), 1 + g.rng.below(6), 1 + g.rng.below(6)];
  const sum = dice[0] + dice[1] + dice[2], isBig = sum >= 11, hit = big === isBig;
  yield { t: 'fx', kind: 'cn-dice-roll', p: p.id, target: owner.id, data: { dice, sum, big, isBig, hit, amount: hit ? win : lose, facility: f.id } };
  const where = `${g.name(owner.id)}的${f.name}${g.rules?.facilityNames?.[0] ?? '博戲坊'}`;
  if (hit) {
    yield* g.say(undefined, `押中了！\n${g.name(owner.id)}付${win}元`, `${where}：${g.name(p.id)}押${big ? '大' : '小'}，開${isBig ? '大' : '小'}（${sum}點），莊家付${win}元`);
    yield* g.transfer(owner.id, p.id, win, 0, '博戲');
  } else {
    yield* g.say(undefined, `押錯了…\n付${g.name(owner.id)}${lose}元`, `${where}：${g.name(p.id)}押${big ? '大' : '小'}，開${isBig ? '大' : '小'}（${sum}點），付莊家${lose}元`);
    if (!(yield* g.ownerCollects(owner, f.tmpState, '賭資'))) return;
    const paid = yield* g.collect(p, owner, lose, '賭資', true);
    if (paid) f.lastFee = yield* g.transfer(paid.payer, owner.id, paid.amount, 0, '博戲');
  }
}

/**
 * A card at random from an era map's own deck (長安, 清明上河) until one applies (as 自建地圖's deck draws), run in its own
 * words and picture. `exile`: the map's 發配所 move (長安 only; a map without one skips those cards).
 */
export function* drawCnDeck(g: Game, p: Player, deck: readonly CnEvent[], kind: 'news' | 'fate', paper: string,
  exile?: (g: Game, p: Player, e: CnEvent, to: number) => Flow): Flow<boolean> {
  const list = [...deck];
  while (list.length) {
    const e = list.splice(g.rng.below(list.length), 1)[0], ef = e.effect;
    if (e.when?.months && !e.when.months.includes(monthOf(g.date))) continue;
    if (e.only === 'riding' && !(p.traffic === 1 || p.traffic === 2)) continue;
    if (ef.t === 'orig' || ef.t === 'wreck') {
      const n = ef.t === 'wreck' ? 10 : Number(ef.n);
      const pic = e.pics ? e.pics[p.traffic === 2 ? 'car' : 'scooter'] ?? e.id : e.id;
      if (kind === 'fate') {
        const r = g.events.fateCheck(p, n);
        if (r < 0) continue;
        yield* dressed(g, e, pic, g.events.applyFate(p, r), paper);
      } else {
        if (!(n < NEWS_COUNT && g.events.newsCheck(n))) continue;
        yield* dressed(g, e, pic, g.events.applyNews(p, n), paper);
      }
      return true;
    }
    if (ef.t === 'exile') {
      const to = Object.entries(g.board.specials ?? {}).find(([, k]) => k === 'exile');
      if (!to || !exile || g.offRoad(p)) continue;
      yield* exile(g, p, e, Number(to[0]));
      return true;
    }
    // a regional-style card: its random amounts drawn now (× the price index by the effect itself)
    const effect: Record<string, unknown> = { ...ef };
    const am = ef.amount as { min: number; max: number; step: number } | number | undefined;
    if (am && typeof am === 'object') effect.amount = am.min + am.step * g.rng.below(Math.floor((am.max - am.min) / am.step) + 1);
    const card = { id: e.id, map: 0, kind, tone: e.tone, head: e.head, text: e.text, effect, art: e.id, ...(kind === 'news' ? { category: paper } : {}) } as unknown as RegionalEvent;
    if (!eligible(g, p, card)) continue;
    yield* runEvent(g, p, card, g.rng);
    return true;
  }
  return false;
}

/** 長安 as a 自製地圖 (maps/remake/index.json, exported from the editor: maker/compile.ts officialFiles). */
export const CHANGAN_MAP = 110;
MAP_RULES[CHANGAN_MAP] = g => new ChanganRules(g);
RULE_SETS.changan = g => new ChanganRules(g);

/**
 * An original entry run in 長安's words: its board shows the card's own picture and text — the lot, street and amount
 * the original picked put into the card's {lot} {street} {amount}; a text the step cannot fill keeps the original's
 * lines under the card's headline.
 */
function* dressed(g: Game, e: CnEvent, pic: string, inner: Flow, paper: string): Flow {
  let r = inner.next();
  while (!r.done) {
    let st: Step = r.value;
    const fx = st as Step & { t: string; kind?: string; node?: number; data?: Record<string, unknown> };
    if (fx.t === 'fx' && (fx.kind === 'news' || fx.kind === 'fate')) {
      const orig = String(fx.data?.text ?? '');
      const n = fx.node ? g.board.nodes.find(x => x.id === fx.node) : undefined;
      const lot = n ? (n.ref > 4000 && n.ref < 6000 ? g.board.facilities[n.ref - 4001]?.name : n.ref > 2000 && n.ref < 4000 ? g.board.lands[n.ref - 2001]?.name : undefined) : undefined;
      const amount = /(\d[\d,]*)\s*元/.exec(orig)?.[1];
      let text = e.text;
      if (/\{lot\}/.test(text) && lot) text = text.replace(/\{lot\}/g, lot);
      if (/\{street\}/.test(text) && lot) text = text.replace(/\{street\}/g, lot);
      if (/\{amount\}/.test(text) && amount) text = text.replace(/\{amount\}/g, amount);
      if (/\{\w+\}/.test(text)) text = [e.head, ...orig.split('\n').slice(1)].join('\n');
      // (a news board titled by the map's own paper, not the original's 氣象報導 / 財經新聞 … — the user 2026-11-23)
      st = { ...fx, data: { ...fx.data, local: pic, text, city: '', ...(fx.kind === 'news' ? { category: paper } : {}) } } as Step;
    }
    const a: Answer = yield st;
    r = inner.next(a);
  }
  return r.value;
}
