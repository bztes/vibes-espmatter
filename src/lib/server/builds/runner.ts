/**
 * Builds on a runner (runner/runner.py), which only calls the app: a job is handed out with the
 * runner's poll; the runner posts its log in batches, uploads the artifacts in chunks to
 * `/api/v1/runners/jobs/<id>/files/<path>` and ends with its exit code.
 */
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { runnerOnline, sendToRunner, unsend, type Runner } from './runners.ts';

export type { Runner };

/** No word from a runner about a running job for this long: it failed. */
const SILENT_MS = 60_000;
const CHUNK_MAX = 1024 * 1024;

interface Job {
	runnerId: string;
	runnerName: string;
	/** Where the artifacts are uploaded to. */
	dir: string;
	log: (line: string) => void;
	sent: boolean;
	contact: number;
	finish: (err: Error | null, exit?: number) => void;
}

// Survives Vite HMR in development.
const g = globalThis as unknown as { __espmRunnerJobs?: Map<string, Job> };
const jobs = (g.__espmRunnerJobs ??= new Map<string, Job>());

/** Runs `idf.py build` for `workspace` (kept on the runner, so rebuilds are incremental). */
export function runJob(
	r: Runner,
	job: { id: string; workspace: string; files: Record<string, string | Buffer>; dir: string },
	log: (line: string) => void,
	signal: AbortSignal
): Promise<number> {
	return new Promise((resolve, reject) => {
		if (signal.aborted) return reject(new Error('Cancelled.'));
		const watch = setInterval(() => {
			const j = jobs.get(job.id);
			if (!j) return;
			if (!j.sent && !runnerOnline(r.id)) finish(new Error(`Runner "${r.name}" went offline.`));
			else if (j.sent && Date.now() - j.contact > SILENT_MS)
				finish(new Error(`Runner "${r.name}" stopped reporting.`));
		}, 5000);
		// The runner learns about a cancel from its next log post (unknown job).
		const cancel = () => finish(new Error('Cancelled.'));
		const finish = (err: Error | null, exit?: number) => {
			if (jobs.get(job.id) !== entry) return;
			jobs.delete(job.id);
			clearInterval(watch);
			signal.removeEventListener('abort', cancel);
			unsend(r.id, (c) => c.type === 'build' && c.id === job.id);
			if (err) reject(err);
			else resolve(exit ?? 1);
		};
		const entry: Job = {
			runnerId: r.id,
			runnerName: r.name,
			dir: job.dir,
			log,
			sent: false,
			contact: Date.now(),
			finish
		};
		jobs.set(job.id, entry);
		signal.addEventListener('abort', cancel, { once: true });
		const files = Object.fromEntries(
			Object.entries(job.files).map(([name, content]) => [
				name,
				Buffer.from(content).toString('base64')
			])
		);
		sendToRunner(r.id, { type: 'build', id: job.id, workspace: job.workspace, files }, () => {
			entry.sent = true;
			entry.contact = Date.now();
		});
	});
}

/** Called with every poll: jobs handed out to the runner that it doesn't know any more failed. */
export function reconcileJobs(runnerId: string, running: string[]) {
	for (const [id, j] of jobs)
		if (j.runnerId === runnerId && j.sent && !running.includes(id))
			j.finish(new Error(`Runner "${j.runnerName}" lost the build (restarted?).`));
}

/** A job of this runner (a token only reaches its own runner's jobs). */
const jobOf = (runnerId: string, id: string) => {
	const j = jobs.get(id);
	return j?.runnerId === runnerId ? j : undefined;
};

/** Log lines of a job; false when it is unknown (cancelled or failed) – the runner stops it. */
export function jobLog(runnerId: string, id: string, lines: string[]): boolean {
	const j = jobOf(runnerId, id);
	if (!j) return false;
	j.contact = Date.now();
	for (const line of lines) j.log(line);
	return true;
}

/** A chunk of an artifact at `offset` (0 starts the file). */
export async function jobUpload(
	runnerId: string,
	id: string,
	file: string,
	offset: number,
	body: ReadableStream<Uint8Array> | null
): Promise<'ok' | 'unknown' | 'invalid'> {
	const j = jobOf(runnerId, id);
	if (!j) return 'unknown';
	const parts = file.split('/');
	if (!file || file.startsWith('/') || file.includes('\\') || parts.includes('..'))
		return 'invalid';
	const target = path.join(j.dir, ...parts);
	const size = offset
		? await fs.stat(target).then(
				(s) => s.size,
				() => -1
			)
		: 0;
	if (size !== offset) return 'invalid';
	j.contact = Date.now();
	await fs.mkdir(path.dirname(target), { recursive: true });
	let written = 0;
	const limit = new TransformStream<Uint8Array, Uint8Array>({
		transform(chunk, ctl) {
			written += chunk.length;
			if (written > CHUNK_MAX) ctl.error(new Error('Chunk too large'));
			else ctl.enqueue(chunk);
		}
	});
	const out = createWriteStream(target, { flags: offset ? 'a' : 'w' });
	if (body) await pipeline(Readable.fromWeb(body.pipeThrough(limit) as never), out);
	else await new Promise((resolve) => out.end(resolve));
	return 'ok';
}

/** The build ended with `exit`; the artifacts are uploaded. */
export function jobResult(runnerId: string, id: string, exit: number): boolean {
	const j = jobOf(runnerId, id);
	if (!j) return false;
	j.finish(null, exit);
	return true;
}

/** Drops a runner's workspace (with its next poll). */
export function dropWorkspace(r: Runner, name: string) {
	sendToRunner(r.id, { type: 'dropWorkspace', name });
}

/** Fails a runner's jobs (it was deleted). */
export function dropRunnerJobs(runnerId: string) {
	for (const j of jobs.values())
		if (j.runnerId === runnerId) j.finish(new Error(`Runner "${j.runnerName}" was deleted.`));
}
