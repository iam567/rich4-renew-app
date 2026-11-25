import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseBoard } from './board';
import { Game } from './game';
import { pack } from './date';
import { QINGMING_FATE, QINGMING_NEWS } from './qingming-events';
import { drawStream, runEvent } from './modules/regional-events';
import { drawCnDeck } from './changan';
import { GENERAL_CARDS } from './modules/general-cards';
import { CHANGAN_FATE, CHANGAN_NEWS } from './changan-events';
import './qingming';   // (registers 清明上河's rules for map 111)

// 清明上河's own news and fate (core/qingming-events.ts): a 新聞 / 命運 square draws them, never the original's modern
// decks (the user 2026-11-23: 「清明上河…命運裡面還有行人闖馬路罰款」).
const raw = JSON.parse(readFileSync('../editor/site/assets/remake/qingming.json', 'utf8'));
const game = (seed: number) => {
  const g = new Game({ mapId: 111, players: [0, 4, 9, 11].map((character, i) => ({ character, human: i === 0 })), fundIndex: 1, traffic: 0,
    landLimitIndex: 0, daysLimitIndex: 0, victoryIndex: 0, startDate: pack(2026, 11, 23), seed }, parseBoard(raw));
  for (const q of g.players) {
    const n = g.board.nodes[10 + q.id * 7];
    q.placed = true; q.whoPlays = q.human ? 1 : 2; q.cash = 50000; q.bank = 20000; q.points = 50; q.node = n.id; q.lastNode = n.adjacent.find(Boolean) ?? n.id;
  }
  return g;
};
const drive = (f: Generator<unknown, unknown, unknown>) => {
  const steps: { t: string; kind?: string; data?: Record<string, unknown> }[] = [];
  for (let r = f.next(); !r.done; r = f.next(undefined as never)) steps.push(r.value as never);
  return steps;
};

describe('清明上河 新聞・命運', () => {
  it('no card ever says undefined, null or NaN (the user 2026-11-25: 「undefined的12支股票上漲一成」)', () => {
    const bad = new Set<string>();
    let boxes = 0;
    const decks: [string, (g: Game) => Generator<unknown, unknown, unknown>][] = [];
    for (const [l, kind, paper] of [[QINGMING_NEWS, 'news', '汴京小報'], [QINGMING_FATE, 'fate', '汴京小報'], [CHANGAN_NEWS, 'news', '開元雜報'], [CHANGAN_FATE, 'fate', '開元雜報']] as const)
      for (const e of l) if (!e.id.endsWith('-auction')) decks.push([e.id, g => drawCnDeck(g, g.players[0], [e], kind, paper) as never]);
    for (const e of GENERAL_CARDS) decks.push([e.id, g => runEvent(g, g.players[0], e, drawStream(g, g.players[0], e.kind)) as never]);
    for (const [id, run] of decks) for (const seed of [1, 2, 3]) {
      const g = game(seed);
      g.board.lands.forEach((l, i) => { if (i % 3) { l.owner = i % 4 + 1; l.level = i % 5; } });
      let steps: ReturnType<typeof drive>;
      try { steps = drive(run(g)); } catch (x) { bad.add(`${id}: ${String(x)}`); continue; }
      for (const s of steps) {
        if (s.kind === 'event-result') boxes++;
        const d = { ...s.data }; delete d.tag;
        if (/undefined|null的|NaN/.test(JSON.stringify([d, (s as { text?: string }).text ?? '']))) bad.add(`${id}: ${JSON.stringify(d).slice(0, 300)}`);
      }
    }
    expect([...bad]).toEqual([]);
    expect(boxes).toBeGreaterThan(200);
  });
  it('the decks: 60 news and 50 fate, no 發配所 card (this map has none), money in 文', () => {
    expect(QINGMING_NEWS).toHaveLength(60);
    expect(QINGMING_FATE).toHaveLength(50);
    for (const e of [...QINGMING_NEWS, ...QINGMING_FATE]) {
      expect(e.effect.t).not.toBe('exile');
      expect(e.text).not.toMatch(/[\d}]元/);
    }
  });
  it('a 新聞 / 命運 square shows a 清明上河 card with its own picture every time, the text filled in', () => {
    const shown = new Set<string>();
    for (let s = 1; s <= 300; s++) for (const kind of ['news', 'fate'] as const) {
      const g = game(s), p = g.players[0];
      const steps = drive((kind === 'news' ? g.events.news(p) : g.events.fate(p)) as never);
      const board = steps.find(x => x.t === 'fx' && (x.kind === 'news' || x.kind === 'fate'));
      expect(board, `${kind} seed ${s}`).toBeTruthy();
      const local = String(board!.data?.local ?? '');
      expect(local, `${kind} seed ${s}`).toMatch(/^qm-[nf]-/);
      expect(String(board!.data?.text)).not.toMatch(/\{\w+\}/);
      if (kind === 'news') expect(board!.data?.category, `news seed ${s}`).toBe('汴京小報');   // (never the original's 氣象報導 …)
      shown.add(local);
    }
    expect(shown.size).toBeGreaterThan(60);
  });

  it('gives only tools a shop sells (the user 2026-11-25: 「不要送研究所裡的道具」)', () => {
    const got = new Set<number>();
    const cards = [...QINGMING_NEWS, ...CHANGAN_NEWS].filter(e => e.effect.t === 'tools-all').map(e => ['news', e] as const)
      .concat([...QINGMING_FATE, ...CHANGAN_FATE].filter(e => e.effect.t === 'tool').map(e => ['fate', e] as never));
    expect(cards.length).toBe(4);
    for (const [kind, e] of cards) for (let seed = 1; seed <= 60; seed++) {
      const g = game(seed), before = g.players.map(q => [...q.tools]);
      drive(drawCnDeck(g, g.players[0], [e], kind, 'x') as never);
      g.players.forEach((q, i) => q.tools.forEach((n, t) => { if (n > before[i][t]) got.add(t + 1); }));
    }
    expect(Math.max(...got)).toBe(8);
  });
});
