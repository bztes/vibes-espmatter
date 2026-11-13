<!-- Chart icon on a device's card (spot `device-icons`): its history in a dialog. Hidden without one. -->
<script lang="ts">
	import ChartLine from '@lucide/svelte/icons/chart-line';
	import { Button, Dialog, type DeviceContext } from '#sdk/device-ui';
	import HistoryView from './HistoryView.svelte';
	import { catalog, loadCatalog } from './catalog.svelte';

	let { node, own, name }: DeviceContext = $props();

	$effect(() => void loadCatalog());

	const device = $derived(
		catalog.current?.devices.find((d) => (own ? d.own : Number(d.node) === node))
	);

	let open = $state(false);
</script>

{#if device?.series.length}
	<Button
		variant="ghost"
		size="icon"
		class="size-7 shrink-0 text-muted hover:text-fg"
		title="History of {name}"
		aria-label="History of {name}"
		onclick={() => (open = true)}
	>
		<ChartLine size={16} />
	</Button>
	<Dialog bind:open title={name} wide>
		<HistoryView device={device.id} />
	</Dialog>
{/if}
