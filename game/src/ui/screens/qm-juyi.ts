/**
 * 清明上河's 聚義廳 (core/qingming-ling.ts exchangeJuyi, docs/rules/35 §集齊檔口): fx 'qm-juyi' { got, ready, human,
 * rewards? }. The hall: the player's 梁山令 collection (the 108 seats, the ones drawn lit; a tap shows the card) and
 * the sets by their group (夫妻檔 兄弟檔 …), each with its heroes, its reward and its mark — 已換 (exchanged before),
 * 湊齊！ (cashed in now: they flash, and their rewards are read out at the top), or how many of it are drawn. Nothing
 * ready: a short view (還沒有湊齊的檔口, the count, 看看收藏 opens the hall). Both lists scroll, the buttons stay put.
 * A computer's visit closes by itself. Landscape 1600 × 900 (the two lists side by side), upright 900 × 1600 (stacked).
 */
import { fxScreens, onStuck, type ScreenContext } from './registry';
import { fitOverlay } from './bank';
import { audio } from '../audio';
import { cnSound } from '../cn-sound';
import { QM_THEME } from '../jq-music';
import { screenMusic } from '../screen-music';
import { JUYI_SETS, LING, gradeOf, lingText, type JuyiSet } from '../../core/qingming-ling';
import { QM_ART, qmEsc, qmHold, qmStage } from './qm-ui';
import { fitFace, lingFace } from './qm-ling';
import './qm-juyi.css';

let shown: ReturnType<typeof fitOverlay> | null = null;
/** Its own piece while it shows (清明上河's set, jq-music.ts QM_THEME). */
const music = screenMusic();
function shut() { shown?.close(); shown = null; music(false, QM_THEME.juyi); }
onStuck(shut);

const heroName = (seat: number) => LING[seat - 1]?.name ?? `第${seat}位`;
/** Sets bigger than this show a count instead of every hero. */
const LIST_MAX = 8;

/** The sets exchanged before this visit (the rules' record; the ready ones are added after the screen). */
function doneSets(ctx: ScreenContext, p: number): Set<string> {
  const r = ctx.game.rules as unknown as { ling?: { done?: string[][] } } | undefined;
  return new Set(r?.ling?.done?.[p] ?? []);
}

function setRow(s: JuyiSet, got: Set<number>, ready: Set<string>, done: Set<string>, pi: number): string {
  const have = s.seats.filter(x => got.has(x)).length, isReady = ready.has(s.id), isDone = !isReady && done.has(s.id);
  const mark = isReady ? '<em class="mk ready">湊齊！</em>' : isDone ? '<em class="mk done">已換</em>' : `<em class="mk">${have} / ${s.seats.length}</em>`;
  const heroes = s.seats.length <= LIST_MAX
    ? `<div class="hs">${s.seats.map(x => `<span class="${got.has(x) ? 'on' : ''}">${qmEsc(heroName(x))}</span>`).join('')}</div>`
    : `<div class="hs"><span class="bar"><i style="width:${(have / s.seats.length) * 100}%"></i></span></div>`;
  return `<div class="qmj-set${isReady ? ' ready' : ''}${isDone ? ' done' : ''}" data-id="${qmEsc(s.id)}"><div class="hd"><b>${qmEsc(s.name)}</b>${mark}</div>${heroes}<div class="rw">${qmEsc(lingText(s.reward, pi))}</div></div>`;
}

