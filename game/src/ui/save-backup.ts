/**
 * 存檔備份 (the user 2026-11-03: players can export their own saves): every save of this device — the slots and the
 * automatic saves' last turns — in one file, and the same file read back (another phone, a new install). The file is
 * the saves' JSON, gzipped (`.r4save`). In the app it goes out through the system's share sheet (儲存到「檔案」, AirDrop,
 * a chat…); in the desktop app and the browser it is a download. Importing writes each save into the same slot it
 * came from, after the player agreed to overwrite those slots.
 */
import { Capacitor } from '@capacitor/core';
import { gunzipSync, gzipSync, strFromU8, strToU8 } from 'fflate';
import type { SaveData } from '../core/save';
import { audio } from './audio';
import { AUTO_SLOT, allIds, readSlot, TYCOON_AUTO_SLOT, writeSlot } from './saves';

interface BackupFile { app: 'rich4-saves'; v: 1; version: string; at: number; saves: [number, SaveData][] }

const stamp = (t: number) => { const d = new Date(t), z = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}`; };
const when = (t: number) => new Date(t).toLocaleString('zh-Hant', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/** All saves of this device as a backup file's bytes (null: there are none). */
export async function backupBytes(): Promise<{ bytes: Uint8Array; count: number } | null> {
  const saves: [number, SaveData][] = [];
  for (const id of allIds()) {
    const s = await readSlot(id).catch(() => undefined);
    if (s) saves.push([id, s]);
  }
  if (!saves.length) return null;
  const f: BackupFile = { app: 'rich4-saves', v: 1, version: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '', at: Date.now(), saves };
  return { bytes: gzipSync(strToU8(JSON.stringify(f)), { level: 6 }), count: saves.length };
}

/** A backup file read back (gzipped or plain JSON); throws with a message for the player when it is not one. */
export function readBackup(b: Uint8Array): BackupFile {
  let text: string;
  try { text = strFromU8(b[0] === 0x1f && b[1] === 0x8b ? gunzipSync(b) : b); } catch { throw new Error('這個檔案不是大富翁4的存檔備份'); }
  let f: BackupFile;
  try { f = JSON.parse(text) as BackupFile; } catch { throw new Error('這個檔案不是大富翁4的存檔備份'); }
  const ids = new Set(allIds());
  if (f?.app !== 'rich4-saves' || !Array.isArray(f.saves)) throw new Error('這個檔案不是大富翁4的存檔備份');
  f.saves = f.saves.filter(x => Array.isArray(x) && ids.has(x[0]) && x[1] && typeof x[1] === 'object');
  if (!f.saves.length) throw new Error('這個備份裡沒有存檔');
  return f;
}

/** Hands the file to the player: the share sheet in the app, a download elsewhere. */
async function giveFile(bytes: Uint8Array, name: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  if (Capacitor.isNativePlatform()) {
    const [{ Filesystem, Directory }, { Share }] = await Promise.all([import('@capacitor/filesystem'), import('@capacitor/share')]);
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const { uri } = await Filesystem.writeFile({ path: name, data: btoa(s), directory: Directory.Cache });
    try { await Share.share({ title: '大富翁4 存檔備份', files: [uri], dialogTitle: '導出存檔' }); } catch (e) {
      if (/cancel/i.test(String((e as Error)?.message ?? e))) return 'cancelled';
      throw e;
    }
    return 'shared';
  }
  const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'downloaded';
}

/** The system's file picker: the chosen file's bytes (null: none chosen). */
function pickFile(): Promise<Uint8Array | null> {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.style.display = 'none';
    input.onchange = async () => { const f = input.files?.[0]; input.remove(); resolve(f ? new Uint8Array(await f.arrayBuffer()) : null); };
    input.oncancel = () => { input.remove(); resolve(null); };
    document.body.append(input);
    input.click();
  });
}

const slotName = (id: number) => (id === AUTO_SLOT || (id >= 1000 && id < 1010) ? '自動存檔' : id === TYCOON_AUTO_SLOT || (id >= 1060 && id < 1070) ? '大富豪自動存檔' : `檔位 ${id}`);

/** A sheet with a text and buttons; resolves with the button's index (-1: closed). */
function sheet(parent: HTMLElement, title: string, body: string, buttons: string[]): Promise<number> {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'slots-overlay';
    overlay.innerHTML = `<div class="msg sheet backup-sheet"><div class="ribbon"></div><div class="msg-text small" style="white-space:pre-line"></div><div class="choices"></div></div>`;
    overlay.querySelector('.ribbon')!.textContent = title;
    overlay.querySelector('.msg-text')!.textContent = body;
    const row = overlay.querySelector('.choices')!;
    const done = (i: number) => { audio.ui(i >= 0 && i < buttons.length - 1 ? 'yes' : 'no'); overlay.remove(); resolve(i); };
    buttons.forEach((label, i) => {
      const b = document.createElement('button');
      b.className = i < buttons.length - 1 ? 'candy yes' : 'candy ghost';
      b.textContent = label;
      b.onclick = () => done(i);
      row.append(b);
    });
    overlay.onclick = e => { if (e.target === overlay) done(-1); };
    parent.append(overlay);
  });
}

/** 設定 → 存檔備份: export every save to a file, or import one. */
export async function openBackup(parent: HTMLElement): Promise<void> {
  const i = await sheet(parent, '存檔備份', '把這台裝置的所有存檔導出成一個檔案，\n換手機或重新安裝後可以再導入。', ['導出存檔', '導入存檔', '返回']);
  if (i === 0) {
    const b = await backupBytes();
    if (!b) { await sheet(parent, '存檔備份', '目前沒有任何存檔。', ['確定']); return; }
    try {
      const r = await giveFile(b.bytes, `大富翁4存檔-${stamp(Date.now())}.r4save`);
      if (r === 'downloaded') await sheet(parent, '存檔備份', `已導出 ${b.count} 個存檔（下載的檔案）。`, ['確定']);
    } catch (e) { await sheet(parent, '存檔備份', `導出沒有完成：${(e as Error).message || '請再試一次'}`, ['確定']); }
    return;
  }
  if (i !== 1) return;
  const bytes = await pickFile();
  if (!bytes) return;
  let f: BackupFile;
  try { f = readBackup(bytes); } catch (e) { await sheet(parent, '導入存檔', (e as Error).message, ['確定']); return; }
  const names = [...new Set(f.saves.map(([id]) => slotName(id)))].join('、');
  const ok = await sheet(parent, '導入存檔', `這個備份是 ${when(f.at)} 導出的，有 ${f.saves.length} 個存檔（${names}）。\n導入後，這些檔位原本的存檔會被換掉。`, ['導入', '取消']);
  if (ok !== 0) return;
  let n = 0;
  for (const [id, s] of f.saves) { try { await writeSlot(id, s); n++; } catch { /* the rest still */ } }
  await sheet(parent, '導入存檔', n === f.saves.length ? `已導入 ${n} 個存檔，可以到「讀取進度」接著玩。` : `導入了 ${n} / ${f.saves.length} 個存檔，其餘的沒有寫進去，請再試一次。`, ['確定']);
}
