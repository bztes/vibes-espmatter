import * as v from 'valibot';
import { error } from '@sveltejs/kit';
import { jobResult } from '#lib/server/builds/runner.ts';
import { requireRunner } from '#lib/server/builds/runners.ts';
import type { RequestHandler } from './$types';

const Body = v.object({ exit: v.pipe(v.number(), v.integer()) });

/** A job ended; its artifacts are uploaded. */
export const POST: RequestHandler = async ({ request, params }) => {
	const r = await requireRunner(request);
	const body = v.safeParse(Body, await request.json().catch(() => null));
	if (!body.success) error(400, body.issues[0].message);
	if (!jobResult(r.id, params.job, body.output.exit)) error(410, 'Unknown job');
	return new Response(null, { status: 204 });
};
