/**
 * 激情歲月's tables (docs/rules/24, the remake's addition; 自製地圖 #8, map 107): the five facilities of the large plots
 * (§2), the 人民公園's good and bad cards (§2.1), the 24 news and 24 fate cards (§6) with the children's texts, and the
 * 宣傳站's lines (§2.4). The rules that read them are in core/jiqing.ts. Every card's picture is
 * maps/remake/events/<id>.webp (rich4-redraw-company/jiqing/events/pics, editor/build_jiqing.py install).
 */

/** The 宣傳站 (§2.4): a facility type of this map only, in the 加油站's place (after 歌舞伎町's 10–13). */
export const T_XUAN = 14;
/** The five facilities (§2): 人民公園 0, 招待所 1, 供銷社 2, 宣傳站 14, 研究所 4 — in the picker's order. */
export const JQ_FAC_TYPES = [0, 1, 2, T_XUAN, 4] as const;
export const JQ_FAC_NAMES: Record<number, string> = { 0: '人民公園', 1: '招待所', 2: '供銷社', [T_XUAN]: '宣傳站', 4: '研究所' };
/** The picker's rule line under the plates (§2.6). */
export const JQ_FAC_RULES: Record<number, string> = {
  0: '地主停下抽好事卡，別人停下抽壞事卡・不收費、不能升級',
  1: '住宿轉盤 1–4 天，付費並住下',
  2: '消費轉盤 ×1–6，憑票購買',
  [T_XUAN]: '騎車開車的人罰款＋學習班2天・可升到5級',
  4: '自己停下時研發道具',
};
/** The plates' pictures (maps/remake/jiqing/plate-<name>.webp). */
export const JQ_FAC_PLATE: Record<number, string> = { 0: 'park', 1: 'guesthouse', 2: 'coop', [T_XUAN]: 'xuanchuan', 4: 'institute' };

/** Days in the 學習班 after a 宣傳站's verdict (§2.4: every level the same). */
export const STUDY_DAYS = 2;
/** The fine's factor by level (§2.4, the user 2026-10-22: +50 % a level): × (1 + 0.5 × (level − 1)). */
export const xuanFactor = (level: number) => 1 + 0.5 * (Math.max(1, Math.min(5, level)) - 1);

/** The five children (糖糖、烏咪、孫小美、小丹尼、金貝貝, core/characters.ts): their own texts on the harsh cards (§6). */
export const JQ_MINORS = new Set([7, 8, 9, 10, 11]);

/** A card of this map: a news, fate or park card; `pic` the picture id when it is not the card's id. */
export interface JqCard { id: string; kind: 'news' | 'fate' | 'park'; good: 0 | 1 | 2; head: string; text: string; category?: string; kid?: string; pic?: string; line?: string }

const N = (id: string, good: 0 | 1, category: string, head: string, text: string, kid?: string, pic?: string): JqCard => ({ id, kind: 'news', good, category, head, text, ...(kid ? { kid } : {}), ...(pic ? { pic } : {}) });
const F = (id: string, good: 0 | 1 | 2, head: string, text: string, kid?: string, line?: string, pic?: string): JqCard => ({ id, kind: 'fate', good, head, text, ...(kid ? { kid } : {}), ...(line ? { line } : {}), ...(pic ? { pic } : {}) });
const P = (id: string, good: 0 | 1, pic: string, head: string, text: string): JqCard => ({ id, kind: 'park', good, head, text, pic });

