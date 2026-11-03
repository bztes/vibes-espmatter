import { error } from '@sveltejs/kit';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import { Readable } from 'node:stream';
import { getBuild } from '#lib/server/builder/index.ts';
import { otaImage } from '#lib/server/updates.ts';
import type { RequestHandler } from './$types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The Matter OTA image of a build's chip, `/api/updates/<build>/<chip>/<vendor>-<product>.ota`, for
 * hubs to stream to the device. Like the other artifacts, the unguessable build id is the access token.
 */
export const GET: RequestHandler = async ({ params }) => {
	const ids = params.file.match(/^(\d{1,5})-(\d{1,5})\.ota$/);
	if (!UUID.test(params.id) || !/^[a-z0-9-]{1,24}$/.test(params.role) || !ids) error(404);
	const row = await getBuild(params.id);
	if (!row || row.status !== 'success') error(404);
	const file = await otaImage(row, params.role, Number(ids[1]), Number(ids[2]));
	if (!file) error(404, 'No image of this chip');
	const { size } = await fs.stat(file);
	return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, {
		headers: {
			'content-type': 'application/octet-stream',
			'content-length': String(size),
			'cache-control': 'private, max-age=31536000, immutable'
		}
	});
};
