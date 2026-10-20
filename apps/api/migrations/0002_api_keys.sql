-- API keys for client applications. Only an HMAC of the secret is stored (ADR 0004).
CREATE TABLE api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  -- Public part of the key, used to find it without scanning the table.
  prefix text NOT NULL UNIQUE CHECK (prefix ~ '^[a-z2-7]{8}$'),
  secret_hmac bytea NOT NULL CHECK (length(secret_hmac) = 32),
  scopes text[] NOT NULL DEFAULT '{}',
  expires_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX api_keys_created_at_idx ON api_keys (created_at DESC);
