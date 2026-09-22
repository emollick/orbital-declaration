/* Headless checks for OD.Sound: no-op without WebAudio, cues and throttling with it.
   NODE_PATH=/opt/node22/lib/node_modules node tools/sound-check.js */
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const page_url = 'file://' + path.join(ROOT, 'tools', 'sound-preview.html');
let failures = 0;
function check(name, ok, detail) { console.log((ok ? '  ok   ' : '  FAIL ') + name + (detail ? '  ' + detail : '')); if (!ok) failures++; }

(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });

  console.log('scenario: no AudioContext at all');
  {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(() => { delete window.AudioContext; delete window.webkitAudioContext; });
    await page.goto(page_url);
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => {
      const S = OD.Sound; const out = {};
      try {
        S.init(); S.unlock(); out.play = S.play('alert'); S.ambient(0.5); S.watch({ log: [{ kind: 'alert' }], eng: { events: [], eventSeq: 0 } }); S.watch({ log: [], eng: { events: [], eventSeq: 0 } });
        S.test(1); S.setEnabled(false); S.setEnabled(true); out.state = S.state(); out.enabled = S.enabled; out.ok = true;
      } catch (e) { out.err = e.message; }
      return out;
    });
    check('every public call is a no-op without throwing', r.ok && r.play === false && r.state === 'unavailable', JSON.stringify(r));
    check('no page errors', errors.length === 0, errors.join(' | '));
    await page.close();
  }

  console.log('scenario: cues and throttling with WebAudio');
  {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(page_url);
    await page.mouse.click(200, 200);
    await page.waitForTimeout(400);
    const r = await page.evaluate(async () => {
      const S = OD.Sound; const out = {};
      S.unlock();
      await new Promise((r) => setTimeout(r, 150));
      out.state = S.state();
      out.ready = S.ready();
      out.names = S.names.length;
      out.playAll = S.names.map((n) => S.play(n)).every(Boolean);
      const sim = { log: [{ kind: 'alert', text: 'old', speaker: 'Command' }], eng: { events: [], eventSeq: 0, eventFirst: 0 } };
      const before = S.stats().played.alert || 0;
      S.watch(sim); S.watch(sim);                                  // history is not news
      out.historySilent = (S.stats().played.alert || 0) === before;
      const emit = (kind) => { sim.eng.events.push({ t: 0, kind, x: 0, y: 0, shipId: 'a', fromId: 'b', text: '' }); sim.eng.eventSeq++; while (sim.eng.events.length > 200) { sim.eng.events.shift(); sim.eng.eventFirst++; } };
      const pd0 = S.stats().played.pd || 0, hit0 = S.stats().played.hit || 0;
      for (let i = 0; i < 40; i++) emit('pdkill');
      for (let i = 0; i < 10; i++) emit('hit');
      S.watch(sim);
      out.pd = (S.stats().played.pd || 0) - pd0;
      out.hit = (S.stats().played.hit || 0) - hit0;
      // ring rollover: 300 events through a 200-slot ring, read by index
      const boom0 = S.stats().played.boom || 0;
      for (let i = 0; i < 300; i++) emit(i === 299 ? 'destroyed' : 'component');
      S.watch(sim);
      out.boomAfterRoll = (S.stats().played.boom || 0) - boom0;
      // log routing
      const c0 = S.stats().played.contact || 0, inc0 = S.stats().played.incoming || 0, g0 = S.stats().played.confirm || 0, cm0 = S.stats().played.comms || 0;
      sim.log.push({ kind: 'warn', speaker: 'Sensors', text: 'Contact: ISA Sabre at 400 km.' });
      sim.log.push({ kind: 'warn', speaker: 'Gunnery', text: 'Sabre has launched 4 interceptors at Larkspur.' });
      sim.log.push({ kind: 'good', speaker: 'Command', text: 'Objective complete.' });
      sim.log.push({ kind: 'comms', speaker: 'Meridian', text: 'Holding.' });
      S.watch(sim);
      out.log = [(S.stats().played.contact || 0) - c0, (S.stats().played.incoming || 0) - inc0, (S.stats().played.confirm || 0) - g0, (S.stats().played.comms || 0) - cm0];
      S.ambient(0.2); S.ambient(0.9); S.ambient(-1); S.ambient(0.4);
      S.setEnabled(false); out.offPlay = S.play('key'); let stored = null; try { stored = localStorage.getItem('od.sound'); } catch (e) { stored = 'n/a'; }
      out.stored = stored; S.setEnabled(true);
      out.onPlay = S.play('key');
      return out;
    });
    check('context running after a gesture', r.state === 'running' && r.ready, r.state);
    check('every named cue plays', r.playAll && r.names >= 17, String(r.names));
    check('history on a new sim is silent', r.historySilent);
    check('40 point-defence kills become at most 7 pd cues', r.pd >= 1 && r.pd <= 7, String(r.pd));
    check('10 hits in one frame become one hit cue', r.hit === 1, String(r.hit));
    check('events read by index survive ring rollover', r.boomAfterRoll === 1, String(r.boomAfterRoll));
    check('log kinds route to contact / incoming / confirm / comms', r.log.join() === '1,1,1,1', r.log.join());
    check('disabled plays nothing and persists', r.offPlay === false && (r.stored === '0' || r.stored === 'n/a') && r.onPlay === true, JSON.stringify([r.offPlay, r.stored, r.onPlay]));
    check('no page errors', errors.length === 0, errors.join(' | '));
    await page.close();
  }

  console.log('scenario: capped log, outcome motifs and a self-expiring ambient (bare page: no preview loop driving watch/ambient)');
  {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('about:blank');
    await page.addScriptTag({ path: path.join(ROOT, 'js', 'sound.js') });
    await page.evaluate(() => { OD.Sound.init(); });
    await page.mouse.click(100, 100);
    await page.waitForTimeout(300);
    const r = await page.evaluate(async () => {
      const S = OD.Sound; const out = {};
      S.unlock();
      await new Promise((r) => setTimeout(r, 150));
      out.ready = S.ready();
      const sim = { log: [], eng: { events: [], eventSeq: 0, eventFirst: 0 }, outcome: null };
      S.watch(sim);
      // capped log: sim.addLog shifts past 400 lines, so the length stops moving but new lines must still cue
      while (sim.log.length < 400) sim.log.push({ kind: 'info', speaker: '', text: 'filler' });
      S.watch(sim);
      const cap0 = S.stats().played.contact || 0;
      for (let i = 0; i < 3; i++) { sim.log.push({ kind: 'warn', speaker: 'Sensors', text: 'Contact: new hostile.' }); sim.log.shift(); S.watch(sim); await new Promise((r) => setTimeout(r, 520)); }
      out.cappedLog = (S.stats().played.contact || 0) - cap0;
      // a quiet frame in between must not replay the tail
      const c1 = S.stats().played.contact || 0; S.watch(sim); S.watch(sim); out.noReplay = (S.stats().played.contact || 0) === c1;
      // outcome motifs and boarding
      const v0 = S.stats().played.victory || 0, d0 = S.stats().played.defeat || 0, b0 = S.stats().played.boarding || 0;
      sim.log.push({ kind: 'good', speaker: 'Marines', text: 'ISA Sabre has been taken. Prize crew aboard.' }); sim.log.shift();
      S.watch(sim);
      sim.outcome = 'victory'; S.watch(sim); S.watch(sim);
      out.victory = (S.stats().played.victory || 0) - v0;
      out.boarding = (S.stats().played.boarding || 0) - b0;
      const sim2 = { log: [], eng: { events: [], eventSeq: 0, eventFirst: 0 }, outcome: null };
      S.watch(sim2); sim2.outcome = 'defeat'; S.watch(sim2);
      out.defeat = (S.stats().played.defeat || 0) - d0;
      const sim3 = { log: [], eng: { events: [], eventSeq: 0, eventFirst: 0 }, outcome: 'victory' };   // a sim seen first with its outcome set: not news
      S.watch(sim3); S.watch(sim3);
      out.victoryHistory = (S.stats().played.victory || 0) - v0;
      // ambient expires on its own once the bridge stops asking (debrief, menu), and comes back when asked
      S.ambient(0.5); out.ambAsked = S.ambientLevel();
      await new Promise((r) => setTimeout(r, 900));
      S.ambient(0.5); out.ambHeld = S.ambientLevel();                                          // still asked: still on
      await new Promise((r) => setTimeout(r, 2300));
      out.ambExpired = S.ambientLevel();
      S.ambient(0.3); out.ambBack = S.ambientLevel();
      return out;
    });
    check('context running on a bare page', r.ready === true, JSON.stringify(r));
    check('a capped log still cues new lines', r.cappedLog === 3 && r.noReplay, JSON.stringify([r.cappedLog, r.noReplay]));
    check('victory and defeat motifs play once per outcome', r.victory === 1 && r.defeat === 1 && r.victoryHistory === 1, JSON.stringify([r.victory, r.defeat, r.victoryHistory]));
    check('a Marines capture line plays boarding', r.boarding === 1, String(r.boarding));
    check('ambient expires when nobody asks, resumes when asked', r.ambAsked === 0.5 && r.ambHeld === 0.5 && r.ambExpired === -1 && r.ambBack === 0.3, JSON.stringify([r.ambAsked, r.ambHeld, r.ambExpired, r.ambBack]));
    check('no page errors', errors.length === 0, errors.join(' | '));
    await page.close();
  }

  await browser.close();
  console.log(failures ? failures + ' check(s) failed' : 'all sound checks passed');
  process.exit(failures ? 1 : 0);
})();
