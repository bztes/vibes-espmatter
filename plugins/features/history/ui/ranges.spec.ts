import { describe, expect, it } from 'vitest';
import {
	custom,
	fromLocalInput,
	presetView,
	shift,
	startOf,
	timeTicks,
	toLocalInput,
	zoomOut
} from './ranges';

const at = (s: string) => Math.floor(new Date(s).getTime() / 1000);
const now = new Date('2026-11-19T14:30:00');

describe('history ranges', () => {
	it('resolve calendar presets to whole periods', () => {
		expect(presetView('today', now)).toMatchObject({
			from: at('2026-11-19T00:00'),
			to: at('2026-11-20T00:00'),
			unit: 'day'
		});
		expect(presetView('yesterday', now)).toMatchObject({ from: at('2026-11-18T00:00') });
		expect(presetView('month', now)).toMatchObject({
			from: at('2026-11-01T00:00'),
			to: at('2026-12-01T00:00')
		});
	});

	it('start weeks on the given day', () => {
		expect(startOf(now, 'week', 1)).toEqual(new Date('2026-11-16T00:00'));
		expect(startOf(now, 'week', 0)).toEqual(new Date('2026-11-15T00:00'));
	});

	it('resolve rolling presets up to now', () => {
		expect(presetView('6h', now)).toEqual({
			from: at('2026-11-19T08:30'),
			to: at('2026-11-19T14:30'),
			preset: '6h'
		});
	});

	it('step by calendar periods or by length', () => {
		const prev = shift(presetView('month', now), -1);
		expect(prev).toEqual({
			from: at('2026-10-01T00:00'),
			to: at('2026-11-01T00:00'),
			unit: 'month'
		});
		expect(shift({ from: 100, to: 400 }, 1)).toEqual({ from: 400, to: 700 });
	});

	it('zoom out to the bigger period or twice the length', () => {
		const week = zoomOut(presetView('today', now), now);
		expect(week.unit).toBe('week');
		expect(
			zoomOut({ from: at('2026-11-05T00:00'), to: at('2026-11-06T00:00'), unit: 'month' }, now)
		).toMatchObject({ unit: 'year', from: at('2026-01-01T00:00') });
		expect(zoomOut({ from: 1000, to: 2000 }, new Date(10_000_000))).toEqual({
			from: 500,
			to: 2500
		});
		// Not past now.
		const t = at('2026-11-19T14:30');
		expect(zoomOut({ from: t - 3600, to: t }, now)).toEqual({ from: t - 7200, to: t });
	});

	it('take custom ranges within the limits only', () => {
		expect(custom(0, 3600)).toEqual({ from: 0, to: 3600 });
		expect(custom(0, 60)).toBeUndefined();
		expect(custom(3600, 0)).toBeUndefined();
		expect(custom(NaN, 3600)).toBeUndefined();
	});

	it('round-trip datetime-local values', () => {
		const t = at('2026-11-19T14:05');
		expect(toLocalInput(t)).toBe('2026-11-19T14:05');
		expect(fromLocalInput(toLocalInput(t))).toBe(t);
	});

	it('put time ticks on round clock times', () => {
		const { ticks, step } = timeTicks(at('2026-11-19T00:00'), at('2026-11-20T00:00'), 6);
		expect(step).toBe(6 * 3600);
		expect(ticks).toEqual([at('2026-11-19T06:00'), at('2026-11-19T12:00'), at('2026-11-19T18:00')]);
		const year = timeTicks(at('2026-01-01T00:00'), at('2027-01-01T00:00'), 6);
		expect(year.ticks).toEqual([
			at('2026-04-01T00:00'),
			at('2026-07-01T00:00'),
			at('2026-10-01T00:00')
		]);
	});
});
