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

const QKEY = 'rich4.jqmusicq';
/**
 * 音質 (issue #11: 「音質比較嘈雜，長時間聽很刺耳」): 0 大喇叭 (default, the owner's pick: the loudspeaker treatment
 * of §16), 1 清晰 (the same pieces without it: jq-*-clean.m4a, AAC 128 kb/s stereo, made from the clean Suno files).
 */
export const JQ_QUALITIES = ['大喇叭', '清晰'];
export function jqMusicQuality(): number {
  try { return localStorage.getItem(QKEY) === '1' ? 1 : 0; } catch { return 0; }
}
export function setJqMusicQuality(v: number) {
  try { localStorage.setItem(QKEY, String(v)); } catch { /* not kept */ }
}

// The clean files have names of their own, so the engine's decoded-buffer cache keeps both versions apart.
const file = (base: string, clean: boolean) => {
  const name = clean ? `${base}-clean` : base;
  return { name, url: `${ASSETS}/maps/remake/jiqing/music/${name}.m4a`, len: 0 };
};

/** The set itself (lengths come from the files); `clean`: the 清晰 versions. */
export function jqMusicSet(clean = jqMusicQuality() === 1): MusicSet {
  // (no screen themes of its own: the shop, the lottery and the results share the original's theme 6, so the results'
  // fanfare is played by main.ts at the game's end instead)
  return { tracks: JQ_TRACKS.map(n => file(n, clean)), fanfare: file(JQ_FANFARE, clean) };
}

/**
 * 長安's own music (the user 2026-11-19: 「大唐的輪播bgm，鬥雞、貢院、賭坊的bgm」「用大唐那時候的樂器，做出恢弘的感覺」,
 * tools/tycoon-art/changan_music_suno.py): four Tang background pieces in rotation, the fanfare at the opening's end
 * and the screens' own pieces at indices past the original's themes (CN_THEME). The same 專屬音樂 setting.
 */
export const CN_MAP_ID = 110;
// (the user's picks 2026-11-19: 曲江春宴 of the first batch, then five of the cartoon batch —
// 「唐朝的適合卡通遊戲的歡快的音樂，朗朗上口，容易洗腦」, never march-like)
export const CN_TRACKS = ['cn-bgm-stroll', 'cn-bgm-market', 'cn-bgm-qujiang', 'cn-bgm-lantern', 'cn-bgm-fortune-a', 'cn-bgm-fortune-b'] as const;
export const CN_THEME = { cock: 30, exam: 31, dice: 32 } as const;
const cnFile = (name: string) => ({ name, url: `${ASSETS}/maps/remake/changan/music/${name}.m4a`, len: 0 });
export function cnMusicSet(): MusicSet {
  return { tracks: CN_TRACKS.map(cnFile), fanfare: cnFile('cn-fanfare'),
    themes: { [CN_THEME.cock]: cnFile('cn-cock'), [CN_THEME.exam]: cnFile('cn-exam'), [CN_THEME.dice]: cnFile('cn-dice') } };
}

/**
 * 清明上河's own music (the user 2026-11-23: 「開元盛世你還單獨做了一套UI，清明上河你也沒做」 — everything 長安 has;
 * tools/tycoon-art/qingming_music_suno.py): six cheerful Northern Song pieces in rotation (汴河 morning, 州橋夜市, 瓦舍勾欄,
 * 虹橋, 金明池, 梁山), the jingle at the opening's end and the screens' own pieces (QM_THEME; 貢院 at 長安's index, so
 * cn-exam.ts plays the Song one with set 'qingming'). The same 專屬音樂 setting.
 */
export const QM_MAP_ID = 111;
export const QM_TRACKS = ['qm-bgm-bianhe', 'qm-bgm-yeshi', 'qm-bgm-wazi', 'qm-bgm-hongqiao', 'qm-bgm-jinming', 'qm-bgm-liangshan'] as const;
export const QM_THEME = { exam: CN_THEME.exam, ling: 33, juyi: 34, tiger: 35, boar: 36, wrestle: 37, slot: 38, dock: 39 } as const;
const qmFile = (name: string) => ({ name, url: `${ASSETS}/maps/remake/qingming/music/${name}.m4a`, len: 0 });
export function qmMusicSet(): MusicSet {
  return { tracks: QM_TRACKS.map(qmFile), fanfare: qmFile('qm-fanfare'),
    themes: Object.fromEntries(Object.entries(QM_THEME).map(([k, i]) => [i, qmFile(`qm-${k}`)])) };
}

/** Which music a game plays: 激情歲月's, 長安's or 清明上河's own on that map (a normal game, the setting on), else none (the original's). */
export function musicSetFor(mapId: number, o: { tycoon?: boolean; on?: boolean; clean?: boolean } = {}): MusicSet | null {
  if (o.tycoon || (mapId !== JQ_MAP_ID && mapId !== CN_MAP_ID && mapId !== QM_MAP_ID)) return null;
  if (!(o.on ?? jqMusicMode() === 0)) return null;
  return mapId === CN_MAP_ID ? cnMusicSet() : mapId === QM_MAP_ID ? qmMusicSet() : jqMusicSet(o.clean);
}
