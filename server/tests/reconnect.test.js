'use strict';
// Reconnect (GProxy++ маяг, 2026-10-10): бодит hostbot/relay.js процесс + бодит клиентийн gameRelay.js (хост ба joiner тал) +
// хуурамч WC3 хост/joiner + «сүлжээ таслагч» TCP прокси. Joiner-ийн хөл, хостын хөл тасарч сэргэхэд байт алдагдахгүй/давхардахгүй,
// хуучин (rc-гүй) клиент өмнөх шигээ шууд хаагдана, window дуусвал холболт хаагдана. node tests/reconnect.test.js
const assert = require('assert');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');

const root = path.resolve(__dirname, '..', '..');
const WC3_PORT = 16112, JOIN_PORT = 16250;
process.env.GMN_WC3_PORT = String(WC3_PORT);
process.env.GMN_RC_WINDOW_MS = '6000';
const gameRelay = require(path.join(root, 'client', 'src', 'services', 'gameRelay.js'));
const { RcSession, Ring } = require(path.join(root, 'hostbot', 'rcsession.js'));

let pass = 0; const ok = (m) => { pass++; console.log('PASS', m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });

// ── Сүлжээ таслагч прокси: бүх холболтыг target руу дамжуулна; cut() → одоогийн бүх холболтыг тасална; refuse → шинэ холболт хүлээн авахгүй
function chaos(targetPort) {
  const pairs = new Set(); let refuse = false;
  const srv = net.createServer((c) => {
    if (refuse) { c.destroy(); return; }
    const u = net.connect(targetPort, '127.0.0.1'); const pr = { c, u }; pairs.add(pr);
    c.pipe(u); u.pipe(c);
    const done = () => { pairs.delete(pr); try { c.destroy(); } catch {} try { u.destroy(); } catch {} };
    c.on('error', done); u.on('error', done); c.on('close', done); u.on('close', done);
  });
  return { srv, cut: () => { for (const p of [...pairs]) { try { p.c.destroy(); } catch {} try { p.u.destroy(); } catch {} } pairs.clear(); }, setRefuse: (v) => { refuse = v; }, count: () => pairs.size, listen: (port) => new Promise((r) => srv.listen(port, '127.0.0.1', r)) };
}

