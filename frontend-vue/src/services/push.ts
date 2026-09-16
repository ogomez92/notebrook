import { get, set, del } from 'idb-keyval'
import { apiService } from './api'
import type { PushDevice } from '@/types'

const DEVICE_ID_KEY = 'push_device_id'

export type PushState =
  | { status: 'unsupported' }
  | { status: 'denied' }
  /** Supported and allowed (or not yet asked), but this browser isn't registered. */
  | { status: 'off' }
  | { status: 'on'; deviceId: number }

/**
 * Web Push on the client side: subscribe this browser through the service
 * worker and hand the subscription to the server, which does the rest (which
 * channels notify, delivery, pruning). Mirrors PushManager in the iOS app.
 */
class PushService {
  isSupported(): boolean {
    return (
      typeof window !== 'undefined' &&
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      'Notification' in window
    )
  }

  async getState(): Promise<PushState> {
    if (!this.isSupported()) return { status: 'unsupported' }
    if (Notification.permission === 'denied') return { status: 'denied' }

    const [subscription, deviceId] = await Promise.all([this.currentSubscription(), get<number>(DEVICE_ID_KEY)])
    if (subscription && deviceId && Notification.permission === 'granted') {
      return { status: 'on', deviceId }
    }
    return { status: 'off' }
  }

  /**
   * Run at startup: tells the API which device we are (so our own messages
   * aren't pushed back to us) and refreshes the server's copy of the
   * subscription, since push services rotate endpoints now and then.
   */
  async restore(): Promise<void> {
    if (!this.isSupported()) return

    const deviceId = await get<number>(DEVICE_ID_KEY)
    if (!deviceId) return
    apiService.setDeviceId(deviceId)

    try {
      const subscription = await this.currentSubscription()
      if (!subscription || Notification.permission !== 'granted') {
        // Permission was revoked or the subscription is gone; nothing to keep.
        await this.forgetLocal()
        return
      }
      await this.register(subscription)
    } catch (error) {
      console.warn('Push: could not refresh registration', error)
    }
  }

  /** Asks for permission, subscribes, and registers with the server. */
  async enable(): Promise<PushDevice> {
    if (!this.isSupported()) {
      throw new Error('This browser does not support push notifications')
    }
    const registration = await navigator.serviceWorker.getRegistration()
    if (!registration) {
      throw new Error('No service worker is active; push works in the installed app or a production build')
    }

    const permission = await Notification.requestPermission()
    if (permission !== 'granted') {
      throw new Error('Notification permission was not granted')
    }

    const config = await apiService.getPushConfig()
    if (!config.webPush) {
      throw new Error('The server has no Web Push keys configured (see backend/PUSH.md)')
    }

    let subscription = await registration.pushManager.getSubscription()
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToBytes(config.webPush.publicKey)
      })
    }
    return this.register(subscription)
  }

  /** Unregisters from the server and drops the browser subscription. */
  async disable(): Promise<void> {
    const deviceId = await get<number>(DEVICE_ID_KEY)
    if (deviceId) {
      try {
        await apiService.deletePushDevice(deviceId)
      } catch (error) {
        console.warn('Push: server did not acknowledge unregistration', error)
      }
    }
    try {
      const subscription = await this.currentSubscription()
      await subscription?.unsubscribe()
    } catch (error) {
      console.warn('Push: could not unsubscribe', error)
    }
    await this.forgetLocal()
  }

  async sendTest(): Promise<void> {
    const deviceId = await get<number>(DEVICE_ID_KEY)
    if (!deviceId) {
      throw new Error('Enable notifications on this device first')
    }
    await apiService.testPushDevice(deviceId)
  }

  private async register(subscription: PushSubscription): Promise<PushDevice> {
    const json = subscription.toJSON()
    const device = await apiService.registerPushDevice({
      platform: 'webpush',
      token: subscription.endpoint,
      data: { keys: json.keys ?? {}, expirationTime: json.expirationTime ?? null },
      name: describeBrowser()
    })
    await set(DEVICE_ID_KEY, device.id)
    apiService.setDeviceId(device.id)
    return device
  }

  private async currentSubscription(): Promise<PushSubscription | null> {
    // `serviceWorker.ready` never resolves when no worker is registered (the
    // Vite dev server), so look the registration up instead of waiting on it.
    const registration = await navigator.serviceWorker.getRegistration()
    return (await registration?.pushManager.getSubscription()) ?? null
  }

  private async forgetLocal(): Promise<void> {
    await del(DEVICE_ID_KEY)
    apiService.setDeviceId(null)
  }
}

/** VAPID public keys are base64url; `subscribe()` wants the raw bytes. */
const base64UrlToBytes = (value: string): Uint8Array<ArrayBuffer> => {
  const padded = value + '='.repeat((4 - (value.length % 4)) % 4)
  const binary = atob(padded.replace(/-/g, '+').replace(/_/g, '/'))
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

/** A label for the device list, e.g. "Chrome on macOS". */
const describeBrowser = (): string => {
  const ua = navigator.userAgent
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /OPR\//.test(ua) ? 'Opera'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Firefox\//.test(ua) ? 'Firefox'
    : /Safari\//.test(ua) ? 'Safari'
    : 'Browser'
  const os = /iPhone|iPad/.test(ua) ? 'iOS'
    : /Android/.test(ua) ? 'Android'
    : /Mac OS/.test(ua) ? 'macOS'
    : /Windows/.test(ua) ? 'Windows'
    : /Linux/.test(ua) ? 'Linux'
    : ''
  return os ? `${browser} on ${os}` : browser
}

export const pushService = new PushService()
