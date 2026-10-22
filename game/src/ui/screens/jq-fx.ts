/**
 * 激情歲月's screens (docs/rules/24, core/jiqing.ts):
 * - 'choose:jq-fac' (§2.6): the five facilities' plates in one row (人民公園 / 招待所 / 供銷社 / 宣傳站 / 研究所), the
 *   rule line under it while a plate is pointed at or held — as 歌舞伎町's shop picker (kb-shop.ts).
 * - 'jq-card' (§2.1): a 人民公園 card — its picture (maps/remake/events/<pic>.webp), good or bad, what it does.
 * - 'jq-verdict' (§2.4): the 宣傳站's verdict on a rider / driver — the fine worked out, the 學習班.
 * - 'jq-study' (§2.4): the 學習班 opens (a small card); the turns sat out there are the rules' own 'say' lines.
 * - 'jq-free': 免費卡 waived the fine (「罰款免了，學習可免不了」).
 * Each card stays about 3.5 s × the game speed (a tap closes it sooner; a human's waits for the tap).
 */
import { CHARACTERS, playerName } from '../../core/characters';
import { JQ_FAC_PLATE } from '../../core/modules/jq-data';
import { askScreens, fxScreens, type ScreenContext } from './registry';
import { fitOverlay } from './bank';
import { esc } from './place-scene';
import { RESULT_MIN_MS } from './event-result';
import { regionalPictureUrl } from './regional';
import { ASSETS } from '../assets';
import { audio, Sfx } from '../audio';
import type { Ask } from '../../core/types';
import { Loudspeakers } from '../jq-loudspeaker';
import { loudspeakerMode } from '../jiqing';
import './casino-hall.css';
import './kb-shop.css';
import './jq-fx.css';

type Fx = Parameters<(typeof fxScreens)[string]>[1];

/** The facilities' plates and the map's UI pieces (maps/remake/jiqing/<name>.webp, editor/build_jiqing.py install). */
export const JQ_ART = (name: string) => `${ASSETS}/maps/remake/jiqing/${name}.webp`;
export const JQ_PLATE = (type: number) => JQ_ART(`plate-${JQ_FAC_PLATE[type] ?? 'park'}`);
const fmt = (n: number) => Math.trunc(n).toLocaleString('en-US');

const faceImg = (ctx: ScreenContext, p: number | undefined, cls = '') => {
  const ch = p !== undefined ? CHARACTERS[ctx.game.players[p]?.character ?? -1] : undefined;
  const a = ch ? ctx.bank.art('Data', 2, ch.id) : null;
  return a ? `<img class="${cls}" src="${a.src}" alt="" style="--c:#${ch!.color.toString(16).padStart(6, '0')}">` : '';
};
const who = (ctx: ScreenContext, p: number | undefined) => (p !== undefined && ctx.game.players[p] ? playerName(ctx.game.players[p]) : '');
const humanIn = (ctx: ScreenContext, fx: Fx) => [fx.p, fx.target].some(i => { const q = i !== undefined ? ctx.game.players[i] : undefined; return !!q && ctx.game.isHuman(q); });

// ------------------------------------------------------------------ the facility picker

askScreens['choose:jq-fac'] = (ctx, ask) => new Promise(resolve => {
  const a = ask as Extract<Ask, { t: 'choose' }>;
  const box = document.createElement('div');
  box.className = 'msg ask fac ch-box kb-shop jq-fac';
  const HINT = '輕點選擇・按住或指著看設施的規則';
  box.innerHTML = `<div class="ribbon">${esc(a.title)}</div><div class="msg-text">${esc(a.text ?? '')}</div>
    <div class="choices facilities">${a.options.map(o => `<button class="candy cell fac-cell ch-hall" data-v="${o.value}"${o.disabled ? ' disabled' : ''}>
      <span class="fac-pic"><img class="kb-plate" src="${JQ_PLATE(Number(o.value))}" alt="" draggable="false"></span><span class="fac-name">${esc(o.label)}</span></button>`).join('')}</div>
    <div class="ch-rule">${HINT}</div>${a.cancellable ? '<div class="choices tiles-cancel"><button class="candy ghost ch-cancel">取消</button></div>' : ''}`;
  const rule = box.querySelector<HTMLElement>('.ch-rule')!;
  const tell = (v: number | null) => {
    const o = v === null ? undefined : a.options.find(x => x.value === v);
    rule.textContent = o?.detail ? `${o.label}：${o.detail}` : HINT;
    rule.classList.toggle('on', !!o?.detail);
  };
  const done = (v: number) => { ctx.close(); resolve(v); };
  box.querySelectorAll<HTMLButtonElement>('.ch-hall').forEach(b => {
    const v = Number(b.dataset.v);
    let held = 0, long = false;
    b.onpointerenter = e => { if (e.pointerType === 'mouse') { tell(v); if (!b.disabled) audio.ui('hover'); } };
    b.onfocus = () => tell(v);
    b.onpointerdown = () => { long = false; held = window.setTimeout(() => { long = true; tell(v); }, 450); };
    b.onpointerup = b.onpointerleave = () => clearTimeout(held);
    b.oncontextmenu = e => e.preventDefault();
    b.onclick = () => { if (long) { long = false; return; } audio.ui('yes'); done(v); };
  });
  box.querySelector<HTMLElement>('.choices.facilities')!.onpointerleave = e => { if (e.pointerType === 'mouse') tell(null); };
  box.querySelector<HTMLButtonElement>('.ch-cancel')?.addEventListener('click', () => { audio.ui('no'); done(-1); });
  ctx.open(box);
});

// ------------------------------------------------------------------ cards

