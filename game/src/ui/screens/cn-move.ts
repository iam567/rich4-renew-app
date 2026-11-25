/**
 * 開元盛世's 小事件 (core/changan.ts MOVES, the user 2026-11-23): a small card, not the news / fate boards (「30種事件用
 * 小卡片，不要和事件那樣的大卡片」) — it turns over in the middle of the map: the event's picture (maps/remake/changan/moves/
 * <id>.webp), its name in brush, what happens with the steps drawn; a tap or a moment and the move plays on the board.
 * Over the map, the board dimmed behind it; the card stays a card's size on a phone held either way.
 * 清明上河's (core/qingming-moves.ts, data.set 'qingming'): its pictures maps/remake/qingming/moves/<id>.webp, the card in
 * that map's painted look (its red tag, the 文楷 brush).
 */
import { fxScreens } from './registry';
import { fitOverlay } from './bank';
import { audio } from '../audio';
import { ASSETS, cssUrl } from '../assets';
import { CHARACTERS } from '../../core/characters';
import { QM_ART } from './qm-ui';
import './cn-ui.css';
import './cn-move.css';

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

interface MoveFx { id: string; head: string; text: string; n: number; t: string; human: boolean; set?: string }

fxScreens['cn-move'] = async (ctx, fx) => {
  const d = fx.data as unknown as MoveFx;
  const ov = fitOverlay(ctx.area, 'cnm-ov', tall => (tall ? [600, 900] : [900, 600]), undefined, 0);
  ov.scene.classList.add('cn-scene', 'cnm-scene');
  const qm = d.set === 'qingming';
  if (qm) { ov.scene.classList.add('cnm-qm'); ov.scene.style.setProperty('--qm-tag', cssUrl(`${QM_ART}/ui/tag.webp`)); }
  const dir = qm ? `${ASSETS}/maps/remake/qingming/moves` : `${ASSETS}/maps/remake/changan/moves`;
  const p = ctx.game.players[fx.p ?? 0], ch = p ? CHARACTERS[p.character] : undefined, face = ch ? ctx.bank.art('Data', 2, ch.id) : null;
  const id = /^[a-z0-9-]+$/.test(d.id) ? d.id : '';
  const [line, ...rest] = String(d.text ?? '').split('\n');
  ov.scene.innerHTML = `
    <div class="cnm-card">
      <div class="cnm-tag">小事件</div>
      <div class="cnm-pic" style="background-image:url(${dir}/${id}.webp)"></div>
      <div class="cnm-head">${face ? `<img src="${face.src}" alt="">` : ''}<b>${esc(d.head ?? '')}</b></div>
      <div class="cnm-text">${esc(line ?? '')}${rest.length ? `<br><em>${esc(rest.join(' '))}</em>` : ''}</div>
    </div>`;
  const card = ov.scene.querySelector<HTMLElement>('.cnm-card')!;
  card.animate([{ transform: 'perspective(900px) rotateY(90deg) scale(.6)', opacity: 0 }, { transform: 'perspective(900px) rotateY(-8deg) scale(1.04)', opacity: 1, offset: 0.7 },
    { transform: 'perspective(900px) rotateY(0) scale(1)', opacity: 1 }], { duration: 520, easing: 'ease-out' });
  audio.ui('yes');
  const human = !!d.human;
  await new Promise<void>(res => {
    const t = window.setTimeout(res, (human ? 3200 : 2000) * Math.max(0.6, ctx.scale()));
    ov.root.addEventListener('pointerup', () => { clearTimeout(t); res(); }, { once: true });
  });
  await card.animate([{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(.7) translateY(40px)', opacity: 0 }], { duration: 220, fill: 'forwards' }).finished.catch(() => {});
  ov.close();
};
