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
				{ metric: 'device.uptime', labels: '', unit: 's', value: 523000, kind: 'gauge' },
				{ metric: 'device.memory.free', labels: '', unit: 'By', value: 148000, kind: 'gauge' }
			]
		},
		{
			id: 'a1b2c3d4/node-18',
			name: 'Living room climate',
			own: false,
			node: '18',
			series: [
				{ metric: 'temperature', labels: 'endpoint=1', unit: 'Cel', value: 21.4, kind: 'gauge' },
				{ metric: 'humidity', labels: 'endpoint=2', unit: '%', value: 48, kind: 'gauge' },
				{ metric: 'device.online', labels: '', unit: '1', value: 1, kind: 'state' }
			]
		},
		{
			id: 'a1b2c3d4/node-19',
			name: 'Kitchen plug',
			own: false,
			node: '19',
			series: [
				{ metric: 'on_off', labels: 'endpoint=1', unit: '1', value: 1, kind: 'state' },
				{ metric: 'energy', labels: 'endpoint=1', unit: 'kWh', value: 412.6, kind: 'counter' }
			]
		}
	]
};

/** Hourly rows `[t, avg, min, max, last]` of the last 30 days, oldest first. */
function hourly(row: (t: number, hoursAgo: number) => number[] | undefined) {
	const now = Math.floor(Date.now() / 3600000) * 3600;
	const rows: number[][] = [];
	for (let i = 30 * 24; i >= 0; i--) {
		const t = now - i * 3600;
		const r = row(t, i);
		if (r) rows.push([t, ...r]);
	}
	return rows;
}

const round = (v: number) => +v.toFixed(3);
const hourOf = (t: number) => new Date(t * 1000).getHours();

/** A day's swing of temperatures, with a gap. */
const temperature = hourly((t, ago) => {
	if (ago > 30 && ago < 40) return undefined;
	const avg = 21 + 1.8 * Math.sin((t / 86400) * 2 * Math.PI) + 0.4 * Math.sin(ago / 7);
	return [avg, avg - 0.3, avg + 0.4, avg + 0.1].map(round);
});

/** A plug's meter reading, growing faster in the evening. */
let kwh = 400;
const energy = hourly((t) => {
	const h = hourOf(t);
	const used = h >= 17 && h <= 22 ? 0.4 : 0.05;
	kwh += used;
	return [kwh - used / 2, kwh - used, kwh, kwh].map(round);
});

/** A plug switched on in the evening: hourly share of time on. */
const onOff = hourly((t) => {
	const h = hourOf(t);
	const on = h >= 18 && h <= 22 ? 1 : h === 17 ? 0.5 : 0;
	return [on, on === 1 ? 1 : 0, on > 0 ? 1 : 0, on > 0 ? 1 : 0];
});

/** Seconds since boot, with two reboots. */
const uptime = hourly((_, ago) => {
	const boot = ago > 400 ? 30 * 24 : ago > 145 ? 400 : 145;
	const end = (boot - ago) * 3600 + 3600;
	return [end - 1800, end - 3600, end, end];
});

/** Free heap, dipping while busy in the evening. */
const memoryFree = hourly((t, ago) => {
	const h = hourOf(t);
	const avg = 148000 - (h >= 17 && h <= 22 ? 12000 : 0) + 3000 * Math.sin(ago / 5);
	return [avg, avg - 6000, avg + 2500, avg].map(Math.round);
});

/** What the database answers: rows within the range, merged into at most 400 buckets. */
function answer(rows: number[][], url: URL) {
	const from = Number(url.searchParams.get('from'));
	const to = Number(url.searchParams.get('to'));
	const step = Math.max(3600, Math.ceil((to - from) / 400 / 3600) * 3600);
	const buckets = new Map<number, number[][]>();
	for (const r of rows) {
		if (r[0] < from - 3600 || r[0] >= to) continue;
		const b = Math.floor(r[0] / step) * step;
		(buckets.get(b) ?? buckets.set(b, []).get(b)!).push(r);
	}
	const out = [...buckets].map(([b, rs]) =>
		[
			b,
			rs.reduce((sum, r) => sum + r[1], 0) / rs.length,
			Math.min(...rs.map((r) => r[2])),
			Math.max(...rs.map((r) => r[3])),
			rs[rs.length - 1][4]
		].map(round)
	);
	return { meta: [], data: out, rows: out.length };
}

/** Data that fits the metric and range asked for. */
const history = (url: URL) => {
	const rows: Record<string, number[][]> = {
		on_off: onOff,
		'device.online': onOff,
		energy,
		'device.uptime': uptime,
		'device.memory.free': memoryFree
	};
	return answer(rows[url.searchParams.get('metric') ?? ''] ?? temperature, url);
};

const api = { '/api/v1/history/series': series, '/api/v1/history': history };

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
		name: 'Plug: on/off and energy',
		component: HistoryView,
		props: { device: 'a1b2c3d4/node-19' },
		wide: true,
		api
	},
	{
		name: 'Hub: uptime and memory',
		component: HistoryView,
		props: { device: 'a1b2c3d4' },
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
