import { defineFeature } from '#sdk';

const RCP_BAUD = 460800;

export default defineFeature({
	type: 'feature',
	id: 'thread-border-router',
	name: 'Thread border router',
	description:
		'Runs a Thread network for Thread devices and routes it to your LAN. Uses a second board with an 802.15.4 radio (ESP32-H2 or -C6) as radio co-processor over UART.',
	icon: 'radio-tower',
	kinds: ['hub'],
	needs: ['uplink'],
	provides: ['thread-network'],
	slots: [
		{
			id: 'radio',
			name: 'Thread radio (RCP)',
			description: 'Runs OpenThread’s radio co-processor firmware.',
			requires: { capabilities: ['ieee802154'] },
			defaultBoard: 'esp32-h2-supermini',
			flashFirst: true,
			// After a first USB flash, the hub installs the radio's firmware over the wires.
			flashOverWire: {
				hostTx: 'hostTx',
				hostRx: 'hostRx',
				slotTx: 'radioTx',
				slotRx: 'radioRx',
				hostTrigger: 'hostTrigger',
				slotTrigger: 'radioTrigger'
			}
		}
	],
	fields: [
		{
			type: 'gpio',
			key: 'hostTx',
			label: 'Main board UART TX (to radio RX)',
			use: 'output',
			role: 'uart-tx',
			// Espressif's Thread border router wiring on the S3: TX 18, RX 17.
			prefer: { esp32s3: 18 },
			default: -1
		},
		{
			type: 'gpio',
			key: 'hostRx',
			label: 'Main board UART RX (from radio TX)',
			use: 'input',
			role: 'uart-rx',
			prefer: { esp32s3: 17 },
			default: -1
		},
		{
			type: 'gpio',
			key: 'hostTrigger',
			label: 'Main board update trigger (to the radio)',
			help: 'Held low, the radio restarts into download mode and the hub installs its firmware.',
			use: 'output',
			default: -1
		},
		{
			type: 'gpio',
			key: 'radioTx',
			label: 'Radio UART TX (its UART0 TX)',
			use: 'output',
			role: 'uart-tx',
			slot: 'radio',
			default: -1
		},
		{
			type: 'gpio',
			key: 'radioRx',
			label: 'Radio UART RX (its UART0 RX)',
			use: 'input',
			role: 'uart-rx',
			slot: 'radio',
			default: -1
		},
		{
			type: 'gpio',
			key: 'radioTrigger',
			label: 'Radio update trigger input',
			help: 'Best the radio’s BOOT pin if its header has one: then a radio with broken firmware can still be recovered (hold BOOT while powering up, then “flash again”).',
			use: 'input',
			// Suggests the board's BOOT button pin.
			role: 'button',
			slot: 'radio',
			default: -1
		},
		{
			type: 'text',
			key: 'networkName',
			label: 'Thread network name',
			default: 'espmatter',
			required: true,
			maxLength: 16,
			perDevice: true
		},
		{
			type: 'number',
			key: 'channel',
			label: 'Channel',
			default: 0,
			min: 0,
			max: 26,
			integer: true,
			help: '0 = pick automatically (11–26).',
			perDevice: true
		},
		{
			type: 'boolean',
			key: 'autoForm',
			label: 'Form a network automatically on first boot',
			default: true,
			advanced: true,
			perDevice: true
		}
	],
	validate({ settings, chip }) {
		const issues = [];
		const ch = Number(settings.channel);
		if (ch !== 0 && (ch < 11 || ch > 26))
			issues.push({
				severity: 'error' as const,
				field: 'channel',
				message: 'Thread channel must be 0 (auto) or 11–26.'
			});
		if (chip().capabilities.includes('ieee802154'))
			issues.push({
				severity: 'info' as const,
				message: `The ${chip().name} has its own 802.15.4 radio, but sharing it with Wi-Fi hurts both – a separate radio board is used.`
			});
		return issues;
	},
	contribute({ settings, cfg }, out) {
		out
			.firmware()
			.source('espm_otbr.cpp', 'espm_otbr.h', 'espm_otbr.lf')
			.include('"espm_otbr.h"')
			.define({
				ESPM_OTBR_TX: Number(settings.hostTx),
				ESPM_OTBR_RX: Number(settings.hostRx),
				ESPM_OTBR_BAUD: RCP_BAUD,
				ESPM_OTBR_NETWORK_NAME: cfg('networkName'),
				ESPM_OTBR_CHANNEL: cfg('channel'),
				ESPM_OTBR_AUTO_FORM: cfg('autoForm')
			})
			.sdkconfig({
				CONFIG_OPENTHREAD_ENABLED: true,
				CONFIG_OPENTHREAD_BORDER_ROUTER: true,
				CONFIG_OPENTHREAD_RADIO_SPINEL_UART: true,
				CONFIG_ESP_MATTER_ENABLE_OPENTHREAD: false,
				CONFIG_ENABLE_MATTER_OVER_THREAD: false,
				CONFIG_LWIP_IPV6_FORWARD: true,
				CONFIG_LWIP_IPV6_NUM_ADDRESSES: 12,
				CONFIG_LWIP_NETIF_STATUS_CALLBACK: true,
				CONFIG_LWIP_HOOK_IP6_ROUTE_DEFAULT: true,
				CONFIG_LWIP_HOOK_ND6_GET_GW_DEFAULT: true,
				// connectedhomeip's own route hook (on by default with the two hooks above) defines
				// lwip_hook_ip6_route/nd6_get_gw a second time – OpenThread's border router routes.
				CONFIG_ENABLE_ROUTE_HOOK: false,
				CONFIG_MBEDTLS_KEY_EXCHANGE_ECJPAKE: true,
				CONFIG_MBEDTLS_ECJPAKE_C: true,
				CONFIG_MBEDTLS_SSL_PROTO_DTLS: true,
				CONFIG_USE_MINIMAL_MDNS: false,
				CONFIG_MDNS_MULTIPLE_INSTANCE: true,
				CONFIG_MDNS_MAX_SERVICES: 64
			})
			.component('espressif/mdns', '^1.8.0')
			.init('network', 'espm_otbr_start();');

		out
			.firmware('radio')
			.source('espm_rcp.c', 'espm_rcp.h')
			.include('"espm_rcp.h"')
			.define({
				ESPM_RCP_TX: Number(settings.radioTx),
				ESPM_RCP_RX: Number(settings.radioRx),
				ESPM_RCP_BAUD: RCP_BAUD
			})
			.sdkconfig({
				CONFIG_OPENTHREAD_ENABLED: true,
				CONFIG_OPENTHREAD_RADIO: true,
				CONFIG_OPENTHREAD_RCP_UART: true,
				CONFIG_OPENTHREAD_CLI: false,
				CONFIG_OPENTHREAD_BORDER_ROUTER: false,
				CONFIG_OPENTHREAD_LOG_LEVEL_DYNAMIC: false,
				CONFIG_OPENTHREAD_LOG_LEVEL_NONE: true,
				CONFIG_LOG_DEFAULT_LEVEL_NONE: true,
				CONFIG_ESP_SYSTEM_PANIC_SILENT_REBOOT: true
			})
			.init('started', 'espm_rcp_start();');

		out.wire(
			{
				from: { node: 'slot:main', pin: `gpio:${settings.hostTx}` },
				to: { node: 'slot:radio', pin: `gpio:${settings.radioRx}` },
				label: 'UART main TX → radio RX',
				color: '#f59e0b'
			},
			{
				from: { node: 'slot:main', pin: `gpio:${settings.hostRx}` },
				to: { node: 'slot:radio', pin: `gpio:${settings.radioTx}` },
				label: 'UART main RX ← radio TX',
				color: '#3b82f6'
			},
			{
				from: { node: 'slot:main', pin: 'GND' },
				to: { node: 'slot:radio', pin: 'GND' },
				label: 'Ground',
				color: '#64748b'
			},
			{
				from: { node: 'slot:main', pin: '3V3' },
				to: { node: 'slot:radio', pin: '3V3' },
				label: '3.3 V (unplug while the radio has its own USB cable)',
				color: '#ef4444'
			}
		);
		out.api(
			{
				method: 'GET',
				path: '/api/v1/thread',
				summary: 'Thread network state',
				auth: 'token',
				response: {
					role: 'leader',
					networkName: 'espmatter',
					channel: 15,
					panId: '0x1a2b',
					extPanId: 'dead00beef00cafe',
					children: 4,
					routers: 2,
					rcp: 'ok'
				}
			},
			{
				method: 'GET',
				path: '/api/v1/thread/dataset',
				summary: 'Active operational dataset (TLV hex) – to join other border routers',
				auth: 'token',
				response: { tlvs: '0e080000000000010000…' }
			},
			{
				method: 'POST',
				path: '/api/v1/thread/form',
				summary: 'Form a new network (replaces the current one!)',
				auth: 'token',
				params: [
					{ name: 'channel', type: 'number', description: '11–26, default auto', in: 'body' }
				],
				response: { ok: true }
			}
		);
		out.ui({
			page: 'settings',
			file: 'ThreadWidget.svelte',
			title: 'Thread network',
			tab: 'Network',
			order: 25
		});
	}
});
