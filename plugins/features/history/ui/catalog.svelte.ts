import { ApiError, api, errorText } from '#sdk/device-ui';
import type { Catalog } from './sources';

const MAX_AGE_MS = 60000;

/** What has a history, shared by the page and the chart icons. `null`: no history on this device. */
export const catalog = $state<{ current?: Catalog | null; error?: string }>({});

let loaded = 0;
let pending: Promise<void> | undefined;

/** Loads the catalog unless it is fresh. */
export function loadCatalog(): Promise<void> {
	if (pending) return pending;
	if (Date.now() - loaded < MAX_AGE_MS) return Promise.resolve();
	pending = api<Catalog>('/api/v1/history/series')
		.then((c) => {
			catalog.current = c;
			catalog.error = undefined;
			loaded = Date.now();
		})
		.catch((e) => {
			// 404 / 403: nothing to show here. Anything else: try again next time.
			if (e instanceof ApiError && (e.status === 404 || e.status === 403)) {
				catalog.current = null;
				loaded = Date.now();
			} else catalog.error = errorText(e);
		})
		.finally(() => (pending = undefined));
	return pending;
}
