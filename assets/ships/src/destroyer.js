/* Anvil-class destroyer: hull family 'destroyer'.
   A short, wide hull built around its nose. The armour cap is a forged head: plate rings stacked from a wide
   shoulder through a slight waist out to a bevelled flat face, wider than the crew module behind it, with a heavy
   sponson on each flank carrying a rail pair. The module is belted with armour strips, beam turrets sit dorsal and
   ventral, point-defence domes on the quarters, launch cells ventral. A boxed keel carries three tanks and cross
   radiators. The tail is the thin end of the anvil: a slim reactor drum, a light skirt, twin drive bells on a
   thrust plate. */
(function () {
  'use strict';
  const OD = window.OD;
  if (!OD || !OD.ShipArt) return;
  const SA = OD.ShipArt, K = SA.kit, V = K.V, clamp = K.clamp;
  const TAU = Math.PI * 2, X = [1, 0, 0];
  const onRing = (x, r, a) => [x, Math.cos(a) * r, Math.sin(a) * r];   // y = cos a, z = sin a: dorsal is π/2
  const radial = (a) => [0, Math.cos(a), Math.sin(a)];
  const tangent = (a) => V.cross(radial(a), X);
  const frameAt = (a) => [X, tangent(a), radial(a)];
  const along = (x, dir, r) => [x, dir[1] * r, dir[2] * r];
  const angDiff = (a, b) => { const d = Math.abs(a - b) % TAU; return d > Math.PI ? TAU - d : d; };
  // A flat ring face in a lathe profile has no slope for the renderer to orient it by; a small chamfer fixes that.
  const CH = 0.02;
  // closed drum with chamfered end faces (used instead of a capped cylinder wherever an end face can be seen)
  const drum = (from, to, r, o) => { const e = Math.min(r * 0.05, (to - from) * 0.1); return K.lathe(Object.assign({}, o, { profile: [[from, 0], [from + e, r], [to - e, r], [to, 0]] })); };
  // a thin band around a lathe body (a strap, a rib, a painted ring): one quad strip, much cheaper than a torus
  const band = (x0, x1, r, at, material, facing) => K.cyl({ from: x0, to: x1, r, at, material, caps: 'none', facing });
  const keelDims = (lay) => ({ w: lay.spineR * 0.9, h: lay.spineR * 1.7 });
  const slimReactor = (lay) => Math.max(lay.spineR * 1.1, lay.reactorR * 0.72);
  // The forged head's radii: shoulder, waist and face. All stand well clear of the crew drum's radius so the head
  // reads as a head, not a step in the drum, even on the small map sprite.
  const headRadii = (lay) => { const { R, noseF } = lay; return { Rs: R * 1.25, Rw: R * 1.06, Rf: R * (1.21 + 0.04 * clamp(noseF - 0.5, 0, 1)) }; };

  // Where the fittings go around the crew module: angles (dorsal = π/2) and x as a fraction of the module length.
  // Rail pairs hold port and starboard (stacked in tiers when there are more than two), beam turrets dorsal and
  // ventral (the diagonals when there are more), launch cells ventral-aft, point-defence domes on the aft and forward
  // quarters. The module's armour strips fill whatever stays free.
  function plan(lay) {
    const { R, turrets, coils, bays, pds } = lay;
    const P = { turrets: [], rails: [], bays: [], pds: [], busy: [] };
    const nt = turrets.length;
    // one or two turrets stand dorsal/ventral on the forward station (their barbette rings end a metre ahead of the
    // launch-cell block); more go round the diagonals, the dorsal half on the aft station and the ventral half on the
    // forward one, so no ventral barbette shares the cell block's length of hull
    turrets.forEach((m, i) => {
      const a = nt <= 2 ? Math.PI / 2 + i * Math.PI : Math.PI / 2 + Math.PI / nt + (i * TAU) / nt;
      const xf = nt <= 2 || Math.sin(a) < -0.05 ? 0.68 : 0.40;
      const r = clamp((m.aperture || 1) * 1.3, R * 0.2, R * 0.45);
      P.turrets.push({ m, a, xf, r }); P.busy.push({ a, half: (r * 1.5) / R });   // the barbette ring reaches 1.48 r
    });
    coils.forEach((m, i) => { const a = i % 2 ? Math.PI : 0; P.rails.push({ m, a, tier: Math.floor(i / 2) }); if (i < 2) P.busy.push({ a, half: 0.28 }); });
    if (bays.length) {
      const blocks = Math.min(bays.length, 2);
      const per = Math.ceil(bays.reduce((s, b) => s + (b.count || 6), 0) / blocks);
      const cell = clamp(R * 0.13, 0.5, 2.4), gap = cell * 0.18;
      const cols = Math.ceil(Math.sqrt(per * 1.8)), rows = Math.ceil(per / cols);
      const H = rows * (cell + gap) + gap;
      const angs = blocks === 1 ? [Math.PI * 1.5] : [Math.PI * 1.5 - 0.3, Math.PI * 1.5 + 0.3];
      angs.forEach((a) => { P.bays.push({ a, xf: 0.36, per, cell, rows, cols }); P.busy.push({ a, half: H / 2 / R + 0.02 }); });
    }
    // point-defence domes alternate aft quarter / forward quarter. The aft domes sit on the diagonals behind the armour
    // strips; the forward ones sit at 60° off the flank line, between the strips and the forward turret's barbette,
    // just aft of the accent band. Three dorsal mid-module spots take a tenth dome and beyond without stacking.
    const spots = [[0.12, Math.PI * 1.5], [0.78, Math.PI / 3], [0.14, Math.PI * 0.75], [0.78, Math.PI * 5 / 3], [0.14, Math.PI / 4], [0.78, Math.PI * 2 / 3], [0.14, Math.PI * 1.75], [0.78, Math.PI * 4 / 3], [0.14, Math.PI * 1.25], [0.5, Math.PI / 2 - 0.26], [0.5, Math.PI / 2 + 0.26], [0.5, Math.PI / 2]];
    pds.forEach((m, i) => { const s = spots[i % spots.length]; P.pds.push({ m, xf: s[0], a: s[1] }); });
    return P;
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

  SA.registerFamily('destroyer', {
    name: 'Anvil-class destroyer', length: 180,
    blurb: 'A short, wide hull behind a forged nose, 180 m. Both heavy coilguns run in troughs along the flanks, and the tail is the thin end of the ship.',
    radius: 0.085,
    cap: { len: 0.19, shape: 'blunt', tipR: 0.42, rings: true },
    module: { len: 0.22, kind: 'drum' },
    spine: { kind: 'keel', n: 4, r: 0.5 },
    // three tanks of a light propellant: the stock tank sits above the layout's minimum radius, so the tanks
    // visibly shrink as well as grow when the propellant load changes
    tanks: { arrangement: 'cluster', count: 3, material: 'tank', density: 450, dome: 0.55 },
    radiators: { panels: 4, layout: 'cross', mode: 'slide', aspect: 3.0 },
    drive: { nozzles: 2, kind: undefined },
    sensors: { mast: true, dish: 0.42 },
    accents: { bands: true },
    stages: {
      // ---- the forged head: shoulder, waist, face block, bevelled flat face, boss ----
      cap(K, c, lay) {
        const { R, xCap, xNose, capLen: S, A, tipR, F } = lay, parts = [];
        const e = R * CH;
        const { Rs, Rw, Rf } = headRadii(lay);   // shoulder, waist, face
        const layers = clamp(Math.round(2 + A.nose / 9), 3, 9);          // plate count follows the nose armour
        const nb = Math.max(1, Math.round(layers * 0.45)), nf = Math.max(2, layers - nb);
        const t0 = 0.16, tw = 0.5, tf = 0.95;
        // profile: buried base, collar, shoulder flare, body plates stepping in to the waist, face plates stepping
        // back out, a bevel, the flat nose face and a boss that carries the lamp. Every ledge is chamfered.
        const p = [[-R * 0.35, 0], [-R * 0.35 + e, R * 0.97], [0, R * 0.97], [S * 0.06, R], [S * t0, Rs]];
        const ledges = [];
        let r = Rs;
        for (let i = 1; i <= nb; i++) { const t = t0 + ((tw - t0) * i) / nb, rn = Rs - (Rs - Rw) * (i / nb); p.push([S * t - e, r], [S * t, rn]); ledges.push([S * t, Math.max(r, rn)]); r = rn; }
        for (let i = 1; i <= nf; i++) { const t = tw + ((tf - tw) * i) / nf, rn = Rw + (Rf - Rw) * Math.pow(i / nf, 0.7); p.push([S * t - e, r], [S * t, rn]); ledges.push([S * t, Math.max(r, rn)]); r = rn; }
        p.push([S - e, Rf], [S, Rf * 0.9], [S + e, tipR], [S + e * 2, tipR * 0.62], [S + R * 0.08, tipR * 0.6], [S + R * 0.09, 0]);
        parts.push(K.lathe({ at: [xCap, 0, 0], profile: p, material: 'armour', facing: 'nose' }));
        // plate rings on every ledge, and two more lying on the flat face
        if (F.cap.rings) {
          for (const [x, rb] of ledges) parts.push(K.torus({ at: [xCap + x - e * 0.6, 0, 0], axis: 'x', R: rb * 0.995, r: Math.max(0.14, R * 0.03), seg: c.seg, tube: 4, material: 'armourEdge', facing: 'nose' }));
          for (const f of [0.56, 0.76]) parts.push(K.torus({ at: [xCap + S, 0, 0], axis: 'x', R: Rf * f, r: Math.max(0.12, R * 0.025), seg: c.seg, tube: 4, material: 'armourEdge', facing: 'nose' }));
        }
        // the plate radius at S*t (the last profile point behind it) and the shoulder flare's radius at S*t
        const plateR = (t) => { let r = 0; for (const q of p) { if (q[0] <= S * t) r = q[1]; else break; } return r; };
        const flareR = (t) => R + (Rs - R) * clamp((t - 0.06) / (t0 - 0.06), 0, 1);
        // cheek plates bolted over the body plates, between the sponsons and the dorsal/ventral line; seated on the
        // smallest plate they cross, so they stand proud of it and sink into the bigger plates behind
        const rcIn = plateR((t0 + tw) * 0.5 + (tw - t0) * 0.39) - R * 0.01, cheekT = R * 0.09;
        for (let i = 0; i < 8; i++) { const a = Math.PI / 8 + (i * Math.PI) / 4; parts.push(K.box({ at: onRing(xCap + S * (t0 + tw) * 0.5, rcIn + cheekT / 2, a), size: [S * (tw - t0) * 0.78, R * 0.24, cheekT], frame: frameAt(a), material: 'hullDark', facing: 'nose' })); }
        // faction collar at the base and a thin accent ring on the shoulder
        if (F.accents.bands) {
          parts.push(band(xCap + S * 0.01, xCap + S * 0.055, R * 1.025, [0, 0, 0], 'accent', 'nose'));
          parts.push(band(xCap + S * (t0 + 0.015), xCap + S * (t0 + 0.035), Rs * 1.012, [0, 0, 0], 'accent', 'nose'));
        }
        // forward sensor blisters high on the shoulder flare, clear of the sponsons; each stands normal to the flare
        // so its base lies on the slope instead of floating off its aft edge
        const slope = Math.atan2(Rs - R, S * (t0 - 0.06));
        for (const a of [Math.PI / 2 - 0.8, Math.PI / 2 + 0.8]) {
          const n = V.norm(V.sub(V.scale(radial(a), Math.cos(slope)), V.scale(X, Math.sin(slope))));
          parts.push(K.lathe({ at: V.sub(onRing(xCap + S * 0.115, flareR(0.115), a), V.scale(n, R * 0.025)), axis: n, profile: [[0, R * 0.13], [R * 0.05, R * 0.11], [R * 0.1, 0]], material: 'sensor', facing: 'nose', seg: 10 }));
        }
        // docking collar on the ventral-starboard shoulder, set into the foot of the flare
        const da = Math.PI * 1.25;
        parts.push(K.lathe({ at: onRing(xCap + S * 0.105, R * 0.99, da), axis: radial(da), profile: [[0, R * 0.15], [R * 0.16, R * 0.15], [R * 0.17, R * 0.09], [R * 0.175, 0]], material: 'hullLight', facing: 'nose', seg: 12 }));
        parts.push(K.torus({ at: onRing(xCap + S * 0.105, R * 1.15, da), axis: radial(da), R: R * 0.15, r: R * 0.025, seg: 12, tube: 4, material: 'armourEdge', facing: 'nose' }));
        // lamps: white at the boss, red port and green starboard on the first shoulder plate
        parts.push(K.lamp({ at: [xNose + R * 0.1, 0, 0], color: '#ffffff', r: R * 0.06 }));
        parts.push(K.lamp({ at: onRing(xCap + S * 0.22, Rs * 1.01, Math.PI / 6), color: '#ff5a4a', r: R * 0.05 }));
        parts.push(K.lamp({ at: onRing(xCap + S * 0.22, Rs * 1.01, Math.PI * 5 / 6), color: '#5aff7a', r: R * 0.05 }));
        return parts;
      },
      // ---- crew module: an armoured drum belted with strips ----
      module(K, c, lay) {
        const { R, xMod, modLen, A, F } = lay, parts = [], P = plan(lay);
        const Xm = (f) => xMod + modLen * f;
        parts.push(K.tank({ from: xMod, to: xMod + modLen, r: R, material: F.module.material || (A.flank >= 15 ? 'armour' : 'hull'), dome: 0.26, facing: 'flank' }));
        // heavy ring frames at both ends
        for (const f of [0.05, 0.95]) parts.push(K.torus({ at: [Xm(f), 0, 0], axis: 'x', R: R * 0.995, r: R * 0.045, seg: c.seg, tube: 4, material: 'armourEdge', facing: 'flank' }));
        if (F.accents.bands) parts.push(band(Xm(0.83), Xm(0.87), R * 1.015, [0, 0, 0], 'accentDim', 'flank'));
        // longitudinal armour strips: four per 9 cm of flank plate, skipping the angles the fittings occupy. The ring
        // starts on the diagonals, which no stock fitting touches; when the dorsal-line phase keeps more strips clear
        // of the fittings (the twelve-strip belt), it takes that phase instead.
        if (A.flank >= 6) {
          const k = 4 * clamp(Math.round(A.flank / 9), 1, 3), half = 0.09;
          const ring = (a0) => { const out = []; for (let i = 0; i < k; i++) { const a = a0 + (i * TAU) / k; if (!P.busy.some((b) => angDiff(a, b.a) < b.half + half)) out.push(a); } return out; };
          let angs = ring(Math.PI / 4);
          const alt = ring(0);
          if (alt.length > angs.length) angs = alt;
          for (const a of angs) parts.push(K.box({ at: onRing(Xm(0.5), R * 0.99, a), size: [modLen * 0.56, R * half * 2, R * 0.08], frame: frameAt(a), material: 'armourEdge', facing: 'flank' }));
        }
        return parts;
      },
      // ---- mounts: turrets on barbettes, rail pairs on flank sponsons, ventral launch cells, PD domes ----
      mounts(K, c, lay) {
        const { R, L, xMod, modLen, xNose, capLen } = lay, parts = [], P = plan(lay);
        const Xm = (f) => xMod + modLen * f;
        P.turrets.forEach((t, ti) => {
          const ap = t.m.aperture || 1, idx = lay.turretIdx[ti];
          parts.push(K.torus({ at: onRing(Xm(t.xf), R * 0.97, t.a), axis: radial(t.a), R: t.r * 1.3, r: t.r * 0.18, seg: 16, tube: 4, material: 'armourEdge', facing: 'flank', hp: K.hp('beam', idx) }));
          parts.push(K.turret({ at: onRing(Xm(t.xf), R * 0.985, t.a), r: t.r, up: radial(t.a), aim: X, barrel: ap * 1.2, barrelR: ap * 0.5, seg: 16, role: 'beam', index: idx }));
        });
        if (P.rails.length) {
          const railR = clamp(R * 0.08, 0.25, 2.6), gap = railR * 2.8;
          const sides = {};
          for (const rl of P.rails) (sides[rl.a] = sides[rl.a] || []).push(rl);
          for (const key of Object.keys(sides)) {
            const list = sides[key], a = list[0].a, fr = frameAt(a), tiers = list.length;
            const mv = Math.max.apply(null, list.map((rl) => rl.m.muzzleVelocity || 4000));
            const x0 = Xm(0.14), x1 = Math.min(x0 + clamp(L * 0.44 * Math.pow(mv / 4000, 0.7), L * 0.22, L * 0.55), xNose - capLen * 0.22);
            const len = x1 - x0, xs = Xm(0.1);
            // the sponson: a trough on the flank, from the module ring into the head plates. Its floor sits just
            // inside the drum; its top stands clear of the widest plate ring it runs over (tube plus a margin)
            const { Rs, Rf } = headRadii(lay);
            const spIn = R * 0.95, spTop = Math.max(Rs, Rf) * 0.995 + Math.max(0.14, R * 0.03) + R * 0.03, spH = spTop - spIn;
            parts.push(K.box({ at: onRing((xs + x1) / 2, spIn + spH / 2, a), size: [x1 - xs, gap + railR * 4.2, spH], frame: fr, material: 'hullDark', facing: 'flank' }));
            parts.push(K.box({ at: onRing(x0 - railR * 1.2, spIn + spH / 2, a), size: [railR * 1.6, gap + railR * 4.2 + R * 0.03, spH + R * 0.03], frame: fr, material: 'accent', facing: 'flank' }));
            list.forEach((rl, k) => {
              const rc = spTop + railR * 1.15 + k * railR * 3.4;
              const idx = lay.coilIdx[P.rails.indexOf(rl)];
              parts.push(K.mark({ at: onRing(x1 + railR, rc, a), dir: X, up: radial(a), role: 'coil', index: idx, r: railR, hp: K.hp('coil', idx) }));
              for (const s of [1, -1]) { const off = V.scale(fr[1], (s * gap) / 2); parts.push(K.rod({ from: V.add(onRing(x0, rc, a), off), to: V.add(onRing(x1, rc, a), off), r: railR, material: 'barrel', seg: 8, hp: K.hp('coil', idx) })); }
              // saddles clamp the pair to the sponson, or to the tier below
              const nS = Math.max(2, Math.round(len / (R * 1.5))), h = k ? railR * 3.4 : railR * 1.8;
              for (let i = 0; i <= nS; i++) { const x = x0 + railR * 4 + (len - railR * 6) * (i / nS); parts.push(K.box({ at: onRing(x, rc - h / 2 + railR * 0.2, a), size: [railR * 1.6, gap + railR * 3.2, h], frame: fr, material: 'mount', facing: 'flank' })); }
            });
            // breech housing at the rear, muzzle brace at the front, both spanning every tier
            const top = spTop + railR * 1.15 + (tiers - 1) * railR * 3.4 + railR * 1.5;
            parts.push(K.box({ at: onRing(x0 + railR * 2.5, (spTop + top) / 2, a), size: [railR * 6, gap + railR * 4.4, top - spTop], frame: fr, material: 'mount', facing: 'flank' }));
            parts.push(K.box({ at: onRing(x1 - railR * 1.2, (spTop + top) / 2, a), size: [railR * 2.4, gap + railR * 3.6, top - spTop], frame: fr, material: 'mount', facing: 'nose' }));
          }
        }
        P.bays.forEach((b, bi) => parts.push(K.cells({ at: onRing(Xm(b.xf), R + b.cell * 0.15, b.a), normal: radial(b.a), frame: [X, tangent(b.a)], rows: b.rows, cols: b.cols, cell: b.cell, depth: b.cell * 0.7, facing: 'flank', role: 'bay', index: lay.bayIdx[Math.min(bi, lay.bayIdx.length - 1)] })));
        P.pds.forEach((p, pi) => { const r = clamp(R * 0.11, 0.3, 1.6); parts.push(K.turret({ at: onRing(Xm(p.xf), R * 0.985, p.a), r, up: radial(p.a), aim: X, barrel: r * 0.7, barrelR: r * 0.25, seg: 10, role: 'pd', index: lay.pdIdx[pi] })); });
        return parts;
      },
      // ---- keel: a boxed girder with corner longerons and ring frames ----
      spine(K, c, lay) {
        const { xSpine, xMod, R, spineLen, shieldT } = lay, parts = [], { w, h } = keelDims(lay);
        const x0 = xSpine - shieldT * 0.6, x1 = xMod + R * 0.3;
        // the girder's faces take the plain hull grey; the dark tone is kept for the rail sponsons
        parts.push(K.box({ at: [(x0 + x1) / 2, 0, 0], size: [x1 - x0, w, h], material: 'hull' }));
        const lr = clamp(R * 0.05, 0.15, 1.2);
        for (const [sy, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) parts.push(K.rod({ from: [x0, (sy * w) / 2, (sz * h) / 2], to: [x1 - R * 0.35, (sy * w) / 2, (sz * h) / 2], r: lr, material: 'truss', seg: 6 }));
        const nF = Math.max(3, Math.round(spineLen / (R * 1.1)));
        for (let i = 1; i < nF; i++) parts.push(K.box({ at: [xSpine + (spineLen * i) / nF, 0, 0], size: [R * 0.12, w * 1.14, h * 1.08], material: 'trussDark' }));
        // service lines along both keel flanks
        for (const s of [1, -1]) parts.push(K.rod({ from: [x0 + R * 0.2, (s * w) / 2 + lr * 1.2, -h * 0.1], to: [x1 - R * 0.4, (s * w) / 2 + lr * 1.2, -h * 0.1], r: lr * 0.55, material: 'trussDark', seg: 5 }));
        return parts;
      },
      // ---- propellant tanks strapped to the keel ----
      tanks(K, c, lay) {
        const { tanks, D, R, F } = lay, parts = [];
        tanks.forEach((t, ti) => {
          const len = t.to - t.from;
          parts.push(K.tank({ from: t.from, to: t.to, r: t.r, at: t.at, material: D.tanks.material || 'tank', dome: D.tanks.dome === undefined ? 0.55 : D.tanks.dome, facing: 'flank', role: 'tank', index: ti }));
          if (F.accents.bands) parts.push(band(t.to - len * 0.27, t.to - len * 0.23, t.r * 1.012, t.at, 'accent', 'flank'));
          if (Math.hypot(t.at[1], t.at[2]) > 0) for (const f of [0.28, 0.72]) {
            const x = t.from + len * f;
            parts.push(K.rod({ from: [x, 0, 0], to: [x, t.at[1], t.at[2]], r: clamp(R * 0.05, 0.12, 1), material: 'trussDark', seg: 5 }));
            parts.push(band(x - R * 0.03, x + R * 0.03, t.r * 1.01, t.at, 'trussDark', 'flank'));
          }
        });
        return parts;
      },
      // ---- cross radiators on pylons from the keel ----
      radiators(K, c, lay) {
        const { rads, R } = lay, parts = [], s = c.state, { w, h } = keelDims(lay);
        rads.forEach((r, ri) => {
          parts.push(K.radiator({ at: r.at, span: r.span, chord: r.chord, dir: r.dir, along: X, deploy: s.radiators, mode: r.mode, foldAxis: V.cross(X, r.dir), foldSign: 1, tubes: clamp(Math.round(r.chord / (R * 0.35)), 3, 12), thick: Math.max(0.25, R * 0.035), role: 'rad', index: ri }));
          const rootR = Math.hypot(r.at[1], r.at[2]);
          const inner = ((Math.abs(r.dir[1]) > 0.5 ? w : h) / 2) * 0.85, outer = rootR + R * 0.04;
          const fr = [X, V.cross(X, r.dir), r.dir];
          parts.push(K.box({ at: along(r.at[0], r.dir, (inner + outer) / 2), size: [r.chord * 0.7, R * 0.2, outer - inner], frame: fr, material: 'hullDark' }));
          parts.push(K.box({ at: along(r.at[0], r.dir, rootR - R * 0.06), size: [r.chord * 1.04, R * 0.26, R * 0.16], frame: fr, material: 'trussDark' }));
        });
        return parts;
      },
      // ---- the thin end: shadow shield, slim reactor drum, light skirt, twin bells on a thrust plate ----
      tail(K, c, lay) {
        const { xShield, xReactor, xThroat, shieldT, reactorLen, rExit, nozzles, bellLen, driveKind, R, A, D } = lay, parts = [];
        const reactorR = slimReactor(lay), shieldR = reactorR * 1.32;
        parts.push(drum(xReactor, xShield, shieldR, { material: 'shield', facing: 'tail' }));
        parts.push(K.torus({ at: [xShield - shieldT / 2, 0, 0], axis: 'x', R: shieldR, r: shieldT * 0.5, seg: c.seg, tube: 4, material: 'armourEdge', facing: 'tail' }));
        // the drum carries the reactor's own state, as the core's does: dead metal, narrower where it
        // burst, and the ribs gone with the coolant they carried
        const rhp = K.hp('reactor'), ribs = rhp <= 0 ? 0 : rhp < 0.5 ? 2 : 4;
        parts.push(drum(xThroat, xReactor, reactorR * (rhp <= 0 ? 0.87 : 1), { material: 'reactor', facing: 'tail', hp: rhp }));
        for (let i = 1; i <= ribs; i++) parts.push(K.torus({ at: [xThroat + (reactorLen * i) / (ribs + 1), 0, 0], axis: 'x', R: reactorR * 1.03, r: Math.max(0.1, reactorR * 0.03), seg: c.seg, tube: 4, material: 'trussDark', facing: 'tail', hp: rhp }));
        // tail skirt: short, sized by the tail armour
        if (A.tail >= 4) { const f = clamp(0.2 + A.tail / 40, 0.2, 0.75); parts.push(K.lathe({ at: [xReactor, 0, 0], profile: [[0, shieldR], [-reactorLen * f, reactorR * 1.1], [-reactorLen * f + R * CH, reactorR * 1.0]], material: 'armour', facing: 'tail' })); }
        if ((D.thrust || 0) > 0 && rExit > 0) {
          const ring = [];
          if (nozzles === 1) ring.push([0, 0]); else for (let i = 0; i < nozzles; i++) { const a = (nozzles === 2 ? 0 : Math.PI / 2) + (i * TAU) / nozzles; ring.push([Math.cos(a), Math.sin(a)]); }
          const off = nozzles === 1 ? 0 : nozzles === 2 ? rExit * 1.05 : rExit * 1.15;
          const rt = rExit * (driveKind === 'torch' ? 0.28 : 0.4);
          // thrust plate: wide enough to carry the bells wherever their spread puts them
          const rf = Math.max(reactorR * 1.02, off + rt * 1.9);
          parts.push(K.lathe({ at: [xThroat - R * 0.04, 0, 0], profile: [[0, 0], [R * CH, rf], [R * 0.16, rf], [R * 0.16 + R * CH, 0]], material: 'shield', facing: 'tail' }));
          ring.forEach(([cy, cz]) => {
            const at = [xThroat, cy * off, cz * off];
            parts.push(K.nozzle({ at, length: bellLen, rThroat: rt, rExit, dir: [-1, 0, 0] }));
            if (driveKind === 'torch') for (const f of [0.35, 0.62, 0.85]) parts.push(K.torus({ at: [xThroat - bellLen * f, at[1], at[2]], axis: 'x', R: (rt + (rExit - rt) * Math.pow(f, 0.62)) * 1.06, r: Math.max(0.12, rExit * 0.06), seg: c.seg, tube: 4, material: 'mount', facing: 'tail' }));
            parts.push(band(xThroat - rExit * 0.15, xThroat + rExit * 0.1, rt * 1.25, [0, at[1], at[2]], 'nozzle', 'tail'));   // throat collar: from/to are absolute, so the offset carries only the bell's spread
          });
        }
        parts.push(K.lamp({ at: [xShield - shieldT / 2, 0, shieldR * 1.02], color: '#ffffff', r: R * 0.05 }));
        return parts;
      },
      // ---- sensor mast with stays, dish and an equipment bay straddling the mast ----
      sensors(K, c, lay) {
        const { R, xMod, modLen, F } = lay, parts = [];
        if (!F.sensors.mast) return parts;
        // the mast stands just ahead of the forward turret station, clear of its barbette ring
        const x = xMod + modLen * 0.82, mastH = clamp(R * 0.85, 1.5, 14), top = R + mastH, mr = clamp(R * 0.045, 0.12, 0.6);
        parts.push(K.rod({ from: [x, 0, R * 0.9], to: [x, 0, top], r: mr, material: 'truss', seg: 6 }));
        for (const s of [1, -1]) parts.push(K.rod({ from: [x - R * 0.45, s * R * 0.35, R * 0.93], to: [x, 0, R + mastH * 0.55], r: mr * 0.45, material: 'trussDark', seg: 5 }));
        const dr = clamp(R * (F.sensors.dish || 0.5), 0.8, 9);
        parts.push(K.dish({ at: [x + dr * 0.1, 0, top], r: dr, depth: dr * 0.3, axis: [0.8, 0, 0.6], seg: 16 }));
        parts.push(K.rod({ from: [x, 0, top], to: [x + dr * 0.45, 0, top + dr * 0.35], r: mr * 0.6, material: 'trussDark', seg: 5 }));
        parts.push(K.box({ at: [x, 0, R + mastH * 0.5], size: [R * 0.34, R * 0.5, R * 0.14], material: 'sensor' }));
        parts.push(K.box({ at: [x, 0, R + mastH * 0.66], size: [R * 0.26, R * 0.36, R * 0.1], material: 'dish' }));
        // whip antennas aft of the mast
        for (const s of [1, -1]) parts.push(K.rod({ from: [x + R * 0.25, s * R * 0.25, R * 0.96], to: [x + R * 0.15, s * R * 0.55, R * 1.7], r: mr * 0.35, material: 'trussDark', seg: 4 }));
        return parts;
      },
      // ---- coolant lines from the reactor through the shield to each radiator root ----
      extras(K, c, lay) {
        const { rads, R, xReactor, reactorLen } = lay, parts = [];
        const reactorR = slimReactor(lay);
        rads.forEach((r) => {
          const rootR = Math.hypot(r.at[1], r.at[2]);
          parts.push(K.rod({ from: along(xReactor - reactorLen * 0.45, r.dir, reactorR * 0.92), to: along(r.at[0], r.dir, rootR - R * 0.06), r: clamp(R * 0.035, 0.1, 0.7), material: 'trussDark', seg: 5 }));
        });
        return parts;
      },
    },
    callouts(lay, defaults) {
      const { R, xCap, capLen, xMod, modLen, coils } = lay;
      // the coilguns are called out where they are, in the flank sponsons, so the core's own rail line comes off
      const out = retext(defaults, lay).filter((d) => d.label !== 'Rail pair' && d.label !== 'Rail pairs');
      out.push({ label: 'Forged head', text: 'Stacked plate rings over the nose, the widest part of the armoured hull.', at: [xCap + capLen * 0.75, 0, R * 1.27] });
      if (coils.length) {
        const m = coils[0], slug = (m.slugMass || 0) + ' kg slugs at ' + Math.round((m.muzzleVelocity || 0) / 100) / 10 + ' km/s.';
        out.push({ label: 'Rail sponsons', text: coils.length === 1 ? '1 coilgun in a trough along the flank, ' + slug : coils.length + ' coilguns in troughs along the flanks, ' + slug, at: [xMod + modLen * 0.9, R * 1.38, 0] });
      }
      return out;
    },
    notes: 'The Anvil is built around its nose facing. The head is the widest part of the armoured hull, wider than the crew drum behind it, stacked from plate rings so each ring can be replaced in dock, and every fitting of value sits in its shadow. The rail pairs run in troughs along the flanks that reach forward into the head plates. Behind the crew drum a boxed keel carries three tanks and four cross radiators on short pylons. The reactor and its twin bells are the thin end, kept as light as the tail armour allows.',
  });
})();
