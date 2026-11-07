import type { Story } from '#sdk/device-ui';
import ThreadWidget from './ui/ThreadWidget.svelte';

const ok = {
	rcp: 'ok',
	role: 'leader',
	networkName: 'espmatter',
	channel: 15,
	panId: '0x1a2b',
	routers: 2,
	children: 5
};
const api = {
	'/api/v1/thread': ok,
	'/api/v1/thread/dataset': {
		tlvs: '0e080000000000010000000300000f35060004001fffe0020811111111222222220708fdad70bfe5aa15dd051000112233445566778899aabbccddeeff030f4f70656e546872656164446d6f'
	}
};

export default [
	{ name: 'Network', page: 'settings', component: ThreadWidget, tab: 'Network', api },
	{
		name: 'Radio starting',
		page: 'settings',
		component: ThreadWidget,
		tab: 'Network',
		api: { '/api/v1/thread': { rcp: 'starting' } }
	},
	{
		name: 'Radio updating',
		page: 'settings',
		component: ThreadWidget,
		tab: 'Network',
		api: { '/api/v1/thread': { rcp: 'updating' } }
	},
	{
		name: 'Radio offline',
		page: 'settings',
		component: ThreadWidget,
		tab: 'Network',
		api: { '/api/v1/thread': { rcp: 'no answer' } }
	}
] satisfies Story[];
