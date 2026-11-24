import type { DeviceRef } from './spots.svelte';

/** A value of a device: its telemetry series. */
export type ValueSeries = DeviceRef & { metric: string; labels?: string };
/** A value a card shows, with its name on the card. */
export type ValueRef = ValueSeries & { label: string };

/** Where a click on a value leads. */
export interface ValueLinkTarget {
	href: string;
	/** Tooltip, e.g. "History of Power". */
	title: string;
}

/**
 * What a plugin opens for values (`out.valueTarget()`, default export of the file): undefined when it
 * has nothing for that value. Called while rendering, so it may read reactive state.
 */
export type ValueTarget = (ref: ValueRef) => ValueLinkTarget | undefined;

let registry = $state.raw<ValueTarget[]>([]);

/** Set at startup: what plugins open for values. */
export function registerValueTargets(list: ValueTarget[]) {
	registry = list;
}

/** The first plugin's answer for the value. */
export function valueTarget(ref: ValueRef): ValueLinkTarget | undefined {
	for (const target of registry) {
		const found = target(ref);
		if (found) return found;
	}
}
