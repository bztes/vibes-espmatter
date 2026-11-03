import { expect, it } from 'vitest';

// Its own file: the registry must be the first module loaded, as in the app's routes.
it('loads the registry before anything else', async () => {
	const { features } = await import('./registry');
	expect(features.all().length).toBeGreaterThan(0);
});
