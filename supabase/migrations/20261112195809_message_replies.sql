ALTER TABLE progresso_gang.messages
  ADD COLUMN IF NOT EXISTS reply_to_id bigint REFERENCES progresso_gang.messages(id);

CREATE INDEX IF NOT EXISTS messages_reply_to_id_idx
  ON progresso_gang.messages(reply_to_id);
