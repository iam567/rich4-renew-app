/**
 * 長安's 貢院 (core/changan.ts exam; the user 2026-11-18/19; the mock tools/tycoon-art/changan_exam_mock.py): the question
 * { t: 'cn-exam', p, tier, q, order, secs, run, prize } opens the examination hall — the examiner beside an unrolled 宣紙
 * scroll; the question written top to bottom in brush (its tier in red), the four answers 甲 乙 丙 丁, a stick of incense
 * burning down the seconds; the answer the bank index picked (0 is right; -1 the time ran out). The result (fx
 * 'cn-exam-result'): only the right answer stays, ringed in cinnabar, its note beside it on the same paper; a tap
 * anywhere (or a few seconds) and the rank's picture comes up behind a big badge (升為探花 +5,000 文 / 落第). A
 * computer's visit shows the badge only. Landscape 1600 × 900, upright 900 × 1600 (a hanging scroll for the question,
 * the answers on a scroll below).
 */
import { askScreens, fxScreens, onStuck, type ScreenContext } from './registry';
import { fitOverlay } from './bank';
import { audio } from '../audio';
import { ASSETS } from '../assets';
import { CHARACTERS } from '../../core/characters';
import { EXAM_RANKS } from '../../core/changan';
import { CN_THEME } from '../jq-music';
import { cnSound } from '../cn-sound';
import './cn-ui.css';
import './cn-exam.css';

const ART = `${ASSETS}/maps/remake/changan/exam`;
/** 清明上河's 貢院 (core/qingming.ts exam, set 'qingming'): the Song banks and the Song examiner; the rest is 長安's hall. */
const QM_ART = `${ASSETS}/maps/remake/qingming/exam`;
const setArt = (set?: string) => (set === 'qingming' ? QM_ART : ART);
const money = (n: number) => `${Math.round(n).toLocaleString('en-US')} 文`;
const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const STEMS = ['甲', '乙', '丙', '丁'];
/** Brackets for vertical writing (the brush font has no vertical forms of its own; 「」 turn by text-orientation). */
const vert = (t: string) => t.replace(/《/g, '︽').replace(/》/g, '︾').replace(/〈/g, '︿').replace(/〉/g, '﹀');
const BADGE = ['badge-9741', 'badge-9742', 'badge-9743', 'badge-9744', 'badge-9745'];

interface Question { q: string; options: string[]; note: string }
const banks = new Map<string, Promise<Question[]>>();
const bank = (tier: number, set?: string) => {
  const key = `${set ?? ''}:${tier}`;
  let b = banks.get(key);
  if (!b) { b = fetch(`${setArt(set)}/tier${tier}.json`).then(r => r.json() as Promise<Question[]>); banks.set(key, b); b.catch(() => banks.delete(key)); }
  return b;
};

interface ExamAsk { t: 'cn-exam'; p: number; tier: number; q: number; order: number[]; secs: number; run: number; prize: number; set?: string; off?: number[]; god?: string }
interface Open { ov: ReturnType<typeof fitOverlay>; $: (s: string) => HTMLElement; question?: Question; order?: number[] }
let open: Open | null = null;
function shut() { open?.ov.close(); open = null; music(false, CN_THEME.exam); }
/** The screen's own music while it is open (長安's set, jq-music.ts CN_THEME), the background track again after. */
let themed = false;
function music(on: boolean, i: number) {
  if (on && !themed && audio.hasTheme(i)) { audio.theme(i); themed = true; }
  else if (!on && themed) { audio.restore(); themed = false; }
}

onStuck(shut);

function status(ctx: ScreenContext, p: number, run: number): string {
  const ch = CHARACTERS[ctx.game.players[p]?.character ?? 0], face = ch ? ctx.bank.art('Data', 2, ch.id) : null;
  const title = EXAM_RANKS[Math.max(0, Math.min(run, 5) - 1)];
  return `${face ? `<img src="${face.src}" alt="">` : ''}<span>${esc(ctx.game.name(p))}</span><span>${title}</span><span>${run ? `連中 ${run} 次` : '初次應試'}</span>`;
}

