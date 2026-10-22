import type { SdkconfigValue } from './types';

/** Encode a JS string as a C string literal (octal escapes are never greedy beyond 3 digits). */
export function cString(value: string): string {
	let out = '"';
	for (const byte of new TextEncoder().encode(value)) {
		if (byte === 0x22) out += '\\"';
		else if (byte === 0x5c) out += '\\\\';
		else if (byte === 0x3f)
			out += '\\?'; // avoid trigraphs
		else if (byte < 0x20 || byte >= 0x7f) out += '\\' + byte.toString(8).padStart(3, '0');
		else out += String.fromCharCode(byte);
	}
	return out + '"';
}

export function cDefine(name: string, value: SdkconfigValue): string {
	if (typeof value === 'boolean') return `#define ${name} ${value ? 1 : 0}`;
	if (typeof value === 'number') return `#define ${name} ${value}`;
	return `#define ${name} ${cString(value)}`;
}

export function sdkconfigLine(key: string, value: SdkconfigValue): string {
	if (typeof value === 'boolean') return value ? `${key}=y` : `# ${key} is not set`;
	if (typeof value === 'number') return `${key}=${value}`;
	return `${key}=${JSON.stringify(value)}`;
}

/** Lowercase, dash separated, max 32 chars – usable as hostname. */
export function slugify(value: string): string {
	return (
		value
			.normalize('NFKD')
			.replace(/[̀-ͯ]/g, '')
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 32)
			.replace(/-+$/, '') || 'matter-device'
	);
}

/** 32-bit FNV-1a hash of the UTF-8 bytes, never 0 (0 means "not set" in NVS). */
export function fnv1a(value: string): number {
	let hash = 0x811c9dc5;
	for (const b of new TextEncoder().encode(value)) hash = Math.imul(hash ^ b, 0x01000193) >>> 0;
	return hash || 1;
}

/** Stable JSON stringify (sorted keys) for hashing. */
export function stableStringify(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
	if (value && typeof value === 'object') {
		return `{${Object.keys(value)
			.sort()
			.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`)
			.join(',')}}`;
	}
	return JSON.stringify(value);
}

/** Small, synchronous, non-cryptographic hash (FNV-1a, 2×32 bit) → 16 hex chars. */
export function hash(value: string): string {
	let h1 = 0x811c9dc5;
	let h2 = 0x01000193 ^ value.length;
	for (let i = 0; i < value.length; i++) {
		const c = value.charCodeAt(i);
		h1 = Math.imul(h1 ^ c, 0x01000193);
		h2 = Math.imul(h2 ^ c, 0x5bd1e995);
		h2 ^= h2 >>> 15;
	}
	return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

export function indent(code: string, spaces = 4): string {
	const pad = ' '.repeat(spaces);
	return code
		.split('\n')
		.map((line) => (line.trim() ? pad + line : line))
		.join('\n');
}
