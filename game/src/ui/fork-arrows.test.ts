import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBoard, type RawMap } from '../core/board';
import { pack } from '../core/date';
import { Game } from '../core/game';
import { openExits } from '../core/modules/forks';
import { arrowsOf } from './fork-arrows';

// 岔路箭頭 on the map show only real choices (docs/rules/14 §5).
const asset = (f: string) => fileURLToPath(new URL(`../../../editor/site/assets/${f}`, import.meta.url));
const FILES: Record<number, string> = { 1: 'map-1.json', 7: 'map-7.json', 106: 'remake/kabukicho.json' };
const have = Object.values(FILES).every(f => existsSync(asset(f)));
const game = (mapId: number, seed: number) => new Game({
  mapId, players: [0, 4, 9, 11].map(character => ({ character, human: false })),
  fundIndex: 1, traffic: 0, landLimitIndex: 0, daysLimitIndex: 0, victoryIndex: 0, startDate: pack(2026, 10, 18), seed,
}, parseBoard(JSON.parse(readFileSync(asset(FILES[mapId]), 'utf8')) as RawMap));

/** Puts player 0 on `node`, come from `from`. */
function stand(g: Game, node: number, from: number) {
  const p = g.players[0];
  Object.assign(p, { placed: true, node, lastNode: from });
}

describe.skipIf(!have)('fork arrows: only where there is a choice', () => {
  it('an original map\'s prison spur passed on the main road gets no arrow; leaving the spur it does', () => {
    const g = game(1, 3), fork = g.forks.forks()[0];
    // Map 1's only fork (the prison junction): from the main road one way on, from the spur two.
    const spur = fork.adjacent.find(a => a && openExits(fork).filter(x => x !== a).length === 2)!;
    const road = fork.adjacent.find(a => a && a !== spur)!;
    expect(g.forks.plan(0).size).toBe(0);                   // not placed yet: nothing
    stand(g, road, g.node(road).adjacent.find(a => a && a !== fork.id)!);
    expect(g.forks.plan(0).has(fork.id)).toBe(true);      // on the route …
    expect(arrowsOf(g, 0).has(fork.id)).toBe(false);      // … but no arrow: one way only
    stand(g, fork.id, spur);
    expect(arrowsOf(g, 0).has(fork.id)).toBe(true);
  });

  it('every arrow shown is a real choice and what the player will do; crossroads keep theirs', () => {
    for (const mapId of [7, 106]) {
      const g = game(mapId, 11);
      for (const n of g.forks.forks()) for (const from of n.adjacent.filter(Boolean)) {
        stand(g, from, 0);
        g.players[0].lastNode = g.node(from).adjacent.find(a => a && a !== n.id) ?? 0;
        const passes: { at: number; to: number }[] = [], all = g.forks.plan(0, 600, undefined, passes), shown = arrowsOf(g, 0);
        for (const [id, to] of shown) expect(to).toBe(all.get(id));
        for (const id of all.keys()) {
          // Shown exactly where the side first arrived from leaves two or more ways (the walk: the plan's passes in order).
          let at = g.players[0].node, back = g.players[0].lastNode, arrive = -1, k = 0;
          for (let i = 0; i < 600 && arrive < 0; i++) { if (at === id) arrive = back; const next = g.forks.isFork(at) ? passes[k++].to : openExits(g.node(at)).filter(x => x !== back)[0] ?? back; back = at; at = next; }
          expect(shown.has(id), `map ${mapId} fork ${id}`).toBe(openExits(g.node(id)).filter(x => x !== arrive).length >= 2);
        }
      }
    }
  });

  it('walking out of a fork turns its arrow at once to a road not walked yet (14 §2)', () => {
    for (const mapId of [7, 106]) {
      const g = game(mapId, 5);
      let cases = 0;
      for (const n of g.forks.forks()) for (const from of n.adjacent.filter(a => a && openExits(n).filter(x => x !== a).length >= 2)) {
        const back = g.node(from).adjacent.find(a => a && a !== n.id) ?? 0;
        stand(g, from, back);
        const before = arrowsOf(g, 0).get(n.id);
        if (before === undefined) continue;     // not on this walk (another fork first sends them elsewhere)
        stand(g, n.id, from);
        expect(g.walkNext(0, n.id, from)).toBe(before);
        stand(g, from, back);
        const after = arrowsOf(g, 0).get(n.id);
        expect(after, `map ${mapId} fork ${n.id} from ${from}`).not.toBe(before);
        expect(g.forks.used[0][n.id]?.[after!] ?? 0).toBe(0);   // never used there yet
        g.forks.init();                                         // the next case starts clean
        cases++;
      }
      expect(cases, `map ${mapId}`).toBeGreaterThan(5);
    }
  });
});
