import { error } from '@sveltejs/kit';
import { bearerProject, matterUpdates, report, getUpdate } from '#lib/server/updates.ts';
import { DEVICE_UPDATE_STATES, type DeviceUpdateState } from '#lib/server/db/schema.ts';
import type { RequestHandler } from './$types';

const STATES: DeviceUpdateState[] = DEVICE_UPDATE_STATES.filter((s) => s !== 'requested');

/**
 * How far an update got (form body): `role` for a board's own chip, or `device` (its UniqueID) for a
 * hub's Matter device; `version` it is of, `state` and an optional `message`.
 */
export const POST: RequestHandler = async ({ request }) => {
	const caller = await bearerProject(request);
	const form = new URLSearchParams(await request.text());
	const state = form.get('state') as DeviceUpdateState;
	const version = Number(form.get('version'));
	const message = form.get('message')?.slice(0, 200) || null;
	if (!STATES.includes(state) || !Number.isInteger(version))
		error(400, 'state and version are required');

	const role = form.get('role');
	const device = form.get('device');
	const update = role
		? await getUpdate(caller.id, role)
		: (await matterUpdates(caller.userId)).find((u) => u.uniqueId === device);
	// An older report, or for an update replaced since: nothing to do.
	if (!update || update.version !== version) return new Response(null, { status: 204 });
	await report(update, state, message);
	return new Response(null, { status: 204 });
};
