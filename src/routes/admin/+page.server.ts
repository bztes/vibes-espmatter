import { redirect } from '@sveltejs/kit';
import { requireAdmin } from '#lib/server/auth.ts';
import type { PageServerLoad } from './$types';

// Admins only; to everyone else signed in, the page doesn't exist.
export const load: PageServerLoad = ({ locals }) => {
	if (!locals.user) redirect(303, '/login?redirectTo=/admin');
	requireAdmin();
};
