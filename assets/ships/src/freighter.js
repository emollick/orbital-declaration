/* Meridian-class freighter (hull id 'freighter'): an unarmed civilian bulk hauler, 250 m.
   Nose to tail: a thin blunt cap over a small crew drum, then open lattice cargo racks stacked with standard
   containers around a square keel truss, inline propellant tanks threaded onto the keel behind the racks, a pair
   of small folding radiators, the shadow shield, a modest reactor and one small drive bell. The class carries no
   mounts, so no mount housings are drawn; a design that adds some gets the core mounts stage on the crew drum,
   except point-defence domes, which sit on the rack end frames where they can see past the container stacks.
   Everything follows the numbers: rack count from dryMass, tank section from propMass, radiator span from
   radiatorArea, bell from thrust, cap from the nose armour. */
(function () {
  'use strict';
  const OD = window.OD;
  if (!OD || !OD.ShipArt) return;
  const SQ2 = Math.SQRT2;
  const STOCK_PROP = 8e6;      // kg: the stock class; the tank section is proportioned against it
  const RACK_MASS = 1.5e6;     // kg of dry mass per cargo rack
  const PER_RING = 12;         // containers in one ring around the keel (a 4 x 4 grid less the keel hole)

  // The plan: where radiators, tanks and cargo racks sit along the keel, from the numbers. Memoised per layout.
  function plan(K, lay) {
    if (lay._meridian) return lay._meridian;
    const clamp = K.clamp, { R, D, xSpine, xMod, spineLen, rads } = lay;
    const s = R * 0.66;                      // standard container: s x s cross-section
    const keelHalf = s * 0.97;               // square keel: the longerons sit at the corners of the container hole
    const keelR = keelHalf * SQ2;
    const rackHalf = s * 2.12;               // lattice frame just outside the outer container faces (2 s)
    // radiators at the rear of the keel; a folded panel swings back on its aft root corner and lies along the
    // keel toward the shadow shield, so the hinge sits at least one span forward of it, and the root outrigger
    // clears the keel by half a chord
    const span = rads.length ? rads[0].span : 0, chord = rads.length ? rads[0].chord : 0;
    const radX = xSpine + Math.max(spineLen * 0.15, span + chord * 0.5 + R * 0.35);
    const radRoot = keelHalf + Math.max(R * 0.3, chord * 0.5 + R * 0.1);
    const front = xMod - R * 0.1;
    // inline tanks behind the racks: the section length follows the propellant load, the radius follows from
    // the volume, and the keel must fit through the domes
    const nT = Math.max(1, Math.round(D.tanks.count || 2));
    const Vp = (D.propMass || 0) / (D.tanks.density || 700);
    const tankFrom = radX + chord * 0.5 + R * 0.45;
    const rem = Math.max(R * 3, front - tankFrom);
    let tankLen = Vp > 0 ? clamp(rem * 0.34 * Math.cbrt((D.propMass || 0) / STOCK_PROP), rem * 0.1, rem * 0.6) : 0;
    const tanks = [];
    if (Vp > 0) {
      const domeF = D.tanks.dome === undefined ? 0.6 : D.tanks.dome;
      let len = (tankLen / nT) * 0.86;
      let r = Math.sqrt(Vp / (nT * Math.PI * len * 0.8));
      // a tank can be no narrower than the keel it is threaded on: a light load makes shorter tanks instead
      if (r < keelR * 1.1) { r = keelR * 1.1; len = Math.max(r * 0.9, Vp / (nT * Math.PI * r * r * 0.8)); }
      // ...and no wider than the rack frames allow: a heavy load on a short keel makes longer tanks instead
      if (r > 1.9 * R) { r = 1.9 * R; len = Math.max(len, Vp / (nT * Math.PI * r * r * 0.8)); }
      // the two domes take 2 r dome of the length: a tank shorter than that gets the length its domes need where
      // the keel has room, and flatter domes past that, so a cylindrical section always remains between them
      len = Math.max(len, 2 * r * domeF * 1.3);
      tankLen = clamp((nT * len) / 0.86, rem * 0.1, rem * 0.6);
      const each = tankLen / nT;
      len = each * 0.86;
      const dome = Math.min(domeF, (0.42 * len) / r);
      for (let i = 0; i < nT; i++) tanks.push({ from: tankFrom + i * each + each * 0.07, to: tankFrom + i * each + each * 0.93, r, h: r * dome, dome });
    }
    const tankTo = tankFrom + tankLen;
    // cargo racks: count follows dry mass; each rack holds rings of containers around the keel between end frames
    const rackFrom = tankTo + (tanks.length ? R * 0.35 : 0), rackTo = front;
    const zone = rackTo - rackFrom;
    const gap = R * 0.3, ft = R * 0.1;
    let nR = clamp(Math.round((D.dryMass || 6e6) / RACK_MASS), 1, 10);
    nR = Math.max(1, Math.min(nR, Math.floor(zone / R)));
    const pitch = zone / nR, cl0 = R * 0.9, cg = R * 0.06;
    const racks = [];
    for (let i = 0; i < nR; i++) {
      const from = rackFrom + i * pitch + gap / 2, to = from + pitch - gap;
      const rings = Math.max(1, Math.round((to - from) / (cl0 + cg)));
      const cl = ((to - from) - (rings - 1) * cg) / rings;
      racks.push({ from, to, rings, cl, cg });
    }
    // keel segments that are actually in the open (the keel is hidden inside the tanks and the container stacks)
    const segs = [];
    const into = (t) => t.h * 0.35;
    let x = xSpine;
    tanks.forEach((t) => { segs.push([x, t.from + into(t)]); x = t.to - into(t); });
    segs.push([x, racks[0].from - gap / 2]);
    racks.forEach((rk) => segs.push([rk.from - gap / 2, rk.to + gap / 2]));
    segs.push([racks[racks.length - 1].to + gap / 2, xMod + R * 0.24]);
    const P = { s, keelHalf, keelR, rackHalf, radX, radRoot, tanks, tankFrom, tankTo, racks, rackFrom, rackTo, gap, ft, segs };
    Object.defineProperty(lay, '_meridian', { value: P, enumerable: false });
    return P;
  }

  // where a design's point-defence domes go: on the rack end-frame bars, nose to tail, beside the crane rails,
  // the top bars first and the bottom bars once those are taken; the dome radius follows the hull
  function pdSpots(K, lay) {
    const P = plan(K, lay), n = lay.pds.length, out = [];
    if (!n) return out;
    const bw = P.s * 0.26, zt = P.rackHalf + bw * 0.5, y = P.rackHalf * 0.5;
    const frames = [];
    for (let i = P.racks.length - 1; i >= 0; i--) frames.push(P.racks[i].to + P.ft / 2, P.racks[i].from - P.ft / 2);
    const nf = frames.length;
    for (let i = 0; i < n; i++) {
      const row = Math.floor(i / nf), k = row === 0 && n <= nf ? Math.round((i * (nf - 1)) / Math.max(1, n - 1)) : i % nf;
      const sz = row % 2 ? -1 : 1, sy = k % 2 ? -1 : 1;
      out.push({ at: [frames[k], sy * y, sz * zt], up: [0, 0, sz], plinth: bw * 0.35, w: Math.max(P.ft, 1) });
    }
    return out;
  }
  const pdR = (K, lay) => K.clamp(lay.R * 0.2, 1, 3);

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

  OD.ShipArt.registerFamily('freighter', {
    name: 'Meridian-class freighter',
    blurb: 'Unarmed bulk hauler, 250 m. A square truss keel carries open racks of containers ahead of the propellant tanks, and nothing aboard can shoot.',
    length: 250,
    radius: 0.04,
    cap: { len: 0.06, shape: 'blunt', tipR: 0.3, rings: true },
    module: { len: 0.09, kind: 'drum', material: 'hab' },
    spine: { kind: 'truss', n: 4, r: 0.82 },
    tanks: { arrangement: 'inline', count: 2, material: 'tankWhite', density: 700, dome: 0.6 },
    radiators: { panels: 2, layout: 'wings', mode: 'fold', aspect: 2.2 },
    drive: { nozzles: 1 },
    sensors: { mast: true, dish: 0.35 },
    accents: { bands: true },
    stages: {
      // the core housings for any mounts a design adds, except the point-defence domes: the core sizes those for a
      // warship hull and they would vanish on a 250 m hauler, so they go on plinths on the rack end frames instead
      mounts(K, c, lay) {
        const V = K.V;
        const parts = OD.ShipArt.stages.mounts(K, c, lay.pds.length ? Object.assign({}, lay, { pds: [] }) : lay);
        const r = pdR(K, lay);
        pdSpots(K, lay).forEach((sp, i) => {
          const idx = lay.pdIdx[Math.min(i, Math.max(0, lay.pdIdx.length - 1))];
          parts.push(K.box({ at: V.add(sp.at, V.scale(sp.up, sp.plinth * 0.5)), size: [Math.max(sp.w, r * 2.6), r * 2.6, sp.plinth], material: 'hullDark', facing: 'flank', hp: K.hp('pd', idx) }));
          parts.push(K.turret({ at: V.add(sp.at, V.scale(sp.up, sp.plinth)), r, up: sp.up, aim: [1, 0, 0], barrel: r * 0.6, barrelR: r * 0.25, facing: 'flank', role: 'pd', index: idx }));
        });
        return parts;
      },
      // square keel truss, drawn only where it is in the open, with the feed lines along its underside
      spine(K, c, lay) {
        const P = plan(K, lay), { R, xSpine } = lay, parts = [];
        const member = K.clamp(R * 0.05, 0.15, 0.7);
        const segs = P.segs.slice();
        // the keel through the tanks is only worth drawing once the tank walls are torn open
        const st = c.state;
        if (st.destroyed || st.hull < 0.6 || (st.damage && st.damage.flank > 0.35)) P.tanks.forEach((t) => segs.push([t.from + t.h * 0.35, t.to - t.h * 0.35]));
        for (const [a, b] of segs) {
          if (b - a < R * 0.05) continue;
          parts.push(K.truss({ from: [a, 0, 0], to: [b, 0, 0], r: P.keelR, n: 4, bays: Math.max(1, Math.round((b - a) / (R * 0.8))), member }));
        }
        // propellant feed lines along the underside of the keel: shield to the first tank, last tank to the racks
        const rr = K.clamp(R * 0.035, 0.1, 0.5), z = -P.s * 0.72;
        const runs = [];
        if (P.tanks.length) {
          const t0 = P.tanks[0], tn = P.tanks[P.tanks.length - 1];
          runs.push([xSpine + R * 0.06, t0.from + t0.h * 0.3]);
          runs.push([tn.to - tn.h * 0.3, P.racks[0].from]);
        } else runs.push([xSpine + R * 0.06, P.racks[0].from]);
        for (const [a, b] of runs) for (const sy of [1, -1]) parts.push(K.rod({ from: [a, sy * P.s * 0.3, z], to: [b, sy * P.s * 0.3, z], r: rr, material: 'trussDark', seg: 5 }));
        return parts;
      },
      // inline propellant tanks threaded onto the keel, with a painted band, a strap ring and keel collars
      tanks(K, c, lay) {
        const P = plan(K, lay), { R, D } = lay, parts = [];
        const rc = P.keelR * 1.06;
        P.tanks.forEach((t, ti) => {
          parts.push(K.tank({ from: t.from, to: t.to, r: t.r, dome: t.dome, material: D.tanks.material || 'tankWhite', facing: 'flank', role: 'tank', index: ti }));
          // the painted band and the strap ring sit on the cylindrical section between the domes; a tank too
          // short to have one worth the name goes without
          const cyl = (t.to - t.from) - 2 * t.h;
          if (cyl >= R * 0.2) {
            parts.push(K.torus({ at: [t.from + t.h + cyl * 0.3, 0, 0], axis: 'x', R: t.r * 1.01, r: Math.max(0.1, t.r * 0.04), seg: c.seg, tube: 5, material: 'accent', facing: 'flank' }));
            parts.push(K.torus({ at: [t.from + t.h + cyl * 0.72, 0, 0], axis: 'x', R: t.r * 1.005, r: Math.max(0.08, t.r * 0.03), seg: c.seg, tube: 4, material: 'trussDark', facing: 'flank' }));
          }
          // collars where the keel enters the domes (they end inside the dome, where the dome is wider than they are)
          const a = Math.asin(Math.min(1, rc / t.r)), xoff = t.h * (1 - Math.cos(a)) + R * 0.05;
          parts.push(K.cyl({ from: t.from - R * 0.12, to: t.from + xoff, r: rc, material: 'hullDark', caps: 'start', facing: 'flank' }));
          parts.push(K.cyl({ from: t.to - xoff, to: t.to + R * 0.12, r: rc, material: 'hullDark', caps: 'end', facing: 'flank' }));
        });
        return parts;
      },
      // two small folding radiators at the rear of the keel on outriggers; each panel hangs on a hinge pin at its
      // aft root corner and swings back to lie along the keel, outboard of its own manifold and outrigger
      radiators(K, c, lay) {
        const P = plan(K, lay), { R, rads } = lay, parts = [], V = K.V;
        rads.forEach((r, ri) => {
          const dir = r.dir, side = V.cross([1, 0, 0], dir);
          const out = (x, d) => [x, dir[1] * d, dir[2] * d];
          const hinge = out(P.radX - r.chord * 0.5, P.radRoot);
          parts.push(K.radiator({ at: hinge, shift: [r.chord * 0.5, 0, 0], span: r.span, chord: r.chord, dir, along: [1, 0, 0], deploy: c.state.radiators, mode: 'fold', foldAxis: side, foldSign: 1, tubes: K.clamp(Math.round(r.chord / (R * 0.35)), 3, 12), thick: Math.max(0.25, R * 0.035), role: 'rad', index: ri }));
          // outrigger from the keel face into the root manifold, which sits wholly inboard of the hinge line
          const a0 = P.keelHalf * 0.9, a1 = P.radRoot - R * 0.25, mid = (a0 + a1) / 2;
          parts.push(K.box({ at: out(P.radX, mid), size: [r.chord * 0.5, a1 - a0, R * 0.16], frame: [[1, 0, 0], dir, side], material: 'hullDark' }));
          parts.push(K.box({ at: out(P.radX, P.radRoot - R * 0.2), size: [r.chord * 1.04, R * 0.2, R * 0.26], frame: [[1, 0, 0], side, dir], material: 'hullDark' }));
          // hinge knuckle and pin at the aft root corner, a latch block for the deployed panel at the forward one
          for (const sx of [-1, 1]) {
            parts.push(K.box({ at: out(P.radX + sx * r.chord * 0.45, P.radRoot - R * 0.04), size: [r.chord * 0.14, R * 0.24, R * 0.1], frame: [[1, 0, 0], side, dir], material: 'hullDark' }));
            if (sx < 0) parts.push(K.rod({ from: V.add(hinge, V.scale(side, -R * 0.15)), to: V.add(hinge, V.scale(side, R * 0.15)), r: K.clamp(R * 0.04, 0.12, 0.6), material: 'trussDark', seg: 6 }));
          }
        });
        return parts;
      },
      // the cargo racks and the civilian fittings that make the hull recognisable
      extras(K, c, lay) {
        const P = plan(K, lay), { R, xMod, modLen } = lay, parts = [], V = K.V, H = K.hash01;
        const { s, rackHalf, keelHalf, ft } = P;
        const bw = s * 0.26;
        P.racks.forEach((rk, ri) => {
          // open lattice around the stack
          parts.push(K.truss({ from: [rk.from, 0, 0], to: [rk.to, 0, 0], r: rackHalf * SQ2, n: 4, bays: rk.rings * 2, member: K.clamp(R * 0.04, 0.12, 0.5) }));
          for (let k = 0; k < rk.rings; k++) {
            const xc = rk.from + k * (rk.cl + rk.cg) + rk.cl / 2;
            // a ring of standard containers around the keel: mostly painted white, some older and darker
            for (let i = -1.5; i <= 1.5; i++) for (let j = -1.5; j <= 1.5; j++) {
              if (Math.abs(i) < 1 && Math.abs(j) < 1) continue;
              const h = H(ri * 7 + k * 3 + 1, Math.round(i + 1.5) * 5 + 2, Math.round(j + 1.5) * 11 + 3);
              const material = h < 0.42 ? 'tankWhite' : h < 0.66 ? 'hullLight' : h < 0.84 ? 'hull' : 'hullDark';
              parts.push(K.box({ at: [xc, i * s, j * s], size: [rk.cl * 0.95, s * 0.9, s * 0.9], material, facing: 'flank' }));
            }
            // painted band across the outer faces of the ring
            const bo = 1.5 * s + s * 0.45 + s * 0.015, bl = 2 * (1.5 * s + s * 0.45);
            for (const [sy, sz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) parts.push(K.box({ at: [xc, sy * bo, sz * bo], size: sy === 0 ? [R * 0.16, bl, s * 0.03] : [R * 0.16, s * 0.03, bl], material: 'accent', facing: 'flank' }));
          }
          // end frames tied to the keel corners by spokes, with docking lamps on the bars
          for (const xe of [rk.from - ft / 2, rk.to + ft / 2]) {
            for (const [sy, sz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
              parts.push(K.box({ at: [xe, sy * rackHalf, sz * rackHalf], size: sy === 0 ? [ft, rackHalf * 2 + bw, bw] : [ft, bw, rackHalf * 2 + bw], material: 'hullDark', facing: 'flank' }));
              parts.push(K.lamp({ at: [xe, sy * (rackHalf + bw * 0.7), sz * (rackHalf + bw * 0.7)], color: '#ffffff', r: R * 0.03 }));
            }
            for (const sy of [1, -1]) for (const sz of [1, -1]) {
              const d = V.norm([0, sy, sz]), p = V.norm([0, -sz, sy]);
              const a0 = keelHalf * 0.95, a1 = rackHalf, mid = (a0 + a1) / 2;
              parts.push(K.box({ at: [xe, sy * mid, sz * mid], size: [ft, (a1 - a0) * SQ2, bw * 0.7], frame: [[1, 0, 0], d, p], material: 'hullDark', facing: 'flank' }));
            }
          }
        });
        // loading-crane rails along the top of the racks, resting on the end frames, with the trolley parked on them
        if (P.racks.length) {
          const x0 = P.racks[0].from - ft, x1 = P.racks[P.racks.length - 1].to + ft, zr = rackHalf + bw * 0.5;
          const rr = K.clamp(R * 0.03, 0.1, 0.4);
          for (const sy of [1, -1]) parts.push(K.rod({ from: [x0, sy * s * 0.35, zr], to: [x1, sy * s * 0.35, zr], r: rr, material: 'trussDark', seg: 5 }));
          const xt = x0 + (x1 - x0) * (0.3 + 0.4 * H(P.racks.length, 3, 9));
          parts.push(K.box({ at: [xt, 0, zr + R * 0.08], size: [R * 0.4, s * 0.95, R * 0.14], material: 'hullDark' }));
          parts.push(K.box({ at: [xt, 0, zr + R * 0.22], size: [R * 0.18, R * 0.18, R * 0.14], material: 'mount' }));
          parts.push(K.lamp({ at: [xt, 0, zr + R * 0.31], color: '#ffffff', r: R * 0.03 }));
        }
        // crew drum: darker service strips for a worn working hull, a ventral docking collar and whip antennas
        const panels = [[0.5, 0.28], [1.9, 0.6], [3.3, 0.4], [4.3, 0.66], [5.6, 0.34]];
        panels.forEach(([a, f], i) => {
          const rad = [0, Math.cos(a), Math.sin(a)], tan = V.cross(rad, [1, 0, 0]);
          parts.push(K.box({ at: [xMod + modLen * f, rad[1] * R, rad[2] * R], size: [modLen * (0.22 + 0.08 * (i % 2)), R * 0.2, R * 0.04], frame: [[1, 0, 0], tan, rad], material: 'hullDark' }));
        });
        const xd = xMod + modLen * 0.45, rd = R * 0.2;
        parts.push(K.cyl({ from: -R * 0.7, to: -R * 1.16, r: rd, at: [xd, 0, 0], axis: 'z', material: 'hullDark', caps: 'end' }));
        parts.push(K.torus({ at: [xd, 0, -R * 1.16], axis: 'z', R: rd, r: Math.max(0.1, R * 0.03), seg: 16, tube: 5, material: 'hullLight' }));
        parts.push(K.lamp({ at: [xd, 0, -R * 1.22], color: '#ffffff', r: R * 0.035 }));
        const xa = xMod + modLen * 0.3;
        for (const sy of [1, -1]) parts.push(K.rod({ from: [xa, sy * R * 0.3, R * 0.9], to: [xa - R * 0.2, sy * R * 0.6, R * 1.7], r: K.clamp(R * 0.015, 0.06, 0.25), material: 'trussDark', seg: 5 }));
        parts.push(K.box({ at: [xa + R * 0.25, 0, R * 1.05], size: [R * 0.3, R * 0.3, R * 0.14], material: 'sensor' }));
        return parts;
      },
    },
    callouts(lay, defaults) {
      const P = lay._meridian || plan(OD.ShipArt.kit, lay);
      // the hauler's own wording for the parts the core names: the cap is dust plating, the crew ride at the nose
      const own = {
        'Armour cap': lay.A.nose + ' cm of plating over the nose, a micrometeoroid shield rather than armour.',
        'Crew module': Math.round(lay.modLen) + ' m of pressurised hull for the crew, up at the nose ahead of the cargo.',
      };
      const out = retext(defaults, lay, own).filter((c) => c.label !== 'Truss spine' && c.label !== 'Propellant tanks' && c.label !== 'Radiators' && c.label !== 'Point defence');
      if (lay.pds.length) { const K = OD.ShipArt.kit, sp = pdSpots(K, lay)[0], np = lay.pds.length; out.push({ label: 'Point defence', text: np + (np === 1 ? ' dome with a ' : ' domes with ') + mw1(lay.pds[0].power) + (np === 1 ? ' MW laser on a rack end frame, ' : ' MW lasers on the rack end frames, ') + 'shooting at inbound interceptors.', at: K.V.add(sp.at, K.V.scale(sp.up, sp.plinth + pdR(K, lay) * 1.5)) }); }
      const n = P.racks.reduce((a, r) => a + r.rings * PER_RING, 0);
      if (lay.rads.length) { const r = lay.rads[0]; out.push({ label: 'Radiators', text: grp(lay.D.radiatorArea || 0) + ' m² on outriggers, folded back along the keel for docking, shedding up to ' + radMW(lay.D) + ' MW, at their full ' + grp(lay.D.radiatorTemp || 1000) + ' K only once the sink is over ' + kneePct() + ' %.', at: [P.radX, r.dir[1] * (P.radRoot + r.span * 0.7), r.dir[2] * (P.radRoot + r.span * 0.7)] }); }
      out.push({ label: 'Cargo racks', text: P.racks.length + (P.racks.length === 1 ? ' lattice rack holding ' : ' lattice racks holding ') + n + (n === 1 ? ' standard container.' : ' standard containers.'), at: [(P.rackFrom + P.rackTo) / 2, 0, P.rackHalf] });
      out.push({ label: 'Keel', text: 'The square truss the cargo racks clamp to and the tanks thread onto.', at: [(lay.xSpine + P.tankFrom) / 2, 0, -P.keelHalf] });
      const nT = tankParts(lay.D);
      if (P.tanks.length && nT) out.push({ label: 'Propellant tanks', text: grp((lay.D.propMass || 0) / 1e3) + ' t of propellant in ' + nT + (nT === 1 ? ' inline tank behind the cargo.' : ' inline tanks behind the cargo.'), at: [(P.tankFrom + P.tankTo) / 2, 0, P.tanks[0].r] });
      return out;
    },
    notes: 'A working ship rather than a warship. A square truss keel carries open lattice racks of standard containers behind a small crew drum, with the propellant tanks threaded onto the keel behind the cargo, so the racks can be loaded from any side at a dock. The 5 cm cap is a micrometeoroid shield rather than armour, the reactor is modest, the bell small, and the radiators fold back along the keel for docking. Rack count follows the dry mass and the tank section follows the propellant load. Docking lamps run along every rack frame.',
  });
})();
