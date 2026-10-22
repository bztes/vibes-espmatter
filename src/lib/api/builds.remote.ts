import * as v from 'valibot';
import { error } from '@sveltejs/kit';
import { command, getRequestEvent, query } from '$app/server';
import { findOwnedProject } from '#lib/server/owner.ts';
import {
	cancelBuild,
	ConfigError,
	enqueueBuild,
	getBuild,
	logTail,
	queuePosition,
	waitForChange
} from '#lib/server/builder/index.ts';
import { normalizeProject, projectHash, projectRoles } from '#lib/device/generator.ts';
import { projectConfigSchema } from './schemas';

const FINAL = new Set(['success', 'failed', 'cancelled']);

export const startBuild = command(
	v.object({ config: projectConfigSchema, projectId: v.optional(v.pipe(v.string(), v.uuid())) }),
	async ({ config, projectId }) => {
		const event = getRequestEvent();
		// Only link builds to projects the caller owns.
		if (projectId && !(await findOwnedProject(event, projectId))) projectId = undefined;
		try {
			const id = await enqueueBuild(config, { userId: event.locals.user?.id, projectId });
			return { id };
		} catch (err) {
			if (err instanceof ConfigError) error(400, err.message);
			throw err;
		}
	}
);

export const cancel = command(v.pipe(v.string(), v.uuid()), async (id) => {
	await cancelBuild(id);
});

async function snapshot(id: string) {
	const row = await getBuild(id);
	if (!row) error(404, 'Build not found');
	// Old builds store the configuration format of their time.
	const config = normalizeProject(row.config);
	return {
		id: row.id,
		status: row.status,
		error: row.error,
		roles: row.roles,
		configHash: row.configHash,
		/** `projectHash` of the configuration built: differs from the current one once it changed. */
		projectHash: projectHash(config),
		name: config.name,
		/** Chips in flash order. */
		chips: projectRoles(config).map(({ id, name, framework }) => ({
			id,
			name,
			framework,
			/** Ids of the features its firmware has (e.g. `ota`: it accepts updates over the network). */
			features: Object.keys(config.chips.find((c) => c.id === id)?.features ?? {})
		})),
		projectId: row.projectId,
		createdAt: row.createdAt,
		startedAt: row.startedAt,
		finishedAt: row.finishedAt,
		queuePosition: queuePosition(id),
		log: await logTail(id)
	};
}

export type BuildSnapshot = Awaited<ReturnType<typeof snapshot>>;

/** Streams the build state and log tail until the build finished. */
export const buildState = query.live(v.pipe(v.string(), v.uuid()), async function* (id) {
	while (true) {
		const state = await snapshot(id);
		yield state;
		if (FINAL.has(state.status)) return;
		await waitForChange(id);
		// Batch bursts of log lines into one update.
		await new Promise((r) => setTimeout(r, 300));
	}
});
