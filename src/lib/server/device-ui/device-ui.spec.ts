import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterAll, describe, expect, it } from 'vitest';
import { defaultProject, generateRole } from '#lib/device/generator.ts';
import { buildDeviceUi } from './index.ts';

const cacheDir = mkdtempSync(path.join(tmpdir(), 'mesp-ui-'));
afterAll(() => rmSync(cacheDir, { recursive: true, force: true }));

describe('device web interface', () => {
	it('builds the hub UI into one self-contained, gzipped page', async () => {
		const project = defaultProject('matter-hub', 'Test <Hub>');
		const [ui] = generateRole(project, 'host').ui;
		const logs: string[] = [];

		const gz = await buildDeviceUi(ui, cacheDir, (l) => logs.push(l));
		const html = gunzipSync(gz).toString();
		if (process.env.UI_OUT) writeFileSync(process.env.UI_OUT, html);

		expect(html).toContain('<title>Test &#60;Hub&#62;</title>');
		expect(html).toContain('<link rel="icon" href="data:image/svg+xml,');
		expect(html).toMatch(/<script type="module">[\s\S]+<\/script>/);
		expect(html).toContain('<style>');
		expect(html).toContain('--color-bg:'); // the theme (device-ui/theme.css)
		// No external assets: the ESP serves exactly this one file.
		expect(html).not.toMatch(/<script[^>]+src=|<link[^>]+stylesheet/);
		expect(html).toContain('/api/matter/nodes');
		expect(gz.length).toBeLessThan(60 * 1024);

		// Second build of the same UI comes from the cache.
		await buildDeviceUi(ui, cacheDir, (l) => logs.push(l));
		expect(logs.at(-1)).toContain('unchanged');
	}, 60_000);
});
