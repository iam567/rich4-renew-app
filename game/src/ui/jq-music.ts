/**
 * 激情歲月's own music (docs/rules/24 §16, the user 2026-10-23: 「BGM能不能換成那個時代的感覺」, 「做出廣播喇叭放出來的特效感覺」):
 * five instrumental pieces heard as from the street loudspeakers, rotating in place of the original's eight
 * background tracks (the march first), and a short fanfare at the 穿越 intro's end and at the game's end. Only on this
 * map, only in a normal game, and only while 「專屬音樂」 is on (default); everywhere else the original's music
 * (the user: 「只在激情歲月這張地圖」). Made with Suno through sunoapi.org; files and licence notes in doc 24 §16.
 */
import { ASSETS } from './assets';
import type { MusicSet } from './audio';

/** The background tracks in the order they rotate: the march is the default (the user's pick). */
export const JQ_TRACKS = ['jq-march', 'jq-anthem', 'jq-folk', 'jq-opera-a', 'jq-opera-b'] as const;
export const JQ_FANFARE = 'jq-fanfare';
/** 激情歲月's map id (core/jiqing.ts JQ_MAP; repeated here so this module stays free of the game's rules). */
const JQ_MAP_ID = 107;

const KEY = 'rich4.jqmusic';
/** 專屬音樂: 0 on (default), 1 off (the original's music on this map too). */
export function jqMusicMode(): number {
  try { return localStorage.getItem(KEY) === '1' ? 1 : 0; } catch { return 0; }
}
export function setJqMusicMode(v: number) {
  try { localStorage.setItem(KEY, String(v)); } catch { /* not kept */ }
}

const file = (name: string) => ({ name, url: `${ASSETS}/maps/remake/jiqing/music/${name}.m4a`, len: 0 });

/** The set itself (lengths come from the files). */
export function jqMusicSet(): MusicSet {
  // (no screen themes of its own: the shop, the lottery and the results share the original's theme 6, so the results'
  // fanfare is played by main.ts at the game's end instead)
  return { tracks: JQ_TRACKS.map(file), fanfare: file(JQ_FANFARE) };
}

/** Which music a game plays: 激情歲月's own on that map (a normal game, the setting on), else none (the original's). */
export function musicSetFor(mapId: number, o: { tycoon?: boolean; on?: boolean } = {}): MusicSet | null {
  if (mapId !== JQ_MAP_ID || o.tycoon) return null;
  return (o.on ?? jqMusicMode() === 0) ? jqMusicSet() : null;
}
