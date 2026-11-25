import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

/** The app's version (package.json), shown on the title screen. */
const version = (JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }).version;

// Relative base so the build also runs from a file:// bundle (iOS app). RICH4_NO_ASSETS=1 skips copying the
// linked art (public/assets, over 1 GB) for quick test builds that link it instead.
export default defineConfig({
  base: './',
  // RICH4_POLL=1: watch files by polling (a busy Mac's file events get lost and the dev server serves old files)
  ...(process.env.RICH4_POLL ? { server: { watch: { usePolling: true, interval: 500, ignored: ['**/public/**', '**/node_modules/**', '**/android/**', '**/ios/**', '**/.cache/**', '**/dist*/**', '**/electron/**'] } } } : {}),
  // RICH4_UPDATE_CHANNEL=test: a build that takes its online updates from the test channel (ui/update.ts).
  define: { __APP_VERSION__: JSON.stringify(version), __UPDATE_CHANNEL__: JSON.stringify(process.env.RICH4_UPDATE_CHANNEL ?? '') },
  build: {
    copyPublicDir: !process.env.RICH4_NO_ASSETS,
    // Android's System WebView can be old on phones without Google Play (issue #7: HarmonyOS 4.2 runs the APK on
    // Huawei's own WebView) and on TVs, which seldom update it (issue #121: a Sony TV stuck on the green background —
    // `?.` / `??` are Chrome 80, and the script stopped at its first line): the script is lowered for Chrome 74
    // (Android 10's own WebView; ui/compat.ts fills in the newer functions), the style sheets for Chrome 74 too
    // (`inset` and the like written out the old way).
    target: ['chrome74', 'edge88', 'firefox104', 'safari16'],
    cssTarget: ['chrome74', 'edge107', 'firefox104', 'safari16'],
  },
});
