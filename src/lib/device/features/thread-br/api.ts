import type { DeviceApiRoute } from '../../types';

/** Routes of `espm_thread.cpp`. */
export const api: DeviceApiRoute[] = [
	{
		method: 'GET',
		path: '/api/thread',
		summary: 'Thread network, radio and neighbors',
		description:
			'`radio`: `waiting`, `starting` or `ready`; until it is ready only `radio` and `initialized: false`. `role`: `disabled`, `detached`, `child`, `router` or `leader`.',
		access: 'admin',
		response: {
			radio: 'ready',
			initialized: true,
			role: 'leader',
			commissioned: true,
			networkName: 'ESP-Matter',
			channel: 15,
			panId: '0x1234',
			extPanId: 'dead00beef00cafe',
			rloc16: '0x0400',
			extAddress: '1a2b3c4d5e6f7081',
			partitionId: 123456789,
			leaderRouterId: 1,
			omrPrefix: 'fd12:3456:789a:1::/64',
			neighbors: [
				{
					extAddress: '0011223344556677',
					rloc16: '0x0401',
					child: true,
					ftd: false,
					rxOnWhenIdle: false,
					rssi: -60,
					lqi: 3,
					age: 4,
					version: 4
				}
			],
			children: [
				{
					extAddress: '0011223344556677',
					rloc16: '0x0401',
					timeout: 240,
					age: 4,
					rssi: -60,
					rxOnWhenIdle: false
				}
			]
		}
	},
	{
		method: 'GET',
		path: '/api/thread/dataset',
		summary: 'Active operational dataset',
		description:
			'The TLVs as hex, e.g. to join other border routers or controllers to this network. 404 before a network is formed.',
		access: 'admin',
		response: { tlvs: '0e080000000000010000000300000f35060004001fffe0…' }
	},
	{
		method: 'POST',
		path: '/api/thread/form',
		summary: 'Form a new Thread network',
		description:
			'Replaces the current network: paired Thread devices must be paired again. Runs in the background; follow it with `GET /api/thread`. 503 while the radio is not connected.',
		access: 'admin',
		response: { ok: true }
	}
];
