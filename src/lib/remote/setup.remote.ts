/** The signed-in user's own setup as a file (admins: `exportUserSetup` for anyone). */
import * as v from 'valibot';
import { command } from '$app/server';
import { requireUser } from '#lib/server/auth.ts';
import { exportSetup, importSetup } from '#lib/server/setup.ts';
import { listDevices } from './devices.remote.ts';
import { listFirmwares } from './firmware.remote.ts';
import { listLocations } from './locations.remote.ts';

export const exportMySetup = command(async () => exportSetup(requireUser().id));

export const importMySetup = command(v.unknown(), async (setup) => {
	const counts = await importSetup(requireUser().id, setup);
	void listDevices().refresh();
	void listFirmwares().refresh();
	void listLocations().refresh();
	return counts;
});
