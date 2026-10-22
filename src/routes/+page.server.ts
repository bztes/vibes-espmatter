import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// Only for signed-in users; the login page creates the first account while there is none.
export const load: PageServerLoad = ({ locals }) => {
	if (!locals.user) redirect(303, '/login');
};
