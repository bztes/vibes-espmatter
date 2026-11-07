/**
 * Talking to the device's REST API from a widget. Runs in the browser, served by the ESP itself
 * (or mocked by /dev/ui). The token is the one the login screen stored.
 */
const TOKEN_KEY = 'espm-token';

export function getToken(): string {
	try {
		return localStorage.getItem(TOKEN_KEY) ?? '';
	} catch {
		return '';
	}
}

export function setToken(token: string) {
	try {
		if (token) localStorage.setItem(TOKEN_KEY, token);
		else localStorage.removeItem(TOKEN_KEY);
	} catch {
		/* private mode */
	}
}

export class ApiError extends Error {
	constructor(
		message: string,
		readonly status: number
	) {
		super(message);
	}
}

let unauthorized = () => {};
export const onUnauthorized = (fn: () => void) => (unauthorized = fn);

/** Call a route. Objects are sent as JSON. */
export async function api<T = unknown>(
	path: string,
	opts: { method?: string; body?: unknown } = {}
): Promise<T> {
	const headers: Record<string, string> = {};
	const token = getToken();
	if (token) headers.authorization = `Bearer ${token}`;
	let body: BodyInit | undefined;
	if (opts.body !== undefined) {
		headers['content-type'] = 'application/json';
		body = JSON.stringify(opts.body);
	}
	const res = await fetch(path, { method: opts.method ?? (body ? 'POST' : 'GET'), headers, body });
	if (res.status === 401) unauthorized();
	const data = await res.json().catch(() => ({}));
	if (!res.ok) throw new ApiError((data as { error?: string }).error || res.statusText, res.status);
	return data as T;
}

export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function formatDuration(seconds: number): string {
	const d = Math.floor(seconds / 86400);
	const h = Math.floor((seconds % 86400) / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	if (d) return `${d}d ${h}h`;
	if (h) return `${h}h ${m}m`;
	return `${m}m ${seconds % 60}s`;
}

export const formatBytes = (n: number) =>
	n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1024).toFixed(0)} KB`;
