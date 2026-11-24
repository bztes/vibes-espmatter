import type { Component } from 'svelte';
import type { DeviceRef } from './spots.svelte';

/** A value of a device: its telemetry series. */
export type ValueSeries = DeviceRef & { metric: string; labels?: string };
/** A value a card shows, with its name on the card. */
export type ValueRef = ValueSeries & { label: string };

/** A component shown in a dialog over the page. */
export interface ValuePopup {
	title: string;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	component: Component<any>;
	props?: Record<string, unknown>;
}

/** What a click on a value opens. */
export interface ValueLinkTarget {
	/** Tooltip, e.g. "History of Power". */
	title: string;
	popup: ValuePopup;
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
