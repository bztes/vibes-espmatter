import * as v from 'valibot';
import { error, json } from '@sveltejs/kit';
import { reconcileJobs } from '#lib/server/builds/runner.ts';
import { pollRunner, registerRunner, requireRunner } from '#lib/server/builds/runners.ts';
import type { RequestHandler } from './$types';

const Report = v.object({
	idfVersion: v.pipe(v.string(), v.maxLength(40)),
	concurrency: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(8)),
	/** Jobs it is running. */
	jobs: v.pipe(v.array(v.string()), v.maxLength(16))
});

/** A runner's long poll: marks it online and answers with its next commands. */
export const POST: RequestHandler = async ({ request }) => {
	const r = await requireRunner(request);
	const report = v.safeParse(Report, await request.json().catch(() => null));
	if (!report.success) error(400, report.issues[0].message);
	const { jobs, ...rest } = report.output;
	await registerRunner(r, rest);
	reconcileJobs(r.id, jobs);
	return json({ commands: await pollRunner(r.id, request.signal) });
};
