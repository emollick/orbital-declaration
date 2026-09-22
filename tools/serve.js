/* Local static server that applies the headers in netlify.toml, so the built site can be tested the way Netlify serves it.
   node tools/serve.js [dir] [port]   (defaults: the project root, 8787). Missing paths get 404.html with a 404 status. */
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const port = +(process.argv[3] || 8787);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.toml': 'text/plain; charset=utf-8', '.webp': 'image/webp', '.jpg': 'image/jpeg' };

// A small reader for the subset of TOML netlify.toml uses here: [[headers]] blocks with `for` and [headers.values].
function readHeaders(file) {
  if (!fs.existsSync(file)) return [];
  const rules = []; let cur = null, inValues = false;
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line === '[[headers]]') { cur = { for: null, values: {} }; rules.push(cur); inValues = false; continue; }
    if (line === '[headers.values]') { inValues = true; continue; }
    if (line.startsWith('[')) { cur = null; inValues = false; continue; }
    if (!cur) continue;
    const m = line.match(/^([^=]+?)\s*=\s*"(.*)"\s*$/); if (!m) continue;
    if (!inValues && m[1] === 'for') cur.for = m[2]; else if (inValues) cur.values[m[1]] = m[2];
  }
  return rules.map((r) => ({ re: new RegExp('^' + r.for.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$'), values: r.values }));
}
const rules = readHeaders(path.join(root, 'netlify.toml'));

http.createServer((req, res) => {
  // A malformed percent-encoding used to throw out of the whole server (the scan of 2026-09-22): answer 400.
  let p;
  try { p = decodeURIComponent(req.url.split('?')[0]); } catch (e) { res.writeHead(400); return res.end('bad request'); }
  if (p.endsWith('/')) p += 'index.html';
  let file = path.join(root, p);
  if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
  let status = 200;
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { status = 404; file = path.join(root, '404.html'); if (!fs.existsSync(file)) { res.writeHead(404); return res.end('not found'); } }
  const h = { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' };
  for (const r of rules) if (r.re.test(p)) Object.assign(h, r.values);
  res.writeHead(status, h);
  fs.createReadStream(file).pipe(res);
}).listen(port, '127.0.0.1', () => console.log('serving ' + root + ' at http://127.0.0.1:' + port + ' with ' + rules.length + ' header rule(s)'));
