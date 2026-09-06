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
      ADD COLUMN IF NOT EXISTS play_seconds_total INTEGER DEFAULT 0,   -- ⏱ идэвхтэй тоглосон нийт секунд (services/playtime.js)
      ADD COLUMN IF NOT EXISTS play_diamonds_paid INTEGER DEFAULT 0,   -- тоглосон цагаас олгосон 💎 (1ц = 2💎)
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
      ADD COLUMN IF NOT EXISTS wc3_name VARCHAR(64),
      ADD COLUMN IF NOT EXISTS creep_kills INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS creep_denies INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS neutral_kills INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS gold INTEGER DEFAULT 0;

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
    -- Diamond багц худалдан авалт (kind='diamonds'): төлөгдмөгц олгох 💎 тоо
    ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS diamonds INTEGER DEFAULT 0;

    -- Diamond-ийн дэвтэр: 10 тоглолтын бонус, гишүүнчлэл, админ засвар
    CREATE TABLE IF NOT EXISTS diamond_transactions (
      id          SERIAL PRIMARY KEY,
      user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
      amount      INTEGER NOT NULL,                -- +орлого / -зарлага (💎)
      type        VARCHAR(24) NOT NULL,            -- block_bonus | membership | purchase | transfer_in | transfer_out | admin_grant
      ref         VARCHAR(128),
      note        TEXT,
      created_at  TIMESTAMP DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_diamond_tx_user ON diamond_transactions(user_id, created_at DESC);

    -- ⏱ Тоглосон цагийн урамшуулал: нэг тоглолт (relay token) нэг тоглогчид нэг л удаа (services/playtime.js)
    CREATE TABLE IF NOT EXISTS play_awards (
      id          SERIAL PRIMARY KEY,
      token       VARCHAR(64) NOT NULL,
      user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
      room_id     INTEGER,
      game_sec    INTEGER DEFAULT 0,
      counted_sec INTEGER DEFAULT 0,
      xp          INTEGER DEFAULT 0,
      diamonds    INTEGER DEFAULT 0,
      ranked      BOOLEAN DEFAULT FALSE,
      created_at  TIMESTAMP DEFAULT NOW(),
      UNIQUE (token, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_play_awards_user ON play_awards(user_id, created_at DESC);

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

    -- WC3-ийн LAN нэр (registry userlocal / REQJOIN) — платформын нэрээс өөр байдаг тул дүн тааруулахад хэрэглэнэ (2026-08-23)
    ALTER TABLE users ADD COLUMN IF NOT EXISTS wc3_name VARCHAR(64);

    -- Платформ дээр бот-хостоор тоглосон тоглолтын хож/хожигдол. wins/losses нь TierBot-ын
    -- гадаад ранкингийн эрх мэдэгч утга бөгөөд 10 мин тутам sync-ээр дардаг тул платформын
    -- тоглолтыг ТУСДАА баганад хуримтлуулна. Дэлгэцэнд (wins+platform_wins) нийлбэрээр харуулна.
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS platform_wins   INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS platform_losses INTEGER DEFAULT 0;

    -- Ботын тоглоомд "WC3 нээж нэгдэх" дарсан гишүүд: WC3 нэр + нийтийн IP → GHost++-ийн тоглогчийн жагсаалттай тааруулна
    CREATE TABLE IF NOT EXISTS bot_job_players (
      job_id      INTEGER REFERENCES bot_jobs(id) ON DELETE CASCADE,
      user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
      wc3_name    VARCHAR(64),
      ip          VARCHAR(64),
      created_at  TIMESTAMP DEFAULT NOW(),
      updated_at  TIMESTAMP DEFAULT NOW(),
      PRIMARY KEY (job_id, user_id)
    );
  `);
  // Anti-cheat (MapHack) — сануулгын тоо + платформ бан
  await db.query(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS maphack_warnings INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS banned BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS ban_reason TEXT,
      ADD COLUMN IF NOT EXISTS banned_at TIMESTAMPTZ;
  `);
  // Алхам 3 (2026-09-02): Ranked өрөө, LAN тоглоомын токен↔өрөө/joiner нэр (relay-ийн дүн буцаж ирэхэд
  // нэрээр яг тааруулна), ranked хүчинтэй эсэх + lineup hash (хуйвалдааны хамгаалалт), сүлжээний тайлан, ward
  await db.query(`
    ALTER TABLE rooms ADD COLUMN IF NOT EXISTS ranked BOOLEAN DEFAULT FALSE;
    ALTER TABLE game_results
      ADD COLUMN IF NOT EXISTS ranked BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS ranked_valid BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS lineup_hash VARCHAR(64),
      ADD COLUMN IF NOT EXISTS net_report JSONB;
    CREATE INDEX IF NOT EXISTS idx_game_results_lineup ON game_results(lineup_hash, played_at DESC);
    ALTER TABLE game_players ADD COLUMN IF NOT EXISTS wards INTEGER DEFAULT 0;
    CREATE TABLE IF NOT EXISTS lan_games (
      token         VARCHAR(64) PRIMARY KEY,
      room_id       INTEGER REFERENCES rooms(id) ON DELETE SET NULL,
      host_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
      host_wc3_name VARCHAR(64),
      created_at    TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS lan_game_players (
      token     VARCHAR(64) REFERENCES lan_games(token) ON DELETE CASCADE,
      user_id   INTEGER REFERENCES users(id) ON DELETE CASCADE,
      wc3_name  VARCHAR(64),
      joined_at TIMESTAMP DEFAULT NOW(),
      PRIMARY KEY (token, user_id)
    );
    -- MapHack илрэлт бүрийн түүх (!maphack тайлан: хэзээ, ямар хэрэгсэл, хэд дэх сануулга)
    CREATE TABLE IF NOT EXISTS maphack_events (
      id         SERIAL PRIMARY KEY,
      user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
      tool       VARCHAR(64),
      warnings   INTEGER,
      banned     BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_maphack_events_user ON maphack_events(user_id, created_at DESC);
  `);
  // 📡 Радар (2026-09-06): relay capture-аас hero-гийн хөдөлгөөн (тушаалын зорилтууд), kill/death, hero код —
  // тоглолт дуусахад reportGame.js POST /relay/radar → энд хадгалж, апп/вэб "Replay радар" үзүүлнэ.
  await db.query(`
    CREATE TABLE IF NOT EXISTS radar_games (
      token          VARCHAR(64) PRIMARY KEY,
      room_id        INTEGER,
      room_name      VARCHAR(120),
      host_name      VARCHAR(64),
      game_time_sec  INTEGER,
      winner_team    SMALLINT,
      players        JSONB NOT NULL DEFAULT '[]',
      kills          JSONB NOT NULL DEFAULT '[]',
      events         JSONB NOT NULL DEFAULT '[]',
      paths          JSONB NOT NULL DEFAULT '{}',
      map_name       VARCHAR(120),
      played_at      TIMESTAMP DEFAULT NOW(),
      created_at     TIMESTAMP DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_radar_games_played ON radar_games(played_at DESC);
    -- Хоосон/туршилтын capture (< 2 тоглогч эсвэл < 60 с) жагсаалтыг бохирдуулахгүй — эхлэх бүрд цэвэрлэнэ
    DELETE FROM radar_games WHERE game_time_sec < 60 OR jsonb_array_length(players) < 2;
  `);
}

module.exports = { runMigrations };
