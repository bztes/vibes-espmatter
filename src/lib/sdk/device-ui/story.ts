import type { Component } from 'svelte';

/**
 * A widget preview for /dev/ui: `stories.ts` in a plugin folder exports `Story[]`. The device API
 * is mocked from `api`: keys are `GET /path` (or just `/path`) and `POST /path`.
 */
export interface Story {
	name: string;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	component: Component<any>;
	props?: Record<string, unknown>;
	api?: Record<string, unknown>;
	/** Shown at the full width of a page instead of a widget card. */
	wide?: boolean;
	/** Page of the shell preview it appears on (default `dashboard`). */
	page?: 'dashboard' | 'automations' | 'settings';
	/** Tab of the admin page in the shell preview. */
	tab?: string;
	/** Shown without a card in the shell preview. */
	plain?: boolean;
}
