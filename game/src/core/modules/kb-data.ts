/**
 * 歌舞伎町's tables (docs/rules/21, the remake's addition): the shop incidents (§2.3–2.6), the 24 news and 24 fate
 * cards (§6) with their child-safe variants (§3), and the exclusive tools (§7.5). The rules that read them are in
 * core/kabukicho.ts. Every text is shown as written (traditional Chinese, as the original game).
 */

/** The five large-plot shops (§2): facility types 10–13 (after 大富翁城's 5–9; 13 情人酒店, a hotel) and the original 4 研究所. */
export const SHOP_TYPES = [10, 11, 12, 13, 4] as const;
export const SHOP_NAMES: Record<number, string> = { 10: '居酒屋', 11: '陪酒店', 12: '泡泡浴', 13: '情人酒店', 4: '研究所' };
export const isKbShop = (t: number) => t >= 10 && t <= 13;
/** The 陪酒店 as its visitor sees it: 夜總會 for a man, 牛郎店 for a woman (§2). */
export const clubName = (female: boolean) => (female ? '牛郎店' : '夜總會');
/** The shop's name as a visitor of that sex sees it. */
export const shopNameFor = (type: number, female: boolean) => (type === 11 ? clubName(female) : SHOP_NAMES[type] ?? '');
/** One line on what each shop does (the picker's rule line). */
export const SHOP_RULES: Record<number, string> = {
  10: '消費轉盤 ×1–6・事件 15%（食物中毒、急性酒精中毒…）',
  11: '男客「夜總會」、女客「牛郎店」・消費轉盤・事件 25%',
  12: '消費轉盤，女客免費・事件 35%',
  13: '住宿轉盤 1–4 天、付費並住下・沒有事件',
  4: '自己停下時研發道具',
};

/**
 * An incident (§2.2): drawn first on every visit with its weight in ‰ of visits; `alcohol` ones never happen to a minor
 * (§3: the visit goes on as without an incident); `bad`: bad for the visitor. `pic`: the picture id
 * (maps/remake/events/<pic>.webp; the 陪酒店's are -m / -f by the visitor's sex).
 */
export interface Incident { id: string; shop: number; w: number; title: string; visitor: string; owner: string; pic: string; alcohol?: boolean; bad?: boolean; gendered?: boolean }

