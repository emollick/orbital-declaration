# Orbital Declaration

A hard science fiction space combat game that runs in the browser. Ships move under Newtonian motion and the rocket equation, so every burn costs delta-v that does not come back. The drive and the mounts heat a sink that only the radiators empty. A full sink holds the drive to a quarter and stops every mount until it drains. Every hull radiates and every sensor can see it, so there is no stealth in space. In 2211 the moons of Jupiter sign the Declaration and leave the Inner Systems Authority. You fight for the Jovian Compact through eight story chapters, a campaign across eleven places around Jupiter, skirmishes you set up yourself, and a yard where you design your own ships.

Play it at https://orbital-declaration.netlify.app.

The physics follows Atomic Rockets (Project Rho): https://projectrho.com/public_html/rocket/. Where the game and that site disagree, the game has a bug.

## Play it locally

The game is plain JavaScript and Canvas 2D. There is nothing to build or install before you play it.

- Open `index.html` in a browser. Everything loads from the tree. Chromium logs two blocked font preloads on a `file://` page. The fonts still load through `@font-face`, so ignore them.
- Or serve it the way the live site is served: run `node tools/serve.js` and open http://127.0.0.1:8787/. The server applies the headers from `netlify.toml`, including the Content-Security-Policy, so a change that would break on the live site breaks here first. The script takes a directory and a port, so `node tools/serve.js . 8790` serves the tree on 8790 when 8787 is taken. Needs Node 18 or newer.

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

`tools/harness.js` runs thirteen scenarios: page load, chapter 1 to its end, clicks and orders on the map and the panel, the physics panel, a skirmish at Ganymede, the chapter 5 chase, a campaign battle, every chapter for 120 s, a corvette beam duel at 250 km, a destroyer against a lancer and a corvette at 400 km, fire control and point defence through to the damage report, sensors and decisions, and damage control and crew. It runs 86 checks along the way, prints `ok` or `FAIL` for each, and exits with code 1 when any fail. Set `OD_URL=http://127.0.0.1:8787/` to run it against a served copy instead of the file tree.

Each check script covers one part of the game. A module the table does not name has no script of its own. Each runs the same way as the harness, and all but `sound-check.js` take `OD_URL` too. That one loads its own page, `tools/sound-preview.html`, from the tree.

| Script | What it checks |
| --- | --- |
| `tools/autopilot-check.js` | an order becomes a heading and a burn, and the AI picks orders (OD.Autopilot, OD.AI) |
| `tools/engagement-check.js` | mount readouts and reach with no target, no bay, no beam and no point defence |
| `tools/damage-check.js` | component damage and jury-rig repairs (OD.Damage) |
| `tools/crew-check.js` | crew parties, where they are sent, and what g does to them (OD.Crew) |
| `tools/sensors-check.js` | sensors, signature and track quality (OD.Sensors) |
| `tools/decisions-check.js` | the decision cards appear at the right moment and say the right thing (OD.Decisions) |
| `tools/objectives-check.js` | a hostile that breaks off and runs counts as driven off (OD.Sim) |
| `tools/bridge-check.js` | the console flow: situation screen, brief, hangar, refit, keyboard |
| `tools/main-check.js` | the game shell: debrief, pause, skirmish board, refit ledger |
| `tools/sound-check.js` | the cues and their throttling, and that every call is a no-op without WebAudio (OD.Sound) |
| `tools/art-check.js` | at close zoom the ship art shows mounts firing, interceptors away, point defence up, a holed tank venting and a repair party at work (OD.ShipArt) |
| `tools/bridge-shots.js` | screenshots into `tools/bridge-shots/`: every console screen but the situation screen at 1440×900, and the menu, a briefing, the skirmish board and the hangar at 390×844. Fails when a click does not navigate |

## Deploy

`node tools/build-site.js dist` copies the files the site needs into `dist/` and stamps every script URL with a content hash. A script that changes gets a new URL, so the one-year cache lifetime for `/js/*` in `netlify.toml` can never serve a stale script. `node tools/serve.js dist` serves the copy for a last look. The live site is the Netlify site `orbital-declaration`. It is deployed from that copy with the Netlify deploy tools, not built by Netlify from this repository: `netlify.toml` has no build command, so a site linked straight to the repository would publish the source tree with unstamped script URLs under that one-year cache.

## Files

- `index.html`: the page, its styles and the script list. Everything hangs off `window.OD`.
- `SPEC.md`: the module contract and the design record. For each version it says what was added, what the reviewers found and what changed.
- `js/`: 22 scripts, loaded in this order.
  - `util.js`: helpers. SI units everywhere, formatting only at the display edge.
  - `physics.js`: the rocket equation, gravity, beam spot size, slug flight time, and the heat balance behind every radiator number.
  - `ships.js`: the hull classes and their numbers.
  - `autopilot.js`: turns an order into a heading and a throttle. Ships thrust only along the nose.
  - `ai.js`: computer-controlled ships choose orders. The autopilot flies them.
  - `guide.js`: the planner and the navigator. Runs an order ahead with the real autopilot and says what will happen in plain words.
  - `damage.js`: component damage. A hit opens hull integrity and then lands on one part: the drive, the reactor, the sensors, a radiator panel, a tank or a mount.
  - `crew.js`: the crew as parties you deploy, and what acceleration does to people.
  - `sensors.js`: sensors and signature. Every hull radiates, and its power over range squared decides how good a track is.
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
- `assets/ships/src/`: the ship art source. `core.js` is the renderer, every other script is one hull family, and its `README.md` says how a family is written. `sh assets/ships/build.sh` (from the repository root) concatenates them, core first, into `js/shipart.js` and loads the result in Node before replacing the file. `assets/ships/renders/` holds rendered views of every hull.
- `assets/site/`: icons, the social card and the self-hosted fonts.
- `assets/configurator/shots/`: screenshots of the yard.
- `tools/`: the harness, the check scripts, the local server, the site build, the renderer for the icons and the social card (`site-render.html` with `site-render.js`, run headlessly), and three preview pages you open in a browser while working on a module: `shipart-preview.html` for the ship art, `configurator-preview.html` for the yard, `sound-preview.html` for the sound.
- `404.html`, `manifest.webmanifest`, `robots.txt`, `favicon.ico`, `netlify.toml`: hosting.

## License

MIT, see `LICENSE`. The fonts in `assets/site/fonts/` (Rajdhani, IBM Plex Mono, IBM Plex Sans) are under the SIL Open Font License 1.1, see https://openfontlicense.org. The tree carries the subsetted font files only, not the licence text.
