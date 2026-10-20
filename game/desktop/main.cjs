// 大富翁4 for Windows and macOS (the user 2026-10-20): the same web build (../dist) in an Electron window.
// The game is served from its own app:// origin (fetch of the maps' JSON and the art works, unlike file://), saves live
// in the browser storage of the app's profile (IndexedDB, as on the web), 派對模式's WebRTC works as in Chrome.
const { app, BrowserWindow, Menu, net, protocol, shell } = require('electron');
const { join, normalize } = require('node:path');
const { pathToFileURL } = require('node:url');

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }]);
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const DIST = process.env.RICH4_DIST || (app.isPackaged ? join(process.resourcesPath, 'dist') : join(__dirname, '..', 'dist'));

function createWindow() {
  const win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 800, minHeight: 500, backgroundColor: '#0b2427', title: '大富翁4',
    autoHideMenuBar: true, webPreferences: { contextIsolation: true, sandbox: true },
  });
  win.loadURL('app://rich4/index.html');
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

app.whenReady().then(() => {
  protocol.handle('app', req => {
    const path = decodeURIComponent(new URL(req.url).pathname);
    const file = normalize(join(DIST, path));
    if (!file.startsWith(DIST)) return new Response('', { status: 403 });
    if (!require('node:fs').existsSync(file)) { if (process.env.RICH4_SHOT) console.log('MISSING', path); return new Response('', { status: 404 }); }
    return net.fetch(pathToFileURL(file).toString());
  });
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
