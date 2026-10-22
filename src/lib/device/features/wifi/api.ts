import type { DeviceApiRoute } from '../../types';

/** Routes of `espm_wifi.cpp`. */
export const api: DeviceApiRoute[] = [
	{
		method: 'GET',
		path: '/api/wifi/status',
		summary: 'Connection, signal and addresses',
		access: 'admin',
		response: {
			connected: true,
			ssid: 'Home',
			rssi: -54,
			channel: 6,
			ip: '192.168.1.42',
			ip6: ['fe80::1234:56ff:fe78:9abc'],
			mac: '34:85:18:00:11:22'
		}
	},
	{
		method: 'GET',
		path: '/api/wifi',
		summary: 'The saved network and the state of a switch',
		description: '`switch.state`: empty, `connecting`, `connected` or `reverted`.',
		access: 'admin',
		response: { ssid: 'Home', connected: true, switch: { ssid: '', state: '' } }
	},
	{
		method: 'GET',
		path: '/api/wifi/scan',
		summary: 'Networks in range',
		description: 'Strongest first, each name once. Takes a few seconds.',
		access: 'admin',
		response: { networks: [{ ssid: 'Home', rssi: -54, channel: 6, auth: 'WPA2' }] }
	},
	{
		method: 'POST',
		path: '/api/wifi',
		summary: 'Switch to another network',
		description:
			'Tried in the background: without an IP address within `timeout` seconds the device goes back to the previous network. Follow it with `GET /api/wifi`.',
		access: 'admin',
		params: [
			{ name: 'ssid', type: 'string', description: 'Network name (max. 32)', required: true },
			{ name: 'password', type: 'string', description: '8 to 63 characters; empty: open network' }
		],
		response: { ok: true, timeout: 30 }
	}
];
