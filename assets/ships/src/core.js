/* Orbital Declaration — ship art.
   Procedural hard science fiction spacecraft drawn in Canvas 2D from a design object: a tiny orthographic 3D
   renderer (lathes, boxes, rods, trusses, plates) with sun/fill/ambient shading, per-facing damage, heat-glowing
   radiators, deployable panels, an exhaust plume and a sprite cache. No external assets, no build step.
   Load after js/ships.js. js/shipart.js is BUILT by assets/ships/build.sh from assets/ships/src/core.js (this
   text) plus the hull families assets/ships/src/*.js appended at the end; edit those sources and rebuild rather
   than the built file. See assets/ships/src/README.md for how a family is written.

   ============================ INTERFACE (OD.ShipArt) ============================
   design  = a hull id ('corvette' 'frigate' 'destroyer' 'cruiser' 'lancer' 'freighter' 'station': the stock class
             from OD.Ships.CLASSES) or a design object. A design object carries the same fields a class does; every
             field is optional and falls back to the preset of `hull`:
       hull            hull family: proportions and styling
       length          metres; everything scales with it
       propMass        kg → propellant tank volume (bigger tanks, more past a threshold)
       thrust          N → nozzle exit size; exhaustVelocity m/s → bell kind (chemical < 6 km/s, thermal < 15, torch)
       reactorPower    W → reactor drum and shadow shield size
       radiatorArea    m² (both faces) → panel span and count;  radiatorTemp K
       armour          { nose, flank, tail } cm → cap length and bluntness, flank plating, tail skirt, plate rings
       mounts          ships.js records: { kind:'beam', aperture, arc:'nose'|'turret' } spinal tube or dome turret,
                       { kind:'coilgun', muzzleVelocity } rail pair, { kind:'launcher', count } launch cells,
                       { kind:'pd' } small dome. Order does not matter.
       tanks           { count, arrangement:'cluster'|'inline'|'saddle'|'ring', material:'tank'|'tankSilver'|'tankWhite' }
       radiators       { panels, layout:'wings'|'cross'|'fan', mode:'slide'|'fold' }
       drive           { nozzles: 1..4, kind }
       faction         'JC' | 'ISA' | 'CIV' (opts.faction overrides)
       base / artBase  alias of hull for configurator designs; beam (m) sets the hull width when given;
                       a design with `id` and `rev` is cached by id@rev (bump rev on every change)

   OD.ShipArt.draw(ctx, design, opts)   draws the ship centred on (opts.x, opts.y) in the current ctx transform.
     → true when it drew the hull, false when it drew NOTHING and the caller has to: no such hull family,
       or (with opts.frame) this frame has already paid for its one cold render and this hull has no sprite
       in hand yet. A caller that can draw an icon should: `if (OD.ShipArt.draw(ctx, id, o) === false) drawIcon()`
       — and skip overlay(), which answers false for the same hull. It is one frame: ask again next frame
       and the hull is there. A caller that cannot (an inspection picture) can leave opts.frame out.
     opts = {
       x: 0, y: 0,                        centre of the hull (the design origin) in ctx pixels
       size: 200,                         hull length in pixels (nose to drive exit)
       view: 'threequarter',              'side' | 'threequarter' | 'dorsal34' | 'top' | 'bottom' | 'front' | 'rear'
                                          or { az, el } degrees: direction from the ship TO the camera in the ship
                                          frame (x nose, y port, z dorsal). 'top' is the tactical-map view, nose to
                                          the right; 'side' the profile, nose to the right.
       rotation: 0,                       in-plane rotation of the finished picture (radians, canvas sense)
       faction: 'JC' | 'ISA' | 'CIV',     hull markings colour (from OD.Ships.FACTIONS; a hex colour also works)
       light: { az: -50, el: 35 },        direction TO the key light (sun) in the ship frame, degrees; or {x,y,z}
       state: {
         radiators: 1,                    0 stowed … 1 fully extended
         throttle: 0,                     0 … 1, lights the drive and (with plume) draws the exhaust
         heat: 0,                         0 … 1 heat-sink load: radiators dull red → orange → yellow-white
         hull: 1,                         0 … 1 hull integrity (below 0.5 the hull looks torn)
         damage: { nose: 0, flank: 0, tail: 0 },   0 … 1 facing armour worn away (scorch, then holes)
         systems: { drive: 1, radiators: 1, sensors: 1 },   0 … 1; low values darken that gear
         disabled: false, destroyed: false
       },
       plume: true,                       draw the exhaust (live, animated by opts.time in seconds)
       time: 0,                           animation clock for the plume flicker
       cache: true,                       reuse the rendered sprite (keyed on design, view, size, faction, light
                                          in about 20° buckets, and state buckets); a cached draw costs
                                          ~0.01 ms, a render 5–60 ms
       frame: undefined,                  the caller's frame counter (one integer per drawn frame). With it,
                                          only the first cold render of a frame is paid for: a later miss in
                                          the same frame is drawn from the nearest sprite in hand (the same
                                          hull, view and size, another light, radiator or damage bucket) and
                                          the exact one is rendered in a later frame. With nothing of that
                                          hull in hand at all, draw() draws nothing and returns false — the
                                          first frame of a fight costs one render, not eight, and the caller
                                          draws icons for the rest. Leave it out and every miss renders.
       quality: 'auto' | 'low' | 'high',  tessellation (auto picks from size)
       live: false,                       the caller will follow with overlay(), which draws each beam turret's
                                          barrel at the bearing gunnery is holding: draw() leaves the fixed
                                          barrel out of the sprite so there is only ever one
       fx: null, simTime: 0               see overlay()
     }
     state.parts (optional, filled by stateFromShip from the damage module) is what each part has left:
       { mounts: [hp by ship.mounts index], rads: [hp], tanks: [hp], drive, reactor, sensors }, 0 = wrecked.
       A hit part is drawn hit, in shape as well as in paint, because half the angles a fight is watched from
       show a part edge-on and darker paint says nothing there: a panel loses its metal, a dome is opened up
       and loses its barrel, a rail pair is a stub at the breech, a launch block is a burnt-out frame, the
       reactor drum loses its ribs. No glow, no lamp, plating burnt through. It is in the sprite key in four
       steps (wrecked / under half / worn / sound), so damage costs one render, not one a frame.

   OD.ShipArt.overlay(ctx, design, opts)  what the ship is DOING this instant, drawn over the sprite that
     draw() just put down — mount slew, muzzle flashes, the first stretch of a beam, slug streaks, a cell
     opening and the interceptor leaving it, point-defence bolts and venting tanks. Call it AFTER draw() with
     the same opts (x, y, size, view, rotation, state) plus opts.fx and opts.simTime. It renders no geometry:
     it reads back the sprite draw() cached (positions of every mount came with it), so it costs ~0.05 ms.
     Every effect ages against opts.simTime, never a wall clock: at warp 0 they hold, at 16× they are gone in
     a blink. Nothing in here runs on a timer of its own.
     opts.fx = OD.Engagement.artFx(ship, sim) = {
       t,                                 the sim time this snapshot was taken at
       aim,                               bearing gunnery is holding, rad in the SHIP frame (0 = nose, + to
                                          port), null with no target: what the beam turrets slew to
       mounts: [{ id, kind, index, arc, bearing, firedAt }]   a mount that is firing now or fired a moment
                                          ago: id is its place in ship.mounts, index its place among the
                                          mounts of that kind, kind 'beam' | 'coilgun', bearing the firing
                                          bearing in the ship frame, firedAt the sim time the shot left
       launches: [{ t, bearing, index }]  an interceptor that left a bay at sim time t
       pd: [{ t, index, toward: { x, y } }]   a point-defence mount burning, toward a unit vector (ship frame)
       vents: [{ tank, of, rate, t }]     a holed tank (tank of of tanks) and how hard it is going, 0..1
       parties: [{ id, part, progress, eta, working }]   from OD.Crew.artFx: a repair party at work.
                                          `part` is the component the damage module names ('drive',
                                          'reactor', 'sensors', 'rad2', 'tank1', 'beam1', 'coil1',
                                          'bay1', 'pd3'), `progress` 0..1, `eta` the seconds it has
                                          left, `working` false while the crew is strapped in for a
                                          burn and the work is paused. Each is drawn as a small ring on
                                          that part's own anchor — the progress as an arc, the party's
                                          number inside, lit and breathing against opts.simTime while
                                          it works, dim and still while it is held — and only when the
                                          hull is 120 px or more (opts.size), so the map at fighting
                                          zoom stays clean and the hull view and the portrait show
                                          them. A part this hull has no anchor for, or one round the
                                          far side of it, draws nothing.
     }
   OD.ShipArt.muzzle(design, opts, mount) → { x, y }: where that mount's shot leaves the hull, in the canvas
     coordinates draw() drew it in for these opts (x, y, size, view, rotation, faction) — the end of a
     trained beam barrel, the rails of a coilgun. `mount` is one of artFx's mounts: { id, index, kind:
     'beam' | 'coilgun' } (arc 'nose' means the spinal tube), the same anchors the overlay draws from, so
     the map can start a beam at the mirror that lit. null when the hull carries no such mount, when the
     mount is on the far side of the hull, or when this sprite has not been rendered yet: muzzle() reads
     the cache and never renders.
   OD.ShipArt.lastParties()              → [{ id, part, working, x, y, r, moved, eta }] where the last overlay()
                                            put its repair-party rings, in the canvas coordinates it drew them in
                                            (r the ring radius, moved how far the ring gave way to a neighbour,
                                            eta { text, x, y, w, h } the time under it or null when it printed none)
   OD.ShipArt.cacheStats()               → { sprites, bytes, maxBytes, maxSprites, evictions, builds } for the sprite
                                            cache; `builds` counts the sprites rendered since the page loaded
   OD.ShipArt.render(design, opts)       → { canvas, ox, oy, w, h }: the cached sprite; (ox, oy) is the ship origin
                                            inside the canvas, for compositing yourself. With opts.frame, a frame
                                            that has already paid for one render is handed the nearest sprite in
                                            hand instead of rendering a second, and null when it holds none of
                                            that hull (see `frame` above)
   OD.ShipArt.bounds(design, opts)       → { w, h, ox, oy } pixel bounds of the hull for that view and size (no plume)
   OD.ShipArt.callouts(design, opts)     → [{ label, text, x, y, depth }] labelled parts, projected like draw()
                                            (x, y relative to the ship origin, rotation applied) for an inspect view
   OD.ShipArt.describe(design)           → { id, name, length, blurb, parts: [{label, text}], notes }
   OD.ShipArt.preset(id)                 → the stock class as a full design object (copy, edit, draw)
   OD.ShipArt.layout(design)             → the computed layout (positions and sizes in metres) for a configurator
   OD.ShipArt.stateFromShip(ship, sim)   → { faction, state, light } straight from a live sim ship (light from
                                            sim.sunAngle − ship.heading, 30° above the plane); spread into opts
   OD.ShipArt.list() / has(id)           registered hull families
   OD.ShipArt.registerFamily(id, fam)    adds a family (see assets/ships/src/README.md);  OD.ShipArt.kit is the parts kit
   OD.ShipArt.clearCache()

   Integration notes: the map should call draw() with view 'top', rotation = −heading (canvas sense), plume:false
   (render.js already draws map plumes) and the light from stateFromShip(). The ship panel portrait uses
   'threequarter' at 140–220 px. The inspect view uses 'side' or 'threequarter' at 600–900 px with callouts().
   A configurator passes a design object and redraws on every change; an orbit camera is view: { az, el } per frame.
   ================================================================================= */
