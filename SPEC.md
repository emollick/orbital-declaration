# Orbital Declaration — module contract

Hard science fiction space combat game. Plain JS, classic scripts, Canvas 2D, no build step.
Everything hangs off `window.OD`. Scripts load in this order from `index.html`:

    js/util.js  js/physics.js  js/ships.js  js/autopilot.js  js/ai.js  js/sim.js
    js/render.js  js/ui.js  js/story.js  js/campaign.js  js/skirmish.js  js/engagement.js  js/main.js

`js/engagement.js` is optional. When it is missing or fails to load, `window.OD.Engagement` is undefined
and the game runs without weapons: hostiles are neutralised by boarding (see Boarding).

## Units and frame
- SI internally: metres, seconds, kilograms, watts, joules, radians. Formatting for display lives in `OD.U.fmt`.
- 2D plane. `pos`, `vel` are `{x, y}`. Heading 0 = +x, increasing counter-clockwise on the canvas (y up in world).
- A scenario may have one gravitating body at the origin: `sim.body = {name, mu, radius, kind}`.
- Ships thrust only along `heading`. Rotation has angular acceleration limits (`angAccel`, `maxAngVel`).

## Ship instance (created by `OD.Sim.makeShip(spec)`)
    id, name, cls (class id), faction ('JC'|'ISA'|'CIV'), pos, vel, heading, angVel,
    dryMass, propMass, exhaustVelocity, thrust, angAccel, maxAngVel, length,
    throttle (0..1 actual), cmdThrottle, cmdHeading,
    order: {type: 'hold'|'intercept'|'keeprange'|'matchv'|'evade'|'retreat'|'manual', target, range, heading, throttle}
    jink (bool)  — lateral random burns overlay, defeats unguided slugs
    target (ship id | null), weaponsFree (bool)
    heat (J), sinkCapacity (J), idleHeat (W), driveHeat (W at full throttle), radiatorArea (m²), radiatorTemp (K)
    radiators: {state 0..1, deployed (bool), auto (bool)}    extra heat this step: `extraHeat` (W, reset each step)
    overheated (bool): sink at capacity → drive capped to 25 %, `weaponsInhibited = true`
    systems: {drive, radiators, sensors, weapons} each 0..1 integrity   hull: 0..1
    armour: {nose, flank, tail} (cm equivalent)   mounts: [...] (see ships.js)
    disabled, destroyed, captured (bools), ai (bool), player (bool)
    stats: {dvSpent, distance}

Helper methods on the ship: `mass()`, `accel()` (m/s² at full throttle now), `deltaV()` (remaining, Tsiolkovsky),
`radiatorPower()` (W dissipated right now).

## Sim (`OD.Sim`)
    const sim = new OD.Sim(scenario)   scenario: {name, body, sunAngle, ships:[spec], objectives:[...], triggers:[...], playerFaction}
    sim.step(dt)                       fixed substeps ≤ 0.5 s. Order: AI → autopilot → attitude → thrust+gravity → integrate → thermal → boarding → Engagement.update → objectives/triggers
    sim.setOrder(shipId, order)  sim.setTarget(shipId, targetId)  sim.setRadiators(shipId, deployed|'auto')
    sim.ships, sim.time, sim.log [{t, speaker, text, kind}], sim.fx [particles], sim.outcome (null|'victory'|'defeat')
    sim.predictPath(ship, seconds, steps) → [{x,y}] coast prediction under gravity
    sim.hostiles(ship), sim.nearestHostile(ship), sim.byId(id), sim.addLog(text, speaker, kind), sim.spawn(spec)

## Objectives
    {id, text, type, ...params, hidden?}    types:
    rendezvous {ship, target, range, speed, hold}  reach {ship, point|target, range}  survive {seconds}
    neutralize {targets: [ids] | 'hostiles'}   protect {ship}  (fails when destroyed)   escapeFail {ship, point, range}
    custom {test(sim) → true|false|'fail'}
    "ship" may be an id or 'player' (any player-faction ship).  neutralised = destroyed || disabled || captured.

## Boarding (built in)
A player-faction warship within 3 km of a hostile at < 25 m/s relative speed for 90 s captures it
(`captured = true`, `disabled = true`, faction flips). Progress is `ship.boarding = {target, progress}`.

## Engagement module contract (`OD.Engagement`, optional)
The sim and renderer call these when the object exists. Keep everything in game vocabulary.

    OD.Engagement = {
      init(sim)                      called once after the sim is built
      update(sim, dt)                called every substep after thermal. May add to ship.extraHeat, reduce
                                     ship.systems.*, ship.hull, set ship.disabled / ship.destroyed, push sim.fx
                                     particles {x, y, vx, vy, life, maxLife, color, size}, and sim.addLog(...).
                                     Must respect ship.weaponsInhibited, ship.weaponsFree, ship.target and
                                     ship.systems.weapons. A ship with disabled or destroyed set fires nothing.
      render(ctx, cam, sim)          called after ships are drawn. cam.toScreen({x,y}) → {x,y} px, cam.zoom px per m.
      shipReadout(ship) → [{label, value, tip}]     extra rows for the ship panel (mount states, interceptors left)
      panelActions(ship) → [{id, label, tip, active}]  extra buttons; sim.engagementAction(ship, id) invokes onAction
      onAction(sim, ship, id)
      physicsNotes(ship, target) → [{title, body}]   rows for the Physics panel (beam spot, slug flight time…)
    }

Effect numbers stay abstract: a beam delivers energy on target that armour thickness absorbs; a slug delivers
kinetic energy on hit; an interceptor is a small craft with its own delta-v that point-defence beams engage.
Outcomes are systems integrity falling, a ship going disabled, or a ship destroyed.

Physics helpers already provided in `OD.P`: beamSpotDiameter(λ, R, D), beamIntensity(P, spot), slugFlightTime,
lateralDisplacement(t, a), interceptTime(relPos, relVel, speed), gravity, Tsiolkovsky.

## Renderer / UI
`OD.Render.draw(sim, cam, ui)` and `OD.UI` (HUD, tooltips, Physics panel). Tooltips: any element with
`data-tip="key"` shows `OD.UI.TIPS[key]` (string or function(ctx) → {title, body, formula}).

## Modes
Story: `OD.Story.chapters[]` (8). Campaign: `OD.Campaign` (11-node Jovian map, persistent fleet, saved in
localStorage under `od.campaign`). Skirmish: `OD.Skirmish.build(options)`.

## Headless harness
`node tools/harness.js` opens index.html in Chromium, runs the scenarios in `tools/harness.js` through
`window.OD.harness` (start(scenario), step(seconds), state()) and checks invariants.

## Bridge display and ship views (v5, 2026-09-19)
- `index.html` is a diegetic console: no cards or web buttons. Tokens on `:root` (`--glass`, `--line`, `--accent`,
  `--accent-ink`, `--display`, `--mono`, ...); `.glass` panels with corner ticks and scanlines; plain `<button>` is a
  flat key with corner brackets, `.primary` the accent key, `.active` a lit key, `.seg` a lit-underline segment
  control, `.menu-actions` a numbered console list (`.cols` for two columns), `#hint` and `#toast` docked bands.
  `body.screen-open` (set by `OD.UI.screen`/`closeScreen`) dims `#hud` under any screen. Key hints are `<kbd>`
  inside buttons; digits pick console entries, Esc backs out via `[data-esc]` or the primary key on pause,
  physics, help and hull screens; Enter dismisses a hint; V opens the hull view.
- Hull view (`OD.UI.hullView(id?)`, `hullKey(key)`): side / top / three-quarter views, prev/next ship, live numbers,
  callouts. Panel portrait `#pPortrait` (side view, redrawn every ~120 ms) opens it. Both draw through
  `OD.UI.drawHull(ctx, ship, cx, cy, lengthPx, view, extra)`.
- Ship art (v7, 2026-09-19 21:05 UTC): `js/shipart.js` (owned by the ship-render thread; BUILT by
  `assets/ships/build.sh` from `assets/ships/src/`, never hand-edited) is loaded between sim.js and render.js and
  exposes `OD.ShipArt` per the interface block at its top: `draw(ctx, design, opts)`, `bounds`, `callouts`,
  `stateFromShip`, `has`, `list`. `OD.Render.artReady(id)`, `artId(ship)` (a configurator design is passed as its
  class record) and `artOpts(ship, sim, extra)` wrap it. The map draws hulls ≥ 40 px (stations ≥ 60 px) with the
  art in view 'top', rotation −heading, no plume (render.js keeps its own plumes); below that, the built-in icon.
  Any throw sets `artBroken` and the built-in drawing takes over. `OD.UI.fitArt(ship, view, L, maxW, maxH)` probes
  `bounds()` at 120 px and scales the hull length down until the whole picture fits the box, so the panel portrait
  ('side', 86 px strip) and the hull view (picture box W×0.86 by H−116, leaving label lanes) never crop a station.
  Inspection views floor `state.heat` at 0.15 so radiators read orange. Hull-view callouts (`OD.UI.drawCallouts`)
  sit in four rows above and below the picture with elbow leaders (part → bus line outside the picture → label);
  labels never overlap and none is dropped for the stock seven hulls.
- Configurator seam: `js/configurator.js` (owned by the configurator thread, loaded after engagement.js, before
  main.js when present) exposes `OD.Configurator`: `mount(root, { designId, faction, detail, onSave(design),
  onFly(design, scenario), onBack() }) → controller { design(), load(id), destroy() }`, `installSaved()`,
  `register(design)`, `list/get/save/remove`, `toSpec`, `flyScenario`, `cost(design)`. Designs are class-shaped
  (`OD.Ships.CLASSES` keys) plus `custom: true`, `base` (stock hull id), stored under `od.designs`, registered under
  their own ids. main.js: `Game.installDesigns()` at boot and after save/fly, menu entry only when the module is
  present, `Game.configurator(designId?)` mounts it in a wide screen and destroys the controller on leaving; a test
  flight runs `startScenario(scenario, { mode: 'Skirmish', onEnd → configurator(design.id) })`. Skirmish lists
  installed custom designs after the stock hulls; campaign yards price them with `OD.Configurator.cost` (dry-mass
  curve as fallback) and `load()` strikes off fleet ships whose design no longer exists. ShipArt receives custom
  designs as their design object.

## Hosting (Netlify, 2026-09-19 21:35 UTC)
The game is served as a static site at https://orbital-declaration.netlify.app (site id 55a50651-682a-4724-8339-ec38fffbe224,
team emollick). Everything hosting-related lives beside the game and is owned by the deploy thread:
- `index.html` head: doctype and `<html lang>` (standards mode), viewport, description, Open Graph / Twitter tags,
  icons, manifest, `<meta name="theme-color">`, and the fonts inlined as `@font-face` from `assets/site/fonts.css`
  (Rajdhani 500/600/700, IBM Plex Mono 400/500, IBM Plex Sans 400–500 variable; latin plus Greek for Plex Sans;
  SIL OFL). No request leaves the site on first load. Keep the `font-family` names; add weights by adding files.
- `#boot`: a splash in index.html (title and "Loading the bridge") shown while the scripts download; `Game.init()`
  in main.js removes it before `showMenu()`. It reuses `.eyebrow`, `.title`, `.sub`.
- `netlify.toml`: `publish = "."`, security headers (a Content-Security-Policy with `script-src 'self'`, so NO inline
  `<script>` or `onclick=` attributes anywhere; inline `style=` is allowed), long immutable caching for `/js/*` (safe
  because the build stamps every script URL with a content hash) and for the fonts.
- `tools/build-site.js <out>`: copies the deployable files and rewrites `js/x.js` to `js/x.js?v=<hash>` in the copy.
  `tools/serve.js <dir>`: local server applying the netlify.toml headers; `OD_URL=http://127.0.0.1:8787/ node
  tools/harness.js` then runs the playtests against the built site. `404.html`, `robots.txt`, `manifest.webmanifest`
  and `assets/site/` (icons, `og.png` social card, fonts) complete the deploy.
- Deploying: the Netlify MCP connector's deploy-site operation returns an `npx @netlify/mcp` command to run inside the
  built folder; the Artifact link is republished from the same folder afterwards.

## Combat loop, threats, damage, sound and the bridge console (v8, 2026-09-19)

Ethan, after playing v7: no point defence, hard to see what is incoming, no interesting trade-offs or loops,
interceptor range unclear, ships should take specific damage, menus still feel like a webpage, and it should be
possible to examine and customise ships before launch. Point defence, interceptors and facing armour already
existed but were invisible; the rest was missing. This section is the contract for v8. Everything stays in game
vocabulary: armour, energy on target, hull integrity, interceptors, point defence, intercepted.

### The loop, in one page
A fight is a negotiation over **range**, paid for in **heat**, **propellant** and **exposure**.

- **Range decides who can hurt whom.** A beam spreads with distance (spot = 2.44 λR/D) and armour soaks a fixed
  rate, so for every pair (our beams, their facet) there is a *burn-through range*: inside it our beams put energy
  through that facet, outside it nothing gets through. Apertures and armour differ by hull and by facet (nose,
  flank, tail), so the same range can be safe for one side and lethal for the other. The bridge shows both sides'
  burn-through ranges on the bearing line as a ladder, so choosing a range is a real choice.
- **Facing is the cheapest armour.** Nose thick, flank middling, tail thin and carrying the drive. Coasting nose-on
  is free; braking toward the enemy shows the tail. Shown already; now hits land on the facet that was showing.
- **Slugs punish stillness.** A coilgun slug is unguided: flight time = range / speed, and a ship that has moved a
  few hull lengths by then is missed. Jinking defeats slugs and costs propellant every time; matching velocity at
  short range against a coilgun hull is eating slugs. The threat display shows each slug's time of arrival and
  whether it still meets the ship.
- **Interceptors are a limited, bursty resource against a rate-limited defence.** Bays never reload. Each
  interceptor has its own delta-v, so it reaches a target only inside a *launch reach* that depends on the closing
  geometry (shown as a ring). Point defence kills interceptors at a rate inside its own reach (a smaller ring);
  a salvo larger than what it can stop before arrival gets the rest through. So the loop is: read their point
  defence, pick the salvo size (2, 4, all), time it for when their sink is full or their radiators are out, or
  send salvos from two ships to arrive together. Reserve against the next fight.
- **Heat is the clock on everything.** Beams and point defence dump waste heat into the sink, the drive too.
  Radiators shed it and are the softest part of the ship; retracting them protects them and stops all cooling.
  A saturated sink caps the drive to a quarter and inhibits every mount. **Fire modes** make this an explicit
  trade: *Sustained* throttles the beams so heat in never exceeds what the radiators shed (weaker, forever);
  *Full* fires everything and the sink fills (stronger, then a forced cool-down); *Hold* keeps the beams cold
  (coilguns and bays still work). The panel says what each mode buys in plain words and numbers.
- **Aim points turn damage into a plan.** Beams and interceptors go for *Hull* (largest cross-section, default),
  *Radiators* (only while theirs are extended: cripple their cooling and they must retract and cook), *Drive*
  (only from the tail: cripple their manoeuvre), or *Mounts* (kill their beams one by one). A smaller part means a
  smaller share of the beam lands, so precision costs energy on target.
- **Specific damage with specific effects.** Every ship is built from components: drive, reactor, sensors,
  radiator panels, propellant tanks and each mount. A hit lands on a component exposed on the facet that was
  showing, biased by the shooter's aim point. A holed tank vents propellant (delta-v drains; a visible plume);
  a damaged drive cuts acceleration, and the turn rate half as far (the attitude thrusters carry the rest); a lost radiator panel cuts cooling; a damaged reactor caps
  the power to beams and point defence; damaged sensors widen every aim; a wrecked mount is gone. Each state
  shows on the hull art, in the damage report and in the log, so the player can read a ship's condition and
  decide whether to press, retreat or board.
- **What the player always sees:** everything inbound, with time to arrival and the ship it is aimed at; the
  point-defence reach and the launch reach as rings; the burn-through ladder; a one-line threat advisory; time
  warp dropping and a sound on every new launch. Nothing that can hurt a ship is invisible.

