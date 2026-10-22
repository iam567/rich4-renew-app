/**
 * 激情歲月's look and words on screen (docs/rules/24 §3, §11), for this map's game shell only:
 * - the skin: `theme-jq` on the shell (ui/theme-jq.css, every rule under `.game.theme-jq`) and the pictures as CSS
 *   variables (--jq-*), so any other map has neither the class nor the variables and looks exactly as before;
 * - the era's names (§3: 樂透 → 有獎銷售, 點券 → 票證, 監獄 → 牛棚, 股市 → 內部認購, 機車 → 幸福摩托 …): the shell's text
 *   is rewritten as it is written (a MutationObserver, as ui/lang.ts does for 简体), the rules and saves untouched;
 *   「是 / 否」 on the yes / no buttons become 「同意 / 不同意」. Gods keep their names (the user's decision).
 */
import { ASSETS } from './assets';
import { lang, t as toHans } from './lang';
import { setEraLine } from './era-line';
import './theme-jq.css';

/** An absolute URL: a url() in a custom property resolves against the stylesheet that uses it (dist/assets/ in a build). */
const abs = (path: string) => `url("${new URL(path, location.href).href}")`;
const ART = (name: string) => abs(`${ASSETS}/maps/remake/jiqing/${name}.webp`);

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
  ['醫院', '反帝醫院'], ['銀行', '人民銀行'], ['新聞', '廣播站'], ['魔法屋', '跳大神'], ['占卜師', '神婆'], ['探監', '探牛棚'], ['黑市', '投機倒把'], ['股市', '內部認購'],
  ['買進', '認購'], ['賣出', '轉讓'], ['企鵝挖寶', '挖紅薯'], ['七彩氣球', '民兵打靶'], ['喜從天降', '天上掉餡餅'],
  ['機車', '幸福摩托'], ['汽車', '上海轎車'], ['工程車', '解放卡車'], ['旅館', '招待所'], ['購物中心', '供銷社'], ['加油站', '宣傳站'], ['公園', '人民公園'],
  // 简体
  ['乐透', '有奖销售'], ['卡片屋', '票证兑换点'], ['点券', '票证'], ['监狱', '牛棚'], ['坐牢', '关牛棚'], ['医院', '反帝医院'], ['银行', '人民银行'],
  ['新闻', '广播站'], ['占卜师', '神婆'], ['探监', '探牛棚'], ['股市', '内部认购'], ['买进', '认购'], ['卖出', '转让'], ['企鹅挖宝', '挖红薯'], ['七彩气球', '民兵打靶'],
  ['机车', '幸福摩托'], ['汽车', '上海轿车'], ['工程车', '解放卡车'], ['旅馆', '招待所'], ['购物中心', '供销社'], ['公园', '人民公园'],
];
const MAP = new Map<string, string>();
for (const [a, b] of WORDS) if (!MAP.has(a)) MAP.set(a, b);
const RE = new RegExp([...MAP.keys()].sort((a, b) => b.length - a.length).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');

/**
 * The place screens' lines in the era's teasing voice (whole lines as the screens write them; the voices keep
 * playing the original recordings). Matched before the word table.
 */
const LINES: Record<string, string> = {
  // 票證兌換點 (the card shop)
  '有什麼我能\n為你服務的嗎？': '同志，憑票兌換，\n過期作廢喔！',
  '請挑選你想要\n兌換的卡片。': '挑一張吧，\n記得帶好票證！',
  '抱歉！\n你的點數不足！': '同志，你的\n票證不夠啊！',
  '對不起！\n您的卡片欄已滿！': '同志，口袋\n已經塞滿了！',
  '歡迎下次再來！': '為人民服務，\n下次再來！',
  // 黑市小販 (the item shop)
  '歡迎光臨\n道具店！': '同志，要貨不？\n噓……小聲點！',
  '您要兌換\n什麼道具？': '要哪件？\n這事可別說出去',
  '對不起，\n您的點券不夠！': '票證不夠？\n那可不行！',
  '很抱歉！您的\n道具欄已滿！': '同志，你的\n挎包裝不下啦！',
  '謝謝惠顧！': '這事可別\n說出去喔！',
  // 有獎銷售 (the lottery)
  '哈囉！\n一券在手，\n希望無窮！': '同志，你好！\n買一斤醬油\n抽一次！',
  // 人民銀行
  '歡迎光臨\n大富翁銀行！': '同志，你好！\n存款自願，取款自由',
  '需要我為您\n服務嗎？': '為人民服務！\n同志辦什麼業務？',
  '謝謝您的惠顧！': '備戰備荒，\n同志慢走！',
  '董事長親自蒞臨\n不知有何指教？': '同志親自來了，\n有什麼指示？',
  '董事長您別開玩笑了∼': '同志，可別\n開玩笑了∼',
  '董事長慢走！': '同志慢走！',
  // 跳大神 (the magic house)
  '進來魔法屋，就得\n完全照我的指示！': '噓，別讓人看見……\n進來就得聽我的！',
  '天靈靈地靈靈∼': '天靈靈地靈靈∼\n破四舊可別說出去！',
  '你來決定他們的命運∼': '你來決定\n他們的下場∼',
  // the fate board's title (only the whole word: 「命運」 inside a sentence keeps its meaning)
  '命運': '大字報',
  '嘿∼輪到你了！': '同志，\n輪到你了！',
  // 反帝醫院
  '您好！請問您要替誰\n辦理出院手續？': '同志，你好！要替誰\n辦理出院手續？',
  // 月底評比 (the month report: the bank's monthly settlement as the month-end award meeting)
  '各位客戶辛苦了！\n又到了每月銀行\n結算的日子。': '各位同志你好！\n又到了月底評\n先進工作者的時候！',
  '大富翁銀行將\n根據您的存款，\n加發１０％的儲金利息。': '人民銀行發儲蓄利息：\n存款加發１０％，\n備戰備荒為人民！',
  '本月悲情人物是．．。': '本月「拖後腿」\n的同志是……',
  '別灰心，\n再加油喔！': '別灰心，\n下個月爭當先進！',
  '本月冠軍是．．。': '本月勞動模範\n是……',
  '其他人還要\n更努力喔！': '其他同志還要\n向他學習喔！',
  '大富翁銀行・存款加發 10% 利息': '人民銀行發儲蓄利息・存款加發 10%',
  '本月最倒楣': '拖後腿',
  '總資產最多': '勞動模範',
  '獲獎原因：': '評比結果：',
  // the 15th's dividends and the end of the game
  '上市公司分紅': '國營企業年終分紅',
  '遊戲結算': '年終總結評比',
};
/** 一 … 十二 for the month titles. */
const CN_MONTH = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];
/** Forms of address (the user 2026-10-22: 「稱呼全部叫同志」): 董事長 / 先生 / 小姐 / 老闆 / 客人 / 顧客 … → 同志. */
// (each in 繁體 and 简体: 简体 may have converted a text before this pass sees it)
const ADDRESS: [RegExp, string | ((...m: string[]) => string)][] = [
  [/^(\d{1,2})月份 [銀银]行[結结]算$/, (_, m) => `${CN_MONTH[Number(m)] ?? m}月份 先進工作者評比`],
  [/董事[長长]室/g, '廠長辦公室'],
  [/董事[長长](\S{1,8}?) ([請请]付)/g, '$1同志 $2'],
  [/[歡欢]迎董事[長长]光[臨临]/g, '同志，你好！'],
  [/(\S+?)董事[長长]，/g, '$1的負責同志，'],
  [/董事[長长]/g, '同志'],
  [/^(\S{1,12})您好$/g, '$1同志，你好！'],
  [/(先生|小姐|女士|老[闆板]|客人|[顧顾]客|客官|大[爺爷])/g, '同志'],
  [/哈[囉啰]/g, '同志，你好'],
  [/[歡欢]迎光[臨临]/g, '同志，你好'],
];
/** The lines' table in 简体 too (made when the converter is there: lang.ts `t`). */
let linesHans: Map<string, string> | null = null;
function lineFor(t: string): string | undefined {
  const own = LINES[t];
  if (own !== undefined) return own;
  if (lang() !== 'hans') return undefined;
  if (!linesHans || !linesHans.size) linesHans = new Map(Object.entries(LINES).map(([k, v]) => [toHans(k), v]).filter(([k]) => !LINES[k]) as [string, string][]);
  return linesHans.get(t);
}

/** A text in this map's words. */
export function eraText(s: string): string {
  const t = s.trim(), line = lineFor(t);
  if (line !== undefined) return s.replace(t, line);
  let out = s;
  for (const [re, to] of ADDRESS) out = out.replace(re, to as string);
  return out.replace(RE, w => MAP.get(w) ?? w);
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
  setEraLine(eraText);
  const vars: Record<string, string> = {
    '--jq-kraft': ART('paper-kraft'), '--jq-newsprint': ART('paper-newsprint'), '--jq-banner': ART('banner'), '--jq-star': ART('badge-star'),
    '--jq-news': ART('frame-news'), '--jq-fate': ART('frame-fate'), '--jq-award': ART('frame-award'), '--jq-calendar': ART('frame-calendar'),
    '--jq-ok': ART('button-ok'), '--jq-cancel': ART('button-cancel'), '--jq-board': ART('board'),
    '--jq-horn': abs(`${ASSETS}/maps/remake/sprites/9103/frame-000.webp`),
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
  return () => { obs.disconnect(); shell.classList.remove('theme-jq'); setEraLine(null); };
}
