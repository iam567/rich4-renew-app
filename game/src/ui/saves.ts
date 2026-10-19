/**
 * Save slots and the slot picker. In the app (iOS / Android) every slot is a file in the app's own data folder
 * (`saves/slot-N.json`, written to a temporary file first and swapped in, the previous version kept as
 * `slot-N.prev.json`): iOS WebKit's IndexedDB can lose its connection after the app was in the background and then
 * fails or hangs on every write — the user lost an hour of play that way (2026-10-19). IndexedDB stays for the
 * browser, and for the slots saved before (copied over to files once, the first time the slots are read).
 */
import { Capacitor } from '@capacitor/core';
import { CHARACTERS } from '../core/characters';
import type { SaveData } from '../core/save';
import type { SpriteBank } from './sprites';
import { audio } from './audio';

export const SLOTS = 7;
/** Slot 0 is the automatic save, as SAVE0.DAT in the original. */
export const AUTO_SLOT = 0;
/** 大富豪模式 saves itself into its own slot, so a world never overwrites a normal game's automatic save. */
export const TYCOON_AUTO_SLOT = 6;
const isAuto = (i: number) => i === AUTO_SLOT || i === TYCOON_AUTO_SLOT;
/** A 大富豪 world's save (core/save.ts WorldSaveData) in a slot: its date, current city and twelve players. */
type AnySave = SaveData & { kind?: 'tycoon'; world?: { date: number; current: number }; cities?: { game: { date: number } }[] };

const DB = 'rich4', STORE = 'saves';
const native = () => Capacitor.isNativePlatform();

/** A promise that gives up after `ms` (a stuck IndexedDB never answers). */
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
const path = (slot: number, kind = '') => `saves/slot-${slot}${kind}.json`;

async function fileRead(p: string): Promise<SaveData | undefined> {
  const { Filesystem, Directory, Encoding } = await fs();
  try {
    const r = await Filesystem.readFile({ path: p, directory: Directory.Data, encoding: Encoding.UTF8 });
    return JSON.parse(typeof r.data === 'string' ? r.data : await r.data.text()) as SaveData;
  } catch { return undefined; }
}

async function fileWrite(slot: number, data: SaveData): Promise<void> {
  const { Filesystem, Directory, Encoding } = await fs();
  const dir = Directory.Data, text = JSON.stringify(data);
  const tmp = path(slot, '.tmp'), cur = path(slot), prev = path(slot, '.prev');
  await Filesystem.writeFile({ path: tmp, data: text, directory: dir, encoding: Encoding.UTF8, recursive: true });
  // Read it back before it replaces anything: a slot is never left without a whole save.
  const back = await Filesystem.readFile({ path: tmp, directory: dir, encoding: Encoding.UTF8 });
  if ((typeof back.data === 'string' ? back.data.length : -1) !== text.length) throw new Error('save file incomplete');
  const exists = async (p: string) => Filesystem.stat({ path: p, directory: dir }).then(() => true, () => false);
  if (await exists(cur)) {
    if (await exists(prev)) await Filesystem.deleteFile({ path: prev, directory: dir });
    await Filesystem.rename({ from: cur, to: prev, directory: dir, toDirectory: dir });
  }
  await Filesystem.rename({ from: tmp, to: cur, directory: dir, toDirectory: dir });
}

/**
 * Slots saved in IndexedDB before the files: copied to files once (a slot that already has a file keeps it), then
 * IndexedDB is not touched again in the app — a stuck one can't slow the save list down.
 */
const MIGRATED = 'rich4.savesToFiles';
let migration: Promise<void> | null = null;
function migrate(): Promise<void> {
  return (migration ??= (async () => {
    try { if (localStorage.getItem(MIGRATED)) return; } catch { /* no storage: try below */ }
    for (let slot = 0; slot < SLOTS; slot++) {
      if (await fileRead(path(slot))) continue;
      const old = await idb<SaveData | undefined>('readonly', s => s.get(slot)).catch(() => undefined);
      if (old) await fileWrite(slot, old);
    }
    try { localStorage.setItem(MIGRATED, '1'); } catch { /* tried again next start */ }
  })().catch(() => { migration = null; }));
}

