/* Orbital Declaration — computer-controlled ships choose orders; the autopilot flies them. */
(function () {
  'use strict';
  const OD = window.OD;
  const U = OD.U;

  const BEAM_LOOK = 2500e3;   // m: no beam burns through from farther than this, so look no farther

  // When a stand-off stops being a fight. A destroyer and a corvette can sit 600 km apart for an hour
  // trading nothing: neither holds a solution that bites, neither is closing, and the map is empty.
  // Past these numbers the computer stops negotiating over range and commits to closing.
  const COMMIT_HELD = 300;    // s holding the same target
  const COMMIT_QUIET = 240;   // s since anything landed on either hull
  const COMMIT_WINDOW = 120;  // s over which the range has to be closing to count as a fight
  const COMMIT_CLOSED = 0.02; // fraction of the range that has to have gone in that window
  const COMMIT_BITE = 0.7;    // × our reach: go inside it, not merely to the edge
  const COMMIT_FLOOR = 30e3;  // m: with nothing that bites, close to boarding distance

  // The last resort. A committed fight in which nobody has lost so much as a component for ten
  // minutes is not a fight either; it is two fleets in the same volume waiting each other out, and
  // an engagement that never ends is worse for everyone than one that is lost. So the computer
  // stops being careful: the active sensor goes on, the range goes to point blank, and every mount
  // it owns is free at full power. Something gets decided after that.
  const ESCALATE_QUIET = 600;  // s with nothing lost anywhere on the board
  // Point blank: inside boarding distance, so a stand-off that no gun can settle is settled by
  // marines instead. OD.Sim is not loaded yet when this file runs, so the number is read late.
  const escalateRange = () => Math.round((OD.Sim && OD.Sim.BOARD ? OD.Sim.BOARD.range : 3000) * 0.5);

  // Where our sensors put a hostile. Without the sensor module this is simply the hull itself.
  function seen(ship, sim, target) {
    return (OD.Autopilot && OD.Autopilot.seenTarget) ? OD.Autopilot.seenTarget(ship, sim, target) : target;
  }

  // A hostile with beams that already burn through the facet we are showing it at this range.
  // OD.Engagement.reach(sim, us, them) answers with their reach against us and the facet they are looking at.
  function beamPin(ship, sim) {
    const E = OD.Engagement;
    if (!E || typeof E.reach !== 'function') return false;
    for (const h of sim.hostiles(ship)) {
      if (h.disabled || h.destroyed) continue;
      const d = U.dist(h.pos, ship.pos);
      if (d > BEAM_LOOK) continue;
      const w = E.reach(sim, ship, h), t = w && w.their;
      if (!t || !t.beams) continue;
      const r = t.facet && t.beams[t.facet] > 0 ? t.beams[t.facet] : Math.max(t.beams.nose, t.beams.flank, t.beams.tail);
      if (r > 0 && d < r) return true;
    }
    return false;
  }

  // Thermal housekeeping: radiators out when the sink is filling, in when it has drained. Under a beam that
  // already burns through at this range the panels come in until the sink is nearly full: extended radiators
  // are the softest thing on the hull and the loudest part of its signature.
  // It reads and writes nothing but ship.radiators, and only while they are on auto — the bridge's
  // switch turns auto off — so it is the same rule whoever is flying the hull. Exported for that
  // reason: this used to be a computer-only advantage.
  function thermalDoctrine(ship, sim, threat) {
    if (!ship || !ship.radiators || !ship.radiators.auto || !ship.sinkCapacity) return;
    if (threat === undefined) threat = sim.nearestHostile(ship);
    const load = ship.heat / ship.sinkCapacity;
    if (load < 0.85 && threat && beamPin(ship, sim)) ship.radiators.deployed = false;
    else if (load > 0.7) ship.radiators.deployed = true;
    else if (load < 0.3 && threat && U.dist(seen(ship, sim, threat).pos, ship.pos) < 600e3) ship.radiators.deployed = false;
    else if (!threat) ship.radiators.deployed = true;
  }

  // Active sensors. The computer lights its own when it means to shoot something its passive ears cannot
  // resolve, and puts it out again once the passive track is a solution and nothing is in its face: an active
  // sensor buys a solution at once and hands every hostile one on us.
  function sensorDoctrine(ship, sim, threat, range) {
    const S = OD.Sensors;
    if (!S || typeof S.setActive !== 'function' || typeof S.track !== 'function') return;
    if (!((ship.activeRange || 0) > 0)) return;
    const tr = S.track(sim, ship, threat);
    const q = tr && tr.passive != null ? tr.passive : 3;
    const d = U.dist(seen(ship, sim, threat).pos, ship.pos);
    const wantsFire = !!ship.weaponsFree && !ship.weaponsInhibited && !ship.disabled && ship.systems.weapons > 0;
    if (q < S.T.solutionQ && d < range * 1.3 && wantsFire) { S.setActive(ship, true); return; }
    if (!S.isActive(ship)) return;
    if (q < S.T.solutionQ && wantsFire) return;
    for (const h of sim.hostiles(ship)) if (!h.destroyed && U.dist(h.pos, ship.pos) < range * 0.6) return;
    S.setActive(ship, false);
  }

  // ---- committing to a close ---------------------------------------------------------------------
  // The range at which this hull can actually hurt that one. The smallest positive beam range across
  // her facets is a range that bites whichever face she turns; failing that the coilgun's, failing
  // that the interceptors'; failing all three, boarding distance.
  function commitRange(sim, ship, target) {
    const E = OD.Engagement;
    let r = 0;
    if (E && typeof E.reach === 'function') {
      const w = E.reach(sim, ship, target);
      if (w) {
        if (w.beams) {
          for (const f of ['nose', 'flank', 'tail']) {
            const v = w.beams[f];
            if (v > 0 && (r === 0 || v < r)) r = v;
          }
        }
        if (!(r > 0) && w.slug > 0) r = w.slug;
        if (!(r > 0) && w.launch > 0) r = w.launch;
      }
    }
    if (!(r > 0)) r = COMMIT_FLOOR;
    return Math.max(2e3, Math.round(r * COMMIT_BITE));
  }
  // Everything a hit changes on a hull, in one number. When neither side's figure has moved for
  // minutes, nothing has landed and the stand-off is not a fight.
  function wear(s) {
    if (!s) return 0;
    const y = s.systems || {};
    return s.hull + (y.drive || 0) + (y.radiators || 0) + (y.sensors || 0) + (y.weapons || 0) +
      (s.destroyed ? -10 : 0) + (s.disabled ? -5 : 0);
  }
  const fighter = (s) => !s.destroyed && !s.disabled && !s.captured && s.role !== 'station' && s.role !== 'freighter' && s.faction !== 'CIV';
  // The whole board's wear, and how long it has stood still. Kept per sim in a side table, so
  // nothing is written on the sim, and computed once a second however many hulls ask for it.
  const boardCache = new WeakMap();
  function boardQuiet(sim) {
    let st = boardCache.get(sim);
    if (!st) boardCache.set(sim, (st = { t: -1e9, sum: null, since: sim.time }));
    if (sim.time - st.t < 1 && st.sum != null) return sim.time - st.since;
    st.t = sim.time;
    let sum = 0;
    for (const s of sim.ships) sum += wear(s);
    if (st.sum == null || Math.abs(sum - st.sum) > 1e-4) { st.sum = sum; st.since = sim.time; }
    return sim.time - st.since;
  }
  // Everything the mounts can be told, in one place, so the escalation really does fire everything.
  function freeEverything(ship) {
    const E = OD.Engagement;
    ship.weaponsFree = true;
    if (!E) return;
    try { if (typeof E.setFireMode === 'function') E.setFireMode(ship, 'full'); } catch (e) { /* optional module */ }
    try { if (typeof E.setAim === 'function') E.setAim(ship, 'hull'); } catch (e) { /* optional module */ }
  }

  // True when ours are the only hulls on the board still able to fight. Holding at doctrine range
  // against a cripple or a hauler is how a won engagement runs for forty minutes; press instead.
  function soleWarships(sim, ship) {
    let mine = false, theirs = false;
    for (const o of sim.ships) {
      if (!fighter(o)) continue;
      if (o.faction === ship.faction) mine = true;
      else if (sim.isHostile(o, ship)) theirs = true;
    }
    return mine && !theirs;
  }

  function think(ship, sim, dt) {
    const s = ship.aiState || (ship.aiState = { t: 0, retreating: false });
    s.t += dt;
    if (s.t < 2) return;
    s.t = 0;
    if (ship.disabled || ship.destroyed) return;

    const cls = OD.Ships.CLASSES[ship.cls];
    const doctrine = cls.doctrine || {};
    const threat = sim.nearestHostile(ship);

    thermalDoctrine(ship, sim, threat);

    if (doctrine.stationary) {
      ship.target = threat ? threat.id : null;
      ship.weaponsFree = !!threat;
      return;
    }

    if (doctrine.civilian) {
      // Civilians run from the nearest hostile, else drift. The retreat course itself is body-aware
      // now (the autopilot turns it onto a tangent that clears), so the escort is what decides this,
      // not the moon.
      if (!sim.body && threat && U.dist(threat.pos, ship.pos) < 2000e3) ship.order = { type: 'retreat', target: threat.id };
      else if (ship.order.type === 'retreat') ship.order = { type: 'hold' };
      return;
    }

    if (ship.behaviour === 'flee') {
      // Run from the nearest hostile until the reserve is reached, then coast and fight from there.
      // The retreat order clears the body on its own, so this is safe in orbit as well as in the deep.
      ship.target = threat ? threat.id : null; ship.weaponsFree = !!threat;
      if (threat && ship.deltaV() > ship.reserveDv) { if (ship.order.type !== 'retreat') ship.order = { type: 'retreat', target: threat.id }; }
      else if (ship.order.type !== 'hold') { ship.order = { type: 'hold' }; sim.addLog(ship.name + ' has cut her drive.', 'Sensors', 'info'); }
      return;
    }

    if (!threat) {
      ship.target = null; ship.weaponsFree = false;
      s.holdId = null; s.commitR = 0;
      if (OD.Sensors && OD.Sensors.setActive) OD.Sensors.setActive(ship, false);
      if (ship.order.type !== 'hold' && ship.order.type !== 'manual') ship.order = { type: 'hold' };
      return;
    }

    ship.target = threat.id;
    ship.weaponsFree = true;
    const range = doctrine.range || 300e3;
    sensorDoctrine(ship, sim, threat, range);
    const dv = ship.deltaV();
    const hurt = ship.hull < 0.35 || ship.systems.drive < 0.3;
    const dry = dv < 2500;

    if ((hurt || dry) && !s.retreating) { s.retreating = true; sim.addLog(ship.name + ' is breaking off.', 'Sensors', 'info'); }
    if (s.retreating) {
      ship.order = dry ? { type: 'hold' } : { type: 'retreat', target: threat.id };
      ship.jink = false;
      s.commitR = 0;
      return;
    }

    const d = U.dist(seen(ship, sim, threat).pos, ship.pos);
    ship.jink = !!doctrine.jink && d < range * 1.6 && dv > 6000;

    // ---- how the engagement is going ----------------------------------------------------------
    // A new hull to fight resets every clock: how long we have held her, when anything last landed
    // on either of us, and where the range stood.
    if (s.holdId !== threat.id) {
      s.holdId = threat.id; s.heldSince = sim.time; s.hitT = sim.time;
      s.wear = wear(ship) + wear(threat);
      s.rangeT = sim.time; s.rangeD = d; s.commitR = 0; s.commitAt = 0;
    }
    const now = wear(ship) + wear(threat);
    if (Math.abs(now - s.wear) > 1e-4) { s.wear = now; s.hitT = sim.time; }
    if (sim.time - s.rangeT >= COMMIT_WINDOW) {
      s.closing = d < s.rangeD - Math.max(2e3, s.rangeD * COMMIT_CLOSED);
      s.rangeT = sim.time; s.rangeD = d;
    }

    // Nothing left that can shoot back: press, do not hold. A cripple is still left alone — the
    // computer wants the prize, and nearestHostile never offers a disabled hull in the first place.
    const press = soleWarships(sim, ship) && threat.role !== 'station';
    // Five minutes with a target, four with nothing landing either way, and a range that is not
    // coming in: this is not a fight, it is two ships pointing at each other. Close.
    const stalled = sim.time - s.heldSince > COMMIT_HELD && sim.time - s.hitT > COMMIT_QUIET && s.closing === false;
    // Committed until something changes: anything lands, the hull we are fighting changes, or she
    // is crippled (and then nearestHostile has already moved us on). A side with the board to
    // itself stays committed through all of it, because there is nothing left to be careful about.
    if (s.commitR && !press && s.hitT > s.commitAt) { s.commitR = 0; s.heldSince = sim.time; }
    if (!s.commitR && (press || stalled)) {
      s.commitR = commitRange(sim, ship, threat);
      s.commitAt = sim.time;
      if (sim.time - (s.commitLog || -1e9) > 120) {
        s.commitLog = sim.time;
        sim.addLog(ship.name + ' is closing the range to end the stand-off.', 'Sensors', 'warn');
      }
    }

    // ---- the resolution ------------------------------------------------------------------------
    // Ten minutes in which nothing on the board has lost hull, a component or its life, with this
    // hull held for at least as long as a commit takes to earn: the careful fight has failed, so
    // the computer stops fighting it. Active sensor on, point blank, everything free. Once taken
    // the decision stands — going back to doctrine range would only start the stand-off again.
    if (!s.escalated && s.commitR && sim.time - s.commitAt > ESCALATE_QUIET && boardQuiet(sim) > ESCALATE_QUIET) {
      s.escalated = true;
      if (OD.Sensors && OD.Sensors.setActive) OD.Sensors.setActive(ship, true);
      freeEverything(ship);
      ship.jink = false;
      sim.addLog(ship.name + ' has gone active and is closing to point-blank range. Every mount is free.', 'Sensors', 'warn');
    }
    if (s.escalated) {
      if (OD.Sensors && OD.Sensors.setActive) OD.Sensors.setActive(ship, true);
      freeEverything(ship);
      const point = escalateRange();
      if (ship.order.type !== 'intercept' || ship.order.target !== threat.id || ship.order.range !== point) {
        ship.order = { type: 'intercept', target: threat.id, range: point };
      }
      return;
    }

    if (s.commitR) {
      if (ship.order.type !== 'intercept' || ship.order.target !== threat.id || ship.order.range !== s.commitR) {
        ship.order = { type: 'intercept', target: threat.id, range: s.commitR };
      }
      return;
    }

    // The computer does not chase a ship that keeps opening the range: it holds station and lets
    // the other side pay for the geometry. The band it holds station in is the autopilot's
    // (OD.Autopilot.STATION_BAND), the same one an order from a bridge gets — this used to be a
    // wider number the computer passed itself, which bought it a cold hull and a nose on the
    // target that the player's keep-range never got.
    // Without the engagement module nothing can hurt anyone, so the AI stands its ground and can be boarded.
    const band = OD.Engagement ? undefined : 1.0;
    if (ship.order.type !== 'keeprange' || ship.order.target !== threat.id) {
      ship.order = { type: 'keeprange', target: threat.id, range, band };
    }
  }

  OD.AI = {
    think, commitRange, thermalDoctrine, sensorDoctrine, boardQuiet, escalateRange,
    T: { COMMIT_HELD, COMMIT_QUIET, COMMIT_WINDOW, COMMIT_CLOSED, COMMIT_BITE, COMMIT_FLOOR, ESCALATE_QUIET },
  };
})();
