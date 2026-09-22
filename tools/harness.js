/* Headless playtests for Orbital Declaration.
   node tools/harness.js [--shot out.png]   (needs Playwright + Chromium; NODE_PATH may need the global modules dir; OD_URL=http://host:port/ runs against a served build) */
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const url = process.env.OD_URL || 'file://' + path.join(ROOT, 'index.html'); // OD_URL=http://127.0.0.1:8787/ tests a served build
const shot = process.argv.includes('--shot') ? process.argv[process.argv.indexOf('--shot') + 1] : null;

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

  console.log('scenario: page load');
  const loaded = await page.evaluate(() => ({ od: !!window.OD, sim: !!(window.OD && OD.Sim), ui: !!(OD.UI), story: OD.Story ? OD.Story.chapters.length : 0, menu: !!document.getElementById('menu'), eng: !!OD.Engagement }));
  check('modules loaded', loaded.od && loaded.sim && loaded.ui, JSON.stringify(loaded));
  check('eight chapters', loaded.story === 8);
  check('menu visible', loaded.menu);
  const realErrors = consoleErrors.filter((e) => !/fonts.googleapis|ERR_INTERNET|net::ERR|engagement\.js|Failed to load resource/.test(e) && !(/^file:/.test(url) && /Access to font/.test(e))); // a file:// page cannot preload fonts (CORS); served pages can
  check('no console errors on load', realErrors.length === 0, realErrors.join(' | '));

  console.log('scenario: chapter 1 tutorial rendezvous');
  await page.evaluate(() => OD.harness.start(0));
  let st = await page.evaluate(() => OD.harness.state());
  check('ships spawned', st.ships.length === 3, st.ships.map((s) => s.name).join(', '));
  await page.evaluate(() => { OD.harness.select('larkspur'); OD.Game.setTarget('meridian'); OD.harness.order('larkspur', { type: 'intercept', target: 'meridian', range: 2000 }); });
  for (let i = 0; i < 6; i++) { await page.evaluate(() => OD.harness.step(500)); }
  st = await page.evaluate(() => OD.harness.state());
  check('all values finite', st.ships.every((s) => s.finite));
  check('rendezvous objective done within 3000 s', st.objectives[0].done, 'progress ' + st.objectives[0].progress.toFixed(2) + ' time ' + st.time);
  check('delta-v was spent', st.ships[0].dv < 51000, 'dv ' + Math.round(st.ships[0].dv));
  check('no sim/render errors', st.errors.length === 0 && !st.renderError, st.errors.join(' | ') + (st.renderError || ''));
  const hud = await page.evaluate(() => ({ panel: document.querySelector('#shipPanel .name') && document.querySelector('#shipPanel .name').textContent, fleetRows: document.querySelectorAll('.fleet-row').length, objRows: document.querySelectorAll('.obj').length, logLines: document.querySelectorAll('#log .line').length, hintVisible: !document.getElementById('hint').hidden }));
  check('ship panel switches to Long Meridian after the rendezvous', hud.panel === 'JCV Long Meridian', hud.panel);
  check('fleet list populated', hud.fleetRows === 3, String(hud.fleetRows));
  check('objectives shown', hud.objRows >= 1, String(hud.objRows));
  check('log has lines', hud.logLines >= 2, String(hud.logLines));
  await page.evaluate(() => { OD.harness.select('meridian'); OD.Game.setTarget('valhalla'); OD.harness.order('meridian', { type: 'intercept', target: 'valhalla', range: 2000 }); OD.harness.select('larkspur'); OD.Game.setTarget('valhalla'); OD.harness.order('larkspur', { type: 'intercept', target: 'valhalla', range: 2000, vmax: 1500 }); });
  for (let i = 0; i < 10; i++) { await page.evaluate(() => OD.harness.step(600)); }
  st = await page.evaluate(() => OD.harness.state());
  check('chapter 1 victory', st.outcome === 'victory', 'outcome ' + st.outcome + ' time ' + st.time + ' obj ' + JSON.stringify(st.objectives.map((o) => [o.id, o.done, +o.progress.toFixed(2)])));

  console.log('scenario: canvas click selects and panel button orders');
  await page.evaluate(() => OD.harness.start(1));
  const pt = await page.evaluate(() => { const s = OD.Game.sim.byId('larkspur'); OD.Game.cam.follow = null; OD.Game.cam.x = s.pos.x; OD.Game.cam.y = s.pos.y; OD.Game.cam.zoom = 2e-4; OD.Render.draw(OD.Game.sim, OD.Game.cam, OD.UI); const p = OD.Game.cam.toScreen(s.pos); const t = OD.Game.cam.toScreen(OD.Game.sim.byId('sabre').pos); return { p, t }; });
  await page.mouse.click(pt.p.x, pt.p.y);
  let sel = await page.evaluate(() => OD.UI.selected);
  check('click selects Larkspur', sel === 'larkspur', sel);
  await page.evaluate(() => { OD.Game.cam.fit([OD.Game.sim.byId('larkspur').pos, OD.Game.sim.byId('sabre').pos]); OD.Render.draw(OD.Game.sim, OD.Game.cam, OD.UI); });
  // the player clicks the contact where it is drawn (its ghost position while the track is fuzzy)
  const tp = await page.evaluate(() => { const t = OD.Game.sim.byId('sabre'); return OD.Game.cam.toScreen(OD.Render.viewOf ? OD.Render.viewOf(OD.Game.sim, t).pos : t.pos); });
  await page.mouse.click(tp.x, tp.y, { button: 'right' });
  st = await page.evaluate(() => OD.harness.state());
  const lark = st.ships.find((s) => s.id === 'larkspur');
  check('right-click hostile gives keep range order', lark.order.type === 'keeprange' && lark.target === 'sabre', JSON.stringify(lark.order));
  await page.click('#shipPanel [data-order="intercept"]');
  st = await page.evaluate(() => OD.harness.state());
  check('panel Intercept button sets order', st.ships.find((s) => s.id === 'larkspur').order.type === 'intercept');
  await page.hover('[data-tip="dv"]');
  await page.waitForTimeout(100);
  const tip = await page.evaluate(() => ({ hidden: document.getElementById('tooltip').hidden, text: document.getElementById('tooltip').textContent.slice(0, 40) }));
  check('tooltip appears on hover', !tip.hidden && /Delta-v/.test(tip.text), tip.text);
  for (let i = 0; i < 8; i++) { await page.evaluate(() => OD.harness.step(600)); }
  st = await page.evaluate(() => OD.harness.state());
  check('chapter 2 progresses without errors', st.errors.length === 0 && st.ships.every((s) => s.finite), st.errors.join(' | '));
  console.log('    chapter 2 after 4800 s: outcome ' + st.outcome + ', ' + st.log.join(' / '));

  console.log('scenario: physics panel renders');
  await page.evaluate(() => OD.UI.physics());
  const boxes = await page.evaluate(() => document.querySelectorAll('#physBoxes .box').length);
  check('physics panel has boxes', boxes >= 6, String(boxes));
  await page.click('#physClose');

  console.log('scenario: skirmish 3v3 at Ganymede');
  await page.evaluate(() => OD.harness.start(OD.Skirmish.build({ player: 'JC', env: 'ganymede', range: 1200, playerShips: { frigate: 1, corvette: 2 }, enemyShips: { frigate: 1, corvette: 2 }, seed: 5 })));
  // the computer's orders are sampled while the fight is on: once a side has won, its ships hold
  let aiOrdersSeen = [];
  // sample the computer's orders early (a fleet fight can be decided inside ten minutes now), then run it out
  await page.evaluate(() => OD.harness.step(60));
  { const s0 = await page.evaluate(() => OD.harness.state()); if (!s0.outcome) aiOrdersSeen = s0.ships.filter((s) => s.faction === 'ISA' && !s.destroyed).map((s) => s.order.type); }
  for (let i = 0; i < 6; i++) { await page.evaluate(() => OD.harness.step(590)); const s0 = await page.evaluate(() => OD.harness.state()); if (!s0.outcome && !aiOrdersSeen.length) aiOrdersSeen = s0.ships.filter((s) => s.faction === 'ISA').map((s) => s.order.type); }
  st = await page.evaluate(() => OD.harness.state());
  check('skirmish runs 3600 s without errors', st.errors.length === 0 && st.ships.every((s) => s.finite), st.errors.join(' | '));
  check('AI ships took orders', aiOrdersSeen.length > 0 && aiOrdersSeen.some((t) => t && t !== 'hold'), aiOrdersSeen.join(',') + (st.outcome ? ' · outcome ' + st.outcome : ''));

  console.log('scenario: chapter 5 chase');
  await page.evaluate(() => OD.harness.start(4));
  await page.evaluate(() => { OD.Game.setTarget('tamarind'); OD.harness.order('larkspur', { type: 'intercept', target: 'tamarind', range: 2000 }); });
  for (let i = 0; i < 12; i++) { await page.evaluate(() => OD.harness.step(600)); }
  st = await page.evaluate(() => OD.harness.state());
  const tam = st.ships.find((s) => s.id === 'tamarind'), lk = st.ships.find((s) => s.id === 'larkspur');
  console.log('    chase after ' + st.time + ' s: outcome ' + st.outcome + ', range ' + Math.round(Math.hypot(tam.pos.x - lk.pos.x, tam.pos.y - lk.pos.y) / 1000) + ' km, larkspur dv ' + Math.round(lk.dv) + ', tamarind dv ' + Math.round(tam.dv) + ' order ' + tam.order.type);
  check('chase ends in a result', st.outcome !== null, String(st.outcome));

  console.log('scenario: campaign battle build');
  const camp = await page.evaluate(() => { const s = OD.Campaign.newState(); OD.Campaign.move(s, 'l5'); OD.Campaign.move(s, 'thebe'); const sc = OD.Campaign.buildBattle(s); OD.harness.start(sc, { mode: 'Campaign', briefShown: true }); OD.harness.step(300); const st = OD.harness.state(); return { ships: st.ships.length, errors: st.errors, fleetAt: s.fleetAt, dv: s.fleet.map((f) => f.propFraction.toFixed(2)) }; });
  check('campaign battle runs', camp.ships >= 4 && camp.errors.length === 0, JSON.stringify(camp));

  console.log('scenario: all chapters build and run 120 s');
  for (let c = 0; c < 8; c++) {
    const r = await page.evaluate((c) => { OD.harness.start(c); OD.harness.step(120); const st = OD.harness.state(); return { errors: st.errors, finite: st.ships.every((s) => s.finite), n: st.ships.length }; }, c);
    check('chapter ' + (c + 1) + ' runs', r.errors.length === 0 && r.finite, JSON.stringify(r.errors));
  }

  console.log('scenario: beams — corvette duel at 250 km');
  await page.evaluate(() => OD.harness.start(OD.Skirmish.build({ player: 'JC', env: 'deep', range: 250, playerShips: { corvette: 2 }, enemyShips: { corvette: 2 }, seed: 9 })));
  const eng = await page.evaluate(() => ({ loaded: !!(OD.Engagement && OD.Engagement.update && OD.Engagement.render && OD.Engagement.shipReadout && OD.Engagement.physicsNotes) }));
  check('engagement module loaded', eng.loaded);
  await page.evaluate(() => {
    for (const s of OD.Game.sim.playerShips()) {
      const h = OD.Game.sim.nearestHostile(s);
      if (!h) continue;
      OD.Game.sim.setTarget(s.id, h.id);
      s.weaponsFree = true;
      OD.harness.order(s.id, { type: 'keeprange', target: h.id, range: 200e3 });
    }
  });
  for (let i = 0; i < 4; i++) { await page.evaluate(() => OD.harness.step(600)); }
  st = await page.evaluate(() => OD.harness.state());
  check('beam duel runs 2400 s without errors', st.errors.length === 0 && !st.renderError, st.errors.join(' | ') + (st.renderError || ''));
  check('all values finite', st.ships.every((s) => s.finite));
  check('beams put damage on a hull', st.ships.some((s) => s.hull < 1), st.ships.map((s) => s.name + ' hull ' + s.hull.toFixed(2) + (s.destroyed ? ' destroyed' : s.disabled ? ' disabled' : '')).join(', '));
  console.log('    duel after ' + st.time + ' s: outcome ' + st.outcome + ', ' + st.log.slice(-2).join(' / '));

  console.log('scenario: kinetics — destroyer against a lancer and a corvette at 400 km');
  await page.evaluate(() => OD.harness.start(OD.Skirmish.build({ player: 'JC', env: 'deep', range: 400, playerShips: { destroyer: 1 }, enemyShips: { lancer: 1, corvette: 1 }, seed: 11 })));
  const opened = await page.evaluate(() => {
    const sim = OD.Game.sim;
    let acts = [];
    for (const s of sim.playerShips()) {
      const h = sim.nearestHostile(s);
      if (!h) continue;
      sim.setTarget(s.id, h.id);
      s.weaponsFree = true;
      OD.harness.order(s.id, { type: 'keeprange', target: h.id, range: 350e3 });
      // the player's bays only empty on the panel's word: exercise that button
      acts = (OD.Engagement.panelActions(s) || []).map((a) => a.id);
      if (acts.includes('launch')) sim.engagementAction(s, 'launch');
    }
    return { acts, launched: sim.eng.stats.interceptorsLaunched };
  });
  check('panel offers Launch interceptors', opened.acts.includes('launch'), opened.acts.join(','));
  check('panel action empties the bays', opened.launched > 0, String(opened.launched));
  for (let i = 0; i < 4; i++) { await page.evaluate(() => OD.harness.step(600)); }
  st = await page.evaluate(() => OD.harness.state());
  const kin = await page.evaluate(() => ({ stats: OD.Game.sim.eng.stats, flying: OD.Game.sim.eng.slugs.length + OD.Game.sim.eng.interceptors.length, readout: OD.Engagement.shipReadout(OD.Game.sim.playerShips()[0] || OD.Game.sim.ships[0]).map((r) => r.label + ': ' + r.value), notes: OD.Engagement.physicsNotes(OD.Game.sim.ships[0], OD.Game.sim.byId(OD.Game.sim.ships[0].target)).map((n) => n.title) }));
  check('kinetics runs 2400 s without errors', st.errors.length === 0 && !st.renderError, st.errors.join(' | ') + (st.renderError || ''));
  check('all values finite', st.ships.every((s) => s.finite));
  check('coilguns fired slugs', kin.stats.slugsFired > 0, JSON.stringify(kin.stats));
  check('interceptors were launched', kin.stats.interceptorsLaunched > 0, JSON.stringify(kin.stats));
  check('slug flight-time note reaches the physics panel', kin.notes.some((t) => /slug/i.test(t)), kin.notes.join(' | '));
  check('kinetics decided something', st.outcome !== null || st.ships.some((s) => s.hull < 1), st.ships.map((s) => s.name + ' hull ' + s.hull.toFixed(2) + (s.destroyed ? ' destroyed' : s.disabled ? ' disabled' : '')).join(', '));
  console.log('    kinetics after ' + st.time + ' s: outcome ' + st.outcome + ', ' + JSON.stringify(kin.stats) + ', ' + kin.flying + ' still in flight');
  console.log('    readout: ' + kin.readout.join(' · '));

  console.log('scenario: v8 — threats, reach, fire control, point defence, damage report, sound, bridge');
  await page.evaluate(() => OD.harness.start(OD.Skirmish.build({ player: 'JC', env: 'deep', range: 300, playerShips: { destroyer: 1, corvette: 1 }, enemyShips: { lancer: 1, corvette: 1 }, seed: 21 })));
  const v8a = await page.evaluate(() => {
    const sim = OD.Game.sim, E = OD.Engagement, out = { api: {}, err: [] };
    for (const k of ['threats', 'threatSummary', 'reach', 'fireMode', 'setFireMode', 'aim', 'setAim', 'salvo', 'salvoEstimate', 'pdReport', 'events']) out.api[k] = !!(E && typeof E[k] === 'function');
    out.damage = !!(OD.Damage && OD.Damage.init && OD.Damage.hit && OD.Damage.report && OD.Damage.artState);
    out.sound = !!(OD.Sound && typeof OD.Sound.play === 'function' && typeof OD.Sound.watch === 'function');
    out.bridge = !!(OD.Bridge && typeof OD.Bridge.open === 'function' && typeof OD.Bridge.draw === 'function');
    const me = sim.playerShips().find((x) => x.cls === 'destroyer') || sim.playerShips()[0];
    const foe = sim.nearestHostile(me);
    out.me = me.id; out.foe = foe && foe.id;
    for (const p of sim.playerShips()) { const h = sim.nearestHostile(p); if (h) { sim.setTarget(p.id, h.id); p.weaponsFree = true; OD.harness.order(p.id, { type: 'keeprange', target: h.id, range: 250e3 }); } }
    for (const h of sim.hostiles(me)) { h.weaponsFree = true; }
    try { out.acts = (E.panelActions(me) || []).map((a) => a.id); } catch (e) { out.err.push('panelActions ' + e); }
    try { E.setFireMode(me, 'sustained'); out.mode = E.fireMode(me); E.setFireMode(me, 'full'); } catch (e) { out.err.push('fireMode ' + e); }
    try { E.setAim(me, 'mounts'); out.aim = E.aim(me); } catch (e) { out.err.push('aim ' + e); }
    try { out.reach = E.reach(sim, me, foe); } catch (e) { out.err.push('reach ' + e); }
    try { out.est = E.salvoEstimate(sim, me, foe, 2); } catch (e) { out.err.push('salvoEstimate ' + e); }
    try { out.pd = E.pdReport(me); } catch (e) { out.err.push('pdReport ' + e); }
    try { out.report = (OD.Damage.report(me) || []).map((r) => r.kind + ':' + r.state); } catch (e) { out.err.push('report ' + e); }
    try { sim.engagementAction(me, 'launch2'); out.launched = sim.eng.stats.interceptorsLaunched; } catch (e) { out.err.push('launch2 ' + e); }
    OD.harness.step(45);
    try { out.threats = E.threats(sim); out.summary = E.threatSummary(sim, foe); out.mySummary = E.threatSummary(sim, me); } catch (e) { out.err.push('threats ' + e); }
    try { out.events = sim.eng.events.length; out.eventSeq = sim.eng.eventSeq; out.eventKinds = Array.from(new Set(sim.eng.events.map((ev) => ev.kind))); } catch (e) { out.err.push('events ' + e); }
    OD.harness.select(me.id);
    OD.UI.refresh(sim, performance.now() + 5000);
    OD.Render.draw(sim, OD.Game.cam, OD.UI);
    out.renderError = OD.Render.lastError ? String(OD.Render.lastError) : null;
    out.dom = { fc: document.querySelectorAll('#pEng .fc-row:not([hidden])').length, modeBtns: document.querySelectorAll('[data-v="fcmodeseg"] button').length, aimBtns: document.querySelectorAll('[data-v="fcaimseg"] button').length, salvoBtns: document.querySelectorAll('[data-v="fcsalvobtns"] button').length, pdRow: !!document.querySelector('[data-v="pdrows"] .k'), dmgRows: document.querySelectorAll('.dmg-row').length, legend: document.querySelectorAll('#legend .lg-row').length };
    return out;
  });
  check('engagement v8 API present', Object.values(v8a.api).every(Boolean), JSON.stringify(v8a.api));
  check('damage module present', v8a.damage);
  // sound and bridge are optional modules: a stub file leaves OD.Sound / OD.Bridge undefined and the game runs without them
  const optional = (name, present) => { if (present) check(name + ' present', true); else console.log('  skip ' + name + ' not present (stub file)'); };
  optional('sound module', v8a.sound);
  optional('bridge module', v8a.bridge);
  check('no v8 API errors', v8a.err.length === 0 && !v8a.renderError, v8a.err.join(' | ') + (v8a.renderError || ''));
  check('fire mode and aim settable', v8a.mode === 'sustained' && v8a.aim === 'mounts', v8a.mode + ' ' + v8a.aim);
  check('reach gives point defence, launch and beam ranges', !!(v8a.reach && v8a.reach.pd > 0 && v8a.reach.beams && v8a.reach.their && v8a.reach.their.beams), JSON.stringify(v8a.reach));
  check('panel offers salvo sizes, fire modes and aim points', ['launch2', 'fire_full', 'fire_sustained', 'fire_hold', 'aim_hull', 'aim_radiators', 'aim_drive', 'aim_mounts', 'launch'].every((id) => (v8a.acts || []).includes(id)), (v8a.acts || []).join(','));
  check('salvo of two launched and visible as threats', v8a.launched >= 2 && Array.isArray(v8a.threats) && v8a.threats.some((t) => t.kind === 'interceptor' && t.eta != null), 'launched ' + v8a.launched + ' threats ' + (v8a.threats || []).length);
  check('threat summary reads the salvo', !!(v8a.summary && v8a.summary.incoming >= 1 && v8a.summary.level !== 'none' && v8a.summary.text), JSON.stringify(v8a.summary));
  check('events ring records the launch', v8a.eventSeq > 0 && (v8a.eventKinds || []).includes('launch'), JSON.stringify(v8a.eventKinds));
  check('damage report lists components', Array.isArray(v8a.report) && v8a.report.length >= 6 && v8a.report.some((r) => /drive/.test(r)) && v8a.report.some((r) => /tank/.test(r)), (v8a.report || []).join(','));
  check('panel shows fire control, point defence and damage rows', v8a.dom.fc >= 3 && v8a.dom.modeBtns === 3 && v8a.dom.aimBtns === 4 && v8a.dom.salvoBtns >= 1 && v8a.dom.pdRow && v8a.dom.dmgRows >= 6 && v8a.dom.legend >= 10, JSON.stringify(v8a.dom));
  for (let i = 0; i < 4; i++) { await page.evaluate(() => OD.harness.step(600)); }
  st = await page.evaluate(() => OD.harness.state());
  const v8b = await page.evaluate(() => {
    const sim = OD.Game.sim;
    const hurt = sim.ships.filter((x) => (OD.Damage.report(x) || []).some((r) => r.state !== 'ok'));
    const sample = hurt[0] ? OD.Damage.report(hurt[0]).filter((r) => r.state !== 'ok').map((r) => r.name + ' ' + r.state + (r.effect ? ' (' + r.effect + ')' : '')) : [];
    const kinds = Array.from(new Set(sim.eng.events.map((ev) => ev.kind)));
    return { hurt: hurt.map((x) => x.name), sample, kinds, stats: sim.eng.stats, pdKills: sim.eng.stats.pdKills, art: hurt[0] ? OD.Damage.artState(hurt[0]) : null };
  });
  check('v8 fight runs 2400 s without errors', st.errors.length === 0 && !st.renderError, st.errors.join(' | ') + (st.renderError || ''));
  check('specific components took damage', v8b.hurt.length > 0 && v8b.sample.length > 0, v8b.hurt.join(', ') + ' · ' + v8b.sample.slice(0, 3).join(' · '));
  check('damage feeds the ship art state', !!(v8b.art && v8b.art.damage && v8b.art.systems), JSON.stringify(v8b.art));
  check('events include hits or point-defence kills', v8b.kinds.some((k) => /hit|through|pdkill|component/.test(k)), v8b.kinds.join(','));
  console.log('    v8 fight after ' + st.time + ' s: outcome ' + st.outcome + ', ' + JSON.stringify(v8b.stats) + ' · ' + v8b.sample.slice(0, 4).join(' · '));

  console.log('scenario: sensors and decisions');
  await page.evaluate(() => OD.harness.start(1)); // chapter 2: Larkspur and a cold picket a thousand kilometres out
  const s11 = await page.evaluate(() => {
    const U = OD.U, sim = OD.Game.sim, S = OD.Sensors, D = OD.Decisions;
    const out = { err: [], sensors: !!(S && typeof S.track === 'function'), decisions: !!(D && typeof D.current === 'function') };
    if (!out.sensors) return out;
    const me = sim.byId('larkspur'), foe = sim.byId('sabre');
    try {
      OD.harness.step(90); // the initial sink drains; both ships settle to their coasting signature
      out.range = U.dist(me.pos, foe.pos);
      out.sigMe = S.signature(me); out.sigFoe = S.signature(foe);
      const tr = S.track(sim, me.faction, foe);
      out.q0 = tr.q; out.word0 = tr.word; out.posErr0 = tr.posErr; out.estOff = tr.est ? U.dist(tr.est.pos, foe.pos) : null;
      const pv = S.perceived(sim, me, foe); out.perceivedOff = U.dist(pv.pos, foe.pos);
      out.seen = S.seenFrom(sim, me); out.eta = S.solutionEta(sim, me, foe);
      out.report = S.report(sim, me); out.contacts = S.contacts(sim, me.faction).map((c) => c.ship.id + ':' + c.word);
      out.friendQ = S.quality(sim, me, sim.byId('hauler1'));
      // a burn is a solution from anywhere: their track on us
      out.qOnMeCold = S.quality(sim, foe, me);
      const burn = { throttle: me.throttle }; me.throttle = 1; out.sigBurn = S.signature(me); out.qOnMeBurn = S.quality(sim, foe, me); me.throttle = burn.throttle;
      // hot panels radiate
      const hot = { heat: me.heat }; me.heat = me.sinkCapacity * 0.8; out.sigHot = S.signature(me); me.heat = hot.heat;
      // active announces: q = 3 for the other side at once
      const ar = me.activeRange; me.activeRange = 2000e3; // inside reach for the test, whatever the class carries
      S.setActive(me, true); OD.harness.step(2); out.active = S.isActive(me); out.qOnMeActive = S.quality(sim, foe, me); out.qActive = S.quality(sim, me, foe); S.setActive(me, false); OD.harness.step(2); me.activeRange = ar;
      out.qAfterActive = S.quality(sim, me, foe);
      // panel rows and the map
      OD.harness.select('larkspur'); OD.Game.setTarget('sabre');
      OD.UI.refresh(sim, performance.now() + 5000); OD.Render.draw(sim, OD.Game.cam, OD.UI);
      const tx = (v) => { const el = document.querySelector('[data-v="' + v + '"]'); return el && !el.hidden ? el.textContent : null; };
      out.dom = { sig: tx('sig'), ttrack: tx('ttrack'), tsol: tx('tsol'), active: !!document.getElementById('pActive'), legend: document.querySelectorAll('#legend .lg-row').length, band: !!document.getElementById('decision') };
      out.view = OD.Render.viewOf ? OD.Render.viewOf(sim, foe) : null;
      out.renderError = OD.Render.lastError ? String(OD.Render.lastError) : null;
      out.log = sim.log.filter((l) => l.speaker === 'Sensors').map((l) => l.text).slice(0, 4);
    } catch (e) { out.err.push('sensors ' + (e.stack || e)); }
    return out;
  });
  if (!s11.sensors) console.log('  skip sensors module not present (stub file)');
  else {
    check('no sensor API errors', s11.err.length === 0 && !s11.renderError, s11.err.join(' | ') + (s11.renderError || ''));
    check('signature words: coasting warm or cold, burning, radiating', /^(cold|warm)$/.test(s11.sigMe.word) && s11.sigBurn.word === 'burning' && s11.sigHot.word === 'radiating', [s11.sigMe.word, s11.sigBurn.word, s11.sigHot.word].join(','));
    check('a cold coasting corvette at ~1 000 km is a contact', s11.q0 < 1.8 && s11.word0 === 'contact', 'q ' + (+s11.q0).toFixed(2) + ' ' + s11.word0 + ' at ' + Math.round(s11.range / 1000) + ' km, ' + (s11.sigFoe.word));
    check('the ghost sits off the truth by less than the stated uncertainty', s11.estOff != null && s11.estOff <= s11.posErr0 * 1.05 && s11.estOff > 0 && Math.abs(s11.perceivedOff - s11.estOff) < 1, 'off ' + Math.round(s11.estOff / 1000) + ' km, posErr ' + Math.round(s11.posErr0 / 1000) + ' km');
    check('a burn is a solution from anywhere; cold is not', s11.qOnMeBurn >= 2.7 && s11.qOnMeCold < 2.7, 'burn ' + (+s11.qOnMeBurn).toFixed(2) + ' cold ' + (+s11.qOnMeCold).toFixed(2));
    check('active announces us and resolves them', s11.active && s11.qOnMeActive >= 2.7 && s11.qActive >= 2.7 && s11.qAfterActive < 3, 'onMe ' + (+s11.qOnMeActive).toFixed(2) + ' ours ' + (+s11.qActive).toFixed(2) + ' after ' + (+s11.qAfterActive).toFixed(2));
    check('friends are always a solution', s11.friendQ >= 3, String(s11.friendQ));
    check('seenFrom and solutionEta are sensible', !!(s11.seen && s11.seen.solution > 0 && s11.seen.track >= s11.seen.solution && s11.seen.by) && (s11.eta == null || (isFinite(s11.eta) && s11.eta >= 0)), JSON.stringify(s11.seen) + ' eta ' + s11.eta);
    check('report rows and contacts', Array.isArray(s11.report) && s11.report.length >= 2 && s11.contacts.some((c) => /^sabre:/.test(c)), JSON.stringify(s11.report).slice(0, 120) + ' ' + s11.contacts.join(','));
    check('panel shows signature, track and solution rows', !!(s11.dom.sig && s11.dom.ttrack && s11.dom.tsol && s11.dom.active && s11.dom.legend >= 12 && s11.dom.band), JSON.stringify(s11.dom));
    check('the map draws the hostile as a ghost contact', !!(s11.view && s11.view.ghost && s11.view.word === 'contact'), JSON.stringify(s11.view && { q: s11.view.q, word: s11.view.word, ghost: s11.view.ghost }));
    check('sensor log lines for the player', s11.log.length >= 1, s11.log.join(' | '));
  }
  if (!s11.decisions) console.log('  skip decisions module not present (stub file)');
  else {
    const d11 = await page.evaluate(() => {
      const sim = OD.Game.sim, D = OD.Decisions;
      const out = { err: [], kinds: [], chosen: [], band: null };
      const seen = new Set();
      try {
        OD.harness.select('larkspur'); OD.Game.setTarget('sabre');
        const me = sim.byId('larkspur');
        let first = null;
        for (let i = 0; i < 60 && !sim.outcome; i++) {
          OD.harness.step(30);
          for (const d of sim.decisions || []) seen.add(d.kind);
          const cur = D.current(sim);
          OD.UI.refresh(sim, performance.now() + 5000 + i * 200);
          if (cur && !first) {
            first = { id: cur.id, kind: cur.kind, title: cur.title, text: cur.text, options: (cur.options || []).map((o) => o.key + ' ' + o.label + ' · ' + o.detail + (o.recommended ? ' [rec]' : '')), teach: !!cur.teach };
            const el = document.getElementById('decision');
            out.band = { hidden: !el || el.hidden, title: el && document.getElementById('dcTitle').textContent, opts: el ? el.querySelectorAll('#dcOpts .dc-opt').length : 0, rec: el ? el.querySelectorAll('#dcOpts .dc-opt.rec').length : 0, teach: el && !document.getElementById('dcTeach').hidden, warp: OD.Game.warp, hintBottom: document.getElementById('hint').style.bottom };
            const rec = (cur.options || []).find((o) => o.recommended) || cur.options[0];
            const took = OD.UI.decisionKey(rec.key);
            out.chosen.push(cur.kind + ' → ' + rec.label + ' (' + took + ')');
            out.afterChoice = { open: (sim.decisions || []).some((d) => d.id === cur.id), bandHidden: document.getElementById('decision').hidden, logged: sim.log.some((l) => /^Decision:/.test(l.text)) };
          } else if (cur && first && cur.id !== first.id && out.chosen.length < 3) {
            const rec = (cur.options || []).find((o) => o.recommended) || cur.options[0];
            OD.UI.decisionKey(rec.key); out.chosen.push(cur.kind + ' → ' + rec.label);
          }
          // walk in so the fight starts
          if (i === 2 && me.order.type === 'hold') OD.harness.order('larkspur', { type: 'keeprange', target: 'sabre', range: 200e3, vmax: 1500 });
        }
        out.first = first; out.kinds = Array.from(seen); out.time = sim.time; out.outcome = sim.outcome;
        out.hostileDecisions = (sim.decisions || []).filter((d) => { const s = sim.byId(d.shipId); return !s || s.faction !== sim.playerFaction; }).length;
      } catch (e) { out.err.push('decisions ' + (e.stack || e)); }
      out.errors = OD.errors.slice(); out.renderError = OD.Render.lastError ? String(OD.Render.lastError) : null;
      return out;
    });
    check('no decision errors', d11.err.length === 0 && d11.errors.length === 0 && !d11.renderError, d11.err.join(' | ') + d11.errors.join(' | ') + (d11.renderError || ''));
    check('at least three decision kinds raised in the fight', d11.kinds.length >= 3, d11.kinds.join(',') + ' after ' + Math.round(d11.time || 0) + ' s, outcome ' + d11.outcome);
    check('the first decision has options with numbers and a recommendation', !!(d11.first && d11.first.options.length >= 2 && d11.first.options.some((o) => /\[rec\]/.test(o)) && d11.first.teach), JSON.stringify(d11.first));
    check('the band renders with keys, a lit option and the teach paragraph, and warp drops', !!(d11.band && !d11.band.hidden && d11.band.opts >= 3 && d11.band.rec === 1 && d11.band.teach && d11.band.warp <= 1 && d11.band.hintBottom), JSON.stringify(d11.band));
    check('a chosen decision closes, acts and is logged', !!(d11.afterChoice && !d11.afterChoice.open && d11.afterChoice.bandHidden && d11.afterChoice.logged), JSON.stringify(d11.afterChoice) + ' ' + d11.chosen.join(' | '));
    check('no decision for a hostile ship', d11.hostileDecisions === 0, String(d11.hostileDecisions));
  }

  console.log('scenario: v13 — damage control and crew');
  {
    const has = await page.evaluate(() => !!(window.OD && OD.Crew && typeof OD.Crew.board === 'function'));
    if (!has) console.log('    (crew module not loaded: scenario skipped)');
    else {
      // A corvette of ours, alone, takes a hit on the drive: the routine sends a party, the mend lands at the cap.
      await page.evaluate(() => OD.harness.start(OD.Skirmish.build({ player: 'JC', env: 'deep', range: 900, playerShips: { corvette: 1 }, enemyShips: { corvette: 1 }, seed: 13 })));
      // park both hulls: the hostile holds fire and position, ours holds fire, so only the damage and the crew move
      await page.evaluate(() => { const sim = OD.Game.sim; for (const x of sim.ships) { x.weaponsFree = false; x.cmdThrottle = 0; x.order = { type: 'hold' }; if (!x.player) { x.ai = false; x.target = null; } } });
      const c0 = await page.evaluate(() => { const sim = OD.Game.sim, s = sim.ships.find((x) => x.player); OD.harness.select(s.id); const b = OD.Crew.board(s); return { total: b.crew.total, fit: b.crew.fit, parties: b.parties.map((p) => p.task), gMode: b.crew.gMode, words: b.words }; });
      check('a corvette carries 24 crew in two parties, on fire control and the sensor watch', c0.total === 24 && c0.parties.length === 2 && c0.parties.includes('fire') && c0.parties.includes('sensors'), JSON.stringify(c0));
      const c1 = await page.evaluate(() => { const sim = OD.Game.sim, s = sim.ships.find((x) => x.player); const d = s.components.find((c) => c.id === 'drive'); d.hp = 0.2; s._dmgRev = (s._dmgRev || 0) + 1; OD.Damage.aggregate(s); OD.harness.step(40); const b = OD.Crew.board(s); const p = b.parties.find((x) => x.task === 'repair'); return { drive: s.systems.drive, party: p ? { id: p.id, part: p.part, eta: Math.round(p.eta), progress: p.progress } : null, words: b.words, log: sim.log.filter((l) => l.speaker === 'Crew').map((l) => l.text).slice(-3) }; });
      check('the routine puts a party on the damaged drive inside 40 s', !!(c1.party && c1.party.part === 'drive'), JSON.stringify(c1));
      const c2 = await page.evaluate(() => { const sim = OD.Game.sim, s = sim.ships.find((x) => x.player); s.cmdThrottle = 0; for (let i = 0; i < 20; i++) OD.harness.step(60); const d = s.components.find((c) => c.id === 'drive'); const b = OD.Crew.board(s); return { hp: d.hp, drive: s.systems.drive, parties: b.parties.map((p) => p.task + (p.part ? ':' + p.part : '')), log: sim.log.filter((l) => l.speaker === 'Crew').map((l) => l.text).slice(-3) }; });
      check('the mend lands the drive at its jury-rig cap (0.7 from damaged) within 20 min', c2.hp >= 0.69 && c2.hp <= 0.71, JSON.stringify(c2));
      check('the party is back on its station afterwards', c2.parties.every((t) => !/^repair/.test(t)), JSON.stringify(c2.parties));
      // A hard burn: no limit, tanks near dry so the hull pulls past 3 g, and the crew is hurt.
      const c3 = await page.evaluate(() => { const sim = OD.Game.sim, s = sim.ships.find((x) => x.player); s.propMass = s.fullPropMass * 0.05; s.thrust *= 1.5; const d = s.components.find((c) => c.id === 'drive'); d.hp = 1; s._dmgRev = (s._dmgRev || 0) + 1; OD.Damage.aggregate(s); OD.Crew.setG(s, 'max'); s.order = { type: 'manual', throttle: 1, heading: s.heading }; s.cmdThrottle = 1; s.cmdHeading = s.heading; const w0 = s.crew.wounded; OD.harness.step(60); const b = OD.Crew.board(s); return { g: +b.crew.gNow.toFixed(2), wounded: s.crew.wounded - w0, words: b.gWords, accel: +s.accel().toFixed(2) }; });
      check('a near-dry corvette with half again the thrust, at no limit, pulls near 5 g and the crew is injured', c3.g > 3 && c3.wounded > 0, JSON.stringify(c3));
      const c4 = await page.evaluate(() => { const sim = OD.Game.sim, s = sim.ships.find((x) => x.player); OD.Crew.setG(s, 'work'); OD.harness.step(10); const b = OD.Crew.board(s); return { g: +b.crew.gNow.toFixed(2), accel: +s.accel().toFixed(2), cap: +(OD.Crew.accelCap(s) / 9.81).toFixed(2) }; });
      check('the Work limit holds the same hull to 1.2 g', c4.g <= 1.25 && c4.cap <= 1.25, JSON.stringify(c4));
      const st13 = await page.evaluate(() => OD.harness.state());
      check('no errors in the crew scenario', st13.errors.length === 0 && !st13.renderError, st13.errors.join(' | ') + (st13.renderError || ''));
    }
  }

  if (shot) {
    await page.evaluate(() => { OD.harness.start(0); OD.harness.select('larkspur'); OD.Game.setTarget('meridian'); OD.harness.order('larkspur', { type: 'intercept', target: 'meridian', range: 2000 }); OD.harness.step(400); OD.Game.cam.follow = 'larkspur'; OD.Game.cam.zoom = 1.2e-4; OD.Render.draw(OD.Game.sim, OD.Game.cam, OD.UI); OD.UI.refresh(OD.Game.sim, performance.now() + 5000); });
    await page.waitForTimeout(300);
    await page.screenshot({ path: shot });
    console.log('screenshot: ' + shot);
  }
  await browser.close();
  console.log(failures ? failures + ' check(s) failed' : 'all checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
