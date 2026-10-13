BEGIN;
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nickname varchar(40) NOT NULL,
  leaderboard_opt_in boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE identities (
  provider text NOT NULL,
  provider_app_id text NOT NULL,
  provider_subject text NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY(provider, provider_app_id, provider_subject)
);
CREATE TABLE activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_request_id uuid NOT NULL,
  kind text NOT NULL CHECK(kind IN ('water', 'urination', 'bowel')),
  amount_ml integer,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'water' AND amount_ml IS NOT NULL AND amount_ml BETWEEN 1 AND 2000)
    OR (kind <> 'water' AND amount_ml IS NULL)),
  UNIQUE(user_id, client_request_id)
);
CREATE INDEX activities_user_time ON activities(user_id, occurred_at);
-- Read via the server only; never expose database credentials to clients.
COMMIT;
