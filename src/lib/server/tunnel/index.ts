/**
 * The app's side of device tunnels: who may connect, each device's subdomain and domain, and
 * passing requests for `<subdomain>.<host of its app URL>` on to the device (hooks.server.ts).
 */
import type { RequestEvent } from '@sveltejs/kit';
import { and, eq, isNull, ne } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { device } from '../db/schema.ts';
import { deviceFromToken } from '../deploy.ts';
import { getSetting } from '../settings.ts';
import { MAX_BODY, TunnelError, onTunnel, setTunnelAuth, tunnelFetch } from './core.ts';

export { tunnelConnected, tunnelFetch, TunnelError } from './core.ts';

/** Called once at startup (hooks `init`). */
export function initTunnels() {
	setTunnelAuth(async (deviceId, token) => {
		try {
			const req = new Request('http://tunnel', { headers: { authorization: `Bearer ${token}` } });
			await deviceFromToken(req, deviceId);
			return true;
		} catch {
			return false;
		}
	});
	onTunnel((deviceId) => {
		void db
			.update(device)
			.set({ lastSeenAt: new Date() })
			.where(eq(device.id, deviceId))
			.catch(() => {});
	});
}

// --- Device domain and subdomains -------------------------------------------------------------

/** Labels that never name a device. */
const RESERVED = new Set(['www', 'app', 'api', 'admin', 'mail', 'static', 'cdn', 'status']);
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function validSubdomain(label: string) {
	return LABEL.test(label) && !RESERVED.has(label);
}

/** `Heat pump (cellar)` → `heat-pump-cellar` – the same rule as the device's hostname. */
export function slug(name: string) {
	const s = name
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 50)
		.replace(/-+$/, '');
	return s || 'device';
}

/** A free subdomain for `name` (`matterhub`, `matterhub-2`, …), not counting device `except`. */
export async function freeSubdomain(name: string, except?: string) {
	let base = slug(name);
	if (RESERVED.has(base)) base = `${base}-device`;
	for (let n = 1; ; n++) {
		const label = n === 1 ? base : `${base}-${n}`;
		const [taken] = await db
			.select({ id: device.id })
			.from(device)
			.where(
				except
					? and(eq(device.subdomain, label), ne(device.id, except))
					: eq(device.subdomain, label)
			);
		if (!taken) return label;
	}
}

/** The device's subdomain, picked from its name the first time it's needed. */
export async function ensureSubdomain(dev: { id: string; name: string; subdomain: string | null }) {
	if (dev.subdomain) return dev.subdomain;
	const label = await freeSubdomain(dev.name, dev.id);
	await db
		.update(device)
		.set({ subdomain: label })
		.where(and(eq(device.id, dev.id), isNull(device.subdomain)));
	const [row] = await db
		.select({ subdomain: device.subdomain })
		.from(device)
		.where(eq(device.id, dev.id));
	return row?.subdomain ?? label;
}

const isIp = (host: string) => /^[\d.]+$/.test(host) || host.includes(':');

type DeviceDomain = { domain: string; protocol: string; port: string };

/**
 * Where a device's subdomain lives: the host of the URL it reaches the app at, with its scheme and
 * port (`https://espmatter.app` → `matterhub.espmatter.app`). Without an app URL, or with an IP
 * address, `localhost` with the port of the URL – in development `matterhub.localhost:5173`.
 */
function domainOf(appUrl: string): DeviceDomain {
	let url: URL | undefined;
	try {
		url = new URL(appUrl);
	} catch {
		/* empty or not a URL */
	}
	const domain = (url?.hostname ?? '').toLowerCase().replace(/^\.+|\.+$/g, '');
	return domain && !isIp(domain)
		? { domain, protocol: url!.protocol, port: url!.port }
		: { domain: 'localhost', protocol: 'http:', port: url?.port ?? '' };
}

/** The device domain for an app URL of a device; without one, the admin's public URL. */
export async function deviceDomain(appUrl?: string | null): Promise<DeviceDomain> {
	return domainOf(appUrl || (await getSetting('publicUrl')));
}

/** `https://matterhub.espmatter.app` – in development `http://matterhub.localhost:5173`. */
export async function deviceUrl(subdomain: string | null, appUrl?: string | null) {
	if (!subdomain) return null;
	const d = await deviceDomain(appUrl);
	return `${d.protocol}//${subdomain}.${d.domain}${d.port ? `:${d.port}` : ''}`;
}

