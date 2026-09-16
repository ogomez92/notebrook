import { events, logger } from "../globals";
import { providers } from "../services/push";
import { notifyNewMessage } from "../services/push-service";

/**
 * Bridges the in-process `message-created` event to push delivery. Every path
 * that creates a message (API, /feedsend, unsent-queue retries) emits that
 * event, so they all notify without knowing about push.
 */
export const pushNotificationsJob = () => {
    // Build the provider registry now so misconfiguration shows up in the
    // startup log rather than on the first message.
    providers();

    events.on("message-created", (id, channelId, content, meta?: { originDeviceId?: number | null }) => {
        notifyNewMessage({
            messageId: Number(id),
            channelId: Number(channelId),
            content: String(content ?? ""),
            originDeviceId: meta?.originDeviceId ?? null,
        }).catch((e) => logger.warn(`Push: dispatch failed: ${e?.message ?? e}`));
    });
};
