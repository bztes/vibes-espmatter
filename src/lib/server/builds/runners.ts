/**
 * Runtime state of the build runners (nothing of it is stored). Every enabled runner is checked
 * when the server starts and whenever its setup changes: `docker pull` (Docker) and
 * `idf.py --version`. Until the check passed, the runner is `starting` and gets no builds.
 * The check output is kept in memory for the runner's log.
 */
import { EventEmitter } from 'node:events';
import os from 'node:os';
import { db } from '#lib/server/db/index.ts';
import { runner } from '#lib/server/db/schema.ts';
import { DEFAULT_IMAGE, runIdf, spawnLogged, type Runner } from './runner.ts';

export type RunnerPhase = 'starting' | 'error' | 'ready';

interface Check {
	phase: RunnerPhase;
	/** Kind + image/path the check ran for; a change starts a new check. */
	key: string;
	lines: string[];
	abort: AbortController;
}

const LOG_TAIL = 400;
const CHECK_TIMEOUT = 30 * 60_000;

// Survives Vite HMR in development.
const g = globalThis as unknown as {
	__espmRunners?: Map<string, Check>;
	__espmRunnerEvents?: EventEmitter;
};
const checks: Map<string, Check> = (g.__espmRunners ??= new Map());

/** Emits `change` whenever a runner's phase, log or load changes, and `ready` when a check passed. */
export const runnerEvents: EventEmitter = (g.__espmRunnerEvents ??=
	new EventEmitter().setMaxListeners(0));

const keyOf = (r: Runner) =>
	JSON.stringify([
		r.kind,
		r.kind === 'docker' ? r.config.image || DEFAULT_IMAGE : r.config.idfPath
	]);

export function runnerPhase(id: string): RunnerPhase | undefined {
	return checks.get(id)?.phase;
}

export function runnerLog(id: string): string[] {
	return checks.get(id)?.lines.slice(-LOG_TAIL) ?? [];
}

/** Resolves on the next runner change (or after `ms`). */
export function waitForRunners(ms = 15000): Promise<void> {
	return new Promise((resolve) => {
		const done = () => {
			clearTimeout(timer);
			runnerEvents.off('change', done);
			resolve();
		};
		const timer = setTimeout(done, ms);
		runnerEvents.on('change', done);
	});
}

/** Brings the checks in line with the runners in the database (start new, drop removed). */
export async function syncRunners() {
	const rows = await db.select().from(runner);
	const wanted = new Map(rows.filter((r) => r.enabled).map((r) => [r.id, r]));
	for (const [id, c] of checks)
		if (wanted.get(id) === undefined || keyOf(wanted.get(id)!) !== c.key) {
			c.abort.abort();
			checks.delete(id);
		}
	for (const r of wanted.values()) if (!checks.has(r.id)) check(r);
	runnerEvents.emit('change');
}

function check(r: Runner) {
	const c: Check = { phase: 'starting', key: keyOf(r), lines: [], abort: new AbortController() };
	checks.set(r.id, c);
	const signal = AbortSignal.any([c.abort.signal, AbortSignal.timeout(CHECK_TIMEOUT)]);
	let pending = false;
	const log = (line: string) => {
		console.log(`[runner ${r.name}] ${line}`);
		c.lines.push(line);
		if (c.lines.length > LOG_TAIL * 2) c.lines.splice(0, LOG_TAIL);
		if (!pending) {
			pending = true;
			setTimeout(() => ((pending = false), runnerEvents.emit('change')), 250);
		}
	};
	const run = async () => {
		if (r.kind === 'docker') {
			const image = r.config.image || DEFAULT_IMAGE;
			log(`$ docker pull ${image}`);
			const pulled = await spawnLogged('docker', ['pull', image], os.tmpdir(), log, signal);
			if (pulled !== 0) return pulled;
		}
		return runIdf(r, os.tmpdir(), ['--version'], log, signal);
	};
	void run().then((code) => {
		if (checks.get(r.id) !== c) return; // replaced or removed meanwhile
		c.phase = code === 0 ? 'ready' : 'error';
		log(code === 0 ? '✔ Runner is ready.' : `✘ Check failed (exit code ${code}).`);
		runnerEvents.emit('change');
		if (code === 0) runnerEvents.emit('ready');
	});
}
