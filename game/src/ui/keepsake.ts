/**
 * Small things a player sets once and should never have to set again (the user 2026-11-08: 派對模式's name and 聯絡方式):
 * on a phone they go into a file next to the saves as well as the web view's storage (which the system may clear), and
 * come back from it at the next start.
 */
import { Capacitor } from '@capacitor/core';

const FILE = 'saves/keepsake.json';
/** The storage keys kept this way. */
const KEYS = ['rich4.party.name', 'rich4.party.contact'];
const fs = () => import('@capacitor/filesystem');

/** Writes the kept keys' values to the file (after one of them changed). */
export function persist() {
  if (!Capacitor.isNativePlatform()) return;
  const o: Record<string, string> = {};
  try { for (const k of KEYS) { const v = localStorage.getItem(k); if (v !== null) o[k] = v; } } catch { return; }
  void fs().then(({ Filesystem, Directory, Encoding }) => Filesystem.writeFile({ path: FILE, data: JSON.stringify(o), directory: Directory.Data, encoding: Encoding.UTF8, recursive: true })).catch(() => {});
}

/** At the start: what the web view's storage lost comes back from the file. */
export async function restoreKeepsakes(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { Filesystem, Directory, Encoding } = await fs();
    const r = await Filesystem.readFile({ path: FILE, directory: Directory.Data, encoding: Encoding.UTF8 });
    const o = JSON.parse(typeof r.data === 'string' ? r.data : await r.data.text()) as Record<string, unknown>;
    for (const k of KEYS) if (typeof o[k] === 'string' && localStorage.getItem(k) === null) localStorage.setItem(k, o[k] as string);
  } catch { /* no file yet */ }
}
