import { defineConfig } from 'vite';

// Relative base so the build also runs from a file:// bundle (iOS app). RICH4_NO_ASSETS=1 skips copying the
// linked art (public/assets, over 1 GB) for quick test builds that link it instead.
export default defineConfig({
  base: './',
  build: { copyPublicDir: !process.env.RICH4_NO_ASSETS },
});
