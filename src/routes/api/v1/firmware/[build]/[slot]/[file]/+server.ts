import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { slug } from '#sdk';
import { db } from '#lib/server/db/index.ts';
import { firmware } from '#lib/server/db/schema.ts';
import { deviceFromToken } from '#lib/server/deploy.ts';
import { artifactDir, getBuild } from '#lib/server/builds/queue.ts';
import { configImage, ownedDevice } from '#lib/server/devices.ts';
import type { RequestHandler } from './$types';

/**
 * Build artifacts, for a device of the firmware (its token) or the owner (signed in).
 * `merged.bin?device=<id>`: the merged image with that device's configuration in it.
 */
export const GET: RequestHandler = async ({ params, request, locals, url }) => {
	if (
		!/^[0-9a-f-]{36}$/.test(params.build) ||
		!/^[a-z0-9-]{1,24}$/.test(params.slot) ||
		!/^[\w.-]+\.bin$/.test(params.file)
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
		if (dev.firmwareId !== b.firmwareId) error(404);
	}
	const file = path.join(artifactDir(b.id), params.slot, params.file);
	const stat = await fs.stat(file).catch(() => undefined);
	if (!stat?.isFile()) error(404, 'File not found');
	const download = url.searchParams.has('download');
	const deviceId = url.searchParams.get('device');
	const artifacts = b.slots[params.slot];

	if (deviceId && params.file === artifacts?.merged && artifacts.config) {
		if (!locals.user) error(401);
		const dev = await ownedDevice(deviceId);
		if (dev.firmwareId !== b.firmwareId) error(400, 'The device runs another firmware.');
		const merged = await fs.readFile(file);
		const { offset, size } = artifacts.config;
		const out = Buffer.alloc(Math.max(merged.length, offset + size), 0xff);
		merged.copy(out);
		out.set((await configImage(dev, url.origin)).image, offset);
		return new Response(out as unknown as BodyInit, {
			headers: {
				'content-type': 'application/octet-stream',
				'cache-control': 'no-store',
				...(download && {
					'content-disposition': `attachment; filename="${slug(dev.name)}-v${b.version}-${params.slot}-merged.bin"`
				})
			}
		});
	}

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
