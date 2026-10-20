-- ABAC policies evaluated by POST /v1/authorize (docs/architecture/authorization-model.md).
-- The application validates every policy with Zod before writing it and again when reading it.
CREATE TABLE policies (
  id text PRIMARY KEY CHECK (id ~ '^[a-z0-9][a-z0-9-]{1,63}$'),
  description text NOT NULL DEFAULT '',
  effect text NOT NULL CHECK (effect IN ('allow', 'deny')),
  actions text[] NOT NULL CHECK (cardinality(actions) > 0),
  resources text[] NOT NULL CHECK (cardinality(resources) > 0),
  roles text[] NOT NULL DEFAULT '{}',
  condition jsonb,
  updated_by uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
