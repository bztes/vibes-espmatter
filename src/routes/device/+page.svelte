<!--
	The configurator for a new, unsaved device. The template is picked on the start page and passed
	in the history state; without it (e.g. after a reload) this goes back there.
-->
<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import Configurator from '#lib/components/Configurator.svelte';
	import { readDraft } from '#lib/draft.ts';
	import { defaultProject } from '#lib/device/generator.ts';

	const chosen = $derived(page.state.newDevice);

	$effect(() => {
		if (!chosen) goto(resolve('/'), { replaceState: true });
	});

	function initial(template: string) {
		const draft = template === 'draft' ? readDraft() : null;
		return draft ?? defaultProject(template !== 'empty' ? template : undefined);
	}
</script>

<svelte:head>
	<title>New device – vibes-espmatter</title>
</svelte:head>

{#if chosen}
	{#key chosen}
		<Configurator initial={initial(chosen.template)} keepDraft />
	{/key}
{/if}
