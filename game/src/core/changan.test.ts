import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBoard, type RawMap } from './board';
import { pack } from './date';
import { Game } from './game';
import { BET_LOSE, BET_WIN, ChanganRules, cockOdds, cockOutcomes, EXAM_COUNTS, EXAM_PRIZE, examRate } from './changan';
import type { GameSettings, Step } from './types';

// 長安's 博戲坊 (core/changan.ts) on any board: the rules come by name (GameSettings.ruleSet), not by the map.
const board = () => parseBoard(JSON.parse(readFileSync(fileURLToPath(new URL('../../../editor/site/assets/remake/jiqing.json', import.meta.url)), 'utf8')) as RawMap);
const settings = (seed: number): GameSettings => ({
  mapId: 1, players: [0, 4, 9, 11].map(character => ({ character, human: false })), ruleSet: 'changan',
  fundIndex: 1, traffic: 0, landLimitIndex: 0, daysLimitIndex: 0, victoryIndex: 0, startDate: pack(2026, 11, 19), seed,
});
function drain(f: Generator<unknown, unknown, unknown>): Step[] {
  const out: Step[] = [];
  for (let r = f.next(); !r.done; r = f.next()) out.push(r.value as Step);
  return out;
}
function scene(seed: number) {
  const g = new Game(settings(seed), board());
  for (const q of g.players) { q.placed = true; q.whoPlays = 2; q.cards = []; q.cash = 50000; q.bank = 50000; }
  const f = g.board.facilities[0];
  f.type = 0; f.level = 1; f.owner = 2;
  return { g, f, visitor: g.players[0], owner: g.players[1] };
}

describe('長安 博戲坊', () => {
  it('comes by name and names the five plots', () => {
    const g = new Game(settings(1), board());
    expect(g.rules).toBeInstanceOf(ChanganRules);
    expect(g.rules?.facilityNames).toEqual(['博戲坊', '客舍', '市肆', '油坊', '集賢院']);
  });

  it('the owner stopping there: nothing', () => {
    const { g, f, owner } = scene(2);
    const cash = owner.cash;
    const steps = drain(g.rules!.landOnFacility!(g, owner, f) as never);
    expect(steps.some(s => s.t === 'fx' && s.kind === 'cn-dice-roll')).toBe(false);
    expect(owner.cash).toBe(cash);
  });

  it('anyone else bets: right gets 5,000 × the index from the owner, wrong pays 10,000 × it; 3–10 小, 11–18 大', () => {
    let wins = 0, n = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const { g, f, visitor, owner } = scene(seed);
      g.priceIndex = 2;
      const before = visitor.cash + visitor.bank, ob = owner.cash + owner.bank;
      const steps = drain(g.rules!.landOnFacility!(g, visitor, f) as never);
      const roll = steps.find(s => s.t === 'fx' && s.kind === 'cn-dice-roll') as Extract<Step, { t: 'fx' }>;
      const d = roll.data as { dice: number[]; sum: number; big: boolean; isBig: boolean; hit: boolean };
      expect(d.sum).toBe(d.dice[0] + d.dice[1] + d.dice[2]);
      expect(d.isBig).toBe(d.sum >= 11);
      expect(d.hit).toBe(d.big === d.isBig);
      const got = visitor.cash + visitor.bank - before, gave = owner.cash + owner.bank - ob;
      if (d.hit) { expect(got).toBe(BET_WIN * 2); expect(gave).toBe(-BET_WIN * 2); wins++; }
      else { expect(got).toBe(-BET_LOSE * 2); expect(gave).toBe(BET_LOSE * 2); }
      n++;
    }
    expect(Math.abs(wins / n - 0.5)).toBeLessThan(0.08);   // even
  });
});

