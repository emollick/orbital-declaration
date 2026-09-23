/* Orbital Declaration — the yard: a ship configurator.
   Builds design objects in the exact shape of an OD.Ships.CLASSES entry, so the simulation runs them unchanged,
   and computes every number it shows with the game's own physics (OD.P) and the same heat balance as the sim.

   ============================ INTERFACE (OD.Configurator) ============================
   OD.Configurator.mount(rootElement, options) → controller
       Renders the whole yard into rootElement. One <style id="odc-style"> is added to the document head the first
       time; every selector is under .odc and uses the bridge tokens (--ground, --glass, --line, --ink, --dim,
       --accent, --good, --warn, --crit, --display, --mono, --sans) with fallbacks, so the host can theme it.
       options = {
         onFly(design, scenario)   the player pressed "Fly this design": a skirmish scenario with the design as the
                                   player's ship (see flyScenario). Absent → the button is hidden.
         onSave(design)            after a save (also saved to localStorage 'od.designs').
         onBack()                  the Back key. Absent → hidden.
         designId                  open this saved design; otherwise a fresh design on a stock hull.
         base                      stock hull for a fresh design ('frigate' by default).
         faction                   'JC' | 'ISA' | 'CIV' for names and hull markings ('JC').
         detail                    'essentials' | 'full' (essentials).
       }
       controller = { design() → current design, load(id), set(params), destroy() }

   Design objects: the keys of a ships.js class (id, name, role, length, dryMass, propMass, exhaustVelocity,
   thrust, angAccel, maxAngVel, reactorPower, idleHeat, driveHeat, sinkCapacity, radiatorArea, radiatorTemp,
   radiatorDeployTime, armour, mounts, doctrine, blurb) plus custom: true, base (stock hull id), beam (hull width,
   m), rev (bumped on every change), params (the yard's own choices; the saved form), masses, comps, summary, savedAt.

   OD.Configurator.register(design)     installs the design into OD.Ships.CLASSES[id] and OD.Ships.SHAPES[id] so a
                                        spec { cls: design.id } runs through OD.Sim.makeShip. Runtime only.
   OD.Configurator.unregister(id)       removes a custom design from those tables (remove(id) calls it).
   OD.Configurator.installSaved()       registers every saved design (call once at boot, before any Sim is built).
   OD.Configurator.list() / get(id) / save(design) / remove(id)     localStorage 'od.designs' (params only;
                                        designs are re-derived on load so model changes apply to old saves;
                                        a record this build cannot read is skipped, never fatal). save() returns
                                        null when the browser refuses the write. records() lists {id, name, base,
                                        savedAt, params} without deriving.
   mount() keeps one controller per root (root._odc); mounting again on the same root destroys the old one.
   OD.Configurator.derive(params, id)   params → design.   presetParams(base) → the stock hull's own choices.
   OD.Configurator.analyse(design)      the readout: delta-v, acceleration, heat rows, power, reach, cost, issues.
   OD.Configurator.toSpec(design, extra)      a ship spec for a scenario.
   OD.Configurator.flyScenario(design, opts)  a skirmish scenario with the design as the player's ship.
   OD.Configurator.cost(design)         requisition points on the campaign scale.
   OD.Configurator.testFlight(design, seconds)   runs a real OD.Sim full burn and compares with the predictions.
   OD.Configurator.CATALOGUE / BASES    the fittings and hull families.
   ================================================================================== */
