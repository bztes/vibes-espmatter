/**
 * Device tunnels: each device with the remote-access feature keeps a WebSocket open to the app
 * (`/api/v1/devices/<id>/tunnel`, its API token as Bearer), and the app sends HTTP requests for the
 * device down that socket. The device answers them from its own HTTP server, so its routes, its
 * login and its UI work exactly as on the LAN.
 *
 * Plain Node (no SvelteKit imports): the production server (`server.ts`) and the dev server (a Vite
 * plugin) hand WebSocket upgrades to it, the app's routes send requests through it. Both load this
 * module separately, so the state lives on `globalThis`.
 *
 * Wire format (protocol 1):
 * - app → device, text: `{"t":"req","id":7,"m":"GET","p":"/api/v1/info","h":{…},"n":<body bytes>}`;
 *   with `n` > 0 followed by one binary frame: 4-byte id (big endian) + the body.
 * - device → app, text: `{"t":"res","id":7,"s":200,"h":{…}}`, then binary frames (4-byte id +
 *   a chunk of the body), then `{"t":"end","id":7}` – or `{"t":"err","id":7,"e":"…"}` at any point.
 */
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';

export const TUNNEL_PATH = /^\/api\/v1\/devices\/([0-9a-f-]{36})\/tunnel\/?$/;
/** Largest request body sent to a device (its HTTP server reads JSON bodies of a few KB). */
export const MAX_BODY = 16 * 1024;
const PING_MS = 25_000;
/** Until the device starts answering. */
const RESPONSE_TIMEOUT_MS = 30_000;
/** Between two chunks of an answer. */
const IDLE_TIMEOUT_MS = 30_000;

/** Checks a device's token when it connects (set by the app: it knows the database). */
export type TunnelAuth = (deviceId: string, token: string) => Promise<boolean>;
export type TunnelEvent = (deviceId: string, connected: boolean) => void;

interface Pending {
	resolve: (res: Response) => void;
	reject: (err: Error) => void;
	controller?: ReadableStreamDefaultController<Uint8Array>;
	timer: NodeJS.Timeout;
}

interface Conn {
	ws: WebSocket;
	since: Date;
	nextId: number;
	pending: Map<number, Pending>;
	alive: boolean;
}

interface State {
	wss: WebSocketServer;
	conns: Map<string, Conn>;
	auth?: TunnelAuth;
	listeners: Set<TunnelEvent>;
	pinger?: NodeJS.Timeout;
	/** For the HTTP servers (`server.js`, the Vite plugin), which don't import this module. */
	upgrade?: (req: IncomingMessage, socket: Duplex, head: Buffer) => boolean;
}

const KEY = Symbol.for('espmatter.tunnels');
const g = globalThis as unknown as { [KEY]?: State };
const state: State = (g[KEY] ??= {
	wss: new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 }),
	conns: new Map(),
	listeners: new Set()
});

export class TunnelError extends Error {
	constructor(
		message: string,
		readonly status: number
	) {
		super(message);
	}
}

/** Who checks device tokens. Until set, connecting devices are turned away (they retry). */
export function setTunnelAuth(auth: TunnelAuth) {
	state.auth = auth;
}

/** Called when a device connects or goes away. Returns an unsubscribe function. */
export function onTunnel(fn: TunnelEvent) {
	state.listeners.add(fn);
	return () => state.listeners.delete(fn);
}

export function tunnelConnected(deviceId: string): Date | undefined {
	return state.conns.get(deviceId)?.since;
}

const reject = (socket: Duplex, status: number, text: string) => {
	socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
};

/**
 * An HTTP upgrade request. True when it was a tunnel (then it's handled, accepted or not); false
 * leaves the socket to whoever else listens (e.g. Vite's HMR).
 */
export function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
	const match = TUNNEL_PATH.exec((req.url ?? '').split('?')[0]);
	if (!match) return false;
	const deviceId = match[1];
	const header = req.headers.authorization ?? '';
	const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
	const auth = state.auth;
	if (!token) {
		reject(socket, 401, 'Unauthorized');
		return true;
	}
	if (!auth) {
		reject(socket, 503, 'Service Unavailable');
		return true;
	}
	auth(deviceId, token).then(
		(ok) => {
			if (!ok) return reject(socket, 401, 'Unauthorized');
			state.wss.handleUpgrade(req, socket, head, (ws) => attach(deviceId, ws));
		},
		() => reject(socket, 500, 'Internal Server Error')
	);
	return true;
}
state.upgrade = handleUpgrade;

function emit(deviceId: string, connected: boolean) {
	for (const fn of state.listeners) {
		try {
			fn(deviceId, connected);
		} catch {
			/* a listener's problem */
		}
	}
}

