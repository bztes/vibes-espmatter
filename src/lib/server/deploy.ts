/**
 * Getting builds onto devices – a build of a firmware goes onto any of its devices:
 *
 * - `usb`:  the browser flashes over Web Serial (with the device's configuration) and reports.
 * - `pull`: the device asks `GET /api/v1/devices/<id>/update` periodically and downloads it.
 * - `hub`:  like pull, but a Thread device asks through a hub's update relay, which proxies to here.
 *
 * Releasing a build for pull also nudges the device (`POST /api/v1/ota/check`) so it asks right
 * away; when this server can't reach it, it asks at its next periodic check anyway. A device's
 * configuration travels the same ways: written by USB flashing, or pulled when the update
 * manifest names another revision.
 */
import { timingSafeEqual } from 'node:crypto';
import { error } from '@sveltejs/kit';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { normalize, resolve } from '#lib/core/engine.ts';
import type { FirmwareConfig } from '#lib/core/model.ts';
import { updateRoute } from '#lib/core/platform.ts';
import { db } from './db/index.ts';
import {
	build,
	deployment,
	device,
	type DeployMethod,
	type DeployState,
	type SlotReport
} from './db/schema.ts';
import { withContext, type DeviceContext, type DeviceRow } from './devices.ts';
import { tunnelConnected, tunnelFetch } from './tunnel/core.ts';

export const OPEN_STATES: DeployState[] = ['pending', 'downloading', 'installing'];

