import type { Request, Response } from "express";
import * as PushDeviceService from "../services/push-device-service";
import * as PushService from "../services/push-service";
import { clientConfig } from "../services/push";
import { logger } from "../globals";

/** GET /push/config — which platforms are enabled and their public settings. */
export const getConfig = async (req: Request, res: Response) => {
    res.json(clientConfig());
};

/** GET /push/devices */
export const listDevices = async (req: Request, res: Response) => {
    res.json({ devices: PushDeviceService.listDevices() });
};

/**
 * POST /push/devices — register (or refresh) this device.
 * Body: { platform: "apns" | "webpush" | ..., token: string, data?: object, name?: string }
 */
export const registerDevice = async (req: Request, res: Response) => {
    const { platform, token, data, name } = req.body ?? {};
    if (typeof platform !== "string" || !platform.trim() || typeof token !== "string" || !token.trim()) {
        return res.status(400).json({ error: "platform and token are required" });
    }
    if (data !== undefined && data !== null && (typeof data !== "object" || Array.isArray(data))) {
        return res.status(400).json({ error: "data must be an object" });
    }

    const device = PushDeviceService.registerDevice({
        platform: platform.trim(),
        token: token.trim(),
        data: data ?? null,
        name: typeof name === "string" && name.trim() ? name.trim() : null,
    });
    logger.info(`Push: registered ${device.platform} device ${device.id}${device.name ? ` (${device.name})` : ""}`);
    res.json(device);
};

/** DELETE /push/devices/:deviceId */
export const deleteDevice = async (req: Request, res: Response) => {
    const id = Number(req.params["deviceId"]);
    if (!Number.isInteger(id)) {
        return res.status(400).json({ error: "Device ID is required" });
    }
    const result = PushDeviceService.deleteDevice(id);
    if (result.changes === 0) {
        return res.status(404).json({ error: "Device not found" });
    }
    logger.info(`Push: removed device ${id}`);
    res.json({ message: "Device removed" });
};

/** POST /push/devices/:deviceId/test — deliver a test notification. */
export const testDevice = async (req: Request, res: Response) => {
    const id = Number(req.params["deviceId"]);
    if (!Number.isInteger(id)) {
        return res.status(400).json({ error: "Device ID is required" });
    }
    const device = PushDeviceService.getDevice(id);
    if (!device) {
        return res.status(404).json({ error: "Device not found" });
    }
    const result = await PushService.sendToDevice(device, PushService.testNotification());
    if (!result.ok) {
        return res.status(502).json({ error: result.error, unregistered: result.unregistered ?? false });
    }
    res.json({ message: "Test notification sent" });
};
