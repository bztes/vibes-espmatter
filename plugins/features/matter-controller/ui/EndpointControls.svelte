<!-- The controls of one endpoint: one per cluster it serves (see clusters/index.ts). -->
<script lang="ts">
	import { controlsOf, readingsOf, type ClusterProps } from './clusters';
	import ReadingTile from './ReadingTile.svelte';

	let {
		node,
		ep,
		disabled = false,
		run,
		hide = []
	}: ClusterProps & {
		/** Clusters shown elsewhere, e.g. On/Off as the card's switch. */
		hide?: number[];
	} = $props();

	const controls = $derived(controlsOf(ep).filter((c) => !hide.includes(c.cluster)));
	const readings = $derived(readingsOf(ep));
</script>

{#if controls.length || readings.length}
	<div class="grid min-w-0 gap-4">
		{#each controls as { cluster, component: Control } (cluster)}
			<Control {node} {ep} {disabled} {run} />
		{/each}

		{#if readings.length}
			<div class="grid grid-cols-2 gap-2">
				{#each readings as r (r.cluster)}
					<ReadingTile {node} {ep} reading={r} />
				{/each}
			</div>
		{/if}
	</div>
{/if}
