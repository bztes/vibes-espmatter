import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { createZip } from './zip';

describe('createZip', () => {
	it('round-trips nested paths, UTF-8 and binary content, compressed', async () => {
		const source = 'int main() { return 0; }\n'.repeat(200);
		const blob = createZip({
			'hub/host/main/app_main.cpp': source,
			'hub/host/README.md': 'Grüße – ✓',
			'hub/radio/data.bin': new Uint8Array([0, 1, 2, 255])
		});
		expect(blob.type).toBe('application/zip');

		const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
		expect(strFromU8(files['hub/host/main/app_main.cpp'])).toBe(source);
		expect(strFromU8(files['hub/host/README.md'])).toBe('Grüße – ✓');
		expect([...files['hub/radio/data.bin']]).toEqual([0, 1, 2, 255]);
		expect(blob.size).toBeLessThan(source.length / 5);
	});
});
