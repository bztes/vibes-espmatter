import { firmware } from '../core/services';
import type { FeatureDef } from '../../types';
import { matterNode } from '../matter-device/services';

/**
 * Matter over Thread with the chip's own 802.15.4 radio, instead of Wi-Fi. No settings: the
 * controller hands over the Thread network when it pairs the device (over BLE).
 */
export default {
	id: 'thread',
	dir: 'thread',
	name: 'Thread',
	description: 'Joins a Thread network (needs a Thread border router).',
	category: 'network',
	framework: 'esp-matter',
	chips: ['esp32h2', 'esp32c6'],
	validate: ({ has }) => (has('wifi') ? ['A Matter device uses Wi-Fi or Thread, not both.'] : []),
	activate({ use }) {
		use(matterNode);
		// Based on esp-matter examples/light/sdkconfig.defaults.esp32h2
		use(firmware).register(() => ({
			sdkconfig: {
				CONFIG_OPENTHREAD_ENABLED: true,
				CONFIG_OPENTHREAD_SRP_CLIENT: true,
				CONFIG_OPENTHREAD_DNS_CLIENT: true,
				CONFIG_OPENTHREAD_CLI: false,
				CONFIG_OPENTHREAD_LOG_LEVEL_DYNAMIC: false,
				CONFIG_OPENTHREAD_LOG_LEVEL_NOTE: true,
				CONFIG_ENABLE_WIFI_STATION: false,
				CONFIG_ENABLE_WIFI_AP: false,
				// OpenThread assigns the addresses; its SRP client publishes the device instead of mDNS.
				CONFIG_LWIP_IPV6_AUTOCONFIG: false,
				CONFIG_LWIP_IPV6_NUM_ADDRESSES: 8,
				CONFIG_LWIP_MULTICAST_PING: true,
				CONFIG_USE_MINIMAL_MDNS: false
			},
			hooks: {
				includes: ['#include <platform/ESP32/OpenthreadLauncher.h>'],
				preStart: [
					'esp_openthread_platform_config_t ot_config = {};',
					'ot_config.radio_config.radio_mode = RADIO_MODE_NATIVE;',
					'ot_config.host_config.host_connection_mode = HOST_CONNECTION_MODE_NONE;',
					'ot_config.port_config.storage_partition_name = "nvs";',
					'ot_config.port_config.netif_queue_size = 10;',
					'ot_config.port_config.task_queue_size = 10;',
					'set_openthread_platform_config(&ot_config);'
				]
			}
		}));
	}
} satisfies FeatureDef;
