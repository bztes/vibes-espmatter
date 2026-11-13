/** A string remembered per browser (`localStorage`), e.g. a chosen tab. Falls back when unset or not `valid`. */
export class Stored {
	#key: string;
	#value = $state('');

	constructor(key: string, fallback = '', valid?: (v: string) => boolean) {
		this.#key = key;
		let saved: string | null = null;
		try {
			saved = localStorage.getItem(key);
		} catch {
			// private mode: not remembered
		}
		this.#value = saved !== null && (!valid || valid(saved)) ? saved : fallback;
	}

	get value() {
		return this.#value;
	}

	set value(v: string) {
		this.#value = v;
		try {
			localStorage.setItem(this.#key, v);
		} catch {
			// private mode: not remembered
		}
	}
}
