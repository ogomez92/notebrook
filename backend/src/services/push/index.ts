import { logger } from "../../globals";
import { VAPID_PUBLIC_KEY } from "../../config";
import { APNsProvider } from "./apns-provider";
import { WebPushProvider } from "./webpush-provider";
import type { PushPlatform, PushProvider } from "./types";

export type { PushDevice, PushNotification, PushPlatform, PushProvider, PushResult } from "./types";

/**
 * Registry of configured providers, keyed by platform. To support another
 * platform (e.g. FCM for Android), implement `PushProvider` and add its
 * `fromConfig()` to `buildRegistry`; nothing else in the server needs to change.
 *
 * Built lazily: this module is reached through globals.ts → jobs, so anything
 * done at import time would run before the shared logger exists.
 */
let registry: Map<PushPlatform, PushProvider> | null = null;

const buildRegistry = (): Map<PushPlatform, PushProvider> => {
    const providers = new Map<PushPlatform, PushProvider>();
    for (const provider of [APNsProvider.fromConfig(), WebPushProvider.fromConfig()]) {
        if (provider) {
            providers.set(provider.platform, provider);
        }
    }
    if (providers.size === 0) {
        logger.info("Push: no provider configured; notifications will not be delivered (see PUSH.md)");
    } else {
        logger.info(`Push: providers enabled: ${[...providers.keys()].join(", ")}`);
    }
    return providers;
};

/** Configured providers; built on first use. */
export const providers = (): Map<PushPlatform, PushProvider> => {
    if (!registry) {
        registry = buildRegistry();
    }
    return registry;
};

export const getProvider = (platform: PushPlatform): PushProvider | undefined => providers().get(platform);

export const enabledPlatforms = (): PushPlatform[] => [...providers().keys()];

/** What a client needs to know before registering, safe to expose to it. */
export const clientConfig = () => ({
    platforms: enabledPlatforms(),
    webPush: providers().has("webpush") ? { publicKey: VAPID_PUBLIC_KEY } : null,
});
