import type { Story } from '#sdk/device-ui';
import AccountsWidget from './ui/AccountsWidget.svelte';
import AutomationsWidget from './ui/AutomationsWidget.svelte';
import DevicesWidget from './ui/DevicesWidget.svelte';
import NodesWidget from './ui/NodesWidget.svelte';
import ScenesWidget from './ui/ScenesWidget.svelte';

const ok = { ok: true };

const AUTOMATION_NODES = [
	{
		id: 16,
		name: 'Desk lamp',
		state: 'online',
		online: true,
		endpoints: [
			{
				id: 1,
				deviceTypes: [0x010c],
				clusters: [0x06, 0x08, 0x0300],
				on: true,
				level: 180,
				colorTemperature: 370,
				colorTempMin: 153,
				colorTempMax: 454
			}
		]
	},
	{
		id: 19,
		name: 'Relay board',
		state: 'online',
		online: true,
		endpoints: [
			{ id: 1, deviceTypes: [0x010a], clusters: [0x06], on: false },
			{ id: 2, deviceTypes: [0x010a], clusters: [0x06], on: true }
		]
	},
	{
		id: 22,
		name: 'Hallway remote',
		state: 'online',
		online: true,
		endpoints: [
			{ id: 1, deviceTypes: [0x000f], clusters: [0x3b], switchFeatures: 0x1e },
			{ id: 2, deviceTypes: [0x000f], clusters: [0x3b], switchFeatures: 0x1e }
		]
	},
	{
		id: 25,
		name: 'Living room window',
		state: 'online',
		online: true,
		endpoints: [{ id: 1, deviceTypes: [0x0015], clusters: [0x45], stateValue: true }]
	},
	{
		id: 26,
		name: 'Living room thermostat',
		state: 'online',
		online: true,
		endpoints: [
			{
				id: 1,
				deviceTypes: [0x0301],
				clusters: [0x0201],
				localTemperature: 20.5,
				systemMode: 4,
				heatingSetpoint: 21,
				controlSequence: 2
			}
		]
	}
];

const SCENES = {
	max: 16,
	scenes: [
		{
			id: 1,
			name: 'Morning',
			owner: 'admin',
			mine: true,
			access: 'write',
			active: true,
			members: [{ node: 16, endpoint: 1, on: true, level: 230, colorTemperature: 250 }]
		},
		{
			id: 2,
			name: 'Movie night',
			owner: 'admin',
			mine: true,
			access: 'write',
			active: false,
			members: [
				{ node: 16, endpoint: 1, on: true, level: 50, colorTemperature: 454 },
				{ node: 19, endpoint: 2, on: false }
			]
		},
		{
			id: 3,
			name: 'Balcony',
			owner: 'anna',
			mine: false,
			access: 'write',
			active: false,
			members: [{ node: 19, endpoint: 1, on: true }]
		}
	]
};

