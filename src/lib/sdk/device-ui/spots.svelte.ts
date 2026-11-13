import type { Component } from 'svelte';

/** The spots widgets offer to other plugins, with what each passes to its items as props. */
export interface Spots {
	/** Beside a device's name or controls: room for small icons only (buttons or status). */
	'device-icons': DeviceContext;
}
/** This device itself (`own`), or a paired device by its Matter node id. */
export type DeviceContext =
	{ own: true; node?: undefined; name: string } | { own?: false; node: number; name: string };

export type SpotName = keyof Spots;

export interface SpotItem {
	spot: SpotName;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	component: Component<any>;
}

let registry = $state.raw<SpotItem[]>([]);

/** Set at startup: what plugins put into spots. */
export function registerSpotItems(list: SpotItem[]) {
	registry = list;
}

export const itemsFor = (spot: SpotName) => registry.filter((a) => a.spot === spot);
