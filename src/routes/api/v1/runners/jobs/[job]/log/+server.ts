import * as v from 'valibot';
import { error, json } from '@sveltejs/kit';
import { jobLog } from '#lib/server/builds/runner.ts';
import { requireRunner } from '#lib/server/builds/runners.ts';
import type { RequestHandler } from './$types';

const Body = v.object({ lines: v.pipe(v.array(v.string()), v.maxLength(10_000)) });

/** Log lines of a running job; 410 tells the runner to stop it. */
export const POST: RequestHandler = async ({ request, params }) => {
	const r = await requireRunner(request);
	const body = v.safeParse(Body, await request.json().catch(() => null));
	if (!body.success) error(400, body.issues[0].message);
	if (!jobLog(r.id, params.job, body.output.lines)) error(410, 'Unknown job');
	return json({ ok: true });
};
