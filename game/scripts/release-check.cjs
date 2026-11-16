// 發版前全面檢查 (the user 2026-11-15: 「每次發新版本…橫屏、豎屏什麼的全重新認證一遍，你覺得能用才發」).
// Every main screen at every size, with real clicks: each button that must be pressed has to be on screen and on top
// (elementFromPoint), never an el.click() workaround — a covered button is a bug (1.2.1's room, issue #102).
//
//   (dev server: npx vite --host 127.0.0.1 --port 5199; relay: HOST=127.0.0.1 PORT=8443 node tools/party-relay/relay.mjs)
//   PW=<playwright-core dir> EXE=<chrome> OUT=<dir> node scripts/release-check.cjs
// Prints one line per check and FAIL lines; exits 1 on any failure. Screenshots go to OUT for a look.
const { chromium } = require(process.env.PW || 'playwright-core');
const OUT = process.env.OUT || '.', URL = process.env.URL || 'http://localhost:5199/';
const wait = ms => new Promise(r => setTimeout(r, ms));
const SIZES = [
  ['portrait', 390, 844], ['small', 320, 568], ['landscape', 844, 390], ['wide-landscape', 924, 424], ['pc', 1280, 720],
];
let fails = 0;
const fail = (tag, what) => { fails++; console.log(`FAIL ${tag}: ${what}`); };

/** The element is whole on screen and nothing covers its middle. */
async function hittable(p, sel) {
  return p.evaluate(sel => {
    const el = document.querySelector(sel);
    if (!el) return 'missing';
    const r = el.getBoundingClientRect(), W = innerWidth, H = innerHeight;
    if (r.width < 4 || r.height < 4) return 'no size';
    if (r.left < -1 || r.top < -1 || r.right > W + 1 || r.bottom > H + 1) return `off screen (${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)} in ${W}×${H})`;
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return top && (top === el || el.contains(top)) ? 'ok' : `covered by ${top ? top.tagName + '.' + String(top.className).slice(0, 40) : 'nothing'}`;
  }, sel);
}
async function must(p, tag, sel, label) {
  const h = await hittable(p, sel);
  if (h !== 'ok') fail(tag, `${label} (${sel}): ${h}`);
  return h === 'ok';
}
/** A real click, after checking the button can be pressed. */
async function press(p, tag, sel, label) {
  if (!(await must(p, tag, sel, label))) return false;
  await p.click(sel, { timeout: 5000 }).catch(e => fail(tag, `${label}: click ${e.message.split('\n')[0]}`));
  return true;
}

