# 03 · 股票系统规则还原（大富翁4 v3.11）

> 用途：供 Web/TypeScript 重制引擎按原版重写股票玩法。
> 编写日期：2026-10-11。依据：`upstream/rich4/asm`（rich4.exe 反汇编及部分还原 C）、`upstream/rich4/docs/*.txt`、`editor/stock-mechanics.md`，以及原版地图资源（`editor/site/assets/map-N-logic.bin`，为原版 MKF 资源的无损提取）。**未运行游戏**，全部为静态分析。
> 下文路径均相对 `upstream/rich4/`，例如 `asm/rich4_stocks.asm:517` 表示该文件第 517 行。函数名沿用反汇编标签（`fcn_XXXXXXXX` 即原 EXE 中的虚拟地址）。

## 0. 可信度标签

| 标签 | 含义 |
|---|---|
| 【代码确认】 | 已在反汇编/还原代码中逐条读过控制流与常量，附出处 |
| 【数据】 | 来自原版数据表（`asm/rich4_all_stocks.c` 股票表、地图资源中的企业记录），数值本身确定 |
| 【文档】 | 来自 `docs/*.txt` 或 `editor/stock-mechanics.md` 的结论，本次未完全复核 |
| 【推测·待实测】 | 由代码推断但存在不确定点（语义命名、调用时机、编译器库函数行为等），需要在 Wine 中实测 |

浮点说明：原程序用 x87 计算（内部 80 位扩展精度），结果写回内存时为 32 位 float。重制时价格、动量、平均成本等字段应以 `Math.fround` 落盘，中间运算用 double 即可（差异只在极端舍入边界）。【代码确认】（各处 `fstp dword`）

## 1. 数据结构

### 1.1 当前地图的 12 支股票 `stocks_on_map[12]`（0x496980，每条 36 字节）

定义见 `asm/rich4_stocks.h`，字段含义由本次读码确定：

| 偏移 | 类型 | 本文名 | 含义 | 依据 |
|---|---|---|---|---|
| +0 | char* | name | 股票名（Big5） | 股票表 |
| +4 | u16 | companyId | 股票表中为 0/1 标志；载入地图后，1 被替换为关联企业的序号（1 起）；0 = 非企业股 | `rich4_stocks.asm:32-72` 【代码确认】 |
| +6 | u8 | suspendDays | 停牌剩余天数，非 0 即停牌 | `rich4_player_core_actions.asm:4793-4798`、`rich4_stocks.asm:715-719` 【代码确认】 |
| +7 | u8 | forced | 强制涨跌停计数：高 4 位 = 剩余涨停天数，低 4 位 = 剩余跌停天数 | 同上 4800-4824、`rich4_stocks.asm:384-397` 【代码确认】 |
| +8 | u16 | floatPool | 市场流通池（可从市场买到的总股数），市场买入减、任何卖出加 | `rich4_stocks.asm:113-114,201-202` 【代码确认】 |
| +10 | u16 | turnQuota | 本回合可买量（界面“交易量”），每个玩家回合开始重算 | `rich4_stocks.asm:468-515` 【代码确认】 |
| +12 | float | basePrice | 初始价（非企业股的估值锚） | `rich4_stocks.asm:620` 【代码确认】 |
| +16 | float | prevClose | 昨收（每日更新前 = 当前价） | `rich4_stocks.asm:713-714` 【代码确认】 |
| +20 | float | price | 现价 | — |
| +24 | float | volatility | 波动系数（0.4–2.0） | `rich4_stocks.asm:559` 【代码确认】 |
| +28 | float | momentum | 涨跌动量（单位：百分比，范围 −10…+10，跨日保留） | `rich4_stocks.asm:552-681` 【代码确认】 |
| +32 | float | lastImpulse | 当日个股随机扰动（只写不读，仅记录） | `rich4_stocks.asm:558` 【代码确认】 |

### 1.2 玩家持股 `rich4_player_stocks[4][12]`（0x4971A0）

每项 8 字节：`int shares`（张数）+ `float avgCost`（平均成本，每张）。索引 = 玩家×12 + 股票槽。`asm/rich4_stocks.h`；`rich4_stocks.asm:137-158` 【代码确认】

### 1.3 企业记录（地图资源，52 字节，序号 1 起）

| 偏移 | 含义 | 依据 |
|---|---|---|
| +0x04 | 企业名（Big5，16 字节） | 地图资源 |
| +0x18 | owner：经营者 = 玩家号+1，0 = 无 | `rich4_stocks.asm:846-850` 【代码确认】 |
| +0x19 | 本地图股票槽号 | `rich4_stocks.asm:58` 【代码确认】 |
| +0x1a | 企业类别（1 航空、2 饭店/客栈、3 电脑、4 保险、5 汽车、6 石油、7 银行、10 百货、11 建设、12 门派） | 【文档】stock-mechanics.md + 本次核对的收费分支 |
| +0x1c..+0x1f | 股东名次表（4 个槽，玩家号+1，0 = 空），第 0 位即经营者 | `rich4_stocks.asm:775-850` 【代码确认】 |
| +0x22 | u16 基础收费 toll | `rich4_player_core_actions.asm:1932` 等 【代码确认】 |
| +0x24 | int 企业估值 valuation（本文称“股本/估值”）。每股净值 = valuation/10000 | `rich4_stocks.asm:126-129,571-572` 【代码确认】；全仓库未发现对企业 +0x24 的写入 → 视为地图常量【推测·待实测】 |
| +0x28 | int 本月盈余（待分红） | `rich4_ui_stock.asm:3218-3271`、界面标签“本月盈餘” 【代码确认】 |
| +0x2c | int 累计盈余（历史总和，只增减不清零） | `rich4_ui_stock.asm:908-919` 【代码确认】 |
| +0x30 | int 一级市场剩余股数（界面“保留股份”） | `rich4_load_map.asm:312-327`、`rich4_ui_stock.asm:675` 【代码确认】 |

### 1.4 相关全局量

| 地址 | 本文名 | 含义 | 依据 |
|---|---|---|---|
| 0x4990DC | marketClosedDays | 全市场休市计数（新闻设 10），bit7 为“最后一天”标志 | `rich4_player_core_actions.asm:4763-4777` 【代码确认】；`docs/global_vars.txt` 【文档】 |
| 0x4990EC | marketDrift | 当日大盘扰动（−4…+4） | `rich4_stocks.asm:528-533` 【代码确认】 |
| 0x497328 | history[12][144] | 每股 144 个日收盘价环形缓冲 | `rich4_stocks.asm:694-700` 【代码确认】 |
| 0x499100 | historyCursor | 下一个写入位置（0…143） | `rich4_stocks.asm:721-727` 【代码确认】 |
| 0x499078 | marketIndex | trunc(12 支现价之和 × 10)，每日更新；除存档外未见读取 | `rich4_stocks.asm:730-733` 【代码确认】 |
| 0x49907C | baseIndex | trunc(12 支初始价之和 × 10)，开局计算 | `rich4_new_game.asm:4251-4266` 【代码确认】 |
| 0x499084 | monthCount | 已过月份数，换月 +1，用于“平均盈余” | `rich4_player_core_actions.asm:4873` 【代码确认】 |
| 0x4990E4 | dayCount | 已过天数，每次换日 +1（也是“电脑费”倍率） | `rich4_player_core_actions.asm:4757`、`rich4_new_game.asm:4203` 【代码确认】 |
| 0x499080 | lotteryPool | 乐透奖金池；破产清算/部分强制卖股的价款、税款进入此处 | `rich4_ui_letou.asm:1224,2050-2057`（买票 +1000、开奖后清零）【代码确认】 |
| 0x4990E8 | priceIndex | 物价指数（开局 1） | `rich4_new_game.asm:4201` 【代码确认】 |

## 2. 股票列表、初始价格与地图企业

### 2.1 股票表的选择【代码确认】

原版内置 96 条股票（`asm/rich4_all_stocks.c`，地址 0x47F072），即 8 组 × 12 支。开新局时整组复制到 `stocks_on_map`：组号 = 模式(0x4991B6) × 4 + 地图号(0x4991B8)（`rich4_new_game.asm:4233-4249`）。同一函数随即清空 144 日历史、清空所有玩家持股、清零乐透池等（4209-4283）。

股票表各字段：`f4` 标志（1 = 应与地图企业关联）、`f8` 初始流通池、`f12=f16=f20` 初始价、`f24` 波动系数；`f6/f7/f10/f28/f32` 初始为 0。【数据】

地图资源顺序与股票组号一致：每张地图中企业的“股票槽号”所指股票名与企业名完全对应（例如组 2 槽 3 = 日产建设 ↔ 企业 #3 日產建設），8 组全部吻合，且“股票表 f4=1 的槽”与“有企业指向的槽”一一对应，无例外。【数据】（本次用脚本逐条比对）

### 2.2 全部股票与关联企业一览【数据】

说明：
- “初始流通池 f8”= 开局可在股市买到的总量；“一级市场股数”= 10000 − f8，只能在走到该企业时认购（第 5.5 节）。每家企业股票总量恒为 10000 张。
- “每股净值”用于股价回归（浮点）；一级市场认购价则是整数除法 `trunc(valuation/10000)`，如 28.8 → 28。
- 银行、百货的 f8 都是 10000、toll 都是 0：它们不能在企业格认购（一级市场股数 0），也不在普通收费分支中产生收入（银行/商店格走独立事件，见第 7 节）。
- 组 1 的中国石油 f8 = 0：开局股市上买不到，只能在企业格以 12 元/张认购，之后有人卖出才进入流通池。
- 组 4、组 7 的主题名为推测；股票名照原表转简体。

#### 组 0：台湾

