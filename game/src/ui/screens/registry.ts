/**
 * Full screens for questions and announcements (docs/rules/09 §6-§7): the shop, bank, lottery, hospital,
 * magic house, card announcements … Each lives in its own file in this folder and registers itself here;
 * screens/index.ts imports them all. A question is routed by its type (`ask.t`), a `choose` question also by
 * its `screen` tag (key `choose:<tag>`); an announcement (`fx` event) by its kind.
 */
import type { Game } from '../../core/game';
import type { Ask, GameEvent } from '../../core/types';
import type { SpriteBank } from '../sprites';

export interface ScreenContext {
  game: Game;
  bank: SpriteBank;
  /** The map area: dialogs and map-sized scenes go here (09: most sub-screens cover the 440×440 map view). */
  area: HTMLElement;
  /** The whole game screen, for scenes that cover everything (the original's 640×480 screens). */
  shell: HTMLElement;
  /**
   * Show a node on the dialog layer over the map / take it down. `full`: over the whole game screen instead (a sheet
   * with more than the map area of a small phone can hold).
   */
  open(node: HTMLElement, full?: boolean): void;
  close(): void;
  /** Time scale of the game speed (1 = slow, 0.33 = fast); multiply waits by it. */
  scale(): number;
  /** Message box / speech cloud, for screens that want to show a line on their own. */
  flash(text: string, ms?: number): Promise<void>;
}

/** Answers the question with the value the rules expect for that ask type. */
export type AskScreen = (ctx: ScreenContext, ask: Ask) => Promise<unknown>;
/** Shows an announcement; resolves when the player has seen it. */
export type FxScreen = (ctx: ScreenContext, fx: Extract<GameEvent, { t: 'fx' }>) => Promise<void>;

export const askScreens: Record<string, AskScreen> = {};
export const fxScreens: Record<string, FxScreen> = {};

/** Key for a question: its type, or `choose:<screen>` for a tagged choice. */
export const askKey = (a: Ask): string => (a.t === 'choose' && a.screen ? `choose:${a.screen}` : a.t);

/**
 * Screens that can stay open between events (the wheel and the slot machine a question leaves up for the event that
 * follows it …) register how to close themselves here: the hang guard (main.ts) calls `closeStuckScreens()` when it
 * gives up waiting for an event, so nothing stuck is left over the map (or keeps a looping sound going).
 */
const stuckClosers = new Set<() => void>();
export function onStuck(close: () => void): void { stuckClosers.add(close); }
export function closeStuckScreens(): void {
  for (const f of stuckClosers) { try { f(); } catch { /* the rest still close */ } }
}
