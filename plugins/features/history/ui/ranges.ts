/** Time ranges of the chart: presets, calendar periods, stepping and labels. Unix seconds. */

export type Unit = 'day' | 'week' | 'month' | 'year';

export interface View {
	from: number;
	to: number;
	/** A calendar period: steps by whole periods. */
	unit?: Unit;
	/** Rolling preset: resolved again on every load. */
	preset?: string;
}

/** The firmware's limits. */
export const MIN_RANGE_S = 5 * 60;
export const MAX_RANGE_S = 10 * 366 * 86400;

const CALENDAR: { value: string; label: string; unit: Unit; back: number }[] = [
	{ value: 'today', label: 'Today', unit: 'day', back: 0 },
	{ value: 'yesterday', label: 'Yesterday', unit: 'day', back: 1 },
	{ value: 'week', label: 'This week', unit: 'week', back: 0 },
	{ value: 'month', label: 'This month', unit: 'month', back: 0 },
	{ value: 'year', label: 'This year', unit: 'year', back: 0 }
];
const ROLLING = [
	{ value: '1h', label: 'Last hour', seconds: 3600 },
	{ value: '6h', label: 'Last 6 hours', seconds: 6 * 3600 },
	{ value: '1d', label: 'Last 24 hours', seconds: 86400 },
	{ value: '7d', label: 'Last 7 days', seconds: 7 * 86400 },
	{ value: '30d', label: 'Last 30 days', seconds: 30 * 86400 },
	{ value: '1y', label: 'Last year', seconds: 365 * 86400 }
];

export const PRESET_GROUPS = [
	{ label: 'Calendar', options: CALENDAR },
	{ label: 'Rolling', options: ROLLING }
];

export const isPreset = (v: string) => [...CALENDAR, ...ROLLING].some((p) => p.value === v);

/** First day of the week in this locale (0 Sunday … 6 Saturday); Monday if unknown. */
function weekStart(): number {
	try {
		const loc = new Intl.Locale(navigator.language) as Intl.Locale & {
			getWeekInfo?: () => { firstDay: number };
			weekInfo?: { firstDay: number };
		};
		const first = (loc.getWeekInfo?.() ?? loc.weekInfo)?.firstDay;
		if (first) return first % 7;
	} catch {
		// no Intl.Locale or navigator: default
	}
	return 1;
}

/** Local start of the period containing `d`. */
export function startOf(d: Date, unit: Unit, firstDay = weekStart()): Date {
	const s = new Date(d.getFullYear(), d.getMonth(), d.getDate());
	if (unit === 'week') s.setDate(s.getDate() - ((s.getDay() - firstDay + 7) % 7));
	if (unit === 'month') s.setDate(1);
	if (unit === 'year') s.setMonth(0, 1);
	return s;
}

/** `d` moved by `n` periods, in local time (DST and month lengths kept right). */
function add(d: Date, unit: Unit, n: number): Date {
	const r = new Date(d);
	if (unit === 'day') r.setDate(r.getDate() + n);
	if (unit === 'week') r.setDate(r.getDate() + 7 * n);
	if (unit === 'month') r.setMonth(r.getMonth() + n);
	if (unit === 'year') r.setFullYear(r.getFullYear() + n);
	return r;
}

const sec = (d: Date) => Math.floor(d.getTime() / 1000);

function period(start: Date, unit: Unit): View {
	return { from: sec(start), to: sec(add(start, unit, 1)), unit };
}

export function presetView(value: string, now = new Date()): View {
	const cal = CALENDAR.find((p) => p.value === value);
	if (cal) {
		const v = period(add(startOf(now, cal.unit), cal.unit, -cal.back), cal.unit);
		return { ...v, preset: value };
	}
	const roll = ROLLING.find((p) => p.value === value) ?? ROLLING[2];
	const to = sec(now);
	return { from: to - roll.seconds, to, preset: roll.value };
}

/** One period (or one range length) earlier (-1) or later (1). */
export function shift(v: View, dir: -1 | 1): View {
	if (v.unit) return period(add(new Date(v.from * 1000), v.unit, dir), v.unit);
	const len = v.to - v.from;
	return { from: v.from + dir * len, to: v.to + dir * len };
}

