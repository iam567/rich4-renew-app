/**
 * 自建地圖's card library (the user 2026-11-12: 「新聞100張，命運100張，連老卡一塊兒，都是通用的」): every news and fate
 * card that works on any map. The original decks (36 news, 37 fate; events.ts, ids `o-n-N` / `o-f-N`) and these:
 *
 * - The five cities' local cards (regional-data.ts) with their place names taken out — the same effects, words that fit
 *   any town (50 news, 50 fate). `art`: the local card's own picture until a general one is drawn.
 * - New ones for the effects the user listed (14 news, 13 fate): fines, money, prison, hospital, aliens, a trip abroad,
 *   cards and tools for everyone or taken from everyone, staying one or two turns, turning round.
 *
 * Effects are never edited by the players, only the words and the picture (the user: 「效果不改，只改字兒」); amounts
 * and days are filled in by the game ({amount}, {street}, {lot}, {s<slot>}). A card that needs another map's own
 * features (重慶, 歌舞伎町, 激情歲月) is not in the library at all.
 */
import type { FateEffect, NewsEffect, RegionalEvent, Tone } from './regional-data';

/** A card of the library: a regional-style event that belongs to no city (map 0); `art`: the picture it shows. */
export type GeneralCard = RegionalEvent & { art: string; isNew?: boolean };

const n = (id: string, tone: Tone, category: string, head: string, text: string, effect: NewsEffect, art: string, isNew = false): GeneralCard =>
  ({ id: `g-${id}`, map: 0, kind: 'news', tone, category, head, text, effect, art, ...(isNew ? { isNew } : {}) });
const f = (id: string, tone: Tone, head: string, text: string, effect: FateEffect, art: string, isNew = false): GeneralCard =>
  ({ id: `g-${id}`, map: 0, kind: 'fate', tone, head, text, effect, art, ...(isNew ? { isNew } : {}) });

