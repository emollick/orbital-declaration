/* Harkness-class cruiser — hull family 'cruiser'.
   Flagship, 320 m, long and stately. Nose to tail: a long ogive armour cap with plate rings; a long cylindrical
   crew module wearing two raised armour belts with dark rim rings, four large beam turrets on tall barbettes (dorsal
   and ventral on the forward belt, port and starboard on the aft belt), two heavy rail pairs slung on the ventral
   quarters, a launch-cell block on the starboard flank, six point-defence domes and the command sensor cluster (main
   dish, a second smaller dish on an arm, equipment boxes); then a long six-longeron open truss carrying a five-tank
   cluster with bare lattice ahead of it, three pairs of radiators staggered around the aft spine, the shadow shield,
   the reactor drum and three drive bells in a triangle, spaced so their exit rims never touch.
   Long bodies (module, tanks, rails) are lathed as runs of short sections so the painter's sort stays honest:
   belts, bands and straps are sections of their own rather than rings laid over one long quad. */
(function () {
  'use strict';
  const OD = window.OD;
  if (!OD || !OD.ShipArt) return;
  const ART = OD.ShipArt, KIT = ART.kit, V = KIT.V, clamp = KIT.clamp;
  const TAU = Math.PI * 2;
  const deg = (d) => (d * Math.PI) / 180;
  const onRing = (x, r, a) => [x, Math.cos(a) * r, Math.sin(a) * r];   // y = cos a (port), z = sin a (dorsal)
  const radial = (a) => [0, Math.cos(a), Math.sin(a)];
  const around = (a) => V.cross(radial(a), [1, 0, 0]);                   // tangent around the hull at angle a

  // radius of the ogive cap at x (the same curve the core cap stage lathes)
  function capRadius(lay, x) {
    const { R, xCap, capLen, tipR } = lay;
    if (x <= xCap) return R;
    const f = clamp((x - xCap) / capLen, 0, 1);
    return tipR + (R - tipR) * Math.pow(1 - f * f, 0.62);
  }

  // A run of consecutive x-sections lathed as separate solids: spec = [{ len, r, material, domeStart, domeEnd }].
  // Rings sit no further apart than `step`; radius changes between sections are short chamfers so their faces
  // shade outward. Nothing overlaps, so a raised belt or strap is never painted over by the body it sits on.
  function run(K, x0, y0, z0, spec, step, base) {
    const parts = [];
    let x = x0;
    for (let i = 0; i < spec.length; i++) {
      const s = spec[i], len = s.len, r = s.r;
      if (!(len > 0)) continue;
      const rPrev = i > 0 ? spec[i - 1].r : 0, rNext = i < spec.length - 1 ? spec[i + 1].r : 0;
      const c = Math.min(0.35, len * 0.2), prof = [];
      let a = 0, b = len;
      if (s.domeStart) {
        const h = r * s.domeStart;
        prof.push([0, 0]);
        for (let k = 1; k < 5; k++) { const t = (k / 5) * Math.PI * 0.5; prof.push([h - h * Math.cos(t), r * Math.sin(t)]); }
        prof.push([h, r]); a = h;
      } else if (r > rPrev + 1e-6) { prof.push([0, rPrev]); prof.push([c, r]); a = c; }
      else prof.push([0, r]);
      if (s.domeEnd) b = len - r * s.domeEnd;
      else if (r > rNext + 1e-6) b = len - c;
      const n = Math.max(1, Math.ceil((b - a) / step));
      for (let k = 1; k <= n; k++) prof.push([a + ((b - a) * k) / n, r]);
      if (s.domeEnd) {
        const h = r * s.domeEnd;
        for (let k = 4; k >= 1; k--) { const t = (k / 5) * Math.PI * 0.5; prof.push([len - h + h * Math.cos(t), r * Math.sin(t)]); }
        prof.push([len, 0]);
      } else if (r > rNext + 1e-6) prof.push([len, rNext]);
      parts.push(K.lathe(Object.assign({}, base, { at: [x, y0, z0], axis: 'x', profile: prof, material: s.material })));
      x += len;
    }
    return parts;
  }
  // a long rod in `pieces` segments (one lathe, several rings) so its depth sorts piecewise
  function longRod(K, from, to, r, pieces, o) {
    // `hp` makes the rod part of a component rather than scenery, as it does in K.rod: a wrecked rail pair
    // is shot through and only the stub at the breech is left standing
    const d = V.sub(to, from), full = V.len(d), prof = [[0, 0], [0, r]];
    const L = o && o.hp != null && o.hp <= 0 ? full * 0.34 : full;
    for (let k = 1; k <= pieces; k++) prof.push([(L * k) / pieces, r]);
    prof.push([L, 0]);
    return K.lathe(Object.assign({ seg: 8, material: 'truss' }, o, { at: from, axis: d, profile: prof }));
  }
  // a block of launch cells tiled one door plate per cell, so every cell mouth sorts above its own plate
  function cellBlock(K, o) {
    const n = V.norm(o.normal), u = V.norm(o.frame[0]), v = V.norm(o.frame[1]);
    const parts = [], cell = o.cell, gap = cell * 0.18, pitch = cell + gap, depth = o.depth || cell * 0.6;
    const W = o.cols * pitch, H = o.rows * pitch;
    const hp = o.role ? K.hp(o.role, o.index) : 1;
    // A hit block, as K.cells does it: wrecked, the doors are gone and the block is one hole sunk in the
    // hull; stove in, it sits down in the plating and a third of its mouths have burst and closed up.
    const dead = hp <= 0, stove = hp > 0 && hp < 0.5;
    const sink = dead ? depth * 1.15 : stove ? depth * 0.85 : depth * 0.5;
    // full-depth door tiles make up the block itself (their outer sides form its rim), one cell mouth on each
    for (let i = 0; i < o.rows; i++) for (let j = 0; j < o.cols; j++) {
      const cu = -W / 2 + pitch / 2 + j * pitch, cv = -H / 2 + pitch / 2 + i * pitch;
      const c = V.add(V.add(o.at, V.scale(u, cu)), V.scale(v, cv));
      parts.push(K.box({ at: V.sub(c, V.scale(n, sink)), size: [pitch, pitch, depth], frame: [u, v, n], material: 'bayDoor', facing: o.facing, hp }));
      if (dead || (stove && (i + j) % 3 === 0)) continue;
      parts.push(K.box({ at: V.add(c, V.scale(n, 0.06 - (stove ? depth * 0.35 : 0))), size: [cell * 0.78, cell * 0.78, 0.12], frame: [u, v, n], material: 'bayDark', facing: o.facing, noOutline: true, hp }));
    }
    if (dead) parts.push(K.box({ at: V.sub(o.at, V.scale(n, depth * 0.5)), size: [W * 0.92, H * 0.92, depth * 0.4], frame: [u, v, n], material: 'bayDark', facing: o.facing, noOutline: true, hp }));
    if (o.role) parts.push(K.mark({ at: o.at, dir: n, up: u, side: v, role: o.role, index: o.index, r: Math.max(W, H) / 2, cell, hp }));
    return parts;
  }

  // ---- the tank cluster: five tanks on the truss, sized from the propellant load. A heavier load lengthens
  // the tanks first (into the bare lattice ahead of them) and only then fattens them.
  function tankPlan(lay) {
    const { D, R, spineR, spineLen, xSpine, xMod } = lay;
    const T = D.tanks || {}, Vp = (D.propMass || 0) / (T.density || 700);
    const n = Math.max(1, Math.round(T.count || 5));
    const zone = { from: xSpine + spineLen * 0.4, to: xMod - spineLen * 0.04 };
    const zoneLen = zone.to - zone.from;
    const out = { tanks: [], zone, n, len: 0, r: 0 };
    if (!(Vp > 0)) return out;
    let len = zoneLen * 0.72;
    let r = Math.sqrt(Vp / (n * Math.PI * len * 0.8));
    const rMax = R * 0.62;
    if (r > rMax) {
      r = rMax; len = Vp / (n * Math.PI * r * r * 0.8);
      if (len > zoneLen) { len = zoneLen; r = Math.sqrt(Vp / (n * Math.PI * len * 0.8)); }
    }
    r = clamp(r, R * 0.28, R * 1.1);
    len = clamp(len, R * 1.5, zoneLen);
    // ring of tanks around the truss, always with daylight between neighbours
    const dist = n === 1 ? 0 : Math.max(spineR + r * (n <= 3 ? 0.95 : n <= 4 ? 1.05 : 1.15), n >= 3 ? (r * 1.12) / Math.sin(Math.PI / n) : 0);
    for (let i = 0; i < n; i++) {
      const a = (n === 2 ? 0 : n === 4 ? Math.PI / 4 : Math.PI / 2) + (i / n) * TAU;
      out.tanks.push({ from: zone.from, to: zone.from + len, r, at: [0, Math.cos(a) * dist, Math.sin(a) * dist], a });
    }
    out.len = len; out.r = r; out.dist = dist;
    return out;
  }

  // ---- radiators: pairs of panels staggered along the aft spine, each pair turned a step around the truss so
  // they fan out like spokes when seen from ahead. Area sets chord and span; the span grows with area.
  function radPlan(lay) {
    const { D, R, L, spineR, spineLen, xSpine } = lay;
    const area = D.radiatorArea || 0, Rd = D.radiators || {};
    const out = { rads: [], chord: 0, span: 0 };
    if (!(area > 0)) return out;
    const pairs = clamp(Math.round((Rd.panels || 6) / 2), 1, 6);
    const zone = { from: xSpine + spineLen * 0.035, to: xSpine + spineLen * 0.36 };
    const stationLen = (zone.to - zone.from) / pairs;
    const perFace = area / (4 * pairs);
    const aspect = Rd.aspect || 2.6;
    let chord = Math.min(Math.sqrt(perFace / aspect), stationLen * 0.86);
    let span = perFace / chord;
    if (span > L * 0.34) { span = L * 0.34; chord = Math.min(perFace / span, stationLen * 0.94); }
    const root = spineR + R * 0.1;
    for (let k = 0; k < pairs; k++) {
      const xc = zone.from + stationLen * (k + 0.5);
      const a0 = (k / pairs) * Math.PI;
      for (const a of [a0, a0 + Math.PI]) {
        const dir = radial(a);
        out.rads.push({ at: [xc, dir[1] * root, dir[2] * root], dir, span, chord, a, mode: Rd.mode || 'slide' });
      }
    }
    out.chord = chord; out.span = span;
    return out;
  }

  // ---- armour belts on the crew module: how far they stand proud of the pressure hull (follows the flank armour)
  const beltT = (lay) => lay.R * 0.08 * clamp(lay.A.flank / 28, 0.35, 2.2);

  // ---- shadow shield: the core's disc, grown when a heavy propellant load pushes the tank cluster out past its
  // shade so the whole cluster stays in shadow. The stock cluster sits inside the core disc, so nothing changes.
  function shieldPlan(lay) {
    const P = tankPlan(lay);
    const cluster = P.tanks.length ? P.dist + P.r : 0;
    return { r: Math.max(lay.shieldR, cluster * 1.05) };
  }

  // ---- fixed stations on the crew module (fraction of module length, angle in degrees)
  const TURRET_STATIONS = [[0.63, 90], [0.63, 270], [0.35, 0], [0.35, 180], [0.35, 90], [0.35, 270], [0.63, 0], [0.63, 180]];
  const PD_STATIONS = [['mod', 0.94, 20], ['mod', 0.94, 160], ['mod', 0.94, 200], ['mod', 0.94, 340], ['mod', 0.06, 45], ['mod', 0.06, 135], ['shield', 0, 90], ['shield', 0, 270], ['mod', 0.06, 225], ['mod', 0.06, 315], ['cap', 0.06, 90], ['cap', 0.06, 270]];

  const STAGES = {
    // laminated armour cap: the ogive is lathed as a run of sections, with raised armour rings (more of them, and
    // standing prouder, with thicker nose armour) between plain ones, a faction collar at the base and the tip lamp
    cap(K, c, lay) {
      const { R, xCap, xNose, capLen, A, F, tipR } = lay, parts = [], seg = c.seg;
      const base = A.nose >= 25 ? 'armour' : 'hullDark';
      const rAt = (f) => tipR + (R - tipR) * Math.pow(1 - f * f, 0.62);
      const xAt = (f) => capLen * f;
      const lam = F.cap.rings ? clamp(Math.round(A.nose / 25), 1, 9) : 0;
      const stand = 1 + 0.022 * clamp(A.nose / 70, 0.5, 2);
      const secs = [[0, 0.05, F.accents.bands ? 'accent' : base, 1.03]];
      const span = 0.7 / Math.max(1, lam), w = Math.min(0.03, span * 0.3);
      let f = 0.05;
      for (let k = 0; k < lam; k++) {
        const fc = 0.12 + span * (k + 0.5);
        secs.push([f, fc - w, base, 1], [fc - w, fc + w, 'armourEdge', stand]);
        f = fc + w;
      }
      secs.push([f, 1, base, 1]);
      secs.forEach((s, i) => {
        const [f0, f1, mat, k] = s, last = i === secs.length - 1;
        const kPrev = i > 0 ? secs[i - 1][3] : 0, kNext = last ? 0 : secs[i + 1][3];
        const cf = Math.min(0.006, (f1 - f0) * 0.2), prof = [];
        let fa = f0, fb = f1;
        if (i === 0) prof.push([0, 0], [0, rAt(0) * k]);
        else if (k > kPrev) { prof.push([xAt(f0), rAt(f0) * kPrev]); fa = f0 + cf; }
        else prof.push([xAt(f0), rAt(f0) * k]);
        if (!last && k > kNext) fb = f1 - cf;
        const n = Math.max(1, Math.ceil((fb - fa) / 0.07));
        for (let j = 1; j <= n; j++) { const ff = fa + ((fb - fa) * j) / n; prof.push([xAt(ff), rAt(ff) * k]); }
        if (last) prof.push([capLen, 0]);
        else if (k > kNext) prof.push([xAt(f1), rAt(f1) * kNext]);
        parts.push(K.lathe({ at: [xCap, 0, 0], axis: 'x', profile: prof, material: mat, facing: 'nose', seg }));
      });
      // sensor blisters at the cap base and the nose lamp
      for (const a of [0, Math.PI]) parts.push(K.lathe({ at: onRing(xCap + capLen * 0.09, rAt(0.09) * 0.98, a), axis: radial(a), profile: [[0, R * 0.12], [R * 0.06, R * 0.1], [R * 0.1, 0]], material: 'sensor', facing: 'nose', seg: 10 }));
      parts.push(K.lamp({ at: [xNose + R * 0.05, 0, 0], color: '#ffffff', r: R * 0.06 }));
      return parts;
    },

    // long cylindrical crew module: light pressure hull with two dark armour belts at the turret stations, each
    // standing proud of the hull and bounded by darker rim rings that stand prouder still, seam rings, faction
    // bands and the navigation lamps. Belt stand-off follows the flank armour.
    module(K, c, lay) {
      const { R, xMod, modLen, A, F } = lay, parts = [], seg = c.seg;
      const mat = F.module.material || 'hull';
      const beltMat = A.flank >= 15 ? 'armour' : 'hullDark';
      const t = beltT(lay);
      const rBelt = R + t, rRim = rBelt + R * 0.02, rBand = R * 1.015, rSeam = R * 1.012;
      const f = (fr, r, material, extra) => Object.assign({ len: modLen * fr, r, material }, extra || {});
      const spec = [
        f(0.03, R, mat, { domeStart: 0.12 }),
        f(0.025, rBand, F.accents.bands ? 'accentDim' : mat),
        f(0.085, R, mat), f(0.01, rSeam, 'hullDark'), f(0.11, R, mat),
        f(0.012, rRim, 'armourEdge'), f(0.156, rBelt, beltMat), f(0.012, rRim, 'armourEdge'),     // aft belt 0.26–0.44
        f(0.035, R, mat), f(0.03, rBand, F.accents.bands ? 'accent' : mat), f(0.035, R, mat),
        f(0.012, rRim, 'armourEdge'), f(0.156, rBelt, beltMat), f(0.012, rRim, 'armourEdge'),     // forward belt 0.54–0.72
        f(0.06, R, mat), f(0.01, rSeam, 'hullDark'), f(0.21, R, mat, { domeEnd: 0.12 }),
      ];
      parts.push(run(K, xMod, 0, 0, spec, R * 0.35, { seg, facing: 'flank' }));
      parts.push(K.lamp({ at: [xMod + modLen * 0.49, R * 1.03, 0], color: '#ff5a4a', r: R * 0.05 }));
      parts.push(K.lamp({ at: [xMod + modLen * 0.49, -R * 1.03, 0], color: '#5aff7a', r: R * 0.05 }));
      return parts;
    },

    // beam turrets on barbettes, rail pairs on the ventral quarters, launch cells on the flank, point-defence domes
    mounts(K, c, lay) {
      const { R, L, xMod, modLen, xCap, capLen, xNose, turrets, coils, bays, pds, xShield, shieldT } = lay, parts = [];
      const tBelt = beltT(lay), shieldR = shieldPlan(lay).r;
      // main beam turrets: dorsal/ventral on the forward belt, port/starboard on the aft belt, then the rest fill in
      turrets.forEach((m, i) => {
        const st = TURRET_STATIONS[i % TURRET_STATIONS.length], a = deg(st[1]);
        const x = xMod + modLen * (st[0] + 0.12 * Math.floor(i / TURRET_STATIONS.length));
        const ap = m.aperture || 1;
        const r = clamp(ap * 3.8, R * 0.28, R * 0.45);
        // barbette: an armour drum rooted inside the hull curve (so its edges never float over the belt) whose top
        // stands tBelt + R*0.14 above the R*0.98 line, well proud of the belt, with a dark rim lip under the
        // turret race; the turret dome sits on the lip
        const rb = r * 1.3, z0 = R * 0.88, zTop = R * 0.98 + tBelt + R * 0.14, lip = clamp(R * 0.045, 0.2, 1);
        const idx = lay.turretIdx[i], thp = K.hp('beam', idx);
        parts.push(K.lathe({ at: onRing(x, z0, a), axis: radial(a), profile: [[0, rb], [zTop - lip - z0, rb]], material: 'armour', facing: 'flank', seg: 20, hp: thp }));
        parts.push(K.lathe({ at: onRing(x, zTop - lip, a), axis: radial(a), profile: [[0, rb], [lip * 0.35, rb * 1.07], [lip, rb * 1.07], [lip, r * 1.1]], material: 'armourEdge', facing: 'flank', seg: 20, hp: thp }));
        parts.push(K.turret({ at: onRing(x, zTop, a), r, up: radial(a), aim: [1, 0, 0], barrel: ap * 3.5, barrelR: ap * 0.62, facing: 'flank', seg: 18, role: 'beam', index: idx }));
      });
      // rail pairs slung under the ventral quarters, running from the module rear out along the cap
      const railAngles = coils.length === 1 ? [270] : coils.length === 2 ? [228, 312] : coils.length === 3 ? [228, 312, 90] : [228, 312, 48, 132, 270, 90];
      coils.forEach((m, i) => {
        const a = deg(railAngles[i % railAngles.length]), mv = m.muzzleVelocity || 4000;
        const len = clamp(L * 0.42 * Math.pow(mv / 4000, 0.7), L * 0.22, L * 0.55);
        const railR = clamp(R * 0.11, 0.45, 3.6), gap = railR * 3.1;                                     // heavy rails, daylight between the pair
        const x0 = xMod + modLen * (0.16 + 0.04 * Math.floor(i / railAngles.length)), x1 = Math.min(x0 + len, xNose - capLen * 0.2);
        const rr = R * 1.02 + railR * 1.8;                       // rail centreline radius
        const base = onRing(0, rr, a), side = around(a);
        const ties = Math.max(3, Math.round((x1 - x0) / (R * 1.3)));
        const cidx = lay.coilIdx[i], chp = K.hp('coil', cidx);
        for (const s of [1, -1]) parts.push(longRod(K, V.add([x0, base[1], base[2]], V.scale(side, (s * gap) / 2)), V.add([x1, base[1], base[2]], V.scale(side, (s * gap) / 2)), railR, ties, { material: 'barrel', facing: 'flank', hp: chp }));
        // breech block at the rear, muzzle frame at the front, cross-ties with struts down to the hull between
        parts.push(K.box({ at: [x0 + len * 0.06, base[1], base[2]], size: [len * 0.12, gap + railR * 3.2, railR * 3.4], frame: [[1, 0, 0], side, radial(a)], material: 'mount', facing: 'flank' }));
        parts.push(K.box({ at: [x1 - railR * 2.5, base[1], base[2]], size: [railR * 4, gap + railR * 2.8, railR * 2.8], frame: [[1, 0, 0], side, radial(a)], material: 'mount', facing: 'flank', hp: chp }));
        parts.push(K.mark({ at: [x1 + railR, base[1], base[2]], dir: [1, 0, 0], up: radial(a), role: 'coil', index: cidx, r: railR, hp: chp }));
        for (let k = 1; k < ties; k++) {
          const x = x0 + ((x1 - x0) * k) / ties;
          parts.push(K.box({ at: [x, base[1], base[2]], size: [railR * 1.6, gap + railR * 2.6, railR * 2.2], frame: [[1, 0, 0], side, radial(a)], material: 'mount', facing: 'flank' }));
          parts.push(K.rod({ from: onRing(x, capRadius(lay, x) * 0.92, a), to: [x, base[1], base[2]], r: railR * 0.5, material: 'trussDark', seg: 5, facing: 'flank' }));
        }
      });
      // launch cells: one block on the starboard flank ahead of the forward belt; a second goes to port, more go aft
      if (bays.length) {
        const total = bays.reduce((s, b) => s + (b.count || 6), 0);
        const blocks = Math.min(bays.length, 4);
        const per = Math.ceil(total / blocks);
        const cell = clamp(R * 0.14, 0.5, 2.4);
        const cols = Math.ceil(Math.sqrt(per * 1.5)), rows = Math.max(1, Math.ceil(per / cols));
        const spots = [[0.82, 180], [0.82, 0], [0.12, 180], [0.12, 0]];
        for (let b = 0; b < blocks; b++) {
          const [fr, ad] = spots[b], a = deg(ad);
          parts.push(cellBlock(K, { at: onRing(xMod + modLen * fr, R * 1.0, a), normal: radial(a), frame: [[1, 0, 0], around(a)], rows, cols, cell, depth: cell * 0.6, facing: 'flank', role: 'bay', index: lay.bayIdx[Math.min(b, lay.bayIdx.length - 1)] }));
        }
      }
      // point-defence domes: four ahead of the launch block, two on the rear dorsal quarters, then the shield rim
      pds.forEach((m, i) => {
        const st = PD_STATIONS[i % PD_STATIONS.length], a = deg(st[2]);
        const r = clamp(R * 0.14, 0.3, 2.2);   // point-defence domes readable at 600 px
        let at;
        if (st[0] === 'shield') at = onRing(xShield - shieldT * 0.5, shieldR * 0.9, a);
        else if (st[0] === 'cap') { const x = xCap + capLen * st[1]; at = onRing(x, capRadius(lay, x) * 0.97, a); }
        else at = onRing(xMod + modLen * st[1] + R * 0.35 * Math.floor(i / PD_STATIONS.length), R * 0.99, a);
        parts.push(K.turret({ at, r, up: radial(a), aim: [1, 0, 0], barrel: r * 0.7, barrelR: r * 0.25, facing: st[0] === 'shield' ? 'tail' : st[0] === 'cap' ? 'nose' : 'flank', seg: 10, role: 'pd', index: lay.pdIdx[i] }));
      });
      return parts;
    },

    // tail: the core stage draws the shadow shield (grown to shade the tank cluster), the reactor drum with its ribs
    // and the tail skirt; the three torch bells are placed here, spaced 1.25 rExit off the axis so the exit rims
    // keep daylight between them, with the same coils and throat collar the core draws
    tail(K, c, lay) {
      const { xThroat, rExit, nozzles, bellLen, driveKind, D } = lay;
      const parts = [ART.stages.tail(K, c, Object.assign({}, lay, { rExit: 0, shieldR: shieldPlan(lay).r }))];
      if ((D.thrust || 0) > 0 && rExit > 0) {
        const off = nozzles === 1 ? 0 : nozzles === 2 ? rExit * 1.05 : rExit * 1.25;
        for (let i = 0; i < nozzles; i++) {
          const a = (nozzles === 2 ? 0 : Math.PI / 2) + (i / nozzles) * TAU;
          const at = nozzles === 1 ? [xThroat, 0, 0] : [xThroat, Math.cos(a) * off, Math.sin(a) * off];
          parts.push(K.nozzle({ at, length: bellLen, rThroat: rExit * (driveKind === 'torch' ? 0.28 : 0.4), rExit, dir: [-1, 0, 0] }));
          if (driveKind === 'torch') for (const f of [0.35, 0.62, 0.85]) parts.push(K.torus({ at: [xThroat - bellLen * f, at[1], at[2]], axis: 'x', R: (rExit * 0.4 + (rExit - rExit * 0.4) * Math.pow(f, 0.62)) * 1.06, r: Math.max(0.12, rExit * 0.06), seg: c.seg, tube: 6, material: 'mount', facing: 'tail' }));
        }
        parts.push(K.cyl({ from: xThroat - rExit * 0.15, to: xThroat + rExit * 0.1, r: rExit * (driveKind === 'torch' ? 0.34 : 0.45), material: 'nozzle', facing: 'tail' }));
      }
      return parts;
    },

    // the open truss: six longerons, ring frames at both ends, conduits running inside the lattice
    spine(K, c, lay) {
      const { xSpine, xMod, spineR, spineLen, R, F } = lay, parts = [];
      const member = clamp(R * 0.06, 0.15, 1.4);
      parts.push(K.truss({ from: [xSpine, 0, 0], to: [xMod, 0, 0], r: spineR, n: F.spine.n || 6, bays: Math.max(4, Math.round(spineLen / (R * 0.8))), member }));
      const cr = clamp(R * 0.035, 0.1, 0.7);
      for (const [y, z] of [[spineR * 0.35, -spineR * 0.45], [-spineR * 0.35, -spineR * 0.45], [0, spineR * 0.5]]) parts.push(longRod(K, [xSpine, y, z], [xMod, y, z], cr, 6, { material: 'trussDark', seg: 5 }));
      for (const x of [xSpine + R * 0.12, xMod - R * 0.12]) parts.push(K.torus({ at: [x, 0, 0], axis: 'x', R: spineR * 1.02, r: R * 0.04, seg: 20, tube: 5, material: 'hullDark' }));
      return parts;
    },

    // five-tank cluster: each tank is a run of sections with two cradle straps and a faction band, held to ring
    // frames on the truss by spokes, with a feed line from the rear dome into the lattice
    tanks(K, c, lay) {
      const { D, R, spineR, F } = lay, parts = [];
      const P = tankPlan(lay);
      if (!P.tanks.length) return parts;
      const mat = D.tanks.material || 'tank', dome = D.tanks.dome === undefined ? 0.7 : D.tanks.dome;
      const strapR = clamp(R * 0.045, 0.12, 1);
      const seg = clamp(Math.round(c.seg * 0.7), 8, 24);
      const len = P.len, r = P.r, h = r * dome;
      const sw = clamp(r * 0.12, 0.4, 1.2), bw = clamp(r * 0.1, 0.4, 1.0);
      const fA = Math.max(0.12, (h + sw) / len + 0.02), fB = 1 - fA, fBand = fB - 0.1;
      const detailed = len > 2 * h + 3 * sw + bw + 4;
      const x0 = P.tanks[0].from;
      const frames = detailed ? [x0 + len * fA, x0 + len * fB] : [x0 + len * 0.5];
      for (const x of frames) parts.push(K.torus({ at: [x, 0, 0], axis: 'x', R: spineR * 1.03, r: R * 0.045, seg: 20, tube: 5, material: 'hullDark' }));
      P.tanks.forEach((t, ti) => {
        const [, y, z] = t.at;
        const thp = K.hp('tank', ti);
        const out = Math.hypot(y, z) > 1e-6 ? V.norm([0, y, z]) : [0, 0, 1];
        parts.push(K.mark({ at: [(t.from + t.to) / 2, y + out[1] * r * 0.9, z + out[2] * r * 0.9], dir: out, up: [1, 0, 0], role: 'tank', index: ti, r, hp: thp }));
        if (detailed) {
          const spec = [
            { len: len * fA - sw / 2, r, material: mat, domeStart: dome },
            { len: sw, r: r * 1.025, material: 'trussDark' },
            { len: len * (fBand - fA) - sw / 2 - bw / 2, r, material: mat },
            { len: bw, r: r * 1.02, material: F.accents.bands ? 'accent' : mat },
            { len: len * (fB - fBand) - bw / 2 - sw / 2, r, material: mat },
            { len: sw, r: r * 1.025, material: 'trussDark' },
            { len: len * (1 - fB) - sw / 2, r, material: mat, domeEnd: dome },
          ];
          parts.push(run(K, t.from, y, z, spec, R * 0.45, { seg, facing: 'flank', hp: thp }));
        } else parts.push(K.tank({ from: t.from, to: t.to, r, at: t.at, material: mat, dome, facing: 'flank', seg, hp: thp }));
        // cradle spokes from the ring frames to the straps
        for (const x of frames) parts.push(K.rod({ from: [x, 0, 0], to: [x, y, z], r: strapR, material: 'trussDark', seg: 5 }));
        // feed line from the rear dome into the lattice
        parts.push(K.rod({ from: [t.from + h * 0.5, y * 0.75, z * 0.75], to: [t.from - R * 0.2, y * 0.3, z * 0.3], r: strapR * 0.6, material: 'trussDark', seg: 4 }));
      });
      return parts;
    },

    // three pairs of radiators staggered around the aft spine, each with a root manifold on the truss
    radiators(K, c, lay) {
      const { R } = lay, parts = [], s = c.state;
      const P = radPlan(lay);
      P.rads.forEach((r, ri) => {
        parts.push(K.radiator({ at: r.at, span: r.span, chord: r.chord, dir: r.dir, along: [1, 0, 0], deploy: s.radiators, mode: r.mode, foldAxis: V.cross([1, 0, 0], r.dir), foldSign: 1, tubes: clamp(Math.round(r.chord / (R * 0.3)), 3, 12), thick: Math.max(0.3, R * 0.035), role: 'rad', index: ri }));
        const rootR = Math.hypot(r.at[1], r.at[2]);
        parts.push(K.box({ at: [r.at[0], r.dir[1] * (rootR - R * 0.1), r.dir[2] * (rootR - R * 0.1)], size: [r.chord * 1.06, R * 0.24, R * 0.3], frame: [[1, 0, 0], V.cross([1, 0, 0], r.dir), r.dir], material: 'hullDark' }));
      });
      return parts;
    },

    // command sensor cluster on a braced mast: main dish, a smaller dish on a starboard arm, equipment boxes
    sensors(K, c, lay) {
      const { R, xMod, modLen, F } = lay, parts = [];
      if (!F.sensors.mast) return parts;
      const x = xMod + modLen * 0.86;
      const mastH = clamp(R * 0.85, 2, 16), mastR = clamp(R * 0.05, 0.15, 0.7);
      parts.push(K.rod({ from: [x, 0, R * 0.9], to: [x, 0, R + mastH], r: mastR, material: 'truss', seg: 6 }));
      for (const s of [1, -1]) parts.push(K.rod({ from: [x - R * 0.28, s * R * 0.22, R * 0.95], to: [x, 0, R + mastH * 0.55], r: mastR * 0.5, material: 'trussDark', seg: 5 }));
      const dr = clamp(R * (F.sensors.dish || 0.6), 1, 10);
      parts.push(K.dish({ at: [x + dr * 0.1, 0, R + mastH], r: dr, depth: dr * 0.3, axis: [0.8, 0, 0.6], seg: 20 }));
      parts.push(K.rod({ from: [x, 0, R + mastH], to: [x + dr * 0.45, 0, R + mastH + dr * 0.35], r: mastR * 0.6, material: 'trussDark', seg: 5 }));
      // second, smaller dish on an arm to starboard, looking forward and outboard
      const d2 = dr * 0.5, armEnd = [x - R * 0.1, -R * 0.5, R + mastH * 0.7];
      parts.push(K.rod({ from: [x, 0, R + mastH * 0.7], to: armEnd, r: mastR * 0.6, material: 'truss', seg: 5 }));
      parts.push(K.dish({ at: armEnd, r: d2, depth: d2 * 0.3, axis: [0.7, -0.6, 0.4], seg: 14 }));
      // equipment boxes
      parts.push(K.box({ at: [x - R * 0.32, 0, R + mastH * 0.42], size: [R * 0.36, R * 0.5, R * 0.16], material: 'sensor' }));
      parts.push(K.box({ at: [x - R * 0.32, 0, R + mastH * 0.58], size: [R * 0.3, R * 0.42, R * 0.12], material: 'dish' }));
      parts.push(K.box({ at: [x + R * 0.22, R * 0.28, R + mastH * 0.32], size: [R * 0.2, R * 0.22, R * 0.34], material: 'sensor' }));
      return parts;
    },

    // family-specific detail: docking collar and beacon, whip antennas, a reactor band
    extras(K, c, lay) {
      const { R, xMod, modLen, xThroat, reactorLen, reactorR, F } = lay, parts = [];
      // docking collar on the ventral module rear, with its beacon
      const a = deg(270), dx = xMod + modLen * 0.16, dr = R * 0.13;
      parts.push(K.cyl({ from: R * 0.9, to: R * 1.12, r: dr, at: [dx, 0, 0], axis: radial(a), material: 'hullLight', caps: 'end', seg: 12, facing: 'flank' }));
      parts.push(K.torus({ at: onRing(dx, R * 1.12, a), axis: radial(a), R: dr * 0.9, r: dr * 0.22, seg: 14, tube: 5, material: 'hullDark', facing: 'flank' }));
      parts.push(K.lamp({ at: onRing(dx + dr * 1.7, R * 1.02, a), color: '#ffffff', r: R * 0.035 }));
      // whip antennas on the module rear
      const wx = xMod + modLen * 0.12, wr = clamp(R * 0.012, 0.08, 0.25);
      for (const aa of [deg(75), deg(105)]) parts.push(K.rod({ from: onRing(wx, R * 0.95, aa), to: onRing(wx, R * 1.6, aa), r: wr, material: 'trussDark', seg: 4, facing: 'flank' }));
      // a dim faction band on the reactor drum
      if (F.accents.bands && reactorLen > 0) parts.push(K.cyl({ from: xThroat + reactorLen * 0.62, to: xThroat + reactorLen * 0.7, r: reactorR * 1.02, material: 'accentDim', caps: 'none', facing: 'tail' }));
      return parts;
    },
  };

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

  ART.registerFamily('cruiser', {
    name: 'Harkness-class cruiser',
    blurb: 'Flagship hull, 320 m. Four main laser turrets stand on barbettes over two armour belts, two heavy coilguns hang under the belly, and five tanks ride an open truss ahead of three torch bells.',
    length: 320,
    radius: 0.046,
    cap: { len: 0.13, shape: 'ogive', tipR: 0.12, rings: true },
    module: { len: 0.28, kind: 'cylinder', material: 'hull' },
    spine: { kind: 'truss', n: 6, r: 0.5 },
    tanks: { arrangement: 'cluster', count: 5, material: 'tank', density: 700, dome: 0.7 },
    radiators: { panels: 6, layout: 'fan', mode: 'slide', aspect: 2.6 },
    drive: { nozzles: 3 },
    sensors: { mast: true, dish: 0.45 },
    accents: { bands: true },
    stages: STAGES,
    callouts(lay, defaults) {
      const { xMod, modLen, R } = lay;
      const P = tankPlan(lay), Q = radPlan(lay), S = shieldPlan(lay);
      const move = { 'Beam turrets': [xMod + modLen * 0.63, 0, R * 1.9], 'Shadow shield': [lay.xShield, 0, S.r], 'Rail pair': [xMod + modLen * 0.6, R * 0.8, -R * 1.2], 'Launch cells': [xMod + modLen * 0.82, -R, 0], 'Point defence': [xMod + modLen * 0.94, -R * 0.9, R * 0.4], 'Sensor mast': [xMod + modLen * 0.86, 0, R * 2] };
      move['Rail pairs'] = move['Rail pair'];
      if (P.tanks.length) move['Propellant tanks'] = [P.tanks[0].from + P.len * 0.5, P.tanks[0].at[1], P.tanks[0].at[2] + P.r];
      if (Q.rads.length) move.Radiators = [Q.rads[0].at[0], Q.rads[0].at[1] + Q.rads[0].dir[1] * Q.span * 0.7, Q.rads[0].at[2] + Q.rads[0].dir[2] * Q.span * 0.7];
      return retext(defaults, lay).map((d) => (move[d.label] ? Object.assign({}, d, { at: move[d.label] }) : d));
    },
    notes: 'The Harkness runs 320 m, with a 56 m ogive cap of 70 cm armour, a 90 m crew cylinder and a 125 m open truss. The four main turrets stand on tall barbettes over two raised armour belts, so their apertures clear the hull in every direction, and the two rail pairs are slung under the ventral quarters and reach forward along the cap. Propellant rides in a five-tank cluster mid-truss with bare lattice ahead of it. Three pairs of radiators fan out around the aft spine between the tanks and the shadow shield, with the reactor drum and three torch bells behind. The command sensor cluster, a main dish with a second dish on a starboard arm and equipment boxes, stands on a braced mast at the module front.',
  });
})();