/** A card over the map (440 × `h` units): gone by itself after 3.5 s × speed, or on a tap (a human's waits for it). */
function card(ctx: ScreenContext, fx: Fx, cls: string, html: string, h = 490): Promise<void> {
  const ov = fitOverlay(ctx.area, `jqc-ov ${cls}`, () => [440, h], undefined, 16);
  const { scene, root } = ov;
  scene.classList.add('jqc-scene');
  scene.innerHTML = html;
  for (const img of scene.querySelectorAll<HTMLImageElement>('img.jqc-img')) img.onerror = () => img.remove();
  const mine = humanIn(ctx, fx), total = Math.max(1800, 3500 * ctx.scale()), tapAfter = Math.min(RESULT_MIN_MS, total * 0.6);
  return new Promise<void>(resolve => {
    let done = false;
    const end = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      root.classList.add('out');
      setTimeout(() => { ov.close(); resolve(); }, 180);
    };
    const timer = mine ? 0 : setTimeout(end, total);
    setTimeout(() => { if (!done) { root.classList.add('can-close'); root.addEventListener('pointerup', end); } }, tapAfter);
  });
}

const textLines = (s: string) => esc(s).replace(/\n/g, '<br>');

fxScreens['jq-card'] = (ctx, fx) => {
  const d = fx.data ?? {}, good = d.good === true;
  const pic = typeof d.pic === 'string' && /^[a-z0-9-]+$/.test(d.pic) ? regionalPictureUrl(d.pic) : '';
  const [head, ...rest] = String(d.text ?? '').split('\n');
  audio.sfx(good ? Sfx.points : Sfx.special);
  return card(ctx, fx, good ? 'good' : 'bad', `<div class="jqc-card">
      <div class="jqc-head">${faceImg(ctx, fx.p, 'jqc-face')}<span class="jqc-where">${esc(who(ctx, fx.target))}的${esc(String(d.name ?? ''))}人民公園</span><span class="jqc-tag">${good ? '好事卡' : '壞事卡'}</span></div>
      <div class="jqc-pic"><img class="jqc-plate" src="${JQ_PLATE(0)}" alt="">${pic ? `<img class="jqc-img" src="${pic}" alt="">` : ''}</div>
      <div class="jqc-title">${textLines(head)}</div>
      <div class="jqc-line">${textLines(rest.join('\n'))}</div>
      <div class="jqc-tap">點一下繼續</div>
    </div>`);
};

fxScreens['jq-verdict'] = (ctx, fx) => {
  const d = fx.data ?? {}, vehicle = Number(d.vehicle) || 1, level = Number(d.level) || 1, k = Number(d.k) || 1;
  const f = ctx.game.board.facilities[Number(d.facility) - 1];
  audio.sfx(Sfx.special);
  return card(ctx, fx, 'verdict', `<div class="jqc-card">
      <div class="jqc-head">${faceImg(ctx, fx.p, 'jqc-face')}<span class="jqc-where">${esc(who(ctx, fx.target))}的${esc(f?.name ?? '')}宣傳站・${level}級</span><span class="jqc-tag">判決</span></div>
      <div class="jqc-pic"><img class="jqc-plate" src="${JQ_PLATE(14)}" alt=""><img class="jqc-img" src="${regionalPictureUrl('jq-x-verdict')}" alt=""></div>
      <div class="jqc-title">${vehicle === 1 ? '騎幸福摩托逛大街？' : '坐上海轎車兜風？'}<br><b>${vehicle === 1 ? '走資本主義道路！' : '資產階級作風！'}</b></div>
      <div class="jqc-line">罰款 500×${vehicle === 1 ? 1 : 2}×骰子${Number(d.dice) || 0}${ctx.game.priceIndex > 1 ? `×物價${ctx.game.priceIndex}` : ''}×${k}倍 ＝ <em>${fmt(Number(d.amount) || 0)}元</em><br>學習班 <em>2天</em>（原地學習）</div>
      <div class="jqc-tap">點一下繼續</div>
    </div>`, 500);
};

fxScreens['jq-study'] = (ctx, fx) => {
  if (!fx.data?.start) return Promise.resolve();
  return card(ctx, fx, 'study', `<div class="jqc-card small">
      <div class="jqc-head">${faceImg(ctx, fx.p, 'jqc-face')}<span class="jqc-where">${esc(who(ctx, fx.p))}</span><span class="jqc-tag">學習班</span></div>
      <div class="jqc-pic"><img class="jqc-img" src="${regionalPictureUrl('jq-x-class')}" alt=""></div>
      <div class="jqc-title">學習班開課啦！</div>
      <div class="jqc-line">原地學習 <em>${Number(fx.data?.turns) || 2}回合</em>：今天學習《為人民服務》</div>
    </div>`, 440);
};

fxScreens['jq-free'] = (ctx, fx) => card(ctx, fx, 'free', `<div class="jqc-card small">
      <div class="jqc-head">${faceImg(ctx, fx.p, 'jqc-face')}<span class="jqc-where">${esc(who(ctx, fx.p))}</span><span class="jqc-tag">免費卡</span></div>
      <div class="jqc-pic"><img class="jqc-img" src="${regionalPictureUrl('jq-x-free')}" alt=""></div>
      <div class="jqc-title">罰款免了，<br>學習可免不了！</div>
    </div>`, 420);

// ------------------------------------------------------------------ the 廣播站's jingle before its news (§9.3)

const horn = new Loudspeakers();
const newsBoard = fxScreens['news'];
if (newsBoard) fxScreens['news'] = (ctx, fx) => { if (fx.data?.jq) horn.newsJingle(loudspeakerMode() === 0); return newsBoard(ctx, fx); };
