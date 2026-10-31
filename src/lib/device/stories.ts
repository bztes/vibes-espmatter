/**
 * Stories: a feature's device UI on its own, without a device or project, shown by the developer
 * view at `/dev/ui`. A feature adds them in `features/<name>/stories.ts` (default export `Story[]`).
 */
import type { Component } from 'svelte';
import type { Session } from './features/web-ui/device-ui/auth.svelte';

export interface Story {
	name: string;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	component: Component<any>;
	props?: Record<string, unknown>;
	/**
	 * Answers of the device API by route: `/api/status` for GET, `POST /api/reboot` for others.
	 * Other GETs fail with 404, other POSTs answer `{}`.
	 */
	api?: Record<string, unknown>;
	/** The logged-in user; default an admin. */
	session?: Partial<Session>;
	/** Full width (layouts), not a panel column. */
	wide?: boolean;
}

/** All stories, keyed by feature folder. */
export const stories: Record<string, Story[]> = Object.fromEntries(
	Object.entries(
		import.meta.glob<Story[]>('./features/*/stories.ts', { import: 'default', eager: true })
	).map(([file, list]) => [file.split('/')[2], list])
);

/** Answer the device API (`/api/…`) from the current `routes()` instead of the network. */
export function mockApi(routes: () => Record<string, unknown>) {
	const fetch = window.fetch;
	window.fetch = async (input, init) => {
		const url = new URL(input instanceof Request ? input.url : String(input), location.href);
		if (!url.pathname.startsWith('/api/')) return fetch(input, init);
		const method = init?.method ?? 'GET';
		const key = method === 'GET' ? url.pathname : `${method} ${url.pathname}`;
		const answers = routes();
		if (key in answers) return Response.json(answers[key]);
		if (method !== 'GET') return Response.json({});
		return Response.json({ error: `${key} is not mocked by this story` }, { status: 404 });
	};
}
