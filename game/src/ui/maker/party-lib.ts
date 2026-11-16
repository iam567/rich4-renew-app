/**
 * 派對模式 on players' maps (the user 2026-11-12: only maps their makers verified and published): a room's map may be
 * one from the 地圖庫 — the room keeps it as `lib:<id>`, the game's settings as `libMap` — and every phone takes the
 * same copy from the library and builds it under LIB_MAP_ID before the game begins (compile.ts prepareMakerMap).
 * The host offers the maps this phone added to 派對模式 from the 地圖庫's map pages — three at most (the user
 * 2026-11-12: with many maps, picking among them all would be hard; to play another, take one out first).
 */
import type { GameSettings } from '../../core/types';
import { prepareMakerMap } from './compile';
import { libraryBase } from './library';
import { parseMap } from './model';
import { deviceId } from '../party-presence';

/**
 * Whether 派對模式 offers library maps at all (the user 2026-11-12: hidden at 1.2's release — the editor and the
 * library first, rooms on players' maps once the library has many). Off: no 加到派對模式, no 自建地圖 in a new room;
 * a room on one (a newer phone's) still plays.
 */
export const PARTY_LIB_ON = false;

/** The map id a room's library map plays under, on every phone. */
export const LIB_MAP_ID = 7000;
export interface PartyLibMap { lib: string; name: string; thumb: string }

const names = new Map<string, string>();
/** A room map's name when it is a library map (`lib:<id>`); '' while unknown. */
export const libMapName = (key: string) => names.get(key.replace(/^lib:/, '')) ?? '';
export const isLibKey = (key: string) => /^lib:[a-z0-9]{8}$/.test(key);

const PARTY_KEY = 'rich4.party.libMaps';
/** How many library maps 派對模式 holds. */
export const PARTY_LIB_MAX = 3;
/** The library maps added to 派對模式 (id and name), in the order added. */
export function partyLibs(): { lib: string; name: string }[] {
  try { const l = JSON.parse(localStorage.getItem(PARTY_KEY) ?? '[]'); return Array.isArray(l) ? l.filter(x => typeof x?.lib === 'string').slice(0, PARTY_LIB_MAX) : []; } catch { return []; }
}
const keepPartyLibs = (l: { lib: string; name: string }[]) => { try { localStorage.setItem(PARTY_KEY, JSON.stringify(l)); } catch { /* not kept */ } };
export const inParty = (lib: string) => partyLibs().some(x => x.lib === lib);
/** Adds a library map to 派對模式: false when three are there already. */
export function addPartyLib(lib: string, name: string): boolean {
  const l = partyLibs();
  if (l.some(x => x.lib === lib)) return true;
  if (l.length >= PARTY_LIB_MAX) return false;
  keepPartyLibs([...l, { lib, name }]);
  return true;
}
export const removePartyLib = (lib: string) => keepPartyLibs(partyLibs().filter(x => x.lib !== lib));

/** The maps added to 派對模式, with their pictures. */
export async function myLibMaps(): Promise<PartyLibMap[]> {
  let base = '';
  try { base = await libraryBase(); } catch { /* no pictures */ }
  return partyLibs().map(x => { names.set(x.lib, x.name); return { lib: x.lib, name: x.name, thumb: base ? `${base}/maps/${x.lib}.jpg` : '' }; });
}

let ready: { lib: string; p: Promise<Partial<GameSettings>> } | null = null;
/**
 * Builds the library map `lib` for a game (fetched once; built again only for another map); resolves with what the
 * game's settings take from it (its cards, its rules), the same on every phone.
 */
export function readyLibMap(lib: string): Promise<Partial<GameSettings>> {
  if (ready?.lib === lib) return ready.p;
  const p = (async () => {
    const r = await fetch(`${await libraryBase()}/maps/${lib}?nocount=1`, { cache: 'no-store' });
    if (!r.ok) throw new Error('這張地圖已經不在創作樂園了');
    const m = parseMap(await r.json());
    if (!m) throw new Error('地圖資料有問題');
    names.set(lib, m.name);
    const { extra } = await prepareMakerMap(m, LIB_MAP_ID);
    return { ...extra, libMap: lib };
  })();
  ready = { lib, p };
  p.catch(() => { if (ready?.p === p) ready = null; });
  return p;
}

/** A game begun on a library map in a room: counted as played (once a day for each phone, quietly). */
export function libPlayed(lib: string) {
  void libraryBase().then(b => fetch(`${b}/maps/${lib}/play`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dev: deviceId() ?? '' }) })).catch(() => {});
}
