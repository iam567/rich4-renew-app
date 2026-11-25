/**
 * 清明上河's 梁山令 (core/qingming-ling.ts applyLing, docs/rules/35 §梁山令): fx 'qm-ling' { seat, grade, human, text }.
 * The card flies off the deck and turns over in the middle of the screen, a glow of its grade's colour behind it
 * (普通 white, 高級 blue, 稀有 purple, 傳說 gold — 傳說 with sparks), then what it does on the paper scroll under it.
 * A tap closes it (or a few seconds; a computer's draw shows shorter). The card pictures are the painted ones
 * (maps/remake/qingming/ling/NNN-hant / NNN-hans.webp: the 简体 one when the game shows 简体, lang.ts).
 * What the 令 does is written on the card by the game (lingFace), over the words painted into the picture when it was
 * made: those are the first version's and no longer true (the user 2026-11-25: 「卡上寫的3隻惡犬，實際效果還是15隻」).
 * Landscape 1600 × 900, upright 900 × 1600.
 */
import { fxScreens, onStuck } from './registry';
import { fitOverlay } from './bank';
import { audio } from '../audio';
import { lang } from '../lang';
import { cnSound } from '../cn-sound';
import { QM_THEME } from '../jq-music';
import { screenMusic } from '../screen-music';
import { LING, gradeOf, lingText, type LingGrade } from '../../core/qingming-ling';
import { QM_ART, qmEsc, qmHold, qmStage, qmWait } from './qm-ui';
import './qm-ling.css';

const GRADE: Record<LingGrade, string> = { legend: '傳說', rare: '稀有', high: '高級', common: '普通' };
export const lingSrc = (seat: number) => `${QM_ART}/ling/${String(seat).padStart(3, '0')}-${lang() === 'hans' ? 'hans' : 'hant'}.webp`;

let shown: ReturnType<typeof fitOverlay> | null = null;
/** Its own piece while it shows (清明上河's set, jq-music.ts QM_THEME). */
const music = screenMusic();
function shut() { shown?.close(); shown = null; music(false, QM_THEME.ling); }
onStuck(shut);

/** Shrinks the words of `box` until they fit it. */
export function fitText(box: HTMLElement, min = 18) {
  box.style.fontSize = '';
  let f = parseFloat(getComputedStyle(box).fontSize) || 36;
  for (let i = 0; i < 30 && f > min && (box.scrollHeight > box.clientHeight + 1 || box.scrollWidth > box.clientWidth + 1); i++) { f -= 2; box.style.fontSize = `${f}px`; }
}

/** A number stays on its line with its unit (15格). */
const keep = (s: string) => s.replace(/(\d)(?=[格級天個塊顆點倍回])/g, '$1\u2060');
/** A card's face: its picture, and what it does on the paper slip at its foot (always core/qingming-ling.ts's words). */
export const lingFace = (seat: number, text: string) => `<div class="qml-face"><img src="${lingSrc(seat)}" alt="" draggable="false"><div class="qml-slip"><span>${qmEsc(keep(text))}</span></div></div>`;
/** The slip's words as big as three lines of it take (after the face is laid out). */
export function fitFace(face: HTMLElement) {
  const slip = face.querySelector<HTMLElement>('.qml-slip')!, words = slip.firstElementChild as HTMLElement, w = face.offsetWidth;
  for (let f = w * 0.062; f > w * 0.035; f -= w * 0.002) {
    slip.style.fontSize = `${f}px`;
    if (words.offsetHeight <= slip.clientHeight && words.scrollWidth <= slip.clientWidth) break;
  }
}

