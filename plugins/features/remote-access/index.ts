import { defineFeature } from '#sdk';

export default defineFeature({
	type: 'feature',
	id: 'remote-access',
	name: 'Remote access',
	description:
		'The device’s web interface and REST API at a hostname of its own (e.g. matterhub.espmatter.app), from anywhere – no IP address, no port forwarding. The device keeps a connection to the app, the app passes requests on; login stays the device’s own. Also lets the app ask the device to fetch updates right away.',
	icon: 'globe',
	kinds: ['hub', 'device'],
	defaultOn: ['hub'],
	// The device must reach the app itself: Wi-Fi or Ethernet (not Thread).
	needs: ['uplink'],
	provides: ['remote-access'],
	fields: [
		{
			type: 'boolean',
			key: 'enabled',
			label: 'Connect to the app',
			help: 'Off: this device isn’t reachable through the app (the feature stays in the firmware).',
			default: true,
			perDevice: true
		}
	],
	contribute({ cfg }, out) {
		out
			.firmware()
			.source('espm_remote.cpp', 'espm_remote.h')
			.include('"espm_remote.h"')
			.component('espressif/esp_websocket_client', '^1.4.0')
			.define({ ESPM_REMOTE_ON: cfg('enabled') })
			// The app is usually on the internet: wss:// with the built-in CA bundle.
			.sdkconfig({ CONFIG_MBEDTLS_CERTIFICATE_BUNDLE: true, CONFIG_LWIP_NETIF_LOOPBACK: true })
			.init('started', 'espm_remote_init();')
			.init('network', 'espm_remote_start();');
		out.api({
			method: 'GET',
			path: '/api/v1/remote',
			summary: 'Connection to the app',
			description:
				'Whether the device is connected to the app, which passes requests for its hostname on to it.',
			auth: 'token',
			response: {
				enabled: true,
				connected: true,
				since: 1793880000,
				connects: 3,
				requests: 120,
				failures: 0,
				lastError: ''
			}
		});
	}
});
