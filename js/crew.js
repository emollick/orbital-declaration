/* Orbital Declaration — crew: the people aboard, what they are doing, and what acceleration does to them.

   A hull is not only parts. Every ship carries a complement split into parties, and a party is only ever
   in one place: fire control, the sensor watch, a hurt part, the sick bay, or standing by. Sending one
   somewhere costs whatever it was doing, so a corvette with two parties pays for every repair with its
   guns or its eyes. Acceleration is the second limit. Above 1.2 g the parties strap in and repairs stop,
   and the crew still fights the ship. Above 3 g the couches are all that holds them, the crew starts
   taking injuries, and fire control and the sensor watch fall to 85 %. Above 6 g some of the hurt are
   killed.

   Two rules keep the work honest. A part that is running cannot be worked: the drive has to be cold and
   a radiator panel stowed. And casualties are carried a fraction at a time, so a fight of small hits
   costs the same people a few big ones would.

   Everything here advances on sim dt. Nothing reads the wall clock, and every entry point is safe on a
   ship that never had OD.Crew.init called on it, on a destroyed hull, and with OD.Damage absent. */
(function () {
  'use strict';
  const OD = window.OD;
  const U = OD.U;
  const G0 = 9.80665; // one g, the same number U.fmt.accel prints with

  // ------------------------------------------------------------------ tuning
  const T = {
    workG: 1.2,          // g: above this the parties strap in and repairs pause
    couchG: 3,           // g: above this the crew takes injuries
    hurtG2: 5,           // g: above this injuries come twice as fast
    deathG: 6,           // g: above this a share of the hurt are killed
    deathShare: 0.3,     // of the casualties above the death limit who are lost
    hurtRate: 0.0014,    // wounded per second, per g over the couch limit, per fit crew (about 1 in 12 of the crew a minute, per g over)
    medic: 45,           // s per wounded back to fit, for each party in the sick bay
    autoEvery: 15,       // s between passes of the ship's routine
    autoAssign: 60,      // s before the routine settles an unanswered card (decisions.js reads this)
    standDown: 60,       // s a party waits on a part the ship is using before she goes back to her station
    driveHold: 5,        // s the drive still counts as in use after the thrust stops: the autopilot pulses the throttle
    casualtyShare: 0.06, // of the fit crew hurt by a hit that takes a whole part they are standing at
    lostShare: 0.25,     // of those casualties who are lost
    partyShare: 1.5,     // × the casualties when a party is working on the part that was hit
    breachHurt: 0.5,     // + the casualties when the hit opened the facet to vacuum
    boardShare: 0.2,     // of the fit crew hurt in a boarding at full severity: a tenth of the smaller crew each way
    realHit: 0.1,        // hp: a hit that takes less than this and changes no state word is a chip, not an answer
    xp: 0.15,            // repair speed gained per point of experience
    xpFire: 0.03,        // fire control and the sensor watch gained per point of experience
    maxXp: 3,
    noParty: 0.7,        // fire control or the sensor watch with nobody on it
    strapFactor: 0.85,   // both, above the couch limit
    thinFactor: 0.7,     // both, with the fit crew down to a third of the complement
    thinShare: 1 / 3,
    floorFactor: 0.05,   // both, with nobody fit at all: a hull that cannot fight, and never a zero
    tankFloor: 0.6,      // a tank dented above this is not the routine's work while the hull is in contact
    watchGain: 0.2,      // the mend a watch is worth leaving station for: the board's own Send bar
    vitalGain: 0.05,     // the same, for the drive and the reactor, which the board also takes at 5 points
    repairFallback: 300, // s, when OD.Damage.repairTime is not there to ask
    logGap: 60,          // s between crew lines of the same kind
    casualtyGap: 30,     // s between casualty lines
    otherGap: 180,       // s between the one line a hull the player is not flying gets for her parties
    burstGap: 600,       // s before a burn still over the couch limit reports what it has cost so far
  };

  // Complement and parties by class. A custom design takes its base class.
  const CREW = {
    corvette:  { total: 24,  parties: 2 },
    lancer:    { total: 26,  parties: 2 },
    frigate:   { total: 60,  parties: 3 },
    destroyer: { total: 140, parties: 4 },
    cruiser:   { total: 260, parties: 6 },
    freighter: { total: 12,  parties: 1 },
    station:   { total: 200, parties: 6 },
  };
  const TASKS = ['fire', 'sensors', 'repair', 'medical', 'standby'];

  // Jury-rig caps, used only when js/damage.js has no mend/repairable to ask. The table there is the
  // one that mends; this copy keeps the board honest about what a party buys if damage.js is older.
  const CAP = {
    drive:    { wrecked: 0.3,  damaged: 0.7 },
    reactor:  { wrecked: 0.25, damaged: 0.6 },
    sensors:  { wrecked: 0.5,  damaged: 0.8 },
    radiator: { wrecked: 0,    damaged: 0.7 },
    mount:    { wrecked: 0,    damaged: 0.8 },
  };
  const ID_KIND = { drive: 'drive', reactor: 'reactor', sensors: 'sensors', rad: 'radiator', tank: 'tank', beam: 'mount', coil: 'mount', bay: 'mount', pd: 'mount' };

  // How many people stand at a part. The drive room and the reactor are manned watches; a mount and
  // the sensor gear take a few hands; a radiator panel and a tank are plumbing hung outboard, where
  // in a fight nobody is. A hit through an open facet costs more, because the compartment is vacuum.
  const MAN = { drive: 1, reactor: 1, sensors: 0.4, mount: 0.4, radiator: 0.1, tank: 0.1 };
  // What a hull's parties are on, for the one line a ship the player is not flying gets.
  const PLURAL = { drive: 'her drive', reactor: 'her reactor', sensors: 'her sensor suite', radiator: 'her radiator panels', mount: 'her mounts', tank: 'her tanks' };

  // ------------------------------------------------------------------ small helpers
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  function classOf(ship) {
    const all = (OD.Ships && OD.Ships.CLASSES) || {};
    return all[ship && ship.cls] || null;
  }
  function table(ship) {
    const id = ship && ship.cls;
    if (CREW[id]) return CREW[id];
    const cls = classOf(ship);
    if (cls && cls.base && CREW[cls.base]) return CREW[cls.base];
    return CREW.corvette;
  }
  function doctrineRange(ship) {
    const cls = classOf(ship);
    const base = cls && cls.base && OD.Ships.CLASSES ? OD.Ships.CLASSES[cls.base] : null;
    const d = (cls && cls.doctrine) || (base && base.doctrine) || null;
    return d && d.range != null ? d.range : 300e3;
  }
  function kindOf(c) {
    if (!c) return 'mount';
    if (c.kind) return c.kind;
    const m = /^[a-z]+/.exec(c.id || '');
    return (m && ID_KIND[m[0]]) || 'mount';
  }
  function partOf(ship, id) {
    if (!ship || !Array.isArray(ship.components) || !id) return null;
    return ship.components.find((c) => c.id === id) || null;
  }
  function venting(ship, c) {
    if (kindOf(c) !== 'tank' || c.isolated) return false;
    if (!(c.hp < 0.5)) return false;
    if (!(c.share > 0)) return false;
    if ((c.vented || 0) >= c.share - 1e-6) return false;
    return !(ship && ship.propMass != null && ship.propMass <= 0);
  }
  function stateOf(ship, c) {
    if (!c) return 'ok';
    if (OD.Damage && typeof OD.Damage.stateOf === 'function') return OD.Damage.stateOf(ship, c);
    if (venting(ship, c)) return 'venting';
    if (c.hp <= 0) return 'wrecked';
    return c.hp <= 0.5 ? 'damaged' : 'ok';
  }
  // What a party can get back out of a part. damage.js owns the table; CAP is the stand-in.
  function capOf(ship, c) {
    if (typeof c === 'string') c = partOf(ship, c);
    if (!c) return 0;
    if (OD.Damage && typeof OD.Damage.cap === 'function') return OD.Damage.cap(ship, c);
    const k = kindOf(c);
    if (k === 'tank') return c.isolated ? c.hp : c.hp < 0.5 ? Math.max(c.hp, 0.5) : c.hp >= 0.5 ? 1 : c.hp;
    const row = CAP[k] || CAP.mount;
    return Math.max(c.hp, c.hp <= 0 ? row.wrecked : row.damaged);
  }
  // How long a party needs on this part. damage.js owns the number; 300 s is the stand-in.
  function repairTime(ship, partId) {
    if (OD.Damage && typeof OD.Damage.repairTime === 'function') {
      const t = OD.Damage.repairTime(ship, partId);
      if (isFinite(t) && t > 0) return t;
    }
    return T.repairFallback;
  }
  function repairable(ship, partId) {
    if (OD.Damage && typeof OD.Damage.repairable === 'function') return !!OD.Damage.repairable(ship, partId);
    const c = partOf(ship, partId);
    if (!c) return false;
    return capOf(ship, c) > c.hp + 0.01;
  }
  function breachedAt(ship, partId) {
    if (!(OD.Damage && typeof OD.Damage.breached === 'function')) return false;
    try { return !!OD.Damage.breached(ship, partId); } catch (e) { return false; }
  }
  // Is a hit worth the ship reacting to? One that changes the part's state word, or takes a real
  // bite out of it, is; a chip a beam took off the plating is not. The holds and the outright
  // losses both ask. severity is the hp this hit took, so the part stood at hp + severity before it.
  function realHit(ship, c, severity) {
    if (!(severity > 0)) return false;
    if (severity >= T.realHit) return true;
    if (!c) return false;
    const now = stateOf(ship, c);
    try { return stateOf(ship, Object.assign({}, c, { hp: clamp((c.hp || 0) + severity, 0, 1) })) !== now; }
    catch (e) { return false; }
  }
  function rate(ship, cr, partId) {
    return (1 / repairTime(ship, partId)) * (1 + T.xp * (cr.xp || 0));
  }
  // Is the ship making thrust this tick? The reading gStep records, and the one the stable flag
  // below starts from.
  function thrusting(ship) {
    const a = typeof ship.accel === 'function' ? ship.accel() : 0;
    return (ship.throttle || 0) > 0 && isFinite(a) && a > 0;
  }
  // Is the order still asking for a burn? The autopilot drops the throttle to 0 for the seconds it
  // takes to swing the nose onto the burn heading, and keeps the acceleration it plans to make in
  // plannedAccel meanwhile. A hull the player is flying by hand is asked by her own throttle.
  function wantsThrust(ship) {
    if ((ship.cmdThrottle || 0) > 0) return true;
    const o = ship.order;
    if (o && o.type === 'manual') return (o.throttle || 0) > 0;
    const w = ship.plannedAccel;
    return !!(w && ((w.x || 0) !== 0 || (w.y || 0) !== 0));
  }
  // A part that is running cannot be worked, whoever is flying the hull. The drive has to be cold,
  // and a panel repair means the radiators in — all of them, so the ship sheds nothing meanwhile.
  // The words are the ones the board prints on the row and the toast prints after Held: one clause,
  // so a caller can set it in a sentence of its own.
  //
  // The drive counts as in use while the ship is making thrust, while the order is still asking for
  // thrust, and for T.driveHold after the last of either. One tick's throttle is not the test: the
  // autopilot pulses it, and a block that flickers second by second flickers through the board, the
  // card and the stand-down clock. The throttle at 0 for 5 s with no order on it is a real cut.
  function inUse(ship, c) {
    if (!ship || !c) return null;
    const k = kindOf(c);
    if (k === 'drive') {
      if (thrusting(ship) || wantsThrust(ship)) return 'the drive has to be cold, throttle to 0';
      const cr = ship.crew;
      const now = cr && cr._now != null ? cr._now : null;
      if (cr && now != null && cr._thrustAt != null && now - cr._thrustAt < T.driveHold) return 'the drive has to be cold, throttle to 0';
      return null;
    }
    if (k === 'radiator') {
      const r = ship.radiators;
      if (r && (r.deployed || (r.state || 0) > 0)) return 'the radiators have to be in';
      return null;
    }
    return null;
  }
  // Why the part cannot be worked, in the few words the stand-down line takes. inUse() says what the
  // player has to do about it; this says what the ship is doing with the part.
  function usePhrase(ship, c) {
    const k = kindOf(c);
    if (k === 'drive') return 'she is burning';
    if (k === 'radiator') return 'the radiators are out';
    return 'it is running';
  }
  // The station a party goes back to, named.
  function backWords(task) {
    if (task === 'fire') return 'Back on fire control.';
    if (task === 'sensors') return 'Back on the sensor watch.';
    if (task === 'medical') return 'Back in the sick bay.';
    return 'Standing by.';
  }
  // The name a sentence uses for a part, spelled the way damage.js spells it: 'the drive',
  // 'radiator panel 2', 'the coilgun'. 'PD laser 1' keeps its capitals.
  function lowerFirst(name) {
    const s = String(name || '');
    if (/^[A-Z][A-Z]/.test(s)) return s;
    return s.charAt(0).toLowerCase() + s.slice(1);
  }
  function partPhrase(c) {
    if (!c) return 'the part';
    // damage.js owns the spelling of a part; the table below is the stand-in when it is not aboard.
    if (OD.Damage && typeof OD.Damage.plainName === 'function' && typeof c.name === 'string' && c.name) {
      try { const s = OD.Damage.plainName(c); if (s) return s; } catch (e) { /* the table below */ }
    }
    switch (kindOf(c)) {
      case 'drive': return 'the drive';
      case 'reactor': return 'the reactor';
      case 'sensors': return 'the sensor suite';
      case 'radiator': case 'tank': return lowerFirst(c.name || c.id);
      default: return 'the ' + lowerFirst(c.name || c.id);
    }
  }
  // 'JCS Bastion' is Bastion once the fight has started and the player knows her.
  function shortName(ship) {
    const s = String((ship && ship.name) || 'The ship');
    const m = /^[A-Z]{2,4}\s+(\S.*)$/.exec(s);
    return m ? m[1] : s;
  }
  function gWord(g) { return (Math.round((g || 0) * 10) / 10).toFixed(1) + ' g'; }
  // damage.js owns the one repair time every screen prints, so a party line and the board row can
  // never show the same work as '84 s' and '1 min'. The 90 s cut below is only the fallback.
  function timeWords(s) {
    if (!isFinite(s) || s < 0) return '—';
    if (OD.Damage && typeof OD.Damage.timeWords === 'function') {
      try { const w = OD.Damage.timeWords(s); if (w) return w; } catch (e) { /* the cut below */ }
    }
    return s < 90 ? Math.round(s) + ' s' : Math.round(s / 60) + ' min';
  }
  function pct(v) { return U.fmt.pct(clamp(v, 0, 1)); }
  function mine(sim, ship) {
    if (!sim || !ship) return false;
    return !sim.playerFaction || ship.faction === sim.playerFaction;
  }
  // The hull the player has on screen. Her parties get their own log lines; every other hull of ours
  // gets one line every few minutes instead, so the routine cannot bury the fight.
  function focused(sim, ship) {
    const id = (sim && sim.selectedId) || (OD.UI && OD.UI.selected) || null;
    if (!id) return true; // nobody is looking at a board: every hull speaks as it always did
    return !!ship && ship.id === id;
  }
  function say(sim, ship, text, kind) {
    if (!sim || typeof sim.addLog !== 'function' || !mine(sim, ship)) return;
    sim.addLog((ship && ship.name ? ship.name + ' — ' : '') + text, 'Crew', kind || 'info');
  }
  // The aggregate line names the ship itself, so it does not take the ship prefix as well.
  function sayFlat(sim, ship, text, kind) {
    if (!sim || typeof sim.addLog !== 'function' || !mine(sim, ship)) return;
    sim.addLog(text, 'Crew', kind || 'info');
  }
  // A party move on a hull the player is not flying: piled up, said once, in one sentence.
  function note(sim, ship, cr, c) {
    const pile = cr._other || (cr._other = { kinds: [] });
    const k = kindOf(c);
    if (pile.kinds.indexOf(k) < 0) pile.kinds.push(k);
  }
  function otherWords(ship, pile) {
    const name = shortName(ship);
    if (pile.kinds.length === 1 && pile.kinds[0] === 'tank') return name + "'s parties are patching her tanks.";
    const what = pile.kinds.length === 1 ? (PLURAL[pile.kinds[0]] || 'the damage') : 'the damage';
    return name + "'s parties are working on " + what + '.';
  }

  // ------------------------------------------------------------------ build
  function defaultTask(ship, i) {
    if (i === 0) return (ship && Array.isArray(ship.mounts) && ship.mounts.length) ? 'fire' : 'sensors';
    if (i === 1) return 'sensors';
    return 'standby';
  }
  function init(ship, spec) {
    if (!ship) return null;
    const row = table(ship);
    const cr = {
      total: row.total, fit: row.total, wounded: 0, lost: 0, xp: 0,
      parties: [], gMode: 'couches', auto: true, gNow: 0, strapped: false, overCouch: false,
    };
    for (let i = 0; i < row.parties; i++) {
      cr.parties.push({ id: 'p' + (i + 1), task: defaultTask(ship, i), part: null, progress: 0, eta: 0, since: 0 });
    }
    ship.crew = cr;
    if (spec && spec.crew) fromRecord(ship, spec.crew);
    return cr;
  }

  // ------------------------------------------------------------------ the parties
  function partyOf(cr, id) { return (cr.parties || []).find((p) => p.id === id) || null; }
  function station(ship, cr, p) {
    const i = cr.parties.indexOf(p);
    return defaultTask(ship, i < 0 ? 2 : i);
  }
  function stand(ship, cr, p) {
    p.task = station(ship, cr, p);
    p.part = null; p.progress = 0; p.eta = 0; p.since = cr._now || 0; p.waiting = 0; p.from = null;
    return p;
  }
  function start(ship, cr, p, partId) {
    if (p.part !== partId) p.progress = 0;
    // The station she leaves is kept on the record: the send prices it, and the stand-down below
    // puts her back on it.
    if (p.task !== 'repair') p.from = p.task;
    p.task = 'repair'; p.part = partId; p.since = cr._now || 0; p.waiting = 0;
    p.eta = (1 - p.progress) / rate(ship, cr, partId);
    return p;
  }
  function busy(cr, partId, except) {
    return (cr.parties || []).some((p) => p !== except && p.task === 'repair' && p.part === partId);
  }
  function words(ship, cr, p) {
    const unmanned = cr.fit <= 0;
    switch (p.task) {
      case 'fire': return 'Party ' + n(p) + ' on fire control' + (unmanned ? ', nobody fit to stand it.' : '.');
      case 'sensors': return 'Party ' + n(p) + ' on the sensor watch' + (unmanned ? ', nobody fit to stand it.' : '.');
      case 'medical':
        if (unmanned) return 'Party ' + n(p) + ' in the sick bay · nobody fit to work it.';
        return 'Party ' + n(p) + ' in the sick bay · ' + (cr.wounded > 0 ? cr.wounded + ' wounded aboard.' : 'no wounded left.');
      case 'repair': {
        const c = partOf(ship, p.part);
        if (!c) return 'Party ' + n(p) + ' standing by.';
        if (cr.strapped) return 'Party ' + n(p) + ' on ' + partPhrase(c) + ', paused at ' + gWord(cr.gNow) + '.';
        if (unmanned) return 'Party ' + n(p) + ' on ' + partPhrase(c) + ', held. Nobody is fit to work.';
        const why = inUse(ship, c);
        if (why) return 'Party ' + n(p) + ' on ' + partPhrase(c) + ', held. ' + why.charAt(0).toUpperCase() + why.slice(1) + '.';
        return 'Party ' + n(p) + ' on ' + partPhrase(c) + ', ' + timeWords(p.eta) + ' to ' + pct(capOf(ship, c)) + '.';
      }
      default: return 'Party ' + n(p) + ' standing by.';
    }
  }
  function n(p) { return String(p.id).replace(/^p/, ''); }

  // ------------------------------------------------------------------ the fight
  function update(sim, dt) {
    if (!sim || !(dt > 0) || !Array.isArray(sim.ships)) return;
    for (const ship of sim.ships) {
      const cr = ship && ship.crew;
      if (!cr) continue;
      if (ship.destroyed) { lostWithShip(sim, ship, cr); continue; }
      cr._now = sim.time;
      gStep(ship, cr);
      hurtStep(sim, ship, cr, dt);
      repairStep(sim, ship, cr, dt);
      medicalStep(ship, cr, dt);
      flush(sim, ship, cr);
      if (cr.auto || ship.ai) {
        if (sim.time - (cr._autoAt == null ? -1e9 : cr._autoAt) >= T.autoEvery) auto(sim, ship);
      }
    }
  }

  // What the crew is feeling right now. ship.accel() is already capped by accelCap where sim.js wires it,
  // so this is the acceleration the hull is actually pulling, not the one the drive could make.
  function gStep(ship, cr) {
    const a = typeof ship.accel === 'function' ? ship.accel() : 0;
    const g = ((ship.throttle || 0) * (isFinite(a) ? a : 0)) / G0;
    if (thrusting(ship) || wantsThrust(ship)) cr._thrustAt = cr._now || 0;
    cr.gNow = g;
    cr.strapped = g > T.workG;   // above the working limit: repairs pause
    cr.overCouch = g > T.couchG; // above the couch limit: injuries, and both watches at 85 %
  }

  function hurtStep(sim, ship, cr, dt) {
    if (cr.gNow > T.couchG && cr.fit > 0) {
      const over = cr.gNow - T.couchG;
      const r = T.hurtRate * over * cr.fit * (cr.gNow > T.hurtG2 ? 2 : 1);
      cr._hurtAcc = (cr._hurtAcc || 0) + r * dt;
      const b = cr._burst || (cr._burst = { wounded: 0, lost: 0, peak: 0, since: sim.time });
      b.peak = Math.max(b.peak, cr.gNow);
      const whole = Math.floor(cr._hurtAcc);
      if (whole > 0) {
        cr._hurtAcc -= whole;
        const hurt = Math.min(whole, cr.fit);
        // Past the death limit the couches are not enough and a share of the hurt do not get up.
        let lost = 0;
        if (cr.gNow > T.deathG) {
          cr._gLostAcc = (cr._gLostAcc || 0) + hurt * T.deathShare;
          lost = Math.min(Math.floor(cr._gLostAcc), hurt);
          if (lost > 0) cr._gLostAcc -= lost;
        }
        cr.fit -= hurt; cr.wounded += hurt - lost; cr.lost += lost;
        b.wounded += hurt - lost; b.lost += lost;
      }
    } else {
      cr._hurtAcc = 0;
      burstLine(sim, ship, cr); // the burn is back inside the couch limit: say what it cost
    }
  }
  // A hull that is gone takes her people with her. The record is settled once, on the first update
  // after the loss, so the debrief and the campaign strike her off with the whole complement and
  // not with the numbers she was carrying the second before. Her parties, her watches and her board
  // stay silent, as they are for any destroyed hull.
  function settleLoss(cr) {
    if (cr._settled) return 0;
    cr._settled = true;
    const aboard = Math.max(0, Math.round((cr.fit || 0) + (cr.wounded || 0)));
    cr.lost = Math.round(cr.lost || 0) + aboard;
    cr.fit = 0; cr.wounded = 0;
    cr._hurtAcc = 0; cr._casAcc = 0; cr._lostAcc = 0; cr._gLostAcc = 0; cr._burst = null; cr._cas = null;
    return aboard;
  }
  function lostWithShip(sim, ship, cr) {
    const aboard = settleLoss(cr);
    if (aboard <= 0) return null;
    const line = aboard >= cr.total ? aboard + ' lost with the ship.' : 'The ' + aboard + ' still aboard are lost with the ship.';
    say(sim, ship, line, 'alert');
    return line;
  }
  function burstLine(sim, ship, cr) {
    const b = cr._burst;
    if (!b) return;
    cr._burst = null;
    if (b.wounded <= 0 && b.lost <= 0) return;
    const bits = [];
    if (b.wounded > 0) bits.push(b.wounded + ' wounded');
    if (b.lost > 0) bits.push(b.lost + ' lost');
    say(sim, ship, bits.join(' and ') + ' at ' + gWord(b.peak) + '.', b.lost > 0 ? 'alert' : 'warn');
  }

  function repairStep(sim, ship, cr, dt) {
    for (const p of cr.parties) {
      if (p.task !== 'repair' || !p.part) continue;
      const c = partOf(ship, p.part);
      if (!c) { stand(ship, cr, p); continue; }
      const r = rate(ship, cr, p.part);
      // The part is still running: the work holds where it is, and the wait is counted.
      if (inUse(ship, c)) {
        p.waiting = (p.waiting || 0) + dt;
        p.eta = (1 - p.progress) / r;
        if (p.waiting >= T.standDown) standDown(sim, ship, cr, p, c);
        continue;
      }
      p.waiting = 0;
      // Strapped in or nobody fit: the work holds where it is too, and she stays on the part.
      if (cr.strapped || cr.fit <= 0) { p.eta = (1 - p.progress) / r; continue; }
      p.progress = clamp(p.progress + r * dt, 0, 1);
      p.eta = Math.max(0, (1 - p.progress) / r);
      if (p.progress >= 1) done(sim, ship, cr, p, c);
    }
  }
  // A party cannot work a part the ship is using, and a minute of standing there costs the watch she
  // left for nothing. So she goes back to it, and the part is held for T.autoAssign so the routine
  // does not send her straight out again while the order that lit the drive still stands. The player's
  // own send stands down the same way: the order on the part is the thing in the way, not who sent her.
  function standDown(sim, ship, cr, p, c) {
    const partId = p.part;
    const from = p.from;
    const back = from && from !== 'repair' && TASKS.indexOf(from) >= 0 ? from : station(ship, cr, p);
    const line = 'Party ' + n(p) + ' stands down from ' + partPhrase(c) + ': ' + usePhrase(ship, c) + '. ' + backWords(back);
    stand(ship, cr, p);
    p.task = back;
    hold(ship, partId, T.autoAssign);
    if (focused(sim, ship)) say(sim, ship, line, 'info');
    return line;
  }
  // The mend itself belongs to damage.js. It is called without a sim so it logs nothing: the one
  // line for the work is the crew's, and it names the party that did it.
  function done(sim, ship, cr, p, c) {
    const before = c.hp;
    const wasVenting = venting(ship, c);
    if (OD.Damage && typeof OD.Damage.mend === 'function') OD.Damage.mend(ship, p.part);
    else {
      c.hp = Math.max(c.hp, 0.5);
      if (OD.Damage && typeof OD.Damage.aggregate === 'function') OD.Damage.aggregate(ship);
    }
    const hp = c.hp;
    const who = 'Party ' + n(p) + ' ';
    if (!focused(sim, ship)) note(sim, ship, cr, c);
    else if (!(hp > before + 1e-6)) say(sim, ship, who + 'can do no more for ' + partPhrase(c) + '.', 'info');
    else if (kindOf(c) === 'tank') {
      say(sim, ship, wasVenting ? who + 'has ' + partPhrase(c) + ' isolated. The venting has stopped.'
        : who + 'has ' + partPhrase(c) + ' patched. The plating is sound again.', 'good');
    } else say(sim, ship, who + 'has ' + partPhrase(c) + ' back to ' + pct(hp) + '.', 'good');
    stand(ship, cr, p);
  }

  // A party in the sick bay works when there is somebody to work and somebody to treat. Nobody
  // treats anybody through a burn: above the working limit they are in the couches like everyone.
  function medicalStep(ship, cr, dt) {
    const medics = cr.parties.filter((p) => p.task === 'medical').length;
    if (!medics || cr.wounded <= 0 || cr.strapped || cr.fit <= 0) { cr._medAcc = 0; return; }
    cr._medAcc = (cr._medAcc || 0) + (dt * medics) / T.medic;
    const whole = Math.min(Math.floor(cr._medAcc), cr.wounded);
    if (whole > 0) {
      cr._medAcc -= whole;
      cr.wounded -= whole; cr.fit += whole;
      cr._back = (cr._back || 0) + whole;
    }
  }

  // Casualties and recoveries pile up hit by hit; the log gets one line for them at a time.
  function flush(sim, ship, cr) {
    const t = sim.time;
    if (cr._burst && t - cr._burst.since >= T.burstGap) {
      const peak = cr._burst.peak;
      burstLine(sim, ship, cr);
      cr._burst = { wounded: 0, lost: 0, peak, since: t };
    }
    if (cr._cas && t - (cr._casAt == null ? -1e9 : cr._casAt) >= T.casualtyGap) {
      const pile = cr._cas; cr._cas = null; cr._casAt = t;
      const bits = [];
      if (pile.wounded > 0) bits.push(pile.wounded + ' wounded');
      if (pile.lost > 0) bits.push(pile.lost + ' lost');
      if (bits.length) say(sim, ship, bits.join(' and ') + ' ' + whereWords(pile) + '.', pile.lost > 0 ? 'alert' : 'warn');
    }
    if (cr._other && t - (cr._otherAt == null ? -1e9 : cr._otherAt) >= T.otherGap) {
      const pile = cr._other; cr._other = null; cr._otherAt = t;
      sayFlat(sim, ship, otherWords(ship, pile), 'info');
    }
    if (cr._back && t - (cr._backAt == null ? -1e9 : cr._backAt) >= T.logGap) {
      const back = cr._back; cr._back = 0; cr._backAt = t;
      say(sim, ship, back + ' back on duty' + (cr.wounded > 0 ? ', ' + cr.wounded + ' still wounded.' : '. No wounded left.'), 'good');
    }
  }

  // ------------------------------------------------------------------ the routine
  const RANK = { drive: 0, reactor: 1, vent: 2, radiator: 3, mount: 4, sensors: 5, tank: 6 };
  function rankOf(ship, c) {
    const k = kindOf(c);
    if (k === 'tank') return venting(ship, c) ? RANK.vent : RANK.tank;
    return RANK[k] != null ? RANK[k] : 7;
  }
  // Is there anything shooting at us? A hull out of contact has time for the plating.
  function inContact(sim, ship) {
    if (!sim || typeof sim.nearestHostile !== 'function') return true;
    let h = null;
    try { h = sim.nearestHostile(ship); } catch (e) { return true; }
    if (!h) return false;
    return U.dist(h.pos, ship.pos) < doctrineRange(ship) * 1.5;
  }
  // The routine's work. A dent in a sound tank is not work: it vents nothing, it costs the ship
  // nothing, and the next hit dents it again. It is worth a party only when the hull is out of
  // contact, or when the plating is thin enough that the next hit opens it. A part the ship is
  // using is nobody's work either: the trade there is the order against the mend, which is the
  // card's to put ("The drive is hit, and she is burning": cut the drive or keep the burn). The
  // routine looks at the part again as soon as the ship has let go of it.
  function routineJob(sim, ship, cr, c) {
    if (c.hp >= 1 && !venting(ship, c)) return false;
    if (busy(cr, c.id)) return false;
    if (!repairable(ship, c.id)) return false;
    if (holding(cr, c.id)) return false;
    if (inUse(ship, c)) return false;
    if (kindOf(c) === 'tank' && !venting(ship, c) && c.hp >= T.tankFloor && inContact(sim, ship)) return false;
    return true;
  }
  // What a watch is worth leaving station for, on top of the parts that can take one at all. It is
  // the bar the board puts a Send button on, point for point (ui.js worthIt): a wrecked part, a
  // tank that is venting, the drive or the reactor with T.vitalGain or more in the mend, anything
  // else with T.watchGain or more. Whole points, the way the row prints them. A watch only ever
  // leaves station for the parts urgent() names, so in the routine it is the drive, the reactor and
  // a venting tank that reach this test; the 20-point rung is here to keep the two bars one bar.
  function worthWatch(ship, c) {
    if (!c) return false;
    if (venting(ship, c)) return true;
    if (c.hp <= 0) return true;
    const k = kindOf(c);
    const need = k === 'drive' || k === 'reactor' ? T.vitalGain : T.watchGain;
    return Math.round((capOf(ship, c) - clamp(c.hp, 0, 1)) * 100) >= Math.round(need * 100);
  }
  // needWatch: there is nobody standing by, so only a part a watch may be pulled for counts.
  function bestHurt(sim, ship, cr, needWatch) {
    if (!Array.isArray(ship.components)) return null;
    let best = null, br = 99, bh = 9;
    for (const c of ship.components) {
      if (!routineJob(sim, ship, cr, c)) continue;
      if (needWatch && !(urgent(ship, c) && worthWatch(ship, c))) continue;
      const r = rankOf(ship, c);
      if (r < br || (r === br && c.hp < bh)) { best = c; br = r; bh = c.hp; }
    }
    return best;
  }
  // The parts a watch can be taken off station for at all: the drive, the reactor, a venting tank.
  function urgent(ship, c) { return rankOf(ship, c) <= RANK.vent; }

  // Which watch is the cheaper hand to lose. With a solution already held on the hull we are
  // fighting the sensor watch costs least; without one the beams have nothing to point at, so fire
  // control is the cheaper one. decisions.js recommends off this same call, so the card and the
  // routine cannot disagree.
  function solutionHeld(ship, sim) {
    const S = OD.Sensors;
    if (!ship || !sim || !S || typeof S.quality !== 'function') return true;
    let foe = null;
    try {
      foe = ship.target && typeof sim.byId === 'function' ? sim.byId(ship.target) : null;
      if (foe && (foe.destroyed || foe.captured)) foe = null;
      if (!foe && typeof sim.nearestHostile === 'function') foe = sim.nearestHostile(ship);
    } catch (e) { foe = null; }
    if (!foe) return true;
    let q = 3;
    try { q = S.quality(sim, ship, foe); } catch (e) { return true; }
    const need = (S.T && S.T.solutionQ > 0) ? S.T.solutionQ : 2.7;
    return !(isFinite(q) && q < need);
  }
  function watchToPull(ship, sim) { return solutionHeld(ship, sim) ? 'sensors' : 'fire'; }

  // A refusal holds. The card's "keep the parties where they are" — or any hold decisions.js sets
  // while a card is open — keeps the routine off that part until the time runs out or the part is
  // hit again. hold(ship, null, seconds) holds the whole routine; seconds 0 lifts a hold.
  function hold(ship, partId, seconds) {
    const cr = ship && ship.crew;
    if (!cr) return null;
    const s = isFinite(seconds) ? Math.max(0, seconds) : T.autoAssign;
    const until = (cr._now || 0) + s;
    if (partId == null) { cr._holdAll = until; return until; }
    cr._holds = cr._holds || {};
    cr._holds[partId] = until;
    return until;
  }
  function holding(cr, partId) {
    const now = cr._now || 0;
    if ((cr._holdAll || 0) > now) return true;
    return !!(cr._holds && cr._holds[partId] > now);
  }

  function auto(sim, ship) {
    const cr = ship && ship.crew;
    if (!cr || ship.destroyed) return null;
    if (!(cr.auto || ship.ai)) return null;
    cr._autoAt = sim ? sim.time : cr._autoAt;
    if (sim) cr._now = sim.time;
    // A party on a part that is gone, mended or past helping goes back to its station.
    for (const p of cr.parties) {
      if (p.task !== 'repair' || !p.part) continue;
      if (!partOf(ship, p.part) || !repairable(ship, p.part)) stand(ship, cr, p);
    }
    if ((cr._holdAll || 0) > (cr._now || 0)) return null; // the routine is held off altogether
    let sent = null;
    // A party standing by goes for any mend that helps. With nobody standing by, the watch bar
    // decides both which part is looked at and whether a watch leaves station for it at all.
    const free = cr.parties.find((q) => q.task === 'standby') || null;
    const c = bestHurt(sim, ship, cr, !free);
    if (c) {
      let p = free;
      if (!p && urgent(ship, c) && worthWatch(ship, c)) {
        const want = watchToPull(ship, sim);
        const other = want === 'sensors' ? 'fire' : 'sensors';
        p = cr.parties.find((q) => q.task === want) || cr.parties.find((q) => q.task === other);
      }
      if (p) {
        start(ship, cr, p, c.id);
        if (focused(sim, ship)) say(sim, ship, 'Party ' + n(p) + ' is on ' + partPhrase(c) + ": the ship's routine.", 'info');
        else note(sim, ship, cr, c);
        sent = p;
      }
    }
    if (ship.ai && sim) gAuto(sim, ship, cr);
    return sent;
  }
  // A computer-flown hull holds 1.2 g while a party is working and the nearest hostile is far out, and
  // straps in for anything closer.
  function gAuto(sim, ship, cr) {
    const working = cr.parties.some((p) => p.task === 'repair' && p.part);
    let d = Infinity;
    if (typeof sim.nearestHostile === 'function') {
      const h = sim.nearestHostile(ship);
      if (h) d = U.dist(h.pos, ship.pos);
    }
    cr.gMode = working && d > doctrineRange(ship) * 1.5 ? 'work' : 'couches';
  }

  // ------------------------------------------------------------------ what the rest of the game reads
  function accelCap(ship) {
    const cr = ship && ship.crew;
    if (!cr) return Infinity;
    if (cr.gMode === 'work') return T.workG * G0;
    if (cr.gMode === 'couches') return T.couchG * G0;
    return Infinity;
  }
  // How much of the complement is still on its feet, as a multiplier. Full crew is 1, a third fit is
  // 0.7, and it falls from there toward nothing: a hull with nobody fit cannot fight her guns. It
  // never reaches zero, because a zero reads to the modules that ask as "no crew module aboard".
  function fitFactor(cr) {
    const total = cr.total > 0 ? cr.total : 1;
    const f = clamp(cr.fit / total, 0, 1);
    if (f >= 1) return 1;
    if (f >= T.thinShare) return T.thinFactor + (1 - T.thinFactor) * ((f - T.thinShare) / (1 - T.thinShare));
    return Math.max(T.floorFactor, T.thinFactor * (f / T.thinShare));
  }
  function factor(ship, task) {
    const cr = ship && ship.crew;
    if (!cr) return 1;
    let f = cr.parties.some((p) => p.task === task) ? 1 + T.xpFire * (cr.xp || 0) : T.noParty;
    // Strapped into the couches the crew still fights the ship. It is past 3 g that the work suffers.
    if (cr.overCouch) f *= T.strapFactor;
    f *= fitFactor(cr);
    return Math.max(T.floorFactor, f);
  }
  function fireFactor(ship) { return factor(ship, 'fire'); }
  function sensorFactor(ship) { return factor(ship, 'sensors'); }

  // damage.js calls this from hit(): severity is the share of the part this hit took. The figure is
  // a fraction of a person hit by hit, and the fraction is carried, not rounded away, so a fight of
  // small hits costs the same people a few big ones would. Where the shot landed decides how many:
  // a drive room is manned, a radiator panel hung outboard is not.
  //
  // where is an optional phrase for a hit that is not at a part. sim.js passes 'in the boarding'
  // with no part: a boarding is fought through the whole hull, so it is priced off the fit crew
  // (T.boardShare, weight 1) and not off the plumbing weight of a part nobody was standing at.
  function casualties(ship, partId, severity, where) {
    const out = { wounded: 0, lost: 0 };
    const cr = ship && ship.crew;
    if (!cr || ship.destroyed || !(severity > 0)) return out;
    const c = partOf(ship, partId);
    const boarding = partId == null && !!where;
    // A hit on the part is the ship's own answer to a refusal: the routine may look at it again.
    // A chip is not an answer, so a hold stands until a hit changes the state word or bites deep.
    if (cr._holds && partId && cr._holds[partId] != null && realHit(ship, c, severity)) delete cr._holds[partId];
    if (cr.fit <= 0) return out;
    const man = boarding ? 1 : (MAN[kindOf(c)] != null ? MAN[kindOf(c)] : MAN.mount);
    const share = boarding ? T.boardShare : T.casualtyShare;
    const onIt = !boarding && cr.parties.some((p) => p.task === 'repair' && p.part === partId);
    const breach = !boarding && breachedAt(ship, partId) ? 1 + T.breachHurt : 1;
    cr._casAcc = (cr._casAcc || 0) + clamp(severity, 0, 1) * share * cr.fit * man * breach * (onIt ? T.partyShare : 1);
    // A hit that wrecks a manned part kills somebody outright, whatever the running fraction says:
    // the drive room and the reactor are watches, and through a breached facet the lighter manned
    // parts go the same way. The rest of the casualties keep the lost share, so a bad fight leaves
    // the roster short without turning every wounded into a death.
    const kills = !boarding && c && c.hp <= 0 && realHit(ship, c, severity)
      && (man >= 1 || (breach > 1 && man >= MAN.sensors));
    let whole = Math.floor(cr._casAcc);
    if (kills && whole < 1) whole = 1;
    if (whole <= 0) return out;
    const hurt = Math.min(whole, cr.fit);
    cr._casAcc = Math.max(0, cr._casAcc - hurt);
    let lost = kills ? 1 : 0;
    const rest = hurt - lost;
    cr._lostAcc = (cr._lostAcc || 0) + rest * T.lostShare;
    const more = Math.min(Math.floor(cr._lostAcc), rest);
    if (more > 0) { cr._lostAcc -= more; lost += more; }
    const wounded = hurt - lost;
    cr.fit -= hurt; cr.wounded += wounded; cr.lost += lost;
    out.wounded = wounded; out.lost = lost;
    const place = boarding ? String(where) : c ? 'on ' + partPhrase(c) : 'aboard';
    const pile = cr._cas || (cr._cas = { wounded: 0, lost: 0, where: place, places: [] });
    pile.wounded += wounded; pile.lost += lost;
    if (pile.places.indexOf(place) < 0) { pile.places.push(place); pile.where = place; }
    return out;
  }
  // Where the casualties were taken, for the one line the log gets. One place names itself; several
  // parts are the parts that were hit; a boarding piled in with part hits is simply aboard.
  function whereWords(pile) {
    const places = (pile && pile.places) || [];
    if (places.length <= 1) return (pile && pile.where) || 'aboard';
    return places.every((s) => /^on /.test(s)) ? 'on the parts that were hit' : 'aboard';
  }

  // ------------------------------------------------------------------ the board
  function crewWords(cr) {
    const bits = [cr.fit > 0 ? cr.fit + ' fit' : 'none fit'];
    if (cr.wounded > 0) bits.push(cr.wounded + ' wounded');
    if (cr.lost > 0) bits.push(cr.lost + ' lost');
    return 'Crew ' + cr.total + ': ' + bits.join(', ') + '.';
  }
  // Who is left to work comes before what the burn is doing to them: a board that reads "the crew
  // can work" over "none fit" is lying about the thing the player is about to spend. But a burn
  // that is hurting people says so first, and the thin crew follows it, so neither fact is lost.
  function gWords(cr) {
    if (cr.fit <= 0) return 'Nobody is fit to work.';
    const thin = cr.total > 0 && cr.fit / cr.total < T.thinShare
      ? cr.fit + ' of ' + cr.total + ' fit: the watches run at ' + pct(fitFactor(cr)) + '.' : '';
    let g = '';
    if (cr.gNow > T.deathG) g = gWord(cr.gNow) + ': past what the couches hold. The crew is taking injuries, and some are killed.';
    else if (cr.gNow > T.couchG) g = gWord(cr.gNow) + ': over the couch limit. The crew is taking injuries.';
    else if (cr.strapped) g = gWord(cr.gNow) + ': the crew is strapped in and repairs are paused.';
    if (g) return thin ? g + ' ' + thin : g;
    // Nothing the burn has to say: the crew is the whole sentence.
    if (thin) return gWord(cr.gNow) + ', and ' + thin;
    return gWord(cr.gNow) + ': the crew can work.';
  }
  function board(ship) {
    const cr = ship && ship.crew;
    if (!cr) return null;
    const rows = OD.Damage && typeof OD.Damage.report === 'function' ? OD.Damage.report(ship) : null;
    const byId = {};
    if (Array.isArray(rows)) for (const r of rows) byId[r.id] = r;
    const parties = cr.parties.map((p) => ({
      id: p.id, task: p.task, part: p.part,
      partName: p.part ? partPhrase(partOf(ship, p.part)) : null,
      progress: p.progress, eta: p.eta, words: words(ship, cr, p),
    }));
    const partyOnPart = {};
    for (const p of cr.parties) if (p.task === 'repair' && p.part) partyOnPart[p.part] = p;
    const parts = (Array.isArray(ship.components) ? ship.components : []).map((c) => {
      const row = byId[c.id] || {};
      const p = partyOnPart[c.id] || null;
      const cap = row.cap != null ? row.cap : capOf(ship, c);
      const can = row.repairable != null ? !!row.repairable : repairable(ship, c.id);
      const eta = can ? (1 - (p ? p.progress : 0)) / rate(ship, cr, c.id) : null;
      return {
        id: c.id, name: c.name || c.id, state: row.state || stateOf(ship, c), hp: clamp(c.hp, 0, 1),
        cap, repairable: can, eta, party: p ? p.id : null, blocked: can ? inUse(ship, c) : null,
        buys: row.buys != null ? row.buys
          : can ? 'A party brings ' + partPhrase(c) + ' to ' + pct(cap) + ', ' + timeWords(eta) + '.' : null,
      };
    });
    const clauses = [];
    let standby = 0;
    for (const p of cr.parties) {
      if (p.task === 'standby') { standby++; continue; }
      clauses.push(words(ship, cr, p));
    }
    if (standby > 0) clauses.push(standby + ' standing by.');
    return {
      crew: { total: cr.total, fit: cr.fit, wounded: cr.wounded, lost: cr.lost, xp: cr.xp, gNow: cr.gNow, gMode: cr.gMode, strapped: cr.strapped, overCouch: cr.overCouch },
      parties, parts,
      words: [crewWords(cr)].concat(clauses).join(' '),
      gWords: gWords(cr),
    };
  }

  // The overlay on the hull: one ring per party that is on a part.
  function artFx(ship) {
    const cr = ship && ship.crew;
    if (!cr) return { parties: [], strapped: false, gNow: 0 };
    const out = [];
    for (const p of cr.parties) {
      if (p.task !== 'repair' || !p.part) continue;
      const working = !cr.strapped && cr.fit > 0 && !inUse(ship, partOf(ship, p.part));
      out.push({ id: p.id, part: p.part, progress: clamp(p.progress, 0, 1), eta: p.eta, working });
    }
    return { parties: out, strapped: !!cr.strapped, overCouch: !!cr.overCouch, gNow: cr.gNow || 0 };
  }

  // ------------------------------------------------------------------ orders
  // Each of these returns the sentence to log, or null when the order cannot be carried out.
  function assign(ship, partyId, task, partId) {
    const cr = ship && ship.crew;
    if (!cr || ship.destroyed) return null;
    const p = partyOf(cr, partyId);
    if (!p || TASKS.indexOf(task) < 0) return null;
    if (task === 'repair') {
      const c = partOf(ship, partId);
      if (!c || busy(cr, partId, p) || !repairable(ship, partId)) return null;
      const was = p.task; // what the ship gives up for this repair, said in the same breath
      start(ship, cr, p, partId);
      let line = 'Party ' + n(p) + ' to ' + partPhrase(c) + ': ' + timeWords(p.eta) + ' to ' + pct(capOf(ship, c)) + '.';
      const why = inUse(ship, c);
      if (why) line += ' Held: ' + why + '.';
      // The cap and the watch are the same number often enough that they cannot share a sentence.
      if (was === 'fire') line += ' Fire control drops to ' + pct(T.noParty) + ' of its rate until she is back.';
      else if (was === 'sensors') line += ' The sensor watch drops to ' + pct(T.noParty) + ' of its rate until she is back.';
      return line;
    }
    p.part = null; p.progress = 0; p.eta = 0; p.task = task; p.since = cr._now || 0;
    if (task === 'fire') return 'Party ' + n(p) + ' to fire control.';
    if (task === 'sensors') return 'Party ' + n(p) + ' to the sensor watch.';
    if (task === 'medical') return 'Party ' + n(p) + ' to the sick bay: one wounded back every ' + T.medic + ' s.';
    return 'Party ' + n(p) + ' stood down.';
  }
  function release(ship, partyId) {
    const cr = ship && ship.crew;
    if (!cr) return null;
    const p = partyOf(cr, partyId);
    if (!p) return null;
    stand(ship, cr, p);
    if (p.task === 'fire') return 'Party ' + n(p) + ' back to fire control.';
    if (p.task === 'sensors') return 'Party ' + n(p) + ' back to the sensor watch.';
    return 'Party ' + n(p) + ' stood down.';
  }
  function setG(ship, mode) {
    const cr = ship && ship.crew;
    if (!cr || ['work', 'couches', 'max'].indexOf(mode) < 0) return null;
    cr.gMode = mode;
    if (mode === 'work') return 'Acceleration limit 1.2 g. The crew keeps working through the burn.';
    if (mode === 'couches') return 'Acceleration limit 3 g. The crew straps in above 1.2 g and repairs pause.';
    return 'No acceleration limit. Above 3 g the crew takes injuries, and above 6 g some are killed.';
  }

  // ------------------------------------------------------------------ campaign
  function toRecord(ship) {
    const cr = ship && ship.crew;
    if (!cr) return null;
    if (ship.destroyed) settleLoss(cr);   // struck off with everyone who was still aboard
    return { fit: Math.round(cr.fit), wounded: Math.round(cr.wounded), lost: Math.round(cr.lost), xp: clamp(Math.round(cr.xp || 0), 0, T.maxXp) };
  }
  // A record may be partial: story.js writes { xp: 1 } for a hull that has seen a fight and nothing
  // else. Whatever it leaves out is a full complement at that experience.
  function fromRecord(ship, rec) {
    if (!ship) return null;
    if (!ship.crew) init(ship);
    const cr = ship.crew;
    if (!rec) return cr;
    const lost = clamp(Math.round(rec.lost || 0), 0, cr.total);
    const wounded = clamp(Math.round(rec.wounded || 0), 0, cr.total - lost);
    const fit = rec.fit != null ? clamp(Math.round(rec.fit), 0, cr.total - lost - wounded) : cr.total - lost - wounded;
    cr.lost = lost; cr.wounded = wounded; cr.fit = fit;
    cr.xp = clamp(Math.round(rec.xp || 0), 0, T.maxXp);
    return cr;
  }
  // A crew that brings the hull home learns something. One point a battle, three in all.
  function afterBattle(rec, survived) {
    if (!rec) return rec;
    if (survived) rec.xp = clamp(Math.round(rec.xp || 0) + 1, 0, T.maxXp);
    return rec;
  }
  // Between battles: a port or a yard has the beds and the hands. Out in the dark, half of them come back.
  function recover(rec, atPortOrYard) {
    if (!rec) return rec;
    const wounded = Math.round(rec.wounded || 0);
    if (wounded > 0) {
      const back = atPortOrYard ? wounded : Math.round(wounded / 2);
      rec.wounded = wounded - back;
      rec.fit = Math.round(rec.fit || 0) + back;
    }
    return rec;
  }

  // ------------------------------------------------------------------ teaching
  const TEACH = {
    parties: 'Your crew works in parties. Party 1 has fire control, party 2 the sensor watch, the rest stand by. Send one to a hurt part from the damage-control board, or press C.',
    workLimit: 'Above 1.2 g the parties strap into the couches. Repairs hold where they are until the burn eases.',
    couchLimit: 'Above 3 g the couches are all that hold the crew. Fire control and the sensor watch run at 85 %, and about 1 in 12 of the crew are hurt every minute for every g over, twice that above 5 g. Above 6 g some of them are killed.',
    juryRig: 'A repair in vacuum is a jury-rig. A wrecked drive comes back to 30 % and no further. A holed tank is isolated, and the propellant that vented is gone.',
    inUse: 'A party cannot work a part that is running. The drive has to be cold, with the throttle at 0. A radiator panel means the radiators pulled in for the whole shift, and no cooling at all while they are in.',
    medical: 'A party in the sick bay brings one wounded back to duty every 45 s. Nobody works the sick bay above 1.2 g. With nobody there the wounded stay down for the rest of the fight.',
    experience: 'A crew that brings the hull home gains a point of experience, up to 3. Each point repairs 15 % faster and steadies fire control and the sensor watch.',
  };

  // The whole jury-rig lesson is three sentences, and two of them are about a part the player is
  // not looking at. This is the one sentence for the part in hand, off damage.js's own cap, for the
  // card that is asking about it. decisions.js prefers it to TEACH.juryRig.
  function teachFor(ship, partId) {
    const c = partId && typeof partId === 'object' ? partId : partOf(ship, partId);
    if (!c) return TEACH.juryRig;
    const name = partPhrase(c);
    const hp = clamp(c.hp, 0, 1);
    const cap = capOf(ship, c);
    if (kindOf(c) === 'tank') {
      if (venting(ship, c)) return 'A party valves ' + name + ' out of the feed: the venting stops, the plating holds at ' + pct(cap) + ', and what went out is gone.';
      if (c.isolated) return up(name) + ' is valved out of the feed already. There is no hole left to shut.';
      if (cap > hp + 1e-6) return 'A dent in sound plating is beaten out in vacuum: ' + name + ' comes back to ' + pct(cap) + '.';
      return up(name) + ' is as sound as a party can make it: ' + pct(cap) + '.';
    }
    if (hp <= 0) {
      if (!(cap > 0)) return 'A wrecked ' + bare(name) + ' is gone. No jury-rig brings it back in a fight.';
      const second = capOf(ship, Object.assign({}, c, { hp: cap }));
      if (second > cap + 1e-6) return 'A wrecked ' + bare(name) + ' reaches ' + pct(cap) + ' in one shift and ' + pct(second) + ' in a second.';
      return 'A wrecked ' + bare(name) + ' reaches ' + pct(cap) + ' and no further.';
    }
    if (!(cap > hp + 1e-6)) return 'A repair in vacuum is a jury-rig, and ' + name + ' is at the cap already: ' + pct(cap) + '.';
    return 'A repair in vacuum is a jury-rig: ' + name + ' comes back to ' + pct(cap) + ', never further.';
  }
  function bare(phrase) { return String(phrase).replace(/^the /, ''); }
  function up(phrase) { const s = String(phrase); return s.charAt(0).toUpperCase() + s.slice(1); }

  OD.Crew = {
    T, CREW, TASKS, TEACH,
    init, update, auto, accelCap, casualties, fireFactor, sensorFactor,
    board, assign, release, setG, artFx, hold, watchToPull, teachFor,
    toRecord, fromRecord, afterBattle, recover,
    repairTime, repairable, capOf,
  };
})();
