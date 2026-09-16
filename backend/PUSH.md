# Push notifications

Mark a channel with **notify** and every new message posted to it (from any
client, the API, or `/feedsend`) is pushed to every registered device. The
server owns the whole pipeline; clients only do two things:

1. **Register a device** — `POST /push/devices` with the address their
   platform's push service gave them.
2. **Mark channels** — `PUT /channels/:id/notify` with `{ "notify": true }`.

Everything else (who gets what, retries, pruning dead devices, skipping the
sender) lives in `src/services/push-service.ts`.

## Configuration

Nothing is required. A provider is enabled only when all of its variables are
set; the server logs which ones came up at startup.

### iOS (APNs)

Create a key at developer.apple.com → Certificates, Identifiers & Profiles →
Keys, with the *Apple Push Notifications service (APNs)* capability, and
download the `.p8` file.

```
APNS_KEY_PATH=/nb/AuthKey_ABC123DEFG.p8   # or APNS_KEY="-----BEGIN PRIVATE KEY-----\n..."
APNS_KEY_ID=ABC123DEFG
APNS_TEAM_ID=4TH9Y6ZAQC
APNS_BUNDLE_ID=com.oriolgomez.notebrook
APNS_PRODUCTION=0     # 1 for TestFlight / App Store builds
```

Xcode debug builds get sandbox tokens and TestFlight/App Store builds get
production tokens; a token sent to the wrong gateway is rejected as
`BadDeviceToken` and the device is removed, so set `APNS_PRODUCTION` to match
the build you're testing.

### Browsers (Web Push)

```
npm run push:vapid
```

prints a key pair. Put it in `.env` together with a contact address:

```
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:you@example.com
```

The web app fetches the public key from `GET /push/config`, so nothing needs to
be built into the frontend. Web Push requires the site to be served over HTTPS
(or `localhost`). On iOS Safari it only works after the site is added to the
Home Screen.

## API

All endpoints require the usual `Authorization` token.

| Method | Path | Body | Purpose |
| --- | --- | --- | --- |
| `GET` | `/push/config` | | `{ platforms: ["apns","webpush"], webPush: { publicKey } \| null }` |
| `GET` | `/push/devices` | | List registered devices |
| `POST` | `/push/devices` | `{ platform, token, data?, name? }` | Register or refresh a device (idempotent on `platform`+`token`) |
| `DELETE` | `/push/devices/:id` | | Forget a device |
| `POST` | `/push/devices/:id/test` | | Send a test notification to that device |
| `PUT` | `/channels/:id/notify` | `{ notify: boolean }` | Mark / unmark a channel |

`GET /channels` now includes `notify` on every channel, and marking one emits
a `channel-notify-updated` WebSocket event with `{ id, notify }`.

Clients may send `X-Device-Id: <their device id>` on requests; a message
created with that header is not pushed back to that device.

### Device shapes

| platform | token | data |
| --- | --- | --- |
| `apns` | hex device token from `didRegisterForRemoteNotificationsWithDeviceToken` | — |
| `webpush` | `PushSubscription.endpoint` | `{ keys: { p256dh, auth } }` (the rest of `PushSubscription.toJSON()`) |

### Payloads

APNs: `aps.alert.title` = `#channel`, `aps.alert.body` = message excerpt,
`aps.thread-id` = `channel-<id>`, plus top-level `kind`, `channelId`,
`messageId`.

Web Push (JSON): `{ title, body, tag, data: { kind, channelId, messageId } }`,
rendered by `frontend-vue/public/push-sw.js`.

## Adding a platform (e.g. Android / FCM)

1. Implement `PushProvider` from `src/services/push/types.ts` in
   `src/services/push/fcm-provider.ts` with a `static fromConfig()` that
   returns `null` when its environment variables are missing.
2. Add it to the list in `src/services/push/index.ts`.
3. Have the client `POST /push/devices` with `platform: "fcm"` and its
   registration token, and send `X-Device-Id` on requests.

Nothing else changes: registration, channel marking, dispatch, dead-device
pruning and the test endpoint are platform-agnostic.
