/**
 * 歌舞伎町's announcements (docs/rules/21, core/kabukicho.ts):
 * - 'kb-incident' (§2.2–2.6): the incident card — its picture (maps/remake/events/<pic>.webp, the shop's plate when it
 *   is missing), the shop and the incident, then what happens to the visitor and to the owner with their faces. At least
 *   2 s (shorter at the fast game speed), a tap closes it after that; the rules then show the 'event-result' box.
 * - 'kb-hospital-wheel' (§2.2): the 0 / 1 / 2 / 3 天 wheel turning to the drawn days.
 * - small toasts for the rest (未成年謝絕入場, 女性顧客免費, 拉客仔, 店被砸了, 保鑣, 黑幫附身 / 離開, 違反暴力團對策法,
 *   確變骰子, the exclusive tools, 處理事務中): one at a time at the top, gone by themselves. Most come with a 'say'
 *   line of the rules, so the game goes on while they show; 確變骰子 and 違反暴力團對策法 hold the game until read.
 */
import { CHARACTERS } from '../../core/characters';
import { isKbShop } from '../../core/modules/kb-data';
import { fxScreens, type ScreenContext } from './registry';
import { fitOverlay } from './bank';
import { esc } from './place-scene';
import { RESULT_MIN_MS } from './event-result';
import { regionalPictureUrl } from './regional';
import { KB_PLATE } from './kb-shop';
import { toolIconSrc } from './kb-exchange';
import { fmt } from './kb-machine';
import { audio, Sfx } from '../audio';
import './kb-fx.css';

type Fx = Parameters<(typeof fxScreens)[string]>[1];

const faceImg = (ctx: ScreenContext, p: number | undefined, cls = '') => {
  const ch = p !== undefined ? CHARACTERS[ctx.game.players[p]?.character ?? -1] : undefined;
  const a = ch ? ctx.bank.art('Data', 2, ch.id) : null;
  return a ? `<img class="${cls}" src="${a.src}" alt="" style="--c:#${ch!.color.toString(16).padStart(6, '0')}">` : '';
};
const who = (ctx: ScreenContext, p: number | undefined) => (p !== undefined ? CHARACTERS[ctx.game.players[p]?.character ?? -1]?.name ?? '' : '');

// ------------------------------------------------------------------ the incident card

fxScreens['kb-incident'] = (ctx, fx) => {
  const d = fx.data ?? {};
  const pic = typeof d.pic === 'string' && /^[a-z0-9-]+$/.test(d.pic) ? regionalPictureUrl(d.pic) : '';
  const ft = ctx.game.board.facilities[Number(d.facility) - 1]?.type ?? 10, type = isKbShop(ft) ? ft : 10;
  const ov = fitOverlay(ctx.area, 'kbi-ov', () => [440, 540], undefined, 16);
  const { scene, root } = ov;
  scene.classList.add('kbi-scene');
  const row = (label: string, p: number | undefined, text: unknown, cls: string) =>
    `<div class="kbi-row ${cls}"><span class="kbi-face">${faceImg(ctx, p)}</span><span class="kbi-who"><i>${label}</i><b>${esc(who(ctx, p))}</b></span><span class="kbi-text">${esc(String(text ?? ''))}</span></div>`;
  scene.innerHTML = `<div class="kbi-card">
      <div class="kbi-head"><span class="kbi-shop">${esc(String(d.name ?? ''))}${esc(String(d.shop ?? ''))}</span><span class="kbi-tag">店內事件</span></div>
      <div class="kbi-title">${esc(String(d.title ?? ''))}</div>
      <div class="kbi-pic"><img class="kbi-plate" src="${KB_PLATE(type)}" alt="">${pic ? `<img class="kbi-img" src="${pic}" alt="">` : ''}</div>
      ${row('訪客', fx.p, d.visitor, 'visitor')}${row('店主', fx.target, d.owner, 'owner')}
      <div class="kbi-tap">點一下繼續</div>
    </div>`;
  // A missing picture leaves the shop's plate on its colours.
  const img = scene.querySelector<HTMLImageElement>('.kbi-img');
  if (img) img.onerror = () => img.remove();
  audio.sfx(Sfx.special);
  const total = Math.max(1600, 3600 * ctx.scale()), tapAfter = Math.min(RESULT_MIN_MS, total * 0.6);
  return new Promise<void>(resolve => {
    let done = false;
    const end = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      root.classList.add('out');
      setTimeout(() => { ov.close(); resolve(); }, 180);
    };
    const timer = setTimeout(end, total);
    setTimeout(() => { if (!done) { root.classList.add('can-close'); root.addEventListener('pointerup', end); } }, tapAfter);
  });
};

