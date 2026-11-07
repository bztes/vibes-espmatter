import { defineFeature } from '#sdk';

export default defineFeature({
	type: 'feature',
	id: 'status-led',
	name: 'Status LED',
	description: 'Shows pairing, connection and identify on the board’s LED (or one you wire up).',
	icon: 'lightbulb',
	kinds: ['hub', 'device'],
	fields: [
		{
			type: 'select',
			key: 'source',
			label: 'LED',
			default: (ctx) => (ctx.board.led ? 'board' : 'gpio'),
			options: [
				{ value: 'board', label: 'Onboard LED' },
				{ value: 'gpio', label: 'External LED on a GPIO' }
			]
		},
		{
			type: 'gpio',
			key: 'gpio',
			label: 'LED pin',
			use: 'output',
			role: 'led',
			default: -1,
			when: (s) => s.source === 'gpio'
		},
		{
			type: 'boolean',
			key: 'activeLow',
			label: 'Active low',
			default: false,
			when: (s) => s.source === 'gpio'
		},
		{
			type: 'number',
			key: 'brightness',
			label: 'Brightness',
			unit: '%',
			default: 20,
			min: 1,
			max: 100,
			integer: true,
			perDevice: true
		}
	],
	validate({ settings, board }) {
		return settings.source === 'board' && !board().led
			? [
					{
						severity: 'error',
						field: 'source',
						message: `The ${board().name} has no onboard LED – wire one up and choose "External LED".`
					}
				]
			: [];
	},
	contribute({ settings, board, cfg }, out) {
		const led = board().led;
		const external = settings.source === 'gpio';
		const gpio = external ? Number(settings.gpio) : (led?.gpio ?? -1);
		const ws2812 = !external && led?.type === 'ws2812';
		const fw = out
			.firmware()
			.source('espm_led.cpp', 'espm_led.h')
			.include('"espm_led.h"')
			.define({
				ESPM_LED_GPIO: gpio,
				ESPM_LED_WS2812: ws2812,
				ESPM_LED_ACTIVE_LOW: external ? !!settings.activeLow : !!led?.activeLow,
				ESPM_LED_BRIGHTNESS: cfg('brightness')
			})
			.init('early', 'espm_led_start();');
		if (ws2812) fw.component('espressif/led_strip', '^2.5.0');
		if (external && gpio >= 0)
			out.part({
				id: 'status-led',
				name: 'LED',
				subtitle: 'with 220–330 Ω resistor',
				pins: [
					{ label: '+', kind: 'ctrl' },
					{ label: '−', kind: 'gnd' }
				],
				note: 'Put a 220–330 Ω resistor in series with the LED.'
			});
		if (external && gpio >= 0)
			out.wire(
				{
					from: { node: 'slot:main', pin: `gpio:${gpio}` },
					to: { node: 'part:status-led', pin: '+' },
					label: 'LED (via resistor)',
					color: '#22c55e'
				},
				{
					from: { node: 'slot:main', pin: 'GND' },
					to: { node: 'part:status-led', pin: '−' },
					label: 'Ground',
					color: '#64748b'
				}
			);
	}
});
