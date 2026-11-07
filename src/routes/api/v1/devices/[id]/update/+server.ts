import { error, json } from '@sveltejs/kit';
import { deviceFromToken, noteRunning, pendingPull } from '#lib/server/deploy.ts';
import { getBuild } from '#lib/server/builds/queue.ts';
import { configImage, withContext } from '#lib/server/devices.ts';
import type { RequestHandler } from './$types';

/**
 * A device asks for an update of a slot it runs `version` of, with configuration `config`:
 * 204 when there's none, else the version and where to download the image (same token), and/or
 * `config` – the revision of its current configuration, when it runs another one (it fetches
 * `config.bin` then).
 */
export const GET: RequestHandler = async ({ params, request, url }) => {
	const row = await deviceFromToken(request, params.id);
	const slot = url.searchParams.get('slot') ?? 'main';
	const running = Number(url.searchParams.get('version'));
	if (!/^[a-z0-9-]{1,24}$/.test(slot) || !Number.isInteger(running))
		error(400, 'slot and version are required');
	const out: Record<string, unknown> = {};

	const has = url.searchParams.get('config');
	await noteRunning(row, slot, running, has && /^[0-9a-f]{1,16}$/.test(has) ? has : undefined);
	if (slot === 'main' && has !== null) {
		const { rev } = await configImage(await withContext(row));
		if (rev !== has) out.config = rev;
	}

	const d = await pendingPull(row.id, slot, running);
	const b = d && (await getBuild(d.buildId));
	const artifacts = b?.slots[slot];
	if (d && artifacts)
		Object.assign(out, {
			version: d.version,
			url: `${url.origin}/api/v1/firmware/${d.buildId}/${slot}/app.bin`,
			size: artifacts.appSize,
			sha256: artifacts.sha256
		});
	if (!Object.keys(out).length) return new Response(null, { status: 204 });
	return json(out);
};
