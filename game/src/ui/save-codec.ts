/**
 * The app's save file format (issue #7: 「安卓版經常出現讀取存檔失敗，然後閃退」, HarmonyOS 4.2). A slot used to be its
 * JSON text — up to ~0.7 MB for a 大富豪 world after three game-years (the 3000-line ticker log, five boards) — sent
 * whole as one string across the Capacitor bridge, escaped inside the bridge's own JSON, and parsed whole even just to
 * show the slot list (seventeen files at once: seven slots and the two five-turn automatic rings). Now a slot is a small
 * binary file, sent across the bridge as base64:
 *
 *   'R4Z1'  u32 preview length P  u32 JSON length N  u32 CRC-32 of the JSON  u32 payload length Z
 *   preview JSON (UTF-8, P bytes: what the slot list shows)   deflated save JSON (Z bytes)
 *
 * The slot list reads only the preview (no inflating, no big parse); loading inflates into one buffer of the known size
 * and checks the CRC, so a cut or damaged file is noticed and the previous copy is read instead. 5–8× smaller than the
 * JSON (tests: save-codec.test.ts). Pure functions (no DOM, no Capacitor): the tests run them in Node.
 */
import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate';
import type { SaveData } from '../core/save';

const MAGIC = [0x52, 0x34, 0x5a, 0x31]; // 'R4Z1'
const HEAD = 24;

/** What the slot list shows of a save: its date, map, the players' faces, when it was saved. */
export interface SlotPreview {
  version: number;
  savedAt: number;
  kind?: 'tycoon';
  settings: { mapId: number };
  /** A normal game's date (packed, core/date.ts). */
  game: { date: number };
  /** A 大富豪 world's date and turn. */
  world?: { date: number; current: number };
  players: { character: number; bankrupt: boolean; human: boolean }[];
}

type AnySave = SaveData & { kind?: 'tycoon'; world?: { date: number; current: number } };

/** The preview of a whole save (a normal game or a 大富豪 world, core/save.ts). */
export function previewOf(s: SaveData): SlotPreview {
  const a = s as AnySave;
  return {
    version: a.version, savedAt: a.savedAt ?? 0,
    ...(a.kind === 'tycoon' ? { kind: 'tycoon' as const, world: { date: a.world?.date ?? 0, current: a.world?.current ?? 0 } } : {}),
    settings: { mapId: a.settings?.mapId ?? 0 },
    game: { date: a.game?.date ?? 0 },
    players: (Array.isArray(a.players) ? a.players : []).map(p => ({ character: p.character, bankrupt: !!p.bankrupt, human: !!p.human })),
  };
}

let table: Uint32Array | null = null;
/** CRC-32 (IEEE), as zip and gzip have it. */
export function crc32(b: Uint8Array): number {
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
  }
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = table[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const u32 = (b: Uint8Array, at: number) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;
const put32 = (b: Uint8Array, at: number, v: number) => { b[at] = v & 0xff; b[at + 1] = (v >>> 8) & 0xff; b[at + 2] = (v >>> 16) & 0xff; b[at + 3] = (v >>> 24) & 0xff; };

/** True when the bytes start like a save file of this format. */
export const isPacked = (b: Uint8Array): boolean => b.length >= HEAD && MAGIC.every((m, i) => b[i] === m);

/** A save as file bytes. */
export function encodeSave(s: SaveData): Uint8Array {
  const json = strToU8(JSON.stringify(s)), pre = strToU8(JSON.stringify(previewOf(s)));
  const z = deflateSync(json, { level: 6 });
  const out = new Uint8Array(HEAD + pre.length + z.length);
  out.set(MAGIC, 0);
  put32(out, 4, pre.length); put32(out, 8, json.length); put32(out, 12, crc32(json)); put32(out, 16, z.length);
  out.set(pre, HEAD);
  out.set(z, HEAD + pre.length);
  return out;
}

function header(b: Uint8Array) {
  if (!isPacked(b)) throw new Error('not a save file');
  const pre = u32(b, 4), size = u32(b, 8), crc = u32(b, 12), z = u32(b, 16);
  // A file cut short (or with anything after it) is damaged.
  if (HEAD + pre + z !== b.length) throw new Error('save file cut short');
  return { pre, size, crc, z };
}

/** The slot list's view of a file, without inflating the save. Throws on a file that is not whole. */
export function peekSave(b: Uint8Array): SlotPreview {
  const h = header(b);
  return JSON.parse(strFromU8(b.subarray(HEAD, HEAD + h.pre))) as SlotPreview;
}

/** The whole save. Throws on a damaged file (length, CRC or JSON). */
export function decodeSave(b: Uint8Array): SaveData {
  const h = header(b);
  // Inflated straight into one buffer of the known size: no growing copies on a phone short of memory.
  const json = inflateSync(b.subarray(HEAD + h.pre), { out: new Uint8Array(h.size) });
  if (json.length !== h.size || crc32(json) !== h.crc) throw new Error('save file damaged');
  return JSON.parse(strFromU8(json)) as SaveData;
}

// ---------------------------------------------------------------- base64 (what the Capacitor bridge carries)

export function toBase64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000) as unknown as number[]);
  return btoa(s);
}

export function fromBase64(s: string): Uint8Array {
  const bin = atob(s.replace(/[\s\r\n]+/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};
