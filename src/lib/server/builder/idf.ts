/**
 * Compiles one chip's firmware with ESP-IDF in a workspace directory, on a build worker of any kind
 * (`idf-local-worker.ts`, `idf-docker-worker.ts`).
 *
 * The builder only hands over a job's files and gets the firmware images back, both in memory:
 * where the workspaces live and how files get there (e.g. copied to another machine) is up to the
 * worker kind.
 */
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR } from '$app/env/private';
import { hash, stableStringify } from '#lib/device/util.ts';
import type { Worker } from '#lib/server/db/schema.ts';
import { runIdfDocker } from './idf-docker-worker.ts';
import { runIdfLocal } from './idf-local-worker.ts';

/** One chip's firmware to compile. */
export interface BuildJob {
	id: string;
	/** Readable name (e.g. role and chip), the start of its workspace directory name. */
	name: string;
	/** Generated sources, UTF-8. */
	files: Record<string, string>;
	/** Generated binary files (device UI, embedded firmware). */
	binaries: Record<string, Buffer>;
}

export interface BuildOutput {
	chip: string;
	flashMode: string;
	flashFreq: string;
	flashSize: string;
	psram: 'none' | 'quad' | 'octal';
	/** File name of the application image (one of `parts`). */
	app: string;
	/** Images to flash. */
	parts: { file: string; offset: number; data: Buffer }[];
}

export interface JobResult {
	/** Exit code of the build (0: success). */
	code: number;
	output?: BuildOutput;
}

/** Compiles `job` on `worker`. */
export async function runJob(
	job: BuildJob,
	worker: Worker,
	log: (line: string) => void,
	signal: AbortSignal
): Promise<JobResult> {
	const ws = await prepareWorkspace(job, workerDir(worker.id), worker.config.maxWorkspaces, log);
	const code = await runIdf(ws, ['build'], worker, log, signal);
	if (code !== 0 || signal.aborted) return { code: code || 1 };
	return { code, output: await readOutput(ws) };
}

/** Runs `idf.py --version`: whether the worker is reachable and its ESP-IDF works. */
export async function testWorker(
	worker: Worker,
	log: (line: string) => void,
	signal: AbortSignal
): Promise<number> {
	const dir = workerDir(worker.id);
	await fs.mkdir(dir, { recursive: true });
	return runIdf(dir, ['--version'], worker, log, signal);
}

/** Frees what a deleted worker left behind. */
export async function removeWorker(id: string) {
	await fs.rm(workerDir(id), { recursive: true, force: true });
}

/** Frees what workers that no longer exist left behind (e.g. deleted while the server was down). */
export async function removeUnknownWorkers(known: string[]) {
	// Also removes the layout before workers: one directory per workspace.
	for (const entry of await fs.readdir(workspacesDir()).catch(() => [])) {
		if (known.includes(entry)) continue;
		await fs
			.rm(path.join(workspacesDir(), entry), { recursive: true, force: true })
			.catch((err: unknown) => console.warn(`Can't remove workspace ${entry}:`, err));
	}
}

// ---------------------------------------------------------------------------------------------
// Workspaces
// ---------------------------------------------------------------------------------------------

/** Both worker kinds see DATA_DIR: the `idf` compose service through the shared volume. */
const workspacesDir = () => path.join(path.resolve(DATA_DIR), 'workspaces');
const workerDir = (id: string) => path.join(workspacesDir(), path.basename(id));

/** Files whose change invalidates most of the build → they decide which workspace is used. */
const WORKSPACE_KEY_FILES = ['sdkconfig.defaults', 'main/idf_component.yml', 'partitions.csv'];

/** Workspace directory name: jobs with the same one rebuild incrementally. */
function workspaceName(job: BuildJob): string {
	const key = hash(stableStringify(WORKSPACE_KEY_FILES.map((f) => job.files[f] ?? '')));
	return path.basename(`${job.name}-${key}`);
}