const BIGGER: Partial<Record<Unit, Unit>> = { day: 'week', week: 'month', month: 'year' };

/** The next bigger period, or twice as long around the middle, not past now. */
export function zoomOut(v: View, now = new Date()): View {
	const bigger = v.unit && BIGGER[v.unit];
	if (bigger) return period(startOf(new Date(v.from * 1000), bigger), bigger);
	const len = Math.min(2 * (v.to - v.from), MAX_RANGE_S);
	const to = Math.min(Math.round((v.from + v.to + len) / 2), Math.max(v.to, sec(now)));
	return { from: to - len, to };
}

/** A range within the firmware's limits, or undefined. */
export function custom(from: number, to: number): View | undefined {
	if (!Number.isFinite(from) || !Number.isFinite(to)) return undefined;
	if (to - from < MIN_RANGE_S || to - from > MAX_RANGE_S) return undefined;
	return { from: Math.floor(from), to: Math.ceil(to) };
}

/** Short text for the range button. */
export function viewLabel(v: View, now = new Date()): string {
	const all = [...CALENDAR, ...ROLLING];
	const preset = all.find((p) => p.value === v.preset);
	if (preset) return preset.label;
	const start = new Date(v.from * 1000);
	if (v.unit === 'day') {
		const today = sec(startOf(now, 'day'));
		if (v.from === today) return 'Today';
		if (v.from === sec(add(startOf(now, 'day'), 'day', -1))) return 'Yesterday';
		return start.toLocaleDateString(undefined, {
			weekday: 'short',
			day: 'numeric',
			month: 'short',
			year: start.getFullYear() === now.getFullYear() ? undefined : 'numeric'
		});
	}
	if (v.unit === 'month')
		return start.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
	if (v.unit === 'year') return String(start.getFullYear());
	const end = new Date((v.unit ? v.to - 1 : v.to) * 1000);
	const withTime = !v.unit && (v.to - v.from < 2 * 86400 || v.from % 3600 || v.to % 3600);
	const f = new Intl.DateTimeFormat(undefined, {
		day: 'numeric',
		month: 'short',
		year: start.getFullYear() === end.getFullYear() ? undefined : 'numeric',
		...(withTime ? { hour: '2-digit', minute: '2-digit' } : {})
	});
	return f.formatRange(start, end);
}

/** Value of a `datetime-local` field for unix seconds. */
export function toLocalInput(t: number): string {
	const d = new Date(t * 1000);
	const p = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Unix seconds of a `datetime-local` value; NaN if empty. */
export const fromLocalInput = (s: string) => (s ? Math.floor(new Date(s).getTime() / 1000) : NaN);

/** Round tick times between `from` and `to`, at most about `count`, in local time. */
export function timeTicks(
	from: number,
	to: number,
	count: number
): { ticks: number[]; step: number } {
	const span = to - from;
	const steps = [
		60,
		300,
		900,
		1800,
		3600,
		3 * 3600,
		6 * 3600,
		12 * 3600,
		86400,
		2 * 86400,
		7 * 86400
	];
	const step = steps.find((s) => span / s <= count);
	if (step) {
		const out: number[] = [];
		// Local midnight as the grid's origin, so hours and days are round on the clock.
		const day = sec(startOf(new Date(from * 1000), step === 7 * 86400 ? 'week' : 'day'));
		for (let t = day + Math.ceil((from - day) / step) * step; t < to; t += step) {
			// Day steps by the calendar, so DST days don't shift the grid.
			out.push(step >= 86400 ? sec(startOf(new Date((t + 3 * 3600) * 1000), 'day')) : t);
		}
		return { ticks: out.filter((t) => t > from && t < to), step };
	}
	const months = [1, 2, 3, 6, 12, 24, 60].find((m) => span / (m * 30.4 * 86400) <= count) ?? 120;
	const out: number[] = [];
	const d = startOf(new Date(from * 1000), 'month');
	d.setMonth(Math.ceil(d.getMonth() / months) * months);
	if (months >= 12) d.setFullYear(Math.ceil(d.getFullYear() / (months / 12)) * (months / 12), 0, 1);
	for (; sec(d) < to; d.setMonth(d.getMonth() + months)) if (sec(d) > from) out.push(sec(d));
	return { ticks: out, step: months * 30.4 * 86400 };
}