| 槽 | 股票 | 初始价 | 波动系数 | 初始流通池 f8 | 关联企业(#序号/类别) | 企业估值 v24 | 每股净值 v24/10000 | 一级市场股数 10000−f8 | 基础收费 toll |
|---|---|---|---|---|---|---|---|---|---|
| 0 | 中国信托 | 100 | 1 | 10000 | #3 银行(7) | 900000 | 90 | 0 | 0 |
| 1 | 台湾人寿 | 40 | 0.6 | 5000 | #1 保险(4) | 400000 | 40 | 5000 | 750 |
| 2 | 大宇百货 | 25 | 1.5 | 10000 | #2 百货(10) | 200000 | 20 | 0 | 0 |
| 3 | 台积电 | 180 | 1.6 | 10000 | — | — | — | — | — |
| 4 | 大宇资讯 | 80 | 1.2 | 10000 | — | — | — | — | — |
| 5 | 台湾塑胶 | 60 | 1 | 10000 | — | — | — | — | — |
| 6 | 裕隆汽车 | 60 | 1.4 | 10000 | — | — | — | — | — |
| 7 | 远东纺织 | 27 | 0.9 | 10000 | — | — | — | — | — |
| 8 | 统一超商 | 310 | 0.7 | 10000 | — | — | — | — | — |
| 9 | 震旦行 | 66 | 1 | 10000 | — | — | — | — | — |
| 10 | 莱尔富 | 171 | 1.4 | 10000 | — | — | — | — | — |
| 11 | 联合报 | 280 | 0.8 | 10000 | — | — | — | — | — |

#### 组 1：中国大陆

| 槽 | 股票 | 初始价 | 波动系数 | 初始流通池 f8 | 关联企业(#序号/类别) | 企业估值 v24 | 每股净值 v24/10000 | 一级市场股数 10000−f8 | 基础收费 toll |
|---|---|---|---|---|---|---|---|---|---|
| 0 | 上海银行 | 70 | 1.2 | 10000 | #3 银行(7) | 560000 | 56 | 0 | 0 |
| 1 | 中国人寿 | 36 | 1 | 5000 | #2 保险(4) | 288000 | 28.8 | 5000 | 600 |
| 2 | 王府井百货 | 20 | 1.6 | 10000 | #4 百货(10) | 160000 | 16 | 0 | 0 |
| 3 | 中国石油 | 15 | 1.5 | 0 | #1 石油(加油)(6) | 120000 | 12 | 10000 | 500 |
| 4 | 联想科技 | 300 | 2 | 10000 | — | — | — | — | — |
| 5 | 顶新食品 | 296 | 1.8 | 10000 | — | — | — | — | — |
| 6 | 东方实业 | 133 | 1.4 | 10000 | — | — | — | — | — |
| 7 | 汇丰证券 | 170 | 1.5 | 10000 | — | — | — | — | — |
| 8 | 大庆石油 | 121 | 0.8 | 10000 | — | — | — | — | — |
| 9 | 长城电机 | 60 | 0.4 | 10000 | — | — | — | — | — |
| 10 | 长江建设 | 92 | 0.6 | 10000 | — | — | — | — | — |
| 11 | 大众软件 | 366 | 1 | 10000 | — | — | — | — | — |

#### 组 2：日本

| 槽 | 股票 | 初始价 | 波动系数 | 初始流通池 f8 | 关联企业(#序号/类别) | 企业估值 v24 | 每股净值 v24/10000 | 一级市场股数 10000−f8 | 基础收费 toll |
|---|---|---|---|---|---|---|---|---|---|
| 0 | 富士银行 | 160 | 0.8 | 10000 | #6 银行(7) | 1000000 | 100 | 0 | 0 |
| 1 | 三井生命 | 99 | 1.4 | 5000 | #4 保险(4) | 790000 | 79 | 5000 | 1000 |
| 2 | 三越百货 | 22 | 2 | 10000 | #1 百货(10) | 176000 | 17.6 | 0 | 0 |
| 3 | 日产建设 | 28 | 2 | 5000 | #3 建设(11) | 244000 | 24.4 | 5000 | 5000 |
| 4 | ＳＥＧＡ | 300 | 1 | 5000 | #5 电脑(3) | 2400000 | 240 | 5000 | 150 |
| 5 | 丰田汽车 | 35 | 1.2 | 5000 | #2 汽车(修车)(5) | 270000 | 27 | 5000 | 700 |
| 6 | 松下电机 | 540 | 1 | 10000 | — | — | — | — | — |
| 7 | 日立机电 | 830 | 1 | 10000 | — | — | — | — | — |
| 8 | ＳＯＮＹ | 300 | 1.2 | 10000 | — | — | — | — | — |
| 9 | 三菱工业 | 225 | 0.7 | 10000 | — | — | — | — | — |
| 10 | 任天堂 | 300 | 1 | 10000 | — | — | — | — | — |
| 11 | 德间书店 | 150 | 0.8 | 10000 | — | — | — | — | — |

#### 组 3：美国

| 槽 | 股票 | 初始价 | 波动系数 | 初始流通池 f8 | 关联企业(#序号/类别) | 企业估值 v24 | 每股净值 v24/10000 | 一级市场股数 10000−f8 | 基础收费 toll |
|---|---|---|---|---|---|---|---|---|---|
| 0 | 花旗银行 | 200 | 1 | 10000 | #6 银行(7) | 1000000 | 100 | 0 | 0 |
| 1 | 乔治亚人寿 | 55 | 0.8 | 5000 | #3 保险(4) | 440000 | 44 | 5000 | 800 |
| 2 | 环球百货 | 20 | 2 | 10000 | #5 百货(10) | 160000 | 16 | 0 | 0 |
| 3 | 联合航空 | 18 | 1 | 5000 | #2 航空(1) | 244000 | 24.4 | 5000 | 2500 |
| 4 | 福特汽车 | 16 | 1.4 | 5000 | #1 汽车(修车)(5) | 120000 | 12 | 5000 | 700 |
| 5 | ＩＢＭ | 550 | 2 | 5000 | #4 电脑(3) | 4000000 | 400 | 5000 | 200 |
| 6 | 德州仪器 | 245 | 1.5 | 10000 | — | — | — | — | — |
| 7 | 摩扥罗拉 | 166 | 1.3 | 10000 | — | — | — | — | — |
| 8 | 迪士尼 | 955 | 1.4 | 10000 | — | — | — | — | — |
| 9 | 可口可乐 | 1030 | 0.8 | 10000 | — | — | — | — | — |
| 10 | 麦当劳 | 1440 | 1 | 10000 | — | — | — | — | — |
| 11 | 百事可乐 | 310 | 1.2 | 10000 | — | — | — | — | — |

#### 组 4：星际主题（组名为推测）

| 槽 | 股票 | 初始价 | 波动系数 | 初始流通池 f8 | 关联企业(#序号/类别) | 企业估值 v24 | 每股净值 v24/10000 | 一级市场股数 10000−f8 | 基础收费 toll |
|---|---|---|---|---|---|---|---|---|---|
| 0 | 行星银行 | 50 | 1 | 10000 | #2 银行(7) | 100000 | 10 | 0 | 0 |
| 1 | 银河保险 | 40 | 0.6 | 5000 | #1 保险(4) | 440000 | 44 | 5000 | 800 |
| 2 | 宇宙百货 | 25 | 1.5 | 10000 | #3 百货(10) | 176000 | 17.6 | 0 | 0 |
| 3 | 火星移民 | 90 | 1.6 | 10000 | — | — | — | — | — |
| 4 | 陨石矿业 | 45 | 1.2 | 10000 | — | — | — | — | — |
| 5 | 星球电视 | 60 | 1 | 10000 | — | — | — | — | — |
| 6 | 金星科技 | 60 | 1.4 | 10000 | — | — | — | — | — |
| 7 | 星海通讯 | 27 | 0.9 | 10000 | — | — | — | — | — |
| 8 | 银河航运 | 110 | 0.7 | 10000 | — | — | — | — | — |
| 9 | 月世界旅游 | 66 | 1 | 10000 | — | — | — | — | — |
| 10 | 宇宙地产 | 71 | 1.4 | 10000 | — | — | — | — | — |
| 11 | 太阳能电力 | 80 | 0.8 | 10000 | — | — | — | — | — |

#### 组 5：武侠

| 槽 | 股票 | 初始价 | 波动系数 | 初始流通池 f8 | 关联企业(#序号/类别) | 企业估值 v24 | 每股净值 v24/10000 | 一级市场股数 10000−f8 | 基础收费 toll |
|---|---|---|---|---|---|---|---|---|---|
| 0 | 聚宝银楼 | 70 | 1.2 | 10000 | #11 银行(7) | 560000 | 56 | 0 | 0 |
| 1 | 狂徒镖局 | 70 | 1 | 5000 | #1 保险(4) | 440000 | 44 | 5000 | 800 |
| 2 | 南北货场 | 20 | 1.6 | 10000 | #12 百货(10) | 176000 | 17.6 | 0 | 0 |
| 3 | 少林派 | 250 | 1.5 | 3000 | #9 门派(12) | 790000 | 79 | 7000 | 1000 |
| 4 | 武当派 | 101 | 2 | 3000 | #3 门派(12) | 440000 | 44 | 7000 | 800 |
| 5 | 蜀山派 | 96 | 1.8 | 5000 | #2 门派(12) | 270000 | 27 | 5000 | 700 |
| 6 | 嵩山派 | 120 | 1.4 | 6000 | #4 门派(12) | 270000 | 27 | 4000 | 700 |
| 7 | 恒山派 | 47 | 1.5 | 4000 | #5 门派(12) | 120000 | 12 | 6000 | 500 |
| 8 | 泰山派 | 40 | 0.8 | 5000 | #6 门派(12) | 270000 | 27 | 5000 | 700 |
| 9 | 衡山派 | 30 | 0.4 | 4000 | #8 门派(12) | 120000 | 12 | 6000 | 500 |
| 10 | 华山派 | 90 | 0.6 | 5000 | #10 门派(12) | 440000 | 44 | 5000 | 800 |
| 11 | 逍遥客栈 | 300 | 1 | 4000 | #7 饭店/客栈(2) | 790000 | 79 | 6000 | 1000 |

#### 组 6：恐龙

| 槽 | 股票 | 初始价 | 波动系数 | 初始流通池 f8 | 关联企业(#序号/类别) | 企业估值 v24 | 每股净值 v24/10000 | 一级市场股数 10000−f8 | 基础收费 toll |
|---|---|---|---|---|---|---|---|---|---|
| 0 | 黄金银行 | 60 | 0.8 | 10000 | #2 银行(7) | 560000 | 56 | 0 | 0 |
| 1 | 肥龙保险 | 33 | 1.4 | 5000 | #1 保险(4) | 400000 | 40 | 5000 | 750 |
| 2 | 飞龙百货 | 22 | 2 | 10000 | #3 百货(10) | 176000 | 17.6 | 0 | 0 |
| 3 | 雷龙电子 | 18 | 2 | 10000 | — | — | — | — | — |
| 4 | 侏罗纪影业 | 100 | 1 | 10000 | — | — | — | — | — |
| 5 | 长毛象纺织 | 15 | 1.2 | 10000 | — | — | — | — | — |
| 6 | 迅猛汽车 | 40 | 1 | 10000 | — | — | — | — | — |
| 7 | 恐龙蛋食品 | 30 | 1 | 10000 | — | — | — | — | — |
| 8 | 火山岩保险 | 100 | 1.2 | 10000 | — | — | — | — | — |
| 9 | 三叶虫百货 | 25 | 0.7 | 10000 | — | — | — | — | — |
| 10 | 始祖化石 | 100 | 1 | 10000 | — | — | — | — | — |
| 11 | 翼龙航空 | 50 | 0.8 | 10000 | — | — | — | — | — |

#### 组 7：假期主题（组名为推测）

| 槽 | 股票 | 初始价 | 波动系数 | 初始流通池 f8 | 关联企业(#序号/类别) | 企业估值 v24 | 每股净值 v24/10000 | 一级市场股数 10000−f8 | 基础收费 toll |
|---|---|---|---|---|---|---|---|---|---|
| 0 | 假期银行 | 100 | 1 | 10000 | #6 银行(7) | 900000 | 90 | 0 | 0 |
| 1 | 假期百货 | 33 | 0.8 | 10000 | #7 百货(10) | 200000 | 20 | 0 | 0 |
| 2 | 狂徒大饭店 | 500 | 2 | 3000 | #1 饭店/客栈(2) | 790000 | 79 | 7000 | 1000 |
| 3 | 豪华大饭店 | 100 | 1 | 5000 | #2 饭店/客栈(2) | 440000 | 44 | 5000 | 800 |
| 4 | 第一大饭店 | 130 | 1.4 | 5000 | #4 饭店/客栈(2) | 400000 | 40 | 5000 | 750 |
| 5 | 金金大饭店 | 150 | 2 | 5000 | #3 饭店/客栈(2) | 288000 | 28.8 | 5000 | 600 |
| 6 | 世界大饭店 | 70 | 1.5 | 5000 | #5 饭店/客栈(2) | 288000 | 28.8 | 5000 | 600 |
| 7 | 百事可乐 | 66 | 1.3 | 10000 | — | — | — | — | — |
| 8 | 狄士尼 | 55 | 1.4 | 10000 | — | — | — | — | — |
| 9 | 可口可乐 | 30 | 0.8 | 10000 | — | — | — | — | — |
| 10 | 麦当劳 | 44 | 1 | 10000 | — | — | — | — | — |
| 11 | 爱迪达 | 30 | 1.2 | 10000 | — | — | — | — | — |

### 2.3 每张地图的股票与企业是怎么对上的（总结）【代码确认 + 数据】

- **股票数**：每局固定 12 支（`stocks_on_map[12]`，36 字节/支），全部原版共 96 支 = 8 组 × 12。开新局 `memcpy(stocks_on_map, game_stocks + 组号 × 0x1b0, 0x1b0)`，0x1b0 = 12 × 36（`rich4_new_game.asm:4233-4249`）。股市画面列出的是这 12 支，其中只有股票表 `f4 = 1` 的槽（台湾 3 支、大陆 4 支、日本 6 支、美国 6 支、星际 3 支、武侠 12 支、恐龙 3 支、假期 7 支）关联地图企业，其余是“只在股市”的股票，没有企业格。
- **股票名**：股票表 +0 是指向静态字符串的 `char*`（Big5），由组号决定；地图资源里没有股票名。
- **企业名与类别**：都在地图资源的企业记录里（52 字节）：+0x04 企业名（16 字节 Big5，含结尾 0，所以最多 15 字节 = 7 个汉字），+0x19 股票槽，+0x1a 类别，+0x22 收费，+0x24 估值。原版每张地图的企业名都与其股票槽的股票名相同（三越百貨 ↔ 槽 2 三越百貨；王府井百貨 ↔ 大陆槽 2）。
- **关联**：载入地图时 `_rich4_init_stock_commercial` 只按 **股票槽号** 把股票和企业对上（§3.1），完全不比名字。所以名字只是显示用，玩法只由“槽号 + 类别 + 收费 + 估值”决定。
- **类别决定效果**（§7、02 §5）：7 银行（企业格就是银行格，事件 14；经营者特别融资）、10 百货（企业格就是道具店格，事件 15；经营者进店得卡片/道具）、4 保险（保险转盘，保险費）、11 建设（工程費，经营者免费加盖）、3 电脑（電腦費 = 收费 × 已过天数）、5 汽车 / 6 石油（修車費 / 加油費，有交通工具才收）、1 航空（旅遊費并出国）、2 饭店（不收费）、12 门派（過路費）。
- **重制版的读法**：`game/src/core/modules/stocks.ts` 的 `STOCK_TABLE`（即上表 8 组）按 `board.mapId % 8` 取组（地图 JSON 的 `map_id`）；企业记录由 `game/src/core/board.ts parseBoard` 从 `companies[].raw_hex` 按上面的偏移读出（`name`、`stockSlot`、`category`…）；`Stocks.init()` 按槽号关联企业。重制版自制的 5 个日本城市（東京 100、大阪 101、札幌 102、九州 103、沖繩 104，地图 JSON 的 `game_id`）的 `map_id` 都是 2（日本）：用日本组的股票数值和原版日本地图的 6 条企业记录（`editor/tokyo_layout.py COMPANY_RECORDS`）。

### 2.4 重制版：自制城市的本地企业（`editor/city_companies.py`）

5 个城市原来都显示日本组的名字（富士銀行、三井生命、三越百貨、日產建設、ＳＥＧＡ、豐田汽車…）。现在每个城市用自己的本地企业，做法只换名字、不动玩法：

- 地图 JSON 增加可选字段 `stock_names`（12 个名字，按槽）。`parseBoard` 读成 `Board.stockNames`；`Stocks.init()` 用它代替股票表的名字，价格、波动、流通池、`f4` 关联标志仍取 `STOCK_TABLE[2]`。原版地图没有这个字段，行为不变。
- 企业记录 +0x04 改成它股票槽的名字（与原版“企业名 = 股票名”一致），+0x19 槽号、+0x1a 类别、收费、估值都不变：银行仍是银行（银行格），百货仍是百货（道具店格）。地上不画企业名。
- 名字由 `editor/city_companies.py`（按地图 id）提供；`editor/city_build.py` 与 `editor/build_tokyo.py` 在生成记录时调用 `rename()`、在 JSON 里加 `stock_section()`。已建好的地图可以只改名不重画地面：`python3 editor/city_companies.py patch KEY`。
- 存档：股票、持股、企业状态都按槽号/记录序号存，存档里也带着当时的名字。读档时（`loadGame(save, 当前地图)` → `adoptMapNames`）若当前地图的企业记录与存档一致（同 `map_id`、同数量、同槽号与类别），就改用当前地图的名字，所以旧存档读进来也显示本地企业；状态一个字节都不动。
- 名字限制：Big5，≤15 字节（7 个汉字），全角英文字母算 2 字节（ＳＥＧＡ = 8 字节）。

| 槽 | 原版日本（類別） | 東京 | 大阪 | 札幌 | 九州 | 沖繩 |
|---|---|---|---|---|---|---|
| 0 | 富士銀行：銀行（企業類別 7，停留＝銀行格） | 瑞穗銀行 | 三井住友銀行 | 北洋銀行 | 福岡銀行 | 琉球銀行 |
| 1 | 三井生命：保險（類別 4，保險費、保險轉盤） | 東京海上 | 日本生命 | ＪＡ共濟 | 明治安田生命 | 大同火災 |
| 2 | 三越百貨：百貨（類別 10，道具店格） | 三越百貨 | 阪急百貨 | 丸井今井 | 岩田屋 | 琉貿百貨 |
| 3 | 日產建設：建設（類別 11，工程費、免費加蓋） | 鹿島建設 | 竹中工務店 | 岩田地崎建設 | 九電工 | 國場組 |
| 4 | ＳＥＧＡ：電腦／遊戲（類別 3，電腦費） | ＳＥＧＡ | 卡普空 | 哈德森 | ＬＥＶＥＬ５ | ＯＣＣ |
| 5 | 豐田汽車：汽車（類別 5，修車費） | 本田汽車 | 大發汽車 | 北海道中央巴士 | 日產九州 | 沖繩豐田 |
| 6 | 松下電機：家電（只在股市） | 東芝 | 松下電器 | 北海道電力 | 安川電機 | 沖繩電力 |
| 7 | 日立機電：機電（只在股市） | 日立製作所 | 大金工業 | 日本製鋼所 | 九州電力 | 琉球水泥 |
| 8 | ＳＯＮＹ：電子（只在股市） | ＳＯＮＹ | 夏普 | 宜得利 | ＴＯＴＯ | 奧利恩啤酒 |
| 9 | 三菱工業：重工業（只在股市） | 三菱重工 | 久保田 | 札幌啤酒 | 普利司通 | 拓南製鐵 |
| 10 | 任天堂：遊戲（只在股市） | 萬代南夢宮 | ＳＮＫ | 克理普敦 | ＣＣ２ | 琉球放送 |
| 11 | 德間書店：出版（只在股市） | 德間書店 | 朝日新聞 | 北海道新聞 | 西日本新聞 | 琉球新報 |

（“只在股市”的 6 槽没有企业格，只是股市里的股票；某地区没有同行业的知名企业时，选当地最有代表性的同类或相近行业公司，详见 `editor/city_companies.py` 每一条的说明。）

## 3. 企业与股票的关联、经营者（最大股东）判定

### 3.1 载入地图时建立关联【代码确认】`rich4_stocks.asm:32-72`（`_rich4_init_stock_commercial`，由 `rich4_load_map.asm:568` 调用）

对 12 个股票槽依次处理：若 `companyId ≠ 0`（即股票表标志为 1），遍历全部企业 1…N，凡企业 `+0x19 == 槽号`，就把 `companyId` 写成该企业序号（多个匹配时取最后一个）。

- 只有股票表标为 1 的槽会被关联；企业单方面写了股票槽号不足以构成关联（与 stock-mechanics.md 一致）。
- **怪癖**：若标志为 1 却没有任何企业指向它，`companyId` 保持 1，会被当作“关联到 1 号企业”。原版数据中不存在这种情况；自制地图需避免。【代码确认】
- 载入地图时还为每家企业设置一级市场股数：`company.primaryShares = 10000 − stocks[company.+0x19].floatPool`（`rich4_load_map.asm:312-327`），随后立刻计算一次本回合可买量（`rich4_load_map.asm:330`）。【代码确认】

### 3.2 经营者重排 `_rich4_update_commercial_owner(player, slot)`【代码确认】`rich4_stocks.asm:743-865`

每次某玩家的持股变化后调用（市场买卖、一级市场认购、命运/破产强制卖出、玩家间交易）：

1. 股票无关联企业 → 返回 0。
2. 在企业的 4 格名次表中找到该玩家并删除（后面的前移，末格清 0）。
3. 若该玩家现在持股 > 0：从第 2 格往前比较（第 3 格不参与比较），遇到持股 **严格少于** 他的玩家就把对方后移一格；遇到持股 **≥** 他的玩家就停下，插在其后。也就是说 **持股相等时，原来排在前面的人保持领先**。
4. 名次表第 0 格就是经营者。若与企业 +0x18 不同，更新经营者、刷新小地图（`fcn_0040a4e1`），返回 1（“经营者变更”）。

要点：
- **没有持股门槛**，哪怕只持 1 张、只要排第一就是经营者。【代码确认】
- 只重排“本次持股变化的那个玩家”，其他人的相对次序不重新比较。玩家间交易（`rich4_ui_sale.asm:1740-1795`）只对买方调用此函数，卖方名次不更新，可能出现“卖方股份已少于第二名却仍居首”的历史残留。【代码确认】实际可见影响【推测·待实测】
- 返回值 1 在一级市场认购流程中用于弹出“恭喜您獲得經營權！”（门派类 12 为“恭喜您成為幫主！”）（`rich4_player_core_actions.asm:5022-5045`）；玩家间交易中人类买方也会据此进入提示分支（`rich4_ui_sale.asm:1795-1801`）；股市界面买入不提示。【代码确认】

与 stock-mechanics.md 的关系：其“相等不越过、非随机”的结论正确；本文补充了“只重排变动者”与“标志无匹配时默认关联 1 号企业”两个边界。

## 4. 每日股价更新

### 4.1 时机与顺序【代码确认】`rich4_player_core_actions.asm:4732-4880`（换日函数 `fcn_0041cf67`）

换日（所有玩家轮完一圈后调用，`rich4.asm:11822`；“一轮 = 一天”为推测）的顺序：

1. 日期 +1（`fcn_00452117`，返回是否换月）；dayCount +1。
2. 游戏结束检查、物价指数更新（`_rich4_update_price_index`）等。
3. **全市场休市计数**：若 bit7 已置位 → 清零；否则若非 0 → 减 1，减到 0 时改写为 0x80（4763-4777）。
4. **每支股票**：`suspendDays` 非 0 则减 1；`forced` 高 4 位非 0 则减 0x10，低 4 位非 0 则减 1（4779-4824）。
5. `srand(GetTickCount())`，然后调用每日更新 `fcn_004291d6`（4826-4832）。**随机种子取系统毫秒计时，原版不可复现**。
6. 若当天是 15 日：先上市公司分红（`fcn_0042ba97`），再乐透开奖（4834-4839）。
7. 若换月：月初结息报告（`fcn_00439bfa`，09 §7.12）、两个神仙/物件重新放置、monthCount +1（4841-4873）。

此外：开新局载入地图后立即调用一次 `fcn_004291d6`（`rich4_main.asm:375`），所以第一天看到的价格已经在初始价基础上变动过一次，历史缓冲第 0 格也已写入。【代码确认】

### 4.2 休市判定 `fcn_00428d01`【代码确认】`rich4_stocks.asm:74-92`

以下任一成立即“本日休市”：
- marketClosedDays ≠ 0（含 0x80 那一天）；
- 当天是星期日或特定节日：`fcn_004523d5`（`rich4.asm:25939`）先用 `(距1998-01-01天数 + 4) mod 7` 算星期，结果为 0 即休市（1998-01-01 为星期四，故 0 = 星期日【推测·待实测】）；否则查本组地图的节日表（`ref_0047FF4A`，每组 24 条，每条 12 字节，首字节非 0 表示该节日休市）。

休市影响：每日更新整体跳过（不消耗随机数，不推进历史游标）；股市界面只显示“本日休市”；AI 不买卖、不用红黑卡。但第 4.1 步的停牌/强制计数照常递减。【代码确认】

全市场休市新闻（#0175“股市暫停交易１０天”，`rich4_news.asm` `fcn_0044b0a0`）把计数设为 10：新闻当天剩余时间 + 之后 10 次换日（10→1 共 9 天，再加 0x80 的 1 天）都休市，第 11 天恢复。【代码确认】

### 4.3 更新算法 `fcn_004291d6`【代码确认】`rich4_stocks.asm:517-741`

随机数：`rand()` 返回 0…32767（Watcom CRT，RAND_MAX=32767【推测·待实测】，代码以 0x4000 为中心的写法与此吻合）。

```
若休市：直接返回
大盘扰动 M = (rand() − 16384) / 4097.0          // 均匀离散，约 −3.999 … +3.999
对每支股票 i = 0..11：
  昨收 prevClose ← price
  若 suspendDays ≠ 0：momentum ← 0                    // 停牌：价格不变
  否则若 forced ≠ 0：momentum ← (forced 高4位≠0) ? +10 : −10   // 高位优先
  否则：
    r = (rand() − 16384) / 1171.0                     // 约 −13.99 … +13.99
    lastImpulse ← r
    momentum ← momentum + r × volatility + M          // 动量累加（随机游走）
    // 估值回归
    若关联企业：ref = valuation / 10000.0；上界倍数 3，下界倍数 0.85
    否则：      ref = basePrice；           上界倍数 8，下界倍数 0.5
    若 prevClose > ref：
        若 prevClose > ref × 上界：momentum ×= (momentum > 0 ? 0.5 : 2)
    否则（prevClose ≤ ref）：
        若 prevClose < ref × 下界：momentum ×= (momentum > 0 ? 2 : 0.5)
    momentum 截断到 [−10, +10]
  price ← adjustPrice(prevClose, momentum)
  history[i][cursor] ← price；sum += price
cursor ← (cursor + 1) mod 144
marketIndex ← trunc(sum × 10)
```

要点：
- 每天消耗随机数：1（大盘）+ 未停牌且未被强制的股票数。【代码确认】
- 动量是跨日保留的状态，不是每日独立抽取；单日 r×volatility 最大可达 ±28（波动 2.0 时），所以很容易顶到 ±10，形成连续涨跌停。被强制涨跌停后，动量停在 ±10，强制结束后第一天在此基础上继续累加。停牌期间动量清 0。【代码确认】
- “企业估值回归”用浮点 `valuation/10000`，与一级市场认购价（整数除法）不同。【代码确认】
- **物价指数完全不参与股价计算**（`rich4_stocks.asm` 中无任何引用）。物价上涨不会带动股价。【代码确认】
- 注意比较的是 **昨收** 而非新价；`prevClose == ref` 归入“≤ ref”分支。【代码确认】

### 4.4 价格换算与最小变动单位 `fcn_00428ec5(prev, pct)`【代码确认】`rich4_stocks.asm:226-364`

```
cand = prev × (pct + 100) / 100
tick = cand < 5 ? 0.01 : cand < 15 ? 0.05 : cand < 50 ? 0.1 : cand < 150 ? 0.5 : 1.0   // 以 cand 决定档位
若 pct > 0：result = cand − fmod(cand − prev, tick)   // 涨幅向下取整到 tick 的整数倍
否则：      result = cand + fmod(prev − cand, tick)   // 跌幅同样向零取整
result < 1   → 1
result > 9999 → 9999
```

- 取整的是“涨跌幅度”，不是把价格对齐到 tick 网格：新价 = 昨收 ± k×tick。【代码确认】（`fmod` 参数顺序见 `asm/libc_stub387.asm:22-30` 的栈布局：第一个参数为被除数 = 涨跌额）
- 因此单日涨跌绝对不超过 ±10%（取整只会让幅度变小）。【代码确认】
- 显示格式：现价 < 15 显示两位小数，< 150 一位，否则整数（`rich4_ui_stock.asm:154-175`）。【代码确认】

### 4.5 涨跌五态 `fcn_004295ea(slot)`【代码确认】`rich4_stocks.asm:867-929`

| 返回 | 条件 | 意义 |
|---|---|---|
| 1 | price > prevClose 且 price ≥ adjustPrice(prevClose, +10) | 涨停 |
| 0 | price > prevClose，未达涨停 | 上涨 |
| 3 | price < prevClose 且 price ≤ adjustPrice(prevClose, −10) | 跌停 |
| 2 | price < prevClose，未达跌停 | 下跌 |
| 4 | price == prevClose | 平盘 |

### 4.6 立即强制涨跌停 `fcn_00429040(slot+1 或 0)`【代码确认】`rich4_stocks.asm:366-466`

红卡、黑卡、新闻设置 `forced` 后立即调用：参数为 0 时处理全部 12 支，否则只处理指定的一支。对 `forced ≠ 0` 的股票：momentum ← ±10（高 4 位优先为 +10），`price ← adjustPrice(prevClose, momentum)`，并覆盖历史缓冲中“上一格”（cursor−1，即今天那一格），不推进游标、不消耗随机数。此函数 **不检查休市和停牌**。

持续天数规律（设定当天立即生效，之后每次换日先递减再更新）：高 4 位设为 k（或低 4 位设为 k）→ 共 k 天涨停（跌停），含设定当天。【代码确认】

### 4.7 本回合可买量（交易量）`fcn_0042915a`【代码确认】`rich4_stocks.asm:468-515`

在 **每个玩家的回合开始** 调用（`rich4_player_core_actions.asm:4109`，`fcn_0041c84f` 开头），也在载入地图时调用一次：

```
若 floatPool ≤ 1000：turnQuota = floatPool
否则：turnQuota = trunc(floatPool × (1000 + rand() % 2000) / 10000)    // 流通池的 10%～29.99%
```

市场买入减少 turnQuota 与 floatPool；任何卖出（含强制卖出）同时增加两者。【代码确认】

## 5. 买卖规则

### 5.1 开放时机【代码确认】

- 人类玩家在自己回合通过顶部工具栏“股市”按钮进入（`rich4_ui_clicking_top_panel.asm:96-101` → `_rich4_ui_stock_entry(0)`）。休市时只显示“本日休市”大字，点击退出，不能交易（`rich4_ui_stock.asm:2739-2775`）。
- 买卖不需要走到特定格子，也不限次数；一个回合内可多次买卖。【代码确认】（界面循环内未见次数计数）
- 一级市场认购只在走到对应企业格时出现（第 5.5 节）。
- AI 每回合在行动阶段各尝试一次买、一次卖（第 9 节）。

### 5.2 股市买入（人类）【代码确认】`rich4_ui_stock.asm:2041-2138`

1. 选中股票若停牌（suspendDays ≠ 0）→ 无反应。
2. 若当前为涨停态（五态=1）→ 提示“漲停無法買進！”。
3. 最大可买 = min(turnQuota, trunc(存款 ÷ 现价))；为 0 则无反应。
4. 弹出数字输入框（0…最大值），确认后调用 `_rich4_buy_stock(player, slot, n, 1)`。

`_rich4_buy_stock`（`rich4_stocks.asm:94-169`），市场模式（第 4 参数 ≠ 0）：
```
cost = trunc(n × price)
turnQuota −= n；floatPool −= n
存款(player+32) −= cost
oldCost = trunc(shares × avgCost)
shares += n
avgCost = (oldCost + cost) / shares            // float
重排经营者
```

- **只能用银行存款**，不能用现金，不能用点券。【代码确认】
- **没有手续费、没有交易税**。【代码确认】
- 单位为“张”（AI 提示“買進%s%d張”，`rich4.asm` ref_00464186），价格即每张价格，成本 = 张数 × 现价。【代码确认】
- 持股上限：无个人上限，只受 turnQuota、存款、流通池约束（一家企业总量 10000）。【代码确认】
- 资金不足：输入框上限已按存款截断，不会透支。【代码确认】

### 5.3 股市卖出（人类）【代码确认】`rich4_ui_stock.asm:2140-2205`

1. 无持股 → 无反应；停牌 → 无反应。
2. 跌停态（五态=3）→ 提示“跌停無法賣出！”。
3. 输入 0…持有量，确认后 `_rich4_sell_stock(player, slot, n, 1)`。

`_rich4_sell_stock`（`rich4_stocks.asm:171-224`）：
```
shares −= n；若变为 0，avgCost ← 0（未清仓则平均成本不变）
proceeds = trunc(n × price)
turnQuota += n；floatPool += n
若第 4 参数 ≠ 0：存款 += proceeds      否则：乐透奖金池 += proceeds
重排经营者
```

### 5.4 卖出到奖金池的情形（第 4 参数 = 0）【代码确认】

- 破产：逐支全部卖出，价款进乐透奖金池，不归任何人（`rich4_player_bankrupt.asm:385-407`）。
- 命运 #0193“股票違約交割損失股票10％”：每支持股卖出 trunc(持股 × 10/100) 张，价款进奖金池，即被没收（`rich4_fortune.asm` `fcn_0044c7ef`，比例常量 10 写死）。可被免灾类卡片（`fcn_0044b896` 判定）抵消。

这些强制卖出 **不检查停牌、跌停、休市**。【代码确认】

命运 #0194“變賣所有股票求現”：所有持股按现价卖出，价款进存款（`fcn_0044c91f`，同样可被卡片抵消）。【代码确认】

### 5.5 一级市场认购（走到企业格）【代码确认】`rich4_player_core_actions.asm:4948-5056`（`fcn_0041d1a9`）

触发：停在 event 0 且引用企业（6001…7999）的格子，无论企业有无经营者、无论是否本人经营，在收费/服务处理之后都会进入（`rich4_player_core_actions.asm:1729-1754, 2293-2297`）。银行、百货格走 event 14/15 的独立入口，不经过这里。

条件：玩家未处于“梦游”（player+55 = 0）、在局（player+21 ≠ 0）、企业一级市场股数 > 0。

```
unitPrice = trunc(valuation / 10000)                // 整数，不乘物价指数
max = min(trunc(现金 / unitPrice), 1000, primaryShares)
人类：确认框“%s 每股售價%d 是否認購股份？”→ 数字输入框(0..max)
AI：  reserve = trunc(初始资金 × 0.3) × 物价指数
      n = 现金 − reserve > 0 ? min(max, trunc((现金 − reserve) / unitPrice)) : 0
若 n > 0：_rich4_buy_stock(player, slot, n, 0)
```

`_rich4_buy_stock` 的认购模式（第 4 参数 = 0）：`cost = n × unitPrice`，**从现金扣**，`primaryShares −= n`，不动 floatPool / turnQuota；平均成本照常加权（以认购价计）。

- 一次最多 1000 张；可以每次经过都认购。【代码确认】
- 原版数据中多数企业的认购价低于股票初始价（例：少林派 79 vs 250、三井生命 79 vs 99），是低价建仓途径。【数据】

### 5.6 玩家间股票交易（接口）

“交易”界面中股票成交（`rich4_ui_sale.asm:1740-1795`）：买方 +n 张，平均成本按成交价重算；卖方 −n 张，清仓则成本清零；只对买方调用经营者重排。成交价、撮合规则见交易文档。【代码确认】

## 6. 企业收入、累计盈余与分红

### 6.1 收入来源【代码确认】

- 非经营者停在企业格时所付费用，由 `fcn_0041d2c6(payer, 100+企业序号, amount, 0)` 支付：收款方序号 > 100 表示企业，金额同时加到企业 +0x28（本月盈余）和 +0x2c（累计盈余），**不直接给经营者**（`rich4_player_core_actions.asm:2262-2272, 5058-5130`）。
- 企业也可作为付款方（同一函数，扣 +0x28/+0x2c），具体调用来源本次未逐一核实。【推测·待实测】
- 新闻直接修改盈余（`rich4_news.asm`）：#0179 工厂排污罚 10000、#0182 违规开发罚 10000、#0183 噪音罚 5000（盈余各减），#0180 海外投资获利 +20000、#0181 亏损 −20000，#0184“獲利調高一倍”：本月盈余 m → 2m，**累计盈余却加 2m**（怪癖）。这些金额不乘物价指数。【代码确认】

### 6.2 15 日分红 `fcn_0042ba97`【代码确认】`rich4_ui_stock.asm:3052-3400`

每月 15 日（换日后，日期字节 = 15）执行，**不受休市影响**：

```
对每个关联企业的股票槽：
  total = Σ 在局玩家持股（不含流通池、一级市场剩余）
  对每个在局玩家 p：
     ratio_p = shares_p / total（float；持股 0 则为 0）
     payout_p += trunc(本月盈余 × ratio_p)
  若 total ≠ 0：本月盈余 ← 0          // 没有玩家股东时本月盈余保留，累积到下次
显示“上市公司分紅”表（各公司本月盈余、每人所得、合计）
然后对每个在局玩家：存款 += payout
  若存款 < 0：现金 += 存款，存款 ← 0；若现金仍 < 0：现金 ← 0，破产
```

要点：
- 企业收入 **100% 按持股比例分给玩家股东**；流通池和未认购股份不参与分配，相当于玩家股东瓜分全部利润。
- **本月盈余为负时会“负分红”**，从股东存款、再从现金扣除，可导致破产。
- 截断误差直接消失（盈余已清零）。
- 平均盈余 = 累计盈余 ÷ monthCount（monthCount = 0 时直接用累计盈余），只用于显示与 AI 评估（`rich4_ui_stock.asm:908-920`）。

### 6.3 界面字段对照【代码确认】

- 持股表（`fcn_004297f7`）：各玩家持股、经营者高亮，关联企业的行额外显示“保留股份”= 一级市场剩余（+0x30）、“累積盈餘”标题下实际显示的是 +0x28（本月盈余）（`rich4_ui_stock.asm:665-700`）。
- 上市公司资讯（`fcn_00429d65`）：“本月盈餘”= +0x28，“平均盈餘”= +0x2c / monthCount，经营者名字、周均价（近 6 个历史点）、月均价（近 24 个）、历史高低（144 个）等。

## 7. 经营者（最大股东）特权与企业服务

以下与股票直接相关的部分本次复核；各服务的具体数值另见服务/地产文档。来源：`rich4_player_core_actions.asm:1729-2297`、`rich4_shop.asm:1905-1990`、`rich4_ui_bank.asm:3538-3563`。

| 情形 | 规则 | 可信度 |
|---|---|---|
| 企业 **无经营者**（+0x18 = 0） | 不收费、不提供服务，只进入一级市场认购 | 【代码确认】 |
| 经营者本人停留，类别 4 保险 | 转盘得天数，免费增加保险天数 | 【代码确认】 |
| 经营者本人停留，类别 11 建设 | 选地块免费加盖，最多两次升级 | 【代码确认】（与 stock-mechanics.md 一致） |
| 经营者本人停留，其他类别 | 无收费、无额外奖励 | 【代码确认】 |
| 他人停留 | 按类别收费（见下），费用进企业盈余 | 【代码确认】 |
| 百货（类别 10）经营者进入该百货商店 | 随机得 1 张卡片或 1 个道具（rand 最低位二选一），再进入正常商店 | 【代码确认】 |
| 银行（类别 7）经营者进入该银行 | 可用“特别融资”，额度 = 其他玩家存款总和 − 已用特别融资 | 【代码确认】入口；额度细节【文档】 |

他人停留收费公式（`ebp` = 金额，最后统一经过卡片/神明调整）：
- 1 航空：转盘得天数 d；d>0 时费 = toll × d × 物价指数，并旅行；d=0 时显示提示无费用。
- 2 饭店/客栈：本分支 **不收费**（落入金额 0 的默认分支）。饭店是否另有住宿入口未核实。【代码确认】/【推测·待实测】
- 3 电脑：费 = toll × dayCount（已过天数，**不乘物价指数**）。【代码确认】这纠正了 stock-mechanics.md 中“ref_004990e4 时间含义未核实”的说法：它在每次换日 +1、开局清 0。
- 4 保险：转盘得天数 d，费 = toll × d × 物价指数，同时增加保险天数。
- 5 汽车 / 6 石油：有交通工具才收费，费 = toll × 2^(交通工具−1) × ref_0048BAFC × 物价指数（ref_0048BAFC 疑为本次步数【推测·待实测】）。
- 11 建设：选地块升级一次，费 = 该地块升级费 × 物价指数；无有效地块时费 = 1000 × 物价指数。
- 12 门派：费 = toll × ref_0048BAFC × 物价指数。

因此，银行和百货（toll = 0，且不走此分支）以及饭店类企业几乎没有经营收入，分红主要来自新闻；保险、汽车、石油、航空、电脑、建设、门派才有稳定收入。【代码确认 + 数据】

## 8. 与卡片 / 新闻 / 命运的接口（只列效果，细节见各自文档）

| 来源 | 函数 | 对股票的效果 | 可信度 |
|---|---|---|---|
| 红卡（卡号 24） | `_rich4_use_card_hongka`（`rich4_card_hongka.asm`） | 选定一支股票 forced = 0x20 → 当天起连续 2 天涨停（立即生效） | 【代码确认】 |
| 黑卡（卡号 25） | `_rich4_use_card_heika`（`rich4_card_heika.asm`） | forced = 0x02 → 连续 2 天跌停；每个持有该股的玩家对使用者的敌意 += 持股 × 当日跌价 / 200 | 【代码确认】 |
| 红/黑卡人类选股 | `_rich4_ui_stock_entry(1/2)` → `rich4_ui_stock.asm:2217-2260` | 点击即生效，**不检查停牌**；休市时界面只显示休市 | 【代码确认】；对停牌股生效后的表现【推测·待实测】 |
| 新闻 #0173 | `fcn_0044b00a` | 全部 12 支 forced = 1：当天跌停 1 天 | 【代码确认】 |
| 新闻 #0174 | `fcn_0044b055` | 全部 forced = 0x10：当天涨停 1 天 | 【代码确认】 |
| 新闻 #0175 | `fcn_0044b0a0` | 全市场休市（计数 10，见 4.2） | 【代码确认】 |
| 新闻 #0176“%s股票暫停交易１０天” | `fcn_0044b0d1` | 随机一支 suspendDays = **15**（与文字“10 天”不符），当前价重置为昨收并改写今日历史 | 【代码确认】实际停牌天数【推测·待实测】 |
| 新闻 #0177 | `fcn_0044b1a3` | 在停牌股中随机一支恢复交易（suspendDays = 0） | 【代码确认】 |
| 新闻 #0178 | `fcn_0044b25b` | 随机一家有经营者的企业，经营者坐牢 5 天（无股价影响） | 【代码确认】 |
| 新闻 #0179/#0182/#0183 | `fcn_0044b374/53f/57d` | 盈余 −10000/−10000/−5000，该股 forced = 3（3 天跌停） | 【代码确认】 |
| 新闻 #0180 | `fcn_0044b419` | 盈余 +20000，forced = 0x30（3 天涨停） | 【代码确认】 |
| 新闻 #0181 | `fcn_0044b4a8` | 盈余 −20000，forced = 4（4 天跌停） | 【代码确认】 |
| 新闻 #0184 | `fcn_0044b5f5` | 只从本月盈余 > 10000 的企业中选；盈余翻倍，forced 高 4 位 = trunc(原盈余/10000)（≥16 时溢出成 0 或错位） | 【代码确认】 |
| 新闻 #0159 | `fcn_00449b9c` | 持股张数合计最多的玩家获 10000 × 物价指数奖励 | 【代码确认】 |
| 新闻 #0162 证交税 | `fcn_0044a029` | 每个在局玩家缴纳 trunc(持股市值 × 0.05)，付给奖金池 | 【代码确认】 |
| 命运 #0193 / #0194 | 见 5.4 | 没收 10% / 全部卖出入存款 | 【代码确认】 |
| 新闻候选条件 | `rich4.asm:22600-22720` 一带 | 部分新闻只有在“有人持股”“有停牌股”“有在局经营者”“有企业本月盈余 > 10000”时才可能抽中 | 【代码确认】（候选表细节见新闻文档） |

注：新闻中企业是在全部企业里随机抽取，若其股票槽 ≥ 12 则只改盈余不动股价（`rich4_news.asm:3207-3211`）。

## 9. AI 股票策略

AI 回合（`rich4.asm:11611-11629`）依次调用 `fcn_0042bf03`（买）与 `fcn_0042c79f`（卖）；托管中的人类玩家同样走此路径。下文 PI = 物价指数，“存款”= player+32，“现金”= player+28，“贷款”= player+36，“贷款到期日”= player+44（银行贷款时设为当日 + 90 天并避开休息日，`rich4_ui_bank.asm:199-207`）。

### 9.1 AI 投资比例（player+26）【数据】`asm/rich4_characters.c`

角色默认值：约翰乔 30、沙隆巴斯 45、忍太郎 0、钱夫人 30、阿土伯 25、莎拉公主 30、宫本宝藏 20、糖糖 35、乌咪 20、孙小美 0、小丹尼 15、金贝贝 0。可在托管设置中修改（`rich4_ui_ai_settings.asm:775`）。为 0 的角色从不在股市买入。

### 9.2 买入 `fcn_0042bf03`【代码确认】`rich4.asm:14726-15352`

```
若 rand() % 3 ≠ 0：结束                   // 每次只有 1/3 机会
若 投资比例 = 0 或 休市：结束
若 有贷款到期日 且 (到期日 − 今天) < 15 天：结束
stockValue = Σ 持股 × 现价（逐支截断累加）
target = trunc((存款 + 现金 + stockValue) × 投资比例 / 100)
若 stockValue ≥ target：结束
budget = min(target − stockValue, 存款)
对每支股票打分 score（停牌、涨停、turnQuota = 0 的为 0）：
  关联企业股（需 存款 > 20000×PI，否则 0 分）：
    avgProfit = monthCount ? 累计盈余/monthCount : 累计盈余
    nav = trunc(valuation/10000)
    0 < avgProfit < 5000PI → +1；5000PI ≤ avgProfit < 10000PI → +2；avgProfit ≥ 10000PI → +3
    若 本月盈余 > 0 且 自己持股 < 5000 且 现价 ≤ nav×1.2：+1，并且
        若有他人经营：(流通池 + 自己持股 + 一级剩余) > 经营者持股 → +1；(自己持股 + turnQuota) > 经营者持股 → +2
    现价 < nav×0.85 → +3；现价 < nav×0.7 → 再 +5
  非企业股（需 存款 > 30000×PI，否则 0 分）：
    avg24 / avg6 = 历史缓冲最近 24 / 6 个非零收盘价的均值
    现价 < 初始价×2.5 且 动量 > 2 且 avg6 > avg24 → +2
    现价 < 初始价×0.6 且 avg6 > avg24 → +4
    avg6 < avg24×0.5 → +2
按分数降序排序（Watcom qsort，同分顺序不稳定）
依名次 rank = 0..11：分数 ≠ 0 时抽 rand() % 24，若 ≤ 12 − rank 就选中并停止
n = min(trunc(budget / 现价), turnQuota)；n > 0 则市场买入（扣存款）并提示“%s 買進%s%d張”
```

每次最多买一支股票。【代码确认】

### 9.3 卖出 `fcn_0042c79f`【代码确认】`rich4.asm:15354-16086`

```
urgent = (到期日 − 今天) ≤ 6 且 (存款 + 现金) < 贷款
若非 urgent 且 rand() % 3 ≠ 0：结束；若休市：结束
循环：
  对每支持有、未停牌、非跌停的股票打分：
    关联企业股：
      ratio = 全体玩家持股合计 / 自己持股        // 注意方向，≥ 1（见下）
      day = 当日几号
      本月盈余 ≤ −10000PI 且 ratio > 0.6 且 10 < day < 15 → +3      // 分红日前躲避负分红
      本月盈余 ≤ −6000PI 且 现价 > 成本×1.2 且 自己非经营者 且 8 < day < 15 → +2
      avgProfit ≤ 10000PI 且 nav×2 ≤ 现价 且 现价 > 成本×1.3 且 ratio < 0.4 → +1   // ratio≥1，实际永不成立
      他人经营 且 (自己持股 + 流通池 + 一级剩余) < 经营者持股 且 本月盈余 ≤ 0 且 现价 ≥ 成本×1.5 → +1
      现价 > nav×2 且 现价 > 成本×2 且 现价 < 昨收 且 自己非经营者 → +2
      现价 > nav×3 且 现价 > 成本×3 且 现价 < 昨收 且 自己是经营者 → +2
      urgent → +1
    非企业股：
      pr = 现价 / 成本
      histMin = 144 日内最低非零收盘价
      pr > 1.6 且 动量 < 1 → +2
      现价 > histMin×8 且 histMin×8 > 成本×1.25 → +2
      avg24 > avg6 且 现价 < 昨收 → +2
      pr ≥ 2 → + trunc((pr − 2)/0.5 + 1)
      (现金+存款) < 30000PI 且 pr > 0 → + trunc(pr/0.5 + 1)
      (现金+存款) < 16000PI 且 pr > 0 → 再 + trunc(pr/0.5 + 1)
      urgent → 分数 ×2
  取最高分（同分取槽号小者；须 > 0）；无则结束
  全部卖出该股（入存款），提示“%s 賣出%s%d張”
  若 urgent 且 (存款+现金) < 贷款×1.1：回到循环再卖下一支
```

关于 ratio 方向：`fdivrp` 在本反汇编中的语义可由 `_rich4_buy_stock` 推定——那里同样的指令序列算出的是“总成本 / 总张数”（`rich4_stocks.asm:154-158`），据此 AI 卖出里的 ratio = 合计持股 / 自己持股。这使两个 ratio 条件一个恒真、一个恒假，属于原版瑕疵。【代码确认（按指令一致性推定）】

### 9.4 一级市场认购（AI）

见 5.5：AI 只要扣除 30% 初始资金 × PI 的保留金后还有余钱，就按最大可买量认购，不打分、不随机。【代码确认】

### 9.5 红卡 / 黑卡选股【代码确认】`rich4_ai_use_card.asm:2350-2600`

- 红卡（`fcn_00420055`）：休市不用；在自己持有的股票中选持仓成本（张数×平均成本）最大、未停牌、未涨停的一支。
- 黑卡（`fcn_004200ea`）：休市不用；候选 A = 经营企业数最多的对手所持、关联企业、未停牌、自己不持有、未跌停的股票中，该对手持仓成本最大者；候选 B = 对最敌视玩家做同样筛选（不要求关联企业）。优先用 B，没有再用 A。

## 10. 与 editor/stock-mechanics.md 的对照

| stock-mechanics.md 的结论 | 本次核对 |
|---|---|
| 企业 +0x18 经营者、+0x19 股票槽、+0x1a 类别、+0x1c..+0x1f 股东排序 | 一致。补充：+0x24 估值、+0x28 本月盈余、+0x2c 累计盈余、+0x30 一级剩余 |
| `_rich4_init_stock_commercial` 只匹配 stock+4 非 0 的槽 | 一致；补充无匹配时默认指向 1 号企业的怪癖 |
| 股东排序相等不越过、非随机 | 一致；补充“只重排变动者” |
| 日本图 6 家企业的股票槽与类别 | 一致，并扩展到 8 组全部企业（2.2 表） |
| 百货最大股东进店随机得卡片或道具 | 一致（本次复核入口代码） |
| 银行最大股东特别融资 | 入口一致；额度算法未复核 |
| 类别 3 电脑费倍率 ref_004990e4“时间含义未核实” | **补正**：它是已过天数，每次换日 +1，开局为 0；电脑费不乘物价指数 |
| 类别 2 饭店“需联合其他事件研究” | 本分支确认不收费；其他入口仍未核实 |
| 未提分红、企业收入去向、一级市场认购 | **新增**：费用进企业盈余，15 日按持股比例分给玩家股东（可为负）；走到企业格可按估值/10000 认购 |

## 11. 重制实现要点（TypeScript 草案）

### 11.1 类型

```ts
type PlayerId = 0 | 1 | 2 | 3;

interface StockDef {                 // 来自原版 96 条股票表
  name: string;
  linked: boolean;                   // 表中 f4 = 1
  initialFloat: number;              // f8
  basePrice: number;                 // f12
  volatility: number;                // f24
}

interface StockState {
  def: StockDef;
  companyId: number;                 // 0 = 非企业股；否则企业序号（1 起）
  suspendDays: number;               // u8
  forcedUpDays: number;              // forced 高 4 位（0..15）
  forcedDownDays: number;            // forced 低 4 位（0..15）
  floatPool: number;                 // u16
  turnQuota: number;                 // u16
  prevClose: number;                 // float32
  price: number;                     // float32
  momentum: number;                  // float32，−10..10
  lastImpulse: number;               // float32
  history: Float32Array;             // 长度 144，0 表示无数据
}

interface Holding { shares: number; avgCost: number /* float32 */ }

interface Company {
  id: number;
  name: string;
  category: number;                  // 1..12
  stockSlot: number;                 // 0..11；≥12 表示无股票
  tollFee: number;                   // u16
  valuation: number;                 // int，地图常量
  monthProfit: number;               // int，可为负
  totalProfit: number;               // int
  primaryShares: number;             // int
  owner: PlayerId | null;            // +0x18（存储为玩家号+1）
  ranking: (PlayerId | null)[];      // 长度 4，[0] = 经营者
}

interface MarketState {
  stocks: StockState[];              // 12
  holdings: Holding[][];             // [player][slot]
  closedDays: number;                // 0x4990DC，含 0x80 标志位
  drift: number;                     // float32
  historyCursor: number;             // 0..143
  monthCount: number;
  dayCount: number;
  marketIndex: number;
  baseIndex: number;
  lotteryPool: number;
}

interface Rng { next(): number /* 0..32767 */ }   // 原版种子取 GetTickCount，无法复现；建议可注入种子
```

### 11.2 算法草案

```ts
const f32 = Math.fround;

function tickFor(c: number) { return c < 5 ? 0.01 : c < 15 ? 0.05 : c < 50 ? 0.1 : c < 150 ? 0.5 : 1; }

function adjustPrice(prev: number, pct: number): number {
  const cand = prev * (pct + 100) / 100;
  const tick = tickFor(cand);
  let r = pct > 0 ? cand - fmodPos(cand - prev, tick) : cand + fmodPos(prev - cand, tick);
  if (r < 1) r = 1; else if (r > 9999) r = 9999;
  return f32(r);
}
const fmodPos = (a: number, b: number) => a % b;  // a ≥ 0；JS % 与 C fmod 同号语义一致

function trendState(s: StockState): 0 | 1 | 2 | 3 | 4 {
  if (s.price > s.prevClose) return s.price >= adjustPrice(s.prevClose, 10) ? 1 : 0;
  if (s.price < s.prevClose) return s.price <= adjustPrice(s.prevClose, -10) ? 3 : 2;
  return 4;
}

function isClosed(m: MarketState, date: GameDate): boolean {
  return m.closedDays !== 0 || isSunday(date) || isMarketHoliday(date /* 本组节日表 */);
}

function dailyUpdate(m: MarketState, companies: Company[], date: GameDate, rng: Rng) {
  if (isClosed(m, date)) return;
  m.drift = f32((rng.next() - 16384) / 4097);
  let sum = 0;
  for (const s of m.stocks) {
    s.prevClose = s.price;
    if (s.suspendDays) s.momentum = 0;
    else if (s.forcedUpDays) s.momentum = 10;
    else if (s.forcedDownDays) s.momentum = -10;
    else {
      const r = (rng.next() - 16384) / 1171;
      s.lastImpulse = f32(r);
      let mom = f32(s.momentum + r * s.def.volatility);
      mom = f32(mom + m.drift);
      const c = s.companyId ? companies[s.companyId] : null;
      const ref = c ? c.valuation / 10000 : s.def.basePrice;
      const [hi, lo] = c ? [3, 0.85] : [8, 0.5];
      if (s.prevClose > ref) { if (s.prevClose > ref * hi) mom = f32(mom * (mom > 0 ? 0.5 : 2)); }
      else if (s.prevClose < ref * lo) mom = f32(mom * (mom > 0 ? 2 : 0.5));
      s.momentum = Math.max(-10, Math.min(10, mom));
    }
    s.price = adjustPrice(s.prevClose, s.momentum);
    s.history[m.historyCursor] = s.price;
    sum = f32(sum + s.price);
  }
  m.historyCursor = (m.historyCursor + 1) % 144;
  m.marketIndex = Math.trunc(sum * 10);
}

// 换日：先计数递减，再更新，再分红
function onNewDay(m: MarketState, companies: Company[], date: GameDate, rng: Rng, players: PlayerState[]) {
  if (m.closedDays & 0x80) m.closedDays = 0;
  else if (m.closedDays) { m.closedDays--; if (!m.closedDays) m.closedDays = 0x80; }
  for (const s of m.stocks) {
    if (s.suspendDays) s.suspendDays--;
    if (s.forcedUpDays) s.forcedUpDays--;
    if (s.forcedDownDays) s.forcedDownDays--;
  }
  dailyUpdate(m, companies, date, rng);
  if (date.day === 15) payDividends(m, companies, players);
  if (date.monthChanged) m.monthCount++;
}

function applyForced(m: MarketState, slot?: number) {      // 红黑卡/新闻设置 forced 后立即调用
  const prevSlot = (m.historyCursor + 143) % 144;
  for (const [i, s] of m.stocks.entries()) {
    if (slot !== undefined && i !== slot) continue;
    if (!s.forcedUpDays && !s.forcedDownDays) continue;
    s.momentum = s.forcedUpDays ? 10 : -10;
    s.price = adjustPrice(s.prevClose, s.momentum);
    s.history[prevSlot] = s.price;
  }
}

function refreshQuota(s: StockState, rng: Rng) {            // 每个玩家回合开始
  s.turnQuota = s.floatPool <= 1000 ? s.floatPool
    : Math.trunc(s.floatPool * (1000 + rng.next() % 2000) / 10000);
}

function buyMarket(m: MarketState, companies: Company[], p: PlayerState, slot: number, n: number) {
  const s = m.stocks[slot];
  const cost = Math.trunc(n * s.price);
  s.turnQuota -= n; s.floatPool -= n; p.bank -= cost;
  addShares(m, companies, p.id, slot, n, cost);
}
function buyPrimary(m: MarketState, companies: Company[], p: PlayerState, c: Company, n: number) {
  const cost = n * Math.trunc(c.valuation / 10000);
  c.primaryShares -= n; p.cash -= cost;
  return addShares(m, companies, p.id, c.stockSlot, n, cost);
}
function addShares(m: MarketState, companies: Company[], pid: PlayerId, slot: number, n: number, cost: number) {
  const h = m.holdings[pid][slot];
  const old = Math.trunc(h.shares * h.avgCost);
  h.shares += n;
  h.avgCost = f32((old + cost) / h.shares);
  return rerank(m, companies, pid, slot);                    // 返回经营者是否变化
}
function sellShares(m: MarketState, companies: Company[], p: PlayerState, slot: number, n: number, toBank: boolean) {
  const s = m.stocks[slot], h = m.holdings[p.id][slot];
  h.shares -= n; if (h.shares === 0) h.avgCost = 0;
  const proceeds = Math.trunc(n * s.price);
  s.turnQuota += n; s.floatPool += n;
  if (toBank) p.bank += proceeds; else m.lotteryPool += proceeds;
  rerank(m, companies, p.id, slot);
}

function rerank(m: MarketState, companies: Company[], pid: PlayerId, slot: number): boolean {
  const s = m.stocks[slot]; if (!s.companyId) return false;
  const c = companies[s.companyId];
  const list = c.ranking.filter(x => x !== pid); while (list.length < 4) list.push(null);
  const mine = m.holdings[pid][slot].shares;
  if (mine > 0) {
    let pos = 0;
    for (let k = 2; k >= 0; k--) {
      const o = list[k]; if (o === null) continue;
      if (m.holdings[o][slot].shares < mine) list[k + 1] = o;  // 后移
      else { pos = k + 1; break; }
    }
    list[pos] = pid;
  }
  c.ranking = list.slice(0, 4);
  const owner = c.ranking[0];
  const changed = owner !== c.owner;
  c.owner = owner; return changed;
}

function payDividends(m: MarketState, companies: Company[], players: PlayerState[]) {
  const pay = players.map(() => 0);
  m.stocks.forEach((s, slot) => {
    if (!s.companyId) return;
    const c = companies[s.companyId];
    const total = players.filter(p => p.alive).reduce((a, p) => a + m.holdings[p.id][slot].shares, 0);
    for (const p of players) if (p.alive) {
      const sh = m.holdings[p.id][slot].shares;
      const ratio = sh ? f32(sh / total) : 0;
      pay[p.id] += Math.trunc(c.monthProfit * ratio);
    }
    if (total) c.monthProfit = 0;
  });
  for (const p of players) if (p.alive) {
    p.bank += pay[p.id];
    if (p.bank < 0) { p.cash += p.bank; p.bank = 0; if (p.cash < 0) { p.cash = 0; bankrupt(p); } }
  }
}
```

### 11.3 实现注意

1. 价格与动量必须按 float32 落盘，否则涨跌停判定（`price ≥ adjustPrice(prev, 10)`）可能在边界上与原版不同。
2. 股价与物价指数无关；但 AI 的资金门槛、AI 保留金、各类企业收费都乘物价指数。
3. 休市日完全不推进历史游标；强制涨跌停/停牌计数在休市日照常递减。
4. 一级市场用现金、股市用存款，两条资金通道不要合并。
5. 分红与“负分红导致破产”是原版规则，不是 bug，重制应保留（可做成可选规则开关）。
6. 原版随机种子每天按系统时钟重置，重制可用可存档的种子流，但要在文档中声明“不可与原版逐日对拍”。
7. 新闻 #0176 的停牌天数（15）与提示文字（10 天）不一致，重制需在“忠实还原”与“修正文案”之间做选择，建议默认忠实并加注释。
8. 自制地图：股票表 `linked=true` 的槽必须有企业指向，否则会错误关联到 1 号企业；企业 `stockSlot ≥ 12` 时不得读股票表。

## 12. 待实测问题清单（Wine）

通用方法：
- 在 macOS/Linux 用 Wine 运行原版 `RICH4.EXE`（v3.11），配合 `winedbg`：`winedbg RICH4.EXE` 后用 `break *0x4291d6` 等地址下断点，`x /12wx 0x496980` 查看内存。股票结构基址 0x496980（36 字节/支），持股 0x4971A0，休市计数 0x4990DC，历史 0x497328，游标 0x499100。
- 或用存档编辑：存档按 `asm/rich4_save_files.asm` 的读取顺序排列。按顺序推算（每个标量 4 字节、0x4991B8/0x4991B6 各 2 字节）：历史游标约在 0x6F2，历史 0x6F6–0x21F5，玩家持股 0x21F6–0x2375，股票结构 0x2376–0x2525【推测·待实测，先用已知持股数验证偏移】。修改后读档观察界面。
- 日期可通过存档偏移 4 的日期字段（日/月/年）调整，以便快速构造“星期日”“15 日”“节日”等场景。

| # | 问题 | 怎么测 | 期望（静态结论） |
|---|---|---|---|
| 1 | rand 是否 0…32767、日涨跌幅分布 | 断在 0x4291D6 前后，记录连续 200 天每支股票的 momentum（+0x1C）与 price；统计 r×volatility 的范围 | 个股扰动约 ±14×波动系数，动量常顶到 ±10 |
| 2 | 星期日判定（0 = 星期日？） | 把存档日期改到已知的星期日与星期六，打开股市 | 星期日“本日休市”，星期六正常 |
| 3 | 各组节日休市清单 | 解析 `ref_0047FF4A` 表并在 Wine 中逐个日期打开股市 | 首字节非 0 的节日休市 |
| 4 | 新闻 #0176 停牌实际天数 | 用存档把某股 +6 设为 15（或等待新闻），每天记录能否交易 | 15 天（文字写 10 天） |
| 5 | 全市场休市 10 天的确切天数 | 设 0x4990DC = 10，逐日观察 | 当天 + 10 天休市，第 11 天开市 |
| 6 | 红卡/黑卡持续天数 | 使用红卡后逐日看五态 | 当天与次日共 2 天涨停（跌停） |
| 7 | 对停牌股使用红/黑卡 | 先让某股停牌，再用红卡选它 | 价格立即改为昨收×1.1，之后停牌期间保持 |
| 8 | 一级市场认购上限与资金来源 | 现金充足时停在三井生命 | 每次最多 1000 张，扣现金，单价 79 |
| 9 | 分红：负分红、无股东时累积 | 存档改企业 +0x28 为负值，在 14 日换日到 15 日；另测无玩家持股时 +0x28 是否保留 | 存款被扣，不足扣现金；无股东时不清零 |
| 10 | 经营者同股数时的名次 | 两玩家先后买到相同张数 | 先到者保持经营者 |
| 11 | 玩家间交易后卖方名次 | A 为经营者，把股份卖给 B 使 A 少于第三方 C | 名次表可能残留 A 在前（需确认界面高亮） |
| 12 | 饭店类（类别 2）企业是否收费 | 他人停在逍遥客栈/各大饭店 | 本分支不收费；若实测有收费，说明另有入口 |
| 13 | ref_0048BAFC 是否为步数 | 有车时停在丰田/福特，改变掷骰点数比较费用 | 费用与点数成正比 |
| 14 | 企业估值 +0x24 是否始终不变 | 长局中定期读 0x498E7C 指向的企业记录 | 不变 |
| 15 | AI 卖出 ratio 方向 | 断在 loc_0042c8a3（0x42C8A3）之后的 fdivrp 处读 st0/st1，或构造“AI 持全部股份、本月盈余 ≤ −10000、12 日”的场景看是否卖出 | ratio = 合计/自持 ≥ 1 |
| 16 | AI 买入同分排序 | 构造多支同分股票，多次读档观察买哪支 | Watcom qsort 不稳定，需记录 |
| 17 | 新闻 #0184 在盈余 ≥ 160000 时 | 改 +0x28 = 160000 并触发 | 高 4 位溢出，可能不涨停 |
| 18 | 开局第一次更新 | 新开局前后读 0x496994 与初始价 | 第一天价格已变动，历史第 0 格已写 |
| 19 | 存档偏移 | 用已知持股张数在存档中定位 | 与上方推算一致 |
