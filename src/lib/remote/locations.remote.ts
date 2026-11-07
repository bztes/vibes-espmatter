import * as v from 'valibot';
import { error } from '@sveltejs/kit';
import { and, asc, eq, isNotNull, isNull, ne, or } from 'drizzle-orm';
import { command, query } from '$app/server';
import { requireUser } from '#lib/server/auth.ts';
import { db } from '#lib/server/db/index.ts';
import { device, location } from '#lib/server/db/schema.ts';
import { getDevice, listDevices, listHubs } from './devices.remote.ts';
import { uuid } from './schemas.ts';

const locationFields = v.object({
	name: v.pipe(v.string(), v.trim(), v.nonEmpty('Give it a name.'), v.maxLength(32))
});

/** A location of the signed-in user, or 404. */
async function ownedLocation(id: string) {
	const me = requireUser();
	const [row] = await db
		.select()
		.from(location)
		.where(and(eq(location.id, id), eq(location.ownerId, me.id)));
	if (!row) error(404, 'Location not found');
	return row;
}

export const listLocations = query(async () => {
	const me = requireUser();
	return db
		.select()
		.from(location)
		.where(eq(location.ownerId, me.id))
		.orderBy(asc(location.createdAt));
});

export const createLocation = command(locationFields, async (fields) => {
	const me = requireUser();
	const [row] = await db
		.insert(location)
		.values({ ...fields, ownerId: me.id })
		.returning({ id: location.id });
	void listLocations().refresh();
	return { id: row.id };
});

export const updateLocation = command(
	v.object({ id: uuid, ...locationFields.entries }),
	async ({ id, ...fields }) => {
		await ownedLocation(id);
		await db.update(location).set(fields).where(eq(location.id, id));
		void listLocations().refresh();
		void listDevices().refresh();
	}
);

/** Its devices stay, without a location. */
export const deleteLocation = command(uuid, async (id) => {
	await ownedLocation(id);
	await db.delete(location).where(eq(location.id, id));
	void listLocations().refresh();
	void listDevices().refresh();
});

/** Moves a device; a hub of another location no longer relays its updates. */
export const moveDevice = command(
	v.object({ id: uuid, locationId: v.nullable(uuid) }),
	async ({ id, locationId }) => {
		const me = requireUser();
		if (locationId) await ownedLocation(locationId);
		const [row] = await db
			.select()
			.from(device)
			.where(and(eq(device.id, id), eq(device.ownerId, me.id)));
		if (!row) error(404, 'Device not found');
		let hubId = row.hubId;
		if (hubId) {
			const [hub] = await db
				.select({ locationId: device.locationId })
				.from(device)
				.where(eq(device.id, hubId));
			if (hub?.locationId !== locationId) hubId = null;
		}
		await db.batch([
			db
				.update(device)
				.set({ locationId, hubId, updatedAt: row.updatedAt })
				.where(eq(device.id, id)),
			// A hub that leaves no longer relays for the devices it left behind.
			db
				.update(device)
				.set({ hubId: null })
				.where(
					and(
						eq(device.hubId, id),
						locationId
							? or(isNull(device.locationId), ne(device.locationId, locationId))
							: isNotNull(device.locationId)
					)
				)
		]);
		void getDevice(id).refresh();
		void listDevices().refresh();
		if (row.kind === 'hub') {
			void listHubs(row.locationId).refresh();
			void listHubs(locationId).refresh();
		}
	}
);
