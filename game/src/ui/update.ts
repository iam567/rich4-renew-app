/**
 * 在線更新 (docs/rules/29, the user 2026-11-03: a new version inside the game, no new installer each time; 派對模式
 * must be on the newest version, playing alone may stay on an old one). The installed app carries the list of its
 * own files (update-base.json, scripts/update-manifest.mjs); a newer version's list says which files differ, and
 * only those are downloaded (each checked by its hash) into the app's own folder rich4-update/v<version>/. The app's
 * native part serves that folder first (ios AppDelegate.swift UpdateRouter, android UpdateClient.java, desktop
 * main.cjs) and drops a version that three times fails to reach the title. Saves are never touched.
 *
 * The update server (scripts/publish-update.mjs): latest.json {version, shell}; m/<version>.json the version's list
 * {version, shell, files: {path: [hash, size]}}; f/<hash> the files. `shell` is what the installed app's native part
 * can do (update-manifest.mjs SHELL): an update needing more is not applied — that phone is told to download the
 * new installer. Nothing on screen names a server (the user): only 「更新」.
 */
import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { audio } from './audio';

const SERVER = 'https://rich.areu.pro/u';
const DIR = 'rich4-update';
/** The running version (in a downloaded version: its own). */
export const RUNNING = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0';

type Files = Record<string, [string, number]>;
interface Manifest { version: string; shell: number; files: Files }
export interface Latest { version: string; shell: number }
export type UpdateState =
  | { kind: 'none' }                                   // the newest, or nothing to compare with (no answer, the web)
  | { kind: 'ready'; version: string }                 // can be updated in the game
  | { kind: 'installer'; version: string };            // newer, but needs the new installer

/**
 * The test channel (only for trying an update before players get it): a build made with RICH4_UPDATE_CHANNEL=test,
 * or localStorage rich4.update.channel = 'test'.
 */
function base(): string {
  let ch = typeof __UPDATE_CHANNEL__ === 'string' ? __UPDATE_CHANNEL__ : '';
  try { ch = localStorage.getItem('rich4.update.channel') ?? ch; } catch { /* none */ }
  return /^[a-z0-9-]{1,20}$/.test(ch) ? `${SERVER}/${ch}` : SERVER;
}

/** "0.9.10" > "0.9.9". */
export function newer(a: string, b: string): boolean {
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const p = x[i] || 0, q = y[i] || 0; if (p !== q) return p > q; }
  return false;
}

// ------------------------------------------------------------------ the app's own folder (phones, desktop)

interface Store {
  read(name: string): Promise<Uint8Array | null>;
  write(name: string, data: Uint8Array | string): Promise<void>;
  remove(name: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  list(): Promise<string[]>;
}
type DesktopUpdate = { read(n: string): Promise<Uint8Array | null>; write(n: string, d: Uint8Array | string): Promise<boolean>; remove(n: string): Promise<boolean>; rename(a: string, b: string): Promise<boolean>; list(): Promise<string[]> };

const b64 = (u: Uint8Array) => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));

function store(): Store | null {
  const desk = (globalThis as { rich4Desktop?: { update?: DesktopUpdate } }).rich4Desktop?.update;
  if (desk) return {
    read: n => desk.read(n),
    write: async (n, d) => { await desk.write(n, d); },
    remove: async n => { await desk.remove(n); },
    rename: async (a, b) => { await desk.rename(a, b); },
    list: () => desk.list(),
  };
  if (!Capacitor.isNativePlatform()) return null;
  const at = (n: string) => ({ path: `${DIR}/${n}`, directory: Directory.Library });
  return {
    read: async n => { try { const r = await Filesystem.readFile(at(n)); return typeof r.data === 'string' ? unb64(r.data) : new Uint8Array(await r.data.arrayBuffer()); } catch { return null; } },
    write: async (n, d) => { await Filesystem.writeFile({ ...at(n), data: b64(typeof d === 'string' ? new TextEncoder().encode(d) : d), recursive: true }); },
    remove: async n => {
      try { const s = await Filesystem.stat(at(n)); if (s.type === 'directory') await Filesystem.rmdir({ ...at(n), recursive: true }); else await Filesystem.deleteFile(at(n)); } catch { /* gone */ }
    },
    rename: async (a, b) => {
      try { await Filesystem.rmdir({ ...at(b), recursive: true }); } catch { /* none */ }
      await Filesystem.rename({ from: `${DIR}/${a}`, to: `${DIR}/${b}`, directory: Directory.Library, toDirectory: Directory.Library });
    },
    list: async () => { try { return (await Filesystem.readdir({ path: DIR, directory: Directory.Library })).files.map(f => f.name); } catch { return []; } },
  };
}
const text = async (s: Store, n: string) => { const b = await s.read(n); return b ? new TextDecoder().decode(b).trim() : null; };

