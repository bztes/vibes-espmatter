import { error } from '@sveltejs/kit';
import { jobUpload } from '#lib/server/builds/runner.ts';
import { requireRunner } from '#lib/server/builds/runners.ts';
import type { RequestHandler } from './$types';

/** A chunk of an artifact, appended at `?offset=` (chunks stay below proxy body limits). */
export const PUT: RequestHandler = async ({ request, params, url }) => {
	const r = await requireRunner(request);
	const offset = Number(url.searchParams.get('offset') ?? 0);
	if (!Number.isSafeInteger(offset) || offset < 0) error(400, 'Bad offset');
	const res = await jobUpload(r.id, params.job, params.file, offset, request.body);
	if (res === 'unknown') error(410, 'Unknown job');
	if (res === 'invalid') error(400, 'Bad file name or offset');
	return new Response(null, { status: 204 });
};
