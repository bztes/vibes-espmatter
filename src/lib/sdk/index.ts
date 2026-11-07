/**
 * `#sdk` – everything a plugin may import. See `types.ts` for the contract.
 */
import { CHIPS } from './chips';
import type { BoardDef, ChipId, FeatureDef, PinDef, Settings, PeripheralDef } from './types';

export * from './types';
export { CHIPS, chip, chipIds } from './chips';
export { cString, slug } from './util';
export * from './matter';

/** Identity helpers: give plugins type inference and a single place to add checks later. */
export const defineBoard = (board: BoardDef): BoardDef => board;
export const defineFeature = <S extends Settings>(def: FeatureDef<S>): FeatureDef<S> => def;
export const definePeripheral = <S extends Settings>(def: PeripheralDef<S>): PeripheralDef<S> =>
	def;

// ---------------------------------------------------------------------------------------------
// Pin shortcuts for board files
// ---------------------------------------------------------------------------------------------

/** A GPIO pin labelled with its number. */
export const gpio = (n: number, functions?: string[], reserved?: string): PinDef => ({
	label: String(n),
	kind: 'gpio',
	gpio: n,
	functions,
	reserved
});

/** A GPIO pin with its own label, e.g. `TX`. */
export const named = (
	label: string,
	n: number,
	functions?: string[],
	reserved?: string
): PinDef => ({
	label,
	kind: 'gpio',
	gpio: n,
	functions,
	reserved
});

export const power = (label: string, note?: string): PinDef => ({ label, kind: 'power', note });
export const gnd = (): PinDef => ({ label: 'GND', kind: 'gnd' });
export const ctrl = (label: string): PinDef => ({ label, kind: 'ctrl' });
export const nc = (label = 'NC'): PinDef => ({ label, kind: 'nc' });

/**
 * A board without a known pinout: every GPIO of the chip except the flash pins, on two headers.
 * Good enough for custom PCBs and modules.
 */
export function genericBoard(
	chipId: ChipId,
	overrides: Partial<BoardDef> & Pick<BoardDef, 'id' | 'name'>
): BoardDef {
	const c = CHIPS[chipId];
	const usable = c.gpios.filter((n) => !c.flashPins.includes(n));
	const half = Math.ceil(usable.length / 2);
	const pin = (n: number) => gpio(n, c.adc[n] ? [c.adc[n]] : undefined);
	return {
		chip: chipId,
		flashMB: 4,
		psram: 'none',
		usb: c.capabilities.includes('usb-serial-jtag') ? 'usb-serial-jtag' : 'uart-bridge',
		generic: true,
		headers: {
			left: [power('3V3'), gnd(), ...usable.slice(0, half).map(pin)],
			right: [power('5V'), gnd(), ...usable.slice(half).map(pin)]
		},
		...overrides
	};
}
