/**
 * Provider-agnostic push model. Everything client-facing (registration, channel
 * marking, dispatch) is written against these types, so adding a platform means
 * adding one `PushProvider` implementation and registering it in ./index.ts.
 */

/** Names a delivery provider. Stored verbatim in push_devices.platform. */
export type PushPlatform = "apns" | "webpush" | "fcm" | (string & {});

export interface PushDevice {
    id: number;
    platform: PushPlatform;
    /** Provider address: APNs device token, Web Push endpoint, FCM token, ... */
    token: string;
    /** Provider-specific extras (e.g. Web Push encryption keys). */
    data: Record<string, unknown> | null;
    /** Human label chosen by the client ("Oriol's iPhone", "Chrome on Mac"). */
    name: string | null;
    createdAt: string;
    lastSeenAt: string;
}

export interface PushNotification {
    title: string;
    body: string;
    /**
     * Groups notifications from the same channel (APNs thread-id, Web Push
     * tag). Optional; each message is still its own notification.
     */
    threadId?: string;
    /** Opaque payload handed to the client so it can deep-link. */
    data: {
        channelId?: number;
        messageId?: number;
        /** "message" for new messages, "test" for the settings-screen test. */
        kind: "message" | "test";
    };
}

export type PushResult =
    | { ok: true }
    | {
        ok: false;
        error: string;
        /**
         * The provider says this device can never be reached again (token
         * revoked, subscription expired). The dispatcher deletes it.
         */
        unregistered?: boolean;
    };

export interface PushProvider {
    readonly platform: PushPlatform;
    send(device: PushDevice, notification: PushNotification): Promise<PushResult>;
}
