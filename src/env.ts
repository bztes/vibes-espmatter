import { defineEnvVars } from '@sveltejs/kit/env';

const optional =
	(fallback: string) =>
	(value: string | undefined): string =>
		value && value.trim() ? value.trim() : fallback;

export const variables = defineEnvVars({
	DATA_DIR: {
		description:
			'Directory for the SQLite database, build workspaces and firmware artifacts. Default `./data`.',
		schema: optional('./data')
	}
});
