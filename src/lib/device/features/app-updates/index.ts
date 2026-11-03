import { firmware, flashMethods } from '../core/services';
import type { FeatureDef } from '../../types';
import { flashMB, OTA_MIN_FLASH_MB } from '../core/index.ts';
import { webServer } from '../http-server/services';
import { devicePanels } from '../web-ui/services';
import { network } from '../wifi/services';
import { appUpdates } from './services';
import { api } from './api';
import AppUpdate from './configurator/AppUpdate.svelte';
import updatesCpp from './firmware/espm_updates.cpp?raw';
import updatesH from './firmware/espm_updates.h?raw';

/**
 * Installs the builds its owner starts in the app (“From the app” on the build page): the device
 * asks every few minutes (`espm_updates.cpp`, `server/updates.ts`), downloads the image itself and
 * restarts. Others reach the app through it too (`appUpdates`). Needs two app slots in flash.
 */
export default {
	id: 'app_updates',
	dir: 'app-updates',
	name: 'Updates from the app',
	description: `Installs new builds from this app (needs ≥ ${OTA_MIN_FLASH_MB} MB flash).`,
	category: 'network',
	chips: ['esp32', 'esp32s3', 'esp32c3', 'esp32c6'],
	otaSlots: true,
	unavailable: (ctx) =>
		flashMB(ctx) < OTA_MIN_FLASH_MB ? `needs at least ${OTA_MIN_FLASH_MB} MB flash` : undefined,
	validate: (ctx) =>
		flashMB(ctx) < OTA_MIN_FLASH_MB
			? [`Updates from the app need at least ${OTA_MIN_FLASH_MB} MB flash (two app slots).`]
			: [],
	activate({ use, find, build }) {
		use(network);
		use(appUpdates);
		use(webServer).register({ api });
		use(flashMethods).register({ id: 'app', title: 'From the app', component: AppUpdate });
		find(devicePanels)?.register({
			id: 'app-updates',
			title: 'Updates from the app',
			file: 'AppUpdatesPanel.svelte',
			area: 'side',
			section: 'system'
		});
		use(firmware).register(() => ({
			defines: {
				MESP_BUILD_VERSION: build?.version ?? 0,
				MESP_UPDATES_URL: build?.updateServer?.url ?? '',
				MESP_UPDATES_TOKEN: build?.updateServer?.token ?? ''
			},
			sources: { 'espm_updates.cpp': updatesCpp, 'espm_updates.h': updatesH },
			hooks: {
				includes: ['#include "espm_updates.h"'],
				postStart: ['mesp_updates_start();']
			},
			notes: [
				build?.updateServer
					? `Updates from the app: start them on the build page (“From the app”) – the device checks ${build.updateServer.url} every 5 minutes.`
					: 'Updates from the app: only builds of a saved device on the build server know the app – this one doesn’t.'
			]
		}));
	}
} satisfies FeatureDef;
