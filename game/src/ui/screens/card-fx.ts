/**
 * Card-use announcement (docs/rules/09 §7.2 item 5): the original shows the message box with "使用%s" and the
 * card picture Data#(570 + card) (165×256) for 1500 ms. Here the card flips in over the map with a burst of
 * rays, next to a message box with who used it and what it does; a tap skips it.
 * Receiving a card (the card square, gifts) uses the same scene with 「得到%s！」: the original shows only that
 * message box, the remake shows the card as well.
 */
import { CHARACTERS } from '../../core/characters';
import { cardDef, cardName } from '../../core/modules/cards';
import { toolDef, toolIcon } from '../../core/modules/tools';
import { TOOL_TEXT } from './shop';
import { fitOverlay } from './bank';
import { fxScreens, type ScreenContext } from './registry';
import { audio, Sfx } from '../audio';
import './card-fx.css';

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Data#584 (停留卡) was extracted with noise in its lower half (09 §7.1); without the redraw show only the clean top. */
const BROKEN_ART = new Set([14]);

fxScreens['card'] = (ctx, fx) => cardScene(ctx, Number(fx.data?.card), fx.p, 'use');

/** The card flipping in: used (「使用%s」, with its sound), received (「得到%s！」) or the shop owner's gift. */
export function cardScene(ctx: ScreenContext, id: number, who: number | undefined, mode: 'use' | 'get' | 'chairman'): Promise<void> {
  if (!id || !cardDef(id)) return Promise.resolve();
  const pic = ctx.bank.art('Data', 570 + id), name = cardName(id);
  return reveal(ctx, who, {
    front: `${pic ? `<img src="${pic.src}" alt="">` : ''}<span class="cfx-plate">${esc(name)}</span>`, broken: BROKEN_ART.has(id) && !pic?.hd,
    line: mode === 'use' ? `使用<b>${esc(name)}</b>` : mode === 'get' ? `得到<b>${esc(name)}！</b>` : `歡迎董事長光臨<br>送您<b>${esc(name)}！</b>`,
    text: (cardDef(id)?.text ?? ""), sound: mode === 'use',
  });
}

/** A tool flipping in on a glowing card: a gift box, the shop owner's gift (「歡迎董事長光臨　送您%s！」). */
export function toolScene(ctx: ScreenContext, id: number, who: number | undefined, mode: 'get' | 'chairman'): Promise<void> {
  const t = toolDef(id), ic = toolIcon(id);
  if (!t) return Promise.resolve();
  const pic = ctx.bank.art(ic.archive, ic.id, ic.frame);
  return reveal(ctx, who, {
    front: `<div class="cfx-tool">${pic ? `<img src="${pic.src}" alt="">` : ''}</div><span class="cfx-tool-name">${esc(t.name)}</span>`, tool: true,
    line: mode === 'get' ? `得到<b>${esc(t.name)}！</b>` : `歡迎董事長光臨<br>送您<b>${esc(t.name)}！</b>`,
    text: TOOL_TEXT[id] ?? '', sound: false,
  });
}

function reveal(ctx: ScreenContext, who: number | undefined, o: { front: string; line: string; text: string; sound: boolean; broken?: boolean; tool?: boolean }): Promise<void> {
  const p = who !== undefined ? ctx.game.players[who] : undefined;
  const ch = p ? CHARACTERS[p.character] : undefined;
  const face = ch ? ctx.bank.art('Data', 2, ch.id) : null;
  const ov = fitOverlay(ctx.area, 'cfx-ov', tall => (tall ? [340, 540] : [580, 330]));
  const { scene, root } = ov;
  scene.classList.add('cfx-scene');
  scene.innerHTML = `<div class="cfx-rays"></div>
    <div class="cfx-card${o.broken ? ' broken' : ''}${o.tool ? ' tool' : ''}"><div class="cfx-flip">
      <div class="cfx-back"></div>
      <div class="cfx-front">${o.front}</div>
    </div>${'<i class="cfx-star"></i>'.repeat(6)}</div>
    <div class="cfx-msg">
      ${ch ? `<div class="cfx-who" style="--c:#${ch.color.toString(16).padStart(6, '0')}"><span class="cfx-face">${face ? `<img src="${face.src}" alt="">` : ''}</span>${esc(ch.name)}</div>` : ''}
      <div class="cfx-use">${o.line}</div>
      ${o.text ? `<div class="cfx-text">${esc(o.text)}</div>` : ''}
    </div>
    <div class="cfx-tap">點一下繼續</div>`;
  // fcn_00441f73: the announcement's sound (slot 23, Effect#62), then 1500 ms.
  if (o.sound) audio.sfx(Sfx.cardUse);
  return new Promise(resolve => {
    let done = false;
    const end = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      root.classList.add('out');
      setTimeout(() => { ov.close(); resolve(); }, 180);
    };
    // Using a card: 1500 ms in the original plus the flip, × game speed, never under 1.6 s. A received card or
    // tool stays 2 s after its 0.6 s flip at every speed; a tap closes either sooner.
    const timer = setTimeout(end, o.sound ? Math.max(1600, (1500 + 450) * ctx.scale()) : 600 + 2000);
    setTimeout(() => { if (!done) root.addEventListener('pointerup', end); }, 150);
  });
}
