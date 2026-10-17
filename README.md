# 大富翁4 重制版 App（rich4-renew-app）

大富翁4是我童年最喜欢的游戏，现在闲着没事的时候，我还是喜欢拿出来玩上一会。一玩就很容易沉浸进去。
4代的成功，让我对接下来推出的5代大感失望。
本来他可以把4代美化一下，游戏机能更新一下，就可以算得上是一个很棒的游戏了。
但他却偏偏选择发售他们认为很好玩的新的游戏机制。

既然他们不懂得做游戏，那么就由我来做吧。
高解析度重制版的 App 源码：Vite + TypeScript 遊戲本體，Capacitor 打包成 iOS App。
規則依原版反組譯還原（見 `docs/rules/`），另有新玩法「大富豪模式」（東京／大阪／札幌／九州／沖繩 12 人全國戰）。

同时也增加了新地图新玩法——歌舞伎町。在夜生活的世界里，有一套独立的事件系统与建筑风格。
更多的玩法，等我想到了就慢慢的更新。

完整素材（原版提取、高清重繪、地圖、地表、音效）不放進 Git，放在 Releases 的 `rich4-assets.tar`；地圖製作與生圖工具不在這裡。

## 目錄
- `game/src/core` 規則引擎（回合、地產、股票、卡片、道具、事件、大富豪模式）
- `game/src/ui` 畫面與動畫
- `game/ios` iOS 工程、`game/android` 安卓工程（Capacitor 7）
- `game/scripts` 素材連結、打包、安裝到 iPhone
- `docs/rules` 規則文件

## 執行
```bash
cd game
npm install
# 素材：下載 Releases 裡的 rich4-assets.tar（和 .sha256），檢查後解壓到 game/public
gh release download assets -p 'rich4-assets.tar*'
shasum -a 256 -c rich4-assets.tar.sha256
mkdir -p public && tar -xf rich4-assets.tar -C public
npm run dev
npm test
npm run ios      # 打包並安裝到已連接的 iPhone
npm run package  # 出安裝包到 game/release/：安卓 APK（可直接安裝）＋ 未簽名 iOS IPA
```

## 授權
GPL-3.0-or-later（規則研究引用 mytbk/rich4，見 `THIRD_PARTY.md`）。Releases 裡的大富翁4 原遊戲資源及其重繪不在此授權範圍，僅供私人使用。
