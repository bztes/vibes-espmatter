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
	IDF_PATH: {
		description: 'Path to the ESP-IDF checkout that compiles the firmware.',
		schema: optional('')
	},
	IDF_PYTHON: {
		description:
			'Optional python interpreter the ESP-IDF environment was installed with (put first on PATH before sourcing export.sh).',
		schema: optional('')
	},
	DATA_DIR: {
		description: 'Directory for the database, build workspaces, artifacts and caches.',
		schema: optional('./data')
	},
	MAX_WORKSPACES: {
		description: 'How many build workspaces (≈1–2 GB each) are kept for fast incremental rebuilds.',
		schema: count('MAX_WORKSPACES', 4, 1)
	}
});

function count(name: string, fallback: number, min: number) {
	return (value: string | undefined): number => {
		const n = value?.trim() ? Number(value) : fallback;
		if (!Number.isInteger(n) || n < min) throw new Error(`${name} must be an integer ≥ ${min}`);
		return n;
	};
}
