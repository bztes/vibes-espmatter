import type { Component } from 'svelte';
import type { SpotItem } from './spots.svelte';

/**
 * A widget preview for /dev/ui: `stories.ts` in a plugin folder exports `Story[]` as default (also
 * in the shell preview) and as `parts` (components inside widgets, e.g. a dialog's content). The
 * device API is mocked from `api`: keys are `GET /path` (or just `/path`) and `POST /path`.
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
	page?: string;
	/** Tab of the admin page in the shell preview. */
	tab?: string;
	/** Shown without a card in the shell preview. */
	plain?: boolean;
}

/** A spot item on every preview (`export const spotStories` of a `stories.ts`), with its mocked API. */
export interface SpotStory extends SpotItem {
	api?: Record<string, unknown>;
}
