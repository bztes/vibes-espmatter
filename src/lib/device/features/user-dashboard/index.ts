import { configuratorEditors } from '../core/services';
import type { FeatureDef } from '../../types';
import { devicePages } from '../web-ui/services';
import Editor from './configurator/Editor.svelte';
import { checkPagePath } from '../web-ui/index.ts';

/** Id of the user dashboard's page: features put their panels there with `page: USER_DASHBOARD`. */
export const USER_DASHBOARD = 'dashboard';

const defaults = () => ({ path: '/' });
export type UserDashboardConfig = ReturnType<typeof defaults>;

/**
 * The user dashboard (at `/` by default): a page for every logged-in user, e.g. household members
 * with their own logins. It only brings the page: the panels and the API they use come from the
 * features (light tiles from the Matter controller, timers …). More users than the initial admin
 * need the admin dashboard (user management).
 */
export default {
	id: 'user_dashboard',
	dir: 'user-dashboard',
	name: 'User dashboard',
	description: 'Start page for everyone with a login, e.g. light tiles and timers.',
	category: 'ui',
	defaults,
	validate: checkPagePath,
	activate({ use, config, project }) {
		use(configuratorEditors).register(Editor);
		use(devicePages).register({
			id: USER_DASHBOARD,
			path: String(config.path),
			title: 'Dashboard',
			icon: 'layout-dashboard',
			layout: 'DashboardLayout.svelte',
			access: 'user',
			appName: project.name
		});
	}
} satisfies FeatureDef<UserDashboardConfig>;
