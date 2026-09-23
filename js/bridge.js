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
  // A touch screen has no keyboard to hint at: on a coarse pointer the keys drop their Esc, ⏎ and letter boxes.
  let coarse = false;
  try { const mq = window.matchMedia && window.matchMedia('(pointer: coarse)'); if (mq) { coarse = !!mq.matches; if (mq.addEventListener) mq.addEventListener('change', (e) => { coarse = !!e.matches; }); } } catch (e) { coarse = false; }
  const kbdOf = (k) => (coarse || !k || !k.kbd ? '' : k.kbd);

  let ctx = null;
  // console state
  const B = {
    active: false, current: null, model: null,
    hits: [], prevHits: [], focusId: null, focusByKey: false, hover: null, pressedId: null, pressT: -1, down: null, dragging: false,
    scroll: 0, scrollMax: 0, openedAt: 0, t: 0, bootT: performance.now() / 1000, W: 0, H: 0, phone: false, S: 1,
    az: 35, mirrorSig: '', mirrorRoot: null, canvas: null, uid: 0, hullTick: 0, heroBottom: 0,
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
      // ordinary spaces only: a no-break space ("9\u00a0July\u00a02211") keeps its words on one line
      for (const w of para.split(/[ \t\r]+/)) { const test = line ? line + ' ' + w : w; if (line && ctx.measureText(test).width > maxW) { lines.push(line); line = w; } else line = test; }
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
  // Key left, value right. A value too wide to share the row with its key goes under the key, right-aligned and
  // split at its ' · ' breaks (then at spaces), so the two never print over each other.
  function kv(x, y, w, k, v, color) {
    const kf = F.s(px(13)), vf = F.m(px(12.5));
    text(k, x, y + px(14), kf, C.dim);
    if (measure(k, kf) + px(14) + measure(v, vf) <= w) { text(v, x + w, y + px(14), vf, color || C.ink, 'right'); hair(x, y + px(22), x + w); return y + px(26); }
    let yy = y + px(14);
    for (const line of splitValue(v, vf, w)) { yy += px(17); text(line, x + w, yy, vf, color || C.ink, 'right'); }
    hair(x, yy + px(8), x + w); return yy + px(12);
  }
  function splitValue(v, f, w) {
    const lines = []; let line = '';
    for (const part of String(v).split(' · ')) {
      const test = line ? line + ' · ' + part : part;
      if (measure(test, f) <= w) { line = test; continue; }
      if (line) lines.push(line);
      const words = wrap(part, f, w);
      for (let i = 0; i < words.length - 1; i++) lines.push(words[i]);
      line = words[words.length - 1] || '';
    }
    if (line) lines.push(line);
    return lines;
  }

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
  // a key's width: its label, its keyboard box when it shows one, and the padding
  function keyW(k) { const kb = kbdOf(k); return Math.ceil(measure(up(k.label), F.d(px(12.5)), '0.1em') + (kb ? measure(kb, F.m(px(9.5))) + px(14) : 0) + px(30)); }
  function key(x, y, o) {
    const f = F.d(px(12.5)), lab = up(o.label);
    const lw = measure(lab, f, '0.1em');
    const kbd = kbdOf(o), kf = F.m(px(9.5)), kw = kbd ? measure(kbd, kf) + px(14) : 0;
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
    if (kbd) {
      const kx = tx + lw + px(10), kh = px(13), ky = y + h / 2 - kh / 2;
      ctx.strokeStyle = pressed ? 'rgba(4,20,26,0.5)' : C.line2; ctx.lineWidth = 1; ctx.strokeRect(Math.round(kx) + 0.5, Math.round(ky) + 0.5, Math.round(kw - px(6)), kh);
      text(kbd, kx + (kw - px(6)) / 2, ky + kh - px(3), kf, pressed ? C.ground : C.dim, 'center');
    }
    if (o.disabled) ctx.globalAlpha /= 0.45;
    return w;
  }
  // a row of keys, wrapping when the row is too narrow; returns the y after the last row
  function keyRow(x, y, w, keys, o) {
    let cx = x, ry = y; const gap = px(8), h = (o && o.h) || KEY_H;
    for (const k of keys) {
      if (!k) continue;
      const kw = keyW(k);
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
  // With o.maxW, a control wider than that puts its label on a line of its own and wraps its options under it
  // ("Inner Systems Authority" ran off a phone's frame).
  function seg(x, y, o) {
    const lf = F.d(px(11)); const lab = up(o.label);
    const h = o.h || (B.phone ? 44 : 30), f = F.s(px(12.5), 500);
    const lw = measure(lab, lf, '0.18em') + px(14);
    const widths = o.options.map((opt) => measure(opt.label, f) + px(20));
    const stack = !!o.maxW && lw + widths.reduce((a, b) => a + b + 2, 0) > o.maxW;
    text(lab, x, y + (stack ? px(11) : px(19)), lf, C.dim, 'left', '0.18em');
    let cx = stack ? x : x + lw, cy = stack ? y + px(16) : y, right = cx;
    o.options.forEach((opt, i) => {
      const w = widths[i], active = o.value === opt.id;
      if (stack && cx > x && cx + w > x + o.maxW) { cx = x; cy += h + 2; }
      const r = region({ x: cx, y: cy, w, h, kind: 'seg', id: o.id + ':' + opt.id, label: o.label + ' ' + opt.label, act: () => o.set(opt.id), clip: o.clip, group: o.id, value: opt.id });
      const hot = isHot(r), pressed = isPressed(r);
      if (pressed) { ctx.fillStyle = C.accentA(0.22); ctx.fillRect(cx, cy, w, h); }
      else if (hot) { ctx.fillStyle = C.accentA(0.07); ctx.fillRect(cx, cy, w, h); }
      ctx.fillStyle = active ? C.accent : hot ? C.line2 : C.line; ctx.fillRect(cx, cy + h - 2, w, 2);
      text(opt.label, cx + w / 2, cy + h / 2 + px(4.5), f, active ? C.accent : hot ? C.ink : C.dim, 'center');
      cx += w + 2; right = Math.max(right, cx);
    });
    return { w: right - x, h: cy + h - y };
  }
  // a stepper row: LABEL   [−]  value  [+]
  function stepper(x, y, w, o) {
    const h = o.h || (B.phone ? 46 : 40), bw = B.phone ? 44 : 34;
    const row = region({ x, y, w, h, kind: 'step', id: o.id, label: o.label + ' ' + o.value, mirror: false, act: () => { o.inc(); play('tick'); }, left: () => { o.dec(); play('tick'); }, right: () => { o.inc(); play('tick'); }, clip: o.clip });
    const hot = isHot(row);
    if (hot) { ctx.fillStyle = C.accentA(0.05); ctx.fillRect(x, y, w, h); ctx.fillStyle = C.accent; ctx.fillRect(x, y + 8, 2, h - 16); }
    hair(x, y + h, x + w, C.line);
    const lf = o.big ? F.d(px(14)) : F.s(px(13.5), 500), ls = o.big ? '0.06em' : '0px';
    const vw = o.valueW || px(58);
    // The label keeps clear of the − key: a label too long for the room takes its short form
    // ("Lancer-class carrier"), and one still too long ends in an ellipsis.
    const room = w - bw * 2 - vw - px(16) - px(12) - px(8);
    let label = o.label;
    if (measure(label, lf, ls) > room && o.short) label = o.short;
    while (label.length > 4 && measure(label, lf, ls) > room) label = label.slice(0, -2).trim() + '…';
    text(label, x + px(12), y + h / 2 + px(5), lf, o.color || (hot ? C.ink : C.ink2), 'left', ls);
    const labW = measure(label, lf, ls), sf = F.m(px(10.5));
    if (o.sub && labW + px(10) + measure(o.sub, sf) <= room) text(o.sub, x + px(12) + labW + px(10), y + h / 2 + px(5), sf, C.dim);
    const vx = x + w - bw - px(8) - vw / 2;
    // the value shrinks to its column ("Jupiter high orbit" on a phone)
    let vs = 14; while (vs > 10.5 && measure(o.value, F.m(px(vs), 500)) > vw - px(6)) vs -= 0.5;
    text(o.value, vx, y + h / 2 + px(5), F.m(px(vs), 500), o.zero ? C.dim : C.ink, 'center');
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
          let mb = 0, mt = 0;
          for (const v of views) { const r = OD.ShipArt.bounds(id, { size: 100, view: v, quality: 'low' }); if (r && r.w) { mw = Math.max(mw, r.w); mh = Math.max(mh, r.h); mb = Math.max(mb, r.h - (r.oy == null ? r.h / 2 : r.oy)); mt = Math.max(mt, r.oy == null ? r.h / 2 : r.oy); } }
          if (mw) b = { w: mw / 100, h: mh / 100, bottom: mb / 100, top: mt / 100 };
        } catch (e) { /* the silhouette fallback fits by length */ }
      }
      hullCache.fit.set(k, b);
    }
    const L = Math.min(bw / b.w, bh / b.h);
    return { L, bottom: (b.bottom == null ? b.h / 2 : b.bottom) * L, top: (b.top == null ? b.h / 2 : b.top) * L };
  }
  // A hull picture with part labels in lanes above and below it: the lanes sit against the space the hull
  // can fill at any angle of its turn (not against the edges of the box), and the three are centred in the
  // box together. Returns the part labels drawn.
  function labelledHull(ship, box, o) {
    const rows = o.rows || 3, lane = rows * px(15) + px(12), fill = o.fill || 0.94;
    const orbit = !o.view || o.view === 'orbit';
    const fit = fitHull(ship, orbit ? { az: 0, el: 20 } : (VIEWS[o.view] || o.view), box.w * (o.wide || 0.96), Math.max(40, box.h - 2 * lane));
    const top = fit.top * fill, bot = fit.bottom * fill + px(6);
    const groupH = 2 * lane + top + bot;
    const cx = box.x + box.w / 2, cy = box.y + Math.max(0, (box.h - groupH) / 2) + lane + top;
    const r = hull(ship, cx, cy, box.w * (o.wide || 0.96), Math.max(40, box.h - 2 * lane), { view: o.view, holo: o.holo, fill });
    const lanes = { x: box.x, y: cy - top - lane, w: box.w, h: groupH };
    return laneCallouts(ship, cx, cy, r.L, r.view, lanes, { rows, max: o.max, lane });
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
    B.hullL = L;
    return { L, view };
  }
  // Part labels in lanes above and below the picture, `rows` deep on each side, row 0 nearest the hull. A
  // leader runs from its part to the lane's edge (straight up or down, or slanting when the label has had to
  // slide sideways), then straight to its label. Each label takes the cheapest free place: near its part, in
  // the lane on its own side, in a low row, reading outward. A place is free when the label covers no other
  // label or leader, and its leader crosses no other leader and runs through no label, so no two leaders ever
  // cross. Outer parts are placed first; each label tries its last frame's place first, so a turning hull
  // does not shuffle them.
  const calloutMemo = new Map();
  let calloutTries = null;
  // do two segments cross (touching ends do not count)?
  function segCross(ax1, ay1, ax2, ay2, bx1, by1, bx2, by2) {
    const d1 = (bx2 - bx1) * (ay1 - by1) - (by2 - by1) * (ax1 - bx1), d2 = (bx2 - bx1) * (ay2 - by1) - (by2 - by1) * (ax2 - bx1);
    if (!((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0))) return false;
    const d3 = (ax2 - ax1) * (by1 - ay1) - (ay2 - ay1) * (bx1 - ax1), d4 = (ax2 - ax1) * (by2 - ay1) - (ay2 - ay1) * (bx2 - ax1);
    return (d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0);
  }
  // does a segment touch a box (x0, y0, x1, y1)? A clip of the segment against the four sides.
  function segBox(x1, y1, x2, y2, bx0, by0, bx1, by1) {
    if (Math.max(x1, x2) < bx0 || Math.min(x1, x2) > bx1 || Math.max(y1, y2) < by0 || Math.min(y1, y2) > by1) return false;
    let t0 = 0, t1 = 1;
    const dx = x2 - x1, dy = y2 - y1, P = [-dx, dx, -dy, dy], Q = [x1 - bx0, bx1 - x1, y1 - by0, by1 - y1];
    for (let i = 0; i < 4; i++) {
      if (P[i] === 0) { if (Q[i] < 0) return false; continue; }
      const r = Q[i] / P[i];
      if (P[i] < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; }
    }
    return t0 <= t1;
  }
  // two vertical stretches closer than 5 px that share more than 3 px of height
  function vClash(x, ya, yb, x2, yc, yd) { return Math.abs(x - x2) < 5 && Math.min(Math.max(ya, yb), Math.max(yc, yd)) - Math.max(Math.min(ya, yb), Math.min(yc, yd)) > 3; }
  function laneCallouts(ship, cx, cy, L, view, box, o) {
    if (!artOk(ship) || typeof OD.ShipArt.callouts !== 'function') return [];
    const T0 = performance.now();
    let parts;
    try { parts = OD.ShipArt.callouts(artId(ship), OD.Render.artOpts(ship, null, { size: L, view, rotation: 0 })) || []; } catch (e) { return []; }
    const f = F.m(px(10.5)), rows = o.rows || 3, STEP = px(15), gap = px(6), lane = o.lane || rows * STEP + px(12);
    const rowY = (ln, r) => ln === 'up' ? box.y + px(11) + (rows - 1 - r) * STEP : box.y + box.h - px(4) - (rows - 1 - r) * STEP;
    // where a leader leaves the picture for its lane
    const edgeUp = box.y + lane - px(6), edgeDown = box.y + box.h - lane + px(6);
    const items = parts.slice(0, o.max || 12).map((p) => ({ label: p.label, text: p.text, px: cx + p.x, py: cy + p.y, w: measure(p.label, f) + px(7) }));
    items.sort((a, b) => Math.abs(b.px - cx) - Math.abs(a.px - cx));
    const memoKey = (ship.id || ship.name || '') + '|' + (typeof artId(ship) === 'object' ? 'design' : artId(ship)) + '|' + (typeof view === 'object' ? 'orbit' : view) + '|' + rows;
    let memo = calloutMemo.get(memoKey);
    if (!memo) { if (calloutMemo.size > 40) calloutMemo.clear(); memo = new Map(); calloutMemo.set(memoKey, memo); }
    // every place a label may take, cheapest first: sideways slide, then row, then the far lane, then reading inward
    if (!calloutTries || calloutTries.rows !== rows) {
      const list = [];
      for (const off of [0, 8, -8, 16, -16, 24, -24, 34, -34, 46, -46, 60, -60, 80, -80, 105, -105, 135, -135])
        for (let row = 0; row < rows; row++) for (const far of [0, 1]) for (const inward of [0, 1])
          list.push({ off, row, far, inward, cost: Math.abs(off) + row * 14 + far * 45 + inward * 8 });
      list.sort((p, q) => p.cost - q.cost);
      calloutTries = { rows, list };
    }
    const placed = [];
    // a place for a label: its text box, and its leader as two segments (part → lane edge → label)
    const fits = (it, ln, row, dir, off) => {
      const ax = Math.round(it.px + off), ty = rowY(ln, row), up = ln === 'up';
      const x0 = dir > 0 ? ax - 1 : ax - it.w + 1, x1 = x0 + it.w, y0 = ty - px(10), y1 = ty + px(4);
      if (x0 < box.x + 2 || x1 > box.x + box.w - 2) return null;
      const edge = up ? edgeUp : edgeDown, past = up ? it.py <= edge : it.py >= edge;
      const by = past ? it.py : edge, ey = up ? y1 : ty - px(11);   // a part already past the lane's edge runs straight up
      for (const q of placed) {                                                                      // text on text
        if (x0 < q.x1 + gap && x1 > q.x0 - gap && y0 < q.y1 && y1 > q.y0) return null;
      }
      const v1 = Math.abs(ax - it.px) < 1;   // the first stretch is straight up or down too
      for (const q of placed) {
        // two leaders running together along one vertical
        if (vClash(ax, by, ey, q.ax, q.by, q.ey) || (v1 && vClash(ax, it.py, by, q.ax, q.by, q.ey)) || (q.v1 && vClash(ax, by, ey, q.ax, q.py, q.by)) || (v1 && q.v1 && vClash(ax, it.py, by, q.ax, q.py, q.by))) return null;
        if (segBox(q.px, q.py, q.ax, q.by, x0 - 2, y0 - 2, x1 + 2, y1 + 2) || segBox(q.ax, q.by, q.ax, q.ey, x0 - 2, y0 - 2, x1 + 2, y1 + 2)) return null;   // this text on a leader
        if (segBox(it.px, it.py, ax, by, q.x0 - 2, q.y0 - 2, q.x1 + 2, q.y1 + 2) || segBox(ax, by, ax, ey, q.x0 - 2, q.y0 - 2, q.x1 + 2, q.y1 + 2)) return null;   // this leader through a label
        if (segCross(it.px, it.py, ax, by, q.px, q.py, q.ax, q.by) || segCross(it.px, it.py, ax, by, q.ax, q.by, q.ax, q.ey)
          || segCross(ax, by, ax, ey, q.px, q.py, q.ax, q.by) || segCross(ax, by, ax, ey, q.ax, q.by, q.ax, q.ey)) return null;   // leaders crossing
      }
      return { ln, row, dir, off, ax, by, ey, ty, x0, x1, y0, y1, v1 };
    };
    const run = (order, useMemo) => {
      placed.length = 0;
      const out = [], dropped = [];
      for (const it of order) {
        const pref = it.py < cy - 2 ? 'up' : it.py > cy + 2 ? 'down' : (placed.filter((q) => q.ln === 'up').length <= placed.filter((q) => q.ln === 'down').length ? 'up' : 'down');
        const other = pref === 'up' ? 'down' : 'up', dirOut = it.px >= cx ? 1 : -1;
        let got = null;
        const last = useMemo && memo.get(it.label);
        if (last && (last.ln === pref || Math.abs(it.py - cy) < px(14))) got = fits(it, last.ln, last.row, last.dir, last.off);
        for (let i = 0; !got && i < calloutTries.list.length; i++) { const t = calloutTries.list[i]; got = fits(it, t.far ? other : pref, t.row, t.inward ? -dirOut : dirOut, t.off); }
        if (!got) { dropped.push(it.label); continue; } // no free place in this order
        const q = Object.assign({}, it, got); placed.push(q); out.push(q);
      }
      return { out, dropped };
    };
    // outer parts first, keeping last frame's places; when that leaves a label out, other orders get a try
    // (within a few milliseconds) and the one that leaves out fewest wins
    const orders = [items, items.slice().reverse(), items.slice().sort((a, b) => a.px - b.px), items.slice().sort((a, b) => Math.abs(a.py - cy) - Math.abs(b.py - cy))];
    const first = memo.order || 0;
    let best = run(orders[first], true); best.order = first;
    for (let k = 0; k < orders.length && best.dropped.length && performance.now() - T0 < 6; k++) {
      const r = run(orders[k], k === first ? false : true); r.order = k;
      if (r.dropped.length < best.dropped.length) best = r;
    }
    memo.order = best.order;
    placed.length = 0; placed.push(...best.out);
    for (const q of placed) memo.set(q.label, { ln: q.ln, row: q.row, dir: q.dir, off: q.off });
    ctx.strokeStyle = C.accentA(0.55); ctx.lineWidth = 1; ctx.beginPath();
    for (const q of placed) { ctx.moveTo(q.px, q.py); ctx.lineTo(q.ax + 0.5, q.by); ctx.lineTo(q.ax + 0.5, q.ey); }
    ctx.stroke();
    for (const q of placed) {
      ctx.fillStyle = C.accent; ctx.beginPath(); ctx.arc(q.px, q.py, 2, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(4,7,12,0.74)'; ctx.fillRect(q.x0, q.y0, q.x1 - q.x0, q.y1 - q.y0);
      if (q.dir > 0) text(q.label, q.ax + px(3), q.ty, f, 'rgba(224,232,240,0.94)');
      else text(q.label, q.ax - px(3), q.ty, f, 'rgba(224,232,240,0.94)', 'right');
    }
    B.calloutStats = { parts: items.length, placed: placed.length, dropped: best.dropped, ms: performance.now() - T0 };
    return placed;
  }

  // ---------------------------------------------------------------- frame, header, effects
  let scanPattern = null;
  const scrimCache = { key: '', g: null, ctx: null };
  // `panelRight`: where the text column ends ('beside'); for 'pause', the text column's box
  function scrim(kind, panelRight) {
    let g;
    if (kind === 'pause') {
      // The paused map shows through a flat dim, and the menu's column sits on a darker pool, so a ship ring or
      // a target bracket never prints through the entries.
      ctx.fillStyle = 'rgba(4,7,12,0.72)'; ctx.fillRect(0, 0, B.W, B.H);
      const r = panelRight;
      if (r) softPanel(r.x, r.y, r.w, r.h, B.phone ? 64 : 110, 0.86);
      return;
    }
    if (kind === 'beside') {
      // The text column sits on a dark band that stays dark a little past its right edge and then thins out, so
      // the live scene reads clearly beside the text and never through it.
      const key = kind + '|' + B.W + '|' + Math.round(panelRight);
      if (scrimCache.key !== key || scrimCache.ctx !== ctx) {
        const at = (v) => clamp(v / B.W, 0, 1);
        g = ctx.createLinearGradient(0, 0, B.W, 0);
        g.addColorStop(0, 'rgba(4,7,12,0.95)'); g.addColorStop(at(panelRight + 24), 'rgba(4,7,12,0.92)');
        g.addColorStop(at(panelRight + 170), 'rgba(4,7,12,0.5)'); g.addColorStop(1, 'rgba(4,7,12,0.3)');
        scrimCache.key = key; scrimCache.g = g; scrimCache.ctx = ctx;
      }
      g = scrimCache.g;
    }
    else {
      // 'wide': the console over the whole frame. 'dark' (hangar, hull view, the chapters chart and the fleets
      // board): darker, so the stars barely show and the preview scene behind the console never crosses a hull
      // picture, the key numbers, the chart or the board.
      const key = kind + '|' + B.W + '|' + B.H;
      if (scrimCache.key !== key || scrimCache.ctx !== ctx) {
        const dark = kind === 'dark';
        g = ctx.createRadialGradient(B.W * 0.5, B.H * 0.4, B.H * 0.1, B.W * 0.5, B.H * 0.4, B.W * 0.75);
        g.addColorStop(0, dark ? 'rgba(4,7,12,0.97)' : 'rgba(4,7,12,0.84)'); g.addColorStop(1, dark ? 'rgba(4,7,12,0.99)' : 'rgba(4,7,12,0.95)');
        scrimCache.key = key; scrimCache.g = g; scrimCache.ctx = ctx;
      }
      g = scrimCache.g;
    }
    ctx.fillStyle = g; ctx.fillRect(0, 0, B.W, B.H);
  }
  // A soft dark pool behind a picture: one unit radial gradient, made once and stretched to the ellipse, so the
  // scene's ships and plots dim where they pass behind the hull and its caption.
  const poolCache = { g: null, ctx: null };
  function darkPool(cx, cy, rx, ry, alpha) {
    if (!poolCache.g || poolCache.ctx !== ctx) {
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      g.addColorStop(0, 'rgba(4,7,12,0.96)'); g.addColorStop(0.6, 'rgba(4,7,12,0.82)'); g.addColorStop(0.85, 'rgba(4,7,12,0.35)'); g.addColorStop(1, 'rgba(4,7,12,0)');
      poolCache.g = g; poolCache.ctx = ctx;
    }
    ctx.save(); ctx.translate(cx, cy); ctx.scale(Math.max(1, rx), Math.max(1, ry)); ctx.globalAlpha *= alpha == null ? 1 : alpha;
    ctx.fillStyle = poolCache.g; ctx.fillRect(-1, -1, 2, 2); ctx.restore();
  }
  // A dark box with soft edges: a small sprite made once (a square whose edges are blurred out), drawn in nine
  // pieces so the corners keep the same softness at any size. Half dark on the box's edge, fully dark a third of
  // `f` inside it, clear two thirds of `f` outside it.
  const softCache = { c: null };
  function softPanel(x, y, w, h, f, alpha) {
    let c = softCache.c;
    if (!c) {
      c = document.createElement('canvas'); c.width = c.height = 96;
      const g = c.getContext('2d');
      // only the blurred shadow lands on the sprite: the square itself is drawn off to the left
      g.shadowColor = 'rgba(4,7,12,1)'; g.shadowBlur = 16; g.shadowOffsetX = 200;
      g.fillStyle = 'rgba(4,7,12,1)'; g.fillRect(30 - 200, 30, 36, 36);
      softCache.c = c;
    }
    const D = Math.max(8, f), e = D * 30 / 48;   // a 48 px corner of the sprite drawn D wide; its half-dark line sits 30 px in
    const X0 = Math.round(x - e), Y0 = Math.round(y - e), X1 = Math.round(x + w + e), Y1 = Math.round(y + h + e);
    const d = Math.round(Math.min(D, (X1 - X0) / 2, (Y1 - Y0) / 2)), mw = X1 - X0 - 2 * d, mh = Y1 - Y0 - 2 * d;
    ctx.save(); ctx.globalAlpha *= alpha == null ? 1 : alpha;
    const cols = [[0, 48, X0, d], [47, 2, X0 + d, mw], [48, 48, X1 - d, d]], rows = [[0, 48, Y0, d], [47, 2, Y0 + d, mh], [48, 48, Y1 - d, d]];
    for (const [sy, sh, dy, dh] of rows) for (const [sx, sw, dx, dw] of cols) if (dw > 0 && dh > 0) ctx.drawImage(c, sx, sy, sw, sh, dx, dy, dw, dh);
    ctx.restore();
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
    let rows = 1, cx = x;
    for (const k of list) { const kw = keyW(k); if (cx > x && cx + kw > x + w) { rows++; cx = x; } cx += kw + px(8); }
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
    const beside = B.current === 'menu' || B.current === 'briefing' || B.current === 'debrief' || B.current === 'situation';
    const pr = m._panelRight || (beside ? FR.x + 56 + (B.current === 'menu' ? 520 : 640) : B.W * 0.5);
    // Beside a text column the scene keeps below the hero hull and its caption (measured on the last draw), so
    // the demo ships, their plots and contacts never run across the picture.
    const top = beside ? Math.min(CB - 120, B.heroBottom ? B.heroBottom + 16 : CT + (CB - CT) * 0.58) : CT;
    return { x: pr + 30, y: top, w: Math.max(80, B.W - pr - 30 - FR.x), h: CB - top };
  }
  // a rotating hull with a caption, in the clear region
  function sideHull(spec, captionLines, opts) {
    const ship = shipFor(spec); if (!ship) return;
    const o = opts || {};
    const m = B.model || {}, pr = m._panelRight || B.W * 0.5;
    // `fill`: the hull sits larger, for a screen whose text does not reach the bottom of the frame; it still
    // leaves the bottom fifth of the frame to the live scene
    const r = { x: pr + 30, y: CT, w: Math.max(80, B.W - pr - 30 - FR.x), h: (CB - CT) * (o.fill ? 0.94 : 0.6) };
    const bw = Math.min(r.w * (o.fill ? 0.84 : 0.72), o.fill ? 620 : 520), bh = Math.min(r.h * (o.fill ? 0.56 : 0.7), o.fill ? 400 : 340);
    const cx = r.x + r.w / 2, cy = r.y + r.h * (o.fill ? 0.43 : 0.5);
    const capH = captionLines.length * px(18) + px(14);
    // a soft dark backing under the hull and its caption, drawn before them
    darkPool(cx, cy + capH * 0.5, Math.min(r.w * 0.56, bw * 0.66 + 40), bh * 0.62 + capH * 0.7, 0.9);
    hull(ship, cx, cy, bw, bh, {});
    let y = cy + bh / 2 + px(12);
    for (let i = 0; i < captionLines.length; i++) { text(up(captionLines[i]), cx, y + px(14), i === 0 ? F.d(px(13)) : F.m(px(10.5)), i === 0 ? C.ink2 : C.dim, 'center', i === 0 ? '0.16em' : '0.08em'); y += px(18); }
    B.heroBottom = y + px(4);
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
    // the three formulas the game runs on; a phone has no line to spare for them under the settings
    if (!B.phone) {
      const foot = ['Δv = vₑ ln(m₀/m₁)', 'P = 2AεσT⁴', 'spot = 2.44 λR/D'], ff = F.m(px(11));
      let fx = PX;
      for (const f of foot) { const fw = measure(f, ff); if (fx > PX && fx + fw > PX + PW) { fx = PX; y += px(16); } text(f, fx, y + px(12), ff, C.dim); fx += fw + px(22); }
      y += px(16);
    }
    endFlow(y);
  };

  // ---------------------------------------------------------------- the Jovian system chart (chapters screen)
  // Jupiter's radius and the moons' mean orbit radii in km, all on one linear scale. The moons sit at fixed
  // angles picked so their labels clear each other: the chart says where each chapter is fought, not where
  // the moons were on its date.
  const JOVE_R = 69911;
  const MOONS = [
    { name: 'Amalthea', a: 181000, ang: 2.5, color: '#b0816a' },
    { name: 'Io', a: 421700, ang: 0.75 },
    { name: 'Europa', a: 671000, ang: -2.45 },
    { name: 'Ganymede', a: 1070000, ang: 2.05 },
    { name: 'Callisto', a: 1883000, ang: -0.62 },
  ];
  const BARE_ORBIT_ANG = -1.3;  // a chapter in open Jupiter orbit (a radius and no moon) is marked here
  // Where a chapter is fought, read from its location line: a moon it names, deep space outbound from a moon,
  // or an altitude above Jupiter ("High Jupiter orbit, altitude 400 000 km").
  function chapterPlace(ch) {
    const loc = String((ch && ch.location) || '');
    const moon = MOONS.find((mn) => new RegExp('\\b' + mn.name + '\\b').test(loc));
    // a number in the place is an altitude above the cloud tops, as the story and the map give it, so the key
    // goes at Jupiter's radius plus that ('altitude 181 000 km, outside Amalthea' sits just outside Amalthea's orbit)
    const k = /(\d[\d\s   ]*)\s*km/.exec(loc);
    if (k) { const a = JOVE_R + +k[1].replace(/\D/g, ''); return { key: 'r:' + a, kind: 'radius', a, moon: moon || null }; }
    if (/deep space/i.test(loc)) return moon ? { key: 'out:' + moon.name, kind: 'out', moon } : null;
    if (moon) return { key: moon.name, kind: 'moon', moon };
    return null;
  }
  // The chart: orbits and Jupiter to scale, the moons as dots, each chapter as a numbered key at its place.
  // The hovered or focused chapter is lit and named in the readout; with none, the next chapter to play.
  // Played chapters are green, locked ones dim. Keys and moon names are set one by one in the first free
  // spot around their point, so nothing prints over anything else. Returns the y under the chart.
  function jovianChart(m, x, y, w, h, clip) {
    const chs = m.chapters || [], story = (OD.Story && OD.Story.chapters) || [];
    const idOf = (v, p) => (v && v.startsWith(p) ? +v.slice(p.length) : -1);
    let lit = idOf(B.hover, 'chm:');
    if (lit < 0) lit = idOf(B.hover, 'ch:');
    if (lit < 0) lit = idOf(B.focusId, 'ch:');
    if (lit < 0 || !chs[lit]) lit = chs.findIndex((c) => !c.done && !c.locked);
    if (lit < 0) lit = chs.length - 1;
    const pad = px(16), wide = w >= 480, taken = [];
    const box = (x0, y0, x1, y1) => ({ x0, y0, x1, y1 });
    // readout: the lit chapter, in the top-left corner
    const c = chs[lit], sc = story[lit] || {};
    let ry = y + pad;
    if (c) {
      const state = c.locked ? 'locked' : c.done ? 'played' : 'to play';
      // no-break spaces hold a figure to its unit and a date together, so a narrow readout never ends a line
      // on "181" or "9 July"
      const where = String(sc.location || '').replace(/(\d) (?=\d|km\b)/g, '$1\u00a0') + (sc.date ? ' · ' + String(sc.date).replace(/ /g, '\u00a0') : '');
      const lines = wrap(where || c.sub || '', F.s(px(12.5)), w - 2 * pad).slice(0, 2);
      const tf = F.d(B.phone ? px(18) : px(21), 700), rw = Math.max(measure(up(c.title), tf, '0.05em'), ...lines.map((l) => measure(l, F.s(px(12.5)))));
      const rh = px(58) + lines.length * px(17);
      ctx.fillStyle = 'rgba(4,7,12,0.8)'; ctx.fillRect(x + pad - px(6), ry - px(4), rw + px(12), rh);
      text(up('Chapter ' + String(c.n).padStart(2, '0') + ' · ' + state), x + pad, ry + px(10), F.d(px(11)), c.done ? C.good : c.locked ? C.dim : C.accent, 'left', '0.2em');
      text(up(c.title), x + pad, ry + px(34), tf, C.ink, 'left', '0.05em');
      lines.forEach((l, i) => text(l, x + pad, ry + px(54) + i * px(17), F.s(px(12.5)), C.ink2));
      taken.push(box(x + pad - px(6), ry - px(4), x + pad + rw + px(6), ry + rh));
      ry += rh;
    }
    // legend: top right on a wide chart, under the readout on a narrow one. A locked chapter's key is dashed.
    const legend = [['played', C.good, false], ['to play', C.ink2, false], ['locked', C.dim, true]];
    const lf = F.d(px(10)), mk = px(9);
    const swatch = (sx, sy, col, dashed) => { ctx.save(); ctx.strokeStyle = col; ctx.lineWidth = 1; if (dashed) ctx.setLineDash([2, 2]); ctx.strokeRect(Math.round(sx) + 0.5, Math.round(sy) + 0.5, mk, mk); ctx.restore(); };
    if (wide) {
      let lw = 0;
      legend.forEach(([t, col, dashed], i) => { const ly = y + pad + px(6) + i * px(16), tw = measure(up(t), lf, '0.16em'); lw = Math.max(lw, tw); swatch(x + w - pad - tw - mk - px(8), ly - mk / 2, col, dashed); text(up(t), x + w - pad, ly + px(3.5), lf, col, 'right', '0.16em'); });
      taken.push(box(x + w - pad - lw - mk - px(10), y + pad - px(2), x + w - pad + 2, y + pad + px(52)));
    } else {
      let lx = x + pad;
      legend.forEach(([t, col, dashed]) => { const tw = measure(up(t), lf, '0.16em'); swatch(lx, ry + px(4), col, dashed); text(up(t), lx + mk + px(6), ry + px(12), lf, col, 'left', '0.16em'); lx += mk + px(6) + tw + px(18); });
      ry += px(24);
    }
    // footer: a scale bar and what is to scale. The caption sits beside the bar when the two fit side by side;
    // otherwise it takes lines of its own above the bar, whole clauses to a line when the whole does not fit.
    // The moons' figures are orbit radii, from Jupiter's centre; a chapter's is its altitude, from the cloud tops.
    const kmText = (a) => U.fmt.num(a) + ' km';
    const cap = 'To scale. Moons at their distance from Jupiter\'s centre, chapters at their altitude. Moons drawn larger.', cf = F.m(px(10)), bf = F.m(px(10));
    const capW = measure(cap, cf), barLblW = measure(kmText(500000), bf), CAPL = px(14);
    const besideBar = (r) => capW <= w - 2 * pad - 500000 * r / MOONS[MOONS.length - 1].a - px(8) - barLblW - px(20);
    const capLines = () => {
      const lw = w - 2 * pad, out = [];
      let line = '';
      for (const cl of (cap.match(/[^.,]+[.,]?/g) || [cap]).map((t) => t.trim()).filter(Boolean)) {
        const test = line ? line + ' ' + cl : cl;
        if (measure(test, cf) <= lw) { line = test; continue; }
        if (line) out.push(line);
        const ws = wrap(cl, cf, lw); out.push(...ws.slice(0, -1)); line = ws[ws.length - 1] || '';
      }
      if (line) out.push(line);
      return out;
    };
    // the system, to scale. A wide chart centres it in the whole box (the readout and legend sit in the corners
    // the outer orbit leaves free); a narrow one puts it under the readout and ends the box under the outer orbit.
    let foot = px(34), R, capAbove = null;
    const wideR = () => Math.max(40, Math.min(w / 2 - px(22), (y + h - foot - (y + px(8))) / 2 - px(10)));
    if (wide) {
      R = wideR();
      if (!besideBar(R)) { capAbove = capLines(); foot += capAbove.length * CAPL + px(2); R = wideR(); }
    } else {
      R = Math.max(40, w / 2 - px(22));
      if (!besideBar(R)) { capAbove = capLines(); foot += capAbove.length * CAPL + px(2); }
      h = ry - y + 2 * R + px(20) + foot;
    }
    brackets(x, y, w, h, C.line2, 10);
    const top = wide ? y + px(8) : ry, areaH = y + h - foot - top;
    const ccx = x + w / 2, ccy = top + areaH / 2, s = R / MOONS[MOONS.length - 1].a;
    const at = (a, ang) => ({ x: ccx + Math.cos(ang) * a * s, y: ccy + Math.sin(ang) * a * s });
    const litPlace = c ? chapterPlace(sc) : null;
    const litMoon = litPlace && litPlace.moon ? litPlace.moon.name : null;
    for (const mn of MOONS) {
      ctx.strokeStyle = mn.name === litMoon ? C.accentA(0.45) : C.line; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(ccx, ccy, mn.a * s, 0, TAU); ctx.stroke();
    }
    const jr = Math.max(2, JOVE_R * s);
    ctx.fillStyle = '#c9a37a'; ctx.globalAlpha *= 0.9; ctx.beginPath(); ctx.arc(ccx, ccy, jr, 0, TAU); ctx.fill(); ctx.globalAlpha /= 0.9;
    taken.push(box(ccx - jr, ccy - jr, ccx + jr, ccy + jr));
    const bar = 500000, bl = bar * s, sbx = x + pad, sby = y + h - px(14);
    ctx.strokeStyle = 'rgba(224,232,240,0.7)'; ctx.lineWidth = 1; ctx.beginPath();
    ctx.moveTo(sbx, sby + 0.5); ctx.lineTo(sbx + bl, sby + 0.5); ctx.moveTo(sbx + 0.5, sby - 4); ctx.lineTo(sbx + 0.5, sby + 4); ctx.moveTo(sbx + bl + 0.5, sby - 4); ctx.lineTo(sbx + bl + 0.5, sby + 4); ctx.stroke();
    text(kmText(bar), sbx + bl + px(8), sby + px(3.5), bf, 'rgba(224,232,240,0.8)');
    if (!capAbove) { text(cap, x + w - pad, sby + px(3.5), cf, C.dim, 'right'); taken.push(box(x, sby - px(10), x + w, y + h)); }
    else {
      capAbove.forEach((l, i) => text(l, sbx, sby - CAPL * (capAbove.length - i), cf, C.dim, 'left'));
      taken.push(box(x, sby - CAPL * capAbove.length - px(12), x + w, y + h));
    }
    // moon dots
    const dots = MOONS.map((mn) => ({ mn, p: at(mn.a, mn.ang) }));
    for (const d of dots) {
      const body = OD.P && OD.P.bodies && OD.P.bodies[d.mn.name.toLowerCase()];
      ctx.fillStyle = d.mn.color || (body && body.color) || C.ink2; ctx.beginPath(); ctx.arc(d.p.x, d.p.y, px(3.2), 0, TAU); ctx.fill();
      taken.push(box(d.p.x - px(4), d.p.y - px(4), d.p.x + px(4), d.p.y + px(4)));
    }
    // a box set in the first free spot of the eight around a point, trying the directions nearest `ang` first
    const DIRS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
    const turn = (a) => Math.abs(Math.atan2(Math.sin(a), Math.cos(a)));
    const inside = (r) => r.x0 >= x + 4 && r.x1 <= x + w - 4 && r.y0 >= y + 4 && r.y1 <= y + h - 4;
    // `sep`: how far a chapter key keeps from the keys already set (everything else keeps 2 px from everything)
    const clear = (r, sep) => !taken.some((t) => { const g = t.key && sep ? sep : 2; return r.x0 < t.x1 + g && r.x1 > t.x0 - g && r.y0 < t.y1 + g && r.y1 > t.y0 - g; });
    // a box reads as belonging to the nearest dot: a spot nearer another moon's dot than to its own anchor would
    // put a Europa label on an Amalthea chapter. `own`: the moon the box belongs to, if any.
    const gapTo = (r, qx, qy) => Math.hypot(qx - clamp(qx, r.x0, r.x1), qy - clamp(qy, r.y0, r.y1));
    const fair = (r, ax, ay, own) => { const da = gapTo(r, ax, ay); return !dots.some((dd) => dd.mn !== own && gapTo(r, dd.p.x, dd.p.y) < da); };
    const place = (ax, ay, bw, bh, d, ang, sep, own) => {
      const order = DIRS.slice().sort((p, q) => turn(Math.atan2(p[1], p[0]) - ang) - turn(Math.atan2(q[1], q[0]) - ang));
      let first = null, loose = null;  // the first spot inside the chart; the first clear one that sits nearer another moon
      for (const dist of [d, d + px(10), d + px(22)]) {
        for (const v of order) {
          const cxn = ax + v[0] * (dist + bw / 2), cyn = ay + v[1] * (dist + bh / 2);
          const r = box(cxn - bw / 2, cyn - bh / 2, cxn + bw / 2, cyn + bh / 2);
          if (!inside(r)) continue;
          if (!first) first = r;
          if (!clear(r, sep)) continue;
          if (fair(r, ax, ay, own)) { r.key = !!sep; taken.push(r); return r; }
          if (!loose) loose = r;
        }
      }
      const r = loose || first || box(ax - bw / 2, ay - bh / 2, ax + bw / 2, ay + bh / 2); r.key = !!sep; taken.push(r); return r;
    };
    // chapter places: the anchor point (a moon, the end of an outbound track, a point at a bare radius)
    const stateCol = (ch) => (ch.locked ? C.dim : ch.done ? C.good : C.ink2);
    const groups = new Map();
    chs.forEach((ch, i) => {
      const pl = chapterPlace(story[i]); if (!pl) return;
      let g = groups.get(pl.key);
      if (!g) {
        let p, ang;
        if (pl.kind === 'moon') { ang = pl.moon.ang; p = at(pl.moon.a, ang); }
        else if (pl.kind === 'out') {
          // outbound from a moon: a dashed track from the moon out to open space, halfway to the next orbit, in
          // the chapter's colour (lit, played, to play or locked)
          const nx = MOONS[MOONS.indexOf(pl.moon) + 1];
          const a1 = nx ? (pl.moon.a + nx.a) / 2 : pl.moon.a * 1.3; ang = pl.moon.ang + 0.4;
          const p0 = at(pl.moon.a, pl.moon.ang); p = at(a1, ang);
          const mid = at(((pl.moon.a + a1) / 2) * 0.98, pl.moon.ang + 0.26);
          const tc = i === lit ? C.accent : stateCol(ch);
          ctx.save(); ctx.strokeStyle = tc; ctx.globalAlpha *= ch.locked && i !== lit ? 0.6 : 0.75; ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.quadraticCurveTo(mid.x, mid.y, p.x, p.y); ctx.stroke(); ctx.restore();
          // an arrowhead at the end of the track, pointing outbound
          const da = Math.atan2(p.y - mid.y, p.x - mid.x), ah = px(5);
          ctx.fillStyle = tc; ctx.beginPath(); ctx.moveTo(p.x + Math.cos(da) * ah, p.y + Math.sin(da) * ah);
          ctx.lineTo(p.x + Math.cos(da + 2.5) * ah, p.y + Math.sin(da + 2.5) * ah); ctx.lineTo(p.x + Math.cos(da - 2.5) * ah, p.y + Math.sin(da - 2.5) * ah); ctx.closePath(); ctx.fill();
          taken.push(box(p.x - ah, p.y - ah, p.x + ah, p.y + ah));
        } else {
          ang = pl.moon ? pl.moon.ang : BARE_ORBIT_ANG; p = at(pl.a, ang);
          ctx.strokeStyle = C.ink2; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(p.x - 4, p.y); ctx.lineTo(p.x + 4, p.y); ctx.moveTo(p.x, p.y - 4); ctx.lineTo(p.x, p.y + 4); ctx.stroke();
          taken.push(box(p.x - 4, p.y - 4, p.x + 4, p.y + 4));
        }
        g = { p, ang, a: pl.kind === 'radius' ? pl.a : pl.moon.a, moon: pl.moon, cross: pl.kind === 'radius', list: [] }; groups.set(pl.key, g);
      }
      g.list.push(i);
    });
    // a phone's keys are thumb-sized: 24 px squares, 8 px apart within a group and from any other group's keys,
    // each answering taps 2 px round its square
    const ks = B.phone ? Math.max(24, px(22)) : px(16), kg = B.phone ? 8 : px(6);
    const keys = [];
    // the crowded middle first: the keys nearest Jupiter get the first pick of places. A key on a cross starts
    // 7 px out, clear of the cross's arms, so it can sit right beside its place.
    for (const g of Array.from(groups.values()).sort((p, q) => p.a - q.a)) {
      const r = place(g.p.x, g.p.y, g.list.length * ks + (g.list.length - 1) * kg, ks, g.cross ? px(7) : px(5), g.ang + Math.PI / 2, kg, g.moon);
      g.list.forEach((i, k) => keys.push({ i, x0: Math.round(r.x0 + k * (ks + kg)), y0: Math.round(r.y0) }));
      // a key pushed away from its place keeps a thin line back to it
      const nx = clamp(g.p.x, r.x0, r.x1), ny = clamp(g.p.y, r.y0, r.y1);
      if (Math.hypot(nx - g.p.x, ny - g.p.y) > px(9)) { ctx.strokeStyle = C.line2; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(g.p.x, g.p.y); ctx.lineTo(nx, ny); ctx.stroke(); }
    }
    // moon names and orbit radii, outward from Jupiter where there is room. The figure says "orbit": it is
    // measured from Jupiter's centre, where a chapter's altitude is measured from the cloud tops.
    const mf = F.d(px(10.5)), rf = F.m(px(9.5));
    for (const d of dots) {
      const nm = up(d.mn.name), rt = 'orbit ' + kmText(d.mn.a), nw = measure(nm, mf, '0.16em'), rw = measure(rt, rf);
      const bw = Math.max(nw, rw) + 2, bh = px(24);
      const r = place(d.p.x, d.p.y, bw, bh, px(5), d.mn.ang, 0, d.mn);
      const right = r.x1 <= d.p.x + 1, lx = right ? r.x1 : r.x0, al = right ? 'right' : 'left';
      text(nm, lx, r.y0 + px(9), mf, d.mn.name === litMoon ? C.ink : C.ink2, al, '0.16em');
      text(rt, lx, r.y0 + px(21), rf, C.dim, al);
    }
    keys.sort((p, q) => (p.i === lit) - (q.i === lit));
    const nf = F.m(B.phone ? 12 : px(10.5), 500);
    for (const kk of keys) {
      const ch = chs[kk.i], on = kk.i === lit, x0 = kk.x0, y0 = kk.y0;
      const r = region({ id: 'chm:' + kk.i, x: x0 - 2, y: y0 - 2, w: ks + 4, h: ks + 4, kind: 'mark', label: ch.title, focusable: false, mirror: false, disabled: !!ch.locked, act: ch.act, clip });
      const hot = B.hover === r.id && !ch.locked, col = stateCol(ch);
      // a locked key is dashed and dim, lit or not; the lit key of a chapter you can play is filled
      const fill = on && !ch.locked;
      ctx.save();
      if (ch.locked && !on) ctx.globalAlpha *= 0.75;
      ctx.fillStyle = fill ? C.accent : 'rgba(4,7,12,0.9)'; ctx.fillRect(x0, y0, ks, ks);
      ctx.strokeStyle = on || hot ? C.accent : col; ctx.lineWidth = 1; if (ch.locked) ctx.setLineDash([2, 2]);
      ctx.strokeRect(x0 + 0.5, y0 + 0.5, ks - 1, ks - 1); ctx.setLineDash([]);
      if (on) brackets(x0 - 3, y0 - 3, ks + 6, ks + 6, C.accent, 4);
      text(String(ch.n), x0 + ks / 2, y0 + ks / 2 + (B.phone ? 4.5 : px(4)), nf, fill ? C.ground : on ? C.accent : col, 'center');
      ctx.restore();
    }
    return y + h;
  }

  SCREENS.chapters = function (m) {
    // A wide frame lists the chapters in one column and puts the chart of the Jovian system beside them; a
    // phone keeps the list first and puts the chart under it.
    const PX = FR.x + (B.phone ? 12 : 56), chart = !B.phone && FR.w >= 900;
    const PW = chart ? Math.min(600, Math.round((FR.w - 2 * (PX - FR.x)) * 0.46)) : Math.min(FR.w - 2 * (PX - FR.x), 1040);
    scrim('dark'); frame(); header('Chapters');
    if (chart) { const cx0 = PX + PW + px(44); jovianChart(m, cx0, CT + px(14), FR.x + FR.w - px(40) - cx0, CB - CT - px(26)); }
    const rail = B.phone ? reserveRail(m.keys, PX, PW) : null;
    let y = beginFlow() + px(24);
    y = eyebrow(PX, y + px(8), m.eyebrow || 'Story');
    y = title([m.title || 'Eight chapters'], PX - 1, y - px(4), B.phone ? px(34) : px(44), C.ink) + px(4);
    y = paragraph(m.sub || '', PX, y, Math.min(PW, 720), { size: B.phone ? 13.5 : 14.5 }) + px(8);
    hair(PX, y, PX + PW, C.line2);
    const cols = B.phone || chart ? 1 : 2, cw = (PW - (cols - 1) * 28) / cols, y0 = y;
    // each row starts under the one above it: a row whose location line wraps to two lines is taller
    const colY = [y0, y0];
    let maxY = y;
    m.chapters.forEach((c, i) => {
      const col = cols === 1 ? 0 : i < Math.ceil(m.chapters.length / 2) ? 0 : 1;
      const ex = PX + col * (cw + 28);
      if (col === 1 && colY[1] === y0) hair(ex, y0, ex + cw, C.line2);
      const yy = entry(ex, colY[col], cw, { id: 'ch:' + i, n: c.n, label: c.title, sub: c.sub, done: c.done, locked: c.locked, disabled: c.locked, tag: c.locked ? 'locked' : '', act: c.act, clip: [CT, CB] });
      colY[col] = yy; maxY = Math.max(maxY, yy);
    });
    y = maxY + px(22);
    if (B.phone) y = jovianChart(m, PX, y - px(6), PW, 0, [CT, CB]) + px(12); // a narrow chart sets its own height
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
    scrim('dark'); frame(); header('Hangar');
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
        // two rows: the heads and parties, then the experience and what it buys (one row ran over its key)
        yy = kv(x, yy, w, 'Crew', c.total + ' · ' + n + (n === 1 ? ' party' : ' parties') + (c.wounded > 0 ? ' · ' + c.wounded + ' wounded' : ''), c.wounded > 0 ? C.warn : undefined);
        yy = kv(x, yy, w, 'Experience', xp + ' of 3' + (xp > 0 ? ' · repairs ' + (xp * 15) + ' % faster' : ''));
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
        // the picture takes the full width between two label lanes, two rows each
        const box = { x: PX, y: y + px(6), w: PW, h: 320 };
        labelledHull(ship, box, { rows: 3, max: 10 });
        y = box.y + box.h;
        text(up((cls.name || spec.cls) + ' · ' + (cls.length || ship.length) + ' m'), PX + PW / 2, y + px(14), F.m(px(10.5)), C.dim, 'center', '0.08em'); y += px(24);
      }
      y = numbers(PX, y, PW) + px(10);
      if (m.note) y = paragraph(m.note, PX, y, PW, { size: 12.5, color: C.dim });
      endFlow(y);
      if (rail) rail.draw();
    } else {
      const LW = Math.min(300, PW * 0.24), RW = Math.min(330, PW * 0.26), gap = 28;
      const LX = PX, RX = PX + PW - RW, MX = LX + LW + gap, MW = RX - gap - MX;
      let ly = h3(LX, y + px(6), LW, 'Your ships');
      for (let i = 0; i < specs.length; i++) ly = listEntry(i, LX, ly, LW);
      let ry = numbers(RX, y + px(6), RW);
      if (m.note) ry = paragraph(m.note, RX, ry + px(4), RW, { size: 12.5, color: C.dim });
      if (ship) {
        // The picture takes the whole middle column, top to bottom: the hull as wide as the column allows, four
        // rows of part labels above it and four below.
        const box = { x: MX, y: y + px(4), w: MW, h: Math.max(240, CB - y - px(40)) }, cx = box.x + box.w / 2;
        labelledHull(ship, box, { rows: 5, max: 14 });
        text(up((cls.name || spec.cls) + ' · ' + (cls.length || ship.length) + ' m · ' + (OD.Ships.FACTIONS[ship.faction] || {}).name), cx, box.y + box.h + px(16), F.m(px(11)), C.dim, 'center', '0.08em');
        hair(box.x, box.y + box.h + px(26), box.x + box.w, C.line);
      }
      endFlow(Math.max(ly, ry));
      if (rail) rail.draw();
    }
  };

  SCREENS.inspect = function (m) {
    const PX = FR.x + (B.phone ? 12 : 44), PW = FR.w - 2 * (PX - FR.x);
    scrim('dark'); frame(); header('Hull view');
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
      // the bottom row of the box belongs to the scale bar and the view caption, in every view; label lanes
      // above and below the picture take the rest
      const lblBox = { x: box.x, y: box.y + px(6), w: box.w, h: box.h - px(36) };
      const parts = labelledHull(ship, lblBox, { rows: B.phone ? 2 : 4, max: 14, view, holo: view === 'orbit', wide: 0.9 });
      const r = { L: B.hullL };
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

  // ---------------------------------------------------------------- fleets to scale (skirmish board)
  // Both fleets as the steppers set them, side views on one scale: the Compact nose right, the Authority nose
  // left, each hull as long as it is against every other. The scale steps in quarter-octaves, so a stepper
  // press reuses the sprites ShipArt already cached at that size.
  const fleetSpecs = new Map(), sideFit = new Map();
  function fleetShip(cls, fac) { const k = cls + '|' + fac; let s = fleetSpecs.get(k); if (!s) { s = { name: '', cls, faction: fac }; fleetSpecs.set(k, s); } return shipFor(s); }
  function sideBox(ship) { // the side view's bounds per pixel of hull length, and where the ship origin sits in them
    const id = artId(ship), k = typeof id === 'object' ? id.id + '@' + id.rev : id;
    let b = sideFit.get(k);
    if (!b) {
      b = { w: 1.04, h: 0.3, ox: 0.52, oy: 0.15 };
      try { if (artOk(ship) && typeof OD.ShipArt.bounds === 'function') { const r = OD.ShipArt.bounds(id, { size: 100, view: 'side', quality: 'low' }); if (r && r.w && r.h) b = { w: r.w / 100, h: r.h / 100, ox: r.ox / 100, oy: r.oy / 100 }; } } catch (e) { /* the default box stands */ }
      sideFit.set(k, b);
    }
    return b;
  }
  // rows of hulls, wrapped to the width, with `cap` px kept under each row for the class captions; null when
  // one hull alone is wider than the box
  function packFleet(items, s, w, gap, cap) {
    let x = 0, y = 0, rowH = 0, row = [];
    const out = [], rows = [];
    const close = () => { for (const p of row) { p.y = y + (rowH - p.ph) / 2; p.row = rows.length; } rows.push({ y, h: rowH }); out.push(...row); row = []; };
    for (const it of items) {
      const L = it.len * s, pw = it.b.w * L, ph = it.b.h * L;
      if (pw > w) return null;
      if (x > 0 && x + pw > w) { close(); y += rowH + cap + gap; x = 0; rowH = 0; }
      row.push({ it, L, x, pw, ph }); x += pw + gap; rowH = Math.max(rowH, ph);
    }
    close();
    return { out, rows, h: y + rowH + cap, w: out.reduce((a, p) => Math.max(a, p.x + p.pw), 0) };
  }
  // a hull's class word ("Harkness-class cruiser" → "Harkness") and its short name, which keeps the class word
  // and the role ("Lancer-class interceptor carrier" → "Lancer-class carrier")
  const classWord = (name) => String(name).replace(/-class\b.*$/i, '');
  const shortName = (name) => { const w = String(name).split(' '); return w.length > 2 ? w[0] + ' ' + w[w.length - 1] : String(name); };
  // The board names the classes quietly: each group of one class carries its class word under it where the word
  // fits, and the class of the stepper row under the pointer or the focus is outlined on its side, its full name
  // under the first hull. `o.strip`: the phone's short strip, which has no line for captions and names the lit
  // class in its side's header row instead.
  function fleetBoard(m, x, y, w, h, o) {
    const strip = !!(o && o.strip);
    const st = m.state, compact = st.player === 'JC';
    const sides = [
      { fac: 'JC', counts: compact ? st.playerShips : st.enemyShips, yours: compact, flip: false },
      { fac: 'ISA', counts: compact ? st.enemyShips : st.playerShips, yours: !compact, flip: true },
    ];
    for (const sd of sides) {
      sd.items = [];
      for (const c of m.classes) {
        const n = Math.max(0, Math.min(6, sd.counts[c.id] | 0)), cls = OD.Ships.CLASSES[c.id]; if (!n || !cls) continue;
        const ship = fleetShip(c.id, sd.fac); if (!ship) continue;
        for (let k = 0; k < n; k++) sd.items.push({ ship, cls: c.id, name: c.name, len: cls.length || ship.length || 100, b: sideBox(ship) });
      }
    }
    // the class a stepper row names: 'sk:<side>:<class>', and its − and + keys
    const hotOf = (id) => { const mm = /^sk:(JC|ISA):([^:]+)/.exec(id || ''); return mm ? { fac: mm[1], cls: mm[2] } : null; };
    const hot = hotOf(B.hover) || hotOf(B.focusId);
    let yy = h3(x, y, w, 'Fleets to scale');
    const capH = px(22), foot = strip ? px(26) : px(30), gapB = px(12);
    const areaH = Math.max(24, (y + h - foot - yy - 2 * capH - gapB) / 2);
    const gap = B.phone ? px(6) : px(10);
    const capF = F.d(px(10)), capLS = '0.14em', capLine = strip ? 0 : px(14);
    // the largest step of the scale at which both fleets fit their boxes, at most 3.2 px per metre
    const fit = (cap) => {
      for (let k = 0; k < 72; k++) {
        const sk = 3.2 * Math.pow(2, -k / 4), pk = sides.map((sd) => packFleet(sd.items, sk, w, gap, cap));
        if (pk.every((p) => p && p.h <= areaH)) return { s: sk, packs: pk };
      }
      return { s: 0, packs: null };
    };
    // a line for captions under each row, unless it would shrink the hulls by more than half an octave
    let best = fit(0), cap = 0;
    if (capLine) { const wc = fit(capLine); if (wc.packs && wc.s >= best.s * Math.SQRT1_2 - 1e-9) { best = wc; cap = capLine; } }
    const s = best.s, packs = best.packs;
    sides.forEach((sd, i) => {
      const n = sd.items.length, fname = (OD.Ships.FACTIONS[sd.fac] || {}).name || sd.fac;
      const lit = hot && hot.fac === sd.fac && sd.items.some((it) => it.cls === hot.cls) ? hot.cls : null;
      const litName = lit ? sd.items.find((it) => it.cls === lit).name : '';
      text(up(fname), x, yy + px(14), F.d(px(12)), facColor(sd.fac), 'left', '0.18em');
      let right = n + (n === 1 ? ' ship' : ' ships') + (sd.yours ? ' · yours' : ''), rightCol = C.dim;
      if (lit && !cap) {
        // the strip names the lit class in the header row, in as many words as fit beside the side's name
        const k = sd.items.filter((it) => it.cls === lit).length, room = w - measure(up(fname), F.d(px(12)), '0.18em') - px(12);
        right = [shortName(litName), classWord(litName)].map((t) => t + ' · ' + k).find((t) => measure(t, F.m(px(10.5))) <= room) || '';
        rightCol = C.ink;
      }
      if (right) text(right, x + w, yy + px(14), F.m(px(10.5)), rightCol, 'right');
      yy += capH;
      const pk = packs && packs[i];
      if (!n) text('No ships', x + w / 2, yy + areaH / 2 + px(4), F.m(px(11)), C.warn, 'center');
      else if (pk) {
        const oy = yy + (areaH - pk.h) / 2, ox = sd.flip ? x + w - pk.w : x;
        const placed = [];   // each hull's box on the screen, in reading order
        for (const p of pk.out) {
          // the Authority reads right to left, nose toward the Compact
          const bx = sd.flip ? ox + pk.w - p.x - p.pw : ox + p.x, by = oy + p.y, L = Math.round(p.L);
          placed.push({ p, bx, by });
          if (L < 10) { ctx.fillStyle = facColor(sd.fac); ctx.fillRect(Math.round(bx), Math.round(by + p.ph / 2), Math.max(2, Math.round(p.pw)), 2); continue; }
          ctx.save();
          if (sd.flip) { ctx.translate(2 * bx + p.pw, 0); ctx.scale(-1, 1); }
          try { OD.UI.drawHull(ctx, p.it.ship, bx + p.it.b.ox * L, by + p.it.b.oy * L, L, 'side', { cache: true, quality: L > 160 ? 'auto' : 'low', plume: false, light: { az: sd.flip ? -130 : -50, el: 35 } }); }
          catch (e) { if (OD.Render) OD.Render.lastError = 'bridge fleet: ' + (e && e.message); }
          ctx.restore();
        }
        const capY = (q) => oy + pk.rows[q.p.row].y + pk.rows[q.p.row].h + cap - px(3.5);
        // the lit class: corner ticks round each of its hulls, and its name under the first
        let nameBox = null, named = null;
        if (lit) {
          const mine = placed.filter((q) => q.p.it.cls === lit); named = mine[0] || null;
          for (const q of mine) brackets(q.bx - 3, q.by - 3, q.p.pw + 6, q.p.ph + 6, facColor(sd.fac), q.p.pw > 30 ? 5 : 3);
          if (cap && mine.length) {
            const q = mine[0], nm = up(litName), nw = measure(nm, capF, capLS);
            const cx = clamp(q.bx + q.p.pw / 2, x + nw / 2 + 4, x + w - nw / 2 - 4), by = capY(q);
            nameBox = { x0: cx - nw / 2 - 4, x1: cx + nw / 2 + 4, y: by };
            ctx.fillStyle = 'rgba(4,7,12,0.88)'; ctx.fillRect(nameBox.x0, by - px(10), nameBox.x1 - nameBox.x0, px(13));
            text(nm, cx, by, capF, C.ink, 'center', capLS);
          }
        }
        // the class word under every group of one class in each row, so a class split over two rows is named in
        // both and no hull sits uncaptioned beside another class's word. A word goes under its group when the
        // group's hulls are as wide as it; otherwise it may reach into row space no other group's hulls stand on.
        if (cap) {
          const groups = [], shown = nameBox ? [{ x0: nameBox.x0, x1: nameBox.x1, y: nameBox.y }] : [];
          for (let a = 0; a < placed.length;) {
            let b = a; while (b + 1 < placed.length && placed[b + 1].p.it.cls === placed[a].p.it.cls && placed[b + 1].p.row === placed[a].p.row) b++;
            const seg = placed.slice(a, b + 1);
            const x0 = Math.min(...seg.map((q) => q.bx)), x1 = Math.max(...seg.map((q) => q.bx + q.p.pw));
            // the group that carries the lit class's full name needs no word of its own
            if (!seg.includes(named)) groups.push({ it: placed[a].p.it, row: placed[a].p.row, x0, x1, by: capY(placed[a]) });
            a = b + 1;
          }
          const free = (x0, x1, by) => !shown.some((q) => Math.abs(q.y - by) < 1 && x0 < q.x1 + px(6) && x1 > q.x0 - px(6));
          for (const pass of [0, 1]) {
            for (const g of groups) {
              if (g.done) continue;
              const word = up(classWord(g.it.name)), ww = measure(word, capF, capLS);
              let cx = (g.x0 + g.x1) / 2;
              if (pass === 0 && ww > g.x1 - g.x0 + gap - 2) continue;
              if (pass === 1) {
                // the row space beside the group up to the next group's hulls (or the board's edge)
                let lo = x, hi = x + w;
                for (const q of placed) {
                  if (q.p.row !== g.row) continue;
                  if (q.bx + q.p.pw <= g.x0 + 0.5) lo = Math.max(lo, q.bx + q.p.pw + gap / 2);
                  else if (q.bx >= g.x1 - 0.5) hi = Math.min(hi, q.bx - gap / 2);
                }
                if (hi - lo < ww) continue;
                cx = clamp(cx, lo + ww / 2, hi - ww / 2);
              }
              if (!free(cx - ww / 2, cx + ww / 2, g.by)) continue;
              text(word, cx, g.by, capF, C.dim, 'center', capLS);
              shown.push({ x0: cx - ww / 2, x1: cx + ww / 2, y: g.by }); g.done = true;
            }
          }
        }
      }
      yy += areaH + (i === 0 ? gapB : 0);
    });
    // the scale bar: a round length between about 50 and 140 px
    if (s > 0) {
      let bar = 10; for (const b of [10, 20, 50, 100, 200, 500, 1000, 2000, 5000]) { bar = b; if (b * s >= px(50)) break; }
      const bl = Math.round(bar * s), bx = x, by = y + h - px(8);
      ctx.strokeStyle = 'rgba(224,232,240,0.7)'; ctx.lineWidth = 1; ctx.beginPath();
      ctx.moveTo(bx, by + 0.5); ctx.lineTo(bx + bl, by + 0.5); ctx.moveTo(bx + 0.5, by - 4); ctx.lineTo(bx + 0.5, by + 4); ctx.moveTo(bx + bl + 0.5, by - 4); ctx.lineTo(bx + bl + 0.5, by + 4); ctx.stroke();
      text(bar + ' m', bx + bl + px(8), by + px(4), F.m(px(10.5)), 'rgba(224,232,240,0.8)');
      text('Hull lengths to scale', x + w, by + px(4), F.m(px(10)), C.dim, 'right');
    }
    return y + h;
  }

  SCREENS.skirmish = function (m) {
    // A wide frame keeps the controls left and shows both fleets to scale on the right; a phone shows them in
    // a short strip above the ship steppers, and a frame between the two under the steppers.
    const PX = FR.x + (B.phone ? 12 : 56), FW = FR.w - 2 * (PX - FR.x), board = !B.phone && FR.w >= 1100;
    const PW = board ? Math.min(880, Math.round(FW * 0.64)) : Math.min(FW, 1040);
    scrim('dark'); frame(); header('Skirmish');
    const st = m.state;
    const rail = reserveRail(m.keys, PX, board ? FW : PW);
    let y = beginFlow() + px(16);
    y = eyebrow(PX, y + px(8), 'Skirmish');
    y = title([m.title || 'Set the board'], PX - 1, y - px(4), B.phone ? px(32) : px(40), C.ink) + px(2);
    y = paragraph(m.sub || '', PX, y, Math.min(PW, 760), { size: B.phone ? 13 : 14, color: C.ink2 }) + px(4);
    const yBoard = y;
    const enemy = st.player === 'JC' ? 'ISA' : 'JC';
    const optW = B.phone ? PW : Math.min(PW, 520);
    const s1 = seg(PX, y, { id: 'sk:side', label: 'Your side', options: m.sides, value: st.player, set: (v) => { st.player = v; }, clip: [CT, CB], maxW: optW });
    y += s1.h + px(12);
    const envIdx = Math.max(0, m.envs.findIndex((e) => e.id === st.env));
    const rangeIdx = m.ranges.reduce((best, r, i) => Math.abs(r - st.range) < Math.abs(m.ranges[best] - st.range) ? i : best, 0);
    // the two option rows share one value column, as wide as the longer label leaves on a phone
    const bw = B.phone ? 44 : 34, lf = F.d(px(14));
    const optVW = Math.max(px(110), Math.min(px(170), optW - bw * 2 - px(36) - Math.max(measure('Where', lf, '0.06em'), measure('Opening range', lf, '0.06em'))));
    y = stepper(PX, y, optW, { id: 'sk:env', label: 'Where', valueW: optVW, value: m.envs[envIdx].label, dec: () => { st.env = m.envs[(envIdx + m.envs.length - 1) % m.envs.length].id; }, inc: () => { st.env = m.envs[(envIdx + 1) % m.envs.length].id; }, big: true, clip: [CT, CB] });
    y = stepper(PX, y, optW, { id: 'sk:range', label: 'Opening range', short: 'Range', valueW: optVW, value: U.fmt.dist(st.range * 1000), dec: () => { st.range = m.ranges[Math.max(0, rangeIdx - 1)]; }, inc: () => { st.range = m.ranges[Math.min(m.ranges.length - 1, rangeIdx + 1)]; }, big: true, clip: [CT, CB] });
    y += px(16);
    // a phone shows both fleets in a short strip above the steppers, so each press shows on the board
    if (B.phone) y = fleetBoard(m, PX, y - px(4), PW, px(180), { strip: true }) + px(14);
    const cols = B.phone ? 1 : 2, cw = (PW - (cols - 1) * 40) / cols;
    const short = shortName;
    const sideCol = (x, yy, w, label, fac, counts) => {
      text(up(label), x, yy + px(12), F.d(px(12)), facColor(fac), 'left', '0.18em'); const lw = measure(up(label), F.d(px(12)), '0.18em'); hair(x + lw + 10, yy + px(8), x + w, C.line2); yy += px(22);
      for (const c of m.classes) {
        const n = counts[c.id] || 0;
        yy = stepper(x, yy, w, { id: 'sk:' + fac + ':' + c.id, label: c.name, short: short(c.name), sub: c.custom ? 'yard design' : '', value: String(n), zero: n === 0, dec: () => { counts[c.id] = Math.max(0, n - 1); }, inc: () => { counts[c.id] = Math.min(6, n + 1); }, clip: [CT, CB] });
      }
      const total = m.classes.reduce((a, c) => a + (counts[c.id] || 0), 0);
      text(total + (total === 1 ? ' ship' : ' ships'), x + w, yy + px(14), F.m(px(11)), total ? C.dim : C.warn, 'right'); return yy + px(22);
    };
    const yA = sideCol(PX, y, cw, 'Your ships · ' + (OD.Ships.FACTIONS[st.player] || {}).name, st.player, st.playerShips);
    const yB = sideCol(cols === 1 ? PX : PX + cw + 40, cols === 1 ? yA + px(8) : y, cw, 'Enemy ships · ' + (OD.Ships.FACTIONS[enemy] || {}).name, enemy, st.enemyShips);
    y = Math.max(yA, yB) + px(8);
    if (board) {
      const bx = PX + PW + px(48), bw2 = FR.x + FR.w - px(56) - bx;
      fleetBoard(m, bx, yBoard, bw2, Math.max(y, CB - px(10) - B.scroll) - yBoard);
    } else if (!B.phone) {
      y = fleetBoard(m, PX, y + px(4), PW, px(300)) + px(12);
    }
    endFlow(y);
    if (rail) rail.draw();
  };

  let pauseEnd = 0; // where the pause column ended on the last draw, for the dark pool under it
  SCREENS.pause = function (m) {
    const PW = Math.min(440, FR.w - 24), PX = Math.round((B.W - PW) / 2);
    let y = CT + Math.max(px(20), (CB - CT) * 0.18);
    const y0 = y, end = pauseEnd > y0 ? pauseEnd : y0 + px(150) + (m.entries || []).length * EH;
    const mx = B.phone ? px(24) : px(48), mt = B.phone ? px(34) : px(48);
    scrim('pause', { x: PX - mx, y: y0 - mt, w: PW + 2 * mx, h: end - y0 + mt + px(30) }); frame(); header('Paused');
    y = eyebrow(PX, y + px(8), m.eyebrow || 'Paused');
    y = title([m.title || ''], PX - 1, y - px(4), B.phone ? px(30) : px(38), C.ink) + px(8);
    if (m.sub) y = paragraph(m.sub, PX, y, PW, { size: 13.5, color: C.dim });
    hair(PX, y, PX + PW, C.line2);
    m.entries.forEach((e, i) => { y = entry(PX, y, PW, { id: 'pause:' + i, n: i + 1, label: e.label, sub: e.sub, primary: e.primary, danger: e.danger, act: e.act }); });
    pauseEnd = y;
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
    B.prevHits = B.hits; B.hits = []; B.uid = 0; B.heroBottom = 0;
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
    B.scroll = 0; B.scrollMax = 0; B.focusId = null; B.focusByKey = false; B.hover = null; B.hits = []; B.prevHits = []; B.mirrorSig = ''; B.heroBottom = 0;
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
