-- Accounts and roles. E-mail uniqueness ignores case thanks to citext.
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE CHECK (name ~ '^[a-z][a-z0-9-]{1,49}$'),
  description text NOT NULL DEFAULT '',
  -- Actions such as "users:read" or "users:*"; "*" grants everything.
  permissions text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email citext NOT NULL UNIQUE CHECK (length(email) <= 254),
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 120),
  password_hash text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  -- AES-256-GCM sealed TOTP seed (ADR 0004) and the last accepted time step (replay protection).
  totp_secret bytea,
  totp_enabled_at timestamptz,
  totp_last_step bigint,
  password_changed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((totp_enabled_at IS NULL) OR (totp_secret IS NOT NULL))
);

-- Keyset pagination of the account list, newest first.
CREATE INDEX users_created_at_id_idx ON users (created_at DESC, id DESC);

CREATE TABLE user_roles (
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES roles (id) ON DELETE CASCADE,
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role_id)
);

CREATE INDEX user_roles_role_id_idx ON user_roles (role_id);

INSERT INTO roles (name, description, permissions) VALUES
  ('admin', 'Full administration of ShieldGate', ARRAY['*']),
  ('security-analyst', 'Reads accounts, sessions, policies and the audit trail',
    ARRAY['users:read', 'sessions:read', 'policies:read', 'audit:read']),
  ('member', 'Manages only their own account', ARRAY[]::text[]);
