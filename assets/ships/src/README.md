# Ship art: hull families

`js/shipart.js` is a small parametric spacecraft renderer for Canvas 2D. A **design object** (the numbers a class in
`js/ships.js` carries: length, propMass, thrust, exhaustVelocity, reactorPower, radiatorArea, armour, mounts) is turned
into a parts list by a **hull family**, then shaded and projected for any view. Each file in this folder registers one
family with `OD.ShipArt.registerFamily(id, family)`; the game gets them appended to `js/shipart.js` (a plain `cat`).

Rules for every family:
- Hard science fiction only (Atomic Rockets vocabulary): armour cap, crew module, truss spine, propellant tanks,
  radiators, shadow shield, reactor, drive bell, sensor mast, mount housings. No wings, no fins, no windows along the
  hull. Navigation lamps are fine.
- The family must stay **parametric**: a configurator will change `propMass`, `radiatorArea`, `thrust`, `armour`,
  `mounts`, `length` on your hull and expect the picture to follow (more/bigger tanks, longer radiators, bigger bell,
  longer/blunter cap, more turrets). Test that: render your family with the stock class and with numbers doubled and
  halved, and with mounts removed or added.
- Keep the fleet reading as one navy: same materials, same lamp colours (white nose, red port, green starboard),
  faction colour only on the accent bands the core places (or your own bands using material `accent`).
- Ship-design vocabulary only in code comments and text: "beam turret", "rail pair", "launch cells", "point-defence
  dome". Nothing about what they do to a target.
- Write only your own file `assets/ships/src/<id>.js`. Never edit js/shipart.js or anything else.

## The family object

```js
OD.ShipArt.registerFamily('corvette', {
  name: 'Kestrel-class corvette', blurb: '…', length: 70,     // stock length, metres
  radius: 0.055,                 // main hull radius as a fraction of length (module and cap base)
  cap: { len: 0.16, shape: 'ogive' | 'cone' | 'blunt' | 'wedge', tipR: 0.1 (fraction of R), rings: true },
  module: { len: 0.2, kind: 'drum' | 'cylinder' | 'box' | 'twin', material: undefined },
  spine: { kind: 'truss' | 'tube' | 'keel', n: 4 (longerons), r: 0.55 (fraction of R) },
  tanks: { arrangement: 'cluster' | 'inline' | 'saddle' | 'ring', count: 3, material: 'tank' | 'tankSilver' | 'tankWhite', density: 700, dome: 0.6 },
  radiators: { panels: 2, layout: 'wings' | 'cross' | 'fan', mode: 'slide' | 'fold', aspect: 2.6 },
  drive: { nozzles: 1, kind: undefined | 'chemical' | 'thermal' | 'torch' },   // kind defaults from exhaustVelocity
  sensors: { mast: true, dish: 0.5 },
  accents: { bands: true },
  stages: {                      // optional: replace a default stage, or null to drop it
    cap(K, c, lay) { return parts; }, spinal, module, mounts, spine, tanks, radiators, tail, sensors,
    extras(K, c, lay) { return parts; }   // added after everything else: family-specific detail
  },
  callouts(lay, defaults) { return defaults.concat([{ label, text, at: [x, y, z] }]); },  // optional
  notes: 'one paragraph of design notes',
});
```

A stage receives the parts **kit** `K`, a context `c = { L, state, faction, facColor, seg, view, D, layout }` and the
computed **layout** `lay`. `c.state` is the live state (`radiators` 0..1, `throttle`, `heat`, `hull`, `damage`,
`systems`, `disabled`, `destroyed`); read `c.state.radiators` when you draw deployable panels. To keep the default
stage and add to it, call it from `OD.ShipArt.stages.<name>(K, c, lay)` and push more parts.

Layout fields (metres, ship frame: x toward the nose, y port, z dorsal, origin at mid-hull):
`L, R (hull radius), capLen, modLen, spineLen, tailLen, xNose, xCap (cap base), xMod (module rear), xSpine (front of
the shadow shield), xShield, xReactor, xThroat, xExit, rExit, nozzles, bellLen, driveKind, reactorR, reactorLen,
shieldR, shieldT, spineR, tanks: [{from, to, r, at}], tankZone, rads: [{at, dir, span, chord, mode}], radZone,
spinal, turrets, coils, bays, pds (mount records by kind), spinalR, tipR, A (armour), D (design), F (family)`.

