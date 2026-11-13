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

// One per digit count: building a formatter per call is slow (charts format on every pointer move).
const NUMBER_FORMATS = [0, 1, 2].map(
	(digits) => new Intl.NumberFormat(undefined, { maximumFractionDigits: digits })
);

/** A number rounded to what makes sense for its size: `123`, `12.3`, `1.23`. */
export function formatNumber(value: number): string {
	const abs = Math.abs(value);
	return NUMBER_FORMATS[abs >= 100 ? 0 : abs >= 10 ? 1 : 2].format(value);
}

/** A duration in its two biggest parts: `6d 1h`, `4m 20s`, `12.5 s`, `250 ms`. */
export function formatDuration(seconds: number): string {
	const sign = seconds < 0 ? '-' : '';
	const abs = Math.abs(seconds);
	if (abs < 1) return `${sign}${formatNumber(abs * 1000)} ms`;
	if (abs < 60) return `${sign}${formatNumber(abs)} s`;
	const s = Math.round(abs);
	const parts: [number, string][] = [
		[Math.floor(s / 86400), 'd'],
		[Math.floor((s % 86400) / 3600), 'h'],
		[Math.floor((s % 3600) / 60), 'm'],
		[s % 60, 's']
	];
	const first = parts.findIndex(([n]) => n > 0);
	return (
		sign +
		parts
			.slice(first, first + 2)
			.filter(([n]) => n > 0)
			.map(([n, u]) => `${n}${u}`)
			.join(' ')
	);
}

export const formatBytes = (n: number) =>
	n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1024).toFixed(0)} KB`;
