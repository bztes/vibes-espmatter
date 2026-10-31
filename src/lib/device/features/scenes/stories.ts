import type { Story } from '../../stories';
import { anna, api as matterApi, userApi } from '../matter-controller/stories';
import ScenesPanel from './device-ui/ScenesPanel.svelte';
import SharingPanel from './device-ui/SharingPanel.svelte';
import type { Scene, ScenesResponse } from './device-ui/scenes';

const scenes: Scene[] = [
	{
		id: 1,
		name: 'Evening',
		owner: 'admin',
		shared: ['anna'],
		endpoints: [
			{ node: 1, endpoint: 1, on: true, level: 120, mireds: 400 },
			{ node: 2, endpoint: 1, on: true, level: 60, mireds: 0 },
			{ node: 3, endpoint: 1, on: false, level: 0, mireds: 0 }
		]
	},
	{
		id: 2,
		name: 'All off',
		owner: 'admin',
		shared: [],
		endpoints: [
			{ node: 1, endpoint: 1, on: false, level: 0, mireds: 0 },
			{ node: 2, endpoint: 1, on: false, level: 0, mireds: 0 },
			{ node: 3, endpoint: 1, on: false, level: 0, mireds: 0 }
		]
	},
	{
		id: 3,
		name: 'Reading',
		owner: 'anna',
		endpoints: [{ node: 1, endpoint: 1, on: true, level: 254, mireds: 250 }]
	}
];

const response = (list: Scene[]): ScenesResponse => ({
	max: 16,
	maxEndpoints: 8,
	count: list.length,
	scenes: list
});

export const api = { ...matterApi, '/api/scenes': response(scenes) };
export const annasApi = {
	...userApi,
	'/api/scenes': response([{ ...scenes[0], shared: undefined }, scenes[2]])
};

export default [
	{ name: 'Scenes', component: ScenesPanel, api },
	{ name: 'Scenes (user)', component: ScenesPanel, api: annasApi, session: anna },
	{ name: 'Scenes (none)', component: ScenesPanel, api: { ...api, '/api/scenes': response([]) } },
	{ name: 'Sharing', component: SharingPanel, api }
] satisfies Story[];
