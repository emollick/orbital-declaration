/* Orbital Declaration — sensors and signature (OD.Sensors). There is no stealth in space: every hull radiates,
   and a sensor resolves a source by its power over range squared, so a source of power P is worth a firing
   solution out to R_sol = S·√(P / 1 MW) for a sensor of sensitivity S. What a hull is worth to fire control is
   the quality q of the track on it: 1 a bare contact, 1.8 a track, 2.7 a solution, 3 pinned. A passive track is
   not lost the moment the source dims: the plot carries it on by dead reckoning and lets q fall at T.decay a minute.
   Tracks belong to a faction, not to a ship: whatever one hull resolves, the squadron shares.
   The uncertainty is not a circle. A passive ear reads a bearing well and a range badly, so a track carries
   `bearingErr` (rad, a fraction of a degree on a fresh contact), `rangeErr` (m, most of the old posErr) and
   `los`, the line of sight from the ear that holds her; `posErr` stays the larger of the two so old callers
   still read one number. The ghost is displaced mostly along that line and only a little across it, and that
   displacement wanders rather than being drawn once: every watcher wanders at the same rates and by the same
   fraction of the box, and only the phases are drawn, fresh every T.ghostDrift seconds and blended into the
   draw before them. What a seed is worth therefore decays over that time constant, so neither side of an even
   pair keeps a smaller error than the other and the expected error is the same read from either end. While the
   plot is reckoning a fading track forward the box grows by velErr·t + ½·a_max·t², a_max being the best that
   hull's class can do, until it is capped at T.errCap of the range.

   Two rules keep the panel, the map caption and track() from contradicting one another in the same frame.

   1. `seenFrom` answers "from how far can they solve me?", which is the question track() answers from the other
   side, so it is solved the same way. A track's q is the range term plus the dwell bonus the watcher has
   already earned (T.dwellBonus · min(1, dwell / T.dwellTime)), so the range is solved for what is left for the
   range term to carry: R = rangeForQ(S·√P, T.solutionQ − bonus), and the bonus is read off that watcher's own
   live track record on this hull rather than assumed to be zero. A hostile that has held us for five minutes
   reads us as a solution from farther out than one that has just found us, and the map caption, the Signature
   line and the radiators card all quote the range at which her track() would say 'solution'. Her own lit radar
   still pins us anywhere inside her activeRange, whatever we are showing; our own lit radar is an announcement
   rather than a range, and the signature word ('active') is what says so. Those ranges answer 'from where is
   what I am showing solvable', so a hostile carrying an old solution forward by dead reckoning can hold one
   from beyond them: `held` (and `heldBy`) is that range, who has us right now and from how far, which is the
   honest number for a PINNED tag.

   2. The error box is carried, not recomputed from scratch. A live reading gives a fix; while she is dark the
   plot reckons that fix forward and the box grows, capped at T.errCap of the range. The clock on the reckoning
   (tr.fade) is reset only by a fresh fix — a live reading at least as good as the box being carried — and a
   reading at the floor (q 1, beyond R_far: the bearing the plot already had, not news) is no reading at all,
   nor is the box touching the cap. So the clock keeps running for as long as she stays dark and the box never
   shrinks while she does: four minutes hidden is never better localised than three. The box is also never
   smaller than the quality the plot is reporting would give on its own, so the q and the ± in the panel agree. */
