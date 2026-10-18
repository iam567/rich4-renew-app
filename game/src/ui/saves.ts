/** Save slots in IndexedDB (no 5 MB localStorage limit; kept inside the app on iOS) and the slot picker. */
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
      if (mode === 'save' && isAuto(i)) continue;   // automatic slots are not written by hand
      const s = saves[i] as AnySave | undefined;
      const b = document.createElement('button');
      b.className = `slot-row${s ? '' : ' empty'}`;
      b.disabled = mode === 'load' && !s;
      const badge = `<span class="slot-badge${isAuto(i) ? ' auto' : ''}">${isAuto(i) ? 'AUTO' : i}</span>`;
      const tycoon = s?.kind === 'tycoon';
      // A slot that can't be read as a game (damaged, or from a newer version) shows as such instead of breaking the list.
      let filled = '';
      if (s) try {
        const d = tycoon ? s.world!.date : s.game.date, y = d >>> 16, m = (d >>> 8) & 0xff, dd = d & 0xff;
        const when = new Date(s.savedAt).toLocaleString('zh-Hant', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        const thumb = !tycoon && s.settings.mapId < 8 ? art('Data', 520, 2 + s.settings.mapId) : '';
        const name = tycoon ? `大富豪模式・${mapName(s.settings.mapId)}` : mapName(s.settings.mapId);
        // 12 players in a world: the human's face first, the rest still standing, so the row stays one line.
        const faces = tycoon ? [...s.players.filter(p => p.human), ...s.players.filter(p => !p.human && !p.bankrupt)].slice(0, 6) : s.players;
        filled = `${badge}<span class="slot-date"><small>${y}</small><b>${m}/${dd}</b></span>
          <span class="slot-map">${thumb || mapThumb(s.settings.mapId) ? `<img src="${thumb || mapThumb(s.settings.mapId)}" alt="">` : ''}</span>
          <span class="slot-main"><b class="slot-mapname">${name}</b><span class="slot-faces">${faces.map(p => `<span class="slot-face${p.bankrupt ? ' out' : ''}" title="${CHARACTERS[p.character].name}">${art('Data', 2, p.character) ? `<img src="${art('Data', 2, p.character)}" alt="">` : CHARACTERS[p.character].name}</span>`).join('')}</span></span>
          <span class="slot-when">${when}</span>`;
      } catch { filled = `${badge}<span class="slot-empty">（存檔無法顯示）</span>`; }
      if (s) {
        b.innerHTML = filled;
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
