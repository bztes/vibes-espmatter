import { defineService, Registry, type Services } from '../../services';
import type { DeviceApiRoute } from '../../types';

/** What a feature serves over the HTTP server (`webServer`). */
export interface WebContribution {
	/** Its routes as documented (shown by the configurator's API tab). */
	api?: DeviceApiRoute[];
	/**
	 * Firmware built only with the HTTP server, e.g. `espm_wifi_web.cpp`: the only sources of a
	 * feature that doesn't require it which may include `espm_web.h`.
	 */
	sources?: Record<string, string>;
	/** Function (`void name()`) adding its routes (`mesp_web_add()`), called once the logins are up. */
	init?: string;
}

/**
 * The web server (`mesp_web_add()`): the features whose firmware serves something over HTTP
 * register what (`WebContribution`). Those that only work with it `use` it, the others `find` it,
 * so their web part is only built with the HTTP server.
 */
export const webServer = defineService(
	'http_server.webServer',
	() => new Registry<WebContribution>(),
	'http_server'
);

/** The routes a chip's features registered, in hook order, with the feature's name (none without the HTTP server). */
export function documentedRoutes(services: Services): (DeviceApiRoute & { feature: string })[] {
	return (services.find(webServer)?.entries() ?? []).flatMap(({ feature, item }) =>
		(item.api ?? []).map((route) => ({ ...route, feature: feature.name }))
	);
}
