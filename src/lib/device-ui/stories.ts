/**
 * Widget previews for /dev/ui: every `stories.ts` of a plugin (and the platform), keyed by folder.
 */
import type { Story } from '#sdk/device-ui';

export const stories: Record<string, Story[]> = Object.fromEntries(
	Object.entries(
		import.meta.glob<Story[]>(['/plugins/**/stories.ts', '/src/lib/core/platform/stories.ts'], {
			import: 'default',
			eager: true
		})
	)
		.map(
			([file, list]) =>
				[file.slice(1, -'/stories.ts'.length).replace(/^src\/lib\/core\//, ''), list] as const
		)
		.sort(([a], [b]) => a.localeCompare(b))
);

/** Answer `/api/…` from the current story instead of the network. */
export function mockFetch(routes: () => Record<string, unknown>) {
	const original = window.fetch.bind(window);
	window.fetch = async (input, init) => {
		const url = new URL(input instanceof Request ? input.url : String(input), location.href);
		if (!url.pathname.startsWith('/api/v1/') || url.origin !== location.origin)
			return original(input, init);
		const method = (init?.method ?? 'GET').toUpperCase();
		const answers = routes();
		await new Promise((r) => setTimeout(r, 120)); // feel like a device
		for (const key of [`${method} ${url.pathname}`, method === 'GET' ? url.pathname : ''])
			if (key && key in answers) return Response.json(answers[key]);
		if (url.pathname === '/api/v1/auth/me')
			return Response.json({ ok: true, user: 'admin', admin: true });
		if (method !== 'GET') return Response.json({ ok: true });
		return Response.json({ error: `${url.pathname} is not mocked by this story` }, { status: 404 });
	};
	return () => (window.fetch = original);
}
