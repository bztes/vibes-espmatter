import type { DeviceApiRoute } from '../../types';

const me = {
	authenticated: true,
	user: 'admin',
	role: 'admin',
	mustChangePassword: false,
	authEnabled: true
};

/** Routes of `espm_auth.cpp` and `espm_system.cpp`. */
export const api: DeviceApiRoute[] = [
	{
		method: 'POST',
		path: '/api/auth/login',
		summary: 'Log in',
		description:
			'Sets the session cookie `mesp_session` (HttpOnly, one year, survives reboots). After several wrong passwords in a row all password checks are locked for a while (429).',
		access: 'public',
		params: [
			{ name: 'user', type: 'string', description: 'User name', required: true },
			{ name: 'password', type: 'string', description: 'Password', required: true }
		],
		response: me
	},
	{
		method: 'POST',
		path: '/api/auth/logout',
		summary: 'Log out',
		description: 'Ends the session of the cookie.',
		access: 'public',
		response: { ok: true }
	},
	{
		method: 'GET',
		path: '/api/auth/me',
		summary: 'Who is logged in',
		description: '`authenticated: false` and `role: "none"` without a valid login.',
		access: 'public',
		response: me
	},
	{
		method: 'POST',
		path: '/api/auth/password',
		summary: 'Change your own password',
		description:
			'Logs the account out everywhere else and keeps this session. Also allowed when the account must change its password first.',
		access: 'user',
		params: [
			{ name: 'current', type: 'string', description: 'Current password', required: true },
			{
				name: 'password',
				type: 'string',
				description: 'New password, at least 6 characters',
				required: true
			}
		],
		response: me
	},
	{
		method: 'GET',
		path: '/api/users',
		summary: 'List the accounts',
		access: 'admin',
		response: {
			me: 'admin',
			max: 10,
			users: [
				{ name: 'admin', role: 'admin', mustChangePassword: false },
				{ name: 'anna', role: 'user', mustChangePassword: true }
			]
		}
	},
	{
		method: 'POST',
		path: '/api/users',
		summary: 'Add, change or delete an account',
		description:
			'`add`: needs `password`; the user must change it at the first login. `set`: changes `role` and/or `password` (a new password logs the user out everywhere). `delete`: not yourself, not the last admin.',
		access: 'admin',
		params: [
			{ name: 'op', type: 'string', description: '`add`, `set` or `delete`', required: true },
			{
				name: 'name',
				type: 'string',
				description: 'User name: letters, digits, - _ . (max. 23)',
				required: true
			},
			{ name: 'password', type: 'string', description: 'Initial password, at least 6 characters' },
			{ name: 'role', type: 'string', description: '`admin` or `user`' }
		],
		response: { ok: true }
	},
	{
		method: 'GET',
		path: '/api/status',
		summary: 'Firmware, chip, memory and uptime',
		access: 'admin',
		response: {
			name: 'Hub',
			deviceType: 'matter-hub',
			firmware: '1.0.0',
			buildId: 'a1b2c3d4',
			compiled: 'Oct 22 2026 10:00:00',
			idf: 'v5.5.6',
			chip: 'esp32s3',
			chipRevision: 2,
			cores: 2,
			uptime: 3600,
			resetReason: 'power-on',
			heapFree: 81234,
			heapMin: 60123,
			psramFree: 8123456,
			partition: 'ota_0',
			flash: { size: 8388608, appPartition: 3145728, app: 2345678, nvsUsed: 210, nvsTotal: 756 }
		}
	},
	{
		method: 'POST',
		path: '/api/reboot',
		summary: 'Restart the device',
		description: 'Restarts half a second after answering.',
		access: 'admin',
		response: { ok: true }
	}
];
