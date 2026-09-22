/* Lancer-class interceptor carrier — hull family 'lancer'.
   A 90 m missile boat built round its magazine: two long launch-cell housings ("quivers") on the crew-module
   flanks, each with twelve forward-facing cells; a short, thin fairing for a cap and no spinal tube; one
   point-defence dome; four big propellant tanks in a diamond round an open truss spine; two wing radiators that
   swing forward on a vertical hinge to stow in the slot between the tank pairs; twin torch bells behind the
   shadow shield (the one 90 m hull with two bells, so it reads on the map). Registered with OD.ShipArt.registerFamily; see assets/ships/src/README.md. */
(function () {
  'use strict';
  const OD = window.OD;
  if (!OD || !OD.ShipArt) return;
  const KIT = OD.ShipArt.kit, V = KIT.V, clamp = KIT.clamp, S = OD.ShipArt.stages;
  const PI = Math.PI;
  const onRing = (x, r, a) => [x, Math.cos(a) * r, Math.sin(a) * r];
  const radial = (a) => [0, Math.cos(a), Math.sin(a)];

  // ---- the launch-cell housings: one long box on each flank of the module, cells on the forward face ----
  function quivers(lay) {
    const { R, xMod, modLen, xCap, capLen, bays } = lay;
    if (!bays.length) return null;
    const total = bays.reduce((s, b) => s + (b.count || 6), 0);
    const per = Math.max(1, Math.ceil(total / 2));
    // grid that fits the count with the fewest empty slots, a little taller than wide (cols across the beam,
    // rows stacked dorsal to ventral)
    let cols = 1, rows = per, best = Infinity;
    for (let cc = 1; cc <= 6; cc++) { const rr = Math.ceil(per / cc), score = (cc * rr - per) * 2 + Math.abs(rr / cc - 1.35); if (score < best) { best = score; cols = cc; rows = rr; } }
    let cell = clamp(R * 0.24, 0.45, 2.0);
    cell = Math.min(cell, (2.1 * R) / (1.2 * rows - 0.2));                 // the block stays within ~2R tall
    const gap = cell * 0.2;
    const W = cols * (cell + gap) - gap, H = rows * (cell + gap) - gap;
    const m = cell * 0.3;                                                  // housing wall round the cell frame
    const sy = W + 2 * m, sz = H + 2 * m, hz = sz / 2;
    // the housing's inboard face stands a little off the hull (the flat face clears the pressure cylinder even on
    // the wing plane, where the hull is widest), so the whole cell face sits outboard of the module and the fairing
    // ahead of it; a short pylon stub and two straps carry it
    const yIn = R * 1.06;
    const yOut = yIn + sy;
    const depth = cell * 0.5;                                              // door-frame plate depth
    const xFace = xCap + Math.min(capLen * 0.22, R * 0.5);                 // cell mouths just ahead of the module front
    const len = Math.min(modLen * 0.86, xFace - depth - (xMod + R * 0.2));
    return { per, cols, rows, cell, gap, W, H, m, sy, sz, hz, yIn, yOut, depth, xFace, len, xBack: xFace - depth - len, yc: yIn + sy / 2 };
  }

  // four tanks go in a diamond: a port pair and a starboard pair, leaving a clear slot on the wing plane where the
  // radiators stow. Other counts keep the core's cluster placement.
  function placeTanks(lay) {
    const { tanks, R, spineR } = lay;
    if (tanks.length !== 4) return;
    const r = tanks[0].r, a = (50 * PI) / 180;
    const dist = Math.max(spineR + r * 1.05, r / Math.cos(a) + R * 0.04);
    [[1, 1], [-1, 1], [-1, -1], [1, -1]].forEach(([sy, sz], i) => { tanks[i].at = [0, sy * Math.cos(a) * dist, sz * Math.sin(a) * dist]; });
  }

  // can a wing radiator swing forward flat in its own plane without cutting a tank, reaching the module, or lying
  // over another panel of the same wing (a second set of panels shares the slot)?
  function stowClear(lay, r, hinge, dir, n, thick) {
    if (hinge[0] + r.span > lay.xMod - lay.R * 0.15) return false;
    for (const o of lay.rads) {
      if (o === r || V.dot(V.norm(o.dir), dir) < 0.99) continue;
      const h = o.at[0] + o.chord / 2;                                   // the other panel's hinge
      if (Math.abs(h - hinge[0]) < r.span + o.chord) return false;        // its root or its stowed panel lies in this swing
    }
    const x0 = hinge[0] - r.chord, x1 = hinge[0] + r.span;
    const u0 = V.dot(hinge, dir), u1 = u0 + r.span;
    for (const t of lay.tanks) {
      const rb = t.r * 1.01 + Math.max(0.1, t.r * 0.035);                 // tank plus its band
      if (Math.abs(V.dot(t.at, n)) - rb > thick * 0.5 + 0.08) continue;   // clear of the panel's plane
      if (t.to < x0 || t.from > x1) continue;
      const u = V.dot(t.at, dir);
      if (u + rb < u0 || u - rb > u1) continue;
      return false;
    }
    return true;
  }

  // a chamfered end on a box: four side quads and an end cap, shrinking from the box's face to a smaller rectangle
  function taper(K, x, yc, zc, hy, hz, dx, k, material, facing) {
    const a = [[x, yc - hy, zc - hz], [x, yc + hy, zc - hz], [x, yc + hy, zc + hz], [x, yc - hy, zc + hz]];
    const b = a.map((p) => [x - dx, yc + (p[1] - yc) * k, zc + (p[2] - zc) * k]);
    const parts = [];
    for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; parts.push(K.poly({ pts: [a[i], b[i], b[j], a[j]], material, twoSided: true, facing })); }
    parts.push(K.poly({ pts: [b[3], b[2], b[1], b[0]], material, twoSided: true, facing }));
    return parts;
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

  OD.ShipArt.registerFamily('lancer', {
    name: 'Lancer-class interceptor carrier',
    blurb: 'Nearly all magazine, 90 m. Twenty-four interceptors ride in two forward-facing quivers on the crew module, and one point-defence dome is the only other mount.',
    length: 90,
    radius: 0.048,
    cap: { len: 0.1, shape: 'ogive', tipR: 0.13, rings: false },
    module: { len: 0.24, kind: 'cylinder' },
    spine: { kind: 'truss', n: 4, r: 0.55 },
    tanks: { arrangement: 'cluster', count: 4, material: 'tank', density: 700, dome: 0.6 },
    radiators: { panels: 2, layout: 'wings', mode: 'fold', aspect: 2.6 },
    drive: { nozzles: 2 },
    sensors: { mast: true, dish: 0.5 },
    accents: { bands: true },
    stages: {
      // short, thin fairing: a slender ogive on a base a little narrower than the hull, stepped down from the
      // module by a collar that carries the faction colour; a telescope aperture at the tip
      cap(K, c, lay) {
        const { R, xCap, xNose, capLen, A, tipR } = lay, parts = [];
        const thick = A.nose >= 25;
        const base = R * (thick ? 0.94 : 0.86), tip = Math.max(tipR, R * 0.1 * lay.noseF);
        const n = 7, prof = [[0, 0]];
        for (let i = 0; i <= n; i++) { const f = i / n; prof.push([capLen * f, tip + (base - tip) * Math.pow(1 - f * f, thick ? 0.55 : 0.72)]); }
        prof.push([capLen, 0]);
        parts.push(K.lathe({ at: [xCap, 0, 0], profile: prof, material: thick ? 'armour' : 'hullDark', facing: 'nose' }));
        parts.push(K.lathe({ at: [xCap - R * 0.12, 0, 0], profile: [[0, R * 1.015], [R * 0.12, R * 1.015], [R * 0.18, base * 1.01]], material: 'accent', facing: 'nose' }));   // core band width
        // plate rings only when the nose facing carries real armour
        const rings = thick ? Math.round(1 + A.nose / 15) : 1;
        for (let i = 1; i <= rings; i++) { const f = i / (rings + 1); const p = prof[Math.round(f * n) + 1]; parts.push(K.torus({ at: [xCap + p[0], 0, 0], axis: 'x', R: p[1], r: Math.max(0.1, R * (thick ? 0.03 : 0.018)), seg: c.seg, tube: 5, material: 'armourEdge', facing: 'nose' })); }
        // sensor blisters at the cap base, dorsal and ventral
        for (const a of [PI / 2, -PI / 2]) { const p = onRing(xCap + capLen * 0.18, prof[2][1] * 0.985, a); parts.push(K.lathe({ at: p, axis: radial(a), profile: [[0, R * 0.13], [R * 0.06, R * 0.11], [R * 0.1, 0]], material: 'sensor', facing: 'nose', seg: 10 })); }
        // long-range telescope aperture in the tip, and the nose lamp
        parts.push(K.lathe({ at: [xNose - 0.02, 0, 0], axis: 'x', profile: [[0, tip * 0.92], [0.06, tip * 0.92], [0.06, 0]], material: 'sensor', facing: 'nose', seg: 10 }));
        parts.push(K.lamp({ at: [xNose + R * 0.05, 0, 0], color: '#ffffff', r: R * 0.06 }));
        return parts;
      },
      // crew module: a plain pressure cylinder; the quivers on its flanks are drawn by the mounts stage
      module(K, c, lay) {
        const { R, xMod, modLen, A } = lay, parts = [];
        const mat = A.flank >= 15 ? 'armour' : 'hull';
        parts.push(K.tank({ from: xMod, to: xMod + modLen, r: R, material: mat, dome: 0.14, facing: 'flank' }));
        if (A.flank >= 8) {
          const k = clamp(Math.round(A.flank / 6), 2, 6);
          for (const a of [PI / 2, -PI / 2, PI / 4, (3 * PI) / 4, -PI / 4, (-3 * PI) / 4].slice(0, k)) { const p = onRing(xMod + modLen * 0.5, R * 0.99, a); parts.push(K.box({ at: p, size: [modLen * 0.6, R * 0.16, R * 0.06], frame: [[1, 0, 0], V.cross(radial(a), [1, 0, 0]), radial(a)], material: 'armourEdge', facing: 'flank' })); }
        }
        // dim faction band at the rear of the module, and frame rings where the quiver straps land
        parts.push(K.cyl({ from: xMod + modLen * 0.06, to: xMod + modLen * 0.13, r: R * 1.02, material: 'accentDim', caps: 'none', facing: 'flank' }));
        const q = quivers(lay);
        if (!q) {
          parts.push(K.lamp({ at: [xMod + modLen * 0.55, R * 1.02, 0], color: '#ff5a4a', r: R * 0.05 }));
          parts.push(K.lamp({ at: [xMod + modLen * 0.55, -R * 1.02, 0], color: '#5aff7a', r: R * 0.05 }));
        }
        return parts;
      },
      // the quivers, then the point-defence domes on the module's dorsal and ventral lines
      mounts(K, c, lay) {
        const { R, xMod, modLen, xCap, capLen, pds } = lay, parts = [];
        const q = quivers(lay);
        if (q) {
          const { sy, sz, yc, yIn, yOut, xFace, len, depth, cell, rows, cols, gap } = q;
          const xc = xFace - depth - len / 2 + R * 0.02;
          [1, -1].forEach((s, bi) => {
            const y = s * yc;
            const bidx = lay.bayIdx[Math.min(bi, Math.max(0, lay.bayIdx.length - 1))];
            parts.push(K.box({ at: [xc, y, 0], size: [len + R * 0.04, sy, sz], material: 'hull', facing: 'flank', hp: K.hp('bay', bidx) }));
            parts.push(K.cells({ at: [xFace, y, 0], normal: [1, 0, 0], frame: [[0, s, 0], [0, 0, 1]], rows, cols, cell, gap, depth, facing: 'flank', role: 'bay', index: bidx }));
            // chamfered aft end
            parts.push(taper(K, xFace - depth - len, y, 0, sy / 2, sz / 2, cell * 0.9, 0.6, 'hullDark', 'flank'));
            // pylon stub from inside the hull to the housing's inboard face (its visible length is the stand-off),
            // two straps round housing and hull, an accent strap at the mouth
            const yRoot = R * 0.8, yTop = yIn + R * 0.04;
            parts.push(K.box({ at: [xc, s * (yRoot + yTop) / 2, 0], size: [len * 0.72, yTop - yRoot, sz * 0.4], material: 'hullDark', facing: 'flank' }));
            for (const f of [0.34, 0.74]) parts.push(K.box({ at: [xFace - depth - len * f, s * (yOut + R * 0.03) / 2, 0], size: [cell * 0.42, yOut + R * 0.03, sz + R * 0.06], material: 'hullDark', facing: 'flank' }));
            parts.push(K.box({ at: [xFace - depth - cell * 0.55, y, 0], size: [cell * 0.3, sy + R * 0.05, sz + R * 0.05], material: 'accentDim', facing: 'flank' }));
            // one long access seam per row of cells on the outboard face, so the flank reads as a tube housing
            for (let i = 0; i < rows; i++) { const z = -q.H / 2 + cell / 2 + i * (cell + gap); parts.push(K.box({ at: [xc, s * (yOut + 0.03), z], size: [len * 0.84, 0.06, cell * 0.14], material: 'dark', facing: 'flank', noOutline: true })); }
            // navigation lamp on the outboard face
            parts.push(K.lamp({ at: [xFace - depth - len * 0.5, s * (yOut + 0.05), sz * 0.36], color: s > 0 ? '#ff5a4a' : '#5aff7a', r: R * 0.05 }));
          });
        }
        // point-defence domes: dorsal first, then ventral, then a forward pair on the module, then a pair standing on
        // the accent collar at the cap base (on the collar's surface, so the domes are not buried in the ring)
        const spots = [[xMod + modLen * 0.4, R, PI / 2], [xMod + modLen * 0.4, R, -PI / 2], [xMod + modLen * 0.2, R, PI / 2], [xMod + modLen * 0.2, R, -PI / 2], [xCap - R * 0.08, R * 1.02, PI / 2], [xCap - R * 0.08, R * 1.02, -PI / 2]];
        pds.forEach((m, i) => { const s = spots[i % spots.length]; const r = clamp(R * 0.17, 0.35, 1.8); parts.push(K.turret({ at: onRing(s[0], s[1], s[2]), r, up: radial(s[2]), aim: [1, 0, 0], barrel: r * 0.8, barrelR: r * 0.24, facing: 'flank', role: 'pd', index: lay.pdIdx[i] })); });
        return parts;
      },
      tanks(K, c, lay) { placeTanks(lay); return S.tanks(K, c, lay); },
      // wing radiators on a vertical hinge at the forward inboard corner: they swing forward to lie in the slot
      // between the tank pairs. When a design's tanks, panel size or a second set of wings would foul that swing, the
      // panel slides instead.
      radiators(K, c, lay) {
        const { rads, R, spineR } = lay, parts = [], st = c.state;
        const thick = Math.max(0.25, R * 0.035);
        rads.forEach((r, ri) => {
          const along = [1, 0, 0], dir = V.norm(r.dir), n = V.norm(V.cross(along, dir));
          const hinge = V.add(r.at, V.scale(along, r.chord / 2));
          let mode = r.mode === 'slide' ? 'slide' : 'fold';
          if (mode === 'fold' && !stowClear(lay, r, hinge, dir, n, thick)) mode = 'slide';
          const p = K.radiator({ at: r.at, span: r.span, chord: r.chord, dir, along, deploy: mode === 'slide' ? st.radiators : 1, mode, tubes: clamp(Math.round(r.chord / (R * 0.35)), 3, 12), thick, role: 'rad', index: ri });
          if (mode === 'fold' && st.radiators < 1) p.rot = [n, -(PI / 2) * (1 - st.radiators), hinge];
          parts.push(p);
          // coolant manifold along the root, the hinge knuckle at its forward end, a bracket back to the spine
          const side = V.cross(along, dir);
          parts.push(K.box({ at: V.add(r.at, V.scale(dir, -R * 0.08)), size: [r.chord * 1.04, R * 0.22, R * 0.28], frame: [along, side, dir], material: 'hullDark' }));
          parts.push(K.rod({ from: V.add(hinge, V.scale(n, -R * 0.17)), to: V.add(hinge, V.scale(n, R * 0.17)), r: R * 0.055, material: 'mount', seg: 8 }));
          parts.push(K.rod({ from: V.add([hinge[0], 0, 0], V.scale(dir, spineR * 0.9)), to: V.add(hinge, V.scale(dir, 0.02)), r: R * 0.04, material: 'trussDark', seg: 5 }));
        });
        return parts;
      },
      // details: docking collar, forward whip antennas, dorsal conduits, attitude thruster blocks
      extras(K, c, lay) {
        const { R, xMod, modLen, xCap, capLen } = lay, parts = [];
        // ventral docking collar
        const xd = xMod + modLen * 0.58, rd = R * 0.24;
        parts.push(K.cyl({ from: -R * 0.9, to: -R * 1.14, r: rd, at: [xd, 0, 0], axis: 'z', material: 'hullDark', facing: 'flank' }));
        parts.push(K.torus({ at: [xd, 0, -R * 1.14], axis: 'z', R: rd * 1.05, r: rd * 0.16, seg: c.seg, tube: 5, material: 'accentDim', facing: 'flank' }));
        parts.push(K.lathe({ at: [xd, 0, -R * 1.145], axis: [0, 0, -1], profile: [[0, rd * 0.7], [0.03, rd * 0.7], [0.03, 0]], material: 'dark', facing: 'flank', seg: 10 }));
        // whip antennas off the fairing, one a side mirrored across the centreline, angled forward and out
        for (const s of [1, -1]) { const a = s > 0 ? PI * 0.35 : PI - PI * 0.35; const p = onRing(xCap + capLen * 0.3, R * 0.7, a); parts.push(K.rod({ from: p, to: V.add(p, [capLen * 0.45, Math.cos(a) * R * 0.9, Math.sin(a) * R * 0.9]), r: clamp(R * 0.02, 0.06, 0.25), material: 'trussDark', seg: 5, facing: 'nose' })); }
        // dorsal conduits along the module
        for (const s of [1, -1]) parts.push(K.rod({ from: [xMod + modLen * 0.16, s * R * 0.14, R * 0.99], to: [xMod + modLen * 0.9, s * R * 0.14, R * 0.99], r: clamp(R * 0.03, 0.08, 0.5), material: 'trussDark', seg: 5, facing: 'flank' }));
        // attitude thruster blocks on the module's forward ring, between the quivers and the mast line
        for (const a of [PI / 4, (3 * PI) / 4, -PI / 4, (-3 * PI) / 4]) { const p = onRing(xCap - R * 0.5, R * 0.98, a); parts.push(K.box({ at: p, size: [R * 0.2, R * 0.15, R * 0.12], frame: [[1, 0, 0], V.cross(radial(a), [1, 0, 0]), radial(a)], material: 'hullDark', facing: 'flank' })); }
        return parts;
      },
    },
    callouts(lay, defaults) {
      placeTanks(lay);
      const q = quivers(lay);
      const own = {
        'Armour cap': lay.A.nose + ' cm on the nose and ' + lay.A.flank + ' cm on the flanks, thin for a warship.',
      };
      if (lay.rads.length) own.Radiators = grp(lay.D.radiatorArea || 0) + ' m\u00b2 on two wings that swing forward to stow between the tanks, shedding up to ' + radMW(lay.D)
        + ' MW, at their full ' + grp(lay.D.radiatorTemp || 1000) + ' K only once the sink is over ' + kneePct() + ' %.';
      const out = retext(defaults, lay, own).map((d) => {
        if (d.label === 'Launch cells' && q) return Object.assign({}, d, { text: q.per * 2 + ' interceptors in two forward-facing quivers, ' + q.per + ' a side.', at: [q.xFace, q.yc, q.hz] });
        if (d.label === 'Propellant tanks' && lay.tanks.length) { const t = lay.tanks[0]; return Object.assign({}, d, { at: [(t.from + t.to) / 2, t.at[1], t.at[2] + t.r] }); }
        return d;
      });
      return out;
    },
    notes: 'The Lancer carries little but its magazine. Two quivers of forward-facing launch cells take up most of the crew module, twelve a side, carried on pylons and straps outboard of the pressure hull so every cell mouth clears the nose. The cap is a short unarmoured fairing with a telescope in the tip and no spinal tube, and a single point-defence dome sits on the dorsal line. Behind the module an open truss carries four propellant tanks in a diamond, big for the hull because the ship runs far and fast. The two wing radiators hinge at their forward inboard corner and swing into the slot between the tank pairs to stow. A shadow shield, a compact reactor and twin torch bells close the tail.',
  });
})();