/** Whether this app can update itself (the phone apps and the desktop app; the web page is always the newest). */
export const canUpdate = () => store() !== null;

// ------------------------------------------------------------------ what the server and the app have

async function getJson<T>(url: string, ms = 6000): Promise<T | null> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms);
    const r = await fetch(url, { signal: ctl.signal, cache: 'no-store' });
    clearTimeout(t);
    return r.ok ? await r.json() as T : null;
  } catch { return null; }
}

let own: Promise<Manifest | null> | null = null;
/** The installed app's own list (its version and shell). */
const installed = () => (own ??= getJson<Manifest>(new URL('update-base.json', typeof document === 'undefined' ? 'http://localhost/' : document.baseURI).href, 15000));

/** The newest version on the server (null: no answer). */
export const fetchLatest = () => getJson<Latest>(`${base()}/latest.json`);

let checked: { at: number; p: Promise<UpdateState> } | null = null;
/** Whether a newer version is there and how it can be had (asked again after a minute). */
export function checkUpdate(): Promise<UpdateState> {
  if (!checked || Date.now() - checked.at > 60_000) checked = { at: Date.now(), p: check() };
  return checked.p;
}
async function check(): Promise<UpdateState> {
  const s = store();
  const latest = await fetchLatest();
  if (!s || !latest || typeof latest.version !== 'string' || !newer(latest.version, RUNNING)) return { kind: 'none' };
  const mine = await installed();
  if (!mine || (latest.shell ?? 1) > (mine.shell ?? 1)) return { kind: 'installer', version: latest.version };
  // A version that failed to start three times here (the native part dropped it): the installer instead.
  if ((await text(s, 'bad')) === latest.version) return { kind: 'installer', version: latest.version };
  return { kind: 'ready', version: latest.version };
}

const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b), x => x.toString(16).padStart(2, '0')).join('');
const hashOf = async (u: Uint8Array) => hex(await crypto.subtle.digest('SHA-256', u as Uint8Array<ArrayBuffer>)).slice(0, 32);

/**
 * Downloads `version` (only the files differing from the installed app and from the version running now) and makes
 * it the one the app starts with. `progress(done, total)` in bytes. Then the page is loaded again (the new version).
 */
export async function applyUpdate(version: string, progress: (done: number, total: number) => void): Promise<void> {
  const s = store();
  if (!s) throw new Error('這個版本不能在遊戲裡更新');
  const [m, mine] = await Promise.all([getJson<Manifest>(`${base()}/m/${version}.json`, 30000), installed()]);
  if (!m || !mine) throw new Error('暫時無法下載更新，請稍後再試');
  // The version running now, when it is a downloaded one: its files can be taken over.
  const runningDir = RUNNING !== mine.version ? `v${RUNNING}` : '';
  let have: Files = {};
  if (runningDir) { try { have = JSON.parse(await text(s, `${runningDir}/.files.json`) ?? '{}') as Files; } catch { have = {}; } }
  const need = Object.entries(m.files).filter(([p, [h]]) => mine.files[p]?.[0] !== h);
  const part = `v${version}.part`;
  await s.remove(part);
  const total = need.reduce((n, [p, [h, size]]) => n + (have[p]?.[0] === h ? 0 : size), 0);
  let done = 0;
  progress(0, total);
  let next = 0;
  const one = async ([p, [h, size]]: [string, [string, number]]) => {
    if (p.includes('..') || p.startsWith('/')) throw new Error('更新檔案有誤');
    let data: Uint8Array | null = have[p]?.[0] === h ? await s.read(`${runningDir}/${p}`) : null;
    const copied = !!data;
    for (let attempt = 0; !data && attempt < 3; attempt++) {
      try {
        const r = await fetch(`${SERVER}/f/${h}`, { cache: 'no-store' });
        if (r.ok) { const u = new Uint8Array(await r.arrayBuffer()); if (await hashOf(u) === h) data = u; }
      } catch { /* again */ }
    }
    if (!data) throw new Error('下載更新時網路中斷，請稍後再試');
    await s.write(`${part}/${p}`, data);
    if (!copied) { done += size; progress(done, total); }
  };
  await Promise.all(Array.from({ length: 4 }, async () => { while (next < need.length) await one(need[next++]); }));
  await s.write(`${part}/.files.json`, JSON.stringify(Object.fromEntries(need)));
  await s.rename(part, `v${version}`);
  await s.write('current', version);
  await s.remove('boot');
  if (typeof location !== 'undefined') location.reload();
}

/**
 * The page reached the title: this version starts fine (the native part stops counting its tries), and folders of
 * other downloaded versions go.
 */
