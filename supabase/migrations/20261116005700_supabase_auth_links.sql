CREATE TABLE IF NOT EXISTS progresso_gang.auth_links (
  user_id text PRIMARY KEY REFERENCES progresso_gang.users(id),
  auth_user_id text NOT NULL UNIQUE,
  email text NOT NULL,
  activated_at bigint
);
ALTER TABLE progresso_gang.auth_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON progresso_gang.auth_links FROM PUBLIC, anon, authenticated;
