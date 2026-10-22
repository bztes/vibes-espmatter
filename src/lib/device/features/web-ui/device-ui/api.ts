// Helpers for the device web interface. Runs in the browser, served by the ESP itself.

export type Body = Record<string, string | number | boolean | undefined>;

let onUnauthorized = () => {};
/** Called when the device answers 401 (session expired or logged out elsewhere). */
export function setUnauthorizedHandler(handler: () => void) {
	onUnauthorized = handler;
}

/** Call a firmware API route. Bodies are sent url-encoded (that's what `mesp_web_param` reads). */
export async function api<T = unknown>(
	path: string,
	opts: { method?: string; body?: Body } = {}
): Promise<T> {
	const init: RequestInit = { method: opts.method ?? (opts.body ? 'POST' : 'GET') };
	if (opts.body) {
		const params = new URLSearchParams();
		for (const [k, v] of Object.entries(opts.body)) if (v !== undefined) params.set(k, String(v));
		init.body = params;
	}
	const res = await fetch(path, init);
	if (res.status === 401) onUnauthorized();
	const data = await res.json().catch(() => ({}));
	if (!res.ok) throw new Error((data as { error?: string }).error || res.statusText);
	return data as T;
}

export function fmtDuration(seconds: number): string {
	const d = Math.floor(seconds / 86400);
	const h = Math.floor((seconds % 86400) / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	return (d ? d + 'd ' : '') + (h ? h + 'h ' : '') + m + 'm ' + (seconds % 60) + 's';
}

/** Elapsed time in its largest whole unit, e.g. "42 s", "5 min", "3 h", "2 d". */
export function fmtAgo(seconds: number): string {
	if (seconds < 60) return seconds + ' s';
	if (seconds < 3600) return Math.floor(seconds / 60) + ' min';
	if (seconds < 86400) return Math.floor(seconds / 3600) + ' h';
	return Math.floor(seconds / 86400) + ' d';
}

export const hexId = (n: number) => '0x' + Number(n).toString(16);

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** A random password that is easy to read out and type (no 0/O, 1/l/I). */
export function generatePassword(length = 12): string {
	const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
	const random = crypto.getRandomValues(new Uint32Array(length));
	return Array.from(random, (n) => chars[n % chars.length]).join('');
}