(async () => {
  // ── 1. RcSession нэгж ──
  {
    const ring = new Ring(10); ring.push(Buffer.from('abcdef')); ring.push(Buffer.from('ghij')); ring.push(Buffer.from('klm'));
    assert.equal(Buffer.concat(ring.from(ring.start)).toString(), 'ghijklm'); assert.equal(ring.from(2), null); assert.equal(Buffer.concat(ring.from(8)).toString(), 'ijklm');
    ok('Ring: хуучин байт хаягдаж, offset-оос replay, хоцорсон offset → null (gap)');
    const sockPair = () => new Promise((res) => { let cli; const s = net.createServer((srvSide) => { s.close(); srvSide.on('error', () => {}); res([srvSide, cli]); }); s.listen(0, '127.0.0.1', () => { cli = net.connect(s.address().port, '127.0.0.1'); cli.on('error', () => {}); }); });
    const ses = new RcSession({ id: 's', holdMs: 400 });
    const [a1s, a1c] = await sockPair(); const [b1s, b1c] = await sockPair();
    const gotB = []; b1c.on('data', (d) => gotB.push(d)); const gotA = []; a1c.on('data', (d) => gotA.push(d));
    ses.attach('A', a1s, { rc: true, leftover: Buffer.from('REQ') }); ses.attach('B', b1s, { rc: true });
    a1c.write('x1'); b1c.write('y1'); await sleep(100);
    assert.equal(Buffer.concat(gotB).toString(), 'REQx1'); assert.equal(Buffer.concat(gotA).toString(), 'y1'); ok('RcSession: leftover + хоёр чиглэлийн урсгал');
    a1c.destroy(); await sleep(50); b1c.write('y2y3'); await sleep(50);   // A тасарсан үед B-ийн байт ring-д
    assert.equal(ses.closed, false); assert.equal(ses.attached('A'), false);
    const [a2s, a2c] = await sockPair(); const gotA2 = []; a2c.on('data', (d) => gotA2.push(d));
    const r = ses.attach('A', a2s, { rc: true, recv: 2, resume: true }); assert.equal(r.ok, true); assert.equal(r.recv, 5);
    a2c.write('x2'); await sleep(100);
    assert.equal(Buffer.concat(gotA2).toString(), 'y2y3'); assert.equal(Buffer.concat(gotB).toString(), 'REQx1x2'); ok('RcSession: A сэргэхэд тасарсан хугацааны байт replay, recv буцаана');
    const r2 = ses.attach('A', a2s, { rc: true, recv: 0, resume: true }); assert.equal(r2.ok, true); ok('RcSession: recv=0-оос бүхнийг replay (ring дотор)');
    a2c.destroy(); await sleep(600); assert.equal(ses.closed, true); assert.match(ses.closeReason, /hold-timeout-A/); ok('RcSession: hold дуусвал session хаагдана');
    const ses2 = new RcSession({ id: 'n' }); const [c1s, c1c] = await sockPair(); const [d1s] = await sockPair();
    ses2.attach('A', c1s, { rc: false }); ses2.attach('B', d1s, { rc: true }); c1c.destroy(); await sleep(50); assert.equal(ses2.closed, true); ok('RcSession: rc-гүй (хуучин клиент) хөл тасрахад шууд хаагдана');
  }

  // ── 2. Нэгтгэсэн: бодит relay + бодит клиент код ──
  const relayPort = await freePort();
  const relay = spawn(process.execPath, [path.join(root, 'hostbot', 'relay.js')], { env: { ...process.env, RELAY_PORT: String(relayPort), RELAY_KEY: 'k', RELAY_CAPTURE: process.env.TEST_CAPTURE || '0', RELAY_CAPTURE_DIR: require('os').tmpdir() + '/gmn-rc-cap', RELAY_RC_HOLD_MS: '8000', RELAY_SESSION_TIMEOUT_MS: '5000' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const rlog = []; globalThis.__rlog = rlog; relay.stdout.on('data', (d) => rlog.push(String(d))); relay.stderr.on('data', (d) => rlog.push('ERR ' + d));
  await sleep(700);
  const hostChaos = chaos(relayPort); const joinChaos = chaos(relayPort);
  const hcPort = await freePort(), jcPort = await freePort();
  await hostChaos.listen(hcPort); await joinChaos.listen(jcPort);

  // Хуурамч WC3 хост: 16112 дээр сонсоно; хүлээн авснаа хадгална, 'H<n> ' урсгал илгээнэ
  const hostRecv = []; let hostConn = null, hostSent = []; let hostClosed = 0;
  const wc3Host = net.createServer((c) => { hostConn = c; c.on('data', (d) => hostRecv.push(d)); c.on('close', () => { hostClosed++; }); c.on('error', () => {}); });
  await new Promise((r) => wc3Host.listen(WC3_PORT, '127.0.0.1', r));

  gameRelay.startLanHost({ relayIp: '127.0.0.1', relayPort: hcPort, game: 'g1', relayKey: 'k', wc3Name: 'Host' });
  await sleep(500);
  const gi = Buffer.alloc(40); gi[0] = 0xF7; gi[1] = 0x30; gi.writeUInt16LE(40, 2); gi.write('PX3W', 4, 'ascii'); gi.writeUInt32LE(26, 8); gi.writeUInt32LE(1, 12); gi.writeUInt16LE(6112, 38);
  gameRelay.startLanJoin({ relayIp: '127.0.0.1', relayPort: jcPort, game: 'g1', gameInfoB64: gi.toString('base64'), localPort: JOIN_PORT });
  await sleep(300);

  // Хуурамч joiner WC3: локал прокси руу холбогдож 'J<n> ' урсгал илгээнэ, хүлээн авснаа хадгална
  const joinRecv = []; let joinSent = []; let joinClosed = 0;
  const wc3Join = net.connect(JOIN_PORT, '127.0.0.1'); wc3Join.on('data', (d) => joinRecv.push(d)); wc3Join.on('close', () => { joinClosed++; }); wc3Join.on('error', () => {});
  await new Promise((r) => wc3Join.on('connect', r));
  await sleep(800);
  assert.ok(hostConn, 'хост WC3-д холболт ирэх ёстой');
  let n = 0;
  const tick = setInterval(() => { n++; const j = `J${n} `, h = `H${n} `; joinSent.push(j); hostSent.push(h); try { wc3Join.write(j); } catch {} try { hostConn.write(h); } catch {} }, 20);
  await sleep(600);
  assert.equal(joinChaos.count() >= 1, true);

  // Joiner-ийн хөл тасарна (joiner → relay)
  joinChaos.cut(); await sleep(2500);
  assert.equal(joinClosed, 0, 'joiner WC3-ийн socket хаагдах ёсгүй'); assert.equal(hostClosed, 0, 'хост WC3-ийн socket хаагдах ёсгүй');
  ok('Joiner-ийн холболт тасрахад WC3-ууд хаагдахгүй (хүлээнэ)');
  await sleep(1500);   // сэргэсний дараа урсгал үргэлжилнэ

  // Хостын хөл тасарна (hostdata + control → relay)
  hostChaos.cut(); await sleep(3500);
  assert.equal(joinClosed, 0); assert.equal(hostClosed, 0); ok('Хостын холболт тасрахад ч WC3-ууд хаагдахгүй');
  await sleep(1500);
  clearInterval(tick); await sleep(800);
  const hostGot = Buffer.concat(hostRecv).toString(), joinGot = Buffer.concat(joinRecv).toString();
  assert.equal(hostGot, joinSent.join(''), 'joiner→host урсгал яг ижил байх ёстой');
  assert.equal(joinGot, hostSent.join(''), 'host→joiner урсгал яг ижил байх ёстой');
  assert.ok(n > 200, 'хангалттай урсгал'); ok(`Хоёр тасралтын дараа ч ${n}×2 мессеж байт бүрээрээ, дарааллаараа хүрсэн (алдагдал/давхардал үгүй)`);
  assert.ok(rlog.join('').includes('resume joiner') && rlog.join('').includes('resume host'), rlog.join('').slice(-800));
  ok('Relay: joiner ба хостын хөл сэргэснээ логлосон');

  // Хуучин (rc-гүй) клиент: түүхий joiner → тасрахад relay session-оо шууд хаана (хост талын WC3 холболт хаагдана)
  const before = hostClosed;
  const raw = net.connect(relayPort, '127.0.0.1'); raw.on('error', () => {});
  await new Promise((r) => raw.on('connect', r)); raw.write(JSON.stringify({ t: 'joiner', game: 'g1' }) + '\n' + 'REQ');
  await sleep(700); raw.destroy(); await sleep(2500);
  assert.equal(hostClosed, before + 1); ok('rc-гүй хуучин клиент тасрахад хост талын холболт тэр даруй (≤2.5с) салгагдана');

  // Window дуусах: relay хүлээн авахаа 7с болиулна (клиентийн window 6с) → joiner-ийн WC3 socket хаагдана
  joinChaos.setRefuse(true); joinChaos.cut();
  await sleep(7500);
  assert.equal(joinClosed, 1); ok('Window (6с) дотор сэргээж чадаагүй бол WC3-ийн холболт хаагдана (өмнөх зан)');
  joinChaos.setRefuse(false);

  gameRelay.stopLanJoin(); gameRelay.stopLanHost(); wc3Host.close(); hostChaos.srv.close(); joinChaos.srv.close(); relay.kill();
  console.log(`\n=== reconnect: ${pass} PASS ===`); process.exit(0);
})().catch((e) => { console.error('FAIL', e); try { console.error('--- relay log ---\n' + (globalThis.__rlog || []).join('').slice(-1500)); } catch {} process.exit(1); });
