/* Halberd-class frigate — hull family 'frigate'.
   The workhorse of both navies, 120 m. Ogive armour cap of medium length, a drum crew module carrying two beam
   turrets (dorsal amidships, ventral aft and aimed astern), four point-defence domes on a ring at the forward frame, one
   heavier rail pair slung under the keel and reaching along the cap, twelve launch cells split port and starboard, a four-tank
   cluster bound by two hoops, two large sliding wing radiators, a single torch bell. Balanced, sturdy, nothing
   exaggerated: the hull every other class is a variation of. */
(function () {
  'use strict';
  const A = window.OD && window.OD.ShipArt;
  if (!A) return;

  // angles around the hull: y = cos a (port), z = sin a (dorsal)
  const D_ = Math.PI / 2, V_ = -Math.PI / 2, P_ = 0, S_ = Math.PI;                       // dorsal, ventral, port, starboard
  const DP = Math.PI / 4, DS = 3 * Math.PI / 4, VS = 5 * Math.PI / 4, VP = 7 * Math.PI / 4; // the quarters
  const radial = (a) => [0, Math.cos(a), Math.sin(a)];
  const onRing = (x, r, a) => [x, Math.cos(a) * r, Math.sin(a) * r];
  // hull radius at x: the drum, or the ogive cap ahead of it (same curve the core cap stage draws)
  function hullRadius(lay, x) {
    if (x <= lay.xCap) return lay.R;
    const f = Math.min(1, (x - lay.xCap) / lay.capLen);
    return lay.tipR + (lay.R - lay.tipR) * Math.pow(1 - f * f, 0.62);
  }

  // ---------------------------------------------------------------- part text
  // What the hull view and the hangar print under the picture: one plain sentence a part, with its number.
  // The labels stay as the core writes them, because the hangar and the yard key their own labels on those.
  const grp = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');   // 15000 -> '15 000'
  const mw1 = (w) => Math.round(((w || 0) / 1e6) * 10) / 10;                        // watts -> MW, one decimal
  const ap1 = (a) => (Math.round((a || 1) * 10) / 10).toFixed(1);                   // mirror across, '1.0'

  // The counts and the cooling the simulation really has, rather than what the picture happens to show.
  // js/damage.js builds one part per propellant tank on its own tankCount rule, so a hit holes one of those
  // tanks, not one of the drawn ones; js/physics.js gives the panels their full rating only once the heat sink
  // is past the knee (P.SINK_KNEE), and almost nothing below it.
  const SIGMA = 5.670374419e-8;                                                   // Stefan–Boltzmann, as js/physics.js has it
  const tankParts = (D) => { const m = D.propMass || 0; return m <= 0 ? 0 : m < 2000e3 ? 2 : m < 8000e3 ? 3 : 4; };
  const radMW = (D) => {                                                          // panel rating in MW: both faces, emissivity 0.9
    const Ph = window.OD && window.OD.P, a = D.radiatorArea || 0, T = D.radiatorTemp || 1000;
    return grp((Ph && Ph.radiatorPower ? Ph.radiatorPower(a, T) : 2 * a * 0.9 * SIGMA * Math.pow(T, 4)) / 1e6);
  };
  const kneePct = () => Math.round(((window.OD && window.OD.P && window.OD.P.SINK_KNEE) || 0.6) * 100);
  function partText(lay) {
    const D = lay.D, A = lay.A, t = {};
    t['Armour cap'] = A.nose + ' cm of armour on the nose, against ' + A.flank + ' cm on the flanks.';
    t['Crew module'] = Math.round(lay.modLen) + ' m of pressurised hull for the crew, behind the armour cap.';
    t['Truss spine'] = Math.round(lay.spineLen) + ' m of open lattice, carrying the tanks between the crew and the reactor.';
    t['Shadow shield'] = 'Shielding between the reactor and the crew.';
    t.Reactor = mw1(D.reactorPower) + ' MW of power for the drive' + ((D.mounts || []).length ? ' and the mounts.' : ' and the ship\'s systems.');
    t['Sensor mast'] = D.activeRange > 0
      ? 'Telescopes watching for contacts, and an active sensor that gets a firing solution on everything inside ' + grp(D.activeRange / 1e3) + ' km.'
      : 'Telescopes and a dish watching for other ships.';
    if (lay.spinal.length) {
      const n = lay.spinal.length, m = lay.spinal[0];
      t['Spinal beam'] = n === 1
        ? 'A fixed laser the ship aims by turning, ' + mw1(m.power) + ' MW on a ' + ap1(m.aperture) + ' m mirror.'
        : n + ' fixed lasers the ship aims by turning, ' + mw1(m.power) + ' MW each on ' + ap1(m.aperture) + ' m mirrors.';
    }
    if (lay.turrets.length) {
      const n = lay.turrets.length, m = lay.turrets[0];
      t['Beam turrets'] = n === 1
        ? '1 laser turret that traverses to any bearing, ' + mw1(m.power) + ' MW on a ' + ap1(m.aperture) + ' m mirror.'
        : n + ' laser turrets that traverse to any bearing, ' + mw1(m.power) + ' MW each on ' + ap1(m.aperture) + ' m mirrors.';
    }
    if (lay.coils.length) {
      const n = lay.coils.length, m = lay.coils[0], slug = (m.slugMass || 0) + ' kg slugs at ' + Math.round((m.muzzleVelocity || 0) / 100) / 10 + ' km/s.';
      t[n === 1 ? 'Rail pair' : 'Rail pairs'] = n === 1 ? '1 coilgun along the hull, ' + slug : n + ' coilguns along the hull, ' + slug;
    }
    if (lay.bays.length) {
      const n = lay.bays.reduce((s, b) => s + (b.count || 0), 0);
      t['Launch cells'] = n === 1
        ? '1 interceptor in its cell, a small craft with its own drive.'
        : n + ' interceptors in their cells, each a small craft with its own drive.';
    }
    if (lay.pds.length) {
      const n = lay.pds.length;
      t['Point defence'] = n === 1
        ? '1 dome with a ' + mw1(lay.pds[0].power) + ' MW laser, shooting at inbound interceptors.'
        : n + ' domes with ' + mw1(lay.pds[0].power) + ' MW lasers, shooting at inbound interceptors.';
    }
    const nTanks = tankParts(D);
    if (nTanks) t['Propellant tanks'] = grp((D.propMass || 0) / 1e3) + ' t of propellant in ' + nTanks + (nTanks === 1 ? ' tank.' : ' tanks.');
    if (lay.rads.length) t.Radiators = grp(D.radiatorArea || 0) + ' m² of panel, shedding up to ' + radMW(D) + ' MW while they are out, at their full ' + grp(D.radiatorTemp || 1000) + ' K only once the sink is over ' + kneePct() + ' %.';
    if (lay.rExit > 0) t.Drive = lay.nozzles + ' ' + lay.driveKind + (lay.nozzles === 1 ? ' bell, ' : ' bells, ') + Math.round((D.thrust || 0) / 1e6) + ' MN of thrust, exhaust ' + Math.round((D.exhaustVelocity || 0) / 1e3) + ' km/s.';
    return t;
  }
  // the default callouts with those sentences on them; own = this family's own wording for a part
  function retext(defaults, lay, own) {
    const t = Object.assign(partText(lay), own || {});
    return defaults.map((d) => (t[d.label] ? Object.assign({}, d, { text: t[d.label] }) : d));
  }

  // seconds to swing the nose through 180 degrees: accelerate, run at the rate cap, brake (the autopilot's own sum)
  function flipWords(lay) {
    const a = lay.D.angAccel, w = lay.D.maxAngVel;
    if (!(a > 0) || !(w > 0)) return ' turn the hull';
    const tAcc = w / a;
    const t = a * tAcc * tAcc >= Math.PI ? 2 * Math.sqrt(Math.PI / a) : 2 * tAcc + (Math.PI - a * tAcc * tAcc) / w;
    return ' swing the nose through 180\u00b0 in about ' + Math.max(5, Math.round(t / 5) * 5) + ' s';
  }

  A.registerFamily('frigate', {
    name: 'Halberd-class frigate',
    blurb: 'The hull both navies fly most, 120 m. Two laser turrets on the crew drum, the coilgun under the keel, twelve launch cells split port and starboard, four tanks on an open truss.',
    length: 120,
    radius: 0.057,
    cap: { len: 0.15, shape: 'ogive', tipR: 0.09, rings: true },
    module: { len: 0.21, kind: 'drum' },
    spine: { kind: 'truss', n: 4, r: 0.55 },
    tanks: { arrangement: 'cluster', count: 4, material: 'tank', density: 700, dome: 0.6 },
    radiators: { panels: 2, layout: 'wings', mode: 'slide', aspect: 2.3 },
    drive: { nozzles: 1 },
    sensors: { mast: true, dish: 0.5 },
    accents: { bands: true },

    stages: {
      // crew module: a plain drum with ring frames at both ends of its cylindrical section, armour strips on the
      // quarters (kept clear of the turret and dome stations), an accent ring ahead of the point-defence ring
      module(K, c, lay) {
        const { R, xMod, modLen, A: arm, F } = lay, parts = [];
        const fx = (f) => xMod + modLen * f;
        const mat = F.module.material || (arm.flank >= 15 ? 'armour' : 'hull');
        parts.push(K.tank({ from: xMod, to: xMod + modLen, r: R, material: mat, dome: 0.28 }));
        for (const f of [0.10, 0.92]) parts.push(K.torus({ at: [fx(f), 0, 0], axis: 'x', R: R * 1.01, r: Math.max(0.12, R * 0.028), seg: c.seg, tube: 6, material: 'armourEdge' }));
        // longitudinal armour strips between the aft stations and the bright accent band
        const k = K.clamp(Math.round(arm.flank / 6), 2, 4);
        for (const a of [DP, DS, VS, VP].slice(0, k)) {
          const p = onRing(fx(0.49), R * 0.99, a);
          parts.push(K.box({ at: p, size: [modLen * 0.46, R * 0.17, R * 0.06], frame: [[1, 0, 0], K.V.cross(radial(a), [1, 0, 0]), radial(a)], material: 'armourEdge' }));
        }
        if (F.accents.bands) {
          // the bright band ends well aft of the point-defence ring, leaving plain hull between band and forward frame
          parts.push(K.cyl({ from: fx(0.74), to: fx(0.78), r: R * 1.02, material: 'accent', caps: 'none' }));
          parts.push(K.cyl({ from: fx(0.13), to: fx(0.19), r: R * 1.015, material: 'accentDim', caps: 'none' }));
        }
        // navigation lamps on the forward frame
        parts.push(K.lamp({ at: [fx(0.92), R * 1.03, 0], color: '#ff5a4a', r: R * 0.05 }));
        parts.push(K.lamp({ at: [fx(0.92), -R * 1.03, 0], color: '#5aff7a', r: R * 0.05 }));
        return parts;
      },

      // mounts: turrets dorsal/ventral, the rail pair under the keel, launch cells split port and starboard,
      // point-defence domes in pairs on opposite quarters
      mounts(K, c, lay) {
        const { R, xMod, modLen, xCap, capLen, xNose, L, turrets, coils, bays, pds, A: arm, F } = lay, parts = [];
        const V = K.V, clamp = K.clamp;
        const fx = (f) => xMod + modLen * f;

        // beam turrets: dorsal amidships; ventral aft, aimed astern so its barrel points away from the rail breech a
        // few metres ahead of it; further ones on the aft quarters
        const TSTA = [[D_, 0.50, 1], [V_, 0.16, -1], [DS, 0.16, 1], [DP, 0.16, 1], [VS, 0.16, 1], [VP, 0.16, 1], [D_, 0.16, 1], [DS, 0.50, 1]];
        turrets.forEach((m, i) => {
          const [a, f, dir] = TSTA[i % TSTA.length], ap = m.aperture || 1;
          const r = clamp(ap * 2.3, R * 0.22, R * 0.42);
          parts.push(K.turret({ at: onRing(fx(f), R * 0.985, a), r, up: radial(a), aim: [dir, 0, 0], barrel: ap * 2.6, barrelR: ap * 0.55, role: 'beam', index: lay.turretIdx[i] }));
        });

        // rail pair(s) under the keel: breech bedded into the drum a few metres ahead of the ventral turret, rails on
        // standoff struts reaching along the cap; a faster pair runs longer but always stops short of the tip
        const nC = coils.length;
        const ca = nC === 1 ? [V_] : nC === 2 ? [V_ - 0.42, V_ + 0.42] : coils.map((m, i) => V_ + (i - (nC - 1) / 2) * 0.5);
        coils.forEach((m, i) => {
          const a = ca[i], mv = m.muzzleVelocity || 4000;
          const railR = clamp(R * 0.1, 0.3, 2.6), gap = railR * 2.6;
          const want = clamp(L * 0.28 * Math.pow(mv / 4000, 0.7), L * 0.18, L * 0.45);
          const x0 = fx(0.38), x1 = Math.min(x0 + want, xNose - capLen * 0.12), len = x1 - x0;
          const lineR = R * 1.02 + railR * 1.6;
          const base = onRing(0, lineR, a), up = radial(a), side = V.cross([1, 0, 0], up);
          for (const s of [1, -1]) parts.push(K.rod({ from: V.add([x0, base[1], base[2]], V.scale(side, s * gap / 2)), to: V.add([x1, base[1], base[2]], V.scale(side, s * gap / 2)), r: railR, material: 'barrel', seg: 8, hp: K.hp('coil', lay.coilIdx[i]) }));
          // breech block, bedded down to the drum surface
          const top = lineR + railR * 1.6, bot = R * 0.9;
          parts.push(K.box({ at: onRing(x0 + len * 0.13, (top + bot) / 2, a), size: [len * 0.26, gap + railR * 3.2, top - bot], frame: [[1, 0, 0], side, up], material: 'mount' }));
          // muzzle brace on its own standoff strut, then struts following the taper of the cap behind it
          const xb = x1 - railR * 2.2;
          const chp = K.hp('coil', lay.coilIdx[i]);
          parts.push(K.box({ at: onRing(xb, lineR, a), size: [railR * 3.4, gap + railR * 2.8, railR * 2.8], frame: [[1, 0, 0], side, up], material: 'mount', hp: chp }));
          parts.push(K.mark({ at: onRing(x1 + railR, lineR, a), dir: [1, 0, 0], up, role: 'coil', index: lay.coilIdx[i], r: railR, hp: chp }));
          parts.push(K.rod({ from: onRing(xb, hullRadius(lay, xb) * 0.92, a), to: onRing(xb, lineR, a), r: railR * 0.5, material: 'trussDark', seg: 5 }));
          const struts = Math.max(2, Math.round(len / (R * 1.3)));
          for (let k = 1; k < struts; k++) {
            const x = x0 + (len * k) / struts;
            if (x > xb - railR * 4) break;
            parts.push(K.rod({ from: onRing(x, hullRadius(lay, x) * 0.92, a), to: onRing(x, lineR, a), r: railR * 0.5, material: 'trussDark', seg: 5 }));
            parts.push(K.box({ at: onRing(x, lineR, a), size: [railR * 1.2, gap + railR * 2.4, railR * 1.1], frame: [[1, 0, 0], side, up], material: 'mount' }));
          }
        });

        // launch cells: the count split into two blocks, port and starboard, forward of the turret stations
        if (bays.length) {
          const total = bays.reduce((s, b) => s + (b.count || 6), 0);
          const per = Math.ceil(total / 2);
          const cell = clamp(R * 0.19, 0.6, 2.6);
          const cols = Math.max(1, Math.round(Math.sqrt(per * 1.5))), rows = Math.ceil(per / cols);
          [P_, S_].forEach((a, bi) => {
            parts.push(K.cells({ at: onRing(fx(0.60), R * 0.95, a), normal: radial(a), frame: [[1, 0, 0], V.cross(radial(a), [1, 0, 0])], rows, cols, cell, depth: cell * 0.7, role: 'bay', index: lay.bayIdx[Math.min(bi, lay.bayIdx.length - 1)] }));
          });
        }

        // point-defence domes: each mount feeds a pair of domes on opposite quarters so the cover is all-round.
        // The first two pairs ring the forward frame on the plain hull between the accent band and the ring frame;
        // the third pair sits just ahead of the aft frame, later pairs on the cap base.
        // A cap-base pair goes on the plain cap skin between the accent collar and the first cap ring; a thick cap
        // brings that ring down close to the collar, so there the pair sits between the first two rings that leave
        // room for it instead (ring stations follow the core cap stage).
        const pdR = clamp(R * 0.12, 0.3, 1.6), half = pdR * 1.15 + R * 0.06;
        const nR = F.cap.rings ? Math.round(1 + arm.nose / 15) : 0;
        const ringX = (i) => xCap + capLen * Math.round((i / (nR + 1)) * 7) / 7;
        let xCapDome = xCap + capLen * 0.12;
        if (nR >= 2 && ringX(1) - half < xCapDome) {
          let i = 1;
          while (i + 1 < nR && ringX(i + 1) - ringX(i) < 2 * half) i++;
          xCapDome = (ringX(i) + ringX(i + 1)) / 2;
        }
        const PSTA = [[[DP, 0.855], [VS, 0.855]], [[DS, 0.855], [VP, 0.855]], [[P_, 0.16], [S_, 0.16]], [[DP, 'cap'], [VS, 'cap']], [[DS, 'cap'], [VP, 'cap']]];
        pds.forEach((m, i) => {
          for (const [a, f] of PSTA[i % PSTA.length]) {
            const at = f === 'cap' ? onRing(xCapDome, hullRadius(lay, xCapDome) * 0.985, a) : onRing(fx(f), R * 0.985, a);
            parts.push(K.turret({ at, r: pdR, up: radial(a), aim: [1, 0, 0], barrel: pdR * 0.7, barrelR: pdR * 0.25, facing: f === 'cap' ? 'nose' : undefined, role: 'pd', index: lay.pdIdx[i] }));
          }
        });
        return parts;
      },

      // family detail: tank-cluster hoops, coolant trunks along the spine, attitude-thruster quads at the cap base
      // and the shield rim, a port docking collar, whip antennas at the mast, a comms horn on the aft frame
      extras(K, c, lay) {
        const { R, xMod, modLen, xCap, tanks, spineR, xShield, shieldR, xSpine } = lay, parts = [];
        const V = K.V, clamp = K.clamp;
        const fx = (f) => xMod + modLen * f;

        // hoops binding the tank cluster, at the cradle stations
        if (tanks.length >= 3 && Math.hypot(tanks[0].at[1], tanks[0].at[2]) > 0) {
          const t = tanks[0], dist = Math.hypot(t.at[1], t.at[2]);
          const hoopR = dist + t.r * 0.97, tube = clamp(R * 0.045, 0.12, 0.6);
          for (const f of [0.25, 0.75]) parts.push(K.torus({ at: [t.from + (t.to - t.from) * f, 0, 0], axis: 'x', R: hoopR, r: tube, seg: c.seg, tube: 5, material: 'truss', facing: 'flank' }));
        }
        // coolant trunks port and starboard of the truss, from the shadow shield to the module
        for (const s of [1, -1]) parts.push(K.rod({ from: [xSpine, s * spineR * 0.75, 0], to: [xMod, s * spineR * 0.75, 0], r: clamp(R * 0.05, 0.12, 0.9), material: 'trussDark', seg: 6 }));

        // attitude-thruster quads on the cap-base collar and on the forward face of the shield rim
        const q = R * 0.13;
        for (const a of [DP, DS, VS, VP]) {
          const p = onRing(xCap + R * 0.1, R * 1.03 + q * 0.35, a);
          parts.push(K.box({ at: p, size: [q * 1.2, q, q * 0.8], frame: [[1, 0, 0], V.cross(radial(a), [1, 0, 0]), radial(a)], material: 'hullDark', facing: 'nose' }));
          parts.push(K.cyl({ from: q * 0.3, to: q * 0.75, r: q * 0.22, at: p, axis: radial(a), material: 'dark', facing: 'nose' }));
        }
        for (const a of [D_, V_, P_, S_]) {
          const p = onRing(xShield + q * 0.6, shieldR * 0.86, a);
          parts.push(K.box({ at: p, size: [q * 1.3, q * 1.1, q * 0.9], frame: [[1, 0, 0], V.cross(radial(a), [1, 0, 0]), radial(a)], material: 'hullDark', facing: 'tail' }));
          parts.push(K.cyl({ from: q * 0.35, to: q * 0.8, r: q * 0.22, at: p, axis: radial(a), material: 'dark', facing: 'tail' }));
        }

        // docking collar on the port flank, aft of the launch cells
        const dr = R * 0.2, dp = onRing(fx(0.30), R * 0.97, P_);
        parts.push(K.lathe({ at: dp, axis: radial(P_), profile: [[0, dr * 1.25], [R * 0.09, dr * 1.25], [R * 0.09, dr], [R * 0.14, dr], [R * 0.14, dr * 0.75], [R * 0.145, dr * 0.75], [R * 0.145, 0]], material: 'hullLight', seg: 12 }));
        parts.push(K.torus({ at: V.add(dp, V.scale(radial(P_), R * 0.14)), axis: radial(P_), R: dr * 0.88, r: dr * 0.12, seg: 12, tube: 5, material: 'accentDim' }));

        // whip antennas beside the mast, a comms horn on the aft frame
        const xm = fx(0.82);
        for (const s of [1, -1]) parts.push(K.rod({ from: [xm + R * 0.2, s * R * 0.12, R * 0.95], to: [xm + R * 0.55, s * R * 0.5, R * 1.8], r: clamp(R * 0.012, 0.05, 0.2), material: 'trussDark', seg: 5 }));
        parts.push(K.cone({ from: 0, to: R * 0.22, r0: R * 0.05, r1: R * 0.11, at: onRing(fx(0.12), R * 0.98, D_), axis: radial(D_), material: 'sensor', caps: 'end', seg: 10 }));
        return parts;
      },
    },

    callouts(lay, defaults) {
      const { R, xMod, modLen, xCap, pds } = lay;
      // each point-defence laser on this hull feeds a pair of domes, so the line counts lasers and says how many domes
      const own = pds.length ? { 'Point defence': pds.length + (pds.length === 1 ? ' laser of ' : ' lasers of ') + mw1(pds[0].power) + ' MW, each feeding a pair of domes, shooting at inbound interceptors.' } : null;
      return retext(defaults, lay, own).concat([
        { label: 'Docking collar', text: 'The port-side collar where tenders dock and boarding tubes latch on.', at: [xMod + modLen * 0.3, R * 1.3, 0] },
        { label: 'Attitude thrusters', text: 'Thruster quads at the cap base and the shield rim' + flipWords(lay) + '.', at: [xCap + R * 0.1, 0, R * 1.2] },
      ]);
    },

    notes: 'The Halberd is the reference hull of both navies. A medium ogive armour cap sits on a plain drum crew module, an open truss spine carries four propellant tanks in two hoops, two sliding wing radiators sit ahead of the shadow shield and one torch bell closes the tail. The rail pair rides under the keel on standoff struts so its rails reach along the cap, stopping short of the tip with a braced muzzle. The ventral beam turret sits aft of the breech and aims astern, the dorsal turret amidships under the sensor mast. Twelve launch cells split port and starboard. Each point-defence laser feeds a pair of domes on opposite quarters, so the ring at the forward frame covers every approach. Attitude-thruster quads at the cap base and the shield rim, a port docking collar and a comms horn on the aft frame complete the standard fit.',
  });
})();
