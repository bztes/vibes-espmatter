<script lang="ts">
	import BuildPanel from '#lib/components/BuildPanel.svelte';
	import { Panel } from '#lib/device/device-ui/ui/index.ts';
	import type { PageProps } from './$types';

	let { params }: PageProps = $props();
</script>

<svelte:head>
	<title>Build – vibes-espmatter</title>
</svelte:head>

<div class="mx-auto px-4 py-6 max-w-[896px]">
	<h1 class="mt-0 mb-4 text-xl">Firmware build</h1>
	<Panel>
		<BuildPanel buildId={params.id} />
	</Panel>
</div>
