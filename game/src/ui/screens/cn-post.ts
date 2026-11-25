/**
 * 長安's 驛站快馬 (core/changan.ts post, the user 2026-11-18; the mock rich4-redraw-company/changan/post-mock): the
 * question { t: 'cn-post', p, at, fare, can, dests } opens the post yard — the station master and his words, a little
 * map of the three stations (你在這裡), a card for each of the other two, 不騎了 / 騎快馬; the answer the square ridden
 * to (0: none). The screen stays up for the ride (fx 'cn-post-ride'): the big map, the road drawn in gold, the rider
 * galloping along it with the camera after him, then 抵達 …. A computer's ride shows the ride only. Landscape
 * 1600 × 900, upright 900 × 1600; drawn frames and buttons (cn-ui.css), no stretched pictures.
 */
import { askScreens, fxScreens, onStuck, type ScreenContext } from './registry';
import { fitOverlay } from './bank';
import { audio } from '../audio';
import { ASSETS } from '../assets';
import './cn-ui.css';
import './cn-post.css';

const ART = `${ASSETS}/maps/remake/changan/post`;
const money = (n: number) => `${Math.round(n).toLocaleString('en-US')} 文`;
const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
/** The stations on the post map (map.webp, 2000 × 959) and the roads between them. */
const AT: Record<string, [number, number]> = { 'post-w': [295, 497], 'post-c': [1155, 694], 'post-e': [1705, 295] };
const NAME: Record<string, string> = { 'post-w': '臨皋驛', 'post-c': '都亭驛', 'post-e': '長樂驛' };
const WAY: [number, number][] = [[295, 497], [330, 565], [470, 610], [615, 665], [800, 610], [1062, 540], [1155, 694]];
const WAY2: [number, number][] = [[1155, 694], [1062, 540], [1190, 497], [1380, 445], [1570, 385], [1640, 330], [1705, 295]];
const ORDER = ['post-w', 'post-c', 'post-e'];
function path(a: string, b: string): [number, number][] {
  const i = ORDER.indexOf(a), j = ORDER.indexOf(b);
  const one = (x: number, y: number) => (x === 0 && y === 1 ? WAY : x === 1 && y === 2 ? WAY2 : null);
  const p = one(i, j) ?? (one(j, i) ? [...one(j, i)!].reverse() : null);
  if (p) return p;
  const w = [...WAY.slice(0, -1), ...WAY2.slice(2)];   // 臨皋 ↔ 長樂: past 都亭's corner
  return i === 0 ? w : w.reverse();
}

interface PostAsk { t: 'cn-post'; p: number; at: string; fare: number; can: boolean; dests: { key: string; node: number; name: string; text: string }[] }
interface Open { ov: ReturnType<typeof fitOverlay>; $: (s: string) => HTMLElement }
let open: Open | null = null;
function shut() { open?.ov.close(); open = null; }
onStuck(shut);

function build(ctx: ScreenContext): Open {
  shut();
  const ov = fitOverlay(ctx.shell, 'cnp-ov', tall => (tall ? [900, 1600] : [1600, 900]), () => drawMini(), 0);
  ov.scene.classList.add('cn-scene', 'cnp-scene');
  ov.scene.innerHTML = `
    <section class="cnp-ask">
      <div class="cnp-yard" style="background-image:url(${ART}/yard.webp)"></div>
      <div class="cn-frame cnp-status"><div class="cn-lbl"></div></div>
      <div class="cn-frame cnp-plaque"><div class="cn-lbl cnp-title"></div></div>
      <img class="cnp-master" src="${ART}/station-master.webp" alt="">
      <div class="cn-frame cnp-say"><div class="cn-lbl cnp-words"></div></div>
      <div class="cnp-mini" style="background-image:url(${ART}/map.webp)"></div>
      <div class="cnp-dests"></div>
      <div class="cnp-foot"><button class="cn-btn ghost cnp-no">不騎了</button><button class="cn-btn cnp-go" disabled><img src="${ART}/ride-icon.webp" alt="">騎快馬</button></div>
    </section>
    <section class="cnp-ride" hidden>
      <div class="cnp-big" style="background-image:url(${ART}/map.webp)"><svg class="cnp-route" width="2000" height="959"></svg></div>
      <div class="cn-frame cnp-banner" hidden><div class="cn-lbl"></div></div>
      <div class="cnp-note" hidden></div>
    </section>`;
  const $ = (s: string) => ov.scene.querySelector<HTMLElement>(s)!;
  open = { ov, $ };
  return open;
}

let miniAt = '';
function drawMini() {
  if (!open) return;
  const mini = open.$('.cnp-mini'), sx = mini.offsetWidth / 2000, sy = mini.offsetHeight / 959;
  mini.innerHTML = ORDER.map(k => `<img class="cnp-pin${k === miniAt ? ' here' : ''}" src="${ART}/pin.webp" alt="" style="left:${AT[k][0] * sx}px;top:${AT[k][1] * sy - 8}px">` +
    (k === miniAt ? `<div class="cnp-here" style="left:${AT[k][0] * sx}px;top:${AT[k][1] * sy}px">你在這裡</div>` : '')).join('');
}

