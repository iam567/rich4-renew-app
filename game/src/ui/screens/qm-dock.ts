/**
 * 清明上河's 汴河漕運 docks (core/qingming.ts dock, docs/rules/35 「渡口第 30 天才開」): the question
 * { t: 'qm-dock', p, open, daysLeft, fare, free, can } opens the dock by 虹橋 — the boatman waving from his boat, 梁山
 * far off in the marsh — and his line on the paper scroll. The first 30 days: 「距離渡口開放還剩 N 天」 and 知道了
 * (answer 0). From day 31: 上船去梁山 (the fare under it, 免費 for 張家兄弟; off when the player cannot pay) / 不去;
 * the answer 1 sails, 0 not. The crossing (fx 'qm-sail' { from, to, back, fare }): the camera glides over the water
 * to 梁山 (back: from it to the city) with the boat's sound, a couple of seconds; the core moves the piece after it.
 * Landscape 1600 × 900, upright 900 × 1600 (the dock painted for each).
 */
import { askScreens, fxScreens, onStuck, type ScreenContext } from './registry';
import { fitOverlay } from './bank';
import { audio, Sfx } from '../audio';
import { QM_THEME } from '../jq-music';
import { screenMusic } from '../screen-music';
import { QM_ART, qmEsc, qmHold, qmMoney, qmStage } from './qm-ui';
import './qm-dock.css';

const ART = `${QM_ART}/dock`;

interface DockAsk { t: 'qm-dock'; p: number; open: boolean; daysLeft: number; fare: number; free: boolean; can: boolean; boss?: boolean; passing?: boolean; office?: boolean; full?: boolean }
interface Open { ov: ReturnType<typeof fitOverlay>; $: (s: string) => HTMLElement }
let open: Open | null = null;
/** Its own piece while the dock or the crossing shows (清明上河's set, jq-music.ts QM_THEME). */
const music = screenMusic();
function shut() { open?.ov.close(); open = null; audio.stop(Sfx.boat); music(false, QM_THEME.dock); }
onStuck(shut);

function build(ctx: ScreenContext, cls = ''): Open {
  shut();
  let stage: HTMLElement | null = null;
  const bg = (tall: boolean) => { const b = stage?.querySelector<HTMLElement>('.qmd-bg'); if (b) b.style.backgroundImage = `url(${ART}/dock-${tall ? 'tall' : 'wide'}.webp)`; };
  const ov = fitOverlay(ctx.shell, 'qmd-ov', tall => (tall ? [900, 1600] : [1600, 900]), bg, 0);
  stage = ov.scene;
  music(true, QM_THEME.dock);
  qmStage(ov.scene);
  ov.scene.classList.add('qmd-scene');
  if (cls) ov.scene.classList.add(cls);
  ov.scene.innerHTML = `
    <div class="qmd-cam"><div class="qmd-bg"></div><div class="qmd-waves"></div></div>
    <div class="qm-title qmd-title">汴河漕運</div>
    <div class="qm-tag qmd-status"></div>
    <div class="qm-dialog qmd-dialog"><div class="qm-tag qmd-who">船老大</div><div class="qm-say qmd-say"></div></div>
    <div class="qmd-foot"></div>
    <div class="qmd-banner" hidden><div class="qm-title"></div><div class="qmd-note"></div></div>`;
  bg(ov.isTall());
  const $ = (s: string) => ov.scene.querySelector<HTMLElement>(s)!;
  open = { ov, $ };
  return open;
}

askScreens['qm-dock'] = (ctx, ask) => new Promise(resolve => {
  const a = ask as unknown as DockAsk, g = ctx.game;
  const o = build(ctx);
  o.$('.qmd-status').textContent = `${g.name(a.p)}　現金 ${qmMoney(g.players[a.p]?.cash ?? 0)}`;
  const say = o.$('.qmd-say'), foot = o.$('.qmd-foot');
  const done = (v: number) => { audio.ui(v ? 'yes' : 'no'); shut(); resolve(v); };
  audio.ui('click');
  if (!a.open) {
    say.innerHTML = `<div>客官莫急，漕船還沒開航哩！</div><div>距離渡口開放還剩 <b>${a.daysLeft}</b> 天</div>`;
    foot.innerHTML = '<button class="qm-btn gold qmd-ok">知道了</button>';
    o.$('.qmd-ok').onclick = () => done(0);
    return;
  }
  // 梁山 is full (core/qingming.ts LS_MAX)
  if (a.full && !a.boss) {
    say.innerHTML = '<div>目前去梁山的船已滿，請稍後再去吧。</div><div><small>梁山上最多兩位，有人回來了再開船。</small></div>';
    foot.innerHTML = '<button class="qm-btn gold qmd-ok">知道了</button>';
    o.$('.qmd-ok').onclick = () => done(0);
    return;
  }
  say.innerHTML = a.full
    ? '<div>東家，去梁山的船已滿。</div><div>需不需要坐<b>專船</b>前往？</div>'
    : a.office
    ? '<div>東家，自家漕運處的船候著呢！去梁山轉一圈？</div><div><small>自家的船不收錢，回來還在這裡下船。</small></div>'
    : a.boss
    ? a.passing
      ? '<div>東家，要不要小的帶您去一趟梁山？</div><div><small>您是漕運的東家，來回都不收錢。</small></div>'
      : '<div>東家來了！小的這就開船去梁山泊，</div><div><small>您是漕運的東家，來回都不收錢。</small></div>'
    : a.free
    ? '<div>客官，上船吧！咱們順著汴河去梁山泊，</div><div>張橫、張順兄弟交代過：<b>這趟免費</b>！</div>'
    : a.can
      ? `<div>客官，要搭漕船去梁山泊嗎？</div><div>船錢 <b>${qmEsc(qmMoney(a.fare))}</b>，順風順水就到金沙灘。</div>`
      : `<div>去梁山泊的船錢要 <b>${qmEsc(qmMoney(a.fare))}</b>，</div><div><small>客官身上的盤纏不夠，下回再來吧。</small></div>`;
  foot.innerHTML = `<button class="qm-btn ink qmd-no">不去</button><button class="qm-btn gold qmd-go"${a.can ? '' : ' disabled'}>${a.full ? '坐專船去梁山' : '上船去梁山'}<small>${a.free ? '免費' : qmEsc(qmMoney(a.fare))}</small></button>`;
  o.$('.qmd-no').onclick = () => done(0);
  (o.$('.qmd-go') as HTMLButtonElement).onclick = () => { if (a.can) done(1); };
});

fxScreens['qm-sail'] = async (ctx, fx) => {
  const d = (fx.data ?? {}) as { from?: number; to?: number; back?: boolean; fare?: number };
  const o = build(ctx, d.back ? 'back' : 'go');
  o.ov.scene.classList.add('sailing');
  const banner = o.$('.qmd-banner');
  banner.querySelector('.qm-title')!.textContent = d.back ? '回汴京' : '去梁山';
  o.$('.qmd-note').textContent = d.back ? `${ctx.game.name(fx.p ?? 0)}從金沙灘坐船回城` : `${ctx.game.name(fx.p ?? 0)}坐漕船往梁山泊金沙灘${d.fare ? `　船錢 ${qmMoney(d.fare)}` : ''}`;
  banner.hidden = false;
  audio.loop(Sfx.boat);
  const ms = Math.max(1800, 2800 * ctx.scale());
  o.ov.scene.style.setProperty('--sail', `${ms}ms`);
  await qmHold(o.ov.root, ms + 400);
  if (open === o) shut();
};

export {};
