/**
 * 派對模式's version check (v0.7.4, issue #8: a PC and a phone could not play together — most likely two versions of
 * the app; the game runs in lockstep, so different rules silently desync). The guest's `hi` carries its version, the
 * host's answers (`lobby`, `bye`) carry the host's; a difference is refused with a plain message on both sides. Phones
 * of v0.7.3 and older send no version: a new host refuses them (their own screen shows the host's `bye` text), and a
 * new guest that hears from such a host (its `lobby` without a version) leaves at once with the same kind of message.
 *
 * From 1.2.0 on (core/compat.ts, the user 2026-11-12) phones of one big version (1.2.x) play together; a game plays at
 * its room's oldest version, and each phone is told in the chat what its own version has that this game goes without.
 *
 * The texts are in the UI's Traditional Chinese (the page converts them to Simplified itself) and name no server: the
 * newest version is 「到下載頁下載」.
 */
import { family, lacking, oldest, together, type Change } from '../core/compat';
import type { LobbyStats, RoomInfo } from './party-net';

/**
 * This app's version as 派對模式 tells it. For testing two versions on one dev server only (never in a build): the
 * query `?partyver=0.7.2` or localStorage `rich4.partyver` fakes another version, and `none` plays an old phone that
 * sends no version and checks nothing (as v0.7.3 did). Null: that old phone.
 */
export function partyVersion(): string | null {
  const real = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0';
  if (!import.meta.env?.DEV || typeof location === 'undefined') return real;
  let fake = '';
  try { fake = new URLSearchParams(location.search).get('partyver') ?? localStorage.getItem('rich4.partyver') ?? ''; } catch { /* none */ }
  fake = fake.trim();
  if (!fake) return real;
  return fake === 'none' ? null : fake.replace(/^v/, '');
}

const UPDATE = '請兩邊都更新到最新版本後再連線';
const v = (s: string) => `v${s}`;

/** A version from a message (anything else: none). */
export const verOf = (x: unknown): string | null => (typeof x === 'string' && x.trim() ? x.trim().slice(0, 20) : null);

/**
 * Host: a guest's `hi` with version `theirs` (none: an old phone). Null when it may join; else the guest's text
 * (`why`, shown by old phones too: it says 「請出」 so their screen shows it, party.ts of v0.7.3) and the host's chat
 * line.
 */
export function refuseGuest(mine: string, theirs: unknown, guestName: string): { why: string; line: string } | null {
  const t = verOf(theirs);
  if (t !== null && together(mine, t)) return null;
  if (!t) return {
    why: `版本不同：房主是 ${v(mine)}，你的版本太舊，已被請出房間。\n${UPDATE}`,
    line: `${guestName}的版本太舊，和你的 ${v(mine)} 不同，無法加入`,
  };
  return {
    why: `版本不同：房主是 ${v(mine)}，你是 ${v(t)}。\n${UPDATE}`,
    line: `${guestName}的版本是 ${v(t)}，和你的 ${v(mine)} 不同，無法加入`,
  };
}

/** Guest: the host's version as its answer gives it (none: an old host). Null when they agree; else the text to show. */
export function hostMismatch(mine: string, hosts: unknown): string | null {
  const h = verOf(hosts);
  if (h !== null && together(mine, h)) return null;
  return h ? `版本不同：房主是 ${v(h)}，你是 ${v(mine)}。\n${UPDATE}` : `版本不同：房主的版本太舊（你是 ${v(mine)}）。\n${UPDATE}`;
}

/** The key a room or a seeker is counted under in the list (old phones: ''; 1.2.0 on: its family, which plays together). */
export const verKey = (x: unknown) => { const v = verOf(x); return v === null ? '' : together(v, `${family(v)}.999`) ? family(v) : v; };

/**
 * The title's figures for each version (the list's holder works them out; a phone takes its own version's): the
 * 私享 rooms open and the people waiting for partners (players of shared rooms not started, plus seekers).
 */
export function statsByVersion(rooms: RoomInfo[], seekers: (string | null | undefined)[]): Record<string, LobbyStats> {
  const by: Record<string, LobbyStats> = {};
  const of = (k: string) => (by[k] ??= { privateRooms: 0, waiting: 0 });
  for (const r of rooms) { const s = of(verKey(r.ver)); if (r.private) s.privateRooms++; else s.waiting += r.players; }
  for (const k of seekers) of(verKey(k)).waiting++;
  return by;
}

/** Whether a listed room can be joined from this version (an old room, or another version's: shown 「版本不同」). */
export const sameVersion = (r: RoomInfo, mine: string | null) => { const v = verOf(r.ver); return mine === null || (v !== null && together(v, mine)); };

/**
 * The level a room of these versions plays at (core/compat.ts): its oldest (undefined: none known). A game always
 * carries it, so a newer phone coming in later (圍觀, 途中加入) plays it the same way too.
 */
export const roomLevel = (vers: (string | null | undefined)[]) => oldest(vers.map(verOf).filter((v): v is string => v !== null));

/** What this phone (`mine`) is told when its room plays at `level`: what goes without, as on the older version; '' when nothing does. */
export function levelNote(level: string | undefined, mine: string, changes?: readonly Change[]): string {
  if (!level || level === mine) return '';
  const off = lacking(level, mine, changes);
  return off.length ? `房間裡有 ${v(level)} 的玩家，這局以下玩法不能用，會和 ${v(level)} 保持一致：${off.map(c => c.name).join('、')}` : '';
}

/**
 * Host: a phone of version `theirs` coming into the game going on at `level` (resume, 途中加入, 圍觀): its text when
 * it lacks a change the game plays with, else null.
 */
export function refuseLate(level: string, theirs: string, changes?: readonly Change[]): string | null {
  const need = lacking(theirs, level, changes);
  return need.length ? `這局用了 ${v(level)} 的玩法（${need.map(c => c.name).join('、')}），你是 ${v(theirs)}。\n${UPDATE}` : null;
}