## The kit (all sizes in metres)
- `K.lathe({ at, axis: 'x'|'y'|'z'|[vec], profile: [[u, r], …], seg, arc: [a0, a1], material, color, inside, facing, rot: [axis, angle, pivot], shift })`
- `K.cyl({ from, to, r, at, axis, caps: 'both'|'none'|'start'|'end', material })`, `K.cone({ from, to, r0, r1, … })`
- `K.tank({ from, to, r, at, dome, material })` cylinder with domed ends; `K.sphere({ at, r, material })`
- `K.box({ at, size: [sx, sy, sz], frame: [u, v, w] (optional orientation), material })`
- `K.rod({ from, to, r, material })` strut or mast; `K.truss({ from, to, r, n, bays, member })` open lattice
- `K.torus({ at, axis, R, r, seg, tube, material })` ring; `K.dish({ at, r, depth, axis })` sensor dish
- `K.nozzle({ at (throat), length, rThroat, rExit, dir })` drive bell; registers the exhaust for the plume
- `K.radiator({ at (root), span, chord, dir (outward), along, deploy, mode: 'slide'|'fold', foldAxis, foldSign, tubes, thick })`
- `K.turret({ at, r, up (base normal), aim, barrel (length), barrelR })` dome housing with a short tube
- `K.cells({ at, normal, frame, rows, cols, cell, depth })` block of launch cells; `K.lamp({ at, color, r })`
- `K.poly({ pts, material, flip, twoSided })` free polygon
- Helpers: `K.V` (vec3: add, sub, scale, dot, cross, norm, rot), `K.clamp`, `K.lerp`, `K.mix`
- Any part accepts `material`, `color` (hex overrides the material), `facing: 'nose'|'flank'|'tail'` (which armour
  facing its damage follows; inferred from x otherwise), `rot`, `shift`, `hide`.

Materials: `hull, hullDark, hullLight, armour, armourEdge, tank, tankSilver, tankWhite, truss, trussDark, nozzle,
nozzleIn, shield, reactor, radiator, radiatorEdge, sensor, dish, mount, barrel, bayDoor, bayDark, accent, accentDim,
dark, white, hab`.

## Anchors: the live overlay and damage control

`K.mark({ at, dir, up, role, index, r, … })` places an **anchor** — no geometry, just a point that rides the part's
own transforms and comes out of the sprite already projected, for `OD.ShipArt.overlay()` to draw from. `K.turret`,
`K.cells` and `K.tank` place theirs whenever you give them `role` and `index` (the mount's place in the design's
mount list, or the panel's or tank's place in the picture). The renderer adds the rest after your stages have run:
one on every radiator plate (role `rad`), one on the drive bells (`drive`), one on the reactor drum (`reactor`) and
one in the nose for the sensor suite (`sensors`). A repair party is drawn as a small ring on the anchor of the part
it is working, so every component the damage module keeps has to have one. The marker is never culled with the
part it is on — the board says a party is on tank 2 whichever way the hull is lying, so a marker on the far side
is dimmed to a floor (0.35) and still drawn. It comes in at 70 px of hull, where the ring is already clamped to
its smallest 9 px, and a paused party (strapped in for a burn) draws the ring in dashes with its time struck
through, so "paused" reads with no working marker beside it to compare against.

Damage comes in groups, so the rings do: three of a cruiser's six panels are neighbours on one stretch of spine.
Two rings that overlap hide the numbers inside them, so a ring that would land on one already placed slides
**along the hull's own axis** to the nearest station that clears its neighbour's rim — the least it can move, and
along the spine, which is where a hull has room and where a marker still plainly belongs to that end of the ship.
(Nose-on, where the hull axis is a point on the screen, they stack up and down instead.) The time under a ring is
dropped when another ring is within about 1.5 radii of its rim, or where it would print over another time or over
a ring: two times a few pixels apart read as one number, and the board carries every one of them in full anyway.
`OD.ShipArt.lastParties()` reports where the rings and times actually went, in the canvas pixels they were drawn
in, which is how tools/art-check.js asserts that none of them overlap.

