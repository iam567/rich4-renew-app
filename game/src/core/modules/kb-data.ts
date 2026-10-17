/**
 * 歌舞伎町's tables (docs/rules/21, the remake's addition): the shop incidents (§2.3–2.6), the 24 news and 24 fate
 * cards (§6) with their child-safe variants (§3), and the exclusive tools (§7.5). The rules that read them are in
 * core/kabukicho.ts. Every text is shown as written (traditional Chinese, as the original game).
 */

/** The five large-plot shops (§2): facility types 10–13 (after 大富翁城's 5–9) and the original 4 研究所. */
export const SHOP_TYPES = [10, 11, 12, 13, 4] as const;
export const SHOP_NAMES: Record<number, string> = { 10: '居酒屋', 11: '陪酒店', 12: '泡泡浴', 13: '地下賭場', 4: '研究所' };
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
  13: '進門付門票、賭一局（賭場的賭桌）・事件 35%',
  4: '原版研究所：自己停下時研發道具',
};

/**
 * An incident (§2.2): drawn first on every visit with its weight in ‰ of visits; `alcohol` ones never happen to a minor
 * (§3: the visit goes on as without an incident); `bad` ones are what a 保鑣 turns away. `pic`: the picture id
 * (maps/remake/events/<pic>.webp; the 陪酒店's are -m / -f by the visitor's sex).
 */
export interface Incident { id: string; shop: number; w: number; title: string; visitor: string; owner: string; pic: string; alcohol?: boolean; bad?: boolean; gendered?: boolean }

export const INCIDENTS: Incident[] = [
  // 居酒屋 (§2.3): 15 %
  { id: 'poison', shop: 10, w: 50, title: '食物中毒', visitor: '吃壞肚子，不用付帳；住院轉盤', owner: '罰款 3R，處理事務中 1 回合', pic: 'kb-i-izakaya-poison', bad: true },
  { id: 'drunk', shop: 10, w: 30, title: '急性酒精中毒', visitor: '付帳；住院轉盤', owner: '照收帳單', pic: 'kb-i-izakaya-drunk', alcohol: true, bad: true },
  { id: 'dash', shop: 10, w: 20, title: '喝霸王酒', visitor: '想不付錢就跑：一半跑掉，一半被抓付 2 倍', owner: '抓到時收 2 倍', pic: 'kb-i-izakaya-dash', alcohol: true },
  { id: 'tv', shop: 10, w: 30, title: '美食節目採訪', visitor: '付帳，上了電視', owner: '收帳單，另得宣傳費 4R', pic: 'kb-i-izakaya-tv' },
  { id: 'treat', shop: 10, w: 20, title: '隔壁桌請客', visitor: '不用付錢', owner: '照收帳單', pic: 'kb-i-izakaya-treat', alcohol: true },
  // 陪酒店 (§2.4): 25 %
  { id: 'ripoff', shop: 11, w: 60, title: '敲竹槓被檢舉', visitor: '只付正常帳單', owner: '罰款 4R，處理事務中 1 回合', pic: 'kb-i-club-ripoff', gendered: true },
  { id: 'tower', shop: 11, w: 60, title: '香檳塔', visitor: '帳單＋5R', owner: '收', pic: 'kb-i-club-tower', alcohol: true, bad: true, gendered: true },
  { id: 'love', shop: 11, w: 40, title: '遇到真愛', visitor: '不用付錢，還收到一張卡片', owner: '—', pic: 'kb-i-club-love', gendered: true },
  { id: 'minor', shop: 11, w: 30, title: '未成年員工', visitor: '不用付錢', owner: '罰款 5R，降一級，處理事務中 2 回合', pic: 'kb-i-club-minor', gendered: true },
  { id: 'cdrunk', shop: 11, w: 30, title: '急性酒精中毒', visitor: '付帳；住院轉盤', owner: '收', pic: 'kb-i-club-drunk', alcohol: true, bad: true, gendered: true },
  { id: 'late', shop: 11, w: 30, title: '超時營業', visitor: '不用付錢', owner: '罰款 3R，停業 3 天', pic: 'kb-i-club-late', gendered: true },
  // 泡泡浴 (§2.5): 35 %
  { id: 'slip', shop: 12, w: 80, title: '浴室滑倒', visitor: '住院轉盤，得到賠償 2R', owner: '賠 2R', pic: 'kb-i-bath-slip', bad: true },
  { id: 'locker', shop: 12, w: 70, title: '置物櫃被撬', visitor: '掉了現金的 10%', owner: '—', pic: 'kb-i-bath-locker', bad: true },
  { id: 'vip', shop: 12, w: 60, title: '貴賓招待', visitor: '付帳（女客免費），送 30 點券', owner: '收', pic: 'kb-i-bath-vip' },
  { id: 'licence', shop: 12, w: 70, title: '無照營業', visitor: '不用付錢', owner: '罰款 4R，降一級，處理事務中 1 回合', pic: 'kb-i-bath-licence' },
  { id: 'extend', shop: 12, w: 70, title: '延長服務', visitor: '付 2 倍帳單（女客免費延長）', owner: '收', pic: 'kb-i-bath-extend', bad: true },
  // 地下賭場 (§2.6): 35 %
  { id: 'cheat', shop: 13, w: 70, title: '莊家出千被抓包', visitor: '得到賠償 3R', owner: '付 3R，處理事務中 1 回合', pic: 'kb-i-casino-cheat' },
  { id: 'streak', shop: 13, w: 70, title: '手氣大旺', visitor: '直接贏 3R', owner: '付 3R', pic: 'kb-i-casino-streak' },
  { id: 'bust', shop: 13, w: 70, title: '輸到脫褲', visitor: '付 3R', owner: '收', pic: 'kb-i-casino-bust', bad: true },
  { id: 'report', shop: 13, w: 70, title: '被人舉報', visitor: '賭客也違法：罰款 1R', owner: '罰款 5R，降一級，處理事務中 2 回合', pic: 'kb-i-casino-report', bad: true },
  { id: 'comp', shop: 13, w: 70, title: '籌碼換點券', visitor: '得 40 點券，不賭', owner: '—', pic: 'kb-i-casino-comp' },
];
/** The incident chance of each shop (‰ of visits, §2). */
export const INCIDENT_TOTAL: Record<number, number> = { 10: 150, 11: 250, 12: 350, 13: 350 };

