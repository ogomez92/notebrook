import http2 from "http2";
import { readFileSync } from "fs";
import { signES256 } from "../../utils/es256-jwt";
import { logger } from "../../globals";
import {
    APNS_BUNDLE_ID, APNS_KEY, APNS_KEY_ID, APNS_KEY_PATH, APNS_PRODUCTION, APNS_TEAM_ID
} from "../../config";
import type { PushDevice, PushNotification, PushProvider, PushResult } from "./types";

const SANDBOX_HOST = "https://api.sandbox.push.apple.com";
const PRODUCTION_HOST = "https://api.push.apple.com";

// Apple accepts a provider token for up to an hour and asks that it not be
// refreshed more often than every 20 minutes.
const TOKEN_LIFETIME_MS = 50 * 60 * 1000;

// APNs reasons after which the token will never work again.
const DEAD_TOKEN_REASONS = new Set(["BadDeviceToken", "Unregistered", "DeviceTokenNotForTopic", "ExpiredToken"]);

/**
 * Sends alerts to iOS devices through APNs over HTTP/2 using token-based
 * (.p8) authentication. One session is kept open and lazily re-established
 * when Apple closes it.
 */
export class APNsProvider implements PushProvider {
    readonly platform = "apns" as const;

    private readonly host: string;
    private readonly privateKey: string;
    private session: http2.ClientHttp2Session | null = null;
    private cachedToken: { value: string; issuedAt: number } | null = null;

    /** Builds the provider, or returns null when APNs isn't configured. */
    static fromConfig(): APNsProvider | null {
        let key = APNS_KEY;
        if (!key && APNS_KEY_PATH) {
            try {
                key = readFileSync(APNS_KEY_PATH, "utf8");
            } catch (e) {
                logger.warn(`APNs: cannot read key at ${APNS_KEY_PATH}: ${e}`);
                return null;
            }
        }
        if (!key || !APNS_KEY_ID || !APNS_TEAM_ID || !APNS_BUNDLE_ID) {
            return null;
        }
        return new APNsProvider(key, APNS_PRODUCTION ? PRODUCTION_HOST : SANDBOX_HOST);
    }

    constructor(privateKey: string, host: string) {
        this.privateKey = privateKey;
        this.host = host;
    }

    async send(device: PushDevice, notification: PushNotification): Promise<PushResult> {
        const payload = JSON.stringify({
            aps: {
                alert: { title: notification.title, body: notification.body },
                sound: "default",
                ...(notification.threadId ? { "thread-id": notification.threadId } : {}),
            },
            ...notification.data,
        });

        try {
            const { status, body } = await this.request(device.token, payload);
            if (status === 200) {
                return { ok: true };
            }
            let reason = body;
            try {
                reason = JSON.parse(body).reason ?? body;
            } catch {
                // Not JSON; keep the raw body as the reason.
            }
            return {
                ok: false,
                error: `APNs ${status}: ${reason}`,
                unregistered: status === 410 || DEAD_TOKEN_REASONS.has(reason),
            };
        } catch (e: any) {
            return { ok: false, error: `APNs transport error: ${e?.message ?? e}` };
        }
    }

    private request(deviceToken: string, payload: string): Promise<{ status: number; body: string }> {
        return new Promise((resolve, reject) => {
            const session = this.getSession();
            const req = session.request({
                ":method": "POST",
                ":path": `/3/device/${deviceToken}`,
                "authorization": `bearer ${this.providerToken()}`,
                "apns-topic": APNS_BUNDLE_ID,
                "apns-push-type": "alert",
                "apns-priority": "10",
                "apns-expiration": String(Math.floor(Date.now() / 1000) + 24 * 60 * 60),
                "content-type": "application/json",
            });

            let status = 0;
            const chunks: Buffer[] = [];
            req.on("response", (headers) => {
                status = Number(headers[":status"] ?? 0);
            });
            req.on("data", (chunk: Buffer) => chunks.push(chunk));
            req.on("end", () => resolve({ status, body: Buffer.concat(chunks).toString("utf8") }));
            req.on("error", reject);
            req.setTimeout(15_000, () => {
                req.close(http2.constants.NGHTTP2_CANCEL);
                reject(new Error("timeout"));
            });
            req.end(payload);
        });
    }

    private getSession(): http2.ClientHttp2Session {
        if (this.session && !this.session.closed && !this.session.destroyed) {
            return this.session;
        }
        const session = http2.connect(this.host);
        session.on("error", (e) => logger.warn(`APNs session error: ${e.message}`));
        session.on("close", () => {
            if (this.session === session) this.session = null;
        });
        this.session = session;
        return session;
    }

    private providerToken(): string {
        const now = Date.now();
        if (this.cachedToken && now - this.cachedToken.issuedAt < TOKEN_LIFETIME_MS) {
            return this.cachedToken.value;
        }
        const value = signES256(
            { kid: APNS_KEY_ID },
            { iss: APNS_TEAM_ID, iat: Math.floor(now / 1000) },
            this.privateKey
        );
        this.cachedToken = { value, issuedAt: now };
        return value;
    }
}
