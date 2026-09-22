/* Orbital Declaration — component damage: what a hit actually takes out of a hull.

   A ship is not one bar. It is a drive on the tail, a reactor behind the frames, a sensor suite in
   the nose, radiator panels hung out on the flanks, propellant tanks and one entry for every mount.
   Energy past the armour opens hull integrity exactly as before, and then lands on one of those
   parts: whichever the showing facet exposes, weighted by how much of it is out there and by where
   the shooter was aiming. Everything the rest of the game reads — systems.drive, systems.radiators,
   systems.sensors, systems.weapons, powerCap, mountHp — is recomputed from the parts, so a lost
   panel is a quarter of the cooling and a holed tank is delta-v going out through the hole. */
(function () {
  'use strict';
  const OD = window.OD;
  const U = OD.U;

  // ------------------------------------------------------------------ tuning
  const T = {
    hullJoules: 1400,   // J per kg of dry mass to open a hull from 1.0 to 0 (as before)
    systemShare: 0.22,  // a component fails after this fraction of the hull budget (as before)
    facetShare: 1 / 3,  // a facet is marked up completely after this fraction of the hull budget
    aimBias: 6,         // × the weight of a part the shooter was aiming at
    radOut: 2.6,        // deployed panels are enormous and thin
    radStowed: 0.12,    // stowed, there is almost nothing to shoot
    ventRate: 0.005,    // of a holed tank's share per second, at hp 0
    ventFxGap: 0.6,     // s between puffs behind a venting hull
    breachMark: 0.5,    // facet mark-up past this and a party works that part in suits
    breachWork: 1.5,    // × the repair time when it does
  };
  const FACETS = ['nose', 'flank', 'tail'];
  // Radiator farms by hull; custom hulls fall back to their radiator area.
  const PANELS = { corvette: 2, frigate: 2, lancer: 2, freighter: 2, destroyer: 4, cruiser: 4, station: 6 };
  const MOUNT_ID = { beam: 'beam', coilgun: 'coil', launcher: 'bay', pd: 'pd' };
  const WEAPON_KIND = { beam: true, coilgun: true, launcher: true, pd: false };
  // Relative exposure: roughly the share of the hull each part takes up on the facets it shows on.
  const AREA = { drive: 0.30, reactor: 0.14, sensors: 0.07, radiator: 0.09, tank: 0.10, mount: 0.05 };
  // Jury-rig in vacuum: a party gets part of a hurt part back, never all of it. `wrecked` is the
  // ceiling from nothing, `damaged` the ceiling from anything still standing, `work` the seconds
  // of base work. A tank is its own case (isolate a venting one, beat the dent out of a sound one).
  const JURY = {
    drive:    { wrecked: 0.30, damaged: 0.70, work: 240 },
    reactor:  { wrecked: 0.25, damaged: 0.60, work: 210 },
    sensors:  { wrecked: 0.50, damaged: 0.80, work: 150 },
    radiator: { wrecked: 0,    damaged: 0.70, work: 120 },
    tank:     { wrecked: 0.50, damaged: 1,    work: 60 },
    mount:    { wrecked: 0,    damaged: 0.80, work: 120 },
  };

  function panelCount(cls) {
    const n = PANELS[cls.id] || PANELS[cls.base];
    if (n) return n;
    const a = cls.radiatorArea || 0;
    return a >= 5000 ? 6 : a >= 1500 ? 4 : 2;
  }
  function tankCount(propMass) { return propMass < 2000e3 ? 2 : propMass < 8000e3 ? 3 : 4; }
  function mountFacets(m) {
    if (m.arc === 'nose') return ['nose'];
    if (m.arc === 'turret') return ['nose', 'flank'];
    if (m.kind === 'launcher' || m.kind === 'pd') return ['flank'];
    return ['nose', 'flank']; // a coilgun runs the length of the ship
  }

  // A fleet record carries { id, hp } and nothing else, so the kind has to come back out of the id.
  const ID_KIND = { drive: 'drive', reactor: 'reactor', sensors: 'sensors', rad: 'radiator', tank: 'tank', beam: 'mount', coil: 'mount', bay: 'mount', pd: 'mount' };
  function kindOf(c) {
    if (c.kind) return c.kind;
    const m = /^[a-z]+/.exec(c.id || '');
    return (m && ID_KIND[m[0]]) || 'mount';
  }
  function isWeapon(c) {
    if (c.weapon != null) return !!c.weapon;
    return /^(beam|coil|bay)/.test(c.id || '');
  }
  // An interceptor bay launches interceptors out of its cells; every other mount fires. A report
  // row carries the id and the name but not the mount kind, so either one marks the bay.
  function isBay(c) {
    if (!c) return false;
    if (c.mountKind) return c.mountKind === 'launcher';
    return /^bay/.test(String(c.id || '')) || /interceptor bay/i.test(String(c.name || ''));
  }
  function byId(list, id) { return (list || []).find((c) => c.id === id) || null; }
  // Callers hand over an id or the part itself.
  function partOf(ship, ref) {
    if (!ref) return null;
    if (typeof ref === 'object') return ref;
    return byId(ship && ship.components, ref);
  }
  // A tank below half is holed and vents; a tank patched back to half stops, and a tank a party has
  // isolated stops for good. One predicate so the aggregate, the venting loop and the damage report
  // never disagree about which tanks are open.
  function isVenting(ship, c) {
    return kindOf(c) === 'tank' && !c.isolated && c.hp < 0.5 && c.share > 0 && (c.vented || 0) < c.share - 1e-6
      && (!ship || ship.propMass == null || ship.propMass > 0);
  }

  // ------------------------------------------------------------------ build
  function init(ship) {
    const cls = (OD.Ships.CLASSES && OD.Ships.CLASSES[ship.cls]) || {};
    const list = [];
    const add = (id, kind, name, facets, area, extra) => {
      list.push(Object.assign({ id, kind, name, hp: 1, facets, area }, extra || {}));
    };
    add('drive', 'drive', 'Drive', ['tail'], AREA.drive);
    add('reactor', 'reactor', 'Reactor', ['tail', 'flank'], AREA.reactor);
    add('sensors', 'sensors', 'Sensor suite', ['nose'], AREA.sensors);
    const panels = panelCount(cls);
    for (let i = 1; i <= panels; i++) add('rad' + i, 'radiator', 'Radiator panel ' + i, ['flank'], AREA.radiator, { panel: i, panels });
    const prop = ship.fullPropMass != null ? ship.fullPropMass : cls.propMass || 0;
    const tanks = prop > 0 ? tankCount(prop) : 0;
    for (let i = 1; i <= tanks; i++) add('tank' + i, 'tank', 'Tank ' + i, ['flank', 'tail'], AREA.tank, { tank: i, tanks, share: prop / tanks, vented: 0 });
    const ord = {};
    (ship.mounts || []).forEach((m, idx) => {
      const key = MOUNT_ID[m.kind] || 'mount';
      ord[key] = (ord[key] || 0) + 1;
      add(key + ord[key], 'mount', m.name || 'Mount ' + (idx + 1), mountFacets(m), AREA.mount,
        { mountIndex: idx, mountKind: m.kind, weapon: WEAPON_KIND[m.kind] === true });
    });
    ship.components = list;
    if (!ship.damage) ship.damage = { nose: 0, flank: 0, tail: 0 };
    adopt(ship); // an old save hands us aggregates, not parts: work back to the parts
    aggregate(ship);
    return list;
  }

  // Aggregates from a save with no component list: put the wear where it must have been.
  function adopt(ship) {
    const s = ship.systems || {};
    const list = ship.components;
    const drive = byId(list, 'drive');
    if (drive && s.drive != null && s.drive < 1) drive.hp = U.clamp(s.drive, 0, 1);
    const sen = byId(list, 'sensors');
    if (sen && s.sensors != null && s.sensors < 1) sen.hp = U.clamp(s.sensors, 0, 1);
    if (s.radiators != null && s.radiators < 1) for (const c of list) if (c.kind === 'radiator') c.hp = U.clamp(s.radiators, 0, 1);
    if (s.weapons != null && s.weapons < 1) limitWeapons(ship, s.weapons);
  }

  // ------------------------------------------------------------------ aggregates
  function aggregate(ship) {
    const list = ship.components || [];
    const sys = ship.systems || (ship.systems = { drive: 1, radiators: 1, sensors: 1, weapons: 1 });
    const drive = byId(list, 'drive');
    sys.drive = drive ? U.clamp(drive.hp, 0, 1) : 1;
    const sen = byId(list, 'sensors');
    sys.sensors = sen ? U.clamp(sen.hp, 0, 1) : 1;
    const panels = list.filter((c) => kindOf(c) === 'radiator');
    sys.radiators = panels.length ? U.clamp(panels.reduce((a, c) => a + U.clamp(c.hp, 0, 1), 0) / panels.length, 0, 1) : 1;
    // Display aggregate only: how much of the offensive rack still answers. Whether one mount
    // fires is ship.mountHp[mount index] below — point defence included — never this number.
    const guns = list.filter((c) => kindOf(c) === 'mount' && isWeapon(c));
    sys.weapons = guns.length ? guns.filter((c) => c.hp > 0).length / guns.length : 1;
    const rx = byId(list, 'reactor');
    const cap = 0.25 + 0.75 * (rx ? U.clamp(rx.hp, 0, 1) : 1);
    // A fleet record has no mounts and wants no extra fields in the save.
    if (Array.isArray(ship.mounts) || ship.powerCap != null) ship.powerCap = cap;
    if (Array.isArray(ship.mounts)) {
      const hp = ship.mounts.map(() => 1);
      for (const c of list) if (c.mountIndex != null) hp[c.mountIndex] = U.clamp(c.hp, 0, 1);
      ship.mountHp = hp;
    }
    if (Array.isArray(ship.mounts) || ship.venting != null) {
      ship.venting = list.some((c) => isVenting(ship, c));
    }
    if (Array.isArray(ship.mounts)) ship._dmgRev = (ship._dmgRev || 0) + 1; // report rebuilds on this
    return sys;
  }

  // Knock mounts out from the back of the rack until the weapons aggregate is down to `fraction`.
  function limitWeapons(shipLike, fraction) {
    const list = shipLike.components;
    if (!Array.isArray(list)) return false;
    const guns = list.filter((c) => kindOf(c) === 'mount' && isWeapon(c));
    if (!guns.length) return false;
    const keep = U.clamp(Math.round(U.clamp(fraction, 0, 1) * guns.length), 0, guns.length);
    let live = guns.filter((c) => c.hp > 0).length, did = false;
    for (let i = guns.length - 1; i >= 0 && live > keep; i--) {
      if (guns[i].hp > 0) { guns[i].hp = 0; live--; did = true; }
    }
    if (did) aggregate(shipLike);
    return did;
  }

  // ------------------------------------------------------------------ taking a hit
  // How much of this part the shooter can see on that facet. Panels only count while they are out.
  function exposure(ship, c, facet) {
    if (!c.facets || c.facets.indexOf(facet) < 0) return 0;
    let a = c.area || 0.05;
    if (c.kind === 'radiator') {
      const state = ship.radiators ? ship.radiators.state : 1;
      a *= T.radStowed + (T.radOut - T.radStowed) * U.clamp(state, 0, 1);
    }
    return a;
  }
  function aimBites(ship, c, facet, aim) {
    if (aim === 'radiators') return c.kind === 'radiator' && !!ship.radiators && ship.radiators.state > 0.5;
    if (aim === 'drive') return c.kind === 'drive' && facet === 'tail';
    if (aim === 'mounts') return c.kind === 'mount';
    return false; // 'hull' and anything unexposed: take what the facet offers, by area
  }
  function pick(sim, ship, facet, aim) {
    // Mount fire takes the rack apart one mount at a time: finish the one already hurt.
    if (aim === 'mounts') {
      const rack = ship.components.filter((c) => c.kind === 'mount' && c.hp > 0 && exposure(ship, c, facet) > 0);
      if (rack.length) return rack.reduce((a, c) => (c.hp < a.hp ? c : a), rack[0]);
    }
    let total = 0;
    const cands = [];
    for (const c of ship.components) {
      if (c.hp <= 0) continue;
      let w = exposure(ship, c, facet);
      if (w <= 0) continue;
      if (aimBites(ship, c, facet, aim)) w *= T.aimBias;
      cands.push({ c, w });
      total += w;
    }
    if (!(total > 0)) return null;
    const r = (sim && sim.eng && typeof sim.eng.rng === 'function' ? sim.eng.rng() : Math.random()) * total;
    let acc = 0;
    for (const e of cands) { acc += e.w; if (r <= acc) return e.c; }
    return cands[cands.length - 1].c;
  }

  function hit(sim, ship, opt) {
    opt = opt || {};
    // `component` is the part itself ({ id, kind, name, hp, ... }) so a caller can name it in a log.
    const out = { component: null, wrecked: false, hullLoss: 0, state: null };
    if (!ship || ship.destroyed) return out;
    const joules = +opt.joules;
    if (!(joules > 0)) return out;
    if (!ship.components) init(ship);
    const hullCap = Math.max(1, (ship.dryMass || 1) * T.hullJoules);
    out.hullLoss = joules / hullCap;
    ship.hull = U.clamp((ship.hull != null ? ship.hull : 1) - out.hullLoss, 0, 1);
    const facet = FACETS.indexOf(opt.facet) >= 0 ? opt.facet : 'flank';
    if (!ship.damage) ship.damage = { nose: 0, flank: 0, tail: 0 };
    ship.damage[facet] = U.clamp(ship.damage[facet] + joules / (hullCap * T.facetShare), 0, 1);
    const c = pick(sim, ship, facet, opt.aim);
    if (c) {
      const before = c.hp;
      c.hp = U.clamp(c.hp - joules / (hullCap * T.systemShare), 0, 1);
      out.component = c;
      out.wrecked = before > 0 && c.hp <= 0;
      out.state = stateOf(ship, c);
      report1(sim, ship, c, before);
      // The people at that part take the same hit. The crew module may not be aboard: never require it.
      const severity = U.clamp(before - c.hp, 0, 1);
      if (severity > 0 && OD.Crew && typeof OD.Crew.casualties === 'function') {
        try { OD.Crew.casualties(ship, c.id, severity); } catch (e) { /* damage stands either way */ }
      }
    }
    aggregate(ship);
    return out;
  }

  // One line the first time a part is hurt, one the first time it is gone.
  function report1(sim, ship, c, before) {
    if (!sim || !sim.addLog) return;
    // A tank that has just been holed has lost nothing yet, and the venting loop announces the
    // hole in the same second with the reason in it. Nothing is logged here until there is a
    // figure to log; the flags stay clear, so the first line with one still goes out.
    if (isVenting(ship, c) && !((c.vented || 0) > 0)) return;
    if (c.hp <= 0 && !c.wreckLogged) {
      c.wreckLogged = true; c.dmgLogged = true;
      sim.addLog(ship.name + ' — ' + effect(ship, c), 'Damage control', 'alert');
      return;
    }
    if (c.hp <= 0.5 && before > 0.5 && !c.dmgLogged) {
      c.dmgLogged = true;
      sim.addLog(ship.name + ' — ' + effect(ship, c), 'Damage control', 'warn');
    }
  }

  // ------------------------------------------------------------------ venting
  function update(sim, dt) {
    if (!sim || !(dt > 0)) return;
    for (const ship of sim.ships) {
      if (ship.destroyed || !ship.venting || !ship.components) continue;
      vent(sim, ship, dt);
    }
  }
  function vent(sim, ship, dt) {
    let venting = false, lost = 0;
    for (const c of ship.components) {
      if (!isVenting(ship, c)) continue; // patched to half or drained dry: nothing left to lose
      const left = c.share - c.vented;
      venting = true;
      if (!c.ventLogged) {
        c.ventLogged = true;
        // The figure and the cure, in the words the isolate line uses: what is going out of this
        // hole, and that a party valving the tank out of the feed is what stops it.
        const dv = ventingDv(ship, c);
        sim.addLog(ship.name + ' — ' + c.name + ' holed and venting: '
          + (dv > 0 ? U.fmt.dv(dv) + ' of delta-v going' : 'the last of its propellant is going')
          + ' out through the hole until a party valves it out of the feed.', 'Damage control', 'warn');
      }
      const amount = Math.min((1 - c.hp) * T.ventRate * c.share * dt, left, ship.propMass);
      if (amount > 0) { ship.propMass -= amount; c.vented += amount; lost += amount; }
    }
    if (lost > 0) { ship._dmgRev = (ship._dmgRev || 0) + 1; ventFx(sim, ship); }
    ship.venting = venting;
  }
  function ventFx(sim, ship) {
    if (sim.time - (ship._ventFx != null ? ship._ventFx : -1e9) < T.ventFxGap) return;
    ship._ventFx = sim.time;
    const back = U.fromAngle(ship.heading, -(ship.length || 60) * 0.5);
    for (let i = 0; i < 2; i++) {
      const a = ship.heading + Math.PI + (Math.random() - 0.5) * 1.0;
      const v = 25 + Math.random() * 55;
      sim.fx.push({
        x: ship.pos.x + back.x, y: ship.pos.y + back.y,
        vx: ship.vel.x + Math.cos(a) * v, vy: ship.vel.y + Math.sin(a) * v,
        life: 3 + Math.random() * 3, maxLife: 6, color: '#9fd8ff', size: 1 + Math.random(),
      });
    }
  }

  // ------------------------------------------------------------------ readouts
  function ventedDv(ship, c) {
    const ve = ship.exhaustVelocity || 1;
    const m = Math.max(1, (ship.dryMass || 0) + (ship.propMass || 0));
    return ve * Math.log((m + (c.vented || 0)) / m);
  }
  // What is still in a tank when a party shuts it: the rest of its share, and never more than the
  // ship has aboard. Shutting the hole means valving the tank out of the feed and pumping that
  // propellant into the others, so it stays in the ship's delta-v; only what went out is gone.
  function heldIn(ship, c) {
    const left = Math.max(0, (c.share || 0) - (c.vented || 0));
    const aboard = ship && ship.propMass != null ? Math.max(0, ship.propMass) : left;
    return Math.min(left, aboard);
  }
  // The delta-v still in a holed tank: what goes out through the hole if nobody valves the tank
  // out of the feed. ventedDv is what has already gone; this is what is left to lose.
  function ventingDv(ship, c) {
    const ve = ship.exhaustVelocity || 1;
    const m = Math.max(1, (ship.dryMass || 0) + (ship.propMass || 0));
    const dry = Math.max(1, ship.dryMass || 1);
    const left = U.clamp(heldIn(ship, c), 0, Math.max(0, m - dry));
    return left > 0 ? ve * Math.log(m / Math.max(dry, m - left)) : 0;
  }
  // The one sentence for an isolated tank, on the board and in the log: the work, what came across
  // with it, and what had already gone through the hole.
  function isolatedWords(ship, c) {
    const held = heldIn(ship, c);
    return c.name + ' valved out of the feed'
      + (held > 0 ? ' and its ' + U.fmt.mass(held) + ' pumped across' : '')
      + ': the venting has stopped'
      + ((c.vented || 0) > 0 ? ', ' + U.fmt.dv(ventedDv(ship, c)) + ' lost' : '');
  }
  // How far a jury-rig reaches on this kind: the ceiling a party gets a standing part back to.
  // One number for the state word and for the work, so 'damaged' means a party can still do
  // something and 'worn' means the part is past anything a party can do in vacuum.
  function reachOf(c) { return ((JURY[kindOf(c)] || JURY.mount).damaged); }
  function stateOf(ship, c) {
    // A tank a party has isolated reads isolated whatever its plating is down to.
    if (c.isolated && kindOf(c) === 'tank') return 'isolated';
    // A tank blown right out is venting fastest, so venting is read before wrecked.
    if (isVenting(ship, c)) return 'venting';
    const hp = U.clamp(c.hp, 0, 1);
    if (hp <= 0) return 'wrecked';
    if (hp >= 1) return 'ok';
    // The one threshold for 'damaged', the same one effect() writes its lines from: inside a
    // jury-rig's reach it is damaged, above it the part is worn (under 100 % and past help).
    return hp < reachOf(c) - 1e-6 ? 'damaged' : 'worn';
  }
  // The turn a hurt drive actually leaves. Thrust scales with the drive, but the attitude thrusters
  // carry half the turn on their own, so a drive at 20 % still turns at 60 % and a wrecked one at
  // 50 % (js/ui.js says the same in the help). autopilot.js flies that number and exports it, so the
  // words quote the model rather than a second rule: '' when the module is not aboard, and the
  // drive's words then fall back to the one figure they printed before.
  function turnWords(hp) {
    const A = OD.Autopilot;
    if (!A || typeof A.turnFactor !== 'function') return '';
    try {
      const f = A.turnFactor(U.clamp(hp, 0, 1));
      return isFinite(f) ? U.fmt.pct(U.clamp(f, 0, 1)) : '';
    } catch (e) { return ''; }
  }
  // Plain words, the ones a damage-control board would use.
  function effect(ship, c) {
    const pct = U.fmt.pct(U.clamp(c.hp, 0, 1));
    const gone = c.hp <= 0;
    switch (kindOf(c)) {
      case 'drive': {
        // Two numbers, because the model has two: the thrust is gone with the drive, the turn is not.
        const turn = turnWords(U.clamp(c.hp, 0, 1));
        if (gone) {
          return turn ? 'Drive wrecked: no acceleration, turn rate at ' + turn + ' on the attitude thrusters'
            : 'Drive wrecked: no acceleration and no attitude control';
        }
        if (c.hp < 1) {
          return turn ? 'Drive ' + pct + ': acceleration at ' + pct + ', turn rate at ' + turn
            : 'Drive ' + pct + ': acceleration and turn rate at ' + pct;
        }
        return 'Drive intact';
      }
      case 'reactor':
        return gone ? 'Reactor wrecked: beams and point defence at a quarter power'
          : c.hp < 1 ? 'Reactor ' + pct + ': beams and point defence capped at ' + U.fmt.pct(0.25 + 0.75 * c.hp) : 'Reactor steady';
      case 'sensors':
        return gone ? 'Sensor suite wrecked: no passive range left, and the beams wobble twice as wide'
          : c.hp < 1 ? 'Sensor suite ' + pct + ': passive range at ' + pct + ', and the beams wobble wider' : 'Sensor suite clear';
      case 'radiator': {
        // The level, not the drop: the row and the mend line under it are then the same quantity.
        const cool = U.fmt.pct(coolingWith(ship, c, U.clamp(c.hp, 0, 1)));
        if (gone) return c.name + " wrecked: the ship's cooling is at " + cool;
        if (c.hp < 1) return c.name + ' ' + pct + ": the ship's cooling is at " + cool;
        return c.name + ' extended';
      }
      case 'tank': {
        // A tank holed this second has lost nothing yet, and '0 km/s lost so far' is not a
        // figure. The running total starts once propellant has actually gone.
        if (c.isolated) return isolatedWords(ship, c);
        if (stateOf(ship, c) === 'venting') {
          return (c.vented || 0) > 0
            ? c.name + ' venting: ' + U.fmt.dv(ventedDv(ship, c)) + ' lost so far'
            : c.name + ' holed and venting';
        }
        if (c.hp < 0.5) return c.name + ' holed and empty: nothing left to vent';
        if (c.hp < 1) return c.name + ' ' + pct + ': plating dented, not venting';
        return c.name + ' sound';
      }
      default: {
        // The state word comes from stateOf, never from a second threshold: a mount at 55 % reads
        // 'damaged' on the row and 'damaged, still firing' under it, one at 92 % reads 'worn' twice.
        // A bay launches where a gun fires, the word the help screen and the salvo tip both use.
        const verb = isBay(c) ? 'launching' : 'firing';
        return gone ? c.name + (isBay(c) ? ' wrecked: nothing launches from it' : ' wrecked: this mount does not fire')
          : c.hp < 1 ? c.name + ' ' + pct + ': ' + stateOf(ship, c) + ', still ' + verb : c.name + ' ready';
      }
    }
  }

  // ------------------------------------------------------------------ jury-rig
  // What a party can get back out of a part, and never below where the part already is.
  function capOf(ship, c) {
    if (!c) return 0;
    const hp = U.clamp(c.hp, 0, 1);
    const kind = kindOf(c);
    const j = JURY[kind] || JURY.mount;
    if (kind === 'tank') {
      if (c.isolated) return hp;              // the hole is shut: a party has nothing left to do
      if (isVenting(ship, c)) return j.wrecked; // isolating holds the plating at a half
      if (hp >= 0.5) return j.damaged;          // a dent is beaten out
      return hp;                                // holed and drained dry: no hole left to shut
    }
    return Math.max(hp, hp <= 0 ? j.wrecked : j.damaged);
  }
  function repairable(ship, partId) {
    const c = partOf(ship, partId);
    if (!c) return false;
    return capOf(ship, c) > U.clamp(c.hp, 0, 1) + 1e-6;
  }
  // Facet mark-up past half means the party works that part in suits, through a hole in the hull.
  function breached(ship, part) {
    const c = partOf(ship, part);
    if (!c || !ship || !ship.damage) return false;
    return (c.facets || []).some((f) => (ship.damage[f] || 0) > T.breachMark);
  }
  function repairTime(ship, partId) {
    const c = partOf(ship, partId);
    if (!c) return 0;
    const j = JURY[kindOf(c)] || JURY.mount;
    const s = j.work * (1 + (1 - U.clamp(c.hp, 0, 1))) * (breached(ship, c) ? T.breachWork : 1);
    return Math.round(s);
  }
  // The one repair time, in the words every screen prints: seconds under a minute, whole minutes
  // above it ('45 s', '1 min', '6 min'). The board row, the card and the log all read this, so one
  // repair never shows two numbers (OD.Damage.timeWords).
  function timeWords(seconds) {
    const s = Math.max(0, Math.round(+seconds || 0));
    if (s < 60) return Math.max(1, s) + ' s';
    return Math.max(1, Math.round(s / 60)) + ' min';
  }
  // The part named the way a sentence wants it. 'PD laser 1' keeps its capitals; 'Coilgun' does not.
  function lowerFirst(name) {
    const s = String(name || '');
    if (/^[A-Z][A-Z]/.test(s)) return s;
    return s.charAt(0).toLowerCase() + s.slice(1);
  }
  // A name that ends in a designator — a number or a single capital letter — is one of a set and
  // takes no article, the way radiator panels and tanks already read: 'laser turret A', 'point-
  // defence laser 1', 'interceptor bay A'. A bare name keeps its article: 'the coilgun'.
  const DESIGNATOR = /\s(?:\d+|[A-Z])$/;
  // The part phrase with its article, the way the log, the board and the cards all name it: 'the
  // drive', 'radiator panel 1', 'tank 2', 'the coilgun', 'main laser C'. Exported, so ui.js and
  // decisions.js never build one of their own. A report row ({ id, name, kind }) names itself as
  // well as a component.
  function plainName(c) {
    if (!c || typeof c !== 'object') return '';
    switch (kindOf(c)) {
      case 'drive': return 'the drive';
      case 'reactor': return 'the reactor';
      case 'sensors': return 'the sensor suite';
      case 'radiator': case 'tank': return lowerFirst(c.name || c.id);
      default: {
        const name = lowerFirst(c.name || c.id);
        return DESIGNATOR.test(name) ? name : 'the ' + name;
      }
    }
  }
  function coolingWith(ship, c, hp) {
    const panels = (ship.components || []).filter((x) => kindOf(x) === 'radiator');
    if (!panels.length) return 1;
    let sum = 0;
    for (const p of panels) sum += U.clamp(p === c ? hp : p.hp, 0, 1);
    return U.clamp(sum / panels.length, 0, 1);
  }
  // What the ship gets out of a part held at hp: the clause after the colon. `from` is where the
  // part is coming up from, which the mount wants: a mount is wrecked by the energy its integrity
  // is worth, so 20 % brought to 80 % is four times the damage to wreck it. It defaults to where
  // the part stands now, so a row asking what a party would buy needs only the two arguments.
  function consequence(ship, c, hp, from) {
    const pct = U.fmt.pct(hp);
    switch (kindOf(c)) {
      case 'drive': {
        // 'some thrust, slow turns' claimed the turn with the thrust: a drive jury-rigged to 30 %
        // turns at 65 %, which is not slow. One shape at every integrity, both numbers named.
        const turn = turnWords(hp);
        if (turn) return 'acceleration at ' + pct + ', turn rate at ' + turn;
        return hp <= 0.35 ? 'some thrust, slow turns' : 'acceleration and turn rate at ' + pct;
      }
      case 'reactor': return 'beams and point defence capped at ' + U.fmt.pct(0.25 + 0.75 * hp);
      case 'sensors': return 'passive range at ' + pct + ', and the beams wobble less';
      case 'radiator': return 'cooling back to ' + U.fmt.pct(coolingWith(ship, c, hp));
      case 'tank': return 'the plating is sound again';
      default: {
        const was = Math.max(U.clamp(from != null ? from : c.hp, 0, 1), 0.01);
        return 'it keeps ' + (isBay(c) ? 'launching' : 'firing') + ', and '
          + U.fmt.num(hp / was, 2) + ' times the damage to wreck it';
      }
    }
  }
  function noWork(ship, c) {
    const kind = kindOf(c), hp = U.clamp(c.hp, 0, 1);
    if (kind === 'tank') {
      if (c.isolated) return 'it is isolated already';
      if (hp >= 1) return 'it is sound';
      return 'it is holed and empty';
    }
    if (hp <= 0) return kind === 'radiator' ? 'the panel is gone' : 'the mount is gone';
    if (hp >= 1) return 'it is undamaged';
    const cap = U.fmt.pct((JURY[kind] || JURY.mount).damaged);
    if (hp <= (JURY[kind] || JURY.mount).damaged + 1e-6) return 'a jury-rig gets no further than ' + cap;
    return 'it is at ' + U.fmt.pct(hp) + ', past the ' + cap + ' a jury-rig reaches';
  }
  // One sentence of what sending a party buys, with the time it takes. The big parts name the job
  // as well, so eight minutes on a wrecked drive reads as a module swap and not as a rebuild.
  const WORK = {
    drive: 'swaps the burnt driver modules',
    reactor: 'cross-connects the spare feed line',
    sensors: 'swaps the burnt receiver boards',
  };
  function buys(ship, partId) {
    const c = partOf(ship, partId);
    if (!c) return '';
    const name = plainName(c);
    if (!repairable(ship, c)) return 'Nothing a party can do for ' + name + ': ' + noWork(ship, c) + '.';
    // A panel repair means the radiators stowed for the whole shift, so the time clause says so:
    // the ship sheds nothing while the party works (crew.js holds the work until they are in).
    const t = ' ' + timeWords(repairTime(ship, c.id)) + (kindOf(c) === 'radiator' ? ', with the radiators in.' : '.');
    if (kindOf(c) === 'tank' && isVenting(ship, c)) {
      const held = heldIn(ship, c);
      return 'A party valves ' + name + ' out of the feed'
        + (held > 0 ? ' and pumps its ' + U.fmt.mass(held) + ' across' : '') + ': the venting stops.' + t;
    }
    const cap = capOf(ship, c);
    const work = WORK[kindOf(c)];
    return 'A party ' + (work ? work + ' and brings ' : 'brings ') + name + ' to ' + U.fmt.pct(cap)
      + ': ' + consequence(ship, c, cap) + '.' + t;
  }
  // What a party has done, for the log. `from` is where the part was before the mend, which the
  // mount's clause needs to say how much more damage it now takes to wreck it.
  function mendWords(ship, c, isolated, from) {
    if (isolated) return isolatedWords(ship, c);
    const hp = U.clamp(c.hp, 0, 1);
    if (kindOf(c) === 'tank') return c.name + ' patched to ' + U.fmt.pct(hp) + ': the plating is sound again';
    return c.name + ' jury-rigged to ' + U.fmt.pct(hp) + ': ' + consequence(ship, c, hp, from);
  }
  // A party finishes on a part. Partial capacity back, never full, and never worse than it was.
  // With no sim to log through, the sentence goes back to the caller.
  function mend(ship, partId, sim) {
    if (!ship || !Array.isArray(ship.components)) return null;
    const c = partOf(ship, partId);
    if (!c || !repairable(ship, c)) return null;
    const isolating = kindOf(c) === 'tank' && isVenting(ship, c);
    const before = U.clamp(c.hp, 0, 1);
    c.hp = U.clamp(Math.max(before, capOf(ship, c)), 0, 1);
    if (isolating) { c.isolated = true; c.ventLogged = true; } // the hole is shut and stays shut
    if (c.hp > 0) c.wreckLogged = false;
    if (c.hp > 0.5 && !isolating) { c.dmgLogged = false; c.ventLogged = false; }
    ship._dmgRev = (ship._dmgRev || 0) + 1;
    aggregate(ship);
    const line = mendWords(ship, c, isolating, before);
    if (sim && sim.addLog) sim.addLog(ship.name + ' — ' + line, 'Damage control', 'good');
    return line;
  }

  // The board is redrawn every frame but only changes on a hit, so the rows are kept until the
  // revision counter moves. A venting hull is the one live readout: its delta-v lost keeps running.
  function report(ship) {
    if (!ship || !Array.isArray(ship.components)) return [];
    const rev = ship._dmgRev || 0;
    if (!ship.venting && ship._dmgRows && ship._dmgRowsRev === rev && ship._dmgRows.length === ship.components.length) return ship._dmgRows;
    const rows = ship.components.map((c) => ({
      id: c.id, kind: kindOf(c), name: c.name, hp: U.clamp(c.hp, 0, 1),
      state: stateOf(ship, c), effect: effect(ship, c),
      // What a party would get out of it: the ceiling, whether it is worth sending, the work and the words.
      cap: Math.round(capOf(ship, c) * 1000) / 1000,
      repairable: repairable(ship, c),
      eta: repairTime(ship, c),
      buys: buys(ship, c),
    }));
    ship._dmgRows = rows; ship._dmgRowsRev = rev;
    return rows;
  }
  function artState(ship) {
    const d = ship && ship.damage ? ship.damage : { nose: 0, flank: 0, tail: 0 };
    const s = (ship && ship.systems) || { drive: 1, radiators: 1, sensors: 1, weapons: 1 };
    return {
      damage: { nose: d.nose || 0, flank: d.flank || 0, tail: d.tail || 0 },
      systems: { drive: s.drive, radiators: s.radiators, sensors: s.sensors, weapons: s.weapons },
    };
  }

  // ------------------------------------------------------------------ campaign
  function toRecord(ship) {
    return (ship && Array.isArray(ship.components) ? ship.components : []).map((c) => {
      const r = { id: c.id, hp: Math.round(U.clamp(c.hp, 0, 1) * 1000) / 1000 };
      if (c.isolated) r.iso = 1; // an isolated tank stays isolated until a yard has it
      return r;
    });
  }
  function fromRecord(ship, rec) {
    if (!ship) return null;
    if (!Array.isArray(ship.components)) init(ship);
    if (Array.isArray(rec)) {
      for (const r of rec) {
        if (!r || r.hp == null) continue;
        const c = byId(ship.components, r.id);
        if (c) {
          c.hp = U.clamp(r.hp, 0, 1); c.vented = 0; c.isolated = !!r.iso; // an old record has no iso field: not isolated
          c.ventLogged = !!c.isolated; c.dmgLogged = c.hp <= 0.5; c.wreckLogged = c.hp <= 0;
        }
      }
    }
    aggregate(ship);
    return ship.components;
  }
  // Yard work: every part comes up by the same fraction hull and systems do.
  function repair(shipLike, fraction) {
    if (!shipLike || !Array.isArray(shipLike.components)) return false;
    const f = fraction == null ? 1 : fraction;
    let did = false;
    for (const c of shipLike.components) {
      if (c.hp < 1) { c.hp = U.clamp(c.hp + f, 0, 1); did = true; }
      if (c.vented) { c.vented = 0; did = true; }
      // A yard welds the hole shut and fills the tank: the isolation goes with it, on the ship and on the record.
      if (c.isolated) { c.isolated = false; did = true; }
      if (c.iso != null) { delete c.iso; did = true; }
      if (!c.facets) continue; // a fleet record carries { id, hp }: keep the log flags off the save
      if (c.hp > 0) c.wreckLogged = false;
      if (c.hp > 0.5) { c.dmgLogged = false; c.ventLogged = false; }
    }
    if (did) aggregate(shipLike);
    return did;
  }

  OD.Damage = {
    T, JURY, init, aggregate, hit, update, report, artState, effect, exposure, toRecord, fromRecord, repair, limitWeapons,
    mend, repairTime, repairable, breached, cap: capOf, buys, stateOf, plainName, timeWords,
  };
})();
