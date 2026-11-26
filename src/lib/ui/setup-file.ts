/** Setup files in the browser: saving an export, picking one to import. */

export function downloadSetup(setup: { exportedAt: string }, who: string) {
	const blob = new Blob([JSON.stringify(setup, null, '\t')], { type: 'application/json' });
	const a = document.createElement('a');
	a.href = URL.createObjectURL(blob);
	a.download = `setup-${who}-${setup.exportedAt.slice(0, 10)}.json`;
	a.click();
	setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** The parsed file the user picks; undefined when cancelled. */
export function pickSetupFile(): Promise<unknown> {
	return new Promise((resolve, reject) => {
		const input = document.createElement('input');
		input.type = 'file';
		input.accept = 'application/json,.json';
		input.addEventListener('cancel', () => resolve(undefined));
		input.addEventListener('change', async () => {
			const file = input.files?.[0];
			if (!file) return resolve(undefined);
			try {
				resolve(JSON.parse(await file.text()));
			} catch {
				reject(new Error('The file isn’t valid JSON.'));
			}
		});
		input.click();
	});
}

export const importedText = (r: { locations: number; firmwares: number; devices: number }) =>
	`Imported ${r.locations} locations, ${r.firmwares} firmwares and ${r.devices} devices.`;
