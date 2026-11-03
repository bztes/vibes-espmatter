import { firmware } from '../core/services';
import type { FeatureDef } from '../../types';
import { webServer } from '../http-server/services';
import { devicePanels } from '../web-ui/services';
import { matterController } from '../matter-controller/services';
import { appUpdates } from '../app-updates/services';
import { api } from './api';
import updatesCpp from './firmware/espm_matter_updates.cpp?raw';

/**
 * Installs the builds their owner starts in the app (“Over Matter”) on the paired devices with
 * “Updates over Matter” (`matter_ota`): the hub asks the app every few minutes, is their OTA
 * provider and streams the image through, so it needs no room for it. It reaches the app like its
 * own updates from the app do (`app_updates`: address and token).
 */
export default {
	id: 'matter_updates',
	dir: 'matter-updates',
	name: 'Matter updates',
	description: 'Installs new builds from this app on the paired devices.',
	category: 'matter',
	chips: ['esp32', 'esp32s3', 'esp32c3', 'esp32c6'],
	activate({ use, find }) {
		use(matterController);
		use(appUpdates);
		use(webServer).register({ api });
		use(firmware).register(() => ({
			sdkconfig: {
				// The OTA provider cluster and BDX sender, which espm_matter_updates.cpp serves itself.
				CONFIG_CHIP_DEVICE_ENABLE_DYNAMIC_SERVER: true,
				CONFIG_ESP_MATTER_OTA_PROVIDER_ENABLED: true,
				CONFIG_ESP_MATTER_OTA_CANDIDATES_UPDATE_PERIODICALLY: false
			},
			// esp-matter compiles the dynamic server without CHIP's stand-in for the generated endpoint config.
			compileOptions: [
				'-I${CMAKE_SOURCE_DIR}/managed_components/espressif__esp_matter/connectedhomeip/connectedhomeip/src/app/dynamic_server/mock_includes'
			],
			sources: { 'espm_matter_updates.cpp': updatesCpp },
			hooks: {
				globals: ['void mesp_matter_updates_start();', 'void mesp_matter_updates_register_web();'],
				postStart: ['mesp_matter_updates_start();', 'mesp_matter_updates_register_web();']
			}
		}));
		find(devicePanels)?.register({
			id: 'matter-updates',
			title: 'Device updates',
			file: 'UpdatesPanel.svelte',
			area: 'main',
			section: 'devices'
		});
	}
} satisfies FeatureDef;
