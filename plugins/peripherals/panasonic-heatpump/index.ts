import { CLUSTER, DEVICE_TYPE, definePeripheral } from '#sdk';

/**
 * Panasonic air conditioners / air-to-air heat pumps on the CN-CNT service port (the connector of
 * the CZ-TACG1 Wi-Fi adapter), as a Matter Room Air Conditioner. Protocol as documented by the
 * esphome-panasonic-ac project (DomiStyle, MIT).
 */
export default definePeripheral({
	type: 'peripheral',
	id: 'panasonic-heatpump',
	name: 'Panasonic heat pump',
	description:
		'Panasonic air conditioner / heat pump on its CN-CNT port (replaces the CZ-TACG1 adapter, no cloud) – a Matter Room Air Conditioner with thermostat and fan.',
	icon: 'heater',
	category: 'climate',
	version: '1.0.0',
	author: 'espmatter',
	matter: {
		endpoints: [
			{
				deviceType: DEVICE_TYPE.roomAirConditioner,
				clusters: [CLUSTER.onOff, CLUSTER.thermostat, CLUSTER.fanControl]
			}
		]
	},
	fields: [
		{
			type: 'gpio',
			key: 'rx',
			label: 'UART RX (from the unit’s TX)',
			use: 'input',
			role: 'uart-rx',
			default: -1
		},
		{
			type: 'gpio',
			key: 'tx',
			label: 'UART TX (to the unit’s RX)',
			use: 'output',
			role: 'uart-tx',
			default: -1
		},
		{
			type: 'number',
			key: 'poll',
			label: 'Poll every',
			unit: 's',
			default: 5,
			min: 2,
			max: 60,
			integer: true,
			advanced: true,
			perDevice: true
		}
	],
	validate({ settings }) {
		return settings.rx === settings.tx && Number(settings.rx) >= 0
			? [{ severity: 'error', field: 'tx', message: 'RX and TX must be different pins.' }]
			: [];
	},
	contribute({ settings, instance, cfg }, out) {
		const { uid, name } = instance;
		out
			.firmware()
			.source('espm_pac.cpp', 'espm_pac.h')
			.include('"espm_pac.h"')
			.define({
				ESPM_PAC_RX: Number(settings.rx),
				ESPM_PAC_TX: Number(settings.tx),
				ESPM_PAC_POLL_S: cfg('poll'),
				ESPM_PAC_UID: uid
			})
			.init('matter', 'espm_pac_init();')
			.init('started', 'espm_pac_start();');

		const conv = `${uid}-lvl`;
		out.part({
			id: conv,
			name: 'Level converter',
			subtitle: '3.3 V ↔ 5 V, 2 channels (BSS138)',
			pins: [
				{ label: 'LV', kind: 'power' },
				{ label: 'LV1', kind: 'ctrl' },
				{ label: 'LV2', kind: 'ctrl' },
				{ label: 'GND', kind: 'gnd' }
			],
			outer: [
				{ label: 'HV', kind: 'power' },
				{ label: 'HV1', kind: 'ctrl' },
				{ label: 'HV2', kind: 'ctrl' },
				{ label: 'GND', kind: 'gnd' }
			],
			note: 'LV side to the ESP32 (3.3 V), HV side to the unit (5 V). Never connect the unit to the ESP32 directly.'
		});
		out.part({
			id: uid,
			name: 'Indoor unit CN-CNT',
			subtitle: '5-pin service connector',
			pins: [
				{ label: '5V', kind: 'power' },
				{ label: 'TX', kind: 'ctrl', functions: ['unit sends'] },
				{ label: 'RX', kind: 'ctrl', functions: ['unit receives'] },
				{ label: 'GND', kind: 'gnd' },
				{ label: '12V', kind: 'nc', reserved: 'not used' }
			],
			note: 'Pin order differs between units: find GND, 5 V and 12 V with a multimeter first (leave 12 V unconnected). Switch the unit off at the breaker before opening it.'
		});
		const esp = (pin: string) => ({ node: 'slot:main', pin });
		const lvl = (pin: string) => ({ node: `part:${conv}`, pin });
		const unit = (pin: string) => ({ node: `part:${uid}`, pin });
		out.wire(
			{ from: unit('5V'), to: lvl('HV'), label: 'Unit 5 V → HV', color: '#ef4444' },
			{
				from: lvl('HV'),
				to: esp('5V'),
				label: 'Unit 5 V → ESP 5V (no USB at the same time!)',
				color: '#f87171'
			},
			{ from: esp('3V3'), to: lvl('LV'), label: 'ESP 3V3 → LV (reference)', color: '#f97316' },
			{ from: esp('GND'), to: lvl('GND'), label: 'Ground', color: '#64748b' },
			{ from: lvl('GND'), to: unit('GND'), label: 'Ground (unit)', color: '#475569' },
			{ from: unit('TX'), to: lvl('HV1'), label: 'Unit TX → HV1', color: '#3b82f6' },
			{ from: lvl('LV1'), to: esp(`gpio:${settings.rx}`), label: 'LV1 → ESP RX', color: '#60a5fa' },
			{ from: esp(`gpio:${settings.tx}`), to: lvl('LV2'), label: 'ESP TX → LV2', color: '#f59e0b' },
			{ from: lvl('HV2'), to: unit('RX'), label: 'HV2 → unit RX', color: '#fbbf24' }
		);
		out.api(
			{
				method: 'GET',
				path: `/api/v1/peripherals/${uid}`,
				summary: `${name}: state reported by the unit`,
				auth: 'token',
				response: {
					uid,
					peripheral: 'panasonic-heatpump',
					online: true,
					power: true,
					mode: 'heat',
					target: 21.5,
					fan: 'auto',
					inside: 20.0,
					outside: 3.0
				}
			},
			{
				method: 'POST',
				path: `/api/v1/peripherals/${uid}`,
				summary: `${name}: change settings`,
				description: 'Only the given fields change.',
				auth: 'token',
				params: [
					{ name: 'power', type: 'boolean', description: 'On/off', in: 'body' },
					{
						name: 'mode',
						type: 'string',
						description: 'auto | heat | cool | dry | fan',
						in: 'body'
					},
					{ name: 'target', type: 'number', description: '16–30 °C in 0.5 steps', in: 'body' },
					{ name: 'fan', type: 'string', description: 'auto | 1 … 5', in: 'body' }
				],
				response: { ok: true }
			}
		);
		out.note(
			'Heat pump: unplug the CZ-TACG1 adapter if one is connected – only one device may talk on CN-CNT.'
		);
	}
});
