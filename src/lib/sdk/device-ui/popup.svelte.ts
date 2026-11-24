import type { Component } from 'svelte';

/** A component shown in the page's one popup (`openPopup`). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface Popup<P extends Record<string, any> = any> {
	title: string;
	component: Component<P>;
	props: P;
	wide?: boolean;
}

let shown = $state.raw<Popup>();

/** Shows a component in a dialog over the page, in place of what is shown there. */
export function openPopup<P extends Record<string, unknown>>(popup: Popup<P>) {
	shown = popup;
}

/** What `PopupHost` shows. */
export const popup = {
	get current() {
		return shown;
	},
	close() {
		shown = undefined;
	}
};
