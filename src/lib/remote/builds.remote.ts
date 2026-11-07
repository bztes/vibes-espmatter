import { error } from '@sveltejs/kit';
import { desc, eq } from 'drizzle-orm';
import { command, query } from '$app/server';
import { requireUser } from '#lib/server/auth.ts';
import { db } from '#lib/server/db/index.ts';
import { build } from '#lib/server/db/schema.ts';
import {
	BuildError,
	cancelBuild as cancel,
	enabledRunners,
	enqueueBuild,
	getBuild,
	logTail,
	queuePosition,
	waitForChange
} from '#lib/server/builds/queue.ts';
import { otaMethod } from '#lib/server/deploy.ts';
import { ownedFirmware } from '#lib/server/devices.ts';
import { normalize } from '#lib/core/engine.ts';
import { getFirmware, listFirmwares } from './firmware.remote.ts';
import { uuid } from './schemas.ts';

const FINAL = new Set(['success', 'failed', 'cancelled']);

export const canBuild = query(async () => {
	requireUser();
	return (await enabledRunners()).length > 0;
});

export const startBuild = command(uuid, async (firmwareId) => {
	const me = requireUser();
	await ownedFirmware(firmwareId);
	try {
		const id = await enqueueBuild(firmwareId, me.id);
		void listBuilds(firmwareId).refresh();
		void getFirmware(firmwareId).refresh();
		void listFirmwares().refresh();
		return { id };
	} catch (err) {
		if (err instanceof BuildError) error(400, err.message);
		throw err;
	}
});

export const cancelBuild = command(uuid, async (id) => {
	const b = await getBuild(id);
	if (!b) error(404, 'Build not found');
	await ownedFirmware(b.firmwareId);
	await cancel(id);
});

/** Builds of a firmware, newest first. */
export const listBuilds = query(uuid, async (firmwareId) => {
	await ownedFirmware(firmwareId);
	return db
		.select({
			id: build.id,
			version: build.version,
			status: build.status,
			error: build.error,
			createdAt: build.createdAt,
			finishedAt: build.finishedAt
		})
		.from(build)
		.where(eq(build.firmwareId, firmwareId))
		.orderBy(desc(build.createdAt))
		.limit(15);
});

async function snapshot(id: string) {
	const b = await getBuild(id);
	if (!b) error(404, 'Build not found');
	await ownedFirmware(b.firmwareId);
	const config = normalize(b.config);
	return {
		id: b.id,
		firmwareId: b.firmwareId,
		version: b.version,
		status: b.status,
		step: b.step,
		error: b.error,
		slots: Object.entries(b.slots).map(([slot, artifacts]) => ({
			slot,
			...artifacts,
			ota: otaMethod(config, slot)
		})),
		createdAt: b.createdAt,
		startedAt: b.startedAt,
		finishedAt: b.finishedAt,
		queuePosition: b.status === 'queued' ? await queuePosition(id) : undefined,
		log: await logTail(id)
	};
}
export type BuildSnapshot = Awaited<ReturnType<typeof snapshot>>;

/** Build state and log tail, streamed until the build is finished. */
export const buildState = query.live(uuid, async function* (id) {
	while (true) {
		const s = await snapshot(id);
		yield s;
		if (FINAL.has(s.status)) return;
		await waitForChange(id);
	}
});
