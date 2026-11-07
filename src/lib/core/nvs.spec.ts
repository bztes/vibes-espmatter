import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { CfgEntry } from './device';
import { crc32, nvsImage } from './nvs';

const entries: CfgEntry[] = [
	{ ns: 'espm', key: 'id', type: 'str', value: '6f1c2a3b-1111-2222-3333-444455556666' },
	{ ns: 'espm', key: 'pull', type: 'bool', value: true },
	{ ns: 'espm', key: 'interval', type: 'int', value: -60 },
	{ ns: 'espm', key: 'empty', type: 'str', value: '' },
	{ ns: 's.k3f9a1', key: 'offset', type: 'num', value: 0.5 },
	{ ns: 'f.otel', key: 'authHeader', type: 'str', value: 'Basic ' + 'x'.repeat(200) },
	...Array.from({ length: 40 }, (_, i) => ({
		ns: 'f.big',
		key: 'k' + i,
		type: 'str' as const,
		value: 'value number ' + i + ' ' + 'y'.repeat(i * 3)
	}))
];

describe('nvs image', () => {
	it('is byte-identical to nvs_partition_gen.py (ESP-IDF 5.4, two pages)', () => {
		// Reference: the same entries as CSV, `nvs_partition_gen.py generate in.csv out.bin 0x4000`.
		const hash = createHash('sha256').update(nvsImage(entries, 0x4000)).digest('hex');
		expect(hash).toBe('3799682a82d5fcad4e3333e5fd228bb3a41ef9716ee123b2b5dfc8def55480b1');
	});

	it('computes zlib CRC32', () => {
		expect(crc32(new TextEncoder().encode('123456789'), 0)).toBe(0xcbf43926);
	});

	it('refuses what does not fit', () => {
		const huge = Array.from({ length: 200 }, (_, i) => ({
			ns: 'x',
			key: 'k' + i,
			type: 'str' as const,
			value: 'z'.repeat(300)
		}));
		expect(() => nvsImage(huge, 0x4000)).toThrow(/too large/);
	});
});
