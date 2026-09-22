# Orbital Declaration

A hard science fiction space combat game that runs in the browser. Ships move under Newtonian motion and the rocket equation, so every burn costs delta-v that does not come back. Heat has to go somewhere, and there is no stealth in space. In 2211 the moons of Jupiter sign the Declaration and leave the Inner Systems Authority. You fight for the Jovian Compact through eight story chapters, a campaign across eleven places around Jupiter, skirmishes you set up yourself, and a yard where you design your own ships.

Play it at https://orbital-declaration.netlify.app.

The physics follows Atomic Rockets (Project Rho): https://projectrho.com/public_html/rocket/. Where the game and that site disagree, the game has a bug.

## Play it locally

The game is plain JavaScript and Canvas 2D. There is no build step and nothing to install.

- Open `index.html` in a browser. Everything loads from the tree.
- Or serve it the way the live site is served: run `node tools/serve.js` and open http://127.0.0.1:8787/. The server applies the headers from `netlify.toml`, including the Content-Security-Policy, so a change that would break on the live site breaks here first. Needs Node 18 or newer.

## Run the checks

The checks drive the game headlessly in Chromium through Playwright. Install Playwright once:

```
npm install -g playwright
npx playwright install chromium
```

Run the playtests from the repository root. `NODE_PATH` points Node at the global modules directory where Playwright is installed:

```
NODE_PATH=$(npm root -g) node tools/harness.js
```

`tools/harness.js` loads the page, plays chapter 1 to its end, clicks and orders through the map and the panel, and runs 86 checks on what it sees. It prints `ok` or `FAIL` for each and exits with code 1 when any fail. Set `OD_URL=http://127.0.0.1:8787/` to run it against a served copy instead of the file tree.

One check script covers each module. Each runs the same way as the harness.

| Script | What it checks |
| --- | --- |
| `tools/autopilot-check.js` | an order becomes a heading and a burn; the AI picks orders (OD.Autopilot, OD.AI) |
| `tools/engagement-check.js` | mount readouts and reach with no target, no bay, no beam and no point defence |
| `tools/damage-check.js` | component damage and jury-rig repairs (OD.Damage) |
| `tools/crew-check.js` | crew parties, where they are sent, and what g does to them (OD.Crew) |
| `tools/sensors-check.js` | sensors, signature and track quality (OD.Sensors) |
| `tools/decisions-check.js` | the decision cards appear at the right moment and say the right thing (OD.Decisions) |
| `tools/objectives-check.js` | a hostile that breaks off and runs counts as driven off (OD.Sim) |
| `tools/bridge-check.js` | the console flow: situation screen, brief, hangar, refit, keyboard |
| `tools/main-check.js` | the game shell: debrief, pause, skirmish board, refit ledger |
| `tools/sound-check.js` | sound cues, and silence without WebAudio (OD.Sound) |
| `tools/art-check.js` | at close zoom the ship art shows what the ship is doing |
| `tools/bridge-shots.js` | screenshots of every console screen at 1440×900 and 390×844 |

## Deploy

`node tools/build-site.js dist` copies the files the site needs into `dist/` and stamps every script URL with a content hash. That is what makes the one-year cache lifetime for `/js/*` in `netlify.toml` safe. `node tools/serve.js dist` serves the copy for a last look. The live site is the Netlify site `orbital-declaration`, published from that copy.

## Files

- `index.html`: the page, its styles and the script list. Everything hangs off `window.OD`.
- `SPEC.md`: the module contract and the design record: each version, what it added, what the reviewers found and what changed.
- `js/`: 22 scripts, loaded in this order.
  - `util.js`: helpers. SI units everywhere, formatting only at the display edge.
  - `physics.js`: the rocket equation, gravity, beam spot size, slug flight time, and the heat balance behind every radiator number.
  - `ships.js`: the hull classes and their numbers.
  - `autopilot.js`: turns an order into a heading and a throttle. Ships thrust only along the nose.
  - `ai.js`: computer-controlled ships choose orders. The autopilot flies them.
  - `guide.js`: the planner and the navigator. Runs an order ahead with the real autopilot and says what will happen in plain words.
  - `damage.js`: component damage. A hit takes out a part, not a bar.
  - `crew.js`: the crew as parties you deploy, and what acceleration does to people.
  - `sensors.js`: sensors and signature. Every hull radiates, and range decides how good a track is.
  - `sim.js`: the simulation core. Motion under one gravitating body, heat, boarding, objectives, triggers.
  - `shipart.js`: procedural ship art. Built, never edited by hand (see below).
  - `render.js`: the Canvas 2D renderer.
  - `ui.js`: the HUD, tooltips, the physics panel and the DOM screens.
  - `sound.js`: sound, all of it synthesised with WebAudio.
  - `bridge.js`: the bridge console. The menus are drawn on the tactical canvas.
  - `story.js`: the eight chapters.
  - `campaign.js`: the Jovian campaign. Eleven places, a fleet that persists, turns.
  - `skirmish.js`: skirmish setup.
  - `engagement.js`: what the mounts do to a hull. Beams, coilgun slugs, interceptors and point defence.
  - `decisions.js`: the decision cards. The trade-offs in the sim, put to the player as a choice.
  - `configurator.js`: the yard. Every choice moves the numbers and the picture.
  - `main.js`: the game shell. The loop, input and the modes.
- `assets/ships/src/`: the ship art source, one file per hull family. `assets/ships/build.sh` concatenates them into `js/shipart.js`. `assets/ships/renders/` holds rendered views of every hull.
- `assets/site/`: icons, the social card and the self-hosted fonts.
- `assets/configurator/shots/`: screenshots of the yard.
- `tools/`: the harness, the check scripts, the local server, the site build and the icon renderer.
- `404.html`, `manifest.webmanifest`, `robots.txt`, `favicon.ico`, `netlify.toml`: hosting.

## License

MIT, see `LICENSE`. The fonts in `assets/site/fonts/` (Rajdhani, IBM Plex Mono, IBM Plex Sans) are under the SIL Open Font License 1.1.
