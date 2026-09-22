/* Orbital Declaration — game shell: loop, input, modes. The menus are bridge screens (OD.Bridge) drawn on the
   tactical canvas; help, physics, the hull view, the campaign map and the configurator stay DOM screens. */
(function () {
  'use strict';
  // The textbook transfer from this start: a burn-flip-brake in the target's frame that credits the speed we
  // already carry toward her (a head start, not a bill: the scan of 2026-09-22 found |v_rel| added whatever
  // its sign, so a hull could read as beating the ideal). With v the closing speed and d the range,
  // 2·sqrt(a·d + v²/2) − v, plus the sideways speed that has to be killed either way.
  function idealTransfer(a, b) {
    const d = U.dist(a.pos, b.pos), acc = a.accelNominal();
    const rel = U.sub(a.vel, b.vel), rhat = U.norm(U.sub(b.pos, a.pos));
    const vc = U.dot(rel, rhat), side = Math.sqrt(Math.max(0, U.len(rel) * U.len(rel) - vc * vc));
    return 2 * Math.sqrt(Math.max(0, acc * d + (vc * vc) / 2)) - vc + side;
  }
  const OD = window.OD;
  const U = OD.U, P = OD.P;
  const $ = (id) => document.getElementById(id);
  OD.errors = [];
  window.addEventListener('error', (e) => { OD.errors.push(String(e.message || e)); });
  window.addEventListener('unhandledrejection', (e) => { OD.errors.push('rejection: ' + String(e.reason)); });
  const pref = (k, d) => { try { return localStorage.getItem(k) || d; } catch (e) { return d; } };

  const Game = {
    sim: null, cam: null, warp: 1, ctx: null, canvasCtx: null, selection: [], last: 0, outcomeShown: false, running: false, demo: null,

    init() {
      const canvas = $('view');
      OD.Render.init(canvas);
      this.canvasCtx = canvas.getContext('2d'); // the bridge console draws on the same context after the map (this.ctx is the scenario context)
      this.cam = new OD.Render.Camera();
      OD.UI.init(this);
      if (OD.Sound && typeof OD.Sound.init === 'function') { try { OD.Sound.init(); } catch (e) { /* optional */ } }
      this.input(canvas);
      // saved configurator designs become classes before any menu or campaign save reads them
      this.installDesigns();
      const boot = $('boot'); if (boot) boot.remove(); // the index.html splash, shown while the scripts loaded
      this.showMenu();
      requestAnimationFrame((t) => this.loop(t));
    },

    // ------------------------------------------------------------ living backgrounds
    // A quiet scene behind the menu: a corvette on a slow transfer over Callisto, a frigate keeping station.
    makeDemo() {
      const body = P.bodies.callisto;
      const sc = {
        name: 'demo', body, sunAngle: -0.8, playerFaction: 'JC',
        ships: [
          { id: 'demo1', name: 'JCS Larkspur', cls: 'corvette', faction: 'JC', orbit: { altitude: 1800e3, angle: 0.2 }, weaponsFree: false },
          { id: 'demo2', name: 'JCS Anselm', cls: 'frigate', faction: 'JC', orbit: { altitude: 1800e3, angle: 0.2 }, offset: { x: 120e3, y: -70e3 }, weaponsFree: false },
          { id: 'demo3', name: 'JCV Long Meridian', cls: 'freighter', faction: 'CIV', orbit: { altitude: 2600e3, angle: 0.75, velScale: 0.9 }, propFraction: 0.4 },
          { id: 'demo4', name: 'Valhalla Station', cls: 'station', faction: 'JC', orbit: { altitude: 1800e3, angle: -0.6 } },
        ],
        objectives: [], triggers: [],
      };
      const sim = new OD.Sim(sc);
      sim.setOrder('demo1', { type: 'intercept', target: 'demo3', range: 2000, vmax: 900 });
      sim.setOrder('demo2', { type: 'keeprange', target: 'demo1', range: 110e3, band: 0.4 });
      sim.step(20);
      return { sim, warp: 10, kind: 'menu', rebuild: () => this.makeDemo() };
    },
    // A preview of a chapter behind its briefing and the hangar: the same board, nobody acting yet.
    makePreview(scenario) {
      const sc = { ...scenario, ships: scenario.ships.map((s) => ({ ...s, ai: false, player: false, weaponsFree: false, target: null })), objectives: [], triggers: [], intro: [] };
      let sim;
      try { sim = new OD.Sim(sc); } catch (e) { OD.errors.push('preview: ' + e); return null; }
      return { sim, warp: 3, kind: 'preview', fitted: false, scenario };
    },
    // The part of the canvas the console leaves clear for the scene behind it.
    sceneRect() {
      if (OD.Bridge && OD.Bridge.active) return OD.Bridge.sceneRect();
      const w = this.cam.w || window.innerWidth, h = this.cam.h || window.innerHeight;
      return { x: w * 0.5, y: 0, w: w * 0.5, h };
    },
    demoFrame(dt) {
      const d = this.demo; if (!d) return;
      try { d.sim.step(Math.min(dt, 0.1) * d.warp); } catch (e) { OD.errors.push('demo: ' + (e.stack || e)); this.demo = null; return; }
      if (d.kind === 'menu') {
        if (d.sim.time > 2400 && d.rebuild) { this.demo = d.rebuild(); return; }
        const s = d.sim.byId('demo1');
        const zoom = 1.1e-3;
        this.cam.zoom = zoom; this.cam.follow = null;
        // The console sits left; keep the ship in the clear part, low, with Callisto's limb sweeping below it.
        const r = this.sceneRect();
        const w = this.cam.w || window.innerWidth, h = this.cam.h || window.innerHeight;
        const cx = r.x + r.w * 0.5, cy = r.y + r.h * 0.55;
        this.cam.x = s.pos.x - (cx - w / 2) / zoom;
        this.cam.y = s.pos.y + (cy - h / 2) / zoom;
      } else if (!d.fitted) {
        const r = this.sceneRect();
        this.cam.inset = { l: r.x, r: Math.max(0, this.cam.w - (r.x + r.w)), t: r.y, b: Math.max(0, this.cam.h - (r.y + r.h)) };
        this.cam.fit(d.sim.alive().map((s) => s.pos));
        d.fitted = true;
      }
    },

    // ------------------------------------------------------------ screens (drawn on the canvas by OD.Bridge)
    // Opens a bridge screen; any DOM screen (help, physics, hull view, configurator, campaign map) closes first.
    bridge(name, model) {
      OD.UI.closeScreen();
      OD.UI.showHud(false);
      this._domBridge = null;
      if (!OD.Bridge) return this.domBridge(name, model);
      return OD.Bridge.open(name, model);
    },
    leaveBridge() {
      if (OD.Bridge && OD.Bridge.active) OD.Bridge.close();
      if (this._domBridge && OD.UI.currentScreen === this._domBridge) OD.UI.closeScreen();
      this._domBridge = null;
    },
    // Without js/bridge.js the same screen models render as DOM screens (the v7 look): the text, numbered entries,
    // the keys as buttons, Esc on the esc key (or a hidden one for onBack), digits picking entries as before.
    domBridge(name, m) {
      m = m || {};
      const esc = (v) => U.escapeHtml(String(v == null ? '' : v));
      const acts = [];
      const btn = (o, cls, inner, hidden) => { const i = acts.push(o) - 1; return '<button type="button" data-bi="' + i + '"' + (cls ? ' class="' + cls + '"' : '') + (o.disabled || o.locked ? ' disabled' : '') + (o.esc ? ' data-esc' : '') + (hidden ? ' hidden' : '') + '>' + inner + '</button>'; };
      let h = '';
      if (m.eyebrow) h += '<div class="eyebrow">' + esc(m.eyebrow) + '</div>';
      h += name === 'menu' ? '<h1 class="title">Orbital<br>Declaration</h1>' : '<h2 class="title" style="font-size:34px' + (m.outcome === 'victory' ? ';color:var(--accent)' : m.outcome ? ';color:var(--crit)' : '') + '">' + esc(m.title || '') + '</h2>';
      if (m.meta) h += '<p class="sub" style="font-size:12px;color:var(--dim)">' + esc(m.meta) + '</p>';
      if (m.sub) h += '<p class="sub">' + esc(m.sub) + '</p>';
      for (const t of m.paragraphs || []) h += '<p class="sub">' + esc(t) + '</p>';
      if (m.sides && m.sides.length) h += '<p class="sub"><b>The two sides</b><br>' + m.sides.map((x) => '<b>' + esc(x.name) + '</b> ' + esc(x.text)).join('<br>') + '</p>';
      if (m.sofar && m.sofar.length) h += '<p class="sub"><b>The war so far</b><br>' + m.sofar.map((x) => esc(x.n + '. ' + x.text)).join('<br>') + '</p>';
      for (const c of m.comms || []) h += '<p class="sub">' + (c && c.speaker ? '<b>' + esc(c.speaker) + '</b> · ' : '') + esc(c && c.text != null ? c.text : c) + '</p>';
      if (m.body) h += '<p class="sub">' + esc(m.body) + '</p>';
      if (m.warLine) h += '<p class="sub">' + esc(m.warLine) + '</p>';
      if (m.objectives && m.objectives.length) h += '<p class="sub"><b>Objectives</b><br>' + m.objectives.map((o) => '· ' + esc(o.text)).join('<br>') + '</p>';
      if (m.ships && m.ships.length) h += '<p class="sub"><b>Ships</b><br>' + m.ships.map((s) => esc(s.name) + ' <span style="color:var(--dim)">' + esc(s.cls) + '</span>').join('<br>') + '</p>';
      if (m.stats && m.stats.length) h += '<p class="sub">' + m.stats.map((s) => esc(s.k) + ' <b>' + esc(s.v) + '</b>').join(' · ') + '</p>';
      if (m.reports && m.reports.length) h += '<p class="sub">' + m.reports.map((r) => '<b>' + esc(r.name) + '</b> ' + esc(r.text)).join('<br>') + '</p>';
      if (m.note) h += '<p class="sub" style="color:var(--dim)">' + esc(m.note) + '</p>';
      const rows = (m.entries || []).filter(Boolean).concat((m.chapters || []).map((c) => ({ label: c.n + '. ' + c.title, sub: c.sub + (c.done ? ' · done' : c.locked ? ' · locked' : ''), locked: c.locked, act: c.act })));
      if (rows.length) h += '<div class="menu-actions">' + rows.map((e) => btn(e, e.primary ? 'primary' : e.danger ? 'danger' : '', esc(e.label) + (e.sub ? '<small>' + esc(e.sub) + '</small>' : ''))).join('') + '</div>';
      const keys = (m.keys || []).filter(Boolean);
      if (keys.length) h += '<div class="actions">' + keys.map((k) => btn(k, k.primary ? 'primary' : '', esc(k.label) + (k.kbd ? '<kbd>' + esc(k.kbd) + '</kbd>' : ''))).join('') + '</div>';
      if (!keys.some((k) => k.esc) && typeof m.onBack === 'function') h += btn({ esc: true, act: m.onBack }, '', 'Back', true);
      const el = OD.UI.screen(name, h, { wide: name === 'briefing' || name === 'debrief' });
      this._domBridge = name;
      el.querySelectorAll('[data-bi]').forEach((b) => b.addEventListener('click', () => {
        const o = acts[+b.dataset.bi]; if (!o || o.disabled || o.locked || typeof o.act !== 'function') return;
        if (OD.Sound && OD.Sound.play) { try { OD.Sound.play(o.sound === 'confirm' ? 'key' : o.esc ? 'back' : 'key'); } catch (e) { /* optional */ } }
        o.act('dom');
      }));
      const first = el.querySelector('.actions button.primary, .menu-actions button.primary, .menu-actions button');
      if (first) { try { first.focus({ preventScroll: true }); } catch (e) { /* fine */ } }
      return m;
    },
    // help is a DOM screen; the console closes under it and the caller reopens its screen
    help(back) { this.leaveBridge(); OD.UI.help(back); },
    // Hulls on show in the main console: one every fourteen seconds.
    showcase: [
      { name: 'JCS Larkspur', cls: 'corvette', faction: 'JC' }, { name: 'JCS Anselm', cls: 'frigate', faction: 'JC' }, { name: 'JCS Bastion', cls: 'destroyer', faction: 'JC' },
      { name: 'JCS Harkness', cls: 'cruiser', faction: 'JC' }, { name: 'ISV Ardent', cls: 'lancer', faction: 'ISA' },
    ],
    showMenu() {
      this.running = false; this.sim = null;
      if (!this.demo || this.demo.kind !== 'menu') this.demo = this.makeDemo();
      const entries = [
        { label: 'Story', sub: 'The war, in eight chapters. Chapter 1 teaches you to fly.', primary: true, act: () => this.storySelect() },
        { label: 'Campaign', sub: 'Eleven places around Jupiter, one fleet. Damage carries between battles.', act: () => this.openCampaign() },
        { label: 'Skirmish', sub: 'Pick both fleets, where they meet and how far apart they start.', act: () => OD.Skirmish.screen(this) },
        OD.Configurator ? { label: 'Ship configurator', sub: 'Design a hull. Fly it in skirmish and buy it at campaign yards.', act: () => this.configurator() } : null,
        { label: 'How to play', sub: 'The controls and the ideas behind them, in two minutes.', act: () => this.help(() => this.showMenu()) },
      ].filter(Boolean);
      const show = this.showcase, t0 = performance.now();
      this.bridge('menu', {
        eyebrow: 'Jovian system · 2211',
        sub: 'The moons of Jupiter have left the Inner Systems Authority, and you have a corvette. Ships coast unless they burn, every burn spends delta-v, and the heat from the drive and the beams fills a sink until the radiators shed it. A drive plume shows across the system, so nothing out here hides.',
        entries,
        settings: {
          text: { value: () => OD.UI.textSize, set: (v) => OD.UI.setTextSize(v, true) },
          detail: { value: () => OD.UI.detail, set: (v) => OD.UI.setDetail(v, true) },
          sound: OD.Sound ? { value: () => !!OD.Sound.enabled, set: (v) => { OD.Sound.setEnabled(v); if (v && OD.Sound.unlock) OD.Sound.unlock(); } } : null,
        },
        get hull() { const spec = show[Math.floor((performance.now() - t0) / 14000) % show.length]; return { spec, caption: [spec.name, OD.Ships.CLASSES[spec.cls].name + ' · ' + OD.Ships.CLASSES[spec.cls].length + ' m'] }; },
        onBack: null,
      });
    },
    openCampaign() {
      this.leaveBridge();
      this.sim = null; this.running = false; this._refits = [];
      OD.UI.showHud(false);
      if (!this.demo || this.demo.kind !== 'menu') this.demo = this.makeDemo();
      OD.Campaign.screen(this);
    },
    storyProgress() { try { return JSON.parse(localStorage.getItem('od.story') || '{}'); } catch (e) { return {}; } },
    // The configurator (js/configurator.js, optional) renders itself into a root we give it. Its saved designs are
    // registered as classes (installSaved) so skirmish lists and campaign yards can use them.
    installDesigns() {
      const C = OD.Configurator; if (!C) return;
      try { if (typeof C.installSaved === 'function') C.installSaved(); else if (typeof C.install === 'function') C.install(); }
      catch (e) { OD.Render.lastError = 'configurator install: ' + (e && e.message); }
    },
    // Mounts the configurator in a DOM screen; opts.base / opts.designId pick the hull, the callbacks say where to go.
    mountConfigurator(opts) {
      this.leaveBridge();
      OD.UI.showHud(false);
      const el = OD.UI.screen('configurator', '<div id="cfgRoot"></div>', { wide: true });
      el.classList.add('fade-in');
      let ctrl = null;
      const leave = (next) => { try { if (ctrl && typeof ctrl.destroy === 'function') ctrl.destroy(); } catch (e) { /* theirs */ } ctrl = null; next(); };
      try {
        ctrl = OD.Configurator.mount(el.querySelector('#cfgRoot'), {
          designId: opts.designId, base: opts.base, faction: opts.faction || 'JC', detail: OD.UI.detail,
          onSave: (design) => { this.installDesigns(); if (opts.onSave) opts.onSave(design); },
          onFly: opts.onFly ? (design, scenario) => { this.installDesigns(); leave(() => opts.onFly(design, scenario)); } : undefined,
          onBack: () => leave(() => opts.onBack()),
          onDone: (design) => { this.installDesigns(); leave(() => (opts.onDone || opts.onBack)(design)); },
          onCancel: () => leave(() => opts.onBack()),
        }) || null;
      } catch (e) { OD.Render.lastError = 'configurator: ' + (e && e.message); OD.UI.toast('The configurator could not open.'); opts.onBack(); return; }
      // Esc leaves the yard unless the configurator put its own [data-esc] key in the root
      if (!el.querySelector('[data-esc]')) { const b = document.createElement('button'); b.hidden = true; b.dataset.esc = ''; b.addEventListener('click', () => leave(() => opts.onBack())); el.querySelector('.card').appendChild(b); }
    },
    configurator(designId) {
      if (!OD.Configurator || typeof OD.Configurator.mount !== 'function') { OD.UI.toast('The ship configurator is not loaded.'); return; }
      this.sim = null; this.running = false;
      if (!this.demo || this.demo.kind !== 'menu') this.demo = this.makeDemo();
      this.mountConfigurator({
        designId,
        onSave: (design) => OD.UI.toast((design && design.name ? design.name : 'Your design') + ' saved. It is in the skirmish lists and at the campaign yards now.', 4200),
        onFly: (design, scenario) => this.startScenario(scenario, { mode: 'Skirmish', onEnd: () => this.configurator(design && design.id), onBack: () => this.configurator(design && design.id) }),
        onBack: () => this.showMenu(),
      });
    },
    storySelect() {
      const prog = this.storyProgress();
      const done = prog.done || {};
      const chapters = OD.Story.chapters;
      this.sim = null; this.running = false;
      if (!this.demo || this.demo.kind !== 'menu') this.demo = this.makeDemo();
      this.bridge('chapters', {
        eyebrow: 'Story', title: 'Eight chapters',
        sub: 'Eight missions, March to July 2211. You start in the corvette Larkspur and finish in the cruiser Harkness.',
        chapters: chapters.map((c, i) => ({ n: c.n, title: c.title, sub: c.location + ' · ' + c.date + (i === 0 ? ' · guided tour' : ''), done: !!done[c.id], locked: !(i === 0 || done[chapters[i - 1].id] || prog.unlockAll), act: () => this.showBriefing(i) })),
        keys: [
          { id: 'k:war', label: 'The war so far', kbd: 'W', hot: 'w', act: () => this.showSituation({ back: () => this.storySelect(), backLabel: 'Back to the chapters' }) },
          { id: 'k:back', label: 'Back', kbd: 'Esc', esc: true, act: () => this.showMenu() },
        ],
        onBack: () => this.showMenu(),
      });
    },
    // The player's biggest warship in a scenario: the hull the briefing and the hangar turn on the stage.
    flagship(ships) {
      const own = (ships || []).filter((s) => s.player), war = own.filter((s) => (OD.Ships.CLASSES[s.cls] || {}).role !== 'station');
      return (war.length ? war : own).slice().sort((a, b) => ((OD.Ships.CLASSES[b.cls] || {}).length || 0) - ((OD.Ships.CLASSES[a.cls] || {}).length || 0))[0] || null;
    },
    shipList(scenario) {
      const rank = (s) => (s.player ? 0 : s.faction === scenario.playerFaction ? 1 : s.faction === 'CIV' ? 3 : 2);
      return scenario.ships.slice().sort((a, b) => rank(a) - rank(b)).map((s) => ({ name: s.name, cls: (OD.Ships.CLASSES[s.cls] || {}).role || s.cls, faction: s.faction }));
    },
    // The war in plain words: who you are, who you are fighting, why, and what each chapter so far changed.
    // Shown before chapter 1's briefing every time chapter 1 is started, from the chapters screen ("The war so
    // far") and from the pause screen during a story chapter.
    showSituation(opts) {
      opts = opts || {};
      const S = OD.Story || {};
      const prog = this.storyProgress(), done = prog.done || {};
      // one line per chapter already won, in order, so the screen says where the war stands
      const sofar = [];
      if (typeof S.warSoFar === 'function') {
        for (const c of S.chapters || []) {
          if (!done[c.id]) continue;
          if (opts.chapter != null && c.n > opts.chapter + 1) continue;
          const line = S.warSoFar(c.n, 'victory');
          if (line) sofar.push({ n: c.n, title: c.title, text: line, outcome: 'victory' });
        }
      }
      const back = opts.back || (() => this.storySelect());
      const next = opts.next || null;
      if (!this.sim && (!this.demo || this.demo.kind !== 'menu')) this.demo = this.makeDemo();
      this.bridge('situation', {
        mode: 'Situation', eyebrow: 'Jovian system · 2211', title: 'The war', meta: 'The Compact against the Authority',
        paragraphs: (S.situation || []).slice(),
        sides: S.sides || [],
        sofar, sofarTitle: 'The war so far',
        note: sofar.length ? '' : (opts.chapter == null || opts.chapter === 0 ? 'Chapter 1 is a fortnight before the Declaration. Nobody is shooting yet.' : ''),
        flagship: { name: 'JCS Larkspur', cls: 'corvette', faction: 'JC' },
        flagshipCaption: ['JCS Larkspur', (OD.Ships.CLASSES.corvette || {}).name || 'corvette'],
        keys: [
          { id: 'k:next', label: next ? (opts.nextLabel || 'Continue') : (opts.backLabel || 'Back'), kbd: '⏎', primary: true, enter: true, esc: !next, sound: 'confirm', act: next || back },
          next ? { id: 'k:back', label: 'Back', kbd: 'Esc', esc: true, act: back } : null,
        ].filter(Boolean),
        onBack: back,
      });
    },
    showBriefing(i, opts) {
      // chapter 1 is where a newcomer starts: the situation comes first, every time
      if (i === 0 && !(opts && opts.skipSituation)) { this.showSituation({ back: () => this.storySelect(), next: () => this.showBriefing(0, { skipSituation: true }) }); return; }
      const c = OD.Story.chapters[i];
      const scenario = c.build();
      this.sim = null; this.running = false;
      this.demo = this.makePreview(scenario);
      const flag = this.flagship(scenario.ships);
      this.bridge('briefing', {
        mode: 'Briefing', eyebrow: 'Chapter ' + c.n + ' of 8', title: c.title, meta: c.location + ' · ' + c.date,
        paragraphs: c.brief, comms: c.comms, objectives: scenario.objectives.filter((o) => !o.hidden), ships: this.shipList(scenario),
        flagship: flag, flagshipCaption: flag ? [flag.name, OD.Ships.CLASSES[flag.cls].name] : [],
        keys: [
          { id: 'k:launch', label: 'Launch', kbd: '⏎', primary: true, enter: true, sound: 'confirm', act: () => this.startScenario(scenario, { mode: 'Story', chapter: i }) },
          { id: 'k:back', label: 'Back', kbd: 'Esc', esc: true, act: () => this.storySelect() },
        ],
        onBack: () => this.storySelect(),
      });
    },
    // ---- the hangar: every start passes through it (Inspect, Refit, Launch, Back) ----
    hangarShips(scenario) {
      const own = scenario.ships.filter((s) => s.player);
      return own.length ? own : scenario.ships.filter((s) => s.faction === scenario.playerFaction && (OD.Ships.CLASSES[s.cls] || {}).role !== 'station');
    },
    // Requisition cost of a class: the campaign's own table, the configurator's price for a design, a dry-mass curve as fallback.
    classCost(cls) {
      const COST = { corvette: 40, frigate: 70, destroyer: 120, lancer: 55, cruiser: 260 };
      if (COST[cls]) return COST[cls];
      const d = OD.Ships.CLASSES[cls] || {};
      if (OD.Configurator && typeof OD.Configurator.cost === 'function') { try { const c = OD.Configurator.cost(d); if (isFinite(c) && c > 0) return Math.round(c); } catch (e) { /* fall through */ } }
      return Math.round((40 * Math.pow(d.dryMass / 900e3 || 1, 0.68)) / 5) * 5;
    },
    // Whether a refit is on offer here, and the line under the keys that says so.
    refitInfo(ctx) {
      if (!OD.Configurator || typeof OD.Configurator.mount !== 'function') return { ok: false, note: '' };
      if (ctx.mode !== 'Campaign') return { ok: true, note: 'Refit opens the yard on this hull. A saved design of the same hull family flies in this ship\'s place for one mission, and she keeps her name.' };
      const st = OD.Campaign && OD.Campaign.load ? OD.Campaign.load() : null;
      if (!st) return { ok: false, note: '' };
      const node = (OD.Campaign.NODES || []).find((n) => n.id === st.fleetAt), rec = st.nodes && st.nodes[st.fleetAt];
      const own = rec && rec.owner === 'JC', yard = node && (node.kind === 'yard' || node.kind === 'port');
      if (!node || !own || !yard) return { ok: false, note: 'Refits are done at a Compact yard or port. ' + (node ? node.name.split(' · ')[0] + (own ? ' has no slipway.' : ' is not ours.') : '') };
      const spent = (this._refits || []).reduce((a, r) => a + r.cost, 0);
      return { ok: true, note: 'A refit here costs the requisition difference. ' + (st.rp - spent) + ' RP available.', rp: st.rp - spent, state: st };
    },
    openHangar(scenario, ctx, sel) {
      this.sim = null; this.running = false;
      if (!this.demo || this.demo.kind !== 'preview' || this.demo.scenario !== scenario || this.demo.stale) this.demo = this.makePreview(scenario);
      const own = this.hangarShips(scenario);
      if (!this._hangar || this._hangar.scenario !== scenario) this._refits = []; // a refit ledger belongs to one hangar visit
      const h = this._hangar = { scenario, ctx, sel: Math.max(0, Math.min(own.length - 1, sel || 0)) };
      const refit = this.refitInfo(ctx);
      const model = {
        eyebrow: 'Pre-launch · ' + ctx.mode + (ctx.chapter != null ? ' · chapter ' + (ctx.chapter + 1) : ''), title: scenario.name,
        ships: own, sel: h.sel, onSelect: (i) => { h.sel = i; model.sel = i; },
        note: refit.note,
        keys: [
          { id: 'k:inspect', label: 'Inspect', kbd: 'I', hot: 'i', act: () => this.inspect(h.sel) },
          refit.ok ? { id: 'k:refit', label: 'Refit', kbd: 'R', hot: 'r', act: () => this.refit(h.sel) } : null,
          ctx.fleetRefit ? { id: 'k:launch', label: 'Back to the map', kbd: '⏎', primary: true, enter: true, esc: true, sound: 'confirm', act: () => this.commitFleetRefit() }
            : { id: 'k:launch', label: 'Launch', kbd: '⏎', primary: true, enter: true, sound: 'confirm', disabled: !own.length, act: () => this.startScenario(scenario, { ...ctx, hangarDone: true }) },
          ctx.fleetRefit ? null : { id: 'k:back', label: 'Back', kbd: 'Esc', esc: true, act: () => this.hangarBack(ctx) },
        ],
        onBack: () => this.hangarBack(ctx),
      };
      this.bridge('hangar', model);
    },
    // The fleet in the hangar at an owned yard or port, between battles: refits are paid and written to the save on the way out.
    // The campaign map's yard panel calls this next to Buy.
    refitFleet(state) {
      state = state || (OD.Campaign && OD.Campaign.load ? OD.Campaign.load() : null);
      if (!state || !OD.Campaign) return false;
      const def = (OD.Campaign.NODES || []).find((n) => n.id === state.fleetAt);
      const scenario = { name: (def ? def.name.split(' · ')[0] : 'Fleet') + ' · slipway', playerFaction: 'JC', objectives: [], ships: (state.fleet || []).map((f) => ({ id: f.id, name: f.name, cls: f.cls, faction: 'JC', player: true, propFraction: f.propFraction, hull: f.hull, systems: { ...(f.systems || {}) }, pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 } })) };
      if (!scenario.ships.length) { OD.UI.toast('No ships to refit.'); return false; }
      this._hangar = null; this._refits = [];
      this.openHangar(scenario, { mode: 'Campaign', fleetRefit: true });
      return true;
    },
    commitFleetRefit() {
      const refits = this._refits || []; this._refits = []; this._hangar = null;
      const st = OD.Campaign && OD.Campaign.load ? OD.Campaign.load() : null;
      if (st && refits.length) {
        let spent = 0;
        for (const r of refits) { const f = (st.fleet || []).find((x) => x.id === r.id); if (f) { f.cls = r.cls; spent += r.cost; } }
        st.rp = Math.max(0, (st.rp || 0) - spent);
        st.log.push('Refit paid: ' + spent + ' RP.');
        OD.Campaign.save(st);
      }
      this.openCampaign();
    },
    hangarBack(ctx) {
      if (ctx.fleetRefit) { this.commitFleetRefit(); return; }
      this._refits = []; this._hangar = null; // nothing flown, nothing charged
      if (ctx.onBack) ctx.onBack();
      else if (ctx.mode === 'Story' && ctx.chapter != null) this.showBriefing(ctx.chapter);
      else if (ctx.mode === 'Campaign') this.openCampaign();
      else if (ctx.mode === 'Skirmish') OD.Skirmish.screen(this);
      else this.showMenu();
    },
    inspect(i) {
      const h = this._hangar; if (!h) return;
      const own = this.hangarShips(h.scenario); if (!own.length) return;
      i = ((i % own.length) + own.length) % own.length; h.sel = i;
      const spec = own[i], cls = OD.Ships.CLASSES[spec.cls] || {};
      const back = () => this.openHangar(h.scenario, h.ctx, h.sel);
      this.bridge('inspect', {
        ship: spec, eyebrow: 'Hull view · ' + (i + 1) + ' of ' + own.length, title: spec.name, sub: (cls.name || spec.cls) + '. ' + (cls.blurb || ''), view: 'three-quarter',
        keys: [
          own.length > 1 ? { id: 'k:prev', label: '◀ Prev', kbd: '[', hot: '[', act: () => this.inspect(i - 1) } : null,
          own.length > 1 ? { id: 'k:next', label: 'Next ▶', kbd: ']', hot: ']', act: () => this.inspect(i + 1) } : null,
          { id: 'k:back', label: 'Back to the hangar', kbd: 'Esc', esc: true, act: back },
        ],
        onBack: back,
      });
    },
    hullFamily(cls) { const c = OD.Ships.CLASSES[cls] || {}; return c.base || c.artBase || cls; },
    // Refit: the configurator on this ship's hull; a saved design of the same family replaces the class for this mission.
    refit(i) {
      const h = this._hangar; if (!h || !OD.Configurator) return;
      const own = this.hangarShips(h.scenario), spec = own[i]; if (!spec) return;
      const cls = OD.Ships.CLASSES[spec.cls] || {}, base = this.hullFamily(spec.cls);
      const back = () => this.openHangar(h.scenario, h.ctx, i);
      const apply = (design) => {
        this.installDesigns();
        if (!design || !design.id || !OD.Ships.CLASSES[design.id]) return false;
        const fam = design.base || design.artBase || design.id;
        if (fam !== base) { OD.UI.toast(spec.name + ' is a ' + base + ' hull; ' + (design.name || 'that design') + ' is built on a ' + fam + '. Refits keep to the hull family.', 4500); return false; }
        if (design.id === spec.cls) return true;
        if (h.ctx.mode === 'Campaign') {
          const info = this.refitInfo(h.ctx); if (!info.ok) { OD.UI.toast(info.note); return false; }
          const cost = Math.max(0, this.classCost(design.id) - this.classCost(spec._stockCls || spec.cls));
          if (cost > info.rp) { OD.UI.toast('That refit costs ' + cost + ' RP and you have ' + info.rp + '.', 4000); return false; }
          this._refits = (this._refits || []).filter((r) => r.id !== spec.id);
          this._refits.push({ id: spec.id, cls: design.id, cost });
        }
        if (!spec._stockCls) spec._stockCls = spec.cls;
        spec.cls = design.id; spec._refit = true; // name and id stay; the mission flies the design
        if (this.demo) this.demo.stale = true;
        OD.UI.toast(spec.name + ' refitted as ' + (design.name || design.id) + ' for this mission.', 3500);
        return true;
      };
      this.mountConfigurator({
        base, designId: cls.custom ? spec.cls : undefined, faction: spec.faction || 'JC',
        onSave: (design) => { apply(design); },
        onDone: (design) => { apply(design); back(); },
        onBack: back,
      });
    },
    // Campaign refits are paid and written to the fleet record once the battle has been applied to the save.
    commitRefits(ctx) {
      const refits = this._refits || []; this._refits = [];
      if (ctx.mode !== 'Campaign' || !refits.length || !OD.Campaign || !OD.Campaign.load) return;
      const orig = ctx.onEnd;
      ctx.onEnd = (outcome, sim) => {
        if (orig) orig(outcome, sim);
        const st = OD.Campaign.load(); if (!st) return;
        let spent = 0;
        for (const r of refits) { const f = (st.fleet || []).find((x) => x.id === r.id); if (f) { f.cls = r.cls; spent += r.cost; } }
        st.rp = Math.max(0, (st.rp || 0) - spent);
        if (spent) st.log.push('Refit paid: ' + spent + ' RP.');
        OD.Campaign.save(st);
        if (OD.UI.currentScreen === 'campaign') OD.Campaign.screen(this, st);
      };
    },
    startScenario(scenario, ctx) {
      ctx = ctx || { mode: 'Skirmish' };
      if (ctx.brief && !ctx.briefShown) {
        // a campaign battle: its brief, then the hangar, then the fight
        this.sim = null; this.running = false;
        this.demo = this.makePreview(scenario);
        const flag = this.flagship(scenario.ships);
        this.bridge('briefing', {
          mode: ctx.mode, eyebrow: ctx.mode, title: ctx.brief.title, meta: ctx.brief.meta || '', paragraphs: ctx.brief.text, comms: [],
          objectives: scenario.objectives.filter((o) => !o.hidden), ships: this.shipList(scenario), flagship: flag, flagshipCaption: flag ? [flag.name, OD.Ships.CLASSES[flag.cls].name] : [],
          keys: [
            { id: 'k:launch', label: 'Engage', kbd: '⏎', primary: true, enter: true, sound: 'confirm', act: () => this.startScenario(scenario, { ...ctx, briefShown: true }) },
            ctx.mode === 'Campaign' ? { id: 'k:back', label: 'Back to the map', kbd: 'Esc', esc: true, act: () => this.openCampaign() } : null,
          ],
          onBack: ctx.mode === 'Campaign' ? () => this.openCampaign() : null,
        });
        return;
      }
      if (!ctx.hangarDone && ctx.mode !== 'Harness' && OD.Bridge) { this.openHangar(scenario, ctx); return; }
      this.ctx = ctx;
      this.commitRefits(ctx);
      this.demo = null; this._hangar = null;
      this.leaveBridge();
      OD.UI.reset();
      this.sim = new OD.Sim(scenario);
      this.selection = [];
      this.outcomeShown = false;
      this._slowed = {}; this._missToast = false; this._lastComms = null; this._lastAlert = null; this._pausedWarp = null;
      OD.UI.closeScreen();
      OD.UI.showHud(true);
      OD.UI.setDetail(pref('od.detail', 'essentials'));
      OD.UI.setTitle(this.ctx.mode + (this.ctx.chapter != null ? ' · ' + (this.ctx.chapter + 1) : ''), scenario.name);
      OD.UI.resetLog(this.sim);
      // The ideal transfer for the first rendezvous, so the debrief can say how close the flying came to it.
      const rv = (scenario.objectives || []).find((o) => o.type === 'rendezvous');
      if (rv) { const a = this.sim.resolveShip(rv.ship), b = this.sim.byId(rv.target); if (a && b) this.ctx.idealDv = idealTransfer(a, b); this.ctx.idealShip = a && a.id; this.ctx.idealObj = rv; this.ctx.firstDv = null; }
      const first = this.sim.playerShips().find((s) => s.role !== 'station') || this.sim.playerShips()[0];
      if (first) this.select(first.id);
      this.fitAll();
      this.setWarp(1);
      this.running = true;
    },
    endScenario() {
      const sim = this.sim, ctx = this.ctx;
      const outcome = sim.outcome;
      // the whole side, escorts and freighters included (a prize taken this fight is theirs, not ours to report)
      const own = sim.ships.filter((s) => s.faction === sim.playerFaction && !s.captured && s.role !== 'station');
      const dv = own.reduce((a, s) => a + s.stats.dvSpent, 0), lost = own.filter((s) => s.destroyed || s.captured || s.disabled).length, prizes = sim.ships.filter((s) => s.captured && s.faction === sim.playerFaction).length;
      const stats = [
        { k: 'Mission time', v: U.fmt.time(sim.time), n: sim.time, f: U.fmt.time },
        { k: 'Delta-v spent', v: U.fmt.dv(dv), n: dv, f: U.fmt.dv },
        { k: 'Ships lost or out of the fight', v: String(lost), n: lost, f: (x) => String(Math.round(x)) },
        { k: 'Prizes taken', v: String(prizes), n: prizes, f: (x) => String(Math.round(x)) },
      ];
      // the crew (v13): wounded and lost across our hulls, only when there were any
      { const w = own.reduce((a, s) => a + (s.crew ? Math.round(s.crew.wounded || 0) : 0), 0), l = own.reduce((a, s) => a + (s.crew ? Math.round(s.crew.lost || 0) : 0), 0);
        if (w + l > 0) stats.push({ k: 'Crew', v: [w > 0 ? w + ' wounded' : '', l > 0 ? l + ' lost' : ''].filter(Boolean).join(', '), n: w + l, f: (x) => String(Math.round(x)) }); }
      if (ctx.idealDv && ctx.firstDv != null) stats.push({ k: 'First transfer', v: U.fmt.dv(ctx.firstDv) + ' · textbook ' + U.fmt.dv(ctx.idealDv) + ' in flat space' });
      // one line per player ship from the damage module: the parts that are not sound
      const reports = own.map((s) => {
        let bad = [];
        if (OD.Damage && typeof OD.Damage.report === 'function') { try { bad = (OD.Damage.report(s) || []).filter((r) => r.state !== 'ok'); } catch (e) { bad = []; } }
        const parts = bad.slice(0, 3).map((r) => r.name + ' ' + r.state).join(' · ') + (bad.length > 3 ? ' · ' + (bad.length - 3) + ' more' : '');
        // the people (v13): wounded and lost this fight, from the crew record
        const c = s.crew, people = c && (c.wounded > 0 || c.lost > 0) ? ' · ' + [c.wounded > 0 ? Math.round(c.wounded) + ' wounded' : '', c.lost > 0 ? Math.round(c.lost) + ' lost' : ''].filter(Boolean).join(', ') : '';
        const text = s.destroyed ? 'lost' : (s.captured ? 'taken by a boarding party' : (parts || (s.hull < 0.995 ? 'armour and hull only' : 'no damage')) + ' · hull ' + Math.round(s.hull * 100) + ' %' + people);
        return { name: s.name, text, hurt: bad.length > 0 || s.hull < 0.999 || !!people, lost: s.destroyed || s.captured };
      });
      // every objective with its state, and the one line that says what lost it
      const objectives = (sim.objectives || []).map((o) => ({ text: o.text, state: o.failed ? 'failed' : o.done ? 'done' : 'open', optional: !!o.optional }));
      let why = '';
      const failed = (sim.objectives || []).find((o) => o.failed && !o.optional);
      if (failed) {
        // the hull the objective was about, or its target when that is the one that is gone (a rendezvous
        // fails when the tanker hits the moon, not when our corvette does)
        const gone = (s) => !!(s && (s.destroyed || s.captured || s.disabled));
        const own = failed.ship ? sim.byId(failed.ship) : null, tgt = failed.target ? sim.byId(failed.target) : null;
        const sh = gone(own) ? own : gone(tgt) ? tgt : null;
        const word = sh ? (sh.destroyed ? (sh.lostHow || 'was destroyed') : sh.captured ? 'was boarded and taken' : 'was disabled') : '';
        why = 'Lost at ' + U.fmt.time(failed.failedAt != null ? failed.failedAt : sim.time) + (sh ? ', when ' + sh.name + ' ' + word : ', when the objective "' + failed.text + '" failed') + '.';
      } else if (outcome === 'defeat') {
        const gone = own.filter((s) => s.destroyed || s.captured || s.disabled);
        why = gone.length ? 'Lost at ' + U.fmt.time(sim.time) + '. ' + gone.map((s) => s.name).join(', ') + (gone.length > 1 ? ' were' : ' was') + ' out of the fight, with no ship left to finish the mission.' : '';
      }
      let body = '', warLine = '', next = '', keys = [], model = null;
      if (ctx.mode === 'Story') {
        const c = OD.Story.chapters[ctx.chapter];
        body = outcome === 'victory' ? c.victory : c.defeat;
        if (typeof OD.Story.warSoFar === 'function') warLine = OD.Story.warSoFar(c.n, outcome) || '';
        if (outcome === 'victory') { const p = this.storyProgress(); p.done = p.done || {}; p.done[c.id] = true; try { localStorage.setItem('od.story', JSON.stringify(p)); } catch (e) { /* ignore */ } }
        // v12: a win points at the next chapter by name, place and date, with the first line of its brief
        const nc = outcome === 'victory' && ctx.chapter < 7 ? OD.Story.chapters[ctx.chapter + 1] : null;
        if (nc) {
          const first = Array.isArray(nc.brief) && nc.brief.length ? String(nc.brief[0]).split(/(?<=\.)\s+/)[0] : '';
          next = 'Next: ' + nc.title + (nc.location ? ' · ' + nc.location : '') + (nc.date ? ' · ' + nc.date : '') + (first ? '. ' + first : '');
        }
        keys = [
          nc ? { id: 'k:next', label: 'Next: ' + nc.title, kbd: '⏎', primary: true, enter: true, act: () => this.showBriefing(ctx.chapter + 1) } : null,
          { id: 'k:retry', label: outcome === 'victory' ? 'Replay' : 'Retry', primary: !nc, enter: !nc, act: () => this.showBriefing(ctx.chapter) },
          { id: 'k:war', label: 'The war so far', kbd: 'W', hot: 'w', act: () => this.showSituation({ chapter: ctx.chapter, backLabel: 'Back to the debrief', back: () => { if (model) this.bridge('debrief', model); } }) },
          { id: 'k:chapters', label: 'Chapters', kbd: 'Esc', esc: true, act: () => this.storySelect() },
        ];
      } else {
        // Continue fires once: the console closes and the sim is dropped before the campaign map (a DOM screen) opens
        keys = [{ id: 'k:cont', label: 'Continue', kbd: '⏎', primary: true, enter: true, esc: true, act: () => { const f = ctx.onEnd; ctx.onEnd = null; this.leaveBridge(); this.sim = null; this.running = false; if (f) f(outcome, sim); else this.showMenu(); } }];
      }
      this.running = false;
      model = {
        eyebrow: ctx.mode + ' · debrief', outcome, title: outcome === 'victory' ? 'Objectives complete' : 'Mission lost', body, warLine, next, why, objectives, stats, reports, keys,
        onBack: () => { const k = keys.find((x) => x && x.esc); if (k) k.act(); },
      };
      this.bridge('debrief', model);
    },
    pauseMenu() {
      if (!this.sim || (OD.Bridge && OD.Bridge.active)) return;
      // the warp the player was running, kept across a trip to How to play (which re-enters here at warp 0)
      if (this.warp > 0) this._pausedWarp = this.warp;
      const w = this._pausedWarp || 1; this.setWarp(0);
      const resume = () => { this.leaveBridge(); OD.UI.showHud(true); this._pausedWarp = null; this.setWarp(w); };
      const ctx = this.ctx || {};
      const story = ctx.mode === 'Story' && ctx.chapter != null && !!OD.Story; // campaign and skirmish have no chapter to place
      this.bridge('pause', {
        eyebrow: 'Paused', title: this.sim.name, sub: (ctx.mode || '') + (ctx.chapter != null ? ' · chapter ' + (ctx.chapter + 1) : '') + ' · ship time ' + U.fmt.clock(this.sim.time),
        entries: [
          { label: 'Resume', sub: 'Back to the mission at ' + (w === 1 ? 'real time' : w + '\u00d7') + '.', primary: true, act: resume },
          story ? { label: 'Situation', sub: 'Who you are fighting and why, and where the war stands now.', act: () => this.showSituation({ chapter: ctx.chapter, backLabel: 'Back to the pause menu', back: () => { this.leaveBridge(); this.pauseMenu(); } }) } : null,
          { label: 'How to play', sub: 'The controls and the ideas behind them, in two minutes.', act: () => this.help(() => this.pauseMenu()) },
          { label: 'Abandon mission', sub: ctx.mode === 'Campaign' ? 'Counts as a defeat. Damage taken so far stays on the fleet.' : 'Back to the main console.', danger: true, act: () => { this.leaveBridge(); this.running = false; const f = ctx.onEnd, sim = this.sim; if (ctx.mode === 'Campaign' && f) { ctx.onEnd = null; sim.outcome = 'defeat'; this.sim = null; f('defeat', sim); } else this.showMenu(); } },
        ].filter(Boolean),
        onBack: resume,
      });
    },

    // ------------------------------------------------------------ control
    setWarp(w) { this.warp = w; OD.UI.setWarp(w); this._warpBefore = 0; },
    // An alarm pulls time back to 1× so it is not missed, and gives it back a few seconds later unless the player
    // moved the warp or the fight ended: time compression is otherwise one-way and a fight is played at 1×.
    pullWarp(w = 1, holdMs = 8000) {
      const prev = this.warp;
      if (prev <= w) return; // already held: a second alarm inside the hold does not push the return out again
      this.setWarp(w);
      this._warpBefore = prev; this._warpRestoreAt = performance.now() + holdMs;
    },
    // The selected ship drifting off the map with nobody panning is an empty map twenty minutes in: after ten
    // seconds off screen (and half a minute since the last drag) the view refits everyone.
    // The fight has to stay in frame: the selected ship, the hull she is fighting (at the position we draw her,
    // the ghost) and every hostile inside twice the larger bite are watched; if any is off the free part of the
    // map for ten seconds, or the whole group has shrunk into a corner of it, the view refits.
    keepShipsOnMap(now) {
      if (!this.sim || this.cam.follow || (OD.Bridge && OD.Bridge.active)) { this._offMapSince = 0; return; }
      const sim = this.sim;
      // nothing selected yet (a scripted run): the first of ours stands in
      const s = (OD.UI.selected && sim.byId(OD.UI.selected)) || sim.playerShips().find((o) => !o.destroyed) || null;
      if (!s || s.destroyed) { this._offMapSince = 0; return; }
      const w = this.cam.w || 1, h = this.cam.h || 1, ins = this.cam.inset || { l: 0, r: 0, t: 0, b: 0 };
      const x0 = (ins.l || 0) + 12, x1 = w - (ins.r || 0) - 12, y0 = (ins.t || 0) + 12, y1 = h - (ins.b || 0) - 12;
      const watch = [s];
      const t = s.target ? sim.byId(s.target) : null; if (t && !t.destroyed) watch.push(t);
      try { for (const o of sim.hostiles(s)) if (!o.destroyed && watch.indexOf(o) < 0 && OD.U.dist(o.pos, s.pos) < 2500e3) watch.push(o); } catch (e) { /* the selected ship alone */ }
      // a hull a hint is pointing at ('click JCV Long Meridian') has to be visible now, not in ten seconds
      let marked = null;
      try { const m = OD.Guide && OD.Guide.mark; if (m && m.shipId) { marked = sim.byId(m.shipId); if (marked && !marked.destroyed && watch.indexOf(marked) < 0) watch.push(marked); } } catch (e) { marked = null; }
      const scr = (o) => { const p = this.viewPos(o); return { x: (p.x - this.cam.x) * this.cam.zoom + w / 2, y: h / 2 - (p.y - this.cam.y) * this.cam.zoom }; };
      const pts = watch.map(scr);
      const inside = (p) => p.x > x0 && p.x < x1 && p.y > y0 && p.y < y1;
      let on = pts.every(inside);
      if (marked && !on && sim.time - (this._markFitAt || -1e9) > 30 && now - (this._pannedAt || -1e9) > 5000) {
        const mp = scr(marked);
        if (!inside(mp)) { this._markFitAt = sim.time; this._offMapSince = 0; this.cam.inset = this.hudInset(); this.cam.fit(watch.map((o) => this.viewPos(o)), 0.5); return; }
      }
      // a band or panel that has just grown over the map (a decision opening on a phone covers half of it): refit now
      const ft = ins.t || 0, fb = ins.b || 0;
      const grew = this._lastFree != null && (Math.abs(ft - this._lastFree[0]) > 60 || Math.abs(fb - this._lastFree[1]) > 60); this._lastFree = [ft, fb];
      if (grew && !on && now - (this._pannedAt || -1e9) > 5000) { this._offMapSince = 0; this._autoFitAt = sim.time; this.cam.fit(watch.map((o) => this.viewPos(o)), 0.5); return; }
      if (on && pts.length > 1) {
        // all in frame but huddled: the group spans under a quarter of the free rectangle both ways
        const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
        const spanX = Math.max(...xs) - Math.min(...xs), spanY = Math.max(...ys) - Math.min(...ys);
        // (at most once every two minutes of sim time, so a fit that lands the group small does not repeat)
        if (spanX < (x1 - x0) * 0.25 && spanY < (y1 - y0) * 0.25 && sim.time - (this._autoFitAt || -1e9) > 120) on = false;
      }
      if (on) { this._offMapSince = 0; return; }
      const quiet = now - (this._pannedAt || -1e9) > 30000; // the player has not touched the map for half a minute
      // A band that has just opened over the ship alone: pan at once so she sits in the clear part (no fit, same zoom).
      if (pts.length === 1 && document.body.classList.contains('decision-open') && quiet && this.cam.zoom > 0) {
        const fx = ((ins.l || 0) + (w - (ins.r || 0))) / 2, fy = ((ins.t || 0) + (h - (ins.b || 0))) / 2;
        this.cam.x = s.pos.x - (fx - w / 2) / this.cam.zoom; this.cam.y = s.pos.y + (fy - h / 2) / this.cam.zoom;
        this._offMapSince = 0; return;
      }
      // the wait is in sim time, so it holds at any warp and in a scripted run alike
      if (!this._offMapSince) { this._offMapSince = sim.time || 1e-6; return; }
      if (sim.time - this._offMapSince > 10 && quiet) {
        this._offMapSince = 0; this._autoFitAt = sim.time;
        this.cam.inset = this.hudInset(); this.cam.fit(watch.map((o) => this.viewPos(o)), 0.5); // room to move before the next refit
      }
    },
    // v12: once a zoom-in draws a hull at 10 px the screen spans a few tens of kilometres, so the player is looking
    // at a ship, and at that scale a corvette at 2.8 km/s leaves a free frame in seconds. The camera follows the
    // selected ship if she is on screen; else the on-screen hull nearest the point the zoom was aimed at; else
    // the selected ship wherever she is, since a wheel aimed at empty space has already lost her. F releases the
    // follow, as always.
    followAtArtZoom(px, py) {
      if (!this.sim || this.cam.follow) return;
      const cam = this.cam, m = 24;
      const onScreen = (s) => { let p; try { p = cam.toScreen(OD.Render.viewOf ? OD.Render.viewOf(this.sim, s).pos : s.pos); } catch (e) { p = cam.toScreen(s.pos); } return p.x > -m && p.x < cam.w + m && p.y > -m && p.y < cam.h + m ? p : null; };
      const big = (s) => s && !s.destroyed && (s.length || 100) * cam.zoom >= 10;
      const sel = this.sim.byId(OD.UI.selected);
      let s = big(sel) && onScreen(sel) ? sel : null;
      if (!s) {
        let best = Infinity;
        for (const o of this.sim.ships) { if (!big(o)) continue; const q = onScreen(o); if (!q) continue; const d = Math.hypot(q.x - (px != null ? px : cam.w / 2), q.y - (py != null ? py : cam.h / 2)); if (d < best) { best = d; s = o; } }
      }
      if (!s && big(sel)) s = sel;
      if (!s) return;
      cam.follow = s.id; this._followedAtZoom = true;
      if (OD.UI.toast) OD.UI.toast('Following ' + s.name + ' at this zoom. F releases her.', 3500);
    },
    restoreWarp(now) {
      if (!this._warpBefore || now < this._warpRestoreAt) return;
      const w = this._warpBefore; this._warpBefore = 0;
      if (this.warp === 1 && this.sim && !this.sim.outcome && (!OD.UI.currentScreen || OD.UI.currentScreen === 'hull') && !document.body.classList.contains('decision-open')) this.setWarp(w);
    },
    hudInset() {
      // Canvas pixels the HUD panels cover on each side, so a fit lands in the clear middle.
      const r = (id) => { const el = document.getElementById(id); return el && !el.hidden ? el.getBoundingClientRect() : null; };
      const k = this.cam.w / Math.max(1, window.innerWidth);
      const fleet = r('fleet'), ship = r('shipPanel'), top = r('topbar'), bottom = r('bottom');
      const ins = { l: 0, r: 0, t: 0, b: 0 };
      if (top) ins.t = top.bottom * k;
      if (bottom && bottom.height > 0) ins.b = Math.max(0, window.innerHeight - bottom.top) * k;
      // an open decision or hint band on the laptop layout covers the map above the log: keep the framing clear of it
      const band = r('decision') || r('hint');
      if (band && band.height > 0) { if (band.top > window.innerHeight * 0.4) ins.b = Math.max(ins.b, (window.innerHeight - band.top) * k); else ins.t = Math.max(ins.t, band.bottom * k); }
      const toastEl = r('toast');
      if (toastEl && toastEl.height > 0 && toastEl.bottom < window.innerHeight * 0.4) ins.t = Math.max(ins.t, toastEl.bottom * k);
      // a panel the layout has hidden (display: none) measures 0 × 0 and covers nothing
      if (fleet && fleet.width > 0 && fleet.height > 0 && fleet.width < window.innerWidth * 0.45) ins.l = fleet.right * k;
      if (ship && ship.width > 0 && ship.height > 0 && ship.width < window.innerWidth * 0.45) ins.r = Math.max(0, window.innerWidth - ship.left) * k;
      // the phone layout stacks the panel under the map: it is a bottom inset there, not a side one
      else if (ship && ship.height > 0 && ship.top > window.innerHeight * 0.4) ins.b = Math.max(ins.b, (window.innerHeight - ship.top) * k);
      return ins;
    },
    // Where we draw a hull: the truth for our own side, the ghost of our track for anyone else.
    viewPos(o) {
      if (!this.sim || !o) return o ? o.pos : { x: 0, y: 0 };
      if (o.faction === this.sim.playerFaction || !OD.Render || typeof OD.Render.viewOf !== 'function') return o.pos;
      try { const v = OD.Render.viewOf(this.sim, o); return v && v.pos ? v.pos : o.pos; } catch (e) { return o.pos; }
    },
    fitAll() { if (!this.sim) return; this.cam.inset = this.hudInset(); this.cam.fit(this.sim.alive().map((s) => this.viewPos(s))); },
    select(id, add) {
      const s = this.sim.byId(id); if (!s) return;
      if (add) { if (!this.selection.includes(id)) this.selection.push(id); } else this.selection = [id];
      OD.UI.select(id);
      if (s.faction === this.sim.playerFaction) this.sim.flags.selectedPlayer = true;
    },
    setTarget(id) {
      for (const sid of this.selection) { const s = this.sim.byId(sid); if (s && s.id !== id) { s.target = id; if (s.order.target && s.order.type !== 'manual') s.order.target = id; } }
    },
    onOrder(ship, order) {
      // Apply the same order to the rest of a multi-selection.
      for (const sid of this.selection) if (sid !== ship.id) { const s = this.sim.byId(sid); if (s && s.faction === this.sim.playerFaction && !s.disabled) this.sim.setOrder(sid, { ...order, target: order.target || s.target }); }
      if (order.type === 'intercept') this.sim.flags.orderedIntercept = true;
      this.sim.flags.ordered = true;
      // A long transfer gets one line about time warp; the game slows itself for the flip and the arrival.
      if (OD.Guide && (order.type === 'intercept' || order.type === 'keeprange')) {
        const p = OD.Guide.plan(this.sim, ship);
        if (p.active && p.time > 180) OD.UI.toast('About ' + U.fmt.time(p.time) + ' of ship time. Press Skip ahead, or 16\u00d7, to run it. Time drops back to 1\u00d7 for the flip and the arrival.', 5000);
      }
    },
    quickOrder(type) {
      const ship = this.sim && OD.UI.selected ? this.sim.byId(OD.UI.selected) : null;
      if (!ship || ship.faction !== this.sim.playerFaction) return;
      const b = document.querySelector('#shipPanel [data-order="' + type + '"]');
      if (b) b.click();
    },
    // The glyph is small; the name beside it is what people aim at, so the label counts as part of the ship.
    shipAt(sx, sy, prev) {
      const hits = [];
      for (const s of this.sim.ships) {
        if (s.destroyed) continue;
        const p = this.cam.toScreen(OD.Render.viewOf ? OD.Render.viewOf(this.sim, s).pos : s.pos);
        const d = Math.hypot(p.x - sx, p.y - sy);
        const inLabel = sx >= p.x + 10 && sx <= p.x + 14 + 7.2 * s.name.length && sy >= p.y - 16 && sy <= p.y + 12;
        if (d < 24 || inLabel) hits.push({ s, d: inLabel && d >= 24 ? 24 + (sx - p.x) * 0.01 : d });
      }
      if (!hits.length) return null;
      hits.sort((a, b) => (a.s.faction === this.sim.playerFaction ? 0 : 1) - (b.s.faction === this.sim.playerFaction ? 0 : 1) || a.d - b.d);
      // A second click at the same spot cycles through overlapping ships.
      if (prev && hits.length > 1) { const i = hits.findIndex((h) => h.s.id === prev); if (i >= 0) return hits[(i + 1) % hits.length].s; }
      return hits[0].s;
    },
    input(canvas) {
      let down = null, dragging = false, pinch = null, lastClick = { x: -1, y: -1, id: null, t: 0 };
      // A finger held on a ship is the phone's right-click (Help promised it; the scan of 2026-09-22 found no code for it).
      let longPress = null, held = false;
      const cancelHold = () => { if (longPress) { clearTimeout(longPress); longPress = null; } };
      const pos = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
      // a bridge screen takes every pointer event on the canvas; the map never pans or zooms under a menu
      const bridge = () => OD.Bridge && OD.Bridge.active && !OD.UI.currentScreen;
      canvas.addEventListener('pointerdown', (e) => {
        if (bridge()) { const p = pos(e); try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* fine */ } OD.Bridge.pointer('down', p.x, p.y, e); down = null; return; }
        if (!this.sim) return; down = pos(e); dragging = false; canvas.setPointerCapture(e.pointerId);
        cancelHold(); held = false;
        if (e.pointerType === 'touch' || e.pointerType === 'pen') {
          const at = down;
          longPress = setTimeout(() => { longPress = null; if (down === at && !dragging && this.sim) { held = true; this.click(at.x, at.y, 2, false, null); } }, 550);
        }
      });
      canvas.addEventListener('pointermove', (e) => {
        if (bridge()) { const p = pos(e); OD.Bridge.pointer('move', p.x, p.y, e); return; }
        if (!down || !this.sim) return;
        const p = pos(e);
        if (!dragging && Math.hypot(p.x - down.x, p.y - down.y) > 5) { dragging = true; cancelHold(); }
        if (dragging) { this.cam.x -= (p.x - down.x) / this.cam.zoom; this.cam.y += (p.y - down.y) / this.cam.zoom; this.cam.follow = null; this._pannedAt = performance.now(); down = p; }
      });
      canvas.addEventListener('pointerup', (e) => {
        if (bridge()) { const p = pos(e); OD.Bridge.pointer('up', p.x, p.y, e); down = null; return; }
        cancelHold();
        if (!down || !this.sim) { down = null; return; }
        if (held) { held = false; down = null; dragging = false; return; }
        const p = pos(e);
        if (!dragging) {
          const same = Math.hypot(p.x - lastClick.x, p.y - lastClick.y) < 8 && performance.now() - lastClick.t < 4000;
          const hit = this.click(p.x, p.y, e.button, e.shiftKey, same ? lastClick.id : null);
          lastClick = { x: p.x, y: p.y, id: hit, t: performance.now() };
        }
        down = null; dragging = false;
      });
      canvas.addEventListener('pointerleave', (e) => { if (bridge()) OD.Bridge.pointer('leave', -1, -1, e); });
      canvas.addEventListener('dblclick', (e) => { if (bridge() || !this.sim) return; const p = pos(e); const s = this.shipAt(p.x, p.y); if (s) { this.cam.follow = s.id; this.cam.zoom = Math.max(this.cam.zoom, 0.6); } });
      canvas.addEventListener('contextmenu', (e) => e.preventDefault());
      canvas.addEventListener('wheel', (e) => { if (bridge()) { e.preventDefault(); const p = pos(e); OD.Bridge.pointer('wheel', p.x, p.y, e); return; } if (!this.sim) return; e.preventDefault(); const p = pos(e); const z0 = this.cam.zoom; this.cam.zoomAt(Math.exp(-e.deltaY * 0.0016), p.x, p.y); this._pannedAt = performance.now(); if (this.cam.zoom > z0) this.followAtArtZoom(p.x, p.y); }, { passive: false });
      canvas.addEventListener('touchstart', (e) => { if (bridge()) return; if (e.touches.length === 2) { pinch = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY); } }, { passive: true });
      canvas.addEventListener('touchmove', (e) => { if (bridge()) return; if (e.touches.length === 2 && pinch) { const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY); const r = canvas.getBoundingClientRect(); const z0 = this.cam.zoom; this.cam.zoomAt(d / pinch, (e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left, (e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top); pinch = d; if (this.cam.zoom > z0) this.followAtArtZoom((e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left, (e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top); } }, { passive: true });
      canvas.addEventListener('touchend', () => { pinch = null; });
      window.addEventListener('resize', () => { if (OD.Bridge && OD.Bridge.resize) OD.Bridge.resize(); if (this.demo && this.demo.kind === 'preview') this.demo.fitted = false; });
      window.addEventListener('keydown', (e) => {
        if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA')) return;
        const cs = OD.UI.currentScreen;
        if (!cs && OD.Bridge && OD.Bridge.active) {
          // the console: digits pick entries, Esc backs out, Enter confirms, arrows move the selection
          if (e.altKey || e.ctrlKey || e.metaKey) return;
          if (OD.Bridge.key(e)) e.preventDefault();
          return;
        }
        if (cs === 'hull' && this.sim && this.running) {
          // v12: the hull view is a place to stand mid-fight. An open decision takes the digits and Esc first,
          // then Esc closes the view, 1 2 3 and the arrows pick the view and the ship, V closes it, the digits
          // 4 to 9 do nothing (1 to 3 are views here, so no digit sets the warp; the header buttons do), and every
          // other gameplay key (space, orders, jink, fire control) works as it does on the map.
          if (/^[1-3]$/.test(e.key) && OD.UI.decisionKey && OD.UI.decisionKey(e.key)) { e.preventDefault(); return; }
          if (e.key === 'Escape') { if (OD.UI.decisionKey && OD.UI.decisionKey('esc')) { e.preventDefault(); return; } const b = document.querySelector('#screens button.primary'); if (b) b.click(); return; }
          if (OD.UI.hullKey(e.key)) { e.preventDefault(); return; }
          if (e.key.toLowerCase() === 'v') { e.preventDefault(); OD.UI.closeScreen(); return; }
          if (/^[4-9]$/.test(e.key) || e.key === 'Enter') return;
        } else if (cs) {
          // Esc backs out of a screen; digits pick console entries or hull views; arrows page the hull view.
          if (e.key === 'Escape') { const b = document.querySelector('#screens [data-esc]') || (['pause', 'physics', 'help', 'hull'].includes(cs) ? document.querySelector('#screens button.primary') : null); if (b) b.click(); return; }
          if (cs === 'hull' && OD.UI.hullKey(e.key)) { e.preventDefault(); return; }
          if (/^[1-9]$/.test(e.key)) { const list = document.querySelectorAll('#screens .menu-actions button'); const b = list[+e.key - 1]; if (b && !b.disabled) { e.preventDefault(); b.click(); } }
          return;
        }
        if (!this.sim || !this.running) return;
        const k = e.key.toLowerCase();
        if (e.key === 'Enter') { const h = document.getElementById('hint'); if (h && !h.hidden && !(e.target && e.target.closest && e.target.closest('button,[role=button],a'))) { e.preventDefault(); document.getElementById('hintOk').click(); } return; }
        // an open decision takes the digits and Esc before anything else
        if (/^[1-3]$/.test(k) && OD.UI.decisionKey && OD.UI.decisionKey(k)) { e.preventDefault(); return; }
        if (e.key === 'Escape' && OD.UI.decisionKey && OD.UI.decisionKey('esc')) { e.preventDefault(); return; }
        if (e.key === ' ') { e.preventDefault(); this.setWarp(this.warp === 0 ? (this._prevWarp || 1) : (this._prevWarp = this.warp, 0)); }
        else if (k === '1') this.setWarp(1); else if (k === '2') this.setWarp(4); else if (k === '3') this.setWarp(16); else if (k === '4') this.setWarp(64);
        else if (k === 'f') { this.cam.follow = this.cam.follow ? null : OD.UI.selected; }
        else if (e.key === 'Home') this.fitAll();
        else if (k === 'p') OD.UI.physics();
        else if (k === 'v') OD.UI.hullView();
        else if (k === 'c') { if (OD.UI.damageBoard) OD.UI.damageBoard(); }
        else if (k === 'd') OD.UI.setDetail(OD.UI.detail === 'full' ? 'essentials' : 'full', true);
        else if (k === 'i') this.quickOrder('intercept'); else if (k === 'k') this.quickOrder('keeprange'); else if (k === 'm') this.quickOrder('matchv'); else if (k === 'h') this.quickOrder('hold'); else if (k === 'r') this.quickOrder('retreat');
        else if (k === 'j') { const s = this.sim.byId(OD.UI.selected); if (s && s.faction === this.sim.playerFaction) s.jink = !s.jink; }
        else if (k === 'x') { const s = this.sim.byId(OD.UI.selected); if (s && s.faction === this.sim.playerFaction) this.sim.setRadiators(s.id, !s.radiators.deployed); }
        else if (k === 's') { const s = this.sim.byId(OD.UI.selected); if (s && OD.UI.toggleActive) OD.UI.toggleActive(s); }
        else if (k === 'tab') { e.preventDefault(); const own = this.sim.playerShips().filter((s) => s.role !== 'station'); if (own.length) { const i = own.findIndex((s) => s.id === OD.UI.selected); this.select(own[(i + 1) % own.length].id); } }
        else if (e.key === 'Escape') this.pauseMenu();
      });
    },
    click(x, y, button, shift, prevId) {
      const s = this.shipAt(x, y, prevId);
      if (!s) { if (!this._missToast) { this._missToast = true; OD.UI.toast('Click a ship, or its name, to select or target it. Drag to move the map and scroll to zoom.', 3500); } return null; }
      const own = s.faction === this.sim.playerFaction;
      if (button === 2) {
        const sel = OD.UI.selected ? this.sim.byId(OD.UI.selected) : null;
        if (!sel || sel.faction !== this.sim.playerFaction || sel === s) return s.id;
        this.setTarget(s.id);
        const cls = OD.Ships.CLASSES[sel.cls];
        const order = this.sim.isHostile(s, sel) ? { type: 'keeprange', target: s.id, range: cls.doctrine.range || 200e3 } : { type: 'intercept', target: s.id, range: 2000 };
        this.sim.setOrder(sel.id, order); this.onOrder(sel, order);
        OD.UI.toast(sel.name + ': ' + (order.type === 'keeprange' ? 'keep ' + U.fmt.dist(order.range) + ' from ' : 'intercept ') + s.name);
        return s.id;
      }
      if (own) { this.select(s.id, shift); }
      else if (OD.UI.selected) { this.setTarget(s.id); OD.UI.toast('Target: ' + s.name); }
      return s.id;
    },

    // Time warp drops to 1× just before the selected ship flips, starts braking or arrives, so the moment is seen.
    slowForEvents() {
      if (this.warp <= 1 || !OD.Guide || !OD.UI.selected) return;
      const ship = this.sim.byId(OD.UI.selected); if (!ship) return;
      const p = OD.Guide.plan(this.sim, ship);
      if (!p.active) return;
      const target = p.order.target ? this.sim.byId(p.order.target) : null;
      const events = [['flip', p.flip, 'Flip. The nose swings round, and from here the drive brakes instead of pushing.'], ['brake', p.brake, 'Braking tail-first' + (target ? ' toward ' + target.name : '') + '.'], ['arrive', p.arrive, 'Arriving' + (target ? '. Matching speed with ' + target.name : '') + '.'], ['crash', p.crash, 'On this track she reaches the surface. Burn to raise it.']];
      for (const [name, ev, text] of events) {
        if (!ev) continue;
        const eta = OD.Guide.eta(this.sim, p, ev);
        if (eta > 12 || eta <= 0) continue;
        const key = ship.id + ':' + name + ':' + Math.round((this.sim.time + eta) / 30);
        if (this._slowed[key]) continue;
        this._slowed[key] = true;
        if (name === 'brake' && Object.keys(this._slowed).some((k) => k.startsWith(ship.id + ':flip:') && Math.abs(+k.split(':')[2] - Math.round((this.sim.time + eta) / 30)) <= 2)) continue;
        this.pullWarp(1, 6000);
        OD.UI.toast(text, 4500);
        return;
      }
    },

    // The player commands one ship at a time; the others in the fleet run their own bays and aim under the
    // computer's doctrine once their weapons are free (engagement.js honours ship.autoBays). The commanded ship's
    // bays empty on the player's word alone.
    handBays() {
      const sim = this.sim; if (!sim || !sim.ships) return;
      const sel = OD.UI && OD.UI.selected;
      for (const s of sim.ships) if (s.faction === sim.playerFaction && !s.ai) s.autoBays = !!s.weaponsFree && s.id !== sel;
    },

    // ------------------------------------------------------------ loop
    loop(ts) {
      requestAnimationFrame((t) => this.loop(t));
      const dt = Math.min(0.1, (ts - this.last) / 1000 || 0);
      this.last = ts;
      if (this.sim && this.running) {
        // v12: the hull view is the one screen the fight keeps running behind, so the picture is live
        if (this.warp > 0 && (!OD.UI.currentScreen || OD.UI.currentScreen === 'hull')) {
          this.handBays();
          try { this.sim.step(dt * this.warp); } catch (e) { OD.errors.push('sim: ' + (e.stack || e)); this.setWarp(0); }
        }
        // Anything alarming pulls time back to 1× so it is not missed at high warp; radio traffic lands as a banner.
        const last = this.sim.log[this.sim.log.length - 1];
        if (last && last !== this._lastAlert && this.warp > 1 && (last.kind === 'alert' || (last.kind === 'warn' && last.speaker !== 'Autopilot'))) { this._lastAlert = last; this.pullWarp(1); OD.UI.toast(last.text, 4000); }
        else if (last && last !== this._lastComms && last.kind === 'comms' && last.speaker && !OD.UI.currentScreen) { this._lastComms = last; OD.UI.toast(last.text, 7000, last.speaker); }
        if (this.warp > 0 && !OD.UI.currentScreen) this.slowForEvents();
        this.restoreWarp(performance.now());
        this.keepShipsOnMap(performance.now());
        if (this.ctx && this.ctx.idealObj && this.ctx.firstDv == null) { const o = this.sim.objectives.find((x) => x.id === this.ctx.idealObj.id) || this.sim.objectives[0]; const sh = this.sim.byId(this.ctx.idealShip); if (o && o.done && sh) this.ctx.firstDv = o.doneDv != null ? o.doneDv : sh.stats.dvSpent; }
        if (this.sim.outcome && !this.outcomeShown) {
          this.outcomeShown = true;
          this.setWarp(1);
          setTimeout(() => { if (this.sim && this.sim.outcome) this.endScenario(); }, 3500);
        }
      } else if (!this.sim && this.demo) this.demoFrame(dt);
      const drawSim = this.sim || (this.demo ? this.demo.sim : null);
      if (this.sim && !(OD.Bridge && OD.Bridge.active)) { const tnow = performance.now(); if (!this._insetAt || tnow - this._insetAt > 150) { this._insetAt = tnow; try { this.cam.inset = this.hudInset(); } catch (e) { /* framing only */ } } }
      try { OD.Render.draw(drawSim, this.cam, this.sim ? OD.UI : { selected: null }); } catch (e) { OD.errors.push('render: ' + (e.stack || e)); }
      // the console draws over the map on the same context
      if (OD.Bridge && OD.Bridge.active) { try { OD.Bridge.draw(this.canvasCtx, this.cam, dt, ts / 1000); } catch (e) { OD.errors.push('bridge: ' + (e.stack || e)); } }
      if (this.sim && this.running) OD.UI.refresh(this.sim, ts);
    },
  };

  // Headless harness API (tools/harness.js). Not used by the page itself.
  OD.harness = {
    start(scenarioOrChapter, ctx) {
      let scenario = scenarioOrChapter;
      if (typeof scenarioOrChapter === 'number') scenario = OD.Story.chapters[scenarioOrChapter].build();
      // the harness never stops at the hangar
      Game.startScenario(scenario, Object.assign({ hangarDone: true }, ctx || { mode: 'Harness', chapter: typeof scenarioOrChapter === 'number' ? scenarioOrChapter : undefined }));
      Game.setWarp(0);
      return Game.sim.ships.map((s) => s.id);
    },
    step(seconds, chunk = 1) { const sim = Game.sim; let t = 0; while (t < seconds && !sim.outcome) { Game.handBays(); sim.step(chunk); t += chunk; } try { Game.cam.inset = Game.hudInset(); Game.keepShipsOnMap(performance.now()); } catch (e) { /* framing only */ } OD.Render.draw(sim, Game.cam, OD.UI); OD.UI.refresh(sim, performance.now() + 1000); return sim.outcome; },
    state() {
      const sim = Game.sim;
      return { time: sim.time, outcome: sim.outcome, errors: OD.errors.slice(), renderError: OD.Render.lastError ? String(OD.Render.lastError) : null,
        objectives: sim.objectives.map((o) => ({ id: o.id, done: o.done, failed: o.failed, progress: o.progress })),
        ships: sim.ships.map((s) => ({ id: s.id, name: s.name, faction: s.faction, pos: s.pos, vel: s.vel, heading: s.heading, dv: s.deltaV(), heat: s.thermalLoad(), throttle: s.throttle, order: s.order, target: s.target, disabled: s.disabled, destroyed: s.destroyed, captured: s.captured, hull: s.hull, finite: [s.pos.x, s.pos.y, s.vel.x, s.vel.y, s.heading, s.heat, s.propMass].every(isFinite) })),
        log: sim.log.slice(-6).map((l) => l.speaker + ': ' + l.text) };
    },
    select(id) { Game.select(id); },
    order(id, order) { Game.sim.setOrder(id, order); const s = Game.sim.byId(id); if (s) Game.onOrder(s, order); },
    game: Game,
  };

  OD.Game = Game;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => Game.init()); else Game.init();
})();
