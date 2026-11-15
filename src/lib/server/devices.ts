import { pbkdf2, randomBytes } from 'node:crypto';
import { promisify } from 'node:util';
import { error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { CFG_PARTITION_SIZE } from '#lib/core/cfg.ts';
import { boardSettings, deviceEntries, normalizeDevice } from '#lib/core/device.ts';
import { normalize } from '#lib/core/engine.ts';
import type { DeviceSettings } from '#lib/core/model.ts';
import { nvsImage, readNvs, type NvsValue } from '#lib/core/nvs.ts';
import { validateDevice } from '#lib/core/validate.ts';
import { getRequestEvent } from '$app/server';
import { requireUser } from './auth.ts';
import { db } from './db/index.ts';
import { device, firmware, location } from './db/schema.ts';
import { boardToken } from './deploy.ts';
import { getSetting } from './settings.ts';
import { deviceConnection, deviceFetch, deviceOrigin } from './tunnel/core.ts';

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

/** A device with its firmware (normalized) and location. */
export async function withContext(row: DeviceRow) {
	const [fw] = await db.select().from(firmware).where(eq(firmware.id, row.firmwareId));
	const config = normalize(fw.config);
	const loc = row.locationId
		? (await db.select().from(location).where(eq(location.id, row.locationId)))[0]
		: undefined;
	return {
		...row,
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

/**
 * URL devices reach the app at: admin setting, else `requestOrigin` (where it's flashed from, or
 * where it connects). A board's own app URL is empty when it is this one.
 */
export async function publicUrl(requestOrigin?: string | null): Promise<string> {
	return ((await getSetting('publicUrl')) || requestOrigin || '').replace(/\/$/, '');
}

const identity = (dev: DeviceContext, appUrl: string) => ({
	id: dev.id,
	name: dev.name,
	apiToken: dev.apiToken,
	appUrl
});

/** Settings fit for a board: no errors (its firmware's own aside). */
function checked(dev: DeviceContext, settings: DeviceSettings) {
	const errors = validateDevice(dev.firmware.config, settings, dev.name).filter(
		(i) => i.severity === 'error'
	);
	if (errors.length) error(400, errors[0].message);
	return settings;
}

/** `input` as the board's next settings, checked; without `password` it keeps `currentHash`. */
export async function nextSettings(
	dev: DeviceContext,
	input: unknown,
	currentHash: string,
	password?: string
) {
	const next = normalizeDevice(input, dev.firmware.config);
	next.uiPasswordHash = password ? await hashDevicePassword(password) : currentHash;
	return checked(dev, next);
}

const imageOf = (dev: DeviceContext, settings: DeviceSettings, appUrl: string) =>
	nvsImage(deviceEntries(dev.firmware.config, settings, identity(dev, appUrl)), CFG_PARTITION_SIZE);

/** What a partition read off a board over USB holds; undefined when empty. */
function decode(dev: DeviceContext, image: Uint8Array, appUrl: string) {
	const values = readNvs(image);
	return values.length ? boardSettings(values, dev.firmware.config, appUrl) : undefined;
}

function ownSettings(dev: DeviceContext, image: Uint8Array, appUrl: string) {
	const found = decode(dev, image, appUrl);
	if (!found) error(404, 'The board has no settings yet – flash it from the Firmware tab.');
	if (found.id !== dev.id) error(409, 'This board has the settings of another device.');
	return found.settings;
}

async function board(dev: DeviceContext, method: 'GET' | 'PUT', body?: unknown) {
	if (!deviceConnection(dev))
		error(503, 'The device isn’t connected to the app – its settings are on the board only.');
	let res: Response;
	try {
		res = await deviceFetch(dev, {
			method,
			path: '/api/v1/config',
			headers: {
				authorization: `Bearer ${boardToken(dev)}`,
				...(body !== undefined && { 'content-type': 'application/json' })
			},
			body: body === undefined ? undefined : new TextEncoder().encode(JSON.stringify(body))
		});
	} catch (e) {
		error(503, e instanceof Error ? e.message : String(e));
	}
	if (res.status === 404)
		error(409, 'Its firmware can’t share its settings yet – install a newer build first.');
	if (!res.ok) {
		const text = await res.text().catch(() => '');
		error(502, `The device answered ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}.`);
	}
	return res;
}

/** The settings on the board, read through its tunnel (or its hub's). Nothing is kept. */
export async function readBoard(dev: DeviceContext): Promise<DeviceSettings> {
	const res = await board(dev, 'GET');
	const body = (await res.json().catch(() => ({}))) as { values?: unknown };
	const values = (Array.isArray(body.values) ? body.values : []).filter(
		(v): v is NvsValue =>
			!!v &&
			typeof v.ns === 'string' &&
			typeof v.key === 'string' &&
			(typeof v.value === 'string' || typeof v.value === 'number')
	);
	const { id, settings } = boardSettings(
		values,
		dev.firmware.config,
		await publicUrl(deviceOrigin(dev))
	);
	if (id && id !== dev.id) error(409, 'This board has the settings of another device.');
	return settings;
}

/** Replace the board's settings (it restarts with them). Its name and token come from the app. */
export async function writeBoard(dev: DeviceContext, settings: DeviceSettings) {
	const appUrl = await publicUrl(deviceOrigin(dev));
	const entries = deviceEntries(dev.firmware.config, checked(dev, settings), identity(dev, appUrl));
	await board(dev, 'PUT', {
		values: entries.map(({ ns, key, type, value }) => ({ ns, key, type, value }))
	});
}

/**
 * The configuration partition for a USB flash. A board that has this device's settings keeps
 * them (`current`, read off it); any other gets `draft` – the values entered before its first
 * flash – with `password` as its admin password.
 */
export async function usbImage(
	dev: DeviceContext,
	input: { current?: Uint8Array; draft?: unknown; password?: string },
	origin?: string | null
) {
	const appUrl = await publicUrl(origin);
	const fromBoard = input.current && decode(dev, input.current, appUrl);
	const kept = fromBoard?.id === dev.id;
	const settings = kept
		? fromBoard.settings
		: await nextSettings(dev, input.draft, '', input.password);
	return { image: imageOf(dev, settings, appUrl), kept };
}

/** The settings in a partition read off a board over USB – only this device's. */
export async function imageSettings(dev: DeviceContext, image: Uint8Array, origin?: string | null) {
	return ownSettings(dev, image, await publicUrl(origin));
}

/**
 * The partition with `settings`, for writing over USB onto the board `current` was read from.
 * Without `password` it keeps its admin password.
 */
export async function editedImage(
	dev: DeviceContext,
	current: Uint8Array,
	settings: object,
	password?: string,
	origin?: string | null
) {
	const appUrl = await publicUrl(origin);
	const now = ownSettings(dev, current, appUrl);
	const next = await nextSettings(dev, settings, now.uiPasswordHash, password);
	return imageOf(dev, next, appUrl);
}

export const currentUserId = () => requireUser().id;
