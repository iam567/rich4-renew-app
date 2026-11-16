/**
 * 自建地圖's 特殊規則 (the user 2026-11-12): the map's maker switches rules on — no gods, no chests, no stock market,
 * the shop closed, the bank shut at weekends … — and every game on the map plays by them (GameSettings.mapRules,
 * core/types.ts MapSwitches). They are part of what the map plays (model.ts playHash): changed, it is tried again.
 */
import type { MapSwitches } from '../../core/types';
import { audio } from '../audio';
import type { MakerMap } from './model';

type Flag = Exclude<keyof MapSwitches, 'gifts'>;
export const SWITCHES: { key: Flag; name: string; desc: string }[] = [
  { key: 'noGods', name: '沒有神仙', desc: '財神、福神、窮神、衰神、天使、小惡魔、土地公、死神都不會出現' },
  { key: 'noChests', name: '沒有禮物寶箱', desc: '路上不會出現禮物和寶箱' },
  { key: 'noStocks', name: '不能炒股', desc: '股市不開，誰都不能買賣股票' },
  { key: 'noShop', name: '道具店不營業', desc: '道具店不賣也不收道具和卡片' },
  { key: 'bankHoliday', name: '週末銀行不開門', desc: '星期六、星期日經過或停在銀行，都不能存錢、領錢和貸款' },
  { key: 'noLoans', name: '銀行不貸款', desc: '銀行照常存錢領錢，但不借錢給人' },
  { key: 'noBlackMarket', name: '沒有黑市', desc: '不能在黑市和別人買賣地產' },
];

/**
 * 道具禮物箱 (MapSwitches.gifts, the user 2026-11-16: 全圖都是撿道具、踩卡片點、沒有商店的道具戰 — a map without a 道具店
 * square has no shop): how many gift boxes lie on the road and how soon a taken one is back (core/modules/objects.ts).
 */
export const GIFT_OPTIONS = [{ v: 0, n: 1 }, { v: 1, n: 5 }, { v: 2, n: 10 }, { v: 3, n: 15 }] as const;

/** The map's switches for the game (none on: undefined). */
export const gameSwitches = (m: MakerMap): MapSwitches | undefined => (m.switches && (SWITCHES.some(s => m.switches![s.key]) || m.switches.gifts) ? m.switches : undefined);

/** Opens the sheet over `root`; `changed` after every change (the editor saves at once). */
export function rulesSheet(root: HTMLElement, m: MakerMap, changed: () => void) {
  const ov = document.createElement('div');
  ov.className = 'slots-overlay mk-ov';
  ov.innerHTML = `<div class="msg sheet mk-rules"><div class="ribbon">特殊規則</div>
    <p class="mk-deck-hint">這張地圖自己的規則：打開的規則，每一局在這張地圖上都照著玩。</p>
    <div class="mk-rule-list"></div>
    <div class="choices"><button class="candy yes" data-r="ok">好</button></div></div>`;
  root.append(ov);
  const list = ov.querySelector<HTMLElement>('.mk-rule-list')!;
  const draw = () => {
    const g = m.switches?.gifts ?? 0, off = !!m.switches?.noChests;
    list.innerHTML = SWITCHES.map(s => `<button class="mk-rule${m.switches?.[s.key] ? ' on' : ''}" data-k="${s.key}"><span><b>${s.name}</b><small>${s.desc}</small></span><i class="mk-tog"></i></button>`).join('')
      + `<div class="mk-rule mk-rule-gifts${off ? ' off' : ''}"><span><b>道具禮物箱</b><small>${off ? '「沒有禮物寶箱」打開時不出現' : `路上的禮物箱（撿到得一個道具）：${GIFT_OPTIONS[g].n} 個，每個月月初全部換到新位置、撿走的也補回。不放道具店格子，就是全靠撿道具的道具戰`}</small></span>`
      + `<div class="chips">${GIFT_OPTIONS.map(o => `<button class="chip${o.v === g ? ' on' : ''}" data-gift="${o.v}"${off ? ' disabled' : ''}>${o.n} 個${o.v ? '' : '（原版）'}</button>`).join('')}</div></div>`;
  };
  draw();
  ov.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!b) return;
    if (b.dataset.r === 'ok') { audio.ui('yes'); ov.remove(); return; }
    if (b.dataset.gift) {
      const sw: MapSwitches = { ...m.switches }, v = Number(b.dataset.gift) as 0 | 1 | 2 | 3;
      if (v) sw.gifts = v; else delete sw.gifts;
      m.switches = Object.keys(sw).length ? sw : undefined;
      audio.ui('click'); changed(); draw(); return;
    }
    const k = b.dataset.k as Flag | undefined;
    if (!k) return;
    const sw: MapSwitches = { ...m.switches };
    if (sw[k]) delete sw[k]; else sw[k] = true;
    m.switches = Object.keys(sw).length ? sw : undefined;
    audio.ui('click'); changed(); draw();
  });
}
