import { bearerProject, matterUpdates, plain } from '#lib/server/updates.ts';
import { versionString } from '#lib/device/util.ts';
import type { RequestHandler } from './$types';

/**
 * A hub (`matter_updates`) asks for the open updates of its owner's Matter devices: one line each –
 * UniqueID, version, the URL of the build's chip (the hub appends `<vendor>-<product>.ota`: the
 * device's ids go into the image header) and the version string.
 */
export const GET: RequestHandler = async ({ request, url }) => {
	const hub = await bearerProject(request);
	const lines = (await matterUpdates(hub.userId)).map(
		(u) =>
			`${u.uniqueId} ${u.version} ${url.origin}/api/updates/${u.buildId}/${u.role}/ ${versionString(u.version)}`
	);
	return plain(lines.map((l) => l + '\n').join(''));
};
