/**
 * 獎勵卡 (docs/rules/30-challenge-switch.md, the user 2026-11-03): a normal game's 挑戰模式 deals a task card each
 * month (or half month); the first to do it draws one of these ten — the winner gains, every rival loses. The card
 * is drawn at random from the game's own stream (the seed and the card's number: never the dice, fair randomness);
 * what a rival hands over (which card, tool, lot) is picked the same way. Not in the 圖鑑.
 *
 * Three grades (the user 2026-11-03): N 7/10, R 2/10, SR 1/10, the card's amount growing with it (1 / 2 / 3 cards …,
 * 紅包 5000 / 10000 / 20000, 點券 100 / 150 / 200, 5 / 7 / 9 days). The picture is the same for every grade; the grade is its corner tag and frame, and
 * the backs the draw shows (seven N, two R, one SR, ui/map-fx.ts rewardDraw).
 */
import type { Flow } from './flow';
import type { Game } from './game';
import { cardName } from './modules/cards';
import type { ResultLine } from './modules/events';
import { MAX_HELD, toolDef } from './modules/tools';
import type { Player } from './types';

/** 0 N, 1 R, 2 SR. */
export type Grade = 0 | 1 | 2;
export const GRADES = ['N', 'R', 'SR'] as const;
/** The draw's ten backs: seven N, two R, one SR (the grades' odds). */
export const GRADE_BACKS: readonly Grade[] = [0, 0, 0, 0, 0, 0, 0, 1, 1, 2];

/** `{n}` in a text is the grade's amount (`amount[grade]`). */
/**
 * `weight`: how often it comes against the others (the user 2026-11-03): money and points 4, 雁過拔毛 3, prison /
 * hospital / 冬眠 2, 圈地為王 and 拆遷令 (the 寶卡) 1 — of 27.
 */
export interface RewardCard { id: string; name: string; desc: string; amount: readonly [number, number, number]; weight: number }

const CN = ['', '一', '二', '三'];
export const REWARD_CARDS: readonly RewardCard[] = [
  { id: 'RW01', name: '雁過拔毛', desc: '每個對手交給你 {n} 張卡片和 {n} 個道具', amount: [1, 2, 3], weight: 3 },
  { id: 'RW02', name: '圈地為王', desc: '每個對手交給你 {n} 塊地，連房子一起', amount: [1, 2, 3], weight: 1 },
  { id: 'RW03', name: '紅包拿來', desc: '每個對手給你 {m}', amount: [5000, 10000, 20000], weight: 4 },
  { id: 'RW04', name: '抽成', desc: '每個對手交出現金的{c}成給你', amount: [1, 2, 3], weight: 4 },
  { id: 'RW05', name: '挪用存款', desc: '每個對手存款的{c}成轉進你的存款', amount: [1, 2, 3], weight: 4 },
  { id: 'RW06', name: '點數上繳', desc: '每個對手交給你 {n} 點券', amount: [100, 150, 200], weight: 4 },
  { id: 'RW07', name: '全員入獄', desc: '其他人都坐牢 {n} 天', amount: [5, 7, 9], weight: 2 },
  { id: 'RW08', name: '全員住院', desc: '其他人都住院 {n} 天', amount: [5, 7, 9], weight: 2 },
  { id: 'RW09', name: '全員冬眠', desc: '其他人冬眠 {n} 回合', amount: [5, 7, 9], weight: 2 },
  { id: 'RW10', name: '拆遷令', desc: '每個對手隨機 {n} 棟房子拆到底，你隨機 {n} 塊地各加蓋三層', amount: [1, 2, 3], weight: 1 },
];
export const rewardById = new Map(REWARD_CARDS.map(c => [c.id, c]));

/** The card's text in this game and grade (紅包拿來's sum × today's price index). */
export function rewardDesc(g: Game, c: RewardCard, grade: Grade = 0): string {
  const n = c.amount[grade], m = n * g.priceIndex;
  return c.desc.replaceAll('{n}', String(n)).replace('{c}', CN[n] ?? String(n))
    .replace('{m}', m >= 10000 ? `${+(m / 10000).toFixed(1)} 萬元` : `${m.toLocaleString()} 元`);
}

/** Up to `n` different items of `xs`, at random (`rnd`). */
function some<T>(xs: T[], n: number, rnd: () => number): T[] {
  const a = xs.slice(), out: T[] = [];
  while (a.length && out.length < n) out.push(a.splice(Math.floor(rnd() * a.length), 1)[0]);
  return out;
}

