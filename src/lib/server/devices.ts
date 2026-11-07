import { pbkdf2, randomBytes } from 'node:crypto';
import { promisify } from 'node:util';
import { error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { CFG_PARTITION_SIZE } from '#lib/core/cfg.ts';
import { deviceEntries, normalizeDevice } from '#lib/core/device.ts';
import { normalize } from '#lib/core/engine.ts';
import { nvsImage } from '#lib/core/nvs.ts';
import { getRequestEvent } from '$app/server';
import { requireUser } from './auth.ts';
import { db } from './db/index.ts';
import { device, firmware, location } from './db/schema.ts';
import { getSetting } from './settings.ts';

export const newApiToken = () => randomBytes(24).toString('base64url');

const pbkdf2Async = promisify(pbkdf2);
/** What the device can afford per login (espm_http.cpp); like its own accounts. */
const PASSWORD_ITERATIONS = 2000;

/** The stored form of a device admin password (`DeviceSettings.uiPasswordHash`). */
export async function hashDevicePassword(password: string): Promise<string> {
	const salt = randomBytes(16);
	const hash = await pbkdf2Async(password, salt, PASSWORD_ITERATIONS, 32, 'sha256');
	return `pbkdf2-sha256$${PASSWORD_ITERATIONS}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

const signedIn = () => {
	const { locals } = getRequestEvent();
	if (!locals.user) error(401, 'Please sign in.');
	return locals.user;
};

/** A firmware of the signed-in user (config normalized), or 404. */
export async function ownedFirmware(id: string) {
	const me = signedIn();
	const [row] = await db
		.select()
		.from(firmware)
		.where(and(eq(firmware.id, id), eq(firmware.ownerId, me.id)));
	if (!row) error(404, 'Firmware not found');
	return { ...row, config: normalize(row.config) };
}

export type DeviceRow = typeof device.$inferSelect;

/** A device with its firmware and location, settings normalized against the firmware. */
export async function withContext(row: DeviceRow) {
	const [fw] = await db.select().from(firmware).where(eq(firmware.id, row.firmwareId));
	const config = normalize(fw.config);
	const loc = row.locationId
		? (await db.select().from(location).where(eq(location.id, row.locationId)))[0]
		: undefined;
	return {
		...row,
		settings: normalizeDevice(row.settings, config),
		firmware: { ...fw, config },
		location: loc ?? null
	};
}
export type DeviceContext = Awaited<ReturnType<typeof withContext>>;

/** A device of the signed-in user, or 404. */
export async function ownedDevice(id: string) {
	const me = signedIn();
	const [row] = await db
		.select()
		.from(device)
		.where(and(eq(device.id, id), eq(device.ownerId, me.id)));
	if (!row) error(404, 'Device not found');
	return withContext(row);
}

/** URL devices reach the app at: admin setting, else the origin of the request. */
export async function publicUrl(requestOrigin?: string | null): Promise<string> {
	return ((await getSetting('publicUrl')) || requestOrigin || '').replace(/\/$/, '');
}

/**
 * The device's configuration partition (`config.bin`) and its revision. Without a public URL and
 * an app URL of the device, the request's origin becomes the device's app URL (saved), so the
 * revision doesn't depend on where the next request comes from.
 */
export async function configImage(dev: DeviceContext, requestOrigin?: string | null) {
	const configured = await publicUrl();
	if (!dev.settings.appUrl && !configured && requestOrigin) {
		dev.settings.appUrl = requestOrigin.replace(/\/$/, '');
		await db
			.update(device)
			.set({ settings: dev.settings, updatedAt: dev.updatedAt })
			.where(eq(device.id, dev.id));
	}
	const { entries, rev } = await deviceEntries(dev.firmware.config, dev.settings, {
		id: dev.id,
		name: dev.name,
		apiToken: dev.apiToken,
		appUrl: configured
	});
	return { image: nvsImage(entries, CFG_PARTITION_SIZE), rev, entries };
}

export const currentUserId = () => requireUser().id;
