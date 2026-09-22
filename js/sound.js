/* Orbital Declaration — sound. Everything is synthesised with WebAudio: oscillators, a noise buffer, filters and
   envelopes. No assets, no network. A bridge is a quiet place: cues are short, low and restrained; alerts are
   clear but never harsh; the ambient hum is barely there. Every public function is a safe no-op when the
   AudioContext is missing, blocked or not yet unlocked by a gesture. */
(function () {
  'use strict';
  const OD = (window.OD = window.OD || {});
  const STORE_KEY = 'od.sound';
  const AC = window.AudioContext || window.webkitAudioContext || null;

  // ---- state ----
  let ctx = null, master = null, comp = null, cueBus = null, ambBus = null, noiseBuf = null;
  let broken = !AC;            // no WebAudio here: everything stays a no-op
  let enabled = readEnabled();
  let inited = false;
  let amb = null;              // ambient nodes once built
  let ambTarget = null;        // requested ambient level (null: never asked, <0: off)
  let ambApplied = -1, ambAppliedAt = 0;
  let ambAskedAt = 0;          // last ambient() call (ms): the hum expires on its own when the bridge stops asking
  const stats = { played: {}, dropped: 0 };

  function readEnabled() {
    try { const v = localStorage.getItem(STORE_KEY); return v === null ? true : !(v === '0' || v === 'off' || v === 'false'); } catch (e) { return true; }
  }
  function writeEnabled(v) { try { localStorage.setItem(STORE_KEY, v ? '1' : '0'); } catch (e) { /* private mode */ } }

  function hidden() { try { return !!document.hidden; } catch (e) { return false; } }

  // The context is created lazily and only becomes useful after resume() succeeds on a gesture.
  function getCtx() {
    if (ctx || broken) return ctx;
    try {
      ctx = new AC({ latencyHint: 'interactive' });
      comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -20; comp.knee.value = 12; comp.ratio.value = 3; comp.attack.value = 0.003; comp.release.value = 0.15;
      master = ctx.createGain(); master.gain.value = enabled ? 0.8 : 0;
      cueBus = ctx.createGain(); cueBus.gain.value = 0.7;
      ambBus = ctx.createGain(); ambBus.gain.value = hidden() ? 0 : 1;
      cueBus.connect(comp); ambBus.connect(comp); comp.connect(master); master.connect(ctx.destination);
      noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 2), ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    } catch (e) { broken = true; ctx = null; }
    return ctx;
  }
  function ready() { return !!ctx && ctx.state === 'running' && enabled && !broken; }

  function unlock() {
    if (broken) return false;
    const c = getCtx();
    if (!c) return false;
    try {
      if (c.state !== 'running') { const p = c.resume(); if (p && p.then) p.then(afterUnlock, () => {}); }
      else afterUnlock();
    } catch (e) { /* still blocked; the next gesture tries again */ }
    return c.state === 'running';
  }
  function afterUnlock() {
    if (!ctx || ctx.state !== 'running') return;
    if (ambTarget !== null && ambTarget >= 0 && !amb) buildAmbient();
    if (amb) applyAmbient(true);
  }

  function init() {
    if (inited) return;
    inited = true;
    try {
      const g = () => { unlock(); };
      window.addEventListener('pointerdown', g, { passive: true });
      window.addEventListener('keydown', g, { passive: true });
      document.addEventListener('visibilitychange', () => {
        if (!ctx || !ambBus) return;
        try { ambBus.gain.setTargetAtTime(hidden() ? 0 : 1, ctx.currentTime, 0.15); } catch (e) { /* closed */ }
      });
      // Debrief and menu do not drive ambient(): the hum and reactor drone fade out once nobody has asked for 1.5 s.
      setInterval(() => { if (amb && ambTarget !== null && ambTarget >= 0 && nowMs() - ambAskedAt > 1500) { ambTarget = -1; applyAmbient(true); } }, 500);
    } catch (e) { /* no DOM */ }
  }

  function setEnabled(v) {
    v = !!v;
    if (v === enabled) return;
    enabled = v;
    writeEnabled(v);
    if (!ctx || !master) return;
    try {
      const t = ctx.currentTime;
      master.gain.cancelScheduledValues(t);
      master.gain.setTargetAtTime(v ? 0.8 : 0, t, 0.05);
      if (v) unlock();
    } catch (e) { /* closed */ }
  }

  // ---- voices ----
  // Envelope: attack a, hold h, release r (seconds). Returns the end time.
  function env(param, t0, peak, a, h, r) {
    param.cancelScheduledValues(t0);
    param.setValueAtTime(0.0001, t0);
    param.linearRampToValueAtTime(peak, t0 + a);
    if (h > 0) param.setValueAtTime(peak, t0 + a + h);
    param.exponentialRampToValueAtTime(0.0001, t0 + a + h + r);
    return t0 + a + h + r;
  }
  function filterFor(o) {
    if (!(o.lp || o.hp || o.bp)) return null;
    const f = ctx.createBiquadFilter();
    f.type = o.lp ? 'lowpass' : o.hp ? 'highpass' : 'bandpass';
    const f0 = o.lp || o.hp || o.bp;
    f.frequency.value = f0;
    if (o.q) f.Q.value = o.q;
    return f;
  }
  function release(nodes) { for (const n of nodes) { try { n.disconnect(); } catch (e) { /* already gone */ } } }
  // tone: { f, f1, type, a, h, r, g, when, detune, lp|hp|bp, q, f1filt }
  function tone(o) {
    const t0 = ctx.currentTime + (o.when || 0);
    const a = o.a === undefined ? 0.005 : o.a, h = o.h || 0, r = o.r === undefined ? 0.1 : o.r;
    const osc = ctx.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f, t0);
    if (o.f1) osc.frequency.exponentialRampToValueAtTime(o.f1, t0 + a + h + r);
    if (o.detune) osc.detune.value = o.detune;
    const g = ctx.createGain();
    const end = env(g.gain, t0, o.g || 0.05, a, h, r);
    const filt = filterFor(o);
    if (filt) { osc.connect(filt); filt.connect(g); if (o.f1filt) filt.frequency.exponentialRampToValueAtTime(o.f1filt, end); } else osc.connect(g);
    g.connect(cueBus);
    osc.start(t0); osc.stop(end + 0.02);
    osc.onended = () => release(filt ? [osc, filt, g] : [osc, g]);
  }
  // noise: { a, h, r, g, when, lp|hp|bp, q, f1filt }
  function noise(o) {
    const t0 = ctx.currentTime + (o.when || 0);
    const a = o.a === undefined ? 0.003 : o.a, h = o.h || 0, r = o.r === undefined ? 0.08 : o.r;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf; src.loop = true;
    src.playbackRate.value = o.rate || 1;
    const g = ctx.createGain();
    const end = env(g.gain, t0, o.g || 0.04, a, h, r);
    const filt = filterFor(o);
    if (filt) { src.connect(filt); filt.connect(g); if (o.f1filt) filt.frequency.exponentialRampToValueAtTime(o.f1filt, end); } else src.connect(g);
    g.connect(cueBus);
    src.start(t0, Math.random() * 1.5); src.stop(end + 0.02);
    src.onended = () => release(filt ? [src, filt, g] : [src, g]);
  }
  const rnd = (a, b) => a + Math.random() * (b - a);

  // ---- the cue palette ----
  const CUES = {
    // console
    key() { tone({ f: 1400, f1: 900, a: 0.002, r: 0.035, g: 0.04 }); noise({ hp: 2500, a: 0.001, r: 0.012, g: 0.02 }); },
    tick() { tone({ f: 1100, a: 0.002, r: 0.02, g: 0.03 }); },
    open() { tone({ f: 392, a: 0.01, r: 0.14, g: 0.04 }); tone({ f: 523, when: 0.08, a: 0.01, r: 0.18, g: 0.04 }); },
    back() { tone({ f: 523, a: 0.01, r: 0.14, g: 0.04 }); tone({ f: 392, when: 0.08, a: 0.01, r: 0.18, g: 0.04 }); },
    confirm() { tone({ f: 660, a: 0.01, r: 0.12, g: 0.035 }); tone({ f: 880, when: 0.09, a: 0.01, r: 0.16, g: 0.03 }); },
    comms() { noise({ bp: 1600, q: 6, a: 0.005, h: 0.03, r: 0.05, g: 0.05 }); tone({ f: 1200, when: 0.02, a: 0.003, r: 0.03, g: 0.02 }); noise({ bp: 1200, q: 5, when: 0.09, a: 0.004, r: 0.04, g: 0.03 }); },
    warp() { noise({ bp: 250, f1filt: 1800, q: 1.5, a: 0.04, h: 0.06, r: 0.22, g: 0.045 }); tone({ f: 180, f1: 360, a: 0.04, r: 0.25, g: 0.02 }); },
    // advisories
    alert() {
      for (let i = 0; i < 2; i++) {
        tone({ f: 330, type: 'triangle', lp: 1500, when: i * 0.26, a: 0.012, h: 0.11, r: 0.07, g: 0.08 });
        tone({ f: 495, when: i * 0.26, a: 0.012, h: 0.1, r: 0.06, g: 0.03 });
      }
    },
    caution() { tone({ f: 294, type: 'triangle', lp: 1200, a: 0.012, h: 0.09, r: 0.08, g: 0.055 }); },
    incoming() {
      tone({ f: 660, f1: 990, a: 0.01, h: 0.05, r: 0.06, g: 0.055 });
      tone({ f: 660, f1: 990, when: 0.16, a: 0.01, h: 0.05, r: 0.06, g: 0.055 });
      noise({ bp: 2400, f1filt: 3600, q: 3, a: 0.01, r: 0.2, g: 0.025 });
    },
    contact() { tone({ f: 880, a: 0.004, r: 0.45, g: 0.055 }); tone({ f: 440, a: 0.004, r: 0.3, g: 0.02 }); tone({ f: 880, when: 0.17, a: 0.004, r: 0.35, g: 0.022 }); },
    // engagement
    launch() {
      tone({ f: 2200, a: 0.001, r: 0.02, g: 0.02 });                                           // bay latch
      tone({ f: 85, f1: 38, a: 0.005, h: 0.05, r: 0.3, g: 0.15 });                             // the thump
      noise({ bp: 900, f1filt: 300, q: 1, a: 0.01, h: 0.08, r: 0.28, g: 0.06 });               // interceptor drive lighting
    },
    pd() {
      const k = rnd(0.7, 1.1);
      noise({ hp: 3500, a: 0.001, h: 0.008, r: 0.03, g: 0.045 * k });
      tone({ f: rnd(2400, 3200), f1: 1500, a: 0.001, r: 0.03, g: 0.022 * k });
    },
    hit() { tone({ f: 140, f1: 55, a: 0.003, h: 0.02, r: 0.2, g: 0.11 }); noise({ lp: 500, a: 0.002, r: 0.12, g: 0.07 }); },
    through() {
      noise({ bp: 2600, f1filt: 900, q: 2, a: 0.01, h: 0.12, r: 0.25, g: 0.055 });            // the sizzle of energy on target
      tone({ f: 110, type: 'triangle', lp: 400, a: 0.01, h: 0.1, r: 0.25, g: 0.055 });
      tone({ f: 75, a: 0.01, r: 0.3, g: 0.055 });
    },
    component() { noise({ bp: 1800, f1filt: 600, q: 4, a: 0.002, h: 0.02, r: 0.12, g: 0.05 }); tone({ f: 260, f1: 90, type: 'triangle', lp: 900, a: 0.003, r: 0.16, g: 0.045 }); },
    wreck() {
      noise({ lp: 600, f1filt: 150, a: 0.005, h: 0.05, r: 0.45, g: 0.11 });
      tone({ f: 60, f1: 32, a: 0.005, h: 0.08, r: 0.5, g: 0.13 });
      tone({ f: 420, type: 'triangle', a: 0.002, r: 0.18, g: 0.035, detune: 12 });               // armour letting go
      tone({ f: 517, type: 'triangle', when: 0.03, a: 0.002, r: 0.22, g: 0.025 });
    },
    boom() {
      tone({ f: 48, f1: 22, a: 0.01, h: 0.15, r: 0.9, g: 0.2 });
      noise({ lp: 900, f1filt: 120, a: 0.005, h: 0.12, r: 0.8, g: 0.15 });
      tone({ f: 90, type: 'triangle', lp: 300, a: 0.01, r: 0.5, g: 0.05 });
    },
    boarding() {
      noise({ bp: 700, q: 8, a: 0.002, r: 0.12, g: 0.045 });                                    // clamps
      [220, 277, 330].forEach((f, i) => tone({ f, when: 0.18 + i * 0.24, a: 0.02, h: 0.1, r: i === 2 ? 0.35 : 0.15, g: 0.045 }));
    },
    victory() {
      [392, 494, 587, 784].forEach((f, i) => {
        tone({ f, when: i * 0.17, a: 0.015, h: 0.05, r: i === 3 ? 0.7 : 0.3, g: 0.045 });
        tone({ f: f / 2, type: 'triangle', lp: 800, when: i * 0.17, a: 0.015, r: i === 3 ? 0.7 : 0.25, g: 0.015 });
      });
    },
    defeat() {
      [392, 349, 294, 233].forEach((f, i) => tone({ f, type: 'triangle', lp: 900, when: i * 0.3, a: 0.02, h: 0.1, r: i === 3 ? 1.0 : 0.4, g: 0.045 }));
    },
  };
  const NAMES = ['key', 'open', 'back', 'alert', 'launch', 'incoming', 'pd', 'hit', 'through', 'wreck', 'boom', 'boarding', 'victory', 'defeat', 'tick', 'warp', 'contact', 'confirm', 'comms', 'caution', 'component'];

  function play(name) {
    if (!ready() || hidden() || !CUES[name]) return false;
    try { CUES[name](); stats.played[name] = (stats.played[name] || 0) + 1; return true; } catch (e) { return false; }
  }

  // ---- ambient: a bridge hum and a reactor drone that rises with the selected ship's heat load ----
  function buildAmbient() {
    if (amb || !ctx) return;
    try {
      const t = ctx.currentTime;
      const humGain = ctx.createGain(); humGain.gain.value = 0;
      const humLp = ctx.createBiquadFilter(); humLp.type = 'lowpass'; humLp.frequency.value = 160;
      const hum1 = ctx.createOscillator(); hum1.type = 'sine'; hum1.frequency.value = 50;
      const hum2 = ctx.createOscillator(); hum2.type = 'triangle'; hum2.frequency.value = 100; hum2.detune.value = 5;
      const hum2g = ctx.createGain(); hum2g.gain.value = 0.35;
      hum1.connect(humLp); hum2.connect(hum2g); hum2g.connect(humLp); humLp.connect(humGain); humGain.connect(ambBus);
      const air = ctx.createBufferSource(); air.buffer = noiseBuf; air.loop = true;
      const airLp = ctx.createBiquadFilter(); airLp.type = 'lowpass'; airLp.frequency.value = 220;
      const airGain = ctx.createGain(); airGain.gain.value = 0;
      air.connect(airLp); airLp.connect(airGain); airGain.connect(ambBus);
      const drone = ctx.createOscillator(); drone.type = 'sawtooth'; drone.frequency.value = 36;
      const droneLp = ctx.createBiquadFilter(); droneLp.type = 'lowpass'; droneLp.frequency.value = 90; droneLp.Q.value = 2.5;
      const droneGain = ctx.createGain(); droneGain.gain.value = 0;
      const wob = ctx.createOscillator(); wob.frequency.value = 0.35;                           // a slow breathing on the drone
      const wobGain = ctx.createGain(); wobGain.gain.value = 1.5;
      wob.connect(wobGain); wobGain.connect(drone.frequency);
      drone.connect(droneLp); droneLp.connect(droneGain); droneGain.connect(ambBus);
      hum1.start(t); hum2.start(t); air.start(t, 0.3); drone.start(t); wob.start(t);
      amb = { humGain, airGain, drone, droneLp, droneGain };
    } catch (e) { amb = null; }
  }
  function applyAmbient(force) {
    if (!amb || !ctx) return;
    const level = ambTarget;
    const t = ctx.currentTime;
    if (!force && Math.abs(level - ambApplied) < 0.004 && t - ambAppliedAt < 0.25) return;
    ambApplied = level; ambAppliedAt = t;
    try {
      if (level < 0) {                                                                          // off: fade everything out
        amb.humGain.gain.setTargetAtTime(0, t, 0.6); amb.airGain.gain.setTargetAtTime(0, t, 0.6); amb.droneGain.gain.setTargetAtTime(0, t, 0.6);
        return;
      }
      amb.humGain.gain.setTargetAtTime(0.022, t, 0.8);
      amb.airGain.gain.setTargetAtTime(0.006 + 0.008 * level, t, 0.8);
      amb.drone.frequency.setTargetAtTime(36 + 70 * level, t, 0.7);
      amb.droneLp.frequency.setTargetAtTime(90 + 420 * level * level, t, 0.7);
      amb.droneGain.gain.setTargetAtTime(0.004 + 0.04 * level, t, 0.5);
    } catch (e) { /* closed */ }
  }
  function ambient(level) {
    ambTarget = (level === null || level === undefined || level < 0) ? -1 : (level > 1 ? 1 : +level || 0);
    ambAskedAt = nowMs();
    if (!ready()) return;
    if (!amb) { if (ambTarget < 0) return; buildAmbient(); }
    applyAmbient(false);
  }

  // ---- watch: new log lines and engagement events become cues, throttled so a broadside is a texture ----
  let wSim = null, wLast = null, wSeq = 0, wOutcome = null;   // wLast: the last log line already heard (the log is capped, so a count would stall)
  const last = {};                     // last time (ms) each cue played through watch
  let pdTokens = 6, pdRefillAt = 0;
  const GAP = { alert: 400, caution: 900, incoming: 600, contact: 500, confirm: 400, comms: 350, launch: 150, hit: 250, through: 400, component: 300, wreck: 500, boom: 300, boarding: 800 };
  const nowMs = () => (window.performance && performance.now ? performance.now() : Date.now());

  function cue(name, ms) {
    const gap = GAP[name] || 0;
    if (last[name] !== undefined && ms - last[name] < gap) { stats.dropped++; return false; }
    last[name] = ms;
    return play(name);
  }
  function pdCue(ms) {
    // at most ~6 point-defence cues a second: a token bucket, refilled 6/s
    pdTokens = Math.min(6, pdTokens + (ms - pdRefillAt) * 0.006); pdRefillAt = ms;
    if (pdTokens < 1) { stats.dropped++; return false; }
    pdTokens -= 1;
    return play('pd');
  }
  function logCue(line, ms) {
    const kind = line.kind, sp = line.speaker || '', text = line.text || '';
    if (kind === 'alert') return cue('alert', ms);
    if (kind === 'good') {
      if (sp === 'Marines' && /taken|prize crew/i.test(text)) return cue('boarding', ms);              // a hull changes hands
      return cue('confirm', ms);
    }
    if (kind === 'comms') return cue('comms', ms);
    if (kind === 'warn') {
      if (sp === 'Gunnery' || sp === 'Sensors') {
        if (/incoming|inbound|launched|interceptor|slug/i.test(text)) return cue('incoming', ms);
        if (/contact/i.test(text)) return cue('contact', ms);
      }
      return cue('caution', ms);
    }
    return false;
  }
  const EVENT_CUE = { launch: 'launch', incoming: 'incoming', hit: 'hit', through: 'through', wreck: 'wreck', destroyed: 'boom', component: 'component' };

  function watch(sim) {
    if (!sim) return;
    const log = Array.isArray(sim.log) ? sim.log : null;
    const eng = sim.eng && Array.isArray(sim.eng.events) && sim.eng.eventSeq != null ? sim.eng : null;
    if (wSim !== sim) {                                                                          // a new sim: history is not news
      wSim = sim; wLast = log && log.length ? log[log.length - 1] : null; wSeq = eng ? eng.eventSeq : 0; wOutcome = sim.outcome || null;
      return;
    }
    if (eng && eng.eventSeq < wSeq) wSeq = 0;
    const quiet = !ready() || hidden();
    const ms = nowMs();
    if (log && log.length) {
      // walk back from the tail to the last line heard; a burst (or a lost tail) never replays more than 12 lines
      let from = Math.max(0, log.length - 12);
      if (wLast) for (let i = log.length - 1; i >= from; i--) if (log[i] === wLast) { from = i + 1; break; }
      if (!quiet) for (let i = from; i < log.length; i++) logCue(log[i], ms);
      wLast = log[log.length - 1];
    } else if (log) wLast = null;
    if (eng) {
      const first = eng.eventFirst || (eng.eventSeq - eng.events.length);
      const from = Math.max(wSeq, first, eng.eventSeq - 40);
      if (!quiet) {
        for (let i = from; i < eng.eventSeq; i++) {
          const ev = eng.events[i - first];
          if (!ev) continue;
          if (ev.kind === 'pdkill') pdCue(ms);
          else if (EVENT_CUE[ev.kind]) cue(EVENT_CUE[ev.kind], ms);
        }
      }
      wSeq = eng.eventSeq;
    }
    if (sim.outcome && sim.outcome !== wOutcome) {                                                // the motif the debrief opens on
      wOutcome = sim.outcome;
      if (!quiet) play(sim.outcome === 'victory' ? 'victory' : 'defeat');
    }
  }

  // Plays each cue in sequence (a person auditions; headless is a silent no-op). Returns the names.
  function test(gapMs) {
    const gap = gapMs || 550;
    const seq = NAMES.slice();
    seq.forEach((n, i) => setTimeout(() => play(n), i * gap));
    return seq;
  }

  const Sound = {
    init, unlock, play, ambient, watch, test, setEnabled,
    isEnabled: () => enabled,
    ready,
    ambientLevel: () => ambTarget,
    names: NAMES.slice(),
    stats: () => ({ played: Object.assign({}, stats.played), dropped: stats.dropped }),
    state: () => (broken ? 'unavailable' : ctx ? ctx.state : 'idle'),
  };
  Object.defineProperty(Sound, 'enabled', { get: () => enabled, set: (v) => setEnabled(v), enumerable: true });
  OD.Sound = Sound;
})();
