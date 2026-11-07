import { CLUSTER, DEVICE_TYPE, cString, definePeripheral } from '#sdk';

const ADDRESSES: Record<string, number> = { sht4x: 0x44, sht3x: 0x44, 'sht3x-b': 0x45 };

export default definePeripheral({
	type: 'peripheral',
	id: 'climate-sensor',
	name: 'Temperature & humidity',
	description:
		'A Sensirion SHT4x or SHT3x on I²C – Matter temperature and humidity sensors. Several sensors can share one bus.',
	icon: 'thermometer',
	category: 'sensor',
	version: '1.0.0',
	multiple: true,
	matter: {
		endpoints: [
			{ deviceType: DEVICE_TYPE.temperatureSensor, clusters: [CLUSTER.temperatureMeasurement] },
			{ deviceType: DEVICE_TYPE.humiditySensor, clusters: [CLUSTER.relativeHumidityMeasurement] }
		]
	},
	fields: [
		{
			type: 'select',
			key: 'model',
			label: 'Sensor',
			default: 'sht4x',
			options: [
				{ value: 'sht4x', label: 'SHT40 / SHT41 / SHT45 (0x44)' },
				{ value: 'sht3x', label: 'SHT30 / SHT31 / SHT35 (0x44)' },
				{ value: 'sht3x-b', label: 'SHT3x with ADDR high (0x45)' }
			]
		},
		{ type: 'gpio', key: 'sda', label: 'I²C SDA', use: 'open-drain', role: 'i2c-sda', default: -1 },
		{ type: 'gpio', key: 'scl', label: 'I²C SCL', use: 'open-drain', role: 'i2c-scl', default: -1 },
		{
			type: 'number',
			key: 'interval',
			label: 'Measure every',
			unit: 's',
			default: 30,
			min: 2,
			max: 3600,
			integer: true,
			perDevice: true
		},
		{
			type: 'number',
			key: 'offset',
			label: 'Temperature offset',
			unit: '°C',
			default: 0,
			min: -10,
			max: 10,
			step: 0.1,
			advanced: true,
			perDevice: true
		}
	],
	validate({ settings }) {
		return settings.sda === settings.scl && Number(settings.sda) >= 0
			? [{ severity: 'error', field: 'scl', message: 'SDA and SCL must be different pins.' }]
			: [];
	},
	contribute({ settings, instance, cfg }, out) {
		const { uid, name } = instance;
		const model = String(settings.model);
		out
			.firmware()
			.source('espm_climate.cpp', 'espm_climate.h')
			.include('"espm_climate.h"')
			.init(
				'matter',
				`espm_climate_add({${cString(uid)}, ${cString(name)}, ${model === 'sht4x' ? 'ESPM_SHT4X' : 'ESPM_SHT3X'}, 0x${ADDRESSES[model].toString(16)}, ${Number(settings.sda)}, ${Number(settings.scl)}, ${cfg('interval')}, (float)${cfg('offset')}});`
			);
		out.part({
			id: uid,
			name,
			subtitle: `${model.startsWith('sht4') ? 'SHT4x' : 'SHT3x'} breakout (0x${ADDRESSES[model].toString(16)})`,
			pins: [
				{ label: 'VIN', kind: 'power' },
				{ label: 'GND', kind: 'gnd' },
				{ label: 'SCL', kind: 'ctrl' },
				{ label: 'SDA', kind: 'ctrl' }
			],
			note: 'Breakouts usually have I²C pull-ups. Keep the sensor away from the ESP – its heat skews the reading (use the offset).'
		});
		out.wire(
			{
				from: { node: 'slot:main', pin: '3V3' },
				to: { node: `part:${uid}`, pin: 'VIN' },
				label: '3.3 V',
				color: '#ef4444'
			},
			{
				from: { node: 'slot:main', pin: 'GND' },
				to: { node: `part:${uid}`, pin: 'GND' },
				label: 'Ground',
				color: '#64748b'
			},
			{
				from: { node: 'slot:main', pin: `gpio:${settings.sda}` },
				to: { node: `part:${uid}`, pin: 'SDA' },
				label: 'I²C SDA',
				color: '#3b82f6'
			},
			{
				from: { node: 'slot:main', pin: `gpio:${settings.scl}` },
				to: { node: `part:${uid}`, pin: 'SCL' },
				label: 'I²C SCL',
				color: '#eab308'
			}
		);
		out.api({
			method: 'GET',
			path: `/api/v1/peripherals/${uid}`,
			summary: `${name}: last measurement`,
			auth: 'token',
			response: {
				uid,
				peripheral: 'climate-sensor',
				name,
				temperature: 21.4,
				humidity: 48.2,
				ok: true,
				age: 12
			}
		});
	}
});
