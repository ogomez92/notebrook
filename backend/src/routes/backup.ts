import { Router, type Request, type Response } from 'express';
import { authenticate } from '../middleware/auth';
import { db, FTS5Enabled } from '../db';
import { DB_PATH } from '../config';
import { logger } from '../globals';
import Database from 'better-sqlite3';
import multer from 'multer';
import { unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

export const router = Router();

const upload = multer({ dest: tmpdir() });

// GET /backup - Download the entire database as a .db file
router.get('/', authenticate, async (req: Request, res: Response) => {
  try {
    logger.info('Creating database backup...');

    // Use better-sqlite3's backup API to create a safe copy
    const backupPath = join(tmpdir(), `notebrook-backup-${Date.now()}.db`);
    await db.backup(backupPath);

    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `notebrook-backup-${timestamp}.db`;

    res.download(backupPath, filename, async (err) => {
      // Clean up temp file after download
      try {
        await unlink(backupPath);
      } catch (e) {
        logger.warn(`Failed to clean up backup temp file: ${e}`);
      }

      if (err) {
        logger.critical(`Backup download error: ${err}`);
      } else {
        logger.info('Backup download completed');
      }
    });
  } catch (error) {
    logger.critical(`Backup failed: ${error}`);
    res.status(500).json({ error: 'Failed to create backup' });
  }
});

// POST /restore - Upload a .db file and restore the database
router.post('/', authenticate, upload.single('database'), async (req: Request, res: Response) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No database file provided' });
  }

  const uploadedPath = req.file.path;

  try {
    logger.info(`Restoring database from uploaded file: ${uploadedPath}`);

    // Open the uploaded database to validate and read data
    const uploadedDb = new Database(uploadedPath, { readonly: true });

    // Validate that it has the expected tables
    const tables = uploadedDb.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as { name: string }[];
    const tableNames = tables.map(t => t.name);

    if (!tableNames.includes('channels') || !tableNames.includes('messages')) {
      uploadedDb.close();
      await unlink(uploadedPath);
      return res.status(400).json({ error: 'Invalid backup file: missing required tables' });
    }

    // Read all data from uploaded database
    const channels = uploadedDb.prepare('SELECT * FROM channels').all();
    const messages = uploadedDb.prepare('SELECT * FROM messages').all();
    const files = tableNames.includes('files')
      ? uploadedDb.prepare('SELECT * FROM files').all()
      : [];

    uploadedDb.close();

    // Begin transaction to restore data
    const transaction = db.transaction(() => {
      // Clear existing data. Deleting messages fires the FTS delete triggers,
      // so messages_fts clears itself — a manual wipe here would corrupt the
      // index by double-deleting rows the triggers also remove.
      db.exec('DELETE FROM messages');
      db.exec('DELETE FROM files');
      db.exec('DELETE FROM channels');

      // Reset auto-increment counters
      db.exec(`DELETE FROM sqlite_sequence WHERE name IN ('channels', 'messages', 'files')`);

      // Insert channels. Column names are the schema's camelCase, and each bind
      // object is built explicitly so a backup from a slightly different schema
      // version (missing/extra columns) still restores cleanly.
      if (channels.length > 0) {
        const insertChannel = db.prepare(`
          INSERT INTO channels (id, name, createdAt) VALUES (@id, @name, @createdAt)
        `);
        for (const channel of channels as any[]) {
          insertChannel.run({
            id: channel.id,
            name: channel.name,
            createdAt: channel.createdAt ?? null
          });
        }
      }

      // Insert files first (messages reference files)
      if (files.length > 0) {
        const insertFile = db.prepare(`
          INSERT INTO files (id, channelId, filePath, fileType, fileSize, originalName, createdAt)
          VALUES (@id, @channelId, @filePath, @fileType, @fileSize, @originalName, @createdAt)
        `);
        for (const file of files as any[]) {
          insertFile.run({
            id: file.id,
            channelId: file.channelId ?? null,
            filePath: file.filePath ?? null,
            fileType: file.fileType ?? null,
            fileSize: file.fileSize ?? null,
            originalName: file.originalName ?? null,
            createdAt: file.createdAt ?? null
          });
        }
      }

      // Insert messages
      if (messages.length > 0) {
        const insertMessage = db.prepare(`
          INSERT INTO messages (id, channelId, content, fileId, checked, createdAt)
          VALUES (@id, @channelId, @content, @fileId, @checked, @createdAt)
        `);
        for (const message of messages as any[]) {
          insertMessage.run({
            id: message.id,
            channelId: message.channelId ?? null,
            content: message.content ?? null,
            fileId: message.fileId ?? null,
            checked: message.checked ?? null,
            createdAt: message.createdAt ?? null
          });
        }

        // The insert triggers repopulate messages_fts as rows are inserted;
        // rebuild once more to guarantee the index matches the restored data.
        if (FTS5Enabled) {
          db.exec(`INSERT INTO messages_fts(messages_fts) VALUES('rebuild')`);
        }
      }
    });

    transaction();

    // Clean up uploaded file
    await unlink(uploadedPath);

    logger.info('Database restore completed successfully');
    res.json({
      success: true,
      message: 'Database restored successfully',
      stats: {
        channels: channels.length,
        messages: messages.length,
        files: files.length
      }
    });
  } catch (error) {
    logger.critical(`Restore failed: ${error}`);

    // Clean up uploaded file on error
    try {
      await unlink(uploadedPath);
    } catch (e) {
      // Ignore cleanup errors
    }

    res.status(500).json({ error: 'Failed to restore database: ' + (error as Error).message });
  }
});
