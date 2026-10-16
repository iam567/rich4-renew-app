/** Save slots in IndexedDB (no 5 MB localStorage limit; kept inside the app on iOS) and the slot picker. */
import { CHARACTERS } from '../core/characters';
import type { SaveData } from '../core/save';
import type { SpriteBank } from './sprites';
import { audio } from './audio';

export const SLOTS = 6;
/** Slot 0 is the automatic save, as SAVE0.DAT in the original. */
export const AUTO_SLOT = 0;

const DB = 'rich4', STORE = 'saves';

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const req = run(d.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const writeSlot = (slot: number, data: SaveData) => tx('readwrite', s => s.put(data, slot));
export const readSlot = (slot: number) => tx<SaveData | undefined>('readonly', s => s.get(slot));

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
    for (let i = mode === 'save' ? 1 : 0; i < SLOTS; i++) {
      const s = saves[i];
      const b = document.createElement('button');
      b.className = `slot-row${s ? '' : ' empty'}`;
      b.disabled = mode === 'load' && !s;
      const badge = `<span class="slot-badge${i === AUTO_SLOT ? ' auto' : ''}">${i === AUTO_SLOT ? 'AUTO' : i}</span>`;
      if (s) {
        const d = s.game.date, y = d >>> 16, m = (d >>> 8) & 0xff, dd = d & 0xff;
        const when = new Date(s.savedAt).toLocaleString('zh-Hant', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        const thumb = s.settings.mapId < 8 ? art('Data', 520, 2 + s.settings.mapId) : '';
        b.innerHTML = `${badge}<span class="slot-date"><small>${y}</small><b>${m}/${dd}</b></span>
          <span class="slot-map">${thumb || mapThumb(s.settings.mapId) ? `<img src="${thumb || mapThumb(s.settings.mapId)}" alt="">` : ''}</span>
          <span class="slot-main"><b class="slot-mapname">${mapName(s.settings.mapId)}</b><span class="slot-faces">${s.players.map(p => `<span class="slot-face${p.bankrupt ? ' out' : ''}" title="${CHARACTERS[p.character].name}">${art('Data', 2, p.character) ? `<img src="${art('Data', 2, p.character)}" alt="">` : CHARACTERS[p.character].name}</span>`).join('')}</span></span>
          <span class="slot-when">${when}</span>`;
      } else {
        b.innerHTML = `${badge}<span class="slot-empty">${mode === 'save' ? '空白檔位 · 點這裡存檔' : '（空）'}</span>`;
      }
      b.onclick = () => done(i);
      b.onpointerenter = e => { if (e.pointerType === 'mouse' && !b.disabled) audio.ui('hover'); };
      list.append(b);
    }
    const row = document.createElement('div');
    row.className = 'choices';
    const cancel = document.createElement('button');
    cancel.className = 'candy ghost';
    cancel.textContent = '取消';
    cancel.onclick = () => done(-1);
    row.append(cancel);
    box.append(list, row);
    overlay.append(box);
    overlay.onclick = e => { if (e.target === overlay) done(-1); };
    parent.append(overlay);
  });
}
