/* Edge cases for js/engagement.js that the playtests do not reach: the readouts and the reach
   maths when there is no target, no bay, no beam and no point defence, the fire-mode aliases and
   the aim fallbacks. node tools/engagement-check.js  (Playwright + Chromium, as the harness) */
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const url = process.env.OD_URL || 'file://' + path.join(ROOT, 'index.html');

let failures = 0;
function check(name, ok, detail) { console.log((ok ? '  ok   ' : '  FAIL ') + name + (detail ? '  ' + detail : '')); if (!ok) failures++; }

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(url);
  await page.waitForTimeout(500);

  console.log('scenario: a hull with nothing fitted');
  const bare = await page.evaluate(() => {
    OD.harness.start(OD.Skirmish.build({ player: 'JC', env: 'deep', range: 300, playerShips: { corvette: 1 }, enemyShips: { corvette: 1 }, seed: 3 }));
    const sim = OD.Game.sim;
    const hostile = sim.nearestHostile(sim.playerShips()[0]);
    // a hull with no mounts at all: no beams, no bays, no coilgun, no point defence. She is put
    // alongside a hostile and given her as a target, so an empty salvo is the empty rails talking
    // and not the fire-control gate in front of them.
    const f = sim.spawn({ id: 'hauler', name: 'JCV Hauler', cls: 'freighter', faction: 'JC', pos: { x: hostile.pos.x - 50e3, y: hostile.pos.y }, vel: { x: hostile.vel.x, y: hostile.vel.y } });
    sim.setTarget(f.id, hostile.id); f.weaponsFree = true;
    const E = OD.Engagement;
    return {
      reach: JSON.parse(JSON.stringify(E.reach(sim, f, null))),
      acts: (E.panelActions(f) || []).map((a) => a.id),
      rows: (E.shipReadout(f) || []).map((r) => r.label),
      notes: (E.physicsNotes(f, null) || []).map((n) => n.title),
      pd: E.pdReport(f),
      board: E.threatSummary(sim, f),
      threats: E.threats(sim, f).length,
      salvo: E.salvo(sim, f, 2),
      salvoLog: (sim.log[sim.log.length - 1] || {}).text || '',
      targeted: f.target === hostile.id,
    };
  });
  check('an unarmed hull has no burn-through range', bare.reach.beams.nose === 0 && bare.reach.beams.tail === 0, JSON.stringify(bare.reach.beams));
  check('no bays means no launch reach', bare.reach.launch === null, String(bare.reach.launch));
  check('no coilgun means no slug reach', bare.reach.slug === 0, String(bare.reach.slug));
  check('no point-defence mounts means no point-defence reach', bare.reach.pd === 0, String(bare.reach.pd));
  check('no mounts offers no actions', bare.acts.length === 0, bare.acts.join(','));
  check('the readout still answers', bare.rows.length > 0, bare.rows.join(' · '));
  check('the advisory reads clear', bare.board.level === 'none' && /Nothing inbound/.test(bare.board.text), bare.board.text);
  check('a salvo with no bays launches nothing', bare.salvo === 0 && bare.targeted && /bays are empty/.test(bare.salvoLog), bare.salvo + ' away · ' + bare.salvoLog);
  check('no threats aimed at her', bare.threats === 0, String(bare.threats));

  console.log('scenario: fire modes and aim points on a corvette');
  const fc = await page.evaluate(() => {
    OD.harness.start(OD.Skirmish.build({ player: 'JC', env: 'deep', range: 200, playerShips: { corvette: 1 }, enemyShips: { corvette: 1 }, seed: 4 }));
    const sim = OD.Game.sim;
    const s = sim.playerShips()[0];
    const h = sim.nearestHostile(s);
    const E = OD.Engagement;
    sim.setTarget(s.id, h.id);
    s.weaponsFree = true;
    const out = {};
    // the old hold toggle is still a toggle
    sim.engagementAction(s, 'holdbeams');
    out.held = E.fireMode(s);
    sim.engagementAction(s, 'holdbeams');
    out.released = E.fireMode(s);
    // sustained with the radiators stowed keeps the beams cold
    E.setFireMode(s, 'sustained');
    s.radiators.auto = false; s.radiators.deployed = false; s.radiators.state = 0;
    out.coldGain = E.shared.beamGain(s);
    out.coldRow = (E.shipReadout(s) || []).find((r) => r.label === 'Fire mode');
    out.coldStatus = ((E.shipReadout(s) || []).find((r) => r.label === 'Status') || {}).value;
    s.radiators.state = 1; s.radiators.deployed = true;
    out.warmGain = E.shared.beamGain(s);
    // the ladder is the same whether the beams are held or not
    const full = E.reach(sim, s, h).beams.flank;
    E.setFireMode(s, 'hold');
    const held = E.reach(sim, s, h).beams.flank;
    out.ladderStands = Math.abs(full - held) < 1;
    E.setFireMode(s, 'full');
    // aim points fall back when the part is not exposed
    h.radiators.state = 0;
    E.setAim(s, 'radiators');
    out.stowed = (E.shipReadout(s) || []).find((r) => r.label === 'Aim').value;
    h.radiators.state = 1;
    out.radTip = ((E.panelActions(s) || []).find((a) => a.id === 'aim_radiators') || {}).tip || '';
    out.extended = (E.shipReadout(s) || []).find((r) => r.label === 'Aim').value;
    E.setAim(s, 'drive');
    out.drive = (E.shipReadout(s) || []).find((r) => r.label === 'Aim').value;
    E.setAim(s, 'hull');
    // the cache hands back the same array inside one substep
    out.sameArray = E.threats(sim, s) === E.threats(sim, s) && E.reach(sim, s, h) === E.reach(sim, s, h);
    return out;
  });
  check('holdbeams toggles hold and back', fc.held === 'hold' && fc.released === 'full', fc.held + ' / ' + fc.released);
  check('sustained with the radiators stowed keeps the beams cold', fc.coldGain === 0, String(fc.coldGain));
  check('the readout says so', /radiators stowed|0 %/.test(fc.coldRow ? fc.coldRow.value : ''), fc.coldRow ? fc.coldRow.value : '—');
  check('and the status row uses the build\u2019s words for the panels', fc.coldStatus === 'sustained, radiators stowed', fc.coldStatus || '—');
  check('sustained with the radiators extended lets them fire', fc.warmGain > 0, String(fc.warmGain));
  check('held beams still have a burn-through range', fc.ladderStands);
  check('aim falls back when the radiators are stowed', /radiators stowed/.test(fc.stowed), fc.stowed);
  check('and the aim button says a narrow aim point is a shorter burn-through range',
    /That narrower aim point burns through at a shorter range, so close in before you take it\./.test(fc.radTip || ''), fc.radTip || '\u2014');
  check('aim holds when they are extended', fc.extended === 'radiators', fc.extended);
  check('aim falls back off the tail', /hull/.test(fc.drive), fc.drive);
  check('threats and reach are cached within a substep', fc.sameArray);

  console.log('scenario: the bays answer to fire control');
  const gate = await page.evaluate(() => {
    const E = OD.Engagement;
    const run = (set) => {
      OD.harness.start(OD.Skirmish.build({ player: 'JC', env: 'deep', range: 306, playerShips: { lancer: 1 }, enemyShips: { destroyer: 1 }, seed: 9 }));
      const sim = OD.Game.sim;
      const me = sim.playerShips()[0], foe = sim.nearestHostile(me);
      for (const s of sim.ships) { s.ai = false; s.jink = false; s.cmdThrottle = 0; s.throttle = 0; s.order = { type: 'hold' }; }
      sim.setTarget(me.id, foe.id); me.weaponsFree = true;
      set(me);
      const launched = E.salvo(sim, me, 2);   // the module's own door
      sim.engagementAction(me, 'launch2');    // and the panel key behind it
      const r = E.reach(sim, me, foe);
      return {
        launched, darts: sim.eng.interceptors.length,
        acts: (E.panelActions(me) || []).map((a) => a.id).filter((id) => /^launch/.test(id)).length,
        pd: E.pdReport(me).live, reachPd: r.pd, reachBeams: r.beams.nose + r.beams.flank + r.beams.tail,
      };
    };
    return {
      free: run(() => {}),
      adrift: run((s) => { s.disabled = true; }),
      wreck: run((s) => { s.destroyed = true; s.disabled = true; s.hull = 0; }),
      tight: run((s) => { s.weaponsFree = false; }),
      inhibited: run((s) => { s.weaponsInhibited = true; s.heat = s.sinkCapacity; }),
    };
  });
  check('a hull with free weapons and a track launches', gate.free.launched === 2 && gate.free.darts === 4 && gate.free.acts > 0,
    gate.free.launched + ' away, ' + gate.free.darts + ' in the sky, ' + gate.free.acts + ' launch keys');
  check('an adrift hull launches nothing', gate.adrift.launched === 0 && gate.adrift.darts === 0 && gate.adrift.acts === 0, JSON.stringify(gate.adrift));
  check('a wreck launches nothing', gate.wreck.launched === 0 && gate.wreck.darts === 0 && gate.wreck.acts === 0, JSON.stringify(gate.wreck));
  check('a ship gone weapons tight launches nothing', gate.tight.launched === 0 && gate.tight.darts === 0 && gate.tight.acts === 0, JSON.stringify(gate.tight));
  check('a saturated sink launches nothing', gate.inhibited.launched === 0 && gate.inhibited.darts === 0 && gate.inhibited.acts === 0, JSON.stringify(gate.inhibited));
  check('a wreck reads as out on the rings and the point-defence row',
    gate.wreck.pd === 0 && gate.wreck.reachPd === 0 && gate.wreck.reachBeams === 0 && gate.inhibited.pd === 0,
    'wreck ' + gate.wreck.pd + ' live, pd reach ' + gate.wreck.reachPd + ', inhibited ' + gate.inhibited.pd + ' live');

  console.log('scenario: a cripple is a prize, not a target the computer works');
  const cripple = await page.evaluate(() => {
    const E = OD.Engagement, U = OD.U;
    const run = (ai) => {
      OD.harness.start(OD.Skirmish.build({ player: 'JC', env: 'deep', range: 150, playerShips: { corvette: 1 }, enemyShips: { corvette: 1 }, seed: 4 }));
      const sim = OD.Game.sim;
      const me = sim.playerShips()[0], foe = sim.nearestHostile(me);
      for (const s of sim.ships) { s.ai = false; s.jink = false; s.cmdThrottle = 0; s.throttle = 0; s.order = { type: 'hold' }; }
      me.heading = U.angleOf(U.sub(foe.pos, me.pos)); me.cmdHeading = me.heading; me.angVel = 0; // the spinal mount bears
      foe.disabled = true; foe.weaponsFree = false; foe.target = null;
      sim.setTarget(me.id, foe.id); me.weaponsFree = true;
      me.ai = ai; // the computer leaves her; the bridge may finish her, once it has said so
      if (!ai) me.finishTarget = foe.id;
      const hull0 = foe.hull;
      for (let i = 0; i < 60; i++) OD.harness.step(0.5);
      const row = (E.shipReadout(me) || []).find((r) => r.label === 'Status');
      return { hurt: hull0 - foe.hull, slugs: sim.eng.stats.slugsFired, status: row ? row.value : '—' };
    };
    return { bridge: run(false), computer: run(true) };
  });
  check('the bridge can finish a cripple', cripple.bridge.hurt > 0 && cripple.bridge.status !== 'no target',
    'hull off ' + cripple.bridge.hurt.toFixed(3) + ', ' + cripple.bridge.slugs + ' slugs, status ' + cripple.bridge.status);
  check('the computer holds its fire and keeps the prize', cripple.computer.hurt === 0 && cripple.computer.slugs === 0,
    'hull off ' + cripple.computer.hurt.toFixed(3) + ', ' + cripple.computer.slugs + ' slugs');

  console.log('scenario: the bridge holds on a hull that is out of the fight');
  const spare = await page.evaluate(() => {
    const E = OD.Engagement, U = OD.U;
    // A corvette carries one of each: a spinal beam, a coilgun and a bay. All three answer to the
    // same gate, so one hull tests all three.
    const run = (ordered) => {
      OD.harness.start(OD.Skirmish.build({ player: 'JC', env: 'deep', range: 150, playerShips: { corvette: 1 }, enemyShips: { corvette: 1 }, seed: 4 }));
      const sim = OD.Game.sim;
      const me = sim.playerShips()[0], foe = sim.nearestHostile(me);
      for (const s of sim.ships) { s.ai = false; s.jink = false; s.cmdThrottle = 0; s.throttle = 0; s.order = { type: 'hold' }; }
      me.heading = U.angleOf(U.sub(foe.pos, me.pos)); me.cmdHeading = me.heading; me.angVel = 0; // the spinal mount bears
      me.activeSensor = true;
      foe.weaponsFree = false; foe.target = null;
      foe.disabled = true;                       // she is out of the fight and nobody is aboard her
      sim.setTarget(me.id, foe.id); me.weaponsFree = true;
      if (ordered) OD.Decisions.finish(me, foe.id); // the cripple card's 'finish her', by its own door
      const hull0 = foe.hull, slugs0 = sim.eng.stats.slugsFired, t0 = sim.log.length;
      const away = E.salvo(sim, me, 2);          // and the bays ask the same question
      const darts = sim.eng.interceptors.length;
      for (let i = 0; i < 300; i++) OD.harness.step(0.5); // 150 s: seven hit-log windows
      const row = (E.shipReadout(me) || []).find((r) => r.label === 'Status');
      const lines = sim.log.slice(t0).filter((l) => l.speaker === 'Gunnery');
      return {
        hurt: hull0 - foe.hull,
        slugs: sim.eng.stats.slugsFired - slugs0,
        away, darts,
        launchKeys: (E.panelActions(me) || []).filter((a) => /^launch/.test(a.id) && !a.hidden).length,
        status: row ? row.value : '—',
        named: me.target === foe.id && !!E.shared.engagementTarget(sim, me),
        held: lines.filter((l) => /out of the fight/.test(l.text)).length,
        lines: lines.map((l) => l.text),
      };
    };
    return { holding: run(false), ordered: run(true) };
  });
  check('nothing comes off the mounts at a hull that is out of the fight',
    spare.holding.hurt === 0 && spare.holding.slugs === 0 && spare.holding.away === 0 && spare.holding.darts === 0 && spare.holding.launchKeys === 0,
    'hull off ' + spare.holding.hurt.toFixed(3) + ', ' + spare.holding.slugs + ' slugs, ' + spare.holding.away + ' away, ' + spare.holding.launchKeys + ' launch keys');
  check('the fire-control row says why', spare.holding.status === 'holding: she is out of the fight', spare.holding.status);
  check('and the panel goes on naming her', spare.holding.named, String(spare.holding.named));
  check('the hold is one line, once', spare.holding.held === 1 && spare.holding.lines.length === 1,
    spare.holding.lines.join(' | ') || 'no lines');
  check('an order to finish her puts the mounts back on her',
    spare.ordered.hurt > 0 && spare.ordered.away === 2 && spare.ordered.held === 0,
    'hull off ' + spare.ordered.hurt.toFixed(3) + ', ' + spare.ordered.slugs + ' slugs, ' + spare.ordered.away + ' away');

  console.log('scenario: the Gunnery hit lines stop once the outcome is set');
  const decided = await page.evaluate(() => {
    OD.harness.start(OD.Skirmish.build({ player: 'JC', env: 'deep', range: 120, playerShips: { destroyer: 1 }, enemyShips: { destroyer: 1 }, seed: 5 }));
    const sim = OD.Game.sim;
    const me = sim.playerShips()[0], foe = sim.nearestHostile(me);
    for (const s of sim.ships) { s.ai = false; s.jink = false; s.cmdThrottle = 0; s.throttle = 0; s.order = { type: 'hold' }; }
    foe.mounts = foe.mounts.filter((m) => m.kind === 'pd'); // she stops darts, she does not shoot back
    foe.weaponsFree = false; foe.target = null;
    sim.setTarget(me.id, foe.id); me.weaponsFree = true; me.activeSensor = true;
    me.finishTarget = foe.id;  // so the hold above is out of the way and only the outcome is on trial
    const landed = () => sim.log.filter((l) => l.speaker === 'Gunnery' && /(slug through|slugs through|armour held|aboard| this minute\.)/.test(l.text)).length;
    for (let i = 0; i < 90; i++) OD.harness.step(1);   // four hit-log windows and a joules roll-up
    const before = landed(), hull0 = foe.hull;
    sim.outcome = 'victory'; sim.outcomeTime = sim.time;
    // harness.step stops at an outcome, so the clock is turned by hand: the beams are still on her.
    for (let i = 0; i < 100; i++) sim.step(1);
    const mid = landed(), hullMid = foe.hull;
    for (let i = 0; i < 50; i++) sim.step(1);          // and still landing at the end of the window
    return { before, mid, after: landed(), hurtEarly: hull0 - hullMid, hurtLate: hullMid - foe.hull };
  });
  check('the fight is reported while it is a fight', decided.before > 1, decided.before + ' lines in 60 s');
  check('and not a line after the outcome is set', decided.after === decided.before && decided.mid === decided.before,
    decided.before + ' → ' + decided.mid + ' → ' + decided.after + ' over 150 s more');
  check('though the mounts were on her the whole window', decided.hurtEarly > 0 && decided.hurtLate > 0,
    'hull off ' + decided.hurtEarly.toFixed(3) + ' then ' + decided.hurtLate.toFixed(3) + ' after the outcome');

  console.log('scenario: two bearings, two facets, and a salvo on a paused bridge');
  const bearings = await page.evaluate(() => {
    const E = OD.Engagement, U = OD.U;
    OD.harness.start(OD.Skirmish.build({ player: 'JC', env: 'deep', range: 300, playerShips: { cruiser: 2 }, enemyShips: { destroyer: 1 }, seed: 23 }));
    const sim = OD.Game.sim;
    const foe = sim.hostiles(sim.playerShips()[0])[0];
    const a = sim.playerShips()[0], b = sim.playerShips()[1];
    for (const s of sim.ships) { s.ai = false; s.jink = false; s.cmdThrottle = 0; s.throttle = 0; s.order = { type: 'hold' }; s.vel = { x: 0, y: 0 }; }
    foe.heading = 0; foe.cmdHeading = 0; foe.angVel = 0; foe.weaponsFree = false; foe.target = null;
    a.pos = { x: foe.pos.x + 120e3, y: foe.pos.y };   // on her nose
    b.pos = { x: foe.pos.x, y: foe.pos.y + 120e3 };   // on her flank
    for (const s of [a, b]) { s.heading = U.angleOf(U.sub(foe.pos, s.pos)); s.cmdHeading = s.heading; s.angVel = 0; sim.setTarget(s.id, foe.id); s.weaponsFree = true; }
    for (let i = 0; i < 6; i++) OD.harness.step(0.5);
    const dmg = { nose: foe.damage.nose, flank: foe.damage.flank, tail: foe.damage.tail };
    // and the board: a salvo fired between substeps shows at once, not at the next tick
    const warm = E.threats(sim, foe).length;
    E.salvo(sim, a, 4);
    return { dmg, warm, after: E.threats(sim, foe).length, text: E.threatSummary(sim, foe).text };
  });
  check('each bearing burns the facet it crossed for', bearings.dmg.nose > 0 && bearings.dmg.flank > 0, JSON.stringify(bearings.dmg));
  check('a salvo is on the board the moment it leaves the rails', bearings.after === bearings.warm + 4 && !/Nothing inbound/.test(bearings.text),
    bearings.warm + ' → ' + bearings.after + ' · ' + bearings.text);

  console.log('scenario: the event ring does not grow without end');
  const ring = await page.evaluate(() => {
    const sim = OD.Game.sim;
    const eng = sim.eng;
    const before = eng.eventSeq;
    for (let i = 0; i < 400; i++) OD.Engagement.shared.emit(sim, 'hit', { x: 0, y: 0 }, 's', 's', 'test');
    return { len: eng.events.length, seq: eng.eventSeq - before, first: eng.eventFirst, cap: OD.Engagement.tuning.eventCap };
  });
  check('the ring is capped', ring.len === ring.cap, JSON.stringify(ring));
  check('the sequence counts every event', ring.seq === 400, String(ring.seq));
  check('and the first index follows it', ring.first > 0, String(ring.first));

  console.log('scenario: the countdown, the salvo tip and the arrival are one flight');
  const flight = await page.evaluate(() => {
    OD.harness.start(OD.Skirmish.build({ player: 'JC', env: 'deep', range: 306, playerShips: { lancer: 1 }, enemyShips: { destroyer: 1 }, seed: 9 }));
    const sim = OD.Game.sim, E = OD.Engagement;
    const me = sim.playerShips()[0], foe = sim.nearestHostile(me);
    // a clean board: nobody manoeuvring, no point defence to take the salvo off
    for (const s of sim.ships) { s.ai = false; s.jink = false; s.cmdThrottle = 0; s.throttle = 0; s.order = { type: 'hold' }; s.mounts = (s.mounts || []).filter((m) => m.kind !== 'pd'); }
    sim.setTarget(me.id, foe.id); me.weaponsFree = true;
    const d = OD.U.dist(me.pos, foe.pos);
    const tip = E.salvoEstimate(sim, me, foe, 2).flightTime;
    E.salvo(sim, me, 2);
    const t0 = sim.time;
    const seen = [];
    let arrived = null;
    for (let i = 0; i < 900; i++) {
      OD.harness.step(1);
      const dart = E.threats(sim, foe).find((r) => r.kind === 'interceptor');
      if (dart) { if (dart.eta !== null) seen.push({ t: sim.time - t0, eta: dart.eta }); }
      else if (i > 2) { arrived = sim.time - t0; break; }
    }
    const predicted = seen.map((r) => r.t + r.eta);
    return { d, tip, arrived, first: seen[0] || null, spread: Math.max(...predicted) - Math.min(...predicted), predicted: predicted[0], samples: seen.length };
  });
  check('the countdown predicts the arrival', flight.arrived !== null && Math.abs(flight.predicted - flight.arrived) < 0.1 * flight.arrived,
    'predicted ' + (flight.predicted || 0).toFixed(1) + ' s, aboard at ' + (flight.arrived || 0).toFixed(1) + ' s');
  check('and holds that answer all the way in', flight.samples > 20 && flight.spread < 0.1 * flight.arrived, 'spread ' + flight.spread.toFixed(1) + ' s over ' + flight.samples + ' samples');
  check('the salvo tip agrees with the countdown', flight.tip && Math.abs(flight.tip - flight.arrived) < 0.15 * flight.arrived,
    'tip ' + (flight.tip || 0).toFixed(1) + ' s, aboard at ' + (flight.arrived || 0).toFixed(1) + ' s');

  console.log('scenario: precision aim on the ladder, and the ladder on a paused bridge');
  const ladder = await page.evaluate(() => {
    OD.harness.start(OD.Skirmish.build({ player: 'JC', env: 'deep', range: 302, playerShips: { cruiser: 1 }, enemyShips: { destroyer: 1 }, seed: 5 }));
    const sim = OD.Game.sim, E = OD.Engagement;
    const me = sim.playerShips()[0], foe = sim.nearestHostile(me);
    me.ai = false; sim.setTarget(me.id, foe.id); me.weaponsFree = true;
    E.setAim(me, 'hull');
    const hull = E.reach(sim, me, foe).beams.nose, hullThrough = E.shared.assess(sim, me).through;
    E.setAim(me, 'mounts'); // no step between: the bridge is paused
    const mounts = E.reach(sim, me, foe).beams.nose, mountsThrough = E.shared.assess(sim, me).through;
    E.setAim(me, 'hull');
    const aliased = E.reach(sim, me, foe).beams === E.reach(sim, foe, me).their.beams;
    return { range: OD.U.dist(me.pos, foe.pos), hull, hullThrough, mounts, mountsThrough, aliased, launch: E.reach(sim, me, foe).launch };
  });
  check('the ladder follows the aim point without waiting for a substep', ladder.mounts !== ladder.hull, 'hull ' + Math.round(ladder.hull / 1000) + ' km, mounts ' + Math.round(ladder.mounts / 1000) + ' km');
  check('the ladder and the energy through armour agree', (ladder.mounts > ladder.range) === (ladder.mountsThrough > 0) && (ladder.hull > ladder.range) === (ladder.hullThrough > 0),
    'mounts ' + Math.round(ladder.mounts / 1000) + ' km / ' + ladder.mountsThrough.toExponential(2) + ' W through, hull ' + Math.round(ladder.hull / 1000) + ' km / ' + ladder.hullThrough.toExponential(2) + ' W');
  check('the launch reach is a range hulls fight at', ladder.launch > 1500e3 && ladder.launch < 5000e3, Math.round(ladder.launch / 1000) + ' km');
  check('each reach owns its facets', !ladder.aliased);

  console.log('scenario: what point defence really takes off a salvo');
  const pd = await page.evaluate(() => {
    OD.harness.start(OD.Skirmish.build({ player: 'JC', env: 'deep', range: 375, playerShips: { destroyer: 1 }, enemyShips: { lancer: 1 }, seed: 11 }));
    const sim = OD.Game.sim, E = OD.Engagement;
    const me = sim.playerShips()[0], foe = sim.nearestHostile(me);
    for (const s of sim.ships) { s.ai = false; s.jink = false; s.cmdThrottle = 0; s.throttle = 0; s.order = { type: 'hold' }; }
    me.mounts = me.mounts.filter((m) => m.kind === 'pd');       // nothing but her point defence
    foe.mounts = foe.mounts.filter((m) => m.kind === 'launcher'); // and nothing but her bays
    sim.setTarget(foe.id, me.id); foe.weaponsFree = true;
    const est = E.salvoEstimate(sim, foe, me, 12);
    E.shared.launchSalvo(sim, foe, me, sim.eng, 12);
    const kills0 = sim.eng.stats.pdKills, hits0 = sim.eng.stats.interceptorHits;
    OD.harness.step(1);
    const say = E.threatSummary(sim, me);
    for (let i = 0; i < 600 && sim.eng.interceptors.length; i++) OD.harness.step(1);
    return { advisory: say.pdCanStop, incoming: say.incoming, est: est.theirPdCanStop,
      stopped: sim.eng.stats.pdKills - kills0, aboard: sim.eng.stats.interceptorHits - hits0, text: say.text };
  });
  check('the salvo resolved', pd.incoming === 12 && pd.stopped + pd.aboard === 12, pd.stopped + ' stopped, ' + pd.aboard + ' aboard');
  check('the advisory does not promise more than the mounts manage', pd.advisory <= pd.stopped + 1, 'advisory ' + pd.advisory + ', stopped ' + pd.stopped);
  check('and it agrees with the salvo estimate', Math.abs(pd.advisory - pd.est) <= 1, 'advisory ' + pd.advisory + ', estimate ' + pd.est);

  console.log('scenario: the mount that was wrecked is the mount that goes quiet');
  const rack = await page.evaluate(() => {
    OD.harness.start(OD.Skirmish.build({ player: 'JC', env: 'deep', range: 300, playerShips: { cruiser: 1 }, enemyShips: { destroyer: 1 }, seed: 13 }));
    const sim = OD.Game.sim, E = OD.Engagement;
    const me = sim.playerShips()[0], foe = sim.nearestHostile(me);
    me.ai = false; sim.setTarget(me.id, foe.id); me.weaponsFree = true;
    const at = (kind) => me.mounts.map((m, i) => (m.kind === kind ? i : -1)).filter((i) => i >= 0);
    const beams = at('beam'), pds = at('pd');
    // A whole rack to start from: init adopts whatever the aggregates say, so clear them first.
    const fresh = () => { me.systems.drive = me.systems.radiators = me.systems.sensors = me.systems.weapons = 1; OD.Damage.init(me); };
    // How many mounts of one kind still answer, asked the way gunnery asks: the mount's place in
    // ship.mounts, with its place among its own kind behind it.
    const liveOf = (idx) => idx.filter((i, k) => E.shared.mountLive(me, k, idx.length, i)).length;
    const wreck = (kind) => { for (const c of me.components) if (c.mountKind === kind) c.hp = 0; OD.Damage.aggregate(me); };
    const read = () => ({
      beams: liveOf(beams), onBearing: E.shared.assess(sim, me).live,
      pd: E.pdReport(me), weapons: me.systems.weapons, mountHp: me.mountHp.slice(),
    });
    fresh();
    const whole = read();
    fresh(); wreck('beam');   // every beam component holed, nothing else touched
    const beamsOut = read();
    fresh(); wreck('pd');     // and the other way round: every point-defence mount holed
    const pdOut = read();
    fresh();
    return { beams: beams.length, pds: pds.length, whole, beamsOut, pdOut };
  });
  check('the cruiser carries beams and point defence', rack.beams > 0 && rack.pds > 0, rack.beams + ' beam mounts, ' + rack.pds + ' point-defence mounts');
  check('a whole rack has every mount answering', rack.whole.beams === rack.beams && rack.whole.pd.live === rack.pds,
    rack.whole.beams + '/' + rack.beams + ' beams, ' + rack.whole.pd.live + '/' + rack.pds + ' point defence');
  check('every beam component out silences every beam mount', rack.beamsOut.beams === 0 && rack.beamsOut.onBearing === 0,
    rack.beamsOut.beams + ' beam mounts live, mountHp ' + rack.beamsOut.mountHp.join(','));
  check('and takes nothing off point defence', rack.beamsOut.pd.live === rack.whole.pd.live && rack.beamsOut.pd.ratePerMin > 0,
    rack.beamsOut.pd.live + '/' + rack.pds + ' live, ' + rack.beamsOut.pd.ratePerMin.toFixed(2) + ' a minute');
  check('the display aggregate is not what decides it', rack.beamsOut.weapons > 0, 'systems.weapons ' + rack.beamsOut.weapons.toFixed(2));
  check('every point-defence component out leaves nothing to stop a salvo', rack.pdOut.pd.live === 0 && rack.pdOut.pd.ratePerMin === 0,
    rack.pdOut.pd.live + ' live, ' + rack.pdOut.pd.ratePerMin.toFixed(2) + ' a minute, mountHp ' + rack.pdOut.mountHp.join(','));
  check('and leaves every beam mount firing', rack.pdOut.beams === rack.beams && rack.pdOut.onBearing === rack.beams,
    rack.pdOut.beams + '/' + rack.beams + ' beam mounts live');

  console.log('scenario: a slug flies where the streak is drawn');
  const slug = await page.evaluate(() => {
    OD.harness.start(OD.Skirmish.build({ player: 'JC', env: 'deep', range: 330, playerShips: { destroyer: 1 }, enemyShips: { corvette: 1 }, seed: 7 }));
    const sim = OD.Game.sim;
    const me = sim.playerShips()[0], foe = sim.nearestHostile(me);
    for (const s of sim.ships) { s.ai = false; s.jink = false; s.cmdThrottle = 0; s.throttle = 0; s.order = { type: 'hold' }; }
    me.vel = { x: 400, y: 0 }; foe.vel = { x: 400, y: 0 }; // both coasting: the gun must cancel its own way on
    me.mounts = me.mounts.filter((m) => m.kind === 'coilgun'); foe.mounts = [];
    sim.setTarget(me.id, foe.id); me.weaponsFree = true;
    const first = new Map();
    for (let i = 0; i < 600; i++) {
      OD.harness.step(0.5);
      for (const s of sim.eng.slugs) {
        if (first.has(s.id)) continue;
        // both carried out to arrival: the round on its own velocity, the aim point on the one
        // the gun gave it. In deep space neither of them bends, so this is the streak against the
        // place the streak is for.
        first.set(s.id, Math.hypot(s.x + s.vx * s.t - (s.aim.x + s.aim.vx * s.t), s.y + s.vy * s.t - (s.aim.y + s.aim.vy * s.t)));
      }
    }
    const miss = [...first.values()];
    return { n: miss.length, worst: miss.length ? Math.max.apply(null, miss) : 0, length: me.length };
  });
  check('a slug carried out to its aim point lands on it', slug.n > 4 && slug.worst <= 2 * slug.length,
    slug.n + ' rounds, worst ' + Math.round(slug.worst) + ' m off a ' + slug.length + ' m muzzle offset');

  console.log('scenario: a slug in a gravity field (Io, chapter 4)');
  const fall = await page.evaluate(() => {
    // Io at 2 600 km, which is where chapter 4 is fought: 0.3 m/s² of pull, and a round in the air
    // for a minute and a half. Everything unpowered falls 1.2 km in that time, the hull included.
    const run = (dancing) => {
      OD.harness.start(OD.Skirmish.build({ player: 'JC', env: 'io', range: 400, playerShips: { destroyer: 1 }, enemyShips: { corvette: 1 }, seed: 7 }));
      const sim = OD.Game.sim, E = OD.Engagement;
      const me = sim.playerShips()[0], foe = sim.nearestHostile(me);
      for (const s of sim.ships) { s.ai = false; s.jink = false; s.cmdThrottle = 0; s.throttle = 0; s.order = { type: 'hold' }; }
      me.mounts = me.mounts.filter((m) => m.kind === 'coilgun'); foe.mounts = [];
      // either she is only falling, or she is spending propellant not to be where she was aimed at
      if (dancing) { foe.jink = true; foe.order = { type: 'evade', target: me.id }; }
      sim.setTarget(me.id, foe.id); me.weaponsFree = true; me.activeSensor = true;
      let seen = 0, said = 0, flight = 0;
      for (let i = 0; i < 400; i++) {
        OD.harness.step(1);
        for (const r of E.threats(sim, foe)) { if (r.kind !== 'slug') continue; seen++; if (r.willHit) said++; }
        for (const s of sim.eng.slugs) if (s.t > flight) flight = s.t;
        if (sim.eng.stats.slugHits + sim.eng.stats.slugMisses >= 8 || foe.destroyed || foe.disabled) break;
      }
      const g = sim.gravity(foe.pos);
      return { fired: sim.eng.stats.slugsFired, hits: sim.eng.stats.slugHits, misses: sim.eng.stats.slugMisses,
        seen, said, flight: Math.round(flight), window: 2 * foe.length, g: Math.hypot(g.x, g.y),
        fell: Math.round(0.5 * Math.hypot(g.x, g.y) * flight * flight) };
    };
    return { holding: run(false), dancing: run(true) };
  });
  console.log('    ' + fall.holding.g.toFixed(3) + ' m/s² of pull, ' + fall.holding.flight + ' s of flight: a coasting hull falls ' +
    fall.holding.fell + ' m out of a straight line, against a ' + fall.holding.window + ' m window');
  check('the guns have a solution in the field', fall.holding.fired > 0 && fall.holding.hits + fall.holding.misses > 0,
    fall.holding.fired + ' fired, ' + fall.holding.hits + ' hit, ' + fall.holding.misses + ' missed');
  check('a slug at a hull that is only falling arrives', fall.holding.hits > 0 && fall.holding.misses === 0,
    fall.holding.hits + ' hit, ' + fall.holding.misses + ' missed');
  check('and the board says so all the way in', fall.holding.seen > 0 && fall.holding.said === fall.holding.seen,
    fall.holding.said + ' of ' + fall.holding.seen + ' readings inbound');
  check('a hull that burns is still missed', fall.dancing.misses > 0, fall.dancing.hits + ' hit, ' + fall.dancing.misses + ' missed');

  console.log('scenario: the track the mounts are shooting at');
  const track = await page.evaluate(() => {
    OD.harness.start(OD.Skirmish.build({ player: 'JC', env: 'deep', range: 300, playerShips: { cruiser: 1 }, enemyShips: { destroyer: 1 }, seed: 17 }));
    const sim = OD.Game.sim, E = OD.Engagement;
    const me = sim.playerShips()[0], foe = sim.nearestHostile(me);
    // a still board: nobody burning, nobody shooting back, so only the track moves
    for (const s of sim.ships) { s.ai = false; s.jink = false; s.cmdThrottle = 0; s.throttle = 0; s.vel = { x: 0, y: 0 }; s.order = { type: 'hold' }; }
    // nothing fires: these are the estimates the panel prints, and a still board keeps them comparable
    sim.setTarget(me.id, foe.id); me.weaponsFree = false; foe.weaponsFree = false; foe.target = null;
    // nose on nose and holding, so the same mounts bear on the same facet at every reading
    me.heading = OD.U.angleOf(OD.U.sub(foe.pos, me.pos)); me.cmdHeading = me.heading; me.angVel = 0;
    foe.heading = OD.U.angleOf(OD.U.sub(me.pos, foe.pos)); foe.cmdHeading = foe.heading; foe.angVel = 0;
    const before = OD.Sensors;
    // a stand-in for the sensors module: every track is held at whatever quality we ask for
    const hold = (q) => { OD.Sensors = { init() {}, update() {}, quality: () => q, track: (s, f, t) => ({ q, word: 'track', posErr: 0, velErr: 0, est: { pos: t.pos, vel: t.vel } }), perceived: (s, o, t) => ({ pos: t.pos, vel: t.vel }) }; };
    const mount = E.shared.bestBeam(me);
    const soak = E.tuning.armourWatts * E.shared.armourCm(foe, 'nose');
    const read = () => {
      const R = OD.U.dist(me.pos, foe.pos);
      const note = (E.physicsNotes(me, foe) || []).find((n) => n.title === 'Track quality');
      return {
        R, spot: E.shared.beamShot(me, mount, R, 1, 1, foe).spot,
        through: E.shared.assess(sim, me).through,
        burn: E.shared.beamBurnRange(me, mount, soak, 1, foe),
        ladder: E.reach(sim, me, foe).beams.nose,
        wobble: E.shared.trackWobble(sim, me, foe),
        note: note ? note.body : null,
      };
    };
    // the track is set, then the sim steps, then the panel reads: a substep apart each time, so
    // every answer is worked out again rather than handed back from the substep before
    hold(3);
    OD.harness.step(0.5);
    const solution = read();
    hold(1.5);
    OD.harness.step(0.5);
    const fuzzy = read();
    OD.Sensors = undefined; // the module is not there at all
    OD.harness.step(0.5);
    const off = read();
    OD.Sensors = before;
    return { solution, fuzzy, off, jitter: E.tuning.trackJitter };
  });
  check('the range did not move under the test', Math.abs(track.fuzzy.R - track.solution.R) < 1 && Math.abs(track.off.R - track.solution.R) < 1,
    [track.solution.R, track.fuzzy.R, track.off.R].map((r) => Math.round(r)).join(' / ') + ' m');
  check('a contact widens the spot a solution would hold', track.fuzzy.spot > track.solution.spot,
    'q 3 ' + track.solution.spot.toFixed(1) + ' m, q 1.5 ' + track.fuzzy.spot.toFixed(1) + ' m at ' + Math.round(track.solution.R / 1000) + ' km');
  check('the wobble is 1 + trackJitter·(3 − q)', Math.abs(track.fuzzy.wobble - (1 + track.jitter * 1.5)) < 1e-9 && track.solution.wobble === 1,
    'q 1.5 → ×' + track.fuzzy.wobble.toFixed(3) + ', q 3 → ×' + track.solution.wobble.toFixed(3));
  check('and takes the energy on target with it', track.fuzzy.through < track.solution.through,
    'q 3 ' + track.solution.through.toExponential(2) + ' W, q 1.5 ' + track.fuzzy.through.toExponential(2) + ' W');
  check('the burn-through range shortens with the track', track.fuzzy.burn < track.solution.burn && track.fuzzy.ladder < track.solution.ladder,
    'q 3 ' + Math.round(track.solution.ladder / 1000) + ' km, q 1.5 ' + Math.round(track.fuzzy.ladder / 1000) + ' km');
  check('the physics panel carries the track quality', /q = 1\.5/.test(track.fuzzy.note || '') && /×5\.5/.test(track.fuzzy.note || ''),
    (track.fuzzy.note || '—').split('\n')[1]);
  check('with no sensors module every hull is a solution', track.off.spot === track.solution.spot && track.off.through === track.solution.through && track.off.ladder === track.solution.ladder,
    'spot ' + track.off.spot.toFixed(1) + ' m, ladder ' + Math.round(track.off.ladder / 1000) + ' km');

  console.log('scenario: no solution, no slugs');
  const slugs = await page.evaluate(() => {
    const before = OD.Sensors;
    // q null is the module gone; vel is the velocity the track reports, so a wrong one leads wide
    const run = (q, vel) => {
      OD.harness.start(OD.Skirmish.build({ player: 'JC', env: 'deep', range: 330, playerShips: { destroyer: 1 }, enemyShips: { corvette: 1 }, seed: 7 }));
      const sim = OD.Game.sim, E = OD.Engagement;
      const me = sim.playerShips()[0], foe = sim.nearestHostile(me);
      for (const s of sim.ships) { s.ai = false; s.jink = false; s.cmdThrottle = 0; s.throttle = 0; s.vel = { x: 0, y: 0 }; s.order = { type: 'hold' }; }
      me.mounts = me.mounts.filter((m) => m.kind === 'coilgun'); foe.mounts = [];
      sim.setTarget(me.id, foe.id); me.weaponsFree = true;
      OD.Sensors = q === null ? undefined : {
        init() {}, update() {}, quality: () => q,
        track: (s, f, t) => ({ q, word: 'track', posErr: 0, velErr: 0, est: { pos: t.pos, vel: vel ? { x: t.vel.x + vel.x, y: t.vel.y + vel.y } : t.vel } }),
        perceived: (s, o, t) => ({ pos: t.pos, vel: t.vel }),
      };
      let first = null;
      for (let i = 0; i < 80; i++) {
        OD.harness.step(0.5);
        // the aim point carried out to arrival, which is the place the lead actually names
        if (!first && sim.eng.slugs.length) { const s = sim.eng.slugs[0]; first = { x: s.aim.x + s.aim.vx * s.t, y: s.aim.y + s.aim.vy * s.t, t: s.t }; }
      }
      const row = (E.shipReadout(me) || []).find((r) => r.label === 'Slugs left');
      const note = (E.physicsNotes(me, foe) || []).find((n) => n.title === 'Track quality');
      return { fired: sim.eng.stats.slugsFired, row: row ? row.value : '', reason: E.shared.slugReason(sim, me, foe), first, note: note ? note.body : '' };
    };
    const solution = run(3), just = run(2.8), under = run(2.4), contact = run(1), off = run(null);
    const wide = run(3, { x: 200, y: 0 });
    OD.Sensors = before;
    return { solution, just, under, contact, off, wide, q: OD.Engagement.tuning.slugSolutionQ };
  });
  check('a solution puts rounds in the air', slugs.solution.fired > 0 && !/no solution/.test(slugs.solution.row), slugs.solution.fired + ' fired · ' + slugs.solution.row);
  check('and a track just above the threshold still does', slugs.just.fired === slugs.solution.fired, slugs.just.fired + ' fired at q 2.8');
  check('below ' + slugs.q + ' the coilguns hold', slugs.under.fired === 0 && slugs.contact.fired === 0, 'q 2.4 ' + slugs.under.fired + ' fired, q 1 ' + slugs.contact.fired + ' fired');
  check('and the readout says no solution', /no solution/.test(slugs.under.row) && slugs.under.reason === 'no solution', slugs.under.row);
  check('the physics panel says what it would take', /below q 2\.7/.test(slugs.under.note), (slugs.under.note || '—').split('\n').pop());
  check('with no sensors module the rounds fly as before', slugs.off.fired === slugs.solution.fired && !/no solution/.test(slugs.off.row), slugs.off.fired + ' fired · ' + slugs.off.row);
  check('the aim point follows the track’s velocity, not the truth',
    slugs.wide.first && slugs.solution.first && Math.abs(Math.hypot(slugs.wide.first.x - slugs.solution.first.x, slugs.wide.first.y - slugs.solution.first.y) - 200 * slugs.wide.first.t) < 0.25 * 200 * slugs.wide.first.t,
    slugs.wide.first ? Math.round(Math.hypot(slugs.wide.first.x - slugs.solution.first.x, slugs.wide.first.y - slugs.solution.first.y) / 1000) + ' km of lead error on a 200 m/s estimate over ' + Math.round(slugs.wide.first.t) + ' s' : 'no round in the air');

  console.log('scenario: no solution, no beams either');
  const beams = await page.evaluate(() => {
    const before = OD.Sensors;
    // Nothing but mirrors aboard and nothing shooting back, so the only thing in the sink is what
    // the beams put there. `tight` is the control: the same hull with gunnery forbidden to fire.
    const run = (q, tight) => {
      OD.harness.start(OD.Skirmish.build({ player: 'JC', env: 'deep', range: 330, playerShips: { destroyer: 1 }, enemyShips: { corvette: 1 }, seed: 7 }));
      const sim = OD.Game.sim, E = OD.Engagement;
      const me = sim.playerShips()[0], foe = sim.nearestHostile(me);
      // Panels in on both hulls, so nothing is shed and the sink is an honest tally of what the
      // mirrors drew: a held mount must leave it reading exactly what gunnery tight reads.
      for (const s of sim.ships) { s.ai = false; s.jink = false; s.cmdThrottle = 0; s.throttle = 0; s.vel = { x: 0, y: 0 }; s.order = { type: 'hold' }; s.heat = 0; s.radiators.deployed = false; s.radiators.state = 0; s.radiators.auto = false; }
      me.mounts = me.mounts.filter((m) => m.kind === 'beam'); foe.mounts = [];
      me.heading = OD.U.angleOf(OD.U.sub(foe.pos, me.pos)); me.cmdHeading = me.heading; me.angVel = 0;
      sim.setTarget(me.id, foe.id); me.weaponsFree = !tight;
      OD.Sensors = {
        init() {}, update() {}, quality: () => q,
        track: (s, f, t) => ({ q, word: 'track', posErr: 0, velErr: 0, est: { pos: t.pos, vel: t.vel } }),
        perceived: (s, o, t) => ({ pos: t.pos, vel: t.vel }),
      };
      let drawn = 0;
      for (let i = 0; i < 60; i++) { OD.harness.step(0.5); drawn = Math.max(drawn, sim.eng.beams.length); }
      const st = E.shared.stateOf(me);
      const rows = E.shipReadout(me) || [];
      const row = rows.find((r) => r.label === 'Status');
      return { drawn, firing: st.firing, heat: me.heat, hull: foe.hull, reason: st.reason,
        status: row ? row.value : '', onTarget: rows.some((r) => r.label === 'On target') };
    };
    const solution = run(3), held = run(2), tight = run(2, true);
    OD.Sensors = before;
    return { solution, held, tight, q: OD.Engagement.tuning.slugSolutionQ, sensorQ: (before && before.T && before.T.solutionQ) || null };
  });
  check('the beams’ threshold is the sensor module’s own word for a solution', beams.q === 2.7 && beams.sensorQ === 2.7,
    'slugSolutionQ ' + beams.q + ', Sensors.T.solutionQ ' + beams.sensorQ);
  check('a solution lights the mirrors', beams.solution.drawn > 0 && beams.solution.firing > 0 && beams.solution.heat > beams.tight.heat,
    beams.solution.firing + ' mounts firing · sink ' + (beams.solution.heat / 1e9).toFixed(2) + ' GJ against ' + (beams.tight.heat / 1e9).toFixed(2) + ' GJ held');
  check('below ' + beams.q + ' the beams hold as the coilguns do', beams.held.drawn === 0 && beams.held.firing === 0,
    'q 2 · ' + beams.held.drawn + ' beams drawn, ' + beams.held.firing + ' mounts firing');
  check('and put nothing on target', beams.held.hull === beams.tight.hull && beams.solution.hull <= beams.held.hull,
    'hull ' + beams.held.hull.toFixed(3) + ' held, ' + beams.solution.hull.toFixed(3) + ' on a solution');
  check('while drawing no power and adding no heat', Math.abs(beams.held.heat - beams.tight.heat) < 1,
    'sink ' + (beams.held.heat / 1e9).toFixed(4) + ' GJ against ' + (beams.tight.heat / 1e9).toFixed(4) + ' GJ with gunnery tight');
  check('and the readout says no solution', beams.held.reason === 'no solution' && beams.held.status === 'no solution' && !beams.held.onTarget,
    beams.held.status + (beams.held.onTarget ? ' · but an On target row is still shown' : ''));

  console.log('scenario: out of burn-through range, the beams hold');
  const burn = await page.evaluate(() => {
    const before = OD.Sensors;
    // A solution on her and the sink cold, so the only thing on trial is the burn-through range:
    // outside it every joule stops in her armour and the mounts have nothing to buy with the heat.
    const run = (rangeKm, aim, rads) => {
      OD.harness.start(OD.Skirmish.build({ player: 'JC', env: 'deep', range: rangeKm, playerShips: { corvette: 1 }, enemyShips: { corvette: 1 }, seed: 4 }));
      const sim = OD.Game.sim, E = OD.Engagement, U = OD.U;
      const me = sim.playerShips()[0], foe = sim.nearestHostile(me);
      for (const s of sim.ships) { s.ai = false; s.jink = false; s.cmdThrottle = 0; s.throttle = 0; s.order = { type: 'hold' }; s.vel = { x: 0, y: 0 }; s.heat = 0; s.radiators.auto = false; s.radiators.deployed = true; s.radiators.state = 1; }
      foe.mounts = []; foe.weaponsFree = false; foe.target = null;
      foe.radiators.state = rads ? 1 : 0; foe.radiators.deployed = !!rads;
      me.heading = U.angleOf(U.sub(foe.pos, me.pos)); me.cmdHeading = me.heading; me.angVel = 0;
      sim.setTarget(me.id, foe.id); me.weaponsFree = true; me.activeSensor = true;
      if (aim) E.setAim(me, aim);
      OD.Sensors = {
        init() {}, update() {}, quality: () => 3,
        track: (s, f, t) => ({ q: 3, word: 'track', posErr: 0, velErr: 0, est: { pos: t.pos, vel: t.vel } }),
        perceived: (s, o, t) => ({ pos: t.pos, vel: t.vel }),
      };
      const heat0 = me.heat;
      let drawn = 0;
      for (let i = 0; i < 30; i++) { OD.harness.step(1); drawn = Math.max(drawn, sim.eng.beams.length); }
      const st = E.shared.stateOf(me);
      const r = E.reach(sim, me, foe);
      const rows = E.shipReadout(me) || [];
      const row = (label) => rows.find((x) => x.label === label) || {};
      return {
        reason: st.reason, drawn, firing: st.firing, heat: me.heat - heat0, through: st.through,
        range: U.dist(me.pos, foe.pos), ladder: r.beams[OD.Render.facetShown(me, foe)],
        status: row('Status').value, statusTip: row('Status').tip || '', onTargetTip: row('On target').tip || '',
        aimUsed: E.shared.aimEffective(me, foe),
        foeRads: (foe.components || []).filter((c) => c.kind === 'radiator').map((c) => +c.hp.toFixed(3)),
        foeHull: foe.hull,
        ladderNote: ((E.physicsNotes(me, foe) || []).find((n) => /Burn-through/.test(n.title)) || {}).body || '',
        throttle: JSON.parse(JSON.stringify(E.shared.throttleFacets(me, foe) || {})),
      };
    };
    const outside = run(600, null, false), inside = run(100, null, false),
      panels = run(600, 'radiators', true), panelsIn = run(100, 'radiators', true);
    OD.Sensors = before;
    return { outside, inside, panels, panelsIn };
  });
  check('outside the burn-through range the beams hold', burn.outside.range > burn.outside.ladder && burn.outside.drawn === 0 && burn.outside.firing === 0,
    Math.round(burn.outside.range / 1000) + ' km against a ' + Math.round(burn.outside.ladder / 1000) + ' km burn-through range, ' + burn.outside.drawn + ' beams drawn');
  check('and the readout says the range it is waiting for', /^holding: out of burn-through range \(/.test(burn.outside.reason) && burn.outside.status === burn.outside.reason, burn.outside.status || '—');
  check('and nothing goes into the sink for it', burn.outside.heat < burn.inside.heat * 0.5,
    Math.round(burn.outside.heat / 1e6) + ' MJ holding against ' + Math.round(burn.inside.heat / 1e6) + ' MJ firing');
  check('inside it they fire as before', burn.inside.drawn > 0 && burn.inside.firing > 0 && !burn.inside.reason,
    burn.inside.firing + ' mounts firing at ' + Math.round(burn.inside.range / 1000) + ' km');
  // The aim point buys no range. Her panels hang outside the hull, but fireBeams soaks the facet's
  // armour whatever the mounts are aimed at, so an aim that fired outside the burn-through range
  // put nothing through and spent the sink doing it.
  check('aiming at her extended panels buys no range, so the beams hold there too',
    burn.panels.aimUsed === 'radiators' && burn.panels.firing === 0 && burn.panels.drawn === 0 &&
      /^holding: (out of burn-through range|her .* armour is too thick)/.test(burn.panels.reason),
    burn.panels.reason || burn.panels.firing + ' mounts firing at ' + Math.round(burn.panels.range / 1000) + ' km');
  check('and the panel prints the range the hold is waiting for',
    burn.panels.status === burn.panels.reason && burn.panels.reason.indexOf(Math.round(burn.panels.ladder / 1000) + '') > 0,
    burn.panels.status + ' against a ' + Math.round(burn.panels.ladder / 1000) + ' km ladder');
  check('and her panels are untouched and the sink paid nothing for it',
    burn.panels.through === 0 && burn.panels.foeRads.every((hp) => hp === 1) && burn.panels.heat < burn.inside.heat * 0.5,
    'panels ' + burn.panels.foeRads.join('/') + ', ' + Math.round(burn.panels.through / 1e3) + ' kW through, ' +
      Math.round(burn.panels.heat / 1e6) + ' MJ into the sink against ' + Math.round(burn.inside.heat / 1e6) + ' MJ firing');
  check('inside the range that aim fires and lands on the panels',
    burn.panelsIn.aimUsed === 'radiators' && burn.panelsIn.firing > 0 && !burn.panelsIn.reason && burn.panelsIn.through > 0,
    burn.panelsIn.reason || burn.panelsIn.firing + ' mounts firing at ' + Math.round(burn.panelsIn.range / 1000) +
      ' km, ' + Math.round(burn.panelsIn.through / 1e3) + ' kW through, panels ' + burn.panelsIn.foeRads.join('/'));
  // R-4: the drive is why the burn-through range moves while nothing else has changed.
  // The ship is coasting in this scenario, so the note prints the other end of the throttle only.
  const cold = burn.outside.throttle.cold || {}, hot = burn.outside.throttle.full || {};
  check('the physics screen says what the throttle does to the burn-through range',
    /at full throttle: nose /.test(burn.outside.ladderNote) && !/with our drive cold:/.test(burn.outside.ladderNote) &&
      /the drive shakes the mirror, so the pointing error is \u00d73 at full throttle/.test(burn.outside.ladderNote),
    (burn.outside.ladderNote.split('\n').find((l) => /at full throttle:/.test(l)) || '\u2014'));
  check('and the ranges it prints are a third to a half of the coasting ones',
    hot.nose > cold.nose * 0.3 && hot.nose < cold.nose * 0.6 && hot.flank > cold.flank * 0.3 && hot.flank < cold.flank * 0.6,
    'nose ' + Math.round(cold.nose / 1000) + ' \u2192 ' + Math.round(hot.nose / 1000) + ' km, flank ' +
      Math.round(cold.flank / 1000) + ' \u2192 ' + Math.round(hot.flank / 1000) + ' km');
  const throttleSaid = (t) => /At full throttle the pointing error is 3 times as wide, so the beams burn through at a third to a half of the range/.test(t || '');
  check('and the fire-control rows carry the same sentence',
    throttleSaid(burn.outside.statusTip) && throttleSaid(burn.inside.onTargetTip),
    burn.outside.status + ' \u00b7 tip: ' + burn.outside.statusTip.slice(-120));

  console.log('scenario: the fire mode row says what the sink is about to do');
  const sinkRow = await page.evaluate(() => {
    // The panel's Forecast row and the fire mode row sit in the same layout. They disagreed: the
    // forecast read 'settles near 17%' beside a fire mode row whose value was the fixed label
    // 'full · sink fills', with tFull null and the beams holding out of burn-through range.
    OD.harness.start(OD.Skirmish.build({ player: 'JC', env: 'deep', range: 600, playerShips: { corvette: 1 }, enemyShips: { corvette: 1 }, seed: 6 }));
    const sim = OD.Game.sim, E = OD.Engagement, U = OD.U, P = OD.P;
    const me = sim.playerShips()[0], foe = sim.nearestHostile(me);
    for (const s2 of sim.ships) { s2.ai = false; s2.jink = false; s2.cmdThrottle = 0; s2.throttle = 0; s2.order = { type: 'hold' }; s2.vel = { x: 0, y: 0 }; }
    foe.mounts = []; foe.weaponsFree = false; foe.target = null;
    me.heading = U.angleOf(U.sub(foe.pos, me.pos)); me.cmdHeading = me.heading; me.angVel = 0;
    sim.setTarget(me.id, foe.id); me.weaponsFree = true; me.activeSensor = true;
    me.radiators.auto = false; me.radiators.deployed = true; me.radiators.state = 1;
    E.setFireMode(me, 'full');
    const row = () => ((E.shipReadout(me) || []).find((x) => x.label === 'Fire mode') || {}).value || '';
    const forecast = () => {
      const drive = me.throttle > 0 ? me.driveHeat * me.throttle * me.systems.drive : 0;
      const pin = me.idleHeat + drive + (me.lastExtraHeat || 0);
      return P.sinkForecast(me.heat, me.sinkCapacity, me.radiatorRating(), pin, 3600, me.radiatorTemp);
    };
    const out = {};
    for (let i = 0; i < 60; i++) OD.harness.step(1);
    const f1 = forecast();
    out.hold = E.shared.stateOf(me).reason;
    out.settleRow = row(); out.settle = f1.settle; out.settleFull = f1.tFull; out.load = me.thermalLoad();
    // panels in: nothing sheds it, so the same mode reads as a sink that fills
    me.radiators.deployed = false; me.radiators.state = 0;
    for (let i = 0; i < 30; i++) OD.harness.step(1);
    const f2 = forecast();
    out.fillRow = row(); out.fillFull = f2.tFull; out.fillSettle = f2.settle;
    out.net = me.idleHeat + (me.lastExtraHeat || 0) - me.radiatorPower();
    E.setFireMode(me, 'hold'); out.holdRow = row();
    return out;
  });
  const sinkPct = (v) => { const m = /(\d+) %/.exec(v || ''); return m ? +m[1] : null; };
  check('the row is a live forecast, not a fixed label', !/sink fills$/.test(sinkRow.settleRow) && /^full · the sink /.test(sinkRow.settleRow),
    sinkRow.settleRow + ' (beams ' + (sinkRow.hold || 'firing') + ')');
  check('and with the radiators holding it, it says where the sink settles',
    sinkRow.settleFull == null && sinkRow.settle != null &&
      sinkRow.settleRow === 'full · the sink settles at ' + Math.round(sinkRow.settle * 100) + ' %',
    sinkRow.settleRow + ' against a forecast of ' + Math.round((sinkRow.settle || 0) * 100) + ' % (tFull ' + String(sinkRow.settleFull) + ')');
  check('and with the panels stowed, the same mode says when it fills',
    /^full · the sink fills in /.test(sinkRow.fillRow) && sinkRow.net > 0,
    sinkRow.fillRow + ' at ' + Math.round(sinkRow.net / 1e6) + ' MW net in');
  check('and held beams still read as cold', sinkRow.holdRow === 'held · beams cold', sinkRow.holdRow);

  console.log('scenario: no track, no salvo');
  const bays = await page.evaluate(() => {
    const before = OD.Sensors;
    const sensors = (q) => { OD.Sensors = q === null ? undefined : { init() {}, update() {}, quality: () => q, track: (s, f, t) => ({ q, word: 'track', posErr: 0, velErr: 0, est: { pos: t.pos, vel: t.vel } }), perceived: (s, o, t) => ({ pos: t.pos, vel: t.vel }) }; };
    const run = (q) => {
      OD.harness.start(OD.Skirmish.build({ player: 'JC', env: 'deep', range: 306, playerShips: { lancer: 1 }, enemyShips: { destroyer: 1 }, seed: 9 }));
      const sim = OD.Game.sim, E = OD.Engagement;
      const me = sim.playerShips()[0], foe = sim.nearestHostile(me);
      for (const s of sim.ships) { s.ai = false; s.jink = false; s.cmdThrottle = 0; s.throttle = 0; s.order = { type: 'hold' }; }
      sim.setTarget(me.id, foe.id); me.weaponsFree = true;
      sensors(q);
      const est = E.salvoEstimate(sim, me, foe, 2);
      const act = (E.panelActions(me) || []).find((a) => a.id === 'launch2');
      const launched = E.salvo(sim, me, 2);
      return { launched, reason: est.reason, flight: est.flightTime, darts: sim.eng.interceptors.length, tip: act ? act.tip : '' };
    };
    // and the computer's own launch decision, on the same numbers
    const ai = (q) => {
      OD.harness.start(OD.Skirmish.build({ player: 'JC', env: 'deep', range: 400, playerShips: { destroyer: 1 }, enemyShips: { lancer: 1 }, seed: 21 }));
      const sim = OD.Game.sim;
      sensors(q);
      for (let i = 0; i < 400; i++) OD.harness.step(1);
      return sim.eng.stats.interceptorsLaunched;
    };
    const out = { under: run(1.9), at: run(2), off: run(null), aiSolution: ai(3), aiContact: ai(1) };
    OD.Sensors = before;
    return out;
  });
  check('below a track of 2 the bays hold', bays.under.launched === 0 && bays.under.darts === 0, bays.under.launched + ' away, ' + bays.under.darts + ' in the sky');
  check('and the estimate says why', bays.under.reason === 'no track' && bays.under.flight > 0, bays.under.reason + ', ' + Math.round(bays.under.flight || 0) + ' s of flight');
  check('the panel button carries the reason', /no track/.test(bays.under.tip), bays.under.tip.slice(0, 90));
  check('a track of 2 launches', bays.at.launched === 2 && bays.at.darts === 2 && bays.at.reason === '', bays.at.launched + ' away');
  check('with no sensors module the bays launch as before', bays.off.launched === 2 && bays.off.reason === '', bays.off.launched + ' away');
  check('the computer launches on a solution', bays.aiSolution > 0, bays.aiSolution + ' launched');
  check('and holds its bays on a contact', bays.aiContact === 0, bays.aiContact + ' launched');

  console.log('scenario: the fleet\'s bays — one hull on the computer, one under the player\'s hand');
  const fleet = await page.evaluate(() => {
    OD.harness.start(OD.Skirmish.build({ player: 'JC', env: 'deep', range: 306, playerShips: { lancer: 2 }, enemyShips: { destroyer: 1 }, seed: 9 }));
    const sim = OD.Game.sim, E = OD.Engagement;
    const own = sim.playerShips();
    const auto = own[0], hand = own[1];
    const foe = sim.nearestHostile(auto);
    // A still board: nobody manoeuvring, nothing shooting back, and our two hulls carry bays and
    // nothing else — what is on trial is which of them opens them, not what else they could do.
    for (const s of sim.ships) { s.ai = false; s.jink = false; s.cmdThrottle = 0; s.throttle = 0; s.vel = { x: 0, y: 0 }; s.order = { type: 'hold' }; }
    for (const s of [auto, hand]) { s.mounts = s.mounts.filter((m) => m.kind === 'launcher'); delete s.mountHp; }
    foe.weaponsFree = false; foe.target = null;
    sim.setTarget(auto.id, foe.id); sim.setTarget(hand.id, foe.id);
    auto.weaponsFree = true; hand.weaponsFree = true;
    // The shell's flag: every player ship that is weapons free and is not the one being commanded
    // carries autoBays (Game.handBays), and the one on the panel does not.
    auto.autoBays = true; hand.autoBays = false;
    E.setAim(auto, 'mounts'); E.setAim(hand, 'mounts');   // the aim card's word, on both of them
    const bay0 = { auto: E.shared.bayCount(auto), hand: E.shared.bayCount(hand) };
    const t0 = sim.log.length;
    const out = { range: OD.U.dist(auto.pos, foe.pos), reach: E.shared.aiLaunchRange(auto), bay0, gap: E.tuning.salvoGap };
    // Half the gap: neither hull has had a window yet. The clock is turned by hand because
    // harness.step runs Game.handBays(), which would set autoBays from the selection instead.
    for (let i = 0; i < 75; i++) sim.step(1);
    out.early = { auto: E.shared.bayCount(auto), hand: E.shared.bayCount(hand) };
    for (let i = 0; i < 125; i++) sim.step(1);   // 200 s: past the doctrine's 150 s window
    const lines = sim.log.slice(t0).filter((l) => l.speaker === 'Gunnery' && /the computer launched/.test(l.text));
    out.bay1 = { auto: E.shared.bayCount(auto), hand: E.shared.bayCount(hand) };
    out.flying = { auto: sim.eng.interceptors.filter((it) => it.from === auto).length, hand: sim.eng.interceptors.filter((it) => it.from === hand).length };
    out.forAuto = lines.filter((l) => l.text.indexOf(auto.name + ': the computer launched ') === 0 && l.text.indexOf(' at ' + foe.name) > 0).length;
    out.forHand = lines.filter((l) => l.text.indexOf(hand.name + ':') === 0).length;
    out.line = (lines[0] || {}).text || '';
    out.aim = { auto: E.aim(auto), hand: E.aim(hand) };
    // and the panel still answers on the hull the computer is flying
    out.byHand = E.salvo(sim, auto, 2);
    out.names = [auto.name, hand.name, foe.name];
    return out;
  });
  check('both hulls are inside the doctrine\'s launch reach', fleet.range < fleet.reach, Math.round(fleet.range / 1000) + ' km of ' + Math.round(fleet.reach / 1000) + ' km');
  check('neither hull launches before the window', fleet.early.auto === fleet.bay0.auto && fleet.early.hand === fleet.bay0.hand,
    'at ' + Math.round(fleet.gap / 2) + ' s: ' + fleet.early.auto + '/' + fleet.early.hand + ' aboard of ' + fleet.bay0.auto + '/' + fleet.bay0.hand);
  check('the hull on the computer has launched inside the window', fleet.bay1.auto < fleet.bay0.auto && fleet.flying.auto > 0,
    fleet.names[0] + ': ' + fleet.bay0.auto + ' aboard → ' + fleet.bay1.auto + ', ' + fleet.flying.auto + ' in the sky');
  check('the hull under the player\'s hand has not', fleet.bay1.hand === fleet.bay0.hand && fleet.flying.hand === 0,
    fleet.names[1] + ': ' + fleet.bay0.hand + ' aboard → ' + fleet.bay1.hand + ', ' + fleet.flying.hand + ' in the sky');
  check('and the log says who opened the bays', fleet.forAuto === 1 && fleet.forHand === 0, fleet.line || 'no line');
  check('and takes nothing but her bays: the aim card\'s word still stands', fleet.aim.auto === 'mounts' && fleet.aim.hand === 'mounts', fleet.aim.auto + ' / ' + fleet.aim.hand);
  check('and the panel still empties her rails by hand', fleet.byHand === 2, fleet.byHand + ' away on the panel\'s word');

  console.log('scenario: on a hull of ours the computer opens the bays and nothing else');
  const gunner = await page.evaluate(() => {
    OD.harness.start(OD.Skirmish.build({ player: 'JC', env: 'deep', range: 300, playerShips: { destroyer: 1, corvette: 1 }, enemyShips: { destroyer: 1 }, seed: 5 }));
    const sim = OD.Game.sim, E = OD.Engagement;
    const auto = sim.playerShips()[1];            // the hull the player is not commanding
    const foe = sim.nearestHostile(auto);
    for (const s of sim.ships) { s.jink = false; s.cmdThrottle = 0; s.throttle = 0; s.vel = { x: 0, y: 0 }; s.order = { type: 'hold' }; }
    sim.setTarget(auto.id, foe.id); auto.weaponsFree = true; auto.ai = false; auto.autoBays = true;
    // and a hostile with her beams on our panels: the computer's own reason to want them in
    sim.setTarget(foe.id, auto.id); foe.weaponsFree = true; foe.ai = true;
    foe.mounts = foe.mounts.filter((m) => m.kind === 'beam' || m.kind === 'pd'); delete foe.mountHp;
    E.setAim(foe, 'radiators');
    // the bridge's answers: panels out, beams cold, and the aim card's word on her mounts
    sim.setRadiators(auto.id, true);
    E.setFireMode(auto, 'hold');
    E.setAim(auto, 'mounts');
    const out = { out0: !!auto.radiators.deployed, mode0: E.fireMode(auto), aim0: E.aim(auto) };
    for (let i = 0; i < 120; i++) sim.step(1);   // the clock by hand: this scenario sets autoBays itself
    out.deployed = !!auto.radiators.deployed; out.state = auto.radiators.state;
    out.mode = E.fireMode(auto); out.aim = E.aim(auto); out.firing = E.shared.stateOf(auto).firing;
    return out;
  });
  check('the panels, the beams and the aim the bridge set all stay set on an autoBays hull',
    gunner.out0 && gunner.deployed && gunner.mode === 'hold' && !gunner.firing && gunner.aim === 'mounts',
    'panels ' + (gunner.deployed ? 'out' : 'in') + ' at ' + gunner.state.toFixed(2) + ' · fire mode ' + gunner.mode0 + ' → ' + gunner.mode +
      ' · aim ' + gunner.aim0 + ' → ' + gunner.aim);

  console.log('scenario: the fire-control row with nothing on the plot');
  const idle = await page.evaluate(() => {
    OD.harness.start(OD.Skirmish.build({ player: 'JC', env: 'deep', range: 300, playerShips: { corvette: 1 }, enemyShips: { corvette: 1 }, seed: 3 }));
    const sim = OD.Game.sim, E = OD.Engagement;
    const me = sim.playerShips()[0];
    me.target = null;
    const row = (s) => ((E.shipReadout(s) || []).find((r) => r.label === 'Beams in arc') || {}).value || '';
    const clean = row(me);
    // and the same row on a hull that really has lost the mount
    const bi = me.mounts.findIndex((m) => m.kind === 'beam');
    if (me.mountHp) me.mountHp[bi] = 0; else me.systems.weapons = 0;
    return { clean, hurt: row(me) };
  });
  check('an undamaged hull with no target says no target', /no target/.test(idle.clean) && !/wrecked/.test(idle.clean), idle.clean);
  check('and only a wrecked mount reads as wrecked', /1 wrecked/.test(idle.hurt), idle.hurt);

  console.log('scenario: the bridge hears its own fire');
  const ours = await page.evaluate(() => {
    OD.harness.start(OD.Skirmish.build({ player: 'JC', env: 'deep', range: 120, playerShips: { destroyer: 1 }, enemyShips: { corvette: 1 }, seed: 5 }));
    const sim = OD.Game.sim, E = OD.Engagement;
    const me = sim.playerShips()[0], foe = sim.nearestHostile(me);
    for (const s of sim.ships) { s.ai = false; s.jink = false; s.cmdThrottle = 0; s.throttle = 0; s.order = { type: 'hold' }; }
    foe.mounts = foe.mounts.filter((m) => m.kind === 'pd'); // she stops darts, she does not shoot back
    sim.setTarget(me.id, foe.id); me.weaponsFree = true; me.activeSensor = true;
    const t0 = sim.log.length, t1 = sim.time;
    E.salvo(sim, me, 4);
    for (let i = 0; i < 200 && !foe.destroyed; i++) OD.harness.step(1);
    const landed = (l) => l.speaker === 'Gunnery' && /(beams through|slug through|slugs through|armour held|aboard|point defence stopped)/.test(l.text);
    const lines = sim.log.slice(t0).filter(landed);
    const mine = lines.filter((l) => l.text.indexOf(me.name + ':') === 0);
    let gap = Infinity;
    for (let i = 1; i < mine.length; i++) gap = Math.min(gap, mine[i].t - mine[i - 1].t);
    // Our beams are reported once and in one shape: the joules they put through, once a minute,
    // per hull. The old number-free 'beams through her nose' line covered the same beams on
    // another window and disagreed with it on the facet six seconds later.
    const beamLines = mine.filter((l) => /beams/.test(l.text));
    const roll = sim.log.slice(t0).filter((l) => l.speaker === 'Gunnery' && / put .* through .* this minute\./.test(l.text));
    // The window closes early once for each hull: when she goes out of the fight, so the last
    // minute of joules is said before the cease-fire and not twenty seconds after it.
    const gone = sim.log.slice(t0).find((l) => /is out of the fight|has come apart/.test(l.text));
    const inFight = gone ? roll.filter((l) => l.t < gone.t) : roll;
    let rollGap = Infinity;
    for (let i = 1; i < inFight.length; i++) rollGap = Math.min(rollGap, inFight[i].t - inFight[i - 1].t);
    const held = sim.log.slice(t0).find((l) => /Holding fire\./.test(l.text));
    const cease = held || gone;
    return {
      mine: mine.map((l) => Math.round(l.t) + 's ' + l.text), gap,
      theirs: lines.filter((l) => l.text.indexOf(foe.name + ':') === 0).length,
      beams: beamLines.map((l) => Math.round(l.t) + 's ' + l.text),
      roll: roll.map((l) => Math.round(l.t) + 's ' + l.text), rollGap, first: roll.length ? roll[0].t - t1 : Infinity,
      named: roll.every((l) => l.text.indexOf(me.name) === 0 && l.text.indexOf(foe.name) > 0 && /kJ|MJ|GJ/.test(l.text)),
      cease: cease ? Math.round(cease.t) + 's ' + cease.text : '',
      afterCease: cease ? roll.filter((l) => l.t > cease.t).map((l) => Math.round(l.t) + 's ' + l.text) : [],
    };
  });
  check('our own hits reach the log', ours.mine.length > 0, ours.mine.slice(0, 2).join(' | '));
  check('and no more than one line every 20 s from one hull', !(ours.gap < 20), 'closest pair ' + (isFinite(ours.gap) ? ours.gap + ' s' : 'only one line'));
  check('our beams get no number-free line of their own', ours.beams.length === 0,
    ours.beams.slice(0, 2).join(' | ') || 'no \'beams through\' lines');
  check('the joules our beams put through are rolled up once a minute', ours.roll.length > 0 && ours.named && !(ours.rollGap < 60),
    ours.roll.slice(0, 2).join(' | ') || 'no lines');
  check('and the last minute of them is said before the mounts are told to stop',
    !!ours.cease && ours.afterCease.length === 0,
    (ours.cease || 'nothing stopped the firing') + (ours.afterCease.length ? ' then ' + ours.afterCease.join(' | ') : ''));
  check('a point-defence kill is a line on either side', ours.theirs > 0, ours.theirs + ' lines from the hull doing the intercepting');
  console.log('    ' + (ours.mine.slice(0, 4).join('\n    ') || 'no lines'));

  console.log('scenario: the bridge hears the beams landing on it');
  const under = await page.evaluate(() => {
    const U = OD.U;
    // Her beams on our hull and nothing else in the sky: no slugs, no darts, and nothing of ours
    // shooting back. What is on trial is whether a hull being ground down says so while it happens
    // — a fight whose only lines are component losses reads as five silent minutes.
    const run = (free) => {
      OD.harness.start(OD.Skirmish.build({ player: 'JC', env: 'deep', range: 120, playerShips: { destroyer: 1 }, enemyShips: { destroyer: 1 }, seed: 5 }));
      const sim = OD.Game.sim;
      const me = sim.playerShips()[0], foe = sim.nearestHostile(me);
      for (const s of sim.ships) { s.ai = false; s.jink = false; s.cmdThrottle = 0; s.throttle = 0; s.order = { type: 'hold' }; }
      me.mounts = me.mounts.filter((m) => m.kind === 'pd'); delete me.mountHp;   // we answer nothing
      me.weaponsFree = false; me.target = null;
      foe.mounts = foe.mounts.filter((m) => m.kind === 'beam'); delete foe.mountHp;
      foe.heading = U.angleOf(U.sub(me.pos, foe.pos)); foe.cmdHeading = foe.heading; foe.angVel = 0;
      sim.setTarget(foe.id, me.id); foe.weaponsFree = free; foe.activeSensor = true;
      const hull0 = me.hull;
      let landed = -1;
      for (let i = 0; i < 240 && !sim.outcome; i++) {
        OD.harness.step(1);
        if (landed < 0 && me.hull < hull0) landed = sim.time;   // the first joule through the plating
      }
      const lines = sim.log.filter((l) => l.speaker === 'Gunnery' && l.kind === 'warn' && /is under beam fire on her /.test(l.text));
      let gap = Infinity;
      for (let i = 1; i < lines.length; i++) gap = Math.min(gap, lines[i].t - lines[i - 1].t);
      return {
        hurt: hull0 - me.hull, gap,
        first: lines.length && landed >= 0 ? lines[0].t - landed : Infinity,
        named: lines.every((l) => l.text.indexOf(foe.name) >= 0 && l.text.indexOf(me.name) >= 0 && /MJ|GJ|kJ/.test(l.text)),
        lines: lines.map((l) => Math.round(l.t) + 's ' + l.text),
      };
    };
    return { burning: run(true), quiet: run(false) };
  });
  check('a hull under beams says so within 90 s, no more than once a minute, and not at all when nothing lands',
    under.burning.lines.length > 1 && under.burning.first <= 90 && !(under.burning.gap < 60) &&
    under.burning.named && under.burning.hurt > 0 &&
    under.quiet.lines.length === 0 && under.quiet.hurt === 0,
    under.burning.lines.length + ' lines, first ' + Math.round(under.burning.first) + ' s after the first joule, closest pair ' +
    (isFinite(under.burning.gap) ? Math.round(under.burning.gap) + ' s' : 'only one line') +
    ', hull off ' + under.burning.hurt.toFixed(3) + ' — and ' + under.quiet.lines.length + ' lines with her beams cold');
  console.log('    ' + (under.burning.lines.slice(0, 2).join('\n    ') || 'no lines'));

  console.log('scenario: a salvo estimate for any size the bay can answer');
  const sizes = await page.evaluate(() => {
    OD.harness.start(OD.Skirmish.build({ player: 'JC', env: 'deep', range: 300, playerShips: { lancer: 1 }, enemyShips: { destroyer: 1 }, seed: 9 }));
    const sim = OD.Game.sim, E = OD.Engagement;
    const me = sim.playerShips()[0], foe = sim.nearestHostile(me);
    for (const s of sim.ships) { s.ai = false; s.cmdThrottle = 0; s.throttle = 0; s.order = { type: 'hold' }; }
    sim.setTarget(me.id, foe.id); me.weaponsFree = true; me.activeSensor = true;
    OD.harness.step(1);
    const aboard = E.shared.bayCount(me);
    const rows = [1, 2, 4, 8, 12, 18, aboard, aboard + 8].map((n) => [n, E.salvoEstimate(sim, me, foe, n).through]);
    return { aboard, rows };
  });
  const through = (n) => (sizes.rows.find((r) => r[0] === n) || [0, 0])[1];
  check('a bigger salvo is never a smaller answer', sizes.rows.every((r, i, a) => i === 0 || r[1] >= a[i - 1][1]), sizes.rows.map((r) => r[0] + '→' + r[1]).join(' '));
  check('and it answers up to the whole bay', through(sizes.aboard) > through(1), sizes.aboard + ' aboard → ' + through(sizes.aboard) + ' through, 1 → ' + through(1));
  check('and promises nothing above it', through(sizes.aboard + 8) === through(sizes.aboard), (sizes.aboard + 8) + ' → ' + through(sizes.aboard + 8));

  console.log('scenario: what an interceptor arrives with, and what the note says it arrives with');
  const dart = await page.evaluate(() => {
    OD.harness.start(OD.Skirmish.build({ player: 'JC', env: 'deep', range: 300, playerShips: { lancer: 1 }, enemyShips: { destroyer: 1 }, seed: 9 }));
    const sim = OD.Game.sim, E = OD.Engagement;
    const me = sim.playerShips()[0], foe = sim.nearestHostile(me);
    for (const s of sim.ships) { s.ai = false; s.jink = false; s.cmdThrottle = 0; s.throttle = 0; s.vel = { x: 0, y: 0 }; s.order = { type: 'hold' }; }
    sim.setTarget(me.id, foe.id); me.weaponsFree = true; me.activeSensor = true;
    // nothing shoots them down: this scenario is about what arrives, not about how much of it does
    foe.mounts = foe.mounts.filter((m) => m.kind !== 'pd'); delete foe.mountHp;
    const note = (E.physicsNotes(me, foe) || []).find((x) => /interceptors reach/.test(x.title));
    const sol = E.shared.launchSolution(me, foe);
    const clean = E.shared.launchSolution(me, null);   // the bay's own figure, with no closing geometry in it
    OD.harness.step(1);
    E.salvo(sim, me, 4);
    // the last reading on a dart before it vanishes is what it went in with
    const last = new Map();
    for (let i = 0; i < 1600 && sim.eng.interceptors.length; i++) {
      for (const it of sim.eng.interceptors) {
        const t = it.target || foe;
        last.set(it.id, { m: E.shared.dartMass(it), v: Math.hypot(it.vel.x - t.vel.x, it.vel.y - t.vel.y), braking: !!it.braking });
      }
      OD.harness.step(0.5);
    }
    const arrived = [];
    for (const r of last.values()) arrived.push({ v: r.v, mj: (0.5 * r.m * r.v * r.v) / 1e6, braking: r.braking });
    return {
      hits: sim.eng.stats.interceptorHits, arrived,
      note: note ? note.body : '', reach: clean.reach, cruise: sol.closing,
      terminal: E.tuning.dartTerminal, lancerDoctrine: OD.Ships.CLASSES.lancer.doctrine.range,
    };
  });
  const mjs = dart.arrived.map((a) => Math.round(a.mj));
  check('every dart launched arrives', dart.hits === 4 && dart.arrived.length === 4, dart.hits + ' aboard of ' + dart.arrived.length + ' tracked');
  check('and arrives at the speed its guidance brakes to, not at its cruise',
    dart.arrived.length > 0 && dart.arrived.every((a) => a.v < dart.terminal * 1.3) && dart.cruise > dart.terminal * 2,
    'cruise ' + Math.round(dart.cruise) + ' m/s → arrives ' + dart.arrived.map((a) => Math.round(a.v)).join('/') + ' m/s');
  check('so ½·m·v² at contact is the 80 to 150 MJ band, not gigajoules',
    dart.arrived.length > 0 && dart.arrived.every((a) => a.mj >= 78 && a.mj <= 150), mjs.join(' / ') + ' MJ');
  check('the note says it brakes and quotes ½·m·v², not a charge',
    /brake|sheds it again/.test(dart.note) && /½·m·v²/.test(dart.note) && !/charge/.test(dart.note) && !/GJ/.test(dart.note),
    (dart.note.split('\n').find((l) => /arrival/.test(l)) || '—'));
  check('and the reach still carries a lancer’s doctrine range', dart.reach >= dart.lancerDoctrine,
    Math.round(dart.reach / 1000) + ' km of reach against a doctrine of ' + Math.round(dart.lancerDoctrine / 1000) + ' km');

  console.log('scenario: a slug is booked for what it arrives with, not what it left with');
  const slugHit = await page.evaluate(() => {
    const U = OD.U;
    const run = (closing) => {
      OD.harness.start(OD.Skirmish.build({ player: 'JC', env: 'deep', range: 300, playerShips: { corvette: 1 }, enemyShips: { corvette: 1 }, seed: 11 }));
      const sim = OD.Game.sim, E = OD.Engagement;
      const me = sim.playerShips()[0], foe = sim.nearestHostile(me);
      for (const s of sim.ships) { s.ai = false; s.jink = false; s.cmdThrottle = 0; s.throttle = 0; s.order = { type: 'hold' }; }
      // head on, the closing split evenly between the two hulls, so the geometry is exactly the number
      const u = U.norm(U.sub(foe.pos, me.pos));
      me.vel = { x: (u.x * closing) / 2, y: (u.y * closing) / 2 };
      foe.vel = { x: (-u.x * closing) / 2, y: (-u.y * closing) / 2 };
      me.heading = U.angleOf(u); me.cmdHeading = me.heading; me.angVel = 0;
      foe.heading = U.angleOf(U.sub(me.pos, foe.pos)); foe.cmdHeading = foe.heading; foe.angVel = 0;
      me.mounts = me.mounts.filter((m) => m.kind === 'coilgun'); delete me.mountHp;
      foe.mounts = []; delete foe.mountHp;
      sim.setTarget(me.id, foe.id); me.weaponsFree = true; me.activeSensor = true;
      foe.target = null; foe.weaponsFree = false;   // she carries nothing and answers nothing
      const coil = E.shared.bestCoilgun(me);
      const hull0 = foe.hull;
      let shot = null;
      for (let i = 0; i < 600 && !sim.eng.stats.slugHits; i++) {
        OD.harness.step(0.5);
        if (!shot && sim.eng.slugs.length) {
          const s = sim.eng.slugs[0];
          shot = {
            mass: s.mass, muzzle: E.shared.slugEnergy(coil), arrival: E.shared.slugArrivalEnergy(s),
            speed: Math.hypot(s.vx - foe.vel.x, s.vy - foe.vel.y),
          };
        }
      }
      const note = (E.physicsNotes(me, foe) || []).find((n) => /slug does/.test(n.title));
      return { shot, hits: sim.eng.stats.slugHits, loss: hull0 - foe.hull, note: note ? note.body : '' };
    };
    return { closing: run(3510), still: run(0) };
  });
  const cl = slugHit.closing.shot || {}, st0 = slugHit.still.shot || {};
  check('a round that meets her head on is booked from |v_slug − v_target|',
    cl.arrival && Math.abs(cl.arrival - 0.5 * cl.mass * cl.speed * cl.speed) < 1e-3 * cl.arrival && Math.abs(cl.speed - 7510) < 80,
    (cl.mass || 0) + ' kg at ' + Math.round(cl.speed || 0) + ' m/s = ' + Math.round((cl.arrival || 0) / 1e6) + ' MJ, muzzle ' + Math.round((cl.muzzle || 0) / 1e6) + ' MJ');
  check('and a hull that is not closing is booked for the muzzle energy',
    st0.arrival && Math.abs(st0.arrival - st0.muzzle) < 0.02 * st0.muzzle, Math.round((st0.arrival || 0) / 1e6) + ' MJ against a muzzle ' + Math.round((st0.muzzle || 0) / 1e6) + ' MJ');
  check('so the closing hull loses clearly more hull to one round',
    slugHit.closing.hits > 0 && slugHit.still.hits > 0 && slugHit.closing.loss > slugHit.still.loss * 1.5,
    'closing ' + (slugHit.closing.loss * 100).toFixed(1) + '% vs still ' + (slugHit.still.loss * 100).toFixed(1) + '% of hull');
  check('and the coilgun note prints the arrival energy, not only the muzzle energy',
    /v_slug − v_target/.test(slugHit.closing.note) && /left the rail with/.test(slugHit.closing.note),
    (slugHit.closing.note.split('\n').find((l) => /v_slug/.test(l)) || '—'));

  console.log('scenario: a same-class corvette bites somewhere, whatever her fire discipline');
  const bite = await page.evaluate(() => {
    OD.harness.start(OD.Skirmish.build({ player: 'JC', env: 'deep', range: 300, playerShips: { corvette: 1 }, enemyShips: { corvette: 1 }, seed: 13 }));
    const sim = OD.Game.sim, E = OD.Engagement, U = OD.U;
    const me = sim.playerShips()[0], foe = sim.nearestHostile(me);
    for (const s of sim.ships) { s.ai = false; s.jink = false; s.cmdThrottle = 0; s.throttle = 0; s.order = { type: 'hold' }; }
    sim.setTarget(me.id, foe.id); sim.setTarget(foe.id, me.id);
    me.weaponsFree = true; foe.weaponsFree = true; me.activeSensor = true; foe.activeSensor = true;
    // nose to nose and holding: the facet each of them reads on the other never moves
    me.heading = U.angleOf(U.sub(foe.pos, me.pos)); me.cmdHeading = me.heading; me.angVel = 0;
    foe.heading = U.angleOf(U.sub(me.pos, foe.pos)); foe.cmdHeading = foe.heading; foe.angVel = 0;
    OD.harness.step(0.5);
    const read = () => { const r = E.reach(sim, me, foe); return { theirs: r.their.beams[r.their.facet], facet: r.their.facet }; };
    const full = read();
    // what she does partway through a chapter-2 fight: her beams throttled to her radiators, and
    // the panels stowed because ours are on them
    E.setFireMode(foe, 'sustained');
    foe.radiators.auto = false; foe.radiators.deployed = false; foe.radiators.state = 0;
    OD.harness.step(0.5);
    const cold = read();
    const throttled = E.shared.sustainedScale(foe);
    // and with her sink saturated on top of that
    foe.weaponsInhibited = true;
    OD.harness.step(0.5);
    const saturated = read();
    foe.weaponsInhibited = false;
    // the computer flying her should not pick a mode that means never firing again: a hot sink
    // (past T.aiSustainLoad, under the 85 % at which she would put the panels back out) with the
    // panels in is exactly the state that used to throttle her to zero for the rest of the fight
    foe.ai = true;
    foe.heat = (foe.sinkCapacity || 0) * 0.7;
    OD.harness.step(0.5);
    const aiMode = E.fireMode(foe);
    const aiSustain = E.shared.sustainedScale(foe);
    const aiGain = E.shared.beamGain(foe);
    // and with no mounts at all, 'never' still means never
    const gone = (() => { foe.mounts = []; delete foe.mountHp; OD.harness.step(0.5); return read(); })();
    return { full, cold, saturated, gone, throttled, aiMode, aiSustain, aiGain };
  });
  check('her beams bite at some range with the panels out', bite.full.theirs > 0,
    'inside ' + Math.round(bite.full.theirs / 1000) + ' km on our ' + bite.full.facet);
  const sameReach = (a, b) => a > 0 && b > 0 && Math.abs(a - b) < 0.02 * b;
  check('and the same range with her beams throttled and her panels stowed',
    sameReach(bite.cold.theirs, bite.full.theirs) && bite.throttled === 0,
    'sustained scale ' + bite.throttled + ' → ladder ' + Math.round(bite.cold.theirs / 1000) + ' km, not never');
  check('and with her sink saturated on top of it', sameReach(bite.saturated.theirs, bite.full.theirs),
    Math.round(bite.saturated.theirs / 1000) + ' km against ' + Math.round(bite.full.theirs / 1000) + ' km');
  check('the computer does not throttle itself to silence with its panels in',
    bite.aiGain > 0 && !(bite.aiMode === 'sustained' && bite.aiSustain === 0),
    bite.aiMode + ' · sustained scale ' + bite.aiSustain.toFixed(2) + ' · beam gain ' + bite.aiGain.toFixed(2));
  check('and a hull with no mounts still reads never', bite.gone.theirs === 0, String(bite.gone.theirs));

  console.log('scenario: a poor track costs the beams a spot and the coilguns their lead');
  const bite2 = await page.evaluate(() => {
    const before = OD.Sensors;
    const hold = (q, velErr) => {
      OD.Sensors = {
        init() {}, update() {}, quality: () => q,
        track: (s, f, t) => ({ q, word: 'track', posErr: velErr * 120, velErr, est: { pos: t.pos, vel: t.vel } }),
        perceived: (s, o, t) => ({ pos: t.pos, vel: t.vel }),
      };
    };
    // the beams: what a track just good enough to shoot on costs the spot and the burn-through range
    OD.harness.start(OD.Skirmish.build({ player: 'JC', env: 'deep', range: 300, playerShips: { cruiser: 1 }, enemyShips: { destroyer: 1 }, seed: 17 }));
    const sim = OD.Game.sim, E = OD.Engagement;
    const me = sim.playerShips()[0], foe = sim.nearestHostile(me);
    for (const s of sim.ships) { s.ai = false; s.jink = false; s.cmdThrottle = 0; s.throttle = 0; s.vel = { x: 0, y: 0 }; s.order = { type: 'hold' }; }
    sim.setTarget(me.id, foe.id); me.weaponsFree = false; foe.weaponsFree = false; foe.target = null;
    me.heading = OD.U.angleOf(OD.U.sub(foe.pos, me.pos)); me.cmdHeading = me.heading; me.angVel = 0;
    foe.heading = OD.U.angleOf(OD.U.sub(me.pos, foe.pos)); foe.cmdHeading = foe.heading; foe.angVel = 0;
    const mount = E.shared.bestBeam(me);
    const R = OD.U.dist(me.pos, foe.pos);
    const beams = {};
    hold(3, 0); OD.harness.step(0.5);
    beams.pinned = { wobble: E.shared.trackWobble(sim, me, foe), spot: E.shared.beamShot(me, mount, R, 1, 1, foe).spot, ladder: E.reach(sim, me, foe).beams.nose };
    hold(2.7, 0); OD.harness.step(0.5);
    beams.just = { wobble: E.shared.trackWobble(sim, me, foe), spot: E.shared.beamShot(me, mount, R, 1, 1, foe).spot, ladder: E.reach(sim, me, foe).beams.nose };
    const note = (E.physicsNotes(me, foe) || []).find((n) => n.title === 'Track quality');
    const noteBody = note ? note.body : '';
    // the coilguns: the same track, and what it does to where the round is sent
    const rounds = (velErr) => {
      OD.harness.start(OD.Skirmish.build({ player: 'JC', env: 'deep', range: 330, playerShips: { destroyer: 1 }, enemyShips: { corvette: 1 }, seed: 7 }));
      const s2 = OD.Game.sim;
      const shooter = s2.playerShips()[0], mark = s2.nearestHostile(shooter);
      for (const s of s2.ships) { s.ai = false; s.jink = false; s.cmdThrottle = 0; s.throttle = 0; s.vel = { x: 0, y: 0 }; s.order = { type: 'hold' }; }
      shooter.mounts = shooter.mounts.filter((m) => m.kind === 'coilgun'); delete shooter.mountHp;
      mark.mounts = []; delete mark.mountHp;
      s2.setTarget(shooter.id, mark.id); shooter.weaponsFree = true;
      hold(2.7, velErr);
      for (let i = 0; i < 400; i++) OD.harness.step(0.5);
      return { fired: s2.eng.stats.slugsFired, hits: s2.eng.stats.slugHits, misses: s2.eng.stats.slugMisses };
    };
    const pinned = rounds(0), fuzzy = rounds(4);
    OD.Sensors = before;
    return { beams, noteBody, pinned, fuzzy, jitter: E.tuning.trackJitter };
  });
  check('the wobble is 1 + 3·(3 − q), so a bare solution is ×1.9 not ×1.45',
    bite2.jitter === 3 && Math.abs(bite2.beams.just.wobble - 1.9) < 1e-9 && bite2.beams.pinned.wobble === 1,
    'q 3 → ×' + bite2.beams.pinned.wobble.toFixed(2) + ', q 2.7 → ×' + bite2.beams.just.wobble.toFixed(2));
  check('and it costs the spot and the burn-through range something a bridge can feel',
    bite2.beams.just.spot > bite2.beams.pinned.spot * 1.3 && bite2.beams.just.ladder < bite2.beams.pinned.ladder * 0.85,
    'spot ' + bite2.beams.pinned.spot.toFixed(1) + ' → ' + bite2.beams.just.spot.toFixed(1) + ' m, ladder ' +
      Math.round(bite2.beams.pinned.ladder / 1000) + ' → ' + Math.round(bite2.beams.just.ladder / 1000) + ' km');
  check('a pinned hull takes every round that lands',
    bite2.pinned.hits > 0 && bite2.pinned.misses === 0,
    bite2.pinned.hits + ' home, ' + bite2.pinned.misses + ' wide, of ' + bite2.pinned.fired + ' fired');
  check('and a hull that is only just a solution takes clearly fewer',
    bite2.fuzzy.misses > 0 && bite2.fuzzy.hits < bite2.pinned.hits * 0.5,
    bite2.fuzzy.hits + ' home, ' + bite2.fuzzy.misses + ' wide, against a velocity error of 4 m/s');
  check('and the physics note says the lead is only as good as her velocity',
    /wobble = 1 \+ 3·\(3 − q\)/.test(bite2.noteBody) && /the lead is only as good as her velocity/.test(bite2.noteBody),
    (bite2.noteBody.split('\n').find((l) => /the lead is only as good as/.test(l)) || '—'));


  console.log('scenario: the crew on the mounts');
  const crew = await page.evaluate(() => {
    const E = OD.Engagement, U = OD.U;
    const beforeS = OD.Sensors, beforeC = OD.Crew, hadCrew = 'Crew' in OD;
    // A firing solution that never moves: the track is held at 3 with no velocity error, so the
    // only thing that changes between readings is what the crew on fire control are worth.
    OD.Sensors = {
      init() {}, update() {}, quality: () => 3,
      track: (s, f, t) => ({ q: 3, word: 'solution', posErr: 0, velErr: 0, est: { pos: t.pos, vel: t.vel } }),
      perceived: (s, o, t) => ({ pos: t.pos, vel: t.vel }),
    };
    let calls = 0;
    // null is no crew module at all, which is the number this file shipped with.
    const crewIs = (f) => { if (f === null) delete OD.Crew; else OD.Crew = { fireFactor: () => { calls++; return f; } }; };
    const still = (sim) => { for (const s of sim.ships) { s.ai = false; s.jink = false; s.cmdThrottle = 0; s.throttle = 0; s.vel = { x: 0, y: 0 }; s.order = { type: 'hold' }; } };
    // Crew records in the shape the crew module keeps them, for the sentence the panel prints.
    const fullWatch = { total: 24, fit: 24, wounded: 0, lost: 0, xp: 0, strapped: false, parties: [{ id: 'p1', task: 'fire', part: null }] };
    const noWatch = { total: 24, fit: 21, wounded: 3, lost: 0, xp: 0, strapped: false, parties: [{ id: 'p1', task: 'sensors', part: null }, { id: 'p2', task: 'standby', part: null }] };
    const veterans = { total: 24, fit: 24, wounded: 0, lost: 0, xp: 2, strapped: false, parties: [{ id: 'p1', task: 'fire', part: null }] };

    // --- the beams: the wobble, the spot it spreads and the burn-through range under it
    const beams = (f, rec) => {
      OD.harness.start(OD.Skirmish.build({ player: 'JC', env: 'deep', range: 300, playerShips: { cruiser: 1 }, enemyShips: { destroyer: 1 }, seed: 17 }));
      const sim = OD.Game.sim;
      const me = sim.playerShips()[0], foe = sim.nearestHostile(me);
      still(sim);
      sim.setTarget(me.id, foe.id); me.weaponsFree = false; foe.weaponsFree = false; foe.target = null;
      me.heading = U.angleOf(U.sub(foe.pos, me.pos)); me.cmdHeading = me.heading; me.angVel = 0;
      foe.heading = U.angleOf(U.sub(me.pos, foe.pos)); foe.cmdHeading = foe.heading; foe.angVel = 0;
      if (rec) me.crew = rec; else delete me.crew;
      crewIs(f);
      calls = 0;
      sim.step(0.5);                      // one substep: update() parks the factor on every hull
      const asked = calls;
      const mount = E.shared.bestBeam(me);
      const R = U.dist(me.pos, foe.pos);
      const out = {
        ships: sim.ships.length, asked,
        factor: E.shared.fireFactor(me),
        jitter: E.shared.pointingJitter(me, foe),
        spot: E.shared.beamShot(me, mount, R, 1, 1, foe).spot,
        ladder: E.reach(sim, me, foe).beams.nose,
        words: E.shared.fireWords(me),
      };
      out.askedAfter = calls;             // the readouts above read the parked value, not the crew
      return out;
    };
    const none = beams(null, null), one = beams(1, fullWatch), short = beams(0.7, noWatch), vet = beams(1.06, veterans);

    // --- the coilguns: what the mount loads the next round in
    const rounds = (f) => {
      OD.harness.start(OD.Skirmish.build({ player: 'JC', env: 'deep', range: 330, playerShips: { destroyer: 1 }, enemyShips: { corvette: 1 }, seed: 7 }));
      const sim = OD.Game.sim;
      const shooter = sim.playerShips()[0], mark = sim.nearestHostile(shooter);
      still(sim);
      shooter.mounts = shooter.mounts.filter((m) => m.kind === 'coilgun'); delete shooter.mountHp;
      mark.mounts = []; delete mark.mountHp;
      sim.setTarget(shooter.id, mark.id); shooter.weaponsFree = true;
      crewIs(f);
      const m = shooter.mounts[0];
      // One substep a turn, so the cooldown is read on the substep the round left the rail and
      // nothing has run it down yet.
      for (let i = 0; i < 60; i++) {
        const mag = m.magazine;
        sim.step(0.5);
        if (m.magazine < mag) return { fired: true, cycle: m.cycle, cooldown: m.cooldown, factor: E.shared.fireFactor(shooter) };
      }
      return { fired: false, cycle: m.cycle, cooldown: m.cooldown, factor: E.shared.fireFactor(shooter) };
    };
    const noneR = rounds(null), oneR = rounds(1), shortR = rounds(0.7), vetR = rounds(1.06);

    // --- the bays: the spacing the rails wait out between salvos
    const spacing = (f, quiet, more) => {
      OD.harness.start(OD.Skirmish.build({ player: 'JC', env: 'deep', range: 306, playerShips: { lancer: 2 }, enemyShips: { destroyer: 1 }, seed: 9 }));
      const sim = OD.Game.sim;
      const auto = sim.playerShips()[0], foe = sim.nearestHostile(auto);
      still(sim);
      auto.mounts = auto.mounts.filter((m) => m.kind === 'launcher'); delete auto.mountHp;
      foe.weaponsFree = false; foe.target = null;
      sim.setTarget(auto.id, foe.id); auto.weaponsFree = true; auto.autoBays = true;
      crewIs(f);
      const bay0 = E.shared.bayCount(auto);
      // The rails have been quiet this long. The clock is turned by sim.step: harness.step runs
      // Game.handBays(), which would set autoBays from the selection instead.
      E.shared.stateOf(auto).lastSalvo = sim.time - quiet;
      sim.step(1);
      const early = bay0 - E.shared.bayCount(auto);
      for (let i = 0; i < (more || 0); i++) sim.step(1);
      return { gap: E.tuning.salvoGap / (f === null ? 1 : f), quiet, bay0, early, late: bay0 - E.shared.bayCount(auto) };
    };
    const noneS = spacing(null, 145, 10), oneS = spacing(1, 145, 10), shortS = spacing(0.7, 145, 80), vetS = spacing(1.06, 145, 0);

    // --- the sentence the panel prints, on the records the crew module keeps
    const say = (f, rec) => E.shared.fireWords({ crew: rec || null, eng: { fireFactor: f } });
    const words = {
      full: say(1, fullWatch),
      noParty: short.words,
      veteran: vet.words,
      couch: say(0.85, { total: 24, fit: 24, wounded: 0, lost: 0, xp: 0, strapped: true, overCouch: true, parties: [{ id: 'p1', task: 'fire', part: null }] }),
      // a record from a crew module with no overCouch flag on it still answers, off strapped
      couchOld: say(0.85, { total: 24, fit: 24, wounded: 0, lost: 0, xp: 0, strapped: true, parties: [{ id: 'p1', task: 'fire', part: null }] }),
      workG: say(1, { total: 24, fit: 24, wounded: 0, lost: 0, xp: 0, strapped: true, overCouch: false, parties: [{ id: 'p1', task: 'fire', part: null }] }),
      thin: say(0.7, { total: 24, fit: 7, wounded: 17, lost: 0, xp: 0, strapped: false, parties: [{ id: 'p1', task: 'fire', part: null }] }),
      bare: say(0.7, null),
    };
    // --- a crew module that answers with rubbish, or throws, counts as no crew module
    OD.Crew = { fireFactor: () => NaN };
    const junk = E.shared.crewFire({});
    OD.Crew = { fireFactor: () => 0 };
    const zero = E.shared.crewFire({});
    OD.Crew = { fireFactor: () => { throw new Error('no crew'); } };
    const threw = E.shared.crewFire({});

    OD.Sensors = beforeS;
    if (hadCrew) OD.Crew = beforeC; else delete OD.Crew;
    return { none, one, short, vet, noneR, oneR, shortR, vetR, noneS, oneS, shortS, vetS, words,
      junk, zero, threw, tuning: { jitter: E.tuning.jitter, salvoGap: E.tuning.salvoGap } };
  });
  const rad = (j) => (j * 1e6).toFixed(3) + ' µrad';
  check('with no crew module the wobble is the tuning number and the panel says nothing',
    crew.none.factor === 1 && crew.none.jitter === crew.tuning.jitter && crew.none.words === '',
    rad(crew.none.jitter) + ' · factor ' + crew.none.factor + ' · words "' + crew.none.words + '"');
  check('a crew worth 1 leaves every number byte-identical to that',
    crew.one.jitter === crew.none.jitter && crew.one.spot === crew.none.spot && crew.one.ladder === crew.none.ladder &&
      crew.oneR.cooldown === crew.noneR.cooldown && crew.oneS.early === crew.noneS.early && crew.oneS.late === crew.noneS.late &&
      crew.one.words === '',
    rad(crew.one.jitter) + ' · spot ' + crew.one.spot.toFixed(6) + ' m · ladder ' + crew.one.ladder.toFixed(3) + ' m · cycle ' + crew.oneR.cooldown + ' s');
  check('the crew is asked once a ship an update, and the readouts use what was parked',
    crew.one.asked === crew.one.ships && crew.one.askedAfter === crew.one.asked && crew.one.ships > 1,
    crew.one.asked + ' calls for ' + crew.one.ships + ' ships, ' + (crew.one.askedAfter - crew.one.asked) + ' more for the readouts');
  check('no party on fire control widens the wobble by 1 / 0.7',
    crew.short.factor === 0.7 && crew.short.jitter === crew.one.jitter / 0.7 && crew.short.spot > crew.one.spot,
    rad(crew.one.jitter) + ' → ' + rad(crew.short.jitter) + ', spot ' + crew.one.spot.toFixed(2) + ' → ' + crew.short.spot.toFixed(2) + ' m');
  check('and costs the burn-through range with it',
    crew.short.ladder < crew.one.ladder * 0.95 && crew.short.ladder > 0,
    Math.round(crew.one.ladder / 1000) + ' km → ' + Math.round(crew.short.ladder / 1000) + ' km on her nose');
  check('a veteran crew points 6 % tighter and reaches farther',
    crew.vet.factor === 1.06 && crew.vet.jitter === crew.one.jitter / 1.06 && crew.vet.ladder > crew.one.ladder,
    rad(crew.vet.jitter) + ' · ' + Math.round(crew.one.ladder / 1000) + ' km → ' + Math.round(crew.vet.ladder / 1000) + ' km');
  check('the coilgun cycles on the rated time with a crew worth 1',
    crew.oneR.fired && crew.noneR.fired && crew.oneR.cooldown === crew.oneR.cycle && crew.noneR.cooldown === crew.noneR.cycle,
    'one round every ' + crew.oneR.cycle + ' s');
  check('short-handed the same mount takes 1 / 0.7 of that',
    crew.shortR.fired && crew.shortR.cooldown === crew.shortR.cycle / 0.7,
    crew.shortR.cycle + ' s → ' + crew.shortR.cooldown.toFixed(2) + ' s between rounds');
  check('and a veteran crew loads it sooner',
    crew.vetR.fired && crew.vetR.cooldown === crew.vetR.cycle / 1.06,
    crew.vetR.cycle + ' s → ' + crew.vetR.cooldown.toFixed(2) + ' s between rounds');
  check('the rails wait the doctrine\'s 150 s with a crew worth 1',
    crew.oneS.gap === crew.tuning.salvoGap && crew.oneS.early === 0 && crew.oneS.late > 0,
    'quiet ' + crew.oneS.quiet + ' s: ' + crew.oneS.early + ' away, ' + crew.oneS.late + ' away ten seconds later');
  check('short-handed they wait 1 / 0.7 of it',
    Math.abs(crew.shortS.gap - crew.tuning.salvoGap / 0.7) < 1e-9 && crew.shortS.early === 0 && crew.shortS.late > 0,
    'gap ' + crew.shortS.gap.toFixed(1) + ' s: nothing away at ' + crew.shortS.quiet + ' s, ' + crew.shortS.late + ' away past it');
  check('and a veteran crew opens them inside the old window',
    crew.vetS.gap < crew.tuning.salvoGap && crew.vetS.early > 0,
    'gap ' + crew.vetS.gap.toFixed(1) + ' s: ' + crew.vetS.early + ' away at ' + crew.vetS.quiet + ' s');
  // The line gained a second sentence: what the watch costs the main mount's cycle (the first
  // mount in the rack that loads, which on this cruiser is her 10 s heavy coilgun). These two
  // hulls carry one, so the answer this check reads is a longer line than it was, in both
  // directions — the veteran watch loads the same mount in 9.4 s. The hulls below have no mounts
  // on them at all, so their lines are the ones this file shipped with, to the character.
  check('the panel line names the number and the reason',
    crew.words.full === '' &&
      crew.words.noParty === 'Fire control at 70 %: no party on it. The heavy coilgun A cycles every 14 s, not 10 s.' &&
      crew.words.veteran === 'Fire control at 106 %: a veteran crew. The heavy coilgun A cycles every 9.4 s, not 10 s.',
    [crew.words.noParty, crew.words.veteran].join(' · '));
  check('and says which of the other three it is',
    crew.words.couch === 'Fire control at 85 %: the crew is over the couch limit.' &&
      crew.words.couchOld === crew.words.couch &&
      crew.words.thin === 'Fire control at 70 %: fewer than a third of the crew are fit.' &&
      crew.words.bare === 'Fire control at 70 %: the mounts are short-handed.',
    [crew.words.couch, crew.words.thin, crew.words.bare].join(' · '));
  check('a crew strapped in under the working limit still shoots, and the panel says nothing',
    crew.words.workG === '', '"' + crew.words.workG + '"');
  check('a crew module that answers with rubbish or throws counts as absent',
    crew.junk === 1 && crew.zero === 1 && crew.threw === 1,
    'NaN → ' + crew.junk + ', 0 → ' + crew.zero + ', throw → ' + crew.threw);

  console.log('scenario: what the short watch costs the main mount');
  const mainMount = await page.evaluate(() => {
    const beforeC = OD.Crew, hadCrew = 'Crew' in OD;
    OD.Crew = { fireFactor: () => 0.7 };   // nobody on fire control: the crew module's own 0.7
    OD.harness.start(OD.Skirmish.build({ player: 'JC', env: 'deep', range: 300, playerShips: { corvette: 1 }, enemyShips: { corvette: 1 }, seed: 5 }));
    const sim = OD.Game.sim, E = OD.Engagement;
    const me = sim.playerShips()[0];
    for (const s of sim.ships) { s.ai = false; s.jink = false; s.cmdThrottle = 0; s.throttle = 0; s.order = { type: 'hold' }; }
    // the record the crew module keeps with the watch on the sensors instead of the mounts
    me.crew = { total: 18, fit: 18, wounded: 0, lost: 0, xp: 0, strapped: false, overCouch: false,
      parties: [{ id: 'p1', task: 'sensors', part: null }] };
    sim.step(0.5);                         // update() parks the factor on every hull
    // her rack as she sails: a spinal laser, then the 6 s coilgun the sentence is about. The beam
    // is passed over — it holds a spot, it does not load — and the first mount with a cycle answers.
    const out = { main: E.shared.fireWords(me) };
    out.colon = out.main.slice(0, out.main.indexOf(':'));  // what the panel keys its row on
    out.first = me.mounts[0].kind;
    // a mount that loads in double figures is read in whole seconds, and named as the rack names it
    me.mounts = [{ kind: 'coilgun', name: 'Heavy coilgun A', cycle: 10, magazine: 80, muzzleVelocity: 5000, slugMass: 20, heatPerShot: 0 }];
    delete me.mountHp;
    out.heavy = E.shared.fireWords(me);
    // a veteran watch loads the same mount sooner, and the line says so the same way
    const watch = me.crew;
    me.crew = { total: 18, fit: 18, wounded: 0, lost: 0, xp: 2, strapped: false, overCouch: false,
      parties: [{ id: 'p1', task: 'fire', part: null }] };
    me.eng.fireFactor = 1.06;
    out.veteran = E.shared.fireWords(me);
    me.eng.fireFactor = 0.7; me.crew = watch;
    // a rack with nothing that cycles — every beam and bay on her, no coilgun — adds nothing
    me.mounts = OD.Ships.CLASSES.corvette.mounts.filter((m) => m.kind !== 'coilgun').map((m) => Object.assign({}, m));
    out.noCycle = E.shared.fireWords(me);
    me.mounts = [];                        // and neither does a hull with nothing on her at all
    out.bare = E.shared.fireWords(me);
    if (hadCrew) OD.Crew = beforeC; else delete OD.Crew;
    return out;
  });
  check('the words say what the watch costs the main mount, on the mount\'s own clock',
    mainMount.first === 'beam' &&
      mainMount.main === 'Fire control at 70 %: no party on it. The coilgun cycles every 8.6 s, not 6 s.' &&
      mainMount.heavy === 'Fire control at 70 %: no party on it. The heavy coilgun A cycles every 14 s, not 10 s.' &&
      mainMount.colon === 'Fire control at 70 %',
    mainMount.main + ' · ' + mainMount.heavy);
  check('and says it in both directions: a veteran watch loads the same mount sooner',
    mainMount.veteran === 'Fire control at 106 %: a veteran crew. The heavy coilgun A cycles every 9.4 s, not 10 s.',
    mainMount.veteran);
  check('a rack with nothing that cycles, or no mounts at all, adds nothing',
    mainMount.noCycle === 'Fire control at 70 %: no party on it.' && mainMount.bare === mainMount.noCycle,
    '"' + mainMount.noCycle + '" · "' + mainMount.bare + '"');

  console.log('scenario: the drive\'s heat follows the thrust she makes, not the lever');
  const capBurn = await page.evaluate(() => {
    const beforeC = OD.Crew, hadCrew = 'Crew' in OD;
    OD.harness.start(OD.Skirmish.build({ player: 'JC', env: 'deep', range: 400, playerShips: { destroyer: 3 }, enemyShips: { corvette: 1 }, seed: 11 }));
    const sim = OD.Game.sim, E = OD.Engagement;
    const fleet = sim.playerShips();
    const capped = fleet[0], hand = fleet[1], full = fleet[2];
    for (const s of sim.ships) { s.ai = false; s.jink = false; s.target = null; s.weaponsFree = false; }
    // the couch limit the crew module hands the sim: three-quarters of what her drive can do
    const cap = 0.75 * (capped.thrust / capped.mass());
    OD.Crew = { accelCap: (s) => (s === capped ? cap : Infinity) };
    const burn = (s, th) => {
      s.order = { type: 'manual', throttle: th, heading: s.heading };
      s.cmdThrottle = th; s.cmdHeading = s.heading;
      s.radiators.auto = false; s.radiators.deployed = true; s.radiators.state = 1;
      s.heat = 0.6 * s.sinkCapacity;   // the panels at their rating, so the sink margin is a real question
    };
    burn(capped, 1);     // the lever at full, the couches holding her to three-quarters of it
    burn(hand, 0.75);    // the same acceleration, asked for by hand
    burn(full, 1);       // and the same lever with nothing in the way of it
    sim.step(0.01);      // one short substep: thermal() parks thrustFrac and the masses stay level
    const read = (s) => ({
      throttle: s.throttle, frac: s.thrustFrac, accel: s.accel() * s.throttle,
      scale: E.shared.sustainedScale(s), margin: E.shared.sinkMargin(s), words: E.shared.sinkWords(s),
    });
    const out = { hulls: fleet.length, capped: read(capped), hand: read(hand), full: read(full) };
    if (hadCrew) OD.Crew = beforeC; else delete OD.Crew;
    return out;
  });
  check('a crew-capped burn is budgeted for the thrust it makes, not for the lever',
    capBurn.hulls === 3 && capBurn.capped.throttle === 1 && capBurn.hand.throttle === 0.75 &&
      Math.abs(capBurn.capped.accel - capBurn.hand.accel) < 1e-3 &&
      Math.abs(capBurn.capped.scale - capBurn.hand.scale) < 1e-4 &&
      capBurn.capped.scale > 0 && capBurn.capped.scale < 1 &&
      capBurn.capped.margin === capBurn.hand.margin && capBurn.capped.margin === true &&
      capBurn.capped.words === capBurn.hand.words,
    'lever ' + capBurn.capped.throttle + ' → thrust ' + capBurn.capped.frac.toFixed(3) + ': sustained ' +
      capBurn.capped.scale.toFixed(4) + ' against ' + capBurn.hand.scale.toFixed(4) + ' by hand, margin ' +
      capBurn.capped.margin + ' and ' + capBurn.hand.margin + ', ' + capBurn.capped.words);
  check('and the same lever with nothing holding it back still budgets the whole drive',
    capBurn.full.frac === 1 && capBurn.full.scale === 0 && capBurn.full.margin === false &&
      capBurn.capped.scale > 0.1,
    'thrust ' + capBurn.full.frac.toFixed(3) + ': sustained ' + capBurn.full.scale.toFixed(4) +
      ' · margin ' + capBurn.full.margin + ' · ' + capBurn.full.words);

  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(failures ? failures + ' check(s) failed' : 'all engagement checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