askScreens['cn-post'] = (ctx, ask) => new Promise(resolve => {
  const a = ask as unknown as PostAsk, g = ctx.game, me = g.players[a.p];
  const o = build(ctx);
  miniAt = a.at;
  o.$('.cnp-status .cn-lbl').textContent = `${g.name(a.p)}　現金 ${money(me?.cash ?? 0)}`;
  o.$('.cnp-title').textContent = NAME[a.at] ?? '驛站';
  o.$('.cnp-words').innerHTML = a.can
    ? `<div>客官一路辛苦！要換匹快馬嗎？<br>到別的驛站一趟 <b>${money(a.fare)}</b>，馬上就到。</div>`
    : `<div>客官，快馬一趟要 <b>${money(a.fare)}</b>，<br>您身上的盤纏不夠，下回再來吧。</div>`;
  let pick = 0;
  const dests = o.$('.cnp-dests');
  dests.innerHTML = a.dests.map(d => `<button class="cn-card cnp-dest${a.can ? '' : ' off'}" data-n="${d.node}"><img src="${ART}/station-gate.webp" alt=""><div class="nm">${d.name}</div><div class="ds">${d.text}</div></button>`).join('');
  const go = o.$('.cnp-go') as HTMLButtonElement;
  dests.querySelectorAll<HTMLElement>('.cnp-dest').forEach(c => {
    c.onclick = () => {
      if (!a.can) return;
      pick = Number(c.dataset.n); audio.ui('click');
      dests.querySelectorAll('.cnp-dest').forEach(x => x.classList.toggle('sel', x === c));
      go.disabled = false;
      go.innerHTML = `<img src="${ART}/ride-icon.webp" alt="">到${a.dests.find(d => d.node === pick)?.name ?? ''}`;
    };
  });
  o.$('.cnp-no').onclick = () => { audio.ui('no'); shut(); resolve(0); };
  go.onclick = () => { if (!pick) return; audio.ui('yes'); resolve(pick); };
  requestAnimationFrame(drawMini);
});

fxScreens['cn-post-ride'] = async (ctx, fx) => {
  const d = fx.data as { from: string; to: string; fare: number };
  const o = open ?? build(ctx);
  o.$('.cnp-ask').hidden = true; o.$('.cnp-ride').hidden = false;
  const big = o.$('.cnp-big'), pts = path(d.from, d.to), tall = o.ov.isTall(), W = tall ? 900 : 1600, H = tall ? 1600 : 900;
  const z = tall ? (H / 959) * 1.05 : 1.25;
  o.$('.cnp-route').innerHTML = `<polyline points="${pts.map(p => p.join(',')).join(' ')}" fill="none" stroke="#ffd36a" stroke-width="8" stroke-dasharray="18 12" stroke-linecap="round" opacity=".9"/>` +
    ORDER.map(k => `<image href="${ART}/pin.webp" x="${AT[k][0] - 26}" y="${AT[k][1] - 60}" width="52" height="60"/>`).join('');
  const rider = document.createElement('img'); rider.className = 'cnp-rider'; rider.src = `${ART}/rider-1.webp`; big.append(rider);
  const seg = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]));
  const total = seg.reduce((a, b) => a + b, 0), dur = Math.max(2000, total * 2.2) * ctx.scale();
  audio.ui('click');
  const t0 = performance.now(); let lastTrail = 0, frame = 0;
  await new Promise<void>(done => {
    const step = (now: number) => {
      if (!o.ov.root.isConnected) { done(); return; }
      const t = Math.min(1, (now - t0) / dur), e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      let dd = e * total, i = 0;
      while (i < seg.length - 1 && dd > seg[i]) { dd -= seg[i]; i++; }
      const f = seg[i] ? dd / seg[i] : 1, x = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f, y = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f;
      const left = pts[i + 1][0] < pts[i][0];
      rider.style.left = `${x}px`; rider.style.top = `${y}px`;
      rider.style.transform = `translate(-50%,-85%) ${left ? 'scaleX(-1)' : ''} translateY(${Math.sin(now / 60) * 6}px)`;
      if (++frame % 6 === 0) rider.src = `${ART}/rider-${rider.src.includes('rider-1') ? 2 : 1}.webp`;
      if (now - lastTrail > 90 && t < 0.97) {
        lastTrail = now;
        const tr = document.createElement('img'); tr.className = 'cnp-trail'; tr.src = `${ART}/fx-dust.webp`; tr.style.left = `${x}px`; tr.style.top = `${y - 10}px`;
        big.insertBefore(tr, rider);
        tr.animate([{ opacity: 0.9, transform: 'translate(-50%,-50%) scale(.6)' }, { opacity: 0, transform: 'translate(-50%,-60%) scale(1.8)' }], { duration: 900 }).onfinish = () => tr.remove();
      }
      const cx = Math.min(Math.max(W / 2 - x * z, W - 2000 * z), 0), cy = Math.min(Math.max(H / 2 - y * z, H - 959 * z), 0);
      big.style.transform = `translate(${cx}px,${cy}px) scale(${z})`;
      if (t < 1) requestAnimationFrame(step); else done();
    };
    requestAnimationFrame(step);
  });
  rider.src = `${ART}/rider-1.webp`;
  const banner = o.$('.cnp-banner'); banner.querySelector('.cn-lbl')!.textContent = `抵達 ${NAME[d.to] ?? ''}`; banner.hidden = false;
  const note = o.$('.cnp-note'); note.textContent = `付了 ${money(d.fare)}，本回合在這裡結束`; note.hidden = false;
  audio.ui('yes');
  await wait(Math.max(1600, 2400 * ctx.scale()));
  if (open === o) shut();
};
