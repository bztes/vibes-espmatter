import { defineService, Registry } from '../../services';
import type { DevicePage, DevicePanel } from '../../types';

/** Pages of the device web interface, e.g. the dashboards. Only on chips with the web interface. */
export const devicePages = defineService(
	'web_ui.devicePages',
	() => new Registry<DevicePage>(),
	'web_ui'
);

/**
 * Panels of the device web interface: Svelte components in the registering feature's `device-ui/` folder,
 * shown on the page they name. Only on chips with the web interface.
 */
export const devicePanels = defineService(
	'web_ui.devicePanels',
	() => new Registry<DevicePanel>(),
	'web_ui'
);
