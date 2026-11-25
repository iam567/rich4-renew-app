/**
 * The 'cinema' announcements (ui/tool-cinema.ts's films of 道具 and 高級卡片) as steps of the game's stream: the screen
 * wraps `Tools.use` and `Cards.play` and puts one { t: 'fx', kind: 'cinema' } right before the event the effect
 * starts with. The rules never read it, but it is a step: 排行榜's record (core/replay.ts) counts the screen's steps,
 * so the replay must take the same ones (the first records of 1.2.4 were refused for this — the user 2026-11-16).
 * Here, without the screen, so both the screen and the replay install the very same thing.
 */
import { Cards } from './modules/cards';
import { Tools } from './modules/tools';
import type { Flow } from './flow';
import type { GameEvent, Player } from './types';

/** The tools and cards that have a cinematic, by id. */
export const TOOL_KEY: Record<number, string> = { 5: 'scooter', 6: 'car', 7: 'missile', 9: 'robot-worker', 10: 'time-machine', 11: 'teleporter', 12: 'construction', 13: 'nuke', 14: 'super-worker', 16: 'space-time' };
export const CARD_KEY: Record<number, string> = { 1: 'card-1', 2: 'card-2', 9: 'card-9', 10: 'card-10', 11: 'card-11', 15: 'card-15', 34: 'card-34', 39: 'card-39' };

type Ev = GameEvent;
const isAsk = (s: unknown) => !!s && typeof s === 'object' && 'ask' in (s as object);
/** The event a tool's effect starts with: the cinematic goes right before it. */
function toolStarts(tool: number, s: Ev): boolean {
  const fx = s.t === 'fx' ? s.kind : '';
  switch (tool) {
    case 5: return fx === 'scooter';
    case 6: return fx === 'car';
    case 7: return fx === 'missile';
    case 13: return fx === 'nuke';
    case 9: case 14: return fx === 'robot-worker';
    case 10: return fx === 'time-machine';
    case 12: return fx === 'construction';
    // 傳送機 / 時空機: the move itself (a person), the board (a lot or a thing), the crossing (another city).
    case 11: case 16: return s.t === 'teleport' || s.t === 'board' || fx === 'space-time' || fx === 'tycoon-notice';
  }
  return false;
}
/** A card's effect starts with its first announcement (or the board), not with the card shown, a line or a refusal. */
const cardStarts = (s: Ev) => (s.t === 'fx' && !['card', 'card-failed', 'card-line'].includes(s.kind)) || s.t === 'board' || s.t === 'teleport';

let onPick: (key: string) => void = () => {};
/** Passes `flow` through, putting the 'cinema' announcement of `key` before the first event `starts` accepts. */
function* withCinema<T>(flow: Flow<T>, p: Player, key: string, starts: (s: Ev) => boolean): Flow<T> {
  onPick(key);
  let shown = false;
  let r = flow.next();
  while (!r.done) {
    const s = r.value;
    if (!shown && !isAsk(s) && starts(s as Ev)) {
      shown = true;
      yield { t: 'fx', kind: 'cinema', p: p.id, data: { key } } as Ev;
    }
    r = flow.next(yield s);
  }
  return r.value;
}

let installed = false;
/** Wraps the rules' tool and card use (once). `pick`: the screen's (its films start loading when one is picked). */
export function installCinemaSteps(pick?: (key: string) => void) {
  if (pick) onPick = pick;
  if (installed) return;
  installed = true;
  const use = Tools.prototype.use;
  Tools.prototype.use = function (this: Tools, p: Player, tool: number, param?: number) {
    const key = TOOL_KEY[tool];
    return key ? withCinema(use.call(this, p, tool, param), p, key, s => toolStarts(tool, s)) : use.call(this, p, tool, param);
  };
  const proto = Cards.prototype as unknown as { play: (p: Player, id: number, human: boolean) => Flow<boolean> };
  const play = proto.play;
  proto.play = function (this: Cards, p: Player, id: number, human: boolean) {
    const key = CARD_KEY[id];
    return key ? withCinema(play.call(this, p, id, human), p, key, cardStarts) : play.call(this, p, id, human);
  };
}
