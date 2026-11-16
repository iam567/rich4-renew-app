/**
 * 屏幕常亮 (the user 2026-11-16: watching a party game, or with 托管 on, the phone locked itself after a while):
 * while a game is on screen the screen is kept on — the Screen Wake Lock where the web view has it, and a tiny
 * silent looping video behind the game (Android's web view has no wake lock; a playing video keeps the screen on).
 * Asked again whenever the app comes back to the front (a wake lock ends when it is hidden).
 */
const CLIP = 'data:video/mp4;base64,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';

type Sentinel = { release(): Promise<void>; addEventListener(t: 'release', f: () => void): void };
let want = false, lock: Sentinel | null = null, video: HTMLVideoElement | null = null;

/** Keeps the screen on (true) or lets it sleep again (false). */
export function keepAwake(on: boolean) {
  if (want === on) return;
  want = on;
  void apply();
}

async function apply() {
  if (!want) {
    const l = lock; lock = null;
    void l?.release().catch(() => {});
    video?.pause();
    return;
  }
  if (document.visibilityState !== 'visible') return;
  const wl = (navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<Sentinel> } }).wakeLock;
  if (wl) {
    try {
      if (!lock) {
        const l = await wl.request('screen');
        if (!want) { void l.release().catch(() => {}); return; }
        lock = l;
        l.addEventListener('release', () => { if (lock === l) lock = null; });
      }
    } catch { /* not allowed here */ }
  }
  // the video as well: an app's web view may grant the lock and still let the screen sleep (older iOS)
  if (!video) {
    video = document.createElement('video');
    video.setAttribute('playsinline', '');
    video.setAttribute('aria-hidden', 'true');
    video.muted = true;
    video.loop = true;
    video.src = CLIP;
    // the whole screen, unseen behind the game: Android keeps the screen on only for a video big enough on the page
    // (a 1 px one let it sleep on the test phone; this one kept it on — tried 2026-11-16, covered and transparent)
    Object.assign(video.style, { position: 'fixed', left: '0', top: '0', width: '100vw', height: '100vh', objectFit: 'fill', opacity: '0', pointerEvents: 'none', zIndex: '-1' });
    document.body.append(video);
  }
  void video.play().catch(() => {
    // not before a touch (some web views): the next touch starts it
    window.addEventListener('pointerdown', () => { if (want) void video?.play().catch(() => {}); }, { once: true, capture: true });
  });
}

// back in front: asked again (a wake lock ends when the app is hidden); hidden: the video stops too
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void apply(); else video?.pause(); });
