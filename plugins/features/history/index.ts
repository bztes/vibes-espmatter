import { defineFeature } from '#sdk';

/** Where the history is read from. Each source has a query in the firmware and a parser in `ui/sources.ts`. */
const SOURCES = [{ value: 'clickhouse', label: 'ClickHouse' }];

export default defineFeature({
	type: 'feature',
	id: 'history',
	name: 'History',
	description:
		'Charts of past values – days, weeks, years – of this device and its paired devices, behind a chart icon on their cards. Read from the database the OpenTelemetry collector writes to.',
	icon: 'chart-line',
	kinds: ['hub', 'device'],
	needs: ['ip'],
	wants: ['otel'],
	fields: [
		{
			type: 'select',
			key: 'source',
			label: 'Database',
			help: 'Where the collector stores the metrics.',
			default: 'clickhouse',
			options: SOURCES
		},
		{
			type: 'text',
			key: 'url',
			label: 'ClickHouse URL',
			help: 'HTTP interface of ClickHouse, usually port 8123.',
			default: '',
			required: true,
			placeholder: 'http://clickhouse.local:8123',
			pattern: { regex: /^https?:\/\/[^\s]+$/, message: 'ClickHouse URL: an http(s):// URL.' },
			perDevice: true
		},
		{
			type: 'text',
			key: 'user',
			label: 'User',
			help: 'Best a user that may only read the metrics table.',
			default: '',
			placeholder: 'default',
			maxLength: 64,
			perDevice: true
		},
		{
			type: 'text',
			key: 'password',
			label: 'Password',
			default: '',
			secret: true,
			maxLength: 128,
			perDevice: true
		},
		{
			type: 'text',
			key: 'table',
			label: 'Table',
			help: 'Gauges table of the collector’s ClickHouse exporter.',
			default: 'telemetry.otel_metrics_gauge',
			required: true,
			pattern: {
				regex: /^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)?$/,
				message: 'Table: `database.table` or `table`, letters, digits and _ only.'
			},
			advanced: true,
			perDevice: true
		}
	],
	contribute({ settings, cfg }, out) {
		out
			.firmware()
			.source('espm_history.cpp', 'espm_history.h')
			.include('"espm_history.h"')
			.define({
				ESPM_HISTORY_SOURCE: String(settings.source),
				ESPM_HISTORY_CLICKHOUSE: settings.source === 'clickhouse',
				ESPM_HISTORY_URL: cfg('url'),
				ESPM_HISTORY_USER: cfg('user'),
				ESPM_HISTORY_PASSWORD: cfg('password'),
				ESPM_HISTORY_TABLE: cfg('table')
			})
			.sdkconfig({ CONFIG_MBEDTLS_CERTIFICATE_BUNDLE: true })
			.init('started', 'espm_history_init();');
		out.api(
			{
				method: 'GET',
				path: '/api/v1/history/series',
				summary: 'Series with a history',
				description:
					'This device’s (admins only) and the paired devices’ the caller may read, with their current value.',
				auth: 'token',
				response: {
					source: 'clickhouse',
					devices: [
						{
							id: 'a1b2c3d4/node-17',
							name: 'Kitchen sensor',
							own: false,
							series: [{ metric: 'temperature', labels: 'endpoint=1', unit: 'Cel', value: 21.4 }]
						}
					]
				}
			},
			{
				method: 'GET',
				path: '/api/v1/history',
				summary: 'Past values of a series',
				description:
					'Aggregated by the database into at most 400 buckets (min. 1 minute) of avg/min/max. The database’s answer is passed through unchanged: its format depends on `source`.',
				auth: 'token',
				params: [
					{ name: 'device', type: 'string', description: 'Device id', required: true, in: 'query' },
					{
						name: 'metric',
						type: 'string',
						description: 'Metric name',
						required: true,
						in: 'query'
					},
					{ name: 'labels', type: 'string', description: 'e.g. `endpoint=1`', in: 'query' },
					{
						name: 'from',
						type: 'number',
						description: 'Unix seconds',
						required: true,
						in: 'query'
					},
					{ name: 'to', type: 'number', description: 'Unix seconds', required: true, in: 'query' }
				],
				response: { data: [[1763020800, 21.2, 20.9, 21.6]] }
			}
		);
		out.spot({ spot: 'device-icons', file: 'HistoryDeviceIcon.svelte' });
		// A page of its own: any device and value with a history, picked by the user.
		out.page({ id: 'history', title: 'History', icon: 'chart-line', path: '/history', order: 3 });
		out.ui({
			page: 'history',
			file: 'HistoryPage.svelte',
			title: 'History',
			wide: true,
			order: 1,
			access: 'account'
		});
	}
});
