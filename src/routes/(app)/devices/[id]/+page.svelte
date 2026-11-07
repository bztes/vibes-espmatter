<script lang="ts">
	import { page } from '$app/state';
	import { getDevice } from '#lib/remote/devices.remote.ts';
	import DeviceWorkspace from '#lib/components/DeviceWorkspace.svelte';
	import type { PageProps } from './$types';

	let { params }: PageProps = $props();

	const device = $derived(await getDevice(params.id));
	const tab = $derived(page.url.searchParams.get('tab') ?? 'settings');
</script>

<svelte:head><title>{device.name} – espmatter studio</title></svelte:head>

{#key device.id}
	<DeviceWorkspace {device} {tab} />
{/key}