// 驛站快馬 on 長安 itself (its map file: maps/remake/changan.json, exported from the editor)
const changan = () => parseBoard(JSON.parse(readFileSync(fileURLToPath(new URL('../../../editor/site/assets/remake/changan.json', import.meta.url)), 'utf8')) as RawMap);
describe('長安 驛站', () => {
  const game = (seed: number, human = true) => {
    const g = new Game({ ...settings(seed), mapId: 110, players: [0, 4, 9, 11].map((character, i) => ({ character, human: human && i === 0 })) }, changan());
    for (const q of g.players) { q.placed = true; q.whoPlays = q.human ? 1 : 2; q.cash = 50000; }
    return g;
  };
  const posts = (g: Game) => Object.entries(g.board.specials ?? {}).filter(([, k]) => k.startsWith('post')).map(([n, k]) => [Number(n), k] as const);
  it('the map names its three stations', () => {
    expect(posts(game(1)).map(([, k]) => k).sort()).toEqual(['post-c', 'post-e', 'post-w']);
  });
  it('a ride: 1,000 × the index, to the station picked, the turn over there', () => {
    const g = game(2), p = g.players[0], [[from], [to]] = posts(g);
    g.priceIndex = 2; p.node = from;
    const f = (g as unknown as { land(p: unknown): Generator<Step, void, unknown> }).land(p);
    const seen: Step[] = [];
    for (let r = f.next(); !r.done; ) { seen.push(r.value); r = f.next((r.value as { ask?: boolean }).ask ? to : undefined); }
    expect(seen.some(s => (s as { t: string }).t === 'cn-post')).toBe(true);
    expect(p.node).toBe(to);
    expect(p.cash).toBe(50000 - 2000);
  });
  it('no money, no ride', () => {
    const g = game(3), p = g.players[0], [[from], [to]] = posts(g);
    p.node = from; p.cash = 500;
    const f = (g as unknown as { land(p: unknown): Generator<Step, void, unknown> }).land(p);
    for (let r = f.next(); !r.done; ) r = f.next((r.value as { ask?: boolean }).ask ? to : undefined);
    expect(p.node).toBe(from);
    expect(p.cash).toBe(500);
  });
});

describe('長安 貢院', () => {
  const exam = fileURLToPath(new URL('../../../editor/site/assets/remake/changan/exam/', import.meta.url));
  const game = (seed: number, human = true) => {
    const g = new Game({ ...settings(seed), mapId: 110, players: [0, 4, 9, 11].map((character, i) => ({ character, human: human && i === 0 })) }, changan());
    for (const q of g.players) { q.placed = true; q.whoPlays = q.human ? 1 : 2; q.cash = 50000; q.bank = 0; }
    return g;
  };
  const visit = (g: Game, p: { id: number }, answer: (a: { t: string; q?: number }) => unknown) => {
    const f = (g.rules as ChanganRules).exam(g, g.players[p.id]);
    const asks: { t: string }[] = [];
    for (let r = f.next(); !r.done; ) { const s = r.value as { ask?: boolean; t: string }; if (s.ask) asks.push(s); r = f.next((s.ask ? answer(s) : undefined) as never); }
    return asks;
  };
  it('the banks hold the counts the rules draw from', () => {
    EXAM_COUNTS.forEach((n, i) => expect(JSON.parse(readFileSync(`${exam}tier${i + 1}.json`, 'utf8')).length).toBe(n));
  });
  it('a human: right climbs the ranks with their prizes (× the half index), wrong falls back to 平民', () => {
    const g = game(4), p = g.players[0], R = g.rules as ChanganRules;
    g.priceIndex = 3;   // × (1 + 2 / 2) = × 2
    let cash = p.cash;
    for (let k = 0; k < 6; k++) {
      const asks = visit(g, p, () => 0);
      expect((asks[0] as unknown as { tier: number }).tier).toBe(Math.min(k + 1, 5));
      cash += EXAM_PRIZE[Math.min(k, 4)] * 2;
      expect(p.cash).toBe(cash);
      expect(R.examRun[0]).toBe(k + 1);
    }
    visit(g, p, () => 1);
    expect(p.cash).toBe(cash);
    expect(R.examRun[0]).toBe(0);
    visit(g, p, () => -1);   // the time ran out
    expect(R.examRun[0]).toBe(0);
  });
  it('computers by level: 簡單 80/50/30/10, 中等 80/60/40/20, 困難 90/70/50/30, 地獄 90/70/50/40 %; 狀元 less 10 points a stop', () => {
    expect([1, 2, 3, 4, 5].map(t => examRate(t, 0, 0))).toEqual([0.8, 0.5, 0.3, 0.1, 0.1]);
    expect([1, 2, 3, 4, 5].map(t => examRate(t, 0, 1))).toEqual([0.8, 0.6, 0.4, 0.2, 0.2]);
    expect([1, 2, 3, 4, 5].map(t => examRate(t, 0, 2))).toEqual([0.9, 0.7, 0.5, 0.3, 0.3]);
    expect([1, 2, 3, 4, 5].map(t => examRate(t, 0, 3))).toEqual([0.9, 0.7, 0.5, 0.4, 0.4]);
    expect([0, 1, 2, 3, 4, 5].map(n => Math.round(examRate(5, n, 3) * 10) / 10)).toEqual([0.4, 0.3, 0.2, 0.1, 0, 0]);
    for (const tier of [1, 2, 3, 4]) {
      let right = 0; const N = 600;
      for (let s = 0; s < N; s++) {
        const g = game(1000 + s, false), R = g.rules as ChanganRules;
        R.examRun[1] = tier - 1;
        visit(g, g.players[1], () => undefined);
        if (R.examRun[1] === tier) right++;
      }
      expect(Math.abs(right / N - examRate(tier, 0))).toBeLessThan(0.07);
    }
  }, 30000);
  it('a run and the 狀元 stops come back with a save', () => {
    const g = game(5), R = g.rules as ChanganRules;
    R.examRun = [3, 5, 0, 1]; R.examTop = [0, 2, 0, 0];
    const h = new Game({ ...settings(5), mapId: 110 }, changan());
    (h.rules as ChanganRules).loadState(JSON.parse(JSON.stringify(R.saveState())));
    expect((h.rules as ChanganRules).examRun).toEqual([3, 5, 0, 1]);
    expect((h.rules as ChanganRules).examTop).toEqual([0, 2, 0, 0]);
  });
});

