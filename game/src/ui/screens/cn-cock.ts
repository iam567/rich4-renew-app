/**
 * 長安's 鬥雞場 (core/changan.ts cock; the user 2026-11-18/19; the mock rich4-redraw-company/changan/cock-mock): the
 * question { t: 'cn-cock', p, stars, pairs, cash, points, canCash, canPoints } opens the arena — today's pairings, a card
 * per rooster (its stars, its 獨贏 odds, its special move), the five bet types, 10 點券 or 1,000 文, the odds and what a
 * win pays; the answer { type, picks, stake } (null: 不押了). The fights (fx 'cn-cock-fight'): the four bouts as the
 * rules drew them — pecks, flying kicks, dodges, one special move each with its own effect, the bar running down,
 * 快轉 — then the podium (the champion in sunglasses with a gold chain and a cigar, the last one on crutches …) and the
 * verdict, coins or a rain cloud. A computer's bet shows the podium only. Landscape 1600 × 900, upright 900 × 1600.
 */
import { askScreens, fxScreens, onStuck, type ScreenContext } from './registry';
import { fitOverlay } from './bank';
import { audio } from '../audio';
import { ASSETS } from '../assets';
import { CN_THEME } from '../jq-music';
import { cnPreload, cnSound } from '../cn-sound';
import { COCK_NAMES, COCK_PICKS, COCK_TYPES, cockOdds, type CockType } from '../../core/changan';
import './cn-ui.css';
import './cn-cock.css';

const ART = `${ASSETS}/maps/remake/changan/cock`;
const money = (n: number) => `${Math.round(n).toLocaleString('en-US')} 文`;
const ROOSTERS = [
  { no: '一', name: '赤冠將軍', sp: '烈焰爪', fx: 'fx-fire', color: '#d8402a' },
  { no: '二', name: '烏金劍', sp: '黑風斬', fx: 'fx-wind', color: '#203028' },
  { no: '三', name: '白玉翎', sp: '白鶴旋', fx: 'fx-crane', color: '#f4f4f4' },
  { no: '四', name: '花斑虎', sp: '猛虎撲', fx: 'fx-tiger', color: '#b0702a' },
];
const HINT: Record<CockType, string> = { win: '選一隻：牠拿第一就贏', place: '選一隻：牠進前兩名就贏', quin: '選兩隻：牠們是第一、二名（不分先後）就贏',
  ex: '依序選兩隻：第一名、第二名都要對', tri: '依序選三隻：第一、二、三名都要對' };
const pose = (i: number, p: string) => `${ART}/r${i + 1}-${p}.webp`;
const nm = (i: number) => `${ROOSTERS[i].no}號`;
const stars = (n: number) => Array.from({ length: 5 }, (_, i) => `<img src="${ART}/${i < n ? 'star' : 'star-empty'}.webp" alt="">`).join('');

interface CockAsk { t: 'cn-cock'; p: number; stars: number[]; pairs: number[][]; cash: number; points: number; canCash: boolean; canPoints: boolean }
interface Fight { stars: number[]; pairs: number[][]; bouts: number[][]; rank: number[]; type: CockType; picks: number[]; stake: 'cash' | 'points'; odds: number; hit: boolean; prize: number; cash: number; human: boolean }
interface Open { ov: ReturnType<typeof fitOverlay>; $: (s: string) => HTMLElement }
let open: Open | null = null;
function shut() { open?.ov.close(); open = null; music(false, CN_THEME.cock); }
/** The screen's own music while it is open (長安's set, jq-music.ts CN_THEME), the background track again after. */
let themed = false;
function music(on: boolean, i: number) {
  if (on && !themed && audio.hasTheme(i)) { audio.theme(i); themed = true; }
  else if (!on && themed) { audio.restore(); themed = false; }
}

onStuck(shut);

