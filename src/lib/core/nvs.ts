/**
 * Writes an NVS partition image, as ESP-IDF's `nvs_partition_gen.py` does (page format version 2):
 * namespaces, integers and strings – all a device configuration needs.
 *
 * Page (4096 bytes): 32-byte header, 32-byte entry state bitmap, 126 entries of 32 bytes. An entry:
 * namespace index, type, span, chunk index, CRC32, key (16), data (8). Strings take one header
 * entry plus their bytes (NUL-terminated) in the following entries.
 */
import type { CfgEntry } from './device';

const PAGE = 4096;
const ENTRY = 32;
const ENTRIES_PER_PAGE = 126;
const FIRST_ENTRY = 64;

const PAGE_ACTIVE = 0xfffffffe;
const PAGE_FULL = 0xfffffffc;
const VERSION2 = 0xfe;
const CHUNK_ANY = 0xff;

const TYPE = { u8: 0x01, i32: 0x14, sz: 0x21 } as const;

const CRC_TABLE = (() => {
	const t = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		t[n] = c >>> 0;
	}
	return t;
})();

/** zlib's `crc32(data, start)`; NVS uses start 0xffffffff (ESP-IDF's `crc32_le(0xffffffff, …)`). */
export function crc32(data: Uint8Array, start = 0xffffffff): number {
	let c = (start ^ 0xffffffff) >>> 0;
	for (const b of data) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

class Page {
	readonly buf = new Uint8Array(PAGE).fill(0xff);
	readonly view = new DataView(this.buf.buffer);
	used = 0;
	constructor(readonly seq: number) {
		this.setState(PAGE_ACTIVE);
	}
	setState(state: number) {
		this.view.setUint32(0, state, true);
		this.view.setUint32(4, this.seq, true);
		this.buf[8] = VERSION2;
		this.view.setUint32(28, crc32(this.buf.subarray(4, 28)), true);
	}
	free() {
		return ENTRIES_PER_PAGE - this.used;
	}
	/** Write the next entry (32 bytes) and mark it written in the bitmap. */
	write(entry: Uint8Array) {
		const i = this.used++;
		this.buf.set(entry, FIRST_ENTRY + i * ENTRY);
		// 2 bits per entry, 0b11 empty → 0b10 written.
		this.buf[32 + (i >> 2)] &= ~(1 << ((i & 3) * 2));
	}
}

function header(ns: number, type: number, span: number, key: string): Uint8Array {
	const e = new Uint8Array(ENTRY).fill(0xff);
	e[0] = ns;
	e[1] = type;
	e[2] = span;
	e[3] = CHUNK_ANY;
	const k = new TextEncoder().encode(key);
	if (k.length > 15) throw new Error(`NVS key too long: ${key}`);
	e.fill(0, 8, 24);
	e.set(k, 8);
	return e;
}

function seal(e: Uint8Array): Uint8Array {
	const data = new Uint8Array(28);
	data.set(e.subarray(0, 4), 0);
	data.set(e.subarray(8, 32), 4);
	new DataView(e.buffer, e.byteOffset).setUint32(4, crc32(data), true);
	return e;
}

/** An NVS partition image of `size` bytes with these entries. */
export function nvsImage(entries: CfgEntry[], size: number): Uint8Array {
	if (size % PAGE || size < 3 * PAGE) throw new Error('NVS partition: at least 3 pages of 4 KB');
	const pages: Page[] = [new Page(0)];
	const room = (span: number) => {
		let page = pages.at(-1)!;
		if (page.free() < span) {
			page.setState(PAGE_FULL);
			page = new Page(pages.length);
			pages.push(page);
			// NVS needs one free page to work with.
			if (pages.length * PAGE > size - PAGE) throw new Error('Device configuration too large');
		}
		return page;
	};

	// A namespace entry where a namespace first appears, like nvs_partition_gen.py does.
	const namespaces = new Map<string, number>();
	for (const { ns, key, type, value } of entries) {
		let index = namespaces.get(ns);
		if (index === undefined) {
			index = namespaces.size + 1;
			namespaces.set(ns, index);
			const e = header(0, TYPE.u8, 1, ns);
			e[24] = index;
			room(1).write(seal(e));
		}
		if (type === 'bool' || type === 'int') {
			const e = header(index, type === 'bool' ? TYPE.u8 : TYPE.i32, 1, key);
			const v = new DataView(e.buffer);
			if (type === 'bool') e[24] = value ? 1 : 0;
			else v.setInt32(24, Math.round(Number(value) || 0), true);
			room(1).write(seal(e));
			continue;
		}
		const text = type === 'num' ? String(Number(value) || 0) : String(value);
		const bytes = new TextEncoder().encode(text + '\0');
		const dataEntries = Math.ceil(bytes.length / ENTRY);
		if (dataEntries + 1 > ENTRIES_PER_PAGE) throw new Error(`NVS string too long: ${key}`);
		const e = header(index, TYPE.sz, dataEntries + 1, key);
		const v = new DataView(e.buffer);
		v.setUint16(24, bytes.length, true);
		v.setUint16(26, 0xffff, true);
		v.setUint32(28, crc32(bytes), true);
		const page = room(dataEntries + 1);
		page.write(seal(e));
		for (let i = 0; i < dataEntries; i++) {
			const chunk = new Uint8Array(ENTRY).fill(0xff);
			chunk.set(bytes.subarray(i * ENTRY, (i + 1) * ENTRY));
			page.write(chunk);
		}
	}

	const image = new Uint8Array(size).fill(0xff);
	pages.forEach((p, i) => image.set(p.buf, i * PAGE));
	return image;
}
