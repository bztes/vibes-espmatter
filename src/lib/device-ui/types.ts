import type { Component } from 'svelte';

export interface ShellPage {
	id: string;
	title: string;
	path: string;
	/** Linked in the user menu instead of the header. */
	menu?: boolean;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	icon?: Component<any>;
}

export interface ShellWidget {
	page: string;
	title: string;
	wide?: boolean;
	/** Tab of its page (default `General`); a page with one tab shows no tab bar. */
	tab?: string;
	/** Full width, no card and title. */
	plain?: boolean;
	/** `account`: every account sees it; default: admins only. */
	access?: 'admin' | 'account';
	props: Record<string, unknown>;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	component: Component<any>;
}

export interface ShellProps {
	device: { name: string; kind: 'hub' | 'device' };
	pages: ShellPage[];
	widgets: ShellWidget[];
	/** Skip the login check (previews). */
	preview?: boolean;
}
