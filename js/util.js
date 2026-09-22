/* Orbital Declaration — utilities. SI units everywhere; formatting only at the display edge. */
(function () {
  'use strict';
  const OD = (window.OD = window.OD || {});
  const TAU = Math.PI * 2;

  const U = {
    TAU,
    clamp: (v, a, b) => (v < a ? a : v > b ? b : v),
    lerp: (a, b, t) => a + (b - a) * t,
    sign: (v) => (v > 0 ? 1 : v < 0 ? -1 : 0),
    wrapAngle(a) {
      a = a % TAU;
      if (a > Math.PI) a -= TAU;
      if (a <= -Math.PI) a += TAU;
      return a;
    },
    angleDiff: (target, current) => U.wrapAngle(target - current),
    smoothstep: (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t)),
    easeOut: (t) => 1 - Math.pow(1 - U.clamp(t, 0, 1), 3),

    // ---- vectors {x,y} ----
    v: (x, y) => ({ x, y }),
    add: (a, b) => ({ x: a.x + b.x, y: a.y + b.y }),
    sub: (a, b) => ({ x: a.x - b.x, y: a.y - b.y }),
    scale: (a, s) => ({ x: a.x * s, y: a.y * s }),
    len: (a) => Math.hypot(a.x, a.y),
    len2: (a) => a.x * a.x + a.y * a.y,
    dot: (a, b) => a.x * b.x + a.y * b.y,
    cross: (a, b) => a.x * b.y - a.y * b.x,
    dist: (a, b) => Math.hypot(a.x - b.x, a.y - b.y),
    norm(a) {
      const l = Math.hypot(a.x, a.y);
      return l > 0 ? { x: a.x / l, y: a.y / l } : { x: 0, y: 0 };
    },
    fromAngle: (ang, m = 1) => ({ x: Math.cos(ang) * m, y: Math.sin(ang) * m }),
    angleOf: (a) => Math.atan2(a.y, a.x),
    perp: (a) => ({ x: -a.y, y: a.x }),
    rot(a, ang) {
      const c = Math.cos(ang), s = Math.sin(ang);
      return { x: a.x * c - a.y * s, y: a.x * s + a.y * c };
    },
    // Component of a along unit direction u, and the remainder.
    split(a, u) {
      const along = a.x * u.x + a.y * u.y;
      return { along, lateral: { x: a.x - u.x * along, y: a.y - u.y * along } };
    },

    // ---- seeded random (mulberry32) ----
    rng(seed) {
      let t = (seed >>> 0) || 1;
      const f = () => {
        t += 0x6d2b79f5;
        let r = Math.imul(t ^ (t >>> 15), 1 | t);
        r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
        return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
      };
      f.range = (a, b) => a + (b - a) * f();
      f.pick = (arr) => arr[Math.floor(f() * arr.length)];
      f.sign = () => (f() < 0.5 ? -1 : 1);
      return f;
    },

    uid: (() => { let n = 1; return (p = 'e') => p + (n++).toString(36); })(),

    // ---- formatting ----
    fmt: {
      num(v, digits = 3) {
        if (!isFinite(v)) return '—';
        const a = Math.abs(v);
        if (a === 0) return '0';
        if (a >= 1000) return Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '\u2009');
        if (a < 0.01) return v.toExponential(2);
        let s = v.toPrecision(digits);
        if (s.includes('.')) s = s.replace(/\.?0+$/, '');
        return s;
      },
      si(v, unit = '', digits = 3) {
        if (!isFinite(v)) return '—';
        const a = Math.abs(v);
        const pre = [[1e12, 'T'], [1e9, 'G'], [1e6, 'M'], [1e3, 'k']];
        for (const [f, p] of pre) if (a >= f) return U.fmt.num(v / f, digits) + ' ' + p + unit;
        if (a < 1 && a > 0 && unit) {
          if (a >= 1e-3) return U.fmt.num(v * 1e3, digits) + ' m' + unit;
          if (a >= 1e-6) return U.fmt.num(v * 1e6, digits) + ' µ' + unit;
          if (a >= 1e-9) return U.fmt.num(v * 1e9, digits) + ' n' + unit;
        }
        return U.fmt.num(v, digits) + (unit ? ' ' + unit : '');
      },
      // distances read best in km once past a few km
      dist(m, digits = 3) {
        if (!isFinite(m)) return '—';
        const a = Math.abs(m);
        if (a < 1000) return Math.round(m) + ' m';
        if (a < 1e6) return U.fmt.num(m / 1e3, digits) + ' km';
        if (a < 1e9) return U.fmt.num(m / 1e3, 4) + ' km';
        return U.fmt.num(m / 1.495978707e11, 3) + ' AU';
      },
      speed(ms, digits = 3) {
        if (!isFinite(ms)) return '—';
        const a = Math.abs(ms);
        if (a < 1000) return U.fmt.num(ms, digits) + ' m/s';
        return U.fmt.num(ms / 1e3, digits) + ' km/s';
      },
      dv(ms) { return U.fmt.num(ms / 1e3, 3) + ' km/s'; },
      accel(a) { return U.fmt.num(a, 3) + ' m/s² (' + U.fmt.num(a / 9.80665, 2) + ' g)'; },
      mass(kg) {
        const t = kg / 1000;
        if (t >= 1e6) return U.fmt.num(t / 1e6, 3) + ' Mt';
        if (t >= 1e3) return U.fmt.num(t / 1e3, 3) + ' kt';
        return U.fmt.num(t, 3) + ' t';
      },
      power(w) { return U.fmt.si(w, 'W'); },
      energy(j) { return U.fmt.si(j, 'J'); },
      temp(k) { return Math.round(k) + ' K'; },
      pct(f, d = 0) { return (f * 100).toFixed(d) + ' %'; },
      time(s) {
        if (!isFinite(s)) return '—';
        s = Math.max(0, Math.round(s));
        const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
        if (h > 0) return h + 'h ' + String(m).padStart(2, '0') + 'm ' + String(sec).padStart(2, '0') + 's';
        if (m > 0) return m + 'm ' + String(sec).padStart(2, '0') + 's';
        return sec + 's';
      },
      clock(s) {
        s = Math.max(0, Math.floor(s));
        const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
        return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
      },
      deg(rad) { return Math.round(((rad * 180) / Math.PI + 360) % 360) + '°'; },
    },

    escapeHtml(s) {
      return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    },
  };
  OD.U = U;
})();
