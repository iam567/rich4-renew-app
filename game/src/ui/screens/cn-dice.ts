/**
 * 長安's 博戲坊 (core/changan.ts, the user 2026-11-19): one screen for the bet and the throw. The question
 * { t: 'cn-dice-bet', win, lose, owner, name } opens it: the gambling hall, the dealer with her words, the dice cup on
 * its tray, the 大 / 小 medallions and a 5-second clock (then a side at random); the answer 1 大, 0 小. The screen
 * stays up for the throw that follows (fx 'cn-dice-roll': the cup shakes, lifts, the three Chinese dice and their sum,
 * then the result plaque — 押中了 in gold with a jumping purse and a rain of coins, 押錯了 in silver with a torn purse
 * under a rain cloud). A computer's bet shows only the throw. Landscape 1600 × 900, upright 900 × 1600.
 */
import { askScreens, fxScreens, onStuck, type ScreenContext } from './registry';
import { fitOverlay } from './bank';
import { audio } from '../audio';
import { ASSETS, cssUrl } from '../assets';
import './cn-dice.css';
import { CN_THEME } from '../jq-music';
import { cnPreload, cnSound } from '../cn-sound';

const ART = `${ASSETS}/maps/remake/changan/dice`;
/** The backdrop and the dealer: 清明上河's 瓦舍勾欄 is a Song street stall of its own (tools/tycoon-art/qingming_dice.py); the cup,
 * tray, tiles and frames are 長安's everywhere. */
const placeArt = (ctx: ScreenContext) => (hallName(ctx) === '瓦舍勾欄' ? `${ASSETS}/maps/remake/qingming/dice` : ART);
const money = (n: number) => `${Math.round(n).toLocaleString('en-US')} 文`;
const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

interface BetAsk { t: 'cn-dice-bet'; p: number; win: number; lose: number; owner: number; name: string }
interface Open { ov: ReturnType<typeof fitOverlay>; $: (s: string) => HTMLElement; ctx: ScreenContext }
let open: Open | null = null;

let hall: (() => void) | null = null;
function shut() { open?.ov.close(); open = null; hall?.(); hall = null; music(false, CN_THEME.dice); }
/** The screen's own music while it is open (長安's set, jq-music.ts CN_THEME), the background track again after. */
let themed = false;
function music(on: boolean, i: number) {
  if (on && !themed && audio.hasTheme(i)) { audio.theme(i); themed = true; }
  else if (!on && themed) { audio.restore(); themed = false; }
}

onStuck(shut);

