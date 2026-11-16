/**
 * 在線更新 (docs/rules/29, the user 2026-11-03: a new version inside the game, no new installer each time; 派對模式
 * must be on the newest version, playing alone may stay on an old one). The installed app carries the list of its
 * own files (update-base.json, scripts/update-manifest.mjs); a newer version's list says which files differ, and
 * only those are downloaded (each checked by its hash) into the app's own folder rich4-update/v<version>/. The app's
 * native part serves that folder first (ios AppDelegate.swift UpdateRouter, android UpdateClient.java, desktop
 * main.cjs) and drops a version that three times fails to reach the title. Saves are never touched.
 *
 * The update server (scripts/publish-update.mjs): latest.json {version, shell, notes}; m/<version>.json the version's list
 * {version, shell, files: {path: [hash, size]}}; f/<hash> the files. `shell` is what the installed app's native part
 * can do (update-manifest.mjs SHELL): an update needing more is not applied — that phone is told to download the
 * new installer. Nothing on screen names a server (the user): only 「更新」.
 */
import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { audio } from './audio';
import { COMPAT_FROM, together } from '../core/compat';

const SERVER = 'https://rich.areu.pro/u';
const DIR = 'rich4-update';
/** The running version (in a downloaded version: its own). */
export const RUNNING = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0';

type Files = Record<string, [string, number]>;
interface Manifest { version: string; shell: number; files: Files }
/** `versions`: every version of this installer generation one can switch to (publish-update.mjs keeps the list). */
export interface Latest { version: string; shell: number; notes?: string[]; versions?: string[] }
export type UpdateState =
  | { kind: 'none' }                                   // the newest, or nothing to compare with (no answer, the web)
  | { kind: 'ready'; version: string; notes: string[] } // can be updated in the game (notes: what it changes)
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
    write: async (n, d) => {
      const data = b64(typeof d === 'string' ? new TextEncoder().encode(d) : d);
      // Four files download at once: two making the same new folder can fail with 「Missing parent directory」 (seen on
      // Android 2026-11-04, 「更新沒有完成」); the folder is there by the next try.
      for (let k = 0; ; k++) {
        try { await Filesystem.writeFile({ ...at(n), data, recursive: true }); return; }
        catch (e) { if (k >= 2) throw e; await new Promise(r => setTimeout(r, 150)); }
      }
    },
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
/**
 * Each installer generation reads its own file (the user 2026-11-13: 1.1.x is told once, by a 系統公告, that 1.2 needs a
 * new download, then left alone): latest.json stays at the last 1.1.x for the shell-1 apps, which so never see a 1.2.x
 * (no 「需要重新下載」 at every start, and their 派對模式 goes on among themselves); this code runs only on shell-2
 * installs (1.2 was never offered to 1.1 by the online update) and reads latest-2.json (publish-update.mjs).
 */
export const LATEST_FILE = 'latest-2.json';
export const fetchLatest = () => getJson<Latest>(`${base()}/${LATEST_FILE}`);

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
  return { kind: 'ready', version: latest.version, notes: Array.isArray(latest.notes) ? latest.notes.filter(n => typeof n === 'string') : [] };
}

const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b), x => x.toString(16).padStart(2, '0')).join('');
const hashOf = async (u: Uint8Array) => hex(await crypto.subtle.digest('SHA-256', u as Uint8Array<ArrayBuffer>)).slice(0, 32);

/** No byte for this long: the connection counts as dead and is opened again (a bad line can hang without an error). */
const STALL_MS = 20_000;
/** No progress for this long: the sheet says so (issue #67: a bar standing at 0.1 MB with no word on it). */
const SLOW_MS = 15_000;
/** What a stuck player can do (the user 2026-11-07); the word 伺服器 stays out of it, see the file's head. */
const NET_TIP = '中國大陸的網路有時連不上，可以換個網路（Wi-Fi／行動數據），或開啟加速工具再試。';

