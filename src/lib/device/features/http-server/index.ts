import { configuratorEditors, configuratorTabs, firmware } from '../core/services';
import type { FeatureDef, FeatureIssue, Validate } from '../../types';
import { fnv1a } from '../../util';
import { devicePanels } from '../web-ui/services';
import { api } from './api';
import Editor from './configurator/Editor.svelte';
import authCpp from './firmware/espm_auth.cpp?raw';
import webCpp from './firmware/espm_web.cpp?raw';
import webH from './firmware/espm_web.h?raw';
import systemCpp from './firmware/espm_system.cpp?raw';
import { deviceApi } from './services';
import ApiTab from './configurator/ApiTab.svelte';

const defaults = () => ({ username: 'admin', password: '', port: 80 });
export type HttpServerConfig = ReturnType<typeof defaults>;

const validate: Validate<HttpServerConfig> = ({ config }) => {
	const password = String(config.password);
	const port = Number(config.port);
	const errors: FeatureIssue<HttpServerConfig>[] = [];
	if (!/^[A-Za-z0-9._-]{1,23}$/.test(String(config.username)))
		errors.push({
			field: 'username',
			message: 'Admin user name: letters, digits, - _ . (max. 23).'
		});
	if (password.length < 6)
		errors.push({
			field: 'password',
			message: 'The initial admin password needs at least 6 characters.'
		});
	else if (password.length > 64)
		errors.push({
			field: 'password',
			message: 'Initial admin password must be at most 64 characters.'
		});
	if (!(port >= 1 && port <= 65535))
		errors.push({ field: 'port', message: 'HTTP port must be between 1 and 65535.' });
	return errors;
};

/**
 * The device's REST API, bare: the logins (admins and users with passwords, stored on the device;
 * the configuration only sets the first admin's initial password), users, status and reboot.
 * Every route needs a login. Other features extend it with their routes (`mesp_web_add()`, e.g.
 * `/api/ota`, `/api/matter/…`, `/api/timers`), document them with its `deviceApi` service (shown in
 * the configurator's API tab) and bring the panels that use them; pages (`mesp_web_add_page()`)
 * come from the web interface. Its own panels (users, system) are on the admin dashboard.
 */
export default {
	id: 'http_server',
	dir: 'http-server',
	name: 'HTTP server',
	description: 'The device’s REST API (logins, users, status), behind a login.',
	category: 'core',
	framework: 'esp-matter',
	defaults,
	validate,
	activate({ use, find, config }) {
		use(configuratorEditors).register(Editor);
		use(configuratorTabs).register({ id: 'api', title: 'API', component: ApiTab });
		use(deviceApi).register(...api);
		use(firmware).register(() => ({
			sdkconfig: { CONFIG_HTTPD_MAX_REQ_HDR_LEN: 1024 },
			defines: {
				MESP_WEB: true,
				MESP_WEB_PORT: Number(config.port),
				MESP_WEB_AUTH_USER: String(config.username),
				MESP_WEB_AUTH_PASSWORD: String(config.password),
				// Changes when the initial login does: the device then resets that admin to it.
				MESP_WEB_AUTH_SEED: fnv1a(`${config.username}:${config.password}`)
			},
			sources: {
				'espm_web.cpp': webCpp,
				'espm_web.h': webH,
				'espm_system.cpp': systemCpp,
				'espm_auth.cpp': authCpp
			},
			hooks: {
				includes: ['#include "espm_web.h"'],
				globals: ['void mesp_system_register_web();'],
				postStart: [
					'mesp_auth_init();',
					'mesp_auth_register_routes();',
					'mesp_system_register_web();'
				],
				// The other features add their routes in `postStart`.
				started: ['mesp_web_start();']
			}
		}));
		find(devicePanels)?.register(
			{
				id: 'system',
				title: 'System',
				file: 'SystemPanel.svelte',
				area: 'main',
				section: 'system'
			},
			{
				id: 'users',
				title: 'Users',
				file: 'UsersPanel.svelte',
				area: 'main',
				section: 'users'
			}
		);
	}
} satisfies FeatureDef<HttpServerConfig>;
