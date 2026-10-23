/** Build worker kind `idf-local`: an ESP-IDF checkout on the machine this server runs on. */
import { spawn } from 'node:child_process';
import path from 'node:path';
import type { WorkerConfigs } from '#lib/server/db/schema.ts';
import { lineSplitter } from './lines.ts';

/** Runs idf.py in `cwd` with the ESP-IDF checkout of the worker, on this server. */
export function runIdfLocal(
	cwd: string,
	args: string[],
	{ idfPath, idfPython }: WorkerConfigs['idf-local'],
	log: (l: string) => void,
	signal: AbortSignal
): Promise<number> {
	const env: NodeJS.ProcessEnv = {
		...process.env,
		IDF_PATH: idfPath,
		IDF_CCACHE_ENABLE: '1',
		FORCE_COLOR: '0'
	};
	if (idfPython) env.PATH = `${path.dirname(idfPython)}:${env.PATH}`;
	const argv = [
		'-c',
		`. "$IDF_PATH/export.sh" > /dev/null && exec idf.py ${args.map((a) => `'${a}'`).join(' ')}`
	];

	return new Promise((resolve) => {
		const child = spawn('bash', argv, { cwd, env });
		const kill = () => child.kill('SIGTERM');
		signal.addEventListener('abort', kill, { once: true });
		const onData = lineSplitter(log);
		child.stdout.on('data', onData);
		child.stderr.on('data', onData);
		child.on('error', (err) => {
			log(`ERROR: failed to start bash: ${err.message}`);
			resolve(1);
		});
		child.on('close', (code) => {
			signal.removeEventListener('abort', kill);
			resolve(code ?? 1);
		});
	});
}
