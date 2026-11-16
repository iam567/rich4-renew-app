/**
 * 地圖庫 (the user 2026-11-12): maps players made, each sent by a maker who won a game on it (model.ts cleared), under
 * the maker's name; anyone takes one into 我的地圖 to play alone, on a TV or in a room. The library lives with the
 * party relay (tools/party-relay/maps.mjs).
 */
import { relays } from '../net-peer';
import { deviceId } from '../party-presence';
import { cleared, notOwn, parseMap, savedForm, saveMap, saveThumb, type MakerMap } from './model';

export interface LibContact { k: string; v: string }
export interface LibEntry {
  id: string; name: string; author: string; w: number; h: number; at: number;
  /** downloads, games begun on it (once a day for each device), flowers given (once for each device) */
  takes: number; plays: number; flowers: number;
  /** the maker's 說明 and 寄語, and contacts; whether it has a picture (thumbUrl) */
  desc: string; note: string; contact: LibContact[]; thumb: boolean;
}
/** What a maker tells about their map when publishing (the hall's map page shows it). */
export interface LibAbout { author: string; desc: string; note: string; contact: LibContact[] }
export const CONTACT_KINDS: [string, string][] = [['wechat', '微信'], ['line', 'LINE'], ['ig', 'IG'], ['tg', 'Telegram']];
export type LibSort = 'plays' | 'flowers' | 'new';

async function base(): Promise<string> {
  const url = (await relays())[0];
  if (!url) throw new Error('連不上創作樂園');
  return url.replace(/^ws/, 'http').replace(/\/+$/, '');
}

const WHY: Record<string, string> = {
  unwon: '這張地圖要先試玩通過才能發布', sample: '示例地圖、從創作樂園下載的地圖和用它們改出來的地圖不能發布', size: '地圖大小不對', name: '要填作者名字和地圖名字',
  full: '創作樂園滿了，晚點再試', busy: '發布太頻繁了，一小時後再試', bad: '地圖資料有問題',
};

/** Sends the map with its maker's name, words and contacts, and its picture (a JPEG data: URL); resolves with its id. */
export async function publish(m: MakerMap, about: LibAbout, thumb?: string): Promise<string> {
  if (notOwn(m)) throw new Error(WHY.sample);
  if (!cleared(m)) throw new Error(WHY.unwon);
  const { published: _p, ...map } = savedForm(m);
  const r = await fetch(`${await base()}/maps`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ map, ...about, thumb, dev: deviceId() ?? '' }) });
  const j = (await r.json().catch(() => ({}))) as { id?: string; error?: string };
  if (!j.id) throw new Error(WHY[j.error ?? ''] ?? '發布失敗，晚點再試');
  m.published = j.id;
  saveMap(m);
  return j.id;
}

/** A page of the library: most played, most flowers or newest first. */
export async function browse(from = 0, q = '', sort: LibSort = 'plays'): Promise<{ total: number; maps: LibEntry[] }> {
  const r = await fetch(`${await base()}/maps?${new URLSearchParams({ from: String(from), sort, ...(q ? { q } : {}) })}`, { cache: 'no-store' });
  if (!r.ok) throw new Error('連不上創作樂園');
  return r.json();
}

/** A map of the library as 我的地圖 would hold it (id `lib-<id>`), not kept: 直接玩 plays it as it is. */
export async function fetchLib(e: LibEntry, taking = false): Promise<MakerMap> {
  const r = await fetch(`${await base()}/maps/${e.id}${taking ? '' : '?nocount=1'}`, { cache: 'no-store' });
  if (!r.ok) throw new Error('這張地圖已經不在創作樂園了');
  const m = parseMap(await r.json());
  if (!m) throw new Error('地圖資料有問題');
  Object.assign(m, { id: `lib-${e.id}`, from: { id: e.id, author: e.author } });
  delete m.published;
  return m;
}

/** Takes a map from the library into 我的地圖 (a copy of its own, id `lib-<id>`; taken again, it is replaced). */
export async function take(e: LibEntry): Promise<MakerMap> {
  const m = await fetchLib(e, true);
  saveMap(m);
  // its picture from 創作樂園 for 我的地圖
  if (e.thumb) void fetch(`${await base()}/maps/${e.id}.jpg`).then(x => x.blob()).then(b => new Promise<string>(ok => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result)); fr.readAsDataURL(b); })).then(u => saveThumb(m.id, u)).catch(() => {});
  return m;
}

/** Where the library is (its pictures are at <base>/maps/<id>.jpg). */
export const libraryBase = base;

/** A flower for the map from this phone (once for each phone): the count now and whether this one counted. */
export async function giveFlower(id: string): Promise<{ flowers: number; given: boolean }> {
  const r = await fetch(`${await base()}/maps/${id}/flower`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dev: deviceId() ?? '' }) });
  if (!r.ok) throw new Error('這張地圖已經不在創作樂園了');
  return r.json();
}

/** A game begun on a map taken from the library (counted once a day for each phone; quietly, never in the way). */
export function played(m: MakerMap) {
  if (!m.from?.id) return;
  void base().then(b => fetch(`${b}/maps/${m.from!.id}/play`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dev: deviceId() ?? '' }) })).catch(() => {});
}
