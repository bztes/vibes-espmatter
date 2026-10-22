import { ORIGIN, BETTER_AUTH_SECRET } from '$app/env/private';
import { betterAuth } from 'better-auth/minimal';
import { APIError } from 'better-auth/api';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { getRequestEvent } from '$app/server';
import { dev } from '$app/env';
import { db } from '#lib/server/db/index.ts';
import { user } from '#lib/server/db/auth.schema.ts';

/** Self-hosted: only the first account can be created, by whoever sets up the server. */
export async function canSignUp() {
	const [row] = await db.select({ id: user.id }).from(user).limit(1);
	return !row;
}

export const auth = betterAuth({
	// In dev, Vite may move to another port when 5173 is taken; derive the URL from the request.
	baseURL: dev
		? { allowedHosts: ['localhost:*', '127.0.0.1:*'], protocol: 'http', fallback: ORIGIN }
		: ORIGIN,
	secret: BETTER_AUTH_SECRET,
	database: drizzleAdapter(db, { provider: 'sqlite' }),
	emailAndPassword: { enabled: true },
	databaseHooks: {
		user: {
			create: {
				// Covers both the sign-up form and better-auth's own /api/auth endpoints.
				before: async () => {
					if (!(await canSignUp())) {
						throw new APIError('FORBIDDEN', { message: 'Sign-up is closed.' });
					}
				}
			}
		}
	},
	plugins: [
		sveltekitCookies(getRequestEvent) // make sure this is the last plugin in the array
	]
});
