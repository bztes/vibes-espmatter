import { error } from '@sveltejs/kit';
import { bearerProject, plain, selfUpdate } from '#lib/server/updates.ts';
import { versionString } from '#lib/device/util.ts';
import type { RequestHandler } from './$types';

/**
 * A board (`app_updates`) asks for an update of its chip `role`, running `version`: 204 if none was
 * started in the app, else three lines – version, version string and the URL of the app image.
 */
export const GET: RequestHandler = async ({ request, url }) => {
	const device = await bearerProject(request);
	const role = url.searchParams.get('role') ?? '';
	const current = Number(url.searchParams.get('version'));
	if (!role || !Number.isInteger(current)) error(400, 'role and version are required');
	const update = await selfUpdate(device.id, role, current);
	if (!update) return new Response(null, { status: 204 });
	const image = `${url.origin}/api/builds/${update.file}`;
	return plain(`${update.version}\n${versionString(update.version)}\n${image}\n`);
};
