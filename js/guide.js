/* Orbital Declaration — guide: the planner and the navigator.
   Looks ahead with the real autopilot so the map can draw what a ship is about to do and the panel can say it
   in plain words: turn, burn, flip, brake, arrive. Nothing here changes the simulation. */
(function () {
  'use strict';
  const OD = window.OD;
  const U = OD.U, P = OD.P;
  const AP = OD.Autopilot;
  const fmt = U.fmt;

  const HORIZON = 4 * 3600;   // s of look-ahead
  const MOVABLE = { intercept: 1, keeprange: 1, matchv: 1, retreat: 1, manual: 1, evade: 1, approach: 1 };

  // A cheap stand-in for a ship: enough state for the autopilot's desire function and for propellant accounting.
  function shipLike(ship) {
    return {
      id: ship.id, faction: ship.faction, role: ship.role,
      pos: { x: ship.pos.x, y: ship.pos.y }, vel: { x: ship.vel.x, y: ship.vel.y }, heading: ship.heading,
      dryMass: ship.dryMass, propMass: ship.propMass, thrust: ship.thrust, exhaustVelocity: ship.exhaustVelocity,
      angAccel: ship.angAccel, maxAngVel: ship.maxAngVel, systems: ship.systems, overheated: ship.overheated,
      disabled: ship.disabled, destroyed: ship.destroyed,
      mass() { return this.dryMass + this.propMass; },
      accel() {
        if (this.propMass <= 0 || this.disabled || this.destroyed) return 0;
        return (this.thrust * this.systems.drive * (this.overheated ? 0.25 : 1)) / this.mass();
      },
    };
  }

  // Is this thrust fighting the relative motion along the line to the target (braking) or adding to it (burning)?
  function classify(s, t, want, order) {
    if (!t || order.type === 'retreat' || order.type === 'manual') return 'burn';
    const rhat = U.norm(U.sub(t.pos, s.pos));
    const closing = U.dot(U.sub(s.vel, t.vel), rhat);
    const along = U.dot(want, rhat);
    if (Math.abs(closing) < 1) return 'burn';
    return along * closing < 0 ? 'brake' : 'burn';
  }

  // Inside the band the order aims for, so a zero-thrust coast means "arrived" rather than "cruising".
  function bandOf(s, t, order) {
    const standoff = order.type === 'intercept' ? (order.range != null ? order.range : 2000) : order.type === 'evade' ? (order.range || U.dist(s.pos, t.pos)) : order.type === 'approach' ? ((OD.Autopilot && typeof OD.Autopilot.brakeRange === 'function' ? OD.Autopilot.brakeRange(s, order) : (order.brakeAt || 200e3)) / 2) : (order.range || 200e3);
    const band = Math.max(400, standoff * (order.type === 'evade' ? 0.3 : order.band != null ? order.band : 0.12));
    return { standoff, band };
  }

  function atGoal(s, t, order) {
    if (!t) return false;
    if (order.type === 'matchv') return U.len(U.sub(s.vel, t.vel)) < 0.5;
    const { standoff, band } = bandOf(s, t, order);
    return Math.abs(U.dist(s.pos, t.pos) - standoff) <= band;
  }

  // Step size for the forward simulation: coarse in open space, fine near the goal, where the approach
  // controller needs steps much shorter than the time it takes to cross the band or it hunts around it.
  function stepFor(time, s, t, order) {
    let dt = time < 600 ? 4 : time < 3600 ? 10 : 20;
    if (!t) return dt;
    const relV = U.len(U.sub(s.vel, t.vel));
    if (order.type === 'matchv') return relV < 200 ? Math.min(dt, 2) : dt;
    const { standoff, band } = bandOf(s, t, order);
    const gap = Math.abs(U.dist(s.pos, t.pos) - standoff);
    const tGo = (gap + band) / Math.max(relV, 1);
    if (gap <= band) return Math.min(dt, standoff < 20e3 ? 1 : 4);
    if (tGo < 240) dt = Math.min(dt, Math.max(1, tGo / 30));
    return dt;
  }

  function orderKey(order) {
    return [order.type, order.target || '', order.range || '', order.vmax || '', order.band || '', order.heading != null ? order.heading.toFixed(2) : '', order.throttle != null ? order.throttle.toFixed(2) : ''].join('|');
  }

  const hypo = new Map(); // ship.id + key → plan, for button previews

  // Forward-simulate one ship's order. The target is assumed to coast under gravity (an honest guess: a burning
  // target rewrites the plan every second anyway). Attitude is simplified: the nose points where the order
  // wants after a turn that takes the hull's real turn time, so every reversal costs a flip's worth of coast.
  function plan(sim, ship, orderArg) {
    const order = orderArg || ship.order || { type: 'hold' };
    const key = orderKey(order) + '|' + (order.target ? '' : ship.target || '');
    const now = performance.now();
    if (!orderArg && ship._plan && ship._plan.key === key && sim.time - ship._plan.t0 < 2 && now - ship._plan.real < 1500) return ship._plan;
    if (orderArg) { const h = hypo.get(ship.id + '|' + key); if (h && sim.time - h.t0 < 2 && now - h.real < 1500) return h; }

    const out = { key, t0: sim.time, real: now, order: { ...order }, pts: [], flip: null, brake: null, arrive: null, crash: null, dry: false, time: 0, dv: 0, dv0: ship.deltaV(), peakV: 0, turnFirst: 0, feasible: true, active: false };
    const targetShip = order.target ? sim.byId(order.target) : null;
    const movable = MOVABLE[order.type] && (order.type === 'manual' || order.type === 'retreat' || (targetShip && !targetShip.destroyed));
    if (!movable || ship.disabled || ship.destroyed || ship.accel() <= 0) { store(); return out; }
    out.active = true;

    const s = shipLike(ship);
    const t = targetShip ? { id: targetShip.id, pos: { x: targetShip.pos.x, y: targetShip.pos.y }, vel: { x: targetShip.vel.x, y: targetShip.vel.y }, faction: targetShip.faction } : null;
    let time = 0, dvSpent = 0, peakV = 0;
    let pointing = ship.heading, turnLeft = 0, turnStart = null;
    let lastThrustPhase = null, arrivedFor = 0;
    const push = (ph) => out.pts.push({ x: s.pos.x, y: s.pos.y, t: time, phase: ph });
    push('coast');
    const stepLimit = order.type === 'retreat' || order.type === 'manual' ? 1800 : HORIZON;

    while (time < stepLimit) {
      const dt = stepFor(time, s, t, order);
      const aMax = s.accel();
      const want = AP.desired(s, order, t, aMax, sim).want;
      const mag = U.len(want);
      let thrustA = 0, ph = 'coast';
      if (turnLeft > 0) { turnLeft -= dt; ph = 'turn'; }
      else if (aMax > 0 && mag > AP.COAST_FRACTION * aMax) {
        const dir = U.angleOf(want);
        const err = Math.abs(U.angleDiff(dir, pointing));
        if (err > AP.ALIGN_TOL) {
          turnLeft = AP.turnTimeFor(s, err) - dt; pointing = dir; ph = 'turn';
          turnStart = { x: s.pos.x, y: s.pos.y, t: time };
          if (time === 0) out.turnFirst = AP.turnTimeFor(s, err);
        } else {
          thrustA = Math.min(mag, aMax);
          ph = classify(s, t, want, order);
          if (ph === 'brake' && lastThrustPhase === 'burn' && !out.flip) out.flip = turnStart || { x: s.pos.x, y: s.pos.y, t: time };
          if (ph === 'brake' && !out.brake) out.brake = { x: s.pos.x, y: s.pos.y, t: time };
          lastThrustPhase = ph;
        }
      }
      let acc = sim.gravity(s.pos);
      if (thrustA > 0) {
        acc = U.add(acc, U.fromAngle(pointing, thrustA));
        const mdot = ((s.thrust * s.systems.drive * (s.overheated ? 0.25 : 1)) / s.exhaustVelocity) * (thrustA / aMax);
        s.propMass = Math.max(0, s.propMass - mdot * dt);
        dvSpent += thrustA * dt;
      }
      s.vel.x += acc.x * dt; s.vel.y += acc.y * dt; s.pos.x += s.vel.x * dt; s.pos.y += s.vel.y * dt;
      if (t) { const g = sim.gravity(t.pos); t.vel.x += g.x * dt; t.vel.y += g.y * dt; t.pos.x += t.vel.x * dt; t.pos.y += t.vel.y * dt; }
      time += dt;
      const relV = t ? U.len(U.sub(s.vel, t.vel)) : U.len(s.vel);
      if (relV > peakV) peakV = relV;
      push(ph);
      if (sim.body && U.len(s.pos) < sim.body.radius) { out.crash = { x: s.pos.x, y: s.pos.y, t: time }; break; }
      if (s.propMass <= 0) { out.dry = true; break; }
      if (t && thrustA === 0 && turnLeft <= 0 && atGoal(s, t, order)) { arrivedFor += dt; if (arrivedFor >= 30) { out.arrive = { x: s.pos.x, y: s.pos.y, t: time - 30 }; break; } }
      else arrivedFor = 0;
    }
    out.time = out.arrive ? out.arrive.t : time;
    out.dv = dvSpent;
    out.peakV = peakV;
    out.feasible = !out.dry && !out.crash && dvSpent <= out.dv0;
    store();
    return out;

    function store() { if (orderArg) { hypo.set(ship.id + '|' + key, out); if (hypo.size > 64) hypo.delete(hypo.keys().next().value); } else ship._plan = out; }
  }

  // Seconds from now until a plan event, given when the plan was made.
  function eta(sim, p, ev) { return ev ? Math.max(0, ev.t - (sim.time - p.t0)) : null; }

  function summary(p) {
    if (!p || !p.active) return '';
    if (p.crash) return 'ends on the ground';
    if (!p.feasible) return 'needs ' + fmt.dv(p.dv) + ' · not enough';
    return '≈ ' + fmt.time(p.time) + ' · ' + fmt.dv(p.dv);
  }

  // ---- navigator: one plain sentence about what the ship is doing, and one about what comes next -------------
  function narrate(sim, ship) {
    const L = (phase, text, sub) => ({ phase, text, sub: sub || '' });
    if (ship.destroyed) return L('lost', 'Lost with all hands.');
    if (ship.captured) return L('captured', 'Prize crew aboard. She flies for the ' + OD.Ships.FACTIONS[ship.faction].short + ' now.');
    if (ship.disabled) return L('disabled', 'Disabled. No drive, and no way off this trajectory.');
    if (ship.role === 'station') return L('station', 'No drive. The station holds its orbit.', 'Everything else has to manoeuvre around it.');
    const order = ship.order || { type: 'hold' };
    const target = order.target ? sim.byId(order.target) : ship.target ? sim.byId(ship.target) : null;
    const tname = target ? target.name : 'the target';
    const pre = ship.overheated ? 'Sink full: drive held to a quarter, every mount stopped. ' : '';
    if (ship.flagsGround && sim.body) return L('avoid', 'Terrain avoidance. Burning prograde to raise the low point above ' + sim.body.name + '.', 'The autopilot will not fly a coast that ends on the ground.');
    if (ship.propMass <= 0) return L('dry', 'Tanks dry. Coasting on this trajectory for good.', 'Only a port or a depot puts propellant back aboard.');
    const burning = ship.throttle > 0.01;
    const err = Math.abs(U.angleDiff(ship.cmdHeading != null ? ship.cmdHeading : ship.heading, ship.heading));
    const turning = !burning && err > AP.ALIGN_TOL && !!ship.plannedAccel;
    const g = (a) => fmt.num(a / 9.80665, 2) + ' g';
    const p = plan(sim, ship);
    const tFlip = eta(sim, p, p.flip), tBrake = eta(sim, p, p.brake), tArr = eta(sim, p, p.arrive);
    const phaseNow = burning && ship.plannedAccel ? classify(ship, target, ship.plannedAccel, order) : null;
    const rel = target ? U.len(U.sub(ship.vel, target.vel)) : 0;

    switch (order.type) {
      case 'intercept':
      case 'evade':
      case 'keeprange': {
        if (!target) return L('idle', pre + 'No target for this order. Click a contact to pick one.');
        const holding = order.type !== 'intercept';
        const want = holding ? 'holding ' + fmt.dist(order.range || 200e3) + ' from ' + tname : 'alongside ' + tname;
        if (turning) return L('turn', pre + 'Turning ' + fmt.deg(err).replace('°', '') + '° to point the nose along the burn.', 'Thrust only goes out the tail, so every burn starts with a turn. This hull needs about ' + fmt.time(AP.turnTimeFor(ship, err)) + '.');
        if (burning && ship.throttle < 0.35 && atGoal(ship, target, order)) return L('trim', pre + 'Trimming ' + (holding ? 'the standoff from ' : 'alongside ') + tname + '.', 'Small correction burns keep the drift near zero.');
        if (burning && phaseNow === 'burn') return L('burn', pre + 'Accelerating toward ' + tname + ' at ' + g(ship.accel() * ship.throttle) + '.', tFlip != null ? 'Flip in ' + fmt.time(tFlip) + ', then braking tail-first.' : tArr != null ? 'Arrive in ' + fmt.time(tArr) + '.' : '');
        if (burning && phaseNow === 'brake') return L('brake', pre + 'Braking tail-first, ' + fmt.speed(rel) + ' still to shed.', tArr != null ? 'Arrive ' + want + ' in ' + fmt.time(tArr) + ', ' + fmt.dv(Math.max(0, ship.deltaV() - p.dv)) + ' left after.' : 'Braking turns the tail to the target, and the tail armour is the thinnest on the ship.');
        if (burning) return L('burn', pre + 'Burning toward ' + want + '.', tArr != null ? 'Arrive in ' + fmt.time(tArr) + '.' : '');
        if (p.arrive && p.arrive.t <= 4) return holding ? L('hold', pre + 'Holding ' + fmt.dist(order.range || 200e3) + ' from ' + tname + '. Coasting nose-on, spending nothing.', 'The autopilot only burns when the drift would take the ship out of the band.') : L('arrived', pre + 'Alongside ' + tname + ', velocity matched.', rel > 5 ? fmt.speed(rel) + ' of drift.' : 'Ready to board or take in tow.');
        if (p.crash) return L('warn', pre + 'This plan ends on ' + (sim.body ? sim.body.name : 'the ground') + '.', 'The autopilot will break off to raise the orbit, so the arrival slips.');
        if (!p.feasible) return L('warn', pre + 'This transfer needs ' + fmt.dv(p.dv) + '. There is ' + fmt.dv(ship.deltaV()) + ' left.', 'Cap the cruise speed or pick a nearer standoff.');
        return L('coast', pre + 'Coasting toward ' + tname + (order.vmax ? ' at the cruise cap' : '') + ', ' + fmt.speed(rel) + ' relative.', tBrake != null ? 'Braking starts in ' + fmt.time(tBrake) + '.' : tArr != null ? 'Arrive in ' + fmt.time(tArr) + '.' : '');
      }
      case 'matchv':
        if (!target) return L('idle', pre + 'No target to match. Click a contact.');
        if (turning) return L('turn', pre + 'Turning to point the nose against the drift.', 'About ' + fmt.time(AP.turnTimeFor(ship, err)) + '.');
        if (burning) return L('brake', pre + 'Killing the relative motion to ' + tname + ', ' + fmt.speed(rel) + ' left.', 'At zero relative speed the range stops changing.');
        return L('hold', pre + 'Velocity matched with ' + tname + '.', 'Range stays ' + fmt.dist(U.dist(ship.pos, target.pos)) + ' until one of you burns.');
      case 'retreat': {
        const threat = target || sim.nearestHostile(ship);
        if (!threat) return L('coast', pre + 'Nothing to run from. Coasting.');
        if (turning) return L('turn', pre + 'Turning to put the tail toward ' + threat.name + '.', 'A retreat burn points the drive at the enemy.');
        return L('burn', pre + 'Running from ' + threat.name + ' at full burn.', 'The tail faces her, and it carries the thinnest armour. Range opens at ' + fmt.speed(Math.max(0, -U.dot(U.sub(threat.vel, ship.vel), U.norm(U.sub(threat.pos, ship.pos))))) + '.');
      }
      case 'manual':
        if (turning) return L('turn', pre + 'Turning to heading ' + fmt.deg(order.heading || 0) + '.');
        return L(burning ? 'burn' : 'coast', pre + 'Manual: heading ' + fmt.deg(order.heading || 0) + ', throttle ' + Math.round((order.throttle || 0) * 100) + '%.', burning ? 'Spending ' + fmt.speed(ship.accel() * ship.throttle * 60) + ' of delta-v per minute.' : 'Set a throttle to burn.');
      case 'hold':
      default: {
        if (burning) return L('burn', pre + 'Burning.');
        const orb = sim.body ? P.orbitalElements(sim.body.mu, ship.pos, ship.vel) : null;
        const sub = orb && orb.bound ? 'Orbit ' + fmt.dist(orb.periapsis - sim.body.radius) + ' × ' + fmt.dist(orb.apoapsis - sim.body.radius) + '.' + (orb.periapsis < sim.body.radius ? ' The low point is below the surface.' : '') : target ? 'Nose kept toward ' + tname + '.' : '';
        return L('coast', pre + 'Coasting' + (sim.body ? ' around ' + sim.body.name : '') + '. Nothing is spent until you give an order.', sub);
      }
    }
  }

  // ---- a one-line tip for the moment, when the situation has an obvious next step -----------------------
  function suggest(sim, ship) {
    if (!ship || ship.disabled || ship.destroyed || ship.role === 'station' || ship.faction !== sim.playerFaction) return null;
    const order = ship.order || { type: 'hold' };
    const target = ship.target ? sim.byId(ship.target) : null;
    const hostile = sim.nearestHostile(ship);
    const cls = OD.Ships.CLASSES[ship.cls];
    const load = ship.thermalLoad();
    if (sim.body) {
      const el = P.orbitalElements(sim.body.mu, ship.pos, ship.vel);
      if (el.bound && el.periapsis < sim.body.radius && order.type === 'hold') return 'This coast ends on ' + sim.body.name + '. Any burn along your motion raises the low point.';
    }
    if (load > 0.7 && !ship.radiators.deployed && (!hostile || U.dist(hostile.pos, ship.pos) > 600e3)) return 'Sink at ' + Math.round(load * 100) + ' %. Extend the radiators. Nothing hostile is inside 600 km to shoot them off.';
    if (order.type === 'hold') {
      if (!target && hostile) return 'Pick a target. Click a contact on the map or in the list.';
      if (target && sim.isHostile(target, ship)) return 'Keep range at ' + fmt.dist(cls.doctrine.range || 200e3) + ' to fight at this hull\'s doctrine range. Intercept closes to boarding range instead.';
      if (target && !sim.isHostile(target, ship)) return 'Intercept to rendezvous. The autopilot burns, flips halfway and brakes alongside her.';
      if (!target && !hostile) return 'No target yet. ' + (typeof window !== 'undefined' && window.innerWidth < 900 ? 'Tap' : 'Click') + ' a ship to make it the target.';
    }
    if (ship.deltaV() / ship.deltaVFull() < 0.2 && order.type === 'intercept' && !order.vmax) return 'Delta-v is down to ' + Math.round((ship.deltaV() / ship.deltaVFull()) * 100) + ' % of full. A cruise cap makes the transfer slower and much cheaper.';
    return null;
  }

  const Guide = { plan, narrate, suggest, summary, eta, classify, atGoal, mark: null };
  OD.Guide = Guide;
})();
