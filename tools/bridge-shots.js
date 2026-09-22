/* Bridge console screenshots and a navigation check.
   NODE_PATH=... node tools/bridge-shots.js   → tools/bridge-shots/*.png at 1440×900 (menu, chapters, briefing 6, hangar 6,
   skirmish, pause, debrief) and at 390×844 (menu, hangar); fails on page errors or when a canvas click does not navigate. */
const path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'bridge-shots');
const url = process.env.OD_URL || 'file://' + path.join(ROOT, 'index.html');
let failures = 0;
const check = (name, ok, detail) => { console.log((ok ? '  ok   ' : '  FAIL ') + name + (detail ? '  ' + detail : '')); if (!ok) failures++; };

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  async function open(w, h) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|Access to font|net::ERR/.test(m.text())) errors.push(m.text()); });
    // a played-through profile: every chapter open, the first two done
    await page.addInitScript(() => { try { localStorage.setItem('od.story', JSON.stringify({ unlockAll: true, done: { 'cold-equations': true, 'picket-line': true } })); } catch (e) { /* ignore */ } });
    await page.goto(url); await page.waitForTimeout(900);
    return page;
  }
  // an entry's centre on the canvas from the console's own hit regions
  const entryAt = (page, idPrefix, n) => page.evaluate(([p, k]) => { const list = OD.Bridge.state.hits.filter((r) => r.id.startsWith(p)); const r = list[k]; return r ? { x: r.x + r.w / 2, y: r.y + r.h / 2, id: r.id, label: r.label } : null; }, [idPrefix, n]);
  const keyAt = (page, id) => page.evaluate((k) => { const r = OD.Bridge.state.hits.find((x) => x.id === k); return r ? { x: r.x + r.w / 2, y: r.y + r.h / 2 } : null; }, id);
  const shot = async (page, name, wait) => { await page.waitForTimeout(wait == null ? 1400 : wait); await page.screenshot({ path: path.join(OUT, name + '.png') }); console.log('  shot ' + name); };
  const state = (page) => page.evaluate(() => ({ screen: OD.Bridge.current, menu: !!document.getElementById('menu'), mirror: document.querySelectorAll('#bridgeA11y button').length, errors: OD.errors.slice(), renderError: OD.Render.lastError ? String(OD.Render.lastError) : null }));

  console.log('desktop 1440×900');
  let page = await open(1440, 900);
  let st = await state(page);
  check('menu screen open with the #menu mirror', st.screen === 'menu' && st.menu && st.mirror >= 5, JSON.stringify(st));
  await shot(page, 'menu');
  // click the Story entry on the canvas
  let e = await entryAt(page, 'menu:', 0);
  await page.mouse.move(e.x, e.y); await page.waitForTimeout(80);
  await page.mouse.click(e.x, e.y);
  await page.waitForTimeout(120);
  st = await state(page);
  check('canvas click on Story opens the chapters', st.screen === 'chapters', st.screen);
  await shot(page, 'chapters');
  e = await entryAt(page, 'ch:', 5);
  await page.mouse.click(e.x, e.y); await page.waitForTimeout(120);
  st = await state(page);
  check('chapter 6 entry opens its briefing', st.screen === 'briefing', st.screen);
  await shot(page, 'briefing-6', 2600);
  let k = await keyAt(page, 'k:launch');
  await page.mouse.click(k.x, k.y); await page.waitForTimeout(150);
  st = await state(page);
  check('Launch opens the hangar', st.screen === 'hangar', st.screen);
  await shot(page, 'hangar-6', 2200);
  // pick the third ship (Bastion) and inspect it
  e = await entryAt(page, 'hg:', 2);
  await page.mouse.click(e.x, e.y); await page.waitForTimeout(120);
  await page.keyboard.press('i'); await page.waitForTimeout(150);
  st = await state(page);
  check('I opens the inspect view', st.screen === 'inspect', st.screen);
  await shot(page, 'inspect-6', 1600);
  await page.keyboard.press('Escape'); await page.waitForTimeout(120);
  st = await state(page);
  check('Esc returns to the hangar', st.screen === 'hangar', st.screen);
  // Launch → the fight starts and the console closes
  await page.keyboard.press('Enter'); await page.waitForTimeout(300);
  const fight = await page.evaluate(() => ({ active: OD.Bridge.active, sim: !!OD.Game.sim, running: OD.Game.running, hud: !document.getElementById('hud').hidden, mode: OD.Game.ctx && OD.Game.ctx.mode }));
  check('Enter launches chapter 6', !fight.active && fight.sim && fight.running && fight.hud && fight.mode === 'Story', JSON.stringify(fight));
  // pause
  await page.keyboard.press('Escape'); await page.waitForTimeout(150);
  st = await state(page);
  check('Esc in the fight opens the pause console', st.screen === 'pause', st.screen);
  await shot(page, 'pause', 900);
  await page.keyboard.press('Escape'); await page.waitForTimeout(120);
  const resumed = await page.evaluate(() => ({ active: OD.Bridge.active, warp: OD.Game.warp, hud: !document.getElementById('hud').hidden }));
  check('Esc resumes', !resumed.active && resumed.warp > 0 && resumed.hud, JSON.stringify(resumed));
  // skirmish setup from the menu
  await page.evaluate(() => OD.Game.showMenu()); await page.waitForTimeout(100);
  e = await entryAt(page, 'menu:', 2);
  await page.mouse.click(e.x, e.y); await page.waitForTimeout(120);
  st = await state(page);
  check('Skirmish entry opens the board', st.screen === 'skirmish', st.screen);
  // step a count with the + key on the canvas
  const before = await page.evaluate(() => OD.Bridge.model.state.playerShips.corvette || 0);
  k = await keyAt(page, 'sk:JC:corvette:inc');
  await page.mouse.click(k.x, k.y); await page.waitForTimeout(80);
  const after = await page.evaluate(() => OD.Bridge.model.state.playerShips.corvette || 0);
  check('stepper + adds a corvette', after === before + 1, before + ' → ' + after);
  await shot(page, 'skirmish', 1400);
  k = await keyAt(page, 'k:launch');
  await page.mouse.click(k.x, k.y); await page.waitForTimeout(150);
  st = await state(page);
  check('skirmish Launch goes to the hangar', st.screen === 'hangar', st.screen);
  // debrief: a harness fight forced to an outcome
  await page.evaluate(() => { OD.harness.start(OD.Skirmish.build({ player: 'JC', env: 'deep', range: 250, playerShips: { corvette: 2 }, enemyShips: { corvette: 2 }, seed: 9 })); for (const s of OD.Game.sim.playerShips()) { const h = OD.Game.sim.nearestHostile(s); if (h) { OD.Game.sim.setTarget(s.id, h.id); s.weaponsFree = true; OD.harness.order(s.id, { type: 'keeprange', target: h.id, range: 200e3 }); } } });
  for (let i = 0; i < 6; i++) { const o = await page.evaluate(() => OD.harness.step(600)); if (o) break; }
  await page.evaluate(() => { if (!OD.Game.sim.outcome) OD.Game.sim.outcome = 'victory'; OD.Game.endScenario(); });
  await page.waitForTimeout(100);
  st = await state(page);
  check('debrief console opens', st.screen === 'debrief', st.screen);
  await shot(page, 'debrief', 2200);
  st = await state(page);
  check('no game errors on desktop', st.errors.length === 0 && !st.renderError, st.errors.join(' | ') + (st.renderError || ''));
  await page.close();

  console.log('phone 390×844');
  page = await open(390, 844);
  st = await state(page);
  check('phone menu open', st.screen === 'menu' && st.menu, JSON.stringify(st));
  await shot(page, 'phone-menu', 1400);
  const overflow = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth, cw: document.getElementById('view').clientWidth }));
  check('no horizontal overflow on the phone', overflow.sw <= overflow.iw, JSON.stringify(overflow));
  const targets = await page.evaluate(() => OD.Bridge.state.hits.filter((r) => r.mirror && r.kind !== 'seg' || r.kind === 'entry').map((r) => ({ id: r.id, h: r.h })).filter((r) => r.h < 44));
  check('touch targets at least 44 px tall', targets.length === 0, JSON.stringify(targets));
  await page.evaluate(() => OD.Game.showBriefing(5)); await page.waitForTimeout(100);
  k = await keyAt(page, 'k:launch');
  if (!k) { await page.mouse.wheel(0, 2000); await page.waitForTimeout(200); k = await keyAt(page, 'k:launch'); }
  check('phone briefing has a Launch key within reach', !!k, JSON.stringify(k));
  await shot(page, 'phone-briefing', 1800);
  await page.evaluate(() => OD.Skirmish.screen(OD.Game)); await page.waitForTimeout(100);
  await shot(page, 'phone-skirmish', 900);
  await page.evaluate(() => OD.Game.startScenario(OD.Story.chapters[5].build(), { mode: 'Story', chapter: 5 })); await page.waitForTimeout(100);
  st = await state(page);
  check('phone hangar opens', st.screen === 'hangar', st.screen);
  await shot(page, 'phone-hangar', 2000);
  // large text still fits
  await page.evaluate(() => { OD.UI.setTextSize('large', true); OD.Game.showMenu(); }); await page.waitForTimeout(300);
  const large = await page.evaluate(() => ({ over: OD.Bridge.state.hits.filter((r) => r.x + r.w > window.innerWidth).map((r) => r.id), screen: OD.Bridge.current }));
  check('large text keeps every key inside the phone width', large.screen === 'menu' && large.over.length === 0, JSON.stringify(large));
  await page.evaluate(() => OD.UI.setTextSize('normal', true));
  st = await state(page);
  check('no game errors on the phone', st.errors.length === 0 && !st.renderError, st.errors.join(' | ') + (st.renderError || ''));
  await page.close();
  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(failures ? failures + ' check(s) failed' : 'all bridge checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
