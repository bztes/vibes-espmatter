import { describe, expect, it } from 'vitest';
import { increase, span, timeInStates, valueText } from './kinds';

const p = (t: number, avg: number, min: number, max: number, last: number) => ({
	t,
	avg,
	min,
	max,
	last
});

describe('history kinds', () => {
	it('add up a counter across a reset', () => {
		expect(increase([p(0, 10, 10, 11, 11), p(60, 12, 11, 13, 13), p(120, 1, 0, 2, 2)])).toBe(5);
		expect(span([p(0, 1, 1, 1, 1), p(60, 1, 1, 1, 1)], 30, 1000)).toBe(90);
	});

	it('split time between states', () => {
		expect(timeInStates([p(0, 0.25, 0, 1, 1), p(60, 1, 1, 1, 1)], 0, 120)).toEqual([
			{ value: 1, seconds: 75 },
			{ value: 0, seconds: 45 }
		]);
	});

	it('name states', () => {
		const s = (metric: string) => ({
			metric,
			labels: '',
			unit: '1',
			value: 0,
			kind: 'state' as const
		});
		expect(valueText(s('on_off'), 1)).toBe('On');
		expect(valueText(s('thermostat_system_mode'), 5)).toBe('Emergency heat');
		expect(valueText(s('lock_state'), 9)).toBe('9');
		expect(valueText({ ...s('level'), kind: 'gauge' }, 3)).toBe('3');
	});
});
