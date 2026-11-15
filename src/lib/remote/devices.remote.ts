import * as v from 'valibot';
import { error } from '@sveltejs/kit';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { command, getRequestEvent, query } from '$app/server';
import { CFG_PARTITION_SIZE } from '#lib/core/cfg.ts';
import { PASSWORD_SET } from '#lib/core/device.ts';
import type { DeviceSettings } from '#lib/core/model.ts';
import { createConfig, normalize } from '#lib/core/engine.ts';
import { requireUser } from '#lib/server/auth.ts';
import { db } from '#lib/server/db/index.ts';
import { build, device, firmware, location } from '#lib/server/db/schema.ts';
import { boardToken } from '#lib/server/deploy.ts';
import {
	editedImage,
	imageSettings,
	newApiToken,
	ownedDevice,
	nextSettings,
	ownedFirmware,
	publicUrl,
	readBoard,
	usbImage,
	writeBoard
} from '#lib/server/devices.ts';
import {
	deviceUrl,
	ensureSubdomain,
	freeSubdomain,
	deviceConnection,
	deviceDomain,
	deviceFetch,
	deviceOrigin,
	validSubdomain
} from '#lib/server/tunnel/index.ts';
import { deviceName, devicePassword, deviceSettings, uuid } from './schemas.ts';

export const listDevices = query(async () => {
	const me = requireUser();
	const rows = await db
		.select()
		.from(device)
		.where(eq(device.ownerId, me.id))
		.orderBy(desc(device.updatedAt));
	const firmwares = await db.select().from(firmware).where(eq(firmware.ownerId, me.id));
	const latest = await db
		.select({ firmwareId: build.firmwareId, version: build.version })
		.from(build)
		.where(
			and(
				eq(build.status, 'success'),
				inArray(
					build.firmwareId,
					firmwares.map((f) => f.id)
				)
			)
		)
		.orderBy(desc(build.version));
	return Promise.all(
		rows.map(async (row) => {
			const fw = firmwares.find((f) => f.id === row.firmwareId)!;
			const config = normalize(fw.config);
			return {
				id: row.id,
				name: row.name,
				kind: row.kind,
				firmware: { id: fw.id, name: fw.name },
				locationId: row.locationId,
				boards: config.boards,
				features: Object.keys(config.features),
				peripherals: config.peripherals.map((s) => ({ peripheral: s.peripheral, name: s.name })),
				url: await deviceUrl(row.subdomain, deviceOrigin(row)),
				/** Reachable by the app right now (its own tunnel or its hub's). */
				connected: !!deviceConnection(row),
				lastSeenAt: row.lastSeenAt,
				running: row.reported.main?.running,
				/** The newest successful build of its firmware. */
				latest: latest.find((b) => b.firmwareId === fw.id)?.version,
				hubId: row.hubId,
				updatedAt: row.updatedAt
			};
		})
	);
});

export const getDevice = query(uuid, async (id) => {
	const dev = await ownedDevice(id);
	const hub = dev.hubId
		? (
				await db
					.select({ id: device.id, name: device.name })
					.from(device)
					.where(eq(device.id, dev.hubId))
			)[0]
		: undefined;
	const subdomain = await ensureSubdomain(dev);
	return {
		id: dev.id,
		name: dev.name,
		kind: dev.kind,
		firmware: {
			id: dev.firmware.id,
			name: dev.firmware.name,
			config: dev.firmware.config,
			nextVersion: dev.firmware.nextVersion
		},
		location: dev.location ? { id: dev.location.id, name: dev.location.name } : null,
		apiToken: dev.apiToken,
		/** The board still has the token from before a rotation. */
		tokenPending: !!dev.previousToken,
		subdomain,
		/** Its address in the app, passed on through its tunnel or its hub's. */
		url: await deviceUrl(subdomain, deviceOrigin(dev)),
		/** What its subdomain goes in front of. */
		deviceDomain: await deviceDomain(deviceOrigin(dev)),
		/** Since when the app reaches it, and how (its own tunnel, or its hub's); null: not at all. */
		connectedSince: deviceConnection(dev)?.since ?? null,
		connectedVia: deviceConnection(dev)?.via ?? null,
		lastSeenAt: dev.lastSeenAt,
		reported: dev.reported,
		publicUrl: await publicUrl(),
		hub: hub ?? null,
		updatedAt: dev.updatedAt
	};
});

