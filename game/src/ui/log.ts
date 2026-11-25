/**
 * The error log (the user 2026-11-25: 「加一個錯誤log記錄功能…一連上數據線就能讀取出來是什麼原因…保存24小時就行」): what the game
 * was doing, kept on this device for 24 hours, so a crash can be read over the cable afterwards (scripts/read-log.mjs).
 * Nothing is sent anywhere and nothing of it shows in the game. Files on the iPhone only (the user 2026-11-25: 「安卓無所謂，我主要是ios」).
 *
 * One file an hour, `rich4-log/w-YYYYMMDD-HH.log` (the app's own Library folder),
 * lines `MM-DD HH:MM:SS.mmm KIND text`. The app's native side (AppDelegate.swift NativeLog) writes its own lines beside them (`n-*.log`: launch, the
 * system's memory warnings, the app to the back, the web view lost, the last crash's stack). Kinds:
 * - START: the page came up (and how the run before it ended) · ERR: a program error · WARN / ERROR: the console's
 * - STEP: the steps the game took · BEAT: every 30 s, where the game is and what it holds in memory
 * - HIDE / SHOW / BYE: the page to the back, to the front, left · STALL: the page stood still
 * Lines go out every second; an error, a page going to the back at once. Server addresses are left out.
 */
import { Capacitor } from '@capacitor/core';

export const LOG_DIR = 'rich4-log', KEEP_MS = 24 * 3600_000;
/** What one hour's file takes; past it only the lines that matter (errors, starts, ends). */
const HOUR_CAP = 1_000_000, LINE_CAP = 4000, FLUSH_MS = 1000, BEAT_MS = 30_000, STALL_MS = 3000;

