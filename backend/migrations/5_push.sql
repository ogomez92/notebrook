-- Push notifications.
--
-- channels.notify: when set, every new message posted to the channel is pushed
-- to all registered devices. It is a property of the channel (not of a device)
-- so marking a channel on one client is visible on every other client.
ALTER TABLE channels ADD COLUMN notify INTEGER NOT NULL DEFAULT 0;

-- One row per (platform, token). `platform` names the delivery provider
-- ('apns', 'webpush', later 'fcm', ...); `token` is whatever that provider
-- needs to address the device (APNs device token, Web Push endpoint, FCM
-- registration token). `data` carries provider-specific extras as JSON, e.g.
-- the Web Push encryption keys. The unique constraint makes registration an
-- idempotent upsert so clients can re-register on every launch.
CREATE TABLE IF NOT EXISTS push_devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    platform TEXT NOT NULL,
    token TEXT NOT NULL,
    data TEXT NULL,
    name TEXT NULL,
    createdAt DATETIME DEFAULT (datetime('now', 'localtime')),
    lastSeenAt DATETIME DEFAULT (datetime('now', 'localtime')),
    UNIQUE (platform, token)
);