fxScreens['qm-juyi'] = async (ctx, fx) => {
  const d = (fx.data ?? {}) as { got?: number[]; ready?: string[]; human?: boolean; rewards?: string[] };
  const p = fx.p ?? 0, got = new Set((d.got ?? []).map(Number)), readyIds = d.ready ?? [], ready = new Set(readyIds), done = doneSets(ctx, p);
  const human = d.human !== false;
  shut();
  const ov = fitOverlay(ctx.shell, 'qmj-ov', tall => (tall ? [900, 1600] : [1600, 900]), undefined, 0);
  shown = ov;
  music(true, QM_THEME.juyi);
  qmStage(ov.scene);
  ov.scene.classList.add('qmj-scene');
  if (!readyIds.length) ov.scene.classList.add('none');

  // the sets by group, in the order the groups first come
  const groups: string[] = [];
  for (const s of JUYI_SETS) if (!groups.includes(s.group)) groups.push(s.group);
  const setsHtml = groups.map(gr => `<h4 class="qm-tag">${qmEsc(gr)}</h4>${JUYI_SETS.filter(s => s.group === gr).map(s => setRow(s, got, ready, done, ctx.game.priceIndex)).join('')}`).join('');
  const rewards = readyIds.map((id, i) => {
    const s = JUYI_SETS.find(x => x.id === id);
    return `<li><b>${qmEsc(s?.name ?? id)}</b><span>${qmEsc(d.rewards?.[i] ?? (s ? lingText(s.reward, ctx.game.priceIndex) : ''))}</span></li>`;
  }).join('');
  const tiles = Array.from({ length: 108 }, (_, i) => {
    const seat = i + 1, on = got.has(seat);
    return `<button class="qmj-hero g-${gradeOf(seat)}${on ? ' on' : ''}" data-seat="${seat}"${on ? '' : ' disabled'}>` +
      `<img src="${QM_ART}/ling/thumb/${String(seat).padStart(3, '0')}.webp" alt="" loading="lazy" draggable="false"><i>${seat}</i><span>${on ? qmEsc(heroName(seat)) : '？'}</span></button>`;
  }).join('');

  ov.scene.innerHTML = `
    <div class="qmj-bg"></div>
    <div class="qm-title qmj-title">聚義廳</div>
    <div class="qmj-status">${qmEsc(ctx.game.name(p))}　好漢 ${got.size} / 108</div>
    <div class="qmj-body">
      <section class="qmj-pane qmj-sets"><h3>檔　口</h3><div class="qmj-scroll">${rewards ? `<div class="qmj-news"><div class="t">換得獎勵</div><ul>${rewards}</ul></div>` : ''}${setsHtml || '<p class="qmj-empty">（檔口還在整理中）</p>'}</div></section>
      <section class="qmj-pane qmj-heroes"><h3>一百單八將　<small>${got.size} / 108</small></h3><div class="qmj-scroll qmj-grid">${tiles}</div></section>
    </div>
    <div class="qm-dialog qmj-short"><div class="qm-say"><div>還沒有湊齊的檔口</div><small>已集 ${got.size} / 108 位好漢，湊齊一個檔口再來換獎勵</small></div></div>
    <div class="qmj-foot">${readyIds.length ? '<button class="qm-btn gold qmj-ok">好！</button>' : '<button class="qm-btn ink qmj-look">看看收藏</button><button class="qm-btn gold qmj-ok">知道了</button>'}</div>
    <div class="qmj-zoom" hidden><div></div></div>`;
  const $ = (s: string) => ov.scene.querySelector<HTMLElement>(s);

  // a lit hero: the card big; a tap puts it away
  const zoom = $('.qmj-zoom')!;
  ov.scene.querySelectorAll<HTMLButtonElement>('.qmj-hero.on').forEach(b => {
    b.onclick = e => { e.stopPropagation(); audio.ui('click'); const seat = Number(b.dataset.seat); zoom.firstElementChild!.innerHTML = lingFace(seat, lingText(LING[seat - 1].text, ctx.game.priceIndex)); zoom.hidden = false; fitFace(zoom.querySelector<HTMLElement>('.qml-face')!); };
  });
  zoom.onclick = e => { e.stopPropagation(); zoom.hidden = true; };

  if (readyIds.length) {
    audio.ui('yes');
    cnSound('cheer', 0.5); cnSound('coins', 0.6);
    // the first set cashed in, in view
    requestAnimationFrame(() => {
      const row = $('.qmj-set.ready'), sc = $('.qmj-sets .qmj-scroll');
      if (row && sc && row.offsetTop > sc.clientHeight * 0.6) sc.scrollTop = Math.max(0, row.offsetTop - sc.clientHeight * 0.3);
      if (sc && $('.qmj-news')) sc.scrollTop = 0;
    });
  } else audio.ui('click');

  if (!human) {
    // a computer's visit: shown a moment, a tap closes it
    await qmHold(ov.root, Math.max(readyIds.length ? 3000 : 1800, (readyIds.length ? 4500 : 2600) * ctx.scale()));
    if (shown === ov) shut();
    return;
  }
  await new Promise<void>(resolve => {
    // the button, or closed from outside (the hang guard), or left alone a long while
    const finish = () => { clearTimeout(t); clearInterval(watch); resolve(); };
    const t = window.setTimeout(finish, 90000);
    const watch = window.setInterval(() => { if (!ov.root.isConnected) finish(); }, 500);
    $('.qmj-ok')!.onclick = () => { audio.ui('yes'); finish(); };
    const look = $('.qmj-look');
    if (look) look.onclick = () => { audio.ui('click'); ov.scene.classList.remove('none'); look.remove(); };
  });
  if (shown === ov) shut();
};

export {};
