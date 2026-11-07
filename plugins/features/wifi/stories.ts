import type { Story } from '#sdk/device-ui';
import WifiWidget from './ui/WifiWidget.svelte';

const api = {
	'/api/v1/wifi': {
		connected: true,
		ssid: 'Home',
		rssi: -58,
		channel: 6,
		ip: '192.168.1.42',
		mac: '34:85:18:00:11:22'
	},
	'/api/v1/wifi/scan': {
		networks: [
			{ ssid: 'Home', rssi: -58, channel: 6, secure: true },
			{ ssid: 'Garden', rssi: -71, channel: 11, secure: true },
			{ ssid: 'Café', rssi: -83, channel: 1, secure: false }
		]
	}
};

export default [
	{ name: 'Connected', page: 'settings', component: WifiWidget, tab: 'Network', api },
	{
		name: 'Offline',
		page: 'settings',
		component: WifiWidget,
		tab: 'Network',
		api: { ...api, '/api/v1/wifi': { connected: false, ip: '', mac: '34:85:18:00:11:22' } }
	}
] satisfies Story[];
