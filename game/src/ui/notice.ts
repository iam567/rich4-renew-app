/**
 * 系統公告 (the user 2026-11-08: a word to every player — a new version coming, how to update when it is blocked …): the
 * game asks the relay for the current notice when it opens and every few minutes after, and shows a new one once, at
 * the top, till its × is tapped. The request carries this install's random id and the version;
 * it never waits, never fails loudly.
 */
import { audio, Sfx } from './audio';
import { relays } from './net-peer';
import { deviceId } from './party-presence';
import { receiveGifts } from './spectate';
import { RUNNING } from './update';

const SEEN_KEY = 'rich4.notice.seen';
/** The gifts this install got (ids, the latest 50): each is added once, and said back so it leaves the queue. */
const GOT_KEY = 'rich4.gift.got';
const EVERY = 5 * 60_000;
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

let started = false;

const gotList = (): string[] => { try { const l = JSON.parse(localStorage.getItem(GOT_KEY) ?? '[]'); return Array.isArray(l) ? l.filter(x => typeof x === 'string') : []; } catch { return []; } };

async function check(again = false): Promise<void> {
  try {
    const url = (await relays())[0];
    if (!url) return;
    // (this install's random id, the version, and the gifts it got lately)
    const got = gotList();
    const q = new URLSearchParams({ dev: deviceId() ?? '', v: RUNNING, ...(got.length ? { got: got.slice(-20).join(',') } : {}) });
    const r = await fetch(`${url.replace(/^ws/, 'http').replace(/\/+$/, '')}/notice?${q}`, { cache: 'no-store' });
    if (!r.ok) return;
    const n = (await r.json()) as { id?: number; text?: string; gifts?: { id: string; g: string; n: number }[] };
    const fresh = (n.gifts ?? []).filter(x => x && typeof x.id === 'string' && !got.includes(x.id));
    if (fresh.length) {
      const lines = receiveGifts(fresh);
      try { localStorage.setItem(GOT_KEY, JSON.stringify([...got, ...fresh.map(x => x.id)].slice(-50))); } catch { /* added again next time */ }
      if (lines.length) gift(lines);
      if (!again) void check(true); // say so now: off the queue
    }
    if (document.querySelector('.sys-notice')) return; // one card at a time: the notice after the gifts' card
    if (!n.id || !n.text || localStorage.getItem(SEEN_KEY) === String(n.id)) return;
    show(n.id, n.text);
  } catch { /* not reached: the next time */ }
}

/** Gifts arrived: a card like the notice's, at the top till its × is tapped. */
function gift(lines: string[]) {
  const el = document.createElement('div');
  el.className = 'sys-notice sys-gift';
  el.innerHTML = `<button class="sys-notice-x" aria-label="關閉">×</button><b>收到禮物</b><p>${lines.map(esc).join('、')}</p><small>派對模式裡的「送禮物」可以送出去</small>`;
  el.querySelector<HTMLElement>('.sys-notice-x')!.onclick = e => {
    e.stopPropagation();
    el.classList.add('out');
    setTimeout(() => { el.remove(); void check(true); }, 400);
  };
  document.body.append(el);
  audio.sfx(Sfx.gift);
}

function show(id: number, text: string) {
  const el = document.createElement('div');
  el.className = 'sys-notice';
  el.innerHTML = `<button class="sys-notice-x" aria-label="關閉">×</button><b>系統公告</b><p>${esc(text)}</p>`;
  el.querySelector<HTMLElement>('.sys-notice-x')!.onclick = e => {
    e.stopPropagation();
    try { localStorage.setItem(SEEN_KEY, String(id)); } catch { /* shown again next time */ }
    el.classList.add('out');
    setTimeout(() => el.remove(), 400);
  };
  document.body.append(el);
}

/** From the title on: now, every few minutes, and when the game comes back to the front. */
export function watchNotices(): void {
  void check();
  if (started) return;
  started = true;
  setInterval(() => { if (!document.hidden) void check(); }, EVERY);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void check(); });
}