// ------------------------------------------------------------------ the hospital wheel (0–3 天)

fxScreens['kb-hospital-wheel'] = (ctx, fx) => {
  const days = Math.max(0, Math.min(3, Number(fx.data?.days) || 0));
  const COLORS = ['#5ad07a', '#ffd23f', '#ff9f1c', '#ff4a6a'];
  // Four quarters from the top, clockwise: cell i is centred at i·90 + 45°; the pointer is at the top.
  const cells = [0, 1, 2, 3].map(i => {
    const a0 = (i * 90 - 90) * Math.PI / 180, a1 = ((i + 1) * 90 - 90) * Math.PI / 180, am = (a0 + a1) / 2;
    const p = (a: number, r: number) => `${(100 + r * Math.cos(a)).toFixed(1)} ${(100 + r * Math.sin(a)).toFixed(1)}`;
    return `<path d="M100 100 L${p(a0, 96)} A96 96 0 0 1 ${p(a1, 96)} Z" fill="${COLORS[i]}" stroke="#fff" stroke-width="4"/>
      <text x="${p(am, 60).split(' ')[0]}" y="${p(am, 60).split(' ')[1]}" text-anchor="middle" dominant-baseline="central" transform="rotate(${i * 90 + 45} ${p(am, 60)})">${i} 天</text>`;
  }).join('');
  const node = document.createElement('div');
  node.className = 'msg kbw-box';
  node.innerHTML = `<div class="ribbon">${faceImg(ctx, fx.p, 'kbw-face')}住院轉盤</div>
    <div class="kbw-wheel"><svg viewBox="0 0 200 200" class="kbw-rotor">${cells}<circle cx="100" cy="100" r="16" fill="#fff" stroke="#2a1250" stroke-width="4"/></svg><i class="kbw-pointer"></i></div>
    <div class="kbw-res">&nbsp;</div>`;
  ctx.open(node);
  const rotor = node.querySelector<SVGElement>('.kbw-rotor')!, res = node.querySelector<HTMLElement>('.kbw-res')!;
  const spin = Math.max(700, 1500 * ctx.scale());
  rotor.style.transition = `transform ${spin}ms cubic-bezier(.2, .7, .25, 1)`;
  audio.sfx(Sfx.wheel, true);
  return new Promise<void>(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(() => { rotor.style.transform = `rotate(${360 * 4 - (days * 90 + 45)}deg)`; }));
    setTimeout(() => {
      audio.stop(Sfx.wheel);
      audio.sfx(days ? Sfx.ambulance : Sfx.points);
      res.textContent = days ? `住院 ${days} 天` : '0 天：沒事！';
      res.classList.add(days ? 'bad' : 'good');
      setTimeout(() => { ctx.close(); resolve(); }, Math.max(500, 900 * ctx.scale()));
    }, spin + 60);
  });
};

// ------------------------------------------------------------------ toasts

let current: HTMLElement | null = null;

