/* Orbital Declaration — the decision layer (OD.Decisions).

   The trade-offs were always in the sim: range against armour, heat against exposure, propellant
   against time, a salvo now against a salvo in the next fight. They never reached the bridge,
   because nothing ever asked. This module watches the player's ships, recognises the handful of
   moments in an engagement where a real choice exists, and puts the choice in the player's path:
   a title, one plain sentence, two or three keys with their consequence in words and numbers, and
   the navigator's pick lit. The keys act through the orders and the fire control that already
   exist — setOrder, setRadiators, the fire mode, the aim point, the bays, the active sensor — so
   there is nothing new to learn beyond read, choose, watch.

   Two rules govern the recommendation, because four reviewers played the lit option and only the
   lit option, and the band lost them fights it should have won. First: while an objective says to
   neutralise the hull in front of us and the fight is winnable, or while a ship we are here to
   protect has something inbound, the navigator never points at opening the range, sitting still or
   breaking off. Second: no option is offered whose benefit is inside the noise, and no number is
   printed that the sim cannot stand behind.

   Everything outside this file is reached through a typeof check: without the engagement module or
   the sensor model, the kinds that need them are simply never raised, and the interfaces the other
   modules are growing (the 'approach' order, the sink forecast, the boarding numbers) are used when
   they are there and quietly worked around when they are not. */
(function () {
  'use strict';
  const OD = window.OD;
  const U = OD.U;

  const T = {
    cooldown: 600,        // s before the same (ship, kind) may be asked again
    cooldownMax: 4800,    // s the doubling stops at: a kind the player keeps waving off goes quiet
    evaluate: 2,          // s between trigger passes for one ship
    detail: 1,            // s between detail refreshes on the open decisions
    life: 300,            // s an unanswered question stays on the band before the moment has passed
    minLife: 35,          // s a card is left on the band before its own situation test can close it
    slugGrace: 90,        // s the jink question stays up after a volley lands, while the gun still bears
    jinkRead: 12,         // s to the round under which the question cannot be read and flown: 10 s to read it, 2 s of burst
    jinkBurst: 2,         // s of lateral thrust a dodge gets before it is coasting sideways
    jinkLengths: 2,       // hull lengths of drift the sim scores a slug as a miss by
    planTtl: 6,           // s a look-ahead answer is reused for (the countdown still ticks)
    openPerShip: 2,       // open decisions one hull may carry at once
    collapseMax: 4,       // hulls one card may speak for
    otherShip: 60,        // s a question for a hull the bridge is not flying waits its turn
    freighterQuiet: 60,   // s before an AI-flown hauler is asked anything at all
    minBenefit: 0.10,     // an option that moves a number by less than this is not a choice
    biteMemory: 60,       // s a burn-through reading stands: a spinal mount only bears now and then
    trackMemory: 30,      // s the worst reading of a track stands, so a flickering picture is not a strobe
    approachStart: 15,    // s after a start before the first 'how do we close' question
    // 'Hold and watch' is an answer with a clock on it. Ten dead minutes at a thousand kilometres
    // is what the full cooldown bought the reviewers, so a hold is re-asked on this instead, and
    // again every time it is answered the same way. Dismissal still doubles the ordinary cooldown.
    holdAgain: 120,       // s before a question answered 'hold and watch' is put again
    quietFight: 240,      // s of a falling hull with nothing on the band before the questions come back
    approachFar: 1000e3,  // m: a hostile farther out than this is an approach, whatever the reach
    // × the larger burn-through reach outside which a hull that is holding is not in the fight at
    // all. The contract said 2.5, which left a ship parked just outside everyone's guns with no
    // order and nothing to answer: twenty minutes of dead air, which is what the reviewers found.
    approachReach: 1.05,
    coastSpeed: 1500,     // m/s cruise cap for the quiet approach
    sensorReach: 1.5,     // × our burn-through reach: close enough that aiming matters
    sensorQ: 2.7,         // reported track quality under which the mounts hold: no solution to aim by
    solutionQ: 2.7,       // and at which one is held and the question has answered itself (Sensors.T.solutionQ)
    sensorPatience: 120,  // s: a passive solution nearer than this arrives before the question is read
    activeEta: 20,        // s for the active sensor to resolve a solution
    burningThrottle: 0.02, // throttle above which the plume is the only signature that matters
    plumeShare: 0.5,      // plume fraction of the signature at which we are pinned whatever else we do
    panelShare: 0.4,      // radiator fraction of the signature at which the panels are worth stowing
    radiatorReach: 1.3,   // × their burn-through reach against us: close enough to lose the panels
    radiatorLoad: 0.9,    // sink fraction above which stowing is no longer a choice
    radiatorPatience: 240, // s (4 min) of sink the stow has to buy
    rangeBand: 1.15,      // within 15 % above the larger bite is where the range is decided
    rangeLapse: 1.6,      // × outside which the question has answered itself
    together: 300e3,      // m inside which a sister ship is close enough to be in the same fight
    ladderEdge: 1.3,      // × our bite over theirs that makes the wrong rung of the ladder a question
    hullWarn: 0.85,       // hull fraction under which a fast loss is a question before the half
    hullSoon: 90,         // s: a hull that will cross the withdraw line this soon is asked now
    homeSoon: 240,        // and the same for a hull the board says comes home, who needs the time
    salvoMin: 2,          // interceptors aboard before the bays are worth a question
    salvoMax: 12,         // the largest salvo size the saturation search will walk up to
    salvoWait: 360,       // s (6 min): a sink that fills sooner than this is worth waiting for
    crippleRange: 300e3,  // m inside which a crippled hostile is a prize
    driveWrecked: 0.1,    // systems.drive at or under this is no drive at all
    heatLoad: 0.8,        // sink fraction at which full beams become a question
    heatClear: 0.7,       // and under which the question has answered itself
    heatForecast: 600,    // s: a sink that full beams fill this soon is the same question, early
    // Where a sink settles is capped by the radiator law's knee (P.SINK_KNEE): at the knee the
    // panels are already at their design temperature, so no heat in can settle a sink above it. A
    // settle threshold written as an absolute load (0.85, against a knee of 0.6) is a threshold
    // that never fires, which is what silenced the heat question. Every one of them is now a
    // fraction of the knee and moves with it.
    settleShare: 0.9,     // x the knee: a sink the panels hold under this is normal running
    sustainedMin: 0.15,   // beams throttled under this share are not a way to keep fighting
    panelGrace: 60,       // s: one kind owns the panels at a time, and this is how long it holds them
    defendGrace: 60,      // s after a question about closing on her is answered before defend speaks
    withdrawHull: 0.5,    // hull fraction at which a hull is asked whether to stay in the fight
    withdrawFull: 0.8,    // hull fraction above which only a short armour clock is a question
    withdrawClock: 180,   // s of armour left that makes a hull above that fraction a question
    withdrawClear: 0.62,  // and above which the question has answered itself
    winning: 2.5,         // our fighting weight over theirs above which the fight is nearly won
    breakOpen: 1.25,      // x her burn-through we want to be outside once we have broken off
    // A break-off is only cover if it gets us outside her guns while there is still a hull to
    // cover. Both halves are timed: how long the opening speed needs to clear her burn-through, against
    // how long this hull lasts at the rate it is losing armour. Past either, the burn buys
    // distance and the card says so instead of calling it cover.
    coverHorizon: 600,    // s inside which breaking off has to clear her bite to be worth calling cover
    dyingSoon: 240,       // s of armour left under which staying in it is the option that ends the mission
    fireFloor: 20,        // s the ordnance already in the sky is spread over, at the least
    boardWindow: 300,     // s to be alongside and aboard while anything of hers is still shooting
    salvoShare: 0.34,     // arrivals per interceptor spent under which a launch is a magazine thrown away
    salvoLife: 0.35,      // share of an interceptor's endurance a flight may book before the coast bleeds it
    breakBurn: 150,       // s: the longest a break-off burn runs before the drive goes out again
    breakLoad: 0.85,      // and the sink load that burn is never allowed to cross
    reArm: 0.85,          // sink load whose crossing re-arms the heat questions, cooldown or not
    gunsCold: 0.6,        // and the load under which cold mounts are a question again
    sinkHot: 0.95,        // our own sink at or above this is a question of its own
    sinkClear: 0.8,       // and under this it has answered itself
    // A sink this full is not a question with a cooldown: the drive is capped to a quarter and the
    // mounts are inhibited, so the hull is out of the fight until somebody answers. The reviewers
    // watched a hull sit locked like this for eighty minutes with nothing on the band.
    sinkLock: 0.98,       // load at or above which the hull is locked and the question cannot wait
    lockRepeat: 120,      // s between re-raises while the lock holds, cooldown or no cooldown
    stowFloor: 900,       // s (15 min): a stow whose panels-in forecast fills sooner is never lit
    theirSink: 0.99,      // her sink at or above this: she has stopped answering
    aimThird: 0.34,       // her hull under a third: her panels are not worth the shot any more
    aimSoon: 120,         // s: a sink that fills this soon does not need our beams to fill it
    defendEta: 600,       // s of inbound flight time that still counts as an attack on a charge
    screenRange: 6e3,     // m we sit off a ship we are screening, well inside our own point defence
    outgunned: 0.6,       // our fighting weight over theirs, under which breaking off is honest
    aimQ: 2.7,            // the solution the aim-point question needs
    // A 3-a-side skirmish put 29 cards up in 43 minutes: withdraw six times, three of them on one
    // frigate, and three heat cards in 66 s across two hulls. A kind gets a few turns at a hull
    // and has then said what it has to say; a kind put to one hull waits before it is put to the
    // next; and a hull the player has waved off twice about a kind is not asked about it again.
    holdMargin: 120,      // s a 'hold at X' has to stay outside her beams to count as outside them
    supportSoon: 150,     // s inside which the rest of the group is in this fight with us
    askCap: 3,            // cards of one kind about one hull before that kind goes quiet on her
    refusals: 2,          // dismissals of a kind for one hull before it goes quiet for the fight
    kindGap: 45,          // s between cards of the same kind for two different hulls
    withdrawGap: 240,     // s before another hull is asked whether to break off
    hullDrop: 0.2,        // armour lost since the last withdraw answer that puts the question again
    // ---- damage control and the crew (v13) ----
    // A crew card is a question the ship can answer for itself: after a minute the routine does
    // what it would have done anyway, says so in the log, and the card comes off the band. Nobody
    // has to micro-manage the parties to fly the ship.
    autoAssign: 60,       // s an unanswered repair, medical or burn card waits before the routine settles it
    hitWindow: 180,       // s after a part is hit that the question about it is still that hit's question
    woundedShare: 0.1,    // wounded past this share of the crew, with nobody in the sick bay, is a question
    // Wounded do not shoot, and neither does a party sent to look after them. The only thing
    // the wounded cost the fight directly is the floor: under a third fit, fire control and the
    // sensor watch both run at 70 % whatever the parties do. So a watch is worth giving up when
    // the crew is under that floor, and not for the count alone.
    medicalFloor: 0.34,   // fit share under which a watch is worth giving up for the wounded
    burnEdge: 0.05,       // g over a limit the drive has to want before the burn is a question
    burnWorth: 45,        // s the two rungs of a burn have to differ by to be two answers
    stationFactor: 0.7,   // what fire control or the sensor watch runs at with its party away
    // What a jury-rig has to put back on a part before it is worth a card. Under three tenths the
    // board's own Send a party button is the right place for it: a card is never free, because a
    // card on the band is another card off it.
    mendWorth: 0.3,       // hp a mend has to buy before a hurt part with no free hands is a question
    // A mend that lands long after the armour has gone is the withdraw card's moment, not the
    // parties'. Chapter 4 put a repair card and a medical card on a corvette with 36 s of hull
    // left, and she was out of the fight twenty seconds later.
    mendStall: 4,         // multiples of the hull's life past which a repair or medical card is not raised
    // A burn that holds the crew in the couches this long is a question by itself: nobody can work
    // a part, nobody can be carried to the sick bay, for the whole of it. Chapter 5 is flown at
    // 2.3 g for thirty-three minutes and never asked.
    strapLong: 600,       // s a burn over the working limit has to last before it is a question on its own
    // What a card tells the player about the hull's own clock is measured, never modelled: the
    // armour actually lost over the last minute of the fight. Chapter 2's card read 'about 3m 52s'
    // at 42 % of her hull; the corvette fought 684 s more and took the chapter at 35 %.
    trailSpan: 60,        // s of fight the armour clause is measured over
    trailStep: 5,         // s between the samples it is measured from
    crippleGap: 60,       // s between cards about one crippled hull, whoever is pointing at her
  };

  // ---- formatting: times as 'm ss' or 'h mm', ranges in km, delta-v labelled, power in MW or GW --
  const pad = (n) => (n < 10 ? '0' + n : '' + n);
  function time(s) {
    if (s == null || !isFinite(s)) return 'never';
    s = Math.max(0, Math.round(s));
    if (s < 60) return s + ' s';
    if (s < 3600) return Math.floor(s / 60) + 'm ' + pad(s % 60) + 's';
    return Math.floor(s / 3600) + 'h ' + pad(Math.floor((s % 3600) / 60)) + 'm';
  }
  const km = (m) => U.fmt.dist(Math.max(0, m || 0));
  // Two significant figures: what a fuzzy picture is worth, and the way the sensor log already
  // speaks. Nothing the plot is guessing at is ever printed to the kilometre.
  function sig2(v) {
    if (!isFinite(v) || v === 0) return 0;
    const m = Math.pow(10, Math.floor(Math.log10(Math.abs(v))) - 1);
    return Math.round(v / m) * m;
  }
  const km2 = (m) => U.fmt.dist(sig2(Math.max(0, m || 0)));
  // A budget is never a speed. Anything worth a burn reads in km/s and always carries its label.
  // A budget worked from a guess at the range is a guess at the budget, and says so.
  // A speed on a card is a speed anywhere else on it: 'coasting at 1503 m/s' beside its own
  // 'Δv about 3 km/s' is one number in two units. The shared formatter says 1.5 km/s in both.
  const spd = (v) => U.fmt.speed(Math.max(0, v || 0));
  const dv = (v, est) => {
    if (v == null || !isFinite(v)) return 'Δv —';
    const a = est ? 'about ' : '';
    return v >= 1000 ? 'Δv ' + a + U.fmt.dv(v) : 'Δv ' + a + Math.round(v) + ' m/s';
  };
  const power = (w) => {
    if (!isFinite(w)) return '—';
    const a = Math.abs(w);
    if (a >= 1e9) return Math.round(w / 1e8) / 10 + ' GW';
    if (a >= 1e7) return Math.round(w / 1e6) + ' MW';
    return Math.round(w / 1e5) / 10 + ' MW';
  };
  const pct = (f) => Math.round(U.clamp(f || 0, 0, 1) * 100) + ' %';
  // The radiator law's knee: the load at which the panels reach their design temperature, and so
  // the highest load any steady heat in can settle at. Every settle threshold is read off it.
  const knee = () => { const P = OD.P; const k = P && P.SINK_KNEE > 0 ? P.SINK_KNEE : 0.6; return U.clamp(k, 0.05, 1); };
  const settleHigh = () => knee() * T.settleShare;
  // Locked: the sink has saturated (or is a breath from it) and the hull is being flown at a
  // quarter throttle with her mounts inhibited. Nothing about that situation changes on its own,
  // which is exactly why the cooldown and the unchanged-text rule must not be allowed to sit on it.
  const loadOf = (ship) => (ship && typeof ship.thermalLoad === 'function' ? ship.thermalLoad() : 0);
  const sinkLocked = (ship) => !!ship && (loadOf(ship) >= T.sinkLock || !!ship.overheated || !!ship.weaponsInhibited);
  const NUMBERS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
  const count = (n) => (n >= 0 && n < NUMBERS.length ? NUMBERS[n] : String(n));
  const Count = (n) => { const w = count(n); return w.charAt(0).toUpperCase() + w.slice(1); };
  // A sink that never fills does not read 'full in never': this course does not fill it.
  const fullIn = (t) => (t == null ? 'the sink does not fill on this course' : 'the sink fills in ' + time(t));
  // Whatever the sink is actually doing, in one phrase, from a forecast. A sink that neither fills
  // nor empties settles somewhere, and where it settles is the number the bridge wants.
  const sinkPhrase = (v) => (v.tEmpty > 0 ? 'the sink drains in ' + time(v.tEmpty)
    : v.tEmpty != null ? 'the sink is empty'
    // A sink that is full already reads 'full in 0 s', which says nothing. What the bridge wants
    // from a saturated sink is where it goes next, which is the settle.
    : v.tFull > 0 ? 'the sink fills in ' + time(v.tFull)
      : v.settle != null ? 'the sink settles at ' + pct(v.settle)
        : v.tFull === 0 ? 'the sink stays full on this course' : 'the sink holds where it is');
  // A plan that does not close and a sink that never fills both read as words; a detail line with
  // no number in it is no use on the band, so the line falls back on one that is always there.
  const withNum = (line, fallback) => (/\d/.test(line) ? line : line + ' · ' + fallback);
  // A detail line is read in the second before the player presses a key. The first card a newcomer
  // meets ran to six clauses and 260 characters, which is a paragraph with a number in it. Three
  // clauses stay on the key; the rest goes behind the Why? key with the teaching paragraph.
  const DOT = ' · ';
  const CLAUSES = 3;
  const clausesOf = (detail) => String(detail || '').split(DOT).filter((c) => c !== '');
  const headOf = (detail) => clausesOf(detail).slice(0, CLAUSES).join(DOT);
  const tailOf = (detail) => clausesOf(detail).slice(CLAUSES).join(DOT);
  // A closing rate the plot can stand behind, in kilometres a minute: 'the range holds' was
  // printed while two orbits closed it seven kilometres a minute.
  // Below a solution the rate comes off the ghost's velocity, and that velocity carries an error
  // the card used to drop: '4.8 km a minute' was printed from a track whose own velocity error was
  // 203 m/s, which is 12 km a minute. So the rate carries the box, and where the box is wider than
  // the rate there is no rate to print — only how fast the plot could be wrong.
  function closingWords(ship, view) {
    const c = closingView(ship, view);
    const perMin = Math.abs(c) * 60 / 1000;
    const errMin = view && !view.solution && view.velErr > 0 ? view.velErr * 60 / 1000 : 0;
    const fig = (v) => (v >= 10 ? Math.round(v) : Math.round(v * 10) / 10);
    if (errMin >= Math.max(perMin, 0.5)) {
      return 'the plot cannot tell which way the range is moving: the track is good to \u00b1' +
        fig(errMin) + ' km a minute at ' + rangeSay(view);
    }
    if (!(perMin >= 0.5)) return 'the range holds at ' + rangeSay(view);
    const rate = fig(perMin) + ' km a minute' + (errMin > 0 ? ', \u00b1' + fig(errMin) : '');
    return c > 0 ? 'the two orbits close the range ' + rate + ' from ' + rangeSay(view)
      : 'the two orbits open the range ' + rate + ' from ' + rangeSay(view);
  }

  // ---- guarded reads of the other modules -----------------------------------------------------
  function classOf(ship) {
    const C = OD.Ships && OD.Ships.CLASSES ? OD.Ships.CLASSES : null;
    return (C && ship && C[ship.cls]) || null;
  }
  function civilian(ship) {
    if (!ship) return true;
    if (ship.faction === 'CIV' || ship.role === 'station' || ship.role === 'freighter') return true;
    const cls = classOf(ship);
    return !!(cls && cls.doctrine && cls.doctrine.civilian);
  }
  // A hull that cannot manoeuvre is never asked anything; a hauler under fire still is.
  function station(ship) {
    if (!ship) return true;
    if (ship.role === 'station') return true;
    const cls = classOf(ship);
    return !!(cls && cls.doctrine && cls.doctrine.stationary);
  }
  // Anything that shoots and counts in a fight, station or not: the weight of the two sides.
  const combatant = (s) => !!s && !s.destroyed && !s.captured && s.faction !== 'CIV' && s.role !== 'freighter';
  function reachOf(sim, ship, target) {
    const E = OD.Engagement;
    if (!E || typeof E.reach !== 'function') return null;
    try { return E.reach(sim, ship, target || null); } catch (e) { return null; }
  }
  // The facet of `subject` the `watcher` is looking at, when the engagement module can say.
  function facetOf(watcher, subject) {
    const E = OD.Engagement;
    if (E && E.shared && typeof E.shared.facetSeen === 'function') {
      try { return E.shared.facetSeen(watcher, subject); } catch (e) { /* fall through to the best case */ }
    }
    return null;
  }
  function biteOn(beams, facet) {
    if (!beams) return 0;
    if (facet && beams[facet] != null) return beams[facet];
    return Math.max(beams.nose || 0, beams.flank || 0, beams.tail || 0);
  }
  // A spinal mount bears for a few seconds at a time, so the ladder flickers between its reach and
  // nothing as the hulls swing. A decision is about what the guns can do at this range, not about
  // this instant, so keep the best reading of the last minute for each pair: { ours, theirs } in m.
  function bites(sim, ship, target) {
    const r = reachOf(sim, ship, target);
    const ours = biteOn(r && r.beams, facetOf(ship, target));
    const theirs = biteOn(r && r.their && r.their.beams, r && r.their ? r.their.facet : null);
    const st = state(sim);
    const k = ship.id + '|' + target.id;
    const rec = st.bite[k] || (st.bite[k] = { ours: 0, oursAt: -1e9, theirs: 0, theirsAt: -1e9 });
    if (ours >= rec.ours || sim.time - rec.oursAt > T.biteMemory) { rec.ours = ours; rec.oursAt = sim.time; }
    if (theirs >= rec.theirs || sim.time - rec.theirsAt > T.biteMemory) { rec.theirs = theirs; rec.theirsAt = sim.time; }
    return rec;
  }
  // Our reach against the thickest facet she can turn toward us. A range that only works while she
  // shows her tail is a range she cancels by turning, and 'Hold at 923 km' on a tail reading is how
  // a division spent twelve minutes out of the fight it was sent to win.
  function biteWorst(sim, ship, target) {
    const r = reachOf(sim, ship, target);
    const beams = r && r.beams;
    if (!beams) return 0;
    const vals = ['nose', 'flank', 'tail'].map((f) => (beams[f] > 0 ? beams[f] : 0));
    return Math.min.apply(null, vals);
  }
  function bayCount(ship) {
    const E = OD.Engagement;
    if (!E || !E.shared || typeof E.shared.bayCount !== 'function') return 0;
    try { return E.shared.bayCount(ship); } catch (e) { return 0; }
  }
  function salvoEstimate(sim, ship, target, n) {
    const E = OD.Engagement;
    if (!E || typeof E.salvoEstimate !== 'function') return null;
    try { return E.salvoEstimate(sim, ship, target, n); } catch (e) { return null; }
  }
  // The engagement module's own pool of rounds and interceptors: the threat list gives the
  // bearings and the countdowns, and these are the objects that carry the mass and the speed.
  function engPool(sim) {
    const E = OD.Engagement;
    if (!E || !E.shared || typeof E.shared.engOf !== 'function') return null;
    try { return E.shared.engOf(sim); } catch (e) { return null; }
  }
  function threatsOn(sim, ship) {
    const E = OD.Engagement;
    if (!E || typeof E.threats !== 'function') return null;
    try { return E.threats(sim, ship); } catch (e) { return null; }
  }
  function pdRatePerMin(ship) {
    const E = OD.Engagement;
    if (!E || typeof E.pdReport !== 'function') return 0;
    try { const r = E.pdReport(ship); return r ? r.ratePerMin || 0 : 0; } catch (e) { return 0; }
  }
  function pdReach() {
    const E = OD.Engagement;
    const v = E && E.tuning ? E.tuning.pdRange : 0;
    return v > 0 ? v : 20e3;
  }
  function dartLife() {
    const E = OD.Engagement;
    const v = E && E.tuning ? E.tuning.dartLife : 0;
    return v > 0 ? v : 700;
  }
  function fireModeOf(ship) {
    const E = OD.Engagement;
    if (!E || typeof E.fireMode !== 'function') return null;
    try { return E.fireMode(ship); } catch (e) { return null; }
  }
  function setFireMode(ship, mode) {
    const E = OD.Engagement;
    if (E && typeof E.setFireMode === 'function') { try { E.setFireMode(ship, mode); } catch (e) { /* the mode stays */ } }
  }
  function aimOf(ship) {
    const E = OD.Engagement;
    if (!E || typeof E.aim !== 'function') return 'hull';
    try { return E.aim(ship) || 'hull'; } catch (e) { return 'hull'; }
  }
  // What the beams open at, for an aim the ship is not carrying yet. A narrower aim point fills a
  // smaller patch, so it reaches less far: at 889 km chapter 4's hull ladder read nose 433 /
  // flank 685 km and the radiators ladder read 320 / 599, and the card that offered her radiators
  // there was offering a shot that lands nothing. reach() is keyed on the aim, so the aim is taken
  // for the length of the call and handed straight back.
  function reachForAim(sim, ship, target, aim) {
    const was = aimOf(ship);
    if (was === aim) return reachOf(sim, ship, target);
    let r = null;
    try { setAim(ship, aim); r = reachOf(sim, ship, target); } finally { setAim(ship, was); }
    return r;
  }
  function aimBite(sim, ship, target, aim) {
    const r = reachForAim(sim, ship, target, aim);
    return biteOn(r && r.beams, facetOf(ship, target));
  }
  function setAim(ship, aim) {
    const E = OD.Engagement;
    if (E && typeof E.setAim === 'function') { try { E.setAim(ship, aim); } catch (e) { /* the aim stays */ } }
  }
  function launchSalvo(sim, ship, n) {
    const E = OD.Engagement;
    if (E && typeof E.salvo === 'function') { try { E.salvo(sim, ship, n); } catch (e) { /* the bays keep what they have */ } }
  }
  function sustainedShare(ship) {
    const E = OD.Engagement;
    if (!E || !E.shared || typeof E.shared.sustainedScale !== 'function') return null;
    try { return E.shared.sustainedScale(ship); } catch (e) { return null; }
  }
  function hasKind(ship, kind) {
    for (const m of (ship && ship.mounts) || []) if (m.kind === kind) return true;
    return false;
  }
  const hasBeams = (ship) => hasKind(ship, 'beam');
  // The worst our picture of her has been in the last half-minute. A track that snaps back to a
  // solution every time she lights her drive is still not a track gunnery can plan around.
  function trackLow(sim, ship, target) {
    const q = qualityOf(sim, ship, target);
    const st = state(sim);
    const k = ship.id + '|q|' + target.id;
    const rec = st.track[k] || (st.track[k] = { q, at: sim.time });
    if (q <= rec.q || sim.time - rec.at > T.trackMemory) { rec.q = q; rec.at = sim.time; }
    return rec.q;
  }
  function qualityOf(sim, ship, target) {
    const S = OD.Sensors;
    if (!S || typeof S.quality !== 'function') return 3; // no sensor model: everything is a solution
    try { return S.quality(sim, ship, target); } catch (e) { return 3; }
  }
  function wordOf(sim, ship, target) {
    const S = OD.Sensors;
    if (!S || typeof S.track !== 'function') return 'solution';
    try { const tr = S.track(sim, ship.faction, target); return tr ? tr.word : 'contact'; } catch (e) { return 'contact'; }
  }
  // ---- what the bridge may honestly say about where she is -------------------------------------
  // Every range on the band about a hostile is read off our own track on her, never off the truth.
  // `OD.Sensors.track()` carries the ghost the plot is holding, the error box along the line of
  // sight and the quality of the picture. Below a solution the card quotes the ghost the way the
  // sensor log quotes it — two figures and a ± — and works its transfer, its delta-v and its
  // arrival from the same estimate, saying 'about' wherever it does. A card reading '1 042 km'
  // beside a panel reading '980 km ± 360 km' is two answers to one question, and the reviewers
  // read both in the same breath.
  function trackRange(sim, ship, target, from) {
    const here = from || (ship ? ship.pos : null);
    const out = { R: 0, err: 0, q: 3, word: 'solution', solution: true, pos: null, vel: null, trueR: 0, velErr: 0 };
    if (!ship || !target || !here) return out;
    out.pos = target.pos; out.vel = target.vel;
    out.R = out.trueR = Math.max(1, U.dist(here, target.pos));
    const S = OD.Sensors;
    if (!S || typeof S.track !== 'function') return out;
    let hostile = true;
    try { hostile = typeof sim.isHostile === 'function' ? !!sim.isHostile(target, ship) : true; } catch (e) { hostile = true; }
    if (!hostile) return out;
    let tr = null;
    try { tr = S.track(sim, ship.faction, target); } catch (e) { tr = null; }
    if (!tr) return out;
    out.q = tr.q;
    out.word = tr.word || out.word;
    out.velErr = tr.velErr > 0 ? tr.velErr : 0;
    const solQ = S.T && S.T.solutionQ > 0 ? S.T.solutionQ : T.solutionQ;
    out.solution = tr.q >= solQ;
    if (out.solution) return out;
    if (tr.est && tr.est.pos) { out.pos = tr.est.pos; out.R = Math.max(1, U.dist(here, tr.est.pos)); }
    if (tr.est && tr.est.vel) out.vel = tr.est.vel;
    out.err = Math.max(0, tr.rangeErr || tr.posErr || 0);
    return out;
  }
  // The range as a card may print it: exact only with a solution, otherwise the log's two figures
  // with the error box on them.
  function rangeSay(v) {
    if (!v) return km(0);
    if (v.solution) return km(v.R);
    return 'about ' + km2(v.R) + (v.err > 0 ? ', ±' + km2(v.err) : '');
  }
  // A distance or a time worked from a guess is a guess, and says so.
  const kmSay = (v, m) => (v && !v.solution ? 'about ' + km2(m) : km(m));
  const maybe = (v, text) => (v && !v.solution ? 'about ' + text : text);
  // How fast the gap is closing, off the same picture: the ghost's velocity while she is fuzzy.
  function closingView(ship, v) {
    if (!v || !v.pos) return 0;
    const rel = U.sub(v.pos, ship.pos);
    const d = U.len(rel);
    if (!(d > 1)) return 0;
    return U.dot(U.sub(ship.vel, v.vel || { x: 0, y: 0 }), U.scale(rel, 1 / d));
  }

  function signatureOf(ship) {
    const S = OD.Sensors;
    if (!S || typeof S.signature !== 'function') return null;
    try { return S.signature(ship); } catch (e) { return null; }
  }
  // seconds, or null for 'not at this range', or undefined when there is no sensor model
  function solutionEta(sim, ship, target) {
    const S = OD.Sensors;
    if (!S || typeof S.solutionEta !== 'function') return undefined;
    try { return S.solutionEta(sim, ship, target); } catch (e) { return undefined; }
  }
  function setActive(ship, on) {
    const S = OD.Sensors;
    if (S && typeof S.setActive === 'function') { try { S.setActive(ship, on); } catch (e) { /* the suite stays as it is */ } }
  }
  function isActive(ship) {
    const S = OD.Sensors;
    if (S && typeof S.isActive === 'function') { try { return !!S.isActive(ship); } catch (e) { return !!ship.activeSensor; } }
    return !!(ship && ship.activeSensor);
  }
  const burning = (ship) => !!ship && (ship.throttle || 0) > T.burningThrottle;
  // Our own plume is already the loudest thing about us: nothing we stow or switch off changes that.
  function pinnedByPlume(ship) {
    if (burning(ship)) return true;
    const sig = signatureOf(ship);
    return !!(sig && sig.total > 0 && sig.plume / sig.total > T.plumeShare);
  }
  // The range at which one passive suite resolves a firing solution on a hull showing this much,
  // straight off the sensor model's R_sol = S·√(P / 1 MW).
  function solutionRangeAt(observer, sigTotal) {
    const S = OD.Sensors;
    if (!S || !S.T || !observer) return 0;
    const sys = observer.systems && observer.systems.sensors != null ? observer.systems.sensors : 1;
    const base = (observer.sensorRange || 0) * sys * Math.sqrt(Math.max(sigTotal || 0, 1) / 1e6);
    const far = S.T.farFactor || 4, q = S.T.solutionQ || 2.7;
    return base * Math.pow(far, 1 - (q - 1) / 2);
  }
  // The range at which our own passive suite would resolve a firing solution on that hull.
  function passiveSolutionRange(ship, target) {
    const sig = signatureOf(target);
    return sig ? solutionRangeAt(ship, sig.total) : 0;
  }
  // The hostile that reads us first and can still do something about it. Sensors.seenFrom takes the
  // best suite on the board whether or not that hull can still shoot, and the cards then printed
  // the number against whichever hostile the card happened to be about: a skirmish fought at
  // 250 km carried 'ISV Assurance gets a solution on JCS Ferrous at 66 296 km' off a corvette that
  // had been adrift for ten minutes. A watcher that cannot act is not a cost.
  // `sigTotal` is the signature to price: what we are showing now, or what we would show after the
  // panels move.
  function watcher(sim, ship, sigTotal) {
    let best = null;
    let list = [];
    try { list = sim.hostiles(ship) || []; } catch (e) { list = []; }
    for (const h of list) {
      if (!h || h.destroyed || h.disabled || h.captured || civilian(h)) continue;
      const sol = Math.max(solutionRangeAt(h, sigTotal), isActive(h) ? (h.activeRange || 0) : 0);
      if (!(sol > 0)) continue;
      if (!best || sol > best.solution) best = { ship: h, name: h.name, solution: sol, at: U.dist(h.pos, ship.pos) };
    }
    return best;
  }
  // What a card may say about being read from a range. A solution range longer than the range she
  // is already at is not a distance a player can use — she reads us from where she is standing —
  // so that is what the clause says instead of a number sixty times the size of the fight.
  const seenAtWords = (eye) => (!eye ? ''
    : eye.solution >= eye.at ? 'from where she is, ' + km(eye.at) + ' off' : 'at ' + km(eye.solution));
  function seenWords(eye, verb) {
    return eye ? eye.name + ' ' + verb + ' ' + seenAtWords(eye) : '';
  }

  // ---- interfaces the other modules are growing ------------------------------------------------
  // Each is read through a feature test and worked around when it is not there yet, so this file
  // runs against today's build and picks the better answer up the moment it lands.
  let capApproach = null;
  function approachOrder() {
    if (capApproach != null) return capApproach;
    capApproach = false;
    const A = OD.Autopilot;
    if (A) {
      if (typeof A.knowsOrder === 'function') { try { capApproach = !!A.knowsOrder('approach'); } catch (e) { capApproach = false; } }
      else if (Array.isArray(A.ORDERS) && A.ORDERS.indexOf('approach') >= 0) capApproach = true;
      else if (typeof A.supports === 'function') { try { capApproach = !!A.supports('approach'); } catch (e) { capApproach = false; } }
      else if (typeof A.desired === 'function') {
        try { capApproach = /case\s*['"]approach['"]/.test(Function.prototype.toString.call(A.desired)); } catch (e) { capApproach = false; }
      }
    }
    return capApproach;
  }
  // The sink forecast, with the panel's design temperature passed as the sixth argument the moment
  // physics.js takes one: a freighter's panels top out at 900 K, a warship's at 1 000 K, and a
  // forecast run against the wrong ceiling is a forecast about another ship. Read by arity, so this
  // file runs against today's five-argument build and picks the better answer up when it lands.
  function forecastFn() {
    const a = OD.Physics, b = OD.P;
    const f = a && typeof a.sinkForecast === 'function' ? a.sinkForecast.bind(a)
      : b && typeof b.sinkForecast === 'function' ? b.sinkForecast.bind(b) : null;
    if (!f) return null;
    const peakAware = typeof f === 'function' && f.length >= 6;
    return (h, c, r, i, z, peak) => (peakAware ? f(h, c, r, i, z, peak) : f(h, c, r, i, z));
  }
  const hasForecast = () => !!forecastFn();
  function boardNumbers() {
    const B = OD.Sim && OD.Sim.BOARD ? OD.Sim.BOARD : null;
    return {
      range: B && B.range > 0 ? B.range : 3000,
      speed: B && B.speed > 0 ? B.speed : 40,
      time: B && B.time > 0 ? B.time : 90,
      odds: B && B.odds > 0 ? B.odds : 0,
    };
  }
  // What the sim charges for a boarding: how long the party is across, and whether the decks throw
  // it back. OD.Sim.boardingPlan is the one place that arithmetic lives, so the card, the tips and
  // the log all read the same numbers; without it the module falls back on the constants.
  function boardPlan(ship, target) {
    const B = boardNumbers();
    const S = OD.Sim;
    if (S && typeof S.boardingPlan === 'function') {
      try {
        const pl = S.boardingPlan(ship, target);
        if (pl && pl.time > 0) return pl;
      } catch (e) { /* fall through to the constants */ }
    }
    const ours = ship && ship.crew && ship.crew.fit > 0 ? Math.round(ship.crew.fit) : 0;
    const theirs = target && target.crew && target.crew.fit > 0 ? Math.round(target.crew.fit) : 0;
    const known = ours > 0 && theirs > 0;
    return {
      time: B.time * (known ? U.clamp(theirs / ours, 0.5, 4) : 1),
      thrownBack: known && B.odds > 0 && theirs > B.odds * ours,
      ours, theirs, known,
    };
  }
  // Whether the decks decide it before the party does. sim.js throws a boarding party back when
  // the defenders are more than BOARD.odds fit to one of ours, and that hull cannot be tried again
  // for ten minutes, so a card that recommends the run is recommending casualties. One source: the
  // plan above. With either crew unknown there is nothing to say.
  function boardOdds(ship, target) {
    const pl = boardPlan(ship, target);
    if (!pl.known) return null;
    return { ours: Math.round(pl.ours), theirs: Math.round(pl.theirs), beaten: !!pl.thrownBack };
  }
  // The panels' ceiling with them fully out: what they would shed with the sink hot, which is both
  // the price of extending them and the budget every forecast is run against. ship.radiatorRating()
  // is scaled by how far the panels are out, so a stowed hull reads zero there and the state has to
  // be taken back out before the number means 'what these panels are worth'.
  function ratingOf(ship) {
    if (!ship) return 0;
    const state = ship.radiators ? ship.radiators.state : 1;
    if (typeof ship.radiatorRating === 'function' && state > 0.01) {
      try { const r = ship.radiatorRating(); if (isFinite(r) && r > 0) return r / state; } catch (e) { /* fall through */ }
    }
    const P = OD.P;
    const sys = ship.systems && ship.systems.radiators != null ? ship.systems.radiators : 1;
    if (P && typeof P.radiatorPower === 'function') {
      try { return P.radiatorPower(ship.radiatorArea, ship.radiatorTemp) * sys; } catch (e) { /* fall through */ }
    }
    return typeof ship.radiatorPower === 'function' ? ship.radiatorPower() : 0;
  }
  const shedNow = (ship) => (typeof ship.radiatorPower === 'function' ? Math.max(0, ship.radiatorPower()) : 0);
  // What the ship makes at a given throttle, whatever it is doing now: the forecast for a burn we
  // have not started yet is the whole point of asking before we start it.
  function heatAtThrottle(ship, throttle, extra) {
    const sys = ship.systems && ship.systems.drive != null ? ship.systems.drive : 1;
    const drive = throttle > 0 ? (ship.driveHeat || 0) * throttle * sys : 0;
    return Math.max(0, (ship.idleHeat || 0) + drive + (ship.extraHeat || 0) + (extra || 0));
  }
  const heatInOf = (ship, extra) => heatAtThrottle(ship, ship.throttle || 0, extra);
  // What is actually making the heat, named. Billing the drive's 30 MW to the guns is how a card
  // about a burn came to open with 'full fire puts 32 MW into a sink' while the mounts were cold.
  function heatParts(ship) {
    const sys = ship.systems && ship.systems.drive != null ? ship.systems.drive : 1;
    const drive = (ship.throttle || 0) > 0 ? (ship.driveHeat || 0) * ship.throttle * sys : 0;
    const active = isActive(ship) ? Math.min(ship.extraHeat || 0, 2e6) : 0;
    const guns = Math.max(0, (ship.extraHeat || 0) - active);
    return { idle: ship.idleHeat || 0, drive, guns, active, total: heatInOf(ship, 0) };
  }
  // What the beams alone put into the sink at full fire, read off the mounts. The panels question
  // has to be priced against the fight the ship is about to be in, not against the quiet minute
  // before it: a stow that looks free with the guns cold fills the sink nine minutes later.
  function gunHeatAtFull(ship) {
    let w = 0;
    for (const m of (ship && ship.mounts) || []) if (m.kind === 'beam') w += (m.power || 0) * (1 - (m.efficiency || 0));
    const sys = ship.systems && ship.systems.weapons != null ? ship.systems.weapons : 1;
    return Math.max(0, w * sys);
  }
  function heatSourceWords(p) {
    const bits = [];
    if (p.guns > 0) bits.push('the mounts at ' + power(p.guns));
    if (p.drive > 0) bits.push('the drive at ' + power(p.drive));
    if (p.active > 0) bits.push('the active suite at ' + power(p.active));
    bits.push('the hull at ' + power(p.idle));
    return bits.length > 1 ? bits.slice(0, -1).join(', ') + ' and ' + bits[bits.length - 1] : bits[0];
  }
  // What the panels shed at a load they are not at yet: the law is the sink's temperature, so a
  // coasting hull whose sink is filling glows brighter as it goes, and the approach card has to
  // price the leg with the panels as they will be, not as they are on the pad.
  function shedAtLoad(ship, load) {
    const P = OD.P;
    const rating = ratingOf(ship);
    const peak = ship.radiatorTemp || 1000;
    if (!P || typeof P.sinkTemperature !== 'function' || !(rating > 0)) return rating;
    const k = P.sinkTemperature(U.clamp(load, 0, 1), peak);
    return rating * Math.pow(k / peak, 4);
  }
  // One leg of a manoeuvre, stepped: the physics module's law when it is there, a straight line
  // when it is not. Shared by sinkView (what we are doing now) and legView (what we are about to).
  function stepSink(ship, heat, rating, heatIn, horizon) {
    const out = { tFull: null, tEmpty: null, settle: null, loadAt: null };
    const cap = ship.sinkCapacity;
    if (!(cap > 0)) return out;
    const F = forecastFn();
    if (F) {
      let f = null;
      try { f = F(heat, cap, rating, heatIn, horizon || 7200, ship.radiatorTemp); } catch (e) { f = null; }
      if (f) {
        out.tFull = f.tFull != null && isFinite(f.tFull) ? Math.max(0, f.tFull) : null;
        out.tEmpty = f.tEmpty != null && isFinite(f.tEmpty) ? Math.max(0, f.tEmpty) : null;
        out.settle = f.settle != null && isFinite(f.settle) ? f.settle : null;
        if (typeof f.loadAt === 'function') out.loadAt = f.loadAt;
        return out;
      }
    }
    const net = heatIn - rating;
    if (net > 0) out.tFull = Math.max(0, (cap - heat) / net);
    else if (net < 0) out.tEmpty = Math.max(0, heat / -net);
    return out;
  }
  // A manoeuvre is not one thermal state. A break-off is a burn and then a coast; a cold approach
  // is a burn and then nothing at all. Step the sink through the legs in order and report what the
  // bridge wants: whether it saturates on the way, how high it gets, and where it is at the end.
  // legs: [{ secs, heatIn, panels }].
  function legView(ship, legs) {
    const out = { tFull: null, peak: 0, end: 0, endHeat: 0, secs: 0 };
    if (!ship || !(ship.sinkCapacity > 0)) return out;
    let heat = U.clamp(ship.heat || 0, 0, ship.sinkCapacity);
    out.peak = heat / ship.sinkCapacity;
    for (const leg of legs || []) {
      const secs = U.clamp(leg && leg.secs > 0 ? leg.secs : 0, 0, 7200);
      if (!(secs > 0)) continue;
      const rating = leg.panels ? ratingOf(ship) : 0;
      const heatIn = Math.max(0, leg.heatIn || 0);
      const f = stepSink(ship, heat, rating, heatIn, Math.ceil(secs) + 1);
      if (out.tFull == null && f.tFull != null && f.tFull <= secs) out.tFull = out.secs + f.tFull;
      let end;
      if (typeof f.loadAt === 'function') end = U.clamp(f.loadAt(secs), 0, 1) * ship.sinkCapacity;
      else end = U.clamp(heat + (heatIn - rating) * secs, 0, ship.sinkCapacity);
      heat = U.clamp(end, 0, ship.sinkCapacity);
      out.peak = Math.max(out.peak, heat / ship.sinkCapacity);
      out.secs += secs;
    }
    out.endHeat = heat;
    out.end = heat / ship.sinkCapacity;
    return out;
  }
  // The cold approach this hull is flying at that hull, if she is flying one.
  const onApproach = (ship, target) => !!(ship && ship.order && ship.order.type === 'approach' &&
    target && ship.order.target === target.id);
  // The plan this hull is actually flying. An approach order burns once to its cruise speed, goes
  // dark and brakes at brakeAt: a forecast that prices the drive as it is this second — lit, at
  // thirty megawatts — against a hull that will be coasting forty seconds from now is a forecast
  // about a different ship, and it is what put 'Extend the radiators' on the band twenty seconds
  // after the approach card had stowed them for the coast.
  function approachLegs(sim, ship) {
    const o = ship && ship.order;
    if (!o || o.type !== 'approach' || !o.target) return null;
    const t = sim.byId(o.target);
    const a = ship.accel ? ship.accel() : 0;
    if (!t || t.destroyed || !(a > 0)) return null;
    const view = trackRange(sim, ship, t);
    const closing = closingView(ship, view);
    const want = o.speed > 0 ? o.speed : T.coastSpeed;
    const burn = (ship.throttle || 0) > 0.01 ? U.clamp((want - closing) / a, 0, 600) : 0;
    const brakeAt = o.brakeAt > 0 ? o.brakeAt : (o.range > 0 ? o.range * 2 : 0);
    const speed = Math.max(closing + a * burn, 1);
    const coast = view.R > brakeAt ? U.clamp((view.R - brakeAt) / speed, 0, 7200) : 0;
    return { burn, coast, brakeAt, target: t, view, secs: burn + coast };
  }
  // The sink through that plan instead of through this second: the burn as it is, then the coast
  // with the drive out. With no plan to follow it is the steady-state view, unchanged.
  function planView(sim, ship, panels, extraIn) {
    const view = sinkView(ship, panels, extraIn);
    const legs = approachLegs(sim, ship);
    if (!legs || !(legs.secs > 0)) return view;
    const want = panels === undefined ? !!(ship.radiators && ship.radiators.state > 0.5) : !!panels;
    const v = legView(ship, [
      { secs: legs.burn, heatIn: heatAtThrottle(ship, 1, extraIn), panels: want },
      { secs: legs.coast, heatIn: heatAtThrottle(ship, 0, extraIn), panels: want },
    ]);
    return { tFull: v.tFull, tEmpty: null, settle: null, heatIn: view.heatIn, rating: view.rating,
      shed: view.shed, plan: legs, peak: v.peak, end: v.end };
  }
  // The panels belong to the coast for as long as the coast is the plan: the approach card priced
  // the leg with them in and issued the order on that promise, so nothing re-extends them until
  // the sink would actually fill before the brake.
  function coastOwnsPanels(sim, ship) {
    const st = state(sim);
    const rec = st.coast[ship.id];
    if (!rec || sim.time < rec.at) return false;
    const o = ship.order;
    if (!o || o.type !== 'approach' || o.target !== rec.target) { delete st.coast[ship.id]; return false; }
    const legs = approachLegs(sim, ship);
    if (!legs || !(legs.secs > 0)) return false;
    const v = legView(ship, [{ secs: legs.burn, heatIn: heatAtThrottle(ship, 1, 0), panels: false },
      { secs: legs.coast, heatIn: heatAtThrottle(ship, 0, 0), panels: false }]);
    return v.tFull == null;
  }
  // Every 'full in' and 'drains in' on the band comes from here: the forecast when the physics
  // module has one (it steps the sink with the radiator temperature law, so the panels shed less
  // as the sink empties), a straight line at today's numbers when it does not.
  function sinkView(ship, panels, extraIn) {
    const out = { tFull: null, tEmpty: null, settle: null, heatIn: 0, rating: 0, shed: 0 };
    if (!ship || !(ship.sinkCapacity > 0)) return out;
    const outNow = !!(ship.radiators && ship.radiators.state > 0.5);
    const want = panels === undefined ? outNow : !!panels;
    out.heatIn = heatInOf(ship, extraIn);
    out.rating = want ? ratingOf(ship) : 0;
    out.shed = want ? (outNow ? shedNow(ship) : out.rating) : 0;
    const f = stepSink(ship, ship.heat, out.rating, out.heatIn, 7200);
    out.tFull = f.tFull; out.tEmpty = f.tEmpty; out.settle = f.settle;
    if (typeof f.loadAt === 'function') out.loadAt = f.loadAt;
    return out;
  }
  // A look-ahead answer for one hypothetical order, kept for a few seconds: Guide.eta keeps the
  // countdown honest against a stale plan, so the numbers move without replanning every second.
  function planFor(sim, d, ship, order, slot) {
    const G = OD.Guide;
    const out = { t: null, dv: null, ok: false };
    if (!G || typeof G.plan !== 'function') return out;
    const cache = d._cache || (d._cache = {});
    const key = slot + '|' + ship.id;
    let c = cache[key];
    if (!c || sim.time - c.at >= T.planTtl || sim.time < c.at) {
      let p = null;
      try { p = G.plan(sim, ship, order); } catch (e) { p = null; }
      c = cache[key] = { at: sim.time, p };
    }
    const p = c.p;
    if (!p || !p.active) return out;
    out.dv = p.dv;
    out.ok = !!p.feasible;
    if (p.arrive) out.t = typeof G.eta === 'function' ? G.eta(sim, p, p.arrive) : p.arrive.t;
    return out;
  }

  // ---- objectives, threats and the weight of the two sides -------------------------------------
  const liveObjectives = (sim) => (sim.objectives || []).filter((o) => o && !o.done && !o.failed && !o.inactive);
  // An order to neutralise this hull, still open. Optional or not: the band should not be pointing
  // at 'open the range' while the mission board says to put her out of the fight.
  function neutraliseOpen(sim, target) {
    if (!target || target.neutralised && target.neutralised()) return false;
    for (const o of liveObjectives(sim)) {
      if (o.type !== 'neutralize' && o.type !== 'neutralise') continue;
      if (o.targets === 'hostiles') { if (target.role !== 'station') return true; continue; }
      if (Array.isArray(o.targets) && o.targets.indexOf(target.id) >= 0) return true;
    }
    return false;
  }
  function protectedShips(sim) {
    const out = [];
    for (const o of liveObjectives(sim)) {
      if (o.type !== 'protect') continue;
      const s = o.ship ? sim.byId(o.ship) : null;
      if (s && !s.destroyed && !s.captured) out.push(s);
    }
    return out;
  }
  // A hull the board says to bring home. Chapter 4's third objective is 'JCS Larkspur comes home',
  // and a corvette in front of a destroyer's beams is not a hull to trade for a hit.
  const mustComeHome = (sim, ship) => !!ship && protectedShips(sim).some((p) => p.id === ship.id);
  // Who is shooting at that hull right now: rounds and interceptors in flight, and any hostile
  // whose beams reach her from where she is.
  function attackersOn(sim, prot) {
    const out = [];
    const seen = Object.create(null);
    const add = (ship, how, eta) => {
      if (!ship || ship.destroyed || ship.captured || seen[ship.id]) return;
      seen[ship.id] = true;
      out.push({ ship, how, eta: eta == null ? null : eta });
    };
    for (const r of threatsOn(sim, prot) || []) {
      if (r.kind === 'interceptor') { if (r.eta == null || r.eta <= T.defendEta) add(r.fromId ? sim.byId(r.fromId) : null, 'interceptors', r.eta); }
      else if (r.kind === 'slug' && r.willHit) add(r.fromId ? sim.byId(r.fromId) : null, 'slugs', r.eta);
    }
    // Her beams are on the ship we guard: she has designated her, her weapons are free and the
    // range is inside her burn-through. A hostile that merely happens to be within reach of a
    // hull she has not looked at is not an attack, and the band is not an alarm bell.
    for (const h of sim.hostiles(prot)) {
      if (h.disabled || civilian(h) || !h.weaponsFree || h.target !== prot.id) continue;
      const r = reachOf(sim, h, prot);
      const bite = biteOn(r && r.beams, facetOf(h, prot));
      if (bite > 0 && U.dist(h.pos, prot.pos) <= bite) add(h, 'beams', 0);
    }
    return out;
  }
  // The protected ships with something on them, computed at most once a pass and shared by every
  // card: it is the reason the navigator refuses to point at 'hold' while a hauler is being shot.
  function underAttack(sim) {
    const st = state(sim);
    if (st.guardAt === sim.time && st.guard) return st.guard;
    const out = [];
    for (const p of protectedShips(sim)) {
      const att = attackersOn(sim, p);
      if (att.length) out.push({ ship: p, attackers: att });
    }
    st.guard = out; st.guardAt = sim.time;
    return out;
  }
  function fightWeight(ship) {
    if (!combatant(ship) || ship.disabled) return 0;
    let w = 0;
    for (const m of ship.mounts || []) w += m.kind === 'beam' ? 3 : m.kind === 'coilgun' ? 2 : m.kind === 'launcher' ? 2 : 0.5;
    const sys = ship.systems || {};
    return w * U.clamp(ship.hull != null ? ship.hull : 1, 0, 1) * (sys.weapons != null ? sys.weapons : 1);
  }
  // Ours over theirs. Under T.outgunned the fight is not winnable from here and breaking off is an
  // honest recommendation again.
  function balance(sim, ship) {
    const st = state(sim);
    const k = ship.faction;
    if (st.balanceAt === sim.time && st.balance && st.balance[k] != null) return st.balance[k];
    let ours = 0, theirs = 0;
    for (const s of sim.ships) {
      if (!combatant(s)) continue;
      if (s.faction === ship.faction) ours += fightWeight(s);
      else if (sim.isHostile(s, ship)) theirs += fightWeight(s);
    }
    const v = theirs > 0 ? ours / theirs : 4;
    if (st.balanceAt !== sim.time) { st.balance = Object.create(null); st.balanceAt = sim.time; }
    st.balance[k] = v;
    return v;
  }
  const outgunned = (sim, ship) => balance(sim, ship) < T.outgunned;
  // While this is true the navigator never points at opening the range, sitting still or running.
  function pressing(sim, ship, target) {
    if (!sim || !ship) return false;
    if (underAttack(sim).length) return true;
    return !!(target && neutraliseOpen(sim, target) && !outgunned(sim, ship));
  }
  // Time is against us: a hull we must stop is running, a guard objective is on a clock, or
  // something is already shooting at a ship we are here to protect.
  function timeMatters(sim, ship, target) {
    if (underAttack(sim).length) return true;
    for (const o of liveObjectives(sim)) if (o.type === 'escapeFail') return true;
    if (target) {
      const r = U.sub(target.pos, ship.pos);
      const d = U.len(r);
      if (d > 1) {
        const closing = -U.dot(U.sub(target.vel, ship.vel), U.scale(r, 1 / d));
        if (closing < -200 && neutraliseOpen(sim, target)) return true; // she is opening the range on us
      }
    }
    return false;
  }

  // ---- who may be asked, and about whom --------------------------------------------------------
  // Every player-faction hull that is not a station: a freighter with slugs on her and her panels
  // out has the same two questions a corvette has, and on the hauling chapters she is the objective.
  // The kinds that are about taking a fight to someone keep the fuller test for themselves.
  function eligible(sim, ship) {
    return !!ship && !ship.destroyed && !ship.disabled && !ship.captured &&
      ship.faction === sim.playerFaction && !station(ship);
  }
  // A hauler the computer is flying is not the player's to fly. She gets her questions, but not in
  // the first minute of a chapter, when the bridge has its own hull to learn.
  const handsOff = (sim, ship) => !!ship.ai && civilian(ship) && sim.time < T.freighterQuiet;
  function nearestWarship(sim, ship, crippled) {
    let best = null, bd = Infinity;
    for (const h of sim.hostiles(ship)) {
      if (civilian(h)) continue;
      if (!crippled && h.disabled) continue;
      const d = U.dist(h.pos, ship.pos);
      if (d < bd) { bd = d; best = h; }
    }
    return best;
  }
  // The hull the bridge has designated, when it is still worth working. A question about how to
  // fight her is only worth asking about an enemy the player has chosen: the kinds that come at us
  // — slugs in flight, her beams on our panels, a prize adrift — bring their own hull with them.
  function designated(sim, ship) {
    const t = ship.target ? sim.byId(ship.target) : null;
    if (!t || t.destroyed || t.captured || t.disabled || civilian(t) || !sim.isHostile(t, ship)) return null;
    return t;
  }
  const gone = (sim, id) => { const s = id ? sim.byId(id) : null; return !s || s.destroyed || s.captured; };
  const selectedId = () => (OD.UI && OD.UI.selected ? OD.UI.selected : null);

  // ---- whose voice the card is in --------------------------------------------------------------
  // A card about the hull under the player's hand speaks the way the bridge does: we, us, our. A
  // card about another hull — a hauler with rounds coming at her, a sister ship the player is not
  // flying — has to name her, or 'we are 8 s from six rounds' reads as if the bridge's own ship
  // were the one about to be holed.
  // Both readings are written out, clause by clause, wherever they differ. Swapping the pronouns
  // by rule is what wrote 'Hold her own station' and 'she keeps the approach she is flying, now
  // aimed at her': three ships and one pronoun between them. `v.we`, `v.us` and `v.our` carry the
  // subject, and `v.say(first, third)` picks between two written clauses when the verb moves with
  // it. Every card kind names both hulls in the third person.
  function voiceOf(ship, third) {
    const name = ship && ship.name ? ship.name : 'she';
    const on = !!third && !!(ship && ship.name);
    return {
      third: on,
      name,
      we: on ? name : 'we',
      us: on ? name : 'us',
      our: on ? name + '\u2019s' : 'our',
      say: (first, alt) => (on ? alt : first),
    };
  }
  // The same for the hull on the other side of the card: 'her' while the bridge is speaking for
  // itself, her name once another hull is under the player's hand and 'her' could be either of
  // them.
  const foeWord = (v, target, word) => (v.third && target && target.name ? target.name : (word || 'she'));
  const foeOwn = (v, target) => (v.third && target && target.name ? target.name + '\u2019s' : 'her');
  const foeHer = (v, target) => (v.third && target && target.name ? target.name : 'her');  // ---- breaking off, without cooking on the way out --------------------------------------------
  // A retreat order burns at full throttle for as long as it is carried, which is how 'break off
  // and cool' cooked the ship it was supposed to save: 1 600 s of drive heat into a sink the panels
  // could not keep up with. Breaking off is a short burn away and then a long coast, so the module
  // works out how long the burn may last — far enough to be outside her guns, never long enough to
  // fill the sink — issues the retreat, and cuts the drive itself when the burn is done.
  function breakBurn(sim, ship, target) {
    const out = { secs: 0, speed: 0, opened: 0, want: 0, heatIn: 0 };
    const a = ship.accel ? ship.accel() : 0;
    if (!(a > 0)) return out;
    const bite = target ? bites(sim, ship, target).theirs : 0;
    const R = target ? U.dist(ship.pos, target.pos) : 0;
    out.want = Math.max(bite * T.breakOpen, R + 20e3);
    const need = Math.max(20e3, out.want - R);
    const v = U.clamp(Math.sqrt(need * a), 200, T.coastSpeed);
    let secs = Math.min(T.breakBurn, v / a);
    // The sink is the other limit, and the one that was ignored: step the burn and stop it before
    // the load crosses breakLoad, so the answer that cools the ship cannot be the one that cooks it.
    // Breaking off takes the beams with it, so the burn is costed with the mounts cold and the
    // panels out — which is what the option actually does — and a sink that is already hotter than
    // the limit only rules the burn out if the burn would take it higher still.
    const gunHeat = Math.max(0, (ship.extraHeat || 0) - (isActive(ship) ? 2e6 : 0));
    const load0 = ship.thermalLoad ? ship.thermalLoad() : 0;
    const limit = Math.max(T.breakLoad, load0 + 0.05);
    out.heatIn = heatAtThrottle(ship, 1, -gunHeat);
    const f = stepSink(ship, ship.heat, ratingOf(ship), out.heatIn, Math.ceil(secs) + 1);
    if (typeof f.loadAt === 'function') {
      for (let t = 5; t <= secs; t += 5) if (f.loadAt(t) > limit) { secs = t - 5; break; }
    } else if (f.tFull != null) secs = Math.min(secs, f.tFull * T.breakLoad);
    // A break-off that burns for nothing at all is not an option, only a word: give it the few
    // seconds the sink can always stand unless the sink is already saturated, where the drive is
    // capped to a quarter anyway and the honest answer is that there is no burn to be had.
    if (secs < 15 && load0 < 0.999) secs = Math.min(15, Math.min(T.breakBurn, v / a));
    out.secs = Math.max(0, Math.round(secs));
    out.speed = a * out.secs;
    out.opened = 0.5 * a * out.secs * out.secs;
    return out;
  }
  let breakTag = 0;
  // The retreat, and the promise to end it. Nothing else in the sim will cut the drive, so the
  // module keeps the end of the burn itself and hands the hull back to a coast.
  function startBreak(sim, ship, target, secs, keepOpening) {
    const st = state(sim);
    const tag = 'brk' + ++breakTag;
    const order = target ? { type: 'retreat', target: target.id, breakTag: tag } : { type: 'retreat', heading: ship.heading, breakTag: tag };
    sim.setOrder(ship.id, order);
    st.burn[ship.id] = { tag, until: sim.time + Math.max(5, secs || 0), open: !!keepOpening };
  }
  // Called every pass: a burn whose time is up goes cold, and one the bridge has flown out of is
  // forgotten. The hull keeps the speed it bought and coasts away on it.
  function endBurns(sim, st) {
    for (const id of Object.keys(st.burn)) {
      const rec = st.burn[id];
      const sh = sim.byId(id);
      const order = sh && sh.order ? sh.order : null;
      if (!sh || !order || order.breakTag !== rec.tag) { delete st.burn[id]; continue; }
      if (!(sim.time >= rec.until || sh.destroyed || sh.disabled)) continue;
      // A break-off made to get out of her guns is re-lit while she is still following and the
      // sink still has room for it. Chapter 2's retreat lapsed to a hold at 1 045 s, ISV Sabre was
      // on keeprange → Larkspur and matched the coast, and the range gained 3 km a minute against
      // a card that had promised 'outside her 837 km burn-through in 9m 40s'. The burn goes cold
      // for good once we are outside her beams, once she stops following, or once the sink stops
      // us: breakBurn works out how long each leg may run against exactly that.
      if (rec.open && !sh.destroyed && !sh.disabled) {
        const foe = order.target ? sim.byId(order.target) : null;
        const bite = foe && !foe.destroyed && !foe.captured && !foe.disabled ? bites(sim, sh, foe).theirs : 0;
        const chasing = !!foe && closingOn(sh, foe) > -5;
        if (bite > 0 && chasing && U.dist(sh.pos, foe.pos) <= bite * T.breakOpen) {
          const b = breakBurn(sim, sh, foe);
          if (b.secs >= 10) { rec.until = sim.time + b.secs; continue; }
        }
      }
      delete st.burn[id];
      if (order.breakTag === rec.tag) sim.setOrder(id, { type: 'hold' });
      // The burn is over and the hull is holding, out of the fight, with the board's objective
      // still open. How she gets back in is a new question, and it must not wait out the ten
      // minutes the answer that took her out of it bought: chapter 4 broke off at 355 s and the
      // next question about the range came at 1 645 s, with ISV Coriolis at 49 % and the chapter
      // out of clock.
      delete st.cool[coolKey(id, 'approach')];
      delete st.cool[coolKey(id, 'range')];
      delete st.cool[coolKey(id, 'withdraw')];
    }
  }

  // ---- the crew, read through a guard (v13) ----------------------------------------------------
  // Parties, wounded and the g limits all come through OD.Crew.board, and the module may not be
  // there at all: without it none of the three crew cards is ever raised and the rest of the band
  // is unchanged. Nothing here writes to the crew; the options do that, through assign and setG.
  function crewBoard(ship) {
    const C = OD.Crew;
    if (!ship || !C || typeof C.board !== 'function') return null;
    let b = null;
    try { b = C.board(ship); } catch (e) { return null; }
    if (!b || !b.crew || !Array.isArray(b.parties) || !Array.isArray(b.parts)) return null;
    return b;
  }
  // The crew module's own numbers, with the written ones behind them, so a card can be priced
  // before the module carries its thresholds.
  function crewT() {
    const t = (OD.Crew && OD.Crew.T) || {};
    const num = (v, d) => (typeof v === 'number' && isFinite(v) && v > 0 ? v : d);
    return {
      workG: num(t.workG, 1.2),
      couchG: num(t.couchG, 3),
      medic: num(t.medic, 45),
      // Wounded per second per g over the couch limit per fit crew: two a minute per g over, on a
      // corvette of twenty-four.
      hurtRate: num(t.hurtRate, 2 / (60 * 24)),
    };
  }
  const G0 = () => (OD.P && OD.P.g0 > 0 ? OD.P.g0 : 9.80665);
  const gs = (g) => Math.round((g || 0) * 10) / 10 + ' g';
  // What the drive can pull with nobody in the way. ship.accel() is already capped by the crew's
  // limit, so a card pricing the other rung has to work back to the drive itself.
  function driveAccel(ship) {
    if (!ship || typeof ship.accel !== 'function') return 0;
    const a = ship.accel();
    if (ship.propMass <= 0 || ship.disabled || ship.destroyed) return 0;
    const m = typeof ship.mass === 'function' ? ship.mass() : 0;
    if (!(m > 0) || !(ship.thrust > 0)) return a;
    const sys = ship.systems && ship.systems.drive != null ? ship.systems.drive : 1;
    const raw = (ship.thrust * sys * (ship.overheated ? 0.25 : 1)) / m;
    return raw > a ? raw : a;
  }
  // A hull that has broken off and run, or that is out of the fight: nothing about her is a
  // question any more, on either side of a card.
  const quietHull = (ship) => !!ship && (!!ship.drivenOff ||
    (typeof ship.neutralised === 'function' ? !!ship.neutralised()
      : !!(ship.destroyed || ship.disabled || ship.captured)));
  const partyWord = (id) => 'Party ' + String(id == null ? '' : id).replace(/^p/, '');
  const partyLower = (id) => partyWord(id).toLowerCase();
  // The board's own name for a part, in the case a sentence wants it. damage.js owns the spelling
  // (OD.Damage.plainName): 'the drive', 'radiator panel 1', 'the coilgun'. The card used to strip
  // the article off everything, so the band read 'Pull a party off watch for coilgun?' over a
  // board and a log that both said 'the coilgun'. With the export not in yet the fallback is
  // damage.js's own rule rather than a second one, so the two can never disagree.
  function partPhrase(name, id, ship) {
    const D = OD.Damage;
    if (ship && Array.isArray(ship.components) && D && typeof D.plainName === 'function') {
      const c = ship.components.find((x) => x && x.id === id);
      if (c) {
        try { const said = D.plainName(c); if (typeof said === 'string' && said) return said; } catch (e) { /* the rule below */ }
      }
    }
    const s = String(name || id || 'the part');
    const low = /^[A-Z][A-Z]/.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1);
    if (/^(radiator|tank)/i.test(s)) return low;
    return 'the ' + low;
  }
  const partCap = (name, id, ship) => { const s = partPhrase(name, id, ship); return s.charAt(0).toUpperCase() + s.slice(1); };
  // The same name after a ship's possessive, where the article cannot stand: “JCS Greylag’s drive
  // is hit.”, never “JCS Greylag’s the drive is hit.”
  const partOwned = (name, id, ship) => partPhrase(name, id, ship).replace(/^the /, '');
  const STATION_WORD = { fire: 'fire control', sensors: 'the sensor watch' };
  // Where a party is, in the words the log and the cards both use.
  function taskPhrase(p, ship) {
    if (!p) return 'on standby';
    if (p.task === 'repair' && p.part) return 'on ' + partPhrase(p.partName, p.part, ship);
    if (p.task === 'medical') return 'in the sick bay';
    if (STATION_WORD[p.task]) return 'on ' + STATION_WORD[p.task];
    return 'on standby';
  }
  // What a jury-rig on this part buys, in the words the board itself uses. The board row's `buys`
  // is the one sentence in the build that prices a mend — 'A party brings radiator panel 1 to
  // 70 %: cooling back to 85 %. 4 min.' — and the card used to re-derive its own clause from the
  // cap, so the key read 'cooling back to 70 %' over a board row reading 85 % for the same repair.
  // The card now reads that sentence: the clause after the colon, without its trailing time, which
  // the key prints once itself.
  // The head runs to the first colon. 'A party cross-connects the spare feed line and brings the
  // reactor to 60 %:' has a hyphen in it, which the old [a-z]+ pattern stopped at, so the reactor's
  // key printed the board's whole sentence, head, colon and all.
  const BUYS_TIME = /[\s\u00b7,;]*\b\d+\s*(min|s)\.?\s*$/i;
  const BUYS_HEAD = /^A party\b[^:]*:\s*/;
  function buysPhrase(part, ship) {
    if (!part) return '';
    const said = String(part.buys || '');
    if (said && !/^Nothing/.test(said)) {
      // The sentence ends where the time begins, and anything after the time — 'with the radiators
      // in' — is a condition the card's own key already carries.
      const clause = said.replace(BUYS_HEAD, '').split(/\.(?:\s|$)/)[0]
        .replace(BUYS_TIME, '').replace(/[.\s]+$/, '').trim();
      if (clause) return clause.charAt(0).toLowerCase() + clause.slice(1);
    }
    return derivedBuys(part, ship);
  }
  // One time format for a repair everywhere: damage.js's own, the one its `buys` sentence prints,
  // so the card and the board row beside it never give one job two numbers. Without the export the
  // fallback is that formatter's own rule.
  function mendTime(secs) {
    if (!(secs > 0) || !isFinite(secs)) return null;
    const D = OD.Damage;
    if (D && typeof D.timeWords === 'function') {
      try { const said = D.timeWords(secs); if (typeof said === 'string' && said) return said; } catch (e) { /* the rule below */ }
    }
    return Math.max(1, Math.round(secs / 60)) + ' min';
  }
  // What the mend buys and how long it takes, in one detail clause. The time used to be bolted on
  // to whatever the board row said, which reads right after a percentage and wrong after anything
  // else: 'it keeps firing, and 4 times the damage to wreck it in 3m 36s' parses as wrecking it in
  // three minutes. It is appended only to a clause that ends in a percentage, and otherwise takes
  // a clause of its own in front.
  function buysClause(part, secs, ship) {
    const said = buysPhrase(part, ship);
    const t = mendTime(secs);
    if (!t) return said;
    if (/\d+\s*%$/.test(said)) return said + ' in ' + t;
    return t + ' \u00b7 ' + said;
  }
  // What a holed tank is costing, in the sim's own arithmetic: the propellant going out of the
  // hole over the next minute, priced as delta-v. damage.js vents (1 − hp) × ventRate × share a
  // second, and stops at what the tank still holds.
  function ventDvPerMin(ship, partId) {
    const D = OD.Damage;
    const rate = D && D.T && D.T.ventRate > 0 ? D.T.ventRate : 0;
    if (!rate || !ship || !Array.isArray(ship.components)) return null;
    const c = ship.components.find((x) => x && x.id === partId);
    if (!c || !(c.share > 0) || c.isolated) return null;
    const left = Math.max(0, c.share - (c.vented || 0));
    const going = Math.min(Math.max(0, 1 - c.hp) * rate * c.share * 60, left, ship.propMass || 0);
    const ve = ship.exhaustVelocity || 0;
    const m = Math.max(1, (ship.dryMass || 0) + (ship.propMass || 0));
    const dry = Math.max(1, ship.dryMass || 1);
    const out = going > 0 && ve > 0 ? ve * Math.log(m / Math.max(dry, m - going)) : 0;
    return out > 0 ? out : null;
  }
  // What leaving a part alone leaves it at. A venting tank does not sit at a percentage: it
  // empties. Chapter 8's card offered 'Tank 1 stays at 20 %' while five kilometres a second of
  // delta-v went out of the hole in 64 s, so a holed tank is priced by the rate it is losing.
  function staysWords(part, ship, cap) {
    if (part && part.state === 'venting') {
      const out = ventDvPerMin(ship, part.id);
      if (out != null) {
        const said = partPhrase(part.name, part.id, ship) + ' keeps venting, about ' + U.fmt.dv(out) + ' a minute';
        return cap ? said.charAt(0).toUpperCase() + said.slice(1) : said;
      }
    }
    const level = (cap ? partCap(part.name, part.id, ship) : partPhrase(part.name, part.id, ship)) +
      ' stays at ' + pct(part.hp);
    return level;
  }
  // Why a party cannot start: the board's own reason, from OD.Crew's inUse rule. A part that is
  // running — the drive under throttle, the panels out — cannot be worked at all, so a card that
  // prices a clean repair time for it is selling work the ship will refuse to start.
  const blockOf = (part) => (part && typeof part.blocked === 'string' && part.blocked ? part.blocked : null);
  // The same thing in a clause a key can carry. The board's own reason is a sentence of its own
  // ('Held: pull the radiators in first. No cooling while they are in.'), which is right on a row
  // and too long beside an option.
  function blockShort(part) {
    const id = String((part && part.id) || '');
    if (/^drive/.test(id)) return 'nothing can be done until the throttle is 0';
    if (/^rad/.test(id)) return 'nothing can be done until the radiators are in';
    const said = blockOf(part);
    if (!said) return 'nothing can be done while it is running';
    const first = said.split(/\.(?:\s|$)/)[0].trim();
    return first.charAt(0).toLowerCase() + first.slice(1);
  }
  // The throttle the order the ship is flying will hold, not the one this instant caught. An
  // intercept or an approach exists to close, so it burns; the autopilot's coast leg reads zero on
  // ship.throttle and priced a four-minute stow at the quiet minute in the middle of a burn. A
  // keeprange hull already on station really is coasting, so that one is read off the throttle.
  function orderThrottle(ship) {
    if (!ship) return 0;
    const o = ship.order || {};
    if (o.type === 'intercept' || o.type === 'approach') return 1;
    return U.clamp(Math.max(ship.throttle || 0, ship.cmdThrottle || 0), 0, 1);
  }
  // Where the sink ends up over a repair made with the radiators in: what stowing them costs, in
  // the quantity the heat box uses, at the throttle the order will hold while the party works.
  function sinkAfterStow(ship, secs) {
    const cap = ship && ship.sinkCapacity > 0 ? ship.sinkCapacity : 0;
    if (!(cap > 0) || !(secs > 0)) return null;
    const heat = U.clamp(ship.heat || 0, 0, cap);
    return U.clamp((heat + heatAtThrottle(ship, orderThrottle(ship), 0) * secs) / cap, 0, 1);
  }
  // With no board row to read — an older damage module, or a part the report does not carry — the
  // card falls back on the cap the mend reaches.
  function derivedBuys(part, ship) {
    const name = partPhrase(part.name, part.id, ship);
    const kind = (/^[a-z]+/.exec(String(part.id || '')) || [''])[0];
    if (part.cap == null || !isFinite(part.cap)) return kind === 'tank' ? 'the venting stops' : name + ' back in service';
    switch (kind) {
      case 'drive': return 'thrust back to ' + pct(part.cap);
      case 'reactor': return 'power back to ' + pct(part.cap);
      case 'sensors': return 'the passive range back to ' + pct(part.cap);
      case 'rad': return 'cooling back to ' + pct(part.cap);
      case 'tank': return 'the venting stops';
      default: return name + ' back to ' + pct(part.cap);
    }
  }
  // The routine's value order, and so the card's: the drive, the reactor, a venting tank, the
  // radiators, the mounts, the sensor suite. A tank that is not venting is the last thing worth a
  // party. The routine pulls a party off fire control or the sensor watch only for the first three.
  function partRank(part) {
    const id = String((part && part.id) || '');
    if (/^drive/.test(id)) return 0;
    if (/^reactor/.test(id)) return 1;
    if (/^tank/.test(id)) return part && part.state === 'venting' ? 2 : 6;
    if (/^rad/.test(id)) return 3;
    if (/^sensors/.test(id)) return 5;
    return 4; // a mount
  }
  const PULL_RANK = 2;  // the value order down to which the routine gives a watch up by itself
  // What a mend puts back on a part, in hp. A venting tank is the exception the number cannot
  // show: isolating it buys nothing on the gauge and stops the propellant going.
  function mendGain(part) {
    if (!part) return 0;
    if (/^tank/.test(String(part.id || '')) && part.state === 'venting') return 1;
    if (part.cap == null || !isFinite(part.cap) || part.hp == null) return 0;
    return Math.max(0, part.cap - part.hp);
  }
  // How much of the fight a part carries, so what a mend buys can be weighed against what a watch
  // at 70 % costs. The drive and the reactor are the hull; a venting tank is the propellant; the
  // panels are what lets her keep shooting once the sink is high; a mount is its share of the
  // mounts aboard.
  function partShare(ship, part) {
    const id = String((part && part.id) || '');
    if (/^drive/.test(id) || /^reactor/.test(id)) return 1;
    if (/^tank/.test(id)) return part && part.state === 'venting' ? 1 : 0.1;
    if (/^rad/.test(id)) return loadOf(ship) >= T.radiatorLoad ? 1 : 0.6;
    if (/^sensors/.test(id)) return 0.5;
    const mounts = ship && Array.isArray(ship.components)
      ? ship.components.filter((c) => /^(beam|coil|bay|pd)/.test(String(c.id || ''))).length : 0;
    return 1 / Math.max(1, mounts);
  }
  // How long this hull's armour lasts at the fire landing on her now: the number the withdraw card
  // already works out. A mend that cannot land inside it is a promise, not a repair, and the key
  // has to say so.
  function hullLifeSecs(sim, ship) {
    try { const h = hullLife(sim, ship); return h && h.life > 0 ? h.life : null; } catch (e) { return null; }
  }
  // Can a party do anything here at all? The board says so when it carries the flag, the damage
  // module when it does not. With neither, the card invents no repair.
  function mendable(ship, part) {
    if (!part || !part.id) return false;
    if (part.repairable != null) return !!part.repairable;
    const D = OD.Damage;
    if (D && typeof D.repairable === 'function') { try { return !!D.repairable(ship, part.id); } catch (e) { return false; } }
    return false;
  }
  // Seconds a party needs on this part: the board's estimate, else the damage module's.
  function mendSecs(ship, part) {
    if (part && part.eta > 0 && isFinite(part.eta)) return part.eta;
    const D = OD.Damage;
    if (D && typeof D.repairTime === 'function') {
      try { const s = D.repairTime(ship, part.id); if (s > 0 && isFinite(s)) return s; } catch (e) { /* no estimate */ }
    }
    return null;
  }
  // The parts a party could still improve, nobody on them, most valuable first. The gate is
  // repairable, not the state word: stateOf calls anything above 50 % 'ok' while a jury-rig works
  // anything under 100 %, so a drive at 60 % — the thing the routine pulls a watch for — was never
  // on this list and never raised a card.
  function mendList(ship, board) {
    if (!board) return [];
    return board.parts
      .filter((p) => p && p.id && !p.party && mendable(ship, p) && mendSecs(ship, p) != null)
      .sort((a, b) => partRank(a) - partRank(b));
  }
  const partiesOn = (board, task) => (board ? board.parties.filter((p) => p.task === task) : []);
  const stationed = (board) => (board ? board.parties.filter((p) => p.task === 'fire' || p.task === 'sensors') : []);
  const repairRunning = (board) => !!board && board.parties.some((p) => p.task === 'repair' && p.part);
  // The repair a burn would put down, and how long is left of it: the longest job running.
  function pausedWork(board) {
    if (!board) return null;
    let worst = null;
    for (const p of board.parties) {
      if (p.task !== 'repair' || !p.part) continue;
      const row = board.parts.find((x) => x.id === p.part) || null;
      const left = p.eta > 0 && isFinite(p.eta) ? p.eta : (row && row.eta > 0 ? row.eta : null);
      if (left == null) continue;
      if (!worst || left > worst.left) worst = { left, id: p.part, name: row ? row.name : p.partName };
    }
    return worst;
  }
  // Which watch is the cheaper hand to lose. With a solution already held the sensor watch costs
  // least; without one the beams have nothing to point at, so fire control is the cheaper one.
  function solutionHeld(sim, ship) {
    const foe = designated(sim, ship) || nearestWarship(sim, ship, false);
    if (!foe) return true;
    return qualityOf(sim, ship, foe) >= T.solutionQ;
  }
  // The routine and the card must name the same watch, or the lit key is a lie about what happens
  // if nobody answers. The rule lives in the crew module once it exports it; the fallback here is
  // the same rule: with a solution already held the sensor watch is the cheaper hand to lose, and
  // without one the beams have nothing to point at, so fire control is.
  function watchToPull(sim, ship) {
    const C = OD.Crew;
    if (C && typeof C.watchToPull === 'function') {
      try { const w = C.watchToPull(ship, sim); if (w === 'fire' || w === 'sensors') return w; } catch (e) { /* the card's own rule */ }
    }
    return solutionHeld(sim, ship) ? 'sensors' : 'fire';
  }
  // 'Keep the parties where they are' is the player's authority over the routine, and it used to
  // last until the routine's next tick ten seconds later. A refusal now holds that part for the
  // minute the card would have waited.
  function holdPart(ship, partId) {
    const C = OD.Crew;
    if (!C || typeof C.hold !== 'function' || !partId) return;
    try { C.hold(ship, partId, T.autoAssign); } catch (e) { /* the routine carries on */ }
  }
  // OD.Crew.assign returns the sentence for the log — 'Party 2 to the drive: 7 min to 70 %. The
  // sensor watch drops to 70 % of its rate until she is back.' — and the card used to throw it
  // away, so an answered repair logged 'Decision: … → Send party 1 to the drive' with no time and
  // no cost. It is held here and printed after the Decision line, which is the order a reader
  // wants: the answer, then what it bought.
  function assignParty(sim, ship, partyId, task, partId) {
    const C = OD.Crew;
    if (!C || typeof C.assign !== 'function') return;
    let said = null;
    try { said = C.assign(ship, partyId, task, partId || null); } catch (e) { /* the board keeps what it had */ }
    sayCrew(sim, ship, said);
  }
  // One sentence the crew module gave back, held for the log.
  function sayCrew(sim, ship, said) {
    if (typeof said !== 'string' || !said || !sim) return;
    const st = sim._decisions;
    // crew.js's own rule for whose party lines are printed in full: the hull on screen by itself,
    // any other named first.
    const line = ship && ship.name && selectedId() !== ship.id ? ship.name + ' \u2014 ' + said : said;
    if (st) (st.said || (st.said = [])).push(line);
  }
  // A party standing by a part the order keeps in use is doing nothing, and the watch she left is
  // running at 70 % for it. 'Press on' stands her down in the same breath as the order that keeps
  // her idle, and the sentence OD.Crew.release gives back goes under the Decision line. The crew
  // module stands a party down by itself after a minute on a part the ship is using, so this may
  // find her already gone: then there is nobody to release and nothing to say.
  function releaseWaiting(sim, ship, partId) {
    const C = OD.Crew;
    if (!C || typeof C.release !== 'function' || !ship || !partId) return false;
    const board = crewBoard(ship);
    const p = board && board.parties.find((x) => x.task === 'repair' && x.part === partId);
    if (!p) return false;
    let said = null;
    try { said = C.release(ship, p.id); } catch (e) { said = null; }
    sayCrew(sim, ship, said);
    return true;
  }
  // The sentences the answer earned, printed under the Decision line and then forgotten.
  function flushSaid(sim) {
    const st = sim && sim._decisions;
    if (!st || !st.said || !st.said.length) { if (st) st.said = []; return; }
    const said = st.said;
    st.said = [];
    if (typeof sim.addLog !== 'function') return;
    for (const line of said) sim.addLog(line, 'Crew', 'good');
  }
  // What an order is called, when a log line has to name the one the ship is flying.
  const ORDER_WORDS = { keeprange: 'keep range', intercept: 'the intercept', approach: 'the approach',
    retreat: 'the break-off', evade: 'the evasion', manual: 'the heading she was flying', hold: 'hold' };
  const ORDER_STOP = { keeprange: 'holding the range', intercept: 'the intercept', approach: 'the approach',
    retreat: 'the break-off', evade: 'the evasion' };
  const orderWords = (o) => ORDER_WORDS[String((o && o.type) || 'hold')] || 'the order she was flying';
  const orderStop = (o) => ORDER_STOP[String((o && o.type) || '')] || null;
  // Clearing the way for a party, and remembering what was cleared. 'Cut the drive for 6 min' set
  // the throttle to 0 and the order to hold, and nothing gave either back: the ship sat at
  // throttle 0 long after the mend landed. What the act found is kept here, with the very objects
  // it put in their place, so a hand on the order or the radiators since then is plain to see —
  // and then nothing is given back.
  function clearDrive(sim, ship, partId) {
    const was = { order: ship.order ? Object.assign({}, ship.order) : null, throttle: ship.cmdThrottle };
    const stop = orderStop(ship.order);
    ship.cmdThrottle = 0;
    ship.throttle = 0;
    if (sim && typeof sim.setOrder === 'function') sim.setOrder(ship.id, { type: 'hold' });
    else ship.order = { type: 'hold' };
    if (sim) state(sim).clear[ship.id] = { part: partId, kind: 'drive', was, put: ship.order, at: sim.time };
    // The board logs a send; the card logs what the send cost the order.
    sayCrew(sim, ship, 'Throttle to 0. ' + (stop ? stop.charAt(0).toUpperCase() + stop.slice(1) +
      ' stops while the party works.' : 'She coasts while the party works.'));
  }
  function clearPanels(sim, ship, partId) {
    const r = ship.radiators || null;
    const was = r ? { auto: !!r.auto, deployed: !!r.deployed } : null;
    if (sim && typeof sim.setRadiators === 'function') sim.setRadiators(ship.id, false);
    else if (r) { r.auto = false; r.deployed = false; }
    if (sim) state(sim).clear[ship.id] = { part: partId, kind: 'rad', was, at: sim.time };
    sayCrew(sim, ship, 'The radiators come in. No cooling while the party works.');
  }
  // The repair a trade cleared the way for, while the party is still on the part.
  function heldRepair(sim, ship) {
    const rec = sim && ship ? state(sim).clear[ship.id] : null;
    if (!rec) return null;
    const board = crewBoard(ship);
    const p = board ? board.parties.find((x) => x.task === 'repair' && x.part === rec.part) : null;
    if (!p) return null;
    return { kind: rec.kind, part: rec.part, party: p.id };
  }
  // The party is off the part — the mend landed, or she was recalled or stood down — so the order
  // and the panels go back to what the trade took them from. If the bridge has given the ship
  // something else to do since, nothing is given back: the newer order is the one that counts.
  function endClears(sim, st) {
    for (const id of Object.keys(st.clear)) {
      const rec = st.clear[id];
      const sh = sim.byId(id);
      if (!sh || sh.destroyed || sh.captured) { delete st.clear[id]; continue; }
      const board = crewBoard(sh);
      if (board && board.parties.some((p) => p.task === 'repair' && p.part === rec.part)) continue;
      delete st.clear[id];
      const row = board ? board.parts.find((p) => p.id === rec.part) : null;
      const at = row && row.hp != null ? partCap(row.name, rec.part, sh) + ' is at ' + pct(row.hp) + '. ' : '';
      const say = (line) => {
        if (typeof sim.addLog !== 'function') return;
        const who = sh.name && selectedId() !== sh.id ? sh.name + ' \u2014 ' : '';
        sim.addLog(who + line, 'Crew', 'good');
      };
      if (rec.kind === 'drive') {
        if (!rec.was || !rec.was.order || sh.order !== rec.put) continue;
        if (typeof sim.setOrder === 'function') sim.setOrder(id, rec.was.order);
        else sh.order = rec.was.order;
        if (!(sh.cmdThrottle > 0) && rec.was.throttle > 0) sh.cmdThrottle = rec.was.throttle;
        say(at + 'Back on ' + orderWords(rec.was.order) + '.');
      } else {
        const r = sh.radiators;
        if (!r || !rec.was || r.auto !== false || r.deployed !== false) continue;
        // 'auto' is a flag, not a state: the automatic rule runs under the computer's think, so a
        // hull the player is flying kept the flag and left the panels stowed. The trade took both
        // away, so both go back — the flag and the panels as they stood when it was taken.
        if (typeof sim.setRadiators === 'function') {
          sim.setRadiators(id, rec.was.auto ? 'auto' : !!rec.was.deployed);
          if (rec.was.auto) {
            const back = sim.byId(id);
            if (back && back.radiators) back.radiators.deployed = !!rec.was.deployed;
          }
        } else { r.auto = !!rec.was.auto; r.deployed = !!rec.was.deployed; }
        // What went back, named: the panels, and whether the ship is running them again herself.
        say(at + (rec.was.deployed
          ? (rec.was.auto ? 'The radiators are out again, and back on automatic.' : 'The radiators are out again.')
          : (rec.was.auto ? 'The radiators stay in, and back on automatic.' : 'The radiators stay in.')));
      }
    }
  }
  function setGMode(ship, mode) {
    const C = OD.Crew;
    if (!C || typeof C.setG !== 'function') return;
    try { C.setG(ship, mode); } catch (e) { /* the board keeps the mode it had */ }
  }

  // ---- the ship's routine settles what nobody answered (v13) -----------------------------------
  // A crew card nobody has touched for a minute after it reached the band is not a question any
  // more: the ship runs the option the card itself recommended, the log records it the way an
  // answer is recorded, and the card comes off the band.
  const SETTLES = { repair: 1, medical: 1, burn: 1 };
  // The routine runs itself every fifteen seconds, for the player's hull as much as for the
  // computer's, and it would send the party before the card had been read: the answer would then
  // land on a situation somebody else had already settled. So while a repair or medical card is
  // open for a hull the player is flying, the routine holds off — through OD.Crew.hold, which is
  // the crew module's own way of being left alone, and through the crew record's `auto` switch in
  // a build whose crew module has no hold. Either way it is given back when the card closes and on
  // any pass that finds no card open, so a hull can never be left with her routine switched off. A
  // burn card holds nothing: the routine sets the g mode for computer-flown hulls only, and those
  // are never asked.
  const HOLDS = { repair: 1, medical: 1 };
  function releaseRoutine(sim, ship) {
    const st = state(sim);
    const cr = ship && ship.crew;
    if (!cr || !ship || st.held[ship.id] === undefined) return;
    if (st.held[ship.id] === 'crew') crewHold(ship, 0);
    else cr.auto = st.held[ship.id];
    delete st.held[ship.id];
  }
  function crewHold(ship, secs) {
    const C = OD.Crew;
    if (!C || typeof C.hold !== 'function') return false;
    try { C.hold(ship, null, secs); } catch (e) { /* the routine carries on */ }
    return true;
  }
  function holdRoutine(sim, ship) {
    const st = state(sim);
    const cr = ship && ship.crew;
    if (!cr || !ship) return;
    const live = !ship.ai && (sim.decisions || []).some((d) => HOLDS[d.kind] && (d.ships || [d.shipId]).indexOf(ship.id) >= 0);
    // The crew module owns its own routine: the card says how long to leave the parties alone and
    // the routine honours it, rather than this module reaching in and switching `auto` off. The
    // switch is still there for a build whose crew module has no hold.
    const C = OD.Crew;
    if (C && typeof C.hold === 'function') {
      if (live) { crewHold(ship, T.autoAssign); st.held[ship.id] = 'crew'; }
      else if (st.held[ship.id] === 'crew') { crewHold(ship, 0); delete st.held[ship.id]; }
      return;
    }
    if (!live) { releaseRoutine(sim, ship); return; }
    if (st.held[ship.id] === undefined) { st.held[ship.id] = cr.auto !== false; cr.auto = false; }
  }
  // What the routine's answer left undone, in one sentence. The band's promise is that the lit
  // key is what happens if nobody speaks, so the line that records it says what it cost.
  function settleCost(sim, d, o, ship) {
    if (!o || !o.quiet) return '';
    if (d.kind === 'medical') {
      const b = crewBoard(ship);
      const k = b && b.crew;
      return k && k.wounded > 0 ? 'Nobody is in the sick bay: ' + k.wounded + ' stay wounded.' : '';
    }
    if (d.kind === 'repair') {
      const c = repairChoice(sim, ship, d._shape || null);
      const part = c && c.hurt && c.hurt[0];
      return part ? staysWords(part, ship, true) + '.' : '';
    }
    return '';
  }
  // The routine does what the card recommended, and never something else. It used to run
  // OD.Crew.auto instead, which takes the sensor watch first whatever the card had lit, so a
  // player who waited the minute out got the opposite of the option with the mark against it. The
  // move is logged the way an answered card is logged, with what it cost on the end.
  function settleByRoutine(sim, d) {
    const ship = sim.byId(d.shipId);
    if (!ship) return;
    const o = (d.options || []).find((x) => x.recommended) || (d.options || [])[0];
    if (!o) return;
    d._chose = o.id || null;
    d._settled = true;
    if (sim._decisions) sim._decisions.said = [];
    try { if (typeof o.act === 'function') o.act(sim); } catch (e) { /* the ship does what it can */ }
    if (typeof sim.addLog !== 'function') return;
    const cost = settleCost(sim, d, o, ship);
    sim.addLog('Decision: ' + d.title + ' \u2192 ' + o.label + ' \u00b7 the ship\u2019s routine.' +
      (cost ? ' ' + cost : ''), 'Bridge', 'good');
    flushSaid(sim);
  }
  // A repair or medical card whose own lit key is to leave the parties standing is a real answer,
  // and the player may well want it — but it must never take the band from a question about who is
  // shooting whom. Such a card yields: it is settled at once with its own pick, logged like any
  // other answer, the moment a kind above it in ORDER wants the band, and it never holds the
  // hull's slot against the kinds below it either. A chapter has been lost to a 'keep' card
  // displacing an aim card by sixty seconds.
  function yielding(d) {
    if (!d || !HOLDS[d.kind]) return false;
    const o = (d.options || []).find((x) => x.recommended);
    return !!(o && o.quiet);
  }
  function yieldTo(sim, ship, kind) {
    const rank = ORDER.indexOf(kind);
    for (let i = sim.decisions.length - 1; i >= 0; i--) {
      const d = sim.decisions[i];
      if (!speaksFor(d, ship.id) || !yielding(d)) continue;
      if (ORDER.indexOf(d.kind) <= rank) continue;
      settleByRoutine(sim, d);
      close(sim, d, 'lapsed');
    }
  }
  // When the routine takes an unanswered card: a minute after it reached the band, or, for one
  // that never got there at all, when any question's life is up.
  function settleDue(sim, d) {
    if (d.deadline != null && sim.time >= d.deadline) return true;
    return sim.time - d.openedAt > T.life;
  }
  // The minute starts when the card reaches the band, not when it was raised. A medical card that
  // spent its first fifty seconds behind an approach card was settled ten seconds after the player
  // first saw it, which is not a minute to think in.
  function noteBand(sim) {
    const d = current(sim);
    if (!d || !SETTLES[d.kind] || d.bandAt != null) return;
    d.bandAt = sim.time;
    d.deadline = sim.time + T.autoAssign;
  }

  // ---- the teaching paragraphs -----------------------------------------------------------------
  // The one sentence in the withdraw lesson that is about armour already gone. On a hull still
  // above half it is a sentence about somebody else's ship, and the card was printing it under
  // the title at 100 %, so it is composed in and taken back out by teachOf below.
  const WITHDRAW_HALF = 'With half of it gone every hit lands deeper than the last. ';
  const TEACH = {
    approach: 'Getting to a fight costs propellant and shows you to the other side. Burn hard and you arrive ' +
      'soonest. The drive is lit the whole way, and a plume is a firing solution for every hostile that can see ' +
      'it. Coast and you spend one short burn, then run dark until the brake. That costs less propellant and keeps ' +
      'you dim. It takes longer.',
    sensors: 'A solution is a track good enough to aim by, and the beams hold their fire until you have one. ' +
      'The active sensor buys a solution in about 20 s, and it announces you. Every hostile inside its range ' +
      'gets a solution on you as soon as it lights. The passive suite gives away nothing, and it needs time on ' +
      'the target or a shorter range.',
    radiators: 'The radiators shed the heat the ship makes. Extended, they glow, and that glow is ' +
      'most of what a hostile tracks you by. They are thin, so beams take them first. Stow them and you are dim ' +
      'and they cannot be shot off. Every joule the ship makes then stays in the heat sink. A full sink holds ' +
      'the drive to a quarter and stops every mount, point defence included, until it drains.',
    range: 'Range decides who can hurt whom. A beam spreads as it travels and armour soaks a fixed amount of it, ' +
      'so each beam has a distance inside which it gets through and outside which it does nothing. Her beams ' +
      'against your armour give a different distance. When yours is the longer one, there is a band where you can ' +
      'hit her and she cannot reach you.',
    salvo: 'Interceptors are small craft with their own drives, and the bays never reload. Her point defence ' +
      'shoots them down at a fixed rate while they close, so a salvo bigger than what she can stop in that flight ' +
      'time puts the rest of it aboard. A smaller salvo is spent for nothing. Every one you launch is one you do ' +
      'not have in the next fight.',
    cripple: 'A ship with no drive cannot manoeuvre or run. Board her, and if the party wins, the hull and crew are yours. That ' +
      'means matching her speed and holding station inside 3 km: 90 s against a crew the size of ours, longer ' +
      'against a bigger one. Finishing her off with full fire is quicker, and it leaves no prize to take home. ' +
      'Boarding holds you still for the whole crossing. That is dangerous while anything else on her side is ' +
      'shooting.',
    slugs: 'A coilgun slug is a lump of metal thrown at where you will be, and nothing steers it after that. Move ' +
      'a few ship lengths before it arrives and it passes into empty space. Jinking does that for you. It is a ' +
      'run of small random burns across her line of fire, and every dodge costs propellant. Holding still keeps ' +
      'a boarding match or a nose-on aim, and the slugs hit.',
    heat: 'Everything aboard makes heat, and in vacuum the only way to lose it is to radiate it. The heat sink is ' +
      'the tank it collects in. The radiators are the only drain. A full sink holds the drive to a quarter and ' +
      'stops every mount, point defence included, until it drains. Full fire is the most damage you can do and ' +
      'it fills the sink fastest. Sustained fire holds the beams to what the radiators shed, so the sink does ' +
      'not fill.',
    defend: 'The ships you are escorting cannot fight back, and anything shooting at them is shooting at the ' +
      'objective. Close on the attacker and kill her, and the shooting stops for good. That takes as long as ' +
      'the range takes to fly. Sit alongside the ship being shot at instead and your point defence covers her. ' +
      'That stops what is already in flight. Holding your station does neither.',
    withdraw: 'Armour is what keeps a hit out of the hull. ' + WITHDRAW_HALF +
      'Breaking off is one burn and then a coast, and outside her reach her beams do nothing. ' +
      'Getting behind a sister ship puts her point defence over you and her armour between you and the shooting. ' +
      'Staying in it is right when the fight is nearly over.',
    sink: 'Every joule the ship makes goes into the heat sink. A full sink holds the drive to a quarter and ' +
      'stops every mount, point defence included, until it drains. Only the radiators drain it, and only while ' +
      'they are extended. The two heat sources you can switch off are the beams and the drive.',
    capped: 'Her sink is full. A full sink holds the drive to a quarter and stops every mount, point defence ' +
      'included, until it drains. That lasts as long as her radiators need to catch up. Press her now and she ' +
      'cannot manoeuvre away or shoot back, and closing spends propellant and leaves you inside her reach when ' +
      'she cools. Holding the range spends nothing but the time.',
    aim: 'Beams go where the gunnery officer points them. The hull is the biggest thing to hit, so all of the ' +
      'shot lands on it. A smaller part takes a smaller share of the shot. Her radiators are thin and ' +
      'exposed, and they are the only cooling she has. Burn them off and she must stow what is left, and her ' +
      'sink fills with nothing to drain it.',
    repair: 'The crew works in parties, and a party can only be in one place. Send one to a hit part and its ' +
      'jury-rig brings that part some of the way back, never all of it, and the fire control or sensor watch it ' +
      'came off runs at 70 % until it returns.',
    burn: 'About 1.2 g is what people can work at, and above it the parties strap into their couches and a ' +
      'repair stops where it is until the burn ends. 3 g is the couch limit, and above that a corvette\u2019s ' +
      'crew takes about 2 wounded a minute for every g over.',
    medical: 'A party in the sick bay turns one wounded back to fit every 45 s, and with nobody there nobody ' +
      'comes back for the rest of the fight. Once the fit are under a third of the whole crew, fire control and ' +
      'the sensor watch both run at 70 % whatever the parties are doing.',
  };

  // One idea, one teaching string — and for a repair, the case in hand rather than the whole
  // lesson. The band printed 'A wrecked drive comes back to 30 % and no further. A holed tank is
  // isolated…' over a card about a drive at 40 %, which the same card priced at 70 %: two numbers
  // for one part, and two sentences about a situation the card is not in. The crew module writes
  // the per-case sentence when it has one; otherwise it is built from the cap the mend reaches.
  function teachCase(ship, partId) {
    const C = OD.Crew;
    if (C && typeof C.teachFor === 'function' && ship && partId) {
      try { const said = C.teachFor(ship, partId); if (typeof said === 'string' && said.length > 20) return said; } catch (e) { /* the rule below */ }
    }
    const D = OD.Damage;
    if (!ship || !partId || !D || typeof D.cap !== 'function' || !Array.isArray(ship.components)) return '';
    const c = ship.components.find((x) => x && x.id === partId);
    if (!c) return '';
    const name = partPhrase(c.name, partId, ship);
    let cap = null;
    try { cap = D.cap(ship, c); } catch (e) { cap = null; }
    if (cap == null || !isFinite(cap)) return '';
    const wrecked = (c.hp || 0) <= 0;
    if (/^tank/.test(String(partId)) && c.hp != null && c.hp <= 0.5) {
      return 'A repair in vacuum is a jury-rig: ' + name + ' is valved out of the feed, never refilled, and what vented is gone.';
    }
    if (wrecked) {
      return 'A repair in vacuum is a jury-rig: a wrecked ' + name.replace(/^the /, '') + ' reaches ' + pct(cap) +
        ' in one shift, and no further in this fight.';
    }
    return 'A repair in vacuum is a jury-rig: ' + name + ' comes back to ' + pct(cap) + ', never further.';
  }
  function teachOf(kind, ship, partId) {
    // Half the armour gone is what makes the armour sentence true. Above that line the card is
    // raised on the clock, and the lesson is read without it.
    if (kind === 'withdraw' && (ship && ship.hull != null ? ship.hull : 1) > 0.5) {
      return TEACH.withdraw.split(WITHDRAW_HALF).join('');
    }
    if (kind === 'repair') {
      const said = teachCase(ship, partId);
      if (said) return said;
      const C = OD.Crew;
      const whole = C && C.TEACH ? C.TEACH.juryRig : null;
      if (typeof whole === 'string' && whole.length > 120) return whole;
    }
    return TEACH[kind] || '';
  }
  const KINDS = ['approach', 'sensors', 'radiators', 'range', 'salvo', 'cripple', 'slugs', 'heat', 'defend', 'aim',
    'withdraw', 'sink', 'capped', 'repair', 'burn', 'medical'];
  // The order the triggers are read in, most urgent first: whatever kills someone soonest. A
  // question already open holds the hull's slot against anything less urgent than itself, and the
  // two repeaters the reviewers drowned in — the bays and the panels — sit at the bottom.
  // Our own hull going under, and our own sink saturating, come before anything about theirs.
  // The three crew kinds (v13) take their places by the same rule. 'repair' sits above everything
  // about how we fight: a hit drive or reactor is the thing that takes the hull out of the fight
  // next, and the sooner a party starts the sooner it is back, so the question is worth a slot
  // ahead of the range and the heat. It stays below the four that are about somebody dying now.
  // 'burn' goes with the course kinds, just above 'approach': it prices a cost the other course
  // cards cannot see, and answering one of them supersedes it. 'medical' sat above the bays alone
  // and was never seen: raised, shown for ten seconds, pushed off by an approach card and settled
  // by the routine a minute later with nobody ever having read it. It now goes above the four
  // routing kinds, which decide where the hull points rather than who is dying. Both it and
  // 'repair' give way of their own accord when their lit key is to leave the parties standing
  // (yielding(), below), so ranking them here costs the fight cards nothing.
  const ORDER = ['slugs', 'withdraw', 'defend', 'cripple', 'sink', 'repair', 'heat', 'burn', 'medical', 'approach',
    'capped', 'range', 'sensors', 'aim', 'radiators', 'salvo'];
  // Kinds that speak for a division rather than a hull: one card, every ship that is in the same
  // situation about the same hull, and the count in the title.
  const COLLAPSE = { approach: 1, radiators: 1, salvo: 1, slugs: 1, sensors: 1, range: 1, heat: 1, aim: 1, capped: 1,
    // One card for every hull that can go to her, so the group answers together and at one range.
    defend: 1,
    // Asked once for the ships in the same trouble, rather than once for each as she falls: six
    // withdraw cards in forty-three minutes was one question put six times.
    withdraw: 1,
    // One prize, one question. A skirmish raised 'ISV Resolve is out of the fight' three times in
    // the same second and three more ten minutes later — 6 of 26 cards about one hull — and the
    // answer was the same digit every time.
    cripple: 1 };

  // ---- the open list ---------------------------------------------------------------------------
  function state(sim) {
    let st = sim._decisions;
    if (!st) {
      st = sim._decisions = {
        n: 0, nextDetail: 0,
        due: Object.create(null),     // next trigger pass per ship
        cool: Object.create(null),    // { at, span, text, target } per (ship, kind)
        pending: Object.create(null),  // when a question for an unselected hull first came up
        bite: Object.create(null),    // the burn-through memory per pair
        track: Object.create(null),   // the worst track quality per pair
        burn: Object.create(null),    // break-off burns this module owes an end to
        recent: Object.create(null),  // when a kind about a hull was last answered
        panel: Object.create(null),   // the last answer that moved a hull's panels, and why
        course: Object.create(null),  // when a hull's course was last decided by an answer
        coast: Object.create(null),   // the coast an answer stowed the panels for, and the hull it is aimed at
        quiet: Object.create(null),   // when a hull last had a card of her own on the band
        loud: Object.create(null),    // when a falling hull's silence last opened the gates
        board: Object.create(null),   // the prize a hull is holding her fire for
        hot: Object.create(null),     // whether a hull's sink was over the re-arm load last pass
        asked: Object.create(null),   // how many times a kind has been put to a hull, and refused
        kindAt: Object.create(null),  // when a kind was last put to one hull
        reask: Object.create(null),   // when a hull's own armour put the break-off question back
        hurt: Object.create(null),    // the hurt parts a hull carried last pass, and when one was added
        held: Object.create(null),     // hulls whose routine a crew card is holding, and what it was
        askedPart: Object.create(null), // parts a repair card has already been put about, per hull
        trail: Object.create(null),    // a minute of each hull's armour, sampled, for the cards' own clock
        strap: Object.create(null),    // hulls the long-burn rung has been put to once this engagement
        clear: Object.create(null),    // orders and panel settings a trade cleared for a party, to give back
        cripple: Object.create(null),  // when a prize was last the subject of a card, whoever asked
        guard: null, guardAt: -1e9,
        balance: null, balanceAt: -1e9,
      };
      sim.decisions = [];
      sim.decisionSeq = 0;
    }
    if (!Array.isArray(sim.decisions)) sim.decisions = [];
    if (typeof sim.decisionSeq !== 'number') sim.decisionSeq = 0;
    return st;
  }
  function init(sim) {
    if (!sim) return;
    sim._decisions = null;
    state(sim);
  }
  const coolKey = (shipId, kind) => shipId + '|' + kind;
  // A kind is capped against the hull it is about and the hull it is about her: 'withdraw, again,
  // about the same frigate' is the card that wore the reviewers out, while a second prize a
  // chapter later is a new question.
  const askKey = (shipId, kind, targetId) => shipId + '|' + kind + '|' + (targetId || '');
  // A kind that has had its turns at this hull, or that the player has waved off twice, is done;
  // and a kind put to one hull holds off the next for a moment, so three cards of one kind in
  // sixty-six seconds cannot happen across two hulls.
  function overAsked(sim, st, ship, kind, targetId, urgent) {
    if (urgent) return false;
    // One prize, one question a minute, whoever is pointing at her. The kind gap is cleared
    // whenever a card is superseded, and two cards about ISV Assurance forty-six seconds apart got
    // through that way; this record is not cleared by anything but the next engagement.
    if (kind === 'cripple' && targetId) {
      const at = st.cripple[targetId];
      if (at != null && sim.time >= at && sim.time - at < T.crippleGap) return true;
    }
    const rec = st.asked[askKey(ship.id, kind, targetId)];
    if (rec && (rec.refused >= T.refusals || rec.n >= T.askCap)) return true;
    // The gap is this hull's, not the band's: a corvette asked about the range does not silence
    // the same question for her two sisters. Withdraw is the exception it already was, asked once
    // for the whole force. Naming a different hull is a different question and clears the gap, the
    // way the cooldown already lets a new designation through.
    // Cripple is capped on the prize rather than on the asker: one hull out of the fight is one
    // question, whoever happens to be pointing at her.
    const key = kind === 'withdraw' ? '|withdraw'
      : kind === 'cripple' ? '|cripple|' + (targetId || '')
        : ship.id + '|' + kind;
    const rec2 = st.kindAt[key];
    const gap = kind === 'withdraw' ? T.withdrawGap : T.kindGap;
    if (!rec2 || sim.time < rec2.at) return false;
    // The break-off gap is the force's, so that one hull's question does not put the same one to
    // her sisters. A hull that has lost a fifth of her armour since her own last answer is not a
    // sister being asked along: it is her fight changing under her. Chapter 4's corvette answered
    // 'Press on' at full armour at 275 s, the force gap ran to 510 s, and she was out of the fight
    // at 512 s having never been asked again.
    const back = kind === 'withdraw' ? st.reask[ship.id] : null;
    if (back != null && back >= rec2.at && sim.time >= back) return false;
    if (rec2.target && targetId && rec2.target !== targetId) return false;
    return sim.time - rec2.at < gap;
  }
  // The same hull is not asked the same kind again until its cooldown has run, and the cooldown
  // doubles every time the question is waved away rather than answered. A question whose situation
  // sentence has not changed a word since the last answer is not asked again at all: nothing moved.
  function cool(sim, st, shipId, kind, targetId, text, urgent) {
    const r = st.cool[coolKey(shipId, kind)];
    if (!r) return false;
    // A hull locked in a saturated sink is asked again every couple of minutes whatever the
    // cooldown says and whatever the words: here the situation not moving is the emergency, so the
    // unchanged-text rule — which is what kept the band silent for eighty minutes — does not apply.
    if (urgent) return sim.time - r.at < T.lockRepeat;
    // 'Hold and watch' costs nothing and decides nothing, so it is put again a couple of minutes
    // later rather than held shut for the whole cooldown: ten dead minutes at a thousand
    // kilometres is what the full span bought the reviewers. A dismissal still doubles.
    if (r.hold && sim.time - r.at >= T.holdAgain) return false;
    // Nothing in the situation sentence has moved a word since the last answer: nothing has
    // changed, so there is nothing to ask. It holds for as long as the longest cooldown, not for
    // ever, so the same words an hour later are a new question.
    if (text && r.text === text && sim.time - r.at < T.cooldownMax) return true;
    // Naming a new hull is a new question: the approach and range cards come back aimed at her,
    // and a frigate walking into knife range is not answered by what we decided about a cruiser.
    if ((kind === 'approach' || kind === 'range') && targetId && r.target && r.target !== targetId) return false;
    return sim.time - r.at < r.span;
  }
  // The kinds whose answers fly the ship somewhere. Two of them inside a minute is the band
  // arguing with itself, and every round of that argument costs the drive a burn.
  const COURSE = { approach: 1, defend: 1, range: 1, withdraw: 1, capped: 1, cripple: 1, burn: 1 };
  // Kinds that are about an event rather than a state. Rounds in flight either arrive or miss, and
  // the next volley is a new question: a lapsed one must not put the jink question behind a
  // ten-minute cooldown, which is how a corvette took two slugs through her tail without being
  // asked.
  const EVENT = { slugs: 1 };
  // `answered` is true for an answer, false for a dismissal, and 'lapsed' when the situation went
  // away on its own. Only a dismissal is a refusal: the player waved it off.
  function noteClosed(sim, st, d, answered) {
    // One kind owns the panels at a time, and one question about closing on a hull is enough for a
    // minute: both gates read this.
    if (answered) {
      st.recent[d.kind + '|' + (d.targetId || '')] = sim.time;
      if (COURSE[d.kind]) for (const id of d.ships || [d.shipId]) st.course[id] = sim.time;
    }
    const lapsed = answered === 'lapsed';
    for (const id of d.ships || [d.shipId]) {
      if (answered === false) {
        const k = askKey(id, d.kind, d.targetId);
        const r = st.asked[k] || (st.asked[k] = { n: 0, refused: 0 });
        r.refused++;
      }
      const key = coolKey(id, d.kind);
      if (lapsed && EVENT[d.kind]) { delete st.cool[key]; continue; }
      const prev = st.cool[key];
      // The gunnery question is asked once a fight, not once a cooldown: after it, the aim key is
      // the player's and the band has nothing new to say about it. A dismissal doubles the wait; a
      // question that lapsed on its own starts again from the plain cooldown.
      const span = prev && !lapsed ? (answered ? prev.span : Math.min(T.cooldownMax, prev.span * 2)) : T.cooldown;
      // The comparison is against the first-person sentence, so selecting another hull — which
      // rewrites every card in the third person — is not mistaken for the situation moving.
      const sh = sim.byId(id);
      st.cool[key] = { at: sim.time, span, text: d.plain || d.text, target: d.targetId || null,
        hull: sh && sh.hull != null ? sh.hull : null,
        hold: !!answered && d.kind === 'approach' && d._chose === 'hold' };
    }
  }
  // The last answer that moved this hull's panels: which way, and what the situation was when it
  // was given. The radiators card reads it twice — once to keep quiet while an opposite answer is
  // still fresh, once to say what changed when it does speak again.
  function panelAnswer(sim, ship) {
    const rec = state(sim).panel[ship.id];
    if (!rec || sim.time < rec.at) return null;
    return Object.assign({ age: sim.time - rec.at }, rec);
  }
  function notePanel(sim, d, dir) {
    const st = state(sim);
    for (const id of d.ships || [d.shipId]) {
      const sh = sim.byId(id);
      if (!sh) continue;
      const foe = d.targetId ? sim.byId(d.targetId) : nearestWarship(sim, sh, false);
      const tb = foe ? bites(sim, sh, foe).theirs : 0;
      const sig = signatureOf(sh);
      st.panel[id] = {
        at: sim.time, dir, kind: d.kind,
        exposed: !!(foe && tb > 0 && U.dist(sh.pos, foe.pos) <= T.radiatorReach * tb),
        share: sig && sig.total > 0 ? sig.radiators / sig.total : 0,
      };
    }
  }
  // A sink crossing the re-arm load is a different situation from the one that was answered, so it
  // clears the cooldowns on the questions about it. Without this, a hull that was told to stow at
  // 735 s saturated at 1 016 s and the band had nothing to say for the next eighty minutes.
  function rearm(sim, st, ship) {
    const load = typeof ship.thermalLoad === 'function' ? ship.thermalLoad() : 0;
    // Three bands, and every crossing between them is a new situation: a sink that has filled since
    // the last answer, and a sink that has drained since it, are both worth asking about again.
    const band = load >= T.reArm ? 2 : load <= T.gunsCold ? 0 : 1;
    if (st.hot[ship.id] !== band && st.hot[ship.id] !== undefined && band !== 1) {
      delete st.cool[coolKey(ship.id, 'heat')];
      delete st.cool[coolKey(ship.id, 'sink')];
    }
    st.hot[ship.id] = band;
    // A hull that has lost a fifth of her armour since the last time the question was put is in a
    // different fight, and the ten-minute cooldown is the wrong answer to it. Chapter 4's corvette
    // answered 'Press on' at full armour at 275 s and was out of the fight at 512 s with nothing
    // on the band in between: the withdraw question comes back on the armour, cooldown or no
    // cooldown, which is the one gate the quiet-fight rule cannot reach while other cards are
    // still speaking for her.
    const wk = coolKey(ship.id, 'withdraw');
    const wc = st.cool[wk];
    const hull = ship.hull != null ? ship.hull : 1;
    if (wc && wc.hull != null && hull < wc.hull - T.hullDrop) {
      delete st.cool[wk];
      // The force-wide gap goes with the cooldown: both were written for a hull whose fight had
      // not changed, and this one's has.
      st.reask[ship.id] = sim.time;
      // The three-a-fight cap goes with it. Chapter 2 answered 'Press on' three times, the last at
      // 1 225 s, and Larkspur was out at 1 843 s with ISV Sabre at 18 % and the cap holding the
      // question shut for the whole of the last ten minutes.
      for (const k of Object.keys(st.asked)) {
        if (k.indexOf(ship.id + '|withdraw|') !== 0) continue;
        const r = st.asked[k];
        if (r && r.n > 0 && r.refused < T.refusals) r.n = 0;
      }
    }
  }
  // A hull already flying a break-off is not asked where to be: the answer that bought the burn is
  // her course until it runs out. Chapter 4's corvette broke off at 417 s with 71 % of her armour,
  // and a division range card at 505 s — 'Close to 233 km', speaking for all three hulls — flew her
  // straight back inside ISV Coriolis's beams. She was out of the fight ninety seconds later.
  function breakingOff(sim, st, ship) {
    const rec = ship && st.burn ? st.burn[ship.id] : null;
    if (!rec) return false;
    const o = ship.order;
    return !!(o && o.breakTag === rec.tag);
  }
  const hasAnyOpen = (sim, shipId) => (sim.decisions || []).some((d) => (d.ships || [d.shipId]).indexOf(shipId) >= 0);
  // A hull losing armour with nothing on the band is the band failing. Fifteen to twenty-nine
  // minutes of exactly that is what the reviewers sat through: after four quiet minutes with the
  // hull still falling, the two questions about how we are fighting her come back, cooldown or no
  // cooldown, because whatever was decided last is plainly not working.
  function quietFight(sim, st, ship) {
    const hull = ship.hull != null ? ship.hull : 1;
    const rec = st.quiet[ship.id];
    if (!rec || sim.time < rec.at) { st.quiet[ship.id] = { at: sim.time, hull, loudAt: null }; return; }
    // A card of her own restarts the clock, whatever it was about.
    if (hasAnyOpen(sim, ship.id)) { rec.at = sim.time; rec.hull = hull; rec.loudAt = null; return; }
    if (sim.time - rec.at < T.quietFight) return;
    // Armour comes off in bursts, not at a steady rate, so what decides this is what she has lost
    // since the last card rather than what she happens to be losing this second.
    if (!(rec.hull - hull > 0.01)) return;
    if (rec.loudAt != null && sim.time >= rec.loudAt && sim.time - rec.loudAt < 30) return;
    rec.loudAt = sim.time;
    // The cooldowns go, and the range question's own band goes with them: a hull being taken
    // apart at a range nobody's card happens to cover is exactly the hull with nothing to answer.
    st.loud[ship.id] = sim.time;
    for (const kind of ['range', 'aim', 'withdraw']) delete st.cool[coolKey(ship.id, kind)];
    // The cooldowns were never the only gate on the break-off question. The force-wide gap and the
    // three-a-fight cap sit in front of it too, and clearing a cooldown that three answers have
    // already spent buys nothing: chapter 2's corvette had withdraw at 3 of 3 asks at 1 225 s and
    // went from 1 485 s to the end of the chapter with no card of any kind, her armour 31 % → 15 %.
    // A hull losing armour with her band silent is exactly the hull the cap was never meant to
    // shut up, so the gap and the cap go with the cooldowns — dismissals still stand.
    st.reask[ship.id] = sim.time;
    for (const k of Object.keys(st.asked)) {
      if (k.indexOf(ship.id + '|withdraw|') !== 0) continue;
      const r2 = st.asked[k];
      if (r2 && r2.n > 0 && r2.refused < T.refusals) r2.n = 0;
    }
  }
  // A falling hull whose band has been silent: for the next minute the range question is asked
  // anywhere inside her guns rather than only in the narrow band where it is normally decided.
  const silentFalling = (sim, ship) => {
    const st = state(sim);
    const at = st.loud[ship.id];
    return at != null && sim.time >= at && sim.time - at < 30;
  };
  // A boarding run that never happened. sim.js gives the weapons back when the prize is taken or
  // the party is recalled; this is the other end of it — an order flown off, a prize somebody else
  // took, a target gone — so a hull that held her fire for a boarding cannot spend the rest of the
  // chapter disarmed with nothing on the band to tell her so.
  function endBoardings(sim, st) {
    for (const id of Object.keys(st.board)) {
      const rec = st.board[id];
      const sh = sim.byId(id);
      if (!sh || !sh.heldFireForBoarding) { delete st.board[id]; continue; }
      const prize = rec.target ? sim.byId(rec.target) : null;
      const running = !!prize && !prize.destroyed && !prize.captured && sim.isHostile(prize, sh) &&
        !!sh.order && sh.order.type === 'intercept' && sh.order.target === rec.target;
      if (running) continue;
      delete st.board[id];
      sh.heldFireForBoarding = false;
      sh.weaponsFree = true;
    }
  }
  // The bridge has just answered a question about where to be relative to this hull: whatever it
  // chose is the answer to the next question about her too, for a minute at least. Without this the
  // band spends a fight arguing with itself, and every argument costs the drive a burn.
  function justOrdered(sim, targetId) {
    if (!targetId) return false;
    for (const kind of ['approach', 'defend', 'range', 'withdraw', 'capped']) {
      if (since(sim, kind, targetId) < T.defendGrace) return true;
    }
    return false;
  }
  // How long ago a kind about this hull was answered, in seconds, or Infinity.
  function since(sim, kind, targetId) {
    const st = state(sim);
    const at = st.recent[kind + '|' + (targetId || '')];
    return at == null || sim.time < at ? Infinity : sim.time - at;
  }
  // One kind owns the panels at a time. While a heat, sink or withdraw card is open for this hull,
  // or has just been answered, nothing else offers to move them: 'Stow the radiators' at t = 1 and
  // 'Extend the radiators' at t = 19 is not two decisions, it is one question asked twice.
  function panelsOwned(sim, ship) {
    if (coastOwnsPanels(sim, ship)) return true;
    for (const d of sim.decisions || []) {
      if (d.kind !== 'heat' && d.kind !== 'sink' && d.kind !== 'withdraw') continue;
      if ((d.ships || [d.shipId]).indexOf(ship.id) >= 0) return true;
    }
    const st = state(sim);
    for (const kind of ['heat', 'sink', 'withdraw']) {
      const rec = st.cool[coolKey(ship.id, kind)];
      if (rec && sim.time >= rec.at && sim.time - rec.at < T.panelGrace) return true;
    }
    return false;
  }
  // Any card of this kind carrying this hull, whatever it is aimed at.
  function hasKindOpen(sim, shipId, kind) {
    for (const d of sim.decisions) {
      if (d.kind !== kind) continue;
      if ((d.ships || [d.shipId]).indexOf(shipId) >= 0) return true;
    }
    return false;
  }
  function openFor(sim, shipId, kind, targetId) {
    for (const d of sim.decisions) {
      if (d.kind !== kind) continue;
      if ((d.ships || []).indexOf(shipId) < 0) continue;
      if (d.targetId === (targetId || null)) return true;
    }
    return false;
  }
  function find(sim, id) {
    for (const d of sim.decisions) if (d.id === id) return d;
    return null;
  }
  const speaksFor = (d, shipId) => !!shipId && ((d.ships || []).indexOf(shipId) >= 0);

  // Keys are handed out in order, and exactly one option is ever the recommended one. The band
  // only redraws when the sequence moves, so a rebuild that changes a label, the number of keys or
  // which one is lit moves it: the player must never read one option's label over another's act.
  function fill(sim, d) {
    const ship = sim.byId(d.shipId);
    if (!ship) return;
    const target = d.targetId ? sim.byId(d.targetId) : null;
    retitle(sim, d);
    let list = null;
    // A card whose builder throws used to leave no trace at all: the question simply never
    // appeared, and the kind looked untriggered. Once per kind per engagement, say so out loud.
    try { list = d._build(sim, d, ship, target); } catch (e) { noteBuildError(sim, d.kind, e); list = null; }
    if (!list || !list.length) return; // keep the last good set rather than empty the band
    list = list.filter((o) => o);
    // An option that moves the number it is about by less than a tenth is not a choice; it is
    // noise with a key on it. Two options are always left, whatever the numbers say.
    const worth = list.filter((o) => !(o.benefit != null && o.benefit < T.minBenefit));
    if (worth.length >= 2) list = worth;
    // An option the card itself prices at nothing — a salvo her point defence stops whole, beams
    // throttled to 0 %, an aim point the shot cannot land on — is not a choice with a key on it.
    // It comes off the board. A card left with one live option is handled by the caller: a
    // question with one answer is not a question.
    const alive = list.filter((o) => !o.dead);
    list = alive;
    if (!list.length) return;
    // The options go dead while the card is open too — an aim point the shot stops landing on, a
    // salvo her point defence grows into. A question with one answer left is not a question, so it
    // is taken off the band the way it would never have been raised, and the log says what the one
    // answer was.
    // A trade cleared the drive or the panels and a party is on the part now. Any key that would
    // light the drive again or put the panels back out stops that repair where it stands, and it
    // says so on the key; none of them is the lit pick. On the recommended pick alone the card
    // after the trade used to undo it — 'Stow the panels for 3 min' and then 'Extend the
    // radiators' — and the mend never landed.
    const held = heldRepair(sim, ship);
    if (held) {
      for (const o of list) {
        if (!(held.kind === 'drive' ? o.burns : o.panel === 'out')) continue;
        o.noRec = true;
        const says = 'this puts ' + partyLower(held.party) + '\u2019s repair down';
        if (clausesOf(o.detail).indexOf(says) < 0) o.detail = says + (o.detail ? DOT + o.detail : '');
      }
    }
    d._starved = list.length < 2 ? (list[0].label || true) : null;
    // Every hull this card speaks for acts on the same key, matched by the option's own id.
    if ((d.ships || []).length > 1) {
      const others = [];
      for (const id of d.ships) {
        if (id === d.shipId) continue;
        const sh = sim.byId(id);
        if (!eligible(sim, sh)) continue;
        let l2 = null;
        try { l2 = d._build(sim, d, sh, target); } catch (e) { l2 = null; }
        if (l2 && l2.length) others.push(l2.filter((o) => o));
      }
      if (others.length) {
        list = list.map((o) => {
          const acts = [o.act];
          for (const l2 of others) { const m = l2.find((x) => x.id === o.id); if (m && typeof m.act === 'function') acts.push(m.act); }
          if (acts.length < 2) return o;
          return Object.assign({}, o, { act: (s) => { for (const a of acts) { try { if (typeof a === 'function') a(s); } catch (e) { /* the rest still act */ } } } });
        });
      }
    }
    // The recommendation, under the two rules: never a passive answer while we are pressing a
    // fight we can win or a ship we guard is being shot at, and never an option the card itself
    // has marked as not worth recommending (sustained fire at nothing, a launch that arrives dead).
    let press = false;
    try { press = pressing(sim, ship, target); } catch (e) { press = false; }
    d.pressing = press;
    const ok = (o) => !o.noRec && !(press && o.passive);
    let rec = -1;
    for (let i = 0; i < list.length && i < 3; i++) if (list[i].recommended && ok(list[i])) { rec = i; break; }
    if (rec < 0) for (let i = 0; i < list.length && i < 3; i++) if (ok(list[i])) { rec = i; break; }
    // Of the two rules the press rule is the stronger one: with a fight to press, an answer the
    // card itself is lukewarm about still beats one that steps out of it. Chapter 4's heat card
    // lit 'Break off and cool' at 820 s with ISV Coriolis at 98 % and the objective open.
    // `never` is the stronger of the two marks: not 'the card is lukewarm about this' but 'this
    // key does not do what it says' — a burn rung the tanks cannot pay for, a boarding the decks
    // would throw back. A fight to press does not light one of those.
    if (rec < 0) for (let i = 0; i < list.length && i < 3; i++) if (!(press && list[i].passive) && !list[i].never) { rec = i; break; }
    if (rec < 0) for (let i = 0; i < list.length && i < 3; i++) if (!list[i].noRec && !list[i].never) { rec = i; break; }
    if (rec < 0) for (let i = 0; i < list.length && i < 3; i++) if (!list[i].never) { rec = i; break; }
    if (rec < 0) rec = 0;
    const opts = [];
    const shown = list.slice(0, 3).map((o) => headOf(o.detail || ''));
    const behind = [];
    // The card's own head: its title and its sentence. A leftover clause either of them already
    // carries is not worth reading again, in the words or in the numbers. The withdraw card put
    // '68 % of hull left' behind the Why? key under the title 'We are down to 68 % of our hull',
    // which is the same fact twice in two shapes, so the numbers are compared as well as the text.
    const head = String(d.title || '') + ' ' + String(d.text || '');
    const numsOf = (t) => (String(t).replace(/(\d)[\s\u00a0\u202f](?=\d)/g, '$1').match(/\d+(?:\.\d+)?/g) || []);
    const headNums = numsOf(head);
    const carried = (c) => {
      if (head.indexOf(c) >= 0) return true;
      const ns = numsOf(c);
      return ns.length > 0 && ns.every((n) => headNums.indexOf(n) >= 0);
    };
    // A clause read on its own is a sentence, not an item in a list: the first one runs on from
    // the key's label, the rest stand by themselves.
    const sentences = (cs) => cs.map((c, i) => {
      const t = String(c).trim();
      const w = i > 0 ? t.charAt(0).toUpperCase() + t.slice(1) : t;
      return /[.!?]$/.test(w) ? w : w + '.';
    }).join(' ');
    for (let i = 0; i < list.length && i < 3; i++) {
      const full = list[i].detail || '';
      // A clause that is already on another key, or in the card's own title or sentence, is not
      // worth repeating behind the Why? key: it was cut because there was no room for it, not
      // because the player has not read it.
      const rest = clausesOf(tailOf(full)).filter((c) => shown.every((h) => h.indexOf(c) < 0) && !carried(c));
      // The key's name, not the whole label: a label that already carries a clause of its own
      // ('Break off: she can match the burn') would put two colons in one line.
      if (rest.length) behind.push(String(list[i].label).split(': ')[0] + ': ' + sentences(rest));
      opts.push({
        key: String(i + 1), id: list[i].id || 'o' + (i + 1),
        label: list[i].label, detail: headOf(full), more: rest.join(DOT),
        recommended: i === rec, quiet: !!list[i].quiet, panel: list[i].panel || null, act: list[i].act,
      });
    }
    // Three clauses is what a key holds. What would not fit is read here, behind the Why? key,
    // under the paragraph that teaches the kind. The paragraph said so out loud twice before it
    // said anything; a reader who has opened Why? can see that these are the keys' own words.
    d.teach = behind.length ? (d._teach ? d._teach + ' ' : '') + behind.join(' ') : d._teach || '';
    const was = d.options || [];
    let moved = was.length !== opts.length;
    for (let i = 0; i < opts.length && !moved; i++) moved = was[i].label !== opts[i].label || was[i].recommended !== opts[i].recommended;
    d.options = opts;
    if (moved && was.length) sim.decisionSeq++;
  }
  // What each kind is about, in the words the log uses when the question is not worth putting.
  const SUBJECT = {
    approach: 'how we close', sensors: 'the sensors', radiators: 'the radiators', range: 'the range',
    salvo: 'the bays', cripple: 'the cripple', slugs: 'the slugs inbound', heat: 'the heat',
    defend: 'the escort', aim: 'where the beams go', withdraw: 'breaking off', sink: 'the sink',
    capped: 'her silence',
    repair: 'the repair parties', burn: 'the burn', medical: 'the wounded',
  };
  // A question that came to one answer, said once per hull and kind: the band stays quiet and the
  // log carries the reason, so a kind that has gone silent can be read rather than guessed at.
  function noteSkip(sim, ship, kind, why) {
    const st = state(sim);
    if (!st.skipped) st.skipped = Object.create(null);
    const key = (ship ? ship.id : '?') + '|' + kind;
    if (st.skipped[key]) return;
    st.skipped[key] = { at: sim.time, why };
    if (typeof sim.addLog === 'function') {
      sim.addLog((ship && ship.name ? ship.name + ': ' : '') + 'nothing to decide about ' +
        (SUBJECT[kind] || kind) + '. The only answer worth anything is ' + why + '.', 'Bridge', 'info');
    }
  }
  function noteBuildError(sim, kind, e) {
    const st = state(sim);
    if (!st.broke) st.broke = Object.create(null);
    if (st.broke[kind]) return;
    st.broke[kind] = true;
    if (window.OD && Array.isArray(OD.errors)) OD.errors.push('Decisions: building the ' + kind + ' card threw: ' + (e && e.stack ? e.stack : e));
  }
  function refresh(sim, d) {
    if (!sim || !d || typeof d._build !== 'function') return;
    fill(sim, d);
  }
  // The card's own words, rebuilt every pass: how many hulls it speaks for, and whose voice it is
  // in. A title or a sentence may be a function of (sim, ship, third) when a kind wants to say it
  // differently about another ship rather than have the words translated for it.
  function retitle(sim, d) {
    const ship = sim.byId(d.shipId);
    const sel = selectedId();
    d.third = !!ship && !!sel && !speaksFor(d, sel);
    const say = (v, third) => {
      if (typeof v === 'function') { try { return v(sim, ship, third) || ''; } catch (e) { return ''; } }
      return v || '';
    };
    const n = (d.ships || []).length;
    let base = say(d._base, d.third);
    // The band shows another ship's card with her name in the eyebrow, but the title has to stand
    // on its own in a toast, in the log and read aloud: if it does not name her, it says nothing.
    if (d.third && ship && ship.name && base.indexOf(ship.name) < 0) {
      // lower case only for an ordinary sentence ('How do we close'); 'Conamara Station is under fire' keeps its name
      base = ship.name + ': ' + (/^[A-Z][a-z]*\s+[a-z]/.test(base) ? base.charAt(0).toLowerCase() + base.slice(1) : base);
    }
    // the count follows the words without a full stop between them ('Pick the range · 3 ships')
    d.title = n > 1 ? base.replace(/\.$/, '') + ' · ' + n + ' ships' : base;
    d.text = say(d._text, d.third);
    d.plain = say(d._text, false); // the first-person sentence the cooldown compares against
  }
  function open(sim, st, ship, kind, target, spec) {
    // The long-burn rung is one question a hull is asked once an engagement. Chapter 6 raised five
    // copies of the same card — 'Above 1.2 g the parties are in the couches, and this burn runs
    // 16m 39s. Nothing can be repaired for any of it.' — differing only in the g and the arrival,
    // on a chapter that repaired nothing either way. The first is the card; every repeat after it
    // is one line in the log.
    if (kind === 'burn' && spec.longRung && st.strap[ship.id] != null) {
      noteLongBurn(sim, st, ship, target, spec.longRung);
      return null;
    }
    const d = {
      id: 'dec' + ++st.n,
      kind,
      shipId: ship.id,
      ships: [ship.id],
      targetId: target ? target.id : null,
      _base: spec.title,
      _text: spec.text,
      title: '',
      text: '',
      teach: spec.teach != null ? spec.teach : teachOf(kind, ship, spec.partId),
      _teach: spec.teach != null ? spec.teach : teachOf(kind, ship, spec.partId),
      options: [],
      // A crew card: the parties or the burn, with a deadline the ship settles at. The band reads
      // it for its third button ('Let the crew decide', not 'Later') and for the countdown.
      crew: !!SETTLES[kind],
      until: spec.until,
      // The shape a repair card was raised in, read by the settle so the line it prints is about
      // the card the player was shown.
      _shape: spec.shape || null,
      openedAt: sim.time,
      _build: spec.build,
      _supersede: spec.supersede || null,
    };
    fill(sim, d);
    // One key is not a question. When everything but a single option has been priced at nothing,
    // the card is not raised at all and the bridge says so once, so the fact is on the record
    // rather than lost in a band that never appeared.
    if (d.options.length < 2) { if (d.options.length) noteSkip(sim, ship, kind, d.options[0].label); return null; }
    sim.decisions.push(d);
    gather(sim, st, d, kind);
    for (const id of d.ships || [ship.id]) {
      const k = askKey(id, kind, d.targetId);
      const r = st.asked[k] || (st.asked[k] = { n: 0, refused: 0 });
      r.n++;
    }
    for (const id of d.ships || [d.shipId]) st.kindAt[id + '|' + kind] = { at: sim.time, target: d.targetId || null };
    if (kind === 'withdraw') st.kindAt['|withdraw'] = { at: sim.time, target: null };
    if (kind === 'cripple' && d.targetId) {
      st.kindAt['|cripple|' + d.targetId] = { at: sim.time, target: d.targetId };
      st.cripple[d.targetId] = sim.time;
    }
    // A part is a question once a fight. Without that a radiator the player keeps refusing is
    // asked about again every time the routine's window opens, and one panel owns the band.
    if (kind === 'repair' && spec.partId) st.askedPart[ship.id + '|' + spec.partId] = sim.time;
    if (kind === 'burn' && spec.longRung) st.strap[ship.id] = sim.time;
    sim.decisionSeq++;
    return d;
  }
  // The same burn, a second time: the log takes it instead of the band. The kind takes the
  // cooldown an answered card would have taken, so the next line is ten minutes off rather than
  // the next trigger pass.
  function noteLongBurn(sim, st, ship, target, rung) {
    st.cool[coolKey(ship.id, 'burn')] = { at: sim.time, span: T.cooldown, text: null,
      target: target ? target.id : null, hull: ship.hull != null ? ship.hull : null, hold: false };
    if (typeof sim.addLog !== 'function') return;
    sim.addLog((ship.name ? ship.name + ': ' : '') + 'the burn' +
      (target && target.name ? ' on ' + target.name : '') + ' runs ' + time(rung.secs) + ' above ' +
      gs(rung.limit) + '. The parties are in the couches for all of it, and this question was put once already.',
      'Bridge', 'info');
  }
  // A question raised for one hull is raised for every hull in the same situation, in the same
  // breath. The trigger pass reaches one ship at a time, so a player who answers the moment a card
  // appears was sending one hull into the fight and leaving her sisters holding: chapter 4's
  // corvette closed to 220 km alone while the frigate and the destroyer behind her never got the
  // question at all.
  function gather(sim, st, d, kind) {
    if (!COLLAPSE[kind]) return;
    for (const other of sim.ships) {
      if ((d.ships || []).length >= T.collapseMax) break;
      if (other.id === d.shipId || !eligible(sim, other) || handsOff(sim, other)) continue;
      if (COURSE[kind] && breakingOff(sim, state(sim), other)) continue;
      if (openFor(sim, other.id, kind, d.targetId)) continue;
      let spec = null;
      try { spec = TRIGGERS[kind](sim, other); } catch (e) { spec = null; }
      const same = !!spec && (spec.target ? spec.target.id : null) === d.targetId;
      // A hull already flying at the same hostile is in the same question about the range, even
      // when she is still too far out for the card to have found her on her own. Chapter 4's own
      // brief says it: keep range on her with all three ships. One hull at a time is how the
      // corvette ended up inside a destroyer's beams seven minutes before her consorts.
      const joins = !same && kind === 'range' && !!d.targetId && !hasKindOpen(sim, other.id, kind) &&
        !!(other.order && other.order.target === d.targetId);
      if (!same && !joins) continue;
      if (spec) {
        let plain = spec.text;
        if (typeof plain === 'function') { try { plain = plain(sim, other, false); } catch (e) { plain = ''; } }
        if (cool(sim, st, other.id, kind, d.targetId, plain)) continue;
      }
      d.ships.push(other.id);
    }
    if ((d.ships || []).length > 1) { retitle(sim, d); fill(sim, d); }
  }
  // The same question, for another hull, about the same enemy: one card that speaks for both.
  function collapse(sim, ship, kind, target) {
    if (!COLLAPSE[kind]) return false;
    const tid = target ? target.id : null;
    for (const d of sim.decisions) {
      if (d.kind !== kind || d.targetId !== tid) continue;
      if ((d.ships || []).indexOf(ship.id) >= 0) return true;
      if ((d.ships || []).length >= T.collapseMax) continue;
      d.ships.push(ship.id);
      retitle(sim, d);
      fill(sim, d);
      sim.decisionSeq++;
      return true;
    }
    return false;
  }
  function close(sim, d, answered) {
    const st = state(sim);
    const i = sim.decisions.indexOf(d);
    if (i >= 0) sim.decisions.splice(i, 1);
    d.closed = true;
    d.closedAt = sim.time;
    // Superseded is not asked: the question about the nearest contact is coming straight back
    // aimed at the hull the bridge has just named, so it must not spend the gap or the count that
    // keep a kind from being put to one hull over and over.
    if (answered === 'silent') {
      for (const id of d.ships || [d.shipId]) {
        delete st.kindAt[id + '|' + d.kind];
        const r = st.asked[askKey(id, d.kind, d.targetId)];
        if (r && r.n > 0) r.n--;
      }
      if (d.kind === 'cripple' && d.targetId) delete st.kindAt['|cripple|' + d.targetId];
    }
    if (answered !== 'silent') noteClosed(sim, st, d, answered === true ? true : answered === 'lapsed' ? 'lapsed' : false);
    // A crew card off the band gives the ship's routine back at once: the answer has just moved a
    // party, and the routine is the thing that carries on from there.
    if (HOLDS[d.kind]) for (const id of d.ships || [d.shipId]) holdRoutine(sim, sim.byId(id));
    // A course just chosen stands, and another course card still on the band for the same hull
    // would fly her somewhere else on an answer given a minute ago. The approach card put Larkspur
    // on a cold coast at 100 s; a range card opened before it was still there at 140 s, and
    // 'Close to 250 km' lit her drive forty seconds into the coast without saying so. So answering
    // one course supersedes the others for those hulls: they come off the band without spending a
    // cooldown, and whichever of them still matters is put again once the course grace is up.
    if (answered === true && COURSE[d.kind]) {
      const crew = d.ships || [d.shipId];
      for (let i = sim.decisions.length - 1; i >= 0; i--) {
        const other = sim.decisions[i];
        if (other === d || !COURSE[other.kind]) continue;
        if (!(other.ships || [other.shipId]).some((id) => crew.indexOf(id) >= 0)) continue;
        close(sim, other, 'silent');
      }
    }
    sim.decisionSeq++;
  }

  // ---- the substep hook ------------------------------------------------------------------------
  function update(sim, dt) {
    if (!sim || !(dt >= 0)) return;
    const st = state(sim);
    endBurns(sim, st);
    endBoardings(sim, st);
    endClears(sim, st);
    // The engagement is over: whatever was on the band is not a question any more.
    if (sim.outcome) {
      if (sim.decisions.length) { sim.decisions.length = 0; sim.decisionSeq++; }
      // Whatever was on the band is gone, so no hull is left with her routine switched off.
      for (const id of Object.keys(st.held)) releaseRoutine(sim, sim.byId(id));
      return;
    }
    // What has lapsed: the hull is gone, the target is gone, or the situation answered itself.
    for (let i = sim.decisions.length - 1; i >= 0; i--) {
      const d = sim.decisions[i];
      d.ships = (d.ships || [d.shipId]).filter((id) => eligible(sim, sim.byId(id)));
      const ship = sim.byId(d.shipId);
      let done = !eligible(sim, ship) || !d.ships.length;
      if (!done && d.targetId && gone(sim, d.targetId)) done = true;
      // A crew card nobody has answered a minute after it reached the band is settled by the
      // ship's own routine, which does exactly what the card recommended. One log line says what
      // happened and what it cost, and the card comes off without counting as a refusal.
      if (!done && SETTLES[d.kind] && settleDue(sim, d)) {
        settleByRoutine(sim, d);
        close(sim, d, 'lapsed');
        continue;
      }
      if (!done && sim.time - d.openedAt > T.life) done = true; // unanswered: the moment has passed
      // Superseded, not answered: the question was about the nearest contact and the bridge has
      // since named a hull, so it closes and comes back aimed at the one the player picked.
      if (!done && typeof d._supersede === 'function') {
        let sup = false;
        try { sup = !!d._supersede(sim); } catch (e) { sup = false; }
        if (sup) { close(sim, d, 'silent'); continue; }
      }
      // A card has to stay on the band long enough to be read. Chapter 4 raised the jink question
      // twice and closed it both times inside four seconds, which is not a question anybody can
      // answer: the situation tests do not run over a card this new unless the hull or the hostile
      // it is about has left the plot.
      let over = false;
      if (!done && typeof d.until === 'function') { try { over = !!d.until(sim); } catch (e) { over = true; } }
      if (!done && !over && d._starved) {
        if (typeof d._starved === 'string') noteSkip(sim, sim.byId(d.shipId), d.kind, d._starved);
        over = true;
      }
      // Its situation has resolved, but nobody could have read the card yet. Every question gets
      // its minimum life, not only the ones about rounds in the air: the chapters are meant to be
      // winnable by somebody who takes half a minute to read a card, and chapter 2's sensor
      // question — 'No solution on ISV Sabre', the one answer that puts a solution on the mounts —
      // stood for thirty seconds and closed, so a reader at thirty seconds never once answered it
      // and the corvette fought the whole chapter without firing a shot. A stale card stops
      // counting against the hull the moment its situation goes, so holding it on the band a few
      // seconds longer costs the next question nothing.
      // A question whose situation is over must not still be able to fly the ship somewhere: the
      // minimum life is for the reader, not a licence to act on a moment that has passed. Chapter
      // 4 raised 'JCS Larkspur is under fire' at 85 s, the moment passed inside the same step, and
      // holding the card put Larkspur alone on a destroyer at 250 km. So the kinds that move the
      // hull close when their situation closes, and the kinds that decide how she shoots, what
      // the panels do and where the ears point keep their minimum life.
      if (over) {
        if (!d.stale) d.stale = sim.time;
        // A card down to one live answer is not a question either, and no amount of reading time
        // makes it one.
        if (d._starved || COURSE[d.kind] || sim.time - d.openedAt >= T.minLife) done = true;
      }
      if (done) close(sim, d, 'lapsed');
      else retitle(sim, d);
    }
    // The numbers move while a decision is open; the detail lines follow them once a second.
    if (sim.time >= st.nextDetail || sim.time < st.nextDetail - T.detail) {
      st.nextDetail = sim.time + T.detail;
      for (const d of sim.decisions) fill(sim, d);
    }
    // Triggers: one pass per hull every couple of seconds, one new question at a time.
    for (const ship of sim.ships) {
      if (!eligible(sim, ship)) continue;
      // The armour trail is sampled here, for every hull the band can speak about, so a card
      // raised at any moment has the last minute behind it rather than the seconds since it was
      // built. The sample itself is one number every five seconds.
      hullTrail(sim, ship);
      holdRoutine(sim, ship);
      if (handsOff(sim, ship)) continue;
      rearm(sim, st, ship);
      quietFight(sim, st, ship);
      const due = st.due[ship.id];
      if (due != null && sim.time < due && sim.time > due - T.evaluate * 2) continue;
      st.due[ship.id] = sim.time + T.evaluate;
      evaluate(sim, st, ship);
    }
    // Whatever is on the band once this pass is done, including a card raised in it: a crew card
    // that has just reached the band starts its minute here.
    noteBand(sim);
  }
  // A question for a hull the bridge is not flying waits a minute before it takes the band from the
  // one it is: the selected ship's decisions come first. Something shooting at a ship we guard, or
  // a prize going cold, does not wait.
  function waits(sim, st, ship, kind) {
    const sel = selectedId();
    if (!sel || sel === ship.id) return false;
    if (kind === 'defend' || kind === 'cripple') return false;
    const key = ship.id + '|' + kind;
    const rec = st.pending[key];
    if (!rec || sim.time - rec.last > T.evaluate * 4 || sim.time < rec.at) { st.pending[key] = { at: sim.time, last: sim.time }; return true; }
    rec.last = sim.time;
    return sim.time - rec.at < T.otherShip;
  }
  function evaluate(sim, st, ship) {
    let live = 0, urgent = ORDER.length;
    for (const d of sim.decisions) {
      if (!speaksFor(d, ship.id) || d.stale) continue;
      // A crew card the player has pushed aside, or one whose own lit key is to leave the parties
      // where they are, does not hold the hull's slot against anything.
      if (d.deferred || yielding(d)) continue;
      live++;
      const i = ORDER.indexOf(d.kind);
      if (i >= 0 && i < urgent) urgent = i;
    }
    // A hull locked in a saturated sink is asked at once: past the two-cards-a-hull limit, past the
    // cooldown, past the wait an unselected hull's questions normally serve, and past the
    // unchanged-text rule. Her drive is capped to a quarter and her mounts are quiet, and that is
    // not a state anything in the sim walks out of by itself.
    if (sinkLocked(ship) && !hasKindOpen(sim, ship.id, 'sink')) {
      let lock = null;
      try { lock = TRIGGERS.sink(sim, ship); } catch (e) { lock = null; }
      if (lock) {
        const lid = lock.target ? lock.target.id : null;
        if (!cool(sim, st, ship.id, 'sink', lid, null, true) && open(sim, st, ship, 'sink', lock.target || null, lock)) {
          yieldTo(sim, ship, 'sink');
          return;
        }
      }
    }
    if (live >= T.openPerShip) return; // the band is not a queue
    for (let n = 0; n < urgent; n++) {
      const kind = ORDER[n];
      // A course just chosen stands for a minute, whichever kind would like to change it.
      if (COURSE[kind] && st.course[ship.id] != null && sim.time >= st.course[ship.id] &&
        sim.time - st.course[ship.id] < T.defendGrace) continue;
      if (COURSE[kind] && kind !== 'withdraw' && breakingOff(sim, st, ship)) continue;
      const trig = TRIGGERS[kind];
      let spec = null;
      try { spec = trig(sim, ship); } catch (e) { spec = null; }
      if (!spec) continue;
      const tid = spec.target ? spec.target.id : null;
      let plain = spec.text;
      if (typeof plain === 'function') { try { plain = plain(sim, ship, false); } catch (e) { plain = ''; } }
      if (openFor(sim, ship.id, kind, tid) || cool(sim, st, ship.id, kind, tid, plain, spec.urgent)) continue;
      // Another hull is already carrying this exact question: join it rather than stack a card.
      if (collapse(sim, ship, kind, spec.target || null)) return;
      if (waits(sim, st, ship, kind)) continue;
      if (overAsked(sim, st, ship, kind, tid, spec.urgent)) continue;
      if (open(sim, st, ship, kind, spec.target || null, spec)) {
        yieldTo(sim, ship, kind);
        holdRoutine(sim, ship);
        return;
      }
    }
  }

  // ---- 1. approach -----------------------------------------------------------------------------
  // A hostile a long way off and a hull with no orders: every way in costs something different.
  const holdingStill = (ship) => {
    const o = ship.order || { type: 'hold' };
    return o.type === 'hold' || o.type === 'manual' || !o.target;
  };
  // `slack` widens the test while the question is open, so a slow drift cannot flap the band.
  function farOff(sim, ship, target, slack) {
    const R = trackRange(sim, ship, target).R;
    const b = bites(sim, ship, target);
    const big = Math.max(b.ours, b.theirs);
    const s = slack || 1;
    return R > T.approachFar / s || (big > 0 && R > (T.approachReach / s) * big);
  }
  // Where this hull was built to fight, never farther out than its beams can reach.
  // Burn-through range is where a beam stops being stopped by her armour, not where it does its
  // work: at the edge of it a hull cooks her own sink to 80 % and marks the paint. Half of it puts
  // four times the power on the same spot. Chapter 4's own brief says the number — keep range on
  // her at 200 km with all three — and a run at the edge of the reach left her at 81 % of hull
  // after forty minutes while the run at 200 km had her adrift in thirteen.
  function standoffOne(sim, ship, target) {
    const b = bites(sim, ship, target);
    const cls = classOf(ship);
    const doctrine = (cls && cls.doctrine ? cls.doctrine.range : 0) || 200e3;
    const want = b.ours > 0 ? Math.min(doctrine, b.ours * 0.5) : doctrine;
    return Math.round(U.clamp(want, 20e3, 800e3) / 1e3) * 1e3;
  }
  // Where the group fights, not where each hull would fight alone. Chapter 4's brief says it in so
  // many words — keep range on her with all three ships — and three hulls holding at 600, 388 and
  // 250 km are three hulls fighting a destroyer one at a time, which is how the frigate was lost
  // with the flagship at full armour 350 km behind her. The card that speaks for a group picks the
  // tightest of their ranges, because that is the one every hull of it can shoot from.
  function standoffFor(sim, ship, target, d) {
    let want = standoffOne(sim, ship, target);
    for (const id of (d && d.ships) || []) {
      if (id === ship.id) continue;
      const sh = sim.byId(id);
      if (!sh || !eligible(sim, sh)) continue;
      want = Math.min(want, standoffOne(sim, sh, target));
    }
    return want;
  }
  function trigApproach(sim, ship) {
    if (sim.time < T.approachStart || ship.accel() <= 0 || civilian(ship)) return null;
    if (!holdingStill(ship)) return null;
    // A contact out there is enough: the bridge that has not designated anyone yet is exactly the
    // one this question is for, so the nearest hostile warship stands in for a designation. The
    // teaching paragraph rides with the question about a hull the bridge has named: while nobody
    // is designated the question is aimed at whoever is nearest, and it re-aims itself (without
    // spending its cooldown) the moment the player picks a hull.
    const chosen = designated(sim, ship);
    const target = chosen || nearestWarship(sim, ship, false);
    if (!target || !farOff(sim, ship, target)) return null;
    const id = target.id;
    return {
      target,
      teach: undefined,
      supersede: chosen ? null : (s) => { const me = s.byId(ship.id); return !!(me && designated(s, me)); },
      title: (sm, sh, third) => (third && sh && sh.name
        ? 'How does ' + sh.name + ' close on ' + target.name + '?'
        : 'How do we close on ' + target.name + '?'),
      text: (sm, sh, third) => {
        const me = sh || ship;
        const at = rangeSay(trackRange(sm, me, sm.byId(id) || target));
        return third && me && me.name
          ? me.name + ' is holding, and ' + target.name + ' is at ' + at +
            '. Closing fast costs propellant and lights the drive.'
          : 'We are holding, and she is at ' + at + '. Closing fast costs propellant and lights the drive.';
      },
      until(s) {
        const me = s.byId(ship.id), t = s.byId(id);
        if (!me || !t) return true;
        return !holdingStill(me) || !farOff(s, me, t, 1.15);
      },
      build: buildApproach,
    };
  }
  // Both ways in, costed the same way from the same geometry, so the difference between them is
  // real: a brachistochrone that spends everything it can against one burn to a capped speed, a
  // long cold coast, and a brake at the end.
  function closeCost(ship, gap, closing, cap) {
    const a = ship.accel();
    const out = { t: null, dv: null, coast: 0, peak: 0, burn: 0 };
    if (!(a > 0) || !(gap > 0)) return out;
    const brach = Math.sqrt(gap * a);
    const v = cap != null ? Math.min(cap, brach) : brach;
    out.peak = v;
    out.burn = v / a;
    const dBurn = 0.5 * a * out.burn * out.burn;
    out.coast = Math.max(0, (gap - 2 * dBurn) / Math.max(v, 1));
    out.t = 2 * out.burn + out.coast + (typeof OD.Autopilot.flipTimeFor === 'function' ? OD.Autopilot.flipTimeFor(ship) : 0);
    out.dv = Math.max(0, 2 * v - Math.max(0, closing || 0));
    return out;
  }
  // The cold way in, as an order: one burn to the cruise speed, then dark, then a brake. The brake
  // has to start far enough out to kill the cruise speed, and the order settles at half its braking
  // range, so the hull ends up holding at that half. Shared by the approach card and by anything
  // else that wants to close on a hull without lighting a torch to do it.
  function coastPlan(sim, ship, target, d) {
    const standoff = standoffFor(sim, ship, target, d);
    const view = trackRange(sim, ship, target);
    const R = view.R;
    const a = ship.accel();
    const gap = Math.max(0, R - standoff);
    const cruise = Math.min(T.coastSpeed, Math.sqrt(Math.max(gap, 1) * Math.max(a, 0.01)));
    const stop = a > 0 ? (cruise * cruise) / (2 * a) : 0;
    // The brake cannot begin farther out than she is. 'Brake at 728 km' about a hull 630 km away
    // is an order to brake before we set off, and the card printed it for the whole approach: what
    // the standoff and the stopping distance want is held inside the range we hold on her, and
    // when even that leaves no room to coast the clause comes off the card and the order with it.
    const want = Math.max(standoff * 2, standoff + stop * 2.5);
    const brakeAt = Math.round(Math.min(want, R * 0.9));
    const hold = Math.round(brakeAt / 2);
    const fits = brakeAt > standoff && brakeAt < R;
    const order = approachOrder() && fits
      ? { type: 'approach', target: target.id, speed: T.coastSpeed, brakeAt, range: hold }
      : { type: 'keeprange', target: target.id, range: standoff, vmax: T.coastSpeed };
    return { standoff, R, view, gap, brakeAt, hold, fits, order };
  }
  function buildApproach(sim, d, ship, target) {
    if (!target) return null;
    const plan = coastPlan(sim, ship, target, d);
    const standoff = plan.standoff, brakeAt = plan.brakeAt, hold = plan.hold, easy = plan.order;
    const view = plan.view;
    const R = plan.R;
    const gap = plan.gap;
    const closing = closingView(ship, view);
    const hard = { type: 'keeprange', target: target.id, range: standoff };
    const fast = closeCost(ship, gap, closing, null);
    const slow = closeCost(ship, Math.max(0, R - hold), closing, T.coastSpeed);
    // closeCost is a brachistochrone over the gap as it stands, and a gap that is opening is not a
    // gap you fly. Chapter 5's card read 'Burn hard · alongside in 25m 47s · Δv 19.9 km/s' against a
    // hull making 17.3 m/s² to our 13.0, so the range opened for the whole burn. The burn card's
    // rungs already price this on the target's own motion, and this is the same rung: where she
    // outruns us the key prints what the burn does to the range, in the same words, and promises
    // no arrival at all.
    const hardRung = rungFor(sim, ship, target, gap, closing, ship.accel());
    const outrun = !!(hardRung && hardRung.never);
    // What she reads of us on the way in, priced with the radiators as they will actually be. The
    // panels are not a constant: they glow with the sink behind them, so a hull coasting on a
    // filling sink is brighter at the end of the leg than it is at the start, and the cold-hull
    // figure is a promise the sim does not keep. Panels in for the leg is dimmer still and honest
    // as long as the sink can take the whole coast; when it cannot, they stay out and the line says
    // what she reads with them glowing.
    const sig = signatureOf(ship);
    const base = sig ? Math.max(sig.hull, sig.total - sig.radiators) : 0;
    const legs = (panels) => [
      { secs: slow.burn, heatIn: heatAtThrottle(ship, 1, 0), panels },
      { secs: slow.coast, heatIn: heatAtThrottle(ship, 0, 0), panels },
    ];
    const shutLeg = legView(ship, legs(false));
    const outLeg = legView(ship, legs(true));
    const panelsNow = !!(ship.radiators && ship.radiators.state > 0.5);
    const stowForCoast = panelsNow && shutLeg.tFull == null;
    const legPanels = panelsNow && !stowForCoast;
    const sinkBit = (v) => (v.tFull != null ? 'the sink fills in ' + time(v.tFull) : 'the sink is at ' + pct(v.end) + ' on arrival');
    const V = voiceOf(ship, d.third);
    const her = foeWord(V, target);
    // Priced against a hostile that can still shoot, at the signature the leg would show.
    const range = (to) => {
      const e = watcher(sim, ship, to);
      return e ? seenWords(e, 'gets a solution on ' + V.us)
        : her + ' needs to be close for a solution on ' + V.us;
    };
    const quiet = legPanels
      ? 'radiators out and warming: ' + range(base + shedAtLoad(ship, outLeg.end)) + ' · ' + sinkBit(outLeg)
      : (stowForCoast ? 'radiators stowed for the coast: ' : 'radiators already stowed: ') + range(base) + ' · ' + sinkBit(shutLeg);
    const rush = timeMatters(sim, ship, target);
    const saving = fast.dv > 0 && slow.dv != null ? (fast.dv - slow.dv) / fast.dv : 0;
    return [
      {
        id: 'burn',
        label: 'Burn hard',
        detail: withNum((outrun ? arriveWords(hardRung) : 'alongside in ' + maybe(view, time(fast.t))) + ' · ' + dv(fast.dv, !view.solution) +
          ' · the drive burns the whole way, so every hostile holds a solution on ' + V.us, kmSay(view, gap) + ' to cover'),
        recommended: rush || saving < T.minBenefit,
        burns: true,
        act: (s) => { s.setTarget(ship.id, target.id); s.setOrder(ship.id, hard); },
      },
      {
        id: 'coast',
        label: 'Coast in at ' + Math.round(T.coastSpeed / 100) / 10 + ' km/s',
        // The opening burn is not free and the card says so: for as long as it lasts the plume is a
        // firing solution for everyone in the engagement, and the quiet only starts when it stops.
        // a leg with no coast in it says nothing about going dark ('then dark for 0 s' in chapter 7)
        detail: withNum(maybe(view, time(slow.burn)) + ' of burn, and they hold a solution while it lasts' +
          (slow.coast >= 1 ? ' · then dark for ' + maybe(view, time(slow.coast)) : '') + ' · ' + dv(slow.dv, !view.solution) + ' · ' + quiet +
          (plan.fits ? ' · brake at ' + km(brakeAt) + ', alongside at ' + km(hold) : ' · settling at ' + km(standoff)) +
          (outrun ? ' · this coast never closes the range' : ' in ' + maybe(view, time(slow.t))),
          kmSay(view, gap) + ' to cover'),
        recommended: !rush && saving >= T.minBenefit,
        benefit: saving,
        burns: true,
        act: (s) => {
          s.setTarget(ship.id, target.id);
          if (stowForCoast || !legPanels) {
            s.setRadiators(ship.id, false);
            // The leg was priced with them in, so it keeps them in: nothing else may re-extend
            // them until the sink would fill before the brake.
            state(s).coast[ship.id] = { at: s.time, target: target.id };
          }
          s.setOrder(ship.id, easy);
        },
      },
      {
        id: 'hold',
        label: 'Hold and watch',
        // 'The range holds at about 1 000 km' was printed while the two orbits closed it seven
        // kilometres a minute. Whatever the orbits are doing to the range is the whole content of
        // this option, so it is the number on the key.
        detail: 'nothing spent · ' + closingWords(ship, view) +
          V.say(', and we keep listening', ', and ' + V.name + ' keeps listening'),
        passive: true,
        quiet: holdingStill(ship),
        act: (s) => { s.setTarget(ship.id, target.id); s.setOrder(ship.id, { type: 'hold' }); },
      },
    ];
  }

  // ---- 2. sensors ------------------------------------------------------------------------------
  // Close enough to shoot, and the mounts are holding for want of a solution: who lights up first?
  // Only worth asking of a dim hull with a real wait ahead of it: a ship whose own plume already
  // pins her has nothing to trade, and a solution two minutes out arrives before the band is read.
  function trigSensors(sim, ship) {
    const S = OD.Sensors;
    if (!S || typeof S.quality !== 'function' || !ship.weaponsFree) return null;
    const target = designated(sim, ship);
    if (!target) return null;
    if (trackLow(sim, ship, target) >= T.sensorQ) return null;
    // Close enough for the mounts to care, or on the way in. A plume of our own is no longer a
    // reason to keep quiet about it: the reviewers' hundred and six cards held not one of these,
    // because the recommended line lights the drive and the gate then ruled the question out for
    // as long as it burned. What the plume costs belongs in the option, not in the trigger.
    const coasting = onApproach(ship, target);
    const bite = bites(sim, ship, target).ours;
    const near = bite > 0 && trackRange(sim, ship, target).R <= T.sensorReach * bite;
    if (!near && !coasting) return null;
    const eta = solutionEta(sim, ship, target);
    if (eta != null && eta !== undefined && eta <= T.sensorPatience) return null;
    const id = target.id;
    return {
      target,
      title: (sm, sh, third) => (third && sh && sh.name
        ? sh.name + ' has no solution on ' + target.name + '.'
        : 'No solution on ' + target.name + '.'),
      text: (sm, sh, third) => {
        const me = sh || ship, t = sm.byId(id) || target;
        if (!me || !t) return '';
        const v = trackRange(sm, me, t);
        const b = bites(sm, me, t).ours;
        const word = wordOf(sm, me, t);
        const held = b > 0 && v.R <= T.sensorReach * b;
        if (third && me.name) {
          return held
            ? me.name + '\u2019s mounts are holding fire at ' + rangeSay(v) + '. She has a ' + word + ' on ' +
              t.name + ', and a beam needs a solution to aim by.'
            : me.name + ' is closing on a ' + word + ' at ' + rangeSay(v) + '. A beam needs a solution to aim by.';
        }
        return held
          ? 'The mounts are holding fire at ' + rangeSay(v) + '. We have a ' + word + ' on her, and a beam needs a solution to aim by.'
          : 'We are closing on a ' + word + ' at ' + rangeSay(v) + '. A beam needs a solution to aim by.';
      },
      until(s) {
        const me = s.byId(ship.id), t = s.byId(id);
        if (!me || !t || t.disabled) return true;
        if (!me.weaponsFree) return true;
        const b = bites(s, me, t).ours;
        if (!onApproach(me, t) && !(b > 0 && trackRange(s, me, t).R <= T.sensorReach * b * 1.3)) return true;
        return trackLow(s, me, t) >= T.solutionQ;
      },
      build: buildSensors,
    };
  }
  function buildSensors(sim, d, ship, target) {
    if (!target) return null;
    const V = voiceOf(ship, d.third);
    const her = foeWord(V, target);
    // The wait is the sensor module's own: it reads the measured picture, not the one the plot is
    // carrying on by dead reckoning, so it answers 'how long until the ears have her again'.
    const eta = solutionEta(sim, ship, target);
    const wait = eta != null && eta !== undefined && eta < T.sensorPatience * 2.5;
    const rSol = passiveSolutionRange(ship, target);
    const view = trackRange(sim, ship, target);
    const R = view.R;
    const lit = (ship.activeRange || 0) > 0 && !isActive(ship);
    const pinned = pinnedByPlume(ship);
    // Who reads us, and can still act on it, at the signature we are showing now. The aggregate
    // the sensor module returns is the best suite on the board, adrift hulls included, and a plume
    // takes it to tens of thousands of kilometres in a fight fought at 250.
    const sig0 = signatureOf(ship);
    const eye = watcher(sim, ship, sig0 ? sig0.total : 0);
    // Her plume can put R_sol well outside the range we are already at: then there is nothing to
    // close and the offer would be an order to open. It is only made when the suite really does
    // want the range, and the order it writes can never take us farther out than we are.
    const closer = rSol > 0 && rSol < R;
    const quietSuite = V.say('nothing of ours goes out', V.name + ' sends nothing out');
    const to = Math.min(R * 0.9, Math.max(5e3, rSol * 0.9));
    const out = [];
    if (lit) {
      out.push({
        id: 'active',
        label: 'Go active',
        // The flash is not a range, it is a light: a hostile 1 041 km out, well beyond our own
        // active reach, went from a bare contact to a solution the second the suite lit. So the
        // line says what it costs, and a plume that already pins us is not a reason to add to it.
        detail: 'solution in ' + time(T.activeEta) + ' · every hostile that can see the flash gets a solution on ' +
          V.us + ', at any range' + (pinned && eye
          ? ' · ' + V.our + ' plume already gives ' + eye.name + ' one ' + seenAtWords(eye) + ', and the flash carries past that'
          : pinned ? ' · ' + V.our + ' plume already gives them one, and the flash carries farther' : ''),
        noRec: pinned,
        recommended: !wait && !pinned,
        act: () => setActive(ship, true),
      });
    }
    out.push({
      id: 'passive',
      label: 'Stay passive',
      detail: eta == null || eta === undefined
        ? 'no solution at ' + rangeSay(view) + ' · ' + (pinned
          ? V.say('the mounts stay dark, and our plume still shows her where we are',
            'the mounts stay dark, and ' + V.our + ' plume still shows ' + her + ' where ' + V.name + ' is')
          : quietSuite)
        : 'solution in ' + time(eta) + ' · ' + quietSuite,
      recommended: wait,
      quiet: !isActive(ship),
      act: () => setActive(ship, false),
    });
    if (closer) {
      out.push({
        id: 'close',
        label: 'Close to ' + km(rSol),
        detail: 'the passive suite holds a solution from there · ' + kmSay(view, R - rSol) + ' to cover',
        recommended: !wait && !lit, // with no active set, closing is the only way to a solution
        burns: true,
        act: (s) => s.setOrder(ship.id, { type: 'keeprange', target: target.id, range: to }),
      });
    }
    return out;
  }

  // ---- 3. radiators ----------------------------------------------------------------------------
  // The panels are worth a question in exactly two states: they are most of what she can see of us
  // (a cold hull, drive off), or her beams are close enough to burn them off. Under a lit torch
  // they are a rounding error on the signature and stowing them is a way to cook for nothing.
  // The course question is still to be answered, and the course decides what the panels are worth:
  // chapter 4 priced a stowed sink at 'fills in 1h 52m' with the drive off, and the approach card
  // fifteen seconds later lit that drive, where the true figure is about six minutes. The panels
  // wait for the course.
  function approachDue(sim, ship) {
    if (!ship || ship.accel() <= 0 || civilian(ship)) return false;
    if (!holdingStill(ship)) return false;
    const t = designated(sim, ship) || nearestWarship(sim, ship, false);
    return !!t && farOff(sim, ship, t, 1);
  }
  function trigRadiators(sim, ship) {
    if (!ship.radiators || ship.radiators.state <= 0.5) return null;
    if (ship.thermalLoad() >= T.radiatorLoad) return null;
    if (approachDue(sim, ship)) return null;
    // At or above the radiator law's knee the panels are already at their design temperature and
    // are the only thing holding the sink down: stowing them there is how a hull ends up locked at
    // 100 % with her drive capped, which is what a reviewer's whole second half of a fight was.
    if (ship.thermalLoad() >= knee()) return null;
    if (burning(ship)) return null;
    // One kind owns the panels at a time. While the heat, sink or withdraw card is holding them,
    // stowing them is that card's question: 'Stow the radiators' at t = 1 and 'Extend the radiators'
    // at t = 19 was one argument had twice, and the player paid for both.
    if (panelsOwned(sim, ship)) return null;
    const target = nearestWarship(sim, ship, false);
    if (!target) return null;
    const tb = bites(sim, ship, target).theirs;
    const view = trackRange(sim, ship, target);
    const R = view.R;
    const exposed = tb > 0 && R <= T.radiatorReach * tb;
    const sig = signatureOf(ship);
    const share = sig && sig.total > 0 ? sig.radiators / sig.total : 0;
    if (!exposed && share < T.panelShare) return null;
    // Nobody is inside anybody's reach yet: the panels are not a decision before the first shot is
    // possible, and 3 000 km out, with a cold sink, stowing them only starts the clock on cooking.
    const rr = reachOf(sim, ship, target);
    const ours = bites(sim, ship, target).ours;
    const launch = rr && rr.launch > 0 ? rr.launch : 0;
    if (R > Math.max(tb, ours, launch)) return null;
    // And stowing them would put the heat question on the band inside its own forecast window: two
    // cards contradicting each other is not a choice, so the one that owns the heat asks. The
    // forecast is run with the beams at full whenever we are close enough to use them, because the
    // sink the stow has to survive is the one the fight fills, not the one the quiet minute does.
    const shut = planView(sim, ship, false, fightingHeat(sim, ship, target));
    if (shut.tFull != null && shut.tFull < T.stowFloor) return null;
    // An answer that put the panels out is good for a whole cooldown: the card that asked for them
    // does not get to un-ask it ninety seconds later. It is good for the situation it was given in,
    // though, and her walking inside burn-through of the panels is a different one. Chapter 2's
    // heat card put the panels out at 151 s with ISV Sabre 860 km away; she was inside their reach
    // from about 400 s and the question could not be put again until 753 s, with the panels out
    // under her beams for six minutes.
    const last = panelAnswer(sim, ship);
    if (last && last.dir === 'out' && last.age < T.cooldown && last.exposed === exposed) return null;
    // When it does speak again it says what moved, because 'stow the panels' twice in one fight
    // reads as a bug unless the card names the thing that flipped the answer.
    const flipped = last && last.exposed !== exposed;
    const id = target.id;
    return {
      target,
      title: 'Stow the radiators?',
      text: (sm, sh, third) => {
        const V = voiceOf(sh || ship, third);
        const her = foeWord(V, target);
        // the flip opens the card, so its first word takes a capital ('she' becomes 'She')
        const Her = her.charAt(0).toUpperCase() + her.slice(1);
        const flip = !flipped ? ''
          : exposed ? Her + ' is close enough to burn the radiators off now. '
            : Her + ' has broken off, and her beams no longer reach the radiators. ';
        return flip + (exposed
          ? (V.third && target && target.name ? target.name + '\u2019s' : 'Her') + ' beams reach ' + V.us + ' at ' + rangeSay(view) +
            ', and the radiators are the thinnest part of the ship.'
          : 'The radiators are ' + pct(share) + ' of what ' + her + ' can see of ' + V.us + ' at ' + rangeSay(view) + '.');
      },
      until(s) {
        const me = s.byId(ship.id), t = s.byId(id);
        if (!me || !t) return true;
        if (!me.radiators || me.radiators.state <= 0.5) return true;
        if (me.thermalLoad() >= T.radiatorLoad || burning(me)) return true;
        const b = bites(s, me, t).theirs;
        const sg = signatureOf(me);
        const sh = sg && sg.total > 0 ? sg.radiators / sg.total : 0;
        return !(b > 0 && trackRange(s, me, t).R <= T.radiatorReach * b * 1.3) && sh < T.panelShare * 0.8;
      },
      build: buildRadiators,
    };
  }
  // The extra heat the mounts will be making if this hull is in a fight: nothing when nobody is in
  // reach or the weapons are tight, the beams' full-fire waste when they are.
  function fightingHeat(sim, ship, target) {
    if (!ship.weaponsFree || !hasBeams(ship) || !target) return 0;
    const b = bites(sim, ship, target);
    const R = trackRange(sim, ship, target).R;
    if (!(b.ours > 0) || R > b.ours * T.sensorReach) return 0;
    return Math.max(0, gunHeatAtFull(ship) - (ship.extraHeat || 0));
  }
  function buildRadiators(sim, d, ship, target) {
    const V = voiceOf(ship, d.third);
    const sig = signatureOf(ship);
    const A = sig ? sig.total : 0;
    const B = sig ? Math.max(A - sig.radiators, sig.hull) : 0;
    // Both ranges are priced against one hostile that can still shoot, at the two signatures the
    // key chooses between. Sensors.seenFrom takes the best suite on the board, adrift hulls
    // included, and scaling one aggregate number by the signature ratio is what printed a solution
    // range sixty times the size of the fight.
    const eyeNow = watcher(sim, ship, A);
    const eyeQuiet = watcher(sim, ship, B);
    const fight = fightingHeat(sim, ship, target);
    // Through the burn and the coast this hull is about to fly, not through this second with the
    // drive cold: what the panels cost is what they cost on the leg.
    const shut = planView(sim, ship, false, fight);
    const outView = sinkView(ship, true);
    const shed = shedNow(ship);
    const tb = target ? bites(sim, ship, target).theirs : 0;
    const exposed = !!(target && tb > 0 && trackRange(sim, ship, target).R <= T.radiatorReach * tb);
    const stowable = (shut.tFull == null || shut.tFull > T.stowFloor) && ship.thermalLoad() < knee();
    // Without the sensor model there is no signature and no range to be read from, so the two
    // lines say what is left that is true: the cooling we give up and the panels we stop showing.
    // A solution range longer than the range she is already at is not a distance anybody can use.
    const pinnedNow = !!(eyeNow && eyeNow.solution >= eyeNow.at);
    const pinnedQuiet = !!(eyeQuiet && eyeQuiet.solution >= eyeQuiet.at);
    const quiet = !eyeQuiet ? ''
      : pinnedQuiet
        ? 'signature ' + power(A) + ' → ' + power(B) + ' · ' + eyeQuiet.name + ' still reads ' + V.us +
          ' from where she is, ' + km(eyeQuiet.at) + ' off · '
        : 'signature ' + power(A) + ' → ' + power(B) + ' · ' + seenWords(eyeQuiet, 'gets a solution on ' + V.us) +
          (pinnedNow ? '' : ' instead of ' + km(eyeNow.solution)) + ' · ';
    const loud = !eyeNow ? ' · nothing of theirs that can still shoot reads ' + V.us + ' from here'
      : ' · ' + seenWords(eyeNow, 'reads ' + V.us) + ', and her beams can burn them off';
    const drop = A > 0 ? (A - B) / A : 0;
    return [
      {
        id: 'stow',
        label: 'Stow the radiators',
        detail: quiet + V.say('we lose ', V.name + ' loses ') + power(shed) + ' of cooling · ' +
          fullIn(shut.tFull) + (fight > 0 ? ' with the beams at full' : ''),
        panel: 'in',
        // Never lit while the panels-in forecast fills the sink inside a quarter of an hour, and
        // never at or above the knee, where the panels are the only cooling there is. A stow that
        // has to be undone in eight minutes is not a decision, it is a detour; a stow at the knee
        // is the lock itself.
        recommended: stowable,
        // Out of a beam's reach, a stow that dims us by a rounding error is not a decision.
        benefit: exposed ? null : drop,
        act: (s) => s.setRadiators(ship.id, false),
      },
      {
        id: 'keep',
        label: 'Keep them out',
        panel: 'out',
        // Where the sink settles with them out, not where it happens to be this second: the panels
        // hold an idle hull near the knee's share of the load, not at the reading on the gauge.
        detail: 'they shed ' + power(shed) + ' and hold the sink at ' +
          pct(outView.settle != null ? outView.settle : ship.thermalLoad()) +
          (outView.tFull != null ? ' · ' + fullIn(outView.tFull) : '') + loud,
        recommended: !stowable,
        act: (s) => s.setRadiators(ship.id, true),
      },
    ];
  }

  // ---- 4. range --------------------------------------------------------------------------------
  // On the way in, at the rung of the ladder where the geometry stops being free.
  function trigRange(sim, ship) {
    if (civilian(ship)) return null;
    const o = ship.order || {};
    const flying = !!((o.type === 'intercept' || o.type === 'keeprange' || o.type === 'approach') && o.target);
    // A hull with her weapons free, nobody designated and hostiles still up is not out of the
    // fight: she is a bridge with nothing to answer. After a prize is taken her orders are
    // cleared, and the board used to go quiet on her for the rest of the chapter.
    const idle = !flying && !!ship.weaponsFree && !designated(sim, ship);
    const loud = silentFalling(sim, ship);
    if (!flying && !idle && !loud) return null;
    // While her band has been silent and her armour going, the question is about whoever is
    // nearest — which is very likely whoever is doing it — rather than about the hull her orders
    // happen to name, which may be a thousand kilometres the other way.
    const target = loud || !flying ? nearestWarship(sim, ship, false) || (flying ? sim.byId(o.target) : null) : sim.byId(o.target);
    if (!target || target.destroyed || target.captured || target.disabled || civilian(target)) return null;
    if (!sim.isHostile(target, ship)) return null;
    // A course chosen a moment ago about this hull is the answer to this question too.
    if (justOrdered(sim, target.id)) return null;
    const b0 = bites(sim, ship, target);
    const big = Math.max(b0.ours, b0.theirs);
    // Beams decide the ordinary question, but a hull being holed by coilguns while neither side's
    // beams reach is still a hull with a range to pick: when the band has gone silent on her, the
    // reach that counts is whatever anybody's weapons can touch her from.
    const rr = loud ? reachOf(sim, ship, target) : null;
    const gate = loud
      ? Math.max(big, rr ? Math.max(rr.slug || 0, rr.launch || 0,
        rr.their ? Math.max(rr.their.slug || 0, rr.their.launch || 0) : 0) : 0)
      : big;
    if (!(gate > 0)) return null;
    const view0 = trackRange(sim, ship, target);
    const R = view0.R;
    if (R > gate * (loud ? T.rangeLapse : T.rangeBand)) return null;
    // Inside the larger of the two reaches is not the same as inside both. A hull sitting at
    // 600 km under beams that reach 802 km, with her own that reach 366, is being shot at from a
    // range where she cannot answer: that is the range question, not the end of it. The question
    // has answered itself only when both sets of beams bite here, or neither does.
    const mismatch = (R <= b0.theirs) !== (R <= b0.ours);
    if (!idle && !loud && !mismatch && R < big) return null;
    const id = target.id;
    const facet = facetOf(ship, target) || 'flank';
    return {
      target,
      // A hull with nothing to answer — no order, or four quiet minutes while her armour goes —
      // is asked again every couple of minutes, cooldown or no cooldown.
      urgent: idle || loud,
      title: 'Pick the range.',
      text: (sm, sh, third) => {
        const me = sh || ship, t = sm.byId(id) || target;
        if (!me || !t) return '';
        const v = trackRange(sm, me, t), bb = bites(sm, me, t);
        const V = voiceOf(me, third);
        const at = 'At ' + rangeSay(v) + ' ';
        if (V.third) {
          const hers = t.name + '\u2019s';
          return bb.ours > 0
            ? at + V.name + '\u2019s beams burn through ' + hers + ' armour out to ' + km(bb.ours) + '. ' +
              (bb.theirs > 0 ? hers + ' beams reach ' + km(bb.theirs) + '.' : hers + ' beams do not reach her at any range.')
            : at + V.name + '\u2019s beams never get through ' + hers + ' ' + facet + ' armour at any range. ' +
              (bb.theirs > 0 ? hers + ' beams reach ' + km(bb.theirs) + '.' : hers + ' beams do not reach her either.');
        }
        return bb.ours > 0
          ? at + 'our beams burn through her armour out to ' + km(bb.ours) +
            (bb.theirs > 0 ? ', and hers reach ' + km(bb.theirs) + '.' : ', and hers do not reach us at any range.')
          : at + 'our beams never get through her ' + facet + ' armour at any range' +
            (bb.theirs > 0 ? ', and hers reach ' + km(bb.theirs) + '.' : ', and hers do not reach us either.');
      },
      until(s) {
        const me = s.byId(ship.id), t = s.byId(id);
        if (!me || !t || t.disabled) return true;
        const bb = bites(s, me, t);
        const b = Math.max(bb.ours, bb.theirs);
        if (!(b > 0)) return true;
        const d2 = trackRange(s, me, t).R;
        if (idle) return !!(me.order && me.order.target) || d2 > b * T.rangeLapse;
        if (d2 > b * T.rangeLapse) return true;
        // Still a question while one set of beams bites here and the other does not.
        return (d2 <= bb.theirs) === (d2 <= bb.ours) && d2 < b / T.rangeLapse;
      },
      build: buildRange,
    };
  }
  // Who else of ours can put beams on the hull in front of us, and how soon. Chapter 4's corvette
  // was told to close to 220 km on a destroyer whose beams reach 802 km while her frigate and her
  // flagship were still seven minutes back on a coast: she was disabled before either arrived.
  function supportOn(sim, ship, target) {
    const out = { ship: null, eta: null, inIt: 0 };
    if (!target) return out;
    for (const s2 of sim.ships) {
      if (s2 === ship || s2.faction !== ship.faction) continue;
      if (s2.destroyed || s2.captured || s2.disabled || civilian(s2) || station(s2)) continue;
      const b = bites(sim, s2, target).ours;
      const R = U.dist(s2.pos, target.pos);
      if (b > 0 && R <= b) { out.inIt++; out.eta = 0; if (!out.ship) out.ship = s2; continue; }
      const closing = closingOn(s2, target);
      if (!(closing > 10)) continue;
      const eta = Math.max(0, R - b) / closing;
      if (out.eta == null || eta < out.eta) { out.eta = eta; out.ship = s2; }
    }
    return out;
  }
  const armourCm = (ship, facet) => (ship && ship.armour && ship.armour[facet] > 0 ? ship.armour[facet] : 0);
  function buildRange(sim, d, ship, target) {
    if (!target) return null;
    const V = voiceOf(ship, d.third);
    const her = foeWord(V, target);
    const herOwn = foeOwn(V, target);
    const ourBeams = V.say('our beams', V.name + '\u2019s beams');
    const r = reachOf(sim, ship, target);
    const b = bites(sim, ship, target);
    const ours = b.ours, theirs = b.theirs;
    const big = Math.max(ours, theirs);
    const small = Math.min(ours > 0 ? ours : big, theirs > 0 ? theirs : big);
    const wide = big * 1.3;
    const theirFacet = r && r.their && r.their.facet ? r.their.facet : 'flank';
    const ourFacet = facetOf(ship, target) || 'flank';
    const view = sinkView(target, undefined);
    const theirLoad = target.thermalLoad ? target.thermalLoad() : 0;
    const slug = r && r.slug > 0 ? r.slug : 0;
    const plot = trackRange(sim, ship, target);
    // 'Hers fall short by 192 km' is true of her beams and of nothing else. A newcomer reads it as
    // 'she cannot hurt us from here' and sits in it while her coilguns and her bays work.
    const theirSlug = r && r.their && r.their.slug > 0 ? r.their.slug : 0;
    const theirLaunch = r && r.their && r.their.launch > 0 ? r.their.launch : 0;
    const alsoReach = (at) => {
      const bits = [];
      if (theirSlug > at) bits.push('coilguns to ' + km(theirSlug));
      if (theirLaunch > at) bits.push('bays to ' + km(theirLaunch));
      return bits.length ? ' · ' + herOwn + ' ' + bits.join(' and ') + ' still reach ' + V.us : '';
    };
    // A standing-off range she can simply walk through is not a range. The card recommended
    // 'Hold at 1 307 km' against a hull under thrust and the ship was dragged to 299 km over
    // seven minutes without one beam biting: a target closing under her own drive, against an
    // acceleration no better than hers, decides the range, so the option is priced at the range
    // she will actually allow — and dropped when our beams do not reach that far.
    const closing = closingView(ship, plot);
    const herAccel = typeof target.accel === 'function' ? target.accel() : 0;
    const chased = closing > 50 && (target.throttle || 0) > T.burningThrottle && herAccel >= ship.accel() * 0.9;
    const herCls = classOf(target);
    const herWant = chased
      ? Math.max(5e3, Math.min(theirs > 0 ? theirs * 0.8 : 1e12, (herCls && herCls.doctrine && herCls.doctrine.range) || 1e12))
      : 0;
    const chaseNote = chased ? ' · ' + her + ' is closing at ' + Math.round(closing) +
      ' m/s under thrust, so this is the range she allows' : '';
    // Holding a range off a hull that is closing means burning away from her, and a hull burning
    // away shows her tail: 4 cm on a corvette against 20 on the nose. Chapter 2 was lost there —
    // 'Hold at 585 km' at 225 s, beam fire on the tail from 542 s, the drive gone at 1 038 s.
    const tailFirst = closing > 20;
    const tailCm = armourCm(ship, 'tail'), noseCm = armourCm(ship, 'nose');
    // And her beams are then priced against that tail, not against the nose she is looking at
    // while we are still coming in. Her ladder against our three facets is on the same reach
    // object as ours, and the thinnest of ours is the one holding the range hands her. Chapter 2's
    // card read 'her beams reach us here too, out to 650 km' and recommended holding at 585;
    // twenty seconds later Larkspur was burning away, her beams opened the 4 cm tail from
    // 1 451 km, and the corvette went from full armour to disabled without landing a shot.
    const theirLadder = (r && r.their && r.their.beams) || {};
    const theirWorst = Math.max.apply(null, ['nose', 'flank', 'tail'].map((f) => (theirLadder[f] > 0 ? theirLadder[f] : 0)));
    const runs = tailFirst && tailCm > 0 && noseCm > tailCm && theirWorst > theirs * 1.05;
    // What her beams reach once the hold is being held, which is the number the answer turns on.
    const theirsHold = runs ? theirWorst : theirs;
    const tailNote = tailFirst && theirs > 0 && tailCm > 0 && noseCm > tailCm
      ? ' · holding it means burning away from ' + foeHer(V, target) + ', so she reads ' + V.our + ' tail: ' +
        tailCm + ' cm against ' + noseCm + ' cm on the nose'
      : '';
    // The rest of the group, and when it is in this fight.
    const sup = supportOn(sim, ship, target);
    const alone = sup.inIt === 0 && (sup.eta == null || sup.eta > T.supportSoon);
    const outranged = theirs > ours * 1.05;
    const list = [];
    if (ours > 0) {
      // 'Hold at X' is the range our beams bite at, with a margin — never a number pulled out of
      // the air, never offered when they do not bite at all, and never further out than we can
      // hold a solution on her, because a range where the mounts cannot aim is not a fighting
      // range: it is the stalemate the last round of reviewers sat in for twenty minutes.
      // The hold is priced against the thickest facet she can show, not against the one she happens
      // to be showing this second.
      const held = Math.max(biteWorst(sim, ship, target), 0);
      const want = (held > 0 ? held : ours) * 0.9;
      // The facet she is showing us right now reaches farther than the thickest one she can turn
      // toward us: say so with both numbers, because one turn takes the hold range away.
      const onFacet = held > 0 && ours > held * 1.05;
      const reachAtHold = held > 0 ? held : ours;
      const passiveSee = passiveSolutionRange(ship, target) * 0.9;
      const activeSee = (ship.activeRange || 0) * 0.9;
      // If our own ears cannot hold her that far out, the reach is worth nothing — unless we light
      // the suite, which buys the solution and tells her exactly where we are. That is the trade
      // the sensor model exists for, and it belongs on the card that asks for the range.
      const lightUp = !isActive(ship) && activeSee > passiveSee && want > passiveSee;
      const seeable = Math.max(passiveSee, isActive(ship) || lightUp ? activeSee : 0);
      const hold0 = Math.round(Math.min(want, seeable > 5e3 ? seeable : want) / 1e3) * 1e3;
      const hold = chased && herWant < 1e12 ? Math.max(hold0, Math.round(herWant / 1e3) * 1e3) : hold0;
      // The advantage is not 'our gun is longer', it is 'we can sit where hers does not reach and
      // still hit her' — and a margin is a time, not a distance. Thirty-six kilometres in front of
      // a hull closing at three kilometres a second is twelve seconds of advantage.
      const margin = hold - theirsHold;
      const closeIn = closing > 5 ? margin / closing : null;
      const advantage = reachAtHold > theirsHold * 1.05 && hold > theirsHold &&
        (closeIn == null || closeIn > T.holdMargin);
      // Which rung the navigator points at. Our beams reach where hers do not, and she cannot walk
      // inside that in two minutes: hold there. She reaches farther than we do and the rest of the
      // group is in it with us: close, and finish it between us. She reaches farther and we are
      // alone: fight at the edge of our own burn-through rather than deep inside hers, which is
      // where chapter 4's corvette was told to go and was disabled seven minutes later.
      const holdable = hold >= 2e3 && (!chased || hold < ours);
      // Holding at a range farther out than the one we are at is opening the range with another
      // name on it. While the board says to put her out of the fight, that is not the navigator's
      // pick: 'Hold at 923 km' took a division out of a fight it was winning for twelve minutes.
      const opening = hold > plot.R * 1.1;
      // The edge of her burn-through is where the exchange is most in our favour: beam power on
      // target falls as the square of the range, so a hull sitting just inside her limit takes
      // almost nothing while her own armour is still being opened by beams that reach half again
      // as far. Closing from there gives that away and adds nothing to the beams. Chapter 2's lit
      // chain read 'our beams burn through her armour out to 1 027 km, and hers reach 650 km' at
      // 902 km and closed to 250, and Larkspur was disabled at 1 546 s on every seed.
      const edge = advantage || (reachAtHold > 0 && theirsHold > 0 && reachAtHold >= theirsHold * 0.95);
      // But not while the board still says to put her out of the fight. A hold farther out than
      // the range we are at is opening the range under another name, and at the far edge of the
      // beams the armour comes off so slowly that nothing finishes: chapter 4 lit 'Hold at
      // 1 139 km' at 919 s and 'Hold at 682 km' at 705 s and ran the full forty minutes with
      // ISV Coriolis at 47 % and the objective still open. Reaching where she does not is a
      // reason to hold the range, not a reason to give up the one the board asked for.
      // The rung the other key closes to, needed here because giving up the hold is only worth
      // anything when the other key really is tighter than it.
      const tight = Math.max(5e3, standoffFor(sim, ship, target, d));
      const standOff = edge && !(opening && neutraliseOpen(sim, target) && tight < hold);
      if (holdable) {
        list.push({
          id: 'hold',
          label: 'Hold at ' + km(hold),
          // A gun that does not bite at all does not 'fall short by the difference': it falls short
          // by the whole distance, whatever that distance happens to be.
          detail: (theirsHold <= 0
            ? ourBeams + ' burn through ' + herOwn + ' armour at ' + km(hold) + ' and ' + herOwn + ' beams do not reach ' + V.us + ' at any range'
            : advantage ? ourBeams + ' burn through ' + herOwn + ' ' + ourFacet + ' · ' + herOwn + ' beams fall short by ' + km(Math.max(0, hold - theirsHold))
              // Holding it means burning away from her, so the number on the key is what her beams
              // open the tail at, and the key says that is the facet holding turns toward her.
              : runs ? ourBeams + ' burn through ' + herOwn + ' ' + ourFacet + ' · holding it turns ' + V.our + ' ' +
                tailCm + ' cm tail to ' + foeHer(V, target) + ', and ' + herOwn + ' beams open a tail out to ' + km(theirWorst)
                : ourBeams + ' burn through ' + herOwn + ' ' + ourFacet + ' · ' + herOwn + ' beams reach ' + V.us + ' here too, out to ' + km(theirs)) + chaseNote +
            (closeIn != null && closeIn <= T.holdMargin && margin > 0
              ? ' · ' + her + ' is inside that in ' + time(closeIn) + ' at the rate she is closing' : '') +
            (onFacet ? ' · ' + ourBeams + ' reach ' + herOwn + ' ' + ourFacet + ' out to ' + km(ours) +
              ' but only burn through ' + herOwn + ' thickest facet inside ' + km(held) + ', so a turn ends it' : '') +
            tailNote + alsoReach(hold) +
            (lightUp ? ' · ' + V.say('we go active', V.name + ' goes active') + ' to aim that far, and every hostile inside ' +
              km(ship.activeRange) + ' then gets a solution on ' + V.us : ''),
          recommended: standOff,
          burns: true,
          act: (s) => {
            if (lightUp) setActive(ship, true);
            s.setTarget(ship.id, target.id);
            s.setOrder(ship.id, { type: 'keeprange', target: target.id, range: hold });
          },
        });
      }
      // The range the whole card closes to is `tight` above, so a division goes in at one rung of
      // the ladder — and the same rung the defend card and the approach card name, because a
      // bridge told to close to 321 km by one card and to hold at 400 km by the next is being
      // given two fights to fly.
      // Closing is the answer when the fight is ours to take. With two of them already able to
      // reach us and nobody of ours close enough to share it, closing is how a hull is lost.
      const odds = localOdds(sim, ship);
      list.push({
        id: 'close',
        label: 'Close to ' + km(tight),
        detail: (theirs <= 0
          ? ourBeams + ' burn through ' + herOwn + ' armour at ' + km(tight) + ' and ' + herOwn + ' beams do not reach ' + V.us + ' at any range' + alsoReach(tight)
          : 'both sets of beams burn through · ' +
            V.say('she sees our ' + theirFacet + ', we see her ' + ourFacet,
              her + ' sees ' + V.our + ' ' + theirFacet + ', ' + V.name + ' sees ' + herOwn + ' ' + ourFacet) +
            ' · ' + herOwn + ' beams reach ' + km(theirs)) +
          (odds.trapped ? ' · ' + count(odds.foes) + ' of them can reach ' + V.us + ' here and ' +
            V.say('nobody of ours is close', 'nobody on her side is close') : ''),
        // Closing is the answer when the fight is ours to take: our beams reach as far as hers, or
        // the rest of the group is in it with us. One hull closing alone on a beam that reaches
        // twice as far is not pressing the fight, it is feeding her one hull at a time.
        recommended: !(standOff && holdable) && !odds.trapped,
        // And where the hold is the pick, closing is the option that hands her the exchange.
        noRec: standOff && holdable,
        burns: true,
        act: (s) => { s.setTarget(ship.id, target.id); s.setOrder(ship.id, { type: 'keeprange', target: target.id, range: tight }); },
      });
    } else {
      // Our beams do not open that facet at any range. Say so, and offer what does work: the
      // coilguns, which do not care about spot size, and the range that makes them count.
      const tight = Math.max(5e3, slug > 0 ? Math.min(slug * 0.7, plot.R * 0.6) : plot.R * 0.5);
      list.push({
        id: 'close',
        label: 'Close to ' + km(tight),
        detail: herOwn + ' ' + ourFacet + ' armour turns ' + ourBeams + ' at every range · inside this the coilguns and the bays do the work · ' +
          herOwn + ' beams reach ' + km(theirs) + alsoReach(tight) + chaseNote,
        recommended: true,
        burns: true,
        act: (s) => { s.setTarget(ship.id, target.id); s.setOrder(ship.id, { type: 'keeprange', target: target.id, range: tight }); },
      });
      if (slug > 0) {
        const at = Math.max(5e3, Math.min(slug * 0.8, plot.R));
        list.push({
          id: 'slugs',
          label: 'Beams cold, slugs to ' + km(slug),
          detail: 'the beams make heat here for nothing · the coilguns hold at ' + km(at) + ' · sink ' + pct(ship.thermalLoad()),
          burns: true,
        act: (s) => { setFireMode(ship, 'hold'); s.setTarget(ship.id, target.id); s.setOrder(ship.id, { type: 'keeprange', target: target.id, range: at }); },
        });
      }
    }
    list.push({
      id: 'open',
      label: 'Open to ' + km(wide),
      detail: 'no beams burn through at that range · ' + herOwn + ' sink is at ' + pct(theirLoad) + ' and ' +
        (view.tFull != null ? 'fills in ' + time(view.tFull) : view.tEmpty != null ? 'draining' : 'holding there') +
        alsoReach(wide) + chaseNote,
      recommended: ours <= 0 && theirs > 0 && view.tFull != null && !chased,
      passive: true,
      burns: true,
      act: (s) => { s.setTarget(ship.id, target.id); s.setOrder(ship.id, { type: 'keeprange', target: target.id, range: wide }); },
    });
    return list;
  }

  // ---- 5. salvo --------------------------------------------------------------------------------
  // She is inside the reach of the bays, and the bays never reload.
  // A hull the player is not commanding runs her own bays (engagement.js honours `autoBays`), so
  // asking the bridge to time her salvo is asking about a magazine the bridge does not hold.
  function canLaunch(sim, ship, target) {
    const E = OD.Engagement;
    if (!E || typeof E.salvo !== 'function' || !ship || !target) return false;
    if (!ship.weaponsFree || ship.autoBays === true || civilian(ship)) return false;
    if (bayCount(ship) < T.salvoMin) return false;
    const r = reachOf(sim, ship, target);
    const launch = r ? r.launch : null;
    if (!(launch > 0) || trackRange(sim, ship, target).R > launch) return false;
    return qualityOf(sim, ship, target) >= 2; // the bays will not launch on less than a track
  }
  // One key on a collapsed card fires every hull it speaks for, so the group is what the question
  // is about. The card used to price the selected corvette's six while the key sent thirty.
  function launchers(sim, ship, target) {
    const out = [ship];
    for (const other of sim.ships) {
      if (out.length >= T.collapseMax) break;
      if (other.id === ship.id || other.faction !== ship.faction) continue;
      if (!eligible(sim, other) || handsOff(sim, other)) continue;
      if (canLaunch(sim, other, target)) out.push(other);
    }
    return out;
  }
  // What the whole group has on the rails, what her point defence takes off them, and what is
  // left to arrive. Every number is the sum of the estimates the engagement module gives for the
  // hulls that would launch.
  function salvoGroup(sim, ships, target) {
    const out = { n: 0, left: 0, stopped: 0, through: 0, flight: null, ships: 0 };
    for (const sh of ships || []) {
      if (!sh || !target) continue;
      const sat = saturation(sim, sh, target);
      if (!(sat.left > 0)) continue;
      out.ships++;
      out.left += sat.left;
      out.n += Math.max(0, sat.n || 0);
      out.stopped += Math.max(0, sat.stopped || 0);
      out.through += Math.max(0, sat.through || 0);
      if (sat.flight != null) out.flight = out.flight == null ? sat.flight : Math.max(out.flight, sat.flight);
    }
    return out;
  }
  function trigSalvo(sim, ship) {
    const target = designated(sim, ship);
    if (!target || !canLaunch(sim, ship, target)) return null;
    const id = target.id;
    // Nine salvo cards in a row, all of them answered 'Hold the bays', because at five minutes of
    // flight her point defence takes the whole salvo however many hulls send one. When even
    // everything we have aboard puts nothing through, there is no question here.
    const group = salvoGroup(sim, launchers(sim, ship, target), target);
    if (!(group.through >= 1)) return null;
    const at = rangeSay(trackRange(sim, ship, target));
    return {
      target,
      title: 'Launch now?',
      text: (sm, sh, third) => {
        const me = (sm && sm.byId(ship.id)) || ship;
        const V = voiceOf(sh || me, third);
        const hers = V.third ? target.name + '\u2019s' : 'her';
        // The sentence is priced on the same salvo the keys are. The group's estimate moves while
        // the card is up, and a card that read 'nothing we send gets through' over a key that read
        // '5 of 6 aboard for one arrival' was two answers to the same question: where the group
        // puts nothing through and this hull's own bays still do, the sentence is this hull's.
        const all = salvoGroup(sm || sim, launchers(sm || sim, me, target), target);
        const g = all.through >= 1 ? all : salvoGroup(sm || sim, [me], target);
        if (!(g.through >= 1)) {
          return V.say('We have ' + g.left + ' aboard, so nothing we send gets through.',
            V.name + ' has ' + g.left + ' aboard, so nothing she sends gets through.');
        }
        return g.n > 0
          ? (V.third ? hers : 'Her') + ' point defence stops about ' + g.stopped +
            ' interceptors on the way in, so it takes ' + g.n + ' to put ' + count(Math.max(1, Math.round(g.through))) + ' through.'
          : 'At ' + at + ' ' + hers + ' point defence stops every interceptor ' +
            V.say('we have', V.name + ' has') + ' left.';
      },
      until(s) {
        const me = s.byId(ship.id), t = s.byId(id);
        if (!me || !t || t.disabled) return true;
        if (!canLaunch(s, me, t)) return true;
        return !(salvoGroup(s, launchers(s, me, t), t).through >= 1);
      },
      build: buildSalvo,
    };
  }
  // The flight the sim will fly, not the one the rails book. The engagement module's estimate is
  // worked against a hull standing still; a hull opening the range at 400 m/s takes that off every
  // second of the chase, and a salvo whose mean closing cannot beat her is a salvo that never
  // arrives. Chapter 2's card promised '4m 51s of flight' at 1 040 km: all five were still 555 km
  // short at 400 s, and they ran their tanks dry and died where they were.
  function salvoFlight(sim, ship, target, est) {
    if (!est || !(est.flightTime > 0)) return null;
    const R = U.dist(ship.pos, target.pos);
    const mean = R / est.flightTime;
    const open = -closingOn(ship, target); // positive while the range is growing
    if (!(open > 0)) return est.flightTime;
    return mean > open + 1 ? R / (mean - open) : null;
  }
  // The smallest salvo that puts something aboard: her point defence kills at a rate, so there is a
  // number that swamps it, and any number under it is interceptors spent for nothing.
  // The stops are the engagement module's own count, not a second one worked here. Pricing her rate
  // against the whole flight charged a 228 km launch for 100 s of point defence when her mounts
  // reach 150 km: the card said 'nothing we send gets through' and the sim put three interceptors
  // aboard out of five. The module prices the same launch at two stopped and three through, which
  // is what the sim did, so the card reads off the module.
  // What the module does not price is the coast. Its flight time books a closing the dart only
  // holds while its drive is lit; past about a third of the interceptor's endurance the coast
  // bleeds it and the darts die in the air. Chapter 2's opening card offered five at 1 040 km on a
  // booked flight of 4m 55s: every one of them was still short at 700 s and none arrived. So a
  // flight that books more than T.salvoLife of T.dartLife arrives at nothing, and the card says so.
  function saturation(sim, ship, target) {
    const st = state(sim);
    const key = ship.id + '|' + target.id;
    const rec = st.sat && st.sat[key];
    if (rec && rec.at === sim.time) return rec.v;
    const left = bayCount(ship);
    const out = { n: 0, through: 0, stopped: 0, flight: null, lasts: false, left };
    const top = Math.min(left, T.salvoMax);
    const endurance = dartLife() * T.salvoLife;
    let best = null;
    for (let n = 1; n <= top; n++) {
      const est = salvoEstimate(sim, ship, target, n);
      if (!est) break;
      const flight = salvoFlight(sim, ship, target, est);
      const lasts = flight != null && flight <= endurance;
      const stopped = lasts ? Math.min(n, Math.max(0, est.theirPdCanStop || 0)) : n;
      const through = est.reach && lasts ? Math.max(0, Math.min(n, est.through || 0)) : 0;
      const v = { n, flight, stopped, through, lasts };
      if (!best || n === top) best = v;
      if (through >= 1) { best = v; break; }
    }
    if (best) {
      out.n = best.n;
      out.through = best.through;
      out.stopped = best.stopped;
      out.flight = best.flight;
      out.lasts = best.lasts;
    }
    if (!st.sat) st.sat = Object.create(null);
    st.sat[key] = { at: sim.time, v: out };
    return out;
  }
  function buildSalvo(sim, d, ship, target) {
    if (!target) return null;
    const V = voiceOf(ship, d.third);
    const herOwn = foeOwn(V, target);
    const mine = saturation(sim, ship, target);
    // What the key launches: this hull's bays, and every other hull the card speaks for. The
    // numbers on the line are the group's; the act is this hull's own magazine.
    const crew = (d.ships || [d.shipId]).map((x) => sim.byId(x)).filter((sh) => sh && sh.id !== ship.id && canLaunch(sim, sh, target));
    const group = salvoGroup(sim, [ship].concat(crew), target);
    const left = group.left || mine.left;
    const n = Math.max(1, group.n || mine.n || Math.min(left, 4));
    const through = group.through;
    const sat = { n, stopped: group.stopped || mine.stopped, flight: group.flight != null ? group.flight : mine.flight,
      lasts: group.lasts || mine.lasts };
    const view = sinkView(target, undefined);
    const load = target.thermalLoad ? target.thermalLoad() : 0;
    const rads = !!(target.radiators && target.radiators.state > 0.5);
    // A wait that fills her sink is only a different answer from holding the bays when there is a
    // sink to wait for and something for the beams to do meanwhile.
    const worthWaiting = view.tFull != null && view.tFull < T.salvoWait && rads;
    const list = [];
    // What the salvo costs, in the only currency the bays have: the rails never reload. 'Launch 5,
    // one arrives' with six aboard is the magazine spent for a scratch, and the card used to light
    // it anyway. So a launch is lit when enough of it arrives for what it spends, or when the
    // magazine can stand it twice over — five of twelve for one arrival is a trade; five of six
    // is the last card in the hand.
    const worth = through >= 1 && (through >= n * T.salvoShare || n * 2 <= left);
    const trade = n + ' of ' + left + ' aboard for ' + count(Math.round(through)) + (Math.round(through) === 1 ? ' arrival' : ' arrivals');
    list.push(through >= 1 ? {
      id: 'launch',
      label: 'Launch ' + n,
      detail: time(sat.flight) + ' of flight · ' + herOwn + ' point defence stops about ' + sat.stopped +
        ' of them over the last ' + km(pdReach()) + ', which is as far as those mounts reach · ' + trade,
      noRec: !worth,
      recommended: worth,
      act: (s) => launchSalvo(s, ship, Math.max(1, mine.n || 1)),
    } : {
      // A salvo her point defence takes whole is not an option with a key on it: it is the
      // magazine thrown away, priced at nothing. It comes off the board.
      id: 'launch',
      label: 'Launch ' + n + ' anyway',
      detail: sat.flight == null
        ? herOwn + ' drive opens the range faster than the interceptors close it · nothing arrives'
        : !sat.lasts
          ? time(sat.flight) + ' of flight is more than an interceptor holds its closing for · they run dry short of ' +
            foeHer(V, target) + ' and coast · nothing arrives'
          : time(sat.flight) + ' of flight, and ' + herOwn + ' point defence stops all ' + n + ' over the last ' + km(pdReach()) + ' · nothing arrives',
      dead: true,
      noRec: true,
      act: (s) => launchSalvo(s, ship, Math.max(1, mine.n || 1)),
    });
    if (worthWaiting) {
      list.push({
        id: 'wait',
        label: V.say('Wait for her sink', 'Wait for ' + foeHer(V, target) + '\u2019s sink'),
        detail: herOwn + ' sink fills in ' + time(view.tFull) + ' · a full sink stops every mount, point defence included · ' +
          V.say('our beams', V.name + '\u2019s beams') + ' work on ' + herOwn + ' radiators until then',
        recommended: !worth,
        act: () => setAim(ship, 'radiators'),
      });
    }
    list.push({
      id: 'bays',
      label: 'Hold the bays',
      detail: left + ' interceptors stay aboard for the next fight · ' + herOwn + ' sink is at ' + pct(load) + ' · nothing goes out',
      recommended: !worth && !worthWaiting,
      quiet: true,
      act: () => { /* the rails stay loaded: the choice is to spend nothing */ },
    });
    return list;
  }

  // ---- 6. cripple ------------------------------------------------------------------------------
  // The standing order gunnery reads: a hull only keeps its mounts on a target that is out of the
  // fight while it is carrying this. It names the hull, so it lapses the moment we shift target,
  // and passing nothing takes it back. The UI has this by name: OD.Decisions.finish(ship, id).
  function finish(ship, targetId) {
    if (!ship) return null;
    ship.finishTarget = targetId || null;
    return ship.finishTarget;
  }
  function crippled(ship) {
    return !!ship && (ship.disabled || (ship.systems && ship.systems.drive <= T.driveWrecked));
  }
  function trigCripple(sim, ship) {
    if (civilian(ship)) return null;
    // The hull this ship is actually flying at or shooting at, the moment she goes out of the
    // fight. Range does not come into it: three hulls sat on a disabled prize at throttle zero for
    // seventy minutes with nothing on the band while the rest of her squadron worked through them.
    let held = null;
    for (const h of [ship.order && ship.order.target ? sim.byId(ship.order.target) : null, ship.target ? sim.byId(ship.target) : null]) {
      if (!h || h.destroyed || h.captured || civilian(h) || !sim.isHostile(h, ship)) continue;
      if (crippled(h)) { held = h; break; }
    }
    let best = held, bd = held ? trackRange(sim, ship, held).R : T.crippleRange;
    if (!best) {
      for (const h of sim.hostiles(ship)) {
        if (civilian(h) || !crippled(h)) continue;
        const d = trackRange(sim, ship, h).R;
        if (d < bd) { bd = d; best = h; }
      }
    }
    if (!best) return null;
    const id = best.id, stuck = !!held && bd > T.crippleRange;
    return {
      target: best,
      title: best.name + ' is out of the fight.',
      text: (sm, sh, third) => {
        const me = sh || ship, t = sm.byId(id) || best;
        if (!me || !t) return '';
        const say = rangeSay(trackRange(sm, me, t));
        const V = voiceOf(me, third);
        const her = foeWord(V, t, 'She');
        // Who else is pointed at her. The card speaks for all of them, so it says which they are.
        const also = sm.ships.filter((s2) => s2 && s2.id !== me.id && s2.faction === me.faction &&
          !s2.destroyed && !s2.captured && !s2.disabled && !civilian(s2) && !station(s2) &&
          ((s2.order && s2.order.target === id) || s2.target === id));
        const more = !also.length ? ''
          : also.length === 1 ? ' ' + also[0].name + ' has her orders on her too.'
            : ' ' + Count(also.length) + ' more of ours have their orders on her: ' +
              also.map((s2) => s2.name).join(', ') + '.';
        return (stuck
          ? her + ' is ' + say + ' off with no drive, and ' + V.our + ' orders are still on her.'
          : her + ' is ' + say + ' off and cannot manoeuvre.') + more;
      },
      until(s) {
        const me = s.byId(ship.id), t = s.byId(id);
        if (!me || !t || t.captured || !s.isHostile(t, me)) return true;
        if (!crippled(t)) return true;
        const far = trackRange(s, me, t).R > T.crippleRange * 2;
        const ours = (me.order && me.order.target === id) || me.target === id;
        return far && !ours;
      },
      build: buildCripple,
    };
  }
  function buildCripple(sim, d, ship, target) {
    if (!target) return null;
    const V = voiceOf(ship, d.third);
    const B = boardNumbers();
    const order = { type: 'intercept', target: target.id, range: Math.max(1000, Math.round(B.range * 0.6)) };
    const p = planFor(sim, d, ship, order, 'board');
    // the nearest hostile still able to fight: the one worth leaving this one for
    let next = null, nd = Infinity;
    for (const h of sim.hostiles(ship)) {
      if (h === target || civilian(h) || crippled(h)) continue;
      const dd = trackRange(sim, ship, h).R;
      if (dd < nd) { nd = dd; next = h; }
    }
    // Boarding is ninety seconds matched and motionless beside her. While more hulls are still
    // shooting on her side than on ours, that is ninety seconds as a stationary target with the
    // fight going on around us — never the navigator's pick, whatever the prize is worth.
    // Ours counts the hulls that would still be shooting once this one has stopped to do it: a
    // sister already matched to the same prize with her weapons tight is not covering anybody.
    const boarding = (s2) => !s2.weaponsFree && s2.order && s2.order.type === 'intercept' && s2.order.target === target.id;
    const theirs = sim.ships.filter((s2) => combatant(s2) && !s2.neutralised() && !crippled(s2) && s2.id !== target.id && sim.isHostile(s2, ship)).length;
    const ours = sim.ships.filter((s2) => combatant(s2) && !s2.neutralised() && !crippled(s2) && s2.id !== ship.id &&
      s2.faction === ship.faction && !boarding(s2)).length;
    const swarmed = theirs > ours;
    // Boarding is a clock, not a wish: the run has to be flown and then ninety seconds held. A
    // prize the card recommended for three minutes while the range went 281 → 293 km and the hull
    // 0.50 → 0.19 was not a prize, it was the rest of her squadron shooting at a stationary
    // target. While anything of hers is still shooting, the whole run has to fit in the window.
    // The crossing is not a constant: the sim charges 90 s against a crew our own size and longer
    // against a bigger one, so the key prices the crossing this hull would actually make.
    const plan = boardPlan(ship, target);
    const cross = plan.time;
    const reach = p.t != null && isFinite(p.t);
    const run = reach ? p.t + cross : null;
    const inTime = theirs === 0 || (run != null && run <= T.boardWindow);
    const view = trackRange(sim, ship, target);
    // The decks, before the run: too many fit aboard her and the party is thrown back.
    const decks = boardOdds(ship, target);
    return [
      {
        id: 'board',
        label: 'Board her',
        // No run the tanks and the drive can fly reads 'cannot get alongside', not 'alongside in never'; and a
        // party her crew throws back does not take the hull, so that line leaves out the prize.
        detail: withNum(!reach ? V.say('we cannot get alongside her', V.name + ' cannot get alongside her') :
          'alongside in ' + maybe(view, time(p.t)) +
          ' · hold ' + time(cross) + ' inside ' + km(B.range) + ' at under ' + Math.round(B.speed) + ' m/s' +
          (decks && decks.beaten
            ? ' · her ' + decks.theirs + ' fit crew against ' + V.say('our ', V.name + '\u2019s ') + decks.ours +
              ' throw the party back'
            : V.say(' and the hull and crew are ours', ' and the hull and crew are ' + V.name + '\u2019s') +
            (swarmed ? ' · ' + count(theirs) + ' of hers ' + (theirs === 1 ? 'is' : 'are') + ' still shooting against ' +
              (ours === 0
                ? V.say('nothing of ours, and we sit still for all of it',
                  'nothing of ' + V.name + '\u2019s, and she sits still for all of it')
                : count(ours) + V.say(' of ours, and we sit still for all of it',
                  ' of ' + V.name + '\u2019s, and she sits still for all of it'))
              : !inTime && reach ? ' · ' + maybe(view, time(run)) + ' of it with ' + count(theirs) + ' of hers still shooting' : '')),
          rangeSay(view) + ' to her'),
        noRec: swarmed || !inTime || !reach || !!(decks && decks.beaten),
        // The decks decide it, so this key does not do what it says: never lit, and never the
        // routine's answer either.
        never: !!(decks && decks.beaten),
        recommended: !swarmed && inTime && reach && !(decks && decks.beaten),
        burns: true,
        act: (s) => {
          s.setTarget(ship.id, target.id);
          ship.weaponsFree = false;
          // sim.js gives the weapons back (and drops the order) when the prize is taken or the
          // party is recalled; this module keeps its own note so a run that simply lapses does
          // not leave the hull disarmed for the rest of the chapter.
          ship.heldFireForBoarding = true;
          state(s).board[ship.id] = { at: s.time, target: target.id };
          finish(ship, null);
          s.setOrder(ship.id, order);
        },
      },
      {
        id: 'finish',
        label: 'Finish her',
        detail: 'full fire · ' + pct(target.hull) + ' of her hull left · no prize to take home',
        act: (s) => {
          s.setTarget(ship.id, target.id);
          ship.weaponsFree = true;
          ship.heldFireForBoarding = false;
          // Gunnery holds on a hull that is out of the fight unless it is carrying this order,
          // and the order names the hull, so it does not follow us to the next one.
          finish(ship, target.id);
          setFireMode(ship, 'full');
          setAim(ship, 'hull');
        },
      },
      {
        id: 'leave',
        label: next ? 'On to ' + next.name : 'Leave her',
        detail: next ? kmSay(trackRange(sim, ship, next), nd) + ' to ' + next.name + ' · this one is not going anywhere' +
            (swarmed || !inTime ? ' · the next one is still shooting' : '')
          : 'break off · ' + rangeSay(view) + ' from her and opening',
        recommended: (swarmed || !inTime) && !!next,
        // Leaving a prize while there is still a fight on is never the navigator's pick; going on
        // to the next hull is fighting, so only the bare 'leave her' is passive.
        passive: !next,
        burns: true,
        act: (s) => {
          finish(ship, null);
          ship.heldFireForBoarding = false;
          // Going on to the next hull is still an approach, and a hull already coasting at this
          // one keeps her drive out: a full-throttle keep-range fifteen seconds after the coast
          // was chosen is the band undoing its own answer with the plume lit.
          if (next) {
            s.setTarget(ship.id, next.id);
            const stand = standoffFor(s, ship, next);
            const cold = approachOrder() && trackRange(s, ship, next).R > stand * 2.5 ? coastPlan(s, ship, next) : null;
            s.setOrder(ship.id, cold && cold.fits ? cold.order : { type: 'keeprange', target: next.id, range: stand, vmax: T.coastSpeed });
          }
          // The retreat order is the one that knows where the ground is: it opens the range from
          // her without flying us into the body we are both orbiting.
          else s.setOrder(ship.id, { type: 'retreat', target: target.id });
        },
      },
    ];
  }

  // ---- 7. slugs --------------------------------------------------------------------------------
  // Unguided rounds already in flight, aimed at where this hull will be if it holds its course.
  function slugsOn(sim, ship) {
    const list = threatsOn(sim, ship);
    const out = { n: 0, eta: null, fromId: null };
    if (!list) return out;
    for (const r of list) {
      if (r.kind !== 'slug' || !r.willHit || r.eta == null) continue;
      out.n++;
      if (out.eta == null || r.eta < out.eta) { out.eta = r.eta; out.fromId = r.fromId; }
    }
    return out;
  }
  // Her coilgun still bears on this hull: rounds in the air are one volley of it, and the volley
  // is over in seconds. A card that closes the moment the rounds land is a card no human answers —
  // chapter 4's corvette lost her drive to a slug through the tail at 423 s with the jink question
  // raised twice and lapsed twice, thirty seconds being longer than a slug's flight. So the
  // question stays on the band while the gun that threw them can throw again.
  function slugGunOn(sim, ship, from) {
    if (!from || from.destroyed || from.disabled || from.captured) return 0;
    const r = reachOf(sim, ship, from);
    const reach = r && r.their && r.their.slug > 0 ? r.their.slug : 0;
    if (!(reach > 0)) return 0;
    return U.dist(ship.pos, from.pos) <= reach ? reach : 0;
  }
  // The nearest hostile whose coilgun already bears on this hull. Waiting for a round to be in the
  // air makes the question unanswerable: chapter 4's own hint is to jink from the start, and the
  // gun that will throw is on the plot long before the first volley is.
  function slugGunner(sim, ship) {
    let best = null, bestAt = Infinity;
    for (const other of sim.ships) {
      if (other.faction === ship.faction || !eligible(sim, other) || civilian(other)) continue;
      if (other.weaponsFree === false) continue;
      if (!slugGunOn(sim, ship, other)) continue;
      const at = U.dist(ship.pos, other.pos);
      if (at < bestAt) { bestAt = at; best = other; }
    }
    return best;
  }
  function trigSlugs(sim, ship) {
    if (ship.jink) return null;
    const s0 = slugsOn(sim, ship);
    // F1: 'JCS Anselm is 3 s from one round. Have her jink?' — and a log line at 0 s. A volley that
    // lands before the question can be read and the burst flown is not a question: the dodge is
    // sized from the flight time left, and at three seconds it moves her metres. The gun that
    // threw it is still a question, so the card falls back on the gunner.
    const s = s0.n && s0.eta < T.jinkRead ? { n: 0, eta: null, fromId: s0.fromId } : s0;
    const gunner = s.n ? null : slugGunner(sim, ship);
    if (!s.n && !gunner) return null;
    const from = s.n ? (s.fromId ? sim.byId(s.fromId) : null) : gunner;
    // The last volley this card saw, kept so the title and the keys still carry a number once the
    // rounds have landed and the gun is loading the next ones.
    const last = { n: s.n, eta: s.eta, at: sim.time };
    const shot = (sm, sh) => {
      const cur = slugsOn(sm, sh || ship);
      if (cur.n) { last.n = cur.n; last.eta = cur.eta; last.at = sm.time; }
      return { n: cur.n, eta: cur.eta, was: last.n, flight: !!cur.n };
    };
    // A card about another hull is the whole question on its own: the band shows her name in the
    // eyebrow, but the title has to say who is about to be holed, or a hauler's problem reads as
    // the bridge's own.
    return {
      target: from,
      _shot: shot,
      title: (sm, sh, third) => {
        const cur = shot(sm, sh);
        const who = sh && sh.name ? sh.name : 'she';
        if (cur.flight) {
          return third
            ? who + ' is ' + Math.round(cur.eta) + ' s from ' + count(cur.n) + (cur.n === 1 ? ' round' : ' rounds') + '. Have her jink?'
            : 'Slugs inbound, ' + Math.round(cur.eta) + ' s.';
        }
        const at = from ? km(U.dist((sh || ship).pos, from.pos)) : '';
        // the card stays up long enough to be read after its moment passes: once we are out of her
        // reach it says so, rather than 'inside her coilgun' beside a reach of 0 m
        if (from && !slugGunOn(sm, sh || ship, from)) {
          return third ? who + ' is outside ' + from.name + '\u2019s coilgun now.' : 'Outside ' + from.name + '\u2019s coilgun now.';
        }
        return third
          ? who + ' is inside ' + (from ? from.name + '\u2019s' : 'her') + ' coilgun at ' + at + '. Have her jink?'
          : 'Inside ' + (from ? from.name + '\u2019s' : 'her') + ' coilgun at ' + at + '.';
      },
      text: (sm, sh, third) => {
        const cur = shot(sm, sh);
        const me = sh || ship;
        const subject = third && me.name ? me.name : 'us';
        const tail = 'Nothing steers a slug, so it hits ' + (third && me.name ? me.name + ' only if she is' : 'us only if we are') +
          ' still on this course when it arrives.';
        if (cur.flight) {
          return cur.n + (cur.n === 1 ? ' round' : ' rounds') + ' on the way' + (from ? ' from ' + from.name : '') + '. ' + tail;
        }
        const reach = from ? slugGunOn(sm, me, from) : 0;
        const nom = third && me.name ? me.name + ' is' : 'we are';
        if (!reach) {
          return (cur.was > 0 ? (from ? from.name : 'She') + ' has thrown ' + count(cur.was) + (cur.was === 1 ? ' round' : ' rounds') +
            ' at ' + subject + ' already. ' : '') + (third && me.name ? me.name + ' is' : 'We are') + ' outside her coilgun now.';
        }
        const gun = (from ? from.name : 'She') + '\u2019s coilgun reaches ' + km(reach) + ' and ' + nom + ' inside it';
        return (cur.was > 0
          ? (from ? from.name : 'She') + ' has thrown ' + count(cur.was) + (cur.was === 1 ? ' round' : ' rounds') +
            ' at ' + subject + ' already, and her coilgun still reaches ' + km(reach) + '. '
          : gun + '. ') + tail;
      },
      until(sm) {
        const me = sm.byId(ship.id);
        if (!me) return true;
        if (me.jink) return true;
        if (slugsOn(sm, me).n) return false; // rounds in the air: the question stands
        const gun = from ? slugGunOn(sm, me, sm.byId(from.id) || from) : 0;
        if (!gun) return true;
        return sm.time - last.at > T.slugGrace;
      },
      build: buildSlugs,
    };
  }
  function buildSlugs(sim, d, ship) {
    const V = voiceOf(ship, d.third);
    const s = slugsOn(sim, ship);
    const from = d.targetId ? sim.byId(d.targetId) : null;
    // Each dodge is a lateral burst and the burst that stops it: about two seconds of thrust each way.
    const cost = 2.8 * ship.accel();
    // Between volleys the numbers on the keys are about the gun, not about rounds that have already
    // landed: a key still counting eleven in flight after they hit is a key that lies.
    const inFlight = s.n > 0;
    const reach = from ? slugGunOn(sim, ship, from) : 0;
    // A jink breaks a boarding match and swings the nose off the shooter. Only say so where one of
    // those is true of this hull: a freighter holding still is holding still, and nothing else.
    const boarding = !!ship.heldFireForBoarding;
    const noseOn = !!(from && facetOf(from, ship) === 'nose');
    // What a dodge actually moves her before the rounds arrive. The overlay burns sideways at 70 %
    // of the drive for about two seconds and then keeps the speed it bought, and the sim scores a
    // slug as a miss once it is two hull lengths off. Under that, the rounds pass through her.
    const window = T.jinkLengths * Math.max(20, ship.length || 100);
    const drift = (() => {
      const a = 0.7 * ship.accel();
      const secs = inFlight && s.eta > 0 ? s.eta : null;
      if (!(a > 0) || secs == null) return null;
      const tb = Math.min(T.jinkBurst, secs);
      return 0.5 * a * tb * tb + a * tb * Math.max(0, secs - tb);
    })();
    const clears = drift == null || drift >= window;
    const keeps = boarding && noseOn ? 'the boarding match and the nose-on aim hold'
      : boarding ? 'the boarding match holds'
        : noseOn ? 'the nose-on aim holds' : 'nothing else changes';
    return [
      {
        id: 'jink',
        label: 'Jink',
        detail: dv(cost) + ' a dodge · ' + (inFlight
          ? s.n + ' in flight, first in ' + time(s.eta)
          : (from ? from.name + '’s' : 'her') + ' coilgun bears on ' + V.us + ' out to ' + km(reach)) +
          (clears ? ' · they pass through empty space'
            : ' · the dodge moves ' + Math.round(drift) + ' m before they arrive, and a miss needs ' +
              Math.round(window) + ' m'),
        recommended: clears,
        noRec: !clears,
        act: () => { ship.jink = true; },
      },
      {
        id: 'still',
        label: 'Hold still',
        // What holding still actually keeps. The card used to append 'the match and the nose-on aim
        // hold' to every slugs question, including the first one a newcomer sees, which is on an
        // unarmed freighter that is neither boarding anybody nor holding an aim.
        detail: 'nothing spent · ' + (inFlight
          ? s.n + (s.n === 1 ? ' round' : ' rounds') + ' still on ' + V.us
          : 'the next rounds are thrown at where ' + V.say('we', V.name) + ' will be') +
          ' · ' + keeps,
        quiet: !ship.jink,
        act: () => { ship.jink = false; },
      },
    ];
  }

  // ---- 8. heat ---------------------------------------------------------------------------------
  function trigHeat(sim, ship) {
    if (!hasBeams(ship) || !ship.weaponsFree || ship.overheated) return null;
    // The other half of the heat question, and the one the reviewers sat in for twenty-four
    // minutes: the beams were put on hold to save the sink, the sink has since drained, and
    // nothing anywhere in the sim ever turns them back on. A gun crew does not wait for the
    // thermodynamics to ask.
    if (fireModeOf(ship) === 'hold') {
      const t2 = designated(sim, ship) || nearestWarship(sim, ship, false);
      if (!t2) return null;
      const b2 = bites(sim, ship, t2).ours;
      if (!(b2 > 0) || U.dist(ship.pos, t2.pos) > b2) return null;
      if (ship.thermalLoad() > T.gunsCold) return null;
      const id2 = t2.id;
      const at2 = km(U.dist(ship.pos, t2.pos));
      return {
        target: t2,
        title: (sm, sh) => 'The mounts are cold and the sink is down to ' +
          pct(loadOf((sm && sm.byId(ship.id)) || ship)) + '.',
        text: (sm, sh, third) => {
          const V = voiceOf(sh || ship, third);
          return foeWord(V, t2, 'She') + ' is inside ' + V.our + ' burn-through at ' + at2 +
            V.say(' and nothing of ours is firing.', ' and ' + V.name + ' is not firing.');
        },
        until(s) {
          const me = s.byId(ship.id), t = s.byId(id2);
          if (!me || !t || t.disabled) return true;
          if (fireModeOf(me) !== 'hold' || me.overheated) return true;
          const b = bites(s, me, t).ours;
          return !(b > 0) || U.dist(me.pos, t.pos) > b * 1.3;
        },
        build: buildGunsOn,
      };
    }
    if (fireModeOf(ship) !== 'full') return null;
    const load = ship.thermalLoad();
    // Through the plan, not through this second: a hull forty seconds from cutting her drive is
    // not a hull that will be burning for the next eight minutes, and pricing her as if she were
    // is how the heat card came to contradict the approach card that had just issued the order.
    const view = planView(sim, ship, undefined);
    // 80 % of the sink is the moment the contract names. On a hull whose panels nearly keep up it
    // is half an hour of unbroken fire away, so the same question is also asked as soon as the
    // forecast at this rate of fire says the sink fills inside the length of a fight.
    const soon = view.tFull != null && view.tFull < T.heatForecast;
    if (load < T.heatLoad && !soon) return null;
    // The panels were stowed a moment ago, on purpose, and the sink is not in trouble yet: a
    // forecast is not reason enough to stand the bridge's own answer on its head. Once the load
    // actually reaches the question's own threshold — or crosses the re-arm line, which clears this
    // card's cooldown outright — it is a different situation and the card speaks.
    const said = panelAnswer(sim, ship);
    if (load < T.heatLoad && said && said.dir === 'in' && said.age < T.cooldown) return null;
    // Panels out and already ahead of the mounts: the sink is draining or settling somewhere below
    // the top, nothing is on fire, and there is no lever left to offer. That is what the radiator
    // law's knee buys a hull that keeps its panels out — normal running, not a question. Stowed,
    // extending them still is a lever.
    const stowed = !ship.radiators || ship.radiators.state <= 0.5;
    if (!stowed && (view.tFull == null || (view.settle != null && view.settle < settleHigh()))) return null;
    const target = designated(sim, ship);
    if (!target) return null;
    const id = target.id;
    return {
      target,
      // The title says what the sink is doing, which is the thing that just changed: a forecast
      // question opening with a comfortable-looking percentage was what made reviewers ignore it.
      title: (sm, sh) => {
        const me = (sm && sm.byId(ship.id)) || ship;
        const v = sm ? planView(sm, me, undefined) : view;
        return v.tFull != null ? 'The sink fills in ' + time(v.tFull) + '.'
          : 'The sink is at ' + pct(loadOf(me)) + ' and holding.';
      },
      // Name what is making the heat. On a hull under burn most of it is the drive, and a card that
      // bills all of it to the guns is teaching the player something that is not true.
      text: 'Heat into the sink: ' + heatSourceWords(heatParts(ship)) + '. ' +
        (stowed ? 'The radiators are stowed.' : 'The radiators drain ' + power(view.shed) + '.'),
      until(s) {
        const me = s.byId(ship.id), t = s.byId(id);
        if (!me || !t) return true;
        if (me.overheated) return true;
        const v = planView(s, me, undefined);
        const inn = !me.radiators || me.radiators.state <= 0.5;
        if (!inn && (v.tFull == null || (v.settle != null && v.settle < settleHigh()))) return true;
        if (me.thermalLoad() < T.heatClear && !(v.tFull != null && v.tFull < T.heatForecast * 1.5)) return true;
        return fireModeOf(me) !== 'full';
      },
      build: buildHeat,
    };
  }
  // Back to work: what full fire costs the sink from here, what the panels will carry for ever,
  // and the choice of staying quiet.
  function buildGunsOn(sim, d, ship, target) {
    const V = voiceOf(ship, d.third);
    const herOwn = foeOwn(V, target);
    const extra = Math.max(0, gunHeatAtFull(ship) - (ship.extraHeat || 0));
    const full = sinkView(ship, undefined, extra);
    const share = sustainedShare(ship);
    const now = sinkView(ship, undefined);
    const holds = full.tFull == null || full.tFull > T.radiatorPatience;
    const list = [];
    list.push({
      id: 'full',
      label: 'Full fire',
      detail: 'everything the mounts have · ' + fullIn(full.tFull) +
        (target && target.hull != null ? ' · ' + pct(target.hull) + ' of ' + herOwn + ' hull left' : ''),
      recommended: holds,
      act: () => setFireMode(ship, 'full'),
    });
    if (share != null && share > T.sustainedMin && share < 0.99) {
      list.push({
        id: 'sustained',
        label: 'Sustained fire',
        detail: 'beams at ' + pct(share) + ' of full · the radiators shed all ' + power(now.shed) + ' of it, so the sink does not fill',
        recommended: !holds,
        act: () => setFireMode(ship, 'sustained'),
      });
    }
    list.push({
      id: 'cold',
      label: 'Keep them cold',
      detail: 'nothing spent · ' + sinkPhrase(now) + ' · the coilguns and the bays keep firing until the sink fills, and then nothing fires',
      recommended: !holds && !(share != null && share > T.sustainedMin && share < 0.99),
      passive: true,
      quiet: true,
      act: () => setFireMode(ship, 'hold'),
    });
    return list;
  }
  function buildHeat(sim, d, ship, target) {
    const V = voiceOf(ship, d.third);
    const her = foeWord(V, target);
    const herObj = foeHer(V, target);
    const share = sustainedShare(ship);
    const rating = ratingOf(ship);
    const sig = signatureOf(ship);
    const A = sig ? sig.total : 0;
    const out = sig ? A - sig.radiators + rating : 0;
    const stowed = !ship.radiators || ship.radiators.state <= 0.5;
    const view = planView(sim, ship, undefined);
    // What the sink does once the mounts stop feeding it: the beams and the point defence are all
    // of the extra load but the sensor suite, so taking that back out is the cold-guns forecast.
    const gunHeat = Math.max(0, (ship.extraHeat || 0) - (isActive(ship) ? 2e6 : 0));
    const cold = sinkView(ship, undefined, -gunHeat);
    const legs = approachLegs(sim, ship);
    const coasting = coastOwnsPanels(sim, ship);
    const list = [];
    const weak = share != null && share < T.sustainedMin;
    if (stowed) {
      // Panels in, so throttling the beams to the radiator margin throttles them to nothing: the
      // lever is the panels. Going from no cooling at all to their full rating is never inside the
      // noise, so the option is only left off when there are none left to put out.
      // What the panels are worth is what they are worth on the leg we are actually flying. Under
      // a lit drive the plume drowns them; forty seconds later, dark, they are most of what there
      // is to see. The card that priced them against the burn told the player the panels changed
      // nothing she could see and then handed her a solution from three times as far out.
      const rise = A > 0 ? (out - A) / A : 0;
      const dark = sig ? Math.max(sig.hull, A - sig.radiators - sig.plume) : 0;
      // Priced against a hostile that can still shoot, at each of the two signatures on offer.
      const eDark = dark > 0 ? watcher(sim, ship, dark) : null;
      const eOut = dark > 0 ? watcher(sim, ship, dark + rating) : null;
      const eNow = watcher(sim, ship, A);
      const eExt = watcher(sim, ship, out);
      const seenLine = legs && eDark && eOut
        ? 'on the coast ' + eDark.name + ' gets a solution on ' + V.us + ' ' + seenAtWords(eDark) +
          ' with them stowed, ' + seenAtWords(eOut) + ' with them out'
        : eExt && eNow && rise >= T.minBenefit
          ? 'signature ' + power(A) + ' → ' + power(out) + ' · ' + seenWords(eExt, 'gets a solution on ' + V.us) +
            (eNow.solution >= eNow.at ? '' : ' instead of ' + km(eNow.solution))
          : pinnedByPlume(ship)
            ? V.our + ' plume already gives ' + herObj + ' a solution, so the radiators add nothing she can see'
            : 'this moves what ' + her + ' can see of ' + V.us + ' by less than a tenth';
      list.push({
        id: 'extend',
        label: 'Extend the radiators',
        detail: 'sheds ' + power(rating) + ' · ' + seenLine,
        panel: 'out',
        // Never while a cold coast is the plan and the sink survives it: the approach card stowed
        // them for that leg and issued the order on the promise.
        noRec: coasting,
        recommended: !coasting,
        benefit: rating > 0 ? null : 0,
        act: (s) => s.setRadiators(ship.id, true),
      });
      if (coasting && legs) {
        const dk = legView(ship, [{ secs: legs.burn, heatIn: heatAtThrottle(ship, 1, 0), panels: false },
          { secs: legs.coast, heatIn: heatAtThrottle(ship, 0, 0), panels: false }]);
        list.push({
          id: 'dark',
          label: 'Stay dark for the coast',
          panel: 'in',
          detail: 'the coast ends with the sink at ' + pct(dk.end) + ' · ' +
            (eDark && eOut
              ? seenWords(eDark, 'gets a solution on ' + V.us) +
                (eOut.solution >= eOut.at ? '' : ' instead of ' + km(eOut.solution))
              : V.say('nothing of ours is radiating', 'nothing aboard ' + V.name + ' is radiating')) +
            ' · the radiators extend at the brake',
          recommended: true,
          quiet: true,
          act: () => { /* the panels stay in: the coast was priced with them in */ },
        });
      }
    } else if ((share == null || share < 0.99) && gunHeat > 0) {
      // With the panels shedding everything the mounts make, holding back is not a choice at all:
      // sustained fire is full fire, so the option is left off rather than offered as a no-op.
      list.push({
        id: 'sustained',
        label: 'Sustained fire',
        detail: weak
          ? 'beams throttled to ' + pct(share) + ' of full · too little fire to hurt ' + herObj
          : 'beams at ' + (share != null ? pct(share) + ' of full' : 'what the radiators allow') +
            ' · the radiators shed all ' + power(view.shed) + ' of it, so the sink does not fill',
        // Under a sixth of the guns is not fire discipline, it is silence with a name, so the key
        // comes off the board rather than sitting there priced at nothing.
        dead: weak,
        noRec: weak,
        recommended: !weak,
        act: () => setFireMode(ship, 'sustained'),
      });
    }
    // Beams cold cuts the heat at once and keeps us where we are: the coilguns, the bays and the
    // point defence do not care about the sink, so this is not a retreat, and it is the answer
    // that stops the cooking without giving up the range — when the mounts are the ones cooking.
    // A card about a drive's thirty megawatts that offers to silence mounts making nothing is
    // offering a key that does nothing, which is how the band taught the player to stop reading.
    if (gunHeat > 0) {
      list.push({
        id: 'cold',
        label: V.say('Beams cold, stay on her', 'Beams cold, stay on ' + herObj),
        detail: 'the mounts stop making heat · ' + sinkPhrase(cold) +
          (hasKind(ship, 'coilgun') || hasKind(ship, 'launcher')
            ? ' · the coilguns and the bays keep firing until the sink fills, and then nothing fires'
            : V.say(' · we hold the range and wait it out', ' · ' + V.name + ' holds the range and waits it out')),
        recommended: weak && !stowed,
        act: () => setFireMode(ship, 'hold'),
      });
    }
    // Breaking off has to actually cut the heat, or it is a retreat that cooks anyway. A plain
    // retreat order burns at full throttle for as long as it is carried: it took a sink from 40 %
    // to full and held it there for 1 600 s while the hull fell 3 200 km. So the burn is costed
    // first, capped so it cannot fill the sink, ended by this module when it has done its work —
    // and the panels go out, because breaking off is the one moment nothing is shooting at them.
    const bo = breakBurn(sim, ship, target);
    const coldIn = heatAtThrottle(ship, 0, -gunHeat);
    const burnIn = heatAtThrottle(ship, 1, -gunHeat);
    const boLegs = legView(ship, [{ secs: bo.secs, heatIn: burnIn, panels: true }, { secs: 900, heatIn: coldIn, panels: true }]);
    const boTail = stepSink(ship, boLegs.endHeat, ratingOf(ship), coldIn, 7200);
    const boSink = boLegs.tFull != null ? 'the burn would fill the sink in ' + time(boLegs.tFull)
      : 'the sink peaks at ' + pct(boLegs.peak) +
        (boTail.tEmpty != null ? ' and drains in ' + time(boTail.tEmpty)
          : ' and settles at ' + pct(boTail.settle != null ? boTail.settle : boLegs.end));
    list.push({
      id: 'breakoff',
      label: 'Break off and cool',
      panel: 'out',
      detail: withNum('beams cold, radiators extended, ' + time(bo.secs) + ' of burn away from ' + herObj + ', then coasting at ' +
        spd(bo.speed) + ' · ' + boSink, 'the sink is at ' + pct(ship.thermalLoad())),
      passive: true,
      act: (s) => {
        setFireMode(ship, 'hold');
        s.setRadiators(ship.id, true);
        startBreak(s, ship, target, bo.secs);
      },
    });
    // A card with one key on it is not a question. With the mounts cold and the panels already
    // out there is no lever here but the burn, so the honest other answer is what this course
    // actually does to the sink.
    if (list.length < 2) {
      list.push({
        id: 'ride',
        label: 'Hold the course',
        detail: 'nothing spent · ' + (view.plan ? 'the coast ends with the sink at ' + pct(view.end) : sinkPhrase(view)) +
          ' · only the drive and the hull are making heat',
        passive: true,
        quiet: true,
        act: () => { /* the course stands: the choice is to spend nothing */ },
      });
    }
    return list;
  }

  // ---- 9. defend -------------------------------------------------------------------------------
  // Something is shooting at a ship we are here to bring home. The band's job is to make sure the
  // answer is never 'nothing'.
  function trigDefend(sim, ship) {
    if (civilian(ship) || ship.accel() <= 0) return null;
    const list = underAttack(sim);
    if (!list.length) return null;
    // The charge nearest this hull, and the attacker nearest her.
    let best = null, bd = Infinity;
    for (const g of list) {
      if (g.ship.id === ship.id) continue;
      const d = U.dist(g.ship.pos, ship.pos);
      if (d < bd) { bd = d; best = g; }
    }
    if (!best) return null;
    // Which of them to go for: the hull the board names, if one of them is her, and the nearest
    // otherwise. Two heavies sent at the frigate nobody has to sink, while the destroyer the
    // objective names went on shooting, is how chapter 4 was lost with both of them at full hull.
    let att = null, ad = Infinity;
    for (const a of best.attackers) {
      const d = trackRange(sim, ship, a.ship, best.ship.pos).R;
      const named = neutraliseOpen(sim, a.ship);
      const score = named ? d : d + 1e9;
      if (score < ad) { ad = score; att = a; }
    }
    if (!att) return null;
    // The bridge answered 'how do we close on her' a moment ago, and that order is the answer to
    // this question too. Asking again is how a cold approach chosen at t = 17 was replaced by a
    // full-throttle keep-range at t = 27, with the plume lit and nothing on the band saying so.
    if (since(sim, 'approach', att.ship.id) < T.defendGrace) return null;
    // 'Close on ISV Sabre' used to re-issue the approach the hull was already flying: same fight,
    // same end state, same delta-v, and the option's own words admitted it ('we keep the approach
    // we are already flying'). Closing on her is now a real closing order, so the card is only
    // held back when it would set the order this hull is already carrying.
    const o = ship.order || {};
    const dp = defendPlan(sim, ship, att.ship);
    // Already closing on the same hull under a cold coast: the card would light the drive to fly
    // the fight she is flying, and the coast chosen forty-five seconds ago would go with it. That
    // is the same no-op, read on the order she is carrying rather than on the one this card holds.
    if (o.type === 'approach' && o.target === att.ship.id) {
      noteSkip(sim, ship, 'defend', 'the coast ' + (ship.name || 'she') + ' is already flying at ' + att.ship.name);
      return null;
    }
    if (ship.weaponsFree && ship.target === att.ship.id && o.type === dp.order.type &&
      o.target === dp.order.target && Math.abs((o.range || 0) - (dp.order.range || 0)) < 1e3) {
      noteSkip(sim, ship, 'defend', 'the course ' + (ship.name || 'she') + ' is already flying at ' + att.ship.name);
      return null;
    }
    const protId = best.ship.id, attId = att.ship.id;
    const how = att.how;
    return {
      target: att.ship,
      title: best.ship.name + ' is under fire.',
      text: att.ship.name + ' has ' + (how === 'beams'
        ? 'her beams on ' + best.ship.name + ' from ' + rangeSay(trackRange(sim, ship, att.ship, best.ship.pos))
        : how + ' on ' + best.ship.name + (att.eta != null ? ', ' + time(att.eta) + ' out' : '')) +
        '. ' + best.ship.name + ' cannot answer.',
      until(s) {
        const me = s.byId(ship.id), p = s.byId(protId), a = s.byId(attId);
        if (!me || !p || !a || p.destroyed || p.captured || a.destroyed || a.captured) return true;
        return !attackersOn(s, p).some((x) => x.ship.id === attId);
      },
      build: (sm, d2, sh) => buildDefend(sm, d2, sh, sm.byId(attId), sm.byId(protId)),
    };
  }
  // How this hull gets on the attacker, and what it costs. A hull already coasting at her stops
  // coasting and burns in: the point of the card is that a ship we are here to bring home is being
  // shot at now, and a coast that arrives in eleven minutes is not an answer to that.
  function defendPlan(sim, ship, att, d) {
    const standoff = standoffFor(sim, ship, att, d);
    const R = trackRange(sim, ship, att).R;
    const coasting = !!(ship.order && ship.order.type === 'approach' && ship.order.target === att.id);
    // This card exists because something is shooting at a hull we are here to bring home, now. A
    // cold coast that arrives in eleven minutes is not an answer to that, and the old card's answer
    // was to hand a coasting hull back her own order: chapter 4's frigate and flagship were still
    // coasting at full armour while the corvette they were sent to cover was taken apart.
    // A hull already holding 162 km off the attacker does not need to be backed off to 294 by a
    // key labelled 'Close on'. The ladder gives a range to close to; where we are already standing
    // closer than that, the tighter of the two is the one the order carries and the one the key
    // prints. Chapter 4's escort was moved from 162 km to 294 km by this card and told nothing.
    const standing = ship.order && ship.order.type === 'keeprange' && ship.order.target === att.id &&
      ship.order.range > 0 ? ship.order.range : null;
    const hold = standing != null ? Math.min(standing, standoff) : standoff;
    return {
      coasting,
      plan: null,
      standoff,
      standing,
      order: { type: 'keeprange', target: att.id, range: hold },
      hold,
    };
  }
  function buildDefend(sim, d, ship, att, prot) {
    if (!att || !prot) return null;
    const V = voiceOf(ship, d.third);
    const herObj = foeHer(V, att);
    const view = trackRange(sim, ship, att);
    const R = view.R;
    const toProt = U.dist(ship.pos, prot.pos);
    const rate = pdRatePerMin(ship);
    const beaten = outgunned(sim, ship);
    const screen = { type: 'intercept', target: prot.id, range: T.screenRange };
    const dp = defendPlan(sim, ship, att, d);
    const plan = dp.plan;
    const order = dp.order;
    // A boarding run is an order like any other, and both of the first two keys overwrite it and
    // hand the weapons back. Chapter 2 sent a party at ISV Sabre and the next card called it off
    // without a word. The cost goes first on the key, where three clauses still fit.
    const board = state(sim).board;
    const boarder = (d.ships || [d.shipId]).map((x) => sim.byId(x))
      .find((sh) => sh && sh.heldFireForBoarding && board[sh.id]);
    const prize = boarder ? sim.byId(board[boarder.id].target) : null;
    const callsOff = boarder ? 'this calls off the boarding run on ' + (prize ? prize.name : 'her prize') + ' · ' : '';
    const how = plan
      ? (dp.coasting ? 'one more burn from where ' + V.say('we are', 'she is') + ' now, then dark again'
        : 'one burn, then dark the rest of the way')
      : 'the drive burns to get there, and every hostile holds a solution while it does';
    return [
      {
        id: 'closeon',
        label: 'Close on ' + att.name,
        detail: callsOff + rangeSay(view) + ' to ' + herObj + ' · hold at ' + km(dp.hold) +
          ' and put her out of the fight · ' + how,
        recommended: !beaten,
        burns: true,
        act: (s) => { s.setTarget(ship.id, att.id); ship.weaponsFree = true; ship.heldFireForBoarding = false; s.setOrder(ship.id, order); },
      },
      {
        id: 'screen',
        label: 'Point defence between',
        detail: callsOff + 'match ' + prot.name + ' at ' + km(T.screenRange) + ', inside ' + V.our + ' point defence reach of ' + km(pdReach()) + ' · ' +
          km(toProt) + ' to get there, under the drive · ' + V.our + ' point defence stops about ' + Math.round(rate) +
          ' a minute of what is aimed at ' + V.say('her', prot.name),
        recommended: beaten,
        burns: true,
        act: (s) => { ship.weaponsFree = true; ship.heldFireForBoarding = false; s.setOrder(ship.id, screen); },
      },
      {
        id: 'hold',
        label: V.say('Hold our station', 'Hold station'),
        detail: 'nothing spent · ' + prot.name + ' takes it alone at ' + km(toProt) + ' from ' + V.us +
          (boarder ? ' · the boarding run stands' : ''),
        passive: true,
        quiet: true,
        act: () => { /* the station is kept: the choice is to spend nothing */ },
      },
    ];
  }

  // ---- 10. aim ---------------------------------------------------------------------------------
  // A solution, her panels out, and our beams biting: the gunnery officer wants to know what to
  // point them at. Asked once per hull — after that the aim key is the player's.
  // What the beams should be on, read off the hull in front of us. Her panels are only worth
  // shaving while she still has cooling to lose and hull enough that taking it the slow way is not
  // the shorter road: once her sink is capped, her panels are in, her sink is filling on its own or
  // her hull is under a third, the answer is the whole cross-section and nothing else.
  function aimWanted(sim, ship, target) {
    const panels = !!(target.radiators && target.radiators.state > 0.5);
    const load = target.thermalLoad ? target.thermalLoad() : 0;
    const capped = load >= T.theirSink || target.overheated;
    const view = sinkView(target, undefined);
    const soon = view.tFull != null && view.tFull < T.aimSoon;
    const thin = target.hull != null && target.hull < T.aimThird;
    // And the shot has to land. Aimed at her panels the beams open her armour from closer in than
    // they do aimed at the hull, so outside that range the answer is the whole cross-section
    // whatever her radiators are doing.
    const reaches = ship ? aimBite(sim, ship, target, 'radiators') >= trackRange(sim, ship, target).R : true;
    return panels && !capped && !soon && !thin && reaches ? 'radiators' : 'hull';
  }
  function trigAim(sim, ship) {
    if (civilian(ship) || !ship.weaponsFree || !hasBeams(ship)) return null;
    if (fireModeOf(ship) === 'hold') return null;
    const target = designated(sim, ship);
    if (!target) return null;
    const want = aimWanted(sim, ship, target);
    if (aimOf(ship) === want) return null;
    const bite = bites(sim, ship, target).ours;
    const view = trackRange(sim, ship, target);
    const R = view.R;
    if (!(bite > 0) || R > bite) return null;
    if (qualityOf(sim, ship, target) < T.aimQ) return null;
    const id = target.id;
    // The sentence carries the state that decides the answer, in words rather than a percentage
    // that moves every second, so the question comes back when the answer changes and stays away
    // when it has not: her radiators stowing, her sink capping, her hull passing a third.
    const panels = !!(target.radiators && target.radiators.state > 0.5);
    const capped = (target.thermalLoad ? target.thermalLoad() : 0) >= T.theirSink || target.overheated;
    const thin = target.hull != null && target.hull < T.aimThird;
    const at = rangeSay(view);
    return {
      target,
      title: (sm, sh, third) => (third && sh && sh.name
        ? 'Where does ' + sh.name + ' put the beams on ' + target.name + '?'
        : 'Where do we put the beams on ' + target.name + '?'),
      text: (sm, sh, third) => {
        const V = voiceOf(sh || ship, third);
        const hers = V.third ? target.name + '\u2019s' : 'Her';
        const she = V.third ? target.name : 'She';
        const why = want === 'radiators'
          ? hers + ' radiators are out and her sink still has room. Burn them off and she cannot get that cooling back.'
          : !panels ? hers + ' radiators are stowed, so there is nothing out there to burn off.'
            : capped ? hers + ' sink is full already, so taking her radiators changes nothing.'
              : thin ? hers + ' hull is under a third, so the whole cross-section finishes her sooner.'
                : hers + ' sink fills on its own within two minutes, so her radiators are not worth the shot.';
        // The reach is not one number: the beams open her nose at 433 km, her flank at 685 and her
        // tail at 1 027, so 'inside our burn-through at 891 km' was true of the tail and false of
        // everything else. The sentence names the facet she is showing, the range to her and the
        // range the beams open that facet at, and says 'outside' when it is outside.
        const s2 = sm || sim;
        const me2 = (s2 && s2.byId(ship.id)) || ship;
        const t2 = (s2 && s2.byId(id)) || target;
        const b2 = bites(s2, me2, t2).ours;
        const facet2 = facetOf(me2, t2) || 'armour';
        const at2 = rangeSay(trackRange(s2, me2, t2));
        const R2 = trackRange(s2, me2, t2).R;
        const ourBeams2 = V.say('our beams', V.name + '\u2019s beams');
        const hers2 = foeOwn(V, target);
        const reach2 = !(b2 > 0)
          ? ' ' + ourBeams2 + ' do not burn through ' + hers2 + ' ' + facet2 + ' at any range.'
          : R2 <= b2
            ? ' ' + she + ' is at ' + at2 + ', and ' + ourBeams2 + ' burn through ' + hers2 + ' ' +
              facet2 + ' out to ' + km(b2) + '.'
            : ' ' + she + ' is at ' + at2 + ', outside the ' + km(b2) + ' ' + ourBeams2 +
              ' burn through ' + hers2 + ' ' + facet2 + '.';
        return why + reach2;
      },
      until(s) {
        const me = s.byId(ship.id), t = s.byId(id);
        if (!me || !t || t.disabled) return true;
        if (aimOf(me) === aimWanted(s, me, t)) return true;
        const b = bites(s, me, t).ours;
        return !(b > 0) || trackRange(s, me, t).R > b * 1.3;
      },
      build: buildAim,
    };
  }
  function buildAim(sim, d, ship, target) {
    if (!target) return null;
    const V = voiceOf(ship, d.third);
    const she = foeWord(V, target);
    const herOwn = foeOwn(V, target);
    const rating = ratingOf(target);
    const shut = sinkView(target, false);
    const now = sinkView(target, undefined);
    const want = aimWanted(sim, ship, target);
    const panels = !!(target.radiators && target.radiators.state > 0.5);
    // The ladder this aim actually has. A narrower aim point lands less energy, so it burns
    // through from closer in: at 889 km the hull ladder read 685 km on her flank and the radiators
    // ladder 599, and the card lit her radiators anyway — 120 s of firing for nothing through.
    const radBite = aimBite(sim, ship, target, 'radiators');
    const R = trackRange(sim, ship, target).R;
    const radReaches = radBite > 0 && R <= radBite;
    return [
      {
        id: 'radiators',
        label: V.say('Her radiators', target.name + '\u2019s radiators'),
        detail: !panels
          ? herOwn + ' radiators are stowed, so ' + pct(0) + ' of the shot lands on them'
          : !radReaches
            ? 'aimed at the panels the beams only burn through ' + herOwn + ' ' +
              (facetOf(ship, target) || 'armour') + ' inside ' + km(radBite) + ', and ' + she + ' is at ' +
              rangeSay(trackRange(sim, ship, target)) + ' · nothing lands until ' + V.we + ' close that far · ' +
              she + ' loses ' + power(rating) + ' of cooling once it does'
            : she + ' loses ' + power(rating) + ' of cooling and must stow the rest · ' +
              (shut.tFull != null ? herOwn + ' sink then fills in ' + time(shut.tFull) : herOwn + ' sink still does not fill') +
              ' · the radiators are a small target, so less of the shot lands · ' + pct(target.hull) + ' of ' + herOwn + ' hull left',
        dead: !panels,
        noRec: !radReaches,
        recommended: want === 'radiators' && radReaches,
        act: () => setAim(ship, 'radiators'),
      },
      {
        id: 'hull',
        label: V.say('Her hull', target.name + '\u2019s hull'),
        detail: 'the whole cross-section, so all of the shot lands · ' + pct(target.hull) + ' of ' + herOwn + ' hull left · ' +
          (now.tFull != null ? herOwn + ' sink fills in ' + time(now.tFull) + V.say(' without our help', ' on its own')
            : herOwn + ' sink is at ' + pct(target.thermalLoad ? target.thermalLoad() : 0)),
        recommended: want === 'hull',
        act: () => setAim(ship, 'hull'),
      },
    ];
  }

  // ---- 11. withdraw ----------------------------------------------------------------------------
  // Our own hull, half of it gone, and the fight still coming. Chapter 4's flagship died between
  // t = 281 and t = 601 with 48 km/s still in her tanks, and the only cards on the band in that
  // whole window were 'jink' and 'aim': the layer had no way of asking the one question left.
  function underFire(sim, ship) {
    for (const r of threatsOn(sim, ship) || []) {
      if (r.kind === 'slug' && r.willHit) return true;
      if (r.kind === 'interceptor' && (r.eta == null || r.eta <= T.defendEta)) return true;
    }
    for (const h of sim.hostiles(ship)) {
      if (h.disabled || civilian(h) || !h.weaponsFree) continue;
      const b = bites(sim, ship, h).theirs;
      if (b > 0 && U.dist(h.pos, ship.pos) <= b) return true;
    }
    return false;
  }
  // A hull creeping up on us with her weapons tight, matching our velocity, is not 'not shooting':
  // she is about to put a party aboard. Nothing about that looks like an attack to a threat list,
  // which is how chapter 4's corvette was boarded with the band saying nothing at all.
  function boardingUs(sim, ship) {
    const B = boardNumbers();
    for (const h of sim.hostiles(ship)) {
      if (civilian(h) || h.disabled || h.destroyed || h.captured) continue;
      if (U.dist(h.pos, ship.pos) > B.range * 6) continue;
      if (U.len(U.sub(h.vel, ship.vel)) > B.speed * 4) continue;
      return h;
    }
    return null;
  }
  // The healthiest warship on our side that is not us: the hull worth getting behind.
  function sister(sim, ship) {
    let best = null, bw = 0;
    for (const s2 of sim.ships) {
      if (s2 === ship || s2.faction !== ship.faction) continue;
      if (s2.destroyed || s2.captured || s2.disabled || civilian(s2) || station(s2)) continue;
      const w = fightWeight(s2) * U.clamp(s2.hull != null ? s2.hull : 1, 0, 1);
      if (w > bw) { bw = w; best = s2; }
    }
    return best;
  }
  function closingOn(ship, target) {
    const R = U.dist(ship.pos, target.pos);
    if (!(R > 1)) return 0;
    return U.dot(U.sub(ship.vel, target.vel), U.scale(U.sub(target.pos, ship.pos), 1 / R));
  }
  // Armour comes off in joules. The hull budget is the dry mass times the damage model's joules
  // per kilogram, and beams, slugs and interceptors all spend out of that one budget.
  function hullBudget(ship) {
    const D = OD.Damage;
    const perKg = D && D.T && D.T.hullJoules > 0 ? D.T.hullJoules : 1400;
    return Math.max(1, (ship.dryMass || 1) * perKg);
  }
  // The fire landing on this hull right now: every beam burning through her plating this substep,
  // and every round and interceptor already in the sky that her point defence will not stop, each
  // with the joules it will arrive with and the seconds it has left to fly.
  function incomingFire(sim, ship) {
    const out = { watts: 0, hits: [], shooters: 0, darts: 0, slugs: 0 };
    const E = OD.Engagement, S = E && E.shared;
    if (!S) return out;
    let raw = 0;
    let foes = [];
    try { foes = sim.hostiles(ship) || []; } catch (e) { foes = []; }
    for (const h of foes) {
      if (!h || h.destroyed || h.disabled || h.captured || civilian(h)) continue;
      let t = null, st = null;
      try { t = S.engagementTarget(sim, h); } catch (e) { t = null; }
      if (!t || t.id !== ship.id) continue;
      try { st = S.stateOf(h); } catch (e) { st = null; }
      if (st && st.through > 0) { raw += st.through; out.shooters++; }
    }
    // The vapour a beam blows off the armour soaks what comes after it, so four shooters are worth
    // far less than four times one: saturate the sum the way the sim does before any of it lands.
    if (raw > 0) {
      let sat = 0;
      try { sat = S.plumeSaturation(ship); } catch (e) { sat = 0; }
      out.watts = sat > 0 ? sat * Math.tanh(raw / sat) : raw;
    }
    const pool = engPool(sim);
    if (!pool) return out;
    const byId = new Map();
    for (const it of pool.interceptors || []) byId.set(it.id, it);
    for (const sl of pool.slugs || []) byId.set(sl.id, sl);
    // Her own point defence takes a share of the darts; price what is left of them.
    let sum = null;
    try { sum = E.threatSummary(sim, ship); } catch (e) { sum = null; }
    const share = sum && sum.incoming > 0 ? U.clamp(1 - (sum.pdCanStop || 0) / sum.incoming, 0, 1) : 1;
    const cap = hullBudget(ship);
    for (const r of threatsOn(sim, ship) || []) {
      if (!r || !r.willHit) continue;
      const o = byId.get(r.id);
      if (!o) continue;
      const facet = facetOf({ pos: { x: r.x, y: r.y } }, ship) || 'flank';
      let j = 0;
      try {
        j = r.kind === 'slug'
          ? S.kineticThrough(S.slugArrivalEnergy(o), ship, facet)
          : S.kineticThrough(S.relEnergy(S.dartMass(o), o.vel.x, o.vel.y, ship), ship, facet) * share;
      } catch (e) { j = 0; }
      if (!(j > 0)) continue;
      if (r.kind === 'slug') out.slugs++; else out.darts++;
      out.hits.push({ eta: r.eta != null && r.eta > 0 ? r.eta : 0, hull: j / cap });
    }
    out.hits.sort((a, b) => a.eta - b.eta);
    return out;
  }
  // How long the armour lasts at that fire: the beams take it off continuously, each volley takes
  // its lump off when it arrives, and the answer is the moment there is none left. The measured
  // rate is kept as a floor — something may be hurting her that this does not model — but it is
  // never the whole answer, because a hull with twelve interceptors in the air is not losing
  // armour at the rate the last twenty seconds showed.
  function hullLife(sim, ship) {
    const hull = ship.hull != null ? ship.hull : 1;
    const inc = incomingFire(sim, ship);
    const beam = inc.watts / hullBudget(ship);
    // `to` is how long until the armour is down to a given fraction: 0 for the hull gone, the
    // withdraw line for the moment the question has to have been asked.
    const to = (floor) => {
      let left = hull - floor, t = 0;
      if (left <= 0) return 0;
      for (const h of inc.hits) {
        const dt = Math.max(0, h.eta - t);
        if (beam > 0 && left - beam * dt <= 0) return t + left / beam;
        left -= beam * dt;
        t = h.eta;
        left -= h.hull;
        if (left <= 0) return t;
      }
      return beam > 0 ? t + left / beam : null;
    };
    let life = to(0);
    let line = to(T.withdrawHull);
    const seen = hullRate(sim, ship);
    if (seen > 0) {
      const byRate = hull / seen;
      life = life == null ? byRate : Math.min(life, byRate);
      const toLine = Math.max(0, hull - T.withdrawHull) / seen;
      line = line == null ? toLine : Math.min(line, toLine);
    }
    // A volley that is already aboard is not a life of nought: the card still has to be readable.
    if (life != null) life = Math.max(1, life);
    return { life, line, rate: life != null && life > 0 ? hull / life : 0, inc };
  }
  // How fast this hull is losing armour, per second, from a sample a few seconds old. A corvette
  // under two frigates loses a hundredth of a hull a second: waiting for the half to be gone is
  // waiting twenty seconds too long, so the question is asked as soon as the half is that close.
  // Armour does not come off at a steady rate: it comes off in bursts, so the reading is taken
  // against a baseline twenty seconds old rather than against the last pass, which is noise.
  function hullRate(sim, ship) {
    const st = state(sim);
    if (!st.hull) st.hull = Object.create(null);
    const hull = ship.hull != null ? ship.hull : 1;
    let rec = st.hull[ship.id];
    if (!rec || sim.time < rec.at) { st.hull[ship.id] = { at: sim.time, hull, rate: 0 }; return 0; }
    const dt = sim.time - rec.at;
    if (dt < 5) return rec.rate || 0;
    const rate = Math.max(0, (rec.hull - hull) / dt);
    if (dt >= 20) st.hull[ship.id] = { at: sim.time, hull, rate };
    else rec.rate = rate;
    return rate;
  }
  // The fight this hull is in, rather than the one the mission board is in: how many hostiles can
  // reach her where she is, against how many of ours are close enough to share it. A corvette
  // alone in front of two frigates is not in the same battle as the two frigates behind her.
  function localOdds(sim, ship) {
    let foes = 0, friends = 1;
    for (const h of sim.hostiles(ship)) {
      if (civilian(h) || h.disabled || h.destroyed || h.captured) continue;
      const b = bites(sim, ship, h).theirs;
      if (b > 0 && U.dist(h.pos, ship.pos) <= b * T.radiatorReach) foes++;
    }
    for (const s2 of sim.ships) {
      if (s2 === ship || s2.faction !== ship.faction || civilian(s2) || station(s2)) continue;
      if (s2.destroyed || s2.captured || s2.disabled) continue;
      if (U.dist(s2.pos, ship.pos) <= T.together) friends++;
    }
    return { foes, friends, trapped: foes >= 2 && foes > friends };
  }
  function trigWithdraw(sim, ship) {
    if (civilian(ship) || ship.accel() <= 0) return null;
    const hull = ship.hull != null ? ship.hull : 1;
    const clock = hullLife(sim, ship);
    const rate = clock.rate;
    // A hull the board says to bring home is asked while getting behind a sister is still something
    // she can do: at half a hull the sister is often four minutes away and the armour two. Chapter
    // 4's corvette went from full armour to 48 % in two minutes and was asked eight seconds after
    // she crossed the line, with JCS Bastion 2m 11s off.
    const home = mustComeHome(sim, ship);
    const warn = home ? T.homeSoon : T.hullSoon;
    // Two clocks, and the question is put on whichever runs out first. The armour crossing the
    // withdraw line is the slow one. The fast one is the fire already in the air: chapter 4's
    // corvette was at 90 % of her hull with twelve interceptors closing on her and four minutes of
    // beams landing, and the card could not be raised until the gauge caught up — by which time
    // she had 1m 42s left. A hull the fire landing on her empties inside dyingSoon is asked now,
    // whatever the gauge reads.
    // At full armour the bar is the short window: a volley four minutes out is not a reason to
    // leave a fight, and a hull that will be past the line inside 90 s is.
    const soon = clock.line != null && clock.line < (hull < T.hullWarn ? warn : T.hullSoon);
    // Two ways to be losing a fight: the armour is going, or the arithmetic is. A hull that has
    // walked out in front of two guns with nobody of ours in reach is losing the second one long
    // before the first shows on the gauge, which is how chapter 4's flagship died at full hull.
    const odds = localOdds(sim, ship);
    const boarder = boardingUs(sim, ship);
    const foe = boarder || nearestWarship(sim, ship, false);
    if (!foe) return null;
    const fire = underFire(sim, ship) || !!boarder;
    const trapped = odds.trapped && (fire || closingOn(ship, foe) > 10);
    if (hull > T.withdrawHull && !soon && !trapped) return null;
    // E3: at 100.0 % of her armour with nothing hit, 'should we break off?' is a question about
    // nothing. Chapter 4 put it on every hull at 279 s and lit 'Break off and open' at 349 s, and
    // the retreat under fire is the ch4 1s 10s loss. Above withdrawFull the only thing worth
    // asking about is the armour, and only while the clock the card prints is short: the arithmetic
    // of being outnumbered is the range card's and the escort card's question at that hull.
    if (hull > T.withdrawFull && !(soon && clock.life != null && clock.life < T.withdrawClock)) return null;
    if (!fire && !(closingOn(ship, foe) > 10)) return null;
    const id = foe.id;
    const hurt = hull <= T.withdrawHull || soon;
    const atBoarder = boarder ? rangeSay(trackRange(sim, ship, boarder)) : '';
    const atFoe = rangeSay(trackRange(sim, ship, foe));
    // Her party crossing to us, priced the way the sim charges it: her decks against ours.
    const held = time(boardPlan(boarder || foe, ship).time);
    return {
      target: foe,
      // Every number in the title is read off the hull as the card is drawn: an armour figure
      // that froze at the moment the question was raised was still saying 83 % while the options
      // under it counted down.
      title: (sm, sh, third) => {
        const me = (sm && sm.byId(ship.id)) || ship;
        const V = voiceOf(sh || me, third);
        const h2 = me.hull != null ? me.hull : 1;
        const bd = (sm ? boardingUs(sm, me) : null) || boarder;
        if (bd) return bd.name + ' is coming alongside to board ' + V.us + '.';
        if (hurt || h2 <= T.withdrawHull) {
          // Above the hull line the card is raised on the armour clock, not on the hull: at 100 %
          // of her armour 'We are down to 100 % of our hull' reads as a misprint. Title the clock
          // the card is actually about, which the first key already prints.
          if (h2 > T.withdrawHull) {
            const lf = sm ? hullLife(sm, me).life : null;
            if (lf != null) {
              return V.say('Our armour lasts ' + time(lf) + ' at this fire.',
                V.name + '\u2019s armour lasts ' + time(lf) + ' at this fire.');
            }
          }
          return V.say('We are down to ' + pct(h2) + ' of our hull.', V.name + ' is down to ' + pct(h2) + ' of her hull.');
        }
        const n = (sm ? localOdds(sm, me).foes : 0) || odds.foes;
        return V.say(Count(n) + ' of them have us in reach, and nobody of ours is close.',
          Count(n) + ' of theirs can reach ' + V.name + '. None of ours is near her.');
      },
      text: (sm, sh, third) => {
        const V = voiceOf(sh || ship, third);
        if (boarder) {
          return V.say('She is ' + atBoarder + ' off and matching our velocity. ' + held +
            ' of this and the ship is hers. Any hard burn breaks the match.',
          boarder.name + ' is ' + atBoarder + ' off and matching ' + V.our + ' velocity. ' + held +
            ' of this and ' + V.name + ' is hers. Any hard burn breaks the match.');
        }
        if (hurt) {
          return V.say((fire ? 'She has the range on us' : 'We are still closing on her') + ' at ' + atFoe +
            ', and the next hit goes deeper than the last.',
          (fire ? foe.name + ' has the range on ' + V.name : V.name + ' is still closing on ' + foe.name) + ' at ' + atFoe +
            ', and the next hit goes deeper than the last.');
        }
        return 'The nearest of them is ' + atFoe + ' off, and ' +
          V.say('our nearest sister is too far to cover us. ', V.name + ' has no sister close enough to cover her. ') +
          'Being shot at by more hulls than you can answer is how ships are lost at full armour.';
      },
      // It lapses when every reason for it has gone, not when one of them has. A card raised on a
      // hull falling fast and closed a second later because the hull is still over the line is a
      // card that never reaches the band — and its cooldown then holds the question shut for ten
      // minutes, which is how the flagship was lost with the question technically 'asked'.
      until(s) {
        const me = s.byId(ship.id), t = s.byId(id);
        if (!me || !t) return true;
        if (boardingUs(s, me)) return false;
        const h2 = me.hull != null ? me.hull : 1;
        const c2 = hullLife(s, me);
        const falling = c2.line != null && c2.line < T.hullSoon * 1.5;
        if (h2 <= T.withdrawClear || falling || localOdds(s, me).trapped) return false;
        return !underFire(s, me) && closingOn(me, t) <= 0;
      },
      build: buildWithdraw,
    };
  }
  // F3: the card lit 'Break off and open' beside its own clause 'clearing that takes 4h 59m \u00b7 the
  // armour lasts 51 s'. Where neither the burn nor the sister gets her out before the armour
  // goes, the card says so in its own sentence instead of pointing at a key that does not work.
  // The sentence is put on the card's text source, so every refresh keeps it.
  function noteNoWayOut(d, none) {
    if (d._noWayOut === none) return;
    d._noWayOut = none;
    if (d._textBase === undefined) d._textBase = d._text;
    const base = d._textBase;
    d._text = !none ? base : (sm, sh, third) => {
      const said = typeof base === 'function' ? (base(sm, sh, third) || '') : String(base || '');
      return said + ' Nothing on this card opens the range before the armour goes.';
    };
  }
  function buildWithdraw(sim, d, ship, target) {
    const V = voiceOf(ship, d.third);
    const herObj = foeHer(V, target);
    const herOwn = foeOwn(V, target);
    const hull = ship.hull != null ? ship.hull : 1;
    const bo = breakBurn(sim, ship, target);
    const bite = target ? bites(sim, ship, target).theirs : 0;
    const view = target ? trackRange(sim, ship, target) : null;
    const R = view ? view.R : 0;
    const sis = sister(sim, ship);
    // Nearly won is the one case where staying in it is the navigator's pick: everything else on
    // this card is a hull that will still be here for the next chapter.
    const won = balance(sim, ship) >= T.winning;
    // What the burn actually buys, in time rather than in words. A hundred and fifty seconds of
    // drive covers sixty-two kilometres; the twelve hundred left of her fourteen-hundred-kilometre
    // bite take twenty-five minutes at eight hundred metres a second, every one of them inside her
    // beams — and the card called that cover. So it is priced: how long the opening speed needs to
    // clear her bite, against how long this hull lasts at the rate it is losing armour. Past
    // either, the burn buys distance, the card says so, and it is not the navigator's pick.
    const wantOut = bite > 0 ? bite * T.breakOpen : 0;
    // F-2: what the burn opens at against a hull that can burn after us. A pursuer with our
    // acceleration matches every metre of it, and the range then only opens as fast as the
    // difference — 3 km a minute, not 1.5 km a second. Chapter 2's card promised 'outside her
    // 837 km burn-through in 9m 40s' against ISV Sabre on keeprange → Larkspur; at the promised
    // moment the range was 317 km and the hull was at 37 %.
    const aMe = ship.accel ? ship.accel() : 0;
    const aHer = target && typeof target.accel === 'function' ? target.accel() : 0;
    const dvHer = target && typeof target.deltaV === 'function' ? target.deltaV() : 0;
    const follows = !!target && !target.destroyed && !target.captured && !target.disabled &&
      dvHer > bo.speed &&
      ((target.order && target.order.target === ship.id && /^(keeprange|intercept|approach)$/.test(target.order.type)) ||
        closingOn(ship, target) > 10);
    const matched = follows ? Math.min(bo.speed, aHer * bo.secs) : 0;
    const netSpeed = Math.max(0, bo.speed - matched);
    // She burns with us from the first second, so the burn itself only opens what the difference
    // in acceleration opens: half the net speed times the length of the burn, not half of ours.
    const opened = follows ? 0.5 * netSpeed * bo.secs : bo.opened;
    const need = Math.max(0, wantOut - R - opened);
    const clear = wantOut <= 0 ? 0 : need <= 0 ? bo.secs : netSpeed > 1 ? bo.secs + need / netSpeed : null;
    // F-2 again, at the end of it: when she matches the whole burn the opening speed rounds to
    // nothing, and the key was still printing 'opening at 0 m/s' as though that were a result.
    // A burn that opens nothing says so on the label, and is never the pick while anything else
    // on the card will do.
    const opensNothing = follows && spd(netSpeed) === spd(0);
    const matchedBy = (follows && netSpeed < bo.speed * 0.25) || opensNothing
      ? V.say(' · she can match this burn, so the range only opens once her drive is hurt',
        ' · ' + herObj + ' can match this burn, so the range only opens once her drive is hurt')
      : '';
    const clock = hullLife(sim, ship);
    const life = clock.life;
    const rate = clock.rate;
    // The fire landing on her now, in the words the clause uses: one shooter or three, and what is
    // already in the sky.
    const inc = clock.inc;
    const air = inc.darts + inc.slugs;
    // The horizon is the hull's own: how long she lasts at the rate her armour is coming off. With
    // nothing landing on her there is no such clock, so the card falls back on its own — a burn
    // that needs half an hour to clear her guns is not cover by anybody's reckoning.
    // A break-off burns away from her, so the whole run shows her the tail: 4 cm on a corvette
    // against 20 cm on the nose. Chapter 4's corvette was lit 'Break off and open · outside her
    // 847 km burn-through in 16m 22s', turned her tail to a destroyer whose beams reached the
    // whole way, and lost her drive 136 s later. A run made under her beams gets the card's own
    // horizon, not three times it, and the key says which facet it turns toward her.
    const tailCm = armourCm(ship, 'tail'), noseCm = armourCm(ship, 'nose');
    const runsTail = bite > 0 && clear != null && clear > 0 && tailCm > 0 && noseCm > tailCm;
    const horizon = life != null ? Math.min(life, T.coverHorizon * (runsTail ? 1 : 3)) : T.coverHorizon;
    const covers = clear != null && clear <= horizon;
    // F3: an escape the card itself prices longer than the armour clock is not an escape. The
    // test is a priced one: 'clearing that takes 21m 59s' beside 'the armour lasts 2m 57s' reads
    // as a way out and is not one. A course that never clears her reach at all is a different
    // clause and an honest one — the key says the range will not open, or that the burn buys
    // distance and stays inside her beams, and chapter 4 is won on exactly that burn at 343 s.
    const escapeSlow = bite > 0 && life != null && clear != null && clear > life;
    const toSis = sis ? U.dist(ship.pos, sis.pos) : Infinity;
    // 'Near' is a time, not a distance: getting behind her is worth recommending when we can be
    // there before the burn would have cleared the bite, and when she can take the next one.
    const toSisT = sis && aMe > 0 ? 2 * Math.sqrt(Math.max(0, toSis - T.screenRange) / aMe) : null;
    // Cover that arrives after the armour has gone is not cover: the card lit 'Get behind JCS
    // Bastion, 4m 48s to get behind her' while its own first option said the armour lasts 38 s.
    const inTime = toSisT != null && toSisT <= horizon;
    // The run to her is made under the same beams, so the armour keeps coming off all the way: a
    // hull with five minutes of armour left cannot spend five minutes getting behind a sister.
    // Chapter 4's corvette was lit 'Get behind JCS Bastion · 5m 01s to get behind her' and was
    // gone 59 s later. Cover is the pick only when it arrives inside half the hull's own clock.
    const sisNear = !!sis && inTime && toSisT <= horizon * 0.5 && (clear == null || toSisT < clear) &&
      (sis.hull != null ? sis.hull : 1) >= hull;
    // The hull has less life left than the fight does. Staying in it is then the option that ends
    // the mission, and it is never the one the band points at: chapter 4's corvette was lit
    // 'Press on · the board says this hull comes home' at 85 % of her armour, with three hostiles
    // shooting and twelve interceptors in the air, and she was out of the fight 64 s later.
    const dying = life != null && life < T.dyingSoon;
    // An interceptor carries its own drive and steers, so a burn away from her does not open the
    // range on one: it spends our propellant and arrives at the same time. Chapter 4 lit 'Break
    // off and open' at 339 s with Larkspur at 99 % of her armour, twelve interceptors in the air
    // and ISV Coriolis's beams 36 km short of us; the burn cleared nothing, and the division spent
    // the rest of the chapter out of the fight with the objective open. Where the clock is the
    // darts and not her beams, the burn is not the answer and the key says so.
    const inAir = inc.hits.reduce((a, h) => a + h.hull, 0);
    const dartLed = inc.darts > 0 && inAir >= hull * 0.5;
    // Breaking off is the answer to losing a fight, not to being in one. At 61 % of a corvette
    // against 62 % of hers the burn clears her guns just as well, and lighting it hands back a
    // fight that was level: chapter 2 ran out of clock that way with ISV Sabre at 15 %. So cover
    // is the navigator's pick only once this hull is behind — on the hull she has left, or on the
    // weight both sides still have in the fight.
    const hers = target && target.hull != null ? target.hull : 1;
    const behind = hull < hers * 0.9 || balance(sim, ship) < T.outgunned;
    const list = [];
    list.push({
      id: 'breakoff',
      label: opensNothing ? V.say('Break off: she can match the burn',
        'Break off: ' + herObj + ' can match the burn') : 'Break off and open',
      // Where she matches the whole burn, why the range holds is the first thing to read: three
      // clauses is what a key holds, and behind the Why? key is not where that belongs.
      detail: time(bo.secs) + ' of burn away from ' + herObj + ', then cold' +
        (opensNothing ? matchedBy : '') + ' · ' +
        // 'coasting at 0 m/s · outside her burn-through in 9m 40s' is a promise the coast does not
        // keep: where she matches the whole burn the key reads the same way it does when the burn
        // buys distance and nothing else.
        (covers && !opensNothing
          ? 'coasting at ' + spd(netSpeed) + ' · outside ' + herOwn + ' ' + km(bite) + ' burn-through in ' + time(clear)
          : (bite > 0
            ? herOwn + ' beams reach ' + km(bite) + ', and ' + (clear == null ? 'this course never clears that'
              : 'clearing that takes ' + time(clear)) +
              (life != null ? ' · the armour lasts ' + time(life) : '') +
              (opensNothing ? '' : ' · opening at ' + spd(netSpeed)) +
              V.say(' · this buys distance, and we stay inside her beams',
                ' · this buys distance, and ' + V.name + ' stays inside ' + herOwn + ' beams')
            // R-5: her bite has fallen to nothing, so there is no burn-through to get outside of.
            : herOwn + ' beams cannot reach ' + V.us + ' at any range now' +
              (opensNothing ? '' : ' · opening at ' + spd(netSpeed)) +
              ' · ' + rangeSay(view) + (opensNothing ? ' out' : ' out and opening'))) +
        (opensNothing ? '' : matchedBy) +
        (dartLed ? ' · ' + count(inc.darts) + ' interceptors in the air carry their own drive and follow this burn' : '') +
        (runsTail ? ' · the run turns ' + V.our + ' tail to ' + herObj + ': ' + tailCm + ' cm against ' +
          noseCm + ' cm on the nose' : '') +
        ' · ' + pct(hull) + ' of hull left',
      // With the armour running out, a burn that only buys distance is still the answer: it is the
      // one key on the card that takes hull out of the fire. Unless the fire is interceptors, which
      // come with it.
      noRec: escapeSlow || opensNothing || (!covers && !dying) || (dartLed && !covers),
      // F3: an escape slower than the armour does not do what the key says, so it is not the
      // band's answer even when everything else on the card is quiet.
      never: escapeSlow,
      recommended: !escapeSlow && !opensNothing && !won && (covers || (dying && !sisNear && !dartLed)) && behind,
      act: (s) => startBreak(s, ship, target || null, bo.secs, true),
    });
    if (sis) {
      list.push({
        id: 'sister',
        label: 'Get behind ' + sis.name,
        detail: inTime
          ? km(toSis) + ' to ' + sis.name + ', ' + time(toSisT) + ' to get behind her · match her at ' + km(T.screenRange) +
            ', inside her point defence reach of ' + km(pdReach()) + ' · ' + V.say('she is at ', sis.name + ' is at ') +
            pct(sis.hull) + ' of hull and can take the next hit'
          : sis.name + ' is ' + time(toSisT) + ' away' +
            (life != null ? '; the armour lasts ' + time(life) : '; nothing of ours is that close') +
            ' · ' + km(toSis) + ' to her, under the drive the whole way · ' +
            V.say('she is at ', sis.name + ' is at ') + pct(sis.hull) + ' of hull',
        noRec: !inTime,
        // F3: where the burn cannot outrun the armour clock, cover is the one thing left that can.
        recommended: !won && inTime && ((!covers && (sisNear || dartLed) && (behind || dying)) || escapeSlow),
        burns: true,
        act: (s) => s.setOrder(ship.id, { type: 'intercept', target: sis.id, range: T.screenRange }),
      });
    }
    // F3: neither way out does what its key says — the burn is priced slower than the armour and
    // the sister is farther off than the clock. The card says so rather than lighting one of them.
    const stuck = escapeSlow && !inTime;
    // What staying in it costs. 'Ours against hers' is two hulls' worth of arithmetic on a card
    // that three hostiles are shooting at, so where more than one of them can reach us the clause
    // counts them instead of comparing one.
    const odds = localOdds(sim, ship);
    const standing = odds.foes > 1
      ? pct(hull) + V.say(' of our hull left, and ', ' of ' + V.name + '\u2019s hull left, and ') +
        count(odds.foes) + ' of theirs can reach ' + V.us
      : pct(hull) + V.say(' of our hull against ', ' of ' + V.name + '\u2019s hull against ') +
        pct(target && target.hull != null ? target.hull : 1) + V.say(' of hers', ' of ' + herOwn);
    list.push({
      id: 'press',
      label: 'Press on',
      detail: 'nothing spent · ' + standing +
        (won ? ' · the fight is nearly over'
          : life != null
            ? ' · the armour lasts ' + time(life) + ' at the fire landing on ' + V.us + ' now' +
              (air > 0 ? ', with ' + count(air) + ' still in the air' : '')
            : !behind ? ' · the exchange is level so far'
              : ' · the next hit goes deeper than the last'),
      // Never the recommendation while the armour is running out: this is the key that ends the
      // mission, and the card has to point at one that does not.
      noRec: dying && (covers || sisNear || bo.secs >= 10),
      recommended: won || (!dying && (!behind || (!covers && !sisNear))),
      quiet: true,
      act: () => { /* the orders stand: the choice is to stay in it */ },
    });
    // F3: the burn is slower than the armour and the sister is too far. Nothing here gets her out,
    // and the card says that rather than lighting a key that reads as though something does.
    noteNoWayOut(d, stuck);
    return list;
  }

  // ---- 12. sink --------------------------------------------------------------------------------
  // Our own sink saturated, or a few seconds from it: the drive is capped to a quarter, the mounts
  // are quiet, and until now nothing on the band ever said so. Two hulls sat like that, sink-full
  // and drive-capped, for 1 700 s of the reviewers' run, and the fight was decided in the silence.
  function trigSink(sim, ship) {
    const load = ship.thermalLoad ? ship.thermalLoad() : 0;
    if (load < T.sinkHot && !ship.overheated && !ship.weaponsInhibited) return null;
    // A hull locked in her own sink is a question whether or not there is a warship in front of
    // her: requiring one is how the card went unraised in a fight where every hostile was a
    // cripple or out of the plot.
    const foe = nearestWarship(sim, ship, true);
    const stowed = !ship.radiators || ship.radiators.state <= 0.5;
    const id = ship.id;
    return {
      target: foe,
      // The lock jumps every gate the band has: it is the one situation that does not move while
      // nobody answers it.
      urgent: sinkLocked(ship),
      title: (sm, sh) => {
        const me = (sm && sm.byId(id)) || ship;
        return me.overheated ? 'The sink is full.' : 'The sink is at ' + pct(loadOf(me)) + '.';
      },
      text: (ship.overheated
        ? 'A full sink holds the drive to a quarter and stops every mount, point defence included, until it drains. '
        : 'A few more seconds of this and it is full. A full sink holds the drive to a quarter and stops every ' +
          'mount, point defence included, until it drains. ') +
        (stowed ? 'The radiators are still stowed.' : 'The radiators are already out.'),
      until(s) {
        const me = s.byId(id);
        if (!me) return true;
        return (me.thermalLoad ? me.thermalLoad() : 0) < T.sinkClear && !me.overheated;
      },
      build: buildSink,
    };
  }
  function buildSink(sim, d, ship, target) {
    const V = voiceOf(ship, d.third);
    const herObj = foeHer(V, target);
    const stowed = !ship.radiators || ship.radiators.state <= 0.5;
    const rating = ratingOf(ship);
    const gunHeat = Math.max(0, (ship.extraHeat || 0) - (isActive(ship) ? 2e6 : 0));
    const outView = sinkView(ship, true, -gunHeat);
    const cold = sinkView(ship, undefined, -gunHeat);
    const now = sinkView(ship, undefined);
    const sig = signatureOf(ship);
    const A = sig ? sig.total : 0;
    const outSig = sig ? A - sig.radiators + rating : 0;
    // What extending them costs, against a hostile that can still act on it, at the signature the
    // panels would leave us showing.
    const eye = watcher(sim, ship, outSig);
    const list = [];
    // With the panels in, extending them is the whole answer and nothing else comes close. With
    // them already out and the sink still locked, there is no cooling left to find where we are
    // standing: the answer is to stop being where the heat is being made.
    const locked = sinkLocked(ship);
    if (stowed) {
      list.push({
        id: 'extend',
        label: 'Extend the radiators',
        panel: 'out',
        detail: 'sheds ' + power(rating) + ' · ' + sinkPhrase(outView) +
          (eye ? ' · ' + seenWords(eye, 'gets a solution on ' + V.us) : ' · they glow while they work'),
        recommended: true,
        act: (s) => s.setRadiators(ship.id, true),
      });
    } else if (fireModeOf(ship) !== 'hold') {
      list.push({
        id: 'cold',
        label: 'Beams cold until it drains',
        detail: 'the mounts stop making heat · ' + sinkPhrase(cold) + ' · the coilguns and the bays keep firing until it fills, and then nothing fires',
        recommended: !locked,
        act: () => setFireMode(ship, 'hold'),
      });
    }
    list.push({
      id: 'ride',
      label: 'Ride it out',
      detail: 'nothing spent · ' + sinkPhrase(now) + ' · a quarter throttle and every mount quiet while it is full',
      // Riding out a lock is not an answer: the drive is capped, the mounts are inhibited, and
      // nothing in the sim takes the hull out of that state. It stays on the card as a choice the
      // player may make; it is never the one the band points at.
      noRec: locked,
      passive: true,
      quiet: true,
      act: () => { /* the sink is where it is: the choice is to keep fighting through it */ },
    });
    const bo = breakBurn(sim, ship, target);
    const coldIn = heatAtThrottle(ship, 0, -gunHeat);
    const legs = legView(ship, [{ secs: bo.secs, heatIn: heatAtThrottle(ship, 1, -gunHeat), panels: true },
      { secs: 900, heatIn: coldIn, panels: true }]);
    const tail = stepSink(ship, legs.endHeat, rating, coldIn, 7200);
    list.push({
      id: 'breakoff',
      label: 'Break off and cool',
      panel: 'out',
      detail: 'beams cold, radiators extended, ' + time(bo.secs) + ' of burn away from ' + herObj + ', then coasting · ' +
        (tail.tEmpty != null ? 'the sink drains in ' + time(tail.tEmpty) : 'the sink peaks at ' + pct(legs.peak)),
      recommended: locked && !stowed,
      // Breaking out of a lock is not a passive answer, whatever else is going on: a hull flown at
      // a quarter throttle with her mounts inhibited is not pressing anybody.
      passive: !locked,
      act: (s) => {
        setFireMode(ship, 'hold');
        s.setRadiators(ship.id, true);
        startBreak(s, ship, target || null, bo.secs);
      },
    });
    return list;
  }

  // ---- 13. capped ------------------------------------------------------------------------------
  // Her sink has saturated: her drive is capped, her mounts are quiet, and that lasts exactly as
  // long as her panels need. A deep 1v1 ran 1 084 s with nothing on the band while this happened.
  function trigCapped(sim, ship) {
    if (civilian(ship) || ship.disabled) return null;
    const target = designated(sim, ship) || nearestWarship(sim, ship, false);
    if (!target) return null;
    const load = target.thermalLoad ? target.thermalLoad() : 0;
    // Her mounts inhibited is the same news as her sink at the top, and it is the one a live
    // fight actually reaches: a hull that has stopped answering has stopped answering.
    if (load < T.theirSink && !target.overheated && !target.weaponsInhibited) return null;
    const R = trackRange(sim, ship, target).R;
    const b = bites(sim, ship, target);
    const big = Math.max(b.ours, b.theirs);
    if (big > 0 && R > big * 3) return null; // too far out for her trouble to be our opportunity
    const view = sinkView(target, undefined);
    const id = target.id;
    return {
      target,
      title: target.name + ' has stopped answering.',
      text: (sm, sh, third) => {
        const V = voiceOf(sh || ship, third);
        return (V.third ? target.name + '\u2019s' : 'Her') + ' sink is full. A full sink holds the drive to a quarter ' +
          'and stops every mount, point defence included, until it drains' +
          (view.tEmpty != null ? '. That takes ' + time(view.tEmpty) + '.' : '. On this course it does not drain.');
      },
      until(s) {
        const me = s.byId(ship.id), t = s.byId(id);
        if (!me || !t || t.destroyed || t.captured) return true;
        return (t.thermalLoad ? t.thermalLoad() : 0) < T.theirSink * 0.9 && !t.overheated && !t.weaponsInhibited;
      },
      build: buildCapped,
    };
  }
  function buildCapped(sim, d, ship, target) {
    if (!target) return null;
    const V = voiceOf(ship, d.third);
    const she = foeWord(V, target);
    const herOwn = foeOwn(V, target);
    const b = bites(sim, ship, target);
    const plot = trackRange(sim, ship, target);
    const R = plot.R;
    const view = sinkView(target, undefined);
    const beaten = outgunned(sim, ship);
    const to = b.ours > 0 ? Math.round(b.ours * 0.9 / 1e3) * 1e3 : Math.max(5e3, Math.round(R * 0.6));
    return [
      {
        id: 'press',
        label: 'Press her',
        detail: 'close to ' + km(to) + ' from ' + rangeSay(plot) + ' · ' + she + ' cannot manoeuvre out of it at a quarter throttle · ' +
          pct(target.hull) + ' of ' + herOwn + ' hull left',
        recommended: !beaten,
        burns: true,
        act: (s) => {
          s.setTarget(ship.id, target.id);
          ship.weaponsFree = true;
          ship.heldFireForBoarding = false;
          setFireMode(ship, 'full');
          s.setOrder(ship.id, { type: 'keeprange', target: target.id, range: to });
        },
      },
      {
        id: 'hold',
        label: 'Hold the range',
        detail: 'nothing spent · ' + (view.tEmpty != null ? she + ' is quiet for ' + time(view.tEmpty) : she + ' stays quiet on this course') +
          V.say(' · we stay at ' + rangeSay(plot) + ' and keep our track on her',
            ' · ' + V.name + ' stays at ' + rangeSay(plot) + ' and keeps her track on ' + foeHer(V, target)),
        recommended: beaten,
        passive: true,
        quiet: true,
        act: () => { /* the range is kept: the choice is to let her cook */ },
      },
    ];
  }

  // ---- 14. repair ------------------------------------------------------------------------------
  // A part is hit and the parties cannot cover it. There are three shapes of that: more hurt parts
  // worth mending than free hands, so one part waits whichever way it goes; no free hands at all,
  // so the only party that can go is standing a watch; or the part the player most wants back is
  // running, and no party can touch it until the order changes. Anything else the routine settles
  // by itself in fifteen seconds, and a card that asks a question with one answer is wallpaper.
  //
  // The window the card is raised in used to open only when a new part joined the list, and a part
  // is worth a card when its jury-rig buys three tenths — two different moments. Chapter 2's
  // sensor suite crossed the bar at about 1300 s, three hundred seconds after the last new hit, so
  // the chapter that teaches the board never raised a card at all. The window now tracks the parts
  // that are worth asking about, so it opens when one of them crosses the bar.
  // Worth a card at all: a jury-rig has to put three tenths back on the part. The drive and the
  // reactor used to be asked about whatever a mend was worth, and chapter 3 put the headline crew
  // card about a drive at 69.6 % against a 70 % cap — four thousandths of a hull, 313 s of work
  // and the sensor watch at 70 % for it. Rank decides which watch may be pulled, and nothing else.
  // A venting tank is already worth the bar by mendGain's own rule: stopping the vent is the gain.
  function askable(ship, part) {
    if (!part || !part.id) return false;
    if (/^tank/.test(String(part.id)) && part.state !== 'venting') return false;
    return mendGain(part) >= T.mendWorth - 1e-6;
  }
  function freshHit(sim, st, ship, board) {
    const key = mendList(ship, board).filter((p) => askable(ship, p)).map((p) => p.id).sort().join(',');
    const rec = st.hurt[ship.id];
    if (!rec || sim.time < rec.at) { st.hurt[ship.id] = { key, at: key ? sim.time : -1e9 }; return !!key; }
    if (key !== rec.key) {
      const had = rec.key ? rec.key.split(',') : [];
      const gained = key ? key.split(',').some((id) => had.indexOf(id) < 0) : false;
      rec.key = key;
      if (gained) rec.at = sim.time;
    }
    return !!key && sim.time - rec.at <= T.hitWindow;
  }
  // How long this hull lasts at the fire landing on her, and only once armour has actually come
  // off her. A burn-through worked out from one instant's beam reading is not a life expectancy:
  // chapter 7's card said 'JCS Larkspur has 15 s' twice on one card and she took the chapter 57
  // minutes later. hullRate is the measured figure, over a sample at least five seconds old; with
  // nothing landing there is no clock and the card says nothing about one.
  //
  // This is the gate's number, not the player's: it keeps the volley already in the air in it, so
  // 'the mend will not land before she is out of the fight' is decided against the worst of what
  // is coming. What the card prints is armourLife, below, which is measured and nothing else.
  function steadyLife(sim, ship) {
    if (!(hullRate(sim, ship) > 0)) return null;
    return hullLifeSecs(sim, ship);
  }
  // A minute of this hull's armour, sampled every five seconds, kept per engagement. The sample
  // is taken wherever this is called from, and the trigger pass calls it for every hull, so the
  // trail is there before any card needs it.
  function hullTrail(sim, ship) {
    const st = state(sim);
    const hull = ship && ship.hull != null ? ship.hull : 1;
    if (!ship || !ship.id) return null;
    let rec = st.trail[ship.id];
    if (!rec || !rec.s.length || sim.time < rec.s[0].t) rec = st.trail[ship.id] = { s: [{ t: sim.time, hull }] };
    const s = rec.s;
    if (sim.time - s[s.length - 1].t >= T.trailStep) s.push({ t: sim.time, hull });
    // One sample older than the span is kept, and it is the one the reading is taken against: the
    // window is the last minute, not the last minute and whatever else is lying about.
    while (s.length > 2 && sim.time - s[1].t >= T.trailSpan) s.shift();
    const span = sim.time - s[0].t;
    if (span < T.trailSpan) return null;
    const lost = s[0].hull - hull;
    if (!(lost > 0)) return null;
    return { span, lost, rate: lost / span };
  }
  // The clock a card puts in front of the player: how long the armour lasts at the rate it has
  // actually been coming off over the last minute. A hull under a minute of fire has no such
  // reading, and a card with no reading says nothing about one. Chapter 2's card read 'about
  // 3m 52s' at 42 % of her hull — an instant's burn-through sold as a life — and she fought
  // 684 s more and took the chapter at 35 %.
  function armourLife(sim, ship) {
    const seen = hullTrail(sim, ship);
    if (!seen) return null;
    const hull = ship.hull != null ? ship.hull : 1;
    return Math.max(1, hull / seen.rate);
  }
  // The choice the routine cannot make for us, or nothing.
  //
  // The second shape used to be asked only about the three parts the routine gives a watch up for
  // by itself, which on a corvette — two parties, both stationed, and beams that take mounts,
  // panels and the sensor suite — meant the card never came at all: seven chapters, no repair
  // card. It is now asked about any part a jury-rig puts three tenths back on, and the lit key is
  // the real value call: what the mend buys against what the watch costs while the party is away.
  // 'Keep the parties where they are' is a real answer and can be the recommended one, and a card
  // recommending it yields the band to anything more urgent (yielding(), above).
  //
  // The free-hands branch takes the same bar. It used to pass the whole mend list, so six of the
  // nine repair cards a story run raised were three interchangeable dents on a consort's tanks —
  // 'Send party 3 to tank 1 · the plating is sound again in 47 s' against tank 2 and tank 3, all
  // priced the same. The routine is told to leave a sound tank alone; so is the card.
  //
  // `shape` is the card's own shape, fixed when it was raised and passed back on every rebuild:
  // { trade: the part the trade is about, or null for a card raised as a send; why: the board's
  // reason that part could not be worked }. Without it the card flips between the two shapes
  // second by second, because the autopilot pulses the throttle and the drive's `blocked` follows
  // it: key 2 read 'Keep the burn' and settled as 'Send party 1 to the drive'.
  function repairChoice(sim, ship, shape) {
    const board = crewBoard(ship);
    if (!board) return null;
    let all = mendList(ship, board).filter((p) => askable(ship, p));
    if (!all.length) return null;
    const free = partiesOn(board, 'standby');
    const watch = stationed(board);
    const life = steadyLife(sim, ship);
    // Two clocks with two jobs. `life` is the gate's, which keeps the fire already in the air in
    // it; `armour` is the player's, measured over the last minute and printed on the card.
    const armour = armourLife(sim, ship);
    // A card raised about one part stays about that part: the trade is over the drive, or the
    // panels, and the list it is drawn from is reordered to match rather than re-sorted under the
    // player's hand. When the part leaves the list — mended, wrecked, isolated — the card is over.
    if (shape && shape.trade) {
      const kept = all.find((q) => q.id === shape.trade);
      if (!kept) return null;
      all = [kept].concat(all.filter((q) => q !== kept));
    }
    const lead = all[0];
    const leadSecs = mendSecs(ship, lead);
    // A mend the hull will not live to see is the withdraw card's moment, not this one. Chapter 4
    // raised a repair card and a medical card on a corvette with 36 s of armour left, and she was
    // out of the fight twenty seconds later.
    if (life != null && leadSecs != null && leadSecs > life * T.mendStall) return null;
    const why = blockOf(lead);
    const blocked = shape ? (shape.trade ? (why || shape.why || null) : null) : why;
    const open = all.filter((q) => !blockOf(q));
    // The part in hand is running: the drive under throttle, the panels out. No party can touch it
    // and the card is the order, not the party. With a free party and somewhere it can actually
    // work, the question is still which part it takes, and the running one says why it cannot.
    if (blocked && (shape ? !!shape.trade : !(free.length && open.length))) {
      const party = free[0] || watch.find((p) => p.task === watchToPull(sim, ship)) || watch[0] || null;
      if (!party) return null;
      const pays = !!free.length || partRank(lead) <= PULL_RANK ||
        mendGain(lead) * partShare(ship, lead) >= 1 - T.stationFactor - 1e-6;
      return { board, hurt: all, free, watch, worth: pays, lands: true, life, armour, pick: party, blocked, trade: lead };
    }
    if (free.length) {
      if (all.length <= free.length) return null;
      return { board, hurt: all, free, watch, worth: true, lands: true, life, armour, pick: free[0], blocked: null, trade: null };
    }
    if (!watch.length) return null;
    const secs = leadSecs;
    // A mend that lands after the armour is gone is not a repair, whatever it would have bought.
    const lands = life == null || secs == null || secs <= life;
    const worth = lands && (partRank(lead) <= PULL_RANK ||
      mendGain(lead) * partShare(ship, lead) >= 1 - T.stationFactor - 1e-6);
    const pick = watch.find((p) => p.task === watchToPull(sim, ship)) || watch[0];
    return { board, hurt: all, free, watch, worth, lands, life, armour, pick, blocked: null, trade: null };
  }
  // With more hurt parts than free hands, the question is which parts wait. Every free party is
  // placed: the lead part first, then the rest of the value order, and the clause names what is
  // left standing. A card used to place one party of two and price all three options the same,
  // with 'tank 1 waits' under two of them.
  function placement(c, lead) {
    const order = [lead].concat(c.hurt.filter((p) => p !== lead));
    const sent = order.slice(0, c.free.length);
    const waits = order.slice(c.free.length);
    return { sent, waits };
  }
  const waitWords = (ship, waits) => (!waits.length ? ''
    : waits.length === 1 ? partPhrase(waits[0].name, waits[0].id, ship) + ' waits'
      : waits.slice(0, 2).map((p) => partPhrase(p.name, p.id, ship)).join(' and ') +
        (waits.length > 2 ? ' and ' + count(waits.length - 2) + ' more wait' : ' wait'));
  function trigRepair(sim, ship) {
    // A computer-flown hull runs her own routine and her own g mode whatever the bridge answers,
    // so the three crew cards are only ever put about the hull the player is actually flying.
    if (quietHull(ship) || ship.ai) return null;
    const board = crewBoard(ship);
    if (!board) return null;
    if (!freshHit(sim, state(sim), ship, board)) return null;
    const c = repairChoice(sim, ship);
    if (!c) return null;
    const first = c.hurt[0];
    if (state(sim).askedPart[ship.id + '|' + (first ? first.id : '')]) return null;
    // The card's shape, decided here and carried by every rebuild of it: the trade over a part the
    // ship is using, or the send. It is the one thing on the card that must not move while the
    // player is reading, because key 2 means a different act in each shape.
    const shape = { trade: c.trade ? c.trade.id : null, why: c.blocked || null };
    return {
      target: null,
      partId: first ? first.id : null,
      shape,
      // The title is rebuilt every pass along with the body. A party sent to the drive takes the
      // drive out of the question, and a title still reading 'Pull a party off watch for the
      // drive?' over a body about radiator 1 names the wrong part.
      title: (sm, sh) => {
        const me = sm.byId(ship.id) || ship;
        const now = repairChoice(sm, me, shape) || c;
        const head = now.hurt[0];
        if (now.blocked) {
          if (/^drive/.test(String(head.id))) return 'The drive is hit, and she is burning.';
          if (/^rad/.test(String(head.id))) return partCap(head.name, head.id, me) + ' is hit, and the radiators are out.';
          return partCap(head.name, head.id, me) + ' is hit, and it is running.';
        }
        return now.free.length
          ? 'Which part does ' + partyLower(now.free[0].id) + ' take?'
          : 'Pull a party off watch for ' + partPhrase(head.name, head.id, me) + '?';
      },
      text: (sm, sh, third) => {
        const me = sm.byId(ship.id) || ship;
        const V = voiceOf(sh || me, third);
        const now = repairChoice(sm, me, shape) || c;
        const hit = (p) => (V.third ? V.name + '’s ' + partOwned(p.name, p.id, me) : partCap(p.name, p.id, me));
        // The hull's own clock, once per card: the armour she has actually lost over the last
        // minute, and nothing at all under a minute of fire.
        const clock = now.armour != null
          ? ' ' + V.say('Under this fire we have about ' + time(now.armour) + '.',
            'Under this fire ' + V.name + ' has about ' + time(now.armour) + '.') : '';
        if (now.blocked) {
          return hit(now.hurt[0]) + ' is hit, and ' + blockShort(now.hurt[0]) + '.' + clock;
        }
        if (now.free.length) {
          const head = now.hurt.length > 2 ? Count(now.hurt.length) + ' parts are hit'
            : now.hurt.length > 1
              ? hit(now.hurt[0]) + ' and ' + partPhrase(now.hurt[1].name, now.hurt[1].id, me) + ' are both hit'
              : hit(now.hurt[0]) + ' is hit';
          return head + ', and ' + V.say('we have ', V.name + ' has ') + count(now.free.length) +
            (now.free.length === 1 ? ' party free.' : ' parties free.') + clock;
        }
        const where = now.watch.map((p, i) => (i ? partyLower(p.id) : partyWord(p.id)) + ' is ' + taskPhrase(p, me));
        const line = where.length > 1 ? where.slice(0, -1).join(', ') + ' and ' + where[where.length - 1] : where[0];
        return hit(now.hurt[0]) + ' is hit. ' + (line ? line + '.' : 'No party is free.') + clock;
      },
      until(s) {
        const me = s.byId(ship.id);
        if (!me || quietHull(me)) return true;
        // The board can send a party while the card is still on the band, and then the question
        // has been answered by hand: a card still lighting 'Send party 1 to the drive' with party
        // 1 already on it logs a second send. The part has its party; the card is over.
        const b = crewBoard(me);
        const on = first && b ? b.parties.some((q) => q.task === 'repair' && q.part === first.id) : false;
        return on || !repairChoice(s, me, shape);
      },
      build: (sm, dd, sh) => buildRepair(sm, dd, sh, shape),
    };
  }
  // The trade a running part puts to the bridge: the order or the repair. Cutting the drive or
  // stowing the panels is what lets the party start, and the card prices both sides of it. The
  // repair card used to sell the mend, take the watch for it and never say that the ship would
  // refuse to start the work.
  function tradeOptions(sim, d, ship, c) {
    const V = voiceOf(ship, d.third);
    const part = c.trade;
    const secs = mendSecs(ship, part);
    const t = mendTime(secs);
    const p = c.pick;
    const onWatch = p && STATION_WORD[p.task] ? STATION_WORD[p.task] : null;
    const cost = onWatch ? onWatch + ' drops to ' + pct(T.stationFactor) + ' of its rate while she is away' : '';
    const drive = /^drive/.test(String(part.id || ''));
    const gain = buysPhrase(part, ship);
    // Keeping the burn is the pick when the order is the thing that matters — she is going
    // somewhere — or when the fire will have the armour off before the mend lands.
    const going = /^(intercept|approach)$/.test(String((ship.order || {}).type || ''));
    const pressing = going || (c.life != null && secs != null && c.life < secs);
    const list = [];
    if (drive) {
      // Cutting the drive stops whatever the ship was flying, and the key used to say nothing
      // about it: an intercept became a hold and the card read as though only the throttle moved.
      const stop = orderStop(ship.order);
      list.push({
        id: 'cut',
        label: 'Cut the drive for ' + (t || 'the repair'),
        detail: [gain, stop ? V.say('we stop ' + stop + ' and coast', V.name + ' stops ' + stop + ' and coasts') : '', cost]
          .filter((x) => x).join(' · '),
        recommended: !pressing && c.worth,
        act: (s2) => {
          clearDrive(s2, ship, part.id);
          assignParty(s2, ship, p.id, 'repair', part.id);
        },
      });
      list.push({
        id: 'keep',
        label: 'Keep the burn',
        detail: staysWords(part, ship, false) +
          ' · ' + V.say('we hold the order we are flying', V.name + ' holds the order she is flying'),
        recommended: pressing || !c.worth,
        quiet: true,
        act: () => holdPart(ship, part.id),
      });
      return list;
    }
    const to = sinkAfterStow(ship, secs);
    const sink = to != null ? 'the sink fills from ' + pct(loadOf(ship)) + ' to about ' + pct(to) : '';
    list.push({
      id: 'stow',
      label: 'Stow the panels for ' + (t || 'the repair'),
      detail: [gain, sink, cost].filter((x) => x).slice(0, 3).join(' · '),
      recommended: !pressing && c.worth,
      act: (s2) => {
        clearPanels(s2, ship, part.id);
        assignParty(s2, ship, p.id, 'repair', part.id);
      },
    });
    list.push({
      id: 'keep',
      label: 'Keep them out',
      detail: staysWords(part, ship, false) +
        ' · the radiators stay out and the sink holds at ' + pct(loadOf(ship)),
      recommended: pressing || !c.worth,
      quiet: true,
      act: () => holdPart(ship, part.id),
    });
    return list;
  }
  function buildRepair(sim, d, ship, shape) {
    const c = repairChoice(sim, ship, shape || (d && d._shape) || null);
    if (!c) return null;
    if (c.trade) return tradeOptions(sim, d, ship, c);
    const list = [];
    if (c.free.length) {
      // Free hands and more parts than hands: every key places every free party, and the clause
      // names the parts left standing. Two keys that leave the same parts waiting are one answer
      // with two labels, so the second of them is dropped.
      const seen = Object.create(null);
      for (let i = 0; i < c.hurt.length && list.length < 3; i++) {
        const part = c.hurt[i];
        const plan = placement(c, part);
        const tag = plan.waits.map((q) => q.id).sort().join(',');
        if (seen[tag]) continue;
        seen[tag] = 1;
        const rest = plan.sent.slice(1);
        const extra = rest.map((q, k) => partyLower(c.free[k + 1].id) + ' takes ' + partPhrase(q.name, q.id, ship));
        const tail = extra.concat(waitWords(ship, plan.waits)).filter((x) => x).join(', ');
        const held = blockOf(part);
        list.push({
          id: 'send-' + part.id,
          held: !!held,
          label: 'Send ' + partyLower(c.free[0].id) + ' to ' + partPhrase(part.name, part.id, ship),
          // A part that is running takes no time: the work cannot start until the order changes,
          // and a clean repair time for it is a promise the ship will not keep.
          detail: (held ? blockShort(part) : buysClause(part, mendSecs(ship, part), ship)) +
            (tail ? ' · ' + tail : ''),
          recommended: false,
          act: (s2) => assignParty(s2, ship, c.free[0].id, 'repair', part.id),
        });
      }
      if (list.length < 2) return null;
      // The lit key is the first workable one in the value order: never a send into a part the
      // ship will not let a party touch.
      const lit = list.find((o) => !o.held) || list[0];
      lit.recommended = true;
      return list;
    }
    // No free hands: the party has to come off fire control or the sensor watch, and the key says
    // what that costs — and, when the fire landing on us will have the armour off before the job
    // is done, that it cannot land at all. That is the difference between a repair and a promise.
    const part = c.hurt[0];
    const secs = mendSecs(ship, part);
    for (const p of c.watch) {
      if (list.length >= 2) break;
      list.push({
        id: 'pull-' + p.id,
        label: 'Send ' + partyLower(p.id) + ' to ' + partPhrase(part.name, part.id, ship),
        detail: buysClause(part, secs, ship) + ' · ' + (STATION_WORD[p.task] || 'the watch') +
          ' drops to ' + pct(T.stationFactor) + ' of its rate while she is away',
        recommended: p === c.pick && c.worth,
        act: (s) => assignParty(s, ship, p.id, 'repair', part.id),
      });
    }
    list.push({
      id: 'keep',
      label: 'Keep the parties where they are',
      detail: staysWords(part, ship, false) + ' · ' + (list.length > 1
        ? 'both watches stay at ' + pct(1)
        : (STATION_WORD[c.pick ? c.pick.task : ''] || 'the watch') + ' stays at ' + pct(1)),
      recommended: !c.worth,
      quiet: true,
      // The refusal holds: the routine leaves that part alone for the minute the card would have
      // waited, rather than sending a party to it on its next tick.
      act: () => holdPart(ship, part.id),
    });
    return list;
  }

  // ---- 15. burn --------------------------------------------------------------------------------
  // The order wants more acceleration than the people aboard can work at, or more than they can
  // take at all. Both rungs are priced over the same gap with the autopilot's own arrival
  // arithmetic — the target's own motion in it — and against the propellant the ship has left.
  //
  // A bare transfer sold two things it could not deliver. It ignored the hull we are chasing, so
  // chapter 5's soft rung read 'alongside in 27m 02s' against a hull running from us at more than
  // 1.2 g, and taking it three times lost the contact and ran the chapter 1 868 s longer. And it
  // ignored the tanks: a card lit 'Burn at 2.5 g · alongside in 19m 30s' needing 22.2 km/s of a
  // budget of 16.2, and she ran dry after 665 s, 17 558 km short of her.
  function rungFor(sim, ship, target, gap, closing, a) {
    if (!(a > 0) || !(gap > 0)) return null;
    const b = OD.P.brachistochrone(gap, a);
    if (!b || !isFinite(b.time)) return null;
    const flip = OD.Autopilot && typeof OD.Autopilot.flipTimeFor === 'function' ? OD.Autopilot.flipTimeFor(ship) : 0;
    const t = Math.max(0, b.time - (closing || 0) / a) + flip;
    if (!isFinite(t)) return null;
    // What the run spends: the transfer itself, plus killing the speed between the two hulls. The
    // same arithmetic OD.Autopilot.estimate flies an intercept by.
    const rel = target ? U.len(U.sub(ship.vel, target.vel || { x: 0, y: 0 })) : 0;
    const need = Math.max(0, b.dv + rel - Math.max(0, closing || 0) * 0.5);
    const budget = typeof ship.deltaV === 'function' ? ship.deltaV() : 0;
    const dry = budget > 0 && need > budget;
    // How far she gets on what she has: burn to half the budget, then stop again. Past that the
    // arrival is a promise the tanks do not keep.
    const reach = budget > 0 ? (budget * budget) / (4 * a) : 0;
    // A hull burning away from us harder than this rung burns is not caught at this rung, whatever
    // a transfer says. It is what she is actually making that counts, not what her drive could:
    // a coasting hull is caught, and one running at 1.4 g is not caught at 1.2.
    const theirA = target && typeof target.accel === 'function'
      ? target.accel() * U.clamp(target.throttle || 0, 0, 1) : 0;
    const never = (closing || 0) < 0 && theirA >= a - 1e-6;
    return { a, secs: t, dv: need, budget, dry, never, closing: closing || 0,
      short: Math.max(0, gap - reach) };
  }
  // A rung's own clauses: what it spends of the tanks, and when it puts us alongside — or, where
  // no honest arrival can be had, what it does to the range instead.
  const spendWords = (r) => (r && r.budget > 0 ? Math.round(r.dv / 100) / 10 + ' of ' + U.fmt.dv(r.budget) : null);
  function arriveWords(r) {
    if (!r) return null;
    if (r.dry) return 'the tanks run dry ' + km(r.short) + ' short';
    if (r.never) return 'at ' + gs(r.a / G0()) + ' she outruns us, and the range opens at ' + spd(-r.closing);
    return r.secs != null ? 'alongside in ' + time(r.secs) : null;
  }
  const rungWords = (r) => [spendWords(r), arriveWords(r)].filter((x) => x);
  const BURNS = { intercept: 1, approach: 1, keeprange: 1 };
  // A repair the order itself has stopped: a party on the drive with the throttle up, a party on a
  // panel with the radiators out. The board says so in the row's `blocked` field. The card used to
  // read 'a party is assigned' as 'work is running' and promised 'repairs go on' over a job that
  // had not moved in nine minutes.
  function stoppedWork(ship, board) {
    if (!board) return null;
    let out = null;
    for (const p of board.parties) {
      if (p.task !== 'repair' || !p.part) continue;
      const row = board.parts.find((x) => x.id === p.part) || null;
      const why = blockOf(row);
      if (!why) continue;
      const left = p.eta > 0 && isFinite(p.eta) ? p.eta : (row && row.eta > 0 ? row.eta : null);
      const rec = { id: p.part, name: row ? row.name : p.partName, party: p.id, why, left,
        row: row || { id: p.part, name: p.partName, blocked: why, hp: 0 },
        drive: /^drive/.test(String(p.part)) };
      // The drive is the one the order itself is holding shut, so it is the one the card is about.
      if (rec.drive) return rec;
      if (!out) out = rec;
    }
    return out;
  }
  // Work that is actually running: a party on a part the ship is letting her touch. 'Repairs go
  // on' is only true of these.
  function workRunning(board) {
    if (!board) return false;
    return board.parties.some((p) => p.task === 'repair' && p.part &&
      !blockOf(board.parts.find((x) => x.id === p.part)));
  }
  // A hull with anything under its jury-rig cap, or anybody hurt aboard, has work waiting for the
  // moment the burn eases. Chapter 5 is flown at 2.29 g for thirty-three minutes with the parties
  // strapped in the whole way, and the card that prices that was never raised because nothing
  // happened to be under a party's hands at the time.
  function hurtAboard(board) {
    const out = { n: 0, vital: false };
    if (!board) return out;
    for (const r of board.parts) {
      // The same bar the repair card asks by: a 1 % dent on a sound tank is not work waiting on
      // the burn, and the band is not spent on one.
      if (!r || !r.repairable || !askable(null, r)) continue;
      out.n++;
      if (partRank(r) <= PULL_RANK) out.vital = true;
    }
    return out;
  }
  // Everything the card needs, or null when there is no question: the two rungs, what each costs
  // the parties and the crew, and when each of them puts us alongside.
  function burnPlan(sim, ship, target, board) {
    const o = (ship && ship.order) || {};
    if (!board || !target || !BURNS[o.type] || o.target !== target.id) return null;
    const cw = crewT();
    const g = G0();
    const gDrive = driveAccel(ship) / g;
    if (!(gDrive > 0)) return null;
    const repairing = repairRunning(board);
    const working = workRunning(board);
    const stopped = stoppedWork(ship, board);
    // Whether anything is actually shooting at her: beams biting, or slugs and interceptors in the
    // air. A hull under fire is not asked to ease off or stop for work that is waiting — chapter 4
    // put 'Throttle to 0 for 6 min' on a corvette with a third of her armour left and thirty
    // rounds in the air, and she was gone three minutes later.
    const fighting = underFire(sim, ship);
    // The work a hard burn would put down: the longest job running.
    const paused = pausedWork(board);
    // The third situation, and the one that keeps an answer from becoming a trap: the hull is
    // still held to the working limit, the repair that bought that is over, and the order wants
    // more. Without it 'Burn at 1.2 g' is a cap nothing in the game ever takes off again.
    const heldLow = !!(board.crew && board.crew.gMode === 'work');
    // The fourth: a hull with parts under their caps or people hurt aboard has work waiting on the
    // burn easing, whether or not a party is on something this second.
    const waiting = hurtAboard(board);
    const parts = waiting.n;
    const wounded = board.crew && board.crew.wounded > 0 ? board.crew.wounded : 0;
    const hurt = parts > 0 || wounded > 0;
    const lowG = gDrive > cw.couchG + T.burnEdge ? cw.couchG
      : gDrive > cw.workG + T.burnEdge ? cw.workG : null;
    // A repair the order has stopped is a question on its own, whatever the drive can pull: the
    // trade is the throttle against the mend, and it is put where the order is given.
    if (lowG == null && !(stopped && stopped.drive)) return null;
    if (lowG != null && !(gDrive > lowG + T.burnEdge) && !(stopped && stopped.drive)) return null;
    const view = trackRange(sim, ship, target);
    const gap = o.type === 'keeprange' ? Math.abs(view.R - (o.range > 0 ? o.range : 0)) : view.R;
    if (!(gap > 5e3)) return null;
    const closing = closingView(ship, view);
    const rLow = lowG != null ? rungFor(sim, ship, target, gap, closing, lowG * g) : null;
    const rHigh = rungFor(sim, ship, target, gap, closing, gDrive * g);
    const tLow = rLow ? rLow.secs : null;
    const tHigh = rHigh ? rHigh.secs : null;
    if (tHigh == null || (lowG != null && tLow == null)) return null;
    // The working rung is a question when something is waiting on it: a repair running, the hull
    // already held to the limit, a part under its cap or people hurt aboard — or a burn long
    // enough that the parties are in the couches for ten minutes with nothing they can answer.
    const long = tHigh >= T.strapLong;
    // Nothing is waiting on the burn easing and nothing has stopped: the only thing behind the
    // question is the length of the burn itself. That is the rung a hull is asked about once an
    // engagement (open(), above), because the answer does not change while the burn runs.
    const longOnly = lowG === cw.workG && !repairing && !heldLow && !(hurt && !fighting) &&
      !(stopped && stopped.drive) && long && !fighting;
    if (lowG === cw.workG && !repairing && !heldLow && !(hurt && !fighting) && !(long && !fighting) &&
      !(stopped && stopped.drive)) return null;
    // Two rungs are two answers when the arrival differs by three quarters of a minute — or when
    // the hard one stops a repair that is running, which is a cost the arrival does not show. A
    // corvette closing at 1.33 g against a 1.2 g cap gains 28 s and pauses eleven minutes of work
    // on the drive, and that was never a question at all.
    const worthRungs = tLow != null && tLow - tHigh >= T.burnWorth;
    const putsDown = working && paused && gDrive > cw.workG + T.burnEdge;
    if (!worthRungs && !putsDown && !(stopped && stopped.drive)) return null;
    const fit = board.crew && board.crew.fit > 0 ? board.crew.fit : 0;
    const rate = Math.max(1, Math.round(60 * cw.hurtRate * Math.max(0, gDrive - cw.couchG) * fit));
    return {
      cw, gDrive, lowG, repairing, working, stopped, heldLow, view, gap, tLow, tHigh, rLow, rHigh, paused,
      parts, wounded, hurt, fit, vital: waiting.vital, long, longOnly, fighting,
      lowMode: lowG === cw.workG ? 'work' : 'couches',
      highMode: gDrive > cw.couchG + T.burnEdge ? 'max' : 'couches',
      hurtRate: rate,
      // The whole cost of the hard rung, capped at the people aboard. A per-minute rate against a
      // whole arrival hid a wipe-out: '4 wounded a minute at 5.1 g · alongside in 13m 06s' is four
      // times thirteen, which is fifty-two of a crew of twenty-four.
      hurtTotal: Math.min(fit, Math.round(rate * Math.max(1, tHigh / 60))),
    };
  }
  // What the hard rung costs the people, in one clause. The rate stays only while the whole cost
  // of the burn stays under the crew.
  function hurtWords(p, V) {
    // 'every one of the 24 aboard hurt before we are alongside' put 'alongside' on a key that
    // ended with 'alongside in 13m 06s', and said it again in the clause between them.
    if (p.hurtTotal >= p.fit && p.fit > 0) return 'all ' + p.fit + ' aboard wounded on the way';
    if (p.hurtTotal > p.hurtRate) return p.hurtTotal + ' of the ' + p.fit + ' aboard wounded on the way';
    return p.hurtRate + ' wounded a minute at ' + gs(p.gDrive);
  }
  function trigBurn(sim, ship) {
    if (quietHull(ship) || civilian(ship) || ship.ai) return null;
    const board = crewBoard(ship);
    if (!board || !OD.Crew || typeof OD.Crew.setG !== 'function') return null;
    const o = ship.order || {};
    if (!BURNS[o.type] || !o.target) return null;
    const target = sim.byId(o.target);
    if (!target || quietHull(target)) return null;
    const plan = burnPlan(sim, ship, target, board);
    if (!plan) return null;
    const id = target.id;
    return {
      target,
      // The card raised on the length of the burn alone, and nothing else: asked once a hull an
      // engagement, and logged after that.
      longRung: plan.longOnly ? { secs: plan.tHigh, g: plan.gDrive, limit: plan.cw.workG } : null,
      title: (sm) => {
        const me = sm.byId(ship.id) || ship;
        const t = sm.byId(id) || target;
        const p = burnPlan(sm, me, t, crewBoard(me));
        return p && p.stopped && p.stopped.drive ? 'The order has stopped the repair.' : 'Pick the burn.';
      },
      text: (sm, sh, third) => {
        const me = sm.byId(ship.id) || ship;
        const t = sm.byId(id) || target;
        const V = voiceOf(sh || me, third);
        const p = burnPlan(sm, me, t, crewBoard(me));
        if (!p) return V.say('The order is set.', V.name + '’s order is set.');
        if (p.stopped && p.stopped.drive) {
          return partyWord(p.stopped.party) + ' is on ' + partPhrase(p.stopped.name, p.stopped.id, me) +
            ', and ' + blockShort(p.stopped.row) + '. ' +
            V.say('The order on ', V.name + '’s order on ') + foeHer(V, t) + ' has the drive lit at ' +
            gs(p.gDrive) + '.';
        }
        const head = V.say('The burn on ', V.name + '’s burn on ') + foeHer(V, t) + ' wants ' + gs(p.gDrive) + '. ';
        if (p.lowMode !== 'work') return head + 'Above ' + gs(p.cw.couchG) + ' the burn starts hurting the crew.';
        if (p.working) return head + 'Above ' + gs(p.cw.workG) + ' the parties strap in and the repair stops where it is.';
        if (p.parts > 0) {
          return head + 'Above ' + gs(p.cw.workG) + ' the parties strap in, and ' + count(p.parts) +
            (p.parts === 1 ? ' part is still hit.' : ' parts are still hit.');
        }
        if (p.wounded > 0) {
          return head + 'Above ' + gs(p.cw.workG) + ' the parties strap in, and ' + p.wounded +
            ' aboard are still wounded.';
        }
        if (p.long) {
          // Nothing aboard is under its cap and nobody is wounded, so 'nothing can be repaired for
          // any of it' is a cost that does not exist: chapter 5 printed it for thirty-three
          // minutes on a hull whose first damage landed at 2 465 s. What the burn costs here is
          // the propellant and the couches.
          const runs = p.rHigh && !p.rHigh.never && !p.rHigh.dry
            ? 'It runs ' + time(p.tHigh) + ' above ' + gs(p.cw.workG) + '. '
            : 'It holds above ' + gs(p.cw.workG) + ' the whole way. ';
          return head + runs + 'Nothing aboard needs a party. What the burn costs is propellant.';
        }
        return head + 'Nothing is under repair, and the crew is still held to ' + gs(p.cw.workG) + '.';
      },
      until(s) {
        const me = s.byId(ship.id), t = s.byId(id);
        if (!me || !t || quietHull(me) || quietHull(t)) return true;
        return !burnPlan(s, me, t, crewBoard(me));
      },
      build: buildBurn,
    };
  }
  // The trade an order puts to the bridge when it is the order that has stopped the work: cut the
  // drive and the party starts, ease to the working limit if that is all that is in the way, or
  // press on and the job stays where it is. The same trade the repair card puts before a party is
  // sent, raised again at the moment the order takes it away.
  function stoppedOptions(sim, d, ship, target, p) {
    const V = voiceOf(ship, d.third);
    const w = p.stopped;
    const secs = w.left != null ? w.left : (w.row ? mendSecs(ship, w.row) : null);
    const t = mendTime(secs);
    const gain = w.row ? buysPhrase(w.row, ship) : partPhrase(w.name, w.id, ship) + ' back in service';
    // Coasting is the answer only when she is not in the fight and the job is shorter than the run
    // in: a corvette with slugs in the air or a hostile in reach is not asked to stop, and a
    // ten-minute job on a four-minute approach is not worth the approach. With a fight to press
    // the throttle rung is passive, so the card will not light it whatever the mend is worth.
    const cut = !p.fighting && secs != null && p.tHigh != null && secs <= p.tHigh;
    const list = [];
    if (p.lowG != null && p.lowG === p.cw.workG && p.tLow != null) {
      list.push({
        id: 'low',
        label: 'Ease to ' + gs(p.lowG),
        detail: 'the parties are out of the couches, and ' + partPhrase(w.name, w.id, ship) + ' still cannot be worked' +
          (arriveWords(p.rLow) ? ' · ' + arriveWords(p.rLow) : ''),
        act: () => setGMode(ship, 'work'),
      });
    }
    list.push({
      id: 'cut',
      label: 'Throttle to 0 for ' + (t || 'the repair'),
      detail: gain + ' · ' + V.say('we coast while the party works', V.name + ' coasts while the party works'),
      recommended: cut,
      // Stopping the ship is the answer that steps out of the fight, so it is the passive one:
      // with a fight to press the card will not light it whatever the mend is worth.
      passive: true,
      act: (s) => clearDrive(s, ship, w.id),
    });
    list.push({
      id: 'press',
      label: 'Press on',
      // The order stands, so the party cannot start: she comes off the part and back on watch
      // rather than standing by a drive that will be lit for the rest of the run. The key says so,
      // because the watch coming back is what the answer buys.
      detail: staysWords(w.row || { name: w.name, id: w.id, hp: 0 }, ship, false) + ' · ' +
        partyLower(w.party) + ' comes off ' + partPhrase(w.name, w.id, ship) +
        (arriveWords(p.rHigh) ? ' · ' + arriveWords(p.rHigh) : ''),
      recommended: !cut,
      act: (s) => { releaseWaiting(s, ship, w.id); },
    });
    return list;
  }
  function buildBurn(sim, d, ship, target) {
    const V = voiceOf(ship, d.third);
    const p = burnPlan(sim, ship, target, crewBoard(ship));
    if (!p) return null;
    if (p.stopped && p.stopped.drive) return stoppedOptions(sim, d, ship, target, p);
    if (p.lowG == null || p.tLow == null) return null;
    const cls = classOf(ship);
    const doctrine = cls && cls.doctrine && cls.doctrine.range > 0 ? cls.doctrine.range : 200e3;
    // Nothing hostile in the sim: the burn is about the plot, not about a fight.
    const quiet = !sim.hostiles(ship).some((h) => !h.destroyed && !h.captured);
    // A hull on a falling ellipse has a clock of its own. The story puts when it ends in
    // sim.flags.impactT, so the key can price what holding here costs without guessing at it.
    const fall = quiet && sim.flags && sim.flags.impactT > sim.time ? sim.flags.impactT - sim.time : null;
    // The routine's own rule for a hull it is flying: work while a repair runs and the fight is
    // still a long way off, couches once it is not. And a burn that wounds the crew is only worth
    // it when the clock is the mission.
    let lit = 'high';
    if (p.working && p.lowMode === 'work' && p.view.R > 1.5 * doctrine) lit = 'low';
    if (p.highMode === 'max' && !timeMatters(sim, ship, target)) lit = 'low';
    // The lit rung comes from what the rungs buy, not from the range alone. A card lit the hard
    // rung at eight seconds saved against five and a half minutes of work on the sensor suite —
    // the one card built to teach crew under acceleration, teaching the wrong lesson.
    if (p.working && p.paused && p.gDrive > p.cw.workG + T.burnEdge && p.tLow - p.tHigh < T.burnWorth) lit = 'low';
    // The drive, the reactor or a venting tank waiting on the burn easing is worth the slower
    // arrival while the fight is still a long way off.
    // — as long as the clock is not the mission. A convoy being shot at while we ease off to 1.2 g
    // for a part that is waiting is the trade backwards.
    if (p.vital && !p.working && p.lowMode === 'work' && p.view.R > 1.5 * doctrine &&
      !timeMatters(sim, ship, target)) lit = 'low';
    // A rung the tanks cannot pay for is not a rung: chapter 4 lit 'Burn at 2.5 g · alongside in
    // 19m 30s' on 16.2 km/s of a 22.2 km/s run, and she ran dry 17 558 km short.
    if (lit === 'high' && p.rHigh && p.rHigh.dry && !(p.rLow && p.rLow.dry)) lit = 'low';
    if (lit === 'low' && p.rLow && p.rLow.dry && !(p.rHigh && p.rHigh.dry)) lit = 'high';
    // What the hard rung actually costs. A burn over the working limit straps the parties in and
    // the job they are on stops where it is, so the cost is that job, named and timed; over the
    // couch limit it is people. With nothing under a cap and nobody wounded there is no crew cost
    // to print at all — the couches cost the ship nothing when there is nothing to mend — and what
    // the rung costs is the propellant.
    const crewCost = p.working || p.repairing || p.hurt;
    const high = [];
    if (crewCost && p.working && p.gDrive > p.cw.workG) {
      high.push(p.paused
        ? 'the repair on ' + partPhrase(p.paused.name, p.paused.id, ship) + ' holds where it is for ' +
          (mendTime(p.paused.left) || time(p.paused.left))
        : 'repairs pause until the burn ends');
    } else if (crewCost && p.gDrive > p.cw.workG && p.parts > 0) {
      high.push('no party can work ' + (p.parts === 1 ? 'the part that is hit' : 'the ' + count(p.parts) + ' parts that are hit') + ' while she burns');
    }
    if (p.highMode === 'max') high.push(hurtWords(p, V));
    else if (crewCost && !p.working && !high.length) high.push('the crew straps into the couches, nobody is hurt');
    // A burn long enough that the couches hold the parties for ten minutes costs the answer to
    // anything that lands on the way. It is said after what the burn costs, not instead of it.
    if (crewCost && p.long && p.gDrive > p.cw.workG && high.length < 2) high.push('nobody left to answer a hit');
    // Three clauses is what a key holds, and two of them are the rung's own: what it spends and
    // when it puts us alongside. The arrival is never the one that falls off the end.
    const tail = rungWords(p.rHigh);
    const cost = high.slice(0, Math.max(1, 3 - tail.length));
    return [
      {
        id: 'low',
        label: 'Burn at ' + gs(p.lowG),
        // Both rungs print the whole arrival. One of them used to print the difference against
        // the other — 'alongside 1m 20s later' beside 'alongside in 5m 02s' — so the slow rung
        // read as the fast one and a newcomer comparing the two numbers picked backwards.
        detail: [crewCost ? (p.lowMode !== 'work' ? 'the crew is strapped in and nobody is hurt'
          : p.working ? 'repairs go on'
            : p.parts > 0 ? 'the parties can work the ' + (p.parts === 1 ? 'part that is hit' : count(p.parts) + ' parts that are hit')
              : 'the crew can work through the burn') : '']
          .concat(rungWords(p.rLow)).filter((x) => x).join(' · '),
        // A rung the tanks cannot pay for is never the pick, whatever it would have bought.
        noRec: !!(p.rLow && p.rLow.dry),
        never: !!(p.rLow && p.rLow.dry),
        recommended: lit === 'low',
        act: () => setGMode(ship, p.lowMode),
      },
      {
        id: 'high',
        label: 'Burn at ' + gs(p.gDrive),
        detail: cost.concat(tail).join(' · '),
        noRec: !!(p.rHigh && p.rHigh.dry),
        never: !!(p.rHigh && p.rHigh.dry),
        recommended: lit === 'high',
        act: () => setGMode(ship, p.highMode),
      },
      {
        id: 'hold',
        // Chapter 1 has nothing hostile in the sim: the burn there is a race against a falling
        // ellipse, not a fight, and 'Hold and fight at this range' offered a fight to nobody.
        // What holding costs is then the clock — the tanker's fall, or the arrival given up.
        // The parties clause is printed only when a party is actually working.
        label: quiet ? 'Hold this range' : 'Hold and fight at this range',
        detail: (p.working ? 'no burn, and the parties keep working' : 'no burn') + ' · ' +
          V.say('we hold at ', V.name + ' holds at ') + rangeSay(p.view) +
          (quiet && fall != null ? ' · ' + target.name + ' comes down in ' + time(fall) : '') +
          (quiet && fall == null && p.tHigh != null
            ? ' · ' + V.say('the burn has us alongside in ', 'the burn has her alongside in ') + time(p.tHigh)
            : ''),
        passive: true,
        burns: true,
        act: (s) => {
          setGMode(ship, 'work');
          s.setTarget(ship.id, target.id);
          s.setOrder(ship.id, { type: 'keeprange', target: target.id, range: Math.max(1e3, Math.round(p.view.R)) });
        },
      },
    ];
  }

  // ---- 16. medical -----------------------------------------------------------------------------
  // Wounded past a tenth of the crew and nobody in the sick bay: with the parties where they are,
  // nobody comes back for the rest of the fight.
  function medicalChoice(sim, ship) {
    const board = crewBoard(ship);
    if (!board) return null;
    const c = board.crew;
    const total = c.total > 0 ? c.total : 0;
    if (!(total > 0) || !(c.wounded > 0)) return null;
    if (c.wounded / total <= T.woundedShare) return null;
    if (partiesOn(board, 'medical').length) return null;
    // A sick bay that cannot bring one back before the armour is gone is not a question either:
    // chapter 4 put this card on a corvette sixteen seconds before she was out of the fight. One
    // wounded comes back every 45 s, so the job in hand is 45 s times the wounded.
    const life = steadyLife(sim, ship);
    if (life != null && crewT().medic * c.wounded > life * T.mendStall) return null;
    const free = partiesOn(board, 'standby');
    const watch = stationed(board);
    if (!free.length && !watch.length) return null; // every party is on a part: no hands to move
    return { board, crew: c, total, free, watch };
  }
  function trigMedical(sim, ship) {
    if (quietHull(ship) || ship.ai) return null;
    const c = medicalChoice(sim, ship);
    if (!c) return null;
    return {
      target: null,
      title: 'Put a party in the sick bay?',
      text: (sm, sh, third) => {
        const me = sm.byId(ship.id) || ship;
        const V = voiceOf(sh || me, third);
        const k = (medicalChoice(sm, me) || c).crew;
        return k.wounded + ' of ' + (V.third ? V.name + '\u2019s ' : 'the ') + k.total + ' aboard ' +
          (k.wounded === 1 ? 'is' : 'are') + ' wounded, and nobody is in the sick bay.';
      },
      until(s) {
        const me = s.byId(ship.id);
        return !me || quietHull(me) || !medicalChoice(s, me);
      },
      build: buildMedical,
    };
  }
  function buildMedical(sim, d, ship) {
    const c = medicalChoice(sim, ship);
    if (!c) return null;
    const cw = crewT();
    const k = c.crew;
    const back = 'one wounded back to fit every ' + time(cw.medic);
    // Under a third fit, fire control and the sensor watch are already at 70 % whatever the
    // parties do, so putting a party in the sick bay is the only thing that takes that penalty off
    // again. Above the floor the wounded cost the fight nothing a watch at 70 % does not cost
    // more, and the lit key leaves the parties where they are.
    const thin = k.fit / c.total < T.medicalFloor;
    const list = [];
    if (c.free.length) {
      const p = c.free[0];
      list.push({
        id: 'medic',
        label: 'Send ' + partyLower(p.id) + ' to the sick bay',
        detail: back + ' \u00b7 ' + partyLower(p.id) + ' comes off standby',
        recommended: true,
        act: (s) => assignParty(s, ship, p.id, 'medical', null),
      });
    } else {
      const pick = c.watch.find((p) => p.task === watchToPull(sim, ship)) || c.watch[0];
      for (const p of c.watch) {
        if (list.length >= 2) break;
        list.push({
          id: 'medic-' + p.id,
          label: 'Send ' + partyLower(p.id) + ' from ' + (STATION_WORD[p.task] || 'watch') + ' to the sick bay',
          detail: back + ' \u00b7 ' + (STATION_WORD[p.task] || 'the watch') + ' drops to ' +
            pct(T.stationFactor) + ' of its rate while she is away',
          recommended: p === pick && thin,
          act: (s) => assignParty(s, ship, p.id, 'medical', null),
        });
      }
    }
    list.push({
      id: 'later',
      label: 'Leave the wounded until the fight is over',
      detail: 'nobody comes back while the parties are where they are \u00b7 ' + k.fit + ' of ' + c.total +
        ' still fit' + (thin ? ' \u00b7 under a third fit, so fire control and the sensor watch both run at ' +
          pct(T.stationFactor) : ''),
      recommended: !c.free.length && !thin,
      quiet: true,
      act: () => { /* the parties stay where they are */ },
    });
    return list;
  }

  const TRIGGERS = {
    approach: trigApproach, sensors: trigSensors, radiators: trigRadiators, range: trigRange,
    salvo: trigSalvo, cripple: trigCripple, slugs: trigSlugs, heat: trigHeat,
    defend: trigDefend, aim: trigAim, withdraw: trigWithdraw, sink: trigSink, capped: trigCapped,
    repair: trigRepair, burn: trigBurn, medical: trigMedical,
  };

  // ---- what the bridge reads -------------------------------------------------------------------
  // The newest open decision for the ship under the player's hand, else the newest open one. A card
  // that speaks for a division belongs to every hull in it.
  function current(sim) {
    if (!sim || !Array.isArray(sim.decisions) || !sim.decisions.length) return null;
    // A crew card the player has pushed aside with Esc is still open — the parties are still where
    // they were and the routine is still held — but it is not on the band any more.
    const live = sim.decisions.filter((d) => !d.deferred);
    if (!live.length) return null;
    const sel = selectedId();
    if (sel) for (let i = live.length - 1; i >= 0; i--) if (speaksFor(live[i], sel)) return live[i];
    return live[live.length - 1];
  }
  function choose(sim, id, key) {
    if (!sim) return false;
    const d = find(sim, id);
    if (!d) return false;
    const o = (d.options || []).find((x) => x.key === key);
    if (!o) return false;
    d._chose = o.id || null;
    if (sim._decisions) sim._decisions.said = [];
    try { if (typeof o.act === 'function') o.act(sim); } catch (e) { /* the bridge does what it can */ }
    if (o.panel) notePanel(sim, d, o.panel);
    // An answer that changes nothing — hold, wait, leave the bays shut — is not a line in the log.
    if (!o.quiet && typeof sim.addLog === 'function') sim.addLog('Decision: ' + d.title + ' → ' + o.label, 'Bridge', 'good');
    flushSaid(sim);
    close(sim, d, true);
    return true;
  }
  function dismiss(sim, id) {
    if (!sim) return false;
    const d = find(sim, id);
    if (!d) return false;
    // Esc on a repair or medical card is not an answer, and it is not a refusal either. It used to
    // close the card, which handed the routine straight back: the parties were moved fifteen
    // seconds later and the question never came again. The card leaves the band, the routine stays
    // held, and the ship settles it at the deadline the band was counting down to — never before.
    // A burn card counts here as well: its band button reads 'Let the crew decide' and the line
    // under it counts down to the settle, so closing it on Esc would break that promise.
    if (SETTLES[d.kind]) {
      if (d.deferred) return true;
      d.deferred = true;
      d.deferredAt = sim.time;
      if (d.deadline == null) d.deadline = sim.time + T.autoAssign;
      sim.decisionSeq++;
      return true;
    }
    close(sim, d, false);
    return true;
  }
  // What this build found of the interfaces the other modules are growing: the check script reads
  // it so an expectation that needs one of them can say 'not in yet' instead of failing.
  function capabilities(sim) {
    const ship = sim && Array.isArray(sim.ships) ? sim.ships[0] : null;
    return {
      approachOrder: approachOrder(),
      sinkForecast: hasForecast(),
      board: !!(OD.Sim && OD.Sim.BOARD),
      radiatorRating: !!(ship && typeof ship.radiatorRating === 'function'),
      crew: !!(OD.Crew && typeof OD.Crew.board === 'function'),
      juryRig: !!(OD.Damage && typeof OD.Damage.repairTime === 'function' && typeof OD.Damage.mend === 'function'),
    };
  }

  // ---- what the board's held row asks for (v13, D 25) ------------------------------------------
  // The row the board will not send a party to carries a button, and the button runs the trade the
  // card would run: the drive cut, or the panels stowed, and then the party. ui.js asks what the
  // trade is called, and then asks for it to be made, so the board and the card do one thing.
  function tradeWords(ship, partId) {
    const board = crewBoard(ship);
    const row = board ? board.parts.find((p) => p.id === partId) : null;
    if (!row || !blockOf(row)) return null;
    if (/^drive/.test(String(partId))) return 'Cut the drive';
    if (/^rad/.test(String(partId))) return 'Stow the panels';
    return null;
  }
  function clearAndSend(sim, ship, partId, partyId) {
    if (!sim || !ship || !partId || !tradeWords(ship, partId)) return false;
    if (/^drive/.test(String(partId))) clearDrive(sim, ship, partId);
    else clearPanels(sim, ship, partId);
    if (partyId) assignParty(sim, ship, partyId, 'repair', partId);
    // No Decision line to sit under: the board's own sentences go to the log as they are made.
    flushSaid(sim);
    return true;
  }

  OD.Decisions = {
    init, update, current, refresh, choose, dismiss, capabilities, finish,
    // The board's held row and the trade card run the same act (D 25).
    tradeWords, clearAndSend,
    // The three kinds the ship's own routine settles for the player. The band's Esc button reads
    // 'Let the crew decide' on these and 'Later' on the rest, and each card carries the same fact
    // as `crew`.
    CREW_KINDS: SETTLES,
    get kinds() { return KINDS.map((k) => ({ kind: k, teach: teachOf(k) })); },
    T,
  };
})();
