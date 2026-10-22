import * as v from 'valibot';
import { error } from '@sveltejs/kit';
import { desc, eq } from 'drizzle-orm';
import { command, getRequestEvent, query } from '$app/server';
import { db } from '#lib/server/db/index.ts';
import { build, project } from '#lib/server/db/schema.ts';
import { findOwnedProject, ownedBy } from '#lib/server/owner.ts';
import { DEVICE_ADDRESS } from '#lib/device-address.ts';
import { normalizeProject } from '#lib/device/generator.ts';
import type { ProjectConfig } from '#lib/device/types.ts';
import { projectConfigSchema } from './schemas';

async function ownedProject(id: string) {
	const row = await findOwnedProject(getRequestEvent(), id);
	if (!row) error(404, 'Configuration not found');
	return row;
}

export const listProjects = query(async () => {
	const owned = ownedBy(getRequestEvent());
	if (!owned) return [];
	const rows = await db
		.select({
			id: project.id,
			name: project.name,
			config: project.config,
			lastAddress: project.lastAddress,
			lastSeenAt: project.lastSeenAt,
			updatedAt: project.updatedAt
		})
		.from(project)
		.where(owned)
		.orderBy(desc(project.updatedAt));
	return rows.map(({ config, ...row }) => {
		const normalized = normalizeProject(config);
		return {
			...row,
			template: normalized.template,
			chips: normalized.chips.map((c) => ({
				name: c.name,
				board: c.board,
				features: Object.keys(c.features)
			}))
		};
	});
});

export const getProject = query(v.pipe(v.string(), v.uuid()), async (id) => {
	const row = await ownedProject(id);
	return {
		id: row.id,
		name: row.name,
		config: normalizeProject(row.config),
		lastAddress: row.lastAddress,
		lastSeenAt: row.lastSeenAt,
		updatedAt: row.updatedAt
	};
});

export const saveProject = command(
	v.object({ id: v.optional(v.pipe(v.string(), v.uuid())), config: projectConfigSchema }),
	async ({ id, config }) => {
		const userId = getRequestEvent().locals.user?.id;
		if (!userId) error(401, 'Sign in to save devices');
		const values = { name: config.name, deviceType: templateOf(config), config };
		if (id) {
			await ownedProject(id);
			await db.update(project).set(values).where(eq(project.id, id));
		} else {
			const [row] = await db
				.insert(project)
				.values({ userId, ...values })
				.returning({ id: project.id });
			id = row.id;
		}
		void listProjects().refresh();
		return { id };
	}
);

const templateOf = (config: ProjectConfig) => config.template ?? 'custom';

/**
 * Remember where the device's web interface was last seen (reported by the device over serial
 * as `MESP_WEB_URL=…`, or used for an OTA update) or set it by hand (`manual`: not a sighting).
 */
export const setDeviceAddress = command(
	v.object({
		id: v.pipe(v.string(), v.uuid()),
		address: v.pipe(v.string(), v.maxLength(100), v.regex(DEVICE_ADDRESS, 'Not a device address')),
		manual: v.optional(v.boolean())
	}),
	async ({ id, address, manual }) => {
		const row = await ownedProject(id);
		const lastAddress = address.replace(/\/$/, '').replace(/:80$/, '');
		// Keep `updatedAt`: seeing the device is not an edit of its configuration.
		await db
			.update(project)
			.set({
				lastAddress,
				lastSeenAt: manual ? row.lastSeenAt : new Date(),
				updatedAt: row.updatedAt
			})
			.where(eq(project.id, id));
		void getProject(id).refresh();
		void listProjects().refresh();
		return { lastAddress };
	}
);

/**
 * Is the device answering at its saved address? Asked from the server for browsers that can't
 * reach it themselves (an http:// device from an https:// page) – works when the server is in the
 * same network. Only ever contacts the saved address of the user's own device.
 */
export const probeDevice = command(v.pipe(v.string(), v.uuid()), async (id) => {
	const row = await ownedProject(id);
	if (!row.lastAddress) return { online: false };
	try {
		const res = await fetch(new URL('/api/auth/me', row.lastAddress), {
			signal: AbortSignal.timeout(2500),
			redirect: 'manual'
		});
		await res.body?.cancel();
		if (res.ok) {
			await db
				.update(project)
				.set({ lastSeenAt: new Date(), updatedAt: row.updatedAt })
				.where(eq(project.id, id));
		}
		return { online: res.ok };
	} catch {
		return { online: false };
	}
});

export const deleteProject = command(v.pipe(v.string(), v.uuid()), async (id) => {
	await ownedProject(id);
	await db.delete(project).where(eq(project.id, id));
	void listProjects().refresh();
});

export const listProjectBuilds = query(v.pipe(v.string(), v.uuid()), async (id) => {
	await ownedProject(id);
	return db
		.select({
			id: build.id,
			status: build.status,
			createdAt: build.createdAt,
			finishedAt: build.finishedAt
		})
		.from(build)
		.where(eq(build.projectId, id))
		.orderBy(desc(build.createdAt))
		.limit(10);
});
