/**
 * 長安's 發配所 (core/changan.ts exile): the player marched out of the city — the road south under escort (the event
 * picture exile-road), the player's face, 「押往發配所」 on a drawn frame; then the board shows them there.
 */
import { fxScreens } from './registry';
import { fitOverlay } from './bank';
import { audio } from '../audio';
import { CHARACTERS } from '../../core/characters';
import { regionalPictureUrl } from './regional';
import './cn-ui.css';

fxScreens['cn-exile'] = async (ctx, fx) => {
  const ov = fitOverlay(ctx.shell, 'cnx-ov', tall => (tall ? [900, 1600] : [1600, 900]), undefined, 0);
  ov.scene.classList.add('cn-scene');
  const p = ctx.game.players[fx.p ?? 0], ch = p ? CHARACTERS[p.character] : undefined, face = ch ? ctx.bank.art('Data', 2, ch.id) : null;
  Object.assign(ov.root.style, { position: 'absolute', inset: '0', zIndex: '60', background: '#120c08' });
  Object.assign(ov.scene.style, { position: 'absolute', left: '50%', top: '50%', overflow: 'hidden', fontFamily: "'Huninn', 'PingFang TC', sans-serif" });
  ov.scene.innerHTML = `
    <div style="position:absolute;inset:0;background:url(${regionalPictureUrl('exile-road')}) center/cover;filter:sepia(.25) brightness(.85)"></div>
    <div class="cn-frame" style="left:50%;bottom:8%;width:620px;height:110px;margin-left:-310px">
      <div class="cn-lbl" style="font-size:44px;letter-spacing:8px;gap:16px">${face ? `<img src="${face.src}" alt="" style="position:static;width:64px;height:64px;border-radius:10px;border:2px solid #ffe08a">` : ''}押往發配所</div></div>`;
  const frame = ov.scene.querySelector<HTMLElement>('.cn-frame')!;
  frame.animate([{ transform: 'scale(.3)', opacity: 0 }, { transform: 'scale(1.08)', opacity: 1, offset: 0.7 }, { transform: 'scale(1)', opacity: 1 }], { duration: 500 });
  ov.scene.firstElementChild!.animate([{ transform: 'scale(1.15)' }, { transform: 'scale(1)' }], { duration: 2600, fill: 'forwards' });
  audio.ui('no');
  await new Promise(r => setTimeout(r, Math.max(1800, 2600 * ctx.scale())));
  ov.close();
};
