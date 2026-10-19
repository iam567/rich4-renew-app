/**
 * 洲際飛彈's full-screen flight (大富豪模式, the user 2026-10-19: "an epic"): four painted film shots
 * (maps/remake/icbm/shot-1..4, tools/tycoon-art/icbm_art.py) cut together with camera moves, shakes, sparks and light,
 * in a letterbox — the night launch from the player's city, the missile over Japan seen from orbit, the burning re-entry,
 * the dive onto the board — then the target city's own map zooming in on the spot and the game's nuclear blast clip
 * (Data#530) there, with a white flash. A tap skips.
 */
import { ASSETS } from './assets';
import { audio, Sfx } from './audio';
import { groundStyle, groundStylesFor } from './ground';
import type { ScreenContext } from './screens/registry';
import './icbm-flight.css';

const KEYS: Record<number, string> = { 100: 'tokyo', 101: 'osaka', 102: 'sapporo', 103: 'kyushu', 104: 'okinawa' };
const SHOT = (n: number) => `${ASSETS}/maps/remake/icbm/shot-${n}.webp`;

/** Resolves when the flight and the blast have played (or were tapped through). */
export async function icbmFlight(ctx: ScreenContext, d: { from?: string; city?: string; target?: string; mapId?: number; x?: number; y?: number; size?: number }): Promise<void> {
  const key = KEYS[d.mapId ?? 0];
  const size = d.size ?? 2304, fx = (d.x ?? size / 2) / size, fy = (d.y ?? size / 2) / size;
  for (let n = 1; n <= 4; n++) new Image().src = SHOT(n);
  // The target city's map in the ground style being played (its 1× preview), else the plain map.
  const mapSrc = (async () => {
    const style = groundStyle(), mapId = d.mapId ?? 0;
    if (style && (await groundStylesFor(mapId)).includes(style)) {
      try {
        const r = await fetch(`${ASSETS}/ground/${mapId}/${style}/manifest.json`);
        if (r.ok) { const m = await r.json() as { preview?: string }; if (m.preview) return `${ASSETS}/ground/${mapId}/${style}/${m.preview}`; }
      } catch { /* the plain map */ }
    }
    return key ? `${ASSETS}/maps/remake/${key}.png` : '';
  })();
  const blast: string[] = [];
  for (let f = 0; f < 26; f++) { const a = ctx.bank.art('Data', 530, f); if (a) { blast.push(a.src); new Image().src = a.src; } }
  const sparks = Array.from({ length: 28 }, (_, k) => `<i style="--x:${(k * 37) % 100};--d:${(k * 0.13) % 1.4}s;--s:${0.5 + (k % 5) * 0.25}"></i>`).join('');

  const root = document.createElement('div');
  root.className = 'icf';
  root.innerHTML = `
    <div class="icf-shot s1"><img src="${SHOT(1)}" alt=""><div class="icf-sparks">${sparks}</div><div class="icf-glow fire"></div></div>
    <div class="icf-shot s2"><img src="${SHOT(2)}" alt=""><div class="icf-glow sun"></div></div>
    <div class="icf-shot s3"><img src="${SHOT(3)}" alt=""><div class="icf-sparks hot">${sparks}</div><div class="icf-heat"></div></div>
    <div class="icf-shot s4"><img src="${SHOT(4)}" alt=""><div class="icf-speed"></div></div>
    <div class="icf-shot s5"><div class="icf-map" style="--fx:${fx};--fy:${fy}"><img alt=""></div><div class="icf-aim"></div>
      <div class="icf-boom">${blast.length ? `<img src="${blast[0]}" alt="">` : ''}</div></div>
    <div class="icf-flash"></div>
    <div class="icf-bars"><i></i><i></i></div>
    <div class="icf-title"><b></b><small></small></div>
    <div class="icf-skip">點一下跳過</div>`;
  ctx.open(root, true);
  void mapSrc.then(src => { const im = root.querySelector<HTMLImageElement>('.icf-map img'); if (im && src) { im.decoding = 'async'; im.src = src; } });
  const title = (big: string, small = '') => {
    const t = root.querySelector<HTMLElement>('.icf-title')!;
    t.querySelector('b')!.textContent = big; t.querySelector('small')!.textContent = small;
    t.classList.remove('in'); void t.offsetWidth; t.classList.add('in');
  };
  const wait = (ms: number) => new Promise<void>(res => setTimeout(res, ms * Math.max(0.7, ctx.scale())));
  let skipped = false;
  const skip = new Promise<void>(res => root.addEventListener('pointerup', () => { skipped = true; res(); }, { once: true }));
  const shot = (name: string) => { root.dataset.shot = name; };
  const play = (async () => {
    shot('s1'); title(`${d.from ?? ''}`, '洲際飛彈　發射'); audio.sfx(Sfx.missile);
    await wait(2100); if (skipped) return;
    shot('s2'); title(`${d.from ?? ''} → ${d.city ?? ''}`, '大氣層外　飛行中');
    await wait(2000); if (skipped) return;
    shot('s3'); title('重返大氣層', ''); audio.sfx(Sfx.missile);
    await wait(1500); if (skipped) return;
    shot('s4'); title(`${d.city ?? ''}`, '目標鎖定');
    await wait(1100); if (skipped) return;
    shot('s5'); title(`${d.city ?? ''}・${d.target ?? ''}`, '');
    await wait(1300); if (skipped) return;
    root.dataset.boom = '1'; audio.sfx(Sfx.nuke);
    const img = root.querySelector<HTMLImageElement>('.icf-boom img');
    for (let f = 0; f < blast.length && !skipped; f++) { if (img) img.src = blast[f]; await new Promise(res => setTimeout(res, 75)); }
    await wait(600);
  })();
  await Promise.race([play, skip]);
  ctx.close();
}
