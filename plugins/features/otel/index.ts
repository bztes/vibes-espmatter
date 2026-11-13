import { defineFeature } from '#sdk';

export default defineFeature({
	type: 'feature',
	id: 'otel',
	name: 'OpenTelemetry',
	description:
		'Exports metrics and logs via OTLP/HTTP JSON to a collector, e.g. Grafana Alloy or the OpenTelemetry Collector. On a hub: its own and every paired device’s values and diagnostics, each device as a resource of its own – so devices behind a hub need no exporter. Logs are the device’s own log output.',
	icon: 'activity',
	kinds: ['hub', 'device'],
	needs: ['ip'],
	provides: ['otel'],
	fields: [
		{
			type: 'text',
			key: 'endpoint',
			label: 'OTLP endpoint',
			help: 'Base URL of the collector; /v1/metrics and /v1/logs are appended.',
			default: '',
			required: true,
			placeholder: 'http://collector.local:4318',
			pattern: {
				regex: /^https?:\/\/[^\s]+$(?<!\/v1\/(?:metrics|logs|traces)\/?)/,
				message: 'OTLP endpoint: the collector’s base http(s):// URL, without /v1/metrics.'
			},
			perDevice: true
		},
		{
			type: 'number',
			key: 'interval',
			label: 'Export interval',
			unit: 's',
			default: 60,
			min: 10,
			max: 3600,
			integer: true,
			perDevice: true
		},
		{
			type: 'boolean',
			key: 'metrics',
			label: 'Export metrics',
			default: true,
			perDevice: true
		},
		{
			type: 'boolean',
			key: 'logs',
			label: 'Export logs',
			default: true,
			perDevice: true
		},
		{
			type: 'select',
			key: 'logLevel',
			label: 'Log level',
			help: 'Lowest level exported. Levels the firmware does not log at (build log level) never arrive.',
			default: 'warn',
			options: [
				{ value: 'error', label: 'Error' },
				{ value: 'warn', label: 'Warning' },
				{ value: 'info', label: 'Info' },
				{ value: 'debug', label: 'Debug' }
			],
			advanced: true,
			perDevice: true
		},
		{
			type: 'text',
			key: 'ntpServer',
			label: 'NTP server',
			help: 'Data points need the real time; nothing is exported until it is set.',
			default: 'pool.ntp.org',
			required: true,
			maxLength: 64,
			advanced: true,
			perDevice: true
		},
		{
			type: 'text',
			key: 'serviceName',
			label: 'service.name',
			default: '',
			placeholder: 'from the device name',
			maxLength: 48,
			advanced: true,
			perDevice: true
		},
		{
			type: 'text',
			key: 'authHeader',
			label: 'Authorization header',
			default: '',
			secret: true,
			placeholder: 'Basic …',
			advanced: true,
			perDevice: true
		}
	],
	validate({ has, device, settings }) {
		const out = [];
		if (settings.metrics === false && settings.logs === false)
			out.push({
				severity: 'warning' as const,
				message: 'Metrics and logs are both off: nothing is exported.'
			});
		if (device.kind === 'device')
			out.push({
				severity: 'info' as const,
				message:
					'Paired to a hub with OpenTelemetry, this is only needed for logs: the hub exports this device’s values and diagnostics over Matter, but not its log output.'
			});
		if (has('thread') && !has('uplink'))
			out.push({
				severity: 'warning' as const,
				message:
					'Over Thread the collector must be reachable via IPv6 (or NAT64 on the border router).'
			});
		return out;
	},
	contribute({ cfg }, out) {
		out
			.firmware()
			.source('espm_otel.cpp', 'espm_otel.h')
			.include('"espm_otel.h"')
			.define({
				ESPM_OTEL_ENDPOINT: cfg('endpoint'),
				ESPM_OTEL_INTERVAL_S: cfg('interval'),
				// Empty: from the device name.
				ESPM_OTEL_SERVICE: cfg('serviceName'),
				ESPM_OTEL_AUTH: cfg('authHeader'),
				ESPM_OTEL_NTP: cfg('ntpServer'),
				ESPM_OTEL_METRICS: cfg('metrics'),
				ESPM_OTEL_LOGS: cfg('logs'),
				ESPM_OTEL_LOG_LEVEL: cfg('logLevel')
			})
			// Endpoints are per device: any of them may be HTTPS.
			.sdkconfig({ CONFIG_MBEDTLS_CERTIFICATE_BUNDLE: true })
			.init('network', 'espm_otel_start();');
		out.api({
			method: 'GET',
			path: '/api/v1/otel',
			summary: 'Exporter state',
			auth: 'token',
			response: {
				endpoint: 'http://collector.local:4318',
				timeSynced: true,
				devices: 5,
				exports: 120,
				failures: 1,
				lastStatus: 200,
				metrics: true,
				logs: true,
				logsSent: 342,
				logsDropped: 0
			}
		});
		out.ui({
			page: 'settings',
			file: 'OtelWidget.svelte',
			title: 'OpenTelemetry',
			tab: 'System',
			order: 70
		});
	}
});
