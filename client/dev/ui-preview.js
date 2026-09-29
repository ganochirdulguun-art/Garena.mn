// UI урьдчилан харах локал сервер (dev only): node dev/ui-preview.js [port]
// renderer хавтсыг үйлчилж, index.html-д socket.io-ийн дараа mock-api.js шигтгэнэ.
const http = require('http');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', 'src', 'renderer');
const PORT = Number(process.argv[2] || 4610);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp' };
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  let p = decodeURIComponent(u.pathname);
  if (p === '/' || p === '/index.html') {
    let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    html = html.replace('<script src="socket.io.min.js"></script>', '<script src="socket.io.min.js"></script>\n  <script src="/dev/mock-api.js"></script>');
    res.writeHead(200, { 'content-type': TYPES['.html'], 'cache-control': 'no-store' });
    return res.end(html);
  }
  const f = p.startsWith('/dev/') ? path.join(__dirname, p.slice(5)) : path.join(ROOT, p);
  if (!f.startsWith(path.join(__dirname, '..'))) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('404'); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(buf);
  });
}).listen(PORT, '127.0.0.1', () => console.log(`UI preview: http://127.0.0.1:${PORT}/`));
