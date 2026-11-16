/**
 * 派對模式's 延遲 panel (the user 2026-11-03: everyone's ping and connection on a HUD that can be shown or hidden):
 * a small list in the map's corner — each player's round trip in ms and who is away; never the server or the way
 * (the user: no 「日本」「VPS」 on screen, only the ms). It never takes a tap (the map under it stays playable).
 * Shown or hidden from the party bar; kept on the phone.
 */
import type { NetRow, Room } from './party-net';
import { showContact } from './party-card';
import { flagHtml } from './region-flag';
import { titleHtml, type TitleDef } from './titles';

const KEY = 'rich4.party.netHud';
export const hudShown = () => { try { return localStorage.getItem(KEY) !== '0'; } catch { return true; } };
const keepShown = (on: boolean) => { try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* not kept */ } };

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** A round trip's grade: good (≤ 100 ms), fair (≤ 250), poor, or none (not measured / away). */
export function grade(rtt: number | null | undefined, away = false): 'good' | 'fair' | 'poor' | 'none' {
  if (away || rtt === null || rtt === undefined) return 'none';
  return rtt <= 100 ? 'good' : rtt <= 250 ? 'fair' : 'poor';
}
/** 「45 ms」, 「房主」, 「斷線中」 or 「…」. */
export function pingText(r: Pick<NetRow, 'rtt' | 'via' | 'away'>): string {
  if (r.away) return '斷線中';
  if (r.via === 'host') return r.rtt ? `${r.rtt} ms` : '房主';
  return r.rtt === null ? '…' : `${r.rtt} ms`;
}

/** A row's grade (the host: its own way to the relay, or good when it has none). */
export const rowGrade = (row: NetRow) => (row.via === 'host' ? (row.rtt ? grade(row.rtt) : 'good') : grade(row.rtt, row.away));

/** Signal bars for a grade (the party bar's button, the rows). */
export function bars(g: ReturnType<typeof grade>): string {
  const lit = g === 'good' ? 4 : g === 'fair' ? 3 : g === 'poor' ? 1 : 0;
  return `<svg class="nh-bars ${g}" viewBox="0 0 20 16" aria-hidden="true">${[0, 1, 2, 3].map(i => `<rect x="${i * 5 + 1}" y="${12 - i * 3.5}" width="3.4" height="${4 + i * 3.5}" rx="1"${i < lit ? ' class="on"' : ''}/>`).join('')}</svg>`;
}

export class NetHud {
  readonly el = document.createElement('div');
  shown = hudShown();

  constructor(stage: HTMLElement, private room: Room, private face: (c: number) => string) {
    this.el.className = 'net-hud';
    stage.append(this.el);
    // a player's face: their card with 聯絡方式 (the user 2026-11-08)
    this.el.addEventListener('pointerdown', e => { if ((e.target as HTMLElement).closest('[data-who]')) e.stopPropagation(); });
    this.el.onclick = e => {
      const id = (e.target as HTMLElement).closest<HTMLElement>('[data-who]')?.dataset.who;
      const m = id ? this.room.members.find(x => x.id === id) : undefined;
      if (m) { e.stopPropagation(); showContact(stage, m, this.face(m.character)); }
    };
    this.draw();
  }

  toggle() { this.shown = !this.shown; keepShown(this.shown); this.draw(); }

  draw() {
    this.el.hidden = !this.shown;
    if (!this.shown) return;
    const r = this.room, rows = r.net.length ? r.net : r.members.map(m => ({ id: m.id, rtt: null, via: 'p2p' as const, away: m.away }));
    this.el.innerHTML = rows.map(row => {
      const m = r.members.find(x => x.id === row.id);
      if (!m) return '';
      const g = rowGrade(row);
      return `<div class="nh-row ${g}${row.id === r.myId ? ' me' : ''}" data-who="${esc(m.id)}"><img src="${this.face(m.character)}" alt=""><b>${flagHtml(m)}${esc(m.name)}${m.contact ? '<i class="nh-c">☎</i>' : ''}</b>${bars(g)}<span>${pingText(row)}</span></div>`;
    }).join('');
  }

  destroy() { this.el.remove(); }
}

