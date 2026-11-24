import type { ComponentProps } from 'svelte';
import type { Popup } from '#sdk/device-ui';
import ValueHistory from './ValueHistory.svelte';

/** A value's history large, in the page's popup. */
export const valuePopup = (
	device: string,
	label: string,
	props: ComponentProps<typeof ValueHistory>
): Popup<ComponentProps<typeof ValueHistory>> => ({
	title: `${device} · ${label}`,
	component: ValueHistory,
	props,
	wide: true
});
