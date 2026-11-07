import { defineFeature } from '#sdk';

export default defineFeature({
	type: 'feature',
	id: 'admin-ui',
	name: 'Admin UI',
	description:
		'An admin page served by the device itself: network, pairing, firmware, system – whatever the other features put there.',
	icon: 'settings',
	kinds: ['hub', 'device'],
	defaultOn: ['hub'],
	needs: ['ip'],
	provides: ['ui-page:settings'],
	requires: { minFlashMB: 4 },
	validate({ has }) {
		return has('thread') && !has('uplink')
			? [
					{
						severity: 'info',
						message:
							'Reachable over Thread only (IPv6 through the border router) – loading is slow.'
					}
				]
			: [];
	},
	contribute(_ctx, out) {
		// The admin page (id `settings`: plugins put their widgets there), its widgets grouped in tabs.
		out.page({
			id: 'settings',
			title: 'Admin',
			icon: 'settings',
			path: '/admin',
			order: 90,
			menu: true
		});
	}
});
