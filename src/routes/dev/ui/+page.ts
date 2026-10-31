import { dev } from '$app/env';
import { error } from '@sveltejs/kit';

// Device UI modules touch `document` when imported.
export const ssr = false;

export function load() {
	if (!dev) error(404, 'Not found');
}
