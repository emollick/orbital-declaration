/* Objective checks for Orbital Declaration (OD.Sim): a hostile that breaks off and runs is driven off, and a
   chapter that ends only on 'neutralise' ends when she is.
   node tools/objectives-check.js   (needs Playwright + Chromium; NODE_PATH may need the global modules dir) */
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const url = process.env.OD_URL || 'file://' + path.join(ROOT, 'index.html');

let failures = 0;
function check(name, ok, detail) { console.log((ok ? '  ok   ' : '  FAIL ') + name + (detail ? '  ' + detail : '')); if (!ok) failures++; }

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
  await page.goto(url);
  await page.waitForTimeout(600);

  // Chapter 4, "Slugs in the Dark": Coriolis (required) and Lark (optional). Put a hull where the AI's break-off
  // leaves her: hurt, retreating, far out and opening.
  const place = (who, km, speed, hull) => `(() => {
    const sim = OD.Game.sim, h = sim.byId('${who}'), me = sim.byId('larkspur');
    const dir = OD.U.norm(OD.U.sub(h.pos, me.pos));
    h.pos = OD.U.add(me.pos, OD.U.scale(dir, ${km} * 1000));
    h.vel = OD.U.add(me.vel, OD.U.scale(dir, ${speed}));
    h.hull = ${hull}; h.aiState = { t: 0, retreating: true };
    return { d: Math.round(OD.U.dist(h.pos, me.pos) / 1000) };
  })()`;
  const state = () => page.evaluate(() => {
    const sim = OD.Game.sim, h = sim.byId('coriolis');
    const o = sim.objectives.find((x) => x.id === 'n');
    return { t: Math.round(sim.time), drivenOff: !!h.drivenOff, at: h.drivenOffAt, since: h.drivenOffSince, done: !!o.done, progress: o.progress, outcome: sim.outcome,
      line: (sim.log.find((l) => /is driven off/.test(l.text)) || {}).text || '', retreating: !!(h.aiState && h.aiState.retreating), order: h.order && h.order.type };
  });

  console.log('scenario: Coriolis breaks off hurt and runs past 1 500 km');
  await page.evaluate(() => OD.harness.start(3, { mode: 'Story', chapter: 3, hangarDone: true }));
  const p0 = await page.evaluate(place('coriolis', 2000, 400, 0.3));
  check('placed at 2 000 km opening at 400 m/s', p0.d >= 1990 && p0.d <= 2010, JSON.stringify(p0));
  await page.evaluate(() => OD.harness.step(100));
  let st = await state();
  check('not driven off after 100 s (the two-minute hold)', !st.drivenOff && st.since != null && !st.done, JSON.stringify(st));
  await page.evaluate(() => OD.harness.step(40));
  st = await state();
  check('driven off inside 140 s', st.drivenOff && st.at >= 120 && st.at <= 135, JSON.stringify(st));
  check('the log says so in plain words', /^ISV Coriolis is driven off: she broke off with her hull at 30 %, is past 1[\s\u00a0\u202f]500 km and still opening\. She is out of this fight\.$/.test(st.line), st.line);
  check('the neutralise objective counts her', st.done && st.progress === 1, JSON.stringify({ done: st.done, progress: st.progress }));
  check('and the chapter ends in victory', st.outcome === 'victory', st.outcome);
  // the debrief tells the truth about how she ended (story.js reads the hull; main.js prints chapter.victory)
  const deb = await page.evaluate(() => { const c = OD.Story.chapters[3]; const v = c.victory, w = OD.Story.warSoFar(4, 'victory'); OD.Game.endScenario(); return { v, w, body: OD.Bridge.model.body || '', warLine: OD.Bridge.model.warLine || '' }; });
  check('the victory text says she broke off and ran, not adrift', /broke off with her hull at 30 %/.test(deb.v) && /out of this fight/.test(deb.v) && !/adrift/.test(deb.v), deb.v);
  check('the war line says the same', /broke off/.test(deb.w) && !/adrift/.test(deb.w), deb.w);
  check('and the debrief screen prints that text', deb.body === deb.v && deb.warLine === deb.w, JSON.stringify({ body: deb.body, warLine: deb.warLine }));
  const mt = await page.evaluate(() => { const sim = OD.Game.sim; const row = (OD.Bridge.model.stats || []).find((r) => /Mission time/.test(r.k)); return { n: row ? row.n : null, v: row ? row.v : null, outcomeTime: sim.outcomeTime, time: sim.time }; });
  check('the debrief mission time is the sim time at the outcome', mt.n != null && Math.abs(mt.n - mt.outcomeTime) <= 1.5, JSON.stringify(mt));

  console.log('scenario: Coriolis disabled reads adrift');
  await page.evaluate(() => OD.harness.start(3));
  const deb2 = await page.evaluate(() => { const sim = OD.Game.sim, h = sim.byId('coriolis'); h.disabled = true; h.hull = 0.12; OD.harness.step(2); return { outcome: sim.outcome, v: OD.Story.chapters[3].victory }; });
  check('disabled at 12 % reads adrift, not driven off', deb2.outcome === 'victory' && /adrift at 12 % hull integrity/.test(deb2.v) && !/broke off/.test(deb2.v), JSON.stringify(deb2));

  console.log('scenario: breaking off inside 1 500 km is not driven off');
  await page.evaluate(() => OD.harness.start(3));
  await page.evaluate(place('coriolis', 800, 400, 0.3));
  await page.evaluate(() => OD.harness.step(200));
  st = await state();
  check('still in the fight at 800 km after 200 s', !st.drivenOff && !st.done && !st.outcome, JSON.stringify(st));

  console.log('scenario: far out but not breaking off is not driven off');
  await page.evaluate(() => OD.harness.start(3));
  await page.evaluate(() => { const sim = OD.Game.sim, h = sim.byId('coriolis'), me = sim.byId('larkspur'); const dir = OD.U.norm(OD.U.sub(h.pos, me.pos)); h.pos = OD.U.add(me.pos, OD.U.scale(dir, 2000e3)); h.vel = OD.U.add(me.vel, OD.U.scale(dir, 400)); h.aiState = { t: 0, retreating: false }; });
  await page.evaluate(() => OD.harness.step(200));
  st = await state();
  check('a whole hull at 2 000 km is not driven off', !st.drivenOff && !st.done && !st.outcome, JSON.stringify(st));

  console.log('scenario: the hold restarts when the range stops opening');
  await page.evaluate(() => OD.harness.start(3));
  await page.evaluate(place('coriolis', 2000, 400, 0.3));
  await page.evaluate(() => OD.harness.step(80));
  await page.evaluate(() => { const sim = OD.Game.sim, h = sim.byId('coriolis'), me = sim.byId('larkspur'); h.ai = false; h.order = { type: 'hold' }; h.vel = OD.U.add(me.vel, OD.U.scale(OD.U.norm(OD.U.sub(me.pos, h.pos)), 100)); });
  await page.evaluate(() => OD.harness.step(10));
  st = await state();
  check('closing again clears the hold', !st.drivenOff && st.since == null, JSON.stringify(st));

  console.log('scenario: a raider running from a chase (chapter 5) is never driven off');
  await page.evaluate(() => OD.harness.start(4));
  await page.evaluate(() => { const sim = OD.Game.sim, h = sim.byId('tamarind'); h.hull = 0.3; });
  await page.evaluate(() => OD.harness.step(300));
  const t5 = await page.evaluate(() => { const sim = OD.Game.sim, h = sim.byId('tamarind'), me = sim.byId('larkspur'); const o = sim.objectives.find((x) => x.id === 'n'); return { t: Math.round(sim.time), km: Math.round(OD.U.dist(h.pos, me.pos) / 1000), drivenOff: !!h.drivenOff, retreating: !!(h.aiState && h.aiState.retreating), done: !!o.done, outcome: sim.outcome }; });
  check('Tamarind hurt at ' + t5.km + ' km and opening is still the objective', !t5.drivenOff && !t5.retreating && !t5.done && !t5.outcome, JSON.stringify(t5));

  const realErrors = consoleErrors.filter((e) => !/fonts.googleapis|ERR_INTERNET|net::ERR|Failed to load resource/.test(e) && !(/^file:/.test(url) && /Access to font/.test(e)));
  check('no console errors', realErrors.length === 0, realErrors.join(' | '));
  console.log('scenario: a hull adrift with a party on her drive is not lost yet, and comes back (v13)');
  {
    const r = await page.evaluate(() => {
      if (!(window.OD && OD.Crew && typeof OD.Crew.board === 'function')) return { skipped: true };
      OD.harness.start(OD.Skirmish.build({ player: 'JC', env: 'deep', range: 900, seed: 5, playerShips: { corvette: 1 }, enemyShips: { corvette: 1 } }));
      const sim = OD.Game.sim, me = sim.ships.find((x) => x.player);
      for (const x of sim.ships) { x.weaponsFree = false; x.cmdThrottle = 0; x.order = { type: 'hold' }; if (!x.player) { x.ai = false; x.target = null; } }
      const d = me.components.find((c) => c.id === 'drive'); d.hp = 0; OD.Damage.aggregate(me); me.disabled = true;
      OD.harness.step(30);
      const out = { held: !sim.outcome, holdLine: sim.log.some((l) => /goes on while that repair can land/.test(l.text)) };
      for (let i = 0; i < 9; i++) OD.harness.step(60);
      out.back = !me.disabled && me.systems.drive > 0.25; out.backLine = sim.log.some((l) => /has thrust again/.test(l.text)); out.outcome = sim.outcome;
      // a hull disabled for her hull, not her drive, stays disabled and the engagement is lost
      OD.harness.start(OD.Skirmish.build({ player: 'JC', env: 'deep', range: 900, seed: 5, playerShips: { corvette: 1 }, enemyShips: { corvette: 1 } }));
      const s3 = OD.Game.sim, m3 = s3.ships.find((x) => x.player); m3.hull = 0.1; m3.disabled = true; OD.harness.step(5);
      out.hullLost = s3.outcome === 'defeat' && m3.disabled;
      return out;
    });
    if (r.skipped) console.log('    (crew module not loaded: scenario skipped)');
    else {
      check('the engagement holds while a party is on the wrecked drive', r.held && r.holdLine, JSON.stringify(r));
      check('the jury-rig gives her thrust back and she is no longer disabled', r.back && r.backLine && !r.outcome, JSON.stringify(r));
      check('a hull disabled for her hull stays lost', r.hullLost, JSON.stringify(r));
    }
  }
  console.log('scenario: a protected hull adrift with a party on her drive holds the guard, and comes back (v13, round 2)');
  {
    const r = await page.evaluate(() => {
      if (!(window.OD && OD.Crew && typeof OD.Crew.board === 'function')) return { skipped: true };
      // two of ours, the frigate protected: her drive wrecked, her party on it, the guard holds and she comes back
      OD.harness.start(OD.Skirmish.build({ player: 'JC', env: 'deep', range: 900, seed: 5, playerShips: { corvette: 1, frigate: 1 }, enemyShips: { corvette: 1 } }));
      const sim = OD.Game.sim, fr = sim.ships.find((x) => x.player && x.cls === 'frigate');
      for (const x of sim.ships) { x.weaponsFree = false; x.cmdThrottle = 0; x.order = { type: 'hold' }; if (!x.player) { x.ai = false; x.target = null; } }
      sim.objectives.push({ id: 'guard', type: 'protect', ship: fr.id, text: fr.name + ' survives' });
      const d = fr.components.find((c) => c.id === 'drive'); d.hp = 0; OD.Damage.aggregate(fr); fr.disabled = true;
      OD.harness.step(30);
      const out = { held: !sim.outcome, holdLine: sim.log.filter((l) => /cannot move, but a party is on her drive/.test(l.text)).length };
      for (let i = 0; i < 9; i++) OD.harness.step(60);
      out.back = !fr.disabled && fr.systems.drive > 0.25; out.outcome = sim.outcome; out.holdLines = sim.log.filter((l) => /cannot move, but a party is on her drive/.test(l.text)).length;
      // the same hull with no crew to mend her: the guard fails at once
      OD.harness.start(OD.Skirmish.build({ player: 'JC', env: 'deep', range: 900, seed: 5, playerShips: { corvette: 1, frigate: 1 }, enemyShips: { corvette: 1 } }));
      const s2 = OD.Game.sim, f2 = s2.ships.find((x) => x.player && x.cls === 'frigate');
      s2.objectives.push({ id: 'guard', type: 'protect', ship: f2.id, text: f2.name + ' survives' });
      f2.crew = undefined; const d2 = f2.components.find((c) => c.id === 'drive'); d2.hp = 0; OD.Damage.aggregate(f2); f2.disabled = true; OD.harness.step(5);
      out.noCrewLost = s2.outcome === 'defeat';
      return out;
    });
    if (r.skipped) console.log('    (crew module not loaded: scenario skipped)');
    else {
      check('the protect guard holds while a party is on the wrecked drive, said once', r.held && r.holdLine === 1, JSON.stringify(r));
      check('the protected hull comes back and the guard is still open', r.back && !r.outcome && r.holdLines === 1, JSON.stringify(r));
      check('a protected hull with nobody to mend her is lost at once', r.noCrewLost, JSON.stringify(r));
    }
  }
  await browser.close();
  console.log(failures ? failures + ' check(s) failed' : 'all objective checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
