<script lang="ts">
	import { page } from '$app/state';
	import { getFirmware } from '#lib/remote/firmware.remote.ts';
	import FirmwareWorkspace from '#lib/components/FirmwareWorkspace.svelte';
	import type { PageProps } from './$types';

	let { params }: PageProps = $props();

	const firmware = $derived(await getFirmware(params.id));
	const tab = $derived(page.url.searchParams.get('tab') ?? 'settings');
</script>

<svelte:head><title>{firmware.name} – espmatter studio</title></svelte:head>

{#key firmware.id}
	<FirmwareWorkspace {firmware} {tab} />
{/key}
