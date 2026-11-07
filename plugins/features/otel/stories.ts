import type { Story } from '#sdk/device-ui';
import OtelWidget from './ui/OtelWidget.svelte';

export default [
	{
		name: 'Exporting',
		page: 'settings',
		component: OtelWidget,
		tab: 'System',
		api: {
			'/api/v1/otel': {
				endpoint: 'http://alloy.local:4318',
				exports: 1440,
				failures: 2,
				lastStatus: 200,
				metrics: true,
				logs: true,
				logsSent: 5210,
				logsDropped: 0
			}
		}
	},
	{
		name: 'Collector down',
		page: 'settings',
		component: OtelWidget,
		tab: 'System',
		api: {
			'/api/v1/otel': {
				endpoint: 'http://alloy.local:4318',
				exports: 12,
				failures: 30,
				lastStatus: -1,
				metrics: true,
				logs: true,
				logsSent: 40,
				logsDropped: 312
			}
		}
	}
] satisfies Story[];
