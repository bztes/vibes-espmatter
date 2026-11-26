import { error, json } from '@sveltejs/kit';
import { deviceOrItsHub, noteRunning, pendingPull } from '#lib/server/deploy.ts';
import { getBuild } from '#lib/server/builds/queue.ts';
import type { RequestHandler } from './$types';

/**
 * An update of a slot that runs `version`, asked for by the device (a hub) or by its hub (the OTA
 * provider of a Matter device, `format=matter`): 204 when there's none, else the version and where
 * to download the image (same token).
 */
export const GET: RequestHandler = async ({ params, request, url }) => {
	const row = await deviceOrItsHub(request, params.id);
	const slot = url.searchParams.get('slot') ?? 'main';
	const running = Number(url.searchParams.get('version'));
	const matter = url.searchParams.get('format') === 'matter';
	if (!/^[a-z0-9-]{1,24}$/.test(slot) || !Number.isInteger(running))
		error(400, 'slot and version are required');
	await noteRunning(row, slot, running);

	const d = await pendingPull(row.id, slot, running);
	const b = d && (await getBuild(d.buildId));
	const artifacts = b?.slots[slot];
	if (!d || !artifacts) return new Response(null, { status: 204 });
	if (matter) {
		if (!artifacts.matterOta) error(409, 'This build has no Matter OTA image – build it again.');
		return json({
			version: d.version,
			versionString: String(d.version),
			url: `${url.origin}/api/v1/firmware/${d.buildId}/${slot}/${artifacts.matterOta}`,
			size: artifacts.matterOtaSize
		});
	}
	return json({
		version: d.version,
		url: `${url.origin}/api/v1/firmware/${d.buildId}/${slot}/app.bin`,
		size: artifacts.appSize,
		sha256: artifacts.sha256
	});
};
