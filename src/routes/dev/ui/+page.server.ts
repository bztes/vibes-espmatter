import { error } from '@sveltejs/kit';
import { dev } from '$app/env';
import type { PageServerLoad } from './$types';

/** Hidden developer view: always in dev, for admins in production. Not linked anywhere. */
export const load: PageServerLoad = ({ locals }) => {
	if (!dev && locals.user?.role !== 'admin') error(404, 'Not found');
};
