import type { Story } from '../../stories';
import WifiBadge from './device-ui/WifiBadge.svelte';
import WifiPanel from './device-ui/WifiPanel.svelte';
import type { WifiStatus } from './device-ui/wifi';

const connected: WifiStatus = {
	connected: true,
	ssid: 'Home',
	rssi: -58,
	channel: 6,
	ip: '192.168.1.42',
	ip6: ['fe80::1234:56ff:fe78:9abc'],
	mac: '24:6f:28:aa:bb:cc'
};

export const api = {
	'/api/wifi/status': connected,
	'/api/wifi': { ssid: 'Home', connected: true, switch: { ssid: '', state: '' } },
	'/api/wifi/scan': {
		networks: [
			{ ssid: 'Home', rssi: -58, channel: 6, auth: 'wpa2' },
			{ ssid: 'Neighbour', rssi: -81, channel: 11, auth: 'wpa3' },
			{ ssid: 'Café', rssi: -74, channel: 1, auth: 'open' }
		]
	},
	'POST /api/wifi': { timeout: 30 }
};

export default [
	{ name: 'Panel', component: WifiPanel, api },
	{ name: 'Panel (user)', component: WifiPanel, api, session: { user: 'anna', role: 'user' } },
	{
		name: 'Panel (offline)',
		component: WifiPanel,
		api: { ...api, '/api/wifi/status': { connected: false } }
	},
	{ name: 'Badge', component: WifiBadge, api },
	{
		name: 'Badge (offline)',
		component: WifiBadge,
		api: { '/api/wifi/status': { connected: false } }
	}
] satisfies Story[];
