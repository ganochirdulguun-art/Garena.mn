'use strict';
// Өрөөний чатын байнгын түүх (routes/roomChat.js): хадгалах → түүх (хуучин→шинэ), өмнөхийг хуудаслах, устгах
const assert = require('node:assert/strict');
const path = require('node:path');
const serverDir = path.resolve(__dirname, '..');
const dbModulePath = path.join(serverDir, 'src', 'config', 'db.js');

const rows = []; let nextId = 1;
async function query(sql, p = []) {
  const s = sql.replace(/\s+/g, ' ');
  if (s.startsWith('INSERT INTO room_messages')) {
    rows.push({ id: nextId++, room_id: p[0], user_id: p[1], username: p[2], text: p[3], reply_to: p[4] ? JSON.parse(p[4]) : null, system: p[5], deleted: false, created_at: new Date(p[6] || Date.now()) });
    return { rows: [], rowCount: 1 };
  }
  if (s.includes('FROM room_messages WHERE room_id = $1')) {
    let r = rows.filter((x) => x.room_id === p[0]);
    let lim = p[1];
    if (s.includes('created_at < $2')) { r = r.filter((x) => x.created_at < new Date(p[1])); lim = p[2]; }
    r = r.sort((a, b) => b.created_at - a.created_at || b.id - a.id).slice(0, lim).sort((a, b) => a.created_at - b.created_at || a.id - b.id);
    return { rows: r };
  }
  if (s.startsWith('UPDATE room_messages SET deleted = TRUE')) {
    const r = rows.filter((x) => x.room_id === p[0] && x.user_id === p[1] && x.created_at.getTime() === new Date(p[2]).getTime());
    r.forEach((x) => { x.deleted = true; });
    return { rowCount: r.length };
  }
  return { rows: [], rowCount: 0 };
}
require.cache[dbModulePath] = { id: dbModulePath, filename: dbModulePath, loaded: true, exports: { query } };
const rc = require(path.join(serverDir, 'src', 'routes', 'roomChat.js'));

let pass = 0; const ok = (n) => { pass++; console.log('PASS ' + n); };
(async () => {
  const t0 = Date.parse('2026-10-02T00:00:00Z');
  for (let i = 0; i < 250; i++) await rc.save(901, { userId: 2, username: 'Billionaire', text: `m${i}`, time: new Date(t0 + i * 1000).toISOString() });
  await rc.save(902, { userId: 3, username: 'Other', text: 'өөр өрөө', time: new Date(t0).toISOString() });
  let h = await rc.history(901);
  assert.equal(h.length, 200); assert.equal(h[0].text, 'm50'); assert.equal(h[199].text, 'm249'); ok('Сүүлийн 200, хуучин→шинэ, зөвхөн тухайн өрөө');
  const older = await rc.history(901, { limit: rc.PAGE_LIMIT, before: h[0].time });
  assert.equal(older.length, 50); assert.equal(older[49].text, 'm49'); ok('Дээш гүйлгэхэд өмнөх мессежүүд');
  const n = await rc.markDeleted(901, 2, h[199].time);
  assert.equal(n, 1); h = await rc.history(901); assert.equal(h[199].text, '[Устгагдсан мессеж]'); ok('Өөрийн мессеж устгана (түүхэнд ч)');
  assert.equal(await rc.markDeleted(901, 3, h[198].time), 0); ok('Бусдын мессежийг устгахгүй');
  await rc.save(901, { userId: 0, username: 'Garena.mn', text: '🏆 дүн', time: new Date(t0 + 999999).toISOString(), system: true, replyTo: { username: 'x', text: 'y', time: new Date(t0).toISOString() } });
  h = await rc.history(901); assert.equal(h[199].system, true); ok('Системийн (тоглолтын дүн) мессеж хадгалагдана');
  console.log(`=== roomchat: ${pass} PASS ===`);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
