// Timers (espm_timers.cpp): types and formatting shared by the panel and dialog.
import type { MatterEndpoint } from '../../matter-controller/device-ui/matter';

/** A light or plug a timer can control (one endpoint of a node). */
export interface EndpointChoice {
	key: string;
	node: number;
	name: string;
	endpoint: MatterEndpoint;
}

export type TimerAction = 'on' | 'off' | 'adjust';

export interface Timer {
	id: number;
	name: string;
	node: number;
	endpoint: number;
	enabled: boolean;
	/** Bit 0 = Sunday … bit 6 = Saturday; 0 = once ("in X minutes"), deleted after it ran. */
	days: number;
	/** Minute of the day, device local time. */
	minute: number;
	/** Once-timers only: seconds until it runs. */
	remaining?: number;
	action: TimerAction;
	/** 1–254, 0 = leave as is. */
	level: number;
	/** 0 = leave as is. */
	mireds: number;
	/** Seconds. */
	fade: number;
	/** "on" with fade: start brightness (0 = the lowest) and color temperature (0 = the last one). */
	startLevel: number;
	startMireds: number;
}

export interface TimersResponse {
	clock: { synced: boolean; tz: string; minute?: number; weekday?: number };
	max: number;
	count: number;
	timers: Timer[];
}

/** Monday first, as people read a week; `bit` is the firmware's day bit. */
export const WEEK = [
	{ bit: 1, short: 'Mo' },
	{ bit: 2, short: 'Tu' },
	{ bit: 3, short: 'We' },
	{ bit: 4, short: 'Th' },
	{ bit: 5, short: 'Fr' },
	{ bit: 6, short: 'Sa' },
	{ bit: 0, short: 'Su' }
];
export const EVERY_DAY = 0x7f;
export const WEEKDAYS = 0b0111110;
export const WEEKEND = 0b1000001;

export const isOnce = (t: Timer) => t.days === 0;

export function daysLabel(days: number): string {
	if (days === 0) return 'Once';
	if (days === EVERY_DAY) return 'Every day';
	if (days === WEEKDAYS) return 'Weekdays';
	if (days === WEEKEND) return 'Weekends';
	return WEEK.filter((d) => days & (1 << d.bit))
		.map((d) => d.short)
		.join(' ');
}

export const fmtMinute = (m: number) =>
	`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export const levelToPercent = (level: number) => Math.max(1, Math.round((level / 254) * 100));
export const percentToLevel = (p: number) =>
	Math.min(254, Math.max(1, Math.round((p / 100) * 254)));
/** Kelvin ↔ mireds, rounded to 50 K for display. */
export const miredsToKelvin = (m: number) => Math.round(1_000_000 / m / 50) * 50;
export const kelvinToMireds = (k: number) => Math.round(1_000_000 / k);

export function fadeLabel(seconds: number): string {
	const min = Math.round(seconds / 60);
	return min >= 1 ? `${min} min` : `${seconds} s`;
}

/** "Turn on · 60 % · 2700 K · fade in 30 min" */
export function describe(t: Timer): string {
	const parts = [{ on: 'Turn on', off: 'Turn off', adjust: 'Adjust' }[t.action]];
	if (t.action !== 'off') {
		const from = (start: string | false) =>
			start && t.action === 'on' && t.fade ? `${start} → ` : '';
		if (t.level)
			parts.push(
				`${from(t.startLevel > 0 && `${levelToPercent(t.startLevel)} %`)}${levelToPercent(t.level)} %`
			);
		if (t.mireds)
			parts.push(
				`${from(t.startMireds > 0 && `${miredsToKelvin(t.startMireds)} K`)}${miredsToKelvin(t.mireds)} K`
			);
	}
	if (t.fade) {
		parts.push(
			`${t.action === 'on' ? 'fade in' : t.action === 'off' ? 'fade out' : 'over'} ${fadeLabel(t.fade)}`
		);
	}
	return parts.join(' · ');
}

/** Minutes from now until the timer runs next (ignores disabled), or undefined. */
export function minutesUntil(
	t: Timer,
	now: { minute: number; weekday: number }
): number | undefined {
	if (!t.enabled) return undefined;
	if (isOnce(t)) return t.remaining === undefined ? undefined : Math.ceil(t.remaining / 60);
	for (let day = 0; day < 8; day++) {
		const weekday = (now.weekday + day) % 7;
		if (!(t.days & (1 << weekday))) continue;
		const delta = day * 1440 + t.minute - now.minute;
		if (delta > 0) return delta;
	}
	return undefined;
}

/** "in 5 min", "in 2 h 10 min", "in 3 d" */
export function inWords(minutes: number) {
	const h = Math.floor(minutes / 60);
	const m = minutes % 60;
	if (h >= 24) return `in ${Math.floor(h / 24)} d`;
	if (!h) return `in ${m} min`;
	return m ? `in ${h} h ${m} min` : `in ${h} h`;
}
