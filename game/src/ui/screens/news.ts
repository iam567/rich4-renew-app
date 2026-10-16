/**
 * News and fate boards (docs/rules/09 §6.6): Panel#66 frame 0 (NEWS, cyan) / 1 (fate, magenta) covering the
 * map view, the picture in the white frame at (25,44), the news title by category at (24,8) and the text
 * below (news from y 310, fate from y 330). The original keeps news 2.4 s and fate 1.6 s + 0.8 s, a click skips;
 * here a board stays at least 3 s at any game speed (and while its line is spoken) so it can be read, and a
 * double tap closes it (a single tap does nothing, so it is not dismissed by accident). Laid out on the
 * original 440×480 canvas and scaled to fit the map view.
 */
import { CHARACTERS } from '../../core/characters';
import { fitOverlay } from './bank';
import { fxScreens, type ScreenContext } from './registry';
import type { GameEvent } from '../../core/types';
import type { BoardFace } from '../../core/modules/events';
import { audio, boardVoice } from '../audio';
import './news.css';
import { regionalPicture } from './regional';

type Fx = Extract<GameEvent, { t: 'fx' }>;

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
/** Body text: line breaks kept, amounts / percentages / days in gold. */
const body = (s: string) => esc(s).replace(/(\d[\d,.]*\s*(?:元|％|%|天|倍|張|股)?)/g, '<em>$1</em>').replace(/\n+/g, '<br>');

/** News picture: Data#(441 + news number) (news.asm). */
export const newsPicture = (id: number) => 441 + id;

/**
 * Fate picture table 0x475fb4 (fortune.asm:2578-2602, rich4.asm:41325): entries 0..32 directly; the prison
 * entries 33..36 by game map (index t + 4·map).
 */
const FATE_PICS = [
  477, 478, 479, 480, 481, 482, 483, 484, 485, 486, 487, 488, 489, 490, 491, 492, 493,
  494, 495, 496, 497, 497, 497, 498, 498, 499, 500, 501, 501, 501, 502, 503, 504,
  505, 506, 507, 508, 505, 509, 510, 511, 512, 506, 507, 513, 514, 515, 510, 516,
];
export const fatePicture = (t: number, map: number) => FATE_PICS[t < 33 ? t : t + 4 * (map & 3)] ?? 0;

/** A board stays this long at least, whatever the game speed; two taps this close together close it. */
const MIN_SHOW_MS = 3000, DOUBLE_TAP_MS = 400;

function show(ctx: ScreenContext, fx: Fx, kind: 'news' | 'fate'): Promise<void> {
  const id = Number(fx.data?.id ?? -1);
  const text = typeof fx.data?.text === 'string' ? fx.data.text : '';
  const bg = ctx.bank.art('Panel', 66, kind === 'news' ? 0 : 1);
  const picId = id < 0 ? 0 : kind === 'news' ? newsPicture(id) : fatePicture(id, ctx.game.mapSlot);
  // 大富豪模式 local events (docs/rules/18) bring their own picture and the city's name.
  const local = regionalPicture(fx.data);
  const pic = local ? { src: local.src } : picId ? ctx.bank.art('Data', picId) : null;
  const p = fx.p !== undefined ? ctx.game.players[fx.p] : undefined;
  const ch = p ? CHARACTERS[p.character] : undefined;
  const face = ch ? ctx.bank.art('Data', 2, ch.id) : null;
  const title = kind === 'news' ? String(fx.data?.category ?? '新聞快報') : '命運';
  // The players a news entry concerns, with their faces (and sums) down the right side as the original draws
  // them (news.asm fcn_004562a5 at x 390 from y 328).
  const faces = (Array.isArray(fx.data?.faces) ? fx.data.faces as BoardFace[] : []).filter(f => ctx.game.players[f.p]);
  const facesHtml = faces.map((f, i) => {
    const c = CHARACTERS[ctx.game.players[f.p].character], img = ctx.bank.art('Data', 2, c.id);
    const amt = typeof f.amount === 'number' && f.amount ? `<em class="${f.amount < 0 ? 'minus' : ''}">${f.amount > 0 ? '+' : '−'}${Math.abs(f.amount).toLocaleString('zh-Hant')}</em>` : '';
    return `<div class="nw-face" style="--c:#${c.color.toString(16).padStart(6, '0')};animation-delay:${0.7 + i * 0.12}s"><span>${img ? `<img src="${img.src}" alt="">` : ''}</span><b>${esc(c.name)}</b>${amt}</div>`;
  }).join('');
  const ov = fitOverlay(ctx.area, `nw-ov ${kind}`, () => [440, 480], undefined, 22);
  const { scene, root } = ov;
  scene.classList.add('nw-scene', kind);
  scene.innerHTML = `<div class="nw-board">
      ${bg ? `<img class="nw-bg" src="${bg.src}" alt="">` : ''}
      <div class="nw-title">${esc(title)}</div>
      ${kind === 'news' ? '<div class="nw-live"><i></i>NEWS</div>' : ''}
      ${ch ? `<div class="nw-who" style="--c:#${ch.color.toString(16).padStart(6, '0')}"><span>${face ? `<img src="${face.src}" alt="">` : ''}</span>${esc(ch.name)}</div>` : ''}
      <div class="nw-pic">${pic ? `<img src="${pic.src}" alt="">` : ''}${local?.city ? `<span class="nw-city">${esc(local.city)}</span>` : ''}</div>
      <div class="nw-text${faces.length ? ' with-faces' : ''}"><div>${body(text)}</div></div>
      ${faces.length ? `<div class="nw-faces${faces.length > 4 ? ' many' : ''}">${facesHtml}</div>` : ''}
      <div class="nw-tap">雙擊關閉</div>
    </div>`;
  // Long texts shrink to stay inside the board.
  const box = scene.querySelector<HTMLElement>('.nw-text')!, inner = box.firstElementChild as HTMLElement;
  for (let size = 27; size > 16 && inner.scrollHeight > box.clientHeight; size -= 1) inner.style.fontSize = `${size}px`;
  // The board's text is voiced ('#0149'…: news 149 + n, fate 185 + t); it stays while the line is spoken and
  // at least 3 s; a double tap ends both.
  const spoken = audio.voice(boardVoice(kind, id, ctx.game.mapSlot));
  return new Promise(resolve => {
    let done = false, timeUp = false, said = false;
    const end = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      audio.stopVoice();
      root.classList.add('out');
      setTimeout(() => { ov.close(); resolve(); }, 180);
    };
    const timer = setTimeout(() => { timeUp = true; if (said) end(); }, MIN_SHOW_MS);
    void spoken.then(() => { said = true; if (timeUp) end(); });
    let lastTap = 0;
    const tap = (e: PointerEvent) => {
      if (e.timeStamp - lastTap < DOUBLE_TAP_MS) end();
      lastTap = e.timeStamp;
    };
    setTimeout(() => { if (!done) root.addEventListener('pointerup', tap); }, 200);
  });
}

fxScreens['news'] = (ctx, fx) => show(ctx, fx, 'news');
fxScreens['fate'] = (ctx, fx) => show(ctx, fx, 'fate');
