/**
 * Matter onboarding payloads (Matter Core Spec 5.1): the 11-digit manual pairing code and the
 * `MT:` QR code payload, from discriminator and setup passcode.
 */

const INVALID_PASSCODES = new Set([
	0, 11111111, 22222222, 33333333, 44444444, 55555555, 66666666, 77777777, 88888888, 99999999,
	12345678, 87654321
]);

function random(max: number): number {
	return crypto.getRandomValues(new Uint32Array(1))[0] % max;
}

export const randomDiscriminator = () => random(0x1000);

export function randomPasscode(): number {
	for (;;) {
		const p = 1 + random(99999998);
		if (!INVALID_PASSCODES.has(p)) return p;
	}
}

export const validPasscode = (p: number) =>
	Number.isInteger(p) && p >= 1 && p <= 99999998 && !INVALID_PASSCODES.has(p);

// Verhoeff check digit.
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
	const rev = digits.split('').reverse();
	for (let i = 0; i < rev.length; i++) c = D[c][P[(i + 1) % 8][Number(rev[i])]];
	return INV[c];
}

/** 11-digit manual pairing code, formatted `1234-567-8901`. */
export function manualPairingCode(discriminator: number, passcode: number): string {
	const short = (discriminator >> 8) & 0xf;
	const chunk1 = short >> 2; // no vendor/product id in the code
	const chunk2 = ((short & 0x3) << 14) | (passcode & 0x3fff);
	const chunk3 = passcode >> 14;
	const digits = String(chunk1) + String(chunk2).padStart(5, '0') + String(chunk3).padStart(4, '0');
	const code = digits + verhoeff(digits);
	return `${code.slice(0, 4)}-${code.slice(4, 7)}-${code.slice(7)}`;
}

const BASE38 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-.';

function base38(bytes: Uint8Array): string {
	let out = '';
	for (let i = 0; i < bytes.length; i += 3) {
		const n = Math.min(3, bytes.length - i);
		let value = 0;
		for (let j = n - 1; j >= 0; j--) value = value * 256 + bytes[i + j];
		const chars = n === 3 ? 5 : n === 2 ? 4 : 2;
		for (let k = 0; k < chars; k++) {
			out += BASE38[value % 38];
			value = Math.floor(value / 38);
		}
	}
	return out;
}

/** Rendezvous: 2 = BLE, 4 = on network. */
export function qrPayload(
	vendorId: number,
	productId: number,
	discriminator: number,
	passcode: number,
	rendezvous = 2
): string {
	const bytes = new Uint8Array(11);
	let offset = 0;
	const put = (value: number, bits: number) => {
		for (let i = 0; i < bits; i++) {
			if (Math.floor(value / 2 ** i) % 2) bytes[offset >> 3] |= 1 << (offset & 7);
			offset++;
		}
	};
	put(0, 3); // version
	put(vendorId, 16);
	put(productId, 16);
	put(0, 2); // standard commissioning flow
	put(rendezvous, 8);
	put(discriminator, 12);
	put(passcode, 27);
	put(0, 4); // padding
	return 'MT:' + base38(bytes);
}
