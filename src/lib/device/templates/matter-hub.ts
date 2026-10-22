import type { TemplateDef } from '../types';

/**
 * Matter hub = "coordinator": an ESP32-S3 (Wi-Fi, BLE, Matter controller, Thread border
 * router) plus an ESP32-H2 acting as the Thread radio. Thread devices join the hub's Thread
 * network and are commissioned into the hub's Matter fabric.
 *
 * Chip ids (`host`, `radio`) are part of saved configurations and build artifacts – keep them.
 */
export default {
	id: 'matter-hub',
	name: 'Matter Thread Hub',
	tagline: 'Thread border router + Matter controller',
	description:
		'A coordinator for your Matter devices. The host board connects to Wi-Fi, runs an OpenThread border router and a Matter commissioner; a second board with an 802.15.4 radio provides the Thread interface. Pair Thread and Wi-Fi Matter devices from the hub’s own web interface.',
	chips: [
		{
			id: 'host',
			name: 'Host',
			board: 'esp32-s3-devkitc-1',
			features: {
				wifi: {},
				thread_br: {},
				matter_controller: {},
				http_server: {},
				web_ui: {},
				ota: {},
				admin_dashboard: {},
				user_dashboard: {},
				timers: {},
				scenes: {},
				automations: {}
			}
		},
		{
			id: 'radio',
			name: 'Thread radio',
			board: 'esp32-h2-supermini',
			features: { openthread_rcp: {} }
		}
	]
} satisfies TemplateDef;