/** A new device of a firmware – or, without one, of a new firmware of `kind`. */
export const createDevice = command(
	v.object({
		name: deviceName,
		firmwareId: v.optional(v.nullable(uuid)),
		kind: v.optional(v.picklist(['hub', 'device'])),
		locationId: v.optional(v.nullable(uuid))
	}),
	async ({ name, firmwareId, kind, locationId }) => {
		const me = requireUser();
		if (locationId) {
			const [p] = await db
				.select()
				.from(location)
				.where(and(eq(location.id, locationId), eq(location.ownerId, me.id)));
			if (!p) error(404, 'Location not found');
		}
		let fw;
		if (firmwareId) fw = await ownedFirmware(firmwareId);
		else {
			if (!kind) error(400, 'Pick a firmware or a kind.');
			const config = createConfig(kind, name);
			[fw] = await db
				.insert(firmware)
				.values({ ownerId: me.id, name: config.name, kind, config })
				.returning();
		}
		const [row] = await db
			.insert(device)
			.values({
				ownerId: me.id,
				firmwareId: fw.id,
				name,
				kind: fw.kind,
				locationId: locationId ?? null,
				apiToken: newApiToken(),
				subdomain: await freeSubdomain(name)
			})
			.returning({ id: device.id });
		void listDevices().refresh();
		return { id: row.id, firmwareId: fw.id, newFirmware: !firmwareId };
	}
);

/** The name of a device (autosaved by the device page); the board gets it with its settings. */
export const saveDevice = command(
	v.object({ id: uuid, name: deviceName }),
	async ({ id, name }) => {
		await ownedDevice(id);
		await db.update(device).set({ name }).where(eq(device.id, id));
		void getDevice(id).refresh();
		void listDevices().refresh();
		return { savedAt: new Date() };
	}
);

/** Settings for the browser: the password hash stays on the server. */
const masked = (settings: DeviceSettings) => ({
	...settings,
	uiPasswordHash: settings.uiPasswordHash && PASSWORD_SET
});

/** The settings on the board, read live. */
export const readDeviceSettings = command(uuid, async (id) =>
	masked(await readBoard(await ownedDevice(id)))
);

/**
 * Send the settings to the board, which restarts with them. Nothing is kept. Without `password`
 * the board keeps its admin password.
 */
export const writeDeviceSettings = command(
	v.object({
		id: uuid,
		settings: deviceSettings,
		password: v.optional(devicePassword)
	}),
	async ({ id, settings, password }) => {
		const dev = await ownedDevice(id);
		const current = await readBoard(dev);
		await writeBoard(dev, await nextSettings(dev, settings, current.uiPasswordHash, password));
	}
);

/** The whole configuration partition, as base64 (read off a board over USB). */
const partition = v.pipe(
	v.string(),
	v.maxLength(CFG_PARTITION_SIZE * 2),
	v.transform((text) => new Uint8Array(Buffer.from(text, 'base64'))),
	v.check((image) => image.length === CFG_PARTITION_SIZE, 'Not the whole partition.')
);

/** The settings in a partition read off the board over USB. Nothing is kept. */
export const readUsbSettings = command(v.object({ id: uuid, image: partition }), async (input) => {
	const dev = await ownedDevice(input.id);
	return masked(await imageSettings(dev, input.image, getRequestEvent().url.origin));
});

/**
 * The partition with these settings, for writing over USB onto the board `current` was read
 * from (base64). Without `password` it keeps its admin password.
 */
export const usbSettingsImage = command(
	v.object({
		id: uuid,
		current: partition,
		settings: deviceSettings,
		password: v.optional(devicePassword)
	}),
	async ({ id, current, settings, password }) => {
		const dev = await ownedDevice(id);
		const image = await editedImage(dev, current, settings, password, getRequestEvent().url.origin);
		return Buffer.from(image).toString('base64');
	}
);

/**
 * The partition for a USB flash (base64): `current` as read off the board, `draft` the values
 * entered before its first flash. `kept`: the board keeps its own settings.
 */
export const usbFlashImage = command(
	v.object({
		id: uuid,
		current: v.optional(partition),
		draft: v.optional(v.unknown()),
		password: v.optional(devicePassword)
	}),
	async ({ id, ...input }) => {
		const dev = await ownedDevice(id);
		const { image, kept } = await usbImage(dev, input, getRequestEvent().url.origin);
		return { image: Buffer.from(image).toString('base64'), kept };
	}
);

