/* Orbital station: a rotating habitat ring on six spokes around a fixed hub, a long axial truss carrying the radiator
   farm, and the reactor at the far end behind its shadow shield. The station axis runs along z (dorsal) so the
   tactical top view looks down the axis at the ring, the spokes and the docking end; 'side' sees the ring edge-on
   with the hub, truss and reactor as a mast through it. No drive bell, no propellant tanks, no plume: the cap,
   spinal, spine, tanks and tail stages are switched off so a configurator cannot hang a drive on it. */
(function () {
  'use strict';
  const A = window.OD && window.OD.ShipArt;
  if (!A) return;
  const K = A.kit, V = K.V, clamp = K.clamp, TAU = Math.PI * 2;
  const AX = [0, 0, 1];                                          // the station axis: docking end at +z, reactor at -z
  const radial = (a) => [Math.cos(a), Math.sin(a), 0];           // unit vector around the axis (a = 0 toward +x)
  const at = (u, r, a) => [Math.cos(a) * r, Math.sin(a) * r, u]; // point at height u along the axis, radius r, angle a
  const mIdx = (lay, m) => ((lay.D && lay.D.mounts) || []).indexOf(m);   // a mount's place in the design's list

  // ---- geometry: where everything sits, from the design numbers (metres) ----
  function geom(lay) {
    const D = lay.D, L = lay.L, Ar = lay.A;
    const g = { L, D, A: Ar };
    // habitat ring and its spokes
    g.rRing = L * 0.42;                 // ring centre-line radius
    g.rTube = L * 0.045;                // habitat tube radius
    g.uRing = L * 0.17;                 // ring plane
    g.spokes = 6;
    g.rSpoke = L * 0.011;
    g.belt = clamp(L * 0.0025 * (0.6 + Ar.flank / 60), L * 0.0012, L * 0.006);   // armour belt proud of the tube
    g.beltHalf = clamp(0.35 + Ar.flank / 90, 0.35, 1.05);                     // belt half-width in tube latitude (rad)
    // hub: a fixed drum; the bearing collar in the ring plane carries the spokes
    g.rHub = L * 0.055;
    g.uHub0 = L * 0.07; g.uHub1 = L * 0.34;
    g.rCollar = g.rHub * 1.18; g.collarHalf = L * 0.035;
    // docking end
    g.rDock = L * 0.036; g.uDock0 = g.uHub1; g.uDock1 = L * 0.45; g.uNose = L * 0.5;
    g.rPort = L * 0.015;
    g.dockPorts = 4;
    // reactor end: drum size from reactor power, shadow shield on its habitat side
    const P = D.reactorPower || 0;
    g.rReactor = P > 0 ? clamp(2.0 * Math.cbrt(P / 1e6), L * 0.02, L * 0.08) : L * 0.03;
    g.reactorLen = clamp(g.rReactor * 2.2, L * 0.05, L * 0.14);
    g.uTail = -L * 0.5;
    g.uR0 = g.uTail + L * 0.03;
    g.uR1 = g.uR0 + g.reactorLen;
    g.shieldT = clamp(L * 0.02 * (0.7 + Ar.tail / 120), L * 0.012, L * 0.035);
    g.rShield = g.rReactor * 1.6;
    g.uShield0 = g.uR1 + L * 0.012;
    g.uShield1 = g.uShield0 + g.shieldT;
    // axial truss from the shield to the hub, with the coolant main down its middle
    g.rTruss = L * 0.03;
    g.uTruss0 = g.uShield1; g.uTruss1 = g.uHub0;
    // radiator farm: a fan of panels around the truss between the shield and the ring; count and size from the area.
    // Panels are drawn generously (a station's farm has to read beside a 500 m ring) but always grow with the number:
    // first in panel size, then in ranks along the truss. Stowed panels slide in toward the truss, so the ranks
    // share the whole zone and the farm centres on the truss between the shield and the ring.
    const area = D.radiatorArea || 0;
    g.panels = [];
    if (area > 0) {
      const dirsN = 8, gain = 9, aspect = 1.4;
      const ranks = clamp(Math.round(area / 9000 + 0.5), 1, 5);
      const face = (area * gain) / 2 / (dirsN * ranks);
      // the farm zone: clear of the shield and, at the hub end, of the ring stays and the hub's service ring
      const zone0 = g.uTruss0 + L * 0.03, zone1 = Math.min(g.uRing - g.rTube - L * 0.045, g.uHub0 - L * 0.02);
      let chord = Math.sqrt(face / aspect), span = face / chord;
      span = Math.min(span, L * 0.26);
      chord = face / span;
      const pitchMax = (zone1 - zone0) / ranks;
      if (chord > pitchMax * 0.8) { chord = pitchMax * 0.8; span = Math.min(face / chord, L * 0.26); }
      const pitch = Math.max(chord * 1.25, pitchMax * 0.7);
      const total = chord + (ranks - 1) * pitch;
      // centred in the zone; should the ranks ever outgrow it, the overflow goes toward the shield, never into the hub
      const u0 = Math.min(zone0 + (zone1 - zone0 - total) / 2 + chord / 2, zone1 - total + chord / 2);
      const rootR = g.rTruss * 0.9;
      for (let k = 0; k < ranks; k++) {
        const u = u0 + k * pitch;
        for (let i = 0; i < dirsN; i++) {
          const a = ((i + (k % 2) * 0.5) / dirsN) * TAU + Math.PI / 8;
          g.panels.push({ at: at(u, rootR, a), dir: radial(a), a, span, chord, rank: k });
        }
      }
      g.farm = { u0: u0 - chord / 2, u1: u0 + (ranks - 1) * pitch + chord / 2, span, chord, ranks };
    }
    // mounts: every beam becomes a dome turret (a station has no nose to fix a spinal tube to)
    const M = D.mounts || [];
    g.beams = M.filter((m) => m.kind === 'beam');
    g.pds = M.filter((m) => m.kind === 'pd');
    g.bays = M.filter((m) => m.kind === 'launcher');
    g.coils = M.filter((m) => m.kind === 'coilgun');
    g.uBeam = g.uHub1 - L * 0.075;                          // the beam-turret ring on the forward hub
    g.beamOff = g.beams.length > 2 ? Math.PI / 4 : 0;       // a bigger battery turns the ring off the spoke angles
    return g;
  }

  // a raised plate ring around the axis at height u
  const hoop = (u, r, w, h, seg, mat, facing) => K.lathe({ at: [0, 0, 0], axis: AX, profile: [[u - w / 2, r], [u - w / 2, r + h], [u + w / 2, r + h], [u + w / 2, r]], seg, material: mat, facing: facing || 'flank' });

  // ---- stages ----
  // hub, bearing collar and docking end
  function module(K, c, lay) {
    const g = geom(lay), L = g.L, parts = [], seg = c.seg, fine = c.seg >= 14;
    const { rHub, uHub0, uHub1, rCollar, collarHalf, uRing, rDock, uDock0, uDock1, uNose, rPort } = g;
    // hub drum with a service ring at the truss end
    parts.push(K.tank({ from: uHub0, to: uHub1, r: rHub, axis: AX, material: 'hullLight', dome: 0.08, facing: 'flank' }));
    parts.push(K.cyl({ from: uHub0 - L * 0.012, to: uHub0 + L * 0.01, r: rHub * 0.8, axis: AX, material: 'hullDark', facing: 'flank' }));
    // raised plate rings along the hub
    if (fine) for (const f of [0.12, 0.3, 0.72, 0.9]) parts.push(hoop(uHub0 + (uHub1 - uHub0) * f, rHub, L * 0.006, L * 0.0025, seg, 'armourEdge'));
    // bearing collar in the ring plane: the only part of the hub that turns with the ring
    parts.push(K.cyl({ from: uRing - collarHalf, to: uRing + collarHalf, r: rCollar, axis: AX, material: 'hullDark', facing: 'flank' }));
    parts.push(hoop(uRing - collarHalf * 0.8, rCollar, L * 0.008, L * 0.003, seg, 'mount'));
    parts.push(hoop(uRing + collarHalf * 0.8, rCollar, L * 0.008, L * 0.003, seg, 'mount'));
    // faction band forward of the collar
    parts.push(hoop(uRing + collarHalf + L * 0.03, rHub, L * 0.02, L * 0.0025, seg, 'accent'));
    // docking drum: a narrower fixed section with radial ports, a dome and an axial port at the tip
    parts.push(K.cone({ from: uDock0 - L * 0.005, to: uDock0 + L * 0.02, r0: rHub, r1: rDock, axis: AX, material: 'hullLight', caps: 'none', facing: 'nose' }));
    parts.push(K.cyl({ from: uDock0 + L * 0.02, to: uDock1, r: rDock, axis: AX, material: 'hab', caps: 'none', facing: 'nose' }));
    parts.push(hoop(uDock0 + L * 0.045, rDock, L * 0.014, L * 0.002, seg, 'accentDim', 'nose'));
    if (fine) parts.push(hoop(uDock1 - L * 0.02, rDock, L * 0.006, L * 0.0025, seg, 'armourEdge', 'nose'));
    // nose dome carries the armour thickness of the nose facing
    const noseCap = clamp(0.8 + g.A.nose / 80, 0.8, 1.6);
    parts.push(K.lathe({ at: [0, 0, uDock1], axis: AX, profile: [[0, rDock], [L * 0.012 * noseCap, rDock * 0.92], [L * 0.028 * noseCap, rDock * 0.66], [L * 0.04, rPort * 1.25], [L * 0.045, rPort * 1.25]], seg, material: g.A.nose >= 25 ? 'armour' : 'hullDark', facing: 'nose' }));
    // axial docking collar and its dark throat
    parts.push(K.torus({ at: [0, 0, uDock1 + L * 0.046], axis: AX, R: rPort * 1.05, r: rPort * 0.22, seg: Math.max(12, Math.round(seg * 0.7)), tube: 6, material: 'mount', facing: 'nose' }));
    parts.push(K.cyl({ from: uDock1 + L * 0.03, to: uDock1 + L * 0.046, r: rPort * 0.82, axis: AX, material: 'dark', caps: 'end', facing: 'nose' }));
    parts.push(K.lamp({ at: [0, 0, uNose], color: '#ffffff', r: L * 0.005 }));
    // radial docking ports around the drum, each with a collar, a dark throat and a lamp
    const uPorts = uDock0 + (uDock1 - uDock0) * 0.62, portLen = rDock * 0.75;
    for (let i = 0; i < g.dockPorts; i++) {
      const a = Math.PI / 4 + (i / g.dockPorts) * TAU, base = at(uPorts, rDock * 0.7, a), n = radial(a);
      parts.push(K.cyl({ at: base, axis: n, from: 0, to: rDock * 0.3 + portLen, r: rPort, material: 'hab', caps: 'none', seg: 12, facing: 'nose' }));
      parts.push(K.torus({ at: V.add(base, V.scale(n, rDock * 0.3 + portLen)), axis: n, R: rPort * 1.05, r: rPort * 0.22, seg: 12, tube: 5, material: 'mount', facing: 'nose' }));
      parts.push(K.cyl({ at: base, axis: n, from: rDock * 0.3 + portLen - rPort * 0.3, to: rDock * 0.3 + portLen, r: rPort * 0.82, material: 'dark', caps: 'end', seg: 12, facing: 'nose' }));
      parts.push(K.lamp({ at: V.add(base, V.scale(n, rDock * 0.3 + portLen + rPort * 0.35)), color: '#ffffff', r: L * 0.0035 }));
    }
    // navigation lamps on the hub: red port, green starboard
    parts.push(K.lamp({ at: [0, rHub * 1.02, uHub1 - L * 0.04], color: '#ff5a4a', r: L * 0.004 }));
    parts.push(K.lamp({ at: [0, -rHub * 1.02, uHub1 - L * 0.04], color: '#5aff7a', r: L * 0.004 }));
    return parts;
  }

  // beam turrets on the forward hub, point-defence domes on the ring rim and the lower hub, launch cells and rail
  // pairs between the turrets. Every hub mount keeps clear of the bearing collar band (uRing ± collarHalf + 2 % L),
  // where the spokes and their sockets sit, and of the faction band just forward of it.
  function mounts(K, c, lay) {
    const g = geom(lay), L = g.L, parts = [];
    const { rHub, uHub0, uHub1, uRing, collarHalf, rRing, rTube, belt, uBeam, beamOff } = g;
    const tSeg = Math.max(10, Math.round(c.seg * 0.6));
    // beam turrets: big domes on pedestals in one ring around the forward hub, barrels canted outward and toward the
    // docking end. The stock pair sits port and starboard; a bigger battery turns the ring 45° so no turret sits over
    // a spoke stay where it leaves the hub
    const nb = g.beams.length;
    g.beams.forEach((m, i) => {
      const a = Math.PI / 2 + beamOff + (i / nb) * TAU, ap = m.aperture || 1;
      const r = clamp(ap * 10, L * 0.018, L * 0.035);
      const up = radial(a), base = at(uBeam, rHub * 0.98, a);
      const idx = mIdx(lay, m);
      parts.push(K.cyl({ at: base, axis: up, from: -r * 0.3, to: r * 0.35, r: r * 1.3, material: 'hullDark', caps: 'end', seg: tSeg, facing: 'flank', hp: K.hp('beam', idx) }));
      parts.push(K.turret({ at: V.add(base, V.scale(up, r * 0.35)), r, up, aim: V.norm(V.add(up, V.scale(AX, 1.1))), barrel: r * 0.9, barrelR: r * 0.5, seg: tSeg, facing: 'flank', role: 'beam', index: idx }));   // navy dome-and-stub proportions
    });
    // point-defence domes: even ones ride the ring's outer belt, odd ones the lower hub below the collar, midway
    // between the spokes
    const ringPds = g.pds.filter((m, i) => i % 2 === 0), hubPds = g.pds.filter((m, i) => i % 2 === 1);
    ringPds.forEach((m, i) => {
      const a = Math.PI / 6 + (i / ringPds.length) * TAU, ap = m.aperture || 0.3;
      const r = clamp(ap * 10, L * 0.005, L * 0.009);   // sized like the warships' domes
      parts.push(K.turret({ at: at(uRing, rRing + rTube + belt, a), r, up: radial(a), aim: V.norm(V.add(radial(a), V.scale(AX, 0.8))), barrel: r * 0.8, barrelR: r * 0.25, seg: tSeg, facing: 'flank', role: 'pd', index: mIdx(lay, m) }));
    });
    hubPds.forEach((m, i) => {
      const a = Math.PI / 6 + (i / hubPds.length) * TAU, ap = m.aperture || 0.3;
      const r = clamp(ap * 10, L * 0.005, L * 0.009);   // sized like the warships' domes
      parts.push(K.turret({ at: at(uHub0 + L * 0.03, rHub * 0.99, a), r, up: radial(a), aim: V.norm(V.add(radial(a), V.scale(AX, -0.8))), barrel: r * 0.8, barrelR: r * 0.25, seg: tSeg, facing: 'flank', role: 'pd', index: mIdx(lay, m) }));
    });
    // slots between the beam turrets on the forward hub: cell blocks fill them first, rail pairs follow. The slots
    // nearest the ±x meridians go first so the navigation lamps on the ±y meridians stay clear; with two turrets or
    // fewer the gaps are wide enough to hold two items side by side
    const slots = Math.max(nb, 2), nCoil = g.coils.length, gaps = [];
    for (let j = 0; j < slots; j++) gaps.push(Math.PI / 2 + beamOff + Math.PI / slots + (j / slots) * TAU);
    gaps.sort((p, q) => Math.abs(Math.sin(p)) - Math.abs(Math.sin(q)));
    const blocks = g.bays.length ? Math.min(g.bays.length, 4, Math.max(1, (slots <= 2 ? 4 : slots) - nCoil)) : 0;
    const perSlot = slots <= 2 && blocks + nCoil > slots ? 2 : 1;
    const slotA = (k) => gaps[Math.floor(k / perSlot) % slots] + (perSlot > 1 ? (k % 2 ? 1 : -1) * (Math.PI / slots) * 0.35 : 0);
    // launch cells: blocks on the forward hub between the beam turrets, just below the docking cone
    if (blocks) {
      const total = g.bays.reduce((s, b) => s + (b.count || 6), 0), per = Math.ceil(total / blocks);
      const cell = clamp(L * 0.005, 0.8, 4);
      const cols = Math.ceil(Math.sqrt(per * 1.5)), rows = Math.ceil(per / cols);
      for (let i = 0; i < blocks; i++) {
        const a = slotA(i);
        parts.push(K.cells({ at: at(uHub1 - L * 0.045, rHub * 0.97, a), normal: radial(a), frame: [AX, V.cross(radial(a), AX)], rows, cols, cell, depth: cell * 0.6, facing: 'flank', role: 'bay', index: mIdx(lay, g.bays[Math.min(i, g.bays.length - 1)]) }));
      }
    }
    // rail pairs along the forward hub for slug throwers, starting clear of the collar and the faction band
    const uRail0 = uRing + collarHalf + L * 0.045;
    g.coils.forEach((m, i) => {
      const a = slotA(blocks + i), mv = m.muzzleVelocity || 4000;
      const railR = L * 0.004, gap = railR * 2.6;
      const u1 = uHub1 - L * 0.01, u0 = Math.max(u1 - clamp(L * 0.2 * Math.pow(mv / 4000, 0.7), L * 0.12, L * 0.28), uRail0), len = u1 - u0;
      const n = radial(a), side = V.cross(AX, n), off = rHub + railR * 1.6;
      for (const s of [1, -1]) parts.push(K.rod({ from: V.add(at(u0, off, a), V.scale(side, (s * gap) / 2)), to: V.add(at(u1, off, a), V.scale(side, (s * gap) / 2)), r: railR, material: 'barrel', seg: 8, facing: 'flank', hp: K.hp('coil', mIdx(lay, m)) }));
      parts.push(K.box({ at: at(u0 + len * 0.15, off, a), size: [len * 0.3, gap + railR * 3, railR * 3], frame: [AX, side, n], material: 'mount', facing: 'flank' }));
      const cidx = mIdx(lay, m);
      parts.push(K.box({ at: at(u1 - railR * 2, off, a), size: [railR * 3, gap + railR * 2.6, railR * 2.6], frame: [AX, side, n], material: 'mount', facing: 'flank', hp: K.hp('coil', cidx) }));
      parts.push(K.mark({ at: at(u1 + railR, off, a), dir: AX, up: n, role: 'coil', index: cidx, r: railR, hp: K.hp('coil', cidx) }));
    });
    return parts;
  }

  // radiator farm on the truss, sliding in toward the truss when stowed, plus the coolant main
  function radiators(K, c, lay) {
    const g = geom(lay), L = g.L, parts = [], s = c.state;
    g.panels.forEach((p, pi) => {
      const tang = V.cross(AX, p.dir);
      parts.push(K.radiator({ at: p.at, span: p.span, chord: p.chord, dir: p.dir, along: AX, deploy: s.radiators, mode: 'slide', tubes: clamp(Math.round(p.chord / (L * 0.012)), 3, 9), thick: Math.max(0.5, L * 0.0014), facing: 'tail', role: 'rad', index: pi }));
      // root manifold reaching in through the lattice to the coolant main
      parts.push(K.box({ at: V.add(p.at, V.scale(p.dir, -g.rTruss * 0.45)), size: [p.chord * 0.7, L * 0.008, g.rTruss * 0.95], frame: [AX, tang, p.dir], material: 'hullDark', facing: 'tail' }));
    });
    parts.push(K.rod({ from: [0, 0, g.uTruss0 - L * 0.004], to: [0, 0, g.uTruss1 + L * 0.004], r: L * 0.006, material: 'hullDark', seg: 8, facing: 'tail' }));
    return parts;
  }

  // communication dishes on the docking drum and a lamp on the shield rim
  function sensors(K, c, lay) {
    const g = geom(lay), L = g.L, parts = [];
    const dr = L * 0.018, u = g.uDock0 + (g.uDock1 - g.uDock0) * 0.3;
    for (const a of [0, Math.PI]) {
      const base = at(u, g.rDock * 0.95, a), n = radial(a), top = V.add(base, V.scale(n, dr * 1.1));
      parts.push(K.rod({ from: base, to: top, r: L * 0.0025, material: 'truss', seg: 6, facing: 'nose' }));
      parts.push(K.dish({ at: top, r: dr, depth: dr * 0.3, axis: V.norm(V.add(V.scale(n, 0.7), V.scale(AX, 0.7))), seg: 12, facing: 'nose' }));
    }
    parts.push(K.lamp({ at: [g.rShield + g.shieldT * 0.5 + L * 0.002, 0, g.uShield0 + g.shieldT / 2], color: '#ffffff', r: L * 0.0035 }));
    return parts;
  }

  // the ring with its spokes, the axial truss, the shadow shield and the reactor
  function extras(K, c, lay) {
    const g = geom(lay), L = g.L, parts = [], fine = c.seg >= 14;
    const { rRing, rTube, uRing, rSpoke, rCollar, rHub, belt, beltHalf } = g;
    const ringSeg = clamp(Math.round(c.seg * 1.6), 16, 48), tube = clamp(Math.round(c.seg * 0.4), 6, 12);
    // the habitat torus
    parts.push(K.torus({ at: [0, 0, uRing], axis: AX, R: rRing, r: rTube, seg: ringSeg, tube, material: 'hullLight', facing: 'flank' }));
    // armour belt around the outer rim, following the tube, with the faction band down its middle
    const tubeAt = (b, extra) => [uRing + (rTube + extra) * Math.sin(b), rRing + (rTube + extra) * Math.cos(b)];
    const beltProf = [];
    for (let i = 0; i <= 6; i++) beltProf.push(tubeAt(-beltHalf + (2 * beltHalf * i) / 6, belt));
    parts.push(K.lathe({ at: [0, 0, 0], axis: AX, profile: beltProf, seg: ringSeg, material: 'armour', facing: 'flank' }));
    parts.push(K.lathe({ at: [0, 0, 0], axis: AX, profile: [tubeAt(-0.09, belt + L * 0.001), tubeAt(0.09, belt + L * 0.001)], seg: ringSeg, material: 'accent', facing: 'flank' }));
    if (fine) {
      // plate seams around the tube on both faces of the ring
      for (const b of [-1.35, -0.95, 0.95, 1.35]) parts.push(K.lathe({ at: [0, 0, 0], axis: AX, profile: [tubeAt(b - 0.05, L * 0.0012), tubeAt(b + 0.05, L * 0.0012)], seg: ringSeg, material: 'armourEdge', facing: 'flank' }));
      // frame rings around the tube, twelve of them, set half a step off the spoke angles
      const fSeg = clamp(Math.round(c.seg * 0.4), 8, 12);
      for (let i = 0; i < g.spokes * 2; i++) {
        const a = ((i + 0.5) / (g.spokes * 2)) * TAU;
        parts.push(K.torus({ at: at(uRing, rRing, a), axis: [-Math.sin(a), Math.cos(a), 0], R: rTube + L * 0.001, r: L * 0.0028, seg: fSeg, tube: 4, material: 'armourEdge', facing: 'flank' }));
      }
    }
    // spokes: a pressurised tube from the collar to the ring, with a pair of stays from the hub either side
    for (let i = 0; i < g.spokes; i++) {
      const a = (i / g.spokes) * TAU, n = radial(a);
      parts.push(K.rod({ from: at(uRing, rCollar * 0.8, a), to: at(uRing, rRing, a), r: rSpoke, material: 'hullLight', seg: 8, facing: 'flank' }));
      parts.push(K.cyl({ at: at(uRing, rRing - rTube - rSpoke * 1.2, a), axis: n, from: 0, to: rSpoke * 2.4, r: rSpoke * 1.5, material: 'hullDark', seg: 10, facing: 'flank' }));
      parts.push(K.cyl({ at: at(uRing, rCollar - rSpoke * 0.5, a), axis: n, from: 0, to: rSpoke * 2.2, r: rSpoke * 1.5, material: 'hullDark', seg: 10, facing: 'flank' }));
      for (const s of [1, -1]) parts.push(K.rod({ from: at(uRing + s * L * 0.075, rHub * 0.85, a), to: at(uRing + s * rTube * 0.3, rRing - rTube * 0.4, a), r: L * 0.002, material: 'trussDark', seg: 5, facing: 'flank' }));
    }
    // ring lamps: red along the port half, green along the starboard half
    for (const d of [50, 90, 130]) parts.push(K.lamp({ at: at(uRing, rRing + rTube + belt + L * 0.002, (d * Math.PI) / 180), color: '#ff5a4a', r: L * 0.004 }));
    for (const d of [230, 270, 310]) parts.push(K.lamp({ at: at(uRing, rRing + rTube + belt + L * 0.002, (d * Math.PI) / 180), color: '#5aff7a', r: L * 0.004 }));
    // axial truss between the shield and the hub
    const truLen = g.uTruss1 - g.uTruss0;
    parts.push(K.truss({ from: [0, 0, g.uTruss0], to: [0, 0, g.uTruss1], r: g.rTruss, n: 6, bays: Math.max(4, Math.round(truLen / (g.rTruss * 1.6))), member: clamp(L * 0.0022, 0.3, 2.5), facing: 'tail' }));
    // shadow shield: a thick disc on the habitat side of the reactor, with an edge ring
    parts.push(K.cyl({ from: g.uShield0, to: g.uShield1, r: g.rShield, axis: AX, material: 'shield', facing: 'tail' }));
    parts.push(K.torus({ at: [0, 0, g.uShield0 + g.shieldT / 2], axis: AX, R: g.rShield, r: g.shieldT * 0.5, seg: c.seg, tube: 6, material: 'armourEdge', facing: 'tail' }));
    // reactor drum with cooling ribs, a neck to the shield and a rear skirt sized by the tail armour
    parts.push(K.cyl({ from: g.uR1 - L * 0.002, to: g.uShield0 + L * 0.002, r: g.rReactor * 0.45, axis: AX, material: 'trussDark', caps: 'none', facing: 'tail' }));
    // the drum carries the reactor's own state, as the core's does: the board sends a party to it
    const rhp = K.hp('reactor'), ribs = rhp <= 0 ? 0 : rhp < 0.5 ? 2 : 4;
    parts.push(K.cyl({ from: g.uR0, to: g.uR1, r: g.rReactor * (rhp <= 0 ? 0.87 : 1), axis: AX, material: 'reactor', facing: 'tail', hp: rhp }));
    for (let i = 1; i <= ribs; i++) parts.push(hoop(g.uR0 + (g.reactorLen * i) / (ribs + 1), g.rReactor, L * 0.006, g.rReactor * 0.05, c.seg, 'trussDark', 'tail'));
    const skirt = clamp(0.6 + g.A.tail / 60, 0.6, 1.3);
    parts.push(K.lathe({ at: [0, 0, g.uR0], axis: AX, profile: [[0, 0], [0, g.rReactor * 1.08 * skirt], [-(g.uR0 - g.uTail) * 0.6, g.rReactor * 0.9 * skirt], [-(g.uR0 - g.uTail), g.rReactor * 0.55], [-(g.uR0 - g.uTail), 0]], seg: c.seg, material: g.A.tail >= 15 ? 'armour' : 'hullDark', facing: 'tail' }));
    // Anchors for a repair party, placed here because the station's axis is not the hull axis: her reactor
    // stands at the far end of the truss and her sensor suite is the dish pair on the docking drum, so the
    // core's own tail-and-nose anchors would land in empty space. Each is hidden from the end the station
    // itself is in the way from.
    parts.push(K.mark({ at: [0, 0, (g.uR0 + g.uR1) / 2], dir: [0, 0, -1], axis: [0, 0, -1], role: 'reactor', index: 0, r: g.rReactor, hp: K.hp('reactor') }));
    parts.push(K.mark({ at: [0, 0, g.uDock0 + (g.uDock1 - g.uDock0) * 0.3], dir: AX, axis: AX, role: 'sensors', index: 0, r: g.rDock, hp: K.hp('sensors') }));
    return parts;
  }

  // ---------------------------------------------------------------- part text
  // What the hull view and the hangar print under the picture: one plain sentence a part, with its number.
  const grp = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');   // 6000 -> '6 000'
  const mw1 = (w) => Math.round(((w || 0) / 1e6) * 10) / 10;                        // watts -> MW, one decimal
  const ap1 = (a) => (Math.round((a || 1) * 10) / 10).toFixed(1);                   // mirror across, '1.4'
  // What the simulation has behind the picture: js/damage.js builds six radiator parts on this hull (its own
  // count by area for a custom one), and js/physics.js holds the farm below its rating until the heat sink
  // passes the knee (P.SINK_KNEE).
  const SIGMA = 5.670374419e-8;                                                   // Stefan–Boltzmann, as js/physics.js has it
  const radParts = (D) => ({ station: 6 }[D.hull]) || ((D.radiatorArea || 0) >= 5000 ? 6 : (D.radiatorArea || 0) >= 1500 ? 4 : 2);
  const radMW = (D) => {                                                          // panel rating in MW: both faces, emissivity 0.9
    const Ph = window.OD && window.OD.P, a = D.radiatorArea || 0, T = D.radiatorTemp || 1000;
    return grp((Ph && Ph.radiatorPower ? Ph.radiatorPower(a, T) : 2 * a * 0.9 * SIGMA * Math.pow(T, 4)) / 1e6);
  };
  const kneePct = () => Math.round(((window.OD && window.OD.P && window.OD.P.SINK_KNEE) || 0.6) * 100);

  A.registerFamily('station', {
    name: 'Orbital station',
    blurb: 'A habitat ring spun on a fixed hub. Two defence lasers cover the docking end, the radiator farm hangs down the axial truss, and there is no drive.',
    length: 600,
    radius: 0.055,
    stages: { cap: null, spinal: null, spine: null, tanks: null, tail: null, module, mounts, radiators, sensors, extras },
    callouts(lay) {
      const g = geom(lay), out = [];
      out.push({ label: 'Habitat ring', text: Math.round(g.rRing * 2) + ' m across, spun for gravity on ' + g.spokes + ' spokes.', at: at(g.uRing, g.rRing + g.rTube, 0) });
      out.push({ label: 'Hub', text: 'The fixed drum the ring turns on, with its bearing collar in the ring plane.', at: at((g.uHub0 + g.uHub1) / 2, g.rHub, 0) });
      out.push({ label: 'Docking ports', text: g.dockPorts + (g.dockPorts === 1 ? ' berth around the hub' : ' berths around the hub') + ' and one at the tip, where ships come alongside.', at: at(g.uDock1, g.rDock, 0) });
      if (g.beams.length) { const n = g.beams.length, m = g.beams[0]; out.push({ label: 'Beam turrets', text: n + (n === 1 ? ' defence laser on the forward hub, ' : ' defence lasers on the forward hub, ') + mw1(m.power) + (n === 1 ? ' MW on a ' : ' MW each on ') + ap1(m.aperture) + (n === 1 ? ' m mirror.' : ' m mirrors.'), at: at(g.uBeam, g.rHub * 1.8, Math.PI / 2 + g.beamOff) }); }
      if (g.pds.length) { const n = g.pds.length; out.push({ label: 'Point defence', text: n + (n === 1 ? ' dome with a ' : ' domes with ') + mw1(g.pds[0].power) + (n === 1 ? ' MW laser on the ring rim, ' : ' MW lasers on the ring rim and the hub, ') + 'shooting at inbound interceptors.', at: at(g.uRing, g.rRing + g.rTube, Math.PI / 6) }); }
      out.push({ label: 'Axial truss', text: Math.round(Math.abs(g.uTruss1 - g.uTruss0)) + ' m of open lattice, holding the habitat away from the reactor.', at: [0, 0, (g.uTruss0 + g.uTruss1) / 2] });
      // The farm is rated ten times what the habitat makes, and a rating on its own reads as a lie next to
      // the 30 MW in ships.js. Say what the margin is for: the reactor at full output and the ships alongside.
      if (g.farm) {
        const np = radParts(g.D);
        const idle = g.D.idleHeat ? mw1(g.D.idleHeat) : null;
        out.push({ label: 'Radiator farm',
          text: grp(g.D.radiatorArea || 0) + ' m² in ' + np + (np === 1 ? ' panel, shedding' : ' panels, shedding') + ' up to ' + radMW(g.D)
            + ' MW, at their full ' + grp(g.D.radiatorTemp || 1000) + ' K only once the sink is over ' + kneePct() + ' %.'
            + (idle ? ' The habitat itself makes ' + idle + ' MW of heat. The margin is for the reactor and for ships alongside.' : ''),
          at: at((g.farm.u0 + g.farm.u1) / 2, g.rTruss + g.farm.span, 0) });
      }
      out.push({ label: 'Shadow shield', text: 'Shielding between the reactor and the habitat.', at: at(g.uShield0, g.rShield, 0) });
      out.push({ label: 'Reactor', text: mw1(g.D.reactorPower) + ' MW at the far end of the truss, powering the habitat' + (g.beams.length || g.pds.length ? ' and its lasers.' : '.'), at: at((g.uR0 + g.uR1) / 2, g.rReactor, 0) });
      return out;
    },
    notes: 'The station is a Stanford-style torus on six pressurised spokes around a fixed hub, its axis standing dorsal so the tactical map looks straight down at the ring. The hub carries the docking end beyond the ring, with four radial berths, an axial port and the communication dishes, and the bearing collar sits in the ring plane. Below the ring a long six-longeron truss carries the coolant main and the radiator farm, a fan of panels that slides in toward the truss when stowed and grows first in panel size and then in ranks with radiator area. The reactor drum sits at the far end behind a shadow shield sized to its power, so the habitat and the docking traffic stay in the shadow. The armour numbers thicken the belt around the ring rim, the dome at the docking end and the reactor skirt. There is no drive and no propellant aboard, so the station holds its orbit and draws no plume.',
  });
})();
