/* Orbital Declaration — HUD, tooltips, Physics panel, screens. */
(function () {
  'use strict';
  const OD = window.OD;
  const U = OD.U, P = OD.P;
  const $ = (id) => document.getElementById(id);
  const esc = U.escapeHtml;

  let game = null;
  let panelShip = null;   // ship id the panel structure was built for
  let panelHasEng = false;
  let fleetKey = '';
  let lastRefresh = 0;
  let lastPhysRefresh = 0;
  let bound = {};
  let logCount = 0;

  // ------------------------------------------------------------------ tooltips
  const TIPS = {
    clock: { title: 'Mission clock', body: 'Time since the fight began. Closing 3 000 km at 1.3 g takes about 16 minutes, so most orders run for tens of minutes.' },
    warp: { title: 'Time warp', body: '1× is real time. 4×, 16× and 64× run the long coasts faster without changing the physics step, so nothing is skipped. A launch or a hit pulls time back to 1×.' },
    fit: { title: 'Fit all', body: 'Zoom out until every ship is on screen. Home does the same. Scroll to zoom, drag to pan, F to follow the selected ship.' },
    physics: { title: 'Physics panel', body: 'The numbers behind the selected ship, kept live: delta-v, transfer time and cost, heat, armour facing and orbit. P opens it.' },
    navigator: { title: 'Navigator', body: 'What the selected ship is doing now, and what it does next. The same look-ahead draws the plotted path on the map.' },
    plan: { title: 'Plotted path', body: 'Bright line: burning. Dashed: turning or coasting. Blue-grey: braking tail-first. The first ring is the flip, the second the arrival.' },
    detail: { title: 'Essentials or Full', body: 'Essentials shows what you need to fly and fight. Full adds mass, speed, heading, altitude, the systems bars and the gunnery rows. D switches between them.' },
    tip: { title: 'Tip', body: 'A suggestion for what to do next. It clears once you have done it.' },
    next: { title: 'Next event', body: 'The next thing the selected ship will do: finish a turn, flip, start braking, arrive. Time warp drops to 1× just before it so you can watch.' },
    skip: { title: 'Skip ahead', body: 'Run time at 64× until 20 s before the next event, then drop back to 1×.' },
    stopping: { title: 'Stopping distance', body: 'How far the ship travels while the drive cancels the closing speed, at d = v² / 2a. More than the range means you overshoot.', formula: 'd = v² / (2·a)' },
    vitals: { title: 'Vitals', body: 'Delta-v left, the range to the target, and how fast that range is closing. These three decide most orders.' },
    dv: (c) => (c.ship && !hasDrive(c.ship)
      ? { title: 'Delta-v remaining', body: 'She has no drive and no propellant. No burn can change her orbit.' }
      : { title: 'Delta-v remaining', body: 'The speed change the propellant aboard can still buy. Every burn spends it, and only a depot puts it back.', formula: c.ship ? 'Δv = vₑ · ln(m₀ / m₁)\n   = ' + U.fmt.speed(c.ship.exhaustVelocity) + ' · ln(' + U.fmt.mass(c.ship.mass()) + ' / ' + U.fmt.mass(c.ship.dryMass) + ')\n   = ' + U.fmt.dv(c.ship.deltaV()) : '' }),
    dvgauge: (c) => ({ title: 'Delta-v budget', body: 'The bar is the delta-v left against a full load. The hatched part is what the current order will spend.', formula: c.plan && c.plan.active ? 'this order: ' + U.fmt.dv(c.plan.dv) + ' of ' + U.fmt.dv(c.ship.deltaV()) + (c.plan.feasible ? '' : '  (not enough)') : '' }),
    accel: (c) => ({ title: 'Acceleration', body: 'Thrust divided by current mass. It rises as propellant burns off, and falls when the drive is damaged or the heat sink is full. The g limit you set for the crew caps it as well.', formula: c.ship ? accelFormula(c.ship) : '' }),
    mass: { title: 'Mass', body: 'Current mass, with the propellant left in brackets. A corvette leaves port about 60 % propellant by mass.' },
    speed: { title: 'Speed', body: 'Speed relative to the body you are orbiting. A ship parked in orbit is still doing kilometres per second.' },
    heading: { title: 'Heading', body: 'Where the nose points. Thrust leaves through the tail, so the autopilot turns the ship before every burn. A corvette takes about 21 s to swing 180°, a cruiser longer.' },
    orbit: { title: 'Altitude', body: 'Height above the surface at the low and high points of the current coast. A low point below the surface means the coast ends on the ground. On an escape path it is the height now.' },
    target: { title: 'Target', body: 'The ship your orders and readouts point at. Click a ship on the map or in the fleet list to set it.' },
    range: { title: 'Range', body: 'Straight-line distance to the target. Below a firing solution this is the estimate from our track, shown with its error.' },
    closing: { title: 'Closing speed', body: 'How fast the range is shrinking. Negative means the target is pulling away. Slugs and interceptors are aimed off this number. Beams are not.' },
    rendezvous: (c) => ({ title: 'Transfer estimate', body: 'Time and delta-v for the transfer, from a look-ahead that flies the order with the real autopilot. The ideal burn-flip-burn below is the least it could cost.', formula: 'ideal: time = 2·√(d / a) + flip,  Δv = 2·√(d · a)' + (c.est ? '\n     = ' + U.fmt.time(c.est.time) + ', ' + U.fmt.dv(c.est.dv) : '') }),
    arrive: { title: 'Arrival', body: 'When the current order reaches its goal: alongside for an intercept, inside the band for keep range. It counts down as the ship flies the plan.' },
    facing: { title: 'Facing', body: 'Which armour facet the target sees. The nose is thickest and the tail thinnest, so braking toward an enemy shows them the tail.' },
    order_intercept: { title: 'Intercept', body: 'Close with the target and arrive alongside at 2 km with the speed matched. The button shows the time and the delta-v it will cost.' },
    order_keeprange: { title: 'Keep range', body: 'Hold the range set below and match the target speed there. Inside the band the ship coasts nose-on and spends nothing.' },
    order_matchv: { title: 'Match velocity', body: 'Burn until your velocity matches the target, wherever you are. The range then stops changing.' },
    order_hold: { title: 'Hold', body: 'No burns. Coast on the current trajectory with the nose toward the target.' },
    order_retreat: { title: 'Retreat', body: 'Full burn straight away from the nearest hostile. It points the tail at them, and the tail carries the thinnest armour and the drive.' },
    order_manual: { title: 'Manual burn', body: 'Set the heading and the throttle yourself. The autopilot only handles the turn.' },
    jink: { title: 'Jink', body: 'Short sideways burns every 20 s. A slug takes about 60 s to cross 250 km, and a 2 s nudge at 10 m/s² moves you 1.2 km in that time, so it misses. Each nudge costs delta-v.', formula: 'miss ≈ a · t_burst · t_flight  (a 2 s nudge at 10 m/s² over a 60 s flight: about 1.2 km)' },
    vmax: { title: 'Cruise cap', body: 'Fastest lets the transfer run up to any speed. A cap holds the cruise at 3 km/s or 1.5 km/s, which arrives later and spends far less delta-v.' },
    heat: (c) => ({ title: 'Heat sink', body: 'The reactor, the drive and every beam shot put heat into the sink, and the radiators are the only way out. A full sink holds the drive to a quarter and stops every mount, point defence included, until it drains.', formula: c.ship ? 'in  ' + U.fmt.power(c.ship.idleHeat + c.ship.driveHeat * heatFrac(c.ship) + (c.ship.lastExtraHeat || 0)) + '\nout ' + U.fmt.power(c.ship.radiatorPower()) + '\nsink ' + U.fmt.energy(c.ship.heat) + ' / ' + U.fmt.energy(c.ship.sinkCapacity) : '' }),
    heatfc: { title: 'Heat forecast', body: 'When the sink fills or empties at the current heat in and heat out. Extending the radiators or cutting the throttle pushes that back.' },
    radiators: (c) => ({ title: 'Radiators', body: 'Extended, the radiators shed heat and the sink drains. Stowed, they shed nothing and the sink fills. They are the easiest part of the ship to hit, and take ' + ((c.ship && c.ship.radiatorDeployTime) || 25) + ' s to extend or stow.', formula: c.ship ? 'P = 2·A·ε·σ·T⁴ = 2 · ' + c.ship.radiatorArea + ' m² · 0.9 · σ · (' + c.ship.radiatorTemp + ' K)⁴ = ' + U.fmt.power(P.radiatorPower(c.ship.radiatorArea, c.ship.radiatorTemp)) : '' }),
    rad_auto: { title: 'Auto radiators', body: 'Extend above 70 % of the sink. Stow below 30 % with a hostile inside 600 km, and whenever their beams are on the radiators.' },
    hull: { title: 'Hull', body: 'Structural integrity. At zero the ship breaks up.' },
    hullview: { title: 'Hull view', body: 'Watch this ship live: the radiators, the mounts, the plume and the damage are what she is doing right now, from the side, from above or three-quarter. V opens it, and so does this portrait. Zooming in on the map shows the same.' },
    sys_drive: { title: 'Drive', body: 'Thrust scales with the drive. The turn rate falls half as far: the attitude thrusters carry the rest, so a drive at 20 % turns at 60 %.' },
    sys_radiators: { title: 'Radiator integrity', body: 'Damaged radiator area sheds less heat.' },
    sys_sensors: { title: 'Sensors', body: 'Tracking quality. Damaged sensors widen every aim.' },
    sys_weapons: { title: 'Weapons', body: 'Mount integrity, shared across the ship.' },
    boarding: () => { const b = (OD.Sim && OD.Sim.BOARD) || { range: 3000, speed: 25, time: 90, odds: 2 }; return { title: 'Boarding', body: 'Hold within ' + U.fmt.dist(b.range) + ' of a hostile at under ' + b.speed + ' m/s relative speed and your party crosses: ' + U.fmt.time(b.time) + ' against a crew the size of yours, longer against a bigger one. A crew more than ' + (b.odds === 2 ? 'twice' : b.odds + ' times') + ' yours throws the party back.' }; },
    follow: { title: 'Follow', body: 'Keep the camera centred on this ship. F does the same.' },
    weaponsfree: { title: 'Weapons free', body: 'Fire at the target with every mount in arc. Switch it off to hold fire, for instance to close for boarding or to keep the sink for the drive. Your other ships run their own bays. This one launches interceptors on your order (L or A).' },
    threats: { title: 'Threats', body: 'Interceptors and slugs inbound on this ship, with the time until they arrive and whether point defence can stop them first. The map draws each one with its countdown, and warp drops to 1× on every new launch.' },
    firecontrol: { title: 'Fire control', body: 'Beam mode, aim point and interceptor salvos for this ship. Each setting trades damage on the target against heat or interceptors spent.' },
    firemode: { title: 'Beam mode', body: 'Full fires every beam and fills the sink, then forces a cool-down with the drive at 25 %. Sustained holds the beams to what the radiators can shed, so they fire without a time limit but weaker. Hold keeps the beams cold, and the coilguns and bays still fire. B cycles.' },
    aim: { title: 'Aim point', body: 'Hull is the biggest target, so most of a shot lands. Radiators count only while theirs are out, and the drive only from the tail. Aiming at mounts kills their beams one at a time. A smaller part takes a smaller share of each shot. T cycles.' },
    salvo: { title: 'Salvo', body: 'Interceptors fly on their own delta-v and only reach the target inside the launch reach ring. Their point defence kills a few a minute, so a salvo larger than it can stop before arrival gets the rest through. Bays never reload.' },
    pd: { title: 'Point defence', body: 'Short-range beams that shoot at inbound interceptors inside the point-defence ring. Each mount kills at a fixed rate and draws on the same heat sink, so a big salvo or a full sink gets through.' },
    // v13: the board's three tooltips carry OD.Crew.TEACH, so the written lessons reach a player. Without the
    // crew module each falls back to the v13 first-cut text.
    damage: () => ({ title: 'Damage control', body: teach('juryRig', 'A party sent to a hurt part brings it to a jury-rig cap, never full: a wrecked drive to 30 %, a holed tank isolated.') + ' Parties come off fire control or the sensor watch, so each repair costs something. ' + teach('inUse', 'A party cannot work a part that is running: the drive has to be cold and the radiators in.') }),
    crew: () => ({ title: 'Crew', body: teach('parties', 'Parties are the hands you deploy: fire control, the sensor watch, a repair, the sick bay. Send one to a hurt part from the damage-control board, or press C.') + ' ' + teach('experience', 'A crew that brings the hull home gains a point of experience, up to 3.') }),
    gmode: () => ({ title: 'G limit', body: 'The acceleration the autopilot burns to: Work 1.2 g, Couches 3 g, or No limit. ' + teach('workLimit', 'Above 1.2 g the parties strap into the couches and repairs hold where they are.') + ' ' + teach('couchLimit', 'Above 3 g about 1 in 12 of the crew are hurt every minute for every g over, twice that above 5 g.') }),
    fleet_dv: { title: 'Bars', body: 'Delta-v left · heat sink headroom · hull.' },
    escape: { title: 'Escape line', body: 'Past this ring the target costs more delta-v than this ship has left.' },
    signature: (c) => ({ title: 'Signature', body: 'How loud this ship is to enemy sensors right now. A cold coasting hull radiates about 1 MW. Hot radiators are tens of megawatts, and a lit drive is gigawatts. The range they get a firing solution from grows with the square root of that power.', formula: c.sig ? 'P = plume ' + U.fmt.power(c.sig.plume) + ' + radiators ' + U.fmt.power(c.sig.radiators) + ' + hull ' + U.fmt.power(c.sig.hull) + ' = ' + U.fmt.power(c.sig.total) + (c.sf && c.sf.solution > 0 ? '\nsolution from ' + km(c.sf.solution) + (c.sf.by ? ' (' + c.sf.by + ')' : '') : '') : '' }),
    active: { title: 'Active sensor', body: 'Pulse and read the echo: a firing solution on everything inside its reach within seconds, however cold they are. Every ship out there gets the same solution on us, and the pulse heats the sink. S toggles it.' },
    track: { title: 'Track quality', body: 'What our sensors have on the target. A contact is a bearing and a rough range. A track adds the class and a fuzzy position. A solution is good enough to fire on, so the beams and coilguns open up. Closing the range raises it, and so does catching them burning.' },
    solution_in: { title: 'Solution in', body: 'How long until our track is good enough to fire on, at the current closing rate. "Not at this range" means we have to close, wait for them to burn, or go active.' },
    decision: { title: 'Decision', body: 'A choice the fight needs from you. Each key sets an ordinary order or fire-control setting, and the lit one is what the navigator advises. Later leaves the question open and time keeps running. A repair, sick-bay or burn question counts down to the moment the ship\'s routine settles it.' },
  };

  function tipContent(key) {
    const t = TIPS[key];
    if (!t) return null;
    if (typeof t === 'function') {
      const ship = selected();
      const target = ship && ship.target ? game.sim.byId(ship.target) : null;
      const ctx = { sim: game.sim, ship, target };
      if (ship && target) ctx.est = OD.Autopilot.estimate(ship, target);
      if (ship && OD.Guide) ctx.plan = OD.Guide.plan(game.sim, ship);
      if (ship && OD.Sensors && typeof OD.Sensors.signature === 'function') { try { ctx.sig = OD.Sensors.signature(ship); ctx.sf = typeof OD.Sensors.seenFrom === 'function' ? OD.Sensors.seenFrom(game.sim, ship) : null; } catch (e) { /* tip without numbers */ } }
      return t(ctx);
    }
    return t;
  }
  let tipKey = null, tipPos = { x: 0, y: 0 };
  function showTip(key, x, y) {
    const c = tipContent(key);
    const el = $('tooltip');
    if (!c) { el.hidden = true; tipKey = null; return; }
    tipKey = key; tipPos = { x, y };
    el.innerHTML = '<div class="tt-title">' + esc(c.title) + '</div><div class="tt-body">' + esc(c.body) + '</div>' + (c.formula ? '<div class="tt-formula">' + esc(c.formula) + '</div>' : '');
    el.hidden = false;
    placeTip(x, y);
  }
  function placeTip(x, y) {
    const el = $('tooltip');
    const w = el.offsetWidth, h = el.offsetHeight;
    let lx = x + 14, ly = y + 14;
    if (lx + w > window.innerWidth - 8) lx = x - w - 10;
    if (ly + h > window.innerHeight - 8) ly = y - h - 10;
    el.style.left = Math.max(4, lx) + 'px'; el.style.top = Math.max(4, ly) + 'px';
  }
  function tipRefresh() { if (tipKey) showTip(tipKey, tipPos.x, tipPos.y); }

  // ------------------------------------------------------------------ helpers
  function selected() { return game && game.sim && UI.selected ? game.sim.byId(UI.selected) : null; }
  function bar(cls, f, extra) { return '<div class="bar ' + cls + (extra ? ' ' + extra : '') + '"><i style="width:' + Math.round(U.clamp(f, 0, 1) * 100) + '%"></i></div>'; }
  // v13: a lesson written once in crew.js, read here. Without the module the tooltip keeps its own sentence.
  function teach(key, fallback) {
    const T = OD.Crew && OD.Crew.TEACH;
    const s = T && typeof T[key] === 'string' ? T[key] : '';
    return s || fallback;
  }
  // v13: the drive makes heat in proportion to the thrust it actually produces. sim.js parks that fraction on
  // the ship as thrustFrac, so a crew-capped burn makes less heat than the commanded throttle would; an older
  // sim with no such field falls back to the throttle.
  function heatFrac(ship) {
    if (!ship || !(ship.throttle > 0)) return 0;
    const f = ship.thrustFrac;
    return typeof f === 'number' && isFinite(f) ? U.clamp(f, 0, 1) : ship.throttle * (ship.systems ? ship.systems.drive : 1) * (ship.overheated ? 0.25 : 1);
  }
  // The acceleration tooltip: F/m as the quotient it is, then the crew's cap on its own line, then what the
  // drive is actually giving when damage or a full sink has taken it below both.
  function accelFormula(ship) {
    if (!hasDrive(ship)) return 'no drive: F = 0, so a = 0 at any mass';
    const m = ship.mass();
    const raw = m > 0 ? ship.thrust / m : 0;
    let f = 'a = F / m = ' + U.fmt.si(ship.thrust, 'N') + ' / ' + U.fmt.mass(m) + ' = ' + U.fmt.accel(raw);
    let cap = null;
    if (OD.Crew && typeof OD.Crew.accelCap === 'function') { try { cap = OD.Crew.accelCap(ship); } catch (e) { cap = null; } }
    if (typeof cap === 'number' && isFinite(cap) && cap > 0 && cap < raw - 1e-6) f += '\nthe crew g limit caps the burn at ' + U.fmt.accel(cap);
    const now = ship.accel();
    const held = cap != null && isFinite(cap) ? Math.min(raw, cap) : raw;
    if (isFinite(now) && now < held - 0.05) f += '\nthe drive gives ' + U.fmt.accel(now) + ' right now';
    return f;
  }
  function heatCls(load) { return load > 0.85 ? 'crit' : load > 0.5 ? 'warn' : ''; }
  function orderLabel(ship) {
    const o = ship.order || { type: 'hold' };
    const t = { intercept: 'intercept', keeprange: 'keep ' + (o.range ? U.fmt.dist(o.range) : ''), matchv: 'match speed', hold: 'hold', retreat: 'retreat', manual: 'manual ' + Math.round((o.throttle || 0) * 100) + '%', evade: 'evade', approach: 'coast in' }[o.type] || o.type;
    if (ship.destroyed) return 'lost'; if (ship.captured) return 'captured'; if (ship.disabled) return 'disabled';
    if ((OD.Ships.CLASSES[ship.cls].doctrine || {}).stationary) return 'station';
    // Sensors see a hostile's plume, not her orders.
    if (game && game.sim && ship.faction !== game.sim.playerFaction) return ship.throttle > 0.02 ? 'burning ' + ((ship.accel() * ship.throttle) / 9.80665).toFixed(1) + ' g' : 'coasting';
    return t + (ship.jink ? ' · jink' : '');
  }
  // v15: a hull built without a drive (the station: thrust 0, no tanks) against one whose drive is out
  function hasDrive(ship) { return !!ship && ship.thrust > 0; }
  function armourAllRound(ship) { const a = ship && ship.armour; return !!a && a.nose === a.flank && a.flank === a.tail; }
  // why a hull makes no thrust, as the end of a sentence ('the tanks are dry'); '' when she makes some
  function noThrustWhy(ship) { const n = thrustWhy(ship).none; return n ? n.replace(/^no thrust(: )?/, '') || 'no thrust' : ''; }
  function facetSeen(ship, target) {
    const rel = Math.abs(U.angleDiff(U.angleOf(U.sub(target.pos, ship.pos)), ship.heading));
    return rel < Math.PI / 4 ? 'nose' : rel > (3 * Math.PI) / 4 ? 'tail' : 'flank';
  }

  // ------------------------------------------------------------------ fleet list
  function buildFleet(sim) {
    const own = sim.ships.filter((s) => s.faction === sim.playerFaction);
    const others = sim.ships.filter((s) => s.faction !== sim.playerFaction);
    const key = sim.ships.map((s) => s.id + (s.faction) + (s.destroyed ? 'x' : '')).join('|');
    if (key === fleetKey) return;
    fleetKey = key;
    const row = (s) => '<div class="fleet-row' + (s.faction !== sim.playerFaction && s.faction !== 'CIV' ? ' hostile' : '') + '" data-ship="' + s.id + '" data-tip="fleet_dv" role="button" tabindex="0"><span class="name">' + esc(s.name) + '</span><span class="order" data-fo="' + s.id + '"></span><div class="bars">' + bar('dv', 1) + bar('heat', 1) + bar('hull', 1) + '</div></div>';
    $('fleetList').innerHTML = own.map(row).join('') + (others.length ? '<h3>Contacts</h3>' + others.map(row).join('') : '');
    $('fleetList').querySelectorAll('.fleet-row').forEach((el) => {
      const act = (ev) => { const s = game.sim.byId(el.dataset.ship); if (!s) return; if (s.faction === game.sim.playerFaction) game.select(el.dataset.ship, ev.shiftKey); else if (UI.selected) { game.setTarget(el.dataset.ship); UI.toast('Target: ' + s.name); } };
      el.addEventListener('click', act);
      el.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); act(ev); } });
      el.addEventListener('dblclick', () => { UI.select(el.dataset.ship); game.cam.follow = el.dataset.ship; });
    });
    legendFit();
  }
  function updateFleet(sim) {
    $('fleetList').querySelectorAll('.fleet-row').forEach((el) => {
      const s = sim.byId(el.dataset.ship); if (!s) return;
      el.classList.toggle('selected', s.id === UI.selected || (game.selection && game.selection.includes(s.id)));
      el.classList.toggle('disabled', s.disabled || s.destroyed);
      el.classList.toggle('lost', !!(s.destroyed || s.captured));
      el.classList.toggle('targeted', !!(UI.selected && game.sim.byId(UI.selected) && game.sim.byId(UI.selected).target === s.id));
      let fuzzy = false, word = '';
      if (OD.Sensors && s.faction !== sim.playerFaction && s.faction !== 'CIV' && !s.destroyed) { const tr = trackOf(sim, { faction: sim.playerFaction }, s); if (tr && isFinite(tr.q) && tr.q < ((OD.Sensors.T && OD.Sensors.T.solutionQ) || 2.7)) { fuzzy = true; word = tr.word; } }
      el.classList.toggle('fuzzy', fuzzy);
      el.querySelector('.order').textContent = fuzzy ? word + (word === 'track' ? ' · ' + orderLabel(s) : '') : orderLabel(s);
      const bars = el.querySelectorAll('.bar');
      const load = s.thermalLoad();
      // a hull with no drive has no delta-v bar at all, rather than a full one
      const full = s.deltaVFull();
      bars[0].style.visibility = hasDrive(s) ? '' : 'hidden';
      bars[0].firstChild.style.width = Math.round(U.clamp(full > 0 ? s.deltaV() / full : 0, 0, 1) * 100) + '%';
      bars[1].firstChild.style.width = Math.round((1 - load) * 100) + '%'; bars[1].className = 'bar heat ' + heatCls(load);
      bars[2].firstChild.style.width = Math.round(s.hull * 100) + '%'; bars[2].className = 'bar hull ' + (s.hull < 0.35 ? 'crit' : '');
    });
  }

  // ------------------------------------------------------------------ ship panel
  function buildPanel(ship, pic) {
    const sim = game.sim;
    const own = ship.faction === sim.playerFaction && !ship.captured || (ship.captured && ship.faction === sim.playerFaction);
    const control = ship.faction === sim.playerFaction && !ship.disabled && ship.role !== 'station';
    const cls = OD.Ships.CLASSES[ship.cls];
    const hasEng = !!OD.Engagement;
    // v15 round 3: a hostile gets what our sensors give on her, the level the hull view uses. Below a solution that
    // is her class as far as it is known, the track and the range with its error; at a solution her state as well.
    // Her orders are never shown: no navigator line, no target, transfer, arrival or stopping distance.
    if (pic === undefined) pic = hostilePic(sim, ship);
    const blind = !!pic && pic.level !== 'full';
    panelHasEng = panelKey(pic);
    // A scenario may narrow the controls it needs (chapter 1 teaches two orders); Full reveals the rest.
    const ctl = (sim.scenario && sim.scenario.controls) || {};
    const orderSet = ctl.orders || ['intercept', 'keeprange', 'matchv', 'hold', 'retreat', 'manual'];
    const adv = (ok) => (ok ? '' : ' data-adv');
    const anyHostile = sim.ships.some((s) => sim.isHostile(s, ship));
    // v15: a hull with no drive (a station) has no delta-v, no transfer and no stopping distance: those rows are
    // left out rather than printed as noughts and NaN. Armour the same on every facet reads 'all round'.
    const noDrive = !hasDrive(ship), allRound = armourAllRound(ship);
    let h = '';
    // her name is known (the list, the cards and the hints use it); what the track lacks is her class
    const shownName = ship.name;
    h += '<div class="head"><div><div class="name">' + esc(shownName) + '</div><div class="cls">' + esc(pic && !pic.classKnown ? 'Class unknown' : cls.name) + '</div></div><span class="badge ' + ship.faction + '">' + esc(OD.Ships.FACTIONS[ship.faction].short) + '</span></div>';
    h += '<div class="portrait-wrap"><canvas class="portrait" id="pPortrait" data-tip="hullview" title="Hull view (V)" role="button" tabindex="0" aria-label="Open the hull view of ' + esc(shownName) + '"></canvas><div class="head-tools"><button class="sm" id="pFollow" data-tip="follow">Follow<kbd>F</kbd></button><button class="sm" id="pDetail" data-tip="detail" aria-pressed="false">Full<kbd>D</kbd></button></div></div>';
    // Navigator: the plain-language line. For a hostile, our track on her in its place.
    if (pic) h += '<div class="section nav" data-v="nav" data-phase="track"><div class="nav-head"><span data-tip="track">Our track</span><span class="pill" data-v="ostate"></span></div><div class="nav-line" data-v="navtext"></div><div class="nav-sub" data-v="navsub"></div></div>';
    else h += '<div class="section nav" data-v="nav" data-phase="coast"><div class="nav-head"><span data-tip="navigator">Navigator</span><span class="pill" data-v="ostate"></span></div><div class="nav-line" data-v="navtext"></div><div class="nav-sub" data-v="navsub"></div><div class="tipline" data-v="navtip" data-tip="tip" hidden></div></div>';
    // Threats: hidden until something is inbound
    if (!blind) h += '<div class="section threats" data-v="thsec" hidden><div class="th-head"><span data-tip="threats">Threats</span><span class="pill" data-v="thlevel"></span></div><div class="th-line" data-v="thtext"></div><div class="kv" data-v="throws" style="margin-top:4px"></div></div>';
    // Vitals: the three numbers that matter most (for a hostile held as a solution, range and closing from our ship)
    if (!blind) h += '<div class="vitals" data-tip="vitals"><div><span class="k">Delta-v</span><span class="v" data-v="vdv"></span></div><div><span class="k">Range</span><span class="v" data-v="vrange"></span></div><div><span class="k">Closing</span><span class="v" data-v="vclose"></span></div></div>';
    // Signature: how loud we are, and the active sensor (v11; hidden until the sensor module is present)
    if (!blind) h += '<div class="sigrow" data-v="sigrow" hidden><span class="k" data-tip="signature">Signature</span><span class="v" data-v="sig"></span>' + (control ? '<button class="sm" id="pActive" data-tip="active" aria-pressed="false">Active<kbd>S</kbd></button>' : '') + '</div>';
    // Delta-v gauge
    if (!blind) h += '<div class="section"><div class="gauge-row"><span class="k" data-tip="dv">Delta-v (fuel)</span><span class="v" data-v="dv"></span></div>' +
      (noDrive ? '' : '<div class="gauge dv" data-tip="dvgauge"><i class="fill" data-v="dvfill"></i><i class="cost" data-v="dvcost"></i></div>' +
      '<div class="gauge-foot"><span data-v="dvplan"></span><span data-v="dvfull" class="dim"></span></div>') +
      '<div class="kv" data-adv>' +
      '<span class="k" data-tip="accel">Acceleration</span><span class="v" data-v="accel"></span>' +
      '<span class="k" data-tip="mass">Mass (propellant)</span><span class="v" data-v="mass"></span>' +
      '<span class="k" data-tip="speed">Speed</span><span class="v" data-v="speed"></span>' +
      '<span class="k" data-tip="heading">Heading</span><span class="v" data-v="heading"></span>' +
      (sim.body ? '<span class="k" data-tip="orbit">Altitude</span><span class="v" data-v="orbit"></span>' : '') +
      '<span class="k" data-tip="signature" data-v="sigsrck" hidden>Signature by source</span><span class="v" data-v="sigsrc" hidden></span>' +
      '<span class="k" data-tip="track" data-v="sensk" hidden>' + (ship.faction === sim.playerFaction ? 'Our sensors' : 'Her sensors') + '</span><span class="v" data-v="sens" hidden></span>' +
      '</div></div>';
    // Target (a hostile's target is her order: never shown)
    if (!pic) h += '<div class="section"><h4><span data-tip="target">Target</span><span class="pill" data-v="tstate"></span></h4><div class="kv">' +
      '<span class="k">Contact</span><span class="v" data-v="tname"></span>' +
      '<span class="k" data-tip="track" data-v="ttrackk" hidden>Track</span><span class="v" data-v="ttrack" hidden></span>' +
      '<span class="k" data-tip="solution_in" data-v="tsolk" hidden>Solution in</span><span class="v" data-v="tsol" hidden></span>' +
      (noDrive ? '' : '<span class="k" data-tip="rendezvous">Transfer</span><span class="v" data-v="test"></span>' +
      '<span class="k" data-tip="arrive">Arrive</span><span class="v" data-v="tarr"></span>' +
      '<span class="k" data-tip="stopping">Stop needs</span><span class="v" data-v="tstop"></span>') +
      '</div><div class="facing-row" data-tip="facing"><span class="k">They see</span>' +
      (allRound ? '' : '<svg class="facing" viewBox="0 0 64 24" width="64" height="24" aria-hidden="true"><polygon data-f="tail" points="3,7 16,7 16,17 3,17"/><polygon data-f="flank" points="17,6 44,6 44,18 17,18"/><polygon data-f="nose" points="45,6 61,12 45,18"/></svg>') +
      '<span class="v" data-v="tfacing"></span></div>' +
      '<div class="row" data-v="boardrow" hidden><label data-tip="boarding">Boarding</label><div class="bar" style="flex:1"><i data-v="boardbar" style="background:var(--good)"></i></div></div></div>';
    if (control) {
      h += '<div class="section"><h4>Orders</h4><div class="btnrow orders">' +
        '<button data-order="intercept" data-tip="order_intercept"' + adv(orderSet.includes('intercept')) + '><span>Intercept<kbd>I</kbd></span><small data-v="pv_intercept"></small></button>' +
        '<button data-order="keeprange" data-tip="order_keeprange"' + adv(orderSet.includes('keeprange')) + '><span>Keep range<kbd>K</kbd></span><small data-v="pv_keeprange"></small></button>' +
        '<button data-order="matchv" data-tip="order_matchv"' + adv(orderSet.includes('matchv')) + '><span>Match speed<kbd>M</kbd></span><small data-v="pv_matchv"></small></button>' +
        '<button data-order="hold" data-tip="order_hold"' + adv(orderSet.includes('hold')) + '><span>Hold<kbd>H</kbd></span><small>coast, no burn</small></button>' +
        '<button data-order="retreat" data-tip="order_retreat"' + adv(orderSet.includes('retreat')) + '><span>Retreat<kbd>R</kbd></span><small data-v="pv_retreat">full burn away</small></button>' +
        '<button data-order="manual" data-tip="order_manual"' + adv(orderSet.includes('manual')) + '><span>Manual</span><small>heading + throttle</small></button></div>' +
        '<div class="row"' + adv(orderSet.includes('keeprange')) + '><label data-tip="order_keeprange" for="pRange">Range km</label><input type="number" id="pRange" min="1" step="10" value="' + Math.round((ship.order.range || cls.doctrine.range || 200e3) / 1000) + '">' +
        '<select id="pVmax" data-tip="vmax" aria-label="Cruise cap"><option value="0">Fastest</option><option value="3000">Cap 3 km/s</option><option value="1500">Cap 1.5 km/s</option></select>' +
        '<button class="sm" id="pJink" data-tip="jink" aria-pressed="false"' + adv(anyHostile || ctl.jink) + '>Jink<kbd>J</kbd></button></div>' +
        '<div class="row" id="pManual" hidden><label for="pHeading">Heading</label><input type="range" id="pHeading" min="0" max="359" value="' + Math.round(((ship.heading * 180) / Math.PI + 360) % 360) + '"><span class="num" data-v="mhead" style="width:3em"></span></div>' +
        '<div class="row" id="pManual2" hidden><label for="pThrottle">Throttle</label><input type="range" id="pThrottle" min="0" max="100" value="0"><span class="num" data-v="mthr" style="width:3em"></span></div>' +
        '</div>';
    }
    if (!blind) h += '<div class="section"><h4><span data-tip="heat">Heat</span><span class="pill" data-v="hstate"></span></h4><div class="heatbar"><i data-v="heatbar"></i><b data-v="heatmark"></b></div><div class="kv">' +
      '<span class="k">Heat stored</span><span class="v" data-v="heat"></span>' +
      '<span class="k" data-tip="heatfc">Forecast</span><span class="v" data-v="heatfc"></span>' +
      '<span class="k" data-adv>Heat in / out</span><span class="v" data-adv data-v="heatio"></span>' +
      '<span class="k" data-tip="radiators">Radiators</span><span class="v" data-v="rad"></span></div>' +
      (own ? '<div class="btnrow" style="margin-top:6px"' + adv(anyHostile) + '><button class="sm" data-rad="1" data-tip="radiators">Extend</button><button class="sm" data-rad="0" data-tip="radiators">Stow</button><button class="sm" data-rad="auto" data-tip="rad_auto">Auto</button></div>' : '') +
      '</div>';
    if (blind) { /* no damage report below a solution: the hull view shows none either */ }
    else if (OD.Damage && OD.Damage.report) {
      h += '<div class="section" data-adv data-v="syssec"><h4><span data-tip="damage">Damage control</span><span class="pill" data-v="dmgstate"></span></h4>' +
        '<div class="crewline" data-v="crew" data-tip="crew"></div>' +
        (own ? '<div class="btnrow gmode" data-v="gmode" data-tip="gmode"><button class="sm" data-g="work">Work · 1.2 g</button><button class="sm" data-g="couches">Couches · 3 g</button><button class="sm" data-g="max">No limit</button></div><div class="gwords" data-v="gwords"></div>' : '') +
        '<div class="dmg" data-v="dmg"></div></div>';
    } else {
      h += '<div class="section" data-adv data-v="syssec"><h4>Systems</h4><div class="sysbars">' +
        ['hull', 'drive', 'radiators', 'sensors', 'weapons'].map((k) => '<span class="k" data-tip="' + (k === 'hull' ? 'hull' : 'sys_' + k) + '">' + k + '</span>' + bar('hull', 1) + '<span class="v" data-v="sys_' + k + '"></span>').join('') +
        '</div></div>';
    }
    if (hasEng && own) h += fcSection(anyHostile);
    if (!blind) h += '<div class="section blurb" data-adv>' + esc(cls.blurb) + '</div>';
    const panel = $('shipPanel');
    panel.innerHTML = h;
    panel.dataset.detail = UI.detail;
    panel.style.borderTop = '2px solid ' + OD.Ships.FACTIONS[ship.faction].color;
    panelShip = ship.id;
    bound = {};
    panel.querySelectorAll('[data-v]').forEach((el) => { bound[el.dataset.v] = el; });

    $('pFollow').addEventListener('click', () => { game.cam.follow = game.cam.follow === ship.id ? null : ship.id; });
    $('pDetail').addEventListener('click', () => { UI.setDetail(UI.detail === 'full' ? 'essentials' : 'full', true); });
    $('pPortrait').addEventListener('click', () => hullView());
    $('pPortrait').addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); hullView(); } });
    panel.querySelectorAll('[data-order]').forEach((b) => b.addEventListener('click', () => issueOrder(ship, b.dataset.order)));
    panel.querySelectorAll('[data-rad]').forEach((b) => b.addEventListener('click', () => { const m = b.dataset.rad; sim.setRadiators(ship.id, m === 'auto' ? 'auto' : m === '1'); }));
    // Damage control (v13): Send puts a free party on a hurt part, Recall takes it off; the g limit is one of three.
    const dmgEl = panel.querySelector('[data-v="dmg"]');
    if (dmgEl) dmgEl.addEventListener('click', (ev) => {
      const sh = selected(); if (!sh) return;
      const b = ev.target.closest('button[data-send],button[data-recall]');
      if (!b) {
        // a row click opens the hull view on this ship, where the party rings sit on the parts themselves
        if (ev.target.closest('.dmg-party')) return;
        if (ev.target.closest('.dmg-row')) hullView(sh.id);
        return;
      }
      if (!OD.Crew) return;
      let r = null;
      try {
        if (b.dataset.send) {
          const pid = freeParty(sh);
          // a held row's button is the trade card's own act (decisions.js clearAndSend): the drive cut or the
          // panels in, then the party on the part; without it the send is a send into a wait
          const clear = !!b.dataset.clear && !!pid && OD.Decisions && typeof OD.Decisions.clearAndSend === 'function';
          let did = false;
          if (clear) { try { did = !!OD.Decisions.clearAndSend(game.sim, sh, b.dataset.send, pid); } catch (e) { did = false; } }
          // the drive counts as in use for a few seconds after the cut (crew.js driveHold), and the player
          // just ordered that cut, so the "is waiting" toast for this part is not news: mark the hold seen
          if (did) { try { const q = OD.Crew.board(sh).parts.find((x) => x.id === b.dataset.send); (sh._heldSeen || (sh._heldSeen = {}))[b.dataset.send] = q && q.blocked ? String(q.blocked) : ''; } catch (e) { /* the row will say it */ } }
          if (did) r = null; else r = pid ? OD.Crew.assign(sh, pid, 'repair', b.dataset.send) : NO_PARTY;
        } else r = OD.Crew.release(sh, b.dataset.recall);
      } catch (e) { r = null; }
      if (r) toast(r, 2400);
      updateDamage(sh);
    });
    panel.querySelectorAll('[data-g]').forEach((b) => b.addEventListener('click', () => { if (!(OD.Crew && OD.Crew.setG)) return; let r = null; try { r = OD.Crew.setG(ship, b.dataset.g); } catch (e) { r = null; } if (r) toast(r, 2400); updateDamage(ship); }));
    if (control) {
      $('pRange').addEventListener('change', () => { if (ship.order.type === 'keeprange') { ship.order.range = Math.max(1, +$('pRange').value) * 1000; } });
      $('pVmax').value = ship.order.vmax ? String(ship.order.vmax) : '0';
      $('pVmax').addEventListener('change', () => { const v = +$('pVmax').value; ship.order.vmax = v || undefined; });
      $('pJink').addEventListener('click', () => { ship.jink = !ship.jink; });
      $('pHeading').addEventListener('input', () => { if (ship.order.type === 'manual') ship.order.heading = (+$('pHeading').value * Math.PI) / 180; });
      $('pThrottle').addEventListener('input', () => { if (ship.order.type === 'manual') ship.order.throttle = +$('pThrottle').value / 100; });
    }
    if (hasEng && own) {
      $('pWF').addEventListener('click', () => { ship.weaponsFree = !ship.weaponsFree; });
      updateFireControl(ship);
    }
    if ($('pActive')) $('pActive').addEventListener('click', () => toggleActive(ship));
  }
  function issueOrder(ship, type) {
    const sim = game.sim;
    const target = ship.target;
    const rangeKm = $('pRange') ? Math.max(1, +$('pRange').value) : 200;
    const vmax = $('pVmax') && +$('pVmax').value ? +$('pVmax').value : undefined;
    if ((type === 'intercept' || type === 'keeprange' || type === 'matchv' || type === 'approach') && !target) { UI.toast('Pick a target first: click a ship on the map or in the fleet list.'); return; }
    let order;
    switch (type) {
      case 'intercept': order = { type, target, range: 2000, vmax }; break;
      case 'keeprange': order = { type, target, range: rangeKm * 1000, vmax }; break;
      case 'matchv': order = { type, target }; break;
      case 'approach': order = { type, target, speed: vmax || 1500 }; break;
      case 'retreat': order = { type, target: sim.nearestHostile(ship) ? sim.nearestHostile(ship).id : null }; break;
      case 'manual': order = { type, heading: ship.heading, throttle: 0 }; if ($('pHeading')) $('pHeading').value = Math.round(((ship.heading * 180) / Math.PI + 360) % 360); if ($('pThrottle')) $('pThrottle').value = 0; break;
      default: order = { type: 'hold' };
    }
    sim.setOrder(ship.id, order);
    game.onOrder && game.onOrder(ship, order);
  }

  // ------------------------------------------------------------------ v8: threats, fire control, point defence, damage report
  // Everything below reads OD.Engagement / OD.Damage through typeof checks, so the panel degrades to the v7 rows
  // when a method is missing.
  const V8_CSS = [
    '.section.threats{border-left:3px solid var(--line-2);padding-left:10px}',
    '.section.threats.watch{border-left-color:var(--blue)}',
    '.section.threats.warn{border-left-color:var(--warn)}',
    '.section.threats.alert{border-left-color:var(--crit);animation:odThreat 1.1s ease-in-out infinite}',
    '@keyframes odThreat{0%,100%{background-color:transparent}50%{background-color:rgba(255,93,93,0.09)}}',
    '@media (prefers-reduced-motion: reduce){.section.threats.alert{animation:none;background-color:rgba(255,93,93,0.07)}}',
    '.th-head{display:flex;justify-content:space-between;align-items:center;font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:var(--dim);font-weight:600;margin-bottom:4px}',
    '.th-line{font-size:13.5px;font-weight:500;line-height:1.35}',
    '.th-line.alert{color:var(--crit)} .th-line.warn{color:var(--warn)}',
    '.kv.rows{display:block}',
    '.kv.rows .kvr{display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding:2px 0}',
    '.kv.rows .kvr .v{min-width:0}',
    '.kv.rows .kvr.long{display:block}',
    '.kv.rows .kvr.long .v{display:block;text-align:left;padding:1px 0 1px 10px;border-left:1px solid var(--line)}',
    '.nw{white-space:nowrap}',
    '.fc-row{display:flex;align-items:center;gap:6px;margin-top:7px;flex-wrap:wrap}',
    '.fc-row .lbl{font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--dim);min-width:40px;font-weight:600}',
    '.fc-row .seg{margin-right:0;flex-wrap:wrap}',
    '.fc-row .seg button{min-width:0;padding:4px 7px;font-size:11.5px}',
    '.fc-row .seg button:disabled{opacity:.4;cursor:default}',
    '.fc-note{flex-basis:100%;font-size:12px;color:var(--ink-2);line-height:1.35;margin-top:1px}',
    '.fc-row button.salvo{flex:1 1 auto;padding:4px 8px}',
    '.fc-row button.salvo small{display:block;font-family:var(--mono);font-size:10.5px;color:var(--dim);text-transform:none;letter-spacing:0;font-weight:400;margin-top:1px}',
    '.fc-row button.salvo.good small{color:var(--good)} .fc-row button.salvo.warn small{color:var(--warn)}',
    '.dmg{display:grid;grid-template-columns:auto 1fr auto;gap:4px 8px;align-items:center;font-size:12px}',
    '.dmg-row{display:contents}',
    '.dmg-past{grid-column:1/-1;color:var(--dim);font-size:11.5px;line-height:1.35;padding:2px 0 4px}',
    '.dmg-row .k{color:var(--dim);white-space:nowrap} .dmg-row .v{font-family:var(--mono);font-size:11.5px;text-align:right;white-space:nowrap}',
    '.dmg-row.damaged .k,.dmg-row.damaged .v,.dmg-row.isolated .k,.dmg-row.isolated .v{color:var(--warn)} .dmg-row.wrecked .k,.dmg-row.wrecked .v,.dmg-row.venting .k,.dmg-row.venting .v{color:var(--crit)}',
    // v13: a part under 100 % that a party can still mend reads 'worn': a row of its own, in the panel ink
    '.dmg-row.worn .k,.dmg-row.worn .v{color:var(--ink-2)} .dmg-row.worn .bar>i{background:var(--ink-2)}',
    '.dmg-row .bar{height:3px} .dmg-row.damaged .bar>i,.dmg-row.isolated .bar>i{background:var(--warn)} .dmg-row.wrecked .bar>i,.dmg-row.venting .bar>i{background:var(--crit)}',
    '.dmg-row>.k,.dmg-row>.bar,.dmg-row>.v{cursor:pointer}',
    '.dmg-row .dmg-fx{grid-column:1/-1;font-size:11.5px;color:var(--ink-2);margin:-2px 0 3px;padding-left:8px;border-left:2px solid var(--line-2);line-height:1.3}',
    '#shipPanel[data-detail="essentials"] .dmg-row[data-ok]{display:none}',
    '.crewline{font-size:12px;color:var(--ink-2);line-height:1.35;margin:2px 0 6px} .crewline:empty{display:none}',
    '.gmode{margin:0 0 4px} .gwords{font-size:11.5px;color:var(--dim);margin:0 0 6px;line-height:1.3} .gwords:empty{display:none}',
    '.dmg-row .dmg-party{grid-column:1/-1;display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px;font-size:11.5px;color:var(--ink-2);margin:-2px 0 4px;padding-left:8px;border-left:2px solid var(--line-2)}',
    '.dmg-row .dmg-party>span:not(.ring){flex:1 1 100%;min-width:0}.dmg-row .dmg-party>.ring+span{flex:1 1 0}',
    // v13: the same ring the hull wears — hollow, amber while the party works, steel while it is strapped in
    '.dmg-row .ring{width:14px;height:14px;border-radius:50%;flex:0 0 auto;background:conic-gradient(#ffbd52 var(--p,0%),rgba(168,186,209,0.30) 0);-webkit-mask:radial-gradient(circle at 50% 50%,transparent 4px,#000 4.6px);mask:radial-gradient(circle at 50% 50%,transparent 4px,#000 4.6px)}',
    '.dmg-row .ring.paused{background:conic-gradient(#a8bad1 var(--p,0%),rgba(168,186,209,0.22) 0)}',
    '.dmg-row .dmg-party button{margin-left:auto;flex:0 0 auto;white-space:nowrap}',
    '#dmgNoFree{color:var(--dim);font-size:11.5px;margin:-2px 0 6px}',
    '.dmg-empty{font-size:12px;color:var(--dim)}',
    '#legend .sw.pd{border-top:2px dashed var(--accent)} #legend .sw.reach{border-top:2px dashed var(--blue)}',
    '#legend .sw.inc{width:9px;height:9px;border:2px solid var(--crit);border-radius:50%;margin:0 6px}',
    '#legend .sw.ladder{height:7px;width:20px;border-top:0;border-left:2px solid var(--accent);border-right:2px solid var(--crit);margin-bottom:-4px}',
  ].join('\n');
  const LEGEND_V8 = [
    ['pd', 'point defence reach · ours teal, theirs red'], ['reach', 'interceptor reach · ours blue'], ['inc', 'incoming · time to arrival'], ['ladder', 'burn-through ranges'],
  ];
  function installV8() {
    if (!document.getElementById('odV8css')) { const st = document.createElement('style'); st.id = 'odV8css'; st.textContent = V8_CSS; document.head.appendChild(st); }
    const lg = $('legend');
    if (lg && !lg.querySelector('.sw.pd')) {
      for (const [cls, text] of LEGEND_V8) { const row = document.createElement('div'); row.className = 'lg-row'; row.innerHTML = '<i class="sw ' + cls + '"></i>' + esc(text); lg.appendChild(row); }
    }
  }
  const FIRE_MODES = [['fire_full', 'Full'], ['fire_sustained', 'Sustained'], ['fire_hold', 'Hold']];
  const AIMS = [['aim_hull', 'Hull'], ['aim_radiators', 'Radiators'], ['aim_drive', 'Drive'], ['aim_mounts', 'Mounts']];
  const SALVOS = [['launch2', 'Launch 2', 2, 'L'], ['launch4', 'Launch 4', 4, '⇧L'], ['launchAll', 'Launch all', 'all', 'A']];
  function engActs(ship) { try { return (OD.Engagement && OD.Engagement.panelActions && OD.Engagement.panelActions(ship)) || []; } catch (e) { return []; } }
  function actById(acts) { const m = {}; for (const a of acts) m[a.id] = a; return m; }
  function fcSection(anyHostile) {
    return '<div class="section" id="pEng"' + (anyHostile ? '' : ' data-adv') + '><h4><span data-tip="firecontrol">Fire control</span><button class="sm" id="pWF" data-tip="weaponsfree" aria-pressed="false">Weapons free<kbd>W</kbd></button></h4>' +
      '<div class="kv rows" data-v="engrows"></div>' +
      '<div class="fc-row" data-v="fcmode" hidden><span class="lbl" data-tip="firemode">Beams</span><span class="seg" data-v="fcmodeseg"></span><span class="fc-note" data-v="fcmodenote"></span></div>' +
      '<div class="fc-row" data-v="fcaim" hidden><span class="lbl" data-tip="aim">Aim</span><span class="seg" data-v="fcaimseg"></span><span class="fc-note" data-v="fcaimnote"></span></div>' +
      '<div class="fc-row" data-v="fcsalvo" hidden><span class="lbl" data-tip="salvo">Salvo</span><span class="btnrow" style="flex:1" data-v="fcsalvobtns"></span></div>' +
      '<div class="kv rows" style="margin-top:6px" data-v="pdrows"></div>' +
      '<div class="btnrow" style="margin-top:6px" data-v="engbtns"></div></div>';
  }
  function bindSeg(host, items, ship, keyFor) {
    host.innerHTML = items.map(([id, name]) => '<button data-eng="' + id + '"' + (keyFor && keyFor(id) ? '' : '') + '>' + esc(name) + '</button>').join('');
    host.querySelectorAll('[data-eng]').forEach((b) => b.addEventListener('click', () => { game.sim.engagementAction(ship, b.dataset.eng); if (OD.Sound) OD.Sound.play('key'); }));
  }
  // Builds the fire-control groups once per ship and keeps their active state, notes and estimates fresh.
  function updateFireControl(ship) {
    if (!bound.engbtns || !OD.Engagement) return;
    const sim = game.sim;
    const acts = engActs(ship), by = actById(acts);
    const hasMode = FIRE_MODES.some(([id]) => by[id]), hasAim = AIMS.some(([id]) => by[id]), hasSalvo = SALVOS.some(([id]) => by[id]);
    if (bound.fcmode) {
      bound.fcmode.hidden = !hasMode;
      if (hasMode) {
        if (!bound.fcmodeseg.dataset.built) { bindSeg(bound.fcmodeseg, FIRE_MODES, ship); bound.fcmodeseg.dataset.built = '1'; }
        let note = '';
        bound.fcmodeseg.querySelectorAll('[data-eng]').forEach((b) => { const a = by[b.dataset.eng]; b.classList.toggle('active', !!(a && a.active)); b.disabled = !a; b.title = a && a.tip ? a.tip : ''; if (a && a.active && a.tip) note = a.tip; });
        { const nn = nbPct(note); if (bound.fcmodenote.textContent !== nn) bound.fcmodenote.textContent = nn; }
      }
    }
    if (bound.fcaim) {
      bound.fcaim.hidden = !hasAim;
      if (hasAim) {
        if (!bound.fcaimseg.dataset.built) { bindSeg(bound.fcaimseg, AIMS, ship); bound.fcaimseg.dataset.built = '1'; }
        let note = '';
        bound.fcaimseg.querySelectorAll('[data-eng]').forEach((b) => { const a = by[b.dataset.eng]; b.classList.toggle('active', !!(a && a.active)); b.disabled = !a; b.title = a && a.tip ? a.tip : ''; if (a && a.active && a.tip) note = a.tip; });
        { const nn = nbPct(note); if (bound.fcaimnote.textContent !== nn) bound.fcaimnote.textContent = nn; }
      }
    }
    if (bound.fcsalvo) {
      bound.fcsalvo.hidden = !hasSalvo;
      if (hasSalvo) {
        const key = SALVOS.filter(([id]) => by[id]).map(([id]) => id + ':' + by[id].label).join('|');
        if (bound.fcsalvobtns.dataset.key !== key) {
          bound.fcsalvobtns.dataset.key = key;
          bound.fcsalvobtns.innerHTML = SALVOS.filter(([id]) => by[id]).map(([id, name, n, k]) => '<button class="sm salvo" data-eng="' + id + '"><span>' + esc(by[id].label || name) + '<kbd>' + k + '</kbd></span><small></small></button>').join('');
          bound.fcsalvobtns.querySelectorAll('[data-eng]').forEach((b) => b.addEventListener('click', () => { game.sim.engagementAction(ship, b.dataset.eng); }));
        }
        const target = ship.target ? sim.byId(ship.target) : null;
        bound.fcsalvobtns.querySelectorAll('[data-eng]').forEach((b) => {
          const a = by[b.dataset.eng]; const def = SALVOS.find(([id]) => id === b.dataset.eng);
          b.title = a && a.tip ? a.tip : '';
          let est = '', cls = '';
          if (target && !target.destroyed && OD.Engagement.salvoEstimate) {
            let n = def[2];
            if (n === 'all') { const m = /\((\d+)\)/.exec((a && a.label) || ''); n = m ? +m[1] : null; }
            let e = null; if (n) { try { e = OD.Engagement.salvoEstimate(sim, ship, target, n); } catch (err) { e = null; } }
            if (e) {
              if (!e.reach) { est = 'out of reach'; cls = 'warn'; }
              else { const th = e.through != null ? e.through : null; est = (e.flightTime != null ? U.fmt.time(e.flightTime) + ' flight' : '') + (th != null ? ' · ' + th + ' through' : ''); cls = th === 0 ? 'warn' : th > 0 ? 'good' : ''; }
            }
          } else if (!target) est = 'no target';
          const sm = b.querySelector('small'); if (sm && sm.textContent !== est) sm.textContent = est;
          b.className = 'sm salvo' + (cls ? ' ' + cls : '');
        });
      }
    }
    // point defence
    if (bound.pdrows) {
      let html = '';
      if (OD.Engagement.pdReport) {
        let r = null; try { r = OD.Engagement.pdReport(ship); } catch (e) { r = null; }
        if (r && r.mounts > 0) {
          const v = r.live + ' of ' + r.mounts + (r.engaging ? ' · ' + r.engaging + ' engaging' : '') + (r.ratePerMin ? ' · stops ' + Math.round(r.ratePerMin) + '/min' : '') + (r.kills ? ' · ' + r.kills + ' kills' : '');
          html = kvRow('Point defence', v, { tip: 'pd', cls: r.live === 0 ? 'crit' : r.engaging ? 'warn' : '', width: rowsWidth(bound.pdrows) });
        }
      }
      // the crew on the mounts and on the sensors (v13): one row each when the watch is off its rated value
      const sh = OD.Engagement.shared;
      let fw = '';
      if (sh && typeof sh.fireWords === 'function') { try { fw = sh.fireWords(ship) || ''; } catch (e) { fw = ''; } }
      for (const words of [fw, sensorWatchWords(ship)]) html += crewWatchRow(words, rowsWidth(bound.pdrows));
      if (bound.pdrows.innerHTML !== html) bound.pdrows.innerHTML = html;
    }
    // anything else the module offers (legacy 'launch' / 'holdbeams', or new ids) stays a plain key row
    const known = new Set([].concat(FIRE_MODES, AIMS, SALVOS).map(([id]) => id));
    if (hasSalvo) known.add('launch');
    if (hasMode) known.add('holdbeams');
    const rest = acts.filter((a) => !known.has(a.id));
    const key = rest.map((a) => a.id + ':' + a.label).join('|');
    if (bound.engbtns.dataset.key !== key) {
      bound.engbtns.dataset.key = key;
      bound.engbtns.innerHTML = rest.map((a) => '<button class="sm" data-eng="' + esc(a.id) + '" title="' + esc(a.tip || '') + '">' + esc(a.label) + '</button>').join('');
      bound.engbtns.querySelectorAll('[data-eng]').forEach((b) => b.addEventListener('click', () => game.sim.engagementAction(ship, b.dataset.eng)));
    }
    bound.engbtns.querySelectorAll('[data-eng]').forEach((b) => { const a = by[b.dataset.eng]; b.classList.toggle('active', !!(a && a.active)); });
  }
  // Burn-through rows: at what range each side's beams start to put energy through the facet the other shows.
  function burnRows(ship) {
    const sim = game.sim, E = OD.Engagement;
    if (!E || !E.reach || !OD.Render.facetShown) return [];
    const target = ship.target ? sim.byId(ship.target) : null;
    if (!target || target.destroyed || target.faction === ship.faction) return [];
    let r = null; try { r = E.reach(sim, ship, target); } catch (e) { r = null; }
    if (!r || !r.beams) return [];
    // the range in these rows is what our track says, not the truth: below a solution the 'to go' figure is unknown
    let range = U.dist(ship.pos, target.pos), fuzzy = false;
    if (OD.Sensors && sim.isHostile(target, ship)) { const tr0 = trackOf(sim, ship, target); if (tr0 && tr0.est && tr0.est.pos && tr0.q < ((OD.Sensors.T && OD.Sensors.T.solutionQ) || 2.7)) { range = U.dist(ship.pos, tr0.est.pos); fuzzy = true; } }
    const theirs = OD.Render.facetShown(ship, target), ours = (r.their && r.their.facet) || OD.Render.facetShown(target, ship);
    const word = (d, facet) => {
      if (!(d > 0)) return 'never: armour too thick';
      if (fuzzy) return facet + ' · inside ' + U.fmt.dist(d) + ' · our range is a guess';
      if (range <= d) return facet + ' · now, out to ' + U.fmt.dist(d);
      return facet + ' · inside ' + U.fmt.dist(d) + ' · ' + U.fmt.dist(range - d) + ' to go';
    };
    const thr = (E.shared && E.shared.throttleTip) ? ' ' + E.shared.throttleTip : '';
    const rows = [{ label: 'Our beams burn through', value: word(r.beams[theirs], 'their ' + theirs), tip: 'The range inside which our beams burn through the facet they are showing us. Inside it, every second on target takes hull off them.' + thr }];
    if (r.their && r.their.beams) rows.push({ label: 'Their beams burn through', value: word(r.their.beams[ours], 'our ' + ours), tip: 'The range inside which their beams burn through the facet we are showing them. Stay outside it, or turn the nose to them.' + thr });
    return rows;
  }
  // Threat band: one plain sentence from the engagement module plus the numbers behind it.
  function updateThreats(ship) {
    if (!bound.thsec) return;
    const sim = game.sim;
    let s = null;
    if (OD.Engagement && OD.Engagement.threatSummary) { try { s = OD.Engagement.threatSummary(sim, ship); } catch (e) { s = null; } }
    if (!s || !s.level || s.level === 'none') { bound.thsec.hidden = true; return; }
    bound.thsec.hidden = false;
    bound.thsec.className = 'section threats ' + s.level;
    if (bound.thlevel) { bound.thlevel.textContent = s.level === 'alert' ? 'incoming' : s.level; bound.thlevel.className = 'pill ' + (s.level === 'alert' ? 'crit' : s.level === 'warn' ? 'warn' : 'good'); }
    if (bound.thtext) { if (bound.thtext.textContent !== (s.text || '')) bound.thtext.textContent = s.text || ''; bound.thtext.className = 'th-line ' + s.level; }
    if (bound.throws) {
      const rows = [];
      if (s.incoming) rows.push(['Inbound', s.incoming + (s.incoming === 1 ? ' interceptor' : ' interceptors') + (s.firstEta != null ? ' · first in ' + U.fmt.time(s.firstEta) : ''), s.firstEta != null && s.firstEta < 20 ? 'crit' : 'warn', s.incoming + (s.incoming === 1 ? ' interceptor' : ' interceptors') + (s.firstEta != null ? ' in ' + U.fmt.time(s.firstEta) : '')]);
      if (s.slugs) rows.push(['Slugs', s.slugs + ' in flight', 'warn', s.slugs + (s.slugs === 1 ? ' slug' : ' slugs')]);
      if (s.incoming && s.pdMounts != null) rows.push(['Point defence', s.pdMounts ? (s.pdCanStop ? 'can stop them' : 'cannot stop them all') + (s.pdRatePerMin ? ' · ' + Math.round(s.pdRatePerMin) + '/min' : '') : 'none aboard', s.pdMounts && s.pdCanStop ? 'good' : 'crit', s.pdMounts ? (s.pdCanStop ? 'point defence holds' : 'point defence cannot stop them all') : 'no point defence']);
      // on a phone the stacked rows push the rest of the panel down: one merged line instead
      const merged = window.innerWidth < 900 && rows.length > 1;
      const html = merged
        ? '<span class="v ' + (rows.some((r) => r[2] === 'crit') ? 'crit' : 'warn') + '" style="grid-column:1/-1;white-space:normal">' + esc(rows.map((r) => r[3]).join(' · ')) + '</span>'
        : rows.map(([k, v, c]) => '<span class="k">' + esc(k) + '</span><span class="v ' + c + '">' + esc(v) + '</span>').join('');
      if (bound.throws.innerHTML !== html) bound.throws.innerHTML = html;
    }
  }
  // The damage-control board (v13): every part with its state, the party on it with a ring and a time, Send and
  // Recall on the parts a party can improve, the crew line and the g limit. Essentials shows only what is hurt.
  function crewBoard(ship) {
    if (!(OD.Crew && typeof OD.Crew.board === 'function')) return null;
    try { return OD.Crew.board(ship) || null; } catch (e) { return null; }
  }
  // v13: the sensor watch said the way engagement.js says fire control, from OD.Crew.sensorFactor and the crew
  // record. Empty at 1: a full watch has nothing to report. sensors.js scales track gain by the same number.
  function sensorWatchWords(ship) {
    if (!(OD.Crew && typeof OD.Crew.sensorFactor === 'function') || !ship) return '';
    let f = 1;
    try { f = OD.Crew.sensorFactor(ship); } catch (e) { return ''; }
    if (!(typeof f === 'number' && isFinite(f) && f > 0) || Math.abs(f - 1) < 1e-9) return '';
    const c = ship.crew || null;
    const parties = c && Array.isArray(c.parties) ? c.parties : null;
    const overCouch = c ? (c.overCouch == null ? !!c.strapped : !!c.overCouch) : false;
    let why;
    if (parties && !parties.some((p) => p && p.task === 'sensors')) why = 'no party on it.';
    else if (c && c.total > 0 && c.fit * 3 < c.total) why = 'fewer than a third of the crew are fit.';
    else if (overCouch) why = 'the crew is over the couch limit.';
    else if (f > 1) why = 'a veteran crew.';
    else why = 'the watch is short-handed.';
    return 'Sensor watch at ' + U.fmt.pct(f) + ': ' + why;
  }
  // "Fire control at 70 %: no party on it." → a key-and-value row beside the point-defence rows.
  function crewWatchRow(words, width) {
    if (!words) return '';
    const i = words.indexOf(':');
    const k = i > 0 ? words.slice(0, i) : 'Fire control', v = i > 0 ? words.slice(i + 1).trim() : words;
    const pct = /at (\d+) %/.exec(k);
    return kvRow(k, v, { tip: 'crew', cls: pct && +pct[1] < 100 ? 'warn' : '', width });
  }
  // v15: a key-and-value row of the fire-control block. A value that fits beside its key sits on the key's line,
  // right-aligned; a longer one ('holding: out of burn-through range (928 km)') takes the full width on the line
  // under its key instead of wrapping into a column a few words wide. The test is the width the two need in the
  // panel's fonts (13 px sans for the key, 13 px mono at 0.6 em a figure for the value).
  // a number never parts from its unit: the space between a figure and the unit after it becomes a no-break space
  // (the unit list configurator.js keeps its engineer's lines whole with), so 'turn rate at 72' / '%' and '60' / 'kt'
  // cannot happen, and a ± stays with the figure after it ('±' / '770 km')
  const KEEP_UNIT = /(\d) (?=(?:%|kt|kg|km\/s|m\/s|km|cm|m²|[kMG]?[WJN]|[tmsKg])(?![\w²]))/g;
  function nbPct(t) { return String(t).replace(KEEP_UNIT, '$1\u00a0').replace(/± (?=\d)/g, '±\u00a0'); }
  // in HTML a number with thousands groups (their thin space is a break opportunity) sits in one span that never
  // wraps, with its ± and its unit; the words are unchanged apart from the no-break spaces
  function keepNums(html) { return nbPct(html).replace(/(?:±\u00a0)?\d+(?:\u2009\d{3})+(?:\u00a0[a-zµ%][a-zA-Z\/²]*)?/g, (m) => '<span class="nw">' + m + '</span>'); }
  // a decision card sentence gets the same treatment ('about 1 100 km' never breaks after the 1); the words are
  // written only when they change
  function setKept(el, v) { v = v || ''; if (el.dataset.t === v) return; el.dataset.t = v; el.innerHTML = keepNums(esc(v)); }
  function kvRow(k, v, o) {
    o = o || {};
    const width = o.width || 280;
    const long = String(k).length * 6.9 + 12 + String(v).length * 7.8 > width;
    return '<div class="kvr' + (long ? ' long' : '') + '"' + (o.adv ? ' data-adv' : '') + '><span class="k"' + (o.tip ? ' data-tip="' + esc(o.tip) + '"' : '') + (o.title ? ' title="' + esc(o.title) + '"' : '') + '>' + esc(k) + '</span><span class="v' + (o.cls ? ' ' + o.cls : '') + '">' + keepNums(esc(v)) + '</span></div>';
  }
  function rowsWidth(el) { const w = el ? el.clientWidth : 0; return w > 0 ? w : 280; }
  // The party Send takes: a standby party first, then a sick-bay party with nobody left to treat, then the
  // sensor watch, then fire control (a sick bay with wounded in it stays: the medical card owns that trade).
  function freeParty(ship) {
    const b = crewBoard(ship); if (!b || !b.parties) return null;
    const idleBay = !(b.crew && b.crew.wounded > 0);
    for (const t of ['standby', 'medical', 'sensors', 'fire']) { if (t === 'medical' && !idleBay) continue; const p = b.parties.find((x) => x.task === t); if (p) return p.id; }
    return null;
  }
  // What the drive gives now: 0 for a wrecked or disabled drive is the truth, so the rated figure is the
  // fallback only when accel() is not a number (round 2: the hull view printed 1.3 g over "Drive 0 %").
  function liveAccel(ship) { const a = typeof ship.accel === 'function' ? ship.accel() : NaN; return typeof a === 'number' && isFinite(a) ? a : ship.accelNominal(); }
  // Why the live acceleration is under the rated one, from the cause (the scan of 2026-09-22 found the physics
  // screen blaming the drive for dry tanks, a disabled hull and the crew's g limit). `none` is the sentence for
  // no thrust at all; `why` the bracket after the share, empty when the share is the rated one.
  function thrustWhy(ship) {
    const live = liveAccel(ship), rated = ship.accelNominal(), fac = rated > 0 ? live / rated : 1;
    const drive = ship.systems ? ship.systems.drive : 1;
    let none = '';
    if (!hasDrive(ship)) none = 'no thrust: she has no drive';
    else if (ship.destroyed) none = 'no thrust: she is destroyed';
    else if (ship.propMass <= 0) none = 'no thrust: the tanks are dry';
    else if (ship.disabled) none = 'no thrust: she is out of the fight';
    else if (!(drive > 0)) none = 'no thrust: the drive is wrecked';
    else if (!(live > 0)) none = 'no thrust';
    const parts = [];
    if (drive < 0.995 && drive > 0) parts.push('the drive is at ' + Math.round(drive * 100) + ' %');
    if (ship.overheated) parts.push('the sink is full, so the drive is held to a quarter');
    const unc = ship.propMass > 0 && !ship.disabled && !ship.destroyed ? (ship.thrust * drive * (ship.overheated ? 0.25 : 1)) / ship.mass() : 0;
    if (live > 0 && unc > live * 1.005) parts.push('the g limit set for the crew');
    return { live, fac, none, why: parts.join(', ') };
  }
  function etaWords(s) { if (!(s > 0)) return ''; const m = Math.floor(s / 60), r = Math.round(s % 60); return m ? m + ' min' + (r >= 30 ? ' 30 s' : '') : r + ' s'; }
  function updateDamage(ship) {
    if (!bound.dmg) return false;
    let rows = null;
    if (OD.Damage && OD.Damage.report) { try { rows = OD.Damage.report(ship); } catch (e) { rows = null; } }
    if (!rows) return false;
    const own = !!(game.sim && ship.faction === game.sim.playerFaction);
    const board = own ? crewBoard(ship) : null;
    const onPart = {}; if (board && board.parties) for (const p of board.parties) if (p.task === 'repair' && p.part) onPart[p.part] = p;
    const capById = {}; if (board && board.parts) for (const q of board.parts) capById[q.id] = q;
    const freeId = board ? freeParty(ship) : null;
    // the Send button names the watch it takes when no party is standing by (round 2)
    const freeTask = freeId && board.parties ? (board.parties.find((x) => x.id === freeId) || {}).task : null;
    const sendLabel = freeId ? 'Send party ' + String(freeId).replace(/^p/, '') + (freeTask === 'fire' ? ' · fire control' : freeTask === 'sensors' ? ' · the sensor watch' : freeTask === 'medical' ? ' · the sick bay' : '') : '';
    const full = UI.detail === 'full';
    let hurt = 0, wrecked = 0, working = 0, actionable = 0;
    const counts = {}, past = [], small = [];
    let noFree = false; // an actionable row with nobody to send: said once under the crew line, not per row
    const hullPct = Math.round(ship.hull * 100);
    let html = '<div class="dmg-row' + (ship.hull < 0.999 ? ' damaged' : '') + '"' + (ship.hull < 0.999 ? '' : ' data-ok') + '><span class="k" data-tip="hull">Hull</span>' + bar('hull', ship.hull, ship.hull < 0.35 ? 'crit' : '') + '<span class="v">' + hullPct + ' %</span></div>';
    const heldSeen = ship._heldSeen || (ship._heldSeen = {});
    for (const r of rows) {
      const q = capById[r.id] || r;
      const can = q.repairable != null ? !!q.repairable : (r.repairable != null ? !!r.repairable : false);
      const hp = r.hp == null ? 1 : r.hp;
      const pct = Math.round(U.clamp(hp, 0, 1) * 100);
      // v13: a part is on the board when it reads under 100 % or a party could still mend it, never on its state
      // alone. Round 2: a row is written out only when a party is on it or a mend is worth a party (20 points or
      // more, or the drive, the reactor, a venting tank, anything damaged or wrecked); the rest are one line in
      // Essentials and their own rows in Full, so the board is not a wall of "nothing a party can do".
      // a part that prints 100 % is not 'hit' on the board, whatever the state word says of its last 0.4 %
      const bad = pct < 100 || can || /^(venting|isolated|wrecked)$/.test(r.state || '');
      const word = r.state && r.state !== 'ok' ? r.state : 'worn';
      const cap = q.cap != null ? q.cap : r.cap;
      const gain = can && typeof cap === 'number' ? Math.max(0, cap - hp) : 0;
      // damage.js now calls any mendable part 'damaged' (a 97 % tank included), so the value test is the gain itself
      const pts = Math.round(gain * 100); // whole points, so 0.800 - 0.604 is the 20-point job it prints as
      const worthIt = can && (pts >= 20 || word === 'venting' || word === 'wrecked' || (/^(drive|reactor)$/.test(r.id) && pts >= 5));
      const party = onPart[r.id];
      if (bad) { hurt++; if (word === 'wrecked') wrecked++; if (worthIt) actionable++; counts[word] = (counts[word] || 0) + 1; }
      if (bad && !party && !worthIt && !full) { (can ? small : past).push((r.name || r.id) + ' ' + pct + ' %'); continue; }
      html += '<div class="dmg-row' + (bad ? ' ' + esc(word) : '') + '"' + (bad ? '' : ' data-ok') + '><span class="k">' + esc(r.name || r.id) + '</span>' + bar('hull', hp) + '<span class="v">' + pct + ' %' + (bad ? ' · ' + esc(word) : '') + '</span>' +
        (bad && r.effect ? '<div class="dmg-fx">' + keepNums(esc(r.effect)) + '</div>' : '');
      if (party) {
        working++;
        const paused = !!(board.crew && board.crew.strapped) || !!q.blocked; // strapped in, or the part is running (crew.js inUse)
        html += '<div class="dmg-party"><span class="ring' + (paused ? ' paused' : '') + '" style="--p:' + Math.round((party.progress || 0) * 100) + '%"></span><span>' + keepNums(esc(party.words || ('Party ' + party.id.replace(/^p/, '') + (party.eta > 0 ? ' · ' + etaWords(party.eta) : '')))) + '</span><button class="sm" data-recall="' + esc(party.id) + '">Recall</button></div>';
        // the moment an order stops a running repair, say so once: the ring alone reads as slow, not stopped
        const key = r.id, was = heldSeen[key], now = q.blocked ? String(q.blocked) : '';
        if (now && was !== now && own && game.sim && ship.faction === game.sim.playerFaction) {
          const text = 'Party ' + String(party.id).replace(/^p/, '') + ' on ' + partPlainName(ship, r) + ' is waiting. ' + now.charAt(0).toUpperCase() + now.slice(1) + '.';
          toast(text, 3200, 'Damage control');
          if (typeof game.sim.addLog === 'function') game.sim.addLog(text, 'Damage control', 'warn');
        }
        heldSeen[key] = now;
      } else if (bad && own && board) {
        heldSeen[r.id] = '';
        const buys = q.buys || r.buys || '';
        if (can && q.blocked) {
          // a part that is running: the hold first, then what a party buys once it is stopped, the time last
          // (round 3); the button is the trade's own act when decisions.js offers it, so the board and the
          // card do one thing; without it a send is a send into a wait, and the label says so
          const eta = q.eta != null ? q.eta : r.eta;
          const tw = OD.Damage && typeof OD.Damage.timeWords === 'function' && eta > 0 ? String(OD.Damage.timeWords(eta) || '') : '';
          let then = String(buys); const cut = tw ? then.lastIndexOf(' ' + tw) : -1; if (cut > 0) then = then.slice(0, cut);
          then = then.replace(/[.,;:\s]+$/, '');
          if (then) then = 'Then ' + then.charAt(0).toLowerCase() + then.slice(1) + (tw ? ', in ' + tw : '') + '.';
          const reason = String(q.blocked).replace(/[.\s]+$/, '');
          const text = 'Held: ' + reason + '.' + (then ? ' ' + then : '');
          let tradeWords = '';
          if (OD.Decisions && typeof OD.Decisions.tradeWords === 'function') { try { tradeWords = String(OD.Decisions.tradeWords(ship, r.id) || ''); } catch (e) { tradeWords = ''; } }
          const pnum = freeId ? String(freeId).replace(/^p/, '') : '';
          const label = !freeId ? '' : tradeWords ? tradeWords + ' · party ' + pnum + ' works' : sendLabel + ' · waits for the part';
          html += '<div class="dmg-party"><span>' + keepNums(esc(text)) + '</span>' + (label ? '<button class="sm" data-send="' + esc(r.id) + '"' + (tradeWords ? ' data-clear="1"' : '') + '>' + esc(label) + '</button>' : '') + '</div>';
          if (!freeId) noFree = true;
        } else if (can) { html += '<div class="dmg-party"><span>' + keepNums(esc(buys)) + '</span>' + (sendLabel ? '<button class="sm" data-send="' + esc(r.id) + '">' + esc(sendLabel) + '</button>' : '') + '</div>'; if (!sendLabel) noFree = true; }
        else if (buys) html += '<div class="dmg-party"><span style="color:var(--dim)">' + keepNums(esc(buys)) + '</span></div>';
      } else heldSeen[r.id] = '';
      html += '</div>';
    }
    if (small.length || past.length) {
      // Essentials folds the rows with no button of their own: the small jobs Full still offers, and the parts
      // past a jury-rig's reach, in two clauses so the line never calls a job Full sells "not worth a party"
      const bits = [];
      if (small.length) bits.push(small.length + (small.length === 1 ? ' smaller job' : ' smaller jobs') + ': ' + keepNums(esc(small.join(', '))) + '.');
      if (past.length) bits.push(past.length + (past.length === 1 ? ' part' : ' parts') + ' past a jury-rig: ' + keepNums(esc(past.join(', '))) + '.');
      html += '<div class="dmg-past" style="grid-column:1/-1">' + bits.join(' ') + (own ? ' Full lists them.' : '') + '</div>';
    }
    if (!hurt && ship.hull >= 0.999) html += '<div class="dmg-empty" style="grid-column:1/-1">No damage.</div>';
    if (bound.dmg.innerHTML !== html) bound.dmg.innerHTML = html;
    if (bound.crew) { const t = nbPct(board ? (board.words || '') : ''); if (bound.crew.textContent !== t) bound.crew.textContent = t; }
    if (bound.crew) { let nf = document.getElementById('dmgNoFree'); if (noFree && !nf) { nf = document.createElement('div'); nf.id = 'dmgNoFree'; nf.textContent = NO_PARTY; bound.crew.insertAdjacentElement('afterend', nf); } else if (!noFree && nf) nf.remove(); }
    if (bound.gwords) { const t = nbPct(board ? (board.gWords || '') : ''); if (bound.gwords.textContent !== t) bound.gwords.textContent = t; }
    if (bound.gmode) { const mode = board && board.crew ? board.crew.gMode : null; bound.gmode.querySelectorAll('[data-g]').forEach((b) => b.classList.toggle('active', b.dataset.g === mode)); bound.gmode.style.display = board ? '' : 'none'; }
    if (bound.dmgstate) {
      // the pill counts the same rows the board lists, so the header and the rows never disagree
      const bits = [];
      if (counts.wrecked) bits.push(counts.wrecked + ' wrecked');
      if (counts.venting) bits.push(counts.venting + ' venting');
      if (actionable) bits.push(actionable + ' to work');
      if (working) bits.push(working + (working === 1 ? ' party on it' : ' parties on it'));
      const t = bits.join(' · ') || (hurt ? hurt + ' worn' : 'intact');
      if (bound.dmgstate.textContent !== t) bound.dmgstate.textContent = t;
      bound.dmgstate.className = 'pill ' + (counts.wrecked || counts.venting ? 'crit' : actionable ? 'warn' : 'good');
    }
    const crewMatters = !!(board && board.crew && (board.crew.wounded > 0 || board.crew.strapped || working > 0));
    if (bound.syssec) bound.syssec.classList.toggle('force', hurt > 0 || ship.hull < 0.999 || crewMatters);
    if (actionable > 0 && game.sim && ship.faction === game.sim.playerFaction && !game.sim.flags.damageHint && !(hintActive && hintActive.step) && !hintQueue.some((h) => h.step) && hintWorth(ship, rows, capById)) {
      game.sim.flags.damageHint = true;
      firstHitHint(ship, rows, capById);
    }
    return true;
  }
  const STATE_ORDER = ['worn', 'damaged', 'isolated', 'venting', 'wrecked'];
  const NO_PARTY = 'No party free. Recall one.';
  // The part, named the way the log and the board name it. damage.js owns the plain names; without it the row
  // name goes in lower case behind a definite article.
  function partPlainName(ship, row) {
    let n = '';
    if (OD.Damage && typeof OD.Damage.plainName === 'function' && ship && Array.isArray(ship.components)) {
      const c = ship.components.find((x) => x.id === row.id);
      if (c) { try { n = OD.Damage.plainName(c) || ''; } catch (e) { n = ''; } }
    }
    if (!n) { const raw = String(row.name || row.id || 'part'); n = 'the ' + (/^[A-Z][A-Z]/.test(raw) ? raw : raw.charAt(0).toLowerCase() + raw.slice(1)); }
    return n;
  }
  // The first hit on one of our hulls teaches the board: what is hit and how far down, where the board is, and
  // what a party would buy. On a phone there is no C key, so the hint carries a button instead.
  // The part the hint is about is picked by what a party would buy, never by the lowest number: the drive, the
  // reactor or a venting tank first, else the biggest jury-rig gain, and only when that gain is 20 points or
  // more (round 2: a 1 % dent on a tank was spending the one teaching hint).
  function hintWorth(ship, rows, capById) {
    const gain = (r) => { const q = capById[r.id] || r; const can = q.repairable != null ? !!q.repairable : !!r.repairable; const cap = q.cap != null ? q.cap : r.cap; const hp = r.hp == null ? 1 : r.hp; return can && typeof cap === 'number' ? Math.max(0, cap - hp) : 0; };
    const key = (r) => (r.state === 'venting' ? 3 : /^(drive|reactor)$/.test(r.id) ? 2 : 1);
    // only a row the board gives a Send button: a drive at 99 % is past a jury-rig's reach and teaches nothing
    const list = rows.filter((r) => gain(r) >= 0.2 || (r.state === 'venting') || (/^(drive|reactor)$/.test(r.id) && gain(r) > 0));
    list.sort((a, b) => key(b) - key(a) || gain(b) - gain(a));
    return list[0] || null;
  }
  function firstHitHint(ship, rows, capById) {
    const worst = hintWorth(ship, rows, capById);
    if (!worst) return;
    const q = capById[worst.id] || worst;
    const phone = window.innerWidth < 900;
    const name = partPlainName(ship, worst);
    const can = q.repairable != null ? !!q.repairable : !!worst.repairable;
    const cap = q.cap != null ? q.cap : worst.cap;
    const say = (hp) => {
      let text = name.charAt(0).toUpperCase() + name.slice(1) + ' on ' + ship.name + ' is hit, down to ' + U.fmt.pct(U.clamp(hp, 0, 1)) + '.';
      text += phone ? ' Open Damage control in the panel.' : ' Open Damage control in the panel, or press C.';
      if (can && typeof cap === 'number' && cap > 0) text += ' A party can jury-rig it back to ' + U.fmt.pct(U.clamp(cap, 0, 1)) + '.';
      return nbPct(text);
    };
    // v15: the hint quotes the part's number as it is now (it read 77 % while the board read 58 %), and it goes
    // once a party has the part back to what a jury-rig gives, or the ship is lost
    const hpNow = () => { const c = Array.isArray(ship.components) ? ship.components.find((x) => x.id === worst.id) : null; return c ? (c.hp == null ? 1 : c.hp) : null; };
    const hp0 = worst.hp == null ? 1 : worst.hp, mendTo = typeof cap === 'number' && cap > 0 && hp0 < cap - 0.005 ? cap - 0.005 : Infinity;
    showHint({ id: 'v8dmg', text: say(hp0), anchor: '#shipPanel', action: phone ? { label: 'Open the board', run: () => damageBoard() } : null,
      refresh: () => { const hp = hpNow(); return hp == null ? null : say(hp); },
      until: () => { const hp = hpNow(); return !!(ship.destroyed || ship.captured || hp == null || hp >= mendTo); } });
    // the section forcing itself open is not enough on a tall panel: put the board on screen
    scrollPanelTo(bound.syssec);
  }
  // Bring a section of the ship panel into the panel's own scroll box.
  function scrollPanelTo(sec) {
    const panel = $('shipPanel');
    if (!panel || !sec) return;
    try {
      const top = sec.getBoundingClientRect().top - panel.getBoundingClientRect().top + panel.scrollTop;
      panel.scrollTop = Math.max(0, top - 8);
    } catch (e) { /* older browsers keep the panel where it is */ }
  }
  // Key C: bring the damage-control board into view.
  function damageBoard() {
    // on a phone an open card hides the ship panel, so the board cannot be reached until the card is answered
    if (window.innerWidth <= 900 && document.body.classList.contains('decision-open')) { toast('Answer the question first. Esc leaves it for later.', 3000); return false; }
    const sec = bound.syssec; if (!sec) { toast('Select one of our ships first.', 2000); return false; }
    sec.classList.add('force');
    const sh = selected(); if (sh) updateDamage(sh);
    try { sec.scrollIntoView({ block: 'nearest' }); } catch (e) { /* older browsers */ }
    scrollPanelTo(sec);
    if (bound.dmg && /No damage\./.test(bound.dmg.textContent)) toast('No damage. The board lists hurt parts and the parties on them when there are any.', 2600);
    return true;
  }
  // Keyboard for fire control, called by main.js: returns true when the key did something.
  function engKey(key, shift) {
    const ship = selected(); const sim = game.sim;
    if (!ship || !sim || ship.faction !== sim.playerFaction || !OD.Engagement) return false;
    const by = actById(engActs(ship));
    const cycle = (list) => { const ids = list.map(([id]) => id).filter((id) => by[id]); if (!ids.length) return false; const i = ids.findIndex((id) => by[id].active); sim.engagementAction(ship, ids[(i + 1) % ids.length]); return true; };
    const k = key.toLowerCase();
    if (k === 'w') { ship.weaponsFree = !ship.weaponsFree; toast(ship.weaponsFree ? ship.name + ': weapons free.' : ship.name + ': holding fire.', 1500); if (sim.flags) sim.flags.fireKeyUsed = true; return true; }
    if (k === 'b') { if (!cycle(FIRE_MODES)) return false; const a = FIRE_MODES.map(([id]) => actById(engActs(ship))[id]).find((x) => x && x.active); if (a) toast('Beams: ' + a.label + (a.tip ? ' · ' + a.tip : ''), 2500); return true; }
    if (k === 't') { if (!cycle(AIMS)) return false; const a = AIMS.map(([id]) => actById(engActs(ship))[id]).find((x) => x && x.active); if (a) toast('Aim: ' + a.label + (a.tip ? ' · ' + a.tip : ''), 2500); return true; }
    if (k === 'l') { const id = shift ? 'launch4' : 'launch2'; const a = by[id] || by[shift ? 'launch2' : 'launch']; if (!a) return false; sim.engagementAction(ship, a.id); return true; }
    if (k === 'a') { const a = by.launchAll || by.launch; if (!a) return false; sim.engagementAction(ship, a.id); return true; }
    return false;
  }

  function heatForecast(ship) {
    // v13: the drive's heat follows the thrust it actually makes (ship.thrustFrac), not the commanded throttle
    const pin = ship.idleHeat + ship.driveHeat * heatFrac(ship) + (ship.lastExtraHeat || 0); // heatFrac carries the drive's state and the full-sink quarter
    const net = pin - ship.radiatorPower();
    if (ship.overheated) return { text: 'saturated', cls: 'crit' };
    // with the radiator temperature following the sink, the honest forecast is a stepped one (physics.js)
    if (typeof P.sinkForecast === 'function') {
      const rating = typeof ship.radiatorRating === 'function' ? ship.radiatorRating() : ship.radiatorPower();
      let f = null; try { f = P.sinkForecast(ship.heat, ship.sinkCapacity, rating, pin, 3600, ship.radiatorTemp); } catch (e) { f = null; }
      if (f) {
        if (f.tFull != null && isFinite(f.tFull)) return { text: 'full in ' + U.fmt.time(f.tFull), cls: f.tFull < 300 ? 'crit' : f.tFull < 1200 ? 'warn' : '' };
        if (f.tEmpty != null && isFinite(f.tEmpty) && ship.heat > 0.05 * ship.sinkCapacity) return { text: 'draining, ' + U.fmt.time(f.tEmpty) + ' to empty', cls: 'good' };
        if (f.settle != null && isFinite(f.settle) && f.settle < 0.999 && rating > 0) return { text: 'settles near ' + Math.round(f.settle * 100) + '%', cls: f.settle >= ((P.SINK_KNEE || 0.6) - 0.05) ? 'warn' : '' };
        // nothing settles when the panels are in or the heat beats the rating: the sink fills, however slowly
        if (net > 1e3) { const t = (ship.sinkCapacity - ship.heat) / net; return { text: 'full in ' + U.fmt.time(t), cls: t < 300 ? 'crit' : t < 1200 ? 'warn' : '' }; }
      }
    }
    if (net > 1e3) { const t = (ship.sinkCapacity - ship.heat) / net; return { text: 'full in ' + U.fmt.time(t), cls: t < 300 ? 'crit' : t < 1200 ? 'warn' : '' }; }
    if (net < -1e3 && ship.heat > 0) return { text: 'draining, ' + U.fmt.time(ship.heat / -net) + ' to empty', cls: 'good' };
    return { text: 'steady', cls: '' };
  }

  function updatePanel(ship) {
    const sim = game.sim;
    if (!ship) { if (panelShip) { $('shipPanel').innerHTML = '<div class="empty">Click one of your ships to take command, or pick it from the fleet list.</div>'; panelShip = null; } return; }
    // a hostile is shown as our sensors hold her (hostilePic); her target and her plan are her orders, never read
    const pic = hostilePic(sim, ship);
    if (panelShip !== ship.id || panelHasEng !== panelKey(pic)) buildPanel(ship, pic);
    // every value keeps its numbers whole: a figure never parts from its unit or its ±, and a figure with
    // thousands groups never breaks at the thin space (keepNums)
    const set = (k, v, cls) => {
      const el = bound[k]; if (!el) return;
      v = String(v);
      if (el.dataset.t !== v) { el.dataset.t = v; if (/\d\u2009\d/.test(v)) el.innerHTML = keepNums(esc(v)); else el.textContent = nbPct(v); }
      if (cls !== undefined) el.className = el.className.replace(/\b(good|warn|crit)\b/g, '').trim() + (cls ? ' ' + cls : '');
    };
    const panel = $('shipPanel');
    const target = !pic && ship.target ? sim.byId(ship.target) : null;
    const plan = !pic && OD.Guide ? OD.Guide.plan(sim, ship) : null;
    const fix = pic ? trackFix(sim, ship, pic) : null;

    // navigator
    if (pic) trackPanel(sim, ship, pic, fix, set);
    else if (OD.Guide && bound.nav) {
      const n = OD.Guide.narrate(sim, ship);
      set('navtext', n.text); set('navsub', n.sub);
      if (bound.nav.dataset.phase !== n.phase) bound.nav.dataset.phase = n.phase;
      const tip = OD.Guide.suggest(sim, ship);
      if (bound.navtip) { bound.navtip.hidden = !tip; if (tip) set('navtip', tip); }
    }
    if (!pic && bound.ostate) { const th = ship.throttle; set('ostate', ship.disabled ? 'disabled' : th > 0 ? 'burning ' + Math.round(th * 100) + '%' : Math.abs(U.angleDiff(ship.cmdHeading, ship.heading)) > 0.05 ? 'turning' : 'coasting'); bound.ostate.className = 'pill ' + (th > 0 ? 'good' : ''); }

    // delta-v
    const dvNow = ship.deltaV(), dvFull = ship.deltaVFull();
    const noDrive = !hasDrive(ship);
    const dvf = dvFull > 0 ? dvNow / dvFull : 0;
    if (noDrive) { set('dv', 'no drive', ''); set('vdv', 'no drive', ''); }
    else {
      set('dv', U.fmt.dv(dvNow) + ' · ' + Math.round(dvf * 100) + '%', dvf < 0.15 ? 'crit' : dvf < 0.35 ? 'warn' : '');
      set('vdv', U.fmt.dv(dvNow), dvf < 0.15 ? 'crit' : dvf < 0.35 ? 'warn' : '');
    }
    if (bound.dvfill) bound.dvfill.style.width = Math.round(U.clamp(dvf, 0, 1) * 100) + '%';
    if (bound.dvcost) {
      const cost = plan && plan.active ? Math.min(plan.dv, dvNow) : 0;
      const left = (dvNow - cost) / dvFull;
      bound.dvcost.style.left = Math.round(U.clamp(left, 0, 1) * 100) + '%';
      bound.dvcost.style.width = Math.round(U.clamp(cost / dvFull, 0, 1) * 100) + '%';
      bound.dvcost.classList.toggle('over', !!(plan && plan.active && !plan.feasible));
    }
    if (pic) set('dvplan', '');
    else set('dvplan', plan && plan.active ? 'this order: ' + U.fmt.dv(plan.dv) + (plan.feasible ? '' : ' · not enough') : 'no burn planned', plan && plan.active && !plan.feasible ? 'crit' : '');
    set('dvfull', 'full ' + U.fmt.dv(dvFull));
    set('accel', noDrive ? 'no drive' : U.fmt.accel(ship.accel()));
    set('mass', U.fmt.mass(ship.mass()) + ' (' + U.fmt.mass(ship.propMass) + ')');
    set('speed', U.fmt.speed(U.len(ship.vel)));
    set('heading', U.fmt.deg(ship.heading) + (!pic && Math.abs(U.angleDiff(ship.cmdHeading, ship.heading)) > 0.05 ? ' → ' + U.fmt.deg(ship.cmdHeading) : ''));
    if (sim.body && bound.orbit) {
      const el = P.orbitalElements(sim.body.mu, ship.pos, ship.vel);
      // v15: altitude above the surface, low point to high point, as the map's edge marker gives it
      const lo = U.fmt.dist(el.periapsis - sim.body.radius), hi = U.fmt.dist(el.apoapsis - sim.body.radius);
      const alt = el.bound ? (lo === hi ? lo + ', circular' : lo + ' to ' + hi) : U.fmt.dist(U.len(ship.pos) - sim.body.radius) + ', escaping';
      set('orbit', alt, el.bound && el.periapsis < sim.body.radius ? 'crit' : '');
    }

    // target
    const facets = panel.querySelectorAll('.facing [data-f]');
    if (pic) {
      // a hostile held as a solution: range and closing from the ship of ours that holds her (trackFix)
      set('vrange', fix ? U.fmt.dist(fix.d) : '—', '');
      set('vclose', fix ? (fix.closing >= 0 ? '' : '−') + U.fmt.speed(Math.abs(fix.closing)) : '—', '');
    } else if (target && !target.destroyed) {
      // vitals about a hostile come through our track on her, with the uncertainty shown, not the true state
      let tp = target.pos, tv = target.vel, fuzz = null;
      if (OD.Sensors && sim.isHostile(target, ship)) {
        const tr0 = trackOf(sim, ship, target);
        if (tr0 && tr0.est && tr0.est.pos && tr0.q < ((OD.Sensors.T && OD.Sensors.T.solutionQ) || 2.7)) { tp = tr0.est.pos; tv = tr0.est.vel || target.vel; fuzz = tr0; }
      }
      const r = U.sub(tp, ship.pos), d = U.len(r);
      // two hulls in one orbit differ by rounding only: under 0.05 m/s is 0, never '−3.84e-9 m/s'
      const closing0 = -U.dot(U.sub(tv, ship.vel), U.norm(r)), closing = Math.abs(closing0) < 0.05 ? 0 : closing0;
      const two = (x) => Number(x.toPrecision(2));
      const rerr = fuzz ? (fuzz.rangeErr || fuzz.posErr || 0) : 0;
      set('tname', target.name);
      set('vrange', fuzz ? (rerr > 0 ? km(two(d)) + ' ± ' + km(two(rerr)) : '≈ ' + km(two(d))) : U.fmt.dist(d), fuzz ? 'warn' : '');
      if (fuzz && fuzz.word === 'contact') set('vclose', 'unknown', 'warn');
      else set('vclose', (fuzz ? '≈ ' : '') + (closing >= 0 ? '' : '−') + U.fmt.speed(fuzz ? two(Math.abs(closing)) : Math.abs(closing)), closing < 0 ? 'warn' : '');
      // with no thrust the ship cannot stop at all: say why instead of printing an infinite distance
      const why = liveAccel(ship) > 0 ? '' : noThrustWhy(ship);
      if (closing > 1 && why) set('tstop', 'never: ' + why, 'crit');
      else if (closing > 1) { const stop = P.stoppingDistance(closing, liveAccel(ship)); set('tstop', U.fmt.dist(stop) + (stop > d ? ' · overshoot' : ''), stop > d ? 'crit' : stop > 0.8 * d ? 'warn' : ''); }
      else set('tstop', closing < -1 ? 'opening' : '—', '');
      if (OD.Guide) {
        const active = plan && plan.active && plan.order.target === target.id;
        const hp = active ? plan : OD.Guide.plan(sim, ship, { type: 'intercept', target: target.id, range: 2000, vmax: ship.order.vmax });
        set('test', hp.active ? OD.Guide.summary(hp) : why ? 'none: ' + why : '—', hp.active && !hp.feasible ? 'crit' : !hp.active && why ? 'warn' : '');
        const eta = active ? OD.Guide.eta(sim, plan, plan.arrive) : null;
        // The plan flies the target as a coasting body. While she burns, the arrival is only as good as
        // her next order: with her drive out-pulling ours it never comes, otherwise it holds if she coasts.
        const herBurn = target && !target.destroyed && typeof target.accel === 'function' && (target.throttle || 0) > 0.05 ? target.accel() * target.throttle : 0;
        const outrun = herBurn > 0 && herBurn >= liveAccel(ship) * Math.max(0.05, ship.throttle || 1) && d > 200e3;
        const arriveWords = plan && plan.arrive ? (eta < 3 ? 'now' : outrun ? 'not while she burns this hard' : 'in ' + U.fmt.time(eta) + (herBurn > 0 ? ' if she coasts' : '')) : '';
        set('tarr', active ? (plan.arrive ? arriveWords : plan.crash ? 'never: ends on the ground' : plan.dry ? 'never: tanks run dry' : 'beyond 4 h') : '—', active && (plan.crash || plan.dry || outrun) ? 'crit' : '');
      } else {
        const est = OD.Autopilot.estimate(ship, target);
        set('test', isFinite(est.time) ? U.fmt.time(est.time) + ' · ' + U.fmt.dv(est.dv) : '—', est.dv > ship.deltaV() ? 'crit' : '');
        set('tarr', '—');
      }
      const facet = facetSeen(ship, target);
      let fsuffix = '';
      if (OD.Guide && plan && plan.active && plan.order.target === target.id && sim.isHostile(target, ship)) {
        const tA = OD.Guide.eta(sim, plan, plan.arrive), tF = OD.Guide.eta(sim, plan, plan.flip);
        if (facet === 'tail' && tA != null) fsuffix = ' · ' + U.fmt.time(tA) + ' more';
        else if (facet === 'nose' && tF != null && tF > 2) fsuffix = ' · tail from flip in ' + U.fmt.time(tF);
      }
      if (armourAllRound(ship)) set('tfacing', ship.armour.nose + ' cm all round', '');
      else set('tfacing', facet + ' ' + ship.armour[facet] + ' cm' + fsuffix, facet === 'tail' ? 'crit' : facet === 'flank' ? 'warn' : 'good');
      facets.forEach((f) => { f.classList.toggle('seen', f.dataset.f === facet); f.setAttribute('class', 'f-' + f.dataset.f + (f.dataset.f === facet ? ' seen' : '')); });
      set('tstate', target.faction === ship.faction ? 'friendly' : sim.isHostile(target, ship) ? 'hostile' : 'civilian');
      bound.tstate.className = 'pill ' + (sim.isHostile(target, ship) ? 'warn' : '');
    } else {
      set('tname', '—'); set('vrange', '—', ''); set('vclose', '—', ''); set('test', '—'); set('tarr', '—'); set('tstop', '—', ''); set('tfacing', '—'); set('tstate', 'none'); if (bound.tstate) bound.tstate.className = 'pill';
      facets.forEach((f) => f.setAttribute('class', 'f-' + f.dataset.f));
    }
    // v11: signature, track and solution rows
    if (OD.Sensors && bound.sigrow) {
      const st = hostileInPlay(sim, ship) ? sigText(sim, ship) : null;
      if (!st) { bound.sigrow.hidden = true; for (const k of ['sigsrck', 'sigsrc', 'sensk', 'sens']) if (bound[k]) bound[k].hidden = true; }
      if (st) {
        bound.sigrow.hidden = false; set('sig', st.text, st.cls);
        const pa = $('pActive');
        if (pa) { const on = !!(typeof OD.Sensors.isActive === 'function' ? OD.Sensors.isActive(ship) : ship.activeSensor); pa.classList.toggle('on', on); pa.setAttribute('aria-pressed', String(on)); pa.disabled = !(ship.activeRange > 0); pa.title = ship.activeRange > 0 ? 'Active sensor (S): a firing solution on everything inside ' + km(ship.activeRange) + '. Everyone out there gets one on us.' : 'No active sensor aboard.'; }
        for (const k of ['sigsrck', 'sigsrc', 'sensk', 'sens']) if (bound[k]) bound[k].hidden = false;
        set('sigsrc', 'plume ' + U.fmt.power(st.sig.plume) + ' · radiators ' + U.fmt.power(st.sig.radiators) + ' · hull ' + U.fmt.power(st.sig.hull));
        set('sens', 'passive ' + km((ship.sensorRange || 0) * ((ship.systems && ship.systems.sensors) || 1)) + (ship.activeRange > 0 ? ' · active ' + km(ship.activeRange) : ''));
      }
      if (bound.ttrack) {
        const tr = target && !target.destroyed && sim.isHostile(target, ship) ? trackOf(sim, ship, target) : null;
        for (const k of ['ttrackk', 'ttrack', 'tsolk', 'tsol']) if (bound[k]) bound[k].hidden = !tr;
        if (tr) {
          const sol = tr.q >= ((OD.Sensors.T && OD.Sensors.T.solutionQ) || 2.7);
          const friendly = tr.source === 'friendly' || !sim.isHostile(target, ship);
          set('ttrack', friendly ? 'solution · transponder' : tr.word + ' · q ' + (isFinite(tr.q) ? tr.q.toFixed(1) : '—') + (tr.source === 'active' ? ' · active' : ''), friendly || sol ? 'good' : tr.word === 'contact' ? 'crit' : 'warn');
          let eta = null; try { eta = sol || friendly ? 0 : (typeof OD.Sensors.solutionEta === 'function' ? OD.Sensors.solutionEta(sim, ship, target) : null); } catch (e) { eta = null; }
          set('tsol', sol || friendly ? 'held' : eta != null && isFinite(eta) ? U.fmt.time(eta) : 'not at this range', sol || friendly ? 'good' : eta != null && isFinite(eta) ? '' : 'warn');
        }
      }
    }
    if (bound.boardrow) { bound.boardrow.hidden = !ship.boarding; if (ship.boarding) bound.boardbar.style.width = Math.round(ship.boarding.progress * 100) + '%'; }

    // orders and their previews
    panel.querySelectorAll('[data-order]').forEach((b) => b.classList.toggle('active', ship.order.type === b.dataset.order || (ship.order.type === 'evade' && b.dataset.order === 'keeprange')));
    if (bound.pv_intercept && OD.Guide) {
      const vmax = $('pVmax') && +$('pVmax').value ? +$('pVmax').value : undefined;
      const rangeKm = $('pRange') ? Math.max(1, +$('pRange').value) : 200;
      // v15: a hull that cannot burn (dry tanks, a wrecked drive) says why on each key that needs a burn
      const cant = liveAccel(ship) > 0 ? '' : noThrustWhy(ship);
      const preview = (type, order) => {
        if (!target || target.destroyed) return 'needs a target';
        if (cant) return cant;
        if (ship.order.type === type && ship.order.target === target.id && (type !== 'keeprange' || Math.round(ship.order.range / 1000) === rangeKm)) return plan && plan.active ? (plan.arrive ? 'arrive in ' + U.fmt.time(OD.Guide.eta(sim, plan, plan.arrive)) : 'active') : 'active';
        const hp = OD.Guide.plan(sim, ship, order);
        return hp.active ? OD.Guide.summary(hp) : '—';
      };
      set('pv_intercept', preview('intercept', { type: 'intercept', target: target && target.id, range: 2000, vmax }));
      set('pv_keeprange', preview('keeprange', { type: 'keeprange', target: target && target.id, range: rangeKm * 1000, vmax }));
      set('pv_matchv', target && !target.destroyed ? (cant || (ship.order.type === 'matchv' ? 'active' : U.fmt.speed(U.len(U.sub(ship.vel, target.vel))) + ' to cancel')) : 'needs a target');
      set('pv_retreat', cant || 'full burn away');
    }
    if ($('pJink')) { $('pJink').classList.toggle('active', !!ship.jink); $('pJink').setAttribute('aria-pressed', String(!!ship.jink)); }
    if ($('pManual')) { const m = ship.order.type === 'manual'; $('pManual').hidden = !m; $('pManual2').hidden = !m; if (m) { set('mhead', U.fmt.deg(ship.order.heading || 0)); set('mthr', Math.round((ship.order.throttle || 0) * 100) + '%'); } }

    // heat
    const load = ship.thermalLoad();
    if (bound.heatbar) bound.heatbar.style.width = Math.round(load * 100) + '%';
    set('heat', Math.round(load * 100) + '% of ' + U.fmt.energy(ship.sinkCapacity), heatCls(load));
    const fc = heatForecast(ship);
    set('heatfc', fc.text, fc.cls);
    const hin = ship.idleHeat + ship.driveHeat * heatFrac(ship) + (ship.lastExtraHeat || 0);
    set('heatio', U.fmt.power(hin) + ' / ' + U.fmt.power(ship.radiatorPower()));
    const rs = ship.radiators;
    set('rad', (rs.state >= 0.99 ? 'extended' : rs.state <= 0.01 ? 'stowed' : (rs.deployed ? 'extending ' : 'stowing ') + Math.round(rs.state * 100) + '%') + (rs.auto ? ' · auto' : ''));
    set('hstate', ship.overheated ? 'saturated' : load > 0.85 ? 'critical' : load > 0.5 ? 'warm' : 'nominal');
    if (bound.hstate) bound.hstate.className = 'pill ' + (ship.overheated ? 'crit' : load > 0.5 ? 'warn' : 'good');
    panel.querySelectorAll('[data-rad]').forEach((b) => b.classList.toggle('active', b.dataset.rad === 'auto' ? rs.auto : !rs.auto && (b.dataset.rad === '1') === rs.deployed));
    // systems (shown in Essentials only once something is damaged)
    if (!updateDamage(ship)) {
      const sysEls = panel.querySelectorAll('.sysbars .bar');
      let damaged = ship.hull < 0.999;
      ['hull', 'drive', 'radiators', 'sensors', 'weapons'].forEach((k, i) => {
        const v = k === 'hull' ? ship.hull : ship.systems[k];
        if (v < 0.999) damaged = true;
        if (sysEls[i]) { sysEls[i].firstChild.style.width = Math.round(v * 100) + '%'; sysEls[i].className = 'bar hull ' + (v < 0.35 ? 'crit' : ''); }
        set('sys_' + k, Math.round(v * 100) + '%');
      });
      if (bound.syssec) bound.syssec.classList.toggle('force', damaged);
    }
    updateThreats(ship);
    // engagement
    if (bound.engrows && OD.Engagement) {
      let rows = (OD.Engagement.shipReadout && OD.Engagement.shipReadout(ship)) || [];
      if (OD.Engagement.fireMode) rows = rows.filter((r) => !/^(fire mode|aim|point defence|incoming)$/i.test(r.label || ''));
      rows = rows.concat(burnRows(ship));
      const width = rowsWidth(bound.engrows);
      const html = rows.map((r) => kvRow(r.label, r.value, { adv: FULL_ROWS.test(r.label), title: r.tip, width })).join('');
      if (bound.engrows.innerHTML !== html) bound.engrows.innerHTML = html;
      updateFireControl(ship);
      if ($('pWF')) { $('pWF').classList.toggle('active', !!ship.weaponsFree); $('pWF').setAttribute('aria-pressed', String(!!ship.weaponsFree)); }
    }
    $('pFollow').classList.toggle('active', game.cam.follow === ship.id);
    const det = $('pDetail'); if (det) { det.classList.toggle('active', UI.detail === 'full'); det.setAttribute('aria-pressed', String(UI.detail === 'full')); const want = (UI.detail === 'full' ? 'Full' : 'Essentials') + '<kbd>D</kbd>'; if (det.innerHTML !== want) det.innerHTML = want; }
    drawPortrait(ship, pic);
  }

  // ------------------------------------------------------------------ hull drawing (portrait, hull view)
  function heatTint(load) { const l = U.clamp(load, 0, 1); return 'hsl(' + Math.round(14 + 32 * l) + ', 90%, ' + Math.round(28 + 52 * l) + '%)'; }
  const ART_VIEW = { side: 'side', top: 'top', 'three-quarter': 'threequarter' };
  const artId = (ship) => OD.Render.artId(ship);
  // Draws a ship centred on (cx, cy), nose to the right, L pixels long, in the given view.
  function drawHull(ctx, ship, cx, cy, L, view, extra) {
    let drawn = false;
    if (OD.Render.artReady(artId(ship))) {
      ctx.save();
      try {
        // v12: an inspection picture is lit by a fixed key light (the map keeps the sim's sun, which leaves a
        // nose-right view in silhouette half the time), runs on the sim clock (artOpts sets time) so nothing
        // moves at warp 0, and shows the plume when the drive is lit
        const opts = OD.Render.artOpts(ship, game.sim, Object.assign({ x: cx, y: cy, size: L, view: ART_VIEW[view] || view, rotation: 0, plume: true, light: { az: -50, el: 35 } }, extra || {}));
        // an inspection view keeps the radiators orange even with an empty sink; the map keeps the true tint
        if (opts.state) opts.state = Object.assign({}, opts.state, { heat: Math.max(0.15, opts.state.heat || 0) });
        // a hull we only track: the class, its radiators and its plume are what the sensors give; no damage, no fire
        if (extra && extra.plain) { opts.live = false; opts.fx = null; opts.state = { radiators: opts.state ? opts.state.radiators : 1, throttle: opts.state ? opts.state.throttle : 0, heat: 0.15, hull: 1, damage: { nose: 0, flank: 0, tail: 0 }, systems: {}, parts: null, disabled: false, destroyed: false }; }
        drawn = OD.ShipArt.draw(ctx, artId(ship), opts) !== false;   // false: declined this frame, the silhouette stands in
        // v12: the live overlay (mounts slewing and firing, launches, point defence, venting) on top of the cached hull
        if (drawn && opts.live && typeof OD.ShipArt.overlay === 'function') OD.ShipArt.overlay(ctx, artId(ship), opts);
      }
      catch (e) { OD.Render.lastError = 'ship art: ' + (e && e.message); }
      ctx.restore();
    }
    if (!drawn) { ctx.save(); ctx.translate(cx, cy); drawFallbackHull(ctx, ship, L, view); ctx.restore(); }
    return drawn;
  }
  function drawFallbackHull(ctx, ship, L, view) {
    const shape = OD.Ships.SHAPES[ship.cls] || OD.Ships.SHAPES[artId(ship)] || OD.Ships.SHAPES.frigate;
    const col = OD.Ships.FACTIONS[ship.faction].color;
    const rs = ship.radiators.state, load = ship.thermalLoad();
    const lit = { x: Math.cos(-0.7), y: Math.sin(-0.7) };
    ctx.save();
    ctx.globalAlpha = ship.destroyed ? 0.3 : ship.disabled ? 0.6 : 1;
    if (view === 'three-quarter') ctx.transform(1, 0.16, 0, 0.9, 0, 0);
    const sq = view === 'side' ? 0.62 : 1;
    if (shape === 'ring') {
      const R = L * 0.45;
      ctx.save(); ctx.scale(1, sq);
      const hg = ctx.createLinearGradient(-lit.x * R, -lit.y * R, lit.x * R, lit.y * R); hg.addColorStop(0, '#171d26'); hg.addColorStop(0.5, '#3a4655'); hg.addColorStop(1, '#8d9cad');
      ctx.strokeStyle = hg; ctx.lineWidth = L * 0.11; ctx.beginPath(); ctx.arc(0, 0, R, 0, U.TAU); ctx.stroke();
      ctx.fillStyle = hg; ctx.beginPath(); ctx.arc(0, 0, L * 0.16, 0, U.TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(120,135,155,0.9)'; ctx.lineWidth = L * 0.02; ctx.beginPath();
      for (let i = 0; i < 6; i++) { const a = (i / 6) * U.TAU; ctx.moveTo(Math.cos(a) * L * 0.16, Math.sin(a) * L * 0.16); ctx.lineTo(Math.cos(a) * R, Math.sin(a) * R); }
      ctx.stroke();
      if (rs > 0.02) { ctx.strokeStyle = heatTint(load); ctx.lineWidth = L * 0.035; for (let i = 0; i < 6; i++) { const a = (i / 6) * U.TAU + Math.PI / 6; ctx.beginPath(); ctx.moveTo(Math.cos(a) * R * 1.12, Math.sin(a) * R * 1.12); ctx.lineTo(Math.cos(a) * (R * 1.12 + L * 0.4 * rs), Math.sin(a) * (R * 1.12 + L * 0.4 * rs)); ctx.stroke(); } }
      ctx.restore(); ctx.restore(); return;
    }
    const ws = L * (ship.role === 'freighter' ? 0.5 : 0.42) * sq;
    const path = (k, w) => { ctx.beginPath(); shape.forEach(([x, y], i) => { const px = x * L * (k || 1), py = y * (w || ws); if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); }); ctx.closePath(); };
    // radiators: two fins in plan, one raised fin from the side
    if (rs > 0.02) {
      const x0 = -L * 0.12, sw = L * 0.1, span = L * 0.46 * rs, tint = heatTint(load);
      if (view === 'side') {
        // panels seen edge-on: two thin glowing blades above and below the spine
        for (const sgn of [1, -1]) { ctx.strokeStyle = tint; ctx.lineWidth = Math.max(1.5, L * 0.012); ctx.beginPath(); ctx.moveTo(x0 - sw * 0.5, sgn * ws * 0.42); ctx.lineTo(x0 - sw * 0.85, sgn * (ws * 0.42 + span * 0.9)); ctx.stroke(); ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = Math.max(0.6, L * 0.004); ctx.stroke(); }
      }
      const fin = (sgn, y0) => { const g = ctx.createLinearGradient(0, sgn * y0, 0, sgn * (y0 + span)); g.addColorStop(0, tint); g.addColorStop(1, 'rgba(60,30,25,0.9)'); ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(x0, sgn * y0); ctx.lineTo(x0 - sw * 0.35, sgn * (y0 + span)); ctx.lineTo(x0 - sw * 1.2, sgn * (y0 + span)); ctx.lineTo(x0 - sw, sgn * y0); ctx.closePath(); ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1; ctx.beginPath(); for (let k = 1; k < 5; k++) { const f = k / 5; ctx.moveTo(x0 - sw * 0.35 * f, sgn * (y0 + span * f)); ctx.lineTo(x0 - sw * (1 + 0.2 * f), sgn * (y0 + span * f)); } ctx.stroke(); };
      if (view !== 'side') { fin(1, ws * 0.3); fin(-1, ws * 0.3); }
    }
    // drive bell
    const bell = ctx.createLinearGradient(0, -ws * 0.4, 0, ws * 0.4); bell.addColorStop(0, '#1a2029'); bell.addColorStop(0.5, '#4a5666'); bell.addColorStop(1, '#141920');
    ctx.fillStyle = bell; ctx.beginPath(); ctx.moveTo(-L * 0.48, -ws * 0.28); ctx.lineTo(-L * 0.6, -ws * 0.42); ctx.lineTo(-L * 0.6, ws * 0.42); ctx.lineTo(-L * 0.48, ws * 0.28); ctx.closePath(); ctx.fill();
    if (ship.throttle > 0.01 && !ship.destroyed) { ctx.fillStyle = 'rgba(191,227,255,' + (0.5 + 0.4 * ship.throttle) + ')'; ctx.beginPath(); ctx.moveTo(-L * 0.6, -ws * 0.4); ctx.lineTo(-L * 0.6, ws * 0.4); ctx.lineTo(-L * 0.56, ws * 0.3); ctx.lineTo(-L * 0.56, -ws * 0.3); ctx.closePath(); ctx.fill(); }
    // hull, lit from the upper bow
    const W = Math.max(ws * 0.55, L * 0.2);
    const hg = ctx.createLinearGradient(-lit.x * W, -lit.y * W, lit.x * W, lit.y * W);
    hg.addColorStop(0, '#0c1016'); hg.addColorStop(0.35, '#232c37'); hg.addColorStop(0.7, '#5a6b80'); hg.addColorStop(1, '#b3c2d4');
    path(); ctx.fillStyle = hg; ctx.fill();
    ctx.save(); path(); ctx.clip();
    ctx.strokeStyle = 'rgba(0,0,0,0.38)'; ctx.lineWidth = Math.max(1, L * 0.006); ctx.beginPath();
    for (const fx of [0.34, 0.18, 0.02, -0.14, -0.3, -0.42]) { ctx.moveTo(fx * L, -ws); ctx.lineTo(fx * L, ws); }
    ctx.moveTo(-L * 0.45, ws * 0.22); ctx.lineTo(L * 0.3, ws * 0.22); ctx.moveTo(-L * 0.45, -ws * 0.22); ctx.lineTo(L * 0.3, -ws * 0.22); ctx.stroke();
    if (view === 'side') { // a spine of sensor masts and the bridge blister on top
      ctx.fillStyle = '#6b7c90'; ctx.fillRect(-L * 0.2, -ws * 0.98, L * 0.5, ws * 0.22);
      ctx.fillStyle = '#2a3542'; for (let k = 0; k < 4; k++) ctx.fillRect(-L * 0.15 + k * L * 0.12, -ws * 1.05, L * 0.012, ws * 0.3);
    }
    ctx.fillStyle = col; ctx.globalAlpha *= 0.85;
    ctx.fillRect(-L * 0.3, -ws * 0.5, L * 0.42, Math.max(1.2, ws * 0.06)); ctx.fillRect(-L * 0.3, ws * 0.44, L * 0.42, Math.max(1.2, ws * 0.06));
    ctx.globalAlpha /= 0.85;
    ctx.fillStyle = 'rgba(255,236,200,0.7)';
    for (let k = 0; k < 7; k++) { const px = L * (0.16 - k * 0.07); ctx.fillRect(px, -ws * 0.36, Math.max(1, L * 0.008), Math.max(1, L * 0.014)); ctx.fillRect(px, ws * 0.3, Math.max(1, L * 0.008), Math.max(1, L * 0.014)); }
    ctx.restore();
    const eg = ctx.createLinearGradient(-lit.x * W, -lit.y * W, lit.x * W, lit.y * W); eg.addColorStop(0, 'rgba(255,255,255,0)'); eg.addColorStop(0.55, 'rgba(255,255,255,0.1)'); eg.addColorStop(1, 'rgba(255,255,255,0.85)');
    path(); ctx.strokeStyle = eg; ctx.lineWidth = Math.max(1.2, L * 0.014); ctx.stroke();
    ctx.strokeStyle = col; ctx.globalAlpha *= 0.6; ctx.lineWidth = Math.max(1, L * 0.008); ctx.stroke(); ctx.globalAlpha /= 0.6;
    ctx.strokeStyle = col; ctx.lineWidth = Math.max(1.5, L * 0.022);
    ctx.beginPath(); ctx.moveTo(L * 0.5, 0); ctx.lineTo(L * 0.32, ws * 0.2); ctx.moveTo(L * 0.5, 0); ctx.lineTo(L * 0.32, -ws * 0.2); ctx.stroke();
    // damage: scorched patches where the hull has been hit
    if (ship.hull < 0.999) { ctx.fillStyle = 'rgba(10,6,4,' + (0.3 + 0.5 * (1 - ship.hull)) + ')'; const n = Math.ceil((1 - ship.hull) * 8); for (let k = 0; k < n; k++) { const px = L * (0.35 - ((k * 37) % 70) / 100), py = ws * (((k * 53) % 60) / 100 - 0.3); ctx.beginPath(); ctx.ellipse(px, py, L * 0.035, ws * 0.12, 0, 0, U.TAU); ctx.fill(); } }
    ctx.restore();
  }
  // scales a hull length down until the whole picture (which can be taller than the hull is long) fits a box,
  // and says where the ship origin goes so the picture, not the origin, is centred on the anchor
  function fitArt(ship, view, L, maxW, maxH) {
    const id = artId(ship);
    if (!OD.Render.artReady(id) || typeof OD.ShipArt.bounds !== 'function') return { L, dx: 0, dy: 0, w: L, h: L * 0.3 };
    try {
      const probe = 120;
      const b = OD.ShipArt.bounds(id, { size: probe, view: ART_VIEW[view] || view, quality: 'low' });
      if (!b || !b.w || !b.h) return { L, dx: 0, dy: 0, w: L, h: L * 0.3 };
      const k = Math.min(1, (maxW * 0.97) / (b.w * L / probe), (maxH * 0.97) / (b.h * L / probe));
      const Lf = L * k, s = Lf / probe;
      return { L: Lf, dx: (b.ox - b.w / 2) * s, dy: (b.oy - b.h / 2) * s, w: b.w * s, h: b.h * s };
    } catch (e) { return { L, dx: 0, dy: 0, w: L, h: L * 0.3 }; }
  }
  function sizeCanvas(c) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    // v15: a canvas with no box (the phone panel is hidden while a card is open) keeps its backing store; taking
    // c.width as its CSS width doubled the portrait's store on every refresh at 2× (1.5 billion px in 4 s)
    const shown = c.clientWidth > 0 && c.clientHeight > 0;
    const W = shown ? c.clientWidth : c.width / dpr, H = shown ? c.clientHeight : c.height / dpr;
    if (shown && (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr))) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    const ctx = c.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, W, H };
  }
  function drawPortrait(ship, pic) {
    const c = $('pPortrait'); if (!c || !c.clientWidth) return;
    const { ctx, W, H } = sizeCanvas(c);
    ctx.clearRect(0, 0, W, H);
    ctx.font = '9.5px "IBM Plex Mono", ui-monospace, monospace'; ctx.fillStyle = 'rgba(127,145,167,0.9)'; ctx.textAlign = 'left';
    // a bare contact has no picture, as in the hull view; a track shows the class and its radiators, nothing live
    if (pic && pic.level === 'contact') ctx.fillText('contact only: no picture', 8, H - 6);
    else {
      // the ship sits low-left so the Follow and Full keys in the top-right corner never cover it
      const fit = fitArt(ship, 'side', Math.min(W * 0.72, H * 2.2), W * 0.72, H * 0.6);
      drawHull(ctx, ship, W * 0.38 + fit.dx, H * 0.62 + fit.dy, fit.L, 'side', pic && pic.level === 'track' ? { quality: 'low', plain: true } : { quality: 'low', live: true });
      ctx.font = '9.5px "IBM Plex Mono", ui-monospace, monospace'; ctx.fillStyle = 'rgba(127,145,167,0.9)'; ctx.textAlign = 'left';
      ctx.fillText((OD.Ships.CLASSES[ship.cls].length) + ' m', 8, H - 6);
    }
    // the V key only where there is a keyboard (index.html hides key letters on a touch screen the same way)
    ctx.textAlign = 'right'; ctx.fillText(coarseQuery && coarseQuery.matches ? 'hull view' : 'hull view  V', W - 8, H - 6);
  }

  // ------------------------------------------------------------------ hull view screen
  const hullState = { view: 'side', shipId: null, lastKv: 0 };
  const VIEW_NAMES = { side: 'from the side', top: 'from above', 'three-quarter': 'three-quarter' };
  function hullShips(sim) { return sim.ships.filter((s) => !s.destroyed); }
  function hullView(id) {
    if (!game.sim) return;
    if (window.innerWidth <= 900 && document.body.classList.contains('decision-open')) { toast('Answer the question first. Esc leaves it for later.', 3000); return; }
    const ship = (id && game.sim.byId(id)) || selected() || game.sim.playerShips()[0]; if (!ship) return;
    hullState.shipId = ship.id;
    // v12: the hull view stays live; the sim keeps stepping at the current warp and the picture follows it
    const el = screen('hull', '<div class="eyebrow">Hull view<span class="hull-esc"> · V or Esc closes</span></div><h2 class="title hull-title" id="hullName"></h2><p class="sub" id="hullSub"></p>' +
      '<div class="hullview"><div><div class="views"><span class="seg" id="hullViews">' + ['side', 'top', 'three-quarter'].map((v, i) => '<button data-view="' + v + '">' + (v === 'three-quarter' ? 'Three-quarter' : v[0].toUpperCase() + v.slice(1)) + '<kbd>' + (i + 1) + '</kbd></button>').join('') + '</span><span style="flex:1"></span><button class="sm" id="hullPrev" title="Previous ship (←)">◀ Prev</button><button class="sm" id="hullNext" title="Next ship (→)">Next ▶</button></div>' +
      '<div class="pic" id="hullPic"><canvas id="hullCanvas" aria-label="Hull of the selected ship"></canvas></div><div id="hullLive" style="font-size:12.5px;margin-top:6px;min-height:1.4em;color:var(--ink)"></div>' +
      // v13: the parties get their own strip between the live line and the part definitions, so they are never
      // inside the scrolling callout box
      '<div id="hullParties" hidden><b>Parties</b><span></span></div>' +
      '<div class="dim" id="hullParts" style="font-size:12px;margin-top:4px;min-height:1.4em;white-space:pre-line"></div></div>' +
      '<div class="kv" id="hullKv"></div></div>' +
      '<div class="actions"><button class="primary" id="hullClose">Close<kbd>Esc</kbd></button></div>', { wide: true });
    el.classList.add('fade-in');
    el.querySelectorAll('#hullViews button').forEach((b) => b.addEventListener('click', () => setHullView(b.dataset.view)));
    el.querySelector('#hullPrev').addEventListener('click', () => cycleHull(-1));
    el.querySelector('#hullNext').addEventListener('click', () => cycleHull(1));
    el.querySelector('#hullClose').addEventListener('click', () => closeScreen());
    setHullView(hullState.view);
    hullState.lastKv = 0;
    drawHullScreen(game.sim, performance.now());
  }
  function setHullView(v) { hullState.view = v; document.querySelectorAll('#hullViews button').forEach((b) => b.classList.toggle('active', b.dataset.view === v)); hullState.lastKv = 0; }
  function cycleHull(dir) { const list = hullShips(game.sim); if (!list.length) return; const i = list.findIndex((s) => s.id === hullState.shipId); hullState.shipId = list[(i + dir + list.length) % list.length].id; hullState.lastKv = 0; }
  function hullKey(key) {
    if (key === 'ArrowLeft') cycleHull(-1); else if (key === 'ArrowRight') cycleHull(1);
    else if (key === '1') setHullView('side'); else if (key === '2') setHullView('top'); else if (key === '3') setHullView('three-quarter');
    else return false;
    return true;
  }
  // Part labels sit in lanes above and below the picture, four rows deep on each side. Each leader runs from the
  // part to a bus line just outside the picture, along it, then up into its label, so a label can slide sideways
  // to a free slot: text never overlaps text and no leader ever runs through a label.
  function drawCallouts(ctx, parts, cx, cy, W, H) {
    ctx.font = '10.5px "IBM Plex Mono", ui-monospace, monospace';
    // a phone has room for two rows of labels a side, a laptop four
    const ROWS = W < 430 ? 2 : 4, STEP = 13, TOP = 28, BOTTOM = 44;
    const items = parts.slice(0, 16).map((p) => ({ label: p.label, px: cx + p.x, py: cy + p.y, w: ctx.measureText(p.label).width + 8 })).sort((a, b) => a.px - b.px);
    // parts above the axis label upward, parts below label downward; parts on the axis go to whichever lane is emptier
    const count = { up: 0, down: 0 };
    for (const it of items) { it.side = it.py < cy - 3 ? 'up' : it.py > cy + 3 ? 'down' : null; if (it.side) count[it.side]++; }
    for (const it of items) if (!it.side) { it.side = count.up <= count.down ? 'up' : 'down'; count[it.side]++; }
    const lanes = { up: { edge: [0, 0, 0, 0], texts: [], stubs: [], out: [] }, down: { edge: [0, 0, 0, 0], texts: [], stubs: [], out: [] } };
    for (const it of items) {
      const lane = lanes[it.side];
      let best = null;
      for (let row = ROWS - 1; row >= 0; row--) {
        // the text clears earlier text in its row and the stubs of outer labels; its own stub may attach anywhere
        // under the text, wherever it passes between the texts of the rows nearer the hull
        let x0 = Math.max(it.px - 3, lane.edge[row] + 6), sx = -1;
        for (let guard = 0; guard < 12 && sx < 0; guard++) {
          let moved = false;
          for (const st of lane.stubs) if (st.row < row && st.x > x0 - 4 && st.x < x0 + it.w + 4) { x0 = st.x + 4; moved = true; }
          if (moved) continue;
          let cand = Math.max(x0 + 3, it.px);
          if (cand > x0 + it.w - 3) cand = x0 + 3;
          for (let pass = 0; pass < 12; pass++) {
            const hit = lane.texts.find((t) => t.row > row && cand > t.x0 - 3 && cand < t.x1 + 3);
            if (!hit) break;
            cand = hit.x1 + 3;
          }
          if (cand <= x0 + it.w - 3) sx = cand;
          else { const blocker = lane.texts.filter((t) => t.row > row && t.x1 + 3 > x0 + 3).sort((a, b) => a.x1 - b.x1)[0]; x0 = blocker ? blocker.x1 + 6 : x0 + it.w; }
        }
        if (sx < 0 || x0 + it.w > W - 4) continue;
        const cost = x0 - (it.px - 3) + Math.abs(sx - it.px) * 0.5;
        if (!best || cost < best.cost - 1) best = { row, x0, sx, cost };
      }
      if (!best) continue;
      it.row = best.row; it.x0 = best.x0; it.x1 = best.x0 + it.w; it.sx = best.sx;
      lane.edge[best.row] = it.x1; lane.texts.push(it); lane.stubs.push({ row: best.row, x: best.sx }); lane.out.push(it);
    }
    for (const side of ['up', 'down']) {
      const up = side === 'up';
      const bus = up ? TOP + (ROWS - 1) * STEP + 10 : H - BOTTOM - (ROWS - 1) * STEP - 16;
      for (const it of lanes[side].out) {
        const ty = up ? TOP + it.row * STEP : H - BOTTOM - it.row * STEP;
        const sx = it.sx, by = up ? Math.min(bus, it.py) : Math.max(bus, it.py);
        ctx.strokeStyle = 'rgba(79,209,197,0.55)'; ctx.lineWidth = 1; ctx.beginPath();
        ctx.moveTo(it.px, it.py); ctx.lineTo(it.px, by); ctx.lineTo(sx, by); ctx.lineTo(sx, up ? ty + 4 : ty - 11); ctx.stroke();
        ctx.fillStyle = '#4fd1c5'; ctx.beginPath(); ctx.arc(it.px, it.py, 2, 0, U.TAU); ctx.fill();
        ctx.fillStyle = 'rgba(6,10,17,0.72)'; ctx.fillRect(it.x0 - 1, ty - 10, it.w + 2, 13);
        ctx.fillStyle = 'rgba(224,232,240,0.94)'; ctx.textAlign = 'left'; ctx.fillText(it.label, it.x0 + 4, ty);
      }
    }
    ctx.textAlign = 'left';
  }
  // v15: part labels in two columns beside the picture, for a hull about as tall as it is long (a station, a
  // hull seen from above with its radiators out). Each column takes the parts on its side, its labels sit as
  // near their parts' heights as the 13 px spacing allows, and each leader runs straight from the part to its
  // label. Two leaders that cross swap labels, so no leaders cross.
  function spreadLabels(want, step, lo, hi) {
    // the closest heights to want (ascending) that keep step apart and stay inside lo..hi when they fit
    const blocks = [];
    want.forEach((d, i) => {
      let b = { sum: d - i * step, n: 1 };
      while (blocks.length && blocks[blocks.length - 1].sum / blocks[blocks.length - 1].n >= b.sum / b.n) { const p = blocks.pop(); b = { sum: p.sum + b.sum, n: p.n + b.n }; }
      blocks.push(b);
    });
    const out = [], top = Math.max(lo, hi - (want.length - 1) * step);
    for (const b of blocks) { const z = Math.min(Math.max(b.sum / b.n, lo), top); for (let k = 0; k < b.n; k++) out.push(z + out.length * step); }
    return out;
  }
  function segCross(ax, ay, bx, by, cx, cy, dx, dy) {
    const o = (px, py, qx, qy, rx, ry) => (qx - px) * (ry - py) - (qy - py) * (rx - px);
    const d1 = o(cx, cy, dx, dy, ax, ay), d2 = o(cx, cy, dx, dy, bx, by), d3 = o(ax, ay, bx, by, cx, cy), d4 = o(ax, ay, bx, by, dx, dy);
    return d1 * d2 < 0 && d3 * d4 < 0;
  }
  function drawCalloutsLR(ctx, parts, cx, cy, W, H, fit) {
    ctx.font = LABEL_FONT;
    const STEP = 13, TOP = 32, BOT = H - 40, mid = W / 2;
    const items = parts.slice(0, 16).map((p) => ({ label: p.label, px: cx + p.x, py: cy + p.y, w: ctx.measureText(p.label).width + 8 })).sort((a, b) => a.px - b.px || a.py - b.py);
    let k = items.findIndex((it) => it.px >= mid); if (k < 0) k = items.length;
    // neither column carries more than two labels over the other
    while (k > items.length - k + 2) k--;
    while (items.length - k > k + 2) k++;
    const cols = [{ left: true, list: items.slice(0, k), bus: mid - fit.w / 2 - 12 }, { left: false, list: items.slice(k), bus: mid + fit.w / 2 + 12 }];
    for (const col of cols) {
      const list = col.list.sort((a, b) => a.py - b.py), n = list.length, ax = col.bus;
      if (!n) continue;
      const ys = spreadLabels(list.map((it) => it.py + 3.5), STEP, TOP, BOT);
      list.forEach((it, i) => { it.ty = ys[i]; });
      for (let pass = 0; pass < 40; pass++) {
        let swapped = false;
        for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
          const a = list[i], b = list[j];
          if (segCross(a.px, a.py, ax, a.ty - 3.5, b.px, b.py, ax, b.ty - 3.5)) { const t = a.ty; a.ty = b.ty; b.ty = t; swapped = true; }
        }
        if (!swapped) break;
      }
      for (const it of list) {
        const yl = it.ty - 3.5, x0 = col.left ? ax - 4 - it.w : ax + 4;
        ctx.strokeStyle = 'rgba(79,209,197,0.55)'; ctx.lineWidth = 1; ctx.beginPath();
        ctx.moveTo(it.px, it.py); ctx.lineTo(ax, yl); ctx.lineTo(col.left ? ax - 4 : ax + 4, yl); ctx.stroke();
        ctx.fillStyle = '#4fd1c5'; ctx.beginPath(); ctx.arc(it.px, it.py, 2, 0, U.TAU); ctx.fill();
        ctx.fillStyle = 'rgba(6,10,17,0.72)'; ctx.fillRect(x0 - 1, it.ty - 10, it.w + 2, 13);
        ctx.fillStyle = 'rgba(224,232,240,0.94)'; ctx.textAlign = 'left'; ctx.fillText(it.label, x0 + 4, it.ty);
      }
    }
    ctx.textAlign = 'left';
  }
  // v15: where the labels go sets how large the picture can be. Lanes above and below suit a long hull; two
  // columns beside it suit a hull about as tall as it is long. The layout that draws the larger ship wins. It is
  // worked out again when the ship, the view, the sensor picture or the box changes, and every half second.
  const LABEL_FONT = '10.5px "IBM Plex Mono", ui-monospace, monospace';
  let hullLay = null;
  function hullLayout(ctx, sim, ship, view, pic, W, H, now) {
    const key = ship.id + '|' + view + '|' + pic.level + '|' + W + 'x' + H;
    if (hullLay && hullLay.key === key && now - hullLay.t < 500) return hullLay;
    const L0 = Math.min(W * 0.84, H * (view === 'top' ? 1.05 : 1.7));
    let labels = null;
    if (pic.level === 'full' && typeof OD.ShipArt.callouts === 'function' && OD.Render.artReady(artId(ship))) {
      try { labels = (OD.ShipArt.callouts(artId(ship), OD.Render.artOpts(ship, sim, { x: 0, y: 0, size: 120, view: ART_VIEW[view] || view, rotation: 0 })) || []).slice(0, 16).map((p) => p.label); } catch (e) { labels = null; }
    }
    let mode = 'plain', fit;
    // no labels: small margins for the class caption above and the scale bar below
    if (!labels || !labels.length) fit = fitArt(ship, view, L0, W * 0.9, H - 56);
    else {
      mode = 'lanes';
      // a phone's two rows a side run 75 px in from each edge, so the picture stays between them
      fit = fitArt(ship, view, L0, W * 0.86, H - (W < 430 ? 150 : 116));
      ctx.font = LABEL_FONT;
      const lw = Math.max.apply(null, labels.map((t) => ctx.measureText(t).width)) + 8;
      const room = W - 2 * (lw + 26), perSide = Math.floor(labels.length / 2) + 1;
      // a station always takes the columns: its parts stack along one axis, and lanes above and below bundled
      // their leaders over the hub and ran them through the labels under the reactor
      const station = (OD.Ships.CLASSES[ship.cls] || {}).role === 'station';
      if (room > 80 && (perSide - 1) * 13 <= H - 72) {
        const cols = fitArt(ship, view, L0, room, H - 56);
        if (station || cols.L > fit.L * 1.12) { mode = 'columns'; fit = cols; }
      }
    }
    hullLay = { key, t: now, mode, fit };
    return hullLay;
  }
  function drawHullScreen(sim, now) {
    const c = $('hullCanvas'); if (!c) return;
    const ship = sim.byId(hullState.shipId) || selected(); if (!ship) return;
    const cls = OD.Ships.CLASSES[ship.cls];
    const { ctx, W, H } = sizeCanvas(c);
    ctx.clearRect(0, 0, W, H);
    // drafting grid
    ctx.strokeStyle = 'rgba(120,150,180,0.08)'; ctx.lineWidth = 1; ctx.beginPath();
    for (let x = (W / 2) % 40; x < W; x += 40) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    for (let y = (H / 2) % 40; y < H; y += 40) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(120,150,180,0.18)'; ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();
    const view = hullState.view;
    // v12: what the sensors give on a hostile decides what the screen shows: a bare contact has no picture, a
    // track shows the class and its radiators, a solution shows everything
    const pic = hullPicture(sim, ship);
    // room for the part labels: lanes above and below, or columns beside (hullLayout)
    const lay = hullLayout(ctx, sim, ship, view, pic, W, H, now);
    const fit = lay.fit, L = fit.L, cx = W / 2 + fit.dx, cy = H / 2 + fit.dy;
    let drawn = false;
    if (pic.level === 'contact') {
      ctx.font = '13px "IBM Plex Mono", ui-monospace, monospace'; ctx.fillStyle = 'rgba(224,232,240,0.8)'; ctx.textAlign = 'center';
      ctx.fillText('Contact only: a bearing and a rough range.', W / 2, H / 2 - 12);
      ctx.fillText('No picture until the track improves.', W / 2, H / 2 + 10);
      ctx.textAlign = 'left';
    } else drawn = drawHull(ctx, ship, cx, cy, L, view, pic.level === 'track' ? { quality: 'high', plain: true } : { quality: 'high', live: true });
    if (pic.level !== 'contact') {
      // scale bar, view name and class caption: only under a picture
      const mPer = cls.length / L; let bar = 10; while (bar * 2 / mPer < 60) bar *= 2; if (bar > cls.length) bar = cls.length;
      const bw = bar / mPer;
      ctx.strokeStyle = 'rgba(224,232,240,0.7)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(16, H - 18); ctx.lineTo(16 + bw, H - 18); ctx.moveTo(16, H - 22); ctx.lineTo(16, H - 14); ctx.moveTo(16 + bw, H - 22); ctx.lineTo(16 + bw, H - 14); ctx.stroke();
      ctx.font = '11px "IBM Plex Mono", ui-monospace, monospace'; ctx.fillStyle = 'rgba(224,232,240,0.8)'; ctx.textAlign = 'left'; ctx.fillText(bar + ' m', 16, H - 26);
      ctx.textAlign = 'right'; ctx.fillStyle = 'rgba(127,145,167,0.9)'; ctx.fillText(VIEW_NAMES[view] + ' · nose right', W - 12, H - 12);
      ctx.textAlign = 'left'; ctx.fillText(cls.name.toUpperCase(), 12, 16);
    }
    // callouts from the art module, when it offers them
    let parts = null;
    if (drawn && pic.level === 'full' && typeof OD.ShipArt.callouts === 'function') { try { parts = OD.ShipArt.callouts(artId(ship), OD.Render.artOpts(ship, sim, { x: 0, y: 0, size: L, view: ART_VIEW[view] || view, rotation: 0 })) || null; } catch (e) { parts = null; } }
    if (parts && parts.length) { if (lay.mode === 'columns') drawCalloutsLR(ctx, parts, cx, cy, W, H, fit); else drawCallouts(ctx, parts, cx, cy, W, H); }
    if (now - hullState.lastKv > 400) {
      hullState.lastKv = now;
      const nm = $('hullName'), sub = $('hullSub'), kv = $('hullKv'), pl = $('hullParts'), lv = $('hullLive');
      const shown = ship.name;
      if (nm && nm.textContent !== shown) nm.textContent = shown;
      let subCut = '';
      if (sub) {
        const fac = OD.Ships.FACTIONS[ship.faction].name;
        let line;
        if (ship.faction === sim.playerFaction) line = cls.name + ' · ' + fac + '. ' + cls.blurb + (cls.advice ? ' ' + cls.advice : '');
        else if (ship.faction === 'CIV') line = cls.name + ' · ' + fac + ' · civilian. ' + cls.blurb;
        else if (ship.destroyed) line = cls.name + ' · ' + fac + '. Destroyed. ' + cls.blurb;
        else if (pic.level === 'full') line = cls.name + ' · ' + fac + '. We hold a firing solution on her, so this is everything. ' + cls.blurb;
        else if (pic.level === 'track') line = cls.name + ' · ' + fac + '. We hold a track on her: the class and her radiators, nothing more.';
        else line = 'Class unknown · ' + fac + '. A bearing and a rough range, nothing more.';
        if (sub.textContent !== line) { sub.textContent = line; sub.title = line; }
        // v15: beside a fight the class line stops at two lines; when it is cut, the part list ends with all of it
        if (sub.clientHeight > 0 && sub.scrollHeight > sub.clientHeight + 1) subCut = line;
      }
      const dash = '\u2014';
      const full = pic.level === 'full', known = pic.level !== 'contact';
      // v15: a hull built without a drive shows one Drive row saying so, not a 1 m/s exhaust and 0 N of thrust
      const drv = hasDrive(ship), round = armourAllRound(ship);
      const rows = [
        ['Length', known ? cls.length + ' m' : dash], ['Dry mass', full ? U.fmt.mass(ship.dryMass) : dash]]
        .concat(drv ? [['Propellant', full ? U.fmt.mass(ship.propMass) + ' / ' + U.fmt.mass(ship.fullPropMass) : dash],
          ['Delta-v', full ? U.fmt.dv(ship.deltaV()) + ' / ' + U.fmt.dv(ship.deltaVFull()) : dash], ['Exhaust', known ? U.fmt.speed(ship.exhaustVelocity) : dash], ['Thrust', known ? U.fmt.si(ship.thrust, 'N') : dash], ['Accel.', full ? U.fmt.accel(liveAccel(ship)) : dash]]
          : [['Drive', known ? 'none fitted' : dash]])
        .concat([['Radiators', known ? U.fmt.num(ship.radiatorArea) + ' m² · ' + Math.round(ship.radiators.state * 100) + '% out' : dash], ['Heat sink', full ? Math.round(ship.thermalLoad() * 100) + '% full' : dash]])
        .concat(round ? [['Armour', full ? ship.armour.nose + ' cm all round' : dash]] : [['Armour nose', full ? ship.armour.nose + ' cm' : dash], ['Armour flank / tail', full ? ship.armour.flank + ' / ' + ship.armour.tail + ' cm' : dash]])
        .concat([['Hull', full ? Math.round(ship.hull * 100) + '%' : dash]], drv ? [['Drive', full ? Math.round(ship.systems.drive * 100) + '%' : dash]] : [], [['Sensors', full ? Math.round(ship.systems.sensors * 100) + '%' : dash]]);
      const fitted = full ? (ship.mounts.length ? ship.mounts.map((m) => m.name).join(' · ') : 'nothing') : known ? 'unknown until we hold a solution' : 'unknown';
      const html = rows.map(([k, v]) => '<span class="k">' + esc(k) + '</span><span class="v">' + esc(v) + '</span>').join('') +
        '<span class="k" style="grid-column:1/-1;margin-top:6px">Fitted</span><span class="v" style="grid-column:1/-1;white-space:normal;text-align:left">' + esc(fitted) + '</span>';
      if (kv && kv.innerHTML !== html) kv.innerHTML = html;
      let pt = parts && parts.length ? parts.map((p) => p.label + (p.text ? ': ' + p.text : '')).join('\n') : (drawn || pic.level === 'contact' ? '' : 'No detailed render for this hull yet. This is the structural silhouette.');
      if (subCut) pt = pt ? pt + '\n' + subCut : subCut;
      if (pl && pl.textContent !== pt) pl.textContent = pt;
      const strip = $('hullParties');
      if (strip) {
        const lines = partyLines(ship, sim);
        const body = strip.querySelector('span');
        if (body && body.textContent !== lines) body.textContent = lines;
        strip.hidden = !lines;
      }
      const live = hullLiveLine(sim, ship, pic);
      if (lv && lv.textContent !== live) lv.textContent = live;
    }
  }

  // The parties at work on our own hull, in their own strip in the hull view (v13). One line each, plus the g
  // line when the burn has them strapped in, which is why the rings on the picture have stopped.
  function partyLines(ship, sim) {
    if (!sim || !ship || ship.faction !== sim.playerFaction) return '';
    const b = crewBoard(ship); if (!b || !b.parties) return '';
    const lines = b.parties.filter((p) => (p.task === 'repair' || p.task === 'medical') && p.words).map((p) => p.words);
    if (!lines.length) return '';
    if (b.crew && b.crew.strapped && b.gWords) lines.push(b.gWords);
    return lines.join('\n');
  }
  // What the player's sensors give on a hull: 'full' for our own, civilians and any hostile we hold a solution on;
  // 'track' when the class is known; 'contact' for a bearing and a rough range.
  function hullPicture(sim, ship) {
    const S = OD.Sensors;
    if (!S || typeof S.track !== 'function' || !sim.playerFaction || ship.faction === sim.playerFaction || ship.faction === 'CIV' || ship.destroyed) return { level: 'full', classKnown: true };
    let tr = null;
    try { tr = S.track(sim, sim.playerFaction, ship); } catch (e) { tr = null; }
    if (!tr || !isFinite(tr.q)) return { level: 'full', classKnown: true };
    const sq = (S.T && S.T.solutionQ) || 2.7, tq = (S.T && S.T.trackQ) || 1.8;
    if (tr.q >= sq) return { level: 'full', classKnown: true, word: tr.word || 'solution' };
    if (tr.q >= tq && tr.classKnown !== false) return { level: 'track', classKnown: true, word: tr.word || 'track' };
    return { level: 'contact', classKnown: false, word: tr.word || 'contact' };
  }
  // v15 round 3: the panel shows a hostile the way the hull view does, as far as our sensors hold her
  // (hullPicture); null for our own hulls and civilians, which it shows whole
  function hostilePic(sim, ship) {
    if (!sim || !ship || !sim.playerFaction || ship.faction === sim.playerFaction || ship.faction === 'CIV') return null;
    return hullPicture(sim, ship);
  }
  // What the panel was built for: the modules present and, for a hostile, what we hold on her, so a contact that
  // becomes a track or a solution gets the panel that level allows.
  function panelKey(pic) { return !!OD.Engagement + ':' + !!(OD.Damage && OD.Damage.report) + ':' + (pic ? pic.level + (pic.classKnown ? '+' : '') : 'ours'); }
  function nearestOwn(sim, ship) {
    let near = null, nd = Infinity;
    for (const s of (sim.playerShips ? sim.playerShips() : [])) { if (s.destroyed || s === ship) continue; const d = U.dist(s.pos, ship.pos); if (d < nd) { nd = d; near = s; } }
    return near;
  }
  // The range to a hostile as our plot has it, from one of our ships: the one asked for, else the ship the map's
  // contact labels measure from (render.js lookout: the first of ours that is not a station), else the nearest.
  // Below a solution the range runs to where the track puts her, with the track's range error; at a solution it is
  // the truth and the error is 0.
  function trackFix(sim, ship, pic, prefer) {
    let tr = null;
    if (OD.Sensors && typeof OD.Sensors.track === 'function' && !ship.destroyed) { try { tr = OD.Sensors.track(sim, sim.playerFaction, ship); } catch (e) { tr = null; } }
    const ours = (s) => !!s && !s.destroyed && s.faction === sim.playerFaction;
    const first = (sim.playerShips ? sim.playerShips() : []).find((x) => x.role !== 'station');
    const from = ours(prefer) ? prefer : ours(first) ? first : nearestOwn(sim, ship);
    if (!from) return null;
    const full = !pic || pic.level === 'full';
    const est = !full && tr && tr.est && tr.est.pos && isFinite(tr.est.pos.x) && isFinite(tr.est.pos.y) ? tr.est : null;
    const at = est ? est.pos : ship.pos, vel = est && est.vel ? est.vel : ship.vel;
    const r = U.sub(at, from.pos), d = U.len(r);
    const c0 = d > 0 ? -U.dot(U.sub(vel, from.vel), U.norm(r)) : 0;
    return { from, d, err: full || !tr ? 0 : (tr.rangeErr || tr.posErr || 0), closing: Math.abs(c0) < 0.05 ? 0 : c0 };
  }
  const two = (x) => Number(x.toPrecision(2));
  // A hostile's panel says what our sensors hold on her where our own ship's says what the navigator plans: her
  // orders are hers. The level, the ship of ours that holds her and the range from it with its error; at a
  // solution, what the plume shows her doing.
  function trackPanel(sim, ship, pic, fix, set) {
    const word = pic.word || (pic.level === 'full' ? 'solution' : pic.level);
    set('ostate', ship.destroyed ? 'lost' : word);
    if (bound.ostate) bound.ostate.className = 'pill ' + (ship.destroyed ? '' : pic.level === 'full' ? 'good' : pic.level === 'track' ? 'warn' : 'crit');
    const rng = fix ? (fix.err > 0 ? km(two(fix.d)) + ' ± ' + km(two(fix.err)) : '≈ ' + km(two(fix.d))) : '';
    let text, sub = '';
    if (ship.destroyed) text = 'She is destroyed.';
    else if (pic.level === 'full') {
      const g = ship.throttle > 0.02 && typeof ship.accel === 'function' ? (ship.accel() * ship.throttle) / 9.80665 : 0;
      text = (fix ? fix.from.name + ' holds' : 'We hold') + ' a firing solution on her. ' + (ship.disabled ? 'She is disabled.' : g > 0 ? 'She is burning at ' + U.fmt.num(g, 2) + ' g.' : 'She is coasting.');
    } else if (pic.level === 'track') {
      text = fix ? fix.from.name + ' holds a track on her at ' + rng + '.' : 'We hold a track on her.';
      sub = 'We know her class and see her radiators, nothing more.';
    } else {
      text = fix ? fix.from.name + ' has a bearing on her and a range of ' + rng + '.' : 'We have a bearing on her and a rough range.';
      sub = 'No class and no picture until the track improves.';
    }
    set('navtext', text); set('navsub', sub);
    if (bound.navsub) bound.navsub.hidden = !sub;
  }
  // The fight, in one line under the picture: for our ship the threat line, the target with range and closing,
  // and the fire mode; for a hostile, what our track on her is and from which of our ships.
  function hullLiveLine(sim, ship, pic) {
    const bits = [];
    if (ship.faction === sim.playerFaction) {
      const E = OD.Engagement;
      if (E && E.threatSummary) { try { const s = E.threatSummary(sim, ship); if (s && s.level && s.level !== 'none' && s.text) bits.push(s.text); } catch (e) { /* optional */ } }
      const tg = ship.target ? sim.byId(ship.target) : null;
      if (tg && !tg.destroyed) {
        const r = U.dist(ship.pos, tg.pos);
        const rel = U.sub(tg.vel, ship.vel), los = U.norm(U.sub(tg.pos, ship.pos));
        const closing = -(rel.x * los.x + rel.y * los.y);
        bits.push('target ' + tg.name + ' · ' + U.fmt.dist(r) + ' · ' + (Math.abs(closing) < 0.5 ? 'range steady' : (closing > 0 ? 'closing ' : 'opening ') + U.fmt.speed(Math.abs(closing))));
      }
      if (E && E.shipReadout) { try { const row = (E.shipReadout(ship) || []).find((x) => /^fire mode$/i.test(x.label || '')); if (row && row.value) bits.push('beams ' + row.value); } catch (e) { /* optional */ } }
      if (!bits.length) bits.push('no threats · no target');
    } else if (ship.faction !== 'CIV') {
      // from the ship we command, and then from the nearest of ours if that is someone else; with none of ours
      // selected, from the ship the map measures from. A range under a solution runs to where the track puts her, the plot's two figures with its
      // error, never the truth (trackFix, as the ship panel has it)
      const sel = selected();
      const from = sel && sel.faction === sim.playerFaction && !sel.destroyed ? sel : null;
      const sig2 = (v) => { if (!isFinite(v) || v === 0) return 0; const m = Math.pow(10, Math.floor(Math.log10(Math.abs(v))) - 1); return Math.round(v / m) * m; };
      const rng = (f) => pic.level === 'full' ? U.fmt.dist(f.d) : 'about ' + U.fmt.dist(sig2(f.d)) + (f.err > 0 ? ', ±' + U.fmt.dist(sig2(f.err)) : '');
      bits.push(pic.word || 'contact');
      const f1 = trackFix(sim, ship, pic, from);
      if (f1) bits.push(rng(f1) + (f1.from === from ? ' from us' : ' from ' + f1.from.name));
      const near = nearestOwn(sim, ship);
      if (from && near && f1 && near !== f1.from) { const f2 = trackFix(sim, ship, pic, near); if (f2) bits.push(rng(f2) + ' from ' + near.name); }
    }
    return bits.join('  ·  ');
  }

  // ------------------------------------------------------------------ objectives & log
  function updateObjectives(sim) {
    const html = sim.objectives.filter((o) => !o.hidden && !o.inactive).map((o) => '<div class="obj ' + (o.done ? 'done' : o.failed ? 'failed' : '') + '"><span class="mark">' + (o.done ? '✓' : o.failed ? '✕' : '◇') + '</span><span class="text">' + esc(o.text) + (o.optional ? ' <span class="pill">optional</span>' : '') + '</span>' + (!o.done && !o.failed && o.progress > 0 && o.progress < 1 ? bar('', o.progress) : '') + '</div>').join('');
    const el = $('objList');
    if (el.innerHTML !== html) el.innerHTML = html;
  }
  function appendLog(e) {
    const el = $('log');
    const d = document.createElement('div');
    d.className = 'line ' + (e.kind || '');
    // the speaker column is one line wide; a name longer than it keeps the whole name on hover
    d.innerHTML = '<span class="t">' + U.fmt.clock(e.t) + '</span><span class="who"' + (e.speaker ? ' title="' + esc(e.speaker) + '"' : '') + '>' + esc(e.speaker || '') + '</span><span class="msg">' + esc(nbPct(e.text)) + '</span>';
    el.appendChild(d);
    while (el.children.length > 80) el.removeChild(el.firstChild);
    el.scrollTop = el.scrollHeight;
  }
  function resetLog(sim) { $('log').innerHTML = ''; logCount = 0; for (const e of sim.log) appendLog(e); logCount = sim.log.length; logFit(); }
  // v15: the log follows its newest line, and a line scrolled partly out of its top read as half a line under the
  // panel above it. While the log follows, such a line is hidden until it is whole again; scrolled back by hand,
  // every line shows and the top edge fades as before.
  // On a phone a hidden line left an empty band at the top of the box (40 px early in chapter 1), so there the lines
  // are placed whole from the top of the box while it follows (phoneLogFit). The newest line is never hidden, even
  // when it is taller than the box.
  const phoneQuery = window.matchMedia ? window.matchMedia('(max-width: 900px)') : null;
  const coarseQuery = window.matchMedia ? window.matchMedia('(pointer: coarse)') : null;
  // A new width or text size rewraps the lines; a log that was following its newest line keeps following it.
  let logFollowing = true;
  function logFit(relaid) {
    const el = $('log'); if (!el) return;
    let follow = el.clientHeight > 0 && el.scrollHeight - el.scrollTop - el.clientHeight < 4;
    if (relaid === true && logFollowing && !follow && el.clientHeight > 0) { el.scrollTop = el.scrollHeight; follow = true; }
    logFollowing = follow;
    el.classList.toggle('follow', follow);
    phoneLogFit(el, follow);
    if (!follow) { el.querySelectorAll('.line.cut').forEach((d) => d.classList.remove('cut')); return; }
    const top = el.getBoundingClientRect().top + el.clientTop;
    const lines = el.children;
    for (let i = lines.length - 1; i >= 0; i--) {
      const r = lines[i].getBoundingClientRect();
      lines[i].classList.toggle('cut', i < lines.length - 1 && r.top < top - 0.5);
      if (r.bottom <= top) break;
    }
  }
  // v15, phone: while the log follows, the newest lines that fit whole start at the top of the box and the room left
  // over sits under the newest line (as padding), so there is never an empty band over the first line and the box,
  // and the ship panel above it, keep their height. Scrolled back by hand, the padding stays until the log follows
  // again, so a small scroll does not snap back. Nothing is reset to measure, so a call from the scroll event
  // changes nothing when nothing changed.
  function phoneLogFit(el, follow) {
    const phone = !!(phoneQuery && phoneQuery.matches);
    const extra0 = el._padExtra || 0;
    if (!phone) { if (extra0) { el.style.paddingBottom = ''; el._padExtra = 0; } return; }
    if (!follow) return;
    const cs = getComputedStyle(el);
    const padT = parseFloat(cs.paddingTop), padB = parseFloat(cs.paddingBottom) - extra0;
    // the lines' room: index.html sizes the phone log border-box, so the added padding stays inside its 110 px
    const cap = parseFloat(cs.maxHeight) - (cs.boxSizing === 'border-box' ? padT + padB + (el.offsetHeight - el.clientHeight) : 0);
    const content = el.scrollHeight - padT - padB - extra0;
    let extra = 0;
    if (cap > 0 && content > cap + 0.5) {
      // layout px per screen px: large text zooms the HUD, and style lengths are in layout px
      const box = el.getBoundingClientRect().height, k = box > 0 ? el.offsetHeight / box : 1;
      const lines = el.children;
      let h = 0;
      for (let i = lines.length - 1; i >= 0; i--) { const lh = lines[i].getBoundingClientRect().height * k; if (h + lh > cap + 0.5) break; h += lh; }
      if (h > 0) extra = Math.max(0, Math.floor((cap - h) * 10) / 10);
    }
    if (Math.abs(extra - extra0) > 0.05) { el.style.paddingBottom = extra ? (padB + extra) + 'px' : ''; el._padExtra = extra; }
    const max = el.scrollHeight - el.clientHeight;
    if (Math.abs(el.scrollTop - max) > 0.5) el.scrollTop = max;
  }
  // v15: the map key and the ship list share the left column (index.html gives the key a grid row of its own).
  // The key folds to its header when the list would otherwise have to scroll, unless the player opened it, in which
  // case the list scrolls; Hide keeps it folded, Show opens it again.
  // On a phone (no ship list) the key sits folded at the top left of the map and opens over it on Show; that choice
  // is not remembered, so every visit starts with the map clear.
  let legendMode = 'auto', legendPhoneOpen = false;
  function legendFit() {
    const lg = $('legend'), fl = $('fleet'), fold = $('legendFold'); if (!lg) return;
    let folded = legendMode === 'folded';
    if (phoneQuery && phoneQuery.matches) folded = !legendPhoneOpen;
    else if (legendMode === 'auto') {
      lg.classList.remove('folded');
      folded = !!(fl && fl.clientHeight > 0 && fl.scrollHeight > fl.clientHeight + 1);
    }
    lg.classList.toggle('folded', folded);
    if (fold) { fold.textContent = folded ? 'Show' : 'Hide'; fold.setAttribute('aria-expanded', String(!folded)); fold.setAttribute('aria-label', folded ? 'Show the map key' : 'Hide the map key'); }
  }

  // ------------------------------------------------------------------ hints & toasts
  let hintQueue = [], hintActive = null, hintAnchorEl = null;
  function showHint(h) {
    if (typeof h === 'string') h = { text: h }; if (!h || !h.text) return;
    // a tour step goes ahead of every plain hint in the queue, so the tour is never displaced by an aside
    if (h.step) { const i = hintQueue.findIndex((x) => !x.step); if (i < 0) hintQueue.push(h); else hintQueue.splice(i, 0, h); }
    else hintQueue.push(h);
    if (!hintActive) nextHint();
  }
  function nextHint() {
    if (hintAnchorEl) { hintAnchorEl.classList.remove('glow'); hintAnchorEl = null; }
    if (OD.Guide) OD.Guide.mark = null;
    hintActive = hintQueue.shift() || null;
    // a queued hint whose moment has passed (its until already holds) is skipped, not shown out of context
    while (hintActive && (!hintActive.text || (hintActive.until && game && game.sim && safeUntil(hintActive, game.sim)))) hintActive = hintQueue.shift() || null;
    const el = $('hint');
    if (!hintActive) { el.hidden = true; return; }
    $('hintText').textContent = hintActive.text;
    $('hintStep').textContent = hintActive.step ? 'Step ' + hintActive.step[0] + ' of ' + hintActive.step[1] : 'Hint';
    $('hintSkip').hidden = !hintActive.step;
    el.classList.toggle('tour', !!hintActive.step);
    // v13: a hint may carry one action, for the phone where the key it would name does not exist
    hintAction(hintActive.action);
    el.hidden = false;
    hintActive._shownAt = game && game.sim ? game.sim.time : 0;
    if (hintActive.anchor) {
      const a = document.getElementById(hintActive.anchor) || document.querySelector(hintActive.anchor);
      if (a) {
        a.classList.add('glow'); hintAnchorEl = a;
        // on a phone the panel scrolls: bring the thing the hint points at into view
        if (window.innerWidth < 900 && a.closest && a.closest('#shipPanel')) { try { a.scrollIntoView({ block: 'nearest' }); } catch (e) { /* cosmetic */ } }
      }
    }
    if (hintActive.mark && OD.Guide) OD.Guide.mark = { shipId: hintActive.mark, label: hintActive.markLabel || 'click' };
    // a new step over an open card folds or unfolds with the room it has (bandLayout)
    bandLayout();
  }
  // The hint's own button, built here so index.html keeps its markup and the page keeps no inline handler.
  let hintActBtn = null;
  function hintAction(act) {
    const host = document.querySelector('#hint .hint-actions');
    if (!host) return;
    if (!hintActBtn) {
      hintActBtn = document.createElement('button');
      hintActBtn.id = 'hintAct'; hintActBtn.className = 'sm'; hintActBtn.type = 'button'; hintActBtn.hidden = true;
      hintActBtn.addEventListener('click', () => { const run = hintActBtn._run; if (typeof run === 'function') { try { run(); } catch (e) { /* the hint stays up */ } } });
      host.insertBefore(hintActBtn, host.firstChild);
    }
    if (!act || !act.label || typeof act.run !== 'function') { hintActBtn.hidden = true; hintActBtn._run = null; return; }
    hintActBtn.textContent = act.label; hintActBtn._run = act.run; hintActBtn.hidden = false;
  }
  function safeUntil(h, sim) { try { return !!h.until(sim); } catch (e) { return false; } }
  function hostileInPlay(sim, ship) { try { return sim.alive().some((s) => s !== ship && !s.destroyed && sim.isHostile(s, ship)); } catch (e) { return true; } }
  const FULL_ROWS = /^(Beams in arc|On target|Through armour|Effects)$/;
  function skipTour() { hintQueue = hintQueue.filter((h) => !h.step); hintActive = null; nextHint(); }
  let toastTimer = null;
  function toast(text, ms = 2600, speaker, tag) {
    const el = $('toast');
    if (speaker) { el.className = 'comms'; el.innerHTML = '<b>' + esc(speaker) + '</b>' + esc(text) + (tag ? '<span class="tag">' + esc(tag) + '</span>' : ''); } else { el.className = ''; el.textContent = text; }
    el.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, ms);
  }

  // ------------------------------------------------------------------ screens
  // v15: every DOM screen but the hull view sits in the bridge console's frame, with the header strip naming it the
  // way bridge.js names its own screens ('Bridge · Chapters'), so moving between the canvas console and a DOM
  // screen keeps one look. opts.head overrides the name; opts.close = { id, label, run } puts a close key (Esc) in
  // the strip for a long screen whose other close key is at the bottom.
  const SCREEN_HEADS = { physics: 'Physics', help: 'How to play', campaign: 'Campaign', campend: 'Campaign', configurator: 'Ship configurator', skirmish: 'Skirmish',
    menu: 'Main console', chapters: 'Chapters', briefing: 'Briefing', situation: 'Situation', hangar: 'Hangar', inspect: 'Hull view', pause: 'Paused', debrief: 'Debrief' };
  function screenKeys(host, opts) {
    const keys = host.querySelector('.scr-keys'); if (!keys) return;
    const add = (label, aria, run, cls) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'sm' + (cls ? ' ' + cls : ''); b.innerHTML = label; if (aria) b.setAttribute('aria-label', aria); b.addEventListener('click', run); keys.appendChild(b); return b; };
    if (opts.close && typeof opts.close.run === 'function') {
      const b = add(esc(opts.close.label || 'Close') + '<kbd>Esc</kbd>', null, opts.close.run, 'scr-close');
      if (opts.close.id) b.id = opts.close.id;
      b.dataset.esc = '';
    }
    // the same two keys the console's header carries: sound and text size
    if (OD.Sound && typeof OD.Sound.setEnabled === 'function') {
      const snd = add('', null, () => { const on = !!(OD.Sound.enabled == null ? true : OD.Sound.enabled); try { OD.Sound.setEnabled(!on); if (!on && OD.Sound.unlock) OD.Sound.unlock(); } catch (e) { /* optional */ } sndLabel(); });
      const sndLabel = () => { const on = !!(OD.Sound.enabled == null ? true : OD.Sound.enabled); snd.textContent = 'SND ' + (on ? '●' : '○'); snd.setAttribute('aria-label', 'Sound ' + (on ? 'on: switch off' : 'off: switch on')); };
      sndLabel();
    }
    const aa = add('AA', null, () => { UI.setTextSize(UI.textSize === 'large' ? 'normal' : 'large', true); aaLabel(); });
    const aaLabel = () => aa.setAttribute('aria-label', 'Text size: ' + (UI.textSize === 'large' ? 'large, switch to normal' : 'normal, switch to large'));
    aaLabel();
  }
  function screen(id, html, opts = {}) {
    const host = $('screens');
    const card = '<div class="card' + (opts.wide ? ' wide' : '') + '">' + html + '</div>';
    if (id === 'hull' || opts.frame === false) host.innerHTML = '<div class="screen" id="' + id + '">' + card + '</div>';
    else {
      const head = opts.head || SCREEN_HEADS[id] || (id.charAt(0).toUpperCase() + id.slice(1));
      host.innerHTML = '<div class="screen framed" id="' + id + '"><div class="scr-frame" aria-hidden="true"><i class="scr-rail"></i></div>' +
        '<div class="scr-head"><span class="scr-mode"><span>Bridge · ' + esc(head) + '</span></span><span class="scr-keys"></span></div>' +
        '<div class="scr-body">' + card + '</div></div>';
      // the header strip already names the screen, so an eyebrow that says the same word again is dropped
      const eb = host.querySelector('.card .eyebrow');
      if (eb && eb.textContent.trim().toLowerCase() === String(head).trim().toLowerCase()) eb.hidden = true;
      screenKeys(host, opts);
    }
    UI.currentScreen = id;
    document.body.classList.add('screen-open');
    document.body.classList.toggle('hull-open', id === 'hull');
    if (id === 'hull') bandLayout();
    return host.firstChild;
  }
  function closeScreen() { $('screens').innerHTML = ''; UI.currentScreen = null; document.body.classList.remove('screen-open'); document.body.classList.remove('hull-open'); }

  // ------------------------------------------------------------------ physics panel
  function physicsHtml(sim, ship) {
    const target = ship && ship.target ? sim.byId(ship.target) : null;
    const boxes = [];
    if (ship) {
      boxes.push({ t: 'The rocket equation', p: 'Delta-v is the total speed change the tanks can buy. It comes from two numbers only: the exhaust velocity vₑ, and the ratio of full mass m₀ to dry mass m₁. The ratio sits inside a logarithm, so doubling a ship\u2019s delta-v costs far more than double the propellant.', f: !hasDrive(ship)
        ? 'Δv = vₑ · ln(m₀/m₁)\nno drive and no propellant: m₀ = m₁ = ' + U.fmt.mass(ship.dryMass) + ', so Δv = 0'
        : 'Δv = vₑ · ln(m₀/m₁)\nvₑ = ' + U.fmt.speed(ship.exhaustVelocity) + '\nm₀ = ' + U.fmt.mass(ship.mass()) + '   m₁ = ' + U.fmt.mass(ship.dryMass) + '\nΔv = ' + U.fmt.dv(ship.deltaV()) + ' now, ' + U.fmt.dv(ship.deltaVFull()) + ' full\nspent this sortie: ' + U.fmt.dv(ship.stats.dvSpent) });
      // the figures are the ones the simulation is using now: a hurt drive scales the thrust, a wrecked one has none
      const a = ship.accelNominal(), tw = thrustWhy(ship), live = tw.live, fac = tw.fac;
      const aLine = live > 0
        ? 'a = F/m = ' + U.fmt.si(ship.thrust, 'N') + (fac < 0.995 ? ' × ' + Math.round(fac * 100) + ' %' + (tw.why ? ' (' + tw.why + ')' : '') : '') + ' / ' + U.fmt.mass(ship.mass()) + ' = ' + U.fmt.accel(live)
        : tw.none + '\nrated a = F/m = ' + U.fmt.si(ship.thrust, 'N') + ' / ' + U.fmt.mass(ship.mass()) + ' = ' + U.fmt.accel(a);
      boxes.push({ t: 'Thrust and acceleration', p: 'Acceleration a is thrust F divided by current mass m. The drive puts out the same force all through a burn, so as propellant burns off the ship accelerates harder. The flip time is how long it takes to swing 180° before a braking burn.', f: !hasDrive(ship)
        // v15: a hull without a drive has no burn to flip for and no tanks to run dry
        ? 'no drive: F = 0, so a = 0 at any mass\nshe holds her orbit'
        : aLine + (ship.propMass > 0 ? '\nwhen dry: ' + U.fmt.accel(ship.thrust / ship.dryMass) : '') + '\nflip 180°: ' + U.fmt.time(OD.Autopilot.flipTimeFor(typeof OD.Autopilot.turnFactor === 'function' ? { angAccel: ship.angAccel * OD.Autopilot.turnFactor(ship), maxAngVel: ship.maxAngVel } : ship)) });
    }
    if (ship && target) {
      const d = U.dist(ship.pos, target.pos), a = liveAccel(ship);
      const b = a > 0 ? P.brachistochrone(d, a) : null;
      if (hasDrive(ship)) boxes.push({ t: 'Brachistochrone transfer', p: 'The quickest transfer a torch drive can fly. Burn toward the target for half the distance, flip, then burn against your motion for the other half. d is the range and a the acceleration. Time and delta-v both grow with the square root of the distance, so a target twice as far costs about 1.4 times as much of each.', f: 'range d = ' + U.fmt.dist(d) + (b ? '\nt = 2·√(d/a) = ' + U.fmt.time(b.time) + '   peak ' + U.fmt.speed(b.peakV) + '\nΔv = 2·√(d·a) = ' + U.fmt.dv(b.dv) + '\n\ncapped at a 1.5 km/s cruise: ' + U.fmt.time(P.transferWithBudget(d, a, 3000).time) + ' and ' + U.fmt.dv(Math.min(3000, b.dv)) + ' of Δv' : '\n' + thrustWhy(ship).none + ', and she cannot fly this transfer'), plot: true });
      const lag = P.lightLag(d);
      boxes.push({ t: 'No stealth in space', p: 'A lit drive throws gigawatts of light and heat at a 3 K sky, so every sensor in the engagement sees it. What changes from ship to ship is how well they see you. Light takes time to cross the range as well. The box below says how far the target has moved since the light you are seeing left it.', f: (hasDrive(ship) ? 'drive plume: ' + U.fmt.power(0.5 * (ship.thrust || 0) * (ship.exhaustVelocity || 0) * ((OD.Sensors && OD.Sensors.T && OD.Sensors.T.plumeFraction) || 0.02)) + ' at full thrust' : 'drive plume: none, she has no drive') + '\nlight lag to target: ' + (lag < 1 ? Math.round(lag * 1000) + ' ms' : lag.toFixed(1) + ' s') + '\ntarget has moved ' + U.fmt.dist(U.len(target.vel) * lag) + ' since that picture' });
      const facet = facetSeen(ship, target);
      boxes.push({ t: 'Facing armour', p: 'Armour is mass, and mass costs delta-v, so it is thickest on the nose that faces the enemy while closing. The tail carries the least and holds the drive. Braking toward an enemy points that tail at them.', f: armourAllRound(ship) ? ship.armour.nose + ' cm on every facet\nthe target sees the same ' + ship.armour.nose + ' cm from any bearing' : 'nose ' + ship.armour.nose + ' cm   flank ' + ship.armour.flank + ' cm   tail ' + ship.armour.tail + ' cm\nthe target currently sees our ' + facet });
    }
    if (ship && OD.Sensors && typeof OD.Sensors.signature === 'function') {
      try {
        const sig = OD.Sensors.signature(ship);
        const sf = typeof OD.Sensors.seenFrom === 'function' ? OD.Sensors.seenFrom(sim, ship) : null;
        // v13: sensors.js measures with the watch factor in it, so S here carries the same number
        const Sh = (ship.sensorRange || 0) * ((ship.systems && ship.systems.sensors) || 1);
        let watch = 1;
        if (OD.Crew && typeof OD.Crew.sensorFactor === 'function') { try { const w = OD.Crew.sensorFactor(ship); if (typeof w === 'number' && isFinite(w) && w > 0) watch = w; } catch (e) { watch = 1; } }
        const S0 = Sh * watch;
        const FF = (e) => Math.pow((OD.Sensors && OD.Sensors.T && OD.Sensors.T.farFactor) || 4, e); // the quality law: q 2.7 sits 4^0.15 beyond the pinned range, q 1.8 at 4^0.6
        boxes.push({ t: 'Being seen', p: 'A sensor picks up the waste heat and the drive plume of a ship against the sky. Signal falls with the square of range, so the range R_sol for a firing solution grows only with the square root of the power P a ship radiates: a hundred times the power buys ten times the range. S is our own sensor range, where it pins a 1 MW hull. An active sensor skips all of this and hands everyone a solution at once.', f: 'R_sol = S · √(P / 1 MW)\nour signature P = ' + U.fmt.power(sig.total) + '  (plume ' + U.fmt.power(sig.plume) + ', radiators ' + U.fmt.power(sig.radiators) + ', hull ' + U.fmt.power(sig.hull) + ')' + (sf && sf.solution > 0 ? '\ntheir best sensor' + (sf.by ? ' (' + sf.by + ')' : '') + ': solution from ' + km(sf.solution) + ', a track from ' + km(sf.track) : '\nno hostile sensor in play') + '\nour sensor S = ' + km(S0) + (Math.abs(watch - 1) > 1e-9 ? ' (' + km(Sh) + ' of hardware, and the sensor watch is at ' + U.fmt.pct(watch) + ')' : '') + ': pinned on a 1 MW hull at ' + km(S0) + ', a firing solution from ' + km(S0 * FF(0.15)) + ', a track from ' + km(S0 * FF(0.6)) + '. On 100 MW of radiators, ten times as far' + (ship.activeRange > 0 ? '\nactive sensor: a solution inside ' + km(ship.activeRange) + ' at once, seen by everyone' : '') });
      } catch (e) { /* the box is optional */ }
    }
    if (ship) {
      const pin = ship.lastHeatIn != null ? ship.lastHeatIn : ship.idleHeat + ship.driveHeat * heatFrac(ship) + (ship.lastExtraHeat || 0);
      const pout = ship.radiatorPower();
      const net = pin - pout;
      const tSat = net > 0 ? (ship.sinkCapacity - ship.heat) / net : Infinity;
      let sinkWord = net > 0 ? ', saturates in ' + U.fmt.time(tSat) : ', draining';
      if (typeof P.sinkForecast === 'function') {
        let f = null; try { f = P.sinkForecast(ship.heat, ship.sinkCapacity, typeof ship.radiatorRating === 'function' ? ship.radiatorRating() : pout, pin, 7200, ship.radiatorTemp); } catch (e) { f = null; }
        if (f) sinkWord = f.tFull != null && isFinite(f.tFull) ? ', full in ' + U.fmt.time(f.tFull) : f.tEmpty != null && isFinite(f.tEmpty) && ship.heat > 0.05 * ship.sinkCapacity ? ', empty in ' + U.fmt.time(f.tEmpty) : f.settle != null && isFinite(f.settle) ? ', settles near ' + Math.round(f.settle * 100) + '%' : '';
      }
      boxes.push({ t: 'Heat has to go somewhere', p: 'There is no air to carry heat away, so everything the reactor and the drive waste goes into a heat sink and only the radiators shed it. A panel radiates by the fourth power of its temperature: below 60 % of the sink the panels run cool and shed little, above it they run at 1000 K and shed their full rating. A is the panel area, ε 0.9 the emissivity and σ the Stefan\u2013Boltzmann constant. The drive is open cycle, so almost all of its waste leaves with the exhaust and only tens of megawatts soak back into the hull, which is why a 16 GW plume shows up as a 30 MW heat load.', f: 'P_rad = 2·A·ε·σ·T⁴ = 2 · ' + ship.radiatorArea + ' m² · 0.9 · 5.67e-8 · (' + ship.radiatorTemp + ' K)⁴\n      = ' + U.fmt.power(P.radiatorPower(ship.radiatorArea, ship.radiatorTemp)) + ' fully extended\nnow: in ' + U.fmt.power(pin) + '   out ' + U.fmt.power(pout) + '\nsink ' + Math.round(ship.thermalLoad() * 100) + '%' + sinkWord });
    }
    if (sim.body && ship) {
      const el = P.orbitalElements(sim.body.mu, ship.pos, ship.vel);
      const r = U.len(ship.pos);
      boxes.push({ t: 'Orbit around ' + sim.body.name, p: 'Everything here is falling around ' + sim.body.name + '. A burn changes the ellipse you coast on, not only your position. Put the periapsis below the surface and the coast ends on the ground.', f: 'altitude ' + U.fmt.dist(r - sim.body.radius) + '   speed ' + U.fmt.speed(U.len(ship.vel)) + '\ncircular here: ' + U.fmt.speed(P.circularVelocity(sim.body.mu, r)) + '   escape: ' + U.fmt.speed(P.escapeVelocity(sim.body.mu, r)) + '\n' + (el.bound ? 'periapsis ' + U.fmt.dist(el.periapsis - sim.body.radius) + '   apoapsis ' + U.fmt.dist(el.apoapsis - sim.body.radius) + '\nperiod ' + U.fmt.time(P.orbitalPeriod(sim.body.mu, el.a)) : 'on an escape trajectory') });
    }
    const R = ship && target ? U.dist(ship.pos, target.pos) : 300e3;
    boxes.push({ t: 'Beams spread with distance', p: 'A laser cannot be focused tighter than diffraction allows. The spot grows with the range R and the wavelength λ, and shrinks with the mirror diameter D. A wider spot spreads the same power over more armour, so it burns through more slowly.', f: 'spot = 2.44 · λ · R / D\n1.0 m mirror, 1064 nm, R = ' + U.fmt.dist(R) + ': spot ' + spotFmt(P.beamSpotDiameter(1064e-9, R, 1.0)) + '\n1.6 m mirror: ' + spotFmt(P.beamSpotDiameter(1064e-9, R, 1.6)) });
    const tf = P.slugFlightTime(R, 4000);
    boxes.push({ t: 'Slugs take time to arrive', p: 'A coilgun slug is unguided, so it is fired at where the target will be. The target has the whole flight time to be somewhere else, and a short sideways burn is enough to move that far. That is what jinking does.', f: 'flight time = R / v = ' + U.fmt.dist(R) + ' / 4 km/s = ' + U.fmt.time(tf) + '\n2 s of 10 m/s² sideways: ' + U.fmt.dist(20 * (tf - 1)) + ' off the aim point\nan interceptor carries 7.8 km/s of its own Δv and closes that gap. A slug cannot.' });
    if (OD.Engagement && OD.Engagement.physicsNotes && ship) {
      for (const n of OD.Engagement.physicsNotes(ship, target) || []) boxes.push({ t: n.title, p: '', f: n.body });
    }
    return boxes.map((b) => '<div class="box' + (b.plot ? ' wide' : '') + '"><h4>' + esc(b.t) + '</h4>' + (b.p ? '<p>' + keepNums(esc(nbPct(b.p))) + '</p>' : '') + '<div class="f">' + keepNums(esc(nbPct(b.f))) + '</div>' + (b.plot ? '<canvas id="physPlot" class="plot" width="640" height="220" aria-label="Transfer time and delta-v against distance"></canvas>' : '') + '</div>').join('');
  }
  // Transfer time and delta-v against distance for this ship: the fast burn-flip-burn and the capped cruise.
  function drawTransferPlot(canvas, ship, range, vmax) {
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = canvas.clientWidth || 640;
    // a narrow screen stacks the two plots instead of squeezing them side by side
    const narrow = W < 560;
    // a right gutter keeps the last distance label on the canvas, and the extra height gives the legend its own strip
    const gut = 44;
    const H = narrow ? 452 : 244;
    canvas.style.height = H + 'px';
    canvas.width = W * dpr; canvas.height = H * dpr;
    const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const a = liveAccel(ship); // 0 with a wrecked drive: the curves stay off and the plot says why
    const cap = vmax || 1500;
    const pane = narrow ? [{ x0: 54, x1: W - gut, y0: 0, y1: 196 }, { x0: 54, x1: W - gut, y0: 204, y1: 400 }] : [{ x0: 54, x1: W / 2 - gut, y0: 0, y1: H - 24 }, { x0: W / 2 + 54, x1: W - gut, y0: 0, y1: H - 24 }];
    const panels = [
      { ...pane[0], title: 'time to arrive', ticks: [[60, '1 min'], [600, '10 min'], [3600, '1 h'], [36000, '10 h']], f: (d) => P.brachistochrone(d, a).time, g: (d) => P.transferWithBudget(d, a, 2 * cap).time, ymin: 60, ymax: 36000 * 3, line: null, lineLabel: '' },
      { ...pane[1], title: 'delta-v needed, km/s', ticks: [[100, '0.1'], [1000, '1'], [10000, '10'], [100000, '100']], f: (d) => P.brachistochrone(d, a).dv, g: (d) => Math.min(2 * cap, P.brachistochrone(d, a).dv), ymin: 100, ymax: 200000, line: ship.deltaV(), lineLabel: 'delta-v you have left' },
    ];
    const dmin = 10e3, dmax = 100e6;
    const lx = (x0, x1, d) => x0 + ((Math.log10(d) - Math.log10(dmin)) / (Math.log10(dmax) - Math.log10(dmin))) * (x1 - x0);
    const ly = (p, v) => p.y1 - 28 - ((Math.log10(U.clamp(v, p.ymin, p.ymax)) - Math.log10(p.ymin)) / (Math.log10(p.ymax) - Math.log10(p.ymin))) * (p.y1 - p.y0 - 48);
    ctx.font = '11px "IBM Plex Mono", ui-monospace, monospace';
    const decades = [10e3, 100e3, 1e6, 10e6, 100e6];
    const labelled = narrow ? [10e3, 1e6, 100e6] : decades;
    for (const p of panels) {
      ctx.strokeStyle = 'rgba(127,142,163,0.25)'; ctx.lineWidth = 1; ctx.fillStyle = 'rgba(169,182,198,0.8)'; ctx.textAlign = 'center';
      for (const d of decades) { const x = lx(p.x0, p.x1, d); ctx.beginPath(); ctx.moveTo(x, p.y0 + 20); ctx.lineTo(x, p.y1 - 28); ctx.stroke(); if (labelled.includes(d)) ctx.fillText(U.fmt.dist(d), x, p.y1 - 12); }
      ctx.textAlign = 'right';
      for (const [v, label] of p.ticks) { const y = ly(p, v); ctx.beginPath(); ctx.moveTo(p.x0, y); ctx.lineTo(p.x1, y); ctx.stroke(); ctx.fillText(label, p.x0 - 4, y + 4); }
      ctx.textAlign = 'left'; ctx.fillStyle = '#d7e0ea'; ctx.font = '600 12px "Rajdhani", sans-serif'; ctx.fillText(p.title.toUpperCase(), p.x0, p.y0 + 12); ctx.font = '11px "IBM Plex Mono", ui-monospace, monospace';
      const curve = (fn, color, dash) => { ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.setLineDash(dash || []); ctx.beginPath(); let first = true; for (let i = 0; i <= 80; i++) { const d = dmin * Math.pow(dmax / dmin, i / 80); const v = fn(d); if (!isFinite(v) || v <= 0) { first = true; continue; } const x = lx(p.x0, p.x1, d), y = ly(p, v); if (first) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y); } ctx.stroke(); ctx.setLineDash([]); };
      if (a > 0) { curve(p.f, '#4fd1c5'); curve(p.g, '#8fa6bf', [5, 4]); }
      const rx = range ? lx(p.x0, p.x1, U.clamp(range, dmin, dmax)) : null;
      if (p.line) {
        const y = ly(p, p.line); ctx.strokeStyle = 'rgba(255,93,93,0.8)'; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(p.x0, y); ctx.lineTo(p.x1, y); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = '#ff9d9d';
        // the caption sits on whichever side the 'now' tick is not
        const right = rx == null || rx < (p.x0 + p.x1) / 2; ctx.textAlign = right ? 'right' : 'left'; ctx.fillText(p.lineLabel, right ? p.x1 - 4 : p.x0 + 4, y - 4); ctx.textAlign = 'left';
      }
      if (rx != null) { ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(rx, p.y0 + 20); ctx.lineTo(rx, p.y1 - 28); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = '#fff'; ctx.textAlign = rx > (p.x0 + p.x1) / 2 ? 'right' : 'left'; ctx.fillText('now', rx + (rx > (p.x0 + p.x1) / 2 ? -4 : 4), p.y0 + 30); ctx.textAlign = 'left'; }
    }
    // legend: one line when there is room, two when there is not
    const legY = narrow ? [H - 26, H - 10] : [H - 10, H - 10];
    const legX = narrow ? [54, 54] : [54, 210];
    ctx.fillStyle = '#4fd1c5'; ctx.fillRect(legX[0], legY[0] - 4, 14, 2); ctx.fillStyle = '#a9b6c6'; ctx.fillText('fast burn-flip-burn', legX[0] + 18, legY[0]);
    ctx.fillStyle = '#8fa6bf'; ctx.fillRect(legX[1], legY[1] - 4, 14, 2); ctx.fillStyle = '#a9b6c6'; ctx.fillText('cruise capped at ' + U.fmt.speed(cap), legX[1] + 18, legY[1]);
    if (!(a > 0)) {
      const tw = thrustWhy(ship), note = (tw.none ? tw.none.charAt(0).toUpperCase() + tw.none.slice(1) : 'No thrust') + '. She cannot fly these transfers.';
      ctx.font = '600 13px "Rajdhani", sans-serif'; ctx.textAlign = 'left';
      const w = ctx.measureText(note).width, nx = pane[0].x0 + 8, ny = (pane[0].y0 + pane[0].y1) / 2;
      ctx.fillStyle = 'rgba(6,10,16,0.92)'; ctx.fillRect(nx - 6, ny - 14, w + 12, 22);
      ctx.fillStyle = '#e8c27a'; ctx.fillText(note, nx, ny + 2);
    }
  }
  function refreshPhysics(sim, ship) {
    const host = $('physBoxes'); if (!host) return;
    host.innerHTML = physicsHtml(sim, ship);
    const target = ship && ship.target ? sim.byId(ship.target) : null;
    if (ship && target) drawTransferPlot($('physPlot'), ship, U.dist(ship.pos, target.pos), ship.order && ship.order.vmax);
  }
  // the physics screen works through a hull whose numbers we have (ours, or a civilian's): with a hostile selected,
  // her delta-v, heat and target are not ours to read, so it shows the first of our ships instead
  function physicsShip(sim) { const s = selected(); return s && !hostilePic(sim, s) ? s : sim.playerShips()[0]; }
  function physics() {
    if (!game.sim) return;
    const ship = physicsShip(game.sim);
    const prevWarp = game.warp; game.setWarp(0);
    const back = () => { closeScreen(); game.setWarp(prevWarp || 1); };
    const el = screen('physics', '<div class="eyebrow">Physics</div><h2 class="title">The numbers behind the ship</h2><p class="sub">' + (ship ? 'For ' + esc(ship.name) + (ship.target && game.sim.byId(ship.target) ? ' and her target ' + esc(game.sim.byId(ship.target).name) : ', with no target set: pick one to fill in the transfer, facing and light-lag cards') : 'No ship selected') + '. These are the values the simulation is using right now.</p><div class="phys" id="physBoxes"></div><div class="actions"><button class="primary" id="physClose">Back to the bridge</button></div>', { wide: true, close: { id: 'physCloseTop', label: 'Close', run: back } });
    refreshPhysics(game.sim, ship);
    el.querySelector('#physClose').addEventListener('click', back);
  }

  function help(back) {
    const close = () => { closeScreen(); if (back) back(); };
    const el = screen('help', '<div class="eyebrow">How to play</div><h2 class="title">How to command a ship</h2>' +
      '<div class="help">' +
      '<section><h4>The idea</h4><p>Nothing in space slows down unless the drive burns to slow it. Every burn spends delta-v you cannot get back, and every burn and every shot puts heat into a sink that only the radiators can shed. You give the orders. The autopilot does the turning and the burning.</p></section>' +
      '<section><h4>Reading the bridge</h4><ul>' +
      '<li>The <b>Navigator</b> line at the top of the ship panel says what the ship is doing now and what it does next: turning, burning, flipping, braking or holding.</li>' +
      '<li>The <b>plotted path</b> on the map is that same plan: bright where the ship burns, dashed where it turns or coasts, blue-grey where it brakes tail-first. The first ring is the flip, the second the arrival.</li>' +
      '<li>The <b>delta-v gauge</b> is your fuel. The hatched part is what the current order will spend, and each order button shows its cost before you press it.</li>' +
      '<li><b>Essentials</b> hides the numbers you do not need yet. <kbd>D</kbd> switches to <b>Full</b>, which adds mass, speed, heading, altitude, the systems bars and the gunnery rows.</li>' +
      '</ul></section>' +
      '<section><h4>Controls</h4><ul>' +
      (window.innerWidth < 900
        ? '<li>Tap one of your ships to command it. Tap another ship to make it the target.</li>' +
          '<li>Orders are in the panel below the map, which scrolls: Intercept, Keep range, Match speed, Hold, Retreat, Manual. A finger held on a hostile keeps range on it; so does Keep range in the panel with her targeted.</li>'
        : '<li>Click one of your ships, or its row on the left, to command it. Click another ship to make it the target. <kbd>Tab</kbd> steps through your ships.</li>' +
          '<li>Right-click a hostile to keep range on it. Right-click a friendly or a civilian to intercept it.</li>' +
          '<li>Orders are in the right panel: Intercept <kbd>I</kbd>, Keep range <kbd>K</kbd>, Match speed <kbd>M</kbd>, Hold <kbd>H</kbd>, Retreat <kbd>R</kbd>, and Manual for a heading and a throttle you set.</li>') +
      '<li><kbd>J</kbd> jinks. <kbd>X</kbd> extends or stows the radiators. <kbd>S</kbd> toggles the active sensor. <kbd>Space</kbd> pauses, and <kbd>1</kbd>–<kbd>4</kbd> set the time warp when no decision is open.</li>' +
      '<li>Fire control: <kbd>W</kbd> weapons free, <kbd>B</kbd> beam mode, <kbd>T</kbd> aim point, <kbd>L</kbd> a salvo of two (shift for four), <kbd>A</kbd> every bay. Your other ships run their own bays and aim once their weapons are free.</li>' +
      '<li>Scroll to zoom and drag to pan. <kbd>F</kbd> follows the selected ship and <kbd>Home</kbd> fits everyone on screen. <kbd>P</kbd> opens the Physics panel, <kbd>V</kbd> the hull view, <kbd>C</kbd> the damage-control board, <kbd>Enter</kbd> clears a hint.</li>' +
      '<li>Damage control: a hit part shows on the board and on the hull at close zoom. Send a party and the part comes back to a jury-rig cap, never full: a wrecked drive to 30 %. The party comes off fire control or the sensor watch. A party cannot work a part that is running: the drive has to be cold and the radiators in. Above 1.2 g the crew straps in and repairs pause. Above 3 g people are injured. The g limit is on the board.</li>' +
      '</ul></section>' +
      '<section><h4>What matters</h4><ul>' +
      '<li><b>Delta-v</b> is the fuel gauge. A fast transfer costs 2·√(d·a), so twice the distance costs about 1.4 times as much. Capping the cruise at 1.5 km/s costs a fraction of that and arrives later.</li>' +
      '<li><b>Heat</b> builds while you burn and fight. The radiators shed it, and they are the easiest part of the ship to hit. Stow them with <kbd>X</kbd> when slugs are on the way and extend them as soon as the shooting stops.</li>' +
      '<li><b>Facing</b>: a corvette carries 20 cm of armour on the nose and 4 cm on the tail. Braking toward an enemy shows them that tail.</li>' +
      '<li><b>Jink</b> makes unguided slugs miss, and each nudge costs delta-v. Beams do not miss. They weaken with range instead.</li>' +
      '<li><b>Boarding</b>: hold within 3 km of a hostile at under 25 m/s relative speed. The party crosses in 90 seconds against a crew the size of yours, longer against a bigger one, and the ship changes hands. A crew more than twice yours throws it back.</li>' +
      '</ul></section>' +
      '<section><h4>Seeing and being seen</h4><ul>' +
      '<li>Nothing hides in space, but a track has a quality. A <b>contact</b> is a bearing and a rough range, drawn as a ? on a line along that bearing. The ship is somewhere between the ticks at its ends. A <b>track</b> adds the class. A <b>solution</b> is good enough to fire on, so the beams and coilguns open up.</li>' +
      '<li>Signal falls with the square of range, so what you radiate sets how far off you are a solution. A cold coasting hull is about 1 MW and stays a contact until close. Hot radiators are tens of megawatts. A lit drive is gigawatts and hands everyone a solution. The <b>Signature</b> line in the panel says which you are.</li>' +
      '<li><b>Active</b> (<kbd>S</kbd>) buys a solution on everything in reach within seconds, and hands one to every ship out there. Staying passive costs you range or time instead.</li>' +
      '<li>When a real choice comes up, a <b>Decision</b> band opens above the log with two or three options, each with its cost in plain words and the navigator\'s pick lit. <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> answer it, and <kbd>Esc</kbd> leaves it for later. A repair, sick-bay or burn question carries a clock: leave it and the ship\'s routine settles it when the clock runs out.</li>' +
      '</ul></section>' +
      '<section><p>Hover any label for the number behind it. Large text and the panel you start in are on the main menu.</p></section></div>' +
      '<div class="actions"><button class="primary" id="helpClose">Close</button></div>', { wide: true, close: { id: 'helpCloseTop', label: 'Close', run: close } });
    el.querySelector('#helpClose').addEventListener('click', close);
  }

  // ------------------------------------------------------------------ v11: signature, tracks and the decision band
  // Everything here reads OD.Sensors / OD.Decisions through typeof checks: without them the rows stay hidden and
  // the band never appears.
  const km = (m) => (!isFinite(m) ? '—' : Math.abs(m) >= 10e3 ? U.fmt.num(Math.round(m / 1e3), 6) + ' km' : U.fmt.dist(m));
  const spotFmt = (m) => (!isFinite(m) ? '—' : m < 1000 ? U.fmt.num(m, 3) + ' m' : U.fmt.dist(m));
  const V11_CSS = [
    '.sigrow{display:grid;grid-template-columns:1fr auto;gap:3px 8px;align-items:center;padding:6px 12px 7px;border-bottom:1px solid var(--line);font-size:13px}',
    '.sigrow .k{color:var(--dim);white-space:nowrap}',
    '.sigrow .v{grid-column:1/-1;font-family:var(--mono);font-size:12px;line-height:1.35;white-space:normal}',
    '.sigrow button.sm{justify-self:end}',
    '.sigrow button.sm.on{border-color:var(--accent);color:var(--accent)}',
    '#decision{position:absolute;left:268px;right:352px;bottom:176px;background:var(--glass-3,rgba(5,9,15,0.97));-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);border-top:1px solid rgba(127,184,255,0.55);border-bottom:1px solid rgba(127,184,255,0.55);border-left:3px solid var(--decide,#7fb8ff);padding:10px 16px 12px;pointer-events:auto;z-index:6}',
    '#decision .dc-head{display:flex;gap:12px;align-items:baseline;flex-wrap:wrap;margin-bottom:3px}',
    '#decision .dc-eyebrow{font-family:var(--display);color:var(--decide,#7fb8ff);letter-spacing:.18em;text-transform:uppercase;font-size:11px;font-weight:600}',
    '#decision .dc-title{font-family:var(--display);font-size:16px;font-weight:600;letter-spacing:.02em}',
    '#decision p{margin:0;font-size:14px;line-height:1.45}',
    '#decision .dc-teach{margin-top:6px;color:var(--ink-2);font-size:13px;border-left:2px solid var(--line-2);padding-left:8px;line-height:1.4}',
    '#decision .dc-opts{display:flex;gap:8px;margin-top:9px;flex-wrap:wrap}',
    '#decision .dc-opt{flex:1 1 170px;text-align:left;padding:7px 10px;border:1px solid var(--line-2);background:rgba(10,16,26,0.92);color:var(--ink);cursor:pointer;font:inherit;text-transform:none;letter-spacing:0;min-height:0}',
    '#decision .dc-opt kbd{margin:0 8px 0 0}',
    '#decision .dc-opt b{font-family:var(--display);font-size:13px;letter-spacing:.04em;font-weight:600}',
    '#decision .dc-opt small{display:block;font-family:var(--mono);font-size:11.5px;color:var(--ink-2);margin-top:3px;white-space:normal;line-height:1.35}',
    '#decision .dc-opt.rec{border-color:var(--decide,#7fb8ff);background:rgba(127,184,255,0.12)}',
    '#decision .dc-opt{align-items:flex-start}',
    '#decision .dc-opt.rec b::after{content:"recommended";display:block;color:var(--decide,#7fb8ff);font-weight:400;letter-spacing:0;font-size:11.5px}',
    '#shipPanel.lost .section:not([data-v="syssec"]):not(.nav),#shipPanel.lost .vitals,#shipPanel.lost #pEng,#shipPanel.lost .facing-row,#shipPanel.lost .gauge-row{display:none}',
    '.facing-row{flex-wrap:wrap}.facing-row .v,.facing-row span:not(.k){white-space:normal;overflow-wrap:anywhere}',
    '#toast{font-family:var(--sans)}',
    '#log:not(.follow){-webkit-mask-image:linear-gradient(to bottom,transparent 0,#000 12px);mask-image:linear-gradient(to bottom,transparent 0,#000 12px)}',
    '@media (max-width:900px){#hint p{max-height:32vh;overflow:auto}}',
    '#decision .dc-opt.later{flex:0 0 auto;color:var(--dim);border-style:dashed;align-self:flex-start}',
    '#decision .dc-opt:hover,#decision .dc-opt:focus-visible{border-color:var(--ink);outline:none}',
    '#decision.new{animation:odDecision .5s ease-out}',
    '@keyframes odDecision{0%{transform:translateY(8px);opacity:0}100%{transform:none;opacity:1}}',
    '@media (prefers-reduced-motion: reduce){#decision.new{animation:none}}',
    'body.decision-open #hint{display:none}',
    // v15: on a laptop a tour step stays up above an open card (bandLayout stacks it there), so the first card in
    // chapter 1 does not hide the step that explains the plot; the phone has room for one band, the card
    '@media (min-width: 901px){body.decision-open #hint.tour{display:grid}}',
    '#decision .dc-why{display:none}',
    '#decision .dc-fade{display:none}',
    // v12: the hull view is a place to stand mid-fight. On a laptop it takes the map's rectangle only, so the
    // fleet list, the ship panel (threats, fire control), the log and the decision band stay live around it; the
    // HUD keeps its opacity and its pointer events, and the band and toasts sit above the sheet.
    // On a phone the sheet covers the HUD, so the HUD stays dimmed there (screen-open) and the band closes the view.
    'body.hull-open #decision{z-index:30}body.hull-open #toast{z-index:31}.hull-title{font-size:32px}.hull-esc{display:none}',
    '@media (min-width: 901px){body.hull-open #hud{opacity:1}body.hull-open #hud *{pointer-events:auto}' +
      'body.hull-open #screens .screen{left:244px;right:328px;top:38px;bottom:176px;padding:8px 12px 8px;overflow-y:auto;display:flex;align-items:stretch;justify-content:stretch}' +
      'body.hull-open #screens .screen{bottom:min(calc(176px + var(--band-h,0px)),calc(100vh - 320px))}body.hull-open #hint{z-index:30}' +
      // beside the hull view the band keeps its lesson behind Why?, as on a phone, so the picture keeps its room
      'body.hull-open #decision .dc-teach{display:none}body.hull-open #decision.why .dc-teach{display:block}body.hull-open #decision .dc-why{display:inline-block}' +
      'body.hull-open #screens .card.wide{width:100%;margin:0;padding:0;display:flex;flex-direction:column;flex:1 1 auto;min-height:0}' +
      'body.hull-open #screens .hull-title{font-size:22px;margin:0}body.hull-open #screens .hull-esc{display:inline}' +
      // v15: the header lines never shrink under the view tabs; the class line runs the full width and stops at two
      // lines (drawHullScreen puts the whole line at the top of the part list when it is cut)
      'body.hull-open #screens .card.wide>.eyebrow,body.hull-open #screens .card.wide>.hull-title,body.hull-open #screens .card.wide>.sub{flex:none}' +
      'body.hull-open #screens .sub{margin:2px 0 0;font-size:12.5px;line-height:1.35;height:auto;max-width:none;max-height:none;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}' +
      'body.hull-open #screens .hullview{flex:1 1 auto;min-height:0;margin-top:8px;grid-template-rows:minmax(0,1fr)}' +
      'body.hull-open #screens .hullview>div:first-child{display:flex;flex-direction:column;min-height:0}' +
      'body.hull-open #screens .hullview .pic{flex:1 1 0;min-height:160px;height:auto}' +
      'body.hull-open #screens #hullLive{flex:0 0 auto}body.hull-open #screens #hullParts{overflow:auto;max-height:4.6em;flex:0 0 auto}body.hull-open #screens #hullParties{flex:0 0 auto}body.hull-open #screens #hullParties>span{overflow:auto;max-height:5.6em}' +
      'body.hull-open #screens .hullview .kv{overflow:auto;min-height:0}body.hull-open #screens .actions{display:none}body.hull-open #toast{top:auto;bottom:calc(176px + var(--band-h,0px) - 3.4em)}}',
    // a short laptop screen with a card open: the part list and the class line give way so the picture keeps 140 px
    '@media (min-width: 901px) and (max-height: 860px){body.hull-open.decision-open #screens #hullParts,body.hull-open.decision-open #screens .sub{display:none}body.hull-open.decision-open #screens .hullview .pic{min-height:140px}}',
    // v15: a short laptop (1280×720) with a card open kept 28 px of map; the lesson goes behind Why?, as on a phone
    '@media (min-width: 901px) and (max-height: 760px){#decision .dc-teach{display:none}#decision.why .dc-teach{display:block}#decision .dc-why{display:inline-block}}',
    '#decision .dc-more{display:none}',
    '@media (max-width: 900px){#decision.more .dc-more{display:block;position:sticky;bottom:0;order:6;text-align:center;font-size:11px;color:var(--ink-2);padding:2px 0 4px;pointer-events:none;background:var(--glass-3,rgba(5,9,15,0.97))}}',
    '#shipPanel .threats .kv .v{white-space:normal;overflow:visible;text-overflow:clip}',
    '@media (max-width: 900px){#decision{position:static;grid-area:hint;margin:0 8px 4px;max-height:56vh;overflow:auto;display:flex;flex-direction:column;padding-bottom:0}#decision .dc-teach{display:none;order:4}#decision.why .dc-teach{display:block}#decision .dc-opts{order:3}#decision .dc-fade{display:block;order:5;position:sticky;bottom:0;flex:0 0 30px;margin-top:-12px;pointer-events:none;background:linear-gradient(rgba(5,9,15,0),var(--glass-3,rgba(5,9,15,0.97)) 70%)}#decision .dc-why{display:inline-block;margin-left:auto;font:inherit;font-size:11.5px;color:var(--ink-2);background:none;border:1px solid var(--line-2);padding:2px 8px;cursor:pointer;min-height:0;text-transform:none;letter-spacing:0;position:relative}body.decision-open #shipPanel{display:none}' +
      // the Why? key stays small beside the title, and its hit area runs 9 px above and below it (40 px for a thumb)
      '#decision .dc-why::after{content:"";position:absolute;left:0;right:0;top:-9px;bottom:-9px}}',
    // v13: the hull view's party strip, always visible, above the scrolling part definitions
    '#hullParties{margin:6px 0 0;padding-left:8px;border-left:2px solid var(--line-2)}',
    '#hullParties>b{display:block;font-family:var(--display);font-size:10.5px;letter-spacing:.18em;text-transform:uppercase;color:var(--dim);font-weight:600;margin-bottom:2px}',
    '#hullParties>span{display:block;font-size:12.5px;line-height:1.4;color:var(--ink);white-space:pre-line;max-height:5.6em;overflow:auto}',
    '#legend .sw.contact{width:22px;height:12px;border:0;background:none} #legend .sw.contact svg{display:block} #legend .sw.seen{border-top:2px dotted var(--blue)}',
    '.fleet-row.fuzzy .bars{visibility:hidden}',
    '.fleet-row.lost .bars{visibility:hidden}',
    '#shipPanel .row{flex-wrap:wrap}',
    '.help section{break-inside:avoid;-webkit-column-break-inside:avoid;page-break-inside:avoid;display:block}',
    '.help section>*:first-child{margin-top:0}',
    '@media (min-width:1000px){#help .help{column-count:2;column-gap:40px;column-fill:balance}#help .help p,#help .help li{max-width:none}#help .help section{margin:0 0 16px}}',
  ].join('\n');
  const LEGEND_V11 = [['contact', 'contact · where it might be'], ['seen', 'a solution on us from here in']];
  // v15: the contact swatch is the map's own mark (render.js drawUncertainty): the '?' diamond on its error bar,
  // a thin line broken round the diamond, a tick across each end and a faint strip as wide as the ticks, in grey
  const SWATCH_SVG = {
    contact: '<svg width="22" height="12" viewBox="0 0 22 12" aria-hidden="true" fill="none" stroke="#9db4cc">' +
      '<rect x="0.75" y="3" width="20.5" height="6" fill="#9db4cc" fill-opacity="0.12" stroke="none"/>' +
      '<path d="M0.75 6H6M16 6H21.25" stroke-opacity="0.5" stroke-width="1"/>' +
      '<path d="M0.75 3V9M21.25 3V9" stroke-opacity="0.8" stroke-width="1.5"/>' +
      '<path d="M11 1.5L15.5 6L11 10.5L6.5 6Z" stroke-width="1.2" stroke-linejoin="round"/>' +
      '<text x="11" y="8.3" font-size="6.5" font-family="IBM Plex Mono, ui-monospace, monospace" font-weight="600" text-anchor="middle" fill="#9db4cc" stroke="none">?</text></svg>',
  };
  function installV11() {
    if (!document.getElementById('odV11css')) { const st = document.createElement('style'); st.id = 'odV11css'; st.textContent = V11_CSS; document.head.appendChild(st); }
    const lg = $('legend');
    if (lg && !lg.querySelector('.sw.contact')) {
      for (const [cls, text] of LEGEND_V11) { const row = document.createElement('div'); row.className = 'lg-row'; row.innerHTML = '<i class="sw ' + cls + '">' + (SWATCH_SVG[cls] || '') + '</i>' + esc(text); lg.appendChild(row); }
    }
    if (!$('decision')) {
      const hint = $('hint');
      const el = document.createElement('div');
      el.id = 'decision'; el.hidden = true; el.setAttribute('role', 'group'); el.setAttribute('aria-live', 'polite'); el.setAttribute('aria-label', 'Decision');
      el.innerHTML = '<div class="dc-head"><span class="dc-eyebrow" id="dcEyebrow">Decision</span><span class="dc-title" id="dcTitle"></span><button class="dc-why" id="dcWhy" type="button" hidden>Why?</button></div><p id="dcText"></p><p class="dc-teach" id="dcTeach" hidden></p><div class="dc-opts" id="dcOpts"></div><div class="dc-fade"></div><div class="dc-more">▾ scroll for the rest</div>';
      el.querySelector('#dcWhy').addEventListener('click', () => { el.classList.toggle('why'); });
      if (hint && hint.parentNode) hint.parentNode.insertBefore(el, hint); else document.body.appendChild(el);
      el.addEventListener('click', (e) => { const b = e.target.closest && e.target.closest('[data-key]'); if (b) decisionKey(b.dataset.key); });
    }
  }
  let taught = null;
  function taughtSet() { if (!taught) { try { taught = new Set(JSON.parse(localStorage.getItem('od.taught') || '[]')); } catch (e) { taught = new Set(); } } return taught; }
  function markTaught(kind) { const t = taughtSet(); if (t.has(kind)) return; t.add(kind); try { localStorage.setItem('od.taught', JSON.stringify(Array.from(t))); } catch (e) { /* per-viewer */ } }
  let dcSim = null, dcSeq = -1, dcId = null, dcTeachId = null, dcLastRefresh = 0, dcHeld = null, dcWarp = 0;
  let bandObs = null;
  // v15 round 3: on a laptop the tour step stands above an open card. When the two would leave under FOLD_CLEAR px
  // of map between the top bar and the step (1366×768, 1280×720), the step folds to its eyebrow line and its keys
  // until the card closes. Every band stacks under the comms banner at the top of the map: while the banner shows
  // and the stack would reach it, the card gives up height and scrolls, so no band covers another.
  const FOLD_CLEAR = 200, BAND_GAP = 8;
  function bandLayout() {
    const el = $('decision'), hint = $('hint');
    if (!el || !hint) return;
    const laptop = !(phoneQuery && phoneQuery.matches), cardUp = !el.hidden;
    const stepUp = laptop && cardUp && !hint.hidden && hint.classList.contains('tour');
    // measured at its natural height and with the step in full, then folded and capped as needed
    if (el.style.maxHeight) { el.style.maxHeight = ''; el.style.overflowY = ''; }
    hint.classList.remove('folded');
    let h = cardUp ? el.offsetHeight : 0;
    hint.style.bottom = cardUp ? (176 + h + BAND_GAP) + 'px' : '';
    if (stepUp) {
      const tb = $('topbar'), tt = $('toast');
      let mapTop = tb ? tb.getBoundingClientRect().bottom : 0;
      // the comms banner at the top of the map covers it too (1280×720 left 63 px)
      if (tt && !tt.hidden) { const r = tt.getBoundingClientRect(); if (r.height > 0 && r.top < window.innerHeight * 0.4) mapTop = Math.max(mapTop, r.bottom); }
      if (hint.getBoundingClientRect().top - mapTop < FOLD_CLEAR) hint.classList.add('folded');
    }
    const toast = $('toast');
    if (laptop && cardUp && toast && !toast.hidden && !document.body.classList.contains('hull-open')) {
      const tr = toast.getBoundingClientRect();
      if (tr.height > 0 && tr.top < window.innerHeight * 0.4) {
        const stackTop = el.getBoundingClientRect().top - (stepUp ? hint.offsetHeight + BAND_GAP : 0);
        const over = tr.bottom + 6 - stackTop;
        if (over > 0) { h = Math.max(120, h - over); el.style.maxHeight = h + 'px'; el.style.overflowY = 'auto'; hint.style.bottom = (176 + h + BAND_GAP) + 'px'; }
      }
    }
    // v12: the hull view ends above the band and the hint (--band-h) and the phone toast sits under the band
    // (--band-bottom)
    const st = document.body.style;
    const hh = hint.hidden ? 0 : hint.offsetHeight;
    st.setProperty('--band-h', ((cardUp ? h + BAND_GAP : 0) + (hh > 0 ? hh + BAND_GAP : 0)) + 'px');
    let bottom = 0;
    if (cardUp) { const r = el.getBoundingClientRect(); const op = el.offsetParent; bottom = r.bottom - (op ? op.getBoundingClientRect().top : 0); }
    st.setProperty('--band-bottom', Math.round(bottom) + 'px');
    if (!bandObs && typeof ResizeObserver === 'function') { bandObs = new ResizeObserver(() => bandLayout()); bandObs.observe(el); bandObs.observe(hint); if (toast) bandObs.observe(toast); }
  }
  function closeBand() {
    const el = $('decision'); if (!el) return;
    el.hidden = true; el.classList.remove('new'); el.classList.remove('why'); document.body.classList.remove('decision-open');
    // the warp the band interrupted comes back, unless the player moved it or the fight is over
    if (dcWarp > 1) { const w = dcWarp; dcWarp = 0; if (game && game.warp === 1 && !(game.sim && game.sim.outcome)) game.setWarp(w); }
    bandLayout();
  }
  function optionHtml(o) {
    return '<button class="dc-opt' + (o.recommended ? ' rec' : '') + '" data-key="' + esc(o.key) + '"><kbd>' + esc(o.key) + '</kbd><b>' + esc(o.label) + '</b><small data-dk="' + esc(o.key) + '" data-t="' + esc(o.detail || '') + '">' + keepNums(esc(nbPct(o.detail || ''))) + '</small></button>';
  }
  // v13: Esc on a repair or a medical card hands the choice to the ship's routine, so the key says so. The
  // deadline decisions.js puts on the card counts down in sim time under it.
  // The cards the ship settles at a deadline: decisions.js exports the list (repair, medical, burn) and flags each
  // card; the local list is the fallback for an older card module.
  const CREW_KINDS = { repair: 1, medical: 1 };
  function crewCard(d) {
    if (!d) return false;
    if (d.crew != null) return !!d.crew;
    const K = OD.Decisions && OD.Decisions.CREW_KINDS;
    if (Array.isArray(K)) return K.indexOf(d.kind) >= 0;
    if (K && typeof K === 'object') return !!K[d.kind];
    return !!CREW_KINDS[d.kind];
  }
  function laterLabel(d) { return crewCard(d) ? 'Let the crew decide' : 'Later'; }
  function deadlineWords(sim, d) {
    const t = d ? d.deadline : null;
    if (!sim || !(typeof t === 'number' && isFinite(t))) return '';
    const left = t - sim.time;
    if (!(left > 0)) return 'the crew settles this now';
    return 'the crew settles this in ' + (left < 60 ? Math.ceil(left) + ' s' : U.fmt.time(left));
  }
  function laterHtml(sim, d) {
    return '<button class="dc-opt later" data-key="esc"><kbd>Esc</kbd><b>' + esc(laterLabel(d)) + '</b><small data-dk="esc">' + esc(deadlineWords(sim, d)) + '</small></button>';
  }
  function renderBand(sim, d, opened) {
    const el = $('decision'); if (!el) return;
    const ship = sim.byId(d.shipId);
    $('dcEyebrow').textContent = 'Decision · ' + (d.kind || '') + (ship && ship.id !== UI.selected ? ' · ' + ship.name + ((coarseQuery && coarseQuery.matches) || window.innerWidth <= 900 ? ' (tap to select)' : ' (click to select)') : '');
    $('dcEyebrow').style.cursor = ship && ship.id !== UI.selected ? 'pointer' : '';
    $('dcEyebrow').onclick = ship && ship.id !== UI.selected ? () => { UI.select(ship.id); } : null;
    setKept($('dcTitle'), d.title);
    setKept($('dcText'), d.text);
    const teach = $('dcTeach');
    // the paragraph stays until the kind has been answered or dismissed once (marked in decisionKey), so a
    // question that opens and closes on its own does not spend the lesson
    if (d.teach && (!taughtSet().has(d.kind) || dcTeachId === d.id)) { setKept(teach, d.teach); teach.hidden = false; dcTeachId = d.id; }
    else teach.hidden = true;
    const why = $('dcWhy'); if (why) why.hidden = teach.hidden;
    $('dcOpts').innerHTML = (d.options || []).map(optionHtml).join('') + laterHtml(sim, d);
    el.hidden = false; document.body.classList.add('decision-open');
    if (opened) { el.classList.remove('new'); void el.offsetWidth; el.classList.add('new'); }
    bandLayout();
  }
  function v11Frame(sim, now) {
    const D = OD.Decisions;
    if (!D || typeof D.current !== 'function' || !$('decision')) return;
    if (dcSim !== sim) { dcSim = sim; dcSeq = -1; dcId = null; dcTeachId = null; closeBand(); }
    const seq = sim.decisionSeq || 0;
    let d = null;
    try { d = D.current(sim); } catch (e) { d = null; }
    const id = d ? d.id : null;
    const openFor = (dd, opened) => {
      dcHeld = null;
      renderBand(sim, dd, opened);
      if (opened) {
        // a question on a phone needs the whole band: the hull view (a full-screen sheet there) closes first
        if (UI.currentScreen === 'hull' && window.innerWidth <= 900) closeScreen();
        if (game.warp > 1) { dcWarp = game.warp; game.setWarp(1); }
        try { if (OD.Sound && OD.Sound.play) OD.Sound.play('open'); } catch (e) { /* optional */ }
      }
    };
    if (seq !== dcSeq || id !== dcId) {
      dcSeq = seq;
      const opened = !!d && id !== dcId;
      dcId = id;
      if (!d) { dcHeld = null; closeBand(); return; }
      // another ship's question opens as the band too (worded in the third person by the decision layer, her
      // name in the eyebrow, the digits answer it); a toast says whose it is
      const ship = sim.byId(d.shipId);
      if (opened && ship && UI.selected && ship.id !== UI.selected) decisionToast(sim, d, '', 4000);
      openFor(d, opened);
      dcLastRefresh = now;
    } else if (d && now - dcLastRefresh > 1000) {
      dcLastRefresh = now;
      try { if (typeof D.refresh === 'function') D.refresh(sim, d); } catch (e) { /* details keep their last text */ }
      for (const o of d.options || []) { const s = document.querySelector('#dcOpts small[data-dk="' + o.key + '"]'); if (s && s.dataset.t !== (o.detail || '')) { s.dataset.t = o.detail || ''; s.innerHTML = keepNums(esc(nbPct(o.detail || ''))); } }
      // the deadline runs on the sim clock, so it counts down through a time warp as the fight does
      const dl = document.querySelector('#dcOpts small[data-dk="esc"]');
      if (dl) { const w = deadlineWords(sim, d); if (dl.textContent !== w) dl.textContent = w; }
      // the title and the sentence carry numbers too (hull left, seconds out): they follow the fight as the details do
      const tt = $('dcTitle'), tx = $('dcText');
      if (tt && d.title) setKept(tt, d.title);
      if (tx && d.text) setKept(tx, d.text);
      const te = $('dcTeach');
      if (te && !te.hidden && d.teach) setKept(te, d.teach);
    }
    // on a phone the band scrolls: say so while there is more below the fold
    if (d) { const el = $('decision'); if (el && !el.hidden) el.classList.toggle('more', el.scrollHeight - el.scrollTop - el.clientHeight > 8); }
  }
  // '1' | '2' | '3' | 'esc' → true when a decision took the key
  function decisionKey(key) {
    const D = OD.Decisions, sim = game && game.sim;
    if (!D || !sim || !dcId || $('decision').hidden) return false;
    const d = (sim.decisions || []).find((x) => x.id === dcId);
    if (!d) { closeBand(); dcId = null; return false; }
    if (key === 'esc') { try { if (typeof D.dismiss === 'function') D.dismiss(sim, d.id); } catch (e) { /* closes anyway */ } markTaught(d.kind); closeBand(); dcId = null; return true; }
    const o = (d.options || []).find((x) => x.key === key);
    if (!o) return false;
    try { D.choose(sim, d.id, key); } catch (e) { toast('That option is no longer available.', 2000); closeBand(); dcId = null; return true; }
    if (sim.flags) sim.flags.decisionAnswered = true;
    markTaught(d.kind); closeBand(); dcId = null;
    decisionToast(sim, d, ' → ' + o.label, 2600);
    try { if (OD.Sound && OD.Sound.play) OD.Sound.play('confirm'); } catch (e) { /* optional */ }
    return true;
  }
  // v15: a card's line in the top banner is said the way every other line there is: the ship as the speaker, the
  // title as the words, and the ships a fleet card speaks for as a tag ('JCS BASTION  Pick the range.  3 SHIPS').
  function decisionToast(sim, d, extra, ms) {
    const ship = sim && d ? sim.byId(d.shipId) : null;
    let t = String((d && d.title) || ''), tag = '';
    const m = / · (\d+ ships)$/.exec(t); if (m) { tag = m[1]; t = t.slice(0, m.index); if (!/[.?!]$/.test(t)) t += '.'; }
    if (ship && ship.name && t.indexOf(ship.name + ': ') === 0) t = t.slice(ship.name.length + 2);
    t = t.charAt(0).toUpperCase() + t.slice(1);
    toast(t + (extra || ''), ms, ship ? ship.name : 'Decision', tag);
  }
  // S: the active sensor on the selected ship
  function toggleActive(ship) {
    const S = OD.Sensors; ship = ship || selected();
    if (!S || typeof S.setActive !== 'function' || !ship || ship.faction !== game.sim.playerFaction) return false;
    if (!(ship.activeRange > 0)) { toast(ship.name + ' has no active sensor.', 2000); return true; }
    const on = !(typeof S.isActive === 'function' ? S.isActive(ship) : ship.activeSensor);
    S.setActive(ship, on);
    toast(on ? ship.name + ': active sensor on. A firing solution on everything inside ' + km(ship.activeRange) + ' within seconds, and everyone out there now has one on us.' : ship.name + ': active sensor off. Passive again.', 3500);
    return true;
  }
  function trackOf(sim, ship, target) { const S = OD.Sensors; if (!S || typeof S.track !== 'function' || !target) return null; try { return S.track(sim, ship.faction, target); } catch (e) { return null; } }
  function sigText(sim, ship) {
    const S = OD.Sensors;
    let sig = null, sf = null;
    try { sig = S.signature(ship); } catch (e) { sig = null; }
    try { sf = typeof S.seenFrom === 'function' ? S.seenFrom(sim, ship) : null; } catch (e) { sf = null; }
    if (!sig) return null;
    const word = sig.word || 'cold';
    const cap = word.charAt(0).toUpperCase() + word.slice(1);
    // a hostile's panel: what she radiates, which is what we read off her; the lines below speak for our side
    if (sim.playerFaction && ship.faction !== sim.playerFaction) return { text: (sig.active ? 'Active' : cap) + ' · ' + U.fmt.power(sig.total), cls: '', sig, sf };
    const any = sim.ships.some((h) => !h.destroyed && sim.isHostile(h, ship));
    let text, cls = '';
    if (sig.active) { text = 'Active: a firing solution for everyone in reach'; cls = 'crit'; }
    else if (word === 'burning') { text = 'Burning: every sensor out here has a solution on us'; cls = 'crit'; }
    else if (!any || !sf || !(sf.solution > 0)) { text = cap + ' · ' + U.fmt.power(sig.total) + (any ? '' : ' · no hostile sensor in play'); cls = word === 'radiating' ? 'warn' : 'good'; }
    else if (word === 'radiating') { text = 'Radiating: a solution on us from ' + km(sf.solution); cls = 'warn'; }
    else { text = cap + ': a track on us from ' + km(sf.track > sf.solution ? sf.track : sf.solution) + ', a solution from ' + km(sf.solution); cls = 'good'; }
    return { text, cls, sig, sf };
  }

  // ------------------------------------------------------------------ init & refresh
  function pref(key, def) { try { return localStorage.getItem(key) || def; } catch (e) { return def; } }
  function init(g) {
    game = g;
    UI.detail = pref('od.detail', 'essentials');
    UI.setTextSize(pref('od.text', 'normal'));
    document.addEventListener('mouseover', (e) => { const t = e.target.closest && e.target.closest('[data-tip]'); if (t) showTip(t.dataset.tip, e.clientX, e.clientY); else if (tipKey) { $('tooltip').hidden = true; tipKey = null; } });
    document.addEventListener('mousemove', (e) => { if (tipKey) { tipPos = { x: e.clientX, y: e.clientY }; placeTip(e.clientX, e.clientY); } });
    document.addEventListener('mouseout', (e) => { if (e.target.closest && e.target.closest('[data-tip]') && !(e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('[data-tip]'))) { $('tooltip').hidden = true; tipKey = null; } });
    document.addEventListener('focusin', (e) => { const t = e.target.closest && e.target.closest('[data-tip]'); if (t) { const r = t.getBoundingClientRect(); showTip(t.dataset.tip, r.left, r.bottom); } });
    document.addEventListener('focusout', () => { if (tipKey) { $('tooltip').hidden = true; tipKey = null; } });
    $('warp').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => game.setWarp(+b.dataset.warp)));
    $('btnFit').addEventListener('click', () => game.fitAll());
    $('btnPhysics').addEventListener('click', () => physics());
    $('btnHull').addEventListener('click', () => hullView());
    $('btnHelp').addEventListener('click', () => { const w = game.warp; game.setWarp(0); help(() => game.setWarp(w || 1)); });
    $('btnMenu').addEventListener('click', () => game.pauseMenu());
    $('hintOk').addEventListener('click', () => nextHint());
    $('hintSkip').addEventListener('click', () => skipTour());
    $('btnSkip').addEventListener('click', () => { game.setWarp(64); toast('Running at 64×. Time drops back to 1× just before the next event.'); });
    installV8(); v8Keys(); installV11();
    const lg = $('legend'), fold = $('legendFold');
    if (lg && fold) {
      // 'off' (the key hidden before v15) now folds it to its header, so it can always come back
      const p = pref('od.legend', '');
      legendMode = p === 'off' ? 'folded' : p === 'open' ? 'open' : 'auto';
      fold.addEventListener('click', () => {
        if (phoneQuery && phoneQuery.matches) { legendPhoneOpen = lg.classList.contains('folded'); legendFit(); return; }
        legendMode = lg.classList.contains('folded') ? 'open' : 'folded';
        try { localStorage.setItem('od.legend', legendMode === 'folded' ? 'off' : 'open'); } catch (e) { /* per-viewer */ }
        legendFit();
      });
      window.addEventListener('resize', () => legendFit());
      legendFit();
    }
    window.addEventListener('resize', () => { logFit(true); bandLayout(); });
    const logEl = $('log'); if (logEl) logEl.addEventListener('scroll', () => logFit(), { passive: true });
    // Touch: a tap on anything with a tooltip opens it; a tap elsewhere closes it.
    const noHover = window.matchMedia && window.matchMedia('(hover: none)').matches;
    if (noHover) document.addEventListener('click', (e) => { const t = e.target.closest && e.target.closest('[data-tip]'); if (t && tipKey !== t.dataset.tip) showTip(t.dataset.tip, e.clientX, e.clientY); else if (tipKey) { $('tooltip').hidden = true; tipKey = null; } });
  }

  function setWarp(w) {
    $('warp').querySelectorAll('button').forEach((b) => { b.classList.toggle('active', +b.dataset.warp === w); b.setAttribute('aria-pressed', String(+b.dataset.warp === w)); });
    const l = $('warpLabel'); l.textContent = w === 0 ? 'paused' : w + '× time'; l.className = 'pill ' + (w === 0 ? 'warn' : '');
  }

  // ---- v8 per-frame wiring: sound cues and ambient level, warp drop and a toast on every new launch at our ships ----
  let v8Seq = 0, v8Sim = null, v8LastToast = -1e9, v8Salvo = null;
  // v15: several hulls launching at one of ours in the same moment raised one 'incoming' event each, and the banner
  // showed only the last ('3 interceptors inbound' while the map read 32). The banner now adds up every salvo at each
  // of our ships launched within its 6 s window and says the total, the number of launching ships and the shortest
  // time out. The count and the time are read back from the event's own words (engagement.js salvo line).
  const INBOUND_RE = /^(\d+) interceptors? inbound on .*?(?:, ((?:\d+h )?(?:\d+m )?\d+s) out)?\.$/;
  function secsOf(t) { const m = /^(?:(\d+)h )?(?:(\d+)m )?(\d+)s$/.exec(t || ''); return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3]) : Infinity; }
  function salvoText(sim, byShip) {
    const list = Array.from(byShip.entries()).map(([id, k]) => Object.assign({ ship: sim.byId(id) }, k)).filter((k) => k.ship && k.n > 0).sort((a, b) => b.n - a.n);
    if (!list.length) return '';
    const darts = (n) => n + (n === 1 ? ' interceptor' : ' interceptors');
    const first = list.reduce((m, k) => (k.eta < m.eta ? k : m), list[0]);
    const top = list[0], one = list.length === 1 && top.from.size <= 1;
    const out = isFinite(first.eta) ? (one ? ', ' : ', the first ') + first.etaText + ' out.' : '.';
    if (list.length === 1) return darts(top.n) + ' inbound on ' + top.ship.name + (top.from.size > 1 ? ' from ' + top.from.size + ' ships' : '') + out;
    const rest = list.slice(1), restN = rest.reduce((a, k) => a + k.n, 0);
    return darts(top.n) + ' inbound on ' + top.ship.name + ' and ' + restN + (rest.length === 1 ? ' on ' + rest[0].ship.name : ' on ' + rest.length + ' other ships') + out;
  }
  function v8Frame(sim, now) {
    if (v8Sim !== sim) { v8Sim = sim; v8Seq = (sim.eng && sim.eng.eventSeq) || 0; v8LastToast = -1e9; v8Salvo = null; }
    if (OD.Sound) {
      try {
        if (OD.Sound.watch) OD.Sound.watch(sim);
        if (OD.Sound.ambient) { const s = selected(); OD.Sound.ambient(s && s.thermalLoad ? U.clamp(s.thermalLoad(), 0, 1) : 0.1); }
      } catch (e) { /* sound is optional */ }
    }
    const eng = sim.eng; if (!eng || !Array.isArray(eng.events) || eng.eventSeq == null) return;
    if (eng.eventSeq <= v8Seq) return;
    const n = Math.min(eng.eventSeq - v8Seq, eng.events.length);
    const fresh = eng.events.slice(eng.events.length - n);
    v8Seq = eng.eventSeq;
    let alert = null, inbound = 0;
    for (const ev of fresh) {
      const ship = ev.shipId ? sim.byId(ev.shipId) : null;
      const from = ev.fromId ? sim.byId(ev.fromId) : null;
      const atOurs = ev.kind === 'incoming' && ship && ship.faction === sim.playerFaction;
      const hostileLaunch = ev.kind === 'launch' && ((from && from.faction !== sim.playerFaction) || (ship && ship.faction !== sim.playerFaction && !from));
      if (atOurs || hostileLaunch) alert = ev;
      const m = atOurs ? INBOUND_RE.exec(ev.text || '') : null;
      if (m) {
        if (!v8Salvo || now - v8Salvo.at > 6000) v8Salvo = { at: now, byShip: new Map() };
        const k = v8Salvo.byShip.get(ship.id) || { n: 0, eta: Infinity, etaText: '', from: new Set() };
        k.n += +m[1]; inbound += +m[1];
        const eta = secsOf(m[2]); if (eta < k.eta) { k.eta = eta; k.etaText = m[2]; }
        if (ev.fromId) k.from.add(ev.fromId);
        v8Salvo.byShip.set(ship.id, k);
      }
    }
    if (!alert) return;
    if (game.warp > 1) { if (game.pullWarp) game.pullWarp(1); else game.setWarp(1); }
    // a salvo at one of ours updates the banner in its window with the running total; anything else waits 6 s
    const total = inbound ? salvoText(sim, v8Salvo.byShip) : '';
    if (total) { v8LastToast = now; toast(total, 4500); }
    else if (now - v8LastToast > 6000) { v8LastToast = now; toast(alert.text || 'Incoming.', 4500); }
  }
  function v8Keys() {
    const unlock = () => { try { if (OD.Sound && OD.Sound.unlock) OD.Sound.unlock(); } catch (e) { /* optional */ } };
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', (e) => {
      unlock();
      if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
      if ((UI.currentScreen && UI.currentScreen !== 'hull') || !game || !game.sim || !game.running) return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (OD.Bridge && OD.Bridge.active) return;
      if (/^[wbtla]$/i.test(e.key) && engKey(e.key, e.shiftKey)) e.preventDefault();
    });
  }

  function refresh(sim, now) {
    if (!sim) return;
    try { v8Frame(sim, now); } catch (e) { /* never let the extras break the HUD */ }
    try { v11Frame(sim, now); } catch (e) { /* the band is optional */ }
    $('clock').textContent = U.fmt.clock(sim.time);
    try { const ls = selected(); const sp = $('shipPanel'); if (sp) sp.classList.toggle('lost', !!(ls && (ls.destroyed || ls.captured))); } catch (e) { /* cosmetic */ }
    if (sim.log.length !== logCount) { for (let i = logCount; i < sim.log.length; i++) appendLog(sim.log[i]); logCount = sim.log.length; logFit(); }
    while (sim.hints.length) showHint(sim.hints.shift());
    if (hintActive && hintActive.until && hintActive.until(sim)) nextHint();
    // a plain hint does not hold the band for ever while others wait behind it: ninety seconds, then the next
    else if (hintActive && !hintActive.step && hintQueue.length && hintActive._shownAt != null && sim.time - hintActive._shownAt > 90) nextHint();
    // a hint that quotes a live number keeps it current
    else if (hintActive && typeof hintActive.refresh === 'function') { let t = null; try { t = hintActive.refresh(sim); } catch (e) { t = null; } const el = $('hintText'); if (t && el && el.textContent !== t) { el.textContent = t; hintActive.text = t; } }
    if (UI.currentScreen === 'hull') drawHullScreen(sim, now);
    if (now - lastRefresh < 120) return;
    lastRefresh = now;
    buildFleet(sim); updateFleet(sim);
    updatePanel(selected());
    const nx = $('next');
    if (nx) {
      const ev = UI.nextEvent(sim, selected());
      const txt = ev ? ev.name + ' in ' + U.fmt.time(ev.t) : '';
      if (nx.textContent !== txt) nx.textContent = txt;
      $('btnSkip').hidden = !ev || ev.t < 20;
    }
    updateObjectives(sim);
    if (UI.currentScreen === 'physics' && $('physBoxes') && now - lastPhysRefresh > 600) { lastPhysRefresh = now; refreshPhysics(sim, physicsShip(sim)); }
    if (tipKey && typeof TIPS[tipKey] === 'function') tipRefresh();
  }

  // The next thing the selected ship's plan does: {name, t (seconds from now)} or null.
  function nextEvent(sim, ship) {
    if (!ship || !OD.Guide) return null;
    // a hostile's flip and arrival are her orders, which our sensors do not give
    if (hostilePic(sim, ship)) return null;
    const p = OD.Guide.plan(sim, ship);
    if (!p.active) return null;
    const list = [['flip', p.flip], ['braking', p.brake], ['arrival', p.arrive], ['impact', p.crash]].map(([n, e]) => [n, OD.Guide.eta(sim, p, e)]).filter((x) => x[1] != null && x[1] > 1.5).sort((a, b) => a[1] - b[1]);
    if (p.turnFirst > 0 && sim.time - p.t0 < p.turnFirst && Math.abs(U.angleDiff(ship.cmdHeading, ship.heading)) > 0.05) list.unshift(['turn done', p.turnFirst - (sim.time - p.t0)]);
    return list.length ? { name: list[0][0], t: list[0][1] } : null;
  }

  const UI = { damageBoard,
    TIPS, init, refresh, setWarp, screen, closeScreen, physics, help, toast, showHint, resetLog, drawTransferPlot, nextEvent, hullView, hullKey, drawHull, engKey, decisionKey, toggleActive,
    selected: null, currentScreen: null, detail: 'essentials',
    select(id) { UI.selected = id; if (id && game.sim) { const s = game.sim.byId(id); if (s) updatePanel(s); } else updatePanel(null); },
    setDetail(v, persist) { UI.detail = v === 'full' ? 'full' : 'essentials'; $('shipPanel').dataset.detail = UI.detail; if (persist) { try { localStorage.setItem('od.detail', UI.detail); } catch (e) { /* per-viewer */ } } const s = selected(); if (s) updatePanel(s); },
    setTextSize(v, persist) { UI.textSize = v === 'large' ? 'large' : 'normal'; document.documentElement.dataset.text = UI.textSize; if (persist) { try { localStorage.setItem('od.text', UI.textSize); } catch (e) { /* per-viewer */ } } if (game) { legendFit(); logFit(true); } },
    reset() { panelShip = null; fleetKey = ''; bound = {}; hintQueue = []; hintActive = null; $('hint').hidden = true; closeBand(); dcId = null; dcSim = null; if (hintAnchorEl) { hintAnchorEl.classList.remove('glow'); hintAnchorEl = null; } if (OD.Guide) OD.Guide.mark = null; UI.selected = null; $('shipPanel').innerHTML = '<div class="empty">Click one of your ships to take command, or pick it from the fleet list.</div>'; $('fleetList').innerHTML = ''; $('objList').innerHTML = ''; },
    showHud(v) { $('hud').hidden = !v; if (v) legendFit(); },
    setTitle(mode, name) { $('modeLabel').textContent = mode; $('missionName').textContent = name; },
  };
  OD.UI = UI;
})();
