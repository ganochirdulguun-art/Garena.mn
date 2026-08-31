'use strict';
// Тоглогч-хост LAN дохиоллын тест — ГОЛ АНХААРАЛ: ӨРӨӨ-ТУСГААРЛАЛТ.
// user5 нь room1-д, user6 нь room2-д. user5 room1-д тоглоом зарлахад room:lan_lobby
// зөвхөн room1-д очиж, room2-д ХЭЗЭЭ Ч НЭВЧихгүйг батална.
const assert = require('node:assert/strict');
const path = require('node:path');
const jwt = require('jsonwebtoken');

const serverDir = path.resolve(__dirname, '..');
const serverIndexPath = path.join(serverDir, 'src', 'index.js');
const dbModulePath = path.join(serverDir, 'src', 'config', 'db.js');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function clearSrc() { const p = path.join(serverDir, 'src'); for (const k of Object.keys(require.cache)) if (k.startsWith(p)) delete require.cache[k]; }
function installMockDb(m) { require.cache[dbModulePath] = { id: dbModulePath, filename: dbModulePath, loaded: true, exports: m }; }
function token(u) { return jwt.sign(u, 'test-secret', { expiresIn: '1h' }); }

async function main() {
  const port = 4700 + Math.floor(Math.random() * 250);
  Object.assign(process.env, {
    PORT: String(port), JWT_SECRET: 'test-secret', NODE_ENV: 'test', SKIP_DB_MIGRATIONS: 'true',
    DISCORD_CLIENT_ID: 'x', DISCORD_CLIENT_SECRET: 'x', DISCORD_REDIRECT_URI: 'http://localhost/cb',
    LAN_RELAY_IP: '202.131.1.34', LAN_RELAY_PORT: '7000', LAN_RELAY_KEY: 'relaysecret',
  });
  const mockDb = {
    query: async (sql, params) => {
      // isUserInRoom: SELECT 1 FROM room_players rp JOIN rooms r ... WHERE rp.user_id=$1 AND rp.room_id=$2
      if (sql.includes('FROM room_players rp') && sql.includes('JOIN rooms r')) {
        const [uid, rid] = params || [];   // params: [userId, roomId]
        const ok = (String(rid) === '1' && String(uid) === '5') || (String(rid) === '2' && String(uid) === '6');
        return { rows: ok ? [{}] : [] };
      }
      if (sql.includes('SELECT 1')) return { rows: [{ '?column?': 1 }] };   // dbOk()
      return { rows: [], rowCount: 0 };
    },
  };
  clearSrc(); installMockDb(mockDb);
  const srv = require(serverIndexPath);
  await srv.start(port);
  for (let i = 0; i < 40; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/`)).ok) break; } catch {} await wait(200); }

  // io.to()-ийн emit-ийг барих (emitRoom нь _io.to(roomId).emit(...) ашигладаг)
  const emits = [];
  const origTo = srv.io.to.bind(srv.io);
  srv.io.to = (room) => { const e = origTo(room); const oe = e.emit.bind(e); e.emit = (ev, payload) => { emits.push({ room: String(room), ev, payload }); return oe(ev, payload); }; return e; };

  let pass = 0, fail = 0;
  const chk = (n, ok) => { if (ok) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n); } };
  const base = `http://127.0.0.1:${port}`;
  const post = (p, u, b) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token(u) }, body: JSON.stringify(b || {}) });
  const del = (p, u) => fetch(base + p, { method: 'DELETE', headers: { Authorization: 'Bearer ' + token(u) } });

  const A = { id: 5, username: 'HostA' };

  // 1) begin (room1, user5) → token + relay endpoint + relay_key
  let r = await post('/rooms/1/lan-host/begin', A, {});
  let j = await r.json();
  chk('begin: 200 + token/relay/key', r.status === 200 && !!j.game_token && j.relay_ip === '202.131.1.34' && j.relay_port === 7000 && j.relay_key === 'relaysecret');
  const gtok = j.game_token;

  // 2) announce (room1) → room:lan_lobby ЗӨВХӨН room1-д
  emits.length = 0;
  r = await post('/rooms/1/lan-host/announce', A, { game_token: gtok, gameinfo_b64: '9zAAAAA=', host_wc3_name: 'HostA' });
  chk('announce: 200', r.status === 200);
  const lobby = emits.filter((e) => e.ev === 'room:lan_lobby');
  chk('room:lan_lobby зөвхөн room1-д (1 удаа)', lobby.length === 1 && lobby[0].room === '1');
  chk('room2-д НЭВЧээгүй ✅ (тусгаарлалт)', !emits.some((e) => e.room === '2'));
  chk('payload: gameinfo + relay + host', !!lobby[0] && lobby[0].payload.gameinfo_b64 === '9zAAAAA=' && lobby[0].payload.relay_ip === '202.131.1.34' && lobby[0].payload.host_username === 'HostA');

  // 3) user5 room2-д зарлах гэвэл 403 (гишүүн биш → тусгаарлалт API түвшинд)
  r = await post('/rooms/2/lan-host/announce', A, { game_token: 'x', gameinfo_b64: '9zAAAAA=' });
  chk('room2-д зарлах эрхгүй → 403', r.status === 403);

  // 4) delete → room:lan_lobby_gone (room1)
  emits.length = 0;
  r = await del('/rooms/1/lan-host/' + gtok, A);
  chk('delete: 200', r.status === 200);
  chk('room:lan_lobby_gone room1-д', emits.some((e) => e.ev === 'room:lan_lobby_gone' && e.room === '1'));

  // 5) begin эрхгүй хэрэглэгч (room1-д биш user9) → 403
  r = await post('/rooms/1/lan-host/begin', { id: 9, username: 'Outsider' }, {});
  chk('гадны хэрэглэгч begin → 403', r.status === 403);

  console.log('=== ДҮН: ' + pass + ' PASS, ' + fail + ' FAIL ===');
  try { await new Promise((res) => srv.io.close(res)); await new Promise((res) => srv.server.close(res)); } catch {}
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(2); });
setTimeout(() => { console.log('TIMEOUT'); process.exit(3); }, 20000);
