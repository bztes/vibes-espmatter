/**
 * Firmware builds. Queued in the database, run on enabled runners (one build per concurrency slot),
 * each board slot of a firmware in turn (radios first). A build has nothing of a device: devices
 * get their settings in their own configuration partition. The log goes to `DATA_DIR/builds/<id>/build.log`
 * and – while running – to listeners (`buildState` live query).
 *
 * Workspaces are kept per firmware and slot (`DATA_DIR/workspaces`), so rebuilds are incremental.
 */
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createWriteStream, existsSync, type WriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { DATA_DIR } from '$app/env/private';
import { assemble } from '#lib/core/assemble.ts';
import { normalize } from '#lib/core/engine.ts';
import { generate, UI_FILE } from '#lib/core/generate.ts';
import { hasErrors, validate } from '#lib/core/validate.ts';
import { db } from '#lib/server/db/index.ts';
import { build, firmware, runner, type SlotArtifacts } from '#lib/server/db/schema.ts';
import { buildDeviceUi, uiSpec } from './device-ui.ts';
import { runIdf, type Runner } from './runner.ts';
import { runnerEvents, runnerPhase, syncRunners } from './runners.ts';
import { loadFirmware } from './sources.ts';

const LOG_TAIL = 400;

interface Live {
	lines: string[];
	emitter: EventEmitter;
	file: WriteStream;
	abort: AbortController;
}

interface State {
	started: boolean;
	running: Map<string, { runnerId: string; live: Live }>;
	pumping: boolean;
}

// Survives Vite HMR in development.
const g = globalThis as unknown as { __espmBuilder?: State };
const state: State = (g.__espmBuilder ??= { started: false, running: new Map(), pumping: false });
const changes = new EventEmitter();
changes.setMaxListeners(0);

export const buildsDir = () => path.resolve(DATA_DIR, 'builds');
export const artifactDir = (id: string) => path.join(buildsDir(), path.basename(id));
const workspaceDir = (firmwareId: string, slot: string) =>
	path.resolve(DATA_DIR, 'workspaces', `${path.basename(firmwareId)}-${path.basename(slot)}`);

export class BuildError extends Error {}

export async function startBuilder() {
	if (state.started) return;
	state.started = true;
	// Builds that were running when the server stopped won't finish.
	await db
		.update(build)
		.set({ status: 'failed', error: 'Interrupted: the server restarted.', finishedAt: new Date() })
		.where(eq(build.status, 'running'));
	// A runner that became ready may take queued builds.
	runnerEvents.on('ready', () => void pump());
	await syncRunners();
	void pump();
}

/** Builds running on a runner right now. */
export function runningOn(runnerId: string): number {
	return [...state.running.values()].filter((x) => x.runnerId === runnerId).length;
}

export async function enabledRunners() {
	return db.select().from(runner).where(eq(runner.enabled, true));
}

/** Queue a build of a firmware's saved configuration. */
export async function enqueueBuild(firmwareId: string, userId: string) {
	const [row] = await db.select().from(firmware).where(eq(firmware.id, firmwareId));
	if (!row) throw new BuildError('Firmware not found');
	const config = normalize(row.config);
	const issues = validate(config);
	if (hasErrors(issues))
		throw new BuildError(
			`Fix the configuration first: ${issues.find((i) => i.severity === 'error')!.message}`
		);
	if (!(await enabledRunners()).length)
		throw new BuildError(
			'No build runner is set up – an admin can add one under Admin → Build runners.'
		);
	const version = row.nextVersion;
	await db
		.update(firmware)
		.set({ nextVersion: version + 1, updatedAt: row.updatedAt })
		.where(eq(firmware.id, firmwareId));
	const [created] = await db
		.insert(build)
		.values({ firmwareId, userId, version, config })
		.returning({ id: build.id });
	void pump();
	return created.id;
}

export async function cancelBuild(id: string) {
	const running = state.running.get(id);
	if (running) {
		running.live.abort.abort();
		return;
	}
	await db
		.update(build)
		.set({ status: 'cancelled', finishedAt: new Date() })
		.where(and(eq(build.id, id), eq(build.status, 'queued')));
	notify(id);
}

function notify(id: string) {
	changes.emit(id);
}

/** Resolves on the next change of a build (or after `ms`). */
export function waitForChange(id: string, ms = 15000): Promise<void> {
	return new Promise((resolve) => {
		const done = () => {
			clearTimeout(timer);
			changes.off(id, done);
			resolve();
		};
		const timer = setTimeout(done, ms);
		changes.on(id, done);
	});
}

