import type { BoardDef, PinDef } from './types';

export const g = (gpio: number, functions?: string[], reserved?: string): PinDef => ({
	label: String(gpio),
	kind: 'gpio',
	gpio,
	functions,
	reserved
});
export const p = (label: string): PinDef => ({ label, kind: label === 'GND' ? 'gnd' : 'power' });
export const c = (label: string): PinDef => ({ label, kind: 'ctrl' });

export function boardPins(board: BoardDef): PinDef[] {
	return [...board.headers.left, ...board.headers.right];
}

/** All usable GPIOs of a board (deduplicated, sorted), excluding hard-reserved pins. */
export function boardGpios(board: BoardDef): PinDef[] {
	const seen = new Set<number>();
	return boardPins(board)
		.filter(
			(pin) =>
				pin.kind === 'gpio' && pin.gpio !== undefined && !seen.has(pin.gpio) && seen.add(pin.gpio)
		)
		.sort((a, b) => a.gpio! - b.gpio!);
}

/** The header label for a GPIO (e.g. `TX` for GPIO43 on the S3 DevKit), or `GPIO<n>`. */
export function pinLabel(board: BoardDef, gpio: number): string {
	const pin = boardPins(board).find((p) => p.gpio === gpio);
	if (!pin) return `GPIO${gpio}`;
	return pin.label === String(gpio) ? `GPIO${gpio}` : `${pin.label} (GPIO${gpio})`;
}
