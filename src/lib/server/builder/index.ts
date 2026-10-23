/**
 * Firmware build runner.
 *
 * Builds are queued here and each runs on a free build worker (set up by an admin in /admin), one
 * build per worker at a time. Each role (chip) of a project is a job: its generated files go to the
 * worker and the firmware images come back; how (and where the worker keeps its files) is up to
 * the worker kind, see `idf.ts`.
 */
import { EventEmitter } from 'node:events';
import { createWriteStream, existsSync, type WriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { DATA_DIR } from '$app/env/private';
import { errorMessage } from '#lib/errors.ts';
import { db } from '#lib/server/db/index.ts';
import { build, worker as workerTable, type Worker } from '#lib/server/db/schema.ts';
import type { RoleArtifacts, RoleBuildState } from '#lib/build-types.ts';
import {
	generateRole,
	chipBoard,
	normalizeProject,
	generatedHash,
	projectRoles,
	validateProject
} from '#lib/device/generator.ts';
import type { ProjectConfig } from '#lib/device/types.ts';
import { buildDeviceUi, DEVICE_UI_SOURCES_HASH } from '#lib/server/device-ui/index.ts';
import { hash } from '#lib/device/util.ts';
import {
	removeUnknownWorkers,
	removeWorker,
	runJob,
	testWorker as runWorkerTest,
	type BuildJob,
	type BuildOutput,
	type JobResult
} from './idf.ts';

const LOG_TAIL = 300;

interface LiveBuild {
	lines: string[];
	emitter: EventEmitter;
	file?: WriteStream;
	/** Stops the chip that is compiling right now. */
	cancelJob?: () => void;
	cancelled?: boolean;
}

interface BuilderState {
	ready?: Promise<void>;
	queue: string[];
	/** Running builds → id of the worker they run on. */
	running: Map<string, string>;
	workers: Worker[];
	live: Map<string, LiveBuild>;
}

// Survive Vite HMR in development.
const state: BuilderState = ((globalThis as Record<string, unknown>).__mespBuilder ??= {
	queue: [],
	running: new Map(),
	workers: [],
	live: new Map()
}) as BuilderState;

const dataDir = () => path.resolve(DATA_DIR);
export const artifactDir = (buildId: string, role?: string) =>
	path.join(dataDir(), 'builds', buildId, ...(role ? [role] : []));

function init() {
	return (state.ready ??= setUp());
}

async function setUp() {
	// Builds that were running when the server stopped can't be resumed.
	await db
		.update(build)
		.set({ status: 'failed', error: 'Server restarted during the build', finishedAt: new Date() })
		.where(inArray(build.status, ['queued', 'running']));
	await reloadWorkers();
	// Can take a while (whole workspaces): nothing needs to wait for it.
	void removeUnknownWorkers(state.workers.map((w) => w.id)).catch((err) =>
		console.error('removing old workspaces failed', err)
	);
}

// ---------------------------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------------------------

export class ConfigError extends Error {
	constructor(public issues: string[]) {
		super(issues.join('\n'));
	}
}

export class NoWorkerError extends Error {
	constructor() {
		super('No build worker is enabled. An admin can set one up under Admin (/admin).');
	}
}

export async function enqueueBuild(
	input: ProjectConfig,
	owner: { userId?: string | null; projectId?: string | null }
): Promise<string> {
	await init();
	const config = normalizeProject(input);
	const issues = validateProject(config);
	if (issues.length) throw new ConfigError(issues.map((i) => i.message));

	// Covers the generated firmware and the device UI sources too: a changed firmware source must
	// rebuild even when the config is the same.
	const configHash = hash(`${generatedHash(config)}:${DEVICE_UI_SOURCES_HASH}`);

	// Reuse an identical pending/running build, or a successful one whose files still exist.
	const existing = await db
		.select()
		.from(build)
		.where(
			and(eq(build.configHash, configHash), inArray(build.status, ['queued', 'running', 'success']))
		)
		.orderBy(desc(build.createdAt))
		.limit(1);
	if (
		existing[0] &&
		(existing[0].status !== 'success' || existsSync(artifactDir(existing[0].id)))
	) {
		return existing[0].id;
	}
	if (!(await hasEnabledWorker())) throw new NoWorkerError();

	const roles: Record<string, RoleBuildState> = {};
	for (const chip of config.chips) {
		const board = chipBoard(chip);
		roles[chip.id] = { status: 'queued', target: board.chip, board: board.id };
	}
	const [row] = await db
		.insert(build)
		.values({
			userId: owner.userId ?? null,
			projectId: owner.projectId ?? null,
			configHash,
			config,
			roles
		})
		.returning({ id: build.id });

	state.queue.push(row.id);
	kick();
	return row.id;
}

export async function cancelBuild(id: string) {
	const live = state.live.get(id);
	if (state.running.has(id) && live) {
		live.cancelled = true;
		live.cancelJob?.();
		return;
	}
	const idx = state.queue.indexOf(id);
	if (idx >= 0) state.queue.splice(idx, 1);
	await db
		.update(build)
		.set({ status: 'cancelled', finishedAt: new Date() })
		.where(and(eq(build.id, id), inArray(build.status, ['queued', 'running'])));
	state.live.get(id)?.emitter.emit('change');
}

export async function getBuild(id: string) {
	const [row] = await db.select().from(build).where(eq(build.id, id));
	return row;
}

/** Last log lines of a build (from memory while running, from disk afterwards). */
export async function logTail(id: string, lines = LOG_TAIL): Promise<string[]> {
	const live = state.live.get(id);
	if (live) return live.lines.slice(-lines);
	try {
		const text = await fs.readFile(path.join(artifactDir(id), 'build.log'), 'utf8');
		return text.split('\n').slice(-lines - 1, -1);
	} catch {
		return [];
	}
}

export function queuePosition(id: string): number {
	return state.queue.indexOf(id);
}

// ---------------------------------------------------------------------------------------------
// Workers
// ---------------------------------------------------------------------------------------------

/** The workers, with the build each one is running. */
export async function listWorkers(): Promise<(Worker & { buildId: string | null })[]> {
	await init();
	const busy = new Map([...state.running].map(([buildId, workerId]) => [workerId, buildId]));
	return state.workers.map((w) => ({ ...w, buildId: busy.get(w.id) ?? null }));
}

/** Whether builds can run: at least one worker is enabled. */
export async function hasEnabledWorker(): Promise<boolean> {
	await init();
	return state.workers.some((w) => w.enabled);
}

async function reloadWorkers() {
	state.workers = (await db.select().from(workerTable).orderBy(workerTable.createdAt)) as Worker[];
	kick();
}

/** Adds a worker (without `id`) or replaces one; `false` if there is no worker `id`. */
export async function saveWorker({
	id,
	...values
}: Omit<typeof workerTable.$inferInsert, 'id' | 'kind' | 'config'> &
	Pick<Worker, 'kind' | 'config'> & { id?: string }): Promise<boolean> {
	await init();
	if (id) {
		const updated = await db
			.update(workerTable)
			.set(values)
			.where(eq(workerTable.id, id))
			.returning({ id: workerTable.id });
		if (!updated.length) return false;
	} else {
		await db.insert(workerTable).values(values);
	}
	await reloadWorkers();
	return true;
}

export async function deleteWorker(id: string) {
	await init();
	if ([...state.running.values()].includes(id)) {
		throw new Error('The worker is running a build: disable it and delete it once it finished.');
	}
	await db.delete(workerTable).where(eq(workerTable.id, id));
	await reloadWorkers();
	// Can take a while (whole workspaces): the worker is gone already.
	void removeWorker(id).catch((err) => console.error('removing worker files failed', err));
}

/** Checks that a worker is reachable and works: its output, and whether it succeeded. */
export async function testWorker(id: string): Promise<{ ok: boolean; log: string[] } | undefined> {
	await init();
	const worker = state.workers.find((w) => w.id === id);
	if (!worker) return undefined;
	const log: string[] = [];
	const code = await runWorkerTest(worker, (l) => log.push(l), AbortSignal.timeout(60_000));
	return { ok: code === 0, log };
}

/** Resolves on the next state/log change of a build (or after `timeoutMs`). */
export function waitForChange(id: string, timeoutMs = 15000): Promise<void> {
	return new Promise((resolve) => {
		const live = state.live.get(id) ?? createLive(id);
		const done = () => {
			clearTimeout(timer);
			live.emitter.off('change', done);
			resolve();
		};
		const timer = setTimeout(done, timeoutMs);
		live.emitter.on('change', done);
	});
}

// ---------------------------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------------------------

function createLive(id: string): LiveBuild {
	const live: LiveBuild = { lines: [], emitter: new EventEmitter() };
	live.emitter.setMaxListeners(100);
	state.live.set(id, live);
	return live;
}

/** Starts queued builds on the free workers. */
function kick() {
	const enabled = state.workers.filter((w) => w.enabled);
	// Without any worker, queued builds fail with a message instead of waiting forever.
	if (!enabled.length) return void failQueued(new NoWorkerError().message);
	const busy = new Set(state.running.values());
	while (state.queue.length) {
		const worker = enabled.find((w) => !busy.has(w.id));
		if (!worker) return;
		const id = state.queue.shift()!;
		state.running.set(id, worker.id);
		busy.add(worker.id);
		void run(id, worker);
	}
}

async function failQueued(error: string) {
	const ids = state.queue.splice(0);
	if (!ids.length) return;
	await db
		.update(build)
		.set({ status: 'failed', error, finishedAt: new Date() })
		.where(and(inArray(build.id, ids), eq(build.status, 'queued')));
	for (const id of ids) state.live.get(id)?.emitter.emit('change');
}

async function run(id: string, worker: Worker) {
	try {
		await runBuild(id, worker);
	} catch (err) {
		console.error('build crashed', err);
		await db
			.update(build)
			.set({ status: 'failed', error: String(err), finishedAt: new Date() })
			.where(eq(build.id, id));
	} finally {
		const live = state.live.get(id);
		live?.file?.end();
		live?.emitter.emit('change');
		state.running.delete(id);
		// Keep the in-memory log for a moment so live subscribers get the final lines.
		setTimeout(() => {
			if (!state.running.has(id)) state.live.delete(id);
		}, 60_000);
		kick();
	}
}

async function runBuild(id: string, worker: Worker) {
	const row = await getBuild(id);
	if (!row || row.status !== 'queued') return;
	const live = state.live.get(id) ?? createLive(id);
	await fs.mkdir(artifactDir(id), { recursive: true });
	live.file = createWriteStream(path.join(artifactDir(id), 'build.log'));

	const log = (line: string) => {
		live.lines.push(line);
		if (live.lines.length > 2000) live.lines.splice(0, live.lines.length - 2000);
		live.file?.write(line + '\n');
		live.emitter.emit('change');
	};

	const roles = { ...row.roles };
	const save = async (patch: Partial<typeof build.$inferInsert> = {}) => {
		await db
			.update(build)
			.set({ roles: { ...roles }, ...patch })
			.where(eq(build.id, id));
		live.emitter.emit('change');
	};

	await save({ status: 'running', startedAt: new Date() });
	log(`Build worker: ${worker.name}`);
	const config = normalizeProject(row.config);
	const order = projectRoles(config);
	const cancelQueued = () => {
		for (const r of order) if (roles[r.id].status === 'queued') roles[r.id].status = 'cancelled';
	};

	for (const role of order) {
		const started = Date.now();
		const update = (patch: Partial<RoleBuildState>) =>
			(roles[role.id] = { ...roles[role.id], ...patch });
		update({ status: 'running' });
		await save();
		log(`\n━━━ ${config.name} · ${role.name} (${roles[role.id].target}) ━━━`);

		const generated = generateRole(config, role.id);
		const binaries: Record<string, Buffer> = {};
		for (const spec of generated.ui) {
			binaries[`main/${spec.page}.html.gz`] = await buildDeviceUi(
				spec,
				path.join(dataDir(), 'device-ui'),
				log
			);
		}
		const job = dispatch(
			{
				id: `${id}-${role.id}`,
				name: `${generated.role.id}-${generated.target}`,
				files: generated.files,
				binaries
			},
			worker,
			log
		);
		live.cancelJob = job.cancel;
		const { code, output } = await job.result;
		live.cancelJob = undefined;

		if (live.cancelled) {
			update({ status: 'cancelled' });
			cancelQueued();
			await save({ status: 'cancelled', finishedAt: new Date() });
			log('Build cancelled.');
			return;
		}
		if (code !== 0 || !output) {
			update({
				status: 'failed',
				error: `The build exited with code ${code}`,
				durationMs: Date.now() - started
			});
			cancelQueued();
			await save({
				status: 'failed',
				error: `${role.name} firmware failed to build`,
				finishedAt: new Date()
			});
			return;
		}

		const artifacts = await saveArtifacts(output, id, role.id);
		update({ status: 'success', artifacts, durationMs: Date.now() - started });
		log(`✔ ${role.name} built in ${Math.round((Date.now() - started) / 1000)} s`);
		await save();
	}
	await save({ status: 'success', finishedAt: new Date() });
}

// ---------------------------------------------------------------------------------------------
// Jobs and artifacts
// ---------------------------------------------------------------------------------------------

/** Compiles one chip on a worker. `cancel()` stops it. */
function dispatch(
	job: BuildJob,
	worker: Worker,
	log: (line: string) => void
): { result: Promise<JobResult>; cancel: () => void } {
	const abort = new AbortController();
	const result = runJob(job, worker, log, abort.signal).catch((err: unknown) => {
		log(`ERROR: ${errorMessage(err)}`);
		return { code: 1 };
	});
	return { result, cancel: () => abort.abort() };
}

const SAFE_NAME = /^[\w-][\w.-]*$/;

async function saveArtifacts(
	out: BuildOutput,
	buildId: string,
	roleId: string
): Promise<RoleArtifacts> {
	const outDir = artifactDir(buildId, roleId);
	await fs.mkdir(outDir, { recursive: true });

	const parts = [];
	const images: { offset: number; data: Buffer }[] = [];
	for (const part of out.parts) {
		// Only plain file names inside the artifact directory.
		if (!SAFE_NAME.test(part.file) || part.file === 'merged.bin')
			throw new Error(`Unexpected firmware file name: ${part.file}`);
		const { data } = part;
		await fs.writeFile(path.join(outDir, part.file), data);
		parts.push({ file: part.file, offset: part.offset, size: data.length });
		images.push({ offset: part.offset, data });
	}
	parts.sort((a, b) => a.offset - b.offset);

	// A single image (0xFF padded) for tools that only take one file.
	const end = Math.max(...images.map((i) => i.offset + i.data.length));
	const merged = Buffer.alloc(end, 0xff);
	for (const img of images) img.data.copy(merged, img.offset);
	await fs.writeFile(path.join(outDir, 'merged.bin'), merged);

	return {
		chip: out.chip,
		flashMode: out.flashMode,
		flashFreq: out.flashFreq,
		flashSize: out.flashSize,
		psram: out.psram,
		parts,
		app: out.app,
		merged: 'merged.bin'
	};
}
