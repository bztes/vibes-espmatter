import { untrack } from 'svelte';
import { api, errorText } from '#sdk/device-ui';
import { presetView, type View } from './ranges';

export interface Ask<T> {
	/** Path with its query (`from` and `to` are added); same text: no reload. */
	path: string;
	view: View;
	parse: (raw: unknown) => T;
}

/** An answer for a range, loaded again on every change; an older answer arriving late is dropped. */
export class Loaded<T> {
	#data = $state<T>();
	/** Range and path of the data. */
	shown = $state({ from: 0, to: 1, path: '' });
	loading = $state(false);
	error = $state<string>();
	#path: () => string | undefined;
	#request = 0;

	/** Created while a component starts: loads as long as it lives. */
	constructor(ask: () => Ask<T> | undefined) {
		const asked = $derived(ask());
		// Strings and the range only: new objects with the same text don't reload.
		const path = $derived(asked?.path);
		const view = $derived(asked?.view);
		this.#path = () => path;
		$effect(() => {
			if (path === undefined || !view) return;
			const parse = untrack(() => asked!.parse);
			// A preset reaches up to now again on every load.
			const { from, to } = view.preset ? presetView(view.preset) : view;
			const mine = ++this.#request;
			this.loading = true;
			api(`${path}&from=${from}&to=${to}`)
				.then((raw) => {
					if (mine !== this.#request) return;
					this.#data = parse(raw);
					this.shown = { from, to, path };
					this.error = undefined;
				})
				.catch((e) => {
					if (mine !== this.#request) return;
					this.#data = undefined;
					this.error = errorText(e);
				})
				.finally(() => {
					if (mine === this.#request) this.loading = false;
				});
		});
	}

	/** The data, only once it is the answer to what is asked now. */
	get data(): T | undefined {
		return this.shown.path === this.#path() ? this.#data : undefined;
	}
}
