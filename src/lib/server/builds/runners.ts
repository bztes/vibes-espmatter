/**
 * Build runners, added by an admin; each gets its own token. Runners only make outgoing calls
 * (they may sit behind NAT): a runner long-polls `POST /api/v1/runners`, which answers with its
 * next commands. It is online while those polls keep coming; liveness is only kept in memory.
 */
import { createHash, randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { runner } from '#lib/server/db/schema.ts';

/** No poll for this long: offline. */
const OFFLINE_MS = 30_000;
/** How long a poll waits for commands. */
const HOLD_MS = 20_000;

export type Runner = typeof runner.$inferSelect;
export type RunnerReport = { idfVersion: string; concurrency: number };

export type RunnerCommand =
	| { type: 'build'; id: string; workspace: string; files: Record<string, string> }
	| { type: 'dropWorkspace'; name: string };

interface Outbox {
	commands: { command: RunnerCommand; sent?: () => void }[];
	/** The poll that gets the commands; an older one of the same runner gives way. */
	current?: symbol;
	wake?: () => void;
}

// Survives Vite HMR in development.
const g = globalThis as unknown as {
	__espmRunnersSeen?: Map<string, number>;
	__espmRunnerOutbox?: Map<string, Outbox>;
	__espmRunnerEvents?: EventEmitter;
};
const seen = (g.__espmRunnersSeen ??= new Map<string, number>());
const outboxes = (g.__espmRunnerOutbox ??= new Map<string, Outbox>());

/** Emits `change` whenever a runner registers or changes, and `ready` when one may take builds. */
export const runnerEvents: EventEmitter = (g.__espmRunnerEvents ??=
	new EventEmitter().setMaxListeners(0));

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** A new runner token and the hash that is stored. */
export function newRunnerToken() {
	const token = `espr_${randomBytes(32).toString('base64url')}`;
	return { token, tokenHash: hashToken(token) };
}

/** Every runner call carries its token as Bearer token; answers the runner it belongs to. */
export async function requireRunner(request: Request): Promise<Runner> {
	const token = /^Bearer (\S+)$/.exec(request.headers.get('authorization') ?? '')?.[1];
	const r = token
		? await db.query.runner.findFirst({ where: eq(runner.tokenHash, hashToken(token)) })
		: undefined;
	if (!r) error(401, 'Unknown RUNNER_TOKEN');
	return r;
}

export function runnerOnline(id: string): boolean {
	const at = seen.get(id);
	return at !== undefined && Date.now() - at < OFFLINE_MS;
}

const outbox = (id: string): Outbox => {
	let o = outboxes.get(id);
	if (!o) outboxes.set(id, (o = { commands: [] }));
	return o;
};

/** Queues a command for the runner's next poll; `sent` runs once it is handed out. */
export function sendToRunner(id: string, command: RunnerCommand, sent?: () => void) {
	const o = outbox(id);
	o.commands.push({ command, sent });
	o.wake?.();
}

/** Takes back a command that wasn't handed out yet. */
export function unsend(id: string, match: (c: RunnerCommand) => boolean) {
	const o = outboxes.get(id);
	if (o) o.commands = o.commands.filter((c) => !match(c.command));
}

/** Stores what a polling runner reports and marks it online. */
export async function registerRunner(r: Runner, report: RunnerReport) {
	const lastSeen = new Date();
	await db
		.update(runner)
		.set({ ...report, lastSeen })
		.where(eq(runner.id, r.id));
	const was = runnerOnline(r.id);
	seen.set(r.id, lastSeen.getTime());
	if (!was || report.concurrency !== r.concurrency) {
		runnerEvents.emit('change');
		runnerEvents.emit('ready');
	}
}

/** A deleted runner: offline at once, its open poll answers empty. */
export function forgetRunner(id: string) {
	seen.delete(id);
	const o = outboxes.get(id);
	outboxes.delete(id);
	if (o) {
		o.current = undefined;
		o.wake?.();
	}
	runnerEvents.emit('change');
}

/** A runner's poll: waits up to HOLD_MS for commands. */
export async function pollRunner(id: string, signal: AbortSignal): Promise<RunnerCommand[]> {
	const o = outbox(id);
	const me = Symbol();
	o.current = me;
	o.wake?.();
	if (!o.commands.length)
		await new Promise<void>((resolve) => {
			const done = () => {
				clearTimeout(timer);
				signal.removeEventListener('abort', done);
				if (o.wake === done) o.wake = undefined;
				resolve();
			};
			const timer = setTimeout(done, HOLD_MS);
			signal.addEventListener('abort', done, { once: true });
			o.wake = done;
		});
	if (o.current !== me || signal.aborted) return [];
	seen.set(id, Date.now());
	const taken = o.commands.splice(0);
	for (const c of taken) c.sent?.();
	return taken.map((c) => c.command);
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