export const GENERAL_CARDS: GeneralCard[] = [
  // ------------------------------------------------------------------ news, from the cities' local cards (50)
  n('n-sale', 'good', '財經新聞', '電器街週末大特賣', '電器街週末大特賣，人潮擠爆\n{s6}、{s8}股價連漲2天', { t: 'stocks', slots: [6, 8], up: true, days: 2 }, 'tokyo-n-akiba'),
  n('n-blossom', 'good', '社會新聞', '公園花季盛開', '公園花季盛開，賞花人潮帶旺商圈\n地主每棟房屋收入{amount}元', { t: 'per-lot', amount: 600, cap: 6000 }, 'tokyo-n-hanami'),
  n('n-redevelop', 'good', '政府公告', '市中心再開發計畫通過', '市中心再開發計畫通過\n{street}地價上漲20％', { t: 'street', factor: 1.2 }, 'tokyo-n-redevelop'),
  n('n-concert', 'good', '社會新聞', '巨星演唱會連開三場', '巨星演唱會連開三場，飯店商場客滿\n大型用地每級收入{amount}元', { t: 'facility', amount: 1000, cap: 5000 }, 'tokyo-n-dome'),
  n('n-tourists', 'good', '財經新聞', '觀光客人數創新高', '觀光客人數創新高\n在地企業盈餘大增，股價上漲', { t: 'company', delta: 20000, up: true }, 'tokyo-n-tourists'),
  n('n-rush', 'bad', '路況報導', '通勤電車大誤點', '尖峰時段電車大誤點，全城交通癱瘓\n所有人停留一回合', { t: 'stay', who: 'all' }, 'tokyo-n-rush'),
  n('n-proptax', 'bad', '政府公告', '加徵固定資產稅', '政府加徵固定資產稅\n地主繳交地產價值的3％', { t: 'value-tax', percent: 3, cap: 15000 }, 'tokyo-n-proptax'),
  n('n-flood', 'bad', '氣象報導', '豪雨成災，地下街淹水', '豪雨襲擊市區，地下街淹水\n兩棟房屋受損', { t: 'damage', lots: 2, levels: 1 }, 'tokyo-n-guerrilla'),
  n('n-quake', 'bad', '氣象報導', '強烈地震', '發生強烈地震\n{lot}一帶的房屋各降一級', { t: 'area', radius: 120 }, 'tokyo-n-quake'),
  n('n-crash', 'bad', '財經新聞', '股市閃電崩跌', '股市閃電崩跌\n12支股票連跌2天', { t: 'stocks', slots: 'all', up: false, days: 2 }, 'tokyo-n-crash'),
  n('n-festival', 'good', '社會新聞', '夏日祭典萬人空巷', '夏日祭典萬人空巷\n每人收到祭典紅包{amount}元', { t: 'everyone', amount: 1500 }, 'osaka-n-tenjin'),
  n('n-expo', 'good', '財經新聞', '博覽會帶動開發', '博覽會帶動新區開發\n12支股票上漲一成', { t: 'stocks', slots: 'all', up: true, days: 1 }, 'osaka-n-expo'),
  n('n-market', 'good', '政府公告', '傳統市場人潮回流', '傳統市場人潮回流\n表揚第一大地主，獎金{amount}元', { t: 'top-owner', amount: 6000 }, 'osaka-n-kuromon'),
  n('n-arcade', 'good', '政府公告', '商店街整修補助', '商店街拱廊整修補助\n{lot}的房屋免費加蓋一層', { t: 'renovate' }, 'osaka-n-arcade'),
  n('n-shopping', 'good', '社會新聞', '觀光客爆買', '觀光客瘋狂爆買\n地主每棟房屋收入{amount}元', { t: 'per-lot', amount: 300, cap: 3000 }, 'osaka-n-shopping'),
  n('n-fans', 'bad', '路況報導', '球迷上街慶祝奪冠', '在地球隊奪冠，球迷湧上街頭慶祝\n交通癱瘓，所有人停留一回合', { t: 'stay', who: 'all' }, 'osaka-n-fans'),
  n('n-signboard', 'bad', '氣象報導', '強風吹落巨型招牌', '強風豪雨，巨型招牌掉落\n{lot}的房屋受損', { t: 'damage', lots: 1, levels: 1 }, 'osaka-n-signboard'),
  n('n-appliance', 'bad', '財經新聞', '家電大廠財報虧損', '家電大廠財報虧損\n{s6}、{s8}股價連跌2天', { t: 'stocks', slots: [6, 8], up: false, days: 2 }, 'osaka-n-appliance'),
  n('n-subside', 'bad', '社會新聞', '地層下陷', '地層下陷調查出爐\n{street}地價下跌15％', { t: 'street', factor: 0.85 }, 'osaka-n-subside'),
  n('n-flu', 'bad', '社會新聞', '流感大流行', '流感大流行\n每人付醫藥費{amount}元', { t: 'everyone', amount: -2500 }, 'osaka-n-flu'),
  n('n-snowfest', 'good', '社會新聞', '冰雪節開幕', '冰雪節開幕，觀光客湧入\n地主每棟房屋收入{amount}元', { t: 'per-lot', amount: 700, cap: 7000 }, 'sapporo-n-yukimatsuri'),
  n('n-beer', 'good', '財經新聞', '啤酒花園開幕', '啤酒花園開幕，大排長龍\n{s9}股價連漲3天', { t: 'stocks', slots: [9], up: true, days: 3 }, 'sapporo-n-beer'),
  n('n-harvest', 'good', '社會新聞', '農產大豐收', '農產大豐收，農會發放紅利\n每人得到{amount}元', { t: 'everyone', amount: 2500 }, 'sapporo-n-harvest'),
  n('n-ski', 'good', '社會新聞', '滑雪季遊客湧入', '滑雪季開跑，遊客湧入\n大型用地每級收入{amount}元', { t: 'facility', amount: 1200, cap: 7000 }, 'sapporo-n-ski'),
  n('n-railway', 'good', '政府公告', '高鐵延伸工程動工', '高鐵延伸工程正式動工\n{street}地價上漲20％', { t: 'street', factor: 1.2 }, 'sapporo-n-shinkansen'),
  n('n-avalanche', 'bad', '氣象報導', '大雪壓垮房屋', '連日大雪\n兩棟房屋被積雪壓毀，各降一級', { t: 'damage', lots: 2, levels: 1 }, 'sapporo-n-avalanche'),
  n('n-blizzard', 'bad', '路況報導', '暴風雪封路', '暴風雪封鎖道路，全城停擺\n所有人停留一回合', { t: 'stay', who: 'all' }, 'sapporo-n-blizzard'),
  n('n-snowfee', 'bad', '政府公告', '加收除雪費', '除雪費用暴增，政府加收除雪費\n地主每級房屋繳交{amount}元', { t: 'per-level', amount: 300, cap: 4000 }, 'sapporo-n-snowfee'),
  n('n-warehouse', 'bad', '財經新聞', '暴雪壓垮倉庫', '暴雪壓垮倉庫，在地企業虧損\n股價下跌', { t: 'company', delta: -10000, up: false }, 'sapporo-n-warehouse'),
  n('n-bear', 'bad', '社會新聞', '野熊闖入市區', '野熊闖入郊區住宅區\n{street}地價下跌15％', { t: 'street', factor: 0.85 }, 'sapporo-n-bear'),
  n('n-stalls', 'good', '社會新聞', '夜市小吃大排長龍', '夜市小吃攤觀光客大排長龍\n地主每棟房屋收入{amount}元', { t: 'per-lot', amount: 500, cap: 5000 }, 'kyushu-n-yatai'),
  n('n-lantern', 'good', '財經新聞', '燈會開幕', '燈會開幕，觀光收入增加\n在地企業盈餘大增，股價上漲', { t: 'company', delta: 20000, up: true }, 'kyushu-n-lantern'),
  n('n-factory', 'good', '政府公告', '科技大廠進駐', '科技大廠宣布進駐\n{street}地價上漲20％', { t: 'street', factor: 1.2 }, 'kyushu-n-chips'),
  n('n-lucky-train', 'good', '社會新聞', '觀光列車週年抽獎', '觀光列車週年慶\n每人抽一張卡片', { t: 'cards-all' }, 'kyushu-n-train'),
  n('n-cars', 'good', '財經新聞', '汽車工廠增產', '汽車工廠增產\n{s5}、{s9}股價連漲2天', { t: 'stocks', slots: [5, 9], up: true, days: 2 }, 'kyushu-n-cars'),
  n('n-volcano', 'bad', '氣象報導', '火山噴發', '火山噴發，火山灰覆蓋全城\n地主每級房屋清潔費{amount}元', { t: 'per-level', amount: 200, cap: 3000 }, 'kyushu-n-sakurajima'),
  n('n-typhoon-area', 'bad', '氣象報導', '颱風登陸', '強烈颱風登陸\n{lot}一帶的房屋各降一級', { t: 'area', radius: 150 }, 'kyushu-n-typhoon'),
  n('n-landslide', 'bad', '氣象報導', '豪雨引發土石流', '豪雨引發土石流\n{lot}的房屋降兩級', { t: 'damage', lots: 1, levels: 2 }, 'kyushu-n-landslide'),
  n('n-smoke', 'bad', '社會新聞', '火山噴煙，旅館停業', '火山噴煙，周邊旅館停業\n大型用地每級損失{amount}元', { t: 'facility', amount: -800, cap: 5000 }, 'kyushu-n-aso'),
  n('n-power', 'bad', '政府公告', '電費調漲', '燃料費高漲，電費調漲\n每人多繳{amount}元', { t: 'everyone', amount: -1000 }, 'kyushu-n-power'),
  n('n-resort', 'good', '社會新聞', '旅遊旺季飯店客滿', '旅遊旺季，度假飯店間間客滿\n旅館每級收入{amount}元', { t: 'facility', amount: 1200, cap: 6000, hotels: true }, 'okinawa-n-resort'),
  n('n-aquarium', 'good', '社會新聞', '水族館鯨鯊寶寶誕生', '水族館鯨鯊寶寶誕生，觀光客大增\n地主每棟房屋收入{amount}元', { t: 'per-lot', amount: 500, cap: 5000 }, 'okinawa-n-aquarium'),
  n('n-drums', 'good', '社會新聞', '太鼓祭典登場', '太鼓祭典熱鬧登場\n每人得到{amount}元', { t: 'everyone', amount: 1500 }, 'okinawa-n-eisa'),
  n('n-beerfest', 'good', '財經新聞', '夏季啤酒節', '夏季啤酒節開跑\n{s8}、{s2}股價連漲2天', { t: 'stocks', slots: [8, 2], up: true, days: 2 }, 'okinawa-n-beer'),
  n('n-newresort', 'good', '政府公告', '新度假區開發', '新度假區開發計畫通過\n{street}地價上漲20％', { t: 'street', factor: 1.2 }, 'okinawa-n-newresort'),
  n('n-typhoon', 'bad', '氣象報導', '颱風來襲', '颱風來襲，交通全面停擺\n所有人停留一回合，{lot}的房屋受損', { t: 'typhoon' }, 'okinawa-n-typhoon'),
  n('n-rainy', 'bad', '社會新聞', '梅雨季遊客取消行程', '梅雨季遊客紛紛取消行程\n大型用地每級損失{amount}元', { t: 'facility', amount: -600, cap: 3000 }, 'okinawa-n-rainy'),
  n('n-pollution', 'bad', '財經新聞', '工廠污染被罰', '工廠排放污染被查獲\n在地企業被罰款，股價下跌', { t: 'company', delta: -10000, up: false }, 'okinawa-n-redsoil'),
  n('n-snake', 'bad', '社會新聞', '毒蛇出沒', '毒蛇在郊區出沒\n一人被咬傷，住院2天', { t: 'one-hospital', days: 2 }, 'okinawa-n-habu'),
  n('n-salt', 'bad', '氣象報導', '海風鹽害', '海風鹽害腐蝕房屋\n{lot}的房屋受損', { t: 'damage', lots: 1, levels: 1 }, 'okinawa-n-salt'),
  // ------------------------------------------------------------------ news, new (14)
  n('n-bonus', 'good', '政府公告', '政府發放消費券', '政府發放消費券振興經濟\n每人得到{amount}元', { t: 'everyone', amount: 3000 }, 'sapporo-n-harvest', true),
  n('n-lottery-day', 'good', '社會新聞', '全民抽獎日', '商店街舉辦全民抽獎日\n每人得到兩張卡片', { t: 'cards-all', n: 2 }, 'kyushu-n-train', true),
  n('n-toyfair', 'good', '社會新聞', '玩具博覽會送贈品', '玩具博覽會開幕，入場送贈品\n每人得到一個道具', { t: 'tools-all' }, 'tokyo-n-akiba', true),
  n('n-inspection', 'bad', '政府公告', '違禁品大檢查', '警方展開違禁品大檢查\n每人被沒收一個道具', { t: 'take-tools' }, 'tokyo-n-rush', true),
  n('n-marathon', 'bad', '路況報導', '城市馬拉松封路', '城市馬拉松全天封路\n所有人停留一回合', { t: 'stay', who: 'all' }, 'osaka-n-fans', true),
  n('n-roadworks', 'bad', '路況報導', '道路大施工', '主要道路同時施工，到處繞道\n所有人停留兩回合', { t: 'stay', who: 'all', turns: 2 }, 'tokyo-n-rush', true),
  n('n-detour', 'bad', '路況報導', '單行道改向', '交通局一夜改了單行道方向\n所有人向後轉', { t: 'turn-all' }, 'osaka-n-fans', true),
  n('n-tax-refund', 'good', '政府公告', '退稅入帳', '去年多繳的稅退回來了\n每人得到{amount}元', { t: 'everyone', amount: 2000 }, 'sapporo-n-harvest', true),
  n('n-heatwave', 'bad', '氣象報導', '熱浪來襲', '熱浪來襲，冷氣全天開\n每人付電費{amount}元', { t: 'everyone', amount: -1500 }, 'kyushu-n-power', true),
  n('n-food-poison', 'bad', '社會新聞', '園遊會食物中毒', '園遊會發生食物中毒\n一人住院3天', { t: 'one-hospital', days: 3 }, 'osaka-n-flu', true),
  n('n-housing', 'good', '政府公告', '老屋翻新補助', '政府推出老屋翻新補助\n{lot}的房屋免費加蓋一層', { t: 'renovate' }, 'osaka-n-arcade', true),
  n('n-bull', 'good', '財經新聞', '股市大多頭', '外資大舉買進，股市大多頭\n12支股票連漲2天', { t: 'stocks', slots: 'all', up: true, days: 2 }, 'osaka-n-expo', true),
  n('n-landlord', 'good', '政府公告', '模範地主表揚', '政府表揚模範地主\n第一大地主獲得獎金{amount}元', { t: 'top-owner', amount: 8000 }, 'osaka-n-kuromon', true),
  n('n-garbage', 'bad', '政府公告', '垃圾費隨屋徵收', '垃圾清運費改為隨屋徵收\n地主每級房屋繳交{amount}元', { t: 'per-level', amount: 200, cap: 3000 }, 'sapporo-n-snowfee', true),
  // ------------------------------------------------------------------ fate, from the cities' local cards (50)
  f('f-concert-job', 'good', '演唱會打工', '到演唱會打工，領到加班費{amount}元', { t: 'gain', amount: 5000 }, 'tokyo-f-dome'),
  f('f-tuna', 'good', '魚市場競標', '在魚市場標到頂級鮪魚，轉手賺了{amount}元', { t: 'gain', amount: 6000 }, 'tokyo-f-tuna'),
  f('f-robot', 'good', '買到新玩具', '在電器街買到最新型的機器娃娃', { t: 'tool', id: 1 }, 'tokyo-f-robot'),
  f('f-omikuji', 'good', '求籤抽到大吉', '到廟裡求籤抽到大吉，獲得免罪卡', { t: 'card', id: 21 }, 'tokyo-f-omikuji'),
  f('f-esports', 'good', '電玩大賽奪冠', '參加電玩大賽奪冠，獲得{amount}點券', { t: 'points', amount: 150 }, 'tokyo-f-esports'),
  f('f-crush', 'bad', '擠電車被擠傷', '尖峰時間擠電車被擠傷，住院3天', { t: 'hospital', days: 3 }, 'tokyo-f-crush'),
  f('f-bar', 'bad', '酒店被當肥羊', '在酒店被當肥羊，酒錢付了{amount}元', { t: 'fine', amount: 10000 }, 'tokyo-f-ginza'),
  f('f-lost-station', 'bad', '車站迷路', '在大車站的迷宮裡迷路，停留一回合', { t: 'stay' }, 'tokyo-f-shinjuku'),
  f('f-pickpocket', 'bad', '路口被扒', '在熱鬧的十字路口被扒，掉了一張卡片', { t: 'lose-card' }, 'tokyo-f-pickpocket'),
  f('f-party', 'bad', '街頭狂歡鬧事', '在街頭狂歡鬧事，被拘留3天', { t: 'prison', days: 3 }, 'tokyo-f-party'),
  f('f-snack', 'good', '小吃攤副業', '小吃攤副業生意興隆，賺了{amount}元', { t: 'gain', amount: 5000 }, 'osaka-f-takoyaki'),
  f('f-10000th', 'good', '第一萬名客人', '成為人氣餐廳的第一萬名客人，獎金{amount}元', { t: 'gain', amount: 3000 }, 'osaka-f-kushikatsu'),
  f('f-comedy', 'good', '相聲表演大受歡迎', '上台表演相聲大受歡迎，觀眾送你兩張卡片', { t: 'card', id: 0, n: 2 }, 'osaka-f-manzai'),
  f('f-bargain', 'good', '殺價成功', '在電器街殺價成功，買到便宜的遙控骰子', { t: 'tool', id: 8 }, 'osaka-f-bargain'),
  f('f-lucky-god', 'good', '摸福神許願', '摸了福神像的腳底許願，房子免費加蓋一層', { t: 'upgrade' }, 'osaka-f-billiken'),
  f('f-eat', 'bad', '美食街吃到倒', '在美食街吃到倒，花了{amount}元', { t: 'fine', amount: 7000 }, 'osaka-f-kuidaore'),
  f('f-jump', 'bad', '跳河慶祝被帶走', '跳進河裡慶祝，被警察帶走拘留2天', { t: 'prison', days: 2 }, 'osaka-f-dive'),
  f('f-queue', 'bad', '主題樂園大排長龍', '主題樂園大排長龍，排到天黑，停留一回合', { t: 'stay' }, 'osaka-f-queue'),
  f('f-burn', 'bad', '煎餅燙傷', '煎鐵板燒時燙傷了手，住院2天', { t: 'hospital', days: 2 }, 'osaka-f-okonomi'),
  f('f-haggle', 'bad', '被殺價殺到賠本', '在市場擺攤被大嬸殺價殺到賠本，損失{amount}元', { t: 'fine', amount: 5000 }, 'osaka-f-haggle'),
  f('f-ramen', 'good', '大胃王比賽奪冠', '參加拉麵大胃王比賽奪冠，獎金{amount}元', { t: 'gain', amount: 5000 }, 'sapporo-f-ramen'),
  f('f-crab', 'good', '捕到大螃蟹', '出海捕到大帝王蟹，賣了{amount}元', { t: 'gain', amount: 6000 }, 'sapporo-f-crab'),
  f('f-icesculpt', 'good', '冰雕比賽得獎', '參加冰雕比賽得獎，獲得{amount}點券', { t: 'points', amount: 120 }, 'sapporo-f-icesculpt'),
  f('f-hibernate', 'good', '溫泉巧遇冬眠熊', '泡溫泉時巧遇冬眠中的熊，獲得冬眠卡', { t: 'card', id: 15 }, 'sapporo-f-onsen-bear'),
  f('f-envelope', 'good', '公園撿到紅包', '在公園的雪堆裡撿到紅包，裡面有{amount}元', { t: 'gain', amount: 3000 }, 'sapporo-f-envelope'),
  f('f-roofsnow', 'bad', '屋頂積雪滑落', '屋頂積雪滑落被壓傷，住院3天', { t: 'hospital', days: 3 }, 'sapporo-f-roofsnow'),
  f('f-entry-fee', 'bad', '活動報名費', '參加冰雪節，報名費加上裝備花了{amount}元', { t: 'fine', amount: 3000 }, 'sapporo-f-festival-fee'),
  f('f-drinks', 'bad', '喝到天亮', '在酒吧街喝到天亮，酒錢{amount}元', { t: 'fine', amount: 4000 }, 'sapporo-f-susukino'),
  f('f-slip', 'bad', '雪地滑倒', '在結冰的路上滑倒，停留一回合', { t: 'stay' }, 'sapporo-f-slip'),
  f('f-pipes', 'bad', '水管結冰爆裂', '水管結冰爆裂，房屋每級修理費{amount}元', { t: 'repair', perLevel: 500, cap: 4000 }, 'sapporo-f-pipes'),
  f('f-hotspring', 'good', '溫泉泡湯', '泡溫泉泡得神清氣爽，獲得{amount}點券', { t: 'points', amount: 100 }, 'kyushu-f-beppu'),
  f('f-janken', 'good', '猜拳贏了老闆', '在小吃攤跟老闆猜拳贏了，獎金{amount}元', { t: 'gain', amount: 4000 }, 'kyushu-f-janken'),
  f('f-souvenir', 'good', '伴手禮生意興隆', '伴手禮蛋糕生意興隆，賺了{amount}元', { t: 'gain', amount: 5000 }, 'kyushu-f-castella'),
  f('f-antique', 'good', '古董鑑定是真品', '家裡的古董鑑定是真品，賣了{amount}元', { t: 'gain', amount: 6000 }, 'kyushu-f-arita'),
  f('f-rebuild', 'good', '重建補助', '老城重建補助，你的房子免費加蓋一層', { t: 'upgrade' }, 'kyushu-f-rebuild'),
  f('f-gas', 'bad', '吸到火山氣體', '登火山吸到火山氣體，住院2天', { t: 'hospital', days: 2 }, 'kyushu-f-aso-gas'),
  f('f-delay', 'bad', '班機延誤', '豪雨班機延誤，困在機場，停留一回合', { t: 'stay' }, 'kyushu-f-delay'),
  f('f-themepark', 'bad', '樂園玩過頭', '在主題樂園玩過頭，花了{amount}元', { t: 'fine', amount: 5000 }, 'kyushu-f-windmill'),
  f('f-smuggle', 'bad', '幫人搬到走私貨', '在港口幫人搬貨，竟是走私品，坐牢3天', { t: 'prison', days: 3 }, 'kyushu-f-smuggle'),
  f('f-donate', 'bad', '捐款重建古蹟', '古蹟重建募款，捐出{amount}點券', { t: 'points', amount: -100 }, 'kyushu-f-donation'),
  f('f-invest', 'good', '度假村投資賺錢', '投資的度假村生意興隆，盈利{amount}元', { t: 'gain', amount: 6000 }, 'okinawa-f-resort'),
  f('f-wreck', 'good', '潛水找到寶物', '潛水找到古代沉船寶物，賣了{amount}元', { t: 'gain', amount: 7000 }, 'okinawa-f-wreck'),
  f('f-bottle', 'good', '海灘撿到漂流瓶', '在海灘撿到漂流瓶，裡面是一張卡片', { t: 'card', id: 0 }, 'okinawa-f-bottle'),
  f('f-guardian', 'good', '石獅保佑', '在家門口擺了一對石獅，獲得天使卡', { t: 'card', id: 9 }, 'okinawa-f-shisa'),
  f('f-stall', 'good', '夜市擺攤', '在夜市擺攤賣紀念品，賺了{amount}元', { t: 'gain', amount: 4000 }, 'okinawa-f-kokusai'),
  f('f-jellyfish', 'bad', '被水母螫傷', '浮潛時被水母螫傷，住院2天', { t: 'hospital', days: 2 }, 'okinawa-f-jellyfish'),
  f('f-grounded', 'bad', '颱風班機停飛', '颱風來襲班機停飛，困在機場一回合', { t: 'stay' }, 'okinawa-f-flight'),
  f('f-sunburn', 'bad', '曬傷脫皮', '在海灘曬傷脫皮，買藥花了{amount}元', { t: 'fine', amount: 2000 }, 'okinawa-f-sunburn'),
  f('f-wallet', 'bad', '浮潛弄丟錢包', '浮潛時弄丟了錢包，損失{amount}元', { t: 'fine', amount: 3000 }, 'okinawa-f-wallet'),
  f('f-drunk', 'bad', '喝醉倒在路邊', '酒喝太多，醉倒在路邊，停留一回合', { t: 'stay' }, 'okinawa-f-awamori'),
  // ------------------------------------------------------------------ fate, new (13)
  f('f-aliens', 'bad', '被外星人帶走', '半夜看見飛碟，被外星人帶走4天', { t: 'vanish', days: 4, alien: true }, 'tokyo-f-party', true),
  f('f-abroad', 'bad', '出國觀光', '抽中旅行社招待券，出國觀光4天', { t: 'vanish', days: 4, alien: false }, 'kyushu-f-delay', true),
  f('f-turn', 'bad', '走錯方向', '一路聊天沒看路，才發現走錯方向，向後轉', { t: 'turn' }, 'tokyo-f-shinjuku', true),
  f('f-stay2', 'bad', '感冒在家休養', '重感冒在家休養，停留兩回合', { t: 'stay', turns: 2 }, 'osaka-f-queue', true),
  f('f-cards2', 'good', '朋友送卡片', '老朋友來訪，送你兩張卡片', { t: 'card', id: 0, n: 2 }, 'osaka-f-manzai', true),
  f('f-card1', 'good', '撿到卡片', '在路邊撿到一張卡片', { t: 'card', id: 0 }, 'okinawa-f-bottle', true),
  f('f-tool', 'good', '抽獎抽中道具', '百貨公司週年慶抽獎，抽中一個道具', { t: 'tool', id: 0 }, 'tokyo-f-robot', true),
  f('f-speeding', 'bad', '闖紅燈罰款', '趕時間闖紅燈被開罰單，罰款{amount}元', { t: 'fine', amount: 4000 }, 'osaka-f-haggle', true),
  f('f-bigfine', 'bad', '違建被罰', '自家屋頂加蓋違建被查到，罰款{amount}元', { t: 'fine', amount: 8000 }, 'tokyo-f-ginza', true),
  f('f-refund', 'good', '保險理賠到帳', '上個月的保險理賠到帳了，得到{amount}元', { t: 'gain', amount: 4000 }, 'sapporo-f-envelope', true),
  f('f-prize', 'good', '中了刮刮樂', '隨手買的刮刮樂中獎，得到{amount}元', { t: 'gain', amount: 8000 }, 'okinawa-f-wreck', true),
  f('f-fraud', 'bad', '被詐騙集團騙', '接到假冒親戚的電話，被騙走{amount}元', { t: 'fine', amount: 6000 }, 'tokyo-f-pickpocket', true),
  f('f-fight', 'bad', '打架被拘留', '在路邊跟人起衝突打了起來，被拘留4天', { t: 'prison', days: 4 }, 'osaka-f-dive', true),
];

