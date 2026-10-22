import { Catalog, defineService, Services } from './services';
import type { BoardDef, FeatureDef, TemplateDef } from './types';

/** The app-wide services (`services.ts`). */
export const app = new Services();

/** All boards: one file per board in `boards/`. */
export const boards = app.get(defineService('boardDefs', () => new Catalog<BoardDef>('Board')));
boards.register(
	...Object.values(import.meta.glob<BoardDef>('./boards/*.ts', { import: 'default', eager: true }))
);

/**
 * All features: one folder per feature in `features/`. Their hooks run after those of the
 * features they require, otherwise in registration order (by folder name).
 */
export const features = app.get(
	defineService('featureDefs', () => new Catalog<FeatureDef>('Feature'))
);
features.register(
	...Object.values(
		import.meta.glob<FeatureDef>('./features/*/index.ts', { import: 'default', eager: true })
	)
);

/** Ready-made devices offered when creating a new device: one file per template in `templates/`. */
export const templates = app.get(
	defineService('templateDefs', () => new Catalog<TemplateDef>('Template'))
);
templates.register(
	...Object.values(
		import.meta.glob<TemplateDef>('./templates/*.ts', { import: 'default', eager: true })
	)
);