/** The news (§6.1): read out by the 廣播站. `{x}` fills in the amounts and names. */
export const JQ_NEWS: JqCard[] = [
  N('jq-n-satellite', 1, '最新消息', '東方紅一號上天', '東方紅一號上天！\n全體＋{amount}票證'),
  N('jq-n-bridge', 1, '最新消息', '南京長江大橋通車', '南京長江大橋通車！\n全體＋1張卡片'),
  N('jq-n-pingpong', 1, '外交新聞', '乒乓外交', '乒乓外交！\n友誼第一，每人＋{amount}元'),
  N('jq-n-nixon', 1, '外交新聞', '尼克松訪華', '尼克松訪華！\n招待所3天收費×2'),
  N('jq-n-panda', 1, '外交新聞', '熊貓出國訪問', '熊貓出國訪問！\n人民公園地主各＋{amount}元'),
  N('jq-n-dazhai', 0, '農業戰線', '農業學大寨', '農業學大寨！\n步行的人修梯田停一回合'),
  N('jq-n-daqing', 1, '工業戰線', '工業學大慶', '工業學大慶！\n{stock}認購價漲停2天'),
  N('jq-n-zhiqing', 0, '最新指示', '上山下鄉', '上山下鄉！\n小孩們下鄉3天'),
  N('jq-n-barefoot', 1, '衛生戰線', '赤腳醫生下鄉', '赤腳醫生下鄉！\n住院的人提前出院'),
  N('jq-n-opera', 1, '文藝戰線', '樣板戲匯演', '樣板戲匯演！\n宣傳站3天罰款×2'),
  N('jq-n-exercise', 1, '體育新聞', '全民做廣播體操', '全民做廣播體操！\n每人＋{amount}票證'),
  // The era's campaigns (the user 2026-10-22: 「符合那個年代的歷史事件也都需要寫進新聞或命運裡」), each with its own picture.
  N('jq-n-yida', 0, '最新指示', '一打三反', '一打三反！\n反貪污反浪費，每人繳現金5%'),
  N('jq-n-dousi', 1, '最新指示', '鬥私批修', '鬥私批修！\n私心存起來建設國家：無貸款者存款＋10%'),
  N('jq-n-tunnel', 0, '備戰備荒', '深挖洞', '深挖洞！\n挖塌了{street}，各降一級'),
  N('jq-n-yiku', 0, '本市消息', '憶苦思甜大會', '憶苦思甜大會！\n每人交{amount}元飯錢'),
  N('jq-n-fanan', 0, '本市消息', '反擊右傾翻案風', '反擊右傾翻案風！\n大字報貼滿街，3天過路費減半'),
  N('jq-n-qingli', 0, '本市消息', '清理階級隊伍', '清理階級隊伍！\n首富{name}被查成分，停2回合', '清理階級隊伍！\n{name}被老師查家譜，罰站2回合'),
  N('jq-n-pilin', 0, '最新指示', '批林批孔', '批林批孔！\n學習會開不完，騎車開車的人停一回合'),
  N('jq-n-sijiu', 0, '本市消息', '破四舊', '破四舊！\n每人燒掉一張卡片'),
  N('jq-n-subway', 1, '建設成就', '地鐵一號線通車', '地鐵一號線通車！\n{street}地價上漲'),
  N('jq-n-zaoqing', 1, '最新指示', '早請示晚彙報', '早請示晚彙報！\n表現積極，每人＋{amount}票證'),
  N('jq-n-chuanlian', 0, '本市消息', '紅衛兵大串聯', '紅衛兵大串聯！\n招待所3天免費住'),
  N('jq-n-supply', 1, '商業消息', '供銷社到貨啦', '供銷社到貨啦！\n3天消費×2'),
  N('jq-n-zhenbao', 0, '備戰備荒', '全民備戰', '全民備戰！\n內部認購暫停10天'),
];

/** The fate cards (§6.2): a 大字報 each. */
export const JQ_FATE: JqCard[] = [
  F('jq-f-quanguo', 1, '撿到全國糧票', '撿到全國糧票！\n＋{amount}元'),
  F('jq-f-pingfa', 0, '評法批儒', '評法批儒！\n熬夜寫批判稿，停一回合', '評法批儒！\n熬夜抄作業，停一回合'),
  F('jq-f-model', 1, '評上勞動模範', '評上勞動模範！\n＋{amount}元'),
  F('jq-f-bike', 1, '搶到永久牌自行車', '搶到永久牌自行車！\n得到幸福摩托'),
  F('jq-f-sanzhuan', 1, '三轉一響湊齊了', '三轉一響湊齊了！\n＋1張卡片'),
  F('jq-f-xiafang', 0, '下放五七幹校', '下放五七幹校！\n消失3天', '下鄉去拔草！\n消失3天'),
  F('jq-f-dazibao', 0, '被貼大字報了', '被貼大字報了！\n買紙寫檢討{amount}元', undefined, '有人說你家的雞吃了生產隊的米'),
  F('jq-f-pidou', 0, '被拉去批鬥', '被拉去批鬥！\n戴高帽停2回合', '被老師點名批評！\n罰站2回合', '高帽子有點重，脖子有點酸'),
  F('jq-f-chaojia', 0, '被抄家了', '被抄家了！\n失去1道具1卡片', '書包被沒收！\n失去1道具1卡片', '連你珍藏的搪瓷缸都抄走了'),
  F('jq-f-wudou', 0, '誤入武鬥現場', '誤入武鬥現場！\n住院轉盤', '跟人打架被抓！\n住院轉盤', '只是去打醬油的'),
  F('jq-f-touji', 0, '投機倒把被抓', '投機倒把被抓！\n關牛棚3天', '賣汽水票被抓！\n關牛棚3天'),
  F('jq-f-heishi', 1, '黑市淘到好貨', '黑市淘到好貨！\n得到一件道具'),
  F('jq-f-yulu', 1, '背語錄比賽第一名', '背語錄比賽第一名！\n＋{amount}票證'),
  F('jq-f-ticao', 1, '廣播體操標兵', '廣播體操標兵！\n＋10票證＋{amount}元'),
  F('jq-f-yikufan', 0, '吃了憶苦飯', '吃了憶苦飯！\n肚子疼停一回合'),
  F('jq-f-chicken', 0, '雞跑進生產隊', '雞跑進生產隊！\n賠{amount}元'),
  F('jq-f-fenhong', 1, '生產隊年終分紅', '生產隊年終分紅！\n＋{amount}元'),
  F('jq-f-fancheng', 2, '知青返城', '知青返城！\n回到人民路'),
  F('jq-f-movie', 1, '搶到樣板戲電影票', '搶到樣板戲電影票！\n＋{amount}票證'),
  F('jq-f-tijian', 1, '赤腳醫生上門體檢', '赤腳醫生上門體檢！\n身體倍兒棒＋{amount}元'),
  F('jq-f-biaoyang', 1, '大喇叭點名表揚', '大喇叭點名表揚！\n＋{amount}元'),
  F('jq-f-paidui', 0, '排了一天隊', '排了一天隊！\n只買到一盒火柴，停一回合'),
  F('jq-f-sanxian', 2, '支援三線建設', '支援三線建設！\n捐出一塊空地得補償'),
  F('jq-f-xiuzhang', 0, '戴錯紅袖章', '戴錯紅袖章！\n冒充糾察隊關牛棚2天', '戴錯紅領巾！\n被罰站，關牛棚2天'),
];

