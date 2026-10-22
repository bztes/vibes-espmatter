import { configuratorEditors } from '../core/services';
import type { FeatureDef } from '../../types';
import { devicePages } from '../web-ui/services';
import Editor from './configurator/Editor.svelte';
import { checkPagePath } from '../web-ui/index.ts';

const defaults = () => ({ path: '/admin' });
export type AdminDashboardConfig = ReturnType<typeof defaults>;

/**
 * The admin dashboard (at `/admin` by default): a page split into sections that shows the panels
 * of the chip's features, admins only. It only brings the page: the panels and the API they use
 * come from the features (users and system from the HTTP server, devices from the Matter
 * controller …). Panels that don't name a page end up here.
 */
export default {
	id: 'admin_dashboard',
	dir: 'admin-dashboard',
	name: 'Admin dashboard',
	description: 'Setup pages on the device: status, devices, settings.',
	category: 'ui',
	defaults,
	validate: checkPagePath,
	activate({ use, config, project }) {
		use(configuratorEditors).register(Editor);
		const path = String(config.path);
		use(devicePages).register({
			id: 'admin',
			path,
			title: 'Setup',
			icon: 'settings',
			layout: 'SetupLayout.svelte',
			access: 'admin',
			// Not at `/`: a home screen app of its own, next to the user dashboard.
			appName: path === '/' ? project.name : `${project.name} Setup`,
			// The settings of all features.
			collectsPanels: true
		});
	}
} satisfies FeatureDef<AdminDashboardConfig>;
