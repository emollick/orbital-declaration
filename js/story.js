/* Orbital Declaration — story mode. Eight chapters, 2211, the Jovian system. */
(function () {
  'use strict';
  const OD = window.OD;
  const U = OD.U, P = OD.P;
  const B = P.bodies;
  const km = (v) => v * 1000;

  const say = (speaker, text) => ({ speaker, text, kind: 'comms' });
  const logAt = (time, speaker, text) => ({ when: { time }, actions: [{ log: { speaker, text } }] });
  const hintAt = (when, id, text, anchor, until) => ({ when, actions: [{ hint: { id, text, anchor, until } }] });
  // A hint whose text carries a number only the running sim knows: make(sim) returns the hint object, or null.
  const hintFrom = (when, make) => ({ when, actions: [{ fn: (sim) => { const h = make(sim); if (h) sim.hint(h); } }] });
  // A range as a hint should say it: rounded to the nearest 10 km, in the panel's own format.
  const kmAbout = (m) => U.fmt.dist(Math.round(m / 10000) * 10000);
  // v8 helpers: conditions on the engagement module, all guarded so a chapter runs without it.
  const E = () => OD.Engagement;
  const playerShips = (sim) => sim.ships.filter((x) => x.faction === sim.playerFaction && !x.destroyed && x.role !== 'station');
  const inbound = (sim, kind) => { const e = E(); if (!e || !e.threats) return false; try { return (e.threats(sim) || []).some((t) => t.kind === kind && (sim.byId(t.targetId) || {}).faction === sim.playerFaction); } catch (err) { return false; } };
  const hasAction = (sim, id) => { const e = E(); if (!e || !e.panelActions) return false; return playerShips(sim).some((x) => { try { return (e.panelActions(x) || []).some((a) => a.id === id); } catch (err) { return false; } }); };
  // v11 helpers: the sensor picture, guarded so a chapter runs without the module.
  const trackQ = (sim, id) => { const S = OD.Sensors, t = sim.byId(id); if (!S || !t || t.destroyed) return 3; try { return S.quality(sim, { faction: sim.playerFaction }, t); } catch (e) { return 3; } };
  const seenQ = (sim, ownId) => { const S = OD.Sensors, me = sim.byId(ownId); if (!S || !me || me.destroyed) return 3; let best = 0; for (const h of sim.hostiles(me)) { try { best = Math.max(best, S.quality(sim, h, me)); } catch (e) { /* ignore */ } } return best; };
  const hasDecision = (sim, kind) => Array.isArray(sim.decisions) && sim.decisions.some((d) => !kind || d.kind === kind);
  const hostileRadiatorsOut = (sim, within) => sim.ships.some((h) => h.faction !== sim.playerFaction && !h.destroyed && h.radiators && h.radiators.state > 0.9 && playerShips(sim).some((p) => U.dist(p.pos, h.pos) < within));
  // The range from which the best hostile sensor could hold a firing solution on this hull with its drive dark.
  // Solution range goes as the square root of the signature, so the plume comes out of the number the same way
  // the radiators card takes the panels out of it.
  const coldSolutionRange = (sim, id) => {
    const S = OD.Sensors, s = sim.byId(id);
    if (!S || !s) return 0;
    try {
      const seen = S.seenFrom(sim, s), sig = S.signature(s);
      if (!(seen.solution > 0) || !(sig.total > 0)) return 0;
      return seen.solution * Math.sqrt(Math.max(1, sig.total - (sig.plume || 0)) / sig.total);
    } catch (e) { return 0; }
  };
  // Chapter 2: Sabre flown by hand, on Larkspur, at her own doctrine range.
  const sabreOnLarkspur = (sim, t) => {
    t.target = 'larkspur'; t.weaponsFree = true;
    if (!t.order || t.order.type !== 'keeprange' || t.order.target !== 'larkspur') {
      t.order = { type: 'keeprange', target: 'larkspur', range: ((OD.Ships.CLASSES[t.cls] || {}).doctrine || {}).range || km(250) };
    }
  };
  // Chapter 2 is lost two ways, and the debrief has to say which one happened: a freighter gone, or Larkspur
  // out of the fight with the convoy still flying. Reads the fight the debrief is about, so a loss with both
  // haulers alive never prints "The freighters were lost."
  const ch2Loss = () => {
    const sim = OD.Game && OD.Game.sim;
    if (!sim || sim.name !== 'Picket Line' || typeof sim.byId !== 'function') return 'convoy';
    const failed = (sim.objectives || []).find((o) => o.failed && !o.optional);
    if (failed && (failed.id === 'p1' || failed.id === 'p2')) return 'convoy';
    const gone = (id) => { const s = sim.byId(id); return !!(s && (s.destroyed || s.captured || s.disabled)); };
    if (gone('hauler1') || gone('hauler2')) return 'convoy';
    if (gone('larkspur')) return 'larkspur';
    return 'convoy';
  };
  const CH2_DEFEAT = {
    convoy: 'The freighters were lost. The Authority has its incident, and the inner planets will be told the Compact shot first.',
    larkspur: 'Larkspur is out of the fight over Ganymede. Ochre Sky and Pale Harbour are running for Galileo Regio with no escort.',
  };
  // ------------------------------------------------------------ how a fight ended (the debriefs)
  // A debrief is read over the fight it is about, so every sentence that says what happened to a hull
  // reads that hull. main.js takes chapter.victory or chapter.defeat at the moment the chapter ends,
  // so those are getters. A hostile now leaves a fight four ways — boarded, wrecked, adrift, or driven
  // off under sim.js's drivenOffStep — and a driven-off hull is still flying, so she is never called
  // adrift or destroyed. With no sim to read the getters fall back to the plain line.
  const endSim = (name) => {
    const sim = OD.Game && OD.Game.sim;
    return sim && typeof sim.byId === 'function' && (!name || sim.name === name) ? sim : null;
  };
  const pctOf = (v) => Math.round(U.clamp(v == null ? 1 : v, 0, 1) * 100) + ' %';
  const isOut = (s) => !!(s && (s.destroyed || s.captured || s.disabled));                  // out of the fight on her hull
  const isDone = (s) => !!(s && (s.destroyed || s.captured || s.disabled || s.drivenOff));  // out of this fight, either way
  // Our hulls that can still fight. An empty list is how a chapter is lost with the thing we were
  // guarding still in one piece.
  const ableShips = (sim) => (sim ? playerShips(sim).filter((s) => !s.disabled && !s.captured).length : 1);
  // Interceptors still in the bays, counted off the mounts so the line works without the engagement module.
  const baysLeft = (s) => { let n = 0; for (const m of (s && s.mounts) || []) if (m.kind === 'launcher') n += Math.max(0, m.count || 0); return n; };
  // Her range from the nearest of our fighting hulls, in the format a hint uses.
  const rangeFromUs = (sim, s) => { let best = 0; for (const p of playerShips(sim)) { const d = U.dist(p.pos, s.pos); if (!best || d < best) best = d; } return best ? kmAbout(best) : ''; };
  // What put her out of the fight, in the words engagement.js disables a hull with: a wrecked drive, or
  // a hull too far open to manoeuvre with.
  const adriftWhy = (s) => ((s.systems && s.systems.drive <= 0) ? 'with her drive wrecked.' : 'at ' + pctOf(s.hull) + ' hull integrity.');
  // Why her computer broke off, in the words sim.js logs the drive-off with.
  const brokeOffWhy = (s) => (s.hull < 0.35 ? 'with her hull at ' + pctOf(s.hull)
    : (s.systems && s.systems.drive < 0.3) ? 'with her drive at ' + pctOf(s.systems.drive)
    : 'with her tanks near dry');
  // One sentence for how a hostile ended, with the number that says it.
  const endedAs = (sim, id, name) => {
    const s = sim && sim.byId(id);
    if (!s) return name + ' is out of the fight.';
    if (s.captured) return name + ' was boarded and taken.';
    if (s.destroyed) return name + ' came apart. Her hull went to 0 %.';
    if (s.disabled) return name + ' is out of the fight and adrift ' + adriftWhy(s);
    if (s.drivenOff) {
      const R = rangeFromUs(sim, s);
      return name + ' broke off ' + brokeOffWhy(s) + ' and ran. ' +
        (R ? 'She is ' + R + ' out and still opening.' : 'She is past 1 500 km and still opening.') +
        ' She is out of this fight.';
    }
    return name + ' is still flying.';
  };
  // The same in four words, for a line that covers more than one hull.
  const endedShort = (sim, id, name) => {
    const s = sim && sim.byId(id);
    if (!s) return name + ' is out of the fight';
    if (s.captured) return name + ' was taken';
    if (s.destroyed) return name + ' came apart';
    if (s.disabled) return name + ' is adrift';
    if (s.drivenOff) return name + ' broke off and ran';
    return name + ' is still flying';
  };
  // One of ours, in the same terms, for the debriefs that say what a ship of ours came home as.
  const ourEnd = (s, name) => {
    if (!s) return name + ' is out of the fight.';
    if (s.destroyed) return name + ' was lost.';
    if (s.captured) return name + ' was boarded and taken.';
    if (s.disabled) return name + ' is out of the fight and adrift ' + adriftWhy(s);
    if (s.hull < 0.995) return name + ' is at ' + pctOf(s.hull) + ' hull integrity and still flying.';
    return 'Nothing got through ' + name + '\'s armour.';
  };
  const COUNT = ['none', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight'];
  // The range at which her beams burn through the facet of ours she is looking at, from the same ladder the map draws.
  const theirBurnThrough = (sim, ownId, foeId) => {
    const e = E(), me = sim.byId(ownId), foe = sim.byId(foeId);
    if (!e || typeof e.reach !== 'function' || !me || !foe) return 0;
    try {
      const t = (e.reach(sim, me, foe) || {}).their;
      if (!t || !t.beams) return 0;
      if (t.facet && t.beams[t.facet] > 0) return t.beams[t.facet];
      // facet unknown: the shortest of the three, so an unknown face never reads as the softest one
      const v = [t.beams.nose, t.beams.flank, t.beams.tail].filter((x) => x > 0);
      return v.length ? Math.min.apply(null, v) : 0;
    } catch (err) { return 0; }
  };

  const chapters = [
    {
      n: 1, id: 'cold-equations', title: 'Cold Equations', location: 'Callisto orbit', date: '14 March 2211',
      brief: [
        'You are Commander Halvorsen of the Jovian Compact, in orbit over Callisto with the corvette JCS Larkspur. The moons vote on the Declaration in a fortnight, and the Inner Systems Authority has been stopping Compact ships for inspection all winter. Nobody is shooting yet.',
        'Forty minutes ago the tanker JCV Long Meridian lost her drive on a coast out of Valhalla Station. Her nineteen crew are alive. She is falling along an ellipse that reaches the surface of Callisto in under two hours, and the Compact cannot spare a tanker.',
        'Go and get her. Larkspur has full tanks, 51 km/s of delta-v. Delta-v is the speed your tanks can still add or take away, and every burn spends some of it. An approach only counts if you end up moving with the other ship, not just beside her. The ship pushes the way its nose points, so to slow down you turn round and burn the other way.',
      ],
      comms: [say('Lt. Ruiz, navigation', 'Skipper, Long Meridian is on the plot with no drive plume. She has nothing aboard to stop herself with. If we do not go and stop her she is on the surface in two hours.')],
      // Nobody tows her: the rendezvous trigger gives her drive back and the player flies her home, so
      // the line says what the objective actually measured.
      victory: 'Long Meridian is inside 100 km of Valhalla Station with her drive running again. Her nineteen crew are aboard. The tanker will fly again.',
      // Two ways to lose it: the tanker on the surface, or Larkspur gone with the tanker still falling.
      get defeat() {
        const sim = endSim('Cold Equations');
        const m = sim && sim.byId('meridian'), l = sim && sim.byId('larkspur');
        const advice = ' Burn earlier, and keep enough delta-v to brake with at the end.';
        if (m && !m.destroyed && isOut(l)) {
          return 'Larkspur is out of the fight over Callisto. Long Meridian is still falling, and nothing else out here can reach her in time.' + advice;
        }
        return 'Long Meridian came down on Callisto with her nineteen crew aboard.' + advice;
      },
      build() {
        const body = B.callisto;
        return {
          name: 'Cold Equations', body, sunAngle: -0.8, playerFaction: 'JC',
          controls: { orders: ['intercept', 'hold'] },
          ships: [
            { id: 'larkspur', name: 'JCS Larkspur', cls: 'corvette', faction: 'JC', player: true, orbit: { altitude: km(1800), angle: 0.2 }, heading: 1.2 },
            { id: 'meridian', name: 'JCV Long Meridian', cls: 'freighter', faction: 'CIV', orbit: { altitude: km(2600), angle: 0.9, velScale: 0.77 }, radiatorsOut: true, propFraction: 0.5, systems: { drive: 0 }, crew: null },
            { id: 'valhalla', name: 'Valhalla Station', cls: 'station', faction: 'JC', orbit: { altitude: km(1800), angle: -0.9 } },
          ],
          objectives: [
            { id: 'rv', text: 'Pull alongside JCV Long Meridian and hold within 5 km at under 10 m/s', type: 'rendezvous', ship: 'larkspur', target: 'meridian', range: 5000, speed: 10, hold: 30 },
            { id: 'home', text: 'Bring JCV Long Meridian within 100 km of Valhalla Station', type: 'reach', ship: 'meridian', target: 'valhalla', range: km(100), speed: 80, hold: 5, inactive: true },
          ],
          intro: [say('Lt. Ruiz, navigation', 'Skipper, Long Meridian is on the plot with no drive plume. She has nothing aboard to stop herself with. If we do not go and stop her she is on the surface in two hours.')],
          triggers: [
            // The stakes, on the map: where and when the tanker comes down if nobody burns.
            { when: { time: 0.5 }, actions: [{ fn: (sim) => {
              const m = sim.byId('meridian'); if (!m) return;
              const pts = sim.predictPath(m, 5 * 3600, 600);
              if (pts.length < 600) { const last = pts[pts.length - 1]; sim.flags.impactT = pts.length * 30; sim.markers.push({ id: 'impact', pos: last, color: '#ff6b6b', radius: km(60), label: 'Long Meridian comes down here' }); }
            } }, { log: { speaker: 'Lt. Ruiz, navigation', text: 'She reaches the surface in about two hours if nobody burns. The red circle is where.' } }] },
            { when: (sim) => { const mk = sim.markers.find((x) => x.id === 'impact'); if (mk && sim.flags.impactT != null) { const left = sim.flags.impactT - sim.time; mk.label = 'Long Meridian comes down here' + (left > 0 ? ' in ' + U.fmt.time(left) : ''); } return false; }, actions: [] },
            // Guided tour, six steps.
            { when: { time: 1 }, actions: [{ hint: { id: 't2', step: [1, 5], text: (typeof window !== 'undefined' && window.innerWidth < 900) ? 'JCV Long Meridian is falling toward Callisto with no drive. Tap her on the map to make her Larkspur\'s target. Larkspur is your ship, her panel is below the map, and every order she takes goes to whatever she has targeted.' : 'JCV Long Meridian is falling toward Callisto with no drive. Click her on the map to make her Larkspur\'s target. Larkspur is your ship, her panel is on the right, and every order she takes goes to whatever she has targeted.', mark: 'meridian', markLabel: (typeof window !== 'undefined' && window.innerWidth < 900) ? 'tap to target' : 'click to target', until: (sim) => { const s = sim.byId('larkspur'); return s && s.target === 'meridian'; } } }] },
            { when: (sim) => { const s = sim.byId('larkspur'); return s && s.target === 'meridian'; }, actions: [{ hint: { id: 't3', step: [2, 5], text: 'The Intercept button now reads about 18 minutes and 12 km/s, out of the 51 km/s in Larkspur\'s tanks. Press Intercept, or the I key. The autopilot points the nose at her and burns, turns round halfway, and burns the other way to stop alongside her.', anchor: '[data-order="intercept"]', until: (sim) => sim.flags.orderedIntercept } }] },
            { when: (sim) => sim.flags.orderedIntercept, actions: [{ hint: { id: 't4', step: [3, 5], text: 'Larkspur is burning, and her plotted path is drawn ahead of her. The bright part is the burn. The ring is where she flips. The blue-grey part is braking tail-first. Press 16\u00d7 or Skip ahead to run the clock. Time drops back to 1\u00d7 by itself for the flip and the arrival, so you will not miss them.', anchor: '#warp', until: (sim) => !!sim.flags.flipHint } }] },
            { when: (sim) => { const s = sim.byId('larkspur'); return s && s.order.type === 'intercept' && s.stats.dvSpent > 1500 && Math.abs(U.angleDiff(s.cmdHeading, s.heading)) > 2.5 && !sim.flags.flipHint; }, actions: [{ flag: 'flipHint' }, { log: { speaker: 'Lt. Ruiz, navigation', text: 'Flip complete. We are braking tail-first from here.' } }, { hint: { id: 't5', step: [4, 5], text: 'Halfway. The nose has swung round and the drive now faces Long Meridian, so from here every second takes speed off instead of adding it. Watch the delta-v bar in the panel. The hatched part is what the rest of the plan still costs, and it shrinks as she pays.', anchor: '#shipPanel', until: (sim) => sim.objectives[0].done } }] },
            { when: { objective: 'rv' }, actions: [{ fn: (sim) => { const m = sim.byId('meridian'); if (m) { m.systems.drive = 1; if (OD.Damage && OD.Damage.repair) { try { OD.Damage.repair(m, 1); } catch (e) { /* the tanker flies either way */ } } m.faction = 'JC'; m.player = true; m.ai = false; m.order = { type: 'hold' }; m.target = 'valhalla'; } sim.markers = sim.markers.filter((x) => x.id !== 'impact'); if (OD.Game && OD.Game.sim === sim) OD.Game.select('meridian'); } }, { log: { speaker: 'JCV Long Meridian', text: 'Larkspur, your engineers have our drive back. She is heavy and slow, and she is yours to steer.' } }, { activate: 'home' }, { hint: { id: 't6', step: [5, 5], text: 'Long Meridian has her drive back. She is selected now, with Valhalla Station already her target, so press Intercept. She is a freighter at 2.5 m/s\u00b2 against Larkspur\'s 13, so the trip is slow. Skip ahead runs the clock to the next event.', anchor: '[data-order="intercept"]', until: (sim) => { const m = sim.byId('meridian'); return m && m.order.type === 'intercept'; } } }] },
            { when: (sim) => { const m = sim.byId('meridian'); return m && m.order.type === 'intercept' && !sim.flags.fullHint; }, actions: [{ flag: 'fullHint' }, { hint: { id: 't7', text: 'Long Meridian is on her way home. Every mission works the same way. Pick a target, choose an order, and pay for it in delta-v. Press D, or the Essentials button at the top of the panel, to show the rest of her numbers.', anchor: '#pDetail' } }] },
            // The sink number the panel is showing at this moment leads the hint, so the two agree.
            { when: (sim) => { const s = sim.byId('larkspur'); return s && s.thermalLoad() > 0.45 && !sim.flags.heatHint; }, actions: [{ flag: 'heatHint' }, { fn: (sim) => {
              const s = sim.byId('larkspur'); if (!s) return;
              sim.hint({ id: 'h5', anchor: '#shipPanel',
                text: 'Your sink is at ' + Math.round(s.thermalLoad() * 100) + ' % and climbing on this burn. With the radiators out it holds steady. In a fight you stow them with X and the sink fills. A full sink holds the drive to a quarter and stops every mount, point defence included, until it drains.',
                until: (s2) => { const t = s2.byId('larkspur'); return !t || t.thermalLoad() < 0.3 || s2.time > 1500; } });
            } }] },
            logAt(60, 'Valhalla Control', 'Larkspur, Control. You are clear to manoeuvre. Long Meridian has nineteen people aboard.'),
          ],
        };
      },
    },
    {
      n: 2, id: 'picket-line', title: 'Picket Line', location: 'Ganymede orbit', date: '2 April 2211',
      brief: [
        'You are over Ganymede in JCS Larkspur, covering two Compact freighters out of Galileo Regio. The Declaration is three days old. The Inner Systems Authority has not recognised it and calls its ships out here customs enforcement.',
        'The Authority corvette ISV Sabre has shadowed these convoys for a week. This morning she crossed the bow of a loaded hauler close enough to scorch paint. Put Larkspur between Sabre and the freighters and take her out of the fight. Disable her, or close to under 3 km at under 25 m/s and put a boarding party across. Either way the freighters come home.',
        'Sabre is running cold. At a thousand kilometres she is a contact on your board, a bearing and a rough range, and you are the same to her. Light a drive and the plume gives the other one a firing solution, from any range. Whoever burns first is seen first.',
        'She has been lying on the convoy route since before dawn with her radiators stowed, so her heat sink is about 30 per cent full. Larkspur starts empty. A long fight goes to the ship with the emptier sink.',
      ],
      comms: [say('Cmdr. Adeyemi, Galileo Regio', 'Halvorsen, Sabre is armed and her captain has orders we have not seen. Keep your nose toward her. Larkspur carries 20 cm of armour on the nose and 8 on the flanks. Stow the radiators when she gets close, and do not light the drive unless you mean it.')],
      // Sabre can end this chapter four ways — taken, wrecked, adrift or driven off — and the freighters
      // are still on their way when it ends, so the line says which one happened and does not send the
      // convoy home early.
      get victory() {
        const sim = endSim('Picket Line');
        const t = sim && sim.byId('sabre');
        const head = sim ? endedAs(sim, 'sabre', 'Sabre') : 'Sabre is out of the fight.';
        const convoy = ' Ochre Sky and Pale Harbour are still flying, on their way to Galileo Regio.';
        // What the Compact did to her: boarded her, put beams through her, or pushed her off the route.
        const last = t && t.captured ? ' The Compact has taken an Authority warship, and both governments know what that means.'
          : !t || t.hull < 0.995 ? ' The Compact has fired on an Authority warship, and both governments know what that means.'
          : ' The Compact has pushed an Authority warship off a Compact convoy, and both governments know what that means.';
        return head + convoy + last;
      },
      // main.js reads chapter.defeat when it builds the debrief, so the sentence is picked from the fight
      // that just ended: the convoy lost, or Larkspur lost with the convoy still flying.
      get defeat() {
        if (ch2Loss() !== 'larkspur') return CH2_DEFEAT.convoy;
        const sim = endSim('Picket Line');
        const t = sim && sim.byId('sabre');
        // She is only still on the picket line if she is still flying and fit to fight.
        return CH2_DEFEAT.larkspur + ' ' + (isDone(t) ? endedAs(sim, 'sabre', 'Sabre') : 'ISV Sabre is still on the picket line.');
      },
      build() {
        const body = B.ganymede;
        return {
          name: 'Picket Line', body, sunAngle: 0.4, playerFaction: 'JC',
          ships: [
            { id: 'larkspur', name: 'JCS Larkspur', cls: 'corvette', faction: 'JC', player: true, orbit: { altitude: km(3200), angle: 0 }, heat: 0 },
            // the convoy runs ahead of Larkspur, nearer Sabre than her beams reach: holding station leaves it to her
            { id: 'hauler1', name: 'JCV Ochre Sky', cls: 'freighter', faction: 'JC', ai: true, orbit: { altitude: km(3200), angle: 0.11 }, propFraction: 0.5 },
            { id: 'hauler2', name: 'JCV Pale Harbour', cls: 'freighter', faction: 'JC', ai: true, orbit: { altitude: km(3200), angle: 0.14 }, propFraction: 0.5 },
            // A picket: cold, radiators stowed, computer asleep until Larkspur shows herself (see the trigger
            // below). She has been lying doggo across the convoy route with the panels in, so her sink is
            // already 30 % full at 2 MW of idle heat — about forty minutes stowed — while Larkspur starts at
            // zero. That is the chapter's lesson on her side of the board: a long fight goes to the ship with
            // the emptier sink.
            { id: 'sabre', name: 'ISV Sabre', cls: 'corvette', faction: 'ISA', ai: false, orbit: { altitude: km(3600), angle: 0.16 }, propFraction: 0.8, heat: (OD.Ships.CLASSES.corvette || {}).sinkCapacity * 0.3, radiatorsOut: false, order: { type: 'hold' }, weaponsFree: true },
          ],
          objectives: [
            // The two minutes are the window for the prize: the card that offers the boarding comes up
            // when she stops manoeuvring, and the player still has to read it and order the run. An
            // intercept ordered on her inside that window holds the chapter open (the trigger below).
            { id: 'sabre', text: 'Neutralise ISV Sabre (disable or board)', type: 'neutralize', targets: ['sabre'], hold: 120 },
            { id: 'p1', text: 'JCV Ochre Sky survives', type: 'protect', ship: 'hauler1' },
            { id: 'p2', text: 'JCV Pale Harbour survives', type: 'protect', ship: 'hauler2' },
          ],
          intro: [say('Cmdr. Adeyemi, Galileo Regio', 'Halvorsen, Sabre is armed and her captain has orders we have not seen. Keep your nose toward her, and stow the radiators when she gets close.')],
          triggers: [
            hintFrom({ time: 2 }, (sim) => {
              const s = sim.byId('larkspur'), t = sim.byId('sabre');
              const R = s && t ? kmAbout(U.dist(s.pos, t.pos)) : '1 000 km';
              return { id: 'h1', anchor: '#shipPanel',
                text: 'Sabre is the ? on the map, ' + R + ' out. A contact is a bearing and a rough range, and the ring is where she might be. ' + ((typeof window !== 'undefined' && window.innerWidth < 900) ? 'Tap' : 'Click') + ' her to make her the target. The Track row then grades our picture of her, from contact, to track, to a solution good enough to aim by.',
                until: (s2) => { const a = s2.byId('larkspur'); return (a && a.target === 'sabre' && s2.time > 8) || s2.time > 240; } };
            }),
            hintFrom((sim) => sim.time > 12 && trackQ(sim, 'sabre') < 2.7, (sim) => {
              const R = coldSolutionRange(sim, 'larkspur');
              return { id: 'h1b', anchor: '#shipPanel',
                text: 'Cold, Sabre needs to be inside ' + (R > 0 ? kmAbout(R) : '350 km') + ' to aim at you. Light the drive and she has a solution from any range. Keep the cruise capped on the way in.',
                until: (s2) => !!s2.flags.decisionAnswered || s2.time > 300 };
            }),
            // The band's keys are their own hint, on the first card the navigator raises.
            hintAt((sim) => hasDecision(sim), 'h1k', 'The navigator has put a decision on the band. Keys 1, 2 and 3 answer it, Esc leaves it for later, and the lit option is her own pick.', '#decision', (sim) => !!sim.flags.decisionAnswered || sim.time > 900),
            hintAt((sim) => trackQ(sim, 'sabre') >= 2.7 && sim.time > 20, 'h1c', 'We have a solution on Sabre, so the beams and the coilgun can aim. Right-click her to keep range, and Larkspur holds her doctrine range of 250 km.', '#shipPanel', (sim) => sim.time > 600 || trackQ(sim, 'sabre') < 2.7),
            hintAt((sim) => trackQ(sim, 'sabre') >= 2.7 && sim.time > 45, 'h1e', 'The "They see" row names the armour face Sabre is looking at. Larkspur carries 20 cm on the nose and 4 on the tail, so keep the nose to her.', '#shipPanel', (sim) => sim.time > 700 || trackQ(sim, 'sabre') < 2.7),
            hintFrom((sim) => seenQ(sim, 'larkspur') >= 2.7 && sim.time > 20, (sim) => {
              const R = theirBurnThrough(sim, 'larkspur', 'sabre');
              return { id: 'h1d', anchor: '#shipPanel',
                text: 'Sabre holds a solution on us, from our drive plume or our hot radiators. A burn cannot be hidden once it is running, so finish it. Stow the radiators with X before she is inside ' + (R > 0 ? kmAbout(R) : '190 km') + ', where her beams burn through them.',
                until: (s2) => seenQ(s2, 'larkspur') < 2.7 || s2.time > 400 };
            }),
            hintAt((sim) => { const t = sim.byId('sabre'); return !!(t && t.neutralised() && !t.captured && !t.destroyed); }, 'h2', 'Sabre is disabled and the objective is met. To take her as a prize, intercept her and hold inside 3 km at under 25 m/s. A boarding party crosses and needs 90 s to take her. The chapter stays open while the run is flying and while the party is across.', '#shipPanel', (sim) => { const t = sim.byId('sabre'); return !t || t.captured || t.destroyed || !!sim.outcome; }),
            hintAt((sim) => sim.time > 30 && hasAction(sim, 'fire_full') && (sim.time > 600 || (() => { const s = sim.byId('larkspur'), t = sim.byId('sabre'); return !!(s && t && U.dist(s.pos, t.pos) < km(800)); })()), 'h3', 'Fire control is at the bottom of the panel, and Larkspur\'s weapons are free. W holds or frees them, and B picks the beam mode. Full fires every beam and fills the heat sink. Sustained throttles the beams to what the radiators can shed, so she can fire all day. The ticks on the line to Sabre mark where each side\'s beams burn through.', '#pEng', (sim) => !!sim.flags.fireKeyUsed || sim.time > 700),
            { when: (sim) => { const s = sim.byId('larkspur'), t = sim.byId('sabre'); return !!(s && t && (seenQ(sim, 'larkspur') >= 2.7 || U.dist(s.pos, t.pos) < km(500) || sim.time > 900)); }, actions: [{ flag: 'sabreAwake' }, { fn: (sim) => { const t = sim.byId('sabre'); if (t && !t.neutralised()) { t.ai = true; t.radiators.deployed = true; } } }, { log: { speaker: 'Lt. Ruiz, navigation', text: 'Sabre has seen us. Her radiators are extending and her drive is warming.', kind: 'warn' } }] },
            // Sabre works on whatever she can hurt. While Larkspur is inside the range where Sabre's beams burn
            // through the face Larkspur is showing her, she leaves the freighters and fights the warship, flown
            // by hand (ai off) so the hull she is shooting at does not change back every two seconds. Open that
            // range, or turn a thicker face to her, and after half a minute the freighters are her problem again.
            // The twenty seconds is there so a flip in passing during a transfer is not a commitment.
            { when: (sim) => {
              const f = sim.flags, t = sim.byId('sabre'), s = sim.byId('larkspur');
              if (!f.sabreAwake || !t || t.destroyed || t.captured || t.neutralised()) return false;
              const R = theirBurnThrough(sim, 'larkspur', 'sabre');
              // Two things have to be true before she gives up the convoy: her beams burn through the face
              // Larkspur is showing her, and Larkspur is inside her own fighting range. The second gate is
              // what stops a corvette braking tail-first 600 km away — 4 cm of tail armour, so her beams
              // reach half the board — from pulling her off the freighters before the fight has started.
              const fightRange = (((OD.Ships.CLASSES[t.cls] || {}).doctrine || {}).range || km(250)) * 1.5;
              const able = !!(s && !s.destroyed && !s.disabled) && R > 0 && U.dist(s.pos, t.pos) < Math.min(R, fightRange);
              // Once she is in it and hurt she stays in it. Her computer would break off at 35 % of hull and
              // burn away, and an equal corvette with fuller tanks cannot be caught: the chapter would run
              // until the clock ran out with the prize 5 000 km away. Her captain has orders, so the hand
              // keeps her on Larkspur and the fight is decided here.
              const cornered = f.sabreOnUs && (t.hull < 0.35 || t.systems.drive < 0.3 || t.deltaV() < 2500);
              if (able || cornered) {
                f.sabreOutAt = null;
                if (f.sabreInAt == null) f.sabreInAt = sim.time;
                if (!f.sabreOnUs && sim.time - f.sabreInAt >= 20) {
                  f.sabreOnUs = true; t.ai = false; t.radiators.auto = true;
                  sim.addLog('Sabre has left the freighters and turned onto us. She is ' + kmAbout(U.dist(s.pos, t.pos)) + ' off, inside the range where her beams burn through the face we are showing her.', 'Lt. Ruiz, navigation', 'warn');
                  sim.hint({ id: 'h4', anchor: '#shipPanel', text: 'Press V for the hull view. It draws Larkspur as she is now, with her radiators, her mounts and her plume in the state they are really in. Zoom in on the map and you see the same ship.' });
                }
              } else {
                f.sabreInAt = null;
                if (f.sabreOutAt == null) f.sabreOutAt = sim.time;
                if (f.sabreOnUs && sim.time - f.sabreOutAt >= 30) {
                  f.sabreOnUs = false; t.ai = true;
                  sim.addLog('Sabre has gone back to the freighters. Her beams do not reach the face we are showing her.', 'Lt. Ruiz, navigation', 'info');
                }
              }
              if (f.sabreOnUs) {
                sabreOnLarkspur(sim, t);
                if (OD.AI && OD.AI.thermalDoctrine) { try { OD.AI.thermalDoctrine(t, sim, s); } catch (e) { /* housekeeping only */ } }
              }
              return false;
            }, actions: [] },
            // A boarding ordered from the band is a clock, not a wish: while the party is on its way to Sabre
            // the neutralise objective stays open, so the prize is taken before the chapter ends. The window
            // is the run the card promised plus the 90 s across, and a run still closing inside 50 km keeps
            // the chapter open past it. A run that stops making ground lapses, with a line saying so.
            { when: (sim) => {
              const f = sim.flags;
              const o = (sim.objectives || []).find((x) => x.id === 'sabre'), t = sim.byId('sabre');
              if (!o || o.done || o.metAt == null || !t || t.captured || t.destroyed) return false;
              const ours = (s2) => s2.faction === sim.playerFaction && !s2.destroyed && !s2.disabled;
              const across = sim.ships.find((s2) => ours(s2) && s2.boarding && s2.boarding.target === 'sabre');
              // A run is on while one of ours is flying an intercept at Sabre: from the card, which also
              // ties her guns, or ordered by hand off the prize hint. Sabre is already out of the fight
              // by the time this trigger runs, so an intercept on her is a boarding run and nothing else.
              const runner = across || sim.ships.find((s2) => ours(s2) && (s2.order || {}).type === 'intercept' && (s2.order || {}).target === 'sabre');
              if (!runner) { f.boardRunFrom = null; f.boardRunCap = 0; f.boardRunBest = null; f.boardRunGain = null; return false; }
              const R = U.dist(runner.pos, t.pos);
              if (f.boardRunFrom == null) {
                f.boardRunFrom = sim.time;
                f.boardRunBest = R;
                f.boardRunGain = sim.time;
                // The window is the card's own promise: the run the autopilot says it will fly, plus the
                // 90 s the party needs across, plus a minute for the last correction. Ten minutes at most.
                const A = OD.Autopilot, B = (OD.Sim && OD.Sim.BOARD) || { time: 90 };
                let eta = 0;
                if (A && typeof A.estimate === 'function') { try { eta = A.estimate(runner, t).time || 0; } catch (e) { eta = 0; } }
                f.boardRunCap = Math.max(300, Math.min(900, Math.round(eta + B.time + 60)));
              }
              // Ground made toward her: every kilometre resets the clock on the last rule below.
              if (f.boardRunBest == null || R < f.boardRunBest - 1000) { f.boardRunBest = R; f.boardRunGain = sim.time; }
              // A party across holds the chapter open for as long as it takes. A run in gets its window,
              // and a run inside 50 km that is still making ground keeps the chapter open past it.
              const closing = R < km(50) && sim.time - (f.boardRunGain || sim.time) < 60;
              if (across || closing || sim.time - f.boardRunFrom < f.boardRunCap) { o.metAt = sim.time; f.boardRunLapsed = false; return false; }
              if (!f.boardRunLapsed) {
                f.boardRunLapsed = true;
                sim.addLog('The prize run ran out of clock. ' + runner.name + ' is still ' + kmAbout(R) + ' from Sabre.', 'Marines', 'warn');
              }
              return false;
            }, actions: [] },
          ],
        };
      },
    },
    {
      n: 3, id: 'radiator-weather', title: 'Radiator Weather', location: 'Europa, Conamara Station', date: '19 April 2211',
      brief: [
        'You are over Europa with JCS Larkspur and the frigate JCS Anselm. Conamara Station is the ice farm that supplies half of Ganymede with water, and two Inner Systems Authority frigates have parked over it.',
        'They are not shooting. With hostiles that close, Conamara has kept its radiators stowed for nine hours and its heat sink is at 88 per cent. In about an hour it is full, and then the station has to extend the radiators under their beams. Break the siege.',
        'The same clock runs on your own ships. Radiators only shed heat while they are out, and while they are out they are the thinnest thing on the hull. Every minute with them stowed fills your sink. A full sink holds the drive to a quarter and stops every mount, point defence included, until it drains.',
      ],
      comms: [say('Conamara Station', 'Compact ships, Conamara. We are at eighty-eight per cent on the sink and we can hold about an hour. After that we extend the radiators and hope those two are busy.')],
      // Either frigate can end adrift, wrecked, taken or driven off, so the line names each one's ending.
      get victory() {
        const sim = endSim('Radiator Weather');
        const tail = ' Conamara can extend its radiators again. Ganymede keeps its water.';
        if (!sim) return 'Both Authority frigates are out of the fight.' + tail;
        const a = sim.byId('isa1'), b = sim.byId('isa2');
        const head = a && b && a.disabled && b.disabled && !a.destroyed && !b.destroyed
          ? 'Tenacity and Vigil are both out of the fight and adrift.'
          : endedShort(sim, 'isa1', 'Tenacity') + '. ' + endedShort(sim, 'isa2', 'Vigil') + '.';
        return head + tail;
      },
      // The station can be lost, or our two ships can be, with the station still on its stowed sink.
      get defeat() {
        const sim = endSim('Radiator Weather');
        const st = sim && sim.byId('conamara');
        if (st && !isOut(st) && ableShips(sim) === 0) {
          const live = ['isa1', 'isa2'].filter((id) => !isDone(sim.byId(id))).length;
          return 'Larkspur and Anselm are both out of the fight over Europa. Conamara Station still has its radiators stowed and its sink is at ' + pctOf(st.thermalLoad()) + '.' +
            (live ? ' ' + COUNT[live] + (live === 1 ? ' Authority frigate is' : ' Authority frigates are') + ' still over it.' : '');
        }
        return 'Conamara Station is lost, and with it half of Ganymede\'s water for the season.';
      },
      build() {
        const body = B.europa;
        return {
          name: 'Radiator Weather', body, sunAngle: 2.6, playerFaction: 'JC',
          ships: [
            { id: 'larkspur', name: 'JCS Larkspur', cls: 'corvette', faction: 'JC', player: true, orbit: { altitude: km(2400), angle: -0.35 } },
            { id: 'anselm', name: 'JCS Anselm', cls: 'frigate', faction: 'JC', player: true, orbit: { altitude: km(2400), angle: -0.37 } },
            { id: 'conamara', name: 'Conamara Station', cls: 'station', faction: 'JC', orbit: { altitude: km(2400), angle: 0 }, heat: (OD.Ships.CLASSES.station || {}).sinkCapacity * 0.88, radiatorsOut: false, radiatorsAuto: false },
            { id: 'isa1', name: 'ISV Tenacity', cls: 'frigate', faction: 'ISA', ai: true, orbit: { altitude: km(2400), angle: 0.07 }, propFraction: 0.85 },
            { id: 'isa2', name: 'ISV Vigil', cls: 'frigate', faction: 'ISA', ai: true, orbit: { altitude: km(2700), angle: 0.1 }, propFraction: 0.85 },
          ],
          objectives: [
            { id: 'n', text: 'Neutralise both Authority frigates', type: 'neutralize', targets: ['isa1', 'isa2'] },
            { id: 'p', text: 'Conamara Station survives', type: 'protect', ship: 'conamara' },
          ],
          intro: [say('Conamara Station', 'Compact ships, Conamara. We are at eighty-eight per cent on the sink and we can hold about an hour. After that we extend the radiators and hope those two are busy.')],
          triggers: [
            hintAt({ time: 2 }, 'h1', 'You have two ships this time, Larkspur and Anselm. Tab switches between them, and shift-click adds a ship to the selection so one order goes to both.', '#fleetList'),
            hintAt({ time: 20 }, 'h2', 'The Heat section shows your sink filling. Radiators only shed heat while they are out, so extend them with X whenever nothing is shooting at you, and stow them before a beam can reach them.', '#shipPanel'),
            hintAt((sim) => sim.time > 60 && hasAction(sim, 'aim_radiators') && hostileRadiatorsOut(sim, km(450)), 'h3', 'That frigate has her radiators out to keep her own sink down. Press T to set the aim point to Radiators. Radiators are the thinnest part of any hull, and a frigate that loses hers has to sit in her own heat.', '#pEng'),
            { when: (sim) => sim.objectives[0].done, actions: [{ fn: (sim) => { const st = sim.byId('conamara'); if (st) { st.radiators.auto = true; st.radiators.deployed = true; } } }, { log: { speaker: 'Conamara Station', text: 'Radiators extending. Sink is falling already. Thank you, Compact.' } }] },
          ],
        };
      },
    },
    {
      n: 4, id: 'slugs-in-the-dark', title: 'Slugs in the Dark', location: 'Io, Loki approach', date: '3 May 2211',
      brief: [
        'You are on the Loki approach at Io with Larkspur, Anselm and the new destroyer JCS Bastion. The Authority destroyer ISV Coriolis carries the heaviest coilguns out here, and she has used them on three Compact haulers this week. One of them had people aboard.',
        'A slug is unguided. Coriolis fires it at where you will be if you hold your course, and at 300 km a 4.5 km/s slug takes 67 seconds to arrive. So do not hold your course. Jink, spend the propellant, and close to where your own beams and Bastion can answer.',
      ],
      comms: [say('Capt. Oyelaran, JCS Bastion', 'Halvorsen, Bastion is with you. She is 180 metres of destroyer and she turns slowly, so I will hold a straight line and take the hits. You two do the jinking.')],
      // Coriolis ends this chapter adrift, wrecked, taken, or driven off past 1 500 km with her hull
      // opened up (sim.js drivenOffStep), and a hull that is still flying is not called adrift. Bastion
      // only took a hit in the endings where something got through her armour, so her sentence is read
      // off her hull.
      get victory() {
        const sim = endSim('Slugs in the Dark');
        const tail = ' The Io approaches are open.';
        if (!sim) return 'Coriolis is out of the fight.' + tail;
        return endedAs(sim, 'coriolis', 'Coriolis') + ' ' + ourEnd(sim.byId('bastion'), 'Bastion') + tail;
      },
      // Larkspur is out of the fight in every way this chapter is lost (she is the protect objective),
      // and Coriolis may be out of it as well.
      get defeat() {
        const sim = endSim('Slugs in the Dark');
        const c = sim && sim.byId('coriolis');
        if (!sim) return 'The task group is off the Loki approach, and Coriolis still holds the Io approaches.';
        return 'Larkspur is out of the fight on the Loki approach. ' +
          (isDone(c) ? endedAs(sim, 'coriolis', 'Coriolis') + ' The Compact paid for the approach with its corvette.'
            : 'Coriolis still holds the Io approaches.');
      },
      build() {
        const body = B.io;
        return {
          name: 'Slugs in the Dark', body, sunAngle: -2.2, playerFaction: 'JC',
          ships: [
            { id: 'larkspur', name: 'JCS Larkspur', cls: 'corvette', faction: 'JC', player: true, orbit: { altitude: km(2600), angle: 0 } },
            { id: 'anselm', name: 'JCS Anselm', cls: 'frigate', faction: 'JC', player: true, orbit: { altitude: km(2600), angle: -0.02 } },
            { id: 'bastion', name: 'JCS Bastion', cls: 'destroyer', faction: 'JC', player: true, orbit: { altitude: km(2600), angle: -0.05 } },
            { id: 'coriolis', name: 'ISV Coriolis', cls: 'destroyer', faction: 'ISA', ai: true, orbit: { altitude: km(3100), angle: 0.2 }, propFraction: 0.9 },
            { id: 'isa2', name: 'ISV Lark', cls: 'corvette', faction: 'ISA', ai: true, orbit: { altitude: km(3300), angle: 0.24 }, propFraction: 0.9 },
          ],
          objectives: [
            { id: 'n', text: 'Neutralise ISV Coriolis', type: 'neutralize', targets: ['coriolis'] },
            { id: 'n2', text: 'Neutralise ISV Lark', type: 'neutralize', targets: ['isa2'], optional: true },
            { id: 'pl', text: 'JCS Larkspur comes home', type: 'protect', ship: 'larkspur' },
          ],
          intro: [say('Capt. Oyelaran, JCS Bastion', 'Halvorsen, Bastion is with you. She turns slowly, so I will hold a straight line and take the hits. You two do the jinking.')],
          triggers: [
            hintAt({ time: 2 }, 'h1', 'Coriolis will hold 600 km all day, and at that range your beams barely mark her armour. Type 200 in the Range box, shift-click all three ships and keep range on her together. Turn jinking on for Larkspur and Anselm with J, so her slugs arrive where you were.', '#shipPanel'),
            hintAt({ time: 40 }, 'h2', 'Coriolis fires her slugs at where you will be, not at where you are. Press P and read the slug flight time at this range. At 300 km it is 67 s, and any burn inside that time takes you off the aim point.', '#btnPhysics'),
            hintAt((sim) => sim.time > 60 && trackQ(sim, 'coriolis') < 2.5, 'h2b', 'We have a track on Coriolis but not a solution, so our coilgun cannot lead her. Hers cannot lead us either. That is why she is quiet. Closing sharpens the picture for both sides. The active sensor (S) buys a solution at once and hands her one on us.', '#shipPanel', (sim) => trackQ(sim, 'coriolis') >= 2.5 || sim.time > 500),
            hintAt((sim) => inbound(sim, 'slug'), 'h3', 'Slugs are inbound. Each one on the map carries its time of arrival, and reads "will miss" once its target has moved off the aim point. The Threats band at the top of the panel counts them. Jinking (J) spends propellant and moves you off the aim point before the slug arrives.', '#shipPanel'),
          ],
        };
      },
    },
    {
      n: 5, id: 'hard-burn', title: 'Hard Burn', location: 'Deep space, outbound from Io', date: '11 May 2211',
      brief: [
        'You are outbound from Io in JCS Larkspur, alone. The Authority raider ISV Tamarind hit the hauler JCV Kestrel Moon this morning and ran with her cargo. She is 7 800 km ahead and burning outward. Past 60 000 km no transfer your tanks can buy will catch her.',
        'Larkspur has full tanks and the same acceleration Tamarind has. A stern chase means matching her speed and beating it, closing the distance, and still holding the delta-v to brake alongside. The brake at the end is about four minutes of burning tail-first, with your drive pointed at her.',
        'Kestrel Moon hurt her first. Tamarind\'s bays are empty, half her mounts are down and her hull is at 60 per cent. Go in hard, brake hard and keep the pass short. A capped approach only leaves you coasting inside her reach while she runs for the line.',
      ],
      comms: [say('Lt. Ruiz, navigation', 'She will run until she thinks we have quit. Tamarind is a corvette at sixty per cent tanks, so she cannot afford this any more than we can.')],
      // A wreck takes the cargo with her, so the cargo sentence is read off the hull it is aboard.
      get victory() {
        const sim = endSim('Hard Burn');
        const t = sim && sim.byId('tamarind');
        const tail = ' The Authority has lost a raider it cannot replace out here.';
        if (!t) return 'Tamarind is out of the fight inside the escape line.' + tail;
        if (t.destroyed) return 'Tamarind came apart inside the escape line. Kestrel Moon\'s cargo went with her.' + tail;
        if (t.captured) return 'Tamarind was boarded and taken inside the escape line. Kestrel Moon\'s cargo is aboard her.' + tail;
        return 'Tamarind is out of the fight and adrift inside the escape line, ' + adriftWhy(t) + ' Kestrel Moon\'s cargo is still aboard her.' + tail;
      },
      // Either she crossed the line, or Larkspur is out of the fight with the raider still inside it.
      get defeat() {
        const sim = endSim('Hard Burn');
        const t = sim && sim.byId('tamarind');
        if (t && !isDone(t) && ableShips(sim) === 0) {
          return 'Larkspur is out of the fight in deep space, and nothing else of ours is out here. Tamarind is still running with Kestrel Moon\'s cargo aboard.';
        }
        return 'Tamarind crossed the escape line 60 000 km out, and took Kestrel Moon\'s cargo with her.';
      },
      build() {
        return {
          name: 'Hard Burn', body: null, sunAngle: 1.0, playerFaction: 'JC',
          markers: [{ pos: { x: 0, y: 0 }, radius: km(60000), label: 'escape line 60 000 km', color: '#ff5d5d' }],
          ships: [
            { id: 'larkspur', name: 'JCS Larkspur', cls: 'corvette', faction: 'JC', player: true, crew: { xp: 2 }, pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, heading: 0.3 },
            { id: 'tamarind', name: 'ISV Tamarind', cls: 'corvette', faction: 'ISA', ai: true, behaviour: 'flee', reserveDv: 27000, pos: { x: km(7200), y: km(3000) }, vel: { x: 2000, y: 900 }, heading: 0.4, propFraction: 0.6, hull: 0.6, systems: { weapons: 0.5, sensors: 0.8 }, noMounts: ['launcher'] },
          ],
          objectives: [
            { id: 'n', text: 'Neutralise ISV Tamarind before she crosses the escape line', type: 'neutralize', targets: ['tamarind'] },
            { id: 'esc', text: 'ISV Tamarind stays inside 60 000 km', type: 'escapeFail', ship: 'tamarind', point: { x: 0, y: 0 }, range: km(60000), hidden: true },
          ],
          intro: [say('Lt. Ruiz, navigation', 'She will run until she thinks we have quit. Tamarind is a corvette at sixty per cent tanks, so she cannot afford this any more than we can.')],
          triggers: [
            hintAt({ time: 2 }, 'h1', 'Tamarind is running and every minute costs you distance. Target her, read the Transfer estimate and press Intercept now. Leave Cruise on Fastest, because a capped approach leaves you coasting inside her reach while she makes for the line.', '#shipPanel'),
            { when: (sim) => { const t = sim.byId('tamarind'); return t && t.deltaV() < 27500 && !sim.flags.tamCoast; }, actions: [{ flag: 'tamCoast' }, { log: { speaker: 'Lt. Ruiz, navigation', text: 'Tamarind has cut her drive. She is coasting on the speed she has and holding the rest of her tanks back. Match that speed and beat it, then brake hard at the end.' } }] },
          ],
        };
      },
    },
    {
      n: 6, id: 'europa-line', title: 'The Europa Line', location: 'Europa orbit', date: '30 May 2211',
      brief: [
        'You are back over Europa with Larkspur, Anselm and Bastion, holding the line in front of Conamara Station. The Authority has given up on sieges. Two Lancer-class carriers are inbound with a frigate for escort.',
        'A Lancer never closes to beam range. She carries twenty-four interceptors, launches them from about 2 500 km out and leaves. An interceptor is a small craft with its own delta-v. Point defence can shoot it down, a ship can outrun it for a while, and killing the carrier stops any more coming.',
        'Bastion, Anselm and Larkspur are the line. Nothing reaches the station.',
      ],
      comms: [say('Capt. Oyelaran, JCS Bastion', 'Point defence will handle a few of them. It will not handle a salvo. Get to those carriers before they launch.')],
      // A Lancer killed while she is still loaded does not have empty bays, so the interceptors left are
      // counted off her mounts, and the station's radiators are read off the station.
      get victory() {
        const sim = endSim('The Europa Line');
        if (!sim) return 'Both Lancers are out of the fight and nothing reached Conamara Station.';
        const st = sim.byId('conamara');
        const left = baysLeft(sim.byId('l1')) + baysLeft(sim.byId('l2'));
        const bays = left ? left + (left === 1 ? ' interceptor was' : ' interceptors were') + ' still in their bays.' : 'Their bays were empty.';
        const rad = st && st.radiators && st.radiators.state > 0.9 ? 'Conamara still has its radiators out.'
          : 'Conamara has its radiators stowed, with its sink at ' + pctOf(st ? st.thermalLoad() : 0) + '.';
        return endedShort(sim, 'l1', 'Ardent') + '. ' + endedShort(sim, 'l2', 'Fervent') + '. ' + bays + ' ' + rad;
      },
      // The station can be lost, or the line in front of it can be, with the station still on the air.
      get defeat() {
        const sim = endSim('The Europa Line');
        const st = sim && sim.byId('conamara');
        if (st && !isOut(st) && ableShips(sim) === 0) {
          const live = sim.ships.filter((s) => s.faction !== sim.playerFaction && s.role !== 'station' && !isDone(s)).length;
          return 'Larkspur, Anselm and Bastion are out of the fight in front of Conamara Station. The station is still on the air.' +
            (live ? ' ' + COUNT[live] + (live === 1 ? ' Authority ship is' : ' Authority ships are') + ' still over it.' : '');
        }
        return 'Conamara Station has stopped transmitting.';
      },
      build() {
        const body = B.europa;
        return {
          name: 'The Europa Line', body, sunAngle: 0.2, playerFaction: 'JC',
          ships: [
            { id: 'conamara', name: 'Conamara Station', cls: 'station', faction: 'JC', orbit: { altitude: km(2400), angle: 0 }, ai: true },
            { id: 'larkspur', name: 'JCS Larkspur', cls: 'corvette', faction: 'JC', player: true, crew: { xp: 2 }, orbit: { altitude: km(2400), angle: 0.03 } },
            { id: 'anselm', name: 'JCS Anselm', cls: 'frigate', faction: 'JC', player: true, crew: { xp: 2 }, orbit: { altitude: km(2400), angle: 0.05 } },
            { id: 'bastion', name: 'JCS Bastion', cls: 'destroyer', faction: 'JC', player: true, crew: { xp: 2 }, orbit: { altitude: km(2400), angle: 0.07 } },
            { id: 'l1', name: 'ISV Ardent', cls: 'lancer', faction: 'ISA', ai: true, orbit: { altitude: km(6000), angle: 0.55 }, propFraction: 0.9 },
            { id: 'l2', name: 'ISV Fervent', cls: 'lancer', faction: 'ISA', ai: true, orbit: { altitude: km(6300), angle: 0.6 }, propFraction: 0.9 },
            { id: 'f1', name: 'ISV Tenacity', cls: 'frigate', faction: 'ISA', ai: true, orbit: { altitude: km(5800), angle: 0.5 }, propFraction: 0.8 },
          ],
          objectives: [
            { id: 'p', text: 'Conamara Station survives', type: 'protect', ship: 'conamara' },
            { id: 'n', text: 'Neutralise all Authority ships', type: 'neutralize', targets: 'hostiles' },
          ],
          intro: [say('Capt. Oyelaran, JCS Bastion', 'Point defence will handle a few of them. It will not handle a salvo. Get to those carriers before they launch.')],
          triggers: [
            hintAt({ time: 2 }, 'h1', 'The Lancers will hold about 2 500 km and leave once their bays are empty. Send Larkspur after them now, while they are still loaded. Bastion can stay with the station.', '#fleetList'),
            hintAt((sim) => inbound(sim, 'interceptor'), 'h2', 'Interceptors are inbound, drawn red on the map with a countdown and a ring closing on the ship they are aimed at. The Threats band says whether her point defence can stop them in time, and the teal ring is how far that point defence reaches. Stow the radiators with X before they arrive, if the sink can take it.', '#shipPanel'),
            hintAt((sim) => sim.time > 20 && hasAction(sim, 'launch2'), 'h3', 'Your bays never reload during a fight. Launch 2, Launch 4 or all of them with L, shift-L or A once the target is inside the blue launch ring. Their point defence stops a few a minute inside its red ring, and the line under each key says how many should get through, so send enough to beat it.', '#pEng'),
          ],
        };
      },
    },
    {
      n: 7, id: 'harkness', title: 'Harkness', location: 'Jupiter high orbit, 400 000 km', date: '21 June 2211',
      brief: [
        'You are in high Jupiter orbit, 400 000 km out, where an Authority squadron has taken station to cut the moons off from each other. Two destroyers, two frigates and two corvettes. Admiral Marr has given you the task group and the cruiser JCS Harkness to break it with.',
        'Harkness is the Compact\'s only capital ship. Four main lasers behind mirrors 1.6 m across, and 70 cm of armour on the nose. She has not left dock since the Declaration, because the Compact cannot replace her. Losing the traffic between the moons would cost it more. Bring her out, and bring her back.',
      ],
      comms: [say('Adm. Marr, JCS Harkness', 'Commander, she is yours for the day. Her four main lasers burn through armour from farther out than anything they have, so hold that range. Her nose carries 70 cm and her tail carries 12. Do not let a destroyer behind her.')],
      // Armour does not ablate, so what Harkness came home with is her hull integrity, and a hull that
      // broke off and ran is counted as one that ran, not as a wreck.
      get victory() {
        const sim = endSim('Harkness');
        const tail = ' The moons can talk to each other again.';
        if (!sim) return 'The squadron is broken and Harkness is on her way back to Callisto.' + tail;
        const h = sim.byId('harkness');
        const ran = ['e1', 'e2', 'e3', 'e4', 'e5', 'e6'].filter((id) => { const s = sim.byId(id); return s && s.drivenOff && !isOut(s); }).length;
        const hark = h && h.hull < 0.995 ? ' Harkness is on her way back to Callisto at ' + pctOf(h.hull) + ' hull integrity.'
          : ' Harkness is on her way back to Callisto with nothing through her armour.';
        return 'The squadron is broken.' + (ran ? ' ' + COUNT[ran] + ' of the six broke off and ran past 1 500 km.' : '') + hark + tail;
      },
      // Harkness is the protect objective, so this chapter is only lost with her out of the fight.
      get defeat() {
        const sim = endSim('Harkness');
        const h = sim && sim.byId('harkness');
        const tail = ' The Compact has no other cruiser and no yard out here that could build one.';
        if (h && h.captured) return 'Harkness was boarded and taken in high Jupiter orbit.' + tail;
        if (h && h.disabled && !h.destroyed) return 'Harkness is adrift in high Jupiter orbit at ' + pctOf(h.hull) + ' hull integrity, with the squadron still around her.' + tail;
        return 'Harkness is lost.' + tail;
      },
      build() {
        const body = B.jupiter;
        const alt = km(400000);
        return {
          name: 'Harkness', body, sunAngle: -1.4, playerFaction: 'JC',
          ships: [
            { id: 'harkness', name: 'JCS Harkness', cls: 'cruiser', faction: 'JC', player: true, crew: { xp: 2 }, orbit: { altitude: alt, angle: 0 } },
            { id: 'bastion', name: 'JCS Bastion', cls: 'destroyer', faction: 'JC', player: true, crew: { xp: 2 }, orbit: { altitude: alt, angle: 0.0006 } },
            { id: 'anselm', name: 'JCS Anselm', cls: 'frigate', faction: 'JC', player: true, crew: { xp: 2 }, orbit: { altitude: alt, angle: -0.0006 } },
            { id: 'larkspur', name: 'JCS Larkspur', cls: 'corvette', faction: 'JC', player: true, crew: { xp: 2 }, orbit: { altitude: alt, angle: 0.0012 } },
            { id: 'e1', name: 'ISV Coriolis', cls: 'destroyer', faction: 'ISA', ai: true, orbit: { altitude: alt + km(900), angle: 0.004 }, propFraction: 0.9 },
            { id: 'e2', name: 'ISV Meridian', cls: 'destroyer', faction: 'ISA', ai: true, orbit: { altitude: alt + km(1100), angle: 0.0046 }, propFraction: 0.9 },
            { id: 'e3', name: 'ISV Tenacity', cls: 'frigate', faction: 'ISA', ai: true, orbit: { altitude: alt + km(700), angle: 0.0052 }, propFraction: 0.85 },
            { id: 'e4', name: 'ISV Vigil', cls: 'frigate', faction: 'ISA', ai: true, orbit: { altitude: alt + km(1300), angle: 0.0034 }, propFraction: 0.85 },
            { id: 'e5', name: 'ISV Sabre', cls: 'corvette', faction: 'ISA', ai: true, orbit: { altitude: alt + km(600), angle: 0.006 }, propFraction: 0.9 },
            { id: 'e6', name: 'ISV Lark', cls: 'corvette', faction: 'ISA', ai: true, orbit: { altitude: alt + km(1500), angle: 0.0062 }, propFraction: 0.9 },
          ],
          objectives: [
            { id: 'n', text: 'Neutralise the Authority squadron', type: 'neutralize', targets: 'hostiles' },
            { id: 'p', text: 'JCS Harkness survives', type: 'protect', ship: 'harkness' },
          ],
          intro: [say('Adm. Marr, JCS Harkness', 'Commander, she is yours for the day. Her four main lasers burn through armour from farther out than anything they have, so hold that range. Do not let a destroyer behind her.')],
          triggers: [
            hintAt((sim) => sim.time > 45 && !!(E() && E().reach), 'h3', 'The ticks on the line to the target are the burn-through ranges. The teal tick is where Harkness\'s beams burn through the armour they are pointed at. The red tick is where theirs burn through hers. Hold the range between the two and only one side is doing damage.', '#shipPanel'),
            hintAt({ time: 2 }, 'h1', 'Four ships against six, so do not spread them. Shift-click all four in the list, type 300 in the Range box, and put every beam on the nearest Authority ship until she is out of the fight. Then the next one. Keep Harkness nose-on, because her nose carries 70 cm of armour and her flanks carry 28.', '#fleetList'),
          ],
        };
      },
    },
    {
      n: 8, id: 'declaration', title: 'Declaration', location: 'Amalthea, Jupiter orbit 181 000 km', date: '9 July 2211',
      brief: [
        'You are at Amalthea, 181 000 km above Jupiter, with Harkness, the destroyers Bastion and Marrow, Anselm and Larkspur. The Authority flagship ISV Concordance is here with everything her squadron has left. A destroyer, two frigates and two Lancers.',
        'Her admiral has asked the Compact, formally, to withdraw the Declaration. Callisto answered with the position of this task group. Concordance is a cruiser built on the same lines as Harkness. Same four main lasers, same 70 cm nose, same heat sink. Her beams burn through at the range yours do, and her sink holds as much heat as yours.',
        'Neutralise Concordance. The rest of her squadron is yours to take or leave, and the Compact would like Harkness back in one piece.',
      ],
      comms: [say('Adm. Marr, JCS Harkness', 'If Concordance strikes, the Authority has nothing left out here. Take your time, Commander.')],
      // Nothing in the sim strikes her colours, so the line says how she actually left the fight.
      get victory() {
        const sim = endSim('Declaration');
        const tail = ' What the Authority has left out here is burning for the inner system. The Declaration stands.';
        if (!sim) return 'Concordance is out of the fight.' + tail;
        return endedAs(sim, 'concordance', 'Concordance') + tail;
      },
      // Harkness is the protect objective, so this chapter is only lost with her out of the fight.
      get defeat() {
        const sim = endSim('Declaration');
        const h = sim && sim.byId('harkness');
        const tail = ' The Declaration will be withdrawn by the autumn.';
        if (h && h.captured) return 'Harkness was boarded and taken at Amalthea, and the Compact has nothing left to keep the Authority out of Jovian orbit.' + tail;
        if (h && h.disabled && !h.destroyed) return 'Harkness is adrift at Amalthea at ' + pctOf(h.hull) + ' hull integrity, and the Compact has nothing left to keep the Authority out of Jovian orbit.' + tail;
        return 'Harkness is gone, and the Compact has nothing left to keep the Authority out of Jovian orbit.' + tail;
      },
      build() {
        const body = B.jupiter;
        const alt = km(181000);
        return {
          name: 'Declaration', body, sunAngle: 0.9, playerFaction: 'JC',
          ships: [
            { id: 'harkness', name: 'JCS Harkness', cls: 'cruiser', faction: 'JC', player: true, crew: { xp: 2 }, orbit: { altitude: alt, angle: 0 } },
            { id: 'bastion', name: 'JCS Bastion', cls: 'destroyer', faction: 'JC', player: true, crew: { xp: 2 }, orbit: { altitude: alt, angle: 0.0012 } },
            { id: 'marrow', name: 'JCS Marrow', cls: 'destroyer', faction: 'JC', player: true, crew: { xp: 2 }, orbit: { altitude: alt, angle: -0.0012 } },
            { id: 'anselm', name: 'JCS Anselm', cls: 'frigate', faction: 'JC', player: true, crew: { xp: 2 }, orbit: { altitude: alt, angle: 0.0024 } },
            { id: 'larkspur', name: 'JCS Larkspur', cls: 'corvette', faction: 'JC', player: true, crew: { xp: 2 }, orbit: { altitude: alt, angle: -0.0024 } },
            { id: 'concordance', name: 'ISV Concordance', cls: 'cruiser', faction: 'ISA', ai: true, orbit: { altitude: alt + km(1500), angle: 0.012 }, propFraction: 0.85 },
            { id: 'e1', name: 'ISV Meridian', cls: 'destroyer', faction: 'ISA', ai: true, orbit: { altitude: alt + km(1200), angle: 0.0135 }, propFraction: 0.85 },
            { id: 'e2', name: 'ISV Tenacity', cls: 'frigate', faction: 'ISA', ai: true, orbit: { altitude: alt + km(1900), angle: 0.011 }, propFraction: 0.8 },
            { id: 'e3', name: 'ISV Vigil', cls: 'frigate', faction: 'ISA', ai: true, orbit: { altitude: alt + km(2100), angle: 0.0145 }, propFraction: 0.8 },
            { id: 'e4', name: 'ISV Ardent', cls: 'lancer', faction: 'ISA', ai: true, orbit: { altitude: alt + km(4000), angle: 0.016 }, propFraction: 0.9 },
            { id: 'e5', name: 'ISV Fervent', cls: 'lancer', faction: 'ISA', ai: true, orbit: { altitude: alt + km(4200), angle: 0.009 }, propFraction: 0.9 },
          ],
          objectives: [
            { id: 'n', text: 'Neutralise ISV Concordance', type: 'neutralize', targets: ['concordance'] },
            { id: 'p', text: 'JCS Harkness survives', type: 'protect', ship: 'harkness' },
            { id: 'all', text: 'Neutralise every Authority ship', type: 'neutralize', targets: 'hostiles', optional: true },
          ],
          intro: [say('Adm. Marr, JCS Harkness', 'If Concordance strikes, the Authority has nothing left out here. Take your time, Commander.')],
          triggers: [
            hintAt({ time: 2 }, 'h1', 'Concordance carries 70 cm of nose armour, and beams from 800 km will not burn through it. Shift-click the whole fleet, type 300 in the Range box, and take her escorts nearest first. Then put every beam on Concordance.', '#fleetList'),
          ],
        };
      },
    },
  ];

  // ---------------------------------------------------------------- the war, in plain words
  // Shown on the bridge console's `situation` screen before chapter 1, from the chapters screen and from the
  // pause screen during a story chapter. Three short paragraphs: who you are, who you are fighting, what is at
  // stake. main.js renders them as the screen's paragraphs.
  const situation = [
    'You are Commander Halvorsen of the Jovian Compact, and the corvette JCS Larkspur is your ship.',
    'In March 2211 the moons of Jupiter signed the Declaration and left the Inner Systems Authority, which had run them as a customs territory, taxing what they shipped inward and setting the price of their own ice.',
    'The Authority wants that income back. It began by stopping Compact ships for inspection. That is now a blockade. If it holds, the moons cannot trade with each other or buy the reactors and parts only the inner system builds.',
  ];

  // The two sides, for the same screen. One line each, in the player's terms.
  const sides = [
    { faction: 'JC', name: 'Jovian Compact', text: 'You. Callisto, Ganymede, Europa and Io, with one cruiser and a handful of escorts. You want the Declaration to stand.' },
    { faction: 'ISA', name: 'Inner Systems Authority', text: 'Them. Earth and Mars, with a squadron of a few dozen ships out here. They want the tariff income back.' },
  ];

  // What one chapter's result changed for the war: one sentence per chapter and outcome.
  const WAR = {
    1: {
      victory: 'Long Meridian is back at Valhalla Station, so the Compact still has the tanker that moves its propellant.',
      defeat: 'Long Meridian came down on Callisto, and the Compact is one tanker short of moving its own propellant.',
      // the other way to lose it: the escort is gone and the tanker is still falling
      larkspur: 'Larkspur was lost over Callisto, and the Compact is short a corvette and the tanker that moves its propellant.',
    },
    2: {
      victory: 'The convoy came through, and the Compact has now fired on an Authority warship for the first time.',
      prize: 'The convoy came through and Sabre was taken as a prize, the first Authority warship the Compact has boarded.',
      // she broke off and ran instead: hurt, but still the Authority's
      driven: 'The convoy came through and Sabre ran for repairs, so the Authority has no picket over Ganymede this week.',
      defeat: 'The convoy was lost, and the Authority can tell the inner planets that its inspections stopped a Compact attack.',
      // the other way to lose it: the escort is gone and the convoy is still out there
      larkspur: 'The Compact is a corvette down over Ganymede, and the Authority still has Sabre on the convoy route.',
    },
    3: {
      victory: 'Conamara Station has its radiators out again, so Ganymede is still getting water from Europa.',
      defeat: 'Conamara Station is gone, and half of Ganymede is on rationed water.',
      // the station held and the ships in front of it did not
      ships: 'Conamara Station is still stowed under Authority guns, and the Compact has no ships left over Europa.',
    },
    4: {
      victory: 'The Io approaches are open, and Authority destroyers have stopped shooting at haulers holding a straight course.',
      // driven off rather than wrecked: she is flying, and she will be back when her yard is done with her
      driven: 'Coriolis broke off hurt and left the Loki approach, so Compact haulers can use it until she is repaired.',
      defeat: 'Coriolis still holds the Io approaches, and Compact haulers are going the long way round.',
      // Coriolis is out of it too, and Larkspur did not come home
      coriolis: 'Coriolis is out of the fight off Io, and the Compact paid for the Loki approach with Larkspur.',
    },
    5: {
      victory: 'Tamarind was caught inside the escape line, so Authority raiders now have to assume a Compact ship will follow them out.',
      defeat: 'Tamarind got away with Kestrel Moon\'s cargo, and the Authority is fitting out more raiders.',
      // the chase ended with Larkspur out of the fight and the raider still inside the line
      larkspur: 'Larkspur is out of the fight in deep space, and Tamarind still has Kestrel Moon\'s cargo.',
    },
    6: {
      victory: 'Conamara is still on the air behind the line, and the Authority has run out of cheap ways to break it.',
      defeat: 'Conamara Station is off the air, and Europa\'s ice is out of Compact reach.',
      // the station held and the line in front of it did not
      ships: 'The line in front of Conamara is gone, and the Compact cannot put another one there this month.',
    },
    7: {
      victory: 'The squadron in high Jupiter orbit is broken, so the moons can supply each other again.',
      defeat: 'Harkness is lost, and the Compact has no capital ship and no way past the squadron.',
      // adrift is not the same as gone: she is a hull the Authority now has to decide what to do with
      adrift: 'Harkness is adrift in high Jupiter orbit, and the Compact has no way past the squadron to reach her.',
    },
    8: {
      victory: 'Concordance is out of the fight, the Authority\'s ships left for the inner system, and the Declaration stands.',
      defeat: 'Harkness is gone with the task group, and the Compact has nothing left to defend the Declaration with.',
      adrift: 'Harkness is adrift at Amalthea, and the Compact has nothing left to defend the Declaration with.',
    },
  };
  // warSoFar(n, outcome) -> one sentence, or '' when the chapter or the outcome is unknown.
  function warSoFar(n, outcome) {
    const row = WAR[n];
    if (!row) return '';
    const win = outcome === 'victory';
    // The fight this line is about, when it is still there to read. Every alternate row below needs one
    // fact off it to be true, so with no sim the chapter's plain row is what prints.
    const sim = endSim((chapters[n - 1] || {}).title);
    const foe = (id) => (sim ? sim.byId(id) : null);
    // Chapter 1: the tanker on the surface, or the escort gone with the tanker still falling.
    if (n === 1 && !win) { const m = foe('meridian'); if (m && !m.destroyed && isOut(foe('larkspur'))) return row.larkspur; }
    // Chapter 2 has three wins: Sabre adrift, Sabre taken, or Sabre driven off the convoy route.
    if (n === 2 && win) {
      const s = foe('sabre');
      if (s && s.captured) return row.prize;
      if (s && s.drivenOff && !isOut(s)) return row.driven;
    }
    // And two losses: the convoy, or the escort. The debrief body is picked the same way.
    if (n === 2 && !win && ch2Loss() === 'larkspur') return row.larkspur;
    // Chapter 3: the station held and our ships did not.
    if (n === 3 && !win) { const st = foe('conamara'); if (st && !isOut(st) && ableShips(sim) === 0) return row.ships; }
    // Chapter 4: driven off is not wrecked, and a loss with Coriolis out of it cost us Larkspur.
    if (n === 4 && win) { const c = foe('coriolis'); if (c && c.drivenOff && !isOut(c)) return row.driven; }
    if (n === 4 && !win) { const c = foe('coriolis'); if (isDone(c)) return row.coriolis; }
    // Chapter 5: the raider is still inside the line and we have nothing left to chase her with.
    if (n === 5 && !win) { const t = foe('tamarind'); if (t && !isDone(t) && ableShips(sim) === 0) return row.larkspur; }
    // Chapter 6: the station is still on the air and the line in front of it is gone.
    if (n === 6 && !win) { const st = foe('conamara'); if (st && !isOut(st) && ableShips(sim) === 0) return row.ships; }
    // Chapters 7 and 8: Harkness adrift is a hull that still exists.
    if ((n === 7 || n === 8) && !win) { const h = foe('harkness'); if (h && h.disabled && !h.destroyed && !h.captured) return row.adrift; }
    return row[win ? 'victory' : 'defeat'] || '';
  }

  OD.Story = { chapters, situation, sides, warSoFar };
})();
