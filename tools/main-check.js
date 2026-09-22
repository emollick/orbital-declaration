/* Game shell checks: the debrief's Continue fires once and closes the console, the situation screen before
   chapter 1 and the Situation entry on a story pause, the DOM fallback when js/bridge.js is missing, Enter on the
   skirmish board with the cursor on a hull row, the pause warp across How to play, the refit ledger, and the
   fleet refit at an owned yard.   NODE_PATH=... node tools/main-check.js */
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
  const cur = () => page.evaluate(() => ({ screen: OD.Bridge.current, dom: OD.UI.currentScreen, errors: OD.errors.slice(), mirror: document.querySelectorAll('#bridgeA11y button').length, sim: !!OD.Game.sim }));
  const keyAt = (id) => page.evaluate((k) => { const r = OD.Bridge.state.hits.find((x) => x.id === k); return r ? { x: r.x + r.w / 2, y: r.y + r.h / 2 } : null; }, id);

  console.log('campaign debrief: Continue closes the console and fires once');
  await page.evaluate(() => { const s = OD.Campaign.newState(); OD.Campaign.move(s, 'l5'); OD.Campaign.move(s, 'thebe'); OD.Campaign.save(s); const sc = OD.Campaign.buildBattle(s); window.__ends = 0; OD.Game.startScenario(sc, { mode: 'Campaign', brief: { title: 'Thebe Yards', text: ['A captured yard.'] }, briefShown: true, hangarDone: true, onEnd: (o, sim) => { window.__ends++; OD.Campaign.applyBattle(s, sim, o); OD.Campaign.save(s); OD.Campaign.screen(OD.Game, s); } }); });
  await page.waitForTimeout(150);
  await page.evaluate(() => { OD.Game.sim.outcome = 'victory'; OD.Game.endScenario(); }); await page.waitForTimeout(100);
  let st = await cur();
  check('debrief on the console', st.screen === 'debrief', st.screen);
  let k = await keyAt('k:cont'); await page.mouse.click(k.x, k.y); await page.waitForTimeout(150);
  st = await cur();
  check('Continue closes the console under the map and drops the sim', st.screen === null && st.dom === 'campaign' && st.mirror === 0 && !st.sim, JSON.stringify(st));
  await page.keyboard.press('Tab'); await page.keyboard.press('Enter'); await page.waitForTimeout(100);
  const ends = await page.evaluate(() => window.__ends);
  check('onEnd fired exactly once', ends === 1, String(ends));
  const owner = await page.evaluate(() => { const s = OD.Campaign.load(); return { owner: s.nodes.thebe.owner, dup: s.log.filter((l) => /Thebe/.test(l) && /control/.test(l)).length }; });
  check('the battle was applied to the save once', owner.owner === 'JC' && owner.dup === 1, JSON.stringify(owner));

  console.log('skirmish board: Enter with the cursor on a hull row still launches');
  await page.evaluate(() => OD.Skirmish.screen(OD.Game)); await page.waitForTimeout(150);
  const row = await page.evaluate(() => { const r = OD.Bridge.state.hits.find((x) => x.kind === 'step'); return r ? { x: r.x + r.w / 2, y: r.y + r.h / 2, id: r.id } : null; });
  check('the board has stepper rows', !!row, JSON.stringify(row));
  const before = await page.evaluate(() => JSON.stringify(OD.Bridge.model.state.playerShips));
  await page.mouse.move(row.x, row.y); await page.waitForTimeout(80);
  await page.keyboard.press('Enter'); await page.waitForTimeout(200);
  st = await cur();
  const after = await page.evaluate(() => OD.Bridge.model && OD.Bridge.model.ships ? 'hangar' : JSON.stringify(OD.Skirmish.loadOpts().playerShips));
  check('Enter launched (hangar) and no ship was added', st.screen === 'hangar' && after === 'hangar', st.screen + ' ' + before + ' → ' + after);
  await page.keyboard.press('Escape'); await page.waitForTimeout(100);
  st = await cur();
  check('Esc back to the board', st.screen === 'skirmish', st.screen);
  // keyboard focus on a stepper still takes Enter
  await page.keyboard.press('ArrowDown'); await page.waitForTimeout(50);
  const kf = await page.evaluate(() => ({ id: OD.Bridge.state.focusId, byKey: OD.Bridge.state.focusByKey }));
  check('arrow focus is keyboard focus', kf.byKey === true && !!kf.id, JSON.stringify(kf));
  await page.evaluate(() => OD.Game.showMenu()); await page.waitForTimeout(100);

  console.log('pause: the warp survives a trip through How to play');
  await page.evaluate(() => OD.harness.start(OD.Skirmish.build({ player: 'JC', env: 'deep', range: 800, playerShips: { corvette: 1 }, enemyShips: { corvette: 1 }, seed: 5 }), { mode: 'Skirmish' })); await page.waitForTimeout(100);
  // the opening contact warning pulls warp to 1× once (the loop's alarm rule); let that pass before pausing at 16×
  await page.evaluate(() => OD.Game.setWarp(16)); await page.waitForTimeout(150);
  await page.evaluate(() => { OD.Game.setWarp(16); OD.Game.pauseMenu(); }); await page.waitForTimeout(80);
  const skPause = await page.evaluate(() => (OD.Bridge.model.entries || []).map((e) => e.label));
  check('a skirmish pause has no Situation entry', !skPause.includes('Situation') && skPause[1] === 'How to play', JSON.stringify(skPause));
  await page.keyboard.press('2'); await page.waitForTimeout(150);
  st = await cur();
  check('How to play opens as a DOM screen', st.dom === 'help', JSON.stringify(st));
  await page.click('#helpClose'); await page.waitForTimeout(120);
  st = await cur();
  check('back to the pause screen', st.screen === 'pause', st.screen);
  await page.keyboard.press('1'); await page.waitForTimeout(30);
  const warp = await page.evaluate(() => OD.Game.warp);
  check('Resume restores 16×', warp === 16, String(warp));

  console.log('story pause: Situation sits between Resume and How to play, and gives the warp back');
  await page.evaluate(() => { OD.harness.start(0, { mode: 'Story', chapter: 0, hangarDone: true }); OD.Game.running = true; });
  await page.evaluate(() => OD.Game.setWarp(4)); await page.waitForTimeout(120);
  await page.evaluate(() => { OD.Game.setWarp(4); OD.Game.pauseMenu(); }); await page.waitForTimeout(80);
  const stPause = await page.evaluate(() => ({ entries: (OD.Bridge.model.entries || []).map((e) => e.label), sub: OD.Bridge.model.entries[0].sub }));
  check('a story pause offers Situation as entry 2', stPause.entries[0] === 'Resume' && stPause.entries[1] === 'Situation' && stPause.entries.length === 4, JSON.stringify(stPause.entries));
  check('Resume names the warp it gives back', /4/.test(stPause.sub || ''), stPause.sub);
  await page.keyboard.press('2'); await page.waitForTimeout(150);
  st = await cur();
  check('Situation opens the console screen over the paused fight', st.screen === 'situation' && st.sim, JSON.stringify(st));
  const war = await page.evaluate(() => ({ paras: OD.Bridge.model.paragraphs.length, keys: OD.Bridge.model.keys.map((k) => k.label) }));
  // v12 round 2: from the pause menu the one key says where it goes back to; Continue only leads into chapter 1
  check('the screen carries the situation text and a key back to where it came from', war.paras >= 2 && /Continue|Back to the/.test(war.keys.join('|')), JSON.stringify(war));
  await page.keyboard.press('Escape'); await page.waitForTimeout(150);
  st = await cur();
  check('Esc goes back to the pause screen', st.screen === 'pause', st.screen);
  await page.keyboard.press('1'); await page.waitForTimeout(80);
  const warp2 = await page.evaluate(() => ({ warp: OD.Game.warp, screen: OD.Bridge.current }));
  check('Resume after a trip through Situation restores 4×', warp2.warp === 4 && warp2.screen === null, JSON.stringify(warp2));
  await page.evaluate(() => { OD.Game.running = false; OD.Game.sim = null; OD.Game.showMenu(); }); await page.waitForTimeout(80);

  console.log('debrief: what the chapter changed for the war');
  await page.evaluate(() => { OD.harness.start(0, { mode: 'Story', chapter: 0, hangarDone: true }); OD.Game.sim.outcome = 'victory'; OD.Game.endScenario(); }); await page.waitForTimeout(120);
  const deb = await page.evaluate(() => ({ screen: OD.Bridge.current, body: OD.Bridge.model.body, warLine: OD.Bridge.model.warLine, want: OD.Story.warSoFar(1, 'victory') }));
  check('the debrief shows the war-so-far line after the body', deb.screen === 'debrief' && !!deb.body && deb.warLine === deb.want && deb.warLine !== deb.body, JSON.stringify(deb).slice(0, 220));
  const debD = await page.evaluate(() => { OD.Bridge.close(); OD.harness.start(2, { mode: 'Story', chapter: 2, hangarDone: true }); OD.Game.sim.outcome = 'defeat'; OD.Game.endScenario(); return { warLine: OD.Bridge.model.warLine, want: OD.Story.warSoFar(3, 'defeat'), title: OD.Bridge.model.title }; }); await page.waitForTimeout(120);
  check('a defeat gets its own war-so-far line', debD.warLine === debD.want && !!debD.warLine, JSON.stringify(debD));
  await page.evaluate(() => { OD.Bridge.close(); OD.Game.sim = null; OD.Game.running = false; OD.Game.showMenu(); }); await page.waitForTimeout(80);

  console.log('refit ledger: backing out of the hangar charges nothing');
  const hasCfg = await page.evaluate(() => !!(OD.Configurator && OD.Configurator.mount));
  await page.evaluate(() => { OD.Game._refits = [{ id: 'x', cls: 'corvette', cost: 10 }]; OD.Game.openHangar(OD.Skirmish.build({ player: 'JC', env: 'deep', range: 800, playerShips: { corvette: 1 }, enemyShips: { corvette: 1 }, seed: 5 }), { mode: 'Skirmish', onBack: () => OD.Game.showMenu() }); }); await page.waitForTimeout(80);
  const led0 = await page.evaluate(() => (OD.Game._refits || []).length);
  check('opening the hangar on a new scenario clears the ledger', led0 === 0, String(led0));
  await page.evaluate(() => { OD.Game._refits = [{ id: 'x', cls: 'corvette', cost: 10 }]; OD.Game.hangarBack(OD.Game._hangar.ctx); }); await page.waitForTimeout(80);
  const led1 = await page.evaluate(() => (OD.Game._refits || []).length);
  check('Back clears the ledger', led1 === 0, String(led1));

  console.log('fleet refit: the hangar on the fleet at an owned port');
  await page.evaluate(() => { const s = OD.Campaign.newState(); s.rp = 500; OD.Campaign.save(s); window.__ok = OD.Game.refitFleet(s); }); await page.waitForTimeout(120);
  st = await cur();
  const model = await page.evaluate(() => ({ ok: window.__ok, note: OD.Bridge.model && OD.Bridge.model.note, refit: !!OD.Bridge.state.hits.find((x) => x.id === 'k:refit'), back: !!OD.Bridge.state.hits.find((x) => x.id === 'k:launch'), ships: OD.Bridge.model && OD.Bridge.model.ships.length }));
  check('refitFleet opens the hangar on the fleet', model.ok && st.screen === 'hangar' && model.ships > 0, JSON.stringify(model));
  check('a Refit key is on offer at an owned port', !hasCfg || (model.refit && /RP available/.test(model.note || '')), JSON.stringify(model));
  await page.evaluate(() => { OD.Game._refits = [{ id: OD.Campaign.load().fleet[0].id, cls: 'frigate', cost: 30 }]; }); // a refit as the yard would ledger it
  await page.keyboard.press('Enter'); await page.waitForTimeout(150);
  st = await cur();
  const saved = await page.evaluate(() => { const s = OD.Campaign.load(); return { rp: s.rp, cls: s.fleet[0].cls, log: s.log[s.log.length - 1] }; });
  check('Back to the map commits the refit to the save and opens the map', st.dom === 'campaign' && st.screen === null && saved.rp === 470 && saved.cls === 'frigate' && /Refit paid/.test(saved.log), JSON.stringify([st.dom, saved]));
  await page.evaluate(() => OD.Campaign.clear());
  st = await cur();
  check('no game errors', st.errors.length === 0, st.errors.join(' | '));

  console.log('without js/bridge.js: the DOM screens carry the game');
  const p2 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  p2.on('pageerror', (e) => errors.push('nobridge pageerror: ' + e.message));
  await p2.route('**/js/bridge.js*', (r) => r.abort());
  await p2.goto(url); await p2.waitForTimeout(800);
  const nb = () => p2.evaluate(() => ({ bridge: !!OD.Bridge, dom: OD.UI.currentScreen, menu: !!document.getElementById('menu'), entries: document.querySelectorAll('#screens .menu-actions button').length, errors: OD.errors.slice() }));
  let s2 = await nb();
  check('main console renders as #menu with entries', !s2.bridge && s2.menu && s2.entries >= 4, JSON.stringify(s2));
  await p2.keyboard.press('1'); await p2.waitForTimeout(100);
  s2 = await nb();
  check('digit 1 opens the chapters', s2.dom === 'chapters' && s2.entries === 8, JSON.stringify(s2));
  await p2.keyboard.press('1'); await p2.waitForTimeout(150);
  s2 = await nb();
  const sitText = await p2.evaluate(() => document.querySelector('#screens') ? document.querySelector('#screens').textContent : '');
  check('chapter 1 opens the situation screen first', s2.dom === 'situation' && /Halvorsen/.test(sitText) && /Inner Systems Authority/.test(sitText), s2.dom);
  await p2.evaluate(() => Array.from(document.querySelectorAll('#screens .actions button')).find((x) => /Continue/.test(x.textContent)).click()); await p2.waitForTimeout(150);
  s2 = await nb();
  const launch = await p2.evaluate(() => { const b = Array.from(document.querySelectorAll('#screens .actions button')).find((x) => /Launch/.test(x.textContent)); return !!b; });
  check('Continue reaches chapter 1\'s briefing with a Launch key', s2.dom === 'briefing' && launch, JSON.stringify(s2));
  await p2.keyboard.press('Escape'); await p2.waitForTimeout(100);
  s2 = await nb();
  check('Esc backs out to the chapters', s2.dom === 'chapters', s2.dom);
  await p2.evaluate(() => OD.Game.showBriefing(0, { skipSituation: true })); await p2.waitForTimeout(100);
  await p2.evaluate(() => Array.from(document.querySelectorAll('#screens .actions button')).find((x) => /Launch/.test(x.textContent)).click()); await p2.waitForTimeout(200);
  const fight = await p2.evaluate(() => ({ dom: OD.UI.currentScreen, sim: !!OD.Game.sim, running: OD.Game.running, hud: !document.getElementById('hud').hidden }));
  check('Launch skips the hangar and starts the fight', !fight.dom && fight.sim && fight.running && fight.hud, JSON.stringify(fight));
  await p2.keyboard.press('Escape'); await p2.waitForTimeout(100);
  s2 = await nb();
  check('Esc pauses as a DOM screen with Situation among the entries', s2.dom === 'pause' && s2.entries === 4, JSON.stringify(s2));
  await p2.keyboard.press('1'); await p2.waitForTimeout(100);
  const resumed = await p2.evaluate(() => ({ dom: OD.UI.currentScreen, warp: OD.Game.warp, hud: !document.getElementById('hud').hidden }));
  check('Resume closes the pause screen', !resumed.dom && resumed.warp === 1 && resumed.hud, JSON.stringify(resumed));
  await p2.evaluate(() => { OD.Game.sim.outcome = 'victory'; OD.Game.endScenario(); }); await p2.waitForTimeout(100);
  s2 = await nb();
  const dkeys = await p2.evaluate(() => Array.from(document.querySelectorAll('#screens .actions button')).map((b) => b.textContent));
  check('debrief as a DOM screen with its keys', s2.dom === 'debrief' && dkeys.some((t) => /Next chapter|Next: /.test(t)) && dkeys.some((t) => /Chapters/.test(t)), JSON.stringify(dkeys));
  const dwar = await p2.evaluate(() => ({ text: document.querySelector('#screens').textContent, want: OD.Story.warSoFar(1, 'victory') }));
  check('the DOM debrief prints the war-so-far line', dwar.text.indexOf(dwar.want) >= 0, dwar.want);
  await p2.keyboard.press('Escape'); await p2.waitForTimeout(100);
  s2 = await nb();
  check('Esc from the debrief goes to the chapters', s2.dom === 'chapters', s2.dom);
  await p2.evaluate(() => OD.Skirmish.screen(OD.Game)); await p2.waitForTimeout(100);
  s2 = await nb();
  check('skirmish keeps its DOM board', s2.dom === 'skirmish', s2.dom);
  await p2.evaluate(() => OD.Game.showMenu()); await p2.waitForTimeout(100);
  s2 = await nb();
  check('no errors without the bridge', s2.menu && s2.errors.length === 0, s2.errors.join(' | '));
  await p2.close();
  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(failures ? failures + ' check(s) failed' : 'all game shell checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
