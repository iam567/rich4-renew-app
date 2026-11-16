/**
 * 排行榜's check (the user 2026-11-16: 改錢、改存檔、加速齒輪… 要防作弊): a game played from its start is its settings, its
 * map and what the player answered, step by step; the rules do the rest the same every time (no clock, no Math.random:
 * the same is what keeps 派對模式's phones together). The phone keeps the answers (GameLog) and sends them with a
 * record; the server plays the game again from them (tools/party-relay builds this file in) and takes its own figures —
 * money changed in memory, an edited save or a made-up record come out differently and are refused.
 *
 * Besides the answers two things the screen changes in the rules state are logged at their step: 取消托管 (a player's
 * autopilot off) and the 小遊戲 setting (by hand or automatic: whether a 小遊戲 asks the player).
 */
import { parseBoard, type RawMap } from './board';
import { Game } from './game';
import { mapKey, notRanked, scores } from './ranks';
import { attachLedger, ledgerOf } from './stats';
import type { Answer, GameSettings } from './types';
import './casino-rules'; // the maps' own rules (MAP_RULES), as the game loads them
import './kabukicho';
import './jiqing';
import './chongqing';

/** One game's answers: `a` [step, answer] for each step answered (the others got none), `t` [step, kind, value] the screen's changes. */
export interface GameLog { v: 1; anim: boolean; a: [number, Answer][]; t: [number, 'auto-off' | 'anim', number][] }

/** Keeps a game's answers while it is played (the screen calls `step` before each `flow.next`). */
export class Recorder {
  readonly log: GameLog;
  private n = 0;
  /** Steps taken so far. */
  get steps() { return this.n; }
  constructor(anim: boolean) { this.log = { v: 1, anim, a: [], t: [] }; }
  /** The answer about to be given at this step (undefined: none). */
  step(answer: Answer) { if (answer !== undefined) this.log.a.push([this.n, JSON.parse(JSON.stringify(answer))]); this.n++; }
  /** 取消托管 for seat `p`, before the next step. */
  autoOff(p: number) { this.log.t.push([this.n, 'auto-off', p]); }
  /** The 小遊戲 setting changed (1 by hand, 0 automatic), before the next step. */
  anim(on: boolean) { this.log.t.push([this.n, 'anim', on ? 1 : 0]); }
}

/** What a replayed game came to: why it cannot rank ('' it can), and its figures. */
export interface Replayed { why: string; winner: number; days: number; rich: number; fierce: number; woe: number; char: number; map: string; level: number; /** each seat's cash + deposit at the end */ money: number[] }

/**
 * Plays a game again from its settings, map and log. `maxSteps` guards a log that never ends. Throws nothing: a log
 * that does not fit the game (an answer where none is asked, steps left over) is 'log'.
 */
export function replay(settings: GameSettings, raw: RawMap, log: GameLog, maxSteps = 3_000_000, stopAt = Infinity): Replayed {
  const g = new Game(settings, parseBoard(raw));
  const ledger = attachLedger(g.players);
  g.animation = !!log.anim;
  const answers = new Map(log.a.map(([i, a]) => [i, a]));
  const tweaks = new Map<number, [string, number][]>();
  for (const [i, k, v] of log.t) tweaks.set(i, [...(tweaks.get(i) ?? []), [k, v]]);
  const last = Math.max(-1, ...log.a.map(([i]) => i), ...log.t.map(([i]) => i));
  const flow = g.run();
  const out = (why: string): Replayed => {
    const winner = g.over ? g.over.winner : -1, me = g.players[winner];
    const s = me ? scores(ledger.of(me.id)) : { fierce: 0, woe: 0 };
    return { why, winner, days: g.daysElapsed, rich: me ? Math.round(g.wealth(me)) : 0, ...s, char: me?.character ?? -1, map: mapKey(g), level: g.settings.aiLevel ?? 0, money: g.players.map(p => p.cash + p.bank) };
  };
  let n = 0, r = (() => { for (const [k, v] of tweaks.get(0) ?? []) apply(k, v); return flow.next(answers.get(0)); })();
  function apply(k: string, v: number) {
    if (k === 'auto-off' && g.players[v]) g.players[v].autopilot = false;
    if (k === 'anim') g.animation = v === 1;
  }
  while (!r.done) {
    if (++n > maxSteps) return out('steps');
    if (n >= stopAt) return out('stopped');   // (a check of a game still going: the state after the same steps)
    const s = r.value as { ask?: boolean };
    const a = answers.get(n);
    if (a !== undefined && !('ask' in s)) return out('log');
    for (const [k, v] of tweaks.get(n) ?? []) apply(k, v);
    r = flow.next(a);
  }
  if (n < last) return out('log');
  if (!g.over) return out('unfinished');
  return out(notRanked(g, g.over.winner));
}

/** The ledger figures of a played game (the phone's own record, compared in tests with the replay). */
export const ledgerScores = (g: Game, p: number) => scores(ledgerOf(g.players)!.of(p));
