import * as v from 'valibot';
import { error } from '@sveltejs/kit';
import { count, desc, eq } from 'drizzle-orm';
import { command, query } from '$app/server';
import { createConfig, normalize } from '#lib/core/engine.ts';
import { validate } from '#lib/core/validate.ts';
import { requireUser } from '#lib/server/auth.ts';
import { db } from '#lib/server/db/index.ts';
import { build, device, firmware } from '#lib/server/db/schema.ts';
import { deleteBuildsOf } from '#lib/server/builds/queue.ts';
import { ownedFirmware } from '#lib/server/devices.ts';
import { listDevices } from './devices.remote.ts';
import { deviceName, firmwareConfig, uuid } from './schemas.ts';

export const listFirmwares = query(async () => {
	const me = requireUser();
	const rows = await db
		.select()
		.from(firmware)
		.where(eq(firmware.ownerId, me.id))
		.orderBy(desc(firmware.updatedAt));
	const counts = await db
		.select({ firmwareId: device.firmwareId, n: count() })
		.from(device)
		.where(eq(device.ownerId, me.id))
		.groupBy(device.firmwareId);
	const latest = await db
		.select({
			firmwareId: build.firmwareId,
			status: build.status,
			version: build.version,
			createdAt: build.createdAt
		})
		.from(build)
		.innerJoin(firmware, eq(build.firmwareId, firmware.id))
		.where(eq(firmware.ownerId, me.id))
		.orderBy(desc(build.createdAt));
	return rows.map((row) => {
		const config = normalize(row.config);
		const issues = validate(config);
		return {
			id: row.id,
			name: row.name,
			kind: row.kind,
			boards: config.boards,
			features: Object.keys(config.features),
			peripherals: config.peripherals.map((s) => ({ peripheral: s.peripheral, name: s.name })),
			errors: issues.filter((i) => i.severity === 'error').length,
			devices: counts.find((c) => c.firmwareId === row.id)?.n ?? 0,
			latestBuild: latest.find((b) => b.firmwareId === row.id),
			updatedAt: row.updatedAt
		};
	});
});

export const getFirmware = query(uuid, async (id) => {
	const row = await ownedFirmware(id);
	const devices = await db
		.select({
			id: device.id,
			name: device.name,
			locationId: device.locationId,
			lastSeenAt: device.lastSeenAt,
			reported: device.reported
		})
		.from(device)
		.where(eq(device.firmwareId, id))
		.orderBy(device.name);
	return {
		id: row.id,
		name: row.name,
		kind: row.kind,
		config: row.config,
		nextVersion: row.nextVersion,
		updatedAt: row.updatedAt,
		devices: devices.map(({ reported, ...d }) => ({ ...d, running: reported.main?.running }))
	};
});

export const createFirmware = command(
	v.object({ kind: v.picklist(['hub', 'device']), name: deviceName }),
	async ({ kind, name }) => {
		const me = requireUser();
		const config = createConfig(kind, name);
		const [row] = await db
			.insert(firmware)
			.values({ ownerId: me.id, name: config.name, kind, config })
			.returning({ id: firmware.id });
		void listFirmwares().refresh();
		return { id: row.id };
	}
);

export const saveFirmware = command(
	v.object({ id: uuid, config: firmwareConfig }),
	async ({ id, config }) => {
		const row = await ownedFirmware(id);
		if (config.kind !== row.kind) error(400, 'The kind of a firmware can’t change.');
		await db.update(firmware).set({ config, name: config.name }).where(eq(firmware.id, id));
		void getFirmware(id).refresh();
		void listFirmwares().refresh();
		void listDevices().refresh();
		return { savedAt: new Date() };
	}
);

export const duplicateFirmware = command(uuid, async (id) => {
	const me = requireUser();
	const row = await ownedFirmware(id);
	const config = normalize({ ...row.config, name: `${row.name} (copy)`.slice(0, 48) });
	const [copy] = await db
		.insert(firmware)
		.values({ ownerId: me.id, name: config.name, kind: row.kind, config })
		.returning({ id: firmware.id });
	void listFirmwares().refresh();
	return { id: copy.id };
});

/** Only without devices: move or delete them first. */
export const deleteFirmware = command(uuid, async (id) => {
	await ownedFirmware(id);
	const [{ n }] = await db.select({ n: count() }).from(device).where(eq(device.firmwareId, id));
	if (n)
		error(
			409,
			`${n} device${n > 1 ? 's run' : ' runs'} this firmware – delete or move them first.`
		);
	await deleteBuildsOf([id]);
	await db.delete(firmware).where(eq(firmware.id, id));
	void listFirmwares().refresh();
});
