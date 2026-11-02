/**
 * Database Migration Script
 * Creates the users table and related auth tables
 * Run: node src/config/migrate.js
 */
require('dotenv').config();
const { pool } = require('./database');

const migration = `
  -- Enable UUID extension
  CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

  -- ===================================================
  -- Users Table (System Auth - NOT LinkedIn accounts)
  -- ===================================================
  CREATE TABLE IF NOT EXISTS users (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    full_name       VARCHAR(100) NOT NULL,
    email           VARCHAR(255) UNIQUE NOT NULL,
    password_hash   VARCHAR(255) NOT NULL,
    avatar_url      VARCHAR(500),
    is_active       BOOLEAN DEFAULT true,
    is_verified     BOOLEAN DEFAULT false,
    last_login_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
  );

  -- ===================================================
  -- Refresh Tokens Table (JWT Refresh Token Rotation)
  -- ===================================================
  CREATE TABLE IF NOT EXISTS refresh_tokens (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token           VARCHAR(500) UNIQUE NOT NULL,
    expires_at      TIMESTAMPTZ NOT NULL,
    is_revoked      BOOLEAN DEFAULT false,
    created_at      TIMESTAMPTZ DEFAULT NOW()
  );

  -- Index for faster token lookups
  CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token ON refresh_tokens(token);
  CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);
  CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

  -- ===================================================
  -- LinkedIn Accounts Table (OAuth 2.0 Connected Accounts)
  -- ===================================================
  CREATE TABLE IF NOT EXISTS linkedin_accounts (
    id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    linkedin_member_urn   VARCHAR(255),
    name                  VARCHAR(255) NOT NULL,
    first_name            VARCHAR(100),
    last_name             VARCHAR(100),
    email                 VARCHAR(255) NOT NULL,
    avatar_url            VARCHAR(1000),
    headline              VARCHAR(500),
    access_token          TEXT,
    refresh_token         TEXT,
    token_expires_at      TIMESTAMPTZ,
    scope                 VARCHAR(255),
    time_zone             VARCHAR(100) DEFAULT '(GMT+05:00) Islamabad, Karachi',
    is_starred            BOOLEAN DEFAULT false,
    status                VARCHAR(50) DEFAULT 'running',
    created_at            TIMESTAMPTZ DEFAULT NOW(),
    updated_at            TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_user_linkedin_email UNIQUE (user_id, email)
  );

  ALTER TABLE linkedin_accounts ALTER COLUMN access_token DROP NOT NULL;
  ALTER TABLE linkedin_accounts ALTER COLUMN linkedin_member_urn DROP NOT NULL;
  ALTER TABLE linkedin_accounts DROP CONSTRAINT IF EXISTS uq_user_linkedin_member;
  ALTER TABLE linkedin_accounts DROP CONSTRAINT IF EXISTS uq_user_linkedin_email;
  ALTER TABLE linkedin_accounts ADD CONSTRAINT uq_user_linkedin_email UNIQUE (user_id, email);

  CREATE INDEX IF NOT EXISTS idx_linkedin_accounts_user_id ON linkedin_accounts(user_id);
  CREATE INDEX IF NOT EXISTS idx_linkedin_accounts_email ON linkedin_accounts(email);

  -- ===================================================
  -- Updated_at Trigger Function
  -- ===================================================
  CREATE OR REPLACE FUNCTION update_updated_at_column()
  RETURNS TRIGGER AS $$
  BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
  END;
  $$ language 'plpgsql';

  DROP TRIGGER IF EXISTS update_users_updated_at ON users;
  CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

  DROP TRIGGER IF EXISTS update_linkedin_accounts_updated_at ON linkedin_accounts;
  CREATE TRIGGER update_linkedin_accounts_updated_at
    BEFORE UPDATE ON linkedin_accounts
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

  -- ===================================================
  -- Scheduled Posts Table (Automated Post Publishing)
  -- ===================================================
  CREATE TABLE IF NOT EXISTS scheduled_posts (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id      UUID REFERENCES linkedin_accounts(id) ON DELETE SET NULL,
    content         TEXT NOT NULL,
    media_url       VARCHAR(1000),
    tags            VARCHAR(500),
    scheduled_at    TIMESTAMPTZ NOT NULL,
    published_at    TIMESTAMPTZ,
    status          VARCHAR(50) DEFAULT 'scheduled', -- draft, scheduled, publishing, published, failed
    post_urn        VARCHAR(255),
    error_message   TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_scheduled_posts_user_id ON scheduled_posts(user_id);
  CREATE INDEX IF NOT EXISTS idx_scheduled_posts_status ON scheduled_posts(status);
  CREATE INDEX IF NOT EXISTS idx_scheduled_posts_scheduled_at ON scheduled_posts(scheduled_at);

  DROP TRIGGER IF EXISTS update_scheduled_posts_updated_at ON scheduled_posts;
  CREATE TRIGGER update_scheduled_posts_updated_at
    BEFORE UPDATE ON scheduled_posts
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
`;

async function runMigration() {
  try {
    console.log('🚀 Running database migration...');
    await pool.query(migration);
    console.log('✅ Migration completed successfully!');
    console.log('   - users table created');
    console.log('   - refresh_tokens table created');
    console.log('   - indexes created');
    console.log('   - triggers configured');
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigration();
