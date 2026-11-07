import { describe, expect, it } from 'vitest';
import { ACTIONS, actionsFor } from './actions';
import type { Endpoint } from './matter';

describe('ACTIONS', () => {
	it('builds the requests the dashboard sent before', () => {
		expect(ACTIONS.off.op()).toEqual({ op: 'invoke', cluster: 6, command: 0 });
		expect(ACTIONS.level.op(50)).toEqual({
			op: 'invoke',
			cluster: 8,
			command: 4,
			data: { '0:U8': 127, '1:U16': 0, '2:U8': 0, '3:U8': 0 }
		});
		expect(ACTIONS.colorTemperature.op(4000)).toEqual({
			op: 'invoke',
			cluster: 0x300,
			command: 0x0a,
			data: { '0:U16': 250, '1:U16': 0, '2:U8': 0, '3:U8': 0 }
		});
		expect(ACTIONS.lock.op()).toEqual({ op: 'invoke', cluster: 0x101, command: 0, timedMs: 5000 });
		expect(ACTIONS.position.op(30)).toEqual({
			op: 'invoke',
			cluster: 0x102,
			command: 5,
			data: { '0:U16': 7000 }
		});
		expect(ACTIONS.heatingSetpoint.op(21.5)).toEqual({
			op: 'write',
			cluster: 0x201,
			attribute: 0x12,
			type: 'I16',
			value: 2150
		});
		expect(ACTIONS.fanMode.op(3)).toEqual({
			op: 'write',
			cluster: 0x202,
			attribute: 0,
			type: 'U8',
			value: 3
		});
	});

	it('steps like the hub did', () => {
		expect(ACTIONS.darker.op()).toMatchObject({
			data: {
				'0:U8': 1,
				'1:U8': 51,
				'2:U16': 3,
				'3:U8': 0,
				'4:U8': 0
			}
		});
		expect(ACTIONS.warmer.op()).toMatchObject({
			data: {
				'0:U8': 1,
				'1:U16': 40,
				'2:U16': 3,
				'3:U16': 0,
				'4:U16': 0,
				'5:U8': 0,
				'6:U8': 0
			}
		});
	});

	it('offers what the endpoint can do', () => {
		const ep: Endpoint = { id: 1, deviceTypes: [0x101], clusters: [6, 8] };
		expect(actionsFor(ep).map(([id]) => id)).toEqual([
			'on',
			'off',
			'toggle',
			'level',
			'brighter',
			'darker'
		]);
	});
});
