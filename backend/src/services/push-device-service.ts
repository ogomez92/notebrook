import { db } from "../db";
import type { PushDevice, PushPlatform } from "./push/types";

interface Row {
    id: number;
    platform: string;
    token: string;
    data: string | null;
    name: string | null;
    createdAt: string;
    lastSeenAt: string;
}

const fromRow = (row: Row): PushDevice => {
    let data: Record<string, unknown> | null = null;
    if (row.data) {
        try {
            data = JSON.parse(row.data);
        } catch {
            data = null;
        }
    }
    return { ...row, data };
};

export interface RegisterDeviceInput {
    platform: PushPlatform;
    token: string;
    data?: Record<string, unknown> | null;
    name?: string | null;
}

/**
 * Idempotent: registering the same (platform, token) again refreshes its
 * metadata and keeps its id, so clients can re-register on every launch.
 */
export const registerDevice = (input: RegisterDeviceInput): PushDevice => {
    const upsert = db.prepare(`
        INSERT INTO push_devices (platform, token, data, name)
        VALUES ($platform, $token, $data, $name)
        ON CONFLICT (platform, token) DO UPDATE SET
            data = excluded.data,
            name = COALESCE(excluded.name, push_devices.name),
            lastSeenAt = datetime('now', 'localtime')
    `);
    upsert.run({
        platform: input.platform,
        token: input.token,
        data: input.data ? JSON.stringify(input.data) : null,
        name: input.name ?? null,
    });
    const row = db.prepare(`SELECT * FROM push_devices WHERE platform = $platform AND token = $token`)
        .get({ platform: input.platform, token: input.token }) as Row;
    return fromRow(row);
};

export const getDevice = (id: number): PushDevice | undefined => {
    const row = db.prepare(`SELECT * FROM push_devices WHERE id = $id`).get({ id }) as Row | undefined;
    return row ? fromRow(row) : undefined;
};

export const listDevices = (): PushDevice[] => {
    const rows = db.prepare(`SELECT * FROM push_devices ORDER BY id`).all() as Row[];
    return rows.map(fromRow);
};

export const deleteDevice = (id: number) => {
    return db.prepare(`DELETE FROM push_devices WHERE id = $id`).run({ id });
};