/** The four children (§3, the coordinator's decision): turned away at 陪酒店 / 泡泡浴 / 地下賭場, no alcohol anywhere. */
export const MINORS = new Set([7, 8, 9, 10]); // 糖糖、烏咪、孫小美、小丹尼 (core/characters.ts)
export const MINOR_REFUSED = '未成年，謝絕入場';

/** The road NPCs' squares (§4; editor/kabukicho_layout.NPC_SPAWN: 仲通り北口, ゴールデン街口 / 一番街拱門口, 花道通り×一番街). */
export const GANG_SPAWNS = [14, 144];
export const TOUT_SPAWNS = [66, 102];
export const GANG_DAYS = 7;
/** After a possession 黑幫 stays off the map for 30 days (the user, 2026-10-17). */
export const GANG_AWAY = 30;
export const GANG_PRISON_DAYS = 7;

/** The exclusive tools of the 柏青哥店 / 拉霸店 counter (§7.5): ids 17–20 (14–16 are 大富豪模式's). */
export const KB_TOOLS = [
  { id: 17, name: '確變骰子', price: 25, supply: 0, tier: 2 as const, aggression: 0 as const, inShop: false, text: '這回合多擲一顆骰子，擲完挑一顆不算' },
  { id: 18, name: '計程車券', price: 20, supply: 0, tier: 2 as const, aggression: 0 as const, inShop: false, text: '這回合擲 3 顆骰子（像開汽車一回合）' },
  { id: 19, name: '保鑣', price: 50, supply: 0, tier: 2 as const, aggression: 0 as const, inShop: false, text: '自動：擋掉一次保護費，或一次對你不利的店內事件' },
  { id: 20, name: '霓虹燈箱', price: 60, supply: 0, tier: 2 as const, aggression: 0 as const, inShop: false, text: '選自己的一塊地或一家店：7 天內收費 ×1.5' },
];
export const KB_TOOL_IDS = KB_TOOLS.map(t => t.id);

// ------------------------------------------------------------------ news and fate (§6)

