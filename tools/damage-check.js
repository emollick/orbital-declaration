/* Component-damage checks for Orbital Declaration (OD.Damage).
   node tools/damage-check.js   (needs Playwright + Chromium; NODE_PATH may need the global modules dir) */
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

  console.log('scenario: a destroyer takes hits on every facet and every aim point');
  await page.evaluate(() => OD.harness.start(OD.Skirmish.build({ player: 'JC', env: 'deep', range: 300, playerShips: { destroyer: 1 }, enemyShips: { corvette: 1 }, seed: 4 })));

  // Most scenarios here are about the damage module on its own. The crew's routine would send a
  // party into the middle of them and isolate the tank a venting check is watching, so the hulls
  // under test keep their parties on standby. The fight at the end runs with the crew as it comes.
  await page.evaluate(() => {
    window.quietCrew = (sim) => {
      for (const s of (sim && sim.ships) || []) {
        if (!s.crew) continue;
        s.crew.auto = false;
        for (const p of s.crew.parties || []) { p.task = 'standby'; p.part = null; p.progress = 0; p.eta = 0; }
      }
    };
  });

  const mod = await page.evaluate(() => ({
    present: !!(window.OD && OD.Damage),
    api: ['init', 'hit', 'aggregate', 'update', 'report', 'artState', 'toRecord', 'fromRecord', 'repair',
      'mend', 'repairTime', 'repairable', 'breached', 'plainName', 'timeWords'].filter((k) => OD.Damage && typeof OD.Damage[k] !== 'function'),
  }));
  check('OD.Damage loaded with the whole interface', mod.present && mod.api.length === 0, mod.api.join(','));

  const built = await page.evaluate(() => {
    const sh = OD.Game.sim.playerShips()[0];
    const c = sh.components || [];
    const kinds = {};
    for (const x of c) kinds[x.kind] = (kinds[x.kind] || 0) + 1;
    return { cls: sh.cls, kinds, mounts: sh.mounts.length, mountHp: (sh.mountHp || []).length, powerCap: sh.powerCap, damage: sh.damage, sys: { ...sh.systems } };
  });
  check('destroyer fitted with drive, reactor, sensors', built.kinds.drive === 1 && built.kinds.reactor === 1 && built.kinds.sensors === 1, JSON.stringify(built.kinds));
  check('four radiator panels on a destroyer', built.kinds.radiator === 4, String(built.kinds.radiator));
  check('three tanks by propellant mass', built.kinds.tank === 3, String(built.kinds.tank));
  check('one entry per mount', built.kinds.mount === built.mounts && built.mountHp === built.mounts, built.kinds.mount + '/' + built.mounts);
  check('undamaged hull reads full', built.powerCap === 1 && built.sys.drive === 1 && built.sys.weapons === 1, JSON.stringify(built.sys));
  check('facet wear starts clean', built.damage.nose === 0 && built.damage.flank === 0 && built.damage.tail === 0, JSON.stringify(built.damage));

  // Every facet against every aim point: a hit always lands on something the facet shows.
  const matrix = await page.evaluate(() => {
    const sim = OD.Game.sim, sh = sim.playerShips()[0];
    sh.radiators.state = 1; sh.radiators.deployed = true;
    const rows = [];
    for (const facet of ['nose', 'flank', 'tail']) {
      for (const aim of ['hull', 'radiators', 'drive', 'mounts']) {
        const before = {};
        for (const c of sh.components) before[c.id] = c.hp;
        const hull0 = sh.hull, wear0 = sh.damage[facet];
        const r = OD.Damage.hit(sim, sh, { joules: 1.2e8, facet, aim, shooter: sim.hostiles(sh)[0], kind: 'beam' });
        const c = r.component;
        rows.push({
          facet, aim, component: c ? c.id : null, kind: c ? c.kind : null, state: r.state,
          onFacet: !!(c && c.facets.indexOf(facet) >= 0),
          fell: !!(c && c.hp < before[c.id]),
          hullLoss: r.hullLoss, hullFell: sh.hull < hull0, wearGrew: sh.damage[facet] > wear0,
        });
      }
    }
    return { rows, sys: { ...sh.systems }, hull: sh.hull, damage: { ...sh.damage } };
  });
  check('every facet/aim hit lands on a component', matrix.rows.every((r) => r.component), matrix.rows.filter((r) => !r.component).map((r) => r.facet + '/' + r.aim).join(','));
  check('the component hit is exposed on that facet', matrix.rows.every((r) => r.onFacet), matrix.rows.filter((r) => !r.onFacet).map((r) => r.facet + '/' + r.kind).join(','));
  check('component integrity falls on every hit', matrix.rows.every((r) => r.fell));
  check('hull integrity falls with it', matrix.rows.every((r) => r.hullLoss > 0 && r.hullFell), 'hull ' + matrix.hull.toFixed(3));
  check('facet wear grows where the hits landed', matrix.rows.every((r) => r.wearGrew), JSON.stringify(matrix.damage));
  check('drive aim on the nose falls back to the nose parts', matrix.rows.filter((r) => r.facet === 'nose' && r.aim === 'drive').every((r) => r.kind !== 'drive'));
  console.log('    ' + matrix.rows.map((r) => r.facet + '/' + r.aim + '→' + r.component).join(' '));

  // Aim points bias where the energy goes.
  const aimed = await page.evaluate(() => {
    const sim = OD.Game.sim, sh = sim.playerShips()[0];
    // init() adopts whatever the aggregates say, so clear them first for a clean hull
    const fresh = () => { sh.systems.drive = sh.systems.radiators = sh.systems.sensors = sh.systems.weapons = 1; OD.Damage.init(sh); sh.hull = 1; sh.damage = { nose: 0, flank: 0, tail: 0 }; sh.radiators.state = 1; };
    const pound = (facet, aim, n) => { for (let i = 0; i < n; i++) OD.Damage.hit(sim, sh, { joules: 1.2e8, facet, aim, kind: 'beam' }); };
    fresh(); pound('tail', 'drive', 14);
    const drive = sh.components.find((c) => c.id === 'drive').hp, driveSys = sh.systems.drive;
    fresh(); pound('flank', 'radiators', 14);
    const rads = sh.systems.radiators;
    fresh(); pound('flank', 'mounts', 14);
    const mounts = sh.mountHp.slice(), weapons = sh.systems.weapons;
    fresh(); sh.radiators.state = 0; pound('flank', 'radiators', 6);
    const stowed = sh.systems.radiators;
    fresh();
    return { drive, driveSys, rads, mounts, weapons, stowed };
  });
  check('aiming at the drive takes the drive down', aimed.drive < 0.6 && aimed.driveSys === aimed.drive, 'drive ' + aimed.drive.toFixed(2));
  check('aiming at extended radiators cuts the cooling', aimed.rads < 0.9, 'radiators ' + aimed.rads.toFixed(2));
  check('aiming at the mounts wrecks mounts one at a time', aimed.mounts.some((h) => h < 1) && aimed.weapons < 1, 'weapons ' + aimed.weapons.toFixed(2) + ' mountHp ' + aimed.mounts.map((h) => h.toFixed(1)).join(','));
  check('stowed panels are hard to hit', aimed.stowed > 0.85, 'radiators ' + aimed.stowed.toFixed(2));

  // The aggregates every other module reads are recomputed from the parts.
  const agg = await page.evaluate(() => {
    const sh = OD.Game.sim.playerShips()[0];
    OD.Damage.init(sh);
    const get = (id) => sh.components.find((c) => c.id === id);
    get('drive').hp = 0.4; get('reactor').hp = 0.5; get('sensors').hp = 0.25;
    const panels = sh.components.filter((c) => c.kind === 'radiator');
    panels[0].hp = 0; panels[1].hp = 0.5;
    const guns = sh.components.filter((c) => c.kind === 'mount' && c.weapon);
    guns[0].hp = 0;
    OD.Damage.aggregate(sh);
    return {
      sys: { ...sh.systems }, powerCap: sh.powerCap,
      panelMean: panels.reduce((a, c) => a + c.hp, 0) / panels.length,
      live: guns.filter((c) => c.hp > 0).length, guns: guns.length,
      mountHp: sh.mountHp.slice(), mounts: sh.mounts.length,
      sameObject: sh.systems === sh.systems,
    };
  });
  check('systems.drive is the drive', agg.sys.drive === 0.4, String(agg.sys.drive));
  check('systems.radiators is the mean panel', Math.abs(agg.sys.radiators - agg.panelMean) < 1e-9, agg.sys.radiators.toFixed(3));
  check('systems.sensors is the sensor suite', agg.sys.sensors === 0.25);
  check('systems.weapons is live mounts over mounts', Math.abs(agg.sys.weapons - agg.live / agg.guns) < 1e-9, agg.live + '/' + agg.guns);
  check('powerCap follows the reactor', Math.abs(agg.powerCap - (0.25 + 0.75 * 0.5)) < 1e-9, String(agg.powerCap));
  check('mountHp is one entry per mount', agg.mountHp.length === agg.mounts && agg.mountHp.some((h) => h === 0), agg.mountHp.join(','));

  // Point defence is a mount like any other: wreck it and mountHp says so, so gunnery can read it.
  const pd = await page.evaluate(() => {
    const sim = OD.Game.sim;
    const sh = sim.playerShips()[0].mounts.some((m) => m.kind === 'pd') ? sim.playerShips()[0]
      : OD.Sim.makeShip({ cls: 'cruiser', faction: 'JC' });
    sh.systems.drive = sh.systems.radiators = sh.systems.sensors = sh.systems.weapons = 1;
    OD.Damage.init(sh);
    const idx = sh.mounts.map((m, i) => (m.kind === 'pd' ? i : -1)).filter((i) => i >= 0);
    for (const c of sh.components) if (c.mountKind === 'pd') c.hp = 0;
    OD.Damage.aggregate(sh);
    return { idx, mountHp: sh.mountHp.slice(), others: sh.mountHp.filter((h, i) => idx.indexOf(i) < 0) };
  });
  check('a wrecked point-defence mount reads zero in mountHp', pd.idx.length > 0 && pd.idx.every((i) => pd.mountHp[i] === 0), pd.mountHp.join(','));
  check('wrecking point defence leaves the other mounts alone', pd.others.every((h) => h === 1), pd.others.join(','));

  // A holed tank vents: delta-v drains and the board says so.
  const vented = await page.evaluate(async () => {
    const sim = OD.Game.sim, sh = sim.playerShips()[0];
    quietCrew(sim);
    OD.Damage.init(sh);
    for (const s of sim.ships) { s.weaponsFree = false; s.cmdThrottle = 0; s.throttle = 0; s.jink = false; sim.setOrder(s.id, { type: 'hold' }); }
    const tank = sh.components.find((c) => c.kind === 'tank');
    tank.hp = 0.2;
    OD.Damage.aggregate(sh);
    const prop0 = sh.propMass, dv0 = sh.deltaV(), fx0 = sim.fx.length, logs0 = sim.log.length;
    OD.harness.step(120);
    const rows = OD.Damage.report(sh);
    const row = rows.find((r) => r.id === tank.id);
    return {
      venting: sh.venting, vented: tank.vented, share: tank.share,
      propFell: sh.propMass < prop0, dvFell: sh.deltaV() < dv0, fx: sim.fx.length - fx0,
      logged: sim.log.slice(logs0).filter((l) => l.speaker === 'Damage control' && /venting/.test(l.text)).map((l) => l.speaker + ': ' + l.text),
      row, rows: rows.length, states: rows.map((r) => r.state).filter((v, i, a) => a.indexOf(v) === i),
    };
  });
  check('a holed tank drains propellant', vented.vented > 0 && vented.propFell && vented.dvFell, 'vented ' + Math.round(vented.vented) + ' kg of ' + Math.round(vented.share));
  check('venting logs one line', vented.logged.length === 1, vented.logged.join(' | '));
  check('venting throws puffs behind the hull', vented.fx > 0, String(vented.fx));
  check('the report calls the tank venting', vented.row && vented.row.state === 'venting' && /km\/s lost so far/.test(vented.row.effect), vented.row ? vented.row.effect : 'no row');
  check('report has a row per component', vented.rows > 10, String(vented.rows));
  check('report states stay in the vocabulary', vented.states.every((s) => ['ok', 'worn', 'damaged', 'wrecked', 'venting', 'isolated'].indexOf(s) >= 0), vented.states.join(','));
  // DC 2 (writing N10d): the line that announces the hole carries the figure and the cure, in the
  // same words the isolate line uses, instead of "the delta-v in it is going out through the hole".
  check('the venting line names the delta-v going out and what stops it',
    /^Damage control: .+ — Tank \d+ holed and venting: [\d.]+ km\/s of delta-v going out through the hole until a party valves it out of the feed\.$/.test(vented.logged[0] || '')
      && parseFloat((/: ([\d.]+) km\/s of delta-v/.exec(vented.logged[0] || '') || [0, 0])[1]) > 0,
    vented.logged.join(' | '));

  // A tank holed this second has lost nothing yet, and '0 km/s lost so far' is not a figure.
  const fresh = await page.evaluate(() => {
    const sim = OD.Game.sim, sh = sim.playerShips()[0];
    quietCrew(sim);
    OD.Damage.init(sh);
    for (const c of sh.components) if (c.kind !== 'tank') c.hp = 0;  // the tanks are all there is left to hit
    OD.Damage.aggregate(sh);
    const n0 = sim.log.length;
    let guard = 0;
    while (!sh.venting && guard++ < 400) OD.Damage.hit(sim, sh, { joules: 5e9, facet: 'flank', aim: 'hull' });
    const atOnce = OD.Damage.report(sh).find((r) => r.state === 'venting');
    for (let i = 0; i < 5; i++) OD.Damage.update(sim, 1);
    const after = OD.Damage.report(sh).find((r) => r.state === 'venting');
    const said = sim.log.slice(n0).filter((l) => l.speaker === 'Damage control').map((l) => l.text);
    return {
      venting: sh.venting, atOnce, after,
      zero: said.filter((t) => /0 km\/s lost so far/.test(t)).length,
      holed: said.filter((t) => /holed and venting/.test(t)).length,
    };
  });
  check('a tank holed this second is not rolled up as a nought',
    fresh.venting && fresh.zero === 0 && !!fresh.atOnce && !/lost so far/.test(fresh.atOnce.effect),
    fresh.zero + ' noughts logged · ' + (fresh.atOnce ? fresh.atOnce.effect : 'no venting row'));
  check('and the hole is still announced once', fresh.holed === 1, fresh.holed + ' lines');
  check('the roll-up starts with the first figure', !!fresh.after && /km\/s lost so far/.test(fresh.after.effect),
    fresh.after ? fresh.after.effect : 'no venting row');

  // A tank blown right out vents fastest, and a tank patched back to half stops.
  const holed = await page.evaluate(() => {
    // Venting only, with nothing shooting: OD.Damage.update is the whole loop under test.
    const sim = OD.Game.sim, sh = sim.playerShips()[0];
    quietCrew(sim);
    OD.Damage.init(sh);
    const tank = sh.components.find((c) => c.kind === 'tank');
    tank.hp = 0; OD.Damage.aggregate(sh);
    const prop0 = sh.propMass;
    for (let i = 0; i < 20; i++) OD.Damage.update(sim, 1);
    const blown = OD.Damage.report(sh).find((r) => r.id === tank.id);
    const drained = prop0 - sh.propMass;
    tank.hp = 0.5; OD.Damage.aggregate(sh);
    const prop1 = sh.propMass;
    for (let i = 0; i < 60; i++) OD.Damage.update(sim, 1);
    const patched = OD.Damage.report(sh).find((r) => r.id === tank.id);
    return { blown, drained, patched, stillDraining: prop1 - sh.propMass, venting: sh.venting };
  });
  check('a tank blown right out reads venting, not wrecked', holed.blown.state === 'venting' && holed.drained > 0, holed.blown.state + ': ' + holed.blown.effect);
  check('a tank patched back to half stops leaking', holed.patched.state !== 'venting' && !holed.venting && holed.stillDraining < 1e-6, holed.patched.state + ': ' + holed.patched.effect);

  // The board is redrawn every frame; the rows are only rebuilt when something moved.
  const rows = await page.evaluate(() => {
    const sim = OD.Game.sim, sh = sim.playerShips()[0];
    OD.Damage.init(sh);
    const a = OD.Damage.report(sh), b = OD.Damage.report(sh);
    OD.Damage.hit(sim, sh, { joules: 1.2e8, facet: 'flank', aim: 'hull', kind: 'beam' });
    const c = OD.Damage.report(sh);
    return { reused: a === b, rebuilt: c !== a, same: c.length === a.length };
  });
  check('the damage report is not rebuilt every frame', rows.reused && rows.same, String(rows.reused));
  check('a hit rebuilds the damage report', rows.rebuilt);

  // Damage control speaks up once for damaged and once for wrecked.
  const logged = await page.evaluate(() => {
    const sim = OD.Game.sim, sh = sim.playerShips()[0];
    sh.systems.drive = sh.systems.radiators = sh.systems.sensors = sh.systems.weapons = 1;
    OD.Damage.init(sh); sh.hull = 1;
    const n0 = sim.log.length;
    const drive = sh.components.find((c) => c.id === 'drive');
    for (let i = 0; i < 24 && drive.hp > 0; i++) OD.Damage.hit(sim, sh, { joules: 1.4e8, facet: 'tail', aim: 'drive', kind: 'beam' });
    const lines = sim.log.slice(n0).filter((l) => l.speaker === 'Damage control').map((l) => l.text);
    return { lines, drive: drive.hp, driveLines: lines.filter((t) => /Drive/.test(t)) };
  });
  check('damage control logs the drive going', logged.driveLines.length >= 1, logged.driveLines.join(' | '));
  check('the drive line reads in plain words', logged.driveLines.some((t) => /acceleration/.test(t)), logged.driveLines.join(' | '));
  check('each state is logged once', logged.driveLines.length <= 2, String(logged.driveLines.length));

  // artState is what the hull art merges in.
  const art = await page.evaluate(() => {
    const sh = OD.Game.sim.playerShips()[0];
    const a = OD.Damage.artState(sh);
    return { keys: Object.keys(a).sort(), dmg: Object.keys(a.damage).sort(), sys: Object.keys(a.systems).sort(), finite: [a.damage.nose, a.damage.flank, a.damage.tail, a.systems.drive, a.systems.radiators, a.systems.sensors, a.systems.weapons].every((v) => isFinite(v) && v >= 0 && v <= 1) };
  });
  check('artState is { damage, systems }', art.keys.join(',') === 'damage,systems', art.keys.join(','));
  check('artState damage has three facets', art.dmg.join(',') === 'flank,nose,tail', art.dmg.join(','));
  check('artState systems has the four aggregates', art.sys.join(',') === 'drive,radiators,sensors,weapons', art.sys.join(','));
  check('artState values are in range', art.finite);

  // Campaign: the wear rides on the fleet record and the yard patches it.
  const camp = await page.evaluate(() => {
    const sim = OD.Game.sim, sh = sim.playerShips()[0];
    const rec = OD.Damage.toRecord(sh);
    const copy = OD.Sim.makeShip({ cls: sh.cls, faction: 'JC', components: rec });
    const same = rec.every((r) => Math.abs(copy.components.find((c) => c.id === r.id).hp - r.hp) < 1e-6);
    const plain = { cls: sh.cls, hull: 0.5, systems: { ...sh.systems }, components: rec.map((r) => ({ ...r })) };
    const before = plain.components.filter((c) => c.hp < 1).length;
    const did = OD.Damage.repair(plain, 0.5);
    const after = plain.components.filter((c) => c.hp < 1).length;
    // an old save with no components at all still loads
    const old = OD.Sim.makeShip({ cls: 'frigate', faction: 'JC', systems: { drive: 0.5, radiators: 1, sensors: 1, weapons: 1 } });
    const compKeys = plain.components.map((c) => Object.keys(c).sort().join(',')).filter((v, i, a) => a.indexOf(v) === i);
    return { same, did, before, after, sys: plain.systems, oldDrive: old.systems.drive, oldComps: old.components.length, extra: Object.keys(plain).sort().join(','), compKeys };
  });
  check('a fleet record round-trips through makeShip', camp.same);
  check('the yard repairs the parts', camp.did && camp.after < camp.before, camp.before + ' → ' + camp.after);
  check('repair refreshes the record aggregates', camp.sys.drive > 0 && isFinite(camp.sys.weapons), JSON.stringify(camp.sys));
  check('repair leaves no stray fields on the record', camp.extra === 'cls,components,hull,systems', camp.extra);
  check('a repaired record still carries only { id, hp }', camp.compKeys.join(' | ') === 'hp,id', camp.compKeys.join(' | '));
  check('an old save without components still loads', camp.oldComps > 0 && Math.abs(camp.oldDrive - 0.5) < 1e-6, 'drive ' + camp.oldDrive);

  const fleet = await page.evaluate(() => {
    const st = OD.Campaign.newState();
    st.fleetAt = 'thebe'; st.nodes.thebe.owner = 'ISA';
    OD.harness.start(OD.Campaign.buildBattle(st), { mode: 'Campaign', briefShown: true });
    const sim = OD.Game.sim, sh = sim.byId('c_larkspur');
    for (let i = 0; i < 20; i++) OD.Damage.hit(sim, sh, { joules: 4e7, facet: 'flank', aim: 'radiators', kind: 'beam' });
    OD.Campaign.applyBattle(st, sim, 'victory');
    const rec = st.fleet.find((f) => f.id === 'c_larkspur');
    const spec = OD.Campaign.buildBattle(st).ships.find((s) => s.id === 'c_larkspur');
    OD.harness.start(OD.Campaign.buildBattle(st), { mode: 'Campaign', briefShown: true });
    const back = OD.Game.sim.byId('c_larkspur');
    return {
      stored: rec.components ? rec.components.length : 0,
      hurt: (rec.components || []).filter((c) => c.hp < 1).length,
      passed: !!(spec && spec.components),
      carried: (rec.components || []).every((c) => Math.abs(back.components.find((x) => x.id === c.id).hp - c.hp) < 1e-6),
      radiators: back.systems.radiators,
    };
  });
  check('the fleet record stores the parts', fleet.stored > 0 && fleet.hurt > 0, fleet.hurt + ' of ' + fleet.stored + ' hurt');
  check('buildBattle hands the parts back to the sim', fleet.passed && fleet.carried, 'radiators ' + fleet.radiators.toFixed(2));

  // ---------------------------------------------------------------- jury-rig
  console.log('scenario: a party jury-rigs what it can and the board prices the work');
  const jury = await page.evaluate(() => {
    const sim = OD.Game.sim, sh = sim.playerShips()[0];
    quietCrew(sim);
    sh.systems.drive = sh.systems.radiators = sh.systems.sensors = sh.systems.weapons = 1;
    OD.Damage.init(sh); sh.hull = 1; sh.damage = { nose: 0, flank: 0, tail: 0 };
    const get = (id) => sh.components.find((c) => c.id === id);
    const mountId = sh.components.find((c) => c.kind === 'mount').id;
    const out = {};
    const run = (key, id, hp) => {
      const c = get(id);
      c.hp = hp; c.isolated = false; c.vented = 0;
      OD.Damage.aggregate(sh);
      const row = OD.Damage.report(sh).find((r) => r.id === id);
      const line = OD.Damage.mend(sh, id);
      const after = OD.Damage.report(sh).find((r) => r.id === id);
      out[key] = {
        id, from: hp, line, hp: c.hp, cap: row.cap, repairable: row.repairable, eta: row.eta, buys: row.buys,
        state: after.state, effect: after.effect, sys: { ...sh.systems }, powerCap: sh.powerCap,
      };
    };
    run('driveWrecked', 'drive', 0);
    run('driveDamaged', 'drive', 0.4);
    run('driveAboveCap', 'drive', 0.9);
    run('reactorWrecked', 'reactor', 0);
    run('reactorDamaged', 'reactor', 0.3);
    run('sensorsWrecked', 'sensors', 0);
    run('sensorsDamaged', 'sensors', 0.4);
    run('panelWrecked', 'rad1', 0);
    run('panelDamaged', 'rad1', 0.3);
    run('mountWrecked', mountId, 0);
    run('mountDamaged', mountId, 0.5);
    run('tankDented', 'tank2', 0.7);
    return out;
  });
  check('a wrecked drive comes back to 30 %', jury.driveWrecked.hp === 0.3 && jury.driveWrecked.cap === 0.3 && jury.driveWrecked.sys.drive === 0.3, jury.driveWrecked.line);
  check('a damaged drive comes back to 70 %', jury.driveDamaged.hp === 0.7 && jury.driveDamaged.cap === 0.7, jury.driveDamaged.line);
  check('a drive already past the cap is left alone', jury.driveAboveCap.line === null && jury.driveAboveCap.hp === 0.9 && !jury.driveAboveCap.repairable, jury.driveAboveCap.buys);
  check('a wrecked reactor comes back to 25 %', jury.reactorWrecked.hp === 0.25 && Math.abs(jury.reactorWrecked.powerCap - (0.25 + 0.75 * 0.25)) < 1e-9, jury.reactorWrecked.line);
  check('a damaged reactor comes back to 60 %', jury.reactorDamaged.hp === 0.6, jury.reactorDamaged.line);
  check('a wrecked sensor suite comes back to 50 %', jury.sensorsWrecked.hp === 0.5 && jury.sensorsWrecked.sys.sensors === 0.5, jury.sensorsWrecked.line);
  check('a damaged sensor suite comes back to 80 %', jury.sensorsDamaged.hp === 0.8, jury.sensorsDamaged.line);
  check('a wrecked panel stays wrecked', jury.panelWrecked.line === null && jury.panelWrecked.hp === 0 && !jury.panelWrecked.repairable, jury.panelWrecked.buys);
  check('a damaged panel comes back to 70 %', jury.panelDamaged.hp === 0.7, jury.panelDamaged.line);
  check('a wrecked mount stays wrecked', jury.mountWrecked.line === null && jury.mountWrecked.hp === 0 && !jury.mountWrecked.repairable, jury.mountWrecked.buys);
  check('a damaged mount comes back to 80 %', jury.mountDamaged.hp === 0.8, jury.mountDamaged.line);
  check('a dented tank is beaten back to full', jury.tankDented.hp === 1 && jury.tankDented.state === 'ok', jury.tankDented.line);
  check('every mend recomputes the aggregates', jury.driveWrecked.sys.drive === 0.3 && jury.panelDamaged.sys.radiators > 0 && isFinite(jury.mountDamaged.sys.weapons), JSON.stringify(jury.panelDamaged.sys));
  check('a mend hands back one plain sentence',
    [jury.driveWrecked, jury.reactorDamaged, jury.sensorsWrecked, jury.panelDamaged, jury.mountDamaged, jury.tankDented]
      .every((r) => typeof r.line === 'string' && r.line.length > 12 && !/—|;/.test(r.line)),
    jury.sensorsWrecked.line);
  console.log('    ' + ['driveWrecked', 'driveDamaged', 'reactorWrecked', 'sensorsWrecked', 'panelDamaged', 'mountDamaged', 'tankDented']
    .map((k) => jury[k].line).join('\n    '));

  // The words the board puts on a row: what a party buys, and what it cannot.
  check('the drive row says what a party buys', /^A party swaps the burnt driver modules and brings the drive to 30 %: acceleration at 30 %, turn rate at 65 %\. \d+ min\.$/.test(jury.driveWrecked.buys), jury.driveWrecked.buys);
  check('the panel row says when there is nothing to do', jury.panelWrecked.buys === 'Nothing a party can do for radiator panel 1: the panel is gone.', jury.panelWrecked.buys);
  check('the mount row says when there is nothing to do', /^Nothing a party can do for the /.test(jury.mountWrecked.buys), jury.mountWrecked.buys);
  console.log('    ' + ['driveWrecked', 'reactorWrecked', 'sensorsDamaged', 'panelWrecked', 'panelDamaged', 'mountDamaged', 'tankDented', 'driveAboveCap']
    .map((k) => jury[k].buys).join('\n    '));

  // Round 1 of v13: the radiator row states the level the way its repair line does (writing 8), the
  // mount's margin is a number rather than "more margin" (writing 9), and the big parts name the
  // work so the minutes read as a swap and not a rebuild (realism 10). The times do not move.
  const said = await page.evaluate(() => {
    const sim = OD.Game.sim, sh = sim.playerShips()[0];
    quietCrew(sim);
    sh.systems.drive = sh.systems.radiators = sh.systems.sensors = sh.systems.weapons = 1;
    OD.Damage.init(sh); sh.hull = 1; sh.damage = { nose: 0, flank: 0, tail: 0 };
    const get = (id) => sh.components.find((c) => c.id === id);
    const mount = sh.components.find((c) => c.kind === 'mount');
    get('drive').hp = 0; get('reactor').hp = 0; get('sensors').hp = 0;
    get('rad1').hp = 0.25; get('rad2').hp = 0; mount.hp = 0.2;
    OD.Damage.aggregate(sh);
    const rows = OD.Damage.report(sh);
    const row = (id) => rows.find((r) => r.id === id);
    const panel = row('rad1'), panelGone = row('rad2'), mountRow = row(mount.id);
    return {
      panel: panel.effect, panelBuys: panel.buys, panelGone: panelGone.effect,
      cooling: OD.U.fmt.pct(sh.systems.radiators),
      mountBuys: mountRow.buys, mountLine: OD.Damage.mend(sh, mount.id), mountName: mountRow.name,
      drive: row('drive').buys, reactor: row('reactor').buys, sensors: row('sensors').buys,
      everything: rows.map((r) => r.effect + ' | ' + r.buys).join('\n'),
    };
  });
  check('the radiator row states the cooling level, not the drop',
    /^Radiator panel 1 25 %: the ship's cooling is at \d+ %$/.test(said.panel) && said.panel.indexOf(said.cooling) > 0, said.panel);
  check('a wrecked panel states it the same way', /^Radiator panel 2 wrecked: the ship's cooling is at \d+ %$/.test(said.panelGone), said.panelGone);
  check('the row and the repair under it are the same quantity',
    /cooling back to \d+ %/.test(said.panelBuys) && !/cooling down by/.test(said.everything), said.panelBuys);
  check('a mount repair is priced in damage, not in margin',
    /^A party brings the .+ to 80 %: it keeps firing, and 4 times the damage to wreck it\. \d+ min\.$/.test(said.mountBuys)
      && !/more margin/.test(said.everything), said.mountBuys);
  check('the mount mend line carries the same number',
    / jury-rigged to 80 %: it keeps firing, and 4 times the damage to wreck it$/.test(said.mountLine), said.mountLine);
  check('the drive names the work and keeps its eight minutes',
    /^A party swaps the burnt driver modules and brings the drive to 30 %: acceleration at 30 %, turn rate at 65 %\. 8 min\.$/.test(said.drive), said.drive);
  check('the reactor and the sensor suite name theirs, at the same times',
    /^A party cross-connects the spare feed line and brings the reactor to 25 %: .+\. 7 min\.$/.test(said.reactor)
      && /^A party swaps the burnt receiver boards and brings the sensor suite to 50 %: .+\. 5 min\.$/.test(said.sensors),
    said.reactor + ' · ' + said.sensors);
  console.log('    ' + [said.panel, said.panelBuys, said.mountBuys, said.mountLine, said.drive, said.reactor, said.sensors].join('\n    '));

  // Realism round 3 (DC 9): thrust goes with the drive, the turn does not. The attitude thrusters
  // carry half the turn on their own, so a drive at 20 % still turns at 60 % and a wrecked one at
  // 50 %. The drive's words print both numbers and take the second from OD.Autopilot.turnFactor,
  // the figure the attitude loop actually flies, so the board and the flip ring cannot disagree.
  const turn = await page.evaluate(() => {
    const sim = OD.Game.sim, sh = sim.playerShips()[0];
    quietCrew(sim);
    sh.systems.drive = sh.systems.radiators = sh.systems.sensors = sh.systems.weapons = 1;
    OD.Damage.init(sh); sh.hull = 1; sh.damage = { nose: 0, flank: 0, tail: 0 };
    const d = sh.components.find((c) => c.id === 'drive');
    const at = (hp) => {
      d.hp = hp; OD.Damage.aggregate(sh);
      const r = OD.Damage.report(sh).find((x) => x.id === 'drive');
      return { effect: r.effect, buys: r.buys };
    };
    const has = typeof OD.Autopilot.turnFactor === 'function';
    const F = (x) => (has ? OD.U.fmt.pct(OD.Autopilot.turnFactor(x)) : '');
    const out = { has, model: { wrecked: F(0), v20: F(0.2), v30: F(0.3), v70: F(0.7) } };
    out.wrecked = at(0); out.v20 = at(0.2); out.v70 = at(0.7);
    d.hp = 0; OD.Damage.aggregate(sh);
    out.mendWrecked = OD.Damage.mend(sh, 'drive');
    d.hp = 0.4; OD.Damage.aggregate(sh);
    out.mendDamaged = OD.Damage.mend(sh, 'drive');
    // every turn figure the drive prints, against the loop's own number
    out.quoted = [out.wrecked.effect, out.v20.effect, out.v70.effect, out.wrecked.buys, out.mendWrecked, out.mendDamaged]
      .map((t) => (/turn rate at (\d+ %)/.exec(t) || [])[1] || null);
    out.want = [F(0), F(0.2), F(0.7), F(0.3), F(0.3), F(0.7)];
    // with the autopilot's number gone the words fall back to the one figure they printed before
    const save = OD.Autopilot.turnFactor;
    delete OD.Autopilot.turnFactor;
    out.fallbackDamaged = at(0.4); out.fallbackWrecked = at(0);
    OD.Autopilot.turnFactor = save;
    return out;
  });
  check('the attitude loop exports the turn the words quote',
    turn.has && turn.model.wrecked === '50 %' && turn.model.v20 === '60 %' && turn.model.v30 === '65 %' && turn.model.v70 === '85 %',
    JSON.stringify(turn.model));
  check('a hurt drive names both numbers, not one twice',
    turn.v20.effect === 'Drive 20 %: acceleration at 20 %, turn rate at 60 %'
      && turn.v70.effect === 'Drive 70 %: acceleration at 70 %, turn rate at 85 %',
    turn.v20.effect + ' · ' + turn.v70.effect);
  check('a wrecked drive still turns on the attitude thrusters',
    turn.wrecked.effect === 'Drive wrecked: no acceleration, turn rate at 50 % on the attitude thrusters',
    turn.wrecked.effect);
  check('what a party buys and the mend line name both numbers too',
    /^A party swaps the burnt driver modules and brings the drive to 30 %: acceleration at 30 %, turn rate at 65 %\. \d+ min\.$/.test(turn.wrecked.buys)
      && turn.mendWrecked === 'Drive jury-rigged to 30 %: acceleration at 30 %, turn rate at 65 %'
      && turn.mendDamaged === 'Drive jury-rigged to 70 %: acceleration at 70 %, turn rate at 85 %',
    turn.wrecked.buys + ' · ' + turn.mendWrecked);
  check('every turn figure the drive prints is the loop\'s own',
    turn.quoted.length === turn.want.length && turn.quoted.every((v, i) => v === turn.want[i]),
    turn.quoted.join(',') + ' against ' + turn.want.join(','));
  check('without the autopilot number the drive words fall back to the one figure',
    turn.fallbackDamaged.effect === 'Drive 40 %: acceleration and turn rate at 40 %'
      && turn.fallbackWrecked.effect === 'Drive wrecked: no acceleration and no attitude control'
      && / to 30 %: some thrust, slow turns\./.test(turn.fallbackWrecked.buys),
    turn.fallbackDamaged.effect + ' · ' + turn.fallbackWrecked.effect);
  console.log('    ' + [turn.wrecked.effect, turn.v20.effect, turn.wrecked.buys, turn.mendDamaged].join('\n    '));

  // The panel lists every part under 100 %, whatever stateOf calls it, so every row carries its
  // integrity and whether a party can improve it. Round 2 (DC 3): a drive at 55 % is inside a
  // jury-rig's reach (70 %), so the report calls it damaged rather than ok.
  const worn = await page.evaluate(() => {
    const sim = OD.Game.sim, sh = sim.playerShips()[0];
    quietCrew(sim);
    sh.systems.drive = sh.systems.radiators = sh.systems.sensors = sh.systems.weapons = 1;
    OD.Damage.init(sh); sh.hull = 1; sh.damage = { nose: 0, flank: 0, tail: 0 };
    sh.components.find((c) => c.id === 'drive').hp = 0.55;
    OD.Damage.aggregate(sh);
    const rows = OD.Damage.report(sh);
    const hurt = rows.filter((r) => r.hp < 1);
    const drive = rows.find((r) => r.id === 'drive');
    return {
      drive, n: hurt.length,
      fields: hurt.every((r) => typeof r.hp === 'number' && typeof r.repairable === 'boolean' && r.hp < 1),
      every: rows.every((r) => typeof r.hp === 'number' && typeof r.repairable === 'boolean'),
    };
  });
  check('a part above half still reads its integrity and asks for a party',
    worn.drive.hp === 0.55 && worn.drive.state === 'damaged' && worn.drive.repairable === true,
    worn.drive.state + ' at ' + worn.drive.hp + ' · ' + worn.drive.buys);
  check('every row carries hp and repairable for the board to list',
    worn.every && worn.fields && worn.n === 1, worn.n + ' part under 100 %');

  // ------------------------------------------------------------- round 2 of the v13 review
  // One name for a part (DC 1), one word for its state (DC 3), one time format (DC 5), and a panel
  // repair that says the radiators are in for the shift (DC 4).
  console.log('scenario: one name, one state word and one time for every part');
  const r2 = await page.evaluate(() => {
    const sim = OD.Game.sim, sh = sim.playerShips()[0];
    quietCrew(sim);
    sh.systems.drive = sh.systems.radiators = sh.systems.sensors = sh.systems.weapons = 1;
    OD.Damage.init(sh); sh.hull = 1; sh.damage = { nose: 0, flank: 0, tail: 0 };
    const get = (id) => sh.components.find((c) => c.id === id);
    const mount = sh.components.find((c) => c.kind === 'mount');
    const tank = sh.components.find((c) => c.kind === 'tank');
    const names = {
      drive: OD.Damage.plainName(get('drive')),
      reactor: OD.Damage.plainName(get('reactor')),
      sensors: OD.Damage.plainName(get('sensors')),
      panel: OD.Damage.plainName(get('rad1')),
      tank: OD.Damage.plainName(tank),
      mount: OD.Damage.plainName(mount),
      row: OD.Damage.plainName(OD.Damage.report(sh).find((r) => r.id === 'rad1')),
      nothing: OD.Damage.plainName(null),
    };
    const at = (id, hp) => {
      const c = get(id); c.hp = hp; c.isolated = false; c.vented = 0;
      OD.Damage.aggregate(sh);
      const r = OD.Damage.report(sh).find((x) => x.id === id);
      return { state: r.state, effect: r.effect, hp: r.hp, repairable: r.repairable, buys: r.buys, eta: r.eta, kind: r.kind };
    };
    const states = {
      mountDamaged: at(mount.id, 0.55),
      mountWorn: at(mount.id, 0.92),
      mountWrecked: at(mount.id, 0),
      driveDamaged: at('drive', 0.55),
      driveAtReach: at('drive', 0.7),
      driveWorn: at('drive', 0.85),
      driveWhole: at('drive', 1),
      reactorWorn: at('reactor', 0.8),
      sensorsDamaged: at('sensors', 0.75),
      panelDamaged: at('rad1', 0.3),
    };
    const times = {
      s45: OD.Damage.timeWords(45), s59: OD.Damage.timeWords(59), m60: OD.Damage.timeWords(60),
      m84: OD.Damage.timeWords(84), m360: OD.Damage.timeWords(360), none: OD.Damage.timeWords(0),
      junk: OD.Damage.timeWords(null),
    };
    // two mounts left standing on either side of the reach, so the rows carry both words
    const mounts = sh.components.filter((c) => c.kind === 'mount');
    at(mounts[0].id, 0.55);
    if (mounts[1]) at(mounts[1].id, 0.92);
    const rows = OD.Damage.report(sh);
    return {
      names, states, times,
      // the word on the row and the word in the line under it are the same word
      firing: rows.filter((r) => /, still firing$/.test(r.effect)).map((r) => r.state + ' | ' + r.effect),
      agree: rows.every((r) => !/, still firing$/.test(r.effect) || r.effect.indexOf(': ' + r.state + ', still firing') > 0),
      noOkBelow: rows.every((r) => r.hp >= 1 || r.state !== 'ok'),
      wornIsPastHelp: rows.every((r) => r.state !== 'worn' || r.repairable === false),
      // every priced row prints the board's own time, in the one format
      timed: rows.filter((r) => r.repairable)
        .every((r) => r.buys.indexOf(' ' + OD.Damage.timeWords(r.eta) + (r.kind === 'radiator' ? ', with the radiators in.' : '.')) > 0),
      panelBuys: states.panelDamaged.buys,
      others: rows.filter((r) => r.repairable && r.kind !== 'radiator').map((r) => r.buys),
    };
  });
  check('plainName names every part the way a sentence wants it',
    r2.names.drive === 'the drive' && r2.names.reactor === 'the reactor' && r2.names.sensors === 'the sensor suite'
      && r2.names.panel === 'radiator panel 1' && /^tank \d+$/.test(r2.names.tank) && /^the \S/.test(r2.names.mount)
      && r2.names.row === r2.names.panel && r2.names.nothing === '',
    JSON.stringify(r2.names));
  check('a mount inside a jury-rig\'s reach reads damaged on the row and under it',
    r2.states.mountDamaged.state === 'damaged' && /: damaged, still firing$/.test(r2.states.mountDamaged.effect)
      && r2.states.mountDamaged.repairable === true,
    r2.states.mountDamaged.state + ' · ' + r2.states.mountDamaged.effect);
  check('a mount past it reads worn on both, and asks for nobody',
    r2.states.mountWorn.state === 'worn' && /: worn, still firing$/.test(r2.states.mountWorn.effect)
      && r2.states.mountWorn.repairable === false,
    r2.states.mountWorn.state + ' · ' + r2.states.mountWorn.effect);
  check('the same threshold reads the other kinds',
    r2.states.driveDamaged.state === 'damaged' && r2.states.driveAtReach.state === 'worn'
      && r2.states.driveWorn.state === 'worn' && r2.states.driveWhole.state === 'ok'
      && r2.states.reactorWorn.state === 'worn' && r2.states.sensorsDamaged.state === 'damaged'
      && r2.states.panelDamaged.state === 'damaged' && r2.states.mountWrecked.state === 'wrecked',
    Object.keys(r2.states).map((k) => k + ' ' + r2.states[k].state).join(', '));
  check('no row calls a part ok under 100 %, and worn always means past help',
    r2.noOkBelow && r2.wornIsPastHelp && r2.agree && r2.firing.length > 0, r2.firing.join(' · '));
  check('a panel repair says the radiators are in for the shift',
    /^A party brings radiator panel 1 to 70 %: cooling back to \d+ %\. \d+ min, with the radiators in\.$/.test(r2.panelBuys)
      && r2.others.every((b) => !/radiators in/.test(b)),
    r2.panelBuys);
  check('timeWords is the one repair-time format',
    r2.times.s45 === '45 s' && r2.times.s59 === '59 s' && r2.times.m60 === '1 min' && r2.times.m84 === '1 min'
      && r2.times.m360 === '6 min' && r2.times.none === '1 s' && r2.times.junk === '1 s',
    JSON.stringify(r2.times));
  check('every priced row prints its own time in that format', r2.timed, r2.others.slice(0, 2).join(' · '));
  console.log('    ' + [r2.states.mountDamaged.effect, r2.states.mountWorn.effect, r2.panelBuys].join('\n    '));

  // Every row carries the four new fields, whatever state the part is in.
  const rowShape = await page.evaluate(() => {
    const sh = OD.Game.sim.playerShips()[0];
    const rows = OD.Damage.report(sh);
    return {
      n: rows.length,
      fields: rows.every((r) => typeof r.cap === 'number' && typeof r.repairable === 'boolean' && typeof r.eta === 'number' && typeof r.buys === 'string' && r.buys.length > 10),
      capSane: rows.every((r) => r.cap >= r.hp - 1e-6 && r.cap <= 1),
      etaSane: rows.every((r) => r.eta > 0 && r.eta < 4000),
      agrees: rows.every((r) => r.repairable === (r.cap > r.hp + 1e-6)),
      sentence: rows.every((r) => /\.$/.test(r.buys) && /^(A party|Nothing a party)/.test(r.buys)),
      sample: rows.slice(0, 3).map((r) => r.name + ' [' + r.state + ' ' + Math.round(r.hp * 100) + '%, cap ' + Math.round(r.cap * 100) + '%, ' + r.eta + 's, ' + (r.repairable ? 'send' : 'no') + '] ' + r.buys),
    };
  });
  check('every report row carries cap, repairable, eta and buys', rowShape.fields && rowShape.n > 10, rowShape.n + ' rows');
  check('cap never reads below the part itself', rowShape.capSane);
  check('eta is a workable number of seconds', rowShape.etaSane);
  check('repairable agrees with the cap', rowShape.agrees);
  check('buys is one sentence either way', rowShape.sentence);
  console.log('    ' + rowShape.sample.join('\n    '));

  // A party isolates a venting tank: the venting stops for good and what went is gone.
  const isolate = await page.evaluate(() => {
    const sim = OD.Game.sim, sh = sim.playerShips()[0];
    quietCrew(sim);
    OD.Damage.init(sh); sh.damage = { nose: 0, flank: 0, tail: 0 };
    for (const s of sim.ships) { s.weaponsFree = false; s.cmdThrottle = 0; s.throttle = 0; sim.setOrder(s.id, { type: 'hold' }); }
    const tank = sh.components.find((c) => c.kind === 'tank');
    tank.hp = 0.2; OD.Damage.aggregate(sh);
    for (let i = 0; i < 30; i++) OD.Damage.update(sim, 1);
    const ventedOut = tank.vented, propAtIsolation = sh.propMass, dv0 = sh.deltaV();
    const row = OD.Damage.report(sh).find((r) => r.id === tank.id);
    const n0 = sim.log.length;
    const line = OD.Damage.mend(sh, tank.id, sim);
    const logged = sim.log.slice(n0).filter((l) => l.speaker === 'Damage control').map((l) => l.speaker + ': ' + l.text);
    const hpAfter = tank.hp;
    for (let i = 0; i < 120; i++) OD.Damage.update(sim, 1);
    const after = OD.Damage.report(sh).find((r) => r.id === tank.id);
    // a later hit on an isolated tank does not open it again
    tank.hp = 0.1; OD.Damage.aggregate(sh);
    for (let i = 0; i < 60; i++) OD.Damage.update(sim, 1);
    const hitAgain = OD.Damage.report(sh).find((r) => r.id === tank.id);
    return {
      wasVenting: row.state === 'venting', buys: row.buys, eta: row.eta, line,
      logged, hp: hpAfter, state: after.state, effect: after.effect, again: hitAgain.state,
      ventedOut, ventedStill: tank.vented, held: Math.abs(sh.propMass - propAtIsolation) < 1e-6,
      venting: sh.venting, dvHeld: Math.abs(sh.deltaV() - dv0) < 1e-6, repairable: after.repairable, capAfter: after.cap,
      // what was still in the tank when the party shut it, the way the words print it
      keptMass: tank.share - tank.vented, keptWords: OD.U.fmt.mass(tank.share - tank.vented),
    };
  });
  check('a venting tank is worth a party', isolate.wasVenting && /^A party valves tank \d+ out of the feed and pumps its .+ across: the venting stops\. \d+ min\.$/.test(isolate.buys) && isolate.eta > 0, isolate.buys);
  check('isolating holds the tank at 50 %', isolate.line !== null && isolate.hp === 0.5, isolate.line);
  check('the board reads the tank isolated', isolate.state === 'isolated' && /^Tank \d+ valved out of the feed and its .+ pumped across: the venting has stopped/.test(isolate.effect), isolate.state + ': ' + isolate.effect);
  check('isolating stops the venting for good', isolate.held && !isolate.venting && isolate.again === 'isolated', 'state after a second hit: ' + isolate.again);
  check('what vented stays gone', isolate.ventedOut > 0 && Math.abs(isolate.ventedStill - isolate.ventedOut) < 1e-6 && isolate.dvHeld, Math.round(isolate.ventedOut) + ' kg out of the hole');
  check('an isolated tank asks for nothing more', !isolate.repairable, 'cap ' + isolate.capAfter);
  // realism 10 round 1: the propellant that had not gone out of the hole stays in the ship, so the
  // words say where it went. The same figure on the row a party is offered, the row after, and the log.
  check('the words name the propellant that stayed aboard',
    isolate.keptMass > 0 && isolate.buys.indexOf(isolate.keptWords + ' across') > 0
      && isolate.effect.indexOf(isolate.keptWords + ' pumped across') > 0
      && isolate.line.indexOf(isolate.keptWords + ' pumped across') > 0,
    isolate.keptWords + ' kept of ' + Math.round((isolate.keptMass + isolate.ventedOut) / 1000) + ' t · ' + isolate.line);
  check('a mend with a sim logs one line', isolate.logged.length === 1 && /Damage control/.test(isolate.logged[0]), isolate.logged.join(' | '));

  // The work takes longer through a breached facet.
  const timing = await page.evaluate(() => {
    const sh = OD.Game.sim.playerShips()[0];
    OD.Damage.init(sh); sh.damage = { nose: 0, flank: 0, tail: 0 };
    const drive = sh.components.find((c) => c.id === 'drive');
    drive.hp = 0; OD.Damage.aggregate(sh);
    const clean = OD.Damage.repairTime(sh, 'drive'), cleanBreach = OD.Damage.breached(sh, 'drive');
    sh.damage.tail = 0.8;
    const holed = OD.Damage.repairTime(sh, 'drive'), holedBreach = OD.Damage.breached(sh, 'drive');
    drive.hp = 0.5;
    const halfHurt = OD.Damage.repairTime(sh, 'drive');
    sh.damage.tail = 0;
    const halfClean = OD.Damage.repairTime(sh, 'drive');
    const others = {
      reactor: (sh.components.find((c) => c.id === 'reactor').hp = 0, OD.Damage.repairTime(sh, 'reactor')),
      sensors: (sh.components.find((c) => c.id === 'sensors').hp = 0, OD.Damage.repairTime(sh, 'sensors')),
      panel: (sh.components.find((c) => c.id === 'rad1').hp = 0, OD.Damage.repairTime(sh, 'rad1')),
    };
    const tank = sh.components.find((c) => c.kind === 'tank');
    tank.hp = 1; tank.isolated = false;
    const tankFull = OD.Damage.repairTime(sh, tank.id);
    const gone = OD.Damage.repairTime(sh, 'nosuchpart');
    return { clean, cleanBreach, holed, holedBreach, halfHurt, halfClean, others, tankFull, gone };
  });
  check('a wrecked drive is 240 s of work doubled', timing.clean === 480 && !timing.cleanBreach, timing.clean + ' s');
  check('a breached facet puts the party in suits', timing.holed === Math.round(480 * 1.5) && timing.holedBreach, timing.holed + ' s');
  check('a half-hurt drive is half the work', timing.halfClean === Math.round(240 * 1.5), timing.halfClean + ' s');
  check('and the breach still tells on it', timing.halfHurt === Math.round(240 * 1.5 * 1.5), timing.halfHurt + ' s');
  check('each kind carries its own minutes', timing.others.reactor === 420 && timing.others.sensors === 300 && timing.others.panel === 240 && timing.tankFull === 60, JSON.stringify(timing.others) + ' tank ' + timing.tankFull);
  check('a part that is not aboard costs nothing', timing.gone === 0, String(timing.gone));

  // repairable() is the one answer the board and the routine both ask.
  const askable = await page.evaluate(() => {
    const sim = OD.Game.sim, sh = sim.playerShips()[0];
    quietCrew(sim);
    OD.Damage.init(sh); sh.damage = { nose: 0, flank: 0, tail: 0 };
    const get = (id) => sh.components.find((c) => c.id === id);
    const mountId = sh.components.find((c) => c.kind === 'mount').id;
    const tank = sh.components.find((c) => c.kind === 'tank');
    const ask = {};
    const set = (key, id, hp, extra) => { const c = get(id); c.hp = hp; Object.assign(c, extra || {}); OD.Damage.aggregate(sh); ask[key] = OD.Damage.repairable(sh, id); };
    set('driveWrecked', 'drive', 0);
    set('driveAtCap', 'drive', 0.7);
    set('driveWhole', 'drive', 1);
    set('panelWrecked', 'rad1', 0);
    set('panelDamaged', 'rad1', 0.4);
    set('mountWrecked', mountId, 0);
    set('mountDamaged', mountId, 0.4);
    set('tankSound', tank.id, 1, { isolated: false, vented: 0 });
    set('tankDented', tank.id, 0.8, { isolated: false, vented: 0 });
    set('tankVenting', tank.id, 0.2, { isolated: false, vented: 0 });
    set('tankDry', tank.id, 0.2, { isolated: false, vented: tank.share });
    set('tankIsolated', tank.id, 0.5, { isolated: true, vented: 10 });
    ask.unknown = OD.Damage.repairable(sh, 'nosuchpart');
    return ask;
  });
  check('a wrecked drive is worth a party', askable.driveWrecked);
  check('a drive at the cap is not', !askable.driveAtCap && !askable.driveWhole);
  check('a wrecked panel and a wrecked mount are not', !askable.panelWrecked && !askable.mountWrecked);
  check('a damaged panel and a damaged mount are', askable.panelDamaged && askable.mountDamaged);
  check('a venting tank and a dented tank are', askable.tankVenting && askable.tankDented);
  check('a sound tank, a dry one and an isolated one are not', !askable.tankSound && !askable.tankDry && !askable.tankIsolated, JSON.stringify(askable));
  check('a part that is not aboard is not', !askable.unknown);

  // hit() tells the crew module who was at that part. The crew module may not be aboard.
  const casualties = await page.evaluate(() => {
    const sim = OD.Game.sim, sh = sim.playerShips()[0];
    quietCrew(sim);
    sh.systems.drive = sh.systems.radiators = sh.systems.sensors = sh.systems.weapons = 1;
    OD.Damage.init(sh); sh.hull = 1; sh.damage = { nose: 0, flank: 0, tail: 0 };
    const had = Object.prototype.hasOwnProperty.call(OD, 'Crew') ? OD.Crew : undefined;
    const calls = [];
    OD.Crew = { casualties: (ship, partId, severity) => { calls.push({ ship: ship && ship.id, partId, severity }); } };
    for (let i = 0; i < 4; i++) OD.Damage.hit(sim, sh, { joules: 1.2e8, facet: 'tail', aim: 'drive', kind: 'beam' });
    const partIds = sh.components.map((c) => c.id);
    // a crew module that throws never costs the ship its damage model
    OD.Crew = { casualties: () => { throw new Error('crew adrift'); } };
    let threw = false, landed = null;
    try { landed = OD.Damage.hit(sim, sh, { joules: 1.2e8, facet: 'tail', aim: 'drive', kind: 'beam' }); } catch (e) { threw = true; }
    // and with no crew module at all
    if (had === undefined) delete OD.Crew; else OD.Crew = had;
    const bare = OD.Damage.hit(sim, sh, { joules: 1.2e8, facet: 'flank', aim: 'hull', kind: 'beam' });
    return {
      calls, threw, partIds,
      guardedHit: !!(landed && landed.component), bareHit: !!(bare && bare.component),
      restored: had === undefined ? !('Crew' in OD) : OD.Crew === had,
    };
  });
  check('every hit tells the crew module which part took it', casualties.calls.length === 4 && casualties.calls.every((c) => casualties.partIds.indexOf(c.partId) >= 0), casualties.calls.map((c) => c.partId).join(','));
  check('the severity is the integrity that hit took off', casualties.calls.every((c) => c.severity > 0 && c.severity <= 1), casualties.calls.map((c) => c.severity.toFixed(3)).join(','));
  check('a crew module that throws does not stop the hit', !casualties.threw && casualties.guardedHit);
  check('a hull with no crew module aboard takes hits as before', casualties.bareHit && casualties.restored);

  // The isolated tank rides the fleet record, and an old record without it still loads.
  const record = await page.evaluate(() => {
    const sim = OD.Game.sim, sh = sim.playerShips()[0];
    quietCrew(sim);
    OD.Damage.init(sh);
    const tank = sh.components.find((c) => c.kind === 'tank');
    tank.hp = 0.2; OD.Damage.aggregate(sh);
    for (let i = 0; i < 30; i++) OD.Damage.update(sim, 1);
    OD.Damage.mend(sh, tank.id);
    const rec = OD.Damage.toRecord(sh);
    const row = rec.find((r) => r.id === tank.id);
    const copy = OD.Sim.makeShip({ cls: sh.cls, faction: 'JC', components: rec });
    const copyRow = OD.Damage.report(copy).find((r) => r.id === tank.id);
    const old = OD.Sim.makeShip({ cls: sh.cls, faction: 'JC', components: rec.map((r) => ({ id: r.id, hp: r.hp })) });
    const oldRow = OD.Damage.report(old).find((r) => r.id === tank.id);
    const yard = { cls: sh.cls, hull: 0.5, systems: { ...sh.systems }, components: rec.map((r) => ({ ...r })) };
    OD.Damage.repair(yard, 1);
    const keys = yard.components.map((c) => Object.keys(c).sort().join(',')).filter((v, i, a) => a.indexOf(v) === i);
    const others = rec.filter((r) => r.id !== tank.id).map((r) => Object.keys(r).sort().join(',')).filter((v, i, a) => a.indexOf(v) === i);
    return { row, copyState: copyRow.state, oldState: oldRow.state, oldHp: oldRow.hp, keys, others, yardTank: yard.components.find((c) => c.id === tank.id) };
  });
  check('the record carries the isolated tank', !!record.row && record.row.iso === 1 && record.row.hp === 0.5, JSON.stringify(record.row));
  check('a loaded ship reads it isolated again', record.copyState === 'isolated', record.copyState);
  check('an old record without the field still loads', record.oldState === 'damaged' && record.oldHp === 0.5, record.oldState + ' at ' + record.oldHp);
  check('an untouched part stays { id, hp }', record.others.join(' | ') === 'hp,id', record.others.join(' | '));
  check('the yard welds the hole shut', record.keys.join(' | ') === 'hp,id' && record.yardTank.hp === 1, record.keys.join(' | '));

  // ------------------------------------------------------- the names and words on a lettered rack
  // A frigate carries lettered turrets and numbered point-defence lasers beside a bare coilgun, and
  // a lancer carries lettered bays: a name that ends in a designator takes no article, the way
  // radiator panels and tanks already read. The bay launches out of its cells, so its words say so
  // while every other mount keeps the firing words.
  console.log('scenario: a lettered rack names itself, and the bay launches');
  await page.evaluate(() => {
    OD.harness.start(OD.Skirmish.build({ player: 'JC', env: 'deep', range: 300, playerShips: { frigate: 1, lancer: 1 }, enemyShips: { corvette: 1 }, seed: 11 }));
  });
  const rack = await page.evaluate(() => {
    const sim = OD.Game.sim;
    const fr = sim.playerShips().find((s) => s.cls === 'frigate');
    const la = sim.playerShips().find((s) => s.cls === 'lancer');
    quietCrew(sim);
    for (const sh of [fr, la]) {
      sh.systems.drive = sh.systems.radiators = sh.systems.sensors = sh.systems.weapons = 1;
      OD.Damage.init(sh); sh.hull = 1; sh.damage = { nose: 0, flank: 0, tail: 0 };
    }
    const get = (sh, id) => sh.components.find((c) => c.id === id);
    const names = {
      turret: OD.Damage.plainName(get(fr, 'beam1')),
      pd: OD.Damage.plainName(get(fr, 'pd1')),
      coilgun: OD.Damage.plainName(get(fr, 'coil1')),
      bay: OD.Damage.plainName(get(fr, 'bay1')),
      letteredBay: OD.Damage.plainName(get(la, 'bay1')),
      panel: OD.Damage.plainName(get(fr, 'rad1')),
      row: OD.Damage.plainName(OD.Damage.report(fr).find((r) => r.id === 'beam1')),
    };
    const at = (sh, id, hp) => {
      const c = get(sh, id); c.hp = hp;
      OD.Damage.aggregate(sh);
      const r = OD.Damage.report(sh).find((x) => x.id === id);
      return { state: r.state, effect: r.effect, buys: r.buys, name: r.name };
    };
    const turret = at(fr, 'beam1', 0.2);
    const bayDamaged = at(fr, 'bay1', 0.55);
    const coilgun = at(fr, 'coil1', 0.55);
    const bayMend = OD.Damage.mend(fr, 'bay1');
    const bayWrecked = at(fr, 'bay1', 0);
    const letteredBay = at(la, 'bay1', 0.55);
    return { names, turret, bayDamaged, coilgun, bayMend, bayWrecked, letteredBay };
  });
  check('a lettered mount is named without an article',
    rack.names.turret === 'laser turret A' && rack.names.pd === 'point-defence laser 1'
      && rack.names.letteredBay === 'interceptor bay A' && rack.names.row === rack.names.turret,
    JSON.stringify(rack.names));
  check('a bare name keeps its article',
    rack.names.coilgun === 'the coilgun' && rack.names.bay === 'the interceptor bay'
      && rack.names.panel === 'radiator panel 1',
    rack.names.coilgun + ' · ' + rack.names.bay);
  check('the sentence around a lettered mount still reads',
    /^A party brings laser turret A to 80 %: it keeps firing, and 4 times the damage to wreck it\. \d+ min\.$/.test(rack.turret.buys),
    rack.turret.buys);
  check('a damaged bay is still launching',
    rack.bayDamaged.state === 'damaged' && rack.bayDamaged.effect === 'Interceptor bay 55 %: damaged, still launching'
      && / to 80 %: it keeps launching, and 1\.5 times the damage to wreck it\./.test(rack.bayDamaged.buys),
    rack.bayDamaged.effect + ' · ' + rack.bayDamaged.buys);
  check('the mend line launches too, and a lettered bay reads the same',
    / jury-rigged to 80 %: it keeps launching, and 1\.5 times the damage to wreck it$/.test(rack.bayMend)
      && rack.letteredBay.effect === 'Interceptor bay A 55 %: damaged, still launching',
    rack.bayMend + ' · ' + rack.letteredBay.effect);
  check('nothing launches from a wrecked bay',
    rack.bayWrecked.state === 'wrecked' && rack.bayWrecked.effect === 'Interceptor bay wrecked: nothing launches from it',
    rack.bayWrecked.effect);
  check('the other mounts keep the firing words',
    /: damaged, still firing$/.test(rack.coilgun.effect) && /it keeps firing, and /.test(rack.coilgun.buys),
    rack.coilgun.effect);
  console.log('    ' + [rack.names.turret, rack.turret.buys, rack.bayDamaged.effect, rack.bayMend, rack.bayWrecked.effect].join('\n    '));

  // The sim keeps running with all of this in it.
  await page.evaluate(() => {
    OD.harness.start(OD.Skirmish.build({ player: 'JC', env: 'deep', range: 300, playerShips: { frigate: 1, corvette: 1 }, enemyShips: { frigate: 1, corvette: 1 }, seed: 7 }));
    const sim = OD.Game.sim;
    for (const s of sim.ships) {
      const h = sim.nearestHostile(s);
      if (h) { sim.setTarget(s.id, h.id); s.weaponsFree = true; sim.setOrder(s.id, { type: 'keeprange', target: h.id, range: 250e3 }); }
      if (s.components) { const t = s.components.find((c) => c.kind === 'tank'); if (t) { t.hp = 0.3; OD.Damage.aggregate(s); } }
    }
  });
  for (let i = 0; i < 3; i++) await page.evaluate(() => OD.harness.step(600));
  const run = await page.evaluate(() => {
    const st = OD.harness.state();
    return { errors: st.errors, renderError: st.renderError, finite: st.ships.every((s) => s.finite), hull: st.ships.map((s) => s.hull.toFixed(2)).join(','), outcome: st.outcome };
  });
  check('a fight with venting hulls runs 1800 s without errors', run.errors.length === 0 && !run.renderError && run.finite, run.errors.join(' | ') + (run.renderError || ''));
  console.log('    outcome ' + run.outcome + ', hulls ' + run.hull);

  const realErrors = consoleErrors.filter((e) => !/fonts.googleapis|ERR_INTERNET|net::ERR|Failed to load resource/.test(e) && !(/^file:/.test(url) && /Access to font/.test(e)));
  check('no console errors', realErrors.length === 0, realErrors.join(' | '));

  await browser.close();
  console.log(failures ? failures + ' check(s) failed' : 'all checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
