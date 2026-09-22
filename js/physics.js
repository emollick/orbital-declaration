/* Orbital Declaration — physics. The rules the game will not bend.
   Thermal: a radiator is only as hot as the sink behind it (sinkTemperature), and sinkForecast steps that law
   forward so every module says the same thing about when a sink fills, when it empties and where it settles. */
(function () {
  'use strict';
  const OD = window.OD;
  const U = OD.U;

  const P = {
    G: 6.674e-11,
    SIGMA: 5.670374419e-8, // Stefan–Boltzmann, W m⁻² K⁻⁴
    C: 299792458,
    g0: 9.80665,

    // ---- rocketry ----
    tsiolkovsky: (ve, m0, m1) => (m1 > 0 && m0 > m1 ? ve * Math.log(m0 / m1) : 0),
    propellantForDv: (ve, m0, dv) => m0 * (1 - Math.exp(-dv / ve)),
    massFlow: (thrust, ve) => thrust / ve,
    burnTime: (dv, accel) => (accel > 0 ? dv / accel : Infinity),
    stoppingDistance: (v, a) => (a > 0 ? (v * v) / (2 * a) : Infinity),
    // Accelerate half way, flip, decelerate: the brachistochrone.
    brachistochrone(dist, accel) {
      if (accel <= 0 || dist <= 0) return { time: Infinity, peakV: 0, dv: Infinity };
      const t = 2 * Math.sqrt(dist / accel);
      const peakV = Math.sqrt(dist * accel);
      return { time: t, peakV, dv: 2 * peakV };
    },
    // Brachistochrone limited to a delta-v budget: burn, coast, burn.
    transferWithBudget(dist, accel, dvBudget) {
      const b = P.brachistochrone(dist, accel);
      if (b.dv <= dvBudget) return { ...b, coast: 0 };
      const v = dvBudget / 2; // cruise speed we can afford
      const tBurn = v / accel;
      const dBurn = 0.5 * accel * tBurn * tBurn;
      const coast = (dist - 2 * dBurn) / v;
      return { time: 2 * tBurn + coast, peakV: v, dv: dvBudget, coast };
    },

    // ---- gravity & orbits ----
    gravityAccel(mu, pos) {
      const r2 = pos.x * pos.x + pos.y * pos.y;
      if (r2 < 1) return { x: 0, y: 0 };
      const r = Math.sqrt(r2);
      const a = -mu / (r2 * r);
      return { x: pos.x * a, y: pos.y * a };
    },
    circularVelocity: (mu, r) => Math.sqrt(mu / r),
    escapeVelocity: (mu, r) => Math.sqrt((2 * mu) / r),
    orbitalPeriod: (mu, r) => U.TAU * Math.sqrt((r * r * r) / mu),
    // Position and prograde circular velocity at an orbital radius and angle.
    circularOrbit(mu, r, ang) {
      const pos = U.fromAngle(ang, r);
      const v = P.circularVelocity(mu, r);
      return { pos, vel: U.fromAngle(ang + Math.PI / 2, v) };
    },
    specificEnergy(mu, pos, vel) { return 0.5 * U.len2(vel) - mu / U.len(pos); },
    orbitalElements(mu, pos, vel) {
      const r = U.len(pos), v2 = U.len2(vel);
      const e = 0.5 * v2 - mu / r;
      const a = -mu / (2 * e);
      const h = U.cross(pos, vel);
      const ecc = Math.sqrt(Math.max(0, 1 - (h * h) / (mu * a)));
      const per = a * (1 - ecc), ap = a * (1 + ecc);
      return { a, e: ecc, periapsis: per, apoapsis: ap, bound: e < 0 };
    },

    // ---- thermal ----
    // A panel only glows as hot as the sink feeding it: empty at 290 K, at its design ceiling (1000 K on a
    // warship, 900 K on the freighter hull) once the sink holds SINK_KNEE of its capacity (the coolant loop runs the
    // panels at their ceiling from there up; the rest of the sink is margin). So radiatorPower(area,
    // sinkTemperature(load)) is what a ship actually sheds: about 0.7 % of the rating at load 0, the rating from
    // the knee up. A full-throttle burn settles near 60 % on a warship; full fire fills the sink.
    SINK_KNEE: 0.6,
    radiatorPower: (area, T, emissivity = 0.9, sides = 2) => sides * area * emissivity * P.SIGMA * Math.pow(T, 4),
    sinkTemperature: (load, peak = 1000) => 290 + (peak - 290) * U.clamp(load / P.SINK_KNEE, 0, 1),

    // Where a heat sink is going. Steps dH/dt = heatIn - rating·((290 + 710·load)/1000)⁴ (load = H/capacity)
    // in 1 s steps out to the horizon and reports what the bridge wants to know:
    //   tFull   s until the sink saturates (load ≥ 99.9 %), or null if it does not inside the horizon
    //   tEmpty  s until the load is under 5 %, or null
    //   settle  the load this heat in tends to (0..1): the equilibrium of the temperature law, 1 when heat in
    //           beats the rating, so a caller reads it when tFull and tEmpty are both null
    //   loadAt(t)  the load t seconds from now (linear between the steps, flat past the horizon)
    // Every argument is SI: joules, joules, watts, watts, seconds. Decision texts and the ship panel share it.
    sinkForecast(heatNow, sinkCapacity, ratingWatts, heatInWatts, horizonSeconds, peak) {
      const Tpeak = peak > 300 ? peak : 1000;
      const cap = Math.max(1, sinkCapacity || 0);
      const rating = Math.max(0, ratingWatts || 0);
      const hIn = Math.max(0, heatInWatts || 0);
      const horizon = U.clamp(Math.round(horizonSeconds || 600), 1, 4 * 3600);
      const shed = (load) => rating * Math.pow(P.sinkTemperature(load, Tpeak) / Tpeak, 4);
      let H = U.clamp(isFinite(heatNow) ? heatNow : 0, 0, cap);
      const loads = [H / cap];
      let tFull = loads[0] >= 0.999 ? 0 : null;
      let tEmpty = loads[0] < 0.05 ? 0 : null;
      for (let t = 1; t <= horizon; t++) {
        H = U.clamp(H + (hIn - shed(H / cap)), 0, cap);
        const load = H / cap;
        loads.push(load);
        if (tFull === null && load >= 0.999) tFull = t;
        if (tEmpty === null && load < 0.05) tEmpty = t;
      }
      let settle;
      if (rating <= 0) settle = hIn > 0 ? 1 : loads[0];
      else {
        const f = hIn / rating;
        // the load whose panel temperature sheds exactly the heat in, on the same law as shed(): T = 1000·f^¼
        settle = f >= 1 ? 1 : U.clamp(P.SINK_KNEE * (Math.pow(f, 0.25) * Tpeak - 290) / (Tpeak - 290), 0, 1);
      }
      const loadAt = (t) => {
        const x = U.clamp(isFinite(t) ? t : 0, 0, horizon);
        const i = Math.floor(x);
        if (i >= horizon) return loads[horizon];
        return U.lerp(loads[i], loads[i + 1], x - i);
      };
      return { tFull, tEmpty, settle, loadAt, horizon };
    },

    // ---- optics & projectiles (used by the Physics panel and the engagement module) ----
    beamSpotDiameter: (wavelength, range, aperture) => (2.44 * wavelength * range) / aperture,
    beamIntensity(power, spotDiameter) {
      const r = spotDiameter / 2;
      return power / (Math.PI * r * r);
    },
    slugFlightTime: (range, speed) => range / speed,
    lateralDisplacement: (t, a) => 0.5 * a * t * t,
    // Time for a constant-speed projectile to reach a target moving at relVel from relPos. null if never.
    interceptTime(relPos, relVel, speed) {
      const a = U.len2(relVel) - speed * speed;
      const b = 2 * U.dot(relPos, relVel);
      const c = U.len2(relPos);
      if (Math.abs(a) < 1e-9) return b < 0 ? -c / b : null;
      const disc = b * b - 4 * a * c;
      if (disc < 0) return null;
      const s = Math.sqrt(disc);
      const t1 = (-b - s) / (2 * a), t2 = (-b + s) / (2 * a);
      const ts = [t1, t2].filter((t) => t > 0);
      return ts.length ? Math.min(...ts) : null;
    },
    // Light lag matters for sensors: at 300 000 km a picture is a second old.
    lightLag: (range) => range / P.C,

    // ---- bodies of the Jovian system (mu in m³/s², radius in m) ----
    bodies: {
      jupiter:  { name: 'Jupiter',  mu: 1.26687e17, radius: 69911e3,  kind: 'gas', color: '#c9a37a' },
      io:       { name: 'Io',       mu: 5.960e12,   radius: 1821.6e3, kind: 'rock', color: '#d8c36a' },
      europa:   { name: 'Europa',   mu: 3.203e12,   radius: 1560.8e3, kind: 'ice', color: '#c8c2b4' },
      ganymede: { name: 'Ganymede', mu: 9.888e12,   radius: 2634.1e3, kind: 'rock', color: '#8f8578' },
      callisto: { name: 'Callisto', mu: 7.179e12,   radius: 2410.3e3, kind: 'rock', color: '#6f665e' },
    },
  };
  OD.P = P;
})();
