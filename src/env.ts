import { defineEnvVars } from '@sveltejs/kit/env';

const optional =
	(fallback: string) =>
	(value: string | undefined): string =>
		value && value.trim() ? value.trim() : fallback;

export const variables = defineEnvVars({
	ORIGIN: {
		description: 'The app origin (base URL), e.g. `http://localhost:5173`.'
	},
	BETTER_AUTH_SECRET: {
		description:
			'Secret used to sign tokens. For production use 32 characters generated with high entropy. See [Better Auth installation](https://www.better-auth.com/docs/installation).'
	},
	DATA_DIR: {
		description:
			'Directory for the database, build workspaces, artifacts and caches. The build workers are set up by an admin in the app (/admin).',
		schema: optional('./data')
	}
});
