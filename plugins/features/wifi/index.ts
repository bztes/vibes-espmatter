import { CExpr, defineFeature } from '#sdk';

export default defineFeature({
	type: 'feature',
	id: 'wifi',
	name: 'Wi-Fi',
	description:
		'Connects to your Wi-Fi. Without credentials here, the network is handed over by the Matter controller while pairing.',
	icon: 'wifi',
	kinds: ['hub', 'device'],
	defaultOn: ['hub', 'device'],
	group: 'transport',
	requires: { capabilities: ['wifi'] },
	provides: ['ip', 'uplink', 'wifi', 'matter-transport'],
	fields: [
		{
			type: 'text',
			key: 'ssid',
			label: 'Network name (SSID)',
			default: '',
			maxLength: 32,
			help: 'Leave empty to provision Wi-Fi while pairing.',
			perDevice: true
		},
		{
			type: 'text',
			key: 'password',
			label: 'Password',
			default: '',
			maxLength: 63,
			secret: true,
			when: (s) => !!s.ssid,
			perDevice: true
		},
		{
			type: 'select',
			key: 'powerSave',
			label: 'Power saving',
			default: 'min',
			options: [
				{ value: 'none', label: 'Off (lowest latency)' },
				{ value: 'min', label: 'Modem sleep (default)' }
			],
			advanced: true,
			perDevice: true
		}
	],
	validate({ settings, device }) {
		const issues = [];
		const pw = String(settings.password);
		if (settings.ssid && pw.length > 0 && pw.length < 8)
			issues.push({
				severity: 'error' as const,
				field: 'password',
				message: 'Wi-Fi password: at least 8 characters (WPA2).'
			});
		if (device.kind === 'hub' && !settings.ssid)
			issues.push({
				severity: 'warning' as const,
				field: 'ssid',
				message:
					'A hub has nobody to hand it the Wi-Fi: enter the network here (or pair it from a phone first).'
			});
		return issues;
	},
	contribute({ cfg }, out) {
		out
			.firmware()
			.source('espm_wifi.cpp', 'espm_wifi.h')
			.include('"espm_wifi.h"')
			.define({
				ESPM_WIFI_SSID: cfg('ssid'),
				ESPM_WIFI_PASSWORD: cfg('password'),
				ESPM_WIFI_PS_NONE: new CExpr(`strcmp(${cfg('powerSave')}, "none") == 0`)
			})
			.sdkconfig({
				CONFIG_ENABLE_WIFI_STATION: true,
				// Matter runs over Wi-Fi. OpenThread itself stays untouched: a hub may run a
				// Thread border router next to Wi-Fi (thread-border-router enables it).
				CONFIG_ENABLE_MATTER_OVER_THREAD: false
			})
			.init('started', 'espm_wifi_start();');
		out.api(
			{
				method: 'GET',
				path: '/api/v1/wifi',
				summary: 'Connection and signal',
				auth: 'token',
				response: {
					connected: true,
					ssid: 'Home',
					rssi: -58,
					channel: 6,
					ip: '192.168.1.42',
					mac: '34:85:18:00:11:22'
				}
			},
			{
				method: 'GET',
				path: '/api/v1/wifi/scan',
				summary: 'Networks in range',
				description: 'Takes about 3 seconds.',
				auth: 'token',
				response: { networks: [{ ssid: 'Home', rssi: -54, channel: 6, secure: true }] }
			},
			{
				method: 'POST',
				path: '/api/v1/wifi',
				summary: 'Switch to another network',
				description:
					'Saved and applied right away; the device is unreachable until it got an address in the new network.',
				auth: 'token',
				params: [
					{ name: 'ssid', type: 'string', description: 'Network name', required: true, in: 'body' },
					{ name: 'password', type: 'string', description: 'Empty for open networks', in: 'body' }
				],
				response: { ok: true }
			}
		);
		out.ui({
			page: 'settings',
			file: 'WifiWidget.svelte',
			title: 'Wi-Fi',
			tab: 'Network',
			order: 20
		});
	}
});
