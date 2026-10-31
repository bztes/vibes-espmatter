import type { Story } from '../../stories';
import type { SystemStatus } from '../web-ui/device-ui/types';
import SystemPanel from './device-ui/SystemPanel.svelte';
import UsersPanel from './device-ui/UsersPanel.svelte';

const status: SystemStatus = {
	name: 'Matter Hub',
	deviceType: 'Matter Thread Hub',
	firmware: '1.4.0',
	buildId: 'a1b2c3d4',
	compiled: 'Oct 31 2026 12:00:00',
	idf: 'v5.4.1',
	chip: 'ESP32-S3',
	chipRevision: 2,
	cores: 2,
	uptime: 93_784,
	resetReason: 'Power on',
	heapFree: 182_000,
	heapMin: 141_000,
	psramFree: 7_800_000,
	partition: 'ota_0',
	flash: {
		size: 8 * 1024 * 1024,
		app: 2_150_000,
		appPartition: 3 * 1024 * 1024,
		nvsUsed: 410,
		nvsTotal: 756
	}
};

export const api = {
	'/api/status': status,
	'/api/users': {
		me: 'admin',
		max: 8,
		users: [
			{ name: 'admin', role: 'admin', mustChangePassword: false },
			{ name: 'anna', role: 'user', mustChangePassword: false },
			{ name: 'ben', role: 'user', mustChangePassword: true }
		]
	}
};

export default [
	{ name: 'System', component: SystemPanel, api },
	{ name: 'Users', component: UsersPanel, api }
] satisfies Story[];