/** The game's own random stream for reward card `seq`: the seed and the number (as the task decks, core/monthly.ts). */
function stream(seed: number, seq: number): () => number {
  let s = (seed ^ 0x5bd1e995 ^ Math.imul(seq + 1, 0x9e3779b1)) >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let x = s; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
}

/**
 * Player `p` draws a 獎勵卡 and it is played: the card shown (fx 'reward'), what it does, then the result box (the
 * fates' 'event-result', src 'reward'). `seq` the card's number in this game.
 */
export function* playReward(g: Game, p: Player, seq: number, test?: string, testGrade?: Grade): Flow {
  const rnd = stream(g.settings.seed, seq), pick = <T>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)];
  // The grade first (SR 1/10, R 2/10, N 7/10), then the card (by weight, 4 … 1); `test…`: a test's card and grade.
  const r = rnd(), drawnGrade: Grade = r < 0.1 ? 2 : r < 0.3 ? 1 : 0;
  let w = rnd() * REWARD_CARDS.reduce((a, c) => a + c.weight, 0), drawn = REWARD_CARDS[0];
  for (const c of REWARD_CARDS) { w -= c.weight; if (w < 0) { drawn = c; break; } }
  const card = (test && rewardById.get(test)) || drawn, grade = testGrade ?? drawnGrade, n = card.amount[grade];
  // The draw's backs (presentation): the ten shuffled, and the one it stops on, a back of the card's grade.
  const backs = some([...GRADE_BACKS], GRADE_BACKS.length, rnd), at = pick(backs.map((b, i) => (b === grade ? i : -1)).filter(i => i >= 0));
  const rivals = g.players.filter(q => q.id !== p.id && q.whoPlays && g.here(q));
  yield { t: 'fx', kind: 'reward', p: p.id, data: { id: card.id, name: card.name, text: rewardDesc(g, card, grade), grade, backs, at } };
  const lines: ResultLine[] = [], refs: number[] = [];
  const PI = g.priceIndex;
  switch (card.id) {
    case 'RW01': for (const q of rivals) { // n cards and n tools from each
      const got: string[] = [];
      for (let k = 0; k < n && q.cards.length; k++) {
        const [id] = q.cards.splice(Math.floor(rnd() * q.cards.length), 1);
        // A human with a full hand may let it go (the card goes back to the pool), as the birthday fate.
        if (!(yield* g.cards.take(p, id)) && g.cards.remaining.length >= id) g.cards.remaining[id - 1] += 1;
        yield { t: 'fx', kind: 'card-taken', p: p.id, target: q.id, data: { card: id } };
        got.push(cardName(id) || '卡片');
      }
      for (let k = 0; k < n; k++) {
        const kinds = q.tools.map((x, i) => (x > 0 && p.tools[i] < MAX_HELD ? i : -1)).filter(i => i >= 0);
        if (!kinds.length) break;
        const t = pick(kinds); q.tools[t] -= 1; p.tools[t] += 1; got.push(toolDef(t + 1)?.name ?? '道具');
      }
      lines.push({ p: q.id, text: got.length ? `交出${got.join('、')}` : '沒有卡片和道具' });
      if (g.over) return;
    } break;
    case 'RW02': for (const q of rivals) { // n lots each, the buildings with them
      const lots = some(g.board.lands.filter(l => l.owner === q.id + 1), n, rnd);
      if (!lots.length) { lines.push({ p: q.id, text: '沒有地可交' }); continue; }
      for (const l of lots) { l.owner = p.id + 1; refs.push(l.id + 2000); }
      lines.push({ p: q.id, text: `交出${lots.map(l => `${l.name}${l.level && !l.chain ? `（${l.level} 層）` : ''}`).join('、')}` });
    } yield { t: 'board' }; break;
    case 'RW03': case 'RW04': case 'RW05': { // money: a sum, n tenths of the cash, n tenths of the deposit (to the deposit)
      let sum = 0;
      for (const q of rivals) {
        let x = card.id === 'RW03' ? n * PI : Math.trunc((card.id === 'RW04' ? q.cash : q.bank) * n / 10);
        if (x <= 0) { lines.push({ p: q.id, text: card.id === 'RW05' ? '沒有存款' : '沒有現金' }); continue; }
        // As a fate's fine (the user 2026-11-03: 「该生效生效」): a good god spares it, a bad one doubles it.
        const r = yield* g.objects.luck(q, 0, 1);
        if (r === 1) { lines.push({ p: q.id, text: `${g.objects.godName(q) || '神明'}保佑，免付` }); continue; }
        if (r === 2) x *= 2;
        // As any fine (docs/rules/02 §9.1): the cash, then the deposit; whoever cannot pay goes bankrupt.
        const paid = yield* g.transfer(q.id, p.id, x, card.id === 'RW05' ? 4 : 1, card.name, true);
        lines.push({ p: q.id, text: r === 2 ? `交出（${g.objects.godName(q) || '神明'}作祟，加倍）` : '交出', amount: -paid }); sum += paid;
        if (g.over || !p.whoPlays) break;
      }
      if (sum) lines.push({ p: p.id, text: '共收到', amount: sum });
      break;
    }
    case 'RW06': { // n points each (what there is)
      let sum = 0;
      for (const q of rivals) {
        const x = Math.min(n, Math.max(0, q.points));
        q.points -= x; p.points += x; sum += x;
        lines.push({ p: q.id, text: x ? `交出 ${x} 點券` : '沒有點券' });
      }
      if (sum) lines.push({ p: p.id, text: `共收到 ${sum} 點券` });
      break;
    }
    case 'RW07': case 'RW08': { // prison / hospital n days, as a fate's misfortune (06 §2.2)
      // The user 2026-11-03 (「免罪卡其实也是可以用的……有天使附身的人也是可以避免的，该生效生效」): a good god spares
      // the player, a bad one doubles the days; then the 免罪卡 cancels it, a 嫁禍卡 passes it on (to anyone, the
      // winner too).
      const place = card.id === 'RW07' ? 'prison' : 'hospital', word = place === 'prison' ? '坐牢' : '住院';
      for (const q of rivals) {
        if (!q.whoPlays) continue;
        const r = yield* g.objects.luck(q, 1, 1);
        if (r === 1) { lines.push({ p: q.id, text: `${g.objects.godName(q) || '神明'}保佑，逃過此劫` }); continue; }
        const days = r === 2 ? n * 2 : n;
        const target = yield* g.cards.pardonOrFrame(q, false, place);
        if (target < 0) { lines.push({ p: q.id, text: '免罪卡生效，逃過此劫' }); continue; }
        yield* g.sendTo(g.players[target], place, days);
        if (target !== q.id) lines.push({ p: q.id, text: `用嫁禍卡嫁禍給${g.name(target)}` });
        lines.push({ p: target, text: `${word} ${days} 天${r === 2 ? '（倒楣加倍）' : ''}` });
        if (g.over) return;
      }
      break;
    }
    case 'RW09': { // 冬眠 n turns (as the 冬眠卡: those on the road)
      // (no 'hibernate' fx: that one shows the 冬眠卡 being played)
      for (const q of rivals) {
        if (!q.placed || g.offRoad(q)) { lines.push({ p: q.id, text: '不在路上，沒有冬眠' }); continue; }
        q.sleepwalk = 0; q.sleep = n; q.monthBadDays += n;
        lines.push({ p: q.id, text: `冬眠 ${n} 回合` });
      }
      yield { t: 'board' };
      break;
    }
    case 'RW10': { // n of each rival's buildings down to nothing; three floors on n of the winner's lots (5 at most)
      for (const q of rivals) {
        const built = some(g.board.lands.filter(l => l.owner === q.id + 1 && l.level > 0), n, rnd);
        if (!built.length) { lines.push({ p: q.id, text: '沒有房子可拆' }); continue; }
        for (const l of built) { l.level = 0; l.chain = false; refs.push(l.id + 2000); }
        lines.push({ p: q.id, text: `${built.map(l => l.name).join('、')}的房子拆到底` });
      }
      const mine = some(g.board.lands.filter(l => l.owner === p.id + 1 && !l.chain && l.level < 5), n, rnd);
      for (const l of mine) {
        const to = Math.min(5, l.level + 3);
        lines.push({ p: p.id, text: `${l.name}加蓋到 ${to} 層` });
        l.level = to;
        refs.push(l.id + 2000);
      }
      if (!mine.length) lines.push({ p: p.id, text: '沒有可以加蓋的地' });
      yield { t: 'board' };
      break;
    }
  }
  // For the task tracker (core/challenge.ts): the card's play is over.
  yield { t: 'fx', kind: 'reward-end', p: p.id };
  if (g.over) return;
  yield {
    t: 'fx', kind: 'event-result', p: p.id,
    data: { src: 'reward', id: REWARD_CARDS.indexOf(card), fx: card.id === 'RW10' ? 'demolish' : 'reward', title: `獎勵卡・${GRADES[grade]}`, head: `${card.name}：${rewardDesc(g, card, grade)}`, lines, refs, focus: [p.id, ...rivals.map(q => q.id)], reward: card.id, grade },
  };
}