export interface KbCard { id: string; kind: 'news' | 'fate'; good: 0 | 1 | 2; head: string; text: string; category?: string; kid?: string }

const N = (id: string, good: 0 | 1, category: string, head: string, text: string): KbCard => ({ id, kind: 'news', good, category, head, text });
const F = (id: string, good: 0 | 1 | 2, head: string, text: string, kid?: string): KbCard => ({ id, kind: 'fate', good, head, text, ...(kid ? { kid } : {}) });

export const KB_NEWS: KbCard[] = [
  N('kb-n-matsuri', 1, '社會新聞', '歌舞伎町夜祭開跑', '歌舞伎町夜祭開跑！／居酒屋生意興隆，三天內收費加倍'),
  N('kb-n-hygiene', 0, '政府公告', '衛生單位突擊檢查', '衛生單位突擊檢查居酒屋／每家居酒屋罰款{amount}元'),
  N('kb-n-award', 1, '社會新聞', '年度最佳夜店大賞', '年度最佳夜店大賞揭曉／{owner}的{shop}得獎，獎金{amount}元'),
  N('kb-n-newmachine', 1, '娛樂新聞', '柏青哥新機上市', '柏青哥店新機上市／三天內大當たり機率提高'),
  N('kb-n-setting6', 1, '娛樂新聞', '拉霸店全台設定6', '拉霸店「全台設定6」活動／三天內拉霸大放送'),
  N('kb-n-gangwar', 0, '社會新聞', '黑幫內鬨火拼', '黑幫內鬨火拼／黑幫暫時離開歌舞伎町'),
  N('kb-n-touts', 1, '政府公告', '區役所整頓拉客', '區役所整頓拉客／拉客仔暫時消失'),
  N('kb-n-kaiju', 1, '娛樂新聞', '怪獸頭點燈儀式', '東寶大樓怪獸頭點燈儀式／全體獲得{amount}點券'),
  N('kb-n-tower', 1, '財經新聞', '歌舞伎町塔開幕', '歌舞伎町塔開幕紀念／每塊大型用地的地主獲得{amount}元'),
  N('kb-n-typhoon', 0, '氣象報導', '颱風夜街上沒人', '颱風夜，街上沒人／兩天內所有店收費減半'),
  N('kb-n-tax', 0, '政府公告', '消費稅調漲', '消費稅調漲／每人繳交存款的5％'),
  N('kb-n-tourists', 1, '社會新聞', '外國觀光客暴增', '外國觀光客暴增／三天內小地過路費1.5倍'),
  N('kb-n-bathclose', 0, '政府公告', '泡泡浴消防檢查', '泡泡浴全面消防檢查／所有泡泡浴停業兩天'),
  N('kb-n-raid', 0, '社會新聞', '地下賭場大舉報', '地下賭場遭大規模舉報／{owner}的地下賭場罰款{amount}元並降一級'),
  N('kb-n-subsidy', 1, '政府公告', '區役所振興補助', '新宿區役所發放振興補助／{name}獲得{amount}元'),
  N('kb-n-viral', 1, '娛樂新聞', '網紅直播爆紅', '網紅直播爆紅／{owner}的{shop}升一級'),
  N('kb-n-torinoichi', 1, '社會新聞', '花園神社酉の市', '花園神社酉の市／每人獲得一張卡片'),
  N('kb-n-goldenfire', 0, '社會新聞', '黃金街電線走火', '黃金街電線走火／黃金街的房子各降一級'),
  N('kb-n-taxistrike', 0, '路況報導', '計程車大罷工', '計程車大罷工／三天內所有人只擲一顆骰子'),
  N('kb-n-blackout', 0, '政府公告', '霓虹燈節電令', '霓虹燈節電令／三天內小地過路費減半'),
  N('kb-n-exchange', 1, '娛樂新聞', '景品交換所改裝', '景品交換所改裝開幕／三天內兌換現金的匯率提高'),
  N('kb-n-ordinance', 0, '政府公告', '暴力團排除條例', '暴力團排除條例上路／被黑幫附身的人交出一半保護費'),
  N('kb-n-hostweek', 1, '娛樂新聞', '陪酒店週年慶', '陪酒店週年慶／三天內女性顧客免費'),
  N('kb-n-stocks', 1, '財經新聞', '娛樂概念股大漲', '娛樂概念股大漲／遊戲公司的股價漲停兩天'),
];