/** The 人民公園's cards (§2.1): the owner draws a good one, anyone else a bad one (two decks of 8, drawn in turn). */
export const JQ_PARK_GOOD: JqCard[] = [
  P('jq-pg-taiji', 1, 'jq-p-taiji', '晨練打太極', '晨練打太極，身體倍兒棒！\n＋{amount}元'),
  P('jq-pg-coupon', 1, 'jq-p-coupon', '樹底下撿到全國糧票', '樹底下撿到全國糧票！\n＋20票證'),
  P('jq-pg-date', 1, 'jq-p-blind-date', '公園相親成功', '公園相親成功！介紹人說成分好\n＋1張卡片'),
  P('jq-pg-boat', 1, 'jq-p-boat', '划船比賽拿第一', '划船比賽拿第一！\n＋{amount}元'),
  P('jq-pg-kite', 1, 'jq-p-kite', '放風箏放得最高', '放風箏放得最高！\n得到一件道具'),
  P('jq-pg-icepop', 1, 'jq-p-icepop', '遇到老戰友請吃冰棍', '遇到老戰友請吃冰棍！\n＋{amount}元'),
  P('jq-pg-clean', 1, 'jq-p-clean', '公園評上衛生先進', '公園評上衛生先進！\n＋30票證'),
  P('jq-pg-bench', 1, 'jq-p-bench', '在長椅上背熟了語錄', '在長椅上背熟了語錄！\n＋10票證＋{amount}元'),
];
export const JQ_PARK_BAD: JqCard[] = [
  P('jq-pb-lawn', 0, 'jq-p-lawn', '踩了草坪', '踩了草坪！愛護花草人人有責\n罰{amount}元'),
  P('jq-pb-capsize', 0, 'jq-p-capsize', '划船翻了', '划船翻了！\n住院轉盤'),
  P('jq-pb-leaves', 0, 'jq-p-leaves', '被抓去義務勞動掃落葉', '被抓去義務勞動掃落葉！\n停一回合'),
  P('jq-pb-ticket', 0, 'jq-p-ticket', '逃票被抓', '逃票被抓！\n付地主{amount}元'),
  P('jq-pb-letter', 0, 'jq-p-letter', '沒帶介紹信，說不清楚', '沒帶介紹信，說不清楚！\n罰{amount}元'),
  P('jq-pb-goose', 0, 'jq-p-goose', '被公園的大鵝追著跑', '被公園的大鵝追著跑！\n掉了一張卡片'),
  P('jq-pb-cards', 0, 'jq-p-cards', '在涼亭打撲克被抓', '在涼亭打撲克被抓！\n關牛棚2天'),
  P('jq-pb-report', 0, 'jq-p-report', '被拉去聽憶苦思甜報告', '被拉去聽憶苦思甜報告！\n停一回合'),
];

/** Ids of the cards in the result boxes (`data.id`): above 歌舞伎町's 2000.. (kb-data KB_ID_BASE). */
export const JQ_ID_BASE = 3000;
export const JQ_CARDS: JqCard[] = [...JQ_NEWS, ...JQ_FATE, ...JQ_PARK_GOOD, ...JQ_PARK_BAD];
export const jqCardById = (id: number): JqCard | undefined => (id >= JQ_ID_BASE ? JQ_CARDS[id - JQ_ID_BASE] : undefined);

/** The 宣傳站's lines (§2.4). */
export const XUAN = {
  bubble: '走資本主義道路！',
  scooter: (x: string) => `騎幸福摩托逛大街？\n走資本主義道路！\n罰款${x}元，學習班${STUDY_DAYS}天`,
  car: (x: string) => `坐上海轎車兜風？\n資產階級作風！\n罰款${x}元，學習班${STUDY_DAYS}天`,
  owner: '覺悟還得提高啊！',
  truck: '工程車是為人民服務的，放行！',
  free: '罰款免了，學習可免不了',
  start: '學習班開課啦！',
  lessons: ['今天學習《為人民服務》', '今天學習《紀念白求恩》', '今天學習《愚公移山》'],
};

/** The 人民路 (王府井) street of fate 知青返城 (§6.2 #18). */
export const RENMIN_ROAD = ['人民路', '人民路北'];
/** The 前三門 streets of news 地鐵一號線通車 (§6.1 #20). */
export const SUBWAY_STREETS = ['備戰路', '地鐵路', '建設路'];
/** The stock slot of 大慶油田 (§5: slot 9 of editor/city_companies.py CITIES[107]). */
export const DAQING_SLOT = 9;
