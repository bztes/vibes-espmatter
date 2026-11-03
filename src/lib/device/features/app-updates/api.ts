import type { DeviceApiRoute } from '../../types';

/** Routes of `espm_updates.cpp`. */
export const api: DeviceApiRoute[] = [
	{
		method: 'GET',
		path: '/api/updates/server',
		summary: 'The app updates come from',
		description:
			'Every 5 minutes the device asks it for an update its owner started there, installs it and restarts.',
		access: 'admin',
		response: { server: 'https://espmatter.example.com', hasToken: true }
	},
	{
		method: 'POST',
		path: '/api/updates/server',
		summary: 'Set the app’s address and the device’s token',
		access: 'admin',
		params: [
			{ name: 'server', type: 'string', description: 'Base URL of the vibes-espmatter app' },
			{ name: 'token', type: 'string', description: 'The device’s token; left out: unchanged' }
		],
		response: { ok: true }
	}
];