(function () {
  'use strict';
  const OD = (window.OD = window.OD || {});
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const rad = (d) => (d * Math.PI) / 180;

  // ---------------------------------------------------------------- vec3
  const V = {
    add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
    sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
    scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
    dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
    cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
    len: (a) => Math.hypot(a[0], a[1], a[2]),
    norm(a) { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
    // rotate p about a unit axis through pivot by angle (Rodrigues)
    rot(p, axis, ang, pivot) {
      const q = pivot ? V.sub(p, pivot) : p;
      const c = Math.cos(ang), s = Math.sin(ang), k = axis;
      const kd = V.dot(k, q);
      const kc = V.cross(k, q);
      const r = [q[0] * c + kc[0] * s + k[0] * kd * (1 - c), q[1] * c + kc[1] * s + k[1] * kd * (1 - c), q[2] * c + kc[2] * s + k[2] * kd * (1 - c)];
      return pivot ? V.add(r, pivot) : r;
    },
    // any orthonormal basis (u, v) perpendicular to unit vector n
    basis(n) {
      const ref = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
      const u = V.norm(V.cross(ref, n));
      const v = V.cross(n, u);
      return [u, v];
    },
  };
  const AXES = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
  const axisVec = (a) => (typeof a === 'string' ? AXES[a] : V.norm(a));

  // ---------------------------------------------------------------- what the current build is drawing for
  // Set for the length of one buildScene: the live state, so a part can be dimmed to what its component has
  // left without every family threading the number through, and whether the caller will follow with
  // overlay(), which draws the beam turrets' barrels at the bearing they are holding.
  let BUILD = null, LIVE = false;
  // What a part still has, 0 wrecked … 1 sound. role names the component: a mount by its place in
  // ship.mounts, a radiator panel or a tank by its place in the picture (the damage module keeps fewer of
  // them than the art draws, so the list is spread over the parts), drive / reactor / sensors by name.
  function pickHp(list, i, n) {
    if (!list || !list.length || i == null) return 1;
    const k = n > 0 ? Math.floor((i * list.length) / n) : i;
    const v = list[clamp(Math.round(k), 0, list.length - 1)];
    return typeof v === 'number' ? clamp(v, 0, 1) : 1;
  }
  function unitHp(role, index) {
    if (!BUILD || !role) return 1;
    const st = BUILD.st, P = BUILD.parts;
    const sys = (st && st.systems) || {};
    if (role === 'drive') return P && P.drive != null ? clamp(P.drive, 0, 1) : clamp(sys.drive == null ? 1 : sys.drive, 0, 1);
    if (role === 'reactor') return P && P.reactor != null ? clamp(P.reactor, 0, 1) : 1;
    if (role === 'sensors') return P && P.sensors != null ? clamp(P.sensors, 0, 1) : clamp(sys.sensors == null ? 1 : sys.sensors, 0, 1);
    if (!P) {
      if (role === 'rad') return clamp(sys.radiators == null ? 1 : sys.radiators, 0, 1);
      return 1;
    }
    if (role === 'rad') return pickHp(P.rads, index, BUILD.radCount);
    if (role === 'tank') return pickHp(P.tanks, index, BUILD.tankCount);
    if (!P.mounts || index == null) return 1;
    const v = P.mounts[index];
    return typeof v === 'number' ? clamp(v, 0, 1) : 1;
  }

  // ---------------------------------------------------------------- colour
  function hexToRgb(h) {
    if (!h) return [0.7, 0.7, 0.7];
    if (Array.isArray(h)) return h;
    h = h.replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h, 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
  const css = (c, a) => 'rgba(' + Math.round(clamp(c[0], 0, 1) * 255) + ',' + Math.round(clamp(c[1], 0, 1) * 255) + ',' + Math.round(clamp(c[2], 0, 1) * 255) + ',' + (a === undefined ? 1 : a) + ')';
  const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  const mul = (a, b) => [a[0] * b[0], a[1] * b[1], a[2] * b[2]];

  // heat ramp for radiators: dull red at idle, orange, yellow-white when the sink is nearly full
  const HEAT = [[0.30, 0.09, 0.07], [0.62, 0.16, 0.07], [0.95, 0.42, 0.12], [1.0, 0.72, 0.30], [1.0, 0.93, 0.72]];
  function heatColor(t) {
    t = clamp(t, 0, 1) * (HEAT.length - 1);
    const i = Math.min(HEAT.length - 2, Math.floor(t));
    return mix(HEAT[i], HEAT[i + 1], t - i);
  }

  // ---------------------------------------------------------------- materials
  // color: albedo (linear-ish 0..1), spec: specular strength, gloss: exponent, vary: per-plate brightness noise
  const MATERIALS = {
    hull:       { color: [0.60, 0.64, 0.70], spec: 0.25, gloss: 14, vary: 0.05 },   // plated pressure hull
    hullDark:   { color: [0.42, 0.45, 0.50], spec: 0.20, gloss: 12, vary: 0.05 },
    hullLight:  { color: [0.76, 0.78, 0.82], spec: 0.25, gloss: 14, vary: 0.04 },
    armour:     { color: [0.36, 0.38, 0.42], spec: 0.14, gloss: 6,  vary: 0.06 },   // thick facing armour, matte
    armourEdge: { color: [0.30, 0.31, 0.34], spec: 0.10, gloss: 5,  vary: 0.04 },
    tank:       { color: [0.88, 0.76, 0.48], spec: 0.90, gloss: 34, vary: 0.02 },   // gold foil insulation
    tankSilver: { color: [0.80, 0.82, 0.86], spec: 0.80, gloss: 30, vary: 0.02 },
    tankWhite:  { color: [0.86, 0.87, 0.88], spec: 0.35, gloss: 16, vary: 0.02 },   // painted tank
    truss:      { color: [0.44, 0.45, 0.47], spec: 0.20, gloss: 10, vary: 0.0 },
    trussDark:  { color: [0.30, 0.31, 0.33], spec: 0.20, gloss: 10, vary: 0.0 },
    nozzle:     { color: [0.34, 0.34, 0.36], spec: 0.55, gloss: 24, vary: 0.03 },   // regeneratively cooled bell
    nozzleIn:   { color: [0.16, 0.16, 0.18], spec: 0.30, gloss: 10, vary: 0.0, driveGlow: true },
    shield:     { color: [0.22, 0.23, 0.26], spec: 0.10, gloss: 4,  vary: 0.03 },   // shadow shield, reactor
    reactor:    { color: [0.28, 0.29, 0.32], spec: 0.20, gloss: 8,  vary: 0.03 },
    radiator:   { color: [0.30, 0.14, 0.12], spec: 0.10, gloss: 4,  vary: 0.0, radiator: true },
    radiatorEdge: { color: [0.24, 0.22, 0.22], spec: 0.10, gloss: 4, vary: 0.0 },
    sensor:     { color: [0.10, 0.11, 0.14], spec: 0.70, gloss: 40, vary: 0.0, sensorDim: true },
    dish:       { color: [0.82, 0.83, 0.85], spec: 0.30, gloss: 10, vary: 0.0, sensorDim: true },
    mount:      { color: [0.40, 0.42, 0.46], spec: 0.30, gloss: 16, vary: 0.03 },   // turret housings, rails
    barrel:     { color: [0.26, 0.27, 0.30], spec: 0.40, gloss: 20, vary: 0.0 },
    bayDoor:    { color: [0.50, 0.52, 0.56], spec: 0.20, gloss: 10, vary: 0.04 },
    bayDark:    { color: [0.06, 0.06, 0.08], spec: 0.0,  gloss: 1,  vary: 0.0 },
    accent:     { color: null, spec: 0.30, gloss: 12, vary: 0.0 },                  // faction colour
    accentDim:  { color: null, dim: true, spec: 0.20, gloss: 10, vary: 0.0 },
    dark:       { color: [0.10, 0.11, 0.13], spec: 0.05, gloss: 2,  vary: 0.0 },
    white:      { color: [0.86, 0.86, 0.86], spec: 0.20, gloss: 10, vary: 0.03 },
    hab:        { color: [0.70, 0.71, 0.74], spec: 0.20, gloss: 12, vary: 0.04 },   // habitat / crew module
    lamp:       { color: [1, 1, 1], emissive: 1 },
  };

  // ---------------------------------------------------------------- hashing (for plate variation and damage)
  function hash01(a, b, c) {
    let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
    h = (h ^ (h >>> 13)) * 1274126177; h = (h ^ (h >>> 16)) >>> 0;
    return h / 4294967296;
  }

  // ---------------------------------------------------------------- the parts kit
  // Every kit function returns a part or an array of parts. A part is { kind, material, color?, facing?, role?, … }
  // with geometry given in metres in the ship frame: x toward the nose, y port, z dorsal; the design origin is
  // the middle of the hull. Optional on any part: rot: [axis, angle, pivot], shift: [dx,dy,dz], facing:
  // 'nose'|'flank'|'tail' (else inferred from x), material (a MATERIALS key), color (hex or [r,g,b] override),
  // hide: true to skip.
  const KIT = {
    // solid of revolution. profile: [[u, r], …] along `axis` from `at`; arc: [a0, a1] radians for a partial lathe
    lathe(o) { return Object.assign({ kind: 'lathe', axis: 'x', at: [0, 0, 0], material: 'hull' }, o); },
    cyl(o) {
      const p = [];
      if (o.caps !== 'none' && o.caps !== 'end') p.push([o.from, 0]);
      p.push([o.from, o.r], [o.to, o.r]);
      if (o.caps !== 'none' && o.caps !== 'start') p.push([o.to, 0]);
      return KIT.lathe(Object.assign({}, o, { profile: p }));
    },
    cone(o) {
      const p = [];
      if (o.caps !== 'none' && o.caps !== 'end') p.push([o.from, 0]);
      p.push([o.from, o.r0], [o.to, o.r1]);
      if (o.caps !== 'none' && o.caps !== 'start') p.push([o.to, 0]);
      return KIT.lathe(Object.assign({}, o, { profile: p }));
    },
    // cylinder with domed ends (dome = dome height as a fraction of r)
    tank(o) {
      const dome = o.dome === undefined ? 0.6 : o.dome, r = o.r, n = 5, p = [];
      const h = r * dome;
      p.push([o.from, 0]);
      for (let i = 1; i <= n; i++) { const a = (i / n) * Math.PI / 2; p.push([o.from + h - h * Math.cos(a) - 0 + 0, r * Math.sin(a)]); }
      p[p.length - 1] = [o.from + h, r];
      p.push([o.to - h, r]);
      for (let i = n - 1; i >= 1; i--) { const a = (i / n) * Math.PI / 2; p.push([o.to - h + h * Math.cos(a), r * Math.sin(a)]); }
      p.push([o.to, 0]);
      const hp = o.hp === undefined ? unitHp(o.role, o.index) : o.hp;
      const lathe = KIT.lathe(Object.assign({ material: 'tank' }, o, { profile: p, hp }));
      if (!o.role) return lathe;
      // the vent jet leaves from the side of the tank, so the anchor faces out of the hull
      const out = V.len(o.at || [0, 0, 0]) > 1e-6 ? V.norm([0, (o.at || [0, 0, 0])[1], (o.at || [0, 0, 0])[2]]) : [0, 0, 1];
      const axis = axisVec(o.axis || 'x');
      const side = V.len(V.cross(axis, out)) > 1e-6 ? V.norm(out) : [0, 0, 1];
      return [lathe, KIT.mark({ at: V.add(V.add(o.at || [0, 0, 0], V.scale(axis, (o.from + o.to) / 2)), V.scale(side, r * 0.9)), dir: side, up: axis, role: o.role, index: o.index, r, hp })];
    },
    sphere(o) {
      const n = o.rings || 8, p = [];
      for (let i = 0; i <= n; i++) { const a = -Math.PI / 2 + (i / n) * Math.PI; p.push([o.r * Math.sin(a), o.r * Math.cos(a)]); }
      return KIT.lathe(Object.assign({}, o, { profile: p }));
    },
    // paraboloid dish opening toward +axis; depth = dish depth
    dish(o) {
      const n = 5, p = [];
      for (let i = 0; i <= n; i++) { const f = i / n; p.push([o.depth * (1 - f * f), o.r * (1 - f)]); }
      p.reverse();
      return KIT.lathe(Object.assign({ material: 'dish' }, o, { profile: p, inside: true }));
    },
    // rectangular block: at = centre, size = [sx, sy, sz]
    box(o) { return Object.assign({ kind: 'box', material: 'hull' }, o); },
    plate(o) { return KIT.box(o); },
    // thin cylinder between two points (struts, masts, rails)
    rod(o) {
      const d = V.sub(o.to, o.from), L = V.len(d);
      // A rod given an `hp` is part of a component, not scenery: a rail pair is the coilgun itself, and a
      // wrecked gun is not a dark gun — the rails are shot through and what is left is the stub at the
      // breech, which reads from every side the rails did.
      const len = o.hp != null && o.hp <= 0 ? L * 0.34 : L;
      return KIT.lathe(Object.assign({ seg: 6, material: 'truss' }, o, { at: o.from, axis: d, profile: [[0, 0], [0, o.r], [len, o.r], [len, 0]] }));
    },
    // open lattice between two points: n longerons at radius r, `bays` bays with diagonals and ring frames
    truss(o) { return Object.assign({ kind: 'truss', n: 4, bays: 6, material: 'truss', member: 0.25 }, o); },
    torus(o) { return Object.assign({ kind: 'torus', axis: 'x', at: [0, 0, 0], seg: 24, tube: 10, material: 'hull' }, o); },
    // drive bell: throat at `at`, opening toward -x by default (dir). Registers the plume exit.
    nozzle(o) {
      const dir = o.dir ? V.norm(o.dir) : [-1, 0, 0];
      const L = o.length, rt = o.rThroat, re = o.rExit, n = 6;
      const outer = [[0, rt]], inner = [];
      for (let i = 1; i <= n; i++) { const f = i / n; const r = rt + (re - rt) * Math.pow(f, 0.62); outer.push([L * f, r]); }
      for (let i = 0; i <= n; i++) { const f = i / n; const r = rt + (re - rt) * Math.pow(f, 0.62); inner.push([L * f - (i === 0 ? 0 : 0.0), r * 0.94]); }
      inner.push([0, 0]);
      inner.reverse();
      const base = Object.assign({ hp: o.hp === undefined ? unitHp('drive') : o.hp }, o); delete base.dir; delete base.length; delete base.rThroat; delete base.rExit;
      const parts = [
        KIT.lathe(Object.assign({ material: 'nozzle', facing: 'tail' }, base, { at: o.at, axis: dir, profile: outer })),
        KIT.lathe(Object.assign({ material: 'nozzleIn', facing: 'tail' }, base, { at: o.at, axis: dir, profile: inner, inside: true })),
        { kind: 'drive', at: V.add(o.at, V.scale(dir, L)), dir, r: re },
      ];
      if (o.lip !== false) parts.push(KIT.torus(Object.assign({ material: 'nozzle', facing: 'tail' }, base, { at: V.add(o.at, V.scale(dir, L)), axis: dir, R: re, r: Math.max(0.15, re * 0.05), seg: 8, tube: 6 })));
      return parts;
    },
    // An anchor the live overlay draws from: a mount muzzle, a bay face, a tank, and the part a repair
    // party is working. It has no geometry of its own — it rides the same transforms as the part that
    // placed it, so a folded panel or a tilted turret carries its anchor with it, and comes out of the
    // sprite already projected. `axis` marks an anchor on the hull axis (the drive, the reactor, the
    // nose): the hull hides it from one end only. `flat` marks one on a plate, which shows either face.
    mark(o) {
      return {
        kind: 'mark', at: o.at, dir: o.dir || [1, 0, 0], up: o.up || null, side: o.side || null,
        role: o.role, index: o.index == null ? 0 : o.index, r: o.r || 0,
        barrel: o.barrel || 0, barrelR: o.barrelR || 0, cell: o.cell || 0, hp: o.hp == null ? 1 : o.hp,
        axis: o.axis || null, flat: !!o.flat, rot: o.rot, rot2: o.rot2, shift: o.shift,
      };
    },
    // radiator plate. at = root centre; span along `dir` (outward), chord along `along` (default x); thick.
    // deploy 0..1 with mode 'fold' (hinges flat against the hull at 0) or 'slide' (span grows). tubes = coolant lines
    radiator(o) {
      const dir = V.norm(o.dir || [0, 1, 0]);
      const along = V.norm(o.along || [1, 0, 0]);
      const deploy = o.deploy === undefined ? 1 : clamp(o.deploy, 0, 1);
      const full = o.mode === 'slide' ? o.span * (0.08 + 0.92 * deploy) : o.span;
      const hp = o.hp === undefined ? unitHp(o.role, o.index) : o.hp;
      // What a hit panel looks like — and it has to look hit from every side, because a plate is edge-on
      // from half the angles a fight is watched from and darker paint says nothing in three quarters. So
      // the metal itself goes: under half the panel is torn off past the buckle and half its coolant lines
      // are run dry, and a wrecked one is the root manifold and nothing else — no plate, no tubes, no heat
      // in it, which is what the damage module means by "the panel is gone".
      const left = hp <= 0 ? 0.28 : hp < 0.5 ? 0.62 : 1;
      const span = full * left;
      const lines = o.tubes === undefined ? 7 : o.tubes;
      const thick = (o.thick || Math.max(0.3, full * 0.02)) * (hp <= 0 ? 1.4 : 1);
      // …and what is left hangs off its hinge. A wing panel stands in the plane the camera looks along
      // from the side, where a shorter plate is still the same edge-on line; bent about its own root it
      // turns a face to that camera and the hit reads there too. The pair bend opposite ways, so a hull
      // that has lost both does not look folded up for stowage.
      const bend = (hp <= 0 ? 0.8 : hp < 0.5 ? 0.3 : 0) * ((o.index || 0) % 2 ? -1 : 1);
      // That bend turns the plate about the hull's own axis — the one direction a camera lying on that
      // axis cannot see. From the side a bent ventral panel is only a shorter panel, and a shorter panel
      // is exactly what a radiator part way out looks like: at 420 px the board says "damaged" and the
      // heat box says "extending" over two pictures the eye cannot tell apart. So a hit plate also leans
      // along the hull, off its own face. The hull axis lies across the picture in every view but the two
      // nose-on ones (where the bend has the screen to itself), so the lean reads at any size and from
      // any angle — and a plate that is short *and* leaning has been hit, because travel can do one or
      // the other and never both. Which way it leans is the family's: a plate that slides straight out
      // leans aft, a plate on a hinge leans forward, so the lean is never the pose the hinge itself puts
      // it in. Shape says what the panel is doing, colour says what has been done to it.
      const rake = (hp <= 0 ? 0.8 : hp < 0.5 ? 0.5 : 0) * (o.mode === 'slide' ? 1 : -1);
      const bent = bend ? V.rot(dir, along, bend) : dir;
      // sheared, not swung: the root edge stays on its hinge and the plate leans off it, which is what a
      // plate torn past the buckle does and what keeps the root manifold covered
      const out = rake ? V.rot(bent, V.cross(along, bent), rake) : bent;
      const normal = rake ? V.norm(V.cross(along, out)) : V.cross(along, out);
      const centre = V.add(o.at, V.scale(out, span / 2));
      const part = {
        kind: 'box', material: hp <= 0 ? 'hullDark' : 'radiator', edge: hp <= 0 ? 'trussDark' : 'radiatorEdge',
        at: centre, size: [o.chord, span, thick], frame: [along, out, normal],
        tubes: hp <= 0 ? 0 : hp < 0.5 ? Math.max(2, Math.round(lines * 0.5)) : lines,
        radiatorPanel: true, facing: o.facing, color: o.color, role: 'radiator', hide: o.hide,
        // which panel of the damage module's list this plate is, so the anchors pass can hang a repair
        // party's marker on it wherever the family has folded or slid it to
        panel: o.role ? (o.index == null ? 0 : o.index) : null,
        hp,
      };
      if (o.mode !== 'slide' && deploy < 1) {
        const foldAxis = o.foldAxis ? V.norm(o.foldAxis) : along;
        const ang = (o.foldAngle === undefined ? Math.PI / 2 : o.foldAngle) * (1 - deploy) * (o.foldSign || 1);
        part.rot = [foldAxis, ang, o.at];
      }
      if (o.rot) part.rot2 = o.rot;
      if (o.shift) part.shift = o.shift;
      return part;
    },
    // dome-and-barrel housing (a generic turret) at `at`, base normal `up`, barrel toward `aim`.
    // `role` ('beam' for a laser turret, 'pd' for a point-defence dome) and `index` (the mount's place in
    // the design's mount list) hand the mount to the damage dimming and to the live overlay.
    turret(o) {
      const up = V.norm(o.up || [0, 0, 1]);
      const r = o.r, aim = o.aim ? V.norm(o.aim) : [1, 0, 0];
      const hp = o.hp === undefined ? unitHp(o.role, o.index) : o.hp;
      const base = Object.assign({ material: 'mount', hp }, o);
      delete base.up; delete base.aim; delete base.r; delete base.role; delete base.index;
      const parts = [
        KIT.lathe(Object.assign({}, base, { at: o.at, axis: up, profile: [[0, r * 1.15], [r * 0.25, r * 1.15], [r * 0.25, r]], material: 'hullDark' })),
        KIT.sphere(Object.assign({}, base, { at: V.add(o.at, V.scale(up, r * 0.25)), r, axis: up, rings: 6, profile: undefined })),
      ];
      // a sphere helper with axis = up produces a full sphere; clip the lower half by using a hemisphere
      // profile — and take the dome down with the mount's own state. A dome is a curve, and a curve
      // shaded darker reads as a shadow from three quarters and from the side, so the shape has to answer
      // too: wrecked, the dome is opened up into a torn cup on its housing and the barrel is shot away
      // with it; damaged, it sits lower on its ring and has lost the end of its barrel.
      const dr = hp > 0 && hp < 0.5 ? r * 0.84 : r;
      const cup = hp <= 0
        ? [[0, r], [r * 0.14, r * 0.97], [r * 0.30, r * 0.76], [r * 0.30, r * 0.46], [r * 0.12, r * 0.30], [r * 0.08, 0]]
        : hp < 0.5
          ? [[0, dr], [dr * 0.30, dr * 0.92], [dr * 0.54, dr * 0.70], [dr * 0.71, dr * 0.38], [dr * 0.77, 0]]
          : [[0, r], [r * 0.38, r * 0.92], [r * 0.7, r * 0.7], [r * 0.92, r * 0.38], [r, 0]];
      parts[1] = KIT.lathe(Object.assign({}, base, { at: V.add(o.at, V.scale(up, r * (hp < 0.5 ? 0.08 : 0.25))), axis: up, profile: cup, material: hp <= 0 ? 'hullDark' : base.material }));
      const bl = hp <= 0 ? 0 : (o.barrel === undefined ? r * 1.6 : o.barrel) * (hp < 0.5 ? 0.55 : 1), br = o.barrelR || r * 0.22;
      const root = V.add(V.add(o.at, V.scale(up, r * 0.8)), V.scale(aim, r * 0.3));
      // In live mode the overlay draws a beam turret's barrel where the mount is actually pointing, so the
      // fixed one is left out here: one barrel, and it turns with the fight.
      const slewed = LIVE && o.role === 'beam';
      if (bl > 0 && !slewed) {
        parts.push(KIT.rod(Object.assign({}, base, { from: root, to: V.add(root, V.scale(aim, bl)), r: br, material: 'barrel', seg: 8 })));
      }
      if (o.role) parts.push(KIT.mark({ at: root, dir: aim, up, role: o.role, index: o.index, r, barrel: bl, barrelR: br, hp }));
      return parts;
    },
    // grid of launch cells on a face: at = centre of the face, normal = outward, cell = size, rows × cols
    cells(o) {
      const n = V.norm(o.normal), [u, v] = o.frame ? [V.norm(o.frame[0]), V.norm(o.frame[1])] : V.basis(n);
      const parts = [], cell = o.cell, gap = o.gap === undefined ? cell * 0.18 : o.gap, depth = o.depth || cell * 0.4;
      const W = o.cols * (cell + gap) - gap, H = o.rows * (cell + gap) - gap;
      const hp = o.hp === undefined ? unitHp(o.role, o.index) : o.hp;
      // A wrecked block has no doors left and nothing behind them: the frame sinks into the hull and the
      // cells are one hole, which reads from every angle the block itself reads from.
      const dead = hp <= 0, stove = hp > 0 && hp < 0.5;
      const sink = dead ? depth * 1.15 : stove ? depth * 0.85 : depth * 0.5;
      parts.push({ kind: 'box', material: o.material || 'bayDoor', at: V.sub(o.at, V.scale(n, sink)), size: [W + gap * 2, H + gap * 2, depth], frame: [u, v, n], facing: o.facing, color: o.color, hp });
      if (dead) parts.push({ kind: 'box', material: 'bayDark', at: V.sub(o.at, V.scale(n, depth * 0.5)), size: [W, H, depth * 0.4], frame: [u, v, n], facing: o.facing, noOutline: true, hp });
      else for (let i = 0; i < o.rows; i++) for (let j = 0; j < o.cols; j++) {
        // a stove-in block sits down in the hull and a third of its mouths have burst and closed up
        if (stove && (i + j) % 3 === 0) continue;
        const cu = -W / 2 + cell / 2 + j * (cell + gap), cv = -H / 2 + cell / 2 + i * (cell + gap);
        const c = V.add(V.add(o.at, V.scale(u, cu)), V.scale(v, cv));
        parts.push({ kind: 'box', material: 'bayDark', at: V.add(c, V.scale(n, 0.05 - (stove ? depth * 0.35 : 0))), size: [cell * 0.78, cell * 0.78, 0.1], frame: [u, v, n], facing: o.facing, noOutline: true, hp });
      }
      if (o.role) parts.push(KIT.mark({ at: o.at, dir: n, up: u, side: v, role: o.role, index: o.index, r: Math.max(W, H) / 2, cell, hp }));
      return parts;
    },
    // a small light (navigation lamp, docking beacon): emissive dot
    lamp(o) { return Object.assign({ kind: 'lamp', r: 0.4, color: '#ffffff' }, o); },
    // free polygon (points in ship frame, outward normal computed from winding; flip: true to reverse)
    poly(o) { return Object.assign({ kind: 'poly', material: 'hull' }, o); },
    group(...parts) { return parts; },
    V, MATERIALS, heatColor, hash01, clamp, lerp, mix,
    // what a component has left, for a family placing a part the damage module knows about
    hp: (role, index) => unitHp(role, index),
    live: () => LIVE,
  };

  // ---------------------------------------------------------------- views and cameras
  const VIEWS = {
    side: { az: -90, el: 0 },
    threequarter: { az: -55, el: 22 },
    dorsal34: { az: -120, el: 38 },
    top: { az: 0, el: 90 },
    bottom: { az: 0, el: -90 },
    front: { az: 0, el: 0 },
    rear: { az: 180, el: 0 },
  };
  function camera(view) {
    const v = typeof view === 'string' ? VIEWS[view] || VIEWS.threequarter : view || VIEWS.threequarter;
    const az = rad(v.az || 0), el = rad(v.el || 0);
    const D = [Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)];
    let R, U;
    if (Math.abs(D[2]) > 0.999) { R = [1, 0, 0]; U = V.cross(D, R); }
    else { R = V.norm(V.cross([0, 0, 1], D)); U = V.cross(D, R); }
    return { D, R, U };
  }
  function lightVec(light) {
    if (!light) light = { az: -50, el: 35 };
    if (light.x !== undefined) return V.norm([light.x, light.y, light.z]);
    const az = rad(light.az || 0), el = rad(light.el || 0);
    return [Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)];
  }

  // ---------------------------------------------------------------- tessellation
  function partTransform(part, p) {
    if (part.shift) p = V.add(p, part.shift);
    if (part.rot) p = V.rot(p, axisVec(part.rot[0]), part.rot[1], part.rot[2]);
    if (part.rot2) p = V.rot(p, axisVec(part.rot2[0]), part.rot2[1], part.rot2[2]);
    return p;
  }
  function lodSegments(size, quality) {
    if (quality === 'low') return 8;
    if (quality === 'high') return 32;
    return clamp(Math.round(size / 9), 8, 30);
  }

  // Emits polygons {pts, n, part, idx, centre, inside?} and lines {a, b, w, part} into out
  function tessellate(part, seg, out) {
    const T = (p) => partTransform(part, p);
    if (part.kind === 'lathe') {
      const axis = axisVec(part.axis), [u, v] = V.basis(axis), prof = part.profile;
      const s = part.seg || seg;
      const arc = part.arc || [0, TAU];
      const full = !part.arc || Math.abs(arc[1] - arc[0] - TAU) < 1e-6;
      const rings = prof.map(([t, r]) => {
        const c = V.add(part.at, V.scale(axis, t)), ring = [];
        for (let j = 0; j <= s; j++) {
          const a = arc[0] + ((arc[1] - arc[0]) * j) / s;
          ring.push(T(V.add(c, V.add(V.scale(u, r * Math.cos(a)), V.scale(v, r * Math.sin(a))))));
        }
        return ring;
      });
      const axisPt = (t) => T(V.add(part.at, V.scale(axis, t)));
      const axisT = V.norm(V.sub(axisPt(1), axisPt(0)));   // the axis after the part's own rotation
      let idx = 0;
      for (let i = 0; i < rings.length - 1; i++) {
        const r0 = prof[i][1], r1 = prof[i + 1][1];
        if (r0 === 0 && r1 === 0) continue;
        const du = prof[i + 1][0] - prof[i][0], dr = r1 - r0;
        const flat = Math.abs(du) < 1e-6 * Math.max(1, Math.abs(dr));   // an annulus or disc: faces along the axis
        for (let j = 0; j < s; j++) {
          const p0 = rings[i][j], p1 = rings[i + 1][j], p2 = rings[i + 1][j + 1], p3 = rings[i][j + 1];
          let n = V.cross(V.sub(p2, p0), V.sub(p3, p1));
          const nl = V.len(n); if (nl < 1e-9) continue;
          n = V.scale(n, 1 / nl);
          const centre = V.scale(V.add(V.add(p0, p1), V.add(p2, p3)), 0.25);
          if (flat || Math.abs(V.dot(n, axisT)) > 0.9995) {
            // a flat face has no radial outward: the solid lies on the small-radius side of the profile, so a
            // widening step faces back along the axis and a narrowing step faces forward
            n = V.scale(axisT, dr > 0 ? -1 : 1);
          } else {
            const mid = axisPt((prof[i][0] + prof[i + 1][0]) / 2);
            const outward = V.sub(centre, mid);
            if (V.dot(n, outward) < 0) n = V.scale(n, -1);
          }
          if (part.inside) n = V.scale(n, -1);
          out.polys.push({ pts: [p0, p1, p2, p3], n, part, idx: idx++, centre, ring: i, spoke: j });
        }
      }
      if (!full && part.closeArc !== false) {
        // side walls of a partial lathe
        for (const side of [0, s]) {
          const pts = rings.map((r) => r[side]);
          const centre = V.scale(pts.reduce((a, b) => V.add(a, b), [0, 0, 0]), 1 / pts.length);
          const n0 = V.norm(V.cross(V.sub(pts[1], pts[0]), V.sub(pts[pts.length - 1], pts[0])));
          const outward = V.sub(centre, axisPt(prof[Math.floor(prof.length / 2)][0]));
          let n = V.dot(n0, outward) < 0 ? V.scale(n0, -1) : n0;
          out.polys.push({ pts, n, part, idx: idx++, centre });
        }
      }
    } else if (part.kind === 'box') {
      const [sx, sy, sz] = part.size;
      const f = part.frame ? [V.norm(part.frame[0]), V.norm(part.frame[1]), V.norm(part.frame[2])] : [AXES.x, AXES.y, AXES.z];
      const c = part.at;
      const P = (a, b, d) => T(V.add(V.add(V.add(c, V.scale(f[0], (a * sx) / 2)), V.scale(f[1], (b * sy) / 2)), V.scale(f[2], (d * sz) / 2)));
      const faces = [
        [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1], 0],       // +u
        [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1], 1],   // -u
        [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1], 2],       // +v
        [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1], 3],   // -v
        [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1], 4],       // +w (main face for plates)
        [[-1, -1, -1], [-1, 1, -1], [1, 1, -1], [1, -1, -1], 5],   // -w
      ];
      const cT = T(c);
      faces.forEach((fc) => {
        const pts = fc.slice(0, 4).map(([a, b, d]) => P(a, b, d));
        let n = V.norm(V.cross(V.sub(pts[2], pts[0]), V.sub(pts[3], pts[1])));
        const centre = V.scale(V.add(V.add(pts[0], pts[1]), V.add(pts[2], pts[3])), 0.25);
        if (V.dot(n, V.sub(centre, cT)) < 0) n = V.scale(n, -1);
        const main = fc[4] >= 4;
        const thin = part.radiatorPanel && !main;
        out.polys.push({ pts, n, part, idx: fc[4], centre, face: fc[4], edgeFace: thin, tubes: part.tubes && main ? part.tubes : 0, tubeDir: main ? [P(-1, -1, 1), P(1, -1, 1), P(-1, 1, 1)] : null });
      });
    } else if (part.kind === 'truss') {
      const a = part.from, b = part.to, d = V.sub(b, a), L = V.len(d), axis = V.norm(d), [u, v] = V.basis(axis);
      const n = part.n, bays = part.bays, r = part.r;
      const ring = (t) => { const c = V.add(a, V.scale(axis, t)), pts = []; for (let k = 0; k < n; k++) { const ang = (k / n) * TAU + (part.phase || Math.PI / n); pts.push(T(V.add(c, V.add(V.scale(u, r * Math.cos(ang)), V.scale(v, r * Math.sin(ang)))))); } return pts; };
      const rings = []; for (let i = 0; i <= bays; i++) rings.push(ring((i / bays) * L));
      const w = part.member;
      for (let k = 0; k < n; k++) out.lines.push({ a: rings[0][k], b: rings[bays][k], w: w * 1.3, part });
      for (let i = 0; i <= bays; i++) for (let k = 0; k < n; k++) out.lines.push({ a: rings[i][k], b: rings[i][(k + 1) % n], w, part });
      for (let i = 0; i < bays; i++) for (let k = 0; k < n; k++) { const k2 = (k + 1) % n; const flip = (i + k) % 2; out.lines.push({ a: rings[i][flip ? k2 : k], b: rings[i + 1][flip ? k : k2], w: w * 0.8, part }); }
    } else if (part.kind === 'torus') {
      const axis = axisVec(part.axis), [u, v] = V.basis(axis), s = part.seg, t = part.tube, R = part.R, r = part.r;
      const P = (i, j) => { const a = (i / s) * TAU, b = (j / t) * TAU; const radial = V.add(V.scale(u, Math.cos(a)), V.scale(v, Math.sin(a))); return T(V.add(part.at, V.add(V.scale(radial, R + r * Math.cos(b)), V.scale(axis, r * Math.sin(b))))); };
      let idx = 0;
      for (let i = 0; i < s; i++) for (let j = 0; j < t; j++) {
        const p0 = P(i, j), p1 = P(i + 1, j), p2 = P(i + 1, j + 1), p3 = P(i, j + 1);
        let n = V.norm(V.cross(V.sub(p2, p0), V.sub(p3, p1)));
        const centre = V.scale(V.add(V.add(p0, p1), V.add(p2, p3)), 0.25);
        const a = ((i + 0.5) / s) * TAU; const tubeC = T(V.add(part.at, V.scale(V.add(V.scale(u, Math.cos(a)), V.scale(v, Math.sin(a))), R)));
        if (V.dot(n, V.sub(centre, tubeC)) < 0) n = V.scale(n, -1);
        out.polys.push({ pts: [p0, p1, p2, p3], n, part, idx: idx++, centre });
      }
    } else if (part.kind === 'poly') {
      const pts = part.pts.map(T);
      let n = V.norm(V.cross(V.sub(pts[1], pts[0]), V.sub(pts[2], pts[0])));
      if (part.flip) n = V.scale(n, -1);
      const centre = V.scale(pts.reduce((a, b) => V.add(a, b), [0, 0, 0]), 1 / pts.length);
      out.polys.push({ pts, n, part, idx: 0, centre, twoSided: part.twoSided });
    } else if (part.kind === 'lamp') {
      out.lamps.push({ p: T(part.at), r: part.r, color: part.color, part });
    } else if (part.kind === 'drive') {
      out.drives.push({ at: T(part.at), dir: part.rot ? V.rot(part.dir, axisVec(part.rot[0]), part.rot[1]) : part.dir, r: part.r });
    } else if (part.kind === 'mark') {
      // an anchor: the point, and the directions that came with it, through the part's own rotations
      const D = (d) => {
        if (!d) return null;
        let q = d;
        if (part.rot) q = V.rot(q, axisVec(part.rot[0]), part.rot[1]);
        if (part.rot2) q = V.rot(q, axisVec(part.rot2[0]), part.rot2[1]);
        return q;
      };
      out.marks.push({ role: part.role, index: part.index, at: T(part.at), dir: D(part.dir), up: D(part.up), side: D(part.side), axis: D(part.axis), flat: !!part.flat, r: part.r, barrel: part.barrel, barrelR: part.barrelR, cell: part.cell, hp: part.hp });
    }
  }

  // ---------------------------------------------------------------- hull families and design objects
  // A design object carries the numbers ships.js carries (length, propMass, thrust, exhaustVelocity, reactorPower,
  // radiatorArea, armour, mounts…) plus optional style picks; the hull family turns them into parts. Families are
  // registered from assets/ships/src/*.js and may override any stage.
  const FAMILIES = {};
  const DEFAULT_FAMILY = {
    radius: 0.055,
    cap: { len: 0.16, shape: 'ogive', tipR: 0.1, rings: true },
    module: { len: 0.2, kind: 'drum' },
    spine: { kind: 'truss', n: 4, r: 0.55 },
    tanks: { arrangement: 'cluster', count: 3, material: 'tank', density: 700, dome: 0.6 },
    radiators: { panels: 2, layout: 'wings', mode: 'slide', aspect: 2.6 },
    drive: { nozzles: 1 },
    sensors: { mast: true, dish: 0.5 },
    accents: { bands: true },
    stages: {},
  };
  function registerFamily(id, fam) {
    const f = Object.assign({}, DEFAULT_FAMILY, fam, { id });
    for (const k of ['cap', 'module', 'spine', 'tanks', 'radiators', 'drive', 'sensors', 'accents', 'stages']) f[k] = Object.assign({}, DEFAULT_FAMILY[k], fam[k] || {});
    FAMILIES[id] = f; cache.clear();
    return f;
  }

  function normDesign(d) {
    if (d && d._norm) return d;
    if (typeof d === 'string') d = { hull: d };
    d = d || {};
    const hull = d.hull || d.artBase || d.base || (FAMILIES[d.cls] && d.cls) || (FAMILIES[d.id] && d.id) || d.cls || d.id || 'corvette';
    const cls = (OD.Ships && OD.Ships.CLASSES && OD.Ships.CLASSES[hull]) || {};
    const fam = FAMILIES[hull] || FAMILIES.corvette || registerFamily('_default', {});
    const D = Object.assign({}, cls, d, { hull });
    D.length = D.length || fam.length || cls.length || 100;
    D.armour = Object.assign({ nose: 10, flank: 5, tail: 3 }, cls.armour || {}, (d.armour) || {});
    D.mounts = d.mounts || cls.mounts || [];
    D.tanks = Object.assign({}, fam.tanks, d.tanks || {});
    D.radiators = Object.assign({}, fam.radiators, d.radiators || {});
    D.drive = Object.assign({}, fam.drive, d.drive || {});
    D.faction = d.faction || cls.faction;
    Object.defineProperty(D, '_fam', { value: fam, enumerable: false });
    Object.defineProperty(D, '_norm', { value: true, enumerable: false });
    return D;
  }
  function designKey(d) {
    if (typeof d === 'string') return d;
    // a configurator design carries an id and a revision counter: key on those (cheap) when the id is not a stock hull
    if (d && d.id && d.rev !== undefined && !FAMILIES[d.id]) return d.id + '@' + d.rev;
    const D = normDesign(d);
    const m = (D.mounts || []).map((x) => x.kind + (x.arc || '') + (x.aperture || x.muzzleVelocity || x.count || '')).sort().join(',');
    const s = [D.hull, D.length, D.propMass, D.dryMass, D.thrust, D.exhaustVelocity, D.reactorPower, D.radiatorArea, D.radiatorTemp, D.armour.nose, D.armour.flank, D.armour.tail, m, JSON.stringify(D.tanks), JSON.stringify(D.radiators), JSON.stringify(D.drive), D.style ? JSON.stringify(D.style) : ''].join('|');
    let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return D.hull + '#' + (h >>> 0).toString(36);
  }
  function preset(id) { const D = normDesign(id); return JSON.parse(JSON.stringify(D)); }

  // ---- layout: where everything goes, from the numbers ----
  function layoutFor(D) {
    const F = D._fam, L = D.length, A = D.armour;
    const R = D.beam > 0 ? clamp(D.beam / 2, L * 0.03, L * 0.12) : L * F.radius;   // beam (hull width) when a design gives one
    const noseF = clamp(0.5 + A.nose / 60, 0.5, 1.5);
    let capLen = L * F.cap.len * (0.6 + 0.5 * noseF);
    let modLen = L * F.module.len;
    const nozzles = Math.max(1, Math.round(D.drive.nozzles || 1));
    const thrust = D.thrust || 0;
    const rExitRaw = thrust > 0 ? 0.9 * Math.sqrt(thrust / nozzles / 1e6) : 0;
    let rExit = thrust > 0 ? clamp(rExitRaw, 0.4 * R, 1.3 * R) : 0;
    if (nozzles === 2) rExit = Math.min(rExit, R * 0.72);
    if (nozzles >= 3) rExit = Math.min(rExit, R * 0.6);
    const ve = D.exhaustVelocity || 50e3;
    const driveKind = D.drive.kind || (ve < 6e3 ? 'chemical' : ve < 15e3 ? 'thermal' : 'torch');
    // a bell that hit the width clamp grows in length instead, so more thrust still shows on a small hull
    const overflow = rExit > 0 ? clamp(0.35 * Math.log2(Math.max(1, rExitRaw / rExit)), 0, 0.6) : 0;
    const bellLen = rExit * (driveKind === 'chemical' ? 1.8 : driveKind === 'thermal' ? 2.2 : 2.6) * (1 + overflow);
    const reactorR = D.reactorPower > 0 ? clamp(2.2 * Math.cbrt(D.reactorPower / 1e6), 0.55 * R, 1.15 * R) : 0.6 * R;
    const reactorLen = reactorR * 1.5;
    const shieldT = R * 0.14, shieldR = reactorR * 1.28;
    const tailLen = (thrust > 0 ? bellLen : 0) + reactorLen + shieldT;
    let spineLen = L - capLen - modLen - tailLen;
    const minSpine = L * 0.28;
    if (spineLen < minSpine) { const k = Math.max(0.2, (L - tailLen - minSpine) / (capLen + modLen)); capLen *= k; modLen *= k; spineLen = L - capLen - modLen - tailLen; }
    const xNose = L / 2, xCap = xNose - capLen, xMod = xCap - modLen, xSpine = xMod - spineLen;
    const xShield = xSpine, xReactor = xShield - shieldT, xThroat = xReactor - reactorLen, xExit = xThroat - bellLen;
    const spineR = R * F.spine.r;
    // tanks in the front two thirds of the spine, radiators in the rear third
    const T = D.tanks, Vp = (D.propMass || 0) / (T.density || 700);
    const tankZone = { from: xSpine + spineLen * 0.34, to: xMod - spineLen * 0.03 };
    const tanks = [];
    let n = Math.max(0, Math.round(T.count || 3));
    if (Vp > 0 && n > 0) {
      const zoneLen = tankZone.to - tankZone.from;
      if (T.arrangement === 'inline') {
        const each = zoneLen / n, len = each * 0.92;
        const r = clamp(Math.sqrt(Vp / (n * Math.PI * len * 0.8)), 0.7 * R, 1.9 * R);
        for (let i = 0; i < n; i++) tanks.push({ from: tankZone.from + i * each + each * 0.04, to: tankZone.from + i * each + each * 0.96, r, at: [0, 0, 0] });
      } else if (T.arrangement === 'saddle') {
        const len = zoneLen * 0.95, r = clamp(Math.sqrt(Vp / (2 * Math.PI * len * 0.8)), 0.6 * R, 1.5 * R);
        for (const s of [1, -1]) tanks.push({ from: tankZone.from, to: tankZone.to, r, at: [0, s * (spineR * 0.6 + r), 0] });
      } else {
        if (T.arrangement === 'ring') n = Math.max(n, 5);
        const len = zoneLen * 0.95;
        let r = Math.sqrt(Vp / (n * Math.PI * len * 0.8));
        while (r > 1.2 * R && n < 5) { n++; r = Math.sqrt(Vp / (n * Math.PI * len * 0.8)); }
        r = clamp(r, 0.4 * R, 1.2 * R);
        const dist = n === 1 ? 0 : spineR + r * (n <= 3 ? 0.95 : n <= 4 ? 1.05 : 1.25);
        for (let i = 0; i < n; i++) {
          const a = (n === 2 ? 0 : n === 4 ? Math.PI / 4 : Math.PI / 2) + (i / n) * TAU;
          tanks.push({ from: tankZone.from, to: tankZone.to, r, at: [0, Math.cos(a) * dist, Math.sin(a) * dist] });
        }
      }
    }
    // radiators
    const Rd = D.radiators, area = D.radiatorArea || 0;
    const radZone = { from: xSpine + spineLen * 0.04, to: xSpine + spineLen * 0.31 };
    const rads = [];
    if (area > 0) {
      let dirs;
      const layout = Rd.layout || 'wings';
      const panels = Math.max(1, Math.round(Rd.panels || 2));
      if (layout === 'cross') dirs = [[0, 1, 0], [0, 0, 1], [0, -1, 0], [0, 0, -1]];
      else if (layout === 'fan') { dirs = []; for (let i = 0; i < panels; i++) { const a = (i / panels) * TAU; dirs.push([0, Math.cos(a), Math.sin(a)]); } }
      else dirs = [[0, 1, 0], [0, -1, 0]];
      const sets = Math.max(1, Math.ceil(panels / dirs.length));
      const total = sets * dirs.length;
      const perFace = area / (2 * total);
      const aspect = Rd.aspect || 2.6;
      const zoneLen = radZone.to - radZone.from;
      let chord = Math.sqrt(perFace / aspect), span = perFace / chord;
      const maxChord = (zoneLen / sets) * 0.9;
      if (chord > maxChord) { chord = maxChord; span = perFace / chord; }
      if (span > L * 0.85) { span = L * 0.85; chord = Math.min(perFace / span, maxChord); }
      const root = spineR + R * 0.12;
      for (let s = 0; s < sets; s++) {
        const xc = radZone.from + (zoneLen / sets) * (s + 0.5);
        dirs.forEach((dir, i) => rads.push({ at: [xc, dir[1] * root, dir[2] * root], dir, span, chord, mode: Rd.mode || 'slide', set: s, index: i }));
      }
    }
    // mounts, grouped
    const M = D.mounts || [];
    const spinal = M.filter((m) => m.kind === 'beam' && m.arc === 'nose');
    const turrets = M.filter((m) => m.kind === 'beam' && m.arc !== 'nose');
    const coils = M.filter((m) => m.kind === 'coilgun');
    const bays = M.filter((m) => m.kind === 'launcher');
    const pds = M.filter((m) => m.kind === 'pd');
    // where each of those sits in the ship's own mount list, so a part can name the mount it is
    const place = (list) => list.map((m) => M.indexOf(m));
    const spinalIdx = place(spinal), turretIdx = place(turrets), coilIdx = place(coils), bayIdx = place(bays), pdIdx = place(pds);
    const spinalR = spinal.length ? clamp((spinal[0].aperture || 1) * 0.55, R * 0.08, R * 0.4) : 0;
    const tipR = Math.max(R * F.cap.tipR, spinalR * 1.25);
    return { D, F, L, R, A, noseF, capLen, modLen, spineLen, tailLen, xNose, xCap, xMod, xSpine, xShield, xReactor, xThroat, xExit, rExit, nozzles, bellLen, driveKind, reactorR, reactorLen, shieldR, shieldT, spineR, tanks, tankZone, rads, radZone, spinal, turrets, coils, bays, pds, spinalIdx, turretIdx, coilIdx, bayIdx, pdIdx, spinalR, tipR };
  }

  // angles around the hull (y = cos a, z = sin a) for k evenly placed fittings, dorsal first
  function ringAngles(k, start) {
    const out = [];
    const a0 = start !== undefined ? start : k === 2 ? Math.PI / 2 : k === 4 ? Math.PI / 2 : Math.PI / 2;
    for (let i = 0; i < k; i++) out.push(a0 + (i / k) * TAU);
    return out;
  }
  const onRing = (x, r, a) => [x, Math.cos(a) * r, Math.sin(a) * r];
  const radial = (a) => [0, Math.cos(a), Math.sin(a)];

  // ---- default stages (each returns parts; families override by name in fam.stages) ----
  const STAGES = {
    cap(K, c, lay) {
      const { R, xCap, xNose, capLen, A, F, tipR } = lay, parts = [];
      const shape = F.cap.shape, n = 7, prof = [];
      const thick = A.nose >= 25;
      for (let i = 0; i <= n; i++) {
        const f = i / n; let r;
        if (shape === 'cone') r = tipR + (R - tipR) * (1 - f);
        else if (shape === 'blunt') r = tipR + (R - tipR) * (1 - Math.pow(f, 2.6));
        else if (shape === 'wedge') r = tipR + (R - tipR) * (1 - Math.pow(f, 1.4));
        else r = tipR + (R - tipR) * Math.pow(1 - f * f, 0.62);
        prof.push([capLen * f, r]);
      }
      prof.push([capLen, 0]);
      prof.unshift([0, 0]);
      parts.push(K.lathe({ at: [xCap, 0, 0], profile: prof, material: thick ? 'armour' : 'hullDark', facing: 'nose' }));
      if (F.cap.rings) {
        const rings = Math.round(1 + A.nose / 15);
        for (let i = 1; i <= rings; i++) { const f = i / (rings + 1); const p = prof[Math.round(f * n) + 1]; parts.push(K.torus({ at: [xCap + p[0], 0, 0], axis: 'x', R: p[1], r: Math.max(0.12, R * (thick ? 0.03 : 0.02)), seg: c.seg, tube: 6, material: 'armourEdge', facing: 'nose' })); }
      }
      // collar at the cap base carries the faction colour
      if (F.accents.bands) parts.push(K.cyl({ from: xCap - R * 0.02, to: xCap + R * 0.16, r: R * 1.03, material: 'accent', caps: 'none', facing: 'nose' }));
      // sensor blisters on the cap base
      for (const a of [0, Math.PI]) { const p = onRing(xCap + capLen * 0.16, prof[2][1] * 0.98, a); parts.push(K.lathe({ at: p, axis: radial(a), profile: [[0, R * 0.12], [R * 0.06, R * 0.1], [R * 0.1, 0]], material: 'sensor', facing: 'nose', seg: 10 })); }
      parts.push(K.lamp({ at: [xNose + R * 0.05, 0, 0], color: '#ffffff', r: R * 0.06 }));
      return parts;
    },
    spinal(K, c, lay) {
      const { R, xMod, xNose, spinalR, spinal } = lay, parts = [];
      if (!spinal.length) return parts;
      const r = spinalR;
      parts.push(K.cyl({ from: xMod + lay.modLen * 0.2, to: xNose + R * 0.12, r, material: 'barrel', facing: 'nose', caps: 'end' }));
      parts.push(K.torus({ at: [xNose + R * 0.1, 0, 0], axis: 'x', R: r * 1.05, r: r * 0.22, seg: c.seg, tube: 6, material: 'accent', facing: 'nose' }));
      parts.push(K.lathe({ at: [xNose + R * 0.12, 0, 0], axis: 'x', profile: [[0, r * 0.9], [0.01, r * 0.9], [0.01, 0]], material: 'sensor', facing: 'nose', inside: false }));
      parts.push(K.mark({ at: [xNose + R * 0.14, 0, 0], dir: [1, 0, 0], role: 'spinal', index: lay.spinalIdx[0], r, hp: unitHp('beam', lay.spinalIdx[0]) }));
      return parts;
    },
    module(K, c, lay) {
      const { R, xMod, modLen, A, F } = lay, parts = [];
      const armoured = A.flank >= 15;
      const mat = F.module.material || (armoured ? 'armour' : 'hull');
      if (F.module.kind === 'box') parts.push(K.box({ at: [xMod + modLen / 2, 0, 0], size: [modLen, R * 1.7, R * 1.5], material: mat }));
      else if (F.module.kind === 'twin') { for (const s of [1, -1]) parts.push(K.tank({ from: xMod, to: xMod + modLen, r: R * 0.62, at: [0, s * R * 0.5, 0], material: mat, dome: 0.25 })); parts.push(K.box({ at: [xMod + modLen / 2, 0, 0], size: [modLen * 0.8, R * 1.0, R * 0.7], material: 'hullDark' })); }
      else parts.push(K.tank({ from: xMod, to: xMod + modLen, r: R, material: mat, dome: F.module.kind === 'cylinder' ? 0.12 : 0.28 }));
      // longitudinal armour strips on a well-armoured flank
      if (A.flank >= 8) {
        const k = clamp(Math.round(A.flank / 6), 2, 8);
        for (const a of ringAngles(k, Math.PI / 4)) { const p = onRing(xMod + modLen * 0.5, R * 0.99, a); parts.push(K.box({ at: p, size: [modLen * 0.62, R * 0.16, R * 0.06], frame: [[1, 0, 0], V.cross(radial(a), [1, 0, 0]), radial(a)], material: 'armourEdge' })); }
      }
      if (F.accents.bands) parts.push(K.cyl({ from: xMod + modLen * 0.05, to: xMod + modLen * 0.13, r: R * 1.02, material: 'accentDim', caps: 'none' }));
      // navigation lamps
      parts.push(K.lamp({ at: [xMod + modLen * 0.55, R * 1.02, 0], color: '#ff5a4a', r: R * 0.05 }));
      parts.push(K.lamp({ at: [xMod + modLen * 0.55, -R * 1.02, 0], color: '#5aff7a', r: R * 0.05 }));
      return parts;
    },
    mounts(K, c, lay) {
      const { R, xMod, modLen, xCap, capLen, xNose, L, turrets, coils, bays, pds, xShield, shieldR, F } = lay, parts = [];
      // dome turrets on the module
      const ta = ringAngles(turrets.length, turrets.length === 4 ? Math.PI / 2 : Math.PI / 2);
      turrets.forEach((m, i) => {
        const a = ta[i], ap = m.aperture || 1;
        const r = clamp(ap * 1.1, R * 0.18, R * 0.5);
        const x = xMod + modLen * (turrets.length > 2 && i % 2 ? 0.35 : 0.65);
        parts.push(K.turret({ at: onRing(x, R * (F.module.kind === 'box' ? 0.8 : 0.98), a), r, up: radial(a), aim: [1, 0, 0], barrel: ap * 0.9, barrelR: ap * 0.5, role: 'beam', index: lay.turretIdx[i] }));
      });
      // rail pairs along the hull for slug throwers
      const ca = coils.length === 1 ? [-Math.PI / 2] : coils.length === 2 ? [0, Math.PI] : ringAngles(coils.length, -Math.PI / 2);
      coils.forEach((m, i) => {
        const a = ca[i], mv = m.muzzleVelocity || 4000;
        const len = clamp(L * 0.42 * Math.pow(mv / 4000, 0.7), L * 0.22, L * 0.55);
        const railR = clamp(R * 0.07, 0.25, 2.2), gap = railR * 2.6;
        const x0 = xMod + modLen * 0.1, x1 = Math.min(x0 + len, xNose - capLen * 0.25);
        const base = onRing(0, R * 1.02 + railR * 1.6, a);
        const side = V.cross([1, 0, 0], radial(a));
        for (const s of [1, -1]) parts.push(K.rod({ from: V.add([x0, base[1], base[2]], V.scale(side, s * gap / 2)), to: V.add([x1, base[1], base[2]], V.scale(side, s * gap / 2)), r: railR, material: 'barrel', seg: 8, hp: unitHp('coil', lay.coilIdx[i]) }));
        parts.push(K.box({ at: [x0 + len * 0.12, base[1], base[2]], size: [len * 0.24, gap + railR * 3, railR * 3], frame: [[1, 0, 0], side, radial(a)], material: 'mount' }));
        parts.push(K.box({ at: [x1 - railR * 2, base[1], base[2]], size: [railR * 3, gap + railR * 2.6, railR * 2.6], frame: [[1, 0, 0], side, radial(a)], material: 'mount', hp: unitHp('coil', lay.coilIdx[i]) }));
        parts.push(K.mark({ at: [x1 + railR, base[1], base[2]], dir: [1, 0, 0], up: radial(a), role: 'coil', index: lay.coilIdx[i], r: railR, hp: unitHp('coil', lay.coilIdx[i]) }));
        const struts = Math.max(2, Math.round(len / (R * 1.4)));
        for (let k = 1; k < struts; k++) { const x = x0 + (len * k) / struts; if (x > xCap + capLen * 0.5) break; const inner = onRing(x, R * 0.9, a); parts.push(K.rod({ from: inner, to: [x, base[1], base[2]], r: railR * 0.5, material: 'trussDark', seg: 5 })); }
      });
      // launch cells on the flanks
      if (bays.length) {
        const total = bays.reduce((s, b) => s + (b.count || 6), 0);
        const blocks = Math.min(bays.length, 2);
        const per = Math.ceil(total / blocks);
        const cell = clamp(R * 0.14, 0.5, 2.4);
        const cols = Math.ceil(Math.sqrt(per * 1.5)), rows = Math.ceil(per / cols);
        const angs = blocks === 1 ? [turrets.length >= 4 ? Math.PI / 4 : 0] : [0, Math.PI];
        angs.forEach((a, bi) => {
          const p = onRing(xMod + modLen * 0.45, R * 0.96, a);
          parts.push(K.cells({ at: p, normal: radial(a), frame: [[1, 0, 0], V.cross(radial(a), [1, 0, 0])], rows, cols, cell, depth: cell * 0.6, role: 'bay', index: lay.bayIdx[Math.min(bi, lay.bayIdx.length - 1)] }));
        });
      }
      // small domes for point defence
      const spots = [[xMod + modLen * 0.12, R, Math.PI / 4], [xMod + modLen * 0.12, R, -Math.PI * 0.75], [xCap + capLen * 0.06, R * 0.93, Math.PI * 0.75], [xCap + capLen * 0.06, R * 0.93, -Math.PI / 4], [xShield + lay.shieldT * 0.5, shieldR * 0.86, Math.PI / 2], [xShield + lay.shieldT * 0.5, shieldR * 0.86, -Math.PI / 2], [xMod + modLen * 0.85, R, Math.PI / 2], [xMod + modLen * 0.85, R, -Math.PI / 2]];
      pds.forEach((m, i) => { const s = spots[i % spots.length]; const r = clamp(R * 0.11, 0.3, 1.6); parts.push(K.turret({ at: onRing(s[0], s[1], s[2]), r, up: radial(s[2]), aim: [1, 0, 0], barrel: r * 0.6, barrelR: r * 0.25, role: 'pd', index: lay.pdIdx[i] })); });
      return parts;
    },
    spine(K, c, lay) {
      const { xSpine, xMod, spineR, F, R, spineLen } = lay, parts = [];
      if (F.spine.kind === 'tube') parts.push(K.cyl({ from: xSpine, to: xMod, r: spineR, material: 'hullDark', caps: 'none' }));
      else if (F.spine.kind === 'keel') parts.push(K.box({ at: [(xSpine + xMod) / 2, 0, 0], size: [spineLen, spineR * 0.8, spineR * 1.6], material: 'hullDark' }));
      else parts.push(K.truss({ from: [xSpine, 0, 0], to: [xMod, 0, 0], r: spineR, n: F.spine.n, bays: Math.max(3, Math.round(spineLen / (R * 1.1))), member: clamp(R * 0.05, 0.12, 1.2) }));
      // a service line along the spine
      parts.push(K.rod({ from: [xSpine, 0, -spineR * 0.35], to: [xMod, 0, -spineR * 0.35], r: clamp(R * 0.04, 0.1, 0.8), material: 'trussDark', seg: 5 }));
      return parts;
    },
    tanks(K, c, lay) {
      const { tanks, D, R, spineR, F } = lay, parts = [];
      tanks.forEach((t, i) => {
        parts.push(K.tank({ from: t.from, to: t.to, r: t.r, at: t.at, material: D.tanks.material || 'tank', dome: D.tanks.dome === undefined ? 0.6 : D.tanks.dome, facing: 'flank', role: 'tank', index: i }));
        // a band and the cradle straps that hold the tank to the spine
        if (F.accents.bands) parts.push(K.torus({ at: [t.to - (t.to - t.from) * 0.22, t.at[1], t.at[2]], axis: 'x', R: t.r * 1.01, r: Math.max(0.1, t.r * 0.035), seg: c.seg, tube: 5, material: 'accent', facing: 'flank' }));
        const d = Math.hypot(t.at[1], t.at[2]);
        if (d > 0) for (const f of [0.25, 0.75]) { const x = t.from + (t.to - t.from) * f; parts.push(K.rod({ from: [x, 0, 0], to: [x, t.at[1], t.at[2]], r: clamp(R * 0.05, 0.12, 1), material: 'trussDark', seg: 5 })); parts.push(K.torus({ at: [x, t.at[1], t.at[2]], axis: 'x', R: t.r * 1.005, r: Math.max(0.08, t.r * 0.03), seg: c.seg, tube: 4, material: 'trussDark', facing: 'flank' })); }
      });
      return parts;
    },
    radiators(K, c, lay) {
      const { rads, R } = lay, parts = [], s = c.state;
      rads.forEach((r, i) => {
        parts.push(K.radiator({ at: r.at, span: r.span, chord: r.chord, dir: r.dir, along: [1, 0, 0], deploy: s.radiators, mode: r.mode, foldAxis: V.cross([1, 0, 0], r.dir), foldSign: 1, tubes: clamp(Math.round(r.chord / (R * 0.35)), 3, 12), thick: Math.max(0.25, R * 0.035), role: 'rad', index: i }));
        // root manifold on the spine
        const rootR = Math.hypot(r.at[1], r.at[2]);
        parts.push(K.box({ at: [r.at[0], r.dir[1] * (rootR - R * 0.08), r.dir[2] * (rootR - R * 0.08)], size: [r.chord * 1.04, R * 0.22, R * 0.28], frame: [[1, 0, 0], V.cross([1, 0, 0], r.dir), r.dir], material: 'hullDark' }));
      });
      return parts;
    },
    tail(K, c, lay) {
      const { xShield, xReactor, xThroat, xExit, shieldR, shieldT, reactorR, reactorLen, rExit, nozzles, bellLen, driveKind, R, A, D } = lay, parts = [];
      // shadow shield: a thick disc between the crew and the reactor
      parts.push(K.cyl({ from: xReactor, to: xShield, r: shieldR, material: 'shield', facing: 'tail' }));
      parts.push(K.torus({ at: [xShield - shieldT / 2, 0, 0], axis: 'x', R: shieldR, r: shieldT * 0.5, seg: c.seg, tube: 6, material: 'armourEdge', facing: 'tail' }));
      // Reactor drum with cooling ribs. The drum carries the reactor's own state: the board names the
      // reactor among the parts a party can be sent to, so a hit one has to answer on the hull — dead
      // metal, narrower where it burst, and the ribs gone with the coolant they carried.
      const rhp = unitHp('reactor');
      parts.push(K.cyl({ from: xThroat, to: xReactor, r: reactorR * (rhp <= 0 ? 0.87 : 1), material: 'reactor', facing: 'tail', hp: rhp }));
      const ribs = rhp <= 0 ? 0 : rhp < 0.5 ? 2 : 4;
      for (let i = 1; i <= ribs; i++) parts.push(K.torus({ at: [xThroat + (reactorLen * i) / (ribs + 1), 0, 0], axis: 'x', R: reactorR * 1.03, r: Math.max(0.1, reactorR * 0.03), seg: c.seg, tube: 4, material: 'trussDark', facing: 'tail', hp: rhp }));
      // tail skirt when the tail facing carries armour
      if (A.tail >= 6) parts.push(K.lathe({ at: [xReactor, 0, 0], profile: [[0, shieldR], [-reactorLen * 0.5, reactorR * 1.12], [-reactorLen * 0.5, reactorR * 1.02]], material: 'armour', facing: 'tail' }));
      // drive bells
      if ((D.thrust || 0) > 0 && rExit > 0) {
        const ring = nozzles === 1 ? [[0, 0]] : ringAngles(nozzles, nozzles === 2 ? 0 : Math.PI / 2).map((a) => [Math.cos(a), Math.sin(a)]);
        const off = nozzles === 1 ? 0 : nozzles === 2 ? rExit * 1.05 : rExit * 1.22;
        ring.forEach(([cy, cz]) => {
          const at = [xThroat, cy * off, cz * off];
          parts.push(K.nozzle({ at, length: bellLen, rThroat: rExit * (driveKind === 'torch' ? 0.28 : 0.4), rExit, dir: [-1, 0, 0] }));
          // torch drives carry magnetic coils around the bell
          if (driveKind === 'torch') for (const f of [0.35, 0.62, 0.85]) parts.push(K.torus({ at: [xThroat - bellLen * f, at[1], at[2]], axis: 'x', R: (rExit * 0.4 + (rExit - rExit * 0.4) * Math.pow(f, 0.62)) * 1.06, r: Math.max(0.12, rExit * 0.06), seg: c.seg, tube: 6, material: 'mount', facing: 'tail' }));
          parts.push(K.cyl({ from: xThroat - rExit * 0.15, to: xThroat + rExit * 0.1, r: rExit * (driveKind === 'torch' ? 0.34 : 0.45), material: 'nozzle', facing: 'tail' }));
        });
      }
      parts.push(K.lamp({ at: [xShield - shieldT / 2, 0, shieldR * 1.02], color: '#ffffff', r: R * 0.05 }));
      return parts;
    },
    sensors(K, c, lay) {
      const { R, xMod, modLen, F, xCap } = lay, parts = [];
      if (!F.sensors.mast) return parts;
      const mastH = clamp(R * 0.9, 1.5, 14), x = xMod + modLen * 0.82;
      parts.push(K.rod({ from: [x, 0, R * 0.9], to: [x, 0, R + mastH], r: clamp(R * 0.045, 0.12, 0.6), material: 'truss', seg: 6 }));
      const dr = clamp(R * (F.sensors.dish || 0.5), 0.8, 9);
      parts.push(K.dish({ at: [x + dr * 0.1, 0, R + mastH], r: dr, depth: dr * 0.3, axis: [0.8, 0, 0.6] }));
      parts.push(K.rod({ from: [x, 0, R + mastH], to: [x + dr * 0.45, 0, R + mastH + dr * 0.35], r: clamp(R * 0.03, 0.08, 0.4), material: 'trussDark', seg: 5 }));
      parts.push(K.box({ at: [x - R * 0.35, 0, R + mastH * 0.55], size: [R * 0.3, R * 0.5, R * 0.14], material: 'sensor' }));
      parts.push(K.box({ at: [x - R * 0.35, 0, R + mastH * 0.75], size: [R * 0.24, R * 0.4, R * 0.1], material: 'dish' }));
      return parts;
    },
  };
  const STAGE_ORDER = ['cap', 'spinal', 'module', 'mounts', 'spine', 'tanks', 'radiators', 'tail', 'sensors', 'extras'];

  // ---- damage-control anchors ----
  // A repair party is drawn on the part it is working, so every component the crew module can send one to
  // needs a point on the hull. The mounts, the launch cells and the tanks carry one already — the same
  // anchor a muzzle flash leaves from — and the rest are added here, off the parts the family has just
  // drawn: one on each radiator plate (which rides that plate's own fold or slide, so a stowed panel keeps
  // its marker on the metal), one on the drive at the bells, one on the reactor drum and one in the nose
  // for the sensor suite. A family that places its own (the station's reactor stands at the far end of a
  // truss, not on the hull axis) keeps it: an anchor already there is never doubled. Anchors are not
  // geometry — they are never counted into the picture's bounds and are free to carry.
  function coreAnchors(parts, lay) {
    const flat = flatten(parts, []), out = [], bells = [];
    let hasDrive = false, hasReactor = false, hasSensors = false;
    for (let i = 0; i < flat.length; i++) {
      const p = flat[i];
      if (p.kind === 'mark') {
        if (p.role === 'drive') hasDrive = true;
        else if (p.role === 'reactor') hasReactor = true;
        else if (p.role === 'sensors') hasSensors = true;
        continue;
      }
      if (p.kind === 'drive') { bells.push(p); continue; }
      if (p.radiatorPanel && p.panel != null) {
        // out on the plate, a little past its middle: the inboard half of a panel is behind the tanks and
        // the truss from most angles, and the marker has to be read against the metal it is on. It comes
        // in with a stowed panel, because it rides that plate's own fold or slide.
        const dir = p.frame ? p.frame[1] : [0, 1, 0], n = p.frame ? p.frame[2] : [0, 0, 1];
        const span = p.size ? p.size[1] : 0, chord = p.size ? p.size[0] : 1;
        out.push(KIT.mark({ at: V.add(p.at, V.scale(dir, span * 0.14)), dir, up: n, flat: true,
          role: 'rad', index: p.panel, r: Math.max(0.3, chord * 0.5), hp: p.hp, rot: p.rot, rot2: p.rot2, shift: p.shift }));
      }
    }
    if (!hasDrive && bells.length) {
      // one marker for the drive however many bells it has: the middle of the cluster, a bell radius
      // forward of the mouths, so it sits on the metal and not in the exhaust
      let c = [0, 0, 0], d = [0, 0, 0], r = 0;
      for (let i = 0; i < bells.length; i++) { c = V.add(c, bells[i].at); d = V.add(d, bells[i].dir); r = Math.max(r, bells[i].r || 0); }
      c = V.scale(c, 1 / bells.length);
      d = V.len(d) > 1e-6 ? V.norm(d) : [-1, 0, 0];
      out.push(KIT.mark({ at: V.sub(c, V.scale(d, r * 0.9)), dir: d, axis: d, role: 'drive', index: 0, r,
        hp: unitHp('drive'), rot: bells[0].rot, rot2: bells[0].rot2, shift: bells[0].shift }));
    }
    if (!hasReactor && lay) {
      out.push(KIT.mark({ at: [(lay.xThroat + lay.xReactor) / 2, 0, 0], dir: [-1, 0, 0], axis: [-1, 0, 0],
        role: 'reactor', index: 0, r: lay.reactorR || 0, hp: unitHp('reactor') }));
    }
    if (!hasSensors && lay) {
      out.push(KIT.mark({ at: [lay.xCap + lay.capLen * 0.55, 0, 0], dir: [1, 0, 0], axis: [1, 0, 0],
        role: 'sensors', index: 0, r: lay.R || 0, hp: unitHp('sensors') }));
    }
    return out;
  }

  function buildDesign(D, ctx) {
    const lay = layoutFor(D);
    ctx.layout = lay;
    if (BUILD) { BUILD.radCount = lay.rads.length; BUILD.tankCount = lay.tanks.length; BUILD.lay = lay; }
    const parts = [];
    for (const name of STAGE_ORDER) {
      const custom = D._fam.stages[name];
      if (custom === null) continue;
      const fn = custom || STAGES[name];
      if (fn) parts.push(fn(KIT, ctx, lay));
    }
    parts.push(coreAnchors(parts, lay));
    return parts;
  }

  // Which parts the hull view labels, and where each label points. The sentence under a label is the
  // hull family's own: every family's callouts() runs its own part text over this list, keyed on these
  // labels, so nothing here carries text. A family that offers no callouts() gets the labels and the
  // places, and the views that print a part (ui.js, bridge.js) print the label on its own.
  function defaultCallouts(lay) {
    const { R, xCap, capLen, xMod, modLen, xSpine, spineLen, tanks, rads, xShield, xThroat, reactorLen, xExit, rExit, turrets, coils, bays, pds, spinal } = lay;
    const out = [];
    out.push({ label: 'Armour cap', at: [xCap + capLen * 0.55, 0, R * 0.7] });
    if (spinal.length) out.push({ label: 'Spinal beam', at: [xCap + capLen, 0, lay.spinalR] });
    out.push({ label: 'Crew module', at: [xMod + modLen * 0.5, 0, R] });
    if (turrets.length) out.push({ label: 'Beam turrets', at: [xMod + modLen * 0.65, 0, R * 1.5] });
    if (coils.length) out.push({ label: coils.length > 1 ? 'Rail pairs' : 'Rail pair', at: [xMod + modLen * 0.6, 0, -R * 1.2] });
    if (bays.length) out.push({ label: 'Launch cells', at: [xMod + modLen * 0.45, R, 0] });
    if (pds.length) out.push({ label: 'Point defence', at: [xMod + modLen * 0.12, R * 0.7, R * 0.7] });
    out.push({ label: 'Truss spine', at: [xSpine + spineLen * 0.5, 0, 0] });
    if (tanks.length) out.push({ label: 'Propellant tanks', at: [(tanks[0].from + tanks[0].to) / 2, tanks[0].at[1], tanks[0].at[2] + tanks[0].r] });
    if (rads.length) out.push({ label: 'Radiators', at: [rads[0].at[0], rads[0].at[1] + rads[0].dir[1] * rads[0].span * 0.7, rads[0].at[2] + rads[0].dir[2] * rads[0].span * 0.7] });
    out.push({ label: 'Shadow shield', at: [xShield, 0, lay.shieldR] });
    out.push({ label: 'Reactor', at: [xThroat + reactorLen * 0.5, 0, lay.reactorR] });
    if (rExit > 0) out.push({ label: 'Drive', at: [xExit, 0, rExit] });
    out.push({ label: 'Sensor mast', at: [xMod + modLen * 0.82, 0, R * 2] });
    return out;
  }

  function flatten(parts, out) {
    if (!parts) return out;
    if (Array.isArray(parts)) { for (const p of parts) flatten(p, out); return out; }
    if (parts.kind && !parts.hide) out.push(parts);
    return out;
  }
  function facingOf(part, centreX, L) {
    if (part.facing) return part.facing;
    if (centreX > L * 0.22) return 'nose';
    if (centreX < -L * 0.22) return 'tail';
    return 'flank';
  }

  // ---------------------------------------------------------------- state normalisation
  function normState(s) {
    s = s || {};
    const damage = Object.assign({ nose: 0, flank: 0, tail: 0 }, s.damage || {});
    const systems = Object.assign({ drive: 1, radiators: 1, sensors: 1, weapons: 1 }, s.systems || {});
    const st = {
      radiators: s.radiators === undefined ? 1 : clamp(s.radiators, 0, 1),
      throttle: clamp(s.throttle || 0, 0, 1),
      heat: clamp(s.heat || 0, 0, 1),
      hull: s.hull === undefined ? 1 : clamp(s.hull, 0, 1),
      damage, systems,
      // what each part has left, when the damage module has been asked: a wrecked mount, panel or tank is
      // drawn dead rather than the whole hull dimming a little
      parts: s.parts || null,
      disabled: !!s.disabled, destroyed: !!s.destroyed,
    };
    if (st.destroyed) { st.throttle = 0; st.heat = 0; st.hull = Math.min(st.hull, 0.2); st.damage = { nose: Math.max(0.7, damage.nose), flank: Math.max(0.8, damage.flank), tail: Math.max(0.7, damage.tail) }; }
    if (st.disabled) { st.throttle = 0; }
    return st;
  }
  const bucket = (v, n) => Math.round(clamp(v, 0, 1) * n) / n;

  function factionColor(f) {
    if (!f) return { color: [0.72, 0.76, 0.82], dim: [0.36, 0.39, 0.44] };
    if (typeof f === 'string' && f[0] === '#') return { color: hexToRgb(f), dim: mix(hexToRgb(f), [0.05, 0.05, 0.07], 0.55) };
    const F = OD.Ships && OD.Ships.FACTIONS && OD.Ships.FACTIONS[f];
    if (F) return { color: hexToRgb(F.color), dim: hexToRgb(F.dim) };
    return { color: [0.72, 0.76, 0.82], dim: [0.36, 0.39, 0.44] };
  }

  // ---------------------------------------------------------------- rendering
  // The sprite cache is bounded twice over: by how many sprites it holds and by what they weigh. A hull
  // view asks for a 1400 px sprite (about 2 MB of canvas); a map at close zoom asks for a dozen small ones
  // a second while the radiators travel. Either ceiling evicts the oldest.
  const cache = new Map();
  const CACHE_MAX = 72;
  const CACHE_BYTES = 48e6;
  let cacheBytes = 0, cacheEvictions = 0, cacheBuilds = 0;
  function cacheDrop(key) {
    const s = cache.get(key);
    if (!s) return;
    cacheBytes -= s.bytes || 0;
    cache.delete(key);
    cacheEvictions++;
  }
  function cacheTrim() {
    while (cache.size > 1 && (cache.size > CACHE_MAX || cacheBytes > CACHE_BYTES)) cacheDrop(cache.keys().next().value);
  }
  function cacheStats() {
    return { sprites: cache.size, bytes: cacheBytes, maxBytes: CACHE_BYTES, maxSprites: CACHE_MAX, evictions: cacheEvictions, builds: cacheBuilds };
  }

  // The key comes apart, because a frame that cannot afford a fresh sprite has to find the nearest one it
  // already holds: `base` is the hull, the view, the size and everything her damage and her systems say —
  // two sprites that share it are the same ship in the same state — and the light, the panels' travel and
  // the live flag hang off it. The light goes in buckets of about 20°, not 10: the light turns with the
  // heading, so a ship coming 30° about was paying four sprites and a full turn forty. The sun crossing a
  // hull in 20° steps is a shading that moves; the eye reads it as light, not as a jump.
  function cacheKey(id, opts, st) {
    const v = typeof opts.view === 'string' ? opts.view : 'az' + Math.round((opts.view.az || 0) / 3) + 'el' + Math.round((opts.view.el || 0) / 3);
    const lv = lightVec(opts.light);
    const lk = Math.round(lv[0] * 3) + ',' + Math.round(lv[1] * 3) + ',' + Math.round(lv[2] * 3);
    const size = Math.round(opts.size / (opts.size > 300 ? 16 : opts.size > 120 ? 6 : 2));
    const fac = typeof opts.faction === 'string' ? opts.faction : 'x';
    const d = st.damage;
    // Radiators in 20 steps, not 8: a panel takes 25 to 120 s to run out and the eye should see it moving,
    // not stepping. The steps in between are only ever held while the panels are travelling, so they cost
    // the cache nothing once the ship settles at 0 or 1.
    const rad = bucket(st.radiators, 20);
    const live = opts.live ? 1 : 0;
    // `shape` is the hull itself — this class, this view, this size, these markings, alive or wrecked.
    // Two sprites that share it are the same picture in different states, which is what a frame that has
    // spent its one render falls back on when it holds nothing closer. Disabled and destroyed belong in
    // it: a hull a bucket off in heat is a shading, a wreck drawn as a live ship is a lie.
    const shape = [id, v, size, fac, st.disabled ? 1 : 0, st.destroyed ? 1 : 0].join('|');
    const base = [shape, st.throttle > 0.02 ? 1 : 0, bucket(st.heat, 6), bucket(st.hull, 4), bucket(d.nose, 4), bucket(d.flank, 4), bucket(d.tail, 4), bucket(st.systems.radiators, 2), bucket(st.systems.sensors, 2), bucket(st.systems.drive, 2), partsKey(st), opts.quality || 'auto'].join('|');
    return { key: base + '|' + live + '|' + lk + '|' + rad, shape, base, live, lv, rad };
  }
  // The nearest sprite already in hand for a key that missed: the same hull, view, size and state, lit from
  // somewhere else or with the panels a step along. Panels first (they are geometry, and the eye follows
  // them), light second (a shading, and it is about to be replaced by the exact one anyway).
  // `loose` widens that to the same hull in another state — a ship whose heat or damage has just stepped
  // over a bucket — which is a frame stale rather than absent, and far better than an icon.
  function nearestSprite(ck, anyLive, loose) {
    let best = null, bestKey = null, bestCost = Infinity;
    for (const ent of cache) {
      const s = ent[1];
      const same = s.base === ck.base;
      if (!same && !(loose && s.shape === ck.shape)) continue;
      if (!anyLive && s.live !== ck.live) continue;
      const cost = (same ? 0 : 100) + (1 - clamp(V.dot(s.lv, ck.lv), -1, 1)) + Math.abs(s.rad - ck.rad) * 4;
      if (cost < bestCost) { bestCost = cost; best = s; bestKey = ent[0]; }
    }
    // it is being drawn, so it goes to the back of the queue and is not the next one evicted
    if (best) { cache.delete(bestKey); cache.set(bestKey, best); }
    return best;
  }
  // The parts in four steps — wrecked, under half, worn, sound — so a fight that is chipping a hull down
  // does not render a new sprite every time a number moves.
  function partsKey(st) {
    const p = st.parts;
    if (!p) return '';
    const q = (v) => (typeof v !== 'number' ? '3' : v <= 0 ? '0' : v < 0.5 ? '1' : v < 0.999 ? '2' : '3');
    const arr = (a) => (a && a.length ? a.map(q).join('') : '');
    return arr(p.mounts) + '.' + arr(p.rads) + '.' + arr(p.tanks) + '.' + q(p.drive) + q(p.reactor) + q(p.sensors);
  }

  // builds the projected scene: polygons and lines in screen space, sorted far to near
  function buildScene(D, opts, st) {
    const L = D.length;
    const scale = opts.size / L;
    const cam = camera(opts.view);
    const seg = lodSegments(opts.size, opts.quality);
    const fac = factionColor(opts.faction || D.faction);
    const bctx = { L, state: st, faction: opts.faction || D.faction, facColor: fac, seg, view: opts.view, D };
    BUILD = { st, parts: st.parts || null, radCount: 0, tankCount: 0, lay: null };
    LIVE = !!opts.live;
    let parts;
    try { parts = flatten(buildDesign(D, bctx), []); } finally { BUILD = null; LIVE = false; }
    const raw = { polys: [], lines: [], lamps: [], drives: [], marks: [] };
    for (let i = 0; i < parts.length; i++) { const p = parts[i]; p._i = i; tessellate(p, seg, raw); }
    const proj = (p) => [V.dot(p, cam.R) * scale, -V.dot(p, cam.U) * scale, V.dot(p, cam.D) * scale];
    const items = [];
    let minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9;
    const bump = (s) => { if (s[0] < minx) minx = s[0]; if (s[0] > maxx) maxx = s[0]; if (s[1] < miny) miny = s[1]; if (s[1] > maxy) maxy = s[1]; };
    for (const poly of raw.polys) {
      const facingCam = V.dot(poly.n, cam.D);
      if (facingCam <= 0.001 && !poly.twoSided) continue;
      const sp = poly.pts.map(proj);
      let depth = 0; for (const s of sp) { depth += s[2]; bump(s); }
      depth /= sp.length;
      items.push({ t: 'p', sp, n: poly.twoSided && facingCam < 0 ? V.scale(poly.n, -1) : poly.n, depth, poly });
    }
    for (const ln of raw.lines) {
      const a = proj(ln.a), b = proj(ln.b); bump(a); bump(b);
      items.push({ t: 'l', a, b, w: Math.max(0.6, ln.w * scale), depth: (a[2] + b[2]) / 2 + 0.0001, part: ln.part, dir: V.norm(V.sub(ln.b, ln.a)) });
    }
    for (const lp of raw.lamps) { const s = proj(lp.p); bump(s); items.push({ t: 'lamp', s, r: Math.max(0.8, lp.r * scale), color: lp.color, depth: s[2] + 0.5, part: lp.part }); }
    items.sort((a, b) => a.depth - b.depth);
    const drives = raw.drives.map((d) => ({ s: proj(d.at), dir: [V.dot(d.dir, cam.R), -V.dot(d.dir, cam.U)], r: d.r * scale, depth: V.dot(d.at, cam.D) * scale }));
    // anchors for the live overlay: projected, but never counted into the picture's bounds
    const marks = raw.marks.map((m) => { const s = proj(m.at); return { role: m.role, index: m.index, at: m.at, dir: m.dir, up: m.up, side: m.side, axis: m.axis, flat: m.flat, r: m.r, barrel: m.barrel, barrelR: m.barrelR, cell: m.cell, hp: m.hp, x: s[0], y: s[1], depth: s[2] }; });
    return { items, drives, marks, cam, scale, L, fac, bounds: [minx, miny, maxx, maxy] };
  }

  function shadePoly(item, scene, opts, st, Lsun) {
    const poly = item.poly, part = poly.part;
    const mat = MATERIALS[part.material] || MATERIALS.hull;
    let base = part.color ? hexToRgb(part.color) : mat.color;
    if (!base) base = mat.dim ? scene.fac.dim : scene.fac.color;
    if (poly.edgeFace && part.edge) base = MATERIALS[part.edge].color;
    const n = item.n, cam = scene.cam;
    const nd = V.dot(n, Lsun);
    const diff = Math.max(0, nd);
    const fillDir = V.norm(V.add(V.scale(Lsun, -1), V.scale(cam.D, 0.6)));
    const fill = Math.max(0, V.dot(n, fillDir)) * 0.28;
    const amb = 0.16;
    const h = V.norm(V.add(Lsun, cam.D));
    const spec = Math.pow(Math.max(0, V.dot(n, h)), mat.gloss || 10) * (mat.spec || 0) * (0.5 + 0.5 * diff);
    const rim = Math.pow(1 - Math.max(0, V.dot(n, cam.D)), 3) * 0.10;
    let vary = 1;
    if (mat.vary) vary = 1 + (hash01(part._i * 7 + 1, poly.idx * 13 + 5, 17) - 0.5) * 2 * mat.vary;
    const key = [1.0, 0.97, 0.90], fillT = [0.32, 0.42, 0.60], ambT = [0.36, 0.42, 0.55];
    let c = [
      base[0] * vary * (amb * ambT[0] + diff * key[0] + fill * fillT[0]) + spec * key[0] + rim * 0.5,
      base[1] * vary * (amb * ambT[1] + diff * key[1] + fill * fillT[1]) + spec * key[1] + rim * 0.6,
      base[2] * vary * (amb * ambT[2] + diff * key[2] + fill * fillT[2]) + spec * key[2] + rim * 0.9,
    ];
    // radiators glow with heat; damaged radiator systems dull
    if (mat.radiator && !poly.edgeFace) {
      const hc = heatColor(st.heat);
      const eff = part.hp != null ? part.hp : st.systems.radiators;
      const glow = st.disabled || st.destroyed || eff <= 0 ? 0.15 : 0.55 + 0.45 * st.heat;
      c = mix(c, mix(c, hc, glow), 0.4 + 0.6 * eff);
    }
    if (mat.driveGlow) {
      const thr = st.throttle * (part.hp != null ? part.hp : st.systems.drive);
      if (thr > 0.01) c = mix(c, [0.75, 0.88, 1.0], 0.35 + 0.6 * thr);
    }
    if (mat.sensorDim && st.systems.sensors < 1) c = mix(c, [0.05, 0.04, 0.04], 0.65 * (1 - st.systems.sensors));
    // damage per facing: scorch, then holes
    const facing = facingOf(part, poly.centre[0], scene.L);
    const dmg = Math.max(st.damage[facing] || 0, part.role === 'radiator' ? 0 : (1 - st.hull) * 0.8);
    if (dmg > 0.02 && part.material !== 'lamp') {
      const hsh = hash01(part._i * 31 + 7, poly.idx * 17 + 3, 101);
      const scorch = clamp((dmg * 1.1 - hsh) / 0.5, 0, 1);
      if (hsh < (dmg - 0.45) * 1.4) return null;  // torn away
      if (scorch > 0) c = mix(c, [0.05, 0.04, 0.04], scorch * 0.85);
    }
    // A part whose component is gone is dead metal: burnt through, no paint left, no light in it.
    if (part.hp != null && part.hp < 1) {
      c = part.hp <= 0 ? mix(c, [0.035, 0.036, 0.045], 0.86) : mix(c, [0.07, 0.07, 0.08], 0.5 * (1 - part.hp));
    }
    if (st.disabled && !st.destroyed) c = mix(c, [0.08, 0.09, 0.11], 0.18);
    return c;
  }

  function paintScene(ctx, scene, opts, st, ox, oy) {
    const Lsun = lightVec(opts.light);
    ctx.save();
    ctx.translate(ox, oy);
    ctx.lineJoin = 'round';
    const big = opts.size >= 60;
    for (const it of scene.items) {
      if (it.t === 'p') {
        const c = shadePoly(it, scene, opts, st, Lsun);
        if (!c) continue;
        const col = css(c);
        ctx.fillStyle = col;
        ctx.beginPath();
        const sp = it.sp;
        ctx.moveTo(sp[0][0], sp[0][1]);
        for (let i = 1; i < sp.length; i++) ctx.lineTo(sp[i][0], sp[i][1]);
        ctx.closePath();
        ctx.fill();
        if (big && !it.poly.part.noOutline) { ctx.strokeStyle = col; ctx.lineWidth = 0.7; ctx.stroke(); }
        // coolant tubes across radiator faces
        if (it.poly.tubes && big) {
          const [a, b, d] = it.poly.tubeDir.map((p) => [V.dot(p, scene.cam.R) * scene.scale, -V.dot(p, scene.cam.U) * scene.scale]);
          ctx.strokeStyle = css(mix(c, [0.02, 0.02, 0.03], 0.35)); ctx.lineWidth = Math.max(0.6, opts.size * 0.0025);
          ctx.beginPath();
          const n = it.poly.tubes;
          for (let k = 1; k < n; k++) { const f = k / n; const p0 = [lerp(a[0], b[0], f), lerp(a[1], b[1], f)]; const p1 = [p0[0] + (d[0] - a[0]), p0[1] + (d[1] - a[1])]; ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); }
          ctx.stroke();
          // a brighter manifold along the root edge
          ctx.strokeStyle = css(mix(c, [1, 1, 1], 0.18)); ctx.lineWidth = Math.max(0.8, opts.size * 0.004);
          ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
        }
      } else if (it.t === 'l') {
        const mat = MATERIALS[it.part.material] || MATERIALS.truss;
        const base = it.part.color ? hexToRgb(it.part.color) : mat.color || scene.fac.color;
        const perp = V.norm(V.sub(Lsun, V.scale(it.dir, V.dot(Lsun, it.dir))));
        const diff = Math.max(0, V.dot(perp, Lsun)) * 0.75;
        const facing = facingOf(it.part, (it.a[0] + it.b[0]) / 2 / scene.scale, scene.L);
        const dmg = st.damage[facing] || 0;
        if (dmg > 0.5 && hash01(it.part._i, Math.round(it.a[0] * 3), Math.round(it.b[1] * 3)) < (dmg - 0.5) * 1.2) continue;
        const c = [base[0] * (0.22 + diff), base[1] * (0.24 + diff), base[2] * (0.30 + diff)];
        ctx.strokeStyle = css(c); ctx.lineWidth = it.w; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(it.a[0], it.a[1]); ctx.lineTo(it.b[0], it.b[1]); ctx.stroke();
      } else if (it.t === 'lamp') {
        if (st.destroyed || st.disabled) continue;
        const col = hexToRgb(it.color);
        const g = ctx.createRadialGradient(it.s[0], it.s[1], 0, it.s[0], it.s[1], it.r * 3);
        g.addColorStop(0, css(col, 0.9)); g.addColorStop(0.3, css(col, 0.35)); g.addColorStop(1, css(col, 0));
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(it.s[0], it.s[1], it.r * 3, 0, TAU); ctx.fill();
        ctx.fillStyle = css(mix(col, [1, 1, 1], 0.6)); ctx.beginPath(); ctx.arc(it.s[0], it.s[1], it.r * 0.8, 0, TAU); ctx.fill();
      }
    }
    // hot radiators throw a soft glow
    if (st.heat > 0.35 && !st.destroyed) {
      ctx.globalCompositeOperation = 'lighter';
      const hc = heatColor(st.heat);
      for (const it of scene.items) {
        if (it.t !== 'p' || !it.poly.tubes) continue;
        let cx = 0, cy = 0, x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        for (const p of it.sp) { cx += p[0]; cy += p[1]; if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
        cx /= it.sp.length; cy /= it.sp.length;
        // the halo reaches past the panel's own edge, so a wide wing glows as much as a narrow slat
        const R = Math.max(6, opts.size * 0.16, 0.65 * Math.hypot(x1 - x0, y1 - y0));
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
        g.addColorStop(0, css(hc, 0.16 * (st.heat - 0.35))); g.addColorStop(1, css(hc, 0));
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();
  }

  const MAX_SPRITE = 1400; // px: bigger requests render at this size and are scaled up when drawn
  // One fresh sprite a frame, and only one. A sprite costs 5 to 56 ms to render; a squadron coming about
  // asks for three or four in the same frame and the first frame of a fight asks for every hull at once —
  // eight of them cost 238 to 293 ms, a quarter-second stall on the first frame the player sees. The
  // caller stamps opts.frame (an integer, one per drawn frame): once a frame has paid for one render,
  // every other cold ask is served the nearest sprite already in hand — the same hull lit a bucket off,
  // or a state behind — and the exact one waits for a later frame.
  // With nothing in hand at all (the first frame of a fight, or a hull evicted), draw() now draws
  // NOTHING and returns false instead of paying for the render: the caller draws its icon for that hull
  // this frame, the way it does for a hull too small for art, and the queue drains one hull a frame.
  // Without opts.frame — the configurator, a preview, a tool — nothing is capped, and a caller with a
  // picture it cannot replace (an inspection view) can leave it out for that call.
  let coldFrame = null;    // the frame that has spent its one render
  let starvedFrame = null; // the last frame a hull was turned away with nothing of it in hand at all
  // What draw(), overlay() and muzzle() all start from: the sprite for these opts, cached or fresh.
  // mode 'cold' may render one; 'warm' never renders and takes the nearest sprite in hand, live or not.
  function spriteFor(design, opts, mode) {
    const D = normDesign(design);
    if (!D) return null;
    opts = Object.assign({ size: 200, view: 'threequarter' }, opts || {});
    const up = opts.size > MAX_SPRITE ? opts.size / MAX_SPRITE : 1;
    if (up > 1) opts = Object.assign({}, opts, { size: MAX_SPRITE });
    const st = normState(opts.state);
    const ck = cacheKey(designKey(design), Object.assign({}, opts, { faction: opts.faction || D.faction }), st);
    const cached = opts.cache !== false || mode === 'warm';
    if (cached && cache.has(ck.key)) { const hit = cache.get(ck.key); cache.delete(ck.key); cache.set(ck.key, hit); return Object.assign({}, hit, { up }); }
    if (mode === 'warm') { const near = nearestSprite(ck, true); return near ? Object.assign({}, near, { up }) : null; }
    if (cached && typeof opts.frame === 'number') {
      const spent = opts.frame === coldFrame;
      // While a hull is waiting for its first sprite, the frame's one render is reserved for it: a hull
      // already on screen that only wants re-lighting takes the stand-in it has and waits its turn, or
      // the first hull in the draw order would take every frame's render for itself and the rest would
      // stay icons for good.
      const draining = starvedFrame === opts.frame || starvedFrame === opts.frame - 1;
      if (spent || draining) {
        const near = nearestSprite(ck, false, true);
        if (near) return Object.assign({}, near, { up });
      }
      // nothing of this hull in hand, and the frame has already paid: draw nothing and say so
      if (spent) { starvedFrame = opts.frame; return null; }
      coldFrame = opts.frame;
    }
    cacheBuilds++;
    const scene = buildScene(D, opts, st);
    const [minx, miny, maxx, maxy] = scene.bounds;
    const pad = 3;
    const w = Math.max(2, Math.ceil(maxx - minx) + pad * 2), h = Math.max(2, Math.ceil(maxy - miny) + pad * 2);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ox = -minx + pad, oy = -miny + pad;
    const ctx = canvas.getContext('2d');
    paintScene(ctx, scene, opts, st, ox, oy);
    const sprite = { canvas, ox, oy, w, h, drives: scene.drives, marks: scene.marks, cam: scene.cam, scale: scene.scale, up, bytes: w * h * 4, shape: ck.shape, base: ck.base, live: ck.live, lv: ck.lv, rad: ck.rad };
    if (opts.cache !== false) {
      cache.set(ck.key, sprite);
      cacheBytes += sprite.bytes;
      cacheTrim();
    }
    return sprite;
  }
  function render(design, opts) { return spriteFor(design, opts, 'cold'); }

  // exhaust: drawn live so it can flicker without invalidating the sprite
  function drawPlume(ctx, sprite, opts, st) {
    // a wrecked drive is no drive: 0 means nothing comes out of the bells, not "no reading"
    const drv = st.systems.drive == null ? 1 : clamp(st.systems.drive, 0, 1);
    const thr = st.throttle * drv;
    if (thr <= 0.01 || !sprite.drives.length) return;
    const t = opts.time || 0;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const d of sprite.drives) {
      const dx = d.dir[0], dy = d.dir[1];
      const dl = Math.hypot(dx, dy);
      const flick = 1 + 0.05 * Math.sin(t * 37 + d.s[0]) + 0.03 * Math.sin(t * 61);
      // the same reach as the plume the map draws, so a hull at close zoom and the same hull in the panel
      // portrait are burning at the same throttle
      const len = opts.size * (0.7 + 2.0 * thr) * flick * Math.max(0.15, dl);
      const wid = Math.max(2, d.r * 1.7 * (0.8 + 0.4 * thr));
      const ux = dl > 1e-3 ? dx / dl : 0, uy = dl > 1e-3 ? dy / dl : 0;
      ctx.save();
      ctx.translate(d.s[0], d.s[1]);
      ctx.rotate(Math.atan2(uy, ux));
      // long haze
      let g = ctx.createLinearGradient(0, 0, len, 0);
      g.addColorStop(0, 'rgba(150,200,255,' + (0.30 * thr).toFixed(3) + ')'); g.addColorStop(0.3, 'rgba(110,170,255,' + (0.12 * thr).toFixed(3) + ')'); g.addColorStop(1, 'rgba(60,110,220,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(0, -wid * 0.45); ctx.lineTo(len * 0.3, -wid * 0.7); ctx.lineTo(len, -wid * 0.35); ctx.lineTo(len, wid * 0.35); ctx.lineTo(len * 0.3, wid * 0.7); ctx.lineTo(0, wid * 0.45); ctx.closePath(); ctx.fill();
      // hot core
      g = ctx.createLinearGradient(0, 0, len * 0.45, 0);
      g.addColorStop(0, 'rgba(235,245,255,' + (0.9 * thr).toFixed(3) + ')'); g.addColorStop(0.5, 'rgba(180,215,255,' + (0.5 * thr).toFixed(3) + ')'); g.addColorStop(1, 'rgba(120,170,255,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(0, -wid * 0.32); ctx.lineTo(len * 0.45, 0); ctx.lineTo(0, wid * 0.32); ctx.closePath(); ctx.fill();
      // shock diamonds
      ctx.fillStyle = 'rgba(255,255,255,' + (0.18 * thr).toFixed(3) + ')';
      for (let k = 1; k <= 4; k++) { const x = len * 0.05 * k * (1 + 0.3 * thr); const r = wid * 0.07 * (1 - k * 0.15); ctx.beginPath(); ctx.ellipse(x, 0, r * 2.4, r, 0, 0, TAU); ctx.fill(); }
      // glow at the bell
      g = ctx.createRadialGradient(0, 0, 0, 0, 0, wid * 1.6);
      g.addColorStop(0, 'rgba(200,230,255,' + (0.55 * thr).toFixed(3) + ')'); g.addColorStop(1, 'rgba(120,170,255,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, wid * 1.6, 0, TAU); ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  function draw(ctx, id, opts) {
    opts = Object.assign({ x: 0, y: 0, size: 200, view: 'threequarter', rotation: 0, plume: true }, opts || {});
    const sprite = render(id, opts);
    if (!sprite) return false;
    const st = normState(opts.state);
    const up = sprite.up || 1;
    ctx.save();
    ctx.translate(opts.x, opts.y);
    if (opts.rotation) ctx.rotate(opts.rotation);
    if (up !== 1) ctx.scale(up, up);
    if (opts.plume !== false) drawPlume(ctx, sprite, up !== 1 ? Object.assign({}, opts, { size: opts.size / up }) : opts, st);
    ctx.drawImage(sprite.canvas, -sprite.ox, -sprite.oy);
    ctx.restore();
    return true;
  }


  // ---------------------------------------------------------------- the live overlay
  // What the ship is doing this instant, drawn over the sprite draw() has just put down: the mounts
  // pointing where gunnery is holding them, the flash and the first stretch of a beam, a slug leaving the
  // rails, a cell open with the interceptor away, point-defence bolts, and gas out of a holed tank.
  // Everything is short, small and additive, and every age is measured against opts.simTime — the sim's
  // own clock — so at warp 0 the picture holds and at 16x a flash is gone between frames. Nothing here
  // runs on a clock of its own, and nothing is drawn that the ship is not doing.
  const FX = {
    beamHold: 1.2,   // s a fire report is still worth drawing (beams are continuous: the report is renewed)
    slug: 1.6,       // s a round is still leaving the rails
    launch: 3,       // s an interceptor is still close enough to the bay to be part of the picture
    pd: 0.8,         // s a point-defence report stays lit
    vent: 2,         // s a vent report stays lit
  };
  // A soft round glow — one gradient, the shape the engagement module already uses where a beam lands, so
  // the flash at the mirror and the spot on the far hull are plainly the same light.
  function flare(ctx, x, y, r, col, a) {
    if (!(r > 0.3) || !(a > 0.005)) return;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, css(mix(col, [1, 1, 1], 0.6), a));
    g.addColorStop(0.35, css(col, a * 0.42));
    g.addColorStop(1, css(col, 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  }
  // Where a mount that has slewed is pointing: a turret sits on a ring and trains on the bearing gunnery
  // is holding, elevating onto it. Gunnery only holds a mount that bears, so there is no stop to hit here.
  // A spinal tube does not turn at all and keeps the nose.
  function slewDir(mark, aim) {
    if (aim == null || mark.role === 'spinal') return mark.dir;
    return [Math.cos(aim), Math.sin(aim), 0];
  }
  // How much of a mount the camera can see: a turret on the far side of the hull is behind it, and so is
  // its flash. The sprite hides what faces away; the overlay has to do the same by hand.
  function faceK(mk, camD) {
    // a dome is hidden by the hull it sits on; a rail muzzle stands clear of it and is seen along its own line
    const n = mk.role === 'beam' || mk.role === 'pd' ? mk.up || mk.dir : mk.dir;
    if (!n) return 1;
    return clamp((V.dot(n, camD) + 0.35) / 0.5, 0, 1);
  }
  // The anchor for a mount: by its place in the ship's mount list, else the nth of that kind, else the
  // first one there is. A family that draws fewer housings than the design carries still gets an effect.
  function markFor(marks, role, id, nth) {
    let first = null, count = 0;
    for (let i = 0; i < marks.length; i++) {
      const m = marks[i];
      if (m.role !== role) continue;
      if (id != null && m.index === id) return m;
      if (!first) first = m;
      count++;
    }
    if (!count) return null;
    if (nth != null) { let k = 0; const want = ((nth % count) + count) % count; for (let i = 0; i < marks.length; i++) { if (marks[i].role === role) { if (k === want) return marks[i]; k++; } } }
    return first;
  }
  function countRole(marks, role) { let n = 0; for (let i = 0; i < marks.length; i++) if (marks[i].role === role) n++; return n; }

  // ---- damage control: the parties at work on the hull ----
  // Which anchor a party's part is on. The crew module names a component the way the damage module does —
  // 'drive', 'reactor', 'sensors', 'rad2', 'tank1', 'beam1', 'coil2', 'bay1', 'pd3' — and the hull carries
  // an anchor for each. The art may draw fewer panels or tanks than the damage module keeps, so the nth
  // wraps, as a mount's effect does; a beam mount is a turret or the spinal tube, and the damage module
  // numbers the two together, in the design's own mount order.
  const PART_ROLE = { rad: 'rad', tank: 'tank', coil: 'coil', bay: 'bay', pd: 'pd', drive: 'drive', reactor: 'reactor', sensors: 'sensors' };
  function partyMark(marks, part) {
    if (!part || typeof part !== 'string') return null;
    const m = /^([a-z]+)(\d*)$/.exec(part);
    if (!m) return null;
    const kind = m[1], nth = m[2] ? Math.max(0, parseInt(m[2], 10) - 1) : null;
    if (kind === 'beam') {
      const list = [];
      for (let i = 0; i < marks.length; i++) if (marks[i].role === 'beam' || marks[i].role === 'spinal') list.push(marks[i]);
      if (!list.length) return null;
      list.sort((a, b) => (a.index || 0) - (b.index || 0));
      return list[nth == null ? 0 : nth % list.length];
    }
    const role = PART_ROLE[kind];
    return role ? markFor(marks, role, null, nth) : null;
  }
  // How much of that part the camera can see. A mount, a bay or a tank is hidden by the hull it sits on,
  // the way its own flash is; a radiator plate shows either face; an anchor on the hull axis (the drive,
  // the reactor, the nose) is hidden only from the end the hull itself is in the way from.
  function partyFace(mk, camD) {
    if (!mk) return 0;
    if (mk.axis) return clamp((V.dot(mk.axis, camD) + 0.72) / 0.35, 0, 1);
    if (mk.flat) { const n = mk.up || mk.dir; return n ? clamp((Math.abs(V.dot(n, camD)) + 0.32) / 0.45, 0, 1) : 1; }
    const n = mk.role === 'beam' || mk.role === 'pd' || mk.role === 'coil' ? mk.up || mk.dir : mk.dir || mk.up;
    if (!n) return 1;
    return clamp((V.dot(n, camD) + 0.32) / 0.45, 0, 1);
  }
  function partyLabel(p, i) {
    const raw = p.id == null ? '' : String(p.id), m = /(\d+)/.exec(raw);
    return m ? m[1] : raw || String(i + 1);
  }
  function etaWords(s) { return !(s > 0) ? '' : s < 90 ? Math.max(1, Math.round(s)) + ' s' : Math.round(s / 60) + ' min'; }
  // Hull px on screen: below this the ring is bigger than the part it is on and the hull under it is an
  // icon anyway. The ring is clamped to 9 px from 120 px down, so from here to 120 the marker is exactly
  // the size it is at the floor — drawing it costs nothing it did not cost at 120 and puts the party on
  // the map at the zoom a fight is actually played at.
  const PARTY_MIN_PX = 70;
  const PARTY_MONO = '"IBM Plex Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace';
  const PARTY_WORK = [1, 0.74, 0.32], PARTY_HOLD = [0.66, 0.73, 0.82];
  const PARTY_FAR = 0.35;     // how far down a marker on the far side of the hull goes, and no further
  // Where the last overlay() put its rings, in the canvas pixels it drew them in. The markers are laid
  // out on the screen rather than on the hull — a ring gives way to its neighbour — so this is the only
  // place the result exists; OD.ShipArt.lastParties() hands it out for a caller that has to measure it.
  const partyLayout = [];
  // A party is a small ring on the part it is working: the progress as an arc from the top, the party's
  // number inside, and the time it has left under it where there is room. Lit and breathing on the sim
  // clock while the crew is at it; dim, still, broken into dashes and with the time struck through while
  // they are strapped in for a burn and the work is paused — a state that has to be legible with no
  // second marker beside it to compare against. It is the one thing in the overlay that is plainly a
  // marker and not light, so it is drawn
  // last, in plain paint over the effects, in screen pixels rather than metres: the same ring on a 390 px
  // phone and on a laptop hull view. The map turns the hull to her heading; a number turned with her
  // would be upside down half the time, so the markers are drawn in the screen's own frame — the ring
  // stands upright and the arc starts at the top of the screen, wherever the ship is pointing.
  function drawParties(ctx, list, marks, cam, P2, size, now, up, rot, ox, oy) {
    const k = 1 / (up || 1);                       // the overlay is drawing inside the sprite's own scale-up
    const R = clamp(size * 0.042, 9, 22) * k;      // ring radius: 9 px at the smallest hull that shows one
    const lw = clamp(size * 0.006, 1.5, 3.2) * k;
    const fs = Math.max(8 * k, R);
    const room = size >= 260;                      // the hull view and the portrait have room for the time
    const cs = Math.cos(rot || 0), sn = Math.sin(rot || 0);
    // the picture's frame, turned back to the screen's: where the anchor ends up once the hull is turned
    const upright = (q) => [q[0] * cs - q[1] * sn, q[0] * sn + q[1] * cs];
    // Which way the hull is lying on the screen. Parties crowd onto the parts that get hit together —
    // three of a cruiser's six panels are neighbours on the same stretch of spine — and rings that land
    // on top of each other hide the very numbers they exist to show. So a ring that would sit on one
    // already placed slides along the hull's own axis until it is clear: along the spine is where a hull
    // has room, and a marker that has moved down the spine is still plainly on that end of the ship.
    // Nose-on (the front and rear views) the hull axis is a point on the screen and there is no such
    // direction to slide along; there the rings stack up and down the screen instead, which is as good
    // as any other line through a hull that is drawn as a disc.
    const axRaw = upright([V.dot([1, 0, 0], cam.R), -V.dot([1, 0, 0], cam.U)]);
    const axLen = Math.hypot(axRaw[0], axRaw[1]);
    const axis = axLen > 0.25 ? [axRaw[0] / axLen, axRaw[1] / axLen] : [0, 1];
    const cross = [-axis[1], axis[0]];
    const minD = R * 2.15;      // centres this far apart: the rims clear each other by a fifth of a radius
    const etaClear = R * 3.5;   // a neighbour's rim within about 1.5 radii: too close to hang a time under
    partyLayout.length = 0;
    // ---- where they all go, before any of them is drawn. A time is dropped for a ring that has a
    // neighbour close by, and a ring placed late is just as much a neighbour as one placed early, so
    // nothing can be drawn until every ring has its place.
    const placed = [], drawn = [];
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (!p) continue;
      const mk = partyMark(marks, p.part);
      if (!mk) continue;
      const a = upright(P2(mk.at));
      let x = a[0], y = a[1];
      // Whoever is placed first keeps the anchor; everyone after it gives way, and gives way along the
      // hull. Which is a question about one line, so it is answered on one line and not by shoving: each
      // ring already down bars a stretch of the axis — how long depends on how far off the line it sits —
      // and the newcomer takes the nearest station outside all of them. Nearest, so a ring only leaves
      // its own part by as much as the crowd forces it to; and outside all of them at once, so no third
      // ring can be shoved back onto a first.
      let u = x * axis[0] + y * axis[1];
      const v = x * cross[0] + y * cross[1];
      const barred = [];
      for (let q = 0; q < drawn.length; q++) {
        const du = drawn[q][0] * axis[0] + drawn[q][1] * axis[1];
        const dv = drawn[q][0] * cross[0] + drawn[q][1] * cross[1];
        const reach = minD * minD - (v - dv) * (v - dv);
        if (reach > 0) { const w = Math.sqrt(reach); barred.push([du - w, du + w]); }
      }
      if (barred.length) {
        barred.sort((b1, b2) => b1[0] - b2[0]);
        const merged = [];
        for (let q = 0; q < barred.length; q++) {
          const last = merged[merged.length - 1];
          if (last && barred[q][0] <= last[1]) last[1] = Math.max(last[1], barred[q][1]);
          else merged.push([barred[q][0], barred[q][1]]);
        }
        for (let q = 0; q < merged.length; q++) {
          if (u > merged[q][0] && u < merged[q][1]) { u = u - merged[q][0] < merged[q][1] - u ? merged[q][0] : merged[q][1]; break; }
        }
        x = u * axis[0] + v * cross[0];
        y = u * axis[1] + v * cross[1];
      }
      drawn.push([x, y]);
      placed.push({ p, i, mk, x, y, off: Math.hypot(x - a[0], y - a[1]) });
    }
    const labels = [];
    ctx.save();
    if (rot) ctx.rotate(-rot);
    for (let j = 0; j < placed.length; j++) {
      const p = placed[j].p, i = placed[j].i, mk = placed[j].mk;
      const x = placed[j].x, y = placed[j].y;
      // A mount on the far side is behind the hull and so is its flash — a repair party is not. The board
      // says "Party 2 on tank 2, 27 s to 50 %" whichever way she is lying, and the marker is that same
      // line put on the hull: the two must never contradict each other. So nothing is culled here and the
      // alpha has a floor, the way a holed tank's gas does. Round the back the ring is dimmer, and still
      // countable.
      const vk = Math.max(PARTY_FAR, partyFace(mk, cam.D));
      const prog = clamp(typeof p.progress === 'number' ? p.progress : 0, 0, 1);
      const working = p.working !== false;
      const pulse = working ? 0.82 + 0.18 * Math.sin(now * 1.9 + i * 1.7) : 1;
      const col = working ? PARTY_WORK : PARTY_HOLD;
      const al = vk * (working ? 1 : 0.7);
      // Strapped in for a burn, the party is stopped, and that has to read with no working marker beside
      // it to compare against: steel instead of amber and a missing halo are a comparison, a broken ring
      // is not. So the paused ring — backing, rim and arc alike — is drawn in dashes, the work standing
      // where it stopped, and the time is struck through rather than dropped. The board says "paused for
      // the burn"; the hull says the same thing in its own way.
      const round = TAU * (R - lw * 0.5);
      const dash = round / 12;                 // six dashes and six gaps: still a ring at 9 px, plainly broken
      if (working) {
        // a halo, so the ring is found against a lit hull without the ring itself having to shout
        ctx.globalCompositeOperation = 'lighter';
        flare(ctx, x, y, R * 2.4, col, 0.17 * al * pulse);
        ctx.globalCompositeOperation = 'source-over';
      }
      // The marker is hollow: a small hull's radiator panel is not much bigger than the ring that goes on
      // it, and a filled disc would hide the very part the player is watching. Only the number stands on
      // one. Both of them, and the dark backing under the ring, hold their weight whatever the party is
      // doing — a number over a glowing radiator has to be read.
      // butt caps, always: the overlay's effects leave the context on round, and a round cap on a wide
      // dashed stroke grows every dash back over its own gap — the broken ring would read as a whole one
      ctx.lineCap = 'butt';
      if (!working) ctx.setLineDash([dash, dash]);
      ctx.lineWidth = lw * 2.1;
      ctx.strokeStyle = 'rgba(6,10,15,' + (0.55 * vk).toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(x, y, R - lw * 0.5, 0, TAU); ctx.stroke();
      ctx.fillStyle = 'rgba(7,11,16,' + (0.74 * vk).toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(x, y, R * 0.58, 0, TAU); ctx.fill();
      ctx.lineWidth = lw;
      ctx.strokeStyle = css([0.62, 0.70, 0.80], 0.38 * al);
      ctx.beginPath(); ctx.arc(x, y, R - lw * 0.5, 0, TAU); ctx.stroke();
      if (prog > 0.002) {
        ctx.strokeStyle = css(col, (working ? 0.95 : 0.85) * al * pulse);
        if (working) ctx.lineCap = 'round';
        // The arc starts at the top of the screen, a quarter of the way round from where the ring's own
        // dashes start. Take that quarter out of the pattern, or the arc's dashes land in the ring's gaps
        // and a broken ring closes up again into a whole one.
        if (!working) ctx.lineDashOffset = -round / 4;
        ctx.beginPath(); ctx.arc(x, y, R - lw * 0.5, -Math.PI / 2, -Math.PI / 2 + TAU * prog); ctx.stroke();
        ctx.lineCap = 'butt';
      }
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
      ctx.font = '500 ' + fs.toFixed(1) + 'px ' + PARTY_MONO;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = css(working ? [1, 0.97, 0.9] : [0.8, 0.85, 0.9], (working ? 0.98 : 0.88) * al);
      ctx.fillText(partyLabel(p, i), x, y + fs * 0.04);
      // How long it has left, under the ring — struck through for a paused party, whose countdown is
      // standing still rather than running. The ring is the thing that has to be on the part, so where
      // the time would foul a ring or another time — parties crowded onto one end of a hull — the time
      // is left off rather than shoved somewhere it does not belong. The board has it in full either way.
      let shown = null;
      if (room && p.eta > 0) {
        const fs2 = Math.max(8 * k, R * 0.62), w = etaWords(p.eta), ty = y + R + fs2;
        ctx.font = '500 ' + fs2.toFixed(1) + 'px ' + PARTY_MONO;
        const hw = ctx.measureText(w).width / 2 + fs2 * 0.2, hh = fs2 * 0.7;
        let clear = true;
        // Room for a time is not just room for the word: a ring a rim-and-a-half away leaves the two
        // times almost touching, and "2 min 4 min 5 min" run together reads as one number nobody can use
        // — and with two rings that close, neither time plainly belongs to either of them. The board
        // prints every one of them in full, so a crowded hull drops the times and keeps the rings.
        for (let q = 0; q < drawn.length; q++) {
          if (q === j) continue;
          const d = drawn[q];
          if (Math.hypot(x - d[0], y - d[1]) < etaClear) clear = false;
          if (Math.abs(x - d[0]) < hw + R && Math.abs(ty - d[1]) < hh + R) clear = false;
        }
        for (let q = 0; q < labels.length; q++) { const b = labels[q]; if (Math.abs(x - b[0]) < hw + b[2] && Math.abs(ty - b[1]) < hh + b[3]) clear = false; }
        if (clear) {
          labels.push([x, ty, hw, hh]);
          shown = { text: w, x: ox + (x - hw) * (up || 1), y: oy + (ty - hh) * (up || 1), w: hw * 2 * (up || 1), h: hh * 2 * (up || 1) };
          ctx.lineJoin = 'round';
          ctx.lineWidth = Math.max(1.8 * k, fs2 * 0.34);
          ctx.strokeStyle = 'rgba(6,10,15,' + (0.8 * al).toFixed(3) + ')';
          ctx.strokeText(w, x, ty);
          ctx.fillStyle = css([0.92, 0.94, 0.97], (working ? 0.88 : 0.62) * al);
          ctx.fillText(w, x, ty);
          if (!working) {
            // struck through: this countdown is not counting down
            ctx.lineWidth = Math.max(1, fs2 * 0.12);
            ctx.strokeStyle = css([0.86, 0.89, 0.94], 0.62 * al);
            ctx.beginPath(); ctx.moveTo(x - hw * 0.88, ty); ctx.lineTo(x + hw * 0.88, ty); ctx.stroke();
          }
        }
      }
      // What this marker came to, in the canvas's own pixels, for a caller that has to know where the
      // rings landed — the art check asks whether any two of them overlap and whether any two times
      // print over each other. The ring is drawn inside the sprite's scale-up; the layout is not.
      partyLayout.push({ id: p.id, part: p.part, working, x: ox + x * (up || 1), y: oy + y * (up || 1), r: R * (up || 1), moved: placed[j].off * (up || 1), eta: shown });
    }
    ctx.restore();
  }

  // A barrel the overlay owns: a rod shaded across its width the way the renderer shades a cylinder, so a
  // turret that has trained on something looks like the rest of the ship and not like a sticker.
  function drawRod(ctx, ax, ay, bx, by, w, hp, ls) {
    const dx = bx - ax, dy = by - ay, l = Math.hypot(dx, dy);
    const base = MATERIALS.barrel.color;
    const shade = (t) => { const k = hp <= 0 ? 0.16 : 0.22 + 0.95 * clamp(t, 0, 1); return css([base[0] * k + 0.015, base[1] * k + 0.015, base[2] * k + 0.02]); };
    if (!(l > 0.4)) { ctx.fillStyle = shade(0.6); ctx.beginPath(); ctx.arc(ax, ay, Math.max(0.6, w / 2), 0, TAU); ctx.fill(); return; }
    const nx = -dy / l, ny = dx / l, hw = Math.max(0.5, w / 2);
    const s = clamp(ls ? ls.x * nx + ls.y * ny : 0.4, -1, 1);
    const g = ctx.createLinearGradient(ax - nx * hw, ay - ny * hw, ax + nx * hw, ay + ny * hw);
    g.addColorStop(0, shade(0.5 - s * 0.45));
    g.addColorStop(0.5, shade(0.5 + s * 0.2));
    g.addColorStop(1, shade(0.5 + s * 0.45));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(ax - nx * hw, ay - ny * hw); ctx.lineTo(bx - nx * hw, by - ny * hw);
    ctx.lineTo(bx + nx * hw, by + ny * hw); ctx.lineTo(ax + nx * hw, ay + ny * hw);
    ctx.closePath(); ctx.fill();
  }

  function overlay(ctx, design, opts) {
    opts = Object.assign({ x: 0, y: 0, size: 200, view: 'threequarter', rotation: 0 }, opts || {});
    partyLayout.length = 0;     // whatever the last call drew, this one is the answer now
    const st = normState(opts.state);
    const sprite = render(design, opts);   // the sprite draw() has just cached: nothing is rendered here
    if (!sprite || !sprite.marks || !sprite.marks.length) return false;
    const marks = sprite.marks, cam = sprite.cam, sc = sprite.scale, size = opts.size, up = sprite.up || 1;
    const fx = st.destroyed ? null : opts.fx || null;
    const now = opts.simTime != null ? opts.simTime : fx && fx.t != null ? fx.t : 0;
    const fc = factionColor(opts.faction);
    const col = mix(fc.color, [1, 1, 1], 0.35), hotc = [1, 1, 1];
    const P2 = (p) => [V.dot(p, cam.R) * sc, -V.dot(p, cam.U) * sc];
    const D2 = (d) => { const x = V.dot(d, cam.R), y = -V.dot(d, cam.U); const f = Math.hypot(x, y); return f > 1e-6 ? { x: x / f, y: y / f, f } : { x: 1, y: 0, f: 0 }; };
    const lv = lightVec(opts.light), ls = D2(lv);
    const aim = fx && typeof fx.aim === 'number' ? fx.aim : null;
    // Light is light: a flash has a size in pixels, not in metres, so the same shot reads the same on a
    // 40 px hull on the map and on a 900 px one in the hull view. Everything below is clamped that way.
    const px = (frac, lo, hi) => clamp(size * frac, lo, hi);
    // …but a ceiling that stops at a 400 px hull makes a 900 px cruiser fire the same 64 px stub a 500 px
    // one does, and six point-defence mounts read as hairlines. Where the effect is the thing being looked
    // at — the stub, the flash at the mirror, a bolt, an interceptor clearing the rail — the ceiling goes
    // up with the hull once it bites. The floors stay: they are what keeps an icon-sized hull legible.
    const pxUp = (frac, lo, hi) => clamp(size * frac, lo, Math.max(hi, size * frac));
    ctx.save();
    ctx.translate(opts.x, opts.y);
    if (opts.rotation) ctx.rotate(opts.rotation);
    if (up !== 1) ctx.scale(up, up);

    // ---- the mounts, where they are pointing. Drawn solid, under the light, before any glow.
    if (opts.live) {
      for (let i = 0; i < marks.length; i++) {
        const m = marks[i];
        if (m.role !== 'beam' || !(m.barrel > 0)) continue;
        if (faceK(m, cam.D) <= 0.02) continue;   // it is on the far side of the hull: the hull is in the way
        // a wreck's mounts point where they were last holding; they are only dead metal now
        const d3 = st.destroyed ? m.dir : slewDir(m, aim);
        const a = P2(m.at), b = P2(V.add(m.at, V.scale(d3, m.barrel)));
        drawRod(ctx, a[0], a[1], b[0], b[1], Math.max(1, m.barrelR * 2 * sc), st.destroyed ? 0 : m.hp, ls);
      }
    }

    if (fx) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      const mounts = fx.mounts || [];
      for (let i = 0; i < mounts.length; i++) {
        const e = mounts[i];
        const age = now - (typeof e.firedAt === 'number' ? e.firedAt : now);
        if (!(age >= -0.001)) continue;
        const bearing = typeof e.bearing === 'number' ? e.bearing : aim;
        if (e.kind === 'beam') {
          if (age > FX.beamHold) continue;
          const mk = markFor(marks, e.arc === 'nose' ? 'spinal' : 'beam', e.id, e.index);
          if (!mk) continue;
          const vk = faceK(mk, cam.D);
          if (vk <= 0.02) continue;
          ctx.globalAlpha = vk;
          const d3 = mk.role === 'spinal' ? mk.dir : slewDir(mk, bearing);
          const muzzle = P2(V.add(mk.at, V.scale(d3, mk.barrel || mk.r)));
          const d = D2(d3);
          // the beam breathes on the sim clock, so a broadside shimmers instead of standing still
          const pulse = 0.82 + 0.18 * Math.sin(now * 5.5 + i * 2.1);
          // short: the map draws the beam the rest of the way to the hull it is standing on. This is the
          // stretch that has to leave the right mount.
          // a spinal tube is the biggest gun on the hull and its aperture lights up like it
          const big = mk.role === 'spinal' ? 1.6 : 1;
          const len = pxUp(0.13, 6, 64) * Math.max(0.3, d.f) * pulse * big;
          const ex = muzzle[0] + d.x * len, ey = muzzle[1] + d.y * len;
          const g = ctx.createLinearGradient(muzzle[0], muzzle[1], ex, ey);
          g.addColorStop(0, css(col, 0.30 * pulse)); g.addColorStop(1, css(col, 0));
          ctx.strokeStyle = g; ctx.lineWidth = px(0.010, 1.2, 4.5) * big;
          ctx.beginPath(); ctx.moveTo(muzzle[0], muzzle[1]); ctx.lineTo(ex, ey); ctx.stroke();
          const g2 = ctx.createLinearGradient(muzzle[0], muzzle[1], ex, ey);
          g2.addColorStop(0, css(hotc, 0.42 * pulse)); g2.addColorStop(1, css(hotc, 0));
          ctx.strokeStyle = g2; ctx.lineWidth = px(0.0035, 0.6, 1.8);
          ctx.beginPath(); ctx.moveTo(muzzle[0], muzzle[1]); ctx.lineTo(ex, ey); ctx.stroke();
          flare(ctx, muzzle[0], muzzle[1], pxUp(0.018, 1.6, 11) * pulse * big, col, 0.75);
          ctx.globalAlpha = 1;
        } else if (e.kind === 'coilgun') {
          if (age > FX.slug) continue;
          const mk = markFor(marks, 'coil', e.id, e.index);
          if (!mk) continue;
          const vk = faceK(mk, cam.D);
          if (vk <= 0.02) continue;
          ctx.globalAlpha = vk;
          const d3 = bearing == null ? mk.dir : [Math.cos(bearing), Math.sin(bearing), 0];
          const p = P2(mk.at), d = D2(d3);
          const k = 1 - age / FX.slug;
          if (age < 0.45) {
            const f = 1 - age / 0.45;
            flare(ctx, p[0], p[1], px(0.02, 1.6, 12) * f, mix(col, [1, 0.84, 0.58], 0.5), 0.7 * f);
          }
          // the round itself, on its way off the rail
          const travel = px(0.05 + 0.4 * (age / FX.slug), 2, 90) * Math.max(0.15, d.f);
          const tail = px(0.05, 2, 22) * k;
          ctx.strokeStyle = css(mix(col, hotc, 0.6), 0.5 * k); ctx.lineWidth = px(0.0045, 0.7, 2);
          ctx.beginPath(); ctx.moveTo(p[0] + d.x * travel, p[1] + d.y * travel); ctx.lineTo(p[0] + d.x * (travel - tail), p[1] + d.y * (travel - tail)); ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }
      // ---- interceptors away: a cell lit on the block and a bright dot leaving it
      const launches = fx.launches || [];
      for (let i = 0; i < launches.length; i++) {
        const e = launches[i];
        const age = now - (typeof e.t === 'number' ? e.t : now);
        if (age < -0.001 || age > FX.launch) continue;
        const mk = markFor(marks, 'bay', e.index, i);
        if (!mk) continue;
        const vk = faceK(mk, cam.D);
        if (vk <= 0.02) continue;
        ctx.globalAlpha = vk;
        // it holds its light while it is clearing the hull and goes out at the end of the window; the map
        // draws the dart itself from there on
        const k = age < FX.launch * 0.7 ? 1 : 1 - (age - FX.launch * 0.7) / (FX.launch * 0.3);
        const bearing = typeof e.bearing === 'number' ? e.bearing : null;
        // out of the cell first and around afterwards: it clears its own hull before it turns onto the
        // bearing, so it never reads as flying through the ship
        const d3 = bearing == null ? mk.dir : V.norm(V.add(V.scale(mk.dir, 0.9), V.scale([Math.cos(bearing), Math.sin(bearing), 0], 0.35)));
        const d = D2(d3);
        const base = P2(mk.at);
        // the cell it came out of, lit for as long as the door is open
        if (age < 2.2 && mk.cell > 0 && mk.up && mk.side) {
          const f = Math.min(1, (1 - age / 2.2) * 1.6);
          const off = (hash01(i * 13 + 1, Math.round(e.t || 0), 7) - 0.5) * mk.r * 1.2;
          const off2 = (hash01(i * 7 + 3, Math.round(e.t || 0), 11) - 0.5) * mk.r * 1.2;
          const c3 = V.add(V.add(mk.at, V.scale(mk.up, off)), V.scale(mk.side, off2));
          const c = P2(c3);
          flare(ctx, c[0], c[1], Math.min(mk.cell * 0.8 * sc, px(0.02, 1.2, 9)) * f, mix(col, [1, 0.8, 0.55], 0.5), 0.55 * f);
        }
        // clear of the cell fast, then coasting: it stays part of the hull's picture instead of running off it
        const travel = pxUp(0.03 + 0.24 * Math.sqrt(age / FX.launch), 1, 62) * Math.max(0.2, d.f);
        const x = base[0] + d.x * travel, y = base[1] + d.y * travel;
        const r = px(0.007, 1, 4);
        ctx.strokeStyle = css(mix(col, hotc, 0.4), 0.5 * k); ctx.lineWidth = px(0.004, 0.7, 2);
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - d.x * px(0.06, 3, 34) * k, y - d.y * px(0.06, 3, 34) * k); ctx.stroke();
        flare(ctx, x, y, r * 3.4 * k, col, 0.65 * k);
        ctx.fillStyle = css(hotc, 0.85 * k); ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
        ctx.globalAlpha = 1;
      }
      // ---- point defence: short bolts out of the small domes toward what is coming in
      const pds = fx.pd || [];
      for (let i = 0; i < pds.length; i++) {
        const e = pds[i];
        const age = now - (typeof e.t === 'number' ? e.t : now);
        if (age < -0.001 || age > FX.pd) continue;
        const mk = markFor(marks, 'pd', e.index, i);
        if (!mk || !e.toward) continue;
        const vk = faceK(mk, cam.D);
        if (vk <= 0.02) continue;
        ctx.globalAlpha = vk;
        const d3 = [e.toward.x, e.toward.y, e.toward.z || 0];
        if (!(Math.abs(d3[0]) + Math.abs(d3[1]) + Math.abs(d3[2]) > 1e-6)) continue;
        // a dome fires off its own mounting, so the bolt leans out of the hull as well as toward the dart
        const t3 = V.norm(mk.up ? V.add(V.norm(d3), V.scale(mk.up, 0.45)) : d3);
        const p = P2(V.add(mk.at, V.scale(t3, mk.barrel || mk.r * 0.6)));
        const d = D2(t3);
        // a rate of fire, not a strobe: the brightness rides the sim clock and stops when it does
        const beat = 0.55 + 0.45 * Math.sin(now * 11 + i * 1.7);
        const k = (1 - age / FX.pd) * beat;
        const len = pxUp(0.10, 5, 38) * Math.max(0.2, d.f);
        ctx.strokeStyle = css(mix(col, hotc, 0.5), 0.70 * k); ctx.lineWidth = px(0.0055, 1, 2.6);
        ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(p[0] + d.x * len, p[1] + d.y * len); ctx.stroke();
        ctx.strokeStyle = css(hotc, 0.45 * k); ctx.lineWidth = px(0.002, 0.5, 1.1);
        ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(p[0] + d.x * len * 0.8, p[1] + d.y * len * 0.8); ctx.stroke();
        flare(ctx, p[0], p[1], px(0.013, 1.1, 7), col, 0.6 * k);
        ctx.globalAlpha = 1;
      }
      // ---- a holed tank: gas out of the hole, pale and cold and going nowhere useful
      const vents = fx.vents || [];
      const nTanks = countRole(marks, 'tank');
      for (let i = 0; i < vents.length; i++) {
        const e = vents[i];
        if (typeof e.t === 'number' && now - e.t > FX.vent) continue;
        const of = e.of > 0 ? e.of : vents.length;
        const idx = nTanks > 0 ? Math.floor(((e.tank || 0) * nTanks) / Math.max(1, of)) : 0;
        const mk = markFor(marks, 'tank', null, idx);
        if (!mk) continue;
        // A mount on the far side is behind the hull and so is its flash — but a hole is not a mount.
        // The gas leaves the tank and hangs in space around the ship, so it is seen from the far side
        // too: past the hull, dimmer, and still the only sign that a tank is open. Nothing is culled
        // here, and the alpha has a floor: the log says "Tank 1 holed and venting" and the picture has
        // to show it whichever way she is lying.
        ctx.globalAlpha = Math.max(0.35, faceK(mk, cam.D));
        // a hole is a hole: even a slow leak is plain to see against the sky, so the jet has a floor
        const rate = clamp(e.rate == null ? 0.6 : e.rate, 0.3, 1);
        // Out of the hull, not along the tank: the gas leaves on the tank's outward normal — the vector
        // from the hull axis out to the anchor, or the anchor's own axis (mk.up) for a tank sitting on it.
        // A tank on the ship's back points that normal straight at a camera overhead, and the top view is
        // the one the fight is played in: the jet projects to nothing there and a holed tank reads as a
        // small white spark. So when the normal lies that far out of the picture the jet turns about the
        // hull axis — still radially out of the hull, now out of the side the camera can see. From three
        // quarters the normal already shows and nothing turns.
        const p = P2(mk.at);
        let n3 = [0, mk.at[1], mk.at[2]];
        if (!(Math.hypot(n3[1], n3[2]) > 1e-6)) n3 = mk.up || mk.dir;
        n3 = V.norm(n3);
        let d = D2(n3);
        const turn = V.cross([1, 0, 0], n3);
        if (d.f < 0.6 && V.len(turn) > 1e-6) {
          // the two tanks of a pair vent to opposite sides, so a hull losing both is not one wide smear
          const w = clamp((d.f - 0.2) / 0.4, 0, 1);
          const t3 = V.scale(V.norm(turn), idx % 2 ? -1 : 1);
          d = D2(V.norm(V.add(V.scale(n3, w), V.scale(t3, 1 - w))));
        }
        // a jet pointing at the camera is a cloud, not a plume: it keeps its width and loses its reach
        const face = Math.max(0.3, d.f);
        const len = px(0.07 + 0.16 * rate, 9, 90) * face;
        const wid = px(0.006 + 0.013 * rate, 1.6, 8) / face;
        const nx = -d.y, ny = d.x;
        const g = ctx.createLinearGradient(p[0], p[1], p[0] + d.x * len, p[1] + d.y * len);
        g.addColorStop(0, 'rgba(158,205,248,' + (0.42 * rate).toFixed(3) + ')');
        g.addColorStop(0.45, 'rgba(132,186,245,' + (0.18 * rate).toFixed(3) + ')');
        g.addColorStop(1, 'rgba(110,170,240,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(p[0] + nx * wid * 0.35, p[1] + ny * wid * 0.35);
        ctx.lineTo(p[0] + d.x * len + nx * wid * 2.1, p[1] + d.y * len + ny * wid * 2.1);
        ctx.lineTo(p[0] + d.x * len - nx * wid * 2.1, p[1] + d.y * len - ny * wid * 2.1);
        ctx.lineTo(p[0] - nx * wid * 0.35, p[1] - ny * wid * 0.35);
        ctx.closePath(); ctx.fill();
        // the hole itself, white where the gas is still dense, and the cloud breaking up along the jet
        flare(ctx, p[0], p[1], px(0.012, 1.6, 9), [0.62, 0.78, 0.98], 0.5 * rate);
        for (let q = 0; q < 3; q++) {
          const f = 0.3 + q * 0.3;
          flare(ctx, p[0] + d.x * len * f, p[1] + d.y * len * f, wid * (1.1 + q * 1.1), [0.55, 0.72, 0.96], 0.2 * rate * (1 - f * 0.55));
        }
        // flecks of frozen propellant, stepped by the sim clock so they hold with it
        const step = Math.floor(now * 3);
        for (let q = 0; q < 5; q++) {
          const f = hash01(q * 31 + idx, step, 17);
          const s = hash01(q * 17 + 5, step + 1, 23) - 0.5;
          const x = p[0] + d.x * len * f + nx * wid * 2.4 * s * f, y = p[1] + d.y * len * f + ny * wid * 2.4 * s * f;
          ctx.fillStyle = 'rgba(210,236,255,' + (0.55 * (1 - f) * rate).toFixed(3) + ')';
          ctx.beginPath(); ctx.arc(x, y, Math.max(0.5, px(0.0035, 0.5, 2.6) * (1 - f)), 0, TAU); ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    // ---- damage control, over everything else: who is working what, and how far along they are
    const parties = fx && fx.parties ? fx.parties : null;
    if (parties && parties.length && size >= PARTY_MIN_PX) drawParties(ctx, parties, marks, cam, P2, size, now, up, opts.rotation || 0, opts.x, opts.y);
    ctx.restore();
    return true;
  }

  // ---------------------------------------------------------------- where a shot leaves the hull
  // The muzzle of one mount, in the canvas coordinates draw() has just drawn this ship in: the same
  // (x, y, size, view, rotation, faction) and the same anchors the overlay uses, so a beam the map draws
  // from here starts at the mirror the overlay lit and not at the middle of the hull.
  //   mount is one of artFx's mounts: { id, index, kind: 'beam' | 'coilgun' } (arc 'nose' picks the spinal
  //   tube, as it does in the overlay). A beam leaves the end of the barrel, trained on the bearing the
  //   mount fired on (mount.bearing, else opts.fx.aim, else where the mount sits); a slug leaves the rails.
  // null when there is nothing to start from: no such mount on this hull, the mount is on the far side of
  // the hull and not in the picture, or the sprite has not been rendered yet. This never renders one — it
  // is called for every mount that is firing, every frame — so the first frame of a new hull answers null
  // and the beam starts at the centre for that frame, as it always did.
  function muzzle(design, opts, mount) {
    if (!mount) return null;
    opts = Object.assign({ x: 0, y: 0, size: 200, view: 'threequarter', rotation: 0 }, opts || {});
    const sprite = spriteFor(design, opts, 'warm');
    if (!sprite || !sprite.marks || !sprite.marks.length) return null;
    const marks = sprite.marks, cam = sprite.cam, sc = sprite.scale;
    const coil = mount.kind === 'coilgun';
    const role = coil ? 'coil' : mount.arc === 'nose' ? 'spinal' : 'beam';
    let mk = markFor(marks, role, mount.id, mount.index);
    // a family that carries her beams the other way round still answers for a beam mount
    if (!mk && !coil) mk = markFor(marks, role === 'spinal' ? 'beam' : 'spinal', mount.id, mount.index);
    if (!mk) return null;
    if (faceK(mk, cam.D) <= 0.02) return null;
    const st = normState(opts.state);
    const fx = opts.fx || null;
    const aim = fx && typeof fx.aim === 'number' ? fx.aim : null;
    const bearing = typeof mount.bearing === 'number' ? mount.bearing : aim;
    const at = coil ? mk.at
      : V.add(mk.at, V.scale(st.destroyed || mk.role === 'spinal' ? mk.dir : slewDir(mk, bearing), mk.barrel || mk.r));
    const x = V.dot(at, cam.R) * sc, y = -V.dot(at, cam.U) * sc;
    const up = sprite.up || 1;
    const r = opts.rotation || 0, c = Math.cos(r), sn = Math.sin(r);
    return { x: opts.x + (x * c - y * sn) * up, y: opts.y + (x * sn + y * c) * up };
  }

  function bounds(id, opts) {
    const s = render(id, Object.assign({ size: 200, view: 'threequarter' }, opts || {}));
    if (!s) return null;
    const up = s.up || 1;
    return { w: s.w * up, h: s.h * up, ox: s.ox * up, oy: s.oy * up };
  }

  // A family's stages settle some parts where the drawing puts them (the Kestrel moves its radiator wings into the
  // gaps between its tanks), so a label reads the layout as it stands after a build, not the one before it. One
  // build per design, kept.
  const settled = new Map();
  function settledLayout(D, design, opts) {
    let key = null;
    try { key = designKey(design); } catch (e) { key = null; }
    if (key != null && settled.has(key)) return settled.get(key);
    let lay = null;
    const st = normState(opts.state);
    const bctx = { L: D.length, state: st, faction: opts.faction || D.faction, facColor: factionColor(opts.faction || D.faction), seg: lodSegments(opts.size, opts.quality), view: opts.view, D };
    const was = BUILD;
    BUILD = { st, parts: st.parts || null, radCount: 0, tankCount: 0, lay: null };
    try { buildDesign(D, bctx); lay = bctx.layout || null; } catch (e) { lay = null; } finally { BUILD = was; }
    if (!lay) return layoutFor(D);
    if (key != null) { if (settled.size > 48) settled.clear(); settled.set(key, lay); }
    return lay;
  }
  function callouts(design, opts) {
    const D = normDesign(design);
    opts = Object.assign({ size: 200, view: 'threequarter', rotation: 0 }, opts || {});
    const lay = settledLayout(D, design, opts);
    const list = D._fam.callouts ? D._fam.callouts(lay, defaultCallouts(lay)) : defaultCallouts(lay);
    const cam = camera(opts.view), scale = opts.size / D.length;
    const cr = Math.cos(opts.rotation || 0), sr = Math.sin(opts.rotation || 0);
    // The families pin the radiator label on the first panel. In a turned view that panel can be the one behind
    // the hull, so the label moves to the same spot on whichever panel is nearest the camera.
    const rads = lay.rads || [];
    const nearest = (c) => {
      if (c.label !== 'Radiators' || rads.length < 2 || !rads[0].dir) return c.at;
      const d0 = rads[0].dir, o = V.sub(c.at, rads[0].at), s = V.dot(o, d0), rest = V.sub(o, V.scale(d0, s));
      let best = c.at, bd = V.dot(c.at, cam.D);
      for (let i = 1; i < rads.length; i++) {
        if (!rads[i].dir) continue;
        const p = V.add(V.add(rads[i].at, V.scale(rads[i].dir, s)), rest), d = V.dot(p, cam.D);
        if (d > bd + 1e-9) { bd = d; best = p; }
      }
      return best;
    };
    return list.map((c) => {
      const at = nearest(c);
      const x = V.dot(at, cam.R) * scale, y = -V.dot(at, cam.U) * scale;
      return { label: c.label, text: c.text, x: x * cr - y * sr, y: x * sr + y * cr, depth: V.dot(at, cam.D) * scale, facing: c.facing };
    });
  }

  function describe(design) {
    const D = normDesign(design);
    const lay = layoutFor(D);
    const list = D._fam.callouts ? D._fam.callouts(lay, defaultCallouts(lay)) : defaultCallouts(lay);
    return { id: D.hull, name: D.name || D._fam.name || D.hull, length: D.length, blurb: D.blurb || D._fam.blurb || '', parts: list.map((c) => ({ label: c.label, text: c.text })), notes: D._fam.notes || '' };
  }
  function layout(design) { return layoutFor(normDesign(design)); }

  // What every part of a live ship has left, from the damage module's own record when she carries one, so
  // a wrecked mount, panel or tank is drawn dead instead of the whole hull dimming a little. The art keeps
  // its own count of panels and tanks (a design draws what its numbers ask for), so those lists are spread
  // over the parts in order rather than matched one for one.
  function partsFromShip(ship) {
    const list = ship && ship.components;
    if (!Array.isArray(list) || !list.length) {
      if (!ship || !ship.mountHp) return null;
      return { mounts: ship.mountHp.map((h) => (h > 0 ? 1 : 0)) };
    }
    const mounts = [], rads = [], tanks = [];
    let drive = null, reactor = null, sensors = null;
    for (let i = 0; i < list.length; i++) {
      const c = list[i], hp = clamp(typeof c.hp === 'number' ? c.hp : 1, 0, 1), kind = c.kind || '';
      if (kind === 'mount' && c.mountIndex != null) mounts[c.mountIndex] = hp;
      else if (kind === 'radiator') rads.push(hp);
      else if (kind === 'tank') tanks.push(hp);
      else if (c.id === 'drive') drive = hp;
      else if (c.id === 'reactor') reactor = hp;
      else if (c.id === 'sensors') sensors = hp;
    }
    for (let i = 0; i < mounts.length; i++) if (mounts[i] == null) mounts[i] = 1;
    return { mounts, rads, tanks, drive, reactor, sensors };
  }

  function stateFromShip(ship, sim) {
    const cls = OD.Ships && OD.Ships.CLASSES && OD.Ships.CLASSES[ship.cls];
    const arm = ship.armour || {}, ref = (cls && cls.armour) || arm;
    const wear = (k) => (ref[k] ? clamp(1 - (arm[k] === undefined ? ref[k] : arm[k]) / ref[k], 0, 1) : 0);
    const sun = sim && sim.sunAngle !== undefined ? sim.sunAngle : 0;
    return {
      faction: ship.faction,
      state: {
        radiators: ship.radiators ? ship.radiators.state : 1,
        throttle: ship.throttle || 0,
        heat: ship.thermalLoad ? clamp(ship.thermalLoad(), 0, 1) : 0,
        hull: ship.hull === undefined ? 1 : ship.hull,
        damage: { nose: wear('nose'), flank: wear('flank'), tail: wear('tail') },
        systems: ship.systems || {},
        parts: partsFromShip(ship),
        disabled: !!ship.disabled, destroyed: !!ship.destroyed,
      },
      light: { az: ((sun - (ship.heading || 0)) * 180) / Math.PI, el: 30 },
    };
  }

  OD.ShipArt = {
    version: 1,
    VIEWS, kit: KIT, MATERIALS,
    registerFamily, register: registerFamily, families: FAMILIES,
    list: () => Object.keys(FAMILIES).filter((k) => k[0] !== '_'), has: (id) => !!FAMILIES[id],
    preset, normDesign, designKey, layout, stages: STAGES,
    draw, render, bounds, callouts, describe, stateFromShip,
    clearCache: () => { cache.clear(); cacheBytes = 0; },
    cacheStats,
    overlay, muzzle, lastParties: () => partyLayout.map((q) => Object.assign({}, q)),
    _camera: camera, _lightVec: lightVec, _normState: normState,
  };
})();