function build(ctx: ScreenContext, set?: string): Open {
  shut();
  const ov = fitOverlay(ctx.shell, 'cne-ov', tall => (tall ? [900, 1600] : [1600, 900]), undefined, 0);
  ov.scene.classList.add('cn-scene', 'cne-scene');
  music(true, CN_THEME.exam);
  ov.scene.innerHTML = `
    <div class="cne-bg" style="background-image:url(${ART}/hall.webp)"></div>
    <div class="cne-status"></div>
    <img class="cne-examiner" src="${setArt(set)}/examiner.webp" alt="">
    <div class="cne-qscroll" data-nozh style="background-image:url(${ART}/scroll-tall.webp)"><div class="cne-tag">貢　院</div><div class="cne-q"><i class="cne-tier"></i><b class="cne-qtext"></b></div></div>
    <div class="cne-scroll" data-nozh style="background-image:url(${ART}/scroll-wide.webp)">
      <div class="cne-tag">貢　院</div>
      <div class="cne-paper"><div class="cne-q"><i class="cne-tier"></i><b class="cne-qtext"></b></div><div class="cne-opts"></div><div class="cne-note"></div></div>
    </div>
    <div class="cne-incense"><i class="smoke"></i><i class="stick"></i><i class="bowl"></i><span></span></div>
    <div class="cne-hint" hidden>點擊螢幕任意位置繼續</div>
    <div class="cne-result" hidden><div class="cne-scene-pic"></div><div class="cne-badge" data-nozh><img alt=""><b></b><em></em></div><div class="cne-fx"></div></div>`;
  const $ = (s: string) => ov.scene.querySelector<HTMLElement>(s)!;
  open = { ov, $ };
  return open;
}

askScreens['cn-exam'] = (ctx, ask) => new Promise(resolve => {
  const a = ask as unknown as ExamAsk;
  const o = build(ctx, a.set);
  const off = a.off ?? [];
  o.$('.cne-status').innerHTML = `${status(ctx, a.p, a.run)}${off.length ? `<span class="cne-god">${esc(a.god ?? '神明')}相助：去掉${off.length}個錯的</span>` : ''}`;
  o.ov.scene.querySelectorAll('.cne-tier').forEach(e => { e.textContent = `${EXAM_RANKS[a.tier - 1]}題`; });
  audio.ui('click');
  void bank(a.tier, a.set).then(list => {
    if (open !== o) return;
    const qn = list[a.q] ?? list[0];
    o.question = qn; o.order = a.order;
    // the question as one block in the upright scroll (portrait) and on the paper (landscape): the same element
    o.ov.scene.querySelectorAll('.cne-qtext').forEach(e => { e.textContent = vert(qn.q); });
    // the question fitted to its paper (smaller until it does not run past it)
    requestAnimationFrame(() => o.ov.scene.querySelectorAll<HTMLElement>('.cne-qtext').forEach(e => {
      const box = e.parentElement!;
      e.style.fontSize = '';
      let f = parseFloat(getComputedStyle(e).fontSize);
      for (let i = 0; i < 30 && (box.scrollWidth > box.clientWidth + 1 || e.scrollHeight > box.clientHeight + 1); i++) { f -= 2; e.style.fontSize = `${f}px`; }
    }));
    // every answer in one column at one size: smaller until the longest fits the paper's height
    requestAnimationFrame(() => {
      const opts = o.ov.scene.querySelector<HTMLElement>('.cne-opts')!, spans = [...opts.querySelectorAll<HTMLElement>('.cne-opt span')];
      let k = 1;
      const over = () => spans.some(sp => { const b = sp.closest('button')!; return b.scrollHeight > opts.clientHeight + 1; });
      for (let i = 0; i < 20 && over(); i++) { k -= 0.05; o.ov.scene.style.setProperty('--opt-k', String(k)); }
    });
    o.$('.cne-opts').innerHTML = a.order.map((k, i) => `<button class="cne-opt${off.includes(k) ? ' off' : ''}" data-k="${k}"${off.includes(k) ? ' disabled' : ''}><i>${STEMS[i]}</i><span>${esc(vert(qn.options[k] ?? ''))}</span></button>`).join('');
    let done = false, left = a.secs;
    const inc = o.$('.cne-incense'), label = inc.querySelector('span')!;
    inc.style.setProperty('--secs', `${a.secs}s`);
    inc.classList.add('burn');
    const show = () => { label.textContent = `一炷香　剩 ${left} 秒`; };
    show();
    const pick = (k: number) => {
      if (done) return;
      done = true; clearInterval(tick); inc.classList.remove('burn'); inc.classList.add('out');
      o.ov.scene.querySelectorAll<HTMLElement>('.cne-opt').forEach(b => b.classList.toggle('picked', Number(b.dataset.k) === k));
      audio.ui(k >= 0 ? 'yes' : 'no');
      resolve(k);
    };
    o.ov.scene.querySelectorAll<HTMLButtonElement>('.cne-opt').forEach(b => { b.onclick = () => pick(Number(b.dataset.k)); });
    const tick = window.setInterval(() => { if (!o.ov.root.isConnected) { clearInterval(tick); return; } if (--left <= 0) pick(-1); else show(); }, 1000);
  }).catch(() => resolve(-1));
});

