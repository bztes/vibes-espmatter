/**
 * Every plugin, discovered from `plugins/`:
 *
 *   plugins/boards/*.ts                  a board (or an array of boards)
 *   plugins/features/<id>/index.ts       a feature
 *   plugins/peripherals/<id>/index.ts         a peripheral
 *   plugins/external/<repo>/<id>/index.ts  plugins of an external repository (feature or peripheral)
 *
 * A plugin folder may have `firmware/` (C/C++ files it names in `contribute`), `ui/` (Svelte widgets
 * of the device web interface) and `stories.ts` (widget previews for /dev/ui).
 */
import type { BoardDef, FeatureDef, PluginDef, PeripheralDef } from '#sdk';

export type Registered<T> = T & { /** Folder relative to the project root. */ dir: string };

const boardFiles = import.meta.glob<BoardDef | BoardDef[]>(
	['/plugins/boards/*.ts', '/plugins/external/*/boards/*.ts'],
	{ import: 'default', eager: true }
);

const pluginFiles = import.meta.glob<PluginDef>(
	[
		'/plugins/features/*/index.ts',
		'/plugins/peripherals/*/index.ts',
		'/plugins/external/*/*/index.ts'
	],
	{ import: 'default', eager: true }
);

class Catalog<T extends { id: string }> {
	readonly #byId = new Map<string, T>();
	constructor(
		readonly label: string,
		items: T[]
	) {
		for (const item of items) {
			if (this.#byId.has(item.id)) throw new Error(`${label} '${item.id}' is registered twice`);
			this.#byId.set(item.id, item);
		}
	}
	all(): T[] {
		return [...this.#byId.values()];
	}
	has(id: string) {
		return this.#byId.has(id);
	}
	find(id: string): T | undefined {
		return this.#byId.get(id);
	}
	get(id: string): T {
		const item = this.#byId.get(id);
		if (!item) throw new Error(`Unknown ${this.label.toLowerCase()} '${id}'`);
		return item;
	}
}

const dirOf = (file: string) => file.slice(1, file.lastIndexOf('/'));

const plugins = Object.entries(pluginFiles).map(([file, def]) => ({ ...def, dir: dirOf(file) }));

export const boards = new Catalog<BoardDef>(
	'Board',
	Object.values(boardFiles)
		.flat()
		.sort((a, b) => Number(!!a.generic) - Number(!!b.generic) || a.name.localeCompare(b.name))
);

export const features = new Catalog<Registered<FeatureDef>>(
	'Feature',
	plugins.filter((p): p is Registered<FeatureDef> => p.type === 'feature')
);

export const peripherals = new Catalog<Registered<PeripheralDef>>(
	'Peripheral',
	plugins.filter((p): p is Registered<PeripheralDef> => p.type === 'peripheral')
);
