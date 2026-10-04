'use strict';
// ── Нийтийн статистик (2026-10-04, эзэн): Facebook туслах бот «одоо хэдэн хүн тоглож байна?» г.м. асуултад шууд тоо хэлнэ ──
//  GET /public/stats → { online, in_room, in_game, games_open, games_running, rooms:[{name,open,running}], registered, games_24h, version, at }
//  Зөвхөн нэгтгэсэн тоо — хэрэглэгчийн нэр, ID огт гаргахгүй. 30 сек кэш (DB/CPU ачаалалгүй).
const express = require('express');
let db = null;
try { db = require('../config/db'); } catch { db = null; }

const router = express.Router();
const TTL = 30 * 1000;
let _presence = () => [];
let _rooms = () => new Map();   // roomId(String) → { open, started }
let _version = async () => null;
let _cache = { at: 0, body: null };

function setSources({ presence, rooms, version } = {}) {
  if (presence) _presence = presence;
  if (rooms) _rooms = rooms;
  if (version) _version = version;
  _cache = { at: 0, body: null };
}

// onlineUsersList() нь userId-гаар нэгтгэсэн жагсаалт (нэг хүн = нэг мөр)
function summarize(list, rooms) {
  const out = { online: 0, in_room: 0, in_game: 0, games_open: 0, games_running: 0 };
  for (const u of list || []) {
    out.online++;
    if (u.status === 'in_game') out.in_game++;
    else if (u.status === 'in_room') out.in_room++;
  }
  for (const c of (rooms || new Map()).values()) {
    out.games_open += c.open || 0;
    out.games_running += c.started || 0;
  }
  return out;
}

async function build() {
  const rooms = _rooms() || new Map();
  const body = { ...summarize(_presence(), rooms), rooms: [], registered: null, games_24h: null, version: null, at: new Date().toISOString() };
  const ids = [...rooms.keys()].map((x) => parseInt(x, 10)).filter(Number.isFinite);
  if (db) {
    try {
      const r = await db.query(
        `SELECT (SELECT COUNT(*) FROM users)::int AS registered,
                (SELECT COUNT(*) FROM lan_games WHERE created_at > NOW() - INTERVAL '24 hours')::int AS games_24h`);
      Object.assign(body, r.rows[0] || {});
    } catch (e) { console.warn('[public/stats]', e.message); }
    if (ids.length) {
      try {
        const r = await db.query('SELECT id, name FROM rooms WHERE id = ANY($1::int[])', [ids]);
        const names = new Map(r.rows.map((x) => [String(x.id), x.name]));
        for (const [id, c] of rooms) if (names.has(String(id))) body.rooms.push({ name: names.get(String(id)), open: c.open || 0, running: c.started || 0 });
      } catch (e) { console.warn('[public/stats rooms]', e.message); }
    }
  }
  try { body.version = await _version(); } catch { body.version = null; }
  return body;
}

router.get('/stats', async (req, res) => {
  res.set('Cache-Control', 'public, max-age=30');
  try {
    if (!_cache.body || Date.now() - _cache.at > TTL) _cache = { at: Date.now(), body: await build() };
    return res.json(_cache.body);
  } catch (e) {
    console.warn('[public/stats]', e.message);
    return res.status(500).json({ error: 'stats unavailable' });
  }
});

module.exports = { router, setSources, summarize, _build: build };
