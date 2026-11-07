/** Encode a JS string as a C string literal. */
export function cString(value: string): string {
	let out = '"';
	for (const byte of new TextEncoder().encode(value)) {
		if (byte === 0x22) out += '\\"';
		else if (byte === 0x5c) out += '\\\\';
		else if (byte === 0x3f)
			out += '\\?'; // no trigraphs
		else if (byte < 0x20 || byte >= 0x7f) out += '\\' + byte.toString(8).padStart(3, '0');
		else out += String.fromCharCode(byte);
	}
	return out + '"';
}

/** Lowercase, dash separated, max 32 chars – usable as hostname and C identifier part. */
export function slug(value: string, fallback = 'device'): string {
	return (
		value
			.normalize('NFKD')
			.replace(/[̀-ͯ]/g, '')
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 32)
			.replace(/-+$/, '') || fallback
	);
}
