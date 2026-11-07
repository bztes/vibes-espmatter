import { api, errorText } from './api';

/**
 * A GET route, fetched now and every `interval` ms while the widget is mounted (and the tab is
 * visible). Create it during component initialisation.
 */
export class Poll<T> {
	current = $state<T | undefined>();
	error = $state<string>();
	loading = $state(true);

	constructor(
		private readonly path: string | (() => string),
		interval = 5000
	) {
		$effect(() => {
			void this.refresh();
			const timer = setInterval(() => {
				if (document.visibilityState === 'visible') void this.refresh();
			}, interval);
			return () => clearInterval(timer);
		});
	}

	async refresh() {
		try {
			this.current = await api<T>(typeof this.path === 'function' ? this.path() : this.path);
			this.error = undefined;
		} catch (e) {
			this.error = errorText(e);
		} finally {
			this.loading = false;
		}
	}
}
