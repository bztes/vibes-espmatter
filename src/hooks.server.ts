import { redirect } from '@sveltejs/kit';
import type { Handle, ServerInit } from '@sveltejs/kit/hooks';
import { pruneSessions, SESSION_COOKIE, sessionUser } from '#lib/server/auth.ts';
import { initDb } from '#lib/server/db/index.ts';
import { startBuilder } from '#lib/server/builds/queue.ts';
import { initTunnels, routeDeviceHost } from '#lib/server/tunnel/index.ts';

export const init: ServerInit = async () => {
	await initDb();
	initTunnels();
	await pruneSessions();
	await startBuilder();
};

/** Pages anyone may open. Device endpoints (`/api/v1`) authenticate with the device token. */
const PUBLIC = [
	/^\/login\/?$/,
	/^\/signup\/?$/,
	/^\/api\/v1\//,
	/^\/_app\//,
	/^\/favicon/,
	/^\/robots\.txt$/
];

/** Where someone who must change their generated password may still go. */
const PASSWORD_CHANGE = [/^\/password\/?$/, /^\/login\/?$/, /^\/_app\//, /^\/favicon/];

export const handle: Handle = async ({ event, resolve }) => {
	// `<device>.<device domain>`: the device's own UI and API, through its tunnel – not the app.
	const forwarded = await routeDeviceHost(event);
	if (forwarded) return forwarded;
	const u = await sessionUser(event.cookies.get(SESSION_COOKIE));
	const path = event.url.pathname;
	if (u?.mustChangePassword) {
		// Not signed in for anything else (remote functions see no `locals.user`) until changed.
		event.locals.passwordChange = u;
		if (event.request.method === 'GET' && !PASSWORD_CHANGE.some((p) => p.test(path)))
			redirect(303, `/password?redirectTo=${encodeURIComponent(path + event.url.search)}`);
		return resolve(event);
	}
	event.locals.user = u;
	if (!event.locals.user && !PUBLIC.some((p) => p.test(path)) && event.request.method === 'GET') {
		redirect(303, `/login?redirectTo=${encodeURIComponent(path + event.url.search)}`);
	}
	return resolve(event);
};
