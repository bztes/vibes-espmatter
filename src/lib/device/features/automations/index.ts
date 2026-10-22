import { firmware } from '../core/services';
import type { FeatureDef } from '../../types';
import { deviceApi } from '../http-server/services';
import { devicePanels } from '../web-ui/services';
import { api } from './api';
import automationCpp from './firmware/espm_automation.cpp?raw';
import { matterController } from '../matter-controller/services';

/**
 * Automations: buttons of Matter switches control lights through the hub ("button 1 · press →
 * lamp: toggle"). The button events come from the Matter controller's subscriptions. Adds
 * `/api/automations` to the HTTP server and, with the admin dashboard, the Automations section to
 * it.
 */
export default {
	id: 'automations',
	dir: 'automations',
	name: 'Automations',
	description: 'Buttons of Matter switches control lights, set up on the admin dashboard.',
	category: 'matter',
	chips: ['esp32', 'esp32s3', 'esp32c3', 'esp32c6'],
	activate({ use, find, has }) {
		use(matterController);
		use(deviceApi).register(...api);
		use(firmware).register(() => ({
			sources: { 'espm_automation.cpp': automationCpp },
			hooks: {
				globals: ['void mesp_automation_init();', 'void mesp_automation_register_web();'],
				preStart: ['mesp_automation_init();'],
				postStart: ['mesp_automation_register_web();']
			}
		}));
		// Without the admin dashboard the automations run as set up through the API.
		if (has('admin_dashboard'))
			find(devicePanels)?.register({
				id: 'automations',
				title: 'Automations',
				file: 'AutomationPanel.svelte',
				area: 'main',
				section: 'automations'
			});
	}
} satisfies FeatureDef;
