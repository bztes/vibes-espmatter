// Separate from `index.ts`, which imports the registry: `configurator/Editor.svelte` importing that would load
// this feature before the registry and leave it `undefined` in the feature list.
export const ROLES = [
	{ value: 'updates', label: 'Updates the connected boards' },
	{ value: 'updated', label: 'Is updated by a connected board' }
];
