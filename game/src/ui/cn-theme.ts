/**
 * 長安's (and 清明上河's) words on screen (the user 2026-11-18/19: money in 文, every place in its Tang name — 「能變的盡量變」; the tools,
 * cards and vehicles keep their names): the shell's text is rewritten as it is written, as 激情歲月's (ui/jq-theme.ts),
 * the rules and saves untouched. The place screens' pictures come from the map's own set (jiqing.ts
 * prepareJiqingPlaces('changan'), tools/tycoon-art/changan_screens.py).
 */
import { setEraLine } from './era-line';
import './theme-cn.css';

/** [modern, the era's] in 繁體 and 简体; the era's words map to themselves so a rename comes to rest. */
const CHANGAN: [string, string][] = [
  ...['博戲坊', '客舍', '市肆', '油坊', '集賢院', '櫃坊', '胡商貨棧', '書肆', '京兆府獄', '悲田養病坊', '邸報', '卜肆', '玄都觀', '樗蒲', '市易司',
    '博戏坊', '集贤院', '柜坊', '胡商货栈', '书肆', '京兆府狱', '悲田养病坊', '邸报', '玄都观', '市易司', '鬼市', '不出價', '不出价', '售罄'].map(w => [w, w] as [string, string]),
  // the large plots (core/changan.ts CHANGAN_FAC_NAMES)
  ['公園', '博戲坊'], ['旅館', '客舍'], ['購物中心', '市肆'], ['加油站', '油坊'], ['研究所', '集賢院'],
  ['公园', '博戏坊'], ['旅馆', '客舍'], ['购物中心', '市肆'], ['研究所', '集贤院'],
  // the places (the map's pads: 櫃坊, 胡商貨棧, 書肆, 京兆府獄, 悲田養病坊, 邸報, 卜肆, 玄都觀, 樗蒲)
  // the black market: Chang'an's own night market (鬼市); English words left on buttons
  ['黑市', '鬼市'], ['PASS', '不出價'], ['SOLD', '售罄'],
  ['銀行', '櫃坊'], ['道具店', '胡商貨棧'], ['百貨公司', '胡商貨棧'], ['卡片屋', '書肆'], ['監獄', '京兆府獄'], ['醫院', '悲田養病坊'],
  ['新聞', '邸報'], ['魔法屋', '玄都觀'], ['樂透', '樗蒲'], ['股市', '市易司'],
  ['银行', '柜坊'], ['卡片屋', '书肆'], ['监狱', '京兆府狱'], ['医院', '悲田养病坊'], ['新闻', '邸报'], ['魔法屋', '玄都观'], ['乐透', '樗蒲'],
];
/**
 * 清明上河's (Northern Song 汴京, the user 2026-11-23): the map's own square names (editor/maker_qingming.py ERA) — 交子務,
 * 相國寺萬姓交易 (萬姓交易 for short), 書坊, 開封府, 趙太丞家, 小報, 上清宮, 關撲; the stock market 市易務 (王安石's market
 * office), the black market 鬼市子 (《東京夢華錄》), the large plots by the map's buildings (core/qingming.ts QM_FAC_NAMES).
 */
