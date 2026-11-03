// 大富翁4 for Windows and macOS (the user 2026-10-20): the same web build (../dist) in an Electron window.
// The game is served from its own app:// origin (fetch of the maps' JSON and the art works, unlike file://), saves live
// in the browser storage of the app's profile (IndexedDB, as on the web), 派對模式's WebRTC works as in Chrome.
const { app, BrowserWindow, ipcMain, Menu, net, protocol, shell } = require('electron');
const fs = require('node:fs');
const { dirname, join, normalize, sep } = require('node:path');
const { pathToFileURL } = require('node:url');

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }]);
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// Test runs keep their own profile (RICH4_USER_DATA=<dir>): the player's saves in the app's real profile stay untouched.
if (process.env.RICH4_USER_DATA) app.setPath('userData', process.env.RICH4_USER_DATA);
const DIST = process.env.RICH4_DIST || (app.isPackaged ? join(process.resourcesPath, 'dist') : join(__dirname, '..', 'dist'));

// 在線更新 (docs/rules/29, game/src/ui/update.ts): a newer version downloaded into <userData>/rich4-update/v<version>/
// holds only the files that changed; every request looks there first, then in DIST. The same rules as the phone
// apps (ios AppDelegate.swift UpdateRouter, android UpdateClient.java): chosen when index.html loads — `current`, if
// newer than DIST's own build (update-base.json); `boot` counts starts that never reached the title (the page deletes
// it), and after three that version is dropped (`bad`).
const UPDATE = join(app.getPath('userData'), 'rich4-update');
let overlay = null;
const uRead = name => { try { return fs.readFileSync(join(UPDATE, name), 'utf8').trim(); } catch { return null; } };
const uWrite = (name, text) => { try { fs.mkdirSync(UPDATE, { recursive: true }); fs.writeFileSync(join(UPDATE, name), text); } catch { /* not kept */ } };
const uRemove = name => { try { fs.rmSync(join(UPDATE, name), { recursive: true, force: true }); } catch { /* gone */ } };
const newer = (a, b) => {
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const p = x[i] || 0, q = y[i] || 0; if (p !== q) return p > q; }
  return false;
};
function chooseOverlay() {
  const ver = uRead('current');
  if (!ver || !/^[0-9]+(\.[0-9]+){1,3}$/.test(ver)) return null;
  const dir = join(UPDATE, `v${ver}`);
  if (!fs.existsSync(join(dir, 'index.html'))) return null;
  let own = '';
  try { own = JSON.parse(fs.readFileSync(join(DIST, 'update-base.json'), 'utf8')).version || ''; } catch { /* none */ }
  if (!newer(ver, own)) { uRemove('current'); return null; }
  const [bv, bn] = (uRead('boot') || '').split(' ');
  const tries = bv === ver ? Number(bn) || 0 : 0;
  if (tries >= 3) { uRemove('current'); uRemove('boot'); uWrite('bad', ver); return null; }
  uWrite('boot', `${ver} ${tries + 1}`);
  return dir;
}
/** A name inside rich4-update (no way out of it). */
const inside = name => { const f = normalize(join(UPDATE, String(name))); if (!f.startsWith(UPDATE + sep)) throw new Error('outside'); return f; };
ipcMain.handle('update:read', (_e, name) => { try { return new Uint8Array(fs.readFileSync(inside(name))); } catch { return null; } });
ipcMain.handle('update:write', (_e, name, data) => { const f = inside(name); fs.mkdirSync(dirname(f), { recursive: true }); fs.writeFileSync(f, typeof data === 'string' ? data : Buffer.from(data)); return true; });
ipcMain.handle('update:remove', (_e, name) => { fs.rmSync(inside(name), { recursive: true, force: true }); return true; });
ipcMain.handle('update:rename', (_e, from, to) => { const b = inside(to); fs.rmSync(b, { recursive: true, force: true }); fs.renameSync(inside(from), b); return true; });
ipcMain.handle('update:list', () => { try { return fs.readdirSync(UPDATE); } catch { return []; } });

