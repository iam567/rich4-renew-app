// (run: dev server :5199, local relay :8443; PW=<playwright-core> EXE=<chrome> RUN_MS=60000 HAND_MS=180000 node scripts/rank-e2e.cjs)
// 排行榜 e2e: a real game in the browser (the local relay's 開局券), 托管 on and off from the toolbar, then the record
// replayed in the page to the same step: every seat's money must match.
const { chromium } = require(process.env.PW);
const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch({ executablePath: process.env.EXE, headless: true, args: ['--no-sandbox', '--mute-audio'] });
  const c = await b.newContext({ viewport: { width: 1280, height: 720 } });
  await c.addInitScript(() => { try { localStorage.setItem('rich4.party.relayDev', 'ws://127.0.0.1:8443'); localStorage.setItem('rich4.speed', '4'); } catch {} });
  const p = await c.newPage();
  p.on('pageerror', e => console.log('PAGE ERROR', String(e).slice(0, 200)));
  await p.goto('http://127.0.0.1:5199/', { timeout: 120000 });
  await p.waitForSelector('.title-btn.party', { timeout: 180000 }); await wait(1500);
  await p.evaluate(() => document.querySelectorAll('.update-sheet').forEach(e => e.remove()));
  await p.click('[data-act=start]'); await wait(2500);
  await p.click('[data-go]');
  await p.waitForFunction(() => window.__rich4 && window.__rich4.game, null, { timeout: 120000 });
  await wait(3000);
  const info = () => p.evaluate(() => { const g = window.__rich4.game, r = window.__rich4Rank(g); return { ranked: !!r, token: !!r?.token, steps: r?.steps, day: g.daysElapsed, auto: g.players.map(q => q.autopilot), humans: g.players.map(q => q.human) }; });
  console.log('start', JSON.stringify(await info()));
  // 托管 on (its button answers the human's turn)
  for (let i = 0; i < 60 && !(await info()).auto[0]; i++) { await p.click('[data-key=autopilot]').catch(() => {}); await wait(1000); }
  console.log('auto on', JSON.stringify(await info()));
  await wait(Number(process.env.RUN_MS || 90000));
  // 托管 off from the toolbar (the screen sets it: logged)
  for (let i = 0; i < 60 && (await info()).auto[0]; i++) { await p.click('[data-key=autopilot]', { timeout: 3000 }).catch(() => {}); await wait(1500); }
  console.log('auto off', JSON.stringify(await info()));
  // by hand: GO, YES / NO in turn, the first button of any other question (the screens' own buttons, real clicks)
  let yes = true;
  for (const end = Date.now() + Number(process.env.HAND_MS || 120000); Date.now() < end;) {
    const did = await p.evaluate(flip => {
      const vis = e => e && e.getBoundingClientRect().width > 4 && getComputedStyle(e).visibility !== 'hidden';
      const yn = [...document.querySelectorAll('.choices.yesno .candy')].filter(vis);
      if (yn.length) { (flip ? yn[0] : yn[yn.length - 1]).click(); return 'yesno'; }
      const other = [...document.querySelectorAll('.msg .choices .candy:not([disabled]), .msg .choices .cell:not([disabled])')].filter(vis)[0];
      if (other) { other.click(); return 'choice'; }
      const go = document.querySelector('.go-hit');
      if (vis(go)) { go.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); go.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); go.click(); return 'go'; }
      return '';
    }, yes).catch(() => '');
    if (did === 'yesno') yes = !yes;
    await wait(700);
  }
  console.log('by hand', JSON.stringify(await info()));
  await wait(3000);
  const res = await p.evaluate(async () => {
    const g = window.__rich4.game, r = window.__rich4Rank(g);
    const steps = r.steps, money = g.players.map(q => q.cash + q.bank), day = g.daysElapsed;
    const m = await import('/src/core/replay.ts');
    const s = JSON.parse(r.settings);
    const raw = await (await fetch(`/assets/maps/map-${s.mapId}.json`)).json();
    const rp = m.replay(s, raw, r.log, 3_000_000, steps);
    return { steps, day, money, replay: { why: rp.why, days: rp.days, money: rp.money }, answers: r.log.a.length, tweaks: r.log.t, bytes: JSON.stringify(r.log).length };
  });
  console.log(JSON.stringify(res));
  console.log(JSON.stringify(res.money) === JSON.stringify(res.replay.money) && res.day === res.replay.days ? 'MATCH' : 'MISMATCH');
  await b.close();
})().catch(e => { console.log('ERR', e.message); process.exit(1); });
