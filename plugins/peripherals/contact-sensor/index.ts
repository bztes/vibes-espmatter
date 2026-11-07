import { CLUSTER, DEVICE_TYPE, cString, definePeripheral } from '#sdk';

export default definePeripheral({
	type: 'peripheral',
	id: 'contact-sensor',
	name: 'Contact sensor',
	description:
		'A reed switch or any dry contact (door, window, mailbox) – a Matter Contact Sensor.',
	icon: 'door-open',
	category: 'sensor',
	version: '1.0.0',
	multiple: true,
	matter: {
		endpoints: [{ deviceType: DEVICE_TYPE.contactSensor, clusters: [CLUSTER.booleanState] }]
	},
	fields: [
		{ type: 'gpio', key: 'gpio', label: 'Contact pin', use: 'input', default: -1 },
		{ type: 'boolean', key: 'invert', label: 'Invert (normally open contact)', default: false },
		{
			type: 'number',
			key: 'debounce',
			label: 'Debounce',
			unit: 'ms',
			default: 50,
			min: 0,
			max: 2000,
			integer: true,
			advanced: true,
			perDevice: true
		}
	],
	contribute({ settings, instance, cfg }, out) {
		const { uid, name } = instance;
		out
			.firmware()
			.source('espm_contact.cpp', 'espm_contact.h')
			.include('"espm_contact.h"')
			.init(
				'matter',
				`espm_contact_add({${cString(uid)}, ${cString(name)}, ${Number(settings.gpio)}, ${settings.invert ? 'true' : 'false'}, ${cfg('debounce')}});`
			);
		out.part({
			id: uid,
			name,
			subtitle: 'reed switch',
			pins: [
				{ label: 'A', kind: 'ctrl' },
				{ label: 'B', kind: 'gnd' }
			],
			note: 'The internal pull-up is enabled – no resistor needed.'
		});
		out.wire(
			{
				from: { node: 'slot:main', pin: `gpio:${settings.gpio}` },
				to: { node: `part:${uid}`, pin: 'A' },
				label: `${name}: contact`,
				color: '#14b8a6'
			},
			{
				from: { node: 'slot:main', pin: 'GND' },
				to: { node: `part:${uid}`, pin: 'B' },
				label: 'Ground',
				color: '#64748b'
			}
		);
		out.api({
			method: 'GET',
			path: `/api/v1/peripherals/${uid}`,
			summary: `${name}: open or closed`,
			auth: 'token',
			response: {
				uid,
				peripheral: 'contact-sensor',
				name,
				closed: true,
				changes: 14,
				lastChange: 3600
			}
		});
	}
});
