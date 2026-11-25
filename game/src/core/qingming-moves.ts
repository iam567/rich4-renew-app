/**
 * 清明上河's 小事件 (the user 2026-11-23: 「城內挑8個10點券、4個30點券，梁山挑15個10點券，改成小事件格子」): 27 of the 點券
 * squares; an exact stop draws one of these 30 — 《清明上河圖》's 汴京 street life and some 《水滸傳》 — moves only, the steps
 * 1–6, the kinds and the engine as 開元盛世's (core/move-events.ts). Pictures: maps/remake/qingming/moves/<id>.webp
 * (tools/tycoon-art/qingming_movepics.py). The area rules: core/qingming.ts (QingmingRules.moveArea).
 */
import type { MoveEvent } from './move-events';

export const QM_MOVES: MoveEvent[] = [
  // on
  { id: 'qm-m-donkey', head: '騎上炭驢', text: '進城賣炭的毛驢順路馱你一程\n前進{n}步', t: 'fwd', lo: 1, hi: 6 },
  { id: 'qm-m-sedan', head: '坐錯了轎子', text: '轎夫認錯了主顧，抬起你就跑\n前進{n}步', t: 'fwd', lo: 1, hi: 6 },
  { id: 'qm-m-barrow', head: '搭上串車', text: '獨輪串車正好順路，推著你走\n前進{n}步', t: 'fwd', lo: 1, hi: 6 },
  { id: 'qm-m-tracker', head: '幫忙拉縴', text: '汴河縴夫喊著號子拉船，跟著一起拉\n前進{n}步', t: 'fwd', lo: 1, hi: 6 },
  { id: 'qm-m-bun', head: '追炊餅擔', text: '武大郎挑著炊餅擔子走得飛快，一路追著買\n前進{n}步', t: 'fwd', lo: 1, hi: 6 },
  { id: 'qm-m-daizong', head: '神行甲馬', text: '戴宗在你腿上也綁了兩張甲馬\n一陣風前進{n}步', t: 'fwd', lo: 1, hi: 6 },
  { id: 'qm-m-cuju', head: '追鞠', text: '有人一腳把鞠踢上了房頂\n追著球跑了{n}步', t: 'fwd', lo: 1, hi: 6 },
  { id: 'qm-m-acrobat', head: '被拋上天', text: '瓦子裡的雜耍藝人把你拋上半空\n落在{n}格外', t: 'fwd', lo: 1, hi: 6 },
  { id: 'qm-m-boat', head: '汴河搭船', text: '順著汴河搭了一段客船\n前進{n}步', t: 'fwd', lo: 1, hi: 6 },
  { id: 'qm-m-oxcart', head: '坐上太平車', text: '拉貨的太平車慢悠悠地走\n前進{n}步', t: 'fwd', lo: 1, hi: 6 },
  { id: 'qm-m-fortune', head: '算命說往前', text: '算命先生說：往前走有好運\n信了，前進{n}步', t: 'fwd', lo: 1, hi: 6 },
  { id: 'qm-m-bridge', head: '虹橋人潮', text: '虹橋上人擠人，雙腳離地被推著走\n前進{n}步', t: 'fwd', lo: 1, hi: 6 },
  { id: 'qm-m-luzhishen', head: '花和尚開道', text: '魯智深扛著禪杖走在前頭，誰都讓路\n跟著前進{n}步', t: 'fwd', lo: 1, hi: 6 },
  // back
  { id: 'qm-m-umbrella', head: '忘了帶傘', text: '天色要下雨了\n回頭去拿油紙傘，後退{n}步', t: 'back', lo: 1, hi: 6 },
  { id: 'qm-m-mast', head: '桅杆要撞橋', text: '大船過虹橋，桅杆差點撞上\n嚇得後退{n}步', t: 'back', lo: 1, hi: 6 },
  { id: 'qm-m-pig', head: '肥豬進城', text: '一群肥豬橫衝直撞進城門\n被擠得後退{n}步', t: 'back', lo: 1, hi: 6 },
  { id: 'qm-m-camel', head: '駱駝堵門', text: '城門洞裡駱駝隊堵住了路\n只好後退{n}步', t: 'back', lo: 1, hi: 6 },
  { id: 'qm-m-goose', head: '大白鵝追啄', text: '河邊的大白鵝追著你啄\n連退{n}步', t: 'back', lo: 1, hi: 6 },
  { id: 'qm-m-drunk', head: '醉漢糾纏', text: '正店門口的醉漢拉著你要對飲\n連躲帶退，後退{n}步', t: 'back', lo: 1, hi: 6 },
  { id: 'qm-m-likui', head: '黑旋風來了', text: '李逵掄著兩把板斧衝過來\n嚇得後退{n}步', t: 'back', lo: 1, hi: 6 },
  // the others
  { id: 'qm-m-spin', head: '看陀螺看暈了', text: '孩子們抽陀螺，看著看著自己也轉暈了\n往一邊走了{n}步', t: 'spin', lo: 1, hi: 6 },
  { id: 'qm-m-gossip', head: '回頭聽說書', text: '身後說書的講到武松打虎，忍不住回頭\n掉頭走了{n}步', t: 'turnwalk', lo: 1, hi: 6 },
  { id: 'qm-m-guanpu', head: '關撲手癢', text: '路過關撲攤，手癢得很\n再擲一次骰子', t: 'dice', lo: 1, hi: 1 },
  { id: 'qm-m-cheer', head: '勾欄喝彩', text: '瓦子勾欄演得精彩，一路喝彩\n連擲兩次骰子', t: 'dice', lo: 2, hi: 2 },
  { id: 'qm-m-dusk', head: '天黑趕路', text: '天色晚了，趕著去投店\n一口氣走到下一個路口', t: 'cross' },
  { id: 'qm-m-wrongway', head: '聽錯了路', text: '問路聽錯了方向\n退回上一個路口', t: 'crossback' },
  { id: 'qm-m-yaren', head: '牙人拉看地', text: '牙人拉著你的袖子去看地\n走到沒人買的空地才停', t: 'lot' },
  { id: 'qm-m-lost', head: '巷子迷路', text: '七拐八繞走錯了巷子\n向後轉，下一回合往回走', t: 'turn' },
  { id: 'qm-m-wind', head: '平地起旋風', text: '平地捲起一陣大旋風\n把你吹到了別的地方', t: 'wind' },
  { id: 'qm-m-swap', head: '時遷掉包', text: '鼓上蚤時遷使了個掉包計\n和最近的對手換了位置', t: 'swap' },
];
