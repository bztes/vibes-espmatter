/**
 * Getting builds onto devices – a build of a firmware goes onto any of its devices:
 *
 * - `usb`:  the browser flashes over Web Serial (with the device's configuration) and reports.
 * - `pull`: a hub asks `GET /api/v1/devices/<id>/update` periodically and downloads it.
 * - `hub`:  a Matter device gets it over Matter from its hub's OTA provider, which asks here for
 *           it (`?format=matter`) with the hub's token.
 *
 * Releasing a build also nudges the device (`POST /api/v1/ota/check`) so it asks right away; when
 * this server can't reach it, it asks at its next periodic check anyway. Boards the main board
 * flashes over a wire come inside the main board's firmware. A device's settings are written by
 * USB flashing, or by the app through its tunnel (`PUT /api/v1/config`).
 */
import { timingSafeEqual } from 'node:crypto';
import { error } from '@sveltejs/kit';
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { normalize, resolve } from '#lib/core/engine.ts';
import type { FirmwareConfig } from '#lib/core/model.ts';
import { canPull, matterOta } from '#lib/core/platform.ts';
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
import { deviceConnection, deviceFetch } from './tunnel/core.ts';

export const OPEN_STATES: DeployState[] = ['pending', 'downloading', 'installing'];

const same = (a: string, b: string) => {
	const x = Buffer.from(a);
	const y = Buffer.from(b);
	return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * The device a `Authorization: Bearer <token>` header belongs to. After a token rotation the
 * previous token still works until the board has its new settings.
 */
export async function deviceFromToken(request: Request, deviceId?: string) {
	const header = request.headers.get('authorization') ?? '';
	const token = header.startsWith('Bearer ') ? header.slice(7) : '';
	if (!token) error(401, 'Bearer token required');
	const rows = deviceId
		? await db.select().from(device).where(eq(device.id, deviceId))
		: await db
				.select()
				.from(device)
				.where(or(eq(device.apiToken, token), eq(device.previousToken, token)));
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

/**
 * The device of `deviceId`, asked for by the device itself or by its hub (the hub's OTA provider
 * fetches its devices' updates).
 */
export async function deviceOrItsHub(request: Request, deviceId: string) {
	const caller = await deviceFromToken(request);
	if (caller.id === deviceId) return caller;
	const [dev] = await db
		.select()
		.from(device)
		.where(and(eq(device.id, deviceId), eq(device.hubId, caller.id)));
	if (!dev) error(401, 'Invalid token');
	return dev;
}

/** The token the board has: the previous one until it confirmed the new one. */
export const boardToken = (dev: Pick<DeviceRow, 'apiToken' | 'previousToken'>) =>
	dev.previousToken ?? dev.apiToken;

/**
 * How a build of a firmware reaches the main board over the air: `pull` – a hub, directly from
 * this app; `hub` – a Matter device, over Matter from its hub; undefined – USB only. Other boards
 * come inside the main board's firmware.
 */
export function otaMethod(config: FirmwareConfig, slot: string): 'pull' | 'hub' | undefined {
	if (slot !== 'main') return undefined;
	const r = resolve(config);
	if (canPull(r)) return 'pull';
	return matterOta(r) ? 'hub' : undefined;
}

/**
 * Why a device can't get a build over the air (undefined: it can). Whether its updates are on is
 * the board's setting: it tells when nudged.
 */
export function blockedOta(dev: DeviceContext, method: 'pull' | 'hub'): string | undefined {
	if (method === 'hub' && !dev.hubId)
		return 'Its updates come from its hub: pick the hub under Settings → App link and pair the device with it.';
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
	slot: string,
	method: 'pull' | 'hub'
) {
	const row = await createDeployment(buildId, dev.id, slot, method);
	void nudge(dev).then((reason) =>
		db
			.update(deployment)
			.set({
				message: reason
					? `Released – the device picks it up at its next check (${reason}).`
					: 'Released – the device was asked to check now.'
			})
			// The device may already be downloading: its report wins.
			.where(and(eq(deployment.id, row.id), eq(deployment.state, 'pending')))
	);
	return row;
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
		if (dev.reported.main?.running === b.version) {
			results.push({ deviceId: dev.id, name: dev.name, skipped: `Runs version ${b.version}.` });
			continue;
		}
		await release(buildId, dev, 'main', method);
		results.push({ deviceId: dev.id, name: dev.name, method, slots: ['main'] });
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
	if (!deviceConnection(dev))
		return dev.hubId
			? 'neither it nor its hub is connected to the app'
			: 'it isn’t connected to the app';
	try {
		const res = await deviceFetch(dev, {
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
export async function noteRunning(dev: DeviceRow, slot: string, running: number) {
	const known = dev.reported[slot];
	if (known?.running === running) return;
	await setReport(dev, slot, {
		...known,
		running,
		state: 'running',
		message: ''
	});
}

/** A device reports what runs (`running`) and how an update goes. */
export async function report(
	dev: DeviceRow,
	input: {
		slot: string;
		state: string;
		version: number;
		running: number;
		message?: string;
	}
) {
	await setReport(dev, input.slot, {
		running: input.running,
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
