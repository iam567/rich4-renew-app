import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

/** The app's version (package.json), shown on the title screen. */
const version = (JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }).version;

// Relative base so the build also runs from a file:// bundle (iOS app). RICH4_NO_ASSETS=1 skips copying the
// linked art (public/assets, over 1 GB) for quick test builds that link it instead.
export default defineConfig({
  base: './',
  define: { __APP_VERSION__: JSON.stringify(version) },
  build: { copyPublicDir: !process.env.RICH4_NO_ASSETS },
});
