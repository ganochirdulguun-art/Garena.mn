// Relay capture гинжийн локал тест (Алхам 1–3): host control → joiner (REQJOIN нэртэй) → hostdata splice →
// capture файл + meta.json (joiner нэр, primary sid) → host салахад reportGame.js тусдаа процесс POST хийнэ.
// Хэрэглээ: node test_capture.js   (relay-г өөрөө test порт дээр асаана, 8 сек)
'use strict';
const net = require('net');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const PORT = 17123;
const CAP_DIR = path.join(os.tmpdir(), 'garena-cap-test-' + Date.now());
let pass = 0, fail = 0;
const chk = (n, c) => { if (c) { pass++; console.log('PASS ' + n); } else { fail++; console.log('FAIL ' + n); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// REQJOIN: F7 1E len hostCounter[4] entryKey[4] ?[1] port[2] peerKey[4] name\0 ?[4] ip[16]
function reqjoin(name) {
  const nm = Buffer.from(name + '\0', 'utf8');
  const body = Buffer.concat([Buffer.alloc(4), Buffer.alloc(4), Buffer.alloc(1), Buffer.alloc(2), Buffer.alloc(4), nm, Buffer.alloc(4), Buffer.alloc(16)]);
  const p = Buffer.alloc(4 + body.length); p[0] = 0xF7; p[1] = 0x1E; p.writeUInt16LE(p.length, 2); body.copy(p, 4);
  return p;
}
function connectLine(obj) {
  return new Promise((resolve, reject) => {
    const s = net.connect({ host: '127.0.0.1', port: PORT }, () => { s.write(JSON.stringify(obj) + '\n'); resolve(s); });
    s.on('error', reject);
  });
}

(async () => {
  // Хуурамч платформ сервер — reportGame-ийн POST-ыг барина
  let posted = null;
  const api = http.createServer((req, res) => {
    let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => { posted = { url: req.url, key: req.headers['x-relay-key'], body: JSON.parse(b || '{}') }; res.end('{"ok":true}'); });
  });
  await new Promise((r) => api.listen(0, '127.0.0.1', r));
  const apiPort = api.address().port;

  const relay = spawn(process.execPath, [path.join(__dirname, 'relay.js')], {
    env: { ...process.env, RELAY_PORT: String(PORT), RELAY_KEY: '', RELAY_CAPTURE: '1', RELAY_CAPTURE_DIR: CAP_DIR,
           RELAY_REPORT_URL: `http://127.0.0.1:${apiPort}`, RELAY_REPORT_KEY: 'test-relay-key' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let rlog = '';
  relay.stdout.on('data', (d) => (rlog += d)); relay.stderr.on('data', (d) => (rlog += d));
  await sleep(600);

  const game = 'testgame0123456789abcdef0123456789abcdef';
  const control = await connectLine({ t: 'register', game, name: 'HostName' });
  let sid = null;
  control.on('data', (d) => { for (const line of String(d).split('\n')) { try { const m = JSON.parse(line); if (m.t === 'newjoiner') sid = m.session; } catch {} } });
  await sleep(200);
  // Joiner: handshake + REQJOIN нэг chunk-д (leftover-оор ирнэ)
  const joiner = net.connect({ host: '127.0.0.1', port: PORT }, () => {
    joiner.write(Buffer.concat([Buffer.from(JSON.stringify({ t: 'joiner', game }) + '\n'), reqjoin('TestJoiner')]));
  });
  let joinerGot = Buffer.alloc(0); joiner.on('data', (d) => (joinerGot = Buffer.concat([joinerGot, d])));
  await sleep(400);
  chk('newjoiner ирсэн', sid != null);
  const hostdata = await connectLine({ t: 'hostdata', game, session: sid });
  let hostGot = Buffer.alloc(0); hostdata.on('data', (d) => (hostGot = Buffer.concat([hostGot, d])));
  await sleep(300);
  // host→joiner: хуурамч W3GS пакет (F7 0C len sendInterval) ×3
  const pkt = Buffer.from([0xF7, 0x0C, 0x06, 0x00, 0x64, 0x00]);
  hostdata.write(Buffer.concat([pkt, pkt, pkt]));
  joiner.write(Buffer.from('JOINER-DATA'));
  await sleep(400);
  chk('splice: joiner хостын байтыг авсан', joinerGot.length >= 18);
  chk('splice: host joiner-ийн REQJOIN + өгөгдлийг авсан', hostGot.includes(Buffer.from('TestJoiner')) && hostGot.includes(Buffer.from('JOINER-DATA')));
  // Тоглоом дуусав: host control хаагдана → capFinalize → meta + reportGame
  control.destroy();
  await sleep(2500);
  const files = fs.existsSync(CAP_DIR) ? fs.readdirSync(CAP_DIR) : [];
  const cap = files.find((f) => f.endsWith('.w3gs'));
  chk('capture файл бий', !!cap);
  const bytes = cap ? fs.statSync(path.join(CAP_DIR, cap)).size : 0;
  chk('capture = 18 байт (3 пакет)', bytes === 18);
  let meta = null; try { meta = JSON.parse(fs.readFileSync(path.join(CAP_DIR, cap + '.meta.json'), 'utf8')); } catch {}
  chk('meta.json: joiner нэр REQJOIN-оос уншсан', !!meta && meta.joiners && meta.joiners[String(sid)] === 'TestJoiner');
  chk('meta.json: primarySid = ' + sid, !!meta && String(meta.primarySid) === String(sid));
  chk('reportGame POST ирсэн (x-relay-key зөв, url /relay/game-stats)', !!posted && posted.url === '/relay/game-stats' && posted.key === 'test-relay-key');
  chk('payload: game_token + joiners + winner=null (хуурамч урсгал)', !!posted && posted.body.game_token === game && posted.body.joiners[String(sid)] === 'TestJoiner' && posted.body.winner === null);
  chk('relay лог: joiner нэр + report илгээгч', /joiner нэр sid=\d+ name=TestJoiner/.test(rlog) && /report илгээгч эхлүүлэв/.test(rlog));
  relay.kill(); api.close();
  try { fs.rmSync(CAP_DIR, { recursive: true, force: true }); } catch {}
  console.log(`\n=== capture гинж: ${pass} PASS, ${fail} FAIL ===`);
  if (fail) console.log('--- relay лог ---\n' + rlog.slice(-1500));
  process.exit(fail ? 1 : 0);
})();
