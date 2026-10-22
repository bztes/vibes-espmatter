/**
 * In-page replacements for the browser's alert(), confirm() and prompt() – shown by <Dialogs />,
 * which each app mounts once. Requests made while one is open wait their turn.
 */

type Request = { title: string; message: string } & (
	| { kind: 'alert'; resolve: () => void }
	| {
			kind: 'confirm';
			action: string;
			danger: boolean;
			resolve: (ok: boolean) => void;
	  }
	| { kind: 'prompt'; value: string; resolve: (value: string | null) => void }
);

/** Open requests, the first one shown. */
export const queue = $state<Request[]>([]);

export function showAlert(title: string, message: string): Promise<void> {
	return new Promise((resolve) => queue.push({ kind: 'alert', title, message, resolve }));
}

/**
 * True if confirmed. `action` labels the confirm button (e.g. “Delete”), `danger` colors it for
 * destructive actions.
 */
export function showConfirm(
	title: string,
	message: string,
	{ action = 'OK', danger = false }: { action?: string; danger?: boolean } = {}
): Promise<boolean> {
	return new Promise((resolve) =>
		queue.push({ kind: 'confirm', title, message, action, danger, resolve })
	);
}

/** The entered text, or null if cancelled. `message` labels the input. */
export function showPrompt(title: string, message: string, value = ''): Promise<string | null> {
	return new Promise((resolve) => queue.push({ kind: 'prompt', title, message, value, resolve }));
}
