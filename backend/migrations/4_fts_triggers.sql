-- Keep the messages_fts full-text index in sync with the messages table via
-- triggers, so EVERY path that changes messages stays consistent: app code,
-- ON DELETE CASCADE when a channel is deleted, the startup dedupe job, and
-- restore. Previously the index was maintained by hand in application code,
-- which cascade deletes bypassed and left stale rows behind.

CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
END;

CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.id, old.content);
END;

CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE OF content ON messages
  WHEN old.content IS NOT new.content
BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.id, old.content);
  INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
END;

-- Rebuild once to correct any staleness accumulated before these triggers
-- existed (e.g. messages removed via a channel-delete cascade).
INSERT INTO messages_fts(messages_fts) VALUES ('rebuild');
