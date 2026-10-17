/**
 * What the board needs before it is shown (the loading screen, ui/loading.ts), within the device's memory tier
 * (ui/mem-tier.ts): every sprite it draws for the map as it is now — on a low-memory device only those near the
 * first view —, decoded at the board's density; the HTML pictures of the panels round it; the ground tiles of the
 * first view and a margin (the whole ground when it fits the tier's budget); the first clip the game plays. The
 * board is already built and drawing under the loading screen, so its own per-frame upkeep starts the tiles; this
 * waits for them. Anything else (far tiles, sprites seen later) streams in as before.
 */
import type { BoardView } from './board-view';
import { preloadClips } from './effects';
import { memTier } from './mem-tier';

const frame = () => new Promise<void>(r => requestAnimationFrame(() => r()));
const later = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export interface PreloadOptions {
  /** HTML around the board whose pictures should be decoded too (the game screen's panels). */
  root?: HTMLElement;
  /** Clips the game plays first (a new game's first landing). */
  clips?: number[];
  /** Progress 0..1 and what is loading. */
  onProgress?: (f: number, what: string) => void;
  /** False once the board was left (another game started): stop waiting. */
  alive?: () => boolean;
  /** False: the caller has put the camera where the view opens (else on the current player). */
  aim?: boolean;
  /** Longest wait, after which the board is shown with whatever arrived (a broken file must not keep it covered). */
  maxMs?: number;
}

/** Waits for the board's first view to be complete. Never rejects. */
export async function preloadBoard(view: BoardView, o: PreloadOptions = {}): Promise<void> {
  const tier = memTier(), alive = o.alive ?? (() => true), t0 = performance.now(), maxMs = o.maxMs ?? 30000;
  const late = () => !alive() || performance.now() - t0 > maxMs;
  if (o.aim !== false) view.aimAtStart();
  // Weights of the parts in the bar.
  const W = { sprites: 0.5, pictures: 0.05, ground: 0.35, clips: 0.1 };
  const got = { sprites: 0, pictures: 0, ground: 0, clips: 0 };
  let what = '載入建築與角色…';
  const report = () => o.onProgress?.(Object.entries(W).reduce((s, [k, w]) => s + w * got[k as keyof typeof got], 0), what);

  // Sprites: the figures, the dice and every map sprite of the first view, then the map's others nearest first
  // as far as the tier looks ahead and within 3/4 of its sprite budget (the rest are decoded when seen).
  const all = view.boardSprites().sort((p, q) => p.d - q.d);
  const list: typeof all = [];
  let bytes = 0;
  for (const e of all) {
    if (e.a !== 'map' || e.d === 0) { list.push(e); if (e.a === 'map') bytes += view.bank.estimate(e.a, e.res, e.mul); continue; }
    const more = view.bank.estimate(e.a, e.res, e.mul);
    if (e.d > tier.spriteAhead || bytes + more > tier.spriteBytes * 0.75) continue;
    list.push(e); bytes += more;
  }
  let done = 0;
  const sprites = Promise.all(list.map(e => view.bank.boardReady(e.a, e.res, e.mul).catch(() => null).then(() => {
    done++; got.sprites = done / list.length; report();
  })));

  // The panels' pictures (portraits, toolbar art): loaded and decoded.
  const imgs = [...(o.root?.querySelectorAll('img') ?? [])];
  let seen = 0;
  const pictures = Promise.all(imgs.map(i => (i.complete ? Promise.resolve() : new Promise<void>(r => { i.addEventListener('load', () => r(), { once: true }); i.addEventListener('error', () => r(), { once: true }); }))
    .then(() => (i.naturalWidth ? i.decode().catch(() => undefined) : undefined))
    .then(() => { seen++; got.pictures = seen / imgs.length; report(); })));
  if (!imgs.length) got.pictures = 1;

  // The first clip(s), within the tier's clip count (one is always left for what plays next).
  const clipIds = (o.clips ?? []).slice(0, Math.max(0, tier.clipCount - 1));
  const clips = clipIds.length ? preloadClips(view.bank, clipIds).then(() => { got.clips = 1; report(); }) : Promise.resolve().then(() => { got.clips = 1; });

  report();
  await Promise.race([Promise.all([sprites, pictures, clips]), (async () => { while (!late()) await later(100); })()]);
  if (!alive()) return;

  // The ground: the board's upkeep asks for the tiles of the view and the cache's ring every frame; a margin is
  // asked for on top (the whole ground when every tile fits the budget).
  what = '載入地面…';
  const t = view.groundTiles;
  if (!t) {
    // The original ground: one picture, decoded now rather than on the board's first frame.
    await view.art.ground.decode().catch(() => undefined);
  } else {
    // A frame or two for the first `update`, which sets the tiles' density (none when the preview is enough).
    for (let i = 0; i < 3 && !t.room; i++) await frame();
    if (t.room) {
      if (tier.prefetch && t.count <= t.room) t.prefetch(view.mapQuad(), true);
      else if (tier.preloadRing) t.prefetch(view.preloadQuad(tier.preloadRing), true);
    }
    for (;;) {
      const p = t.progress();
      got.ground = p.total ? p.done / p.total : 1;
      report();
      if (p.done >= p.total || late()) break;
      await frame();
    }
  }
  got.ground = 1;
  report();
  if (!alive()) return;
  // The cached ground redrawn with every tile in, before the screen goes.
  view.refreshGround();
  await frame();
  await frame();
}