(function () {
  'use strict';
  const OD = (window.OD = window.OD || {});
  const U = OD.U, P = OD.P;
  const g0 = 9.80665;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const KEY = 'od.designs';
  const esc = (s) => (U && U.escapeHtml ? U.escapeHtml(s) : String(s));
  const CLASSES = () => OD.Ships.CLASSES;

  // ------------------------------------------------------------------ hull families
  // beam: hull width (m). slots: hardpoints per group. cost: campaign requisition of the stock loadout.
  // tankUnit: propellant per tank (kg); stock hulls carry four.
  const BASES = {
    corvette:  { beam: 12, slots: { spinal: 1, turret: 1, rail: 1, bay: 1, pd: 2 }, cost: 40,  tankUnit: 350e3 },
    frigate:   { beam: 18, slots: { spinal: 1, turret: 2, rail: 1, bay: 2, pd: 3 }, cost: 70,  tankUnit: 800e3 },
    destroyer: { beam: 26, slots: { spinal: 1, turret: 3, rail: 2, bay: 2, pd: 4 }, cost: 120, tankUnit: 1500e3 },
    cruiser:   { beam: 40, slots: { spinal: 1, turret: 4, rail: 2, bay: 2, pd: 6 }, cost: 260, tankUnit: 3750e3 },
    lancer:    { beam: 14, slots: { spinal: 0, turret: 1, rail: 0, bay: 3, pd: 2 }, cost: 55,  tankUnit: 400e3 },
    freighter: { beam: 30, slots: { spinal: 0, turret: 1, rail: 0, bay: 1, pd: 2 }, cost: 60,  tankUnit: 2000e3 },
  };
  const BASE_ORDER = ['corvette', 'frigate', 'destroyer', 'cruiser', 'lancer', 'freighter'];
  const GROUPS = ['spinal', 'turret', 'rail', 'bay', 'pd'];
  const LOOK = {
    tanks: { label: 'Tanks', options: [['auto', 'Yard\'s choice'], ['cluster', 'Clustered'], ['inline', 'In line'], ['saddle', 'Saddle'], ['ring', 'Ring']] },
    material: { label: 'Tank finish', options: [['auto', 'Yard\'s choice'], ['tank', 'Gold foil'], ['tankSilver', 'Silver foil'], ['tankWhite', 'White paint']] },
    radiators: { label: 'Radiators', options: [['auto', 'Yard\'s choice'], ['wings', 'Wings'], ['cross', 'Cross'], ['fan', 'Fan']] },
    nozzles: { label: 'Nozzles', options: [['auto', 'Yard\'s choice'], ['1', 'One'], ['2', 'Two'], ['3', 'Three'], ['4', 'Four']] },
  };
  const VIEW_NAME = { blueprint: 'blueprint', threequarter: 'three-quarter', side: 'side', top: 'top' };
  const GROUP_LABEL = { spinal: 'Spinal', turret: 'Turret', rail: 'Rail', bay: 'Bay', pd: 'Point defence' };

  // ------------------------------------------------------------------ mass, power and heat rules
  // Every fitting has a mass; the sum plus the hull's structure is the dry mass. The structure of each hull family is
  // calibrated once so that the stock loadout adds up to the stock dry mass exactly.
  const K = {
    beamKgPerW: 3e-3,        // 3 kg per kW of laser input power
    opticsKgPerM2: 25e3,     // mirror and mount, per m² of aperture
    coilBaseKg: 20e3, coilKgPerJ: 0.8e-3,   // rails and capacitors, per joule of muzzle energy
    bayBaseKg: 40e3, perInterceptorKg: 800, // cells, handling gear, and the craft itself
    pdKgPerW: 4e-3,
    radiatorKgPerM2: 12,
    sinkKgPerJ: 1 / 4e5,     // 400 kJ per kg of heat sink
    driveKgPerN: 3e-3,       // 3 t per MN at the family's stock exhaust velocity; grows with the square of ve
    reactorKgPerW: 1.5e-3,   // 1.5 t per MW
    tankage: 0.04,           // tank structure per kg of propellant
    armourFrac: 0.18,        // the stock armour is this share of the stock dry mass
    coilEfficiency: 0.5,     // reactor draw = muzzle energy / cycle / efficiency
  };

  // ------------------------------------------------------------------ the catalogue
  // mountName is the in-game mount family; label is the yard's name for the fitting. Records produced by make()
  // are identical in shape to the ones ships.js builds.
  const INTERCEPTOR = { dryMass: 150, propMass: 250, exhaustVelocity: 8000, accel: 60 };
  const CAT = {
    laser_light:     { kind: 'beam', slots: ['spinal', 'turret'], label: 'Light laser', mountName: 'Laser turret', spinalName: 'Spinal laser', power: 8e6, aperture: 0.8, note: 'The lightest mount. 8 MW on a 0.8 m mirror.' },
    laser_spinal:    { kind: 'beam', slots: ['spinal'], label: 'Spinal laser', mountName: 'Spinal laser', power: 12e6, aperture: 1.0, note: '12 MW on a 1.0 m mirror, fixed along the nose. The whole ship aims it.' },
    laser_turret:    { kind: 'beam', slots: ['turret', 'spinal'], label: 'Laser turret', mountName: 'Laser turret', spinalName: 'Spinal laser', power: 10e6, aperture: 0.9, note: 'The standard turret of both navies. 10 MW on a 0.9 m mirror.' },
    laser_heavy:     { kind: 'beam', slots: ['turret', 'spinal'], label: 'Heavy laser turret', mountName: 'Laser turret', spinalName: 'Spinal laser', power: 15e6, aperture: 1.2, note: 'A 1.2 m mirror, half as much reach again as a 0.8 m one.' },
    laser_main:      { kind: 'beam', slots: ['turret', 'spinal'], label: 'Main laser', mountName: 'Main laser', spinalName: 'Main laser', power: 25e6, aperture: 1.6, note: 'Cruiser optics. 25 MW from the reactor and 16 MW into the sink while it fires.' },
    laser_lance:     { kind: 'beam', slots: ['spinal'], label: 'Heavy spinal laser', mountName: 'Spinal laser', power: 30e6, aperture: 2.0, note: 'A 2.0 m mirror, the longest reach in the system. It draws 30 MW on its own.' },
    coil_std:        { kind: 'coilgun', slots: ['rail'], label: 'Coilgun', mountName: 'Coilgun', mv: 4000, slug: 5, cycle: 6, mag: 90, note: '5 kg slugs at 4 km/s, one every 6 s, 90 in the magazine.' },
    coil_long:       { kind: 'coilgun', slots: ['rail'], label: 'Coilgun, long', mountName: 'Coilgun', mv: 4000, slug: 8, cycle: 7, mag: 120, note: '8 kg slugs at 4 km/s, one every 7 s, 120 in the magazine.' },
    coil_heavy:      { kind: 'coilgun', slots: ['rail'], label: 'Heavy coilgun', mountName: 'Heavy coilgun', mv: 4500, slug: 12, cycle: 8, mag: 100, note: 'Destroyer mount. 12 kg at 4.5 km/s, three times the energy of a light slug.' },
    coil_heavy_long: { kind: 'coilgun', slots: ['rail'], label: 'Heavy coilgun, long', mountName: 'Heavy coilgun', mv: 5000, slug: 20, cycle: 10, mag: 80, note: 'Cruiser mount. 20 kg at 5 km/s, the shortest flight time of any coilgun.' },
    bay_6:           { kind: 'launcher', slots: ['bay'], label: 'Interceptors ×6', mountName: 'Interceptor bay', count: 6 },
    bay_12:          { kind: 'launcher', slots: ['bay'], label: 'Interceptors ×12', mountName: 'Interceptor bay', count: 12 },
    bay_16:          { kind: 'launcher', slots: ['bay'], label: 'Interceptors ×16', mountName: 'Interceptor bay', count: 16 },
    bay_24:          { kind: 'launcher', slots: ['bay'], label: 'Interceptors ×24', mountName: 'Interceptor bay', count: 24 },
    pd_std:          { kind: 'pd', slots: ['pd'], label: 'Point-defence laser', mountName: 'Point-defence laser', power: 2e6, aperture: 0.3 },
    pd_heavy:        { kind: 'pd', slots: ['pd'], label: 'Point-defence laser, heavy', mountName: 'Point-defence laser', power: 2.5e6, aperture: 0.3 },
    pd_wide:         { kind: 'pd', slots: ['pd'], label: 'Point-defence laser, wide', mountName: 'Point-defence laser', power: 3e6, aperture: 0.35 },
  };
  for (const id in CAT) CAT[id].id = id;

  function catMass(c) {
    if (c.kind === 'beam') return c.power * K.beamKgPerW + c.aperture * c.aperture * K.opticsKgPerM2;
    if (c.kind === 'coilgun') return K.coilBaseKg + 0.5 * c.slug * c.mv * c.mv * K.coilKgPerJ + c.slug * c.mag;
    if (c.kind === 'launcher') return K.bayBaseKg + c.count * K.perInterceptorKg;
    if (c.kind === 'pd') return c.power * K.pdKgPerW;
    return 0;
  }
  function catDraw(c) {   // reactor power while firing (W)
    if (c.kind === 'beam' || c.kind === 'pd') return c.power;
    if (c.kind === 'coilgun') return 0.5 * c.slug * c.mv * c.mv / c.cycle / K.coilEfficiency;
    if (c.kind === 'launcher') return 0.5e6;
    return 0;
  }
  function catHeat(c) {   // heat into the sink while firing (W), the way the sim books it
    if (c.kind === 'beam') return c.power * (1 - 0.35);
    if (c.kind === 'pd') return c.power * (1 - 0.3);
    if (c.kind === 'coilgun') return 0.15 * 0.5 * c.slug * c.mv * c.mv / c.cycle;
    return 0;
  }
  function makeMount(c, name, group) {
    if (c.kind === 'beam') return { kind: 'beam', name, power: c.power, efficiency: 0.35, aperture: c.aperture, wavelength: 1064e-9, arc: group === 'spinal' ? 'nose' : 'turret' };
    if (c.kind === 'coilgun') return { kind: 'coilgun', name, muzzleVelocity: c.mv, slugMass: c.slug, cycle: c.cycle, magazine: c.mag, heatPerShot: 0.15 * 0.5 * c.slug * c.mv * c.mv };
    if (c.kind === 'launcher') return { kind: 'launcher', name, count: c.count, interceptor: { ...INTERCEPTOR } };
    return { kind: 'pd', name, power: c.power, efficiency: 0.3, aperture: c.aperture, wavelength: 532e-9 };
  }
  function catForSlot(group) { return Object.values(CAT).filter((c) => c.slots.includes(group)); }
  // Which catalogue entry is this stock mount record?
  function matchCat(m) {
    const all = Object.values(CAT);
    if (m.kind === 'beam') { const c = all.filter((c) => c.kind === 'beam' && c.power === m.power && c.aperture === m.aperture); return (m.arc === 'nose' ? c.find((x) => x.slots[0] === 'spinal') : c.find((x) => x.slots[0] === 'turret')) || c[0] || null; }
    if (m.kind === 'coilgun') return all.find((c) => c.kind === 'coilgun' && c.mv === m.muzzleVelocity && c.slug === m.slugMass) || null;
    if (m.kind === 'launcher') return all.find((c) => c.kind === 'launcher' && c.count === m.count) || null;
    if (m.kind === 'pd') return all.find((c) => c.kind === 'pd' && c.power === m.power && c.aperture === m.aperture) || null;
    return null;
  }

  // ------------------------------------------------------------------ params
  // The yard's own choices; the saved form of a design.
  function emptySlots(base) { const s = {}; for (const g of GROUPS) s[g] = new Array(BASES[base].slots[g]).fill(null); return s; }
  function presetParams(base) {
    const stock = CLASSES()[base];
    const p = {
      base, name: stock.name.split('-')[0],
      thrust: stock.thrust, ve: stock.exhaustVelocity, prop: stock.propMass, reactor: stock.reactorPower,
      sink: stock.sinkCapacity, radiator: stock.radiatorArea, armour: { ...stock.armour },
      slots: emptySlots(base), names: {}, look: { tanks: 'auto', material: 'auto', radiators: 'auto', nozzles: 'auto' },
    };
    const fill = { spinal: 0, turret: 0, rail: 0, bay: 0, pd: 0 };
    for (const m of stock.mounts) {
      const c = matchCat(m);
      if (!c) continue;
      const g = m.kind === 'beam' ? (m.arc === 'nose' ? 'spinal' : 'turret') : m.kind === 'coilgun' ? 'rail' : m.kind === 'launcher' ? 'bay' : 'pd';
      if (fill[g] >= p.slots[g].length) p.slots[g].push(null);
      p.slots[g][fill[g]] = c.id;
      p.names[g + fill[g]] = m.name;
      fill[g]++;
    }
    return p;
  }
  const own = (o, k) => o != null && typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);
  function normaliseParams(p) {
    const base = own(BASES, p && p.base) ? p.base : 'frigate';
    const stock = CLASSES()[base], q = presetParams(base);
    const num = (v, d, lo, hi) => (isFinite(+v) && v != null ? clamp(+v, lo, hi) : d);
    const out = {
      base, name: (p && typeof p.name === 'string' && p.name.trim()) ? p.name.trim().slice(0, 24) : q.name,
      thrust: num(p && p.thrust, q.thrust, stock.thrust * 0.3, stock.thrust * 2.5),
      ve: num(p && p.ve, q.ve, 35e3, 70e3),
      prop: num(p && p.prop, q.prop, stock.propMass * 0.2, stock.propMass * 2.5),
      reactor: num(p && p.reactor, q.reactor, stock.reactorPower * 0.5, stock.reactorPower * 3),
      sink: num(p && p.sink, q.sink, stock.sinkCapacity * 0.5, stock.sinkCapacity * 3),
      radiator: num(p && p.radiator, q.radiator, stock.radiatorArea * 0.25, stock.radiatorArea * 3),
      armour: {
        nose: num(p && p.armour && p.armour.nose, q.armour.nose, 0, Math.max(6, stock.armour.nose * 3)),
        flank: num(p && p.armour && p.armour.flank, q.armour.flank, 0, Math.max(6, stock.armour.flank * 3)),
        tail: num(p && p.armour && p.armour.tail, q.armour.tail, 0, Math.max(6, stock.armour.tail * 3)),
      },
      slots: emptySlots(base), names: {}, look: {},
    };
    for (const k in LOOK) { const v = p && p.look && p.look[k]; out.look[k] = LOOK[k].options.some((o) => o[0] === v) ? v : 'auto'; }
    for (const g of GROUPS) {
      const src = (p && p.slots && p.slots[g]) || [];
      for (let i = 0; i < out.slots[g].length; i++) { const id = src[i]; out.slots[g][i] = own(CAT, id) && CAT[id].slots.includes(g) ? id : null; }
    }
    if (p && p.names && typeof p.names === 'object') for (const k of Object.keys(p.names)) if (typeof p.names[k] === 'string') out.names[k] = p.names[k].slice(0, 40);
    return out;
  }
  const deep = (o) => JSON.parse(JSON.stringify(o));
  function sameParams(a, b) { return JSON.stringify(normaliseParams(a)) === JSON.stringify(normaliseParams(b)); }

  // ------------------------------------------------------------------ fittings from slots
  function fittings(p) {
    const chosen = [];
    for (const g of GROUPS) (p.slots[g] || []).forEach((id, i) => { if (own(CAT, id)) chosen.push({ group: g, i, cat: CAT[id], key: g + i }); });
    const families = {};
    for (const c of chosen) { const fam = c.cat.kind + ':' + (c.group === 'spinal' && c.cat.spinalName ? c.cat.spinalName : c.cat.mountName); (families[fam] = families[fam] || []).push(c); c.fam = fam; }
    const mounts = [], comps = [];
    for (const c of chosen) {
      const list = families[c.fam];
      let name = c.fam.split(':')[1];
      if (list.length > 1) { const idx = list.indexOf(c); name += c.cat.kind === 'pd' ? ' ' + (idx + 1) : ' ' + String.fromCharCode(65 + idx); }
      if (p.names && p.names[c.key]) name = p.names[c.key];
      const m = makeMount(c.cat, name, c.group);
      mounts.push(m);
      comps.push({ key: c.key, group: c.group, catId: c.cat.id, label: c.cat.label, name, kind: c.cat.kind, mass: catMass(c.cat), draw: catDraw(c.cat), heat: catHeat(c.cat) });
    }
    return { mounts, comps };
  }

  // ------------------------------------------------------------------ calibration per hull family
  const CAL = {};
  function facingAreas(base) {
    const stock = CLASSES()[base], b = BASES[base].beam;
    const nose = Math.PI * (b / 2) * (b / 2);
    return { nose, flank: Math.PI * b * stock.length * 0.5, tail: nose };
  }
  function armourWeighted(base, armour) { const A = facingAreas(base); return armour.nose * A.nose + armour.flank * A.flank + armour.tail * A.tail; }
  function calibration(base) {
    if (CAL[base]) return CAL[base];
    const stock = CLASSES()[base], q = presetParams(base);
    const kArm = (K.armourFrac * stock.dryMass) / Math.max(1, armourWeighted(base, stock.armour));
    const parts = partMasses(base, q, { structure: 0, kArm });
    const sum = Object.values(parts).reduce((a, v) => a + v, 0);
    let structure = stock.dryMass - sum;
    if (structure < stock.dryMass * 0.05) structure = stock.dryMass * 0.05;   // never happens with the stock data; a guard for edits
    const stockBeams = (stock.mounts || []).filter((x) => x.kind === 'beam');
    const stockReach = stockBeams.length ? Math.max(...stockBeams.map((b) => reach(b))) : 0;
    CAL[base] = { structure, kArm, stockPartMasses: parts, stockMountMass: parts.mounts, stockReach };
    return CAL[base];
  }
  // A hull jinks when it is light and lively; the stock class's own call stands while the design is within a
  // fifth of the stock mass and acceleration, so unchanged fits keep their doctrine exactly.
  function jinkRule(stock, m, accel) {
    const m0 = stock.dryMass + stock.propMass, a0 = stock.thrust / m0;
    if (Math.abs(m / m0 - 1) < 0.2 && Math.abs(accel / a0 - 1) < 0.2) return !!stock.doctrine.jink;
    return m < 8e6 && accel > 5;
  }
  function partMasses(base, p, cal) {
    const stock = CLASSES()[base];
    const f = fittings(p);
    return {
      structure: cal.structure,
      armour: cal.kArm * armourWeighted(base, p.armour),
      sink: p.sink * K.sinkKgPerJ,
      radiators: p.radiator * K.radiatorKgPerM2,
      drive: p.thrust * K.driveKgPerN * Math.pow(p.ve / stock.exhaustVelocity, 2),
      reactor: p.reactor * K.reactorKgPerW,
      mounts: f.comps.reduce((a, c) => a + c.mass, 0),
      tankage: p.prop * K.tankage,
    };
  }

  // ------------------------------------------------------------------ derive: params → design
  let revCounter = 1;
  function derive(params, id) {
    const p = normaliseParams(params);
    const base = p.base, stock = CLASSES()[base], B = BASES[base], cal = calibration(base);
    const f = fittings(p);
    const masses = partMasses(base, p, cal);
    const dryMass = Math.round(Object.values(masses).reduce((a, v) => a + v, 0));
    const propMass = Math.round(p.prop);
    const m = dryMass + propMass, m0 = stock.dryMass + stock.propMass;
    const length = Math.round(stock.length * (0.65 + 0.35 * (p.prop / stock.propMass)));
    const beams = f.mounts.filter((x) => x.kind === 'beam'), bays = f.mounts.filter((x) => x.kind === 'launcher'), coils = f.mounts.filter((x) => x.kind === 'coilgun');
    const accel = p.thrust / m;
    // keep-range doctrine: the stock class's range scaled by the reach of the longest beam, so an unchanged fit
    // keeps the stock doctrine exactly and a longer beam pushes the default keep-range distance out
    let range = 0;
    if (beams.length) { const r = Math.max(...beams.map((b) => reach(b))); range = cal.stockReach > 0 ? stock.doctrine.range * (r / cal.stockReach) : r * 1.3; }
    if (bays.length && !beams.length) range = Math.max(range, 2500e3);
    if (coils.length && !beams.length) range = Math.max(range, 300e3);
    const doctrine = { range: Math.round(range / 1e3) * 1e3, jink: jinkRule(stock, m, accel) };
    if (!f.mounts.length && base === 'freighter') doctrine.civilian = true;
    const tanks = Math.max(1, Math.round(p.prop / B.tankUnit));
    const dv = P.tsiolkovsky(p.ve, m, dryMass);
    const name = p.name + '-class ' + stock.role;
    const design = {
      id: id || newId(), name, role: stock.role, length,
      dryMass, propMass, exhaustVelocity: p.ve, thrust: p.thrust,
      angAccel: stock.angAccel * clamp(m0 / m, 0.4, 1.8), maxAngVel: stock.maxAngVel * clamp(Math.sqrt(m0 / m), 0.5, 1.5),
      reactorPower: p.reactor, idleHeat: stock.idleHeat * (p.reactor / stock.reactorPower),
      driveHeat: stock.driveHeat * (p.thrust / stock.thrust) * (p.ve / stock.exhaustVelocity),
      sinkCapacity: p.sink, radiatorArea: p.radiator, radiatorTemp: stock.radiatorTemp,
      radiatorDeployTime: Math.max(10, Math.round(stock.radiatorDeployTime * Math.sqrt(p.radiator / stock.radiatorArea))),
      armour: { nose: p.armour.nose, flank: p.armour.flank, tail: p.armour.tail },
      mounts: f.mounts, doctrine, blurb: '',
      custom: true, base, beam: B.beam, rev: revCounter++, params: p, masses, comps: f.comps,
      summary: { dv, accel, g: accel / g0, mass: m, tanks, cost: 0 },
    };
    design.summary.cost = cost(design);
    design.blurb = blurb(design);
    // cosmetic choices the ship-art module reads; absent means its own preset for the hull family
    if (p.look.tanks !== 'auto' || p.look.material !== 'auto') design.tanks = Object.assign({ count: tanks }, p.look.tanks !== 'auto' ? { arrangement: p.look.tanks } : {}, p.look.material !== 'auto' ? { material: p.look.material } : {});
    if (p.look.radiators !== 'auto') design.radiators = { layout: p.look.radiators };
    if (p.look.nozzles !== 'auto') design.drive = { nozzles: +p.look.nozzles };
    return design;
  }
  function newId() { return 'custom_' + Math.random().toString(36).slice(2, 7); }
  function blurb(d) {
    const s = d.summary, stock = CLASSES()[d.base];
    const arms = [];
    const n = (k) => d.mounts.filter((m) => m.kind === k).length;
    if (n('beam')) arms.push(n('beam') + (n('beam') > 1 ? ' lasers' : ' laser'));
    if (n('coilgun')) arms.push(n('coilgun') + (n('coilgun') > 1 ? ' coilguns' : ' coilgun'));
    const ic = d.mounts.filter((m) => m.kind === 'launcher').reduce((a, m) => a + m.count, 0);
    if (ic) arms.push(ic + ' interceptors');
    if (n('pd')) arms.push(n('pd') + ' point-defence');
    return d.params.name + '-class ' + stock.role + ' on the ' + stock.name.split('-')[0] + ' hull. ' + U.fmt.dv(s.dv) + ' of delta-v at ' + s.g.toFixed(2) + ' g full-tank. ' + (arms.length ? arms.join(', ') + '.' : 'Unarmed.');
  }
  function cost(d) { return Math.max(5, Math.round(BASES[d.base].cost * Math.pow(d.dryMass / CLASSES()[d.base].dryMass, 0.7))); }
  // range at which a beam's spot is half a metre across (the yard's measure of reach)
  function reach(mount) { return (0.5 * mount.aperture) / (2.44 * mount.wavelength); }

  // ------------------------------------------------------------------ analyse: the readout
  const DASH = 10000e3;   // reference dash: 10 000 km burn-flip-burn, a closing run across a large skirmish board
  function analyse(d) {
    const stock = CLASSES()[d.base];
    const m = d.dryMass + d.propMass;
    const accel = d.thrust / m, accelDry = d.thrust / d.dryMass;
    const dv = P.tsiolkovsky(d.exhaustVelocity, m, d.dryMass);
    const mdot = d.thrust / d.exhaustVelocity;
    const burnTime = d.propMass / mdot;
    const b = P.brachistochrone(DASH, accel);
    const dash = { time: b.time, dv: b.dv, count: b.dv > 0 ? dv / b.dv : 0, peakV: b.peakV };
    const heatOut = P.radiatorPower(d.radiatorArea, d.radiatorTemp);
    const fireHeat = d.comps.reduce((a, c) => a + c.heat, 0);
    const draw = d.comps.reduce((a, c) => a + c.draw, 0);
    // Each row runs the sim's own sink law (physics.js sinkForecast: the panels are only as hot as the sink behind
    // them) from where the row before it leaves the sink, so 'Burn and fire everything' starts at the burn's settle.
    let startLoad = 0;
    const row = (id, label, heatIn) => {
      const net = heatIn - heatOut;
      const r = { id, label, in: heatIn, out: heatOut, net, settle: null, start: startLoad, saturate: net > 0 ? (0.9 * d.sinkCapacity) / net : Infinity, drain: net < 0 ? (0.9 * d.sinkCapacity) / -net : Infinity };
      if (typeof P.sinkForecast === 'function') {
        let f = null; try { f = P.sinkForecast(startLoad * d.sinkCapacity, d.sinkCapacity, heatOut, heatIn, 4 * 3600, d.radiatorTemp); } catch (e) { f = null; }
        if (f) {
          r.net = f.tFull != null ? Math.max(net, 1) : Math.min(net, -1);
          r.saturate = f.tFull != null ? f.tFull : Infinity;
          r.settle = f.tFull != null ? null : f.settle;
          r.out = f.tFull != null ? heatOut : heatIn;
          startLoad = f.tFull != null ? 1 : f.settle;
        }
      }
      return r;
    };
    const heat = [row('idle', 'Coasting', d.idleHeat), row('burn', 'Full burn', d.idleHeat + d.driveHeat), row('fight', 'Burn and fire everything', d.idleHeat + d.driveHeat + fireHeat)];
    const power = { draw, reactor: d.reactorPower, ratio: d.reactorPower > 0 ? draw / d.reactorPower : Infinity };
    const reachRows = [];
    for (const mnt of d.mounts) {
      if (mnt.kind === 'beam') {
        const r = reach(mnt);
        reachRows.push({ name: mnt.name, kind: 'beam', text: U.fmt.dist(r) + ' before the spot passes 50 cm · ' + U.fmt.power(mnt.power * mnt.efficiency) + ' on target', r });
      } else if (mnt.kind === 'coilgun') {
        const t200 = P.slugFlightTime(200e3, mnt.muzzleVelocity);
        const jinkR = mnt.muzzleVelocity * Math.sqrt((2 * 60) / 0.5);   // a target jinking at 0.5 m/s² moves a hull length (60 m) in the flight time
        reachRows.push({ name: mnt.name, kind: 'coilgun', text: U.fmt.time(t200) + ' flight at 200 km · ' + U.fmt.si(0.5 * mnt.slugMass * mnt.muzzleVelocity * mnt.muzzleVelocity, 'J') + ' per slug · a jinking target is safe past ' + U.fmt.dist(jinkR), r: jinkR });
      } else if (mnt.kind === 'launcher') {
        const i = mnt.interceptor, idv = P.tsiolkovsky(i.exhaustVelocity, i.dryMass + i.propMass, i.dryMass);
        const tr = P.transferWithBudget(1000e3, i.accel, idv);
        reachRows.push({ name: mnt.name, kind: 'launcher', text: mnt.count + ' craft · ' + U.fmt.dv(idv) + ' each · 1 000 km in ' + U.fmt.time(tr.time), r: 2500e3 });
      } else if (mnt.kind === 'pd') {
        reachRows.push({ name: mnt.name, kind: 'pd', text: U.fmt.power(mnt.power * mnt.efficiency) + ' against incoming craft', r: 0 });
      }
    }
    const issues = [];
    if (power.ratio > 1.0001) issues.push({ level: 'block', id: 'power', text: 'Firing together, the fittings ask ' + U.fmt.power(draw) + ' of a ' + U.fmt.power(d.reactorPower) + ' reactor. Fit a bigger reactor or drop a fitting.' });
    if (dv < 5000) issues.push({ level: 'warn', id: 'dv', text: 'Only ' + U.fmt.dv(dv) + ' of delta-v. One intercept and the tanks are dry.' });
    if (accel < 0.05 * g0) issues.push({ level: 'warn', id: 'accel', text: 'Full-tank acceleration is ' + (accel / g0).toFixed(3) + ' g. The ' + U.fmt.dist(DASH) + ' dash takes ' + U.fmt.time(dash.time) + '.' });
    const quarterIn = d.idleHeat + 0.25 * d.driveHeat;   // what the drive makes once the sim has capped it
    if (heat[1].net > 0) {
      const stuck = quarterIn > heatOut;
      issues.push({ level: heat[1].saturate < 300 || stuck ? 'warn' : 'note', id: 'heat', text: 'Full burn fills the sink in ' + U.fmt.time(heat[1].saturate) + '. The drive then drops to a quarter' + (stuck ? ' and stays there, because a quarter burn still makes more heat than the radiators shed.' : ' and climbs back as the sink drains.') + ' Fix it with more radiator area, a bigger sink or a smaller drive.' });
    }
    else if (heat[2].saturate < 120 && d.comps.some((c) => c.heat > 0)) issues.push({ level: 'note', id: 'fight', text: 'Burning while every fitting fires fills the sink in ' + U.fmt.time(heat[2].saturate) + '. Fight coasting, or in short bursts.' });
    if (!d.mounts.length) issues.push({ level: 'note', id: 'unarmed', text: 'Unarmed. It can still board a hostile that has been stopped.' });
    const ic = d.mounts.filter((x) => x.kind === 'launcher').reduce((a, x) => a + x.count, 0);
    return {
      mass: m, dry: d.dryMass, prop: d.propMass, dv, dvStock: P.tsiolkovsky(stock.exhaustVelocity, stock.dryMass + stock.propMass, stock.dryMass),
      accel, g: accel / g0, accelDry, gDry: accelDry / g0, burnTime, mdot, dash, heatOut, radiatorTemp: d.radiatorTemp, fireHeat, heat, power, reach: reachRows, issues,
      cost: cost(d), masses: d.masses, interceptors: ic, tanks: d.summary.tanks, length: d.length,
      radiatorSpan: (d.radiatorArea / 2) / (0.25 * stock.length),
      turn180: turnTime(d),
      blocked: issues.some((i) => i.level === 'block'),
    };
  }
  // seconds to swing the nose through 180° at the design's turn rates (accelerate, cruise, brake)
  function turnTime(d) {
    const ang = Math.PI, a = d.angAccel, w = d.maxAngVel;
    const tAcc = w / a, dAcc = 0.5 * a * tAcc * tAcc;
    if (2 * dAcc >= ang) return 2 * Math.sqrt(ang / a);
    return 2 * tAcc + (ang - 2 * dAcc) / w;
  }

  // ------------------------------------------------------------------ what a change did, in a sentence
  const fmtG = (a) => (a / g0).toFixed(2) + ' g';
  const fmtT = (kg) => U.fmt.mass(kg);
  const arrow = (a, b) => (a === b ? 'still ' + a : a + ' → ' + b);
  function explain(control, d0, d1) {
    const a = analyse(d0), b = analyse(d1);
    const dMass = b.dry - a.dry;
    const more = (x, y) => y > x;
    switch (control) {
      case 'prop':
        return (more(a.prop, b.prop) ? 'More propellant. ' : 'Less propellant. ') + 'Delta-v ' + arrow(U.fmt.dv(a.dv), U.fmt.dv(b.dv)) + '. Full-tank acceleration ' + arrow(fmtG(a.accel), fmtG(b.accel)) + ', hull ' + arrow(a.length + ' m', b.length + ' m') + '. The ' + U.fmt.dist(DASH) + ' dash takes ' + U.fmt.time(b.dash.time) + ', and the tanks pay for ' + (b.dash.count < 1 ? 'less than one of them.' : b.dash.count.toFixed(1) + ' of them.');
      case 'thrust':
        return (more(a.accel, b.accel) ? 'A bigger drive. ' : 'A smaller drive. ') + 'Acceleration ' + arrow(fmtG(a.accel), fmtG(b.accel)) + ', so the ' + U.fmt.dist(DASH) + ' dash takes ' + arrow(U.fmt.time(a.dash.time), U.fmt.time(b.dash.time)) + '. It weighs ' + (dMass > 0 ? fmtT(dMass) + ' more' : fmtT(-dMass) + ' less') + ' and its heat goes ' + arrow(U.fmt.power(d0.driveHeat), U.fmt.power(d1.driveHeat)) + '. Delta-v ' + arrow(U.fmt.dv(a.dv), U.fmt.dv(b.dv)) + '.';
      case 've':
        return (more(d0.exhaustVelocity, d1.exhaustVelocity) ? 'Higher exhaust velocity. Every tonne of propellant buys more delta-v, ' : 'Lower exhaust velocity. Every tonne of propellant buys less delta-v, ') + arrow(U.fmt.dv(a.dv), U.fmt.dv(b.dv)) + '. The drive weighs ' + (dMass > 0 ? fmtT(dMass) + ' more' : fmtT(-dMass) + ' less') + ' and its heat goes ' + arrow(U.fmt.power(d0.driveHeat), U.fmt.power(d1.driveHeat)) + '.';
      case 'radiator':
        return (more(a.heatOut, b.heatOut) ? 'More radiator area. ' : 'Less radiator area. ') + 'Heat shed ' + arrow(U.fmt.power(a.heatOut), U.fmt.power(b.heatOut)) + ', so at full burn the sink ' + heatWord(b.heat[1]) + '. The wings run ' + arrow(Math.round(a.radiatorSpan) + ' m', Math.round(b.radiatorSpan) + ' m') + ' each side and take ' + d1.radiatorDeployTime + ' s to stow. No armour covers them.';
      case 'sink': {
        const rows = [[a.heat[1], b.heat[1], 'At full burn'], [a.heat[2], b.heat[2], 'With every fitting firing as well,']].filter((r) => r[0].net > 0 || r[1].net > 0);
        const massClause = dMass > 0 ? fmtT(dMass) + ' more mass' : fmtT(-dMass) + ' saved';
        if (!rows.length) return 'The radiators keep up at full burn and with every fitting firing, so the sink never fills. This change is ' + massClause + ' and nothing else.';
        // one sentence per case: "At full burn it lasts 3m 12s → 8m 46s. With every fitting firing as well, it is full from the start."
        const span = (r) => {
          const label = r[2];
          if (r[1].saturate < 1) return label + ' it is full from the start.';
          const x = satWord(r[0]), y = satWord(r[1]);
          return label + (x === y ? ' it still lasts ' + y : ' it lasts ' + x + ' \u2192 ' + y) + '.';
        };
        return (more(d0.sinkCapacity, d1.sinkCapacity) ? 'A bigger heat sink holds out longer before the drive is capped. ' : 'A smaller heat sink fills sooner. ') + rows.map(span).join(' ') + ' That is ' + massClause + '.';
      }
      case 'reactor':
        return (more(d0.reactorPower, d1.reactorPower) ? 'A bigger reactor. ' : 'A smaller reactor. ') + U.fmt.power(d1.reactorPower) + ' against the ' + U.fmt.power(b.power.draw) + ' the fittings ask for, ' + Math.round(b.power.ratio * 100) + ' % of it. Idle heat ' + arrow(U.fmt.power(d0.idleHeat), U.fmt.power(d1.idleHeat)) + '. That is ' + (dMass > 0 ? fmtT(dMass) + ' more mass.' : fmtT(-dMass) + ' saved.');
      case 'nose': case 'flank': case 'tail': {
        const f = control;
        return facingName(f) + ' armour ' + arrow(d0.armour[f] + ' cm', d1.armour[f] + ' cm') + (dMass > 0 ? ' adds ' + fmtT(dMass) : ' saves ' + fmtT(-dMass)) + '. ' + facingWhy(f) + ' Delta-v ' + arrow(U.fmt.dv(a.dv), U.fmt.dv(b.dv)) + ', acceleration ' + arrow(fmtG(a.accel), fmtG(b.accel)) + '.';
      }
      case 'base':
        return 'Hull: ' + CLASSES()[d1.base].name + '. ' + CLASSES()[d1.base].blurb + ' The stock fit is loaded. Change anything.';
      case 'look':
        return 'A change of look. The drawing changes and no number moves. Still ' + U.fmt.dv(b.dv) + ' at ' + fmtG(b.accel) + ', ' + fmtT(b.mass) + ' loaded.';
      case 'preset':
        return 'Back to the stock ' + CLASSES()[d1.base].name + '. ' + U.fmt.dv(b.dv) + ' at ' + fmtG(b.accel) + ', ' + fmtT(b.mass) + ' loaded.';
      default: {
        if (control && control.indexOf('slot:') === 0) {
          const added = d1.comps.filter((c) => !d0.comps.some((o) => o.key === c.key && o.catId === c.catId));
          const removed = d0.comps.filter((c) => !d1.comps.some((o) => o.key === c.key && o.catId === c.catId));
          const parts = [];
          for (const c of added) parts.push(c.label + ' fitted: ' + fmtT(c.mass) + (c.draw ? ', draws ' + U.fmt.power(c.draw) : '') + (c.heat ? ', ' + U.fmt.power(c.heat) + ' of heat when firing' : '') + '.');
          for (const c of removed) parts.push(c.label + ' removed: ' + fmtT(c.mass) + ' lighter.');
          parts.push('The fittings now draw ' + Math.round(b.power.ratio * 100) + ' % of the reactor' + (b.power.ratio > 1 ? ', more than it can give' : '') + '. Delta-v ' + arrow(U.fmt.dv(a.dv), U.fmt.dv(b.dv)) + '.');
          return parts.join(' ');
        }
        return 'Delta-v ' + U.fmt.dv(b.dv) + ', ' + fmtG(b.accel) + ' full-tank, ' + fmtT(b.mass) + ' loaded.';
      }
    }
  }
  function heatWord(h) { return h.net <= 0 ? 'never fills' : 'fills in ' + U.fmt.time(h.saturate); }
  function satWord(h) { return h.net <= 0 ? 'indefinitely' : U.fmt.time(h.saturate); }
  function facingName(f) { return f === 'nose' ? 'Nose' : f === 'flank' ? 'Flank' : 'Tail'; }
  function facingWhy(f) {
    if (f === 'nose') return 'The enemy sees the nose while you close on her or hold range nose-on.';
    if (f === 'flank') return 'The flank is the largest face, and a turn shows it. Most of the armour mass goes here.';
    return 'The tail carries the drive. It faces the enemy while you brake toward her or run from her.';
  }

  // ------------------------------------------------------------------ persistence
  // The store is per-viewer browser storage; anything odd in it is dropped record by record, never fatal.
  function store() {
    const empty = { v: 1, designs: {}, order: [] };
    try {
      const s = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (!s || typeof s !== 'object' || !s.designs || typeof s.designs !== 'object' || Array.isArray(s.designs)) return empty;
      const designs = {};
      for (const k of Object.keys(s.designs)) { const r = s.designs[k]; if (r && typeof r === 'object' && r.params && typeof r.params === 'object' && /^[\w-]{1,40}$/.test(k)) designs[k] = { id: k, params: r.params, savedAt: +r.savedAt || 0 }; }
      const order = (Array.isArray(s.order) ? s.order : []).filter((k, i, a) => typeof k === 'string' && designs[k] && a.indexOf(k) === i);
      for (const k of Object.keys(designs)) if (!order.includes(k)) order.push(k);
      return { v: 1, designs, order };
    } catch (e) { return empty; }
  }
  function writeStore(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); return true; } catch (e) { return false; } }
  // records(): cheap, no derive; list(): full design objects, skipping any record the current catalogue cannot derive
  function records() { const s = store(); return s.order.map((id) => { const r = s.designs[id]; const q = r.params; return { id, name: typeof q.name === 'string' && q.name.trim() ? q.name.trim().slice(0, 24) : 'Design', base: own(BASES, q.base) ? q.base : 'frigate', savedAt: r.savedAt, params: q }; }); }
  function list() { const s = store(), out = []; for (const id of s.order) { const r = s.designs[id]; try { out.push(Object.assign(derive(r.params, id), { savedAt: r.savedAt })); } catch (e) { /* skip a record this build cannot read */ } } return out; }
  function get(id) { const s = store(); const r = own(s.designs, id) ? s.designs[id] : null; if (!r) return null; try { return Object.assign(derive(r.params, id), { savedAt: r.savedAt }); } catch (e) { return null; } }
  // returns the design when it is on disk, null when the browser refused the write (full or blocked storage)
  function save(design) {
    const s = store();
    const now = Date.now();
    s.designs[design.id] = { id: design.id, params: normaliseParams(design.params), savedAt: now };
    if (!s.order.includes(design.id)) s.order.push(design.id);
    if (!writeStore(s)) return null;
    design.savedAt = now;
    register(design);
    return design;
  }
  function remove(id) { const s = store(); delete s.designs[id]; s.order = s.order.filter((x) => x !== id); writeStore(s); unregister(id); }

  // ------------------------------------------------------------------ registration into the game's tables
  function register(design) {
    if (!design || !design.id) return design;
    OD.Ships.CLASSES[design.id] = design;
    if (!OD.Ships.SHAPES[design.id]) OD.Ships.SHAPES[design.id] = OD.Ships.SHAPES[design.base] || OD.Ships.SHAPES.frigate;
    if (OD.ShipArt && typeof OD.ShipArt.designFor === 'function' && typeof OD.ShipArt.register === 'function') {
      try { const art = OD.ShipArt.designFor(design); if (art) OD.ShipArt.register(design.id, art); } catch (e) { /* the art module decides */ }
    }
    return design;
  }
  function unregister(id) {
    if (!id || !OD.Ships) return;
    if (OD.Ships.CLASSES[id] && OD.Ships.CLASSES[id].custom) { delete OD.Ships.CLASSES[id]; delete OD.Ships.SHAPES[id]; }
  }
  function installSaved() { const out = []; for (const d of list()) out.push(register(d)); return out; }

  // ------------------------------------------------------------------ into a scenario
  function shipName(design, faction) {
    const fac = OD.Ships.FACTIONS[faction] || OD.Ships.FACTIONS.JC;
    return fac.prefix + ' ' + design.params.name;
  }
  function toSpec(design, extra) {
    register(design);
    return Object.assign({ cls: design.id, name: shipName(design, (extra && extra.faction) || 'JC'), faction: 'JC', player: true, propFraction: 1 }, extra || {});
  }
  function matchedEnemy(c) {
    if (c < 50) return { corvette: 1 };
    if (c < 85) return { frigate: 1 };
    if (c < 130) return { frigate: 1, corvette: 1 };
    if (c < 200) return { destroyer: 1 };
    if (c < 320) return { destroyer: 1, frigate: 1 };
    return { cruiser: 1, corvette: 1 };
  }
  function flyScenario(design, o) {
    o = o || {};
    register(design);
    const faction = o.faction || 'JC', enemyFaction = faction === 'JC' ? 'ISA' : 'JC';
    const c = cost(design);
    const enemy = o.enemyShips || matchedEnemy(c);
    if (OD.Skirmish && typeof OD.Skirmish.build === 'function') {
      const sc = OD.Skirmish.build({ player: faction, env: o.env || 'deep', range: o.range || 1200, playerShips: { frigate: 1 }, enemyShips: enemy, seed: o.seed || ((Date.now() / 1000) & 0xffff) });
      const mine = sc.ships.find((s) => s.player);
      sc.ships = sc.ships.filter((s) => !s.player || s === mine);
      Object.assign(mine, { cls: design.id, name: shipName(design, faction), id: 'yard_' + design.id });
      sc.name = 'Trial · ' + design.name;
      sc.intro = [{ speaker: 'Yard', text: design.name + ' on trial. ' + U.fmt.dv(design.summary.dv) + ' in the tanks, ' + design.summary.g.toFixed(2) + ' g. ' + (Object.keys(enemy).map((k) => enemy[k] + ' ' + k).join(', ')) + ' inbound at ' + U.fmt.dist((o.range || 1200) * 1e3) + '.', kind: 'info' }];
      return sc;
    }
    // without the skirmish module: a bare deep-space scenario
    const ships = [Object.assign(toSpec(design, { faction }), { pos: { x: -600e3, y: 0 }, vel: { x: 0, y: 0 }, heading: 0, id: 'yard_' + design.id })];
    let k = 0;
    for (const cls in enemy) for (let i = 0; i < enemy[cls]; i++) ships.push({ id: 'foe' + k++, cls, faction: enemyFaction, ai: true, pos: { x: 600e3, y: k * 60e3 }, vel: { x: 0, y: 0 }, heading: Math.PI });
    return { name: 'Trial · ' + design.name, body: null, sunAngle: 0.8, playerFaction: faction, ships, objectives: [{ id: 'n', text: 'Neutralise all hostile ships', type: 'neutralize', targets: 'hostiles' }], triggers: [] };
  }

  // ------------------------------------------------------------------ test flight in the real sim
  // A full burn for `seconds` in deep space; what the sim did against what the yard predicted.
  function testFlight(design, seconds) {
    if (!OD.Sim) return null;
    seconds = seconds || 600;
    register(design);
    const spec = toSpec(design, { id: 'tf', pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, heading: 0, order: { type: 'manual', heading: 0, throttle: 1 } });
    const sim = new OD.Sim({ name: 'Test flight', body: null, playerFaction: 'JC', ships: [spec], objectives: [] });
    const ship = sim.byId('tf');
    const mdot = design.thrust / design.exhaustVelocity;
    const m0 = design.dryMass + design.propMass;
    // Piecewise prediction with the sim's own rule: full thrust until the sink reads 99.9 %, a quarter until it is
    // back under 90 %, and so on; heat in is idle + drive (or a quarter of the drive while capped).
    const heatOut = P.radiatorPower(design.radiatorArea, design.radiatorTemp);
    const fullIn = design.idleHeat + design.driveHeat, quarterIn = design.idleHeat + 0.25 * design.driveHeat, cap = design.sinkCapacity;
    let load = 0.1, tt = 0, thrustSec = 0, over = false, phases = 0, capped = false;
    while (tt < seconds - 1e-9 && phases++ < 20000) {
      const net = (over ? quarterIn : fullIn) - heatOut, f = over ? 0.25 : 1;
      const toEdge = over ? (net < 0 ? ((load - 0.9) * cap) / -net : Infinity) : (net > 0 ? ((0.999 - load) * cap) / net : Infinity);
      const dt = Math.min(toEdge, seconds - tt);
      thrustSec += f * dt; load = clamp(load + (net * dt) / cap, 0, 1); tt += dt;
      if (dt === toEdge) { over = !over; capped = true; }
    }
    const used = Math.min(design.propMass, mdot * thrustSec);
    const regime = !capped ? 'cool' : quarterIn > heatOut ? 'capped' : 'cycling';
    const predicted = {
      propUsed: used, dv: design.exhaustVelocity * Math.log(m0 / (m0 - used)),
      heatLoad: load, regime,
      dvFull: P.tsiolkovsky(design.exhaustVelocity, m0, design.dryMass),
    };
    let steps = 0;
    while (sim.time < seconds && steps++ < 100000) sim.step(Math.min(10, seconds - sim.time));
    const actual = { propUsed: design.propMass - ship.propMass, dv: ship.stats.dvSpent, speed: U.len(ship.vel), heatLoad: ship.thermalLoad(), overheated: ship.overheated, dvLeft: ship.deltaV(), time: sim.time, finite: isFinite(ship.pos.x) && isFinite(ship.vel.x) };
    // the sim steps discretely, so a design that cycles on and off the cap is allowed a little more slack
    const tol = regime === 'cycling' ? 0.05 : 0.02;
    const off = Math.max(Math.abs(actual.propUsed - predicted.propUsed) / Math.max(1, predicted.propUsed), Math.abs(actual.dv - predicted.dv) / Math.max(1, predicted.dv));
    const ok = actual.finite && off < tol;
    return { predicted, actual, ok, off, tol, regime, seconds: sim.time };
  }

  // ==================================================================== the screen
  const CSS = `
.odc, .odc * { box-sizing: border-box; }
.odc { --odc-tick: var(--tick, linear-gradient(#4fd1c5, #4fd1c5)); --odc-tickd: var(--tickd, linear-gradient(rgba(120,150,180,0.42), rgba(120,150,180,0.42)));
  position: relative; width: 100%; display: flex; flex-direction: column; gap: 12px; color: var(--ink, #e0e8f0); font-family: var(--sans, 'IBM Plex Sans', 'Segoe UI', system-ui, sans-serif); font-size: 13.5px; line-height: 1.4; -webkit-font-smoothing: antialiased; }
.odc button { background: transparent; border: 0; border-radius: 0; padding: 6px 12px; cursor: pointer; font-family: var(--display, 'Rajdhani', 'Bahnschrift', 'Segoe UI', sans-serif); font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; font-size: 12px; color: var(--ink-2, #b1bfce); line-height: 1.2;
  background-image: var(--odc-tickd), var(--odc-tickd), var(--odc-tickd), var(--odc-tickd), var(--odc-tickd), var(--odc-tickd), var(--odc-tickd), var(--odc-tickd);
  background-size: 7px 1px, 1px 7px, 7px 1px, 1px 7px, 7px 1px, 1px 7px, 7px 1px, 1px 7px;
  background-position: left top, left top, right top, right top, left bottom, left bottom, right bottom, right bottom; background-repeat: no-repeat; transition: color 0.12s, background-color 0.12s; }
.odc button:hover { color: var(--ink, #e0e8f0); background-image: var(--odc-tick), var(--odc-tick), var(--odc-tick), var(--odc-tick), var(--odc-tick), var(--odc-tick), var(--odc-tick), var(--odc-tick); background-color: rgba(79,209,197,0.07); }
.odc button:focus-visible, .odc input:focus-visible, .odc select:focus-visible { outline: 1px solid var(--accent, #4fd1c5); outline-offset: 2px; }
.odc button.primary { color: var(--accent, #4fd1c5); background-image: var(--odc-tick), var(--odc-tick), var(--odc-tick), var(--odc-tick), var(--odc-tick), var(--odc-tick), var(--odc-tick), var(--odc-tick); }
.odc button.primary:hover { background-color: var(--accent, #4fd1c5); color: var(--accent-ink, #04141a); }
.odc button.active { background-color: var(--accent, #4fd1c5); color: var(--accent-ink, #04141a); background-image: none; }
.odc button.danger { color: #ffb0b0; } .odc button.danger:hover { background-color: rgba(255,107,107,0.14); }
.odc button.danger.armed { color: #ffd0d0; background-color: rgba(255,107,107,0.16); background-image: none; outline: 1px solid rgba(255,107,107,0.55); outline-offset: -1px; }
.odc button.ghost { background-image: none; color: var(--dim, #7f91a7); } .odc button.ghost:hover { color: var(--ink, #e0e8f0); background-color: transparent; }
.odc button:disabled { opacity: 0.35; cursor: default; }
.odc button.sm { padding: 4px 9px; font-size: 11px; }
.odc .odc-seg { display: inline-flex; gap: 1px; }
.odc .odc-seg button { background-image: none; border-bottom: 2px solid var(--line, rgba(120,150,180,0.22)); padding: 5px 9px; color: var(--dim, #7f91a7); }
.odc .odc-seg button:hover { color: var(--ink, #e0e8f0); background-color: transparent; border-bottom-color: var(--line-2, rgba(120,150,180,0.42)); }
.odc .odc-seg button.active { background-color: transparent; color: var(--accent, #4fd1c5); border-bottom-color: var(--accent, #4fd1c5); }
.odc input[type=range] { width: 100%; margin: 0; height: 20px; accent-color: var(--accent, #4fd1c5); background: transparent; }
.odc select, .odc input[type=text] { background: rgba(4,7,12,0.7); border: 0; border-bottom: 1px solid var(--line-2, rgba(120,150,180,0.42)); border-radius: 0; color: var(--ink, #e0e8f0); font-family: var(--mono, 'IBM Plex Mono', ui-monospace, Menlo, monospace); font-size: 11.5px; padding: 3px 2px; width: 100%; }
/* a drawn chevron in place of the native arrow: it takes 14 px, so the longest fitting reads in full in a 312 px menu */
.odc select { -webkit-appearance: none; appearance: none; padding-right: 16px; cursor: pointer;
  background-image: linear-gradient(45deg, transparent 50%, var(--ink-2, #b1bfce) 50%), linear-gradient(135deg, var(--ink-2, #b1bfce) 50%, transparent 50%);
  background-position: calc(100% - 8px) 55%, calc(100% - 4px) 55%; background-size: 4px 4px, 4px 4px; background-repeat: no-repeat; }
.odc select option { background: #0a0f16; }
.odc .mono { font-family: var(--mono, 'IBM Plex Mono', ui-monospace, Menlo, monospace); font-variant-numeric: tabular-nums; }
.odc [data-tip] { cursor: help; }
/* head */
.odc-head { display: grid; grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: "title right" "hulls hulls"; align-items: end; gap: 10px 22px; padding-bottom: 10px; border-bottom: 1px solid var(--line-2, rgba(120,150,180,0.42)); }
.odc-title { grid-area: title; min-width: 0; } .odc-headr { grid-area: right; } .odc-hulls { grid-area: hulls; }
.odc-eyebrow { font-family: var(--display, 'Rajdhani', sans-serif); color: var(--accent, #4fd1c5); letter-spacing: 0.24em; text-transform: uppercase; font-size: 11px; font-weight: 600; display: flex; align-items: center; gap: 10px; }
.odc-eyebrow::before { content: ''; width: 18px; height: 2px; background: var(--accent, #4fd1c5); flex: none; }
.odc-name { display: flex; align-items: baseline; flex-wrap: wrap; gap: 6px 0; font-family: var(--display, 'Rajdhani', sans-serif); font-weight: 700; font-size: 30px; line-height: 1; letter-spacing: 0.02em; margin-top: 6px; }
.odc-nameinput { font: inherit; color: inherit; background: transparent; border: 0; border-bottom: 1px dashed var(--line-2, rgba(120,150,180,0.42)); padding: 0 2px; width: 7.5em; min-width: 2.5em; max-width: 100%; letter-spacing: inherit; }
.odc-nameinput:focus { border-bottom-style: solid; outline: 0; }
.odc-cls { color: var(--dim, #7f91a7); font-size: 19px; font-weight: 600; white-space: nowrap; }
.odc-name .odc-pill { margin-left: 12px; }
.odc-pill { display: inline-block; font-family: var(--mono, monospace); font-size: 10.5px; letter-spacing: 0.08em; text-transform: uppercase; padding: 0 6px; border-left: 2px solid var(--line-2, rgba(120,150,180,0.42)); color: var(--ink-2, #b1bfce); vertical-align: middle; }
.odc-pill.warn { border-left-color: var(--warn, #ffb454); color: var(--warn, #ffb454); }
.odc-hulls { display: flex; flex-wrap: wrap; gap: 2px; align-items: flex-end; }
.odc-hulls button { display: flex; flex-direction: column; align-items: flex-start; gap: 1px; padding: 5px 10px; text-align: left; }
.odc-hulls button small { font-family: var(--mono, monospace); text-transform: none; letter-spacing: 0; font-weight: 400; font-size: 10.5px; color: var(--dim, #7f91a7); }
.odc-hulls button.active small { color: var(--accent-ink, #04141a); opacity: 0.8; }
.odc-headr { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; }
.odc-headr select { width: auto; max-width: 220px; }
/* body */
.odc-main { display: grid; grid-template-columns: 330px minmax(0, 1fr) 324px; grid-template-rows: auto 1fr; grid-template-areas: "controls stage readout" "controls more readout"; gap: 0 20px; align-items: start; }
.odc-controls { grid-area: controls; min-width: 0; } .odc-stage { grid-area: stage; } .odc-readout { grid-area: readout; min-width: 0; } .odc-more { grid-area: more; min-width: 0; margin-top: 12px; }
.odc-more .odc-sec:first-child { border-top: 1px solid var(--line, rgba(120,150,180,0.22)); padding-top: 8px; }
.odc-more:empty { display: none; }
.odc-sec { padding: 8px 0 10px; border-top: 1px solid var(--line, rgba(120,150,180,0.22)); }
.odc-sec:first-child { border-top: 0; padding-top: 0; }
.odc-sec h4 { font-family: var(--display, 'Rajdhani', sans-serif); font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--dim, #7f91a7); margin: 0 0 6px; display: flex; align-items: center; gap: 8px; font-weight: 600; }
.odc-sec h4::after { content: ''; flex: 1; height: 1px; background: var(--line, rgba(120,150,180,0.22)); }
.odc-row { display: grid; grid-template-columns: 84px minmax(0, 1fr) 72px; gap: 8px; align-items: center; padding: 2px 0; font-size: 12.5px; }
.odc-row .k { color: var(--dim, #7f91a7); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.odc-row .v { font-family: var(--mono, monospace); text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; font-size: 12px; }
.odc-row.slot { grid-template-columns: 96px minmax(0, 1fr); padding: 1px 0; }
.odc-row.slot.stack { display: block; padding: 3px 0 2px; }
.odc-row.slot.stack .k { display: block; font-size: 12px; line-height: 1.3; }
.odc-note { color: var(--dim, #7f91a7); font-size: 11.5px; margin: 2px 0 4px; }
.odc-btnrow { display: flex; flex-wrap: wrap; gap: 5px; }
/* stage */
.odc-stage { display: flex; flex-direction: column; min-width: 0; }
.odc-stagehead { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 6px 10px; margin-bottom: 6px; }
.odc-canvaswrap { position: relative; }
.odc-canvas { display: block; width: 100%; height: auto; aspect-ratio: 4 / 3; border-top: 1px solid var(--line-2, rgba(120,150,180,0.42)); border-bottom: 1px solid var(--line-2, rgba(120,150,180,0.42)); background: radial-gradient(ellipse at 50% 50%, rgba(20,30,45,0.5), rgba(4,7,12,0) 70%); }
.odc-key { font-family: var(--mono, monospace); font-size: 10.5px; color: var(--accent, #4fd1c5); letter-spacing: 0.04em; line-height: 1.5; padding: 5px 2px 0; }
.odc.odc-mid .odc-row.slot { grid-template-columns: 90px minmax(0, 1fr); } .odc.odc-mid .odc-row.slot .k { font-size: 12px; } .odc.odc-mid .odc-row.slot select { font-size: 10.5px; padding-left: 1px; padding-right: 14px; }
.odc-caption { position: absolute; left: 10px; bottom: 8px; font-family: var(--mono, monospace); font-size: 10.5px; color: var(--dim, #7f91a7); letter-spacing: 0.04em; pointer-events: none; }
.odc-state { display: flex; flex-wrap: wrap; gap: 6px 16px; align-items: center; margin-top: 8px; font-size: 12px; color: var(--dim, #7f91a7); }
.odc-state label { display: flex; align-items: center; gap: 6px; white-space: nowrap; }
.odc-state input[type=range] { width: 90px; }
.odc-say { border-left: 3px solid var(--accent, #4fd1c5); background: linear-gradient(90deg, rgba(79,209,197,0.09), rgba(79,209,197,0)); padding: 8px 12px 9px; margin-top: 10px; min-height: 64px; }
.odc-say[data-tone="warn"] { border-left-color: var(--warn, #ffb454); background: linear-gradient(90deg, rgba(255,180,84,0.12), rgba(255,180,84,0)); }
.odc-say[data-tone="crit"] { border-left-color: var(--crit, #ff6b6b); background: linear-gradient(90deg, rgba(255,107,107,0.12), rgba(255,107,107,0)); }
.odc-say-head { font-family: var(--display, 'Rajdhani', sans-serif); font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--dim, #7f91a7); font-weight: 600; }
.odc-say-line { margin: 3px 0 0; font-size: 14px; line-height: 1.4; }
/* readout */
.odc-vitals { display: grid; grid-template-columns: repeat(4, auto); justify-content: space-between; gap: 8px 6px; padding: 0 0 9px; border-bottom: 1px solid var(--line, rgba(120,150,180,0.22)); }
.odc-vitals .k { display: block; font-family: var(--display, 'Rajdhani', sans-serif); font-weight: 600; font-size: 10px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--dim, #7f91a7); }
.odc-vitals .v { display: block; font-family: var(--display, 'Rajdhani', sans-serif); font-weight: 600; font-size: 20px; line-height: 1.1; font-variant-numeric: tabular-nums; white-space: nowrap; letter-spacing: 0.02em; }
.odc-vitals .v small { font-size: 11px; font-weight: 500; color: var(--dim, #7f91a7); margin-left: 3px; letter-spacing: 0.04em; }
.odc-vitals .s { display: block; font-family: var(--mono, monospace); font-size: 10px; color: var(--dim, #7f91a7); white-space: nowrap; }
.odc-bar { height: 10px; background: rgba(255,255,255,0.07); display: flex; overflow: hidden; margin: 5px 0 6px; position: relative; background-image: repeating-linear-gradient(90deg, transparent 0 calc(10% - 1px), rgba(255,255,255,0.14) calc(10% - 1px) 10%); }
.odc-bar i { display: block; height: 100%; flex: none; transition: width 0.25s; }
.odc-bar b { position: absolute; top: 0; bottom: 0; width: 1px; background: rgba(255,255,255,0.8); }
.odc-legend { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 12px; font-size: 11.5px; color: var(--ink-2, #b1bfce); }
.odc-legend span { display: flex; justify-content: space-between; gap: 6px; white-space: nowrap; }
.odc-legend .sw { display: inline-block; width: 9px; height: 9px; margin: 0 6px 0 0; vertical-align: -1px; flex: none; border: 0; border-radius: 0; }
.odc-legend em { font-style: normal; font-family: var(--mono, monospace); font-variant-numeric: tabular-nums; }
.odc-kv { display: grid; grid-template-columns: auto 1fr; gap: 3px 10px; font-size: 12.5px; }
.odc-kv .k { color: var(--dim, #7f91a7); white-space: nowrap; } .odc-kv .v { font-family: var(--mono, monospace); text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
.odc-kv .v.good, .odc .good { color: var(--good, #7ad97a); } .odc-kv .v.warn, .odc .warn { color: var(--warn, #ffb454); } .odc-kv .v.crit, .odc .crit { color: var(--crit, #ff6b6b); }
.odc-heat { font-size: 12.5px; }
.odc-heat .hr { display: flex; flex-wrap: wrap; column-gap: 8px; align-items: baseline; padding: 2px 0; }
.odc-heat .k { color: var(--dim, #7f91a7); white-space: nowrap; flex: 1 0 auto; } .odc-heat .m { flex: 1 0 100%; font-family: var(--mono, monospace); font-size: 10px; color: var(--ink-2, #b1bfce); } .odc-heat .m span { white-space: nowrap; } .odc-heat .v { font-family: var(--mono, monospace); font-size: 12px; text-align: right; white-space: nowrap; margin-left: auto; }
.odc-reach { font-size: 12px; } .odc-reach div { padding: 2px 0; border-top: 1px dashed var(--line, rgba(120,150,180,0.22)); } .odc-reach b { font-weight: 500; color: var(--ink, #e0e8f0); display: block; } .odc-reach span { color: var(--ink-2, #b1bfce); }
.odc-facing { display: grid; grid-template-columns: 96px 1fr; gap: 10px; align-items: center; }
.odc-facing svg { width: 96px; height: 48px; display: block; }
.odc-facing polygon { stroke: rgba(180,192,207,0.6); stroke-width: 1; }
.odc-cmp { width: 100%; border-collapse: collapse; font-size: 12px; }
.odc-cmp th { text-align: right; font-weight: 500; color: var(--dim, #7f91a7); font-family: var(--display, sans-serif); letter-spacing: 0.12em; text-transform: uppercase; font-size: 10px; padding: 2px 0; }
.odc-cmp th:first-child, .odc-cmp td:first-child { text-align: left; color: var(--dim, #7f91a7); }
.odc-cmp td { text-align: right; font-family: var(--mono, monospace); padding: 2px 0; border-top: 1px dashed var(--line, rgba(120,150,180,0.22)); white-space: nowrap; }
/* foot */
.odc-foot { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 10px 16px; padding-top: 10px; border-top: 1px solid var(--line-2, rgba(120,150,180,0.42)); }
.odc-issues { font-size: 12.5px; color: var(--ink-2, #b1bfce); display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1 1 320px; }
.odc-issue.block { color: var(--crit, #ff6b6b); } .odc-issue.warn { color: var(--warn, #ffb454); } .odc-issue.note { color: var(--dim, #7f91a7); }
.odc-issue::before { content: '▸ '; }
.odc-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.odc-actions button.primary { padding: 8px 16px; font-size: 13px; }
.odc-toast { position: absolute; left: 50%; top: 56px; transform: translateX(-50%); background: var(--glass-2, rgba(5,9,15,0.9)); border-bottom: 1px solid var(--line, rgba(120,150,180,0.22)); border-left: 3px solid var(--accent, #4fd1c5); padding: 8px 16px; font-family: var(--display, sans-serif); font-size: 14px; letter-spacing: 0.06em; z-index: 5; pointer-events: none; }
.odc-tooltip { position: fixed; z-index: 40; max-width: 320px; background: var(--glass-2, rgba(5,9,15,0.94)); border: 1px solid var(--line-2, rgba(120,150,180,0.42)); border-left: 2px solid var(--accent, #4fd1c5); padding: 8px 10px; pointer-events: none; font-size: 12.5px; color: var(--ink, #e0e8f0); }
.odc-tooltip .t { font-family: var(--display, sans-serif); font-weight: 700; font-size: 12px; letter-spacing: 0.14em; text-transform: uppercase; margin-bottom: 3px; color: var(--accent, #4fd1c5); }
.odc-tooltip .b { color: var(--ink-2, #b1bfce); }
.odc-tooltip .f { font-family: var(--mono, monospace); font-size: 11.5px; margin-top: 5px; padding-top: 5px; border-top: 1px dashed var(--line, rgba(120,150,180,0.22)); white-space: pre-wrap; }
.odc[data-detail="essentials"] [data-adv] { display: none !important; }
/* widths: the root measures itself (odc-mid under 1140 px, odc-narrow under 720 px); the media query only covers the first paint */
.odc.odc-mid .odc-main { grid-template-columns: 312px minmax(0, 1fr) 300px; gap: 0 14px; }
.odc.odc-mid .odc-row { grid-template-columns: 82px minmax(0, 1fr) 68px; }
.odc.odc-narrow .odc-head { grid-template-columns: 1fr; grid-template-areas: "title" "right" "hulls"; }
.odc.odc-narrow .odc-main { grid-template-columns: minmax(0, 1fr); grid-template-rows: none; grid-template-areas: none; gap: 12px; }
.odc.odc-narrow .odc-main > * { grid-area: auto; }
.odc.odc-narrow .odc-more { order: 1; margin-top: 0; }
.odc.odc-narrow .odc-canvas { aspect-ratio: 16 / 10; }
.odc.odc-narrow .odc-row { grid-template-columns: 84px minmax(0, 1fr) 72px; }
.odc.odc-narrow .odc-row.slot { grid-template-columns: 96px minmax(0, 1fr); }
.odc.odc-narrow .odc-stage { order: -1; }
.odc.odc-narrow .odc-hulls { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
.odc.odc-narrow .odc-name { font-size: 24px; }
.odc.odc-narrow .odc-vitals .v { font-size: 18px; }
@media (max-width: 720px) {
  .odc:not(.odc-mid) .odc-head { grid-template-columns: 1fr; grid-template-areas: "title" "right" "hulls"; }
  .odc:not(.odc-mid) .odc-main { grid-template-columns: minmax(0, 1fr); grid-template-rows: none; grid-template-areas: none; gap: 12px; }
  .odc:not(.odc-mid) .odc-main > * { grid-area: auto; }
  .odc:not(.odc-mid) .odc-stage { order: -1; }
  .odc:not(.odc-mid) .odc-more { order: 1; margin-top: 0; }
  .odc:not(.odc-mid) .odc-canvas { aspect-ratio: 16 / 10; }
}
@media (prefers-reduced-motion: reduce) { .odc-bar i { transition: none; } }
`;

  const TIPS = {
    odc_thrust: { title: 'Drive thrust', body: 'How hard the drive pushes, in newtons. Acceleration is thrust over mass, so a bigger drive shortens every transfer. It also adds mass, and it puts more heat into the sink for every second it burns.', formula: 'a = F / m' },
    odc_ve: { title: 'Exhaust velocity', body: 'How fast the drive throws propellant out the back. Double it and the same tanks buy twice the delta-v. The drive mass goes up with its square.', formula: 'Δv = vₑ · ln(m₀ / m₁)' },
    odc_prop: { title: 'Propellant', body: 'Reaction mass in the tanks. Delta-v grows with the logarithm of the mass ratio, so doubling the propellant adds far less than double. The acceleration falls straight away, because the ship has to push the extra mass.', formula: 'Δv = vₑ · ln((m_dry + m_prop) / m_dry)' },
    odc_radiator: { title: 'Radiator area', body: 'Heat leaves the ship only by radiating it. A square metre sheds about 100 kW from both faces at 1000 K, the warship standard. The freighter hull runs its panels at 900 K and sheds two-thirds of that. No armour covers a radiator, so more area means steadier heat and more to shoot at.', formula: 'P = 2 · A · ε · σ · T⁴' },
    odc_sink: { title: 'Heat sink', body: 'A store of heat the ship can fill faster than the radiators empty it. A full sink holds the drive to a quarter and stops every mount, point defence included, until it drains. A bigger sink is more mass.', formula: 'time to full = (0.9 · capacity) / (heat in − heat out)' },
    odc_reactor: { title: 'Reactor', body: 'Electrical power for lasers, coilguns and point defence. Fittings that fire together draw together, so the reactor has to cover the sum. Idle heat goes up with reactor size.' },
    odc_armour: { title: 'Facing armour', body: 'Armour is rated in centimetres of plate on each face. A beam burns through it and a slug punches through it. The mass is thickness times the area of the face, and the flank is the largest face by far.' },
    odc_fittings: { title: 'Fittings', body: 'Hardpoints on the hull. A spinal mount aims with the whole ship and takes the biggest optics. A turret swings. Rails carry coilguns, bays carry interceptors, and point defence shoots at incoming craft.' },
    odc_dv: { title: 'Delta-v', body: 'The total change in velocity a full load of propellant buys. Every burn spends it, and only a port or a depot puts it back. The Moving rows show what one 10 000 km dash costs.', formula: 'Δv = vₑ · ln(m₀ / m₁)' },
    odc_accel: { title: 'Acceleration', body: 'Thrust over mass with full tanks, and again with empty ones. Transfer time goes with one over the square root of it, so four times the acceleration halves the trip.', formula: 't = 2 · √(d / a)' },
    odc_mass: { title: 'Loaded mass', body: 'Dry mass plus propellant. The dry mass is what the drive still has to push once the tanks are empty. The stacked bar shows where it goes.' },
    odc_cost: { title: 'Requisition', body: 'What a yard charges for the hull, on the campaign scale where a stock frigate is 70. It follows the dry mass to the power 0.7, so a big hull costs less per tonne.' },
    odc_massbar: { title: 'Mass budget', body: 'Where the dry mass goes. Structure is the hull, crew and systems every ship of the family carries. The rest is what you chose, and propellant is shown for scale.' },
    odc_power: { title: 'Power budget', body: 'What every fitting draws when firing together, against the reactor. Past 100 % the design is not flight-ready.' },
    odc_heat: { title: 'Heat balance', body: 'Heat in against heat out in three states: coasting on idle heat, full burn, and full burn while every fitting fires. It uses the same balance the ship flies with. "Sink full" is how long until the drive is capped.' },
    odc_dash: { title: 'Reference dash', body: 'A 10 000 km burn-flip-burn at full-tank acceleration: the time, the delta-v and how many the tanks hold. A real transfer costs more, because the target is moving.', formula: 't = 2·√(d / a),  Δv = 2·√(d · a)' },
    odc_turn: { title: 'Turn time', body: 'Seconds to swing the nose through 180°: accelerate, cruise at the turn-rate limit, then brake. A heavy hull turns slowly, and every flip in a transfer costs this much coasting.' },
    odc_reach: { title: 'Reach', body: 'For a laser, the range where diffraction spreads the spot past half a metre. For a coilgun, the slug flight time and how far out a jinking target can still be hit. For a bay, what one interceptor can do on its own delta-v.', formula: 'spot = 2.44 · λ · R / D' },
    odc_facing: { title: 'Facing', body: 'Which face the enemy sees depends on what the ship is doing: the nose while closing or holding range, the flank while turning, the tail while braking toward her. Thicken the face you plan to show.' },
    odc_compare: { title: 'Against the stock hull', body: 'The same numbers for the hull family\'s stock fit. Read across to see what your choices bought and what they cost.' },
    odc_view: { title: 'Views', body: 'Blueprint is the yard\'s own drawing, every part to scale and labelled. The rendered views show the hull as it looks on the map and in the hull view.' },
    odc_state: { title: 'Show it', body: 'Pose the picture. Radiators out or stowed, the drive lit, the sink at any load to see the panels glow, and the camera in slow orbit.' },
    odc_look: { title: 'Look', body: 'How the yard draws the ship: tank arrangement and finish, radiator layout, number of nozzles. None of it changes a number.' },
    odc_preset: { title: 'Stock fit', body: 'Reload the hull family\'s stock design. Every stock ship in the story and the campaign is exactly one of these.' },
    odc_fly: { title: 'Fly this design', body: 'Save it and take it out against a matched opponent in deep space. The ship you fly is built from exactly these numbers.' },
  };

  let styleInjected = false;
  function injectStyle() {
    if (styleInjected || document.getElementById('odc-style')) { styleInjected = true; return; }
    const s = document.createElement('style'); s.id = 'odc-style'; s.textContent = CSS; document.head.appendChild(s); styleInjected = true;
  }
  function installTips() {
    if (OD.UI && OD.UI.TIPS) { for (const k in TIPS) if (!OD.UI.TIPS[k]) OD.UI.TIPS[k] = TIPS[k]; return true; }
    return false;
  }
  // a small tooltip for pages without the game's UI module
  let tipEl = null, tipBound = false;
  function ownTips() {
    if (tipBound) return;
    tipBound = true;
    document.addEventListener('mouseover', (e) => {
      const t = e.target.closest && e.target.closest('.odc [data-tip]');
      if (!t) { if (tipEl) tipEl.hidden = true; return; }
      const tip = TIPS[t.dataset.tip];
      if (!tip) { if (tipEl) tipEl.hidden = true; return; }
      if (!tipEl) { tipEl = document.createElement('div'); tipEl.className = 'odc-tooltip'; document.body.appendChild(tipEl); }
      tipEl.innerHTML = '<div class="t">' + esc(tip.title) + '</div><div class="b">' + esc(tip.body) + '</div>' + (tip.formula ? '<div class="f">' + esc(tip.formula) + '</div>' : '');
      tipEl.hidden = false;
      const x = Math.min(e.clientX + 14, window.innerWidth - 336), y = Math.min(e.clientY + 16, window.innerHeight - 120);
      tipEl.style.left = x + 'px'; tipEl.style.top = y + 'px';
    });
  }

  // ------------------------------------------------------------------ controls table
  const CONTROLS = [
    { id: 'thrust', sec: 'drive', label: 'Thrust', tip: 'odc_thrust', rel: 'thrust', min: 0.3, max: 2.5, step: 0.05, get: (p) => p.thrust, set: (p, v) => { p.thrust = v; }, fmt: (v) => U.fmt.si(v, 'N') },
    { id: 've', sec: 'drive', adv: true, label: 'Exhaust vel.', tip: 'odc_ve', min: 35e3, max: 70e3, step: 1e3, get: (p) => p.ve, set: (p, v) => { p.ve = v; }, fmt: (v) => U.fmt.num(v / 1e3, 3) + ' km/s' },
    { id: 'prop', sec: 'prop', label: 'Propellant', tip: 'odc_prop', rel: 'propMass', min: 0.2, max: 2.5, step: 0.05, get: (p) => p.prop, set: (p, v) => { p.prop = v; }, fmt: (v) => U.fmt.mass(v) },
    { id: 'radiator', sec: 'heat', label: 'Radiators', tip: 'odc_radiator', rel: 'radiatorArea', min: 0.25, max: 3, step: 0.05, get: (p) => p.radiator, set: (p, v) => { p.radiator = v; }, fmt: (v) => U.fmt.num(v, 3) + ' m²' },
    { id: 'sink', sec: 'heat', adv: true, label: 'Heat sink', tip: 'odc_sink', rel: 'sinkCapacity', min: 0.5, max: 3, step: 0.05, get: (p) => p.sink, set: (p, v) => { p.sink = v; }, fmt: (v) => U.fmt.energy(v) },
    { id: 'reactor', sec: 'heat', label: 'Reactor', tip: 'odc_reactor', rel: 'reactorPower', min: 0.5, max: 3, step: 0.05, get: (p) => p.reactor, set: (p, v) => { p.reactor = v; }, fmt: (v) => U.fmt.power(v) },
    { id: 'nose', sec: 'armour', label: 'Nose', tip: 'odc_armour', min: 0, max: (s) => Math.max(6, s.armour.nose * 3), step: 1, get: (p) => p.armour.nose, set: (p, v) => { p.armour.nose = v; }, fmt: (v) => v + ' cm' },
    { id: 'flank', sec: 'armour', label: 'Flank', tip: 'odc_armour', min: 0, max: (s) => Math.max(6, s.armour.flank * 3), step: 1, get: (p) => p.armour.flank, set: (p, v) => { p.armour.flank = v; }, fmt: (v) => v + ' cm' },
    { id: 'tail', sec: 'armour', label: 'Tail', tip: 'odc_armour', min: 0, max: (s) => Math.max(6, s.armour.tail * 3), step: 1, get: (p) => p.armour.tail, set: (p, v) => { p.armour.tail = v; }, fmt: (v) => v + ' cm' },
  ];  const SECTIONS = [
    { id: 'drive', title: 'Drive', tip: 'odc_thrust' },
    { id: 'prop', title: 'Propellant', tip: 'odc_prop' },
    { id: 'heat', title: 'Heat and power', tip: 'odc_heat' },
    { id: 'armour', title: 'Armour', tip: 'odc_armour' },
  ];
  const MASS_COLORS = { structure: '#6f7f93', armour: '#9aa5b4', sink: '#3f80d8', radiators: '#c8503c', drive: '#f0a04b', reactor: '#8f7ce6', mounts: '#4fd1c5', tankage: '#8b7a4a', propellant: '#d9b45a' };
  const MASS_LABEL = { structure: 'Structure', armour: 'Armour', sink: 'Heat sink', radiators: 'Radiators', drive: 'Drive', reactor: 'Reactor', mounts: 'Fittings', tankage: 'Tankage', propellant: 'Propellant' };

  // ------------------------------------------------------------------ blueprint drawing
  function cssVar(el, name, fallback) { const v = getComputedStyle(el).getPropertyValue(name).trim(); return v || fallback; }
  function heatRgb(t) {
    t = clamp(t, 0, 1);
    const stops = [[76, 23, 18], [158, 41, 18], [242, 107, 31], [255, 184, 77], [255, 237, 184]];
    const f = t * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(f)), k = f - i;
    const c = stops[i].map((v, j) => Math.round(v + (stops[i + 1][j] - v) * k));
    return 'rgb(' + c.join(',') + ')';
  }
  function layout(d) {
    const stock = CLASSES()[d.base], Ls = stock.length, L = d.length, b = d.beam;
    const nose = { x0: L / 2 - 0.18 * Ls, x1: L / 2 };
    const fwd = { x0: nose.x0 - 0.20 * Ls, x1: nose.x0 };
    const tank = { x0: fwd.x0 - Math.max(0.02 * Ls, L - 0.65 * Ls), x1: fwd.x0 };
    const reac = { x0: tank.x0 - 0.12 * Ls, x1: tank.x0 };
    const drive = { x0: reac.x0 - 0.15 * Ls, x1: reac.x0 };
    const chord = 0.25 * Ls;
    const span = (d.radiatorArea / 2) / chord;
    const rad = { x0: reac.x0 + 0.01 * Ls, x1: reac.x0 + 0.01 * Ls + chord, span };
    const re = clamp(0.42 * b * Math.sqrt(d.thrust / stock.thrust), 0.22 * b, 0.95 * b);
    return { Ls, L, b, nose, fwd, tank, reac, drive, rad, nozzleExit: re, tanks: d.summary.tanks };
  }
  function drawBlueprint(ctx, W, H, d, st, root, opts) {
    opts = opts || {};
    const ink = cssVar(root, '--ink', '#e0e8f0'), dim = cssVar(root, '--dim', '#7f91a7'), accent = cssVar(root, '--accent', '#4fd1c5'), warn = cssVar(root, '--warn', '#ffb454');
    const facColor = (OD.Ships.FACTIONS[st.faction] || OD.Ships.FACTIONS.JC).color;
    const ly = layout(d);
    const pad = 22;
    const spanShown = ly.rad.span * (0.15 + 0.85 * st.radiators);
    const wide = ly.L * 1.08 + (st.throttle > 0 ? ly.L * 0.35 * st.throttle : 0);
    const tall = ly.b * 1.1 + 2 * ly.rad.span + 8;
    const s = Math.min((W - 2 * pad) / wide, (H - 2 * pad - (opts.labels === false ? 0 : 74)) / tall);
    const cx = W / 2 + (st.throttle > 0 ? ly.L * 0.16 * st.throttle * s : 0), cy = H / 2 - (opts.labels === false ? 0 : 10);
    const X = (x) => cx + x * s, Y = (y) => cy - y * s;
    ctx.save();
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    // faint grid
    if (opts.grid !== false) {
      ctx.strokeStyle = 'rgba(120,150,180,0.07)'; ctx.lineWidth = 1;
      const g = Math.max(18, 10 * s);
      ctx.beginPath();
      for (let x = (cx % g); x < W; x += g) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
      for (let y = (cy % g); y < H; y += g) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
      ctx.stroke();
    }
    const hair = 'rgba(180,192,207,0.75)', fill = 'rgba(120,150,180,0.10)';
    // plume
    if (st.throttle > 0.01) {
      const len = ly.L * (0.25 + 0.9 * st.throttle) * s, w = ly.nozzleExit * s;
      const x0 = X(ly.drive.x0), y0 = Y(0);
      const g = ctx.createLinearGradient(x0, 0, x0 - len, 0);
      g.addColorStop(0, 'rgba(180,215,255,' + (0.55 * st.throttle).toFixed(2) + ')'); g.addColorStop(0.3, 'rgba(110,170,255,' + (0.25 * st.throttle).toFixed(2) + ')'); g.addColorStop(1, 'rgba(60,110,220,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(x0, y0 - w); ctx.lineTo(x0 - len * 0.35, y0 - w * 1.5); ctx.lineTo(x0 - len, y0 - w * 0.4); ctx.lineTo(x0 - len, y0 + w * 0.4); ctx.lineTo(x0 - len * 0.35, y0 + w * 1.5); ctx.lineTo(x0, y0 + w); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(235,245,255,' + (0.8 * st.throttle).toFixed(2) + ')'; ctx.beginPath(); ctx.moveTo(x0, y0 - w * 0.4); ctx.lineTo(x0 - len * 0.4, y0); ctx.lineTo(x0, y0 + w * 0.4); ctx.closePath(); ctx.fill();
    }
    // radiators (behind the hull)
    const heatCol = heatRgb(st.heat);
    for (const side of [1, -1]) {
      const x0 = X(ly.rad.x0), x1 = X(ly.rad.x1), yr = Y(side * ly.b * 0.5), yt = Y(side * (ly.b * 0.5 + spanShown));
      ctx.fillStyle = heatCol; ctx.globalAlpha = 0.28 + 0.5 * st.heat + (st.radiators < 0.5 ? -0.12 : 0);
      ctx.fillRect(x0, Math.min(yr, yt), x1 - x0, Math.abs(yt - yr));
      ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(255,180,150,0.55)'; ctx.lineWidth = 1; ctx.strokeRect(x0, Math.min(yr, yt), x1 - x0, Math.abs(yt - yr));
      // coolant lines
      ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath();
      for (let k = 1; k < 6; k++) { const xx = x0 + ((x1 - x0) * k) / 6; ctx.moveTo(xx, yr); ctx.lineTo(xx, yt); }
      ctx.stroke();
      if (st.heat > 0.4) { const g = ctx.createRadialGradient((x0 + x1) / 2, (yr + yt) / 2, 2, (x0 + x1) / 2, (yr + yt) / 2, Math.max(x1 - x0, Math.abs(yt - yr)) * 0.9); g.addColorStop(0, 'rgba(255,150,60,' + (0.25 * (st.heat - 0.4)).toFixed(2) + ')'); g.addColorStop(1, 'rgba(255,150,60,0)'); ctx.fillStyle = g; ctx.fillRect(x0 - 40, Math.min(yr, yt) - 40, x1 - x0 + 80, Math.abs(yt - yr) + 80); }
    }
    // drive: nozzle bell
    {
      const x0 = X(ly.drive.x1), x1 = X(ly.drive.x0), rt = ly.nozzleExit * 0.35 * s, re = ly.nozzleExit * s;
      ctx.fillStyle = 'rgba(90,100,115,0.35)'; ctx.strokeStyle = hair; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x0, Y(0) - rt); ctx.quadraticCurveTo(x1 - (x1 - x0) * 0.1, Y(0) - re * 0.55, x1, Y(0) - re); ctx.lineTo(x1, Y(0) + re); ctx.quadraticCurveTo(x1 - (x1 - x0) * 0.1, Y(0) + re * 0.55, x0, Y(0) + rt); ctx.closePath(); ctx.fill(); ctx.stroke();
      if (st.throttle > 0.01) { ctx.fillStyle = 'rgba(180,215,255,' + (0.5 * st.throttle).toFixed(2) + ')'; ctx.beginPath(); ctx.moveTo(x1, Y(0) - re * 0.9); ctx.lineTo(x1, Y(0) + re * 0.9); ctx.lineTo(x0 + (x1 - x0) * 0.4, Y(0)); ctx.closePath(); ctx.fill(); }
    }
    // reactor and shadow shield
    {
      const x0 = X(ly.reac.x0), x1 = X(ly.reac.x1), r = ly.b * 0.32 * s;
      ctx.fillStyle = 'rgba(60,64,72,0.5)'; ctx.strokeStyle = hair; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.rect(x0 + (x1 - x0) * 0.15, Y(0) - r, (x1 - x0) * 0.7, 2 * r); ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(30,32,38,0.9)'; ctx.fillRect(x1 - 2, Y(0) - ly.b * 0.5 * s, 3, ly.b * s);   // shadow shield disc
      // truss to the tanks
      ctx.strokeStyle = 'rgba(160,170,185,0.5)'; ctx.beginPath();
      for (let k = 0; k < 4; k++) { const xx = x0 + ((x1 - x0) * k) / 4; ctx.moveTo(xx, Y(-ly.b * 0.3)); ctx.lineTo(xx + (x1 - x0) / 4, Y(ly.b * 0.3)); }
      ctx.stroke();
    }
    // tanks
    {
      const n = ly.tanks, x0 = X(ly.tank.x0), x1 = X(ly.tank.x1), w = (x1 - x0) / n, r = ly.b * 0.45 * s;
      for (let i = 0; i < n; i++) {
        const a = x0 + w * i + w * 0.04, bx = x0 + w * (i + 1) - w * 0.04, rr = Math.min(r, (bx - a) / 2);
        ctx.fillStyle = 'rgba(217,180,90,' + (0.10 + 0.14 * (st.prop === undefined ? 1 : st.prop)).toFixed(2) + ')'; ctx.strokeStyle = 'rgba(217,180,90,0.7)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(a + rr, Y(0) - r); ctx.lineTo(bx - rr, Y(0) - r); ctx.arcTo(bx, Y(0) - r, bx, Y(0), rr); ctx.arcTo(bx, Y(0) + r, bx - rr, Y(0) + r, rr); ctx.lineTo(a + rr, Y(0) + r); ctx.arcTo(a, Y(0) + r, a, Y(0), rr); ctx.arcTo(a, Y(0) - r, a + rr, Y(0) - r, rr); ctx.closePath(); ctx.fill(); ctx.stroke();
      }
      // spine
      ctx.strokeStyle = 'rgba(160,170,185,0.5)'; ctx.lineWidth = Math.max(1, 0.06 * ly.b * s); ctx.beginPath(); ctx.moveTo(X(ly.drive.x1), Y(0)); ctx.lineTo(X(ly.fwd.x0), Y(0)); ctx.stroke();
    }
    // forward hull
    {
      const x0 = X(ly.fwd.x0), x1 = X(ly.fwd.x1), r = ly.b * 0.5 * s;
      ctx.fillStyle = fill; ctx.strokeStyle = hair; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.rect(x0, Y(0) - r, x1 - x0, 2 * r); ctx.fill(); ctx.stroke();
      // hull plating lines
      ctx.strokeStyle = 'rgba(180,192,207,0.18)'; ctx.beginPath(); for (let k = 1; k < 4; k++) { const xx = x0 + ((x1 - x0) * k) / 4; ctx.moveTo(xx, Y(0) - r); ctx.lineTo(xx, Y(0) + r); } ctx.stroke();
      // faction stripe
      ctx.fillStyle = facColor; ctx.globalAlpha = 0.8; ctx.fillRect(x0 + (x1 - x0) * 0.62, Y(0) - r, Math.max(2, (x1 - x0) * 0.05), 2 * r); ctx.globalAlpha = 1;
      // sensor dish
      ctx.strokeStyle = 'rgba(200,210,225,0.7)'; ctx.beginPath(); ctx.arc(x0 + (x1 - x0) * 0.3, Y(0) - r - 3, Math.max(2, 0.08 * ly.b * s), Math.PI, 0); ctx.stroke();
    }
    // nose cone with armour cap
    {
      const x0 = X(ly.nose.x0), x1 = X(ly.nose.x1), r = ly.b * 0.5 * s;
      ctx.fillStyle = fill; ctx.strokeStyle = hair; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x0, Y(0) - r); ctx.lineTo(x1, Y(0)); ctx.lineTo(x0, Y(0) + r); ctx.closePath(); ctx.fill(); ctx.stroke();
      const armW = (cm) => Math.max(0.6, Math.min(9, cm * 0.16 * Math.max(0.6, s / 3)));
      ctx.strokeStyle = 'rgba(214,220,228,0.85)'; ctx.lineWidth = armW(d.armour.nose);
      ctx.beginPath(); ctx.moveTo(x0, Y(0) - r); ctx.lineTo(x1, Y(0)); ctx.lineTo(x0, Y(0) + r); ctx.stroke();
      // flank armour: along both sides of hull and tanks
      ctx.lineWidth = armW(d.armour.flank); ctx.strokeStyle = 'rgba(214,220,228,0.6)';
      ctx.beginPath(); ctx.moveTo(X(ly.tank.x0), Y(0) - r); ctx.lineTo(X(ly.fwd.x1), Y(0) - r); ctx.moveTo(X(ly.tank.x0), Y(0) + r); ctx.lineTo(X(ly.fwd.x1), Y(0) + r); ctx.stroke();
      // tail armour ring
      ctx.lineWidth = armW(d.armour.tail); ctx.strokeStyle = 'rgba(214,220,228,0.6)';
      ctx.beginPath(); ctx.moveTo(X(ly.reac.x0), Y(0) - ly.b * 0.42 * s); ctx.lineTo(X(ly.reac.x0), Y(0) + ly.b * 0.42 * s); ctx.stroke();
    }
    // fittings
    const marks = [];
    {
      let ti = 0, bi = 0, pi = 0, ri = 0;
      const turretsN = d.comps.filter((c) => c.group === 'turret').length, baysN = d.comps.filter((c) => c.group === 'bay').length, pdN = d.comps.filter((c) => c.group === 'pd').length, railsN = d.comps.filter((c) => c.group === 'rail').length;
      for (const c of d.comps) {
        if (c.group === 'spinal') {
          const x0 = X(ly.fwd.x0 + 0.05 * ly.Ls), x1 = X(ly.nose.x1 + 0.03 * ly.Ls);
          ctx.strokeStyle = accent; ctx.lineWidth = Math.max(1.5, 0.05 * ly.b * s); ctx.beginPath(); ctx.moveTo(x0, Y(0)); ctx.lineTo(x1, Y(0)); ctx.stroke();
          ctx.fillStyle = accent; ctx.beginPath(); ctx.arc(x1, Y(0), Math.max(1.5, 0.05 * ly.b * s), 0, Math.PI * 2); ctx.fill();
          marks.push({ x: ly.nose.x1, y: 0, side: 1, text: c.label, kind: 'fit' });
        } else if (c.group === 'turret') {
          const f = (ti + 0.5) / turretsN, x = ly.fwd.x0 + (ly.fwd.x1 - ly.fwd.x0) * (0.15 + 0.7 * f), side = ti % 2 === 0 ? 1 : -1, y = side * ly.b * 0.5;
          const r = Math.max(2.5, 0.09 * ly.b * s * Math.sqrt((CAT[c.catId].aperture || 1) / 1));
          ctx.fillStyle = 'rgba(80,90,105,0.9)'; ctx.strokeStyle = accent; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(X(x), Y(y), r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(X(x), Y(y)); ctx.lineTo(X(x) + r * 2.2 * Math.cos(-0.5), Y(y) - side * r * 2.2 * Math.sin(0.5)); ctx.stroke();
          marks.push({ x, y, side, text: c.label, kind: 'fit' });
          ti++;
        } else if (c.group === 'rail') {
          const side = ri % 2 === 0 ? 1 : -1, y = side * ly.b * 0.22;
          ctx.strokeStyle = accent; ctx.lineWidth = Math.max(1, 0.035 * ly.b * s);
          ctx.beginPath(); ctx.moveTo(X(ly.tank.x0 + 0.02 * ly.Ls), Y(y)); ctx.lineTo(X(ly.nose.x0 + 0.06 * ly.Ls), Y(y)); ctx.stroke();
          ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1; ctx.beginPath(); for (let k = 0; k < 8; k++) { const xx = X(ly.tank.x0 + 0.02 * ly.Ls) + ((X(ly.nose.x0) - X(ly.tank.x0)) * k) / 8; ctx.moveTo(xx, Y(y) - 2); ctx.lineTo(xx, Y(y) + 2); } ctx.stroke();
          marks.push({ x: ly.tank.x0 + (ly.nose.x0 - ly.tank.x0) * (0.3 + 0.3 * ri), y, side: side, text: c.label, kind: 'fit' });
          ri++;
        } else if (c.group === 'bay') {
          const f = (bi + 0.5) / baysN, x = ly.tank.x1 + (ly.fwd.x1 - ly.tank.x1) * (0.1 + 0.55 * f) - 0.08 * ly.Ls, side = bi % 2 === 0 ? -1 : 1;
          const w = 0.12 * ly.Ls * s, h = ly.b * 0.22 * s, y = side * ly.b * 0.5;
          const cells = CAT[c.catId].count, cols = Math.min(6, cells), rows = Math.ceil(cells / cols);
          ctx.fillStyle = 'rgba(40,44,52,0.9)'; ctx.strokeStyle = accent; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.rect(X(x) - w / 2, Y(y) - (side > 0 ? 0 : h) - (side > 0 ? -h * 0 : 0) + (side > 0 ? -h : 0), w, h); ctx.fill(); ctx.stroke();
          ctx.fillStyle = 'rgba(10,12,16,0.95)';
          for (let rr = 0; rr < rows; rr++) for (let cc = 0; cc < cols; cc++) { if (rr * cols + cc >= cells) break; const cw = w / cols, ch = h / rows; ctx.fillRect(X(x) - w / 2 + cc * cw + cw * 0.18, Y(y) + (side > 0 ? -h : 0) + rr * ch + ch * 0.18, cw * 0.64, ch * 0.64); }
          marks.push({ x, y, side, text: c.label, kind: 'fit' });
          bi++;
        } else if (c.group === 'pd') {
          const f = (pi + 0.5) / pdN, x = ly.tank.x0 + (ly.nose.x0 - ly.tank.x0) * f, side = pi % 2 === 0 ? 1 : -1, y = side * ly.b * 0.5;
          ctx.fillStyle = warn; ctx.beginPath(); ctx.moveTo(X(x), Y(y) - 4); ctx.lineTo(X(x) + 4, Y(y)); ctx.lineTo(X(x), Y(y) + 4); ctx.lineTo(X(x) - 4, Y(y)); ctx.closePath(); ctx.fill();
          if (pi === pdN - 1) marks.push({ x, y, side, text: 'Point defence' + (pdN > 1 ? ' ×' + pdN : ''), kind: 'fit' });
          pi++;
        }
      }
    }
    // labels
    let keyOut = [];
    if (opts.labels !== false) {
      const mono = cssVar(root, '--mono', '') || 'ui-monospace, Menlo, monospace';
      ctx.font = '10.5px ' + mono; ctx.textBaseline = 'middle';
      // fittings: numbered on the drawing, keyed in the corner
      let keyW = 0;
      marks.forEach((m, i) => {
        const px = X(m.x), py = Y(m.y) - (m.side || 1) * 15, r = 7;
        ctx.strokeStyle = 'rgba(79,209,197,0.6)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(X(m.x), Y(m.y)); ctx.lineTo(px, py); ctx.stroke();
        ctx.fillStyle = 'rgba(4,7,12,0.92)'; ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = accent; ctx.stroke();
        ctx.fillStyle = accent; ctx.textAlign = 'center'; ctx.fillText(String(i + 1), px, py + 0.5);
        keyW = Math.max(keyW, ctx.measureText((i + 1) + '  ' + m.text).width);
      });
      const keyIn = W >= 480, narrow = W < 400;   // under 480 px the key goes to the caption strip; under 400 the part labels are left to the readout
      if (keyIn) { ctx.textAlign = 'right'; marks.forEach((m, i) => { ctx.fillStyle = accent; ctx.fillText((i + 1) + '  ' + m.text, W - 8, 12 + i * 13); }); }
      keyOut = marks.map((m, i) => (i + 1) + ' ' + m.text);
      // parts: one row above the ship, one below, spaced left to right
      const parts = [
        { x: (ly.drive.x0 + ly.drive.x1) / 2, y: ly.nozzleExit * 0.9, side: 1, text: 'Drive ' + U.fmt.si(d.thrust, 'N') + ' · ' + U.fmt.num(d.exhaustVelocity / 1e3, 3) + ' km/s' },
        { x: (ly.rad.x0 + ly.rad.x1) / 2, y: ly.b * 0.5 + spanShown, side: 1, text: 'Radiators ' + U.fmt.num(d.radiatorArea, 3) + ' m²' },
        { x: ly.nose.x0 + 0.5 * (ly.nose.x1 - ly.nose.x0), y: ly.b * 0.25, side: 1, text: 'Nose armour ' + d.armour.nose + ' cm' },
        { x: (ly.reac.x0 + ly.reac.x1) / 2, y: -ly.b * 0.32, side: -1, text: 'Reactor ' + U.fmt.power(d.reactorPower) + ' · sink ' + U.fmt.energy(d.sinkCapacity) },
        { x: (ly.tank.x0 + ly.tank.x1) / 2, y: -ly.b * 0.45, side: -1, text: ly.tanks + (ly.tanks > 1 ? ' tanks · ' : ' tank · ') + U.fmt.mass(d.propMass) },
        { x: (ly.fwd.x0 + ly.fwd.x1) / 2, y: -ly.b * 0.5, side: -1, text: 'Flank ' + d.armour.flank + ' cm · tail ' + d.armour.tail + ' cm' },
      ];
      // Labels go left to right into up to three rows; a label that would overprint another is left out rather
      // than drawn on top of it, and the top rows stop short of the fittings key.
      const place = (list, yRow, dir, maxX) => {
        if (narrow) return;
        list.sort((a, b) => a.x - b.x);
        const lastRight = [-1e9, -1e9, -1e9];
        list.forEach((it) => {
          const w = ctx.measureText(it.text).width;
          if (w + 12 > maxX) return;
          let tx = Math.min(maxX - w / 2, Math.max(6 + w / 2, X(it.x)));
          let row = lastRight.findIndex((r) => tx - w / 2 >= r + 12);
          if (row < 0) { row = 2; tx = lastRight[2] + 12 + w / 2; if (tx + w / 2 > maxX) return; }
          lastRight[row] = tx + w / 2;
          const ty = yRow + dir * row * 13;
          ctx.strokeStyle = 'rgba(180,192,207,0.35)'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(X(it.x), Y(it.y)); ctx.lineTo(tx, ty + dir * 8); ctx.stroke();
          ctx.fillStyle = dim; ctx.textAlign = 'center'; ctx.fillText(it.text, tx, ty);
        });
      };
      // the label rows sit just clear of the hull and its fitting numbers, not out at the edges of a tall box
      const ext = Math.max(ly.b * 0.5 + spanShown, ly.nozzleExit) * s;
      const rowTop = Math.max(pad + 2, cy - ext - 56), rowBottom = Math.min(H - pad - 24, cy + ext + 56);
      place(parts.filter((p) => p.side > 0), rowTop, 1, marks.length && keyIn ? W - keyW - 26 : W - 6);
      place(parts.filter((p) => p.side < 0), rowBottom, -1, W - 6);
      // dimension line, under the lower labels and above the caption strip
      const yd = Math.min(H - pad - 4, rowBottom + 22);
      ctx.strokeStyle = 'rgba(180,192,207,0.45)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(X(-ly.L / 2), yd); ctx.lineTo(X(ly.L / 2), yd); ctx.moveTo(X(-ly.L / 2), yd - 4); ctx.lineTo(X(-ly.L / 2), yd + 4); ctx.moveTo(X(ly.L / 2), yd - 4); ctx.lineTo(X(ly.L / 2), yd + 4); ctx.stroke();
      ctx.fillStyle = ink; ctx.textAlign = 'center'; ctx.fillText(d.length + ' m', X(0), yd - 8);
      if (opts.caption !== false) { ctx.textAlign = 'left'; ctx.fillStyle = dim; ctx.fillText('BLUEPRINT · TOP VIEW · NOSE RIGHT', 10, H - 10); }
    }
    ctx.restore();
    return { key: keyOut, keyDrawn: W >= 480 };
  }

  // the ship-art module's parametric drawing, when it can draw a design object; false otherwise
  function drawArt(ctx, d, o) {
    const A = OD.ShipArt;
    if (!A || typeof A.draw !== 'function') return false;
    try {
      const ok = A.draw(ctx, d, o);
      return ok === true || (ok !== false && ok !== undefined && ok !== null);
    } catch (e) { return false; }
  }
  function artCanDraw(d) {
    const A = OD.ShipArt;
    if (!A || typeof A.bounds !== 'function') return false;
    try { const b = A.bounds(d, { size: 100, view: 'side' }); return !!(b && b.w > 0); } catch (e) { return false; }
  }

  // ------------------------------------------------------------------ names for new designs
  const NAMES = ['Pellucid', 'Verdigris', 'Hollowell', 'Saltmarsh', 'Quillon', 'Brightwater', 'Osprey', 'Cormorant', 'Gannet', 'Ironbark', 'Lodestar', 'Mistral', 'Nightjar', 'Oriel', 'Palisade', 'Rookery', 'Sunder', 'Tamarisk', 'Umber', 'Vantage', 'Wayfarer', 'Yarrow'];
  function pickName() {
    const used = new Set(records().map((r) => r.name));
    const free = NAMES.filter((n) => !used.has(n));
    const pool = free.length ? free : NAMES;
    return pool[Math.floor(Math.random() * pool.length)];
  }
  const STOCK = {};
  function stockDesign(base) { if (!STOCK[base]) STOCK[base] = derive(presetParams(base), 'stock_' + base); return STOCK[base]; }
  const roundTo = (v, q) => Math.round(v / q) * q;
  const ROUND = { thrust: 1e4, prop: 1e3, radiator: 1, sink: 1e7, reactor: 1e5, ve: 1e2 };

  // ==================================================================== mount
  function mount(root, options) {
    options = options || {};
    if (root._odc) { try { root._odc.destroy(); } catch (e) { /* a stale controller */ } }
    injectStyle();
    if (!installTips()) ownTips();
    root.classList.add('odc');
    const ac = typeof AbortController === 'function' ? new AbortController() : null;
    const listen = (type, fn) => root.addEventListener(type, fn, ac ? { signal: ac.signal } : false);
    const faction = options.faction || 'JC';
    let detail = options.detail || (function () { try { return localStorage.getItem('od.detail') || 'essentials'; } catch (e) { return 'essentials'; } })();
    if (detail !== 'full') detail = 'essentials';
    root.dataset.detail = detail;

    let id = null, params = null, design = null, dirty = false, saved = false;
    let view = 'blueprint';
    const pose = { radiators: 1, throttle: 0, heat: 0.15, spin: 0, labels: 1 };
    const t0 = performance.now();
    let raf = 0, destroyed = false, resizeObs = null, toastTimer = null;

    function freshDesign(base) { id = newId(); params = presetParams(base || options.base || 'frigate'); params.name = pickName(); design = derive(params, id); dirty = false; saved = false; }
    function loadDesign(did) { const d = get(did); if (!d) return false; id = d.id; params = deep(d.params); design = d; dirty = false; saved = true; return true; }
    if (!(options.designId && loadDesign(options.designId))) freshDesign();

    // ---------------------------------------------------------------- skeleton
    root.innerHTML =
      '<header class="odc-head">' +
        '<div class="odc-title"><div class="odc-eyebrow">Yard · ship configurator</div>' +
          '<div class="odc-name"><input class="odc-nameinput" maxlength="24" aria-label="Design name" spellcheck="false"><span class="odc-cls"></span><span class="odc-pill odc-state-pill"></span></div></div>' +
        '<div class="odc-hulls" role="group" aria-label="Hull family">' + BASE_ORDER.map((b) => '<button data-base="' + b + '"><span>' + esc(CLASSES()[b].name.split('-')[0]) + '</span><small>' + esc(CLASSES()[b].role) + ' · ' + CLASSES()[b].length + ' m</small></button>').join('') + '</div>' +
        '<div class="odc-headr"><div class="odc-seg odc-detail" role="group" aria-label="Detail"><button data-detail="essentials">Essentials</button><button data-detail="full">Full</button></div>' +
          '<select class="odc-saved" aria-label="Saved designs"></select></div>' +
      '</header>' +
      '<div class="odc-main">' +
        '<section class="odc-controls" aria-label="Choices"></section>' +
        '<section class="odc-stage" aria-label="The ship">' +
          '<div class="odc-stagehead"><div class="odc-seg odc-views" role="group" aria-label="View" data-tip="odc_view"><button data-view="blueprint">Blueprint</button><button data-view="threequarter">Three-quarter</button><button data-view="side">Side</button><button data-view="top">Top</button></div>' +
            '<span class="odc-note odc-artnote"></span></div>' +
          '<div class="odc-canvaswrap"><canvas class="odc-canvas" aria-label="The ship as configured"></canvas><div class="odc-caption"></div></div><div class="odc-key" hidden></div>' +
          '<div class="odc-state" data-adv data-tip="odc_state"><label><input type="checkbox" data-pose="radiators" checked> Radiators out</label><label><input type="checkbox" data-pose="throttle"> Drive lit</label><label>Sink load <input type="range" data-pose="heat" min="0" max="1" step="0.05" value="0.15"></label><label><input type="checkbox" data-pose="spin"> Orbit camera</label><label><input type="checkbox" data-pose="labels" checked> Labels</label></div>' +
          '<div class="odc-say" data-tone=""><div class="odc-say-head">Yard engineer</div><p class="odc-say-line"></p></div>' +
        '</section>' +
        '<section class="odc-readout" aria-label="Readout"></section>' +
        '<section class="odc-more" aria-label="Armour and the stock hull"></section>' +
      '</div>' +
      '<footer class="odc-foot"><div class="odc-issues" aria-live="polite"></div><div class="odc-actions">' +
        (options.onFly ? '<button class="primary" data-act="fly" data-tip="odc_fly">Fly this design</button>' : '') +
        '<button data-act="save">Save</button><button data-act="saveas">Save as new</button><button data-act="delete" class="danger">Delete</button>' +
        '<button data-act="copy" data-adv class="ghost">Copy code</button><button data-act="paste" data-adv class="ghost">Paste code</button>' +
        (options.onBack ? '<button data-act="back" data-esc>Back</button>' : '') +
      '</div></footer>';
    const $ = (sel) => root.querySelector(sel);
    const $$ = (sel) => Array.from(root.querySelectorAll(sel));
    const controlsEl = $('.odc-controls'), readoutEl = $('.odc-readout'), moreEl = $('.odc-more'), canvas = $('.odc-canvas'), sayEl = $('.odc-say'), sayLine = $('.odc-say-line'), issuesEl = $('.odc-issues');
    // the Delete key's arming (see the click handler): its timer, what the note says, and the engineer's line it covered
    let delArmed = 0, delNote = '', delSaid = null;

    // ---------------------------------------------------------------- controls
    function controlsHTML() {
      const stock = CLASSES()[params.base], B = BASES[params.base];
      let h = '<div class="odc-sec"><h4>Fit</h4><div class="odc-btnrow"><button class="sm" data-act="preset" data-tip="odc_preset">Stock fit</button><button class="sm ghost" data-act="random" data-adv>Surprise me</button></div><div class="odc-note">' + esc(stock.blurb) + '</div></div>';
      for (const sec of SECTIONS) {
        h += '<div class="odc-sec"><h4 data-tip="' + sec.tip + '">' + sec.title + '</h4>';
        for (const c of CONTROLS.filter((x) => x.sec === sec.id)) {
          const min = typeof c.min === 'function' ? c.min(stock) : c.min, max = typeof c.max === 'function' ? c.max(stock) : c.max, step = typeof c.step === 'function' ? c.step(stock) : c.step;
          h += '<div class="odc-row"' + (c.adv ? ' data-adv' : '') + '><span class="k" data-tip="' + c.tip + '">' + c.label + '</span><input type="range" data-ctl="' + c.id + '" min="' + min + '" max="' + max + '" step="' + step + '" aria-label="' + c.label + '"><span class="v" data-val="' + c.id + '"></span></div>';
        }
        if (sec.id === 'prop') h += '<div class="odc-note" data-val="propnote"></div>';
        if (sec.id === 'heat') h += '<div class="odc-note" data-val="heatnote"></div>';
        h += '</div>';
      }
      h += '<div class="odc-sec"><h4 data-tip="odc_fittings">Fittings</h4>';
      for (const g of GROUPS) {
        const n = B.slots[g];
        for (let i = 0; i < n; i++) {
          // the slot's name sits over its menu, so the menu has the column's full width for "Point-defence laser, heavy · 10 t · 2.5 MW"
          h += '<div class="odc-row slot stack"><span class="k">' + GROUP_LABEL[g] + (n > 1 ? ' ' + (i + 1) : '') + '</span><select data-slot="' + g + i + '" data-group="' + g + '" aria-label="' + GROUP_LABEL[g] + ' ' + (i + 1) + '"><option value="">— empty —</option>' +
            catForSlot(g).map((c) => '<option value="' + c.id + '">' + esc(c.label) + ' · ' + U.fmt.mass(catMass(c)) + (catDraw(c) >= 1e6 ? ' · ' + U.fmt.power(catDraw(c)) : '') + '</option>').join('') + '</select></div>';
        }
      }
      h += '<div class="odc-note" data-val="fitnote"></div></div>';
      h += '<div class="odc-sec" data-adv><h4 data-tip="odc_look">Look</h4>' + Object.keys(LOOK).map((k) => '<div class="odc-row slot"><span class="k">' + LOOK[k].label + '</span><select data-look="' + k + '" aria-label="' + LOOK[k].label + '">' + LOOK[k].options.map((o) => '<option value="' + o[0] + '">' + o[1] + '</option>').join('') + '</select></div>').join('') + '<div class="odc-note">How the yard draws it. Nothing here changes a number.</div></div>';
      return h;
    }
    function buildControls() { controlsEl.innerHTML = controlsHTML(); syncControls(); }
    function syncControls() {
      const stock = CLASSES()[params.base];
      for (const c of CONTROLS) {
        const inp = controlsEl.querySelector('[data-ctl="' + c.id + '"]'), val = controlsEl.querySelector('[data-val="' + c.id + '"]');
        if (!inp) continue;
        const v = c.get(params);
        inp.value = c.rel ? (v / stock[c.rel]) : v;
        val.textContent = c.fmt(v);
      }
      for (const g of GROUPS) (params.slots[g] || []).forEach((cid, i) => { const sel = controlsEl.querySelector('[data-slot="' + g + i + '"]'); if (sel) sel.value = cid || ''; });
      for (const k in LOOK) { const sel = controlsEl.querySelector('[data-look="' + k + '"]'); if (sel) sel.value = (params.look && params.look[k]) || 'auto'; }
      const a = analyse(design);
      const pn = controlsEl.querySelector('[data-val="propnote"]'); if (pn) pn.textContent = design.summary.tanks + (design.summary.tanks > 1 ? ' tanks. ' : ' tank. ') + U.fmt.dv(a.dv) + ' of delta-v. ' + U.fmt.time(a.burnTime) + ' of full burn to empty.';
      const hn = controlsEl.querySelector('[data-val="heatnote"]'); if (hn) hn.textContent = 'Sheds ' + U.fmt.power(a.heatOut) + ' at ' + Math.round(a.radiatorTemp) + ' K. Full burn ' + (a.heat[1].net <= 0 ? 'runs cool' : 'fills the sink in ' + U.fmt.time(a.heat[1].saturate)) + '. Fittings draw ' + U.fmt.power(a.power.draw) + ' of ' + U.fmt.power(design.reactorPower) + '.';
      const fn = controlsEl.querySelector('[data-val="fitnote"]'); if (fn) fn.textContent = design.comps.length ? design.comps.length + ' fitted · ' + U.fmt.mass(design.masses.mounts) + ' · ' + U.fmt.power(a.power.draw) + ' when everything fires' : 'Nothing fitted.';
    }

    // ---------------------------------------------------------------- readout
    function cls3(v, good, warn) { return v >= good ? 'good' : v >= warn ? '' : 'warn'; }
    function readoutHTML() {
      const d = design, a = analyse(d), s = stockDesign(d.base), as = analyse(s);
      let h = '<div class="odc-vitals">' +
        '<div data-tip="odc_dv"><span class="k">Delta-v</span><span class="v">' + U.fmt.num(a.dv / 1e3, 3) + '<small>km/s</small></span><span class="s">stock ' + U.fmt.num(as.dv / 1e3, 3) + '</span></div>' +
        '<div data-tip="odc_accel"><span class="k">Accel.</span><span class="v">' + a.g.toFixed(2) + ' g</span><span class="s">dry ' + a.gDry.toFixed(2) + ' g</span></div>' +
        '<div data-tip="odc_mass"><span class="k">Loaded</span><span class="v">' + U.fmt.mass(a.mass) + '</span><span class="s">dry ' + U.fmt.mass(a.dry) + '</span></div>' +
        '<div data-tip="odc_cost"><span class="k">Cost</span><span class="v">' + a.cost + '<small>rp</small></span><span class="s">stock ' + as.cost + '</span></div></div>';
      // mass budget
      const total = a.mass;
      const segs = Object.keys(MASS_LABEL).map((k) => ({ k, v: k === 'propellant' ? d.propMass : d.masses[k] }));
      h += '<div class="odc-sec"><h4 data-tip="odc_massbar">Mass budget</h4><div class="odc-bar">' + segs.map((sg) => '<i style="width:' + ((100 * sg.v) / total).toFixed(2) + '%;background:' + MASS_COLORS[sg.k] + '" title="' + MASS_LABEL[sg.k] + ' ' + U.fmt.mass(sg.v) + '"></i>').join('') + '</div>' +
        '<div class="odc-legend">' + segs.map((sg) => '<span><span><i class="sw" style="background:' + MASS_COLORS[sg.k] + '"></i>' + MASS_LABEL[sg.k] + '</span><em>' + U.fmt.mass(sg.v) + '</em></span>').join('') + '</div></div>';
      // power
      const pr = a.power.ratio;
      h += '<div class="odc-sec"><h4 data-tip="odc_power">Power</h4><div class="odc-kv"><span class="k">Fittings firing</span><span class="v ' + (pr > 1 ? 'crit' : pr > 0.85 ? 'warn' : 'good') + '">' + U.fmt.power(a.power.draw) + ' of ' + U.fmt.power(d.reactorPower) + ' · ' + Math.round(pr * 100) + ' %</span></div>' +
        '<div class="odc-bar"><i style="width:' + Math.min(100, pr * 100).toFixed(1) + '%;background:' + (pr > 1 ? 'var(--crit, #ff6b6b)' : 'linear-gradient(90deg, #8f7ce6, #b8aaff)') + '"></i>' + (pr > 1 ? '<b style="left:' + (100 / pr).toFixed(1) + '%"></b>' : '') + '</div></div>';
      // heat
      h += '<div class="odc-sec"><h4 data-tip="odc_heat">Heat</h4><div class="odc-heat">' + a.heat.map((r) => '<div class="hr"><span class="k">' + r.label + '</span><span class="v ' + (r.net <= 0 ? 'good' : r.saturate < 300 ? 'crit' : r.saturate < 1200 ? 'warn' : '') + '">' + (r.net <= 0 ? (r.settle != null ? 'settles at ' + Math.round(r.settle * 100) + ' %' : 'steady') : 'sink full in ' + U.fmt.time(r.saturate)) + '</span><span class="m"><span>' + U.fmt.power(r.in) + ' made</span> · <span>' + U.fmt.power(r.out) + ' radiated</span>' + (r.start > 0.01 ? ' · <span>from ' + Math.round(r.start * 100) + ' %</span>' : '') + '</span></div>').join('') + '</div></div>';
      // moving
      h += '<div class="odc-sec"><h4 data-tip="odc_dash">Moving</h4><div class="odc-kv">' +
        '<span class="k">' + U.fmt.dist(DASH) + ' dash</span><span class="v">' + U.fmt.time(a.dash.time) + ' · ' + U.fmt.dv(a.dash.dv) + '</span>' +
        '<span class="k">Dashes per tank</span><span class="v ' + cls3(a.dash.count, 3, 1.5) + '">' + a.dash.count.toFixed(1) + '</span>' +
        '<span class="k">Peak speed there</span><span class="v">' + U.fmt.speed(a.dash.peakV) + '</span>' +
        '<span class="k" data-tip="odc_turn">180° turn</span><span class="v">' + U.fmt.time(a.turn180) + '</span>' +
        '<span class="k">Full burn to empty</span><span class="v">' + U.fmt.time(a.burnTime) + '</span>' +
        '<span class="k">Hull</span><span class="v">' + d.length + ' m · ' + d.beam + ' m beam</span></div></div>';
      // reach
      const grouped = [];
      for (const r of a.reach) { const g = grouped.find((x) => x.text === r.text && x.kind === r.kind); if (g) { g.n++; g.names.push(r.name); } else grouped.push({ kind: r.kind, text: r.text, n: 1, names: [r.name] }); }
      const gname = (g) => (g.n === 1 ? g.names[0] : g.names[0].replace(/ (?:[A-Z]|\d+)$/, '') + ' ×' + g.n);
      h += '<div class="odc-sec" data-adv><h4 data-tip="odc_reach">Reach</h4><div class="odc-reach">' + (grouped.length ? grouped.map((r) => '<div><b>' + esc(gname(r)) + '</b><span>' + esc(r.text) + '</span></div>').join('') : '<div><span>Nothing fitted.</span></div>') + '</div></div>';
      // armour, and against the stock hull: carried under the picture in the middle column (odc-more)
      let m = '';
      const mx = Math.max(1, d.armour.nose, d.armour.flank, d.armour.tail);
      const fillA = (cm) => 'rgba(214,220,228,' + (0.12 + 0.7 * (cm / mx)).toFixed(2) + ')';
      m += '<div class="odc-sec"><h4 data-tip="odc_facing">Armour</h4><div class="odc-facing"><svg viewBox="0 0 96 48" aria-hidden="true"><polygon points="4,14 20,14 20,34 4,34" style="fill:' + fillA(d.armour.tail) + '"/><polygon points="20,10 64,10 64,38 20,38" style="fill:' + fillA(d.armour.flank) + '"/><polygon points="64,12 92,24 64,36" style="fill:' + fillA(d.armour.nose) + '"/></svg>' +
        '<div class="odc-kv"><span class="k">Nose</span><span class="v">' + d.armour.nose + ' cm</span><span class="k">Flank</span><span class="v">' + d.armour.flank + ' cm</span><span class="k">Tail</span><span class="v">' + d.armour.tail + ' cm</span><span class="k">Armour mass</span><span class="v">' + U.fmt.mass(d.masses.armour) + '</span></div></div></div>';
      // against stock
      const row = (k, v1, v2) => '<tr><td>' + k + '</td><td>' + v1 + '</td><td>' + v2 + '</td></tr>';
      m += '<div class="odc-sec" data-adv><h4 data-tip="odc_compare">Against the stock ' + esc(CLASSES()[d.base].name.split('-')[0]) + '</h4><table class="odc-cmp"><tr><th>Measure</th><th>This</th><th>Stock</th></tr>' +
        row('Delta-v', U.fmt.dv(a.dv), U.fmt.dv(as.dv)) + row('Acceleration', a.g.toFixed(2) + ' g', as.g.toFixed(2) + ' g') + row('Loaded mass', U.fmt.mass(a.mass), U.fmt.mass(as.mass)) + row('Heat shed', U.fmt.power(a.heatOut), U.fmt.power(as.heatOut)) +
        row('Full burn, sink full', a.heat[1].net <= 0 ? 'never' : U.fmt.time(a.heat[1].saturate), as.heat[1].net <= 0 ? 'never' : U.fmt.time(as.heat[1].saturate)) + row('180° turn', U.fmt.time(a.turn180), U.fmt.time(as.turn180)) + row('Fittings', d.comps.length + ' · ' + U.fmt.power(a.power.draw), s.comps.length + ' · ' + U.fmt.power(as.power.draw)) + row('Cost', a.cost + ' rp', as.cost + ' rp') + '</table></div>';
      return [h, m];
    }
    function renderReadout() { const r = readoutHTML(); readoutEl.innerHTML = r[0]; moreEl.innerHTML = r[1]; }
    function renderIssues() {
      const a = analyse(design);
      const advice = (t) => (detail === 'essentials' ? t.replace('Fix it with more radiator area, a bigger sink or a smaller drive.', 'Fix it with more radiator area or a smaller drive. The heat sink slider is under Full.') : t);
      // while Delete is armed, the line beside the keys says what it deletes: on a phone the engineer's box is a screen away
      issuesEl.innerHTML = delNote ? '<div class="odc-issue block">' + esc(delNote) + '</div>'
        : a.issues.length ? a.issues.map((i) => '<div class="odc-issue ' + i.level + '">' + esc(advice(i.text)) + '</div>').join('') : '<div class="odc-issue note">Flight-ready. ' + esc(design.blurb) + '</div>';
      const fly = $('[data-act="fly"]');
      if (fly) { fly.disabled = a.blocked; fly.title = a.blocked ? 'Fix the power budget first' : ''; }
      const del = $('[data-act="delete"]'); if (del) del.disabled = !saved;
    }
    // the name field is as wide as the name, so "-class frigate" follows it the way the words are said
    let nameCtx = null;
    function sizeName() {
      const inp = $('.odc-nameinput'); if (!inp) return;
      const cs = getComputedStyle(inp);
      nameCtx = nameCtx || document.createElement('canvas').getContext('2d');
      nameCtx.font = cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
      const text = inp.value || 'W', ls = parseFloat(cs.letterSpacing) || 0;
      inp.style.width = Math.ceil(nameCtx.measureText(text).width + ls * text.length + 5) + 'px';
    }
    function renderHeader() {
      $('.odc-nameinput').value = params.name;
      sizeName();
      $('.odc-cls').textContent = '-class ' + CLASSES()[params.base].role;
      const pill = $('.odc-state-pill');
      pill.textContent = dirty ? 'unsaved' : saved ? 'saved' : 'new';
      pill.className = 'odc-pill odc-state-pill' + (dirty ? ' warn' : '');
      $$('.odc-hulls button').forEach((b) => b.classList.toggle('active', b.dataset.base === params.base));
      $$('.odc-detail button').forEach((b) => b.classList.toggle('active', b.dataset.detail === detail));
      $$('.odc-views button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
      const sel = $('.odc-saved'); if (sel && sel.value !== (saved ? id : '')) sel.value = saved && sel.querySelector('option[value="' + id + '"]') ? id : '';
    }
    // only after a save, a delete or a load: the list does not change while sliders move
    function refreshSaved() {
      const sel = $('.odc-saved'); if (!sel) return;
      const all = records();
      sel.innerHTML = '<option value="">' + (all.length ? all.length + ' saved design' + (all.length > 1 ? 's' : '') + '…' : 'No saved designs') + '</option>' + all.map((r) => '<option value="' + esc(r.id) + '"' + (r.id === id && saved ? ' selected' : '') + '>' + esc(r.name) + '</option>').join('');
    }
    // a number keeps its unit on its line ("2.5 MW", "36 %"): the space between them does not break
    const KEEP_UNIT = /(\d) (?=(?:%|kt|kg|km\/s|m\/s|km|cm|m²|[kMG]?[WJN]|[tmsKg])(?![\w²]))/g;
    function say(text, tone) { sayLine.textContent = text.replace(KEEP_UNIT, '$1\u00a0'); sayEl.dataset.tone = tone || ''; }
    function toast(text) {
      let t = $('.odc-toast');
      if (!t) { t = document.createElement('div'); t.className = 'odc-toast'; root.appendChild(t); }
      t.textContent = text; t.hidden = false;
      clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
    }

    // ---------------------------------------------------------------- the picture
    let artOk = null;
    function setKey(text) { const k = $('.odc-key'); if (!k) return; k.textContent = text; k.hidden = !text; }
    function scheduleDraw() { if (!raf && !destroyed) raf = requestAnimationFrame(drawStage); }
    function drawStage() {
      raf = 0;
      if (destroyed) return;
      const rect = canvas.getBoundingClientRect();
      const W = Math.max(300, Math.round(rect.width || canvas.parentNode.clientWidth || 640));
      const H = Math.max(180, Math.round(rect.height && rect.width ? rect.height * (W / rect.width) : W * 10 / 16));
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const st = { radiators: pose.radiators, throttle: pose.throttle, heat: pose.heat, faction, prop: 1 };
      const cap = $('.odc-caption');
      if (view !== 'blueprint') {
        const t = (performance.now() - t0) / 1000;
        const A = OD.ShipArt, base = A && A.VIEWS && A.VIEWS[view];
        const viewArg = pose.spin && base ? { az: base.az + t * 18, el: base.el } : view;
        // the part labels take a band above and below the hull; the hull fills what is left of the box
        const labelsOn = !!(pose.labels && detail === 'full');
        const box = artBox(viewArg);
        const plan = labelsOn && box ? calloutPlan(ctx, W, viewArg, box) : null;
        const capH = 22, pad = 12;
        const top = pad + (plan ? plan.bandTop : 0), bottom = H - capH - (plan ? plan.bandBottom : 0);
        let o = null;
        if (box) {
          const k = Math.min((W - 2 * pad) / (box.maxX - box.minX), Math.max(20, bottom - top) / (box.maxY - box.minY));
          o = { x: W / 2 - ((box.minX + box.maxX) / 2) * k, y: (top + bottom) / 2 - ((box.minY + box.maxY) / 2) * k, size: ART_PROBE * k };
        } else o = { x: W / 2, y: H / 2, size: Math.min(W * 0.72, H * 1.6) };
        Object.assign(o, { view: viewArg, faction, light: { az: -50, el: 35 }, state: { radiators: pose.radiators, throttle: pose.throttle, heat: pose.heat }, plume: true, time: t, cache: !pose.spin });
        ctx.save();
        const ok = drawArt(ctx, design, o);
        if (ok) {
          ctx.restore();
          if (plan) drawCallouts(ctx, W, o, plan, top, bottom);
          cap.textContent = 'RENDERED · ' + (VIEW_NAME[view] || view).toUpperCase() + ' · ' + design.length + ' m'; artOk = true; setKey('');
          if (pose.throttle > 0 || pose.spin) scheduleDraw();
          return;
        }
        artOk = false;
        for (let i = 0; i < 24; i++) ctx.restore();   // unwind whatever the art module left on the stack
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
        drawBlueprint(ctx, W, H, design, st, root, { caption: false });
        cap.textContent = 'Blueprint shown. The rendered ' + (VIEW_NAME[view] || view) + ' view needs the ship-art module.'; setKey('');
        return;
      }
      const bp = drawBlueprint(ctx, W, H, design, st, root, {});
      cap.textContent = '';
      setKey(bp && !bp.keyDrawn && bp.key.length ? bp.key.join(' · ') : '');
    }
    // The picture's extent around the ship's origin at a probe size: the hull with its radiators as posed, no
    // plume. With the orbit camera on it is the extent over a full turn, so the hull keeps one size as it turns.
    const ART_PROBE = 120;
    let boxKey = '', boxVal = null;
    function artBox(viewArg) {
      const A = OD.ShipArt;
      if (!A || typeof A.bounds !== 'function') return null;
      const spin = typeof viewArg === 'object';
      const key = design.id + '@' + design.rev + '|' + (spin ? 'orbit:' + view : view) + '|' + pose.radiators;
      if (key === boxKey) return boxVal;
      const views = spin ? [0, 45, 90, 135, 180, 225, 270, 315].map((az) => ({ az, el: viewArg.el })) : [viewArg];
      let b = null;
      try {
        for (const v of views) {
          const r = A.bounds(design, { size: ART_PROBE, view: v, faction, state: { radiators: pose.radiators }, quality: 'low' });
          if (!r || !(r.w > 0) || !(r.h > 0)) continue;
          const e = { minX: -r.ox, maxX: r.w - r.ox, minY: -r.oy, maxY: r.h - r.oy };
          b = b ? { minX: Math.min(b.minX, e.minX), maxX: Math.max(b.maxX, e.maxX), minY: Math.min(b.minY, e.minY), maxY: Math.max(b.maxY, e.maxY) } : e;
        }
      } catch (e) { b = null; }
      boxKey = key; boxVal = b;
      return b;
    }
    // the art module names parts its own way; the yard shows them under the names the fittings list uses
    function yardLabel(c) {
      const comps = design.comps;
      const named = (g) => { const cs = comps.filter((x) => x.group === g); return cs.length ? cs[0].label + (cs.length > 1 ? ' ×' + cs.length : '') : null; };
      switch (c.label) {
        case 'Beam turrets': return named('turret') || c.label;
        case 'Rail pair': return named('rail') || c.label;
        case 'Spinal beam': return named('spinal') || c.label;
        case 'Point defence': return named('pd') || c.label;
        case 'Launch cells': { const n = comps.filter((x) => x.group === 'bay').reduce((t, x) => t + (CAT[x.catId].count || 0), 0); return n ? 'Interceptors ×' + n : c.label; }
        case 'Armour cap': return 'Nose armour ' + design.armour.nose + ' cm';
        case 'Propellant tanks': return design.summary.tanks + (design.summary.tanks > 1 ? ' tanks · ' : ' tank · ') + U.fmt.mass(design.propMass);
        case 'Radiators': return 'Radiators ' + U.fmt.num(design.radiatorArea, 3) + ' m²';
        case 'Reactor': return 'Reactor ' + U.fmt.power(design.reactorPower);
        case 'Drive': return 'Drive ' + U.fmt.si(design.thrust, 'N');
        default: return c.label;
      }
    }
    // Part labels go in rows above and below the hull, each on a leader to its part: the parts in the upper
    // half of the picture label upward, the rest downward. The plan measures the labels and counts the rows.
    const CALL_ROW = 13;
    function calloutPlan(ctx, W, viewArg, box) {
      let list = [];
      try { list = (OD.ShipArt.callouts(design, { size: ART_PROBE, view: viewArg }) || []).map((c) => { const label = yardLabel(c); return { label, own: label !== c.label || c.label === 'Radiators', x: c.x, y: c.y }; }); } catch (e) { list = []; }
      if (!list.length) return null;
      const mono = cssVar(root, '--mono', '') || 'ui-monospace, Menlo, monospace';
      const font = (W < 400 ? '10px ' : '10.5px ') + mono;
      ctx.save(); ctx.font = font;
      for (const c of list) c.w = Math.ceil(ctx.measureText(c.label).width);
      ctx.restore();
      // under 480 px only the parts the yard's choices set are labelled (drive, tanks, radiators, reactor, armour
      // and the fittings); the structure names are left to the wider screen
      if (W < 480) list = list.filter((c) => c.own);
      // the upper parts label upward and the lower ones downward, split where both bands carry the same width of text
      list.sort((a, c) => a.y - c.y);
      const total = list.reduce((s, c) => s + c.w, 0);
      let cut = 0, run = 0, best = Infinity;
      for (let i = 0; i <= list.length; i++) { const d = Math.abs(total - 2 * run); if (d < best) { best = d; cut = i; } if (i < list.length) run += list[i].w; }
      const up = list.slice(0, cut), down = list.slice(cut);
      for (const c of up) c.band = 0; for (const c of down) c.band = 1;
      const rowsFor = (items) => (items.length ? Math.min(4, Math.ceil((items.reduce((s, c) => s + c.w + 14, 0) / (W - 8)) * 1.2)) : 0);
      let rowsUp = rowsFor(up), rowsDown = rowsFor(down);
      if (typeof viewArg === 'object') rowsUp = rowsDown = Math.max(rowsFor(list.slice(0, Math.ceil(list.length / 2))), rowsFor(list), 1);   // turning: parts cross from one band to the other
      const band = (n) => (n ? n * CALL_ROW + 10 : 0);
      return { list, font, rowsUp, rowsDown, bandTop: band(rowsUp), bandBottom: band(rowsDown) };
    }
    function drawCallouts(ctx, W, o, plan, top, bottom) {
      const k = o.size / ART_PROBE;
      const pts = plan.list.map((c) => ({ label: c.label, w: c.w, band: c.band, px: o.x + c.x * k, py: o.y + c.y * k }));
      const bands = [
        { items: pts.filter((p) => p.band === 0), rows: plan.rowsUp, y0: top - 6 - 4, dir: -1 },
        { items: pts.filter((p) => p.band === 1), rows: plan.rowsDown, y0: bottom + 6 + 4, dir: 1 },
      ];
      // a band with no rows hands its labels to the other
      if (!bands[0].rows) { bands[1].items = pts; bands[0].items = []; } else if (!bands[1].rows) { bands[0].items = pts; bands[1].items = []; }
      const placed = [];
      for (const b of bands) {
        const rows = Array.from({ length: b.rows }, () => []);
        b.items.sort((a, c) => a.px - c.px);
        for (const it of b.items) {
          const want = Math.min(W - 4 - it.w, Math.max(4, it.px - it.w / 2));
          let best = null;
          rows.forEach((row, r) => {
            // free stretches of this row, and the spot in them nearest the part
            const taken = row.slice().sort((a, c) => a[0] - c[0]);
            let from = 4;
            for (let i = 0; i <= taken.length; i++) {
              const to = i < taken.length ? taken[i][0] - 10 : W - 4;
              if (to - from >= it.w) {
                const x = Math.min(to - it.w, Math.max(from, want));
                const cost = Math.abs(x - want) + r * 28;
                if (!best || cost < best.cost) best = { cost, r, x };
              }
              if (i < taken.length) from = taken[i][1] + 10;
            }
          });
          if (!best) continue;   // no room left in the band: the label is left out rather than printed over another
          rows[best.r].push([best.x, best.x + it.w]);
          placed.push({ it, x: best.x, y: b.y0 + b.dir * best.r * CALL_ROW, dir: b.dir });
        }
      }
      ctx.save(); ctx.font = plan.font; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
      ctx.strokeStyle = 'rgba(180,192,207,0.35)'; ctx.lineWidth = 1; ctx.beginPath();
      for (const p of placed) { const ax = Math.min(p.x + p.it.w - 2, Math.max(p.x + 2, p.it.px)); ctx.moveTo(p.it.px, p.it.py); ctx.lineTo(ax, p.y - p.dir * 6); }
      ctx.stroke();
      ctx.fillStyle = 'rgba(180,192,207,0.6)';
      for (const p of placed) { ctx.beginPath(); ctx.arc(p.it.px, p.it.py, 1.8, 0, Math.PI * 2); ctx.fill(); }
      const ink2 = cssVar(root, '--ink-2', '#b1bfce');
      ctx.lineJoin = 'round'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(4,7,12,0.85)'; ctx.fillStyle = ink2;
      for (const p of placed) { ctx.strokeText(p.it.label, p.x, p.y); ctx.fillText(p.it.label, p.x, p.y); }
      ctx.restore();
    }

    // ---------------------------------------------------------------- changes
    function afterChange(control, before) {
      design = derive(params, id);
      dirty = true;
      const a = analyse(design);
      say(explain(control, before, design), a.blocked ? 'crit' : a.issues.some((i) => i.level === 'warn') ? 'warn' : '');
      syncControls(); renderReadout(); renderIssues(); renderHeader(); scheduleDraw();
    }
    function setBase(base) {
      if (!BASES[base] || base === params.base) return;
      const before = design, name = params.name;
      params = presetParams(base); params.name = name;
      design = derive(params, id); dirty = true;
      buildControls();
      say(explain('base', before, design), '');
      renderReadout(); renderIssues(); renderHeader(); scheduleDraw();
    }
    function refreshAll(sentence, tone) {
      buildControls(); renderReadout(); renderIssues(); refreshSaved(); renderHeader(); scheduleDraw();
      if (sentence) say(sentence, tone || '');
    }

    listen('input', (e) => {
      const t = e.target;
      if (t.matches('[data-ctl]')) {
        const c = CONTROLS.find((x) => x.id === t.dataset.ctl); if (!c) return;
        const stock = CLASSES()[params.base];
        let v = c.rel ? +t.value * stock[c.rel] : +t.value;
        if (ROUND[c.id]) v = roundTo(v, ROUND[c.id]);
        const before = design; c.set(params, v); afterChange(c.id, before);
      } else if (t.matches('[data-slot]')) {
        const key = t.dataset.slot, g = t.dataset.group, i = +key.slice(g.length);
        if ((t.value || null) === (params.slots[g][i] || null)) return;   // the same choice again: nothing moves
        const before = design; params.slots[g][i] = t.value || null; params.names = {}; afterChange('slot:' + key, before);
      } else if (t.matches('[data-look]')) {
        const before = design; params.look = params.look || {}; params.look[t.dataset.look] = t.value; afterChange('look', before);
      } else if (t.matches('.odc-nameinput')) {
        params.name = t.value.trim().slice(0, 24) || params.name; design = derive(params, id); dirty = true; sizeName(); $('.odc-cls').textContent = '-class ' + CLASSES()[params.base].role; renderIssues();
        const pill = $('.odc-state-pill'); pill.textContent = 'unsaved'; pill.className = 'odc-pill odc-state-pill warn';
      } else if (t.matches('[data-pose]')) {
        const k = t.dataset.pose;
        pose[k] = t.type === 'checkbox' ? (t.checked ? 1 : 0) : +t.value;
        if (k === 'spin' && OD.ShipArt && OD.ShipArt.clearCache) OD.ShipArt.clearCache();
        scheduleDraw();
      }
    });
    // Delete asks once: the first press arms the key and says what goes, a second press within five seconds deletes
    // what the second press takes: the design, and the campaign ships built to it (the campaign strikes them off)
    function deleteNote() {
      let built = null;
      try { const st = OD.Campaign && typeof OD.Campaign.load === 'function' ? OD.Campaign.load() : null; if (OD.Campaign) built = st && st.fleet ? st.fleet.filter((f) => f.cls === id) : []; } catch (e) { built = null; }
      const what = built == null ? ' and every campaign ship built to it'
        : built.length === 1 ? ' and ' + built[0].name + ', the campaign ship built to it'
        : built.length > 1 ? ' and the ' + built.length + ' campaign ships built to it' : '';
      const rec = records().find((r) => r.id === id);   // the saved name, which an edit in the name field has not changed yet
      const name = rec ? rec.name + '-class ' + CLASSES()[rec.base].role : design.name;
      return 'This deletes the ' + name + what + '. Press Confirm delete within 5 s.';
    }
    function disarmDelete() {
      clearTimeout(delArmed); delArmed = 0;
      const d = $('[data-act="delete"]'); if (d) { d.textContent = 'Delete'; d.classList.remove('armed'); }
      // both lines go back to what they said before the key was armed (the engineer's only if nothing has spoken since)
      if (!delNote) return;
      if (delSaid && sayLine.textContent === delSaid.shown) { sayLine.textContent = delSaid.text; sayEl.dataset.tone = delSaid.tone; }
      delNote = ''; delSaid = null;
      if (!destroyed) renderIssues();
    }
    listen('change', (e) => {
      if (delArmed) disarmDelete();
      const t = e.target;
      if (t.matches('.odc-saved')) { if (t.value && loadDesign(t.value)) refreshAll('Loaded ' + design.name + ': ' + design.blurb); }
      else if (t.matches('.odc-nameinput')) { params.name = normaliseParams(params).name; design = derive(params, id); renderHeader(); }
    });
    listen('click', (e) => {
      const b = e.target.closest('button'); if (!b || !root.contains(b)) return;
      if (delArmed && b.dataset.act !== 'delete') disarmDelete();
      if (b.dataset.base) { setBase(b.dataset.base); return; }
      if (b.dataset.detail) { detail = b.dataset.detail; root.dataset.detail = detail; try { localStorage.setItem('od.detail', detail); } catch (e) { /* per-viewer only */ } renderHeader(); renderIssues(); scheduleDraw(); return; }
      if (b.dataset.view) { view = b.dataset.view; renderHeader(); scheduleDraw(); return; }
      const act = b.dataset.act;
      if (act === 'preset') { const before = design, name = params.name; params = presetParams(params.base); params.name = name; design = derive(params, id); dirty = true; syncControls(); renderReadout(); renderIssues(); renderHeader(); scheduleDraw(); say(explain('preset', before, design), ''); }
      else if (act === 'random') { const before = design; randomise(); afterChange('random', before); say('A random fit on the ' + CLASSES()[params.base].name + '. ' + explain('random', before, design), ''); }
      else if (act === 'save') { doSave(false); }
      else if (act === 'saveas') { doSave(true); }
      else if (act === 'delete') {
        if (!saved) return;
        if (!delArmed) {
          b.textContent = 'Confirm delete'; b.classList.add('armed');
          delNote = deleteNote().replace(KEEP_UNIT, '$1\u00a0'); delSaid = { text: sayLine.textContent, tone: sayEl.dataset.tone || '' };
          say(delNote, 'crit'); delSaid.shown = sayLine.textContent; renderIssues();
          delArmed = setTimeout(disarmDelete, 5000); return;
        }
        disarmDelete(); remove(id); const rest = records(); if (!(rest.length && loadDesign(rest[0].id))) { freshDesign(params.base); refreshSaved(); } refreshAll('Deleted. ' + (saved ? 'Now showing ' + design.name + '.' : 'A fresh ' + CLASSES()[params.base].name + '.')); toast('Design deleted'); }
      else if (act === 'fly') { const a = analyse(design); if (a.blocked) { toast(a.issues.find((i) => i.level === 'block').text); return; } doSave(false, true); const sc = flyScenario(design, { faction }); if (options.onFly) options.onFly(design, sc); }
      else if (act === 'copy') { const code = JSON.stringify({ odc: 1, params: normaliseParams(params) }); const done = () => toast('Design code copied'); if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(code).then(done, () => window.prompt('Copy this design code:', code)); else window.prompt('Copy this design code:', code); }
      else if (act === 'paste') { const s = window.prompt('Paste a design code:'); if (!s) return; try { const o = JSON.parse(s); const p = normaliseParams(o.params || o); const before = design; params = p; design = derive(params, id); dirty = true; buildControls(); renderReadout(); renderIssues(); renderHeader(); scheduleDraw(); say('Design code loaded. ' + explain('paste', before, design), ''); } catch (err) { toast('That is not a design code.'); } }
      else if (act === 'back') { if (options.onBack) options.onBack(); }
    });
    function doSave(asNew, quiet) {
      if (asNew) { id = newId(); design = derive(params, id); }
      if (!save(design)) { register(design); renderHeader(); toast('Could not save. This browser blocks storage, or the store is full. The design still flies this session.'); return false; }
      saved = true; dirty = false;
      refreshSaved(); renderHeader(); renderIssues();
      if (!quiet) toast('Saved ' + design.name);
      if (options.onSave) options.onSave(design);
      return true;
    }
    function randomise() {
      const stock = CLASSES()[params.base];
      const r = (a, b) => a + Math.random() * (b - a);
      params.thrust = roundTo(stock.thrust * r(0.5, 2.0), ROUND.thrust); params.ve = roundTo(r(40e3, 65e3), 1e3); params.prop = roundTo(stock.propMass * r(0.4, 2.0), ROUND.prop);
      params.radiator = roundTo(stock.radiatorArea * r(0.5, 2.5), ROUND.radiator); params.sink = roundTo(stock.sinkCapacity * r(0.6, 2.2), ROUND.sink);
      params.armour = { nose: Math.round(stock.armour.nose * r(0.3, 2.2)), flank: Math.round(stock.armour.flank * r(0.3, 2.2)), tail: Math.round(stock.armour.tail * r(0.3, 2.2)) };
      for (const g of GROUPS) params.slots[g] = params.slots[g].map(() => { const opts = catForSlot(g); return Math.random() < 0.7 ? opts[Math.floor(Math.random() * opts.length)].id : null; });
      params.names = {};
      // size the reactor to what the fittings ask for, with a margin, so the surprise is flight-ready
      const draw = fittings(params).comps.reduce((a, c) => a + c.draw, 0);
      params.reactor = roundTo(clamp(Math.max(stock.reactorPower * 0.6, draw * r(1.05, 1.4)), stock.reactorPower * 0.5, stock.reactorPower * 3), ROUND.reactor);
    }

    // ---------------------------------------------------------------- go
    function fitWidth() { const w = root.clientWidth || (root.getBoundingClientRect().width | 0) || 1200; root.classList.toggle('odc-narrow', w < 720); root.classList.toggle('odc-mid', w >= 720 && w < 1140); }
    fitWidth();
    if (typeof ResizeObserver === 'function') { resizeObs = new ResizeObserver(() => { fitWidth(); sizeName(); scheduleDraw(); }); resizeObs.observe(root); resizeObs.observe(canvas.parentNode); }
    else window.addEventListener('resize', () => { fitWidth(); scheduleDraw(); }, ac ? { signal: ac.signal } : false);
    if (artCanDraw(design)) view = 'threequarter';
    refreshAll();
    say((saved ? 'Loaded ' + design.name + '. ' : 'A new design on the ' + CLASSES()[params.base].name + '. ') + 'Every slider moves the numbers and the drawing. This line says what the change bought and what it cost. ' + design.blurb, '');
    $('.odc-artnote').textContent = artCanDraw(design) ? '' : 'Rendered views need the ship-art module. The blueprint is exact.';
    // the display face may arrive after the first paint: measure the name again, and draw again with it
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (!destroyed) { sizeName(); scheduleDraw(); } });

    const ctl = {
      design: () => design,
      params: () => deep(params),
      load: (did) => { if (loadDesign(did)) { refreshAll('Loaded ' + design.name + '.'); return true; } return false; },
      set: (p) => { params = normaliseParams(p); design = derive(params, id); dirty = true; refreshAll(); },
      analyse: () => analyse(design),
      pose: (p) => { Object.assign(pose, p || {}); scheduleDraw(); },
      view: (v) => { view = v; renderHeader(); scheduleDraw(); },
      draw: () => drawStage(),
      destroy: () => { destroyed = true; clearTimeout(delArmed); if (ac) ac.abort(); if (raf) cancelAnimationFrame(raf); if (resizeObs) resizeObs.disconnect(); clearTimeout(toastTimer); if (tipEl) tipEl.hidden = true; root.innerHTML = ''; root.classList.remove('odc', 'odc-mid', 'odc-narrow'); if (root._odc === ctl) delete root._odc; },
    };
    root._odc = ctl;
    return ctl;
  }

  OD.Configurator = {
    version: 1,
    mount, derive, analyse, explain, presetParams, normaliseParams, stockDesign,
    register, unregister, installSaved, list, records, get, save, remove,
    toSpec, flyScenario, cost, testFlight, reach,
    drawBlueprint, layout,
    CATALOGUE: CAT, BASES, GROUPS, LOOK, TIPS, K,
    STORAGE_KEY: KEY,
  };
})();