interface Result { right: boolean; tier: number; q: number; order: number[]; run: number; prize: number; was: string; title: string; scene: string; human: boolean; set?: string }

fxScreens['cn-exam-result'] = async (ctx, fx) => {
  const d = fx.data as unknown as Result;
  let o = open;
  if (o && d.human && o.question) {
    // the paper: only the right answer, ringed in cinnabar, its note beside it
    const opts = o.$('.cne-opts');
    opts.querySelectorAll<HTMLElement>('.cne-opt').forEach(b => { if (Number(b.dataset.k) !== 0) b.classList.add('gone'); else b.classList.add('right'); });
    await wait(450);
    opts.classList.add('answered');
    const right = opts.querySelector<HTMLElement>('.cne-opt.right');
    if (right) {
      // the ring round the answer's words (an oval narrows at its ends: about a character beyond the first and last)
      const span = right.querySelector('span')!, rb = right.getBoundingClientRect(), sb = span.getBoundingClientRect();
      const ring = document.createElement('img'); ring.className = 'cne-ring'; ring.src = `${ART}/cinnabar-oval.webp`; ring.alt = '';
      if (rb.height) {
        ring.style.setProperty('--ry', `${(((sb.top + sb.bottom) / 2 - rb.top) / rb.height) * 100}%`);
        ring.style.setProperty('--rh', `${Math.min(100, ((sb.height + sb.width * 2.2) / rb.height) * 100)}%`);
      }
      right.append(ring);
    }
    const note = o.$('.cne-note'), paper = o.$('.cne-paper');
    note.style.setProperty('--note-h', `${paper.clientHeight}px`);   // (wraps into columns within the paper)
    note.textContent = vert(o.question.note ?? '');
    note.classList.add('on');
    audio.ui(d.right ? 'yes' : 'no');
    const hint = o.$('.cne-hint'); hint.hidden = false;
    await new Promise<void>(res => {
      const t = window.setTimeout(res, 7000 * Math.max(0.6, ctx.scale()));
      o!.ov.root.addEventListener('pointerup', () => { clearTimeout(t); res(); }, { once: true });
    });
    hint.hidden = true;
  } else {
    o = build(ctx, d.set);
    o.ov.scene.classList.add('only-result');
    o.$('.cne-status').innerHTML = status(ctx, fx.p ?? 0, d.run);
  }
  // the badge over the rank's picture
  const res = o.$('.cne-result'); res.hidden = false;
  o.$('.cne-scene-pic').style.backgroundImage = `url(${ART}/${d.scene}.webp)`;
  const img = res.querySelector<HTMLImageElement>('.cne-badge img')!;
  img.src = `${ART}/${d.right ? BADGE[d.tier - 1] : 'badge-9746'}.webp`;
  res.querySelector('.cne-badge b')!.textContent = d.right ? (d.tier === 1 ? '答對了！' : d.tier === 5 && d.run > 5 ? '蟬聯狀元' : `升為${EXAM_RANKS[d.tier - 1]}`) : d.was !== '平民' ? '落第！' : '答錯了…';
  res.querySelector('.cne-badge em')!.textContent = d.right ? `+${money(d.prize)}` : d.was !== '平民' ? `${d.was}打回平民` : '下回再來';
  res.classList.toggle('lose', !d.right);
  res.classList.add('in');
  if (d.right) {
    const fxl = o.$('.cne-fx'), tall = o.ov.isTall(), W = tall ? 900 : 1600, H = tall ? 1600 : 900;
    for (let k = 0; k < 18; k++) setTimeout(() => {
      if (!fxl.isConnected) return;
      const im = document.createElement('img'); im.className = 'cne-coin'; im.src = `${ART}/${k % 3 ? 'badge-9747' : 'badge-9748'}.webp`; im.alt = '';
      const w = 60 + Math.random() * 50; Object.assign(im.style, { width: `${w}px`, left: `${80 + Math.random() * (W - 160)}px`, top: '-80px' });
      fxl.append(im);
      im.animate([{ transform: 'translateY(0) rotate(0)' }, { transform: `translateY(${H + 160}px) rotate(${Math.random() * 540 - 270}deg)` }], { duration: 1800 + Math.random() * 700, easing: 'ease-in', fill: 'forwards' }).onfinish = () => im.remove();
    }, k * 90);
  }
  audio.ui(d.right ? 'yes' : 'no');
  if (d.right) { cnSound('cheer', 0.6); cnSound('coins', 0.7); } else cnSound('boo', 0.6);
  await wait(Math.max(2400, 3200 * ctx.scale()));
  if (open === o) shut();
};