### Engagement additions (`OD.Engagement`, js/engagement.js)
    threats(sim, ship?)             → [{ kind: 'interceptor'|'slug', id, x, y, vx, vy, targetId, fromId, faction, color,
                                        eta (s until it reaches the target, null if it cannot), willHit (slug: its
                                        aim still meets the target if nothing burns), engaged (a point-defence
                                        mount is on it), hp (0..1) }]  with ship: only those aimed at it.
    threatSummary(sim, ship)        → { incoming, slugs, firstEta, pdMounts, pdRatePerMin, pdCanStop, level:
                                        'none'|'watch'|'warn'|'alert', text }   text is one plain sentence.
    reach(sim, ship, target?)       → { pd, launch, slug, beams: {nose, flank, tail}, their: { pd, launch, slug,
                                        beams: {nose, flank, tail}, facet } }  metres; beams.X is the range inside
                                        which this ship's beams together put anything through facet X of the target
                                        (a same-class hull when there is no target); their.* is the target's reach
                                        against this ship and their.facet the facet of ours they see now.
    fireMode(ship) / setFireMode(ship, 'full'|'sustained'|'hold')      (replaces holdBeams; 'sustained' throttles
                                        the beams to the radiators' margin so the sink never fills)
    aim(ship) / setAim(ship, 'hull'|'radiators'|'drive'|'mounts')      falls back to 'hull' when the part is not
                                        exposed (radiators stowed, drive not on the tail) and the readout says so.
    salvo(sim, ship, n|'all')        launches n interceptors at the target now.
    salvoEstimate(sim, ship, target, n) → { flightTime, reach (bool), theirPdCanStop, through }
    pdReport(ship)                  → { mounts, live, engaging, kills, ratePerMin }
    panelActions(ship)              offers 'launch2' | 'launch4' | 'launchAll' (only sizes still aboard) with tips
                                        carrying the estimate, plus 'fire_full' | 'fire_sustained' | 'fire_hold'
                                        and 'aim_hull' | 'aim_radiators' | 'aim_drive' | 'aim_mounts' (active flag).
    events(sim)                     → sim.eng.events: a ring of { t, kind: 'launch'|'incoming'|'pdkill'|'hit'|
                                        'through'|'wreck'|'destroyed'|'component', x, y, shipId, fromId, text }
                                        appended by update(); consumers read by index (eng.eventSeq counts).
    Damage hook: when OD.Damage exists, energy that reaches a hull goes through
    OD.Damage.hit(sim, target, { joules, facet, aim, shooter, kind }) and engagement.js touches hull and systems
    itself only as a fallback. Power: ship.powerCap (0..1, from OD.Damage) scales beam and point-defence power.
    Render: interceptors and slugs keep a minimum screen size (an interceptor a bright 3 px dot with a plume and
    a fading track, a slug a 2 px dot with a hairline trail) so they read at the zoom the fit uses; point-defence
    engagements are short flickering lines from the mount to the interceptor with a flash on a kill. The renderer
    and UI (render.js, ui.js) draw the time-to-arrival labels, rings and ladder from threats()/reach().

### Component damage (`OD.Damage`, js/damage.js; hooks in js/sim.js)
    init(ship)                      builds ship.components from the class: drive, reactor, sensors, radiator panels
                                    (2 small hulls, 4 destroyer/cruiser, 6 station), tanks (2–4 by propellant mass),
                                    one entry per mount. Each: { id, kind, name, hp 0..1, facets: [...], area }.
    hit(sim, ship, { joules, facet, aim, shooter, kind }) → { component, wrecked, hullLoss }
                                    hull budget = 1400 J per kg of dry mass (as before); picks a component exposed
                                    on that facet weighted by area and by aim; logs 'damaged' at 50 % and
                                    'wrecked' at 0 with the component's name and its effect; keeps ship.damage =
                                    { nose, flank, tail } (0..1 wear per facet) for the art; recomputes aggregates.
    aggregate(ship)                 ship.systems.drive / radiators / sensors / weapons stay the aggregates every
                                    other module reads; ship.powerCap from the reactor; a tank below 50 % vents:
                                    propMass drains (logged once, fx puffs) until the tank is empty or repaired.
    update(sim, dt)                 venting and any timed effect. Called by the sim after thermal.
    report(ship)                    → [{ id, kind, name, hp, state: 'ok'|'damaged'|'wrecked'|'venting', effect }]
    artState(ship)                  → { damage, systems } merged into the ship-art state.
    toRecord(ship) / fromRecord(ship, rec)   campaign persistence ([{ id, hp }] on the fleet record);
    repair(ship, fraction)          campaign resupply.
    sim.js: makeShip calls OD.Damage.init when present and restores spec.components; substep calls
    OD.Damage.update after thermal; ship.systems keeps its meaning.

### Sound (`OD.Sound`, js/sound.js)
Synthesised with WebAudio, no assets. `enabled` (localStorage `od.sound`, default on), `setEnabled`, `unlock()` on
the first gesture, `play(name)` for key, open, back, alert, launch, incoming, pd, hit, wreck, boom, boarding,
victory, defeat, tick, warp; `ambient(level)` a bridge hum with a reactor drone that rises with the selected
ship's heat load; `watch(sim)` called each frame reads new log lines and engagement events and plays the right
cue, throttled so a broadside is a texture, not a strobe.

### Bridge console (`OD.Bridge`, js/bridge.js)
The menus are drawn on the tactical canvas as part of the bridge, not as styled lists in the DOM: a console
frame with corner brackets and hairlines, a header strip, a scanline sweep, titles that type in, keys drawn as
bracketed labels that light on hover, numbered entries, the live demo scene behind, a slowly rotating hull
(ShipArt with an orbit camera). Sounds through OD.Sound. Screens: menu, chapters, briefing, hangar (pre-launch),
skirmish setup, pause, debrief, and from v12 `situation` (the war in plain words: `OD.Story.situation`, `sides`,
`warSoFar`; shown before chapter 1, from the chapters screen's W key and the story pause entry, via
`OD.Game.showSituation(opts)`). The configurator, physics panel, help and hull view stay DOM screens.
    OD.Bridge.open(name, model)  close()  active  current  draw(ctx, cam, dt, t)  pointer(type, x, y, e) → handled
    key(e) → handled  resize()   model carries the data and callbacks; main.js supplies every action.
    An offscreen DOM mirror (#bridgeA11y) holds real buttons for the current screen's actions so keyboards and
    screen readers work; digits pick entries and Esc backs out, as before. Phone layouts stack.
**Hangar (pre-launch)**: every start (story, campaign, skirmish) passes through it: the player's ships listed,
one selected with a rotating three-quarter view, key numbers (delta-v, acceleration, armour by facet, mounts,
radiators, sink) and callouts; keys: Inspect (hull view), Refit (opens the configurator on that hull; a saved
design of the same hull family replaces the ship for this mission, name and id kept), Launch, Back. In the
campaign a refit is allowed at a yard or port and costs the difference in requisition.

### Status of the v8 work
- Deploy A (2026-09-19, about 22:10 UTC): engagement additions (threats, reach, fire modes, aim points, salvos, point-defence
  report, events ring), the damage module and its sim/campaign hooks, the map threat display (time-to-arrival labels,
  edge markers, countdown ring), reach rings, the burn-through ladder, the panel's Threats band, Fire control (Beams
  B, Aim T, Salvo L / shift-L / A, Weapons free W), point-defence and burn-through rows, the Damage report, chapter
  hints for the new mechanics, and the v8 harness scenario. `js/sound.js` and `js/bridge.js` are stubs in this deploy:
  the harness prints a skip line for each and the game runs without them.
- Deploy B (2026-09-19, about 22:40 UTC): the sound module (js/sound.js, OD.Sound.init from Game.init; SND key and the
  menu's Sound segment), the bridge console (js/bridge.js: menu, chapters, briefing, hangar, inspect, skirmish, pause,
  debrief drawn on the canvas; main.js supplies every model and keeps a DOM fallback, Game.domBridge, when the module is
  absent; OD.harness.start passes hangarDone so playtests skip the hangar), the pre-launch hangar with Inspect / Refit /
  Launch on every start, the campaign slipway (Refit fleet key at an owned yard or port, Game.refitFleet), and the
  review fixes: honest interceptor time-to-arrival (closeTime solver shared with salvoEstimate), the ladder honouring
  the aim point, T.dartKill 6 MJ so a point-defence mount stops about 2.5 interceptors a pass, mounts gated on
  ship.mountHp per mount (a wrecked mount falls silent; wrecked point defence stops shooting), venting tanks read as
  venting, repairs to 50 % stop leaks, the ambient hum self-expires, log cues survive the 400-line log cap.
  Check scripts: tools/engagement-check.js, damage-check.js, sound-check.js, bridge-check.js, main-check.js,
  bridge-shots.js (screenshots into tools/bridge-shots/).

## Sensors, signature and decisions (v11, 2026-09-20)

Ethan, after playing v10 (01:58 UTC): "it still feels like no interesting choices. also isn't detection and sensors
interesting? also keep thinking of the newbie player." Read as: the trade-offs exist but never reach the player as
decisions; add detection as a real mechanic; teach everything in play. This section is the contract for v11.

### Why the choices did not land
In v10 a fight is: pick a target, pick keep range, watch. Fire modes, aim points, salvos and radiators sit behind
keys in a panel section and nothing ever asks the player for a decision at the moment it matters. Two fixes:
1. A **sensor and signature model** so that closing, burning, radiating, firing and looking all have a price in
   *being seen*, which is the price the other trade-offs were missing.
2. A **decision layer** that recognises the handful of moments in an engagement where a real choice exists and puts
   it in the player's path: a docked band with two or three keys, each with its consequence in plain words and
   numbers, a recommended option marked, time warp dropped to 1×, the sim still running. The keys act through the
   existing orders and fire control; nothing new to learn beyond "read, choose, watch".

### Sensor model (`OD.Sensors`, js/sensors.js, loaded after damage.js and before sim.js)
No stealth in space, but a track has a quality. Every ship radiates; a sensor resolves a source by its power over
range squared. Physics basis: a source of power P at range R gives a signal ∝ P / R², so the range at which a
sensor of sensitivity S resolves a firing solution scales with √P: `R_sol = S · √(P / 1 MW)`.

Signature power `P` (W), `signature(ship) → { total, plume, radiators, hull, active (bool), word }`:
- plume: `0.5 · thrust · exhaustVelocity · throttle · T.plumeFraction` (0.02). A torch at full thrust is gigawatts:
  a solution from anywhere in a scenario.
- radiators: what the panels actually shed right now, not their rating: `ship.radiatorPower()` while the sink holds
  heat (`ship.heat > 0`), otherwise `min(ship.radiatorPower(), idleHeat + driveHeat·throttle·systems.drive + extraHeat)`,
  because a sink at zero means the panels only pass on the heat coming in and run cool. So panels out on a ship that
  has coasted for a minute add only its idle heat (a few MW, 'warm'); right after a fight they glow at their full
  rating (tens of MW, 'radiating'); panels in add nothing and cool nothing.
- hull: `idleHeat · T.hullLeak` (0.5): the floor. A cold, coasting corvette is about 1 MW.
- active: true while the ship's active sensor is on (see below); word: 'cold' | 'warm' | 'radiating' | 'burning' |
  'active' for the panel.
Class fields (js/ships.js, per class): `sensorRange` S (m: corvette 250 km, frigate 300, destroyer 350, cruiser 450,
lancer 300, freighter 120, station 500) and `activeRange` (corvette 800 km, frigate 1000, destroyer 1500, cruiser
2000, lancer 1200, freighter 0, station 2500). Custom designs inherit from `base`. `ship.systems.sensors` scales S.

Track quality `q` (1..3, continuous) of a target for an observer faction:
- `q_range = 1 + 2 · clamp(ln(R_far / R) / ln(R_far / R_sol), 0, 1)` with `R_far = 4 · R_sol` computed against the
  best live sensor of the faction (tracks are shared within a faction).
- dwell: `q = min(3, q_range + 0.5 · min(1, dwell / 600))`, dwell in seconds the faction has held q ≥ 1.5 on it.
- the target's active sensor on → q = 3 for everyone (it announces itself). The observer's active sensor on and
  R < activeRange → q = 3 on that target. Friendly and civilian ships are always q = 3 (transponders).
- words: q < 1.8 'contact' (bearing and rough range, class unknown), < 2.7 'track' (class known, position fuzzy),
  else 'solution'. `posErr = R · 0.12 · (3 − q)^1.5`, `velErr = posErr / 120`.
    OD.Sensors = {
      init(sim)                      per-faction track tables; called after the sim is built
      update(sim, dt)                each substep before the AI; keeps dwell, the ghost offsets (a slow-drifting
                                     pseudo-random offset per track scaled by posErr, so a fuzzy contact wanders
                                     smoothly rather than jittering), active-sensor heat (T.activeHeat 2 MW into
                                     extraHeat), and sim.log lines: 'contact' when a hostile first appears,
                                     'track' when its class resolves, 'solution' when q reaches 2.7, and 'lost'
                                     only when it falls back under 2.4 (hysteresis, so a track hovering at the
                                     threshold does not flap; at most one line per target per 60 s; kind 'info',
                                     speaker 'Sensors').
      signature(ship)                → as above
      track(sim, factionOrShip, target) → { q, word, posErr, velErr, dwell, source: 'passive'|'active'|'friendly',
                                     est: { pos, vel } (the ghost), classKnown }
      quality(sim, observerShip, target) → q (number, cheap)
      perceived(sim, observerShip, target) → { pos, vel } (est when q < 2.7, else the truth)
      setActive(ship, on) / isActive(ship)   ship.activeSensor (bool); a ship with activeRange 0 cannot
      seenFrom(sim, ship) → { solution, track, by, word }   the ranges at which the best hostile sensor gets a
                                     solution / a track on this ship with its signature right now, and who
      solutionEta(sim, observerShip, target) → seconds until q ≥ 2.7 on the current closing rate and dwell, or null
      report(sim, ship)              → [{ label, value, tip }] rows for the panel
      contacts(sim, faction)         → [{ ship, q, word, est, posErr, classKnown }] for every non-friendly ship
      tuning T                       plumeFraction, hullLeak, activeHeat, dwellBonus, dwellTime, solutionQ 2.7,
                                     trackQ 1.8, ghostDrift
    }
sim.js hooks (owned by the sensors worker): `makeShip` copies sensorRange/activeRange from the class (custom
designs from `base`) and sets `activeSensor = false`; `substep` calls `OD.Sensors.update` right after the boarding
step and before the AI; the AI and the autopilot receive `OD.Sensors.perceived()` for hostile order targets when the
module is present (a fuzzy contact is steered for where it seems to be). The harness scenarios must still pass.
AI (js/ai.js, sensors worker): a computer ship goes active when it has a hostile target with q < 2.7 inside 1.3 ×
its doctrine range and wants to fire, and drops active once it holds a solution and no hostile is inside 0.6 × its
doctrine range; it keeps its radiators in while a hostile with beams is inside that hostile's burn-through reach
against it (OD.Engagement.reach when present) and the sink is under 85 %.

Engagement effects (js/engagement.js, engagement worker, code and numbers only): the shooter's faction track on the
target scales pointing wobble by `1 + T.trackJitter · (3 − q)` (trackJitter 3, and each round's lead draws
its own error from the track's velErr); coilguns hold fire below
`T.slugSolutionQ` (2.5) with the readout saying 'no solution'; slugs are aimed with the estimated velocity, so the
aim error grows with velErr × flight time; interceptor salvos need q ≥ 2 to launch (the dart's own seeker finishes
the job); the AI discipline uses the same numbers. physicsNotes gains 'Track quality' (q, wobble factor, spot).

### Decisions (`OD.Decisions`, js/decisions.js, loaded after engagement.js and before configurator.js)
A decision is a short-lived object the module raises when a situation arises for a player ship, once per
(ship, kind, target) until the situation has lapsed for `T.cooldown` (600 s). Options act through existing APIs
(sim.setOrder, setRadiators, OD.Engagement.setFireMode/setAim/salvo, OD.Sensors.setActive, weaponsFree, jink).
    OD.Decisions = {
      init(sim)  update(sim, dt)     sim hook after Engagement.update; keeps sim.decisions (open, newest last) and
                                     sim.decisionSeq; a decision closes itself when moot (its until() is true)
      current(sim) → decision | null  the one to show: the newest open decision for the selected ship if any,
                                     else the newest open one
      refresh(sim, d)                recomputes every option's detail line (numbers move while it is open)
      choose(sim, id, key)           runs the option, logs 'Decision: <title> → <label>' (speaker 'Bridge',
                                     kind 'good'), closes it; dismiss(sim, id) closes it silently
      kinds                          ordered list of { kind, teach } where teach is the one-paragraph explanation
                                     shown the first time that kind appears (the UI remembers in od.taught)
    }
    decision: { id, kind, shipId, targetId, title, text, options: [{ key: '1'|'2'|'3', label, detail,
                recommended (bool), act(sim) }], until(sim) → bool, openedAt, teach }
Kinds and triggers (all for player-faction, non-station ships; numbers from Guide.plan, Engagement.reach/
salvoEstimate/threatSummary, Sensors.seenFrom/solutionEta, heatForecast-style thermal maths):
1. approach — a hostile contact exists beyond 2.5 × the larger burn-through reach and the ship is holding, or 15 s
   after a start with hostiles beyond 1 000 km. "How do we close on X?" (1) Burn hard: arrive in T, Δv D, and the
   plume gives them a solution from anywhere. (2) Coast in at 1.5 km/s: arrive in T', Δv D', we stay a contact
   until R km. (3) Hold and watch. Recommended: coast when T' < 45 min, else burn.
2. sensors — the target is a contact or track (reported q < 2.7, the same threshold the mounts hold below) inside
   1.5 × our largest burn-through reach and weapons are free. "No solution on X." (1) Go active: solution in ~20 s; every hostile gets a solution on us. (2) Stay
   passive: solution in N (solutionEta) or 'not at this range'. (3) Close to R_sol. Recommended: passive when N <
   5 min, else active.
3. radiators — a hostile with beams is inside 1.3 × its burn-through reach against us, our radiators are out and the
   sink is under 90 %. "Stow the radiators?" (1) Stow: signature falls from A to B (solution from X → Y km), sink
   full in N. (2) Keep them out: exposed, radiating. Recommended: stow when N > 4 min.
4. range — closing under an order, range within 15 % above the larger of our bite and theirs. "Pick the range."
   (1) Hold at X: only our beams bite (their facet). (2) Close to Y: both bite; our facet vs theirs. (3) Open to Z:
   nobody bites; wait for their sink. Recommended: (1) when ours > theirs, else (3) when their sink is filling, else (2).
5. salvo — the target enters our launch reach with ≥ 2 interceptors aboard. "Launch now?" (1) Launch n: k through
   their point defence. (2) Wait for their sink: full in T, then their point defence is capped. (3) Hold the bays.
   Recommended: (1) when k ≥ n/2, else (2) when T < 6 min, else (3).
6. cripple — a hostile target is disabled or its drive is wrecked inside 300 km. "X is crippled." (1) Board: match
   and close, ~T min, she is ours. (2) Finish her: full fire. (3) Leave her: retreat / next target. Recommended: board.
7. slugs — the first slug salvo that will hit this ship, with jink off. "Slugs inbound, T s." (1) Jink: Δv per
   dodge, they miss. (2) Hold still: keep matching (boarding, nose-on). Recommended: jink.
8. heat — the sink passes 80 % with beams at full. "Sink at N %." (1) Sustained fire: P at what the radiators shed.
   (2) Extend radiators: exposed, seen from X km. (3) Break off. Recommended: (1).
The decision text is one plain sentence; detail lines are short with the numbers; `teach` is the paragraph a newcomer
reads the first time ("A solution is a track good enough to aim by. Active sensors buy one at once and tell everyone
where you are; passive sensors need range and time.").

### Status of the v11 work (2026-09-20, about 04:10 UTC)
Built by three Opus workers (sensors: js/sensors.js, sim.js hooks, ai.js, autopilot.js seenTarget, ships.js fields,
tools/sensors-check.js; decisions: js/decisions.js, tools/decisions-check.js; fire control: js/engagement.js track hook,
tools/engagement-check.js), each reviewed and fixed in the same pipeline (16 findings closed), plus this thread's
render.js, ui.js, main.js, story.js and the harness scenario. Departures from the contract above, all deliberate:
- `signature().radiators` is what the panels shed right now (full rating while the sink holds heat, else the heat
  coming in), so a coasted-out hull with panels out reads 'warm' at a few MW and 'radiating' only after a fight.
- Log lines use hysteresis (a solution holds to 2.4, a track to 1.5) and at most one line per target per 60 s.
- `track()` records carry extra fields (`source`, `passive`, `by`, `byName`, `est`); the UI reads `source` and the AI
  reads `passive` (the quality the side would hold with nothing of its own lit). `seenFrom().by` is a name string.
- Beams hold fire below the same track threshold as the coilguns (T.slugSolutionQ, raised to 2.7 to match the
  'solution' word), drawing no power while held, so a designated contact does not light the shooter up. A passive
  track fades by at most 0.6 q per minute when its source dims (dead reckoning), and rises at once.
- A disabled hostile can be engaged by a player ship (the computer still leaves a cripple as a prize); the bays obey
  the shooter's own state (adrift, weapons tight, inhibited launch nothing); Full fire fills the sink.
- The approach decision is raised toward the nearest warship when nothing is designated and re-aims itself when
  the player names a hull; every option designates. A player freighter gets the slugs and radiators questions only.
  The heat question also fires on a ten-minute forecast, and only when there is a lever to pull.
- The UI marks a decision kind as taught when it is answered or dismissed, not when it is drawn; the map key hides
  while a decision band is open; the hint band moves up above the band.
- Chapter 2 starts both corvettes with an empty sink, Sabre with panels in and her computer asleep (trigger: Larkspur
  burns, comes inside 500 km, or 15 min), so she is a bare contact and the player chooses who lights up first.

### Review loop, round 1 (2026-09-20, from about 04:20 UTC)
Five reviewer agents (fun, graphics, realism, interestingness, engagement) played the assembled build read-only and
reported ranked findings; the fixes below went in before any deploy (standing rule from 04:12 UTC: every build loops
until no lens has a blocking finding, at most three rounds). Thread-owned changes:
- Panel: a hostile's Range and Closing come through our track on her below q 2.7 ('~1 000 km ± 200 km', closing
  '~120 m/s', 'unknown' at contact quality); the Signature, Track and Solution rows show only while a hostile is in
  play (chapter 1 no longer talks about being seen by nobody); 'Beams in arc', 'On target', 'Through armour' and
  'Effects' are Full-only rows; the heat forecast steps the sink with the radiator temperature law
  (P.sinkForecast) and can say 'settles near 60 %'; Threats lines wrap instead of clipping; sensor ranges print as
  whole km; boarding numbers come from OD.Sim.BOARD.
- Band: opaque (97 % plus a backdrop blur) in its own blue (--decide) so amber stays the ISA colour; the hint band
  hides while a decision is open (the map key stays); the time warp a band interrupted comes back when it closes
  unless the player moved it or the fight ended; another player ship's decision is a toast only ('select her to
  answer') and opens as the band when she is selected; digits do nothing while the band is not showing.
- Phone: the band is capped at 38 vh with the teach paragraph behind a 'Why?' key, the ship panel hides while a
  decision is open so the map stays on screen, the map cell keeps at least 180 px, the top bar drops Show all, Hull
  and the mode word.
- Screens: Physics and Help scroll with a visible thin scrollbar and bottom padding; the map dims to 12 % behind
  a screen (it used to read through).
- Camera: the HUD inset now includes an open band, refreshed every 400 ms, so a fit or follow lands in the clear
  part of the map (render.js uses it for fitAll and follow).
- Story: chapter 1's brief says 'under two hours' like the marker; the tanker's drive component is repaired when
  she is handed over (the damage hint no longer displaces the last tour step, and the damage hint waits while a tour
  step is queued); chapter 2's hints carry an `until` each and a queued hint whose `until` already holds is skipped;
  Sabre wakes when her sensors hold a solution on Larkspur (seenQ ≥ 2.7), inside 500 km or after 15 min, rather
  than on any throttle; the victory text says 'out of the fight'; 'anywhere' claims about a plume now say 'everyone in
  the engagement' (physics box quotes the plume in GW, light lag in ms).
- Help: fire keys W B T L A listed; Match speed named as the button is; boarding at under 25 m/s.
Worker changes in the same round (each Opus, one module each):
- Autopilot and AI (autopilot.js, ai.js, tools/autopilot-check.js): a retreat or an opening keep-range course is
  integrated 30 min under gravity and, if it would come inside the body's radius plus a margin, rotated to the
  clearing tangent nearest the wanted direction (`guardCourse`, `bodyFloor`, `closestPass`); the AI commits when a
  target has been held 5 min with nothing landed for 4 min and the range not closing (intercept to 0.7 × its beam
  reach, else slug or launch reach), released by a hit, a new target or a cripple, and a side with the board to
  itself presses at once; a new order `{ type: 'approach', target, speed, brakeAt }` burns once to the closing speed,
  coasts cold, brakes at brakeAt (default 2.5 · v²/2a) and holds at brakeAt/2 (`OD.Autopilot.brakeRange`, `ORDERS`
  includes it; guide.js and the panel know it as 'coast in'); a coasting or holding hull keeps its nose on the
  target's perceived position so spinal mounts bear (`TRIM_FRACTION`: a trim burn under 35 % waits for the turn).
- Heat, sensors and the sim (physics.js, ships.js, sim.js, sensors.js, tools/sensors-check.js): a radiator is only
  as hot as the sink behind it, T = 290 K + 710 K · min(1, load / SINK_KNEE) with SINK_KNEE 0.6, so
  `ship.radiatorPower()` runs from 0.7 % of the rating on an empty sink to the rating from the knee up and
  `ship.radiatorRating()` is the ceiling (texts, the sustained budget); `P.sinkForecast(heat, cap, rating, heatIn,
  horizon)` steps that law and returns tFull, tEmpty, settle and loadAt(t); the signature's panel term is
  radiatorPower() with no clamp (the 1 J cliff is gone). Warship radiator areas were trimmed (corvette 330 m²,
  frigate 600, destroyer 1 080, cruiser 2 500, lancer 300) and sink capacities halved (15, 30, 60, 150, 12 GJ) so
  that full fire with the drive lit beats the rating by 16 to 18 % and fills a sink in 22 to 30 min, a burn alone
  settles near 60 %, an idle hull near 17 %, and stowed panels under burn fill a corvette in about 8 min; the lancer
  is the exception (her drive is her heat; full fire sits at 0.98 × rating). `ship.lastHeatIn / lastHeatOut /
  lastExtraHeat` are recorded each substep. Tracks carry `bearingErr` (rad), `rangeErr` (m), `los` (rad) and `fade`
  (s), posErr = max of the two, the ghost lies along the line of sight (T.crossFraction 0.04, T.errCap 0.6) and a
  faded track's box grows with the velocity error and ½·a_max·t²; the contact log line quotes bearing to 5° and a
  two-figure range with ± at contact quality, a two-figure closing at track quality, exact only with a solution.
  `OD.Sim.BOARD = { range: 3000, speed: 25, time: 90 }` is the one boarding rule. 'Damage control' logs the first
  hull loss of a mission on a player ship.
- Gunnery (engagement.js, tools/engagement-check.js): the slug lead is solved against both hulls' fall in the body's
  field (three passes) and each round carries a falling ghost of the track, so a slug aimed at a coasting or holding
  hull over Io arrives (46 of 46 used to read 'will miss'); a round fired in a substep is not stepped in it; 'Gunnery'
  logs our hits and intercepts, rolled up per ship per 20 s; the launch note quoted the 80 MJ charge (round 2: the hit is the contact energy), not the
  interceptor's kinetic energy; the sustained budget uses radiatorRating(); salvoEstimate is clamped to the bay, not
  below it; the mounts row says 'no target · 1 mount' and 'wrecked' only when a mount is.

- Decisions (decisions.js, tools/decisions-check.js, rewritten): approach (burn / coast / hold) costs both ways
  from one model, prints Δv in km/s, issues the 'approach' order for 'Coast in' (a short burn, then dark, brake and
  hold at the standoff) and lights 'Burn hard' when time matters (an escape objective, a guarded ship under fire, a
  fleeing target); it is raised at 1.05 × the larger bite range, not 2.5 ×, so a hull parked just outside the guns is
  a question. sensors only when the solution is more than 2 min out, we are not burning and the plume does not pin
  us; radiators only when the panels are 40 % or more of our signature or her beams reach them, never while
  burning, and never for a change under 10 %; range never prints a zero bite ('Hold at X' = 0.9 × our bite, a no-bite
  board offers closing or coilguns); salvo offers the smallest saturating size and a 0-through launch is a warning,
  never lit; cripple uses OD.Sim.BOARD and 'Leave her' retreats; heat's title says what the sink is doing, Sustained
  is never lit under 15 %, panels in offers Extend, 'Beams cold, stay on her' is new, Break off sets beams to hold,
  and a settle under 85 % with panels out is no question. Two new kinds: defend (close on / screen / hold) when a
  guarded ship has inbound or is under beams, and aim (radiators / hull) once per ship. Globally: a pressing guard
  (open / hold / break off are never lit while a neutralise objective is open and we are not outgunned, or a guarded
  ship has inbound), (ship, kind) cooldowns doubling on dismissal, unchanged-text suppression, the same kind across
  ships collapsed into one card ('· 3 ships'), a 60 s gate on freighters and other ships' questions, GW above 1 GW,
  'not on this course' for never, every forecast through sinkForecast, no log line for a no-op answer, no card
  after the outcome. The check plays chapter 4 and chapter 2 recommended-only to victory and a 3-a-side to no defeat.
- Cripples (engagement.js, decisions.js): a player ship holds fire (beams, coilguns, bays) on a hull that is out of
  the fight ('holding: she is out of the fight', logged once per target) unless the cripple decision's 'Finish her'
  set `ship.finishTarget` (`OD.Decisions.finish(ship, id)`; 'board' and 'leave' clear it); the Gunnery hit lines stop
  once the outcome is set.
- Map (render.js): every label goes through one per-frame layer with a priority (ship name > threat countdown >
  ring caption > telemetry), measured and pushed or dropped so none overlap and all stay inside the free rectangle;
  a ship's name, class, bars and telemetry are one block at its hull with a leader line when pushed; ring captions
  start at the point nearest the free rectangle and walk round the ring until clear, a ring that misses the
  rectangle draws nothing; one style per family (uncertainty a soft fill, reach dashed, signature dotted, order
  long-dashed, selection solid thin, burn-through ticks); the uncertainty is a sliver along the line of sight when
  the track carries bearingErr / rangeErr / los; follow centres the ship in cam.inset's free rectangle (main.js
  refreshes the inset every 150 ms from the panels, the open band and the toast); amber is ISA only (brake path,
  unidentified contacts, the disabled ring and our interceptor reach are blue or blue-grey); the ladder and 'their'
  reach draw only for a hostile target; the approach order draws its hold ring.

### Review loop, round 2 (2026-09-20, from about 05:20 UTC)
The same five lenses played the round-1 build. Fun's verdict was 'not yet', the other four 'fix the blocking items
first'; the blocking and major findings went in as below, the leftovers are listed at the end. Thread-owned changes:
- Warp: an alarm that pulls the warp to 1× gives it back after 8 s (`Game.pullWarp(w, holdMs)` / `restoreWarp`),
  unless the player moved it, the fight ended, a screen or a band is open; an event slow-down holds 6 s.
- Band: a decision raised for any player ship opens the band (the eyebrow names her, 'click to select her'), so
  every question is answerable from wherever the player is looking; a toast says whose it is when she is not
  selected. The hint band and the map key give way to it; on a phone the band scrolls inside 46 vh with the options
  before the teach paragraph and a fade at the foot.
- Map: when the selected ship has drifted off the map for 10 s and the player has not dragged for 30 s, the view
  refits (`keepShipsOnMap`); the HUD inset counts the hint band, the toast and the phone panel, so fit and follow
  land in the clear part; the seen-from ring sits at the range a hostile actually holds a solution from when a
  dead-reckoned track outranges the signature ('held as a solution from X · by Y'), and PINNED names her.
- Panel: bite rows about a hostile come through the track ('· range unknown' below a track); the transfer plot
  is redrawn for narrow panels (two panes, labelled decades, 'delta-v needed, km/s', a two-line legend); vitals and
  key-value cells wrap instead of clipping; the phone log keeps three columns at 11 px.
- Story: chapter 2 can be lost (the protect objective fails when Larkspur is disabled, captured or destroyed;
  chapter 4 protects her the same way); its hints wait on what the player does (a target set, a decision
  answered, W pressed, the track sharpening, the sink cooling) with a time fallback each, tour steps go ahead of
  queued hints and a hint whose `until` already holds is skipped; a prize hint appears when Sabre is out of the
  fight and not yet boarded; the first hull loss logs 'Damage control' only once the hull is under 99.5 %.
- Heat: `P.sinkForecast` takes the ship's radiator temperature as its peak (the panel, the physics box and the
  configurator use it; the configurator's heat rows chain each row's settle into the next); the physics box pins
  the heat-in figure from `ship.lastHeatIn`.