export const INCIDENTS: Incident[] = [
  // 居酒屋 (§2.3): 15 %
  { id: 'poison', shop: 10, w: 50, title: '食物中毒', visitor: '住院轉盤 0–3 天', owner: '罰3R・停1回合', pic: 'kb-i-izakaya-poison', bad: true },
  { id: 'drunk', shop: 10, w: 30, title: '急性酒精中毒', visitor: '付帳・住院轉盤', owner: '收帳單', pic: 'kb-i-izakaya-drunk', alcohol: true, bad: true },
  { id: 'dash', shop: 10, w: 20, title: '喝霸王酒', visitor: '一半跑掉；被抓：付×2・坐牢2天', owner: '抓到收×2', pic: 'kb-i-izakaya-dash', alcohol: true },
  { id: 'tv', shop: 10, w: 30, title: '美食節目採訪', visitor: '付帳', owner: '收帳單＋宣傳費4R', pic: 'kb-i-izakaya-tv' },
  { id: 'treat', shop: 10, w: 20, title: '隔壁桌請客', visitor: '免單', owner: '收帳單', pic: 'kb-i-izakaya-treat', alcohol: true },
  // 陪酒店 (§2.4): 25 %
  { id: 'ripoff', shop: 11, w: 60, title: '敲竹槓被檢舉', visitor: '只付正常帳單', owner: '罰4R・停1回合', pic: 'kb-i-club-ripoff', gendered: true },
  { id: 'tower', shop: 11, w: 60, title: '香檳塔', visitor: '帳單＋5R', owner: '收帳單', pic: 'kb-i-club-tower', alcohol: true, bad: true, gendered: true },
  { id: 'love', shop: 11, w: 40, title: '遇到真愛', visitor: '免單＋1張卡', owner: '—', pic: 'kb-i-club-love', gendered: true },
  { id: 'minor', shop: 11, w: 30, title: '未成年員工', visitor: '免單', owner: '罰5R・降級・停2回合', pic: 'kb-i-club-minor', gendered: true },
  { id: 'cdrunk', shop: 11, w: 30, title: '急性酒精中毒', visitor: '付帳・住院轉盤', owner: '收帳單', pic: 'kb-i-club-drunk', alcohol: true, bad: true, gendered: true },
  { id: 'late', shop: 11, w: 30, title: '超時營業', visitor: '免單', owner: '罰3R・停業3天', pic: 'kb-i-club-late', gendered: true },
  // 泡泡浴 (§2.5): 35 %
  { id: 'slip', shop: 12, w: 80, title: '浴室滑倒', visitor: '住院轉盤 0–3 天', owner: '罰2R', pic: 'kb-i-bath-slip', bad: true },
  { id: 'locker', shop: 12, w: 70, title: '置物櫃被撬', visitor: '現金 −10%', owner: '—', pic: 'kb-i-bath-locker', bad: true },
  { id: 'vip', shop: 12, w: 60, title: '貴賓招待', visitor: '免單・＋30點券', owner: '招待，不收錢', pic: 'kb-i-bath-vip' },
  { id: 'licence', shop: 12, w: 70, title: '無照營業', visitor: '免單', owner: '罰4R・降級・停1回合', pic: 'kb-i-bath-licence' },
  { id: 'extend', shop: 12, w: 70, title: '延長服務', visitor: '帳單×2（女客：當作沒事件）', owner: '收帳單', pic: 'kb-i-bath-extend', bad: true },
];
/** The incident chance of each shop (‰ of visits, §2). */
export const INCIDENT_TOTAL: Record<number, number> = { 10: 150, 11: 250, 12: 350 };

/** The five children (§3, the user's decisions): turned away at 陪酒店 / 泡泡浴 / 情人酒店 (sold the shop's merchandise instead), no alcohol anywhere; 黑幫 does possess them. */
export const MINORS = new Set([7, 8, 9, 10, 11]); // 糖糖、烏咪、孫小美、小丹尼、金貝貝 (core/characters.ts)
export const MINOR_REFUSED = '未成年，謝絕入場';

/**
 * What the front counter sells a refused child instead (§3, the user's balance rule): the shop's merchandise, paid like an
 * adult's visit at that level (the shopping wheel, the 情人酒店's stay wheel as days without staying), no incident. Each
 * shop has four; `pic` is maps/remake/kabukicho/merch-<pic>.webp.
 */
export interface Merch { pic: string; name: string; line: string }
export const MERCH: Record<number, Merch[]> = {
  11: [
    { pic: 'club-figure', name: '紅牌Q版公仔', line: '店員熱情推銷了紅牌的Q版公仔' },
    { pic: 'club-towel', name: '應援毛巾', line: '店員塞了一條閃亮亮的應援毛巾給你' },
    { pic: 'club-soda', name: '無酒精氣泡葡萄汁', line: '店員推銷了一瓶無酒精氣泡葡萄汁' },
    { pic: 'club-gacha', name: '限定扭蛋', line: '門口的限定扭蛋機，一轉就停不下來' },
  ],
  12: [
    { pic: 'bath-duck', name: '皇冠小黃鴨', line: '店員推銷了戴皇冠的洗澡小黃鴨' },
    { pic: 'bath-bomb', name: '泡泡入浴球禮盒', line: '店員推銷了香香的泡泡入浴球禮盒' },
    { pic: 'bath-plush', name: '泡泡吉祥物娃娃', line: '店員推銷了店裡的泡泡吉祥物娃娃' },
    { pic: 'bath-milk', name: '咖啡牛奶', line: '店員推銷了一瓶冰涼的咖啡牛奶' },
  ],
  13: [
    { pic: 'hotel-cushion', name: '愛心抱枕', line: '店員推銷了軟綿綿的愛心抱枕' },
    { pic: 'hotel-gacha', name: '城堡扭蛋', line: '門口的城堡扭蛋機，一轉再轉' },
    { pic: 'hotel-milk', name: '草莓牛奶', line: '店員推銷了粉紅色的草莓牛奶' },
    { pic: 'hotel-keychain', name: '城堡吉祥物鑰匙圈', line: '店員推銷了城堡吉祥物鑰匙圈' },
  ],
};
export const MERCH_LINE = '…但被門口的店員推銷了店裡的周邊商品';

