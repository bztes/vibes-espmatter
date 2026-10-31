import type { Story } from '../../stories';
import OtelPanel from './device-ui/OtelPanel.svelte';

const now = Math.round(Date.now() / 1000);

const otel = {
	enabled: true,
	endpoint: 'https://otel.example.com:4318',
	authSet: true,
	metrics: true,
	interval: 60,
	system: true,
	logs: true,
	logLevel: 'warn',
	logInterval: 30,
	status: {
		state: 'ok',
		error: '',
		online: true,
		lastOk: now - 42,
		logsError: '',
		logsLastOk: now - 12,
		logsWaiting: 3,
		logsDropped: 0
	}
};

export const api = { '/api/otel': otel };

export default [
	{ name: 'Sending', component: OtelPanel, api },
	{
		name: 'Failing',
		component: OtelPanel,
		api: {
			'/api/otel': {
				...otel,
				status: {
					...otel.status,
					state: 'error',
					error: 'HTTP 401 Unauthorized',
					lastOk: 0,
					logsError: 'connection refused',
					logsLastOk: 0,
					logsWaiting: 512,
					logsDropped: 87
				}
			}
		}
	},
	{
		name: 'Off',
		component: OtelPanel,
		api: {
			'/api/otel': {
				...otel,
				enabled: false,
				endpoint: '',
				authSet: false,
				status: { ...otel.status, state: 'off', lastOk: 0, logsLastOk: 0, logsWaiting: 0 }
			}
		}
	}
] satisfies Story[];
