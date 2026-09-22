/* Orbital Declaration — simulation core: ships, Newtonian motion under one gravitating body,
   thermal management, boarding, objectives and scripted triggers. */
(function () {
  'use strict';
  const OD = window.OD;
  const U = OD.U, P = OD.P;
  const MAX_DT = 0.5;
  // A hostile that has broken off counts as driven off past this range, opening for this long (drivenOffStep).
  const DRIVEN_OFF_RANGE = 1500e3, DRIVEN_OFF_HOLD = 120;
  // Boarding: the one place the numbers live. A party crosses when the hulls are inside BOARD.range with less
  // than BOARD.speed between them, and needs BOARD.time seconds of contact to take her. Exported as OD.Sim.BOARD
  // so the panel, the tips and the decision layer quote the same figures the sim uses. The decks decide it
  // (v13, round 3): past BOARD.odds fit defenders to a fit boarder the party is thrown back, and that hull
  // does not try her again for BOARD.retry seconds.
  const BOARD = { range: 3000, speed: 25, time: 90, odds: 2, retry: 600 };

  // What a plot is worth saying out loud: two significant figures, and a bearing to the nearest five degrees.
  // A reading nobody has a solution on is not known to the metre, so it is not printed to the metre.
  const sig2 = (v) => {
    if (!isFinite(v) || v === 0) return 0;
    const m = Math.pow(10, Math.floor(Math.log10(Math.abs(v))) - 1);
    return Math.round(v / m) * m;
  };
  const dist2 = (m) => U.fmt.dist(sig2(m));
  const speed2 = (v) => U.fmt.speed(sig2(v));
  const bearing5 = (a) => { const step = Math.PI / 36; return U.fmt.deg(Math.round(U.wrapAngle(a) / step) * step); };

  function makeShip(spec) {
    const cls = OD.Ships.CLASSES[spec.cls];
    if (!cls) throw new Error('Unknown class ' + spec.cls);
    const fac = OD.Ships.FACTIONS[spec.faction] || OD.Ships.FACTIONS.CIV;
    // Sensor fit: a custom design carries its base hull's suite unless it names its own.
    const baseCls = cls.base ? OD.Ships.CLASSES[cls.base] : null;
    const fit = (key, dflt) => (cls[key] != null ? cls[key] : baseCls && baseCls[key] != null ? baseCls[key] : dflt);
    const ship = {
      id: spec.id || U.uid('s'),
      name: spec.name || fac.prefix + ' ' + cls.name.split('-')[0],
      cls: cls.id, faction: fac.id, role: cls.role,
      pos: { x: spec.pos ? spec.pos.x : 0, y: spec.pos ? spec.pos.y : 0 },
      vel: { x: spec.vel ? spec.vel.x : 0, y: spec.vel ? spec.vel.y : 0 },
      heading: spec.heading != null ? spec.heading : 0, angVel: 0,
      dryMass: cls.dryMass, propMass: spec.propMass != null ? spec.propMass : cls.propMass * (spec.propFraction != null ? spec.propFraction : 1),
      fullPropMass: cls.propMass,
      exhaustVelocity: cls.exhaustVelocity, thrust: cls.thrust,
      angAccel: cls.angAccel, maxAngVel: cls.maxAngVel, length: cls.length,
      throttle: 0, cmdThrottle: 0, cmdHeading: spec.heading != null ? spec.heading : 0, plannedAccel: null,
      order: spec.order ? { ...spec.order } : { type: 'hold' },
      jink: false, target: spec.target || null, weaponsFree: spec.weaponsFree != null ? spec.weaponsFree : true,
      heat: spec.heat != null ? spec.heat : cls.sinkCapacity * 0.1, sinkCapacity: cls.sinkCapacity,
      idleHeat: cls.idleHeat, driveHeat: cls.driveHeat, radiatorArea: cls.radiatorArea, radiatorTemp: cls.radiatorTemp,
      radiatorDeployTime: cls.radiatorDeployTime,
      sensorRange: fit('sensorRange', 300e3), activeRange: fit('activeRange', 1000e3), activeSensor: false,
      radiators: { state: spec.radiatorsOut === false ? 0 : 1, deployed: spec.radiatorsOut !== false, auto: spec.radiatorsAuto != null ? spec.radiatorsAuto : true },
      extraHeat: 0, overheated: false, weaponsInhibited: false,
      systems: Object.assign({ drive: 1, radiators: 1, sensors: 1, weapons: 1 }, spec.systems || {}),
      hull: spec.hull != null ? spec.hull : 1,
      armour: { ...cls.armour },
      mounts: cls.mounts.filter((m) => !(spec.noMounts && spec.noMounts.includes(m.kind))).map((m) => ({ ...m })),
      disabled: !!spec.disabled, destroyed: false, captured: false,
      ai: !!spec.ai, player: !!spec.player, behaviour: spec.behaviour || 'default', reserveDv: spec.reserveDv || 0,
      stats: { dvSpent: 0, distance: 0, burnTime: 0 },
      boarding: null,
      mass() { return this.dryMass + this.propMass; },
      accel() {
        if (this.propMass <= 0 || this.disabled || this.destroyed) return 0;
        const cap = this.overheated ? 0.25 : 1;
        const a = (this.thrust * this.systems.drive * cap) / this.mass();
        // The crew's limit (v13): what the people aboard can take right now, by the g mode set on the board.
        const g = OD.Crew && typeof OD.Crew.accelCap === 'function' ? OD.Crew.accelCap(this) : Infinity;
        return g > 0 && g < a ? g : a;
      },
      accelNominal() { return this.thrust / this.mass(); },
      deltaV() { return P.tsiolkovsky(this.exhaustVelocity, this.mass(), this.dryMass); },
      deltaVFull() { return P.tsiolkovsky(this.exhaustVelocity, this.dryMass + this.fullPropMass, this.dryMass); },
      // What the panels shed right now. A radiator is only as hot as the sink feeding it: 290 K on an empty
      // sink, ship.radiatorTemp (the ceiling) on a full one, so cooling is continuous in the load and a cold
      // ship sheds almost nothing. radiatorRating() is the ceiling, for texts and heat budgets.
      radiatorPower() {
        const T = P.sinkTemperature(this.thermalLoad(), this.radiatorTemp);
        return P.radiatorPower(this.radiatorArea, T) * this.radiators.state * this.systems.radiators;
      },
      radiatorRating() {
        return P.radiatorPower(this.radiatorArea, this.radiatorTemp) * this.radiators.state * this.systems.radiators;
      },
      thermalLoad() { return this.sinkCapacity > 0 ? U.clamp(this.heat / this.sinkCapacity, 0, 1) : 0; },
      neutralised() { return this.destroyed || this.disabled || this.captured; },
    };
    // Components: the drive, reactor, sensors, panels, tanks and mounts a hit can take out.
    if (OD.Damage && OD.Damage.init) {
      OD.Damage.init(ship);
      if (spec.components && OD.Damage.fromRecord) OD.Damage.fromRecord(ship, spec.components);
    }
    // The people aboard (v13): a pool of parties the player deploys, with a record from the campaign.
    // spec.crew === null is a hull with nobody to run damage control (chapter 1's tanker): no crew record at all.
    if (spec.crew !== null && OD.Crew && typeof OD.Crew.init === 'function') OD.Crew.init(ship, spec);
    return ship;
  }

  class Sim {
    constructor(scenario) {
      this.scenario = scenario;
      this.name = scenario.name || 'Scenario';
      this.body = scenario.body ? { ...scenario.body } : null;
      this.sunAngle = scenario.sunAngle != null ? scenario.sunAngle : -0.6;
      this.playerFaction = scenario.playerFaction || 'JC';
      this.time = 0;
      this.ships = [];
      this.log = [];
      this.fx = [];
      this.markers = (scenario.markers || []).map((m) => ({ ...m }));
      this.objectives = (scenario.objectives || []).map((o) => ({ ...o, done: false, failed: false, progress: 0 }));
      this.triggers = (scenario.triggers || []).map((t) => ({ ...t, fired: false }));
      this.outcome = null;
      this.outcomeTime = null;
      this.hints = [];
      this.flags = {};
      for (const s of scenario.ships || []) this.spawn(s);
      if (OD.Sensors && OD.Sensors.init) OD.Sensors.init(this);
      if (OD.Engagement && OD.Engagement.init) OD.Engagement.init(this);
      if (OD.Decisions && OD.Decisions.init) OD.Decisions.init(this);
      if (scenario.intro) for (const line of scenario.intro) this.addLog(line.text, line.speaker, line.kind || 'comms');
    }

    spawn(spec) {
      const ship = makeShip(spec);
      if (spec.orbit && this.body) {
        const o = P.circularOrbit(this.body.mu, this.body.radius + spec.orbit.altitude, spec.orbit.angle || 0);
        ship.pos = o.pos; ship.vel = o.vel;
        if (spec.orbit.retrograde) ship.vel = U.scale(ship.vel, -1);
        if (spec.orbit.velScale) ship.vel = U.scale(ship.vel, spec.orbit.velScale);
        if (spec.offset) ship.pos = U.add(ship.pos, spec.offset);
        if (spec.dvel) ship.vel = U.add(ship.vel, spec.dvel);
        if (spec.heading == null) { ship.heading = U.angleOf(ship.vel); ship.cmdHeading = ship.heading; }
      }
      this.ships.push(ship);
      return ship;
    }

    byId(id) { return this.ships.find((s) => s.id === id) || null; }
    alive() { return this.ships.filter((s) => !s.destroyed); }
    playerShips() { return this.ships.filter((s) => s.faction === this.playerFaction && !s.destroyed); }
    isHostile(a, b) { return a.faction !== b.faction && a.faction !== 'CIV' && b.faction !== 'CIV'; }
    hostiles(ship) { return this.ships.filter((s) => s !== ship && !s.destroyed && !s.captured && this.isHostile(s, ship)); }
    nearestHostile(ship) {
      let best = null, bd = Infinity;
      for (const s of this.hostiles(ship)) {
        if (s.disabled) continue;
        const d = U.dist(s.pos, ship.pos);
        if (d < bd) { bd = d; best = s; }
      }
      return best;
    }
    addLog(text, speaker = '', kind = 'info') {
      this.log.push({ t: this.time, text, speaker, kind });
      if (this.log.length > 400) this.log.shift();
      if (this.onLog) this.onLog(this.log[this.log.length - 1]);
    }
    hint(id, text, anchor, until) {
      // Object form carries everything the hint card understands: id, text, anchor, until, step, mark, markLabel.
      if (typeof id === 'object' && id) { const h = { ...id }; if (!h.text) return; if (!h.id) h.id = 'h' + this.hints.length; this.hints.push(h); return; }
      if (text == null && typeof id === 'string') { text = id; id = 'h' + this.hints.length; }
      if (!text) return;
      this.hints.push({ id, text, anchor, until });
    }

    setOrder(id, order) {
      const s = this.byId(id);
      if (!s) return;
      s.order = { ...order };
      if (order.target) s.target = order.target;
      if (order.type === 'evade') s.jink = true;
    }
    setTarget(id, targetId) { const s = this.byId(id); if (s) s.target = targetId; }
    setRadiators(id, mode) {
      const s = this.byId(id);
      if (!s) return;
      if (mode === 'auto') s.radiators.auto = true;
      else { s.radiators.auto = false; s.radiators.deployed = !!mode; }
    }
    engagementAction(ship, actionId) {
      if (OD.Engagement && OD.Engagement.onAction) OD.Engagement.onAction(this, ship, actionId);
    }

    gravity(pos) { return this.body ? P.gravityAccel(this.body.mu, pos) : { x: 0, y: 0 }; }

    step(dt) {
      if (dt <= 0) return;
      let n = Math.ceil(dt / MAX_DT);
      const h = dt / n;
      while (n-- > 0) this.substep(h);
    }

    substep(dt) {
      this.time += dt;
      for (const ship of this.ships) {
        if (ship.destroyed) continue;
        if (ship.ai && !ship.captured) OD.AI.think(ship, this, dt);
        OD.Autopilot.apply(ship, this, dt);
        OD.Autopilot.attitude(ship, dt);
        this.motion(ship, dt);
        this.thermal(ship, dt);
      }
      if (OD.Crew && typeof OD.Crew.update === 'function') OD.Crew.update(this, dt);
      if (OD.Damage && OD.Damage.update) OD.Damage.update(this, dt);
      this.comebacks();
      this.boarding(dt);
      this.contacts();
      if (OD.Sensors && OD.Sensors.update) OD.Sensors.update(this, dt);
      if (OD.Engagement && OD.Engagement.update) OD.Engagement.update(this, dt);
      this.firstHits();
      if (OD.Decisions && OD.Decisions.update) OD.Decisions.update(this, dt);
      this.effects(dt);
      this.drivenOffStep(dt);
      this.objectivesStep(dt);
      this.triggersStep();
    }

    // A hostile that has broken off and run is out of the fight. Her computer never brings her back (ai.js keeps
    // her retreating once she is hurt or dry), so a chapter that ends only on 'neutralise' would wait for ever
    // while she coasts away at 3 000 km and nothing of ours can catch her and still come home. The rule is one the
    // player can read off the log and the map: she has broken off, she is more than 1 500 km from every fighting
    // hull of ours (beyond any beam or slug), and the range has been opening for two minutes without a break.
    drivenOffStep(dt) {
      const ours = this.playerShips().filter((s) => !s.disabled && !s.captured && s.role !== 'station' && s.role !== 'freighter' && s.role !== 'tanker' && s.role !== 'liner');
      if (!ours.length) return;
      for (const h of this.ships) {
        if (h.drivenOff || h.destroyed || h.captured || h.disabled || !h.aiState || !h.aiState.retreating) continue;
        if (!this.isHostile(h, { faction: this.playerFaction })) continue;
        let near = Infinity, opening = true;
        for (const s of ours) {
          const d = U.dist(s.pos, h.pos);
          if (d < near) near = d;
          if (U.dot(U.sub(h.vel, s.vel), U.sub(h.pos, s.pos)) <= 0) opening = false;
        }
        if (near > DRIVEN_OFF_RANGE && opening) {
          if (h.drivenOffSince == null) h.drivenOffSince = this.time;
          if (this.time - h.drivenOffSince >= DRIVEN_OFF_HOLD) {
            h.drivenOff = true; h.drivenOffAt = this.time;
            const why = h.hull < 0.35 ? 'with her hull at ' + Math.round(h.hull * 100) + ' %'
              : (h.systems && h.systems.drive < 0.3) ? 'with her drive at ' + Math.round(h.systems.drive * 100) + ' %'
              : 'with her tanks near dry';
            this.addLog(h.name + ' is driven off: she broke off ' + why + ', is past ' + U.fmt.dist(DRIVEN_OFF_RANGE) + ' and still opening. She is out of this fight.', 'Command', 'good');
          }
        } else h.drivenOffSince = null;
      }
    }

    motion(ship, dt) {
      const aMax = ship.accel();
      let throttle = ship.disabled ? 0 : U.clamp(ship.cmdThrottle || 0, 0, 1);
      if (ship.overheated) throttle = Math.min(throttle, 1);
      ship.throttle = aMax > 0 ? throttle : 0;
      let acc = this.gravity(ship.pos);
      if (ship.throttle > 0) {
        const a = aMax * ship.throttle;
        acc = U.add(acc, U.fromAngle(ship.heading, a));
        // Propellant flow from the acceleration actually used (F = mdot × ve), so a burn capped by the crew's
        // limit spends less, not the same.
        const mdot = (a * ship.mass()) / ship.exhaustVelocity;
        const used = Math.min(ship.propMass, mdot * dt);
        ship.propMass -= used;
        ship.stats.dvSpent += a * dt;
        ship.stats.burnTime += dt;
        if (ship.propMass <= 0) { ship.propMass = 0; ship.throttle = 0; if (!ship.flagsDry) { ship.flagsDry = true; this.addLog(ship.name + ' has no propellant left. She cannot burn again.', 'Engineering', 'warn'); } }
      }
      ship.vel.x += acc.x * dt; ship.vel.y += acc.y * dt;
      ship.pos.x += ship.vel.x * dt; ship.pos.y += ship.vel.y * dt;
      ship.stats.distance += U.len(ship.vel) * dt;
      if (this.body && U.len(ship.pos) < this.body.radius) {
        ship.destroyed = true; ship.hull = 0; ship.lostHow = 'hit ' + this.body.name;
        this.addLog(ship.name + ' has hit ' + this.body.name + '.', 'Sensors', 'alert');
        this.burst(ship.pos, 40, '#ffb454');
      }
    }

    thermal(ship, dt) {
      const r = ship.radiators;
      const rate = dt / Math.max(1, ship.radiatorDeployTime);
      if (r.deployed) r.state = Math.min(1, r.state + rate); else r.state = Math.max(0, r.state - rate);
      // Drive heat follows the thrust actually produced (the crew's g cap and the drive's state both cut it), the
      // same fraction the propellant flow uses; ship.thrustFrac is kept for the panel's forecast.
      const frac = ship.throttle > 0 && ship.thrust > 0 ? U.clamp((ship.accel() * ship.throttle * ship.mass()) / ship.thrust, 0, 1) : 0;
      ship.thrustFrac = frac;
      const drive = frac > 0 ? ship.driveHeat * frac : 0; // frac already carries the drive's state and the full-sink quarter
      const heatIn = ship.idleHeat + drive + (ship.extraHeat || 0);
      const heatOut = ship.radiatorPower();
      ship.heat = U.clamp(ship.heat + (heatIn - heatOut) * dt, 0, ship.sinkCapacity);
      // extraHeat is refilled every substep by whoever made the heat (mounts, the active sensor), so the last
      // full picture is kept for the panel and for anything forecasting the sink: what the fittings put in this
      // tick, and everything that went in with it.
      ship.lastExtraHeat = ship.extraHeat || 0;
      ship.lastHeatIn = heatIn;
      ship.lastHeatOut = heatOut;
      ship.extraHeat = 0;
      const load = ship.heat / ship.sinkCapacity;
      const was = ship.overheated;
      if (load >= 0.999) ship.overheated = true; else if (load < 0.9) ship.overheated = false;
      ship.weaponsInhibited = ship.overheated;
      if (ship.overheated && !was) this.addLog(ship.name + ': heat sink full. Drive held to a quarter and every mount stopped until it drains.', 'Engineering', 'warn');
    }

    // A hull disabled for a wrecked drive comes back when a jury-rig gives her thrust (v13). A hull disabled for
    // her hull does not: nothing a party does puts armour back. The threshold is the combat module's.
    comebacks() {
      const T = OD.Engagement && OD.Engagement.T;
      const floor = T && T.disableHull > 0 ? T.disableHull : 0.15;
      for (const ship of this.ships) {
        if (!ship.disabled || ship.captured || ship.destroyed || ship.role === 'station') continue;
        // only a hull that was seen disabled with her drive dead comes back: a hull disabled for any other
        // reason (her hull, a boarding, a staged scene) keeps the state the combat module gave her
        if (!(ship.systems.drive > 0)) { ship._driveDead = true; continue; }
        if (!ship._driveDead || ship.hull < floor) continue;
        ship._driveDead = false;
        ship.disabled = false;
        this.addLog(ship.name + ' has thrust again: her drive is at ' + Math.round(ship.systems.drive * 100) + ' %. She can move.', 'Damage control', 'good');
      }
    }

    // " 8 min from thrust" for the party on her drive, or '' when there is no time to give.
    mendEtaWords(ship) {
      const p = ship.crew && ship.crew.parties ? ship.crew.parties.find((q) => q.task === 'repair' && q.part === 'drive') : null;
      return p && p.eta > 0 ? ' ' + (p.eta >= 90 ? Math.round(p.eta / 60) + ' min' : Math.round(p.eta) + ' s') + ' from thrust' : '';
    }
    // True while one of her parties is on the drive and the damage module says a mend would change something.
    driveMendRunning(ship) {
      try {
        const cr = ship.crew; if (!cr || !cr.parties) return false;
        if (!cr.parties.some((p) => p.task === 'repair' && p.part === 'drive')) return false;
        if (OD.Damage && typeof OD.Damage.repairable === 'function') return !!OD.Damage.repairable(ship, 'drive');
        return true;
      } catch (e) { return false; }
    }

    boarding(dt) {
      for (const ship of this.ships) {
        if (ship.destroyed || ship.disabled || ship.faction === 'CIV' || ship.role === 'station' || ship.role === 'freighter') { ship.boarding = null; continue; }
        const beingBoarded = this.ships.some((o) => o.boarding && o.boarding.target === ship.id);
        let best = null;
        if (ship.boarding) { const t = this.byId(ship.boarding.target); if (t && !t.destroyed && !t.captured && this.isHostile(t, ship)) best = t; }
        if (!best && !beingBoarded) {
          for (const other of this.hostiles(ship)) {
            if (other.role === 'station') continue;
            if (ship._noBoard && ship._noBoard.target === other.id && this.time < ship._noBoard.until) continue;
            if (U.dist(other.pos, ship.pos) < BOARD.range && U.len(U.sub(other.vel, ship.vel)) < BOARD.speed) { best = other; break; }
          }
        }
        if (!best) { ship.boarding = null; continue; }
        const inContact = U.dist(best.pos, ship.pos) < BOARD.range && U.len(U.sub(best.vel, ship.vel)) < BOARD.speed;
        if (!ship.boarding || ship.boarding.target !== best.id) {
          if (!inContact) { ship.boarding = null; continue; }
          // The crossing takes longer against a bigger fit crew (v13): 90 s hull to hull, up to four times that.
          const bFit = ship.crew && ship.crew.fit > 0 ? ship.crew.fit : 0, dFit = best.crew && best.crew.fit > 0 ? best.crew.fit : 0;
          const time = BOARD.time * (bFit > 0 && dFit > 0 ? U.clamp(dFit / bFit, 0.5, 4) : 1);
          ship.boarding = { target: best.id, progress: 0, time };
          this.addLog(ship.name + ': boarding party crossing to ' + best.name + (dFit > 0 && bFit > 0 ? ', ' + Math.round(dFit) + ' fit aboard her against our ' + Math.round(bFit) + ', about ' + (time >= 90 ? Math.round(time / 60) + ' min' : Math.round(time) + ' s') : '') + '.', 'Marines', 'info');
        }
        // Contact lost mid-crossing: the party holds on for a while rather than starting over.
        ship.boarding.progress += inContact ? dt / (ship.boarding.time || BOARD.time) : -dt / 120;
        if (ship.boarding.progress <= 0) { ship.boarding = null; this.freeAfterBoarding(ship, null); continue; }
        if (ship.boarding.progress >= 1) {
          // The decks decide it (v13, round 3): too many fit defenders and the party is thrown back; either
          // way the losing deck pays the larger share per head, and the crew module turns a share of the
          // hurt into lost. The fourth argument names where the people were hurt (round 2).
          const bFit = ship.crew && ship.crew.fit > 0 ? ship.crew.fit : 0, dFit = best.crew && best.crew.fit > 0 ? best.crew.fit : 0;
          const thrownBack = bFit > 0 && dFit > 0 && dFit > BOARD.odds * bFit;
          const cost = (winner, loser, wFit, lFit) => {
            if (!(OD.Crew && typeof OD.Crew.casualties === 'function') || !(wFit > 0 && lFit > 0)) return null;
            try {
              const w = (n, k) => (n > 0 ? n + ' ' + k : '');
              const line = (r) => [w(r.wounded, 'wounded'), w(r.lost, 'lost')].filter(Boolean).join(', ') || 'nobody';
              const won = OD.Crew.casualties(winner, null, 0.4 * Math.min(1, lFit / wFit), 'in the boarding') || {};
              const lostSide = OD.Crew.casualties(loser, null, Math.min(1, 0.8 * Math.max(0.5, wFit / lFit)), 'in the boarding') || {};
              return { winner: line(won), loser: line(lostSide) };
            } catch (e) { return null; }
          };
          if (thrownBack) {
            const c = cost(best, ship, dFit, bFit);
            this.addLog('Boarding ' + best.name + ' failed: ' + Math.round(dFit) + ' fit aboard her against our ' + Math.round(bFit) + '. The party is thrown back'
              + (c ? ', and it cost us ' + c.loser + ' and her crew ' + c.winner : '') + '.', 'Marines', 'warn');
            ship._noBoard = { target: best.id, until: this.time + BOARD.retry };
            ship.boarding = null; this.freeAfterBoarding(ship, null, true);
            continue;
          }
          best.captured = true; best.disabled = true; best.ai = false; best.order = { type: 'hold' }; best.throttle = 0; best.cmdThrottle = 0;
          best.faction = ship.faction; best.weaponsFree = false; best.target = null; best.jink = false;
          this.addLog(best.name + ' has been taken. Prize crew aboard.', 'Marines', 'good');
          const c = cost(ship, best, bFit, dFit);
          if (c) this.addLog('Boarding ' + best.name + ' cost us ' + c.winner + ' and her crew ' + c.loser + '.', 'Marines', 'info');
          ship.boarding = null; this.freeAfterBoarding(ship, best);
        }
      }
    }

    // A boarding that held fire (ship.heldFireForBoarding, set by the cripple card) gives the weapons back when the
    // prize is taken or the party is recalled, and an order still flown against the prize drops to hold.
    freeAfterBoarding(ship, prize, failed) {
      if (prize && ship.order && ship.order.target === prize.id && ship.order.type !== 'manual') { ship.order = { type: 'hold' }; ship.target = null; }
      else if (prize && ship.target === prize.id) ship.target = null;
      if (ship.heldFireForBoarding) {
        ship.heldFireForBoarding = false; ship.weaponsFree = true;
        this.addLog(ship.name + ': ' + (prize ? 'prize secured. Weapons free again.' : failed ? 'boarding party back aboard. Weapons free again.' : 'boarding party recalled. Weapons free again.'), 'Marines', 'info');
      }
    }

    // First time a hostile comes inside 1500 km of one of ours: one warning line, which also pulls warp back.
    // The line says no more than the plot holds. A bare contact is a bearing to five degrees and a range to two
    // figures with the error on it, and no closing speed — nobody can read a range rate off a bearing. A track
    // adds her name, her class and a closing speed to two figures, off the estimated vectors. Only a solution
    // is printed exactly, and only then from the truth.
    contacts() {
      if (this.time - (this._contactT || -1e9) < 3) return;
      this._contactT = this.time;
      this._contacted = this._contacted || {};
      const S = OD.Sensors;
      // with the sensor model loaded its ladder logs every contact, track and solution, naming the ship that holds
      // it; a second line here from another hull's ear printed a second range for the same contact
      if (S && typeof S.track === 'function') return;
      const TQ = (S && S.T && S.T.trackQ) || 1.8, SQ = (S && S.T && S.T.solutionQ) || 2.7;
      for (const h of this.ships) {
        if (h.destroyed || h.captured || !this.isHostile(h, { faction: this.playerFaction }) || this._contacted[h.id]) continue;
        for (const p of this.playerShips()) {
          const d = U.dist(h.pos, p.pos);
          if (d >= 1500e3) continue;
          this._contacted[h.id] = true;
          const tr = S && typeof S.track === 'function' ? S.track(this, p, h) : null;
          const q = tr ? tr.q : 3;
          const est = tr && tr.est && q < SQ ? tr.est : { pos: h.pos, vel: h.vel };
          const rel = U.sub(est.pos, p.pos);
          const R = Math.max(1, U.len(rel));
          const role = OD.Ships.CLASSES[h.cls] ? OD.Ships.CLASSES[h.cls].role : 'ship';
          let text;
          if (q < TQ) {
            const err = tr ? tr.rangeErr || tr.posErr || 0 : 0;
            text = 'Contact bearing ' + bearing5(U.angleOf(rel)) + ', range ' + dist2(R) + (err > 0 ? ' ±' + dist2(err) : '') + '. Class unknown.';
          } else {
            const rate = -U.dot(U.sub(est.vel, p.vel), U.norm(rel));
            const closing = Math.abs(rate) < 0.5 ? 0 : rate;   // nobody says 'closing at 9e-11 m/s'
            text = q < SQ
              ? 'Contact: ' + h.name + ' (' + role + ') at ' + dist2(R) + ', closing ' + speed2(closing) + '.'
              : 'Contact: ' + h.name + ' (' + role + ') at ' + U.fmt.dist(d) + ', closing ' + U.fmt.speed(closing) + '.';
          }
          this.addLog(text, 'Sensors', 'warn');
          break;
        }
      }
    }

    // The first hull loss of the mission, once per ship, and only for ships the player is responsible for.
    // Damage control says it because the bridge should hear that the ship has been opened, not read it off a bar.
    firstHits() {
      for (const ship of this.ships) {
        if (ship.destroyed || ship.faction !== this.playerFaction) continue;
        if (!ship._firstHit && ship.hull < 0.995) {
          ship._firstHit = true; ship._hullTenth = Math.floor(Math.max(0, ship.hull) * 10);
          this.addLog(ship.name + ' took her first hit. Hull integrity ' + Math.round(Math.max(0, ship.hull) * 100) + ' %.', 'Damage control', 'warn');
          continue;
        }
        // and a line at every tenth after that, so a hull being ground down is heard, not only read off a bar
        if (ship._firstHit) {
          const tenth = Math.floor(Math.max(0, ship.hull) * 10);
          if (ship._hullTenth == null) ship._hullTenth = tenth;
          if (tenth < ship._hullTenth) { ship._hullTenth = tenth; if (ship.hull > 0) this.addLog(ship.name + ': hull integrity ' + Math.round(Math.max(0, ship.hull) * 100) + ' %.', 'Damage control', tenth <= 3 ? 'alert' : 'warn'); }
        }
      }
    }

    burst(pos, n, color, speed = 60) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * U.TAU, v = speed * (0.3 + Math.random());
        this.fx.push({ x: pos.x, y: pos.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 6 + Math.random() * 6, maxLife: 12, color, size: 1 + Math.random() * 2 });
      }
    }
    effects(dt) {
      for (let i = this.fx.length - 1; i >= 0; i--) {
        const f = this.fx[i];
        f.x += f.vx * dt; f.y += f.vy * dt; f.life -= dt;
        if (f.life <= 0) this.fx.splice(i, 1);
      }
    }

    resolveShip(ref) {
      if (ref === 'player') return this.playerShips()[0] || null;
      return this.byId(ref);
    }
    objectiveTest(o, dt) {
      switch (o.type) {
        case 'rendezvous': {
          const a = this.resolveShip(o.ship), b = this.byId(o.target);
          // v12: the target gone (Long Meridian down on Callisto) fails the objective; it never stays open
          if (!a || !b || b.destroyed || a.destroyed) return 'fail';
          const d = U.dist(a.pos, b.pos), rel = U.len(U.sub(a.vel, b.vel));
          if (d <= (o.range || 5000) && rel <= (o.speed || 10)) { o.progress += dt / (o.hold || 30); return o.progress >= 1; }
          o.progress = Math.max(0, o.progress - dt / 30);
          return false;
        }
        case 'reach': {
          const a = this.resolveShip(o.ship);
          if (!a) return 'fail';
          const p = o.target ? (this.byId(o.target) || {}).pos : o.point;
          if (!p) return false;
          const d = U.dist(a.pos, p);
          if (d <= (o.range || 50e3)) {
            if (o.speed != null) { const v = o.target ? U.len(U.sub(a.vel, this.byId(o.target).vel)) : U.len(a.vel); if (v > o.speed) return false; }
            o.progress += dt / (o.hold || 1); return o.progress >= 1;
          }
          o.progress = 0; return false;
        }
        case 'survive': o.progress = Math.min(1, this.time / o.seconds); return this.time >= o.seconds;
        case 'neutralize': {
          const list = o.targets === 'hostiles' ? this.ships.filter((s) => this.isHostile(s, { faction: this.playerFaction }) && s.role !== 'station') : o.targets.map((id) => this.byId(id)).filter(Boolean);
          if (!list.length) return false;
          // a hull that broke off and ran is out of the fight too (drivenOffStep), so the chapter can end
          const n = list.filter((s) => s.neutralised() || s.drivenOff).length;
          o.progress = n / list.length;
          return n === list.length;
        }
        case 'protect': {
          // A protected hull adrift with a party on her drive is not lost yet (v13): the guard holds while that
          // jury-rig can still land, said once, and fails when nobody can mend her.
          const s = this.byId(o.ship);
          if (!s || s.destroyed || s.captured) return 'fail';
          if (!s.disabled) { o._mendHold = false; return false; }
          if (!this.driveMendRunning(s)) return 'fail';
          if (!o._mendHold) { o._mendHold = true; this.addLog(s.name + ' cannot move, but a party is on her drive,' + this.mendEtaWords(s) + '. The engagement goes on while that repair can land.', 'Command', 'info'); }
          return false;
        }
        case 'escapeFail': { const s = this.byId(o.ship); if (!s || s.neutralised()) return true; const d = U.dist(s.pos, o.point || { x: 0, y: 0 }); o.progress = U.clamp(d / o.range, 0, 1); return d > o.range ? 'fail' : false; }
        case 'custom': return o.test(this);
        default: return false;
      }
    }
    objectivesStep(dt) {
      if (this.outcome) return;
      // Guard objectives (protect, escapeFail) are conditions, not goals: they fail the engagement when broken and
      // count as met the moment every goal is done, so a chapter ends when its goals are met.
      const isGuard = (o) => o.type === 'protect' || o.type === 'escapeFail';
      for (const o of this.objectives) {
        if (o.done || o.failed || o.inactive) continue;
        const r = this.objectiveTest(o, dt);
        if (r === 'fail') {
          o.failed = true; o.failedAt = this.time; this.addLog('Objective failed: ' + o.text, 'Command', 'alert');
          if (!o.optional) { this.outcome = 'defeat'; this.outcomeTime = this.time; return; }
        } else if (r === true) {
          // an objective with `hold` stays open that many seconds after it is first met (chapter 2 keeps its
          // victory back a minute so the prize hint has a window)
          if (o.hold > 0) { if (o.metAt == null) { o.metAt = this.time; continue; } if (this.time - o.metAt < o.hold) continue; }
          o.done = true; o.doneAt = this.time; if (o.ship) { const sh = this.resolveShip(o.ship); if (sh) o.doneDv = sh.stats.dvSpent; }
          if (!isGuard(o)) this.addLog('Objective complete: ' + o.text, 'Command', 'good');
        }
      }
      const noPlayer = this.playerShips().filter((s) => !s.disabled && s.role !== 'station').length === 0 && this.ships.some((s) => s.player);
      if (noPlayer) {
        // A hull with a party on her wrecked drive is not lost yet (v13): a jury-rig brings thrust back, so the
        // engagement holds while that repair can still land. Said once; the defeat comes when nobody can mend.
        const mending = this.playerShips().filter((s) => s.disabled && !s.captured && !s.destroyed && s.role !== 'station' && this.driveMendRunning(s));
        if (mending.length) {
          if (!this._mendHold) {
            this._mendHold = true;
            const s = mending[0];
            this.addLog(s.name + ' cannot move, but a party is on her drive,' + this.mendEtaWords(s) + '. The engagement goes on while that repair can land.', 'Command', 'info');
          }
        } else { this.outcome = 'defeat'; this.outcomeTime = this.time; this.addLog('None of our ships can move. The engagement is lost.', 'Command', 'alert'); return; }
      } else this._mendHold = false;
      // A neutralise objective still open with nothing of ours left that can fight is lost now, not forty minutes
      // later when the last freighter is boarded: an adrift warship cannot be the whole chapter.
      const fightOpen = this.objectives.some((o) => o.type === 'neutralize' && !o.optional && !o.done && !o.failed && !o.inactive);
      if (fightOpen && this.ships.some((s) => s.player)) {
        // A hull adrift with a party on her drive still counts (v13): her mounts fire and her thrust is coming back.
        const canFight = this.playerShips().some((s) => (!s.disabled || this.driveMendRunning(s)) && !s.captured && s.role !== 'station' && s.role !== 'freighter' && s.role !== 'tanker' && s.role !== 'liner');
        if (!canFight) {
          if (!this._noFightSince) this._noFightSince = this.time;
          if (this.time - this._noFightSince >= 60) { this.outcome = 'defeat'; this.outcomeTime = this.time; this.addLog('None of our ships can fight. The engagement is lost.', 'Command', 'alert'); return; }
        } else this._noFightSince = 0;
      }
      const required = this.objectives.filter((o) => !o.optional);
      const goals = required.filter((o) => !isGuard(o));
      if (goals.length && goals.every((o) => o.done) && required.every((o) => !o.failed)) {
        for (const o of this.objectives) if (isGuard(o) && !o.failed) o.done = true;
        this.outcome = 'victory'; this.outcomeTime = this.time; this.addLog('All objectives complete.', 'Command', 'good');
      }
    }
    triggersStep() {
      for (const t of this.triggers) {
        if (t.fired) continue;
        let go = false;
        if (typeof t.when === 'function') go = !!t.when(this);
        else if (t.when && t.when.time != null) go = this.time >= t.when.time;
        else if (t.when && t.when.objective) { const o = this.objectives.find((x) => x.id === t.when.objective); go = !!(o && o.done); }
        if (!go) continue;
        t.fired = true;
        for (const act of t.actions || []) this.runAction(act);
      }
    }
    runAction(act) {
      if (act.log) this.addLog(act.log.text, act.log.speaker || '', act.log.kind || 'comms');
      if (act.spawn) for (const s of act.spawn) this.spawn(s);
      if (act.order) this.setOrder(act.order.ship, act.order.order);
      if (act.activate) { const o = this.objectives.find((x) => x.id === act.activate); if (o) o.inactive = false; }
      if (act.hint) this.hint(typeof act.hint === 'string' ? { text: act.hint } : act.hint);
      if (act.flag) this.flags[act.flag] = true;
      if (typeof act.fn === 'function') act.fn(this);
    }

    predictPath(ship, seconds, steps = 120) {
      const pts = [];
      let pos = { ...ship.pos }, vel = { ...ship.vel };
      const h = seconds / steps;
      for (let i = 0; i < steps; i++) {
        const sub = Math.max(1, Math.ceil(h / 20));
        const hh = h / sub;
        for (let k = 0; k < sub; k++) {
          const g = this.gravity(pos);
          vel.x += g.x * hh; vel.y += g.y * hh;
          pos.x += vel.x * hh; pos.y += vel.y * hh;
        }
        pts.push({ x: pos.x, y: pos.y });
        if (this.body && U.len(pos) < this.body.radius) break;
      }
      return pts;
    }
  }

  OD.Sim = Sim;
  OD.Sim.makeShip = makeShip;
  OD.Sim.BOARD = BOARD;
})();
