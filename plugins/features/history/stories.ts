import type { SpotStory, Story } from '#sdk/device-ui';
import HistoryDeviceIcon from './ui/HistoryDeviceIcon.svelte';
import HistoryPage from './ui/HistoryPage.svelte';
import HistoryView from './ui/HistoryView.svelte';

const series = {
	source: 'clickhouse',
	devices: [
		{
			id: 'a1b2c3d4',
			name: 'Living room hub',
			own: true,
			series: [
				{ metric: 'device.uptime', labels: '', unit: 's', value: 523000 },
				{ metric: 'device.memory.free', labels: '', unit: 'By', value: 148000 }
			]
		},
		{
			id: 'a1b2c3d4/node-18',
			name: 'Living room climate',
			own: false,
			node: '18',
			series: [
				{ metric: 'temperature', labels: 'endpoint=1', unit: 'Cel', value: 21.4 },
				{ metric: 'humidity', labels: 'endpoint=2', unit: '%', value: 48 },
				{ metric: 'device.online', labels: '', unit: '1', value: 1 }
			]
		}
	]
};

/** A day's swing of temperatures in hourly buckets, with a gap. */
function days(n: number) {
	const now = Math.floor(Date.now() / 3600000) * 3600;
	const data = [];
	for (let i = n * 24; i >= 0; i--) {
		if (i > 30 && i < 40) continue;
		const t = now - i * 3600;
		const avg = 21 + 1.8 * Math.sin((t / 86400) * 2 * Math.PI) + 0.4 * Math.sin(i / 7);
		data.push([t, +avg.toFixed(2), +(avg - 0.3).toFixed(2), +(avg + 0.4).toFixed(2)]);
	}
	return { meta: [], data, rows: data.length };
}

const api = { '/api/v1/history/series': series, '/api/v1/history': days(7) };

/** The chart icon on device cards in the other previews. */
export const spotStories: SpotStory[] = [
	{ spot: 'device-icons', component: HistoryDeviceIcon, api }
];

export default [
	{ name: 'History', component: HistoryPage, page: 'history', wide: true, api }
] satisfies Story[];

/** What the chart dialog shows. */
export const parts = [
	{
		name: 'Temperature',
		component: HistoryView,
		props: { device: 'a1b2c3d4/node-18' },
		wide: true,
		api
	},
	{
		name: 'No data',
		component: HistoryView,
		props: { device: 'a1b2c3d4/node-18' },
		wide: true,
		api: { ...api, '/api/v1/history': { meta: [], data: [], rows: 0 } }
	}
] satisfies Story[];