/** `kid`: the child-safe text (§3) where the adult one does not fit a child; the effect is the same unless noted. */
export const KB_FATE: KbCard[] = [
  F('kb-f-tamacard', 1, '撿到存玉卡', '撿到一張柏青哥存玉卡，裡面還有500顆', '撿到一張遊樂場的代幣卡，可以在柏青哥店換到500顆'),
  F('kb-f-classmate', 1, '老同學請客', '在黃金街遇到老同學，他請客還塞給你{amount}元', '在街上遇到老同學的爸爸，送你{amount}元零用錢'),
  F('kb-f-tout', 2, '被拉客仔纏上', '被拉客仔纏上，被拉進一家店', '被發傳單的大哥哥帶進一家居酒屋吃飯'),
  F('kb-f-drunk', 0, '急性酒精中毒', '喝到斷片，急性酒精中毒', '冰淇淋吃太多，肚子痛'),
  F('kb-f-wallet', 1, '交還錢包', '撿到錢包交還失主，獲得謝禮{amount}元'),
  F('kb-f-kaiju', 0, '被怪獸頭嚇到', '被東寶大樓的怪獸頭嚇了一跳，手機摔壞了'),
  F('kb-f-parttime', 1, '打工領薪水', '到居酒屋打工，領到薪水{amount}元', '幫忙發傳單，領到零用錢{amount}元'),
  F('kb-f-gang', 2, '黑幫收小弟', '黑幫大哥看上你，收你當小弟', '黑幫大哥看了你一眼，說「小朋友快回家」就走開了'),
  F('kb-f-trouble', 0, '店裡有人鬧事', '有人在你的店裡鬧事，砸壞了裝潢'),
  F('kb-f-fake', 0, '買到假名牌', '買到假名牌包，被騙了{amount}元', '買到假的限量玩具，被騙了{amount}元'),
  F('kb-f-photo', 1, '被街拍', '被街拍攝影師拍到，上了雜誌'),
  F('kb-f-lottery', 1, '抽中特獎', '柏青哥店週年抽獎抽中特獎', '商店街抽獎抽中特獎'),
  F('kb-f-taxi', 2, '被載到柏青哥店', '計程車司機把你載到柏青哥店門口', '公車坐過站，在柏青哥店門口下車'),
  F('kb-f-casino', 0, '走進地下賭場', '迷迷糊糊走進地下賭場', '迷路了，在巷子裡繞了一圈'),
  F('kb-f-lasttrain', 0, '錯過末班車', '錯過末班電車，在網咖過夜', '補習班下課太晚，在車站等家人來接'),
  F('kb-f-slip', 0, '巷子裡滑倒', '在濕滑的巷子裡滑倒'),
  F('kb-f-fight', 0, '喝醉打架', '喝醉跟人打架，被拘留2天', '在遊樂場跟人吵架，被家人禁足2回合'),
  F('kb-f-referral', 1, '介紹客人', '幫店家介紹客人，每位對手付你介紹費{amount}元', '幫店家發傳單，每位對手付你{amount}元'),
  F('kb-f-sign', 0, '招牌被吹落', '招牌被大風吹落'),
  F('kb-f-vip', 1, 'VIP會員卡', '拿到VIP會員卡', '拿到居酒屋的兒童會員卡'),
  F('kb-f-omikuji', 1, '求到大吉籤', '花園神社求到大吉籤'),
  F('kb-f-flyers', 1, '發傳單', '幫忙發傳單，領到點券和現金'),
  F('kb-f-gift', 1, '收到禮物', '{host}送你禮物', '店門口的阿姨送你糖果和一張卡片'),
  F('kb-f-skimming', 0, '信用卡被盜刷', '信用卡被盜刷', '零用錢存摺被盜領'),
];
export const KB_CARDS = [...KB_NEWS, ...KB_FATE];
/** Board ids of these cards (the news / fate box): 2000 + index (1000.. are 大富豪模式's local events). */
export const KB_ID_BASE = 2000;
export const kbCardById = (id: number): KbCard | undefined => (id >= KB_ID_BASE ? KB_CARDS[id - KB_ID_BASE] : undefined);