/** 「（45 ms）」 for the player at `seat` (the 「等待 … 操作」 line), '' when not measured. */
export function seatPing(room: Room, seat: number): string {
  const id = Object.keys(room.started?.seats ?? {}).find(k => room.started!.seats[k] === seat);
  const row = id ? room.net.find(x => x.id === id) : undefined;
  return row && row.rtt && !row.away ? `（${row.rtt} ms）` : '';
}

/**
 * The ping over each human player's head on the map (the user 2026-11-03: they are real people, show each one's
 * ms above them as they move). Follows the figures every frame; shown with the 延遲 panel; never takes a tap.
 */
export class PingTags {
  readonly el = document.createElement('div');
  private raf = 0;
  private tags = new Map<string, HTMLElement>();

  /**
   * `lift`: how much higher a seat's tag goes at a zoom (a sign over the head on the map, as 派對模式's 「乞丐」, stays
   * under it); `title`: the 稱號 a seat wears (titles.ts), under its ms (the user 2026-11-08), shown with the ms or not.
   */
  constructor(private stage: HTMLElement, private room: Room, private view: { screenOf(id: number): { x: number; y: number; zoom: number } | null; canvas: HTMLElement }, private shown: () => boolean, private lift: (seat: number, zoom: number) => number = () => 0, private title: (seat: number) => TitleDef | null = () => null) {
    this.el.className = 'net-tags';
    stage.append(this.el);
    // Stops by itself once the game screen is gone.
    const loop = () => { if (!this.el.isConnected) return; this.place(); this.raf = requestAnimationFrame(loop); };
    this.raf = requestAnimationFrame(loop);
  }

  private place() {
    const seats = this.room.started?.seats, ms = this.shown();
    this.el.hidden = !seats;
    if (!seats) return;
    const c = this.view.canvas.getBoundingClientRect(), a = this.stage.getBoundingClientRect();
    // The 「等待 … 操作（45 ms）」 line wins where they meet: a tag under it is hidden (that line carries the ms).
    const wait = this.stage.querySelector<HTMLElement>('.pt-waiting:not([hidden])')?.getBoundingClientRect();
    const seen = new Set<string>();
    for (const [id, seat] of Object.entries(seats)) {
      const at = this.view.screenOf(seat);
      if (!at) continue;
      const row = this.room.net.find(x => x.id === id) ?? { id, rtt: null, via: 'p2p' as const };
      let box = this.tags.get(id);
      if (!box) {
        box = document.createElement('div'); box.className = 'net-who';
        box.innerHTML = '<div class="net-tag"></div><div class="net-title" hidden></div>';
        this.tags.set(id, box); this.el.append(box);
      }
      seen.add(id);
      const tag = box.firstElementChild as HTMLElement, tt = box.lastElementChild as HTMLElement;
      const text = pingText(row), cls = `net-tag ${rowGrade(row)}${id === this.room.myId ? ' me' : ''}`;
      if (tag.textContent !== text) tag.textContent = text;
      if (tag.className !== cls) tag.className = cls;
      tag.hidden = !ms;
      // the 稱號: a new one bounces in
      const t = this.title(seat), key = t?.key ?? '';
      if (tt.dataset.key !== key) {
        tt.dataset.key = key; tt.hidden = !t;
        tt.innerHTML = t ? titleHtml(t) : '';
        if (t) { tt.classList.remove('new'); void tt.offsetWidth; tt.classList.add('new'); }
      }
      box.hidden = !ms && !t;
      if (box.hidden) continue;
      // Above the figure's head (the figures are about 60 original pixels tall).
      box.style.transform = `translate(${Math.round(at.x + c.left - a.left)}px, ${Math.round(at.y + c.top - a.top - 64 * at.zoom - this.lift(seat, at.zoom))}px) translate(-50%, -100%)`;
      const r = wait && box.getBoundingClientRect();
      box.style.visibility = r && wait && r.left < wait.right && r.right > wait.left && r.top < wait.bottom && r.bottom > wait.top ? 'hidden' : '';
    }
    for (const [id, tag] of this.tags) if (!seen.has(id)) { tag.remove(); this.tags.delete(id); }
  }

  destroy() { cancelAnimationFrame(this.raf); this.el.remove(); }
}
