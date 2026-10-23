/**
 * Save slots and the slot picker. In the app (iOS / Android) every slot is a file in the app's own data folder
 * (`saves/slot-N.r4z`, written to a temporary file first and swapped in, the previous version kept as
 * `slot-N.prev.r4z`): iOS WebKit's IndexedDB can lose its connection after the app was in the background and then
 * fails or hangs on every write — the user lost an hour of play that way (2026-10-19). IndexedDB stays for the
 * browser, and for the slots saved before (copied over to files once, the first time the slots are read).
 *
 * The files are compressed (ui/save-codec.ts, issue #7: 「安卓版經常出現讀取存檔失敗，然後閃退」 on HarmonyOS 4.2): the bridge
 * carries a small base64 string instead of the whole JSON, the slot list reads only each file's preview, and a file
 * that is cut or damaged is noticed and its previous copy read instead. The JSON files of 0.7.3 and before
 * (`slot-N.json`) are converted once, one at a time, and left in place (an older version still finds its own saves);
 * they are read when a slot has no compressed file that can be read.
 */
import { Capacitor } from '@capacitor/core';
import { CHARACTERS } from '../core/characters';
import type { SaveData } from '../core/save';
import type { SpriteBank } from './sprites';
import { audio } from './audio';
import { decodeSave, encodeSave, fromBase64, peekSave, previewOf, sameBytes, toBase64, type SlotPreview } from './save-codec';

export type { SlotPreview } from './save-codec';

export const SLOTS = 7;
/** Slot 0 is the automatic save, as SAVE0.DAT in the original. */
export const AUTO_SLOT = 0;
/** 大富豪模式 saves itself into its own slot, so a world never overwrites a normal game's automatic save. */
export const TYCOON_AUTO_SLOT = 6;
const isAuto = (i: number) => i === AUTO_SLOT || i === TYCOON_AUTO_SLOT;

const DB = 'rich4', STORE = 'saves';
const native = () => Capacitor.isNativePlatform();

