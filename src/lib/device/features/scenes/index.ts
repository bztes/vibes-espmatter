import { firmware } from '../core/services';
import type { FeatureDef } from '../../types';
import { webServer } from '../http-server/services';
import { USER_DASHBOARD } from '../user-dashboard/index.ts';
import { devicePanels } from '../web-ui/services';
import { api } from './api';
import scenesCpp from './firmware/espm_scenes.cpp?raw';
import { matterController } from '../matter-controller/services';

/**
 * Scenes: lights switched all at once, each on/off at a brightness and color temperature ("Movie
 * night"). Adds `/api/scenes` to the HTTP server; with the user dashboard everyone creates and runs
 * their scenes there (from the lights they may control), with the admin dashboard admins share
 * them with other users.
 */
export default {
	id: 'scenes',
	dir: 'scenes',
	name: 'Scenes',
	description: 'Switch several lights at once, set up on the user dashboard.',
	category: 'matter',
	chips: ['esp32', 'esp32s3', 'esp32c3', 'esp32c6'],
	activate({ use, find, has }) {
		use(matterController);
		use(webServer).register({ api });
		use(firmware).register(() => ({
			sources: { 'espm_scenes.cpp': scenesCpp },
			hooks: {
				globals: ['void mesp_scenes_init();', 'void mesp_scenes_register_web();'],
				preStart: ['mesp_scenes_init();'],
				postStart: ['mesp_scenes_register_web();']
			}
		}));
		// Without the dashboards the scenes are set up and run through the API.
		const panels = find(devicePanels);
		if (has('user_dashboard'))
			panels?.register({
				id: 'scenes',
				title: 'Scenes',
				file: 'ScenesPanel.svelte',
				page: USER_DASHBOARD,
				area: 'main'
			});
		if (has('admin_dashboard'))
			panels?.register({
				id: 'scene-sharing',
				title: 'Scene sharing',
				file: 'SharingPanel.svelte',
				area: 'main',
				section: 'users'
			});
	}
} satisfies FeatureDef;
