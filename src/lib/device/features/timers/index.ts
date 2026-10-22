import { firmware } from '../core/services';
import type { FeatureDef } from '../../types';
import { deviceApi } from '../http-server/services';
import { USER_DASHBOARD } from '../user-dashboard/index.ts';
import { devicePanels } from '../web-ui/services';
import { api } from './api';
import timersCpp from './firmware/espm_timers.cpp?raw';
import { matterController } from '../matter-controller/services';
import { clock } from '../ntp/services';

/**
 * Timers that switch and fade lights of the Matter fabric at set times (time zone: set by an admin
 * in the Timers panel). Adds `/api/timers` to the HTTP server and, with the user dashboard, the
 * Timers panel to it. Everyone sees the timers of the lights they may control (the Matter
 * controller's access rule).
 */
export default {
	id: 'timers',
	dir: 'timers',
	name: 'Timers',
	description: 'Switch and fade lights at set times, set up on the user dashboard.',
	category: 'matter',
	chips: ['esp32', 'esp32s3', 'esp32c3', 'esp32c6'],
	activate({ use, find, has }) {
		// The lights are the Matter controller's, the clock is NTP's.
		use(matterController);
		use(clock);
		use(deviceApi).register(...api);
		use(firmware).register(() => ({
			sources: { 'espm_timers.cpp': timersCpp },
			hooks: {
				globals: [
					'void mesp_timers_init();',
					'void mesp_timers_start();',
					'void mesp_timers_register_web();'
				],
				preStart: ['mesp_timers_init();'],
				postStart: ['mesp_timers_start();', 'mesp_timers_register_web();']
			}
		}));
		// Without the user dashboard the timers run as set up through the API.
		if (has('user_dashboard'))
			find(devicePanels)?.register({
				id: 'timers',
				title: 'Timers',
				file: 'TimersPanel.svelte',
				page: USER_DASHBOARD,
				area: 'main'
			});
	}
} satisfies FeatureDef;
