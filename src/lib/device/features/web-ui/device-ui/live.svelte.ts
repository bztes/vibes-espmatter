import { api, errorMessage } from './api';

export interface Live<T> {
	readonly data: T | undefined;
	readonly error: string | undefined;
	refresh(): Promise<void>;
}

// Registry of poll loops, not UI state: each entry is reactive on its own.
// eslint-disable-next-line svelte/prefer-svelte-reactivity
const sources = new Map<string, Live<unknown>>();

const visible = () => document.visibilityState === 'visible';

// Hidden tabs skip their polls; catch up as soon as the tab is shown again.
document.addEventListener('visibilitychange', () => {
	if (visible()) for (const source of sources.values()) void source.refresh();
});

/**
 * Poll a GET route and expose the latest response reactively. Panels asking for the same path
 * share one request loop (e.g. the System and Wi-Fi panels both read `/api/status`).
 */
export function live<T>(path: string, intervalMs = 10_000): Live<T> {
	let source = sources.get(path) as Live<T> | undefined;
	if (!source) {
		let data = $state<T>();
		let error = $state<string>();
		const refresh = async () => {
			try {
				data = await api<T>(path);
				error = undefined;
			} catch (e) {
				error = errorMessage(e);
			}
		};
		const loop = () =>
			void (visible() ? refresh() : Promise.resolve()).finally(() => setTimeout(loop, intervalMs));
		loop();
		source = {
			get data() {
				return data;
			},
			get error() {
				return error;
			},
			refresh
		};
		sources.set(path, source);
	}
	return source;
}
