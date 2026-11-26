import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/** Only for a generated password; signed-in users change theirs in settings. */
export const load: PageServerLoad = ({ locals }) => {
	if (locals.user) redirect(303, '/settings');
};
