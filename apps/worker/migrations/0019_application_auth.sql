-- Additive authentication storage; application user IDs and owned data are preserved.
CREATE TABLE auth_user (
  id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE, email_verified INTEGER NOT NULL DEFAULT 0 CHECK (email_verified IN (0, 1)),
  image TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE auth_session (
  id TEXT PRIMARY KEY NOT NULL, token TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  ip_address TEXT, user_agent TEXT
);
CREATE INDEX auth_session_user_idx ON auth_session(user_id);
CREATE INDEX auth_session_expiry_idx ON auth_session(expires_at);
CREATE TABLE auth_account (
  id TEXT PRIMARY KEY NOT NULL, account_id TEXT NOT NULL, provider_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
  access_token TEXT, refresh_token TEXT, id_token TEXT,
  access_token_expires_at INTEGER, refresh_token_expires_at INTEGER,
  scope TEXT, password TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX auth_account_user_idx ON auth_account(user_id);
CREATE UNIQUE INDEX auth_account_provider_subject_unique ON auth_account(provider_id, account_id);
CREATE TABLE auth_verification (
  id TEXT PRIMARY KEY NOT NULL, identifier TEXT NOT NULL, value TEXT NOT NULL,
  expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX auth_verification_identifier_idx ON auth_verification(identifier);
CREATE TABLE auth_rate_limit (
  id TEXT PRIMARY KEY NOT NULL, key TEXT NOT NULL UNIQUE,
  count INTEGER NOT NULL, last_request INTEGER NOT NULL
);

-- Email ownership is case-insensitive at both boundaries, including concurrent writes.
-- Pre-cutover inventory must resolve existing normalized profile collisions before this index.
CREATE UNIQUE INDEX users_email_normalized_unique ON users(lower(trim(email)));
CREATE UNIQUE INDEX auth_user_email_normalized_unique ON auth_user(lower(trim(email)));
CREATE TRIGGER auth_user_reserves_profile_email_insert
BEFORE INSERT ON auth_user
WHEN EXISTS (SELECT 1 FROM users WHERE lower(trim(email))=lower(trim(NEW.email)) AND id<>NEW.id)
BEGIN SELECT RAISE(ABORT, 'AUTH_EMAIL_RESERVATION_CONFLICT'); END;
CREATE TRIGGER auth_user_reserves_profile_email_update
BEFORE UPDATE OF email,id ON auth_user
WHEN EXISTS (SELECT 1 FROM users WHERE lower(trim(email))=lower(trim(NEW.email)) AND id<>NEW.id)
BEGIN SELECT RAISE(ABORT, 'AUTH_EMAIL_RESERVATION_CONFLICT'); END;
CREATE TRIGGER users_respect_auth_email_insert
BEFORE INSERT ON users
WHEN EXISTS (SELECT 1 FROM auth_user WHERE lower(trim(email))=lower(trim(NEW.email)) AND id<>NEW.id)
BEGIN SELECT RAISE(ABORT, 'AUTH_EMAIL_RESERVATION_CONFLICT'); END;
CREATE TRIGGER users_respect_auth_email_update
BEFORE UPDATE OF email,id ON users
WHEN EXISTS (SELECT 1 FROM auth_user WHERE lower(trim(email))=lower(trim(NEW.email)) AND id<>NEW.id)
BEGIN SELECT RAISE(ABORT, 'AUTH_EMAIL_RESERVATION_CONFLICT'); END;
