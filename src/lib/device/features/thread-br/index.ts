import { configuratorEditors, firmware, wires } from '../core/services';
import type { FeatureDef, BoardDef, FeatureIssue, Validate } from '../../types';
import { deviceApi } from '../http-server/services';
import { devicePanels } from '../web-ui/services';
import { api } from './api';
import Editor from './configurator/Editor.svelte';
import threadCpp from './firmware/espm_thread.cpp?raw';
import threadH from './firmware/espm_thread.h?raw';
import { network } from '../wifi/services';

export const RCP_BAUD = 460800;

const defaults = (board: BoardDef) => {
	const supermini = board.id === 'esp32-s3-supermini';
	return {
		rxGpio: supermini ? 4 : 17,
		txGpio: supermini ? 5 : 18,
		autoForm: true,
		networkName: 'vibes-espmatter',
		channel: 0
	};
};
export type ThreadBrConfig = ReturnType<typeof defaults>;

const validate: Validate<ThreadBrConfig> = ({ config, chipsWith }) => {
	const networkName = String(config.networkName);
	const errors: FeatureIssue<ThreadBrConfig>[] = [];
	if (!networkName.trim())
		errors.push({ field: 'networkName', message: 'Thread network name is required.' });
	else if (networkName.length > 16)
		errors.push({
			field: 'networkName',
			message: 'Thread network name must be at most 16 characters.'
		});
	const ch = Number(config.channel);
	if (ch !== 0 && (ch < 11 || ch > 26))
		errors.push({ field: 'channel', message: 'Thread channel must be 0 (auto) or 11–26.' });
	if (config.rxGpio === config.txGpio)
		errors.push({ field: 'txGpio', message: 'UART RX and TX must be different pins.' });
	if (chipsWith('openthread_rcp').length === 0) {
		errors.push(
			'Needs a second board with the “Thread radio (RCP)” feature (e.g. an ESP32-H2) as its 802.15.4 radio.'
		);
	}
	return errors;
};

/**
 * OpenThread Border Router on the host chip, talking Spinel over UART to an external
 * 802.15.4 radio (RCP, e.g. an ESP32-H2 running the `openthread_rcp` feature).
 */
