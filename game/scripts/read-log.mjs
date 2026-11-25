// Reads the game's error log off the iPhone on the cable (the user 2026-11-25; docs/rules/29 §錯誤記錄):
//   npm run log                 # the last 24 hours: what ended, crashed or stood still, then where the files are
//   npm run log -- --tail 80    # and the last 80 lines, the page's and the app's together
//   npm run log -- --device <udid>
//   npm run log -- --dir <folder>   # log files already here (a simulator's Library/rich4-log)
// Copies Library/rich4-log out of the app (nothing on the phone is changed) and the system's own crash reports about the
// app: App-*.ips / WebContent crashes, and the JetsamEvents in which the app or its web view was closed for memory.
// Works for an app installed from this computer (a development build), the phone unlocked once and trusted.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The iPhone on the cable (the first physical one this computer is paired with and can reach). */
function connected() {
  if (process.argv.includes('--dir')) return '';
  const j = join(mkdtempSync(join(tmpdir(), 'rich4-log-')), 'd.json');
  try {
    execFileSync('xcrun', ['devicectl', 'list', 'devices', '--json-output', j], { stdio: 'ignore' });
    const d = JSON.parse(readFileSync(j, 'utf8')).result.devices.filter(x => x.hardwareProperties?.platform === 'iOS' && x.hardwareProperties?.reality === 'physical');
    const on = d.filter(x => x.connectionProperties?.tunnelState !== 'unavailable');
    return (on[0] ?? d[0])?.hardwareProperties?.udid ?? '';
  } catch { return ''; }
}
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const APP = 'pro.areu.rich4', dir = arg('--dir'), device = arg('--device') ?? process.env.RICH4_PHONE ?? connected(), tail = Number(arg('--tail') ?? 0);
const out = join(root, '.cache', 'phone-log', new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-'));
mkdirSync(out, { recursive: true });

const devicectl = (...a) => execFileSync('xcrun', ['devicectl', ...a, '--device', device], { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 28 });
const fail = e => String(e.stderr ?? e.message ?? e).split('\n').filter(l => /ERROR|error|reason/i.test(l)).slice(0, 3).join(' ') || String(e.message);
function files(...domain) {
  const j = join(out, '.list.json');
  devicectl('device', 'info', 'files', ...domain, '--json-output', j);
  const l = JSON.parse(readFileSync(j, 'utf8')).result.files;
  rmSync(j);
  return l;
}
const copy = (domain, source, dest) => { devicectl('device', 'copy', 'from', ...domain, '--source', source, '--destination', dest); };

// ---------------------------------------------------------------- the game's own log
const own = ['--domain-type', 'appDataContainer', '--domain-identifier', APP];
const lines = []; // { t, src, kind, text, more }
try {
  const names = (dir ? readdirSync(dir) : files(...own, '--subdirectory', 'Library/rich4-log').map(f => f.name ?? f.relativePath)).map(n => n.split('/').pop()).filter(n => /^[wn]-\d{8}-\d\d\.log$/.test(n)).sort();
  for (const n of names) {
    const dest = join(out, n);
    if (dir) copyFileSync(join(dir, n), dest); else copy(own, `Library/rich4-log/${n}`, dest);
    const year = n.slice(2, 6);
    for (const raw of readFileSync(dest, 'utf8').split('\n')) {
      const m = /^((\d\d-\d\d) (\d\d:\d\d:\d\d\.\d{3})) (\S+) ?(.*)$/.exec(raw);
      if (m) lines.push({ t: `${year}-${m[2]} ${m[3]}`, src: n[0] === 'w' ? '頁' : '殼', kind: m[4], text: m[5], more: [] });
      else if (raw && lines.length) lines.at(-1).more.push(raw);
    }
  }
  lines.sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
} catch (e) { console.log(`讀不到遊戲的記錄：${fail(e)}`); }

const show = l => `${l.t.slice(5)} [${l.src}] ${l.kind} ${l.text.slice(0, 400)}${l.more.length ? `\n      ${l.more.slice(0, 8).join('\n      ')}` : ''}`;
if (lines.length) {
  writeFileSync(join(out, 'all.log'), lines.map(l => `${l.t} [${l.src}] ${l.kind} ${l.text}${l.more.length ? `\n${l.more.join('\n')}` : ''}`).join('\n'));
  console.log(`遊戲記錄：${lines.length} 條，${lines[0].t} 到 ${lines.at(-1).t}\n`);
  // the page starting again without a new launch and without having left: the web view was closed by the system
  let launched = false, left = true, n = 0;
  for (const l of lines) {
    if (l.kind === 'LAUNCH') launched = true;
    if (l.kind === 'BYE') left = true;
    if (l.kind === 'START') {
      if (!launched && !left) { n++; console.log(`★ ${l.t} 頁面突然重新開始（App 沒重開）：網頁進程被系統關了`); }
      launched = false; left = false;
      if (/CUT OFF/.test(l.text)) { n++; console.log(`★ ${l.t} ${l.text.slice(l.text.indexOf('LAST RUN'))}`); }
    }
    if (/^(ERR|CRASH|HANG|STALL|MEMORY-WARNING|ERROR)$/.test(l.kind)) { n++; console.log(show(l)); }
  }
  if (!n) console.log('沒有閃退、報錯或卡住。');
} else console.log('遊戲裡還沒有記錄（這個版本還沒打開過？）');

// ---------------------------------------------------------------- the system's own reports about the app
const sys = ['--domain-type', 'systemCrashLogs'], since = Date.now() - 24 * 3600_000;
if (!dir) try {
  const all = files(...sys).filter(f => new Date(f.metadata?.lastModDate ?? 0).getTime() > since).map(f => f.relativePath);
  const want = all.filter(n => /(^|\/)(App|com\.apple\.WebKit\.WebContent|JetsamEvent|ExcUserFault_(App|com\.apple\.WebKit))[-.].*\.ips$/.test(n));
  console.log(`\n系統的報告（24 小時內，跟遊戲可能有關的 ${want.length} 份）：`);
  for (const n of want) {
    const dest = join(out, n.replace(/\//g, '_'));
    try { copy(sys, n, dest); } catch (e) { console.log(`  ${n}：讀不到 ${fail(e)}`); continue; }
    const t = readFileSync(dest, 'utf8'), cut = t.indexOf('\n');
    let head = {}, b = {};
    try { head = JSON.parse(t.slice(0, cut)); b = JSON.parse(t.slice(cut + 1)); } catch { /* shown by name only */ }
    if (/JetsamEvent/.test(n)) {
      const page = b.memoryStatus?.pageSize ?? 16384, mb = p => Math.round((p.rpages ?? 0) * page / 1048576);
      const app = (b.processes ?? []).filter(p => p.name === 'App');
      const ours = (b.processes ?? []).filter(p => p.name === 'App' || (/WebKit/.test(p.name) && app.some(a => a.coalition === p.coalition)));
      const killed = ours.filter(p => p.reason);
      console.log(`  ${b.date ?? n}：${killed.length ? `★ 遊戲因為記憶體被系統關掉：${killed.map(p => `${p.name} ${mb(p)} MB（${p.reason}，${(p.states ?? []).join(' ')}）`).join('、')}` : `系統記憶體不夠，記錄裡關的不是遊戲${ours.length ? `（遊戲當時 ${ours.map(p => `${p.name.split('.').pop()} ${mb(p)} MB`).join('、')}，${(app[0]?.states ?? []).join(' ')}）` : '（遊戲沒在運行）'}`}`);
      if (!killed.length) rmSync(dest); // other apps' names are none of the game's business
    } else if ((b.bundleInfo?.CFBundleIdentifier ?? head.bundleID ?? '').startsWith(APP) || /WebKit/.test(n)) {
      console.log(`  ★ ${head.timestamp ?? n} ${n}：${b.exception?.type ?? ''} ${b.exception?.signal ?? ''} ${b.termination?.indicator ?? ''} ${(b.asi && JSON.stringify(b.asi).slice(0, 300)) || ''}`);
    } else rmSync(dest); // another app called App
  }
} catch (e) { console.log(`讀不到系統的報告：${fail(e)}`); }

if (tail && lines.length) console.log(`\n最後 ${tail} 條：\n${lines.slice(-tail).map(show).join('\n')}`);
if (existsSync(join(out, 'all.log'))) console.log(`\n全部：${join(out, 'all.log')}（${readdirSync(out).length} 個檔案）`);