/** The original decks' ids in the library: `o-n-0`..`o-n-35`, `o-f-0`..`o-f-36`. */
export const ORIG_NEWS = 36, ORIG_FATE = 37;
/** The original entries' headlines as the library lists them (events.ts shows their full texts; docs/rules/06 §3–4). */
export const ORIG_NEWS_NAMES = ['囚犯無罪開釋', '囚犯延長刑期', '病患提前出院', '延長住院', '外星人攻打地球', '外星怪獸摧毀建築',
  '地段地價上漲', '公開拍賣公有土地', '表揚第一大地主', '補助土地最少者', '表揚股市大戶', '所得稅', '地價稅', '證交稅', '鬧鬼，地價下跌',
  '瓦斯爆炸', '豪雨，行人停一回合', '交通阻塞', '強烈地震', '山洪，土地流失', '超級颱風', '龍捲風', '銀行停止放款', '儲金紅利', '股市崩盤',
  '股市全面上漲', '股市暫停交易', '個股停牌', '個股恢復上市', '企業違法超貸', '工廠排污罰款', '海外投資獲利', '海外投資虧損', '違規開發山坡地',
  '製造噪音', '企業獲利倍增'];
export const ORIG_FATE_NAMES = ['強制拆除房屋', '強制徵收土地', '被冒名貸款', '支票跳票', '入侵銀行電腦', '生日快樂', '出國觀光', '被外星人綁架',
  '違約交割', '變賣所有股票', '機車被偷', '汽車撞電線桿', '掉進水溝', '騎機車摔傷', '行人闖越馬路', '騎機車未戴安全帽', '開車超速', '請所有人吃大餐',
  '亂丟垃圾', '小狗隨地便溺', '路邊撿到錢', '路邊撿到錢', '路邊撿到錢', '遺失錢包', '遺失錢包', '意外獲得遺產', '被倒會', '發票中獎', '發票中獎',
  '發票中獎', '繳交保險金', '領取保險金', '變賣卡片道具', '坐牢（一）', '坐牢（二）', '坐牢（三）', '坐牢（四）'];
/** Every card of the library for one kind: id, its name, whether it is new, the general card itself (none for an original). */
export function library(kind: 'news' | 'fate'): { id: string; name: string; tone?: 'good' | 'bad'; isNew?: boolean; card?: GeneralCard }[] {
  const orig = kind === 'news' ? ORIG_NEWS_NAMES.map((name, i) => ({ id: `o-n-${i}`, name })) : ORIG_FATE_NAMES.map((name, i) => ({ id: `o-f-${i}`, name }));
  return [...orig, ...GENERAL_CARDS.filter(c => c.kind === kind).map(c => ({ id: c.id, name: c.head, tone: c.tone, isNew: c.isNew, card: c }))];
}
export const generalCard = (id: string) => GENERAL_CARDS.find(c => c.id === id);
