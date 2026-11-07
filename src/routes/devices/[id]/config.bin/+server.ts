import { slug } from '#sdk';
import { configImage, ownedDevice } from '#lib/server/devices.ts';
import type { RequestHandler } from './$types';

/** The device's configuration partition, for USB flashing and `esptool.py write_flash`. */
export const GET: RequestHandler = async ({ params, url }) => {
	const dev = await ownedDevice(params.id);
	const { image, rev } = await configImage(dev, url.origin);
	const headers: Record<string, string> = {
		'content-type': 'application/octet-stream',
		'cache-control': 'no-store',
		'x-config-rev': rev
	};
	if (url.searchParams.has('download'))
		headers['content-disposition'] = `attachment; filename="${slug(dev.name)}-config.bin"`;
	return new Response(image as BodyInit, { headers });
};