export default [
	{
		name: 'Devices',
		component: NodesWidget,
		wide: true,
		plain: true,
		api: {
			'POST /api/v1/controller/invoke': ok,
			'POST /api/v1/controller/write': ok,
			'/api/v1/controller/nodes': {
				nodes: [
					{
						id: 16,
						name: 'Desk lamp',
						state: 'online',
						online: true,
						tags: ['Living room', 'Lights'],
						endpoints: [
							{
								id: 1,
								deviceTypes: [0x010c],
								clusters: [0x03, 0x04, 0x06, 0x08, 0x1d, 0x0300],
								on: true,
								level: 180,
								colorTemperature: 370,
								colorTempMin: 153,
								colorTempMax: 500
							}
						]
					},
					{
						id: 17,
						name: 'Heat pump',
						state: 'online',
						online: true,
						endpoints: [
							{
								id: 1,
								deviceTypes: [0x0072],
								clusters: [0x03, 0x04, 0x06, 0x1d, 0x0201, 0x0202],
								on: true,
								localTemperature: 20.5,
								systemMode: 4,
								heatingSetpoint: 22,
								coolingSetpoint: 22,
								controlSequence: 4,
								fanMode: 5
							}
						]
					},
					{
						id: 18,
						name: 'Living room climate',
						state: 'online',
						online: true,
						tags: ['Living room'],
						battery: 18,
						endpoints: [
							{
								id: 1,
								deviceTypes: [0x0302],
								temperature: 21.42
							},
							{
								id: 2,
								deviceTypes: [0x0307],
								humidity: 47.8
							}
						]
					},
					{
						id: 19,
						name: 'Relay board',
						state: 'online',
						online: true,
						endpoints: [
							{ id: 1, deviceTypes: [0x010a], on: true },
							{ id: 2, deviceTypes: [0x010a], on: false }
						]
					},
					{
						id: 20,
						name: 'Front door',
						state: 'online',
						online: true,
						tags: ['Hallway'],
						batteryLevel: 'critical',
						endpoints: [{ id: 1, deviceTypes: [0x0015], stateValue: false }]
					},
					{
						id: 21,
						name: 'Bedroom blind',
						state: 'online',
						online: true,
						endpoints: [{ id: 1, deviceTypes: [0x0202], closedPercent: 35 }]
					},
					{
						id: 22,
						name: 'Hallway switch',
						state: 'online',
						online: true,
						tags: ['Hallway'],
						endpoints: [{ id: 1, deviceTypes: [0x0103], clusters: [0x03, 0x1d] }]
					},
					{
						id: 25,
						name: 'Washing machine',
						state: 'online',
						online: true,
						endpoints: [
							{
								id: 1,
								deviceTypes: [0x010a, 0x0510],
								clusters: [0x06, 0x90, 0x91],
								on: true,
								power: 412.6,
								energy: 183.42
							}
						]
					},
					{
						id: 23,
						name: 'Balcony plug',
						state: 'offline',
						online: false,
						endpoints: []
					},
					{
						id: 24,
						name: 'New sensor',
						state: 'connecting',
						online: false,
						endpoints: []
					}
				]
			}
		}
	},
	{
		name: 'Devices (empty)',
		component: NodesWidget,
		api: { '/api/v1/controller/nodes': { nodes: [] } }
	},
	{
		name: 'Devices (user)',
		component: NodesWidget,
		wide: true,
		api: {
			'/api/v1/controller/nodes': {
				nodes: [
					{
						id: 16,
						name: 'Desk lamp',
						state: 'online',
						online: true,
						access: 'write',
						endpoints: [
							{
								id: 1,
								access: 'write',
								deviceTypes: [0x0101],
								clusters: [0x03, 0x04, 0x06, 0x08, 0x1d],
								on: true,
								level: 180
							}
						]
					},
					{
						id: 19,
						name: 'Relay board',
						state: 'online',
						online: true,
						access: 'read',
						endpoints: [
							{ id: 1, access: 'read', deviceTypes: [0x010a], on: true },
							{ id: 2, access: 'write', deviceTypes: [0x010a], on: false }
						]
					}
				]
			}
		}
	},
	{
		name: 'Accounts',
		page: 'settings',
		component: AccountsWidget,
		tab: 'Accounts',
		wide: true,
		api: {
			'/api/v1/auth/accounts': {
				accounts: [
					{ id: 0, name: 'admin', admin: true, builtin: true },
					{ id: 1, name: 'maria', admin: true, grants: {} },
					{ id: 2, name: 'anna', admin: false, grants: { n16: 2, n19: 1, 'n19.2': 2, s2: 1 } },
					{ id: 3, name: 'guest', admin: false, mustChange: true, grants: {} }
				]
			},
			'POST /api/v1/auth/accounts': {
				id: 4,
				name: 'new',
				admin: false,
				mustChange: true,
				grants: {},
				password: 'h7KmQ2xR9pLw4z'
			},
			'/api/v1/controller/scenes': SCENES,
			'/api/v1/controller/nodes': {
				nodes: [
					{
						id: 16,
						name: 'Desk lamp',
						state: 'online',
						online: true,
						endpoints: [{ id: 1, deviceTypes: [0x0101], clusters: [0x06, 0x08] }]
					},
					{
						id: 19,
						name: 'Relay board',
						state: 'online',
						online: true,
						endpoints: [
							{ id: 1, deviceTypes: [0x010a] },
							{ id: 2, deviceTypes: [0x010a] }
						]
					},
					{
						id: 21,
						name: 'Bedroom blind',
						state: 'offline',
						online: false,
						endpoints: []
					}
				]
			}
		}
	},
	{
		name: 'Manage devices',
		page: 'settings',
		component: DevicesWidget,
		tab: 'Devices',
		wide: true,
		api: {
			'POST /api/v1/controller/pair': { ok: true, nodeId: 25 },
			'/api/v1/controller/pair': { state: 'done' },
			'/api/v1/controller/nodes': {
				nodes: [
					{
						id: 16,
						name: 'Desk lamp',
						state: 'online',
						online: true,
						tags: ['Living room', 'Lights'],
						vendor: 'IKEA of Sweden',
						product: 'KAJPLATS E27 WS',
						softwareVersion: '1.1.4',
						lastSeenAgo: 3,
						lastSeen: 1793924000,
						diagnostics: { uptime: 412000, rebootCount: 4 },
						endpoints: [{ id: 1, deviceTypes: [0x010c], clusters: [0x06, 0x08, 0x0300] }]
					},
					{
						id: 18,
						name: 'Living room climate',
						state: 'online',
						online: true,
						tags: ['Living room'],
						vendor: 'IKEA of Sweden',
						product: 'TIMMERFLOTTE',
						softwareVersion: '1.0.9',
						battery: 18,
						batteryLevel: 'warning',
						lastSeenAgo: 240,
						endpoints: [
							{ id: 1, deviceTypes: [0x0302], clusters: [0x0402] },
							{ id: 2, deviceTypes: [0x0307], clusters: [0x0405] }
						]
					},
					{
						id: 22,
						name: 'Hallway remote',
						state: 'online',
						online: true,
						tags: ['Hallway'],
						vendor: 'IKEA of Sweden',
						product: 'BILRESA',
						battery: 87,
						lastSeenAgo: 5400,
						endpoints: [{ id: 1, deviceTypes: [0x000f], clusters: [0x3b] }]
					},
					{
						id: 23,
						name: 'Balcony plug',
						state: 'offline',
						online: false,
						tags: [],
						lastSeenAgo: 190000,
						endpoints: []
					},
					{ id: 24, name: 'New sensor', state: 'connecting', online: false, endpoints: [] }
				]
			}
		}
	},
	{
		name: 'Automations',
		page: 'automations',
		component: AutomationsWidget,
		tab: 'Automations',
		wide: true,
		api: {
			'POST /api/v1/controller/automations': { ok: true, id: 4 },
			'/api/v1/controller/automations': {
				clock: { synced: true, minute: 452, weekday: 5, zone: 'CET', now: 1793950320 },
				max: 32,
				rules: [
					{
						id: 5,
						name: 'Tea',
						enabled: true,
						owner: 'admin',
						mine: true,
						active: true,
						trigger: { type: 'once', at: 1793950320 + 8 * 60 },
						actions: [{ type: 'endpoint', node: 19, endpoint: 1, command: 'off' }]
					},
					{
						id: 1,
						name: '',
						enabled: true,
						owner: 'admin',
						mine: true,
						active: true,
						trigger: { type: 'button', node: 22, endpoint: 1, gesture: 'press' },
						actions: [{ type: 'endpoint', node: 16, endpoint: 1, command: 'toggle' }]
					},
					{
						id: 2,
						name: 'Morning',
						enabled: true,
						owner: 'admin',
						mine: true,
						active: true,
						trigger: { type: 'time', minute: 420, days: 0x3e },
						actions: [{ type: 'scene', scene: 1, command: 'activate' }]
					},
					{
						id: 3,
						name: 'Night light',
						enabled: false,
						owner: 'admin',
						mine: true,
						active: false,
						trigger: { type: 'time', minute: 1350, days: 0x7f },
						actions: [{ type: 'endpoint', node: 16, endpoint: 1, command: 'level', level: 25 }]
					},
					{
						id: 4,
						name: '',
						enabled: true,
						owner: 'anna',
						mine: false,
						active: false,
						problem: 'no access to the device any more',
						trigger: { type: 'button', node: 22, endpoint: 2, gesture: 'double' },
						actions: [{ type: 'endpoint', node: 19, endpoint: 2, command: 'off' }]
					},
					{
						id: 6,
						name: 'Airing',
						enabled: true,
						owner: 'admin',
						mine: true,
						active: true,
						trigger: {
							type: 'value',
							node: 25,
							endpoint: 1,
							key: 'stateValue',
							below: 0.5,
							for: 120
						},
						actions: [
							{
								type: 'write',
								node: 26,
								endpoint: 1,
								cluster: 0x0201,
								attribute: 0x1c,
								valueType: 'U8',
								value: 0,
								preset: 'systemMode',
								arg: 0
							}
						]
					},
					{
						id: 7,
						name: '',
						enabled: true,
						owner: 'admin',
						mine: true,
						active: true,
						trigger: {
							type: 'value',
							node: 26,
							endpoint: 1,
							key: 'localTemperature',
							below: 18,
							hysteresis: 0.5
						},
						actions: [
							{
								type: 'write',
								node: 26,
								endpoint: 1,
								cluster: 0x0201,
								attribute: 0x12,
								valueType: 'I16',
								value: 2200,
								preset: 'heatingSetpoint',
								arg: 22
							}
						]
					}
				]
			},
			'/api/v1/controller/scenes': SCENES,
			'/api/v1/controller/nodes': { nodes: AUTOMATION_NODES }
		}
	},
	{
		name: 'Automations (no switch, no clock)',
		page: 'automations',
		component: AutomationsWidget,
		tab: 'Automations',
		api: {
			'/api/v1/controller/automations': { clock: { synced: false }, max: 32, rules: [] },
			'/api/v1/controller/scenes': { max: 16, scenes: [] },
			'/api/v1/controller/nodes': {
				nodes: [
					{
						id: 16,
						name: 'Desk lamp',
						state: 'online',
						online: true,
						endpoints: [{ id: 1, deviceTypes: [0x0101], clusters: [0x06, 0x08] }]
					}
				]
			}
		}
	},
	{
		name: 'Scenes',
		component: ScenesWidget,
		wide: true,
		plain: true,
		api: {
			'POST /api/v1/controller/scenes': { ok: true, id: 3 },
			'/api/v1/controller/scenes': SCENES,
			'/api/v1/controller/nodes': { nodes: AUTOMATION_NODES }
		}
	}
] satisfies Story[];
