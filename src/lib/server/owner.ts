/** Who owns a saved device: the signed-in user that saved it. */
import type { RequestEvent } from '@sveltejs/kit';
import { and, eq, type SQL } from 'drizzle-orm';
import { db } from './db/index.ts';
import { project } from './db/schema.ts';

/** Condition for the caller's projects, `undefined` if they can't own any. */
export function ownedBy(event: RequestEvent): SQL | undefined {
	return event.locals.user ? eq(project.userId, event.locals.user.id) : undefined;
}

/** The caller's project with this id, if they own it. */
export async function findOwnedProject(event: RequestEvent, id: string) {
	const owned = ownedBy(event);
	if (!owned) return undefined;
	const [row] = await db
		.select()
		.from(project)
		.where(and(eq(project.id, id), owned));
	return row;
}