describe('長安 鬥雞場', () => {
  const game = (seed: number) => {
    const g = new Game({ ...settings(seed), mapId: 110, players: [0, 4, 9, 11].map((character, i) => ({ character, human: i === 0 })) }, changan());
    for (const q of g.players) { q.placed = true; q.whoPlays = q.human ? 1 : 2; q.cash = 50000; q.bank = 0; q.points = 100; }
    return g;
  };
  const visit = (g: Game, answer: (a: { stars: number[]; pairs: number[][] }) => unknown) => {
    const f = (g.rules as ChanganRules).cock(g, g.players[0]);
    let fx: { data: { rank: number[]; hit: boolean; prize: number; odds: number } } | undefined;
    for (let r = f.next(); !r.done; ) {
      const s = r.value as { ask?: boolean; t: string; kind?: string };
      if (s.t === 'fx' && s.kind === 'cn-cock-fight') fx = s as never;
      r = f.next((s.ask ? answer(s as never) : undefined) as never);
    }
    return fx;
  };
  it('the outcomes cover every order once, their chances add up to 1', () => {
    const o = cockOutcomes([1, 3, 5, 2], [[0, 1], [2, 3]]);
    expect(o.length).toBe(16);
    expect(o.reduce((s, x) => s + x.p, 0)).toBeCloseTo(1, 9);
    expect(cockOdds([1, 3, 5, 2], [[0, 1], [2, 3]], 'ex', [0, 1])).toBe(0);   // the same half never meets in the final
  });
  it('fair: over many fights each bet pays back about 90 % (the house keeps 10 %)', () => {
    let staked = 0, back = 0;
    for (let s = 0; s < 1500; s++) {
      const g = game(5000 + s), p = g.players[0], before = p.cash;
      const fx = visit(g, a => ({ type: 'win', picks: [a.stars.indexOf(Math.min(...a.stars))], stake: 'cash' }));
      staked += 1000; back += p.cash - before + 1000;
      expect(fx!.data.prize).toBe(fx!.data.hit ? Math.round(1000 * fx!.data.odds) : 0);
    }
    expect(back / staked).toBeGreaterThan(0.75);
    expect(back / staked).toBeLessThan(1.05);
  }, 30000);
  it('the 點券 stake: 10 out, 10 × the odds back on a win; no 點券, no 點券 bet', () => {
    const g = game(7), p = g.players[0];
    const fx = visit(g, a => ({ type: 'place', picks: [0], stake: 'points', _: a }));
    expect(p.points).toBe(100 - 10 + (fx!.data.hit ? Math.round(10 * fx!.data.odds) : 0));
    const h = game(8); h.players[0].points = 5;
    expect(visit(h, () => ({ type: 'win', picks: [0], stake: 'points' }))).toBeUndefined();
    expect(h.players[0].points).toBe(5);
  });
});

