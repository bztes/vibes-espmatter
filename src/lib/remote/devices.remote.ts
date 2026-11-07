import * as v from 'valibot';
import { error } from '@sveltejs/kit';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { command, query } from '$app/server';
import { normalizeDevice, PASSWORD_SET } from '#lib/core/device.ts';
import { createConfig, normalize } from '#lib/core/engine.ts';
import { validateDevice } from '#lib/core/validate.ts';
import { requireUser } from '#lib/server/auth.ts';
import { db } from '#lib/server/db/index.ts';
import { build, device, firmware, location } from '#lib/server/db/schema.ts';
import { boardToken, nudge } from '#lib/server/deploy.ts';
import {
	configImage,
	hashDevicePassword,
	newApiToken,
	ownedDevice,
	ownedFirmware,
	publicUrl
} from '#lib/server/devices.ts';
import {
	deviceUrl,
	ensureSubdomain,
	freeSubdomain,
	tunnelConnected,
	tunnelFetch,
	validSubdomain
} from '#lib/server/tunnel/index.ts';
import { deviceName, deviceSettings, uuid } from './schemas.ts';

export const listDevices = query(async () => {
	const me = requireUser();
	const rows = await db
		.select()
		.from(device)
		.where(eq(device.ownerId, me.id))
		.orderBy(desc(device.updatedAt));
	const firmwares = await db.select().from(firmware).where(eq(firmware.ownerId, me.id));
	const locations = await db.select().from(location).where(eq(location.ownerId, me.id));
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
			const settings = normalizeDevice(row.settings, config);
			const loc = locations.find((l) => l.id === row.locationId);
			const issues = validateDevice(config, settings, row.name);
			const { rev } = await configImage({
				...row,
				settings,
				firmware: { ...fw, config },
				location: loc ?? null
			});
			return {
				id: row.id,
				name: row.name,
				kind: row.kind,
				firmware: { id: fw.id, name: fw.name },
				locationId: row.locationId,
				boards: config.boards,
				features: Object.keys(config.features),
				peripherals: config.peripherals.map((s) => ({ peripheral: s.peripheral, name: s.name })),
				errors: issues.filter((i) => i.severity === 'error').length,
				url: await deviceUrl(row.subdomain, settings.appUrl),
				/** Connected to the app through its tunnel right now. */
				connected: !!tunnelConnected(row.id),
				lastSeenAt: row.lastSeenAt,
				running: row.reported.main?.running,
				/** The newest successful build of its firmware. */
				latest: latest.find((b) => b.firmwareId === fw.id)?.version,
				/** The device reported a configuration, and it isn't the current one. */
				configOutdated: !!row.reported.main?.config && row.reported.main.config !== rev,
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
	const { rev } = await configImage(dev);
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
		// The password hash stays on the server.
		settings: {
			...dev.settings,
			uiPasswordHash: dev.settings.uiPasswordHash && PASSWORD_SET
		},
		apiToken: dev.apiToken,
		/** The board still has the token from before a rotation. */
		tokenPending: !!dev.previousToken,
		subdomain,
		/** Its own hostname, through the tunnel (remote-access feature). */
		url: await deviceUrl(subdomain, dev.settings.appUrl),
		/** Since when its tunnel is up; null: not connected. */
		connectedSince: tunnelConnected(dev.id) ?? null,
		lastSeenAt: dev.lastSeenAt,
		reported: dev.reported,
		/** Revision of the configuration the device should have. */
		configRev: rev,
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
				settings: normalizeDevice({}, normalize(fw.config)),
				apiToken: newApiToken(),
				subdomain: await freeSubdomain(name)
			})
			.returning({ id: device.id });
		void listDevices().refresh();
		return { id: row.id, firmwareId: fw.id, newFirmware: !firmwareId };
	}
);

/** Name and settings of a device (autosaved by the device page). */
export const saveDevice = command(
	v.object({ id: uuid, name: deviceName, settings: deviceSettings }),
	async ({ id, name, settings }) => {
		const dev = await ownedDevice(id);
		await db
			.update(device)
			.set({
				name,
				settings: normalizeDevice(
					// Only `setDevicePassword` changes the password.
					{ ...settings, uiPasswordHash: dev.settings.uiPasswordHash },
					dev.firmware.config
				)
			})
			.where(eq(device.id, id));
		void getDevice(id).refresh();
		void listDevices().refresh();
		return { savedAt: new Date() };
	}
);

/** A new admin password for the device's web interface. Only its hash is stored. */
export const setDevicePassword = command(
	v.object({ id: uuid, password: v.pipe(v.string(), v.minLength(8), v.maxLength(64)) }),
	async ({ id, password }) => {
		const dev = await ownedDevice(id);
		const uiPasswordHash = await hashDevicePassword(password);
		await db
			.update(device)
			.set({ settings: { ...dev.settings, uiPasswordHash } })
			.where(eq(device.id, id));
		void getDevice(id).refresh();
		void listDevices().refresh();
	}
);

/** Run another firmware of the same kind. Its values for plugins the firmware lacks are dropped. */
export const setDeviceFirmware = command(
	v.object({ id: uuid, firmwareId: uuid }),
	async ({ id, firmwareId }) => {
		const dev = await ownedDevice(id);
		const fw = await ownedFirmware(firmwareId);
		if (fw.kind !== dev.kind) error(400, 'A hub runs hub firmware, a device device firmware.');
		await db
			.update(device)
			.set({ firmwareId, settings: normalizeDevice(dev.settings, fw.config) })
			.where(eq(device.id, id));
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
 * A new token, in the device's configuration from now on. The board keeps working with the old
 * one until it runs that configuration (over the air or USB).
 */
export const rotateToken = command(uuid, async (id) => {
	const dev = await ownedDevice(id);
	await db
		.update(device)
		.set({ apiToken: newApiToken(), previousToken: dev.previousToken ?? dev.apiToken })
		.where(eq(device.id, id));
	void getDevice(id).refresh();
});

/** Ask the device to fetch its new configuration now instead of at its next check. */
export const applyDeviceConfig = command(uuid, async (id) => {
	const dev = await ownedDevice(id);
	const reason = await nudge(dev);
	if (reason)
		error(502, `Couldn’t ask the device (${reason}) – it picks up the settings at its next check.`);
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

/** Is the device answering through its tunnel? */
export const probeDevice = command(uuid, async (id) => {
	const row = await ownedDevice(id);
	if (!tunnelConnected(id)) return { online: false, info: null };
	try {
		const res = await tunnelFetch(id, {
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
