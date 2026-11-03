/**
 * 派對模式's 延遲 panel (the user 2026-11-03: everyone's ping and connection on a HUD that can be shown or hidden):
 * a small list in the map's corner — each player's round trip in ms and who is away; never the server or the way
 * (the user: no 「日本」「VPS」 on screen, only the ms). It never takes a tap (the map under it stays playable).
 * Shown or hidden from the party bar; kept on the phone.
 */
import type { NetRow, Room } from './party-net';

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
      return `<div class="nh-row ${g}${row.id === r.myId ? ' me' : ''}"><img src="${this.face(m.character)}" alt=""><b>${esc(m.name)}</b>${bars(g)}<span>${pingText(row)}</span></div>`;
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

  constructor(private stage: HTMLElement, private room: Room, private view: { screenOf(id: number): { x: number; y: number; zoom: number } | null; canvas: HTMLElement }, private shown: () => boolean) {
    this.el.className = 'net-tags';
    stage.append(this.el);
    // Stops by itself once the game screen is gone.
    const loop = () => { if (!this.el.isConnected) return; this.place(); this.raf = requestAnimationFrame(loop); };
    this.raf = requestAnimationFrame(loop);
  }

  private place() {
    const seats = this.room.started?.seats;
    this.el.hidden = !this.shown() || !seats;
    if (this.el.hidden || !seats) return;
    const c = this.view.canvas.getBoundingClientRect(), a = this.stage.getBoundingClientRect();
    // The 「等待 … 操作（45 ms）」 line wins where they meet: a tag under it is hidden (that line carries the ms).
    const wait = this.stage.querySelector<HTMLElement>('.pt-waiting:not([hidden])')?.getBoundingClientRect();
    const seen = new Set<string>();
    for (const [id, seat] of Object.entries(seats)) {
      const at = this.view.screenOf(seat);
      if (!at) continue;
      const row = this.room.net.find(x => x.id === id) ?? { id, rtt: null, via: 'p2p' as const };
      let tag = this.tags.get(id);
      if (!tag) { tag = document.createElement('div'); this.tags.set(id, tag); this.el.append(tag); }
      seen.add(id);
      const text = pingText(row), cls = `net-tag ${rowGrade(row)}${id === this.room.myId ? ' me' : ''}`;
      if (tag.textContent !== text) tag.textContent = text;
      if (tag.className !== cls) tag.className = cls;
      // Above the figure's head (the figures are about 60 original pixels tall).
      tag.style.transform = `translate(${Math.round(at.x + c.left - a.left)}px, ${Math.round(at.y + c.top - a.top - 64 * at.zoom)}px) translate(-50%, -100%)`;
      const r = wait && tag.getBoundingClientRect();
      tag.style.visibility = r && wait && r.left < wait.right && r.right > wait.left && r.top < wait.bottom && r.bottom > wait.top ? 'hidden' : '';
    }
    for (const [id, tag] of this.tags) if (!seen.has(id)) { tag.remove(); this.tags.delete(id); }
  }

  destroy() { cancelAnimationFrame(this.raf); this.el.remove(); }
}