describe('長安 新聞・命運・發配所', () => {
  const game = (seed: number) => {
    const g = new Game({ ...settings(seed), mapId: 110, players: [0, 4, 9, 11].map((character, i) => ({ character, human: i === 0 })) }, changan());
    for (const q of g.players) {
      const n = g.board.nodes[10 + q.id * 7];
      q.placed = true; q.whoPlays = q.human ? 1 : 2; q.cash = 50000; q.bank = 20000; q.points = 50; q.node = n.id; q.lastNode = n.adjacent.find(Boolean) ?? n.id;
    }
    return g;
  };
  const drive = (f: Generator<unknown, unknown, unknown>) => {
    const steps: { t: string; kind?: string; data?: Record<string, unknown> }[] = [];
    for (let r = f.next(); !r.done; ) { const s = r.value as { t: string; ask?: boolean }; steps.push(s as never); r = f.next((s.ask ? undefined : undefined) as never); }
    return steps;
  };
  it('every draw shows a 長安 card with its own picture, and never an empty placeholder', () => {
    const shown = new Set<string>();
    for (let s = 1; s <= 300; s++) for (const kind of ['news', 'fate'] as const) {
      const g = game(s), p = g.players[0];
      const steps = drive((g.rules as ChanganRules).draw(g, p, kind) as never);
      const board = steps.find(x => x.t === 'fx' && (x.kind === 'news' || x.kind === 'fate'));
      expect(board, `${kind} seed ${s}`).toBeTruthy();
      const local = String(board!.data?.local ?? '');
      expect(local).toMatch(/^(ca-[nf]-|exile)/);
      expect(String(board!.data?.text)).not.toMatch(/\{\w+\}/);
      shown.add(local);
    }
    expect(shown.size).toBeGreaterThan(60);
  });
  it('發配所: the player ends on the exile square', () => {
    let done = 0;
    for (let s = 1; s <= 400 && !done; s++) {
      const g = game(s), p = g.players[0];
      const steps = drive((g.rules as ChanganRules).draw(g, p, 'fate') as never);
      if (steps.some(x => x.t === 'fx' && x.kind === 'cn-exile')) { expect(g.board.specials?.[p.node]).toBe('exile'); done++; }
    }
    expect(done).toBe(1);
  });
});

describe('長安 old saves', () => {
  it('a game saved before the special squares and the company links gets them back on load', async () => {
    const { saveGame, loadGame } = await import('./save');
    const g = new Game({ ...settings(9), mapId: 110 }, changan());
    delete g.board.specials;                                   // as saved by the build before 2026-11-19 evening
    const co = g.board.companies.find(c => c.name === '西域駝隊')!;
    const st = g.stocks.stocks[co.stockSlot]; st.companyId = 0; st.floatPool = 10000; co.freeShares = 0; delete g.stocks.ownShares;
    const save = JSON.parse(JSON.stringify(saveGame(g)));
    expect(save.board.specials).toBeUndefined();
    const h = loadGame(save, changan());
    expect(Object.values(h.board.specials ?? {}).filter(k => k === 'exam').length).toBe(3);
    const c2 = h.board.companies.find(c => c.name === '西域駝隊')!;
    expect(h.stocks.slotOf(c2)).toBe(c2.stockSlot);
    expect(c2.freeShares).toBe(5000);
  });
});
