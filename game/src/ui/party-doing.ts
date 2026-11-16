/**
 * What a player is doing, on the line the other phones show while they wait (the user 2026-11-04: 「他正在看股票、正在打開
 * 道具、正在查看玩家資料」，大家就不用空等). A question of the game is the same on every phone, so it is worked out here;
 * the windows only that phone has open (LOCAL_DOING) are told by Room.doing.
 */
import type { Ask } from '../core/types';

/** The toolbar's windows that do not touch the game: this phone says it opened one. */
export const LOCAL_DOING: Readonly<Record<string, string>> = { info: '正在查看玩家資料', map: '正在看地圖', system: '正在調整設定', help: '正在看說明', save: '正在存檔' };

const YESNO: Readonly<Record<string, string>> = { 'buy-land': '正在考慮買地', 'buy-facility': '正在考慮買設施', 'upgrade-land': '正在考慮加蓋', 'upgrade-facility': '正在考慮升級設施', liquidate: '正在考慮清算資產' };

export function askDoing(s: Ask): string {
  switch (s.t) {
    case 'turn': return '正在想下一步';
    case 'yesno': return YESNO[s.kind] ?? '正在考慮';
    case 'facility-type': return '正在選要蓋的設施';
    case 'bank': return s.counter ? '正在銀行櫃檯' : '正在用提款機';
    case 'choose': return s.layout === 'cards' ? '正在挑卡片' : s.title === '道具' ? '正在挑道具' : '正在做選擇';
    case 'shop': return '正在逛商店';
    case 'mini-game': return '正在玩小遊戲';
    case 'slot-machine': return '正在拉拉霸';
    case 'wheel': return '正在轉輪盤';
    case 'lottery': return '正在選樂透號碼';
    case 'black-market': return '正在逛黑市';
    case 'stock-market': return '正在看股票';
    case 'pick-node': case 'pick-city-node': case 'pick-map': return '正在地圖上選位置';
    case 'pick-player': return '正在選玩家';
    case 'travel': return '正在選目的地';
    case 'amount': return '正在輸入金額';
    default: return '正在操作';
  }
}
