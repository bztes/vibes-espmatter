import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { slug } from '#sdk';
import { db } from '#lib/server/db/index.ts';
import { device, firmware } from '#lib/server/db/schema.ts';
import { deviceFromToken } from '#lib/server/deploy.ts';
import { artifactDir, getBuild } from '#lib/server/builds/queue.ts';
import type { RequestHandler } from './$types';

/**
 * Build artifacts, for a device of the firmware (its token, or its hub's: the hub's OTA provider
 * sends it its update) or the owner (signed in). Without device settings: those are written by the
 * app's USB flasher, or on the board itself.
 */
export const GET: RequestHandler = async ({ params, request, locals, url }) => {
	if (
		!/^[0-9a-f-]{36}$/.test(params.build) ||
		!/^[a-z0-9-]{1,24}$/.test(params.slot) ||
		!/^[\w.-]+\.(bin|ota)$/.test(params.file)
	)
		error(404);
	const b = await getBuild(params.build);
	if (!b || b.status !== 'success') error(404);
	if (locals.user) {
		const [fw] = await db
			.select({ ownerId: firmware.ownerId })
			.from(firmware)
			.where(eq(firmware.id, b.firmwareId));
		if (fw?.ownerId !== locals.user.id && locals.user.role !== 'admin') error(404);
	} else {
		const dev = await deviceFromToken(request);
		// A hub fetches the builds of its devices for them.
		const forChild = async () =>
			(
				await db
					.select({ id: device.id })
					.from(device)
					.where(and(eq(device.hubId, dev.id), eq(device.firmwareId, b.firmwareId)))
					.limit(1)
			).length > 0;
		if (dev.firmwareId !== b.firmwareId && !(await forChild())) error(404);
	}
	const file = path.join(artifactDir(b.id), params.slot, params.file);
	const stat = await fs.stat(file).catch(() => undefined);
	if (!stat?.isFile()) error(404, 'File not found');
	const download = url.searchParams.has('download');

	const headers: Record<string, string> = {
		'content-type': 'application/octet-stream',
		'content-length': String(stat.size),
		'cache-control': 'private, max-age=31536000, immutable'
	};
	if (download)
		headers['content-disposition'] =
			`attachment; filename="${slug(b.config.name)}-v${b.version}-${params.slot}-${params.file}"`;
	return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, { headers });
};
