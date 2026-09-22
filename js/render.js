/* Orbital Declaration — Canvas 2D renderer. World y is up; screen y is down.
   Everything that does not move (star fields, nebula, sun glare, body textures, plume sprite) is drawn once into a
   cached canvas and blitted each frame; per-frame gradients are kept for things that move with the camera. */
(function () {
  'use strict';
  const OD = window.OD;
  const U = OD.U, P = OD.P;

  // Amber (#f0a04b) is the ISA faction colour and means nothing else on the map: braking, an unidentified contact
  // and a ship that is out of action all use `steel`, a neutral blue-grey.
  const COLORS = {
    ink: '#d7e0ea', dim: '#7f8ea3', faint: 'rgba(127,142,163,0.35)', grid: 'rgba(120,150,190,0.12)',
    warn: '#ffb454', crit: '#ff5d5d', good: '#7ad97a', select: '#ffffff', plume: '#9fd8ff',
    accent: '#4fd1c5', blue: '#7fb8ff', brake: '#8fa6bf', steel: '#8fa6bf', unknown: '#9db4cc', target: '#e8eef5',
  };
  // One treatment per ring family, so no two kinds of ring read alike: an uncertainty is a soft disc and is never
  // stroked, every reach (point defence, interceptor, active sensor) is dashed, the signature ring is dotted, a
  // standing order's ring is long-dashed and the selection ring is solid and thin. Burn-through ranges are ticks
  // on the bearing line (see drawLadder) and draw no ring at all.
  const RING = {
    reach: { dash: [6, 5], width: 1.2 },
    signature: { dash: [1, 5], width: 1.4, cap: 'round' },
    order: { dash: [13, 8], width: 1 },
    select: { dash: [], width: 1.2 },
  };
  const MONO = '"IBM Plex Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace';
  const F12 = '12px ' + MONO, F12B = '500 12px ' + MONO, F13B = '500 13px ' + MONO;

  class Camera {
    constructor() { this.x = 0; this.y = 0; this.zoom = 1e-4; this.follow = null; this.w = 1; this.h = 1; this.dpr = 1; this.targetZoom = null; }
    toScreen(p) { return { x: this.w / 2 + (p.x - this.x) * this.zoom, y: this.h / 2 - (p.y - this.y) * this.zoom }; }
    toWorld(sx, sy) { return { x: this.x + (sx - this.w / 2) / this.zoom, y: this.y - (sy - this.h / 2) / this.zoom }; }
    zoomAt(factor, sx, sy) {
      const before = this.toWorld(sx, sy);
      this.zoom = U.clamp(this.zoom * factor, 2e-8, 2.5);
      const after = this.toWorld(sx, sy);
      this.x += before.x - after.x; this.y += before.y - after.y;
    }
    fit(points, margin = 0.72) {
      if (!points.length) return;
      let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
      for (const p of points) { minx = Math.min(minx, p.x); maxx = Math.max(maxx, p.x); miny = Math.min(miny, p.y); maxy = Math.max(maxy, p.y); }
      const w = Math.max(maxx - minx, 1e4), h = Math.max(maxy - miny, 1e4);
      // Fit into the part of the canvas the HUD panels leave clear (inset in canvas pixels), not the whole canvas.
      const ins = this.inset || { l: 0, r: 0, t: 0, b: 0 };
      // a phone with a band open leaves about a third of the height free: that is still the honest place to fit
      const cw = Math.max(this.w * 0.25, this.w - ins.l - ins.r), ch = Math.max(this.h * 0.25, this.h - ins.t - ins.b);
      const l = cw < this.w - ins.l - ins.r + 1 ? ins.l : (this.w - cw) / 2, t = ch < this.h - ins.t - ins.b + 1 ? ins.t : (this.h - ch) / 2;
      this.zoom = U.clamp(Math.min((cw * margin) / w, (ch * margin) / h), 2e-8, 2.5);
      const cx = (minx + maxx) / 2, cy = (miny + maxy) / 2;
      this.x = cx - (l + cw / 2 - this.w / 2) / this.zoom;
      this.y = cy + (t + ch / 2 - this.h / 2) / this.zoom;
      this.follow = null;
    }
  }

  let canvas, ctx;
  let frame = 0;
  let reduced = false; // prefers-reduced-motion: static equivalents for flicker, rotation and pulsing
  let artBroken = false; // set once OD.ShipArt.draw throws; the built-in hull drawing takes over

  // What the ship-art module needs to know about a ship right now. light: angle in the ship frame
  // (+x nose, y down on screen), so the vector toward the light is (cos, sin).
  // Per-facet wear for the art: the damage module's record when present, else a guess from hull and drive.
  function damageFor(ship) {
    if (OD.Damage && OD.Damage.artState) { try { const d = OD.Damage.artState(ship); if (d && d.damage) return d.damage; } catch (e) { /* fall through */ } }
    return { nose: 0, flank: 1 - ship.hull, tail: 1 - (ship.systems.drive != null ? ship.systems.drive : 1) };
  }
  function artState(ship, sim, light, t, extra) {
    return Object.assign({
      radiators: ship.radiators.state, throttle: ship.throttle, heat: ship.thermalLoad(), hull: ship.hull,
      systems: ship.systems, damage: damageFor(ship),
      prop: ship.fullPropMass ? ship.propMass / ship.fullPropMass : 1,
      disabled: !!ship.disabled, destroyed: !!ship.destroyed, captured: !!ship.captured, faction: ship.faction,
      light, lightVec: { x: Math.cos(light), y: Math.sin(light) }, t: t || 0, simTime: sim ? sim.time : 0, detail: 1, reducedMotion: reduced,
    }, extra || {});
  }
  function artReady(id) {
    if (artBroken || !(OD.ShipArt && typeof OD.ShipArt.draw === 'function')) return false;
    if (id == null || typeof OD.ShipArt.has !== 'function') return true;
    // a configurator design draws as its own object, gated on the hull family it is based on
    const family = typeof id === 'object' ? (id.base || id.artBase) : id;
    return !family || OD.ShipArt.has(family);
  }
  // What ShipArt draws for a ship: a configurator design is passed as its own object, a stock hull by id
  // (artBase, when a design names one, picks the hull family).
  function artId(ship) { const c = OD.Ships.CLASSES[ship.cls]; if (c && c.custom) return c; return (c && c.artBase) || ship.artBase || ship.cls; }
  // What this ship's fittings are doing this instant, from the engagement module: mounts firing, bays
  // launching, point defence burning, tanks venting. A page without the module draws no effects and a
  // throw from it costs the hull nothing but its effects.
  const PARTY_AMBER = '#ffbd52';
  // The plain name of a part for a label: the damage module's when it has one, the id otherwise.
  function partWord(ship, id) {
    try {
      const c = (ship.components || []).find((q) => q.id === id);
      if (c && OD.Damage && typeof OD.Damage.plainName === 'function') { const w = OD.Damage.plainName(c); if (typeof w === 'string' && w) return w.toLowerCase(); }
      if (c && c.name) return String(c.name).toLowerCase();
    } catch (e) { /* label only */ }
    return String(id).replace(/(\d+)$/, ' $1');
  }
  function shipFx(ship, sim) {
    if (!sim || !ship) return null;
    let fx = null;
    if (OD.Engagement && typeof OD.Engagement.artFx === 'function') {
      try { fx = OD.Engagement.artFx(ship, sim); } catch (e) { Render.lastError = 'ship art fx: ' + (e && e.message); fx = null; }
    }
    // The crew's parties on the hull (v13): merged in so the overlay draws them beside the fire.
    // Only our own hulls show their parties: a hostile's damage control is hers to know.
    if (OD.Crew && typeof OD.Crew.artFx === 'function' && ship.faction === sim.playerFaction) {
      try { const c = OD.Crew.artFx(ship); if (c && c.parties && c.parties.length) { fx = fx || { t: sim.time, aim: null, mounts: [], launches: [], pd: [], vents: [] }; fx.parties = c.parties; fx.strapped = !!c.strapped; } } catch (e) { Render.lastError = 'crew art fx: ' + (e && e.message); }
    }
    return fx;
  }
  // Options for OD.ShipArt.draw and for the overlay that follows it (see the interface block at the top
  // of js/shipart.js). fx is what she is doing and simTime is the clock the art ages it against — the
  // sim's own, so effects hold at warp 0 and are brief at 16x. A caller draws with this object and then
  // overlays with the same one; add live: true and the overlay draws the beam turrets' barrels where
  // gunnery is holding them.
  function artOpts(ship, sim, extra) {
    const base = typeof OD.ShipArt.stateFromShip === 'function' ? OD.ShipArt.stateFromShip(ship, sim) : { faction: ship.faction, state: artState(ship, sim, 0, 0) };
    const t = sim ? sim.time : 0;
    return Object.assign({ x: 0, y: 0, size: 200, view: 'top', rotation: 0, plume: false, time: t, cache: true, simTime: t, frame, fx: shipFx(ship, sim) }, base, extra || {});
  }
  // Where a mount's muzzle is on screen when the hull is drawn at art size (the map's top view, rotated to the
  // heading, as drawShip draws it), or null when the hull is an icon, the art is not ready, or the mount is on
  // the far side. `mount` is one of artFx's mounts ({ id, index, kind }). Beams start here instead of the centre.
  function muzzleOf(sim, cam, ship, mount) {
    if (!ship || !cam || typeof OD.ShipArt.muzzle !== 'function') return null;
    const L = ship.length * cam.zoom;
    if (L < (ship.role === 'station' ? 60 : 40) || !artReady(artId(ship))) return null;
    try {
      const o = artOpts(ship, sim, { x: 0, y: 0, size: L, view: 'top', rotation: -ship.heading, plume: false });
      const m = OD.ShipArt.muzzle(artId(ship), o, mount);
      if (!m || !isFinite(m.x) || !isFinite(m.y)) return null;
      const s = cam.toScreen(ship.pos);
      return { x: s.x + m.x, y: s.y + m.y };
    } catch (e) { return null; }
  }
  // Half the hull's extent on screen along a given screen direction, so a beam can end on the hull's edge rather
  // than its centre: an ellipse of the hull's length and a quarter of it, turned to the heading.
  function hullEdge(cam, ship, dirX, dirY) {
    const L = ship.length * cam.zoom;
    if (L < 40) return 0;
    const a = -ship.heading, ux = Math.cos(a), uy = Math.sin(a);
    const along = Math.abs(dirX * ux + dirY * uy), across = Math.abs(-dirX * uy + dirY * ux);
    return (L / 2) * along + (L * 0.14) * across;
  }
  const trails = new Map(); // ship id → { simId, t, pts: [{x,y,burn}] }
  const cache = { far: null, near: null, nebula: null, glare: null, glareKey: '', plume: null, glow: null, bodyTex: new Map(), shade: null, shadeKey: '', backdrop: null, backdropKey: '', vignette: null, sizeKey: '' };

  // ---- colour helpers (hexA is used by other modules; keep its behaviour) ----
  function hexA(hex, a) {
    if (hex.startsWith('rgba')) return hex;
    const n = parseInt(hex.slice(1), 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }
  function mix(hex, to, t) {
    const n = parseInt(hex.slice(1), 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const f = (c) => Math.round(c + (to - c) * t);
    return 'rgb(' + f(r) + ',' + f(g) + ',' + f(b) + ')';
  }
  const lighten = (h, t) => mix(h, 255, t), darken = (h, t) => mix(h, 0, t);
  function rgbOf(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function blend(hexA_, hexB_, t) { const a = rgbOf(hexA_), b = rgbOf(hexB_); return 'rgb(' + Math.round(a[0] + (b[0] - a[0]) * t) + ',' + Math.round(a[1] + (b[1] - a[1]) * t) + ',' + Math.round(a[2] + (b[2] - a[2]) * t) + ')'; }
  function mk(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  // Heat tint for radiators: dull red at idle through orange to yellow-white when the sink is nearly full.
  function heatTint(load) {
    if (load < 0.25) return blend('#5a2420', '#b03a26', load / 0.25);
    if (load < 0.6) return blend('#b03a26', '#ff8c3a', (load - 0.25) / 0.35);
    if (load < 0.85) return blend('#ff8c3a', '#ffd27a', (load - 0.6) / 0.25);
    return blend('#ffd27a', '#fff6dc', (load - 0.85) / 0.15);
  }

  // ---- cached sprites ----
  const TILE = 1024;
  function buildStars(seed, count, bright) {
    const c = mk(TILE, TILE), g = c.getContext('2d');
    const rng = U.rng(seed);
    for (let i = 0; i < count; i++) {
      const x = rng() * TILE, y = rng() * TILE, m = rng();
      const r = m < 0.8 ? 0.55 : m < 0.95 ? 0.9 : m < 0.99 ? 1.4 : 2.1;
      const tint = rng();
      const col = tint < 0.55 ? '255,255,255' : tint < 0.78 ? '196,216,255' : tint < 0.92 ? '255,232,204' : '255,196,176';
      const a = bright * (0.35 + rng() * 0.65) * (r > 1.3 ? 1 : 0.8);
      g.fillStyle = 'rgba(' + col + ',' + a.toFixed(3) + ')';
      g.beginPath(); g.arc(x, y, r * bright, 0, U.TAU); g.fill();
      if (r > 1.3 && bright > 0.8) { // a soft halo and a cross flare on the brightest few
        const hg = g.createRadialGradient(x, y, 0, x, y, r * 5);
        hg.addColorStop(0, 'rgba(' + col + ',0.35)'); hg.addColorStop(1, 'rgba(' + col + ',0)');
        g.fillStyle = hg; g.beginPath(); g.arc(x, y, r * 5, 0, U.TAU); g.fill();
      }
    }
    return c;
  }
  // A soft nebula band on a tile that wraps: each blob is stamped at the eight neighbouring offsets too.
  function buildNebula() {
    const S = 512, c = mk(S, S), g = c.getContext('2d');
    const rng = U.rng(23);
    const stamp = (x, y, r, col, a) => {
      for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
        const cx = x + ox * S, cy = y + oy * S;
        if (cx + r < 0 || cy + r < 0 || cx - r > S || cy - r > S) continue;
        const gr = g.createRadialGradient(cx, cy, 0, cx, cy, r);
        gr.addColorStop(0, hexA(col, a)); gr.addColorStop(0.5, hexA(col, a * 0.35)); gr.addColorStop(1, hexA(col, 0));
        g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, r, 0, U.TAU); g.fill();
      }
    };
    // a diagonal band of cool blue with a warm streak and teal wisps
    for (let i = 0; i < 26; i++) {
      const t = i / 26, x = t * S, y = (0.62 - 0.42 * t) * S + (rng() - 0.5) * 90;
      stamp(x, y, 60 + rng() * 120, i % 5 === 2 ? '#3a4a8c' : '#243a6e', 0.16 + rng() * 0.08);
    }
    for (let i = 0; i < 10; i++) { const t = rng(); stamp(t * S, (0.6 - 0.4 * t) * S + (rng() - 0.5) * 50, 30 + rng() * 60, '#6b3a5a', 0.1); }
    for (let i = 0; i < 8; i++) { const t = rng(); stamp(t * S, (0.62 - 0.42 * t) * S + (rng() - 0.5) * 120, 20 + rng() * 50, '#2c6f7a', 0.12); }
    return c;
  }
  function buildGlare(R) {
    const c = mk(R * 2, R * 2), g = c.getContext('2d');
    const gr = g.createRadialGradient(R, R, 0, R, R, R);
    gr.addColorStop(0, 'rgba(255,246,225,0.95)'); gr.addColorStop(0.04, 'rgba(255,238,205,0.7)'); gr.addColorStop(0.14, 'rgba(255,214,160,0.28)');
    gr.addColorStop(0.4, 'rgba(255,190,130,0.09)'); gr.addColorStop(1, 'rgba(255,170,110,0)');
    g.fillStyle = gr; g.fillRect(0, 0, R * 2, R * 2);
    // a faint horizontal streak, as a lens would give
    const st = g.createLinearGradient(0, R, R * 2, R);
    st.addColorStop(0, 'rgba(255,220,180,0)'); st.addColorStop(0.5, 'rgba(255,230,200,0.25)'); st.addColorStop(1, 'rgba(255,220,180,0)');
    g.fillStyle = st; g.fillRect(0, R - R * 0.012, R * 2, R * 0.024);
    return c;
  }
  // Plume sprite: nozzle at the left edge, exhaust flowing to +x. Three layers composed additively.
  function buildPlume() {
    const W = 512, H = 128, c = mk(W, H), g = c.getContext('2d');
    g.globalCompositeOperation = 'lighter';
    const cone = (len, half, stops) => {
      const gr = g.createLinearGradient(0, 0, len, 0);
      stops.forEach(([p, col]) => gr.addColorStop(p, col));
      g.fillStyle = gr; g.beginPath(); g.moveTo(0, H / 2 - half); g.quadraticCurveTo(len * 0.45, H / 2 - half * 0.5, len, H / 2); g.quadraticCurveTo(len * 0.45, H / 2 + half * 0.5, 0, H / 2 + half); g.closePath(); g.fill();
    };
    cone(W, 30, [[0, 'rgba(90,140,255,0.32)'], [0.3, 'rgba(90,140,255,0.16)'], [1, 'rgba(60,110,255,0)']]);            // outer haze
    cone(W * 0.55, 18, [[0, 'rgba(170,215,255,0.85)'], [0.35, 'rgba(140,195,255,0.45)'], [1, 'rgba(120,180,255,0)']]);  // inner cone
    cone(W * 0.28, 8, [[0, 'rgba(255,255,255,1)'], [0.4, 'rgba(230,245,255,0.8)'], [1, 'rgba(200,235,255,0)']]);         // hot core
    // shock diamonds along the core
    for (let i = 0; i < 4; i++) { const x = W * (0.03 + i * 0.05), r = 6 - i; const gr = g.createRadialGradient(x, H / 2, 0, x, H / 2, r * 1.6); gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.beginPath(); g.arc(x, H / 2, r * 1.6, 0, U.TAU); g.fill(); }
    return c;
  }
  function buildGlow() {
    const S = 64, c = mk(S, S), g = c.getContext('2d');
    const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(210,235,255,0.55)'); gr.addColorStop(0.6, 'rgba(150,200,255,0.14)'); gr.addColorStop(1, 'rgba(120,180,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, S, S);
    return c;
  }

  // ---- body texture: drawn once per body name, blitted through a circular clip ----
  const TEX = 1024;
  function bodyTexture(body) {
    let tex = cache.bodyTex.get(body.name);
    if (tex) return tex;
    tex = mk(TEX, TEX);
    const g = tex.getContext('2d'), R = TEX / 2;
    const base = body.color;
    const rng = U.rng(body.name.length * 977 + body.name.charCodeAt(0));
    g.fillStyle = base; g.fillRect(0, 0, TEX, TEX);
    if (body.kind === 'gas') {
      // cloud belts with wobble, then streaks and a great spot
      const nb = 26;
      let y = 0;
      for (let i = 0; i < nb; i++) {
        const hgt = TEX / nb * (0.6 + rng() * 0.9);
        const tone = (rng() - 0.5) * 0.5;
        g.fillStyle = tone > 0 ? lighten(base, tone * 0.6) : darken(base, -tone * 0.7);
        const f1 = 0.004 + rng() * 0.008, f2 = 0.02 + rng() * 0.02, p1 = rng() * U.TAU, p2 = rng() * U.TAU, A = 6 + rng() * 14;
        g.beginPath();
        for (let x = 0; x <= TEX; x += 8) g.lineTo(x, y + A * Math.sin(x * f1 + p1) + A * 0.3 * Math.sin(x * f2 + p2));
        for (let x = TEX; x >= 0; x -= 8) g.lineTo(x, y + hgt + A * Math.sin(x * f1 + p1 + 1.3) + A * 0.3 * Math.sin(x * f2 + p2 + 0.7));
        g.closePath(); g.fill();
        y += hgt * 0.8;
      }
      g.globalAlpha = 0.18;
      for (let i = 0; i < 160; i++) { // fine streaks
        const sy = rng() * TEX, sx = rng() * TEX, len = 40 + rng() * 220;
        g.strokeStyle = rng() < 0.5 ? '#fff4e0' : '#3a2a1c'; g.lineWidth = 1 + rng() * 2;
        g.beginPath(); g.moveTo(sx, sy); g.quadraticCurveTo(sx + len / 2, sy + (rng() - 0.5) * 10, sx + len, sy + (rng() - 0.5) * 6); g.stroke();
      }
      g.globalAlpha = 1;
      const spotX = R + R * 0.28, spotY = R + R * 0.34, sw = R * 0.16, sh = R * 0.085;
      const sg = g.createRadialGradient(spotX, spotY, 0, spotX, spotY, sw);
      sg.addColorStop(0, 'rgba(214,120,84,0.85)'); sg.addColorStop(0.6, 'rgba(180,90,60,0.7)'); sg.addColorStop(0.85, 'rgba(120,70,50,0.6)'); sg.addColorStop(1, 'rgba(120,70,50,0)');
      g.save(); g.translate(spotX, spotY); g.scale(1, sh / sw); g.translate(-spotX, -spotY);
      g.fillStyle = sg; g.beginPath(); g.arc(spotX, spotY, sw, 0, U.TAU); g.fill();
      g.strokeStyle = 'rgba(255,230,200,0.35)'; g.lineWidth = 3; g.beginPath(); g.arc(spotX, spotY, sw * 0.7, 0.3, 4.2); g.stroke();
      g.restore();
      // turbulence eddies trailing the spot
      g.globalAlpha = 0.16; g.strokeStyle = '#f3e3c8'; g.lineWidth = 2.5; g.lineCap = 'round';
      for (let i = 0; i < 5; i++) { const ex = spotX - sw * 1.4 - i * 46, ey = spotY + (i % 2 ? -1 : 1) * sh * 0.7, a0 = rng() * U.TAU, er = 10 + rng() * 12; g.beginPath(); g.arc(ex, ey, er, a0, a0 + 3.6); g.stroke(); }
      g.globalAlpha = 1;
    } else {
      const ice = body.kind === 'ice';
      // broad mottling: darker and lighter regions
      for (let i = 0; i < 70; i++) {
        const x = rng() * TEX, y = rng() * TEX, r = 40 + rng() * 160;
        const gr = g.createRadialGradient(x, y, 0, x, y, r);
        const col = rng() < 0.5 ? '0,0,0' : '255,255,255';
        gr.addColorStop(0, 'rgba(' + col + ',' + (ice ? 0.06 : 0.11) + ')'); gr.addColorStop(1, 'rgba(' + col + ',0)');
        g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, U.TAU); g.fill();
      }
      if (ice) {
        // long cracks with a faint warm tint, as a frozen shell shows
        g.lineCap = 'round';
        for (let i = 0; i < 46; i++) {
          const x = rng() * TEX, y = rng() * TEX, a = rng() * U.TAU, len = 120 + rng() * 420;
          g.strokeStyle = 'rgba(150,96,70,' + (0.14 + rng() * 0.2).toFixed(2) + ')'; g.lineWidth = 1 + rng() * 2.5;
          g.beginPath(); g.moveTo(x, y);
          let px = x, py = y, aa = a;
          for (let k = 0; k < 6; k++) { aa += (rng() - 0.5) * 0.6; px += Math.cos(aa) * len / 6; py += Math.sin(aa) * len / 6; g.lineTo(px, py); }
          g.stroke();
        }
      }
      // crater field, lit from the upper left
      const n = ice ? 90 : 320;
      for (let i = 0; i < n; i++) {
        const x = rng() * TEX, y = rng() * TEX, m = rng(), r = m < 0.7 ? 3 + rng() * 6 : m < 0.94 ? 8 + rng() * 14 : 20 + rng() * 34;
        g.fillStyle = 'rgba(0,0,0,' + (ice ? 0.12 : 0.22) + ')'; g.beginPath(); g.arc(x, y, r, 0, U.TAU); g.fill();
        g.strokeStyle = 'rgba(255,255,255,' + (ice ? 0.14 : 0.2) + ')'; g.lineWidth = Math.max(1, r * 0.16);
        g.beginPath(); g.arc(x, y, r * 0.95, 0.5, 2.9); g.stroke();
        g.strokeStyle = 'rgba(0,0,0,0.25)'; g.beginPath(); g.arc(x, y, r * 0.95, 3.6, 6.1); g.stroke();
        if (r > 20) { g.fillStyle = 'rgba(255,255,255,0.08)'; g.beginPath(); g.arc(x, y, r * 0.2, 0, U.TAU); g.fill(); }
      }
      // rays from a young crater
      if (!ice) { const cx = rng() * TEX, cy = rng() * TEX; g.strokeStyle = 'rgba(255,255,255,0.08)'; g.lineWidth = 3; for (let k = 0; k < 14; k++) { const a = rng() * U.TAU; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * (60 + rng() * 160), cy + Math.sin(a) * (60 + rng() * 160)); g.stroke(); } }
    }
    // wrap edges softly so a tiled texture sample does not show a seam at the limb
    cache.bodyTex.set(body.name, tex);
    return tex;
  }
  // Shading sprite (lit side, limb darkening, inner rim, night side) for a given sun direction. Blitted scaled to the disc.
  function bodyShade(kind, sunS) {
    const key = kind + '|' + sunS.x.toFixed(3) + '|' + sunS.y.toFixed(3);
    if (cache.shade && cache.shadeKey === key) return cache.shade;
    const S = 512, R = S / 2, c = mk(S, S), g = c.getContext('2d');
    g.beginPath(); g.arc(R, R, R, 0, U.TAU); g.clip();
    const gas = kind === 'gas';
    const lit = g.createRadialGradient(R + sunS.x * R * 0.4, R + sunS.y * R * 0.4, 0, R + sunS.x * R * 0.4, R + sunS.y * R * 0.4, R * 1.1);
    lit.addColorStop(0, 'rgba(255,244,225,0.26)'); lit.addColorStop(0.5, 'rgba(255,240,220,0.08)'); lit.addColorStop(1, 'rgba(255,240,220,0)');
    g.fillStyle = lit; g.fillRect(0, 0, S, S);
    const limb = g.createRadialGradient(R, R, R * 0.5, R, R, R);
    limb.addColorStop(0, 'rgba(0,0,0,0)'); limb.addColorStop(0.7, 'rgba(0,0,0,0.12)'); limb.addColorStop(0.92, 'rgba(0,0,0,0.42)'); limb.addColorStop(1, 'rgba(0,0,0,0.72)');
    g.fillStyle = limb; g.fillRect(0, 0, S, S);
    const rimCol = gas ? '255,214,170' : kind === 'ice' ? '210,230,255' : '220,220,235';
    const rim = g.createRadialGradient(R, R, R * (gas ? 0.9 : 0.95), R, R, R);
    rim.addColorStop(0, 'rgba(' + rimCol + ',0)'); rim.addColorStop(0.7, 'rgba(' + rimCol + ',' + (gas ? 0.22 : 0.12) + ')'); rim.addColorStop(1, 'rgba(' + rimCol + ',' + (gas ? 0.5 : 0.28) + ')');
    g.globalCompositeOperation = 'lighter'; g.fillStyle = rim; g.fillRect(0, 0, S, S); g.globalCompositeOperation = 'source-over';
    const night = g.createLinearGradient(R + sunS.x * R, R + sunS.y * R, R - sunS.x * R, R - sunS.y * R);
    night.addColorStop(0, 'rgba(2,4,8,0)'); night.addColorStop(0.4, 'rgba(2,4,8,0.04)'); night.addColorStop(0.56, 'rgba(2,4,8,' + (gas ? 0.6 : 0.72) + ')'); night.addColorStop(0.7, 'rgba(2,4,8,0.9)'); night.addColorStop(1, 'rgba(2,4,8,0.96)');
    g.fillStyle = night; g.fillRect(0, 0, S, S);
    cache.shade = c; cache.shadeKey = key;
    return c;
  }

  function bodyLabel(body, c, r, cam) {
    const cand = [[0.7071, 0.7071], [-0.7071, 0.7071], [0.7071, -0.7071], [-0.7071, -0.7071]];
    for (const [dx, dy] of cand) {
      const x = c.x + dx * (r + 10), y = c.y + dy * (r + 10);
      if (x > 60 && x < cam.w - 60 && y > 40 && y < cam.h - 40) { label(body.name.toUpperCase(), x, y, { font: '500 13px ' + MONO, color: 'rgba(169,182,198,0.92)', align: dx > 0 ? 'left' : 'right', prio: PRIO.chrome, still: true }); return; }
    }
  }

  function drawBody(sim, cam) {
    const body = sim.body; if (!body) return;
    const c = cam.toScreen({ x: 0, y: 0 });
    const r = body.radius * cam.zoom;
    const diag = Math.hypot(cam.w, cam.h);
    if (c.x + r * 1.3 < 0 || c.y + r * 1.3 < 0 || c.x - r * 1.3 > cam.w || c.y - r * 1.3 > cam.h) return;
    const sun = U.fromAngle(sim.sunAngle);
    const sunS = { x: sun.x, y: -sun.y };
    const gas = body.kind === 'gas';
    const atmo = gas ? 0.09 : 0.03;
    const atmoCol = gas ? '255,200,150' : body.kind === 'ice' ? '190,215,255' : '200,205,225';
    if (r < 1.2) { ctx.fillStyle = body.color; ctx.beginPath(); ctx.arc(c.x, c.y, 1.5, 0, U.TAU); ctx.fill(); return; }

    if (r > 6000) {
      // The planet is far larger than the screen: draw only the limb region as a local polygon, which keeps the arc precise.
      const dx = cam.w / 2 - c.x, dy = cam.h / 2 - c.y, d = Math.hypot(dx, dy) || 1;
      const ux = dx / d, uy = dy / d, a0 = Math.atan2(uy, ux);
      const span = Math.min(Math.PI, (2.4 * diag) / r), n = 48;
      const ro = r + Math.min(atmo * r, gas ? 170 : 90), depth = Math.min(r - 1, 3 * diag), ri = r - depth;
      const arc = [], outer = [];
      for (let i = 0; i <= n; i++) { const a = a0 - span + (2 * span * i) / n, ca = Math.cos(a), sa = Math.sin(a); arc.push([c.x + ca * r, c.y + sa * r]); outer.push([c.x + ca * ro, c.y + sa * ro]); }
      const inS = [c.x + Math.cos(a0 - span) * ri, c.y + Math.sin(a0 - span) * ri], inE = [c.x + Math.cos(a0 + span) * ri, c.y + Math.sin(a0 + span) * ri];
      const discPath = () => { ctx.beginPath(); ctx.moveTo(inS[0], inS[1]); for (const p of arc) ctx.lineTo(p[0], p[1]); ctx.lineTo(inE[0], inE[1]); ctx.closePath(); };
      const Px = c.x + ux * r, Py = c.y + uy * r, Ld = Math.min(0.2 * r, 3 * diag);
      const g = ctx.createLinearGradient(Px, Py, Px - ux * Ld, Py - uy * Ld);
      g.addColorStop(0, darken(body.color, 0.62)); g.addColorStop(0.25, darken(body.color, 0.3)); g.addColorStop(0.6, body.color); g.addColorStop(1, lighten(body.color, 0.06));
      ctx.fillStyle = g; discPath(); ctx.fill();
      // texture through the limb path, scaled to the disc (only the visible strip is rasterised)
      ctx.save(); discPath(); ctx.clip(); ctx.globalAlpha = 0.85;
      if (r < 4e5) ctx.drawImage(bodyTexture(body), c.x - r, c.y - r, 2 * r, 2 * r);
      ctx.globalAlpha = 1; ctx.restore();
      // atmosphere band
      const ga = ctx.createLinearGradient(Px, Py, Px + ux * (ro - r), Py + uy * (ro - r));
      ga.addColorStop(0, 'rgba(' + atmoCol + ',' + (gas ? 0.5 : 0.22) + ')'); ga.addColorStop(0.3, 'rgba(' + atmoCol + ',' + (gas ? 0.16 : 0.07) + ')'); ga.addColorStop(1, 'rgba(' + atmoCol + ',0)');
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = ga;
      ctx.beginPath(); ctx.moveTo(arc[0][0], arc[0][1]); for (let i = 1; i <= n; i++) ctx.lineTo(arc[i][0], arc[i][1]); for (let i = n; i >= 0; i--) ctx.lineTo(outer[i][0], outer[i][1]); ctx.closePath(); ctx.fill();
      ctx.restore();
      // night side
      const night = ctx.createLinearGradient(c.x + sunS.x * r, c.y + sunS.y * r, c.x - sunS.x * r, c.y - sunS.y * r);
      night.addColorStop(0, 'rgba(2,4,8,0)'); night.addColorStop(0.42, 'rgba(2,4,8,0.04)'); night.addColorStop(0.56, 'rgba(2,4,8,0.75)'); night.addColorStop(1, 'rgba(2,4,8,0.95)');
      ctx.save(); discPath(); ctx.clip(); ctx.fillStyle = night; ctx.fillRect(0, 0, cam.w, cam.h); ctx.restore();
      if (Px > 60 && Px < cam.w - 60 && Py > 40 && Py < cam.h - 40) label(body.name.toUpperCase(), Px + ux * 14, Py + uy * 14, { font: '500 13px ' + MONO, color: 'rgba(169,182,198,0.92)', align: ux >= 0 ? 'left' : 'right', prio: PRIO.chrome, still: true });
      return;
    }

    // space shadow behind the body, away from the sun
    if (r >= 4) {
      const px = -sunS.y, py = sunS.x, L = r * 6;
      const g = ctx.createLinearGradient(c.x, c.y, c.x - sunS.x * L, c.y - sunS.y * L);
      g.addColorStop(0, 'rgba(1,2,6,0.5)'); g.addColorStop(0.45, 'rgba(1,2,6,0.2)'); g.addColorStop(1, 'rgba(1,2,6,0)');
      ctx.fillStyle = g; ctx.beginPath();
      ctx.moveTo(c.x + px * r, c.y + py * r); ctx.lineTo(c.x - sunS.x * L + px * r * 1.03, c.y - sunS.y * L + py * r * 1.03);
      ctx.lineTo(c.x - sunS.x * L - px * r * 1.03, c.y - sunS.y * L - py * r * 1.03); ctx.lineTo(c.x - px * r, c.y - py * r); ctx.closePath(); ctx.fill();
    }
    // atmosphere / limb glow, brighter on the sunward side
    if (r > 3) {
      const ro = r + Math.min(r * atmo * 1.8, gas ? 260 : 120);
      const glow = ctx.createRadialGradient(c.x, c.y, r * 0.96, c.x, c.y, ro);
      glow.addColorStop(0, 'rgba(' + atmoCol + ',' + (gas ? 0.55 : 0.3) + ')'); glow.addColorStop(0.35, 'rgba(' + atmoCol + ',' + (gas ? 0.2 : 0.09) + ')'); glow.addColorStop(1, 'rgba(' + atmoCol + ',0)');
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(c.x, c.y, ro, 0, U.TAU); ctx.fill();
      // the sunlit limb is brighter: a second, offset glow masked by the night side later reads as a crescent
      const sg = ctx.createRadialGradient(c.x + sunS.x * r * 0.15, c.y + sunS.y * r * 0.15, r * 0.9, c.x + sunS.x * r * 0.15, c.y + sunS.y * r * 0.15, r + Math.min(r * 0.12, 200));
      sg.addColorStop(0, 'rgba(' + atmoCol + ',' + (gas ? 0.3 : 0.15) + ')'); sg.addColorStop(1, 'rgba(' + atmoCol + ',0)');
      ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(c.x, c.y, ro, 0, U.TAU); ctx.fill();
      ctx.restore();
    }
    // disc: texture then the cached shading sprite
    ctx.save();
    ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, U.TAU); ctx.clip();
    if (r > 6) ctx.drawImage(bodyTexture(body), c.x - r, c.y - r, 2 * r, 2 * r);
    else { ctx.fillStyle = body.color; ctx.fillRect(c.x - r, c.y - r, 2 * r, 2 * r); }
    ctx.drawImage(bodyShade(body.kind, sunS), c.x - r, c.y - r, 2 * r, 2 * r);
    ctx.restore();
    // label at the limb (lower-right by preference, else whichever diagonal limb point is on screen)
    if (r > 12) bodyLabel(body, c, r, cam);
  }

  // ---- text and the label layer ------------------------------------------------------------------------------
  // Nothing writes on the map directly. Every label is queued with a priority, measured, and laid out once at the
  // end of the frame: a ship's name outranks a threat countdown, which outranks a ring caption, which outranks
  // telemetry. A box that cannot find room inside the free rectangle (cam.inset) without landing on one already
  // placed is pushed along its candidate list and then dropped, so two labels never share pixels.
  const PRIO = { scale: 210, name: 100, threat: 80, ring: 60, mark: 52, tele: 40, chrome: 12 };
  const LH = 15;            // the box height of one text line
  // The clear space a box keeps around itself. Two labels that end up on the same text row run together and read
  // as one sentence ('10 × slug · 1s' butting into 'arrive · 29s'), so a pair that shares a row is held a readable
  // word space apart (GAPROW) and the gap is part of the box the layout pass fits: a label that cannot find that
  // much room moves along its candidates or is dropped. Boxes that merely graze each other vertically are not
  // read as one line and keep the smaller gap.
  const GAPX = 5, GAPROW = 14, GAPY = 2;
  // The map's ground colour (the middle stop of the backdrop gradient). Every placed label is backed with this at
  // 85 %, which erases the ring, track or bearing line running under it instead of letting the text fight it.
  const GROUND = 'rgba(7,11,20,0.85)';
  const PADX = 3, PADY = 1, RADIUS = 4; // the backing sits a little proud of the text box, and two backings on one row still part
  let queue = [];
  const blocks = new Map(); // ship id → its stacked block this frame

  // The part of the canvas the HUD and any open band leave clear (cam.inset, in canvas pixels, from main.js).
  function safeRect(cam) { const i = cam.inset || { l: 0, r: 0, t: 0, b: 0 }; return { x0: (i.l || 0) + 8, y0: (i.t || 0) + 8, x1: cam.w - (i.r || 0) - 8, y1: cam.h - (i.b || 0) - 8 }; }
  function inSafe(p, r) { return p.x >= r.x0 && p.x <= r.x1 && p.y >= r.y0 && p.y <= r.y1; }
  // Largest t ≥ 0 with (s + t·u) still inside the safe rect, or 0 when s is outside it.
  function rayLimit(s, ux, uy, r) {
    if (!inSafe(s, r)) return 0;
    let t = Infinity;
    if (ux > 1e-9) t = Math.min(t, (r.x1 - s.x) / ux); else if (ux < -1e-9) t = Math.min(t, (r.x0 - s.x) / ux);
    if (uy > 1e-9) t = Math.min(t, (r.y1 - s.y) / uy); else if (uy < -1e-9) t = Math.min(t, (r.y0 - s.y) / uy);
    return isFinite(t) ? Math.max(0, t) : 0;
  }
  function measure(text, font) { ctx.font = font || F12; return ctx.measureText(String(text)).width; }
  // Where a point in the current transform lands in canvas pixels, so a label queued inside a translate is placed
  // where it was asked for when the layer paints it.
  function absPt(x, y) {
    const m = ctx.getTransform ? ctx.getTransform() : null;
    const d = (Render._size && Render._size.dpr) || 1;
    if (!m) return { x, y };
    return { x: (m.a * x + m.c * y + m.e) / d, y: (m.b * x + m.d * y + m.f) / d };
  }
  // The ground-coloured backing under one placed label: a rounded rect in the map's own background colour, so a
  // line that passes behind the text stops at its edge and starts again after it.
  function backing(b) {
    const x = b.x0 - PADX, y = b.y0 - PADY, w = (b.x1 - b.x0) + 2 * PADX, h = (b.y1 - b.y0) + 2 * PADY;
    if (!(w > 0 && h > 0)) return;
    const r = Math.min(RADIUS, w / 2, h / 2);
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
    else {
      ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
      ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
    }
    ctx.fillStyle = GROUND; ctx.fill();
  }
  // The one place text is written: a dark halo keeps it legible over planets and plumes.
  function paint(text, x, y, o) {
    o = o || {};
    ctx.font = o.font || F12; ctx.textAlign = o.align || 'left'; ctx.textBaseline = o.baseline || 'middle';
    ctx.lineJoin = 'round'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(5,7,12,0.85)';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = o.color || COLORS.ink; ctx.fillText(text, x, y);
  }
  // Queue one line of text. o: { font, color, align, prio, keep, still, cands }.
  function label(text, x, y, o) {
    if (text == null || text === '') return;
    o = o || {};
    text = String(text);
    const font = o.font || F12, h = o.h || LH, align = o.align || 'left';
    const w = measure(text, font) + 2;
    const p = absPt(x, y);
    let cands = o.cands;
    if (!cands) {
      cands = [];
      const steps = o.still ? [0] : [0, LH, -LH, 2 * LH, -2 * LH, 3 * LH, -3 * LH, 4 * LH, -4 * LH, 5 * LH, -5 * LH];
      for (const dy of steps) cands.push([0, -h / 2 + dy, align]);
    }
    queue.push({
      prio: o.prio != null ? o.prio : PRIO.tele, ax: p.x, ay: p.y, w, h, cands, keep: !!o.keep, bg: o.bg,
      draw: (x0, y0) => paint(text, x0, y0 + h / 2, { font, color: o.color }),
    });
  }
  // Queue a short stack of lines that must stay together (a range and its light lag, say).
  function stack(lines, x, y, o) {
    lines = lines.filter((l) => l && l.text);
    if (!lines.length) return;
    o = o || {};
    const align = o.align || 'left';
    let w = 0;
    for (const l of lines) w = Math.max(w, measure(l.text, l.font || F12) + 2);
    const h = lines.length * LH;
    const p = absPt(x, y);
    const cands = [];
    for (const dx of [0, w * 0.6 + 16, -w * 0.6 - 16]) for (const dy of [0, LH, -LH, 2 * LH, -2 * LH, 3 * LH, -3 * LH]) cands.push([dx, -LH / 2 + dy, align]);
    queue.push({
      prio: o.prio != null ? o.prio : PRIO.tele, ax: p.x, ay: p.y, w, h, cands, keep: !!o.keep, bg: o.bg,
      draw: (x0, y0) => lines.forEach((l, i) => paint(l.text, x0, y0 + i * LH + LH / 2, { font: l.font || F12, color: l.color })),
    });
  }
  function boxAt(it, c) {
    const align = c[2] || 'left';
    const left = it.ax + c[0] - (align === 'right' ? it.w : align === 'center' ? it.w / 2 : 0);
    const top = it.ay + c[1];
    return { x0: left, y0: top, x1: left + it.w, y1: top + it.h };
  }
  function insideSafe(b, s) { return b.x0 >= s.x0 && b.x1 <= s.x1 && b.y0 >= s.y0 && b.y1 <= s.y1; }
  // Two boxes share a text row when they overlap vertically by more than half a line: then the horizontal clearance
  // is a word space, otherwise the plain gap.
  function gapFor(a, b) {
    const over = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
    return over > LH * 0.55 ? GAPROW : GAPX;
  }
  function hits(b, list) {
    for (const o of list) {
      const gx = gapFor(b, o);
      if (b.x0 < o.x1 + gx && b.x1 + gx > o.x0 && b.y0 < o.y1 + GAPY && b.y1 + GAPY > o.y0) return true;
    }
    return false;
  }
  // Lay the frame's labels out and paint them, highest priority first.
  function drawLabels(cam) {
    const sz = Render._size;
    ctx.setTransform(sz.dpr, 0, 0, sz.dpr, 0, 0);
    const safe = safeRect(cam);
    const items = queue.slice().sort((a, b) => (b.prio - a.prio) || (a.ay - b.ay) || (a.ax - b.ax));
    const taken = [];
    let dropped = 0;
    for (const it of items) {
      if (it.size) it.size();
      const cands = it.cands && it.cands.length ? it.cands : [[0, -it.h / 2, 'left']];
      let box = null;
      for (const c of cands) {
        const b = boxAt(it, c);
        if (!insideSafe(b, safe) || hits(b, taken)) continue;
        box = b; break;
      }
      if (!box && it.keep) {
        // a label that must show (an edge marker for a threat off the map): first any candidate inside the safe
        // rect, then the first candidate clamped into it. Two markers clamped to the same corner would print on
        // the same pixels, so a clamped box slides down and up a line at a time until it clears what is placed.
        for (const c of cands) { const b = boxAt(it, c); if (insideSafe(b, safe)) { box = b; break; } }
        if (!box) {
          const b = boxAt(it, cands[0]);
          box = { x0: U.clamp(b.x0, safe.x0, Math.max(safe.x0, safe.x1 - it.w)), y0: U.clamp(b.y0, safe.y0, Math.max(safe.y0, safe.y1 - it.h)) };
          box.x1 = box.x0 + it.w; box.y1 = box.y0 + it.h;
        }
        if (hits(box, taken)) {
          const y00 = box.y0;
          for (let k = 1; k <= 12; k++) {
            const y = y00 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (it.h + GAPY);
            if (y < safe.y0 || y + it.h > safe.y1) continue;
            const b2 = { x0: box.x0, y0: y, x1: box.x1, y1: y + it.h };
            if (!hits(b2, taken)) { box = b2; break; }
          }
        }
      }
      if (!box) { dropped++; continue; }
      taken.push(box);
      if (it.bg !== false) backing(box);
      try { it.draw(box.x0, box.y0); } catch (e) { Render.lastError = e; }
    }
    Render.labelCount = { queued: items.length, placed: items.length - dropped, dropped };
    queue = []; blocks.clear();
  }

  // ---- a ship's block: its name, what it is, its bars and every telemetry line it owns, stacked in one box that
  // is anchored at the hull and moves (down, up, or to the other flank) as a whole. Nothing about a ship floats
  // free of it, so a crowded fight cannot print two readouts on the same pixels.
  function blockOf(sim, cam, ship) {
    let b = blocks.get(ship.id);
    if (b) return b;
    let p = { x: cam.w / 2, y: cam.h / 2 };
    try { p = cam.toScreen(viewOf(sim, ship).pos); } catch (e) { /* keep the centre */ }
    // the block hangs off the hull as drawn: 14 px from an icon's centre, out at the bow of a 400 px hull
    const R0 = U.clamp((ship.length || 100) * cam.zoom * 0.55, 14, 170);
    // a hull longer than half the map's short side has no side to hang a block off: hers goes to the clear
    // top-left corner of the map instead, and slides down a line at a time behind any block already there
    const corner = (ship.length || 100) * cam.zoom > 0.5 * Math.min(cam.w, cam.h);
    const safe0 = corner ? safeRect(cam) : null;
    b = { id: ship.id, ax: corner ? safe0.x0 + 4 : p.x, ay: corner ? safe0.y0 + 4 : p.y, R0, w: 0, h: LH, lines: [], head: [], tele: [], bars: null, prio: PRIO.name, keep: false, cands: null, corner };
    b.size = () => {
      b.lines = b.head.concat(b.tele);
      let w = 0;
      for (const l of b.lines) w = Math.max(w, measure(l.text, l.font || F12) + 2);
      if (b.bars) w = Math.max(w, 44);
      b.w = Math.max(w, 26);
      b.h = Math.max(LH, b.lines.length * LH + (b.bars ? 20 : 0));
      if (b.corner) { b.cands = []; for (let k = 0; k < 8; k++) b.cands.push([0, k * (b.h + 4), 'left']); return; }
      const d = b.R0 + 12, sides = [[d, 'left'], [-d, 'right']];
      const tops = [-LH - 2, -LH - 2 + LH, -LH - 2 - LH, b.R0 + 8, -b.h - b.R0 - 8, -LH - 2 + 2 * LH, -LH - 2 - 2 * LH, -LH - 2 + 3 * LH];
      b.cands = [];
      for (const t of tops) for (const s of sides) b.cands.push([s[0], t, s[1]]);
    };
    b.draw = (x0, y0) => {
      let y = y0;
      for (const l of b.lines) { paint(l.text, x0, y + LH / 2, { font: l.font || F12, color: l.color }); y += LH; }
      if (b.bars) {
        const bw = 40, bh = 3;
        b.bars.forEach((bar, i) => {
          ctx.fillStyle = 'rgba(5,7,12,0.6)'; ctx.fillRect(x0 - 1, y + 2 + i * 6 - 1, bw + 2, bh + 2);
          ctx.fillStyle = 'rgba(255,255,255,0.14)'; ctx.fillRect(x0, y + 2 + i * 6, bw, bh);
          ctx.fillStyle = bar[1]; ctx.fillRect(x0, y + 2 + i * 6, bw * U.clamp(bar[0], 0, 1), bh);
        });
      }
      // a leader back to the hull once the block has been pushed clear of it
      const right = x0 >= b.ax, nx = right ? x0 - 3 : x0 + b.w + 3, ny = y0 + Math.min(b.h, LH) / 2;
      if (!b.corner && (Math.abs(nx - b.ax) > b.R0 + 22 || Math.abs(ny - b.ay) > 22)) {
        ctx.save(); ctx.strokeStyle = 'rgba(150,172,198,0.32)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(b.ax + (right ? 1 : -1) * (b.R0 + 3), b.ay); ctx.lineTo(nx, ny); ctx.stroke(); ctx.restore();
      }
    };
    blocks.set(ship.id, b);
    queue.push(b);
    return b;
  }
  // One telemetry line for a ship (relative speed, what the drive is doing, PINNED, a countdown): it joins that
  // ship's block instead of being written wherever the thing it describes happens to sit.
  function tele(sim, cam, ship, text, color, font) {
    if (!ship || text == null || text === '') return;
    const b = blockOf(sim, cam, ship);
    // a phone map is a strip: one telemetry line per hull (the first queued is the one that matters most)
    if (cam.w < 700 && b.tele.length >= 1) return;
    b.tele.push({ text: String(text), color, font });
  }

  // ---- rings ----
  function ring(c, rpx, color, fam, alpha) {
    ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = fam.width || 1; ctx.setLineDash(fam.dash || []);
    if (fam.cap) ctx.lineCap = fam.cap;
    if (alpha != null) ctx.globalAlpha = alpha;
    ctx.beginPath(); ctx.arc(c.x, c.y, rpx, 0, U.TAU); ctx.stroke(); ctx.restore();
  }
  // Does the ring's curve cross the free rectangle at all? One that does not draws nothing: it is either a hair
  // around a ship hidden behind a panel or a circle so large that only chrome would show it.
  function ringSeen(c, rpx, s) {
    const dx = Math.max(s.x0 - c.x, 0, c.x - s.x1), dy = Math.max(s.y0 - c.y, 0, c.y - s.y1);
    const near = Math.hypot(dx, dy);
    const far = Math.max(Math.hypot(s.x0 - c.x, s.y0 - c.y), Math.hypot(s.x1 - c.x, s.y0 - c.y), Math.hypot(s.x0 - c.x, s.y1 - c.y), Math.hypot(s.x1 - c.x, s.y1 - c.y));
    return rpx >= near - 1 && rpx <= far + 1;
  }
  // A ring's caption: it starts at the point on the ring nearest the free rectangle's interior and turns around
  // the ring until its box lands clear of the HUD and of every label already placed.
  function ringCaption(cam, c, rpx, text, o) {
    o = o || {};
    const safe = safeRect(cam);
    if (!ringSeen(c, rpx, safe)) return false;
    const font = o.font || F12B, h = LH, w = measure(text, font) + 2;
    const qx = U.clamp(c.x, safe.x0, safe.x1), qy = U.clamp(c.y, safe.y0, safe.y1);
    const a0 = Math.hypot(qx - c.x, qy - c.y) > 1
      ? Math.atan2(-(qy - c.y), qx - c.x)
      : Math.atan2(-((safe.y0 + safe.y1) / 2 - c.y), (safe.x0 + safe.x1) / 2 - c.x);
    const N = 48, cands = [];
    for (let k = 0; k <= N / 2; k++) {
      for (const sgn of k === 0 || k === N / 2 ? [1] : [1, -1]) {
        const a = a0 + (sgn * k * U.TAU) / N, cs = Math.cos(a), sn = Math.sin(a);
        cands.push([cs * rpx + (cs >= 0 ? 6 : -6), -sn * rpx + (sn >= 0 ? -6 - h : 6), cs >= 0 ? 'left' : 'right']);
      }
    }
    queue.push({
      prio: o.prio != null ? o.prio : PRIO.ring, ax: c.x, ay: c.y, w, h, cands, keep: false,
      draw: (x0, y0) => paint(text, x0, y0 + h / 2, { font, color: o.color }),
    });
    return true;
  }
  function niceStep(metresPerPx, targetPx) {
    const want = targetPx * metresPerPx;
    const p = Math.pow(10, Math.floor(Math.log10(want)));
    const cands = [1, 2, 5, 10].map((k) => k * p);
    let best = cands[0];
    for (const c of cands) if (Math.abs(c - want) < Math.abs(best - want)) best = c;
    return best;
  }

  // ---- space: a baked backdrop (base gradient, nebula, sun glare) under two parallax star layers ----
  function buildBackdrop(w, h, sunAngle) {
    const c = mk(w, h), g = c.getContext('2d');
    const bg = g.createRadialGradient(w * 0.5, h * 0.42, 0, w * 0.5, h * 0.42, Math.max(w, h) * 0.85);
    bg.addColorStop(0, '#0c1322'); bg.addColorStop(0.55, '#070b14'); bg.addColorStop(1, '#03050a');
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 1024) for (let y = 0; y < h; y += 1024) g.drawImage(cache.nebula, x, y, 1024, 1024);
    // sun glare at the screen edge in the sun's direction
    const R = Math.round(Math.max(w, h) * 0.55);
    if (!cache.glare || cache.glareKey !== R) { cache.glare = buildGlare(R); cache.glareKey = R; }
    const d = { x: Math.cos(sunAngle), y: -Math.sin(sunAngle) };
    const tx = d.x !== 0 ? (w / 2) / Math.abs(d.x) : Infinity, ty = d.y !== 0 ? (h / 2) / Math.abs(d.y) : Infinity;
    const t = Math.min(tx, ty) + 24;
    g.globalCompositeOperation = 'lighter'; g.globalAlpha = 0.9;
    g.drawImage(cache.glare, w / 2 + d.x * t - R, h / 2 + d.y * t - R);
    return c;
  }
  function buildVignette(w, h) {
    const c = mk(w, h), g = c.getContext('2d');
    const vg = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.42, w / 2, h / 2, Math.max(w, h) * 0.78);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.6)');
    g.fillStyle = vg; g.fillRect(0, 0, w, h);
    return c;
  }
  function drawSpace(cam, sunAngle) {
    if (!cache.far) { cache.far = buildStars(7, 1400, 0.55); cache.near = buildStars(31, 260, 1.0); cache.nebula = buildNebula(); cache.plume = buildPlume(); cache.glow = buildGlow(); }
    const key = cam.w + 'x' + cam.h + '|' + sunAngle.toFixed(3);
    if (cache.backdropKey !== key) { cache.backdrop = buildBackdrop(cam.w, cam.h, sunAngle); cache.vignette = buildVignette(cam.w, cam.h); cache.backdropKey = key; }
    ctx.drawImage(cache.backdrop, 0, 0);
    // parallax: the camera's world offset scaled by a capped zoom so a close view does not stream stars; integer offsets keep the blit a plain copy
    const z = Math.min(cam.zoom, 1e-3);
    const tile = (img, k) => {
      const ox = Math.round(((cam.x * z * k) % TILE + TILE) % TILE), oy = Math.round(((-cam.y * z * k) % TILE + TILE) % TILE);
      for (let x = -ox; x < cam.w; x += TILE) for (let y = -oy; y < cam.h; y += TILE) ctx.drawImage(img, x, y);
    };
    tile(cache.far, 0.03);
    tile(cache.near, 0.09);
  }
  function drawVignette(cam) { ctx.drawImage(cache.vignette, 0, 0); }

  // ---- polylines clipped to the screen, so a dashed coast that leaves the view costs nothing off it ----
  function clipSeg(ax, ay, bx, by, w, h, pad) {
    let t0 = 0, t1 = 1; const dx = bx - ax, dy = by - ay;
    const p = [-dx, dx, -dy, dy], q = [ax + pad, w + pad - ax, ay + pad, h + pad - ay];
    for (let i = 0; i < 4; i++) {
      if (p[i] === 0) { if (q[i] < 0) return null; }
      else { const r = q[i] / p[i]; if (p[i] < 0) { if (r > t1) return null; if (r > t0) t0 = r; } else { if (r < t0) return null; if (r < t1) t1 = r; } }
    }
    return [ax + dx * t0, ay + dy * t0, ax + dx * t1, ay + dy * t1];
  }
  // Adds the visible parts of a world polyline to the current path. Returns true when anything was added.
  function polyline(cam, pts, from) {
    let any = false, px = 0, py = 0, open = false;
    let a = cam.toScreen(from || pts[0]);
    for (let i = from ? 0 : 1; i < pts.length; i++) {
      const b = cam.toScreen(pts[i]);
      const c = clipSeg(a.x, a.y, b.x, b.y, cam.w, cam.h, 40);
      if (c) {
        if (!open || Math.abs(c[0] - px) > 0.01 || Math.abs(c[1] - py) > 0.01) ctx.moveTo(c[0], c[1]);
        ctx.lineTo(c[2], c[3]); px = c[2]; py = c[3]; open = true; any = true;
      } else open = false;
      a = b;
    }
    return any;
  }

  // ---- lattice fixed in world space (motion reads while following), plus range rings on the selected ship ----
  function drawGrid(sim, cam, sel) {
    const step = niceStep(1 / cam.zoom, 160);
    const px = step * cam.zoom;
    const o = cam.toScreen({ x: 0, y: 0 });
    const x0 = ((o.x % px) + px) % px, y0 = ((o.y % px) + px) % px;
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(120,150,190,0.07)';
    ctx.beginPath();
    for (let x = x0; x < cam.w; x += px) { const xx = Math.round(x) + 0.5; ctx.moveTo(xx, 0); ctx.lineTo(xx, cam.h); }
    for (let y = y0; y < cam.h; y += px) { const yy = Math.round(y) + 0.5; ctx.moveTo(0, yy); ctx.lineTo(cam.w, yy); }
    ctx.stroke();
    if (sim.body) { // the two axes through the body centre
      ctx.strokeStyle = 'rgba(120,150,190,0.16)'; ctx.beginPath();
      if (o.x >= 0 && o.x <= cam.w) { ctx.moveTo(Math.round(o.x) + 0.5, 0); ctx.lineTo(Math.round(o.x) + 0.5, cam.h); }
      if (o.y >= 0 && o.y <= cam.h) { ctx.moveTo(0, Math.round(o.y) + 0.5); ctx.lineTo(cam.w, Math.round(o.y) + 0.5); }
      ctx.stroke();
    }
    if (sel) {
      const c = cam.toScreen(sel.pos), maxR = Math.hypot(cam.w, cam.h);
      const rstep = niceStep(1 / cam.zoom, 190);
      for (let k = 1; k <= 3; k++) {
        const rr = rstep * k * cam.zoom; if (rr > maxR) break;
        // the style is set every pass: the label layer is free to leave the context in any state it likes
        ctx.strokeStyle = 'rgba(120,150,190,0.14)'; ctx.lineWidth = 1; ctx.setLineDash([]);
        ctx.beginPath(); ctx.arc(c.x, c.y, rr, 0, U.TAU); ctx.stroke();
        label(U.fmt.dist(rstep * k), c.x + rr * 0.7071 + 4, c.y - rr * 0.7071 - 8, { color: 'rgba(127,142,163,0.7)', prio: PRIO.chrome, still: true });
      }
    }
  }

  // ---- trails: alpha gradient along the trail, brighter and thicker where the drive was lit ----
  function updateTrails(sim) {
    for (const ship of sim.ships) {
      if (ship.destroyed) { trails.delete(ship.id); continue; }
      let tr = trails.get(ship.id);
      if (!tr || tr.simId !== sim) { tr = { simId: sim, t: -1e9, pts: [] }; trails.set(ship.id, tr); }
      if (sim.time - tr.t >= 8) { tr.t = sim.time; tr.pts.push({ x: ship.pos.x, y: ship.pos.y, burn: ship.throttle > 0.05 }); if (tr.pts.length > 90) tr.pts.shift(); }
    }
  }
  function drawTrails(sim, cam) {
    ctx.lineCap = 'round';
    for (const ship of sim.ships) {
      const tr = trails.get(ship.id); if (!tr || tr.pts.length < 2) continue;
      const col = OD.Ships.FACTIONS[ship.faction].color;
      const pts = tr.pts, n = pts.length;
      let i = 1;
      while (i < n) {
        const burn = pts[i].burn;
        let j = i; while (j < n && pts[j].burn === burn && j - i < 6) j++;
        const f = j / n, a = 0.05 + 0.55 * f * f;
        ctx.beginPath();
        if (!polyline(cam, pts.slice(i, j), pts[i - 1])) { i = j; continue; }
        if (burn) {
          ctx.strokeStyle = 'rgba(150,200,255,' + (a * 0.25).toFixed(3) + ')'; ctx.lineWidth = 7; ctx.stroke();
          ctx.strokeStyle = hexA('#dbeeff', a); ctx.lineWidth = 2; ctx.stroke();
        } else {
          ctx.strokeStyle = hexA(col, a * 0.9); ctx.lineWidth = 1.2; ctx.stroke();
        }
        i = j;
      }
    }
    ctx.lineCap = 'butt';
  }

  // ---- predicted coast under gravity, with the low point or the surface hit marked ----
  function coastHorizon(sim, ship) {
    let horizon = 4 * 3600;
    if (sim.body) { try { const el = P.orbitalElements(sim.body.mu, ship.pos, ship.vel); if (el.bound && isFinite(el.a) && el.a > 0) horizon = Math.min(horizon, P.orbitalPeriod(sim.body.mu, el.a)); } catch (e) { /* keep 4 h */ } }
    return horizon;
  }
  function drawPath(sim, cam, ship, selected, long) {
    const pts = long ? sim.predictPath(ship, coastHorizon(sim, ship), 240) : sim.predictPath(ship, 1200, 60);
    if (pts.length < 2) return;
    const col = OD.Ships.FACTIONS[ship.faction].color;
    ctx.beginPath();
    if (!polyline(cam, pts, ship.pos)) return;
    ctx.setLineDash(selected ? [6, 6] : [2, 6]);
    ctx.strokeStyle = hexA(col, selected ? 0.5 : 0.2); ctx.lineWidth = selected ? 1.2 : 1;
    ctx.stroke(); ctx.setLineDash([]);
  }
  function coastMark(sim, ship) {
    if (!sim.body) return null;
    const cm = ship._coastMark;
    if (cm && cm.simId === sim && sim.time - cm.t < 5) return cm;
    const horizon = coastHorizon(sim, ship);
    let el = null;
    try { el = P.orbitalElements(sim.body.mu, ship.pos, ship.vel); } catch (e) { el = null; }
    const steps = 240, h = horizon / steps;
    const pts = sim.predictPath(ship, horizon, steps);
    let best = null, bi = -1;
    for (let i = 0; i < pts.length; i++) { const rr = Math.hypot(pts[i].x, pts[i].y); if (!best || rr < best.r) { best = { r: rr, x: pts[i].x, y: pts[i].y, tt: (i + 1) * h }; bi = i; } }
    let m = null;
    if (best && best.r < sim.body.radius) m = { kind: 'surface', x: pts[pts.length - 1].x, y: pts[pts.length - 1].y, tt: pts.length * h };
    else if (best && bi > 0 && bi < pts.length - 1) m = { kind: 'low', x: best.x, y: best.y, tt: best.tt, alt: best.r - sim.body.radius };
    const out = { simId: sim, t: sim.time, m, danger: !!(el && el.periapsis < sim.body.radius) };
    ship._coastMark = out;
    return out;
  }
  function drawCoastMark(sim, cam, ship) {
    const cm = coastMark(sim, ship); if (!cm || !cm.m) return;
    const m = cm.m, s = cam.toScreen(m);
    if (s.x < -50 || s.y < -50 || s.x > cam.w + 50 || s.y > cam.h + 50) return;
    if (m.kind === 'low' && ship.throttle > 0.02) return;
    for (const k of sim.markers) { const ks = cam.toScreen(k.pos); if (Math.hypot(ks.x - s.x, ks.y - s.y) < 24) return; }
    const left = Math.max(0, m.tt - (sim.time - cm.t));
    if (m.kind === 'surface') {
      ctx.strokeStyle = COLORS.crit; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(s.x - 5, s.y - 5); ctx.lineTo(s.x + 5, s.y + 5); ctx.moveTo(s.x + 5, s.y - 5); ctx.lineTo(s.x - 5, s.y + 5); ctx.stroke();
      label('surface · in ' + U.fmt.time(left), s.x + 9, s.y - 8, { color: COLORS.crit, font: F12B, prio: PRIO.mark });
    } else {
      ctx.strokeStyle = 'rgba(215,224,234,0.7)'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(s.x, s.y, 5, 0, U.TAU); ctx.stroke();
      label('low point · ' + U.fmt.dist(m.alt) + ' · in ' + U.fmt.time(left), s.x + 9, s.y - 8, { color: 'rgba(215,224,234,0.85)', prio: PRIO.mark });
    }
  }

  // ---- the plan for the selected ship: burn / coast / brake segments with flip and arrival marks ----
  function planEta(sim, plan, ev) { return ev ? Math.max(0, ev.t - (sim.time - (plan.t0 != null ? plan.t0 : sim.time))) : null; }
  function drawPlan(sim, cam, ship) {
    if (!(OD.Guide && OD.Guide.plan)) return;
    let plan = null;
    try { plan = OD.Guide.plan(sim, ship); } catch (e) { Render.lastError = e; return; }
    if (!plan || plan.active === false || !plan.pts || plan.pts.length < 2) return;
    const fac = OD.Ships.FACTIONS[ship.faction].color;
    const ok = plan.feasible !== false;
    const elapsed = sim.time - (plan.t0 != null ? plan.t0 : sim.time);
    const pts = plan.pts;
    let i = 0;
    while (i < pts.length - 2 && pts[i + 1].t < elapsed) i++;
    ctx.lineCap = 'round';
    while (i < pts.length - 1) {
      const ph = pts[i + 1].phase;
      let j = i + 1;
      while (j < pts.length && pts[j].phase === ph) j++;
      ctx.beginPath();
      if (!polyline(cam, pts.slice(i, j))) { i = j - 1; continue; }
      if (ph === 'burn') { ctx.setLineDash([]); ctx.strokeStyle = ok ? fac : COLORS.crit; ctx.lineWidth = 2; }
      else if (ph === 'brake') { ctx.setLineDash([]); ctx.strokeStyle = ok ? COLORS.brake : COLORS.crit; ctx.lineWidth = 2; }
      else { ctx.setLineDash([4, 7]); ctx.strokeStyle = hexA(ok ? fac : COLORS.crit, 0.45); ctx.lineWidth = 1; }
      ctx.stroke();
      i = j - 1;
    }
    ctx.setLineDash([]); ctx.lineCap = 'butt';
    const mark = (ev, text, color, r) => {
      if (!ev) return;
      const s = cam.toScreen(ev);
      if (s.x < -40 || s.y < -40 || s.x > cam.w + 40 || s.y > cam.h + 40) return;
      ctx.strokeStyle = color; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, U.TAU); ctx.stroke();
      ctx.fillStyle = hexA(color, 0.9); ctx.beginPath(); ctx.arc(s.x, s.y, 1.5, 0, U.TAU); ctx.fill();
      const cands = [];
      for (const dy of [-9 - LH / 2, 9 - LH / 2, -9 - LH / 2 - LH, 9 - LH / 2 + LH]) { cands.push([-r - 5, dy, 'right']); cands.push([r + 5, dy, 'left']); }
      label(text, s.x, s.y, { color, font: F12B, align: 'right', prio: PRIO.mark, cands });
    };
    mark(plan.flip, 'flip · ' + U.fmt.time(planEta(sim, plan, plan.flip)), ok ? COLORS.ink : COLORS.crit, 5);
    mark(plan.arrive, 'arrive · ' + U.fmt.time(planEta(sim, plan, plan.arrive)), ok ? COLORS.good : COLORS.crit, 6);
    if (plan.crash) {
      const s = cam.toScreen(plan.crash);
      ctx.strokeStyle = COLORS.crit; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(s.x - 5, s.y - 5); ctx.lineTo(s.x + 5, s.y + 5); ctx.moveTo(s.x + 5, s.y - 5); ctx.lineTo(s.x - 5, s.y + 5); ctx.stroke();
      label('hits the surface · in ' + U.fmt.time(planEta(sim, plan, plan.crash)), s.x + 9, s.y + 10, { color: COLORS.crit, font: F12B, prio: PRIO.mark });
    }
    if (!ok) {
      const e = cam.toScreen(pts[pts.length - 1]);
      const ex = U.clamp(e.x, 80, cam.w - 120), ey = U.clamp(e.y, 30, cam.h - 30);
      label('not enough Δv', ex, ey + (plan.crash ? 26 : 12), { color: COLORS.crit, font: F12B, align: 'center', prio: PRIO.mark });
    }
  }
  // Keep-range orders draw their ring around the target; intercepts mark the standoff.
  function drawOrderRing(sim, cam, ship) {
    const o = ship.order; if (!o || !o.target) return;
    const t = sim.byId(o.target); if (!t || t.destroyed) return;
    const s = cam.toScreen(viewOf(sim, t).pos);
    const fac = OD.Ships.FACTIONS[ship.faction].color;
    const safe = safeRect(cam);
    if (o.type === 'keeprange' && o.range > 0) {
      const rr = o.range * cam.zoom; if (rr < 6 || rr > 12000 || !ringSeen(s, rr, safe)) return;
      ring(s, rr, hexA(fac, 0.5), RING.order);
      ringCaption(cam, s, rr, 'keep ' + U.fmt.dist(o.range), { color: hexA(fac, 0.85), font: F12 });
    } else if (o.type === 'approach' && OD.Autopilot && typeof OD.Autopilot.brakeRange === 'function') {
      // a cold approach settles at half its braking range, so that is the ring it is flying to
      let hold = 0;
      try { hold = OD.Autopilot.brakeRange(ship, o) / 2; } catch (e) { hold = 0; }
      if (!(hold > 0)) return;
      const rr = hold * cam.zoom; if (rr < 6 || rr > 12000 || !ringSeen(s, rr, safe)) return;
      ring(s, rr, hexA(fac, 0.5), RING.order);
      ringCaption(cam, s, rr, 'coast in to ' + U.fmt.dist(hold), { color: hexA(fac, 0.85), font: F12 });
    } else if (o.type === 'intercept') {
      const rr = Math.max(4, (o.range || 2000) * cam.zoom); if (rr > 12000 || !ringSeen(s, rr, safe)) return;
      ring(s, rr, hexA(fac, 0.55), RING.order);
      if (rr > 14) ringCaption(cam, s, rr, 'standoff ' + U.fmt.dist(o.range || 2000), { color: hexA(fac, 0.85), font: F12 });
    }
  }

  function drawMarkers(sim, cam) {
    for (const m of sim.markers) {
      const s = cam.toScreen(m.pos);
      const col = m.color || '#b9c3d1';
      ctx.strokeStyle = hexA(col, 0.85); ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(s.x, s.y - 7); ctx.lineTo(s.x + 7, s.y); ctx.lineTo(s.x, s.y + 7); ctx.lineTo(s.x - 7, s.y); ctx.closePath(); ctx.stroke();
      if (m.radius) { ctx.setLineDash([3, 5]); ctx.beginPath(); ctx.arc(s.x, s.y, m.radius * cam.zoom, 0, U.TAU); ctx.stroke(); ctx.setLineDash([]); }
      if (m.label) label(m.label, s.x + 11, s.y - 9, { color: hexA(col, 0.95), prio: PRIO.ring });
    }
  }
  function drawFx(sim, cam) {
    if (!sim.fx.length) return;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (const f of sim.fx) {
      const s = cam.toScreen(f);
      if (s.x < -20 || s.y < -20 || s.x > cam.w + 20 || s.y > cam.h + 20) continue;
      const a = U.clamp(f.life / (f.maxLife || 1), 0, 1), r = f.size || 1.5;
      ctx.globalAlpha = a * 0.5; ctx.drawImage(cache.glow, s.x - r * 3, s.y - r * 3, r * 6, r * 6);
      ctx.globalAlpha = 1; ctx.fillStyle = hexA(f.color || '#ffffff', a);
      ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, U.TAU); ctx.fill();
    }
    ctx.restore();
  }

  // ---- ships ----
  function hullPath(shape, L, ws) {
    ctx.beginPath();
    shape.forEach(([x, y], i) => { const px = x * L, py = y * ws; if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); });
    ctx.closePath();
  }
  function drawShip(sim, cam, ship, sel, isTarget, hint, t) {
    const v = viewOf(sim, ship);
    if (v.ghost) { drawContact(sim, cam, ship, v, sel, isTarget, t); return; }
    const s = cam.toScreen(ship.pos);
    if (s.x < -300 || s.y < -300 || s.x > cam.w + 300 || s.y > cam.h + 300) return;
    const fac = OD.Ships.FACTIONS[ship.faction];
    const col = fac.color;
    const lenPx = ship.length * cam.zoom;
    const station = ship.role === 'station';
    const iconMode = lenPx < 24;
    const L = iconMode ? (station ? 20 : 16) : lenPx;
    // the art takes over from 40 px hulls (stations from 60 px, where the wheel and spokes read)
    let useArt = !iconMode && lenPx >= (station ? 60 : 40) && artReady(artId(ship));
    const ang = -ship.heading; // screen rotation
    const load = ship.thermalLoad();
    const alive = !ship.destroyed;
    const flick = reduced ? 1 : 1 + 0.06 * Math.sin(t * 37 + ship.pos.x * 1e-3) + 0.04 * Math.sin(t * 61 + ship.pos.y * 1e-3);

    ctx.save();
    ctx.translate(s.x, s.y);
    // faint faction glow under the hull
    if (alive) {
      const gR = Math.min(L * (iconMode ? 1.3 : 0.8), 220);
      const gr = ctx.createRadialGradient(0, 0, gR * 0.1, 0, 0, gR);
      gr.addColorStop(0, hexA(col, iconMode ? 0.12 : 0.14)); gr.addColorStop(1, hexA(col, 0));
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(0, 0, gR, 0, U.TAU); ctx.fill();
    }
    // plume: layered sprite (hot core, blue-white cone, long haze) flowing from the tail, additive
    if (ship.throttle > 0.01 && alive && !station) {
      ctx.save(); ctx.rotate(ang); ctx.globalCompositeOperation = 'lighter';
      const thr = ship.throttle;
      const plen = (iconMode ? L * (1.0 + 2.0 * thr) : L * (0.8 + 2.2 * thr)) * flick;
      const pw = iconMode ? L * 0.8 : Math.max(8, L * 0.36);
      ctx.globalAlpha = 0.5 + 0.5 * thr;
      ctx.save(); ctx.translate(-L / 2 + (iconMode ? L * 0.1 : L * 0.04), 0); ctx.scale(-1, 1); ctx.drawImage(cache.plume, 0, -pw / 2, plen, pw); ctx.restore();
      const gd = iconMode ? L * 0.6 : Math.max(5, L * 0.13);
      ctx.globalAlpha = (0.6 + 0.4 * thr) * (reduced ? 1 : 0.9 + 0.1 * Math.sin(t * 53));
      ctx.drawImage(cache.glow, -L / 2 - gd, -gd, gd * 2, gd * 2);
      ctx.restore();
    }
    // radiators: panels tinted by thermal load, from dull red to yellow-white
    const rs = ship.radiators.state;
    // drawn now for the built-in hull, or after the art module declines a cold frame (one render a frame)
    const drawFins = () => {
      if (!(rs > 0.02 && alive)) return;
      ctx.save(); ctx.rotate(ang);
      const heatCol = heatTint(load);
      if (station) {
        const span = (iconMode ? L * 0.5 : L * 0.4) * rs, r0 = L * 0.5;
        ctx.strokeStyle = heatCol; ctx.lineWidth = iconMode ? 1.5 : Math.max(2, L * 0.035); ctx.globalAlpha = 0.9;
        for (let i = 0; i < 6; i++) { const a = (i / 6) * U.TAU + Math.PI / 6; ctx.beginPath(); ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0); ctx.lineTo(Math.cos(a) * (r0 + span), Math.sin(a) * (r0 + span)); ctx.stroke(); }
      } else if (iconMode) {
        const span = L * 0.9 * rs, x0 = -L * 0.2;
        ctx.strokeStyle = heatCol; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.9;
        ctx.beginPath(); ctx.moveTo(x0, L * 0.15); ctx.lineTo(x0 - L * 0.1, L * 0.15 + span); ctx.moveTo(x0, -L * 0.15); ctx.lineTo(x0 - L * 0.1, -L * 0.15 - span); ctx.stroke();
      } else {
        const ws = L * (ship.role === 'freighter' ? 0.5 : 0.42);
        const span = L * 0.5 * rs, x0 = -L * 0.12, y0 = ws * 0.3, sw = L * 0.16;
        for (const sgn of [1, -1]) {
          const g = ctx.createLinearGradient(0, sgn * y0, 0, sgn * (y0 + span));
          g.addColorStop(0, heatCol); g.addColorStop(1, blend(heatCol.startsWith('#') ? heatCol : '#b03a26', '#2a1a1a', 0.35));
          ctx.fillStyle = g; ctx.globalAlpha = 0.9;
          ctx.beginPath(); ctx.moveTo(x0, sgn * y0); ctx.lineTo(x0 - sw * 0.35, sgn * (y0 + span)); ctx.lineTo(x0 - sw * 1.2, sgn * (y0 + span)); ctx.lineTo(x0 - sw, sgn * y0); ctx.closePath(); ctx.fill();
          // panel ribs and a bright spine
          ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = Math.max(1, L * 0.005);
          ctx.beginPath(); for (let k = 1; k < 5; k++) { const f = k / 5; ctx.moveTo(x0 - sw * 0.35 * f, sgn * (y0 + span * f)); ctx.lineTo(x0 - sw * (1 + 0.2 * f), sgn * (y0 + span * f)); } ctx.stroke();
          ctx.strokeStyle = lighten(heatCol.startsWith('#') ? heatCol : '#ffd27a', 0.3); ctx.lineWidth = Math.max(1, L * 0.008); ctx.globalAlpha = 0.9;
          ctx.beginPath(); ctx.moveTo(x0 - sw * 0.5, sgn * y0); ctx.lineTo(x0 - sw * 0.78, sgn * (y0 + span)); ctx.stroke();
        }
        // a hot radiator throws light on the hull
        if (load > 0.4) { const hR = Math.min(L * 0.7, 200); const g = ctx.createRadialGradient(x0, 0, 0, x0, 0, hR); g.addColorStop(0, hexA('#ff8c3a', 0.22 * (load - 0.4))); g.addColorStop(1, 'rgba(255,140,58,0)'); ctx.globalAlpha = 1; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x0, 0, hR, 0, U.TAU); ctx.fill(); }
      }
      ctx.restore();
    };
    if (!useArt) drawFins();
    // a saturated sink glows through the hull
    if (load > 0.6 && alive) {
      const oR = Math.min(L * 1.2, 260);
      const g = ctx.createRadialGradient(0, 0, oR * 0.15, 0, 0, oR);
      g.addColorStop(0, 'rgba(255,120,60,' + (0.4 * (load - 0.6) / 0.4).toFixed(3) + ')'); g.addColorStop(1, 'rgba(255,120,60,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, oR, 0, U.TAU); ctx.fill();
    }
    // hull
    const shape = OD.Ships.SHAPES[ship.cls] || OD.Ships.SHAPES[(OD.Ships.CLASSES[ship.cls] || {}).artBase] || OD.Ships.SHAPES.frigate;
    const alpha = ship.destroyed ? 0.25 : ship.disabled ? 0.55 : 1;
    if (useArt) {
      // detailed hull from the ship-art module: tactical top view, rotated to the heading; the plume above is ours
      ctx.save(); ctx.globalAlpha = alpha;
      try {
        // the sprite, then what she is doing over it: mounts trained and firing, rounds off the rails,
        // interceptors away, point defence up, gas out of a holed tank
        const o = artOpts(ship, sim, { size: L, view: 'top', rotation: ang, plume: false, live: true });
        // a cold frame pays for one render: a hull the module declines this frame gets the built-in hull below
        if (OD.ShipArt.draw(ctx, artId(ship), o) === false) { useArt = false; drawFins(); }
        else if (typeof OD.ShipArt.overlay === 'function') OD.ShipArt.overlay(ctx, artId(ship), o);
      }
      catch (e) { artBroken = true; Render.lastError = 'ship art: ' + (e && e.message); }
      ctx.restore();
    }
    ctx.save(); ctx.rotate(ang);
    ctx.globalAlpha = alpha;
    if (useArt) {
      // drawn above
    } else if (shape === 'ring' || station) {
      const R = L * 0.45;
      if (iconMode) {
        ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, R, 0, U.TAU); ctx.stroke();
        ctx.fillStyle = hexA(col, 0.35); ctx.beginPath(); ctx.arc(0, 0, R * 0.35, 0, U.TAU); ctx.fill();
        ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-R, 0); ctx.lineTo(R, 0); ctx.moveTo(0, -R); ctx.lineTo(0, R); ctx.stroke();
      } else {
        const sl = { x: Math.cos(sim.sunAngle - ship.heading), y: -Math.sin(sim.sunAngle - ship.heading) };
        const hg = ctx.createLinearGradient(-sl.x * R, -sl.y * R, sl.x * R, sl.y * R);
        hg.addColorStop(0, '#171d26'); hg.addColorStop(0.5, '#3a4655'); hg.addColorStop(1, '#8d9cad');
        ctx.strokeStyle = hg; ctx.lineWidth = Math.max(3, L * 0.11); ctx.beginPath(); ctx.arc(0, 0, R, 0, U.TAU); ctx.stroke();
        ctx.strokeStyle = hexA(col, 0.7); ctx.lineWidth = Math.max(1, L * 0.012); ctx.beginPath(); ctx.arc(0, 0, R + L * 0.055, 0, U.TAU); ctx.stroke(); ctx.beginPath(); ctx.arc(0, 0, R - L * 0.055, 0, U.TAU); ctx.stroke();
        ctx.fillStyle = hg; ctx.beginPath(); ctx.arc(0, 0, L * 0.16, 0, U.TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(120,135,155,0.9)'; ctx.lineWidth = Math.max(1.5, L * 0.02); ctx.beginPath();
        for (let i = 0; i < 6; i++) { const a = (i / 6) * U.TAU; ctx.moveTo(Math.cos(a) * L * 0.16, Math.sin(a) * L * 0.16); ctx.lineTo(Math.cos(a) * R, Math.sin(a) * R); }
        ctx.stroke();
        // lit windows along the ring
        ctx.fillStyle = 'rgba(255,230,190,0.75)';
        for (let i = 0; i < 36; i++) { const a = (i / 36) * U.TAU; ctx.beginPath(); ctx.arc(Math.cos(a) * R, Math.sin(a) * R, Math.max(0.8, L * 0.008), 0, U.TAU); ctx.fill(); }
      }
    } else if (iconMode) {
      ctx.fillStyle = hexA(col, 0.4); ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(L * 0.62, 0); ctx.lineTo(-L * 0.42, L * 0.4); ctx.lineTo(-L * 0.22, 0); ctx.lineTo(-L * 0.42, -L * 0.4); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(L * 0.62, 0); ctx.lineTo(L * 0.1, L * 0.14); ctx.lineTo(L * 0.1, -L * 0.14); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(L * 0.66, 0); ctx.lineTo(L * 0.92, 0); ctx.stroke(); // nose tick
    } else {
      const ws = L * (ship.role === 'freighter' ? 0.5 : 0.42);
      const sl = { x: Math.cos(sim.sunAngle - ship.heading), y: -Math.sin(sim.sunAngle - ship.heading) };
      const W = Math.max(ws * 0.55, L * 0.2);
      // soft shadow beneath the hull, away from the sun
      ctx.save(); ctx.translate(-sl.x * L * 0.03, -sl.y * L * 0.03); ctx.fillStyle = 'rgba(0,0,0,0.45)'; hullPath(shape, L * 1.02, ws * 1.08); ctx.fill(); ctx.restore();
      // drive bell at the tail
      const bell = ctx.createLinearGradient(0, -ws * 0.4, 0, ws * 0.4);
      bell.addColorStop(0, '#1a2029'); bell.addColorStop(0.5, '#4a5666'); bell.addColorStop(1, '#141920');
      ctx.fillStyle = bell; ctx.beginPath(); ctx.moveTo(-L * 0.48, -ws * 0.28); ctx.lineTo(-L * 0.6, -ws * 0.42); ctx.lineTo(-L * 0.6, ws * 0.42); ctx.lineTo(-L * 0.48, ws * 0.28); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(160,180,200,0.5)'; ctx.lineWidth = Math.max(1, L * 0.008); ctx.beginPath(); ctx.moveTo(-L * 0.6, -ws * 0.42); ctx.lineTo(-L * 0.6, ws * 0.42); ctx.stroke();
      if (ship.throttle > 0.01 && alive) { ctx.fillStyle = hexA('#bfe3ff', 0.5 + 0.4 * ship.throttle); ctx.beginPath(); ctx.moveTo(-L * 0.6, -ws * 0.4); ctx.lineTo(-L * 0.6, ws * 0.4); ctx.lineTo(-L * 0.56, ws * 0.3); ctx.lineTo(-L * 0.56, -ws * 0.3); ctx.closePath(); ctx.fill(); }
      // hull lit by the sun
      const hg = ctx.createLinearGradient(-sl.x * W, -sl.y * W, sl.x * W, sl.y * W);
      hg.addColorStop(0, '#0c1016'); hg.addColorStop(0.35, '#232c37'); hg.addColorStop(0.7, '#5a6b80'); hg.addColorStop(1, '#b3c2d4');
      hullPath(shape, L, ws); ctx.fillStyle = hg; ctx.fill();
      ctx.save(); hullPath(shape, L, ws); ctx.clip();
      // panel lines and a spine
      ctx.strokeStyle = 'rgba(0,0,0,0.38)'; ctx.lineWidth = Math.max(1, L * 0.006); ctx.beginPath();
      for (const fx of [0.34, 0.18, 0.02, -0.14, -0.3, -0.42]) { ctx.moveTo(fx * L, -ws); ctx.lineTo(fx * L, ws); }
      ctx.moveTo(-L * 0.45, ws * 0.22); ctx.lineTo(L * 0.3, ws * 0.22); ctx.moveTo(-L * 0.45, -ws * 0.22); ctx.lineTo(L * 0.3, -ws * 0.22);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.beginPath(); ctx.moveTo(-L * 0.46, 0); ctx.lineTo(L * 0.46, 0); ctx.stroke();
      // faction accent stripe along the flank and a chevron at the bow
      ctx.fillStyle = hexA(col, 0.85);
      ctx.fillRect(-L * 0.3, -ws * 0.5, L * 0.42, Math.max(1.2, ws * 0.06)); ctx.fillRect(-L * 0.3, ws * 0.44, L * 0.42, Math.max(1.2, ws * 0.06));
      // small lit ports
      ctx.fillStyle = 'rgba(255,236,200,0.7)';
      for (let k = 0; k < 5; k++) { const px = L * (0.12 - k * 0.09); ctx.fillRect(px, -ws * 0.36, Math.max(1, L * 0.008), Math.max(1, L * 0.012)); ctx.fillRect(px, ws * 0.36, Math.max(1, L * 0.008), Math.max(1, L * 0.012)); }
      ctx.restore();
      // sunlit edge highlight and faction outline
      const eg = ctx.createLinearGradient(-sl.x * W, -sl.y * W, sl.x * W, sl.y * W);
      eg.addColorStop(0, 'rgba(255,255,255,0)'); eg.addColorStop(0.55, 'rgba(255,255,255,0.1)'); eg.addColorStop(1, 'rgba(255,255,255,0.85)');
      hullPath(shape, L, ws); ctx.strokeStyle = eg; ctx.lineWidth = Math.max(1.2, L * 0.014); ctx.stroke();
      ctx.strokeStyle = hexA(col, 0.6); ctx.lineWidth = Math.max(1, L * 0.008); ctx.stroke();
      // nose armour cap
      ctx.strokeStyle = hexA(col, 0.9); ctx.lineWidth = Math.max(1.5, L * 0.022);
      ctx.beginPath(); ctx.moveTo(L * 0.5, 0); ctx.lineTo(L * 0.32, ws * 0.2); ctx.moveTo(L * 0.5, 0); ctx.lineTo(L * 0.32, -ws * 0.2); ctx.stroke();
    }
    ctx.restore();
    ctx.globalAlpha = 1;

    const R0 = L * 0.9 + (iconMode ? 6 : 4);
    // disabled: hazard dashes; captured: green dashes
    if (ship.disabled && !ship.destroyed) {
      ctx.lineWidth = 2; ctx.setLineDash([5, 5]);
      ctx.strokeStyle = ship.captured ? COLORS.good : COLORS.steel; ctx.lineDashOffset = 0;
      ctx.beginPath(); ctx.arc(0, 0, R0, 0, U.TAU); ctx.stroke();
      if (!ship.captured) { ctx.strokeStyle = 'rgba(10,10,10,0.9)'; ctx.lineDashOffset = 5; ctx.beginPath(); ctx.arc(0, 0, R0, 0, U.TAU); ctx.stroke(); }
      ctx.setLineDash([]); ctx.lineDashOffset = 0;
    }
    // selection: animated dashed ring
    if (sel) {
      ctx.strokeStyle = COLORS.select; ctx.lineWidth = RING.select.width; ctx.setLineDash(RING.select.dash);
      ctx.beginPath(); ctx.arc(0, 0, R0 + 5, 0, U.TAU); ctx.stroke();
    }
    // target: rotating bracket corners
    if (isTarget) {
      const R = R0 + 9, k = Math.max(6, R * 0.3);
      ctx.save(); ctx.rotate(reduced ? 0 : t * 0.6);
      ctx.strokeStyle = COLORS.target; ctx.lineWidth = 1.6; ctx.lineJoin = 'miter';
      ctx.beginPath();
      [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([sx, sy]) => { ctx.moveTo(sx * R, sy * (R - k)); ctx.lineTo(sx * R, sy * R); ctx.lineTo(sx * (R - k), sy * R); });
      ctx.stroke(); ctx.restore();
    }
    // tutorial hint: pulsing ring
    if (hint) {
      const pulse = reduced ? 0.5 : 0.5 + 0.5 * Math.sin(t * 4);
      ctx.strokeStyle = hexA(COLORS.accent, 0.95 - 0.55 * pulse); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, R0 + 12 + 8 * pulse, 0, U.TAU); ctx.stroke();
      ctx.strokeStyle = hexA(COLORS.accent, 0.5); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(0, 0, R0 + 12, 0, U.TAU); ctx.stroke();
    }
    // boarding progress
    if (ship.boarding) {
      ctx.strokeStyle = COLORS.good; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(0, 0, R0 + 16, -Math.PI / 2, -Math.PI / 2 + U.TAU * U.clamp(ship.boarding.progress, 0, 1)); ctx.stroke();
    }
    ctx.restore();
    // name, class and bars: the head of this ship's block. Its telemetry lines join the same box later.
    if (!ship.destroyed) {
      const b = blockOf(sim, cam, ship);
      if (!b.corner) { b.ax = s.x; b.ay = s.y; b.R0 = R0; }
      b.head = [
        { text: ship.name, font: F13B, color: ship.captured ? COLORS.good : col },
        { text: ship.disabled ? (ship.captured ? 'captured' : 'disabled') : OD.Ships.CLASSES[ship.cls].role, color: COLORS.dim },
      ];
      // Damage control on the label at any zoom (v13): the party at work on one of our hulls, and the hurt part,
      // since the ring on the hull only draws when she is 70 px or larger on screen.
      if (ship.faction === sim.playerFaction && ship.crew && ship.crew.parties) {
        const at = ship.crew.parties.filter((q) => q.task === 'repair' && q.part);
        const p = at[0] || ship.crew.parties.find((q) => q.task === 'medical');
        if (p && p.task === 'medical') b.head.push({ text: 'party ' + String(p.id).replace(/\D/g, '') + ' · sick bay', color: PARTY_AMBER });
        else if (p) {
          const more = at.length > 1 ? ' · +' + (at.length - 1) : '';
          const eta = p.eta > 0 ? (p.eta >= 90 ? Math.round(p.eta / 60) + ' min' : Math.round(p.eta) + ' s') : '';
          // strapped in for a burn reads paused; a part that is running (the drive under throttle, a panel out)
          // reads held: crew.js artFx says which parties are working, so the label agrees with the ring
          let held = false;
          if (OD.Crew && typeof OD.Crew.artFx === 'function') { const a = OD.Crew.artFx(ship).parties.find((x) => x.id === p.id); held = !!(a && !a.working && !ship.crew.strapped); }
          const paused = ship.crew.strapped;
          b.head.push({ text: 'party ' + String(p.id).replace(/\D/g, '') + ' · ' + partWord(ship, p.part) + (paused ? ' · paused' : held ? ' · held' : eta ? ' · ' + eta : '') + more, color: paused || held ? COLORS.dim : PARTY_AMBER });
        }
      }
      if (sel || cam.zoom > 3e-5) b.bars = [[ship.deltaV() / ship.deltaVFull(), COLORS.blue], [1 - load, load > 0.85 ? COLORS.crit : load > 0.5 ? COLORS.warn : COLORS.good], [ship.hull, ship.hull < 0.35 ? COLORS.crit : COLORS.ink]];
      b.prio = PRIO.name + (sel ? 6 : isTarget ? 4 : ship.faction === sim.playerFaction ? 2 : 0);
      b.keep = !!sel;
    }
  }

  // ---- vectors for the selected ship ----
  function phaseWord(ship, target) {
    if (ship.throttle > 0.02) {
      const dir = U.fromAngle(ship.heading);
      const rel = target ? U.sub(ship.vel, target.vel) : ship.vel;
      return U.len(rel) > 1 && U.dot(rel, dir) < 0 ? 'braking' : 'burning';
    }
    if (Math.abs(U.angleDiff(ship.cmdHeading, ship.heading)) > 0.05) return 'turning';
    return 'coasting';
  }
  function arrow(a, b, color, w) {
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x - 7 * Math.cos(ang - 0.4), b.y - 7 * Math.sin(ang - 0.4)); ctx.lineTo(b.x - 7 * Math.cos(ang + 0.4), b.y - 7 * Math.sin(ang + 0.4)); ctx.closePath(); ctx.fill();
  }
  function drawVectors(sim, cam, ship) {
    const s = cam.toScreen(ship.pos);
    const target = ship.target ? sim.byId(ship.target) : (ship.order && ship.order.target ? sim.byId(ship.order.target) : null);
    if (target && !target.destroyed) {
      const u = U.sub(ship.vel, target.vel), m = U.len(u);
      if (m > 0.5) {
        const px = U.clamp(m * 0.02 + 24, 24, 130), d = U.norm(u);
        const e = { x: s.x + d.x * px, y: s.y - d.y * px };
        arrow(s, e, hexA(COLORS.blue, 0.9), 1.4);
        tele(sim, cam, ship, 'rel ' + U.fmt.speed(m), COLORS.blue);
      }
      // line of bearing with range and light lag, drawn to where the track says the target is
      const ts = cam.toScreen(viewOf(sim, target).pos);
      ctx.setLineDash([1, 5]); ctx.strokeStyle = hexA(COLORS.target, 0.4); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(ts.x, ts.y); ctx.stroke(); ctx.setLineDash([]);
      const range = U.dist(ship.pos, target.pos);
      const mid = { x: (s.x + ts.x) / 2, y: (s.y + ts.y) / 2 };
      stack([{ text: U.fmt.dist(range), color: hexA(COLORS.target, 0.9) }, { text: 'light lag ' + U.fmt.si(P.lightLag(range), 's'), color: COLORS.dim }],
        mid.x, mid.y - 9, { align: 'center', prio: PRIO.tele + 4 });
    }
    // where the autopilot wants to push
    if (ship.plannedAccel && U.len(ship.plannedAccel) > 0.01 && !ship.destroyed) {
      const d = U.norm(ship.plannedAccel);
      const e = { x: s.x + d.x * 42, y: s.y - d.y * 42 };
      arrow(s, e, 'rgba(255,255,255,0.7)', 1.2);
      const word = phaseWord(ship, target);
      if (word !== 'turning') tele(sim, cam, ship, word, 'rgba(255,255,255,0.8)');
    }
  }
  // Turn arc: from where the nose points to where the autopilot wants it, with the time it takes.
  function drawTurnArc(sim, cam, ship) {
    if (ship.destroyed || ship.disabled || ship.cmdHeading == null) return;
    const diff = U.angleDiff(ship.cmdHeading, ship.heading);
    if (Math.abs(diff) <= 0.05) return;
    const s = cam.toScreen(ship.pos), R = Math.max(26, ship.length * cam.zoom * 0.5 + 10);
    const a0 = -ship.heading, a1 = -(ship.heading + diff);
    ctx.strokeStyle = COLORS.accent; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(s.x, s.y, R, a0, a1, diff > 0); ctx.stroke();
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(s.x + Math.cos(a1) * (R - 5), s.y + Math.sin(a1) * (R - 5)); ctx.lineTo(s.x + Math.cos(a1) * (R + 6), s.y + Math.sin(a1) * (R + 6)); ctx.stroke();
    let secs = null;
    try { if (OD.Autopilot && OD.Autopilot.turnTimeFor) secs = OD.Autopilot.turnTimeFor(ship, Math.abs(diff)); } catch (e) { secs = null; }
    const lx = s.x + Math.cos(a1) * (R + 12), ly = s.y + Math.sin(a1) * (R + 12);
    label('turning' + (secs != null && isFinite(secs) ? ' · ' + U.fmt.time(secs) : ''), lx, ly, { color: COLORS.accent, align: Math.cos(a1) >= 0 ? 'left' : 'right', prio: PRIO.tele + 2 });
  }

  function drawScaleBar(cam) {
    const step = niceStep(1 / cam.zoom, 120);
    const px = step * cam.zoom;
    const x = cam.w / 2 - px / 2, y = cam.h - 26;
    ctx.strokeStyle = 'rgba(215,224,234,0.65)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + px, y); ctx.moveTo(x, y - 4); ctx.lineTo(x, y + 4); ctx.moveTo(x + px, y - 4); ctx.lineTo(x + px, y + 4); ctx.stroke();
    label(U.fmt.dist(step), cam.w / 2, y - 10, { color: 'rgba(215,224,234,0.8)', align: 'center', prio: PRIO.scale, still: true, keep: true });
  }

  // ---- v8: reach rings, the burn-through ladder and the threat display. Every number comes from OD.Engagement
  // (reach(), threats()); when the module or a method is missing nothing here draws, so the map degrades cleanly.
  const v8 = { reach: null, reachKey: '', reachFrame: -99, threats: [], threatsFrame: -99, threatsSim: null };
  const FACET_WORD = { nose: 'nose', flank: 'flank', tail: 'tail' };
  function engReach(sim, ship, target) {
    const E = OD.Engagement; if (!E || typeof E.reach !== 'function') return null;
    const key = sim.time.toFixed(0) + '|' + ship.id + '|' + (target ? target.id : '');
    if (v8.reachKey === key && frame - v8.reachFrame < 8) return v8.reach;
    try { v8.reach = E.reach(sim, ship, target || null) || null; } catch (e) { Render.lastError = e; v8.reach = null; }
    v8.reachKey = key; v8.reachFrame = frame;
    return v8.reach;
  }
  function engThreats(sim) {
    const E = OD.Engagement; if (!E || typeof E.threats !== 'function') return [];
    if (v8.threatsSim === sim && v8.threatsFrame === frame) return v8.threats;
    try { v8.threats = E.threats(sim) || []; } catch (e) { Render.lastError = e; v8.threats = []; }
    v8.threatsSim = sim; v8.threatsFrame = frame;
    return v8.threats;
  }
  // The armour facet `target` is showing to `viewer`: its own heading against the bearing back to the viewer.
  function facetShown(viewer, target) {
    const a = Math.atan2(viewer.pos.y - target.pos.y, viewer.pos.x - target.pos.x);
    const off = Math.abs(U.wrapAngle ? U.wrapAngle(a - target.heading) : Math.atan2(Math.sin(a - target.heading), Math.cos(a - target.heading)));
    return off < Math.PI / 4 ? 'nose' : off > 3 * Math.PI / 4 ? 'tail' : 'flank';
  }
  // Reach rings: our point-defence reach and interceptor launch reach around the selected ship; theirs around the
  // target. One family, one dash; the colour says whose reach it is. Drawn under the ships so they read as chart
  // marks, and a ring whose curve never crosses the free rectangle is not drawn at all.
  function drawReach(sim, cam, sel) {
    const target = sel.target ? sim.byId(sel.target) : null;
    const r = engReach(sim, sel, target && !target.destroyed ? target : null);
    if (!r) return;
    const maxR = Math.hypot(cam.w, cam.h);
    const c = cam.toScreen(sel.pos);
    const safe = safeRect(cam);
    const one = (centre, metres, color, text) => {
      if (!(metres > 0)) return;
      const rpx = metres * cam.zoom;
      if (rpx < 9 || rpx > maxR * 4 || !ringSeen(centre, rpx, safe)) return;
      ring(centre, rpx, color, RING.reach);
      ringCaption(cam, centre, rpx, text, { color });
    };
    one(c, r.pd, hexA(COLORS.accent, 0.75), 'point defence · ' + U.fmt.dist(r.pd));
    one(c, r.launch, hexA(COLORS.blue, 0.7), 'interceptor reach · ' + U.fmt.dist(r.launch));
    const hostile = target && !target.destroyed && (typeof sim.isHostile === 'function' ? sim.isHostile(target, sel) : target.faction !== sel.faction);
    if (hostile && r.their) {
      const tc = cam.toScreen(viewOf(sim, target).pos);
      one(tc, r.their.pd, hexA(COLORS.crit, 0.6), 'their point defence · ' + U.fmt.dist(r.their.pd));
      one(tc, r.their.launch, hexA(COLORS.crit, 0.45), 'their interceptor reach · ' + U.fmt.dist(r.their.launch));
    }
  }
  // Burn-through ladder: tick marks on the bearing line at the ranges where each side's beams start to put
  // energy through the facet the other is showing, plus the range inside which slugs meet a ship that holds still.
  // Ticks lie at that range from our ship along the bearing; a tick beyond the target means we are already inside.
  function drawLadder(sim, cam, sel) {
    const target = sel.target ? sim.byId(sel.target) : null;
    // only against someone who can shoot back: a friendly or civilian hull gets no burn-through ladder
    const hostile = target && (typeof sim.isHostile === 'function' ? sim.isHostile(target, sel) : target.faction !== sel.faction);
    if (!target || target.destroyed || !hostile) return;
    // the ladder quotes her armour and her mounts, which need her class: a bare contact gets no ladder
    if (OD.Sensors && typeof OD.Sensors.quality === 'function') { let q = 3; try { q = OD.Sensors.quality(sim, sel, target); } catch (e) { q = 3; } const TQ = (OD.Sensors.T && OD.Sensors.T.trackQ) || 1.8; if (q < TQ) return; }
    const r = engReach(sim, sel, target);
    if (!r) return;
    const tv = viewOf(sim, target);
    const s = cam.toScreen(sel.pos), ts = cam.toScreen(tv.pos);
    const dx = ts.x - s.x, dy = ts.y - s.y, L = Math.hypot(dx, dy);
    if (L < 40) return;
    const ux = dx / L, uy = dy / L, nx = -uy, ny = ux; // n points to the "left" of the bearing on screen
    const range = U.dist(sel.pos, tv.pos);
    const theirs = facetShown(sel, target), ours = (r.their && r.their.facet) || facetShown(target, sel);
    const marks = [];
    const ourBeam = r.beams && r.beams[theirs];
    if (ourBeam > 0) marks.push({ d: ourBeam, side: 1, color: COLORS.accent, text: 'our beams burn through their ' + FACET_WORD[theirs] + ' · ' + U.fmt.dist(ourBeam) });
    if (r.slug > 0) marks.push({ d: r.slug, side: 1, color: hexA(COLORS.accent, 0.8), text: 'our slugs land on a still ship · ' + U.fmt.dist(r.slug) });
    const theirBeam = r.their && r.their.beams && r.their.beams[ours];
    if (theirBeam > 0) marks.push({ d: theirBeam, side: -1, color: COLORS.crit, text: 'their beams burn through our ' + FACET_WORD[ours] + ' · ' + U.fmt.dist(theirBeam) });
    if (r.their && r.their.slug > 0) marks.push({ d: r.their.slug, side: -1, color: hexA(COLORS.crit, 0.8), text: 'their slugs land if we hold still · ' + U.fmt.dist(r.their.slug) });
    if (!marks.length) return;
    const far = Math.max(range, ...marks.map((m) => m.d)) * cam.zoom;
    // extend the bearing line past the target when a mark lies beyond it
    if (far > L + 4) {
      ctx.save(); ctx.setLineDash([1, 5]); ctx.strokeStyle = hexA(COLORS.target, 0.25); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(ts.x, ts.y); ctx.lineTo(s.x + ux * far, s.y + uy * far); ctx.stroke(); ctx.restore();
    }
    marks.sort((a, b) => a.d - b.d);
    const safe = safeRect(cam), limit = rayLimit(s, ux, uy, safe) - 16;
    for (const m of marks) {
      const px = m.d * cam.zoom;
      if (px < 14 || px > limit) continue; // marks past the clear area are read from the panel's burn-through rows
      const inside = range <= m.d;
      const x = s.x + ux * px, y = s.y + uy * px;
      // tick across the line, longer on the side its label sits
      ctx.strokeStyle = m.color; ctx.lineWidth = inside ? 2 : 1.2;
      ctx.beginPath(); ctx.moveTo(x - nx * 4 * m.side, y - ny * 4 * m.side); ctx.lineTo(x + nx * 9 * m.side, y + ny * 9 * m.side); ctx.stroke();
      // candidates: out along the normal on the tick's own side first, then the other side, then further out
      const cands = [];
      for (const slide of [0, 34, -34, 68, -68]) for (const k of [0, 1, 2, 3]) for (const side of [m.side, -m.side]) {
        const off = 14 + k * 15;
        cands.push([nx * off * side + ux * slide, ny * off * side + uy * slide - LH / 2, Math.abs(nx) < 0.3 ? 'center' : (nx * side > 0 ? 'left' : 'right')]);
      }
      label((inside ? '● ' : '') + m.text, x, y, { color: inside ? m.color : hexA(m.color, 0.75), font: inside ? F12B : F12, prio: PRIO.mark + (inside ? 2 : 0), cands });
    }
  }
  // Threat display: a time-to-arrival beside every inbound interceptor and slug, salvos grouped into one label,
  // a countdown ring on a ship with something inbound, and edge markers for threats to our ships off screen.
  function drawThreats(sim, cam, sel, t) {
    const list = engThreats(sim);
    if (!list.length) return;
    const pf = sim.playerFaction;
    const mine = (id) => { const s = sim.byId(id); return !!(s && (pf ? s.faction === pf : s.player)); };
    // group threats by target and kind when they overlap on screen
    // one label per target, kind and outcome, sitting on the item that arrives first
    const byKey = new Map();
    for (const th of list) {
      if (th.x == null) continue;
      const p = cam.toScreen({ x: th.x, y: th.y });
      const willHit = th.kind === 'slug' ? th.willHit !== false : true;
      const key = th.kind + '|' + th.targetId + '|' + willHit;
      let g = byKey.get(key);
      const tgt = sim.byId(th.targetId);
      const dt = tgt ? U.dist({ x: th.x, y: th.y }, tgt.pos) : Infinity;
      if (!g) { g = { kind: th.kind, targetId: th.targetId, x: p.x, y: p.y, n: 0, eta: Infinity, lead: Infinity, willHit, engaged: false, atOurs: mine(th.targetId) }; byKey.set(key, g); }
      g.n++;
      if (th.eta != null && th.eta < g.eta) g.eta = th.eta;
      if (dt < g.lead) { g.lead = dt; g.x = p.x; g.y = p.y; }
      if (th.engaged) g.engaged = true;
    }
    const groups = Array.from(byKey.values());
    const soonest = {};
    for (const g of groups) {
      const on = g.x > -10 && g.x < cam.w + 10 && g.y > -10 && g.y < cam.h + 10;
      const color = g.atOurs ? COLORS.crit : hexA(COLORS.blue, 0.85);
      const word = g.kind === 'slug' ? 'slug' : 'interceptor';
      let text;
      if (g.kind === 'slug' && !g.willHit) text = (g.n > 1 ? g.n + ' slugs' : 'slug') + ' · will miss';
      else if (isFinite(g.eta)) text = (g.n > 1 ? g.n + ' × ' : '') + word + ' · ' + U.fmt.time(g.eta);
      else text = (g.n > 1 ? g.n + ' × ' : '') + word + ' · no reach';
      if (g.engaged && g.atOurs) text += ' · under fire';
      if (on) {
        const cands = [];
        for (const dy of [-9, 9, -24, 24, -39, 39, -54, 54]) { cands.push([8, dy - LH / 2, 'left']); cands.push([-8, dy - LH / 2, 'right']); }
        label(text, g.x, g.y, { color, font: g.atOurs ? F12B : F12, prio: PRIO.threat + (g.atOurs ? 2 : 0), cands });
      } else if (g.atOurs) {
        // edge marker toward the threat, from its target's position (or the screen centre)
        const tgt = sim.byId(g.targetId);
        const from = tgt ? cam.toScreen(tgt.pos) : { x: cam.w / 2, y: cam.h / 2 };
        const ang = Math.atan2(g.y - from.y, g.x - from.x);
        const pad = 26;
        const ex = U.clamp(g.x, pad, cam.w - pad), ey = U.clamp(g.y, pad, cam.h - pad);
        ctx.save(); ctx.translate(ex, ey); ctx.rotate(ang); ctx.fillStyle = color;
        ctx.beginPath(); ctx.moveTo(9, 0); ctx.lineTo(-5, -6); ctx.lineTo(-5, 6); ctx.closePath(); ctx.fill(); ctx.restore();
        label(text, ex + (Math.cos(ang) > 0 ? -14 : 14), ey + (Math.sin(ang) > 0 ? -12 : 12), { color, align: Math.cos(ang) > 0 ? 'right' : 'left', font: F12B, prio: PRIO.threat + 3, keep: true });
      }
      if (g.atOurs && isFinite(g.eta) && (g.kind !== 'slug' || g.willHit)) {
        const cur = soonest[g.targetId];
        if (cur == null || g.eta < cur) soonest[g.targetId] = g.eta;
      }
    }
    // countdown ring on each of our ships with something inbound: the arc closes as the arrival nears
    for (const id in soonest) {
      const ship = sim.byId(id); if (!ship || ship.destroyed) continue;
      const c = cam.toScreen(ship.pos), eta = soonest[id];
      const R = 20 + (reduced ? 0 : 2 * Math.sin(t * 6));
      const frac = U.clamp(eta / 60, 0, 1);
      ctx.save(); ctx.strokeStyle = hexA(COLORS.crit, eta < 10 ? 0.95 : 0.7); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(c.x, c.y, R, -Math.PI / 2, -Math.PI / 2 + U.TAU * (1 - frac)); ctx.stroke();
      ctx.setLineDash([2, 4]); ctx.lineWidth = 1; ctx.strokeStyle = hexA(COLORS.crit, 0.35);
      ctx.beginPath(); ctx.arc(c.x, c.y, R, 0, U.TAU); ctx.stroke(); ctx.restore();
      if (ship === sel) tele(sim, cam, ship, 'incoming · ' + U.fmt.time(eta), COLORS.crit, F12B);
    }
  }

  function init(c) {
    canvas = c; ctx = c.getContext('2d');
    try {
      const mq = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
      if (mq) { reduced = !!mq.matches; if (mq.addEventListener) mq.addEventListener('change', (e) => { reduced = !!e.matches; }); }
    } catch (e) { reduced = false; }
    resize();
    window.addEventListener('resize', resize);
  }
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight;
    canvas.width = Math.floor(w * dpr); canvas.height = Math.floor(h * dpr);
    cache.backdropKey = '';
    Render._size = { w, h, dpr };
  }

  // ---- v11: contacts, tracks and being seen ----
  // What the player's side knows about each ship this frame: the truth for friends and civilians; for a hostile,
  // the sensor track (a ghost position with its uncertainty) until the track is good enough to aim by.
  // whole kilometres for the sensor picture: '910 km', never an exponent
  const km = (m) => (!isFinite(m) ? '—' : Math.abs(m) >= 10e3 ? U.fmt.num(Math.round(m / 1e3), 6) + ' km' : U.fmt.dist(m));
  const SQ = () => (OD.Sensors && OD.Sensors.T && OD.Sensors.T.solutionQ) || 2.7;
  const TQ = () => (OD.Sensors && OD.Sensors.T && OD.Sensors.T.trackQ) || 1.8;
  let viewSim = null, viewFrame = -1;
  const views = new Map();
  function viewOf(sim, ship) {
    if (viewSim !== sim || viewFrame !== frame) { views.clear(); viewSim = sim; viewFrame = frame; }
    let v = views.get(ship.id);
    if (v) return v;
    v = { pos: ship.pos, vel: ship.vel, q: 3, word: 'solution', posErr: 0, classKnown: true, ghost: false };
    const S = OD.Sensors;
    if (S && typeof S.track === 'function' && sim.playerFaction && ship.faction !== sim.playerFaction && ship.faction !== 'CIV' && !ship.destroyed) {
      try {
        const tr = S.track(sim, sim.playerFaction, ship);
        if (tr && isFinite(tr.q)) {
          const ghost = tr.q < SQ() && tr.est && tr.est.pos && isFinite(tr.est.pos.x) && isFinite(tr.est.pos.y);
          v = { pos: ghost ? tr.est.pos : ship.pos, vel: ghost && tr.est.vel ? tr.est.vel : ship.vel, q: tr.q, word: tr.word || (tr.q < TQ() ? 'contact' : tr.q < SQ() ? 'track' : 'solution'), posErr: isFinite(tr.posErr) ? tr.posErr : 0, classKnown: tr.classKnown !== false, ghost };
          // the anisotropic error, when the sensor model reports it: a bearing is sharp, a passive range is not
          if (isFinite(tr.bearingErr)) v.bearingErr = tr.bearingErr;
          if (isFinite(tr.rangeErr)) v.rangeErr = tr.rangeErr;
          if (isFinite(tr.los)) v.los = tr.los;
        }
      } catch (e) { Render.lastError = e; }
    }
    views.set(ship.id, v);
    return v;
  }
  // A hostile the sensors have not resolved: a mark at the ghost position inside its uncertainty ring, with what
  // is known about it. A bare contact is a '?' diamond with a bearing and a rough range; a track shows the class.
  // The uncertainty on a track: a soft filled patch and never a stroked ring, so it cannot be mistaken for a reach
  // ring drawn around the same point. When the sensor model gives bearingErr, rangeErr and the line-of-sight angle
  // it is a sliver elongated along that line (range · bearingErr across it); otherwise it falls back to a disc.
  function drawUncertainty(cam, v, col, range) {
    const diag = Math.hypot(cam.w, cam.h);
    let a = U.clamp((v.posErr || 0) * cam.zoom, 10, diag), b = a, rot = 0;
    const aniso = isFinite(v.bearingErr) && isFinite(v.rangeErr) && isFinite(v.los) && range > 0;
    if (aniso) {
      a = U.clamp(v.rangeErr * cam.zoom, 5, diag);
      b = U.clamp(range * v.bearingErr * cam.zoom, 5, diag);
      rot = -v.los; // world angle to screen angle
    }
    ctx.save();
    if (rot) ctx.rotate(rot);
    ctx.scale(Math.max(a, 0.01), Math.max(b, 0.01));
    const rg = ctx.createRadialGradient(0, 0, 0.16, 0, 0, 1);
    rg.addColorStop(0, hexA(col, 0.22)); rg.addColorStop(0.65, hexA(col, 0.13)); rg.addColorStop(1, hexA(col, 0));
    ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(0, 0, 1, 0, U.TAU); ctx.fill();
    ctx.restore();
  }
  function drawContact(sim, cam, ship, v, isSel, isTarget, t) {
    const s = cam.toScreen(v.pos);
    if (s.x < -300 || s.y < -300 || s.x > cam.w + 300 || s.y > cam.h + 300) return;
    const fac = OD.Ships.FACTIONS[ship.faction];
    const contact = v.q < TQ() || !v.classKnown;
    // an unidentified contact is not amber: amber is the ISA's colour and says who a ship belongs to
    const col = contact ? COLORS.unknown : fac.color;
    // what we know, and who is looking: the selected ship of ours, else the first
    const own = sim.playerShips().filter((x) => x.role !== 'station');
    const from = own.find((x) => x.id === (OD.UI && OD.UI.selected)) || own[0] || null;
    const range = from ? U.dist(v.pos, from.pos) : 0;
    ctx.save(); ctx.translate(s.x, s.y);
    drawUncertainty(cam, v, col, range);
    ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.lineJoin = 'round';
    if (contact) {
      ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(8, 0); ctx.lineTo(0, 8); ctx.lineTo(-8, 0); ctx.closePath(); ctx.stroke();
      paint('?', 0, 0.5, { align: 'center', color: col, font: F12B });
    } else {
      // a hollow hull glyph pointing the way the track seems to move
      const dir = U.len(v.vel) > 1 ? U.angleOf(v.vel) : ship.heading;
      ctx.save(); ctx.rotate(-dir);
      ctx.beginPath(); ctx.moveTo(9, 0); ctx.lineTo(-6, 5); ctx.lineTo(-3, 0); ctx.lineTo(-6, -5); ctx.closePath(); ctx.stroke();
      ctx.restore();
    }
    const R0 = 12;
    if (isSel) {
      ctx.strokeStyle = COLORS.select; ctx.lineWidth = RING.select.width; ctx.setLineDash(RING.select.dash);
      ctx.beginPath(); ctx.arc(0, 0, R0 + 5, 0, U.TAU); ctx.stroke();
    }
    if (isTarget) {
      const R = R0 + 9, k = Math.max(6, R * 0.3);
      ctx.save(); ctx.rotate(reduced ? 0 : t * 0.6);
      ctx.strokeStyle = COLORS.target; ctx.lineWidth = 1.6; ctx.lineJoin = 'miter';
      ctx.beginPath();
      [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([sx, sy]) => { ctx.moveTo(sx * R, sy * (R - k)); ctx.lineTo(sx * R, sy * R); ctx.lineTo(sx * (R - k), sy * R); });
      ctx.stroke(); ctx.restore();
    }
    ctx.restore();
    // what we know about it, as this contact's own block
    const b = blockOf(sim, cam, ship);
    if (!b.corner) { b.ax = s.x; b.ay = s.y; b.R0 = R0; }
    b.head = contact
      ? [{ text: 'contact', font: F13B, color: col }, { text: from ? 'bearing ' + U.fmt.deg(U.angleOf(U.sub(v.pos, from.pos))) + ' · ~' + km(range) : 'class unknown', color: COLORS.dim }]
      : [{ text: ship.name, font: F13B, color: hexA(col, 0.85) }, { text: 'track · ' + OD.Ships.CLASSES[ship.cls].role + (from ? ' · ~' + km(range) : '') + ' ±' + km(v.posErr), color: COLORS.dim }];
    b.prio = PRIO.name + (isSel ? 6 : isTarget ? 4 : 0);
    b.keep = !!isSel;
  }
  // Being seen: around the selected ship, the range from which the best hostile sensor gets a solution on it with
  // its signature right now; a PINNED tag when a hostile already holds one; a slow sweep on an active sensor.
  function drawSignature(sim, cam, sel, t) {
    const S = OD.Sensors;
    if (!S || typeof S.seenFrom !== 'function') return;
    let sf = null;
    try { sf = S.seenFrom(sim, sel); } catch (e) { Render.lastError = e; return; }
    const c = cam.toScreen(sel.pos);
    const safe = safeRect(cam);
    const maxR = Math.hypot(cam.w, cam.h);
    // A hostile that carries a solution forward by dead reckoning can hold us from beyond the range our
    // signature gives away right now: the ring then sits at the range she actually holds us from, so it is
    // never inside a hostile that already has us.
    const heldR = sf && sf.held > 0 && isFinite(sf.held) ? sf.held : 0;
    const showR = sf ? Math.max(sf.solution || 0, heldR) : 0;
    if (sf && showR > 0 && isFinite(showR)) {
      const rpx = showR * cam.zoom;
      const text = heldR > (sf.solution || 0)
        ? 'held as a solution from ' + km(heldR) + (sf.heldBy ? ' · by ' + sf.heldBy : '') + (sf.word ? ' · ' + sf.word : '')
        : 'a solution on us from ' + km(sf.solution) + (sf.by ? ' · by ' + sf.by : '') + (sf.word ? ' · ' + sf.word : '');
      if (rpx >= 9 && ringSeen(c, rpx, safe)) {
        ring(c, rpx, hexA(COLORS.blue, 0.55), RING.signature);
        ringCaption(cam, c, rpx, text, { color: hexA(COLORS.blue, 0.9), font: F12 });
      } else if (rpx > 9) {
        // the ring is off every edge: the line joins the ship's own block instead
        tele(sim, cam, sel, (heldR > (sf.solution || 0) ? 'held from ' : 'seen from ') + km(showR) + ' · past the map edge', hexA(COLORS.blue, 0.85));
      }
    }
    // pinned: a hostile holds a solution on us (seenFrom's `held` when the module reports it, else the live track)
    let pinnedBy = null;
    if (sf && sf.heldBy) pinnedBy = sf.heldBy;
    else if (typeof S.quality === 'function') {
      for (const h of sim.hostiles(sel)) { let q = 0; try { q = S.quality(sim, h, sel); } catch (e) { q = 0; } if (q >= SQ()) { pinnedBy = h.name || true; break; } }
    }
    if (pinnedBy) {
      let sig = null; try { sig = S.signature(sel); } catch (e) { sig = null; }
      const blink = reduced ? 1 : 0.7 + 0.3 * Math.sin(t * 5);
      tele(sim, cam, sel, (typeof pinnedBy === 'string' ? pinnedBy + ' has a solution on us' : 'a solution on us') + (sig && sig.word ? ' · ' + sig.word : ''), hexA(COLORS.crit, blink), F12B);
    }
    // active sensor: a slow sweep out to its reach
    if (sel.activeSensor && sel.activeRange > 0) {
      const rpx = Math.min(sel.activeRange * cam.zoom, maxR);
      if (rpx > 12) {
        const a0 = reduced ? 0.6 : (t * 0.9) % U.TAU;
        ctx.save();
        const g = ctx.createConicGradient ? ctx.createConicGradient(a0, c.x, c.y) : null;
        if (g) { g.addColorStop(0, hexA(COLORS.accent, 0.22)); g.addColorStop(0.18, hexA(COLORS.accent, 0)); g.addColorStop(1, hexA(COLORS.accent, 0)); ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.arc(c.x, c.y, rpx, 0, U.TAU); ctx.fill(); }
        ctx.strokeStyle = hexA(COLORS.accent, 0.7); ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(c.x + Math.cos(a0) * rpx, c.y + Math.sin(a0) * rpx); ctx.stroke();
        ctx.restore();
        // the reach itself is a reach ring like any other; off the map, the number joins the ship's block
        if (sel.activeRange * cam.zoom <= maxR && ringSeen(c, rpx, safe)) {
          ring(c, rpx, hexA(COLORS.accent, 0.35), RING.reach);
          ringCaption(cam, c, rpx, 'active sensor · ' + km(sel.activeRange), { color: hexA(COLORS.accent, 0.85), font: F12 });
        } else tele(sim, cam, sel, 'active sensor · ' + km(sel.activeRange), hexA(COLORS.accent, 0.85));
      }
    }
  }

  function draw(sim, cam, ui) {
    if (!ctx) return;
    frame++;
    const sz = Render._size; cam.w = sz.w; cam.h = sz.h; cam.dpr = sz.dpr;
    ctx.setTransform(sz.dpr, 0, 0, sz.dpr, 0, 0);
    const t = performance.now() / 1000;
    queue = []; blocks.clear();
    // Follow puts the ship in the middle of what the HUD and any open band leave clear, not of the canvas.
    if (cam.follow) {
      const f = sim && sim.byId(cam.follow);
      if (f) {
        const ins = cam.inset || { l: 0, r: 0, t: 0, b: 0 };
        const cw = cam.w - (ins.l || 0) - (ins.r || 0), ch = cam.h - (ins.t || 0) - (ins.b || 0);
        // The follow point stays inside whatever is free, however little (a phone with the board and a hint open
        // leaves a strip): only a strip under 60 px falls back to the canvas centre.
        const fx = cw > 60 ? (ins.l || 0) + cw / 2 : cam.w / 2;
        const fy = ch > 60 ? (ins.t || 0) + ch / 2 : cam.h / 2;
        cam.x = f.pos.x - (fx - cam.w / 2) / cam.zoom;
        cam.y = f.pos.y + (fy - cam.h / 2) / cam.zoom;
      }
    }

    drawSpace(cam, sim ? sim.sunAngle : -0.6);
    if (!sim) { drawVignette(cam); return; }
    drawBody(sim, cam);
    const sel = ui && ui.selected ? sim.byId(ui.selected) : null;
    drawGrid(sim, cam, sel);
    if (sel && !sel.destroyed) { drawReach(sim, cam, sel); try { drawSignature(sim, cam, sel, t); } catch (e) { Render.lastError = e; } }
    updateTrails(sim); drawTrails(sim, cam);
    for (const ship of sim.ships) {
      if (ship.destroyed || ship.role === 'station' || viewOf(sim, ship).ghost) continue;
      let danger = false;
      if (sim.body && ship !== sel) { const cm = ship._coastMark; if (cm && cm.simId === sim && sim.time - cm.t < 5) danger = cm.danger; else { try { danger = P.orbitalElements(sim.body.mu, ship.pos, ship.vel).periapsis < sim.body.radius; } catch (e) { danger = false; } } }
      drawPath(sim, cam, ship, sel === ship, ship === sel || danger);
      if (sim.body && (ship === sel || danger)) drawCoastMark(sim, cam, ship);
    }
    if (sel && !sel.destroyed) { drawPlan(sim, cam, sel); drawOrderRing(sim, cam, sel); }
    drawMarkers(sim, cam);
    drawFx(sim, cam);
    const targetId = sel ? sel.target : null;
    let hintId = null;
    try { const m = OD.Guide && OD.Guide.mark; if (m && m.shipId && (m.until == null || sim.time < m.until)) hintId = m.shipId; } catch (e) { hintId = null; }
    for (const ship of sim.ships) if (ship !== sel) drawShip(sim, cam, ship, false, ship.id === targetId, ship.id === hintId, t);
    if (sel) drawShip(sim, cam, sel, true, sel.id === targetId, sel.id === hintId, t);
    if (sel && !sel.destroyed) { drawVectors(sim, cam, sel); drawTurnArc(sim, cam, sel); }
    if (OD.Engagement && OD.Engagement.render) { try { OD.Engagement.render(ctx, cam, sim); } catch (e) { Render.lastError = e; } }
    if (sel && !sel.destroyed) { try { drawLadder(sim, cam, sel); } catch (e) { Render.lastError = e; } }
    try { drawThreats(sim, cam, sel, t); } catch (e) { Render.lastError = e; }
    drawVignette(cam);
    // under the console (menu, briefing, hangar) the demo scene is scenery: no chips, no plates, no scale bar
    if (OD.Bridge && OD.Bridge.active) { queue.length = 0; }
    else { drawScaleBar(cam); drawLabels(cam); }
  }

  const Render = { init, draw, resize, Camera, COLORS, hexA, artState, artReady, artId, artOpts, shipFx, muzzleOf, hullEdge, facetShown, viewOf, frame: () => frame, _size: { w: 1, h: 1, dpr: 1 }, lastError: null, labelCount: null };
  OD.Render = Render;
})();
