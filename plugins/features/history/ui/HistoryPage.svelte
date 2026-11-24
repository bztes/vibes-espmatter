<!-- The history page: the device's name opens the list of devices; `?device=` picks one. -->
<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import { Badge, MenuItem, Stored, TitleMenu, route } from '#sdk/device-ui';
	import HistoryView from './HistoryView.svelte';
	import { catalog, loadCatalog } from './catalog.svelte';

	$effect(() => void loadCatalog());

	const chosen = new Stored('espm.history.device');
	// `#/history?device=<id>` (from a value's popup) picks the device.
	const linked = route.query.get('device');
	if (linked) {
		chosen.value = linked;
		route.clearQuery();
	}

	// This device first, then the paired ones by name.
	const devices = $derived(
		[...(catalog.current?.devices ?? [])].sort(
			(a, b) => Number(b.own) - Number(a.own) || a.name.localeCompare(b.name)
		)
	);
	// A device that no longer has a history falls back to the first one.
	const device = $derived(devices.find((d) => d.id === chosen.value) ?? devices[0]);
</script>

{#snippet picker(name: string)}
	<TitleMenu label={name} title="Device" class="-ml-2.5" menuClass="w-72">
		{#each devices as d (d.id)}
			{@const here = d === device}
			<MenuItem current={here} onclick={() => (chosen.value = d.id)}>
				<span class="min-w-0 flex-1 truncate">{d.name}</span>
				{#if d.own}<Badge class="px-1.5 py-px text-[11px] font-normal">this device</Badge>{/if}
				<span class="shrink-0 text-xs text-muted"
					>{d.series.length} {d.series.length === 1 ? 'value' : 'values'}</span
				>
				{#if here}<Check size={14} class="shrink-0" />{/if}
			</MenuItem>
		{/each}
	</TitleMenu>
{/snippet}

<HistoryView device={device?.id} title={devices.length > 1 ? picker : undefined} />
