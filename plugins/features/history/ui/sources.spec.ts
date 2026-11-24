import { describe, expect, it } from 'vitest';
import { axis, format, metricLabel, parse, parseDevice, segments, ticks } from './sources';

describe('history sources', () => {
	it('read ClickHouse JSONCompact', () => {
		const raw = {
			meta: [{ name: 't', type: 'UInt32' }],
			data: [
				[1200, 21.5, 21, 22, 21.8],
				[600, '20.5', 20, 21],
				[1800, null, null, null, null]
			],
			rows: 3
		};
		expect(parse('clickhouse', raw)).toEqual([
			{ t: 600, avg: 20.5, min: 20, max: 21, last: 20.5 },
			{ t: 1200, avg: 21.5, min: 21, max: 22, last: 21.8 }
		]);
		expect(() => parse('clickhouse', { exception: 'x' })).toThrow();
		expect(() => parse('nope', {})).toThrow(/Unknown/);
	});

	it('read all values of a device by key', () => {
		const raw = {
			data: [
				['temperature|endpoint=1', 600, 20, 19, 21, 20],
				['uptime|', 600, 5, 4, 6, 6],
				['temperature|endpoint=1', 0, 18, 17, 19, 18],
				[7, 0, 1, 1, 1, 1]
			]
		};
		const by = parseDevice('clickhouse', raw);
		expect([...by.keys()]).toEqual(['temperature|endpoint=1', 'uptime|']);
		expect(by.get('temperature|endpoint=1')!.map((p) => p.t)).toEqual([0, 600]);
		expect(by.get('uptime|')).toEqual([{ t: 600, avg: 5, min: 4, max: 6, last: 6 }]);
	});

	it('break lines at gaps', () => {
		const p = (t: number) => ({ t, avg: 1, min: 1, max: 1, last: 1 });
		expect(segments([p(0), p(60), p(120), p(600), p(660)]).map((s) => s.length)).toEqual([3, 2]);
	});

	it('format values and names', () => {
		expect(format(21.456, 'Cel')).toMatch(/^21[.,]5 °C$/);
		expect(format(150000, 'By')).toBe('146 KB');
		expect(format(1, '1')).toBe('1');
		expect(format(523000, 's')).toBe('6d 1h');
		expect(format(260, 's')).toBe('4m 20s');
		expect(format(3600, 's')).toBe('1h');
		expect(format(12.5, 's')).toMatch(/^12[.,]5 s$/);
		expect(format(250, 'ms')).toBe('250 ms');
		expect(metricLabel('thermostat_local_temperature')).toBe('Thermostat local temperature');
		expect(metricLabel('device.memory.free')).toBe('Memory free');
	});

	it('pick round ticks', () => {
		expect(ticks(0, 100)).toEqual([0, 25, 50, 75, 100]);
		expect(ticks(20.3, 22.9)).toEqual([21, 22]);
		expect(ticks(20.3, 21.1)).toEqual([20.5, 20.75, 21]);
		expect(ticks(5, 5)).toEqual([5]);
		expect(axis(0, 600000, 's').map((t) => t.label)).toEqual(['0 d', '2 d', '4 d', '6 d']);
		expect(axis(20, 22, 'Cel').map((t) => t.v)).toEqual([20, 20.5, 21, 21.5, 22]);
	});
});
