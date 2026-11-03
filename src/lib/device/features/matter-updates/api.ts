import type { DeviceApiRoute } from '../../types';

/** Route of `espm_matter_updates.cpp`. */
export const api: DeviceApiRoute[] = [
	{
		method: 'GET',
		path: '/api/matter/updates',
		summary: 'Updates of the paired devices started in the app',
		description:
			'`state`: `requested`, `downloading`, `installing`, `done` or `failed` (see `error`); `age` in seconds since it changed. Updates are started in the vibes-espmatter app, the hub checks it every 5 minutes.',
		access: 'admin',
		response: {
			server: 'https://espmatter.example.com',
			devices: [
				{
					id: 257,
					state: 'downloading',
					version: '2026-11-03 10:23',
					age: 40
				}
			]
		}
	}
];
