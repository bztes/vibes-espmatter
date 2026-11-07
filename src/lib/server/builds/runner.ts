/**
 * Runs `idf.py` for a workspace: with ESP-IDF installed on this machine (`local`) or in the
 * official Docker image (`docker`, the Docker CLI must be available to the app).
 */
import { spawn } from 'node:child_process';
import os from 'node:os';
import type { runner } from '#lib/server/db/schema.ts';

export type Runner = typeof runner.$inferSelect;

export const DEFAULT_IMAGE = 'espressif/idf:v5.4.2';

function lines(log: (line: string) => void) {
	let rest = '';
	return (chunk: Buffer) => {
		const text = rest + chunk.toString('utf8');
		const parts = text.split(/\r?\n|\r/);
		rest = parts.pop() ?? '';
		for (const line of parts) if (line.trim()) log(line);
	};
}

/** Volumes whose ownership was already fixed in this process (keyed by image + uid). */
const preparedCache = new Set<string>();

/**
 * Docker creates the named cache volume owned by root, but builds run as the host user, so
 * ccache and the component manager could not write to it ("ccache: error: Permission denied").
 * Once per process, create the cache directories as root and hand them to the build user.
 */
async function prepareCacheVolume(image: string, uid: string, log: (line: string) => void) {
	const key = `${image}|${uid}`;
	if (preparedCache.has(key)) return;
	const code = await spawnLogged(
		'docker',
		[
			'run',
			'--rm',
			'--user',
			'0:0',
			'-v',
			'espm-idf-cache:/cache',
			'--entrypoint',
			'sh',
			image,
			'-c',
			`mkdir -p /cache/ccache /cache/components && chown -R ${uid} /cache`
		],
		os.tmpdir(),
		log
	);
	if (code === 0) preparedCache.add(key);
	else log(`WARNING: could not fix ownership of the espm-idf-cache volume (exit code ${code}).`);
}

export async function runIdf(
	r: Runner,
	cwd: string,
	args: string[],
	log: (line: string) => void,
	signal: AbortSignal
): Promise<number> {
	log(`$ idf.py ${args.join(' ')}`);
	let command: string;
	let argv: string[];
	if (r.kind === 'docker') {
		const uid =
			typeof process.getuid === 'function'
				? `${process.getuid()}:${process.getgid?.()}`
				: undefined;
		if (uid) await prepareCacheVolume(r.config.image || DEFAULT_IMAGE, uid, log);
		command = 'docker';
		argv = [
			'run',
			'--rm',
			'-i',
			'-v',
			`${cwd}:/project`,
			'-w',
			'/project',
			'-v',
			'espm-idf-cache:/cache',
			'-e',
			'IDF_CCACHE_ENABLE=1',
			'-e',
			'CCACHE_DIR=/cache/ccache',
			'-e',
			'IDF_COMPONENT_CACHE_PATH=/cache/components',
			'-e',
			'HOME=/tmp',
			...(uid ? ['--user', uid] : []),
			r.config.image || DEFAULT_IMAGE,
			'idf.py',
			...args
		];
	} else {
		command = 'bash';
		const quoted = args.map((a) => `'${a.replaceAll("'", "'\\''")}'`).join(' ');
		argv = ['-c', `. "$IDF_PATH/export.sh" > /dev/null && exec idf.py ${quoted}`];
	}
	return new Promise((resolve) => {
		const child = spawn(command, argv, {
			cwd: r.kind === 'docker' ? os.tmpdir() : cwd,
			env: {
				...process.env,
				IDF_PATH: r.config.idfPath || process.env.IDF_PATH,
				IDF_CCACHE_ENABLE: '1',
				FORCE_COLOR: '0'
			}
		});
		const kill = () => child.kill('SIGTERM');
		signal.addEventListener('abort', kill, { once: true });
		const onData = lines(log);
		child.stdout.on('data', onData);
		child.stderr.on('data', onData);
		child.on('error', (err) => {
			log(`ERROR: ${command} could not be started: ${err.message}`);
			resolve(127);
		});
		child.on('close', (code) => {
			signal.removeEventListener('abort', kill);
			resolve(code ?? 1);
		});
	});
}

/** Runs a plain command with its output going to `log`. */
export function spawnLogged(
	command: string,
	argv: string[],
	cwd: string,
	log: (line: string) => void,
	signal?: AbortSignal
): Promise<number> {
	return new Promise((resolve) => {
		const child = spawn(command, argv, { cwd, signal, killSignal: 'SIGTERM' });
		const onData = lines(log);
		child.stdout.on('data', onData);
		child.stderr.on('data', onData);
		child.on('error', (err) => {
			if (err.name !== 'AbortError') log(`ERROR: ${command} could not be started: ${err.message}`);
			resolve(127);
		});
		child.on('close', (code) => resolve(code ?? 1));
	});
}
