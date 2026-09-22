/* Orbital Declaration — skirmish setup. The board is set on the bridge console (OD.Bridge): both sides' counts
   as steppers per hull class, side, place and opening range; Launch goes through the hangar. */
(function () {
  'use strict';
  const OD = window.OD;
  const U = OD.U, P = OD.P;
  const km = (v) => v * 1000;

  const ENVS = {
    deep: { label: 'Deep space', body: null },
    ganymede: { label: 'Ganymede orbit', body: 'ganymede', altitude: km(3000) },
    europa: { label: 'Europa orbit', body: 'europa', altitude: km(2400) },
    io: { label: 'Io orbit', body: 'io', altitude: km(2600) },
    jupiter: { label: 'Jupiter high orbit', body: 'jupiter', altitude: km(300000) },
  };
  const NAMES = {
    // skirmish hulls have names of their own; the story's ships (Larkspur, Anselm, Bastion, Harkness, Sabre,
    // Coriolis, Tenacity, Vigil, Concordance and the rest) stay in the story
    JC: ['Tallow', 'Greylag', 'Ferrous', 'Halcyon', 'Ninefold', 'Sable', 'Wren', 'Corvid', 'Ashlar', 'Thane', 'Ember', 'Kittiwake'],
    ISA: ['Resolve', 'Cadence', 'Assurance', 'Dominion', 'Verity', 'Sentinel', 'Provident', 'Constant', 'Audacious', 'Temperance', 'Steadfast', 'Ordinance'],
  };
  const ORDER = ['cruiser', 'destroyer', 'frigate', 'lancer', 'corvette'];
  // Stock hulls first, then whatever the configurator has installed into OD.Ships.CLASSES.
  const order = () => ORDER.concat(Object.keys(OD.Ships.CLASSES).filter((k) => OD.Ships.CLASSES[k].custom && !ORDER.includes(k)));
  // opening ranges the console steps through (km)
  const RANGES = [100, 200, 300, 400, 500, 750, 1000, 1500, 2000, 3000, 5000, 8000, 12000, 20000];
  const DEFAULTS = { player: 'JC', env: 'deep', range: 1500, playerShips: { frigate: 1, corvette: 2 }, enemyShips: { frigate: 1, corvette: 2 } };

  function build(o) {
    const env = ENVS[o.env] || ENVS.deep;
    const body = env.body ? P.bodies[env.body] : null;
    const range = km(o.range || 1500);
    const player = o.player || 'JC', enemy = player === 'JC' ? 'ISA' : 'JC';
    const ships = [];
    const rngA = U.rng(o.seed || 42);
    // One scatter, used by both sides. A slot's offset is the same distance from its own side's
    // line whichever side holds it, so an even build starts on an even board: the two fleets used
    // to draw their scatter one after the other, and a symmetric skirmish opened with one side
    // already a few tens of kilometres better placed than the other.
    const scatter = [];
    for (let i = 0; i < 24; i++) scatter.push((rngA() - 0.5) * km(120));
    const place = (fac, counts, side, isPlayer) => {
      let i = 0;
      for (const cls of order()) {
        for (let k = 0; k < (counts[cls] || 0); k++) {
          const name = OD.Ships.FACTIONS[fac].prefix + ' ' + NAMES[fac][i % NAMES[fac].length] + (i >= NAMES[fac].length ? ' ' + (Math.floor(i / NAMES[fac].length) + 1) : '');
          const spread = { x: scatter[i % scatter.length] * side, y: (i - 1.5) * km(60) * side };
          const spec = { name, cls, faction: fac, ai: !isPlayer, player: isPlayer, propFraction: 1, id: fac + '_' + cls + '_' + k };
          if (body) {
            const r = body.radius + env.altitude;
            const dAng = (range / 2 / r) * side;
            spec.orbit = { altitude: env.altitude, angle: dAng };
            spec.offset = spread;
          } else {
            spec.pos = { x: (range / 2) * side + spread.x, y: spread.y };
            spec.vel = { x: 0, y: 0 };
            spec.heading = side > 0 ? Math.PI : 0;
          }
          ships.push(spec);
          i++;
        }
      }
    };
    place(player, o.playerShips, -1, true);
    place(enemy, o.enemyShips, 1, false);
    return {
      name: 'Skirmish · ' + env.label, body, sunAngle: rngA() * U.TAU, playerFaction: player,
      ships,
      objectives: [{ id: 'n', text: 'Neutralise all hostile ships', type: 'neutralize', targets: 'hostiles' }],
      intro: [{ speaker: 'Tactical', text: 'Contacts at ' + U.fmt.dist(range) + '. Weapons free.', kind: 'info' }],
      triggers: [],
    };
  }

  function loadOpts() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem('od.skirmish') || 'null'); } catch (e) { saved = null; }
    const o = Object.assign({}, DEFAULTS, saved || {});
    o.playerShips = Object.assign({}, (saved && saved.playerShips) || DEFAULTS.playerShips);
    o.enemyShips = Object.assign({}, (saved && saved.enemyShips) || DEFAULTS.enemyShips);
    if (!ENVS[o.env]) o.env = 'deep';
    if (o.player !== 'JC' && o.player !== 'ISA') o.player = 'JC';
    o.range = Math.max(50, Math.min(20000, +o.range || 1500));
    return o;
  }
  const count = (counts) => Object.keys(counts).reduce((a, k) => a + (OD.Ships.CLASSES[k] ? Math.max(0, Math.min(6, counts[k] | 0)) : 0), 0);

  // The board, on the bridge console.
  function screen(game) {
    if (!OD.Bridge) { domScreen(game); return; }
    const UI = OD.UI;
    game.sim = null; game.running = false;
    if (!game.demo || game.demo.kind !== 'menu') game.demo = game.makeDemo();
    const state = loadOpts();
    const launch = () => {
      if (!count(state.playerShips)) { UI.toast('Give yourself at least one ship.'); return; }
      if (!count(state.enemyShips)) { UI.toast('Give the enemy at least one ship.'); return; }
      const opts = { player: state.player, env: state.env, range: state.range, playerShips: { ...state.playerShips }, enemyShips: { ...state.enemyShips }, seed: Date.now() & 0xffff };
      try { localStorage.setItem('od.skirmish', JSON.stringify(opts)); } catch (e) { /* per-viewer convenience only */ }
      game.startScenario(build(opts), { mode: 'Skirmish', onEnd: () => screen(game), onBack: () => screen(game) });
    };
    game.bridge('skirmish', {
      title: 'Set the board',
      sub: 'Pick both sides, the place and the opening range. The enemy flies to doctrine. Corvettes and frigates jink and hold their preferred range. Destroyers and cruisers stand off and stay nose-on.',
      state,
      sides: [{ id: 'JC', label: 'Jovian Compact' }, { id: 'ISA', label: 'Inner Systems Authority' }],
      envs: Object.keys(ENVS).map((k) => ({ id: k, label: ENVS[k].label })),
      ranges: RANGES,
      classes: order().map((c) => ({ id: c, name: OD.Ships.CLASSES[c].name, custom: !!OD.Ships.CLASSES[c].custom })),
      keys: [
        { id: 'k:launch', label: 'Launch', kbd: '⏎', primary: true, enter: true, sound: 'confirm', act: launch },
        { id: 'k:back', label: 'Back', kbd: 'Esc', esc: true, act: () => game.showMenu() },
      ],
      onBack: () => game.showMenu(),
    });
  }

  // Without the bridge module the board is a DOM screen.
  function domScreen(game) {
    const UI = OD.UI;
    const counts = (prefix, def) => order().map((c) => '<div class="line"><span>' + OD.Ships.CLASSES[c].name + '</span><input type="number" id="' + prefix + '_' + c + '" min="0" max="6" value="' + (def[c] || 0) + '"></div>').join('');
    const el = UI.screen('skirmish', '<div class="eyebrow">Skirmish</div><h2 class="title" style="font-size:36px">Set the board</h2><p class="sub">Pick both sides, the place and the opening range.</p>' +
      '<div class="opts"><label>Your side <select id="skSide"><option value="JC">Jovian Compact</option><option value="ISA">Inner Systems Authority</option></select></label>' +
      '<label>Where <select id="skEnv">' + Object.keys(ENVS).map((k) => '<option value="' + k + '">' + ENVS[k].label + '</option>').join('') + '</select></label>' +
      '<label>Opening range (km) <input type="number" id="skRange" min="50" max="20000" step="50" value="1500"></label></div>' +
      '<div class="skirm"><div class="col"><h4 class="JC" id="skColA">Your ships</h4>' + counts('skA', DEFAULTS.playerShips) + '</div><div class="col"><h4 class="ISA" id="skColB">Enemy ships</h4>' + counts('skB', DEFAULTS.enemyShips) + '</div></div>' +
      '<div class="actions"><button class="primary" id="skGo">Launch</button><button id="skBack" data-esc>Back</button></div>', { wide: true });
    const read = (prefix) => { const o = {}; for (const c of order()) o[c] = Math.max(0, Math.min(6, +el.querySelector('#' + prefix + '_' + c).value || 0)); return o; };
    el.querySelector('#skGo').addEventListener('click', () => {
      const playerShips = read('skA'), enemyShips = read('skB');
      if (!Object.values(playerShips).some((v) => v > 0)) { UI.toast('Give yourself at least one ship.'); return; }
      if (!Object.values(enemyShips).some((v) => v > 0)) { UI.toast('Give the enemy at least one ship.'); return; }
      const opts = { player: el.querySelector('#skSide').value, env: el.querySelector('#skEnv').value, range: +el.querySelector('#skRange').value || 1500, playerShips, enemyShips, seed: Date.now() & 0xffff };
      try { localStorage.setItem('od.skirmish', JSON.stringify(opts)); } catch (e) { /* per-viewer convenience only */ }
      game.startScenario(build(opts), { mode: 'Skirmish', onEnd: () => screen(game) });
    });
    el.querySelector('#skBack').addEventListener('click', () => game.showMenu());
  }

  OD.Skirmish = { build, screen, ENVS, RANGES, loadOpts };
})();
