import { deviceFromToken } from '#lib/server/deploy.ts';
import { configImage, withContext } from '#lib/server/devices.ts';
import type { RequestHandler } from './$types';

/** The device fetches its configuration when the update manifest names another revision. */
export const GET: RequestHandler = async ({ params, request }) => {
	const dev = await withContext(await deviceFromToken(request, params.id));
	const { image } = await configImage(dev);
	return new Response(image as BodyInit, {
		headers: {
			'content-type': 'application/octet-stream',
			'content-length': String(image.length),
			'cache-control': 'no-store'
		}
	});
};
