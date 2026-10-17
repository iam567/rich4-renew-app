/**
 * What a tool or card does, in a short line (two deliberate lines, for a tile or a prize cell) and in full (the shop's
 * bubble, a long-press, a hover), and its picture: the original tools Panel#11, the remake's tools Data#614.. as
 * maps/remake/tools/0<600 + id>.webp, the cards Data#(570 + id) (歌舞伎町's 保鑣卡 37 = maps/remake/cards/0607.webp).
 * 歌舞伎町's exclusive tools (core/modules/kb-data.ts KB_TOOLS) join the shop's TOOL_TEXT here.
 */
import { cardDef } from '../../core/modules/cards';
import { KB_CARD, KB_CARD_SHORT, KB_RAMPAGE, KB_RAMPAGE_SHORT, KB_TOOLS } from '../../core/modules/kb-data';
import { toolIcon } from '../../core/modules/tools';
import type { SpriteBank } from '../sprites';
import { ASSETS } from '../assets';
import { TOOL_TEXT } from './shop';

for (const t of KB_TOOLS) TOOL_TEXT[t.id] = t.text;

export const TOOL_SHORT: Record<number, string> = {
  1: '往前九步\n清掉路障地雷', 2: '放在路上\n擋住經過的人', 3: '埋在路上\n踩到的人住院', 4: '黏上身\n時間到就爆炸',
  5: '騎上機車\n擲 2 顆骰子', 6: '開上汽車\n擲 3 顆骰子', 7: '炸毀一帶建築\n附近的人送醫', 8: '指定下一次\n擲出的點數',
  9: '替一塊地\n加蓋一層', 10: '時光倒流\n回到擲骰前', 11: '把人或建築\n傳送走', 12: '開工程車\n慢慢走',
  13: '畫面內建築\n全部充公', 14: '免費加蓋\n兩級', 15: '核彈打全國\n任一塊地', 16: '傳送，或\n穿越到機場',
  ...Object.fromEntries(KB_TOOLS.map(t => [t.id, t.short])),
};

/** The short line of a tool (or card), with its break. */
export const itemShort = (id: number, card = false): string => (card ? (id === KB_CARD ? KB_CARD_SHORT : id === KB_RAMPAGE ? KB_RAMPAGE_SHORT : '') : TOOL_SHORT[id] ?? '');
/** The full line. */
export const itemText = (id: number, card = false): string => (card ? cardDef(id)?.text ?? '' : TOOL_TEXT[id] ?? '');
/** The picture's url ('' none): the registered art, else the remake's file (a map's art may be registered late). */
export function itemIconSrc(bank: SpriteBank, id: number, card = false): string {
  if (card) return bank.art('Data', 570 + id)?.src ?? (id > 36 ? `${ASSETS}/maps/remake/cards/0${570 + id}.webp` : '');
  const ic = toolIcon(id);
  return bank.art(ic.archive, ic.id, ic.frame)?.src ?? (ic.archive === 'Data' ? `${ASSETS}/maps/remake/tools/0${ic.id}.webp` : '');
}
/** Two short lines as html (escaped). */
export const shortHtml = (s: string) => s.split('\n').map(l => l.replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`)).join('<br>');
