/**
 * Plugin sources, bundled into the server as raw strings (lazy), so builds work the same from
 * `vite dev` and the compiled server, without the source tree at runtime.
 */
import type { SourceRef } from '#lib/core/assemble.ts';

const firmware = import.meta.glob(['/plugins/**/firmware/*', '/src/lib/core/platform/firmware/*'], {
	query: '?raw',
	import: 'default'
}) as Record<string, () => Promise<string>>;

/** Everything the device web interface may import. */
export const uiSources = import.meta.glob(
	[
		'/src/lib/device-ui/**/*',
		'/src/lib/sdk/device-ui/**/*',
		'/src/lib/sdk/matter.ts',
		'/src/lib/sdk/matter-model.ts',
		'/src/lib/core/platform/ui/*',
		'/plugins/**/ui/**/*'
	],
	{ query: '?raw', import: 'default' }
) as Record<string, () => Promise<string>>;

export async function loadFirmware(refs: SourceRef[]): Promise<(ref: SourceRef) => string> {
	const loaded = new Map<string, string>();
	for (const ref of refs) {
		const key = `/${ref.dir}/firmware/${ref.file}`;
		const load = firmware[key];
		if (!load) throw new Error(`Firmware source not found: ${key.slice(1)}`);
		loaded.set(key, await load());
	}
	return (ref) => loaded.get(`/${ref.dir}/firmware/${ref.file}`)!;
}
