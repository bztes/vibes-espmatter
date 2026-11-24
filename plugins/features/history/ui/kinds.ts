import { formatDuration } from '#sdk/device-ui';
import { DoorLock, FanControl, Thermostat } from '#sdk/matter';
import { format, stepOf, type Point, type Series } from './sources';

/** Names of a state's values, by metric; others show the number, or Off/On for 0/1. */
const STATE_NAMES: Record<string, Record<string, number>> = {
	lock_state: DoorLock.enums.DlLockState,
	thermostat_system_mode: Thermostat.enums.SystemModeEnum,
	fan_mode: FanControl.enums.FanModeEnum,
	'device.online': { offline: 0, online: 1 },
	'device.battery.level': { ok: 0, warning: 1, critical: 2 },
	contact_closed: { open: 0, closed: 1 },
	occupancy: { clear: 0, occupied: 1 }
};

/** `emergencyHeat` → `Emergency heat`. */
const words = (key: string) => {
	const w = key.replace(/([A-Z])/g, ' $1').toLowerCase();
	return w.charAt(0).toUpperCase() + w.slice(1);
};

const reversed = new WeakMap<Record<string, number>, Record<number, string>>();
/** Value → name, built once per table. */
function nameOf(names: Record<string, number>) {
	let r = reversed.get(names);
	if (!r)
		reversed.set(names, (r = Object.fromEntries(Object.entries(names).map(([k, n]) => [n, k]))));
	return r;
}

/** A value as shown: a state's name, else the number with its unit. */
export function valueText(s: Series, v: number): string {
	if (s.kind !== 'state') return format(v, s.unit);
	const names = STATE_NAMES[s.metric] ?? { off: 0, on: 1 };
	const name = nameOf(names)[v];
	return name ? words(name) : String(v);
}

/** Seconds of a bucket within [from, to]. */
const within = (t: number, step: number, from: number, to: number) =>
	Math.max(0, Math.min(t + step, to) - Math.max(t, from));

/**
 * Seconds spent in each value, biggest first. A bucket that changed is split between its minimum
 * and maximum by its average (exact for two values, values are sampled at a fixed rate).
 */
export function timeInStates(points: Point[], from: number, to: number) {
	const step = stepOf(points);
	const time = new Map<number, number>();
	const add = (v: number, s: number) => s > 0 && time.set(v, (time.get(v) ?? 0) + s);
	for (const p of points) {
		const s = within(p.t, step, from, to);
		const high = highShare(p);
		add(p.max, s * high);
		add(p.min, s * (1 - high));
	}
	return [...time]
		.map(([value, seconds]) => ({ value, seconds }))
		.sort((a, b) => b.seconds - a.seconds);
}

/** Share of a bucket spent at its maximum (see timeInStates). */
export const highShare = (p: Point) => (p.max > p.min ? (p.avg - p.min) / (p.max - p.min) : 1);

/** Growth of a counter over the points; a drop (reset) counts from zero. */
export function increase(points: Point[]): number {
	let sum = 0;
	let prev: number | undefined;
	for (const p of points) {
		const d = prev === undefined ? p.last - p.min : p.last - prev;
		sum += d >= 0 ? d : p.last;
		prev = p.last;
	}
	return sum;
}

/** Seconds from the first bucket to the end of the last, within [from, to]. */
export function span(points: Point[], from: number, to: number): number {
	if (!points.length) return 0;
	const end = Math.min(to, points[points.length - 1].t + stepOf(points));
	return Math.max(0, end - Math.max(from, points[0].t));
}

interface Stat {
	label: string;
	/** None: no points. */
	value?: string;
	/** The one a small chart shows. */
	main?: boolean;
}

/** Besides "now": what makes sense for the kind of value. */
export function stats(series: Series, points: Point[], from: number, to: number): Stat[] {
	const has = points.length > 0;
	const show = (v: number, ok = true) => (has && ok ? format(v, series.unit) : undefined);
	if (series.kind === 'counter') {
		const inc = increase(points);
		const days = span(points, from, to) / 86400;
		return [
			{ label: 'Increase', value: show(inc), main: true },
			{ label: 'Per day', value: show(inc / days, days > 0) }
		];
	}
	if (series.kind === 'state') {
		const states = timeInStates(points, from, to);
		const total = states.reduce((a, s) => a + s.seconds, 0);
		return states.slice(0, 3).map(({ value, seconds }, i) => ({
			label: valueText(series, value),
			main: i === 0,
			value: `${formatDuration(seconds)} · ${Math.round((seconds / total) * 100)} %`
		}));
	}
	let min = Infinity;
	let max = -Infinity;
	let sum = 0;
	for (const p of points) {
		min = Math.min(min, p.min);
		max = Math.max(max, p.max);
		sum += p.avg;
	}
	return [
		{ label: 'Minimum', value: show(min) },
		{ label: 'Average', value: show(sum / points.length), main: true },
		{ label: 'Maximum', value: show(max) }
	];
}
