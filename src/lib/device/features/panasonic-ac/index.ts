import { pinLabel } from '../../pins';
import { configuratorEditors, firmware, parts, wires } from '../core/services';
import type { FeatureDef, PinDef, BoardDef, FeatureIssue, Validate } from '../../types';
import Editor, { PORTS } from './configurator/Editor.svelte';
import pacCpp from './firmware/espm_pac.cpp?raw';
import pacH from './firmware/espm_pac.h?raw';
import pacMatterCpp from './firmware/espm_pac_matter.cpp?raw';
import pacMetricsCpp from './firmware/espm_pac_metrics.cpp?raw';
import { matterNode } from '../matter-device/services';
import { otel } from '../otel/services';

const power = (label: string, reserved?: string): PinDef => ({ label, kind: 'power', reserved });
const gnd: PinDef = { label: 'GND', kind: 'gnd' };
const signal = (label: string, functions?: string[]): PinDef => ({
	label,
	kind: 'ctrl',
	functions
});

const CONVERTER = 'part:level-converter';
const UNIT = 'part:unit';

const defaults = (board: BoardDef) => {
	const supermini = board.id.endsWith('-supermini');
	return {
		port: 'cnt',
		rxGpio: supermini ? 4 : 16,
		txGpio: supermini ? 5 : 17
	};
};
export type PanasonicAcConfig = ReturnType<typeof defaults>;

const validate: Validate<PanasonicAcConfig> = ({ config }) => {
	const errors: FeatureIssue<PanasonicAcConfig>[] = [];
	if (!PORTS.some((o) => o.value === config.port))
		errors.push({ field: 'port', message: 'Connector on the unit: invalid option.' });
	if (config.rxGpio === config.txGpio)
		errors.push({ field: 'txGpio', message: 'UART RX and TX must be different pins.' });
	return errors;
};

/**
 * Panasonic air conditioners and air-to-air heat pumps (e.g. the Nordic HZ/XKE/ZKE series) on
 * their Wi-Fi adapter port, as a Matter Room Air Conditioner. Replaces the CZ-TACG1 (CN-CNT) or
 * DNSK-P11 (CN-WLAN) module and works without the Panasonic cloud.
 */
