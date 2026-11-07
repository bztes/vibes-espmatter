import * as v from 'valibot';
import { error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { command, query } from '$app/server';
import { db } from '#lib/server/db/index.ts';
import { deployment } from '#lib/server/db/schema.ts';
import {
	blockedOta,
	createDeployment,
	deploymentsOf,
	firmwareUpdates as updatesOf,
	otaMethod,
	OPEN_STATES,
	release,
	rollOut as rollOutBuild,
	setDeploymentState
} from '#lib/server/deploy.ts';
import { getBuild } from '#lib/server/builds/queue.ts';
import { ownedDevice, ownedFirmware } from '#lib/server/devices.ts';
import { normalize } from '#lib/core/engine.ts';
import { getDevice, listDevices } from './devices.remote.ts';
import { uuid } from './schemas.ts';

/**
 * Install a build of the device's firmware on one device: `usb` records a flash the browser does,
 * `ota` releases it for the device to pull (directly or through its hub).
 */
export const deploy = command(
	v.object({
		buildId: uuid,
		deviceId: uuid,
		slot: v.pipe(v.string(), v.regex(/^[a-z0-9-]{1,24}$/)),
		method: v.picklist(['usb', 'ota'])
	}),
	async ({ buildId, deviceId, slot, method }) => {
		const b = await getBuild(buildId);
		if (!b) error(404, 'Build not found');
		const dev = await ownedDevice(deviceId);
		if (dev.firmwareId !== b.firmwareId) error(400, 'That build is of another firmware.');
		let row;
		if (method === 'usb') row = await createDeployment(buildId, deviceId, slot, 'usb');
		else {
			const ota = otaMethod(normalize(b.config), slot);
			if (!ota) error(400, 'This build can only be installed over USB.');
			const blocked = blockedOta(dev, ota);
			if (blocked) error(400, blocked);
			[row] = await release(buildId, dev, [slot], ota);
		}
		void deployments(deviceId).reconnect();
		void firmwareUpdates(dev.firmwareId).reconnect();
		return { id: row.id };
	}
);

/** Install a build on all (or some) devices of its firmware, each the way it allows. */
export const rollOut = command(
	v.object({ buildId: uuid, deviceIds: v.optional(v.array(uuid)) }),
	async ({ buildId, deviceIds }) => {
		const b = await getBuild(buildId);
		if (!b) error(404, 'Build not found');
		await ownedFirmware(b.firmwareId);
		const results = await rollOutBuild(buildId, deviceIds);
		for (const r of results) if (r.method) void deployments(r.deviceId).reconnect();
		void listDevices().refresh();
		void firmwareUpdates(b.firmwareId).reconnect();
		return results;
	}
);

/** The browser reports how USB flashing went (firmware and configuration). */
export const reportUsb = command(
	v.object({
		id: uuid,
		ok: v.boolean(),
		message: v.optional(v.pipe(v.string(), v.maxLength(300)))
	}),
	async ({ id, ok, message }) => {
		const [d] = await db
			.select()
			.from(deployment)
			.where(and(eq(deployment.id, id), eq(deployment.method, 'usb')));
		if (!d) error(404, 'Deployment not found');
		await ownedDevice(d.deviceId);
		await setDeploymentState(id, ok ? 'done' : 'failed', message);
		void deployments(d.deviceId).reconnect();
		void getDevice(d.deviceId).refresh();
	}
);

export const cancelDeployment = command(uuid, async (id) => {
	const [d] = await db.select().from(deployment).where(eq(deployment.id, id));
	if (!d) error(404, 'Deployment not found');
	await ownedDevice(d.deviceId);
	if (OPEN_STATES.includes(d.state)) await setDeploymentState(id, 'superseded', 'Cancelled.');
	void deployments(d.deviceId).reconnect();
});

/** Deployments of a device, refreshed every few seconds while one is open. */
export const deployments = query.live(uuid, async function* (deviceId) {
	await ownedDevice(deviceId);
	let last = '';
	while (true) {
		const rows = await deploymentsOf(deviceId);
		const key = JSON.stringify(rows);
		if (key !== last) {
			last = key;
			yield rows;
		}
		await new Promise((r) =>
			setTimeout(r, rows.some((r) => OPEN_STATES.includes(r.state)) ? 2000 : 8000)
		);
	}
});

/** Update state of a firmware's devices, refreshed every few seconds while an update runs. */
export const firmwareUpdates = query.live(uuid, async function* (firmwareId) {
	await ownedFirmware(firmwareId);
	let last = '';
	while (true) {
		const state = await updatesOf(firmwareId);
		const key = JSON.stringify(state);
		if (key !== last) {
			last = key;
			yield state;
		}
		const open = state.devices.some(
			(d) => d.deployment && OPEN_STATES.includes(d.deployment.state)
		);
		await new Promise((r) => setTimeout(r, open ? 2000 : 8000));
	}
});
