BEGIN;
CREATE TABLE IF NOT EXISTS progresso_gang.invite_requests (
  id text PRIMARY KEY,
  name text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 80),
  email text NOT NULL CHECK (char_length(email) BETWEEN 3 AND 254),
  created_at bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS invite_requests_created_idx ON progresso_gang.invite_requests(created_at DESC, id);
CREATE TABLE IF NOT EXISTS progresso_gang.invite_request_reads (
  request_id text NOT NULL REFERENCES progresso_gang.invite_requests(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES progresso_gang.users(id) ON DELETE CASCADE,
  read_at bigint NOT NULL,
  PRIMARY KEY (request_id, user_id)
);
CREATE INDEX IF NOT EXISTS invite_request_reads_user_idx ON progresso_gang.invite_request_reads(user_id, request_id);
ALTER TABLE progresso_gang.invite_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE progresso_gang.invite_request_reads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON progresso_gang.invite_requests, progresso_gang.invite_request_reads FROM PUBLIC, anon, authenticated;
COMMIT;
