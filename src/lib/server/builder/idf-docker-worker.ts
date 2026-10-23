/**
 * Build worker kind `idf-docker`: idf-worker.py, e.g. the `idf` compose service. It sees DATA_DIR through
 * a shared volume, so workspaces need no copying.
 */
import { randomUUID } from 'node:crypto';
import { errorMessage } from '#lib/errors.ts';
import { lineSplitter } from './lines.ts';

/** Last line idf-worker.py sends: "\x1eexit <code>". */
const WORKER_EXIT = '\x1eexit ';

/** Runs idf.py in the `idf` compose service; `cwd` is on the volume both containers share. */
export async function runIdfDocker(
	cwd: string,
	args: string[],
	workerUrl: string,
	log: (l: string) => void,
	signal: AbortSignal
): Promise<number> {
	const id = randomUUID();
	const post = (route: string, body: unknown) =>
		fetch(new URL(route, workerUrl), {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		});
	const cancel = () => void post('cancel', { id }).catch(() => {});
	signal.addEventListener('abort', cancel, { once: true });
	try {
		const res = await post('run', { id, cwd, args });
		if (!res.ok || !res.body) {
			log(`ERROR: the IDF worker answered ${res.status}: ${(await res.text()).trim()}`);
			return 1;
		}
		let code: number | undefined;
		const onData = lineSplitter((line) => {
			if (line.startsWith(WORKER_EXIT)) code = Number(line.slice(WORKER_EXIT.length));
			else log(line);
		});
		for await (const chunk of res.body) onData(chunk);
		onData(new TextEncoder().encode('\n'));
		if (code === undefined) log('ERROR: the IDF worker stopped before idf.py finished');
		return code ?? 1;
	} catch (err) {
		log(`ERROR: can't reach the IDF worker at ${workerUrl}: ${errorMessage(err)}`);
		return 1;
	} finally {
		signal.removeEventListener('abort', cancel);
	}
}
