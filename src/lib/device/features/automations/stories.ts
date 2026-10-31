import type { Story } from '../../stories';
import { api as matterApi } from '../matter-controller/stories';
import AutomationPanel from './device-ui/AutomationPanel.svelte';

export const api = {
	...matterApi,
	'/api/automations': {
		rules: [
			{
				id: 0,
				mode: 'hub',
				srcNode: 5,
				srcEndpoint: 1,
				trigger: 'press',
				action: 'toggle',
				dstNode: 1,
				dstEndpoint: 1
			},
			{
				id: 1,
				mode: 'hub',
				srcNode: 5,
				srcEndpoint: 1,
				trigger: 'hold',
				action: 'dim_up',
				dstNode: 1,
				dstEndpoint: 1
			},
			{
				id: 2,
				mode: 'hub',
				srcNode: 5,
				srcEndpoint: 2,
				trigger: 'double',
				action: 'off',
				dstNode: 3,
				dstEndpoint: 1
			},
			{
				id: 3,
				mode: 'hub',
				srcNode: 9,
				srcEndpoint: 1,
				trigger: 'press',
				action: 'on',
				dstNode: 2,
				dstEndpoint: 1
			}
		]
	}
};

export default [
	{ name: 'Panel', component: AutomationPanel, api },
	{
		name: 'Panel (no rules)',
		component: AutomationPanel,
		api: { ...api, '/api/automations': { rules: [] } }
	}
] satisfies Story[];
