<!-- The history page: the device's name opens the list of devices; `?device=` picks one. -->
<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import { Badge, Popover, Stored, route } from '#sdk/device-ui';
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

	let open = $state(false);
	let anchor = $state<HTMLElement>();

	function pick(id: string) {
		chosen.value = id;
		open = false;
	}
</script>

{#snippet picker(name: string)}
	<div class="-ml-2 flex min-w-0" bind:this={anchor}>
		<button
			type="button"
			class={[
				'flex max-w-full cursor-pointer items-center gap-1.5 rounded-lg px-2 font-semibold text-fg hover:bg-surface-2',
				open && 'bg-surface-2'
			]}
			aria-haspopup="menu"
			aria-expanded={open}
			onclick={() => (open = !open)}
		>
			<span class="truncate">{name}</span>
			<ChevronDown size={14} class="shrink-0 text-muted" />
		</button>
	</div>
	<Popover bind:open {anchor} title="Device" class="w-72 p-1">
		<div role="menu" class="grid gap-0.5">
			{#each devices as d (d.id)}
				{@const here = d === device}
				<button
					type="button"
					role="menuitem"
					class={[
						'flex min-w-0 cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm',
						here ? 'bg-accent-soft text-accent' : 'text-fg hover:bg-surface-2'
					]}
					onclick={() => pick(d.id)}
				>
					<span class="min-w-0 flex-1 truncate">{d.name}</span>
					{#if d.own}<Badge class="px-1.5 py-px text-[11px] font-normal">this device</Badge>{/if}
					<span class="shrink-0 text-xs text-muted"
						>{d.series.length} {d.series.length === 1 ? 'value' : 'values'}</span
					>
					{#if here}<Check size={14} class="shrink-0" />{/if}
				</button>
			{/each}
		</div>
	</Popover>
{/snippet}

<HistoryView device={device?.id} title={devices.length > 1 ? picker : undefined} />
