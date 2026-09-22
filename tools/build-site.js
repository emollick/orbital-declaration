/* Build the deployable copy of the site: node tools/build-site.js <out dir> [source dir]
   Copies index.html, 404.html, robots.txt, manifest.webmanifest, favicon.ico, netlify.toml, js/ and assets/site/, and
   rewrites every <script src="js/x.js"> in the copied index.html to js/x.js?v=<8 hex of sha256>, so the immutable
   cache lifetime netlify.toml gives /js/* can never serve a stale script. The source tree keeps plain script tags. */
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const out = path.resolve(process.argv[2] || 'dist');
const src = path.resolve(process.argv[3] || path.join(__dirname, '..'));
if (out === src) throw new Error('out dir must differ from the source dir');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const copy = (rel) => { const from = path.join(src, rel); if (!fs.existsSync(from)) { console.log('  (missing) ' + rel); return; } fs.cpSync(from, path.join(out, rel), { recursive: true }); };
for (const f of ['index.html', '404.html', 'robots.txt', 'manifest.webmanifest', 'favicon.ico', 'netlify.toml', 'js', 'assets/site']) copy(f);
const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 8);
let html = fs.readFileSync(path.join(out, 'index.html'), 'utf8'), n = 0;
html = html.replace(/<script src="(js\/[\w.-]+\.js)"><\/script>/g, (m, rel) => { n++; return '<script src="' + rel + '?v=' + hash(path.join(out, rel)) + '"></script>'; });
fs.writeFileSync(path.join(out, 'index.html'), html);
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const files = walk(out);
const total = files.reduce((a, f) => a + fs.statSync(f).size, 0);
console.log('built ' + out + ': ' + files.length + ' files, ' + (total / 1024).toFixed(0) + ' KB, ' + n + ' script URLs stamped');
