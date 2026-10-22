import type { DeviceApiRoute } from '../../types';

/** Route of `espm_scenes.cpp`. */
export const api: DeviceApiRoute[] = [
	{
		method: 'GET',
		path: '/api/scenes',
		summary: 'Scenes',
		description:
			'Users get their own scenes and those shared with them, admins all. `shared` (the users it’s shared with) only for its owner and admins. Per light: `level` 0–254 and `mireds` 0 = unchanged.',
		access: 'user',
		response: {
			max: 16,
			maxLights: 12,
			count: 1,
			scenes: [
				{
					id: 1,
					name: 'Movie night',
					owner: 'anna',
					shared: ['ben'],
					lights: [
						{ node: 1, endpoint: 1, on: true, level: 60, mireds: 400 },
						{ node: 2, endpoint: 1, on: false, level: 0, mireds: 0 }
					]
				}
			]
		}
	},
	{
		method: 'POST',
		path: '/api/scenes',
		summary: 'Add, change, delete, run or share a scene',
		description:
			'`add` answers `{"id": …}` and needs control of every light; `set` and `delete`: its owner or admins; `run`: also the users it’s shared with (then all its lights, else only the ones the caller may control); `share` (admins only) replaces whom it’s shared with.',
		access: 'user',
		params: [
			{
				name: 'op',
				type: 'string',
				description: '`add`, `set`, `delete`, `run` or `share`',
				required: true
			},
			{ name: 'id', type: 'number', description: '`set`, `delete`, `run`, `share`: the scene' },
			{ name: 'name', type: 'string', description: 'Name, 1–23 characters' },
			{
				name: 'lights',
				type: 'string',
				description:
					'Comma-separated `node:endpoint:on:level:mireds` (on 0/1), e.g. `0x1:1:1:200:370` (max. 12)'
			},
			{ name: 'users', type: 'string', description: '`share`: comma-separated user names' }
		],
		response: { ok: true }
	}
];
