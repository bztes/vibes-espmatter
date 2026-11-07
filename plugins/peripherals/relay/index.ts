import { CLUSTER, DEVICE_TYPE, cString, definePeripheral } from '#sdk';

export default definePeripheral({
	type: 'peripheral',
	id: 'relay',
	name: 'Relay / plug',
	description:
		'Switches a relay module (lamp, socket, pump …) – a Matter On/Off Plug-in Unit. Optional push button to switch locally.',
	icon: 'power',
	category: 'actuator',
	version: '1.0.0',
	multiple: true,
	matter: { endpoints: [{ deviceType: DEVICE_TYPE.onOffPlugInUnit, clusters: [CLUSTER.onOff] }] },
	fields: [
		{ type: 'gpio', key: 'gpio', label: 'Relay pin', use: 'output', default: -1 },
		{ type: 'boolean', key: 'activeLow', label: 'Active low (most relay modules)', default: true },
		{
			type: 'select',
			key: 'startup',
			label: 'After power loss',
			default: 'last',
			options: [
				{ value: 'last', label: 'Restore last state' },
				{ value: 'off', label: 'Off' },
				{ value: 'on', label: 'On' }
			],
			perDevice: true
		},
		{
			type: 'gpio',
			key: 'button',
			label: 'Button pin (optional)',
			use: 'input',
			optional: true,
			default: -1,
			advanced: true
		}
	],
	contribute({ settings, instance, cfg }, out) {
		const { uid, name } = instance;
		const gpio = Number(settings.gpio);
		const button = Number(settings.button);
		// Per device: "off" → 0, "on" → 1, "last" → 2.
		const s = cfg('startup');
		const startup = `(strcmp(${s}, "off") == 0 ? 0 : strcmp(${s}, "on") == 0 ? 1 : 2)`;
		out
			.firmware()
			.source('espm_relay.cpp', 'espm_relay.h')
			.include('"espm_relay.h"')
			.init(
				'matter',
				`espm_relay_add({${cString(uid)}, ${cString(name)}, ${gpio}, ${settings.activeLow ? 'true' : 'false'}, ${startup}, ${button}});`
			);
		out.part({
			id: uid,
			name: `${name}`,
			subtitle: 'relay module',
			pins: [
				{ label: 'VCC', kind: 'power' },
				{ label: 'GND', kind: 'gnd' },
				{ label: 'IN', kind: 'ctrl' }
			],
			note: 'Most relay modules need 5 V on VCC but switch fine with a 3.3 V signal on IN. Mains wiring: only if you know what you’re doing.'
		});
		out.wire(
			{
				from: { node: 'slot:main', pin: `gpio:${gpio}` },
				to: { node: `part:${uid}`, pin: 'IN' },
				label: `${name}: control`,
				color: '#f59e0b'
			},
			{
				from: { node: 'slot:main', pin: '5V' },
				to: { node: `part:${uid}`, pin: 'VCC' },
				label: '5 V',
				color: '#ef4444'
			},
			{
				from: { node: 'slot:main', pin: 'GND' },
				to: { node: `part:${uid}`, pin: 'GND' },
				label: 'Ground',
				color: '#64748b'
			}
		);
		if (button >= 0) {
			out.part({
				id: `${uid}-btn`,
				name: `${name} button`,
				subtitle: 'push button',
				pins: [
					{ label: '1', kind: 'ctrl' },
					{ label: '2', kind: 'gnd' }
				]
			});
			out.wire(
				{
					from: { node: 'slot:main', pin: `gpio:${button}` },
					to: { node: `part:${uid}-btn`, pin: '1' },
					label: `${name}: button`,
					color: '#a855f7'
				},
				{
					from: { node: 'slot:main', pin: 'GND' },
					to: { node: `part:${uid}-btn`, pin: '2' },
					label: 'Ground',
					color: '#64748b'
				}
			);
		}
		out.api(
			{
				method: 'GET',
				path: `/api/v1/peripherals/${uid}`,
				summary: `${name}: state`,
				auth: 'token',
				response: { uid, peripheral: 'relay', name, on: true, endpoint: instance.endpoint }
			},
			{
				method: 'POST',
				path: `/api/v1/peripherals/${uid}`,
				summary: `${name}: switch`,
				auth: 'token',
				params: [
					{ name: 'on', type: 'boolean', description: 'New state', in: 'body' },
					{ name: 'toggle', type: 'boolean', description: 'Toggle instead', in: 'body' }
				],
				response: { on: false }
			}
		);
	}
});
