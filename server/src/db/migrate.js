const fs = require('fs/promises');
const path = require('path');

async function runMigrations(db) {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schemaSql = await fs.readFile(schemaPath, 'utf8');

  await db.query(schemaSql);
  await db.query(`
    ALTER TABLE room_players
      ADD COLUMN IF NOT EXISTS team INTEGER DEFAULT NULL;

    ALTER TABLE rooms
      ADD COLUMN IF NOT EXISTS description TEXT DEFAULT '',
      ADD COLUMN IF NOT EXISTS game_mode VARCHAR(100) DEFAULT '';

    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS discord_username VARCHAR(255),
      ADD COLUMN IF NOT EXISTS tierbot_id VARCHAR(255),
      ADD COLUMN IF NOT EXISTS tierbot_rating INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS tierbot_tier VARCHAR(100),
      ADD COLUMN IF NOT EXISTS tierbot_rank INTEGER,
      ADD COLUMN IF NOT EXISTS tierbot_synced_at TIMESTAMP;

    CREATE INDEX IF NOT EXISTS idx_users_tierbot_id ON users(tierbot_id);
    CREATE INDEX IF NOT EXISTS idx_users_tierbot_rating ON users(tierbot_rating DESC);
  `);

  // ── Гишүүнчлэл (Bronze/Silver/Gold), нэрийн эффект, Diamond 💎, XP/Level (2026-08-22) ──
  await db.query(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS membership VARCHAR(16) DEFAULT 'bronze',
      ADD COLUMN IF NOT EXISTS membership_until TIMESTAMP,
      ADD COLUMN IF NOT EXISTS name_effect VARCHAR(24) DEFAULT 'solid',
      ADD COLUMN IF NOT EXISTS diamonds INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS xp INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS level INTEGER DEFAULT 1,
      ADD COLUMN IF NOT EXISTS block_games INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS block_wins INTEGER DEFAULT 0;

    ALTER TABLE rooms
      ADD COLUMN IF NOT EXISTS background_url TEXT DEFAULT '';

    -- Тоглолтын дүн: эх сурвалж (replay | bot) + ботын тоглоомын мэдээлэл
    ALTER TABLE game_results
      ADD COLUMN IF NOT EXISTS source VARCHAR(16) DEFAULT 'replay',
      ADD COLUMN IF NOT EXISTS bot_job_id INTEGER,
      ADD COLUMN IF NOT EXISTS map_name VARCHAR(255),
      ADD COLUMN IF NOT EXISTS game_name VARCHAR(255);

    -- Тоглогч бүрийн K/D/A, баатар, гарсан цаг, олгосон XP/Diamond
    ALTER TABLE game_players
      ADD COLUMN IF NOT EXISTS kills INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS deaths INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS assists INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS hero VARCHAR(64),
      ADD COLUMN IF NOT EXISTS left_at_sec INTEGER,
      ADD COLUMN IF NOT EXISTS is_leaver BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS xp_earned INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS diamonds_earned INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS wc3_name VARCHAR(64);

    -- QPay нэхэмжлэх бүхий гишүүнчлэлийн захиалгууд
    CREATE TABLE IF NOT EXISTS payment_orders (
      id          SERIAL PRIMARY KEY,
      user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
      kind        VARCHAR(16) NOT NULL,            -- 'membership'
      tier        VARCHAR(16),                     -- silver | gold
      months      INTEGER DEFAULT 1,
      amount      INTEGER NOT NULL,                -- ₮ (QPay) эсвэл 💎 (diamonds)
      currency    VARCHAR(8) DEFAULT 'MNT',        -- MNT | DIAMOND
      invoice_id  VARCHAR(128) UNIQUE,             -- QPay dashboard invoice_id ('dia:…' = Diamond-оор)
      status      VARCHAR(16) DEFAULT 'OPEN',      -- OPEN | PAID | CANCELLED
      created_at  TIMESTAMP DEFAULT NOW(),
      paid_at     TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_payment_orders_user ON payment_orders(user_id, created_at DESC);

    -- Diamond-ийн дэвтэр: 10 тоглолтын бонус, гишүүнчлэл, админ засвар
    CREATE TABLE IF NOT EXISTS diamond_transactions (
      id          SERIAL PRIMARY KEY,
      user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
      amount      INTEGER NOT NULL,                -- +орлого / -зарлага (💎)
      type        VARCHAR(24) NOT NULL,            -- block_bonus | membership | adjust | reward
      ref         VARCHAR(128),
      note        TEXT,
      created_at  TIMESTAMP DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_diamond_tx_user ON diamond_transactions(user_id, created_at DESC);

    -- Бот хостын ажлууд (RGC маяг): өрөөний host "Бот хост" дарахад үүснэ, бот авч хостолно
    CREATE TABLE IF NOT EXISTS bot_jobs (
      id            SERIAL PRIMARY KEY,
      room_id       INTEGER REFERENCES rooms(id) ON DELETE SET NULL,
      requested_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
      map_key       VARCHAR(64) NOT NULL,
      map_name      VARCHAR(255),
      game_name     VARCHAR(64) NOT NULL,
      owner_name    VARCHAR(64),                   -- WC3 lobby-д !start бичих эрхтэй (өрөөний host)
      status        VARCHAR(16) DEFAULT 'queued',  -- queued | hosting | lobby | started | finished | failed | cancelled
      bot_name      VARCHAR(64),
      host_ip       VARCHAR(64),
      host_port     INTEGER,
      gameinfo_b64  TEXT,                          -- ботын W3GS_GAMEINFO пакет (клиент LAN-д харуулахад)
      expected_players JSONB,                      -- [{user_id, name}] — өрөөний гишүүд
      game_result_id INTEGER,
      error         TEXT,
      created_at    TIMESTAMP DEFAULT NOW(),
      updated_at    TIMESTAMP DEFAULT NOW(),
      started_at    TIMESTAMP,
      finished_at   TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_bot_jobs_status ON bot_jobs(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_bot_jobs_room ON bot_jobs(room_id, created_at DESC);
  `);
}

module.exports = { runMigrations };
