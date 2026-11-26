/** One user's setup (locations, firmwares, devices) as a file, for moving it to another server. */
import * as v from 'valibot';
import { error } from '@sveltejs/kit';
import { eq, inArray } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { device, firmware, location } from '#lib/server/db/schema.ts';
import { deviceName, firmwareConfig, name, uuid } from '#lib/remote/schemas.ts';
import { validSubdomain } from '#lib/server/tunnel/index.ts';

const FORMAT = 'espmatter-setup';

const kind = v.picklist(['hub', 'device']);
const token = v.pipe(v.string(), v.maxLength(200));

const setupSchema = v.object({
	format: v.literal(FORMAT),
	version: v.literal(1),
	locations: v.array(v.object({ id: uuid, name })),
	firmwares: v.array(
		v.object({
			id: uuid,
			name: deviceName,
			kind,
			config: firmwareConfig,
			nextVersion: v.pipe(v.number(), v.integer(), v.minValue(1))
		})
	),
	devices: v.array(
		v.object({
			id: uuid,
			firmwareId: uuid,
			name: deviceName,
			kind,
			locationId: v.nullable(uuid),
			apiToken: token,
			previousToken: v.nullable(token),
			hubId: v.nullable(uuid),
			subdomain: v.nullable(token)
		})
	)
});

export type Setup = v.InferOutput<typeof setupSchema>;

export async function exportSetup(ownerId: string): Promise<Setup & { exportedAt: string }> {
	const [locations, firmwares, devices] = await Promise.all([
		db
			.select({ id: location.id, name: location.name })
			.from(location)
			.where(eq(location.ownerId, ownerId)),
		db
			.select({
				id: firmware.id,
				name: firmware.name,
				kind: firmware.kind,
				config: firmware.config,
				nextVersion: firmware.nextVersion
			})
			.from(firmware)
			.where(eq(firmware.ownerId, ownerId)),
		db
			.select({
				id: device.id,
				firmwareId: device.firmwareId,
				name: device.name,
				kind: device.kind,
				locationId: device.locationId,
				apiToken: device.apiToken,
				previousToken: device.previousToken,
				hubId: device.hubId,
				subdomain: device.subdomain
			})
			.from(device)
			.where(eq(device.ownerId, ownerId))
	]);
	return {
		format: FORMAT,
		version: 1,
		exportedAt: new Date().toISOString(),
		locations,
		firmwares,
		devices
	};
}

/** Adds a setup to the account; ids and tokens are kept so the boards keep working. */
export async function importSetup(ownerId: string, raw: unknown) {
	const parsed = v.safeParse(setupSchema, raw);
	if (!parsed.success) error(400, `Not a setup file: ${v.summarize(parsed.issues)}`);
	const setup = parsed.output;

	const firmwareIds = new Set(setup.firmwares.map((f) => f.id));
	const locationIds = new Set(setup.locations.map((l) => l.id));
	const deviceIds = new Set(setup.devices.map((d) => d.id));
	const orphan = setup.devices.find((d) => !firmwareIds.has(d.firmwareId));
	if (orphan) error(400, `Device “${orphan.name}” has no firmware in the file.`);

	const taken = (table: typeof location | typeof firmware | typeof device, ids: Set<string>) =>
		db
			.select({ id: table.id })
			.from(table)
			.where(inArray(table.id, [...ids]));
	const subdomains = setup.devices.flatMap((d) => (d.subdomain ? [d.subdomain] : []));
	const [locationsTaken, firmwaresTaken, devicesTaken, subdomainsTaken] = await Promise.all([
		taken(location, locationIds),
		taken(firmware, firmwareIds),
		taken(device, deviceIds),
		db
			.select({ subdomain: device.subdomain })
			.from(device)
			.where(inArray(device.subdomain, subdomains))
	]);
	if (locationsTaken.length || firmwaresTaken.length || devicesTaken.length)
		error(409, 'This setup (or part of it) is on this server already.');

	const used = new Set(subdomainsTaken.map((r) => r.subdomain));
	// Taken, invalid or twice in the file: picked again from the name later.
	const subdomainOf = (label: string | null) => {
		if (!label || used.has(label) || !validSubdomain(label)) return null;
		used.add(label);
		return label;
	};

	await db.transaction(async (tx) => {
		if (setup.locations.length)
			await tx.insert(location).values(setup.locations.map((l) => ({ ...l, ownerId })));
		if (setup.firmwares.length)
			await tx.insert(firmware).values(setup.firmwares.map((f) => ({ ...f, ownerId })));
		if (setup.devices.length)
			await tx.insert(device).values(
				setup.devices.map((d) => ({
					...d,
					ownerId,
					locationId: d.locationId && locationIds.has(d.locationId) ? d.locationId : null,
					subdomain: subdomainOf(d.subdomain),
					// One statement: SQLite checks the self-reference at its end.
					hubId: d.hubId && deviceIds.has(d.hubId) ? d.hubId : null
				}))
			);
	});

	return {
		locations: setup.locations.length,
		firmwares: setup.firmwares.length,
		devices: setup.devices.length
	};
}
