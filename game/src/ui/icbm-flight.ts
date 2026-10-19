/**
 * 洲際飛彈's full-screen flight (大富豪模式, the user 2026-10-19): the launch from the player's city, the missile across
 * a turning globe, the dive onto the target city's map while it zooms in on the spot, then the game's own nuclear
 * blast clip (Data#530) there and a white flash. A tap skips. Drawn with CSS and one canvas: no new pictures.
 */
import { ASSETS } from './assets';
import { audio, Sfx } from './audio';
import { groundStyle, groundStylesFor } from './ground';
import type { ScreenContext } from './screens/registry';
import './icbm-flight.css';

const KEYS: Record<number, string> = { 100: 'tokyo', 101: 'osaka', 102: 'sapporo', 103: 'kyushu', 104: 'okinawa' };
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** The globe's surface: ocean and a few continents, drawn once (two turns wide, so it scrolls seamlessly). */
function globeTexture(): string {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 512;
  const g = c.getContext('2d')!;
  const sea = g.createLinearGradient(0, 0, 0, 512);
  sea.addColorStop(0, '#1d5fb8'); sea.addColorStop(0.5, '#2a86d8'); sea.addColorStop(1, '#1a4f9e');
  g.fillStyle = sea; g.fillRect(0, 0, 1024, 512);
  let seed = 7;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const land = (cx: number, cy: number, s: number) => {
    for (const dx of [0, 512]) {
      g.fillStyle = '#4fae4a';
      for (let k = 0; k < 14; k++) { g.beginPath(); g.ellipse(cx + dx + (r() - 0.5) * s * 1.6, cy + (r() - 0.5) * s, s * (0.35 + r() * 0.4), s * (0.25 + r() * 0.3), r() * 3, 0, Math.PI * 2); g.fill(); }
      g.fillStyle = '#c9b46a';
      for (let k = 0; k < 4; k++) { g.beginPath(); g.ellipse(cx + dx + (r() - 0.5) * s, cy + (r() - 0.5) * s * 0.6, s * 0.2, s * 0.12, r() * 3, 0, Math.PI * 2); g.fill(); }
    }
  };
  land(90, 170, 70); land(150, 330, 60); land(270, 150, 80); land(300, 300, 55); land(410, 200, 75); land(470, 360, 40);
  g.fillStyle = 'rgba(255,255,255,.85)'; g.fillRect(0, 0, 1024, 26); g.fillRect(0, 486, 1024, 26);
  return c.toDataURL('image/png');
}

/** Resolves when the flight and the blast have played (or were tapped through). */
export async function icbmFlight(ctx: ScreenContext, d: { from?: string; city?: string; target?: string; mapId?: number; x?: number; y?: number; size?: number }): Promise<void> {
  const rocket = ctx.bank.art('Data', 615, 0);
  const key = KEYS[d.mapId ?? 0];
  const size = d.size ?? 2304, fx = (d.x ?? size / 2) / size, fy = (d.y ?? size / 2) / size;
  // The target city's map in the ground style being played (its 1× preview), else the plain map; set while the
  // missile flies.
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
  // The nuclear blast clip's frames, fetched ahead.
  const blast: string[] = [];
  for (let f = 0; f < 26; f++) { const a = ctx.bank.art('Data', 530, f); if (a) { blast.push(a.src); new Image().src = a.src; } }

  const root = document.createElement('div');
  root.className = 'icf';
  root.innerHTML = `
    <div class="icf-sky"></div>
    <div class="icf-stage icf-launch"><div class="icf-ground"></div><div class="icf-pad"></div>
      <div class="icf-rocket up">${rocket ? `<img src="${rocket.src}" alt="">` : ''}<i class="icf-flame"></i></div>
      <div class="icf-smoke"></div><div class="icf-label">${esc(d.from ?? '')}　發射！</div></div>
    <div class="icf-stage icf-globe"><div class="icf-ball" style="--tex:url('${globeTexture()}')"></div>
      <svg class="icf-arc" viewBox="0 0 400 400"><path d="M70 300 Q200 20 330 230" /></svg>
      <div class="icf-dot from"></div><div class="icf-dot to"></div>
      <div class="icf-rocket fly">${rocket ? `<img src="${rocket.src}" alt="">` : ''}<i class="icf-flame"></i></div>
      <div class="icf-label">${esc(d.from ?? '')} → ${esc(d.city ?? '')}</div></div>
    <div class="icf-stage icf-dive"><div class="icf-map" style="--fx:${fx};--fy:${fy}"><img alt=""></div>
      <div class="icf-aim"></div>
      <div class="icf-rocket down">${rocket ? `<img src="${rocket.src}" alt="">` : ''}<i class="icf-flame"></i></div>
      <div class="icf-boom">${blast.length ? `<img src="${blast[0]}" alt="">` : ''}</div><div class="icf-flash"></div>
      <div class="icf-label">${esc(d.city ?? '')}・${esc(d.target ?? '')}</div></div>
    <div class="icf-skip">點一下跳過</div>`;
  ctx.open(root, true);
  void mapSrc.then(src => { const im = root.querySelector<HTMLImageElement>('.icf-map img'); if (im && src) { im.decoding = 'async'; im.src = src; } });
  const wait = (ms: number) => new Promise<void>(res => setTimeout(res, ms * Math.max(0.6, ctx.scale())));
  let skipped = false;
  const skip = new Promise<void>(res => root.addEventListener('pointerup', () => { skipped = true; res(); }, { once: true }));
  const phase = (name: string) => { root.dataset.phase = name; };
  const play = (async () => {
    phase('launch'); audio.sfx(Sfx.missile);
    await wait(1700); if (skipped) return;
    phase('globe');
    await wait(1900); if (skipped) return;
    phase('dive');
    await wait(1700); if (skipped) return;
    phase('boom'); audio.sfx(Sfx.nuke);
    const img = root.querySelector<HTMLImageElement>('.icf-boom img');
    for (let f = 0; f < blast.length && !skipped; f++) { if (img) img.src = blast[f]; await new Promise(res => setTimeout(res, 70)); }
    await wait(500);
  })();
  await Promise.race([play, skip]);
  ctx.close();
}
