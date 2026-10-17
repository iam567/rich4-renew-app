/**
 * The map's loading screen: the map's picture and name, a progress bar with its percentage and what is loading,
 * and a tip that changes every few seconds. It covers the game while the board is built behind it and its first
 * view is preloaded (ui/board-preload.ts), then fades away onto a complete board.
 */
import './loading.css';
import { phrases } from './text';

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

const TIPS = [
  '同一條街的土地買得越多，過路費收得越多。',
  '點券可以在道具店換道具，卡片可以在自己的回合使用。',
  '經過銀行時可以存款、提款，身上現金不夠時記得去領。',
  '輪到自己時可以拖動、旋轉地圖，點一下地圖可以查看地點資料。',
  '系統裡的「地圖」可以切換地面的畫風。',
  '房子蓋得越高，別人停下來要付的過路費越高。',
];

export class LoadingScreen {
  readonly el: HTMLElement;
  private bar: HTMLElement;
  private pct: HTMLElement;
  private what: HTMLElement;
  private tip: HTMLElement;
  private shown = 0;
  private timer = 0;
  private tipIndex = Math.floor(Math.random() * TIPS.length);

  /** `name`: the map (or the world) being loaded; `thumb`: its small picture (none: just the name). */
  constructor(name: string, thumb = '', sub = '') {
    this.el = document.createElement('div');
    this.el.className = 'boot';
    this.el.setAttribute('role', 'progressbar');
    this.el.setAttribute('aria-valuemin', '0');
    this.el.setAttribute('aria-valuemax', '100');
    this.el.innerHTML = `<div class="boot-bg"${thumb ? ` style="background-image:url('${esc(thumb)}')"` : ''}></div>
      <div class="boot-card">
        <div class="ribbon">載入地圖</div>
        ${thumb ? `<div class="boot-thumb"><img src="${esc(thumb)}" alt=""></div>` : ''}
        <div class="boot-name">${esc(name)}${sub ? `<small>${esc(sub)}</small>` : ''}</div>
        <div class="boot-track"><i class="boot-fill"></i><b class="boot-pct">0%</b></div>
        <div class="boot-what">準備中…</div>
        <div class="boot-tip"><span class="boot-tip-tag">小提示</span><span class="boot-tip-text"></span></div>
      </div>`;
    this.bar = this.el.querySelector('.boot-fill')!;
    this.pct = this.el.querySelector('.boot-pct')!;
    this.what = this.el.querySelector('.boot-what')!;
    this.tip = this.el.querySelector('.boot-tip-text')!;
    this.nextTip();
    // Stops by itself once the screen is gone (an error shown in its place).
    this.timer = window.setInterval(() => { if (this.el.isConnected) this.nextTip(); else clearInterval(this.timer); }, 4200);
  }

  private nextTip() {
    this.tip.innerHTML = phrases(TIPS[this.tipIndex++ % TIPS.length]);
  }

  /** Progress 0..1 (it never goes back) and, optionally, what is loading now. */
  progress(f: number, what?: string) {
    const v = Math.max(this.shown, Math.min(1, f));
    this.shown = v;
    const n = Math.floor(v * 100);
    this.bar.style.width = `${(v * 100).toFixed(1)}%`;
    this.pct.textContent = `${n}%`;
    this.el.setAttribute('aria-valuenow', String(n));
    if (what) this.what.textContent = what;
  }

  /** Fills the bar, fades out and removes the screen. */
  async close(): Promise<void> {
    this.progress(1, '完成');
    clearInterval(this.timer);
    this.el.classList.add('out');
    await new Promise(r => setTimeout(r, 280));
    this.el.remove();
  }

  /** Removes the screen at once (another screen replaced it, or an error is shown). */
  dispose() {
    clearInterval(this.timer);
    this.el.remove();
  }
}
