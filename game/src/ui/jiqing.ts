/**
 * 激情歲月 on the board (docs/rules/24, the remake's 自製地圖 #8, map 107): its facilities' and houses' sprites (§2,
 * §2.3), the redrawn event pads (§4), the 學習班 / 下鄉 badges (§2.4), the shown year (§10: from 1966), and the settings
 * of its street, loudspeakers and quotations. Everything here is off unless the game has the map's rules (`jqRules`),
 * so every other map is drawn as before. The street is ui/jq-street.ts, the screens screens/jq-*.ts, the rules
 * core/jiqing.ts.
 *
 * Nothing here touches the rules' rand(): the looks of the lots come from a hash of the map and the lot.
 */
import { jqRules, JQ_MAP } from '../core/jiqing'; // also registers map 107's rules for a normal game
import type { Game } from '../core/game';
import type { Player } from '../core/types';
import { day, month, year } from '../core/date';
import { memTier } from './mem-tier';
import type { BoardNode } from '../core/board';
import type { SpriteBank } from './sprites';
import { ASSETS } from './assets';

export { jqRules, JQ_MAP };

/** The large plots' sprites by facility type (editor/jiqing_layout.py FAC_SPRITES): 人民公園 one level, the others five. */
const FAC_FIRST: Record<number, number> = { 0: 3631, 1: 3632, 2: 3637, 14: 3642, 4: 3647 };
/** The small lots' houses (LOT_SPRITES): level 1 eight 胡同 shops (3601..), level 2 the same eight grown (3609..),
 * levels 3 / 4 / 5 three 筒子樓 / 蘇式紅磚樓 / 蘇式大樓 each (3617.., 3620.., 3623..). */
const LOT1 = 3601, LOT2 = 3609, TALL: Record<number, number> = { 3: 3617, 4: 3620, 5: 3623 };
const SHOPS = 8, TALL_VARIANTS = 3;
/** The redrawn pads: 9100 + the pad's aux (frame aux − 1 of map#24), the branch bank's own sign 9150. */
const PAD_AUX = new Set([1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27, 29, 31]);
const PAD_BRANCH = 9150;

/** A facility's sprite on 激情歲月 (null elsewhere). */
export function jqFacSprite(game: Game, fa: { type: number; level: number }): number | null {
  if (!fa.level || !jqRules(game)) return null;
  const first = FAC_FIRST[fa.type];
  if (first === undefined) return null;
  return fa.type === 0 ? first : first + Math.max(1, Math.min(5, fa.level)) - 1;
}

const looks = new WeakMap<object, { style: number[]; tall: number[] }>();
function hash(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d); h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return (h ^ (h >>> 15)) >>> 0;
}
/** Which shop and which tall block each lot has: a hash of the map and the lot, never the same as the lot before it on its street. */
function lotLooks(game: Game): { style: number[]; tall: number[] } {
  const lands = game.board.lands;
  let v = looks.get(lands);
  if (!v) {
    v = { style: [], tall: [] };
    lands.forEach((l, i) => {
      const h = hash(game.settings.mapId, l.id), same = i > 0 && lands[i - 1].name === l.name;
      let st = h % SHOPS, tv = (h >>> 8) % TALL_VARIANTS;
      if (same && st === v!.style[i - 1]) st = (st + 1) % SHOPS;
      if (same && tv === v!.tall[i - 1]) tv = (tv + 1) % TALL_VARIANTS;
      v!.style.push(st); v!.tall.push(tv);
    });
    looks.set(lands, v);
  }
  return v;
}

/** A small lot's building on 激情歲月 at its level (chain stores keep the original's). */
export function jqHouseSprite(game: Game, l: { id?: number; level: number; chain: number | boolean }): number | null {
  if (!l.level || l.chain || !jqRules(game)) return null;
  const lv = Math.max(1, Math.min(5, l.level)), i = game.board.lands.findIndex(x => x.id === l.id);
  const { style, tall } = lotLooks(game);
  const st = i < 0 ? 0 : style[i], tv = i < 0 ? 0 : tall[i];
  return lv === 1 ? LOT1 + st : lv === 2 ? LOT2 + st : TALL[lv] + tv;
}