/** Run another firmware of the same kind. The board keeps its settings; new ones get defaults. */
export const setDeviceFirmware = command(
	v.object({ id: uuid, firmwareId: uuid }),
	async ({ id, firmwareId }) => {
		const dev = await ownedDevice(id);
		const fw = await ownedFirmware(firmwareId);
		if (fw.kind !== dev.kind) error(400, 'A hub runs hub firmware, a device device firmware.');
		await db.update(device).set({ firmwareId }).where(eq(device.id, id));
		void getDevice(id).refresh();
		void listDevices().refresh();
	}
);

export const updateDeviceSettings = command(
	v.object({
		id: uuid,
		subdomain: v.optional(
			v.pipe(
				v.string(),
				v.trim(),
				v.toLowerCase(),
				v.check(
					validSubdomain,
					'Letters, digits and dashes (not at the start or end), up to 63 – and not www, app, api, …'
				)
			)
		),
		hubId: v.optional(v.nullable(uuid))
	}),
	async ({ id, subdomain, hubId }) => {
		const me = requireUser();
		const row = await ownedDevice(id);
		if (hubId) {
			const [hub] = await db
				.select()
				.from(device)
				.where(and(eq(device.id, hubId), eq(device.ownerId, me.id), eq(device.kind, 'hub')));
			if (!hub) error(404, 'Hub not found');
			if (hub.locationId !== row.locationId) error(400, 'That hub is in another location.');
		}
		if (subdomain !== undefined && subdomain !== row.subdomain) {
			const [taken] = await db
				.select({ id: device.id })
				.from(device)
				.where(eq(device.subdomain, subdomain));
			if (taken) error(409, 'Another device already has this name.');
		}
		await db
			.update(device)
			.set({
				...(subdomain !== undefined && { subdomain }),
				...(hubId !== undefined && { hubId }),
				updatedAt: row.updatedAt
			})
			.where(eq(device.id, id));
		void getDevice(id).refresh();
		void listDevices().refresh();
	}
);

/**
 * A new token, sent to the board right away when it is connected. Until the board has it (or
 * gets it with its next settings or USB flash), the old one keeps working.
 */
export const rotateToken = command(uuid, async (id) => {
	const dev = await ownedDevice(id);
	const previousToken = dev.previousToken ?? dev.apiToken;
	const apiToken = newApiToken();
	await db.update(device).set({ apiToken, previousToken }).where(eq(device.id, id));
	void getDevice(id).refresh();
	if (!deviceConnection(dev)) return { applied: false, reason: 'not connected' };
	const next = { ...dev, apiToken, previousToken };
	try {
		await writeBoard(next, await readBoard(next));
		return { applied: true };
	} catch (e) {
		const reason = (e as { body?: { message?: string } }).body?.message ?? String(e);
		return { applied: false, reason };
	}
});

export const deleteDevice = command(uuid, async (id) => {
	await ownedDevice(id);
	await db.delete(device).where(eq(device.id, id));
	void listDevices().refresh();
});

/** Hubs of a location (null: of no location). */
export const listHubs = query(v.nullable(uuid), async (locationId) => {
	const me = requireUser();
	return db
		.select({ id: device.id, name: device.name })
		.from(device)
		.where(
			and(
				eq(device.ownerId, me.id),
				eq(device.kind, 'hub'),
				locationId ? eq(device.locationId, locationId) : isNull(device.locationId)
			)
		);
});

/** Is the device answering (through its tunnel or its hub's)? */
export const probeDevice = command(uuid, async (id) => {
	const row = await ownedDevice(id);
	if (!deviceConnection(row)) return { online: false, info: null };
	try {
		const res = await deviceFetch(row, {
			method: 'GET',
			path: '/api/v1/info',
			headers: { authorization: `Bearer ${boardToken(row)}` }
		});
		const info = res.ok
			? ((await res.json()) as { firmware?: { version?: number; config?: string } })
			: null;
		if (res.ok)
			await db
				.update(device)
				.set({ lastSeenAt: new Date(), updatedAt: row.updatedAt })
				.where(eq(device.id, id));
		return { online: res.ok, info };
	} catch {
		return { online: false, info: null };
	}
});