function build(ctx: ScreenContext): Open {
  shut();
  const ov = fitOverlay(ctx.shell, 'cnk-ov', tall => (tall ? [900, 1600] : [1600, 900]), undefined, 0);
  ov.scene.classList.add('cn-scene', 'cnk-scene');
  music(true, CN_THEME.cock);
  cnPreload('crow', 'flap', 'peck', 'kick', 'whoosh', 'special', 'ko', 'cheer', 'boo', 'coins');
  ov.scene.innerHTML = `<div class="cnk-shake" style="background-image:url(${ART}/arena.webp)"><div class="cnk-dim"></div>
    <section class="cnk-bet">
      <div class="cn-frame cnk-status"><div class="cn-lbl"></div></div>
      <div class="cn-frame cnk-plaque"><div class="cn-lbl">鬥雞場</div></div>
      <div class="cnk-pair"></div><div class="cnk-cards"></div><div class="cnk-types"></div><div class="cnk-hint"></div>
      <div class="cnk-stake"></div>
      <div class="cnk-foot"><button class="cn-btn ghost cnk-leave">不押了</button><div class="cn-frame cnk-odds"><div class="cn-lbl"></div></div><button class="cn-btn cnk-go" disabled>下注開賽</button></div>
    </section>
    <section class="cnk-fight" hidden>
      <div class="cnk-hp l"><div class="n"></div><div class="track"><div class="fill"></div></div></div>
      <div class="cnk-hp r"><div class="n"></div><div class="track"><div class="fill"></div></div></div>
      <div class="cn-frame cnk-round"><div class="cn-lbl"></div></div>
      <div class="cnk-ck l"></div><div class="cnk-ck r"></div>
      <div class="cnk-darken"></div><div class="cnk-fx"></div>
      <div class="cn-card cnk-bracket"></div>
      <button class="cn-btn ghost cnk-skip">快轉 ▶▶</button>
    </section>
    <section class="cnk-res" hidden>
      <div class="cn-frame cnk-plaque"><div class="cn-lbl">賽　果</div></div>
      <div class="cnk-podium" style="background-image:url(${ART}/podium.webp)"></div>
      <div class="cnk-verdict"></div><div class="cnk-fx2"></div>
    </section></div>`;
  const $ = (s: string) => ov.scene.querySelector<HTMLElement>(s)!;
  open = { ov, $ };
  return open;
}

askScreens['cn-cock'] = (ctx, ask) => new Promise(resolve => {
  const a = ask as unknown as CockAsk, g = ctx.game, me = g.players[a.p];
  const o = build(ctx);
  o.$('.cnk-status .cn-lbl').textContent = `${g.name(a.p)}　${money(me?.cash ?? 0)}　點券 ${me?.points ?? 0}`;
  o.$('.cnk-pair').innerHTML = `今日對陣　上半區 <b>${nm(a.pairs[0][0])}</b> 對 <b>${nm(a.pairs[0][1])}</b>　　下半區 <b>${nm(a.pairs[1][0])}</b> 對 <b>${nm(a.pairs[1][1])}</b>`;
  let type: CockType = 'win', picks: number[] = [], stake: 'cash' | 'points' = a.canPoints ? 'points' : 'cash';
  const odds = (k: CockType, ps: number[]) => cockOdds(a.stars, a.pairs, k, ps);
  const fmt = (x: number) => (x ? `${x.toFixed(1)} 倍` : '—');
  o.$('.cnk-stake').innerHTML = `<button class="cn-btn" data-s="points"${a.canPoints ? '' : ' disabled'}><img src="${ART}/token-pts.webp" alt="">${a.points} 點券</button>`
    + `<button class="cn-btn" data-s="cash"${a.canCash ? '' : ' disabled'}><img src="${ART}/token-coins.webp" alt="">${money(a.cash)}</button>`;
  const draw = () => {
    o.$('.cnk-cards').innerHTML = ROOSTERS.map((r, i) => `<button class="cn-card cnk-card${picks.includes(i) ? ' sel' : ''}" data-i="${i}">
        <div class="cnk-no" style="background-image:url(${ART}/medal-round.webp)">${r.no}</div><div class="cnk-pick">${COCK_PICKS[type] > 1 && type !== 'quin' ? `第${'一二三'[picks.indexOf(i)] ?? ''}` : '押牠'}</div>
        <img class="ck" src="${pose(i, 'ready')}" alt=""><div class="cnk-nm">${r.name}</div><div class="cnk-stars">${stars(a.stars[i])}</div>
        <div class="cnk-od">獨贏 ${fmt(odds('win', [i]))}<br>絕招「${r.sp}」</div></button>`).join('');
    o.$('.cnk-types').innerHTML = COCK_TYPES.map(t => `<button class="cn-btn${t === type ? ' on' : ' ghost'}" data-k="${t}">${COCK_NAMES[t]}</button>`).join('');
    o.$('.cnk-hint').textContent = HINT[type];
    o.ov.scene.querySelectorAll<HTMLElement>('.cnk-stake button').forEach(b => b.classList.toggle('ghost', b.dataset.s !== stake));
    const ready = picks.length === COCK_PICKS[type], x = ready ? odds(type, picks) : 0, never = ready && !x;
    (o.$('.cnk-go') as HTMLButtonElement).disabled = !ready || never || !(stake === 'cash' ? a.canCash : a.canPoints);
    const st = stake === 'points' ? `${a.points} 點券` : money(a.cash), lbl = o.$('.cnk-odds .cn-lbl');
    if (!a.canCash && !a.canPoints) lbl.textContent = '點券和現金都不夠，下回再來吧';
    else if (never) lbl.textContent = '同一半區的兩隻不會同時進決賽，換一組吧';
    else if (ready) lbl.innerHTML = `${COCK_NAMES[type]} ${x.toFixed(1)} 倍　押 ${st}　中了得 <b>${stake === 'points' ? `${Math.round(a.points * x)} 點券` : money(a.cash * x)}</b>`;
    else lbl.textContent = `還要選 ${COCK_PICKS[type] - picks.length} 隻`;
    o.ov.scene.querySelectorAll<HTMLElement>('.cnk-card').forEach(c => { c.onclick = () => {
      const i = Number(c.dataset.i);
      if (picks.includes(i)) picks = picks.filter(x => x !== i);
      else if (picks.length < COCK_PICKS[type]) picks.push(i);
      else if (COCK_PICKS[type] === 1) picks = [i];
      audio.ui('click'); draw();
    }; });
    o.ov.scene.querySelectorAll<HTMLElement>('.cnk-types button').forEach(b => { b.onclick = () => { type = b.dataset.k as CockType; picks = picks.slice(0, COCK_PICKS[type]); audio.ui('click'); draw(); }; });
  };
  o.ov.scene.querySelectorAll<HTMLButtonElement>('.cnk-stake button').forEach(b => { b.onclick = () => { stake = b.dataset.s as typeof stake; audio.ui('click'); draw(); }; });
  o.$('.cnk-leave').onclick = () => { audio.ui('no'); shut(); resolve(null); };
  o.$('.cnk-go').onclick = () => { audio.ui('yes'); resolve({ type, picks: [...picks], stake }); };
  draw();
});

