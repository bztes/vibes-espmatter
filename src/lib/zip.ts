import { strToU8, zipSync, type Zippable } from 'fflate';

/** ZIP archive (deflate-compressed) of generated source projects, keyed by path inside the archive. */
export function createZip(files: Record<string, string | Uint8Array>): Blob {
	const entries: Zippable = {};
	for (const [path, content] of Object.entries(files)) {
		entries[path] = typeof content === 'string' ? strToU8(content) : content;
	}
	const zip = zipSync(entries, { level: 6, mtime: new Date() });
	return new Blob([zip as Uint8Array<ArrayBuffer>], { type: 'application/zip' });
}