/** Chinese dice: the one and the four in red. */
function die(n: number): string {
  const P: Record<number, number[][]> = { 1: [[50, 50]], 2: [[28, 28], [72, 72]], 3: [[26, 26], [50, 50], [74, 74]], 4: [[28, 28], [72, 28], [28, 72], [72, 72]],
    5: [[26, 26], [74, 26], [50, 50], [26, 74], [74, 74]], 6: [[28, 24], [72, 24], [28, 50], [72, 50], [28, 76], [72, 76]] };
  const red = n === 1 || n === 4, r = n === 1 ? 15 : 9;
  return `<svg class="cnd-die" viewBox="0 0 100 100"><rect x="4" y="4" width="92" height="92" rx="18" fill="#fbf5e8" stroke="#8a6a40" stroke-width="3"/>${P[n].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${red ? '#c8241c' : '#1e1612'}"/>`).join('')}</svg>`;
}

/** Fits every panel's words inside its frame (smaller until they fit). */
function fitText(scene: HTMLElement) {
  if (!scene.isConnected) return;
  for (const el of scene.querySelectorAll<HTMLElement>('.cnd-lbl, .cnd-txt')) {
    el.style.fontSize = '';
    let f = parseFloat(getComputedStyle(el).fontSize);
    for (let i = 0; i < 30 && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1); i++) { f -= 1; el.style.fontSize = `${f}px`; }
  }
}

function build(ctx: ScreenContext, owner: string, name: string, who: string): Open {
  shut();
  const ov = fitOverlay(ctx.shell, 'cnd-ov', tall => (tall ? [900, 1600] : [1600, 900]), () => requestAnimationFrame(() => fitText(ov.scene)), 0);
  ov.scene.classList.add('cnd-scene');
  music(true, CN_THEME.dice);
  hall ??= cnSound('hall', 0.35, true);
  cnPreload('rattle', 'land', 'coins', 'cheer', 'boo');
  ov.scene.style.setProperty('--art', cssUrl(`${placeArt(ctx)}/hall.webp`));
  ov.scene.innerHTML = `
    <div class="cnd-bg"></div><div class="cnd-dim"></div>
    <div class="cnd-frame cnd-plaque"><div class="cnd-lbl cnd-title">${hallName(ctx)}</div></div>
    <div class="cnd-frame cnd-status"><div class="cnd-lbl">${who}　莊家：${owner}${name ? `（${name}）` : ''}</div></div>
    <img class="cnd-dealer" src="${placeArt(ctx)}/dealer.webp" alt="">
    <div class="cnd-frame cnd-say"><div class="cnd-lbl cnd-words"></div></div>
    <div class="cnd-table"><div class="cnd-sum"></div><div class="cnd-tray" style="background-image:url(${ART}/tray.webp)"></div><div class="cnd-dice"></div><div class="cnd-cup" style="background-image:url(${ART}/cup.webp)"></div></div>
    <div class="cnd-bets">
      <button class="cnd-tile" data-v="1" style="background-image:url(${ART}/tile-big.webp)"><b>大</b><i>11–18 點</i></button>
      <button class="cnd-tile" data-v="0" style="background-image:url(${ART}/tile-small.webp)"><b>小</b><i>3–10 點</i></button>
    </div>
    <div class="cnd-frame cnd-timer"><div class="cnd-lbl"></div></div>
    <div class="cnd-result"></div><div class="cnd-fx"></div>`;
  const $ = (s: string) => ov.scene.querySelector<HTMLElement>(s)!;
  open = { ov, $, ctx };
  const refit = () => fitText(ov.scene);
  requestAnimationFrame(refit); setTimeout(refit, 250); void document.fonts?.ready.then(refit);
  return open;
}

/** The hall's name on this map: 長安's 博戲坊, 清明上河's 瓦舍勾欄 (the large plots' first kind). */
const hallName = (ctx: ScreenContext) => ctx.game.rules?.facilityNames?.[0] ?? '博戲坊';

const say = (o: Open, html: string) => { o.$('.cnd-words').innerHTML = `<div>${html}</div>`; requestAnimationFrame(() => fitText(o.ov.scene)); };

askScreens['cn-dice-bet'] = (ctx, ask) => new Promise(resolve => {
  const a = ask as unknown as BetAsk, g = ctx.game;
  const o = build(ctx, g.name(a.owner), a.name, `${g.name(a.p)}（客人）`);
  say(o, `客官，進了${hallName(ctx)}可得押一把！<br>押中了，莊家付您 <b>${money(a.win)}</b><br>押錯了，您付莊家 <b>${money(a.lose)}</b>`);
  let left = 5, done = false;
  const timer = o.$('.cnd-timer .cnd-lbl');
  const show = () => { timer.textContent = `請押「大」或「小」　還有 ${left} 秒`; requestAnimationFrame(() => fitText(o.ov.scene)); };
  const pick = (v: number) => {
    if (done) return;
    done = true; clearInterval(tick); audio.ui('yes');
    o.$('.cnd-timer').style.display = 'none';
    o.ov.scene.querySelectorAll<HTMLElement>('.cnd-tile').forEach(t => t.classList.add(Number(t.dataset.v) === v ? 'sel' : 'dim'));
    say(o, `押「<b>${v ? '大' : '小'}</b>」！<br>買定離手——開搖！`);
    resolve(v);
  };
  o.ov.scene.querySelectorAll<HTMLButtonElement>('.cnd-tile').forEach(t => { t.onclick = () => pick(Number(t.dataset.v)); });
  show();
  const tick = setInterval(() => { if (--left <= 0) pick(Math.random() < 0.5 ? 1 : 0); else show(); }, 1000);
});

fxScreens['cn-dice-roll'] = async (ctx, fx) => {
  const d = fx.data as { dice: number[]; sum: number; big: boolean; isBig: boolean; hit: boolean; amount: number };
  const g = ctx.game, sc = ctx.scale();
  let o = open;
  if (!o) {   // a computer's bet: the screen opens for the throw only
    const fid = (fx.data as { facility?: number }).facility;
    o = build(ctx, g.name(fx.target ?? 0), (fid && g.board.facilities[fid - 1]?.name) || '', `${g.name(fx.p ?? 0)}（客人）`);
    o.$('.cnd-timer').style.display = 'none';
    o.ov.scene.querySelectorAll<HTMLElement>('.cnd-tile').forEach(t => t.classList.add(Number(t.dataset.v) === (d.big ? 1 : 0) ? 'sel' : 'dim'));
    say(o, `${g.name(fx.p ?? 0)}押「<b>${d.big ? '大' : '小'}</b>」！<br>買定離手——開搖！`);
  }
  const cup = o.$('.cnd-cup');
  cup.animate([{ transform: 'translate(0,0) rotate(0)' }, { transform: 'translate(-26px,-30px) rotate(-14deg)' }, { transform: 'translate(24px,-36px) rotate(12deg)' },
    { transform: 'translate(-20px,-22px) rotate(-10deg)' }, { transform: 'translate(18px,-30px) rotate(9deg)' }, { transform: 'translate(0,0) rotate(0)' }],
  { duration: 520 * sc, iterations: 3, easing: 'ease-in-out' });
  cnSound('rattle', 0.9);
  await wait(1700 * sc);
  o.$('.cnd-dice').innerHTML = d.dice.map(die).join('');
  cnSound('land', 0.9);
  cup.animate([{ transform: 'translate(0,0) rotate(0)' }, { transform: 'translate(-250px,-40px) rotate(-30deg)' }], { duration: 650 * sc, easing: 'ease-out', fill: 'forwards' });
  await wait(700 * sc);
  const sum = o.$('.cnd-sum');
  sum.innerHTML = `${d.dice.join(' + ')} = ${d.sum}　<span>${d.isBig ? '大' : '小'}</span>`;
  sum.animate([{ transform: 'scale(.3)', opacity: 0 }, { transform: 'scale(1.15)', opacity: 1, offset: 0.6 }, { transform: 'scale(1)', opacity: 1 }], { duration: 500, fill: 'forwards' });
  await wait(900 * sc);
  const res = o.$('.cnd-result'), bs = `開${d.isBig ? '大' : '小'}・${d.sum} 點`;
  res.className = `cnd-result ${d.hit ? 'win' : 'lose'}`;
  res.innerHTML = `<div class="cnd-frame cnd-plate"></div><img class="cnd-icon" src="${ART}/${d.hit ? 'win-pouch' : 'lose-purse'}.webp" alt="">
    <div class="cnd-txt"><div class="cnd-t">${d.hit ? '押中了！' : '押錯了…'}</div><div class="cnd-s">${bs}　${d.hit ? '莊家付' : '付莊家'} <b>${money(d.amount)}</b></div></div>`;
  res.style.opacity = '1';
  res.animate([{ transform: 'scale(.3)', opacity: 0 }, { transform: 'scale(1.08)', opacity: 1, offset: 0.7 }, { transform: 'scale(1)', opacity: 1 }], { duration: 550 });
  requestAnimationFrame(() => fitText(o!.ov.scene));
  say(o, d.hit ? '哎呀，客官好手氣……<br>莊家這回賠了！' : '多謝客官捧場～<br>下回再來試試手氣！');
  audio.ui(d.hit ? 'yes' : 'no');
  if (d.hit) { cnSound('coins', 0.9); cnSound('cheer', 0.6); } else cnSound('boo', 0.6);
  const fxl = o.$('.cnd-fx'), W = o.ov.isTall() ? 900 : 1600, H = o.ov.isTall() ? 1600 : 900;
  const sprite = (src: string, x: number, y: number, w: number, frames: Keyframe[], dur: number) => {
    const im = document.createElement('img'); im.src = src; im.className = 'cnd-fxi';
    Object.assign(im.style, { width: `${w}px`, left: `${x - w / 2}px`, top: `${y - w / 2}px` });
    fxl.append(im); im.animate(frames, { duration: dur, easing: 'ease-out', fill: 'forwards' }).onfinish = () => im.remove();
  };
  if (d.hit) {
    for (let k = 0; k < 20; k++) setTimeout(() => sprite(`${ART}/${Math.random() < 0.25 ? 'win-ingot' : 'token-coins'}.webp`, 80 + Math.random() * (W - 160), -60, 70 + Math.random() * 40,
      [{ transform: 'translateY(0)' }, { transform: `translateY(${H + 80}px) rotate(${Math.random() * 720 - 360}deg)` }], 1700 + Math.random() * 700), k * 90);
    sprite(`${ART}/confetti.webp`, W / 2, H * 0.45, 460, [{ transform: 'scale(.2)', opacity: 1 }, { transform: 'scale(1.3)', opacity: 0 }], 1500);
  } else {   // the rain cloud over the torn purse, clear of the words
    // (the plate's layout box: its pop-in scale would throw a measured one off)
    sprite(`${ART}/rain-cloud.webp`, res.offsetLeft + 40, res.offsetTop - 60, 190, [{ opacity: 0 }, { opacity: 1, offset: 0.3 }, { opacity: 1, offset: 0.9 }, { opacity: 0 }], 3200);
  }
  await wait(Math.max(2600, 3400 * sc));
  if (open === o) shut();
};
