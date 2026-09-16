import { logger } from "../globals";
import { PUSH_BODY_MAX_LENGTH } from "../config";
import * as ChannelService from "./channel-service";
import * as PushDeviceService from "./push-device-service";
import { getProvider, type PushDevice, type PushNotification, type PushResult } from "./push";

/**
 * Sends one notification to one device through its platform's provider and
 * forgets the device if the provider reports it as gone.
 */
export const sendToDevice = async (device: PushDevice, notification: PushNotification): Promise<PushResult> => {
    const provider = getProvider(device.platform);
    if (!provider) {
        return { ok: false, error: `No push provider configured for platform "${device.platform}"` };
    }

    const result = await provider.send(device, notification);
    if (result.ok) {
        logger.info(`Push: delivered to ${describe(device)}`);
    } else if (result.unregistered) {
        logger.warn(`Push: ${describe(device)} is no longer reachable (${result.error}); removing it`);
        PushDeviceService.deleteDevice(device.id);
    } else {
        logger.warn(`Push: failed for ${describe(device)}: ${result.error}`);
    }
    return result;
};

export interface NewMessageEvent {
    channelId: number;
    messageId: number;
    content: string;
    /**
     * Device that posted the message (from the X-Device-Id request header),
     * so the sender's own device isn't buzzed about its own note.
     */
    originDeviceId?: number | null;
}

/** Fans a new message out to every registered device if its channel is marked. */
export const notifyNewMessage = async (event: NewMessageEvent): Promise<void> => {
    const channel = ChannelService.getChannel(event.channelId);
    if (!channel?.notify) {
        return;
    }

    const devices = PushDeviceService.listDevices()
        .filter((device) => device.id !== event.originDeviceId);
    if (devices.length === 0) {
        return;
    }

    const notification: PushNotification = {
        title: `#${channel.name}`,
        body: excerpt(event.content),
        threadId: `channel-${channel.id}`,
        data: { kind: "message", channelId: channel.id, messageId: event.messageId },
    };

    await Promise.allSettled(devices.map((device) => sendToDevice(device, notification)));
};

export const testNotification = (): PushNotification => ({
    title: "Notebrook",
    body: "Push notifications are working on this device.",
    data: { kind: "test" },
});

/** First line(s) of the message, cut to a notification-sized excerpt. */
export const excerpt = (content: string): string => {
    const collapsed = content.replace(/\s+/g, " ").trim();
    if (collapsed.length <= PUSH_BODY_MAX_LENGTH) {
        return collapsed;
    }
    return `${collapsed.slice(0, PUSH_BODY_MAX_LENGTH - 1).trimEnd()}…`;
};

const describe = (device: PushDevice) =>
    `${device.platform} device ${device.id}${device.name ? ` (${device.name})` : ""}`;