/** The slot's save: the file, else an interrupted swap's temporary file, else the previous version. */
async function nativeRead(slot: number): Promise<SaveData | undefined> {
  await migrate();
  for (const kind of ['', '.tmp', '.prev']) { const d = await fileRead(path(slot, kind)); if (d) return d; }
  return undefined;
}

let writing: Promise<unknown> = Promise.resolve();
/** Writes a slot (one write at a time, in order); resolves once the save is really stored. */
export function writeSlot(slot: number, data: SaveData): Promise<void> {
  const run = () => (native() ? within(fileWrite(slot, data), 15000, 'save file') : idb('readwrite', s => s.put(data, slot)).then(() => {}));
  const p = writing.then(run, run);
  writing = p.catch(() => {});
  return p;
}
export const readSlot = (slot: number): Promise<SaveData | undefined> => (native() ? nativeRead(slot) : idb<SaveData | undefined>('readonly', s => s.get(slot)));

/**
 * The automatic saves keep the last five turns (the user 2026-10-19): the automatic slot itself and four more
 * (ids 1000 + slot × 10 + k), written in turn, the oldest overwritten. `turn` names the turn being saved: saving it
 * again (going to the background, a retry) rewrites the same one instead of pushing an older turn out.
 */
export const AUTO_KEEP = 5;
const ringIds = (slot: number) => [slot, ...Array.from({ length: AUTO_KEEP - 1 }, (_, k) => 1000 + slot * 10 + k)];
const ringAt = new Map<number, { turn: string; at: number }>();
let autoChain: Promise<unknown> = Promise.resolve();

/** The automatic saves of a slot that hold a game, newest first. */
export async function autoSaves(slot: number): Promise<{ id: number; save: SaveData }[]> {
  const ids = ringIds(slot);
  const got = await Promise.all(ids.map(id => readSlot(id).catch(() => undefined)));
  return got.map((save, k) => ({ id: ids[k], save })).filter((x): x is { id: number; save: SaveData } => !!x.save)
    .sort((a, b) => (b.save.savedAt ?? 0) - (a.save.savedAt ?? 0));
}

export function writeAuto(slot: number, data: SaveData, turn: string): Promise<void> {
  const run = async () => {
    const r = ringAt.get(slot);
    let at: number;
    if (r?.turn === turn) at = r.at;
    else if (r) at = (r.at + 1) % AUTO_KEEP;
    else {
      // First automatic save since the app started: the empty or oldest of the five.
      const ids = ringIds(slot);
      const got = await Promise.all(ids.map(id => readSlot(id).catch(() => undefined)));
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

export async function listSlots(): Promise<(SaveData | undefined)[]> {
  try { return await Promise.all(Array.from({ length: SLOTS }, (_, i) => readSlot(i))); }
  catch { return new Array(SLOTS).fill(undefined); }
}

/**
 * The save/load screen (09 §7.11): one row per slot with the game date, the map thumbnail and every player's
 * portrait. `mode` save lists slots 1..5 (the automatic slot is not written by hand); load lists 0..5 and
 * only filled slots can be picked. Resolves with the slot, or -1 when cancelled.
 */
export async function pickSlot(parent: HTMLElement, mode: 'save' | 'load', mapName: (id: number) => string,
                               bank: SpriteBank | null, mapThumb: (id: number) => string): Promise<number> {
  const saves = await listSlots();
  const autos = new Map<number, { id: number; save: SaveData }[]>();
  if (mode === 'load') for (const i of [AUTO_SLOT, TYCOON_AUTO_SLOT]) autos.set(i, await autoSaves(i).catch(() => []));
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
    const filled = (s: AnySave, badge: string): string => {
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
        ...all.map(({ id, save }, k) => button(filled(save as AnySave, `<span class="slot-badge auto">${k === 0 ? '最新' : `-${k}`}</span>`), false, () => done(id))));
      cancel.textContent = '返回';
    };
    const showSlots = () => {
      inAuto = false;
      cancel.textContent = '取消';
      list.replaceChildren();
      for (let i = mode === 'save' ? 1 : 0; i < SLOTS; i++) {
        if (mode === 'save' && isAuto(i)) continue;   // automatic slots are not written by hand
        const ring = autos.get(i);
        const s = (ring ? ring[0]?.save : saves[i]) as AnySave | undefined;
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
