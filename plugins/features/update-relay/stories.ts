import type { Story } from '#sdk/device-ui';
import RelayWidget from './ui/RelayWidget.svelte';

export default [
	{
		name: 'Statistics',
		page: 'settings',
		component: RelayWidget,
		tab: 'System',
		api: {
			'/api/v1/relay': {
				requests: 128,
				transfers: 3,
				bytes: 4718592,
				lastDevice: '6f1c2e4a',
				lastError: ''
			}
		}
	}
] satisfies Story[];