/** The road NPCs' squares (§4; editor/kabukicho_layout.NPC_SPAWN: 仲通り北口, ゴールデン街口 / 一番街拱門口, 花道通り×一番街). */
export const GANG_SPAWNS = [14, 144];
export const TOUT_SPAWNS = [66, 102];
export const GANG_DAYS = 7;
/** After a possession 黑幫 stays off the map for 30 days (the user, 2026-10-17). */
export const GANG_AWAY = 30;
export const GANG_PRISON_DAYS = 7;

/** The exclusive tools of the 柏青哥店 / 拉霸店 counter (§7.5): ids 17–20 (14–16 are 大富豪模式's). */
export const KB_TOOLS = [
  { id: 17, name: '確變骰子', price: 25, supply: 0, tier: 2 as const, aggression: 0 as const, inShop: false, text: '這回合多擲一顆骰子，擲完挑一顆不算', short: '多擲一顆\n挑一顆不算' },
  { id: 18, name: '計程車券', price: 20, supply: 0, tier: 2 as const, aggression: 0 as const, inShop: false, text: '擲骰前用：自己這回合擲 5 顆骰子，或塞給一位對手，他下回合一定擲 5 顆', short: '自己或對手\n擲 5 顆骰子' },
];
/**
 * 保鑣卡 (§4.1, the user 2026-10-18; was the tool 保鑣 19): a card, passive like 免費卡, only on this map: when a 黑幫
 * holder stops on the owner's property, one is used by itself and no 保護費 is paid. Only at the prize counter. Old saves: a 保鑣 tool becomes this card, a 霓虹燈箱 (20, dropped) its 60 points back.
 */
export const KB_CARD = 37;
export const KB_CARD_SHORT = '黑幫收保護費時\n自動出面，免付一次';
/** 暴走卡 (§7.5, the user 2026-10-18): played in one's turn, one more whole turn right after it (no day passes). */
export const KB_RAMPAGE = 38;
export const KB_RAMPAGE_SHORT = '這回合走完\n馬上再來一回合';
/** The prize counter's own goods (the only place to get them): the exclusive tools and the two cards. */
export const KB_CARDS_OWN = [KB_CARD, KB_RAMPAGE];
export const OLD_BODYGUARD = 19, OLD_NEON = 20, OLD_NEON_POINTS = 60;
export const KB_TOOL_IDS = KB_TOOLS.map(t => t.id);

// ------------------------------------------------------------------ news and fate (§6)

export interface KbCard { id: string; kind: 'news' | 'fate'; good: 0 | 1 | 2; head: string; text: string; category?: string; kid?: string }

const N = (id: string, good: 0 | 1, category: string, head: string, text: string): KbCard => ({ id, kind: 'news', good, category, head, text });
const F = (id: string, good: 0 | 1 | 2, head: string, text: string, kid?: string): KbCard => ({ id, kind: 'fate', good, head, text, ...(kid ? { kid } : {}) });

