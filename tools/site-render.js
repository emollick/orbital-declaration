// Renders the social card and the icons for assets/site. Called headlessly: window.SiteRender.og(opts) → data URL.
(function () {
  const seed = (n) => { let s = n; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; };
  function stars(ctx, w, h, count, rnd) {
    for (let i = 0; i < count; i++) {
      const x = rnd() * w, y = rnd() * h, r = rnd();
      const size = r < 0.9 ? 1 : r < 0.98 ? 1.6 : 2.4, a = 0.25 + rnd() * 0.65;
      ctx.fillStyle = 'rgba(' + (200 + (rnd() * 55 | 0)) + ',' + (210 + (rnd() * 40 | 0)) + ',255,' + a.toFixed(2) + ')';
      ctx.beginPath(); ctx.arc(x, y, size / 2, 0, Math.PI * 2); ctx.fill();
    }
  }
  // A grey-blue moon limb with a soft terminator, like Callisto on the menu.
  function moon(ctx, cx, cy, R, sunAngle) {
    const g = ctx.createRadialGradient(cx + Math.cos(sunAngle) * R * 0.6, cy + Math.sin(sunAngle) * R * 0.6, R * 0.1, cx, cy, R);
    g.addColorStop(0, '#3a4658'); g.addColorStop(0.55, '#1a222e'); g.addColorStop(1, '#0a0f17');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
    // craters
    const rnd = seed(7);
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.clip();
    for (let i = 0; i < 90; i++) {
      const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * R * 0.98, r = 2 + rnd() * rnd() * R * 0.06;
      const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
      ctx.fillStyle = 'rgba(0,0,0,' + (0.08 + rnd() * 0.12).toFixed(2) + ')'; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,' + (0.03 + rnd() * 0.05).toFixed(2) + ')'; ctx.beginPath(); ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.6, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    // limb glow
    ctx.strokeStyle = 'rgba(79,209,197,0.28)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, cy, R + 1, 0, Math.PI * 2); ctx.stroke();
  }
  function og(o) {
    o = Object.assign({ w: 1200, h: 630, ship: 'cruiser', size: 640, view: 'threequarter', rotation: -0.32, x: 830, y: 330, throttle: 0.55, url: 'orbital-declaration.netlify.app' }, o || {});
    const c = document.createElement('canvas'); c.width = o.w; c.height = o.h; document.body.appendChild(c);
    const ctx = c.getContext('2d');
    const bg = ctx.createLinearGradient(0, 0, o.w, o.h); bg.addColorStop(0, '#04070c'); bg.addColorStop(0.6, '#070d17'); bg.addColorStop(1, '#0b1422');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, o.w, o.h);
    stars(ctx, o.w, o.h, 420, seed(11));
    moon(ctx, o.w * 0.62, o.h * 1.55, o.h * 0.95, -1.9);
    // the ship, lit from the upper left, drive lit
    OD.ShipArt.draw(ctx, o.ship, { x: o.x, y: o.y, size: o.size, view: o.view, rotation: o.rotation, faction: 'JC', light: { az: -40, el: 40 },
      state: { radiators: 1, throttle: o.throttle, heat: 0.4, hull: 1 }, plume: true, time: 1.7, cache: false, quality: 'high' });
    // left scrim so the title reads over the plume
    const sc = ctx.createLinearGradient(0, 0, o.w * 0.55, 0); sc.addColorStop(0, 'rgba(4,7,12,0.92)'); sc.addColorStop(0.7, 'rgba(4,7,12,0.55)'); sc.addColorStop(1, 'rgba(4,7,12,0)');
    ctx.fillStyle = sc; ctx.fillRect(0, 0, o.w * 0.55, o.h);
    // text
    const L = 76;
    ctx.fillStyle = '#4fd1c5'; ctx.fillRect(L, 190, 26, 3);
    ctx.font = '600 20px Rajdhani'; ctx.textBaseline = 'middle'; ctx.letterSpacing = '0.26em';
    ctx.fillText('JOVIAN SYSTEM · 2211', L + 40, 191);
    ctx.fillStyle = '#e6eef6'; ctx.font = '700 104px Rajdhani'; ctx.letterSpacing = '0.02em'; ctx.textBaseline = 'alphabetic';
    ctx.fillText('Orbital', L - 3, 292); ctx.fillText('Declaration', L - 3, 386);
    ctx.fillStyle = '#b1bfce'; ctx.font = '400 24px "IBM Plex Sans"'; ctx.letterSpacing = '0';
    ctx.fillText('A hard science fiction space combat game.', L, 434);
    ctx.fillText('Real orbits, real delta-v, heat that has to go somewhere.', L, 466);
    ctx.fillStyle = '#7f91a7'; ctx.font = '400 17px "IBM Plex Mono"'; ctx.letterSpacing = '0.04em';
    ctx.fillText('Δv = vₑ ln(m₀/m₁)   P = 2AεσT⁴   spot = 2.44 λR/D', L, 522);
    ctx.fillStyle = '#4fd1c5'; ctx.font = '600 16px Rajdhani'; ctx.letterSpacing = '0.2em';
    ctx.fillText(o.url.toUpperCase(), L, 572);
    // corner ticks, like the glass panels
    ctx.strokeStyle = 'rgba(79,209,197,0.7)'; ctx.lineWidth = 2;
    const t = 18, m = 28;
    ctx.beginPath(); ctx.moveTo(m, m + t); ctx.lineTo(m, m); ctx.lineTo(m + t, m); ctx.moveTo(o.w - m - t, o.h - m); ctx.lineTo(o.w - m, o.h - m); ctx.lineTo(o.w - m, o.h - m - t); ctx.stroke();
    return c.toDataURL('image/png');
  }
  // Icons: the favicon glyph (assets/site/icon.svg) rasterised; `pad` shrinks it into the maskable safe zone.
  function icon(svgText, px, pad) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas'); c.width = px; c.height = px; document.body.appendChild(c);
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#04070c'; ctx.fillRect(0, 0, px, px);
        const s = px * (1 - 2 * pad);
        ctx.drawImage(img, px * pad, px * pad, s, s);
        resolve(c.toDataURL('image/png'));
      };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgText);
    });
  }
  window.SiteRender = { og, icon, ready: document.fonts.ready };
})();
