import { api } from '#sdk/device-ui';

/** Activate or deactivate a scene: how many endpoints were skipped (no access). */
export async function runScene(id: number, activate: boolean) {
	const res = await api<{ skipped: number }>(
		`/api/v1/controller/scenes/${id}/${activate ? 'activate' : 'deactivate'}`,
		{ method: 'POST' }
	);
	return res.skipped ?? 0;
}
