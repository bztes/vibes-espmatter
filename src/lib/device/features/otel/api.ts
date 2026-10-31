import type { DeviceApiRoute } from '../../types';

const settings = {
	enabled: true,
	endpoint: 'https://otel.example.com',
	authSet: true,
	interval: 60,
	system: true,
	metrics: true,
	logs: true,
	logLevel: 'warn',
	logInterval: 30,
	status: {
		state: 'ok',
		error: '',
		online: true,
		lastOk: 1792656000,
		logsError: '',
		logsLastOk: 1792656000,
		logsWaiting: 0,
		logsDropped: 0
	}
};

/** Route of `espm_otel_web.cpp`, registered only with the admin dashboard (`mesp_otel_register_web()`). */
export const api: DeviceApiRoute[] = [
	{
		method: 'GET',
		path: '/api/otel',
		summary: 'OpenTelemetry settings and how sending goes',
		description:
			'The Authorization header itself is never returned (`authSet`). `status.state`: e.g. `ok`, `off`, `wifi`, `clock`; `lastOk` as Unix time.',
		access: 'admin',
		response: settings
	},
	{
		method: 'POST',
		path: '/api/otel',
		summary: 'Change the OpenTelemetry settings',
		description: 'Changes only the fields it gets and sends right away. Answers like `GET`.',
		access: 'admin',
		params: [
			{ name: 'enabled', type: 'boolean', description: 'Send at all (needs an endpoint)' },
			{ name: 'endpoint', type: 'string', description: 'OTLP/HTTP base URL (http:// or https://)' },
			{ name: 'auth', type: 'string', description: 'Authorization header, e.g. `Basic …`' },
			{ name: 'interval', type: 'number', description: 'Metrics every 10–3600 s' },
			{ name: 'metrics', type: 'boolean', description: 'Send device metrics' },
			{ name: 'system', type: 'boolean', description: 'Send system metrics (heap, Wi-Fi …)' },
			{ name: 'logs', type: 'boolean', description: 'Send logs' },
			{ name: 'logLevel', type: 'string', description: '`error`, `warn` or `info`' },
			{ name: 'logInterval', type: 'number', description: 'Logs every 0 (right away) to 3600 s' }
		],
		response: settings
	}
];