const same = (a: string, b: string) => {
	const x = Buffer.from(a);
	const y = Buffer.from(b);
	return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * The device a `Authorization: Bearer <token>` header belongs to. After a token rotation the
 * previous token still works until the device runs the configuration with the new one.
 */
export async function deviceFromToken(request: Request, deviceId?: string) {
	const header = request.headers.get('authorization') ?? '';
	const token = header.startsWith('Bearer ') ? header.slice(7) : '';
	if (!token) error(401, 'Bearer token required');
	const rows = deviceId
		? await db.select().from(device).where(eq(device.id, deviceId))
		: await db.select().from(device).where(eq(device.apiToken, token));
	const row = rows[0];
	if (!row) error(401, 'Invalid token');
	if (same(row.apiToken, token)) {
		// The device has the new token: the old one is done.
		if (row.previousToken)
			await db
				.update(device)
				.set({ previousToken: null, updatedAt: row.updatedAt })
				.where(eq(device.id, row.id));
		return { ...row, previousToken: null };
	}
	if (row.previousToken && same(row.previousToken, token)) return row;
	error(401, 'Invalid token');
}

/** The token the board has: the previous one until it confirmed the new one. */
export const boardToken = (dev: Pick<DeviceRow, 'apiToken' | 'previousToken'>) =>
	dev.previousToken ?? dev.apiToken;

/**
 * How a build of a firmware reaches a slot over the air (whatever devices allow): `pull` directly
 * from this app, `hub` through a hub's relay, or undefined – USB only. A board the main board
 * flashes over a wire gets its updates the way the main board gets its own.
 */
export function otaMethod(config: FirmwareConfig, slot: string): 'pull' | 'hub' | undefined {
	const r = resolve(config);
	if (slot !== 'main' && !r.slots.find((s) => s.id === slot)?.wired) return undefined;
	const route = updateRoute(r);
	return route === 'none' ? undefined : route === 'hub' ? 'hub' : 'pull';
}

/** Why a device can't get a build over the air (undefined: it can). */
export function blockedOta(dev: DeviceContext, method: 'pull' | 'hub'): string | undefined {
	if (!dev.settings.updates.pull)
		return 'Updates from the app are off for this device (Settings → Updates).';
	if (method === 'hub' && !dev.hubId) return 'Assign the hub that relays updates under Settings.';
	return undefined;
}

/** Start a deployment; earlier open ones of the same device and slot are superseded. */
export async function createDeployment(
	buildId: string,
	deviceId: string,
	slot: string,
	method: DeployMethod
) {
	const [b] = await db.select().from(build).where(eq(build.id, buildId));
	if (!b || b.status !== 'success' || !b.slots[slot])
		error(409, 'Only finished builds can be installed.');
	const [dev] = await db.select().from(device).where(eq(device.id, deviceId));
	if (!dev || dev.firmwareId !== b.firmwareId)
		error(400, 'That build is of another firmware than the device runs.');
	await db
		.update(deployment)
		.set({ state: 'superseded' })
		.where(
			and(
				eq(deployment.deviceId, deviceId),
				eq(deployment.slot, slot),
				inArray(deployment.state, OPEN_STATES)
			)
		);
	const [row] = await db
		.insert(deployment)
		.values({ deviceId, buildId, slot, version: b.version, method })
		.returning();
	return row;
}

/**
 * Release a build for a device to pull (its main board and/or boards it flashes over a wire),
 * then ask the device to check now.
 */
export async function release(
	buildId: string,
	dev: DeviceRow,
	slots: string[],
	method: 'pull' | 'hub'
) {
	const rows: Awaited<ReturnType<typeof createDeployment>>[] = [];
	for (const slot of slots) rows.push(await createDeployment(buildId, dev.id, slot, method));
	void nudge(dev).then((reason) =>
		db
			.update(deployment)
			.set({
				message: reason
					? `Released – the device picks it up at its next check (${reason}).`
					: 'Released – the device was asked to check now.'
			})
			// The device may already be downloading: its report wins.
			.where(
				and(
					inArray(
						deployment.id,
						rows.map((r) => r.id)
					),
					eq(deployment.state, 'pending')
				)
			)
	);
	return rows;
}

/**
 * Roll a build out to devices of its firmware (all, or the given ones): released for them to pull
 * (directly or through their hub). Devices that can only be flashed over USB are skipped. Boards
 * the main board flashes over a wire come along.
 */
export async function rollOut(buildId: string, deviceIds?: string[]) {
	const [b] = await db.select().from(build).where(eq(build.id, buildId));
	if (!b || b.status !== 'success' || !b.slots.main)
		error(409, 'Only finished builds can be installed.');
	const config = normalize(b.config);
	const method = otaMethod(config, 'main');
	const wired = Object.keys(b.slots).filter((slot) => slot !== 'main' && b.slots[slot].viaMain);
	const rows = await db
		.select()
		.from(device)
		.where(
			deviceIds
				? and(eq(device.firmwareId, b.firmwareId), inArray(device.id, deviceIds))
				: eq(device.firmwareId, b.firmwareId)
		);
	const results: {
		deviceId: string;
		name: string;
		method?: DeployMethod;
		slots?: string[];
		skipped?: string;
	}[] = [];
	for (const row of rows) {
		const dev = await withContext(row);
		const blocked = method
			? blockedOta(dev, method)
			: 'This firmware can only be installed over USB.';
		if (!method || blocked) {
			results.push({ deviceId: dev.id, name: dev.name, skipped: blocked });
			continue;
		}
		// The main board's own update, and those it installs on its wired boards.
		const slots = [...wired, 'main'].filter(
			(slot) =>
				dev.reported[slot]?.running !== b.version &&
				(slot === 'main' || otaMethod(config, slot) === method)
		);
		if (!slots.length) {
			results.push({ deviceId: dev.id, name: dev.name, skipped: `Runs version ${b.version}.` });
			continue;
		}
		await release(buildId, dev, slots, method);
		results.push({ deviceId: dev.id, name: dev.name, method, slots });
	}
	return results;
}

export async function setDeploymentState(id: string, state: DeployState, message?: string | null) {
	await db
		.update(deployment)
		.set({ state, message: message ?? null })
		.where(eq(deployment.id, id));
}

/**
 * Ask the device to check for updates now (`POST /api/v1/ota/check`): new firmware or settings
 * are waiting. Undefined when it did; else why not – it then asks at its next periodic check.
 */
export async function nudge(dev: DeviceRow): Promise<string | undefined> {
	if (!tunnelConnected(dev.id)) return 'it isn’t connected to the app (Remote access feature)';
	try {
		const res = await tunnelFetch(dev.id, {
			method: 'POST',
			path: '/api/v1/ota/check',
			headers: { authorization: `Bearer ${boardToken(dev)}` }
		});
		if (res.ok) return undefined;
		const json = (await res.json().catch(() => ({}))) as { error?: string };
		return json.error || `HTTP ${res.status}`;
	} catch (err) {
		return err instanceof Error ? err.message : String(err);
	}
}

/** The open pull deployment of a slot, if its version isn't running yet. */
export async function pendingPull(deviceId: string, slot: string, running: number) {
	const [d] = await db
		.select()
		.from(deployment)
		.where(
			and(
				eq(deployment.deviceId, deviceId),
				eq(deployment.slot, slot),
				inArray(deployment.method, ['pull', 'hub']),
				inArray(deployment.state, OPEN_STATES)
			)
		)
		.orderBy(desc(deployment.createdAt))
		.limit(1);
	if (!d) return undefined;
	if (d.version === running) {
		await setDeploymentState(d.id, 'done');
		return undefined;
	}
	return d;
}

const REPORT_STATES: Record<string, DeployState> = {
	downloading: 'downloading',
	installing: 'installing',
	installed: 'installing',
	failed: 'failed'
};

/** Merges one slot's report in the database, so reports of other slots arriving meanwhile stay. */
async function setReport(dev: DeviceRow, slot: string, value: SlotReport) {
	const json = JSON.stringify({ ...value, at: Date.now() });
	await db
		.update(device)
		.set({
			reported: sql`json_set(${device.reported}, ${`$."${slot}"`}, json(${json}))`,
			lastSeenAt: new Date(),
			updatedAt: dev.updatedAt
		})
		.where(eq(device.id, dev.id));
}

/** An update check says what runs: note it when the app's record differs (a missed report). */
export async function noteRunning(dev: DeviceRow, slot: string, running: number, config?: string) {
	const known = dev.reported[slot];
	if (known?.running === running && (config === undefined || known.config === config)) return;
	await setReport(dev, slot, {
		...known,
		running,
		config: config ?? known?.config,
		state: 'running',
		message: ''
	});
}

/** A device reports what runs (`running`, `config`) and how an update goes. */
export async function report(
	dev: DeviceRow,
	input: {
		slot: string;
		state: string;
		version: number;
		running: number;
		config?: string;
		message?: string;
	}
) {
	await setReport(dev, input.slot, {
		running: input.running,
		config: input.config,
		state: input.state,
		message: input.message
	});

	const open = await db
		.select()
		.from(deployment)
		.where(
			and(
				eq(deployment.deviceId, dev.id),
				eq(deployment.slot, input.slot),
				inArray(deployment.state, OPEN_STATES)
			)
		);
	for (const d of open) {
		if (input.running === d.version) await setDeploymentState(d.id, 'done', 'Running.');
		else if (input.version === d.version && REPORT_STATES[input.state])
			await setDeploymentState(d.id, REPORT_STATES[input.state], input.message || null);
	}
}

export async function deploymentsOf(deviceId: string) {
	return db
		.select()
		.from(deployment)
		.where(eq(deployment.deviceId, deviceId))
		.orderBy(desc(deployment.createdAt))
		.limit(20);
}

/**
 * Update state of every device of a firmware: what it runs, the newest finished build, its latest
 * deployment and – if it can't get builds over the air – why.
 */
export async function firmwareUpdates(firmwareId: string) {
	const [latest] = await db
		.select({ id: build.id, version: build.version, config: build.config })
		.from(build)
		.where(and(eq(build.firmwareId, firmwareId), eq(build.status, 'success')))
		.orderBy(desc(build.version))
		.limit(1);
	const method = latest ? otaMethod(normalize(latest.config), 'main') : undefined;
	const rows = await db.select().from(device).where(eq(device.firmwareId, firmwareId));
	const devices = [];
	for (const row of rows) {
		const [last] = await db
			.select({
				version: deployment.version,
				state: deployment.state,
				method: deployment.method,
				message: deployment.message,
				updatedAt: deployment.updatedAt
			})
			.from(deployment)
			.where(and(eq(deployment.deviceId, row.id), eq(deployment.slot, 'main')))
			.orderBy(desc(deployment.createdAt))
			.limit(1);
		devices.push({
			id: row.id,
			running: row.reported.main?.running,
			deployment: last,
			blocked: method
				? blockedOta(await withContext(row), method)
				: 'This firmware can only be installed over USB.'
		});
	}
	return { latest: latest && { id: latest.id, version: latest.version }, devices };
}
