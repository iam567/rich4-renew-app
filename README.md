# 大富翁4 重制版 App（rich4-renew-app）

大富翁4（v3.11）高解析度重制版的 App 源码：Vite + TypeScript 遊戲本體，Capacitor 打包成 iOS App。
規則依原版反組譯還原（見 `docs/rules/`），另有新玩法「大富豪模式」（東京／大阪／札幌／九州／沖繩 12 人全國戰）。

本倉庫只放 App 源碼；原遊戲素材、重繪素材、地圖製作與生圖工具都不在這裡。

## 目錄
- `game/src/core` 規則引擎（回合、地產、股票、卡片、道具、事件、大富豪模式）
- `game/src/ui` 畫面與動畫
- `game/ios` iOS 工程（Capacitor 7）
- `game/scripts` 素材連結、打包、安裝到 iPhone
- `docs/rules` 規則文件

## 執行
```bash
cd game
npm install
npm run assets   # 連結本機素材（需自備原版遊戲與重繪素材）
npm run dev
npm test
npm run ios      # 打包並安裝到已連接的 iPhone
```

## 授權
GPL-3.0-or-later（規則研究引用 mytbk/rich4，見 `THIRD_PARTY.md`）。大富翁4 原遊戲資源不包含在內，也不在此授權範圍。