// --- Passing requests on ----------------------------------------------------------------------

/** Request headers a device needs (its HTTP server takes 1 KB of headers at most). */
const FORWARD = ['authorization', 'content-type', 'accept'];

/**
 * Failed login attempts per client and device, and per device, in a 5-minute window. Only wrong
 * passwords count: successful logins, and attempts while the device is offline (it reboots, and
 * everybody logs in again – sessions end with a reboot on older firmware), don't use them up.
 */
const LOGIN_WINDOW_MS = 5 * 60_000;
const LOGIN_PER_CLIENT = 10;
const LOGIN_PER_DEVICE = 30;
const attempts = new Map<string, number[]>();

/** The recent failures of `key`, pruned. */
function recentFailures(key: string, now: number) {
	const recent = (attempts.get(key) ?? []).filter((t) => now - t < LOGIN_WINDOW_MS);
	if (recent.length) attempts.set(key, recent);
	else attempts.delete(key);
	return recent;
}

function tooManyLogins(keys: [string, number][]) {
	const now = Date.now();
	return keys.some(([key, limit]) => recentFailures(key, now).length >= limit);
}

function loginFailed(keys: [string, number][]) {
	const now = Date.now();
	for (const [key] of keys) attempts.set(key, [...recentFailures(key, now), now]);
	if (attempts.size > 10_000) for (const k of [...attempts.keys()]) recentFailures(k, now);
}

function problem(status: number, message: string, api: boolean) {
	return api
		? Response.json({ error: message }, { status })
		: new Response(message, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });
}

/** The request's host without port, lower case. */
function hostOf(event: RequestEvent) {
	const host = event.request.headers.get('host') ?? event.url.host;
	return host.replace(/:\d+$/, '').toLowerCase();
}

/**
 * A request for a device's hostname (`matterhub.espmatter.app`): passed on to the device, as it
 * is. Undefined: the request is for the app.
 */
export async function routeDeviceHost(event: RequestEvent): Promise<Response | undefined> {
	const host = hostOf(event);
	const dot = host.indexOf('.');
	if (dot < 0 || isIp(host)) return undefined;
	const label = host.slice(0, dot);
	if (!validSubdomain(label)) return undefined;

	// A device's hostname is its subdomain below the host of its app URL – anything else is the app.
	const [dev] = await db
		.select({ id: device.id, settings: device.settings })
		.from(device)
		.where(eq(device.subdomain, label));
	if (!dev || (await deviceDomain(dev.settings.appUrl)).domain !== host.slice(dot + 1))
		return undefined;

	const path = event.url.pathname + event.url.search;
	const api = event.url.pathname.startsWith('/api/');

	const method = event.request.method;
	let loginKeys: [string, number][] | undefined;
	if (method === 'POST' && event.url.pathname === '/api/v1/auth/login') {
		let client = 'unknown';
		try {
			client = event.getClientAddress();
		} catch {
			/* behind an adapter without it */
		}
		loginKeys = [
			[`${dev.id}|${client}`, LOGIN_PER_CLIENT],
			[dev.id, LOGIN_PER_DEVICE]
		];
		if (tooManyLogins(loginKeys))
			return problem(429, 'Too many failed login attempts – try again in a few minutes.', true);
	}

	const headers: Record<string, string> = {};
	for (const name of FORWARD) {
		const value = event.request.headers.get(name);
		if (value) headers[name] = value;
	}
	let body: Uint8Array | undefined;
	if (method !== 'GET' && method !== 'HEAD') {
		const length = Number(event.request.headers.get('content-length') ?? 0);
		if (length > MAX_BODY) return problem(413, 'The request body is too large.', api);
		body = new Uint8Array(await event.request.arrayBuffer());
	}
	try {
		// HEAD as GET: the device's HTTP client would wait for the body a HEAD answer announces.
		const res = await tunnelFetch(dev.id, {
			method: method === 'HEAD' ? 'GET' : method,
			path,
			headers,
			body
		});
		if (loginKeys && res.status === 401) loginFailed(loginKeys);
		return method === 'HEAD' ? new Response(null, res) : res;
	} catch (err) {
		if (err instanceof TunnelError)
			return problem(
				err.status,
				err.status === 503 ? 'The device is offline (not connected to the app).' : err.message,
				api
			);
		throw err;
	}
}