- Bridge: the inspect screen keeps its bottom row for the scale bar and the view caption, so hull callouts never
  land on them.
- After the first full run: a neutralise chapter with nothing of ours left that can fight (every player warship
  disabled or captured) is lost 60 s later ('Nothing of ours can fight any more'), not forty minutes later when
  the last freighter is boarded (sim.js); a decision band that opens over the selected ship pans the map at once
  so she sits in the clear part, same zoom (`keepShipsOnMap`, also run by the harness step; a never-dragged map
  counts as long since dragged); fuzzy vitals drop the tilde, which the panel font drew like a minus ('3 600 km
  ± 250 km', '≈ −6.7 km/s'); the toast for another ship's decision is the card's own title when it names her.
Worker changes in the same round (each Opus, one module each):
- Sensors (sensors.js, tools/sensors-check.js): `seenFrom` reads the hostile's live track (dwell and all) and
  solves the same law as `track()`, so the ring caption, the Signature line and the radiators card agree with the
  track to 2 %; it also returns `held` / `heldBy`, the range a hostile actually holds a solution from; the contact
  log line prints the ghost range from the holding ear with ± and a bearing to 5°, a track line rounds, only a
  solution prints exact; a faded track's box is the last fix reckoned forward, floored at what the reported q gives
  and capped without ever resetting (no more snap-back), and a floor reading is no fix.
- Gunnery (engagement.js, tools/engagement-check.js, 145 checks): interceptors brake for the terminal run
  (guidance builds only the closing it can shed, cruise about 4.05 km/s, a near-dry brake from thrust over mass by
  the rocket equation) and arrive at `dartTerminal` 1 035 m/s, so a hit is ½·m·v² at contact (84 to 133 MJ measured)
  and point defence gets about 1.8× the dwell on the braking round; `dartLife` 700 s keeps the launch reach at
  2 659 km. Slugs carry their mass and hit for ½·m·|v_slug − v_target|² at arrival (5 kg head-on: 141 MJ, was 40),
  printed in the coilgun note. A hostile's beam reach is her capability (`powerOf`), not her fire mode: with
  panels stowed 'sustained' scaled to zero, which read as 'never' on our ladder and silenced her mounts too, so
  chapter-2 corvettes finished untouched; the AI no longer picks a mode that yields nothing. `trackJitter` is 3
  and every round's lead draws its own error from the track's velErr.
- Autopilot, AI and skirmish (autopilot.js, ai.js, skirmish.js, tools/autopilot-check.js, 27 checks): the
  balance probe found the 'unwinnable' fleet fight was not player versus computer: with mirrored orders the loser
  followed the track-error seed (fixed in sensors.js below), and the one real gap was a number: the AI held
  station with a 0.45 keep-range band while a bridge order got 0.12, so the player's ships trimmed the range every
  minute, burning, turning off target and staying pinned while the computer sat cold with its nose on them.
  `STATION_BAND` and `HOLD_HORIZON` are now the autopilot's, shared by both sides; in band it burns only when the
  range (not the closing rate) will leave the band inside 900 s, then matches velocity once. An approach is keyed
  on type and target so a re-issued card cannot restart the push; the coast allows one 20 s correction (on a
  solution, if the predicted miss at brakeAt exceeds 15 %, never in the last third, logged once) and a coast that
  misses wide brakes at closest approach instead of sailing past. An order on a hostile that is out of the fight
  drops to hold, clears the target and logs once (boarding runs and finishTarget exempt). The AI escalates after
  10 min of board-wide quiet post-commit: active sensor, inside boarding range, everything free. Skirmish mirrors
  the opening scatter. Mirrored 3-a-side, hull lost JC/ISA: 1.48× before, 1.04× after. New exports:
  `approachRun`, `dropDeadOrder`, `STATION_BAND`, `HOLD_HORIZON`; `OD.AI.thermalDoctrine`, `sensorDoctrine`,
  `boardQuiet`, `escalateRange`, `T.ESCALATE_QUIET`. With even tracks a mirrored fight is a grind, not a stall
  (both sides land hits throughout), so the check's claim is now what the fight does: by 40 min one side is past
  half its hull and it is decided inside an hour (seeds 3 / 7 / 11: 1 540, 2 420, 2 360 s; 1.23×). The coast
  correction is announced once, by the real hull, when `apply()` flies it: guide.js's planner looks ahead with a
  nameless stand-in hull, which used to talk on the bridge channel as 'undefined'.
- Fleet bays (main.js, engagement.js): the player commands one ship at a time; every other player ship with weapons
  free carries `ship.autoBays` (set by `Game.handBays()` before each sim step) and runs the computer's launch
  doctrine only (`onDoctrine(ship)` = ai or autoBays gates `launchInterceptors`; `aiDiscipline` does nothing on a
  player-faction hull, so the panels, fire mode and aim the bridge or a card set always stick), logging one
  Gunnery line 'the computer launched N interceptors at X' throttled like the hit lines; `launchSalvo` books the
  last salvo on every launch so a hand salvo is never doubled inside `T.salvoGap`; the commanded ship's bays empty
  on the player's word alone (L, A, the launch question; the salvo card is not raised for an autoBays hull). The
  weapons-free tip and Help say so.
- Decisions (decisions.js, tools/decisions-check.js, 119 checks): defend's 'Close on' re-targets an existing
  approach order and stays cold, every option says when it lights the drive, and defend waits 60 s
  (`T.defendGrace`) after an approach card about the same attacker; 'Break off and cool' prices its burn with beams
  cold and panels out, caps it at 150 s and a sink of 0.85, drops to hold at the end (`breakBurn`, `endBurns`,
  `legView` folds burn-then-coast into the forecast; a 20 min check peaks at 0.50); a new `withdraw` kind at
  hull ≤ 0.5 while closing or under fire (break off / behind a sister / press, breaking off recommended unless
  nearly won) keeps Larkspur alive in chapter 4 (recommended-only wins at about 1 778 s with her at 0.73); the
  heat card drops the signature clause when the plume dominates, prints distinct sink lines, names the heat
  source and quotes the settle from `sinkView`; boarding is never recommended while un-neutralised hostiles
  outnumber our shooters; aim weighs hull left and time, collapses across hulls and re-raises when the answer
  changes; new kinds `sink` (ours saturated: extend / break off / ride it out, urgent, no cooldown, re-raised every
  2 min while the lock holds) and `capped` (hers: press or hold); `panelsOwned` gives one kind the panels and no
  radiators card is raised before anyone is in beam or launch reach, nor at or above the knee, nor when the
  panels-in forecast fills the sink inside 15 min (Stow is recommended only when both hold); the range card's
  zero-bite text is honest ('only we bite, and we give her our tail'); the coast leg is priced with the panels as
  they will be and the opening burn is 'a solution for everyone'; cards about another hull are complete
  third-person questions (`thirdPerson`, `retitle`); every settle threshold is a share of `P.SINK_KNEE`
  (`settleShare` 0.9) and `ship.radiatorTemp` is passed to `sinkForecast`; no salvo card for an autoBays hull.
  The check replays the fun reviewer's skirmish recommended-only: no player sink saturated over 3 min, beams fire.
- Sensors again (sensors.js): the ghost's offset is no longer one draw per (faction, target): every watcher wanders
  at the same rates (`T.ghostDrift` 240 s, `T.ghostScale` of the box) with only the phases drawn from the hash and
  smootherstep-blended between draws, so a seed's advantage decays over four minutes and mirrored pairs read the
  same (24 seeds: first-5-min mean error differs 2.9 %; drift 2 % of the box per second).
- Map labels (render.js): every placed label, stack and ship block gets a ground plate (rgba(7,11,20,0.85), 4 px)
  and 14 px of horizontal clearance from any box on the same text row; `Render.labelCount` counts them.

### Review loop, round 3 (2026-09-20, from about 07:10 UTC; the last round before the deploy)
Five lenses again on the round-2 build. Blocking themes: the cards quoted ranges the sensors did not know
(realism), a boarding disarmed the ship for the rest of the fight and the first heat card contradicted the coast
(fun), the recommended withdraw lost chapter 4 on every seed (interestingness), the map lost the hull being fought
(graphics). Thread-owned changes:
- Map: `keepShipsOnMap` watches the selected ship, her target and every hostile inside 2 500 km, at the positions
  we draw them (`Game.viewPos`: the ghost for anyone not ours; `fitAll` uses the same), with a 12 px margin; any of
  them off the free rectangle for 10 s of sim time (so it holds at any warp and in a scripted run) refits that
  group at half the free rectangle, and a group huddled into a quarter of it refits once per two minutes; a wheel
  zoom counts as a pan (30 s of quiet before any refit); when the free rectangle moves by more than 60 px (a band
  opening on a phone) the group is refitted at once; a panel the layout has hidden measures 0 × 0 and adds no
  inset; the camera fits into a free area down to a quarter of the canvas (was 35 %, which made a phone with a
  band open fall back to the whole canvas); no chips, plates or scale bar draw under the console; on a phone a
  hull's block carries one telemetry line; the burn-through ladder waits for her class (track quality).
- Panel: the Signature line reads 'Cold: a track to them from X, a solution from Y'; a lost or captured hull's
  panel shows the navigator strip and the damage report only; 'They see' wraps; a sink that cannot settle says
  'full in'; the option cards align at the top with 'recommended' on its own line; the toast uses the text face;
  the log fades its top 12 px so a half row is never sliced; a phone hint clamps to three lines.
- Physics screen: the sensor example says pinned / firing solution (×4^0.15) / track (×4^0.6); the heat box says
  the drive is open cycle (why a 16 GW plume and a 30 MW heat load sit one box apart); the configurator's heat rows
  use the hull's own radiator temperature.
- Sim: a boarding that held fire (`ship.heldFireForBoarding`, set by the cripple card) gets its weapons back and
  drops an order still flown against the prize when the prize is taken or the party recalled (`freeAfterBoarding`,
  logged); 'Damage control' logs every tenth of hull after the first hit; an objective remembers when it failed.
- Debrief: every objective with its state, and one line saying what lost it ('Lost at 23m 10s, when JCV Pale
  Harbour was disabled.'); 'Ships lost or out of the fight' counts disabled and captured hulls.
- Story: chapter 2's convoy runs 640 and 820 km ahead of Larkspur, nearer Sabre than her beams reach, so holding
  station leaves it to Sabre and the approach question costs something either way; the fire-control hint waits
  until someone is inside 800 km (or ten minutes); the neutralise objective holds 60 s after it is met (`hold`
  on an objective, sim.js) so the prize hint has a window; the chapter-1 tour and chapter-2 hints say 'tap' and
  'the panel below the map' on a phone.
- Teaching (engagement lens): a plain hint gives way after 90 s when others wait behind it (tour steps exempt),
  so the band and keep-range hints are no longer starved; a hint's anchor inside the ship panel is scrolled into
  view on a phone; the hull a hint marks is kept in frame at once (`keepShipsOnMap` watches `OD.Guide.mark`); Help's
  control bullets have a touch version; the debrief counts the whole side (escorts and freighters, not only the
  commanded hull); an alarm inside a warp hold no longer pushes the return out again.
Worker changes in the same round (each Opus, one module each):
- Gunnery (engagement.js, tools/engagement-check.js, 125 checks): one Gunnery line per player hull per 60 s while
  hostile beams land on her ('Under fire: ISV Sabre's beams on JCS Larkspur's flank, 494 MJ through this
  minute': the top shooter by energy and the facet), silent when nothing lands; incoming slugs and interceptors
  roll up per 20 s ('has taken 4 slugs through her flank from ISV Sabre'); the interceptor note is computed from
  the arrival mass (80.3 MJ dry, 88.6 MJ with reserve aboard, 'a quarter more closing is half again the hit').
- Decisions (decisions.js, tools/decisions-check.js, 152 checks): every card quoting a hostile takes range, closing
  and the transfer and arrival figures from our track on her (`trackRange`, `rangeSay`: 'about 1 000 km, ±120 km',
  exact only at solution quality); `coastPlan` clamps 'brake at' below the range and issues the matching order;
  break-off is priced in time (`clear = burn + (1.25·bite − R − opened) / speed`) and past the horizon says 'this
  buys distance, not cover' and is not recommended as cover; the heat cards read the live approach order's own
  legs (`approachLegs`, `coastOwnsPanels`), so the panels stay in while a cold coast is planned unless the sink
  fills before the brake, the range cost is stated and mounts are offered only when a mount makes heat; a hold
  re-asks after about 125 s while the range is not closing; `thirdPerson` conjugates auxiliaries and names the
  hull for ours / us; 'Board her' sets `heldFireForBoarding` and a weapons-free ship with no target is re-asked;
  withdraw recommends break-off only when it clears the bite inside the hull's remaining life, else a sister,
  else press (chapter 4 recommended-only wins again); the sensors card fires on the coast leg and below solution
  quality, plume or not, and sink and capped fire on live hulls; boarding is gated on the closing time against
  the hulls still shooting; `quietFight` re-raises range or aim after 4 min of a falling hull; a hold range the
  target's closing defeats is not offered; 'her beams fall short; her coilguns and bays still reach'; the salvo
  card prices the trade ('10 of 12 for 1 arrival') and stops recommending below a sensible share; third-person
  radiators cards name the hostile.
Carried (not fixed this round): the physics plot's right gutter and last tick label; Help in one column on a wide
screen; the fleet list's bars on a lost hull; merged threat chips on a phone; the heat card's arithmetic where the
decisions worker did not reach it (listed in its report).

### Bridge, map and teaching (render.js, ui.js, main.js, story.js: this thread)
- Map: a non-friendly ship draws at its ghost position with an uncertainty ring (posErr) and no hull art below
  q 2.7; below 1.8 it is a '?' contact with 'contact · bearing · ~range'; the selected ship shows its own signature
  as a ring labelled 'seen as a solution from X km' (their best sensor) and 'PINNED' with the reason when a hostile
  holds a solution on it; an active sensor draws a slow sweep. Everything else (threat labels, ladder, rings) is
  unchanged.
- Panel: Essentials gains a Signature line under the vitals ('Cold: a contact to them until 300 km' / 'Burning:
  pinned from anywhere' / 'Radiating: solution from 1 200 km') with the Active key [S]; the Target section gains
  'Track' (contact / track / solution, q) and 'Solution in'. Full adds the numbers (signature MW by source, their
  sensor, our sensor). Physics panel: a 'Being seen' box (R_sol = S·√P formula with the ship's numbers).
- Decision band: a docked band above the hint band, drawn in the console style (eyebrow 'Decision · <kind>', title,
  sentence, option keys with 1/2/3 and their detail lines, the recommended one lit, 'Later' on Esc); digits answer
  it while it is open (warp keys yield), time warp drops to 1× when one opens; the first of each kind shows its
  teach paragraph. Decisions raised for a ship other than the selected one show a one-line toast with the ship's
  name; selecting the ship shows the band.
- Teaching: chapter 2's brief and hints teach contact / track / solution and the cold approach (both ships start
  with an empty sink, Sabre with her panels in and her computer asleep until Larkspur burns, comes inside 500 km or
  15 min pass, so she is a bare contact at first and the player chooses who lights up first); chapter 4 teaches
  'no solution, no slugs'; the help screen gains a 'Seeing and being seen' paragraph; TIPS for every new row.
- Harness: a 'sensors and decisions' scenario (signature words, q falls with range and rises with dwell, active
  announces, a coasting cold ship is a contact at 1 000 km, at least three decision kinds raised in a fight, choose()
  acts, the panel rows and the band render).

## Plain writing, a clear war, ships that move (v12, 2026-09-20)

Ethan, after playing v11 (17:37 UTC): the text reads like a language model wrote it ("The heat sink is filling from
the burn and settles where the radiators shed what the drive makes. In a fight you will want them in, and then the
sink is all you have." is not good writing); the nature of the conflict is unclear in story mode; at close zoom he
should see the ship extend radiators, fire weapons and so on. This section is the contract for v12. A sixth
reviewer, writing, joins the review loop from this build on.

### The writing standard (every string a player reads)
Plain, concrete, human. Short sentences. Name the thing and the number. Say what is happening, what to do, and why,
in that order. Second person for the player; characters speak like people on a working channel.

Rewrite anything with these tells:
- a metaphor that hides the mechanism ("the sink is all you have", "the arithmetic is not kind", "the physics has
  not changed"); say the mechanism instead;
- clauses chained with "and then", "so that", "which means"; two sentences instead;
- rhythm for its own sake: a sentence that exists for its cadence, a closing flourish, a wry last line;
- "it is not X, it is Y"; "not because X but because Y"; triplets ("cold, cheap and slow"); hedges ("somewhat",
  "a little", "perhaps"); "the moment", "the whole game", "everything else is optional";
- em-dash or semicolon chains; colons that introduce a reveal; a sentence that starts with "Remember that", "Note
  that", "In other words", "Think about"; rhetorical questions;
- abstractions where a number fits ("takes a while" → "takes 90 s"; "reach out farther" → "reach 600 km");
- personified hardware ("the ship has stopped choosing", "the sink never fills") unless a character is speaking.

Ethan's example, before: "The heat sink is filling from the burn and settles where the radiators shed what the
drive makes. In a fight you will want them in, and then the sink is all you have." After: "The burn is heating your
sink. With the radiators out it holds steady. In a fight you pull them in, so the sink fills, and a full sink means
no more firing."

A hint or card: first line what is happening (with the number), second what to do (the key or button), third why.
A briefing: who you are, where you are, why you are fighting, what happens if you lose, then the plan. A debrief:
what happened, what it changed for the war. A tooltip: one or two sentences, the mechanism and the number. A log
line: who, what, number. Keep the game's terms fixed and spelled one way: delta-v, heat sink, radiators, track,
solution, contact, signature, interceptors, point defence, coilgun, slug, beam, armour, hull integrity, boarding.

Inventory: scratchpad/strings/extract.js lists every string of three or more words per script with its line
(scratchpad/strings/<file>.txt). Rewrite by walking the list, then re-run the extractor and read the new list as a
player would. Check scripts and tools/harness.js match log lines by substring: change the check with the string.

### The war, in plain words (story mode)
A newcomer knows within the first minute who they are, who they are fighting, why, and what is at stake:
- A situation screen (bridge console `situation`) before chapter 1, two or three short sentences, also reachable
  from the chapters screen ("The war so far") and from the pause screen. It builds on the lore in story.js: 2211,
  the Jovian system; the Jovian Compact (JC, the moons: Callisto's seat of government, Ganymede's Galileo Regio,
  Europa's Conamara ice farm, Io) has declared independence, "the Declaration", from the Inner Systems Authority
  (ISA), which ran the moons as a customs territory; the Authority answers with customs enforcement, blockades and
  sieges by a squadron of a few dozen ships; the player, Commander Halvorsen, has the corvette JCS Larkspur and by
  chapter 7 a task group with the Compact's one cruiser, JCS Harkness. Plausible motives on both sides: the
  Authority is losing its tariff income and the yards that the moons feed; the moons are paying for a fleet they
  never see and for water and ice priced from Earth.
- Every briefing opens with who, where and why in its first paragraph. Every debrief says what the outcome changed
  for the war, victory or defeat, in one sentence after the body. The situation text and the "war so far" line
  (`OD.Story.situation`, `OD.Story.warSoFar(n, outcome)`) live in story.js.

### Ships that move (close zoom, hull view, portrait)
At close zoom on the map, in the hull view (V) and in the panel portrait, the art shows what the ship is doing,
driven by sim state and never by cosmetic timers:
- radiators extending and retracting with a visible transition (`ship.radiators.state` already moves over
  `radiatorDeployTime`; the art draws the transition);
- the drive plume scaled to throttle (the map's own plume at every zoom; the art's plume in the hull view);
- beam mounts slewing toward the target and firing with a visible flash and beam; coilgun slugs leaving the
  mount; interceptor bays launching; point defence firing at inbound threats; tanks venting; wrecked parts dark.
- Interface: `OD.ShipArt.draw` keeps the cached hull sprite (radiator, heat, hull, damage and systems buckets;
  radiators in finer steps so the transition reads). A live overlay `OD.ShipArt.overlay(ctx, design, opts)` draws
  the transient effects (flashes, muzzle streaks, launch puffs, point-defence bolts, vent jets, mount slew) at the
  projected positions of the parts, from `opts.fx` = `OD.Engagement.artFx(ship, sim)` = `{ mounts: [{ id, kind,
  bearing (rad, ship frame), firedAt (sim s), target: {x, y} }], launches: [{ t }], pd: [{ t, toward: {x, y} }],
  vents: [{ tank index, rate 0..1 }] }`, ages measured against `opts.simTime`. render.js calls overlay after draw
  for hulls at art size; the hull view runs live (no pause) and calls it every frame; the portrait too.
- The hull view stays live during a fight: opening it no longer sets warp 0; it keeps the current warp and the map
  keeps stepping (main.js's loop steps behind the 'hull' screen and no other; ui.js drawHull passes `live: true` from
  the hull view and the portrait and calls overlay after draw; the map key names the seen ring 'a solution on us').

### Ownership for the v12 pass (one writer per file)
- Art worker (Opus): assets/ships/src/* (rebuild with assets/ships/build.sh, never hand-edit js/shipart.js),
  js/render.js, the artFx hook in js/engagement.js.
- Story worker (Opus): js/story.js, js/bridge.js, js/main.js, tools/bridge-check.js, tools/main-check.js.
- Combat text worker (Opus): js/decisions.js, js/damage.js, js/sensors.js and their check scripts.
- Ship text worker (Opus): js/configurator.js, js/campaign.js, js/skirmish.js, js/ships.js, js/guide.js,
  js/autopilot.js, js/ai.js, tools/autopilot-check.js.
- Panel text worker (Opus): js/ui.js.
- The thread: js/sim.js, js/physics.js, js/util.js, tools/harness.js, SPEC.md; after the art worker: the hull view
  and portrait wiring in ui.js, then js/engagement.js strings and the hull family blurbs through Opus workers.

### Status of the v12 work (2026-09-20, about 19:15 UTC, before the review loop)
- Delivered by five Opus workers plus the thread as the ownership list says; the hull family blurbs by a sixth.
- Found on the way: tools/decisions-check.js's "recommended-only play wins chapter 4" was stochastic (about one
  run in six lost, on v11 as well as v12) because the jink in autopilot.js drew from the page's Math.random while
  the rest of the fight draws from the engagement's seeded generator; the jink now draws from that generator when
  there is one, so a scripted fight replays the same way. The art feed itself was checked pure (artFx, artOpts,
  overlay stubbed in turn: byte-identical runs); one write to module scratch in artFx was removed.
- Cosmetic particles (sim.js fx, damage.js vent fx) still use Math.random: they touch nothing the fight reads.


### Review loop, round 1 (v12, 2026-09-20, from 19:27 UTC)
Six Opus reviewers played the assembled build (fun, graphics, realism, interestingness, engagement, writing); their
reports are the scratchpad's review/<lens>/round1-v12.md and the fix plan review/FIX1-v12.md. What they found, and
what changed, by file (the thread's files first; the workers' below as they report):
- Writing: one decision option promised fire a full sink stops; regex third-person cards ("Hold her own station");
  the full-sink rule worded seven ways, one wrong; four names for burn-through; "panels" against "radiators" and
  floating verbs; the configurator's sink line did not parse; house jargon (dart, booked, tells) on the physics
  screen; flourish endings in four briefs. → one sentence for the sink rule everywhere ("A full sink holds the drive
  to a quarter and stops every mount, point defence included, until it drains"), "burn through" / "burn-through
  range" only, "radiators" with extend / stow only (ui.js rows, tips, the Stow key, the radiator status word;
  render.js ladder labels; sim.js log; configurator; guide; main's strapline), the configurator sink line as three
  sentences, physics notes in player terms (engagement worker).
- Engagement lens: chapter 1 could not be lost (a rendezvous whose target is gone stayed open for ever; sim.js
  now fails it); the hull view was live but blind and mute; a hostile's hull view gave away her exact numbers; the
  card's sentence froze while open; the debrief did not name the next chapter; phone tour hints clamped to three
  lines; the debrief's first-transfer row overlapped (bridge worker); console strings ("fights" for missions).
  → ui.js: the hull view is a place to stand mid-fight (on a laptop it takes the map's rectangle only, with the
  fleet list, ship panel, log and decision band live around it; a live line under the picture: threat sentence,
  target with range and closing, fire mode, sink; every gameplay key works there, an open decision takes the digits
  and Esc first, V closes it; on a phone a question closes the view first); hostile hulls gated on the sensor
  picture (contact: no picture, every row a dash, "Unknown hull"; track: class, length, exhaust, thrust, radiators,
  a plain picture without damage or fire; solution: everything); #dcTitle/#dcText refreshed with the details; phone
  hints scroll instead of clamping; main.js restoreWarp works behind the hull view; the debrief says "Next: Picket
  Line · Ganymede orbit · 2 April 2211. <first line of the brief>" with a "The war so far" key; "armour and hull
  only · hull 53 %" instead of "no damage"; "Eight missions", "Back to the mission".
- Fun lens: decisions opened behind the hull view (fixed by the layout above and z-index 30 on the band and toasts
  while it is open; the HUD was at 6 % opacity under any screen, which had also made it a stacking context);
  zooming in lost the ship (main.js followAtArtZoom: once a wheel or pinch zoom draws the selected ship at 40 px the
  camera follows her, with a toast; F releases); threat edge-markers on one pixel (render.js keep-labels slide a
  row until clear); Board her cancelled by the chapter ending (story worker); own beams never reported with a
  number (engagement worker); chapter 2 never threatens Larkspur (story worker); "PINNED by" tag → "ISV Sabre has a
  solution on us"; the hull-view tip says the picture is live.
- Graphics lens: beams left the hull's centre (render.js muzzleOf / hullEdge helpers; the art module gains
  muzzle(); the engagement renderer starts each firing mount's segment at its muzzle and ends an inbound beam on the
  hull's edge); the ship's label block printed across a 400 px hull (blockOf anchors at 0.55 × the drawn length,
  14 to 170 px; the turning arc scales too); hull view and portrait lit by the fight's sun (fixed key light az −50
  el 35, plume drawn, sim clock); sprite cost and light bucket, effect ceilings, vent direction (art worker 2);
  phone decision band clipped (band to 56vh with a "scroll for the rest" cue while there is more below; toasts move
  to the top while a card is open); phone hull view callouts two rows a side.
- Realism lens: chapter 3's siege was impossible (station sink 8 000 GJ; now 1 100 GJ in ships.js, so nine hours
  stowed at 30 MW is 88 % and the last 12 % is about 73 minutes; the story worker moves the chapter's heat literal
  onto the class); beams firing with nothing through (engagement worker holds them and says why); part texts quoted
  tank counts the damage model does not build (blurbs worker: counts from damage.js, radiator ratings from the sink
  law); "a contact from" on the physics screen printed the track range; skirmish names of its own (the story's
  hulls stay in the story). Carried: the configurator's own tank count (prop / tankUnit) is a third rule.
- Interestingness lens: chapter 4 on the lit option alone loses at some reading delays; the withdraw card
  recommends cover that arrives after the armour is gone; salvo cards promise arrivals that never come and price
  the collapsed card for one ship; a no-op defend card; a mispriced sensors card; Board her never pays out;
  zero-value options on the board; 29 cards in a 43-minute skirmish (all decisions.js, a logic worker after the
  text worker; Board her with the story worker).
- Workers' round-1 fixes, as reported: decisions text (Opus): thirdPerson()/voiced() and the verb tables deleted
  for voiceOf(ship, third) with a hand-written third-person reading of every string in all 13 kinds ("Hold
  station"; "JCS Larkspur keeps the approach she is already flying, now aimed at ISV Sabre, so her drive stays
  dark"); the sink, heat and Keep-them-cold cards say the coilguns and bays keep firing until the sink fills and
  then nothing fires; "as soon as" for "the moment"; six decisions-check regexes moved to burn-through / Hold
  (our )?station. Engagement and damage (Opus): burnHold() gates the beams when the range is past the burn-through
  of the facet she shows (round 1 exempted the radiators aim; round 2 removed the exemption) and the panel status says "holding: out
  of burn-through range (232 km)"; our beams get the one-a-minute joules roll-up on the target ("JCS Larkspur put
  117 MJ through ISV Sabre's flank this minute") and the repeat line waits 60 s per target; eng.beams records carry
  from/to and renderBeams draws one segment per firing mount from OD.Render.muzzleOf, ending short of the target
  by OD.Render.hullEdge; damage.js prints no "0 km/s lost so far" the instant a tank is holed; engagement-check
  134 ok, damage-check ok. Carried into round 2 (fixed there as R-1): beams aimed at extended radiators outside
  burn-through burned for nothing. Blurbs (Opus): tank counts from damage.js
  tankCount (corvette 2, frigate 3, cruiser 4, lancer 2, freighter 4, destroyer 3), the station's 6 radiator panels,
  the frigate's point defence as 2 lasers feeding pairs of domes, and every radiator line "shedding up to N MW while
  they are out, at their full 1 000 K only once the sink is over 60 %"; dumps in scratchpad/v12/blurbs.
- Story and bridge (Opus): chapter 2's hints name the live contact range and the cold solution range from the
  sensors (about 350 km against a dark drive), the band keys are their own hint, the keep-range and facing hints
  are separate, a hint says V watches the ship live; Sabre leaves the freighters for Larkspur while Larkspur is
  inside Sabre's burn-through of the facet she shows (20 s in, 30 s out hysteresis, a comms line) and goes back
  when she is not; a boarding ordered from the card holds the neutralise objective open (300 s, unlimited while a
  party is across) and warSoFar carries a prize line when Sabre is captured; chapter 4's physics hint gives 67 s at
  300 km; chapter 5 ends on the measured four-minute brake; chapter 1's heat hint leads with the live sink figure;
  the situation's economics follow the fiction (tariffs on what the moons ship inward, the price of their ice; the
  blockade cuts the moons off from each other and from the reactors and parts only the inner system builds);
  chapter 3's station heat follows the class capacity. bridge.js: on a phone the two sides sit above the ship
  picture; on a laptop the situation flow is centred with a larger, lower hull; the debrief draws m.next; a stat
  whose key and value overflow the column gets the row. decisions-check 152 ok, harness green; main-check's
  debrief regex now accepts "Next: <title>".
- Autopilot (thread): a jink needs a hostile that can still shoot, and the last 30 km of an intercept are flown
  straight, so a boarding run settles alongside (with jink on, the range had wandered 6 to 68 km and the prize was
  never taken). Checked: an intercept from 1 040 km on a disabled Sabre is alongside at 660 s and the party
  crosses at 642 s (scratchpad/v12/board-approach.js).
- Ship art (Opus, core.js rebuilt): OD.ShipArt.muzzle(design, opts, mount) → {x, y} in draw()'s canvas frame for
  the same opts (null when the mount is culled or the sprite is not cached; a beam answers the end of the trained
  barrel, a coilgun the rails); light buckets 20° and one cold sprite render a frame (opts.frame from
  Render.artOpts), later misses drawing the nearest cached bucket; pxUp(frac, lo, hi) ceilings proportional at
  large hulls (900 px hull: beam stub 64 → 117 px, flare 11 → 16, bolt 38 → 90, launch travel 62 → 243); the vent
  jet on the tank's outward normal, turned about the hull axis into view when it would project under 0.6.
  Measured with five hulls coming about at warp 4 over 140 frames: cold sprites 123 → 93, frames paying for more
  than one 33 → 6, evictions 51 → 21, frame p95 47.5 → 35.9 ms. art-check adds muzzle (102 mounts, 20 culled), the
  cap and Render.muzzleOf checks. Checked on the map: a cruiser at 420 px fires three separate beams from her
  turrets (scratchpad/shots2/18-beam-muzzle.png).
- Decision logic (Opus): decisions-check gains a chapter-4 sweep at reading delays of 0, 10, 20 and 30 s (4 of 4
  victories under harness stepping; under 1 s sim stepping delay 0 still loses Larkspur at 481 s, carried); event
  cards hold a 12 s minimum life and a spent card stops blocking the band; withdraw prices cover in time and
  recommends it only when the hull is actually behind, and a break-off that turns our tail says so ("the run turns
  our tail to her: 4 cm against 20 cm on the nose"); salvo priced for the group that launches, "We have 6 aboard,
  so nothing we send gets through", no card when nothing saturates; defend skips when it would re-fly the coast
  already aimed at the attacker; the sensors card says the flash is seen at any range and is not recommended
  while the plume already pins us; dead options dropped and a card left with one live option closes and logs it;
  the repeat gap is per hull and a superseded card spends neither gap nor count; the radiators card prices the
  stowed sink against the burn about to be flown; numbered titles rebuild on refresh; Hold and watch prints the
  closing rate; option details capped at three clauses with the rest behind Why?; the range card prices the facet
  a hold shows and never recommends a hold that turns our tail. Chapter 2 wins on the recommended option alone
  again (with the gated Sabre trigger). Cards before and after: scratchpad/v12dec/.

### Review loop, round 2 (v12, 2026-09-20, from 21:33 UTC)

The six reviewers re-checked their round-1 findings (52 of 62 fixed outright, the rest partly) and found 51 new
items, seven of them blocking: the recommended option alone lost chapter 2 at reading delays 0 and 10 s under 1 s
stepping and 10 to 30 s under 5 s stepping, and chapter 4 at 0, 5 and 15 s under 1 s stepping, while the
reading-delay check passed a stalemate because it only looked for 'defeat'; the boarding prize could not be
collected (the objective held 300 s against a 376 s approach, and the next card cancelled the run silently); the
withdraw card priced the hull's life off a 20 s trailing average and lit "Press on" on the option that ended the
mission; the salvo card promised arrivals point defence would stop; the aim card said "inside our burn-through" 30 %
outside it while the lit option burned a third of the sink for nothing; chapter 1's defeat debrief said Larkspur was
lost over a Larkspur at 100 %; and the hull view printed its part list on the log on a laptop and the whole HUD
through the sheet on a phone. Fix plan by owner: scratchpad/review/FIX2-v12.md.

Thread fixes (ui.js, main.js, sim.js, sensors.js, render.js, ships.js, index.html):
- Hull view layout: on a laptop the sheet is the map's rectangle (left 244, right 328, top 38, bottom 176) and ends
  above the decision band and the hint, whose heights bandLayout publishes as --band-h (a ResizeObserver on both);
  the picture takes the room left (flex column: views, picture, live line, part list in a 4.6 em scroll box, one
  part per line), the class line clamps to two lines, the stats column scrolls, the Close key is gone (the eyebrow
  says "V or Esc closes"); beside the view the band keeps its lesson behind Why? as on a phone; on screens under
  860 px tall with a card open the part list and the class line hide and the picture keeps 140 px; a floor of
  100vh − 320 px keeps the view from collapsing. The phone keeps the dimmed HUD (the opacity and pointer rules moved
  into the laptop query), V does not open over a decision there ("Answer the question first. Esc leaves it for
  later."), and the phone toast sits under the band (--band-bottom) instead of across it; on a laptop a toast sits at
  the bottom of the open view, not across its title.
- Contact-quality hull view draws two centred lines and no caption, scale bar or view name; the class line says what
  we know and why ("We hold a firing solution on her, so this is everything." / "We hold a track on her: the class
  and her radiators, nothing more." / "A bearing and a rough range, nothing more."); the corvette's blurb no longer
  advises the enemy (ships.js `advice` is appended for our own hull only); a hostile's live line is measured from the
  ship we command ("about 940 km, ±110 km from us · about 400 km, ±110 km from JCV Pale Harbour"), two figures with
  the error under solution quality; the fire clause reads "beams full · …" with the live forecast from the fire row.
- The Why? paragraph refreshes with the card; the digits 4 to 9 do nothing inside the hull view (1 to 3 are views,
  so no digit sets the warp there; the header keys do).
- Debrief: the "Lost at…" line names the hull that is gone, the objective's target when that is the one lost
  (sim.js records `lostHow` = "hit Callisto" on impact): "Lost at 1h 54m 19s, when JCV Long Meridian hit Callisto."
- The situation screen's one key says where it goes: "Back to the chapters", "Back to the pause menu", "Back to the
  debrief" (Continue only before chapter 1).
- Zoom follow: from 10 px of hull on a zoom-in, the selected ship if she is on screen, else the on-screen hull
  nearest the zoom point, else the selected ship wherever she is (a wheel aimed at empty space has already lost
  her); the toast is unchanged.
- One first-contact line: sim.js's own contact log stands down when the sensor ladder is loaded, and the ladder names
  the ship whose ear holds the contact ("JCV Pale Harbour has a contact bearing 25°, range 370 km ±120 km. Class
  unknown.", "Track: ISV Coriolis, a destroyer at 1 300 km ±45 km from JCS Bastion.", "Solution on ISV Coriolis at
  1 044 km from JCS Larkspur."); no closing rate is printed under solution quality (tools/sensors-check.js follows).
- Labels: a hull longer than half the map's short side keeps its label block in the map's clear top-left corner
  (render.js blockOf `corner`), sliding down behind any block already there, with no leader line.
- Help screen: "X extends or stows the radiators." / "Stow them with X when slugs are on the way and extend them as
  soon as the shooting stops."; the string inventory (scratchpad/strings/extract.js) now reads the text inside HTML
  literals, which had hidden 96 sentences from the lists.
- Not reproduced: "the first comms lines print over the log on a phone" (engagement 6): the shot shows the log itself
  scrolled to its newest line under its top mask, not a toast.

Ship art (assets/ships/src, rebuilt into js/shipart.js by build.sh):
- G-4: a venting tank draws on any facing: the vent loop no longer culls a mark facing away (alpha floored at 0.35);
  63 of 63 tank cells change pixels (27 were blank), and art-check has a check for every tank of every hull.
- G-6: the one-cold-render-a-frame cap is unconditional: a frame that has paid for a render serves the nearest
  sprite in hand, falls back to the same hull in another state (cache keys carry a shape), and draw() returns false
  when it holds nothing of that hull; a hull waiting for its first sprite has the frame's render reserved for it.
  First frame of a fight 238.7 → 25.2 ms (eight hulls at 176–39 px), hulls appear one a frame over 5–8 frames.
  Callers honour the false: render.js draws the built-in hull and fins for that frame (useArt drops, drawFins),
  ui.js's drawHull draws the silhouette (drawn = draw() !== false) and skips the overlay.
- R-7: the station's radiator farm text says what the 612 MW margin is for ("The habitat itself makes 30 MW of heat.
  The margin is for the reactor and for ships alongside.").

Engagement (Opus worker E; engagement-check 145 ok, damage-check ok):
- R-1 (sim half): burnHold() holds for every aim point on the burn-through range of the facet she shows with that
  aim (the radiators exemption is gone; reachOne already scales the emitted power by the aim's share, so the hold
  string and the "Our beams burn through" row come from one number). Chapter 4, "Her radiators" at 889 km: firing
  0 at every sample, her panels untouched, the sink pays only for the drive (was 28.7 → 51.8 % for nothing). The
  Aim radiators tip says the narrower aim burns through at a shorter range, so close in before taking it. The
  soak-drop alternative was rejected: damage.js takes hull off for every joule regardless of aim, so an
  unarmoured radiators aim would open hulls out to the 5 000 km reach cap.
- R-3 / W-10c: sinkWords(ship) (exported as E.shared.sinkWords) gives the fire-mode row and the hull view's live
  line the live forecast: "full · the sink settles at 17 %", "full · the sink fills in 17m 32s".
- W-5: the number-free "beams through" event line is gone for beams; the joules roll-up is the only report of our
  beams (slugs, interceptors and point-defence kills unchanged).
- F-8: the pending per-target roll-up flushes before "Holding fire" and before "is out of the fight", in the same
  second, so nothing trails.
- R-4, with the reviewer's diagnosis corrected: the beams keep their power under thrust (powerOf is only the
  damage cap); the burn-through range falls because the drive shakes the mirror (T.jitterBurn: pointing error
  ×(1 + 2·throttle)), a third to a half at full throttle (nose 650 → 347 km, flank 1 027 → 549 km on a solution;
  194 → 73 km on chapter 1's track). The physics screen prints the ladder at the other end of the throttle and the
  sentence "the drive shakes the mirror, so the pointing error is ×3 at full throttle and every range above falls
  with it. Cut the throttle before you shoot."; the same sentence (E.shared.throttleTip) is on the Status and On
  target row tips in engagement.js and, from the thread, on the two burn-through row tips and the physics heat box
  in ui.js. Not the reactor wording the reviewer proposed.
- Carried: damage.js puts radiator panels on the flank facet only, and aimEffective falls back to the hull only when
  the panels are stowed, so the radiators aim is still offered from a facet where it cannot bite (the status now
  says "holding: her nose armour is too thick at any range", so nothing is wasted); a facet test in aimEffective is
  the fix, left for the next pass because it moves the aim card's ground truth.

Story and bridge (Opus worker S; main-check 40 ok, harness green; probes in scratchpad/v12/story/, README there):
- I-N1 (story side): Sabre starts with her sink 30 % full (a picket lying cold with the panels in since before dawn:
  40 minutes of 2 MW idle heat), and the brief says so ("A long fight goes to the ship with the emptier sink."); 30
  not 40 because at 40 % the residual track after an active sweep reads 'track' (q 1.94) and the harness's ghost
  check fails. She leaves the freighters only when Larkspur is inside her burn-through AND inside 1.5 × her
  doctrine range (375 km): before, a tail-first brake (4 cm tail, 1 452 km reach) pulled her off at 560–650 km for
  250 s of free fire. Once in it and hurt (hull < 35 %, drive < 30 % or dv < 2.5 km/s, the ai.js break-off lines)
  the hand keeps her on Larkspur: handed back to her computer she ran (657 → 5 858 km by 2 600 s, a lighter hull
  out-accelerating our keep-range) and the chapter never ended. The commitment line carries the range. Sweep
  scratchpad/v12/story/ch2-sweep.js (delays × cadences × seeds, victory only): 12 of 36 before, 30 of 36 after on
  the story side alone; the residue is in the cards (worker D).
- I-N6 / F-3 / E-2: the prize window is the card's own promise: the autopilot's alongside estimate + 90 s across +
  60 s, clamped to 300–900 s; a run still making ground inside 50 km holds the chapter open past it, a party across
  holds it as long as it takes; a run is any of ours flying an intercept on Sabre, so a card cancelling
  heldFireForBoarding no longer decides it; the objective's hold went 60 → 120 s so the cripple card has a window;
  on lapse: "The prize run ran out of clock. JCS Larkspur is still 220 km from Sabre." Board ordered at 515 s from
  262 km → alongside 840 s → taken 942 s → victory 1 062 s with the prize.
- E-4: chapter 2 has two defeats (ch2Loss reads the failed objectives and hull states): the convoy lost, or
  "Larkspur is out of the fight over Ganymede. Ochre Sky and Pale Harbour are running for Galileo Regio with no
  escort. ISV Sabre is still on the picket line." with its own war line.
- W-6: hint t7 names D or the Essentials button. W-3 / G-7: on a phone the situation screen draws the first
  paragraph, the two sides, the ship, then the rest (laptop unchanged).
- Noted: the harness's informational chapter-2 line (keep range at 250 km, no cards answered for 80 minutes) now
  reads defeat, since Sabre no longer runs; the check itself is green. Carried: a hostile that turns to run cannot be
  caught by an identical hull with less propellant, so any chapter ending only on 'neutralise' can stall; chapter 2
  cannot any more, chapters 4 to 8 want the same look.

Decisions (Opus worker D; decisions-check 157 ok at hand-back, the seeded 16-run sweep 11 of 16; probes and logs in
scratchpad/v12dec/):
- I-3: the salvo card prices her point defence over the window the interceptors are inside her mounts' reach, taken
  straight from OD.Engagement.salvoEstimate (theirPdCanStop, through), not over the whole flight; a booked flight
  longer than 35 % of an interceptor's life (T.salvoLife) arrives at nothing, because the estimate books a closing
  the dart only holds while its drive is lit; the key names the window ("her point defence stops about 4 of them
  over the last 150 km, which is as far as those mounts reach") and the third dead reason ("more than an interceptor
  holds its closing for · they run dry short of her and coast"). Nine forced salvos from 1 040 km down to 228 km
  separate correctly; chapter 2's first card said 4 stopped and 5 of 6 aboard, the sim stopped 4 and put 1 aboard.
- R-1, the sim half: the force-wide break-off gap (240 s) no longer holds a hull shut once she has lost a fifth of
  her armour since her own last answer (chapter 4's corvette is asked again at 417 s, not never); a hull flying a
  break-off is not gathered into a course card and raises none (a division range card used to fly her back inside
  Coriolis's beams 88 s after she broke off); answering one course card supersedes any other course card still open
  for the same hulls. Chapter 4 at 1 s / 30 s went from a 2 400 s stalemate to a win.
- Check honesty: a run is won only on 'victory'; the "coast replaced inside a minute" rule restarts its clock only
  when an answer puts the hull on the coast; the three recommended-only scenarios and the sweep are seeded.
- The earlier-stretch fixes stand: spd, closingWords, reachForAim and aimBite, solutionRangeAt, watcher, the cripple
  collapse with its own key, the Why? preamble, onFacet, the boarding and nose-on hold, callsOff, radReaches,
  hullBudget, incomingFire and hullLife, T.dyingSoon and T.fireFloor.
- Left at hand-back, 5 of 16: ch2 5 s / 30 s defeat at 1 843 s (a level slugging match lost by three points, Larkspur
  15 % against Sabre 18 %); ch4 1 s / 0 s defeat at 560 s (the range card at 127 s collapsed for all three hulls, the
  defend card at 301 s and the cripple card at 453 s pulled the sisters off it and left the corvette alone inside
  Coriolis's 802 km reach with her own burn-through at 232 km); ch4 1 s / 20 s, 5 s / 20 s, 5 s / 30 s stalemate at
  the 2 400 s cap (both hostiles crippled, break off and run to 3 000 km, and the neutralise objectives never close).
  Tried and reverted with numbers: a cold-coast speed cap on every range-card order (chapter 4 unwinnable); the
  withdraw armour baseline moved into st.hurt and the ask cap lifted inside quietFight (chapter 4 recommended-only
  lost at 1 716 s). Known hole: quietFight deletes the withdraw cooldown that carries the armour baseline and does
  not lift T.askCap, so after three "Press on" answers a falling hull can have nothing on the band (chapter 2 at
  5 s / 30 s: no card from 1 485 s to the end while she goes 31 % to 15 %).

Carried into the next pass (not blocking, recorded so the next round starts here):
- aimEffective tests reach and armour but not the facet, so the radiators aim can be lit while her panels are
  stowed; the status line says it is holding and nothing is wasted, but the card's ground truth should be the facet.
- Any chapter that ends only on 'neutralise' can stall when the hostile turns to run from an identical hull with
  less propellant; chapter 2 now holds her in the fight, chapters 4 to 8 want the same look.
- The harness's informational chapter-2 line (keep range at 250 km, no cards answered for 80 minutes) reads defeat
  now that Sabre stays; it is a note, not a check, and the checked runs answer the cards.
- Reviewer E-6 (phone toasts covering the log) was not reproduced: the shot shows the log scrolled, not covered.

### Review loop, round 3 (v12, 2026-09-21, from 00:05 UTC)

No new reviewer round: round 2 left one blocking finding, the seeded sweep (chapters 2 and 4 on the recommended
option alone, reading delays 0/10/20/30 s, 1 s and 5 s stepping) at 11 of 16, and round 3 is the fix for it. Two
of the five losses are at the page's own cadence (1 s), and those come first.

Sim (the thread; tools/objectives-check.js, 12 ok): a hostile that breaks off and runs is driven off. Her computer
never brings her back (ai.js keeps her retreating once hurt or dry), so a chapter that ends only on 'neutralise'
waited for ever while she coasted away at 3 000 km and nothing of ours could catch her and still come home (chapter
4 at 20 s and 30 s reading delay, three of the five sweep losses). Rule, in sim.js drivenOffStep: she has broken off
(the "is breaking off" line), she is more than 1 500 km from every fighting hull of ours (beyond any beam or slug),
and the range has been opening for 120 s without a break; then ship.drivenOff and ship.drivenOffAt are set, the log
says "ISV Coriolis is driven off: she broke off with her hull at 30 %, is past 1 500 km and still opening. She is out
of this fight.", and the neutralise objective counts her beside disabled, boarded and destroyed hulls.
ship.neutralised() stays false for her (she is not a prize and not adrift), so the debrief must say driven off, not
adrift (story worker, this round). A hull that closes again clears the two-minute hold; a whole hull far out is not
driven off; a hull breaking off inside 1 500 km is still in the fight; a raider running from a chase (chapter 5,
behaviour flee, never "breaking off") is never driven off. Chapters 6 to 8 get the same ending as chapter 4.

Story (Opus worker S, round 3; harness, main-check and bridge-check green on the file; probes in
scratchpad/v12/story2/, README there):
- Every debrief line that asserts a state now reads it off the hull it is about (story.js helpers endSim, isOut,
  isDone, baysLeft, rangeFromUs, adriftWhy, brokeOffWhy, endedAs, ourEnd): a driven-off hull is never called adrift
  or destroyed, an adrift hull says why (drive wrecked, or the hull percentage), and the fallback with no sim is the
  same line the common ending prints, so warSoFar cannot disagree with the screen. Chapter 4 driven off: "Coriolis
  broke off with her hull at 30 % and ran. She is 2 100 km out and still opening. She is out of this fight. Bastion
  is at 72 % hull integrity and still flying. The Io approaches are open."; war line "Coriolis broke off hurt and
  left the Loki approach, so Compact haulers can use it until she is repaired." tools/objectives-check.js reads the
  getter, the war line and the debrief screen's body in both endings.
- Lines that were false before and are true now: chapter 1 "under tow" (the rendezvous repairs her drive; now
  "with her drive running again"); chapter 2 "both freighters reached Galileo Regio" (they are still flying) and
  "fired on an Authority warship" only when her hull was opened; chapter 2 defeat no longer says Sabre is still on
  the picket line when she is out of it; chapter 3 names each frigate's ending; chapter 5 a wrecked Tamarind takes
  the cargo with her, "with propellant to spare" dropped; chapter 6 "with their bays empty" only when the bays are
  empty (48 interceptors were aboard when they died loaded); chapter 7 "half her flank armour gone" (armour does
  not ablate; it is hull integrity); chapter 8 "Concordance struck" (nothing strikes colours; how she left).
  warSoFar rewritten with per-chapter alternates (escort lost, prize or driven off, station held but our ships
  gone, raider still inside the line, Harkness adrift).
- Chapter 2 at 5 s stepping and 30 s delay, measured and reverted: the pair closes to 195 to 230 km and slugs it
  out from 570 s, Larkspur trailing by 2 to 4 points all the way (disabled at 1 783 s, Sabre at 18 %), her sink
  pinned at 85 % costing her nothing. Sabre standing off at 350 km (commit inside 375 km, release outside 525 km)
  took the story sweep to 36 of 36 but lost ch2 at 1 s / 0 s in every seed (1 763 s): with her standing off the
  navigator lights an aim card at about 675 s that never fires at 250 km and then Break off twice, and Larkspur
  turns her 8 cm flank and 4 cm tail to the beams. Not shipped: a 1 s loss is worse than a 5 s loss. Carried: the
  stand-off is the one lever that turns the level match, once the withdraw recommendation is looked at.

Thread (round 3): tools/objectives-check.js (16 ok) covers the driven-off rule, the chase guard, the chapter-4 debrief
in both endings against the screen's body and war line, and the debrief's mission time against the outcome time;
scratchpad/v12/debrief-shots.js shoots the chapter-2 and chapter-4 debriefs on laptop and phone (the clipped
"OBJECTIVES COMPLE" in earlier phone shots was the title's typing animation caught mid-way, not a layout fault; a
bridge title now shrinks to fit the frame width anyway, bridge.js title()). tools/bridge-check.js accepts the
situation screen's "Back to …" key.

Decisions (Opus worker D, round 3; decisions-check 157 ok, the seeded sweep 14 of 16 with the two leftovers named
in the check as carried; probes, snapshots and logs in scratchpad/v12dec2/):
- The driven-off rule alone took the sweep from 11 to 14 of 16 (the three chapter-4 stalemates at 20 s and 30 s
  now end in victory at 1 706 to 1 888 s); every run that won before wins at the same second with the same cards.
- quietFight, the safe half: after a quiet spell the force-wide gap is reset and the break-off question's
  three-a-fight count is cleared for that hull (dismissals still stand), so a hull losing armour after three
  "Press on" answers is asked again; chapter 2 at 5 s / 30 s: the longest silent band went from 358 s to 310 s and
  the withdraw card returns at 1 500 s with her hull at 31 %. The other half (the armour baseline lives on the
  cooldown record quietFight deletes, so the armour-drop re-ask cannot fire after a quiet spell) needs the break-off
  recommendation retuned with it; left.
- ch4 1 s / 0 s, measured and not fixed: the loss is decided at the 127 s range card, not at the 301 s defend card
  (that card already speaks for both sisters; the corvette is committed at 461 km inside Coriolis's 802 km reach
  with a 232 km burn-through, and every intervention at the split still loses: carry her onto the new course 492 s,
  fall in behind a sister 611 s, hold her range 581 s, re-ask and break off 582 s). Forcing "Open to 1 042 km" at
  127 s wins at 1 404 s with her at 87 %. The honest rule ("a division card does not recommend a rung only its
  fastest hull is standing on": the close rung stops at the edge of her beams while nothing of ours is on her and
  the next hull is more than T.supportSoon away, the key saying what it does to every hull) wins ch4 1 s / 0 s at
  1 133 s with her at 91 % and ch2 5 s / 30 s too, but holding at the edge spends about 600 s (one range cooldown)
  and three ch4 5 s runs then run out of the 2 400 s clock with Coriolis at 43 %; releases at the rendezvous or when
  nothing is under way lost more. Snapshot scratchpad/v12dec2/decisions.s6.js is the starting point when the range
  cooldown after a hold-out, or chapter 4's clock, moves.
- Gotcha recorded: fill() swallows a card builder's exception (noteBuildError), so a typo makes the card silently
  never appear and the run diverges with no error in the log; OD.errors holds them (scratchpad/v12dec2/err.js).
- Dead intent variables in buildRange (alone, outranged) are exactly the intent the hold-out rule wants; untouched.

Carried from round 3 (added to the list above): ch2 5 s / 30 s and ch4 1 s / 0 s as measured here; a shorter range
cooldown after a division holds out, or a looser chapter-4 clock, is the lever; the stand-off for Sabre at 350 km
once the withdraw recommendation is looked at; the armour baseline half of quietFight.

Live: v12 deployed 02:40 UTC 2026-09-21 (Netlify deploy 6ab098f5cea964015564489a, Artifact Version 12; harness and
the eleven checks green on the served build; first load 437 KB of js compressed, was 372 KB in v11). Noted by the
deploy line, carried: calling OD.Game.pauseMenu() directly while the situation screen is open from pause leaves the
situation screen up; the screen's own Back key returns to pause, which is the player's path, so it is a note for
the next pass, not a fault a player meets.

## Damage control and crew (v13, 2026-09-21)

Ethan, 05:40 UTC 2026-09-21: "looking much better. i do think damage control can be more visible and interesting
(maybe on the ship model?) and crew seems to have no role whatsoever?" 05:43: "you don't need to have a lot of named
people voicing the cards because it might lead to overdramatic llm writing. i was thinking more that you would
deploy crew than you would like them." 05:43: "well, i mean you also need to consider crew during combat, including
g's of acceleration, etc".

Principles: crew is something the player deploys, never a cast. No named officers; cards and log lines keep the v12
voice (the ship, the part, the number, the choice). Every new mechanic is taught in play in plain words. Damage
control is a loop the player runs on the ship itself: a hit part shows its state on the ship art at close zoom, in
the hull view (V) and the portrait; a party sent to it is a marker on the hull with a progress ring and a time to
done; the damage report becomes a damage-control board; each real choice arrives as a card with the recommended
pick marked, and an unanswered card is settled by the ship's own routine so nobody has to micro-manage. Repairs
are jury-rig in vacuum: partial capacity back, never full; a holed tank is isolated, never refilled; a wrecked
mount, panel or nozzle stays wrecked in a fight. Acceleration is a live limit on the people (Atomic Rockets): about
1 g is workable, up to 3 g only strapped in, more than that for seconds. Warships here pull 0.9 to 1.3 g on full
tanks and 1.8 to 3.4 g near dry, so the limits bite as the fight goes on.

### The crew model (js/crew.js, OD.Crew, new; loaded after damage.js, before sensors.js)

Numbers are game data. Per class: crew and parties: corvette 24 / 2, lancer 26 / 2, frigate 60 / 3, destroyer
140 / 4, cruiser 260 / 6, freighter 12 / 1, station 200 / 6; a custom design takes its base class.
ship.crew = { total, fit, wounded, lost, xp (0 to 3), parties: [{ id 'p1'.., task 'fire' | 'sensors' | 'repair' |
'medical' | 'standby', part (component id or null), progress 0..1, eta s, since }], gMode 'work' | 'couches' |
'max', auto true, gNow (g right now), strapped (gNow above the working limit) }. Default posture: party 1 on fire
control, party 2 on sensors, the rest standby; so a corvette's every repair costs fire control or the sensor watch.

- Working limit T.workG = 1.2 g: above it parties strap in and repairs pause (progress holds); fire control and
  the sensor watch are not touched below the couch limit (corrected 06:45 UTC: the first cut ran them at 0.85 from
  1.2 g, which cost six seeded chapter wins, since ships close at 1.33 g). Couch limit T.couchG = 3 g: above it
  fire control and the sensor watch run at 0.85 (crew.overCouch) and the crew is injured at T.hurtRate × (g − 3) × fit
  per second (about 2 wounded a minute per g over, on a corvette), logged once per burst ("3 wounded at 3.6 g."),
  and above 5 g twice as fast. The autopilot and the AI live by the same numbers: OD.Crew.accelCap(ship) returns
  the m/s² the current gMode allows (work 1.2 g, couches 3 g, max none) and sim.js takes the smaller of the drive
  and the cap in ship.accel(), with propellant flow computed from the acceleration actually used, so a capped burn
  spends less propellant, not the same.
- Repairs: OD.Crew.update(sim, dt) advances every party on a part at 1 / OD.Damage.repairTime(ship, partId) per
  second (times 1 + 0.15 × xp), and when it reaches 1 calls OD.Damage.mend(ship, partId), logs one line ("Party 2
  has the drive back to 30 %.") and returns the party to standby (or the routine, below). Medical: a party on
  medical turns wounded back to fit at T.medic (1 every 45 s); with no party on medical nobody comes back during
  the fight. Casualties: OD.Crew.casualties(ship, partId, severity 0..1), called by damage.js from hit(), wounds
  round(severity × T.casualtyShare × fit) of whom T.lostShare are lost; a party working on that part takes it
  first. Fit crew below a third of total: fire control and sensors at 0.7 whatever the parties.
- The routine (OD.Crew.auto(sim, ship)): when ship.crew.auto or ship.ai, every T.autoEvery = 15 s a standby party
  goes to the most valuable hurt part (drive, reactor, a venting tank, radiators, mounts, sensors, in that order,
  skipping parts a jury-rig cannot improve); a fire-control or sensor party is pulled only for the drive, the
  reactor or a venting tank when no standby party exists; a party whose part is mended returns to its default
  station. For AI ships it also sets gMode: 'work' while a repair runs and the nearest hostile is outside 1.5 ×
  the doctrine range, else 'couches'; a player's ship keeps the gMode the player set (default 'couches').
- Effects the rest of the game reads (all 1 when OD.Crew is absent): OD.Crew.fireFactor(ship) = 0.7 with no party
  on fire control, else 1 + 0.03 × xp, × 0.85 over the couch limit (3 g), × 0.7 below a third fit; OD.Crew.sensorFactor(ship) the
  same shape for the sensor watch; engagement.js scales pointing jitter and mount cycle by fireFactor,
  sensors.js scales track gain by sensorFactor.
- Interface for the panel, the hull view and the cards: OD.Crew.board(ship) → { crew: { total, fit, wounded,
  lost, xp, gNow, gMode, strapped }, parties: [{ id, task, part, partName, progress, eta, words }], parts: [{ id,
  name, state, hp, cap, repairable, eta (with a party or if one were sent), party, buys }], words (Essentials
  line: "Crew 24: 21 fit, 3 wounded. Party 1 on fire control. Party 2 on the drive, 4 min to 30 %."), gWords
  ("1.3 g: the crew is strapped in and repairs are paused." / "0.9 g: the crew can work.") }. OD.Crew.assign(ship,
  partyId, task, partId) and OD.Crew.release(ship, partyId) validate and return the log sentence; OD.Crew.setG(
  ship, mode) the same. OD.Crew.artFx(ship) → { parties: [{ id, part, progress, eta, working }], strapped, gNow },
  which render.js merges into opts.fx.parties for the art overlay. OD.Crew.toRecord(ship) → { fit, wounded,
  lost, xp }, fromRecord(ship, rec), afterBattle(rec, survived) (xp + 1 to a cap of 3 when the hull survives),
  recover(rec, atPortOrYard) (wounded to fit in full at a port or yard, half elsewhere; lost stay lost); campaign.js
  calls them where it records hull and parts. Story ships start at xp 1 (Larkspur xp 2 from chapter 5).
- Teach strings (OD.Crew.TEACH) in the plain standard, one per idea: parties, the working limit, the couch limit,
  jury-rig, medical, experience.

### Jury-rig (js/damage.js additions)

OD.Damage.mend(ship, partId) → hp to the jury-rig cap for that kind and state, never above: drive wrecked 0.3
(acceleration at 30 %, turn rate at 65 %) or damaged 0.7; reactor wrecked 0.25 or damaged 0.6; sensor suite wrecked 0.5 or
damaged 0.8; radiator panel wrecked stays 0 (the panel is gone), damaged 0.7; a venting tank is isolated (venting
stops, what vented is gone, hp held at 0.5 and its state reads 'isolated'), a dented tank 1; a mount wrecked stays
0, damaged 0.8; a part between 0.5 and 1 takes the damaged cap. Aggregates recomputed, one log line.
OD.Damage.repairTime(ship, partId) → seconds from a base per kind (JURY: drive 240, reactor 210, sensor suite 150,
radiator 120, tank 60 for isolate and dent alike, mount 120) × (1 + (1 − hp)), × 1.5 when the part's facet is
breached (OD.Damage.breached(ship, part): that facet's mark-up above 0.5, so the party works in suits): a wrecked
drive 480 s, breached 720 s, a drive at 0.4 384 s, a venting tank at 0.2 108 s. The eta a row shows is always
repairTime; a mount mend buys margin before the mount is wrecked. Bases were halved on 2026-09-21 06:00 UTC so
the sentences match the times below (the first cut read 16 min for a wrecked drive).
OD.Damage.repairable(ship, partId) → false when a mend would change nothing. report() rows gain cap, repairable,
eta and buys (plain words: "A party brings the drive to 30 %: acceleration at 30 %, turn rate at 65 %. 8 min."). hit() calls
OD.Crew.casualties(ship, c.id, severity) with severity = the part's hp taken by this hit, guarded on OD.Crew.
artState() unchanged; the parts already carry hp for the sprite.

### The cards (js/decisions.js additions; the rest of the module unchanged)

Three kinds, each a two-or-three-key card with the recommended pick marked, priced from OD.Crew.board and
OD.Damage.repairTime, in the plain voice: 'repair' when a part is hit and the choice is real (two hurt parts and
one free party, or the only free hands are on fire control or sensors): "Radiator 2 is hit. Party 2 is on the
sensor watch. 1 Send party 2 to radiator 2: cooling back to 70 % in 5 min, the sensor watch runs at 70 % meanwhile
· 2 Keep the parties where they are"; 'burn' when an order wants more than the working limit while a repair runs,
or the closing burn would pass the couch limit: "1 Burn at 1.2 g: repairs go on, alongside 6 min later · 2 Burn
at 1.9 g: repairs pause until the burn ends, alongside 14 min · 3 Hold and fight at this range"; 'medical' when
wounded pass a tenth of the crew and no party is on medical. An unanswered repair or medical card is settled by
the routine after T.autoAssign = 60 s and closes with one log line ("Party 2 is on the drive: the ship's routine."),
a burn card by 'couches'. Cards about a driven-off or neutralised hull are never raised. TEACH strings per kind.

### Ship art (assets/ships/src, rebuilt into js/shipart.js)

opts.fx.parties = [{ id, part (component id), progress, eta, working }] from OD.Crew.artFx: the overlay draws a
party as a small ring on the part's anchor (the drive nozzle, the reactor frames, panel n, tank n, the mount, the
nose for the sensor suite) with the progress as an arc, the party number inside, brighter while working, dim and
still while paused (strapped). Drawn only when the hull is 120 px or larger on screen, in the hull view and the
portrait. A mended part keeps the 'damaged' bucket look (no fifth bucket). The design's anchors already exist for
mounts, bays and tanks; the drive, reactor, panels and nose get one each. Wrecked parts stay dead as before.

### Panel, hull view, keys, campaign, teaching (the thread)

- The Damage report section becomes the Damage-control board (title "Damage control"): the crew line first
  (Essentials: board.words and gWords; Full: the numbers), then one row per part as before plus its party with a
  progress ring and time to done, and a Send / Recall key per hurt part that OD.Crew.assign can improve (Essentials
  shows only hurt parts and the parties). Key C focuses the board (and on a phone opens the panel there). The hull
  view lists the parties under the parts and draws them on the hull through the overlay. The gMode is a
  three-way control on the board (Work 1.2 g / Couches 3 g / No limit) with one line of consequence.
- sim.js: OD.Crew.init in makeShip (spec.crew record), OD.Crew.update in the substep before the damage update,
  accel() capped by OD.Crew.accelCap, propellant flow from the acceleration used. sensors.js: track gain ×
  sensorFactor. render.js: opts.fx.parties merged from OD.Crew.artFx. campaign.js: crew records with the fleet,
  afterBattle and recover with the yard work, the roster line shows crew and xp. story.js: chapter 1 keeps its
  scripted repair at the rendezvous (Larkspur's engineers cross with spares; the tutorial is about delta-v, and a
  0.3 jury-rig drive would not get the tanker home inside the chapter), so the board is first taught by the
  first hit; the first hit on a player hull in any chapter raises the hint
  "Radiator 2 is hit. The board is under Damage control in the panel, or press C. A card asks when the choice is
  real." Checks: tools/crew-check.js (crew worker), additions to damage-check, decisions-check, engagement-check,
  art-check; the harness gains a crew scenario (a corvette hit on the drive: the routine sends a party, the mend
  lands at 30 %, a 3.4 g burn wounds crew).

### Ownership for the v13 pass (one writer per file)

CR = js/crew.js + tools/crew-check.js. DC = js/damage.js + tools/damage-check.js. D = js/decisions.js +
tools/decisions-check.js. E = js/engagement.js + tools/engagement-check.js. A = assets/ships/src/* rebuilt into
js/shipart.js + tools/art-check.js. The thread: sim.js, sensors.js, render.js, ui.js, main.js, ships.js,
campaign.js, story.js, guide.js, bridge.js, index.html, tools/harness.js and the other checks. Every reference
across modules is guarded (a module absent means factor 1, no parties, no cards).

### Status, first cut (06:10 UTC 2026-09-21)

- DC (js/damage.js, 106 checks): mend, repairTime, breached, repairable, cap, buys, stateOf and JURY exported;
  report rows carry cap, repairable, eta and buys; hit() calls OD.Crew.casualties; a venting tank isolates to
  'isolated' (iso: 1 in the record). Bases halved at 06:00 so a wrecked drive reads 8 min.
- CR (js/crew.js, 85 checks): the API above, T as listed (hurtRate 0.0014 = 2 wounded a minute per g over on a
  corvette, medic 45 s, autoEvery 15, autoAssign 60, noParty 0.7, strapFactor 0.85, thinFactor 0.7 below a third
  fit, xp 0.15 per point on repairs and 0.03 on the factors, maxXp 3). Decisions recorded by the worker: log lines
  carry the ship name and only for the player's faction; one line per g burst, flushed when the burn drops under
  3 g or every 600 s; casualty lines aggregated every 30 s; a party on a hit part takes casualties × 1.5 and stays
  on the job; assign/release/setG return null when refused; board() null with no crew; gNow uses 9.80665; a hull
  with no mounts puts party 1 on the sensor watch; default gMode 'couches', auto on; mend is called without a sim
  so the crew's line is the only one.
- E (js/engagement.js, 160 checks): E.shared.fireFactor, fireWords, crewFire; pointing jitter ÷ factor, coilgun
  cooldown = cycle ÷ factor, salvo gap ÷ factor, muzzle flash in step; AI hulls under the same call; the words
  "Fire control at 70 %: no party on it." and the like, '' at 1. The panel prints the words as a row under point
  defence (thread). The physics note keeps the rated cycle.
- Thread: index.html loads js/crew.js after damage.js (the first insertion left damage.js's tag unclosed; fixed
  06:08); sim accel() capped by accelCap with propellant flow from the acceleration used; Crew.update before
  Damage.update; sensors × sensorFactor on range and dwell; render passes fx.parties and fx.strapped; campaign
  records crew and recovers at ports and yards; the board, C key, Work/Couches/No limit control, hull view lines,
  inspect crew line, help; harness scenario "v13 — damage control and crew".
- Harness scenario "v13 — damage control and crew" (7 checks): both hulls parked (hold, weapons tight, the
  hostile's AI off) so only the damage and the crew move; the drive at 0.2 gets a party inside 40 s and lands at
  0.7 inside 20 min with the party back on watch; a near-dry corvette with half again its thrust at No limit
  pulls 5 g and takes 3 wounded in a minute (injuries accrue in whole people, so 3.3 g for a minute wounds nobody);
  Work holds it to 1.2 g. Standalone runner scratchpad/v13/harness-v13-only.js; screenshots scratchpad/v13/shots-v13.js
  → scratchpad/shots-v13/ (the repair card, the board at close zoom, the hull view with a party, a hard burn, phone).
- A (assets/ships/src/core.js, station.js, README.md → js/shipart.js; tools/art-check.js, 48 checks): overlay()
  reads opts.fx.parties and draws each party as a hollow ring (radius 9 to 22 px by hull size) on its part's
  anchor, the party number on a small disc inside, a progress arc from screen-top clockwise, amber with a soft
  halo and a slow breath on the sim clock while working, steel and still while paused; the eta in words under the
  ring only while working, only at 260 px and up, only where it fouls nothing; nothing below 120 px; drawn in a
  counter-rotated frame so it stands upright whichever way the hull points; culled like the existing anchors
  (a far-side mount draws nothing). New anchors in coreAnchors() for every family: drive (bell centroid, one
  radius forward of the mouths), reactor (drum middle), sensors (in the armour cap), rad n (each plate, outboard of
  its middle); the station places her own (no drive). Part ids map the damage module's way (drive, reactor,
  sensors, radN, tankN, beamN counting the spinal tube, coilN, bayN, pdN). Sprite cache untouched (40 frames of
  parties grow it by 0). Known: two parties on adjacent parts can touch rings at 420 px; the 1 ms draw assertion
  measures one worst sample and can flake at 1.005 ms. Pictures under scratchpad/v13/art/.
- Correction at 06:45 UTC (the coordinator's note on the sweep): CR moved the 0.85 on fireFactor and sensorFactor
  from strapped (above 1.2 g) to a new flag overCouch (above 3 g), on the record, board().crew and artFx; repairs
  still pause on strapped; TEACH.workLimit now "Above 1.2 g the parties strap into the couches. Repairs hold where
  they are until the burn eases." and TEACH.couchLimit carries the 85 % (88 checks). E reads overCouch (falling
  back to strapped on an older record) and words the reason "the crew is over the couch limit." (161 checks).
- D (js/decisions.js 4948 lines, tools/decisions-check.js, 196 checks): kinds 'repair', 'burn', 'medical' in
  ORDER slugs, withdraw, defend, cripple, sink, repair, heat, burn, approach, capped, range, sensors, aim,
  radiators, medical, salvo. Cards as printed: "Pull a party off watch for radiator 1?" (1 Send party 1 · cooling
  back to 70 % in 3m 24s · fire control runs at 70 % meanwhile / 2 Send party 2 · the sensor watch runs at 70 % /
  3 Keep the parties where they are · both watches stay at 100 %, the recommended pick by the routine's own value
  order); "Which part does party 3 take?" (drive first, radiator 1 waits); "Pick the burn." (1 Burn at 1.2 g ·
  repairs go on · alongside 3m 36s later / 2 Burn at 2.9 g · repairs pause / 3 Hold and fight at this range; at
  the couch limit: 1 Burn at 3 g · nobody is hurt / 2 Burn at 3.3 g · one wounded a minute); "Put a party on
  medical?" (one wounded back every 45 s; a watch is given up only under the fit floor 0.34). Prices read from
  OD.Damage.repairTime and cap, never guessed. Departures recorded: player hulls only; decisions.js sets
  ship.crew.auto = false while a repair or medical card is open and restores it (an OD.Crew.hold would be cleaner);
  the settle leans on crew.js's own log line and adds "The parties stay where they are: the ship's routine." only
  when nobody moved; the burn card has a third situation (still capped at 1.2 g with the repair over, so the
  answer never becomes a silent permanent cap); T.burnWorth 45 s between rungs or no card; the repair title is a
  function so a superseding card names its own part. Sweep: v12 baseline 14 of 16; crew on, cards stubbed 13 of
  16; crew on, cards in 13 of 16; the new loss ch4 5s 0s is left failing, not carried. Traced by the thread
  (scratchpad/v13/ch4-diverge.js): the two fights are identical to 700 s; the repair card at 595 s (answered
  "keep") displaces an aim card at 705 s and the fights part from there. Fix asked of D: raise the repair card
  only when the recommended pick moves a party. Done (195 checks): fifteen of the sixteen runs are then
  card-for-card identical to the crew-on, cards-off arm; ch4 5s 0s still ends 'none at 2400 s'. Traced further by
  the thread (scratchpad/v13/ch4-variants.js): with OD.Damage.mend stubbed out the run wins at 1695 s, with the
  AI hulls' crews deleted at 1788 s (the v12 time exactly), with the g cap removed or the player's routine held
  it is unchanged; so the extra time is the hostile crews mending damaged drives (Coriolis 0.41 to 0.70), which is
  the v13 rule for both sides. Run past the cap, the same seed wins at 3175 s with Coriolis driven off. Decision:
  the sweep's clock moves from 2400 s to 3600 s (the chapter has no clock of its own); the game does not change.
  Done by D (tools/decisions-check.js only; 197 checks, all green; the sweep at 14 of 16 with the two carried
  unchanged, ch2 5s 30s defeat 1840 s and ch4 1s 0s defeat 560 s). Run times against the v12 baseline: six of
  sixteen unchanged to the second, three shorter, three longer (ch4 5s 0s 1788 → 3175 s, ch4 1s 20s 1878 → 2357 s,
  ch2 1s 20s 1649 → 2033 s); the sixteen runs total 28 147 s against 26 448 s (1.06×); Larkspur's low-water mark
  in ch4 5s 0s is 56 %, so she was never in trouble, the clock was. The fun reviewer's skirmish scenario keeps its
  2400 s (it asserts silence on the band, not an outcome).
- Verification 06:57 to 07:00 UTC (scratchpad/verify-v13.sh, verify-v13.out): every check green (sensors,
  engagement, autopilot, damage, objectives, crew, bridge, main, sound, art), the harness green with the crew
  scenario, the v12 and v13 screenshot sets and the v12 hull, zoom, debrief and contact probes clean.

### Review round 1 (07:05 to 07:50 UTC 2026-09-21; six Opus reviewers, reports scratchpad/review/<lens>/round1-v13.md)

57 findings; the plan by owner is scratchpad/review/FIX1-v13.md. The blocking ones: the loop never fired in the
story chapters (the repair card gated on the routine's own pull rule and on state !== 'ok', casualties rounded to
zero per hit under beam fire, the routine re-took a part the player had refused within a tick, the 60 s settle
made a different move from the recommendation, the medical card was displaced and settled off the band); chapter
1's tanker jury-rigged her own dead drive (the chapter could not be lost); a crew-capped burn made full-throttle
heat (thermal() read cmdThrottle); the card and the board priced the same repair differently and the burn card
gave its two times in two frames; a party on a far-side mount or tank drew nothing; the hull view's party lines sat
below the fold; the board hid parts above 50 %. Design calls made in the plan: repairs hold while the drive has
throttle or a panel is extended (a real trade); casualties weighted by the part hit; the watches fall toward zero
with nobody fit; deaths above 6 g; the g rule below 3 g unchanged; boarding time by the crews and casualties on
both decks; experience shown as a number with its effect, never an adjective; only our own hulls show their
parties on the map; a party line on the ship's map label at any zoom; the sweep clock at 3600 s stays.
Carried: chapter 5 never passes 3 g and Couches equals No limit until the tanks are near dry (a chase that must
pass 3 g is a story change); a boarding party as a crew task.

Thread fixes done (07:40 to 08:05 UTC): sim.js thermal() scales drive heat by the thrust actually produced
(ship.thrustFrac, the same fraction the propellant flow uses); makeShip skips the crew when spec.crew === null
(chapter 1's tanker: her drive stays dead, the chapter can be lost again); the "none of our ships can move" and
"can fight" defeats hold while a party is on a wrecked drive and a mend would change something (log "JCS Tallow
cannot move, but a party is on her drive, 8 min from thrust. The engagement goes on while that repair can land."),
and a hull disabled for her drive comes back when the jury-rig gives thrust (sim.comebacks(): systems.drive > 0
and hull at or above the combat module's disable floor, log "JCS Tallow has thrust again: her drive is at 30 %.
She can move."; a hull disabled for her hull never comes back; measured: 480 s to 30 %, then the second shift);
boarding time scales by the defender's fit crew against the boarder's (0.5 to 4 × 90 s) and both crews take
casualties on a capture; story player ships carry crew: { xp: 2 } from chapter 5 (chapters 2 to 4 sail with green crews, see the D
paragraph); the debrief carries "· 2 wounded, 1 lost" per hull and a Crew stat; campaign and hangar print "experience 2 of
3, repairs 30 % faster" instead of an adjective; render.js clamps the follow point into whatever is free, draws
parties only on our own hulls, and puts "party 2 · drive · 6 min" (amber, "· paused" when strapped) on the ship's
map label at any zoom.

DC round 1 done (08:10 UTC; 116 checks): the radiator row states the level ("Radiator panel 1 25 %: the ship's
cooling is at 56 %", the same quantity as the mend line); the mount mend carries the true margin ("it keeps
firing, and 4 times the damage to wreck it"); the isolated tank keeps its propellant ("Tank 1 valved out of the
feed and its 616 t pumped across: the venting has stopped, 2.05 km/s lost"; buys "A party valves tank 1 out of the
feed and pumps its 616 t across: the venting stops. 2 min."); buys names the work ("swaps the burnt driver
modules", "cross-connects the spare feed line", "swaps the burnt receiver boards"), times unchanged; every row
carries hp and repairable (a drive at 55 % reads 'ok', hp 0.55, repairable true). A tank isolated in a campaign
record names its whole share (no vented figure in the record).

Panel round 1 done (07:58 UTC; ui.js, main-check, ui checks and the harness green; shots scratchpad/v13/ui2/):
the heat box reads the thrust actually produced (ship.thrustFrac); the sensor watch has its own row under the
contacts box, the same shape as fire control's; the board lists every part under 100 % ("72 % · worn") with a
pill "1 worn · 2 damaged" (worn, damaged, isolated, venting, wrecked, in that order); the button reads "Send party
2" and, with no party free, "No party free. Recall one."; a #hullParties strip ("Parties", 52 px, gone when there
is none, medical parties listed too) sits between the live hull and the parts list so the party lines never fall
below the fold; the first-hit hint fires on the lowest actionable part only ("The drive on JCS Tallow is hit,
down to 20 %. Open Damage control in the panel, or press C. A party can jury-rig it back to 70 %."; on a phone no
"press C" and an "Open the board" button that scrolls the panel); C with a card open on a phone toasts instead
of hiding the panel; the band's third button reads "Let the crew decide" with "the crew settles this in 43 s"
from card.deadline; the acceleration formula and the physics S line name the crew factor; a row click opens the
hull view; Help's damage-control bullet and TIPS.decision rewritten to the standard (the Esc label and countdown
had contradicted them); the Hull row prints "100 %" with the space.

CR round 1 done (08:03 UTC; crew.js 791 lines, crew-check 140 checks, main-check and damage-check green): casualties
carry a fractional remainder per hull (whole people come off the top, the fraction stays; the lost share the
same, so a run of wrecking hits now kills), weighted by the part hit (drive and reactor 1, sensors and mounts
0.4, panels and tanks 0.1, × 1.5 through a breached facet, × 1.5 with a party on it; one 8 % chip on a corvette
drive wounds nobody, 18 of them wound 2; a whole part taken on a cruiser costs drive 15, sensors 6, tank 1);
OD.Crew.watchToPull(ship, sim) is the one rule for which watch to pull (the sensor watch when a solution is held
on the hull we fight, fire control otherwise) and the routine follows it; a tank that is not venting and at or
above 60 % is not the routine's work while a hostile is inside 1.5 × doctrine range (the tank treadmill), and a
hull with no standby party pulls a watch only for the drive, the reactor or a venting tank; assign() ends with the
cost ("Fire control runs at 70 % until she is back."); "the sick bay" and "3 g" everywhere; OD.Crew.hold(ship,
partId, seconds) holds a part (or the routine with null) and a fresh hit on the part lifts it; the watches scale
with the fit share (1 at full, 0.7 at a third, on down to a floor of 0.05, never 0, because a factor of 0 reads as
"no crew module" downstream); party moves and mends are logged line by line only for the hull on screen, the
other hulls one sentence every 3 min ("Bastion's parties are working on her drive."); a part that is running
cannot be worked (the drive under throttle with thrust, a panel out or deploying): progress holds, the ring reads
paused, the row carries the reason in a blocked field ("Party 2 on the drive, held. The drive has to be cold:
throttle to 0.") and the routine parks a party where it can work; the sick bay holds while strapped and stops at
fit 0 ("Party 3 in the sick bay, nobody fit to work it."); above 6 g three in ten of each burst's casualties are
lost, not wounded ("25 wounded and 10 lost at 6.5 g."), the 1.2 g / 3 g rule untouched; a record of { xp: 1 }
gives a full complement at experience 1. New numbers deathG 6, deathShare 0.3, breachHurt 0.5, floorFactor 0.05,
tankFloor 0.6, otherGap 180; TEACH.inUse added ("A party cannot work a part that is running. The drive has to be
cold, with the throttle at 0, and a radiator panel has to be stowed first."), hung on the board's damage tooltip
by the thread, which also makes the panel ring and the map label read held for a part in use. The crew worker's
sweep of the live tree: 13 of 16, ch4 1s 10s lost at 772 s on top of the two carried cases; a variant with every
crew change switched off loses the same three (scratchpad/v13/crew2/sweep-v0.out), so the loss is not crew.js;
the cards worker places it (see the D paragraph).

A round 1 done (08:05 UTC; art-check 54 checks, main-check green; js/shipart.js rebuilt by build.sh, sound hulls
pixel-identical to the pre-fix build over 7 hulls × 4 views): party markers draw on far-side parts at an alpha
floor of 0.35, from 70 px (the ring clamped at 9 px), a paused party as a dashed ring with its time struck
through; hit parts change shape as well as paint: a wrecked coil rail is a 34 % stub, a hit radiator panel is
shortened and bent (62 % under half, 28 % and 46° wrecked, dark edge, no heat halo), a beam or point-defence dome
sinks when damaged and is a torn cup wrecked with the barrel gone, a launch block stoves in then loses its doors,
the reactor drum and ribs carry the reactor's state (they carried none before); the rules are in
assets/ships/src/README.md. Two overlay bugs fixed on the way (a round line cap grew every dash back over its
gap; the progress arc's dashes filled the ring's gaps). Point defence is checked for the wrecked look only (a dome
is about 3 px at 420 px); the three-quarter view must read for every hull and part, side and top for two of three.

D round 1 done (08:17 UTC; decisions.js, decisions-check 217 checks, main-check green; card texts in
scratchpad/v13/decisions2/probe-final.txt): a repair or medical card whose recommended answer is "keep" or
"leave" yields: it never counts as live against a fight card, and when a kind above it in ORDER opens it settles
on its own recommendation with a Decision line ("Decision: Pull a party off watch for radiator panel 1? → Keep
the parties where they are · the ship's routine. Radiator panel 1 stays at 30 %."); the repair card is raised for
any part OD.Damage.repairable says a jury-rig can move by 0.3 or more (or that the routine's rank rule already
claims), once per part per fight; the lit option is the value call (drive, reactor, a venting tank, a hot hull's
panel: send; a cool hull's panel, a dented tank: keep); the watch to pull comes from OD.Crew.watchToPull; a keep
holds the part through OD.Crew.hold for the minute and the routine through hold(ship, null, 60); the 60 s clock
starts when the card reaches the band (card.deadline, read by the panel), Esc takes it off the band without
releasing the routine and the ship settles it at the deadline; the settle runs the card's own recommendation and
prices it; the option's price is the board row's own sentence with the time printed once ("acceleration and turn
rate at 70 % in 6m 24s"); both burn arrivals whole ("alongside in 10m 26s" / "alongside in 6m 50s"); the burn
card is raised when a hard rung would put a running repair down ("the repair on radiator panel 1 holds where it
is for 3m 24s") whatever the time saved, and every rung carries its consequence ("the crew straps into the
couches, nobody is hurt"); a mend the hull will not live to see says so ("the hull has 8m 00s at the fire landing
on us") with keep lit; one cripple card per prize a minute; no card renames a part the board named; "Put a party
in the sick bay?", digits for counts, "3 g is the couch limit". ORDER: slugs, withdraw, defend, cripple, sink,
repair, heat, burn, medical, approach, capped, range, sensors, aim, radiators, salvo.
The sweep on the settled tree read 13 of 16 (ch4 1s 10s lost at 772 s, Coriolis wrecking Larkspur's drive at
about 30 % hull during the close, on top of the two carried cases). One variable at a time (trees under
scratchpad/v13/decisions2/ab-*): the pre-round-1 decisions.js, the pre-round-1 damage.js and the old thermal rule
all lose it the same way; none of the three sim.js rules fires in the run (no "has thrust again", no "cannot
move, but a party is on her drive", no boarding); stripping the crew: { xp: 1 } specs the thread had added to
chapters 2 to 4 wins it at 1340 s and the sweep reads 15 of 16 (ch2 5s 30s wins too, at 2349 s). The 3 % on the
watches moved the salvo timings enough to change two runs' outcomes, not a systematic effect. Thread call
(08:17): chapters 2 to 4 sail with green crews (the fleet's first fights; experience 0), chapters 5 to 8 keep
{ xp: 2 }; the campaign earns its experience as before. Sweep guard stays 14 of 16 with the two carried cases.

Thread, after the hand-backs (08:22 UTC): sim.comebacks() clears a disabled hull only when her drive was seen
dead first (ship._driveDead), so a hull disabled for any other reason, a staged scene included, keeps the state
the combat module gave her (engagement-check's cripple scenario had been undone by the first rule; 161 checks
green again, objectives-check and the comeback trace green). The panel's party ring, the damage tooltip and the
map label read held for a party on a part that is running ("party 2 · drive · held").

### Review round 2 (08:18 to 08:58 UTC 2026-09-21; six Opus reviewers, reports scratchpad/review/<lens>/round2-v13.md)

Round-1 findings: 41 of 57 fixed, the rest partly (each lens re-checked its own list, one line per finding). New
findings, 42, plan by owner scratchpad/review/FIX2-v13.md. The pattern this round: the round-1 realism rule that a
running part cannot be worked (a drive under throttle, a panel out) met the cards and the board, which still
sold the repair with a clean time and took the watch for it, so in a story fight the mend never landed and no
answer to a crew card changed anything measurable (interestingness, writing, realism, fun all found it from
different sides). Also: the protect objective still failed a chapter the instant a protected hull's drive was
wrecked, in a build whose own log promises the party its shift (engagement, blocking); the hull view printed the
rated 1.3 g over "Drive 0 %" because accel() falls to 0 and the fallback read 0 as missing (graphics, blocking);
the hard burn priced the crew per minute against a whole arrival and hid 13 of 24 down in three minutes
(writing, blocking); the reactor option printed the board's whole sentence (a hyphenated verb defeated the head
pattern); the board's completeness read as a wall of "nothing a party can do" (fun, interestingness, graphics);
the first-hit hint spent itself on a 1 % dent; crew losses were arithmetically almost impossible and a capture
cost nobody; three heat sites still budgeted from the commanded throttle and two others counted the drive's
state or the full-sink quarter twice; chapter 2 still asked the player nothing (the card window and the value
bar missed each other); the burn card never fired in a story fight; six of nine story repair cards were three
interchangeable tank dents on a consort; "JCS Larkspur's the drive is hit."; party rings pile up on neighbouring
panels; the campaign screen is unusable on a phone (predates v13).

Design calls (thread, 08:45): a repair card for a part that is running is the throttle or the panel trade ("Cut
the drive for 6 min: the party gets it to 70 %" against "Keep the burn: the drive stays at 40 %"; "Stow the
panels for 3 min" against "Keep them out", the sink priced) and never a clean time; a lit send never goes into a
blocked part; the burn card is raised whenever a burn would put a running repair down or take a hurt hull past
the couch limit, and its lit rung comes from what the rungs buy; the whole burn cost is printed when the rate
reaches the crew; a refusal survives a chip (only a state change or 0.1 hp lifts the hold); a wrecking hit on a
manned part or through a breach costs at least one lost; a boarding is priced by the fit crews on both decks and
the cost line prints even at nobody; Essentials lists rows with a party or a mend worth 20 points (or the drive,
the reactor, a venting tank, anything damaged) and folds the rest into one line, Full lists them all; the pill
counts work ("2 to work · 1 party on it"); the Send button names the watch it takes; the held reason prints
before the button and the moment an order stops a running repair a toast and a log line say so; the hint waits
for a part worth 20 points; one plain name per part everywhere (OD.Damage.plainName), point defence is
"Point-defence laser 1" on every class; one repair-time format (OD.Damage.timeWords); the protect objective
holds while a party is on the protected hull's wrecked drive; the hull view prints accel() and falls back only
when it is not a number; the map label counts the other parties ("+1") and shows a sick-bay party; the Parties
strip scrolls; the campaign grid is one column under 900 px. Carried: chapter 5 never passes 3 g; a boarding
party as a crew task.

Thread round 2 done (08:58 UTC; main-check, bridge-check, objectives-check green; probes scratchpad/v13/
board-r2-probe.js, thread-r2-probe.js, accel-probe.js, campaign-phone-probe.js): sim.js protect grace (one log
line through mendEtaWords), the boarding cost through casualties(ship, null, severity, 'in the boarding') with
the line printed at nobody, thermal() without the doubled quarter; ui.js Essentials collapse ("3 parts hit, not
worth a party: Reactor 80 %, Sensor suite 90 %, Tank 1 97 %. Full lists them."), the pill, "Send party 2 · the
sensor watch", "Held: stow the panel first." before the button, "Party 3 on the drive is waiting. The drive has
to be cold: throttle to 0." as toast and log, "No party free. Recall one." once under the crew line, the row
sentence on its own line with the button under it, liveAccel() for the hull view and the stopping distance,
the Parties strip at 5.4 lines with a scroll, hintWorth() picking the hint's part by value, TEACH.inUse on the
damage tooltip, heatForecast and the hull-view pin through heatFrac alone; render.js "party 1 · drive · 6 min ·
+1" and "party 3 · sick bay"; ships.js and configurator.js "Point-defence laser N"; bridge.js "experience 1 of
3, repairs 15 % faster"; index.html one-column campaign under 900 px with a 260 px map.

CR round 2 done (09:12 UTC; crew.js 890 lines, crew-check 170 checks, damage-check and main-check green; every repair time through OD.Damage.timeWords): a chip
does not lift a hold (T.realHit 0.1 hp, or a state word changing, is a real hit); a hit that takes the last of a
manned part takes one lost outright (the drive and the reactor always, the sensor suite and mounts through a
breached facet, plating never; lostShare 0.25 for the rest, the forced person not double-counted: the corvette
fight in the check now ends 18 fit, 2 wounded, 4 lost); gWords tests fit first ("Nobody is fit to work." at
zero, "0.0 g, and 6 of 24 fit: the watches run at 52 %." under a third, because nothing in the module slows a
repair with a thin crew, so the plan's "repairs run slow" would have been false; a burn keeps its own sentence
first, "3.4 g: over the couch limit. The crew is taking injuries. 6 of 24 fit: the watches run at 52 %."); the send's cost clause reads
"Fire control drops to 70 % of its rate until she is back."; OD.Crew.teachFor(ship, partId) gives one sentence
for the case in hand ("A repair in vacuum is a jury-rig: the drive comes back to 70 %, never further." / "A
wrecked drive reaches 30 % in one shift and 70 % in a second." / "A wrecked radiator panel 1 is gone. No
jury-rig brings it back in a fight." / "A party valves tank 1 out of the feed: the venting stops, the plating
holds at 50 %, and what went out is gone."); casualties(ship, partId, severity, where): a boarding is priced by
the fit crews (T.boardShare 0.2 at full severity, a tenth of the smaller crew each way at equal strength; a
corvette taking a cruiser costs 2 on each deck) and logged "2 wounded in the boarding."; the radiator hold
names its cost ("pull the radiators in first. No cooling while they are in" on the row, the party line and the
toast; TEACH.inUse says a panel repair means the radiators in for the whole shift); the sick-bay line reads
"Party 1 in the sick bay · 16 wounded aboard."; crew.js partPhrase prefers OD.Damage.plainName when exported.

E round 2 done (09:06 UTC; engagement-check 166 checks, main-check green): the drive's heat is budgeted from the
thrust actually made at the three sites that read the lever (sustainedScale, sinkMargin, sinkWords now share
driveHeatNow(ship): driveHeat × ship.thrustFrac, the old expression × the full-sink quarter as the fallback), so
a crew-capped burn and a hand-throttled burn to the same acceleration read the same sustained scale, sink
margin and "the sink settles at 54 %"; fireWords adds the mount's clock ("Fire control at 70 %: no party on it.
The coilgun cycles every 8.6 s, not 6 s.", one decimal under 10 s), from the first mount with a cycle (a rack
with no cycling mount adds nothing), in both directions (a veteran watch reads "5.7 s, not 6 s").

DC round 2 done (09:10 UTC; damage-check 125 checks, crew-check and main-check green): OD.Damage.plainName
exported ("the drive", "radiator panel 1", "tank 1", "the spinal laser"; double capitals kept) and
OD.Damage.timeWords(seconds) ("45 s" under a minute, whole minutes from 60 s), the one repair-time format; one
rule for the state word, the jury-rig's reach per kind: 'damaged' while a party can still bring the part back,
'worn' when it is past a jury-rig's reach (worn always means repairable false), 'ok' only at 100 %, so a mount
reads "55 % · damaged" over "damaged, still firing" and "92 % · worn" over "worn, still firing" (the plan's flat
50 % could not give that reading); the venting line names the figure and the cure ("Tank 1 holed and venting:
12 km/s of delta-v going out through the hole until a party valves it out of the feed."); a panel repair's
price says the radiators are in for the shift ("cooling back to 85 %. 3 min, with the radiators in."). Knock-on
taken by the thread: the board's value test keys on the gain itself (20 points, a venting or wrecked part, the
drive or the reactor), since every mendable part now reads 'damaged'; the debrief lists worn parts too.

A round 2 done (09:15 UTC; art-check 61 checks, main-check green; js/shipart.js rebuilt by build.sh, sound
hulls pixel-identical over 7 hulls × 4 views × 6 radiator travel states): drawParties packs colliding rings
along the hull axis (2.15 ring radii between centres, an exact one-dimensional pack, never a relaxation) and
drops a time where a neighbour's rim is within 1.5 radii or the word would foul another (112 crowds, 672
rings: tightest gap 1.3 px, never an overlap; the phone hull view with five parties spreads them along the
hull); OD.ShipArt.lastParties() reports where the rings went; a hit radiator panel leans along the hull as well
as bending (0.5 rad damaged, 0.8 rad wrecked, aft on a sliding panel and forward on a folding one), so a plate
that is short and leaning has been hit while travel does one or the other (at a 120 px hull the hit plate lands
1.7 to 5.3 px off any travelling picture, against 0.1 px before on the corvette's side view); the timing check
warms draw and overlay, throws out any sample that built a sprite (cacheStats().builds) and asserts the 95th
percentile under 1 ms (measured 0.25 ms, worst 0.5 ms), with a cold build budgeted on its own at 90 ms (a 260 px
cruiser builds in 62 ms; the 3 ms the old check read was one build amortised over twenty warm draws).

D round 2 done (10:14 UTC; decisions.js 5669 lines, decisions-check 243 checks, main-check green; sweep 14 of 16
with the two carried cases; card texts in the check's output scratchpad/decisions-r2.out): a part the ship is
using never prints a repair time: the card is the trade ("The drive is hit, and she is burning." with "Cut the
drive for 6 min · acceleration at 70 %, turn rate at 85 %" against "Keep the burn · The drive stays at 40 % · we hold
the order we are flying"; "Radiator panel 1 is hit, and the radiators are out." with "Stow the panels for 3 min ·
cooling back to 85 % · the sink fills from 10 % to about 13 %" against "Keep them out"), the cut key setting the
throttle to 0 and holding, the stow key stowing the radiators, and a lit send never goes into a blocked part; no
repair or medical card when the mend is more than four times the hull life (T.mendStall 4), the hull-life clause
printed once and only once armour is measurably coming off ("Under this fire we have about 3m 52s."); "JCS
Greylag's sensor suite is hit."; the hard burn prices the whole cost capped at the fit crew ("every one of the 24
aboard hurt before we are alongside · nobody can answer a hit until we are alongside"); the option's price is the
board row's clause with the time in its own clause ("3 min · it keeps firing, and 2.7 times the damage to wreck
it") or " in 6 min" after a percentage, through OD.Damage.timeWords; every part phrase through
OD.Damage.plainName ("the coilgun"); the lesson above the keys is the case in hand (OD.Crew.teachFor, else built
from the cap); the assign sentence is logged under the Decision line; burn joins the settled kinds
(OD.Decisions.CREW_KINDS, d.crew; the band reads "Let the crew decide" on it); each option names the parts left
waiting; the repair window stays open while a part is still climbing toward the bar (chapter 2 on the
recommended pick raises its first card at 1325 s); the lit burn rung comes from what the rungs buy (a 40 s gap
lights 1.2 g, a 67 s gap the hard rung); the free-party branch applies the tank filter and the bar and asks
nothing when the free parties cover every part; the burn card is raised at the order that stops a running repair
("The order has stopped the repair." with "Throttle to 0 for 7 min" against "Press on", the throttle rung passive
and lit only with nothing shooting at her), for a hurt hull or wounded aboard past the couch limit, and for a
burn over the working limit longer than 10 min (T.strapLong 600; chapter 5 flown as an intercept raises it at
5 s: "Above 1.2 g the parties are in the couches, and this burn runs 29m 01s. Nothing can be repaired for any of
it."). The sweep: ch2 5s 30s is lost again (1841 s) because the earlier repair card moves the withdraw and heat
cards behind it; it is the run v12 documented as lost by three points, so it stays carried rather than put the
chapter's silence back. Carried from the reviewers' probe: chapters 4, 5 and 6 on the recommended pick never hurt
the flagship past the bar (best mend 0.10, 0, 0), so no repair card comes; that is the chapters' damage to change,
not the card's.
### Review round 3 (10:38 to 12:30 UTC 2026-09-21, the last round; six Opus reviewers, reports scratchpad/review/<lens>/round3-v13.md)

Round-2 findings: re-checked lens by lens, all but the in-use rule fixed (the card and the board priced it, the
fight still did not pay it). New findings, 43 (fun 8, writing 9, interestingness 6, engagement 7, graphics 7,
realism 6), 13 blocking; plan by owner scratchpad/review/FIX2-v13.md "## Round 3". The pattern this round: the
trade card met the next card and the ship's own routine. Blocking: (1) the repair card flipped between the trade
shape and the send shape second by second, because inUse followed the autopilot's throttle pulses, and the settle
answered the shape current, not the one the player read (interestingness); (2) the next card's lit pick relit the
drive or put the panels out over a party on the part, so the mend never landed (interestingness); (3) the card was
raised for a mend worth 0.4 points, the drive at 69.6 % against a 70 % cap (interestingness); (4) the board still
sold a clean repair time for a held part, with a colon inside a colon (writing); (5) the G-limit lesson quoted a
corvette's casualty rate as the rule while a cruiser took ten times that (writing); (6) keeping a venting tank was
priced as a level while the delta-v drained (writing); (7) on the recommended path no mend landed in any of seven
story chapters (engagement, the same root as 1 to 3, and the chapters' damage: see Carried); (8) chapter 5's burn
card priced a repair cost with nothing hurt and its soft rung's arrival was wrong by 25 minutes (engagement);
(9) the first-hit hint kept an unrepairable drive (fun); (10) a party sent into a lit drive waited the fight out on
a 70 % watch (fun); (11) the physics screen printed the rated 1.3 g and a six-minute transfer for a wrecked drive
(graphics); (12) "Cut the drive for 6 min" was forever: the order stayed hold and the radiators stayed in after
the mend landed (realism); (13) the burn card priced arrivals the tanks could not pay for, "alongside in 19m 30s"
beside "not enough Δv" (realism).

Design calls (thread, 11:00): only blocking findings fixed this round, plus majors that are a line in a file
already open. Trade-or-send is decided once at the raise and the settle runs the shape shown; an option that
would undo a running trade (relight the drive, extend the panels) carries "this puts party N's repair down" and is
never lit; the trade's act is restored when the mend lands or the party comes off (the order, the radiators'
auto), unless the bridge changed them meanwhile, and the cut key logs the order it stops; a party waits 60 s on a
running part and stands down to her station with a log line; inUse is stable over 5 s; a card needs T.mendWorth
of gain for any part but a venting tank; the routine never sends into a running part and pulls a watch only for
20 points, a venting tank or a wrecked part; a venting tank's keep option prints the rate; the burn card's crew
clause only when a part is repairable or wounded are aboard, its arrivals priced by the target's own motion and
budgeted by the ship's delta-v, a dry rung never lit; the board's held row prints the hold, then the buy, then
the time, and its button is the trade's own act; the G-limit lesson prints the share (1 in 12 a minute per g
over, twice above 5 g); Essentials folds "smaller jobs" and "past a jury-rig" in two clauses; no article on a
designated mount ("laser turret A"); an interceptor bay launches; the drive's words print acceleration and turn
rate as two numbers (the attitude thrusters carry half the turn); the physics screen prints the live
acceleration and says when there is no thrust; a boarding is decided by the decks (past two fit defenders to a
fit boarder the party is thrown back, with casualties, and no second try for ten minutes); an idle sick-bay party
is offered by Send. Carried into the next pass: chapter 5 never passes 3 g; a boarding party as a crew task;
chapters 3 to 6 on the recommended pick never hurt the flagship past the 30-point repair bar, so the repair card
and a landed mend are met only off that path (the chapters' damage, not the card's); the medical card prices only
what it buys and, in chapter 2, arrives after the last shot; the keep clause's capital and parts counted in words
on the band; fun's row order, idle-parties line and chapter 2's "keep" recommendation; the art's damaged bucket
at 0.5 rather than stateOf, parts with no hit look in some views, ring times dropped in a crowd; the stow
forecast's travel time and the rung's g as a snapshot; the taper between 1.2 g and 3 g and the 8-minute wrecked
drive; the plan's flip ring ignores drive damage (scaling flipTimeFor by turnFactor stalled a seeded chapter-4
run at the hour and is reverted, the attitude loop and the words keep it); the withdraw card raised at 100 % hull
in chapter 4 (265 s) whose lit key flips within the reading delay and sends the flagship on a retreat under fire.

Thread round 3 done (11:05 UTC; main-check green; probe scratchpad/v13/held-row-probe.js): ui.js hintWorth
needs a gain on the drive and reactor and a printed 100 % is not "hit"; the held row reads "Held: the drive has
to be cold, throttle to 0. Then a party swaps the burnt driver modules and brings the drive to 70 %: acceleration
and turn rate at 70 %, in 6 min." with the button "Cut the drive · party 3 works" (OD.Decisions.clearAndSend,
data-clear) or "Send party 3 · waits for the part" without it; the drive and reactor rows need 5 points of gain
for a button and the 20-point test is in whole points (a 60 % sensor suite is the 20-point job it prints as);
the collapse line is "1 smaller job: Tank 2 97 %." and "N parts past a jury-rig: ...", so Essentials never calls
a job Full sells "not worth a party"; the G-limit tip quotes the share; Help and the Decision tip say a burn
question carries a clock and a running part cannot be worked.

DC round 3 done (11:05 UTC; damage-check 132 checks, crew-check and main-check untouched): OD.Damage.plainName
drops the article from any name that ends in a designator, a number or a single capital letter, so a frigate's
board reads "laser turret A", "point-defence laser 1" and a lancer's "interceptor bay A", beside "radiator panel
1" and "tank 1" as before, while a bare name keeps it ("the coilgun", "the drive", "the spinal laser", "the
reactor"). An interceptor bay launches where every other mount fires, in consequence() and effect() alike: "it
keeps launching, and 1.5 times the damage to wreck it", "Interceptor bay 55 %: damaged, still launching" and
"Interceptor bay wrecked: nothing launches from it", the bay marked by its mount kind or its bay id so a report
row and a fleet record read it the same.

CR round 3 done (11:12 UTC; crew.js 943 lines, crew-check 186 checks, damage-check, main-check and
objectives-check green): a party left standing on a part the ship is using goes back to the station she left
after T.standDown = 60 s, with one log line ("Party 2 stands down from the drive: she is burning. Back on the
sensor watch." / "Party 1 stands down from radiator panel 1: the radiators are out. Back on fire control."), and
the part is held for T.autoAssign so the routine does not send her straight out again while the order stands;
the station she left is on the party record (p.from), a hand-sent party stands down exactly as a routine one, and
a party on a part she can work is left where she is. The drive's in-use test is stable: thrust now, an order
still asking for thrust (cmdThrottle, a manual order's own throttle, or the autopilot's plannedAccel while it
swings the nose onto the burn heading), or either within T.driveHold = 5 s, so a pulsed throttle no longer
flickers the block through the board, the card and the stand-down clock, and only the throttle at 0 for 5 s with
nothing asking for thrust is a cut. Each in-use reason is one clause with no colon and no second sentence ("the
drive has to be cold, throttle to 0", "the radiators have to be in"), so a caller sets it in a sentence of its
own, and what a panel repair costs for the whole shift stays in TEACH.inUse. TEACH.couchLimit gives the casualty
rate as a share of the crew, not a corvette's count ("about 1 in 12 of the crew are hurt every minute for every g
over, twice that above 5 g"): a corvette 1 of 24, a frigate 3 of 60, a cruiser 16 of 260 in a minute 0.8 g over.

Thread round 3, second part (11:25 UTC; main-check and objectives-check green; probes scratchpad/v13/
physics-wrecked-probe.js, boarding-probe.js): the physics screen prints the acceleration the simulation is using
("a = F/m = 30 MN × 50 % (the drive is hurt) / 2.3 kt = 6.52 m/s² (0.67 g)") and with a wrecked drive says "no
thrust: the drive is wrecked" in the acceleration box, the transfer box ("she cannot fly this transfer") and on
the plot, whose curves stay off; the damage-control toast sits under the hull sheet, never over it; an idle
sick-bay party (nobody wounded) is offered by Send as "Send party 2 · the sick bay"; the Parties strip scrolls at
whole lines. autopilot.js exports turnFactor(ship | fraction) = max(0.2, drive × 0.5 + 0.5), the rule the
attitude loop always flew, and flipTimeFor / turnTimeFor now fly the hurt drive's turn, so the plan's flip ring,
the physics screen and the drive tip ("the turn rate falls half as far: the attitude thrusters carry the rest")
agree with the sim. sim.js boarding is decided by the decks: past BOARD.odds = 2 fit defenders to a fit boarder
the party is thrown back ("Boarding ISV Resolve failed: 260 fit aboard her against our 24. The party is thrown
back, and it cost us 3 wounded, 1 lost and her crew 1 wounded."), the weapons come back ("boarding party back
aboard. Weapons free again.") and that hull leaves her alone for BOARD.retry = 600 s; when the prize is taken
the losing deck pays the larger share per head (a corvette pair: "cost us 1 wounded and her crew 3 wounded").

DC round 3, realism (11:15 UTC; damage-check 138 checks): the drive's words print the two numbers the model
has, because thrust goes with the drive and the turn does not (the attitude thrusters carry half of it): "Drive
20 %: acceleration at 20 %, turn rate at 60 %", a mend to 70 % buys "acceleration at 70 %, turn rate at 85 %",
and a wrecked drive reads "no acceleration, turn rate at 50 % on the attitude thrusters" instead of "no attitude
control". The second figure comes from OD.Autopilot.turnFactor, the number the attitude loop flies, so the
board, the card and the flip ring cannot disagree; without that module the words fall back to the single figure
they printed before, and "some thrust, slow turns" is retired because a drive jury-rigged to 30 % turns at 65 %.

D round 3 done (12:05 UTC; decisions.js 6 038 lines, decisions-check 265 checks, 31 new; main-check green). The
burn card's "Press on" stands the waiting party down through OD.Crew.release and logs the sentence it returns,
so nobody pays a watch for a party doing nothing; pressing again when the party has already gone says nothing.
The long-burn rung is one question a hull an engagement and its repeats are one log line each (chapter 5: one
card and three lines where there were three cards). The armour clause is measured over the last 60 s of fire in
5 s samples and is not printed under a minute; chapter 2 reads 10m 22s where it used to read 3m 52s off a single
burn-through. A repair card decides trade or send once, when it is raised, and keeps that shape for its life,
refreshing only its numbers; the settle runs the pick of the shape shown. While a party is on a part a trade
cleared, every key that would relight the drive or extend the panels carries "this puts party N's repair down"
and is never the lit pick (15 options). One bar for every part: a mend has to buy 30 points before a hurt part is
a question, a venting tank excepted, and rank decides only whether a watch may be pulled. What the trade's act
changed is recorded and put back when the mend lands or the party comes off, in one line ("The drive is at 70 %.
Back on keep range." / "Radiator panel 1 is at 70 %. The radiators are out again."), unless the bridge gave a new
order or radiator setting meanwhile; the cut key logs the order it stops ("Throttle to 0. The intercept stops
while the party works."), and a repair card whose part already has a party closes instead of lighting a second
send. A venting tank is priced by what is going ("Tank 1 keeps venting, about 4.2 km/s a minute"), never by the
level. Every rung of a burn is budgeted against the ship's delta-v and prints its own ("22.4 of 51.6 km/s"), a
rung the tanks cannot pay for says where it runs dry and is never lit, each rung's arrival is priced against the
target's own motion with the acceleration and the closing speed in place of a time where no honest time can be
had, and the crew clause prints only when a part is repairable or wounded are aboard ("Nothing aboard needs a
party. What the burn costs is propellant."). The hard rung's cost is the whole crew, "all 24 aboard wounded on
the way", and "alongside" once. The cripple card prices a boarding against the decks ("her 260 fit against our
24: the party would be thrown back") and never lights one the party would be thrown back from.
OD.Decisions.tradeWords and clearAndSend are exported for the board's held row, and the row's button runs the
card's own trade end to end (probe scratchpad/v13/clear-click-probe.js: "Cut the drive · party 3 works" →
"Throttle to 0. Holding the range stops while the party works." → the mend at 377 s → "Back on keep range.").

CR round 3, second part (12:27 UTC; crew.js 962 lines, crew-check 192 checks, main-check, objectives-check and
damage-check green): two rules for the routine. It never sends a party into a part the ship is using (that trade
is the card's to price: "The drive is hit, and she is burning", cut the drive or keep the burn) and looks at the
part again as soon as the ship has let go of it. And it pulls fire control or the sensor watch off station only
for a wrecked part, a venting tank, or a mend of T.watchGain = 0.2 (20 points of cap minus hp), the bar the board
puts a Send button on; with nobody standing by it only considers parts that clear that bar. A party standing by
still goes for any repairable gain, and a hand send is unchanged. Chapter 4 at 436 s had put the sensor watch on
a drive at 63 % against a 70 % cap while Larkspur was retreating at full throttle: 7 points of mend that could
not start, two minutes of the watch at 70 %, and a stand-down at 556 s; the seeded trace now keeps both parties
on station for the chapter. New numbers standDown 60, driveHold 5, watchGain 0.2.

CR round 3, third part (12:33 UTC; crew.js 967 lines, crew-check 193 checks, main-check and objectives-check
green): the routine's watch bar mirrors the board's Send bar point for point (ui.js worthIt): a wrecked part, a
venting tank, the drive or the reactor with T.vitalGain = 0.05 or more in the mend, any other part with
T.watchGain = 0.2 or more, counted in whole points the way the row prints them. A party standing by still goes
for any repairable gain, a hand send is unchanged, and a part the ship is using is still the card's.

Sweep after round 3 (12:26 to 12:33 UTC; scratchpad/sweep-r3b.out, sweep-cr14.out, sweep-vital0.out): 12 of 16 on
the recommended pick with the 3600 s clock. ch2 5s 30s and ch4 1s 0s are the two carried from round 2. ch4 1s 10s
(defeat at 756 s, trace scratchpad/v13/ch4-1s10s.txt) is the withdraw card raised at 100 % hull at 265 s whose
lit key flips to "Break off and open" inside the 10 s reading delay, and the retreat under fire at 1.3 g costs
the hull; carried above. ch4 5s 10s (defeat at 2159 s where it won at 1644 s) turns on whether the AI hulls'
routines pull a watch for 1 to 4-point mends: with vitalGain forced to 0 the same tree is 13 of 16 and that seed
is a win, while two other seeds win sooner with the bar in place; the traces are identical to 850 s and the
flagship's own parties never move before they split. That is a chaotic seed, not a rule, so the bar stays where
the board's is. The chapter probes on the recommended pick (scratchpad/v13/ch-rec-probe.js, ch3-rec.log,
ch4-rec.log) win chapters 3 and 4 with no part hurt past the repair bar.

D 31 (13:08 UTC; decisions-check 265 checks, all green): the sweep check carries four losses instead of two (ch4
1s 10s and ch4 5s 10s join ch2 5s 30s and ch4 1s 0s, each entry recording the outcome it was measured at alongside
its reason), so the check passes at 12 of 16 with 4 carried and fails on a fifth loss or on any carried seed that
starts losing a different way.

### Last scan (18:10 to 20:05 UTC 2026-09-22; Ethan: "do one last scan to make sure no errors or other major issues")

The scan ran on the working tree after checking the 22 scripts and index.html byte-identical to the live site.
Errors: a syntax pass over every script, tool and art source; a reference scan of every `OD.Module.member` (212
references, three unresolved but guarded, one of them wrong: sim.comebacks read `OD.Engagement.T`, which never
existed, for a floor whose fallback happened to equal the export; it reads `tuning` now); every check script and the
harness on the tree and on a served copy with the hosting headers; a headless crawl of 114 screens at 1440×900 and
390×844 with page errors, console errors, rejections, CSP violations and failed requests captured (none from the
game; the crawler's own staged card and the file:// font preloads only); 18 playthroughs on a served copy (every
chapter on the recommended pick, chapter 1 guided by its own hints, a two-hour four-a-side skirmish, three campaigns
through fights, transfers, refits and purchases: no error of any kind, chapters 2 to 8 won). Major issues: one round
of the six reviewers reading for blocking findings only (reports scratchpad/review/<lens>/scan-v13.md): 22 blocking
findings, every one a number, a promise or a flow the sim contradicted, none a crash.

Fixed (the thread, ui.js, sim.js, main.js, story.js, campaign.js, autopilot untouched): boarding priced from the two
crews everywhere (OD.Sim.boardingPlan: 90 s against an equal fit crew, longer against a bigger one, thrown back past
two to one; the crossing log says "1m 30s across", the tip, Help and chapter 2's prize hint say the rule); the
story's named officers (Lt. Ruiz, Cmdr. Adeyemi, Capt. Oyelaran, Adm. Marr) replaced by the ship or station speaking,
per the v13 principle; the hull view's radiator area (2 500 m², not 2.5 km²); the physics screen's flip time with a
hurt drive (turnFactor on the attitude authority, display only) and its cause for lost thrust (dry tanks, out of the
fight, wrecked drive, the drive's share, the crew's g limit, each named as itself); the Arrive row against a hull
under thrust ("not while she burns this hard", "if she coasts"); chapter 1's textbook transfer credits the closing
speed the ship starts with (2·sqrt(a·d + v²/2) − v plus the sideways speed, labelled flat space); chapter 1 ends when
Long Meridian is lost ('reach' fails on a destroyed hull); a finger held on a hostile keeps range on a phone (Help
promised it, chapter 2's hint now says it); chapter 4's opening hint in the order that works; the campaign map's
route costs drawn clear of the nodes. Workers: crew (a destroyed hull's people settled once: "24 lost with the
ship", crew-check 197); engagement (the interceptor's three masses on the physics screen); decisions (Opus worker D, eleven items, decisions-check 280 checks green, the seeded sweep 15 of 16 with one
carried): the Why paragraph in plain sentences with no meta text and no clause the card already carries; the cripple
card priced from boardingPlan (1m 30s for even crews, 6 min at 260 against 24, a boarding the decks would throw back
never lit); chapter 1's burn card with no hostile reads "Hold this range · no burn · we hold at 3 247 km · JCV Long
Meridian comes down in 1h 54m"; the withdraw card above half hull titles the armour clock ("Our armour lasts 2m 56s
at this fire"), says "half of it gone" only below half, and is not raised at all above 80 % hull unless that clock
is short; "Break off: she can match the burn" in place of "opening at 0 m/s"; the radiator trade's clear restores
the panels and the auto flag and says so, and its stow forecast is priced at the burn (56 %, not 14 %); chapter 5's
approach rung says "at 1.3 g she outruns us, and the range opens at 4 km/s" and promises no arrival; the jink card
is not raised under 12 s to the rounds and its clause prices the dodge against the miss window ("the dodge moves
59 m before they arrive, and a miss needs 140 m"); a break-off whose own clause prices the escape longer than the
armour lasts is never lit (Press on lit, the text saying nothing opens the range); "one of hers is still shooting
against nothing of ours". The sweep went from 12 of 16 to 15 of 16 on the way: ch2 5s 30s, ch4 1s 10s and ch4 5s
10s now win; ch4 1s 0s stays carried (defeat at 679 s, the division committing to a rung only its fastest hull can
stand on, from round 3). Barring the unpriced "this course never clears that" key as well lost ch4 1s 30s (the
fallback went past the barred break-off onto cover four minutes away against a 90 s clock), so only a priced
escape is barred and W5's label carries the rest.

Carried, with the reason: the one sweep loss above; the player's Auto radiator mode runs no rule on a player hull (the automatic
rule runs only under the computer's think; tried on a copy of the tree: the seeded sweep stayed at 12 of 16 but on a different four seeds, a change to every fight's first minutes that the last scan is not the place for; the trade's restore is fixed without it); the freighter can still be flown into Callisto when the
home order comes more than half an hour after the rendezvous (measured: a first order 60 to 300 s late wins, a home
order 5 to 30 min late wins); another hull's cards starve behind the flagship's in chapters 6 to 8 (the band prefers
the selected ship); campaign experience is granted after an abandoned fight; three graphics notes (Jupiter unlabelled
with Amalthea on it, a clamped threat label over the corner block at close zoom, the comms banner 5 px into the
phone panel); the radiators card can open lowercase and the repair card capitalises mid-line. Chapter 2 with no card
answered is lost by design (the approach and range cards do not settle: the player flies the ship).

## Graphics and polish (v15, 2026-09-22 21:45 UTC to 2026-09-23; Ethan: "one more graphic and polish pass with opus")

Defaults taken: "graphics" is the look of everything the player sees (the map and ships at every zoom, hull view,
portrait, bridge panels, console screens, hangar, configurator, effects, phone and laptop, one palette and one
type); "polish" is rough edges (alignment, spacing, hints, small wording faults, the carried v14 polish items), not
new mechanics. No combat, sensor, crew or physics number changed and no number a screen shows changed meaning; every
visual follows sim state. One writer per file: render.js, bridge.js, ui.js with index.html, configurator.js with
campaign.js went to Opus workers, one each, in two waves; the thread kept story.js, guide.js, main.js, util.js,
decisions.js, autopilot.js, engagement.js (one guard), the ship art core and SPEC.md.

Survey: 28 screens at 1440×900 and 390×844 plus close probes (skirmish, chapters 3, 5, 7, 8), ranked into 13 visible
faults and 5 look upgrades. The full change list, as built, is scratchpad CHANGES-v15.md; in short:

- The map: a contact carries an error bar from the sensor model (±range error along the line of sight, bearing
  error across it at that range, solid near the glyph, then dashed and fading, end ticks bright) in place of the pale
  searchlight wedge that read as a beam; no lens streak; a body off the clear map is a limb arc with an edge label
  ("JUPITER / JCS Harkness at altitude 181 000 km", on a phone "JUPITER · JCS Harkness 181 000 km up"); labels treat
  contact glyphs, bar ends and hulls as obstacles and drop lines before covering one; threat labels and chevrons
  stay in the clear map; a 12 px ring for the chapter 1 marker; the scale bar and its number together; brackets,
  pulses and sweeps hold still while paused; a selected hostile shows no plotted path (her orders are not ours to
  read).
- Panels: the map key has its own row and folds (Hide/Show, remembered; a folded row on the phone); a hull with no
  drive says "no drive" and drops the rows that printed NaN; hull view headers never clip and part labels go where
  the hull draws largest with no crossing leaders; long values wrap under their label; grouped numbers and
  percentages never split; the log fits its lines and names every speaker; the phone keys are 40 px or more; the
  salvo banner counts every launch at one ship; decision banners speak like comms lines; "Altitude X to Y" (or
  "X, circular") where the panel and navigator said "Orbit X × Y" for the same heights.
- Console and DOM screens: every DOM screen but the hull view sits in the bridge frame (corner brackets, header
  strip with SND, AA and Close, the tick ruler, uppercase titles); the chapters screen has a to-scale chart of the
  Jovian system with a numbered key at each chapter's place; the skirmish screen draws both fleets to one scale with
  class captions; the hangar draws the hull 1.25 to 1.7 times larger with labels in lanes; the demo scene keeps off
  the hero picture and text; no keyboard hints on a touch screen.
- Yard and campaign: captions and fitting options in full, balanced columns, two-press delete and restart whose
  keys and notes agree; campaign labels clear of Jupiter and of each other; unaffordable routes in amber with one
  line saying why.
- Words: the contact is described as a line, not a ring (help, chapter 2); chapter 3's brief says the frigates open
  fire when you arrive; chapters 7 and 8 give their altitude ("400 000 km above the planet"; "181 000 km above
  Jupiter, 70 000 km outside Amalthea's orbit", which is where the sim has always flown chapter 8); "switch to Hold"
  on a dead target; no full stop before a card's ship count; tour step 2 says "Tap Intercept" on a phone.

### Review round 1 (22:59 UTC 2026-09-22 to 00:05 UTC 2026-09-23; six Opus reviewers, reports scratchpad/review/<lens>/round1-v15.md)

Six blocking findings, all fixed: the chart placed chapters 7 and 8 by distance from Jupiter's centre where the
story and the sim use altitude (the fix adds Jupiter's radius; the chart caption says it measures from the centre);
help and a hint described a ring the map no longer draws; chapter 6 opened on an empty 5 km map when its first hint
appeared (a refit on one watched hull zoomed to the camera's 10 km floor: one hull is now panned, only a group is
fitted); labels covered contact glyphs; the phone chapter rows overlapped once a location wrapped; the phone map key
row printed over an edge label. Twenty major findings, seventeen fixed; the dispositions, one line each, are in
scratchpad review/round1-dispositions.md.

### Review round 2 (00:25 to 01:00 UTC 2026-09-23; the same six lenses, reports scratchpad/review/<lens>/round2-v15.md)

Three blocking findings, all fixed. On a phone a fit centred on the whole canvas when the clear strip was under a
quarter of its height, so our ship was framed under her panel or an open card (chapter 1 step 1 named the wrong
ship): a fit now always centres on the clear map and the floor limits the zoom only. Selecting a hostile drew her
rings and Follow on her true position and showed her turn arc, planned thrust and target line; the panel printed
her true altitude, delta-v, heat, damage and her navigator's orders (both already in v14). A hostile is now drawn,
ringed, followed and described only from our track: "Unknown hull" or her class, range ± error, one velocity
arrow from the track, and none of her orders. Eight major findings fixed (labels kept off the selected hull and
her ring, chapter 6's opening frame on the Lancers, tour step folding on 1366×768 and 1280×720 laptops, the
Active key's hit area, a campaign cost on the wrong route, the delete note out of sight, shift-click hints on a
phone, "alongside in never" on the boarding option). Dispositions: scratchpad review/round2-dispositions.md.

### Review round 3, the last (01:55 to 02:20 UTC 2026-09-23; the same six lenses, reports scratchpad/review/<lens>/round3-v15.md)

Every round-2 finding was confirmed fixed or better. Four new blocking findings, all one-line or small, all fixed:
on a phone the ship chapter 3's first card names had no label while another hull's label sat beside her (the ship
an open card is about and our target now keep their labels, as the hint's hull does, and a label placed nearer
another hull than its own gets a leader line); a hostile's panel labelled her sensor reach "Our sensors" (now "Her
sensors"); the phone hints for chapters 4, 7 and 8 read as a multi-select a phone does not have (now "Give each
ship the same order, one ship at a time: tap the ship, ..."); the slug card, held up to be read after its moment,
said "her coilgun still reaches 0 m" (it now says we are outside her coilgun). Majors fixed: a 1280×720 laptop with
a card open keeps the card's lesson behind Why?, and the tour step folds measuring from the comms banner; a
selected block sheds lines before it sits on another hull; the scale bar gives way when there is no room; a card
title keeps a proper noun ("JCS Larkspur: Conamara Station is under fire"); the panel names a contact as the list
does, with "Class unknown". Minors fixed: a bare contact draws no signature ring; boarding with no run reads "we
cannot get alongside her"; the cripple lesson says the hull is yours "if the party wins"; "(tap to select)" and no
X key in the phone hints; denser far dashes on long error bars; a filled head on edge arrows.

### Carried into the next pass (v15)

- Chapter 8 onto Amalthea's real orbit (altitude 111 000 km, not 181 000 km): it changes the chapter's orbital
  drift, a mechanics pass.
- A station's damage board lists a drive (damage.js gives every hull one; a mechanics pass decides).
- The plume and sensors.js plumePower follow commanded throttle, not delivered thrust; change both together.
- Phone: the first card in chapter 1 covers the tour step (one band on a phone), and the card gating itself.
- Card load (18 cards in 13 min in a skirmish, 9 in 21 min in chapter 3): a card-design pass.
- Framed DOM screens start at x 200 against 64 on the canvas screens, with no T+ clock.
- Part callouts "Spinal beam", "Rail pair", "Beam turrets" beside the mount names "Spinal laser", "Coilgun",
  "Defence laser": a naming pass across the art source and ships.js.
- A log line when a contact's own burn gives us the solution; ± on a bare contact's label (the bar carries it).
- A radiators row on a hostile's panel at track quality (the portrait shows them).
- Chapter 6's first two seconds frame before the hint band is counted (it settles by 2.5 s); on a phone in
  chapter 7 a tap cannot reach Anselm inside a 28 px cluster (the pick radius is 24 px).
- A few campaign route costs sit 18 to 32 px off their own line (the spot weight for the own line).
- Vector arrows start at the hull centre at art zoom; the map calls a Lancer a missile boat where the panel says
  interceptor carrier; four-digit ranges ungrouped in sensor log lines (the house format groups from 10 000).
- Carried from v14: chapter 4 at 1 s steps and 0 s reading delay, the one seeded sweep loss (15 of 16).