/**
 * One file by its hash, or null. A connection cut halfway goes on from the last byte that came (Range; the user
 * 2026-11-05: from mainland China 43% of the updates had a file cut off, on either server). Tries without a new byte
 * are limited, tries that gain some are not: each one brings the end nearer. `moved` follows the bytes (less than
 * zero when some are thrown away). A WebView refusing the Range header takes the whole file each time instead.
 */
export async function fetchFile(h: string, size: number, moved: (n: number) => void): Promise<Uint8Array | null> {
  const buf = new Uint8Array(size);
  let url = `${SERVER}/f/${h}`, got = 0, idle = 0, wrong = 0, refused = 0;
  const drop = () => { moved(-got); got = 0; };
  while (idle < 4 && wrong < 2) {
    if (refused >= 2) drop();
    const before = got, ctl = new AbortController();
    let timer = setTimeout(() => ctl.abort(), STALL_MS);
    const alive = () => { clearTimeout(timer); timer = setTimeout(() => ctl.abort(), STALL_MS); };
    const take = (u: Uint8Array) => { const n = Math.min(u.length, size - got); buf.set(u.subarray(0, n), got); got += n; moved(n); };
    let answered = false;
    try {
      const r = await fetch(url, { cache: 'no-store', signal: ctl.signal, ...(got ? { headers: { Range: `bytes=${got}-` } } : {}) });
      answered = true;
      alive();
      // where a redirect led: a resumed request goes there straight
      if (r.url) url = r.url;
      if (r.status !== 206) drop();
      if (r.ok) {
        const rd = r.body?.getReader();
        if (!rd) take(new Uint8Array(await r.arrayBuffer()));
        else {
          while (got < size) { const { done, value } = await rd.read(); if (done) break; alive(); take(value); }
          void rd.cancel().catch(() => {});
        }
      }
    } catch {
      if (got && !answered) refused++;
    } finally { clearTimeout(timer); }
    if (got === size) {
      if (await hashOf(buf) === h) return buf;
      drop();
      wrong++;
      continue;
    }
    idle = got > before && refused < 2 ? 0 : idle + 1;
    if (idle) await new Promise(r => setTimeout(r, 1000));
  }
  return null;
}

/**
 * Downloads `version` (only the files differing from the installed app and from the version running now) and makes
 * it the one the app starts with. `progress(done, total)` in bytes. Then the page is loaded again (the new version).
 */
