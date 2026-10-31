<!-- Developer view: each feature's device UI on its own, with the device API mocked (`stories.ts`). -->
<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { mockApi, stories } from '#lib/device/stories.ts';
	import { auth } from '#lib/device/features/web-ui/device-ui/auth.svelte.ts';

	const story = $derived.by(() => {
		const [dir, name] = (page.url.searchParams.get('story') ?? '').split('/');
		return stories[dir]?.find((s) => s.name === name);
	});

	mockApi(() => story?.api ?? {});

	// Before the story mounts: its user, and the polls (`live`, shared module state) answered anew.
	$effect.pre(() => {
		auth.session = {
			authenticated: true,
			user: 'admin',
			role: 'admin',
			mustChangePassword: false,
			authEnabled: true,
			...story?.session
		};
		document.dispatchEvent(new Event('visibilitychange'));
	});
</script>

<svelte:head>
	<title>Device UI stories – vibes-espmatter</title>
</svelte:head>

<!-- From `sm` on it fills `<main>` without growing it (size containment); sidebar and story scroll on their own. -->
<div
	class="mx-auto flex max-w-[1280px] gap-6 p-4 max-sm:flex-col sm:h-full sm:contain-size"
>
	<nav class="w-48 shrink-0 text-sm sm:overflow-y-auto">
		{#each Object.entries(stories) as [dir, list] (dir)}
			<h2 class="mt-3 mb-1 text-xs text-muted uppercase">{dir}</h2>
			{#each list as s (s.name)}
				<a
					href="{resolve('/dev/ui')}?story={dir}/{encodeURIComponent(s.name)}"
					class={[
						'block rounded px-2 py-1 no-underline',
						s === story ? 'bg-card font-semibold text-fg' : 'text-muted'
					]}>{s.name}</a
				>
			{/each}
		{:else}
			<p class="text-muted">No feature has a <code>stories.ts</code> yet.</p>
		{/each}
	</nav>

	<div class="min-w-0 flex-1 sm:overflow-y-auto">
		{#if story}
			{#key story}
				<div class={[!story.wide && 'max-w-[640px]']}>
					<story.component {...story.props} />
				</div>
			{/key}
		{:else}
			<p class="text-muted">Pick a story.</p>
		{/if}
	</div>
</div>
