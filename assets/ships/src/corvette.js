/* Kestrel-class corvette — hull family 'corvette'.
   Fast picket, 70 m. Lean and sharp: one long spinal beam tube runs the whole length of the ship, from the shadow
   shield through the open truss, the crew drum and a slim ogive armour cap, and out past the tip under a flared
   hood. A compact drum crew module carries the sensor mast; three slim propellant tanks (one ventral, two high on
   the flanks) each ride a longeron of a three-longeron truss, and the two wing radiators slide out through the
   gaps between them in a shallow V below the hull; one torch bell with coils. A single rail pair rides ventral
   on a keel carriage, a block of six launch cells sits on the starboard flank, one point-defence dome watches
   the dorsal-starboard quarter. Attitude thruster quads at the cap base and on the shadow shield rim give it the fast-turning look.
   The family builds on the default stages: the crew module and the tail (shadow shield, reactor, bell) are the
   core's; the cap, spinal tube, mounts, spine, tanks, radiators and sensor mast are its own, and an extras stage
   adds the recognisable detail. */
(function () {
  'use strict';
  const OD = window.OD;
  if (!OD || !OD.ShipArt) return;
  const KIT = OD.ShipArt.kit, V = KIT.V, clamp = KIT.clamp;
  const TAU = Math.PI * 2;
  // angles around the hull: y = cos a (port), z = sin a (dorsal)
  const onRing = (x, r, a) => [x, Math.cos(a) * r, Math.sin(a) * r];
  const radial = (a) => [0, Math.cos(a), Math.sin(a)];
  const tangent = (a) => V.cross(radial(a), [1, 0, 0]);
  const ringAngles = (k, a0) => { const out = []; for (let i = 0; i < k; i++) out.push(a0 + (i / k) * TAU); return out; };
  // truss longerons: the kit puts longeron k at phase + 2pi k/n - pi/2 in the angle convention above. Phase 0 with
  // three longerons gives -90, 30 and 150 degrees: one under each tank of the stock cluster, ventral tank first
  const TRUSS_PHASE = 0;
  const longeronAngles = (n) => { const out = []; for (let k = 0; k < n; k++) out.push(TRUSS_PHASE + (k * TAU) / n - Math.PI / 2); return out; };
  const angleDiff = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

  // ogive radius at fraction f of the cap (0 at the base, 1 at the tip): the same curve the cap stage lathes,
  // so struts and fittings can reach the skin exactly
  const ogiveR = (lay, f) => lay.tipR + (lay.R - lay.tipR) * Math.pow(Math.max(0, 1 - f * f), 0.62);
  // skin radius at x: the module drum, then the ogive; nothing forward of the tip or aft of the module
  function skinR(lay, x) {
    if (x < lay.xMod || x > lay.xNose) return 0;
    if (x <= lay.xCap) return lay.R;
    return ogiveR(lay, (x - lay.xCap) / lay.capLen);
  }
  // the truss stage and the tube hangers must agree on the ring-frame spacing
  const trussBays = (lay) => Math.max(3, Math.round(lay.spineLen / (lay.R * 1.1)));
  // where the beam tube overhangs the cap tip
  const muzzleX = (lay) => lay.xNose + lay.L * 0.1;
  // the Kestrel's tanks: slim and long, running nearly the whole truss (the radiator wings thread the gaps
  // between them), one per longeron: the single tank ventral, the other two high on the flanks, so the beam
  // tube and the truss show between them from above. More propellant makes them fatter, then adds tanks up to five.
  function kestrelTanks(lay) {
    const { D, R, spineR, xSpine, xMod, spineLen } = lay, T = D.tanks;
    const Vp = (D.propMass || 0) / (T.density || 1000);
    let n = Math.max(0, Math.round(T.count || 3));
    if (!(Vp > 0) || !n) return [];
    const from = xSpine + spineLen * 0.04, to = xMod - spineLen * 0.03, len = to - from;
    let r = Math.sqrt(Vp / (n * Math.PI * len * 0.8));
    while (r > 1.05 * R && n < 5) { n++; r = Math.sqrt(Vp / (n * Math.PI * len * 0.8)); }
    r = clamp(r, 0.35 * R, 1.05 * R);
    const dist = n === 1 ? 0 : spineR + r * (n <= 3 ? 1.0 : n === 4 ? 1.2 : 1.3);
    const a0 = n === 2 ? 0 : n === 4 ? Math.PI / 4 : -Math.PI / 2;
    const out = [];
    for (let i = 0; i < n; i++) { const a = a0 + (i / n) * TAU; out.push({ from, to, r, at: [0, Math.cos(a) * dist, Math.sin(a) * dist], a }); }
    return out;
  }
  // the clear directions between the tanks, where a radiator wing can leave the truss
  function tankGaps(tanks) {
    const n = tanks.length, out = [];
    if (n >= 2) for (let k = 0; k < n; k++) out.push(tanks[0].a + Math.PI / n + (k * TAU) / n);
    return out;
  }
  // attitude thruster block: a housing sitting on the skin with a dark nozzle cluster on its outer face
  function rcsBlock(K, x, r, a, s, facing) {
    const n = radial(a), t = tangent(a);
    const size = [s * 1.1, s * 0.85, s * 0.9];
    const at = V.add([x, 0, 0], V.scale(n, r + size[2] * 0.42));
    return [
      K.box({ at, size, frame: [[1, 0, 0], t, n], material: 'hullDark', facing }),
      K.box({ at: V.add(at, V.scale(n, size[2] * 0.5)), size: [s * 0.7, s * 0.5, s * 0.08], frame: [[1, 0, 0], t, n], material: 'dark', facing, noOutline: true }),
    ];
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

  OD.ShipArt.registerFamily('corvette', {
    name: 'Kestrel-class corvette',
    blurb: 'Fast picket hull, 70 m. The spinal laser sits in a tube that runs the whole ship, the coilgun rides a ventral keel, and the launch cells and the point-defence dome sit to starboard.',
    length: 70,
    radius: 0.046,                                                 // slim: 6.4 m across on 70 m
    cap: { len: 0.21, shape: 'ogive', tipR: 0.16, rings: true },   // long ogive, the tube runs out through the tip
    module: { len: 0.13, kind: 'drum' },                           // compact crew drum, plain hull on thin flanks
    spine: { kind: 'truss', n: 3, r: 0.62 },                       // three-longeron truss, one tank per longeron
    tanks: { arrangement: 'cluster', count: 3, material: 'tank', density: 1500, dome: 0.5 },   // slim: the truss must show between them
    radiators: { panels: 2, layout: 'wings', mode: 'slide', aspect: 3.2 },   // long narrow wings
    drive: { nozzles: 1 },                                         // the class exhaust velocity makes it a torch
    sensors: { mast: true, dish: 0.42 },
    accents: { bands: true },

    stages: {
      // ---- slim ogive armour cap. The tip is a small flat that the beam tube passes through.
      cap(K, c, lay) {
        const { R, xCap, xNose, capLen, A, F, tipR, spinal, spinalR } = lay, parts = [];
        const n = 8, prof = [[0, 0]];
        for (let i = 0; i <= n; i++) prof.push([capLen * (i / n), ogiveR(lay, i / n)]);
        prof.push([capLen, 0]);
        const thick = A.nose >= 25;
        parts.push(K.lathe({ at: [xCap, 0, 0], profile: prof, material: A.nose >= 12 ? 'armour' : 'hullDark', facing: 'nose' }));
        // plate rings: more of them as the nose armour thickens
        const rings = clamp(Math.round(1 + A.nose / 15), 1, 6);
        for (let i = 1; i <= rings; i++) {
          const f = i / (rings + 1);
          parts.push(K.torus({ at: [xCap + capLen * f, 0, 0], axis: 'x', R: ogiveR(lay, f), r: Math.max(0.12, R * (thick ? 0.03 : 0.02)), seg: c.seg, tube: 6, material: 'armourEdge', facing: 'nose' }));
        }
        // the faction collar at the cap base
        if (F.accents.bands) parts.push(K.cyl({ from: xCap - R * 0.02, to: xCap + R * 0.18, r: R * 1.03, material: 'accent', caps: 'none', facing: 'nose' }));
        // cheatlines: a thin accent stripe following the ogive on each flank (lathe arc: 0 ventral, pi/2 port). It is
        // built on the cap lathe's own vertex fractions and lifted clear of the skin, so its facets never cross the
        // cap's and it stays one continuous stripe rather than a row of patches
        if (F.accents.bands) {
          const w = 0.07, lift = Math.max(0.12, R * 0.03), sp = [];
          for (let i = 1; i < n; i++) { const f = i / n; if (f >= 0.1 && f <= 0.8) sp.push([capLen * f, ogiveR(lay, f) + lift]); }
          for (const a of [Math.PI / 2, Math.PI * 1.5]) parts.push(K.lathe({ at: [xCap, 0, 0], profile: sp, arc: [a - w, a + w], seg: 1, closeArc: false, material: 'accent', facing: 'nose' }));
        }
        // sensor blisters port and starboard at the cap base
        const rb = ogiveR(lay, 0.16) * 0.98;
        for (const a of [0, Math.PI]) parts.push(K.lathe({ at: onRing(xCap + capLen * 0.16, rb, a), axis: radial(a), profile: [[0, R * 0.12], [R * 0.06, R * 0.1], [R * 0.1, 0]], material: 'sensor', facing: 'nose', seg: 10 }));
        // nose lamp: rides the beam tube just past the tip, or sits on the tip when there is no tube
        if (spinal.length) parts.push(K.lamp({ at: [xNose + R * 0.25, 0, spinalR + R * 0.04], color: '#ffffff', r: R * 0.05 }));
        else parts.push(K.lamp({ at: [xNose + R * 0.05, 0, tipR * 0.5], color: '#ffffff', r: R * 0.06 }));
        return parts;
      },

      // ---- the spinal beam tube: the longest line on the ship. It leaves the shadow shield, runs down the
      // centre of the truss, enters the crew drum, and comes out of the cap tip under a flared hood.
      spinal(K, c, lay) {
        const { R, xSpine, xMod, modLen, xCap, capLen, spinalR, spinal } = lay, parts = [];
        if (!spinal.length) return parts;
        const r = spinalR, xMuz = muzzleX(lay), hood = r * 2.2;
        parts.push(K.cyl({ from: xSpine + R * 0.02, to: xMod + modLen * 0.1, r, material: 'mount', caps: 'none' }));
        parts.push(K.cyl({ from: xCap + capLen * 0.55, to: xMuz - hood, r, material: 'mount', caps: 'none', facing: 'nose' }));
        // flared hood with the aperture at its end
        parts.push(K.lathe({ at: [xMuz - hood, 0, 0], axis: 'x', profile: [[0, r * 0.98], [hood, r * 1.45], [hood, 0]], material: 'barrel', facing: 'nose' }));
        parts.push(K.lathe({ at: [xMuz + 0.01, 0, 0], axis: 'x', profile: [[0, r * 1.2], [0.02, r * 1.2], [0.02, 0]], material: 'sensor', facing: 'nose' }));
        // accent rings behind the hood, one per spinal beam sharing the tube
        for (let i = 0; i < spinal.length; i++) parts.push(K.torus({ at: [xMuz - hood - r * (0.6 + i * 0.9), 0, 0], axis: 'x', R: r * 1.06, r: r * 0.16, seg: c.seg, tube: 6, material: 'accent', facing: 'nose' }));
        // collar where the tube leaves the shadow shield
        parts.push(K.cyl({ from: xSpine + R * 0.02, to: xSpine + R * 0.22, r: r * 1.3, material: 'hullDark', caps: 'end' }));
        // the aperture: where the beam leaves the ship, for the live overlay
        parts.push(K.mark({ at: [xMuz + r * 0.2, 0, 0], dir: [1, 0, 0], role: 'spinal', index: lay.spinalIdx[0], r, hp: K.hp('beam', lay.spinalIdx[0]) }));
        return parts;
      },

      // ---- mounts: ventral rail pair on a keel carriage, launch cells on the starboard flank, dome turrets and
      // point-defence domes on the drum. Everything is strutted to the skin, including along the ogive. The drum is
      // short, so refits are kept apart along it: turrets on its aft third, cell blocks at mid-length, the two
      // point-defence domes at its front, the docking collar low on the port flank forward of the cells.
      mounts(K, c, lay) {
        const { R, L, xMod, modLen, xCap, capLen, turrets, coils, bays, pds, xShield, shieldR, shieldT } = lay, parts = [];
        // beam turrets (a refit): domes on the aft third of the drum, dorsal first, well clear of the mast and
        // of the cell blocks at mid-length
        const ta = turrets.length === 1 ? [Math.PI / 2] : turrets.length === 2 ? [Math.PI / 2 - 0.8, Math.PI / 2 + 0.8] : ringAngles(turrets.length, Math.PI / 2);
        turrets.forEach((m, i) => {
          const ap = m.aperture || 1, r = clamp(ap * 1.1, R * 0.18, R * 0.5);
          const x = xMod + modLen * (turrets.length > 2 && i % 2 ? 0.55 : 0.24);
          parts.push(K.turret({ at: onRing(x, R * 0.98, ta[i]), r, up: radial(ta[i]), aim: [1, 0, 0], barrel: ap * 0.9, barrelR: ap * 0.5, facing: 'flank', role: 'beam', index: lay.turretIdx[i] }));
        });
        // rail pairs: one on the keel line, two straddling it, more spread around the belly
        const ca = coils.length === 1 ? [-Math.PI / 2] : coils.length === 2 ? [-Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5] : ringAngles(coils.length, -Math.PI / 2);
        coils.forEach((m, i) => {
          const a = ca[i], k = Math.pow((m.muzzleVelocity || 4000) / 4000, 0.7);
          const railR = clamp(R * 0.09 * Math.pow(k, 0.4), 0.4, 2.2), gap = railR * 2.8;
          const x0 = xMod + modLen * 0.05;
          const x1 = Math.min(x0 + clamp(L * 0.42 * k, L * 0.22, L * 0.55), xCap + capLen * 0.74);
          const len = x1 - x0;
          const stand = R * 1.02 + railR * 1.9;
          const base = onRing(0, stand, a), side = tangent(a), n = radial(a);
          const at = (x, s) => V.add([x, base[1], base[2]], V.scale(side, s));
          for (const s of [1, -1]) parts.push(K.rod({ from: at(x0, s * gap / 2), to: at(x1, s * gap / 2), r: railR, material: 'barrel', seg: 8, facing: 'flank', hp: K.hp('coil', lay.coilIdx[i]) }));
          // keel carriage between the rails, breech block aft, muzzle block forward
          const chp = K.hp('coil', lay.coilIdx[i]);
          parts.push(K.mark({ at: at(x1 + railR, 0), dir: [1, 0, 0], up: n, role: 'coil', index: lay.coilIdx[i], r: railR, hp: chp }));
          parts.push(K.box({ at: [x0 + len / 2, base[1], base[2]], size: [len, gap * 0.55, railR * 2.2], frame: [[1, 0, 0], side, n], material: 'mount', facing: 'flank', hp: chp }));
          parts.push(K.box({ at: [x0 + len * 0.11, base[1], base[2]], size: [len * 0.22, gap + railR * 3.4, railR * 3.4], frame: [[1, 0, 0], side, n], material: 'mount', facing: 'flank' }));
          parts.push(K.box({ at: [x1 - railR * 1.6, base[1], base[2]], size: [railR * 3.2, gap + railR * 2.8, railR * 2.6], frame: [[1, 0, 0], side, n], material: 'mount', facing: 'flank' }));
          // hangers down to the skin, following the ogive where the rails run past the drum
          const struts = Math.max(2, Math.round(len / (R * 1.2)));
          for (let j = 0; j <= struts; j++) {
            const x = x0 + (len * j) / struts, s = skinR(lay, x);
            if (s < R * 0.45) break;
            parts.push(K.rod({ from: onRing(x, s * 0.96, a), to: [x, base[1], base[2]], r: railR * 0.45, material: 'trussDark', seg: 5, facing: 'flank' }));
          }
        });
        // launch cells: one block on the starboard flank, a second block to port when there is more than one bay
        if (bays.length) {
          const total = bays.reduce((s, b) => s + (b.count || 6), 0);
          const blocks = Math.min(bays.length, 2), per = Math.ceil(total / blocks);
          const cell = clamp(R * 0.2, 0.55, 2.4);
          const cols = Math.ceil(Math.sqrt(per * 1.5)), rows = Math.ceil(per / cols);
          const angs = blocks === 1 ? [Math.PI - 0.55] : [Math.PI - 0.55, 0.55];
          angs.forEach((a, bi) => parts.push(K.cells({ at: onRing(xMod + modLen * 0.5, R * 0.97, a), normal: radial(a), frame: [[1, 0, 0], tangent(a)], rows, cols, cell, depth: cell * 0.7, facing: 'flank', role: 'bay', index: lay.bayIdx[Math.min(bi, lay.bayIdx.length - 1)] })));
        }
        // point-defence domes: dorsal-starboard on the drum front first, its dorsal-port twin second (both forward
        // of any turret ring and of the cell blocks), then around the hull
        const spots = [
          [xMod + modLen * 0.8, R, Math.PI / 2 + 0.85], [xMod + modLen * 0.8, R, Math.PI / 2 - 0.85],
          [xCap + capLen * 0.08, ogiveR(lay, 0.08), Math.PI * 0.75], [xCap + capLen * 0.08, ogiveR(lay, 0.08), -Math.PI * 0.2],
          [xShield + shieldT * 0.5, shieldR * 0.86, Math.PI / 2], [xShield + shieldT * 0.5, shieldR * 0.86, -Math.PI / 2],
        ];
        pds.forEach((m, i) => {
          const s = spots[i % spots.length], r = clamp(R * 0.16, 0.4, 1.6);
          parts.push(K.turret({ at: onRing(s[0], s[1] * 0.98, s[2]), r, up: radial(s[2]), aim: [1, 0, 0], barrel: r * 0.7, barrelR: r * 0.22, facing: s[0] < xMod ? 'tail' : 'flank', role: 'pd', index: lay.pdIdx[i] }));
        });
        return parts;
      },

      // ---- open truss with the beam tube hung at its centre and two service conduits low on the lattice
      spine(K, c, lay) {
        const { xSpine, xMod, spineR, spineLen, R, F, spinalR } = lay, parts = [];
        const bays = trussBays(lay), n = F.spine.n;
        parts.push(K.truss({ from: [xSpine, 0, 0], to: [xMod, 0, 0], r: spineR, n, bays, phase: TRUSS_PHASE, member: clamp(R * 0.05, 0.12, 1.2) }));
        const cr = clamp(R * 0.035, 0.1, 0.6);
        for (const s of [1, -1]) parts.push(K.rod({ from: [xSpine, s * spineR * 0.45, -spineR * 0.55], to: [xMod, s * spineR * 0.45, -spineR * 0.55], r: cr, material: 'trussDark', seg: 5 }));
        // tube hangers out to the longerons at every second ring frame
        if (spinalR > 0) {
          for (let i = 2; i < bays; i += 2) {
            const x = xSpine + (spineLen * i) / bays;
            for (const a of longeronAngles(n)) parts.push(K.rod({ from: onRing(x, spinalR * 0.9, a), to: onRing(x, spineR, a), r: cr * 0.8, material: 'trussDark', seg: 5 }));
          }
        }
        return parts;
      },

      // ---- three slim tanks the length of the truss, strapped to the longerons and to each other
      tanks(K, c, lay) {
        const { R, spinalR, D, F } = lay, parts = [];
        const tanks = kestrelTanks(lay);
        lay.tanks = tanks;   // the radiator and extras stages work from these
        const sr = clamp(R * 0.05, 0.12, 1);
        tanks.forEach((t, ti) => {
          parts.push(K.tank({ from: t.from, to: t.to, r: t.r, at: t.at, material: D.tanks.material || 'tank', dome: D.tanks.dome === undefined ? 0.5 : D.tanks.dome, facing: 'flank', role: 'tank', index: ti }));
          if (F.accents.bands) parts.push(K.torus({ at: [t.to - (t.to - t.from) * 0.2, t.at[1], t.at[2]], axis: 'x', R: t.r * 1.01, r: Math.max(0.1, t.r * 0.035), seg: c.seg, tube: 5, material: 'accent', facing: 'flank' }));
          if (Math.hypot(t.at[1], t.at[2]) === 0) return;
          // cradle straps: a rod from the truss core to the tank and a band around it, at three frames
          for (const f of [0.15, 0.5, 0.85]) {
            const x = t.from + (t.to - t.from) * f;
            parts.push(K.rod({ from: onRing(x, spinalR > 0 ? spinalR * 0.9 : 0, t.a), to: [x, t.at[1], t.at[2]], r: sr, material: 'trussDark', seg: 5, facing: 'flank' }));
            parts.push(K.torus({ at: [x, t.at[1], t.at[2]], axis: 'x', R: t.r * 1.005, r: Math.max(0.08, t.r * 0.03), seg: c.seg, tube: 4, material: 'trussDark', facing: 'flank' }));
          }
        });
        return parts;
      },

      // ---- radiator wings leave the truss through the gaps between the tanks (a shallow V, pointing ventral on
      // the stock three-tank cluster); each panel snaps to the nearest free gap and its root manifold sits on the
      // truss face there, so a stowed wing's stub stays inside the truss ring. Once the gaps are used up (the
      // four-panel cross layout on three tanks) a panel mounts outboard of the nearest tank instead.
      radiators(K, c, lay) {
        const { rads, R, spineR, tanks, F } = lay, parts = [], s = c.state;
        const gaps = tankGaps(tanks), longerons = longeronAngles(F.spine.n);
        const faceR = spineR * Math.cos(Math.PI / F.spine.n) + R * 0.12;   // just outside the truss face between two longerons
        const core = lay.spinalR > 0 ? lay.spinalR * 0.9 : 0;
        rads.forEach((r, ri) => {
          let dir = r.dir, root, inner;
          const a = Math.atan2(r.dir[2], r.dir[1]);
          if (tanks.length === 1) { root = tanks[0].r + R * 0.12; inner = tanks[0].r * 0.9; }
          else if (gaps.length) {
            let best = -1, bd = 1e9;
            gaps.forEach((g, i) => { const d = angleDiff(g, a) - (Math.sin(g) > 0.01 ? 1e-3 : 0); if (d < bd) { bd = d; best = i; } });
            const g = gaps[best]; gaps.splice(best, 1);
            dir = radial(g);
            // on the truss face, or on the longeron itself when a gap lies over one (two, four or five tanks)
            root = longerons.some((la) => angleDiff(g, la) < 0.15) ? spineR + R * 0.12 : faceR;
            inner = core;
          } else if (tanks.length) {
            let t = tanks[0];
            tanks.forEach((k) => { if (angleDiff(k.a, a) < angleDiff(t.a, a)) t = k; });
            const d = Math.hypot(t.at[1], t.at[2]);
            dir = radial(t.a); root = d + t.r + R * 0.12; inner = d + t.r * 0.9;
          } else { root = faceR; inner = core; }
          r.dir = dir; r.at = [r.at[0], dir[1] * root, dir[2] * root];
          parts.push(K.radiator({ at: r.at, span: r.span, chord: r.chord, dir, along: [1, 0, 0], deploy: s.radiators, mode: r.mode, foldAxis: V.cross([1, 0, 0], dir), foldSign: 1, tubes: clamp(Math.round(r.chord / (R * 0.35)), 3, 12), thick: Math.max(0.25, R * 0.035), role: 'rad', index: ri }));
          parts.push(K.box({ at: [r.at[0], dir[1] * (root - R * 0.08), dir[2] * (root - R * 0.08)], size: [r.chord * 1.04, R * 0.22, R * 0.28], frame: [[1, 0, 0], V.cross([1, 0, 0], dir), dir], material: 'hullDark' }));
          // coolant trunk from the truss core (or the tank skin) out to the manifold
          parts.push(K.rod({ from: V.add([r.at[0], 0, 0], V.scale(dir, inner)), to: V.add([r.at[0], 0, 0], V.scale(dir, root - R * 0.1)), r: clamp(R * 0.05, 0.12, 0.8), material: 'trussDark', seg: 6 }));
        });
        return parts;
      },

      // ---- sensor mast: tall and thin on the drum, dish on top, planar array and telescope box on the way up,
      // two whip antennas aft of it
      sensors(K, c, lay) {
        const { R, xMod, modLen, F } = lay, parts = [];
        if (!F.sensors.mast) return parts;
        const x = xMod + modLen * 0.62, mastH = clamp(R * 1.5, 2, 16), mr = clamp(R * 0.05, 0.12, 0.6);
        parts.push(K.rod({ from: [x, 0, R * 0.9], to: [x, 0, R + mastH], r: mr, material: 'truss', seg: 6, facing: 'flank' }));
        parts.push(K.rod({ from: [x - R * 0.7, 0, R * 0.92], to: [x, 0, R + mastH * 0.5], r: mr * 0.6, material: 'trussDark', seg: 5, facing: 'flank' }));
        const dr = clamp(R * (F.sensors.dish || 0.5), 0.8, 9);
        parts.push(K.dish({ at: [x + dr * 0.1, 0, R + mastH], r: dr, depth: dr * 0.3, axis: [0.8, 0, 0.6], facing: 'flank' }));
        parts.push(K.rod({ from: [x, 0, R + mastH], to: [x + dr * 0.45, 0, R + mastH + dr * 0.35], r: mr * 0.6, material: 'trussDark', seg: 5, facing: 'flank' }));
        parts.push(K.box({ at: [x + R * 0.08, 0, R + mastH * 0.62], size: [R * 0.14, R * 0.9, R * 0.3], material: 'sensor', facing: 'flank' }));
        parts.push(K.box({ at: [x, 0, R + mastH * 0.3], size: [R * 0.36, R * 0.42, R * 0.14], material: 'dish', facing: 'flank' }));
        for (const s of [1, -1]) parts.push(K.rod({ from: onRing(xMod + modLen * 0.3, R * 0.9, Math.PI / 2 + s * 0.35), to: onRing(xMod + modLen * 0.2, R * 1.75, Math.PI / 2 + s * 0.6), r: mr * 0.4, material: 'trussDark', seg: 4, facing: 'flank' }));
        return parts;
      },

      // ---- family detail: attitude thruster quads, tank cluster braces, docking collar
      extras(K, c, lay) {
        const { R, xCap, capLen, xMod, modLen, xShield, shieldR, tanks, D } = lay, parts = [];
        // attitude thruster quads: at the cap base and on the shadow shield rim, sized by the class turn rate
        const s = R * 0.3 * clamp(Math.sqrt((D.angAccel || 0.03) / 0.03), 0.7, 1.6);
        const xr = xCap + R * 0.36, rr = ogiveR(lay, (xr - xCap) / capLen);
        for (const a of ringAngles(4, Math.PI / 4)) parts.push(rcsBlock(K, xr, rr, a, s, 'nose'));
        for (const a of ringAngles(4, Math.PI / 4)) parts.push(K.box({ at: onRing(xShield + s * 0.5, shieldR * 0.76, a), size: [s, s * 0.85, s * 0.9], frame: [[1, 0, 0], tangent(a), radial(a)], material: 'hullDark', facing: 'tail' }));
        // cross braces between neighbouring tanks at the strap frames
        if (tanks.length > 1) {
          const br = clamp(R * 0.04, 0.1, 0.8);
          for (let i = 0; i < tanks.length; i++) {
            const t0 = tanks[i], t1 = tanks[(i + 1) % tanks.length];
            if (tanks.length === 2 && i === 1) break;
            const d = V.sub(t1.at, t0.at), dl = V.len(d);
            if (dl < t0.r + t1.r + 0.3) continue;   // tanks touch: no room for a brace
            const u = V.scale(d, 1 / dl);
            for (const f of [0.42, 0.8]) {   // forward of the radiator wings
              const x = t0.from + (t0.to - t0.from) * f;
              parts.push(K.rod({ from: V.add([x, t0.at[1], t0.at[2]], V.scale(u, t0.r * 0.97)), to: V.add([x, t1.at[1], t1.at[2]], V.scale(u, -t1.r * 0.97)), r: br, material: 'trussDark', seg: 5, facing: 'flank' }));
            }
          }
        }
        // docking collar low on the port flank at the drum front, opposite the launch cells and forward of the
        // port navigation lamp
        const da = -0.35, dc = onRing(xMod + modLen * 0.72, R * 0.96, da);
        parts.push(K.lathe({ at: dc, axis: radial(da), profile: [[0, R * 0.3], [R * 0.14, R * 0.3], [R * 0.14, R * 0.22], [R * 0.17, R * 0.22], [R * 0.17, 0]], material: 'hullDark', seg: 12, facing: 'flank' }));
        parts.push(K.lathe({ at: V.add(dc, V.scale(radial(da), R * 0.175)), axis: radial(da), profile: [[0, R * 0.17], [0.02, R * 0.17], [0.02, 0]], material: 'dark', seg: 12, facing: 'flank' }));
        return parts;
      },
    },

    callouts(lay, defaults) {
      const tanks = kestrelTanks(lay);
      const top = tanks.reduce((b, t) => (b && b.at[2] >= t.at[2] ? b : t), null);
      const out = retext(defaults, lay).map((d) => (d.label === 'Propellant tanks' && top ? Object.assign({}, d, { at: [(top.from + top.to) / 2, top.at[1], top.at[2] + top.r] }) : d));
      if (lay.spinal.length) out.push({ label: 'Beam tube hood', text: 'The spinal laser fires down this tube, which runs the whole hull and past the tip.', at: [muzzleX(lay), 0, lay.spinalR * 1.4] });
      out.push({ label: 'Attitude thrusters', text: 'Thruster quads at the cap base and the shield rim' + flipWords(lay) + '.', at: [lay.xCap + lay.R * 0.36, 0, lay.R * 1.2] });
      return out;
    },

    notes: 'The Kestrel is built around the spinal beam tube, the longest line on the ship, and everything else hangs off it. The ogive cap is long and slim, because the flanks were never meant to take fire, and the crew drum is short while the sensor mast is tall for a hull this size. Three slim tanks ride a three-longeron truss, one ventral and two high on the flanks, so the tube shows between them, and the two radiator wings slide out through the gaps in a shallow V below the hull. One torch bell sits behind a shadow shield ringed with attitude-thruster quads. The rail pair is carried on a ventral keel that runs under the drum and along the cap. The launch cells and the point-defence dome sit on the starboard side, opposite the docking collar.',
  });
})();