export const KB_NEWS: KbCard[] = [
  N('kb-n-matsuri', 1, '社會新聞', '歌舞伎町夜祭開跑', '夜祭開跑！／居酒屋3天收費×2'),
  N('kb-n-hygiene', 0, '政府公告', '衛生單位突擊檢查', '衛生突擊檢查！／居酒屋各罰{amount}元'),
  N('kb-n-award', 1, '社會新聞', '年度最佳夜店大賞', '最佳夜店大賞！／{owner}得{amount}元'),
  N('kb-n-newmachine', 1, '娛樂新聞', '柏青哥新機上市', '柏青哥新機上市！／3天易中獎'),
  N('kb-n-setting6', 1, '娛樂新聞', '拉霸店全台設定6', '拉霸全台設定6！／3天易中BIG'),
  N('kb-n-gangwar', 0, '社會新聞', '黑幫內鬨火拼', '黑幫內鬨！／黑幫暫時離開'),
  N('kb-n-touts', 1, '政府公告', '區役所整頓拉客', '整頓拉客！／拉客仔消失5天'),
  N('kb-n-kaiju', 1, '娛樂新聞', '怪獸頭點燈儀式', '怪獸頭點燈！／全體＋{amount}點券'),
  N('kb-n-tower', 1, '財經新聞', '歌舞伎町塔開幕', '歌舞伎町塔開幕！／大型用地各＋{amount}元'),
  N('kb-n-typhoon', 0, '氣象報導', '颱風夜街上沒人', '颱風夜！／2天店收費減半'),
  N('kb-n-tax', 0, '政府公告', '消費稅調漲', '消費稅調漲！／每人繳存款5％'),
  N('kb-n-tourists', 1, '社會新聞', '外國觀光客暴增', '觀光客暴增！／3天過路費×1.5'),
  N('kb-n-bathclose', 0, '政府公告', '泡泡浴消防檢查', '消防檢查！／泡泡浴停業2天'),
  N('kb-n-valentine', 1, '社會新聞', '情人節情人酒店爆滿', '情人節！／情人酒店3天×2'),
  N('kb-n-subsidy', 1, '政府公告', '區役所振興補助', '振興補助！／{name}＋{amount}元'),
  N('kb-n-viral', 1, '娛樂新聞', '網紅直播爆紅', '網紅直播爆紅！／{owner}的{shop}升級'),
  N('kb-n-torinoichi', 1, '社會新聞', '花園神社酉の市', '酉の市！／每人＋1張卡片'),
  N('kb-n-goldenfire', 0, '社會新聞', '黃金街電線走火', '黃金街走火！／房子各降一級'),
  N('kb-n-taxistrike', 0, '路況報導', '計程車大罷工', '計程車罷工！／3天只擲1顆骰子'),
  N('kb-n-blackout', 0, '政府公告', '霓虹燈節電令', '霓虹燈節電令！／3天過路費減半'),
  N('kb-n-exchange', 1, '娛樂新聞', '景品交換所改裝', '景品所改裝！／景品3天七折'),
  N('kb-n-ordinance', 0, '政府公告', '暴力團排除條例', '暴排條例上路！／黑幫附身者被抓'),
  N('kb-n-hostweek', 1, '娛樂新聞', '陪酒店週年慶', '陪酒店週年慶！／3天女客免費'),
  N('kb-n-stocks', 1, '財經新聞', '娛樂概念股大漲', '娛樂股大漲！／{stock}漲停2天'),
  // 2026-10-18 (the user: prison as often as hospital): the retired 地下賭場 raid picture; the grown-ups there are taken in.
  N('kb-n-raid', 0, '社會新聞', '地下賭場被抄', '地下賭場被抄！／在場的人坐牢2天'),
];

