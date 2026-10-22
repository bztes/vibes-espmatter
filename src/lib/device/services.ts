/**
 * Services: how the parts of the app find each other, instead of looking for files.
 *
 *  - App-wide (`app` in `registry.ts`): the feature definitions (`featureDefs`) and templates.
 *  - Per chip: each feature of the chip is activated (`FeatureDef.activate`) and registers what it
 *    brings with the chip's services. Those of every chip are in `features/core/services.ts`,
 *    the others in the `services.ts` of the feature that brings them. The names say where it ends up:
 *     - `device…` / `firmware`: runs on the ESP – its firmware, and from features that bring them
 *       the device's REST API docs (`deviceApi`, `features/http-server/services.ts`) and the
 *       pages and panels of its web interface (`devicePages`, `devicePanels`,
 *       `features/web-ui/services.ts`). Those only exist on chips with that feature.
 *     - `configurator…` / `flashMethods`: runs in this web app – the feature's settings editor,
 *       extra configurator tabs and ways to flash.
 *     - `wires`, `parts`: the hardware around the chip (shown in the configurator's wiring diagram).
 *
 * Feature folders follow the same split: `firmware/` and `device-ui/` go onto the device,
 * `configurator/` is the web app's.
 */
import type { FeatureDef } from './types';

export interface ServiceKey<T> {
	readonly id: string;
	/** Id of the feature that brings it: only there on chips with it. Omitted: always there. */
	readonly feature?: string;
	create(): T;
}

/** A service, created on first use in each container. */
export function defineService<T>(id: string, create: () => T, feature?: string): ServiceKey<T> {
	return { id, feature, create };
}

/**
 * What a feature's firmware offers the firmware of others, e.g. Wi-Fi's network: nothing to
 * register. A feature that relies on it `use`s it, which makes `feature` one of its requirements.
 */
export function defineFirmwareApi(id: string, feature: string): ServiceKey<object> {
	return defineService(id, () => ({}), feature);
}

export interface Registered<T> {
	/** The feature that registered it. */
	feature: FeatureDef;
	item: T;
}

/** What the active features register, in activation (hook) order. */
export class Registry<T> {
	readonly #entries: Registered<T>[];
	readonly #feature?: FeatureDef;

	constructor(entries: Registered<T>[] = [], feature?: FeatureDef) {
		this.#entries = entries;
		this.#feature = feature;
	}

	register(...items: T[]): void {
		const feature = this.#feature;
		if (!feature) throw new Error('Register while activating a feature');
		this.#entries.push(...items.map((item) => ({ feature, item })));
	}

	/** The same registry, registering for `feature` (what `activate` gets). */
	as(feature: FeatureDef): Registry<T> {
		return new Registry(this.#entries, feature);
	}

	entries(): readonly Registered<T>[] {
		return this.#entries;
	}

	items(): T[] {
		return this.#entries.map((e) => e.item);
	}

	/** What one feature registered. */
	of(featureId: string): T[] {
		return this.#entries.filter((e) => e.feature.id === featureId).map((e) => e.item);
	}
}

/** Definitions by id, e.g. the feature definitions. */
export class Catalog<T extends { id: string }> {
	readonly #byId = new Map<string, T>();

	constructor(readonly kind: string) {}

	register(...defs: T[]): void {
		for (const def of defs) {
			if (this.#byId.has(def.id)) throw new Error(`${this.kind} '${def.id}' registered twice`);
			this.#byId.set(def.id, def);
		}
	}

	all(): T[] {
		return [...this.#byId.values()];
	}

	has(id: string): boolean {
		return this.#byId.has(id);
	}

	find(id: string): T | undefined {
		return this.#byId.get(id);
	}

	get(id: string): T {
		const def = this.#byId.get(id);
		if (!def) throw new Error(`Unknown ${this.kind.toLowerCase()} '${id}'`);
		return def;
	}
}

/** A container of services: the app's, or a chip's (with the ids of its features). */
export class Services {
	readonly #instances = new Map<ServiceKey<unknown>, unknown>();
	readonly #features?: ReadonlySet<string>;

	constructor(features?: Iterable<string>) {
		this.#features = features && new Set(features);
	}

	/** The service, if the feature that brings it is there. */
	find<T>(key: ServiceKey<T>): T | undefined {
		if (key.feature && !this.#features?.has(key.feature)) return undefined;
		if (!this.#instances.has(key)) this.#instances.set(key, key.create());
		return this.#instances.get(key) as T;
	}

	/** The service; throws when the feature that brings it isn't there. */
	get<T>(key: ServiceKey<T>): T {
		const service = this.find(key);
		if (service === undefined)
			throw new Error(`Service '${key.id}' needs feature '${key.feature}'`);
		return service;
	}
}

/** A service as `feature` sees it while activating: registries register for it. */
export function scoped<T>(service: T, feature: FeatureDef): T {
	return service instanceof Registry ? (service.as(feature) as T) : service;
}
