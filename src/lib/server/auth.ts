import { ORIGIN, BETTER_AUTH_SECRET } from '$app/env/private';
import { betterAuth } from 'better-auth/minimal';
import { APIError } from 'better-auth/api';
import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { getRequestEvent } from '$app/server';
import { dev } from '$app/env';
import { db } from '#lib/server/db/index.ts';
import { user } from '#lib/server/db/auth.schema.ts';
import { getSetting } from '#lib/server/settings.ts';

async function hasAdmin() {
	const [row] = await db.select({ id: user.id }).from(user).where(eq(user.role, 'admin')).limit(1);
	return !!row;
}

/**
 * Self-hosted: sign-up is always open while there is no admin, so whoever sets up the server
 * becomes it. After that, an admin decides (/admin).
 */
async function signUpState() {
	const [adminExists, enabled] = await Promise.all([hasAdmin(), getSetting('signUpEnabled')]);
	return { adminExists, open: !adminExists || enabled };
}

export const canSignUp = async () => (await signUpState()).open;

export const isAdmin = (user: App.Locals['user']) => user?.role === 'admin';

/** Admin pages and functions: everyone else gets a 404, as if they didn't exist. */
export function requireAdmin() {
	if (!isAdmin(getRequestEvent().locals.user)) error(404, 'Not Found');
}

export const auth = betterAuth({
	// In dev, Vite may move to another port when 5173 is taken; derive the URL from the request.
	baseURL: dev
		? { allowedHosts: ['localhost:*', '127.0.0.1:*'], protocol: 'http', fallback: ORIGIN }
		: ORIGIN,
	secret: BETTER_AUTH_SECRET,
	database: drizzleAdapter(db, { provider: 'sqlite' }),
	emailAndPassword: { enabled: true },
	user: {
		additionalFields: {
			/** `admin` can open /admin (the build workers). */
			role: { type: 'string', required: false, defaultValue: 'user', input: false }
		}
	},
	databaseHooks: {
		user: {
			create: {
				// Covers both the sign-up form and better-auth's own /api/auth endpoints.
				before: async (data) => {
					const { adminExists, open } = await signUpState();
					if (!open) {
						throw new APIError('FORBIDDEN', { message: 'Sign-up is closed.' });
					}
					// No admin yet: this account sets up the server.
					return { data: { ...data, role: adminExists ? 'user' : 'admin' } };
				}
			}
		}
	},
	plugins: [
		sveltekitCookies(getRequestEvent) // make sure this is the last plugin in the array
	]
});
