/**
 * Widget previews for /dev/ui: every `stories.ts` of a plugin (and the platform), keyed by folder.
 */
import type { SpotStory, Story } from '#sdk/device-ui';

const modules = Object.entries(
	import.meta.glob<{ default: Story[]; parts?: Story[]; spotStories?: SpotStory[] }>(
		['/plugins/**/stories.ts', '/src/lib/core/platform/stories.ts'],
		{ eager: true }
	)
)
	.map(
		([file, m]) =>
			[file.slice(1, -'/stories.ts'.length).replace(/^src\/lib\/core\//, ''), m] as const
	)
	.sort(([a], [b]) => a.localeCompare(b));

export const stories: Record<string, Story[]> = Object.fromEntries(
	modules.map(([dir, m]) => [dir, [...m.default, ...(m.parts ?? [])]])
);

/** Widget stories only (no `parts`): what the shell preview shows. */
export const widgetStories: Story[] = modules.flatMap(([, m]) => m.default);

/** What the plugins put into spots (`export const spotStories` of a `stories.ts`), on every preview. */
export const spotStories: SpotStory[] = modules.flatMap(([, m]) => m.spotStories ?? []);

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
