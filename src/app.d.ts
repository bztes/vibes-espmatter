import type { SessionUser } from '#lib/server/auth.ts';

declare global {
	namespace App {
		interface Locals {
			user?: SessionUser;
			/** Signed in with a generated password: may only change it (`/password`), nothing else. */
			passwordChange?: SessionUser;
		}
	}
}

export {};
