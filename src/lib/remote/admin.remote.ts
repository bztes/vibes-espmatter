/** Admin only (`requireAdmin`): users, sign-up, server settings and build runners. */
import * as v from 'valibot';
import { error } from '@sveltejs/kit';
import { asc, count, eq } from 'drizzle-orm';
import { command, query } from '$app/server';
import { randomPassword } from '#lib/core/engine.ts';
import { createUser, endAllSessions, requireAdmin, setPassword } from '#lib/server/auth.ts';
import { db } from '#lib/server/db/index.ts';
import { device, runner, user } from '#lib/server/db/schema.ts';
import { runningOn } from '#lib/server/builds/queue.ts';
import { runnerLog, runnerPhase, syncRunners, waitForRunners } from '#lib/server/builds/runners.ts';
import { getSetting, setSetting } from '#lib/server/settings.ts';
import { deviceDomain } from '#lib/server/tunnel/index.ts';
import { getSignUp } from './auth.remote.ts';
import { email, name, uuid } from './schemas.ts';

export const listUsers = query(async () => {
	requireAdmin();
	const users = await db
		.select({
			id: user.id,
			email: user.email,
			name: user.name,
			role: user.role,
			disabled: user.disabled,
			mustChangePassword: user.mustChangePassword,
			createdAt: user.createdAt,
			lastLoginAt: user.lastLoginAt
		})
		.from(user)
		.orderBy(asc(user.createdAt));
	const devices = await db
		.select({ ownerId: device.ownerId, n: count() })
		.from(device)
		.groupBy(device.ownerId);
	return users.map((u) => ({ ...u, devices: devices.find((d) => d.ownerId === u.id)?.n ?? 0 }));
});

async function adminsLeft(except: string) {
	const admins = await db
		.select({ id: user.id, disabled: user.disabled })
		.from(user)
		.where(eq(user.role, 'admin'));
	return admins.filter((a) => a.id !== except && !a.disabled).length;
}

export const updateUser = command(
	v.object({
		id: uuid,
		role: v.optional(v.picklist(['admin', 'user'])),
		disabled: v.optional(v.boolean())
	}),
	async ({ id, role, disabled }) => {
		const me = requireAdmin();
		if ((role === 'user' || disabled) && !(await adminsLeft(id)))
			error(409, 'At least one active admin must remain.');
		if (id === me.id && disabled) error(409, 'You can’t disable yourself.');
		await db
			.update(user)
			.set({ ...(role && { role }), ...(disabled !== undefined && { disabled }) })
			.where(eq(user.id, id));
		if (disabled) await endAllSessions(id);
		void listUsers().refresh();
	}
);

export const deleteUser = command(uuid, async (id) => {
	const me = requireAdmin();
	if (id === me.id) error(409, 'You can’t delete yourself.');
	if (!(await adminsLeft(id))) error(409, 'At least one active admin must remain.');
	await db.delete(user).where(eq(user.id, id));
	void listUsers().refresh();
});

/** A new random password; shown once to the admin. The user changes it at the next sign-in. */
export const resetPassword = command(uuid, async (id) => {
	const me = requireAdmin();
	if (id === me.id) error(409, 'Change your own password with “Change password”.');
	const pw = randomPassword(14);
	await setPassword(id, pw, true);
	void listUsers().refresh();
	return { password: pw };
});

export const inviteUser = command(
	v.object({ name, email, role: v.picklist(['admin', 'user']) }),
	async (input) => {
		requireAdmin();
		const [existing] = await db
			.select({ id: user.id })
			.from(user)
			.where(eq(user.email, input.email));
		if (existing) error(409, 'An account with this email exists.');
		const pw = randomPassword(14);
		await createUser({ ...input, password: pw, mustChangePassword: true });
		void listUsers().refresh();
		return { password: pw };
	}
);

export const getServerSettings = query(async () => {
	requireAdmin();
	return {
		signUpEnabled: await getSetting('signUpEnabled'),
		publicUrl: await getSetting('publicUrl'),
		/** Where device hostnames live without an app URL of their own (the host of the public URL). */
		deviceDomain: (await deviceDomain()).domain
	};
});

export const saveServerSettings = command(
	v.object({
		signUpEnabled: v.optional(v.boolean()),
		publicUrl: v.optional(
			v.union([
				v.literal(''),
				v.pipe(v.string(), v.trim(), v.url('An http(s):// URL, e.g. http://192.168.1.10:3000'))
			])
		)
	}),
	async (input) => {
		requireAdmin();
		if (input.signUpEnabled !== undefined) await setSetting('signUpEnabled', input.signUpEnabled);
		if (input.publicUrl !== undefined)
			await setSetting('publicUrl', input.publicUrl.replace(/\/$/, ''));
		void getServerSettings().refresh();
		void getSignUp().refresh();
	}
);

export const listRunners = query(async () => {
	requireAdmin();
	return db.select().from(runner).orderBy(asc(runner.createdAt));
});

export const saveRunner = command(
	v.object({
		id: v.optional(uuid),
		name,
		kind: v.picklist(['local', 'docker']),
		enabled: v.boolean(),
		config: v.object({
			idfPath: v.optional(v.pipe(v.string(), v.trim())),
			image: v.optional(v.pipe(v.string(), v.trim(), v.regex(/^[\w./:@-]*$/, 'Not an image name'))),
			concurrency: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(8))
		})
	}),
	async ({ id, ...values }) => {
		requireAdmin();
		if (values.kind === 'local' && !values.config.idfPath) error(400, 'Enter the ESP-IDF path.');
		if (id) await db.update(runner).set(values).where(eq(runner.id, id));
		else await db.insert(runner).values(values);
		await syncRunners();
		void listRunners().refresh();
	}
);

export const deleteRunner = command(uuid, async (id) => {
	requireAdmin();
	await db.delete(runner).where(eq(runner.id, id));
	await syncRunners();
	void listRunners().refresh();
});

export type RunnerStatus = 'disabled' | 'starting' | 'error' | 'idle' | 'building';

async function runnerStatuses() {
	const rows = await db.select().from(runner);
	return Object.fromEntries(
		rows.map((r) => {
			const phase = runnerPhase(r.id);
			const busy = runningOn(r.id);
			const status: RunnerStatus = !r.enabled
				? 'disabled'
				: phase === 'ready'
					? busy
						? 'building'
						: 'idle'
					: (phase ?? 'starting');
			return [r.id, { status, busy }];
		})
	);
}

/** What every runner is doing right now, by id. */
export const runnerStatus = query.live(async function* () {
	requireAdmin();
	while (true) {
		yield await runnerStatuses();
		await waitForRunners();
	}
});

/** A runner's log (output of its check), streamed while someone looks at it. */
export const runnerLogOf = query.live(uuid, async function* (id) {
	requireAdmin();
	while (true) {
		yield runnerLog(id);
		await waitForRunners();
	}
});