async function run(b, [name, w, h]) {
  const c = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: w < 1000 });
  await c.addInitScript(() => {
    try { localStorage.setItem('rich4.party.relayDev', 'ws://127.0.0.1:8443'); } catch { /* none */ }
    // the apps' update store, so the version button and 檢查更新 show as on a phone
    const m = new Map();
    window.rich4Desktop = { update: { read: async n => m.get(n) ?? null, write: async (n, d) => { m.set(n, d); return true; }, remove: async n => { m.delete(n); return true; }, rename: async () => true, list: async () => [...m.keys()] } };
  });
  const p = await c.newPage();
  p.on('pageerror', e => fail(name, `page error ${String(e).slice(0, 160)}`));
  const shot = async what => p.screenshot({ path: `${OUT}/${name}-${what}.png` });
  const title = async () => { await p.waitForSelector('.title-btn.party', { timeout: 180000 }); await wait(1500); await p.evaluate(() => document.querySelectorAll('.update-sheet').forEach(e => e.remove())); };
  await p.goto(URL, { timeout: 120000 });
  await title();
  for (const [sel, l] of [['[data-act=start]', '開始遊戲'], ['[data-act=party]', '派對模式'], ['[data-act=maker]', '自建地圖'], ['[data-act=load]', '讀取進度'], ['[data-act=option]', '設定'], ['[data-act=log]', '更新日誌'], ['[data-act=ver]', '版本號'], ['[data-act=ranks]', '排行榜']]) await must(p, name, sel, `title ${l}`);
  await shot('title');

  // 排行榜 (1.2.4): the boards, a map, a difficulty, 怎麼算分, back
  if (await press(p, name, '[data-act=ranks]', '排行榜')) {
    await wait(2500);
    for (const b of ['rich', 'fast', 'fierce', 'woe']) await must(p, name, `.rk-board[data-b=${b}]`, `排行榜 ${b}`);
    await press(p, name, '.rk-board[data-b=woe]', '最慘榜');
    await press(p, name, '.rk-lv [data-lv="0"]', '簡單');
    await wait(1500);
    if (!(await p.$('.rk-top .rk-item, .rk-top .rk-none'))) fail(name, '排行榜: no list');
    await shot('ranks');
    if (await press(p, name, '.rk-ov [data-a=how]', '怎麼算分')) { await wait(600); await shot('ranks-how'); await press(p, name, '[data-d=ok]', '怎麼算分 好'); await wait(400); }
    await press(p, name, '.rk-ov [data-a=close]', '排行榜 返回');
    await wait(600);
  }

  // 更新日誌 → 檢查更新 / 關閉
  if (await press(p, name, '[data-act=log]', '更新日誌')) {
    await wait(1200);
    await must(p, name, '[data-check]', '檢查更新');
    await shot('changelog');
    await press(p, name, '.cl-ov [data-close]', '更新日誌 關閉');
    await wait(500);
  }

  // 自建地圖: the home sheet, the new map sheet, the sample in the editor, its 選單, out again
  if (await press(p, name, '[data-act=maker]', '自建地圖')) {
    await wait(1500);
    await must(p, name, '.mk-home [data-a=new]', '新建地圖');
    await must(p, name, '.mk-home [data-a=back]', '自建地圖 返回');
    await shot('maker-home');
    if (await press(p, name, '.mk-home [data-a=new]', '新建地圖')) {
      await wait(1000);
      await must(p, name, '.mk-new [data-a=go]', '開始畫');
      await shot('maker-new');
      await press(p, name, '.mk-new [data-a=back]', '新建地圖 返回');
      await wait(1000);
    }
    if (await press(p, name, '.mk-home [data-a=sample]', '示例地圖')) {
      await wait(5000);
      await shot('editor');
      // 企業大樓 (1.2.4): the 格子 tab's 保險公司, its looks to choose from in the bar, one chosen
      if (await press(p, name, '.mk-tab[data-tab="2"]', '格子')) {
        await wait(600);
        await p.$eval('[data-sq="200"]', e => e.scrollIntoView({ block: 'center' })).catch(() => {});
        await wait(300);
        if (await press(p, name, '[data-sq="200"]', '保險公司')) {
          await wait(800);
          if (await press(p, name, '.mk-float .mk-style[data-style="162"]', '企業大樓 風格')) {
            await wait(400);
            if (!(await p.$('.mk-float .mk-style.on[data-style="162"]'))) fail(name, '企業大樓 風格: not chosen');
          }
          await shot('editor-company');
        }
        await press(p, name, '.mk-tab[data-tab="0"]', '地面');
        await wait(400);
      }
      // the 選單's sheets, each opened, looked at and closed with its 好
      for (const [k, ok, l] of [['deck', '[data-d=ok]', '新聞命運卡'], ['stocks', '[data-s=ok]', '股票'], ['rules', '[data-r=ok]', '特殊規則'], ['wood', '[data-w=ok]', '樹林樣式'], ['tex', '[data-x=ok]', '地面紋理'], ['light', '[data-l=ok]', '光影設定']]) {
        if (!(await press(p, name, '[data-a=menu]', '編輯器 選單'))) break;
        await wait(600);
        if (!(await press(p, name, `[data-m=${k}]`, l))) { await p.keyboard.press('Escape'); continue; }
        await wait(900);
        await shot(`editor-${k}`);
        await press(p, name, ok, `${l} 好`);
        await wait(600);
      }
      if (await press(p, name, '[data-a=menu]', '編輯器 選單')) {
        await wait(800);
        await must(p, name, '[data-m=close]', '繼續畫');
        await shot('editor-menu');
        await press(p, name, '[data-m=quit]', '存檔並離開');
        await wait(2000);
      }
    }
    if ((await hittable(p, '.mk-home [data-a=back]')) === 'ok') await press(p, name, '.mk-home [data-a=back]', '自建地圖 返回');
    await wait(1000);
    await must(p, name, '[data-act=party]', 'back on the title after 自建地圖');
  }

  // 創作樂園: 最多花 first; a map's page — 下載到我的地圖 stays on the page, 直接玩 opens the new-game sheet with the map
  // (the user 2026-11-16). The relay's library needs a map (a test one in its data dir).
  if (await press(p, name, '[data-act=maker]', '自建地圖')) {
    await wait(1500);
    if (await press(p, name, '.mk-home [data-a=lib]', '創作樂園')) {
      const card = await p.waitForSelector('.mk-hall-list [data-open]', { timeout: 20000 }).catch(() => null);
      if ((await p.$eval('.mk-hall-sort .chip', e => e.textContent + (e.classList.contains('on') ? ' on' : '')).catch(() => '')) !== '最多花 on') fail(name, '創作樂園: 最多花 is not the first and chosen sort');
      await shot('hall');
      if (!card) fail(name, '創作樂園 lists no map (a test map in the relay?)');
      else if (await press(p, name, '.mk-hall-list [data-open]', '創作樂園 地圖')) {
        await wait(800);
        await must(p, name, '.mk-page [data-g=back]', '地圖頁 返回');
        await must(p, name, '.mk-page [data-g=play]', '直接玩');
        await shot('lib-page');
        if (await p.$('.mk-page [data-g=take]:not([disabled])')) {
          await press(p, name, '.mk-page [data-g=take]', '下載到我的地圖');
          await p.waitForFunction(() => /已在我的地[圖图]/.test(document.querySelector('.mk-page [data-g=take]')?.textContent ?? ''), null, { timeout: 15000 }).catch(() => fail(name, '下載到我的地圖: not 已在我的地圖 on the page'));
          if (await p.$('.mk-ed, .mk-editor')) fail(name, '下載到我的地圖 opened the editor');
        }
        if (await press(p, name, '.mk-page [data-g=play]', '直接玩')) {
          await p.waitForSelector('.ng-sheet', { timeout: 20000 }).catch(() => fail(name, '直接玩: no new-game sheet'));
          await wait(1000);
          if (!(await p.$('.ng-mine.on[data-mine="@lib"]'))) fail(name, '直接玩: the map is not picked');
          await shot('lib-setup');
          if (await press(p, name, '[data-go]', '開始遊戲 (直接玩)')) {
            await p.waitForFunction(() => window.__rich4 && window.__rich4.game, null, { timeout: 120000 }).catch(() => fail(name, '直接玩: the game did not start'));
            await wait(3000);
            await shot('lib-game');
          }
        }
      }
    }
    await p.goto(URL); await title();
  }

  // 派對模式: a room, its buttons on top, 解散房間
  if (await press(p, name, '[data-act=party]', '派對模式')) {
    await p.waitForSelector('[data-a=create]', { timeout: 20000 }).catch(() => {});
    await wait(500);
    await shot('party-menu');
    if (await press(p, name, '[data-a=create]', '建立房間')) {
      await p.waitForSelector('[data-a=open]', { timeout: 10000 }).catch(() => {});
      await wait(300);
      if (await press(p, name, '[data-a=open]', '私享房間')) {
        await p.waitForSelector('.pt-code b', { timeout: 30000 }).catch(() => fail(name, 'no room code'));
        await wait(1200);
        await must(p, name, '.pt-roomv [data-a=go]', '開始遊戲 (room)');
        await shot('party-room');
        await press(p, name, '.pt-roomv [data-a=home]', '解散房間');
        await wait(1200);
      }
    }
    await p.goto(URL); await title();
  }

  // 遊戲大廳: the host's public room (playing, 途中加入) as a card — 圍觀 and 加入 inside it (the user 2026-11-16: both
  // were pushed out); 圍觀 itself; 進入房間 to a code nobody has — 取消 while it connects
  if (hostReady && await press(p, name, '[data-act=party]', '派對模式')) {
    await p.waitForSelector('[data-a=find]', { timeout: 20000 }).catch(() => {});
    if (await press(p, name, '[data-a=find]', '遊戲大廳')) {
      // (the lobby is held by one phone and passed on; a room shows within about half a minute)
      for (let i = 0; i < 4 && !(await p.waitForSelector('.pt-room[data-code]', { timeout: 60000 }).catch(() => null)); i++) {
        // (in this test the lobby's holder may be a page just closed: out and in again, as a player would)
        await p.click('[data-a=home]').catch(() => {}); await wait(1500);
        await p.click('[data-a=find]').catch(() => {});
      }
      if (!(await p.$('.pt-room[data-code]'))) fail(name, 'the lobby lists no room');
      await wait(800);
      await must(p, name, '.pt-room[data-code] em', '大廳 加入');
      await shot('lobby');
      if (await press(p, name, '[data-watch]', '大廳 圍觀')) {
        await p.waitForFunction(() => window.__rich4 && window.__rich4.game, null, { timeout: 60000 }).catch(() => fail(name, '圍觀: no game shown'));
        await wait(3000);
        await shot('watch');
      }
    }
    await p.goto(URL); await title();
    if (await press(p, name, '[data-act=party]', '派對模式')) {
      await p.waitForSelector('[data-a=join]', { timeout: 20000 }).catch(() => {});
      if (await press(p, name, '[data-a=join]', '進入房間')) {
        await p.fill('.pt-input', '999999');
        await press(p, name, '[data-a=enter]', '進入');
        await wait(150);
        await shot('connecting');
        if (await press(p, name, '[data-a=cancel]', '連線中 取消')) {
          await wait(800);
          await must(p, name, '[data-a=join]', 'back on the party menu after 取消');
        }
      }
    }
    await p.goto(URL); await title();
  }

  // 讀取進度
  if (await press(p, name, '[data-act=load]', '讀取進度')) {
    await wait(1200);
    await shot('load');
    await press(p, name, '.slots .choices .candy.ghost', '讀取進度 取消');
    await wait(600);
  }

  // a game: the setup sheet, 開始遊戲, the board
  if (await press(p, name, '[data-act=start]', '開始遊戲')) {
    await wait(1200);
    await shot('setup');
    if (await press(p, name, '[data-go]', '開始遊戲 (setup)')) {
      await p.waitForFunction(() => window.__rich4 && window.__rich4.game, null, { timeout: 120000 }).catch(() => fail(name, 'the game did not start'));
      await wait(4000);
      await shot('game');
      // 屏幕常亮 (ui/awake.ts): the silent video plays while a game is on screen
      if ((await p.evaluate(() => { const v = document.querySelector('video'); return v ? !v.paused : null; })) !== true) fail(name, '屏幕常亮: no video playing in a game');
    }
  }
  console.log(`${name} ${w}×${h} done`);
  await c.close();
}

