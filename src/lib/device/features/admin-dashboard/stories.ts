import type { Story } from '../../stories';
import { api as automationsApi } from '../automations/stories';
import AutomationPanel from '../automations/device-ui/AutomationPanel.svelte';
import { api as httpApi } from '../http-server/stories';
import SystemPanel from '../http-server/device-ui/SystemPanel.svelte';
import UsersPanel from '../http-server/device-ui/UsersPanel.svelte';
import AccessPanel from '../matter-controller/device-ui/AccessPanel.svelte';
import MatterPanel from '../matter-controller/device-ui/MatterPanel.svelte';
import OtaPanel from '../ota/device-ui/OtaPanel.svelte';
import { api as otelApi } from '../otel/stories';
import OtelPanel from '../otel/device-ui/OtelPanel.svelte';
import { api as scenesApi } from '../scenes/stories';
import SharingPanel from '../scenes/device-ui/SharingPanel.svelte';
import { api as threadApi } from '../thread-br/stories';
import ThreadPanel from '../thread-br/device-ui/ThreadPanel.svelte';
import { device } from '../web-ui/stories';
import { api as wifiApi } from '../wifi/stories';
import WifiBadge from '../wifi/device-ui/WifiBadge.svelte';
import WifiPanel from '../wifi/device-ui/WifiPanel.svelte';
import SetupLayout from './device-ui/SetupLayout.svelte';

const panel = (id: string, title: string, component: unknown, section: string, area = 'main') => ({
	id,
	title,
	component,
	section,
	area,
	props: {}
});

/** The setup page of a hub with most features. */
export default [
	{
		name: 'Setup page',
		component: SetupLayout,
		props: {
			device,
			page: 'admin',
			panels: [
				panel('matter', 'Matter devices', MatterPanel, 'devices'),
				panel('automations', 'Automations', AutomationPanel, 'automations'),
				panel('thread', 'Thread network', ThreadPanel, 'network'),
				panel('wifi', 'Wi-Fi', WifiPanel, 'network', 'side'),
				panel('wifi-status', 'Wi-Fi', WifiBadge, 'system', 'status'),
				panel('users', 'Users', UsersPanel, 'users'),
				panel('access', 'Matter access', AccessPanel, 'users'),
				panel('sharing', 'Scene sharing', SharingPanel, 'users'),
				panel('system', 'System', SystemPanel, 'system'),
				panel('otel', 'OpenTelemetry', OtelPanel, 'system'),
				panel('ota', 'Firmware update', OtaPanel, 'system', 'side')
			]
		},
		api: {
			...automationsApi,
			...scenesApi,
			...threadApi,
			...wifiApi,
			...otelApi,
			// Its users list has what the Matter one has, and more.
			...httpApi
		},
		wide: true
	}
] satisfies Story[];
