import { error } from '@sveltejs/kit';
import { deviceFromToken, report } from '#lib/server/deploy.ts';
import type { RequestHandler } from './$types';

/** `{slot, state, version, running, config?, message?}` from the device (or relayed by its hub). */
export const POST: RequestHandler = async ({ params, request }) => {
	const dev = await deviceFromToken(request, params.id);
	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	if (!body) error(400, 'JSON body expected');
	const slot = String(body.slot ?? 'main');
	if (!/^[a-z0-9-]{1,24}$/.test(slot)) error(400, 'invalid slot');
	await report(dev, {
		slot,
		state: String(body.state ?? '').slice(0, 24),
		version: Number(body.version) || 0,
		running: Number(body.running) || 0,
		config:
			typeof body.config === 'string' && /^[0-9a-f]{0,16}$/.test(body.config)
				? body.config
				: undefined,
		message: typeof body.message === 'string' ? body.message.slice(0, 200) : undefined
	});
	return new Response(null, { status: 204 });
};