let hostReady = false;
/** A public room with 途中加入, started with computers: what the lobby checks look at. */
async function host(b) {
  const c = await b.newContext({ viewport: { width: 1280, height: 720 } });
  await c.addInitScript(() => { try { localStorage.setItem('rich4.party.relayDev', 'ws://127.0.0.1:8443'); } catch { /* none */ } });
  const p = await c.newPage();
  await p.goto(URL, { timeout: 120000 });
  await p.waitForSelector('.title-btn.party', { timeout: 180000 }); await wait(1500);
  await p.evaluate(() => document.querySelectorAll('.update-sheet').forEach(e => e.remove()));
  await p.click('[data-act=party]'); await p.waitForSelector('[data-a=create]'); await p.click('[data-a=create]');
  await p.waitForSelector('[data-shared="1"]'); await p.click('[data-shared="1"]'); await p.click('[data-a=open]');
  await p.waitForSelector('[data-di="1"]', { timeout: 30000 }); await wait(800); await p.click('[data-di="1"]'); await wait(800);
  await p.click('.pt-roomv [data-a=go]');
  await p.waitForFunction(() => window.__rich4 && window.__rich4.game, null, { timeout: 120000 });
  await wait(3000);
  hostReady = true;
  return c;
}

(async () => {
  const b = await chromium.launch({ executablePath: process.env.EXE, headless: true, args: ['--no-sandbox', '--mute-audio'] });
  const hc = await host(b).catch(e => { fail('host', `the lobby's room: ${e.message.split('\n')[0]}`); return null; });
  for (const s of SIZES) await run(b, s).catch(e => fail(s[0], `run ${e.message.split('\n')[0]}`));
  await hc?.close();
  await b.close();
  console.log(fails ? `${fails} FAILED` : 'ALL OK');
  process.exit(fails ? 1 : 0);
})();
