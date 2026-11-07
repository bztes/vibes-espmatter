import { defineFeature } from '#sdk';

export default defineFeature({
	type: 'feature',
	id: 'thread',
	name: 'Thread',
	description:
		'Matter over Thread with the chip’s own 802.15.4 radio. Low power and a mesh network – needs a Thread border router (e.g. a hub with the border router feature).',
	icon: 'waypoints',
	kinds: ['device'],
	group: 'transport',
	requires: { capabilities: ['ieee802154'] },
	provides: ['ip', 'thread', 'matter-transport'],
	fields: [
		{
			type: 'select',
			key: 'role',
			label: 'Thread role',
			default: 'ftd',
			options: [
				{ value: 'ftd', label: 'Router (mains powered)' },
				{ value: 'mtd', label: 'End device (battery friendly)' }
			]
		}
	],
	contribute({ settings }, out) {
		const mtd = settings.role === 'mtd';
		out
			.firmware()
			.include('<platform/ESP32/OpenthreadLauncher.h>')
			.sdkconfig({
				CONFIG_OPENTHREAD_ENABLED: true,
				CONFIG_OPENTHREAD_FTD: !mtd,
				CONFIG_OPENTHREAD_MTD: mtd,
				CONFIG_OPENTHREAD_SRP_CLIENT: true,
				CONFIG_OPENTHREAD_DNS_CLIENT: true,
				CONFIG_OPENTHREAD_CLI: false,
				CONFIG_ENABLE_WIFI_STATION: false,
				CONFIG_ENABLE_WIFI_AP: false,
				CONFIG_USE_MINIMAL_MDNS: false,
				CONFIG_LWIP_IPV6_AUTOCONFIG: false,
				CONFIG_LWIP_IPV6_NUM_ADDRESSES: 8
			})
			.init(
				'early',
				[
					'esp_openthread_platform_config_t ot = {};',
					'ot.radio_config.radio_mode = RADIO_MODE_NATIVE;',
					'ot.host_config.host_connection_mode = HOST_CONNECTION_MODE_NONE;',
					'ot.port_config.storage_partition_name = "nvs";',
					'ot.port_config.netif_queue_size = 10;',
					'ot.port_config.task_queue_size = 10;',
					'set_openthread_platform_config(&ot);'
				].join('\n')
			);
		out.note(
			'Thread devices are paired over Bluetooth; the controller hands over the Thread network.'
		);
	}
});
