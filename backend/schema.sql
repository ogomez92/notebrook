CREATE TABLE IF NOT EXISTS channels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channelId INTEGER,
  filePath TEXT,
  fileType TEXT,
  fileSize INTEGER,
  originalName TEXT,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (channelId) REFERENCES channels (id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channelId INTEGER,
  content TEXT,
  fileId INTEGER NULL,
  checked INTEGER NULL,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (channelId) REFERENCES channels (id) ON DELETE CASCADE,
  FOREIGN KEY (fileId) REFERENCES files (id) ON DELETE
  SET
    NULL
); 
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  content,
  content = 'messages',
  content_rowid = 'id'
);

-- Triggers keep messages_fts in sync with messages automatically (see
-- migrations/4_fts_triggers.sql).
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