export async function logTail(id: string): Promise<string[]> {
	const live = state.running.get(id)?.live;
	if (live) return live.lines.slice(-LOG_TAIL);
	const text = await fs.readFile(path.join(artifactDir(id), 'build.log'), 'utf8').catch(() => '');
	return text.split('\n').filter(Boolean).slice(-LOG_TAIL);
}

export async function queuePosition(id: string): Promise<number | undefined> {
	const queued = await db
		.select({ id: build.id })
		.from(build)
		.where(eq(build.status, 'queued'))
		.orderBy(asc(build.createdAt));
	const i = queued.findIndex((b) => b.id === id);
	return i < 0 ? undefined : i + 1;
}

/** Start queued builds on free runners. */
async function pump() {
	if (state.pumping) return;
	state.pumping = true;
	try {
		for (;;) {
			const runners = await enabledRunners();
			const free = runners.find(
				(r) =>
					runnerPhase(r.id) === 'ready' && runningOn(r.id) < Math.max(1, r.config.concurrency || 1)
			);
			if (!free) return;
			const [next] = await db
				.select()
				.from(build)
				.where(eq(build.status, 'queued'))
				.orderBy(asc(build.createdAt))
				.limit(1);
			if (!next) return;
			await start(next, free);
		}
	} finally {
		state.pumping = false;
	}
}

async function start(row: typeof build.$inferSelect, r: Runner) {
	const dir = artifactDir(row.id);
	await fs.mkdir(dir, { recursive: true });
	const live: Live = {
		lines: [],
		emitter: new EventEmitter(),
		file: createWriteStream(path.join(dir, 'build.log')),
		abort: new AbortController()
	};
	state.running.set(row.id, { runnerId: r.id, live });
	runnerEvents.emit('change');
	await db
		.update(build)
		.set({ status: 'running', startedAt: new Date(), runnerId: r.id })
		.where(eq(build.id, row.id));
	notify(row.id);

	let pending = false;
	const log = (line: string) => {
		live.lines.push(line);
		if (live.lines.length > LOG_TAIL * 2) live.lines.splice(0, LOG_TAIL);
		live.file.write(line + '\n');
		if (!pending) {
			pending = true;
			setTimeout(() => ((pending = false), notify(row.id)), 250);
		}
	};

	void run(row, r, log, live.abort.signal)
		.then(async (slots) => {
			await db
				.update(build)
				.set({ status: 'success', slots, step: null, finishedAt: new Date() })
				.where(eq(build.id, row.id));
			log('✔ Build finished.');
		})
		.catch(async (err: unknown) => {
			const cancelled = live.abort.signal.aborted;
			const message = cancelled ? 'Cancelled.' : err instanceof Error ? err.message : String(err);
			log(`✘ ${message}`);
			await db
				.update(build)
				.set({
					status: cancelled ? 'cancelled' : 'failed',
					error: message,
					step: null,
					finishedAt: new Date()
				})
				.where(eq(build.id, row.id));
		})
		.finally(() => {
			live.file.end();
			state.running.delete(row.id);
			notify(row.id);
			runnerEvents.emit('change');
			void pump();
		});
}

interface FlasherArgs {
	flash_settings: { flash_mode: string; flash_size: string; flash_freq: string };
	flash_files: Record<string, string>;
	app: { offset: string; file: string };
	extra_esptool_args: { chip: string };
}

async function run(
	row: typeof build.$inferSelect,
	r: Runner,
	log: (line: string) => void,
	signal: AbortSignal
): Promise<Record<string, SlotArtifacts>> {
	const [fw] = await db.select().from(firmware).where(eq(firmware.id, row.firmwareId));
	if (!fw) throw new Error('The firmware was deleted.');
	const a = assemble(normalize(row.config), { version: row.version, buildId: row.id });
	const read = await loadFirmware(a.firmware.flatMap((f) => f.sources));
	const projects = generate(a, read, row.version).sort(
		(x, y) => Number(y.flashFirst) - Number(x.flashFirst)
	);
	log(
		`Building "${fw.name}" version ${row.version} on runner "${r.name}" (${projects.length} board${projects.length > 1 ? 's' : ''})`
	);

	const out: Record<string, SlotArtifacts> = {};
	for (const project of projects) {
		if (signal.aborted) throw new Error('Cancelled.');
		await db.update(build).set({ step: project.slot }).where(eq(build.id, row.id));
		log(`── ${project.name}: ${project.board} (${project.target}) ──`);
		const ws = workspaceDir(fw.id, project.slot);
		await writeWorkspace(ws, project.files, log);
		if (project.needsUi) {
			const ui = await buildDeviceUi(uiSpec(a), path.resolve(DATA_DIR, 'cache', 'device-ui'), log);
			await writeIfChanged(path.join(ws, 'main', UI_FILE), ui);
		}
		const code = await runIdf(r, ws, ['build'], log, signal);
		if (signal.aborted) throw new Error('Cancelled.');
		if (code !== 0) throw new Error(`${project.name}: idf.py build failed (exit code ${code}).`);
		out[project.slot] = await collect(ws, artifactDir(row.id), project, log);
	}
	return out;
}

