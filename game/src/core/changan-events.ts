/**
 * 長安's own news (開元雜報) and fate (卜肆) decks — generated from docs/changan-events.json (the user 2026-11-18/19):
 * effects as the regional events' (modules/regional-data.ts), amounts {min, max, step} drawn at random, `orig` the
 * original entry n's rules in Tang words, `wreck` the original vehicle fate (only when riding), `exile` to 發配所.
 * Pictures: maps/remake/events/<id>.webp. Do not edit by hand: re-run the generator in the commit that adds it.
 */
export interface CnEvent { id: string; tone: 'good' | 'bad'; head: string; text: string; effect: { t: string; [k: string]: unknown }; when?: { months?: number[] }; only?: string; pics?: Record<string, string> }
export const CHANGAN_NEWS: CnEvent[] = [
{
"id": "ca-n-lantern",
"tone": "good",
"head": "上元燈會三夜開禁",
"text": "正月十五上元節，長安開禁三夜，萬人觀燈\n每人得到賞燈紅包{amount}文",
"effect": {
"t": "everyone",
"amount": 1500
},
"when": {
"months": [
1,
2
]
}
},
{
"id": "ca-n-jinshi",
"tone": "good",
"head": "新科進士曲江賜宴",
"text": "新科進士曲江賜宴，杏園探花，進士們爭做新袍\n{s10}股價連漲2天",
"effect": {
"t": "stocks",
"slots": [
10
],
"up": true,
"days": 2
}
},
{
"id": "ca-n-kaiyuan",
"tone": "good",
"head": "開元盛世五穀豐登",
"text": "開元盛世，稻米流脂粟米白\n每人得到{amount}文",
"effect": {
"t": "everyone",
"amount": 2000
}
},
{
"id": "ca-n-ricedear",
"tone": "bad",
"head": "長安米貴居大不易",
"text": "京城米價飛漲，居大不易\n每人付米錢{amount}文",
"effect": {
"t": "everyone",
"amount": -1500
}
},
{
"id": "ca-n-caravan",
"tone": "good",
"head": "西域駝隊抵達西市",
"text": "西域駝隊滿載香料珠寶抵達西市\n{s4}、{s9}股價連漲2天",
"effect": {
"t": "stocks",
"slots": [
4,
9
],
"up": true,
"days": 2
}
},
{
"id": "ca-n-envoys",
"tone": "good",
"head": "遣唐使入京朝貢",
"text": "日本遣唐使入京，帶來各國奇珍\n每人抽一張卡片",
"effect": {
"t": "cards-all"
}
},
{
"id": "ca-n-xuanzang",
"tone": "good",
"head": "玄奘法師西行歸來",
"text": "玄奘法師取經歸來，全城夾道相迎\n長安在地商號盈餘大增，股價上漲",
"effect": {
"t": "company",
"delta": 20000,
"up": true
}
},
{
"id": "ca-n-nishang",
"tone": "good",
"head": "霓裳羽衣曲首演",
"text": "梨園首演霓裳羽衣曲，聖上大悅，賞賜滿城\n每人得到賞錢{amount}文",
"effect": {
"t": "everyone",
"amount": 1000
}
},
{
"id": "ca-n-drought",
"tone": "bad",
"head": "關中大旱",
"text": "關中大旱，井水乾涸，酒坊停釀\n{s1}、{s11}股價連跌2天",
"effect": {
"t": "stocks",
"slots": [
1,
11
],
"up": false,
"days": 2
}
},
{
"id": "ca-n-locusts",
"tone": "bad",
"head": "蝗蟲過境",
"text": "蝗蟲過境，遮天蔽日\n兩棟房屋受損，各降一級",
"effect": {
"t": "damage",
"lots": 2,
"levels": 1
}
},
{
"id": "ca-n-snow",
"tone": "bad",
"head": "長安大雪",
"text": "長安連降大雪，坊門難開\n所有人停留一回合",
"effect": {
"t": "stay",
"who": "all"
},
"when": {
"months": [
12,
1,
2
]
}
},
{
"id": "ca-n-weiflood",
"tone": "bad",
"head": "渭水氾濫",
"text": "渭水暴漲氾濫\n{lot}的房屋受損",
"effect": {
"t": "damage",
"lots": 1,
"levels": 1
}
},
{
"id": "ca-n-quake",
"tone": "bad",
"head": "地動山搖",
"text": "長安地震，屋瓦紛落\n{lot}一帶的房屋各降一級",
"effect": {
"t": "area",
"radius": 120
}
},
{
"id": "ca-n-daming",
"tone": "good",
"head": "大明宮落成",
"text": "大明宮落成，龍首原上氣象萬千\n{street}地價上漲20％",
"effect": {
"t": "street",
"factor": 1.2
}
},
{
"id": "ca-n-coins",
"tone": "good",
"head": "新鑄開元通寶",
"text": "朝廷新鑄開元通寶，錢法大定\n{s0}股價連漲3天",
"effect": {
"t": "stocks",
"slots": [
0
],
"up": true,
"days": 3
}
},
{
"id": "ca-n-curfew",
"tone": "bad",
"head": "金吾衛嚴查犯夜",
"text": "街鼓已絕，金吾衛嚴查犯夜\n路上走路的人停留一回合",
"effect": {
"t": "stay",
"who": "walk"
}
},
{
"id": "ca-n-huxuan",
"tone": "good",
"head": "胡旋舞風靡長安",
"text": "胡旋舞風靡長安，酒肆夜夜笙歌\n{s11}股價連漲2天",
"effect": {
"t": "stocks",
"slots": [
11
],
"up": true,
"days": 2
}
},
{
"id": "ca-n-peony",
"tone": "good",
"head": "牡丹花開動京城",
"text": "花開時節動京城，滿城爭看牡丹\n路上的人都掉頭回去看花",
"effect": {
"t": "turn-all"
},
"when": {
"months": [
4,
5
]
}
},
{
"id": "ca-n-polo",
"tone": "good",
"head": "大明宮馬球大賽",
"text": "大明宮球場舉行馬球大賽，全城同樂\n每人得到{amount}文",
"effect": {
"t": "everyone",
"amount": 1200
}
},
{
"id": "ca-n-sancai",
"tone": "good",
"head": "三彩陶俑熱銷",
"text": "三彩駱駝陶俑大受歡迎\n{s7}股價連漲2天",
"effect": {
"t": "stocks",
"slots": [
7
],
"up": true,
"days": 2
}
},
{
"id": "ca-n-silla",
"tone": "good",
"head": "新羅商船到港",
"text": "新羅商船帶來人參海貨\n每人得到一個道具",
"effect": {
"t": "tools-all"
}
},
{
"id": "ca-n-wencheng",
"tone": "good",
"head": "唐蕃和親",
"text": "文成公主入藏，唐蕃和好\n12支股票上漲一成",
"effect": {
"t": "stocks",
"slots": "all",
"up": true,
"days": 1
}
},
{
"id": "ca-n-wardwall",
"tone": "bad",
"head": "坊牆修葺",
"text": "朝廷下令修葺坊牆\n地主繳交地產價值的3％",
"effect": {
"t": "value-tax",
"percent": 3,
"cap": 15000
}
},
{
"id": "ca-n-epidemic",
"tone": "bad",
"head": "時疫流行",
"text": "京城時疫流行，藥鋪大排長龍\n每人付醫藥費{amount}文",
"effect": {
"t": "everyone",
"amount": -2500
}
},
{
"id": "ca-n-printing",
"tone": "good",
"head": "雕版印經問世",
"text": "雕版印刷的經卷問世，書肆生意興隆\n每人抽一張卡片",
"effect": {
"t": "cards-all"
}
},
{
"id": "ca-n-canal",
"tone": "bad",
"head": "漕運受阻",
"text": "江淮漕運受阻，關中缺糧\n{s8}股價連跌2天",
"effect": {
"t": "stocks",
"slots": [
8
],
"up": false,
"days": 2
}
},
{
"id": "ca-n-fire",
"tone": "bad",
"head": "東市大火",
"text": "東市失火，延燒數百家\n兩棟房屋受損，各降一級",
"effect": {
"t": "damage",
"lots": 2,
"levels": 1
}
},
{
"id": "ca-n-qujiang",
"tone": "good",
"head": "疏浚曲江池",
"text": "朝廷疏浚曲江池，遊人如織\n{street}地價上漲20％",
"effect": {
"t": "street",
"factor": 1.2
}
},
{
"id": "ca-n-pagoda",
"tone": "good",
"head": "大雁塔落成",
"text": "慈恩寺大雁塔落成，香火鼎盛\n{lot}的房屋免費加蓋一層",
"effect": {
"t": "renovate"
}
},
{
"id": "ca-n-tax",
"tone": "bad",
"head": "改行兩稅法",
"text": "朝廷改行兩稅法，夏秋兩徵\n每人繳納兩稅{amount}文",
"effect": {
"t": "everyone",
"amount": -2000
}
},
{
"id": "ca-n-anshi",
"tone": "bad",
"head": "安史之亂，叛軍攻入長安",
"text": "范陽叛軍攻破潼關，殺入長安\n{lot}一帶燒殺一空，房屋土地全失，在場的人受傷住院",
"effect": {
"t": "orig",
"n": 4
}
},
{
"id": "ca-n-tubo",
"tone": "bad",
"head": "吐蕃兵焚掠宅院",
"text": "吐蕃兵趁亂入城，放火焚掠\n{lot}的房屋燒毀，地主失去這塊地",
"effect": {
"t": "orig",
"n": 5
}
},
{
"id": "ca-n-flood",
"tone": "bad",
"head": "終南山洪，水土流失",
"text": "終南山暴雨，山洪直下\n{lot}被沖成荒地，地主失去這塊地",
"effect": {
"t": "orig",
"n": 19
}
},
{
"id": "ca-n-auction",
"tone": "good",
"head": "京兆府拍賣官地",
"text": "京兆府將一塊官地公開拍賣，價高者得",
"effect": {
"t": "orig",
"n": 7
}
},
{
"id": "ca-n-amnesty",
"tone": "good",
"head": "大赦天下",
"text": "新皇登基，大赦天下\n獄中的人全部提前出獄",
"effect": {
"t": "orig",
"n": 0
}
},
{
"id": "ca-n-sunsimiao",
"tone": "good",
"head": "藥王孫思邈義診",
"text": "藥王孫思邈入京義診\n住院的人全部提前出院",
"effect": {
"t": "orig",
"n": 2
}
},
{
"id": "ca-n-harshlaw",
"tone": "bad",
"head": "刑部加重刑期",
"text": "刑部嚴辦，獄中的人刑期各加3天",
"effect": {
"t": "orig",
"n": 1
}
},
{
"id": "ca-n-noherbs",
"tone": "bad",
"head": "藥材短缺",
"text": "藥材短缺，住院的人各多住3天",
"effect": {
"t": "orig",
"n": 3
}
},
{
"id": "ca-n-hushui",
"tone": "bad",
"head": "徵收戶稅",
"text": "朝廷按戶徵稅\n每人繳交現金的5％",
"effect": {
"t": "orig",
"n": 11
}
},
{
"id": "ca-n-shishui",
"tone": "bad",
"head": "徵收市稅",
"text": "市署徵收商稅\n每人繳交股票市值的5％",
"effect": {
"t": "orig",
"n": 13
}
},
{
"id": "ca-n-haunted",
"tone": "bad",
"head": "凶宅鬧鬼，地價下跌",
"text": "坊間盛傳凶宅鬧鬼\n{street}地價下跌三成",
"effect": {
"t": "orig",
"n": 14
}
},
{
"id": "ca-n-charcoal",
"tone": "bad",
"head": "炭火失火",
"text": "冬日炭盆失火\n{lot}的房屋受損，降一級",
"effect": {
"t": "orig",
"n": 15
}
},
{
"id": "ca-n-gale",
"tone": "bad",
"head": "大風拔木",
"text": "狂風大作，拔木折屋\n{lot}一帶的房屋各降一級，所幸無人受傷",
"effect": {
"t": "orig",
"n": 20
}
},
{
"id": "ca-n-whirlwind",
"tone": "bad",
"head": "旋風捲屋",
"text": "一陣旋風捲過\n{lot}的房屋受損，降一級",
"effect": {
"t": "orig",
"n": 21
}
},
{
"id": "ca-n-rain",
"tone": "bad",
"head": "秋雨連綿",
"text": "秋雨連綿，道路泥濘\n路上走路的人停留一回合",
"effect": {
"t": "orig",
"n": 16
}
},
{
"id": "ca-n-procession",
"tone": "bad",
"head": "天子出巡封街",
"text": "天子出巡，御道封街\n騎車開車的人停留一回合",
"effect": {
"t": "orig",
"n": 17
}
},
{
"id": "ca-n-closemarket",
"tone": "bad",
"head": "市署閉市十天",
"text": "市署下令閉市整頓\n10天內不能買賣股票",
"effect": {
"t": "orig",
"n": 26
}
},
{
"id": "ca-n-panic",
"tone": "bad",
"head": "市肆恐慌，股價全跌",
"text": "謠言四起，市肆恐慌\n12支股票全部下跌",
"effect": {
"t": "orig",
"n": 24
}
},
{
"id": "ca-n-shutshop",
"tone": "bad",
"head": "行肆停業",
"text": "一家行肆被勒令停業\n該股暫停交易10天",
"effect": {
"t": "orig",
"n": 27
}
},
{
"id": "ca-n-usury",
"tone": "bad",
"head": "商號違法放債",
"text": "商號違法放高利貸，東家下獄",
"effect": {
"t": "orig",
"n": 29
}
},
{
"id": "ca-n-dye",
"tone": "bad",
"head": "染坊污染渭水",
"text": "染坊廢水污染渭水，官府罰款",
"effect": {
"t": "orig",
"n": 30
}
},
{
"id": "ca-n-robbed",
"tone": "bad",
"head": "絲路商隊遇劫",
"text": "絲路商隊在河西遇劫，商號虧損",
"effect": {
"t": "orig",
"n": 32
}
},
{
"id": "ca-n-logging",
"tone": "bad",
"head": "濫伐終南山林",
"text": "商號濫伐終南山林，官府罰款",
"effect": {
"t": "orig",
"n": 33
}
},
{
"id": "ca-n-noise",
"tone": "bad",
"head": "作坊噪音擾民",
"text": "鐵匠作坊日夜敲打，鄰里告官，商號受罰",
"effect": {
"t": "orig",
"n": 34
}
},
{
"id": "ca-n-silkprofit",
"tone": "good",
"head": "絲路貿易獲利",
"text": "西域貿易大賺一筆，商號盈餘大增",
"effect": {
"t": "orig",
"n": 31
}
},
{
"id": "ca-n-topowner",
"tone": "good",
"head": "表揚長安第一大地主",
"text": "京兆府表揚長安第一大地主\n地最多的人得到{amount}文",
"effect": {
"t": "orig",
"n": 8
}
},
{
"id": "ca-n-poorrelief",
"tone": "good",
"head": "補助無地貧戶",
"text": "朝廷均田，補助土地最少的人\n得到{amount}文",
"effect": {
"t": "orig",
"n": 9
}
},
{
"id": "ca-n-landtax",
"tone": "bad",
"head": "徵收地稅",
"text": "朝廷按田畝徵收地稅\n每人繳交地產價值的5％",
"effect": {
"t": "orig",
"n": 12
}
},
{
"id": "ca-n-bankstop",
"tone": "bad",
"head": "櫃坊停止放款",
"text": "長安櫃坊銀根吃緊\n15天內所有人都不能借錢",
"effect": {
"t": "orig",
"n": 22
}
},
{
"id": "ca-n-search",
"tone": "bad",
"head": "金吾衛搜身",
"text": "金吾衛滿城搜查違禁之物\n每人被沒收一個道具",
"effect": {
"t": "take-tools"
}
}
];
export const CHANGAN_FATE: CnEvent[] = [
{
"id": "ca-f-drunkcrash",
"tone": "bad",
"head": "酒後駕車撞城牆",
"text": "與李白斗酒鬥詩，酒後駕車一頭撞上城牆\n座駕全毀",
"effect": {
"t": "wreck"
},
"only": "riding",
"pics": {
"car": "ca-f-drunkcrash-car",
"scooter": "ca-f-drunkcrash-scooter"
}
},
{
"id": "ca-f-goldturtle",
"tone": "good",
"head": "金龜換酒",
"text": "賀知章解下金龜換酒，與你痛飲\n得到{amount}文",
"effect": {
"t": "gain",
"amount": {
"min": 2000,
"max": 10000,
"step": 500
}
}
},
{
"id": "ca-f-fail",
"tone": "bad",
"head": "科場落第",
"text": "進士科落第，只得再住一年長安\n付房租{amount}文",
"effect": {
"t": "fine",
"amount": {
"min": 2000,
"max": 10000,
"step": 500
}
}
},
{
"id": "ca-f-pass",
"tone": "good",
"head": "春風得意馬蹄疾",
"text": "金榜題名，一日看盡長安花\n得到{amount}文",
"effect": {
"t": "gain",
"amount": {
"min": 2000,
"max": 10000,
"step": 500
}
}
},
{
"id": "ca-f-curfew",
"tone": "bad",
"head": "犯夜被捕",
"text": "街鼓響過還在坊外遊蕩，被金吾衛拿下\n入獄2天",
"effect": {
"t": "prison",
"days": 2
}
},
{
"id": "ca-f-polofall",
"tone": "bad",
"head": "打馬球墜馬",
"text": "打馬球太拚命，從馬上摔下來\n住院3天",
"effect": {
"t": "hospital",
"days": 3
}
},
{
"id": "ca-f-treasure",
"tone": "good",
"head": "胡商識寶",
"text": "西市胡商一眼看中你家祖傳的舊珠子\n以高價買下，得到{amount}文",
"effect": {
"t": "gain",
"amount": {
"min": 2000,
"max": 10000,
"step": 500
}
}
},
{
"id": "ca-f-pickpocket",
"tone": "bad",
"head": "西市遭扒手",
"text": "西市人多擁擠，錢袋被扒手摸走\n損失{amount}文",
"effect": {
"t": "fine",
"amount": {
"min": 2000,
"max": 10000,
"step": 500
}
}
},
{
"id": "ca-f-chupu",
"tone": "bad",
"head": "樗蒲輸錢",
"text": "樗蒲連擲幾把都是敗彩\n輸掉{amount}文",
"effect": {
"t": "fine",
"amount": {
"min": 2000,
"max": 10000,
"step": 500
}
}
},
{
"id": "ca-f-leyou",
"tone": "good",
"head": "登樂遊原",
"text": "夕陽無限好，登樂遊原心曠神怡\n得到{amount}點券",
"effect": {
"t": "points",
"amount": {
"min": 10,
"max": 100,
"step": 10
}
}
},
{
"id": "ca-f-string",
"tone": "good",
"head": "拾得錢袋",
"text": "在坊門邊拾得一袋開元通寶，無人認領\n得到{amount}文",
"effect": {
"t": "gain",
"amount": {
"min": 2000,
"max": 10000,
"step": 500
}
}
},
{
"id": "ca-f-lingnan",
"tone": "bad",
"head": "被貶嶺南",
"text": "上書直言觸怒權貴，被貶嶺南\n押往發配所",
"effect": {
"t": "exile"
}
},
{
"id": "ca-f-yelang",
"tone": "bad",
"head": "流放夜郎",
"text": "受了牽連，流放夜郎\n押往發配所",
"effect": {
"t": "exile"
}
},
{
"id": "ca-f-huobing",
"tone": "good",
"head": "胡麻餅出爐",
"text": "胡麻餅剛出爐，香脆可口，吃得心滿意足\n得到{amount}點券",
"effect": {
"t": "points",
"amount": {
"min": 10,
"max": 100,
"step": 10
}
}
},
{
"id": "ca-f-lychee",
"tone": "bad",
"head": "荔枝快馬",
"text": "一騎紅塵妃子笑，送荔枝的快馬把你撞翻\n住院2天",
"effect": {
"t": "hospital",
"days": 2
}
},
{
"id": "ca-f-fortune",
"tone": "good",
"head": "袁天罡相面",
"text": "相士說你面有貴氣，送你一道符\n抽一張卡片",
"effect": {
"t": "card",
"id": 0
}
},
{
"id": "ca-f-alms",
"tone": "bad",
"head": "寺院布施",
"text": "到大慈恩寺上香，捐了香油錢\n付{amount}文",
"effect": {
"t": "fine",
"amount": {
"min": 2000,
"max": 10000,
"step": 500
}
}
},
{
"id": "ca-f-gazette",
"tone": "good",
"head": "搶先讀邸報",
"text": "從進奏院搶先得知朝廷消息\n抽一張卡片",
"effect": {
"t": "card",
"id": 0
}
},
{
"id": "ca-f-tanhua",
"tone": "good",
"head": "選為探花使",
"text": "被同榜進士推為探花使，騎馬遍遊名園折花\n得到{amount}文",
"effect": {
"t": "gain",
"amount": {
"min": 2000,
"max": 10000,
"step": 500
}
}
},
{
"id": "ca-f-qinglong",
"tone": "good",
"head": "青龍寺聽經",
"text": "在青龍寺聽高僧講經，豁然開朗\n得到{amount}點券",
"effect": {
"t": "points",
"amount": {
"min": 10,
"max": 100,
"step": 10
}
}
},
{
"id": "ca-f-baqiao",
"tone": "bad",
"head": "灞橋折柳",
"text": "在灞橋折柳送別故友，把一張卡片送他當盤纏\n失去一張卡片",
"effect": {
"t": "lose-card"
}
},
{
"id": "ca-f-weicheng",
"tone": "bad",
"head": "勸君更盡一杯酒",
"text": "渭城送客，喝得太多走錯方向\n掉頭往回走",
"effect": {
"t": "turn"
}
},
{
"id": "ca-f-cockwin",
"tone": "good",
"head": "鬥雞贏了",
"text": "押中了神雞，滿場喝采\n得到{amount}文",
"effect": {
"t": "gain",
"amount": {
"min": 2000,
"max": 10000,
"step": 500
}
}
},
{
"id": "ca-f-cocklose",
"tone": "bad",
"head": "鬥雞輸了",
"text": "押錯了雞，血本無歸\n輸掉{amount}文",
"effect": {
"t": "fine",
"amount": {
"min": 2000,
"max": 10000,
"step": 500
}
}
},
{
"id": "ca-f-snowstuck",
"tone": "bad",
"head": "大雪買炭",
"text": "一夜大雪，坊門被雪封住，買炭取暖\n付{amount}文",
"effect": {
"t": "fine",
"amount": {
"min": 2000,
"max": 10000,
"step": 500
}
}
},
{
"id": "ca-f-gatecheck",
"tone": "bad",
"head": "城門盤查",
"text": "出城過所沒帶齊，被守門吏敲了一筆\n付{amount}文",
"effect": {
"t": "fine",
"amount": {
"min": 2000,
"max": 10000,
"step": 500
}
}
},
{
"id": "ca-f-xingjuan",
"tone": "good",
"head": "行卷獲賞識",
"text": "帶著詩文投獻名公，大受賞識\n一棟房屋免費加蓋一層",
"effect": {
"t": "upgrade"
}
},
{
"id": "ca-f-leak",
"tone": "bad",
"head": "屋漏偏逢連夜雨",
"text": "八月秋高風怒號，卷我屋上三重茅\n修繕費每級{amount}文",
"effect": {
"t": "repair",
"perLevel": 300,
"cap": 4000
}
},
{
"id": "ca-f-offend",
"tone": "bad",
"head": "得罪權貴",
"text": "酒後題詩譏諷權貴，被人告了一狀\n押往發配所",
"effect": {
"t": "exile"
}
},
{
"id": "ca-f-curio",
"tone": "good",
"head": "西域奇物",
"text": "胡商送你一件西域奇物\n得到一個道具",
"effect": {
"t": "tool",
"id": 0
}
},
{
"id": "ca-f-demolish",
"tone": "bad",
"head": "坊正勒令拆屋",
"text": "坊正說你家房子違建，勒令拆除一棟\n按造價退還現錢",
"effect": {
"t": "orig",
"n": 0
}
},
{
"id": "ca-f-requisition",
"tone": "bad",
"head": "朝廷徵地修宮苑",
"text": "朝廷徵用你的一塊空地修建宮苑\n按地價補償現錢",
"effect": {
"t": "orig",
"n": 1
}
},
{
"id": "ca-f-fakeloan",
"tone": "bad",
"head": "被人冒名借錢",
"text": "有人冒你的名向櫃坊借錢，債算到你頭上",
"effect": {
"t": "orig",
"n": 2
}
},
{
"id": "ca-f-feiqian",
"tone": "bad",
"head": "飛錢兌不出",
"text": "飛錢兌不出錢，櫃坊拒絕往來一個月\n一個月內不能進櫃坊",
"effect": {
"t": "orig",
"n": 3
}
},
{
"id": "ca-f-default",
"tone": "bad",
"head": "違約交割",
"text": "行肆違約交割，損失一成股份",
"effect": {
"t": "orig",
"n": 8
}
},
{
"id": "ca-f-dumpshares",
"tone": "bad",
"head": "急賣股份",
"text": "急需用錢，股份全部賣掉換現錢",
"effect": {
"t": "orig",
"n": 9
}
},
{
"id": "ca-f-stolenride",
"tone": "bad",
"head": "座駕被盜",
"text": "停在坊門外的座駕被人偷走了",
"effect": {
"t": "orig",
"n": 10
}
},
{
"id": "ca-f-canal",
"tone": "bad",
"head": "掉進漕渠",
"text": "走路不看路，掉進漕渠\n住院3天",
"effect": {
"t": "orig",
"n": 12
}
},
{
"id": "ca-f-pawn",
"tone": "bad",
"head": "家道中落",
"text": "家道中落，卡片和道具全部變賣換成點券",
"effect": {
"t": "orig",
"n": 32
}
},
{
"id": "ca-f-coining",
"tone": "bad",
"head": "私鑄銅錢",
"text": "私鑄開元通寶被查獲\n入獄5天",
"effect": {
"t": "orig",
"n": 34
}
},
{
"id": "ca-f-embezzle",
"tone": "good",
"head": "買通櫃坊掌櫃",
"text": "買通櫃坊掌櫃，挪用他人存款一成",
"effect": {
"t": "orig",
"n": 4
}
},
{
"id": "ca-f-birthday",
"tone": "good",
"head": "做壽收禮",
"text": "做壽擺宴，賓客各送你一張卡片",
"effect": {
"t": "orig",
"n": 5
}
},
{
"id": "ca-f-legacy",
"tone": "good",
"head": "遠房叔父留下遺產",
"text": "遠房叔父過世，留給你一筆遺產\n得到{amount}文",
"effect": {
"t": "gain",
"amount": {
"min": 2000,
"max": 10000,
"step": 500
}
}
},
{
"id": "ca-f-chupuwin",
"tone": "good",
"head": "樗蒲大勝",
"text": "樗蒲連擲盧采，大贏一場\n得到{amount}文",
"effect": {
"t": "gain",
"amount": {
"min": 2000,
"max": 10000,
"step": 500
}
}
},
{
"id": "ca-f-yicang",
"tone": "good",
"head": "義倉賑濟",
"text": "義倉開倉賑濟\n得到{amount}文",
"effect": {
"t": "gain",
"amount": {
"min": 2000,
"max": 10000,
"step": 500
}
}
},
{
"id": "ca-f-japan",
"tone": "bad",
"head": "隨遣唐使渡海",
"text": "被拉去隨遣唐使船渡海到日本\n消失3天",
"effect": {
"t": "orig",
"n": 6
}
},
{
"id": "ca-f-fox",
"tone": "bad",
"head": "被狐仙迷走",
"text": "夜歸遇上美貌狐仙，被迷得神魂顛倒\n消失3天",
"effect": {
"t": "orig",
"n": 7
}
},
{
"id": "ca-f-weihui",
"tone": "bad",
"head": "合會被倒",
"text": "參加的合會被會頭捲款逃走\n損失{amount}文",
"effect": {
"t": "fine",
"amount": {
"min": 2000,
"max": 10000,
"step": 500
}
}
},
{
"id": "ca-f-mingjing",
"tone": "good",
"head": "明經科及第",
"text": "考中明經科，親友登門道賀\n得到{amount}文",
"effect": {
"t": "gain",
"amount": {
"min": 2000,
"max": 10000,
"step": 500
}
}
},
{
"id": "ca-f-poemprize",
"tone": "good",
"head": "題詩得賞",
"text": "在旗亭題詩，被貴人看中賞賜\n得到{amount}點券",
"effect": {
"t": "points",
"amount": {
"min": 10,
"max": 100,
"step": 10
}
}
}
];
