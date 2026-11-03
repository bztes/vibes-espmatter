import * as v from 'valibot';
import { error } from '@sveltejs/kit';
import { command, getRequestEvent, query } from '$app/server';
import { findOwnedProject } from '#lib/server/owner.ts';
import { versionString } from '#lib/device/util.ts';

// Loaded when called: the features' flash methods import this module, so the registry does, and the
// builder and updates import the generator, which needs the registry loaded.
const builder = () => import('#lib/server/builder/index.ts');
const updates = () => import('#lib/server/updates.ts');

const target = v.object({ buildId: v.pipe(v.string(), v.uuid()), role: v.string() });

/** The build of a device the caller owns. */
async function ownedBuild(buildId: string) {
	const row = await (await builder()).getBuild(buildId);
	if (!row?.projectId || !(await findOwnedProject(getRequestEvent(), row.projectId)))
		error(404, 'Only builds of your saved devices can be installed from here');
	return row;
}

/** Install the build on its chip: the board, or its hub, picks it up within a few minutes. */
export const startUpdate = command(target, async ({ buildId, role }) => {
	const { requestUpdate } = await updates();
	if (!(await requestUpdate(await ownedBuild(buildId), role))) error(409, 'Not a finished build');
});

/** The update of the build's chip – of this build or another one – as it goes on. */
export const updateState = query.live(target, async function* ({ buildId, role }) {
	const { projectId } = await ownedBuild(buildId);
	const { getUpdate, OPEN } = await updates();
	while (true) {
		const row = await getUpdate(projectId!, role);
		yield row && {
			buildId: row.buildId,
			state: row.state,
			message: row.message,
			version: versionString(row.version)
		};
		if (!row || !OPEN.includes(row.state)) return;
		await new Promise((r) => setTimeout(r, 3000));
	}
});