export default {
	id: 'panasonic_ac',
	dir: 'panasonic-ac',
	name: 'Panasonic heat pump',
	description: 'Panasonic air conditioner or heat pump as a Matter device.',
	category: 'hardware',
	chips: ['esp32', 'esp32s3', 'esp32c3', 'esp32c6', 'esp32h2'],
	defaults,
	pins: [
		{ key: 'rxGpio', label: 'UART RX (from the unit’s TX)' },
		{ key: 'txGpio', label: 'UART TX (to the unit’s RX)' }
	],
	validate,
	activate({ use, find, config, role, board }) {
		use(matterNode);
		use(configuratorEditors).register(Editor);
		const port = config.port === 'wlan' ? 'CN-WLAN' : 'CN-CNT';
		use(parts).register(
			{
				id: 'level-converter',
				name: 'Logic level converter',
				subtitle: '3.3 V ↔ 5 V, bidirectional',
				headers: {
					left: [power('LV'), signal('LV1'), signal('LV2'), gnd],
					right: [power('HV'), signal('HV1'), signal('HV2'), gnd]
				},
				note: 'Level converter (e.g. BSS138, at least 2 channels): the low-voltage side (LV, LV1, LV2) goes to the ESP32, the high-voltage side (HV, HV1, HV2) to the unit. LV gets 3.3 V, HV gets 5 V – mixing them up destroys the ESP32. The ESP32 runs from the unit’s 5 V (5V pin); its 3V3 pin is the output of its own regulator and only sets the converter’s low-side level. Unplug the 5 V wire before connecting USB – otherwise two 5 V sources meet.'
			},
			{
				id: 'unit',
				name: `Indoor unit ${port}`,
				subtitle: 'indoor unit, Wi-Fi adapter port',
				headers: {
					left: [
						power('5V'),
						signal('TX', ['unit sends']),
						signal('RX', ['unit receives']),
						gnd,
						...(config.port === 'wlan' ? [] : [power('12V', 'not used')])
					],
					right: []
				},
				note: `${port} pin order differs between units: find GND, 5 V${config.port === 'wlan' ? '' : ' and 12 V (leave it unconnected)'} with a multimeter before you connect anything, the remaining two are TX and RX. Switch the unit off at the breaker before you open it – mains contacts are exposed.`
			}
		);
		const chip = (pin: string) => ({ role: role.id, pin });
		const converter = (pin: string) => ({ role: CONVERTER, pin });
		const unit = (pin: string) => ({ role: UNIT, pin });
		use(wires).register(
			{ from: unit('5V'), to: converter('HV'), label: 'Unit 5 V → converter HV', color: '#ef4444' },
			{
				from: converter('HV'),
				to: chip('5V'),
				label: 'Unit 5 V → ESP32 5V (power input; no USB at the same time)',
				color: '#f87171'
			},
			{
				from: chip('3V3'),
				to: converter('LV'),
				label: 'ESP32 3V3 (its regulator output) → converter LV (reference only)',
				color: '#f97316'
			},
			{ from: chip('GND'), to: converter('GND'), label: 'Ground (ESP32 side)', color: '#64748b' },
			{ from: converter('GND'), to: unit('GND'), label: 'Ground (unit side)', color: '#475569' },
			{
				from: unit('TX'),
				to: converter('HV1'),
				label: 'Unit TX → converter HV1',
				color: '#3b82f6'
			},
			{
				from: converter('LV1'),
				to: chip(`gpio:${config.rxGpio}`),
				label: 'Converter LV1 → ESP32 RX',
				color: '#60a5fa'
			},
			{
				from: chip(`gpio:${config.txGpio}`),
				to: converter('LV2'),
				label: 'ESP32 TX → converter LV2',
				color: '#f59e0b'
			},
			{
				from: converter('HV2'),
				to: unit('RX'),
				label: 'Converter HV2 → unit RX',
				color: '#fbbf24'
			}
		);
		use(firmware).register(() => {
			const rx = pinLabel(board, Number(config.rxGpio));
			const tx = pinLabel(board, Number(config.txGpio));
			return {
				defines: {
					MESP_PAC_PROTOCOL_CNT: config.port !== 'wlan',
					MESP_PAC_RX_GPIO: Number(config.rxGpio),
					MESP_PAC_TX_GPIO: Number(config.txGpio)
				},
				sources: {
					'espm_pac.cpp': pacCpp,
					'espm_pac.h': pacH,
					'espm_pac_matter.cpp': pacMatterCpp
				},
				hooks: {
					includes: ['#include "espm_pac.h"'],
					preStart: ['mesp_pac_matter_init();'],
					postStart: ['mesp_pac_matter_start();']
				},
				notes: [
					`Wiring: see the wiring diagram – the unit’s ${port} connects through a 5 V ↔ 3.3 V level converter (unit TX → HV1, LV1 → ${rx}; ${tx} → LV2, HV2 → unit RX). Never connect the ESP32 pins to the unit directly.`,
					config.port === 'wlan'
						? 'CN-WLAN: the first connection takes about a minute (handshake). Don’t run the original module at the same time.'
						: 'CN-CNT: state is polled every 5 seconds. Remove the CZ-TACG1 adapter if one is plugged in.'
				]
			};
		});
		// With OpenTelemetry: what the unit reports as metrics.
		if (find(otel))
			use(firmware).register(() => ({
				sources: { 'espm_pac_metrics.cpp': pacMetricsCpp },
				hooks: {
					globals: ['void mesp_pac_metrics_init();'],
					preStart: ['mesp_pac_metrics_init();']
				}
			}));
	}
} satisfies FeatureDef<PanasonicAcConfig>;
