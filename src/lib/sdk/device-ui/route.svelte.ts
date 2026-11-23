/** The hash route `#/path?query` of the device web interface: the shell picks the page by `path`, pages read `query`. */
class Route {
	#hash = $state(typeof location === 'undefined' ? '' : location.hash);

	constructor() {
		if (typeof window !== 'undefined')
			addEventListener('hashchange', () => (this.#hash = location.hash));
	}

	/** `/` for none. */
	get path() {
		return this.#hash.slice(1).split('?')[0] || '/';
	}

	get query() {
		return new URLSearchParams(this.#hash.split('?')[1]);
	}

	/** Drops the query from the address, e.g. once a page took what a link asked for. */
	clearQuery() {
		this.#hash = `#${this.path}`;
		history.replaceState(history.state, '', this.#hash);
	}
}

export const route = new Route();