const QINGMING: [string, string][] = [
  ...['瓦舍勾欄', '客店', '交易市樓', '漕運處', '書院', '交子務', '萬姓交易', '書坊', '開封府', '趙太丞家', '小報', '卦肆', '上清宮', '關撲', '市易務', '鬼市子',
    '瓦舍勾栏', '交易市楼', '漕运处', '书院', '交子务', '万姓交易', '书坊', '开封府', '赵太丞家', '小报', '上清宫', '关扑', '市易务',
    '不出價', '不出价', '售罄'].map(w => [w, w] as [string, string]),
  ['公園', '瓦舍勾欄'], ['旅館', '客店'], ['購物中心', '交易市樓'], ['加油站', '漕運處'], ['研究所', '書院'],
  ['公园', '瓦舍勾栏'], ['旅馆', '客店'], ['购物中心', '交易市楼'], ['研究所', '书院'],
  ['黑市', '鬼市子'], ['PASS', '不出價'], ['SOLD', '售罄'],
  ['銀行', '交子務'], ['道具店', '萬姓交易'], ['百貨公司', '萬姓交易'], ['卡片屋', '書坊'], ['監獄', '開封府'], ['醫院', '趙太丞家'],
  ['新聞', '小報'], ['魔法屋', '上清宮'], ['樂透', '關撲'], ['股市', '市易務'],
  ['银行', '交子务'], ['监狱', '开封府'], ['医院', '赵太丞家'], ['新闻', '小报'], ['魔法屋', '上清宫'], ['乐透', '关扑'],
];
export type CnTheme = 'changan' | 'qingming';
const WORDS: Record<CnTheme, [string, string][]> = { changan: CHANGAN, qingming: QINGMING };
const TABLES = new Map<CnTheme, { map: Map<string, string>; re: RegExp }>();
function table(theme: CnTheme) {
  let t = TABLES.get(theme);
  if (!t) {
    const map = new Map<string, string>();
    for (const [a, b] of WORDS[theme]) if (!map.has(a)) map.set(a, b);
    t = { map, re: new RegExp([...map.keys()].sort((a, b) => b.length - a.length).join('|'), 'g') };
    TABLES.set(theme, t);
  }
  return t;
}
/** Money: 「12,000元」「12,000 元」 → 文 (only after a figure: 元宵, 元帥 … stay); 「$12,000」 → 「12,000 文」. */
const MONEY = /(\d[\d,，]*)(\s*)元/g;
const DOLLAR = /\$\s?(\d[\d,]*)/g;

export function cnText(s: string, unit = '文', theme: CnTheme = 'changan'): string {
  const { map, re } = table(theme);
  return s.replace(MONEY, '$1$2文').replace(DOLLAR, `$1 ${unit}`).replace(re, (w: string, at: number, all: string) => {
    const v = map.get(w) ?? w, i = v.indexOf(w);
    return i >= 0 && all.startsWith(v, at - i) ? w : v;
  });
}
/** The shell's theme now (one game at a time). */
let cur: CnTheme = 'changan';

const ATTRS = ['title', 'aria-label', 'alt', 'placeholder'];
function fixText(n: Text) {
  const s = n.data;
  if (!s || n.parentElement?.closest('[data-noera],script,style')) return;
  // the shops' prices are in points (點), everything else with a $ is money
  let t = cnText(s, n.parentElement?.closest('.shop-row, .shop-cell') ? '點' : '文', cur);
  // 「每張 <b>1,000</b> 元」: the figure in its own node, the 元 after it
  if (/^\s*元/.test(t) && /\d\s*$/.test(n.previousSibling?.textContent ?? '')) t = t.replace('元', '文');
  if (t !== s && cnText(t, '文', cur) === t) n.data = t;
}
function fixAttr(e: Element, a: string) {
  const s = e.getAttribute(a);
  if (!s) return;
  const t = cnText(s, '文', cur);
  if (t !== s) e.setAttribute(a, t);
}
function fixTree(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) { fixText(root as Text); return; }
  if (root.nodeType !== Node.ELEMENT_NODE) return;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  for (let n: Node | null = root; n; n = w.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) fixText(n as Text);
    else for (const a of ATTRS) if ((n as Element).hasAttribute(a)) fixAttr(n as Element, a);
  }
}

/**
 * Dresses a game shell in an era's words and look (長安: 'changan'; 清明上河: 'qingming', the same red-and-gold skin
 * with its own touches under `.theme-qm`, theme-cn.css); returns the undo.
 */
export function applyCnTheme(shell: HTMLElement, theme: CnTheme = 'changan'): () => void {
  cur = theme;
  shell.classList.add('theme-cn');
  if (theme === 'qingming') shell.classList.add('theme-qm');
  setEraLine(s => cnText(s, '文', theme), false);
  fixTree(shell);
  const obs = new MutationObserver(records => {
    for (const r of records) {
      if (r.type === 'characterData') fixText(r.target as Text);
      else if (r.type === 'attributes') fixAttr(r.target as Element, r.attributeName!);
      else for (const n of r.addedNodes) fixTree(n);
    }
  });
  obs.observe(shell, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  return () => { obs.disconnect(); shell.classList.remove('theme-cn', 'theme-qm'); setEraLine(null); };
}
