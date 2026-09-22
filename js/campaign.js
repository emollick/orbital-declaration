/* Orbital Declaration — Jovian campaign: eleven nodes, a persistent fleet, turns. */
(function () {
  'use strict';
  const OD = window.OD;
  const U = OD.U, P = OD.P;
  const km = (v) => v * 1000;
  const SAVE = 'od.campaign';

  // Map positions are schematic (Jupiter at the centre, distances compressed).
  const NODES = [
    { id: 'callisto', name: 'Callisto · Valhalla Station', kind: 'port', body: 'callisto', x: 0.90, y: 0.78, owner: 'JC', desc: 'Compact capital and home port. Full refuel and repair. If it falls, the war is over.' },
    { id: 'ganymede', name: 'Ganymede · Galileo Regio Yards', kind: 'yard', body: 'ganymede', x: 0.72, y: 0.30, owner: 'JC', desc: 'The Compact\'s shipyards. New hulls are commissioned here.' },
    { id: 'europa', name: 'Europa · Conamara Station', kind: 'station', body: 'europa', x: 0.42, y: 0.20, owner: 'JC', desc: 'Ice farm and refuelling stop. Two 20 MW station lasers defend it.' },
    { id: 'io', name: 'Io · Loki Foundry', kind: 'base', body: 'io', x: 0.30, y: 0.62, owner: 'ISA', desc: 'The Authority\'s foothold. Hold Io and Amalthea together and the war is won.' },
    { id: 'amalthea', name: 'Amalthea · Forward Anchorage', kind: 'base', body: 'jupiter', x: 0.55, y: 0.50, owner: 'ISA', desc: 'Authority forward base in low Jupiter orbit. Hold it and Io together and the war is won.' },
    { id: 'thebe', name: 'Thebe Yards', kind: 'yard', body: 'jupiter', x: 0.56, y: 0.66, owner: 'ISA', desc: 'A Compact yard the Authority took. Retake it for a second slipway and 22 requisition a turn.' },
    { id: 'metis', name: 'Metis Ring Refinery', kind: 'depot', body: 'jupiter', x: 0.40, y: 0.36, owner: 'none', desc: 'Propellant mined from Jupiter\'s ring. Whoever holds it refuels here and earns 6 requisition a turn.' },
    { id: 'anvil', name: 'Anvil High Station', kind: 'station', body: 'jupiter', x: 0.58, y: 0.14, owner: 'none', desc: 'Neutral station in high Jupiter orbit. It pays 12 requisition a turn to whoever takes it.' },
    { id: 'himalia', name: 'Himalia Picket', kind: 'depot', body: null, x: 0.14, y: 0.20, owner: 'ISA', desc: 'Outer depot. Authority reinforcements arrive here from the inner system.' },
    { id: 'l4', name: 'Depot L4', kind: 'depot', body: null, x: 0.20, y: 0.86, owner: 'none', desc: 'Unmanned propellant depot on the Ganymede–Jupiter L4 point.' },
    { id: 'l5', name: 'Depot L5', kind: 'depot', body: null, x: 0.82, y: 0.52, owner: 'none', desc: 'Unmanned propellant depot on the L5 point.' },
  ];
  const EDGES = [
    ['callisto', 'ganymede', 3.2], ['callisto', 'l5', 2.1], ['callisto', 'thebe', 4.6], ['callisto', 'l4', 3.8],
    ['ganymede', 'europa', 2.8], ['ganymede', 'anvil', 2.4], ['ganymede', 'l5', 2.0], ['ganymede', 'thebe', 3.5],
    ['europa', 'metis', 2.6], ['europa', 'anvil', 2.2], ['europa', 'io', 2.4], ['europa', 'himalia', 4.4],
    ['io', 'amalthea', 2.0], ['io', 'metis', 1.8], ['io', 'l4', 3.4], ['io', 'himalia', 4.9],
    ['amalthea', 'thebe', 1.6], ['amalthea', 'metis', 1.5], ['amalthea', 'anvil', 2.9],
    ['thebe', 'l5', 3.1], ['thebe', 'l4', 3.9], ['metis', 'anvil', 2.7], ['l4', 'himalia', 5.2],
  ];
  const GARRISONS = {
    io: ['destroyer', 'frigate', 'corvette', 'corvette'], amalthea: ['cruiser', 'destroyer', 'frigate', 'lancer'], thebe: ['frigate', 'corvette'],
    himalia: ['frigate', 'lancer', 'corvette'], metis: [], anvil: [], l4: [], l5: [],
  };
  const COST = { corvette: 40, frigate: 70, destroyer: 120, lancer: 55, cruiser: 260 };
  // Configurator designs are priced by dry mass on the same curve as the stock hulls.
  const costOf = (cls) => {
    if (COST[cls]) return COST[cls];
    const d = OD.Ships.CLASSES[cls] || {};
    if (OD.Configurator && typeof OD.Configurator.cost === 'function') { try { const c = OD.Configurator.cost(d); if (isFinite(c) && c > 0) return Math.round(c); } catch (e) { /* fall through */ } }
    return Math.round((40 * Math.pow(d.dryMass / 900e3 || 1, 0.68)) / 5) * 5;
  };
  const yardList = () => ['corvette', 'frigate', 'destroyer', 'lancer'].concat(Object.keys(OD.Ships.CLASSES).filter((k) => OD.Ships.CLASSES[k].custom));
  const INCOME = { port: 18, yard: 22, station: 12, depot: 6, base: 10 };
  const JC_NAMES = ['Tallow', 'Greylag', 'Ferrous', 'Halcyon', 'Ninefold', 'Sable', 'Wren', 'Orrery', 'Cinder', 'Vesper'];

  function newState() {
    const nodes = {};
    for (const n of NODES) nodes[n.id] = { owner: n.owner, garrison: (GARRISONS[n.id] || []).slice() };
    return {
      turn: 1, rp: 60, fleetAt: 'callisto', nameIdx: 0,
      nodes,
      fleet: [
        { id: 'c_larkspur', name: 'JCS Larkspur', cls: 'corvette', propFraction: 1, hull: 1, systems: { drive: 1, radiators: 1, sensors: 1, weapons: 1 } },
        { id: 'c_anselm', name: 'JCS Anselm', cls: 'frigate', propFraction: 1, hull: 1, systems: { drive: 1, radiators: 1, sensors: 1, weapons: 1 } },
      ],
      log: ['Turn 1. The fleet is at Callisto. Take Io and Amalthea. Keep Callisto.'],
      outcome: null,
    };
  }
  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(SAVE) || 'null');
      if (!s || !s.nodes) return null;
      // a design deleted in the configurator cannot be flown; its ships are struck off rather than crashing the map
      if (s.fleet) s.fleet = s.fleet.filter((f) => OD.Ships.CLASSES[f.cls]);
      return s;
    } catch (e) { return null; }
  }
  function save(state) { try { localStorage.setItem(SAVE, JSON.stringify(state)); } catch (e) { /* per-viewer only */ } }
  function clear() { try { localStorage.removeItem(SAVE); } catch (e) { /* ignore */ } }

  const node = (id) => NODES.find((n) => n.id === id);
  function neighbours(id) { return EDGES.filter((e) => e[0] === id || e[1] === id).map((e) => ({ id: e[0] === id ? e[1] : e[0], dv: e[2] })); }
  function edgeDv(a, b) { const e = EDGES.find((e) => (e[0] === a && e[1] === b) || (e[0] === b && e[1] === a)); return e ? e[2] : null; }
  function shipDv(s) { const c = OD.Ships.CLASSES[s.cls]; return P.tsiolkovsky(c.exhaustVelocity, c.dryMass + c.propMass * s.propFraction, c.dryMass); }
  function canMove(state, to) {
    const dv = edgeDv(state.fleetAt, to);
    if (dv == null) return { ok: false, why: 'Not adjacent.' };
    const short = state.fleet.filter((s) => shipDv(s) < km(dv) + 6000);
    if (short.length) return { ok: false, why: short[0].name + ' has ' + U.fmt.dv(shipDv(short[0])) + '. The transfer costs ' + dv.toFixed(1) + ' km/s and every ship keeps 6 km/s to fight with.' };
    return { ok: true, dv };
  }
  function spendDv(s, dvms) {
    const c = OD.Ships.CLASSES[s.cls];
    const m0 = c.dryMass + c.propMass * s.propFraction;
    const used = P.propellantForDv(c.exhaustVelocity, m0, dvms);
    s.propFraction = Math.max(0, (c.propMass * s.propFraction - used) / c.propMass);
  }
  function move(state, to) {
    const r = canMove(state, to);
    if (!r.ok) return r;
    for (const s of state.fleet) spendDv(s, km(r.dv));
    state.fleetAt = to;
    state.log.push('Turn ' + state.turn + '. Fleet transferred to ' + node(to).name + ' for ' + r.dv.toFixed(1) + ' km/s.');
    return r;
  }
  function battleHere(state) { const n = state.nodes[state.fleetAt]; return n.owner !== 'JC' && n.garrison.length > 0; }
  function resupply(state) {
    const n = state.nodes[state.fleetAt], def = node(state.fleetAt);
    if (n.owner !== 'JC') return false;
    let did = false;
    for (const s of state.fleet) {
      if (s.propFraction < 1) { s.propFraction = 1; did = true; }
      // The wounded come back to fit in full at a port or yard, half elsewhere; the lost stay lost (v13).
      if (s.crew && OD.Crew && typeof OD.Crew.recover === 'function') { if (OD.Crew.recover(s.crew, def.kind === 'port' || def.kind === 'yard')) did = true; }
      if (def.kind === 'port' || def.kind === 'yard') {
        if (s.hull < 1) { s.hull = Math.min(1, s.hull + 0.4); did = true; }
        // The yard patches the parts and the aggregates follow; an old save has only the aggregates.
        if (OD.Damage && OD.Damage.repair && s.components && s.components.length) { if (OD.Damage.repair(s, 0.5)) did = true; }
        else for (const k in s.systems) if (s.systems[k] < 1) { s.systems[k] = Math.min(1, s.systems[k] + 0.5); did = true; }
      }
    }
    return did;
  }
  function buy(state, cls) {
    const def = node(state.fleetAt);
    if (def.kind !== 'yard' && def.kind !== 'port') return 'Ships are commissioned at yards and at Callisto.';
    if (state.nodes[state.fleetAt].owner !== 'JC') return 'Not ours.';
    if (state.rp < costOf(cls)) return 'That hull costs ' + costOf(cls) + ' requisition. You have ' + state.rp + '.';
    state.rp -= costOf(cls);
    const name = 'JCS ' + JC_NAMES[state.nameIdx % JC_NAMES.length] + (state.nameIdx >= JC_NAMES.length ? ' II' : '');
    state.nameIdx++;
    state.fleet.push({ id: 'c_' + U.uid(), name, cls, propFraction: 1, hull: 1, systems: { drive: 1, radiators: 1, sensors: 1, weapons: 1 } });
    state.log.push(name + ' commissioned (' + OD.Ships.CLASSES[cls].name + ').');
    return null;
  }
  function endTurn(state) {
    state.turn++;
    let income = 0;
    for (const n of NODES) if (state.nodes[n.id].owner === 'JC') income += INCOME[n.kind] || 0;
    state.rp += income;
    const notes = ['Turn ' + state.turn + '. Requisition +' + income + '.'];
    // Authority reinforcements and raids.
    const rng = U.rng(state.turn * 7919 + 13);
    if (state.turn % 3 === 0) {
      const isa = NODES.filter((n) => state.nodes[n.id].owner === 'ISA');
      if (isa.length) { const n = rng.pick(isa); const cls = rng.pick(['corvette', 'frigate', 'frigate', 'lancer', 'destroyer']); state.nodes[n.id].garrison.push(cls); notes.push('An Authority ' + cls + ' arrived at ' + n.name + '.'); }
    }
    if (state.turn % 4 === 0) {
      const targets = NODES.filter((n) => state.nodes[n.id].owner === 'JC' && n.id !== 'callisto' && neighbours(n.id).some((nb) => state.nodes[nb.id].owner === 'ISA' && state.nodes[nb.id].garrison.length));
      if (targets.length) {
        const t = rng.pick(targets);
        if (state.fleetAt === t.id) notes.push('An Authority raid on ' + t.name + ' turned back when it saw the fleet.');
        else if (t.kind === 'station') notes.push((t.name.split(' · ')[1] || t.name) + ' drove off an Authority raid with its station lasers.');
        else { state.nodes[t.id].owner = 'ISA'; state.nodes[t.id].garrison = ['frigate', 'corvette']; notes.push(t.name + ' has fallen to an Authority raid.'); }
      }
    }
    state.log.push(...notes);
    checkOutcome(state);
    return notes;
  }
  function checkOutcome(state) {
    if (state.nodes.io.owner === 'JC' && state.nodes.amalthea.owner === 'JC') state.outcome = 'victory';
    else if (state.nodes.callisto.owner !== 'JC' || (state.fleet.length === 0 && state.rp < 40)) state.outcome = 'defeat';
    return state.outcome;
  }

  function buildBattle(state) {
    const def = node(state.fleetAt);
    const n = state.nodes[state.fleetAt];
    const body = def.body ? P.bodies[def.body] : null;
    const alt = def.body === 'jupiter' ? km(220000) : km(2800);
    const ships = [];
    state.fleet.forEach((s, i) => {
      const spec = { id: s.id, name: s.name, cls: s.cls, faction: 'JC', player: true, propFraction: s.propFraction, hull: s.hull, systems: { ...s.systems } };
      if (s.components && s.components.length) spec.components = s.components.map((c) => ({ ...c })); // wear carried from the last fight
      if (s.crew) spec.crew = { ...s.crew }; // the people carried from the last fight (v13)
      if (body) { spec.orbit = { altitude: alt, angle: 0 }; spec.offset = { x: (i % 2) * km(40), y: i * km(50) }; } else { spec.pos = { x: -km(600), y: i * km(50) }; spec.vel = { x: 0, y: 0 }; }
      ships.push(spec);
    });
    const names = ['Sabre', 'Coriolis', 'Tenacity', 'Vigil', 'Ardent', 'Fervent', 'Lark', 'Meridian', 'Resolve', 'Cadence'];
    n.garrison.forEach((cls, i) => {
      const spec = { id: 'g' + i, name: 'ISV ' + names[i % names.length], cls, faction: 'ISA', ai: true, propFraction: 0.9 };
      const r = body ? body.radius + alt : 0;
      if (body) { spec.orbit = { altitude: alt + km(300 + i * 150), angle: km(1200) / r }; } else { spec.pos = { x: km(600), y: i * km(60) }; spec.vel = { x: 0, y: 0 }; spec.heading = Math.PI; }
      ships.push(spec);
    });
    if (def.kind === 'station' || def.kind === 'base') {
      const spec = { id: 'nodestation', name: def.name.split(' · ')[1] || def.name, cls: 'station', faction: n.owner === 'JC' ? 'JC' : 'ISA', ai: true };
      if (body) spec.orbit = { altitude: alt, angle: km(700) / (body.radius + alt) }; else spec.pos = { x: km(700), y: -km(100) };
      ships.push(spec);
    }
    return {
      name: def.name, body, sunAngle: (state.turn * 0.7) % U.TAU, playerFaction: 'JC', ships,
      objectives: [{ id: 'n', text: 'Neutralise the Authority garrison', type: 'neutralize', targets: 'hostiles' }],
      intro: [{ speaker: 'Tactical', text: 'Authority garrison at ' + def.name + ', ' + n.garrison.length + ' ships.', kind: 'info' }],
      triggers: [],
    };
  }
  function applyBattle(state, sim, outcome) {
    const next = [];
    for (const s of state.fleet) {
      const sh = sim.byId(s.id);
      if (!sh || sh.destroyed) { state.log.push(s.name + ' was lost at ' + node(state.fleetAt).name + '.'); continue; }
      s.propFraction = sh.propMass / sh.fullPropMass; s.hull = sh.hull; s.systems = { ...sh.systems };
      if (OD.Damage && OD.Damage.toRecord) s.components = OD.Damage.toRecord(sh);
      if (OD.Crew && typeof OD.Crew.toRecord === 'function') { s.crew = OD.Crew.toRecord(sh); if (typeof OD.Crew.afterBattle === 'function') OD.Crew.afterBattle(s.crew, true); }
      if (sh.captured) continue;
      next.push(s);
    }
    // Prizes join the fleet.
    for (const sh of sim.ships) if (sh.captured && sh.faction === 'JC' && sh.role !== 'station' && !state.fleet.some((f) => f.id === sh.id)) {
      const prize = { id: 'c_' + U.uid(), name: sh.name.replace('ISV', 'JCS'), cls: sh.cls, propFraction: sh.propMass / sh.fullPropMass, hull: sh.hull, systems: { ...sh.systems, weapons: Math.min(sh.systems.weapons, 0.6) } };
      if (OD.Damage && OD.Damage.toRecord) { prize.components = OD.Damage.toRecord(sh); OD.Damage.limitWeapons(prize, 0.6); } // a prize crew works only part of the rack
      next.push(prize);
      state.log.push(sh.name + ' taken as a prize.');
    }
    state.fleet = next;
    const n = state.nodes[state.fleetAt];
    if (outcome === 'victory') { n.owner = 'JC'; n.garrison = []; state.log.push(node(state.fleetAt).name + ' is now under Compact control.'); }
    else { n.garrison = n.garrison.filter((c, i) => { const g = sim.byId('g' + i); return g && !g.neutralised(); }); if (!n.garrison.length) { n.owner = 'JC'; state.log.push('The garrison is gone. ' + node(state.fleetAt).name + ' is ours.'); } }
    checkOutcome(state);
  }

  // ------------------------------------------------------------ screen
  function drawMap(canvas, state, sel, hover) {
    const ctx = canvas.getContext('2d');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    canvas.width = w * dpr; canvas.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#05070c'; ctx.fillRect(0, 0, w, h);
    const rng = U.rng(3);
    for (let i = 0; i < 260; i++) { ctx.fillStyle = 'rgba(255,255,255,' + (0.15 + rng() * 0.5) + ')'; ctx.fillRect(rng() * w, rng() * h, 1, 1); }
    // Jupiter
    const jx = w * 0.47, jy = h * 0.5;
    const g = ctx.createRadialGradient(jx - 18, jy - 14, 4, jx, jy, 60);
    g.addColorStop(0, '#e2c39a'); g.addColorStop(0.6, '#c9a37a'); g.addColorStop(1, '#5a4330');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(jx, jy, 46, 0, U.TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(201,163,122,0.15)'; ctx.lineWidth = 1;
    // the planet's own name (the scan of 2026-09-22 found the disc unlabelled with the Amalthea node on its centre)
    ctx.fillStyle = 'rgba(226,195,154,0.55)'; ctx.font = '600 11px "Rajdhani", sans-serif'; ctx.textAlign = 'center'; ctx.fillText('JUPITER', jx, jy + 60);
    for (const r of [110, 190, 270]) { ctx.beginPath(); ctx.arc(jx, jy, r, 0, U.TAU); ctx.stroke(); }
    const pos = (n) => ({ x: n.x * w, y: n.y * h });
    const colour = (o) => o === 'JC' ? '#4fd1c5' : o === 'ISA' ? '#f0a04b' : '#8f9bad';
    // edges; the costs of the routes open this turn are drawn after the nodes, so a node never sits on one
    const costs = [];
    ctx.font = '10px "IBM Plex Mono", monospace'; ctx.textAlign = 'center';
    for (const [a, b, dv] of EDGES) {
      const pa = pos(node(a)), pb = pos(node(b));
      const adj = a === state.fleetAt || b === state.fleetAt;
      ctx.strokeStyle = adj ? 'rgba(79,209,197,0.55)' : 'rgba(127,142,163,0.25)'; ctx.lineWidth = adj ? 1.5 : 1;
      ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
      if (adj) costs.push({ pa, pb, dv });
    }
    // nodes
    for (const n of NODES) {
      const p = pos(n), st = state.nodes[n.id];
      const c = colour(st.owner);
      const isSel = sel === n.id, isHover = hover === n.id;
      ctx.beginPath(); ctx.arc(p.x, p.y, isSel ? 11 : 8, 0, U.TAU);
      ctx.fillStyle = st.owner === 'none' ? 'rgba(143,155,173,0.25)' : c.replace(')', '') && (st.owner === 'JC' ? 'rgba(79,209,197,0.3)' : 'rgba(240,160,75,0.3)'); ctx.fill();
      ctx.strokeStyle = c; ctx.lineWidth = isSel || isHover ? 2.5 : 1.5; ctx.stroke();
      if (n.kind === 'yard' || n.kind === 'port') { ctx.beginPath(); ctx.moveTo(p.x - 4, p.y); ctx.lineTo(p.x + 4, p.y); ctx.moveTo(p.x, p.y - 4); ctx.lineTo(p.x, p.y + 4); ctx.strokeStyle = c; ctx.lineWidth = 1.5; ctx.stroke(); }
      if (st.garrison.length) { ctx.fillStyle = '#f0a04b'; ctx.font = '600 10px "Rajdhani", sans-serif'; ctx.fillText('⚑ ' + st.garrison.length, p.x + 16, p.y + 4); }
      ctx.fillStyle = '#d7e0ea'; ctx.font = '600 12px "Rajdhani", sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(n.name.split(' · ')[0], p.x, p.y - 15);
      if (state.fleetAt === n.id) {
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.2; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.arc(p.x, p.y, 16, 0, U.TAU); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = '#ffffff'; ctx.font = '10px "IBM Plex Mono", monospace'; ctx.fillText('FLEET', p.x, p.y + 30);
      }
    }
    // route costs, on the map's own ground so they read over a line, slid along the edge when a node is under them
    ctx.font = '10px "IBM Plex Mono", monospace'; ctx.textAlign = 'center';
    for (const c of costs) {
      const label = c.dv.toFixed(1) + ' km/s';
      const ex = c.pb.x - c.pa.x, ey = c.pb.y - c.pa.y, len = Math.hypot(ex, ey) || 1;
      let f = 0.5, lx = (c.pa.x + c.pb.x) / 2, ly = (c.pa.y + c.pb.y) / 2;
      for (let k = 0; k < 8; k++) {
        const near = NODES.some((n) => { const q = pos(n); return Math.hypot(q.x - lx, q.y - ly) < 24 || (Math.abs(q.y - 15 - (ly - 6)) < 12 && Math.abs(q.x - lx) < 46); });
        if (!near) break;
        f += (k % 2 ? -1 : 1) * (k + 1) * 14 / len; lx = c.pa.x + ex * f; ly = c.pa.y + ey * f;
      }
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = 'rgba(8,12,18,0.85)'; ctx.fillRect(lx - tw / 2 - 3, ly - 13, tw + 6, 12);
      ctx.fillStyle = 'rgba(215,224,234,0.85)'; ctx.fillText(label, lx, ly - 4);
    }
  }

  function screen(game, state) {
    const UI = OD.UI;
    state = state || load() || newState();
    save(state);
    let sel = state.fleetAt, hover = null;
    const def = () => node(state.fleetAt);
    // The people aboard, from the record the last fight left (v13): fit, wounded, lost, and how seasoned.
    const crewLine = (s) => {
      const c = s.crew; if (!c || !(c.fit >= 0)) return '';
      const xp = Math.max(0, Math.min(3, Math.round(c.xp || 0)));
      const parts = [c.fit + ' fit']; if (c.wounded > 0) parts.push(c.wounded + ' wounded'); if (c.lost > 0) parts.push(c.lost + ' lost');
      const exp = 'experience ' + xp + ' of 3' + (xp > 0 ? ', repairs ' + xp * 15 + ' % faster' : '');
      return '<div style="font-size:12px;color:var(--dim);margin-top:2px">Crew: ' + parts.join(', ') + ' · ' + exp + '</div>';
    };
    const fleetHtml = () => state.fleet.map((s) => '<div class="ship"><span><b>' + U.escapeHtml(s.name) + '</b> <span style="color:var(--dim)">' + OD.Ships.CLASSES[s.cls].role + '</span></span><span class="num">' + U.fmt.dv(shipDv(s)) + '</span><div class="bars"><div class="bar dv"><i style="width:' + Math.round(s.propFraction * 100) + '%"></i></div><div class="bar hull' + (s.hull < 0.35 ? ' crit' : '') + '"><i style="width:' + Math.round(s.hull * 100) + '%"></i></div></div>' + crewLine(s) + '</div>').join('') || '<div style="color:var(--dim)">No ships. Commission one.</div>';
    const html = '<div class="eyebrow">Campaign · Turn <span id="cTurn">' + state.turn + '</span> · Requisition <span id="cRp">' + state.rp + '</span></div><h2 class="title" style="font-size:32px">The Jovian system</h2>' +
      '<div class="camp-grid"><div><canvas id="campMap"></canvas><p class="sub" id="cNodeDesc" style="margin-top:8px;font-size:13px"></p></div>' +
      '<div class="camp-side"><div class="box"><h4>Selected</h4><div id="cNodeInfo"></div><div class="actions" id="cNodeActions" style="margin-top:8px"></div></div>' +
      '<div class="box"><h4>Fleet · at ' + U.escapeHtml(def().name.split(' · ')[0]) + '</h4><div id="cFleet">' + fleetHtml() + '</div><div class="actions" id="cBuy" style="margin-top:8px"></div></div>' +
      '<div class="box"><h4>Log</h4><div id="cLog" style="max-height:120px;overflow:auto;font-size:11px;color:var(--ink-2)">' + state.log.slice(-8).map((l) => '<div>' + U.escapeHtml(l) + '</div>').join('') + '</div></div></div></div>' +
      '<div class="actions"><button class="primary" id="cEnd">End turn</button><button id="cResupply">Refuel &amp; repair here</button><button id="cRestart" class="danger">Restart campaign</button><button id="cBack">Menu</button></div>';
    const el = UI.screen('campaign', html, { wide: true });
    const canvas = el.querySelector('#campMap');
    const redraw = () => drawMap(canvas, state, sel, hover);
    const refreshSide = () => {
      const n = node(sel), st = state.nodes[sel];
      el.querySelector('#cNodeDesc').textContent = n.name + ' — ' + n.desc;
      el.querySelector('#cNodeInfo').innerHTML = '<b>' + U.escapeHtml(n.name) + '</b><br>Owner: <span style="color:' + (st.owner === 'JC' ? 'var(--accent)' : st.owner === 'ISA' ? 'var(--accent-2)' : 'var(--dim)') + '">' + (st.owner === 'JC' ? 'Compact' : st.owner === 'ISA' ? 'Authority' : 'unclaimed') + '</span>' + (st.garrison.length ? '<br>Garrison: ' + st.garrison.map((c) => OD.Ships.CLASSES[c].role).join(', ') : '') + (sel !== state.fleetAt && edgeDv(state.fleetAt, sel) != null ? '<br>Transfer: ' + edgeDv(state.fleetAt, sel).toFixed(1) + ' km/s per ship' : '');
      const acts = el.querySelector('#cNodeActions'); acts.innerHTML = '';
      if (sel !== state.fleetAt) {
        const r = canMove(state, sel);
        const b = document.createElement('button'); b.className = 'primary'; b.textContent = 'Move fleet'; b.disabled = !r.ok; b.title = r.ok ? '' : r.why;
        b.addEventListener('click', () => { const m = move(state, sel); if (!m.ok) { UI.toast(m.why); return; } save(state); if (battleHere(state)) launchBattle(); else screen(game, state); });
        acts.appendChild(b);
        if (!r.ok) { const s = document.createElement('span'); s.style.cssText = 'color:var(--dim);font-size:11px;align-self:center'; s.textContent = r.why; acts.appendChild(s); }
      } else if (battleHere(state)) {
        const b = document.createElement('button'); b.className = 'primary'; b.textContent = 'Engage garrison'; b.addEventListener('click', launchBattle); acts.appendChild(b);
      }
      const buyEl = el.querySelector('#cBuy'); buyEl.innerHTML = '';
      const here = def();
      if ((here.kind === 'yard' || here.kind === 'port') && state.nodes[state.fleetAt].owner === 'JC') {
        for (const cls of yardList()) {
          const b = document.createElement('button'); b.className = 'sm'; b.textContent = (OD.Ships.CLASSES[cls].custom ? OD.Ships.CLASSES[cls].name : cls) + ' · ' + costOf(cls); b.disabled = state.rp < costOf(cls);
          b.addEventListener('click', () => { const err = buy(state, cls); if (err) UI.toast(err); else { save(state); screen(game, state); } });
          buyEl.appendChild(b);
        }
        // v8: the slipway. Inspect each ship of the fleet and swap a hull for a saved design of the same family for the RP difference.
        if (game && typeof game.refitFleet === 'function' && OD.Configurator && state.fleet && state.fleet.length) {
          const b = document.createElement('button'); b.className = 'sm'; b.textContent = 'Refit fleet';
          b.title = 'Inspect each ship and swap its hull for a saved design of the same family. You pay the requisition difference.';
          b.addEventListener('click', () => { save(state); game.refitFleet(state); });
          buyEl.appendChild(b);
        }
      }
    };
    const launchBattle = () => {
      const scenario = buildBattle(state);
      game.startScenario(scenario, { mode: 'Campaign', brief: { title: def().name, text: [def().desc, 'Whatever survives carries its damage and its propellant into the next turn. Prizes join the fleet.'] }, onEnd: (outcome, sim) => { applyBattle(state, sim, outcome); save(state); if (state.outcome) finish(); else screen(game, state); } });
    };
    const finish = () => {
      const v = state.outcome === 'victory';
      const e = UI.screen('campend', '<div class="eyebrow">Campaign</div><h2 class="title ' + (v ? 'debrief-victory' : '') + '" style="font-size:40px;color:' + (v ? 'var(--accent)' : 'var(--crit)') + '">' + (v ? 'The Jovian system is Compact' : 'The Compact has fallen') + '</h2><p class="sub">' + (v ? 'Io and Amalthea are yours on turn ' + state.turn + '. The Authority\'s remaining hulls burned for the inner system, and the blockade is over.' : 'Callisto is gone or the fleet is. The Authority runs the moons as a customs territory again.') + '</p><div class="actions"><button class="primary" id="ceNew">New campaign</button><button id="ceMenu">Menu</button></div>');
      e.querySelector('#ceNew').addEventListener('click', () => { clear(); screen(game, newState()); });
      e.querySelector('#ceMenu').addEventListener('click', () => game.showMenu());
    };
    const hit = (ev) => {
      const r = canvas.getBoundingClientRect();
      const x = (ev.clientX - r.left) / r.width, y = (ev.clientY - r.top) / r.height;
      let best = null, bd = 0.0016;
      for (const n of NODES) { const d = (n.x - x) ** 2 + ((n.y - y) * (r.height / r.width)) ** 2; if (d < bd) { bd = d; best = n.id; } }
      return best;
    };
    canvas.addEventListener('mousemove', (ev) => { const h = hit(ev); if (h !== hover) { hover = h; redraw(); } canvas.style.cursor = h ? 'pointer' : 'default'; });
    canvas.addEventListener('click', (ev) => { const h = hit(ev); if (h) { sel = h; refreshSide(); redraw(); } });
    el.querySelector('#cEnd').addEventListener('click', () => { const notes = endTurn(state); save(state); if (state.outcome) finish(); else { screen(game, state); UI.toast(notes[notes.length - 1]); } });
    el.querySelector('#cResupply').addEventListener('click', () => { if (state.nodes[state.fleetAt].owner !== 'JC') { UI.toast('Only at a Compact port, yard, station or depot.'); return; } if (resupply(state)) { save(state); screen(game, state); UI.toast('Tanks full.'); } else UI.toast('Tanks are full and there is nothing to repair.'); });
    el.querySelector('#cRestart').addEventListener('click', () => { clear(); screen(game, newState()); });
    el.querySelector('#cBack').addEventListener('click', () => game.showMenu());
    if (state.outcome) { finish(); return; }
    refreshSide(); redraw();
    requestAnimationFrame(redraw);
  }

  OD.Campaign = { NODES, EDGES, newState, load, save, clear, screen, buildBattle, applyBattle, endTurn, move, canMove };
})();
