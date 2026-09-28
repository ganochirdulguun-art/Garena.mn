'use strict';
// Ш3 e2e тест (WC3-гүй): жинхэнэ relay.js + клиентийн startLanHost/startLanJoin + хуурамч WC3.
// Шалгах зүйл: (1) шууд mesh холболт, (2) шууд боломжгүй бол relay fallback, (3) хост-талын бичлэг
// relay-д байт тус бүрээрээ ирэх + joiner нэр meta-д, (4) тасраад дахин холбогдоход давхардалгүй үргэлжлэх,
// (5) nocap үед relay давхар бичихгүй, (6) буруу токен/түлхүүр татгалзана.
// Ажиллуулах: node hostbot/test_mesh_lan.js MESH_IP   (Tailscale IP, ж: 100.64.0.1 — энэ машины tailscale ip -4)
const cp = require('child_process');
const net = require('net');
const dgram = require('dgram');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const relay = require(path.join(__dirname, '..', 'client', 'src', 'services', 'gameRelay.js'));

const MESH_IP = process.argv[2] || '100.64.0.1';
const RP = 7081;
const RK = 'rk-e2e';
const CAP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'garena-cap-'));
const keyFor = (g) => crypto.createHmac('sha256', RK).update(g).digest('hex').slice(0, 32);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (n, ok) => { if (ok) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n); } };

function fakeGameInfo() {
  const b = Buffer.alloc(40);
  b[0] = 0xF7; b[1] = 0x30; b.writeUInt16LE(40, 2);
  b.write('GMN-TEST', 20, 'ascii');
  b.writeUInt16LE(6112, 38);
  return b;
}
// W3GS_REQJOIN: F7 1E len hostCounter[4] entryKey[4] ?[1] port[2] peerKey[4] name\0 ...
function reqJoin(name) {
  const n = Buffer.from(name + '\0', 'utf8');
  const b = Buffer.alloc(19 + n.length + 10);
  b[0] = 0xF7; b[1] = 0x1E; b.writeUInt16LE(b.length, 2); n.copy(b, 19);
  return b;
}
// Хуурамч WC3 талын joiner: localPort руу холбогдож REQJOIN + payload илгээнэ, хүлээн авсан бүх байтыг буцаана
function wc3Join(port, name, payload) {
  return new Promise((resolve) => {
    const s = net.connect(port, '127.0.0.1', () => { s.write(reqJoin(name)); setTimeout(() => s.write(payload), 150); });
    let got = Buffer.alloc(0);
    const fin = () => { clearTimeout(to); s.destroy(); resolve(got); };
    const to = setTimeout(fin, 4000);
    s.on('data', (d) => { got = Buffer.concat([got, d]); if (got.includes(Buffer.from('HOSTECHO:' + payload))) setTimeout(fin, 200); });
    s.on('error', () => { clearTimeout(to); resolve(got); });
  });
}
function rawHandshake(ip, port, obj) {   // хариу ирэх эсвэл хаагдахыг хүлээнэ
  return new Promise((resolve) => {
    const s = net.connect(port, ip, () => s.write(JSON.stringify(obj) + '\nPING'));
    let got = ''; let closed = false;
    const to = setTimeout(() => { s.destroy(); resolve({ got, closed }); }, 1500);
    s.on('data', (d) => { got += d.toString(); });
    s.on('close', () => { closed = true; clearTimeout(to); resolve({ got, closed }); });
    s.on('error', () => {});
  });
}
const capFiles = (g) => fs.readdirSync(CAP_DIR).filter((f) => f.startsWith(g + '-') && f.endsWith('.w3gs'));

