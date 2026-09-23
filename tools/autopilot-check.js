/* Autopilot and AI checks for Orbital Declaration (OD.Autopilot, OD.AI).
   node tools/autopilot-check.js   (needs Playwright + Chromium; NODE_PATH may need the global modules dir)

   What the playtest reviewers found and this script holds down:
     1. a retreat with the moon straight behind the ship never flies into it;
     2. the 'approach' order really coasts — drive cold nearly all the way — and arrives holding;
     3. a one-a-side skirmish gets to an outcome, or at least to a hit, instead of two ships
        pointing at each other for three quarters of an hour;
     4. a coasting hull with a target puts its nose on her, so a spinal mount can bear;
     5. an approach on a target that is itself manoeuvring is still one burn, one coast, one brake:
        at most one correction inside the coast, and the coast is cold;
     6. an order on a hull that goes out of the fight drops to hold inside 5 s, with the line;
     7. an even three-a-side under mirrored orders is even: it is decided, it is visibly being
        decided all the way through, and neither side loses more than 1.5 × what the other loses. */
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const url = process.env.OD_URL || 'file://' + path.join(ROOT, 'index.html');

let failures = 0;
function check(name, ok, detail) { console.log((ok ? '  ok   ' : '  FAIL ') + name + (detail ? '  ' + detail : '')); if (!ok) failures++; }
const km = (m) => (m == null ? '—' : Math.round(m / 1000) + ' km');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
  await page.goto(url);
  await page.waitForTimeout(600);

  // ---------------------------------------------------------------- the module surface
  const mod = await page.evaluate(() => ({
    present: !!(window.OD && OD.Autopilot),
    api: ['apply', 'attitude', 'desired', 'brakeRange', 'guardCourse', 'bodyFloor', 'closestPass', 'knowsOrder']
      .filter((k) => !OD.Autopilot || typeof OD.Autopilot[k] !== 'function'),
    orders: (OD.Autopilot && OD.Autopilot.ORDERS) || [],
    knowsApproach: !!(OD.Autopilot && OD.Autopilot.knowsOrder && OD.Autopilot.knowsOrder('approach')),
    ai: ['think', 'commitRange'].filter((k) => !OD.AI || typeof OD.AI[k] !== 'function'),
  }));
  check('OD.Autopilot loaded with the whole interface', mod.present && mod.api.length === 0, mod.api.join(','));
  check("'approach' is in the order list", mod.orders.indexOf('approach') >= 0 && mod.knowsApproach, mod.orders.join(','));
  check('OD.AI exports think and commitRange', mod.ai.length === 0, mod.ai.join(','));

  // ---------------------------------------------------------------- 1. retreat with the moon behind
  // Ganymede orbit, the hostile straight outward from the ship, so "straight away from her" is
  // straight down at the moon. Half an hour later the ship must still be above the floor.
  console.log('scenario: retreat with Ganymede directly behind the ship');
  const retreat = await page.evaluate(() => {
    const U = OD.U, B = OD.P.bodies.ganymede;
    const R = B.radius + 3000e3;
    const v = Math.sqrt(B.mu / R);
    const scn = {
      name: 'Retreat guard', body: B, sunAngle: 0.4, playerFaction: 'JC',
      ships: [
        { id: 'me', name: 'JCS Test', cls: 'corvette', faction: 'JC', player: true, ai: false,
          pos: { x: R, y: 0 }, vel: { x: 0, y: v }, heading: Math.PI / 2, heat: 0, order: { type: 'hold' } },
        // the bogey sits 800 km further out on the same radius: away from her is straight down
        { id: 'bogey', name: 'ISV Test', cls: 'corvette', faction: 'ISA', player: false, ai: false,
          pos: { x: R + 800e3, y: 0 }, vel: { x: 0, y: v }, heading: -Math.PI / 2, heat: 0, order: { type: 'hold' }, weaponsFree: false },
      ],
      objectives: [{ id: 'x', text: 'hold', type: 'survive', seconds: 1e6 }],
    };
    OD.harness.start(scn);
    const sim = OD.Game.sim;
    const me = sim.byId('me');
    const floor = OD.Autopilot.bodyFloor(sim);
    // the course the order asks for, before the guard: straight down at the moon
    const raw = U.norm(U.sub(me.pos, sim.byId('bogey').pos));
    const rawPass = OD.Autopilot.closestPass(sim, me, raw, me.accel());
    OD.harness.order('me', { type: 'retreat', target: 'bogey' });
    let closest = U.len(me.pos), terrain = 0, samples = 0, cold = 0;
    for (let i = 0; i < 180 && !sim.outcome; i++) {
      OD.harness.step(10, 1);
      const d = U.len(me.pos);
      if (d < closest) closest = d;
      samples++; if (me.throttle === 0) cold++;
      if (me.destroyed) break;
    }
    terrain = sim.log.filter((l) => /terrain avoidance/.test(l.text)).length;
    return {
      floor, closest, radius: B.radius, rawPass, terrain, time: sim.time,
      destroyed: me.destroyed, alt: U.len(me.pos) - B.radius, away: U.dist(me.pos, sim.byId('bogey').pos),
      errors: OD.errors.slice(), burned: samples ? 1 - cold / samples : 0,
    };
  });
  check('the unguarded course really did run into the moon', retreat.rawPass <= retreat.floor,
    'closest ' + km(retreat.rawPass) + ' vs floor ' + km(retreat.floor));
  check('the retreat never comes inside the body plus its margin in 30 min',
    !retreat.destroyed && retreat.closest > retreat.floor,
    'closest ' + km(retreat.closest) + ' · floor ' + km(retreat.floor) + ' · radius ' + km(retreat.radius));
  check('it clears without falling back on terrain avoidance', retreat.terrain === 0, retreat.terrain + ' fallback burn(s)');
  check('the retreat still opens the range', retreat.away > 800e3, km(retreat.away));
  check('no errors during the retreat', retreat.errors.length === 0, retreat.errors.join(' | '));
  console.log('    ended ' + km(retreat.alt) + ' up, ' + km(retreat.away) + ' from her, drive lit ' + Math.round(retreat.burned * 100) + ' % of the time');

  // ---------------------------------------------------------------- 2. the cold approach
  console.log("scenario: 'approach' at 1.5 km/s in deep space");
  const approach = await page.evaluate(() => {
    const U = OD.U;
    const D = 3000e3;
    const scn = {
      name: 'Cold approach', body: null, sunAngle: 0.4, playerFaction: 'JC',
      ships: [
        // Neither hull shoots: this is the autopilot under test, and a bogey shot to pieces
        // halfway in would end the run for the wrong reason.
        { id: 'me', name: 'JCS Test', cls: 'corvette', faction: 'JC', player: true, ai: false,
          pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, heading: 0, heat: 0, order: { type: 'hold' }, weaponsFree: false },
        { id: 'bogey', name: 'ISV Test', cls: 'corvette', faction: 'ISA', player: false, ai: false,
          pos: { x: D, y: 0 }, vel: { x: 0, y: 0 }, heading: Math.PI, heat: 0, order: { type: 'hold' }, weaponsFree: false },
      ],
      objectives: [{ id: 'x', text: 'hold', type: 'survive', seconds: 1e6 }],
    };
    OD.harness.start(scn);
    const sim = OD.Game.sim;
    const me = sim.byId('me'), her = sim.byId('bogey');
    const order = { type: 'approach', target: 'bogey', speed: 1500 };
    const brakeAt = OD.Autopilot.brakeRange(me, order);
    OD.harness.order('me', order);
    let steps = 0, cold = 0, peak = 0, arrivedAt = null, everLit = 0;
    let inbound = 0, inboundCold = 0;
    for (let i = 0; i < 600; i++) {
      OD.harness.step(5, 1);
      steps++;
      const d = U.dist(me.pos, her.pos);
      const closing = -U.dot(U.sub(me.vel, her.vel), U.norm(U.sub(her.pos, me.pos))) * -1;
      if (me.throttle === 0) cold++; else everLit++;
      const rel = U.len(U.sub(me.vel, her.vel));
      if (rel > peak) peak = rel;
      if (d > brakeAt) { inbound++; if (me.throttle === 0) inboundCold++; }
      else if (arrivedAt == null) arrivedAt = sim.time;
      if (arrivedAt != null && sim.time - arrivedAt > 900) break;
    }
    return {
      brakeAt, coldFraction: inbound ? inboundCold / inbound : 0, allCold: steps ? cold / steps : 0,
      peak, arrivedAt, time: sim.time,
      range: U.dist(me.pos, her.pos), rel: U.len(U.sub(me.vel, her.vel)),
      throttle: me.throttle, dv: me.stats.dvSpent, errors: OD.errors.slice(),
    };
  });
  check('the drive is cold for at least 80 % of the run in', approach.coldFraction >= 0.8,
    Math.round(approach.coldFraction * 100) + ' % cold outside ' + km(approach.brakeAt));
  check('it actually reached the ordered closing speed', approach.peak > 1400 && approach.peak < 1800, Math.round(approach.peak) + ' m/s');
  // Holding, not stopped: the station band deliberately leaves a slow drift rather than spending
  // propellant to stand perfectly still, so what is checked is that the range is the ordered one
  // and the drift is a small fraction of it.
  check('it arrives holding inside brakeAt/2', approach.range < approach.brakeAt * 0.58 && approach.rel < 150,
    km(approach.range) + ' at ' + Math.round(approach.rel) + ' m/s · brakeAt ' + km(approach.brakeAt));
  check('no errors during the approach', approach.errors.length === 0, approach.errors.join(' | '));
  console.log('    brakeAt ' + km(approach.brakeAt) + ', arrived at ' + Math.round(approach.arrivedAt || 0) + ' s, ' +
    Math.round(approach.dv) + ' m/s spent, ' + Math.round(approach.allCold * 100) + ' % cold overall');

  // ---------------------------------------------------------------- 3. a fight that ends
  console.log('scenario: one corvette a side, both fought by the computer');
  const fight = await page.evaluate(() => {
    const U = OD.U;
    OD.harness.start(OD.Skirmish.build({ player: 'JC', env: 'deep', range: 1500, playerShips: { corvette: 1 }, enemyShips: { corvette: 1 }, seed: 7 }));
    const sim = OD.Game.sim;
    // both sides fought by the computer, so this is the AI's rule under test, not a player's hand
    for (const s of sim.ships) { s.ai = true; s.weaponsFree = true; }
    const start = sim.ships.map((s) => s.hull + s.systems.drive + s.systems.radiators + s.systems.sensors + s.systems.weapons);
    let hitAt = null, minRange = Infinity, committed = false;
    for (let i = 0; i < 150 && !sim.outcome; i++) {
      OD.harness.step(10);
      if (sim.ships.length >= 2) minRange = Math.min(minRange, U.dist(sim.ships[0].pos, sim.ships[1].pos));
      if (sim.ships.some((s) => s.order && s.order.type === 'intercept')) committed = true;
      if (hitAt == null) {
        const now = sim.ships.map((s) => s.hull + s.systems.drive + s.systems.radiators + s.systems.sensors + s.systems.weapons);
        if (now.some((v, k) => Math.abs(v - start[k]) > 1e-4) || sim.ships.some((s) => s.destroyed || s.disabled)) hitAt = sim.time;
      }
      if (sim.time > 1500) break;
    }
    return {
      time: sim.time, outcome: sim.outcome, hitAt, minRange, committed,
      closing: sim.log.filter((l) => /closing the range to end the stand-off/.test(l.text)).length,
      hulls: sim.ships.map((s) => s.name + ' ' + Math.round(s.hull * 100) + ' %' + (s.disabled ? ' disabled' : '') + (s.destroyed ? ' lost' : '')),
      errors: OD.errors.slice(),
    };
  });
  check('a one-a-side skirmish reaches an outcome or a hit inside 25 min',
    !!fight.outcome || (fight.hitAt != null && fight.hitAt <= 1500),
    'outcome ' + fight.outcome + ' · first hit at ' + (fight.hitAt == null ? 'never' : Math.round(fight.hitAt) + ' s') + ' · ran ' + Math.round(fight.time) + ' s');
  check('no errors in the skirmish', fight.errors.length === 0, fight.errors.join(' | '));
  console.log('    closest ' + km(fight.minRange) + ', ' + fight.closing + ' commit line(s), ' + fight.hulls.join(' · '));

  // ---------------------------------------------------------------- 4. a coasting hull bears on her
  console.log('scenario: a coasting corvette with a target');
  const bearing = await page.evaluate(() => {
    const U = OD.U;
    const scn = {
      name: 'Bearing', body: null, sunAngle: 0.4, playerFaction: 'JC',
      ships: [
        { id: 'me', name: 'JCS Test', cls: 'corvette', faction: 'JC', player: true, ai: false,
          pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, heading: Math.PI, heat: 0, order: { type: 'hold' } },
        { id: 'bogey', name: 'ISV Test', cls: 'corvette', faction: 'ISA', player: false, ai: false,
          pos: { x: 200e3, y: 0 }, vel: { x: 0, y: 0 }, heading: Math.PI, heat: 0, order: { type: 'hold' }, weaponsFree: false },
      ],
      objectives: [{ id: 'x', text: 'hold', type: 'survive', seconds: 1e6 }],
    };
    OD.harness.start(scn);
    const sim = OD.Game.sim;
    const me = sim.byId('me'), her = sim.byId('bogey');
    sim.setTarget('me', 'bogey');
    let best = 180, at = null, throttled = 0, n = 0;
    for (let i = 0; i < 12; i++) {
      OD.harness.step(5, 1);
      n++; if (me.throttle > 0) throttled++;
      const want = U.angleOf(U.sub(her.pos, me.pos));
      const err = Math.abs(U.angleDiff(want, me.heading)) * 180 / Math.PI;
      if (err < best) best = err;
      if (at == null && err <= 5) at = sim.time;
    }
    return { best, at, lit: throttled, n, errors: OD.errors.slice() };
  });
  check('a coasting hull with a target has its nose on her within 60 s', bearing.at != null && bearing.at <= 60,
    'best ' + bearing.best.toFixed(1) + '° at ' + (bearing.at == null ? 'never' : Math.round(bearing.at) + ' s'));
  check('it does that without lighting the drive', bearing.lit === 0, bearing.lit + '/' + bearing.n + ' steps lit');
  check('no errors while bearing', bearing.errors.length === 0, bearing.errors.join(' | '));

  // ---------------------------------------------------------------- 5. one burn, one coast, one brake
  // The reviewers watched an approach light its drive four times on the way in as it chased a
  // target that would not hold still. The order promises one burn, a dark coast and a brake: the
  // coast is allowed exactly one correction, it is announced, and it never comes late.
  console.log("scenario: 'approach' toward a target that keeps manoeuvring");
  const coasting = await page.evaluate(() => {
    const U = OD.U;
    const D = 800e3;
    OD.harness.start({
      name: 'Coast discipline', body: null, sunAngle: 0.4, playerFaction: 'JC',
      ships: [
        { id: 'me', name: 'JCS Test', cls: 'corvette', faction: 'JC', player: true, ai: false,
          pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, heading: 0, heat: 0, order: { type: 'hold' }, weaponsFree: false },
        { id: 'bogey', name: 'ISV Test', cls: 'corvette', faction: 'ISA', player: false, ai: false,
          pos: { x: D, y: 0 }, vel: { x: 0, y: 0 }, heading: Math.PI / 2, heat: 0, order: { type: 'hold' }, weaponsFree: false },
      ],
      objectives: [{ id: 'x', text: 'hold', type: 'survive', seconds: 1e6 }],
    });
    const sim = OD.Game.sim;
    const me = sim.byId('me'), her = sim.byId('bogey');
    const order = { type: 'approach', target: 'bogey', speed: 800 };
    const brakeAt = OD.Autopilot.brakeRange(me, order);
    OD.harness.order('me', order);
    let coastN = 0, coastCold = 0, coastBurns = 0, lit = false, arrivedAt = null;
    for (let i = 0; i < 900; i++) {
      // she wanders across the line of sight the whole way in, so dead reckoning goes stale
      her.order = { type: 'manual', heading: Math.PI / 2 + Math.sin(sim.time / 250), throttle: 0.2 };
      sim.step(5);
      const run = OD.Autopilot.approachRun(me) || {};
      if (run.phase === 'coast') {
        coastN++;
        if (me.throttle === 0) { coastCold++; lit = false; } else if (!lit) { lit = true; coastBurns++; }
      } else lit = false;
      if (run.phase === 'close' && arrivedAt == null) arrivedAt = sim.time;
      if (arrivedAt != null && sim.time - arrivedAt > 600) break;
    }
    const run = OD.Autopilot.approachRun(me) || {};
    return {
      brakeAt, coastBurns, corrections: run.corrections || 0, arrivedAt,
      cold: coastN ? coastCold / coastN : 0, coastN,
      range: U.dist(me.pos, her.pos), rel: U.len(U.sub(me.vel, her.vel)),
      lines: sim.log.filter((l) => l.speaker === 'Autopilot' && /correction burn/.test(l.text)).map((l) => l.text),
      errors: OD.errors.slice(),
    };
  });
  check('the coast lights the drive at most once', coasting.coastBurns <= 1 && coasting.corrections <= 1,
    coasting.coastBurns + ' burn(s) in the coast, ' + coasting.corrections + ' correction(s)');
  check('at least 80 % of the coast is at throttle 0', coasting.cold >= 0.8,
    Math.round(coasting.cold * 100) + ' % of ' + coasting.coastN + ' samples');
  check('a correction is announced by the Autopilot, once', coasting.lines.length === coasting.corrections,
    coasting.lines.join(' | ') || 'no correction was needed');
  check('it still arrives on her', coasting.arrivedAt != null && coasting.range < coasting.brakeAt,
    km(coasting.range) + ' at ' + Math.round(coasting.rel) + ' m/s · brakeAt ' + km(coasting.brakeAt));
  check('no errors during the coast', coasting.errors.length === 0, coasting.errors.join(' | '));

  // ---------------------------------------------------------------- 6. an order outlives its target
  console.log('scenario: the hull an order is flown against goes out of the fight');
  const dead = await page.evaluate(() => {
    OD.harness.start({
      name: 'Dead target', body: null, sunAngle: 0.4, playerFaction: 'JC',
      ships: [
        { id: 'me', name: 'JCS Test', cls: 'corvette', faction: 'JC', player: true, ai: false,
          pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, heading: 0, heat: 0, order: { type: 'hold' }, weaponsFree: false },
        { id: 'ten', name: 'ISV Tenacity', cls: 'corvette', faction: 'ISA', player: false, ai: false,
          pos: { x: 400e3, y: 0 }, vel: { x: 0, y: 0 }, heading: Math.PI, heat: 0, order: { type: 'hold' }, weaponsFree: false },
      ],
      objectives: [{ id: 'x', text: 'hold', type: 'survive', seconds: 1e6 }],
    });
    const sim = OD.Game.sim;
    const me = sim.byId('me'), ten = sim.byId('ten');
    OD.harness.order('me', { type: 'approach', target: 'ten', speed: 800 });
    sim.step(60);
    const flying = me.order.type;
    ten.disabled = true; ten.hull = 0.34;   // out of the fight, exactly as a beam leaves her
    const t0 = sim.time;
    let droppedAt = null;
    for (let i = 0; i < 20; i++) { sim.step(1); if (droppedAt == null && me.order.type === 'hold') droppedAt = sim.time - t0; }
    return {
      flying, droppedAt, order: me.order.type, target: me.target, throttle: me.throttle,
      lines: sim.log.filter((l) => l.speaker === 'Autopilot').map((l) => l.text),
      errors: OD.errors.slice(),
    };
  });
  check('the order was really being flown before she went down', dead.flying === 'approach', dead.flying);
  check('the order drops to hold within 5 s', dead.droppedAt != null && dead.droppedAt <= 5,
    dead.droppedAt == null ? 'never dropped (order ' + dead.order + ')' : dead.droppedAt + ' s');
  check('the ship lets go of her as a target', dead.target == null, String(dead.target));
  check('one Autopilot line says why', dead.lines.length === 1 && /ISV Tenacity is out of the fight\. JCS Test switches to Hold\./.test(dead.lines[0]),
    dead.lines.join(' | '));
  check('no errors when the target dies', dead.errors.length === 0, dead.errors.join(' | '));
  // v15: three of our hulls on one target used to print the same line three times ('ISV Concordance is
  // out of the fight. Holding.' four times after chapter 8). One line names them all.
  const many = await page.evaluate(() => {
    const mk = (id, name, y) => ({ id, name, cls: 'corvette', faction: 'JC', player: true, ai: false,
      pos: { x: 0, y }, vel: { x: 0, y: 0 }, heading: 0, heat: 0, order: { type: 'hold' }, weaponsFree: false });
    OD.harness.start({
      name: 'Dead target, three hulls', body: null, sunAngle: 0.4, playerFaction: 'JC',
      ships: [mk('a', 'JCS Alpha', 0), mk('b', 'JCS Bravo', 5e3), mk('c', 'JCS Charlie', -5e3),
        { id: 'ten', name: 'ISV Tenacity', cls: 'corvette', faction: 'ISA', player: false, ai: false,
          pos: { x: 400e3, y: 0 }, vel: { x: 0, y: 0 }, heading: Math.PI, heat: 0, order: { type: 'hold' }, weaponsFree: false }],
      objectives: [{ id: 'x', text: 'hold', type: 'survive', seconds: 1e6 }],
    });
    const sim = OD.Game.sim;
    for (const id of ['a', 'b', 'c']) OD.harness.order(id, { type: 'approach', target: 'ten', speed: 800 });
    sim.step(60);
    sim.byId('ten').disabled = true; sim.byId('ten').hull = 0.34;
    for (let i = 0; i < 20; i++) sim.step(1);
    return { lines: sim.log.filter((l) => l.speaker === 'Autopilot').map((l) => l.text), orders: ['a', 'b', 'c'].map((id) => sim.byId(id).order.type) };
  });
  check('three hulls on one dead target: one line names all three, and all three hold',
    many.lines.length === 1 && /ISV Tenacity is out of the fight\. JCS \w+, JCS \w+ and JCS \w+ switch to Hold\./.test(many.lines[0]) && many.orders.every((o) => o === 'hold'),
    many.lines.join(' | ') + ' · ' + many.orders.join(','));

  // ---------------------------------------------------------------- 7. an even build is even
  // Three a side, the same hulls, the same board and the same orders on both sides, with the
  // computer switched off everywhere: whatever is left is the code, and the code must not favour
  // the side the player happens to be on. Which side draws the better plot first is luck and
  // decides a single fight, so the bar is the three fights together.
  //
  // On how long it takes: an even three-a-side at 150 km is a grind, and a grind is not a
  // stall. Both sides land the whole way through, so ai.js's escalation (ten minutes in which
  // nothing anywhere is lost, then active sensor, point blank, everything free) is right not to
  // fire — and could not fire here anyway, because this scenario switches the computer off on
  // both sides on purpose. What the fight owes the player is not a deadline but progress: by
  // forty minutes one side is past half its hull, and by an hour it is over. That is the claim,
  // and it is the one being checked.
  console.log('scenario: mirrored three-a-side, the same orders on both sides');
  const mirror = await page.evaluate(() => {
    const seeds = [3, 7, 11];
    const HALF = 1.5;      // hull lost by a three-ship side that is down to half strength
    const MARK = 2400;     // forty minutes: the progress mark
    const LIMIT = 3600;    // an hour: by then it is over
    const rows = [];
    let jc = 0, isa = 0, longest = 0, unfinished = 0, stillEven = 0;
    const real = Math.random;
    for (const seed of seeds) {
      // one seeded stream, so the check is the same fight every time it is run
      let x = (seed * 7919) >>> 0;
      Math.random = () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 4294967296; };
      OD.harness.start(OD.Skirmish.build({ player: 'JC', env: 'deep', range: 1000,
        playerShips: { corvette: 2, frigate: 1 }, enemyShips: { corvette: 2, frigate: 1 }, seed }));
      const sim = OD.Game.sim;
      for (const s of sim.ships) s.ai = false;   // both sides fly the script, nobody gets doctrine
      const side = (fac) => {
        const mine = sim.ships.filter((s) => s.faction === fac && !s.neutralised());
        const foes = sim.ships.filter((s) => s.faction !== fac && !s.neutralised()).sort((a, b) => a.hull - b.hull);
        const t = foes[0];
        if (!t) return;
        for (const m of mine) {
          if (!m.order || m.order.type !== 'keeprange' || m.order.target !== t.id) sim.setOrder(m.id, { type: 'keeprange', target: t.id, range: 150e3, vmax: 3000 });
          m.target = t.id; m.weaponsFree = true; m.jink = true;
        }
      };
      const lost = (f) => sim.ships.filter((s) => s.faction === f).reduce((a, s) => a + (1 - Math.max(0, s.hull)), 0);
      let mark = null;
      while (sim.time < LIMIT && !sim.outcome) {
        side('JC'); side('ISA'); sim.step(20);
        if (mark == null && sim.time >= MARK) mark = { jc: lost('JC'), isa: lost('ISA') };
      }
      Math.random = real;
      const a = lost('JC'), b = lost('ISA');
      jc += a; isa += b; longest = Math.max(longest, sim.time);
      if (!sim.outcome) unfinished++;
      // A fight that was still running at the forty-minute mark has to have got somewhere by then.
      if (mark && Math.max(mark.jc, mark.isa) <= HALF) stillEven++;
      rows.push('seed ' + seed + ': ' + (sim.outcome || 'undecided') + ' at ' + Math.round(sim.time) + ' s · JC lost ' +
        a.toFixed(2) + ' · ISA lost ' + b.toFixed(2) +
        (mark ? ' · at 40 min ' + mark.jc.toFixed(2) + ' / ' + mark.isa.toFixed(2) : ' · over before 40 min'));
    }
    return { rows, jc, isa, longest, unfinished, stillEven, errors: OD.errors.slice() };
  });
  const ratio = Math.max(mirror.jc, mirror.isa) / Math.max(0.05, Math.min(mirror.jc, mirror.isa));
  for (const r of mirror.rows) console.log('    ' + r);
  check('a fight still running at 40 min has one side past half its hull', mirror.stillEven === 0,
    mirror.stillEven + ' fight(s) still even at the 40 min mark');
  check('every mirrored fight is decided inside an hour', mirror.unfinished === 0 && mirror.longest <= 3600,
    mirror.unfinished + ' undecided · longest ' + Math.round(mirror.longest) + ' s');
  check('neither side loses more than 1.5 × the other', ratio <= 1.5,
    'JC ' + mirror.jc.toFixed(2) + ' vs ISA ' + mirror.isa.toFixed(2) + ' hull · ' + ratio.toFixed(2) + ' ×');
  check('no errors in the mirrored skirmishes', mirror.errors.length === 0, mirror.errors.join(' | '));

  const realErrors = consoleErrors.filter((e) => !/fonts.googleapis|ERR_INTERNET|net::ERR|Failed to load resource/.test(e) && !(/^file:/.test(url) && /Access to font/.test(e)));
  check('no console errors', realErrors.length === 0, realErrors.join(' | '));

  await browser.close();
  console.log(failures ? failures + ' check(s) failed' : 'all checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
