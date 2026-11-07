import { defineFeature } from '#sdk';

export default defineFeature({
	type: 'feature',
	id: 'update-relay',
	name: 'Update relay',
	description:
		'Lets Thread devices – which can’t reach the app themselves – pull firmware updates through the hub. The hub proxies manifests and images from the app and announces itself via DNS-SD.',
	icon: 'refresh-cw',
	kinds: ['hub'],
	needs: ['uplink', 'thread-network'],
	provides: ['update-relay'],
	contribute(_ctx, out) {
		out
			.firmware()
			.source('espm_relay.cpp', 'espm_relay.h')
			.include('"espm_relay.h"')
			.init('network', 'espm_relay_start();');
		out.api(
			{
				method: 'GET',
				path: '/api/v1/relay/devices/*',
				summary: 'Update manifest for a Thread device (proxied to the app)',
				description:
					'`/api/v1/relay/devices/<id>/update?slot=main&version=<n>`: what the app answers for that device, with the image URL rewritten to the relay. The device’s own token is passed on – the hub adds no authority of its own.',
				auth: 'public',
				response: { version: 13, url: 'http://[fd11::1]:80/api/v1/relay/images/<build>/main.bin' }
			},
			{
				method: 'GET',
				path: '/api/v1/relay/devices/*/config.bin',
				summary: 'Configuration of a Thread device, streamed from the app',
				auth: 'public'
			},
			{
				method: 'GET',
				path: '/api/v1/relay/images/*',
				summary: 'Firmware image, streamed from the app',
				auth: 'public'
			},
			{
				method: 'POST',
				path: '/api/v1/relay/devices/*',
				summary: 'Update report of a Thread device (forwarded to the app)',
				auth: 'public'
			},
			{
				method: 'GET',
				path: '/api/v1/relay',
				summary: 'Relay statistics',
				auth: 'token',
				response: { requests: 42, transfers: 3, bytes: 4718592, lastDevice: '6f1c…', lastError: '' }
			}
		);
		out.ui({
			page: 'settings',
			file: 'RelayWidget.svelte',
			title: 'Update relay',
			tab: 'System',
			order: 60
		});
	}
});
