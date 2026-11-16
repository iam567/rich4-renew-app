import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBoard, type RawMap } from './board';
import { pack } from './date';
import { Game } from './game';
import { CQ_MAP, cqLink, cqRules } from './chongqing';
import { CQ_FATE, CQ_NEWS } from './modules/cq-data';
import { judge, makePuzzle, waitsOf } from './modules/mahjong';
import { Rng } from './rng';
import type { GameSettings, Step } from './types';

// 重慶 (docs/rules/33): map 109's own rules in a normal game.
const file = fileURLToPath(new URL('../../../editor/site/assets/remake/chongqing.json', import.meta.url));
const have = existsSync(file);
const board = () => parseBoard(JSON.parse(readFileSync(file, 'utf8')) as RawMap);

function settings(seed: number): GameSettings {
  return {
    mapId: CQ_MAP, players: [0, 4, 9, 11].map(character => ({ character, human: false })),
    fundIndex: 1, traffic: 0, landLimitIndex: 0, daysLimitIndex: 0, victoryIndex: 0, startDate: pack(2026, 11, 9), seed,
  };
}

function run(g: Game, days: number, see?: (s: Step) => void): void {
  const flow = g.run();
  for (let r = flow.next(); !r.done && g.daysElapsed < days && !g.over; r = flow.next()) see?.(r.value as Step);
}

describe('麻將館 puzzles (§6.1)', () => {
  it('every hand is one tile from winning, with the level\'s number of waits, all waits among 8 candidates', () => {
    for (let lv = 1; lv <= 5; lv++) {
      const r = new Rng(lv * 7919);
      for (let i = 0; i < 40; i++) {
        const pz = makePuzzle(r, lv);
        expect(pz.hand).toHaveLength(13);
        expect(pz.choices).toHaveLength(8);
        expect(waitsOf(pz.hand)).toEqual(pz.waits);
        expect(pz.waits.every(t => pz.choices.includes(t))).toBe(true);
        const n = pz.waits.length;
        if (lv === 1) expect(n).toBe(1);
        if (lv === 3) expect(n).toBe(2);
        if (lv === 4) expect(n === 2 || n === 3).toBe(true);
        if (lv === 5) expect(n).toBeGreaterThanOrEqual(3);
        const suits = new Set(pz.hand.map(t => Math.floor(t / 9)));
        if (lv >= 4) expect(suits.size).toBe(1); else expect(suits.size).toBe(2);
      }
    }
  });
  it('judging: level 1–2 one right tile; level 3+ all and only the waits', () => {
    expect(judge(1, [3], [3])).toBe('right');
    expect(judge(2, [3, 6], [6])).toBe('right');
    expect(judge(2, [3, 6], [5])).toBe('wrong');
    expect(judge(3, [3, 6], [3, 6])).toBe('right');
    expect(judge(3, [3, 6], [3])).toBe('part');
    expect(judge(4, [3, 6], [3, 6, 7])).toBe('part');
    expect(judge(5, [3, 6, 9], [])).toBe('wrong');
  });
});

describe.skipIf(!have)('重慶 (map 109)', () => {
  it('the map: three levels, the links where the rules say', () => {
    const b = board(), lv = b.levels!;
    expect(lv.node).toHaveLength(b.nodes.length);
    const [e2, e3] = lv.escalator, [v3, v2, v1] = lv.elevator;
    expect([lv.node[e2 - 1], lv.node[e3 - 1]]).toEqual([2, 3]);
    expect([lv.node[v3 - 1], lv.node[v2 - 1], lv.node[v1 - 1]]).toEqual([3, 2, 1]);
    expect(lv.ramp).toHaveLength(12);
  });

  it('a stop on a link takes the player to its other end; passing by does nothing', () => {
    const g = new Game(settings(1), board()), cq = cqRules(g)!, lv = g.board.levels!;
    const p = g.players[0];
    for (const [from, to] of [[lv.escalator[0], lv.escalator[1]], [lv.escalator[1], lv.escalator[0]], [lv.elevator[0], lv.elevator[1]], [lv.elevator[1], lv.elevator[2]], [lv.elevator[2], lv.elevator[0]]]) {
      expect(cqLink(g, from)!.to).toBe(to);
      p.node = from;
      const f = cq.landSquare(g, p, g.board.nodes[from - 1]);
      let r = f.next();
      while (!r.done) r = f.next();
      expect(r.value).toBe(true);
      expect(p.node).toBe(to);
    }
  });

  it('a year of computers: the links, 重慶\'s own news and fate and the facilities all happen, nobody stuck', () => {
    let links = 0, local = 0, mahjong = 0, hotpot = 0;
    for (const seed of [3, 5, 8]) {
      const g = new Game(settings(seed), board());
      run(g, 300, s => {
        if (s.t === 'fx' && s.kind === 'cq-link') links++;
        if (s.t === 'fx' && (s.kind === 'news' || s.kind === 'fate') && typeof s.data?.local === 'string' && (s.data.local as string).startsWith('cq-')) local++;
        if (s.t === 'say' && /聽牌答對|答錯了|只對一部分/.test(s.text)) mahjong++;
        if (s.t === 'say' && /火鍋錢/.test(s.text)) hotpot++;
      });
      expect(g.daysElapsed > 100 || g.over).toBe(true);
    }
    expect(links).toBeGreaterThan(0);
    expect(local).toBeGreaterThan(0);
    expect(mahjong + hotpot).toBeGreaterThan(0);
  });

  it('every card has a picture name of its own', () => {
    expect(CQ_NEWS).toHaveLength(18);
    expect(CQ_FATE).toHaveLength(22);
    const pics = new Set([...CQ_NEWS, ...CQ_FATE].map(c => c.id));
    expect(pics.size).toBe(40);
  });
});
