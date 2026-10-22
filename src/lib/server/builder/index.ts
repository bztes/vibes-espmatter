/**
 * Firmware build runner.
 *
 * Builds are queued here and run one at a time on this server (ESP-IDF at `IDF_PATH`). Each role
 * (chip) of a project is compiled in a workspace directory that is reused for configs with the
 * same sdkconfig/dependencies, so changing e.g. the Wi-Fi password only recompiles a few files.
 */
import { EventEmitter } from 'node:events';
import { createWriteStream, existsSync, type WriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { DATA_DIR, IDF_PATH, IDF_PYTHON, MAX_WORKSPACES } from '$app/env/private';
import { errorMessage } from '#lib/errors.ts';
import { db } from '#lib/server/db/index.ts';
import { build } from '#lib/server/db/schema.ts';
import type { RoleArtifacts, RoleBuildState } from '#lib/build-types.ts';
import {
	generateRole,
	chipBoard,
	normalizeProject,
	generatedHash,
	projectRoles,
	validateProject
} from '#lib/device/generator.ts';
import type { GeneratedProject, ProjectConfig } from '#lib/device/types.ts';
import { buildDeviceUi, DEVICE_UI_SOURCES_HASH } from '#lib/server/device-ui/index.ts';
import { hash, stableStringify } from '#lib/device/util.ts';
import { runJob, type BuildJob, type BuildOutput, type JobResult } from './idf.ts';

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
	initialized: boolean;
	queue: string[];
	running: Set<string>;
	live: Map<string, LiveBuild>;
}

// Survive Vite HMR in development.
const state: BuilderState = ((globalThis as Record<string, unknown>).__mespBuilder ??= {
	initialized: false,
	queue: [],
	running: new Set(),
	live: new Map()
}) as BuilderState;

const dataDir = () => path.resolve(DATA_DIR);
export const artifactDir = (buildId: string, role?: string) =>
	path.join(dataDir(), 'builds', buildId, ...(role ? [role] : []));

async function init() {
	if (state.initialized) return;
	state.initialized = true;
	// Builds that were running when the server stopped can't be resumed.
	await db
		.update(build)
		.set({ status: 'failed', error: 'Server restarted during the build', finishedAt: new Date() })
		.where(inArray(build.status, ['queued', 'running']));
}

// ---------------------------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------------------------

export class ConfigError extends Error {
	constructor(public issues: string[]) {
		super(issues.join('\n'));
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

function kick() {
	while (state.queue.length && state.running.size === 0) {
		const id = state.queue.shift()!;
		state.running.add(id);
		void run(id);
	}
}

async function run(id: string) {
	try {
		await runBuild(id);
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

async function runBuild(id: string) {
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
				workspace: workspaceName(generated),
				files: generated.files,
				binaries
			},
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
				error: `idf.py exited with code ${code}`,
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
// Workspaces and artifacts
// ---------------------------------------------------------------------------------------------

/** Files whose change invalidates most of the build → they decide which workspace is used. */
const WORKSPACE_KEY_FILES = ['sdkconfig.defaults', 'main/idf_component.yml', 'partitions.csv'];

function workspaceName(gen: GeneratedProject): string {
	const key = hash(stableStringify(WORKSPACE_KEY_FILES.map((f) => gen.files[f] ?? '')));
	return `${gen.role.id}-${gen.target}-${key}`;
}

/** Compiles one chip with ESP-IDF on this server. `cancel()` stops idf.py. */
function dispatch(
	job: BuildJob,
	log: (line: string) => void
): { result: Promise<JobResult>; cancel: () => void } {
	if (!IDF_PATH) {
		log(
			'ERROR: IDF_PATH is not set. Install ESP-IDF and set IDF_PATH, or run the app in Docker (see README).'
		);
		return { result: Promise.resolve({ code: 1 }), cancel: () => {} };
	}
	const abort = new AbortController();
	const opts = {
		idfPath: IDF_PATH,
		idfPython: IDF_PYTHON,
		root: path.join(dataDir(), 'workspaces'),
		maxWorkspaces: MAX_WORKSPACES
	};
	const result = runJob(job, opts, log, abort.signal).catch((err: unknown) => {
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
