import { formatBytes, formatDuration, formatNumber } from '#sdk/device-ui';

/**
 * The firmware passes the database's answer through unchanged: one reader per source turns it into
 * rows. A new source needs its queries in the firmware and a reader here.
 */

/** A bucket: average, minimum, maximum and last of the values in it. `t` in unix seconds. */
export interface Point {
	t: number;
	avg: number;
	min: number;
	max: number;
	last: number;
}

/** Gauge: a reading. Counter: only grows. State: one of distinct values. */
export type Kind = 'gauge' | 'counter' | 'state';

export interface Series {
	metric: string;
	labels: string;
	unit: string;
	value: number;
	kind: Kind;
}

export interface Device {
	id: string;
	name: string;
	/** This device itself. */
	own: boolean;
	/** Matter node id of a paired device. */
	node?: string;
	series: Series[];
}

export interface Catalog {
	source: string;
	devices: Device[];
}

export const seriesKey = (s: Pick<Series, 'metric' | 'labels'>) => `${s.metric}|${s.labels}`;
export const isDiagnostic = (s: Series) => s.metric.startsWith('device.');

const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN);

/** Points in time order, without buckets that carry no number. Older firmware sends no `last`. */
function points(rows: unknown[][]): Point[] {
	return rows
		.map(([t, avg, min, max, last = avg]) => ({
			t: num(t),
			avg: num(avg),
			min: num(min),
			max: num(max),
			last: num(last)
		}))
		.filter((p) => [p.t, p.avg, p.min, p.max, p.last].every(Number.isFinite))
		.sort((a, b) => a.t - b.t);
}

/** The rows of the database's answer. */
const ROWS: Record<string, (raw: unknown) => unknown[][]> = {
	/** FORMAT JSONCompact: `{ data: [[…], …] }` (nan/inf as null). */
	clickhouse(raw) {
		const data = (raw as { data?: unknown })?.data;
		if (!Array.isArray(data)) throw new Error('Unexpected answer from ClickHouse');
		return data.filter(Array.isArray);
	}
};

function rows(source: string, raw: unknown): unknown[][] {
	const read = ROWS[source];
	if (!read) throw new Error(`Unknown history source "${source}"`);
	return read(raw);
}

/** Values of a device: rows of `[key, t, avg, min, max, last]`, by series key. */
export function parse(source: string, raw: unknown): Map<string, Point[]> {
	const by = new Map<string, unknown[][]>();
	for (const [key, ...rest] of rows(source, raw)) {
		if (typeof key !== 'string') continue;
		(by.get(key) ?? by.set(key, []).get(key)!).push(rest);
	}
	return new Map([...by].map(([key, r]) => [key, points(r)]));
}

/** Readable metric name: `thermostat_local_temperature` → `Thermostat local temperature`. */
export function metricLabel(metric: string): string {
	const words = metric.replace(/^device\./, '').replace(/[._]+/g, ' ');
	return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Names of a device's values; the endpoint only where a metric is there twice. */
export function seriesLabels(all: Series[]): (s: Series) => string {
	const count: Record<string, number> = {};
	for (const s of all) count[s.metric] = (count[s.metric] ?? 0) + 1;
	return (s) => {
		const ep = /(?:^|,)endpoint=(\d+)/.exec(s.labels)?.[1];
		return metricLabel(s.metric) + (ep && count[s.metric] > 1 ? ` (endpoint ${ep})` : '');
	};
}

/** Unit as shown (UCUM codes of the exporter); `''` for none. */
function unitLabel(unit: string): string {
	return ({ Cel: '°C', By: 'B', '1': '' } as Record<string, string>)[unit] ?? unit;
}

/** Seconds per time unit (UCUM codes). */
const SECONDS: Record<string, number> = {
	ns: 1e-9,
	us: 1e-6,
	ms: 1e-3,
	s: 1,
	min: 60,
	h: 3600,
	d: 86400
};
/** Units a duration axis may use, biggest first. */
const AXIS_UNITS = ['d', 'h', 'min', 's', 'ms'].map((u) => [u, SECONDS[u]] as const);

/** Value with the unit, rounded to what makes sense for its size. */
export function format(value: number, unit: string): string {
	if (unit === 'By') return formatBytes(value);
	if (unit in SECONDS) return formatDuration(value * SECONDS[unit]);
	const u = unitLabel(unit);
	return u ? `${formatNumber(value)} ${u}` : formatNumber(value);
}

/**
 * Round ticks of a chart's value axis and their labels. Durations use one unit that fits their
 * size (`2 d`, `4 d`), not seconds.
 */
export function axis(lo: number, hi: number, unit: string, count = 4) {
	if (!(unit in SECONDS)) return ticks(lo, hi, count).map((v) => ({ v, label: format(v, unit) }));
	const biggest = Math.max(Math.abs(lo), Math.abs(hi)) * SECONDS[unit];
	const [name, size] = AXIS_UNITS.find(([, s]) => biggest >= 2 * s) ?? AXIS_UNITS.at(-1)!;
	const f = size / SECONDS[unit];
	return ticks(lo / f, hi / f, count).map((t) => ({
		v: t * f,
		label: `${formatNumber(t)} ${name}`
	}));
}

/** Shortest distance between buckets: the step the database used. */
export function stepOf(pts: Point[]): number {
	let step = Infinity;
	for (let i = 1; i < pts.length; i++) step = Math.min(step, pts[i].t - pts[i - 1].t);
	return Number.isFinite(step) ? step : 60;
}

/** Runs of points without gaps (a gap: more than two steps without data). */
export function segments(pts: Point[]): Point[][] {
	const step = stepOf(pts);
	const out: Point[][] = [];
	for (const p of pts) {
		const last = out.at(-1);
		if (last && p.t - last[last.length - 1].t <= 2 * step) last.push(p);
		else out.push([p]);
	}
	return out;
}

/** About `count` round tick values covering [lo, hi]. */
export function ticks(lo: number, hi: number, count = 4): number[] {
	if (!(hi > lo)) return [lo];
	const raw = (hi - lo) / count;
	const mag = 10 ** Math.floor(Math.log10(raw));
	const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
	const out: number[] = [];
	for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step)
		out.push(+v.toFixed(10));
	return out;
}
