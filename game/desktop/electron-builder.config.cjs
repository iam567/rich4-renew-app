// electron-builder for 大富翁4 on Windows / macOS (scripts/desktop.mjs). The game's build (RICH4_DIST, the same dist/ as the
// phone apps, ~1.6 GB of art) goes in as plain resources next to the app, not into the asar.
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const version = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')).version;
// RICH4_ELECTRON=22.3.27: the Windows 7 / 8 build (Electron 22 is the last for them; main.cjs serves the game by
// the file protocol there).
module.exports = {
  ...(process.env.RICH4_ELECTRON ? { electronVersion: process.env.RICH4_ELECTRON } : {}),
  appId: 'pro.areu.rich4',
  productName: '大富翁4',
  executableName: 'Rich4',
  copyright: 'Rich4 remake',
  extraMetadata: { version },
  directories: { output: process.env.RICH4_DESKTOP_OUT || join(__dirname, 'out'), buildResources: 'build' },
  files: ['main.cjs', 'preload.cjs', 'package.json'],
  extraResources: [{ from: process.env.RICH4_DIST || join(__dirname, '..', 'dist'), to: 'dist' }],
  asar: true,
  compression: 'store',            // the art is WebP / MP3 already: nothing to gain, much time to lose
  electronLanguages: ['zh-TW', 'zh-CN', 'en-US', 'ja'],
  mac: { target: [{ target: 'dir', arch: ['universal'] }], category: 'public.app-category.board-games', icon: 'build/icon.png',
         identity: null, hardenedRuntime: false, gatekeeperAssess: false, x64ArchFiles: '**/*' },
  win: { target: [{ target: 'zip', arch: ['x64'] }], icon: 'build/icon.ico', signAndEditExecutable: false },
};
