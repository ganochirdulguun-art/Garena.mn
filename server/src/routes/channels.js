// ══════════════════════════════════════════════════════════════
// Нийтийн өрөөнүүд «Room 1–20» (Garena Plus маяг, 2026-10-02) — rooms хүснэгтэд kind='channel'.
//  • Хостгүй (host_id NULL), хэзээ ч хаагдахгүй/устахгүй, «Тоглож буй» болохгүй (DB trigger хамгаална —
//    status-ыг өөрчилдөг аль ч кодын замаас үл хамааран).
//  • Багтаамж: visible_cap (200) хүртэл хэн ч; 200–max_players (300) хооронд зөвхөн Silver/Gold/ажилтан
//    (Premium нөөц slot) — тоо ил харагдана (213/200 ⭐).
//  • Өрөөнд байгаа хэн ч WC3 LAN тоглоом нээж, бусад нь «Нэгдэх» — lanhost.js-ийн олон тоглоомын механизм.
//  • pinned_notice — чатын дээд хэсэгт бэхэлсэн зарлал (эзэн/админ засна).
// ══════════════════════════════════════════════════════════════
let db;
try { db = require('../config/db'); } catch { db = null; }

const WC3 = 'Warcraft III: The Frozen Throne';
const CHANNEL_COUNT = Number(process.env.CHANNEL_COUNT || 20);
const VISIBLE_CAP = 200;
const REAL_CAP = 300;
const DEFAULT_NOTICE = [
  '📢 Garena.mn нийтийн өрөөнд тавтай морил!',
  '🎮 Тоглох: «LAN тоглоом нээх» дарж өөрийн тоглоомыг нээ, эсвэл доорх жагсаалтаас «Нэгдэх» дар → WC3 → Local Area Network.',
  '⭐ Өрөө 200/200 дүүрсэн үед Silver/Gold гишүүд Premium нөөц slot-оор шууд орно.',
  '⚖️ Бүдүүлэг үг, спам, maphack хориотой — зөрчил гаргавал өрөөнөөс гаргаж, бан хүлээлгэнэ.',
].join('\n');

async function dbOk() { if (!db) return false; try { await db.query('SELECT 1'); return true; } catch { return false; } }

async function ensureTables() {
  if (!await dbOk()) return;
  try {
    await db.query(`
      ALTER TABLE rooms ADD COLUMN IF NOT EXISTS kind VARCHAR(16) DEFAULT 'room';
      ALTER TABLE rooms ADD COLUMN IF NOT EXISTS channel_no INTEGER;
      ALTER TABLE rooms ADD COLUMN IF NOT EXISTS visible_cap INTEGER;
      ALTER TABLE rooms ADD COLUMN IF NOT EXISTS pinned_notice TEXT;
    `);
    // Хамгаалалт: channel хэзээ ч 'playing'/'done' болохгүй, устахгүй (аль ч кодын замаас)
    await db.query(`
      CREATE OR REPLACE FUNCTION garena_channel_guard() RETURNS trigger AS $$
      BEGIN
        IF TG_OP = 'DELETE' THEN
          IF OLD.kind = 'channel' THEN RETURN NULL; END IF;
          RETURN OLD;
        END IF;
        IF OLD.kind = 'channel' THEN
          NEW.status := 'waiting';
          NEW.playing_since := NULL;
          NEW.kind := 'channel';
        END IF;
        RETURN NEW;
      END; $$ LANGUAGE plpgsql;
    `);
    await db.query(`
      DROP TRIGGER IF EXISTS garena_channel_guard_trg ON rooms;
      CREATE TRIGGER garena_channel_guard_trg BEFORE UPDATE OR DELETE ON rooms
        FOR EACH ROW EXECUTE FUNCTION garena_channel_guard();
    `);
    await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS rooms_channel_uniq ON rooms (game_type, channel_no) WHERE kind = 'channel'`);
    for (let n = 1; n <= CHANNEL_COUNT; n++) {
      await db.query(
        `INSERT INTO rooms (name, host_id, max_players, game_type, has_password, description, game_mode, kind, channel_no, visible_cap, pinned_notice, status)
         SELECT $1, NULL, $2, $3, FALSE, '', 'LAN', 'channel', $4, $5, $6, 'waiting'
         WHERE NOT EXISTS (SELECT 1 FROM rooms WHERE kind = 'channel' AND game_type = $3 AND channel_no = $4)`,
        [`WC3 Room ${n}`, REAL_CAP, WC3, n, VISIBLE_CAP, DEFAULT_NOTICE]
      );
    }
  } catch (e) { console.error('[Migration] channels:', e.message); }
}

// Silver/Gold эсвэл ажилтан (эзэн/админ) — Premium нөөц slot-д орох эрхтэй
async function hasPremiumSlot(user) {
  try { if (await require('../middleware/admin').isAdminUser(user)) return true; } catch {}
  try { const { tierOf } = require('./membership'); const t = await tierOf(user.id); return t === 'silver' || t === 'gold'; } catch { return false; }
}

module.exports = { ensureTables, hasPremiumSlot, DEFAULT_NOTICE, VISIBLE_CAP, REAL_CAP, WC3 };
