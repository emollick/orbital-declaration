/* Sensor and signature checks for Orbital Declaration (OD.Sensors).
   node tools/sensors-check.js   (needs Playwright + Chromium; NODE_PATH may need the global modules dir) */
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

  console.log('scenario: the module and the hull fits');
  const mod = await page.evaluate(() => ({
    present: !!(window.OD && OD.Sensors),
    missing: ['init', 'update', 'signature', 'track', 'quality', 'perceived', 'setActive', 'isActive', 'seenFrom', 'solutionEta', 'report', 'contacts'].filter((k) => !(OD.Sensors && typeof OD.Sensors[k] === 'function')),
    T: OD.Sensors && OD.Sensors.T,
    classes: Object.keys(OD.Ships.CLASSES).filter((k) => !OD.Ships.CLASSES[k].custom).map((k) => [k, OD.Ships.CLASSES[k].sensorRange, OD.Ships.CLASSES[k].activeRange]),
  }));
  check('OD.Sensors loaded with the whole interface', mod.present && mod.missing.length === 0, mod.missing.join(','));
  check('tuning carries the contract numbers', mod.T && mod.T.plumeFraction === 0.02 && mod.T.hullLeak === 0.5 && mod.T.activeHeat === 2e6 && mod.T.dwellBonus === 0.5 && mod.T.dwellTime === 600 && mod.T.solutionQ === 2.7 && mod.T.trackQ === 1.8 && mod.T.ghostDrift > 0 && mod.T.decay === 0.6, JSON.stringify(mod.T));
  const want = { corvette: [250e3, 800e3], frigate: [300e3, 1000e3], destroyer: [350e3, 1500e3], cruiser: [450e3, 2000e3], lancer: [300e3, 1200e3], freighter: [120e3, 0], station: [500e3, 2500e3] };
  const bad = mod.classes.filter(([k, s, a]) => !want[k] || want[k][0] !== s || want[k][1] !== a);
  check('every stock hull carries sensorRange and activeRange', bad.length === 0, JSON.stringify(bad));

  const custom = await page.evaluate(() => {
    const C = OD.Configurator;
    const d = C.derive(C.presetParams('destroyer'), 'check_custom');
    C.register(d);
    const ship = OD.Sim.makeShip({ cls: 'check_custom', faction: 'JC', pos: { x: 0, y: 0 } });
    const out = { base: d.base, sensorRange: ship.sensorRange, activeRange: ship.activeRange, activeSensor: ship.activeSensor };
    C.unregister('check_custom');
    return out;
  });
  check('a custom design inherits the sensor fit from its base hull', custom.base === 'destroyer' && custom.sensorRange === 350e3 && custom.activeRange === 1500e3 && custom.activeSensor === false, JSON.stringify(custom));

  console.log('scenario: story chapter 3 — Radiator Weather');
  await page.evaluate(() => OD.harness.start(2));
  const story = await page.evaluate(() => {
    const sim = OD.Game.sim, S = OD.Sensors;
    const me = sim.byId('larkspur'), foe = sim.byId('isa1');
    sim.setTarget(me.id, foe.id);
    S.update(sim, 0);
    const tr = S.track(sim, me, foe);
    const own = S.track(sim, 'JC', sim.byId('anselm'));
    return {
      tables: Object.keys(sim.sensors.factions).sort(),
      q: tr.q, word: tr.word, source: tr.source, range: tr.range, posErr: tr.posErr, velErr: tr.velErr,
      finite: [tr.q, tr.posErr, tr.velErr, tr.est.pos.x, tr.est.pos.y, tr.est.vel.x, tr.est.vel.y].every(isFinite),
      friendly: { q: own.q, source: own.source },
      rows: S.report(sim, me).map((r) => r.label + ': ' + r.value),
      labels: S.report(sim, me).map((r) => r.label),
      contacts: S.contacts(sim, 'JC').map((c) => c.ship.name + ' ' + c.word + ' q' + c.q.toFixed(2)),
      seen: S.seenFrom(sim, me),
      eta: S.solutionEta(sim, me, foe),
    };
  });
  check('per-faction track tables exist', story.tables.join(',') === 'ISA,JC', story.tables.join(','));
  check('a hostile track reads q, a word and an error box', story.finite && story.q >= 1 && story.q <= 3 && ['contact', 'track', 'solution'].includes(story.word), JSON.stringify({ q: story.q, word: story.word, posErr: Math.round(story.posErr / 1e3) + ' km' }));
  check('velErr is posErr over 120 s', Math.abs(story.velErr - story.posErr / 120) < 1e-6);
  check('a friendly hull is a solution by transponder', story.friendly.q === 3 && story.friendly.source === 'friendly', JSON.stringify(story.friendly));
  check('report() gives panel rows', story.labels.includes('Signature') && story.labels.includes('Seen from') && story.labels.includes('Our sensor') && story.labels.includes('Track') && story.labels.includes('Solution in'), story.labels.join(','));
  check('contacts() lists the hostiles', story.contacts.length >= 2 && story.contacts.join(' ').includes('ISV'), story.contacts.join(' · '));
  check('seenFrom() answers with finite ranges and a name', isFinite(story.seen.solution) && isFinite(story.seen.track) && story.seen.solution > 0 && story.seen.track > story.seen.solution && !!story.seen.by, JSON.stringify({ solution: Math.round(story.seen.solution / 1e3) + ' km', track: Math.round(story.seen.track / 1e3) + ' km', by: story.seen.by, word: story.seen.word }));
  check('solutionEta() is a finite number of seconds or null', story.eta === null || (isFinite(story.eta) && story.eta >= 0), String(story.eta));
  console.log('    ' + story.rows.join(' · '));

  const logs = await page.evaluate(() => {
    const sim = OD.Game.sim;
    for (const p of sim.playerShips()) { const h = sim.nearestHostile(p); if (h) { sim.setTarget(p.id, h.id); p.weaponsFree = true; OD.harness.order(p.id, { type: 'keeprange', target: h.id, range: 300e3 }); } }
    OD.harness.step(1200);
    const lines = sim.log.filter((l) => l.speaker === 'Sensors').map((l) => l.text);
    return {
      lines,
      contact: lines.filter((t) => /(?:^Contact| has a contact) bearing /.test(t)).length,
      track: lines.filter((t) => /^Track: /.test(t)).length,
      solution: lines.filter((t) => /^Solution on /.test(t)).length,
      lost: lines.filter((t) => /lost/i.test(t)).length,
      errors: OD.errors.slice(), finite: sim.ships.every((s) => [s.pos.x, s.vel.x, s.heat].every(isFinite)),
    };
  });
  check('the chapter runs 1200 s without errors', logs.errors.length === 0 && logs.finite, logs.errors.join(' | '));
  check('sensor log lines reach the player', logs.contact + logs.track + logs.solution > 0, 'contact ' + logs.contact + ' track ' + logs.track + ' solution ' + logs.solution + ' lost ' + logs.lost);
  console.log('    ' + logs.lines.slice(0, 4).join(' / '));

  console.log('scenario: signature words — cold, burning, radiating');
  await page.evaluate(() => OD.harness.start(OD.Skirmish.build({ player: 'JC', env: 'deep', range: 1000, playerShips: { frigate: 1 }, enemyShips: { corvette: 1 }, seed: 3 })));
  const sig = await page.evaluate(() => {
    const sim = OD.Game.sim, S = OD.Sensors;
    const foe = sim.hostiles(sim.playerShips()[0])[0];
    const cold = () => { foe.radiators.deployed = false; foe.radiators.state = 0; foe.throttle = 0; foe.heat = 0; };
    cold();
    const a = S.signature(foe);
    foe.throttle = 1;
    const b = S.signature(foe);
    foe.throttle = 0; foe.radiators.deployed = true; foe.radiators.state = 1; foe.heat = foe.sinkCapacity * 0.95;
    const c = S.signature(foe);
    cold(); S.setActive(foe, true);
    const d = S.signature(foe);
    S.setActive(foe, false);
    const freighter = OD.Sim.makeShip({ cls: 'freighter', faction: 'CIV', pos: { x: 0, y: 0 } });
    const noActive = S.setActive(freighter, true);
    return { cold: a, burning: b, radiating: c, active: d, idleHeat: foe.idleHeat, noActive, freighterFlag: freighter.activeSensor };
  });
  check('a cold coasting corvette reads cold at the hull floor', sig.cold.word === 'cold' && Math.abs(sig.cold.total - sig.idleHeat * 0.5) < 1 && sig.cold.total === sig.cold.hull, JSON.stringify(sig.cold));
  check('a burning corvette reads burning, in gigawatts', sig.burning.word === 'burning' && sig.burning.plume > 1e9 && sig.burning.total > sig.cold.total * 1000, sig.burning.word + ' ' + (sig.burning.plume / 1e9).toFixed(1) + ' GW');
  check('a hull with a nearly full sink and its panels out reads radiating, in tens of megawatts', sig.radiating.word === 'radiating' && sig.radiating.radiators > 20e6 && sig.radiating.radiators < 500e6, sig.radiating.word + ' ' + (sig.radiating.radiators / 1e6).toFixed(1) + ' MW');
  check('an active sensor shows in the signature', sig.active.word === 'active' && sig.active.active === true, JSON.stringify(sig.active.word));
  check('a hull with no active set cannot light one', sig.noActive === false && sig.freighterFlag === false);

  // The radiator temperature law: a panel is only as hot as the sink behind it (290 K empty, its ceiling full),
  // so what it sheds runs continuously from a fraction of a per cent of the rating to the whole of it, and the
  // signature reads that number straight off with no clamp and no cliff at the first joule.
  const rad = await page.evaluate(() => {
    const sim = OD.Game.sim, S = OD.Sensors, P = OD.P;
    const foe = sim.hostiles(sim.playerShips()[0])[0];
    foe.radiators.deployed = true; foe.radiators.state = 1; foe.throttle = 0; foe.extraHeat = 0;
    const rating = foe.radiatorRating();
    const at = (load) => { foe.heat = foe.sinkCapacity * load; return { shed: foe.radiatorPower(), sig: S.signature(foe).radiators, word: S.signature(foe).word }; };
    const empty = at(0), sliver = at(1 / foe.sinkCapacity), mid = at(0.5), full = at(1);
    const curve = [0, 0.2, 0.4, 0.6, 0.8, 1].map((l) => at(l).shed);
    const reads = [empty, sliver, mid, full].every((x) => Math.abs(x.sig - x.shed) < 1);
    foe.heat = 0; foe.radiators.deployed = false; foe.radiators.state = 0;
    const stowed = foe.radiatorPower();
    foe.radiators.deployed = true; foe.radiators.state = 1;
    // the equilibrium: left alone with its panels out a hull settles where they shed exactly what it makes
    const settle = P.sinkForecast(0, foe.sinkCapacity, rating, foe.idleHeat, 3600).settle;
    foe.heat = foe.sinkCapacity * settle;
    const atSettle = foe.radiatorPower();
    foe.heat = 0; foe.radiators.deployed = false; foe.radiators.state = 0;
    return { rating, empty, sliver, mid, full, curve, reads, stowed, settle, atSettle, idleHeat: foe.idleHeat, T0: P.sinkTemperature(0), T1: P.sinkTemperature(1) };
  });
  check('panels on an empty sink shed a small fraction of the rating', rad.empty.shed > 0 && rad.empty.shed < rad.rating * 0.02, (rad.empty.shed / 1e6).toFixed(2) + ' MW of ' + (rad.rating / 1e6).toFixed(1) + ' MW at ' + rad.T0 + ' K');
  check('panels on a full sink shed exactly the rating', Math.abs(rad.full.shed - rad.rating) < 1, (rad.full.shed / 1e6).toFixed(2) + ' MW at ' + rad.T1 + ' K');
  check('cooling is continuous in the load: no cliff at the first joule', Math.abs(rad.sliver.shed - rad.empty.shed) < rad.rating * 1e-6 && rad.curve.every((v, i) => i === 0 || v >= rad.curve[i - 1] - 1) && rad.curve.every((v, i) => i === 0 || v - rad.curve[i - 1] < rad.rating * 0.7), rad.curve.map((v) => (v / 1e6).toFixed(1)).join(' → ') + ' MW');
  check('the signature reads the panels straight off radiatorPower(), with no clamp', rad.reads && rad.stowed === 0, 'empty ' + (rad.empty.sig / 1e6).toFixed(2) + ' MW · half ' + (rad.mid.sig / 1e6).toFixed(1) + ' MW · full ' + (rad.full.sig / 1e6).toFixed(1) + ' MW · stowed ' + rad.stowed);
  check('and a hull left alone settles where the panels shed its idle heat', rad.settle > 0.1 && rad.settle < 0.6 && Math.abs(rad.atSettle - rad.idleHeat) < rad.idleHeat * 0.02, 'settles at ' + Math.round(rad.settle * 100) + ' % shedding ' + (rad.atSettle / 1e6).toFixed(2) + ' MW of ' + (rad.idleHeat / 1e6).toFixed(1) + ' MW idle');

  console.log('scenario: quality against range, dwell and the active sensor');
  const q = await page.evaluate(() => {
    const sim = OD.Game.sim, S = OD.Sensors;
    const me = sim.playerShips()[0], foe = sim.hostiles(me)[0];
    const cold = (s) => { s.radiators.deployed = false; s.radiators.state = 0; s.throttle = 0; s.heat = 0; s.vel.x = 0; s.vel.y = 0; };
    cold(me); cold(foe);
    me.pos.x = 0; me.pos.y = 0;
    // S.init is the clean slate: no dwell and nothing carried over from the last position, so each
    // reading is the fix this geometry gives rather than a track being reckoned down from the one before.
    const at = (km) => { foe.pos.x = km * 1e3; foe.pos.y = 0; S.init(sim); const t = S.track(sim, me, foe); return { q: t.q, word: t.word, posErr: t.posErr, dwell: t.dwell }; };
    const near = at(200), mid = at(600), far = at(1000), veryFar = at(3000);
    // dwell: hold the 600 km track for ten minutes and the faction reads it better
    at(600);
    const before = S.track(sim, me, foe).q;
    S.update(sim, 600);
    const after = S.track(sim, me, foe).q;
    // the corvette lights its own active sensor: everyone is handed a solution
    const dark = at(3000).q;
    S.setActive(foe, true); S.update(sim, 0);
    const litTr = S.track(sim, me, foe), lit = litTr.q, litSource = litTr.source;
    S.setActive(foe, false); S.update(sim, 0);
    // our own active sensor inside its range pins the target
    const ours = (() => { S.setActive(me, true); foe.pos.x = 700e3; S.update(sim, 0); const v = S.track(sim, me, foe); S.setActive(me, false); return { q: v.q, source: v.source }; })();
    S.update(sim, 0);
    return { near, mid, far, veryFar, before, after, dark, lit, litSource, ours, sensorRange: me.sensorRange, activeRange: me.activeRange };
  });
  check('q falls with range', q.near.q > q.mid.q && q.mid.q > q.far.q && q.far.q > q.veryFar.q, [q.near, q.mid, q.far, q.veryFar].map((x) => x.q.toFixed(2)).join(' > '));
  check('a cold coasting corvette at 1 000 km is a contact to a frigate', q.far.q < 1.8 && q.far.word === 'contact', 'q ' + q.far.q.toFixed(2) + ' ' + q.far.word);
  check('a corvette at 200 km is a solution to the same frigate', q.near.q >= 2.7 && q.near.word === 'solution', 'q ' + q.near.q.toFixed(2) + ' ' + q.near.word);
  check('q rises with dwell, by the dwell bonus at most', q.after > q.before && q.after - q.before <= 0.5 + 1e-9, q.before.toFixed(2) + ' → ' + q.after.toFixed(2));
  check('the error box shrinks as q rises', q.near.posErr < q.far.posErr && q.veryFar.posErr > q.far.posErr, [q.near, q.far, q.veryFar].map((x) => Math.round(x.posErr / 1e3) + ' km').join(' / '));
  check('a hostile going active gives everyone q = 3 on it', q.dark < 2.7 && q.lit === 3 && q.litSource === 'active', 'dark ' + q.dark.toFixed(2) + ' lit ' + q.lit + ' (' + q.litSource + ')');
  check('our own active sensor pins a target inside its range', q.ours.q === 3 && q.ours.source === 'active', JSON.stringify(q.ours));

  console.log('scenario: the ghost, perceived targets and the log');
  const ghost = await page.evaluate(() => {
    const sim = OD.Game.sim, S = OD.Sensors;
    const me = sim.playerShips()[0], foe = sim.hostiles(me)[0];
    foe.pos.x = 900e3; foe.pos.y = 0;
    S.init(sim);                       // a fix at 900 km, not a solution reckoned down from 700
    const tr = S.track(sim, me, foe);
    const snap = { q: tr.q, posErr: tr.posErr, velErr: tr.velErr };
    const p = S.perceived(sim, me, foe);
    const a = { x: p.pos.x, y: p.pos.y };
    const off = Math.hypot(a.x - foe.pos.x, a.y - foe.pos.y);
    const velOff = Math.hypot(p.vel.x - foe.vel.x, p.vel.y - foe.vel.y);
    // the ghost drifts smoothly: a substep barely moves it, a minute plainly does
    sim.time += 0.5; S.update(sim, 0.5);
    const b = { x: p.pos.x, y: p.pos.y };
    for (let i = 0; i < 120; i++) { sim.time += 0.5; S.update(sim, 0.5); }
    const c = { x: p.pos.x, y: p.pos.y };
    const stepMove = Math.hypot(b.x - a.x, b.y - a.y), minuteMove = Math.hypot(c.x - a.x, c.y - a.y);
    // above the solution threshold perceived() hands back the truth itself
    foe.pos.x = 150e3; S.update(sim, 0);
    const close = S.track(sim, me, foe);
    const closeQ = close.q;
    const truth = S.perceived(sim, me, foe);
    const friend = S.perceived(sim, me, me);
    return { snap, off, velOff, stepMove, minuteMove, closeQ, truthIsTruth: truth.pos === foe.pos && truth.vel === foe.vel, friendIsTruth: friend.pos === me.pos };
  });
  check('below a solution perceived() hands back the ghost, inside the error box', ghost.snap.q < 2.7 && ghost.off > 0 && ghost.off <= ghost.snap.posErr, 'off ' + Math.round(ghost.off / 1e3) + ' km of ' + Math.round(ghost.snap.posErr / 1e3) + ' km');
  check('the ghost velocity is off by no more than velErr', ghost.velOff > 0 && ghost.velOff <= ghost.snap.velErr + 1e-9, ghost.velOff.toFixed(2) + ' m/s of ' + ghost.snap.velErr.toFixed(2));
  check('the ghost drifts smoothly rather than jittering', ghost.stepMove < ghost.snap.posErr * 0.02 && ghost.minuteMove > ghost.stepMove, 'substep ' + Math.round(ghost.stepMove) + ' m, minute ' + Math.round(ghost.minuteMove) + ' m');
  check('above a solution perceived() hands back the truth', ghost.closeQ >= 2.7 && ghost.truthIsTruth);
  check('a friendly is always exact', ghost.friendIsTruth);

  // Closing on a cold hull: contact, then track, then solution, in the log; and the other way round.
  const words = await page.evaluate(() => {
    const sim = OD.Game.sim, S = OD.Sensors;
    const me = sim.playerShips()[0], foe = sim.hostiles(me)[0];
    const put = (km) => { foe.pos.x = km * 1e3; foe.pos.y = 0; sim.time += 30; S.update(sim, 30); };
    foe.pos.x = 8000e3; foe.pos.y = 0;
    S.init(sim);                       // a clean slate: no dwell, no track, nothing heard yet
    sim.log.length = 0;
    const seq = [];
    for (const km of [8000, 4000, 2400, 1400, 1000, 800, 600, 400, 300, 200, 150]) {
      put(km);
      const tr = S.track(sim, me, foe);
      seq.push(km + 'km q' + tr.q.toFixed(2) + ' ' + tr.word);
    }
    const closing = sim.log.filter((l) => l.speaker === 'Sensors').map((l) => l.text);
    for (const km of [600, 700, 850, 1000, 1100]) put(km);
    for (let i = 0; i < 14; i++) put(2000);
    const all = sim.log.filter((l) => l.speaker === 'Sensors');
    return { seq, closing, all: all.map((l) => l.text), kinds: all.map((l) => l.kind) };
  });
  check('closing turns a contact into a track and then a solution', /(?:^Contact| has a contact) bearing /.test(words.closing[0] || '') && words.closing.some((t) => /^Track: /.test(t)) && words.closing.some((t) => /^Solution on /.test(t)), words.closing.join(' / '));
  check('opening the range loses the solution, the track and the contact', words.all.some((t) => /Solution lost/.test(t)) && words.all.some((t) => /Track lost/.test(t)) && /Contact lost/.test(words.all[words.all.length - 1] || ''), words.all.slice(-3).join(' / '));
  check('every sensor line is an info line', words.kinds.length >= 6 && words.kinds.every((k) => k === 'info'), words.kinds.join(','));
  console.log('    ' + words.seq.join(' · '));

  // The log may not know more than the plot does. At contact quality the line is the ghost's range from the ear
  // that holds her, to two figures with the error box on it, and a bearing to five degrees — never the true
  // range to the metre (it used to read 'Contact at 990 km' off the truth with a 329 km error box in hand).
  const bare = await page.evaluate(() => {
    const sim = OD.Game.sim, S = OD.Sensors, U = OD.U;
    const me = sim.playerShips()[0], foe = sim.hostiles(me)[0];
    me.pos.x = 0; me.pos.y = 0; me.vel.x = 0; me.vel.y = 0;
    const R = 937.4e3, los = 1.2;                    // a range no rounding can land on by accident
    foe.pos.x = Math.cos(los) * R; foe.pos.y = Math.sin(los) * R; foe.vel.x = 0; foe.vel.y = 0;
    foe.throttle = 0; foe.radiators.deployed = false; foe.radiators.state = 0; foe.heat = 0;
    sim.log.length = 0; S.init(sim);       // the clean slate throws the first line of the new plot
    const tr = S.track(sim, me, foe);
    const by = tr.by || tr.pby;
    const rel = U.sub(tr.est.pos, by.pos);
    const line = (sim.log.filter((l) => l.speaker === 'Sensors').map((l) => l.text)[0]) || '';
    return { line, q: tr.q, word: tr.word, truth: tr.range, ghost: U.len(rel), err: tr.rangeErr, los: U.angleOf(rel) };
  });
  const two = (v) => { const m = Math.pow(10, Math.floor(Math.log10(Math.abs(v))) - 1); return Math.round(v / m) * m; };
  const km = (t) => parseFloat(String(t).replace(/\u2009/g, '')) * 1e3;
  const bareM = /(?:^Contact| has a contact) bearing (\d+)°, range ([\d\u2009.]+) km ±([\d\u2009.]+) km\. Class unknown\.$/.exec(bare.line);
  check('a bare contact is logged with its error box, not to the metre', !!bareM && bare.q < 1.8 && Math.abs(km(bareM[3]) - two(bare.err)) < 1 && bare.err > 10e3, bare.line);
  check('and the range it quotes is the ghost to two figures, never the truth', !!bareM && Math.abs(km(bareM[2]) - two(bare.ghost)) < 1 && Math.abs(km(bareM[2]) - bare.truth) > 1, 'says ' + (bareM ? bareM[2] : '—') + ' km, ghost ' + Math.round(bare.ghost / 1e3) + ' km, truth ' + (bare.truth / 1e3).toFixed(1) + ' km');
  check('and the bearing is rounded to five degrees', !!bareM && Number(bareM[1]) % 5 === 0 && Math.abs(Number(bareM[1]) - (bare.los * 180) / Math.PI) <= 5, bareM ? bareM[1] + '° for ' + ((bare.los * 180) / Math.PI).toFixed(1) + '°' : '—');

  const eta = await page.evaluate(() => {
    const sim = OD.Game.sim, S = OD.Sensors;
    const me = sim.playerShips()[0], foe = sim.hostiles(me)[0];
    foe.pos.x = 1200e3; foe.pos.y = 0; foe.vel.x = 0; foe.vel.y = 0; me.vel.x = 0; me.vel.y = 0;
    S.update(sim, 0);
    const standing = S.solutionEta(sim, me, foe);
    foe.vel.x = -900;                       // closing at 900 m/s
    S.update(sim, 0);
    const closing = S.solutionEta(sim, me, foe);
    foe.pos.x = 150e3; S.update(sim, 0);
    const held = S.solutionEta(sim, me, foe);
    const seenCold = S.seenFrom(sim, foe);
    foe.throttle = 1; S.update(sim, 0);
    const seenHot = S.seenFrom(sim, foe);
    foe.throttle = 0;
    return { standing, closing, held, seenCold, seenHot };
  });
  check('a standing contact too far out never resolves', eta.standing === null, String(eta.standing));
  check('a closing contact resolves in a sensible number of seconds', isFinite(eta.closing) && eta.closing > 0 && eta.closing < 3600, Math.round(eta.closing) + ' s');
  check('a solution already held reads zero', eta.held === 0, String(eta.held));
  check('a burning hull is seen from much farther than a cold one', eta.seenHot.solution > eta.seenCold.solution * 50 && eta.seenCold.word === 'cold' && eta.seenHot.word === 'burning', Math.round(eta.seenCold.solution / 1e3) + ' km cold → ' + Math.round(eta.seenHot.solution / 1e3) + ' km burning');

  console.log('scenario: seenFrom answers the question track() answers');
  await page.evaluate(() => OD.harness.start(OD.Skirmish.build({ player: 'JC', env: 'deep', range: 1000, playerShips: { corvette: 1 }, enemyShips: { corvette: 1 }, seed: 29 })));
  // Their q is the range term plus the dwell bonus they have already earned on us, so the range at which they
  // solve us has to be solved for T.solutionQ minus that bonus. It used to be solved on range alone, which had
  // the panel saying 'a contact to them until 628 km' in the same frame as their live track on us read q 2.76,
  // word solution, at 713 km.
  const agree = await page.evaluate(() => {
    const sim = OD.Game.sim, S = OD.Sensors;
    const me = sim.playerShips()[0], foe = sim.hostiles(me)[0];
    const quiet = (x) => { x.ai = false; x.order = { type: 'hold' }; x.throttle = 0; x.cmdThrottle = 0; x.vel.x = 0; x.vel.y = 0; x.radiators.deployed = false; x.radiators.state = 0; x.radiators.auto = false; x.heat = 0; };
    for (const s2 of sim.ships) quiet(s2);
    me.radiators.deployed = true; me.radiators.state = 1; me.heat = me.sinkCapacity * 0.45;   // something to see
    foe.pos.x = 0; foe.pos.y = 0; me.pos.x = 700e3; me.pos.y = 0;
    S.init(sim);
    // their plot on us, made fresh at range R with this much dwell already on the clock
    const theirs = (R, dwell) => {
      me.pos.x = R; me.pos.y = 0;
      delete sim.sensors.factions.ISA[me.id];
      const tr = S.track(sim, 'ISA', me);
      tr.dwell = dwell;
      return S.track(sim, 'ISA', me);
    };
    // the range at which their track() first says solution, bisected
    const firstSolution = (dwell) => {
      let lo = 20e3, hi = 20000e3;
      for (let i = 0; i < 44; i++) { const m = (lo + hi) / 2; if (theirs(m, dwell).q >= S.T.solutionQ) lo = m; else hi = m; }
      return lo;
    };
    const out = [];
    for (const dwell of [0, 294, 600]) {
      const bisect = firstSolution(dwell);
      const inside = theirs(bisect * 0.98, dwell), seenIn = S.seenFrom(sim, me);     // just inside it
      const outside = theirs(bisect * 1.02, dwell), seenOut = S.seenFrom(sim, me);   // and just outside
      out.push({
        dwell, bisect, solution: seenIn.solution, by: seenIn.by,
        inside: { R: bisect * 0.98, q: inside.q, word: inside.word, solution: seenIn.solution },
        outside: { R: bisect * 1.02, q: outside.q, word: outside.word, solution: seenOut.solution },
      });
    }
    return { out };
  });
  for (const r of agree.out) {
    check('seenFrom is the range at which their track() first says solution (dwell ' + r.dwell + ' s)', Math.abs(r.solution - r.bisect) <= 0.02 * r.bisect && !!r.by, Math.round(r.solution / 1e3) + ' km against ' + Math.round(r.bisect / 1e3) + ' km');
    check('  and no frame says one thing on the track and another in the caption (dwell ' + r.dwell + ' s)', r.inside.word === 'solution' && r.inside.solution >= r.inside.R * 0.999 && r.outside.word !== 'solution' && r.outside.solution <= r.outside.R * 1.001, 'at ' + Math.round(r.inside.R / 1e3) + ' km q ' + r.inside.q.toFixed(2) + ' ' + r.inside.word + ', seen from ' + Math.round(r.inside.solution / 1e3) + ' km · at ' + Math.round(r.outside.R / 1e3) + ' km q ' + r.outside.q.toFixed(2) + ' ' + r.outside.word);
  }
  // And the same thing in the chapter the contradiction was caught in: nineteen minutes into chapter 2 no hull
  // may be a live passive solution to a hostile from farther out than its own 'seen as a solution from' says.
  const frames = await page.evaluate(() => {
    OD.harness.start(1);
    OD.harness.step(1200);
    const sim = OD.Game.sim, S = OD.Sensors, U = OD.U;
    const bad = [], held = [];
    for (const ship of sim.ships) {
      if (ship.destroyed) continue;
      const seen = S.seenFrom(sim, ship);
      for (const h of sim.ships) {
        if (h.destroyed || !sim.isHostile(h, ship)) continue;
        const tr = S.track(sim, h, ship);
        // the caption answers for what we are showing now, so the reading to hold it to is the live passive
        // one: a track being carried forward by dead reckoning is better than the sky currently supports, and
        // says so. A lit radar is announced by the word, not solved for.
        if (!tr || tr.source !== 'passive') continue;
        const R = U.dist(h.pos, ship.pos);
        // whoever holds a solution on her, carried or live, is inside what seenFrom().held reports
        if (tr.q >= S.T.solutionQ && seen.held < R * 0.999) held.push(ship.name + ' held by ' + h.name + ' at ' + Math.round(R / 1e3) + ' km, held ' + Math.round(seen.held / 1e3) + ' km');
        if (tr.passive < S.T.solutionQ) continue;
        if (seen.solution < R * 0.999) bad.push(ship.name + ' passive q ' + tr.passive.toFixed(2) + ' (carried ' + tr.q.toFixed(2) + ') to ' + h.name + ' at ' + Math.round(R / 1e3) + ' km, caption ' + Math.round(seen.solution / 1e3) + ' km');
      }
    }
    return { t: Math.round(sim.time), outcome: sim.outcome, bad, held, errors: OD.errors.slice() };
  });
  check('and nothing in chapter 2 is a live passive solution from beyond what its own caption claims', frames.bad.length === 0 && frames.errors.length === 0, 't ' + frames.t + ' s' + (frames.bad.length ? ': ' + frames.bad.join(' | ') : '') + (frames.errors.length ? ' errors ' + frames.errors.join(' | ') : ''));
  check('and a hostile carrying an old solution forward is inside seenFrom().held', frames.held.length === 0, frames.held.join(' | '));

  check('a watcher who has held us for ten minutes reads us from farther out', agree.out[2].solution > agree.out[0].solution * 1.2 && agree.out[1].solution > agree.out[0].solution, agree.out.map((r) => r.dwell + ' s → ' + Math.round(r.solution / 1e3) + ' km').join(' · '));

  console.log('scenario: the log gap, the nearest ear and a prize changing sides');
  await page.evaluate(() => OD.harness.start(OD.Skirmish.build({ player: 'JC', env: 'deep', range: 1400, playerShips: { frigate: 1, corvette: 1 }, enemyShips: { corvette: 1 }, seed: 11 })));
  const gap = await page.evaluate(() => {
    const sim = OD.Game.sim, S = OD.Sensors;
    const me = sim.playerShips()[0], foe = sim.hostiles(me)[0];
    const quiet = (x) => { x.ai = false; x.order = { type: 'hold' }; x.throttle = 0; x.cmdThrottle = 0; x.vel.x = 0; x.vel.y = 0; x.radiators.deployed = false; x.radiators.state = 0; x.radiators.auto = false; x.heat = 0; };
    for (const s2 of sim.ships) quiet(s2);
    me.pos.x = 0; me.pos.y = 0;
    const other = sim.playerShips()[1]; other.pos.x = 0; other.pos.y = 9000e3;
    const put = (km, dt) => { foe.pos.x = km * 1e3; foe.pos.y = 0; sim.time += dt; S.update(sim, dt); };
    foe.pos.x = 8000e3; foe.pos.y = 0;
    S.init(sim); sim.log.length = 0;
    const lines = () => sim.log.filter((l) => l.speaker === 'Sensors').map((l) => l.text);
    put(1000, 30); const first = lines();
    put(300, 30); const gated = lines();
    put(300, 30); const after = lines();
    return { first, gated, after, logGap: S.T.logGap, drop: S.T.solutionQ - S.T.hysteresis };
  });
  check('the solution holds until q falls to 2.4', Math.abs(gap.drop - 2.4) < 1e-9 && gap.logGap === 60, 'drops at q ' + gap.drop.toFixed(2) + ', one line per ' + gap.logGap + ' s');
  check('one line per target per 60 s, the first line included', gap.first.length === 1 && gap.gated.length === 1 && gap.after.length === 2, gap.after.join(' / '));

  const tie = await page.evaluate(() => {
    const sim = OD.Game.sim, S = OD.Sensors;
    const foe = sim.hostiles(sim.playerShips()[0])[0];
    const far = sim.playerShips()[0], near = sim.playerShips()[1];
    foe.pos.x = 0; foe.pos.y = 0;
    far.pos.x = 3000e3; far.pos.y = 0; near.pos.x = 1400e3; near.pos.y = 0;
    S.init(sim);
    const tr = S.track(sim, 'JC', foe);
    return { first: sim.ships[0].name, near: near.name, by: tr.byName, range: tr.range, q: tr.q, pby: tr.pby ? tr.pby.name : null };
  });
  check('beyond reach the reading is the nearest ear, not the first hull in the fleet', Math.abs(tie.q - 1) < 1e-9 && tie.by === tie.near && tie.pby === tie.near && Math.round(tie.range / 1e3) === 1400, 'by ' + tie.by + ' at ' + Math.round(tie.range / 1e3) + ' km (first in the list: ' + tie.first + ')');

  const prize = await page.evaluate(() => {
    const sim = OD.Game.sim, S = OD.Sensors;
    const foe = sim.hostiles(sim.playerShips()[0])[0];
    foe.pos.x = 200e3; foe.pos.y = 0;
    S.init(sim);
    const before = !!sim.sensors.factions.JC[foe.id];
    foe.captured = true; foe.faction = 'JC'; foe.disabled = true;
    S.update(sim, 0.5);
    const entry = sim.sensors.factions.JC[foe.id];
    return { before, gone: !entry, source: S.track(sim, 'JC', foe).source };
  });
  check('a prize leaves her old faction table on the next substep', prize.before && prize.gone && prize.source === 'friendly', JSON.stringify(prize));

  await page.evaluate(() => OD.harness.start(OD.Skirmish.build({ player: 'JC', env: 'deep', range: 1400, playerShips: { frigate: 1, corvette: 1 }, enemyShips: { corvette: 1 }, seed: 11 })));
  const warn = await page.evaluate(() => {
    const sim = OD.Game.sim;
    const fresh = () => { sim._contacted = {}; sim._contactT = -1e9; sim.log.length = 0; };
    const foe = sim.ships.find((x) => x.faction === 'ISA');
    const me = sim.playerShips()[0];
    for (const s2 of sim.ships) { s2.ai = false; s2.order = { type: 'hold' }; s2.throttle = 0; s2.cmdThrottle = 0; s2.vel.x = 0; s2.vel.y = 0; s2.radiators.deployed = false; s2.radiators.state = 0; s2.radiators.auto = false; s2.heat = 0; }
    me.pos.x = 0; me.pos.y = 0; sim.playerShips()[1].pos.x = 0; sim.playerShips()[1].pos.y = 9000e3;
    foe.pos.x = 1000e3; foe.pos.y = 0;   // cold at 1 000 km she is a bare contact (q about 1.3); at 1 400 km she is nothing
    fresh(); OD.Sensors.init(sim);       // init logs the contact the ladder starts on, so the log is cleared before it
    OD.harness.step(5);
    const bare = sim.log.filter((l) => l.speaker === 'Sensors' && /(has a contact bearing|^Track: |^Solution on )/.test(l.text)).map((l) => l.text);
    foe.pos.x = 200e3; foe.pos.y = 0;
    fresh(); OD.harness.step(65);        // the ladder waits logGap (60 s) between lines about one track
    const named = sim.log.filter((l) => l.speaker === 'Sensors' && /(has a contact bearing|^Track: |^Solution on )/.test(l.text)).map((l) => l.text);
    return { bare, named, name: foe.name, role: OD.Ships.CLASSES[foe.cls].role };
  });
  check('the warning keeps her class while she is a bare contact', warn.bare.length === 1 && /(?:^Contact| has a contact) bearing /.test(warn.bare[0]) && warn.bare[0].indexOf(warn.name) < 0 && warn.bare[0].indexOf(warn.role) < 0, warn.bare.join(' / '));
  check('and names her once the track resolves', warn.named.length >= 1 && warn.named[0].indexOf(warn.name) >= 0 && (/^Solution on /.test(warn.named[0]) || warn.named[0].indexOf(warn.role) >= 0), warn.named.join(' / '));
  // A bare contact is a bearing and a rough range with the error on it: no metres, no closing speed, no name.
  check('the bare-contact line gives a bearing to five degrees and a range to two figures', /bearing \d+°/.test(warn.bare[0] || '') && /±/.test(warn.bare[0] || '') && Number((/bearing (\d+)°/.exec(warn.bare[0] || '') || [0, 1])[1]) % 5 === 0, warn.bare[0]);
  // v12: no closing rate under solution quality either: a track's velocity error is hundreds of m/s
  check('and no exact metres and no closing speed on it, nor on the track line', !/\d\s*m(?![a-z\/])/.test(warn.bare[0] || '') && !/closing/.test(warn.bare[0] || '') && !/closing/.test(warn.named[0] || ''), warn.bare[0] + ' | ' + warn.named[0]);

  console.log('scenario: a track carried by dead reckoning');
  await page.evaluate(() => OD.harness.start(OD.Skirmish.build({ player: 'JC', env: 'deep', range: 1500, playerShips: { frigate: 1 }, enemyShips: { corvette: 1 }, seed: 17 })));
  const carry = await page.evaluate(() => {
    const sim = OD.Game.sim, S = OD.Sensors;
    const me = sim.playerShips()[0], foe = sim.hostiles(me)[0];
    const quiet = (x) => { x.ai = false; x.order = { type: 'hold' }; x.throttle = 0; x.cmdThrottle = 0; x.vel.x = 0; x.vel.y = 0; x.radiators.deployed = false; x.radiators.state = 0; x.radiators.auto = false; x.heat = 0; };
    for (const s2 of sim.ships) quiet(s2);
    me.pos.x = 0; me.pos.y = 0; foe.pos.x = 1500e3; foe.pos.y = 0;
    foe.throttle = 1;                 // gigawatts of plume: a solution from anywhere in the scenario
    S.init(sim);
    const read = () => S.track(sim, me, foe);
    const step = (dt) => { sim.time += dt; S.update(sim, dt); };
    const lit = read(), burning = { q: lit.q, word: lit.word };
    foe.throttle = 0;                 // the drive cuts, and the sky says contact from this second on
    S.update(sim, 0);
    const cut = read(), at0 = cut.q, measured = cut.measured;
    const trail = [];
    for (let i = 0; i < 8; i++) { step(30); const t = read(); trail.push({ t: (i + 1) * 30, q: t.q, word: t.word }); }
    const monotone = trail.every((r, i) => r.q <= (i ? trail[i - 1].q : at0) + 1e-9);
    foe.throttle = 1; S.update(sim, 0);   // and she lights it again
    const relit = read();
    return {
      burning, measured, at0, monotone, decay: S.T.decay,
      at30: trail[0].q, at60: trail[1].q, at120: trail[3].q, at240: trail[7].q, word240: trail[7].word,
      relit: relit.q, relitWord: relit.word,
      line: trail.map((r) => r.t + ' s q' + r.q.toFixed(2)).join(' · '),
    };
  });
  check('a burning hull at 1 500 km is a solution', carry.burning.q === 3 && carry.burning.word === 'solution' && carry.decay === 0.6, 'q ' + carry.burning.q.toFixed(2) + ' ' + carry.burning.word + ', decay ' + carry.decay + ' per 60 s');
  check('the drive cuts and the sky reads a contact at once', Math.abs(carry.measured - 1) < 0.01 && carry.at0 === 3, 'measured q ' + carry.measured.toFixed(2) + ', reported q ' + carry.at0.toFixed(2));
  check('but the plot carries her: q is still 2.4 or better after 60 s', carry.at60 >= 2.4 - 1e-9 && carry.at30 > carry.at60, 'q ' + carry.at30.toFixed(2) + ' at 30 s, q ' + carry.at60.toFixed(2) + ' at 60 s');
  check('a solution fades to a contact in about two minutes', Math.abs(carry.at120 - 1.8) < 0.05, 'q ' + carry.at120.toFixed(2) + ' at 120 s');
  check('and is down to a bare contact by 240 s', carry.at240 <= 1.9 && carry.word240 === 'contact', 'q ' + carry.at240.toFixed(2) + ' ' + carry.word240);
  check('the fade is gradual and never climbs on its own', carry.monotone && carry.at0 - carry.at60 <= carry.decay + 1e-9, 'lost ' + (carry.at0 - carry.at60).toFixed(2) + ' of q in the first 60 s, ceiling ' + carry.decay);
  check('and she is pinned again the moment the drive lights', carry.relit === 3 && carry.relitWord === 'solution', 'q ' + carry.relit.toFixed(2) + ' ' + carry.relitWord);
  console.log('    ' + carry.line);

  console.log('scenario: the computer lights its own sensor, and keeps its panels in under a beam');
  await page.evaluate(() => OD.harness.start(OD.Skirmish.build({ player: 'JC', env: 'deep', range: 600, playerShips: { frigate: 1, corvette: 1 }, enemyShips: { destroyer: 1 }, seed: 7 })));
  const ai = await page.evaluate(() => {
    const sim = OD.Game.sim, S = OD.Sensors;
    const foe = sim.ships.find((x) => x.faction === 'ISA');
    const bait = sim.playerShips().find((x) => x.cls === 'corvette');
    const flag = sim.playerShips().find((x) => x.cls === 'frigate');
    const cold = (x) => { x.radiators.deployed = false; x.radiators.state = 0; x.radiators.auto = false; x.heat = 0; x.throttle = 0; x.cmdThrottle = 0; x.vel.x = 0; x.vel.y = 0; };
    cold(bait); cold(flag);
    flag.pos.x = -6000e3; flag.pos.y = 0;            // the frigate stands well off
    bait.pos.x = 0; bait.pos.y = 0;                   // a cold corvette at the destroyer's doctrine range
    foe.pos.x = 600e3; foe.pos.y = 0; foe.vel.x = 0; foe.vel.y = 0; foe.heat = foe.sinkCapacity * 0.05;
    S.update(sim, 0);
    const before = { passive: S.track(sim, foe, bait).passive, lit: S.isActive(foe) };
    OD.harness.step(12);
    const lit = S.isActive(foe), q = S.track(sim, foe, bait).q;
    foe.extraHeat = 0; S.update(sim, 0);
    const heatRate = foe.extraHeat;
    const doctrine = OD.Ships.CLASSES[foe.cls].doctrine.range;
    const range = Math.hypot(foe.pos.x - bait.pos.x, foe.pos.y - bait.pos.y);
    return { before, lit, q, heatRate, doctrine, range, cls: foe.cls };
  });
  check('the computer holds no passive solution at doctrine range on a cold hull', ai.before.passive < 2.7 && ai.before.lit === false, 'passive q ' + ai.before.passive.toFixed(2) + ' at ' + Math.round(ai.range / 1e3) + ' km of ' + Math.round(ai.doctrine / 1e3) + ' km doctrine');
  check('the computer goes active to get its solution', ai.lit === true && ai.q === 3, 'active ' + ai.lit + ' q ' + ai.q.toFixed(2));
  check('an active sensor puts T.activeHeat into the sink every second', Math.abs(ai.heatRate - 2e6) < 1, ai.heatRate + ' W');

  const dark = await page.evaluate(() => {
    const sim = OD.Game.sim, S = OD.Sensors;
    const foe = sim.ships.find((x) => x.faction === 'ISA');
    const bait = sim.playerShips().find((x) => x.cls === 'corvette');
    // the corvette throws its radiators out: the passive track is a solution and nothing is in the destroyer's
    // face, so the destroyer stops shouting
    bait.radiators.deployed = true; bait.radiators.state = 1; bait.heat = bait.sinkCapacity * 0.5;
    OD.harness.step(12);
    return { lit: S.isActive(foe), passive: S.track(sim, foe, bait).passive };
  });
  check('and drops it once the passive track is a solution', dark.lit === false && dark.passive >= 2.7, 'active ' + dark.lit + ' passive q ' + dark.passive.toFixed(2));

  const rads = await page.evaluate(() => {
    const sim = OD.Game.sim;
    const foe = sim.ships.find((x) => x.faction === 'ISA');
    const flag = sim.playerShips().find((x) => x.cls === 'frigate');
    flag.pos.x = 480e3; flag.pos.y = 0; flag.vel.x = 0; flag.vel.y = 0;   // inside the destroyer's face
    flag.weaponsFree = true; sim.setTarget(flag.id, foe.id);
    foe.radiators.auto = true; foe.radiators.deployed = true; foe.radiators.state = 1; foe.heat = foe.sinkCapacity * 0.5;
    OD.harness.step(30);
    const w = OD.Engagement && OD.Engagement.reach ? OD.Engagement.reach(sim, foe, flag) : null;
    const stowed = !foe.radiators.deployed;
    foe.heat = foe.sinkCapacity * 0.95;
    OD.harness.step(6);
    return { stowed, outAgain: foe.radiators.deployed, theirs: w ? w.their.beams : null, facet: w ? w.their.facet : '' };
  });
  check('the computer keeps its radiators in under a beam that reaches it', rads.stowed, 'their beams ' + JSON.stringify(rads.theirs) + ' on our ' + rads.facet);
  check('and puts them out again once the sink is nearly full', rads.outAgain);

  console.log('scenario: the sink forecast and the heat balance of a warship');
  const heat = await page.evaluate(() => {
    const P = OD.P;
    const cap = 30e9, rating = 33.68e6;
    const filling = P.sinkForecast(cap * 0.1, cap, rating, 40e6, 3600);   // heat in above the rating: it fills
    const settling = P.sinkForecast(cap * 0.1, cap, rating, 20e6, 3600);  // below it: it settles
    const emptying = P.sinkForecast(0.9e9, 1e9, 200e6, 0, 3600);          // a big farm on a small sink
    const shape = { keys: Object.keys(filling).sort().join(','), loadAt: typeof filling.loadAt === 'function' };
    const shed = (load) => rating * Math.pow(P.sinkTemperature(load) / 1000, 4);
    const rise = [0, 300, 600, 900].map((t) => filling.loadAt(t));
    return {
      shape, filling: { tFull: filling.tFull, tEmpty: filling.tEmpty, settle: filling.settle },
      settling: { tFull: settling.tFull, tEmpty: settling.tEmpty, settle: settling.settle },
      emptying: { tFull: emptying.tFull, tEmpty: emptying.tEmpty, settle: emptying.settle },
      balance: Math.abs(shed(settling.settle) - 20e6), rise,
      end: settling.loadAt(3600), past: settling.loadAt(99999), start: settling.loadAt(0),
    };
  });
  check('sinkForecast answers with tFull, tEmpty, settle and loadAt', heat.shape.keys === 'horizon,loadAt,settle,tEmpty,tFull' && heat.shape.loadAt, heat.shape.keys);
  check('a sink fills when the heat in beats the rating', heat.filling.tFull > 0 && heat.filling.tFull < 3600 && heat.filling.tEmpty === null && heat.filling.settle === 1, 'full in ' + Math.round(heat.filling.tFull / 60) + ' min');
  check('and settles under it, where the panels shed what comes in', heat.settling.tFull === null && heat.settling.settle > 0.3 && heat.settling.settle < 0.95 && heat.balance < 20e6 * 0.01, 'settles at ' + Math.round(heat.settling.settle * 100) + ' %, shedding within ' + Math.round(heat.balance / 1e3) + ' kW of the heat in');
  check('loadAt walks the sink forward and holds past the horizon', heat.rise.every((v, i) => i === 0 || v > heat.rise[i - 1]) && Math.abs(heat.past - heat.end) < 1e-9 && Math.abs(heat.start - 0.1) < 1e-9, heat.rise.map((v) => Math.round(v * 100) + ' %').join(' → '));
  check('a big farm on a small sink empties it', heat.emptying.tEmpty > 0 && heat.emptying.tEmpty < 600 && heat.emptying.tFull === null, 'under 5 % in ' + heat.emptying.tEmpty + ' s');

  const balance = await page.evaluate(() => {
    const P = OD.P, C = OD.Ships.CLASSES;
    const warships = ['corvette', 'frigate', 'destroyer', 'cruiser', 'lancer'];
    return warships.map((id) => {
      const c = C[id];
      const beams = c.mounts.filter((m) => m.kind === 'beam').reduce((a, m) => a + m.power * (1 - m.efficiency), 0);
      const full = c.idleHeat + c.driveHeat + beams;
      const rating = P.radiatorPower(c.radiatorArea, c.radiatorTemp);
      const f = P.sinkForecast(c.sinkCapacity * 0.1, c.sinkCapacity, rating, full, 3600);
      const drive = P.sinkForecast(c.sinkCapacity * 0.1, c.sinkCapacity, rating, c.idleHeat + c.driveHeat, 3600);
      return { id, area: c.radiatorArea, rating, full, ratio: full / rating, tFull: f.tFull, driveSettle: drive.settle, driveFull: drive.tFull };
    });
  });
  const offBand = balance.filter((b) => !(b.ratio >= 1.15 && b.ratio <= 1.30));
  check('full fire beats what every warship can shed, by 15 to 30 % (the lancer is a missile boat: her drive is her heat)', offBand.filter((b) => b.id !== 'lancer').length === 0, balance.map((b) => b.id + ' ' + b.ratio.toFixed(2) + '×').join(' · '));
  check('so full fire with the drive lit fills the sink instead of being shrugged off', balance.every((b) => b.id === 'lancer' || (b.tFull > 0 && b.tFull < 2400)), balance.map((b) => b.id + ' ' + Math.round(b.tFull / 60) + ' min').join(' · '));
  check('while the drive alone runs a warship warm but never fills her sink (the knee)', balance.every((b) => b.driveSettle > 0.4 && b.driveSettle < 0.8), balance.map((b) => b.id + ' settles ' + Math.round(b.driveSettle * 100) + ' %').join(' · '));
  console.log('    ' + balance.map((b) => b.id + ': ' + b.area + ' m², ' + (b.rating / 1e6).toFixed(0) + ' MW rating vs ' + (b.full / 1e6).toFixed(0) + ' MW full fire').join(' · '));

  console.log('scenario: a bearing is precise, a range is not');
  await page.evaluate(() => OD.harness.start(OD.Skirmish.build({ player: 'JC', env: 'deep', range: 1000, playerShips: { frigate: 1 }, enemyShips: { corvette: 1 }, seed: 23 })));
  const aniso = await page.evaluate(() => {
    const sim = OD.Game.sim, S = OD.Sensors, U = OD.U;
    const me = sim.playerShips()[0], foe = sim.hostiles(me)[0];
    const quiet = (x) => { x.ai = false; x.order = { type: 'hold' }; x.throttle = 0; x.cmdThrottle = 0; x.vel.x = 0; x.vel.y = 0; x.radiators.deployed = false; x.radiators.state = 0; x.radiators.auto = false; x.heat = 0; };
    for (const s2 of sim.ships) quiet(s2);
    me.pos.x = 0; me.pos.y = 0;
    // a thousand kilometres out on a bearing of 30°, so the line of sight is nothing like an axis
    const los = Math.PI / 6, R = 1000e3;
    foe.pos.x = Math.cos(los) * R; foe.pos.y = Math.sin(los) * R;
    S.init(sim);
    const tr = S.track(sim, me, foe);
    const fix = { q: tr.q, word: tr.word, bearingErr: tr.bearingErr, rangeErr: tr.rangeErr, posErr: tr.posErr, los: tr.los, velErr: tr.velErr };
    // the ghost, sampled over a few minutes: along the line of sight and only a little across it
    let sa = 0, sc = 0, n = 0, worst = 0;
    for (let i = 0; i < 48; i++) {
      sim.time += 5; S.update(sim, 5);
      const t = S.track(sim, me, foe);
      const d = U.sub(t.est.pos, foe.pos), c = Math.cos(t.los), s = Math.sin(t.los);
      const along = d.x * c + d.y * s, across = -d.x * s + d.y * c;
      sa += along * along; sc += across * across; n++;
      worst = Math.max(worst, Math.abs(across) / Math.max(1, t.posErr));
    }
    return { fix, R, los, alongRms: Math.sqrt(sa / n), crossRms: Math.sqrt(sc / n), worst, cross: fix.bearingErr * R };
  });
  check('a contact at 1 000 km carries a bearing error under 2°', aniso.fix.q < 1.8 && aniso.fix.bearingErr > 0 && (aniso.fix.bearingErr * 180) / Math.PI < 2, ((aniso.fix.bearingErr * 180) / Math.PI).toFixed(2) + '° (' + Math.round(aniso.cross / 1e3) + ' km across)');
  check('and a range error of hundreds of kilometres', aniso.fix.rangeErr > 100e3 && aniso.fix.rangeErr < 1000e3 && Math.abs(aniso.fix.posErr - aniso.fix.rangeErr) < 1, Math.round(aniso.fix.rangeErr / 1e3) + ' km, posErr ' + Math.round(aniso.fix.posErr / 1e3) + ' km');
  check('los points from the ear that holds her to the target', Math.abs(aniso.fix.los - aniso.los) < 1e-6, (aniso.fix.los * 180 / Math.PI).toFixed(1) + '°');
  check('the ghost lies along the line of sight, not around it', aniso.crossRms > 0 && aniso.crossRms < aniso.alongRms * 0.15 && aniso.worst < 0.1, 'along ' + Math.round(aniso.alongRms / 1e3) + ' km rms, across ' + Math.round(aniso.crossRms / 1e3) + ' km rms');

  // A hull that has hidden longer must not be localised better. The clock on the reckoning runs until the ears
  // actually see her again, and touching T.errCap is not a reading: the box used to snap back (dark 3 min
  // ±1 272 km and 34° of bearing, dark 4 min ±731 km and 0.78°) the moment the carried q met the floor.
  const reckon = await page.evaluate(() => {
    const sim = OD.Game.sim, S = OD.Sensors;
    const me = sim.playerShips()[0], foe = sim.hostiles(me)[0];
    me.pos.x = 0; me.pos.y = 0; foe.pos.x = 1500e3; foe.pos.y = 0; foe.vel.x = 0; foe.vel.y = 0;
    foe.throttle = 1;                       // a torch: a solution from anywhere
    S.init(sim);
    const lit = S.track(sim, me, foe);
    const pinned = { q: lit.q, posErr: lit.posErr, fade: lit.fade };
    foe.throttle = 0;                       // and she goes dark: from here the plot is reckoning
    S.update(sim, 0);
    const box = () => { const t = S.track(sim, me, foe); return { t: Math.round(t.fade), q: t.q, fade: t.fade, posErr: t.posErr, deg: (t.bearingErr * 180) / Math.PI, fix: t.range * 0.12 * Math.pow(3 - t.q, 1.5) }; };
    const trail = [];
    for (let i = 0; i < 12; i++) { sim.time += 30; S.update(sim, 30); trail.push(box()); }   // six minutes dark
    const cls = OD.Ships.CLASSES[foe.cls];
    // and the moment she shows herself again the box is the fresh fix, not the reckoning
    foe.throttle = 1; S.update(sim, 0);
    const relit = box();
    return { pinned, trail, relit, aMax: cls.thrust / cls.dryMass, cap: 1500e3 * S.T.errCap, at180: trail[5], at240: trail[7], last: trail[11] };
  });
  const law = (r) => Math.min(reckon.cap, Math.max(0.5 * reckon.aMax * r.fade * r.fade, r.fix));
  check('a solution carries no error box at all', reckon.pinned.q === 3 && reckon.pinned.posErr === 0);
  check("a faded track's error grows with the time since the last good reading", reckon.trail.every((r, i) => r.fade > 0 && (i === 0 || r.posErr >= reckon.trail[i - 1].posErr - 1)) && reckon.at240.posErr > reckon.trail[0].posErr, reckon.trail.filter((r, i) => i % 2 === 1).map((r) => r.t + ' s ±' + Math.round(r.posErr / 1e3) + ' km').join(' · '));
  check('the box is her own acceleration over the last fix, floored at what the reported q is worth', reckon.trail.every((r) => Math.abs(r.posErr - law(r)) <= Math.max(1, law(r) * 0.001)), reckon.trail.slice(0, 4).map((r) => Math.round(r.posErr / 1e3) + ' of ' + Math.round(law(r) / 1e3) + ' km').join(' · ') + ', a_max ' + reckon.aMax.toFixed(1) + ' m/s²');
  check('and a hull that stays dark is never localised better for hiding longer', reckon.at240.posErr >= reckon.at180.posErr && reckon.at240.deg >= reckon.at180.deg && reckon.at240.fade > reckon.at180.fade, '3 min ±' + Math.round(reckon.at180.posErr / 1e3) + ' km / ' + reckon.at180.deg.toFixed(2) + '° → 4 min ±' + Math.round(reckon.at240.posErr / 1e3) + ' km / ' + reckon.at240.deg.toFixed(2) + '°');
  check('the cap holds the box without stopping the clock', Math.abs(reckon.last.posErr - reckon.cap) < 1 && reckon.last.fade >= 330, '6 min dark: ±' + Math.round(reckon.last.posErr / 1e3) + ' km of a ' + Math.round(reckon.cap / 1e3) + ' km cap, clock ' + reckon.last.t + ' s');
  check('and the box closes again the moment she shows herself', reckon.relit.posErr === 0 && reckon.relit.fade === 0, '±' + Math.round(reckon.relit.posErr / 1e3) + ' km');

  console.log('scenario: boarding numbers and the first hit');
  await page.evaluate(() => OD.harness.start(OD.Skirmish.build({ player: 'JC', env: 'deep', range: 200, playerShips: { corvette: 1 }, enemyShips: { corvette: 1 }, seed: 5 })));
  const board = await page.evaluate(() => {
    const sim = OD.Game.sim;
    const me = sim.playerShips()[0], foe = sim.hostiles(me)[0];
    const set = (speed) => {
      for (const s2 of sim.ships) { s2.ai = false; s2.order = { type: 'hold' }; s2.throttle = 0; s2.cmdThrottle = 0; s2.weaponsFree = false; s2.boarding = null; }
      me.pos.x = 0; me.pos.y = 0; me.vel.x = 0; me.vel.y = 0;
      foe.pos.x = 1500; foe.pos.y = 0; foe.vel.x = 0; foe.vel.y = speed;
      OD.harness.step(2);
      return !!(me.boarding || foe.boarding);
    };
    const slow = set(20), fast = set(30);
    return { B: OD.Sim.BOARD, slow, fast };
  });
  check('OD.Sim.BOARD carries the range, the speed and the crossing time', !!board.B && board.B.range === 3000 && board.B.speed === 25 && board.B.time === 90, JSON.stringify(board.B));
  check('a party crosses under 25 m/s and not over it', board.slow === true && board.fast === false, 'at 20 m/s ' + board.slow + ', at 30 m/s ' + board.fast);

  const firstHit = await page.evaluate(() => {
    const sim = OD.Game.sim;
    const me = sim.playerShips()[0], foe = sim.hostiles(me)[0];
    sim.log.length = 0;
    me.hull = 0.83; foe.hull = 0.6;
    OD.harness.step(1);
    const first = sim.log.filter((l) => l.speaker === 'Damage control').map((l) => l.text);
    me.hull = 0.4;
    OD.harness.step(1);
    const again = sim.log.filter((l) => l.speaker === 'Damage control').map((l) => l.text);
    return { first, again, name: me.name, foe: foe.name };
  });
  check('the first hull loss on one of ours is called by damage control', firstHit.first.length === 1 && firstHit.first[0].indexOf(firstHit.name) === 0 && /first hit/.test(firstHit.first[0]) && /83 %/.test(firstHit.first[0]), firstHit.first.join(' / '));
  check('only once, and never for a hostile', firstHit.again.filter((t) => /first hit/.test(t)).length === 1 && firstHit.again.join(' ').indexOf(firstHit.foe) < 0, firstHit.again.join(' / '));
  check('and every tenth of hull after that is called too', firstHit.again.some((t) => /hull integrity 40 %/.test(t) && t.indexOf(firstHit.name) === 0), firstHit.again.join(' / '));

  // The error wanders. It used to be one draw per (faction, target) — fixed phases, fixed rates, a fixed size —
  // so on a mirrored pair one side's plot was permanently the tighter one: it firmed up first, landed first, and
  // an even fight snowballed from there (the autopilot's 3-a-side probe had the luckier side losing 1.48 times
  // less hull, whichever faction the player took). The phases are redrawn every T.ghostDrift seconds now and
  // blended into the draw before them, so a seed is worth nothing a few minutes later.
  console.log('scenario: the wandering error — an even pair is even from both ends');
  await page.evaluate(() => OD.harness.start(OD.Skirmish.build({ player: 'JC', env: 'deep', range: 1000, playerShips: { frigate: 1 }, enemyShips: { frigate: 1 }, seed: 9 })));
  const even = await page.evaluate(() => {
    const sim = OD.Game.sim, S = OD.Sensors, U = OD.U;
    const a = sim.playerShips()[0], b = sim.hostiles(a)[0];
    const SEEDS = 24, WIN = 300, WINDOWS = 6;         // 24 mirrored pairs, six five-minute windows each
    // Two frigates, 1 000 km apart, both cold, both coasting, neither lit: the same picture from either end.
    const still = () => {
      for (const s of sim.ships) {
        s.ai = false; s.order = { type: 'hold' }; s.throttle = 0; s.cmdThrottle = 0; s.weaponsFree = false; s.target = null;
        s.heat = 0; if (s.radiators) { s.radiators.deployed = false; s.radiators.state = 0; }
        S.setActive(s, false);
      }
      a.pos.x = -500e3; a.pos.y = 0; a.vel.x = 0; a.vel.y = 0;
      b.pos.x = 500e3; b.pos.y = 0; b.vel.x = 0; b.vel.y = 0;
    };
    let sumA = 0, sumB = 0, sweep = 0, qGap = 0, boxGap = 0, q = 0, box = 0;
    for (let seed = 0; seed < SEEDS; seed++) {
      still();
      a.id = 'even_jc_' + seed; b.id = 'even_isa_' + seed;   // a fresh pair of hulls: its own draw on both sides
      sim.time = 0; S.init(sim);
      const win = [];
      for (let w = 0; w < WINDOWS; w++) {
        let ea = 0, eb = 0, n = 0;
        for (let t = 0; t < WIN; t++) {
          sim.time += 1; S.update(sim, 1);
          const ta = S.track(sim, 'JC', b), tb = S.track(sim, 'ISA', a);
          ea += U.dist(ta.est.pos, b.pos); eb += U.dist(tb.est.pos, a.pos); n++;
          qGap = Math.max(qGap, Math.abs(ta.q - tb.q)); boxGap = Math.max(boxGap, Math.abs(ta.posErr - tb.posErr));
          q = ta.q; box = ta.posErr;
        }
        win.push({ a: ea / n, b: eb / n });
      }
      sumA += win[0].a; sumB += win[0].b;                    // the first five minutes: the opening of a fight
      const side = Math.sign(win[0].a - win[0].b);
      if (side !== 0 && win.every((x) => Math.sign(x.a - x.b) === side)) sweep++;   // still ahead half an hour on
    }
    return { SEEDS, WINDOWS, a: sumA / SEEDS, b: sumB / SEEDS, sweep, qGap, boxGap, q, box };
  });
  const evenGap = Math.abs(even.a - even.b) / ((even.a + even.b) / 2);
  check('a mirrored pair reads the same q and the same error box both ways', even.qGap < 1e-9 && even.boxGap < 1e-6, 'q ' + even.q.toFixed(2) + ' ±' + Math.round(even.box / 1e3) + ' km, worst gap ' + even.qGap.toExponential(1) + ' q / ' + even.boxGap.toFixed(3) + ' m');
  check('so over ' + even.SEEDS + ' seeds the mean error over the first 5 min differs by under 10 % between the two sides', evenGap < 0.10,
    Math.round(even.a / 1e3) + ' km against ' + Math.round(even.b / 1e3) + ' km: ' + (evenGap * 100).toFixed(1) + ' %');
  check('and no side keeps its advantage: at most a fifth of the pairs are still the tighter one half an hour on', even.sweep <= even.SEEDS * 0.2,
    even.sweep + ' of ' + even.SEEDS + ' pairs ahead in all ' + even.WINDOWS + ' windows (a draw held for the whole fight keeps a quarter to a half of them)');

  // Wandering is not jittering: the ghost has to be somewhere sensible every frame, not twitch about inside the
  // box. At a constant q the bound is 3 % of the error box in a second, so a ghost takes the better part of a
  // minute to work across its own box and the map shows a contact sliding rather than flickering. That is no
  // faster than the old fixed draw, whose two turns alone were worth about 3 % of the box a second.
  const drift = await page.evaluate(() => {
    const sim = OD.Game.sim, S = OD.Sensors, U = OD.U;
    const a = sim.playerShips()[0], b = sim.hostiles(a)[0];
    a.id = 'drift_jc'; b.id = 'drift_isa';
    sim.time = 0; S.init(sim);
    for (let t = 0; t < 900; t++) { sim.time += 1; S.update(sim, 1); }   // the dwell bonus saturates: q settles
    let prev = null, max = 0, sum = 0, n = 0, qmin = 9, qmax = 0, box = 0;
    for (let t = 0; t < 900; t++) {
      sim.time += 1; S.update(sim, 1);
      const tr = S.track(sim, 'JC', b);
      qmin = Math.min(qmin, tr.q); qmax = Math.max(qmax, tr.q); box = tr.posErr;
      const p = { x: tr.est.pos.x, y: tr.est.pos.y };
      if (prev) { const d = U.dist(p, prev); max = Math.max(max, d); sum += d; n++; }
      prev = p;
    }
    return { max, mean: sum / n, qmin, qmax, box };
  });
  check('and at constant q the ghost drifts under 3 % of its error box in a second, which is a slide and not a jitter',
    drift.qmax - drift.qmin < 1e-9 && drift.max > 0 && drift.max < drift.box * 0.03,
    'q ' + drift.qmin.toFixed(2) + ' fixed, ±' + Math.round(drift.box / 1e3) + ' km box: worst step ' + Math.round(drift.max) + ' m/s (' + (100 * drift.max / drift.box).toFixed(2) + ' % of the box), mean ' + Math.round(drift.mean) + ' m/s');

  const errs = consoleErrors.filter((e) => !/fonts.googleapis|ERR_INTERNET|net::ERR|Failed to load resource/.test(e) && !(/^file:/.test(url) && /Access to font/.test(e)));
  check('no console errors', errs.length === 0, errs.join(' | '));

  await browser.close();
  console.log(failures ? failures + ' check(s) failed' : 'all checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
