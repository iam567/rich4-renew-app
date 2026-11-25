# 大富翁4 电脑版（Windows / macOS）

同一份网页版（`game/dist`，和手机 App 一样的素材）装进 Electron 视窗；游戏从自己的 `app://` 网址载入，存档在 App 自己的浏览器储存（IndexedDB）里，派对模式照常联机。

    cd game/desktop && npm install
    RICH4_DIST=<dist 路径> RICH4_DESKTOP_OUT=<输出> npx electron-builder --config electron-builder.config.cjs --win zip --x64
    node set-win-icon.mjs <输出>/win-unpacked/Rich4.exe build/icon.ico <版本>   # exe 图标 = iPhone 图标（Mac 上不用 Wine）
    RICH4_DIST=… RICH4_DESKTOP_OUT=… npx electron-builder --config electron-builder.config.cjs --mac dir --universal
    codesign --force --deep --sign - <输出>/mac-universal/Rich4.app       # ad-hoc 签名（M 芯片要求）
    hdiutil create … -format UDZO rich4-<版本>-mac.dmg                      # 加一个 /Applications 链接

没有 Apple 开发者 ID 公证：第一次打开 Mac 版要「右键 → 打开」；Windows 版没有签名，SmartScreen 提示时点「更多信息 → 仍要执行」。
`RICH4_SHOT=图.png`（加 `RICH4_CLICK`、`RICH4_SHOT2`）可以不用手测试：等几秒截图后自动关闭。

## 存檔放在遊戲目錄的 save 資料夾（Windows／macOS，2026-11-24）

每個存檔一個檔案：`save/slot-N.json`（自動存檔也是，`slot-1000…` 那幾個），先寫 `.tmp`、讀回來確認完整再換上，上一版留成 `.prev`。Windows 放在 Rich4.exe 旁邊，macOS 放在 大富翁4.app 旁邊。遊戲資料夾寫不進去（例如放在 Program Files，或 Mac 直接從「下載」裡打開被系統隔離）時，改放在使用者資料夾（AppData）裡的 save。第一次打開時，原來瀏覽器存儲（IndexedDB）裡的存檔會自動複製過來，原來那份不動。（系統設定裡不放任何存檔資料夾的選項——用戶 2026-11-24。）只有 1.3 起的新安裝包（main.cjs／preload.cjs）才有，舊安裝包靠遊戲內更新拿不到，照舊存在瀏覽器存儲。
