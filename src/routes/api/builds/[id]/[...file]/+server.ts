import { error } from '@sveltejs/kit';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { artifactDir, getBuild } from '#lib/server/builder/index.ts';
import { slugify } from '#lib/device/util.ts';
import type { RequestHandler } from './$types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Build artifacts: `/api/builds/<id>/build.log` or `/api/builds/<id>/<role>/<file>.bin`.
 * Build ids are unguessable UUIDs, so they act as the access token (anonymous builds have no owner).
 */
export const GET: RequestHandler = async ({ params, url }) => {
	if (!UUID.test(params.id)) error(404);
	const segments = params.file.split('/');
	if (segments.length > 2 || segments.some((s) => !/^[\w.-]+$/.test(s) || s.startsWith('.')))
		error(404);

	const row = await getBuild(params.id);
	if (!row) error(404);

	const file = path.join(artifactDir(params.id), ...segments);
	const stat = await fs.stat(file).catch(() => undefined);
	if (!stat?.isFile()) error(404, 'File not found');

	const isLog = segments.at(-1) === 'build.log';
	const headers: Record<string, string> = {
		'content-type': isLog ? 'text/plain; charset=utf-8' : 'application/octet-stream',
		'content-length': String(stat.size),
		'cache-control': isLog ? 'no-store' : 'private, max-age=31536000, immutable',
		// The device web UI may fetch images for OTA from another origin.
		'access-control-allow-origin': '*'
	};
	if (url.searchParams.has('download')) {
		const name = `${slugify(row.config.name)}-${segments.join('-')}`;
		headers['content-disposition'] = `attachment; filename="${name}"`;
	}
	return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, { headers });
};