async function prepareWorkspace(
	job: BuildJob,
	root: string,
	maxWorkspaces: number,
	log: (l: string) => void
): Promise<string> {
	const name = workspaceName(job);
	const dir = path.join(root, name);
	const fresh = !existsSync(dir);
	await fs.mkdir(path.join(dir, 'main'), { recursive: true });
	log(
		fresh ? `Creating workspace ${name} (first build takes a while)` : `Reusing workspace ${name}`
	);

	// Write only changed files so ninja can do an incremental build.
	const files: Record<string, Buffer> = { ...job.binaries };
	for (const [file, content] of Object.entries(job.files)) files[file] = Buffer.from(content);
	for (const [file, content] of Object.entries(files)) {
		const target = path.join(dir, file);
		if (!target.startsWith(dir + path.sep)) throw new Error(`Invalid file path: ${file}`);
		const current = await fs.readFile(target).catch(() => null);
		if (!current?.equals(content)) {
			await fs.mkdir(path.dirname(target), { recursive: true });
			await fs.writeFile(target, content);
		}
	}
	// Remove sources of features that are no longer part of the project.
	for (const entry of await fs.readdir(path.join(dir, 'main'))) {
		if (!(`main/${entry}` in files))
			await fs.rm(path.join(dir, 'main', entry), { recursive: true });
	}
	const now = new Date();
	await fs.utimes(dir, now, now);
	await pruneWorkspaces(root, dir, maxWorkspaces);
	return dir;
}

async function pruneWorkspaces(root: string, keep: string, max: number) {
	const entries = await fs.readdir(root);
	const stats = await Promise.all(
		entries.map(async (e) => ({
			dir: path.join(root, e),
			mtime: (await fs.stat(path.join(root, e))).mtimeMs
		}))
	);
	stats.sort((a, b) => b.mtime - a.mtime);
	for (const { dir } of stats.slice(max)) {
		if (dir !== keep) await fs.rm(dir, { recursive: true, force: true });
	}
}

// ---------------------------------------------------------------------------------------------
// Running idf.py
// ---------------------------------------------------------------------------------------------

/** Runs idf.py in `cwd` (a workspace) on the worker. */
function runIdf(
	cwd: string,
	args: string[],
	worker: Worker,
	log: (l: string) => void,
	signal: AbortSignal
): Promise<number> {
	log(`$ idf.py ${args.join(' ')}`);
	if (signal.aborted) return Promise.resolve(1);
	switch (worker.kind) {
		case 'idf-docker':
			return runIdfDocker(cwd, args, worker.config.url, log, signal);
		case 'idf-local':
			return runIdfLocal(cwd, args, worker.config, log, signal);
	}
}

// ---------------------------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------------------------

interface FlasherArgs {
	flash_settings: { flash_mode: string; flash_size: string; flash_freq: string };
	flash_files: Record<string, string>;
	app: { offset: string; file: string };
	extra_esptool_args: { chip: string };
}

async function readOutput(ws: string): Promise<BuildOutput> {
	const buildDir = path.join(ws, 'build');
	const args = JSON.parse(
		await fs.readFile(path.join(buildDir, 'flasher_args.json'), 'utf8')
	) as FlasherArgs;

	const parts = [];
	for (const [offsetHex, file] of Object.entries(args.flash_files)) {
		const data = await fs.readFile(path.join(buildDir, file));
		parts.push({
			file: path.basename(file),
			offset: parseInt(offsetHex, 16),
			data
		});
	}

	const sdkconfig = await fs.readFile(path.join(ws, 'sdkconfig'), 'utf8').catch(() => '');
	const psram = !/^CONFIG_SPIRAM=y$/m.test(sdkconfig)
		? 'none'
		: /^CONFIG_SPIRAM_MODE_OCT=y$/m.test(sdkconfig)
			? 'octal'
			: 'quad';

	return {
		chip: args.extra_esptool_args.chip,
		flashMode: args.flash_settings.flash_mode,
		flashFreq: args.flash_settings.flash_freq,
		flashSize: args.flash_settings.flash_size,
		psram,
		app: path.basename(args.app.file),
		parts
	};
}
