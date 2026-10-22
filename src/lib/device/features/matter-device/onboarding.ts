/**
 * Matter onboarding payloads (Matter Core spec, 5.1): the 11-digit manual pairing code and the
 * `MT:` QR code string, so the build page can show how to pair a device before it is flashed.
 */

/** Test vendor/product of esp-matter (devices with test certificates). */
export const TEST_VENDOR_ID = 0xfff1;
export const TEST_PRODUCT_ID = 0x8000;

/** Discovery capabilities bitmap of the QR code. */
export const DISCOVERY_BLE = 0x02;
export const DISCOVERY_ON_NETWORK = 0x04;

const INVALID_PASSCODES = new Set([
	0, 11111111, 22222222, 33333333, 44444444, 55555555, 66666666, 77777777, 88888888, 99999999,
	12345678, 87654321
]);

export function validPasscode(passcode: number): boolean {
	return (
		Number.isInteger(passcode) &&
		passcode >= 1 &&
		passcode <= 99999998 &&
		!INVALID_PASSCODES.has(passcode)
	);
}

/** Make any number a valid passcode (in range, not one of the forbidden trivial ones). */
export function toValidPasscode(n: number): number {
	let passcode = (Math.abs(Math.trunc(n)) % 99999998) + 1;
	while (!validPasscode(passcode)) passcode = (passcode % 99999998) + 1;
	return passcode;
}

// Verhoeff check digit (the manual code's last digit).
const D = [
	[0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
	[1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
	[2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
	[3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
	[4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
	[5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
	[6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
	[7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
	[8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
	[9, 8, 7, 6, 5, 4, 3, 2, 1, 0]
];
const P = [
	[0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
	[1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
	[5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
	[8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
	[9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
	[4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
	[2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
	[7, 0, 4, 6, 9, 1, 3, 2, 5, 8]
];
const INV = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9];

function verhoeff(digits: string): number {
	let c = 0;
	const reversed = [...digits].reverse();
	for (let i = 0; i < reversed.length; i++) c = D[c][P[(i + 1) % 8][Number(reversed[i])]];
	return INV[c];
}

/** 11-digit manual pairing code (without vendor/product id), e.g. `34970112332`. */
export function manualPairingCode(passcode: number, discriminator: number): string {
	const short = (discriminator >> 8) & 0xf;
	const chunk1 = short >> 2;
	const chunk2 = ((short & 0x3) << 14) | (passcode & 0x3fff);
	const chunk3 = passcode >> 14;
	const digits = `${chunk1}${String(chunk2).padStart(5, '0')}${String(chunk3).padStart(4, '0')}`;
	return digits + verhoeff(digits);
}

/** `3497-011-2332` – how controllers print the manual code. */
export function formatManualCode(code: string): string {
	return `${code.slice(0, 4)}-${code.slice(4, 7)}-${code.slice(7)}`;
}

const BASE38 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-.';

function base38(bytes: number[]): string {
	let out = '';
	for (let i = 0; i < bytes.length; i += 3) {
		const chunk = bytes.slice(i, i + 3);
		let value = 0;
		for (let j = chunk.length - 1; j >= 0; j--) value = value * 256 + chunk[j];
		const chars = chunk.length === 3 ? 5 : chunk.length === 2 ? 4 : 2;
		for (let c = 0; c < chars; c++) {
			out += BASE38[value % 38];
			value = Math.floor(value / 38);
		}
	}
	return out;
}

/** QR code content, e.g. `MT:Y.K9042C00KA0648G00` (render it with any QR code generator). */
export function qrCodePayload(opts: {
	passcode: number;
	discriminator: number;
	vendorId?: number;
	productId?: number;
	discovery?: number;
}): string {
	// Fields packed LSB first: version 3, VID 16, PID 16, flow 2, discovery 8, discriminator 12,
	// passcode 27, padding 4 = 88 bits.
	const fields: [number, number][] = [
		[0, 3],
		[opts.vendorId ?? TEST_VENDOR_ID, 16],
		[opts.productId ?? TEST_PRODUCT_ID, 16],
		[0, 2],
		[opts.discovery ?? DISCOVERY_BLE, 8],
		[opts.discriminator & 0xfff, 12],
		[opts.passcode, 27],
		[0, 4]
	];
	const bytes = new Array<number>(11).fill(0);
	let bit = 0;
	for (const [value, width] of fields) {
		for (let i = 0; i < width; i++, bit++) {
			if (Math.floor(value / 2 ** i) % 2) bytes[bit >> 3] |= 1 << (bit & 7);
		}
	}
	return `MT:${base38(bytes)}`;
}
