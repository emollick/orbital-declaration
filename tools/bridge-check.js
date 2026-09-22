/* Bridge console flow checks: the situation screen before chapter 1, campaign brief → hangar → fight, a refit
   through the yard, keyboard and mirror navigation, reduced motion.   NODE_PATH=... node tools/bridge-check.js */
const path = require('path');
const { chromium } = require('playwright');
const url = process.env.OD_URL || 'file://' + path.join(path.resolve(__dirname, '..'), 'index.html');
let failures = 0;
const check = (name, ok, detail) => { console.log((ok ? '  ok   ' : '  FAIL ') + name + (detail ? '  ' + detail : '')); if (!ok) failures++; };

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(url); await page.waitForTimeout(800);
  const cur = () => page.evaluate(() => ({ screen: OD.Bridge.current, dom: OD.UI.currentScreen, errors: OD.errors.slice(), hits: OD.Bridge.state.hits.length }));
  const keyAt = (id) => page.evaluate((k) => { const r = OD.Bridge.state.hits.find((x) => x.id === k); return r ? { x: r.x + r.w / 2, y: r.y + r.h / 2 } : null; }, id);
  const OD_WAR1_DEFEAT = await page.evaluate(() => OD.Story.warSoFar(1, 'defeat'));

  console.log('keyboard: arrows and Enter walk the main console');
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await page.waitForTimeout(60);
  let f = await page.evaluate(() => OD.Bridge.state.focusId);
  check('two ArrowDowns focus the second entry', f === 'menu:1', f);
  await page.keyboard.press('Enter'); await page.waitForTimeout(150);
  let st = await cur();
  check('Enter on Campaign opens the campaign map (DOM screen) and closes the console', st.dom === 'campaign' && st.screen === null, JSON.stringify(st));
  await page.keyboard.press('Escape'); await page.waitForTimeout(150);

  console.log('situation: the war in plain words, before chapter 1');
  await page.evaluate(() => OD.Game.storySelect()); await page.waitForTimeout(150);
  st = await cur();
  check('Story opens the chapters', st.screen === 'chapters', st.screen);
  const warKey = await page.evaluate(() => { const r = OD.Bridge.state.hits.find((x) => x.id === 'k:war'); return r ? { label: r.label, hot: r.hot } : null; });
  check('the chapters screen offers "The war so far"', !!warKey && /war so far/i.test(warKey.label), JSON.stringify(warKey));
  const wk = await keyAt('k:war'); await page.mouse.click(wk.x, wk.y); await page.waitForTimeout(200);
  st = await cur();
  check('the key opens the situation screen', st.screen === 'situation', st.screen);
  const sit = await page.evaluate(() => ({ paras: OD.Bridge.model.paragraphs || [], sides: (OD.Bridge.model.sides || []).map((x) => x.name), keys: (OD.Bridge.model.keys || []).map((x) => x.label), mirror: Array.from(document.querySelectorAll('#bridgeA11y button')).map((b) => b.textContent) }));
  check('two or three short sentences on who, whom and why', sit.paras.length >= 2 && sit.paras.length <= 3 && /Halvorsen/.test(sit.paras[0]) && sit.paras.join(' ').length < 600, JSON.stringify(sit.paras).slice(0, 160));
  check('the situation names both sides', /Jovian Compact/.test(sit.sides.join('|')) && /Inner Systems Authority/.test(sit.sides.join('|')), JSON.stringify(sit.sides));
  check('a Continue or Back key, mirrored for the keyboard', /Continue|Back to /.test(sit.keys.join('|')) && sit.mirror.some((b) => /Continue|Back to /.test(b)), JSON.stringify(sit.keys) + ' ' + JSON.stringify(sit.mirror));
  await page.keyboard.press('Escape'); await page.waitForTimeout(150);
  st = await cur();
  check('Esc backs out to the chapters', st.screen === 'chapters', st.screen);
  await page.keyboard.press('1'); await page.waitForTimeout(200);
  st = await cur();
  check('starting chapter 1 shows the situation first', st.screen === 'situation', st.screen);
  await page.keyboard.press('Enter'); await page.waitForTimeout(250);
  st = await cur();
  const brief1 = await page.evaluate(() => ({ title: OD.Bridge.model.title, first: (OD.Bridge.model.paragraphs || [])[0] || '' }));
  check('Continue reaches chapter 1\'s briefing', st.screen === 'briefing' && brief1.title === 'Cold Equations', st.screen + ' ' + brief1.title);
  check('the brief opens with who, where and why', /Halvorsen/.test(brief1.first) && /Callisto/.test(brief1.first) && /Larkspur/.test(brief1.first), brief1.first.slice(0, 120));
  await page.evaluate(() => OD.Game.showBriefing(5)); await page.waitForTimeout(200);
  const b6 = await page.evaluate(() => ({ screen: OD.Bridge.current, first: (OD.Bridge.model.paragraphs || [])[0] || '' }));
  check('a later chapter goes straight to its briefing', b6.screen === 'briefing', b6.screen);
  check('every brief opens with who and where', /You are|Authority/.test(b6.first) && /Europa|Conamara/.test(b6.first), b6.first.slice(0, 120));
  // a story chapter's pause screen carries Situation; skirmish does not
  await page.evaluate(() => { OD.harness.start(0, { mode: 'Story', chapter: 0, hangarDone: true }); OD.Game.running = true; OD.Game.pauseMenu(); }); await page.waitForTimeout(150);
  let entries = await page.evaluate(() => (OD.Bridge.model.entries || []).map((e) => e.label));
  check('a story pause offers Situation', entries.includes('Situation'), JSON.stringify(entries));
  await page.keyboard.press('2'); await page.waitForTimeout(200);
  st = await cur();
  check('pause · Situation opens the screen', st.screen === 'situation', st.screen);
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  st = await cur();
  check('Esc returns to the pause screen', st.screen === 'pause', st.screen);
  await page.evaluate(() => { OD.Bridge.close(); OD.harness.start(OD.Skirmish.build({ player: 'JC', env: 'deep', range: 600, playerShips: { corvette: 1 }, enemyShips: { corvette: 1 }, seed: 4 }), { mode: 'Skirmish' }); OD.Game.running = true; OD.Game.pauseMenu(); }); await page.waitForTimeout(150);
  entries = await page.evaluate(() => (OD.Bridge.model.entries || []).map((e) => e.label));
  check('a skirmish pause has no Situation entry', !entries.includes('Situation'), JSON.stringify(entries));
  // the debrief says what the result changed for the war
  await page.evaluate(() => { OD.Bridge.close(); OD.harness.start(0, { mode: 'Story', chapter: 0, hangarDone: true }); OD.Game.sim.outcome = 'defeat'; OD.Game.endScenario(); }); await page.waitForTimeout(200);
  const deb = await page.evaluate(() => ({ screen: OD.Bridge.current, body: OD.Bridge.model.body, warLine: OD.Bridge.model.warLine, title: OD.Bridge.model.title }));
  check('a defeat debrief carries the war line after the body', deb.screen === 'debrief' && !!deb.warLine && deb.warLine === OD_WAR1_DEFEAT, JSON.stringify(deb).slice(0, 200));
  await page.evaluate(() => { OD.Bridge.close(); OD.Game.sim = null; OD.Game.running = false; OD.Game.showMenu(); }); await page.waitForTimeout(150);

  console.log('campaign battle: brief → hangar → fight');
  await page.evaluate(() => { const s = OD.Campaign.newState(); OD.Campaign.move(s, 'l5'); OD.Campaign.move(s, 'thebe'); OD.Campaign.save(s); const sc = OD.Campaign.buildBattle(s); window.__ended = null; OD.Game.startScenario(sc, { mode: 'Campaign', brief: { title: 'Thebe Yards', text: ['A captured Compact yard.', 'Whatever survives carries its damage forward.'] }, onEnd: (o) => { window.__ended = o; } }); });
  await page.waitForTimeout(150);
  st = await cur();
  check('campaign start shows the brief on the console', st.screen === 'briefing', JSON.stringify(st));
  let k = await keyAt('k:launch'); await page.mouse.click(k.x, k.y); await page.waitForTimeout(150);
  st = await cur();
  check('Engage opens the hangar', st.screen === 'hangar', st.screen);
  const note = await page.evaluate(() => OD.Bridge.model.note);
  check('hangar says refits need a Compact yard or port', /yard or port/.test(note || ''), note);
  const refitKey = await keyAt('k:refit');
  check('no Refit key at a hostile yard', !refitKey);
  await page.keyboard.press('Enter'); await page.waitForTimeout(300);
  const fight = await page.evaluate(() => ({ active: OD.Bridge.active, mode: OD.Game.ctx && OD.Game.ctx.mode, ships: OD.Game.sim ? OD.Game.sim.ships.length : 0, hud: !document.getElementById('hud').hidden }));
  check('campaign fight starts after the hangar', !fight.active && fight.mode === 'Campaign' && fight.ships >= 4 && fight.hud, JSON.stringify(fight));
  await page.evaluate(() => { OD.Game.sim.outcome = 'victory'; OD.Game.endScenario(); }); await page.waitForTimeout(100);
  st = await cur();
  check('campaign debrief on the console', st.screen === 'debrief', st.screen);
  k = await keyAt('k:cont'); await page.mouse.click(k.x, k.y); await page.waitForTimeout(100);
  const ended = await page.evaluate(() => window.__ended);
  check('Continue hands the outcome to the campaign', ended === 'victory', String(ended));

  console.log('refit: the yard on the ship\'s hull replaces the class for the mission');
  const hasCfg = await page.evaluate(() => !!(OD.Configurator && OD.Configurator.mount));
  if (hasCfg) {
    await page.evaluate(() => OD.Game.startScenario(OD.Skirmish.build({ player: 'JC', env: 'deep', range: 300, playerShips: { corvette: 1, frigate: 1 }, enemyShips: { corvette: 1 }, seed: 3 }), { mode: 'Skirmish' }));
    await page.waitForTimeout(150);
    st = await cur();
    check('skirmish start opens the hangar', st.screen === 'hangar', st.screen);
    const before = await page.evaluate(() => OD.Bridge.model.ships.map((s) => s.cls));
    const first = await page.evaluate(() => ({ id: OD.Bridge.model.ships[0].id, name: OD.Bridge.model.ships[0].name }));
    await page.keyboard.press('r'); await page.waitForTimeout(400);
    st = await cur();
    check('R opens the configurator as a DOM screen', st.dom === 'configurator' && !st.screen, JSON.stringify(st));
    const base = await page.evaluate(() => { const c = document.querySelector('#cfgRoot'); const ctrl = c && c._odc; return ctrl && ctrl.design ? ctrl.design().base : null; });
    check('the yard opened on the ship\'s hull', base === before[0], base + ' for a ' + before[0]);
    await page.click('#cfgRoot [data-act="save"]'); await page.waitForTimeout(200);
    const after = await page.evaluate(() => ({ cls: OD.Game._hangar.scenario.ships.filter((s) => s.player).map((s) => s.cls), custom: OD.Game._hangar.scenario.ships.filter((s) => s.player).map((s) => !!(OD.Ships.CLASSES[s.cls] || {}).custom), name: OD.Game._hangar.scenario.ships[0].name, id: OD.Game._hangar.scenario.ships[0].id }));
    check('Save refits the selected ship to the saved design (name and id kept)', after.custom[0] && !after.custom[1] && after.cls[0] !== before[0] && after.name === first.name && after.id === first.id, JSON.stringify(after));
    await page.click('#cfgRoot [data-act="back"]'); await page.waitForTimeout(200);
    st = await cur();
    const sub = await page.evaluate(() => { const r = OD.Bridge.state.hits.find((x) => x.id === 'hg:0'); return r && r.sub; });
    check('Back returns to the hangar with the refit marked', st.screen === 'hangar' && /refit/.test(sub || ''), st.screen + ' ' + sub);
    await page.keyboard.press('Enter'); await page.waitForTimeout(300);
    const flown = await page.evaluate(() => ({ cls: OD.Game.sim.playerShips().map((s) => s.cls), custom: OD.Game.sim.playerShips().map((s) => !!OD.Ships.CLASSES[s.cls].custom) }));
    check('the mission flies the design', flown.custom[0] === true, JSON.stringify(flown));
  } else console.log('  skip configurator not present');

  console.log('mirror: a real button drives the console');
  // back to the console first, then strike the test design (a design in use by a live sim cannot be drawn)
  await page.evaluate(() => OD.Game.showMenu()); await page.waitForTimeout(120);
  if (hasCfg) await page.evaluate(() => { for (const d of OD.Configurator.list()) OD.Configurator.remove(d.id || d); });
  const mirror = await page.evaluate(() => ({ menu: !!document.getElementById('menu'), buttons: Array.from(document.querySelectorAll('#bridgeA11y button')).map((b) => b.textContent.slice(0, 20)) }));
  check('#menu mirror holds the console entries', mirror.menu && mirror.buttons.some((b) => /Story/.test(b)) && mirror.buttons.some((b) => /Skirmish/.test(b)), JSON.stringify(mirror.buttons));
  await page.evaluate(() => { const b = Array.from(document.querySelectorAll('#bridgeA11y button')).find((x) => /Skirmish/.test(x.textContent)); b.focus(); b.click(); }); await page.waitForTimeout(120);
  st = await cur();
  check('mirror button opens the skirmish board', st.screen === 'skirmish', st.screen);
  await page.keyboard.press('Escape'); await page.waitForTimeout(100);
  st = await cur();
  check('Esc backs out to the main console', st.screen === 'menu', st.screen);
  await page.keyboard.press('1'); await page.waitForTimeout(100);
  st = await cur();
  check('digit 1 picks Story', st.screen === 'chapters', st.screen);
  // wheel and drag never move the camera under a console
  const cam0 = await page.evaluate(() => ({ x: OD.Game.cam.x, y: OD.Game.cam.y, z: OD.Game.cam.zoom }));
  await page.mouse.move(900, 500); await page.mouse.wheel(0, 400); await page.mouse.down(); await page.mouse.move(700, 300, { steps: 5 }); await page.mouse.up(); await page.waitForTimeout(80);
  const cam1 = await page.evaluate(() => ({ x: OD.Game.cam.x, y: OD.Game.cam.y, z: OD.Game.cam.zoom }));
  check('wheel and drag leave the camera alone', cam0.z === cam1.z, JSON.stringify([cam0, cam1]));

  console.log('reduced motion');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const p2 = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  p2.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await p2.goto(url); await p2.waitForTimeout(700);
  await p2.evaluate(() => OD.Game.showBriefing(5)); await p2.waitForTimeout(300);
  const rm = await p2.evaluate(() => ({ errors: OD.errors.slice(), screen: OD.Bridge.current, az: OD.Bridge.state.az }));
  check('reduced motion: briefing draws without errors', rm.screen === 'briefing' && rm.errors.length === 0, JSON.stringify(rm));
  await p2.close();
  st = await cur();
  check('no game errors', st.errors.length === 0, st.errors.join(' | '));
  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(failures ? failures + ' check(s) failed' : 'all bridge flow checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