export async function confirmStart(): Promise<void> {
  const s = store();
  if (!s) return;
  await s.remove('boot');
  const keep = RUNNING !== (await installed())?.version ? `v${RUNNING}` : '';
  for (const n of await s.list()) if (/^v[0-9.]+(\.part)?$/.test(n) && n !== keep) await s.remove(n);
}

// ------------------------------------------------------------------ on screen

const MB = (n: number) => (n / 1e6 < 0.1 ? '0.1' : (n / 1e6).toFixed(1));

/** A sheet with buttons (the game's own look); resolves with the button's index. */
function sheet(parent: HTMLElement, body: string, buttons: string[]): { el: HTMLElement; text: HTMLElement; row: HTMLElement; done: Promise<number> } {
  const overlay = document.createElement('div');
  overlay.className = 'slots-overlay update-sheet';
  overlay.innerHTML = `<div class="msg sheet"><div class="msg-text small" style="white-space:pre-line"></div><div class="up-bar" hidden><i></i></div><div class="choices"></div></div>`;
  const t = overlay.querySelector<HTMLElement>('.msg-text')!, row = overlay.querySelector<HTMLElement>('.choices')!;
  t.textContent = body;
  const done = new Promise<number>(resolve => {
    buttons.forEach((label, i) => {
      const b = document.createElement('button');
      b.className = i === 0 ? 'candy yes' : 'candy ghost';
      b.textContent = label;
      b.onclick = () => { audio.ui(i === 0 ? 'yes' : 'no'); resolve(i); };
      row.append(b);
    });
  });
  parent.append(overlay);
  return { el: overlay, text: t, row, done };
}

/** Downloads with a progress bar; on a failure says so (and the old version keeps running). */
async function runUpdate(parent: HTMLElement, version: string): Promise<void> {
  const s = sheet(parent, `正在下載 v${version}…`, []);
  const bar = s.el.querySelector<HTMLElement>('.up-bar')!, fill = bar.querySelector<HTMLElement>('i')!;
  bar.hidden = false;
  try {
    await applyUpdate(version, (done, total) => {
      fill.style.width = `${total ? Math.round(done / total * 100) : 100}%`;
      s.text.textContent = total ? `正在下載 v${version}…\n${MB(done)} / ${MB(total)} MB` : `正在更新到 v${version}…`;
    });
  } catch (e) {
    s.el.remove();
    await sheet(parent, `更新沒有完成：${(e as Error).message || '請稍後再試'}\n目前的 v${RUNNING} 照常可以玩。`, ['確定']).done.then(() => {});
    document.querySelector('.update-sheet')?.remove();
  }
}

const INSTALLER = (v: string) => `新版本 v${v} 需要下載新的安裝包才能更新\n（存檔會保留）`;
const DOWNLOAD_PAGE = 'https://github.com/iam567/rich4-renew-app/releases/latest';
function openDownloadPage() { window.open(DOWNLOAD_PAGE, '_blank'); }

/** The title: a newer version is offered once per start (playing alone may stay on the old one). */
let offered = false;
export async function offerOnTitle(parent: HTMLElement): Promise<void> {
  if (offered) return;
  offered = true;
  const st = await checkUpdate();
  if (st.kind === 'none' || !parent.isConnected) return;
  if (st.kind === 'installer') {
    const s = sheet(parent, `${INSTALLER(st.version)}\n目前的 v${RUNNING} 照常可以玩。`, ['前往下載', '以後再說']);
    const i = await s.done; s.el.remove();
    if (i === 0) openDownloadPage();
    return;
  }
  const s = sheet(parent, `有新版本 v${st.version}\n更新只下載有變動的檔案，存檔會保留。`, ['更新', '以後再說']);
  const i = await s.done; s.el.remove();
  if (i === 0) await runUpdate(parent, st.version);
}

/**
 * 派對模式 needs the newest version (the user: everyone online on the same rules). True: this phone may go on (it is
 * the newest, or the newest is not known — then the room's own version check still holds). False: it stays out.
 */
export async function partyNeedsUpdate(parent: HTMLElement): Promise<boolean> {
  const st = await checkUpdate();
  if (st.kind === 'none') return true;
  if (st.kind === 'installer') {
    const s = sheet(parent, `派對模式需要最新版本 v${st.version}\n${INSTALLER(st.version)}`, ['前往下載', '返回']);
    const i = await s.done; s.el.remove();
    if (i === 0) openDownloadPage();
    return false;
  }
  const s = sheet(parent, `派對模式需要最新版本 v${st.version}\n（你的是 v${RUNNING}）更新只下載有變動的檔案，存檔會保留。`, ['更新', '返回']);
  const i = await s.done; s.el.remove();
  if (i === 0) await runUpdate(parent, st.version);
  return false;
}