async function writeIfChanged(file: string, content: Buffer | string) {
	const data = typeof content === 'string' ? Buffer.from(content) : content;
	const current = await fs.readFile(file).catch(() => null);
	if (current?.equals(data)) return;
	await fs.mkdir(path.dirname(file), { recursive: true });
	await fs.writeFile(file, data);
}

/** Only changed files are written, so ninja rebuilds incrementally; stale sources are removed. */
async function writeWorkspace(ws: string, files: Record<string, string>, log: (l: string) => void) {
	const fresh = !existsSync(ws);
	log(
		fresh
			? 'New workspace – the first build downloads esp-matter and takes a while.'
			: 'Reusing workspace.'
	);
	for (const [name, content] of Object.entries(files)) {
		const target = path.join(ws, name);
		if (!target.startsWith(ws + path.sep)) throw new Error(`Invalid file name ${name}`);
		await writeIfChanged(target, content);
	}
	// sdkconfig is derived from sdkconfig.defaults: regenerate when those change.
	const defaultsChanged = await fs
		.stat(path.join(ws, 'sdkconfig'))
		.then(async (s) => (await fs.stat(path.join(ws, 'sdkconfig.defaults'))).mtimeMs > s.mtimeMs)
		.catch(() => false);
	if (defaultsChanged) await fs.rm(path.join(ws, 'sdkconfig'));
	for (const entry of await fs.readdir(path.join(ws, 'main'))) {
		if (entry === UI_FILE) continue;
		if (!(`main/${entry}` in files)) await fs.rm(path.join(ws, 'main', entry), { recursive: true });
	}
}

async function collect(
	ws: string,
	dest: string,
	project: {
		slot: string;
		name: string;
		board: string;
		target: string;
		flashFirst: boolean;
		configPartition?: { offset: number; size: number };
		wired: boolean;
	},
	log: (l: string) => void
): Promise<SlotArtifacts> {
	const buildDir = path.join(ws, 'build');
	const args = JSON.parse(
		await fs.readFile(path.join(buildDir, 'flasher_args.json'), 'utf8')
	) as FlasherArgs;
	const slotDir = path.join(dest, project.slot);
	await fs.mkdir(slotDir, { recursive: true });
	const parts = [];
	let end = 0;
	const chunks: { offset: number; data: Buffer }[] = [];
	for (const [offsetHex, file] of Object.entries(args.flash_files)) {
		const data = await fs.readFile(path.join(buildDir, file));
		const name = path.basename(file);
		const offset = parseInt(offsetHex, 16);
		await fs.writeFile(path.join(slotDir, name), data);
		parts.push({ file: name, offset, size: data.length });
		chunks.push({ offset, data });
		end = Math.max(end, offset + data.length);
	}
	// One image for "flash at 0x0" tools.
	const merged = Buffer.alloc(end, 0xff);
	for (const c of chunks) c.data.copy(merged, c.offset);
	await fs.writeFile(path.join(slotDir, 'merged.bin'), merged);
	const appFile = path.basename(args.app.file);
	const app = await fs.readFile(path.join(buildDir, args.app.file));
	await fs.copyFile(path.join(buildDir, args.app.file), path.join(slotDir, 'app.bin'));
	log(`${project.name}: app ${(app.length / 1024).toFixed(0)} KB (${appFile})`);
	return {
		name: project.name,
		board: project.board,
		chip: args.extra_esptool_args.chip,
		flashFirst: project.flashFirst,
		viaMain: project.wired,
		flashMode: args.flash_settings.flash_mode,
		flashFreq: args.flash_settings.flash_freq,
		flashSize: args.flash_settings.flash_size,
		parts,
		app: 'app.bin',
		appSize: app.length,
		merged: 'merged.bin',
		sha256: createHash('sha256').update(app).digest('hex'),
		config: project.configPartition
	};
}

export async function getBuild(id: string) {
	const [row] = await db.select().from(build).where(eq(build.id, id));
	return row;
}

/** Artifacts and workspaces of firmwares about to be deleted. */
export async function deleteBuildsOf(firmwareIds: string[]) {
	const rows = await db
		.select({ id: build.id })
		.from(build)
		.where(inArray(build.firmwareId, firmwareIds));
	for (const r of rows) await fs.rm(artifactDir(r.id), { recursive: true, force: true });
	for (const id of firmwareIds)
		for (const slot of ['main', 'radio'])
			await fs.rm(workspaceDir(id, slot), { recursive: true, force: true });
}
