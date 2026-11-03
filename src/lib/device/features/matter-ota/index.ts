import { firmware, flashMethods } from '../core/services';
import type { FeatureDef } from '../../types';
import { flashMB, OTA_MIN_FLASH_MB } from '../core/index.ts';
import { updateId, versionString } from '../../util';
import { matterNode } from '../matter-device/services';
import MatterUpdate from './configurator/MatterUpdate.svelte';

/**
 * Updates over Matter: the device downloads new firmware from an OTA provider in its fabric – a hub
 * with Matter updates (`matter_updates`), which installs the builds its owner starts in the app
 * (“Over Matter” on the build page). Works over Thread too. Only server builds of a saved device
 * can be updated: they carry its id and version.
 */
export default {
	id: 'matter_ota',
	dir: 'matter-ota',
	name: 'Updates over Matter',
	description: `Firmware updates from a hub, also over Thread (needs ≥ ${OTA_MIN_FLASH_MB} MB flash).`,
	category: 'matter',
	otaSlots: true,
	unavailable: (ctx) =>
		flashMB(ctx) < OTA_MIN_FLASH_MB ? `needs at least ${OTA_MIN_FLASH_MB} MB flash` : undefined,
	validate: (ctx) =>
		flashMB(ctx) < OTA_MIN_FLASH_MB
			? [`Updates over Matter need at least ${OTA_MIN_FLASH_MB} MB flash (two app slots).`]
			: [],
	activate({ use, build, role }) {
		use(matterNode);
		use(flashMethods).register({ id: 'matter', title: 'Over Matter', component: MatterUpdate });
		use(firmware).register(() => {
			const id = build?.projectId ? updateId(build.projectId, role.id) : '';
			return {
				sdkconfig: {
					CONFIG_ENABLE_OTA_REQUESTOR: true,
					CONFIG_DEVICE_SOFTWARE_VERSION_NUMBER: build?.version ?? 1
				},
				defines: { MESP_UPDATE_ID: id },
				hooks: {
					includes: ['#include <platform/CHIPDeviceLayer.h>'],
					// A UniqueID of its own until then, which no server knows.
					preStart: id
						? [
								'char unique_id[33] = {};',
								'auto &config = chip::DeviceLayer::ConfigurationMgr();',
								'if (config.GetUniqueId(unique_id, sizeof(unique_id)) != CHIP_NO_ERROR ||',
								'    strcmp(unique_id, MESP_UPDATE_ID) != 0)',
								'    config.StoreUniqueId(MESP_UPDATE_ID, strlen(MESP_UPDATE_ID));'
							]
						: []
				},
				notes: [
					id
						? `Updates over Matter: version ${versionString(build!.version)}. Start them on the build page (“Over Matter”): the hub with “Matter updates” installs them.`
						: 'Updates over Matter: only builds of a saved device on the build server can be updated – this one can’t.'
				]
			};
		});
	}
} satisfies FeatureDef;