/** The redrawn pad of a square (its map sprite), or 0: the original's map#24 frame. */
export function jqPadSprite(game: Game, n: BoardNode): number {
  if (!n.aux || !jqRules(game)) return 0;
  if (n.aux === 27 && isBranch(game, n)) return PAD_BRANCH;
  return PAD_AUX.has(n.aux) ? 9100 + n.aux : 0;
}
/** The second bank (人民銀行支行, §1.3): the bank square farther east (崇文門; 人民銀行 is at 府右街口). */
const branchOf = new WeakMap<object, number>();
function isBranch(game: Game, n: BoardNode): boolean {
  let id = branchOf.get(game.board);
  if (id === undefined) {
    const banks = game.board.nodes.filter(x => x.event === 14);
    id = banks.length > 1 ? banks.reduce((a, b) => (b.x + b.y > a.x + a.y ? b : a)).id : -1;
    branchOf.set(game.board, id);
  }
  return n.id === id;
}

/** The signs over a player's head (§2.4 「學習班中」). */
export function jqBadges(game: Game, pid: number): { text: string; kind: 'busy' | 'gang' | 'taxi' }[] {
  const jq = jqRules(game);
  if (!jq) return [];
  return (jq.s.study[pid] ?? 0) > 0 ? [{ text: '學習班中', kind: 'busy' }] : [];
}

/** The same signs on the player panel (ui/side.ts): 「學習班 還剩N天」. */
export function jqPanelTags(game: Game, p: Player): string {
  const jq = jqRules(game);
  if (!jq) return '';
  const n = jq.s.study[p.id] ?? 0;
  return n > 0 ? `<div class="pp-kb busy" style="--i:0">學習班 還剩${n}天</div>` : '';
}

/** The year the calendar shows (§10): from 1966 on this map (only shown; the rules' dates are the game's). */
export function shownYear(game: Game, d: number): number {
  return jqRules(game) ? year(d) - year(game.settings.startDate) + 1966 : year(d);
}

/** The weekday the calendar shows (§10): that of the shown year's date (1966-10-22 was a Saturday), 0 = Sunday. */
export function shownWeekday(game: Game, d: number): number {
  return new Date(Date.UTC(shownYear(game, d), month(d) - 1, day(d))).getUTCDay();
}

// ------------------------------------------------------------------ settings

const KEY_LOUD = 'rich4.loudspeaker', KEY_QUOTES = 'rich4.quotes';
const stored = (key: string, fallback: number) => {
  try { const v = localStorage.getItem(key); return v === '0' || v === '1' ? Number(v) : fallback; } catch { return fallback; }
};
const listeners = new Set<() => void>();
const write = (key: string, v: number) => {
  try { localStorage.setItem(key, String(v)); } catch { /* not kept */ }
  for (const f of listeners) f();
};
/** 大喇叭廣播 (§9.3): on by default, even on the low memory tier (synthesised, next to no memory). */
export const loudspeakerMode = () => stored(KEY_LOUD, 0);
export const setLoudspeakerMode = (v: number) => write(KEY_LOUD, v);
/** 語錄開場白 (§7.1): on by default. */
export const quotesMode = () => stored(KEY_QUOTES, 0);
export const setQuotesMode = (v: number) => write(KEY_QUOTES, v);
export const onJqSettings = (f: () => void) => { listeners.add(f); return () => listeners.delete(f); };

/** The walkers' count by memory tier (§8.1: as 歌舞伎町's: low 30 / mid 60 / high 100). */
export const jqTier = () => memTier();

// ------------------------------------------------------------------ the place screens (§11.3)

/**
 * The place screens' backgrounds and hostesses in the era's look on this map (tools/tycoon-art/jq_places.py →
 * maps/remake/jiqing/places/places.json); any other map: the originals (the sprite bank is shared between games).
 */
export async function prepareJiqingPlaces(bank: SpriteBank, on: boolean): Promise<void> {
  if (!on) { bank.setArtOverrides(null); return; }
  const base = `${ASSETS}/maps/remake/jiqing/places`;
  try {
    const r = await fetch(`${base}/places.json`);
    bank.setArtOverrides(r.ok ? await r.json() as Record<string, [string, number, number, number, number]> : null, base);
  } catch { bank.setArtOverrides(null); }
}
