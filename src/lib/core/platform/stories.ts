import type { Story } from '#sdk/device-ui';
import MatterWidget from './ui/MatterWidget.svelte';
import SystemWidget from './ui/SystemWidget.svelte';
import UpdatesWidget from './ui/UpdatesWidget.svelte';

const system = {
	uptime: 93784,
	resetReason: 'software',
	heap: { free: 84512, min: 61200 },
	psram: { free: 2015232 },
	network: { ip: '192.168.1.42', rssi: -61 }
};

export default [
	{
		name: 'System',
		page: 'settings',
		component: SystemWidget,
		tab: 'System',
		api: { '/api/v1/system': system }
	},
	{
		name: 'Firmware',
		page: 'settings',
		component: UpdatesWidget,
		tab: 'System',
		props: { canPull: true },
		api: {
			'/api/v1/ota': {
				version: 12,
				config: '3fa9c01b2d44',
				pull: true,
				partition: 'ota_1',
				state: 'idle',
				lastCheck: 1730707200,
				lastCheckAgo: 1260,
				lastError: ''
			}
		}
	},
	{
		name: 'Firmware (update failed)',
		page: 'settings',
		component: UpdatesWidget,
		tab: 'System',
		props: { canPull: true },
		api: {
			'/api/v1/ota': {
				version: 11,
				config: '3fa9c01b2d44',
				pull: false,
				partition: 'ota_0',
				state: 'failed',
				lastCheck: 0,
				lastError: 'ESP_ERR_OTA_VALIDATE_FAILED'
			}
		}
	},
	{
		name: 'Matter (paired)',
		page: 'settings',
		component: MatterWidget,
		tab: 'Matter',
		api: {
			'/api/v1/matter': {
				commissioned: true,
				fabrics: 2,
				windowOpen: false,
				qr: 'MT:Y.K9042C00KA0648G00',
				manualCode: '34970112332'
			}
		}
	},
	{
		name: 'Matter (not paired)',
		page: 'settings',
		component: MatterWidget,
		tab: 'Matter',
		api: {
			'/api/v1/matter': {
				commissioned: false,
				fabrics: 0,
				windowOpen: true,
				qr: 'MT:Y.K9042C00KA0648G00',
				manualCode: '34970112332'
			}
		}
	}
] satisfies Story[];
