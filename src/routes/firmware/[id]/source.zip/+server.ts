import { strToU8, zipSync } from 'fflate';
import { slug } from '#sdk';
import { assemble } from '#lib/core/assemble.ts';
import { generate } from '#lib/core/generate.ts';
import { loadFirmware } from '#lib/server/builds/sources.ts';
import { ownedFirmware } from '#lib/server/devices.ts';
import type { RequestHandler } from './$types';

/** The generated ESP-IDF projects (one folder per board) – to build them yourself. */
export const GET: RequestHandler = async ({ params }) => {
	const fw = await ownedFirmware(params.id);
	const a = assemble(fw.config, { version: fw.nextVersion, buildId: 'export' });
	const read = await loadFirmware(a.firmware.flatMap((f) => f.sources));
	const files: Record<string, Uint8Array> = {};
	for (const p of generate(a, read, fw.nextVersion))
		for (const [name, content] of Object.entries(p.files))
			files[`${p.slot}/${name}`] = strToU8(content);
	const zip = zipSync(files, { level: 6 });
	return new Response(zip as unknown as BodyInit, {
		headers: {
			'content-type': 'application/zip',
			'content-disposition': `attachment; filename="${slug(fw.name)}-firmware-src.zip"`
		}
	});
};
