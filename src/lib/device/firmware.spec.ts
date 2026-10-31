import { describe, expect, it } from 'vitest';
import { webServer } from './features/http-server/services';
import { featureServices, requiredFeatures } from './generator';
import { features } from './registry';
import type { FeatureDef } from './types';

const sources = import.meta.glob<string>('./features/*/firmware/*.{c,cpp,h}', {
	query: '?raw',
	import: 'default',
	eager: true
});

const byDir = new Map(features.all().map((f) => [f.dir, f]));

/** The feature whose `firmware/` holds each file, by file name. */
const owner = new Map<string, string>();
for (const path of Object.keys(sources)) {
	const [, dir, file] = path.match(/^\.\/features\/([^/]+)\/firmware\/(.+)$/)!;
	owner.set(file, byDir.get(dir)!.id);
}

/**
 * The web parts the HTTP server builds for features that also work without it (`webServer`):
 * the only files of such a feature that may use the HTTP server's code.
 */
const webSources = new Set(
	(
		featureServices(features.all().map((f) => f.id))
			.find(webServer)
			?.items() ?? []
	).flatMap((c) => Object.keys(c.sources ?? {}))
);

/** The feature and all it requires, also through the features it requires. */
function reachable(feature: FeatureDef, seen = new Set<string>()): Set<string> {
	if (seen.has(feature.id)) return seen;
	seen.add(feature.id);
	for (const id of requiredFeatures(feature)) reachable(features.get(id), seen);
	return seen;
}

describe('feature firmware', () => {
	// The firmware only has the sources of the chip's features: a feature may only use the code of
	// features it requires (`use`s), its web part also the HTTP server's. Code that joins two
	// features belongs to a feature using both.
	it.each(Object.keys(sources))('%s includes only headers of features it requires', (path) => {
		const [, , dir, , file] = path.split('/');
		const allowed = reachable(byDir.get(dir)!);
		if (webSources.has(file)) reachable(features.get('http_server'), allowed);
		const foreign = [...sources[path].matchAll(/^\s*#\s*include\s+"([^"]+)"/gm)]
			.map(([, header]) => header)
			.filter((header) => owner.has(header) && !allowed.has(owner.get(header)!))
			.map((header) => `${header} (${owner.get(header)})`);
		expect(foreign).toEqual([]);
	});

	it('finds the web parts of the features', () => {
		expect([...webSources].sort()).toEqual([
			'espm_matter_access.cpp',
			'espm_matter_web.cpp',
			'espm_matter_web.h',
			'espm_otel_web.cpp',
			'espm_thread_web.cpp',
			'espm_wifi_web.cpp'
		]);
	});
});