async function main() {
  let relayOut = '';
  const relayProc = cp.spawn(process.execPath, [path.join(__dirname, 'relay.js')], {
    env: { ...process.env, RELAY_PORT: String(RP), RELAY_KEY: 'test', PUBLIC_IP: '127.0.0.1', RELAY_CAPTURE: '1',
           RELAY_CAPTURE_DIR: CAP_DIR, RELAY_REPORT_KEY: RK, HOSTCAP_IDLE_MS: '8000', RELAY_REPORT_URL: '' },
    stdio: ['ignore', 'pipe', 'pipe'] });
  relayProc.stdout.on('data', (d) => { relayOut += d.toString(); });
  relayProc.stderr.on('data', (d) => { relayOut += d.toString(); });
  await sleep(900);

  // Хуурамч WC3 хост (UDP GAMEINFO + TCP echo)
  const GI = fakeGameInfo();
  const hostUdp = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  hostUdp.on('message', (msg, rinfo) => { if (msg[0] === 0xF7 && msg[1] === 0x2F) { try { hostUdp.send(GI, rinfo.port, rinfo.address); } catch {} } });
  await new Promise((r) => hostUdp.bind(6112, '0.0.0.0', r));
  const hostTcp = net.createServer((s) => { s.on('data', (d) => { try { s.write(Buffer.concat([Buffer.from('HOSTECHO:'), d])); } catch {} }); s.on('error', () => {}); });
  await new Promise((r) => hostTcp.listen(6112, '127.0.0.1', r));

  console.log('=== Тест 1: хост (mesh listener + host-capture) ===');
  const G = 'g3e2e';
  const hr = relay.startLanHost({ relayIp: '127.0.0.1', relayPort: RP, game: G, relayKey: 'test', wc3Name: 'Host',
                                  meshIp: MESH_IP, capture: { ip: '127.0.0.1', port: RP, key: keyFor(G) }, onGameInfo: () => {} });
  check('startLanHost direct буцаав ' + JSON.stringify(hr && hr.direct), hr && hr.direct && hr.direct.ip === MESH_IP && hr.direct.port === 7000);
  await sleep(1500);
  const bad = await rawHandshake(MESH_IP, 7000, { t: 'joiner', game: 'WRONG' });
  check('mesh listener буруу токеныг хаана', bad.closed && !bad.got.includes('HOSTECHO'));

  console.log('=== Тест 2: joiner ШУУД (mesh) ===');
  const before = relayOut.length;
  relay.startLanJoin({ relayIp: '127.0.0.1', relayPort: RP, game: G, gameInfoB64: GI.toString('base64'), localPort: 6251,
                       endpoints: [{ type: 'direct', ip: MESH_IP, port: 7000 }, { type: 'relay', ip: '127.0.0.1', port: RP }] });
  await sleep(2000);   // probe
  const got1 = await wc3Join(6251, 'JoinerOne', 'PING-D');
  check('WC3→шууд mesh→хост echo', got1.includes(Buffer.from('HOSTECHO:PING-D')));
  check('relay-ээр ДАМЖААГҮЙ (relay лог-д joiner алга)', !relayOut.slice(before).includes('joiner ирлээ game=' + G));
  relay.stopLanJoin();
  await sleep(500);

  console.log('=== Тест 3: шууд боломжгүй → relay fallback ===');
  const before2 = relayOut.length;
  relay.startLanJoin({ relayIp: '127.0.0.1', relayPort: RP, game: G, gameInfoB64: GI.toString('base64'), localPort: 6252,
                       endpoints: [{ type: 'direct', ip: '100.64.0.250', port: 7000 }, { type: 'relay', ip: '127.0.0.1', port: RP }] });
  await sleep(2200);
  const got2 = await wc3Join(6252, 'JoinerTwo', 'PING-R');
  check('WC3→relay→хост echo (fallback)', got2.includes(Buffer.from('HOSTECHO:PING-R')));
  check('relay-ээр дамжсан', relayOut.slice(before2).includes('joiner ирлээ game=' + G));
  relay.stopLanJoin();
  await sleep(500);

  console.log('=== Тест 4: хост зогсоход бичлэг relay-д ирэх ===');
  relay.stopLanHost();
  await sleep(1500);
  const files = capFiles(G);
  check('ЯГ 1 бичлэг (nocap → relay давхар бичээгүй): ' + files.length, files.length === 1);
  if (files.length) {
    const body = fs.readFileSync(path.join(CAP_DIR, files[0]));
    const expect = Buffer.concat([got1, got2]);
    check(`бичлэг = joiner-уудын хүлээн авсан байт (${body.length}/${expect.length})`, body.equals(expect));
    const metaP = path.join(CAP_DIR, files[0] + '.meta.json');
    const meta = fs.existsSync(metaP) ? JSON.parse(fs.readFileSync(metaP, 'utf8')) : null;
    check('meta.json: ' + JSON.stringify(meta && meta.joiners), meta && Object.values(meta.joiners).includes('JoinerOne') && Object.values(meta.joiners).includes('JoinerTwo') && meta.bytes === expect.length);
  }

  console.log('=== Тест 5: тасраад дахин холбогдох (offset resume) ===');
  const G2 = 'g4resume';
  const hc = relay._createHostCapture({ ip: '127.0.0.1', port: RP, key: keyFor(G2), game: G2 });
  const wc3 = new EventEmitter(), js = new EventEmitter();
  hc.attach(wc3, 's1', js, reqJoin('ResumeGuy'));
  const A = crypto.randomBytes(300 * 1024), B = crypto.randomBytes(200 * 1024), C = crypto.randomBytes(50 * 1024);
  await sleep(400);
  wc3.emit('data', A);
  await sleep(20);
  try { hc.sock.destroy(); } catch {}          // тасалдал (зарим байт relay-д хүрээгүй байж болно)
  wc3.emit('data', B);                          // тасарсан үед ирсэн өгөгдөл
  await sleep(3800);                            // 3с retry
  wc3.emit('data', C);
  await sleep(300);
  hc.end();
  await sleep(1200);
  const f2 = capFiles(G2);
  check('resume бичлэг 1 файл', f2.length === 1);
  if (f2.length) {
    const body = fs.readFileSync(path.join(CAP_DIR, f2[0]));
    check(`resume: давхардал/алдагдалгүй (${body.length}/${A.length + B.length + C.length})`, body.equals(Buffer.concat([A, B, C])));
    const meta = JSON.parse(fs.readFileSync(path.join(CAP_DIR, f2[0] + '.meta.json'), 'utf8'));
    check('resume meta joiner нэр', meta.joiners.s1 === 'ResumeGuy' && meta.primarySid === 's1');
  }
  check('relay reconnect-ийг бүртгэсэн', (relayOut.match(/host-capture эхлэв game=g4resume/g) || []).length === 1);

  console.log('=== Тест 6: capture буруу түлхүүр ===');
  const badCap = await rawHandshake('127.0.0.1', RP, { t: 'capture', game: 'gX', key: 'x'.repeat(32) });
  check('буруу key татгалзав', badCap.closed && !badCap.got.includes('capture_ok'));

  try { relayProc.kill(); } catch {}
  await new Promise((r) => hostUdp.close(r));
  await new Promise((r) => hostTcp.close(r));
  try { fs.rmSync(CAP_DIR, { recursive: true, force: true }); } catch {}
  console.log('=== ДҮН: ' + pass + ' PASS, ' + fail + ' FAIL ===');
  if (fail) console.log('--- relay лог ---\n' + relayOut.split('\n').slice(-40).join('\n'));
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(2); });
setTimeout(() => { console.log('TIMEOUT'); process.exit(3); }, 40000);
