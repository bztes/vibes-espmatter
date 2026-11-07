import { json } from '@sveltejs/kit';
import { assemble } from '#lib/core/assemble.ts';
import { openApi } from '#lib/core/openapi.ts';
import { ownedFirmware } from '#lib/server/devices.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, url }) => {
	const fw = await ownedFirmware(params.id);
	const address = url.searchParams.get('address');
	return json(
		openApi(
			assemble(fw.config),
			address && /^https?:\/\/[\w.:[\]-]+$/.test(address) ? address : 'http://device.local'
		),
		{
			headers: {
				'content-disposition': `attachment; filename="${fw.name.replace(/[^\w-]+/g, '_')}-openapi.json"`
			}
		}
	);
};
