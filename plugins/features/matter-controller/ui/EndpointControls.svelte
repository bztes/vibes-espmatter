<!-- The controls of one endpoint: one per cluster it serves (see clusters/index.ts). -->
<script lang="ts">
	import { Stat } from '#sdk/device-ui';
	import { controlsOf, readingsOf, type ClusterProps } from './clusters';

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
					<div class="min-w-0 rounded-xl bg-surface-2 px-3 py-2">
						<Stat label={r.label(ep)} value={r.value(ep)} unit={r.unit} tone={r.tone?.(ep)} />
					</div>
				{/each}
			</div>
		{/if}
	</div>
{/if}
