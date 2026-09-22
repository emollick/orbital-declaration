/* Ship art, live: does the art show what the ship is doing?
   Loads the page, fights a short skirmish, zooms the camera until a hull is 200 px and more, and checks
   that OD.ShipArt.overlay draws what OD.Engagement.artFx reports — mounts trained and firing, rounds off
   the rails, interceptors away, point defence up, a holed tank venting, a repair party at work on a part —
   without throwing, in time, and without the sprite cache growing while the radiators travel or a party
   works. It also measures what the damage board asserts about the picture: that a party is on the hull
   whichever way she is lying, that a paused party reads paused on its own, and that a hit part is drawn
   hit from three quarters and from the side. Saves the screenshots it works from.
   node tools/art-check.js [--shots DIR]   (needs Playwright + Chromium; NODE_PATH may need the global modules dir) */
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const url = process.env.OD_URL || 'file://' + path.join(ROOT, 'index.html');
const SHOTS = process.argv.includes('--shots')
  ? process.argv[process.argv.indexOf('--shots') + 1]
  : '/tmp/claude-0/-home-user/786a4fda-aefe-589c-9fd0-5846d05e7329/scratchpad/v13/art';

let failures = 0;
function check(name, ok, detail) { console.log((ok ? '  ok   ' : '  FAIL ') + name + (detail ? '  ' + detail : '')); if (!ok) failures++; }

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  // the run stands on its own pictures, never on the last run's
  for (const f of fs.readdirSync(SHOTS)) if (/^0\d-.*\.png$/.test(f)) fs.unlinkSync(path.join(SHOTS, f));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(url);
  await page.waitForTimeout(600);

  // ---------------------------------------------------------------- the interface is there
  console.log('scenario: the art module offers the live interface');
  const iface = await page.evaluate(() => ({
    overlay: typeof OD.ShipArt.overlay === 'function',
    muzzle: typeof OD.ShipArt.muzzle === 'function',
    stats: typeof OD.ShipArt.cacheStats === 'function',
    fx: !!(OD.Engagement && typeof OD.Engagement.artFx === 'function'),
    old: ['draw', 'bounds', 'callouts', 'describe', 'stateFromShip', 'layout', 'preset', 'render', 'list', 'has'].filter((k) => typeof OD.ShipArt[k] !== 'function'),
    opts: typeof OD.Render.artOpts === 'function',
  }));
  check('OD.ShipArt.overlay exists', iface.overlay);
  check('OD.ShipArt.muzzle exists', iface.muzzle);
  check('OD.ShipArt.cacheStats exists', iface.stats);
  check('OD.Engagement.artFx exists', iface.fx);
  check('OD.Render.artOpts exists', iface.opts);
  check('every old interface still there', iface.old.length === 0, iface.old.join(', '));

  // ---------------------------------------------------------------- it draws for every hull, at every state
  console.log('scenario: overlay draws for every hull and every effect');
  const drawn = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 900; c.height = 600;
    const ctx = c.getContext('2d');
    const out = { errors: [], marks: {}, zero: [] };
    const fxAt = (t) => ({
      t, aim: 0.7,
      mounts: [{ id: 0, index: 0, kind: 'beam', arc: 'turret', bearing: 0.7, firedAt: t },
        { id: 1, index: 0, kind: 'beam', arc: 'nose', bearing: 0, firedAt: t - 0.4 },
        { id: 2, index: 0, kind: 'coilgun', bearing: -0.4, firedAt: t - 0.2 },
        { id: 3, index: 1, kind: 'coilgun', bearing: 2.6, firedAt: t - 1.4 }],
      launches: [{ t: t - 0.1, bearing: 1.4, index: null }, { t: t - 2.5, bearing: 1.5, index: null }],
      pd: [{ t, index: 4, toward: { x: 0.2, y: -0.98 } }, { t: t - 0.3, index: 5, toward: { x: -1, y: 0 } }],
      vents: [{ tank: 0, of: 3, rate: 0.8, t }, { tank: 2, of: 3, rate: 0.3, t }],
    });
    for (const hull of OD.ShipArt.list()) {
      for (const view of ['top', 'side', 'threequarter']) {
        for (const rad of [0, 0.37, 1]) {
          for (const age of [0, 0.3, 1.1, 3, 40]) {
            const opts = {
              x: 450, y: 300, size: 260, view, rotation: view === 'top' ? 0.6 : 0, live: true,
              faction: 'JC', simTime: 100 + age, fx: fxAt(100),
              state: { radiators: rad, heat: 0.5, throttle: 0.6, hull: 0.8, damage: { nose: 0.1, flank: 0.3, tail: 0 },
                systems: { drive: 0.6, radiators: 0.8, sensors: 0.3, weapons: 0.5 },
                parts: { mounts: [1, 0, 1, 0.4, 1, 0], rads: [1, 0], tanks: [0.2, 1, 1], drive: 0.6, reactor: 1, sensors: 0 } },
            };
            try {
              OD.ShipArt.draw(ctx, hull, opts);
              OD.ShipArt.overlay(ctx, hull, opts);
              const sp = OD.ShipArt.render(hull, opts);
              out.marks[hull] = sp.marks ? sp.marks.length : 0;
            } catch (e) { out.errors.push(hull + '/' + view + '/' + rad + '/' + age + ': ' + e.message); }
          }
        }
      }
      // a destroyed hull, an empty fx and no fx at all: all three are legal calls
      for (const fx of [null, { t: 0, mounts: [], launches: [], pd: [], vents: [] }]) {
        try {
          const o = { x: 450, y: 300, size: 120, view: 'top', live: true, fx, simTime: 0, state: { destroyed: true, radiators: 0.5 } };
          OD.ShipArt.draw(ctx, hull, o); OD.ShipArt.overlay(ctx, hull, o);
        } catch (e) { out.errors.push(hull + ' destroyed: ' + e.message); }
      }
      if (!out.marks[hull]) out.zero.push(hull);
    }
    return out;
  });
  check('no throw from draw + overlay in any state', drawn.errors.length === 0, drawn.errors.slice(0, 4).join(' | '));
  check('every hull carries mount anchors', drawn.zero.length === 0, 'no anchors: ' + drawn.zero.join(', '));

  // ---------------------------------------------------------------- a holed tank is seen from any side
  // The log says "Tank 1 holed and venting" whichever way she is lying, so the picture has to show it.
  // A mount on the far side is behind the hull and is culled with it; gas is not — it leaves the tank and
  // hangs in space around the ship. Every tank of every class, in every view, has to change pixels.
  console.log('scenario: a holed tank vents on every side');
  const vent = await page.evaluate(() => {
    const W = 700, H = 460;
    const c = document.createElement('canvas'); c.width = W; c.height = H; const ctx = c.getContext('2d');
    const shot = (hull, view, vents, tank, of) => {
      ctx.clearRect(0, 0, W, H);
      const o = { x: W / 2, y: H / 2, size: 300, view, rotation: 0, faction: 'JC', live: true, simTime: 20, time: 20,
        light: { az: -50, el: 35 },
        state: { radiators: 1, heat: 0.4, throttle: 0, hull: 0.8, damage: { nose: 0, flank: 0.3, tail: 0 }, systems: { drive: 1, radiators: 1, sensors: 1 } },
        fx: { t: 20, aim: null, mounts: [], launches: [], pd: [], vents: vents ? [{ tank, rate: 0.85, t: 20, of }] : [] } };
      OD.ShipArt.draw(ctx, hull, o); OD.ShipArt.overlay(ctx, hull, o);
      return ctx.getImageData(0, 0, W, H).data;
    };
    const rows = [], blank = [];
    for (const hull of OD.ShipArt.list()) {
      const lay = OD.ShipArt.layout(OD.ShipArt.preset(hull));
      const of = (lay.tanks || []).length;
      if (!of) continue;   // a hull with no tanks (the station has no propellant) never vents
      for (const view of ['top', 'side', 'threequarter']) {
        const seen = [];
        for (let tank = 0; tank < of; tank++) {
          const base = new Uint8ClampedArray(shot(hull, view, false, tank, of));
          const b = shot(hull, view, true, tank, of);
          let n = 0;
          for (let i = 0; i < b.length; i += 4) {
            const d = Math.abs(b[i] - base[i]) + Math.abs(b[i + 1] - base[i + 1]) + Math.abs(b[i + 2] - base[i + 2]) + Math.abs(b[i + 3] - base[i + 3]);
            if (d > 24) n++;
          }
          seen.push(n);
          if (n < 100) blank.push(hull + ' ' + view + ' tank ' + tank + ': ' + n + ' px');
        }
        rows.push({ hull, view, seen });
      }
    }
    const all = rows.reduce((a, r) => a.concat(r.seen), []);
    return { rows, blank, cells: all.length, least: all.length ? Math.min.apply(null, all) : 0 };
  });
  check('every tank of every hull vents where the eye can see it', vent.blank.length === 0,
    vent.cells + ' class/view/tank cells, faintest ' + vent.least + ' px changed' + (vent.blank.length ? '; blank: ' + vent.blank.slice(0, 4).join(' | ') : ''));

  // ---------------------------------------------------------------- damage control on the hull
  // A repair party is a ring on the part it is working, drawn from opts.fx.parties over the sprite. Every
  // kind of part the crew module can send one to has to have an anchor on every hull that carries that
  // part — the drive, the reactor, the sensor suite in the nose, a panel, a tank, and each mount — and the
  // ring has to be there at the size the hull view and the portrait draw at, and gone at the size the map
  // draws a ship at in an ordinary fight, where a ring would be bigger than the hull it is on. It is
  // overlay paint over the sprite that is already in hand, so a party working for a minute must not cost
  // the sprite cache a thing: the ring turns, the sprite does not change.
  console.log('scenario: repair parties on the hull');
  const party = await page.evaluate(() => {
    const W = 760, H = 520;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    const out = { errors: [], missing: [], noisy: [], farside: [], cells: 0, faint: 1e9, checked: 0, hulls: 0, growth: null, sprites: 0, pulse: {}, edge: {}, lum: {}, ring: {}, dash: null };
    // the damage module's own component ids, one of every kind
    const PARTS = ['drive', 'reactor', 'sensors', 'rad1', 'rad2', 'tank1', 'tank2', 'beam1', 'beam2', 'coil1', 'bay1', 'pd1'];
    const ROLE = { drive: ['drive'], reactor: ['reactor'], sensors: ['sensors'], rad: ['rad'], tank: ['tank'],
      beam: ['beam', 'spinal'], coil: ['coil'], bay: ['bay'], pd: ['pd'] };
    const st = { radiators: 1, heat: 0.4, throttle: 0.2, hull: 0.8, damage: { nose: 0.1, flank: 0.3, tail: 0.1 },
      systems: { drive: 0.6, radiators: 0.8, sensors: 0.6, weapons: 0.8 } };
    // no plume: the exhaust flickers on its own clock and would answer for the markers
    const optsFor = (size, view, parties, t) => ({
      x: W / 2, y: H / 2, size, view, rotation: 0, faction: 'JC', live: true, plume: false,
      light: { az: -50, el: 35 }, simTime: t, time: t, state: st,
      fx: { t, aim: 0.5, mounts: [], launches: [], pd: [], vents: [], parties },
    });
    const paint = (hull, size, view, parties, t) => {
      ctx.clearRect(0, 0, W, H);
      const o = optsFor(size, view, parties, t == null ? 40 : t);
      OD.ShipArt.draw(ctx, hull, o);
      OD.ShipArt.overlay(ctx, hull, o);
    };
    const shot = (hull, size, view, parties, t) => { paint(hull, size, view, parties, t); return ctx.getImageData(0, 0, W, H).data; };
    const diff = (a, b) => {
      let n = 0;
      for (let i = 0; i < a.length; i += 4) {
        const d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) + Math.abs(a[i + 3] - b[i + 3]);
        if (d > 24) n++;
      }
      return n;
    };
    const light = (a, b) => { let s = 0; for (let i = 0; i < a.length; i += 4) s += (b[i] + b[i + 1] + b[i + 2]) - (a[i] + a[i + 1] + a[i + 2]); return s; };
    // the shape of what the marker put down, wherever on the canvas it landed
    const box = (a, b) => {
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, n = 0;
      for (let i = 0; i < a.length; i += 4) {
        const d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) + Math.abs(a[i + 3] - b[i + 3]);
        if (d <= 24) continue;
        const q = i / 4, x = q % W, y = (q - x) / W;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; n++;
      }
      return n ? { w: x1 - x0, h: y1 - y0, x0, y0, x1, y1, n } : { w: 0, h: 0, x0: 0, y0: 0, x1: 0, y1: 0, n: 0 };
    };

    for (const hull of OD.ShipArt.list()) {
      out.hulls++;
      let has = {};
      try {
        const sp = OD.ShipArt.render(hull, optsFor(400, 'threequarter', [], 40));
        for (const m of sp.marks) has[m.role] = (has[m.role] || 0) + 1;
      } catch (e) { out.errors.push(hull + ' anchors: ' + e.message); continue; }
      for (const part of PARTS) {
        const kind = /^[a-z]+/.exec(part)[0], roles = ROLE[kind] || [];
        if (!roles.some((r) => has[r])) continue;      // this hull carries no such part: nothing to draw
        const one = [{ id: 'p1', part, progress: 0.45, eta: 200, working: true }];
        let big = 0, small = 0;
        for (const view of ['top', 'side', 'threequarter']) {
          try {
            const b0 = new Uint8ClampedArray(shot(hull, 400, view, []));
            // Every cell, not the best of the three: a mount, a bay or a tank turned away from the camera
            // is behind the hull, and the board still says a party is on it. The marker is not culled with
            // the part, so no class/view/part cell may come out blank.
            const n = diff(b0, shot(hull, 400, view, one));
            big = Math.max(big, n);
            out.cells++;
            if (n < out.faint) out.faint = n;
            if (n < 60) out.farside.push(hull + ' ' + part + ' ' + view + ': ' + n + ' px');
            const s0 = new Uint8ClampedArray(shot(hull, 60, view, []));
            small = Math.max(small, diff(s0, shot(hull, 60, view, one)));
          } catch (e) { out.errors.push(hull + '/' + part + '/' + view + ': ' + e.message); }
        }
        out.checked++;
        if (big < 60) out.missing.push(hull + ' ' + part + ': ' + big + ' px at 400');
        if (small > 0) out.noisy.push(hull + ' ' + part + ': ' + small + ' px at 60');
      }
    }

    // The threshold itself: 70 px of hull shows a marker, a hair under does not. The ring is clamped to
    // 9 px from 120 px of hull down, so the marker it draws at 70 is the same marker it draws at 120 —
    // which is why the floor can come down this far and the map can carry a party at a fighting zoom.
    const bh = 'destroyer', drv = [{ id: 'p2', part: 'drive', progress: 0.5, eta: 120, working: true }];
    try {
      out.edge.at70 = diff(new Uint8ClampedArray(shot(bh, 70, 'top', [])), shot(bh, 70, 'top', drv));
      out.edge.at69 = diff(new Uint8ClampedArray(shot(bh, 69, 'top', [])), shot(bh, 69, 'top', drv));
      // measured on a paused marker, which carries no halo: what the box holds is the ring itself
      const still = [{ id: 'p2', part: 'drive', progress: 0.5, eta: 0, working: false }];
      out.ring.at70 = box(new Uint8ClampedArray(shot(bh, 70, 'top', [])), shot(bh, 70, 'top', still));
      out.ring.at120 = box(new Uint8ClampedArray(shot(bh, 120, 'top', [])), shot(bh, 120, 'top', still));
      out.ring.at400 = box(new Uint8ClampedArray(shot(bh, 400, 'top', [])), shot(bh, 400, 'top', still));
    } catch (e) { out.errors.push('threshold: ' + e.message); }

    // working is brighter and breathes on the sim clock; paused is dim and holds perfectly still
    const work = [{ id: 'p1', part: 'reactor', progress: 0.5, eta: 300, working: true }];
    const hold = [{ id: 'p1', part: 'reactor', progress: 0.5, eta: 300, working: false }];
    try {
      const base = new Uint8ClampedArray(shot(bh, 400, 'side', [], 40));
      const w0 = new Uint8ClampedArray(shot(bh, 400, 'side', work, 40));
      const h0 = new Uint8ClampedArray(shot(bh, 400, 'side', hold, 40));
      out.pulse.working = diff(w0, shot(bh, 400, 'side', work, 40.8));
      out.pulse.paused = diff(h0, shot(bh, 400, 'side', hold, 40.8));
      out.pulse.apart = diff(w0, h0);
      out.lum.working = light(base, w0);
      out.lum.paused = light(base, h0);
    } catch (e) { out.errors.push('pulse: ' + e.message); }

    // A paused party has to read paused alone on screen, with no working marker beside it to compare
    // against — so the difference cannot be only colour and brightness. Its ring is broken into dashes
    // where a working one is a closed circle: measured as blank sectors round the ring itself, which is a
    // shape and survives whatever the hull under it is doing. The paused marker carries no halo, so the
    // box of what it put down is the ring, and the ring alone.
    try {
      const rs = (working) => [{ id: 'p1', part: 'reactor', progress: 1, eta: 0, working }];
      const b0 = new Uint8ClampedArray(shot(bh, 400, 'side', [], 40));
      const held = new Uint8ClampedArray(shot(bh, 400, 'side', rs(false), 40));
      const work2 = new Uint8ClampedArray(shot(bh, 400, 'side', rs(true), 40));
      const bx = box(b0, held);
      const cx = (bx.x0 + bx.x1) / 2, cy = (bx.y0 + bx.y1) / 2, rr = (bx.w + bx.h) / 4 - 2.4;
      const lit = (img, x, y) => {
        const i = ((y | 0) * W + (x | 0)) * 4;
        return Math.abs(b0[i] - img[i]) + Math.abs(b0[i + 1] - img[i + 1]) + Math.abs(b0[i + 2] - img[i + 2]) + Math.abs(b0[i + 3] - img[i + 3]) > 24;
      };
      const blanks = (img) => {
        let k = 0;
        for (let s = 0; s < 36; s++) {
          let on = false;
          for (let q = 0; q <= 6 && !on; q++) {
            const ang = ((s + q / 6) * Math.PI * 2) / 36;
            for (let r = rr - 2.2; r <= rr + 2.2 && !on; r += 0.7) if (lit(img, cx + Math.cos(ang) * r, cy + Math.sin(ang) * r)) on = true;
          }
          if (!on) k++;
        }
        return k;
      };
      out.dash = { paused: blanks(held), working: blanks(work2), r: Math.round(rr * 10) / 10 };
    } catch (e) { out.errors.push('dashes: ' + e.message); }

    // The map turns a hull to her heading, and a marker turned with her would be upside down half the
    // time. Turn the same ship a radian and the marker has to put down the same shape in the same
    // upright — only somewhere else on the canvas.
    try {
      const one = [{ id: 'p1', part: 'rad1', progress: 0.45, eta: 200, working: true }];
      const flat0 = box(new Uint8ClampedArray(shot(bh, 400, 'top', [], 40)), shot(bh, 400, 'top', one, 40));
      const turnOpts = (parties) => { ctx.clearRect(0, 0, W, H); const o = optsFor(400, 'top', parties, 40); o.rotation = 1.1; OD.ShipArt.draw(ctx, bh, o); OD.ShipArt.overlay(ctx, bh, o); return ctx.getImageData(0, 0, W, H).data; };
      const turned = box(new Uint8ClampedArray(turnOpts([])), turnOpts(one));
      out.turn = { flat: flat0, turned };
    } catch (e) { out.errors.push('turned: ' + e.message); }

    // a party on a part this hull has not got, a malformed one, and an empty list: all legal, all nothing
    try {
      const b = new Uint8ClampedArray(shot(bh, 400, 'top', []));
      out.junk = diff(b, shot(bh, 400, 'top', [{ id: 'p1', part: 'galley7', progress: 0.5, eta: 10, working: true },
        { id: 'p2', part: null, progress: 0.5 }, { id: 'p3' }, null]));
    } catch (e) { out.errors.push('junk: ' + e.message); }

    // and what a minute of repairs costs the sprite cache: nothing
    try {
      OD.ShipArt.clearCache();
      const parties = PARTS.map((part, i) => ({ id: 'p' + (i + 1), part, progress: (i + 1) / (PARTS.length + 1), eta: 60 * (i + 1), working: i % 2 === 0 }));
      paint('cruiser', 400, 'threequarter', parties, 10);
      const a0 = OD.ShipArt.cacheStats();
      for (let f = 0; f < 40; f++) {
        const moving = parties.map((p) => ({ id: p.id, part: p.part, progress: Math.min(1, p.progress + f * 0.01), eta: Math.max(1, p.eta - f), working: p.working }));
        paint('cruiser', 400, 'threequarter', moving, 10 + f * 0.25);
      }
      const z0 = OD.ShipArt.cacheStats();
      out.growth = (z0.sprites - a0.sprites) + (z0.evictions - a0.evictions);
      out.sprites = z0.sprites;
    } catch (e) { out.errors.push('cache: ' + e.message); }
    return out;
  });
  check('a party is drawn on every kind of part, on every hull that carries one', party.missing.length === 0,
    party.checked + ' hull/part pairs over ' + party.hulls + ' hulls, blank: ' + party.missing.slice(0, 4).join(' | '));
  check('no marker on a map-sized hull', party.noisy.length === 0, party.noisy.slice(0, 4).join(' | '));
  check('a party on a part turned away from the camera still draws', party.farside.length === 0,
    party.cells + ' hull/part/view cells, faintest ' + (party.faint === 1e9 ? '-' : party.faint) + ' px changed'
    + (party.farside.length ? '; blank: ' + party.farside.slice(0, 4).join(' | ') : ''));
  check('the markers come in at 70 px of hull', party.edge.at70 > 60 && party.edge.at69 === 0,
    '70 px: ' + party.edge.at70 + ' px changed, 69 px: ' + party.edge.at69);
  check('the ring is the same 9 px across at 70 px of hull as at 120', party.ring.at70 && party.ring.at120
    && Math.abs(party.ring.at70.w - party.ring.at120.w) <= 2 && Math.abs(party.ring.at70.h - party.ring.at120.h) <= 2
    && party.ring.at400.w > party.ring.at120.w + 8,
    party.ring.at70 ? party.ring.at70.w + 'x' + party.ring.at70.h + ' px at 70, ' + party.ring.at120.w + 'x' + party.ring.at120.h
      + ' px at 120, ' + party.ring.at400.w + 'x' + party.ring.at400.h + ' px at 400' : 'not run');
  check('a paused party reads paused on its own: its ring is broken', party.dash && party.dash.paused >= 6 && party.dash.working <= 1,
    party.dash ? party.dash.paused + ' of 36 sectors blank round a paused ring, ' + party.dash.working + ' round a working one' : 'not run');
  check('a working party breathes on the sim clock, a paused one holds still', party.pulse.working > 0 && party.pulse.paused === 0,
    'working ' + party.pulse.working + ' px over 0.8 s, paused ' + party.pulse.paused);
  check('a working party is brighter than a paused one', party.pulse.apart > 0 && party.lum.working > party.lum.paused,
    'apart ' + party.pulse.apart + ' px, light ' + party.lum.working + ' vs ' + party.lum.paused);
  check('a party on a part the hull has not got draws nothing', party.junk === 0, party.junk + ' px');
  check('the marker stands upright however the hull is turned', party.turn && party.turn.flat.n > 60
    && Math.abs(party.turn.flat.w - party.turn.turned.w) <= 3 && Math.abs(party.turn.flat.h - party.turn.turned.h) <= 3,
    party.turn ? party.turn.flat.w + 'x' + party.turn.flat.h + ' px unturned, ' + party.turn.turned.w + 'x' + party.turn.turned.h + ' px at 1.1 rad' : 'not run');
  check('a minute of repairs costs the sprite cache nothing', party.growth === 0,
    'grew by ' + party.growth + ', ' + party.sprites + ' sprites in hand');
  check('no throw from any of it', party.errors.length === 0, party.errors.slice(0, 3).join(' | '));

  // ---------------------------------------------------------------- a crowd of parties on one hull
  // Damage comes in groups — three of a cruiser's six panels are neighbours on one stretch of spine, and
  // a boarding puts a party on every part that is left — so the rings have to survive being asked for at
  // once. Two rings that overlap hide the numbers inside them, and two times printed a few pixels apart
  // read as one number ("2 min 4 min 5 min"), which is worse than no time at all: the board carries every
  // one of them in full. So: no two rings may overlap, at any hull size the marker draws at, in any view;
  // no two times may print over each other; and no time may land on another party's ring. Measured off
  // OD.ShipArt.lastParties(), which is where the overlay actually put them.
  console.log('scenario: a crowd of parties, rings and times');
  const crowd = await page.evaluate(() => {
    const W = 900, H = 700;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    const out = { errors: [], overlap: [], overprint: [], onRing: [], cases: 0, rings: 0, tight: 1e9, push: 0, times: 0, dropped: 0, api: typeof OD.ShipArt.lastParties === 'function' };
    if (!out.api) return out;
    const st = { radiators: 1, heat: 0.4, throttle: 0.2, hull: 0.7, damage: { nose: 0.2, flank: 0.3, tail: 0.2 },
      systems: { drive: 0.6, radiators: 0.8, sensors: 0.6, weapons: 0.8 } };
    // the parts a hull is likeliest to have parties on at once, neighbours first
    const WANT = ['rad1', 'rad2', 'rad3', 'rad4', 'rad5', 'tank1', 'tank2', 'drive', 'reactor', 'sensors', 'coil1', 'beam1'];
    for (const hull of OD.ShipArt.list()) {
      let has = {};
      try {
        const sp = OD.ShipArt.render(hull, { x: 0, y: 0, size: 400, view: 'side', state: st });
        for (const m of sp.marks) has[m.role] = (has[m.role] || 0) + 1;
      } catch (e) { out.errors.push(hull + ' anchors: ' + e.message); continue; }
      const parts = WANT.filter((q) => {
        const kind = /^[a-z]+/.exec(q)[0], nth = +(/\d+$/.exec(q) || [1])[0];
        const role = kind === 'beam' ? 'beam' : kind;
        return (has[role] || (kind === 'beam' && has.spinal) || 0) >= (kind === 'rad' || kind === 'tank' ? nth : 1);
      }).slice(0, 6);
      if (parts.length < 2) continue;
      const list = parts.map((q, i) => ({ id: 'p' + (i + 1), part: q, progress: 0.15 + i * 0.12, eta: 90 + i * 140, working: i !== 2 }));
      for (const view of ['side', 'top', 'threequarter', 'front']) {
        for (const size of [120, 260, 420, 620]) {
          try {
            ctx.clearRect(0, 0, W, H);
            const o = { x: W / 2, y: H / 2, size, view, rotation: view === 'top' ? 0.6 : 0, faction: 'JC', live: true, plume: false,
              light: { az: -50, el: 35 }, simTime: 40, time: 40, state: st,
              fx: { t: 40, aim: 0.5, mounts: [], launches: [], pd: [], vents: [], parties: list } };
            OD.ShipArt.draw(ctx, hull, o); OD.ShipArt.overlay(ctx, hull, o);
            const L = OD.ShipArt.lastParties();
            out.cases++; out.rings += L.length;
            const where = hull + ' ' + view + ' ' + size + ' px';
            for (const q of L) { out.push = Math.max(out.push, q.moved); if (q.eta) out.times++; else out.dropped++; }
            for (let i = 0; i < L.length; i++) {
              for (let j = i + 1; j < L.length; j++) {
                const gap = Math.hypot(L[i].x - L[j].x, L[i].y - L[j].y) - (L[i].r + L[j].r);
                if (gap < out.tight) out.tight = gap;
                if (gap < -0.5) out.overlap.push(where + ' ' + L[i].part + '/' + L[j].part + ': ' + gap.toFixed(1) + ' px');
                const a = L[i].eta, b = L[j].eta;
                if (a && b && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) {
                  out.overprint.push(where + ' ' + a.text + '/' + b.text);
                }
              }
              const e = L[i].eta;
              if (!e) continue;
              for (let j = 0; j < L.length; j++) {
                if (j === i) continue;
                const cx = Math.max(e.x, Math.min(L[j].x, e.x + e.w)), cy = Math.max(e.y, Math.min(L[j].y, e.y + e.h));
                if (Math.hypot(cx - L[j].x, cy - L[j].y) < L[j].r) out.onRing.push(where + ' ' + e.text + ' on ring ' + L[j].part);
              }
            }
          } catch (e) { out.errors.push(hull + '/' + view + '/' + size + ': ' + e.message); }
        }
      }
    }
    return out;
  });
  check('OD.ShipArt.lastParties reports where the rings went', crowd.api);
  check('rings on neighbouring parts never overlap', crowd.overlap.length === 0 && crowd.cases > 40,
    crowd.cases + ' crowds, ' + crowd.rings + ' rings, tightest gap ' + (crowd.tight === 1e9 ? '-' : crowd.tight.toFixed(1)) + ' px, worst push '
    + crowd.push.toFixed(1) + ' px' + (crowd.overlap.length ? '; ' + crowd.overlap.slice(0, 3).join(' | ') : ''));
  check('two times never print over each other, or over a ring', crowd.overprint.length === 0 && crowd.onRing.length === 0,
    crowd.times + ' times printed, ' + crowd.dropped + ' dropped for want of room'
    + (crowd.overprint.length ? '; over each other: ' + crowd.overprint.slice(0, 3).join(' | ') : '')
    + (crowd.onRing.length ? '; on a ring: ' + crowd.onRing.slice(0, 3).join(' | ') : ''));
  check('no throw from a crowded hull', crowd.errors.length === 0, crowd.errors.slice(0, 3).join(' | '));

  // ---------------------------------------------------------------- a hit part, from every side
  // The board names the part and the state; the hull has to agree from wherever the camera is standing.
  // Half the angles a fight is watched from show a plate edge-on and a dome as a curve, where a change of
  // paint says nothing at all, so a hit part loses shape as well as colour: a panel loses its metal and
  // hangs off its hinge, a dome is opened up and drops its barrel, a rail pair is a stub at the breech, a
  // launch block is stove in or burnt out, the reactor drum loses its ribs. Measured per class, per part
  // and per view against the same hull sound: a wrecked part has to read from three quarters (the view
  // the map is played in) and from at least two of the three, and a damaged one the same. Point defence
  // is held to the wrecked look alone: a dome is under a metre of a hundred-metre hull, so a dent in one
  // is a handful of pixels however it is drawn, while a wrecked one reads in thousands.
  console.log('scenario: a hit part reads on the hull');
  const state = await page.evaluate(() => {
    const W = 760, H = 520;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    const out = { errors: [], rows: [], wrecked: [], damaged: [], kinds: 0 };
    const st = { radiators: 1, heat: 0.4, throttle: 0.2, hull: 0.8, damage: { nose: 0.1, flank: 0.3, tail: 0.1 },
      systems: { drive: 0.6, radiators: 0.8, sensors: 0.6, weapons: 0.8 } };
    const shot = (hull, view, parts) => {
      ctx.clearRect(0, 0, W, H);
      const o = { x: W / 2, y: H / 2, size: 420, view, rotation: 0, faction: 'JC', live: true, plume: false,
        light: { az: -50, el: 35 }, simTime: 40, time: 40, state: Object.assign({}, st, { parts }),
        fx: { t: 40, aim: 0.5, mounts: [], launches: [], pd: [], vents: [], parties: [] } };
      OD.ShipArt.draw(ctx, hull, o); OD.ShipArt.overlay(ctx, hull, o);
      return ctx.getImageData(0, 0, W, H).data;
    };
    const diff = (a, b) => {
      let n = 0;
      for (let i = 0; i < a.length; i += 4) {
        const d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) + Math.abs(a[i + 3] - b[i + 3]);
        if (d > 24) n++;
      }
      return n;
    };
    for (const hull of OD.ShipArt.list()) {
      let lay, nm, nr;
      try {
        lay = OD.ShipArt.layout(OD.ShipArt.preset(hull));
        nm = (OD.ShipArt.preset(hull).mounts || []).length;
        nr = (lay.rads || []).length;
      } catch (e) { out.errors.push(hull + ' layout: ' + e.message); continue; }
      // the damage module's own kinds, by the mount indices the design carries
      const kinds = { rad: null, beam: lay.turretIdx, coil: lay.coilIdx, bay: lay.bayIdx, pd: lay.pdIdx, reactor: null };
      for (const kind of Object.keys(kinds)) {
        const idx = kinds[kind];
        if (kind === 'rad' ? !nr : kind !== 'reactor' && !(idx && idx.length)) continue;   // this hull carries none
        const parts = (v) => {
          const p = { mounts: new Array(Math.max(1, nm)).fill(1), rads: new Array(Math.max(1, nr)).fill(1),
            tanks: [1, 1, 1, 1, 1], drive: 1, reactor: 1, sensors: 1 };
          if (kind === 'rad') p.rads[0] = v;
          else if (kind === 'reactor') p.reactor = v;
          else for (const k of idx) p.mounts[k] = v;
          return p;
        };
        out.kinds++;
        const row = { hull, kind, dmg: {}, wrecked: {} };
        for (const view of ['side', 'threequarter', 'top']) {
          try {
            const sound = new Uint8ClampedArray(shot(hull, view, parts(1)));
            row.dmg[view] = diff(sound, shot(hull, view, parts(0.35)));
            row.wrecked[view] = diff(sound, shot(hull, view, parts(0)));
          } catch (e) { out.errors.push(hull + '/' + kind + '/' + view + ': ' + e.message); }
        }
        const reads = (m) => (m.threequarter >= 150 ? 1 : 0) + (m.side >= 150 ? 1 : 0) + (m.top >= 150 ? 1 : 0);
        const say = (m) => hull + ' ' + kind + ': 3q ' + m.threequarter + ', side ' + m.side + ', top ' + m.top + ' px';
        if (!(row.wrecked.threequarter >= 150 && reads(row.wrecked) >= 2)) out.wrecked.push(say(row.wrecked));
        if (kind !== 'pd' && !(row.dmg.threequarter >= 150 && reads(row.dmg) >= 2)) out.damaged.push(say(row.dmg));
        out.rows.push(row);
      }
    }
    const least = (f, skipPd) => out.rows.filter((r) => !skipPd || r.kind !== 'pd').reduce((a, r) => Math.min(a, r[f].threequarter), 1e9);
    return Object.assign(out, { leastWrecked: least('wrecked', false), leastDamaged: least('dmg', true) });
  });
  check('a wrecked part reads from three quarters and from at least two sides', state.wrecked.length === 0,
    state.kinds + ' class/part pairs, faintest in three quarters ' + state.leastWrecked + ' px'
    + (state.wrecked.length ? '; weak: ' + state.wrecked.slice(0, 4).join(' | ') : ''));
  check('a damaged part reads the same way (point defence by its paint, being a metre of hull)', state.damaged.length === 0,
    'faintest in three quarters ' + state.leastDamaged + ' px'
    + (state.damaged.length ? '; weak: ' + state.damaged.slice(0, 4).join(' | ') : ''));
  check('no throw from any of the part states', state.errors.length === 0, state.errors.slice(0, 3).join(' | '));

  // ---------------------------------------------------------------- a hit panel is not a travelling one
  // A radiator at 35 % is drawn shortened — and so is a radiator on its way out. Colour is all that is
  // left to tell them apart, and colour is what the eye reads last: the board says "damaged" while the
  // heat box says "extending" over two pictures of the same shape. So a hit plate leans off its hinge
  // toward the nose, which no travel can do to it, and the lean has to be worth pixels at the smallest
  // hull the art is drawn on (120 px, where the party marker comes in).
  // Measured on the plate's own anchor — the point the repair marker sits on, which rides the plate
  // through its bend, its rake and its travel — against every travel state a sound panel can be in:
  // how far, in screen pixels, the hit plate lands off the nearest picture a sound one could make.
  // The nose-on views have the hull axis pointing at the camera, where the lean is a point and the bend
  // about the axis has the picture to itself, so it is two of the three views that have to carry it.
  console.log('scenario: a damaged panel is not a half-extended one');
  const bend = await page.evaluate(() => {
    const out = { errors: [], weak: [], hulls: 0, least: 1e9, least260: 1e9, worstHull: '' };
    const st = { heat: 0.4, throttle: 0, hull: 1, damage: { nose: 0, flank: 0, tail: 0 },
      systems: { drive: 1, radiators: 1, sensors: 1, weapons: 1 } };
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const sprite = (hull, size, view, parts, rad) => OD.ShipArt.render(hull, { x: 0, y: 0, size, view, rotation: 0,
      faction: 'JC', plume: false, cache: false, light: { az: -50, el: 35 },
      state: Object.assign({}, st, { radiators: rad, parts }) });
    // where panel n's own anchor lands on the screen, in the pixels this sprite is drawn in
    const plate = (sp, n) => {
      const m = sp.marks.filter((q) => q.role === 'rad').sort((a, b) => (a.index || 0) - (b.index || 0))[n];
      return m ? [dot(m.at, sp.cam.R) * sp.scale, -dot(m.at, sp.cam.U) * sp.scale] : null;
    };
    for (const hull of OD.ShipArt.list()) {
      let nm, nr;
      try {
        nm = (OD.ShipArt.preset(hull).mounts || []).length;
        nr = (OD.ShipArt.layout(OD.ShipArt.preset(hull)).rads || []).length;
      } catch (e) { out.errors.push(hull + ' layout: ' + e.message); continue; }
      if (!nr) continue;
      out.hulls++;
      const parts = (v) => {
        const p = { mounts: new Array(Math.max(1, nm)).fill(1), rads: new Array(nr).fill(1), tanks: [1, 1, 1, 1, 1], drive: 1, reactor: 1, sensors: 1 };
        p.rads[0] = v;
        return p;
      };
      for (const size of [120, 260]) {
        const off = {};
        for (const view of ['side', 'top', 'threequarter']) {
          try {
            const hit = plate(sprite(hull, size, view, parts(0.35), 1), 0);
            let best = 1e9;
            for (let i = 0; i <= 40; i++) {
              const q = plate(sprite(hull, size, view, parts(1), i / 40), 0);
              if (hit && q) best = Math.min(best, Math.hypot(hit[0] - q[0], hit[1] - q[1]));
            }
            off[view] = best;
          } catch (e) { out.errors.push(hull + '/' + view + '/' + size + ': ' + e.message); off[view] = 0; }
        }
        // the second-best of the three: what two of the three views carry
        const two = Object.keys(off).map((k) => off[k]).sort((a, b) => b - a)[1];
        if (size === 120) {
          if (two < out.least) { out.least = two; out.worstHull = hull; }
          if (two < 1.5) out.weak.push(hull + ': side ' + off.side.toFixed(1) + ', top ' + off.top.toFixed(1) + ', 3q ' + off.threequarter.toFixed(1) + ' px');
        } else out.least260 = Math.min(out.least260, two);
      }
    }
    return out;
  });
  check('a damaged panel leans where no travelling one can, at a 120 px hull', bend.weak.length === 0 && bend.hulls >= 5,
    bend.hulls + ' hulls with panels, faintest two-of-three ' + (bend.least === 1e9 ? '-' : bend.least.toFixed(1)) + ' px on the '
    + bend.worstHull + ' at 120 px, ' + (bend.least260 === 1e9 ? '-' : bend.least260.toFixed(1)) + ' px at 260'
    + (bend.weak.length ? '; flat: ' + bend.weak.slice(0, 3).join(' | ') : ''));
  check('no throw from the panel states', bend.errors.length === 0, bend.errors.slice(0, 3).join(' | '));

  // ---------------------------------------------------------------- where a shot leaves the hull
  // The map starts a beam at the mount that fired, so muzzle() has to answer in the same canvas
  // coordinates draw() has just used and land on that mount's own anchor — and say null, rather than the
  // middle of the hull, for a mount the camera cannot see.
  console.log('scenario: muzzle points for the map');
  const mz = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 900; c.height = 600;
    const ctx = c.getContext('2d');
    const out = { checked: 0, culled: 0, off: [], wrongNull: [], strayPoint: [], rendered: 0, noMount: 1, unknown: 1 };
    for (const hull of OD.ShipArt.list()) {
      for (const view of ['top', 'threequarter', 'side']) {
        for (const rotation of [0, 0.7]) {
          const o = { x: 450, y: 300, size: 400, view, rotation, faction: 'JC', live: true, simTime: 0,
            fx: { t: 0, aim: 0.7, mounts: [], launches: [], pd: [], vents: [] } };
          OD.ShipArt.draw(ctx, hull, o);
          const sp = OD.ShipArt.render(hull, o);
          if (!sp || !sp.marks) continue;
          const cam = sp.cam, sc = sp.scale, cr = Math.cos(rotation), sr = Math.sin(rotation);
          // the same projection draw() uses, done by hand: ship frame → sprite → rotation → canvas
          const P = (at) => {
            const x = (at[0] * cam.R[0] + at[1] * cam.R[1] + at[2] * cam.R[2]) * sc;
            const y = -(at[0] * cam.U[0] + at[1] * cam.U[1] + at[2] * cam.U[2]) * sc;
            return { x: 450 + (x * cr - y * sr), y: 300 + (x * sr + y * cr) };
          };
          for (const mk of sp.marks) {
            if (mk.role !== 'beam' && mk.role !== 'spinal' && mk.role !== 'coil') continue;
            const n = mk.role === 'beam' ? (mk.up || mk.dir) : mk.dir;
            const seen = Math.max(0, Math.min(1, ((n[0] * cam.D[0] + n[1] * cam.D[1] + n[2] * cam.D[2]) + 0.35) / 0.5)) > 0.02;
            const mount = { id: mk.index, index: 0, kind: mk.role === 'coil' ? 'coilgun' : 'beam', arc: mk.role === 'spinal' ? 'nose' : 'turret', bearing: 0.7 };
            const m = OD.ShipArt.muzzle(hull, o, mount);
            const where = hull + '/' + view + '/' + mk.role + mk.index;
            out.checked++;
            if (!seen) { out.culled++; if (m) out.strayPoint.push(where); continue; }
            if (!m) { out.wrongNull.push(where); continue; }
            // it starts at that mount: at the anchor, or at the end of its barrel, never anywhere else
            const a = P(mk.at);
            const d = Math.hypot(m.x - a.x, m.y - a.y);
            const reach = Math.max(6, (mk.barrel || mk.r || 0) * sc * 1.25);
            if (!(d <= reach)) out.off.push(where + ' ' + d.toFixed(1) + ' px, barrel ' + reach.toFixed(1));
          }
        }
      }
    }
    // the map's own path: drawShip draws her live, and the beam asks for the muzzle from artOpts, which
    // does not carry live. The answer has to be the same point, off the same sprite.
    const oLive = { x: 200, y: 150, size: 300, view: 'top', rotation: 0.4, faction: 'JC', live: true };
    OD.ShipArt.clearCache();
    OD.ShipArt.draw(ctx, 'cruiser', oLive);
    const mLive = OD.ShipArt.muzzle('cruiser', oLive, { id: 0, index: 0, kind: 'beam', bearing: 0.5 });
    const mMap = OD.ShipArt.muzzle('cruiser', Object.assign({}, oLive, { live: false }), { id: 0, index: 0, kind: 'beam', bearing: 0.5 });
    out.mapPath = mLive && mMap ? Math.hypot(mLive.x - mMap.x, mLive.y - mMap.y) : null;
    out.mapPathSprites = OD.ShipArt.cacheStats().sprites;
    // it reads the cache and never renders one of its own: a hull nobody has drawn answers null
    OD.ShipArt.clearCache();
    const m0 = OD.ShipArt.muzzle('cruiser', { x: 0, y: 0, size: 300, view: 'top' }, { id: 0, index: 0, kind: 'beam' });
    out.rendered = OD.ShipArt.cacheStats().sprites;
    out.cold = m0;
    const o2 = { x: 0, y: 0, size: 300, view: 'top', faction: 'JC' };
    OD.ShipArt.draw(ctx, 'freighter', o2);
    out.noMount = OD.ShipArt.muzzle('freighter', o2, { id: 99, index: 3, kind: 'beam' });
    out.unknown = OD.ShipArt.muzzle('freighter', o2, null);
    return out;
  });
  check('muzzle() lands on the mount that fired', mz.off.length === 0, mz.checked + ' mounts, off: ' + mz.off.slice(0, 3).join(' | '));
  check('muzzle() answers for every mount the camera can see', mz.wrongNull.length === 0, mz.wrongNull.slice(0, 3).join(' | '));
  check('muzzle() answers null for a mount on the far side', mz.strayPoint.length === 0, mz.culled + ' culled, stray: ' + mz.strayPoint.slice(0, 3).join(' | '));
  check('muzzle() renders no sprite of its own', mz.cold === null && mz.rendered === 0, 'sprites ' + mz.rendered);
  check('muzzle() answers null for a mount the hull has not got', mz.noMount === null && mz.unknown === null);
  check('muzzle() answers off the live sprite the map drew', mz.mapPath != null && mz.mapPath < 0.001 && mz.mapPathSprites === 1,
    'gap ' + mz.mapPath + ' px, sprites ' + mz.mapPathSprites);

  // ---------------------------------------------------------------- one fresh sprite a frame
  // A sprite is 5 to 56 ms of work. The first frame of a fight asks for every hull at once — eight of them
  // cost 238 to 293 ms — and a squadron coming about asks for one each. With the caller's frame counter in
  // opts.frame only the first cold render of a frame is paid for: the rest are drawn from the nearest
  // sprite in hand, and a hull with nothing in hand at all is not drawn at all — draw() answers false and
  // the caller draws its icon for that hull this frame. The queue drains one hull a frame.
  console.log('scenario: one cold sprite a frame');
  const cap = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 900; c.height = 600;
    const ctx = c.getContext('2d');
    const hulls = OD.ShipArt.list();
    const cold = (fn) => { const a = OD.ShipArt.cacheStats(); fn(); const z = OD.ShipArt.cacheStats(); return (z.sprites - a.sprites) + (z.evictions - a.evictions); };
    const opts = (f, light) => ({ x: 450, y: 300, size: 200, view: 'top', rotation: 0, faction: 'JC', frame: f, light: { az: light, el: 30 } });
    OD.ShipArt.clearCache();
    const perFrame = [], drewPerFrame = [], answers = [];
    // the light turns with the frame, as it does on the map: every hull misses its exact sprite every frame
    for (let f = 0; f < hulls.length + 1; f++) {
      perFrame.push(cold(() => {
        let n = 0;
        for (const h of hulls) { const r = OD.ShipArt.draw(ctx, h, opts(f, f * 45)); answers.push(r); if (r) n++; }
        drewPerFrame.push(n);
      }));
    }
    // the same frame number twice over is still one frame's worth
    const twice = cold(() => { for (const h of hulls) OD.ShipArt.draw(ctx, h, opts(99, 300)); for (const h of hulls) OD.ShipArt.draw(ctx, h, opts(99, 330)); });
    // what a frame costs when every hull is cold: the first frame of a fight, timed
    OD.ShipArt.clearCache();
    const t0 = performance.now();
    for (const h of hulls) OD.ShipArt.draw(ctx, h, opts(500, 0));
    const firstFrameMs = +(performance.now() - t0).toFixed(1);
    // …and what the same frame costs uncapped, which is the stall this cap exists to stop
    OD.ShipArt.clearCache();
    const t1 = performance.now();
    for (const h of hulls) OD.ShipArt.draw(ctx, h, { x: 450, y: 300, size: 200, view: 'top', faction: 'JC', light: { az: 0, el: 30 } });
    const uncappedMs = +(performance.now() - t1).toFixed(1);
    // without a frame counter nothing is capped: a tool or the configurator renders what it asks for
    OD.ShipArt.clearCache();
    const unstamped = cold(() => { for (const h of hulls) OD.ShipArt.draw(ctx, h, { x: 450, y: 300, size: 200, view: 'top', faction: 'JC', light: { az: 12, el: 30 } }); });
    return { hulls: hulls.length, perFrame, drewPerFrame, twice, unstamped, firstFrameMs, uncappedMs,
      boolean: answers.every((r) => r === true || r === false), lastFrameAll: drewPerFrame[drewPerFrame.length - 1] === hulls.length, stats: OD.ShipArt.cacheStats() };
  });
  check('a frame renders at most one cold sprite', cap.perFrame.every((n) => n <= 1) && cap.twice <= 1,
    'by frame: ' + cap.perFrame.join(' ') + ', one frame twice over: ' + cap.twice);
  check('a hull with no sprite in hand is declined, not rendered', cap.boolean && cap.drewPerFrame[0] === 1,
    'drawn by frame: ' + cap.drewPerFrame.join(' ') + ' of ' + cap.hulls);
  check('every hull is drawn once the queue has drained', cap.lastFrameAll, cap.drewPerFrame.join(' '));
  check('a cold first frame costs one render, not every hull', cap.firstFrameMs < cap.uncappedMs * 0.6,
    'capped ' + cap.firstFrameMs + ' ms vs uncapped ' + cap.uncappedMs + ' ms for ' + cap.hulls + ' hulls');
  check('no frame counter, no cap', cap.unstamped === cap.hulls, cap.unstamped + ' of ' + cap.hulls);

  // ---------------------------------------------------------------- a real fight
  console.log('scenario: a skirmish at close range');
  const ids = await page.evaluate(() => OD.harness.start(OD.Skirmish.build({
    player: 'JC', env: 'deep', range: 100, seed: 7,
    playerShips: { cruiser: 1, destroyer: 1 }, enemyShips: { destroyer: 1, corvette: 2 },
  }), { mode: 'Skirmish' }));
  check('ships spawned', ids.length === 5, ids.join(', '));
  const me = ids[0];
  await page.evaluate((id) => {
    const sim = OD.Game.sim;
    OD.harness.select(id);
    OD.UI.engKey('w'); OD.UI.engKey('w'); // through the panel's own key, twice, so it ends weapons free
    // every hull on both sides is in the fight, with a target and her bays on the doctrine
    for (const s of sim.ships) {
      s.weaponsFree = true;
      if (s.faction === sim.playerFaction) s.autoBays = true;
      let best = null, bd = Infinity;
      for (const q of sim.ships) { if (q === s || !sim.isHostile(q, s)) continue; const d = OD.U.dist(q.pos, s.pos); if (d < bd) { bd = d; best = q; } }
      if (best) sim.setTarget(s.id, best.id);
    }
  }, me);
  const free = await page.evaluate((id) => !!OD.Game.sim.byId(id).weaponsFree, me);
  check('weapons free through OD.UI.engKey', free);

  // Zoom until the hull is well past 200 px, put her in the clear and draw the frame a shot is taken of.
  async function focus(id, wantPx) {
    return page.evaluate((a) => {
      const sim = OD.Game.sim, s = sim.byId(a.id);
      // a decision card would sit over the hull the shot is of
      if (OD.Decisions) for (let i = 0; i < 8; i++) { const d = OD.Decisions.current(sim); if (!d) break; OD.Decisions.dismiss(sim, d.id); }
      // follow her: the page keeps drawing after this call returns, and a camera that is not following
      // one hull refits itself to the whole board between the draw and the screenshot
      OD.Game.cam.follow = s.id;
      OD.Game.cam.zoom = a.want / s.length;
      OD.Game.cam.x = s.pos.x; OD.Game.cam.y = s.pos.y;
      try { OD.UI.refresh(sim, performance.now() + 1000); } catch (e) { /* the panel is not the point */ }
      OD.Render.draw(sim, OD.Game.cam, OD.UI);
      return { px: s.length * OD.Game.cam.zoom, name: s.name };
    }, { id, want: wantPx });
  }
  const f = await focus(me, 260);
  check('camera zoomed to a 200 px hull and more', f.px >= 200, Math.round(f.px) + ' px on ' + f.name);

  // ---------------------------------------------------------------- effects come out of the fight itself
  console.log('scenario: the fight reports what the art draws');
  const seen = { beam: 0, coilgun: 0, launch: 0, pd: 0, vent: 0 };
  const shots = {};
  let shotAt = -1;
  // one picture a moment: a substep where a beam and a slug both report would otherwise save the same frame twice
  async function shot(name, t, px) {
    if (shots[name] || t === shotAt) return;
    shots[name] = true;
    shotAt = t;
    await focus(me, px || 520);
    await page.screenshot({ path: path.join(SHOTS, name + '.png') });
  }
  const gotShots = () => ['02-beam-firing', '03-slug-away', '04-launch', '05-point-defence'].every((n) => shots[n]);
  let worst = 0, frames = 0, total = 0, renderError = null;
  let dirty = 0;
  const warmMs = [];
  const muzzles = [];
  for (let i = 0; i < 160; i++) {
    const r = await page.evaluate((id) => {
      OD.harness.step(2, 1);
      const sim = OD.Game.sim, s = sim.byId(id);
      const mine = OD.Engagement.artFx(s, sim);
      const out = { t: sim.time, kinds: {}, ms: 0, rad: s.radiators.state, error: OD.Render.lastError, dead: !!s.destroyed };
      for (const m of mine.mounts) out.kinds[m.kind] = (out.kinds[m.kind] || 0) + 1;
      out.kinds.launch = mine.launches.length;
      out.kinds.pd = mine.pd.length;
      out.kinds.vent = mine.vents.length;
      // What one hull costs to draw and then overlay, at the size the map is using. Two costs, and they
      // are not the same thing: a frame that has the sprite in hand blits it and paints the effects over
      // it, and that is what every frame but the first of a picture pays; a frame that has to build the
      // sprite pays for a render as well, which is tens of times more and happens once a bucket. Timing
      // them together gives a number that is neither, and it is the warm path that has to hold a frame
      // budget. So: warm the sprite and the overlay's own look-up first, count the builds the sprite
      // cache does during the timed run (a run that built anything is thrown out of the warm figure and
      // reported as cold), and time a build on its own with the cache switched off.
      const c = document.createElement('canvas'); c.width = 700; c.height = 500;
      const ctx = c.getContext('2d');
      const o = OD.Render.artOpts(s, sim, { x: 350, y: 250, size: 260, view: 'top', rotation: -s.heading, live: true });
      const art = OD.Render.artId(s);
      OD.ShipArt.draw(ctx, art, o); OD.ShipArt.overlay(ctx, art, o);
      OD.ShipArt.draw(ctx, art, o); OD.ShipArt.overlay(ctx, art, o);
      const stats0 = OD.ShipArt.cacheStats();
      const t0 = performance.now();
      for (let k = 0; k < 20; k++) { OD.ShipArt.draw(ctx, art, o); OD.ShipArt.overlay(ctx, art, o); }
      out.ms = (performance.now() - t0) / 20;
      out.stats = OD.ShipArt.cacheStats();
      out.built = out.stats.builds == null || stats0.builds == null ? null : out.stats.builds - stats0.builds;
      // where the map would start this ship's beams: through render.js's own helper, on the live camera
      const firing = mine.mounts.filter((m) => m.kind === 'beam')[0];
      if (firing && OD.Render.muzzleOf) {
        const m = OD.Render.muzzleOf(sim, OD.Game.cam, s, firing);
        const at = OD.Game.cam.toScreen(s.pos);
        if (m) out.muzzle = { d: Math.hypot(m.x - at.x, m.y - at.y), half: (s.length * OD.Game.cam.zoom) / 2 };
      }
      return out;
    }, me);
    if (r.error) { renderError = r.error; break; }
    if (r.dead) break;
    if (r.built) { dirty++; } else { total += r.ms; frames++; worst = Math.max(worst, r.ms); warmMs.push(r.ms); }
    if (r.kinds.beam) { seen.beam++; await shot('02-beam-firing', r.t); }
    if (r.muzzle) { muzzles.push(r.muzzle); }
    if (r.kinds.coilgun) { seen.coilgun++; await shot('03-slug-away', r.t); }
    if (r.kinds.launch) { seen.launch++; await shot('04-launch', r.t); }
    if (r.kinds.pd) { seen.pd++; await shot('05-point-defence', r.t); }
    if (r.kinds.vent) { seen.vent++; await shot('06-venting', r.t); }
    // her bays, on the panel's own key, once there is something worth spending them on
    if (i === 12) await page.evaluate((id) => { OD.harness.select(id); OD.UI.engKey('a'); }, me);
    if (gotShots() && shots['06-venting']) break;
  }
  check('no render error during the fight', !renderError, String(renderError));
  check('beam mounts reported firing', seen.beam > 0, 'substeps ' + seen.beam);
  check('coilguns reported off the rails', seen.coilgun > 0, 'substeps ' + seen.coilgun);
  check('interceptors reported away', seen.launch > 0, 'substeps ' + seen.launch);
  check('point defence reported burning', seen.pd > 0, 'substeps ' + seen.pd);
  // Each substep's figure is already the mean of twenty draws, and every one of them had the sprite in
  // hand — so what is left to go wrong is the machine, not the art: a substep where the box was busy
  // elsewhere lands a millisecond high on its own. The budget is held at the 95th of those figures, with
  // the worst reported beside it and a coarse ceiling on it, so a real doubling of the cost still fails
  // while one busy substep in a hundred and sixty does not.
  warmMs.sort((a, b) => a - b);
  const p95 = warmMs.length ? warmMs[Math.min(warmMs.length - 1, Math.floor(warmMs.length * 0.95))] : 99;
  check('draw + overlay under 1 ms a ship', p95 < 1 && worst < 3 && frames > 20,
    'warm: 95th ' + p95.toFixed(3) + ' ms, mean ' + (total / Math.max(1, frames)).toFixed(3) + ' ms, worst ' + worst.toFixed(3)
    + ' ms over ' + frames + ' substeps' + (dirty ? ', ' + dirty + ' thrown out for building a sprite' : ', none built a sprite'));
  // A build is a different animal and gets its own budget. It is a few hundred polygons shaded and
  // composited into a fresh canvas — tens of milliseconds, not a frame's worth — which is exactly why a
  // frame is allowed only one of them and why a hull with nothing in hand is declined rather than
  // rendered (the cold-frame cap above). What has to hold is that the queue drains: at one build a frame
  // a seven-hull fight has all its pictures inside about a second. Measured on its own, after the fight
  // and with nothing else running, on the median of nine builds — a mean would follow whatever else the
  // machine was doing, and the worst of nine is that noise rather than the cost.
  const coldMs = await page.evaluate((id) => {
    const sim = OD.Game.sim, s = sim.byId(id);
    const c = document.createElement('canvas'); c.width = 700; c.height = 500;
    const ctx = c.getContext('2d');
    const o = Object.assign(OD.Render.artOpts(s, sim, { x: 350, y: 250, size: 260, view: 'top', rotation: 0, live: true }), { cache: false });
    const ms = [];
    for (let k = 0; k < 9; k++) { const t = performance.now(); OD.ShipArt.draw(ctx, OD.Render.artId(s), o); ms.push(performance.now() - t); }
    ms.sort((a, b) => a - b);
    return { min: ms[0], med: ms[4], max: ms[8], hull: s.cls };
  }, me);
  check('a cold sprite build inside its own budget', coldMs.med < 90 && coldMs.med > 0,
    'cold: ' + coldMs.med.toFixed(1) + ' ms for a 260 px ' + coldMs.hull + ' (9 builds, ' + coldMs.min.toFixed(1) + ' to ' + coldMs.max.toFixed(1)
    + ' ms), so seven hulls have their pictures inside ' + Math.round(coldMs.med * 7) + ' ms at one build a frame');
  // a beam starts on the hull that fired it, not at her centre and not off in the dark
  check('the map has a muzzle to start a beam from', muzzles.length > 0 && muzzles.every((m) => m.d > 0.5 && m.d < m.half * 1.2),
    muzzles.length + ' reports, worst ' + (muzzles.length ? Math.round(Math.max.apply(null, muzzles.map((m) => m.d))) : '-') + ' px from the centre, half-hull ' + (muzzles.length ? Math.round(muzzles[0].half) : '-') + ' px');

  // a tank holed by hand, so the vent jet can be seen without waiting for the fight to find one
  if (!shots['06-venting']) {
    await page.evaluate((id) => {
      const s = OD.Game.sim.byId(id);
      const t = (s.components || []).filter((c) => c.kind === 'tank')[0];
      if (t) { t.hp = 0.2; OD.Damage.aggregate(s); }
    }, me);
    for (let i = 0; i < 8 && !seen.vent; i++) {
      const v = await page.evaluate((id) => { OD.harness.step(2, 1); const sim = OD.Game.sim; return OD.Engagement.artFx(sim.byId(id), sim).vents.length; }, me);
      if (v) { seen.vent++; await shot('06-venting', -2 - i); }
    }
  }
  check('a holed tank is reported venting', seen.vent > 0);

  // ---------------------------------------------------------------- the radiators, and what they cost the cache
  console.log('scenario: radiators travelling, and the sprite cache');
  const cyc = await page.evaluate((id) => {
    const sim = OD.Game.sim, s = sim.byId(id);
    OD.ShipArt.clearCache();
    const seen = new Set();
    const out = { states: [], peak: 0, peakBytes: 0 };
    const run = (deployed, n) => {
      sim.setRadiators(s.id, deployed);
      for (let i = 0; i < n; i++) {
        OD.harness.step(3, 1);
        OD.Game.cam.zoom = 260 / s.length; OD.Game.cam.x = s.pos.x; OD.Game.cam.y = s.pos.y;
        OD.Render.draw(sim, OD.Game.cam, OD.UI);
        seen.add(Math.round(s.radiators.state * 100) / 100);
        out.states.push(Math.round(s.radiators.state * 100) / 100);
        const st = OD.ShipArt.cacheStats();
        out.peak = Math.max(out.peak, st.sprites); out.peakBytes = Math.max(out.peakBytes, st.bytes);
      }
    };
    run(false, 22);
    out.mid = s.radiators.state;
    run(true, 24);
    out.steps = seen.size;
    out.end = OD.ShipArt.cacheStats();
    return out;
  }, me);
  check('the panels travel in many steps, not a jump', cyc.steps >= 8, cyc.steps + ' distinct states: ' + cyc.states.slice(0, 12).join(' '));
  check('sprite cache stays under its ceiling', cyc.peak <= cyc.end.maxSprites && cyc.peakBytes <= cyc.end.maxBytes,
    'peak ' + cyc.peak + ' sprites / ' + (cyc.peakBytes / 1e6).toFixed(1) + ' MB, ceiling ' + cyc.end.maxSprites + ' / ' + (cyc.end.maxBytes / 1e6).toFixed(0) + ' MB');
  console.log('        cache at the end of the fight: ' + cyc.end.sprites + ' sprites, ' + (cyc.end.bytes / 1e6).toFixed(2) + ' MB, ' + cyc.end.evictions + ' evicted');

  // a picture with the panels part way in
  const mid = await page.evaluate((id) => {
    const sim = OD.Game.sim, s = sim.byId(id);
    sim.setRadiators(s.id, false);
    for (let i = 0; i < 10; i++) OD.harness.step(3, 1);
    return s.radiators.state;
  }, me);
  await focus(me, 520);
  await page.screenshot({ path: path.join(SHOTS, '01-radiators-travelling.png') });
  check('a picture with the panels part way', mid > 0.05 && mid < 0.8, 'radiators at ' + mid.toFixed(2));
  check('a picture of each thing the hull is doing', ['01-radiators-travelling', '02-beam-firing', '03-slug-away', '04-launch', '05-point-defence', '06-venting']
    .every((n) => fs.existsSync(path.join(SHOTS, n + '.png'))), Object.keys(shots).sort().join(' '));

  // ---------------------------------------------------------------- effects are on the sim clock
  console.log('scenario: effects age on the sim clock');
  const clock = await page.evaluate((id) => {
    const sim = OD.Game.sim, s = sim.byId(id);
    const a = OD.Engagement.artFx(s, sim);
    const t0 = a.t;
    const before = JSON.stringify(OD.Engagement.artFx(s, sim));
    const after = new Promise(() => {});
    void after;
    return { t0, same: before === JSON.stringify(OD.Engagement.artFx(s, sim)), simTime: sim.time };
  }, me);
  check('artFx is stamped with sim time', Math.abs(clock.t0 - clock.simTime) < 1e-6, 't ' + clock.t0 + ' sim ' + clock.simTime);
  check('artFx does not change while the sim is stopped', clock.same);

  const realErrors = errors.filter((e) => !/fonts|ERR_INTERNET|net::ERR|Failed to load resource|Access to font/.test(e));
  check('no console errors', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));
  const lastError = await page.evaluate(() => OD.Render.lastError);
  check('no render error at the end', !lastError, String(lastError));

  console.log('\nshots in ' + SHOTS);
  console.log(failures ? failures + ' FAILED' : 'all checks passed');
  await browser.close();
  process.exit(failures ? 1 : 0);
})();
