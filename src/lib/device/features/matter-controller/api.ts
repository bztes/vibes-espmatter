import type { DeviceApiRoute } from '../../types';

const NODE_ID = { name: 'id', type: 'string', description: 'Node id (decimal or 0x hex)' } as const;

/** Routes of `espm_matter.cpp` and `espm_matter_access.cpp`. */
export const api: DeviceApiRoute[] = [
	{
		method: 'GET',
		path: '/api/matter/nodes',
		summary: 'Paired devices with their endpoints and last known state',
		description:
			'Users get only the endpoints they were given (`/api/matter/access`); those they may only view have `readOnly: true`. Light state, sensor values and `switchFeatures` (FeatureMap of a button’s Switch cluster) appear once read or reported; temperature in 0.01 °C, humidity in 0.01 %, ages and `lastSeen` in seconds.',
		access: 'user',
		response: {
			nodes: [
				{
					id: 1,
					name: 'Desk lamp',
					vendor: 'IKEA',
					product: 'TRADFRI bulb',
					vendorId: 4476,
					productId: 1,
					network: 'thread',
					tags: ['Living room'],
					lastSeen: 12,
					endpoints: [
						{
							id: 1,
							deviceType: 268,
							on: true,
							level: 200,
							ctMireds: 370,
							ctMinMireds: 153,
							ctMaxMireds: 454
						}
					]
				}
			],
			capacity: 32
		}
	},
	{
		method: 'POST',
		path: '/api/matter/pair',
		summary: 'Start pairing a device',
		description:
			'Pairing runs in the background: poll `GET /api/matter/pair`. 409 if a pairing is running already or could not start (e.g. no Thread network yet).',
		access: 'admin',
		params: [
			{
				name: 'code',
				type: 'string',
				description: 'Setup code: QR payload (`MT:…`) or manual pairing code',
				required: true
			},
			{ name: 'name', type: 'string', description: 'Name of the new device' },
			{
				name: 'network',
				type: 'string',
				description:
					'`thread` (default), `wifi` (gets this device’s Wi-Fi) or anything else for a device already on the network'
			}
		],
		response: { ok: true, nodeId: 2 }
	},
	{
		method: 'GET',
		path: '/api/matter/pair',
		summary: 'State of the last pairing',
		description: '`state`: `idle`, `running`, `success` or `failed`; `elapsed` (s) while running.',
		access: 'admin',
		response: { state: 'running', nodeId: 2, error: '', elapsed: 14 }
	},
	{
		method: 'POST',
		path: '/api/matter/node',
		summary: 'Act on a paired device',
		description:
			'`rename` (`name`), `tag` (`tags`), `refresh` (read vendor, product and endpoints again), `state` (read light state now), `invoke` (send a cluster command), `remove` (unpair, then forget) or `forget` (only drop it here). Users may only `state` the devices they see and `invoke` On/Off, Level Control and Color Control on the lights they control.',
		access: 'user',
		params: [
			{ ...NODE_ID, required: true },
			{
				name: 'action',
				type: 'string',
				description: '`rename`, `tag`, `refresh`, `state`, `invoke`, `remove` or `forget`',
				required: true
			},
			{ name: 'name', type: 'string', description: '`rename`: the new name' },
			{
				name: 'tags',
				type: 'string',
				description: '`tag`: comma-separated tags (max. 63 characters); empty: none'
			},
			{ name: 'endpoint', type: 'number', description: '`invoke`: endpoint id' },
			{ name: 'cluster', type: 'number', description: '`invoke`: cluster id, e.g. `6` (On/Off)' },
			{ name: 'command', type: 'number', description: '`invoke`: command id, e.g. `2` (Toggle)' },
			{
				name: 'data',
				type: 'string',
				description:
					'`invoke`: command fields as JSON in esp-matter’s format, e.g. `{"0:U8": 128, "1:U16": 5}`'
			}
		],
		response: { ok: true }
	},
	{
		method: 'GET',
		path: '/api/matter/access',
		summary: 'The lights and sensors each user may see and control',
		description: '`readOnly`: the user only sees the endpoint, without controlling it.',
		access: 'admin',
		response: {
			max: 16,
			users: {
				anna: [
					{ node: 1, endpoint: 1 },
					{ node: 2, endpoint: 1, readOnly: true }
				]
			}
		}
	},
	{
		method: 'POST',
		path: '/api/matter/access',
		summary: 'Set the lights and sensors of a user',
		access: 'admin',
		params: [
			{ name: 'user', type: 'string', description: 'User name', required: true },
			{
				name: 'lights',
				type: 'string',
				description: 'Comma-separated `node:endpoint` pairs the user controls; empty: none',
				required: true
			},
			{
				name: 'view',
				type: 'string',
				description:
					'Comma-separated `node:endpoint` pairs the user only sees (max. 16 together with `lights`)'
			}
		],
		response: { ok: true }
	}
];
