<script lang="ts">
	import Configurator from '#lib/components/Configurator.svelte';
	import { getProject } from '#lib/api/projects.remote.ts';
	import type { PageProps } from './$types';

	let { params }: PageProps = $props();

	const saved = $derived(await getProject(params.id));
</script>

<svelte:head>
	<title>{saved.name} – vibes-espmatter</title>
</svelte:head>

{#key saved.id}
	<Configurator
		initial={saved.config}
		projectId={saved.id}
		lastAddress={saved.lastAddress}
		lastSeenAt={saved.lastSeenAt}
	/>
{/key}