export async function applyUpdate(version: string, progress: (done: number, total: number) => void): Promise<void> {
  const s = store();
  if (!s) throw new Error('這個版本不能在遊戲裡更新');
  const list = async () => { for (let k = 0; k < 3; k++) { const l = await getJson<Manifest>(`${base()}/m/${version}.json`, 30000); if (l) return l; } return null; };
  const [m, mine] = await Promise.all([list(), installed()]);
  if (!m || !mine) throw new Error(`暫時無法下載更新，請稍後再試\n${NET_TIP}`);
  // The version running now, when it is a downloaded one: its files can be taken over.
  const runningDir = RUNNING !== mine.version ? `v${RUNNING}` : '';
  let have: Files = {};
  if (runningDir) { try { have = JSON.parse(await text(s, `${runningDir}/.files.json`) ?? '{}') as Files; } catch { have = {}; } }
  // index.html always: the native part takes a downloaded version only when its folder has one (an update changing
  // pictures alone would otherwise be skipped at every start, its folder removed and offered again — issue #56).
  const need = Object.entries(m.files).filter(([p, [h]]) => mine.files[p]?.[0] !== h || p === 'index.html');
  // A try cut off left its finished files here: this one goes on from them (each checked by its hash again).
  const part = `v${version}.part`;
  for (const n of await s.list()) if (n.endsWith('.part') && n !== part) await s.remove(n);
  const total = need.reduce((n, [p, [h, size]]) => n + (have[p]?.[0] === h ? 0 : size), 0);
  let done = 0;
  progress(0, total);
  let next = 0;
  const moved = (n: number) => { done += n; progress(done, total); };
  const one = async ([p, [h, size]]: [string, [string, number]]) => {
    if (p.includes('..') || p.startsWith('/')) throw new Error('更新檔案有誤');
    const copy = have[p]?.[0] === h;
    const kept = await s.read(`${part}/${p}`);
    if (kept && await hashOf(kept) === h) { if (!copy) moved(size); return; }
    const data = (copy ? await s.read(`${runningDir}/${p}`) : null) ?? await fetchFile(h, size, moved);
    if (!data) throw new Error(`下載更新時網路中斷，再試一次會接著下載\n${NET_TIP}`);
    await s.write(`${part}/${p}`, data);
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
  const base = (await installed())?.version;
  // Issue #65 (mostly Android: back on the installed version after an update, the download deleted here): the
  // installer's own version started although a newer, complete download is still named in `current` — the native part
  // let it pass (it took over the page too late …). Load once more, into it, rather than throw it away; tried once a
  // session, and kept whatever happens (the native part itself drops a version that never starts: `current` goes).
  let current = '';
  if (base && RUNNING === base) {
    const cur = await text(s, 'current');
    if (cur && newer(cur, RUNNING) && await s.read(`v${cur}/index.html`)) {
      current = `v${cur}`;
      let tried = true;
      try { tried = sessionStorage.getItem(RELOAD_KEY) === cur; if (!tried) sessionStorage.setItem(RELOAD_KEY, cur); } catch { /* no storage: no reload */ }
      if (!tried && typeof location !== 'undefined') { location.reload(); return; }
    }
  }
  const keep = RUNNING !== base ? `v${RUNNING}` : '';
  for (const n of await s.list()) {
    const f = /^v([0-9.]+?)(\.part)?$/.exec(n);
    // a newer version's download that was cut off stays for the next try
    if (f && n !== keep && n !== current && !(f[2] && newer(f[1], RUNNING))) await s.remove(n);
  }
}

/** confirmStart's one reload a session into a download the installed version started over (issue #65). */
const RELOAD_KEY = 'rich4.update.reload';

// ------------------------------------------------------------------ on screen

const MB = (n: number) => (n / 1e6 < 0.1 ? '0.1' : (n / 1e6).toFixed(1));

/** A sheet with buttons (the game's own look); resolves with the button's index. */
function sheet(parent: HTMLElement, body: string, buttons: string[], notes: string[] = []): { el: HTMLElement; text: HTMLElement; row: HTMLElement; done: Promise<number> } {
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
  if (notes.length) {
    // what the version changes (the user 2026-11-04), as many lines as fit: nothing scrolls, nothing leaves the sheet
    const ul = document.createElement('ul');
    ul.className = 'up-notes';
    for (const n of notes) { const li = document.createElement('li'); li.textContent = n; ul.append(li); }
    t.after(ul);
    while (ul.children.length > 1 && ul.scrollHeight > ul.clientHeight + 1) ul.lastElementChild!.remove();
  }
  return { el: overlay, text: t, row, done };
}

/** Downloads with a progress bar; on a failure says so (and the old version keeps running). */
async function runUpdate(parent: HTMLElement, version: string): Promise<void> {
  const s = sheet(parent, `正在下載 v${version}…`, []);
  const bar = s.el.querySelector<HTMLElement>('.up-bar')!, fill = bar.querySelector<HTMLElement>('i')!;
  bar.hidden = false;
  let line = `正在下載 v${version}…`, most = 0, movedAt = Date.now();
  const show = () => { s.text.textContent = Date.now() - movedAt > SLOW_MS ? `${line}\n下載暫時沒有進度。${NET_TIP}` : line; };
  const watch = setInterval(show, 1000);
  try {
    await applyUpdate(version, (done, total) => {
      fill.style.width = `${total ? Math.round(done / total * 100) : 100}%`;
      line = total ? `正在下載 v${version}…\n${MB(done)} / ${MB(total)} MB` : `正在更新到 v${version}…`;
      if (done > most) { most = done; movedAt = Date.now(); }
      show();
    });
    clearInterval(watch);
  } catch (e) {
    clearInterval(watch);
    s.el.remove();
    await sheet(parent, `更新沒有完成：${(e as Error).message || '請稍後再試'}\n目前的 v${RUNNING} 照常可以玩。`, ['確定']).done.then(() => {});
    document.querySelector('.update-sheet')?.remove();
  }
}

const INSTALLER = (v: string) => `新版本 v${v} 需要重新下載安裝包\n（存檔會保留）`;
const DOWNLOAD_PAGE = 'https://github.com/iam567/rich4-renew-app/releases/latest';
function openDownloadPage() { window.open(DOWNLOAD_PAGE, '_blank'); }

/** The title: a newer version is offered once per start (playing alone may stay on the old one). */
let offered = false;
export async function offerOnTitle(parent: HTMLElement): Promise<void> {
  if (offered) return;
  offered = true;
  const st = await checkUpdate();
  if (st.kind === 'none' || !parent.isConnected) return;
  // went back to an older version on purpose (版本選擇): left alone until a version newer than the one it left
  const h = hold();
  if (h && !newer(st.version, h)) return;
  if (st.kind === 'installer') {
    const s = sheet(parent, `${INSTALLER(st.version)}\n目前的 v${RUNNING} 照常可以玩。`, ['前往下載', '以後再說']);
    const i = await s.done; s.el.remove();
    if (i === 0) openDownloadPage();
    return;
  }
  // a party game this device left unfinished (party-net.ts keeps its seat 12 hours): updating now keeps it out of that game
  const away = partyGameLeft() ? '\n\n你還有一局派對模式沒打完：更新後版本不同，就回不到那一局了。' : '';
  const s = sheet(parent, `有新版本 v${st.version}\n更新只下載有變動的部分，存檔會保留。${away}`, ['更新', '以後再說'], st.notes);
  const i = await s.done; s.el.remove();
  if (i === 0) await runUpdate(parent, st.version);
}

/** A party game this device was in within the last 12 hours (its seat kept for coming back, party-net.ts SEAT_KEY). */
function partyGameLeft(): boolean {
  try { const x = JSON.parse(localStorage.getItem('rich4.party.seat') ?? 'null') as { at?: number } | null; return !!x?.at && Date.now() - x.at < 12 * 3600_000; } catch { return false; }
}

/**
 * 派對模式 needs a version that plays with the newest (the user 2026-11-03: everyone online on the same rules; since
 * 1.2.2 one of the same family is enough, core/compat.ts). True: this phone may go on (it is
 * the newest, or the newest is not known — then the room's own version check still holds). False: it stays out.
 */
export async function partyNeedsUpdate(parent: HTMLElement): Promise<boolean> {
  const st = await checkUpdate();
  if (st.kind === 'none') return true;
  // (the user 2026-11-15: 「不更新也能聯機」) versions of one family play together (core/compat.ts, the room's oldest
  // version's rules): only a newer family still has to be fetched
  if (together(RUNNING, st.version)) return true;
  if (st.kind === 'installer') {
    const s = sheet(parent, `派對模式需要最新版本 v${st.version}\n${INSTALLER(st.version)}`, ['前往下載', '返回']);
    const i = await s.done; s.el.remove();
    if (i === 0) openDownloadPage();
    return false;
  }
  const s = sheet(parent, `派對模式需要最新版本 v${st.version}\n（你的是 v${RUNNING}）更新只下載有變動的部分，存檔會保留。`, ['更新', '返回'], st.notes);
  const i = await s.done; s.el.remove();
  if (i === 0) await runUpdate(parent, st.version);
  return false;
}

// ------------------------------------------------------------------ 版本選擇 (the user 2026-11-15)

/**
 * The user 2026-11-15 (1.2.1 broke 派對模式's room, issues #102 #103): 「可以在版本號那裡選擇老版本號，然後回歸到那一版本」,
 * 「限定回退到 1.2 版本，之前的版本就不支持了」. The title's version number lists this installer generation's versions
 * (1.2.2 on, SWITCH_FROM; never older than the installed app — the native part takes only a newer one); a version is downloaded as
 * an update is, the installed one is the app's own files again. Saves are never touched. An older version chosen, the
 * update is not offered again until there is one newer than the version left (HOLD_KEY).
 */
const HOLD_KEY = 'rich4.update.hold';
/**
 * The oldest version one may switch to (the user 2026-11-15: back on 1.2.0 its 派對模式 still asked for the update —
 * 1.2.0 and 1.2.1 require the newest version online, their code cannot be changed): this one, the first that plays
 * online without updating. Never older than the family's first (COMPAT_FROM).
 */
const SWITCH_FROM = newer('1.2.2', COMPAT_FROM) ? '1.2.2' : COMPAT_FROM;
function hold(): string { try { return localStorage.getItem(HOLD_KEY) ?? ''; } catch { return ''; } }
function setHold(v: string) { try { if (v) localStorage.setItem(HOLD_KEY, v); else localStorage.removeItem(HOLD_KEY); } catch { /* none kept */ } }

/** The versions one may switch to, newest first (none: no answer). */
export async function switchable(): Promise<string[]> {
  const [latest, mine] = await Promise.all([fetchLatest(), installed()]);
  if (!latest || !mine) return [];
  const all = new Set([...(Array.isArray(latest.versions) ? latest.versions : []), latest.version, mine.version, RUNNING]);
  return [...all].filter(v => typeof v === 'string' && /^\d+(\.\d+)*$/.test(v) && !newer(SWITCH_FROM, v) && !newer(mine.version, v))
    .sort((a, b) => (newer(a, b) ? -1 : newer(b, a) ? 1 : 0));
}

/** The title's version number or 更新日誌's 檢查更新 pressed: pick a version (the newest too) and switch to it. */
export async function pickVersion(parent: HTMLElement): Promise<void> {
  if (!store()) return;
  const wait = sheet(parent, '正在讀取版本列表…', []);
  const list = await switchable();
  wait.el.remove();
  if (!list.length) { await sheet(parent, `暫時讀不到版本列表，請稍後再試。\n${NET_TIP}`, ['確定']).done.then(r => r); document.querySelector('.update-sheet')?.remove(); return; }
  const shown = list.slice(0, 8);
  const top = newer(list[0], RUNNING) ? `有新版本 v${list[0]}，` : '已經是最新版本。';
  const body = `目前是 v${RUNNING}，${top}選一個版本切換過去，存檔會保留。\n新版本有問題時可以先退回舊版本，修好後再更新回來。`
    + (shown.length < 2 ? '\n（可以退回的版本從 v1.2.2 開始，以後的更新出來後這裡就會列出來）' : '');
  const s = sheet(parent, body, [...shown.map(v => (v === RUNNING ? `v${v}（目前）` : `v${v}`)), '返回']);
  s.el.classList.add('up-versions');
  const i = await s.done; s.el.remove();
  const v = shown[i];
  if (!v || v === RUNNING) return;
  await switchTo(parent, v);
}

async function switchTo(parent: HTMLElement, v: string): Promise<void> {
  const s = store(), mine = await installed();
  if (!s || !mine) return;
  const latest = (await fetchLatest())?.version ?? v;
  const was = hold();
  setHold(newer(latest, v) ? latest : '');
  if (v === mine.version) {
    // the app's own files: no downloaded version named, the native part serves the installed one
    await s.remove('current'); await s.remove('boot');
    if (typeof location !== 'undefined') location.reload();
    return;
  }
  await runUpdate(parent, v);
  setHold(was); // (still here: it did not happen)
}