export default {
	id: 'thread_br',
	dir: 'thread-br',
	name: 'Thread border router',
	description: 'Bridges a Thread network to Wi-Fi, with an external radio.',
	category: 'thread',
	framework: 'esp-matter',
	chips: ['esp32', 'esp32s3', 'esp32c3'],
	defaults,
	pins: [
		{ key: 'rxGpio', label: 'UART RX (from radio TX)' },
		{ key: 'txGpio', label: 'UART TX (to radio RX)' }
	],
	validate,
	activate({ use, find, role, config, chipsWith, featureConfig, has }) {
		use(network);
		use(configuratorEditors).register(Editor);
		const radio = chipsWith('openthread_rcp')[0];
		const rcp = radio ? (featureConfig('openthread_rcp', radio) ?? {}) : {};
		if (radio)
			use(wires).register(
				{
					from: { role: role.id, pin: `gpio:${config.txGpio}` },
					to: { role: radio, pin: `gpio:${rcp.rxGpio}` },
					label: 'UART host TX → radio RX',
					color: '#f59e0b'
				},
				{
					from: { role: role.id, pin: `gpio:${config.rxGpio}` },
					to: { role: radio, pin: `gpio:${rcp.txGpio}` },
					label: 'UART host RX ← radio TX',
					color: '#3b82f6'
				},
				{
					from: { role: role.id, pin: 'GND' },
					to: { role: radio, pin: 'GND' },
					label: 'Ground',
					color: '#64748b'
				},
				{
					// 3.3 V rail to rail: both chips run at 3.3 V anyway and the 5V pin has board quirks
					// (S3 DevKitC "IN-OUT" pads, see boards.ts). The radio's own regulator is bypassed.
					from: { role: role.id, pin: '3V3' },
					to: { role: radio, pin: '3V3' },
					label: '3.3 V power – unplug this wire while the radio has its own USB cable',
					color: '#ef4444'
				}
			);
		const web = has('http_server');
		use(firmware).register(() => ({
			sdkconfig: {
				CONFIG_OPENTHREAD_ENABLED: true,
				CONFIG_OPENTHREAD_BORDER_ROUTER: true,
				CONFIG_OPENTHREAD_RADIO_SPINEL_UART: true,
				CONFIG_OPENTHREAD_LOG_LEVEL_DYNAMIC: false,
				CONFIG_OPENTHREAD_LOG_LEVEL_NOTE: true,
				CONFIG_OPENTHREAD_SRP_CLIENT: false,
				CONFIG_OPENTHREAD_DNS_CLIENT: false,
				// The hub is a Matter node on Wi-Fi only. espm_thread.cpp starts OpenThread itself once
				// the radio answers, so a missing radio neither blocks the boot nor makes OpenThread abort.
				CONFIG_ESP_MATTER_ENABLE_OPENTHREAD: false,
				CONFIG_ENABLE_MATTER_OVER_THREAD: false,
				CONFIG_THREAD_NETWORK_COMMISSIONING_DRIVER: false,
				CONFIG_LWIP_IPV6_AUTOCONFIG: true,
				CONFIG_LWIP_IPV6_NUM_ADDRESSES: 12,
				CONFIG_LWIP_IPV6_FORWARD: true,
				CONFIG_LWIP_MULTICAST_PING: true,
				CONFIG_LWIP_NETIF_STATUS_CALLBACK: true,
				CONFIG_LWIP_HOOK_IP6_ROUTE_DEFAULT: true,
				CONFIG_LWIP_HOOK_ND6_GET_GW_DEFAULT: true,
				CONFIG_MBEDTLS_KEY_EXCHANGE_ECJPAKE: true,
				CONFIG_MBEDTLS_ECJPAKE_C: true,
				CONFIG_MBEDTLS_SSL_PROTO_DTLS: true,
				// The border router installs its own route hook.
				CONFIG_ENABLE_ROUTE_HOOK: false,
				CONFIG_USE_MINIMAL_MDNS: false,
				CONFIG_MDNS_MULTIPLE_INSTANCE: true,
				// The SRP server republishes every Thread node's service via mDNS. With the default of 10
				// the table fills after a handful of nodes; the rest get no SRP registration and can't be
				// reached (commissioning fails at FindOperational). Room for 32 nodes plus the hub's own.
				CONFIG_MDNS_MAX_SERVICES: 64
			},
			compileOptions: ['-D_NO_GENERIC_THREAD_NETWORK_COMMISSIONING_DRIVER_'],
			defines: {
				MESP_THREAD: true,
				MESP_THREAD_AUTO_FORM: Boolean(config.autoForm),
				MESP_THREAD_NETWORK_NAME: String(config.networkName),
				MESP_THREAD_CHANNEL: Number(config.channel),
				MESP_RCP_HOST_RX_PIN: Number(config.rxGpio),
				MESP_RCP_HOST_TX_PIN: Number(config.txGpio),
				MESP_RCP_BAUD: RCP_BAUD
			},
			sources: { 'espm_thread.cpp': threadCpp, 'espm_thread.h': threadH },
			hooks: {
				includes: ['#include "espm_thread.h"'],
				postStart: ['mesp_thread_start();', ...(web ? ['mesp_thread_register_web();'] : [])],
				// Wi-Fi is the backbone link of the border router.
				onIp: ['mesp_thread_on_ip();']
			}
		}));
		find(deviceApi)?.register(...api);
		find(devicePanels)?.register({
			id: 'thread',
			title: 'Thread network',
			file: 'ThreadPanel.svelte',
			area: 'main',
			section: 'network'
		});
	}
} satisfies FeatureDef<ThreadBrConfig>;
