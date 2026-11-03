import type { Story } from '../../stories';
import AccessPanel from './device-ui/AccessPanel.svelte';
import MatterPanel from './device-ui/MatterPanel.svelte';
import TilesPanel from './device-ui/TilesPanel.svelte';
import type { MatterNode } from './device-ui/matter';

/** Paired nodes, also used by the stories of features that show Matter devices. */
export const nodes: MatterNode[] = [
	{
		id: 1,
		name: 'Living room lamp',
		vendor: 'IKEA',
		product: 'TRADFRI bulb',
		network: 'thread',
		tags: ['Living room'],
		lastSeen: 12,
		endpoints: [
			{
				id: 1,
				deviceType: 0x010c,
				on: true,
				level: 180,
				ctMireds: 370,
				ctMinMireds: 153,
				ctMaxMireds: 454
			}
		]
	},
	{
		id: 2,
		name: 'Desk lamp',
		vendor: 'Nanoleaf',
		product: 'Essentials A19',
		network: 'thread',
		tags: ['Office'],
		lastSeen: 40,
		endpoints: [{ id: 1, deviceType: 0x0101, on: false, level: 100 }]
	},
	{
		id: 3,
		name: 'Coffee machine',
		vendor: 'Eve',
		product: 'Energy',
		network: 'thread',
		tags: ['Kitchen'],
		lastSeen: 5,
		power: { mw: 1_240_000, endpoint: 2, age: 8 },
		endpoints: [
			{ id: 1, deviceType: 0x010a, on: true },
			{ id: 2, deviceType: 0x0510 }
		]
	},
	{
		id: 4,
		name: 'Bedroom climate',
		vendor: 'Aqara',
		product: 'TVOC monitor',
		network: 'thread',
		tags: ['Bedroom'],
		lastSeen: 300,
		battery: { percent: 18, level: 'warning', age: 3600 },
		endpoints: [
			{ id: 1, deviceType: 0x0302, temperature: 2140, measuredAge: 120 },
			{ id: 2, deviceType: 0x0307, humidity: 4870, measuredAge: 120 }
		]
	},
	{
		id: 5,
		name: 'Hallway remote',
		vendor: 'IKEA',
		product: 'RODRET dimmer',
		network: 'thread',
		tags: [],
		lastSeen: 2400,
		battery: { percent: 85, age: 7200 },
		endpoints: [
			{ id: 1, deviceType: 0x000f, switchFeatures: 0x16 },
			{ id: 2, deviceType: 0x000f, switchFeatures: 0x16 }
		]
	},
	{
		id: 6,
		name: '',
		vendor: 'Meross',
		product: 'Smart Plug Mini',
		network: 'wifi',
		tags: [],
		lastSeen: null,
		endpoints: [{ id: 1, deviceType: 0x010a }]
	},
	{
		id: 7,
		name: 'Heat pump',
		vendor: 'vibes-espmatter',
		product: 'Panasonic heat pump',
		network: 'wifi',
		tags: ['Living room'],
		lastSeen: 3,
		endpoints: [
			{
				id: 1,
				deviceType: 0x0072,
				on: true,
				climate: {
					temperature: 2050,
					outdoor: -320,
					heating: 2200,
					cooling: 2600,
					heatingMin: 1600,
					heatingMax: 3000,
					coolingMin: 1600,
					coolingMax: 3000,
					mode: 4,
					features: 0x23,
					fanMode: 5,
					fanSequence: 2,
					fanFeatures: 0x07,
					rock: 2,
					rockSupport: 3
				}
			}
		]
	},
	{
		id: 8,
		name: 'Bathroom floor',
		vendor: 'Eve',
		product: 'Thermo',
		network: 'thread',
		tags: ['Bathroom'],
		lastSeen: 600,
		battery: { percent: 64, age: 1800 },
		endpoints: [
			{
				id: 1,
				deviceType: 0x0301,
				climate: { temperature: 1980, heating: 2100, mode: 0, features: 0x01 }
			}
		]
	}
];

/** What the user `anna` sees: some of the devices, the desk lamp only to view. */
const annasNodes: MatterNode[] = [
	nodes[0],
	{ ...nodes[1], endpoints: [{ ...nodes[1].endpoints[0], readOnly: true }] },
	nodes[3],
	nodes[6]
];

export const api = {
	'/api/matter/nodes': { nodes, capacity: 16 },
	'/api/matter/pair': { state: 'idle' },
	'/api/matter/access': {
		max: 32,
		users: {
			anna: [
				{ node: 1, endpoint: 1 },
				{ node: 2, endpoint: 1, readOnly: true },
				{ node: 4, endpoint: 1 },
				{ node: 4, endpoint: 2 },
				{ node: 7, endpoint: 1 }
			]
		}
	},
	'/api/users': {
		users: [
			{ name: 'admin', role: 'admin' },
			{ name: 'anna', role: 'user' },
			{ name: 'ben', role: 'user' }
		]
	}
};

export const userApi = { ...api, '/api/matter/nodes': { nodes: annasNodes, capacity: 16 } };

export const anna = { user: 'anna', role: 'user' } as const;

export default [
	{ name: 'Devices', component: MatterPanel, api },
	{
		name: 'Devices (pairing)',
		component: MatterPanel,
		api: { ...api, '/api/matter/pair': { state: 'running', nodeId: 7, elapsed: 23 } }
	},
	{
		name: 'Devices (pairing failed)',
		component: MatterPanel,
		api: { ...api, '/api/matter/pair': { state: 'failed', error: 'PASE session timed out' } }
	},
	{
		name: 'Devices (none)',
		component: MatterPanel,
		api: { ...api, '/api/matter/nodes': { nodes: [], capacity: 16 } }
	},
	{ name: 'Tiles', component: TilesPanel, api, wide: true },
	{ name: 'Tiles (user)', component: TilesPanel, api: userApi, session: anna, wide: true },
	{ name: 'Access', component: AccessPanel, api }
] satisfies Story[];
