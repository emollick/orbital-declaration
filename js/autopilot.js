/* Orbital Declaration — autopilot. Turns a high-level order into a commanded heading and throttle.
   Ships thrust only along the nose, so every order becomes: point the nose, then burn. */
(function () {
  'use strict';
  const OD = window.OD;
  const U = OD.U;

  const ALIGN_TOL = 0.14;      // rad: burn only when the nose is within ~8° of the wanted direction
  const COAST_FRACTION = 0.04; // wanted acceleration below this fraction of max → coast
  const TRIM_FRACTION = 0.35;  // a wanted burn under this much of full thrust is trim, and the guns outrank it
  // Station keeping. A stand-off is a place to sit, not a range to hold to the metre: the band is
  // wide enough that a hull settles inside it and then stays cold, and nothing is spent until the
  // range is actually going to leave it. One number, so the computer and the bridge hold station
  // the same way — the AI used to pass a wider band of its own and the player's orders did not.
  const STATION_BAND = 0.35;   // fraction of the stand-off the hull is allowed to drift across
  const HOLD_HORIZON = 900;    // s: a drift that keeps us in the band this long is not worth a burn

  // Every order the autopilot knows how to fly. Anything else is flown as 'hold'.
  const ORDERS = ['hold', 'intercept', 'approach', 'keeprange', 'matchv', 'evade', 'retreat', 'manual'];
  const knowsOrder = (type) => ORDERS.indexOf(type) >= 0;

  // Time-optimal 1-D controller with a proportional zone near the goal, so the ship neither
  // chatters around the switching curve nor overshoots. gap > 0 means we are short of the goal.
  function alongTrack(gap, closing, aMax, flipTime, softZone) {
    // closing > 0 means the gap is shrinking.
    const aEff = aMax * 0.85; // margin so the flip has time to happen before the braking point
    const gapAtFlip = gap - closing * flipTime;
    const sw = gapAtFlip - (closing * Math.abs(closing)) / (2 * aEff);
    // sw > 0: still room to accelerate toward the goal. sw < 0: must brake now.
    const k = aMax / Math.max(softZone, 1);
    return U.clamp(sw * k, -aMax, aMax); // +: thrust toward goal, −: thrust away
  }

  // How much of the rated turn a hurt drive leaves: the attitude thrusters carry half of it on their own, so a
  // drive at 20 % turns at 60 % and a wrecked one at 50 %. Takes a ship or the drive's own fraction, so the
  // damage words can print the same number the attitude loop flies (realism, round 3).
  function turnFactor(x) {
    const d = typeof x === 'number' ? x : (x && x.systems && typeof x.systems.drive === 'number' ? x.systems.drive : 1);
    return Math.max(0.2, U.clamp(d, 0, 1) * 0.5 + 0.5);
  }
  function flipTimeFor(ship) {
    // Time to rotate 180° from rest: bang-bang with angular acceleration limit and a velocity cap. Rated:
    // scaling this by turnFactor (round 3) stalled a seeded chapter-4 run at the hour, so the plan's flip
    // ring keeps the rated turn and the hurt drive's slower flip is carried into the next pass.
    const a = ship.angAccel, w = ship.maxAngVel;
    const tAcc = w / a;
    if (a * tAcc * tAcc >= Math.PI) return 2 * Math.sqrt(Math.PI / a);
    return 2 * tAcc + (Math.PI - a * tAcc * tAcc) / w;
  }

  // Time to rotate through an angle from rest and stop: bang-bang with an angular acceleration limit and a rate cap.
  function turnTimeFor(ship, angle) {
    const a = ship.angAccel, w = ship.maxAngVel, th = Math.abs(angle);
    if (!(a > 0)) return Infinity;
    const tAcc = w / a;
    if (a * tAcc * tAcc >= th) return 2 * Math.sqrt(th / a);
    return 2 * tAcc + (th - a * tAcc * tAcc) / w;
  }

  // ---- keeping the moon out of the course -------------------------------------------------------
  // A course chosen from the geometry of a fight — straight away from a threat, straight out of a
  // standoff — knows nothing about the body underneath. In Ganymede and Io orbit that course often
  // runs into the moon, so every order that can point a ship inward has its direction flown out for
  // half an hour under gravity first, and turned onto the tangent that clears when it does not.
  const GUARD_HORIZON = 1800;  // s of look-ahead: half an hour, as the reviewers asked for
  const GUARD_DT = 20;         // s per integration step
  const GUARD_AGE = 8;         // s before the cached answer is recomputed
  const GUARD_MOVE = 20e3;     // m of travel before it is recomputed
  const GUARD_SPREAD = 16;     // candidate courses across the clear arc
  const ORIGIN = { x: 0, y: 0 };
  const guardCache = new WeakMap(); // ship → last answer; never writes on the ship itself

  const bodyCentre = (sim) => (sim.body && sim.body.pos ? sim.body.pos : ORIGIN);
  // The radius the autopilot treats as the ground: the body plus a margin it will not spend.
  function bodyFloor(sim) {
    if (!sim || !sim.body) return 0;
    return sim.body.radius + Math.max(60e3, sim.body.radius * 0.025);
  }
  function gravAt(sim, pos) {
    const c = bodyCentre(sim);
    if (c === ORIGIN || (c.x === 0 && c.y === 0)) return sim.gravity(pos);
    return OD.P.gravityAccel(sim.body.mu, U.sub(pos, c));
  }
  // Fly this course out under gravity and answer with the closest the ship comes to the body.
  // The nose has to come round before the drive can push, so the opening seconds coast.
  function closestPass(sim, ship, dir, aMag) {
    const c = bodyCentre(sim);
    let px = ship.pos.x, py = ship.pos.y, vx = ship.vel.x, vy = ship.vel.y;
    const turn = turnTimeFor(ship, U.angleDiff(U.angleOf(dir), ship.heading));
    let closest = Math.hypot(px - c.x, py - c.y);
    for (let t = 0; t < GUARD_HORIZON; t += GUARD_DT) {
      const g = gravAt(sim, { x: px, y: py });
      let ax = g.x, ay = g.y;
      if (aMag > 0 && t >= turn) { ax += dir.x * aMag; ay += dir.y * aMag; }
      vx += ax * GUARD_DT; vy += ay * GUARD_DT;
      px += vx * GUARD_DT; py += vy * GUARD_DT;
      const d = Math.hypot(px - c.x, py - c.y);
      if (d < closest) closest = d;
      if (closest <= sim.body.radius) break;
    }
    return closest;
  }
  // The clear course nearest the one the order wanted. Straight lines that miss a circle leave at
  // more than asin(floor/R) from the line down to it, so the grazing tangents bound the arc worth
  // trying; gravity bends a course inside that arc, so every candidate is flown out before it is
  // believed. Returns null when the original course is already clear.
  function solveClear(sim, ship, dir, aMag) {
    const c = bodyCentre(sim), floor = bodyFloor(sim);
    const r = U.sub(ship.pos, c), R = U.len(r);
    if (R < 1) return null;
    if (closestPass(sim, ship, dir, aMag) > floor) return null;
    const up = U.angleOf(R > 0 ? r : { x: 1, y: 0 });
    const alpha = Math.asin(U.clamp(floor / Math.max(R, floor), 0, 1));
    const limit = Math.max(0.05, Math.PI - alpha - 0.10);
    const theta0 = U.angleDiff(U.angleOf(dir), up);
    let best = null, bestGap = -Infinity, bestOff = Infinity;
    for (let i = 0; i <= GUARD_SPREAD; i++) {
      const th = -limit + (2 * limit * i) / GUARD_SPREAD;
      const cand = U.fromAngle(up + th);
      const gap = closestPass(sim, ship, cand, aMag);
      if (gap > floor) {
        // Clear: keep the one that costs the least turning away from what the order asked for.
        const off = Math.abs(U.angleDiff(th, theta0));
        if (off < bestOff) { bestOff = off; best = cand; bestGap = gap; }
      } else if (bestOff === Infinity && gap > bestGap) { bestGap = gap; best = cand; }
    }
    return best;
  }
  function clearDir(sim, ship, dir, aMag) {
    const base = U.angleOf(dir);
    const c = guardCache.get(ship);
    if (c && c.body === sim.body && Math.abs(U.angleDiff(base, c.base)) < 0.1 &&
        Math.abs(sim.time - c.t) < GUARD_AGE && U.dist(ship.pos, c.pos) < GUARD_MOVE) {
      return c.out || dir;
    }
    const out = solveClear(sim, ship, dir, aMag);
    guardCache.set(ship, { base, t: sim.time, pos: { x: ship.pos.x, y: ship.pos.y }, body: sim.body, out });
    return out || dir;
  }
  // Rotate a wanted acceleration onto a course that clears the body; the magnitude is kept.
  function guardCourse(sim, ship, want, aMax) {
    const mag = U.len(want);
    if (!sim || !sim.body || !(mag > 0) || ship.role === 'station') return want;
    const dir = U.scale(want, 1 / mag);
    const out = clearDir(sim, ship, dir, Math.min(mag, aMax > 0 ? aMax : mag));
    return out === dir ? want : U.scale(out, mag);
  }

  // How long the range stays inside [standoff − band, standoff + band] if nobody burns. `r` is the
  // vector to the target and `u` our velocity relative to her, so the target sits at r − u·t.
  // Both components count: closing walks the range in, cross-track drift walks it out.
  function bandExit(r, u, standoff, band) {
    const step = 20, lo = standoff - band, hi = standoff + band;
    for (let t = step; t <= HOLD_HORIZON; t += step) {
      const d = Math.hypot(r.x - u.x * t, r.y - u.y * t);
      if (d < lo || d > hi) return t;
    }
    return Infinity;
  }

  // Wanted acceleration vector for a rendezvous-type order: reach `standoff` from the target with
  // matched velocity. Works in the target's frame so gravity common to both cancels.
  // Inside the tolerance band around the standoff the ship only matches velocity, so it settles
  // instead of hunting back and forth across the exact range.
  // opts.report, when given, records what phase the controller is in: `inBand`, `tight`, `coasting`.
  function approachAccel(ship, target, standoff, aMax, sim, opts) {
    opts = opts || {};
    const rep = opts.report || null;
    const tight = standoff < 20e3;
    if (rep) { rep.inBand = false; rep.tight = tight; rep.coasting = false; }
    const r = U.sub(target.pos, ship.pos);
    const d = U.len(r);
    if (d < 1) return { x: 0, y: 0 };
    const rhat = U.scale(r, 1 / d);
    const u = U.sub(ship.vel, target.vel); // our velocity relative to the target
    const { along: closing, lateral } = U.split(u, rhat);
    const band = Math.max(400, standoff * (opts.band != null ? opts.band : 0.12));
    const gap = d - standoff;
    const uMag = U.len(u);

    if (Math.abs(gap) <= band) {
      if (rep) rep.inBand = true;
      // Inside the band. A close rendezvous wants a full velocity match; a standoff only needs the
      // drift kept slow enough that we stay in the band for a while, so the ship can coast nose-on.
      if (tight) {
        if (uMag < 0.4) return { x: 0, y: 0 };
        let a = U.scale(u, -1 / 12);
        if (U.len(a) > aMax) a = U.scale(U.norm(a), aMax);
        return a;
      }
      // Station is held while the range stays in the band, and the range is what the whole
      // relative velocity does to it — not the closing rate alone. Cross-track drift moves the
      // bearing, which costs nothing, so it is not a reason to light the drive. Nothing is spent
      // until the band is really going to be left, and then the burn matches velocity once
      // instead of trimming the range every minute: a hull that is not burning keeps its nose on
      // her, which is where the guns want it.
      const leaveTime = bandExit(r, u, standoff, band);
      if (leaveTime > HOLD_HORIZON) { if (rep) rep.coasting = true; return { x: 0, y: 0 }; }
      let a = U.scale(u, -1 / 30);
      if (U.len(a) > aMax) a = U.scale(U.norm(a), aMax);
      return a;
    }

    // Aim just inside the band, not at its far edge: the band says how far the hull may drift
    // before anything is spent on it, and widening that must not park the ship further out than
    // the range it was told to hold.
    const aim = Math.min(band * 0.5, Math.max(200, standoff * 0.06));
    const goal = gap > 0 ? gap - aim : gap + aim;
    const soft = Math.max(1500, 0.05 * Math.abs(goal));
    let aAlong = alongTrack(goal, closing, aMax, flipTimeFor(ship), soft);
    // Cruise-speed cap: coast once closing fast enough. Slower, but a fraction of the propellant.
    if (opts.vmax && aAlong > 0 && closing >= opts.vmax) { aAlong = 0; if (rep) rep.coasting = true; }
    // Damp lateral drift: it is wasted motion.
    let aLat = U.scale(lateral, -1 / 25);
    if (U.len(aLat) > aMax * 0.5) aLat = U.scale(U.norm(aLat), aMax * 0.5);
    let a = U.add(U.scale(rhat, aAlong), aLat);
    const m = U.len(a);
    if (m > aMax) a = U.scale(a, aMax / m);
    return a;
  }

  // ---- the cold approach ------------------------------------------------------------------------
  // 'approach' is the order behind a quiet closing: one burn to set a closing speed, then the drive
  // goes out and stays out, and the hull only wakes up again to brake. A plume is a firing solution
  // from anywhere, so the whole point of the order is the length of the coast.
  // The braking range defaults to 2.5 × the distance it takes to kill the closing speed at full thrust.
  function brakeRange(ship, order) {
    const speed = Math.max(1, (order && order.speed) || 1500);
    if (order && order.brakeAt > 0) return order.brakeAt;
    const aMax = ship.accel ? ship.accel() : 0;
    const stop = aMax > 0 ? (speed * speed) / (2 * aMax) : speed * 60;
    return Math.max(5e3, 2.5 * stop);
  }
  // Does our plot hold her well enough to credit a closing rate? Below a solution the estimated
  // velocity carries an error of the same order as the speeds involved, so it is not worth having.
  function trackSolved(sim, ship, target) {
    const S = OD.Sensors;
    if (!S || typeof S.quality !== 'function' || !sim || typeof sim.byId !== 'function') return true;
    const real = target && target.id ? sim.byId(target.id) : null;
    if (!real || typeof sim.isHostile !== 'function' || !sim.isHostile(real, ship)) return true;
    return S.quality(sim, ship, real) >= ((S.T && S.T.solutionQ) || 2.7);
  }
  // The run: one push, then cold, then the brake. Kept per hull in a side table so nothing is
  // written on the ship, and keyed on the order, so a new order starts a new run. The push ends on
  // our own velocity change — the one number the plot cannot be wrong about — because a contact
  // held at a bearing and a rough range has no closing rate worth steering by.
  const runCache = new WeakMap();
  // Keyed on the order and the hull it is flown against, and on nothing else. A card re-offered
  // with a slightly different closing speed, or a plot that has moved the target since, must not
  // start the push again: the promise the order made was one burn, one coast, one brake, and four
  // plumes is not that promise however well each one is justified on its own.
  const runKey = (o) => o.type + '|' + (o.target || '');
  const CORRECT_MISS = 0.15;   // predicted miss at brakeAt, as a fraction of brakeAt, worth a burn
  const CORRECT_TIME = 20;     // s: the length of the one correction the run is allowed
  const CORRECT_LOCK = 2 / 3;  // no correction once this much of the coast has been flown
  function runFor(sim, ship, order, target, rhat, speed, brakeAt) {
    const key = runKey(order);
    let st = runCache.get(ship);
    if (!st || st.key !== key) {
      const closing0 = trackSolved(sim, ship, target) ? U.dot(U.sub(ship.vel, target.vel), rhat) : 0;
      st = {
        key, phase: 'push', t0: sim ? sim.time : 0,
        v0: { x: ship.vel.x, y: ship.vel.y }, dir0: { x: rhat.x, y: rhat.y },
        need: U.clamp(speed - closing0, 0, 2 * speed),
        speed, brakeAt, corrections: 0, correctUntil: 0, coastT0: 0, coastLen: 0,
      };
      runCache.set(ship, st);
    }
    return st;
  }
  // The miss at the braking point if neither hull burns: how far off the line we will be by the
  // time the range is down to brakeAt. Cross-track drift is the whole of it — the closing speed
  // is what the brake is for.
  function missAtBrake(r, u, brakeAt) {
    const d = U.len(r);
    if (!(d > brakeAt)) return { miss: 0, eta: 0 };
    const rhat = U.scale(r, 1 / d);
    const { along: closing, lateral } = U.split(u, rhat);
    if (!(closing > 1)) return { miss: Infinity, eta: Infinity };
    const eta = (d - brakeAt) / closing;
    return { miss: U.len(lateral) * eta, eta };
  }
  function approachOrderAccel(ship, order, target, aMax, sim, rep) {
    const speed = Math.max(1, order.speed || 1500);
    const r = U.sub(target.pos, ship.pos);
    const d = U.len(r);
    if (d < 1) return { x: 0, y: 0 };
    const rhat = U.scale(r, 1 / d);
    const st = runFor(sim, ship, order, target, rhat, speed, brakeRange(ship, order));
    const brakeAt = st.brakeAt;
    const now = sim ? sim.time : 0;
    // The brake starts at the braking range, and also at the closest the coast is ever going to
    // get: a cold run aimed at a contact and flown for half an hour on dead reckoning can pass
    // her wide, and a hull that sails by at closing speed with the drive out is not an approach.
    // Once the range stops coming in, the run has had its coast and the rest is flown under power.
    // Only a plot that holds her can say the range has stopped coming in: below a solution the
    // estimated velocity changes sign on its own, and braking on that would end the coast in the
    // first minute of it.
    const past = st.phase === 'coast' && trackSolved(sim, ship, target) &&
      U.dot(U.sub(ship.vel, target.vel), rhat) <= 0;
    if (st.phase !== 'close' && (d <= brakeAt || past)) st.phase = 'close';
    if (st.phase === 'close') {
      // Inside the braking range: kill the closing speed and settle at half of it, which is the
      // keep-range behaviour the rest of the orders already use.
      return approachAccel(ship, target, brakeAt * 0.5, aMax, sim, { report: rep, band: 0.12 });
    }
    const u = U.sub(ship.vel, target.vel);
    if (st.phase === 'push') {
      const gained = U.dot(U.sub(ship.vel, st.v0), st.dir0);
      const tol = Math.max(5, st.speed * 0.02);
      const spent = now - st.t0;
      const budget = (aMax > 0 ? st.need / aMax : 0) * 3 + 120;
      if (st.need > tol && gained < st.need - tol && spent < budget) return U.scale(rhat, aMax);
      st.phase = 'coast';
      st.coastT0 = now;
      st.coastLen = Math.max(1, missAtBrake(r, u, brakeAt).eta);
    }
    if (st.phase === 'coast') {
      // The one correction. It is allowed when the coast as it stands would arrive well wide of
      // her, it is not allowed in the last third of the coast (there the brake takes the geometry
      // out anyway, and a late plume is the one she has time to shoot at), and there is only ever
      // one of it.
      const flown = now - st.coastT0;
      if (st.correctUntil > now) {
        const { lateral } = U.split(u, rhat);
        const mag = U.len(lateral);
        if (mag < 1) { st.correctUntil = 0; }
        else {
          let a = U.scale(lateral, -1 / 10);
          if (U.len(a) > aMax) a = U.scale(U.norm(a), aMax);
          return a;
        }
      } else if (!st.corrections && flown < CORRECT_LOCK * st.coastLen && trackSolved(sim, ship, target)) {
        // A miss distance read off a bearing and a rough range is not a miss distance, and a burn
        // spent on one is a plume bought for nothing: the correction waits for a plot that holds
        // her — and if the plot only firms up in the last third, the run keeps its coast and the
        // brake takes the geometry out instead.
        const m = missAtBrake(r, u, brakeAt);
        if (isFinite(m.miss) && m.miss > CORRECT_MISS * brakeAt) {
          st.corrections = 1;
          st.correctUntil = now + CORRECT_TIME;
          // Said by apply(), not here. desired() is also how the planner looks ahead, and it is
          // handed a stand-in hull with no name and no future: a correction it works out on
          // paper is a prediction, and predictions do not get to talk on the bridge channel.
          st.announce = CORRECT_TIME;
        }
      }
    }
    // Cold, all the way in. The plume is what she would see; there is not going to be one.
    if (rep) rep.coasting = true;
    return { x: 0, y: 0 };
  }

  function matchAccel(ship, target, aMax) {
    const u = U.sub(ship.vel, target.vel);
    if (U.len(u) < 0.3) return { x: 0, y: 0 };
    let a = U.scale(u, -1 / 12);
    if (U.len(a) > aMax) a = U.scale(U.norm(a), aMax);
    return a;
  }

  function jinkOverlay(ship, sim, aMax, dt) {
    // Random lateral burns. A slug aimed at where we will be is wasted if we move a few hull lengths
    // during its flight. Each burst costs propellant twice: once to start moving, once to stop.
    // v12: the draws come from the engagement's seeded generator when there is one, so a scripted fight replays
    // the same way every run (the page's Math.random made recommended-only chapter 4 lose about one run in six)
    const rnd = sim && sim.eng && typeof sim.eng.rng === 'function' ? sim.eng.rng : Math.random;
    const j = ship.jinkState || (ship.jinkState = { t: 0, dir: 1, active: false, next: 6 + rnd() * 6, burned: 0, duration: 2 });
    j.t += dt;
    if (!j.active && j.t >= j.next) {
      j.active = true; j.t = 0; j.burned = 0; j.dir = rnd() < 0.5 ? -1 : 1;
      j.duration = 1.5 + rnd() * 1.5;
    } else if (j.active) {
      if (ship.throttle > 0) j.burned += dt;
      if (j.burned >= j.duration || j.t > 40) { j.active = false; j.t = 0; j.next = 18 + rnd() * 14; }
    }
    if (!j.active) return { x: 0, y: 0 };
    const threat = sim.nearestHostile(ship);
    const axis = threat ? U.norm(U.sub(threat.pos, ship.pos)) : U.fromAngle(ship.heading);
    return U.scale(U.perp(axis), j.dir * aMax * 0.7);
  }

  // ---- orbital safety -------------------------------------------------------------------------
  function floorFor(sim) { return bodyFloor(sim); }
  function horizonFor(aMax) { return U.clamp((1200 * 3) / Math.max(aMax, 0.5), 600, 2400); }
  function coastHits(sim, pos0, vel0, horizon, floor) {
    let pos = { x: pos0.x, y: pos0.y }, vel = { x: vel0.x, y: vel0.y };
    for (let i = 0; i < horizon / 20; i++) {
      const g = OD.P.gravityAccel(sim.body.mu, pos);
      vel.x += g.x * 20; vel.y += g.y * 20; pos.x += vel.x * 20; pos.y += vel.y * 20;
      if (U.len(pos) < floor) return true;
    }
    return false;
  }
  // Any autopilot refuses a coast that ends on the ground. When the coast reaches the floor altitude
  // within the horizon (longer for weak drives), it burns horizontally prograde, the burn that raises
  // periapsis, and keeps burning until the periapsis has a real margin. A radial burn would only make
  // the ellipse more eccentric. This is the last line: the course guard above keeps most orders off it.
  function groundAvoid(ship, sim, aMax) {
    if (!sim.body || aMax <= 0) return null;
    const floor = floorFor(sim);
    const el = OD.P.orbitalElements(sim.body.mu, ship.pos, ship.vel);
    const clear = floor + 100e3;
    if (ship.flagsGround) {
      if (!el.bound || el.periapsis > clear) { ship.flagsGround = false; return null; }
    } else {
      if (!el.bound || el.periapsis > floor) return null;
      if (sim.time - (ship.avoidT || -1e9) < 5) return null;
      ship.avoidT = sim.time;
      if (!coastHits(sim, ship.pos, ship.vel, horizonFor(aMax), floor)) return null;
      ship.flagsGround = true;
      sim.addLog(ship.name + ': terrain avoidance. Burning prograde to raise the low point of the orbit.', 'Autopilot', 'warn');
    }
    const h = U.cross(ship.pos, ship.vel);
    const tangent = U.norm(U.perp(ship.pos));
    return U.scale(tangent, (h >= 0 ? 1 : -1) * aMax);
  }

  // A hostile is flown against where the sensors put it, not where it truly is: the order keeps its maths and
  // only the target's pos and vel change, so a fuzzy contact is chased to where it seems to be. Our own ships
  // and civilians (rendezvous, boarding) are exact. The stand-in reads through to the real hull for everything
  // else, and the vectors belong to the track: they are read, never written.
  function seenTarget(ship, sim, target) {
    if (!target || !sim || typeof sim.isHostile !== 'function' || !sim.isHostile(target, ship)) return target;
    const S = OD.Sensors;
    if (!S || typeof S.perceived !== 'function') return target;
    const p = S.perceived(sim, ship, target);
    if (!p || !p.pos || !p.vel || p.pos === target.pos) return target;
    const ghost = Object.create(target);
    ghost.pos = p.pos; ghost.vel = p.vel;
    return ghost;
  }

  // The acceleration an order wants right now, before jinking and before the attitude limits.
  // Reads the ship and target state and writes nothing on the ship; the course guard and the cold
  // approach keep their own working notes in side tables. The planner uses it to look ahead.
  // `trim` marks a burn the gunnery outranks: station keeping and coasting, never a transfer or a
  // braking flip, and never the close rendezvous a boarding party needs.
  function desired(ship, order, target, aMax, sim) {
    let want = { x: 0, y: 0 };
    let faceTarget = true;
    let trim = false;
    const rep = { inBand: false, tight: false, coasting: false };
    const canMove = aMax > 0 && !ship.disabled && !ship.destroyed;
    switch (order.type) {
      case 'intercept':
        if (target && canMove) {
          want = approachAccel(ship, target, order.range != null ? order.range : 2000, aMax, sim, { vmax: order.vmax, report: rep });
          trim = rep.coasting || (rep.inBand && !rep.tight);
        }
        break;
      case 'approach':
        if (target && canMove) {
          want = approachOrderAccel(ship, order, target, aMax, sim, rep);
          trim = rep.coasting || (rep.inBand && !rep.tight);
        }
        break;
      case 'keeprange':
        if (target && canMove) {
          const standoff = order.range || 200e3;
          // The station band is the autopilot's, not the computer's: an order from the bridge
          // holds station exactly the way an order the computer wrote itself does.
          want = approachAccel(ship, target, standoff, aMax, sim,
            { vmax: order.vmax, band: order.band != null ? order.band : STATION_BAND, report: rep });
          // Opening the range points the drive straight away from the target, which in orbit is
          // often straight at the moon. Same guard as a retreat.
          if (U.dist(ship.pos, target.pos) < standoff) want = guardCourse(sim, ship, want, aMax);
          trim = rep.coasting || (rep.inBand && !rep.tight);
        }
        break;
      case 'matchv':
        if (target && canMove) want = matchAccel(ship, target, aMax);
        break;
      case 'retreat': {
        if (!canMove) break;
        const threat = target || (sim ? seenTarget(ship, sim, sim.nearestHostile(ship)) : null);
        const thr = order.throttle != null ? order.throttle : 1;
        if (threat) want = U.scale(U.norm(U.sub(ship.pos, threat.pos)), aMax * thr);
        else if (order.heading != null) want = U.fromAngle(order.heading, aMax * thr);
        // Straight away from her is not a course until the body underneath has agreed to it.
        want = guardCourse(sim, ship, want, aMax);
        faceTarget = false;
        break;
      }
      case 'manual':
        if (!canMove) break;
        want = U.fromAngle(order.heading != null ? order.heading : ship.heading, aMax * U.clamp(order.throttle || 0, 0, 1));
        faceTarget = false;
        break;
      case 'evade':
        if (target && canMove) {
          want = approachAccel(ship, target, order.range || U.dist(ship.pos, target.pos), aMax, sim, { band: 0.3, report: rep });
          trim = rep.inBand && !rep.tight;
        }
        break;
      case 'hold':
      default:
        break;
    }
    return { want, faceTarget, canMove, trim };
  }

  // ---- an order outlives its target ------------------------------------------------------------
  // A hull that is destroyed, disabled or taken is out of the fight, and an order still flown
  // against her is a ship standing still in a battle. The autopilot drops the order to hold, says
  // so once, and lets go of her as a target, so the bridge (and the decision layer behind it) is
  // asked what next instead of watching a throttle sit at zero.
  // Two orders are not dropped: a boarding run — an intercept inside boarding distance with the
  // weapons tight — is aimed at a cripple on purpose, and so is the hull the bridge said to finish.
  // Neither is anything aimed at one of ours: a disabled friendly is a rescue, not a wreck.
  const deadSaid = new WeakMap();
  const NEEDS_TARGET = ['intercept', 'approach', 'keeprange', 'matchv', 'evade'];
  function outOfFight(s) {
    if (!s) return false;
    if (typeof s.neutralised === 'function') return !!s.neutralised();
    return !!(s.destroyed || s.disabled || s.captured);
  }
  function dropDeadOrder(ship, sim) {
    const order = ship.order;
    if (!order || !order.target || NEEDS_TARGET.indexOf(order.type) < 0) return false;
    if (!sim || typeof sim.byId !== 'function') return false;
    const t = sim.byId(order.target);
    if (!t) { ship.order = { type: 'hold' }; if (ship.target === order.target) ship.target = null; return true; }
    if (!outOfFight(t)) return false;
    if (typeof sim.isHostile === 'function' && !sim.isHostile(t, ship)) return false;
    if (ship.finishTarget === t.id) return false;
    const board = OD.Sim && OD.Sim.BOARD ? OD.Sim.BOARD.range : 3000;
    if (order.type === 'intercept' && !ship.weaponsFree && (order.range || 0) > 0 && order.range <= board) return false;
    ship.order = { type: 'hold' };
    if (ship.target === t.id) ship.target = null;
    // The log is the player's bridge, so only our own hulls say it out loud; the computer's ships
    // drop the order just the same, without narrating it.
    let said = deadSaid.get(ship);
    if (!said) deadSaid.set(ship, (said = {}));
    if (!said[t.id] && sim.addLog && ship.faction === sim.playerFaction) {
      said[t.id] = true;
      sim.addLog(t.name + ' is out of the fight. Holding.', 'Autopilot', 'info');
    }
    return true;
  }

  function apply(ship, sim, dt) {
    if (!ship.disabled && !ship.destroyed) dropDeadOrder(ship, sim);
    const order = ship.order || { type: 'hold' };
    const aMax = ship.accel();
    const avoid = !ship.disabled && !ship.destroyed && ship.role !== 'station' ? groundAvoid(ship, sim, aMax) : null;
    if (avoid) {
      ship.cmdHeading = U.angleOf(avoid);
      ship.cmdThrottle = Math.abs(U.angleDiff(ship.cmdHeading, ship.heading)) < ALIGN_TOL ? 1 : 0;
      ship.plannedAccel = avoid;
      return;
    }
    const target = seenTarget(ship, sim, order.target ? sim.byId(order.target) : null);
    const d = desired(ship, order, target, aMax, sim);
    if (order.type === 'approach') flushAnnounce(ship, sim);
    let want = d.want;
    const faceTarget = d.faceTarget, canMove = d.canMove;

    // v12: a jink dodges slugs, so it needs a hostile that can still shoot; and the last 30 km of an intercept
    // (a boarding run alongside a crippled hull) is flown straight, or the sideways bursts keep the approach from
    // ever settling at 2 km and 10 m/s (seen in chapter 2: the range wandering 6 to 68 km with jink on)
    const docking = order.type === 'intercept' && target && U.dist(ship.pos, target.pos) < 30e3;
    if (canMove && !docking && (order.type === 'evade' || (ship.jink && sim.nearestHostile(ship)))) want = U.add(want, jinkOverlay(ship, sim, aMax, dt));

    const mag = U.len(want);
    if (mag > aMax) want = U.scale(want, aMax / mag);
    const wantMag = U.len(want);

    if (order.type === 'manual') {
      ship.cmdHeading = order.heading != null ? order.heading : ship.heading;
      ship.cmdThrottle = U.clamp(order.throttle || 0, 0, 1);
      ship.plannedAccel = want;
      return;
    }

    // Where the guns want the hull: the target as the sensors put it. A nose mount that never bears
    // never fires, so a cold drive hands the hull to gunnery.
    const face = ship.target ? seenTarget(ship, sim, sim.byId(ship.target)) : target;
    const canPoint = faceTarget && face && !face.destroyed;
    const pointHeading = canPoint ? U.angleOf(U.sub(face.pos, ship.pos)) : null;

    if (wantMag > COAST_FRACTION * aMax) {
      const burnHeading = U.angleOf(want);
      const aligned = Math.abs(U.angleDiff(burnHeading, ship.heading)) < ALIGN_TOL;
      // A transfer or the flip to brake owns the hull: the nose goes where the drive has to push.
      // A trim burn does not — while the drive is cold the nose belongs to the guns, and the
      // correction waits until the target is ahead of us anyway.
      if (!aligned && d.trim && canPoint && wantMag < TRIM_FRACTION * aMax) {
        ship.cmdHeading = pointHeading;
        ship.cmdThrottle = 0;
        ship.plannedAccel = null;
      } else {
        ship.cmdHeading = burnHeading;
        ship.cmdThrottle = aligned ? U.clamp(wantMag / aMax, 0.05, 1) : 0;
        ship.plannedAccel = want;
      }
    } else {
      ship.cmdThrottle = 0;
      ship.plannedAccel = null;
      // Coasting: present the nose (thickest armour, and every spinal mount) to the current target.
      if (canPoint) ship.cmdHeading = pointHeading;
      else if (order.type === 'manual' && order.heading != null) ship.cmdHeading = order.heading;
      else ship.cmdHeading = ship.cmdHeading != null ? ship.cmdHeading : ship.heading;
    }
  }

  // Bang-bang attitude control toward cmdHeading with an angular velocity cap.
  function attitude(ship, dt) {
    const err = U.angleDiff(ship.cmdHeading != null ? ship.cmdHeading : ship.heading, ship.heading);
    const a = ship.angAccel * turnFactor(ship);
    const wCap = ship.maxAngVel;
    const wDesired = U.clamp(U.sign(err) * Math.sqrt(2 * a * Math.abs(err)) * 0.9, -wCap, wCap);
    const dw = U.clamp(wDesired - ship.angVel, -a * dt, a * dt);
    ship.angVel += dw;
    if (Math.abs(err) < 0.002 && Math.abs(ship.angVel) < 0.002) { ship.angVel = 0; ship.heading = U.wrapAngle(ship.heading + err); }
    else ship.heading = U.wrapAngle(ship.heading + ship.angVel * dt);
  }

  // Estimate for the HUD: time and delta-v to rendezvous with a target using a burn-flip-burn.
  function estimate(ship, target) {
    const r = U.sub(target.pos, ship.pos);
    const d = U.len(r);
    const rhat = U.norm(r);
    const u = U.sub(ship.vel, target.vel);
    const closing = U.dot(u, rhat);
    const a = ship.accel();
    const flip = flipTimeFor(ship);
    if (a <= 0) return { time: Infinity, dv: Infinity, flip };
    // Reduce to: distance d, initial closing speed. Brachistochrone from rest plus correcting the current velocity.
    const b = OD.P.brachistochrone(Math.max(0, d), a);
    const dv = b.dv + U.len(u) - Math.max(0, closing) * 0.5;
    const time = Math.max(0, b.time - closing / a) + flip;
    return { time, dv: Math.max(0, dv), flip, brach: b };
  }

  // The correction the run decided on, said once, by the hull that is actually flying it. Only
  // ours say it: the log is the player's bridge, and it is the same rule the dead-target line uses.
  function flushAnnounce(ship, sim) {
    const st = runCache.get(ship);
    if (!st || !st.announce) return;
    const secs = st.announce;
    st.announce = 0;
    if (!sim || typeof sim.addLog !== 'function' || ship.faction !== sim.playerFaction) return;
    sim.addLog(ship.name + ': one correction burn of ' + secs + ' s, then the drive goes cold again.', 'Autopilot', 'info');
  }

  // What the cold approach is doing right now, for the panel and for the checks: which of the
  // three phases the run is in and whether its one correction has been spent.
  function approachRun(ship) {
    const st = runCache.get(ship);
    if (!st) return null;
    return { phase: st.phase, corrections: st.corrections || 0, brakeAt: st.brakeAt, speed: st.speed,
      correcting: (st.correctUntil || 0) > 0 && st.phase === 'coast' };
  }

  OD.Autopilot = {
    apply, attitude, estimate, desired, seenTarget, flipTimeFor, turnTimeFor, turnFactor, approachAccel,
    ORDERS, knowsOrder, brakeRange, guardCourse, bodyFloor, closestPass, approachRun, dropDeadOrder,
    ALIGN_TOL, COAST_FRACTION, TRIM_FRACTION, STATION_BAND, HOLD_HORIZON,
  };
})();