const p2 = (n: number) => String(n).padStart(2, '0');
export const logFile = (t: Date) => `w-${t.getFullYear()}${p2(t.getMonth() + 1)}${p2(t.getDate())}-${p2(t.getHours())}.log`;
export const stamp = (t: Date) => `${p2(t.getMonth() + 1)}-${p2(t.getDate())} ${p2(t.getHours())}:${p2(t.getMinutes())}:${p2(t.getSeconds())}.${String(t.getMilliseconds()).padStart(3, '0')}`;
/** The log files (page's and app's) whose hour ended more than 24 hours ago. */
export function oldLogs(names: string[], now: Date): string[] {
  return names.filter(n => {
    const m = /^[wn]-(\d{4})(\d\d)(\d\d)-(\d\d)\.log$/.exec(n);
    return !!m && new Date(+m[1], +m[2] - 1, +m[3], +m[4] + 1).getTime() < now.getTime() - KEEP_MS;
  });
}
/** Server addresses out (players never learn of them); the page's own files keep their path. */
export function redact(s: string): string {
  return s.replace(/\b(https?|wss?|capacitor|app|file):\/\/([^/\s"')]*)/gi, (m, proto: string, host: string) =>
    (/^(capacitor|app|file)$/i.test(proto) || /^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? m : `${proto}://…`))
    .replace(/\b\d{1,3}(\.\d{1,3}){3}(:\d+)?\b/g, m => (m.startsWith('127.0.0.1') ? m : '…'));
}
/** How the run before ended, from the page's last lines: '' nothing known, else a word for the START line. */
export function lastEnd(tail: string): string {
  const lines = tail.split('\n').filter(l => /^\d\d-\d\d \d\d:/.test(l));
  const last = lines[lines.length - 1];
  if (!last) return '';
  const kind = last.split(' ')[2] ?? '';
  const at = last.slice(0, 14);
  if (kind === 'BYE') return `last run left normally at ${at}`;
  if (kind === 'HIDE') return `last run ended in the background at ${at}`;
  return `LAST RUN CUT OFF in front at ${at}: ${last.slice(19, 219)}`;
}

interface Out { append(file: string, text: string): Promise<void>; list(): Promise<string[]>; remove(file: string): Promise<void>; tail(file: string): Promise<string> }
const kept = () => { try { return Capacitor.getPlatform() === 'ios'; } catch { return false; } };

let outP: Promise<Out | null> | null = null;
const out = () => (outP ??= (async (): Promise<Out | null> => {
  if (!kept()) return null;
  const { Filesystem: F, Directory, Encoding } = await import('@capacitor/filesystem');
  const directory = Directory.Library, path = (f: string) => `${LOG_DIR}/${f}`;
  await F.mkdir({ path: LOG_DIR, directory, recursive: true }).catch(() => {});
  return {
    append: async (f, data) => { await F.appendFile({ path: path(f), data, directory, encoding: Encoding.UTF8 }); },
    list: async () => (await F.readdir({ path: LOG_DIR, directory })).files.map(x => x.name),
    remove: f => F.deleteFile({ path: path(f), directory }),
    tail: async f => { const r = await F.readFile({ path: path(f), directory, encoding: Encoding.UTF8 }); return typeof r.data === 'string' ? r.data.slice(-4000) : ''; },
  };
})().catch(() => null));

/** Lines not written yet; the last 300 too, for `__rich4Log()` in the console. */
let queue: string[] = [], timer = 0, writing: Promise<void> = Promise.resolve();
let hour = '', hourBytes = 0;
const recent: string[] = [];
const MATTERS = /^(START|ERR|ERROR|STALL|HIDE|SHOW|BYE)$/;

function put(kind: string, text: string, now = new Date()) {
  const f = logFile(now);
  if (f !== hour) { hour = f; hourBytes = 0; }
  if (hourBytes > HOUR_CAP && !MATTERS.test(kind)) return;
  if (hourBytes > 2 * HOUR_CAP) return;
  const line = `${stamp(now)} ${kind} ${redact(text).slice(0, LINE_CAP).replace(/\n/g, '\n    ')}`;
  hourBytes += line.length;
  recent.push(line);
  if (recent.length > 300) recent.shift();
  if (kept()) queue.push(line);
}
function flush() {
  clearTimeout(timer);
  timer = 0;
  steps();
  if (!queue.length) return;
  const text = `${queue.join('\n')}\n`, f = hour;
  queue = [];
  writing = writing.then(async () => { await (await out())?.append(f, text); }).catch(() => { /* not kept */ });
}
const soon = () => { if (!timer) timer = window.setTimeout(flush, FLUSH_MS); };

/** A line in the log; `now`: written at once (an error). */
export function log(kind: string, text: string, now = false) {
  if (!started) return;
  steps();
  put(kind, text);
  // at once, but never more than 60 a minute that way (an error that comes again and again)
  const t = Date.now();
  if (t - burstAt > 60_000) { burstAt = t; burst = 0; }
  if (now && ++burst <= 60) flush(); else soon();
}
let burst = 0, burstAt = 0;

/** The steps since the last line, the same one again counted. */
let stepList: string[] = [];
function steps() {
  if (!stepList.length) return;
  const run: [string, number][] = [];
  for (const s of stepList) { const l = run[run.length - 1]; if (l?.[0] === s) l[1]++; else run.push([s, 1]); }
  stepList = [];
  put('STEP', run.map(([s, n]) => (n > 1 ? `${s}×${n}` : s)).join(' > '));
}
export function logStep(s: string) {
  if (!started) return;
  stepList.push(s);
  if (stepList.length > 60) steps();
  soon();
}

/** Where the game is now (main.ts): the map, the day, whose turn, the memory held. */
let state: () => string = () => 'no game open';
export function setLogState(f: () => string) { state = f; }
const where = () => { try { return state(); } catch (e) { return `(state: ${String(e)})`; } };

async function cleanUp() {
  const o = await out();
  if (!o) return;
  for (const f of oldLogs(await o.list().catch(() => []), new Date())) await o.remove(f).catch(() => {});
}

/** The console's lines that mean nothing: files asked for that are not there yet, and this log's own files. */
export const noise = (t: string) => /OS-PLUG-FILE-00(08|10)/.test(t) || (t.includes('OS-PLUG-FILE') && t.includes(LOG_DIR)) || /already registered/.test(t);
const brief = (a: unknown): string => {
  if (a instanceof Error) return `${a.message}\n${a.stack ?? ''}`;
  if (typeof a === 'string') return a;
  try { return JSON.stringify(a) ?? String(a); } catch { return String(a); }
};

let started = false;
/** Starts the log (main.ts, before anything else of the game). */
export function startLog(info: string) {
  if (started || typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
  started = true;
  const at = stamp(new Date()), file = logFile(new Date());
  // how the run before ended, read before this run's first line goes out
  writing = (async () => {
    let end = '';
    const o = await out();
    if (o) {
      const files = (await o.list().catch(() => [])).filter(n => /^w-\d{8}-\d\d\.log$/.test(n)).sort();
      if (files.length) end = lastEnd(await o.tail(files[files.length - 1]!).catch(() => ''));
    }
    const line = `${at} START ${info}${end ? ` | ${end}` : ''}`;
    recent.push(line);
    if (o) await o.append(file, `${line}\n`);
  })().catch(() => { /* not kept */ });
  void writing.then(cleanUp).catch(() => {});

  window.addEventListener('error', e => {
    if (/ResizeObserver loop/.test(String(e.message))) return;
    log('ERR', `${e.message || 'error'} ${e.filename ?? ''}:${e.lineno ?? ''}:${e.colno ?? ''}\n${(e.error as Error | undefined)?.stack ?? ''}\n${where()}`, true);
  });
  window.addEventListener('unhandledrejection', e => { if (!noise(brief(e.reason))) log('ERR', `unhandled: ${brief(e.reason)}\n${where()}`, true); });
  for (const [k, kind] of [['warn', 'WARN'], ['error', 'ERROR']] as const) {
    const old = console[k].bind(console);
    console[k] = (...a: unknown[]) => { old(...a); const t = a.map(brief).join(' '); if (!noise(t)) log(kind, t, true); };
  }

  // the taps just before the page goes away: many, low on the screen — the home swipe taken by mistake
  let taps: { t: number; x: number; y: number }[] = [];
  window.addEventListener('pointerdown', e => { taps.push({ t: performance.now(), x: e.clientX, y: e.clientY }); if (taps.length > 40) taps = taps.slice(-20); }, { capture: true, passive: true });
  const tapped = () => {
    const now = performance.now(), l = taps.filter(x => now - x.t < 2000), last = l[l.length - 1];
    return last ? `${l.length} taps in the last 2 s, the last at ${Math.round(last.x)},${Math.round(last.y)} of ${innerWidth}x${innerHeight}` : 'no taps in the last 2 s';
  };
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) log('HIDE', `${tapped()} | ${where()}`, true); else log('SHOW', '', true);
  });
  window.addEventListener('pagehide', () => log('BYE', tapped(), true));
  window.addEventListener('webglcontextlost', () => log('ERR', 'webgl context lost', true), true);

  // the page standing still (a long task) while in front
  let last = performance.now(), wasHidden = document.hidden, beat = last, swept = Date.now();
  window.setInterval(() => {
    const now = performance.now(), gap = now - last - 1000;
    last = now;
    if (gap > STALL_MS && !document.hidden && !wasHidden) log('STALL', `${(gap / 1000).toFixed(1)} s | ${where()}`, true);
    wasHidden = document.hidden;
    if (!document.hidden && now - beat >= BEAT_MS) { beat = now; log('BEAT', where()); }
    if (Date.now() - swept > 3600_000) { swept = Date.now(); void cleanUp().catch(() => {}); }
  }, 1000);
  (window as unknown as { __rich4Log: () => string[] }).__rich4Log = () => { steps(); return [...recent]; };
}