function attach(deviceId: string, ws: WebSocket) {
	// A device that reconnects (e.g. after a restart) replaces its old, possibly half-open socket.
	state.conns.get(deviceId)?.ws.terminate();
	const conn: Conn = { ws, since: new Date(), nextId: 1, pending: new Map(), alive: true };
	state.conns.set(deviceId, conn);
	emit(deviceId, true);
	ensurePinger();

	ws.on('pong', () => (conn.alive = true));
	ws.on('message', (data, binary) => {
		const buf = Array.isArray(data)
			? Buffer.concat(data)
			: Buffer.isBuffer(data)
				? data
				: Buffer.from(data);
		if (binary) onChunk(conn, buf);
		else onControl(conn, buf.toString('utf8'));
	});
	ws.on('close', () => {
		for (const [, p] of conn.pending) fail(p, new TunnelError('The device disconnected.', 502));
		conn.pending.clear();
		if (state.conns.get(deviceId) === conn) {
			state.conns.delete(deviceId);
			emit(deviceId, false);
		}
	});
	ws.on('error', () => ws.terminate());
}

function ensurePinger() {
	if (state.pinger) return;
	state.pinger = setInterval(() => {
		for (const conn of state.conns.values()) {
			if (!conn.alive) {
				conn.ws.terminate();
				continue;
			}
			conn.alive = false;
			conn.ws.ping();
		}
	}, PING_MS);
	state.pinger.unref();
}

function fail(p: Pending, err: Error) {
	clearTimeout(p.timer);
	if (p.controller) {
		try {
			p.controller.error(err);
		} catch {
			/* already closed */
		}
	} else p.reject(err);
}

function arm(conn: Conn, id: number, p: Pending, ms: number) {
	clearTimeout(p.timer);
	p.timer = setTimeout(() => {
		conn.pending.delete(id);
		fail(p, new TunnelError('The device didn’t answer in time.', 504));
	}, ms);
}

function onControl(conn: Conn, text: string) {
	let msg: { t?: string; id?: number; s?: number; h?: Record<string, string>; e?: string };
	try {
		msg = JSON.parse(text);
	} catch {
		return;
	}
	const id = Number(msg.id);
	const p = conn.pending.get(id);
	if (!p) return;
	if (msg.t === 'res' && !p.controller) {
		const headers = new Headers();
		for (const [k, v] of Object.entries(msg.h ?? {}))
			if (typeof v === 'string' && v) headers.set(k, v);
		const status = Number(msg.s) || 502;
		const nullBody = status === 204 || status === 304;
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				p.controller = controller;
			},
			cancel() {
				// The client went away: the rest of the answer is dropped.
				clearTimeout(p.timer);
				conn.pending.delete(id);
			}
		});
		arm(conn, id, p, IDLE_TIMEOUT_MS);
		p.resolve(new Response(nullBody ? null : body, { status, headers }));
	} else if (msg.t === 'end') {
		clearTimeout(p.timer);
		conn.pending.delete(id);
		try {
			p.controller?.close();
		} catch {
			/* cancelled by the client */
		}
		if (!p.controller) p.reject(new TunnelError('The device sent no answer.', 502));
	} else if (msg.t === 'err') {
		conn.pending.delete(id);
		fail(p, new TunnelError(`The device couldn’t answer: ${msg.e || 'error'}`, 502));
	}
}

function onChunk(conn: Conn, buf: Buffer) {
	if (buf.length < 4) return;
	const id = buf.readUInt32BE(0);
	const p = conn.pending.get(id);
	if (!p?.controller) return;
	arm(conn, id, p, IDLE_TIMEOUT_MS);
	try {
		p.controller.enqueue(new Uint8Array(buf.subarray(4)));
	} catch {
		/* the client went away; the rest is dropped */
	}
}

export interface TunnelRequest {
	method: string;
	/** Path and query, e.g. `/api/v1/info?x=1`. */
	path: string;
	headers?: Record<string, string>;
	body?: Uint8Array;
}

/** Send a request to a device through its tunnel. Throws a TunnelError when that isn't possible. */
export function tunnelFetch(deviceId: string, req: TunnelRequest): Promise<Response> {
	const conn = state.conns.get(deviceId);
	if (!conn) return Promise.reject(new TunnelError('The device isn’t connected to the app.', 503));
	const body = req.body ?? new Uint8Array();
	if (body.length > MAX_BODY)
		return Promise.reject(new TunnelError('The request body is too large.', 413));
	const id = conn.nextId;
	conn.nextId = conn.nextId >= 0x7fffffff ? 1 : conn.nextId + 1;
	return new Promise<Response>((resolve, rejectPromise) => {
		const p: Pending = { resolve, reject: rejectPromise, timer: setTimeout(() => {}, 0) };
		conn.pending.set(id, p);
		arm(conn, id, p, RESPONSE_TIMEOUT_MS);
		const head = { t: 'req', id, m: req.method, p: req.path, h: req.headers ?? {}, n: body.length };
		conn.ws.send(JSON.stringify(head));
		if (body.length) {
			const frame = Buffer.alloc(4 + body.length);
			frame.writeUInt32BE(id, 0);
			frame.set(body, 4);
			conn.ws.send(frame, { binary: true });
		}
	});
}
