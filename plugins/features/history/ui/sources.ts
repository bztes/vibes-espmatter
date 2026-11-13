import { formatBytes, formatDuration, formatNumber } from '#sdk/device-ui';

/**
 * The firmware passes the database's answer through unchanged: one parser per source turns it into
 * points. A new source needs a query in the firmware and a parser here.
 */

/** A bucket: average, minimum and maximum of the values in it. `t` in unix seconds. */
export interface Point {
	t: number;
	avg: number;
	min: number;
	max: number;
}

export interface Series {
	metric: string;
	labels: string;
	unit: string;
	value: number;
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

export const seriesKey = (s: Series) => `${s.metric}|${s.labels}`;
export const isDiagnostic = (s: Series) => s.metric.startsWith('device.');

const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN);

/** Points in time order, without buckets that carry no number. */
function points(rows: unknown[][]): Point[] {
	return rows
		.map(([t, avg, min, max]) => ({ t: num(t), avg: num(avg), min: num(min), max: num(max) }))
		.filter((p) => [p.t, p.avg, p.min, p.max].every(Number.isFinite))
		.sort((a, b) => a.t - b.t);
}

const PARSERS: Record<string, (raw: unknown) => Point[]> = {
	/** FORMAT JSONCompact: `{ data: [[t, avg, min, max], …] }` (nan/inf as null). */
	clickhouse(raw) {
		const data = (raw as { data?: unknown })?.data;
		if (!Array.isArray(data)) throw new Error('Unexpected answer from ClickHouse');
		return points(data.filter(Array.isArray));
	}
};

export function parse(source: string, raw: unknown): Point[] {
	const parser = PARSERS[source];
	if (!parser) throw new Error(`Unknown history source "${source}"`);
	return parser(raw);
}

/** Readable metric name: `thermostat_local_temperature` → `Thermostat local temperature`. */
export function metricLabel(metric: string): string {
	const words = metric.replace(/^device\./, '').replace(/[._]+/g, ' ');
	return words.charAt(0).toUpperCase() + words.slice(1);
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
function stepOf(pts: Point[]): number {
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
