import { db } from "../db";
import { events, logger } from "../globals";
import { unlink, rm } from "fs/promises";
import path from "path";
import { UPLOAD_DIR } from "../config";

export const uploadFile = async (channelId: string, messageId: string, filePath: string, fileType: string, fileSize: number, originalName: string) => {
    const query = db.prepare(`INSERT INTO files (channelId, filePath, fileType, fileSize, originalName) VALUES ($channelId, $filePath, $fileType, $fileSize, $originalName)`);
    const result = query.run({ channelId: channelId, filePath: filePath, fileType: fileType, fileSize: fileSize, originalName: originalName });

    const fileId = result.lastInsertRowid;

    const updateQuery = db.prepare(`UPDATE messages SET fileId = $fileId WHERE id = $messageId`);
    const result2 = updateQuery.run({ fileId: fileId, messageId: messageId });

    events.emit('file-uploaded', result.lastInsertRowid, channelId, messageId, filePath, fileType, fileSize, originalName);
    return result;
}

// Remove the file attached to a message (both the file on disk and its DB row),
// if any. Safe to call for messages without an attachment.
export const deleteFileForMessage = async (messageId: string) => {
    const file = db.prepare(`
        SELECT files.id AS id, files.filePath AS filePath
        FROM files
        JOIN messages ON messages.fileId = files.id
        WHERE messages.id = $messageId
    `).get({ messageId: messageId }) as { id: number; filePath: string } | undefined;

    if (!file) return;

    if (file.filePath) {
        // Stored paths are relative to UPLOAD_DIR (older records may be absolute).
        const absolutePath = path.isAbsolute(file.filePath) ? file.filePath : path.join(UPLOAD_DIR, file.filePath);
        try {
            await unlink(absolutePath);
        } catch (err: any) {
            // A missing file is fine (already gone); log anything else.
            if (err?.code !== "ENOENT") {
                logger.warn(`Failed to delete file from disk (${absolutePath}): ${err?.message ?? err}`);
            }
        }
    }

    db.prepare(`DELETE FROM files WHERE id = $id`).run({ id: file.id });
}

// Remove every file (on disk and in the files table) belonging to a channel.
// The schema's ON DELETE CASCADE already clears the rows when the channel is
// deleted, but it can't touch the files on disk — that's the point of this. The
// row delete here keeps the helper correct even if called on its own.
export const deleteFilesForChannel = async (channelId: string) => {
    const files = db.prepare(`SELECT id AS id, filePath AS filePath FROM files WHERE channelId = $channelId`)
        .all({ channelId: channelId }) as { id: number; filePath: string }[];

    for (const file of files) {
        if (!file.filePath) continue;
        const absolutePath = path.isAbsolute(file.filePath) ? file.filePath : path.join(UPLOAD_DIR, file.filePath);
        try {
            await unlink(absolutePath);
        } catch (err: any) {
            if (err?.code !== "ENOENT") {
                logger.warn(`Failed to delete file from disk (${absolutePath}): ${err?.message ?? err}`);
            }
        }
    }

    // Best-effort: remove the channel's upload subfolder (created by the uploader).
    try {
        await rm(path.join(UPLOAD_DIR, String(channelId)), { recursive: true, force: true });
    } catch (err: any) {
        logger.warn(`Failed to remove channel upload dir for ${channelId}: ${err?.message ?? err}`);
    }

    db.prepare(`DELETE FROM files WHERE channelId = $channelId`).run({ channelId: channelId });
}

export const getFiles = async (messageId: string) => {
    // Get the file linked to this message via the fileId in the messages table
    const query = db.prepare(`
        SELECT files.* FROM files 
        JOIN messages ON messages.fileId = files.id 
        WHERE messages.id = $messageId
    `);
    const rows = query.all({ messageId: messageId });
    return rows;
}