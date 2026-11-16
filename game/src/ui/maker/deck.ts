/**
 * 自建地圖's 新聞命運卡 (the user 2026-11-12): the map's own deck picked from the library (core/modules/general-cards.ts):
 * up to 30 news and 30 fate, at least 10 of each once any are picked (none: the original 73). A card's headline may be
 * rewritten — its first line only; the effect, the amounts and the days stay the game's (「效果不改，只改字兒」).
 */
import { library } from '../../core/modules/general-cards';
import { audio } from '../audio';
import { t as tr } from '../lang';
import { regionalPictureUrl } from '../screens/regional';
import { fatePicture, newsPicture } from '../screens/news';

/** The original pictures (the game's art bank, set by main.ts): the original news / fate as the game shows them. */
let origArt: ((id: number) => string | null) | null = null;
export const setOrigArt = (f: (id: number) => string | null) => { origArt = f; };
/** An original entry's picture (o-n-N / o-f-N), as the board shows it on the original maps (fate's on map slot 0). */
const origPic = (id: string) => {
  const m = /^o-([nf])-(\d+)$/.exec(id);
  if (!m || !origArt) return null;
  const pid = m[1] === 'n' ? newsPicture(Number(m[2])) : fatePicture(Number(m[2]), 0);
  return pid ? origArt(pid) : null;
};
import type { MakerMap } from './model';

export const DECK_MAX = 30, DECK_MIN = 10;
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Opens the sheet over `root`; `changed` after every change (the editor saves at once). */
export function deckSheet(root: HTMLElement, m: MakerMap, changed: () => void) {
  m.deck ??= { news: [], fate: [], words: {} };
  const deck = m.deck;
  let kind: 'news' | 'fate' = 'news';
  const ov = document.createElement('div');
  ov.className = 'slots-overlay mk-ov mk-deck-ov';
  ov.innerHTML = `<div class="msg sheet mk-deck"><div class="ribbon">新聞命運卡</div>
    <div class="mk-deck-top"><div class="chips"><button class="chip on" data-k="news">新聞</button><button class="chip" data-k="fate">命運</button></div>
      <span class="mk-deck-count"></span><button class="chip" data-d="clear">全部取消</button><button class="chip" data-d="auto">隨機挑 30 張</button></div>
    <p class="mk-deck-hint">勾選這張地圖要用的卡（每種最多 ${DECK_MAX} 張、至少 ${DECK_MIN} 張；都不選就用原版的卡）。標題可以改，效果和金額不能改。</p>
    <div class="mk-deck-list"></div>
    <div class="choices"><button class="candy yes" data-d="ok">好</button></div></div>`;
  root.append(ov);
  const list = ov.querySelector<HTMLElement>('.mk-deck-list')!, count = ov.querySelector<HTMLElement>('.mk-deck-count')!;
  const picked = () => (kind === 'news' ? deck.news : deck.fate);
  function draw() {
    const on = new Set(picked());
    count.textContent = `已選 ${on.size}／${DECK_MAX}`;
    count.classList.toggle('warn', on.size > 0 && on.size < DECK_MIN);
    list.innerHTML = library(kind).map(c => {
      const op = c.card ? null : origPic(c.id);
      const pic = c.card ? `<img loading="lazy" src="${regionalPictureUrl(c.card.art)}" alt="">` : op ? `<img loading="lazy" src="${op}" alt="">` : `<i class="mk-deck-orig">原版</i>`;
      const text = c.card ? esc((c.card.text.includes('\n') ? c.card.text.split('\n').slice(1).join(' ') : c.card.text).replace(/\{amount\}/g, '…').replace(/\{street\}|\{lot\}/g, '某地').replace(/\{s\d+\}/g, '某股')) : '';
      return `<label class="mk-deck-row${on.has(c.id) ? ' on' : ''}${c.tone === 'bad' ? ' bad' : ''}"><input type="checkbox" data-id="${c.id}"${on.has(c.id) ? ' checked' : ''}>${pic}
        <span class="mk-deck-main"><input class="mk-deck-name" data-w="${c.id}" maxlength="16" value="${esc(deck.words?.[c.id] ?? tr(c.name))}">${c.isNew ? '<b class="mk-tag">新</b>' : ''}<small>${text}</small></span></label>`;
    }).join('');
  }
  draw();
  ov.addEventListener('change', e => {
    const t = e.target as HTMLInputElement;
    if (t.dataset.id) {
      const arr = picked(), i = arr.indexOf(t.dataset.id);
      if (t.checked && i < 0) {
        if (arr.length >= DECK_MAX) { t.checked = false; audio.ui('error'); count.classList.add('warn'); return; }
        arr.push(t.dataset.id);
      } else if (!t.checked && i >= 0) arr.splice(i, 1);
      audio.ui('click'); changed(); draw();
    }
    if (t.dataset.w) {
      const own = library(kind).find(c => c.id === t.dataset.w)?.name ?? '';
      const v = t.value.trim().slice(0, 16);
      deck.words ??= {};
      if (!v || v === own || v === tr(own)) delete deck.words[t.dataset.w]; else deck.words[t.dataset.w] = v;
      changed();
    }
  });
  ov.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!b) return;
    if (b.dataset.k) { kind = b.dataset.k as 'news' | 'fate'; ov.querySelectorAll('[data-k]').forEach(x => x.classList.toggle('on', x === b)); audio.ui('click'); draw(); return; }
    if (b.dataset.d === 'clear') { picked().length = 0; changed(); draw(); return; }
    if (b.dataset.d === 'auto') {
      const ids = library(kind).map(c => c.id), arr = picked();
      arr.length = 0;
      while (arr.length < DECK_MAX && ids.length) arr.push(ids.splice(Math.floor(Math.random() * ids.length), 1)[0]);
      audio.ui('yes'); changed(); draw(); return;
    }
    if (b.dataset.d === 'ok') { audio.ui('yes'); ov.remove(); }
  });
}

/** The deck as the game takes it (GameSettings.deck), or none when the map uses the original cards. */
export function gameDeck(m: MakerMap): { news: string[]; fate: string[]; words?: Record<string, string> } | undefined {
  const d = m.deck;
  if (!d || (!d.news.length && !d.fate.length)) return undefined;
  return { news: d.news, fate: d.fate, ...(d.words && Object.keys(d.words).length ? { words: d.words } : {}) };
}
