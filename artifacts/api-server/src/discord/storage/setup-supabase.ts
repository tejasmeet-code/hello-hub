/**
 * Run this once to create Supabase tables.
 * Usage: node --loader ts-node/esm src/discord/storage/setup-supabase.ts
 * Or paste the SQL below directly into Supabase SQL editor.
 */

export const SCHEMA_SQL = `
-- Cases: universal moderation case log
CREATE TABLE IF NOT EXISTS cases (
  id           BIGSERIAL PRIMARY KEY,
  guild_id     TEXT NOT NULL,
  case_number  INTEGER NOT NULL,
  action       TEXT NOT NULL,
  moderator_id TEXT NOT NULL,
  target_id    TEXT NOT NULL,
  reason       TEXT NOT NULL DEFAULT 'No reason provided',
  proof        TEXT,
  active       BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (guild_id, case_number)
);
CREATE INDEX IF NOT EXISTS idx_cases_guild_target ON cases (guild_id, target_id);
CREATE INDEX IF NOT EXISTS idx_cases_guild_number ON cases (guild_id, case_number);

-- Appeals: punishment appeal submissions
CREATE TABLE IF NOT EXISTS appeals (
  id              BIGSERIAL PRIMARY KEY,
  guild_id        TEXT NOT NULL,
  case_number     INTEGER NOT NULL,
  user_id         TEXT NOT NULL,
  punishment_type TEXT NOT NULL,
  why_happened    TEXT NOT NULL,
  defense         TEXT NOT NULL,
  proof           TEXT,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected')),
  reviewed_by     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_appeals_guild_user ON appeals (guild_id, user_id);
CREATE INDEX IF NOT EXISTS idx_appeals_status ON appeals (guild_id, status);

-- Guild settings: per-module config
CREATE TABLE IF NOT EXISTS guild_settings (
  guild_id          TEXT NOT NULL,
  module_name       TEXT NOT NULL,
  enabled           BOOLEAN NOT NULL DEFAULT true,
  log_channel_id    TEXT,
  permitted_role_ids TEXT[] NOT NULL DEFAULT '{}',
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (guild_id, module_name)
);

-- Generic JSON persistence for bot state that previously lived in local files
CREATE TABLE IF NOT EXISTS bot_json_store (
  store_name TEXT PRIMARY KEY,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Quota streaks: consecutive fail tracking
CREATE TABLE IF NOT EXISTS quota_streaks (
  guild_id          TEXT NOT NULL,
  user_id           TEXT NOT NULL,
  consecutive_fails INTEGER NOT NULL DEFAULT 0,
  last_check_week   BIGINT NOT NULL DEFAULT 0,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (guild_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_quota_streaks_guild ON quota_streaks (guild_id);

-- Auto-update updated_at on cases
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_cases_updated_at ON cases;
CREATE TRIGGER update_cases_updated_at BEFORE UPDATE ON cases
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

DROP TRIGGER IF EXISTS update_guild_settings_updated_at ON guild_settings;
CREATE TRIGGER update_guild_settings_updated_at BEFORE UPDATE ON guild_settings
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

DROP TRIGGER IF EXISTS update_bot_json_store_updated_at ON bot_json_store;
CREATE TRIGGER update_bot_json_store_updated_at BEFORE UPDATE ON bot_json_store
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

DROP TRIGGER IF EXISTS update_quota_streaks_updated_at ON quota_streaks;
CREATE TRIGGER update_quota_streaks_updated_at BEFORE UPDATE ON quota_streaks
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
`;

console.log("=== Paste this SQL into your Supabase SQL editor ===");
console.log(SCHEMA_SQL);