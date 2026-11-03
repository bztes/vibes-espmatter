import { describe, expect, it, vi } from 'vitest';

vi.mock('$app/env/private', () => ({ BETTER_AUTH_SECRET: 'test-secret', DATA_DIR: './data' }));

const { otaHeader, updateToken } = await import('./updates.ts');

describe('Matter OTA image header', () => {
	it('has the file prefix and the TLV fields of the spec', () => {
		const payload = Buffer.from('firmware');
		const header = otaHeader({
			vendorId: 0xfff1,
			productId: 0x8000,
			version: 1793700000,
			versionString: '2026-11-03 10:40',
			payload
		});
		expect(header.readUInt32LE(0)).toBe(0x1beef11e);
		expect(Number(header.readBigUInt64LE(4))).toBe(header.length + payload.length);
		expect(header.readUInt32LE(12)).toBe(header.length - 16);
		const tlv = header.subarray(16);
		expect(tlv[0]).toBe(0x15);
		expect(tlv.at(-1)).toBe(0x18);
		// VendorID (tag 0, uint16) and ProductID (tag 1, uint16), little-endian
		expect([...tlv.subarray(1, 9)]).toEqual([0x25, 0, 0xf1, 0xff, 0x25, 1, 0x00, 0x80]);
		// SoftwareVersion (tag 2, uint32)
		expect(tlv.readUInt32LE(11)).toBe(1793700000);
	});

	it('signs hub tokens per hub', () => {
		expect(updateToken('a')).toMatch(/^a\.[\w-]{32}$/);
		expect(updateToken('a')).not.toBe(updateToken('b').replace(/^b/, 'a'));
	});
});
