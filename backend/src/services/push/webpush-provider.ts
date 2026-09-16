import webpush, { WebPushError, type PushSubscription } from "web-push";
import { VAPID_PRIVATE_KEY, VAPID_PUBLIC_KEY, VAPID_SUBJECT } from "../../config";
import type { PushDevice, PushNotification, PushProvider, PushResult } from "./types";

/**
 * Delivers to browsers via the Web Push protocol (RFC 8030/8291/8292). The
 * `web-push` package handles VAPID signing and payload encryption.
 *
 * A registered device stores the subscription endpoint as `token` and the
 * encryption keys in `data.keys` — exactly what `PushSubscription.toJSON()`
 * returns in the browser.
 */
export class WebPushProvider implements PushProvider {
    readonly platform = "webpush" as const;

    /** Builds the provider, or returns null when VAPID keys aren't configured. */
    static fromConfig(): WebPushProvider | null {
        if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) {
            return null;
        }
        webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
        return new WebPushProvider();
    }

    async send(device: PushDevice, notification: PushNotification): Promise<PushResult> {
        const keys = (device.data as { keys?: { p256dh?: string; auth?: string } } | null)?.keys;
        if (!keys?.p256dh || !keys?.auth) {
            return { ok: false, error: "Web Push device is missing encryption keys", unregistered: true };
        }
        const subscription: PushSubscription = {
            endpoint: device.token,
            keys: { p256dh: keys.p256dh, auth: keys.auth },
        };

        // The service worker (frontend-vue/public/push-sw.js) reads this shape.
        const payload = JSON.stringify({
            title: notification.title,
            body: notification.body,
            tag: notification.threadId,
            data: notification.data,
        });

        try {
            await webpush.sendNotification(subscription, payload, { TTL: 24 * 60 * 60, urgency: "high" });
            return { ok: true };
        } catch (e: any) {
            if (e instanceof WebPushError) {
                return {
                    ok: false,
                    error: `Web Push ${e.statusCode}: ${e.body || e.message}`,
                    // 404/410 mean the subscription is gone for good.
                    unregistered: e.statusCode === 404 || e.statusCode === 410,
                };
            }
            // Transport failures surface as bare node errors whose message can be
            // empty; fall back to the error code so the log says something useful.
            return { ok: false, error: `Web Push error: ${e?.message || e?.code || String(e)}` };
        }
    }
}