### What a hit part looks like

A part the damage module keeps carries an `hp` (0 wrecked … 1 sound), and the kit draws its state in **shape**
as well as in paint. Half the angles a fight is watched from show a plate edge-on and a dome as a curve, where
darker paint says nothing, so `K.radiator`, `K.turret`, `K.cells` and `K.rod` change what they build:

| part | under half (`hp < 0.5`) | wrecked (`hp <= 0`) |
| --- | --- | --- |
| `K.radiator` | torn off past the buckle (62 % of the span), half its coolant lines, bent 17° off its hinge and leaning 29° along the hull | the root manifold only (28 %), bent 46°, leaning 46°, no tubes, no heat, dead metal |
| `K.turret` (beam, point defence) | a smaller dome sitting down on its ring, half a barrel | the dome opened up into a torn cup, no barrel |
| `K.cells` | stove into the hull, a third of its mouths burst and closed | doors gone, the block one hole sunk in the plating |
| `K.rod` with an `hp` | — | a stub at the `from` end (34 %) |

The **lean** is the one of those that is not about the part being smaller. A shortened plate is also what a
radiator part way out looks like, and from the side a plate bent about the hull axis is only a shorter plate:
the board would say "damaged" while the heat box said "extending" over two pictures the eye cannot tell apart.
So a hit plate also leans along the hull, off its own face — the hull axis lies across the picture in every view
but the two nose-on ones, where the bend has the screen to itself — and a plate that is short *and* leaning has
been hit, because travel does one or the other and never both. Which way it leans comes from `mode`: a panel that
slides straight out leans aft, one on a hinge leans forward, so the lean is never the pose the hinge itself puts
it in. Pass the `mode` you actually deploy with (a family that folds its own panels outside the kit still says
`mode: 'fold'`) and the lean follows.

A family gets all of that for free by passing `role`/`index` (or an explicit `hp`) to those kit calls. Two things
are yours to pass on:

- **rail pairs**: the rails *are* the coilgun, so give the rods the mount's own hp — `K.rod({ …, hp: K.hp('coil',
  lay.coilIdx[i]) })` — or a wrecked gun keeps its rails.
- **a reactor drum you draw yourself** (the core `tail` stage does this for you): `K.hp('reactor')` on the drum and
  its ribs, the drum a little narrower when wrecked, the ribs dropped with the coolant they carried.

Everything above is keyed into the sprite in the same four steps the shading uses (wrecked / under half / worn /
sound), so a fight that is chipping a hull down still costs one render a step, not one a frame. A sound hull is
drawn exactly as it was before any of this.

Place those yourself only where the default would land in the wrong place — the station's axis is not the hull axis,
so she places her own `reactor` and `sensors` anchors in her `extras` stage; an anchor already there is never
doubled. `axis: [x, y, z]` marks an anchor on the hull axis, which the hull hides from one end only; `flat: true`
one on a plate, which shows either face. Anchors are never counted into the picture's bounds and cost nothing to
carry, so a family may place as many as it has parts worth pointing at.

## Testing
Render your family (the preview page loads `assets/ships/src/<id>.js` by itself):

    cd /tmp/claude-0/-home-user/2386e5ff-8f24-5f55-a3a2-ef36cc71fab0/scratchpad
    node render-views.js --id frigate --views side,threequarter,top,front,rear --size 600 \
      --state '{"throttle":0.6,"heat":0.5,"radiators":1}' --out out/frigate --tag stock

`--state` takes the state object, `--light '{"az":-50,"el":35}'`, `--faction ISA`, `--size` px, `--tag` names the
files, `--extra file.js` injects a script after load (use it to register a modified design under another id for
parameter sweeps, e.g. `OD.ShipArt.draw(ctx, Object.assign(OD.ShipArt.preset('frigate'), { propMass: 6e6 }), …)`;
simplest is a tiny extra script that calls `window.ShipPreview.shot(design, view, size, opts)` yourself and writes the
data URL, or register a family alias). Look at the PNGs (the Read tool shows images). The script also prints render
timings and any page errors: a family must add no page errors and keep the 600 px three-quarter render under ~60 ms.
