import { db } from "../db";
import { events } from "../globals";
import * as FileService from "./file-service";

export const createMessage = async (channelId: string, content: string) => {
  const query = db.prepare(`INSERT INTO messages (channelId, content, checked) VALUES ($channelId, $content, NULL)`);
  const result = query.run({ channelId: channelId, content: content });

  const messageId = result.lastInsertRowid;
  // messages_fts is kept in sync by database triggers (migrations/4_fts_triggers.sql).

  events.emit('message-created', messageId, channelId, content);
  return messageId;
}

export const updateMessage = async (messageId: string, content: string, append: boolean = false) => {
  const query = db.prepare(`UPDATE messages SET content = $content WHERE id = $id`);
  const result = query.run({ content: content, id: messageId });

  events.emit('message-updated', messageId, content);
  return result;
}

export const deleteMessage = async (messageId: string) => {
  // Remove any attached file (from disk and the files table) before the message
  // itself, so deleting a message never leaves an orphaned upload behind.
  await FileService.deleteFileForMessage(messageId);

  const query = db.prepare(`DELETE FROM messages WHERE id = $id`);
  const result = query.run({ id: messageId });

  events.emit('message-deleted', messageId);
  return result;
}

export const getMessages = async (channelId: string) => {
  const query = db.prepare(`
        SELECT 
          messages.id, messages.channelId, messages.content, messages.createdAt, messages.checked,
          files.id as fileId, files.filePath, files.fileType, files.createdAt as fileCreatedAt, files.originalName, files.fileSize
        FROM 
          messages
        LEFT JOIN 
          files 
        ON 
          messages.fileId = files.id
        WHERE 
          messages.channelId = $channelId
      `);
  const rows = query.all({ channelId: channelId });
  return rows;
}

export const getMessage = async (id: string) => {
  const query = db.prepare(`
        SELECT 
          messages.id, messages.channelId, messages.content, messages.createdAt, messages.checked,
          files.id as fileId, files.filePath, files.fileType, files.createdAt as fileCreatedAt, files.originalName, files.fileSize
        FROM 
          messages
        LEFT JOIN 
          files 
        ON 
          messages.fileId = files.id
        WHERE 
          messages.id = $id
      `);
  const row = query.get({ id: id });
  return row;
}

export const setMessageChecked = async (messageId: string, checked: boolean | null) => {
  const query = db.prepare(`UPDATE messages SET checked = $checked WHERE id = $id`);
  // SQLite stores booleans as integers; NULL for unknown
  const value = checked === null ? null : (checked ? 1 : 0);
  const result = query.run({ id: messageId, checked: value });
  events.emit('message-updated', messageId, { checked: value });
  return result;
}

export const moveMessage = async (messageId: string, targetChannelId: string) => {
  // Get current message to emit proper events
  const currentMessage = await getMessage(messageId);
  if (!currentMessage) {
    throw new Error('Message not found');
  }
  
  const query = db.prepare(`UPDATE messages SET channelId = $targetChannelId WHERE id = $messageId`);
  const result = query.run({ messageId: messageId, targetChannelId: targetChannelId });
  
  if (result.changes === 0) {
    throw new Error('Message not found or not updated');
  }
  
  // A move only changes channelId, not content, so the FTS index is unaffected.
  
  events.emit('message-moved', messageId, (currentMessage as any).channelId, targetChannelId);
  return result;
}
