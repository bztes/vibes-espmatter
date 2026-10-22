import type { DeviceApiRoute } from '../../types';

/** Route of `espm_automation.cpp`. */
export const api: DeviceApiRoute[] = [
	{
		method: 'GET',
		path: '/api/automations',
		summary: 'Button rules',
		description:
			'What a button press (`src…`) does to a light (`dst…`). `id`: position in the list.',
		access: 'admin',
		response: {
			rules: [
				{
					id: 0,
					mode: 'hub',
					srcNode: 3,
					srcEndpoint: 1,
					trigger: 'press',
					action: 'toggle',
					dstNode: 1,
					dstEndpoint: 1
				}
			]
		}
	},
	{
		method: 'POST',
		path: '/api/automations',
		summary: 'Add or delete a button rule',
		description:
			'`dim_up`, `dim_down`, `warmer_hold` and `cooler_hold` run while the button is held: only with the `hold` trigger. Deleting shifts the ids of the rules after it.',
		access: 'admin',
		params: [
			{ name: 'op', type: 'string', description: '`add` or `delete`', required: true },
			{ name: 'id', type: 'number', description: '`delete`: the rule' },
			{ name: 'src', type: 'number', description: '`add`: node of the button' },
			{ name: 'srcEndpoint', type: 'number', description: '`add`: endpoint of the button' },
			{ name: 'dst', type: 'number', description: '`add`: node of the light' },
			{ name: 'dstEndpoint', type: 'number', description: '`add`: endpoint of the light' },
			{ name: 'trigger', type: 'string', description: '`press`, `double` or `hold`' },
			{
				name: 'action',
				type: 'string',
				description:
					'`toggle`, `on`, `off`, `brighter`, `darker`, `warmer`, `cooler`, `dim_up`, `dim_down`, `warmer_hold`, `cooler_hold`'
			}
		],
		response: { ok: true }
	}
];
