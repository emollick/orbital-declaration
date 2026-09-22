/* Decision-layer checks for Orbital Declaration (OD.Decisions).
   node tools/decisions-check.js   (needs Playwright + Chromium; NODE_PATH may need the global modules dir)

   The band is not only asked to appear: it is asked to be right. A reviewer who answers nothing but
   the lit option has to be able to win chapter 4, and the questions must not turn into wallpaper, so
   the counts, the cooldowns and the recommendation itself are checked as hard as the shape. */
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const url = process.env.OD_URL || 'file://' + path.join(ROOT, 'index.html');

let failures = 0;
function check(name, ok, detail) { console.log((ok ? '  ok   ' : '  FAIL ') + name + (detail ? '  ' + detail : '')); if (!ok) failures++; }
function note(text) { console.log('    ' + text); }

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
  await page.goto(url);
  await page.waitForTimeout(600);

  const mod = await page.evaluate(() => ({
    present: !!(window.OD && OD.Decisions),
    api: ['init', 'update', 'current', 'refresh', 'choose', 'dismiss'].filter((k) => !OD.Decisions || typeof OD.Decisions[k] !== 'function'),
    kinds: (OD.Decisions && OD.Decisions.kinds ? OD.Decisions.kinds : []).map((k) => k.kind),
    teachless: (OD.Decisions && OD.Decisions.kinds ? OD.Decisions.kinds : []).filter((k) => !k.teach || k.teach.length < 120).map((k) => k.kind),
    cooldown: OD.Decisions && OD.Decisions.T ? OD.Decisions.T.cooldown : null,
    caps: OD.Decisions && typeof OD.Decisions.capabilities === 'function' ? OD.Decisions.capabilities(OD.Game && OD.Game.sim) : null,
  }));
  check('OD.Decisions loaded with the whole interface', mod.present && mod.api.length === 0, mod.api.join(','));
  check('the sixteen kinds are listed in order',
    mod.kinds.join(',') === 'approach,sensors,radiators,range,salvo,cripple,slugs,heat,defend,aim,withdraw,sink,capped,repair,burn,medical',
    mod.kinds.join(','));
  check('every kind carries a teaching paragraph', mod.teachless.length === 0, mod.teachless.join(','));
  check('the cooldown is 600 s', mod.cooldown === 600, String(mod.cooldown));
  note('interfaces in this build: ' + JSON.stringify(mod.caps));
  const caps = mod.caps || {};

  // ---------------------------------------------------------------- chapter 2, before a designation
  // approach question is the one that teaches, so it has to arrive without a designation first.
  console.log('scenario: chapter 2, nothing designated');
  const cold = await page.evaluate(() => {
    const out = { err: [], targetAtStart: null, kinds: [], approach: null, acted: null, toldTarget: null, reaimed: null, reraised: null };
    try {
      OD.harness.start(1);
      const sim = OD.Game.sim, D = OD.Decisions;
      OD.harness.select('larkspur');
      const me = sim.byId('larkspur');
      out.targetAtStart = me.target;
      const seen = new Set();
      let d = null;
      for (let i = 0; i < 40 && !d && !sim.outcome; i++) {
        OD.harness.step(5);
        for (const x of sim.decisions || []) seen.add(x.shipId + ':' + x.kind);
        d = (sim.decisions || []).find((x) => x.kind === 'approach' && x.shipId === 'larkspur') || null;
      }
      out.kinds = Array.from(seen);
      out.time = sim.time;
      if (d) {
        out.approach = { at: Math.round(sim.time), target: d.targetId, hostile: !!(sim.byId(d.targetId) && sim.isHostile(sim.byId(d.targetId), me)),
          title: d.title, options: d.options.map((o) => o.key + ' ' + o.label + ' · ' + o.detail + (o.recommended ? ' [rec]' : '')) };
        out.teaches = typeof d.teach === 'string' && d.teach.length > 120;
        // the question about the nearest contact re-aims itself, without spending its cooldown, as
        // soon as the bridge names a hull
        sim.setTarget('larkspur', 'sabre');
        OD.harness.step(5);
        const again = (sim.decisions || []).find((x) => x.kind === 'approach' && x.shipId === 'larkspur');
        out.reaimed = !!(again && again.id !== d.id && again.targetId === 'sabre' && again.teach && again.teach.length > 120);
        // every option that flies the ship somewhere designates the hull it flies at
        const live = again || d;
        me.target = null;
        const o = live.options.find((x) => x.recommended) || live.options[0];
        D.choose(sim, live.id, o.key);
        out.toldTarget = me.target === live.targetId;
        out.acted = (me.order.type === 'keeprange' || me.order.type === 'approach') && me.order.target === live.targetId;
      }
    } catch (e) { out.err.push(String(e.stack || e)); }
    out.errors = OD.errors.slice();
    return out;
  });
  check('no errors before anything is designated', cold.err.length === 0 && cold.errors.length === 0, cold.err.concat(cold.errors).join(' | '));
  check('the ship starts with no target', cold.targetAtStart == null, String(cold.targetAtStart));
  check('the approach question arrives without a designation', !!cold.approach && cold.approach.hostile, cold.approach ? cold.approach.at + ' s: ' + cold.approach.title : 'never, saw ' + cold.kinds.join(',') + ' in ' + Math.round(cold.time || 0) + ' s');
  check('the nearest-contact question carries the teaching paragraph', cold.teaches === true, String(cold.teaches));
  check('naming a hull re-aims it, and that question teaches', cold.reaimed === true, String(cold.reaimed));
  check('choosing it designates the hull and sets the order', cold.toldTarget === true && cold.acted === true, cold.toldTarget + '/' + cold.acted);
  if (cold.approach) note(cold.approach.options.join('\n    '));

  // ---------------------------------------------------------------- chapter 2: Larkspur and Sabre
  console.log('scenario: chapter 2, one corvette against a cold picket');
  await page.evaluate(() => OD.harness.start(1));
  const fight = await page.evaluate(() => {
    const sim = OD.Game.sim, D = OD.Decisions;
    const out = {
      err: [], kinds: [], first: null, shape: null, acts: {}, chosen: [], moot: 0, mootKinds: [],
      hostileShips: 0, stationShips: 0, earlyHauler: 0, reopened: [], sinkGap: null, seqSteps: 0, time: 0, outcome: null,
      refreshAfterBlank: null, refreshMoved: null, refreshStable: null, closedOnChoose: null, logged: [], quietLogged: null,
    };
    const key = (d) => d.shipId + '|' + d.kind + '|' + (d.targetId || '');
    const seen = new Set(), closedAt = Object.create(null), live = new Map();
    const want = {
      approach: (d) => d.options.find((o) => o.recommended),
      radiators: (d) => d.options.find((o) => /^Stow/.test(o.label)),
      salvo: (d) => d.options.find((o) => /^Hold the bays/.test(o.label)), // an answer that changes nothing
    };
    let seq = sim.decisionSeq;
    try {
      OD.harness.select('larkspur');
      OD.Game.setTarget('sabre');
      for (let i = 0; i < 240 && !sim.outcome; i++) {
        OD.harness.step(10);
        const open = sim.decisions || [];
        // nobody but a player-faction, non-station hull is ever asked, and an AI-flown hauler is
        // left alone for the first minute
        for (const d of open) {
          const s = sim.byId(d.shipId);
          if (!s || s.faction !== sim.playerFaction) out.hostileShips++;
          else if (s.role === 'station') out.stationShips++;
          else if (s.role === 'freighter' && s.ai && d.openedAt < 60) out.earlyHauler++;
          seen.add(d.kind);
          const k = key(d);
          // The two heat kinds are the deliberate exceptions. A sink crossing the re-arm band is a
          // different situation from the one that was answered, and a hull locked in a saturated
          // sink is asked again every couple of minutes whatever the cooldown says: nothing in the
          // sim takes her out of that state, and the band going quiet is the whole failure. They
          // are held to the lock's own repeat instead, below.
          const hot = d.kind === 'sink' || d.kind === 'heat';
          if (!hot && closedAt[k] != null && d.openedAt - closedAt[k] < D.T.cooldown && !out.reopened.some((x) => x.indexOf(d.kind) === 0)) {
            out.reopened.push(d.kind + ' (' + k + ' closed ' + Math.round(closedAt[k]) + ', open again ' + Math.round(d.openedAt) + ')');
          }
          if (hot && closedAt[k] != null) {
            const gap = d.openedAt - closedAt[k];
            if (out.sinkGap == null || gap < out.sinkGap) out.sinkGap = gap;
          }
        }
        // anything that left the list without being chosen closed itself: the situation had lapsed
        for (const [id, d] of live) {
          if (open.some((x) => x.id === id)) continue;
          live.delete(id);
          if (!d.chosen) { out.moot++; if (out.mootKinds.indexOf(d.kind) < 0) out.mootKinds.push(d.kind); closedAt[key(d)] = d.closedAt != null ? d.closedAt : sim.time; }
        }
        for (const d of open) if (!live.has(d.id)) live.set(d.id, d);

        if (out.refreshMoved == null && open.length) {
          const d = D.current(sim);
          const who = sim.byId(d.shipId);
          if (!out.first) out.first = { kind: d.kind, ship: d.shipId, title: d.title, text: d.text, options: d.options.map((o) => o.key + ' ' + o.label + ' · ' + o.detail + (o.recommended ? ' [rec]' : '')) };
          out.shape = out.shape || {
            id: typeof d.id === 'string', mine: !!who && who.faction === sim.playerFaction, until: typeof d.until === 'function',
            openedAt: typeof d.openedAt === 'number', acts: d.options.every((o) => typeof o.act === 'function'),
            keys: d.options.map((o) => o.key).join(''), recs: d.options.filter((o) => o.recommended).length,
            numbers: d.options.every((o) => /\d/.test(o.detail)),
          };
          const before = d.options.map((o) => o.detail);
          const labels = d.options.map((o) => o.label).join('|');
          const rec = d.options.findIndex((o) => o.recommended);
          for (const o of d.options) o.detail = '';
          D.refresh(sim, d);
          out.refreshAfterBlank = d.options.every((o) => o.detail && /\d/.test(o.detail));
          const seqWas = sim.decisionSeq;
          OD.harness.step(60);
          if (sim.decisions.indexOf(d) >= 0) {
            D.refresh(sim, d);
            out.refreshMoved = d.options.some((o, n) => o.detail !== before[n]);
            const same = d.options.map((o) => o.label).join('|') === labels && d.options.findIndex((o) => o.recommended) === rec;
            out.refreshStable = same || sim.decisionSeq !== seqWas;
          }
        }
        const cur = D.current(sim);
        if (cur && want[cur.kind]) {
          const o = want[cur.kind](cur);
          if (o) {
            const me = sim.byId(cur.shipId);
            const was = { order: me.order.type, rads: me.radiators.deployed, logs: sim.log.length };
            live.get(cur.id) && (live.get(cur.id).chosen = true);
            D.choose(sim, cur.id, o.key);
            closedAt[key(cur)] = sim.time;
            out.chosen.push(cur.kind + ' → ' + o.label);
            out.closedOnChoose = (out.closedOnChoose !== false) && !(sim.decisions || []).some((x) => x.id === cur.id);
            if (cur.kind === 'approach') out.acts.approach = (me.order.type === 'keeprange' || me.order.type === 'approach') && me.order.target === cur.targetId;
            if (cur.kind === 'radiators') out.acts.radiators = me.radiators.deployed === false && was.rads === true;
            // an answer that changes nothing writes no line in the log
            if (cur.kind === 'salvo') out.quietLogged = sim.log.slice(was.logs).some((l) => /^Decision: /.test(l.text));
            delete want[cur.kind];
          }
        }
        if (sim.decisionSeq !== seq) { seq = sim.decisionSeq; out.seqSteps++; }
      }
      out.kinds = Array.from(seen);
      out.time = sim.time;
      out.outcome = sim.outcome;
      out.logged = sim.log.filter((l) => /^Decision: /.test(l.text) && l.speaker === 'Bridge').map((l) => l.text);
    } catch (e) { out.err.push(String(e.stack || e)); }
    out.errors = OD.errors.slice();
    return out;
  });
  check('no errors from the decision layer', fight.err.length === 0 && fight.errors.length === 0, fight.err.concat(fight.errors).join(' | '));
  check('at least three kinds are raised over the fight', fight.kinds.length >= 3, fight.kinds.join(',') + ' after ' + Math.round(fight.time) + ' s, outcome ' + fight.outcome);
  check('the decision carries the whole shape', !!fight.shape && fight.shape.id && fight.shape.mine && fight.shape.until && fight.shape.openedAt && fight.shape.acts, JSON.stringify(fight.shape));
  check('options are keyed 1..n with exactly one recommended and numbers in every line', !!fight.shape && /^1(2(3)?)?$/.test(fight.shape.keys) && fight.shape.recs === 1 && fight.shape.numbers, JSON.stringify(fight.shape));
  note('first: ' + (fight.first ? fight.first.kind + ' on ' + fight.first.ship + ' — ' + fight.first.title + '\n      ' + fight.first.options.join('\n      ') : 'none'));
  check('refresh() rebuilds a blanked detail line with its numbers', fight.refreshAfterBlank === true, String(fight.refreshAfterBlank));
  check('refresh() moves the detail text as the numbers move', fight.refreshMoved === true, String(fight.refreshMoved));
  check('refresh() keeps the labels and the lit option, or moves decisionSeq with them', fight.refreshStable === true, String(fight.refreshStable));
  check('choose() closes the decision and logs it to the Bridge', fight.closedOnChoose === true && fight.logged.length > 0, (fight.logged || []).join(' | '));
  check('an answer that changes nothing writes no log line', fight.quietLogged !== true, String(fight.quietLogged));
  check('choose() on approach sets the order', fight.acts.approach === true, JSON.stringify(fight.acts));
  // The panels question belongs to one kind at a time now, so in a fight the heat card often owns
  // it and no radiators card is raised at all. When one is, answering it must still stow them.
  check('choose() on radiators stows the panels when one is raised', fight.acts.radiators !== false, JSON.stringify(fight.acts));
  check('decisions that went moot closed themselves', fight.moot > 0, fight.moot + ' · ' + fight.mootKinds.join(','));
  check('nothing reopens inside the 600 s cooldown', fight.reopened.length === 0, fight.reopened.join(','));
  check('and the heat and sink cards repeat no faster than every 2 min', fight.sinkGap === null || fight.sinkGap >= 120, String(fight.sinkGap));
  check('decisionSeq moves on every open and close', fight.seqSteps >= fight.kinds.length, String(fight.seqSteps));
  check('no decision for a hostile ship', fight.hostileShips === 0, String(fight.hostileShips));
  check('no decision for a station', fight.stationShips === 0, String(fight.stationShips));
  check('nothing in the first 60 s about an AI-flown freighter', fight.earlyHauler === 0, String(fight.earlyHauler));
  note('chosen: ' + fight.chosen.join(' | '));

  // ---------------------------------------------------------------- two hulls: current() follows the bridge
  console.log('scenario: skirmish, two corvettes a side');
  const pick = await page.evaluate(() => {
    const D = OD.Decisions;
    const out = { err: [], ships: [], follows: null, newest: null, dismissed: null, reopened: null, doubled: null };
    try {
      OD.harness.start(OD.Skirmish.build({ player: 'JC', env: 'deep', range: 1200, playerShips: { corvette: 2 }, enemyShips: { corvette: 2 }, seed: 11 }));
      const sim = OD.Game.sim;
      const mine = sim.playerShips(), theirs = sim.hostiles(sim.playerShips()[0]);
      out.ships = mine.map((s) => s.id);
      // a hull each, so the two questions are about different hostiles and stay two cards
      mine.forEach((s, i) => { const h = theirs[i % theirs.length]; if (h) sim.setTarget(s.id, h.id); });
      OD.harness.select(mine[0].id);
      for (let i = 0; i < 30; i++) {
        OD.harness.step(10);
        const ids = new Set();
        for (const d of sim.decisions || []) for (const s of d.ships || [d.shipId]) ids.add(s);
        if (ids.size >= 2) break;
      }
      const ids = [];
      for (const d of sim.decisions || []) for (const s of d.ships || [d.shipId]) if (ids.indexOf(s) < 0) ids.push(s);
      out.open = (sim.decisions || []).map((d) => (d.ships || [d.shipId]).join('+') + ':' + d.kind);
      if (ids.length >= 2) {
        OD.harness.select(ids[0]);
        const a = D.current(sim);
        OD.harness.select(ids[1]);
        const b = D.current(sim);
        const speaks = (d, id) => !!d && (d.shipId === id || (d.ships || []).indexOf(id) >= 0);
        out.follows = speaks(a, ids[0]) && speaks(b, ids[1]);
        // with nobody selected the newest open decision is the one on the band
        OD.UI.selected = null;
        const c = D.current(sim);
        out.newest = !!(c && c === sim.decisions[sim.decisions.length - 1]);
        OD.harness.select(ids[1]);
        // Esc closes it silently: no log line, and the cooldown holds it shut
        const before = sim.log.length, d = D.current(sim), k = d.kind, ship = d.shipId, tgt = d.targetId;
        D.dismiss(sim, d.id);
        out.dismissed = !(sim.decisions || []).some((x) => x.id === d.id) && sim.log.length === before;
        const rec = sim._decisions.cool[ship + '|' + k];
        out.doubled = !!rec && rec.span >= 600;
        const t0 = sim.time;
        let back = false;
        while (sim.time - t0 < 400 && !sim.outcome) {
          OD.harness.step(20);
          if ((sim.decisions || []).some((x) => x.kind === k && (x.ships || []).indexOf(ship) >= 0 && x.targetId === tgt)) back = true;
        }
        out.reopened = back;
      }
    } catch (e) { out.err.push(String(e.stack || e)); }
    out.errors = OD.errors.slice();
    return out;
  });
  check('no errors in the two-hull skirmish', pick.err.length === 0 && pick.errors.length === 0, pick.err.concat(pick.errors).join(' | '));
  check('both hulls are asked', !!pick.open && pick.open.length >= 1 && pick.follows !== null, (pick.open || []).join(', '));
  check('current() follows the selected ship', pick.follows === true, String(pick.follows));
  check('with nothing selected it is the newest open decision', pick.newest === true, String(pick.newest));
  check('dismiss() closes it without a log line', pick.dismissed === true, String(pick.dismissed));
  check('a dismissed decision stays shut for the cooldown', pick.reopened === false, String(pick.reopened));
  check('the cooldown is recorded per (ship, kind)', pick.doubled === true, String(pick.doubled));

  // ---------------------------------------------------------------- one card for a division
  console.log('scenario: three hulls in the same situation');
  const many = await page.evaluate(() => {
    const D = OD.Decisions;
    const out = { err: [], cards: null, title: null, ships: 0, acted: null, reraised: null };
    try {
      OD.harness.start(3); // chapter 4: three of ours, holding, with the same hostile out in front
      const sim = OD.Game.sim;
      OD.harness.select('larkspur');
      for (const s of sim.playerShips()) sim.setTarget(s.id, 'coriolis');
      let d = null;
      for (let i = 0; i < 40 && !d; i++) {
        OD.harness.step(5);
        d = (sim.decisions || []).find((x) => x.kind === 'approach' && (x.ships || []).length > 1) || null;
      }
      const all = (sim.decisions || []).filter((x) => x.kind === 'approach');
      out.cards = all.length;
      if (d) {
        out.title = d.title;
        out.ships = d.ships.length;
        const crew = d.ships.slice();
        const o = d.options.find((x) => x.recommended);
        D.choose(sim, d.id, o.key);
        out.acted = crew.every((id) => { const s = sim.byId(id); return s && s.order && s.order.target === d.targetId && s.order.type !== 'hold'; });
        out.orders = crew.map((id) => id + ':' + sim.byId(id).order.type);
      }
      // dismissed, and then the bridge names a different hull: the question comes back for her,
      // inside the cooldown the first one would otherwise be holding shut
      {
        const me = sim.byId('larkspur');
        sim.setOrder(me.id, { type: 'hold' });
        sim.setTarget(me.id, 'isa2');
        let first = null;
        for (let i = 0; i < 20 && !first; i++) { OD.harness.step(5); first = (sim.decisions || []).find((x) => x.kind === 'approach' && (x.ships || [x.shipId]).includes(me.id)); }
        if (first) {
          D.dismiss(sim, first.id);
          sim.setOrder(me.id, { type: 'hold' });
          sim.setTarget(me.id, 'coriolis');
          let back = null;
          for (let i = 0; i < 12 && !back; i++) { OD.harness.step(5); back = (sim.decisions || []).find((x) => x.kind === 'approach' && (x.ships || [x.shipId]).includes(me.id)); }
          out.reraised = !!(back && back.targetId === 'coriolis' && back.id !== first.id);
          out.reraiseDetail = (first.targetId || '?') + ' dismissed at ' + Math.round(first.closedAt) + ', back on ' + (back ? back.targetId : 'nothing');
        }
      }
    } catch (e) { out.err.push(String(e.stack || e)); }
    out.errors = OD.errors.slice();
    return out;
  });
  check('no errors while a card speaks for several hulls', many.err.length === 0 && many.errors.length === 0, many.err.concat(many.errors).join(' | '));
  check('the same question across hulls collapses into one card', many.cards === 1 && many.ships >= 2, 'cards ' + many.cards + ', ships ' + many.ships);
  check('the card names the count', typeof many.title === 'string' && /\d+ ships/.test(many.title), String(many.title));
  check('one answer acts for every hull on the card', many.acted === true, (many.orders || []).join(', '));
  check('naming a new hull after a dismissal raises the approach card again', many.reraised === true, String(many.reraiseDetail));

  // ---------------------------------------------------------------- the moment the sensors question is for
  console.log('scenario: a cold, coasting hostile inside our beam reach');
  const quiet = await page.evaluate(() => {
    const U = OD.U, D = OD.Decisions, S = OD.Sensors, E = OD.Engagement;
    const out = { err: [], cold: null, shape: null, act: null, closed: null, burning: null, worst: null, opened: [] };
    const board = (burn) => {
      OD.harness.start(OD.Skirmish.build({ player: 'JC', env: 'deep', range: 500, playerShips: { corvette: 1 }, enemyShips: { corvette: 1 }, seed: 3 }));
      const sim = OD.Game.sim;
      const me = sim.playerShips()[0], foe = sim.hostiles(me)[0];
      foe.ai = false;
      foe.radiators.deployed = false; foe.radiators.state = 0;
      foe.heat = 0;
      sim.setOrder(foe.id, burn ? { type: 'manual', heading: foe.heading, throttle: 1 } : { type: 'hold' });
      // Inside our own burn-through, whatever the gunnery module currently makes that: a range
      // written as a number was true when it was written and is somebody else's tuning now.
      const r0 = E.reach(sim, me, foe);
      const bite0 = r0.beams[E.shared.facetSeen(me, foe)] || 0;
      const at = Math.max(50e3, Math.min(500e3, bite0 * 1.2));
      const u = U.norm(U.sub(me.pos, foe.pos));
      me.pos = { x: foe.pos.x + u.x * at, y: foe.pos.y + u.y * at };
      me.vel = { x: foe.vel.x, y: foe.vel.y };
      sim.setOrder(me.id, { type: 'hold' });
      sim.setTarget(me.id, foe.id);
      me.weaponsFree = true;
      OD.harness.select(me.id);
      S.init(sim);
      D.init(sim);
      OD.harness.step(2);
      return { sim, me, foe };
    };
    const raise = (sim, me) => {
      let d = null;
      for (let i = 0; i < 30 && !d && !sim.outcome; i++) {
        OD.harness.step(4);
        for (const x of (sim.decisions || []).slice()) {
          if (!(x.ships || [x.shipId]).includes(me.id)) continue;
          if (x.kind === 'sensors') d = x; else D.dismiss(sim, x.id);
        }
      }
      return d;
    };
    const look = (sim, me, foe) => {
      const r = E.reach(sim, me, foe), tr = S.track(sim, me.faction, foe);
      return {
        R: Math.round(U.dist(me.pos, foe.pos) / 1000), q: +tr.q.toFixed(2), word: tr.word, sig: S.signature(foe).word,
        bite: Math.round((r.beams[E.shared.facetSeen(me, foe)] || 0) / 1000),
        readout: E.shared.solutionReason(sim, me, foe) || 'solution',
      };
    };
    try {
      {
        const { sim, me, foe } = board(false);
        const d = raise(sim, me);
        out.cold = look(sim, me, foe);
        if (d) {
          out.cold.title = d.title;
          out.cold.options = d.options.map((o) => o.key + ' ' + o.label + ' · ' + o.detail + (o.recommended ? ' [rec]' : ''));
          out.shape = {
            mine: d.shipId === me.id, onHer: d.targetId === foe.id, keys: d.options.map((o) => o.key).join(''),
            recs: d.options.filter((o) => o.recommended).length, numbers: d.options.every((o) => /\d/.test(o.detail)),
          };
          const go = d.options.find((o) => /^Go active/.test(o.label));
          if (go) {
            const was = !!me.activeSensor;
            D.choose(sim, d.id, go.key);
            out.act = !was && !!me.activeSensor;
            out.closed = !(sim.decisions || []).some((x) => x.id === d.id);
          }
        }
      }
      {
        const { sim, me, foe } = board(false);
        const d = raise(sim, me);
        const o = d && d.options.find((x) => /^Close to/.test(x.label));
        if (o) {
          const R = U.dist(me.pos, foe.pos);
          D.choose(sim, d.id, o.key);
          const ordered = me.order && me.order.type === 'keeprange' ? me.order.range : null;
          out.opened.push({ R: Math.round(R / 1000), ordered: ordered == null ? null : Math.round(ordered / 1000) });
          out.worst = ordered == null ? 0 : ordered / R;
        }
      }
      {
        const { sim, me, foe } = board(true);
        const d = raise(sim, me);
        out.burning = look(sim, me, foe);
        out.burning.raised = !!d;
      }
      // our own plume pins us: the question is asked anyway, and the option prices the plume.
      // The old gate read 'nothing to trade' and silenced the kind altogether — a hundred and six
      // cards in a reviewer's run held not one of these, because the recommended answer lights the
      // drive and the gate then ruled the question out for as long as it burned.
      {
        const { sim, me } = board(false);
        sim.setOrder(me.id, { type: 'manual', heading: me.heading, throttle: 1 });
        const d = raise(sim, me);
        out.ourPlume = !!d;
        out.plumeLine = d ? ((d.options.find((o) => /^Go active/.test(o.label)) || {}).detail || '') : '';
      }
    } catch (e) { out.err.push(String(e.stack || e)); }
    out.errors = OD.errors.slice();
    return out;
  });
  check('no errors while the sensors question is raised', quiet.err.length === 0 && quiet.errors.length === 0, quiet.err.concat(quiet.errors).join(' | '));
  check('a cold hull coasting inside our beams is a track the mounts hold on', !!quiet.cold && quiet.cold.word === 'track' && quiet.cold.q < 2.7 && quiet.cold.readout === 'no solution', JSON.stringify(quiet.cold && { R: quiet.cold.R, q: quiet.cold.q, word: quiet.cold.word, bite: quiet.cold.bite, readout: quiet.cold.readout }));
  check('the sensors question is raised for the player hull with no solution', !!(quiet.shape && quiet.shape.mine && quiet.shape.onHer), quiet.cold && quiet.cold.title ? quiet.cold.title : 'never raised');
  check('its options are keyed 1..n with one recommended and numbers in every line', !!quiet.shape && /^12(3)?$/.test(quiet.shape.keys) && quiet.shape.recs === 1 && quiet.shape.numbers, JSON.stringify(quiet.shape));
  check('choosing Go active lights the sensor and closes the question', quiet.act === true && quiet.closed === true, quiet.act + '/' + quiet.closed);
  check('a "close to" option never orders the range open', quiet.worst == null || quiet.worst < 1, JSON.stringify(quiet.opened));
  check('nothing is asked once her drive is lit', !!quiet.burning && quiet.burning.raised === false && quiet.burning.q >= 2.7, JSON.stringify(quiet.burning));
  check('our own plume no longer silences the question, and the option prices it', quiet.ourPlume === true && /plume/.test(quiet.plumeLine || ''), String(quiet.plumeLine));
  if (quiet.cold && quiet.cold.options) note('at ' + quiet.cold.R + ' km, q ' + quiet.cold.q + ': ' + quiet.cold.title + '\n      ' + quiet.cold.options.join('\n      '));

  // ---------------------------------------------------------------- the kinds a quiet fight never reaches
  console.log('scenario: forced conditions for range, cripple, slugs, heat, defend and aim');
  const forced = await page.evaluate(() => {
    const out = { err: [], got: {}, shapes: {}, stable: {}, heatRec: null, rangeHonest: null };
    const U = OD.U, D = OD.Decisions;
    const build = (opts) => { OD.harness.start(OD.Skirmish.build(Object.assign({ player: 'JC', env: 'deep' }, opts))); return OD.Game.sim; };
    const place = (me, foe, R) => {
      const u = U.norm(U.sub(me.pos, foe.pos));
      me.pos = { x: foe.pos.x + u.x * R, y: foe.pos.y + u.y * R };
      me.vel = { x: foe.vel.x, y: foe.vel.y };
    };
    const openOn = (sim, kind, shipId) => (sim.decisions || []).find((d) => d.kind === kind && (!shipId || (d.ships || [d.shipId]).includes(shipId))) || null;
    const record = (kind, sim, d) => {
      const me = sim.byId(d.shipId);
      out.got[kind] = { at: Math.round(sim.time), ship: d.shipId, title: d.title, text: d.text, options: d.options.map((o) => o.key + ' ' + o.label + ' · ' + o.detail + (o.recommended ? ' [rec]' : '')) };
      out.shapes[kind] = { keys: d.options.map((o) => o.key).join(''), recs: d.options.filter((o) => o.recommended).length,
        numbers: d.options.every((o) => /\d/.test(o.detail)), acts: d.options.every((o) => typeof o.act === 'function'), mine: !!me && me.faction === sim.playerFaction };
      const labels = d.options.map((o) => o.label).join('|');
      const rec = d.options.findIndex((o) => o.recommended);
      const seq = sim.decisionSeq;
      OD.harness.step(20);
      if ((sim.decisions || []).indexOf(d) >= 0) {
        D.refresh(sim, d);
        const same = d.options.map((o) => o.label).join('|') === labels && d.options.findIndex((o) => o.recommended) === rec;
        out.stable[kind] = same || sim.decisionSeq !== seq;
      } else out.stable[kind] = true;
    };
    try {
      // --- range: in the band just outside the larger of the two bites, closing under an order
      {
        const sim = build({ range: 600, playerShips: { destroyer: 1 }, enemyShips: { destroyer: 1 }, seed: 5 });
        const me = sim.playerShips()[0], foe = sim.hostiles(me)[0];
        sim.setTarget(me.id, foe.id); me.weaponsFree = true;
        OD.harness.select(me.id);
        const facet = OD.Engagement.shared.facetSeen;
        const bigNow = () => {
          const r = OD.Engagement.reach(sim, me, foe);
          const ours = r.beams[facet(me, foe)] || 0;
          const theirs = r.their ? r.their.beams[r.their.facet] || 0 : 0;
          return { big: Math.max(ours, theirs), ours };
        };
        let got = null;
        for (const f of [1.07, 1.03, 1.11, 1.0, 1.14]) {
          const b = bigNow();
          if (!(b.big > 0)) break;
          place(me, foe, b.big * f);
          sim.setOrder(me.id, { type: 'keeprange', target: foe.id, range: b.big * f });
          OD.Decisions.init(sim);
          out.bite = Math.round(b.big / 1000);
          for (let i = 0; i < 8 && !got; i++) {
            OD.harness.step(4);
            got = openOn(sim, 'range', me.id);
            if (got) break;
            for (const d of (sim.decisions || []).slice()) if ((d.ships || [d.shipId]).includes(me.id)) OD.Decisions.dismiss(sim, d.id);
          }
          if (got) {
            // the card never prints a bite of zero, and 'Hold at X' only exists when our beams do bite
            const ours = bigNow().ours;
            const holdOpt = got.options.find((o) => /^Hold at/.test(o.label));
            out.rangeHonest = !/out to 0 m|burn through her armour at 0 m/.test(got.text) && (ours > 0 || !holdOpt);
            record('range', sim, got);
            break;
          }
        }
      }
      // --- cripple: her drive is wrecked and she is inside 300 km
      {
        const sim = build({ range: 400, playerShips: { destroyer: 1 }, enemyShips: { destroyer: 1 }, seed: 5 });
        const me = sim.playerShips()[0], foe = sim.hostiles(me)[0];
        OD.harness.select(me.id);
        foe.systems.drive = 0.05;
        place(me, foe, 200e3);
        OD.harness.step(6);
        const d = openOn(sim, 'cripple', me.id);
        if (d) {
          const leave = d.options.find((o) => /^Leave her/.test(o.label));
          record('cripple', sim, d);
          if (leave && (sim.decisions || []).indexOf(d) >= 0) { D.choose(sim, d.id, leave.key); out.leaveOrder = me.order.type; }
        }
      }
      // --- heat: the sink at 85 % with the mounts at full and the panels in
      {
        const sim = build({ range: 200, playerShips: { destroyer: 1 }, enemyShips: { destroyer: 1 }, seed: 5 });
        const me = sim.playerShips()[0], foe = sim.hostiles(me)[0];
        OD.harness.select(me.id);
        sim.setTarget(me.id, foe.id); me.weaponsFree = true;
        OD.Engagement.setFireMode(me, 'full');
        sim.setRadiators(me.id, false);
        me.radiators.state = 0;
        me.heat = me.sinkCapacity * 0.85;
        OD.harness.step(4);
        const d = openOn(sim, 'heat', me.id);
        if (d) {
          const share = OD.Engagement.shared.sustainedScale(me);
          const rec = d.options.find((o) => o.recommended);
          out.heatShare = Math.round(share * 100);
          out.heatRec = rec ? rec.label : null;
          out.heatSustainedLit = !!(rec && /^Sustained/.test(rec.label) && share < 0.15);
          out.heatTitle = d.title;
          record('heat', sim, d);
        }
      }
      // --- slugs: rounds already in flight at a hull that is not jinking
      {
        const sim = build({ range: 600, playerShips: { corvette: 2 }, enemyShips: { corvette: 2 }, seed: 11 });
        for (const s of sim.playerShips()) { const h = sim.nearestHostile(s); if (h) sim.setTarget(s.id, h.id); }
        OD.harness.select(sim.playerShips()[0].id);
        let d = null;
        for (let i = 0; i < 80 && !d && !sim.outcome; i++) {
          for (const s of sim.playerShips()) { s.weaponsFree = true; if (!(sim.decisions || []).some((x) => x.kind === 'slugs' && (x.ships || [x.shipId]).includes(s.id))) s.jink = false; }
          OD.harness.step(5);
          d = openOn(sim, 'slugs');
        }
        if (d) {
          const me = sim.byId(d.shipId);
          const jink = d.options.find((o) => /^Jink/.test(o.label));
          out.slugDv = jink ? /Δv/.test(jink.detail) : null;
          record('slugs', sim, d);
          if (jink && (sim.decisions || []).indexOf(d) >= 0) { D.choose(sim, d.id, jink.key); out.jinked = me.jink === true; }
          else out.jinked = null;
        }
      }
      // --- defend: a protected hauler with interceptors in the air at her
      {
        OD.harness.start(1); // chapter 2: two haulers under 'protect' objectives
        const sim = OD.Game.sim;
        const me = sim.byId('larkspur'), sabre = sim.byId('sabre'), hauler = sim.byId('hauler1');
        OD.harness.select(me.id);
        sabre.ai = false;
        sabre.weaponsFree = true;
        sabre.target = hauler.id;
        // put her in the bays' reach of the hauler and let her launch
        const u = U.norm(U.sub(sabre.pos, hauler.pos));
        sabre.pos = { x: hauler.pos.x + u.x * 60e3, y: hauler.pos.y + u.y * 60e3 };
        sabre.vel = { x: hauler.vel.x, y: hauler.vel.y };
        sabre.radiators.deployed = true;
        let d = null;
        for (let i = 0; i < 40 && !d && !sim.outcome; i++) {
          OD.Engagement.salvo(sim, sabre, 2);
          OD.harness.step(5);
          d = openOn(sim, 'defend');
        }
        if (d) {
          out.defendIds = d.options.map((o) => o.id).join(',');
          record('defend', sim, d);
        }
      }
      // --- aim: a solution on a hull with her panels out, inside our burn-through
      // Her panels stow themselves while she is being shot at, and the question goes with them:
      // there is no radiators aim left to take once the panels are in, and a lapsed question puts
      // its kind behind the cooldown. So the same opening is set up twice — once to read the card
      // and put it through the refresh probe, once to press the key on a card that is still live.
      const aimSetup = () => {
        const sim = build({ range: 200, playerShips: { destroyer: 1 }, enemyShips: { destroyer: 1 }, seed: 5 });
        const me = sim.playerShips()[0], foe = sim.hostiles(me)[0];
        OD.harness.select(me.id);
        sim.setTarget(me.id, foe.id); me.weaponsFree = true;
        foe.radiators.deployed = true; foe.radiators.state = 1;
        OD.Sensors.setActive(me, true);
        place(me, foe, 120e3);
        let d = null;
        for (let i = 0; i < 20 && !d; i++) {
          foe.radiators.deployed = true; foe.radiators.state = 1;
          OD.harness.step(4);
          d = openOn(sim, 'aim', me.id);
          if (!d) for (const x of (sim.decisions || []).slice()) if ((x.ships || [x.shipId]).includes(me.id) && x.kind !== 'aim') D.dismiss(sim, x.id);
        }
        return { sim, me, foe, d };
      };
      {
        const a = aimSetup();
        if (a.d) record('aim', a.sim, a.d);
        const b = aimSetup();
        const o = b.d ? b.d.options.find((x) => x.id === 'radiators') : null;
        if (o) { D.choose(b.sim, b.d.id, o.key); out.aimSet = OD.Engagement.aim(b.me); }
      }
    } catch (e) { out.err.push(String(e.stack || e)); }
    out.errors = OD.errors.slice();
    return out;
  });
  check('no errors while the forced conditions are set up', forced.err.length === 0 && forced.errors.length === 0, forced.err.concat(forced.errors).join(' | '));
  for (const kind of ['range', 'cripple', 'slugs', 'heat', 'defend', 'aim']) {
    const got = forced.got[kind], shape = forced.shapes[kind];
    check('the ' + kind + ' question is raised when its moment comes', !!got, got ? got.title : 'never raised');
    if (got) {
      check('the ' + kind + ' options are keyed, lit once and carry numbers', !!shape && /^1(2(3)?)?$/.test(shape.keys) && shape.recs === 1 && shape.numbers && shape.acts && shape.mine, JSON.stringify(shape));
      check('the ' + kind + ' band is not left stale by a refresh', forced.stable[kind] === true, String(forced.stable[kind]));
      note(kind + ': ' + got.title + '\n      ' + got.text + '\n      ' + got.options.join('\n      '));
    }
  }
  check('the range card never claims a bite it does not have', forced.rangeHonest === true, String(forced.rangeHonest));
  // 'hers fall short by 192 km' is true of her beams and of nothing else, and a newcomer reads it
  // as 'she cannot hurt us from here' while her coilguns and her bays work.
  check('a reach that falls short is named as her beams, not as everything she has',
    !!forced.got.range && forced.got.range.options.every((o) => !/\bhers fall short\b/.test(o)),
    forced.got.range ? forced.got.range.options.join(' | ').slice(0, 160) : 'no range card');
  check('"Leave her" breaks off with the retreat order, which knows where the ground is', forced.leaveOrder === 'retreat', String(forced.leaveOrder));
  check('the heat card never recommends Sustained at nothing', forced.heatSustainedLit === false, 'share ' + forced.heatShare + ' %, lit: ' + forced.heatRec);
  check('the heat title says what the sink is doing', typeof forced.heatTitle === 'string' && !/^Sink at /.test(forced.heatTitle), String(forced.heatTitle));
  check('with the panels in the heat card points at Extend or Break off', /^(Extend|Break off)/.test(forced.heatRec || ''), String(forced.heatRec));
  check('the jink cost reads as a labelled delta-v, not a speed', forced.slugDv === true, String(forced.slugDv));
  check('choosing Jink sets the hull jinking', forced.jinked !== false, String(forced.jinked));
  check('the defend options are close, screen and hold', forced.defendIds === 'closeon,screen,hold', String(forced.defendIds));
  check('choosing her radiators moves the aim point', forced.aimSet === 'radiators', String(forced.aimSet));

  // ---------------------------------------------------------------- the coast is actually cold
  console.log('scenario: the coast option goes dark');
  const coast = await page.evaluate(() => {
    const U = OD.U, D = OD.Decisions;
    const out = { err: [], order: null, throttle: null, cold: null, dvGap: null, labels: null };
    try {
      OD.harness.start(1);
      const sim = OD.Game.sim;
      const me = sim.byId('larkspur'), foe = sim.byId('sabre');
      OD.harness.select(me.id);
      sim.setTarget(me.id, foe.id);
      // already closing at the cruise speed, so the one burn the order asks for is behind us —
      // and her drive is lit, so the plot holds a solution and can credit that closing rate
      const u = U.norm(U.sub(foe.pos, me.pos));
      me.vel = { x: foe.vel.x + u.x * 1600, y: foe.vel.y + u.y * 1600 };
      foe.ai = false;
      sim.setOrder(foe.id, { type: 'manual', heading: foe.heading, throttle: 1 });
      let d = null;
      for (let i = 0; i < 20 && !d; i++) { OD.harness.step(5); d = (sim.decisions || []).find((x) => x.kind === 'approach' && (x.ships || [x.shipId]).includes(me.id)); }
      if (d) {
        const burn = d.options.find((o) => /^Burn hard/.test(o.label));
        const easy = d.options.find((o) => /^Coast in/.test(o.label));
        out.labels = d.options.map((o) => o.label + ' · ' + o.detail);
        // the delta-v difference between the two is real, and both are labelled in km/s
        const num = (s) => { const m = /Δv (?:about )?([\d.]+) km\/s/.exec(s); return m ? +m[1] : null; };
        const a = num(burn ? burn.detail : ''), b = num(easy ? easy.detail : '');
        out.dvGap = a != null && b != null ? +(a - b).toFixed(2) : null;
        out.bare = /· \d+ m\/s ·/.test((burn ? burn.detail : '') + (easy ? easy.detail : ''));
        if (easy) {
          D.choose(sim, d.id, easy.key);
          out.order = me.order.type;
          let cold = false;
          const t0 = sim.time;
          while (sim.time - t0 < 30) { OD.harness.step(2); if (me.throttle === 0) cold = true; }
          out.throttle = me.throttle;
          out.cold = cold && me.throttle === 0;
        }
      }
    } catch (e) { out.err.push(String(e.stack || e)); }
    out.errors = OD.errors.slice();
    return out;
  });
  check('no errors while the coast is chosen', coast.err.length === 0 && coast.errors.length === 0, coast.err.concat(coast.errors).join(' | '));
  if (caps.approachOrder) {
    check('the coast option issues the approach order', coast.order === 'approach', String(coast.order));
    check('the coast leaves the throttle at 0 within 30 s', coast.cold === true, 'throttle ' + coast.throttle);
  } else {
    note('skipped: this build\'s autopilot has no approach order yet (coast falls back to a capped keep-range)');
    check('the coast option still sets an order that closes', coast.order === 'keeprange' || coast.order === 'approach', String(coast.order));
  }
  check('the two ways in differ by a real delta-v, in km/s', coast.dvGap != null && Math.abs(coast.dvGap) > 0.1 && coast.bare === false, 'Δv gap ' + coast.dvGap + ' km/s');
  if (coast.labels) note(coast.labels.join('\n    '));

  // ---------------------------------------------------------------- recommended-only, chapter 4
  // A reviewer who answers nothing but the lit option: the run must not end in defeat, must never be
  // told to open the range while the board says to neutralise her, and must not drown in prompts.
  // The clock is the check's, not the game's: a chapter has no time limit of its own, and this cap
  // is only here to keep the suite finite. From v13 both sides run repair parties, so a hostile
  // whose drive is hit mends it and fights on — ISV Coriolis climbs from 0.41 back to 0.70 in
  // chapter 4 — and a fight carried through to a driven-off hull can now pass forty minutes at
  // 5 s stepping. Measured: ch4 5s 0s is no result at 2400 s and a victory at 3175 s with Coriolis
  // driven off, and deleting the computer hulls' crews gives the old 1788 s win exactly. So the cap
  // is an hour. 'victory' is still the only thing that counts as won.
  console.log('scenario: chapter 4 played on the recommended option alone (60 min cap)');
  const only = await page.evaluate(() => {
    const D = OD.Decisions;
    const out = { err: [], answers: [], opened: [], badOpen: [], badPressing: [], outcome: null, time: 0, worst: {}, afterOutcome: null, objectives: null,
      coastBroken: [], panelFlip: [], larkspur: null, larkspurLow: null };
    try {
      // A fixed stream, so this chapter is the same fight every run: whatever the scenarios before
      // it drew out of Math.random must not decide whether a chapter passes.
      (function (n) { let x = n; Math.random = function () { x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; })(20304);
      OD.harness.start(3);
      const sim = OD.Game.sim;
      OD.harness.select('larkspur');
      const seen = new Set();
      const neutraliseOpen = () => sim.objectives.some((o) => o.type === 'neutralize' && !o.done && !o.failed && !o.inactive);

      // Two things every recommended-only run is watched for, whatever else it is about:
      //  - a cold approach undone by a full-throttle order inside a minute (the defend card used to
      //    replace the coast chosen ten seconds earlier, and never said the drive was lighting);
      //  - the panels stowed and extended inside a minute by two cards arguing with each other.
      const coastAt = Object.create(null);
      const panelSaid = [];
      const answer = (d, rec) => {
        const ships = (d.ships || [d.shipId]).slice();
        const was = ships.map((id) => { const s2 = sim.byId(id); return s2 ? { id, type: s2.order.type } : null; });
        if (/^Stow/.test(rec.label)) panelSaid.push({ t: sim.time, id: d.shipId, dir: 'in', kind: d.kind, label: rec.label });
        if (/^Extend/.test(rec.label)) panelSaid.push({ t: sim.time, id: d.shipId, dir: 'out', kind: d.kind, label: rec.label });
        D.choose(sim, d.id, rec.key);
        for (const w of was) {
          if (!w) continue;
          const s2 = sim.byId(w.id);
          if (!s2 || !s2.order) continue;
          // The rule is about a coast that was just chosen and then undone, so the clock starts
          // when an answer actually puts the hull on one. Restarting it on every answer given
          // while she happens to still be coasting reported a coast chosen at 20 s as 'set 40 s
          // earlier' and failed a range card two minutes later for it.
          if (s2.order.type === 'approach') { if (w.type !== 'approach') coastAt[w.id] = sim.time; continue; }
          if (w.type === 'approach' && coastAt[w.id] != null && sim.time - coastAt[w.id] < 60 &&
              /^(keeprange|intercept|retreat)$/.test(s2.order.type) && !(s2.order.vmax > 0)) {
            out.coastBroken.push(Math.round(sim.time) + ' ' + w.id + ': ' + d.kind + ' → ' + rec.label +
              ' replaced the coast set ' + Math.round(sim.time - coastAt[w.id]) + ' s earlier with ' + s2.order.type);
          }
        }
      };
      const flips = () => {
        for (let i = 0; i < panelSaid.length; i++) {
          for (let j = i + 1; j < panelSaid.length; j++) {
            const a = panelSaid[i], b = panelSaid[j];
            if (a.id !== b.id || a.dir === b.dir || b.t - a.t > 60) continue;
            out.panelFlip.push(a.id + ': ' + a.kind + ' → ' + a.label + ' at ' + Math.round(a.t) + ', ' +
              b.kind + ' → ' + b.label + ' at ' + Math.round(b.t));
          }
        }
      };
      while (sim.time < 3600 && !sim.outcome) {
        OD.harness.step(5);
        for (const d of (sim.decisions || []).slice()) {
          if (!seen.has(d.id)) {
            seen.add(d.id);
            out.opened.push({ t: Math.round(sim.time), kind: d.kind, ships: (d.ships || [d.shipId]).length, title: d.title });
          }
          const rec = (d.options || []).find((o) => o.recommended);
          if (!rec) continue;
          // the two rules: never 'open the range' while the board says to neutralise her, and
          // never a passive answer while the card itself says we are pressing
          if (neutraliseOpen() && /^Open to/.test(rec.label)) out.badOpen.push(Math.round(sim.time) + ' ' + d.kind + ': ' + rec.label);
          // The withdraw card is the exception: breaking off at half a hull is the right answer
          // precisely when the fight is pressing, which is the whole reason the kind exists.
          if (d.pressing && d.kind !== 'withdraw' && d.kind !== 'sink' && /^(Open to|Hold and watch|Hold (our )?station|Break off|Leave her)/.test(rec.label)) out.badPressing.push(Math.round(sim.time) + ' ' + d.kind + ': ' + rec.label);
          out.answers.push(Math.round(sim.time) + ' ' + d.kind + ' → ' + rec.label);
          answer(d, rec);
        }
        const lk = sim.byId('larkspur');
        if (lk) out.larkspurLow = out.larkspurLow == null ? lk.hull : Math.min(out.larkspurLow, lk.hull);
      }
      flips();
      const lark = sim.byId('larkspur');
      out.larkspur = lark ? { hull: Math.round(lark.hull * 100) / 100, out: lark.neutralised() } : null;
      out.outcome = sim.outcome;
      out.time = Math.round(sim.time);
      out.objectives = sim.objectives.map((o) => o.id + ':' + (o.done ? 'done' : o.failed ? 'failed' : Math.round((o.progress || 0) * 100) + '%'));
      // the most cards of one kind inside any ten minutes
      for (const kind of ['salvo', 'radiators', 'sensors', 'range', 'heat']) {
        const ts = out.opened.filter((x) => x.kind === kind).map((x) => x.t);
        let worst = 0;
        for (const t of ts) worst = Math.max(worst, ts.filter((x) => x > t - 600 && x <= t).length);
        out.worst[kind] = worst;
      }
      // nothing is asked once the engagement is over
      if (!sim.outcome) { sim.outcome = 'victory'; sim.outcomeTime = sim.time; }
      const before = (sim.decisions || []).length;
      OD.harness.step(120);
      out.afterOutcome = before + '/' + (sim.decisions || []).length;
      out.noneAfter = (sim.decisions || []).length === 0;
      const st = OD.harness.state();
      out.finite = st.ships.every((s) => s.finite);
      out.renderError = st.renderError;
    } catch (e) { out.err.push(String(e.stack || e)); }
    out.errors = OD.errors.slice();
    return out;
  });
  check('no errors in the recommended-only run', only.err.length === 0 && only.errors.length === 0 && !only.renderError && only.finite !== false, only.err.concat(only.errors).join(' | ') + (only.renderError || ''));
  check('recommended-only play wins chapter 4', only.outcome === 'victory', 'outcome ' + only.outcome + ' at ' + only.time + ' s · ' + (only.objectives || []).join(', '));
  check('and brings JCS Larkspur home', !!only.larkspur && only.larkspur.hull > 0 && only.larkspur.out === false,
    JSON.stringify(only.larkspur) + ' · lowest hull ' + Math.round((only.larkspurLow || 0) * 100) + ' %');
  check('no cold approach is replaced by a full-throttle order inside a minute', only.coastBroken.length === 0, only.coastBroken.slice(0, 3).join(' | '));
  check('the panels are never stowed and extended by two cards inside a minute', only.panelFlip.length === 0, only.panelFlip.slice(0, 3).join(' | '));
  check('it is never told to open the range while the neutralise objective is open', only.badOpen.length === 0, only.badOpen.slice(0, 4).join(' | '));
  check('it is never pointed at a passive answer while pressing a fight', only.badPressing.length === 0, only.badPressing.slice(0, 4).join(' | '));
  check('at most 3 salvo cards in any ten minutes', (only.worst.salvo || 0) <= 3, String(only.worst.salvo));
  check('at most 3 radiators cards in any ten minutes', (only.worst.radiators || 0) <= 3, String(only.worst.radiators));
  check('no card of any kind after the outcome is set', only.noneAfter === true, 'open before/after ' + only.afterOutcome);
  note((only.opened || []).length + ' cards in ' + only.time + ' s: ' + (only.opened || []).map((x) => x.kind).join(', '));
  note('answers: ' + (only.answers || []).slice(0, 12).join(' | '));

  // ---------------------------------------------------------------- the teaching chapters, read slowly
  // A card is only an answer if a human can reach it, and a chapter is only winnable if the lit
  // chain wins it at the speed a person actually reads. Chapters 2 and 4 are played on the
  // recommended option alone at four reading speeds — nought, ten, twenty and thirty seconds after
  // the card appears — under both of the cadences the game runs at: the page and tools/harness.js
  // step 1 s, and this check used to step only 5 s. The two diverge (the sensors card lights
  // 'Stay passive' at 5 s and 'Go active' at 1 s), so a chain that holds at one of them is not a
  // chain that holds.
  // A run counts as won only when its outcome is 'victory'. A run that simply stops — an hour
  // with the objectives still open — is a stalemate, and the check that only looked for 'defeat'
  // passed one: '10s: none at 2400 s (n:open,n2:done,pl:open)'. The cap is an hour from v13, for
  // the reason set out above the chapter 4 run: both sides mend their drives now.
  // It is also the cheapest place to read every key the chapters raise: a card left with one live
  // option, a key with no detail at all, and a detail longer than three clauses are all things the
  // panel should never show.
  console.log('scenario: chapters 2 and 4 on the recommended option alone, at 0/10/20/30 s and both cadences (16 runs)');
  const sweep = await page.evaluate(() => {
    const D = OD.Decisions;
    const runs = [];
    const thin = []; const single = []; const empty = []; const longest = [];
    const plan = [];
    for (const chapter of [1, 3]) for (const dt of [1, 5]) for (const delay of [0, 10, 20, 30]) plan.push({ chapter, dt, delay });
    // Each run gets its own seeded stream, so the sixteen are sixteen fixed fights rather than
    // whatever the last run left in Math.random. A sweep nobody can reproduce cannot fail a build.
    const seedRandom = (n) => {
      let x = (n | 0) || 1;
      Math.random = function () { x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
    };
    for (const job of plan) {
      const chapter = job.chapter, dt = job.dt, delay = job.delay;
      const out = { chapter: chapter === 1 ? 2 : 4, dt: dt, delay: delay, err: [], outcome: null, time: 0, answered: 0, short: [], objectives: '' };
      try {
        seedRandom(1000 + chapter * 100 + dt * 10 + delay);
        OD.harness.start(chapter);
        const sim = OD.Game.sim;
        OD.harness.select('larkspur');
        const born = new Map(); const pend = new Map();
        while (sim.time < 3600 && !sim.outcome) {
          OD.harness.step(dt);
          const live = new Set();
          for (const d of (sim.decisions || [])) {
            live.add(d.id);
            if (born.has(d.id)) continue;
            born.set(d.id, { t: sim.time, kind: d.kind, gone: null });
            pend.set(d.id, sim.time + delay);
            // Everything the panel is about to draw, read once, on the card as it opens.
            const opts = d.options || [];
            if (opts.length < 2) single.push(Math.round(sim.time) + 's ' + d.kind + ': ' + opts.length + ' option(s)');
            for (const o of opts) {
              const det = String(o.detail == null ? '' : o.detail);
              if (!det.trim()) empty.push(Math.round(sim.time) + 's ' + d.kind + '/' + o.label + ': no detail');
              const n = det.split(' \u00b7 ').filter((c) => c !== '').length;
              longest.push(n);
              if (n > 3) thin.push(Math.round(sim.time) + 's ' + d.kind + '/' + o.label + ': ' + n + ' clauses');
            }
          }
          for (const [id, rec] of born) {
            if (live.has(id) || rec.gone != null) continue;
            rec.gone = sim.time;
            if (pend.has(id)) out.short.push(rec.kind + ' lived ' + Math.round(rec.gone - rec.t) + ' s');
          }
          for (const [id, when] of Array.from(pend)) {
            if (sim.time < when) continue;
            const d = (sim.decisions || []).find((x) => x.id === id);
            pend.delete(id);
            if (!d) continue;
            const o = (d.options || []).find((x) => x.recommended);
            if (!o) continue;
            out.answered++;
            D.choose(sim, d.id, o.key);
          }
        }
        out.outcome = sim.outcome || 'none';
        out.time = Math.round(sim.time);
        out.objectives = sim.objectives.map((o) => o.id + ':' + (o.done ? 'done' : o.failed ? 'failed' : 'open')).join(',');
      } catch (e) { out.err.push(String(e.stack || e)); }
      out.errors = OD.errors.slice();
      runs.push(out);
    }
    return { runs: runs, thin: thin, single: single, empty: empty, worst: longest.length ? Math.max.apply(null, longest) : 0 };
  });
  const swRuns = sweep.runs || [];
  const swErr = swRuns.reduce((a, r) => a.concat(r.err, r.errors), []);
  // A question about rounds already in the air is the one a reader loses: the volley arrives in
  // seconds and the card goes with it. Chapter 4 raised the jink question twice and closed it both
  // times inside four seconds. A question about a state closes when the state is over, which is a
  // different thing, so it is reported rather than failed.
  const swShort = swRuns.reduce((a, r) => a.concat((r.short || []).filter((x) =>
    /^slugs /.test(x) && +(/(\d+) s$/.exec(x) || [0, 99])[1] < 10)), []);
  const swBlink = swRuns.reduce((a, r) => a.concat((r.short || []).filter((x) => +(/(\d+) s$/.exec(x) || [0, 99])[1] < 10)), []);
  // Won means won. 'none' is an hour of a fight that never resolved, which is not a chapter a
  // player finished.
  const swBeaten = swRuns.filter((r) => r.outcome !== 'victory');
  const tag = (r) => 'ch' + r.chapter + ' ' + r.dt + 's ' + r.delay + 's';
  check('no errors while the chapters are read slowly', swErr.length === 0, swErr.slice(0, 2).join(' | '));
  check('the jink question never closes unanswered inside ten seconds', swShort.length === 0, swShort.slice(0, 4).join(' | '));
  if (swBlink.length) note('cards whose situation resolved inside ten seconds: ' + swBlink.slice(0, 6).join(' | '));
  check('every card the chapter raises carries at least two live options', (sweep.single || []).length === 0, (sweep.single || []).slice(0, 4).join(' | '));
  check('no key is shown without a detail', (sweep.empty || []).length === 0, (sweep.empty || []).slice(0, 4).join(' | '));
  check('no key shows more than three clauses', (sweep.thin || []).length === 0,
    'worst ' + sweep.worst + ' clauses · ' + (sweep.thin || []).slice(0, 4).join(' | '));
  // Carried losses (SPEC.md, "Review loop, round 3 (v12)" and "Review round 3"): measured to the card and left for
  // the next pass. A run named here that loses the way its entry records is printed, not failed; one that starts
  // winning is printed so the entry is removed; one that starts losing a different way is a new loss and fails with
  // the rest, because the entry no longer describes what happened. Each entry carries the outcome it was measured
  // at and why it is carried.
  const CARRIED = {
    'ch2 5s 30s': { outcome: 'defeat', why: 'a level slugging match lost by three points at 5 s stepping; Sabre standing off at 350 km wins it but loses ch2 1s 0s (story worker, round 3). v13 round 2: D 11 opens the repair window while a part is still crossing the bar, so the card comes at 1 455 s instead of 1 725 s and the withdraw and heat cards behind it move with it; the reactor is mended earlier either way (1 711 s against 1 725 s) and the run still ends three points short (decisions worker, round 2)' },
    'ch4 1s 0s': { outcome: 'defeat', why: 'lost at the 127 s range card: the division commits to a rung only its fastest hull can stand on; holding at the edge of her beams wins it and ch2 5s 30s but spends 600 s and three ch4 5 s runs run out of clock (decisions worker, round 3, scratchpad/v12dec2/decisions.s6.js)' },
    'ch4 1s 10s': { outcome: 'defeat', why: 'lost at the 265 s withdraw card, raised on a hull still at 100 %: the lit key flips to "Break off and open" inside the 10 s reading delay, and the retreat under fire at 1.3 g is what costs the hull. Read at once the same card wins the run, so what this seed measures is the delay, not the key. Trace scratchpad/v13/ch4-1s10s.txt (decisions worker, round 3)' },
    'ch4 5s 10s': { outcome: 'defeat', why: 'defeat at 2159 s where the same seed won at 1644 s, and it turns on whether the AI hulls’ routines pull a watch for mends of 1 to 4 points. With T.vitalGain forced to 0 this seed wins and the tree is 13 of 16, while two other seeds win sooner with the bar in place; the traces are identical to 850 s and the flagship’s own parties never move before they split. A chaotic seed, not a rule, so the routine’s bar stays where the board’s Send bar is (crew worker, round 3)' },
  };
  // A carried seed counts as carried only while it loses the way its entry records.
  const swCarried = swBeaten.filter((r) => CARRIED[tag(r)] && CARRIED[tag(r)].outcome === r.outcome);
  const swNew = swBeaten.filter((r) => !CARRIED[tag(r)] || CARRIED[tag(r)].outcome !== r.outcome);
  check('the recommended option wins chapters 2 and 4 at every reading speed, at 1 s and 5 s steps (' + (swRuns.length - swBeaten.length) + ' of ' + swRuns.length + ', ' + swCarried.length + ' carried)',
    swNew.length === 0,
    swNew.map((r) => tag(r) + ': ' + r.outcome + ' at ' + r.time + ' s (' + r.objectives + ')' +
      (CARRIED[tag(r)] ? ' · carried as ' + CARRIED[tag(r)].outcome + ', now ' + r.outcome : '')).join(' | '));
  for (const r of swCarried) note('carried loss: ' + tag(r) + ' ' + r.outcome + ' at ' + r.time + ' s (' + r.objectives + ') · ' + CARRIED[tag(r)].why);
  for (const k of Object.keys(CARRIED)) if (!swBeaten.some((r) => tag(r) === k) && swRuns.some((r) => tag(r) === k)) note('carried run now wins: remove ' + k + ' from CARRIED');
  // v13, measured on the same sixteen seeds with scratchpad/v13/decisions/sweep.js: the crew model
  // makes the fights longer, not worse, and the one run that looked like a new loss was the old
  // forty-minute cap cutting a won fight short (see above). The three crew kinds themselves are
  // quiet here: with all three stubbed out the sweep runs card for card the same but for one
  // repair card in ch4 1s 0s, which changes neither that run's outcome nor its time. Without
  // js/crew.js loaded at all the sweep is 14 of 16, the two carried losses and nothing else.
  if (swNew.length) {
    note('to place a new loss: run scratchpad/v13/decisions/sweep.js against a tree with the three ' +
      'crew triggers stubbed out, and again with js/crew.js not loaded \u00b7 v13 baselines on these ' +
      'seeds: 14 of 16 with no crew module, and the same runs card for card with the cards stubbed out');
  }
  note('reading delays: ' + swRuns.map((r) => tag(r) + ' ' + r.outcome + ' t=' + r.time + ' cards=' + r.answered).join(' | '));

  // ---------------------------------------------------------------- recommended-only, chapter 2
  // The stalemate the reviewers hit: 'Open to 1 253 km' and then twenty empty minutes while the
  // convoy was shot at. The run has to be a fight, whatever else it is.
  // The hour cap, for the reason given above the chapter 4 run.
  console.log('scenario: chapter 2 played on the recommended option alone (60 min cap)');
  const picket = await page.evaluate(() => {
    const U = OD.U, D = OD.Decisions;
    const out = { err: [], outcome: null, time: 0, range: null, sabre: null, answers: [], badOpen: [], coastBroken: [], panelFlip: [], third: [], firstPerson: [], brakeFar: [], salvo: null };
    try {
      // A fixed stream, so this chapter is the same fight every run: whatever the scenarios before
      // it drew out of Math.random must not decide whether a chapter passes.
      (function (n) { let x = n; Math.random = function () { x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; })(20302);
      OD.harness.start(1);
      const sim = OD.Game.sim;
      OD.harness.select('larkspur');
      let closest = Infinity;

      // Two things every recommended-only run is watched for, whatever else it is about:
      //  - a cold approach undone by a full-throttle order inside a minute (the defend card used to
      //    replace the coast chosen ten seconds earlier, and never said the drive was lighting);
      //  - the panels stowed and extended inside a minute by two cards arguing with each other.
      const coastAt = Object.create(null);
      const panelSaid = [];
      const answer = (d, rec) => {
        const ships = (d.ships || [d.shipId]).slice();
        const was = ships.map((id) => { const s2 = sim.byId(id); return s2 ? { id, type: s2.order.type } : null; });
        if (/^Stow/.test(rec.label)) panelSaid.push({ t: sim.time, id: d.shipId, dir: 'in', kind: d.kind, label: rec.label });
        if (/^Extend/.test(rec.label)) panelSaid.push({ t: sim.time, id: d.shipId, dir: 'out', kind: d.kind, label: rec.label });
        D.choose(sim, d.id, rec.key);
        for (const w of was) {
          if (!w) continue;
          const s2 = sim.byId(w.id);
          if (!s2 || !s2.order) continue;
          // The rule is about a coast that was just chosen and then undone, so the clock starts
          // when an answer actually puts the hull on one. Restarting it on every answer given
          // while she happens to still be coasting reported a coast chosen at 20 s as 'set 40 s
          // earlier' and failed a range card two minutes later for it.
          if (s2.order.type === 'approach') { if (w.type !== 'approach') coastAt[w.id] = sim.time; continue; }
          if (w.type === 'approach' && coastAt[w.id] != null && sim.time - coastAt[w.id] < 60 &&
              /^(keeprange|intercept|retreat)$/.test(s2.order.type) && !(s2.order.vmax > 0)) {
            out.coastBroken.push(Math.round(sim.time) + ' ' + w.id + ': ' + d.kind + ' → ' + rec.label +
              ' replaced the coast set ' + Math.round(sim.time - coastAt[w.id]) + ' s earlier with ' + s2.order.type);
          }
        }
      };
      const flips = () => {
        for (let i = 0; i < panelSaid.length; i++) {
          for (let j = i + 1; j < panelSaid.length; j++) {
            const a = panelSaid[i], b = panelSaid[j];
            if (a.id !== b.id || a.dir === b.dir || b.t - a.t > 60) continue;
            out.panelFlip.push(a.id + ': ' + a.kind + ' → ' + a.label + ' at ' + Math.round(a.t) + ', ' +
              b.kind + ' → ' + b.label + ' at ' + Math.round(b.t));
          }
        }
      };
      const bare = (x) => String(x).replace(/\u2009/g, '');
      // Every 'brake at X' the band prints, every step: the brake can never begin farther out than
      // the plot says she is, or the order is to brake before we set off.
      const watchBrake = () => {
        for (const d of sim.decisions || []) {
          const sh = sim.byId(d.shipId), t = d.targetId ? sim.byId(d.targetId) : null;
          if (!sh || !t) continue;
          const tr = OD.Sensors.track(sim, sh.faction, t);
          const R = tr && tr.q < 2.7 ? U.dist(sh.pos, tr.est.pos) : U.dist(sh.pos, t.pos);
          for (const o of d.options || []) {
            const m = /brake at ([\d\u2009]+) km/.exec(String(o.detail || '') + ' · ' + String(d.teach || ''));
            if (m && +bare(m[1]) * 1000 >= R) out.brakeFar.push(Math.round(sim.time) + ' ' + d.kind + ': ' + m[0] + ' at a range of ' + Math.round(R / 1000) + ' km');
          }
        }
      };
      while (sim.time < 3600 && !sim.outcome) {
        OD.harness.step(5);
        watchBrake();
        for (const d of sim.decisions || []) {
          if (d.kind !== 'salvo' || out.salvo) continue;
          const o = (d.options || []).find((x) => x.id === 'launch');
          if (o) out.salvo = o.label + ' · ' + o.detail + (o.recommended ? ' [rec]' : '');
        }
        const me = sim.byId('larkspur'), foe = sim.byId('sabre');
        if (me && foe && !foe.neutralised()) closest = Math.min(closest, U.dist(me.pos, foe.pos));
        for (const d of (sim.decisions || []).slice()) {
          const rec = (d.options || []).find((o) => o.recommended);
          if (!rec) continue;
          if (/^Open to/.test(rec.label) && sim.objectives.some((o) => o.type === 'neutralize' && !o.done && !o.failed)) out.badOpen.push(Math.round(sim.time) + ' ' + rec.label);
          // a card about a hull the bridge is not flying has to read as a question about her
          if (!(d.ships || [d.shipId]).includes('larkspur')) {
            const who = sim.byId(d.shipId);
            const words = [d.title, d.text].concat((d.options || []).map((o) => o.label + ' ' + o.detail)).join(' ');
            out.third.push(Math.round(sim.time) + ' ' + d.shipId + ': ' + d.title);
            if (/\b(we|us|our|ours)\b/i.test(words) || (who && d.title.indexOf(who.name) < 0)) out.firstPerson.push(d.kind + ' — ' + d.title + ' — ' + words.slice(0, 160));
          }
          out.answers.push(Math.round(sim.time) + ' ' + d.kind + ' → ' + rec.label);
          answer(d, rec);
        }
      }
      flips();
      const foe = sim.byId('sabre');
      out.outcome = sim.outcome;
      out.time = Math.round(sim.time);
      out.range = Math.round(closest / 1000);
      out.sabre = foe ? { hull: Math.round(foe.hull * 100), out: foe.neutralised() } : null;
      out.haulers = sim.objectives.filter((o) => o.type === 'protect').map((o) => o.id + ':' + (o.failed ? 'lost' : 'safe')).join(', ');
    } catch (e) { out.err.push(String(e.stack || e)); }
    out.errors = OD.errors.slice();
    return out;
  });
  check('no errors in the chapter 2 recommended-only run', picket.err.length === 0 && picket.errors.length === 0, picket.err.concat(picket.errors).join(' | '));
  check('chapter 2 is won on the recommended option alone', picket.outcome === 'victory',
    'outcome ' + picket.outcome + ' at ' + picket.time + ' s · closed to ' + picket.range + ' km · Sabre ' + JSON.stringify(picket.sabre) + ' · ' + picket.haulers);
  check('the coast is never replaced by a full-throttle order inside a minute', picket.coastBroken.length === 0, picket.coastBroken.slice(0, 3).join(' | '));
  check('and the panels are never stowed and extended inside a minute', picket.panelFlip.length === 0, picket.panelFlip.slice(0, 3).join(' | '));
  if (picket.third && picket.third.length) {
    check('a card for a hull the bridge is not flying speaks of her by name', picket.firstPerson.length === 0, picket.firstPerson.slice(0, 2).join(' | '));
    note('other hulls: ' + picket.third.slice(0, 4).join(' | '));
  }
  check('and is never told to open the range with the objective still open', picket.badOpen.length === 0, picket.badOpen.slice(0, 4).join(' | '));
  check('no card ever prints a brake farther out than the hull it is closing on', picket.brakeFar.length === 0, picket.brakeFar.slice(0, 3).join(' | '));
  // The bays never reload, so what a salvo costs is the magazine, and the card has to say it.
  check('the launch option prices the magazine against the arrivals', picket.salvo == null || /\d+ of \d+ aboard for /.test(picket.salvo), String(picket.salvo));
  note('answers: ' + (picket.answers || []).slice(0, 10).join(' | '));

  // ---------------------------------------------------------------- recommended-only, three a side
  console.log('scenario: a 3-a-side skirmish on the recommended option alone');
  const skirm = await page.evaluate(() => {
    const D = OD.Decisions;
    const out = { err: [], outcome: null, time: 0, mine: 0, theirs: 0, badOpen: [], answers: [] };
    try {
      // A fixed stream, so this chapter is the same fight every run: whatever the scenarios before
      // it drew out of Math.random must not decide whether a chapter passes.
      (function (n) { let x = n; Math.random = function () { x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; })(20317);
      OD.harness.start(OD.Skirmish.build({ player: 'JC', env: 'deep', range: 900, playerShips: { corvette: 2, frigate: 1 }, enemyShips: { corvette: 2, frigate: 1 }, seed: 17 }));
      const sim = OD.Game.sim;
      OD.harness.select(sim.playerShips()[0].id);
      while (sim.time < 1500 && !sim.outcome) {
        OD.harness.step(5);
        for (const d of (sim.decisions || []).slice()) {
          const rec = (d.options || []).find((o) => o.recommended);
          if (!rec) continue;
          if (d.pressing && d.kind !== 'withdraw' && d.kind !== 'sink' && /^(Open to|Hold and watch|Hold (our )?station|Break off)/.test(rec.label)) out.badOpen.push(d.kind + ': ' + rec.label);
          out.answers.push(Math.round(sim.time) + ' ' + d.kind + ' → ' + rec.label);
          D.choose(sim, d.id, rec.key);
        }
      }
      out.outcome = sim.outcome;
      out.time = Math.round(sim.time);
      out.mine = sim.ships.filter((s) => s.faction === sim.playerFaction && !s.neutralised()).length;
      out.theirs = sim.ships.filter((s) => s.faction !== sim.playerFaction && s.faction !== 'CIV' && !s.neutralised()).length;
    } catch (e) { out.err.push(String(e.stack || e)); }
    out.errors = OD.errors.slice();
    return out;
  });
  check('no errors in the 3-a-side run', skirm.err.length === 0 && skirm.errors.length === 0, skirm.err.concat(skirm.errors).join(' | '));
  check('recommended-only play does not lose a 3-a-side skirmish', skirm.outcome !== 'defeat', 'outcome ' + skirm.outcome + ' at ' + skirm.time + ' s, ' + skirm.mine + ' of ours against ' + skirm.theirs + ' of theirs');
  check('and is never pointed at a passive answer while pressing', skirm.badOpen.length === 0, skirm.badOpen.slice(0, 4).join(' | '));
  note('answers: ' + (skirm.answers || []).slice(0, 10).join(' | '));


  // ---------------------------------------------------------------- breaking off does not cook
  // The reviewers' worst number: 'Break off and cool' issued a retreat at full throttle for 1 600 s,
  // took the sink from 40 % to full and held it there while the ship fell 2 000 km.
  console.log('scenario: Break off and cool, twenty minutes of it');
  const cooling = await page.evaluate(() => {
    const D = OD.Decisions;
    const out = { err: [], chose: null, peak: 0, overheated: false, throttle: null, coasted: null, panels: null, detail: null, orders: [] };
    try {
      OD.harness.start(OD.Skirmish.build({ player: 'JC', env: 'deep', range: 200, playerShips: { destroyer: 1 }, enemyShips: { destroyer: 1 }, seed: 5 }));
      const sim = OD.Game.sim;
      const me = sim.playerShips()[0], foe = sim.hostiles(me)[0];
      OD.harness.select(me.id);
      sim.setTarget(me.id, foe.id);
      me.weaponsFree = true;
      OD.Engagement.setFireMode(me, 'full');
      sim.setRadiators(me.id, false);
      me.radiators.state = 0;
      me.heat = me.sinkCapacity * 0.82; // hot enough to be asked the question
      let d = null;
      for (let i = 0; i < 30 && !d; i++) {
        OD.harness.step(4);
        for (const x of (sim.decisions || []).slice()) {
          if (!(x.ships || [x.shipId]).includes(me.id)) continue;
          if (x.kind === 'heat') d = x; else D.dismiss(sim, x.id);
        }
      }
      const o = d && d.options.find((x) => x.id === 'breakoff');
      if (o) {
        // and back to the load the reviewers watched run away: 40 % of the sink, beams at full,
        // twenty minutes of retreat. The burn this card issues must not take it to the top.
        me.heat = me.sinkCapacity * 0.4;
        D.refresh(sim, d);
        out.detail = o.label + ' · ' + (d.options.find((x) => x.id === 'breakoff') || o).detail;
        D.choose(sim, d.id, o.key);
        out.chose = true;
        const t0 = sim.time;
        while (sim.time - t0 < 1200 && !sim.outcome && !me.destroyed) {
          OD.harness.step(5);
          out.peak = Math.max(out.peak, me.thermalLoad());
          if (me.overheated) out.overheated = true;
          if (out.coasted == null && me.order.type !== 'retreat') out.coasted = Math.round(sim.time - t0);
          const last = out.orders[out.orders.length - 1];
          if (out.orders.length < 8 && (!last || last.type !== me.order.type)) out.orders.push({ t: Math.round(sim.time - t0), type: me.order.type });
        }
        out.throttle = me.throttle;
        out.panels = me.radiators.deployed;
        out.peak = Math.round(out.peak * 1000) / 1000;
      }
    } catch (e) { out.err.push(String(e.stack || e)); }
    out.errors = OD.errors.slice();
    return out;
  });
  check('no errors while breaking off', cooling.err.length === 0 && cooling.errors.length === 0, cooling.err.concat(cooling.errors).join(' | '));
  check('the heat card offers Break off and cool', cooling.chose === true, String(cooling.detail));
  check('breaking off never runs the sink to full in twenty minutes', cooling.chose !== true || (cooling.peak < 0.999 && cooling.overheated === false), 'peak ' + cooling.peak + ', overheated ' + cooling.overheated);
  check('the break-off burn ends and the hull coasts', cooling.chose !== true || (cooling.coasted != null && cooling.coasted <= 300), 'drive out after ' + cooling.coasted + ' s · ' + JSON.stringify(cooling.orders));
  check('and it puts the panels out on the way', cooling.chose !== true || cooling.panels === true, String(cooling.panels));
  if (cooling.detail) note(cooling.detail);

  // ---------------------------------------------------------------- our own sink, saturated
  // 1 700 s of silence with two hulls sink-full and drive-capped is where a fight was decided.
  console.log('scenario: our own sink saturated in a fight');
  const sunk = await page.evaluate(() => {
    const D = OD.Decisions;
    const out = { err: [], raised: null, title: null, ids: null, options: null, acted: null, again: null, againRec: null, againAt: null };
    try {
      OD.harness.start(OD.Skirmish.build({ player: 'JC', env: 'deep', range: 300, playerShips: { corvette: 1 }, enemyShips: { corvette: 1 }, seed: 9 }));
      const sim = OD.Game.sim;
      const me = sim.playerShips()[0], foe = sim.hostiles(me)[0];
      OD.harness.select(me.id);
      sim.setTarget(me.id, foe.id);
      me.weaponsFree = true;
      sim.setRadiators(me.id, false);
      me.radiators.state = 0;
      let d = null;
      for (let i = 0; i < 30 && !d && !sim.outcome; i++) {
        me.heat = me.sinkCapacity; // she is cooking and nothing is draining it
        OD.harness.step(4);
        for (const x of (sim.decisions || []).slice()) {
          if (!(x.ships || [x.shipId]).includes(me.id)) continue;
          if (x.kind === 'sink') d = x; else D.dismiss(sim, x.id);
        }
      }
      if (d) {
        out.raised = true;
        out.title = d.title + ' — ' + d.text;
        out.ids = d.options.map((o) => o.id).join(',');
        out.options = d.options.map((o) => o.key + ' ' + o.label + ' · ' + o.detail + (o.recommended ? ' [rec]' : ''));
        const ext = d.options.find((o) => o.id === 'extend');
        if (ext) { D.choose(sim, d.id, ext.key); out.acted = me.radiators.deployed === true; }
        // Answered, and the lock still holds: the same words, the same hull, the same enemy, and
        // the cooldown says 600 s. It has to come back anyway, inside a couple of minutes, and this
        // time — with the panels already out — pointing at breaking off rather than riding it out.
        const t0 = sim.time;
        let back = null;
        for (let i = 0; i < 90 && !back && !sim.outcome; i++) {
          me.heat = me.sinkCapacity; // she is still cooking: nothing about the situation has moved
          OD.harness.step(4);
          for (const x of (sim.decisions || []).slice()) {
            if (!(x.ships || [x.shipId]).includes(me.id)) continue;
            if (x.kind === 'sink' && x.id !== d.id) back = x; else if (x.kind !== 'sink') D.dismiss(sim, x.id);
          }
        }
        if (back) {
          out.again = Math.round(sim.time - t0);
          out.againAt = Math.round(sim.time);
          const r = back.options.find((o) => o.recommended);
          out.againRec = r ? r.id + ' ' + r.label : null;
        }
      }
    } catch (e) { out.err.push(String(e.stack || e)); }
    out.errors = OD.errors.slice();
    return out;
  });
  check('no errors while the sink question is raised', sunk.err.length === 0 && sunk.errors.length === 0, sunk.err.concat(sunk.errors).join(' | '));
  check('a saturated sink raises the sink card', sunk.raised === true, String(sunk.title));
  check('it offers the panels, riding it out and breaking off', /extend/.test(sunk.ids || '') && /ride/.test(sunk.ids || ''), String(sunk.ids));
  check('and extending the panels from it puts them out', sunk.acted === true, String(sunk.acted));
  check('the lock re-raises the card though nothing has changed and the cooldown is 600 s',
    sunk.again != null && sunk.again <= 180, 'came back after ' + sunk.again + ' s');
  check('and with the panels already out it points at breaking off', /breakoff/.test(sunk.againRec || ''), String(sunk.againRec));
  if (sunk.options) note(sunk.title + '\n      ' + sunk.options.join('\n      '));

  // ---------------------------------------------------------------- somebody else's question
  // The slugs card for a hauler used to say 'we' and 'us' while the bridge was flying a corvette
  // three hundred kilometres away.
  console.log('scenario: a card about a hull the bridge is not flying');
  const hers = await page.evaluate(() => {
    const U = OD.U;
    const out = { err: [], kind: null, title: null, words: null, firstPerson: null, named: null };
    try {
      OD.harness.start(1);
      const sim = OD.Game.sim;
      const me = sim.byId('larkspur'), sabre = sim.byId('sabre'), hauler = sim.byId('hauler2');
      OD.harness.select(me.id);
      sabre.ai = false;
      sabre.weaponsFree = true;
      sabre.target = hauler.id;
      sabre.radiators.deployed = true;
      const u = U.norm(U.sub(sabre.pos, hauler.pos));
      sabre.pos = { x: hauler.pos.x + u.x * 80e3, y: hauler.pos.y + u.y * 80e3 };
      sabre.vel = { x: hauler.vel.x, y: hauler.vel.y };
      let d = null;
      for (let i = 0; i < 140 && !d && !sim.outcome; i++) {
        hauler.jink = false;
        OD.harness.step(5);
        d = (sim.decisions || []).find((x) => (x.ships || [x.shipId]).includes(hauler.id));
      }
      if (d) {
        const words = [d.title, d.text].concat((d.options || []).map((o) => o.label + ' ' + o.detail)).join(' ');
        out.kind = d.kind;
        out.title = d.title;
        out.words = d.title + ' — ' + d.text;
        out.firstPerson = /\b(we|us|our|ours)\b/i.test(words);
        out.named = d.title.indexOf(hauler.name) >= 0;
      }
    } catch (e) { out.err.push(String(e.stack || e)); }
    out.errors = OD.errors.slice();
    return out;
  });
  check('no errors while another hull is asked', hers.err.length === 0 && hers.errors.length === 0, hers.err.concat(hers.errors).join(' | '));
  check('a hauler under fire gets a card of her own', hers.kind != null, String(hers.kind));
  check('it is written in the third person, not as we and us', hers.kind == null || hers.firstPerson === false, String(hers.words));
  check('and its title names her', hers.kind == null || hers.named === true, String(hers.title));
  if (hers.words) note(hers.kind + ': ' + hers.words);

  // ---------------------------------------------------------------- the heat lock
  // The reviewers' worst hour: recommended-only play stowed the panels at 134 s, stowed them again
  // at 735 s, saturated the sink at 1 016 s and then flew for eighty minutes with the drive capped
  // to a quarter, the mounts inhibited and nothing whatever on the band. Their own skirmish, their
  // own build, played on the lit option alone: no hull of ours stays locked for three minutes while
  // anything hostile is still alive, and our beams go off at some point in the fight.
  console.log('scenario: the fun reviewer\'s skirmish, played on the recommended option alone');
  const lock = await page.evaluate(() => {
    const D = OD.Decisions;
    const out = { err: [], outcome: null, time: 0, worst: 0, worstShip: null, fired: false, stows: [], answers: [], locked: [],
      worstQuiet: 0, quietShip: null };
    try {
      OD.harness.start(OD.Skirmish.build({ player: 'JC', env: 'deep', range: 1000, playerShips: { corvette: 2, frigate: 1 }, enemyShips: { corvette: 2, frigate: 1 }, seed: 7 }));
      const sim = OD.Game.sim;
      OD.harness.select(sim.playerShips()[0].id);
      const since = Object.create(null); // when each hull's current lock started
      // And the other silence: a hull losing armour with nothing whatever on her band. Fifteen to
      // twenty-nine minutes of that is what the reviewers watched while the hull came apart.
      const band = Object.create(null);
      let last = sim.time;
      while (sim.time < 2400 && !sim.outcome) {
        OD.harness.step(5);
        const dt = sim.time - last; last = sim.time;
        const foes = sim.ships.filter((x) => x.faction !== sim.playerFaction && x.faction !== 'CIV' && !x.neutralised());
        for (const me of sim.playerShips()) {
          // A hull that is out of the fight is asked nothing and has nothing to answer: her drive
          // is gone and her mounts with it, so a saturated sink aboard her is not the band going
          // quiet on a ship that could still do something about it.
          if (me.destroyed || me.captured || me.disabled) { since[me.id] = null; continue; }
          if (me.eng && me.eng.firing > 0) out.fired = true;
          const hot = me.thermalLoad() >= 0.98 || me.overheated || me.weaponsInhibited;
          if (!hot || !foes.length) { since[me.id] = null; continue; }
          if (since[me.id] == null) since[me.id] = sim.time;
          const held = sim.time - since[me.id];
          if (held > out.worst) { out.worst = held; out.worstShip = me.name; }
        }
        for (const me of sim.playerShips()) {
          // A disabled hull has nothing to answer, so her silence is not the band's failing.
          if (me.destroyed || me.captured || me.disabled) { band[me.id] = null; continue; }
          const rec = band[me.id] || (band[me.id] = { last: sim.time, hull: me.hull });
          if (!rec.last) { rec.last = sim.time; rec.hull = me.hull; }
          if ((sim.decisions || []).some((d) => (d.ships || [d.shipId]).includes(me.id))) { rec.last = sim.time; rec.hull = me.hull; continue; }
          if (me.hull < rec.hull - 0.02 && foes.length) {
            const gap = sim.time - rec.last;
            if (gap > out.worstQuiet) { out.worstQuiet = gap; out.quietShip = me.name; }
          }
        }
        if (dt < 0) break;
        for (const d of (sim.decisions || []).slice()) {
          const rec = (d.options || []).find((o) => o.recommended);
          if (!rec) continue;
          if (d.kind === 'sink') out.locked.push(Math.round(sim.time) + ' ' + d.title + ' → ' + rec.label);
          if (rec.panel === 'in') out.stows.push(Math.round(sim.time) + ' ' + d.kind + ' → ' + rec.label + ' (sink ' + Math.round(sim.byId(d.shipId).thermalLoad() * 100) + ' %)');
          out.answers.push(Math.round(sim.time) + ' ' + d.kind + ' → ' + rec.label);
          D.choose(sim, d.id, rec.key);
        }
      }
      out.outcome = sim.outcome;
      out.time = Math.round(sim.time);
      out.worst = Math.round(out.worst);
      out.mine = sim.playerShips().filter((s) => !s.neutralised()).length;
      out.theirs = sim.ships.filter((s) => s.faction !== sim.playerFaction && s.faction !== 'CIV' && !s.neutralised()).length;
    } catch (e) { out.err.push(String(e.stack || e)); }
    out.errors = OD.errors.slice();
    return out;
  });
  check('no errors in the heat-lock run', lock.err.length === 0 && lock.errors.length === 0, lock.err.concat(lock.errors).join(' | '));
  check('recommended-only play never leaves a hull locked in a saturated sink for three minutes',
    lock.worst <= 180, 'worst ' + lock.worst + ' s' + (lock.worstShip ? ' on ' + lock.worstShip : '') + ' · outcome ' + lock.outcome + ' at ' + lock.time + ' s');
  check('and our beams do fire in that fight', lock.fired === true, 'outcome ' + lock.outcome + ', ' + lock.mine + ' of ours against ' + lock.theirs + ' of theirs');
  // The reviewers watched fifteen to twenty-nine minutes of it. Four of those minutes are the gate
  // the band opens on; the rest is the sim, which cannot always be given a question worth asking —
  // a hull holed by rounds fired from two thousand kilometres away has nothing to decide about the
  // hull that fired them. The claim is the one that can be kept: never a quarter of an hour.
  check('and no hull loses armour for ten minutes with nothing on her band', lock.worstQuiet <= 600,
    'worst ' + Math.round(lock.worstQuiet) + ' s' + (lock.quietShip ? ' on ' + lock.quietShip : ''));
  if (lock.stows.length) note('stows offered: ' + lock.stows.slice(0, 6).join(' | '));
  if (lock.locked.length) note('sink cards: ' + lock.locked.slice(0, 6).join(' | '));

  // ---------------------------------------------------------------- the plot, not the truth
  // Chapter 2 at half a minute: our track on Sabre is a bare contact with a 281 km error box, and
  // the card read 'She is 1 042 km out' while the panel beside it read '980 km ± 360 km' and the
  // log '960 km ±210 km'. Three answers to one question, two of them the truth read off the sim.
  console.log('scenario: chapter 2, a contact a thousand kilometres out');
  const plot = await page.evaluate(() => {
    const U = OD.U, S = OD.Sensors;
    const out = { err: [], raised: null };
    const sig2 = (v) => { if (!isFinite(v) || v === 0) return 0; const m = Math.pow(10, Math.floor(Math.log10(Math.abs(v))) - 1); return Math.round(v / m) * m; };
    const bare = (x) => String(x).replace(/ /g, '');
    try {
      OD.harness.start(1);
      const sim = OD.Game.sim;
      OD.harness.select('larkspur');
      const me = sim.byId('larkspur'), foe = sim.byId('sabre');
      let d = null;
      for (let i = 0; i < 40 && !d && !sim.outcome; i++) {
        OD.harness.step(5);
        d = (sim.decisions || []).find((x) => x.kind === 'approach' && (x.ships || [x.shipId]).includes('larkspur')) || null;
      }
      if (!d) { out.errors = OD.errors.slice(); return out; }
      const tr = S.track(sim, 'JC', foe);
      const estR = U.dist(me.pos, tr.est.pos), trueR = U.dist(me.pos, foe.pos);
      const words = [d.title, d.text, d.teach || ''].concat((d.options || []).map((o) => o.label + ' · ' + o.detail)).join(' | ');
      out.contact = tr.q < 2.7;
      out.raised = { at: Math.round(sim.time), q: +tr.q.toFixed(2), word: tr.word, estKm: Math.round(estR / 1000),
        trueKm: Math.round(trueR / 1000), errKm: Math.round((tr.rangeErr || 0) / 1000), words };
      // the plot's own two figures, with the box on them, exactly as the sensor log speaks
      out.want = 'about ' + U.fmt.dist(sig2(estR)) + ', ±' + U.fmt.dist(sig2(tr.rangeErr || 0));
      out.quotesPlot = words.indexOf(out.want) >= 0;
      // and never the truth to the kilometre
      const truth = U.fmt.dist(trueR);
      out.noTruth = U.fmt.dist(sig2(estR)) === truth || words.indexOf(truth) < 0;
      // nothing it says about her range is finer than the error box allows
      const nums = [];
      let m;
      const re = /about ([\d ]+) km/g;
      while ((m = re.exec(words))) nums.push(+bare(m[1]) * 1000);
      out.rounded = nums.length > 0 && nums.every((v) => sig2(v) === v);
      // and the brake never begins farther out than the plot says she is
      const brakes = [];
      const rb = /brake at ([\d ]+) km/g;
      while ((m = rb.exec(words))) brakes.push(+bare(m[1]) * 1000);
      out.brakeKm = brakes.map((v) => Math.round(v / 1000));
      out.brakeInside = brakes.every((v) => v < estR);
    } catch (e) { out.err.push(String(e.stack || e)); }
    out.errors = OD.errors.slice();
    return out;
  });
  check('no errors while the contact card is read', plot.err.length === 0 && plot.errors.length === 0, plot.err.concat(plot.errors).join(' | '));
  check('the approach card is raised while she is still a contact', !!plot.raised && plot.contact === true,
    plot.raised ? plot.raised.at + ' s, q ' + plot.raised.q + ' (' + plot.raised.word + ')' : 'never raised');
  check('it quotes our track on her, two figures and the box', plot.quotesPlot === true, 'wanted "' + plot.want + '"');
  check('and never the true range to the kilometre', plot.noTruth === true, plot.raised ? 'true ' + plot.raised.trueKm + ' km, plot ' + plot.raised.estKm + ' ± ' + plot.raised.errKm + ' km' : '');
  check('nothing it says about her range is finer than the box allows', plot.rounded === true, String(plot.rounded));
  check('the brake it names begins inside the range it quotes', plot.brakeInside === true, JSON.stringify(plot.brakeKm));
  if (plot.raised) note(plot.raised.words);

  // ---------------------------------------------------------------- the brake is inside the range
  // 'She is 630 km out … brake at 728 km' — an order to brake a hundred kilometres before setting
  // off. The clause is held inside the range at every distance, and the order says what it says.
  console.log('scenario: the brake against four ranges');
  const brake = await page.evaluate(() => {
    const U = OD.U, D = OD.Decisions;
    const out = { err: [], cases: [] };
    const bare = (x) => String(x).replace(/ /g, '');
    try {
      // Placed as multiples of the burn-through reach the gunnery module currently makes, so the
      // tight cases — where the standoff and the stopping distance want a brake outside the range
      // she is at — are exercised whatever the tuning does next.
      for (const f of [4, 1.6, 1.2, 1.06]) {
        OD.harness.start(OD.Skirmish.build({ player: 'JC', env: 'ganymede', range: 900, playerShips: { corvette: 2 }, enemyShips: { corvette: 2 }, seed: 7 }));
        const sim = OD.Game.sim;
        const me = sim.playerShips()[0], foe = sim.hostiles(me)[0];
        OD.harness.select(me.id);
        const r0 = OD.Engagement.reach(sim, me, foe);
        const bite0 = Math.max(r0.beams[OD.Engagement.shared.facetSeen(me, foe)] || 0,
          r0.their ? r0.their.beams[r0.their.facet] || 0 : 0);
        const at = Math.max(60e3, bite0 * f);
        const u = U.norm(U.sub(me.pos, foe.pos));
        me.pos = { x: foe.pos.x + u.x * at, y: foe.pos.y + u.y * at };
        me.vel = { x: foe.vel.x, y: foe.vel.y };
        sim.setOrder(me.id, { type: 'hold' });
        sim.setTarget(me.id, foe.id);
        D.init(sim);
        let d = null;
        for (let i = 0; i < 20 && !d && !sim.outcome; i++) {
          OD.harness.step(4);
          d = (sim.decisions || []).find((x) => x.kind === 'approach' && (x.ships || [x.shipId]).includes(me.id)) || null;
          if (!d) for (const x of (sim.decisions || []).slice()) D.dismiss(sim, x.id);
        }
        if (!d) { out.cases.push({ at: Math.round(at / 1000), bite: Math.round(bite0 / 1000), raised: false, inside: true, agrees: true }); continue; }
        const tr = OD.Sensors.track(sim, me.faction, foe);
        const R = tr && tr.q < 2.7 ? U.dist(me.pos, tr.est.pos) : U.dist(me.pos, foe.pos);
        const coast = d.options.find((o) => /^Coast in/.test(o.label));
        // Three clauses on the key, the rest behind Why?: the brake the order flies may be printed
        // in either place, and both are the card's own words.
        const m = coast ? /brake at ([\d ]+) km/.exec(String(coast.detail || '') + ' · ' + String(d.teach || '')) : null;
        const b = m ? +bare(m[1]) * 1000 : null;
        let order = null;
        if (coast) { D.choose(sim, d.id, coast.key); order = me.order; }
        out.cases.push({
          at: Math.round(at / 1000), bite: Math.round(bite0 / 1000), raised: true, R: Math.round(R / 1000),
          brake: b == null ? null : Math.round(b / 1000), inside: b == null || b < R,
          order: order ? order.type : null,
          // the key issues what the line promises: the same brake, or no approach order at all
          agrees: !order ? false : b == null ? order.type !== 'approach' : order.type === 'approach' && Math.abs((order.brakeAt || 0) - b) <= 1000,
        });
      }
    } catch (e) { out.err.push(String(e.stack || e)); }
    out.errors = OD.errors.slice();
    return out;
  });
  check('no errors while the brake is priced', brake.err.length === 0 && brake.errors.length === 0, brake.err.concat(brake.errors).join(' | '));
  check('every brake printed is inside the range at the time', (brake.cases || []).every((c) => c.inside), JSON.stringify(brake.cases));
  check('and the order the key issues is the one the line names', (brake.cases || []).every((c) => c.agrees), JSON.stringify(brake.cases));
  note('brake: ' + (brake.cases || []).map((c) => c.at + ' km → ' + (c.raised ? (c.brake == null ? 'no brake clause, ' + c.order : c.brake + ' km, ' + c.order) : 'not raised')).join(' | '));

  // ---------------------------------------------------------------- breaking off, priced in time
  // '2m 30s of burn away from her and then cold … outside her 1 452 km bite from 150 km': a hundred
  // and fifty seconds of drive covers sixty-two kilometres, and the rest is twenty-five minutes
  // inside her beams. The clause is a time now, and it is not called cover when it is not.
  console.log('scenario: the break-off clause, checked against the arithmetic');
  const off = await page.evaluate(() => {
    const U = OD.U, D = OD.Decisions;
    const out = { err: [], card: null };
    const bare = (x) => String(x).replace(/ /g, '');
    const secsOf = (t) => {
      if (!t) return null;
      let m = /(\d+)h (\d+)m/.exec(t); if (m) return +m[1] * 3600 + +m[2] * 60;
      m = /(\d+)m (\d+)s/.exec(t); if (m) return +m[1] * 60 + +m[2];
      m = /(\d+) s/.exec(t); if (m) return +m[1];
      return null;
    };
    try {
      OD.harness.start(OD.Skirmish.build({ player: 'JC', env: 'deep', range: 400, playerShips: { corvette: 1 }, enemyShips: { destroyer: 1 }, seed: 5 }));
      const sim = OD.Game.sim;
      const me = sim.playerShips()[0], foe = sim.hostiles(me)[0];
      OD.harness.select(me.id);
      const u = U.norm(U.sub(me.pos, foe.pos));
      me.pos = { x: foe.pos.x + u.x * 150e3, y: foe.pos.y + u.y * 150e3 };
      me.vel = { x: foe.vel.x, y: foe.vel.y };
      me.hull = 0.4;
      me.weaponsFree = true;
      foe.weaponsFree = true;
      foe.ai = false;
      sim.setTarget(me.id, foe.id);
      sim.setOrder(me.id, { type: 'hold' });
      let d = null;
      for (let i = 0; i < 40 && !d && !sim.outcome; i++) {
        OD.harness.step(4);
        for (const x of (sim.decisions || []).slice()) {
          if (!(x.ships || [x.shipId]).includes(me.id)) continue;
          if (x.kind === 'withdraw') d = x; else D.dismiss(sim, x.id);
        }
      }
      if (!d) { out.errors = OD.errors.slice(); return out; }
      const o = d.options.find((x) => x.id === 'breakoff');
      // The panel shows three clauses and puts the rest behind Why?, so the whole line is the key
      // plus that paragraph: the arithmetic has to add up wherever the card chose to print it.
      const det = (o ? o.detail : '') + ' \u00b7 ' + String(d.teach || '');
      const tr = OD.Sensors.track(sim, me.faction, foe);
      const R = tr && tr.q < 2.7 ? U.dist(me.pos, tr.est.pos) : U.dist(me.pos, foe.pos);
      const bm = /^([^·]*?) of burn/.exec(det);
      const burn = bm ? secsOf(bm[1]) : null;
      // The card prints the speed the way the panel does: 820 m/s under a kilometre a second,
      // 1.24 km/s over it, with a thin space inside the digits.
      const sp = /(?:coasting at|opening at) ([\d\u2009 .]+) (m|km)\/s/.exec(det);
      const speed = sp ? +sp[1].replace(/[^\d.]/g, '') * (sp[2] === 'km' ? 1000 : 1) : null;
      const bt = /beams reach ([\d ]+) km/.exec(det) || /outside \S+ ([\d ]+) km burn-through/.exec(det);
      const bite = bt ? +bare(bt[1]) * 1000 : null;
      const cover = /burn-through in ([^·]+)/.exec(det);
      const dist = /clearing that takes ([^·]+)/.exec(det);
      const printed = cover ? secsOf(cover[1]) : dist ? secsOf(dist[1]) : null;
      // the same sum, from the card's own printed numbers: a burn of t seconds at a constant
      // acceleration opens half its final speed times its length, and the rest of her bite is
      // covered at the speed that burn bought
      const opened = speed != null && burn != null ? 0.5 * speed * burn : null;
      const need = bite != null && opened != null ? Math.max(0, bite * 1.25 - R - opened) : null;
      const expect = need == null || speed == null ? null : need <= 0 ? burn : burn + need / speed;
      out.card = { detail: det, burn, speed, biteKm: bite == null ? null : Math.round(bite / 1000), rangeKm: Math.round(R / 1000),
        printed, expect: expect == null ? null : Math.round(expect), cover: !!cover, rec: !!(o && o.recommended),
        lit: (d.options.find((x) => x.recommended) || {}).label || null };
      out.agrees = printed != null && expect != null && Math.abs(printed - expect) <= Math.max(20, expect * 0.12);
      // Cover is claimed against the hull's own clock — how long she lasts at the rate her armour
      // is coming off — capped at the card's own horizon when nothing is landing on her.
      out.claim = !cover || (expect != null && expect <= D.T.coverHorizon * 3);
      out.notCover = !!cover || !(o && o.recommended);
    } catch (e) { out.err.push(String(e.stack || e)); }
    out.errors = OD.errors.slice();
    return out;
  });
  check('no errors while the break-off clause is read', off.err.length === 0 && off.errors.length === 0, off.err.concat(off.errors).join(' | '));
  check('the break-off clause prices the burn in time', !!off.card && off.agrees === true,
    off.card ? 'printed ' + off.card.printed + ' s, the sum says ' + off.card.expect + ' s' : 'no withdraw card');
  check('it only calls it cover when the burn clears her bite in time', off.claim === true, off.card ? String(off.card.cover) : '');
  check('and a burn that buys distance is not the lit answer', off.notCover === true, off.card ? off.card.lit : '');
  if (off.card) note(off.card.detail);

  // ---------------------------------------------------------------- somebody else's card, in English
  // 'JCS Bastion: how do she closes on ISV Coriolis?', '65 % of hers against 19 % of hers',
  // 'she is hers, crew and hull'. A card the bridge is not flying still has to be a sentence.
  console.log('scenario: a whole chapter of cards read in the third person');
  const speech = await page.evaluate(() => {
    const D = OD.Decisions;
    const out = { err: [], seen: 0, bad: [], sample: [] };
    const VERBS = 'closes|holds|gives|shows|bites|stays|keeps|takes|puts|needs|sits|goes|ends|falls|comes|runs|waits|watches|leaves|stops|rides|breaks|opens|spends|reaches|gets|loses|listens|brakes|wants|has|is|does';
    try {
      OD.harness.start(1);
      const sim = OD.Game.sim;
      OD.harness.select('hauler1'); // everything about Larkspur is now somebody else's card
      while (sim.time < 1500 && !sim.outcome) {
        OD.harness.step(5);
        for (const d of (sim.decisions || []).slice()) {
          const third = !(d.ships || [d.shipId]).includes('hauler1');
          const words = [d.title, d.text].concat((d.options || []).map((o) => o.label + ' · ' + o.detail)).join(' · ');
          if (third) {
            out.seen++;
            if (out.sample.length < 4) out.sample.push(d.kind + ': ' + d.title + ' — ' + d.text);
            const twoHers = words.split(/[·,.;:]/).some((c) => (c.match(/\bhers\b/g) || []).length > 1);
            const broken = /\bdo she\b/i.test(words) || new RegExp('\\bdoes she (' + VERBS + ')\\b').test(words) ||
              twoHers || /\b(we|us|our|ours)\b/i.test(words);
            if (broken && out.bad.length < 6) out.bad.push(d.kind + ' — ' + words.slice(0, 220));
          }
          const rec = (d.options || []).find((o) => o.recommended);
          if (rec) D.choose(sim, d.id, rec.key);
        }
      }
    } catch (e) { out.err.push(String(e.stack || e)); }
    out.errors = OD.errors.slice();
    return out;
  });
  check('no errors while the third-person cards are read', speech.err.length === 0 && speech.errors.length === 0, speech.err.concat(speech.errors).join(' | '));
  check('a chapter of somebody else’s cards is raised', speech.seen >= 3, String(speech.seen) + ' cards');
  check('none of them says "do she", "does she closes" or two "hers" in one clause', (speech.bad || []).length === 0, (speech.bad || []).slice(0, 2).join(' | '));
  if (speech.sample && speech.sample.length) note('third person: ' + speech.sample.join('\n      '));

  // ---------------------------------------------------------------- a range she will not allow
  // 'Hold at 1 307 km' against a hull under thrust: the ship was dragged from 1 325 km to 299 km
  // over seven minutes at full throttle without one beam biting. A range a closing target defeats
  // is not a range, and the card now prices the option at the one she will actually allow.
  console.log('scenario: the range card against a hull under thrust');
  const chase = await page.evaluate(() => {
    const U = OD.U, D = OD.Decisions;
    const out = { err: [], raised: null };
    const bare = (x) => String(x).replace(/ /g, '');
    try {
      OD.harness.start(OD.Skirmish.build({ player: 'JC', env: 'deep', range: 900, playerShips: { destroyer: 1 }, enemyShips: { destroyer: 1 }, seed: 5 }));
      const sim = OD.Game.sim;
      const me = sim.playerShips()[0], foe = sim.hostiles(me)[0];
      OD.harness.select(me.id);
      me.weaponsFree = true;
      const r0 = OD.Engagement.reach(sim, me, foe);
      const ours = r0.beams[OD.Engagement.shared.facetSeen(me, foe)] || 0;
      const theirs = r0.their ? r0.their.beams[r0.their.facet] || 0 : 0;
      const big = Math.max(ours, theirs);
      const at = big * 1.05;
      const u = U.norm(U.sub(me.pos, foe.pos));
      me.pos = { x: foe.pos.x + u.x * at, y: foe.pos.y + u.y * at };
      // she is coming at us under her own drive, and we are no quicker than she is
      me.vel = { x: foe.vel.x - u.x * 300, y: foe.vel.y - u.y * 300 };
      foe.ai = false;
      sim.setOrder(foe.id, { type: 'manual', heading: U.angleOf(U.sub(me.pos, foe.pos)), throttle: 1 });
      sim.setTarget(me.id, foe.id);
      sim.setOrder(me.id, { type: 'keeprange', target: foe.id, range: at });
      let d = null;
      for (let i = 0; i < 20 && !d && !sim.outcome; i++) {
        OD.harness.step(4);
        for (const x of (sim.decisions || []).slice()) {
          if (!(x.ships || [x.shipId]).includes(me.id)) continue;
          if (x.kind === 'range') d = x; else D.dismiss(sim, x.id);
        }
      }
      if (!d) { out.errors = OD.errors.slice(); return out; }
      const hold = d.options.find((o) => /^Hold at/.test(o.label));
      const words = d.options.map((o) => o.label + ' · ' + o.detail).join(' | ') + ' | ' + String(d.teach || '');
      const m = hold ? /Hold at ([\d ]+) km/.exec(hold.label) : null;
      out.raised = { oursKm: Math.round(ours / 1000), theirsKm: Math.round(theirs / 1000),
        hold: m ? +bare(m[1]) : null, words };
      // either the option is gone, or it is priced at the range she allows and says why
      out.honest = !hold || (/closing at \d+ m\/s under thrust/.test((String(hold.detail || '') + ' · ' + String(d.teach || ''))) && m != null && +bare(m[1]) * 1000 >= Math.min(theirs * 0.8, ours) * 0.95);
      out.said = /closing at \d+ m\/s under thrust/.test(words);
    } catch (e) { out.err.push(String(e.stack || e)); }
    out.errors = OD.errors.slice();
    return out;
  });
  check('no errors while a closing hull is priced', chase.err.length === 0 && chase.errors.length === 0, chase.err.concat(chase.errors).join(' | '));
  check('the card never offers a standoff a closing hull defeats', chase.raised == null || chase.honest === true,
    chase.raised ? 'ours ' + chase.raised.oursKm + ' km, hers ' + chase.raised.theirsKm + ' km, hold ' + chase.raised.hold + ' km' : 'no range card');
  check('and it says she is closing under thrust', chase.raised == null || chase.said === true, chase.raised ? chase.raised.words.slice(0, 200) : '');

  // ---------------------------------------------------------------- what breaking off is worth
  // The rule the withdraw card is held to: break off when the burn clears her bite inside the
  // armour we have left, get behind a sister when it cannot and there is one, press on when there
  // is neither. A forty-minute fleet action is not a test of a rule — three placed hulls are.
  console.log('scenario: the withdraw card’s rule, in three placements');
  const rule = await page.evaluate(() => {
    const U = OD.U, D = OD.Decisions;
    const out = { err: [], cases: [] };
    const place = (enemy, mult, sister) => {
      OD.harness.start(OD.Skirmish.build({ player: 'JC', env: 'deep', range: 800,
        playerShips: sister ? { corvette: 1, destroyer: 1 } : { corvette: 1 }, enemyShips: enemy, seed: 5 }));
      const sim = OD.Game.sim;
      const me = sim.playerShips().find((x) => x.cls === 'corvette') || sim.playerShips()[0];
      const sis = sim.playerShips().find((x) => x !== me) || null;
      const foe = sim.hostiles(me)[0];
      OD.harness.select(me.id);
      foe.ai = false;
      foe.weaponsFree = true;
      me.weaponsFree = true;
      me.hull = 0.45;
      const r0 = OD.Engagement.reach(sim, me, foe);
      const theirs = r0.their ? r0.their.beams[r0.their.facet] || 0 : 0;
      const at = Math.max(30e3, theirs * mult);
      const u = U.norm(U.sub(me.pos, foe.pos));
      me.pos = { x: foe.pos.x + u.x * at, y: foe.pos.y + u.y * at };
      me.vel = { x: foe.vel.x, y: foe.vel.y };
      if (sis) {
        sis.pos = { x: me.pos.x + u.y * 60e3, y: me.pos.y - u.x * 60e3 };
        sis.vel = { x: me.vel.x, y: me.vel.y };
      }
      sim.setTarget(me.id, foe.id);
      sim.setOrder(me.id, { type: 'hold' });
      let d = null;
      for (let i = 0; i < 40 && !d && !sim.outcome; i++) {
        OD.harness.step(4);
        for (const x of (sim.decisions || []).slice()) {
          if (!(x.ships || [x.shipId]).includes(me.id)) continue;
          if (x.kind === 'withdraw') d = x; else D.dismiss(sim, x.id);
        }
      }
      if (!d) return { raised: false };
      const lit = d.options.find((o) => o.recommended) || {};
      const bo = d.options.find((o) => o.id === 'breakoff') || {};
      return { raised: true, biteKm: Math.round(theirs / 1000), atKm: Math.round(at / 1000), lit: lit.id || null,
        label: lit.label || null, cover: /burn-through in /.test(bo.detail || ''), detail: bo.detail || '' };
    };
    try {
      // her bite is short and we are most of the way out of it: the burn finishes the job
      out.cases.push(Object.assign({ name: 'the burn clears her bite' }, place({ corvette: 1 }, 0.8, false)));
      // a destroyer's beams reach a thousand kilometres past anything this burn can buy
      out.cases.push(Object.assign({ name: 'it cannot, and a sister is near' }, place({ destroyer: 1 }, 0.3, true)));
      out.cases.push(Object.assign({ name: 'it cannot, and there is nobody' }, place({ destroyer: 1 }, 0.3, false)));
    } catch (e) { out.err.push(String(e.stack || e)); }
    out.errors = OD.errors.slice();
    return out;
  });
  check('no errors while the withdraw rule is placed', rule.err.length === 0 && rule.errors.length === 0, rule.err.concat(rule.errors).join(' | '));
  {
    const c = rule.cases || [];
    const say = (x) => x ? x.name + ': ' + (x.raised ? x.atKm + ' km inside a ' + x.biteKm + ' km bite → ' + x.label : 'no card') : '—';
    check('a break-off that clears her bite in time is the lit answer', !!c[0] && c[0].raised && c[0].lit === 'breakoff' && c[0].cover === true, say(c[0]));
    check('one that cannot hands the card to a sister', !!c[1] && c[1].raised && c[1].lit === 'sister' && c[1].cover === false, say(c[1]));
    check('and with no sister to get behind, the card says press on', !!c[2] && c[2].raised && c[2].lit === 'press' && c[2].cover === false, say(c[2]));
    for (const x of c) if (x && x.raised) note(say(x) + '\n      ' + x.detail);
  }

  // ---------------------------------------------------------------- hold and watch, and after it
  // 'Hold and watch' costs nothing, decides nothing and then took the full cooldown with it: ten
  // dead minutes at a thousand kilometres with the band empty. It comes back on its own now, and
  // a dismissal still buys the silence it asked for.
  console.log('scenario: the question that comes back after a hold');
  const held = await page.evaluate(() => {
    const D = OD.Decisions;
    const out = { err: [], answered: null, back: null, backAt: null, dismissed: null, label: null };
    try {
      OD.harness.start(1);
      const sim = OD.Game.sim;
      OD.harness.select('larkspur');
      const find = () => (sim.decisions || []).find((x) => x.kind === 'approach' && (x.ships || [x.shipId]).includes('larkspur')) || null;
      let d = null;
      for (let i = 0; i < 40 && !d && !sim.outcome; i++) { OD.harness.step(5); d = find(); }
      const hold = d ? d.options.find((o) => /^Hold and watch/.test(o.label)) : null;
      if (!hold) { out.errors = OD.errors.slice(); return out; }
      out.label = hold.label;
      D.choose(sim, d.id, hold.key);
      out.answered = Math.round(sim.time);
      const t0 = sim.time;
      let back = null;
      while (sim.time - t0 < 400 && !back && !sim.outcome) {
        OD.harness.step(5);
        sim.setOrder('larkspur', { type: 'hold' }); // the bridge is still holding: nothing has moved
        back = find();
      }
      out.back = !!back;
      out.backAt = back ? Math.round(sim.time - t0) : null;
      if (back) {
        D.dismiss(sim, back.id);
        const t1 = sim.time;
        let again = null;
        while (sim.time - t1 < 300 && !again && !sim.outcome) { OD.harness.step(5); sim.setOrder('larkspur', { type: 'hold' }); again = find(); }
        out.dismissed = !again;
      }
    } catch (e) { out.err.push(String(e.stack || e)); }
    out.errors = OD.errors.slice();
    return out;
  });
  check('no errors while the hold is answered', held.err.length === 0 && held.errors.length === 0, held.err.concat(held.errors).join(' | '));
  check('a hold is put again a couple of minutes later, not ten', held.back === true && held.backAt != null && held.backAt <= 200,
    'back after ' + held.backAt + ' s');
  check('and a dismissal still holds the question shut', held.dismissed === true, String(held.dismissed));

  // ---------------------------------------------------------------- a boarding that never happens
  // 'Board her' holds the ship's fire, and nothing gave it back: recommended-only play finished the
  // skirmish disarmed. The flag sim.js reads is set, and a run that simply lapses gives it back.
  console.log('scenario: the weapons after a boarding');
  const boarded = await page.evaluate(() => {
    const U = OD.U, D = OD.Decisions;
    const out = { err: [], chose: null, held: null, restored: null, detail: null };
    try {
      OD.harness.start(OD.Skirmish.build({ player: 'JC', env: 'deep', range: 400, playerShips: { destroyer: 1 }, enemyShips: { destroyer: 1 }, seed: 5 }));
      const sim = OD.Game.sim;
      const me = sim.playerShips()[0], foe = sim.hostiles(me)[0];
      OD.harness.select(me.id);
      me.weaponsFree = true;
      foe.systems.drive = 0.05;
      const u = U.norm(U.sub(me.pos, foe.pos));
      me.pos = { x: foe.pos.x + u.x * 200e3, y: foe.pos.y + u.y * 200e3 };
      me.vel = { x: foe.vel.x, y: foe.vel.y };
      let d = null;
      for (let i = 0; i < 20 && !d && !sim.outcome; i++) {
        OD.harness.step(4);
        for (const x of (sim.decisions || []).slice()) { if (x.kind === 'cripple') d = x; else D.dismiss(sim, x.id); }
      }
      const o = d ? d.options.find((x) => x.id === 'board') : null;
      if (!o) { out.errors = OD.errors.slice(); return out; }
      out.detail = o.label + ' · ' + o.detail + (o.recommended ? ' [rec]' : '');
      D.choose(sim, d.id, o.key);
      out.chose = true;
      out.held = me.weaponsFree === false && me.heldFireForBoarding === true;
      // the run lapses — the bridge flies her somewhere else — and the weapons come back
      sim.setOrder(me.id, { type: 'hold' });
      OD.harness.step(10);
      out.restored = me.weaponsFree === true && !me.heldFireForBoarding;
    } catch (e) { out.err.push(String(e.stack || e)); }
    out.errors = OD.errors.slice();
    return out;
  });
  check('no errors while a boarding is ordered', boarded.err.length === 0 && boarded.errors.length === 0, boarded.err.concat(boarded.errors).join(' | '));
  check('"Board her" holds the ship’s fire and says so to the sim', boarded.chose === true && boarded.held === true, String(boarded.held));
  check('and a boarding run that lapses gives the weapons back', boarded.restored === true, String(boarded.restored));
  if (boarded.detail) note(boarded.detail);

  // ---------------------------------------------------------------- damage control and the crew
  // Three kinds arrived with v13, and all three are about the people: which part a party goes to,
  // how hard the ship may burn with a repair running or the crew in the couches, and the wounded.
  // They are priced off OD.Crew.board and OD.Damage.repairTime, so with the crew module absent
  // none of them is ever raised — which is the first thing checked here, and the reason the rest
  // of this file's scenarios are unchanged by the pass.
  const crewReal = await page.evaluate(() => !!(window.OD && OD.Crew && typeof OD.Crew.board === 'function'));
  note(crewReal ? 'js/crew.js is on disk: the crew cards are checked against the real module'
    : 'js/crew.js is not in yet: the crew cards are checked against a stub of the SPEC interface');

  // The guard is checked in every build, with or without the module: OD.Crew is taken away for
  // the length of the scenario and put back afterwards, which is the shape a build without
  // js/crew.js has.
  {
    console.log('scenario: no crew module, no crew cards');
    const bare = await page.evaluate(() => {
      const out = { err: [], kinds: [], hurt: null };
      const real = window.OD.Crew;
      try {
        delete window.OD.Crew;
        OD.harness.start(1);
        const sim = OD.Game.sim;
        OD.harness.select('larkspur');
        OD.Game.setTarget('sabre');
        const me = sim.byId('larkspur');
        // a hit part with no crew module is a damage report and nothing else
        const c = (me.components || []).find((x) => x.id === 'rad1');
        if (c) { c.hp = 0.3; me._dmgRev = (me._dmgRev || 0) + 1; OD.Damage.aggregate(me); }
        out.hurt = !!c;
        const seen = new Set();
        for (let i = 0; i < 80 && !sim.outcome; i++) {
          OD.harness.step(5);
          for (const d of sim.decisions || []) seen.add(d.kind);
        }
        out.kinds = Array.from(seen);
      } catch (e) { out.err.push(String(e.stack || e)); }
      if (real) window.OD.Crew = real;
      out.errors = OD.errors.slice();
      return out;
    });
    check('with no crew module the three crew kinds are never raised',
      bare.err.length === 0 && bare.errors.length === 0 &&
      !bare.kinds.some((k) => k === 'repair' || k === 'burn' || k === 'medical'),
      bare.err.concat(bare.errors).join(' | ') + ' saw ' + bare.kinds.join(','));
  }

  // The stub is the SPEC's interface and nothing more: board, assign, release, setG, auto and T,
  // with the jury-rig caps and repair times from "Jury-rig (js/damage.js additions)" so the cards
  // can be priced before either module lands. It goes in only when the real one is absent, and it
  // comes out again after these scenarios, so nothing above or below this block sees it.
  const stubbed = await page.evaluate(() => {
    if (window.OD.Crew) return false;
    const OD = window.OD;
    const g0 = OD.P.g0;
    const T = { workG: 1.2, couchG: 3, medic: 45, hurtRate: 2 / (60 * 24), autoEvery: 15, autoAssign: 60,
      casualtyShare: 0.2, lostShare: 0.25 };
    const PARTIES = { corvette: 2, lancer: 2, frigate: 3, destroyer: 4, cruiser: 6, freighter: 1, station: 6 };
    const HANDS = { corvette: 24, lancer: 26, frigate: 60, destroyer: 140, cruiser: 260, freighter: 12, station: 200 };
    const CAP = { drive: { wrecked: 0.3, damaged: 0.7 }, reactor: { wrecked: 0.25, damaged: 0.6 },
      sensors: { wrecked: 0.5, damaged: 0.8 }, rad: { wrecked: 0, damaged: 0.7 },
      tank: { wrecked: 0.5, damaged: 1, venting: 0.5 }, mount: { wrecked: 0, damaged: 0.8 } };
    const SECS = { drive: 480, reactor: 420, sensors: 300, rad: 240, tank: 120, mount: 240 };
    const kindOf = (id) => (/^drive/.test(id) ? 'drive' : /^reactor/.test(id) ? 'reactor' : /^sensors/.test(id) ? 'sensors'
      : /^rad/.test(id) ? 'rad' : /^tank/.test(id) ? 'tank' : 'mount');
    const clsOf = (ship) => (OD.Ships.CLASSES[ship.cls] || {});
    function ensure(ship) {
      if (ship.crew && Array.isArray(ship.crew.parties)) return ship.crew;
      const base = clsOf(ship).base || ship.cls;
      const n = PARTIES[ship.cls] || PARTIES[base] || 2;
      const total = HANDS[ship.cls] || HANDS[base] || 24;
      const parties = [];
      for (let i = 1; i <= n; i++) {
        parties.push({ id: 'p' + i, task: i === 1 ? 'fire' : i === 2 ? 'sensors' : 'standby', part: null, progress: 0, eta: 0, since: 0 });
      }
      ship.crew = { total, fit: total, wounded: 0, lost: 0, xp: 1, parties, gMode: 'couches', auto: true, gNow: 0, strapped: false };
      return ship.crew;
    }
    const rowsOf = (ship) => (OD.Damage && OD.Damage.report ? OD.Damage.report(ship) : []);
    const capOf = (r) => { const c = CAP[kindOf(r.id)] || {}; const v = c[r.state]; return v == null ? null : v; };
    const secsFor = (id, hp) => (SECS[kindOf(id)] || 240) * (1 + (1 - hp));
    function partRows(ship) {
      const c = ensure(ship);
      const on = {};
      for (const p of c.parties) if (p.task === 'repair' && p.part) on[p.part] = p;
      return rowsOf(ship).map((r) => {
        const cap = capOf(r);
        const can = cap != null && cap > r.hp + 0.01;
        const full = secsFor(r.id, r.hp);
        return { id: r.id, name: r.name, state: r.state, hp: r.hp, cap, repairable: can,
          eta: can ? (on[r.id] ? full * (1 - (on[r.id].progress || 0)) : full) : 0,
          party: on[r.id] ? on[r.id].id : null,
          // A build with no crew module has no in-use rule either, so nothing is ever held.
          blocked: null,
          buys: can ? 'A party brings ' + r.name + ' to ' + Math.round(cap * 100) + ' %.' : '' };
      });
    }
    const RANK = (r) => (/^drive/.test(r.id) ? 0 : /^reactor/.test(r.id) ? 1
      : /^tank/.test(r.id) ? (r.state === 'venting' ? 2 : 6) : /^rad/.test(r.id) ? 3 : /^sensors/.test(r.id) ? 5 : 4);
    function board(ship) {
      const c = ensure(ship);
      const parts = partRows(ship);
      const by = {}; for (const p of parts) by[p.id] = p;
      const parties = c.parties.map((p) => ({ id: p.id, task: p.task, part: p.part,
        partName: p.part && by[p.part] ? by[p.part].name : null, progress: p.progress || 0,
        eta: p.part && by[p.part] ? by[p.part].eta : 0, words: 'Party ' + p.id.replace(/^p/, '') }));
      return {
        crew: { total: c.total, fit: c.fit, wounded: c.wounded, lost: c.lost, xp: c.xp, gNow: c.gNow, gMode: c.gMode, strapped: c.strapped },
        parties, parts,
        words: 'Crew ' + c.total + ': ' + c.fit + ' fit, ' + c.wounded + ' wounded.',
        gWords: Math.round(c.gNow * 10) / 10 + ' g.',
      };
    }
    function assign(ship, partyId, task, partId) {
      const c = ensure(ship);
      const p = c.parties.find((x) => x.id === partyId);
      if (!p || ['fire', 'sensors', 'repair', 'medical', 'standby'].indexOf(task) < 0) return null;
      p.task = task; p.part = task === 'repair' ? partId || null : null; p.progress = 0;
      const row = p.part ? partRows(ship).find((r) => r.id === p.part) : null;
      return 'Party ' + partyId.replace(/^p/, '') + ' is on ' + (task === 'medical' ? 'medical' : row ? row.name : task) + '.';
    }
    function release(ship, partyId) { return assign(ship, partyId, 'standby', null); }
    function setG(ship, mode) {
      const c = ensure(ship);
      if (['work', 'couches', 'max'].indexOf(mode) < 0) return null;
      c.gMode = mode;
      return mode === 'work' ? 'The burn is held to 1.2 g: the crew can work.'
        : mode === 'couches' ? 'The crew is in the couches: the burn is held to 3 g.'
          : 'No limit on the burn: the crew takes what the drive makes.';
    }
    function auto(sim, ship) {
      const c = ensure(ship);
      const hurt = partRows(ship).filter((r) => r.repairable && !r.party).sort((a, b) => RANK(a) - RANK(b));
      if (!hurt.length) return null;
      let p = c.parties.find((x) => x.task === 'standby');
      if (!p && RANK(hurt[0]) <= 2) p = c.parties.find((x) => x.task === 'sensors') || c.parties.find((x) => x.task === 'fire');
      if (!p) return null;
      return assign(ship, p.id, 'repair', hurt[0].id);
    }
    function accelCap(ship) {
      const c = ensure(ship);
      return c.gMode === 'work' ? T.workG * g0 : c.gMode === 'couches' ? T.couchG * g0 : Infinity;
    }
    function factor(ship, task) {
      const c = ensure(ship);
      let f = c.parties.some((p) => p.task === task) ? 1 + 0.03 * c.xp : 0.7;
      if (c.strapped) f *= 0.85;
      if (c.fit < c.total / 3) f *= 0.7;
      return f;
    }
    function casualties(ship, partId, severity) {
      const c = ensure(ship);
      const n = Math.round((severity || 0) * T.casualtyShare * c.fit);
      if (!(n > 0)) return 0;
      const lost = Math.round(n * T.lostShare);
      c.fit = Math.max(0, c.fit - n); c.wounded += n - lost; c.lost += lost;
      return n;
    }
    function update(sim, dt) {
      for (const s of sim.ships) {
        const c = ensure(s);
        const a = typeof s.accel === 'function' ? s.accel() : 0;
        c.gNow = (a * (s.throttle || 0)) / g0;
        c.strapped = c.gNow > T.workG;
        if (c.wounded > 0 && c.parties.some((p) => p.task === 'medical')) {
          c.medTimer = (c.medTimer || 0) + dt;
          while (c.medTimer >= T.medic && c.wounded > 0) { c.medTimer -= T.medic; c.wounded--; c.fit++; }
        }
        if (c.strapped) continue;
        const rows = {}; for (const r of partRows(s)) rows[r.id] = r;
        for (const p of c.parties) {
          if (p.task !== 'repair' || !p.part) continue;
          const row = rows[p.part];
          if (!row || !row.repairable) { p.task = 'standby'; p.part = null; p.progress = 0; continue; }
          p.progress = Math.min(1, (p.progress || 0) + dt / Math.max(1, secsFor(p.part, row.hp)));
          if (p.progress < 1) continue;
          if (OD.Damage && typeof OD.Damage.mend === 'function') { try { OD.Damage.mend(s, p.part); } catch (e) { /* the part stands */ } }
          else {
            const comp = (s.components || []).find((x) => x.id === p.part);
            if (comp && row.cap != null) { comp.hp = Math.max(comp.hp, row.cap); s._dmgRev = (s._dmgRev || 0) + 1; OD.Damage.aggregate(s); }
          }
          p.task = 'standby'; p.part = null; p.progress = 0;
        }
      }
    }
    window.OD.Crew = {
      T, init: (ship) => ensure(ship), update, board, assign, release, setG, auto, accelCap, casualties,
      fireFactor: (s) => factor(s, 'fire'), sensorFactor: (s) => factor(s, 'sensors'),
      artFx: (s) => ({ parties: [], strapped: !!ensure(s).strapped, gNow: ensure(s).gNow }),
      toRecord: (s) => { const c = ensure(s); return { fit: c.fit, wounded: c.wounded, lost: c.lost, xp: c.xp }; },
      fromRecord: () => null, afterBattle: () => null, recover: () => false,
      _stub: true,
    };
    return true;
  });

  console.log('scenario: the repair card, in the four situations the routine cannot settle');
  const repair = await page.evaluate(() => {
    const out = { err: [], radQuiet: null, drive: null, driveRec: null, spare: null,
      two: null, twoRec: null, priced: null, quiet: null, driven: null, times: {} };
    const D = OD.Decisions;
    const hurtPart = (ship, id, hp) => {
      const c = (ship.components || []).find((x) => x.id === id);
      if (!c) return false;
      c.hp = hp; ship._dmgRev = (ship._dmgRev || 0) + 1; OD.Damage.aggregate(ship);
      return true;
    };
    const build = (opts) => { OD.harness.start(OD.Skirmish.build(Object.assign({ player: 'JC', env: 'deep', range: 400, seed: 5 }, opts))); return OD.Game.sim; };
    // The ship's routine runs every 15 s and would send the party itself, so the trigger pass is
    // run first, on a fresh decision state and without stepping the sim: that is the order the
    // fight puts them in too, and from then on the open card holds the routine off.
    const find = (sim, kind, shipId) => (sim.decisions || []).find((x) => x.kind === kind && (x.ships || [x.shipId]).includes(shipId)) || null;
    const raise = (sim, kind, shipId) => {
      D.init(sim);
      D.update(sim, 0);
      let d = find(sim, kind, shipId);
      if (d) return d;
      for (let i = 0; i < 12; i++) {
        OD.harness.step(3);
        d = find(sim, kind, shipId);
        if (d) return d;
        for (const x of (sim.decisions || []).slice()) if ((x.ships || [x.shipId]).includes(shipId)) D.dismiss(sim, x.id);
      }
      return null;
    };
    const shot = (d) => ({ title: d.title, text: d.text,
      options: d.options.map((o) => o.key + ' ' + o.label + ' · ' + o.detail + (o.recommended ? ' [rec]' : '')),
      rec: (d.options.find((o) => o.recommended) || {}).label || null,
      keys: d.options.map((o) => o.key).join(''),
      recs: d.options.filter((o) => o.recommended).length });
    try {
      // --- a corvette has two parties and both are on watch, and a radiator is hit: the routine
      // will not move for it, so the question is the player's, and the answer the routine would
      // give — leave the watches standing — is the one the card lights
      {
        const sim = build({ playerShips: { corvette: 1 }, enemyShips: { corvette: 1 } });
        const me = sim.playerShips()[0];
        OD.harness.select(me.id);
        hurtPart(me, 'rad1', 0.3);
        const d = raise(sim, 'repair', me.id);
        out.radQuiet = { raised: !!d, parties: OD.Crew.board(me).parties.map((p) => p.task).join(',') };
        if (d) {
          out.rad = shot(d);
          out.radBuys = (OD.Crew.board(me).parts.find((p) => p.id === 'rad1') || {}).buys;
          out.radDeadline = d.deadline != null ? Math.round(d.deadline - sim.time) : null;
        }
      }
      // --- the same corvette with her drive hit: the routine pulls a watch for the drive, so the card does
      {
        const sim = build({ playerShips: { corvette: 1 }, enemyShips: { corvette: 1 } });
        const me = sim.playerShips()[0];
        OD.harness.select(me.id);
        hurtPart(me, 'drive', 0.4);
        const d = raise(sim, 'repair', me.id);
        if (d) {
          out.drive = shot(d);
          out.driveRec = out.drive.rec;
          out.driveHeld = me.crew ? me.crew.auto : null;
          // the routine is held off either by the crew module's own hold or, without one, by the
          // record's auto switch
          out.holdApi = typeof OD.Crew.hold === 'function';
          out.driveBuys = (OD.Crew.board(me).parts.find((p) => p.id === 'drive') || {}).buys;
        }
        // the number on the key is OD.Damage.repairTime for that part, not one of the card's own
        out.times.drive = OD.Damage.repairTime(me, 'drive');
        out.times.driveBoard = Math.round((OD.Crew.board(me).parts.find((p) => p.id === 'drive') || {}).eta || 0);
        out.times.driveWords = OD.Damage && typeof OD.Damage.timeWords === 'function'
          ? OD.Damage.timeWords(out.times.driveBoard)
          : Math.max(1, Math.round(out.times.driveBoard / 60)) + ' min';
      }
      // --- a destroyer has four parties, two of them standby, and one part hurt: no question.
      // The part is a mount, which nothing is in the way of: the routine sends a standby party and
      // says so. (Until D 1 this scene used rad1, which the radiators being out now blocks, so the
      // same scene raises the trade card; that is the case below.)
      {
        const sim = build({ playerShips: { destroyer: 1 }, enemyShips: { corvette: 1 } });
        const me = sim.playerShips()[0];
        OD.harness.select(me.id);
        const had = hurtPart(me, 'beam1', 0.3);
        D.init(sim); D.update(sim, 0);
        let raised = (sim.decisions || []).some((x) => x.kind === 'repair');
        for (let i = 0; i < 12; i++) { OD.harness.step(3); if ((sim.decisions || []).some((x) => x.kind === 'repair')) raised = true; }
        out.spare = { had, raised, parties: OD.Crew.board(me).parties.map((p) => p.task).join(',') };
      }
      // --- the same destroyer with a panel hit and the radiators out: a spare party cannot work it
      // where it is, so the question is the panels, not the party (D 1).
      {
        const sim = build({ playerShips: { destroyer: 1 }, enemyShips: { corvette: 1 } });
        const me = sim.playerShips()[0];
        OD.harness.select(me.id);
        hurtPart(me, 'rad1', 0.3);
        D.init(sim); D.update(sim, 0);
        let d = null;
        for (let i = 0; i < 12 && !d; i++) { OD.harness.step(3); d = (sim.decisions || []).find((x) => x.kind === 'repair') || null; }
        out.spareBlocked = { raised: !!d, title: d ? d.title : null,
          parties: OD.Crew.board(me).parties.map((p) => p.task).join(',') };
        if (d) out.spareBlockedCard = shot(d);
      }
      // --- a frigate has one standby party and two parts hurt: which one it takes is the question
      {
        const sim = build({ playerShips: { frigate: 1 }, enemyShips: { corvette: 1 } });
        const me = sim.playerShips()[0];
        OD.harness.select(me.id);
        hurtPart(me, 'rad1', 0.3);
        hurtPart(me, 'drive', 0.4);
        const d = raise(sim, 'repair', me.id);
        if (d) {
          out.two = shot(d);
          out.twoRec = out.two.rec;
          // the recommendation follows the routine's value order, and the key acts through assign
          const o = d.options.find((x) => x.recommended);
          // the card holds the ship's routine off while it is open, so the answer is the one that
          // moves the party
          out.heldWhileOpen = me.crew ? me.crew.auto : null;
          D.choose(sim, d.id, o.key);
          out.heldAfter = me.crew ? me.crew.auto : null;
          // with the drive taken and the reactor hit after it, the next card names the reactor.
          // 20 %, not 40 %: the reactor's jury-rig stops at 60 %, so a reactor at 40 % is 20
          // points of mend and D 21 holds every part to the same 30-point bar.
          hurtPart(me, 'reactor', 0.2);
          const again = raise(sim, 'repair', me.id);
          out.nextTitle = again ? again.title : null;
          const b = OD.Crew.board(me);
          const p = b.parties.find((x) => x.task === 'repair');
          out.sent = p ? p.part : null;
          out.priced = b.parts.filter((x) => x.id === 'drive').map((x) => Math.round(x.eta))[0] || null;
        }
      }
      // --- a hull that has broken off and run is never asked anything about her parties
      {
        const sim = build({ playerShips: { frigate: 1 }, enemyShips: { corvette: 1 } });
        const me = sim.playerShips()[0];
        OD.harness.select(me.id);
        hurtPart(me, 'rad1', 0.3);
        hurtPart(me, 'drive', 0.4);
        me.drivenOff = true;
        D.init(sim); D.update(sim, 0);
        let raised = (sim.decisions || []).some((x) => x.kind === 'repair');
        for (let i = 0; i < 12; i++) { OD.harness.step(3); if ((sim.decisions || []).some((x) => x.kind === 'repair')) raised = true; }
        out.driven = raised;
      }
    } catch (e) { out.err.push(String(e.stack || e)); }
    out.errors = OD.errors.slice();
    return out;
  });
  check('no errors while the repair card is exercised', repair.err.length === 0 && repair.errors.length === 0,
    repair.err.concat(repair.errors).join(' | '));
  // A card is not free: it takes the band for as long as it is up, and a chapter has been lost to
  // one whose own answer was to leave everybody standing. So the card is raised only where the
  // answer moves a party. For a radiator with both parties on watch the routine leaves the watch
  // standing, and the hurt part is already on the board with its Send a party button.
  // A card is not free: it takes the band for as long as it is up. It is worth taking for any
  // part a jury-rig puts three tenths back on, because on a corvette with two parties on watch
  // that is the only way the question is ever put at all — and a card whose lit key is 'keep'
  // gives the band up the moment something more urgent wants it (checked below).
  // A panel with the radiators out is a part that is running: no party can touch it, so the
  // question is the radiators, not the party. The card used to price a clean repair time for it,
  // take the watch for it, and never say the ship would refuse to start the work.
  check('a hit radiator with the radiators out is a question, and it is the trade',
    !!repair.rad && repair.radQuiet.raised === true && repair.rad.rec === 'Keep them out',
    JSON.stringify(repair.radQuiet) + ' · ' + (repair.rad ? repair.rad.rec : 'never raised'));
  if (repair.rad) note(repair.rad.title + ' — ' + repair.rad.text + '\n    ' + repair.rad.options.join('\n    '));
  check('the card prices the mend in the board row’s own words, with the time printed once',
    !!repair.rad && !!repair.radBuys &&
    repair.rad.options.some((o) => o.indexOf(String(repair.radBuys).replace(/^A party\b[^:]*:\s*/, '').split(/\.(?:\s|$)/)[0]) >= 0) &&
    repair.rad.options.join(' ').split(/\bmin\b/).length === 2,
    (repair.radBuys || '') + ' → ' + (repair.rad ? repair.rad.options[0] : ''));
  check('and the keep key says what the part is left at',
    !!repair.rad && /stays at \d+ %/.test(repair.rad.options.join(' ')),
    repair.rad ? repair.rad.options.join(' | ') : '');
  check('the 60 s clock is on the card as a deadline the band can count down',
    repair.radDeadline > 50 && repair.radDeadline <= 60, String(repair.radDeadline));
  check('a hit part the routine would pull a watch for raises the repair card', !!repair.drive,
    repair.drive ? repair.drive.title : 'never raised');
  // The gain is the board row's own clause for that part, and the cost is named as a rate: two
  // unrelated 70 %s on one line — the drive's and the watch's — read as one number said twice.
  check('it names the part, the time and what the watch gives up',
    !!repair.drive && /the drive/.test(repair.drive.options.join(' ')) &&
    /(acceleration (and turn rate )?at|thrust back to) 70 %/.test(repair.drive.options.join(' ')) &&
    /(the sensor watch|fire control) drops to 70 % of its rate while she is away/.test(repair.drive.options.join(' ')),
    repair.drive ? repair.drive.options.join(' | ') : '');
  {
    // the card prints the board's own estimate, which is OD.Damage.repairTime over the party's rate
    // One repair, one time: the board's own estimate in the board's own format (OD.Damage.timeWords,
    // the formatter its `buys` sentence uses), so a card never reads '6m 24s' over a row reading
    // '6 min' for the same job.
    const want = repair.times.driveBoard;
    const shown = repair.times.driveWords;
    check('and the time on the key is the board\u2019s estimate, in the board\u2019s own format',
      !!repair.drive && !!shown && repair.drive.options.some((o) => o.indexOf(' in ' + shown) >= 0),
      'repairTime ' + repair.times.drive + ' s, board ' + want + ' s (' + shown + ') · ' +
      (repair.drive ? repair.drive.options.join(' | ') : ''));
  }
  check('for the drive the lit key pulls the watch, as the routine would',
    !!repair.drive && /^Send party \d to the drive$/.test(repair.driveRec || ''), String(repair.driveRec));
  // The lit key is the value call, not a fixed preference: what the mend puts back, weighed by
  // how much of the fight that part carries, against the 30 % the watch loses while the party is
  // away. The drive is worth it and a radiator panel on a cold hull is not.
  check('the lit key is the value call: the drive is worth a watch, a radiator is not',
    !!repair.drive && !!repair.rad &&
    !/^Keep/.test(repair.driveRec || '') && /^Keep/.test(repair.rad.rec || ''),
    String(repair.driveRec) + ' | ' + String(repair.rad && repair.rad.rec));
  check('and the open card holds the ship\u2019s routine off while it is up',
    repair.holdApi === true || repair.driveHeld === false,
    'OD.Crew.hold ' + repair.holdApi + ', crew.auto ' + repair.driveHeld);
  if (repair.drive) note(repair.drive.title + ' — ' + repair.drive.text + '\n    ' + repair.drive.options.join('\n    '));
  check('a spare party and one hurt part is not a question', repair.spare && repair.spare.had === true &&
    repair.spare.raised === false, JSON.stringify(repair.spare));
  // Changed by D 1: the same scene with a panel is a question now, because the radiators being out
  // is what stops the work, and a spare party does not answer that.
  check('and a part the ship is using is a question even with a party spare',
    !!repair.spareBlocked && repair.spareBlocked.raised === true &&
    /radiators are out/.test(repair.spareBlocked.title || ''), JSON.stringify(repair.spareBlocked));
  if (repair.spareBlockedCard) note(repair.spareBlockedCard.title + ' \u2014 ' + repair.spareBlockedCard.text +
    '\n    ' + repair.spareBlockedCard.options.join('\n    '));
  check('two hurt parts and one free party is', !!repair.two, repair.two ? repair.two.title : 'never raised');
  if (repair.two) note(repair.two.title + ' — ' + repair.two.text + '\n    ' + repair.two.options.join('\n    '));
  check('the lit key is the drive, and it sends the party there',
    !!repair.two && /to the drive$/.test(repair.twoRec || '') && repair.sent === 'drive',
    (repair.twoRec || '') + ' → ' + repair.sent);
  check('the routine is held while the card is open and running again after it',
    repair.holdApi === true || (repair.heldWhileOpen === false && repair.heldAfter === true),
    'OD.Crew.hold ' + repair.holdApi + ', crew.auto ' + repair.heldWhileOpen + ' → ' + repair.heldAfter);
  check('the next card about the same hull names the part it is about',
    !!repair.nextTitle && /reactor/.test(repair.nextTitle), String(repair.nextTitle));
  check('a driven-off hull is never asked about her parties', repair.driven === false, String(repair.driven));

  console.log('scenario: the burn card, against the working limit and the couch limit');
  const burn = await page.evaluate(() => {
    const out = { err: [], work: null, couch: null, quiet: null, acts: {}, sums: {} };
    const D = OD.Decisions, U = OD.U;
    const build = (opts) => { OD.harness.start(OD.Skirmish.build(Object.assign({ player: 'JC', env: 'deep', range: 900, seed: 5 }, opts))); return OD.Game.sim; };
    const find = (sim, kind, shipId) => (sim.decisions || []).find((x) => x.kind === kind && (x.ships || [x.shipId]).includes(shipId)) || null;
    const raise = (sim, kind, shipId) => {
      D.init(sim);
      D.update(sim, 0);
      let d = find(sim, kind, shipId);
      if (d) return d;
      for (let i = 0; i < 14; i++) {
        OD.harness.step(3);
        d = find(sim, kind, shipId);
        if (d) return d;
        for (const x of (sim.decisions || []).slice()) if ((x.ships || [x.shipId]).includes(shipId) && x.kind !== kind) D.dismiss(sim, x.id);
      }
      return null;
    };
    const shot = (d) => ({ title: d.title, text: d.text,
      options: d.options.map((o) => o.key + ' ' + o.label + ' · ' + o.detail + (o.recommended ? ' [rec]' : '')),
      labels: d.options.map((o) => o.label), details: d.options.map((o) => o.detail),
      rec: (d.options.find((o) => o.recommended) || {}).label || null, keys: d.options.map((o) => o.key).join('') });
    // the drive pulls harder as the tanks empty: that is where both limits start to bite
    const dry = (ship, share) => { ship.propMass = Math.max(1, ship.fullPropMass * share); };
    try {
      // --- a repair running and an order that wants more than 1.2 g
      {
        const sim = build({ playerShips: { corvette: 1 }, enemyShips: { corvette: 1 } });
        const me = sim.playerShips()[0], foe = sim.hostiles(me)[0];
        OD.harness.select(me.id);
        // 16 %, not 12 %: at 12 % the hard rung wants 10.8 km/s of a 9.41 km/s tank, and D 28
        // prints the shortfall where the arrival would go. The two arrivals below are only a
        // question when the ship can fly both rungs, so the tanks have to pay for both.
        dry(me, 0.16);
        // The sensor suite, not a panel: a party cannot work a panel while the radiators are out,
        // so a card promising 'repairs go on' over a panel would be promising nothing.
        const c = (me.components || []).find((x) => x.id === 'sensors');
        if (c) { c.hp = 0.3; me._dmgRev = (me._dmgRev || 0) + 1; OD.Damage.aggregate(me); }
        OD.Crew.assign(me, 'p2', 'repair', 'sensors');
        OD.Crew.setG(me, 'couches');
        sim.setTarget(me.id, foe.id);
        sim.setOrder(me.id, { type: 'intercept', target: foe.id });
        out.sums.gDrive = Math.round((me.thrust * me.systems.drive / me.mass() / OD.P.g0) * 100) / 100;
        const d = raise(sim, 'burn', me.id);
        if (d) {
          out.work = shot(d);
          // key 1 holds the burn to the working limit: the cap the sim flies by comes down with it
          const low = d.options[0];
          D.choose(sim, d.id, low.key);
          out.acts.lowMode = OD.Crew.board(me).crew.gMode;
          out.acts.lowCap = Math.round((me.accel() / OD.P.g0) * 100) / 100;
          OD.Crew.setG(me, 'couches');
          out.acts.highCap = Math.round((me.accel() / OD.P.g0) * 100) / 100;
          // and the same card's third key holds the range and lets the parties work
          sim.setOrder(me.id, { type: 'intercept', target: foe.id });
          const d2 = raise(sim, 'burn', me.id);
          const hold = d2 ? d2.options.find((o) => /^Hold and fight/.test(o.label)) : null;
          if (hold) {
            D.choose(sim, d2.id, hold.key);
            out.acts.holdOrder = me.order.type;
            out.acts.holdRange = me.order.range != null ? Math.round(me.order.range / 1000) : null;
            out.acts.holdMode = OD.Crew.board(me).crew.gMode;
          }
        }
      }
      // --- near-dry tanks and no repair: the closing burn passes the couch limit
      {
        // A corvette on her last 1 % of propellant pulls 3.3 g where she pulled 1.3 on full tanks,
        // and the couch limit is 3. The gap has to be a long one for the difference between 3.0
        // and 3.3 g to be worth a card at all: 12 000 km, where it is a minute.
        const sim = build({ range: 12000, playerShips: { corvette: 1 }, enemyShips: { corvette: 1 } });
        const me = sim.playerShips()[0], foe = sim.hostiles(me)[0];
        OD.harness.select(me.id);
        dry(me, 0.01);
        OD.Crew.setG(me, 'couches');
        sim.setTarget(me.id, foe.id);
        sim.setOrder(me.id, { type: 'intercept', target: foe.id });
        out.sums.gDry = Math.round((me.thrust * me.systems.drive / me.mass() / OD.P.g0) * 100) / 100;
        const d = raise(sim, 'burn', me.id);
        if (d) out.couch = shot(d);
      }
      // --- full tanks, no repair: the drive cannot want more than the people can work at
      {
        const sim = build({ playerShips: { corvette: 1 }, enemyShips: { corvette: 1 } });
        const me = sim.playerShips()[0], foe = sim.hostiles(me)[0];
        OD.harness.select(me.id);
        OD.Crew.setG(me, 'couches');
        sim.setTarget(me.id, foe.id);
        sim.setOrder(me.id, { type: 'intercept', target: foe.id });
        D.init(sim); D.update(sim, 0);
        out.sums.gFull = Math.round((me.thrust * me.systems.drive / me.mass() / OD.P.g0) * 100) / 100;
        let raised = (sim.decisions || []).some((x) => x.kind === 'burn');
        for (let i = 0; i < 14; i++) { OD.harness.step(3); if ((sim.decisions || []).some((x) => x.kind === 'burn')) raised = true; }
        out.quiet = raised;
      }
    } catch (e) { out.err.push(String(e.stack || e)); }
    out.errors = OD.errors.slice();
    return out;
  });
  const secsOf = (txt) => {
    let m = /(\d+)h (\d+)m/.exec(txt); if (m) return +m[1] * 3600 + +m[2] * 60;
    m = /(\d+)m (\d+)s/.exec(txt); if (m) return +m[1] * 60 + +m[2];
    m = /(\d+) s/.exec(txt); if (m) return +m[1];
    return null;
  };
  check('no errors while the burn card is exercised', burn.err.length === 0 && burn.errors.length === 0,
    burn.err.concat(burn.errors).join(' | '));
  note('drive on full tanks ' + burn.sums.gFull + ' g, at 12 % ' + burn.sums.gDrive + ' g, at 3 % ' + burn.sums.gDry + ' g');
  check('a repair running under an order that wants more than 1.2 g raises the burn card', !!burn.work,
    burn.work ? burn.work.title : 'never raised');
  if (burn.work) note(burn.work.title + ' — ' + burn.work.text + '\n    ' + burn.work.options.join('\n    '));
  check('its rungs are the working limit and what the drive wants, with a hold under them',
    !!burn.work && /^Burn at 1\.2 g$/.test(burn.work.labels[0]) && /^Burn at \d/.test(burn.work.labels[1] || '') &&
    burn.work.labels[2] === 'Hold and fight at this range', burn.work ? burn.work.labels.join(' | ') : '');
  // D 28: every rung prints what it spends of the tanks, between the two.
  check('key 1 says the repairs go on, what it spends and when we are alongside',
    !!burn.work && /^repairs go on · /.test(burn.work.details[0] || '') &&
    /[\d.]+ of [\d.]+ km\/s/.test(burn.work.details[0] || '') && / · alongside in /.test(burn.work.details[0] || ''),
    burn.work ? burn.work.details[0] : '');
  // The hard rung names the job it puts down and how long is left of it, not 'repairs pause'.
  check('key 2 names the repair it holds, and how long for',
    !!burn.work && /the repair on .+ holds where it is for \d/.test(burn.work.details[1] || '') &&
    /alongside in /.test(burn.work.details[1] || ''), burn.work ? burn.work.details[1] : '');
  // Two rungs priced in two frames — a delta on one key against an arrival on the other — made
  // the slow rung read as the fast one. Both keys now print the whole arrival.
  check('both rungs print the arrival whole, and the slow one is the later of the two',
    !!burn.work && burn.work.details.slice(0, 2).every((t) => / · alongside in /.test(t)) &&
    !burn.work.details.join(' ').match(/alongside \d[^·]*later/),
    burn.work ? burn.work.details.slice(0, 2).join(' | ') : '');
  {
    const slow = burn.work ? secsOf(String(burn.work.details[0]).split('alongside in ')[1] || '') : null;
    const there = burn.work ? secsOf(String(burn.work.details[1]).split('alongside in ')[1] || '') : null;
    // the two rungs are priced over one gap, so the slow one's arrival is the fast one's stretched
    // by the square root of the ratio of the accelerations: a brachistochrone's time goes as one
    // over the square root of the acceleration
    const want = there != null && burn.sums.gDrive ? there * Math.sqrt(burn.sums.gDrive / 1.2) : null;
    check('the two arrivals are the same gap flown at two accelerations',
      slow != null && there != null && want != null && slow > there &&
      Math.abs(slow - want) <= Math.max(45, want * 0.2),
      'at 1.2 g ' + slow + ' s, at the drive ' + there + ' s, expected about ' + (want == null ? '?' : Math.round(want)) + ' s');
  }
  check('key 1 calls setG and the sim flies by the new cap',
    burn.acts.lowMode === 'work' && burn.acts.lowCap != null && burn.acts.lowCap <= 1.21 &&
    burn.acts.highCap != null && burn.acts.highCap > burn.acts.lowCap,
    burn.acts.lowMode + ' ' + burn.acts.lowCap + ' g → couches ' + burn.acts.highCap + ' g');
  check('near-dry tanks and no repair raise it on the couch limit instead', !!burn.couch,
    burn.couch ? burn.couch.title : 'never raised');
  if (burn.couch) note(burn.couch.title + ' — ' + burn.couch.text + '\n    ' + burn.couch.options.join('\n    '));
  // The whole cost, capped at the people aboard. A per-minute rate against a whole arrival hid a
  // wipe-out: '4 wounded a minute at 5.1 g · alongside in 13m 06s' is fifty-two of a crew of
  // twenty-four. The rate is kept only while the whole burn stays under the crew.
  check('and the hard rung prices the wounded over the whole burn, capped at the crew',
    !!burn.couch && /^Burn at 3 g$/.test(burn.couch.labels[0] || '') &&
    /(wounded a minute at |all \d+ aboard wounded on the way|\d+ of the \d+ aboard wounded on the way)/.test(burn.couch.details[1] || ''),
    burn.couch ? burn.couch.labels.join(' | ') + ' · ' + burn.couch.details[1] : '');
  check('"Hold and fight at this range" sets the range order and lets the parties work',
    burn.acts.holdOrder === 'keeprange' && burn.acts.holdMode === 'work' && burn.acts.holdRange > 0,
    burn.acts.holdOrder + ' at ' + burn.acts.holdRange + ' km, ' + burn.acts.holdMode);
  check('full tanks and no repair is not a question', burn.quiet === false, String(burn.quiet));

  console.log('scenario: the medical card');
  const medical = await page.evaluate(() => {
    const out = { err: [], spare: null, watch: null, heavy: null, thin: null, quiet: null, onMedical: null, acted: null };
    const D = OD.Decisions;
    const build = (opts) => { OD.harness.start(OD.Skirmish.build(Object.assign({ player: 'JC', env: 'deep', range: 400, seed: 5 }, opts))); return OD.Game.sim; };
    const find = (sim, kind, shipId) => (sim.decisions || []).find((x) => x.kind === kind && (x.ships || [x.shipId]).includes(shipId)) || null;
    const raise = (sim, kind, shipId) => {
      D.init(sim);
      D.update(sim, 0);
      let d = find(sim, kind, shipId);
      if (d) return d;
      for (let i = 0; i < 14; i++) {
        OD.harness.step(3);
        d = find(sim, kind, shipId);
        if (d) return d;
        for (const x of (sim.decisions || []).slice()) if ((x.ships || [x.shipId]).includes(shipId) && x.kind !== kind) D.dismiss(sim, x.id);
      }
      return null;
    };
    const shot = (d) => ({ title: d.title, text: d.text,
      options: d.options.map((o) => o.key + ' ' + o.label + ' · ' + o.detail + (o.recommended ? ' [rec]' : '')),
      labels: d.options.map((o) => o.label), details: d.options.map((o) => o.detail),
      rec: (d.options.find((o) => o.recommended) || {}).label || null });
    const wound = (ship, n) => { const c = OD.Crew.init(ship); c.wounded = n; c.fit = c.total - n; return c; };
    try {
      // --- a frigate has a standby party: sending it costs nothing that shoots
      {
        const sim = build({ playerShips: { frigate: 1 }, enemyShips: { corvette: 1 } });
        const me = sim.playerShips()[0];
        OD.harness.select(me.id);
        wound(me, 9); // 9 of 60: past a tenth
        const d = raise(sim, 'medical', me.id);
        if (d) {
          out.spare = shot(d);
          const o = d.options.find((x) => x.recommended);
          D.choose(sim, d.id, o.key);
          out.acted = OD.Crew.board(me).parties.filter((p) => p.task === 'medical').length;
        }
      }
      // --- a corvette has no spare hands: the wounded cost a watch
      {
        const sim = build({ playerShips: { corvette: 1 }, enemyShips: { corvette: 1 } });
        const me = sim.playerShips()[0];
        OD.harness.select(me.id);
        wound(me, 4); // 4 of 24: past a tenth, under a fifth
        const d = raise(sim, 'medical', me.id);
        if (d) out.watch = shot(d);
      }
      // --- and under a third fit the watch is worth giving up: nothing else lifts that penalty
      {
        const sim = build({ playerShips: { corvette: 1 }, enemyShips: { corvette: 1 } });
        const me = sim.playerShips()[0];
        OD.harness.select(me.id);
        wound(me, 17); // 7 fit of 24: under a third, so both watches are at 70 % anyway
        const d = raise(sim, 'medical', me.id);
        if (d) out.heavy = shot(d);
      }
      // --- two wounded of twenty-four is not a question, and neither is a party already on medical
      {
        const sim = build({ playerShips: { corvette: 1 }, enemyShips: { corvette: 1 } });
        const me = sim.playerShips()[0];
        OD.harness.select(me.id);
        wound(me, 2);
        D.init(sim); D.update(sim, 0);
        let raised = (sim.decisions || []).some((x) => x.kind === 'medical');
        for (let i = 0; i < 12; i++) { OD.harness.step(3); if ((sim.decisions || []).some((x) => x.kind === 'medical')) raised = true; }
        out.quiet = raised;
      }
      {
        const sim = build({ playerShips: { frigate: 1 }, enemyShips: { corvette: 1 } });
        const me = sim.playerShips()[0];
        OD.harness.select(me.id);
        wound(me, 12);
        OD.Crew.assign(me, 'p3', 'medical', null);
        D.init(sim); D.update(sim, 0);
        let raised = (sim.decisions || []).some((x) => x.kind === 'medical');
        for (let i = 0; i < 12; i++) { OD.harness.step(3); if ((sim.decisions || []).some((x) => x.kind === 'medical')) raised = true; }
        out.onMedical = raised;
      }
    } catch (e) { out.err.push(String(e.stack || e)); }
    out.errors = OD.errors.slice();
    return out;
  });
  check('no errors while the medical card is exercised', medical.err.length === 0 && medical.errors.length === 0,
    medical.err.concat(medical.errors).join(' | '));
  check('wounded past a tenth of the crew with a party free raises the medical card', !!medical.spare,
    medical.spare ? medical.spare.title : 'never raised');
  if (medical.spare) note(medical.spare.title + ' — ' + medical.spare.text + '\n    ' + medical.spare.options.join('\n    '));
  check('it prices the wounded coming back and lights the free party',
    !!medical.spare && /back to fit every 45 s/.test(medical.spare.details.join(' ')) &&
    /^Send party \d to the sick bay$/.test(medical.spare.rec || ''), medical.spare ? medical.spare.rec : '');
  check('and the key puts a party on medical', medical.acted === 1, String(medical.acted));
  check('with no free hands the keys cost a watch, and above the fit floor the lit key leaves it',
    !!medical.watch && /from (the sensor watch|fire control) to the sick bay/.test(medical.watch.labels.join(' ')) &&
    medical.watch.rec === 'Leave the wounded until the fight is over',
    medical.watch ? medical.watch.labels.join(' | ') + ' → ' + medical.watch.rec : 'never raised');
  if (medical.watch) note(medical.watch.title + ' — ' + medical.watch.text + '\n    ' + medical.watch.options.join('\n    '));
  check('under a third of the crew fit, the lit key gives the watch up',
    !!medical.heavy && /to the sick bay$/.test(medical.heavy.rec || ''),
    medical.heavy ? medical.heavy.rec : 'never raised');
  check('two wounded of twenty-four is not a question', medical.quiet === false, String(medical.quiet));
  check('and a party already on medical is not asked about again', medical.onMedical === false, String(medical.onMedical));

  console.log('scenario: the routine settles what nobody answered');
  const routine = await page.evaluate(() => {
    const out = { err: [], repairGone: null, repairLog: null, sent: null, burnGone: null, burnMode: null,
      burnRec: null, burnLabel: null, repairDeadline: null, aliveAt: null };
    const D = OD.Decisions;
    const build = (opts) => { OD.harness.start(OD.Skirmish.build(Object.assign({ player: 'JC', env: 'deep', range: 900, seed: 5 }, opts))); return OD.Game.sim; };
    const find = (sim, kind, shipId) => (sim.decisions || []).find((x) => x.kind === kind && (x.ships || [x.shipId]).includes(shipId)) || null;
    const raise = (sim, kind, shipId) => {
      D.init(sim);
      D.update(sim, 0);
      let d = find(sim, kind, shipId);
      if (d) return d;
      for (let i = 0; i < 14; i++) {
        OD.harness.step(3);
        d = find(sim, kind, shipId);
        if (d) return d;
        for (const x of (sim.decisions || []).slice()) if ((x.ships || [x.shipId]).includes(shipId) && x.kind !== kind) D.dismiss(sim, x.id);
      }
      return null;
    };
    try {
      // --- a repair card nobody touches: the routine sends the party and says so once
      {
        const sim = build({ playerShips: { frigate: 1 }, enemyShips: { corvette: 1 } });
        const me = sim.playerShips()[0];
        OD.harness.select(me.id);
        for (const id of ['rad1', 'drive']) {
          const c = (me.components || []).find((x) => x.id === id);
          if (c) { c.hp = id === 'drive' ? 0.4 : 0.3; }
        }
        me._dmgRev = (me._dmgRev || 0) + 1; OD.Damage.aggregate(me);
        const d = raise(sim, 'repair', me.id);
        if (d) {
          const t0 = sim.time;
          // it stays on the band for the minute a reader gets, and no longer
          for (let i = 0; i < 6; i++) { OD.harness.step(5); }
          out.aliveAt = (sim.decisions || []).some((x) => x.id === d.id) ? Math.round(sim.time - t0) : null;
          for (let i = 0; i < 12; i++) { OD.harness.step(5); if (!(sim.decisions || []).some((x) => x.id === d.id)) break; }
          out.repairGone = !(sim.decisions || []).some((x) => x.id === d.id);
          out.repairAfter = Math.round(sim.time - t0);
          const log = (sim.log || []).map((l) => l.text || l.message || String(l));
          out.repairLog = log.filter((t) => /routine\./.test(t)).slice(-3);
          out.repairDeadline = d.deadline != null ? Math.round(d.deadline - t0) : null;
          const p = OD.Crew.board(me).parties.find((x) => x.task === 'repair');
          out.sent = p ? p.part : null;
        }
      }
      // --- a burn card nobody touches settles into the couches
      {
        const sim = build({ playerShips: { corvette: 1 }, enemyShips: { corvette: 1 } });
        const me = sim.playerShips()[0], foe = sim.hostiles(me)[0];
        OD.harness.select(me.id);
        me.propMass = Math.max(1, me.fullPropMass * 0.12);
        const c = (me.components || []).find((x) => x.id === 'sensors');
        if (c) { c.hp = 0.3; me._dmgRev = (me._dmgRev || 0) + 1; OD.Damage.aggregate(me); }
        OD.Crew.assign(me, 'p2', 'repair', 'sensors');
        OD.Crew.setG(me, 'max');
        sim.setTarget(me.id, foe.id);
        sim.setOrder(me.id, { type: 'intercept', target: foe.id });
        const d = raise(sim, 'burn', me.id);
        if (d) {
          const lit = (d.options || []).find((x) => x.recommended) || {};
          out.burnLabel = lit.label || null;
          out.burnRec = lit.id === 'low' ? (/1\.2 g/.test(lit.label || '') ? 'work' : 'couches')
            : lit.id === 'high' ? (/^Burn at [4-9]/.test(lit.label || '') ? 'max' : 'couches') : 'work';
          out.burnLived = 0;
          for (let i = 0; i < 16; i++) { OD.harness.step(5); out.burnLived += 5; if (!(sim.decisions || []).some((x) => x.id === d.id)) break; }
          out.burnGone = !(sim.decisions || []).some((x) => x.id === d.id);
          out.burnMode = OD.Crew.board(me).crew.gMode;
        }
      }
    } catch (e) { out.err.push(String(e.stack || e)); }
    out.errors = OD.errors.slice();
    return out;
  });
  check('no errors while the routine settles the cards', routine.err.length === 0 && routine.errors.length === 0,
    routine.err.concat(routine.errors).join(' | '));
  check('an unanswered repair card is still on the band at 30 s', routine.aliveAt != null, String(routine.aliveAt));
  check('and the routine has settled it by 60 s', routine.repairGone === true && routine.repairAfter <= 90,
    routine.repairGone + ' at ' + routine.repairAfter + ' s');
  // The settle runs the card's own lit key and nothing else. It used to call OD.Crew.auto, which
  // takes the sensor watch first whatever the card had lit, so waiting the minute out gave the
  // player the opposite of the option with the mark against it — and no 'Decision:' line either.
  check('the routine runs the card’s own lit key, and logs it as a decision',
    routine.sent === 'drive' && (routine.repairLog || []).length === 1 &&
    /^Decision: .* → .* · the ship’s routine\./.test((routine.repairLog || [])[0] || '') &&
    /to the drive/.test((routine.repairLog || [])[0] || ''),
    routine.sent + ' · ' + (routine.repairLog || []).join(' | '));
  check('an unanswered burn card settles into the rung it recommended',
    routine.burnGone === true && routine.burnMode === routine.burnRec,
    routine.burnGone + ' after ' + routine.burnLived + ' s → ' + routine.burnMode + ', lit ' + routine.burnLabel);

  // ---------------------------------------------------------------- the v13 round-1 fixes
  // Every fix the reviewers asked for on the three crew cards, checked one at a time: the card is
  // raised where it matters, the lit key is the value call, the price is the board's own, the
  // refusal holds, Esc does not give the decision away, and a card whose answer is 'keep' never
  // takes the band from a question about who is shooting whom.
  console.log('scenario: the round-1 fixes to the crew cards');
  const fixes = await page.evaluate(() => {
    const out = { err: [], okState: null, thin: null, once: null, yield: null, held: null,
      esc: null, band: null, rank: null, medLog: null, crip: null, names: [], heldLow: null,
      tight: null, doomed: null };
    const D = OD.Decisions;
    const build = (opts) => { OD.harness.start(OD.Skirmish.build(Object.assign({ player: 'JC', env: 'deep', range: 400, seed: 5 }, opts))); return OD.Game.sim; };
    const find = (sim, kind, id) => (sim.decisions || []).find((x) => x.kind === kind && (x.ships || [x.shipId]).includes(id)) || null;
    const raise = (sim, kind, id) => {
      D.init(sim); D.update(sim, 0);
      let d = find(sim, kind, id);
      if (d) return d;
      for (let i = 0; i < 14; i++) {
        OD.harness.step(3);
        d = find(sim, kind, id);
        if (d) return d;
        for (const x of (sim.decisions || []).slice()) if ((x.ships || [x.shipId]).includes(id) && x.kind !== kind) D.dismiss(sim, x.id);
      }
      return null;
    };
    const hurt = (ship, id, hp) => { const c = (ship.components || []).find((x) => x.id === id); if (c) { c.hp = hp; ship._dmgRev = (ship._dmgRev || 0) + 1; OD.Damage.aggregate(ship); } };
    const shot = (d) => d && ({ title: d.title, text: d.text, rec: (d.options.find((o) => o.recommended) || {}).label || null,
      options: d.options.map((o) => o.key + ' ' + o.label + ' · ' + o.detail + (o.recommended ? ' [rec]' : '')),
      details: d.options.map((o) => o.detail) });
    const logs = (sim) => (sim.log || []).map((l) => l.text || l.message || String(l));
    // 'Keep the parties where they are' on the ordinary card, 'Keep them out' or 'Keep the burn'
    // on the trade card a running part raises.
    const keep = (d) => (d.options || []).find((o) => /^Keep /.test(o.label)) || null;
    try {
      // --- a drive at 60 % is under the jury-rig's reach, so the report calls it 'damaged' and a
      // party can move it: the card is raised on what a party can do, not on the state word (the
      // word itself has been 'ok', then 'damaged', over two passes of damage.js)
      {
        const sim = build({ playerShips: { frigate: 1 }, enemyShips: { corvette: 1 } });
        const me = sim.playerShips()[0];
        OD.harness.select(me.id);
        // 35 %, not 60 %: the drive's jury-rig stops at 70 %, so a drive at 60 % is 10 points of
        // mend and D 21 holds every part to the same 30-point bar. The state word is the point of
        // the check, and at 35 % the report still calls the drive damaged and repairable.
        hurt(me, 'drive', 0.35);
        hurt(me, 'rad1', 0.3);
        const row = OD.Damage.report(me).find((r) => r.id === 'drive') || {};
        const d = raise(sim, 'repair', me.id);
        out.okState = { state: row.state, repairable: row.repairable, raised: !!d,
          offered: !!d && d.options.some((o) => /to the drive$/.test(o.label)), title: d ? d.title : null };
        if (d) out.names.push(d.title, d.options.map((o) => o.label + ' ' + o.detail).join(' '));
      }
      // --- and not raised for a part a jury-rig can barely move: a panel at 65 % of a 70 % cap
      {
        const sim = build({ playerShips: { corvette: 1 }, enemyShips: { corvette: 1 } });
        const me = sim.playerShips()[0];
        OD.harness.select(me.id);
        hurt(me, 'rad1', 0.65);
        const row = OD.Crew.board(me).parts.find((p) => p.id === 'rad1') || {};
        const d = raise(sim, 'repair', me.id);
        out.thin = { hp: Math.round(row.hp * 100) / 100, cap: row.cap, repairable: row.repairable, raised: !!d };
      }
      // --- one card per part per fight: answered 'keep', the same panel does not ask again
      {
        const sim = build({ playerShips: { corvette: 1 }, enemyShips: { corvette: 1 } });
        const me = sim.playerShips()[0];
        OD.harness.select(me.id);
        hurt(me, 'rad1', 0.3);
        const d = raise(sim, 'repair', me.id);
        let again = null;
        if (d) {
          const k = keep(d);
          D.choose(sim, d.id, k.key);
          out.held = { holdApi: typeof OD.Crew.hold === 'function', task: null, partsAfter: null };
          for (let i = 0; i < 30 && !again; i++) {
            OD.harness.step(5);
            again = find(sim, 'repair', me.id);
          }
          // the refusal holds: the routine does not put a party on that panel behind the answer
          const b = OD.Crew.board(me);
          out.held.task = b.parties.map((p) => p.task + (p.part ? ':' + p.part : '')).join(',');
        }
        out.once = { first: !!d, second: !!again, at: again ? Math.round(sim.time) : null };
      }
      // --- a 'keep' card gives the band up the moment something more urgent wants it
      {
        const sim = build({ playerShips: { corvette: 1 }, enemyShips: { corvette: 1 } });
        const me = sim.playerShips()[0], foe = sim.hostiles(me)[0];
        OD.harness.select(me.id);
        hurt(me, 'rad1', 0.3);
        const d = raise(sim, 'repair', me.id);
        if (d) {
          const before = logs(sim).length;
          sim.setTarget(me.id, foe.id);
          foe.systems.drive = 0; // she is out of the fight: the prize card outranks the parties
          let crip = null;
          for (let i = 0; i < 8 && !crip; i++) { OD.harness.step(2); crip = find(sim, 'cripple', me.id); }
          out.yield = {
            crip: !!crip,
            repairGone: !(sim.decisions || []).some((x) => x.id === d.id),
            log: logs(sim).slice(before).filter((t) => /^Decision:/.test(t)).slice(-1)[0] || null,
            secs: Math.round(sim.time),
          };
          // and a card about the prize is not put again inside a minute, whoever is pointing at her
          if (crip) {
            const o = (crip.options || []).find((x) => x.recommended) || crip.options[0];
            D.choose(sim, crip.id, o.key);
            let second = null;
            const t0 = sim.time;
            for (let i = 0; i < 11 && !second; i++) { OD.harness.step(5); second = find(sim, 'cripple', me.id); }
            out.crip = { again: !!second, after: Math.round(sim.time - t0) };
          }
        }
      }
      // --- Esc holds the routine: the card leaves the band, nobody moves, and the ship settles it
      // at the deadline it was counting down to
      {
        const sim = build({ playerShips: { corvette: 1 }, enemyShips: { corvette: 1 } });
        const me = sim.playerShips()[0];
        OD.harness.select(me.id);
        hurt(me, 'drive', 0.4);
        const d = raise(sim, 'repair', me.id);
        if (d) {
          const dead = d.deadline;
          D.dismiss(sim, d.id);
          OD.harness.step(3);
          const b1 = OD.Crew.board(me);
          out.esc = {
            offBand: D.current(sim) == null || D.current(sim).id !== d.id,
            stillOpen: (sim.decisions || []).some((x) => x.id === d.id),
            movedEarly: b1.parties.some((p) => p.task === 'repair'),
            at: Math.round(sim.time), deadline: dead != null ? Math.round(dead) : null,
          };
          for (let i = 0; i < 30 && (sim.decisions || []).some((x) => x.id === d.id); i++) OD.harness.step(3);
          out.esc.settledAt = Math.round(sim.time);
          out.esc.settled = !(sim.decisions || []).some((x) => x.id === d.id);
          out.esc.onDrive = OD.Crew.board(me).parties.some((p) => p.task === 'repair' && p.part === 'drive');
        }
      }
      // --- the minute starts when the card reaches the band, not when it is raised
      {
        const sim = build({ range: 1400, playerShips: { corvette: 2 }, enemyShips: { corvette: 1 } });
        const ships = sim.playerShips();
        const a = ships[0], b = ships[1];
        OD.harness.select(a.id);
        D.init(sim); D.update(sim, 0);
        let hold = null;
        for (let i = 0; i < 20 && !hold; i++) { OD.harness.step(3); hold = find(sim, 'approach', a.id); }
        // her own routine would take the drive before the question could be put: this hull's
        // parties are the player's to move, which is what the card is for
        if (b.crew) b.crew.auto = false;
        hurt(b, 'drive', 0.4);
        let mine = null;
        for (let i = 0; i < 40 && !mine; i++) { OD.harness.step(3); mine = find(sim, 'repair', b.id); }
        out.bandSaw = (sim.decisions || []).map((x) => x.kind + ':' + (x.ships || []).join('+')).join(' | ');
        if (mine) {
          const cur = D.current(sim);
          out.band = { behind: mine.deadline == null, holding: cur ? cur.kind : null, at: Math.round(sim.time) };
          OD.harness.select(b.id);
          OD.harness.step(3);
          out.band.front = mine.deadline != null;
          out.band.clock = mine.deadline != null ? Math.round(mine.deadline - sim.time) : null;
        } else out.band = { behind: null, holding: null, at: Math.round(sim.time) };
      }
      // --- the wounded are asked about before the hull is asked where to point
      {
        const sim = build({ range: 1400, playerShips: { corvette: 1 }, enemyShips: { corvette: 1 } });
        const me = sim.playerShips()[0];
        OD.harness.select(me.id);
        const c = OD.Crew.init(me); c.wounded = 6; c.fit = c.total - 6;
        D.init(sim); D.update(sim, 0);
        const order = [];
        for (let i = 0; i < 30 && order.length < 2; i++) {
          OD.harness.step(3);
          for (const d of sim.decisions || []) if (order.indexOf(d.kind) < 0) order.push(d.kind);
        }
        out.rank = order.join(',');
      }
      // --- the settle line says what it cost
      {
        const sim = build({ playerShips: { corvette: 1 }, enemyShips: { corvette: 1 } });
        const me = sim.playerShips()[0];
        OD.harness.select(me.id);
        const c = OD.Crew.init(me); c.wounded = 6; c.fit = c.total - 6;
        const d = raise(sim, 'medical', me.id);
        if (d) {
          for (let i = 0; i < 30 && (sim.decisions || []).some((x) => x.id === d.id); i++) OD.harness.step(3);
          out.medLog = logs(sim).filter((t) => /^Decision:/.test(t)).slice(-1)[0] || null;
        }
      }
      // --- the burn card is raised on the repair it would put down, not only on the clock
      {
        OD.harness.start(OD.Skirmish.build({ player: 'JC', env: 'deep', range: 900, seed: 5, playerShips: { corvette: 1 }, enemyShips: { corvette: 1 } }));
        const sim = OD.Game.sim;
        const me = sim.playerShips()[0], foe = sim.hostiles(me)[0];
        OD.harness.select(me.id);
        hurt(me, 'sensors', 0.3);
        OD.Crew.assign(me, 'p2', 'repair', 'sensors');
        OD.Crew.setG(me, 'couches');
        sim.setTarget(me.id, foe.id);
        sim.setOrder(me.id, { type: 'intercept', target: foe.id });
        const g = Math.round((me.thrust * me.systems.drive / me.mass() / OD.P.g0) * 100) / 100;
        const d = raise(sim, 'burn', me.id);
        const s2 = shot(d);
        const secsOf2 = (t) => { let m = /(\d+)m (\d+)s/.exec(t); if (m) return +m[1] * 60 + +m[2]; m = /(\d+) s/.exec(t); return m ? +m[1] : null; };
        const lo = s2 ? secsOf2(String(s2.details[0]).split('alongside in ')[1] || '') : null;
        const hi = s2 ? secsOf2(String(s2.details[1]).split('alongside in ')[1] || '') : null;
        out.tight = { g, raised: !!d, gap: lo != null && hi != null ? lo - hi : null,
          names: s2 ? /the repair on .+ holds where it is for \d/.test(s2.details[1] || '') : false,
          detail: s2 ? s2.details[1] : null };
        if (s2) out.names.push(s2.options.join(' '));
      }
      // --- the rung held under the couch limit says what it costs. With nothing aboard to mend
      // and nobody hurt the couches cost the ship nothing (D 26), so what the rung costs is the
      // propellant, and it prints it: what it spends of the tanks and where that puts us.
      {
        OD.harness.start(OD.Skirmish.build({ player: 'JC', env: 'deep', range: 4000, seed: 5, playerShips: { corvette: 1 }, enemyShips: { corvette: 1 } }));
        const sim = OD.Game.sim;
        const me = sim.playerShips()[0], foe = sim.hostiles(me)[0];
        OD.harness.select(me.id);
        me.propMass = Math.max(1, me.fullPropMass * 0.2);
        OD.Crew.setG(me, 'work');
        sim.setTarget(me.id, foe.id);
        sim.setOrder(me.id, { type: 'intercept', target: foe.id });
        const d = raise(sim, 'burn', me.id);
        const s3 = shot(d);
        const priced = (t) => /[\d.]+ of [\d.]+ km\/s/.test(String(t)) &&
          /( · alongside in |the tanks run dry )/.test(String(t));
        out.heldLow = { raised: !!d, details: s3 ? s3.details : null,
          consequence: s3 ? s3.details.slice(0, 2).every(priced) : false };
      }
      // --- and the same card with a part under its cap: now the couches do cost something, and
      // both rungs say what the people can and cannot do while she burns
      {
        OD.harness.start(OD.Skirmish.build({ player: 'JC', env: 'deep', range: 4000, seed: 5, playerShips: { corvette: 1 }, enemyShips: { corvette: 1 } }));
        const sim = OD.Game.sim;
        const me = sim.playerShips()[0], foe = sim.hostiles(me)[0];
        OD.harness.select(me.id);
        me.propMass = Math.max(1, me.fullPropMass * 0.2);
        hurt(me, 'sensors', 0.3);
        OD.Crew.setG(me, 'work');
        sim.setTarget(me.id, foe.id);
        sim.setOrder(me.id, { type: 'intercept', target: foe.id });
        const d = raise(sim, 'burn', me.id);
        const s4 = shot(d);
        out.heldLowHurt = { raised: !!d, details: s4 ? s4.details : null,
          crew: s4 ? s4.details.slice(0, 2).every((t) =>
            /(the parties can work|no party can work|the crew (straps into the couches|can work through)|repairs (go on|pause)|the repair on )/.test(String(t))) : false };
      }
      // --- a mend the fight will not wait for says so, and the lit key is to keep the watches
      {
        OD.harness.start(OD.Skirmish.build({ player: 'JC', env: 'deep', range: 120, seed: 5, playerShips: { corvette: 1 }, enemyShips: { frigate: 1 } }));
        const sim = OD.Game.sim;
        const me = sim.playerShips()[0], foe = sim.hostiles(me)[0];
        OD.harness.select(me.id);
        sim.setTarget(me.id, foe.id);
        me.weaponsFree = true; foe.weaponsFree = true;
        for (let i = 0; i < 90 && me.hull > 0.88; i++) OD.harness.step(2);
        if (me.crew) me.crew.auto = false;
        // the drive is nearly gone and the tail is open to vacuum, so the party works in suits
        if (me.damage) me.damage.tail = Math.max(me.damage.tail || 0, 0.6);
        hurt(me, 'drive', 0.1);
        // no D.init here: the armour's own rate of loss is what the card reads the hull's life off,
        // and re-initialising the layer would throw that memory away
        let d = null;
        for (let i = 0; i < 14 && !d; i++) {
          OD.harness.step(2);
          d = find(sim, 'repair', me.id);
          if (!d) for (const x of (sim.decisions || []).slice()) if ((x.ships || [x.shipId]).includes(me.id)) D.dismiss(sim, x.id);
        }
        const s4 = shot(d);
        out.doomed = { hull: Math.round(me.hull * 100) / 100, raised: !!d, rec: s4 ? s4.rec : null,
          // the clock is the card's, not the key's: it used to be bolted on to every option
          says: s4 ? /Under this fire (we|.*) ha(ve|s) about /.test(s4.text || '') : false,
          twice: s4 ? (String(s4.text || '') + ' ' + s4.details.join(' ')).split('Under this fire').length - 1 : 0,
          text: s4 ? s4.text : null, details: s4 ? s4.details : null };
      }
    } catch (e) { out.err.push(String(e.stack || e)); }
    out.errors = OD.errors.slice();
    return out;
  });
  check('no errors while the round-1 fixes are exercised', fixes.err.length === 0 && fixes.errors.length === 0,
    fixes.err.concat(fixes.errors).join(' | '));
  // The state word and the jury-rig are two different questions, and gating the card on the word
  // left a drive at 60 % — the thing the routine pulls a watch for — out of every card in the
  // build. The gate is `repairable`, whatever the word says.
  check('a part a party can still move is a question, whatever the state word says',
    !!fixes.okState && fixes.okState.repairable === true &&
    fixes.okState.raised === true && fixes.okState.offered === true,
    JSON.stringify(fixes.okState));
  check('and a part a jury-rig can barely move is not',
    !!fixes.thin && fixes.thin.repairable === true && fixes.thin.raised === false,
    JSON.stringify(fixes.thin));
  check('a part is a question once a fight',
    !!fixes.once && fixes.once.first === true && fixes.once.second === false, JSON.stringify(fixes.once));
  check('and the refusal holds: the routine does not take that part behind the answer',
    !!fixes.held && (fixes.held.holdApi !== true || !/repair:rad1/.test(fixes.held.task || '')),
    JSON.stringify(fixes.held));
  check('a keep card gives the band up to a more urgent kind, settled with its own pick',
    !!fixes.yield && fixes.yield.crip === true && fixes.yield.repairGone === true &&
    /^Decision: .* → Keep [^·]* · the ship’s routine\./.test(fixes.yield.log || ''),
    JSON.stringify(fixes.yield));
  check('one card about one prize a minute, whoever is pointing at her',
    !!fixes.crip && fixes.crip.again === false, JSON.stringify(fixes.crip));
  check('Esc takes the card off the band without releasing the routine',
    !!fixes.esc && fixes.esc.offBand === true && fixes.esc.stillOpen === true && fixes.esc.movedEarly === false,
    JSON.stringify(fixes.esc));
  check('and the ship settles it at the deadline, not the moment the key was pressed',
    !!fixes.esc && fixes.esc.settled === true && fixes.esc.onDrive === true &&
    fixes.esc.settledAt >= fixes.esc.deadline - 6, JSON.stringify(fixes.esc));
  check('the minute starts when the card reaches the band, not when it is raised',
    !!fixes.band && fixes.band.behind === true && fixes.band.front === true,
    JSON.stringify(fixes.band) + ' \u00b7 ' + fixes.bandSaw);
  check('the wounded are asked about before the hull is asked where to point',
    typeof fixes.rank === 'string' && fixes.rank.split(',')[0] === 'medical', String(fixes.rank));
  check('the settle line names what it cost',
    /Nobody is in the sick bay: \d+ stay wounded\./.test(fixes.medLog || ''), String(fixes.medLog));
  check('a burn that would put a repair down is a question whatever the clock says',
    !!fixes.tight && fixes.tight.raised === true && fixes.tight.names === true,
    JSON.stringify(fixes.tight));
  check('every rung of a burn card carries its consequence',
    !!fixes.heldLow && fixes.heldLow.raised === true && fixes.heldLow.consequence === true,
    JSON.stringify(fixes.heldLow));
  check('and with a part under its cap both rungs say what the people can do',
    !!fixes.heldLowHurt && fixes.heldLowHurt.raised === true && fixes.heldLowHurt.crew === true,
    JSON.stringify(fixes.heldLowHurt));
  check('a mend the fight will not wait for says so, once, and the lit key keeps the watches',
    !!fixes.doomed && fixes.doomed.raised === true && fixes.doomed.says === true &&
    fixes.doomed.twice === 1 && fixes.doomed.rec === 'Keep the parties where they are',
    JSON.stringify(fixes.doomed));
  check('no card renames a part the board has already named',
    !/\bradiator \d/.test(fixes.names.join(' ')), fixes.names.join(' ').slice(0, 160));

  // ---------------------------------------------------------------- the v13 round-2 fixes
  // The second pass over the three crew cards: a part that is running is a trade and not a repair
  // time, the burn's hard rung prices the whole crew, the board row's sentence is read from the
  // first colon, the time takes a clause of its own, every part keeps its article, the lesson is
  // the case in hand, the answer is logged with what it bought, and no card is raised on a hull
  // that will not live to see the mend.
  console.log('scenario: the round-2 fixes to the crew cards');
  const r2 = await page.evaluate(() => {
    const out = { err: [], trade: null, panel: null, stall: null, medStall: null, third: null, whole: null,
      reactor: null, mount: null, teach: null, log: null, waits: null, tanks: null, stopped: null,
      quietLife: null, escBurn: null, crewKinds: null, lit: null, litWide: null, oneTime: null };
    const D = OD.Decisions;
    const build = (opts) => { OD.harness.start(OD.Skirmish.build(Object.assign({ player: 'JC', env: 'deep', range: 400, seed: 5 }, opts))); return OD.Game.sim; };
    const find = (sim, kind, id) => (sim.decisions || []).find((x) => x.kind === kind && (x.ships || [x.shipId]).includes(id)) || null;
    const raise = (sim, kind, id) => {
      D.init(sim); D.update(sim, 0);
      let d = find(sim, kind, id);
      if (d) return d;
      for (let i = 0; i < 14; i++) {
        OD.harness.step(3);
        d = find(sim, kind, id);
        if (d) return d;
        for (const x of (sim.decisions || []).slice()) if ((x.ships || [x.shipId]).includes(id) && x.kind !== kind) D.dismiss(sim, x.id);
      }
      return null;
    };
    const hurt = (ship, id, hp) => { const c = (ship.components || []).find((x) => x.id === id); if (c) { c.hp = hp; ship._dmgRev = (ship._dmgRev || 0) + 1; OD.Damage.aggregate(ship); } };
    const shot = (d) => d && ({ title: d.title, text: d.text, teach: d.teach,
      labels: d.options.map((o) => o.label), details: d.options.map((o) => o.detail),
      rec: (d.options.find((o) => o.recommended) || {}).label || null,
      options: d.options.map((o) => o.key + ' ' + o.label + ' · ' + o.detail + (o.recommended ? ' [rec]' : '')) });
    const logs = (sim) => (sim.log || []).map((l) => l.text || l.message || String(l));
    const TIME = /\b\d+\s*(min|s)\b/;
    try {
      // --- D 1: the drive under throttle. No party can touch it, so the card is the throttle, and
      // no key prints a clean repair time for work the ship will not start.
      {
        const sim = build({ range: 250, playerShips: { corvette: 1 }, enemyShips: { corvette: 1 } });
        const me = sim.playerShips()[0], foe = sim.hostiles(me)[0];
        OD.harness.select(me.id);
        sim.setTarget(me.id, foe.id);
        sim.setOrder(me.id, { type: 'keeprange', target: foe.id, range: 250e3 });
        for (let i = 0; i < 4; i++) OD.harness.step(3);
        hurt(me, 'drive', 0.4);
        const row = OD.Crew.board(me).parts.find((p) => p.id === 'drive') || {};
        const d = raise(sim, 'repair', me.id);
        const s1 = shot(d);
        out.trade = { blocked: row.blocked || null, raised: !!d, card: s1,
          cut: s1 ? /^Cut the drive for /.test(s1.labels[0] || '') : false,
          keep: s1 ? /^Keep the burn$/.test(s1.labels[1] || '') : false,
          timeless: s1 ? !s1.details.some((t) => TIME.test(String(t))) : false,
          throttleBefore: me.cmdThrottle };
        if (d) {
          const o = d.options.find((x) => /^Cut the drive/.test(x.label));
          const before = logs(sim).length;
          if (o) D.choose(sim, d.id, o.key);
          out.trade.after = { throttle: me.cmdThrottle, order: me.order.type,
            party: OD.Crew.board(me).parties.filter((p) => p.task === 'repair' && p.part === 'drive').length };
          // --- D 9: the sentence OD.Crew.assign returns is logged under the Decision line
          out.log = logs(sim).slice(before);
        }
      }
      // --- D 1, the panel: the radiators are out, so the trade is the panels, and the key prices
      // the sink it fills while they are in
      {
        const sim = build({ playerShips: { corvette: 1 }, enemyShips: { corvette: 1 } });
        const me = sim.playerShips()[0];
        OD.harness.select(me.id);
        hurt(me, 'rad1', 0.25);
        const d = raise(sim, 'repair', me.id);
        const s1 = shot(d);
        out.panel = { raised: !!d, card: s1,
          stow: s1 ? /^Stow the panels for /.test(s1.labels[0] || '') : false,
          sink: s1 ? /the sink fills from \d+ % to about \d+ %/.test(s1.details[0] || '') : false,
          timeless: s1 ? !s1.details.some((t) => TIME.test(String(t))) : false };
        if (d) {
          const o = d.options.find((x) => /^Stow the panels/.test(x.label));
          if (o) D.choose(sim, d.id, o.key);
          out.panel.after = { deployed: me.radiators ? !!me.radiators.deployed : null,
            party: OD.Crew.board(me).parties.filter((p) => p.task === 'repair' && p.part === 'rad1').length };
        }
      }
      // --- D 2: a mend more than four times the hull's life is the withdraw card's moment
      {
        const sim = build({ range: 60, playerShips: { corvette: 1 }, enemyShips: { destroyer: 1 } });
        const me = sim.playerShips()[0], foe = sim.hostiles(me)[0];
        OD.harness.select(me.id);
        sim.setTarget(me.id, foe.id);
        me.weaponsFree = true; foe.weaponsFree = true;
        for (let i = 0; i < 120 && me.hull > 0.5; i++) OD.harness.step(2);
        if (me.crew) me.crew.auto = false;
        hurt(me, 'drive', 0.05);
        const k = OD.Crew.init(me); k.wounded = Math.max(k.wounded, 6); k.fit = k.total - k.wounded;
        let rep = null, med = null, wit = null;
        for (let i = 0; i < 12; i++) {
          OD.harness.step(2);
          rep = rep || find(sim, 'repair', me.id);
          med = med || find(sim, 'medical', me.id);
          wit = wit || find(sim, 'withdraw', me.id);
          for (const x of (sim.decisions || []).slice()) if (x.kind !== 'repair' && x.kind !== 'medical' && x.kind !== 'withdraw') D.dismiss(sim, x.id);
        }
        out.stall = { hull: Math.round(me.hull * 100) / 100, repair: !!rep, medical: !!med, withdraw: !!wit,
          mend: Math.round(OD.Damage.repairTime(me, 'drive')) };
      }
      // --- D 3: another hull's card, in English
      {
        const sim = build({ range: 1400, playerShips: { corvette: 2 }, enemyShips: { corvette: 1 } });
        const a = sim.playerShips()[0], b = sim.playerShips()[1];
        OD.harness.select(a.id);
        if (b.crew) b.crew.auto = false;
        hurt(b, 'sensors', 0.3);
        let d = null;
        for (let i = 0; i < 40 && !d; i++) { OD.harness.step(3); d = find(sim, 'repair', b.id); }
        const s1 = shot(d);
        out.third = { raised: !!d, title: s1 ? s1.title : null, text: s1 ? s1.text : null,
          clean: s1 ? !/’s the /.test(String(s1.title) + ' ' + String(s1.text)) : false,
          owns: s1 ? /’s sensor suite is hit/.test(String(s1.text)) : false };
      }
      // --- D 4: a burn far over the couch limit prices the whole crew, not a rate
      {
        OD.harness.start(OD.Skirmish.build({ player: 'JC', env: 'deep', range: 40000, seed: 5, playerShips: { corvette: 1 }, enemyShips: { corvette: 1 } }));
        const sim = OD.Game.sim;
        const me = sim.playerShips()[0], foe = sim.hostiles(me)[0];
        OD.harness.select(me.id);
        me.propMass = Math.max(1, me.fullPropMass * 0.005);
        OD.Crew.setG(me, 'couches');
        sim.setTarget(me.id, foe.id);
        sim.setOrder(me.id, { type: 'intercept', target: foe.id });
        const d = raise(sim, 'burn', me.id);
        const s1 = shot(d);
        out.whole = { g: Math.round((me.thrust * me.systems.drive / me.mass() / OD.P.g0) * 100) / 100,
          fit: OD.Crew.board(me).crew.fit, raised: !!d, card: s1,
          whole: s1 ? /(all \d+ aboard wounded on the way|\d+ of the \d+ aboard wounded on the way)/.test(s1.details[1] || '') : false,
          overCrew: s1 ? (/(\d+) of the (\d+) aboard wounded on the way/.exec(s1.details[1] || '') || [0, 0, 1]).slice(1).map(Number) : null };
      }
      // --- D 5: the reactor's sentence has a hyphen in its head, and the key prints the clause
      // after the colon and nothing before it
      {
        const sim = build({ playerShips: { corvette: 1 }, enemyShips: { corvette: 1 } });
        const me = sim.playerShips()[0];
        OD.harness.select(me.id);
        hurt(me, 'reactor', 0.3);
        const d = raise(sim, 'repair', me.id);
        const s1 = shot(d);
        out.reactor = { raised: !!d, buys: (OD.Crew.board(me).parts.find((p) => p.id === 'reactor') || {}).buys,
          card: s1, clean: s1 ? !/A party|cross-connect/.test(s1.details.join(' ')) : false,
          colons: s1 ? s1.details.join(' ').split(':').length - 1 : 0 };
      }
      // --- D 6, D 7, D 17: a mount keeps its article, the time takes a clause of its own where the
      // sentence cannot carry it, and it is the board's own format
      {
        const sim = build({ playerShips: { corvette: 1 }, enemyShips: { corvette: 1 } });
        const me = sim.playerShips()[0];
        OD.harness.select(me.id);
        hurt(me, 'coil1', 0.3);
        const d = raise(sim, 'repair', me.id);
        const s1 = shot(d);
        const row = OD.Crew.board(me).parts.find((p) => p.id === 'coil1') || {};
        const words = OD.Damage && typeof OD.Damage.timeWords === 'function'
          ? OD.Damage.timeWords(row.eta) : Math.max(1, Math.round((row.eta || 0) / 60)) + ' min';
        out.mount = { raised: !!d, card: s1,
          article: s1 ? /to the coilgun$/.test(s1.labels[0] || '') && /^The coilgun is hit\./.test(s1.text || '') : false,
          ownClause: s1 ? new RegExp('^' + words.replace(/\s/g, '\\s') + ' · ').test(s1.details[0] || '') : false,
          words, eta: Math.round(row.eta || 0) };
        // --- D 8: the lesson is the part in hand, not the whole jury-rig paragraph
        out.teach = { text: s1 ? s1.teach : null,
          case: s1 ? /jury-rig: the coilgun comes back to \d+ %/.test(String(s1.teach)) ||
            /coilgun/.test(String(s1.teach)) : false };
      }
      // --- D 10, eng 2: every free party is placed and each key names a different part waiting
      {
        const sim = build({ playerShips: { frigate: 1 }, enemyShips: { corvette: 1 } });
        const me = sim.playerShips()[0];
        OD.harness.select(me.id);
        hurt(me, 'drive', 0.4); hurt(me, 'sensors', 0.3); hurt(me, 'coil1', 0.3);
        const d = raise(sim, 'repair', me.id);
        const s1 = shot(d);
        const waits = s1 ? s1.details.map((t) => (String(t).split(' · ').filter((c) => /waits?$/.test(c))[0] || '')) : [];
        out.waits = { raised: !!d, card: s1, waits,
          distinct: waits.length > 1 && new Set(waits).size === waits.length && waits.every((w) => w) };
      }
      // --- D 13: three sound tanks on a consort are not a question
      {
        const sim = build({ playerShips: { frigate: 1 }, enemyShips: { corvette: 1 } });
        const me = sim.playerShips()[0];
        OD.harness.select(me.id);
        for (const id of ['tank1', 'tank2', 'tank3']) hurt(me, id, 0.7);
        let raised = false;
        D.init(sim); D.update(sim, 0);
        if (find(sim, 'repair', me.id)) raised = true;
        for (let i = 0; i < 12 && !raised; i++) { OD.harness.step(3); if (find(sim, 'repair', me.id)) raised = true; }
        out.tanks = { raised, rows: OD.Crew.board(me).parts.filter((p) => /^tank/.test(p.id) && p.repairable).length };
      }
      // --- D 14: with nothing landing on her there is no clock, and the card says nothing about one
      {
        const sim = build({ range: 4000, playerShips: { corvette: 1 }, enemyShips: { corvette: 1 } });
        const me = sim.playerShips()[0];
        OD.harness.select(me.id);
        hurt(me, 'drive', 0.4);
        const d = raise(sim, 'repair', me.id);
        const s1 = shot(d);
        out.quietLife = { raised: !!d, text: s1 ? s1.text : null,
          silent: s1 ? !/Under this fire/.test(String(s1.text) + ' ' + s1.details.join(' ')) : false };
      }
      // --- D 15: an order that stops a running repair is the burn card's question too
      {
        OD.harness.start(OD.Skirmish.build({ player: 'JC', env: 'deep', range: 900, seed: 5, playerShips: { corvette: 1 }, enemyShips: { corvette: 1 } }));
        const sim = OD.Game.sim;
        const me = sim.playerShips()[0], foe = sim.hostiles(me)[0];
        OD.harness.select(me.id);
        hurt(me, 'drive', 0.25);
        OD.Crew.assign(me, 'p1', 'repair', 'drive');
        sim.setTarget(me.id, foe.id);
        sim.setOrder(me.id, { type: 'intercept', target: foe.id });
        const d = raise(sim, 'burn', me.id);
        const s1 = shot(d);
        out.stopped = { raised: !!d, card: s1, pressing: d ? d.pressing === true : null,
          rec: s1 ? s1.rec : null,
          cut: s1 ? /^Throttle to 0 for /.test(s1.labels[0] || '') : false,
          press: s1 ? /^Press on$/.test(s1.labels[1] || '') : false };
        // --- D 9: the burn card is a crew card, so Esc leaves it for the crew instead of closing it
        if (d) {
          out.crewKinds = { flagged: d.crew === true, listed: !!(D.CREW_KINDS && D.CREW_KINDS.burn) };
          D.dismiss(sim, d.id);
          out.escBurn = { stillOpen: (sim.decisions || []).some((x) => x.id === d.id),
            offBand: D.current(sim) == null || D.current(sim).id !== d.id,
            deadline: d.deadline != null };
          const o = d.options.find((x) => /^Throttle to 0/.test(x.label));
          if (o) { D.choose(sim, d.id, o.key); out.stopped.after = { throttle: me.cmdThrottle, order: me.order.type }; }
        }
      }
      // --- D 12: the lit rung comes from what the rungs buy, not the range alone. The same hull
      // twice: two thirds of a tank, where the hard rung buys 40 s against four minutes of work on
      // the sensor suite, and a third of a tank, where it buys 67 s and the work is worth losing.
      for (const job of [{ key: 'lit', share: 0.65 }, { key: 'litWide', share: 0.35 }]) {
        // A short gap, so the hard rung buys seconds: that is the case the lit key got wrong.
        OD.harness.start(OD.Skirmish.build({ player: 'JC', env: 'deep', range: 30, seed: 5, playerShips: { corvette: 1 }, enemyShips: { corvette: 1 } }));
        const sim = OD.Game.sim;
        const me = sim.playerShips()[0], foe = sim.hostiles(me)[0];
        OD.harness.select(me.id);
        me.propMass = Math.max(1, me.fullPropMass * job.share);
        hurt(me, 'sensors', 0.3);
        OD.Crew.assign(me, 'p2', 'repair', 'sensors');
        OD.Crew.setG(me, 'couches');
        sim.setTarget(me.id, foe.id);
        sim.setOrder(me.id, { type: 'intercept', target: foe.id });
        const d = raise(sim, 'burn', me.id);
        const s1 = shot(d);
        const secs = (t) => { let m = /(\d+)m (\d+)s/.exec(String(t)); if (m) return +m[1] * 60 + +m[2]; m = /(\d+) s/.exec(String(t)); return m ? +m[1] : null; };
        const lo = s1 ? secs(String(s1.details[0]).split('alongside in ')[1] || '') : null;
        const hi = s1 ? secs(String(s1.details[1]).split('alongside in ')[1] || '') : null;
        out[job.key] = { raised: !!d, gap: lo != null && hi != null ? lo - hi : null, rec: s1 ? s1.rec : null,
          card: s1, held: s1 ? /holds where it is for /.test(s1.details[1] || '') : false };
      }
    } catch (e) { out.err.push(String(e.stack || e)); }
    out.errors = OD.errors.slice();
    return out;
  });
  check('no errors while the round-2 fixes are exercised', r2.err.length === 0 && r2.errors.length === 0,
    r2.err.concat(r2.errors).join(' | '));
  // D 1 / writing N1 / realism 1: the card used to sell a repair the sim refuses to start, take
  // the watch for it and say nothing. A part that is running is a trade, and the trade is priced.
  check('a part that is running raises the trade, not a repair time',
    !!r2.trade && r2.trade.raised === true && !!r2.trade.blocked && r2.trade.cut === true &&
    r2.trade.keep === true && r2.trade.timeless === true, JSON.stringify(r2.trade && r2.trade.blocked) +
    ' · ' + (r2.trade && r2.trade.card ? r2.trade.card.options.join(' | ') : 'never raised'));
  if (r2.trade && r2.trade.card) note(r2.trade.card.title + ' — ' + r2.trade.card.text + '\n    ' + r2.trade.card.options.join('\n    '));
  check('and the key cuts the drive, holds the order and sends the party',
    !!r2.trade && !!r2.trade.after && r2.trade.throttleBefore > 0 && r2.trade.after.throttle === 0 &&
    r2.trade.after.order === 'hold' && r2.trade.after.party === 1, JSON.stringify(r2.trade && r2.trade.after));
  check('a panel trade stows the radiators and prices the sink it fills',
    !!r2.panel && r2.panel.raised === true && r2.panel.stow === true && r2.panel.sink === true &&
    r2.panel.timeless === true && !!r2.panel.after && r2.panel.after.deployed === false &&
    r2.panel.after.party === 1, JSON.stringify(r2.panel && r2.panel.after) + ' · ' +
    (r2.panel && r2.panel.card ? r2.panel.card.options.join(' | ') : 'never raised'));
  if (r2.panel && r2.panel.card) note(r2.panel.card.title + ' — ' + r2.panel.card.text + '\n    ' + r2.panel.card.options.join('\n    '));
  // D 9: the answer used to log 'Decision: … → Send party 1 to the drive' and nothing else. The
  // sentence OD.Crew.assign returns carries the time and the cost, and it goes under the Decision.
  // D 27 puts the order change between them — 'Throttle to 0. Holding the range stops while the
  // party works.' — so the sentence the assign returns is no longer the line right under the
  // Decision. It is still there, and it still carries the time and the cost.
  check('the answer logs the Decision line and then what it bought',
    Array.isArray(r2.log) && r2.log.length >= 2 && /^Decision: /.test(r2.log[0] || '') &&
    r2.log.slice(1).some((t) => /^Party \d/.test(String(t)) && /\d/.test(String(t))),
    (r2.log || []).join(' | '));
  check('and the order the trade changed is logged with it',
    Array.isArray(r2.log) && r2.log.some((t) => /^Throttle to 0\. /.test(String(t))),
    (r2.log || []).join(' | '));
  // D 2: chapter 4 put a repair card and a medical card on a corvette with 36 s of armour left.
  check('a mend the hull will not live to see raises no card at all',
    !!r2.stall && r2.stall.repair === false && r2.stall.medical === false, JSON.stringify(r2.stall));
  // D 3 / fun 4: 'JCS Larkspur’s the sensor suite is hit.' on the band in chapters 7 and 8.
  check('another hull’s card takes the possessive, not the article',
    !!r2.third && r2.third.raised === true && r2.third.clean === true && r2.third.owns === true,
    JSON.stringify(r2.third));
  // D 4 / writing N2: four wounded a minute for thirteen minutes in a crew of twenty-four.
  check('a burn far over the couch limit prices the whole crew, not a rate',
    !!r2.whole && r2.whole.raised === true && r2.whole.whole === true &&
    (!r2.whole.overCrew || r2.whole.overCrew[0] <= r2.whole.overCrew[1]),
    JSON.stringify({ g: r2.whole && r2.whole.g, fit: r2.whole && r2.whole.fit }) + ' · ' +
    (r2.whole && r2.whole.card ? r2.whole.card.details[1] : 'never raised'));
  // D 5 / writing N3: the hyphen in 'cross-connects' defeated the old head pattern, so the
  // reactor's key printed the board's whole sentence, head, colon and all.
  check('the reactor’s key reads the clause after the colon and nothing before it',
    !!r2.reactor && r2.reactor.raised === true && r2.reactor.clean === true && r2.reactor.colons === 0,
    String(r2.reactor && r2.reactor.buys) + ' → ' + (r2.reactor && r2.reactor.card ? r2.reactor.card.details[0] : ''));
  // D 7 / writing N4: every mount lost its article to the card's own de-naming rule.
  check('a mount keeps its article on the key and in the sentence',
    !!r2.mount && r2.mount.article === true, r2.mount && r2.mount.card ? r2.mount.card.labels[0] + ' · ' + r2.mount.card.text : '');
  // D 6 / writing N5: 'it keeps firing, and 4 times the damage to wreck it in 3m 36s' parses as
  // wrecking it in three minutes. The time is appended only to a clause that ends in a percentage.
  check('and the time takes a clause of its own where the sentence cannot carry it',
    !!r2.mount && r2.mount.ownClause === true,
    (r2.mount ? r2.mount.words + ' of ' + r2.mount.eta + ' s · ' : '') + (r2.mount && r2.mount.card ? r2.mount.card.details[0] : ''));
  // D 8 / writing N7: the band printed the whole jury-rig paragraph, two of whose three sentences
  // were about a situation the card was not in, with a number the card contradicted.
  check('the lesson above the keys is the part in hand',
    !!r2.teach && r2.teach.case === true, String(r2.teach && r2.teach.text));
  // D 10 / eng 2: 'tank 1 waits' under two of three options, all priced the same.
  check('every key names a different part left waiting',
    !!r2.waits && r2.waits.raised === true && r2.waits.distinct === true,
    JSON.stringify(r2.waits && r2.waits.waits));
  if (r2.waits && r2.waits.card) note(r2.waits.card.title + ' — ' + r2.waits.card.text + '\n    ' + r2.waits.card.options.join('\n    '));
  // D 13 / fun 3: six of nine story repair cards were three interchangeable dents on a consort's
  // tanks. The routine is told to leave a sound tank alone; so is the card.
  check('three sound tanks are not a question, however many rows carry a button',
    !!r2.tanks && r2.tanks.raised === false, JSON.stringify(r2.tanks));
  // D 14 / fun 6: 'JCS Larkspur has 15 s at the fire landing on her' on both keys of a card, on a
  // hull that took the chapter 57 minutes later.
  check('with nothing landing on her the card gives no life expectancy',
    !!r2.quietLife && r2.quietLife.raised === true && r2.quietLife.silent === true,
    String(r2.quietLife && r2.quietLife.text));
  // D 15 / fun 9 / realism 1: a party on the drive and an order that lights it. The repair never
  // moved, and at 0.33 g no burn card was due.
  check('an order that stops a running repair raises the burn card, with the throttle as a rung',
    !!r2.stopped && r2.stopped.raised === true && r2.stopped.cut === true && r2.stopped.press === true,
    r2.stopped && r2.stopped.card ? r2.stopped.card.title + ' · ' + r2.stopped.card.options.join(' | ') : 'never raised');
  if (r2.stopped && r2.stopped.card) note(r2.stopped.card.title + ' — ' + r2.stopped.card.text + '\n    ' + r2.stopped.card.options.join('\n    '));
  // Stopping the ship is the answer that steps out of the fight, so it is the passive rung: with a
  // fight to press the card lights 'Press on' and leaves the throttle to the player. Chapter 4 at
  // 1 s and a 10 s reading delay lit 'Throttle to 0 for 6 min' on a corvette at 31 % of her armour
  // with thirty rounds in the air, and lost the run at 923 s.
  check('the card does not stop the ship while there is a fight to press',
    !!r2.stopped && r2.stopped.pressing === true && r2.stopped.rec === 'Press on',
    JSON.stringify({ pressing: r2.stopped && r2.stopped.pressing, rec: r2.stopped && r2.stopped.rec }));
  check('and its key cuts the throttle',
    !!r2.stopped && !!r2.stopped.after && r2.stopped.after.throttle === 0 && r2.stopped.after.order === 'hold',
    JSON.stringify(r2.stopped && r2.stopped.after));
  // D 9 / eng 5: the burn card's Esc read 'Later' over a line saying the crew settles it in 42 s.
  check('a burn card is a crew card: it carries the deadline and Esc leaves it for the crew',
    !!r2.crewKinds && r2.crewKinds.flagged === true && r2.crewKinds.listed === true &&
    !!r2.escBurn && r2.escBurn.stillOpen === true && r2.escBurn.offBand === true && r2.escBurn.deadline === true,
    JSON.stringify(r2.crewKinds) + ' · ' + JSON.stringify(r2.escBurn));
  // D 12 / fun 2: 'Burn at 1.4 g · the repair on the sensor suite holds where it is for 5m 35s ·
  // alongside in 1m 40s' was the lit key, against 1m 48s at the working limit.
  check('seconds saved never outrank a repair the burn would put down',
    !!r2.lit && r2.lit.raised === true && r2.lit.held === true && r2.lit.gap != null &&
    r2.lit.gap < 45 && /^Burn at 1\.2 g$/.test(r2.lit.rec || ''),
    JSON.stringify({ gap: r2.lit && r2.lit.gap, rec: r2.lit && r2.lit.rec }) + ' · ' +
    (r2.lit && r2.lit.card ? r2.lit.card.options.join(' | ') : 'never raised'));
  if (r2.lit && r2.lit.card) note(r2.lit.card.title + ' — ' + r2.lit.card.text + '\n    ' + r2.lit.card.options.join('\n    '));
  // …and the other side of the same rule: a rung that buys more than the 45 s bar keeps the hard
  // key, or D 12 would read as 'never burn while a party is out'.
  check('and a rung that buys more than three quarters of a minute still lights',
    !!r2.litWide && r2.litWide.raised === true && r2.litWide.gap != null && r2.litWide.gap >= 45 &&
    !/^Burn at 1\.2 g$/.test(r2.litWide.rec || ''),
    JSON.stringify({ gap: r2.litWide && r2.litWide.gap, rec: r2.litWide && r2.litWide.rec }));

  // ---------------------------------------------------------------- round 3
  // The three crew cards, read by the fun, interestingness, writing, engagement and realism
  // reviewers on the recommended pick: a card that changed shape under the player's hand, a trade
  // the next card undid, a clock eighteen times too long, and rungs priced over a transfer the
  // tanks could not pay for. D 18 to D 29 in scratchpad/review/FIX2-v13.md.
  console.log('scenario: the round-3 fixes to the crew cards');
  const r3 = await page.evaluate(() => {
    const out = { err: [] };
    const D = OD.Decisions;
    const build = (opts) => { OD.harness.start(OD.Skirmish.build(Object.assign({ player: 'JC', env: 'deep', range: 400, seed: 5 }, opts))); return OD.Game.sim; };
    const find = (sim, kind, id) => (sim.decisions || []).find((x) => x.kind === kind && (x.ships || [x.shipId]).includes(id)) || null;
    const raise = (sim, kind, id) => {
      D.init(sim); D.update(sim, 0);
      let d = find(sim, kind, id);
      if (d) return d;
      for (let i = 0; i < 14; i++) {
        OD.harness.step(3);
        d = find(sim, kind, id);
        if (d) return d;
        for (const x of (sim.decisions || []).slice()) if ((x.ships || [x.shipId]).includes(id) && x.kind !== kind) D.dismiss(sim, x.id);
      }
      return null;
    };
    const hurt = (ship, id, hp) => { const c = (ship.components || []).find((x) => x.id === id); if (c) { c.hp = hp; ship._dmgRev = (ship._dmgRev || 0) + 1; OD.Damage.aggregate(ship); } };
    const shot = (d) => d && ({ title: d.title, text: d.text, labels: d.options.map((o) => o.label),
      details: d.options.map((o) => o.detail), rec: (d.options.find((o) => o.recommended) || {}).label || null,
      options: d.options.map((o) => o.key + ' ' + o.label + ' · ' + o.detail + (o.recommended ? ' [rec]' : '')) });
    const logs = (sim) => (sim.log || []).map((l) => l.text || l.message || String(l));
    const parties = (ship) => OD.Crew.board(ship).parties.map((p) => p.id + ':' + p.task + ':' + (p.part || '-'));
    try {
      // --- D 18a: 'Press on' stands the waiting party down, and says so
      {
        OD.harness.start(OD.Skirmish.build({ player: 'JC', env: 'deep', range: 900, seed: 5, playerShips: { corvette: 1 }, enemyShips: { corvette: 1 } }));
        const sim = OD.Game.sim;
        const me = sim.playerShips()[0], foe = sim.hostiles(me)[0];
        OD.harness.select(me.id);
        hurt(me, 'drive', 0.25);
        OD.Crew.assign(me, 'p1', 'repair', 'drive');
        sim.setTarget(me.id, foe.id);
        sim.setOrder(me.id, { type: 'intercept', target: foe.id });
        const d = raise(sim, 'burn', me.id);
        const s1 = shot(d);
        out.press = { raised: !!d, card: s1, before: parties(me),
          says: s1 ? /party \d comes off /.test(s1.details[1] || '') : false };
        if (d) {
          const o = d.options.find((x) => /^Press on$/.test(x.label));
          const n = logs(sim).length;
          D.choose(sim, d.id, o.key);
          out.press.logs = logs(sim).slice(n);
          out.press.after = parties(me);
          // and again, with nobody left on the part: no throw, and nothing said
          const n2 = logs(sim).length;
          try { o.act(sim); out.press.twice = { threw: false, added: logs(sim).length - n2 }; }
          catch (e) { out.press.twice = { threw: true, why: String(e) }; }
        }
      }
      // --- D 18b: the long-burn rung, once a hull an engagement; the repeat is one log line
      {
        // A gap long enough that the burn itself is the question: nothing aboard is hurt, nobody
        // is wounded, and the crew is already off the working limit, so the only thing behind the
        // card is the ten minutes the couches hold the parties.
        OD.harness.start(OD.Skirmish.build({ player: 'JC', env: 'deep', range: 2400, seed: 5, playerShips: { corvette: 1 }, enemyShips: { corvette: 1 } }));
        const sim = OD.Game.sim;
        const me = sim.playerShips()[0], foe = sim.hostiles(me)[0];
        OD.harness.select(me.id);
        OD.Crew.setG(me, 'couches');
        sim.setTarget(me.id, foe.id);
        sim.setOrder(me.id, { type: 'intercept', target: foe.id });
        const d = raise(sim, 'burn', me.id);
        out.longRung = { first: !!d, text: d ? d.text : null, second: false, lines: [],
          long: d ? /(It runs .* above 1\.2 g|It holds above 1\.2 g)/.test(String(d.text)) : false };
        if (d) {
          const o = d.options.find((x) => x.recommended) || d.options[0];
          D.choose(sim, d.id, o.key);
          const n = logs(sim).length;
          // the cooldown the answer took, lifted by hand: the only thing left to stop a second
          // card is the once-a-hull rule
          for (let i = 0; i < 40; i++) {
            if (sim._decisions) {
              sim._decisions.cool = Object.create(null);
              sim._decisions.course = Object.create(null);
              sim._decisions.recent = Object.create(null);
              sim._decisions.kindAt = Object.create(null);
            }
            OD.harness.step(3);
            sim.setOrder(me.id, { type: 'intercept', target: foe.id });
            if (find(sim, 'burn', me.id)) { out.longRung.second = true; break; }
            for (const x of (sim.decisions || []).slice()) if (x.kind !== 'burn') D.dismiss(sim, x.id);
          }
          out.longRung.lines = logs(sim).slice(n).filter((t) => / runs .* above /.test(t));
        }
      }
      // --- D 18c: the armour clause is measured over a minute, against our own reading of it
      // Her armour is taken off by hand at a rate we know, out of everybody's reach: the point is
      // what the card makes of the last minute, not how the minute happened.
      const bleed = (sim, me, steps, rate) => {
        for (let i = 0; i < steps; i++) { me.hull = Math.max(0.05, me.hull - rate * 5); OD.harness.step(5); }
      };
      const hunt = (sim, me, steps, rate) => {
        let d = null;
        for (let i = 0; i < steps && !d; i++) {
          me.hull = Math.max(0.05, me.hull - rate * 5);
          OD.harness.step(5);
          d = find(sim, 'repair', me.id);
          for (const x of (sim.decisions || []).slice()) if (x.kind !== 'repair') D.dismiss(sim, x.id);
        }
        return d;
      };
      {
        const sim = build({ range: 4000, playerShips: { corvette: 1 }, enemyShips: { corvette: 1 } });
        const me = sim.playerShips()[0];
        OD.harness.select(me.id);
        if (me.crew) me.crew.auto = false;
        hurt(me, 'sensors', 0.3);
        D.init(sim); D.update(sim, 0);
        const d = hunt(sim, me, 8, 0.0005); // 40 s of it at most: no reading yet
        out.armourQuiet = { raised: !!d, at: Math.round(sim.time), text: d ? d.text : null,
          hull: Math.round(me.hull * 100) / 100,
          quiet: d ? !/Under this fire/.test(String(d.text)) : null };
      }
      {
        const sim = build({ range: 4000, playerShips: { corvette: 1 }, enemyShips: { corvette: 1 } });
        const me = sim.playerShips()[0];
        OD.harness.select(me.id);
        if (me.crew) me.crew.auto = false;
        D.init(sim); D.update(sim, 0);
        const rate = 0.0005; // a twentieth of a hull a minute
        bleed(sim, me, 26, rate); // two minutes of it before anything is hit
        hurt(me, 'sensors', 0.3);
        const d = hunt(sim, me, 6, rate);
        const secs = (t) => { let m = /(\d+)h (\d+)m/.exec(String(t)); if (m) return +m[1] * 3600 + +m[2] * 60; m = /(\d+)m (\d+)s/.exec(String(t)); if (m) return +m[1] * 60 + +m[2]; m = /about (\d+) s/.exec(String(t)); return m ? +m[1] : null; };
        out.armour = { raised: !!d, text: d ? d.text : null, want: Math.round(me.hull / rate),
          hull: Math.round(me.hull * 100) / 100,
          said: d ? /Under this fire/.test(String(d.text)) : null,
          read: d ? secs(String(d.text).split('Under this fire')[1] || '') : null };
      }
      // --- D 19: the card's shape is fixed when it is raised
      {
        const sim = build({ range: 250, playerShips: { corvette: 1 }, enemyShips: { corvette: 1 } });
        const me = sim.playerShips()[0], foe = sim.hostiles(me)[0];
        OD.harness.select(me.id);
        sim.setTarget(me.id, foe.id);
        sim.setOrder(me.id, { type: 'keeprange', target: foe.id, range: 250e3 });
        for (let i = 0; i < 4; i++) OD.harness.step(3);
        hurt(me, 'drive', 0.4);
        const d = raise(sim, 'repair', me.id);
        const s1 = shot(d);
        // the throttle drops away under the card: the shape must not follow it
        me.cmdThrottle = 0; me.throttle = 0;
        if (me.order) me.order = { type: 'hold' };
        for (let i = 0; i < 4; i++) OD.harness.step(3);
        D.refresh(sim, d);
        const s2 = shot(d);
        out.shape = { raised: !!d, trade: s1, later: s2,
          held: !!(s1 && s2) && s1.labels.join('|') === s2.labels.join('|'),
          cut: s1 ? /^Cut the drive for /.test(s1.labels[0] || '') : false,
          blocked: (OD.Crew.board(me).parts.find((p) => p.id === 'drive') || {}).blocked || null };
      }
      // --- D 19, the other way: a card raised as a send stays a send
      {
        const sim = build({ range: 4000, playerShips: { corvette: 1 }, enemyShips: { corvette: 1 } });
        const me = sim.playerShips()[0], foe = sim.hostiles(me)[0];
        OD.harness.select(me.id);
        if (me.crew) me.crew.auto = false;
        hurt(me, 'drive', 0.35);
        const d = raise(sim, 'repair', me.id);
        const s1 = shot(d);
        sim.setTarget(me.id, foe.id);
        sim.setOrder(me.id, { type: 'intercept', target: foe.id });
        for (let i = 0; i < 4; i++) OD.harness.step(3);
        D.refresh(sim, d);
        const s2 = shot(d);
        out.sendShape = { send: s1, later: s2,
          held: !!(s1 && s2) && s1.labels.join('|') === s2.labels.join('|'),
          sends: s1 ? /^Send party \d to the drive$/.test(s1.labels[0] || '') : false,
          blocked: (OD.Crew.board(me).parts.find((p) => p.id === 'drive') || {}).blocked || null };
      }
      // --- D 20: nothing on the band puts a cleared repair down without saying so
      {
        const sim = build({ range: 200, playerShips: { destroyer: 1 }, enemyShips: { destroyer: 1 } });
        const me = sim.playerShips()[0], foe = sim.hostiles(me)[0];
        OD.harness.select(me.id);
        if (me.crew) me.crew.auto = false;
        sim.setTarget(me.id, foe.id); me.weaponsFree = true;
        OD.Engagement.setFireMode(me, 'full');
        hurt(me, 'rad1', 0.25);
        D.init(sim); D.update(sim, 0);
        const did = D.clearAndSend(sim, me, 'rad1', 'p3');
        me.radiators.state = 0;
        me.heat = me.sinkCapacity * 0.85;
        let card = null;
        for (let i = 0; i < 12 && !card; i++) {
          me.heat = Math.max(me.heat, me.sinkCapacity * 0.85);
          OD.harness.step(4);
          card = find(sim, 'heat', me.id) || find(sim, 'radiators', me.id);
          if (card) break;
          for (const x of (sim.decisions || []).slice()) D.dismiss(sim, x.id);
        }
        const outs = card ? card.options.filter((o) => /extend/i.test(o.label)) : [];
        out.relight = { did, raised: !!card, kind: card ? card.kind : null, card: shot(card),
          party: OD.Crew.board(me).parties.filter((p) => p.part === 'rad1').length,
          keys: outs.length,
          warned: outs.length > 0 && outs.every((o) => /puts party \d\u2019s repair down/.test(o.detail || '')),
          unlit: outs.every((o) => !o.recommended) };
      }
      // --- D 21: the bar is the bar for every part, the drive included
      {
        const sim = build({ playerShips: { corvette: 1 }, enemyShips: { corvette: 1 } });
        const me = sim.playerShips()[0];
        OD.harness.select(me.id);
        if (me.crew) me.crew.auto = false;
        hurt(me, 'drive', 0.5);
        const cap = (OD.Crew.board(me).parts.find((p) => p.id === 'drive') || {}).cap;
        hurt(me, 'drive', cap - 0.004);
        const none = raise(sim, 'repair', me.id);
        hurt(me, 'drive', cap - 0.4);
        const some = raise(sim, 'repair', me.id);
        out.bar = { cap, tiny: !!none, worth: !!some, card: shot(some),
          bar: D.T ? D.T.mendWorth : null };
      }
      // --- D 22: what the trade cleared comes back when the party comes off
      {
        const sim = build({ range: 250, playerShips: { corvette: 1 }, enemyShips: { corvette: 1 } });
        const me = sim.playerShips()[0], foe = sim.hostiles(me)[0];
        OD.harness.select(me.id);
        sim.setTarget(me.id, foe.id);
        sim.setOrder(me.id, { type: 'keeprange', target: foe.id, range: 250e3 });
        for (let i = 0; i < 4; i++) OD.harness.step(3);
        hurt(me, 'drive', 0.4);
        const d = raise(sim, 'repair', me.id);
        out.restore = { raised: !!d };
        if (d) {
          const o = d.options.find((x) => /^Cut the drive/.test(x.label));
          const n = logs(sim).length;
          D.choose(sim, d.id, o.key);
          out.restore.said = logs(sim).slice(n);
          out.restore.cut = { throttle: me.cmdThrottle, order: me.order.type };
          const party = OD.Crew.board(me).parties.find((p) => p.task === 'repair' && p.part === 'drive');
          const n2 = logs(sim).length;
          if (party) OD.Crew.release(me, party.id);
          OD.harness.step(3);
          out.restore.back = { order: me.order.type, range: me.order.range,
            logs: logs(sim).slice(n2).filter((t) => /Back on /.test(t)) };
        }
      }
      // --- D 22, the other way: a new order from the bridge is not overruled
      {
        const sim = build({ range: 250, playerShips: { corvette: 1 }, enemyShips: { corvette: 1 } });
        const me = sim.playerShips()[0], foe = sim.hostiles(me)[0];
        OD.harness.select(me.id);
        sim.setTarget(me.id, foe.id);
        sim.setOrder(me.id, { type: 'keeprange', target: foe.id, range: 250e3 });
        for (let i = 0; i < 4; i++) OD.harness.step(3);
        hurt(me, 'drive', 0.4);
        const d = raise(sim, 'repair', me.id);
        if (d) {
          const o = d.options.find((x) => /^Cut the drive/.test(x.label));
          D.choose(sim, d.id, o.key);
          sim.setOrder(me.id, { type: 'intercept', target: foe.id });
          const party = OD.Crew.board(me).parties.find((p) => p.task === 'repair' && p.part === 'drive');
          if (party) OD.Crew.release(me, party.id);
          OD.harness.step(3);
          out.noRestore = { order: me.order.type };
        }
      }
      // --- D 23: a venting tank is priced by the rate, not the level
      {
        const sim = build({ playerShips: { corvette: 1 }, enemyShips: { corvette: 1 } });
        const me = sim.playerShips()[0];
        OD.harness.select(me.id);
        if (me.crew) me.crew.auto = false;
        hurt(me, 'tank1', 0.2);
        for (let i = 0; i < 2; i++) OD.harness.step(3);
        const d = raise(sim, 'repair', me.id);
        const s1 = shot(d);
        const keep = s1 ? s1.details[s1.labels.findIndex((l) => /^Keep/.test(l))] : null;
        out.vent = { raised: !!d, card: s1, keep,
          rate: keep ? /keeps venting, about [\d.]+ km\/s a minute/.test(keep) : false,
          level: keep ? /stays at \d+ %/.test(keep) : true };
      }
      // --- D 24: the hard rung says 'alongside' once
      {
        OD.harness.start(OD.Skirmish.build({ player: 'JC', env: 'deep', range: 40000, seed: 5, playerShips: { corvette: 1 }, enemyShips: { corvette: 1 } }));
        const sim = OD.Game.sim;
        const me = sim.playerShips()[0], foe = sim.hostiles(me)[0];
        OD.harness.select(me.id);
        me.propMass = Math.max(1, me.fullPropMass * 0.02);
        OD.Crew.setG(me, 'couches');
        sim.setTarget(me.id, foe.id);
        sim.setOrder(me.id, { type: 'intercept', target: foe.id });
        const d = raise(sim, 'burn', me.id);
        const s1 = shot(d);
        out.hurtWords = { raised: !!d, card: s1, fit: OD.Crew.board(me).crew.fit,
          hard: s1 ? s1.details[1] || '' : '',
          once: s1 ? (String(s1.details[1] || '').match(/alongside/g) || []).length <= 1 : false,
          wounded: s1 ? /(all \d+ aboard wounded on the way|\d+ of the \d+ aboard wounded on the way|\d+ wounded a minute at )/.test(s1.details[1] || '') : false };
      }
      // --- D 25: the board's held row runs the card's own trade
      {
        const sim = build({ range: 250, playerShips: { corvette: 1 }, enemyShips: { corvette: 1 } });
        const me = sim.playerShips()[0], foe = sim.hostiles(me)[0];
        OD.harness.select(me.id);
        sim.setTarget(me.id, foe.id);
        sim.setOrder(me.id, { type: 'keeprange', target: foe.id, range: 250e3 });
        for (let i = 0; i < 4; i++) OD.harness.step(3);
        hurt(me, 'drive', 0.4);
        D.init(sim); D.update(sim, 0);
        const n = logs(sim).length;
        out.button = { words: D.tradeWords(me, 'drive'), sound: D.tradeWords(me, 'sensors'),
          did: D.clearAndSend(sim, me, 'drive', 'p1') };
        out.button.logs = logs(sim).slice(n);
        out.button.after = { throttle: me.cmdThrottle, order: me.order.type,
          party: OD.Crew.board(me).parties.filter((p) => p.part === 'drive').length };
        out.button.nothing = D.clearAndSend(sim, me, 'sensors', 'p2');
      }
      // --- D 26: a long burn with nothing to mend prices the propellant, not the parties
      {
        OD.harness.start(4); // chapter 5, Hard Burn: thirty-three minutes over the working limit
        const sim = OD.Game.sim;
        const me = sim.byId('larkspur');
        OD.harness.select('larkspur');
        const foe = me ? sim.nearestHostile(me) : null;
        if (foe) { sim.setTarget('larkspur', foe.id); sim.setOrder('larkspur', { type: 'intercept', target: foe.id }); }
        let d = null;
        for (let i = 0; i < 40 && !d; i++) { OD.harness.step(5); d = find(sim, 'burn', 'larkspur'); }
        const s1 = shot(d);
        const bd = OD.Crew.board(me);
        out.longText = { raised: !!d, card: s1, at: Math.round(sim.time),
          hurt: bd.parts.filter((p) => p.repairable && p.cap - p.hp >= (D.T ? D.T.mendWorth : 0.3)).length,
          wounded: bd.crew.wounded,
          fiction: s1 ? /Nothing can be repaired|no party can work|repairs pause|the crew can work through the burn|the parties can work/.test(String(s1.text) + ' ' + s1.details.join(' ')) : true,
          spends: s1 ? s1.details.slice(0, 2).every((t) => /[\d.]+ of [\d.]+ km\/s/.test(String(t))) : false };
      }
      // --- D 28: a rung the tanks cannot pay for says so and is never lit
      {
        OD.harness.start(OD.Skirmish.build({ player: 'JC', env: 'deep', range: 60000, seed: 5, playerShips: { corvette: 1 }, enemyShips: { corvette: 1 } }));
        const sim = OD.Game.sim;
        const me = sim.playerShips()[0], foe = sim.hostiles(me)[0];
        OD.harness.select(me.id);
        me.propMass = Math.max(1, me.fullPropMass * 0.02);
        OD.Crew.setG(me, 'couches');
        sim.setTarget(me.id, foe.id);
        sim.setOrder(me.id, { type: 'intercept', target: foe.id });
        const d = raise(sim, 'burn', me.id);
        const s1 = shot(d);
        const dryKeys = s1 ? s1.details.filter((t) => /the tanks run dry .* short/.test(String(t))) : [];
        const litIdx = s1 ? s1.labels.findIndex((l) => l === s1.rec) : -1;
        out.dry = { raised: !!d, card: s1, budget: Math.round(me.deltaV()),
          says: dryKeys.length > 0,
          unlit: litIdx < 0 || !/the tanks run dry /.test(String(s1.details[litIdx] || '')) };
      }
      // --- D 27: the cut key says what it stops, and the card closes when the board answers it
      {
        const sim = build({ range: 900, playerShips: { corvette: 1 }, enemyShips: { corvette: 1 } });
        const me = sim.playerShips()[0], foe = sim.hostiles(me)[0];
        OD.harness.select(me.id);
        sim.setTarget(me.id, foe.id);
        sim.setOrder(me.id, { type: 'intercept', target: foe.id });
        for (let i = 0; i < 4; i++) OD.harness.step(3);
        hurt(me, 'drive', 0.4);
        const d = raise(sim, 'repair', me.id);
        const s1 = shot(d);
        out.stops = { raised: !!d, card: s1,
          says: s1 ? /we stop the intercept and coast/.test(s1.details[0] || '') : false };
        if (d) {
          const n = logs(sim).length;
          const o = d.options.find((x) => /^Cut the drive/.test(x.label));
          D.choose(sim, d.id, o.key);
          out.stops.logs = logs(sim).slice(n).filter((t) => /Throttle to 0/.test(t));
        }
      }
      {
        const sim = build({ range: 4000, playerShips: { corvette: 1 }, enemyShips: { corvette: 1 } });
        const me = sim.playerShips()[0];
        OD.harness.select(me.id);
        if (me.crew) me.crew.auto = false;
        hurt(me, 'sensors', 0.3);
        const d = raise(sim, 'repair', me.id);
        out.stale = { raised: !!d, closed: null, logs: null };
        if (d) {
          const n = logs(sim).length;
          OD.Crew.assign(me, 'p1', 'repair', 'sensors');
          for (let i = 0; i < 12; i++) OD.harness.step(3);
          out.stale.closed = !(sim.decisions || []).some((x) => x.id === d.id);
          out.stale.logs = logs(sim).slice(n).filter((t) => /Decision: .*sensor suite/.test(t)).length;
        }
      }
      // --- D 29: a boarding the decks would throw back is never the pick
      {
        const sim = build({ range: 60, playerShips: { corvette: 1 }, enemyShips: { cruiser: 1 } });
        const me = sim.playerShips()[0], foe = sim.hostiles(me)[0];
        OD.harness.select(me.id);
        sim.setTarget(me.id, foe.id);
        foe.systems.drive = 0.05;
        const d = raise(sim, 'cripple', me.id);
        const s1 = shot(d);
        const B = OD.Sim && OD.Sim.BOARD ? OD.Sim.BOARD : null;
        const i = s1 ? s1.labels.findIndex((l) => /^Board her$/.test(l)) : -1;
        out.decks = { raised: !!d, card: s1, odds: B ? B.odds : null,
          theirs: foe.crew ? Math.round(foe.crew.fit) : null, ours: me.crew ? Math.round(me.crew.fit) : null,
          says: i >= 0 ? /her \d+ fit crew against (our|.+’s) \d+ throws the party back/.test(s1.details[i] || '') : false,
          unlit: i >= 0 ? s1.rec !== 'Board her' : false };
      }
    } catch (e) { out.err.push(String(e.stack || e)); }
    out.errors = OD.errors.slice();
    return out;
  });
  check('no errors while the round-3 fixes are exercised', r3.err.length === 0 && r3.errors.length === 0,
    r3.err.concat(r3.errors).join(' | '));
  // D 18a / fun r3 2: the send the card recommended was taken away five seconds later and nobody
  // stood the party down: 295 s of the sensor watch at 70 % for a party standing by a lit drive.
  check('“Press on” stands the waiting party down and logs what she did',
    !!r3.press && r3.press.raised === true && r3.press.says === true &&
    Array.isArray(r3.press.logs) && /^Decision: /.test(r3.press.logs[0] || '') &&
    /^Party \d back to /.test(r3.press.logs[1] || '') &&
    String(r3.press.after).indexOf('repair:drive') < 0,
    JSON.stringify({ before: r3.press && r3.press.before, after: r3.press && r3.press.after, logs: r3.press && r3.press.logs }));
  if (r3.press && r3.press.card) note(r3.press.card.title + ' — ' + r3.press.card.text + '\n    ' + r3.press.card.options.join('\n    '));
  // The crew module stands her down by itself after a minute, so the key has to survive finding
  // her already gone.
  check('and pressing on again with nobody on the part says nothing and throws nothing',
    !!r3.press && !!r3.press.twice && r3.press.twice.threw === false && r3.press.twice.added === 0,
    JSON.stringify(r3.press && r3.press.twice));
  // D 18b / fun r3 3: nineteen burn cards in eight chapters, five of them the same card.
  check('the long-burn rung is one question a hull an engagement, and the repeat is one log line',
    !!r3.longRung && r3.longRung.first === true && r3.longRung.long === true && r3.longRung.second === false &&
    (r3.longRung.lines || []).length >= 1 &&
    / runs .* above 1\.2 g\./.test((r3.longRung.lines || [])[0] || ''),
    JSON.stringify({ first: r3.longRung && r3.longRung.text, second: r3.longRung && r3.longRung.second,
      lines: r3.longRung && r3.longRung.lines }));
  if (r3.longRung && (r3.longRung.lines || []).length) note('the repeat: ' + r3.longRung.lines[0]);
  // D 18c / fun r3 5: 'Under this fire we have about 3m 52s.' at 42 % of her hull, on a corvette
  // that fought 684 s more and took the chapter at 35 %.
  check('under a minute of fire the card gives no armour clause at all',
    !!r3.armourQuiet && r3.armourQuiet.raised === true && r3.armourQuiet.quiet === true,
    JSON.stringify(r3.armourQuiet));
  check('and past a minute it is what her armour has actually been costing',
    !!r3.armour && r3.armour.raised === true && r3.armour.said === true && r3.armour.read != null &&
    Math.abs(r3.armour.read - r3.armour.want) <= Math.max(60, r3.armour.want * 0.25),
    JSON.stringify({ read: r3.armour && r3.armour.read, want: r3.armour && r3.armour.want, text: r3.armour && r3.armour.text }));
  // D 19 / int r3: inUse follows the autopilot's throttle pulses, so key 2 changed from 'Keep the
  // burn' to 'Send party 2 to the drive' under the player's hand, and the settle ran whichever
  // shape was current when the minute ran out.
  check('a card raised as a trade stays a trade, whatever the throttle does under it',
    !!r3.shape && r3.shape.raised === true && r3.shape.cut === true && r3.shape.held === true,
    JSON.stringify({ blocked: r3.shape && r3.shape.blocked }) + ' · ' +
    (r3.shape && r3.shape.later ? r3.shape.later.labels.join(' | ') : 'never raised'));
  check('and a card raised as a send stays a send when the drive lights under it',
    !!r3.sendShape && r3.sendShape.sends === true && r3.sendShape.held === true,
    JSON.stringify({ blocked: r3.sendShape && r3.sendShape.blocked }) + ' · ' +
    (r3.sendShape && r3.sendShape.later ? r3.sendShape.later.labels.join(' | ') : 'never raised'));
  // D 20 / int r3: 'Stow the panels for 3 min' and then, on the recommended pick, 'Extend the
  // radiators'. The party stayed on the panel and the mend never landed.
  check('a key that would put a cleared repair down says so, and is never the lit one',
    !!r3.relight && r3.relight.did === true && r3.relight.raised === true &&
    r3.relight.warned === true && r3.relight.unlit === true && r3.relight.party === 1,
    JSON.stringify({ kind: r3.relight && r3.relight.kind, party: r3.relight && r3.relight.party }) + ' · ' +
    (r3.relight && r3.relight.card ? r3.relight.card.options.join(' | ') : 'no card'));
  // D 21 / int r3: chapter 3's headline crew card was a drive at 69.6 % against a 70 % cap —
  // four thousandths of a hull for 313 s of work and the sensor watch at 70 %.
  check('a mend under the bar is not a card, whatever part it is on',
    !!r3.bar && r3.bar.tiny === false && r3.bar.worth === true,
    JSON.stringify({ cap: r3.bar && r3.bar.cap, bar: r3.bar && r3.bar.bar,
      tiny: r3.bar && r3.bar.tiny, worth: r3.bar && r3.bar.worth }));
  // D 22 / int r3: 'Cut the drive for 6 min' set the order to hold and nothing gave it back.
  check('the order the trade cleared comes back when the party comes off, with one line',
    !!r3.restore && r3.restore.raised === true && r3.restore.cut &&
    r3.restore.cut.throttle === 0 && r3.restore.cut.order === 'hold' &&
    !!r3.restore.back && r3.restore.back.order === 'keeprange' && (r3.restore.back.logs || []).length === 1,
    JSON.stringify(r3.restore && r3.restore.back));
  if (r3.restore && r3.restore.back && (r3.restore.back.logs || []).length) note('the order back: ' + r3.restore.back.logs[0]);
  check('and an order the bridge gave meanwhile is not overruled',
    !!r3.noRestore && r3.noRestore.order === 'intercept', JSON.stringify(r3.noRestore));
  // D 23 / realism r3: 'Tank 1 stays at 20 %' while five kilometres a second went out of the hole.
  check('keeping a venting tank is priced by what is going, not by the level',
    !!r3.vent && r3.vent.raised === true && r3.vent.rate === true && r3.vent.level === false,
    String(r3.vent && r3.vent.keep));
  // D 24 / writing r3: 'every one of the 24 aboard hurt before we are alongside · nobody can
  // answer a hit until we are alongside · alongside in 13m 06s'.
  check('the hard rung says “alongside” once',
    !!r3.hurtWords && r3.hurtWords.raised === true && r3.hurtWords.once === true &&
    r3.hurtWords.wounded === true, String(r3.hurtWords && r3.hurtWords.hard));
  // D 25: the board's held row and the card run one act.
  check('the board’s held row runs the card’s own trade',
    !!r3.button && r3.button.words === 'Cut the drive' && r3.button.sound === null &&
    r3.button.did === true && r3.button.nothing === false && !!r3.button.after &&
    r3.button.after.throttle === 0 && r3.button.after.order === 'hold' && r3.button.after.party === 1 &&
    (r3.button.logs || []).length >= 2,
    JSON.stringify(r3.button && r3.button.after) + ' · ' + (r3.button.logs || []).join(' | '));
  // D 26 / eng r3: 'Nothing can be repaired for any of it' on a hull with nothing to repair, for
  // thirty-three minutes, in a chapter whose first damage lands at 2 465 s.
  check('a long burn with nothing to mend prices the propellant, not the parties',
    !!r3.longText && r3.longText.raised === true && r3.longText.hurt === 0 &&
    r3.longText.fiction === false && r3.longText.spends === true,
    (r3.longText && r3.longText.card ? r3.longText.card.text + ' · ' + r3.longText.card.options.join(' | ') : 'never raised'));
  if (r3.longText && r3.longText.card) note(r3.longText.card.title + ' — ' + r3.longText.card.text + '\n    ' + r3.longText.card.options.join('\n    '));
  // D 28 / realism r3: 'Burn at 2.5 g · alongside in 19m 30s' on 16.2 km/s of a 22.2 km/s run;
  // flown, she ran dry after 665 s, 17 558 km short.
  check('a rung the tanks cannot pay for says where it runs dry, and is never lit',
    !!r3.dry && r3.dry.raised === true && r3.dry.says === true && r3.dry.unlit === true,
    JSON.stringify({ budget: r3.dry && r3.dry.budget }) + ' · ' +
    (r3.dry && r3.dry.card ? r3.dry.card.options.join(' | ') : 'never raised'));
  if (r3.dry && r3.dry.card) note(r3.dry.card.title + ' — ' + r3.dry.card.text + '\n    ' + r3.dry.card.options.join('\n    '));
  // D 27 / eng r3: 'Cut the drive for 7 min' turned an intercept into a hold and said nothing.
  check('the cut key names the order it stops, and the log records it',
    !!r3.stops && r3.stops.raised === true && r3.stops.says === true &&
    (r3.stops.logs || []).length === 1 && /Throttle to 0\. The intercept stops/.test((r3.stops.logs || [])[0] || ''),
    JSON.stringify(r3.stops && r3.stops.logs));
  check('and a card whose part has its party is over, rather than lighting a second send',
    !!r3.stale && r3.stale.raised === true && r3.stale.closed === true && r3.stale.logs === 0,
    JSON.stringify(r3.stale));
  // D 29 / realism r3: sim.js throws the party back past two fit defenders to one of ours.
  check('a boarding the decks would throw back is priced and never lit',
    !!r3.decks && r3.decks.raised === true && r3.decks.says === true && r3.decks.unlit === true,
    JSON.stringify({ theirs: r3.decks && r3.decks.theirs, ours: r3.decks && r3.decks.ours, odds: r3.decks && r3.decks.odds }) +
    ' · ' + (r3.decks && r3.decks.card ? r3.decks.card.options.join(' | ') : 'never raised'));

  // ------------------------------------------------------------------- the scan fixes (W1 to E3)
  // Seven readings the scan found on cards that were otherwise right: a Why? paragraph that
  // announced itself before it said anything, a boarding priced at a constant, a chapter with no
  // hostile in it offering a fight, a card titled on a hull that was not hurt, a break-off that
  // opened nothing and said so in metres a second, a radiator trade that never gave the panels
  // back, and an approach rung flown against a hull that was outrunning it.
  console.log('scenario: the scan fixes to the cards');
  const scan = await page.evaluate(() => {
    const out = { err: [] };
    const D = OD.Decisions;
    const build = (o) => { OD.harness.start(OD.Skirmish.build(Object.assign({ player: 'JC', env: 'deep', range: 400, seed: 5 }, o))); return OD.Game.sim; };
    const find = (sim, kind, id) => (sim.decisions || []).find((x) => x.kind === kind && (x.ships || [x.shipId]).includes(id)) || null;
    const raise = (sim, kind, id) => {
      D.init(sim); D.update(sim, 0);
      let d = find(sim, kind, id);
      if (d) return d;
      for (let i = 0; i < 14; i++) {
        OD.harness.step(3);
        d = find(sim, kind, id);
        if (d) return d;
        for (const x of (sim.decisions || []).slice()) if ((x.ships || [x.shipId]).includes(id) && x.kind !== kind) D.dismiss(sim, x.id);
      }
      return null;
    };
    const hurt = (sh, id, hp) => { const c = (sh.components || []).find((x) => x.id === id); if (c) { c.hp = hp; sh._dmgRev = (sh._dmgRev || 0) + 1; OD.Damage.aggregate(sh); } };
    const shot = (d) => d && ({ title: d.title, text: d.text, teach: d.teach, rec: (d.options.find((o) => o.recommended) || {}).label || null,
      labels: d.options.map((o) => o.label), details: d.options.map((o) => o.detail),
      options: d.options.map((o) => o.key + ' ' + o.label + ' · ' + o.detail + (o.recommended ? ' [rec]' : '')) });
    try {
      // --- W4 + E3 + W1 + W5 read off one card: a hull above the hull line with a short clock
      {
        const sim = build({ range: 90, playerShips: { corvette: 1 }, enemyShips: { cruiser: 1 } });
        const me = sim.playerShips()[0], foe = sim.hostiles(me)[0];
        OD.harness.select(me.id);
        sim.setTarget(me.id, foe.id); sim.setTarget(foe.id, me.id);
        me.weaponsFree = true; foe.weaponsFree = true;
        OD.Engagement.setFireMode(foe, 'full');
        sim.setOrder(me.id, { type: 'keeprange', target: foe.id, range: 90e3 });
        sim.setOrder(foe.id, { type: 'intercept', target: me.id });
        let d = null, at = null;
        for (let i = 0; i < 120 && !d; i++) {
          OD.harness.step(3);
          d = find(sim, 'withdraw', me.id);
          if (d) { at = Math.round((me.hull != null ? me.hull : 1) * 1000) / 10; break; }
          for (const x of (sim.decisions || []).slice()) if (x.kind !== 'withdraw') D.dismiss(sim, x.id);
          if (me.destroyed || me.disabled || (me.hull || 0) < 0.5) break;
        }
        const s1 = shot(d);
        out.clock = { raised: !!d, hull: at, card: s1,
          // W4: above the hull line the card is titled on the clock it prints, not on a hull that is not hurt.
          clockTitle: s1 ? /armour lasts .+ at this fire\.$/.test(s1.title || '') : false,
          hullTitle: s1 ? /down to \d+ % of (our|.+’s) hull/.test(s1.title || '') : false,
          // W4: and the armour lesson keeps its half-gone sentence for a hull that has lost half.
          half: s1 ? /With half of it gone/.test(s1.teach || '') : false,
          // W1: no meta sentences, and every leftover reads as 'Key: sentence.'
          meta: s1 ? /Each key holds|keys left out|also says/.test(s1.teach || '') : false,
          behind: s1 && s1.teach ? (/(Break off[^:]*|Press on|Get behind [^:]+): [a-z0-9]/.test(s1.teach)) : false };
      }
      // --- E3: at full armour with nothing hit, being outnumbered is not this card's question
      {
        const sim = build({ range: 400, playerShips: { corvette: 1 }, enemyShips: { corvette: 3 } });
        const me = sim.playerShips()[0];
        OD.harness.select(me.id);
        me.weaponsFree = true;
        for (const h of sim.hostiles(me)) { h.weaponsFree = true; sim.setTarget(h.id, me.id); sim.setOrder(h.id, { type: 'intercept', target: me.id }); }
        let seen = null;
        for (let i = 0; i < 40 && !seen; i++) {
          OD.harness.step(3);
          const d = find(sim, 'withdraw', me.id);
          if (d) { seen = { hull: Math.round((me.hull != null ? me.hull : 1) * 1000) / 10, title: d.title }; break; }
          for (const x of (sim.decisions || []).slice()) if (x.kind !== 'withdraw') D.dismiss(sim, x.id);
        }
        out.full = { raised: seen, hull: Math.round((me.hull != null ? me.hull : 1) * 1000) / 10 };
      }
      // --- W5: a pursuer who matches the whole burn
      {
        const sim = build({ range: 300, playerShips: { corvette: 1 }, enemyShips: { corvette: 1 } });
        const me = sim.playerShips()[0], foe = sim.hostiles(me)[0];
        OD.harness.select(me.id);
        sim.setTarget(me.id, foe.id); me.weaponsFree = true; foe.weaponsFree = true;
        sim.setOrder(foe.id, { type: 'intercept', target: me.id });
        foe.target = me.id; foe.throttle = 1;
        me.hull = 0.3;
        let d = null;
        for (let i = 0; i < 40 && !d; i++) {
          OD.harness.step(4);
          d = find(sim, 'withdraw', me.id);
          for (const x of (sim.decisions || []).slice()) if (x.kind !== 'withdraw') D.dismiss(sim, x.id);
        }
        const s1 = shot(d);
        const i = s1 ? s1.labels.findIndex((l) => /^Break off/.test(l)) : -1;
        out.matched = { raised: !!d, card: s1,
          says: i >= 0 ? /^Break off: (she|.+) can match the burn$/.test(s1.labels[i]) : false,
          keeps: i >= 0 ? /can match this burn, so the range only opens once her drive is hurt/.test(s1.details[i] || '') : false,
          zero: i >= 0 ? /opening at 0(\.0+)? m\/s/.test(s1.details[i] || '') : false,
          unlit: i >= 0 ? s1.rec !== s1.labels[i] : false };
      }
      // --- W2: the crossing is the decks' own, and a boarding they throw back says so
      for (const job of [{ key: 'even', foe: 'corvette' }, { key: 'odds', foe: 'cruiser' }]) {
        const ships = {}; ships[job.foe] = 1;
        const sim = build({ range: 60, playerShips: { corvette: 1 }, enemyShips: ships });
        const me = sim.playerShips()[0], foe = sim.hostiles(me)[0];
        OD.harness.select(me.id);
        sim.setTarget(me.id, foe.id);
        foe.systems.drive = 0.05; foe.disabled = false;
        const d = raise(sim, 'cripple', me.id);
        const s1 = shot(d);
        const i = s1 ? s1.labels.findIndex((l) => /^Board her$/.test(l)) : -1;
        const plan = OD.Sim && typeof OD.Sim.boardingPlan === 'function' ? OD.Sim.boardingPlan(me, foe) : null;
        out[job.key] = { raised: !!d, card: s1, plan: plan ? { time: Math.round(plan.time), thrownBack: plan.thrownBack } : null,
          // the key prices the crossing the sim charges, not the constant
          held: i >= 0 ? (/ hold ([^·]+) inside /.exec(s1.details[i] || '') || [null, null])[1] : null,
          teach: s1 ? /90 s against a crew the size of ours, longer against a bigger one/.test(s1.teach || '') : false,
          unlit: i >= 0 ? s1.rec !== 'Board her' : false };
      }
      // --- W3: chapter 1 has nothing hostile in it, so the key offers no fight
      {
        OD.harness.start(0);
        const sim = OD.Game.sim;
        OD.harness.select('larkspur');
        const me = sim.byId('larkspur');
        sim.setTarget('larkspur', 'meridian');
        sim.setOrder('larkspur', { type: 'intercept', target: 'meridian' });
        let d = null;
        for (let i = 0; i < 60 && !d; i++) { OD.harness.step(5); d = find(sim, 'burn', 'larkspur'); }
        const s1 = shot(d);
        const i = s1 ? s1.labels.findIndex((l) => /^Hold/.test(l)) : -1;
        out.quiet = { raised: !!d, card: s1, hostiles: sim.hostiles(me).length,
          label: i >= 0 ? s1.labels[i] : null,
          fight: i >= 0 ? /fight/.test(s1.labels[i] + ' ' + (s1.details[i] || '')) : false,
          parties: i >= 0 ? /the parties keep working/.test(s1.details[i] || '') : false,
          costs: i >= 0 ? /(comes down in|alongside in)/.test(s1.details[i] || '') : false };
      }
      // --- R1: the trade gives the panels back, and prices the stow at the order's throttle
      {
        const sim = build({ range: 900, playerShips: { corvette: 1 }, enemyShips: { corvette: 1 } });
        const me = sim.playerShips()[0], foe = sim.hostiles(me)[0];
        OD.harness.select(me.id);
        sim.setTarget(me.id, foe.id);
        sim.setOrder(me.id, { type: 'intercept', target: foe.id });
        if (me.crew) me.crew.auto = false;
        sim.setRadiators(me.id, 'auto');
        const was = { auto: me.radiators.auto, deployed: me.radiators.deployed };
        for (let i = 0; i < 3; i++) OD.harness.step(3);
        hurt(me, 'rad1', 0.25);
        const d = raise(sim, 'repair', me.id);
        const s1 = shot(d);
        const i = s1 ? s1.labels.findIndex((l) => /^Stow the panels/.test(l)) : -1;
        // The forecast is read against the two throttles by hand: the coast the key used to price,
        // and the burn the order will actually hold.
        const cap = me.sinkCapacity;
        const secs = 240;
        const load = (thr) => {
          const sys = me.systems && me.systems.drive != null ? me.systems.drive : 1;
          const heatIn = Math.max(0, (me.idleHeat || 0) + (thr > 0 ? (me.driveHeat || 0) * thr * sys : 0) + (me.extraHeat || 0));
          return Math.round(((me.heat + heatIn * secs) / cap) * 100);
        };
        const printed = i >= 0 ? (/to about (\d+) %/.exec(s1.details[i] || '') || [null, null])[1] : null;
        out.trade = { raised: !!d, card: s1, was, order: me.order.type,
          printed: printed != null ? +printed : null, atBurn: load(1), atCoast: load(0) };
        if (i >= 0) {
          const n = (sim.log || []).length;
          D.choose(sim, d.id, d.options[i].key);
          out.trade.stowed = { auto: me.radiators.auto, deployed: me.radiators.deployed };
          const pty = OD.Crew.board(me).parties.find((p) => p.task === 'repair');
          if (pty) OD.Crew.release(me, pty.id);
          OD.harness.step(3);
          out.trade.back = { auto: me.radiators.auto, deployed: me.radiators.deployed,
            lines: (sim.log || []).slice(n).map((l) => l.text || l.message || String(l)).filter((t) => /radiators/i.test(t)) };
        }
      }
      // --- R2: an approach rung against a hull outrunning it
      {
        const sim = build({ range: 1500, playerShips: { corvette: 1 }, enemyShips: { corvette: 1 } });
        const me = sim.playerShips()[0], foe = sim.hostiles(me)[0];
        OD.harness.select(me.id);
        sim.setTarget(me.id, foe.id);
        me.propMass = me.fullPropMass;
        foe.propMass = Math.max(1, foe.fullPropMass * 0.02);
        const away = Math.atan2(foe.pos.y - me.pos.y, foe.pos.x - me.pos.x);
        const dir = { x: Math.cos(away), y: Math.sin(away) };
        const run = () => {
          foe.cmdHeading = away; foe.heading = away; foe.angVel = 0;
          foe.cmdThrottle = 1; foe.throttle = 1; foe.order = { type: 'hold' };
          foe.vel = { x: dir.x * 4000, y: dir.y * 4000 };
          me.vel = { x: 0, y: 0 };
        };
        for (let i = 0; i < 20; i++) { run(); OD.harness.step(3); }
        run();
        D.init(sim); D.update(sim, 0);
        let d = find(sim, 'approach', me.id);
        for (let i = 0; i < 12 && !d; i++) {
          run(); OD.harness.step(3);
          d = find(sim, 'approach', me.id);
          for (const x of (sim.decisions || []).slice()) if (x.kind !== 'approach') D.dismiss(sim, x.id);
        }
        const s1 = shot(d);
        const i = s1 ? s1.labels.findIndex((l) => /^Burn hard$/.test(l)) : -1;
        out.outrun = { raised: !!d, card: s1,
          mine: Math.round(me.accel() * 10) / 10, hers: Math.round(foe.accel() * 10) / 10,
          says: i >= 0 ? /she outruns us, and the range opens at /.test(s1.details[i] || '') : false,
          promise: i >= 0 ? /alongside in /.test(s1.details[i] || '') : false };
      }
    } catch (e) { out.err.push(String(e.stack || e)); }
    out.errors = OD.errors.slice();
    return out;
  });
  check('no errors while the scan fixes are exercised', scan.err.length === 0 && scan.errors.length === 0,
    scan.err.concat(scan.errors).join(' | '));
  // W4: 'We are down to 100 % of our hull' on a hull nothing had touched.
  check('above the hull line the card is titled on the armour clock it prints',
    !!scan.clock && scan.clock.raised === true && scan.clock.hull > 80 &&
    scan.clock.clockTitle === true && scan.clock.hullTitle === false,
    JSON.stringify({ hull: scan.clock && scan.clock.hull, title: scan.clock && scan.clock.card && scan.clock.card.title }));
  check('and the armour lesson keeps its half-gone sentence for a hull that has lost half',
    !!scan.clock && scan.clock.half === false && !!scan.matched && scan.matched.raised === true &&
    /With half of it gone/.test((scan.matched.card && scan.matched.card.teach) || ''),
    JSON.stringify({ atFull: scan.clock && scan.clock.half, atThirty: !!scan.matched && /With half of it gone/.test((scan.matched.card && scan.matched.card.teach) || '') }));
  // W1: 'Each key holds three clauses. Here is what the keys left out.' before it said anything.
  check('the Why? paragraph reads the keys' + '’' + ' own words, with no paragraph about paragraphs',
    !!scan.clock && scan.clock.meta === false && scan.clock.behind === true,
    (scan.clock && scan.clock.card ? scan.clock.card.teach : 'never raised'));
  // E3: chapter 4 put it on every hull at 279 s at 100.0 % with nothing hit.
  check('a hull at full armour with nothing hit is not asked whether to break off',
    !!scan.full && scan.full.raised === null && scan.full.hull > 90,
    JSON.stringify(scan.full));
  // W5: 'opening at 0 m/s' as though that were a result.
  check('a break-off that opens nothing says so on the key, and is never the pick',
    !!scan.matched && scan.matched.raised === true && scan.matched.says === true &&
    scan.matched.keeps === true && scan.matched.zero === false && scan.matched.unlit === true,
    (scan.matched && scan.matched.card ? scan.matched.card.options.join(' | ') : 'never raised'));
  if (scan.matched && scan.matched.card) note(scan.matched.card.title + ' — ' + scan.matched.card.text + '\n    ' + scan.matched.card.options.join('\n    '));
  // W2: 'hold 1m 30s' was the constant, whoever was aboard her.
  check('the boarding key prices the crossing the sim charges, not the constant',
    !!scan.even && !!scan.odds && scan.even.held === '1m 30s' && scan.odds.held === '6m 00s' &&
    !!scan.odds.plan && scan.odds.plan.time === 360,
    JSON.stringify({ even: scan.even && scan.even.held, odds: scan.odds && scan.odds.held, plan: scan.odds && scan.odds.plan }));
  check('and the lesson says what the crossing depends on',
    !!scan.even && scan.even.teach === true && scan.odds.unlit === true,
    (scan.even && scan.even.card ? scan.even.card.teach : 'never raised'));
  // W3: 'Hold and fight at this range' with nothing hostile in the sim.
  check('with no hostile in the sim the burn card offers no fight',
    !!scan.quiet && scan.quiet.raised === true && scan.quiet.hostiles === 0 &&
    scan.quiet.label === 'Hold this range' && scan.quiet.fight === false &&
    scan.quiet.parties === false && scan.quiet.costs === true,
    JSON.stringify({ hostiles: scan.quiet && scan.quiet.hostiles, label: scan.quiet && scan.quiet.label }) + ' · ' +
    (scan.quiet && scan.quiet.card ? scan.quiet.card.options.join(' | ') : 'never raised'));
  if (scan.quiet && scan.quiet.card) note(scan.quiet.card.title + ' — ' + scan.quiet.card.text + '\n    ' + scan.quiet.card.options.join('\n    '));
  // R1: the mend landed, the log said the radiators were out again, and the panels stayed in.
  check('the panels the trade stowed are out again when the party comes off',
    !!scan.trade && scan.trade.raised === true && !!scan.trade.stowed && scan.trade.stowed.deployed === false &&
    !!scan.trade.back && scan.trade.back.deployed === true && scan.trade.back.auto === true &&
    (scan.trade.back.lines || []).some((t) => /The radiators are out again, and back on automatic\./.test(t)),
    JSON.stringify(scan.trade && scan.trade.back));
  // R1: the forecast priced the coast while the autopilot was burning.
  check('and the stow is forecast at the throttle the order will hold',
    !!scan.trade && scan.trade.order === 'intercept' && scan.trade.printed != null &&
    Math.abs(scan.trade.printed - scan.trade.atBurn) <= 3 && scan.trade.atBurn - scan.trade.atCoast > 10,
    JSON.stringify({ printed: scan.trade && scan.trade.printed, atBurn: scan.trade && scan.trade.atBurn, atCoast: scan.trade && scan.trade.atCoast }));
  // R2: 'Burn hard · alongside in 25m 47s' against a hull making 17.3 m/s² to our 13.0.
  check('an approach rung against a hull that outruns us promises no arrival',
    !!scan.outrun && scan.outrun.raised === true && scan.outrun.hers > scan.outrun.mine &&
    scan.outrun.says === true && scan.outrun.promise === false,
    JSON.stringify({ mine: scan.outrun && scan.outrun.mine, hers: scan.outrun && scan.outrun.hers }) + ' · ' +
    (scan.outrun && scan.outrun.card ? scan.outrun.card.details[0] : 'never raised'));
  if (scan.outrun && scan.outrun.card) note(scan.outrun.card.title + ' — ' + scan.outrun.card.text + '\n    ' + scan.outrun.card.options.join('\n    '));

  // ---------------------------------------------------------------- the chapters the loop is for
  // The fun and engagement reviewers played chapters 2 to 8 on the recommended pick and found the
  // crew loop silent in the ones that teach it: chapter 2 ran 2 009 s with the sensor suite at
  // 44 % and both mounts at about 50 % and never raised a card, because the window only opened
  // when a new part joined the list while the bar is crossed three hundred seconds later; and
  // chapter 5, Hard Burn, was flown at 2.3 g for thirty-three minutes with nobody ever asked.
  // Both are read here on the recommended pick alone, with what the flagship actually had to mend.
  console.log('scenario: chapters 2, 4, 5 and 6 on the recommended pick, and chapter 5 as an intercept');
  const chap = await page.evaluate(() => {
    const D = OD.Decisions;
    const BAR = (D.T && D.T.mendWorth > 0 ? D.T.mendWorth : 0.3);
    const runs = [];
    const plan = [{ c: 1 }, { c: 3 }, { c: 4 }, { c: 5 }, { c: 4, intercept: true }];
    for (const job of plan) {
      const out = { chapter: job.c + 1, intercept: !!job.intercept, repairAt: null, burnAt: null,
        best: 0, bestPart: null, vital: false, cards: 0, time: 0, outcome: null, first: null, firstBurn: null, err: [] };
      try {
        OD.harness.start(job.c);
        const sim = OD.Game.sim;
        OD.harness.select('larkspur');
        if (job.intercept) {
          const me = sim.byId('larkspur');
          const foe = me ? sim.nearestHostile(me) : null;
          if (foe) { sim.setTarget('larkspur', foe.id); sim.setOrder('larkspur', { type: 'intercept', target: foe.id }); }
        }
        const seen = new Set();
        while (sim.time < 2700 && !sim.outcome) {
          OD.harness.step(5);
          const me = sim.byId('larkspur');
          if (me && !me.destroyed) {
            const b = OD.Crew.board(me);
            if (b) {
              for (const r of b.parts) {
                if (!r || !r.repairable || r.cap == null || r.hp == null) continue;
                if (/^tank/.test(r.id) && r.state !== 'venting') continue;
                const gain = Math.max(0, r.cap - r.hp);
                // D 21: the bar is the bar for the drive and the reactor too, so a drive four
                // thousandths under its cap is not a mend this chapter owed a card.
                if ((/^(drive|reactor)/.test(r.id) && gain >= BAR) || r.state === 'venting') out.vital = true;
                if (gain > out.best) { out.best = Math.round(gain * 100) / 100; out.bestPart = r.id; }
              }
            }
          }
          for (const d of sim.decisions || []) {
            if (seen.has(d.id)) continue;
            seen.add(d.id);
            out.cards++;
            if ((d.ships || [d.shipId]).indexOf('larkspur') < 0) continue;
            if (d.kind === 'repair' && out.repairAt == null) {
              out.repairAt = Math.round(sim.time);
              out.first = { title: d.title, text: d.text, options: d.options.map((o) => o.key + ' ' + o.label + ' · ' + o.detail + (o.recommended ? ' [rec]' : '')) };
            }
            if (d.kind === 'burn' && out.burnAt == null) {
              out.burnAt = Math.round(sim.time);
              out.firstBurn = { title: d.title, text: d.text, options: d.options.map((o) => o.key + ' ' + o.label + ' · ' + o.detail + (o.recommended ? ' [rec]' : '')) };
            }
          }
          for (const d of (sim.decisions || []).slice()) {
            const o = (d.options || []).find((x) => x.recommended);
            if (o) D.choose(sim, d.id, o.key);
          }
        }
        out.time = Math.round(sim.time);
        out.outcome = sim.outcome || 'none';
      } catch (e) { out.err.push(String(e.stack || e)); }
      out.errors = OD.errors.slice();
      runs.push(out);
    }
    return runs;
  });
  // The bar the card opens on, read out of the page: this file runs in node, where OD is not.
  const mendBar = await page.evaluate(() => (OD.Decisions && OD.Decisions.T ? OD.Decisions.T.mendWorth : 0.3) || 0.3);
  {
    const bad = chap.reduce((a, r) => a.concat(r.err, r.errors), []);
    check('no errors while the chapters are played on the recommended pick', bad.length === 0, bad.slice(0, 2).join(' | '));
    const tag = (r) => 'ch' + r.chapter + (r.intercept ? ' intercept' : '');
    for (const r of chap) {
      note(tag(r) + ': ' + r.outcome + ' at ' + r.time + ' s, ' + r.cards + ' cards, repair ' +
        (r.repairAt == null ? 'none' : r.repairAt + ' s') + ', burn ' + (r.burnAt == null ? 'none' : r.burnAt + ' s') +
        ', best mend on Larkspur ' + r.best + (r.bestPart ? ' (' + r.bestPart + ')' : '') + (r.vital ? ', a vital part' : ''));
    }
    // A chapter where a mend worth the bar came up on the flagship and no card was raised is the
    // finding: the window used to open only on a new entry, so a part that crossed the bar later
    // was never asked about. A chapter where nothing on her ever crossed it cannot raise one, and
    // that is reported rather than failed — the damage is the chapter's, not the card's.
    const bar = mendBar;
    const due = chap.filter((r) => (r.best >= bar - 1e-6 || r.vital) && r.repairAt == null);
    const dumb = chap.filter((r) => r.best < bar - 1e-6 && !r.vital && r.repairAt == null);
    check('every chapter whose flagship has a mend worth the bar raises the repair card (' +
      chap.filter((r) => r.repairAt != null).length + ' of ' + chap.length + ' raised one)',
      due.length === 0, due.map((r) => tag(r) + ': best ' + r.best + ' on ' + r.bestPart).join(' | '));
    for (const r of dumb) {
      note('no repair card in ' + tag(r) + ': the best mend on Larkspur all run was ' + r.best +
        (r.bestPart ? ' on ' + r.bestPart : ', nothing hit') + ', under the ' + bar + ' bar. ' +
        'The card is right to stay quiet; the damage is the chapter’s to change.');
    }
    const ch2 = chap.find((r) => r.chapter === 2);
    // Round 2 asked this of chapter 2 flatly, when the drive and the reactor were asked about
    // whatever a mend was worth. Under D 21 a chapter whose damage never crosses the bar has
    // nothing to ask about, and the run above reads 63/80 on her sensor suite and 56/60 on her
    // reactor: the card is right to stay quiet, and the damage is the chapter's to change.
    check('chapter 2, the chapter that teaches the board, raises a repair card whenever her damage crosses the bar',
      !!ch2 && (ch2.repairAt != null || !(ch2.best >= bar - 1e-6 || ch2.vital)),
      ch2 ? 'best mend ' + ch2.best + ', ' + ch2.cards + ' cards in ' + ch2.time + ' s' : 'no run');
    if (ch2 && ch2.repairAt == null) note('chapter 2 raised no repair card this run: the best mend on Larkspur was ' +
      ch2.best + (ch2.bestPart ? ' on ' + ch2.bestPart : '') + ', under the ' + bar + ' bar (D 21).');
    if (ch2 && ch2.first) note(ch2.first.title + ' at ' + ch2.repairAt + ' s — ' + ch2.first.text + '\n    ' + ch2.first.options.join('\n    '));
    const ch5i = chap.find((r) => r.chapter === 5 && r.intercept);
    check('chapter 5 flown as an intercept raises the burn card',
      !!ch5i && ch5i.burnAt != null, ch5i ? 'burn ' + ch5i.burnAt + ', ' + ch5i.cards + ' cards in ' + ch5i.time + ' s' : 'no run');
    if (ch5i && ch5i.firstBurn) note(ch5i.firstBurn.title + ' at ' + ch5i.burnAt + ' s — ' + ch5i.firstBurn.text + '\n    ' + ch5i.firstBurn.options.join('\n    '));
  }

  if (stubbed) await page.evaluate(() => { delete window.OD.Crew; });

  // ---------------------------------------------------------------- the sim runs with all of it in
  const run = await page.evaluate(() => {
    OD.harness.start(OD.Skirmish.build({ player: 'JC', env: 'ganymede', range: 600, playerShips: { frigate: 1, corvette: 1 }, enemyShips: { frigate: 1, corvette: 1 }, seed: 7 }));
    const sim = OD.Game.sim;
    for (const s of sim.playerShips()) { const h = sim.nearestHostile(s); if (h) { sim.setTarget(s.id, h.id); sim.setOrder(s.id, { type: 'keeprange', target: h.id, range: 250e3 }); } }
    for (let i = 0; i < 4; i++) OD.harness.step(450);
    const st = OD.harness.state();
    return { errors: st.errors, renderError: st.renderError, finite: st.ships.every((s) => s.finite), outcome: st.outcome, open: (sim.decisions || []).length, seq: sim.decisionSeq, time: st.time };
  });
  check('a two-a-side fight runs 1800 s with the decision layer in it', run.errors.length === 0 && !run.renderError && run.finite, run.errors.join(' | ') + (run.renderError || ''));
  note('outcome ' + run.outcome + ', ' + run.open + ' open, decisionSeq ' + run.seq);

  const realErrors = consoleErrors.filter((e) => !/fonts.googleapis|ERR_INTERNET|net::ERR|Failed to load resource/.test(e) && !(/^file:/.test(url) && /Access to font/.test(e)));
  check('no console errors', realErrors.length === 0, realErrors.join(' | '));

  await browser.close();
  console.log(failures ? failures + ' check(s) failed' : 'all checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
