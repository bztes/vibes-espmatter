import { getContext, setContext, type Snippet } from 'svelte';

const KEY = Symbol('card-header');

export interface CardHeader {
	/** Replaces the card's title. */
	title?: Snippet;
	/** At the end of the header. */
	actions?: Snippet;
}

/** For a card: what's inside may fill its header. */
export function provideCardHeader(): CardHeader {
	const header = $state<CardHeader>({});
	setContext(KEY, header);
	return header;
}

/** For a dialog or similar: what's inside doesn't belong to the card around it. */
export function blockCardHeader() {
	setContext(KEY, undefined);
}

/** Fills the header of the card around; false if there is none. */
export function cardHeader(parts: CardHeader): boolean {
	const header = getContext<CardHeader | undefined>(KEY);
	if (!header) return false;
	$effect(() => {
		header.title = parts.title;
		header.actions = parts.actions;
		return () => {
			header.title = undefined;
			header.actions = undefined;
		};
	});
	return true;
}