(function () {
  'use strict';
  const OD = window.OD;
  const U = OD.U;

  const T = {
    plumeFraction: 0.02,   // of the jet power that reads as a plume
    hullLeak: 0.5,         // of the idle heat that leaks through the hull: the signature floor
    activeHeat: 2e6,       // W into the sink while the active sensor is on
    dwellBonus: 0.5,       // q earned for holding a track
    dwellTime: 600,        // s of dwell that earns all of it
    decay: 0.6,            // q the carried passive picture may lose per 60 s once the source dims
    solutionQ: 2.7,
    trackQ: 1.8,
    ghostDrift: 240,       // s for a ghost offset to work once round its circle, and the time constant a draw decays over
    ghostScale: 0.6,       // of posErr: the ghost wanders inside the uncertainty ring, never outside it
    crossFraction: 0.04,   // of the range error: what the same fix is worth across the line of sight
    errCap: 0.6,           // of the range: a reckoned box never grows past this, however long she stays dark
    fixFloor: 0.02,        // q above 1 a reading must reach to count as a fix: at the floor it is only the old line
    farFactor: 4,          // R_far = 4 · R_sol: beyond it a source is nothing but a bearing
    refresh: 1,            // s between the pairwise passes; dwell and the ghosts move every substep
    logGap: 60,            // s between log lines about one track, so a wobbling q cannot spam
    hysteresis: 0.3,       // q a track gives up before a line says it slipped: a solution holds to 2.4
  };

  const REF = 1e6;                                   // the 1 MW in R_sol = S·√(P / 1 MW)
  const LN_FAR = Math.log(T.farFactor);
  // q_range = 1 + 2·ln(R_far/R)/ln(R_far/R_sol), so a word's range is R_sol · 4^(1 − (q−1)/2).
  const rangeForQ = (sol, q) => sol * Math.pow(T.farFactor, 1 - (q - 1) / 2);

  // ---- signature ------------------------------------------------------------------------------
  function plumePower(ship) {
    const th = ship.throttle || 0;
    if (th <= 0 || !(ship.thrust > 0)) return 0;
    return 0.5 * ship.thrust * ship.exhaustVelocity * th * T.plumeFraction;
  }
  // What the panels shed right now, which is what there is to see. ship.radiatorPower() already follows the
  // sink: a panel is only as hot as the heat behind it, so an empty sink leaves it at 290 K and a fraction of a
  // per cent of its rating, and a sink at its ceiling has it glowing at the rating. No clamp is needed — a hull
  // that has coasted for a while sits at the load where the panels shed exactly what the reactor makes.
  function radPower(ship) {
    const p = typeof ship.radiatorPower === 'function' ? ship.radiatorPower() : 0;
    return p > 0 ? p : 0;
  }
  function hullPower(ship) { return (ship.idleHeat || 0) * T.hullLeak; }
  // The total alone, for the hot loop: no object made.
  function power(ship) { return plumePower(ship) + radPower(ship) + hullPower(ship); }

  function wordFor(plume, rad, hull, active) {
    if (plume > hull) return 'burning';
    if (active) return 'active';
    if (rad > hull * 4) return 'radiating';
    if (plume + rad > hull) return 'warm';
    return 'cold';
  }
  function signature(ship) {
    if (!ship) return { total: 0, plume: 0, radiators: 0, hull: 0, active: false, word: 'cold' };
    const plume = plumePower(ship), radiators = radPower(ship), hull = hullPower(ship);
    const active = !!ship.activeSensor;
    return { total: plume + radiators + hull, plume, radiators, hull, active, word: wordFor(plume, radiators, hull, active) };
  }

  // ---- sensitivity and quality ----------------------------------------------------------------
  function sensorS(ship) {
    if (!ship || ship.destroyed) return 0;
    const sys = ship.systems ? ship.systems.sensors : 1;
    return Math.max(0, (ship.sensorRange || 0) * (sys != null ? sys : 1));
  }
  function qRange(S, P, R) {
    if (!(S > 0)) return 1;
    const sol = S * Math.sqrt(Math.max(P, 1) / REF);
    if (!(sol > 0)) return 1;
    if (R <= sol) return 3;
    const far = sol * T.farFactor;
    if (R >= far) return 1;
    return 1 + 2 * (Math.log(far / R) / LN_FAR);
  }

  // ---- per-faction track tables ---------------------------------------------------------------
  function ensure(sim) {
    let st = sim.sensors;
    if (!st) st = sim.sensors = { factions: Object.create(null), probes: Object.create(null), list: [], t: -1e9, sweep: -1e9 };
    return st;
  }
  function tableFor(st, faction) { return st.factions[faction] || (st.factions[faction] = Object.create(null)); }
  // A standing stand-in for "a hull of this faction", so sim.isHostile can be asked without making one.
  function probeFor(st, faction) { return st.probes[faction] || (st.probes[faction] = { faction }); }

  function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

  // ---- the wandering error ---------------------------------------------------------------------
  // The ghost's offset used to be one draw per (faction, target): fixed phases, fixed rates and a fixed size,
  // held for the whole engagement. That hands one side of an even pair a permanently smaller error, so that
  // side plots first, fires first, and an even fight snowballs. Now every watcher wanders the same way — the
  // same rates off T.ghostDrift, the same T.ghostScale of the box — and only the phases are drawn. A fresh set
  // is drawn every T.ghostDrift seconds, from the track's seed and the step number, and blended into the set
  // before it, so what a seed is worth decays over that time constant: no side keeps an advantage, and the
  // expected error is the same from both ends. The blend is smootherstep, flat in slope at both ends, so the
  // ghost has no kink where one draw hands over to the next and never moves faster than the wander itself.
  // Nothing is carried between frames: the offset is a function of the track's seed and the clock, so asking
  // twice in one frame — which fresh() does — cannot walk the ghost forward.
  function draw(seed, step, salt) {
    let h = Math.imul(seed ^ Math.imul(step, 0x9e3779b1), 0x85ebca6b);
    h ^= h >>> 13; h = Math.imul(h ^ salt, 0xc2b2ae35); h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  const smoother = (f) => f * f * f * (f * (f * 6 - 15) + 10);   // C²: no kink and no step in speed at a handover
  // The offset in units of the box, for one draw: two turns along the line of sight, one across it and one on
  // the velocity. The rates are shared by every track; only the phases come off the draw.
  function ghostDraw(seed, step, t) {
    const w = U.TAU / T.ghostDrift;
    const a1 = draw(seed, step, 1) * U.TAU + w * t, a2 = draw(seed, step, 2) * U.TAU + 2.3 * w * t;
    const a3 = draw(seed, step, 3) * U.TAU + 0.45 * w * t, av = draw(seed, step, 4) * U.TAU + 0.7 * w * t;
    return { along: Math.cos(a1) * 0.7 + Math.cos(a2) * 0.3, cross: Math.cos(a3), vx: Math.cos(av), vy: Math.sin(av) };
  }
  function ghostOf(tr, t) {
    const W = T.ghostDrift, k = Math.floor(t / W), f = smoother(t / W - k);
    const a = ghostDraw(tr.g.seed, k, t), b = ghostDraw(tr.g.seed, k + 1, t);
    return {
      along: a.along + (b.along - a.along) * f, cross: a.cross + (b.cross - a.cross) * f,
      vx: a.vx + (b.vx - a.vx) * f, vy: a.vy + (b.vy - a.vy) * f,
    };
  }
  // The best that hull can do: thrust over its dry mass, off the class. It is what the box has to grow by while
  // nobody can see whether she is burning.
  function aMaxOf(ship) {
    const c = OD.Ships && OD.Ships.CLASSES ? OD.Ships.CLASSES[ship.cls] : null;
    const thrust = c && c.thrust > 0 ? c.thrust : ship.thrust > 0 ? ship.thrust : 0;
    const mass = c && c.dryMass > 0 ? c.dryMass : ship.dryMass > 0 ? ship.dryMass : 1;
    return thrust > 0 ? thrust / mass : 0;
  }
  function newTrack(faction, target) {
    return {
      id: target.id, ship: target, q: 1, qRange: 1, dwell: 0, source: 'passive', word: 'contact',
      classKnown: false, named: false, posErr: 0, velErr: 0, range: 0, by: null, byName: '', hostile: true, forced: false,
      bearingErr: 0, rangeErr: 0, los: 0, fade: 0, fix: null, aMax: aMaxOf(target),
      measured: 1, carried: 1,
      passive: 1, passiveQ: 1, pby: null, pRange: 0,
      est: { pos: { x: target.pos.x, y: target.pos.y }, vel: { x: target.vel.x, y: target.vel.y } },
      g: { seed: hash(faction + ':' + target.id) },   // the seed alone: the phases are drawn off the clock
      level: 0, logT: -1e9,
    };
  }

  // The sensor watch (v13): an ear with nobody on the watch reads at 0.7, a veteran watch a little better;
  // 1 without the crew module.
  function crewEar(o) {
    if (!o || !OD.Crew || typeof OD.Crew.sensorFactor !== 'function') return 1;
    try { const f = OD.Crew.sensorFactor(o); return isFinite(f) && f > 0 ? f : 1; } catch (e) { return 1; }
  }
  // One faction's reading of one hull: the best sensor it has on it right now.
  function measure(sim, faction, probe, target, tr) {
    tr.ship = target;
    tr.hostile = typeof sim.isHostile === 'function' ? sim.isHostile(target, probe) : target.faction !== faction;
    const P = power(target);
    // Two readings: what the faction holds, and what it would hold on its passive ears alone. The second is
    // what the computer and the decision layer ask about before they light a radar.
    let q = 1, by = null, range = 0, source = 'passive';
    let pq = 1, pby = null, pRange = 0;
    const ships = sim.ships;
    for (let i = 0; i < ships.length; i++) {
      const o = ships[i];
      if (o.destroyed || o.faction !== faction || o === target) continue;
      const R = Math.max(1, U.dist(o.pos, target.pos));
      const passive = qRange(sensorS(o) * crewEar(o), P, R);
      if (pby === null || passive > pq || (passive === pq && R < pRange)) { pq = passive; pby = o; pRange = R; }
      const active = !!o.activeSensor && R <= (o.activeRange || 0);
      const qq = active ? 3 : passive;
      // Ties (everyone beyond R_far reads q 1) go to the closest hull, not to the first one in the fleet list.
      if (by === null || qq > q || (qq === q && R < range)) { q = qq; by = o; range = R; source = active ? 'active' : 'passive'; }
    }
    // A hull running its own active sensor tells everyone where it is; transponders do the same for our own
    // side and for civilians. Neither needs an ear of ours lit to hear it.
    if (target.activeSensor && (target.activeRange || 0) > 0) { q = 3; pq = 3; source = 'active'; }
    if (!tr.hostile) { q = 3; pq = 3; source = 'friendly'; }
    tr.qRange = q;
    tr.passiveQ = pq; tr.pby = pby || by; tr.pRange = pby ? pRange : range;
    tr.forced = source !== 'passive';
    tr.source = source;
    tr.by = by; tr.byName = by ? by.name : '';
    tr.range = range;
    return tr;
  }

  // Dwell, the words and the ghost. Cheap enough to run every substep for every track.
  function advance(sim, tr, dt) {
    const target = tr.ship;
    if (!target) return tr;
    if (tr.qRange >= 1.5) tr.dwell = Math.min(T.dwellTime * 2, tr.dwell + dt * crewEar(tr.by || tr.pby));
    else if (dt > 0) tr.dwell = Math.max(0, tr.dwell - dt);
    const bonus = T.dwellBonus * Math.min(1, tr.dwell / T.dwellTime);
    const measured = tr.forced ? 3 : Math.min(3, tr.qRange + bonus);
    const passive = Math.min(3, tr.passiveQ + bonus);
    // What the ears read now, and then what the plot is willing to report. A source going dark — a
    // drive cut, the panels in, her own radar switched off — does not throw away where she was and
    // how fast she was going: the track is carried on by dead reckoning, and the answer only rots
    // as fast as her own manoeuvring can take her out of the box. So a fall is metered at T.decay
    // of q per 60 s toward the reading (a solution takes about two minutes to fade to a contact)
    // while a rise is immediate: the moment she shows herself again we have her.
    // The reckoning is kept on the passive picture, which is the one that has to be carried. A
    // transponder and a lit radar — hers or ours — are read straight off the sky for as long as
    // they are there, and the moment they stop the plot falls back to what the ears have been
    // holding all along, not to a solution fading out of one. The reported quality is all this block
    // decides; the clock on the reckoning (tr.fade) belongs to the error box below, because the question
    // it answers is a different one — how long since anything was actually resolved — and a carried q
    // meeting the floor it has rotted to is not a fresh reading, however equal the two numbers look.
    if (passive >= tr.carried) tr.carried = passive;
    else if (dt > 0) tr.carried = Math.max(passive, tr.carried - T.decay * (dt / 60));
    tr.measured = measured;
    tr.q = tr.forced ? 3 : tr.carried;
    tr.passive = passive;
    tr.word = tr.q < T.trackQ ? 'contact' : tr.q < T.solutionQ ? 'track' : 'solution';
    tr.classKnown = tr.q >= T.trackQ;
    if (tr.classKnown) tr.named = true;   // once a hull has a name the log keeps using it
    // The error box. A fix is worth R · 0.12 · (3 − q)^1.5 along the line of sight — the range is the hard part —
    // and T.crossFraction of that across it, which is what makes a bearing worth having. The plot does not
    // recompute the box from the reported q every frame: it carries the last fix and reckons it forward, both
    // axes growing by velErr·t + ½·a_max·t², capped at T.errCap of the range, because a hull nobody can read
    // could be anywhere inside her own acceleration. The clock (tr.fade) is reset only by a fresh fix, which
    // is a live reading at least as good as the box being carried; a reading at the floor (q 1: the bearing we
    // already had) is not a reading, and touching the cap is not one either, so a hull that has stayed dark is
    // never localised better for having hidden longer. The box is floored at what the reported q is worth on
    // its own, so the panel's q and ± cannot disagree. posErr stays the larger of the two axes, in metres, for
    // everything that wants one number, and velErr still follows it over two minutes.
    const R = isFinite(tr.range) && tr.range > 0 ? tr.range : 0;
    const by = tr.by || tr.pby;
    if (by) tr.los = U.angleOf(U.sub(target.pos, by.pos));
    const cap = R * T.errCap;
    const boxFor = (qq) => R * 0.12 * Math.pow(Math.max(0, 3 - qq), 1.5);
    const solved = tr.q >= 3;
    const liveQ = tr.forced ? 3 : passive;
    const hasFix = !solved && liveQ > 1 + T.fixFloor;   // the ears resolve her, rather than hand back the old line
    const live = boxFor(Math.max(1, liveQ));
    if (solved) { tr.fix = 0; tr.fade = 0; }
    else if (tr.fix == null) { tr.fix = Math.min(live, cap); tr.fade = 0; }  // nothing resolved yet: what the ears give
    else if (dt > 0) tr.fade += dt;
    let grow = tr.fade > 0 ? (tr.fix / 120) * tr.fade + 0.5 * tr.aMax * tr.fade * tr.fade : 0;
    if (hasFix && live <= tr.fix + grow) { tr.fix = live; tr.fade = 0; grow = 0; }   // a fresh fix: reckon from it
    const floor = solved ? 0 : boxFor(tr.q);
    tr.rangeErr = Math.min(Math.max(tr.fix + grow, floor), cap);
    const cross = Math.min(Math.max(tr.fix * T.crossFraction + grow, floor * T.crossFraction), cap);
    tr.bearingErr = R > 0 ? cross / R : 0;
    tr.posErr = Math.max(tr.rangeErr, cross);
    tr.velErr = tr.posErr / 120;
    const mag = T.ghostScale, mv = tr.velErr * mag;
    const g = ghostOf(tr, sim && isFinite(sim.time) ? sim.time : 0);
    const dAlong = g.along * tr.rangeErr * mag;
    const dCross = g.cross * cross * mag;
    const cl = Math.cos(tr.los), sl = Math.sin(tr.los);
    tr.est.pos.x = target.pos.x + cl * dAlong - sl * dCross;
    tr.est.pos.y = target.pos.y + sl * dAlong + cl * dCross;
    tr.est.vel.x = target.vel.x + g.vx * mv;
    tr.est.vel.y = target.vel.y + g.vy * mv;
    return tr;
  }

  // ---- the log: four lines, thrown only for the player's own tracks on hostiles -----------------
  function levelOf(q, prev) {
    const h = T.hysteresis;
    let lvl = q >= T.solutionQ ? 3 : q >= T.trackQ ? 2 : q > 1.02 ? 1 : 0;
    if (prev > lvl) {
      if (prev >= 3 && q >= T.solutionQ - h) lvl = 3;
      else if (prev >= 2 && q >= T.trackQ - h) lvl = Math.max(lvl, 2);
      else if (prev >= 1 && q > 1.005) lvl = Math.max(lvl, 1);
    }
    return lvl;
  }
  function logTrack(sim, faction, tr) {
    if (faction !== sim.playerFaction || !tr.hostile) return;
    const lvl = levelOf(tr.q, tr.level);
    if (lvl === tr.level) return;
    if (sim.time - tr.logT < T.logGap) return; // a wobbling q waits its turn
    const up = lvl > tr.level, ship = tr.ship;
    const name = tr.named ? ship.name : null;
    // Nothing under a solution is known to the kilometre, and none of it is read off the truth: the range is
    // the ghost's, measured from the ear that holds her, spoken to two figures with the error box on it, and
    // the bearing at contact quality is rounded to five degrees. Only a solution prints the range exactly.
    const d = rangeWords(tr, lvl);
    const by = tr.by || tr.pby, ear = by && by.name ? by.name : '';
    let text = '';
    if (up && lvl === 1) text = (ear ? ear + ' has a contact' : 'Contact') + ' bearing ' + bearing(tr) + ', range ' + d + '. Class unknown.';
    else if (up && lvl === 2) text = 'Track: ' + ship.name + ', a ' + roleOf(ship) + ' at ' + d + (ear ? ' from ' + ear : '') + '.';
    else if (up && lvl === 3) text = 'Solution on ' + ship.name + ' at ' + d + (ear ? ' from ' + ear : '') + '.';
    else if (lvl === 2) text = 'Solution lost on ' + (name || 'the contact') + '. We hold a track at ' + d + '.';
    else if (lvl === 1) text = 'Track lost on ' + (name || 'the contact') + '. We hold a contact at ' + d + '.';
    else text = name ? 'Contact lost on ' + name + '.' : 'Contact lost.';
    tr.level = lvl; tr.logT = sim.time;
    if (typeof sim.addLog === 'function') sim.addLog(text, 'Sensors', 'info');
  }
  function roleOf(ship) { const c = OD.Ships && OD.Ships.CLASSES ? OD.Ships.CLASSES[ship.cls] : null; return (c && c.role) || 'ship'; }
  // Two significant figures, and bearings to the nearest five degrees: what a bare contact is actually worth.
  function sig2(v) {
    if (!isFinite(v) || v === 0) return 0;
    const m = Math.pow(10, Math.floor(Math.log10(Math.abs(v))) - 1);
    return Math.round(v / m) * m;
  }
  function dist2(m) { return U.fmt.dist(sig2(m)); }
  // Where the plot has her, from the ear that holds her: the ghost it is actually carrying, not the truth.
  function ghostFrom(tr) {
    const by = tr.by || tr.pby;
    if (!by || !tr.est) return null;
    return U.sub(tr.est.pos, by.pos);
  }
  // The range as the plot may honestly quote it: two figures off the ghost with the error box on it while the
  // picture is fuzzy, the truth only once we hold a solution on her.
  function rangeWords(tr, lvl) {
    if (lvl >= 3) return U.fmt.dist(tr.range);
    const rel = ghostFrom(tr);
    const R = rel ? Math.max(1, U.len(rel)) : tr.range;
    const err = tr.rangeErr || tr.posErr || 0;
    return dist2(R) + (err > 0 ? ' ±' + dist2(err) : '');
  }
  // A bearing to five degrees, off the same ghost: what a bare contact is actually worth.
  function bearing(tr) {
    const rel = ghostFrom(tr);
    if (!rel) return '—';
    const step = Math.PI / 36;
    return U.fmt.deg(Math.round(U.wrapAngle(U.angleOf(rel)) / step) * step);
  }

  // ---- the sim hooks --------------------------------------------------------------------------
  function init(sim) {
    if (!sim || !sim.ships) return;
    sim.sensors = { factions: Object.create(null), probes: Object.create(null), list: [], t: -1e9, sweep: -1e9 };
    for (const s of sim.ships) if (s.activeSensor == null) s.activeSensor = false;
    update(sim, 0);
  }

  function geometry(sim, st) {
    const ships = sim.ships;
    st.list.length = 0;
    for (let i = 0; i < ships.length; i++) {
      const f = ships[i].faction;
      if (!ships[i].destroyed && st.list.indexOf(f) < 0) st.list.push(f);
    }
    for (let k = 0; k < st.list.length; k++) {
      const faction = st.list[k], table = tableFor(st, faction), probe = probeFor(st, faction);
      for (let i = 0; i < ships.length; i++) {
        const t = ships[i];
        if (t.destroyed || t.faction === faction) continue;
        let tr = table[t.id];
        if (!tr) tr = table[t.id] = newTrack(faction, t);
        measure(sim, faction, probe, t, tr);
      }
    }
  }

  // Tracks on hulls that have gone are dropped now and then; nothing cares about them in between.
  function sweep(sim, st) {
    for (const faction in st.factions) {
      const table = st.factions[faction];
      for (const id in table) {
        const sh = table[id].ship;
        if (!sh || sh.destroyed || sh.faction === faction) delete table[id];
      }
    }
  }

  function update(sim, dt) {
    if (!sim || !sim.ships) return;
    const st = ensure(sim);
    const ships = sim.ships;
    // The active sensor: 2 MW into the sink for as long as it is lit, and a hull without one cannot light it.
    for (let i = 0; i < ships.length; i++) {
      const s = ships[i];
      if (s.destroyed) { s.activeSensor = false; continue; }
      if (s.activeSensor && !((s.activeRange || 0) > 0)) s.activeSensor = false;
      if (s.activeSensor) s.extraHeat = (s.extraHeat || 0) + T.activeHeat;
    }
    if (sim.time - st.t >= T.refresh || dt <= 0) { st.t = sim.time; geometry(sim, st); }
    for (const faction in st.factions) {
      const table = st.factions[faction];
      for (const id in table) {
        const tr = table[id];
        if (!tr.ship || tr.ship.destroyed) continue;
        if (tr.ship.faction === faction) { delete table[id]; continue; }  // a prize is ours now
        advance(sim, tr, dt);
        logTrack(sim, faction, tr);
      }
    }
    if (sim.time - st.sweep > 30) { st.sweep = sim.time; sweep(sim, st); }
  }

  // ---- the interface --------------------------------------------------------------------------
  function factionOf(x) { return typeof x === 'string' ? x : x && x.faction ? x.faction : null; }
  function shipOf(sim, x) { return typeof x === 'string' ? (sim && sim.byId ? sim.byId(x) : null) : x; }

  // The live record, made and measured on the spot when nothing has looked yet.
  function lookup(sim, faction, target) {
    if (!sim || !faction || !target) return null;
    const st = ensure(sim), table = tableFor(st, faction);
    let tr = table[target.id];
    if (!tr) {
      tr = table[target.id] = newTrack(faction, target);
      measure(sim, faction, probeFor(st, faction), target, tr);
      advance(sim, tr, 0);
      tr.level = levelOf(tr.q, 0);
    }
    return tr;
  }

  // Asked about one hull, the answer is read off the sky now, not off the last pass: a ship that has just lit
  // its drive or its radar is read as it is. Dwell and the ghost are untouched (no time has passed).
  function fresh(sim, faction, target) {
    const tr = lookup(sim, faction, target);
    if (!tr || !tr.ship) return tr;
    measure(sim, faction, probeFor(ensure(sim), faction), target, tr);
    return advance(sim, tr, 0);
  }

  function track(sim, factionOrShip, target) {
    const faction = factionOf(factionOrShip), t = shipOf(sim, target);
    if (!faction || !t || t.destroyed) return null;
    return fresh(sim, faction, t);
  }
  function quality(sim, observer, target) {
    if (!observer || !target) return 1;
    if (observer === target || observer.faction === target.faction) return 3;
    const tr = fresh(sim, observer.faction, target);
    return tr ? tr.q : 1;
  }
  // Where a hostile seems to be. The truth for our own and for anything we hold a solution on.
  // The vectors are the track's own: read them, do not write them.
  function perceived(sim, observer, target) {
    if (!target) return null;
    const hostile = observer && sim && typeof sim.isHostile === 'function' ? sim.isHostile(target, observer) : false;
    if (!hostile) return { pos: target.pos, vel: target.vel };
    const tr = lookup(sim, observer.faction, target);
    if (!tr || tr.q >= T.solutionQ) return { pos: target.pos, vel: target.vel };
    return { pos: tr.est.pos, vel: tr.est.vel };
  }
  function setActive(ship, on) {
    if (!ship) return false;
    if (on && (ship.destroyed || !((ship.activeRange || 0) > 0))) { ship.activeSensor = false; return false; }
    ship.activeSensor = !!on;
    return ship.activeSensor;
  }
  function isActive(ship) { return !!(ship && ship.activeSensor); }

  // The ranges at which the best hostile sensor reads this hull as it is burning, radiating and lit right now,
  // and which hull that is. This is the same question their own track() answers from the other side, so it is
  // solved the same way: their q is the range term plus the dwell bonus they have already earned on us, so the
  // range only has to carry T.solutionQ − bonus, and the bonus is read off their live track record on this
  // hull. A hostile that has held us for minutes therefore reads us as a solution from farther out than one
  // that has just found us, and the caption, the Signature line and the radiators card cannot say one thing
  // while track() says another. A hostile with its own active sensor pins us anywhere inside its active range,
  // whatever we are showing; our own lit radar is announced by the signature word, not by a range.
  function seenFrom(sim, ship) {
    const sig = signature(ship);
    const out = { solution: 0, track: 0, held: 0, heldBy: null, by: null, word: sig.word };
    if (!sim || !ship || !sim.ships || typeof sim.isHostile !== 'function') return out;
    const root = Math.sqrt(Math.max(sig.total, 1) / REF);
    for (const o of sim.ships) {
      if (o.destroyed || !sim.isHostile(o, ship)) continue;
      const sol = sensorS(o) * root;
      const tr = lookup(sim, o.faction, ship);
      const bonus = tr ? T.dwellBonus * Math.min(1, (tr.dwell || 0) / T.dwellTime) : 0;
      let solution = rangeForQ(sol, Math.max(1, T.solutionQ - bonus)), track = rangeForQ(sol, Math.max(1, T.trackQ - bonus));
      if (o.activeSensor && (o.activeRange || 0) > 0) { solution = Math.max(solution, o.activeRange); track = Math.max(track, o.activeRange); }
      // What they are actually holding, which can beat what we are showing: a track carried forward by dead
      // reckoning solves us from beyond the range our signature would give them. The ranges above answer
      // 'from where is what I am showing solvable'; `held` answers 'who has a solution on me right now, and
      // from how far', which is the honest range for a PINNED tag.
      if (tr && tr.q >= T.solutionQ) { const R = U.dist(o.pos, ship.pos); if (R > out.held) { out.held = R; out.heldBy = o.name; } }
      if (solution > out.solution) { out.solution = solution; out.track = Math.max(track, solution); out.by = o.name; }
    }
    return out;
  }

  // Seconds until the faction holds a solution on the target at this closing rate, or null if never.
  function solutionEta(sim, observer, target) {
    if (!sim || !observer || !target || target.destroyed) return null;
    const tr = lookup(sim, observer.faction, target);
    if (!tr) return null;
    if (tr.passive >= T.solutionQ) return 0;
    const by = tr.pby || tr.by || observer;
    const S = sensorS(by), P = power(target);
    if (!(S > 0)) return null;
    const r = U.sub(target.pos, by.pos);
    const R0 = Math.max(1, U.len(r));
    const closing = -U.dot(U.sub(target.vel, by.vel), U.scale(r, 1 / R0));
    const at = (t) => {
      const R = Math.max(1, R0 - closing * t);
      return Math.min(3, qRange(S, P, R) + T.dwellBonus * Math.min(1, (tr.dwell + t) / T.dwellTime));
    };
    const horizon = 3600, steps = 60, h = horizon / steps;
    for (let i = 1; i <= steps; i++) {
      const t = i * h;
      if (at(t) < T.solutionQ) continue;
      let lo = t - h, hi = t;
      for (let k = 0; k < 14; k++) { const m = (lo + hi) / 2; if (at(m) >= T.solutionQ) hi = m; else lo = m; }
      return hi;
    }
    return null;
  }

  function report(sim, ship) {
    const rows = [];
    if (!ship) return rows;
    const sig = signature(ship);
    const cap = sig.word.charAt(0).toUpperCase() + sig.word.slice(1);
    rows.push({ label: 'Signature', value: cap + ' · ' + U.fmt.power(sig.total), tip: 'sig_signature' });
    rows.push({ label: 'By source', value: 'plume ' + U.fmt.power(sig.plume) + ' · radiators ' + U.fmt.power(sig.radiators) + ' · hull ' + U.fmt.power(sig.hull), tip: 'sig_sources' });
    const seen = seenFrom(sim, ship);
    rows.push({ label: 'Seen from', value: seen.by ? U.fmt.dist(seen.solution) + ' solution · ' + U.fmt.dist(seen.track) + ' track (' + seen.by + ')' : 'nobody is looking', tip: 'sig_seen' });
    rows.push({
      label: 'Our sensor',
      value: U.fmt.dist(sensorS(ship)) + ' passive · ' + ((ship.activeRange || 0) > 0 ? U.fmt.dist(ship.activeRange) + ' active (' + (ship.activeSensor ? 'on' : 'off') + ')' : 'no active set'),
      tip: 'sig_sensor',
    });
    const target = ship.target && sim && sim.byId ? sim.byId(ship.target) : null;
    if (target && typeof sim.isHostile === 'function' && sim.isHostile(target, ship)) {
      const tr = track(sim, ship, target);
      if (tr) {
        rows.push({ label: 'Track', value: tr.word + ' · q ' + tr.q.toFixed(1) + (tr.posErr > 0 ? ' · ±' + U.fmt.dist(tr.posErr) : ' · pinned'), tip: 'sig_track' });
        const eta = solutionEta(sim, ship, target);
        rows.push({ label: 'Solution in', value: tr.q >= T.solutionQ ? 'held' : eta == null ? 'not at this range' : U.fmt.time(eta), tip: 'sig_eta' });
      }
    }
    return rows;
  }

  function contacts(sim, faction) {
    const out = [];
    if (!sim || !sim.ships || !faction) return out;
    for (const s of sim.ships) {
      if (s.destroyed || s.faction === faction) continue;
      const tr = lookup(sim, faction, s);
      if (!tr) continue;
      out.push({ ship: s, q: tr.q, word: tr.word, est: tr.est, posErr: tr.posErr, rangeErr: tr.rangeErr, bearingErr: tr.bearingErr, los: tr.los, classKnown: tr.classKnown });
    }
    return out;
  }

  OD.Sensors = { init, update, signature, track, quality, perceived, setActive, isActive, seenFrom, solutionEta, report, contacts, T };
})();
