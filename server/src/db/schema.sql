-- WC3/DotA Platform - Database Schema

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Тоглогчийн хүснэгт
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  discord_id    VARCHAR(255) UNIQUE,
  discord_username VARCHAR(255),
  username      VARCHAR(255) NOT NULL,
  email         VARCHAR(255) UNIQUE,
  password_hash TEXT,
  avatar_url    TEXT,
  wins          INTEGER DEFAULT 0,
  losses        INTEGER DEFAULT 0,
  tierbot_id    VARCHAR(255),
  tierbot_rating INTEGER DEFAULT 0,
  tierbot_tier  VARCHAR(100),
  tierbot_rank  INTEGER,
  tierbot_synced_at TIMESTAMP,
  created_at    TIMESTAMP DEFAULT NOW()
);

-- Тоглоомын өрөөний хүснэгт
CREATE TABLE IF NOT EXISTS rooms (
  id                  SERIAL PRIMARY KEY,
  name                VARCHAR(255) NOT NULL,
  host_id             INTEGER REFERENCES users(id) ON DELETE CASCADE,
  zerotier_network_id VARCHAR(255),
  max_players         INTEGER DEFAULT 10,
  status              VARCHAR(50) DEFAULT 'waiting', -- waiting, playing, done
  game_type           VARCHAR(50) DEFAULT 'DotA',
  has_password        BOOLEAN DEFAULT FALSE,
  password_hash       TEXT,
  description         TEXT DEFAULT '',
  game_mode           VARCHAR(100) DEFAULT '',
  created_at          TIMESTAMP DEFAULT NOW()
);

-- Өрөөний тоглогчид
CREATE TABLE IF NOT EXISTS room_players (
  room_id   INTEGER REFERENCES rooms(id) ON DELETE CASCADE,
  user_id   INTEGER REFERENCES users(id) ON DELETE CASCADE,
  team      INTEGER DEFAULT NULL,
  joined_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (room_id, user_id)
);

-- Тоглоомын үр дүн
CREATE TABLE IF NOT EXISTS game_results (
  id               SERIAL PRIMARY KEY,
  room_id          INTEGER REFERENCES rooms(id) ON DELETE SET NULL,
  winner_team      INTEGER NOT NULL,
  duration_minutes INTEGER,
  replay_path      TEXT,
  discord_posted   BOOLEAN DEFAULT FALSE,
  played_at        TIMESTAMP DEFAULT NOW()
);

-- Тоглоомын тоглогчид (game history)
CREATE TABLE IF NOT EXISTS game_players (
  id             SERIAL PRIMARY KEY,
  game_result_id INTEGER REFERENCES game_results(id) ON DELETE CASCADE,
  user_id        INTEGER REFERENCES users(id) ON DELETE CASCADE,
  team           INTEGER NOT NULL,
  is_winner      BOOLEAN NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_game_players_user ON game_players(user_id);

-- Хувийн мессеж (DM)
CREATE TABLE IF NOT EXISTS messages (
  id          SERIAL PRIMARY KEY,
  sender_id   INTEGER REFERENCES users(id) ON DELETE CASCADE,
  receiver_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  text        TEXT NOT NULL,
  is_read     BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMP DEFAULT NOW()
);

-- Нийтийн лобби чат — БАЙНГА хадгална (сервер restart/deploy хийсэн ч түүх үлдэнэ)
CREATE TABLE IF NOT EXISTS lobby_messages (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  username    VARCHAR(120) NOT NULL,
  text        TEXT NOT NULL,
  deleted     BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_lobby_messages_time ON lobby_messages(created_at DESC);

-- Indexes (query performance сайжруулах)
CREATE INDEX IF NOT EXISTS idx_rooms_status         ON rooms(status);
CREATE INDEX IF NOT EXISTS idx_room_players_user    ON room_players(user_id);
CREATE INDEX IF NOT EXISTS idx_room_players_room    ON room_players(room_id);
CREATE INDEX IF NOT EXISTS idx_users_discord_id     ON users(discord_id);
CREATE INDEX IF NOT EXISTS idx_users_wins           ON users(wins DESC);
CREATE INDEX IF NOT EXISTS idx_users_tierbot_id     ON users(tierbot_id);
CREATE INDEX IF NOT EXISTS idx_users_tierbot_rating ON users(tierbot_rating DESC);
CREATE INDEX IF NOT EXISTS idx_messages_conversation
  ON messages(LEAST(sender_id, receiver_id), GREATEST(sender_id, receiver_id), created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_unread
  ON messages(receiver_id, is_read) WHERE is_read = FALSE;

-- Friend requests and accepted friendships
CREATE TABLE IF NOT EXISTS friendships (
  id           SERIAL PRIMARY KEY,
  requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  receiver_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status       VARCHAR(20) DEFAULT 'pending',
  created_at   TIMESTAMP DEFAULT NOW(),
  UNIQUE(requester_id, receiver_id)
);
CREATE INDEX IF NOT EXISTS idx_friendships_requester ON friendships(requester_id);
CREATE INDEX IF NOT EXISTS idx_friendships_receiver  ON friendships(receiver_id);

-- User block list
CREATE TABLE IF NOT EXISTS blocked_users (
  id              SERIAL PRIMARY KEY,
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at       TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, blocked_user_id)
);
CREATE INDEX IF NOT EXISTS idx_blocked_users_user ON blocked_users(user_id);

-- Password reset tokens store SHA-256 token hashes, not raw reset tokens
CREATE TABLE IF NOT EXISTS password_resets (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  token      VARCHAR(64) UNIQUE NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  used       BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_password_resets_token ON password_resets(token);

-- Админ эрхтэй Discord ID-ууд. ADMIN_DISCORD_IDS env нь устгаж болохгүй үндсэн
-- (bootstrap) админ; энэ хүснэгт нь dashboard-оос динамикаар нэмж/хассан админууд.
CREATE TABLE IF NOT EXISTS admin_whitelist (
  discord_id VARCHAR(255) PRIMARY KEY,
  note       TEXT DEFAULT '',
  added_by   VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW()
);

-- LexusWarKey desktop апп-ын хэрэглэгчид. Апп нээгдэхэд Discord-оор нэвтэрч,
-- тогтмол heartbeat илгээснээр last_seen шинэчлэгдэнэ (онлайн эсэхийг үүгээр тодорхойлно).
CREATE TABLE IF NOT EXISTS warkey_users (
  discord_id VARCHAR(255) PRIMARY KEY,
  username   VARCHAR(255),
  version    VARCHAR(50),
  first_seen TIMESTAMP DEFAULT NOW(),
  last_seen  TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_warkey_users_last_seen ON warkey_users(last_seen DESC);

-- Хориглосон (устгасан) WarKey хэрэглэгчид. Эдгээр Discord ID-ийн heartbeat-ыг татгалзаж,
-- апп ашиглах боломжгүй болгоно. Dashboard-оос сэргээвэл (устгавал) дахин ашиглана.
CREATE TABLE IF NOT EXISTS warkey_bans (
  discord_id VARCHAR(255) PRIMARY KEY,
  username   VARCHAR(255),
  version    VARCHAR(50),
  banned_by  VARCHAR(255),
  banned_at  TIMESTAMP DEFAULT NOW()
);