/** A small banner at the top, one at a time; resolves at once (`hold`: when it has been read). */
function toast(ctx: ScreenContext, fx: Fx, cls: string, title: string, sub = '', extra = '', hold = false): Promise<void> {
  current?.remove();
  const el = document.createElement('div');
  el.className = `kbt ${cls.split(' ').map(c => `kbt-${c}`).join(' ')}`;
  el.innerHTML = `${faceImg(ctx, fx.p, 'kbt-face')}<span class="kbt-body"><b>${esc(title)}</b>${extra}${sub ? `<small>${esc(sub)}</small>` : ''}</span>`;
  // On the page itself (the game screen may be scaled, which would move a fixed box), as the casino's toasts.
  document.body.append(el);
  current = el;
  const ms = (hold ? 1600 : 1200) * Math.max(0.6, ctx.scale());
  setTimeout(() => { el.classList.add('out'); setTimeout(() => { el.remove(); if (current === el) current = null; }, 300); }, ms);
  return new Promise(r => setTimeout(r, hold ? ms : 250));
}

fxScreens['kb-refused'] = (ctx, fx) => toast(ctx, fx, 'info', '未成年，謝絕入場', String(fx.data?.shop ?? ''));
fxScreens['kb-free'] = (ctx, fx) => toast(ctx, fx, 'good', '女性顧客免費！', String(fx.data?.shop ?? ''));
fxScreens['kb-tout'] = (ctx, fx) => (fx.data?.ok
  ? toast(ctx, fx, 'bad', '被拉客仔拉進店裡！', String(fx.data?.name ?? ''))
  : toast(ctx, fx, 'info', '拉客仔搭訕失敗', '沒有店可以去'));
fxScreens['kb-smash'] = (ctx, fx) => { audio.sfx(Sfx.smallBlast); return toast(ctx, fx, 'bad', '店被砸了！', `${who(ctx, fx.target)}付不出保護費${fx.data?.hit ? '・降一級' : ''}`); };
fxScreens['kb-bodyguard'] = (ctx, fx) => toast(ctx, fx, 'good', '保鑣出動！', fx.data?.why === 'gang' ? '擋掉了保護費' : `擋下「${String(fx.data?.incident ?? '')}」`);
fxScreens['kb-gang'] = (ctx, fx) => (fx.data?.on
  ? toast(ctx, fx, 'gang', '黑幫附身！', '七天內停在對手的地上收保護費')
  : toast(ctx, fx, 'info', '黑幫離開了'));
fxScreens['kb-gang-arrest'] = (ctx, fx) => {
  audio.sfx(Sfx.police);
  return toast(ctx, fx, 'bad big', '違反暴力團對策法！', '附身結束', `<span class="kbt-line">保護費 <em>${fmt(Number(fx.data?.take) || 0)}元</em> 沒收・坐牢 7 天</span>`, true);
};
fxScreens['kb-kakuhen'] = (ctx, fx) => {
  const vals = Array.isArray(fx.data?.values) ? (fx.data.values as number[]) : [];
  const drop = Number(fx.data?.drop);
  const dice = `<span class="kbt-dice">${vals.map((v, i) => `<i class="${i === drop ? 'drop' : ''}">${v}</i>`).join('')}</span>`;
  const steps = vals.reduce((a, v, i) => a + (i === drop ? 0 : v), 0);
  return toast(ctx, fx, 'good big', '確變骰子', `${vals[drop] ?? ''} 不算・走 ${steps} 步`, dice, true);
};
const TOOL_LINE: Record<number, [string, string]> = {
  17: ['確變骰子', '這回合多擲一顆，挑一顆不算'], 18: ['計程車券', '這回合擲 3 顆骰子'], 20: ['霓虹燈箱點亮！', '7 天內收費 ×1.5'],
};
fxScreens['kb-tool'] = (ctx, fx) => {
  const id = Number(fx.data?.tool), line = TOOL_LINE[id];
  if (!line) return Promise.resolve();
  audio.sfx(Sfx.cardUse);
  const src = toolIconSrc(ctx, id);
  return toast(ctx, fx, 'good', line[0], line[1], src ? `<img class="kbt-tool" src="${src}" alt="">` : '');
};
fxScreens['kb-busy'] = (ctx, fx) => {
  const n = Number(fx.data?.turns) || 0;
  return toast(ctx, fx, 'busy', '處理事務中', fx.data?.sitting ? `跳過這回合${n ? `・還剩 ${n} 回合` : ''}` : `${who(ctx, fx.p)}要停 ${n} 回合`);
};
