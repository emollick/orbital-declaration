/* Crew checks for Orbital Declaration (OD.Crew).
   node tools/crew-check.js   (needs Playwright + Chromium; NODE_PATH may need the global modules dir)

   The module is checked on its own: if js/crew.js is not in index.html yet the check loads it into
   the page, and if OD.Crew is not wired into sim.js yet the check calls init and update itself. Both
   cases print a note line. */
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const url = process.env.OD_URL || 'file://' + path.join(ROOT, 'index.html');

let failures = 0;
function check(name, ok, detail) { console.log((ok ? '  ok   ' : '  FAIL ') + name + (detail ? '  ' + detail : '')); if (!ok) failures++; }
const near = (a, b, tol) => Math.abs(a - b) <= (tol == null ? 1e-6 : tol);

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
  await page.goto(url);
  await page.waitForTimeout(600);

  if (!(await page.evaluate(() => !!(window.OD && OD.Crew)))) {
    await page.addScriptTag({ path: path.join(ROOT, 'js', 'crew.js') });
    console.log('note: js/crew.js is not in index.html yet — this check loaded it into the page itself');
  }

  const mod = await page.evaluate(() => ({
    present: !!(window.OD && OD.Crew),
    missing: ['init', 'update', 'auto', 'accelCap', 'casualties', 'fireFactor', 'sensorFactor', 'board', 'assign',
      'release', 'setG', 'artFx', 'hold', 'watchToPull', 'toRecord', 'fromRecord', 'afterBattle', 'recover']
      .filter((k) => !(OD.Crew && typeof OD.Crew[k] === 'function')),
    T: OD.Crew ? OD.Crew.T : null,
    teach: OD.Crew ? Object.keys(OD.Crew.TEACH || {}) : [],
  }));
  check('OD.Crew loaded with the whole interface', mod.present && mod.missing.length === 0, mod.missing.join(','));
  check('the tuning numbers are the ones in the spec',
    mod.T && mod.T.workG === 1.2 && mod.T.couchG === 3 && mod.T.medic === 45 && mod.T.autoEvery === 15 && mod.T.xp === 0.15,
    mod.T ? JSON.stringify({ workG: mod.T.workG, couchG: mod.T.couchG, medic: mod.T.medic, autoEvery: mod.T.autoEvery, xp: mod.T.xp }) : '');
  check('a teach string for every idea', mod.teach.length >= 6, mod.teach.join(','));

  // A sim stand-in and a ship maker, so most of this runs without the rest of the game.
  await page.evaluate(() => {
    window.CC = {
      sim(ships) {
        return {
          time: 0, ships, playerFaction: 'JC', lines: [], fx: [],
          addLog(text, speaker, kind) { this.lines.push({ text, speaker, kind }); },
          texts() { return this.lines.map((l) => l.speaker + ': ' + l.text); },
        };
      },
      ship(cls, spec) {
        const sh = OD.Sim.makeShip(Object.assign({ cls, faction: 'JC' }, spec || {}));
        if (!sh.crew) OD.Crew.init(sh, spec);
        return sh;
      },
      // Advance the crew by hand, in one-second slices, the way the sim substep would.
      run(sim, seconds, dt) {
        dt = dt || 1;
        let t = 0;
        while (t < seconds - 1e-9) { const h = Math.min(dt, seconds - t); sim.time += h; OD.Crew.update(sim, h); t += h; }
      },
      gAt(sh, g) { sh.accel = () => g * 9.80665; sh.throttle = g > 0 ? 1 : 0; },
      part(sh, id) { return sh.components.find((c) => c.id === id); },
      tasks(sh) { return sh.crew.parties.map((p) => p.task + (p.part ? ':' + p.part : '')).join(' '); },
    };
  });

  // ------------------------------------------------------------------ complements
  console.log('scenario: one hull of every class, fresh out of the yard');
  const counts = await page.evaluate(() => {
    const out = {};
    for (const cls of ['corvette', 'lancer', 'frigate', 'destroyer', 'cruiser', 'freighter', 'station']) {
      const sh = CC.ship(cls);
      out[cls] = { total: sh.crew.total, parties: sh.crew.parties.length, sum: sh.crew.fit + sh.crew.wounded + sh.crew.lost, tasks: CC.tasks(sh), gMode: sh.crew.gMode, auto: sh.crew.auto, xp: sh.crew.xp };
    }
    OD.Ships.CLASSES.ccCustom = Object.assign({}, OD.Ships.CLASSES.frigate, { id: 'ccCustom', base: 'frigate', name: 'Custom-class frigate' });
    const cu = CC.ship('ccCustom');
    out.custom = { total: cu.crew.total, parties: cu.crew.parties.length };
    delete OD.Ships.CLASSES.ccCustom;
    return out;
  });
  const want = { corvette: [24, 2], lancer: [26, 2], frigate: [60, 3], destroyer: [140, 4], cruiser: [260, 6], freighter: [12, 1], station: [200, 6] };
  for (const cls of Object.keys(want)) {
    const c = counts[cls];
    check(cls + ' carries ' + want[cls][0] + ' crew in ' + want[cls][1] + ' parties',
      c.total === want[cls][0] && c.parties === want[cls][1] && c.sum === c.total, c.total + ' / ' + c.parties + ' parties');
  }
  check('a custom design takes its base class', counts.custom.total === 60 && counts.custom.parties === 3, JSON.stringify(counts.custom));
  check('default posture: party 1 fire control, party 2 the sensor watch, the rest standby',
    counts.corvette.tasks === 'fire sensors' && counts.destroyer.tasks === 'fire sensors standby standby', counts.destroyer.tasks);
  check('a hull with no mounts puts its one party on the sensor watch', counts.freighter.tasks === 'sensors', counts.freighter.tasks);
  check('the couches are the default limit and the routine is on', counts.corvette.gMode === 'couches' && counts.corvette.auto === true);

  // ------------------------------------------------------------------ the acceleration cap
  const cap = await page.evaluate(() => {
    const sh = CC.ship('corvette');
    const at = (m) => { OD.Crew.setG(sh, m); const v = OD.Crew.accelCap(sh); return isFinite(v) ? Math.round(v * 100) / 100 : 'none'; };
    const words = { work: OD.Crew.setG(sh, 'work'), couches: OD.Crew.setG(sh, 'couches'), max: OD.Crew.setG(sh, 'max'), bad: OD.Crew.setG(sh, 'fast') };
    const bare = OD.Sim.makeShip({ cls: 'corvette', faction: 'JC' });
    delete bare.crew;
    const none = OD.Crew.accelCap(bare);
    return { work: at('work'), couches: at('couches'), max: at('max'), none: isFinite(none) ? none : 'none', words };
  });
  check('the working limit caps acceleration at 1.2 g', cap.work === 11.77, String(cap.work));
  check('the couch limit caps it at 3 g', cap.couches === 29.42, String(cap.couches));
  check('no limit means no cap', cap.max === 'none' && cap.none === 'none');
  check('a bad g mode is refused', cap.words.bad === null);
  console.log('    ' + cap.words.work);
  console.log('    ' + cap.words.couches);
  console.log('    ' + cap.words.max);

  // ------------------------------------------------------------------ the routine on a hit drive
  console.log('scenario: the drive is wrecked and the ship runs its own routine');
  const routine = await page.evaluate(() => {
    const cor = CC.ship('corvette'), des = CC.ship('destroyer');
    const sim = CC.sim([cor, des]);
    for (const sh of [cor, des]) { CC.part(sh, 'drive').hp = 0; OD.Damage.aggregate(sh); }
    CC.run(sim, 1);
    const eta0 = cor.crew.parties.find((p) => p.task === 'repair').eta;
    CC.run(sim, 95);
    const p = cor.crew.parties.find((p) => p.task === 'repair');
    return {
      corvette: CC.tasks(cor), destroyer: CC.tasks(des),
      time: repairTimeOf(cor), progress: Math.round(p.progress * 1000) / 1000, eta: Math.round(p.eta), eta0: Math.round(eta0),
      lines: sim.texts(),
      board: OD.Crew.board(cor).words,
    };
    function repairTimeOf(sh) { return OD.Damage.repairTime(sh, 'drive'); }
  });
  check('the corvette pulls the sensor party to the drive', routine.corvette === 'fire repair:drive', routine.corvette);
  check('fire control is left alone while a sensor party is free', /^fire /.test(routine.corvette));
  check('the destroyer sends a standby party instead', routine.destroyer === 'fire sensors repair:drive standby', routine.destroyer);
  check('the routine says so in the log', routine.lines.some((l) => /Crew: .*Party 2 is on the drive/.test(l)), routine.lines.join(' | '));
  // The work is priced by damage.js; the crew module only has to spend it at one second a second.
  check('the time to done is the work damage.js prices', routine.eta0 === routine.time, routine.eta0 + ' vs ' + routine.time + ' s');
  check('progress is time over the work', near(routine.progress, 96 / routine.time, 1.5 / routine.time), routine.progress + ' after 96 s of ' + routine.time + ' s');
  check('the time to done counts down', near(routine.eta, routine.time - 96, 2), routine.eta0 + ' → ' + routine.eta);
  console.log('    ' + routine.board);

  // ------------------------------------------------------------------ the mend lands at the cap
  const mend = await page.evaluate(() => {
    const sh = CC.ship('corvette');
    const sim = CC.sim([sh]);
    CC.part(sh, 'drive').hp = 0; OD.Damage.aggregate(sh);
    CC.run(sim, 1);                 // the routine sends the party
    sh.crew.auto = false;           // and then keeps its hands off, so the mend can be read
    CC.run(sim, 1200, 20);
    const first = { hp: CC.part(sh, 'drive').hp, sys: sh.systems.drive, tasks: CC.tasks(sh), parties: OD.Crew.artFx(sh).parties.length, lines: sim.texts() };
    sh.crew.auto = true;            // a second shift takes a jury-rigged drive further
    CC.run(sim, 1500, 20);
    return { first, second: { hp: Math.round(CC.part(sh, 'drive').hp * 100) / 100, tasks: CC.tasks(sh) }, lines: sim.texts() };
  });
  check('the mend lands at the jury-rig cap, 30 % of a wrecked drive', near(mend.first.hp, 0.3, 1e-6) && near(mend.first.sys, 0.3, 1e-6), String(mend.first.hp));
  check('one crew line for the work, naming the party and the number', mend.first.lines.filter((l) => /has the drive back to 30 %/.test(l)).length === 1, mend.first.lines.filter((l) => /back to/.test(l)).join(' | '));
  check('the party goes back to its station when the work is done', mend.first.tasks === 'fire sensors' && mend.first.parties === 0, mend.first.tasks);
  check('a second shift takes a jury-rigged drive from 30 % to 70 %', mend.second.hp === 0.7 && mend.second.tasks === 'fire sensors', mend.second.hp + ' / ' + mend.second.tasks);
  console.log('    ' + mend.lines.filter((l) => /back to/.test(l)).join(' | '));

  // ------------------------------------------------------------------ paused under acceleration
  // Two hulls: one repairing the sensor suite, a part the ship is not using, so the burn is the
  // only thing that can stop the work; one on the drive, which the throttle stops on its own.
  const paused = await page.evaluate(() => {
    const sh = CC.ship('corvette');
    const sim = CC.sim([sh]);
    CC.part(sh, 'sensors').hp = 0.3; OD.Damage.aggregate(sh);
    OD.Crew.assign(sh, 'p2', 'repair', 'sensors');
    CC.run(sim, 100);
    const p = () => sh.crew.parties.find((q) => q.task === 'repair');
    const before = p().progress;
    CC.gAt(sh, 2);
    CC.run(sim, 200);
    const held = p().progress, strapped = sh.crew.strapped, g = sh.crew.gNow;
    const words = OD.Crew.board(sh).gWords, partyWords = OD.Crew.board(sh).parties.find((x) => x.part === 'sensors').words;
    // Strapped in between the two limits: repairs pause, the watches are untouched.
    const fire = OD.Crew.fireFactor(sh), sensor = OD.Crew.sensorFactor(sh), art = OD.Crew.artFx(sh);
    const over = sh.crew.overCouch, artOver = art.overCouch;
    // Past the couch limit: both watches at 85 %.
    CC.gAt(sh, 3.5);
    CC.run(sim, 2);
    const hard = { fire: OD.Crew.fireFactor(sh), sensor: OD.Crew.sensorFactor(sh), over: sh.crew.overCouch, strapped: sh.crew.strapped, artOver: OD.Crew.artFx(sh).overCouch, words: OD.Crew.board(sh).gWords, crewBlock: OD.Crew.board(sh).crew.overCouch };
    CC.gAt(sh, 0.9);
    CC.run(sim, 2);
    const calm = { fire: OD.Crew.fireFactor(sh), over: sh.crew.overCouch };
    const work = OD.Crew.board(sh).gWords;
    // Back under the working limit, but the torch is still lit: a drive nobody has shut down is
    // still not a job. It is the throttle coming off that starts the work again.
    const dr = CC.ship('corvette'), drSim = CC.sim([dr]);
    CC.part(dr, 'drive').hp = 0; OD.Damage.aggregate(dr);
    CC.run(drSim, 100);
    const q = () => dr.crew.parties.find((x) => x.task === 'repair');
    const ran = q().progress;
    CC.gAt(dr, 0.9);
    CC.run(drSim, 40);                 // under T.standDown, so she is still on the drive
    const lit = q().progress;
    dr.throttle = 0;
    CC.run(drSim, 100);
    const after = q().progress;
    return { before: Math.round(before * 1e4) / 1e4, held: Math.round(held * 1e4) / 1e4, ran: Math.round(ran * 1e4) / 1e4, lit: Math.round(lit * 1e4) / 1e4, after: Math.round(after * 1e4) / 1e4, strapped, g: Math.round(g * 100) / 100, words, partyWords, fire, sensor, over, artOver, hard, calm, working: art.parties[0] ? art.parties[0].working : null, work };
  });
  check('above 1.2 g the crew is strapped in', paused.strapped === true && near(paused.g, 2, 0.01), String(paused.g));
  check('repairs hold while the crew is strapped in', paused.held === paused.before, paused.before + ' → ' + paused.held);
  check('under the working limit with the torch still lit the work waits', paused.lit === paused.ran, paused.ran + ' → ' + paused.lit);
  check('repairs run again with the burn over and the drive cold', paused.after > paused.lit, paused.lit + ' → ' + paused.after);
  check('strapped in below the couch limit costs the watches nothing', near(paused.fire, 1, 1e-9) && near(paused.sensor, 0.7, 1e-9) && paused.over === false && paused.artOver === false, '2 g: ' + paused.fire.toFixed(3) + ' / ' + paused.sensor.toFixed(3));
  check('above the couch limit both run at 85 %', near(paused.hard.fire, 0.85, 1e-9) && near(paused.hard.sensor, 0.7 * 0.85, 1e-9), '3.5 g: ' + paused.hard.fire.toFixed(3) + ' / ' + paused.hard.sensor.toFixed(3));
  check('the over-the-couch flag is on the record, the board and the overlay', paused.hard.over === true && paused.hard.strapped === true && paused.hard.artOver === true && paused.hard.crewBlock === true, JSON.stringify({ over: paused.hard.over, art: paused.hard.artOver, board: paused.hard.crewBlock }));
  check('the flag clears and fire control comes back when the burn eases', paused.calm.over === false && near(paused.calm.fire, 1, 1e-9), paused.calm.fire.toFixed(3));
  check('the overlay shows the party paused', paused.working === false);
  console.log('    ' + paused.words);
  console.log('    ' + paused.partyWords);
  console.log('    ' + paused.hard.words);
  console.log('    ' + paused.work);

  // ------------------------------------------------------------------ the couch limit
  console.log('scenario: a corvette burns at 3.4 g, then at 1.3 g');
  const hurt = await page.evaluate(() => {
    const hard = CC.ship('corvette'), easy = CC.ship('corvette');
    const sim = CC.sim([hard, easy]);
    CC.gAt(hard, 3.4); CC.gAt(easy, 1.3);
    CC.run(sim, 300);
    const mid = { fit: hard.crew.fit, wounded: hard.crew.wounded };
    CC.gAt(hard, 0);
    CC.run(sim, 5);
    return {
      hard: { fit: hard.crew.fit, wounded: hard.crew.wounded, lost: hard.crew.lost, sum: hard.crew.fit + hard.crew.wounded + hard.crew.lost },
      easy: { fit: easy.crew.fit, wounded: easy.crew.wounded, strapped: easy.crew.strapped },
      mid, lines: sim.texts(), board: OD.Crew.board(hard).words,
    };
  });
  check('a 3.4 g burn wounds the crew', hurt.hard.wounded >= 3 && hurt.hard.wounded <= 5, hurt.hard.wounded + ' wounded of 24');
  check('nobody is lost to acceleration alone', hurt.hard.lost === 0 && hurt.hard.sum === 24, JSON.stringify(hurt.hard));
  check('1.3 g straps the crew in and hurts nobody', hurt.easy.wounded === 0 && hurt.easy.fit === 24 && hurt.easy.strapped === true, JSON.stringify(hurt.easy));
  check('one log line for the burst, with the count and the g', hurt.lines.filter((l) => / wounded at 3\.4 g\./.test(l)).length === 1, hurt.lines.join(' | '));
  console.log('    ' + hurt.lines.filter((l) => /wounded at/.test(l)).join(' | '));
  console.log('    ' + hurt.board);

  // CR 10: the couch limit teaches a share of the crew, not a corvette's own count sold as the
  // rule. One rate, three counts: a corvette loses 1 in the minute, a frigate 4, a cruiser 17.
  const share = await page.evaluate(() => {
    const out = {};
    for (const cls of ['corvette', 'frigate', 'cruiser']) {
      const sh = CC.ship(cls), sim = CC.sim([sh]);
      CC.gAt(sh, 3.8);           // 0.8 g over the couch limit
      CC.run(sim, 60);
      out[cls] = { hurt: sh.crew.wounded + sh.crew.lost, total: sh.crew.total };
    }
    out.teach = OD.Crew.TEACH.couchLimit;
    return out;
  });
  check('the couch limit teaches the rate as a share of the crew',
    /about 1 in 12 of the crew are hurt every minute for every g over, twice that above 5 g/.test(share.teach), share.teach);
  check('and a minute 0.8 g over costs every hull that share of her own crew',
    ['corvette', 'frigate', 'cruiser'].every((c) => Math.abs(share[c].hurt - (share[c].total * 0.8) / 12) <= Math.max(1, share[c].total * 0.02)),
    ['corvette', 'frigate', 'cruiser'].map((c) => c + ' ' + share[c].hurt + ' of ' + share[c].total).join(', '));

  // ------------------------------------------------------------------ the sick bay
  const medical = await page.evaluate(() => {
    const sh = CC.ship('frigate');
    const sim = CC.sim([sh]);
    sh.crew.fit -= 6; sh.crew.wounded += 6;
    const alone = (() => { CC.run(sim, 300); return sh.crew.wounded; })();
    const words = OD.Crew.assign(sh, 'p3', 'medical');
    CC.run(sim, 200);
    const after = { wounded: sh.crew.wounded, fit: sh.crew.fit };
    CC.run(sim, 200);
    return { alone, words, after, done: { wounded: sh.crew.wounded, fit: sh.crew.fit }, lines: sim.texts(), party: OD.Crew.board(sh).parties[2].words };
  });
  check('with nobody in the sick bay the wounded stay down', medical.alone === 6, String(medical.alone));
  check('a party in the sick bay brings one back every 45 s', medical.after.wounded === 2 && medical.after.fit === 58, JSON.stringify(medical.after));
  check('the sick bay empties and the crew is whole again', medical.done.wounded === 0 && medical.done.fit === 60, JSON.stringify(medical.done));
  check('the log says who is back on duty', medical.lines.some((l) => /back on duty/.test(l)), medical.lines.join(' | '));
  console.log('    ' + medical.words);
  console.log('    ' + medical.party);

  // ------------------------------------------------------------------ casualties from a hit
  const cas = await page.evaluate(() => {
    const sh = CC.ship('destroyer');
    const sim = CC.sim([sh]);
    const before = { fit: sh.crew.fit, wounded: sh.crew.wounded, lost: sh.crew.lost };
    const r = OD.Crew.casualties(sh, 'drive', 0.6);
    const mid = { fit: sh.crew.fit, wounded: sh.crew.wounded, lost: sh.crew.lost };
    // and through real hits, the way damage.js calls it
    const hull = CC.ship('corvette');
    const sim2 = CC.sim([hull]);
    for (let i = 0; i < 4; i++) OD.Damage.hit(sim2, hull, { joules: 3e8, facet: 'tail', aim: 'drive', kind: 'beam' });
    CC.run(sim, 60); CC.run(sim2, 60);
    const nobody = OD.Crew.casualties(CC.ship('corvette'), 'drive', 0);
    return {
      before, mid, r, lines: sim.texts(),
      hit: { fit: hull.crew.fit, wounded: hull.crew.wounded, lost: hull.crew.lost, sum: hull.crew.fit + hull.crew.wounded + hull.crew.lost, drive: Math.round(CC.part(hull, 'drive').hp * 100) / 100 },
      nobody,
    };
  });
  check('a hit on a part wounds the crew at it', cas.r.wounded + cas.r.lost > 0 && cas.mid.fit === cas.before.fit - (cas.r.wounded + cas.r.lost), JSON.stringify(cas.r));
  check('some of them are lost, and the complement still adds up', cas.r.lost >= 1 && cas.mid.fit + cas.mid.wounded + cas.mid.lost === 140, JSON.stringify(cas.mid));
  check('one line for the casualties, named by part', cas.lines.some((l) => /on the drive\./.test(l)), cas.lines.join(' | '));
  check('real hits through damage.js reach the crew', cas.hit.wounded + cas.hit.lost > 0 && cas.hit.sum === 24, JSON.stringify(cas.hit));
  check('a hit that takes nothing hurts nobody', cas.nobody.wounded === 0 && cas.nobody.lost === 0);
  console.log('    ' + cas.lines.filter((l) => /wounded|lost/.test(l)).join(' | '));

  // ------------------------------------------------------------------ small hits, carried (CR 1)
  // Beam fire chips a part a few per cent at a time. Rounded hit by hit that is nobody, for ever;
  // carried, it is the same people a few big hits would have cost.
  console.log('scenario: a fight of small hits, and where the shot lands');
  const chips = await page.evaluate(() => {
    const sh = CC.ship('corvette');
    const one = OD.Crew.casualties(sh, 'drive', 0.08);
    let hits = 1;
    while (sh.crew.wounded + sh.crew.lost < 2 && hits < 200) { OD.Crew.casualties(sh, 'drive', 0.08); hits++; }
    const many = { fit: sh.crew.fit, wounded: sh.crew.wounded, lost: sh.crew.lost, sum: sh.crew.fit + sh.crew.wounded + sh.crew.lost, hits };
    // Where the shot lands decides how many. A drive room is manned; a panel hung outboard is not.
    const w = {};
    for (const id of ['drive', 'reactor', 'sensors', 'rad1', 'tank1']) {
      const c = CC.ship('cruiser');
      const r = OD.Crew.casualties(c, id, 1);
      w[id] = r.wounded + r.lost;
    }
    // A hit that opens the compartment to vacuum costs more than the same hit through sound plating.
    const sound = CC.ship('cruiser');
    const open = CC.ship('cruiser');
    open.damage = { nose: 1, flank: 1, tail: 1 };
    const cleanHit = OD.Crew.casualties(sound, 'drive', 1);
    const breachHit = OD.Crew.casualties(open, 'drive', 1);
    // and the lost are carried too: a string of wrecking hits kills somebody
    const big = CC.ship('corvette');
    for (let i = 0; i < 6; i++) OD.Crew.casualties(big, 'drive', 1);
    return { one, many, w, clean: cleanHit.wounded + cleanHit.lost, breach: breachHit.wounded + breachHit.lost, lost: big.crew.lost, bigSum: big.crew.fit + big.crew.wounded + big.crew.lost };
  });
  check('one small hit wounds nobody', chips.one.wounded + chips.one.lost === 0, JSON.stringify(chips.one));
  check('the same small hits over a fight do wound people', chips.many.wounded + chips.many.lost >= 2 && chips.many.hits < 40, chips.many.hits + ' hits of 8 % → ' + chips.many.wounded + ' wounded, ' + chips.many.lost + ' lost');
  check('the complement still adds up after a fight of chips', chips.many.sum === 24, JSON.stringify(chips.many));
  check('a manned part costs more people than plating hung outboard',
    chips.w.drive === chips.w.reactor && chips.w.drive >= 10 * chips.w.rad1 && chips.w.rad1 === chips.w.tank1
    && chips.w.sensors > chips.w.rad1 && chips.w.sensors < chips.w.drive, JSON.stringify(chips.w));
  check('a hit through a breached facet costs more', chips.breach > chips.clean, chips.clean + ' → ' + chips.breach);
  check('a string of wrecking hits loses people, not only wounds them', chips.lost > 0 && chips.bigSum === 24, String(chips.lost));
  console.log('    a whole part taken, by where it is: ' + Object.keys(chips.w).map((k) => k + ' ' + chips.w[k]).join(' · '));

  // ------------------------------------------------------------------ the two factors
  const factors = await page.evaluate(() => {
    const sh = CC.ship('corvette');
    const out = { posted: [OD.Crew.fireFactor(sh), OD.Crew.sensorFactor(sh)] };
    OD.Crew.assign(sh, 'p1', 'standby');
    out.noFire = [OD.Crew.fireFactor(sh), OD.Crew.sensorFactor(sh)];
    OD.Crew.assign(sh, 'p1', 'fire');
    sh.crew.xp = 3;
    out.veteran = [OD.Crew.fireFactor(sh), OD.Crew.sensorFactor(sh)];
    sh.crew.xp = 0;
    // The band from a full complement down to nobody: no cliff anywhere in it, so every person the
    // sick bay puts back on their feet is worth something.
    out.band = [24, 18, 12, 8, 4, 0].map((fit) => { sh.crew.fit = fit; return Math.round(OD.Crew.fireFactor(sh) * 1e4) / 1e4; });
    sh.crew.fit = 24;
    const bare = OD.Sim.makeShip({ cls: 'corvette', faction: 'JC' });
    delete bare.crew;
    out.none = [OD.Crew.fireFactor(bare), OD.Crew.sensorFactor(bare), OD.Crew.fireFactor(null)];
    return out;
  });
  check('a posted party is worth 1', near(factors.posted[0], 1) && near(factors.posted[1], 1), factors.posted.join(','));
  check('nobody on fire control drops it to 0.7, the sensor watch untouched', near(factors.noFire[0], 0.7) && near(factors.noFire[1], 1), factors.noFire.join(','));
  check('three points of experience are worth 9 %', near(factors.veteran[0], 1.09, 1e-9), factors.veteran[0].toFixed(3));
  check('the watches fall smoothly with the fit crew: 1 at full, 0.7 at a third',
    near(factors.band[0], 1, 1e-9) && near(factors.band[3], 0.7, 1e-9)
    && factors.band.every((v, i) => i === 0 || v < factors.band[i - 1]), factors.band.join(','));
  check('with nobody fit the watches are all but gone, and never a zero',
    factors.band[5] > 0 && factors.band[5] <= 0.05 && factors.band[4] > factors.band[5], factors.band.slice(4).join(','));
  check('a ship with no crew reads 1 for both', factors.none.every((v) => v === 1), factors.none.join(','));
  console.log('    24/18/12/8/4/0 fit on fire control: ' + factors.band.join(' · '));

  // ------------------------------------------------------------------ the board
  console.log('scenario: the board a player reads');
  const board = await page.evaluate(() => {
    const sh = CC.ship('corvette');
    const sim = CC.sim([sh]);
    const clean = OD.Crew.board(sh);
    CC.part(sh, 'drive').hp = 0;
    CC.part(sh, 'rad2').hp = 0.4;
    OD.Damage.aggregate(sh);
    CC.run(sim, 240);
    sh.crew.wounded = 3; sh.crew.fit = 21;
    const b = OD.Crew.board(sh);
    const drive = b.parts.find((p) => p.id === 'drive');
    const rad = b.parts.find((p) => p.id === 'rad2');
    const sound = b.parts.find((p) => p.id === 'tank1');
    const bare = OD.Sim.makeShip({ cls: 'corvette', faction: 'JC' });
    delete bare.crew;
    return {
      cleanWords: clean.words, cleanG: clean.gWords, words: b.words, gWords: b.gWords,
      crew: b.crew, parties: b.parties.map((p) => p.words), rows: b.parts.length, components: sh.components.length,
      drive: { cap: drive.cap, repairable: drive.repairable, eta: Math.round(drive.eta), party: drive.party, buys: drive.buys, state: drive.state },
      rad: { cap: rad.cap, repairable: rad.repairable, eta: Math.round(rad.eta), party: rad.party, buys: rad.buys },
      sound: { repairable: sound.repairable, buys: sound.buys },
      none: OD.Crew.board(bare),
    };
  });
  check('a board row for every part', board.rows === board.components, board.rows + '/' + board.components);
  check('the hurt drive carries its cap, its party and its time', board.drive.cap === 0.3 && board.drive.repairable === true && board.drive.party === 'p2' && board.drive.eta > 0, JSON.stringify(board.drive));
  check('a hurt panel is repairable to 70 %, with nobody on it yet', board.rad.cap === 0.7 && board.rad.repairable === true && board.rad.party === null, JSON.stringify(board.rad));
  check('a sound part is not worth a party', board.sound.repairable === false, JSON.stringify(board.sound));
  check('the crew block carries the numbers the panel prints', board.crew.total === 24 && board.crew.fit === 21 && board.crew.wounded === 3 && board.crew.gMode === 'couches');
  check('a ship with no crew has no board', board.none === null);
  console.log('    Essentials (fresh hull):  ' + board.cleanWords);
  console.log('    Essentials (fresh hull):  ' + board.cleanG);
  console.log('    Essentials (drive hit):   ' + board.words);
  console.log('    Essentials (drive hit):   ' + board.gWords);
  for (const w of board.parties) console.log('    party line:               ' + w);
  console.log('    buys (drive):             ' + board.drive.buys);
  console.log('    buys (radiator panel 2):  ' + board.rad.buys);
  console.log('    buys (sound tank):        ' + board.sound.buys);

  // ------------------------------------------------------------------ orders by hand
  const orders = await page.evaluate(() => {
    const sh = CC.ship('destroyer');
    const sim = CC.sim([sh]);
    CC.part(sh, 'drive').hp = 0.2; CC.part(sh, 'tank1').hp = 0.2; OD.Damage.aggregate(sh);
    const send = OD.Crew.assign(sh, 'p3', 'repair', 'drive');
    const twice = OD.Crew.assign(sh, 'p4', 'repair', 'drive');
    const sound = OD.Crew.assign(sh, 'p4', 'repair', 'rad1');
    const gone = OD.Crew.assign(sh, 'p4', 'repair', 'nosuchpart');
    const bad = OD.Crew.assign(sh, 'p9', 'repair', 'drive');
    const tank = OD.Crew.assign(sh, 'p4', 'repair', 'tank1');
    const back = OD.Crew.release(sh, 'p3');
    const stood = OD.Crew.release(sh, 'p4');
    const bareSh = OD.Sim.makeShip({ cls: 'corvette', faction: 'JC' });
    delete bareSh.crew;
    const safe = [OD.Crew.assign(bareSh, 'p1', 'repair', 'drive'), OD.Crew.release(bareSh, 'p1'), OD.Crew.setG(bareSh, 'work')];
    return { send, twice, sound, gone, bad, tank, back, stood, tasks: CC.tasks(sh), safe };
  });
  check('a party can be sent to a hurt part by hand', /^Party 3 to the drive: \d+ min to 70 %\.$/.test(orders.send), orders.send);
  check('two parties are not sent to the same part', orders.twice === null);
  check('a party is not sent where a jury-rig changes nothing', orders.sound === null && orders.gone === null && orders.bad === null);
  check('a venting tank can be isolated', /^Party 4 to tank 1: \d+ (s|min) to 50 %\.$/.test(orders.tank), orders.tank);
  check('release puts a party back on its station', orders.back === 'Party 3 stood down.' && orders.stood === 'Party 4 stood down.' && orders.tasks === 'fire sensors standby standby', orders.tasks);
  check('orders on a ship with no crew are refused, not thrown', orders.safe.every((v) => v === null));
  console.log('    ' + orders.send);
  console.log('    ' + orders.tank);

  // ------------------------------------------------------------------ records across a campaign
  const rec = await page.evaluate(() => {
    const sh = CC.ship('frigate');
    sh.crew.fit = 45; sh.crew.wounded = 10; sh.crew.lost = 5; sh.crew.xp = 1;
    const r = OD.Crew.toRecord(sh);
    OD.Crew.afterBattle(r, true);
    const won = Object.assign({}, r);
    OD.Crew.recover(r, false);
    const field = Object.assign({}, r);
    OD.Crew.recover(r, true);
    const port = Object.assign({}, r);
    for (let i = 0; i < 5; i++) OD.Crew.afterBattle(r, true);
    const capped = r.xp;
    OD.Crew.afterBattle(r, false);
    const back = CC.ship('frigate', { crew: port });
    const lost = OD.Crew.afterBattle(null, true);
    return { r0: { fit: 45, wounded: 10, lost: 5, xp: 1 }, won, field, port, capped, back: OD.Crew.toRecord(back), sum: back.crew.fit + back.crew.wounded + back.crew.lost, lost };
  });
  check('a crew that brings the hull home gains a point of experience', rec.won.xp === 2, JSON.stringify(rec.won));
  check('away from a yard half the wounded come back', rec.field.wounded === 5 && rec.field.fit === 50, JSON.stringify(rec.field));
  check('at a port or yard the rest come back, the lost stay lost', rec.port.wounded === 0 && rec.port.fit === 55 && rec.port.lost === 5, JSON.stringify(rec.port));
  check('experience stops at 3', rec.capped === 3, String(rec.capped));
  check('a record round-trips back into a ship', rec.back.fit === 55 && rec.back.lost === 5 && rec.back.xp === 2 && rec.sum === 60, JSON.stringify(rec.back));
  check('no record is not a crash', rec.lost === null);

  // ------------------------------------------------------------------ the routine on a computer-flown hull
  const ai = await page.evaluate(() => {
    const sh = CC.ship('corvette', { ai: true });
    const foe = OD.Sim.makeShip({ cls: 'corvette', faction: 'ISA' });
    foe.pos = { x: 2000e3, y: 0 };
    const sim = CC.sim([sh, foe]);
    sim.nearestHostile = () => foe;
    CC.part(sh, 'drive').hp = 0.3; OD.Damage.aggregate(sh);
    CC.run(sim, 20);
    const far = sh.crew.gMode;
    foe.pos = { x: 100e3, y: 0 };
    CC.run(sim, 20);
    const near2 = sh.crew.gMode;
    sh.crew.auto = false;
    const player = CC.ship('corvette');
    player.crew.auto = false;
    const sim2 = CC.sim([player]);
    OD.Crew.setG(player, 'work');
    CC.part(player, 'drive').hp = 0; OD.Damage.aggregate(player);
    CC.run(sim2, 60);
    return { far, near2, playerG: player.crew.gMode, playerTasks: CC.tasks(player) };
  });
  check('a computer-flown hull works at 1.2 g while the enemy is far off', ai.far === 'work', ai.far);
  check('it straps in when the enemy closes', ai.near2 === 'couches', ai.near2);
  check('a player hull keeps the limit the player set and the posture they chose', ai.playerG === 'work' && ai.playerTasks === 'fire sensors', ai.playerG + ' / ' + ai.playerTasks);

  // ------------------------------------------------------------------ nothing here needs the rest of the game
  const safe = await page.evaluate(() => {
    const out = { throws: [] };
    const sh = CC.ship('corvette');
    const sim = CC.sim([sh]);
    sh.destroyed = true;
    try { CC.run(sim, 60); OD.Crew.auto(sim, sh); OD.Crew.board(sh); OD.Crew.artFx(sh); OD.Crew.casualties(sh, 'drive', 1); } catch (e) { out.throws.push('destroyed: ' + e.message); }
    const bare = OD.Sim.makeShip({ cls: 'corvette', faction: 'JC' });
    delete bare.crew;
    try {
      const sim2 = CC.sim([bare]);
      OD.Crew.update(sim2, 10); OD.Crew.auto(sim2, bare); OD.Crew.board(bare); OD.Crew.artFx(bare);
      OD.Crew.casualties(bare, 'drive', 1); OD.Crew.toRecord(bare); OD.Crew.fireFactor(bare); OD.Crew.accelCap(bare);
      OD.Crew.update(null, 1); OD.Crew.update(sim2, 0); OD.Crew.auto(sim2, null);
      out.bare = { hold: OD.Crew.hold(bare, 'drive', 60), holdAll: OD.Crew.hold(null, null, 60), watch: OD.Crew.watchToPull(bare, sim2), noSim: OD.Crew.watchToPull(bare, null) };
    } catch (e) { out.throws.push('no crew: ' + e.message); }
    // with the damage module out of the page altogether
    const dmg = OD.Damage;
    try {
      const plain = { cls: 'corvette', name: 'Test', faction: 'JC', mounts: [{ kind: 'beam' }], throttle: 0, accel: () => 0, destroyed: false };
      OD.Damage = undefined;
      OD.Crew.init(plain);
      const sim3 = CC.sim([plain]);
      plain.crew.parties[0].task = 'repair'; plain.crew.parties[0].part = 'drive';
      OD.Crew.update(sim3, 400);
      out.noDamage = { board: !!OD.Crew.board(plain), tasks: plain.crew.parties.map((p) => p.task).join(' '), fire: OD.Crew.fireFactor(plain) };
    } catch (e) { out.throws.push('no damage module: ' + e.message); } finally { OD.Damage = dmg; }
    return out;
  });
  check('a destroyed hull, a hull with no crew and no damage module all hold', safe.throws.length === 0, safe.throws.join(' | '));
  check('a hull with no crew record refuses a hold and still names a watch',
    !!safe.bare && safe.bare.hold === null && safe.bare.holdAll === null && ['fire', 'sensors'].indexOf(safe.bare.watch) >= 0 && safe.bare.noSim === 'sensors',
    JSON.stringify(safe.bare || {}));
  check('with no damage module the parties stand down and the factors still read', safe.noDamage && safe.noDamage.board === true && safe.noDamage.tasks === 'fire sensors' && safe.noDamage.fire === 1, JSON.stringify(safe.noDamage || {}));

  // ------------------------------------------------------------------ a whole fight
  console.log('scenario: a fight with venting hulls, the crew running with it');
  const wired = await page.evaluate(() => {
    OD.harness.start(OD.Skirmish.build({ player: 'JC', env: 'deep', range: 300, playerShips: { frigate: 1, corvette: 1 }, enemyShips: { frigate: 1, corvette: 1 }, seed: 7 }));
    const sim = OD.Game.sim;
    const already = sim.ships.every((s) => !!s.crew);
    for (const s of sim.ships) {
      if (!s.crew) OD.Crew.init(s);
      const h = sim.nearestHostile(s);
      if (h) { sim.setTarget(s.id, h.id); s.weaponsFree = true; sim.setOrder(s.id, { type: 'keeprange', target: h.id, range: 250e3 }); }
      const t = s.components ? s.components.find((c) => c.kind === 'tank') : null;
      if (t) { t.hp = 0.3; OD.Damage.aggregate(s); }
      const d = s.components ? s.components.find((c) => c.id === 'drive') : null;
      if (d) { d.hp = 0.4; OD.Damage.aggregate(s); }
    }
    return { already };
  });
  if (!wired.already) console.log('note: OD.Crew is not wired into sim.js yet — this check calls OD.Crew.init and OD.Crew.update itself');
  for (let i = 0; i < 30; i++) {
    await page.evaluate((w) => { OD.harness.step(60); if (!w) OD.Crew.update(OD.Game.sim, 60); }, wired.already);
  }
  const run = await page.evaluate(() => {
    const st = OD.harness.state(), sim = OD.Game.sim;
    const crews = sim.ships.map((s) => {
      const c = s.crew;
      return { name: s.name, total: c.total, fit: c.fit, wounded: c.wounded, lost: c.lost, sum: c.fit + c.wounded + c.lost, parties: CC.tasks(s), g: Math.round((c.gNow || 0) * 100) / 100 };
    });
    return {
      errors: st.errors, renderError: st.renderError, finite: st.ships.every((s) => s.finite), outcome: st.outcome, time: Math.round(sim.time),
      crews, mended: sim.log.filter((l) => l.speaker === 'Crew').length,
      lines: sim.log.filter((l) => l.speaker === 'Crew').slice(-4).map((l) => l.text),
      board: OD.Crew.board(sim.playerShips()[0] || sim.ships[0]),
    };
  });
  check('a fight with venting hulls runs without errors', run.errors.length === 0 && !run.renderError && run.finite, run.errors.join(' | ') + (run.renderError || ''));
  check('every complement still adds up after the fight', run.crews.every((c) => c.sum === c.total), run.crews.map((c) => c.fit + '+' + c.wounded + '+' + c.lost + '/' + c.total).join(' '));
  check('the crew had something to say', run.mended > 0, run.mended + ' crew lines');
  check('the board still reads at the end', !!run.board && typeof run.board.words === 'string');
  console.log('    outcome ' + run.outcome + ' at ' + run.time + ' s');
  for (const c of run.crews) console.log('    ' + c.name + ': ' + c.fit + ' fit, ' + c.wounded + ' wounded, ' + c.lost + ' lost — ' + c.parties);
  for (const l of run.lines) console.log('    log: ' + l);

  // 1800 s of crew time on four hulls that are venting, burning and taking hits, with nothing else
  // running: the loop itself has to stay clean whatever the fight does.
  console.log('scenario: 1800 s of crew time on venting, burning, hit hulls');
  const soak = await page.evaluate(() => {
    const ships = ['corvette', 'frigate', 'destroyer', 'cruiser'].map((c) => CC.ship(c));
    const sim = CC.sim(ships);
    ships.forEach((sh, i) => {
      CC.part(sh, 'drive').hp = 0;
      CC.part(sh, 'tank1').hp = 0.2;
      CC.part(sh, 'rad1').hp = 0.3;
      OD.Damage.aggregate(sh);
      CC.gAt(sh, [0, 0.9, 3.4, 5.6][i]);
      sh.crew.gMode = 'max';
    });
    let threw = null;
    try {
      for (let t = 0; t < 1800; t += 5) {
        sim.time += 5;
        OD.Crew.update(sim, 5);
        if (t === 900) for (const sh of ships) OD.Crew.casualties(sh, 'drive', 0.4);
        if (t % 300 === 0) for (const sh of ships) OD.Damage.update(sim, 5);
      }
    } catch (e) { threw = e.message; }
    return {
      threw,
      crews: ships.map((sh) => ({
        name: sh.name, sum: sh.crew.fit + sh.crew.wounded + sh.crew.lost, total: sh.crew.total,
        fit: sh.crew.fit, wounded: sh.crew.wounded, lost: sh.crew.lost,
        g: Math.round(sh.crew.gNow * 100) / 100, tasks: CC.tasks(sh),
        finite: [sh.crew.fit, sh.crew.wounded, sh.crew.lost, sh.crew.gNow].every(isFinite)
          && sh.crew.parties.every((p) => isFinite(p.progress) && isFinite(p.eta)),
        drive: Math.round(CC.part(sh, 'drive').hp * 100) / 100,
      })),
      lines: sim.lines.length,
      burst: sim.texts().filter((l) => /wounded at/.test(l)),
    };
  });
  check('1800 s of crew time on four hulls throws nothing', soak.threw === null, soak.threw || '');
  check('every number stays finite and every complement adds up', soak.crews.every((c) => c.finite && c.sum === c.total), soak.crews.map((c) => c.fit + '+' + c.wounded + '+' + c.lost + '/' + c.total).join(' '));
  // The cold hull gets her drive back. The 0.9 g hull is under the working limit but her torch is
  // lit, so that drive is not a job; the two hard-burning hulls are strapped in besides.
  check('the work goes on on a cold hull and stops on a lit drive or a hard burn',
    soak.crews[0].drive >= 0.3 && soak.crews[1].drive === 0 && soak.crews[2].drive === 0 && soak.crews[3].drive === 0,
    soak.crews.map((c) => c.g + ' g → ' + c.drive).join(', '));
  check('a burn over the couch limit reports once', soak.burst.length <= soak.crews.length * 3 && soak.burst.length >= 2, soak.burst.join(' | '));
  for (const c of soak.crews) console.log('    ' + c.name + ' at ' + c.g + ' g: ' + c.fit + ' fit, ' + c.wounded + ' wounded, ' + c.lost + ' lost — ' + c.tasks);

  // ------------------------------------------------------------------ a part that is running (CR 12)
  console.log('scenario: the drive is lit and the panels are out');
  const running = await page.evaluate(() => {
    const sh = CC.ship('corvette');
    const sim = CC.sim([sh]);
    sh.crew.auto = false;
    CC.part(sh, 'drive').hp = 0.2; CC.part(sh, 'rad1').hp = 0.3;
    OD.Damage.aggregate(sh);
    sh.radiators.deployed = true; sh.radiators.state = 1;
    sh.accel = () => 0.9 * 9.80665; sh.throttle = 1;   // under the working limit, but the torch is lit
    OD.Crew.assign(sh, 'p2', 'repair', 'drive');
    CC.run(sim, 55);   // under T.standDown: she is still standing there waiting
    const row = (id) => OD.Crew.board(sh).parts.find((r) => r.id === id);
    const lit = { progress: sh.crew.parties[1].progress, words: OD.Crew.board(sh).parties[1].words, blocked: row('drive').blocked, strapped: sh.crew.strapped, working: OD.Crew.artFx(sh).parties[0].working };
    sh.throttle = 0;
    CC.run(sim, 300);
    const cold = { progress: Math.round(sh.crew.parties[1].progress * 1e4) / 1e4, blocked: row('drive').blocked };
    OD.Crew.assign(sh, 'p1', 'repair', 'rad1');
    CC.run(sim, 55);
    const outPanel = { progress: sh.crew.parties[0].progress, blocked: row('rad1').blocked, words: OD.Crew.board(sh).parties[0].words };
    sh.radiators.deployed = false; sh.radiators.state = 0;
    CC.run(sim, 200);
    const stowed = { progress: Math.round(sh.crew.parties[0].progress * 1e4) / 1e4, blocked: row('rad1').blocked };
    // the routine sends nobody to a part it cannot work
    const ai = CC.ship('corvette');
    const sim2 = CC.sim([ai]);
    CC.part(ai, 'drive').hp = 0.2; OD.Damage.aggregate(ai);
    ai.accel = () => 0.9 * 9.80665; ai.throttle = 1;
    CC.run(sim2, 60);
    const busyTasks = CC.tasks(ai);
    ai.throttle = 0;
    CC.run(sim2, 30);
    return { lit, cold, outPanel, stowed, busyTasks, coldTasks: CC.tasks(ai) };
  });
  check('a lit drive cannot be worked, whatever the g', running.lit.progress === 0 && running.lit.strapped === false, JSON.stringify(running.lit));
  check('the board row says why, and the ring reads paused', running.lit.blocked === 'the drive has to be cold, throttle to 0' && running.lit.working === false, String(running.lit.blocked));
  check('throttle to 0 and the work starts', running.cold.progress > 0 && running.cold.blocked === null, JSON.stringify(running.cold));
  check('an extended radiator panel cannot be worked either', running.outPanel.progress === 0 && running.outPanel.blocked === 'the radiators have to be in', JSON.stringify(running.outPanel));
  // CR 11: each reason is one short clause with no colon and no second sentence, so a caller can
  // set it in a sentence of its own. What the ship gives up for the shift is TEACH.inUse's job.
  check('and the party line sets the reason in a sentence of its own',
    running.outPanel.words === 'Party 1 on radiator panel 1, held. The radiators have to be in.', running.outPanel.words);
  check('neither reason carries a colon or a second sentence',
    [running.lit.blocked, running.outPanel.blocked].every((w) => !/[:.]/.test(String(w))),
    running.lit.blocked + ' | ' + running.outPanel.blocked);
  check('stow the panel and the work starts', running.stowed.progress > 0 && running.stowed.blocked === null, JSON.stringify(running.stowed));
  check('the routine sends nobody to a part that is running', running.busyTasks === 'fire sensors' && /repair:drive/.test(running.coldTasks), running.busyTasks + ' → ' + running.coldTasks);
  console.log('    ' + running.lit.words);
  console.log('    ' + running.outPanel.words);

  // ------------------------------------------------------------------ the party stands down (CR 9)
  // A party cannot work a part the ship is using, and a minute of standing there costs the watch she
  // left for nothing. So she goes back to that watch, and the part is held for a minute so the
  // routine does not send her straight out again while the order that lit the drive still stands.
  console.log('scenario: a party left standing on a part the ship keeps using');
  const downs = await page.evaluate(() => {
    const last = (sim) => { const t = sim.texts(); return t[t.length - 1] || ''; };
    const stoodDown = (sim) => sim.texts().filter((l) => /stands down/.test(l));
    // The routine pulls the sensor watch for the drive, and then the captain lights the drive.
    const sh = CC.ship('corvette'), sim = CC.sim([sh]);
    sh.name = 'JCS Larkspur';
    sim.selectedId = sh.id;
    CC.part(sh, 'drive').hp = 0.4; OD.Damage.aggregate(sh);
    CC.run(sim, 20);
    const sent = CC.tasks(sh);
    sh.accel = () => 0.9 * 9.80665; sh.throttle = 1;   // under the working limit, and the torch is lit
    CC.run(sim, 55);
    const waiting = { tasks: CC.tasks(sh), downs: stoodDown(sim).length, clock: Math.round(sh.crew.parties[1].waiting || 0) };
    CC.run(sim, 10);
    const back = { tasks: CC.tasks(sh), downs: stoodDown(sim).length, line: last(sim) };
    // The drive goes cold inside the hold: the routine leaves it alone until the hold runs out.
    sh.throttle = 0;
    CC.run(sim, 40);
    const inHold = CC.tasks(sh);
    CC.run(sim, 40);
    const afterHold = CC.tasks(sh);

    // A hand-sent party the same. Party 1 works the stowed panel for twice the stand-down, and only
    // stands down when the radiators go back out under her.
    const rad = CC.ship('corvette'), radSim = CC.sim([rad]);
    rad.name = 'JCS Tallow';
    radSim.selectedId = rad.id;
    rad.crew.auto = false;
    CC.part(rad, 'rad1').hp = 0.3; OD.Damage.aggregate(rad);
    rad.radiators.deployed = false; rad.radiators.state = 0;
    OD.Crew.assign(rad, 'p1', 'repair', 'rad1');
    CC.run(radSim, 120);
    const cold = { tasks: CC.tasks(rad), progress: rad.crew.parties[0].progress, downs: stoodDown(radSim).length };
    rad.radiators.deployed = true; rad.radiators.state = 1;
    CC.run(radSim, 65);
    const panel = { tasks: CC.tasks(rad), downs: stoodDown(radSim).length, line: last(radSim) };
    return { sent, waiting, back, inHold, afterHold, cold, panel };
  });
  check('a party waits T.standDown = 60 s on a part that is running', mod.T && mod.T.standDown === 60, mod.T ? String(mod.T.standDown) : '');
  check('she is still standing there at 55 s', downs.sent === 'fire repair:drive' && downs.waiting.tasks === 'fire repair:drive' && downs.waiting.downs === 0,
    downs.sent + ' → ' + downs.waiting.tasks + ' at ' + downs.waiting.clock + ' s');
  check('at 60 s she stands down to the watch she came from', downs.back.tasks === 'fire sensors' && downs.back.downs === 1, downs.back.tasks);
  check('and the log gets one line: the part, what the ship is doing with it, the station she is back on',
    downs.back.line === 'Crew: JCS Larkspur — Party 2 stands down from the drive: she is burning. Back on the sensor watch.', downs.back.line);
  check('the part is held, so the routine does not send her straight back out',
    downs.inHold === 'fire sensors' && /repair:drive/.test(downs.afterHold), downs.inHold + ' → ' + downs.afterHold);
  check('a party on a part she can work is left where she is',
    downs.cold.tasks === 'repair:rad1 sensors' && downs.cold.progress > 0 && downs.cold.downs === 0,
    downs.cold.tasks + ' at ' + Math.round(downs.cold.progress * 100) + ' %');
  check('a hand-sent party stands down the same way, and a panel names the radiators',
    downs.panel.tasks === 'fire sensors' && downs.panel.downs === 1
    && downs.panel.line === 'Crew: JCS Tallow — Party 1 stands down from radiator panel 1: the radiators are out. Back on fire control.',
    downs.panel.line);
  console.log('    ' + downs.back.line);
  console.log('    ' + downs.panel.line);

  // ------------------------------------------------------------------ the pulsed throttle (CR 12)
  // The autopilot drops the throttle to 0 for the seconds it takes to swing the nose onto the burn
  // heading. One tick's reading is not a cut: a block that flickers with it flickers through the
  // board, the card and the stand-down clock.
  console.log('scenario: the autopilot pulses the throttle');
  const pulse = await page.evaluate(() => {
    const sh = CC.ship('corvette'), sim = CC.sim([sh]);
    sh.crew.auto = false;
    CC.part(sh, 'drive').hp = 0.4; OD.Damage.aggregate(sh);
    sh.accel = () => 0.9 * 9.80665; sh.throttle = 1;
    OD.Crew.assign(sh, 'p2', 'repair', 'drive');
    CC.run(sim, 10);
    const row = () => OD.Crew.board(sh).parts.find((r) => r.id === 'drive');
    const lit = row().blocked;
    sh.throttle = 0;                       // one second of it, with the burn still to come
    CC.run(sim, 1);
    const pulsed = { blocked: row().blocked, progress: sh.crew.parties[1].progress };
    sh.throttle = 1;
    CC.run(sim, 10);
    const relit = row().blocked;
    sh.throttle = 0;
    sh.plannedAccel = { x: 1, y: 0 };      // the nose is swinging and the order still wants the burn
    CC.run(sim, 10);
    const ordered = row().blocked;
    sh.plannedAccel = null;                // a real cut
    CC.run(sim, 3);
    const mid = row().blocked;
    CC.run(sim, 4);
    const cut = { blocked: row().blocked, progress: sh.crew.parties[1].progress, task: sh.crew.parties[1].task };
    return { lit, pulsed, relit, ordered, mid, cut };
  });
  check('the drive counts as in use for T.driveHold = 5 s after the thrust', mod.T && mod.T.driveHold === 5, mod.T ? String(mod.T.driveHold) : '');
  check('a one-second throttle pulse does not clear the block',
    pulse.lit === 'the drive has to be cold, throttle to 0' && pulse.pulsed.blocked === pulse.lit && pulse.pulsed.progress === 0 && pulse.relit === pulse.lit,
    String(pulse.pulsed.blocked));
  check('nor does the order still asking for the burn', pulse.ordered === pulse.lit, String(pulse.ordered));
  check('the block stands for the 5 s after the last of it', pulse.mid === pulse.lit, String(pulse.mid));
  check('and the throttle at 0 for 5 s with nothing asking for thrust is a real cut',
    pulse.cut.blocked === null && pulse.cut.progress > 0 && pulse.cut.task === 'repair', JSON.stringify(pulse.cut));

  // ------------------------------------------------------------------ a refusal holds (CR 7, CR 8)
  console.log('scenario: the player says keep the parties where they are');
  const holds = await page.evaluate(() => {
    const one = CC.ship('corvette'), oneSim = CC.sim([one]);
    CC.part(one, 'drive').hp = 0.2; OD.Damage.aggregate(one);
    OD.Crew.hold(one, 'drive', 60);
    CC.run(oneSim, 45);
    const during = CC.tasks(one);
    CC.run(oneSim, 40);
    const after = CC.tasks(one);
    // the whole routine held off
    const all = CC.ship('corvette'), allSim = CC.sim([all]);
    CC.part(all, 'drive').hp = 0.2; OD.Damage.aggregate(all);
    OD.Crew.hold(all, null, 60);
    CC.run(allSim, 45);
    const allDuring = CC.tasks(all);
    CC.run(allSim, 40);
    const allAfter = CC.tasks(all);
    // a fresh hit on the part is the ship's own answer: the routine may look again
    const hit = CC.ship('corvette'), hitSim = CC.sim([hit]);
    CC.part(hit, 'drive').hp = 0.4; OD.Damage.aggregate(hit);
    OD.Crew.hold(hit, 'drive', 600);
    CC.run(hitSim, 20);
    const beforeHit = CC.tasks(hit);
    OD.Crew.casualties(hit, 'drive', 0.1);
    CC.run(hitSim, 30);
    const afterHit = CC.tasks(hit);
    // and a hold of 0 seconds lifts one
    const lift = CC.ship('corvette'), liftSim = CC.sim([lift]);
    CC.part(lift, 'drive').hp = 0.2; OD.Damage.aggregate(lift);
    OD.Crew.hold(lift, 'drive', 600);
    CC.run(liftSim, 20);
    OD.Crew.hold(lift, 'drive', 0);
    CC.run(liftSim, 30);
    return { during, after, allDuring, allAfter, beforeHit, afterHit, lifted: CC.tasks(lift) };
  });
  check('a hold keeps the routine off that part', holds.during === 'fire sensors', holds.during);
  check('and the routine takes it once the hold runs out', /repair:drive/.test(holds.after), holds.after);
  check('a hold with no part holds the whole routine', holds.allDuring === 'fire sensors' && /repair:drive/.test(holds.allAfter), holds.allDuring + ' → ' + holds.allAfter);
  check('a fresh hit on the part lifts the hold', holds.beforeHit === 'fire sensors' && /repair:drive/.test(holds.afterHit), holds.beforeHit + ' → ' + holds.afterHit);
  check('a hold of 0 s lifts one', /repair:drive/.test(holds.lifted), holds.lifted);

  // ------------------------------------------------------------------ which watch to pull (CR 2)
  console.log('scenario: the cheaper hand to lose');
  const watch = await page.evaluate(() => {
    const foe = OD.Sim.makeShip({ cls: 'corvette', faction: 'ISA' });
    foe.pos = { x: 200e3, y: 0 };
    const S = OD.Sensors, q0 = S.quality;
    const out = {};
    const rig = (q) => {
      const sh = CC.ship('corvette');
      const sim = CC.sim([sh, foe]);
      sim.byId = () => foe; sim.nearestHostile = () => foe;
      sh.target = 'foe';
      S.quality = () => q;
      const pick = OD.Crew.watchToPull(sh, sim);
      CC.part(sh, 'drive').hp = 0.2; OD.Damage.aggregate(sh);
      CC.run(sim, 20);
      return { pick, tasks: CC.tasks(sh) };
    };
    try {
      out.held = rig(3.0);     // a solution is held: the eyes are the cheaper hand
      out.loose = rig(1.5);    // no solution: the beams have nothing to point at
    } finally { S.quality = q0; }
    out.nothing = OD.Crew.watchToPull(CC.ship('corvette'), CC.sim([]));
    return out;
  });
  check('with a solution held the routine pulls the sensor watch', watch.held.pick === 'sensors' && watch.held.tasks === 'fire repair:drive', watch.held.pick + ' / ' + watch.held.tasks);
  check('without one it pulls fire control instead', watch.loose.pick === 'fire' && watch.loose.tasks === 'repair:drive sensors', watch.loose.pick + ' / ' + watch.loose.tasks);
  check('with nothing to shoot at, the sensor watch', watch.nothing === 'sensors', watch.nothing);

  // ------------------------------------------------------------------ the tank treadmill (CR 3, CR 10)
  console.log('scenario: a dented tank in a fight, and the same tank out of contact');
  const tanks = await page.evaluate(() => {
    const foe = OD.Sim.makeShip({ cls: 'corvette', faction: 'ISA' });
    foe.pos = { x: 100e3, y: 0 };
    const sh = CC.ship('destroyer'), sim = CC.sim([sh, foe]);
    sim.nearestHostile = () => foe;
    CC.part(sh, 'tank1').hp = 0.8; OD.Damage.aggregate(sh);   // dented, sound, venting nothing
    CC.run(sim, 120);
    const inFight = { tasks: CC.tasks(sh), lines: sim.texts().length, repairable: OD.Crew.repairable(sh, 'tank1') };
    sim.nearestHostile = () => null;                            // nothing in reach: there is time for plating
    CC.run(sim, 60);
    const quiet = CC.tasks(sh);
    // a holed tank is always worth a party, fight or no fight
    const hole = CC.ship('destroyer'), holeSim = CC.sim([hole, foe]);
    holeSim.nearestHostile = () => foe;
    CC.part(hole, 'tank1').hp = 0.2; OD.Damage.aggregate(hole);
    CC.run(holeSim, 60);
    return { inFight, quiet, venting: CC.tasks(hole) };
  });
  check('a dent in a sound tank is not the routine s work in a fight', tanks.inFight.tasks === 'fire sensors standby standby' && tanks.inFight.repairable === true, tanks.inFight.tasks);
  check('and it says nothing about it either', tanks.inFight.lines === 0, tanks.inFight.lines + ' lines');
  check('out of contact the same tank is worth a party', /repair:tank1/.test(tanks.quiet), tanks.quiet);
  check('a holed tank is worth one in a fight', /repair:tank1/.test(tanks.venting), tanks.venting);

  // ------------------------------------------------------------------ what a watch is given up for (CR 4)
  const pulls = await page.evaluate(() => {
    const out = {};
    const rig = (id, hp) => {
      const sh = CC.ship('corvette'), sim = CC.sim([sh]);
      sh.radiators.deployed = false; sh.radiators.state = 0;
      CC.part(sh, id).hp = hp; OD.Damage.aggregate(sh);
      CC.run(sim, 60);
      return CC.tasks(sh);
    };
    out.panel = rig('rad1', 0.3);
    out.mount = rig('coil1', 0.3);
    out.drive = rig('drive', 0.3);
    out.reactor = rig('reactor', 0.3);
    out.vent = rig('tank1', 0.2);
    return out;
  });
  check('a hurt panel or mount never takes a watch off station: the card asks instead',
    pulls.panel === 'fire sensors' && pulls.mount === 'fire sensors', pulls.panel + ' / ' + pulls.mount);
  check('the drive, the reactor and a venting tank do take one',
    /repair:drive/.test(pulls.drive) && /repair:reactor/.test(pulls.reactor) && /repair:tank1/.test(pulls.vent),
    [pulls.drive, pulls.reactor, pulls.vent].join(' / '));

  // ------------------------------------------------------------------ what the routine spends (CR 13, CR 14)
  // Chapter 4, 436 s: the routine put the sensor watch on a drive the ship was burning, for a mend
  // it could not start, and the watch ran at 70 % for two minutes. The bar it spends a watch by is
  // the board's own, point for point: 5 points for the drive and the reactor, 20 for anything else,
  // a venting tank and a wrecked part whatever the points.
  console.log('scenario: what the routine will and will not spend a watch on');
  const bar = await page.evaluate(() => {
    // The part the ship is using is the card's to price, not the routine's. It looks at it again
    // once the ship has let go of it.
    const lit = CC.ship('corvette'), litSim = CC.sim([lit]);
    CC.part(lit, 'drive').hp = 0; OD.Damage.aggregate(lit);
    lit.accel = () => 0.9 * 9.80665; lit.throttle = 1;
    CC.run(litSim, 120);
    const burning = { tasks: CC.tasks(lit), lines: litSim.texts().length };
    lit.throttle = 0;
    CC.run(litSim, 30);
    const letGo = CC.tasks(lit);
    // The bar for a watch: the mend itself, in points.
    const rig = (cls, id, hp) => {
      const sh = CC.ship(cls), sim = CC.sim([sh]);
      sh.radiators.deployed = false; sh.radiators.state = 0;
      CC.part(sh, id).hp = hp; OD.Damage.aggregate(sh);
      CC.run(sim, 60);
      return { tasks: CC.tasks(sh), gain: Math.round((OD.Crew.capOf(sh, id) - hp) * 100), can: OD.Crew.repairable(sh, id) };
    };
    const small = rig('corvette', 'drive', 0.67);      // 3 points, under the drive's own bar
    const vital = rig('corvette', 'drive', 0.63);      // 7 points: the drive is taken at 5
    const big = rig('corvette', 'drive', 0.45);
    const standby = rig('destroyer', 'drive', 0.67);   // nobody has to leave a watch for this one
    const vent = rig('corvette', 'tank1', 0.45);       // venting: worth a watch whatever the points
    return { burning, letGo, small, vital, big, standby, vent };
  });
  check('the routine never sends a party into a part the ship is using',
    bar.burning.tasks === 'fire sensors' && bar.burning.lines === 0, bar.burning.tasks + ', ' + bar.burning.lines + ' lines');
  check('and takes it up again once the ship has let go of it', /repair:drive/.test(bar.letGo), bar.letGo);
  check('a watch is not pulled off station for a mend under the board\'s own bar',
    bar.small.can === true && bar.small.gain < 5 && bar.small.tasks === 'fire sensors', bar.small.gain + ' points → ' + bar.small.tasks);
  check('the drive and the reactor are taken at 5 points, as the board takes them',
    bar.vital.gain >= 5 && bar.vital.gain < 20 && /repair:drive/.test(bar.vital.tasks), bar.vital.gain + ' points → ' + bar.vital.tasks);
  check('and a mend of 20 points or more takes one anywhere',
    bar.big.gain >= 20 && /repair:drive/.test(bar.big.tasks), bar.big.gain + ' points → ' + bar.big.tasks);
  check('a party standing by still goes for the small mend',
    /repair:drive/.test(bar.standby.tasks), bar.standby.gain + ' points → ' + bar.standby.tasks);
  check('and a venting tank takes a watch whatever the points are worth',
    bar.vent.gain < 20 && /repair:tank1/.test(bar.vent.tasks), bar.vent.gain + ' points → ' + bar.vent.tasks);

  // ------------------------------------------------------------------ the sick bay (CR 14)
  console.log('scenario: the sick bay under a burn and with nobody fit');
  const bay = await page.evaluate(() => {
    const sh = CC.ship('frigate'), sim = CC.sim([sh]);
    sh.crew.fit = 50; sh.crew.wounded = 10;
    OD.Crew.assign(sh, 'p3', 'medical');
    CC.gAt(sh, 2);
    CC.run(sim, 300);
    const strapped = { wounded: sh.crew.wounded, fit: sh.crew.fit, g: Math.round(sh.crew.gNow * 10) / 10 };
    CC.gAt(sh, 0);
    CC.run(sim, 100);
    const eased = { wounded: sh.crew.wounded, fit: sh.crew.fit };
    const out = CC.ship('frigate'), outSim = CC.sim([out]);
    out.crew.fit = 0; out.crew.wounded = 60;
    OD.Crew.assign(out, 'p3', 'medical');
    CC.run(outSim, 300);
    const b = OD.Crew.board(out);
    return { strapped, eased, none: { wounded: out.crew.wounded, fit: out.crew.fit, fire: OD.Crew.fireFactor(out), words: b.words, party: b.parties[0].words, medic: b.parties[2].words } };
  });
  check('nobody works the sick bay through a burn', bay.strapped.wounded === 10 && bay.strapped.g === 2, JSON.stringify(bay.strapped));
  check('the wounded come back once the burn eases', bay.eased.wounded === 8 && bay.eased.fit === 52, JSON.stringify(bay.eased));
  check('with nobody fit the sick bay stops', bay.none.wounded === 60 && bay.none.fit === 0, JSON.stringify({ wounded: bay.none.wounded, fit: bay.none.fit }));
  check('and the board says the stations are unmanned', /nobody fit to stand it/.test(bay.none.party) && /nobody fit to work it/.test(bay.none.medic) && /none fit/.test(bay.none.words), bay.none.party + ' | ' + bay.none.medic);
  console.log('    ' + bay.none.words);

  // ------------------------------------------------------------------ past what the couches hold (CR 15)
  console.log('scenario: a burn at 6.5 g, and the same burn at 5.5 g');
  const deaths = await page.evaluate(() => {
    const run = (g) => {
      const sh = CC.ship('destroyer'), sim = CC.sim([sh]);
      CC.gAt(sh, g);
      const gw = (() => { CC.run(sim, 30); return OD.Crew.board(sh).gWords; })();
      CC.gAt(sh, 0);
      CC.run(sim, 5);
      return { fit: sh.crew.fit, wounded: sh.crew.wounded, lost: sh.crew.lost, sum: sh.crew.fit + sh.crew.wounded + sh.crew.lost, lines: sim.texts(), gWords: gw };
    };
    return { hard: run(6.5), soft: run(5.5) };
  });
  check('above 6 g some of the hurt are killed', deaths.hard.lost > 0 && deaths.hard.sum === 140, JSON.stringify({ wounded: deaths.hard.wounded, lost: deaths.hard.lost }));
  check('the burst line carries both numbers and the g', deaths.hard.lines.some((l) => /\d+ wounded and \d+ lost at 6\.5 g\.$/.test(l)), deaths.hard.lines.join(' | '));
  check('below 6 g nobody is killed by acceleration', deaths.soft.lost === 0 && deaths.soft.wounded > 0 && deaths.soft.sum === 140, JSON.stringify({ wounded: deaths.soft.wounded, lost: deaths.soft.lost }));
  check('and the burst line there is the wounded alone', deaths.soft.lines.some((l) => /\d+ wounded at 5\.5 g\.$/.test(l)), deaths.soft.lines.join(' | '));
  console.log('    ' + deaths.hard.gWords);
  console.log('    ' + deaths.hard.lines.filter((l) => /at 6\.5 g/.test(l)).join(' | '));
  console.log('    ' + deaths.soft.lines.filter((l) => /at 5\.5 g/.test(l)).join(' | '));

  // ------------------------------------------------------------------ whose parties get the log (CR 11)
  console.log('scenario: two of our hulls, one of them on screen');
  const logs = await page.evaluate(() => {
    const flag = CC.ship('destroyer'), other = CC.ship('destroyer');
    flag.name = 'JCS Tallow'; other.name = 'JCS Bastion';
    const sim = CC.sim([flag, other]);
    sim.selectedId = flag.id;
    for (const sh of [flag, other]) { CC.part(sh, 'tank1').hp = 0.2; CC.part(sh, 'tank2').hp = 0.2; OD.Damage.aggregate(sh); }
    CC.run(sim, 600);
    const texts = sim.texts();
    return {
      flagLines: texts.filter((l) => /JCS Tallow — Party/.test(l)),
      otherParty: texts.filter((l) => /JCS Bastion — Party/.test(l)),
      aggregate: texts.filter((l) => /Bastion's parties/.test(l)),
      all: texts,
    };
  });
  check('the hull on screen gets her parties in the log', logs.flagLines.length >= 2, logs.flagLines.join(' | '));
  check('the other hull gets no line per party move', logs.otherParty.length === 0, logs.otherParty.join(' | '));
  check('she gets one aggregate line instead, naming what her parties are on',
    logs.aggregate.length >= 1 && logs.aggregate.length <= 4 && logs.aggregate.every((l) => l === "Crew: Bastion's parties are patching her tanks."), logs.aggregate.join(' | '));
  for (const l of logs.flagLines.slice(0, 2)) console.log('    ' + l);
  console.log('    ' + logs.aggregate[0]);

  // ------------------------------------------------------------------ what a send costs (CR 5)
  const cost = await page.evaluate(() => {
    const stow = (sh) => { sh.radiators.deployed = false; sh.radiators.state = 0; return sh; };
    const sh = stow(CC.ship('corvette'));
    CC.part(sh, 'rad1').hp = 0.3; OD.Damage.aggregate(sh);
    const fire = OD.Crew.assign(sh, 'p1', 'repair', 'rad1');
    OD.Crew.release(sh, 'p1');
    const sensors = OD.Crew.assign(sh, 'p2', 'repair', 'rad1');
    const des = stow(CC.ship('destroyer'));
    CC.part(des, 'rad1').hp = 0.3; OD.Damage.aggregate(des);
    const free = OD.Crew.assign(des, 'p3', 'repair', 'rad1');
    const lit = CC.ship('destroyer');
    CC.part(lit, 'drive').hp = 0.2; OD.Damage.aggregate(lit);
    lit.accel = () => 9.80665; lit.throttle = 1;
    const held = OD.Crew.assign(lit, 'p3', 'repair', 'drive');
    // a panel with the radiators still out: the hold names the cooling the ship gives up (CR 7)
    const out = CC.ship('destroyer');
    out.radiators = { deployed: true, state: 1 };
    CC.part(out, 'rad1').hp = 0.3; OD.Damage.aggregate(out);
    const panel = OD.Crew.assign(out, 'p3', 'repair', 'rad1');
    return { fire, sensors, free, held, panel };
  });
  check('a send off fire control says what fire control costs',
    cost.fire === 'Party 1 to radiator panel 1: 3 min to 70 %. Fire control drops to 70 % of its rate until she is back.', cost.fire);
  check('a send off the sensor watch says the same for the watch',
    cost.sensors === 'Party 2 to radiator panel 1: 3 min to 70 %. The sensor watch drops to 70 % of its rate until she is back.', cost.sensors);
  // CR 4: the cap and the watch are the same 70 % here, so they may not share a sentence.
  check('the cap and the watch never share a sentence',
    cost.sensors.split('. ').every((part) => (part.match(/70 %/g) || []).length <= 1), cost.sensors);
  check('a standby party costs nothing and the sentence says nothing',
    cost.free === 'Party 3 to radiator panel 1: 3 min to 70 %.', cost.free);
  check('a send to a part that is running says it is held', / Held: the drive has to be cold, throttle to 0\.$/.test(cost.held), cost.held);
  check('and a panel send says the same for the radiators',
    / Held: the radiators have to be in\.$/.test(cost.panel), cost.panel);
  console.log('    ' + cost.fire);
  console.log('    ' + cost.sensors);

  // ------------------------------------------------------------------ one name for a thing (CR 6)
  const naming = await page.evaluate(() => {
    const sh = CC.ship('frigate');
    sh.crew.fit = 56; sh.crew.wounded = 4;
    const said = [OD.Crew.assign(sh, 'p3', 'medical'), OD.Crew.board(sh).words, OD.Crew.board(sh).parties[2].words];
    for (const k of Object.keys(OD.Crew.TEACH)) said.push(OD.Crew.TEACH[k]);
    for (const m of ['work', 'couches', 'max']) said.push(OD.Crew.setG(sh, m));
    return said.join(' ');
  });
  check('one name for the sick bay, everywhere it is named',
    /the sick bay/.test(naming) && !/\b(on|to|in) medical\b/i.test(naming) && !/medical bay|sickbay/i.test(naming));
  check('the g limits are written 3 g, never Three g', /\b3 g\b/.test(naming) && !/Three g/i.test(naming));
  const src = require('fs').readFileSync(path.join(ROOT, 'js', 'crew.js'), 'utf8');
  check('and nothing in the module spells it the other way',
    !/Three g/.test(src) && !/(on|to) medical\b/.test(src.replace(/'medical'/g, "'task'")));
  check('and nothing in it sells one hull\'s count as the casualty rate', !/\b2 (crew )?a minute\b/.test(src));

  // ------------------------------------------------------------------ one repair time everywhere
  // damage.js owns the format. A dented tank takes 75 s, the band where crew.js's own cut used to
  // print '75 s' against the board's '1 min' for the same work.
  const oneTime = await page.evaluate(() => {
    const sh = CC.ship('corvette');
    CC.part(sh, 'tank1').hp = 0.75; OD.Damage.aggregate(sh);
    const secs = OD.Damage.repairTime(sh, 'tank1');
    const line = OD.Crew.assign(sh, 'p2', 'repair', 'tank1');
    const board = OD.Crew.board(sh);
    return {
      secs, line, want: OD.Damage.timeWords(secs), party: board.parties[1].words,
      buys: (board.parts.find((r) => r.id === 'tank1') || {}).buys || '',
    };
  });
  check('a repair in the minute-and-a-half band prints damage.js words, not crew.js own cut',
    oneTime.secs > 60 && oneTime.secs < 90 && oneTime.want === '1 min'
    && oneTime.line.indexOf(': ' + oneTime.want + ' to ') > 0
    && oneTime.party.indexOf(', ' + oneTime.want + ' to ') > 0
    && oneTime.buys.indexOf(oneTime.want) > 0,
    oneTime.secs + ' s → ' + oneTime.line + ' | ' + oneTime.party + ' | ' + oneTime.buys);

  // ------------------------------------------------------------------ a chip is not an answer (CR 1)
  // A refusal holds until the ship's own answer arrives. A beam taking 3 % off the plating is not
  // an answer; a hit that changes the state word, or takes a real bite, is.
  console.log('scenario: a hold, and the hits that lift it');
  const lifts = await page.evaluate(() => {
    const run = (severity, hp) => {
      const sh = CC.ship('corvette'), sim = CC.sim([sh]);
      CC.part(sh, 'drive').hp = hp; OD.Damage.aggregate(sh);
      OD.Crew.hold(sh, 'drive', 600);
      CC.run(sim, 20);
      const before = CC.tasks(sh);
      // the way damage.js calls it: the part is already down when the crew module hears about it
      CC.part(sh, 'drive').hp = Math.max(0, hp - severity); OD.Damage.aggregate(sh);
      OD.Crew.casualties(sh, 'drive', severity);
      CC.run(sim, 30);
      return { before, after: CC.tasks(sh) };
    };
    return { chip: run(0.03, 0.4), bite: run(0.1, 0.4), word: run(0.04, 0.02) };
  });
  check('a chip on a held part leaves the hold standing',
    lifts.chip.before === 'fire sensors' && lifts.chip.after === 'fire sensors', lifts.chip.before + ' → ' + lifts.chip.after);
  check('a hit that takes 0.1 or more lifts it', /repair:drive/.test(lifts.bite.after), lifts.bite.after);
  check('and so does a chip that changes the state word', /repair:drive/.test(lifts.word.after), lifts.word.after);

  // ------------------------------------------------------------------ a wrecking hit kills (CR 2)
  console.log('scenario: the hit that takes the last of a part');
  const outright = await page.evaluate(() => {
    const wreck = (id, open) => {
      const sh = CC.ship('corvette');
      if (open) sh.damage = { nose: 1, flank: 1, tail: 1 };
      CC.part(sh, id).hp = 0.05; OD.Damage.aggregate(sh);
      CC.part(sh, id).hp = 0; OD.Damage.aggregate(sh);
      return OD.Crew.casualties(sh, id, 0.05);
    };
    const dent = () => {
      const sh = CC.ship('corvette');
      CC.part(sh, 'drive').hp = 0.6; OD.Damage.aggregate(sh);
      return OD.Crew.casualties(sh, 'drive', 0.4);
    };
    return { drive: wreck('drive'), reactor: wreck('reactor'), panel: wreck('rad1'), mount: wreck('coil1'), open: wreck('coil1', true), dent: dent() };
  });
  check('wrecking the drive takes somebody outright, not a fraction of one',
    outright.drive.lost >= 1 && outright.reactor.lost >= 1, JSON.stringify(outright.drive) + ' / ' + JSON.stringify(outright.reactor));
  check('the same hit on plating hung outboard kills nobody',
    outright.panel.lost === 0 && outright.panel.wounded === 0, JSON.stringify(outright.panel));
  check('a wrecked mount kills only when the facet is open to vacuum',
    outright.mount.lost === 0 && outright.open.lost >= 1, JSON.stringify(outright.mount) + ' / ' + JSON.stringify(outright.open));
  check('a hit that only dents the drive kills nobody outright', outright.dent.lost === 0, JSON.stringify(outright.dent));

  // ------------------------------------------------------------------ who is left to work (CR 3)
  const gw = await page.evaluate(() => {
    const sh = CC.ship('corvette');
    const at = (fit, g) => {
      sh.crew.fit = fit; sh.crew.wounded = 24 - fit;
      sh.crew.gNow = g; sh.crew.strapped = g > 1.2; sh.crew.overCouch = g > 3;
      return OD.Crew.board(sh).gWords;
    };
    return {
      none: at(0, 0), thin: at(6, 0), full: at(24, 0), strapped: at(24, 2), burn: at(24, 3.6),
      thinBurn: at(6, 3.4), thinHard: at(6, 6.5), thinStrapped: at(6, 2),
    };
  });
  check('with nobody fit the line says so, not that the crew can work', gw.none === 'Nobody is fit to work.', gw.none);
  check('under a third fit it names the count and what the watches run at',
    gw.thin === '0.0 g, and 6 of 24 fit: the watches run at 52 %.', gw.thin);
  check('a whole crew at rest reads as before', gw.full === '0.0 g: the crew can work.', gw.full);
  check('and the burn sentences are untouched',
    gw.strapped === '2.0 g: the crew is strapped in and repairs are paused.'
    && gw.burn === '3.6 g: over the couch limit. The crew is taking injuries.', gw.strapped + ' | ' + gw.burn);
  // A thin crew under a burn that is hurting people: the burn speaks first and the crew follows,
  // so neither the injuries nor the count is lost.
  check('a thin crew past the couch limit keeps the injury clause and adds its own',
    gw.thinBurn === '3.4 g: over the couch limit. The crew is taking injuries. 6 of 24 fit: the watches run at 52 %.', gw.thinBurn);
  check('and past the death limit the same, with the killed still named',
    gw.thinHard === '6.5 g: past what the couches hold. The crew is taking injuries, and some are killed. 6 of 24 fit: the watches run at 52 %.', gw.thinHard);
  check('a thin crew strapped in keeps the paused repairs too',
    gw.thinStrapped === '2.0 g: the crew is strapped in and repairs are paused. 6 of 24 fit: the watches run at 52 %.', gw.thinStrapped);
  console.log('    ' + gw.none + ' | ' + gw.thin);
  console.log('    ' + gw.thinBurn);

  // ------------------------------------------------------------------ the lesson for the part in hand (CR 5)
  const lesson = await page.evaluate(() => {
    const sh = CC.ship('corvette');
    const at = (id, hp) => { CC.part(sh, id).hp = hp; OD.Damage.aggregate(sh); return OD.Crew.teachFor(sh, id); };
    return {
      drive: at('drive', 0.4), wrecked: at('drive', 0), panel: at('rad1', 0.3), gone: at('rad1', 0),
      tank: at('tank1', 0.2), none: OD.Crew.teachFor(sh, 'nosuchpart'), whole: OD.Crew.teachFor(sh, 'coil1'),
    };
  });
  check('one sentence for a damaged part, with its cap',
    lesson.drive === 'A repair in vacuum is a jury-rig: the drive comes back to 70 %, never further.', lesson.drive);
  check('a wrecked part gets both shifts', lesson.wrecked === 'A wrecked drive reaches 30 % in one shift and 70 % in a second.', lesson.wrecked);
  check('a part a jury-rig cannot bring back says so',
    lesson.gone === 'A wrecked radiator panel 1 is gone. No jury-rig brings it back in a fight.', lesson.gone);
  check('a holed tank is the isolate sentence, never a repair one',
    lesson.tank === 'A party valves tank 1 out of the feed: the venting stops, the plating holds at 50 %, and what went out is gone.', lesson.tank);
  check('a panel keeps its name without an article, a sound part is not promised a mend',
    lesson.panel === 'A repair in vacuum is a jury-rig: radiator panel 1 comes back to 70 %, never further.'
    && / at the cap already/.test(lesson.whole), lesson.panel + ' | ' + lesson.whole);
  check('no part falls back on the whole lesson', lesson.none === (await page.evaluate(() => OD.Crew.TEACH.juryRig)), lesson.none);
  for (const k of ['drive', 'wrecked', 'gone', 'tank']) console.log('    ' + lesson[k]);

  // ------------------------------------------------------------------ a boarding (CR 6)
  // Hand to hand through a pressurised hull is priced off the crews, not off any part: sim.js calls
  // it with no part and a phrase for where the people were hurt.
  console.log('scenario: a corvette takes a cruiser');
  const boarded = await page.evaluate(() => {
    const cor = CC.ship('corvette'), cru = CC.ship('cruiser');
    cor.name = 'JCS Kestrel'; cru.name = 'ISV Resolve';
    const sim = CC.sim([cor, cru]);
    const ours = OD.Crew.casualties(cor, null, 0.5 * Math.min(1, 260 / 24), 'in the boarding');
    const hers = OD.Crew.casualties(cru, null, 0.5 * Math.min(1, 24 / 260), 'in the boarding');
    CC.run(sim, 60);
    const even = CC.ship('frigate');
    const r = OD.Crew.casualties(even, null, 0.5, 'in the boarding');
    // and an old caller that names neither a part nor a place still says something plain
    const odd = CC.ship('frigate'), oddSim = CC.sim([odd]);
    OD.Crew.casualties(odd, null, 1);
    CC.run(oddSim, 60);
    return { ours, hers, lines: sim.texts(), even: r.wounded + r.lost, evenSum: even.crew.fit + even.crew.wounded + even.crew.lost,
      stray: oddSim.texts().filter((l) => /wounded|lost/.test(l))[0] || '' };
  });
  check('a boarding costs people on both decks, whatever the size of the hulls',
    boarded.ours.wounded + boarded.ours.lost >= 2 && boarded.hers.wounded + boarded.hers.lost >= 2,
    JSON.stringify(boarded.ours) + ' / ' + JSON.stringify(boarded.hers));
  check('at equal strength it is about a tenth of the fit crew', boarded.even === 6 && boarded.evenSum === 60, boarded.even + ' of 60');
  check('the log names the boarding, never the part', boarded.lines.some((l) => / wounded in the boarding\.$/.test(l))
    && !boarded.lines.some((l) => /on the part/.test(l)), boarded.lines.filter((l) => /wounded|lost/.test(l)).join(' | '));
  check('a hit with no part and no phrase is taken aboard, never on the part',
    / wounded aboard\.$/.test(boarded.stray || '') && !/on the part/.test(boarded.stray || ''), boarded.stray || '');
  console.log('    ' + boarded.lines.filter((l) => /wounded|lost/.test(l)).join(' | '));

  // ------------------------------------------------------------------ the sick-bay line (CR 8)
  const sick = await page.evaluate(() => {
    const sh = CC.ship('frigate');
    sh.crew.fit = 44; sh.crew.wounded = 16;
    OD.Crew.assign(sh, 'p1', 'medical');
    const busy = OD.Crew.board(sh).parties[0].words;
    sh.crew.fit = 60; sh.crew.wounded = 0;
    return { busy, empty: OD.Crew.board(sh).parties[0].words };
  });
  check('the sick-bay line reads as a party and a count, not a party of wounded',
    sick.busy === 'Party 1 in the sick bay · 16 wounded aboard.', sick.busy);
  check('and says so when the sick bay is empty', sick.empty === 'Party 1 in the sick bay · no wounded left.', sick.empty);

  // ------------------------------------------------------------------ a record that is only experience
  const partial = await page.evaluate(() => {
    const one = CC.ship('corvette', { crew: { xp: 1 } });
    const two = CC.ship('frigate', { crew: { xp: 2, wounded: 4 } });
    const empty = CC.ship('corvette', { crew: {} });
    const over = CC.ship('corvette', { crew: { xp: 9 } });
    const bare = CC.ship('corvette');
    return {
      one: { total: one.crew.total, fit: one.crew.fit, wounded: one.crew.wounded, lost: one.crew.lost, xp: one.crew.xp, parties: one.crew.parties.length },
      two: { fit: two.crew.fit, wounded: two.crew.wounded, xp: two.crew.xp, sum: two.crew.fit + two.crew.wounded + two.crew.lost },
      empty: { fit: empty.crew.fit, xp: empty.crew.xp },
      over: over.crew.xp, bare: bare.crew.xp,
    };
  });
  check('a record of experience alone gives a full complement at that experience',
    partial.one.total === 24 && partial.one.fit === 24 && partial.one.wounded === 0 && partial.one.lost === 0 && partial.one.xp === 1 && partial.one.parties === 2, JSON.stringify(partial.one));
  check('a record that names some of the numbers fills in the rest',
    partial.two.fit === 56 && partial.two.wounded === 4 && partial.two.xp === 2 && partial.two.sum === 60, JSON.stringify(partial.two));
  check('an empty record is a fresh crew, and experience is clamped',
    partial.empty.fit === 24 && partial.empty.xp === 0 && partial.over === 3 && partial.bare === 0, JSON.stringify(partial));

  // ------------------------------------------------------------------ the teach strings
  const teach = await page.evaluate(() => OD.Crew.TEACH);
  for (const k of Object.keys(teach)) console.log('    TEACH.' + k + ': ' + teach[k]);
  check('every teach string is a plain sentence with a number or a key', Object.values(teach).every((s) => typeof s === 'string' && s.length > 20 && /\.$/.test(s)));
  check('the one teach string for the jury-rig carries the drive number', /30 %/.test(teach.juryRig || ''), teach.juryRig || '');
  check('a teach string for a part that is running, and what a panel repair costs',
    /throttle at 0/.test(teach.inUse || '') && /radiators pulled in for the whole shift/.test(teach.inUse || '')
    && /no cooling/.test(teach.inUse || ''), teach.inUse || '');

  const realErrors = consoleErrors.filter((e) => !/fonts.googleapis|ERR_INTERNET|net::ERR|Failed to load resource/.test(e) && !(/^file:/.test(url) && /Access to font/.test(e)));
  check('no console errors', realErrors.length === 0, realErrors.join(' | '));

  await browser.close();
  console.log(failures ? failures + ' check(s) failed' : 'all crew checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
