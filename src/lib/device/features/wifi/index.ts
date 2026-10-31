import { configuratorEditors, firmware } from '../core/services';
import type { FeatureDef, FeatureIssue, Validate } from '../../types';
import { slugify } from '../../util';
import { webServer } from '../http-server/services';
import { devicePanels } from '../web-ui/services';
import { api } from './api';
import Editor from './configurator/Editor.svelte';
import wifiCpp from './firmware/espm_wifi.cpp?raw';
import wifiH from './firmware/espm_wifi.h?raw';
import wifiWebCpp from './firmware/espm_wifi_web.cpp?raw';

/** Letters, digits and dashes, not at the start or end. */
const HOSTNAME = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$/;

const defaults = () => ({ ssid: '', password: '', hostname: '' });
export type WifiConfig = ReturnType<typeof defaults>;

const validate: Validate<WifiConfig> = ({ config }) => {
	const ssid = String(config.ssid);
	const pw = String(config.password);
	const hostname = String(config.hostname);
	const errors: FeatureIssue<WifiConfig>[] = [];
	if (!ssid.trim()) errors.push({ field: 'ssid', message: 'Network name (SSID) is required.' });
	else if (ssid.length > 32)
		errors.push({ field: 'ssid', message: 'Network name (SSID) must be at most 32 characters.' });
	if (pw.length > 0 && pw.length < 8)
		errors.push({
			field: 'password',
			message: 'Wi-Fi password must be at least 8 characters (WPA2).'
		});
	else if (pw.length > 63)
		errors.push({ field: 'password', message: 'Password must be at most 63 characters.' });
	if (hostname.length > 32)
		errors.push({ field: 'hostname', message: 'Hostname must be at most 32 characters.' });
	else if (hostname && !HOSTNAME.test(hostname))
		errors.push({
			field: 'hostname',
			message: 'Hostname: letters, digits and dashes, not at the start or end.'
		});
	return errors;
};

export default {
	id: 'wifi',
	dir: 'wifi',
	name: 'Wi-Fi',
	description: 'Connects to your Wi-Fi network.',
	category: 'network',
	framework: 'esp-matter',
	chips: ['esp32', 'esp32s3', 'esp32c3', 'esp32c6'],
	defaults,
	validate,
	activate({ use, find, config, project }) {
		use(configuratorEditors).register(Editor);
		use(firmware).register(() => ({
			sdkconfig: {
				CONFIG_ENABLE_WIFI_STATION: true,
				CONFIG_ESP_WIFI_SOFTAP_SUPPORT: false
			},
			defines: {
				MESP_WIFI_SSID: String(config.ssid),
				MESP_WIFI_PASSWORD: String(config.password),
				MESP_HOSTNAME: String(config.hostname).trim().toLowerCase() || slugify(project.name)
			},
			sources: {
				'espm_wifi.cpp': wifiCpp,
				'espm_wifi.h': wifiH
			},
			hooks: {
				includes: ['#include "espm_wifi.h"'],
				postStart: ['mesp_wifi_connect();']
			}
		}));
		find(webServer)?.register({
			api,
			sources: { 'espm_wifi_web.cpp': wifiWebCpp },
			init: 'mesp_wifi_register_web'
		});
		find(devicePanels)?.register(
			{
				id: 'wifi',
				title: 'Wi-Fi',
				file: 'WifiPanel.svelte',
				area: 'side',
				section: 'network'
			},
			{
				id: 'wifi-status',
				title: 'Wi-Fi',
				file: 'WifiBadge.svelte',
				area: 'status'
			}
		);
	}
} satisfies FeatureDef<WifiConfig>;
