/**
 * 在路上 (docs/rules/17 §3.3): a short scene of the trip — the plane over the clouds or the 新幹線 past the
 * countryside — with the traveller's face in the window and 「孫小美 搭飛機前往 大阪中…」. The human's skipped turn
 * plays it (about two seconds), a departure in the city on screen a shorter one. Built from clean layers
 * (tools/tycoon-art/onway.py: the vehicle cut out, a seamless scenery strip) and animated here: the strip scrolls,
 * the vehicle bobs, speed lines for the train. Travellers elsewhere only get a ticker line.
 */
import { CHARACTERS } from '../core/characters';
import { ASSETS } from './assets';
import { audio, Sfx } from './audio';
import { fxScreens, type ScreenContext } from './screens/registry';
import { shrinkText } from './text';
import './tycoon-onway.css';

interface Layers { plane: Vehicle; train: Vehicle; sky: { width: number; height: number }; land: { width: number; height: number } }
interface Vehicle { width: number; height: number; window: { x: number; y: number; w: number; h: number } }
let layers: Promise<Layers | null> | null = null;
const loadLayers = () => (layers ??= fetch(`${ASSETS}/maps/remake/onway/layers.json`).then(r => (r.ok ? r.json() as Promise<Layers> : null)).catch(() => null));
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** The scene for `ms` (scaled by the game speed), closed earlier by a tap. */
export async function onwayScene(ctx: ScreenContext, p: number, via: 'station' | 'airport', city: string, ms: number, caption?: string): Promise<void> {
  const L = await loadLayers();
  const plane = via === 'airport', v = L ? (plane ? L.plane : L.train) : null;
  const ch = CHARACTERS[ctx.game.players[p]?.character ?? 0];
  const face = ctx.bank.art('Data', 2, ch.id);
  const text = caption ?? `${ch.name} 搭${plane ? '飛機' : '新幹線'}前往 ${city}中…`;
  const box = document.createElement('div');
  box.className = `ow ${plane ? 'air' : 'rail'}`;
  const strip = plane ? L?.sky : L?.land;
  // Vehicle box in % of the scene: the plane in the middle of the sky, the train on the track of the strip.
  const vw = plane ? 58 : 96, aspect = v ? v.height / v.width : 0.4;
  box.innerHTML = `<div class="ow-scene" style="--bg:url('${ASSETS}/maps/remake/onway/${plane ? 'sky' : 'land'}.webp');--ratio:${strip ? strip.width / strip.height : 2.6}">
      <div class="ow-bg"></div>${plane ? '' : '<div class="ow-speed"></div>'}
      <div class="ow-veh" style="--vw:${vw}%;--asp:${aspect}">
        <img class="ow-img" src="${ASSETS}/maps/remake/onway/${plane ? 'plane' : 'train'}.webp" alt="">
        ${v && face ? `<span class="ow-win" style="left:${v.window.x * 100}%;top:${v.window.y * 100}%;width:${v.window.w * 100}%;height:${v.window.h * 100}%"><img src="${face.src}" alt=""></span>` : ''}
      </div>
    </div>
    <div class="ow-cap"><span class="ow-tag">在路上</span>${esc(text)}</div>`;
  audio.sfx(plane ? Sfx.airplane : Sfx.special);
  ctx.open(box);
  shrinkText(box, '.ow-cap', 9);
  await new Promise<void>(resolve => {
    const t = setTimeout(resolve, ms * Math.max(0.7, ctx.scale()));
    box.addEventListener('click', () => { clearTimeout(t); resolve(); });
  });
  ctx.close();
}

fxScreens['travel-onway'] = async (ctx, s) => {
  const d = (s.data ?? {}) as { via?: 'station' | 'airport'; city?: string };
  await onwayScene(ctx, s.p ?? 0, d.via ?? 'airport', d.city ?? '', 2200);
};
fxScreens['travel-depart'] = async (ctx, s) => {
  const d = (s.data ?? {}) as { via?: 'station' | 'airport'; city?: string; text?: string };
  await onwayScene(ctx, s.p ?? 0, d.via ?? 'airport', d.city ?? '', 1300, d.text);
};
