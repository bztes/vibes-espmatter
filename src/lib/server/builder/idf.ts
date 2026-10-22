/**
 * Compiles one chip's firmware with ESP-IDF in a workspace directory.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

/** One chip's firmware to compile. */
export interface BuildJob {
	id: string;
	/** Workspace directory name: jobs with the same one rebuild incrementally. */
	workspace: string;
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
	/** Exit code of idf.py. */
	code: number;
	output?: BuildOutput;
}

export interface IdfOptions {
	idfPath: string;
	/** Python the ESP-IDF environment was installed with, if not `python3` on PATH. */
	idfPython?: string;
	/** Directory holding the workspaces. */
	root: string;
	/** Workspaces (≈1–2 GB each) kept for incremental rebuilds. */
	maxWorkspaces: number;
}

export async function runJob(
	job: BuildJob,
	opts: IdfOptions,
	log: (line: string) => void,
	signal: AbortSignal
): Promise<JobResult> {
	const ws = await prepareWorkspace(job, opts, log);
	const code = await runIdf(ws, ['build'], opts, log, signal);
	if (code !== 0 || signal.aborted) return { code: code || 1 };
	return { code, output: await readOutput(ws) };
}

// ---------------------------------------------------------------------------------------------
// Workspaces
// ---------------------------------------------------------------------------------------------

async function prepareWorkspace(
	job: BuildJob,
	opts: IdfOptions,
	log: (l: string) => void
): Promise<string> {
	const dir = path.join(opts.root, path.basename(job.workspace));
	const fresh = !existsSync(dir);
	await fs.mkdir(path.join(dir, 'main'), { recursive: true });
	log(
		fresh
			? `Creating workspace ${job.workspace} (first build takes a while)`
			: `Reusing workspace ${job.workspace}`
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
	await pruneWorkspaces(opts.root, dir, opts.maxWorkspaces);
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

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, 'g');

function runIdf(
	cwd: string,
	args: string[],
	opts: IdfOptions,
	log: (l: string) => void,
	signal: AbortSignal
): Promise<number> {
	if (!opts.idfPath) {
		log(
			'ERROR: IDF_PATH is not set. Install ESP-IDF and set IDF_PATH, or run the app in Docker (see README).'
		);
		return Promise.resolve(1);
	}
	const env: NodeJS.ProcessEnv = {
		...process.env,
		IDF_PATH: opts.idfPath,
		IDF_CCACHE_ENABLE: '1',
		FORCE_COLOR: '0'
	};
	if (opts.idfPython) env.PATH = `${path.dirname(opts.idfPython)}:${env.PATH}`;
	const cmd = 'bash';
	const argv = [
		'-c',
		`. "$IDF_PATH/export.sh" > /dev/null && exec idf.py ${args.map((a) => `'${a}'`).join(' ')}`
	];

	log(`$ idf.py ${args.join(' ')}`);
	return new Promise((resolve) => {
		if (signal.aborted) return resolve(1);
		const child = spawn(cmd, argv, { cwd, env });
		const kill = () => child.kill('SIGTERM');
		signal.addEventListener('abort', kill, { once: true });
		const onData = (() => {
			let buffer = '';
			return (chunk: Buffer) => {
				buffer += chunk.toString();
				const parts = buffer.split(/\r?\n|\r/);
				buffer = parts.pop() ?? '';
				for (const line of parts) if (line.trim()) log(line.replace(ANSI, ''));
			};
		})();
		child.stdout.on('data', onData);
		child.stderr.on('data', onData);
		child.on('error', (err) => {
			log(`ERROR: failed to start ${cmd}: ${err.message}`);
			resolve(1);
		});
		child.on('close', (code) => {
			signal.removeEventListener('abort', kill);
			resolve(code ?? 1);
		});
	});
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
