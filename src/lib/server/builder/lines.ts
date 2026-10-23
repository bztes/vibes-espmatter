/** Turns a process's output into log lines. */

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, 'g');

/** Splits output chunks into non-empty log lines. */
export function lineSplitter(onLine: (line: string) => void) {
	const decoder = new TextDecoder();
	let buffer = '';
	return (chunk: Uint8Array) => {
		buffer += decoder.decode(chunk, { stream: true });
		const parts = buffer.split(/\r?\n|\r/);
		buffer = parts.pop() ?? '';
		for (const line of parts) if (line.trim()) onLine(line.replace(ANSI, ''));
	};
}