function createWindow() {
  // RICH4_SIZE=WxH (test runs, scripts/ui-sweep.mjs): that content size, phone sizes included.
  const size = /^(\d+)x(\d+)$/.exec(process.env.RICH4_SIZE || '');
  const win = new BrowserWindow({
    width: size ? Number(size[1]) : 1280, height: size ? Number(size[2]) : 800, useContentSize: !!size,
    minWidth: size ? 200 : 800, minHeight: size ? 200 : 500, backgroundColor: '#0b2427', title: '大富翁4',
    autoHideMenuBar: true, webPreferences: { contextIsolation: true, sandbox: true, preload: join(__dirname, 'preload.cjs') },
  });
  win.loadURL('app://rich4/index.html');
  // Test runs: the page asks for a picture of itself (console 'RICH4-SHOT name' -> RICH4_SHOTS_DIR/name.png).
  if (process.env.RICH4_SHOTS_DIR) win.webContents.on('console-message', async (_e, _level, message) => {
    const m = /^RICH4-SHOT (.+)$/.exec(String(message));
    if (m) require('node:fs').writeFileSync(join(process.env.RICH4_SHOTS_DIR, `${m[1].replace(/[\/:]/g, '_').slice(0, 80)}.png`), (await win.webContents.capturePage()).toPNG());
  });
  // A scripted run (RICH4_STEPS=steps.json: [{ js, wait, shot }]): each step's script in the page, a wait, a picture.
  if (process.env.RICH4_STEPS) win.webContents.once('did-finish-load', async () => {
    const fs = require('node:fs'), steps = JSON.parse(fs.readFileSync(process.env.RICH4_STEPS, 'utf8'));
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    for (const st of steps) {
      if (st.js) {
        try {
          const v = await win.webContents.executeJavaScript(st.js);
          if (st.out) console.log('STEP-OUT', JSON.stringify(v)); // the step's result, for the script that ran it
        } catch (e) { console.log('STEP-ERR', String(e).slice(0, 200)); }
      }
      await sleep(st.wait ?? 1000);
      if (st.shot) { fs.writeFileSync(st.shot, (await win.webContents.capturePage()).toPNG()); console.log('SHOT', st.shot); }
    }
    app.quit();
  });
  // A check without hands (RICH4_SHOT=file.png): a picture of the window after a while, then quit.
  if (process.env.RICH4_SHOT) setTimeout(async () => {
    const img = await win.webContents.capturePage();
    require('node:fs').writeFileSync(process.env.RICH4_SHOT, img.toPNG());
    if (process.env.RICH4_CLICK) await win.webContents.executeJavaScript(process.env.RICH4_CLICK).catch(() => {});
    if (process.env.RICH4_SHOT2) setTimeout(async () => { require('node:fs').writeFileSync(process.env.RICH4_SHOT2, (await win.webContents.capturePage()).toPNG()); app.quit(); }, 15000);
    else app.quit();
  }, Number(process.env.RICH4_WAIT || 8000));
  // Links out (GitHub, the releases) open in the system browser.
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && (input.key === 'F11' || (input.key === 'Enter' && input.alt))) { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
  });
}

/** The file an app:// request is served from (the update's first, then DIST), or the HTTP status when there is none. */
function appFile(url) {
  let path = decodeURIComponent(new URL(url).pathname);
  if (path === '/' || path === '/index.html') { path = '/index.html'; overlay = chooseOverlay(); }
  if (overlay) {
    const o = normalize(join(overlay, path));
    if (o.startsWith(overlay + sep) && fs.existsSync(o)) return { file: o };
  }
  const file = normalize(join(DIST, path));
  if (!file.startsWith(DIST)) return { status: 403 };
  if (!fs.existsSync(file)) { if (process.env.RICH4_SHOT) console.log('MISSING', path); return { status: 404 }; }
  return { file };
}

app.whenReady().then(() => {
  // Electron 25 and up: protocol.handle. The Windows 7 build (the user 2026-11-03) runs Electron 22, the last for
  // Windows 7 / 8, which only has the file protocol: the same files, by path (error -6 = not found, -10 = denied).
  if (protocol.handle) {
    protocol.handle('app', req => {
      const r = appFile(req.url);
      return r.file ? net.fetch(pathToFileURL(r.file).toString()) : new Response('', { status: r.status });
    });
  } else {
    protocol.registerFileProtocol('app', (req, cb) => {
      const r = appFile(req.url);
      cb(r.file ? { path: r.file } : { error: r.status === 404 ? -6 : -10 });
    });
  }
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: '大富翁4', submenu: [{ role: 'about', label: '關於大富翁4' }, { type: 'separator' }, { role: 'hide', label: '隱藏' }, { role: 'quit', label: '結束' }] },
      { label: '視窗', submenu: [{ role: 'togglefullscreen', label: '全螢幕' }, { role: 'minimize', label: '最小化' }, { role: 'reload', label: '重新載入' }] },
    ]));
  } else Menu.setApplicationMenu(null);
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => app.quit());
