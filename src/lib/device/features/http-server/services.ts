import { defineFirmwareApi, defineService, Registry, type Services } from '../../services';
import type { DeviceApiRoute } from '../../types';

/** The web server (`mesp_web_add()`): for features whose firmware serves something over HTTP. */
export const webServer = defineFirmwareApi('http_server.webServer', 'http_server');

/**
 * The device's REST API: the features whose firmware adds routes (`mesp_web_add()`) register
 * their docs here (shown by the configurator's API tab). Only on chips with the HTTP server.
 */
export const deviceApi = defineService(
	'http_server.deviceApi',
	() => new Registry<DeviceApiRoute>(),
	'http_server'
);

/** The routes a chip's features registered, in hook order, with the feature's name (none without the HTTP server). */
export function documentedRoutes(services: Services): (DeviceApiRoute & { feature: string })[] {
	return (services.find(deviceApi)?.entries() ?? []).map(({ feature, item }) => ({
		...item,
		feature: feature.name
	}));
}
