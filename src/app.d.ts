import type { auth } from '#lib/server/auth.ts';

// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		interface Locals {
			user?: typeof auth.$Infer.Session.user;
			session?: typeof auth.$Infer.Session.session;
		}

		// interface Error {}
		// interface PageData {}
		interface PageState {
			/** /project: the template (or `empty`) a new device was started from – shows the configurator. */
			newDevice?: { template: string };
		}
		// interface Platform {}
	}
}

export {};
