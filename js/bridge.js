/* Orbital Declaration — bridge console. The menus are drawn on the tactical canvas as part of the bridge: a
   console frame with corner brackets and hairlines, a header strip, a scanline sweep, titles that type in, keys
   drawn as bracketed labels, numbered entries, the live scene behind and a slowly rotating hull. main.js supplies
   every action through the model; an offscreen DOM mirror (#bridgeA11y) carries real buttons for keyboards and
   screen readers. Screens: menu, chapters, briefing, situation, hangar, inspect, skirmish, pause, debrief. */
(function () {
  'use strict';
  const OD = (window.OD = window.OD || {});
  const U = OD.U;
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  // palette and fonts: the same tokens as index.html
  const C = { accent: '#4fd1c5', accent2: '#f0a04b', ink: '#e0e8f0', ink2: '#b1bfce', dim: '#7f91a7', ground: '#04070c', line: 'rgba(120,150,180,0.22)', line2: 'rgba(120,150,180,0.42)', crit: '#ff6b6b', good: '#7ad97a', warn: '#ffb454', danger: '#ffb0b0', civ: '#b9c3d1', accentA: (a) => 'rgba(79,209,197,' + a + ')' };
  const DISPLAY = 'Rajdhani, Bahnschrift, "DIN Alternate", "Segoe UI", sans-serif';
  const MONO = '"IBM Plex Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace';
  const SANS = '"IBM Plex Sans", "Segoe UI", system-ui, sans-serif';
  const F = { d: (px, w) => (w || 600) + ' ' + px + 'px ' + DISPLAY, m: (px, w) => (w || 400) + ' ' + px + 'px ' + MONO, s: (px, w) => (w || 400) + ' ' + px + 'px ' + SANS, si: (px) => 'italic 400 ' + px + 'px ' + SANS };
  const LS = typeof CanvasRenderingContext2D !== 'undefined' && 'letterSpacing' in CanvasRenderingContext2D.prototype;
  let reduced = false;
  try { const mq = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)'); if (mq) { reduced = !!mq.matches; if (mq.addEventListener) mq.addEventListener('change', (e) => { reduced = !!e.matches; }); } } catch (e) { reduced = false; }

  let ctx = null;
  // console state
  const B = {
    active: false, current: null, model: null,
    hits: [], prevHits: [], focusId: null, focusByKey: false, hover: null, pressedId: null, pressT: -1, down: null, dragging: false,
    scroll: 0, scrollMax: 0, openedAt: 0, t: 0, bootT: performance.now() / 1000, W: 0, H: 0, phone: false, S: 1,
    az: 35, mirrorSig: '', mirrorRoot: null, canvas: null, uid: 0, hullTick: 0,
  };
  let FR = { x: 0, y: 0, w: 0, h: 0 }, CT = 0, CB = 0, KEY_H = 38, EH = 58, SIG = null;

  const play = (n) => { try { if (OD.Sound && typeof OD.Sound.play === 'function') OD.Sound.play(n); } catch (e) { /* optional */ } };
  const px = (n) => Math.round(n * B.S);
  const up = (s) => String(s).toUpperCase();

  // ---------------------------------------------------------------- text
  const wrapCache = new Map();
  function wrap(str, f, maxW) {
    const k = f + '|' + Math.round(maxW) + '|' + str;
    const c = wrapCache.get(k); if (c) return c;
    ctx.font = f; if (LS) ctx.letterSpacing = '0px';
    const lines = [];
    for (const para of String(str).split('\n')) {
      let line = '';
      for (const w of para.split(/\s+/)) { const test = line ? line + ' ' + w : w; if (line && ctx.measureText(test).width > maxW) { lines.push(line); line = w; } else line = test; }
      lines.push(line);
    }
    if (wrapCache.size > 600) wrapCache.clear();
    wrapCache.set(k, lines); return lines;
  }
  function text(str, x, y, f, color, align, ls) {
    ctx.font = f; ctx.fillStyle = color; ctx.textAlign = align || 'left'; ctx.textBaseline = 'alphabetic';
    if (LS) ctx.letterSpacing = ls || '0px';
    ctx.fillText(str, x, y);
    if (LS) ctx.letterSpacing = '0px';
  }
  function measure(str, f, ls) { ctx.font = f; if (LS) ctx.letterSpacing = ls || '0px'; const w = ctx.measureText(str).width; if (LS) ctx.letterSpacing = '0px'; return w; }
  function hair(x0, y, x1, color) { ctx.strokeStyle = color || C.line; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x0, Math.round(y) + 0.5); ctx.lineTo(x1, Math.round(y) + 0.5); ctx.stroke(); }
  function brackets(x, y, w, h, color, len) {
    const l = len || 7; x = Math.round(x) + 0.5; y = Math.round(y) + 0.5; w = Math.round(w); h = Math.round(h);
    ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.beginPath();
    ctx.moveTo(x, y + l); ctx.lineTo(x, y); ctx.lineTo(x + l, y);
    ctx.moveTo(x + w - l, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + l);
    ctx.moveTo(x, y + h - l); ctx.lineTo(x, y + h); ctx.lineTo(x + l, y + h);
    ctx.moveTo(x + w - l, y + h); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w, y + h - l);
    ctx.stroke();
  }
  // a title that types in; reduced motion shows it whole
  function typed(str, delay) {
    if (reduced) return { text: str, cursor: false, done: true };
    const n = Math.floor((B.t - B.openedAt - (delay || 0)) * 42);
    if (n >= str.length) return { text: str, cursor: false, done: true };
    return { text: str.slice(0, Math.max(0, n)), cursor: true, done: false };
  }
  // typed text lines; returns the y after the last line
  function title(lines, x, y, size, color, delay) {
    // A title never runs off the frame: shrink it until its widest line fits the width left of the margin
    // ("OBJECTIVES COMPLETE" at 36 px clipped on a 390 px phone).
    const maxW = FR.x + FR.w - (B.phone ? 12 : 56) - x;
    if (maxW > 0) { while (size > px(18) && Math.max.apply(null, lines.map((l) => measure(up(l || ''), F.d(size, 700), '0.02em'))) > maxW) size -= 1; }
    const f = F.d(size, 700), lh = Math.round(size * 0.94);
    const all = lines.join('\n');
    const tp = typed(all, delay);
    const shown = tp.text.split('\n');
    for (let i = 0; i < shown.length; i++) {
      text(up(shown[i]), x, y + lh * (i + 1) - Math.round(size * 0.16), f, color, 'left', '0.02em');
      if (tp.cursor && i === shown.length - 1 && Math.floor(B.t * 6) % 2 === 0) { const w = measure(up(shown[i]), f, '0.02em'); ctx.fillStyle = C.accent; ctx.fillRect(x + w + 4, y + lh * i + Math.round(size * 0.16), Math.max(3, size * 0.08), lh - Math.round(size * 0.24)); }
    }
    return y + lh * lines.length + 4;
  }
  function eyebrow(x, y, str, color) {
    ctx.fillStyle = color || C.accent; ctx.fillRect(x, y - px(5), 18, 2);
    text(up(str), x + 28, y, F.d(px(11.5)), color || C.accent, 'left', '0.24em');
    return y + px(22);
  }
  function paragraph(str, x, y, w, o) {
    o = o || {};
    const f = o.font || F.s(px(o.size || 14.5)), lh = px(o.lh || (o.size || 14.5) * 1.45);
    const lines = wrap(str, f, w);
    for (const l of lines) { text(l, x, y + px(13), f, o.color || C.ink2, 'left'); y += lh; }
    return y + (o.gap == null ? px(8) : o.gap);
  }
  function h3(x, y, w, str) { const f = F.d(px(11.5)); text(up(str), x, y + px(10), f, C.dim, 'left', '0.18em'); const tw = measure(up(str), f, '0.18em'); hair(x + tw + 10, y + px(6), x + w); return y + px(24); }
  function kv(x, y, w, k, v, color) { text(k, x, y + px(14), F.s(px(13)), C.dim); text(v, x + w, y + px(14), F.m(px(12.5)), color || C.ink, 'right'); hair(x, y + px(22), x + w); return y + px(26); }

  // ---------------------------------------------------------------- regions (hit testing, focus, mirror)
  function region(r) {
    r.id = r.id || ('r' + B.uid++);
    if (r.focusable == null) r.focusable = true;
    if (r.mirror == null) r.mirror = true;
    B.hits.push(r); return r;
  }
  const isHot = (r) => B.hover === r.id || B.focusId === r.id;
  const isPressed = (r) => B.pressedId === r.id && B.t - B.pressT < 0.16;
  function hitAt(x, y) {
    const list = B.prevHits;
    for (let i = list.length - 1; i >= 0; i--) {
      const r = list[i];
      if (r.clip && (y < r.clip[0] || y > r.clip[1])) continue;
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return r;
    }
    return null;
  }
  function activate(r, how) {
    if (!r || r.disabled || typeof r.act !== 'function') return false;
    B.pressedId = r.id; B.pressT = B.t;
    play(r.sound || (r.esc ? 'back' : 'key'));
    try { r.act(how); } catch (e) { OD.errors && OD.errors.push('bridge action: ' + (e && e.stack || e)); }
    return true;
  }

  // ---------------------------------------------------------------- controls
  // a key: a bracketed label that lights on hover and fills on press
  function key(x, y, o) {
    const f = F.d(px(12.5)), lab = up(o.label);
    const lw = measure(lab, f, '0.1em');
    const kf = F.m(px(9.5)), kw = o.kbd ? measure(o.kbd, kf) + px(14) : 0;
    const h = o.h || KEY_H, w = o.w || Math.ceil(lw + kw + px(30));
    const r = region(Object.assign({}, o, { x, y, w, h, kind: 'key' }));
    const hot = isHot(r), pressed = isPressed(r);
    let color = o.disabled ? C.dim : o.danger ? C.danger : (o.primary || hot) ? C.accent : C.ink2;
    if (pressed) { ctx.fillStyle = C.accent; ctx.fillRect(x, y, w, h); color = C.ground; }
    else if (hot && !o.disabled) { ctx.fillStyle = o.danger ? 'rgba(255,107,107,0.12)' : C.accentA(0.08); ctx.fillRect(x, y, w, h); }
    if (o.disabled) ctx.globalAlpha *= 0.45;
    brackets(x, y, w, h, pressed ? C.ground : (hot || o.primary) && !o.disabled ? C.accent : C.line2);
    const tx = x + (w - lw - kw) / 2;
    text(lab, tx, y + h / 2 + px(4.5), f, color, 'left', '0.1em');
    if (o.kbd) {
      const kx = tx + lw + px(10), kh = px(13), ky = y + h / 2 - kh / 2;
      ctx.strokeStyle = pressed ? 'rgba(4,20,26,0.5)' : C.line2; ctx.lineWidth = 1; ctx.strokeRect(Math.round(kx) + 0.5, Math.round(ky) + 0.5, Math.round(kw - px(6)), kh);
      text(o.kbd, kx + (kw - px(6)) / 2, ky + kh - px(3), kf, pressed ? C.ground : C.dim, 'center');
    }
    if (o.disabled) ctx.globalAlpha /= 0.45;
    return w;
  }
  // a row of keys, wrapping when the row is too narrow; returns the y after the last row
  function keyRow(x, y, w, keys, o) {
    let cx = x, ry = y; const gap = px(8), h = (o && o.h) || KEY_H;
    for (const k of keys) {
      if (!k) continue;
      const f = F.d(px(12.5)); const kw = Math.ceil(measure(up(k.label), f, '0.1em') + (k.kbd ? measure(k.kbd, F.m(px(9.5))) + px(14) : 0) + px(30));
      if (cx > x && cx + kw > x + w) { cx = x; ry += h + gap; }
      key(cx, ry, Object.assign({ h, clip: o && o.clip }, k));
      cx += kw + gap;
    }
    return ry + h;
  }
  // a numbered console entry: number, lit bar, label, a line of small print
  function entry(x, y, w, o) {
    const sf = F.s(px(12.5));
    const subLines = o.sub ? (B.phone ? wrap(o.sub, sf, w - px(40)).slice(0, 2) : [o.sub]) : [];
    const h = o.h || (o.sub ? (subLines.length > 1 ? EH + px(16) : EH) : px(46));
    const r = region(Object.assign({}, o, { x, y, w, h, kind: 'entry', numbered: o.numbered !== false }));
    const hot = isHot(r) && !o.disabled, pressed = isPressed(r);
    if (pressed) { ctx.fillStyle = C.accentA(0.22); ctx.fillRect(x, y, w, h); }
    else if (hot) { ctx.fillStyle = C.accentA(0.07); ctx.fillRect(x, y, w, h); brackets(x, y, w, h, C.accentA(0.7), 8); }
    hair(x, y + h, x + w, C.line);
    if (o.n != null) text(String(o.n).padStart(2, '0'), x + px(2), y + px(20), F.m(px(11)), o.locked ? C.dim : hot || o.primary ? C.accent : C.dim);
    if (hot || o.primary || o.selected) { ctx.fillStyle = o.locked ? C.line2 : C.accent; ctx.fillRect(x + px(24), y + 10, 2, h - 20); }
    const lx = x + px(36), color = o.locked ? C.dim : o.danger ? C.danger : hot || o.primary || o.selected ? C.accent : (o.color || C.ink);
    const lf = F.d(px(o.size || 16.5));
    let lab = up(o.label);
    while (lab.length > 4 && measure(lab, lf, '0.12em') > w - px(40)) lab = lab.slice(0, -2).trim() + '…';
    text(lab, lx, y + (o.sub ? px(24) : h / 2 + px(5.5)), lf, color, 'left', '0.12em');
    if (o.done) { const lw = measure(lab, lf, '0.12em'); text('✓', lx + lw + px(10), y + px(24), F.m(px(13)), C.good); }
    subLines.forEach((sub, i) => {
      if (i === subLines.length - 1) while (sub.length > 6 && measure(sub, sf) > w - px(40)) sub = sub.slice(0, -4).trim() + '…';
      text(sub, lx, y + px(42) + i * px(16), sf, o.locked ? 'rgba(127,145,167,0.7)' : C.dim);
    });
    if (o.tag) { const tf = F.m(px(10)); const tw = measure(up(o.tag), tf, '0.08em'); text(up(o.tag), x + w - tw - px(4), y + px(20), tf, o.tagColor || C.dim, 'left', '0.08em'); }
    return y + h;
  }
  // a segmented control: LABEL  [ option ] [ option ]  with a lit underline under the active one
  function seg(x, y, o) {
    const lf = F.d(px(11)); const lab = up(o.label);
    text(lab, x, y + px(19), lf, C.dim, 'left', '0.18em');
    let cx = x + measure(lab, lf, '0.18em') + px(14);
    const h = o.h || (B.phone ? 44 : 30), f = F.s(px(12.5), 500);
    for (const opt of o.options) {
      const w = measure(opt.label, f) + px(20), active = o.value === opt.id;
      const r = region({ x: cx, y, w, h, kind: 'seg', id: o.id + ':' + opt.id, label: o.label + ' ' + opt.label, act: () => o.set(opt.id), clip: o.clip, group: o.id, value: opt.id });
      const hot = isHot(r), pressed = isPressed(r);
      if (pressed) { ctx.fillStyle = C.accentA(0.22); ctx.fillRect(cx, y, w, h); }
      else if (hot) { ctx.fillStyle = C.accentA(0.07); ctx.fillRect(cx, y, w, h); }
      ctx.fillStyle = active ? C.accent : hot ? C.line2 : C.line; ctx.fillRect(cx, y + h - 2, w, 2);
      text(opt.label, cx + w / 2, y + h / 2 + px(4.5), f, active ? C.accent : hot ? C.ink : C.dim, 'center');
      cx += w + 2;
    }
    return { w: cx - x, h };
  }
  // a stepper row: LABEL   [−]  value  [+]
  function stepper(x, y, w, o) {
    const h = o.h || (B.phone ? 46 : 40), bw = B.phone ? 44 : 34;
    const row = region({ x, y, w, h, kind: 'step', id: o.id, label: o.label + ' ' + o.value, mirror: false, act: () => { o.inc(); play('tick'); }, left: () => { o.dec(); play('tick'); }, right: () => { o.inc(); play('tick'); }, clip: o.clip });
    const hot = isHot(row);
    if (hot) { ctx.fillStyle = C.accentA(0.05); ctx.fillRect(x, y, w, h); ctx.fillStyle = C.accent; ctx.fillRect(x, y + 8, 2, h - 16); }
    hair(x, y + h, x + w, C.line);
    const lf = o.big ? F.d(px(14)) : F.s(px(13.5), 500);
    text(o.label, x + px(12), y + h / 2 + px(5), lf, o.color || (hot ? C.ink : C.ink2), 'left', o.big ? '0.06em' : '0px');
    if (o.sub) text(o.sub, x + px(12) + measure(o.label, lf, o.big ? '0.06em' : '0px') + px(10), y + h / 2 + px(5), F.m(px(10.5)), C.dim);
    const vw = o.valueW || px(58);
    const vx = x + w - bw - px(8) - vw / 2;
    text(o.value, vx, y + h / 2 + px(5), F.m(px(14), 500), o.zero ? C.dim : C.ink, 'center');
    const btn = (bx, lab, act, id) => {
      const r = region({ x: bx, y: y + (h - (bw - 4)) / 2, w: bw, h: bw - 4, kind: 'key', id: o.id + id, label: o.label + ' ' + lab + ' (' + o.value + ')', act: () => { act(); play('tick'); }, focusable: false, sound: 'tick', clip: o.clip });
      const hh = B.hover === r.id, pr = isPressed(r);
      if (pr) { ctx.fillStyle = C.accent; ctx.fillRect(r.x, r.y, r.w, r.h); }
      else if (hh) { ctx.fillStyle = C.accentA(0.1); ctx.fillRect(r.x, r.y, r.w, r.h); }
      brackets(r.x, r.y, r.w, r.h, hh || pr ? C.accent : C.line2, 6);
      text(lab, r.x + r.w / 2, r.y + r.h / 2 + px(5), F.m(px(15), 500), pr ? C.ground : hh ? C.accent : C.ink2, 'center');
    };
    btn(x + w - bw * 2 - vw - px(16), '−', o.dec, ':dec');
    btn(x + w - bw - px(4), '+', o.inc, ':inc');
    return y + h;
  }

  // ---------------------------------------------------------------- hull views
  const hullCache = { fit: new Map(), ships: new WeakMap() };
  function shipFor(spec) {
    if (!spec) return null;
    if (spec.deltaV && spec.mounts) return spec; // already a ship
    let c = hullCache.ships.get(spec);
    if (!c || c.cls !== spec.cls) { // a refit changes the spec's class in place
      let s = null; try { s = OD.Sim.makeShip(Object.assign({ faction: 'JC' }, spec)); } catch (e) { s = null; }
      c = { cls: spec.cls, ship: s }; hullCache.ships.set(spec, c);
    }
    return c.ship;
  }
  const artId = (ship) => (OD.Render && OD.Render.artId ? OD.Render.artId(ship) : ship.cls);
  const artOk = (ship) => !!(OD.Render && OD.Render.artReady && OD.Render.artReady(artId(ship)) && OD.ShipArt);
  // the hull length (px) that keeps the whole picture inside a box for every azimuth of the orbit
  function fitHull(ship, view, bw, bh) {
    const id = artId(ship);
    const k = (typeof id === 'object' ? (id.id + '@' + id.rev) : id) + '|' + (typeof view === 'object' ? 'orbit' + view.el : view);
    let b = hullCache.fit.get(k);
    if (!b) {
      b = { w: 1, h: 0.36 };
      if (artOk(ship) && typeof OD.ShipArt.bounds === 'function') {
        try {
          let mw = 0, mh = 0;
          const views = typeof view === 'object' ? [0, 30, 60, 90, 120, 150].map((az) => ({ az, el: view.el })) : [view];
          let mb = 0;
          for (const v of views) { const r = OD.ShipArt.bounds(id, { size: 100, view: v, quality: 'low' }); if (r && r.w) { mw = Math.max(mw, r.w); mh = Math.max(mh, r.h); mb = Math.max(mb, r.h - (r.oy || r.h / 2)); } }
          if (mw) b = { w: mw / 100, h: mh / 100, bottom: mb / 100 };
        } catch (e) { /* the silhouette fallback fits by length */ }
      }
      hullCache.fit.set(k, b);
    }
    const L = Math.min(bw / b.w, bh / b.h);
    return { L, bottom: (b.bottom == null ? b.h / 2 : b.bottom) * L };
  }
  const VIEWS = { side: 'side', top: 'top', 'three-quarter': 'threequarter' };
  // draws a ship in a box; view: 'orbit' (the rotating three-quarter view) or a named view
  function hull(ship, cx, cy, bw, bh, o) {
    o = o || {};
    const orbit = !o.view || o.view === 'orbit';
    const el = 20, az = reduced ? 35 : B.az;
    const view = orbit ? { az: 0, el } : (VIEWS[o.view] || o.view);
    const fit = fitHull(ship, view, bw, bh), L = fit.L * (o.fill || 0.9);
    const bucket = L > 220 ? Math.round(az / 3) * 3 : az;
    if (orbit) view.az = bucket;
    const extra = { cache: !orbit || L > 220, light: orbit ? { az: bucket - 50, el: 35 } : { az: -50, el: 35 }, quality: L > 320 ? 'high' : 'auto', plume: false };
    if (o.holo !== false) {
      // a faint holo stage under the hull
      const ey = cy + fit.bottom * (o.fill || 0.9) + bh * 0.06, ry = Math.max(8, bh * 0.08);
      ctx.save(); ctx.strokeStyle = C.accentA(0.16); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(cx, ey, bw * 0.42, ry, 0, 0, TAU); ctx.stroke();
      ctx.setLineDash([2, 6]); ctx.beginPath(); ctx.ellipse(cx, ey, bw * 0.3, ry * 0.7, 0, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
      ctx.restore();
    }
    try {
      if (OD.UI && typeof OD.UI.drawHull === 'function') OD.UI.drawHull(ctx, ship, cx, cy, L, view, extra);
      else if (artOk(ship)) OD.ShipArt.draw(ctx, artId(ship), OD.Render.artOpts(ship, null, Object.assign({ x: cx, y: cy, size: L, view }, extra)));
    } catch (e) { if (OD.Render) OD.Render.lastError = 'bridge hull: ' + (e && e.message); }
    return { L, view };
  }
  // part labels in two lanes above and below the picture, with elbow leaders; labels slide sideways to a free slot
  function callouts(ship, cx, cy, L, view, box, max) {
    if (!artOk(ship) || typeof OD.ShipArt.callouts !== 'function') return [];
    let parts;
    try { parts = OD.ShipArt.callouts(artId(ship), OD.Render.artOpts(ship, null, { size: L, view, rotation: 0 })) || []; } catch (e) { return []; }
    const f = F.m(px(10.5)); ctx.font = f;
    const items = parts.slice(0, max || 12).map((p) => ({ label: p.label, text: p.text, px: cx + p.x, py: cy + p.y, w: measure(p.label, f) + 8 })).sort((a, b) => a.px - b.px);
    const ROWS = 3, STEP = px(14);
    const lanes = { up: { edge: [-1e9, -1e9, -1e9] }, down: { edge: [-1e9, -1e9, -1e9] } };
    const count = { up: 0, down: 0 };
    for (const it of items) { it.side = it.py < cy - 2 ? 'up' : it.py > cy + 2 ? 'down' : (count.up <= count.down ? 'up' : 'down'); count[it.side]++; }
    for (const it of items) {
      const lane = lanes[it.side]; let best = null;
      for (let row = 0; row < ROWS; row++) {
        const x0 = Math.max(it.px - 4, lane.edge[row] + 8);
        if (x0 + it.w > box.x + box.w) continue;
        const cost = (x0 - (it.px - 4)) + row * 6;
        if (!best || cost < best.cost) best = { row, x0, cost };
      }
      if (!best) continue;
      it.row = best.row; it.x0 = best.x0; lane.edge[best.row] = best.x0 + it.w;
      const upside = it.side === 'up';
      const ty = upside ? box.y + px(12) + it.row * STEP : box.y + box.h - px(6) - it.row * STEP;
      const bus = upside ? box.y + px(12) + ROWS * STEP + 2 : box.y + box.h - px(6) - ROWS * STEP - 8;
      const sx = it.x0 + 4, by = upside ? Math.min(bus, it.py) : Math.max(bus, it.py);
      ctx.strokeStyle = C.accentA(0.5); ctx.lineWidth = 1; ctx.beginPath();
      ctx.moveTo(it.px, it.py); ctx.lineTo(it.px, by); ctx.lineTo(sx, by); ctx.lineTo(sx, upside ? ty + 3 : ty - 10); ctx.stroke();
      ctx.fillStyle = C.accent; ctx.beginPath(); ctx.arc(it.px, it.py, 2, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(4,7,12,0.7)'; ctx.fillRect(it.x0 - 1, ty - px(10), it.w + 2, px(13));
      text(it.label, it.x0 + 4, ty, f, 'rgba(224,232,240,0.94)');
    }
    return items;
  }

  // ---------------------------------------------------------------- frame, header, effects
  let scanPattern = null;
  function scrim(kind, panelRight) {
    let g;
    if (kind === 'beside') { g = ctx.createLinearGradient(0, 0, B.W, 0); g.addColorStop(0, 'rgba(4,7,12,0.93)'); g.addColorStop(clamp(panelRight / B.W, 0.1, 0.9), 'rgba(4,7,12,0.82)'); g.addColorStop(1, 'rgba(4,7,12,0.28)'); }
    else if (kind === 'pause') { g = 'rgba(4,7,12,0.72)'; }
    else { g = ctx.createRadialGradient(B.W * 0.5, B.H * 0.4, B.H * 0.1, B.W * 0.5, B.H * 0.4, B.W * 0.75); g.addColorStop(0, 'rgba(4,7,12,0.84)'); g.addColorStop(1, 'rgba(4,7,12,0.95)'); }
    ctx.fillStyle = g; ctx.fillRect(0, 0, B.W, B.H);
  }
  function frame() {
    ctx.strokeStyle = C.line; ctx.lineWidth = 1; ctx.strokeRect(FR.x + 0.5, FR.y + 0.5, FR.w, FR.h);
    brackets(FR.x - 1, FR.y - 1, FR.w + 2, FR.h + 2, C.accent, B.phone ? 14 : 22);
    // ticks along the bottom rail
    ctx.strokeStyle = C.line2; ctx.beginPath();
    for (let x = FR.x + 40; x < FR.x + FR.w - 20; x += 40) { ctx.moveTo(x + 0.5, FR.y + FR.h); ctx.lineTo(x + 0.5, FR.y + FR.h - (Math.round((x - FR.x) / 40) % 5 === 0 ? 8 : 4)); }
    ctx.stroke();
  }
  function header(mode) {
    const y = FR.y + 6, h = B.phone ? 44 : 28;
    ctx.fillStyle = C.accent; ctx.fillRect(FR.x + 14, y + h / 2 - 3, 6, 6);
    text(up('Bridge · ' + mode), FR.x + 28, y + h / 2 + px(4.5), F.d(px(11.5)), C.accent, 'left', '0.22em');
    const clock = 'T+' + U.fmt.clock(B.t - B.bootT);
    const keys = [];
    if (OD.Sound) { const on = !!(OD.Sound.enabled == null ? true : OD.Sound.enabled); keys.push({ id: 'hdr:snd', label: 'SND ' + (on ? '●' : '○'), aria: 'Sound ' + (on ? 'on: switch off' : 'off: switch on'), act: () => { try { OD.Sound.setEnabled(!on); if (!on) OD.Sound.unlock && OD.Sound.unlock(); } catch (e) { /* optional */ } } }); }
    keys.push({ id: 'hdr:aa', label: 'AA', aria: 'Text size: ' + (OD.UI.textSize === 'large' ? 'large, switch to normal' : 'normal, switch to large'), act: () => { const nx = OD.UI.textSize === 'large' ? 'normal' : 'large'; OD.UI.setTextSize(nx, true); B.S = nx === 'large' ? 1.15 : 1; wrapCache.clear(); } });
    let kx = FR.x + FR.w - 12;
    for (let i = keys.length - 1; i >= 0; i--) { const f = F.d(px(11)); const w = Math.ceil(measure(keys[i].label, f, '0.1em') + px(22)); kx -= w; key(kx, y + (h - (B.phone ? 44 : 24)) / 2, Object.assign({ w, h: B.phone ? 44 : 24, focusable: false }, keys[i])); kx -= 6; }
    if (!B.phone || B.W > 520) text(clock, B.phone ? kx - 8 : B.W / 2, y + h / 2 + px(4.5), F.m(px(12)), C.ink2, B.phone ? 'right' : 'center');
    hair(FR.x + 10, y + h + 6, FR.x + FR.w - 10, C.line2);
  }
  function sweep() {
    if (!scanPattern) { const c = document.createElement('canvas'); c.width = 1; c.height = 3; const g = c.getContext('2d'); g.fillStyle = 'rgba(255,255,255,0.028)'; g.fillRect(0, 0, 1, 1); scanPattern = ctx.createPattern(c, 'repeat'); }
    ctx.fillStyle = scanPattern; ctx.fillRect(FR.x, FR.y, FR.w, FR.h);
    if (reduced) return;
    const y = FR.y + ((B.t * 0.11) % 1) * (FR.h + 120) - 60;
    const g = ctx.createLinearGradient(0, y - 50, 0, y + 50);
    g.addColorStop(0, C.accentA(0)); g.addColorStop(0.5, C.accentA(0.045)); g.addColorStop(1, C.accentA(0));
    ctx.fillStyle = g; ctx.fillRect(FR.x, Math.max(FR.y, y - 50), FR.w, Math.min(100, FR.y + FR.h - Math.max(FR.y, y - 50)));
  }
  function ease(t) { t = clamp(t, 0, 1); return 1 - Math.pow(1 - t, 3); }
  // the model's keys row; on phones it wraps
  function modelKeys(x, y, w, keys, clip) { return keyRow(x, y, w, keys, { clip }); }

  // a key rail pinned under the content; reserve it before the flow, draw it after
  function reserveRail(keys, x, w) {
    const list = (keys || []).filter(Boolean); if (!list.length) return null;
    const f = F.d(px(12.5)); let rows = 1, cx = x;
    for (const k of list) { const kw = Math.ceil(measure(up(k.label), f, '0.1em') + (k.kbd ? measure(k.kbd, F.m(px(9.5))) + px(14) : 0) + px(30)); if (cx > x && cx + kw > x + w) { rows++; cx = x; } cx += kw + px(8); }
    const h = rows * KEY_H + (rows - 1) * px(8) + px(20);
    CB -= h;
    return { h, draw() { CB += h; hair(x, CB - h + px(6), x + w, C.line2); keyRow(x, CB - h + px(16), w, list); } };
  }
  // scrolling content: everything drawn between begin() and end() is clipped to the content area and offset
  function beginFlow() { ctx.save(); ctx.beginPath(); ctx.rect(FR.x + 1, CT - 4, FR.w - 2, CB - CT + 8); ctx.clip(); return CT - B.scroll; }
  function endFlow(yEnd, top) {
    ctx.restore();
    const contentH = yEnd + B.scroll - CT + px(12);
    B.scrollMax = Math.max(0, contentH - (CB - CT));
    B.scroll = clamp(B.scroll, 0, B.scrollMax);
    if (B.scrollMax > 0) { // a hairline scroll track on the right rail
      const th = Math.max(24, (CB - CT) * ((CB - CT) / contentH)), ty = CT + (CB - CT - th) * (B.scroll / B.scrollMax);
      ctx.fillStyle = C.line; ctx.fillRect(FR.x + FR.w - 5, CT, 1, CB - CT); ctx.fillStyle = C.accentA(0.7); ctx.fillRect(FR.x + FR.w - 6, ty, 3, th);
    }
  }

  // ---------------------------------------------------------------- screens
  const SCREENS = {};
  const facColor = (f) => f === 'JC' ? C.accent : f === 'ISA' ? C.accent2 : C.civ;

  // the scene (demo ships) sits in the clear part of the screen; main.js frames it there
  function sceneRect() {
    if (!B.W && OD.Render && OD.Render._size) layout(OD.Render._size);
    if (!B.active) return { x: 0, y: 0, w: B.W, h: B.H };
    const m = B.model || {};
    if (B.phone) return { x: 0, y: B.H * 0.72, w: B.W, h: B.H * 0.28 };
    const beside = B.current === 'menu' || B.current === 'briefing' || B.current === 'debrief';
    const pr = m._panelRight || (beside ? FR.x + 56 + (B.current === 'menu' ? 520 : 640) : B.W * 0.5), top = beside ? CT + (CB - CT) * 0.58 : CT;
    return { x: pr + 30, y: top, w: Math.max(80, B.W - pr - 30 - FR.x), h: CB - top };
  }
  // a rotating hull with a caption, in the clear region
  function sideHull(spec, captionLines, opts) {
    const ship = shipFor(spec); if (!ship) return;
    const o = opts || {};
    const m = B.model || {}, pr = m._panelRight || B.W * 0.5;
    // `fill`: the hull sits lower and larger, for a screen whose text does not reach the bottom of the frame
    const r = { x: pr + 30, y: CT, w: Math.max(80, B.W - pr - 30 - FR.x), h: (CB - CT) * (o.fill ? 0.94 : 0.6) };
    const bw = Math.min(r.w * (o.fill ? 0.84 : 0.72), o.fill ? 620 : 520), bh = Math.min(r.h * (o.fill ? 0.6 : 0.7), o.fill ? 420 : 340);
    const cx = r.x + r.w / 2, cy = r.y + r.h * 0.5;
    hull(ship, cx, cy, bw, bh, {});
    let y = cy + bh / 2 + px(12);
    for (let i = 0; i < captionLines.length; i++) { text(up(captionLines[i]), cx, y + px(14), i === 0 ? F.d(px(13)) : F.m(px(10.5)), i === 0 ? C.ink2 : C.dim, 'center', i === 0 ? '0.16em' : '0.08em'); y += px(18); }
  }

  SCREENS.menu = function (m) {
    const PX = FR.x + (B.phone ? 12 : 56), PW = B.phone ? FR.w - 24 : 520;
    m._panelRight = PX + PW; scrim('beside', PX + PW); frame(); header('Main console');
    if (!B.phone && m.hull) sideHull(m.hull.spec, m.hull.caption || []);
    let y = beginFlow() + (B.phone ? px(8) : px(34));
    y = eyebrow(PX, y + px(8), m.eyebrow || 'Jovian system · 2211');
    y = title(['Orbital', 'Declaration'], PX - 2, y - px(4), B.phone ? px(46) : px(68), C.ink, 0.1) + px(6);
    y = paragraph(m.sub || '', PX, y, Math.min(PW, 520), { size: B.phone ? 13.5 : 15 }) + px(10);
    hair(PX, y, PX + PW, C.line2);
    m.entries.forEach((e, i) => { y = entry(PX, y, PW, { id: 'menu:' + i, n: i + 1, label: e.label, sub: e.sub, primary: e.primary, act: e.act, clip: [CT, CB] }); });
    y += px(14);
    // settings: text size, panel default, sound
    const items = [];
    if (m.settings.text) items.push({ id: 'set:text', label: 'Text', options: [{ id: 'normal', label: 'Normal' }, { id: 'large', label: 'Large' }], value: m.settings.text.value(), set: m.settings.text.set });
    if (m.settings.detail) items.push({ id: 'set:detail', label: 'Panel', options: [{ id: 'essentials', label: 'Essentials' }, { id: 'full', label: 'Full' }], value: m.settings.detail.value(), set: m.settings.detail.set });
    if (m.settings.sound) items.push({ id: 'set:sound', label: 'Sound', options: [{ id: 'on', label: 'On' }, { id: 'off', label: 'Off' }], value: m.settings.sound.value() ? 'on' : 'off', set: (v) => m.settings.sound.set(v === 'on') });
    let sx = PX, rowH = 0;
    for (const it of items) {
      const est = measure(up(it.label), F.d(px(11)), '0.18em') + px(14) + it.options.reduce((a, o) => a + measure(o.label, F.s(px(12.5), 500)) + px(22), 0);
      if (sx > PX && sx + est > PX + PW) { sx = PX; y += rowH + px(8); }
      const r = seg(sx, y, Object.assign({ clip: [CT, CB] }, it)); sx += r.w + px(22); rowH = r.h;
    }
    y += rowH + px(14);
    const foot = ['Δv = vₑ ln(m₀/m₁)', 'P = 2AεσT⁴', 'spot = 2.44 λR/D'];
    let fx = PX; for (const f of foot) { text(f, fx, y + px(12), F.m(px(11)), C.dim); fx += measure(f, F.m(px(11))) + px(22); if (fx > PX + PW) { fx = PX; y += px(16); } }
    endFlow(y + px(16));
  };

  SCREENS.chapters = function (m) {
    const PX = FR.x + (B.phone ? 12 : 56), PW = Math.min(FR.w - 2 * (PX - FR.x), 1040);
    scrim('wide'); frame(); header('Chapters');
    const rail = B.phone ? reserveRail(m.keys, PX, PW) : null;
    let y = beginFlow() + px(24);
    y = eyebrow(PX, y + px(8), m.eyebrow || 'Story');
    y = title([m.title || 'Eight chapters'], PX - 1, y - px(4), B.phone ? px(34) : px(44), C.ink) + px(4);
    y = paragraph(m.sub || '', PX, y, Math.min(PW, 720), { size: B.phone ? 13.5 : 14.5 }) + px(8);
    hair(PX, y, PX + PW, C.line2);
    const cols = B.phone ? 1 : 2, cw = (PW - (cols - 1) * 28) / cols, y0 = y;
    let maxY = y;
    m.chapters.forEach((c, i) => {
      const col = cols === 1 ? 0 : i < Math.ceil(m.chapters.length / 2) ? 0 : 1;
      const row = cols === 1 ? i : (col === 0 ? i : i - Math.ceil(m.chapters.length / 2));
      const ey = y0 + row * EH, ex = PX + col * (cw + 28);
      if (col === 1 && row === 0) hair(ex, ey, ex + cw, C.line2);
      const yy = entry(ex, ey, cw, { id: 'ch:' + i, n: c.n, label: c.title, sub: c.sub, done: c.done, locked: c.locked, disabled: c.locked, tag: c.locked ? 'locked' : '', act: c.act, clip: [CT, CB] });
      maxY = Math.max(maxY, yy);
    });
    y = maxY + px(22);
    if (!rail) y = modelKeys(PX, y, PW, m.keys, [CT, CB]);
    endFlow(y);
    if (rail) rail.draw();
  };

  SCREENS.briefing = function (m) {
    const PX = FR.x + (B.phone ? 12 : 56), PW = B.phone ? FR.w - 24 : 620;
    m._panelRight = PX + PW; scrim('beside', PX + PW); frame(); header(m.mode || 'Briefing');
    if (!B.phone && m.flagship) sideHull(m.flagship, m.flagshipCaption || []);
    const rail = B.phone ? reserveRail(m.keys, PX, PW) : null;
    let y = beginFlow() + px(20);
    y = eyebrow(PX, y + px(8), m.eyebrow || 'Briefing');
    y = title([m.title], PX - 1, y - px(4), B.phone ? px(34) : px(46), C.ink) + px(2);
    if (m.meta) { text(up(m.meta), PX, y + px(12), F.m(px(12)), C.dim, 'left', '0.06em'); y += px(30); }
    if (B.phone && m.flagship) { const ship = shipFor(m.flagship); if (ship) { hull(ship, PX + PW / 2, y + 90, PW - 20, 170, {}); text(up((m.flagshipCaption || [])[0] || ''), PX + PW / 2, y + 190, F.d(px(12)), C.ink2, 'center', '0.14em'); y += 204; } }
    for (const p of m.paragraphs || []) y = paragraph(p, PX, y, PW, { size: 14.5 });
    for (const c of m.comms || []) {
      ctx.fillStyle = C.accent; const y0 = y;
      text(up(c.speaker), PX + px(14), y + px(12), F.d(px(12)), C.accent, 'left', '0.12em'); y += px(18);
      y = paragraph(c.text, PX + px(14), y, PW - px(14), { font: F.si(px(14)), lh: 20.5, gap: px(4) });
      ctx.fillStyle = C.accent; ctx.fillRect(PX, y0 + px(2), 2, y - y0 - px(4)); y += px(8);
    }
    if (m.objectives && m.objectives.length) {
      y = h3(PX, y + px(4), PW, 'Objectives');
      for (const o of m.objectives) { text('◇', PX, y + px(13), F.m(px(13)), C.accent); const lines = wrap(o.text + (o.optional ? '  · optional' : ''), F.s(px(14)), PW - px(22)); for (const l of lines) { text(l, PX + px(22), y + px(13), F.s(px(14)), C.ink); y += px(20); } y += px(4); }
    }
    if (m.ships && m.ships.length) {
      y = h3(PX, y + px(6), PW, 'Ships');
      const cols = B.phone ? 1 : 2, cw = (PW - (cols - 1) * 20) / cols;
      m.ships.forEach((s, i) => { const cx = PX + (i % cols) * (cw + 20), cy = y + Math.floor(i / cols) * px(22); text(s.name, cx, cy + px(13), F.d(px(14)), facColor(s.faction), 'left', '0.04em'); const nw = measure(s.name, F.d(px(14)), '0.04em'); text(s.cls, cx + nw + px(8), cy + px(13), F.m(px(10.5)), C.dim); });
      y += Math.ceil(m.ships.length / cols) * px(22) + px(8);
    }
    y += px(10);
    if (!rail) y = modelKeys(PX, y, PW, m.keys, [CT, CB]);
    endFlow(y);
    if (rail) rail.draw();
  };

  // The war in plain words: the same furniture as the briefing (eyebrow, title, paragraphs, a key rail), plus
  // the two sides and, once chapters are behind you, what each result changed. main.js supplies the model.
  let sitPad = 0; // wide screens: how far down the flow block starts, measured on the previous draw
  SCREENS.situation = function (m) {
    const PX = FR.x + (B.phone ? 12 : 56), PW = B.phone ? FR.w - 24 : 620;
    m._panelRight = PX + PW; scrim('beside', PX + PW); frame(); header(m.mode || 'Situation');
    if (!B.phone && m.flagship) sideHull(m.flagship, m.flagshipCaption || [], { fill: true });
    const rail = B.phone ? reserveRail(m.keys, PX, PW) : null;
    const top = beginFlow();
    let y = top + px(20) + (B.phone ? 0 : sitPad);
    const y0 = y;
    y = eyebrow(PX, y + px(8), m.eyebrow || 'The war');
    y = title([m.title || 'The situation'], PX - 1, y - px(4), B.phone ? px(34) : px(46), C.ink) + px(2);
    if (m.meta) { text(up(m.meta), PX, y + px(12), F.m(px(12)), C.dim, 'left', '0.06em'); y += px(30); }
    const sides = () => {
      if (!(m.sides && m.sides.length)) return;
      y = h3(PX, y + px(6), PW, m.sidesTitle || 'The two sides');
      for (const sd of m.sides) {
        text(up(sd.name), PX, y + px(13), F.d(px(13.5)), facColor(sd.faction), 'left', '0.1em'); y += px(19);
        y = paragraph(sd.text, PX + px(12), y, PW - px(12), { size: 13.5, color: C.ink2, gap: px(6) });
      }
      y += px(2);
    };
    const paras = m.paragraphs || [];
    const para = (p) => { y = paragraph(p, PX, y, PW, { size: 14.5 }); };
    const picture = () => {
      if (!m.flagship) return;
      const ship = shipFor(m.flagship);
      if (!ship) return;
      hull(ship, PX + PW / 2, y + 90, PW - 20, 170, {});
      text(up((m.flagshipCaption || [])[0] || ''), PX + PW / 2, y + 190, F.d(px(12)), C.ink2, 'center', '0.14em');
      y += 204;
    };
    // A phone shows about two paragraphs before the fold, so the first screenful has to say who the
    // player is and who is fighting whom: the opening line, then the two sides, then the ship and
    // the rest of the text. On a wider screen the paragraphs run first and the sides follow them.
    if (B.phone) {
      if (paras.length) para(paras[0]);
      sides();
      picture();
      for (const p of paras.slice(1)) para(p);
    } else {
      for (const p of paras) para(p);
      sides();
    }
    if (m.sofar && m.sofar.length) {
      y = h3(PX, y + px(4), PW, m.sofarTitle || 'The war so far');
      for (const r of m.sofar) {
        text(String(r.n), PX, y + px(13), F.m(px(12)), r.outcome === 'victory' ? C.accent : C.crit);
        const lines = wrap(r.text, F.s(px(13.5)), PW - px(24));
        for (const l of lines) { text(l, PX + px(20), y + px(13), F.s(px(13.5)), C.ink2); y += px(19); }
        y += px(4);
      }
      y += px(2);
    }
    if (m.note) y = paragraph(m.note, PX, y + px(4), PW, { size: 12.5, color: C.dim });
    y += px(10);
    if (!rail) y = modelKeys(PX, y, PW, m.keys, [CT, CB]);
    endFlow(y);
    // Centre the block in the frame on the next draw: the console's first screen should not sit in the top half.
    sitPad = B.phone ? 0 : Math.max(0, Math.round(((CB - CT) - (y - y0) - px(44)) / 2));
    if (rail) rail.draw();
  };

  SCREENS.hangar = function (m) {
    const PX = FR.x + (B.phone ? 12 : 44), PW = FR.w - 2 * (PX - FR.x);
    scrim('wide'); frame(); header('Hangar');
    const specs = m.ships || [];
    const sel = clamp(m.sel || 0, 0, Math.max(0, specs.length - 1));
    const spec = specs[sel], ship = shipFor(spec), cls = spec ? OD.Ships.CLASSES[spec.cls] || {} : {};
    const rail = reserveRail(m.keys, PX, PW);
    let y = beginFlow() + px(16);
    y = eyebrow(PX, y + px(8), m.eyebrow || 'Pre-launch');
    y = title([m.title || 'Hangar'], PX - 1, y - px(4), B.phone ? px(32) : px(40), C.ink);
    const listEntry = (i, x, yy, w) => { const s = specs[i], c = OD.Ships.CLASSES[s.cls] || {}; return entry(x, yy, w, { id: 'hg:' + i, n: i + 1, label: s.name, sub: (c.name || s.cls) + (s._refit ? ' · refit' : ''), selected: i === sel, act: () => m.onSelect(i), clip: [CT, CB], h: B.phone ? px(50) : EH }); };
    const numbers = (x, yy, w) => {
      if (!ship) return yy;
      yy = h3(x, yy, w, 'Key numbers');
      const g = ship.accelNominal ? ship.accelNominal() / 9.80665 : 0;
      yy = kv(x, yy, w, 'Delta-v (full tanks)', U.fmt.dv(ship.deltaVFull ? ship.deltaVFull() : ship.deltaV()));
      if (ship.propMass < ship.fullPropMass * 0.995) yy = kv(x, yy, w, 'Delta-v aboard', U.fmt.dv(ship.deltaV()), C.warn);
      yy = kv(x, yy, w, 'Acceleration', U.fmt.num(g, 2) + ' g · ' + U.fmt.num(ship.accelNominal(), 2) + ' m/s²');
      yy = kv(x, yy, w, 'Armour nose · flank · tail', ship.armour.nose + ' · ' + ship.armour.flank + ' · ' + ship.armour.tail + ' cm');
      yy = kv(x, yy, w, 'Radiators', U.fmt.si(ship.radiatorArea, 'm²') + ' · ' + U.fmt.si(ship.radiatorPower ? OD.P.radiatorPower(ship.radiatorArea, ship.radiatorTemp) : 0, 'W'));
      yy = kv(x, yy, w, 'Heat sink', U.fmt.si(ship.sinkCapacity, 'J'));
      // The people aboard (v13): the pool the player deploys, from the crew module when it is loaded.
      if (ship.crew && ship.crew.total > 0) {
        const c = ship.crew, n = (c.parties || []).length;
        const xp = Math.max(0, Math.min(3, Math.round(c.xp || 0)));
        yy = kv(x, yy, w, 'Crew', c.total + ' · ' + n + (n === 1 ? ' party' : ' parties') + ' · experience ' + xp + ' of 3' + (xp > 0 ? ', repairs ' + (xp * 15) + ' % faster' : '') + (c.wounded > 0 ? ' · ' + c.wounded + ' wounded' : ''), c.wounded > 0 ? C.warn : undefined);
      }
      if (ship.hull < 0.999) yy = kv(x, yy, w, 'Hull integrity', Math.round(ship.hull * 100) + ' %', ship.hull < 0.5 ? C.crit : C.warn);
      text('Mounts', x, yy + px(14), F.s(px(13)), C.dim); yy += px(20);
      const names = ship.mounts.length ? ship.mounts.map((mt) => mt.name) : ['nothing fitted'];
      yy = paragraph(names.join(' · '), x, yy, w, { font: F.m(px(11.5)), lh: 16, color: C.ink, gap: px(6) });
      if (cls.blurb) yy = paragraph(cls.blurb, x, yy + px(2), w, { size: 12.5, color: C.dim });
      return yy;
    };
    if (B.phone) {
      hair(PX, y + px(4), PX + PW, C.line2); y += px(4);
      for (let i = 0; i < specs.length; i++) y = listEntry(i, PX, y, PW);
      if (ship) {
        const bw = PW - 16, bh = 200; const cx = PX + PW / 2, cy = y + bh / 2 + px(10);
        const box = { x: PX, y: y + px(6), w: PW, h: bh + px(8) };
        const r = hull(ship, cx, cy, bw * 0.8, bh * 0.62, {});
        callouts(ship, cx, cy, r.L, r.view, box, 8);
        y = box.y + box.h;
        text(up((cls.name || spec.cls) + ' · ' + (cls.length || ship.length) + ' m'), cx, y + px(12), F.m(px(10.5)), C.dim, 'center', '0.08em'); y += px(22);
      }
      y = numbers(PX, y, PW) + px(10);
      if (m.note) y = paragraph(m.note, PX, y, PW, { size: 12.5, color: C.dim });
      endFlow(y);
      if (rail) rail.draw();
    } else {
      const LW = Math.min(300, PW * 0.24), RW = Math.min(330, PW * 0.26), gap = 34;
      const LX = PX, RX = PX + PW - RW, MX = LX + LW + gap, MW = RX - gap - MX;
      let ly = h3(LX, y + px(6), LW, 'Your ships');
      for (let i = 0; i < specs.length; i++) ly = listEntry(i, LX, ly, LW);
      let ry = numbers(RX, y + px(6), RW);
      if (m.note) ry = paragraph(m.note, RX, ry + px(4), RW, { size: 12.5, color: C.dim });
      if (ship) {
        const box = { x: MX, y: y + px(6), w: MW, h: Math.min(460, CB - y - px(30)) };
        const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
        const r = hull(ship, cx, cy, box.w * 0.82, box.h * 0.6, {});
        callouts(ship, cx, cy, r.L, r.view, box, 12);
        text(up((cls.name || spec.cls) + ' · ' + (cls.length || ship.length) + ' m · ' + (OD.Ships.FACTIONS[ship.faction] || {}).name), cx, box.y + box.h + px(14), F.m(px(11)), C.dim, 'center', '0.08em');
        hair(box.x, box.y + box.h + px(26), box.x + box.w, C.line);
      }
      endFlow(Math.max(ly, ry));
      if (rail) rail.draw();
    }
  };

  SCREENS.inspect = function (m) {
    const PX = FR.x + (B.phone ? 12 : 44), PW = FR.w - 2 * (PX - FR.x);
    scrim('wide'); frame(); header('Hull view');
    const ship = shipFor(m.ship); const cls = ship ? OD.Ships.CLASSES[ship.cls] || {} : {};
    const view = m.view || 'three-quarter';
    const rail = reserveRail(m.keys, PX, PW);
    let y = beginFlow() + px(12);
    y = eyebrow(PX, y + px(8), m.eyebrow || 'Inspect');
    y = title([m.title || (ship ? ship.name : '')], PX - 1, y - px(4), B.phone ? px(30) : px(38), C.ink);
    if (m.sub) y = paragraph(m.sub, PX, y, Math.min(PW, 760), { size: 13.5, color: C.ink2 });
    const s = seg(PX, y, { id: 'insp:view', label: 'View', options: [{ id: 'side', label: 'Side' }, { id: 'top', label: 'Top' }, { id: 'three-quarter', label: 'Three-quarter' }, { id: 'orbit', label: 'Orbit' }], value: view, set: (v) => { m.view = v; }, clip: [CT, CB] });
    y += s.h + px(10);
    if (ship) {
      const box = { x: PX, y, w: PW, h: Math.max(160, CB - y - px(10)) };
      hair(box.x, box.y, box.x + box.w, C.line);
      const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
      const r = hull(ship, cx, cy, box.w * 0.84, box.h * 0.62, { view, holo: view === 'orbit' });
      // the bottom row of the box belongs to the scale bar and the view caption, in every view
      const lblBox = { x: box.x, y: box.y, w: box.w, h: box.h - px(30) };
      const parts = callouts(ship, cx, cy, r.L, r.view, lblBox, 14);
      // scale bar from the hull length
      const mPer = (cls.length || ship.length) / r.L; let bar = 10; while ((bar * 2) / mPer < 60) bar *= 2; if (bar > (cls.length || 1)) bar = cls.length || bar;
      const bw = bar / mPer, bx = box.x + 8, by = box.y + box.h - 14;
      ctx.strokeStyle = 'rgba(224,232,240,0.7)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(bx, by + 0.5); ctx.lineTo(bx + bw, by + 0.5); ctx.moveTo(bx + 0.5, by - 4); ctx.lineTo(bx + 0.5, by + 4); ctx.moveTo(bx + bw + 0.5, by - 4); ctx.lineTo(bx + bw + 0.5, by + 4); ctx.stroke();
      text(bar + ' m', bx, by - 8, F.m(px(11)), 'rgba(224,232,240,0.8)');
      text(up(view === 'orbit' ? 'orbit view' : view + ' · nose right'), box.x + box.w - 8, box.y + box.h - 8, F.m(px(10.5)), C.dim, 'right', '0.06em');
      y = box.y + box.h;
      if (parts.length && B.phone) y = paragraph(parts.map((p) => p.label + (p.text ? ': ' + p.text : '')).join('  ·  '), PX, y + px(4), PW, { size: 12, color: C.dim });
    }
    endFlow(y);
    if (rail) rail.draw();
  };

  SCREENS.skirmish = function (m) {
    const PX = FR.x + (B.phone ? 12 : 56), PW = Math.min(FR.w - 2 * (PX - FR.x), 1040);
    scrim('wide'); frame(); header('Skirmish');
    const st = m.state;
    const rail = reserveRail(m.keys, PX, PW);
    let y = beginFlow() + px(16);
    y = eyebrow(PX, y + px(8), 'Skirmish');
    y = title([m.title || 'Set the board'], PX - 1, y - px(4), B.phone ? px(32) : px(40), C.ink) + px(2);
    y = paragraph(m.sub || '', PX, y, Math.min(PW, 760), { size: B.phone ? 13 : 14, color: C.ink2 }) + px(4);
    const enemy = st.player === 'JC' ? 'ISA' : 'JC';
    const s1 = seg(PX, y, { id: 'sk:side', label: 'Your side', options: m.sides, value: st.player, set: (v) => { st.player = v; }, clip: [CT, CB] });
    y += s1.h + px(12);
    const envIdx = Math.max(0, m.envs.findIndex((e) => e.id === st.env));
    const rangeIdx = m.ranges.reduce((best, r, i) => Math.abs(r - st.range) < Math.abs(m.ranges[best] - st.range) ? i : best, 0);
    const optW = B.phone ? PW : Math.min(PW, 520);
    y = stepper(PX, y, optW, { id: 'sk:env', label: 'Where', valueW: px(170), value: m.envs[envIdx].label, dec: () => { st.env = m.envs[(envIdx + m.envs.length - 1) % m.envs.length].id; }, inc: () => { st.env = m.envs[(envIdx + 1) % m.envs.length].id; }, big: true, clip: [CT, CB] });
    y = stepper(PX, y, optW, { id: 'sk:range', label: 'Opening range', valueW: px(170), value: U.fmt.dist(st.range * 1000), dec: () => { st.range = m.ranges[Math.max(0, rangeIdx - 1)]; }, inc: () => { st.range = m.ranges[Math.min(m.ranges.length - 1, rangeIdx + 1)]; }, big: true, clip: [CT, CB] });
    y += px(16);
    const cols = B.phone ? 1 : 2, cw = (PW - (cols - 1) * 40) / cols;
    const sideCol = (x, yy, w, label, fac, counts) => {
      text(up(label), x, yy + px(12), F.d(px(12)), facColor(fac), 'left', '0.18em'); const lw = measure(up(label), F.d(px(12)), '0.18em'); hair(x + lw + 10, yy + px(8), x + w, C.line2); yy += px(22);
      for (const c of m.classes) {
        const n = counts[c.id] || 0;
        yy = stepper(x, yy, w, { id: 'sk:' + fac + ':' + c.id, label: c.name, sub: c.custom ? 'yard design' : '', value: String(n), zero: n === 0, dec: () => { counts[c.id] = Math.max(0, n - 1); }, inc: () => { counts[c.id] = Math.min(6, n + 1); }, clip: [CT, CB] });
      }
      const total = m.classes.reduce((a, c) => a + (counts[c.id] || 0), 0);
      text(total + (total === 1 ? ' ship' : ' ships'), x + w, yy + px(14), F.m(px(11)), total ? C.dim : C.warn, 'right'); return yy + px(22);
    };
    const yA = sideCol(PX, y, cw, 'Your ships · ' + (OD.Ships.FACTIONS[st.player] || {}).name, st.player, st.playerShips);
    const yB = sideCol(cols === 1 ? PX : PX + cw + 40, cols === 1 ? yA + px(8) : y, cw, 'Enemy ships · ' + (OD.Ships.FACTIONS[enemy] || {}).name, enemy, st.enemyShips);
    y = Math.max(yA, yB) + px(8);
    endFlow(y);
    if (rail) rail.draw();
  };

  SCREENS.pause = function (m) {
    const PW = Math.min(440, FR.w - 24), PX = Math.round((B.W - PW) / 2);
    scrim('pause'); frame(); header('Paused');
    let y = CT + Math.max(px(20), (CB - CT) * 0.18);
    y = eyebrow(PX, y + px(8), m.eyebrow || 'Paused');
    y = title([m.title || ''], PX - 1, y - px(4), B.phone ? px(30) : px(38), C.ink) + px(8);
    if (m.sub) y = paragraph(m.sub, PX, y, PW, { size: 13.5, color: C.dim });
    hair(PX, y, PX + PW, C.line2);
    m.entries.forEach((e, i) => { y = entry(PX, y, PW, { id: 'pause:' + i, n: i + 1, label: e.label, sub: e.sub, primary: e.primary, danger: e.danger, act: e.act }); });
    B.scrollMax = 0;
  };

  SCREENS.debrief = function (m) {
    const PX = FR.x + (B.phone ? 12 : 56), PW = B.phone ? FR.w - 24 : 640;
    m._panelRight = PX + PW; scrim('beside', PX + PW); frame(); header('Debrief');
    const rail = B.phone ? reserveRail(m.keys, PX, PW) : null;
    let y = beginFlow() + px(20);
    y = eyebrow(PX, y + px(8), m.eyebrow || 'Debrief', m.outcome === 'victory' ? C.accent : C.crit);
    y = title([m.title], PX - 1, y - px(4), B.phone ? px(36) : px(50), m.outcome === 'victory' ? C.accent : C.crit) + px(4);
    if (m.body) y = paragraph(m.body, PX, y, PW, { size: 14.5 });
    if (m.warLine) y = paragraph(m.warLine, PX, y + px(2), PW, { size: 14, color: m.outcome === 'victory' ? C.accent : C.ink2 });
    // where the war goes next, under the war line and in the same block
    if (m.next) y = paragraph(m.next, PX, y + px(2), PW, { size: 13.5, color: C.dim });
    if (m.why) y = paragraph(m.why, PX, y + px(2), PW, { size: 14, color: C.crit });
    if (m.objectives && m.objectives.length) {
      y = h3(PX, y + px(4), PW, 'Objectives');
      for (const o of m.objectives) {
        const col = o.state === 'failed' ? C.crit : o.state === 'done' ? C.accent : C.dim;
        const mark = o.state === 'failed' ? '✕' : o.state === 'done' ? '✓' : '·';
        text(mark, PX, y + px(13), F.m(px(13)), col, 'left');
        const lines = wrap(o.text + (o.state === 'open' ? ' (open)' : o.optional ? ' (optional)' : ''), F.s(px(13)), PW - px(24));
        for (const l of lines) { text(l, PX + px(20), y + px(13), F.s(px(13)), col); y += px(19); }
      }
      y += px(4);
    }
    hair(PX, y + px(4), PX + PW, C.line2); y += px(6);
    // Key left, value right. A stat whose key and value do not fit one column takes the whole row, and one
    // that does not fit even that puts its value on a second line, so the two never print over each other.
    const cols = B.phone ? 1 : 2, cw = (PW - (cols - 1) * 28) / cols;
    const kF = F.d(px(11)), vF = F.m(px(14));
    let col = 0, yy = y;
    (m.stats || []).forEach((s, i) => {
      const key = up(s.k);
      let v = s.v;
      if (s.n != null && typeof s.f === 'function' && !reduced) { const k = ease((B.t - B.openedAt - 0.25 - i * 0.12) / 1.1); v = s.f(s.n * k); if (k >= 1) v = s.v; }
      const kw = measure(key, kF, '0.16em'), vw = Math.max(measure(v, vF), measure(s.v, vF));
      const wide = kw + vw + px(16) > cw;
      if (wide && col > 0) { col = 0; yy += px(34); }
      const w = wide ? PW : cw, x = PX + col * (cw + 28);
      text(key, x, yy + px(20), kF, C.dim, 'left', '0.16em');
      const stacked = kw + vw + px(16) > w;
      if (stacked) { text(v, x, yy + px(38), vF, C.ink, 'left'); hair(x, yy + px(46), x + w, C.line); yy += px(52); col = 0; }
      else {
        text(v, x + w, yy + px(20), vF, C.ink, 'right'); hair(x, yy + px(28), x + w, C.line);
        if (wide) { yy += px(34); col = 0; }
        else { col++; if (col >= cols) { col = 0; yy += px(34); } }
      }
    });
    y = (col > 0 ? yy + px(34) : yy) + px(10);
    if (m.reports && m.reports.length) {
      y = h3(PX, y, PW, 'Damage report');
      for (const r of m.reports) {
        text(r.name, PX, y + px(13), F.d(px(14)), r.lost ? C.crit : C.ink, 'left', '0.04em');
        const nw = measure(r.name, F.d(px(14)), '0.04em');
        const lines = wrap(r.text, F.s(px(12.5)), PW - nw - px(14));
        text(lines[0] || '', PX + nw + px(12), y + px(13), F.s(px(12.5)), r.lost ? C.crit : r.hurt ? C.warn : C.dim);
        y += px(20);
        for (const l of lines.slice(1)) { text(l, PX + nw + px(12), y + px(13), F.s(px(12.5)), r.hurt ? C.warn : C.dim); y += px(18); }
      }
      y += px(6);
    }
    y += px(8);
    if (!rail) y = modelKeys(PX, y, PW, m.keys, [CT, CB]);
    endFlow(y);
    if (rail) rail.draw();
  };

  // ---------------------------------------------------------------- draw
  function layout(cam) {
    B.W = cam.w; B.H = cam.h; B.phone = B.W < 700;
    B.S = OD.UI && OD.UI.textSize === 'large' ? 1.15 : 1;
    KEY_H = B.phone ? 44 : px(38); EH = B.phone ? px(56) : px(58);
    const M = B.phone ? 8 : 20;
    FR = { x: M, y: M, w: B.W - 2 * M, h: B.H - 2 * M };
    CT = FR.y + (B.phone ? 62 : 50); CB = FR.y + FR.h - (B.phone ? 10 : 16);
  }
  function draw(c, cam, dt, t) {
    if (!B.active || !B.model) return;
    ctx = c; B.t = t != null ? t : performance.now() / 1000;
    if (!reduced) B.az = (B.az + (dt || 0) * 8) % 360;
    layout(cam);
    B.prevHits = B.hits; B.hits = []; B.uid = 0;
    ctx.save();
    ctx.textBaseline = 'alphabetic';
    const fn = SCREENS[B.current];
    try { if (fn) fn(B.model); } catch (e) { OD.errors && OD.errors.push('bridge draw: ' + (e && e.stack || e)); }
    sweep();
    ctx.restore();
    // keep the focus on something that still exists
    if (B.focusId && !B.hits.some((r) => r.id === B.focusId && r.focusable)) B.focusId = null;
    if (B.hover && !B.hits.some((r) => r.id === B.hover)) B.hover = null;
    if (B.canvas) B.canvas.style.cursor = B.hover && B.hits.some((r) => r.id === B.hover && !r.disabled) ? 'pointer' : 'default';
    mirror();
  }

  // ---------------------------------------------------------------- pointer and keys
  function pointer(type, x, y, e) {
    if (!B.active) return false;
    if (type === 'wheel') { if (B.scrollMax > 0) B.scroll = clamp(B.scroll + (e && e.deltaY ? e.deltaY : 0), 0, B.scrollMax); return true; }
    if (type === 'leave') { B.hover = null; B.down = null; return true; }
    const r = hitAt(x, y);
    if (type === 'move') {
      if (B.down) {
        if (!B.dragging && Math.abs(y - B.down.y) > 8 && B.scrollMax > 0) B.dragging = true;
        if (B.dragging) { B.scroll = clamp(B.down.scroll - (y - B.down.y), 0, B.scrollMax); return true; }
      }
      B.hover = r ? r.id : null;
      if (r && r.focusable) { B.focusId = r.id; B.focusByKey = false; } // hover focus: Enter still means the screen's Enter key
      return true;
    }
    if (type === 'down') { B.down = { x, y, id: r ? r.id : null, scroll: B.scroll }; B.dragging = false; B.hover = r ? r.id : null; return true; }
    if (type === 'up') {
      const d = B.down; B.down = null;
      if (!d || B.dragging) { B.dragging = false; return true; }
      if (r && d.id === r.id) { if (r.focusable) B.focusId = r.id; activate(r, 'pointer'); }
      return true;
    }
    return true;
  }
  function focusables() { return B.hits.filter((r) => r.focusable && !r.disabled); }
  function moveFocus(dir) {
    const list = focusables(); if (!list.length) return;
    let i = list.findIndex((r) => r.id === B.focusId);
    if (i < 0) i = dir > 0 ? -1 : 0;
    i = (i + dir + list.length) % list.length;
    B.focusId = list[i].id; B.focusByKey = true; B.hover = null; play('tick');
    // keep a focused row in view
    const r = list[i]; if (r.clip) { if (r.y < CT) B.scroll = Math.max(0, B.scroll - (CT - r.y) - 20); else if (r.y + r.h > CB) B.scroll = clamp(B.scroll + (r.y + r.h - CB) + 20, 0, B.scrollMax); }
  }
  function onKey(e) {
    if (!B.active) return false;
    const inMirror = e.target && e.target.closest && e.target.closest('#bridgeA11y');
    const k = e.key;
    if (k === 'Escape') { const r = B.hits.find((x) => x.esc); if (r) return activate(r, 'key'); if (B.model && B.model.onBack) { play('back'); B.model.onBack(); return true; } return true; }
    if (/^[1-9]$/.test(k)) { const list = B.hits.filter((r) => r.numbered); const r = list[+k - 1]; if (r && !r.disabled) { B.focusId = r.id; B.focusByKey = true; return activate(r, 'key'); } return true; }
    if (k === 'ArrowDown') { moveFocus(1); return true; }
    if (k === 'ArrowUp') { moveFocus(-1); return true; }
    if (k === 'ArrowLeft' || k === 'ArrowRight') {
      const r = B.hits.find((x) => x.id === B.focusId);
      if (r && r.kind === 'step') { (k === 'ArrowLeft' ? r.left : r.right)(); return true; }
      if (r && r.kind === 'seg') { const grp = B.hits.filter((x) => x.kind === 'seg' && x.group === r.group); const i = grp.findIndex((x) => x.id === r.id); const n = grp[(i + (k === 'ArrowLeft' ? -1 : 1) + grp.length) % grp.length]; if (n) { B.focusId = n.id; activate(n, 'key'); } return true; }
      moveFocus(k === 'ArrowLeft' ? -1 : 1); return true;
    }
    if (k === 'Enter' || k === ' ') {
      if (inMirror) return false; // the browser clicks the focused mirror button
      // a focused key or entry takes Enter; a stepper or segment only when the keyboard put the focus there,
      // so a cursor resting on a hull row does not turn Launch into "add a ship"
      const f = B.hits.find((x) => x.id === B.focusId);
      const r = (f && (B.focusByKey || f.kind === 'key' || f.kind === 'entry')) ? f : (B.hits.find((x) => x.enter && !x.disabled) || B.hits.find((x) => x.primary && !x.disabled) || f);
      if (r) return activate(r, 'key');
      return true;
    }
    if (k === '+' || k === '=' || k === '-' || k === '_') { const r = B.hits.find((x) => x.id === B.focusId); if (r && r.kind === 'step') { (k === '-' || k === '_' ? r.left : r.right)(); return true; } }
    // letter hotkeys on keys (Inspect, Refit …)
    if (k.length === 1) { const r = B.hits.find((x) => x.hot && x.hot.toLowerCase() === k.toLowerCase() && !x.disabled); if (r) return activate(r, 'key'); }
    return false;
  }

  // ---------------------------------------------------------------- the DOM mirror
  function mirrorRoot() {
    if (B.mirrorRoot && B.mirrorRoot.isConnected) return B.mirrorRoot;
    let el = document.getElementById('bridgeA11y');
    if (!el) { el = document.createElement('div'); el.id = 'bridgeA11y'; el.style.cssText = 'position:absolute;left:0;top:0;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;'; (document.getElementById('app') || document.body).appendChild(el); }
    B.mirrorRoot = el; return el;
  }
  function mirror() {
    const root = mirrorRoot();
    const list = B.hits.filter((r) => r.mirror && typeof r.act === 'function');
    const sig = B.current + '|' + list.map((r) => r.id + ':' + (r.aria || r.label || '') + (r.disabled ? '!' : '')).join('|');
    if (sig === B.mirrorSig) return;
    B.mirrorSig = sig;
    const focused = document.activeElement && root.contains(document.activeElement) ? document.activeElement.dataset.bid : null;
    const grp = document.createElement('div');
    grp.id = B.current === 'menu' ? 'menu' : 'bridge-' + B.current;
    grp.setAttribute('role', 'group'); grp.setAttribute('aria-label', 'Bridge console: ' + B.current);
    for (const r of list) {
      const b = document.createElement('button'); b.type = 'button'; b.dataset.bid = r.id; b.textContent = r.aria || ((r.n != null ? r.n + '. ' : '') + (r.label || '') + (r.sub ? ' — ' + r.sub : '')); if (r.disabled) b.disabled = true;
      b.addEventListener('click', () => { const cur = B.hits.find((x) => x.id === r.id); if (cur) { B.focusId = cur.id; B.focusByKey = true; activate(cur, 'mirror'); } });
      b.addEventListener('focus', () => { B.focusId = r.id; B.focusByKey = true; });
      grp.appendChild(b);
    }
    root.innerHTML = ''; root.appendChild(grp);
    if (focused) { const b = root.querySelector('[data-bid="' + focused + '"]'); if (b) b.focus(); }
  }

  // ---------------------------------------------------------------- open / close
  function open(name, model) {
    if (!SCREENS[name]) throw new Error('Unknown bridge screen ' + name);
    const wasPress = B.t - B.pressT < 0.3;
    B.current = name; B.model = model || {}; B.active = true;
    B.openedAt = performance.now() / 1000; B.t = B.openedAt;
    B.scroll = 0; B.scrollMax = 0; B.focusId = null; B.focusByKey = false; B.hover = null; B.hits = []; B.prevHits = []; B.mirrorSig = '';
    B.canvas = document.getElementById('view');
    if (!wasPress) play('open');
    // the mirror root exists at once (its buttons fill in on the first draw)
    const root = mirrorRoot(); root.innerHTML = ''; const grp = document.createElement('div'); grp.id = name === 'menu' ? 'menu' : 'bridge-' + name; grp.setAttribute('role', 'group'); root.appendChild(grp);
    try { if (OD.UI && OD.UI.showHud) OD.UI.showHud(false); } catch (e) { /* no HUD yet */ }
    return B.model;
  }
  function close() {
    B.active = false; B.current = null; B.model = null; B.hits = []; B.prevHits = []; B.hover = null; B.focusId = null; B.down = null; B.mirrorSig = '';
    const root = document.getElementById('bridgeA11y'); if (root) root.innerHTML = '';
    if (B.canvas) B.canvas.style.cursor = '';
  }
  function resize() { wrapCache.clear(); }

  OD.Bridge = {
    open, close, draw, pointer, key: onKey, resize, sceneRect,
    get active() { return B.active; }, get current() { return B.current; }, get model() { return B.model; },
    invalidate() { B.mirrorSig = ''; },
    state: B, screens: SCREENS,
  };
})();
