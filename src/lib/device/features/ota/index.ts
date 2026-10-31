import { firmware, flashMethods } from '../core/services';
import type { FeatureDef } from '../../types';
import { flashMB, OTA_MIN_FLASH_MB } from '../core/index.ts';
import { webServer } from '../http-server/services';
import { devicePanels } from '../web-ui/services';
import { api } from './api';
import Flash from './configurator/Flash.svelte';
import otaCpp from './firmware/espm_ota.cpp?raw';

/**
 * Over-the-air updates: the HTTP server accepts a new app image from an admin (`POST /api/ota`)
 * and boots it. Needs two app slots in flash (`otaSlots`, the partition table of `device`).
 */
export default {
	id: 'ota',
	dir: 'ota',
	name: 'Over-the-air updates',
	description: `Firmware updates over the network (needs ≥ ${OTA_MIN_FLASH_MB} MB flash).`,
	category: 'core',
	otaSlots: true,
	unavailable: (ctx) =>
		flashMB(ctx) < OTA_MIN_FLASH_MB ? `needs at least ${OTA_MIN_FLASH_MB} MB flash` : undefined,
	validate: (ctx) =>
		flashMB(ctx) < OTA_MIN_FLASH_MB
			? [`Over-the-air updates need at least ${OTA_MIN_FLASH_MB} MB flash (two app slots).`]
			: [],
	activate({ use, find }) {
		use(flashMethods).register({ id: 'ota', title: 'OTA', component: Flash });
		use(webServer).register({ api });
		use(firmware).register(() => ({
			defines: { MESP_OTA: true },
			sources: { 'espm_ota.cpp': otaCpp },
			hooks: {
				globals: ['void mesp_ota_register_web();'],
				postStart: ['mesp_ota_register_web();']
			}
		}));
		find(devicePanels)?.register({
			id: 'ota',
			title: 'Firmware update',
			file: 'OtaPanel.svelte',
			area: 'side',
			section: 'system'
		});
	}
} satisfies FeatureDef;
