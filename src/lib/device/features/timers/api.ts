import type { DeviceApiRoute } from '../../types';

/** Route of `espm_timers.cpp`. */
export const api: DeviceApiRoute[] = [
	{
		method: 'GET',
		path: '/api/timers',
		summary: 'Timers and the device clock',
		description:
			'Everyone gets the timers of the endpoints they may control. `minute`: minutes after midnight, local time; `days`: bit 0 = Sunday … bit 6 = Saturday, 0 = once (then `remaining` seconds). `level` and `startLevel` 0–254, `mireds` 0 = unchanged, `fade` in seconds.',
		access: 'user',
		response: {
			clock: { synced: true, tz: 'Europe/Berlin', minute: 1260, weekday: 3 },
			max: 32,
			count: 1,
			timers: [
				{
					id: 1,
					name: 'Wake up',
					node: 1,
					endpoint: 1,
					enabled: true,
					days: 62,
					minute: 420,
					action: 'on',
					level: 254,
					mireds: 250,
					fade: 900,
					startLevel: 1,
					startMireds: 454
				}
			]
		}
	},
	{
		method: 'POST',
		path: '/api/timers',
		summary: 'Add, change, delete or run a timer; set the time zone',
		description:
			'`add` answers `{"id": …}`; `set` changes only the fields it gets; `run` tries a timer out now. `timezone` (admins only) sets `name` and its POSIX `rule` for everyone’s timers.',
		access: 'user',
		params: [
			{
				name: 'op',
				type: 'string',
				description: '`add`, `set`, `delete`, `run` or `timezone`',
				required: true
			},
			{ name: 'id', type: 'number', description: '`set`, `delete`, `run`: the timer' },
			{ name: 'node', type: 'number', description: 'Node of the endpoint' },
			{ name: 'endpoint', type: 'number', description: 'Endpoint (light or plug)' },
			{ name: 'name', type: 'string', description: 'Name; `timezone`: e.g. `Europe/Berlin`' },
			{ name: 'enabled', type: 'boolean', description: '`true` or `false`' },
			{ name: 'minute', type: 'number', description: 'Time of day: minutes after midnight' },
			{ name: 'days', type: 'number', description: 'Weekdays (bit 0 = Sunday), 1–127' },
			{ name: 'in', type: 'number', description: 'Once, in 1–1440 minutes (instead of days)' },
			{ name: 'action', type: 'string', description: '`on`, `off` or `adjust`' },
			{ name: 'level', type: 'number', description: 'Brightness 0–254 (0: unchanged)' },
			{ name: 'mireds', type: 'number', description: 'Color temperature 50–1000 (0: unchanged)' },
			{ name: 'fade', type: 'number', description: 'Fade over this many seconds (max. 3600)' },
			{ name: 'startLevel', type: 'number', description: 'Brightness the fade starts at' },
			{ name: 'startMireds', type: 'number', description: 'Color temperature the fade starts at' },
			{
				name: 'rule',
				type: 'string',
				description: '`timezone`: POSIX rule, e.g. `CET-1CEST,M3.5.0,M10.5.0/3`'
			}
		],
		response: { ok: true }
	}
];