/** `kid`: the child-safe text (§3) where the adult one does not fit a child; the effect is the same unless noted. */
export const KB_FATE: KbCard[] = [
  F('kb-f-tamacard', 1, '撿到存玉卡', '撿到存玉卡！／存玉＋500顆', '撿到代幣卡！／存玉＋500顆'),
  F('kb-f-classmate', 1, '老同學請客', '老同學請客！／＋{amount}元', '老同學的爸爸！／零用錢＋{amount}元'),
  F('kb-f-tout', 2, '被拉客仔纏上', '被拉客仔纏上！／拉進一家店', '被帶去吃飯！／進一家居酒屋'),
  F('kb-f-drunk', 0, '急性酒精中毒', '喝到斷片！／住院轉盤', '冰淇淋吃太多！／住院轉盤'),
  F('kb-f-wallet', 1, '交還錢包', '交還錢包！／謝禮＋{amount}元'),
  F('kb-f-kaiju', 0, '被怪獸頭嚇到', '被怪獸頭嚇到！／手機摔壞了'),
  F('kb-f-parttime', 1, '打工領薪水', '居酒屋打工！／薪水＋{amount}元', '發傳單！／零用錢＋{amount}元'),
  F('kb-f-gang', 2, '黑幫收小弟', '黑幫收小弟！／黑幫附身'),
  F('kb-f-trouble', 0, '在店裡鬧事', '在店裡鬧事！／被抓坐牢2天', '在店裡大吵大鬧！／被抓坐牢2天'),
  F('kb-f-fake', 0, '賣假名牌', '賣假名牌被抓！／坐牢3天', '賣假玩具被抓！／坐牢3天'),
  F('kb-f-photo', 1, '被街拍', '上了雜誌！／＋30點券'),
  F('kb-f-lottery', 1, '抽中特獎', '抽中特獎！／＋{amount}點券', '抽中特獎！／＋{amount}點券'),
  F('kb-f-taxi', 2, '被載到柏青哥店', '被載到柏青哥店！', '公車坐過站！／到柏青哥店'),
  F('kb-f-lovehotel', 0, '主題房生日派對', '主題房生日派對！／住進情人酒店', '迷路了！／繞了一圈'),
  F('kb-f-lasttrain', 0, '錯過末班車', '錯過末班車！／網咖過夜・停一回合', '下課太晚！／等家人・停一回合'),
  F('kb-f-slip', 0, '巷子裡滑倒', '巷子裡滑倒！／住院轉盤'),
  F('kb-f-fight', 0, '酒後打架', '酒後打架被捕！／坐牢5天', '跟人打架被抓！／坐牢5天'),
  F('kb-f-referral', 1, '介紹客人', '介紹客人！／對手各付{amount}元', '幫店發傳單！／對手各付{amount}元'),
  F('kb-f-sign', 0, '招牌被吹落', '招牌被吹落！／一塊地降一級'),
  F('kb-f-vip', 1, 'VIP會員卡', 'VIP會員卡！／下次進店只付一倍', '兒童會員卡！／下次進店只付一倍'),
  F('kb-f-omikuji', 1, '求到大吉籤', '求到大吉籤！／＋免罪卡'),
  F('kb-f-flyers', 1, '發傳單', '發傳單！／點券＋現金'),
  F('kb-f-gift', 1, '收到禮物', '{host}送你禮物！／＋1張卡片', '阿姨送你糖果！／＋1張卡片'),
  F('kb-f-skimming', 0, '信用卡被盜刷', '信用卡被盜刷！', '零用錢被盜領！'),
  // 2026-10-18 (the user: prison as often as hospital): two of the retired 地下賭場 pictures, a gambling arrest and a card cheat.
  F('kb-f-casino', 0, '賭博現行犯', '賭博現行犯！／坐牢3天', '偷溜進賭場被抓！／坐牢3天'),
  F('kb-f-cheat', 0, '牌局出千', '牌局出千被抓！／坐牢4天', '玩牌作弊被抓！／坐牢4天'),
];
/** Board ids keep the first 24 + 24 in place; the cards added later follow them (news, then fate). */
export const KB_CARDS = [...KB_NEWS.slice(0, 24), ...KB_FATE.slice(0, 24), ...KB_NEWS.slice(24), ...KB_FATE.slice(24)];
/** Board ids of these cards (the news / fate box): 2000 + index (1000.. are 大富豪模式's local events). */
export const KB_ID_BASE = 2000;
export const kbCardById = (id: number): KbCard | undefined => (id >= KB_ID_BASE ? KB_CARDS[id - KB_ID_BASE] : undefined);
