/**
 * 激情歲月's look and words on screen (docs/rules/24 §3, §11), for this map's game shell only:
 * - the skin: `theme-jq` on the shell (ui/theme-jq.css, every rule under `.game.theme-jq`) and the pictures as CSS
 *   variables (--jq-*), so any other map has neither the class nor the variables and looks exactly as before;
 * - the era's names (§3: 樂透 → 有獎銷售, 點券 → 票證, 監獄 → 牛棚, 股市 → 內部認購, 機車 → 幸福摩托 …): the shell's text
 *   is rewritten as it is written (a MutationObserver, as ui/lang.ts does for 简体), the rules and saves untouched;
 *   「是 / 否」 on the yes / no buttons become 「同意 / 不同意」. Gods keep their names (the user's decision).
 */
import { ASSETS } from './assets';
import './theme-jq.css';

const ART = (name: string) => `url("${ASSETS}/maps/remake/jiqing/${name}.webp")`;

/**
 * The renames: [original, this map's] in 繁體 and their 简体 forms (lang.ts may already have converted a text).
 * The era's own words map to themselves, so a text that already reads 「人民公園」 never becomes 「人民人民公園」.
 */
const WORDS: [string, string][] = [
  // already this map's (kept as they are)
  ...['人民公園', '人民銀行', '反帝醫院', '黑市小販', '有獎銷售', '票證兌換點', '投機倒把', '內部認購', '幸福摩托', '上海轎車', '解放卡車',
    '廣播站', '大字報', '跳大神', '關牛棚', '牛棚', '招待所', '供銷社', '宣傳站', '記工分', '挖紅薯', '民兵打靶', '天上掉餡餅', '第一汽車製造廠',
    '人民公园', '人民银行', '反帝医院', '黑市小贩', '有奖销售', '票证兑换点', '内部认购', '幸福摩托', '上海轿车', '解放卡车', '广播站', '大字报',
    '关牛棚', '招待所', '供销社', '宣传站', '记工分', '挖红薯', '天上掉馅饼', '第一汽车制造厂'].map(w => [w, w] as [string, string]),
  // 繁體
  ['樂透', '有獎銷售'], ['道具店', '黑市小販'], ['百貨公司', '黑市小販'], ['卡片屋', '票證兌換點'], ['點券', '票證'], ['監獄', '牛棚'], ['坐牢', '關牛棚'],
  ['醫院', '反帝醫院'], ['銀行', '人民銀行'], ['新聞', '廣播站'], ['命運', '大字報'], ['魔法屋', '跳大神'], ['黑市', '投機倒把'], ['股市', '內部認購'],
  ['買進', '認購'], ['賣出', '轉讓'], ['企鵝挖寶', '挖紅薯'], ['七彩氣球', '民兵打靶'], ['喜從天降', '天上掉餡餅'],
  ['機車', '幸福摩托'], ['汽車', '上海轎車'], ['工程車', '解放卡車'], ['旅館', '招待所'], ['購物中心', '供銷社'], ['加油站', '宣傳站'], ['公園', '人民公園'],
  // 简体
  ['乐透', '有奖销售'], ['卡片屋', '票证兑换点'], ['点券', '票证'], ['监狱', '牛棚'], ['坐牢', '关牛棚'], ['医院', '反帝医院'], ['银行', '人民银行'],
  ['新闻', '广播站'], ['命运', '大字报'], ['股市', '内部认购'], ['买进', '认购'], ['卖出', '转让'], ['企鹅挖宝', '挖红薯'], ['七彩气球', '民兵打靶'],
  ['机车', '幸福摩托'], ['汽车', '上海轿车'], ['工程车', '解放卡车'], ['旅馆', '招待所'], ['购物中心', '供销社'], ['公园', '人民公园'],
];
const MAP = new Map<string, string>();
for (const [a, b] of WORDS) if (!MAP.has(a)) MAP.set(a, b);
const RE = new RegExp([...MAP.keys()].sort((a, b) => b.length - a.length).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');

/** A text in this map's words. */
export function eraText(s: string): string {
  return s.replace(RE, w => MAP.get(w) ?? w);
}

const ATTRS = ['title', 'aria-label', 'alt', 'placeholder'];
/** The yes / no buttons' words (「YES 是」 / 「NO 否」, 「是」 / 「否」) as 「同意」 / 「不同意」. */
const YES_NO: [RegExp, string][] = [[/^(YES\s*)?是$/, '同意'], [/^(NO\s*)?否$/, '不同意']];

function fixText(n: Text) {
  const s = n.data;
  if (!s || !/[㐀-鿿]/.test(s) || n.parentElement?.closest('[data-noera],script,style')) return;
  const btn = n.parentElement?.closest('button.candy.yes, button.candy.no');
  const yn = btn ? YES_NO.find(([re]) => re.test(s.trim())) : undefined;
  const t = yn ? s.replace(s.trim(), yn[1]) : eraText(s);
  if (t !== s) n.data = t;
}
function fixAttr(e: Element, a: string) {
  const s = e.getAttribute(a);
  if (!s) return;
  const t = eraText(s);
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

/** Dresses a game shell in 激情歲月's skin and words; returns the undo (the shell is thrown away with the game anyway). */
export function applyJqTheme(shell: HTMLElement): () => void {
  shell.classList.add('theme-jq');
  const vars: Record<string, string> = {
    '--jq-kraft': ART('paper-kraft'), '--jq-newsprint': ART('paper-newsprint'), '--jq-banner': ART('banner'), '--jq-star': ART('badge-star'),
    '--jq-news': ART('frame-news'), '--jq-fate': ART('frame-fate'), '--jq-award': ART('frame-award'), '--jq-calendar': ART('frame-calendar'),
    '--jq-ok': ART('button-ok'), '--jq-cancel': ART('button-cancel'), '--jq-board': ART('board'),
    '--jq-horn': `url("${ASSETS}/maps/remake/sprites/9103/frame-000.webp")`,
  };
  for (const [k, v] of Object.entries(vars)) shell.style.setProperty(k, v);
  fixTree(shell);
  const obs = new MutationObserver(records => {
    for (const r of records) {
      if (r.type === 'characterData') fixText(r.target as Text);
      else if (r.type === 'attributes') fixAttr(r.target as Element, r.attributeName!);
      else for (const n of r.addedNodes) fixTree(n);
    }
  });
  obs.observe(shell, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  return () => { obs.disconnect(); shell.classList.remove('theme-jq'); };
}
