import type { DeviceApiRoute } from '../../types';

/** Route of `espm_ota.cpp`. */
export const api: DeviceApiRoute[] = [
	{
		method: 'POST',
		path: '/api/ota',
		summary: 'Install a new firmware',
		description:
			'Writes the app image to the other app slot, boots from it and restarts. Admins may use HTTP Basic auth, e.g. `curl -u admin --data-binary @firmware.bin http://<device>/api/ota`.',
		access: 'admin',
		rawBody: {
			type: 'application/octet-stream',
			description: 'The app image (`build/<project>.bin`), not the merged flash image'
		},
		response: { ok: true }
	}
];