/** A promise that gives up after `ms` (a stuck IndexedDB or bridge never answers). */
function within<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what} timed out`)), ms);
    p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}

// ---------------------------------------------------------------- IndexedDB (browser; older app saves)

let conn: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  return (conn ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => {
      const d = req.result;
      // A lost or closed connection is opened again next time.
      d.onclose = () => { conn = null; };
      d.onversionchange = () => { d.close(); conn = null; };
      resolve(d);
    };
    req.onerror = () => { conn = null; reject(req.error); };
  }));
}

async function idb<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const go = async () => {
    const d = await within(db(), 4000, 'IndexedDB open');
    return within(new Promise<T>((resolve, reject) => {
      const t = d.transaction(STORE, mode), req = run(t.objectStore(STORE));
      // A write counts once its transaction is committed, not when the request is queued.
      t.oncomplete = () => resolve(req.result);
      t.onerror = t.onabort = () => reject(t.error ?? req.error);
    }), 8000, 'IndexedDB transaction');
  };
  try { return await go(); }
  catch { conn = null; return go(); } // one fresh connection, then give up
}

// ---------------------------------------------------------------- files (the app)

type FS = typeof import('@capacitor/filesystem');
let fsMod: Promise<FS> | null = null;
const fs = () => (fsMod ??= import('@capacitor/filesystem'));
/** A slot's compressed file; `kind` '.tmp' (a write not yet swapped in) or '.prev' (the version before). */
const path = (slot: number, kind = '') => `saves/slot-${slot}${kind}.r4z`;
/** The JSON file of 0.7.3 and before. */
const oldPath = (slot: number, kind = '') => `saves/slot-${slot}${kind}.json`;
const KINDS = ['', '.tmp', '.prev'];
/** A bridge call that does not answer in this time counts as failed (the slot list and a load never hang). */
const IO_MS = 15000;

async function exists(p: string): Promise<boolean> {
  const { Filesystem, Directory } = await fs();
  return within(Filesystem.stat({ path: p, directory: Directory.Data }), IO_MS, 'stat').then(() => true, () => false);
}

/** A file's bytes (sent across the bridge as base64), or undefined when there is none or it can't be read. */
async function readBytes(p: string): Promise<Uint8Array | undefined> {
  const { Filesystem, Directory } = await fs();
  try {
    const r = await within(Filesystem.readFile({ path: p, directory: Directory.Data }), IO_MS, 'read');
    return typeof r.data === 'string' ? fromBase64(r.data) : new Uint8Array(await r.data.arrayBuffer());
  } catch { return undefined; }
}

/** An old JSON save: undefined when there is no file, null when it can't be parsed. */
async function readOld(p: string): Promise<SaveData | null | undefined> {
  const { Filesystem, Directory, Encoding } = await fs();
  let text: string;
  try {
    const r = await within(Filesystem.readFile({ path: p, directory: Directory.Data, encoding: Encoding.UTF8 }), IO_MS, 'read');
    text = typeof r.data === 'string' ? r.data : await r.data.text();
  } catch { return undefined; }
  try { return JSON.parse(text) as SaveData; } catch { return null; }
}

async function fileWrite(slot: number, data: SaveData): Promise<void> {
  const { Filesystem, Directory } = await fs();
  const dir = Directory.Data, bytes = encodeSave(data);
  const tmp = path(slot, '.tmp'), cur = path(slot), prev = path(slot, '.prev');
  // No encoding: the bridge carries base64 and the file holds the bytes.
  await Filesystem.writeFile({ path: tmp, data: toBase64(bytes), directory: dir, recursive: true });
  // Read it back before it replaces anything: a slot is never left without a whole save.
  const back = await readBytes(tmp);
  if (!back || !sameBytes(back, bytes)) throw new Error('save file incomplete');
  if (await exists(cur)) {
    if (await exists(prev)) await Filesystem.deleteFile({ path: prev, directory: dir });
    await Filesystem.rename({ from: cur, to: prev, directory: dir, toDirectory: dir });
  }
  await Filesystem.rename({ from: tmp, to: cur, directory: dir, toDirectory: dir });
}

/** What a slot read gives: the save (or its preview), and whether a newer copy of it was damaged. */
export interface Loaded<T> {
  save?: T;
  /** A newer copy of the slot (the file itself, an interrupted write) could not be read: `save` is an older copy. */
  damaged: boolean;
}

/**
 * The slot's save: its file, else an interrupted swap's temporary file, else the previous version; then the same
 * three of the old JSON format. `packed` / `old` turn a file into what the caller wants (the whole save, a preview).
 */
async function nativeRead<T>(slot: number, packed: (b: Uint8Array) => T, old: (s: SaveData) => T): Promise<Loaded<T>> {
  await migrate();
  let damaged = false;
  for (const kind of KINDS) {
    const b = await readBytes(path(slot, kind));
    if (!b) continue;
    try { return { save: packed(b), damaged }; } catch { damaged = true; }
  }
  for (const kind of KINDS) {
    const s = await readOld(oldPath(slot, kind));
    if (s === undefined) continue;
    if (s === null) { damaged = true; continue; }
    try { return { save: old(s), damaged }; } catch { damaged = true; }
  }
  return { damaged };
}

/**
 * Slots saved in IndexedDB before the files: copied to files once (a slot that already has a file keeps it), then
 * IndexedDB is not touched again in the app — a stuck one can't slow the save list down. Then the JSON files of 0.7.3
 * and before, compressed once, one file at a time (a phone short of memory holds one save at once); the JSON files
 * stay where they are.
 */
const MIGRATED = 'rich4.savesToFiles', PACKED = 'rich4.savesPacked';
const flag = (k: string) => { try { return !!localStorage.getItem(k); } catch { return false; } };
const setFlag = (k: string) => { try { localStorage.setItem(k, '1'); } catch { /* tried again next start */ } };
let migration: Promise<void> | null = null;
function migrate(): Promise<void> {
  return (migration ??= (async () => {
    if (!flag(MIGRATED)) {
      for (let slot = 0; slot < SLOTS; slot++) {
        if (await exists(path(slot)) || await exists(oldPath(slot))) continue;
        const old = await idb<SaveData | undefined>('readonly', s => s.get(slot)).catch(() => undefined);
        if (old) await fileWrite(slot, old);
      }
      setFlag(MIGRATED);
    }
    if (!flag(PACKED)) {
      for (const id of allIds()) {
        if (await exists(path(id))) continue;
        for (const kind of KINDS) {
          const s = await readOld(oldPath(id, kind));
          if (s) { await fileWrite(id, s).catch(() => {}); break; }
        }
      }
      setFlag(PACKED);
    }
  })().catch(() => { migration = null; }));
}

let writing: Promise<unknown> = Promise.resolve();
/** Writes a slot (one write at a time, in order); resolves once the save is really stored. */
export function writeSlot(slot: number, data: SaveData): Promise<void> {
  const run = () => (native() ? migrate().then(() => within(fileWrite(slot, data), 15000, 'save file')) : idb('readwrite', s => s.put(data, slot)).then(() => {}));
  const p = writing.then(run, run);
  writing = p.catch(() => {});
  return p;
}

/** The slot's whole save, and whether a newer copy was damaged (then the save is the one before it). */
export async function loadSlot(slot: number): Promise<Loaded<SaveData>> {
  if (native()) return nativeRead(slot, decodeSave, s => s);
  return { save: await idb<SaveData | undefined>('readonly', s => s.get(slot)), damaged: false };
}
export const readSlot = (slot: number): Promise<SaveData | undefined> => loadSlot(slot).then(r => r.save);

/** What the slot list shows of a slot (in the app only the file's preview is read, never the whole save). */
export async function previewSlot(slot: number): Promise<SlotPreview | undefined> {
  try {
    if (native()) return (await nativeRead(slot, peekSave, previewOf)).save;
    const s = await idb<SaveData | undefined>('readonly', st => st.get(slot));
    return s ? previewOf(s) : undefined;
  } catch { return undefined; }
}

/**
 * The automatic saves keep the last five turns (the user 2026-10-19): the automatic slot itself and four more
 * (ids 1000 + slot × 10 + k), written in turn, the oldest overwritten. `turn` names the turn being saved: saving it
 * again (going to the background, a retry) rewrites the same one instead of pushing an older turn out.
 */
export const AUTO_KEEP = 5;
const ringIds = (slot: number) => [slot, ...Array.from({ length: AUTO_KEEP - 1 }, (_, k) => 1000 + slot * 10 + k)];
/** Every id a save can be stored under: the slots and the automatic rings. */
function allIds(): number[] {
  return [...Array.from({ length: SLOTS }, (_, i) => i), ...ringIds(AUTO_SLOT).slice(1), ...ringIds(TYCOON_AUTO_SLOT).slice(1)];
}
const ringAt = new Map<number, { turn: string; at: number }>();
let autoChain: Promise<unknown> = Promise.resolve();

/** The automatic saves of a slot that hold a game (their previews), newest first. */
export async function autoSaves(slot: number): Promise<{ id: number; save: SlotPreview }[]> {
  const ids = ringIds(slot);
  const got = await Promise.all(ids.map(id => previewSlot(id)));
  return got.map((save, k) => ({ id: ids[k], save })).filter((x): x is { id: number; save: SlotPreview } => !!x.save)
    .sort((a, b) => (b.save.savedAt ?? 0) - (a.save.savedAt ?? 0));
}

export function writeAuto(slot: number, data: SaveData, turn: string): Promise<void> {
  const run = async () => {
    const r = ringAt.get(slot);
    let at: number;
    if (r?.turn === turn) at = r.at;
    else if (r) at = (r.at + 1) % AUTO_KEEP;
    else {
      // First automatic save since the app started: the empty or oldest of the five (by their previews).
      const ids = ringIds(slot);
      const got = await Promise.all(ids.map(id => previewSlot(id)));
      at = 0;
      got.forEach((g, k) => { if ((g ? g.savedAt ?? 0 : -1) < (got[at] ? got[at]!.savedAt ?? 0 : -1)) at = k; });
    }
    ringAt.set(slot, { turn, at });
    await writeSlot(ringIds(slot)[at], data);
  };
  const p = autoChain.then(run, run);
  autoChain = p.catch(() => {});
  return p;
}

/** The previews of the slots (`skip`: slots not read, left undefined). */
export async function listSlots(skip: (i: number) => boolean = () => false): Promise<(SlotPreview | undefined)[]> {
  try { return await Promise.all(Array.from({ length: SLOTS }, (_, i) => (skip(i) ? undefined : previewSlot(i)))); }
  catch { return new Array(SLOTS).fill(undefined); }
}

/** A message over everything with one button; resolves once it is closed. */
export function notice(parent: HTMLElement, text: string, ok = '確定'): Promise<void> {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'slots-overlay';
    const box = document.createElement('div');
    box.className = 'msg sheet';
    const t = document.createElement('div');
    t.className = 'msg-text small';
    t.style.whiteSpace = 'pre-line';
    t.textContent = text;
    const row = document.createElement('div');
    row.className = 'choices';
    const b = document.createElement('button');
    b.className = 'candy';
    b.textContent = ok;
    b.onclick = () => { audio.ui('yes'); overlay.remove(); resolve(); };
    row.append(b);
    box.append(t, row);
    overlay.append(box);
    parent.append(overlay);
  });
}

/**
 * A load the app did not live through (issue #7): the slot being loaded is noted until the board shows; when the app
 * starts with the note still there, the web view or the app was killed meanwhile (on Android: out of memory).
 */
const LOADING = 'rich4.loadingSave';
export function markLoading(slot: number | null): void {
  try {
    if (slot === null) localStorage.removeItem(LOADING);
    else localStorage.setItem(LOADING, JSON.stringify({ slot, at: Date.now() }));
  } catch { /* no storage: no note */ }
}
/** The slot of a load that was cut off (within the last half hour), once; null when there was none. */
export function interruptedLoad(): number | null {
  try {
    const v = localStorage.getItem(LOADING);
    if (!v) return null;
    localStorage.removeItem(LOADING);
    const { slot, at } = JSON.parse(v) as { slot: number; at: number };
    return Date.now() - at < 30 * 60_000 && typeof slot === 'number' ? slot : null;
  } catch { return null; }
}

/**
 * The save/load screen (09 §7.11): one row per slot with the game date, the map thumbnail and every player's
 * portrait. `mode` save lists slots 1..5 (the automatic slot is not written by hand); load lists 0..5 and
 * only filled slots can be picked. Resolves with the slot, or -1 when cancelled.
 */
export async function pickSlot(parent: HTMLElement, mode: 'save' | 'load', mapName: (id: number) => string,
                               bank: SpriteBank | null, mapThumb: (id: number) => string): Promise<number> {
  // Only the previews (save-codec.ts); the automatic slots come from their rings (load) or are not shown (save).
  const rings = mode === 'load' ? [AUTO_SLOT, TYCOON_AUTO_SLOT] : [];
  const [saves, ...ringSaves] = await Promise.all([listSlots(isAuto), ...rings.map(i => autoSaves(i).catch(() => []))]);
  const autos = new Map<number, { id: number; save: SlotPreview }[]>(rings.map((i, k) => [i, ringSaves[k]]));
  const art = (archive: 'Data', id: number, frame: number) => bank?.art(archive, id, frame)?.src ?? '';
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'slots-overlay';
    const box = document.createElement('div');
    box.className = `msg sheet slots ${mode}`;
    box.innerHTML = `<div class="ribbon">${mode === 'save' ? '儲存進度' : '讀取進度'}</div>`;
    const list = document.createElement('div');
    list.className = 'slot-list';
    // Save / load slots (rich4_ui_save_load.asm): hover Effect#0, a slot confirms (#2), cancel #4.
    const done = (v: number) => { audio.ui(v >= 0 ? 'yes' : 'no'); overlay.remove(); resolve(v); };
    /** One save's row: badge, game date, map, faces, when it was saved. */
    const filled = (s: SlotPreview, badge: string): string => {
      const tycoon = s.kind === 'tycoon';
      // A slot that can't be read as a game (damaged, or from a newer version) shows as such instead of breaking the list.
      try {
        const d = tycoon ? s.world!.date : s.game.date, y = d >>> 16, m = (d >>> 8) & 0xff, dd = d & 0xff;
        const when = new Date(s.savedAt).toLocaleString('zh-Hant', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        const thumb = !tycoon && s.settings.mapId < 8 ? art('Data', 520, 2 + s.settings.mapId) : '';
        const name = tycoon ? `大富豪模式・${mapName(s.settings.mapId)}` : mapName(s.settings.mapId);
        // 12 players in a world: the human's face first, the rest still standing, so the row stays one line.
        const faces = tycoon ? [...s.players.filter(p => p.human), ...s.players.filter(p => !p.human && !p.bankrupt)].slice(0, 6) : s.players;
        return `${badge}<span class="slot-date"><small>${y}</small><b>${m}/${dd}</b></span>
          <span class="slot-map">${thumb || mapThumb(s.settings.mapId) ? `<img src="${thumb || mapThumb(s.settings.mapId)}" alt="">` : ''}</span>
          <span class="slot-main"><b class="slot-mapname">${name}</b><span class="slot-faces">${faces.map(p => `<span class="slot-face${p.bankrupt ? ' out' : ''}" title="${CHARACTERS[p.character].name}">${art('Data', 2, p.character) ? `<img src="${art('Data', 2, p.character)}" alt="">` : CHARACTERS[p.character].name}</span>`).join('')}</span></span>
          <span class="slot-when">${when}</span>`;
      } catch { return `${badge}<span class="slot-empty">（存檔無法顯示）</span>`; }
    };
    const button = (html: string, empty: boolean, pick: () => void) => {
      const b = document.createElement('button');
      b.className = `slot-row${empty ? ' empty' : ''}`;
      b.disabled = mode === 'load' && empty;
      b.innerHTML = html;
      b.onclick = pick;
      b.onpointerenter = e => { if (e.pointerType === 'mouse' && !b.disabled) audio.ui('hover'); };
      return b;
    };
    let inAuto = false;
    /** An automatic slot's last five turns, newest first; 返回 goes back to the slots. */
    const showAuto = (i: number) => {
      inAuto = true;
      audio.ui('yes');
      const all = autos.get(i) ?? [];
      list.replaceChildren(Object.assign(document.createElement('div'), { className: 'slot-note', textContent: `自動存檔：最近 ${all.length} 回合（點一個讀取）` }),
        ...all.map(({ id, save }, k) => button(filled(save, `<span class="slot-badge auto">${k === 0 ? '最新' : `-${k}`}</span>`), false, () => done(id))));
      cancel.textContent = '返回';
    };
    const showSlots = () => {
      inAuto = false;
      cancel.textContent = '取消';
      list.replaceChildren();
      for (let i = mode === 'save' ? 1 : 0; i < SLOTS; i++) {
        if (mode === 'save' && isAuto(i)) continue;   // automatic slots are not written by hand
        const ring = autos.get(i);
        const s = ring ? ring[0]?.save : saves[i];
        const badge = `<span class="slot-badge${isAuto(i) ? ' auto' : ''}">${isAuto(i) ? 'AUTO' : i}</span>`;
        const more = ring && ring.length > 1 ? `<span class="slot-more">${ring.length} 回合 ▸</span>` : '';
        const html = s ? filled(s, badge).replace('<span class="slot-when">', `<span class="slot-when">${more}`) : `${badge}<span class="slot-empty">${mode === 'save' ? '空白檔位 · 點這裡存檔' : '（空）'}</span>`;
        list.append(button(html, !s, () => (ring && ring.length > 1 ? showAuto(i) : done(ring?.[0]?.id ?? i))));
      }
    };
    const row = document.createElement('div');
    row.className = 'choices';
    const cancel = document.createElement('button');
    cancel.className = 'candy ghost';
    cancel.onclick = () => (inAuto ? (audio.ui('no'), showSlots()) : done(-1));
    row.append(cancel);
    showSlots();
    box.append(list, row);
    overlay.append(box);
    overlay.onclick = e => { if (e.target === overlay) done(-1); };
    parent.append(overlay);
  });
}