fxScreens['qm-ling'] = async (ctx, fx) => {
  const d = (fx.data ?? {}) as { seat?: number; grade?: LingGrade; human?: boolean; text?: string };
  const seat = Math.max(1, Math.min(108, Number(d.seat) || 1)), grade = d.grade ?? gradeOf(seat), card = LING[seat - 1];
  const text = d.text ?? lingText(card?.text ?? '', ctx.game.priceIndex);
  shut();
  const ov = fitOverlay(ctx.shell, 'qml-ov', tall => (tall ? [900, 1600] : [1600, 900]), undefined, 0);
  shown = ov;
  music(true, QM_THEME.ling);
  qmStage(ov.scene);
  ov.scene.classList.add('qml-scene', `g-${grade}`);
  const src = lingSrc(seat);
  ov.scene.innerHTML = `
    <div class="qml-back"></div>
    <div class="qm-title qml-title">梁山令</div>
    <div class="qml-deck"><i></i><i></i><i></i></div>
    <div class="qml-glow"><i class="rays"></i><i class="halo"></i></div>
    <div class="qml-card"><div class="face back"><b>梁山令</b></div><div class="face front">${lingFace(seat, text)}</div></div>
    <div class="qml-sparks"></div>
    <div class="qm-dialog qml-dialog" hidden><div class="qm-tag qml-grade">${GRADE[grade]}令</div><div class="qm-say qml-say"><small>${qmEsc(ctx.game.name(fx.p ?? 0))}抽到第 ${seat} 位${card ? `・${qmEsc(card.name)}` : ''}</small><div>${qmEsc(text)}</div></div></div>
    <div class="qml-hint" hidden>點擊畫面繼續</div>`;
  const $ = (s: string) => ov.scene.querySelector<HTMLElement>(s)!;
  // the picture first (a flip onto a blank card looks broken), at most a second
  await Promise.race([new Promise<void>(r => { const im = new Image(); im.onload = im.onerror = () => r(); im.src = src; }), qmWait(1000)]);
  if (shown !== ov) return;
  const cardEl = $('.qml-card'), deck = $('.qml-deck');
  fitFace($('.qml-face'));
  // from the deck's top card to the middle, turning over on the way
  const dx = deck.offsetLeft + deck.offsetWidth / 2 - (cardEl.offsetLeft + cardEl.offsetWidth / 2);
  const dy = deck.offsetTop + deck.offsetHeight / 2 - (cardEl.offsetTop + cardEl.offsetHeight / 2);
  const k = deck.offsetWidth / cardEl.offsetWidth;
  cnSound('whoosh', 0.6);
  const fly = cardEl.animate([
    { transform: `translate(${dx}px, ${dy}px) scale(${k}) rotateY(180deg)`, offset: 0 },
    { transform: 'translate(0, -30px) scale(1.06) rotateY(180deg)', offset: 0.55 },
    { transform: 'translate(0, 0) scale(1) rotateY(0deg)', offset: 1 },
  ], { duration: 900, easing: 'cubic-bezier(.3, .1, .3, 1)', fill: 'both' });
  await new Promise<void>(r => { fly.onfinish = () => r(); fly.oncancel = () => r(); setTimeout(r, 1200); });
  if (shown !== ov) return;
  ov.scene.classList.add('shown');
  audio.ui(grade === 'common' ? 'click' : 'yes');
  if (grade === 'legend' || grade === 'rare') cnSound('special', 0.6);
  if (grade === 'legend') sparks($('.qml-sparks'), ov.isTall());
  await qmWait(350);
  if (shown !== ov) return;
  $('.qml-dialog').hidden = false;
  fitText($('.qml-say'));
  const human = d.human !== false;
  if (human) $('.qml-hint').hidden = false;
  await qmHold(ov.root, human ? Math.max(4000, 7000 * ctx.scale()) : Math.max(2000, 3000 * ctx.scale()));
  if (shown === ov) shut();
};

/** 傳說: gold sparks rising round the card. */
function sparks(layer: HTMLElement, tall: boolean) {
  const W = tall ? 900 : 1600, H = tall ? 1600 : 900;
  for (let i = 0; i < 34; i++) {
    const s = document.createElement('i');
    const x = W / 2 + (Math.random() - 0.5) * (tall ? 760 : 620), y = H * (tall ? 0.42 : 0.5) + (Math.random() - 0.3) * (tall ? 700 : 420);
    Object.assign(s.style, { left: `${x}px`, top: `${y}px` });
    layer.append(s);
    s.animate([{ opacity: 0, transform: 'translateY(0) scale(.4)' }, { opacity: 1, offset: 0.2 }, { opacity: 0, transform: `translateY(${-120 - Math.random() * 200}px) scale(1.2)` }],
      { duration: 1200 + Math.random() * 1200, delay: Math.random() * 1400, iterations: 2, easing: 'ease-out', fill: 'both' });
  }
}

export {};