// ---------------------------------------------------------------- the fights
fxScreens['cn-cock-fight'] = async (ctx, fx) => {
  const d = fx.data as unknown as Fight;
  const o = d.human && open ? open : build(ctx);
  const tall = o.ov.isTall(), L = tall ? { W: 900, H: 1600, cx: 450, cy: 900, lx: 210, rx: 690, k: 0.8 } : { W: 1600, H: 900, cx: 800, cy: 560, lx: 510, rx: 1090, k: 1 };
  let fast = ctx.scale() < 0.5;
  const T = (ms: number) => (fast ? ms / 8 : ms) * Math.max(0.6, ctx.scale());
  const wait = (ms: number) => new Promise<void>(r => setTimeout(r, T(ms)));
  const alive = () => o.ov.root.isConnected;
  const fxl = o.$('.cnk-fx'), rnd = Math.random;
  const sprite = (src: string, x: number, y: number, w: number, frames: Keyframe[], dur: number, layer = fxl) => {
    const im = document.createElement('img'); im.className = 'cnk-fxi'; im.src = src; im.alt = '';
    Object.assign(im.style, { width: `${w}px`, left: `${x - w / 2}px`, top: `${y - w / 2}px` });
    layer.append(im);
    im.animate(frames, { duration: T(dur), easing: 'ease-out', fill: 'forwards' }).onfinish = () => im.remove();
  };
  const callout = (text: string, x: number, y: number, color?: string) => {
    const b = document.createElement('div'); b.className = 'cnk-callout'; b.textContent = text; Object.assign(b.style, { left: `${x}px`, top: `${y}px` });
    if (color) b.style.textShadow = `0 0 10px ${color}, 0 4px 0 #222`;
    fxl.append(b);
    b.animate([{ transform: 'translate(-50%,0) scale(.3)', opacity: 0 }, { transform: 'translate(-50%,-30px) scale(1.15)', opacity: 1, offset: 0.25 },
      { transform: 'translate(-50%,-70px) scale(1)', opacity: 0 }], { duration: T(900) }).onfinish = () => b.remove();
  };
  const feathers = (x: number, y: number, color: string, n = 12) => {
    for (let k = 0; k < n; k++) {
      const f = document.createElement('div'); f.className = 'cnk-feather'; Object.assign(f.style, { left: `${x}px`, top: `${y}px`, background: color });
      fxl.append(f);
      const a = rnd() * Math.PI * 2, dd = 90 + rnd() * 170;
      f.animate([{ transform: 'translate(0,0) rotate(0)', opacity: 1 }, { transform: `translate(${Math.cos(a) * dd}px,${Math.sin(a) * dd + 140}px) rotate(${rnd() * 720}deg)`, opacity: 0 }],
        { duration: T(1200), easing: 'ease-out' }).onfinish = () => f.remove();
    }
  };
  const shake = (px = 14) => o.$('.cnk-shake').animate([{ transform: 'translate(0,0)' }, { transform: `translate(${px}px,${-px / 2}px)` }, { transform: `translate(${-px}px,${px / 2}px)` },
    { transform: `translate(${px / 2}px,0)` }, { transform: 'translate(0,0)' }], { duration: T(320) });
  const setPose = (el: HTMLElement, i: number, p: string) => { el.style.backgroundImage = `url(${pose(i, p)})`; };

  const bout = async (title: string, a: number, b: number, aWins: boolean) => {
    o.$('.cnk-round .cn-lbl').textContent = title;
    o.$('.cnk-hp.l .n').textContent = `${nm(a)} ${ROOSTERS[a].name}`; o.$('.cnk-hp.r .n').textContent = `${nm(b)} ${ROOSTERS[b].name}`;
    const el = [o.$('.cnk-ck.l'), o.$('.cnk-ck.r')], who = [a, b], hp = [100, 100], used = [false, false];
    setPose(el[0], a, 'ready'); setPose(el[1], b, 'ready');
    const bar = () => { o.$('.cnk-hp.l .fill').style.width = `${hp[0]}%`; o.$('.cnk-hp.r .fill').style.width = `${hp[1]}%`; };
    bar();
    el[0].animate([{ transform: 'translateX(-700px)' }, { transform: 'translateX(0)' }], { duration: T(500), easing: 'ease-out' });
    el[1].animate([{ transform: 'scaleX(-1) translateX(-700px)' }, { transform: 'scaleX(-1) translateX(0)' }], { duration: T(500), easing: 'ease-out' });
    cnSound('crow', 0.7);
    await wait(450);
    sprite(`${ART}/vs.webp`, L.cx, L.cy - 160, 240, [{ transform: 'scale(.2) rotate(-30deg)', opacity: 0 }, { transform: 'scale(1.1)', opacity: 1, offset: 0.3 }, { transform: 'scale(1)', opacity: 1, offset: 0.8 }, { transform: 'scale(1.4)', opacity: 0 }], 1100);
    await wait(1100);
    const winner = aWins ? 0 : 1;
    let turn = rnd() < 0.5 ? 0 : 1, guard = 0;
    while (hp[0] > 0 && hp[1] > 0 && alive() && guard++ < 40) {
      const att = turn, def = 1 - turn; turn = def;
      const ea = el[att], ed = el[def], ia = who[att], id = who[def];
      const dir = att === 0 ? 1 : -1, flip = att === 0 ? '' : 'scaleX(-1) ', fdef = def === 0 ? '' : 'scaleX(-1) ';
      const special = !used[att] && (att === winner ? hp[att] < hp[def] || rnd() < 0.18 : rnd() < 0.1) && hp[def] > 20;
      const dodge = !special && rnd() < (def === winner ? 0.3 : 0.15);
      const kick = !special && rnd() < 0.4;
      const { cx, cy } = L;
      if (special) {
        used[att] = true;
        o.$('.cnk-darken').animate([{ opacity: 0 }, { opacity: 1, offset: 0.2 }, { opacity: 1, offset: 0.8 }, { opacity: 0 }], { duration: T(2200) });
        setPose(ea, ia, 'charge'); ea.style.zIndex = '3';
        ea.animate([{ transform: `${flip}scale(1)` }, { transform: `${flip}scale(1.15)`, filter: `drop-shadow(0 0 30px ${ROOSTERS[ia].color === '#203028' ? '#7fff9a' : '#ffd040'})` }, { transform: `${flip}scale(1)` }], { duration: T(1000) });
        const sp = document.createElement('div'); sp.className = 'cnk-special'; sp.textContent = ROOSTERS[ia].sp; fxl.append(sp);
        sp.animate([{ transform: 'scale(2.5)', opacity: 0 }, { transform: 'scale(1)', opacity: 1, offset: 0.25 }, { transform: 'scale(1)', opacity: 1, offset: 0.75 }, { transform: 'scale(.8)', opacity: 0 }], { duration: T(1500) }).onfinish = () => sp.remove();
        cnSound('special', 0.9); cnSound('flap', 0.6);
        await wait(1000);
        setPose(ea, ia, 'kick');
        ea.animate([{ transform: `${flip}translate(0,0)` }, { transform: `${flip}translate(${300 * L.k}px,-160px)` }, { transform: `${flip}translate(${380 * L.k}px,0)` }, { transform: `${flip}translate(0,0)` }], { duration: T(800), easing: 'ease-in-out' });
        await wait(420);
        sprite(`${ART}/${ROOSTERS[ia].fx}.webp`, cx + dir * 170, cy - 60, 460, [{ transform: 'scale(.3) rotate(-20deg)', opacity: 0 }, { transform: 'scale(1.1) rotate(0)', opacity: 1, offset: 0.3 }, { transform: 'scale(1.3)', opacity: 0 }], 1100);
        sprite(`${ART}/fx-impact.webp`, cx + dir * 220, cy - 40, 300, [{ transform: 'scale(.2)', opacity: 1 }, { transform: 'scale(1.3)', opacity: 0 }], 700);
        setPose(ed, id, 'hurt'); shake(22); cnSound('kick', 1); cnSound('cheer', 0.5); feathers(cx + dir * 220, cy - 40, ROOSTERS[id].color, 22);
        hp[def] = Math.max(def === winner ? 1 : 0, hp[def] - 45 - Math.floor(rnd() * 10));
        ea.style.zIndex = '';
      } else if (dodge) {
        setPose(ea, ia, kick ? 'kick' : 'peck');
        ea.animate([{ transform: `${flip}translate(0,0)` }, { transform: `${flip}translate(${240 * L.k}px,${kick ? -120 : 0}px)` }, { transform: `${flip}translate(0,0)` }], { duration: T(650), easing: 'ease-in-out' });
        await wait(250);
        setPose(ed, id, 'dodge'); cnSound('whoosh', 0.7); cnSound('flap', 0.5);
        ed.animate([{ transform: `${fdef}translate(0,0)` }, { transform: `${fdef}translate(${-140 * L.k}px,30px)` }, { transform: `${fdef}translate(0,0)` }], { duration: T(600) });
        sprite(`${ART}/fx-dust.webp`, cx - dir * 260, cy + 60, 220, [{ transform: 'scale(.5)', opacity: 1 }, { transform: 'scale(1.3)', opacity: 0 }], 700);
        callout('閃！', cx - dir * 280, cy - 260, '#4ac0ff');
      } else {
        setPose(ea, ia, kick ? 'kick' : 'peck');
        ea.animate([{ transform: `${flip}translate(0,0)` }, { transform: `${flip}translate(${(kick ? 200 : 150) * L.k}px,${kick ? -150 : -20}px)` }, { transform: `${flip}translate(${(kick ? 300 : 250) * L.k}px,0)` }, { transform: `${flip}translate(0,0)` }],
          { duration: T(kick ? 700 : 520), easing: 'ease-in-out' });
        await wait(kick ? 350 : 260);
        setPose(ed, id, 'hurt'); cnSound(kick ? 'kick' : 'peck', kick ? 0.9 : 0.8); if (kick) cnSound('flap', 0.5);
        ed.animate([{ transform: `${fdef}translate(0,0)` }, { transform: `${fdef}translate(-60px,-10px) rotate(-6deg)` }, { transform: `${fdef}translate(0,0)` }], { duration: T(400) });
        sprite(`${ART}/${kick ? 'fx-impact' : 'fx-spark'}.webp`, cx + dir * 160, cy - 80, kick ? 260 : 170, [{ transform: 'scale(.3)', opacity: 1 }, { transform: 'scale(1.2)', opacity: 0 }], 500);
        feathers(cx + dir * 160, cy - 60, ROOSTERS[id].color, kick ? 14 : 8);
        if (kick) shake(10);
        callout(kick ? '飛踢！' : ['啄！', '連啄！', '啄眼！'][Math.floor(rnd() * 3)], cx + dir * 120, cy - 300);
        hp[def] = Math.max(def === winner ? 1 : 0, hp[def] - (kick ? 22 : 12) - Math.floor(rnd() * 8));
      }
      if (hp[1 - winner] === 1 && def === 1 - winner) hp[def] = 0;
      bar();
      await wait(650);
      if (hp[0] > 0 && hp[1] > 0) { setPose(el[0], a, 'ready'); setPose(el[1], b, 'ready'); }
      if (hp[1 - winner] <= 1 && turn !== winner) turn = winner;
    }
    hp[1 - winner] = 0; bar();
    setPose(el[1 - winner], who[1 - winner], 'ko'); setPose(el[winner], who[winner], 'win');
    sprite(`${ART}/fx-dizzy.webp`, winner === 0 ? L.rx : L.lx, L.cy, 200, [{ transform: 'rotate(0)', opacity: 1 }, { transform: 'rotate(360deg)', opacity: 1, offset: 0.9 }, { opacity: 0 }], 1600);
    sprite(`${ART}/confetti.webp`, winner === 0 ? L.lx : L.rx, L.cy - 140, 360, [{ transform: 'scale(.3)', opacity: 1 }, { transform: 'scale(1.2)', opacity: 0 }], 1400);
    o.$('.cnk-round .cn-lbl').textContent = `${nm(who[winner])} 勝！`;
    cnSound('ko', 0.9); cnSound('cheer', 0.8); setTimeout(() => cnSound('crow', 0.6), 500 * Math.max(0.6, ctx.scale()));
    await wait(1700);
  };

  if (d.human) {
    o.$('.cnk-bet').hidden = true; o.$('.cnk-fight').hidden = false;
    o.$('.cnk-skip').onclick = () => { fast = true; };
    const lines = [`<b>半決賽一</b><br>${nm(d.bouts[0][0])} 對 ${nm(d.bouts[0][1])}`, `<b>半決賽二</b><br>${nm(d.bouts[1][0])} 對 ${nm(d.bouts[1][1])}`, '<b>季軍賽</b><br>？', '<b>決　賽</b><br>？'];
    const brk = () => { o.$('.cnk-bracket').innerHTML = lines.join('<br>'); };
    brk();
    const titles = ['半決賽一', '半決賽二', '季軍賽', '決　賽'];
    for (let k = 0; k < 4 && alive(); k++) {
      const [a, b, w] = d.bouts[k];
      if (k === 2) { lines[2] = `<b>季軍賽</b><br>${nm(a)} 對 ${nm(b)}`; lines[3] = `<b>決　賽</b><br>${nm(d.bouts[3][0])} 對 ${nm(d.bouts[3][1])}`; brk(); }
      await bout(titles[k], a, b, w === a);
      lines[k] += `<br>→ ${nm(w)}勝`; brk();
    }
    if (!alive()) return;
  }
  // ---------------------------------------------------------------- the podium and the verdict
  o.$('.cnk-bet').hidden = true; o.$('.cnk-fight').hidden = true; o.$('.cnk-res').hidden = false;
  const box = o.$('.cnk-podium'), W = box.offsetWidth, H = box.offsetHeight, r = 1471 / 957, pw = Math.min(W, H * r), ph = pw / r;
  const PX = (f: number) => (W - pw) / 2 + f * pw, PY = (f: number) => H - ph + f * ph;
  const SLOTS = [{ k: 1, x: 0.145, y: 0.465, f: 0.6 }, { k: 0, x: 0.405, y: 0.42, f: 0.585 }, { k: 2, x: 0.65, y: 0.525, f: 0.64 }, { k: 3, x: 0.875, y: 0.57, f: 0.665 }];
  box.innerHTML = SLOTS.map(s => { const i = d.rank[s.k]; return `
    <div class="cnk-pslot" style="left:${PX(s.x)}px;top:${PY(s.y)}px"><img class="ck${s.k === 0 ? ' boss' : ''}" alt="" src="${pose(i, [rnd() < 0.5 ? 'boss' : 'boss2', 'second', 'third', ['last', 'crutch', 'bandaid', 'brace'][Math.floor(rnd() * 4)]][s.k])}">
      ${s.k < 3 ? `<img class="ros" alt="" src="${ART}/rosette-${s.k + 1}.webp">` : ''}</div>
    <div class="cnk-ptag" style="left:${PX(s.x)}px;top:${PY(s.f)}px"><b>${'冠亞季殿'[s.k]}</b><br>${nm(i)} ${ROOSTERS[i].name}</div>`; }).join('');
  box.querySelectorAll<HTMLElement>('.cnk-pslot').forEach((p, n) => p.animate([{ transform: 'translate(-50%,-100%) translateY(-300px)', opacity: 0 }, { transform: 'translate(-50%,-100%)', opacity: 1 }],
    { duration: 500, delay: 200 + (3 - SLOTS[n].k) * 250, easing: 'cubic-bezier(.3,1.5,.5,1)', fill: 'backwards' }));
  const pickTxt = d.picks.map(nm).join(d.type === 'quin' ? '、' : ' → ');
  const unit = (x: number) => (d.stake === 'points' ? `${x} 點券` : money(x));
  const lost = d.stake === 'points' ? 10 : d.cash;
  const who = d.human ? '' : `${ctx.game.name(fx.p ?? 0)}　`;
  o.$('.cnk-verdict').innerHTML = d.hit
    ? `<img class="vicon" src="${ART}/win-pouch.webp" alt=""><div class="vbox"><div class="vtext win">押中了！得 ${unit(d.prize)}</div><div class="vsub">${who}${COCK_NAMES[d.type]}　${pickTxt}　${d.odds.toFixed(1)} 倍</div></div>`
    : `<img class="vicon" src="${ART}/lose-purse.webp" alt=""><div class="vbox"><div class="vtext lose">沒押中，血本無歸</div><div class="vsub">${who}${COCK_NAMES[d.type]}　${pickTxt}　輸掉 ${unit(lost)}</div></div>`;
  const vi = o.ov.scene.querySelector<HTMLElement>('.cnk-verdict .vicon')!;
  vi.animate([{ transform: 'scale(0) rotate(-40deg)' }, { transform: 'scale(1.25) rotate(8deg)', offset: 0.6 }, { transform: 'scale(1) rotate(0)' }], { duration: 600, delay: 1300, fill: 'backwards', easing: 'ease-out' });
  o.ov.scene.querySelector<HTMLElement>('.cnk-verdict .vbox')!.animate([{ transform: 'scale(.2)', opacity: 0 }, { transform: 'scale(1.1)', opacity: 1, offset: 0.7 }, { transform: 'scale(1)' }], { duration: 500, delay: 1500, fill: 'backwards' });
  const fx2 = o.$('.cnk-fx2');
  setTimeout(() => {
    if (!alive()) return;
    audio.ui(d.hit ? 'yes' : 'no');
    cnSound(d.hit ? 'cheer' : 'boo', 0.8); if (d.hit) cnSound('coins', 0.8);
    if (d.hit) {
      vi.style.animation = 'cnk-bob .7s ease-in-out infinite';
      for (let k = 0; k < 24; k++) setTimeout(() => alive() && sprite(`${ART}/${rnd() < 0.25 ? 'win-ingot' : 'token-coins'}.webp`, 60 + rnd() * (L.W - 120), -60, 70 + rnd() * 40,
        [{ transform: 'translateY(0) rotate(0)' }, { transform: `translateY(${L.H + rnd() * 100}px) rotate(${rnd() * 720 - 360}deg)` }], 1600 + rnd() * 800, fx2), k * 90);
    } else {
      vi.style.animation = 'cnk-wobble .5s ease-in-out 3';
      const ir = vi.getBoundingClientRect(), sr = o.ov.scene.getBoundingClientRect(), k = L.W / sr.width;
      sprite(`${ART}/rain-cloud.webp`, (ir.left + ir.width / 2 - sr.left) * k, (ir.top - sr.top) * k - 40, 200, [{ opacity: 0 }, { opacity: 1, offset: 0.3 }, { opacity: 1, offset: 0.9 }, { opacity: 0 }], 4000, fx2);
      sprite(`${ART}/lose-chick.webp`, tall ? 760 : 1400, tall ? 1330 : 720, 170, [{ transform: 'translateY(200px)', opacity: 0 }, { transform: 'translateY(0)', opacity: 1, offset: 0.2 }, { transform: 'rotate(-6deg)', offset: 0.5 }, { transform: 'rotate(6deg)', opacity: 1, offset: 0.8 }, { opacity: 0 }], 4000, fx2);
    }
  }, 1900);
  await new Promise<void>(r => setTimeout(r, Math.max(4200, 5200 * ctx.scale())));
  if (open === o) shut();
};
