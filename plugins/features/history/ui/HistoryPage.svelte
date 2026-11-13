<!-- The history page: pick a device, a value and a time range – one toolbar above the chart. -->
<script lang="ts">
	import { Select, Stored } from '#sdk/device-ui';
	import HistoryView from './HistoryView.svelte';
	import { catalog, loadCatalog } from './catalog.svelte';

	$effect(() => void loadCatalog());

	const chosen = new Stored('espm.history.device');

	// This device first, then the paired ones by name.
	const devices = $derived(
		[...(catalog.current?.devices ?? [])].sort(
			(a, b) => Number(b.own) - Number(a.own) || a.name.localeCompare(b.name)
		)
	);
	// A device that no longer has a history falls back to the first one.
	const device = $derived(devices.find((d) => d.id === chosen.value) ?? devices[0]);
	const groups = $derived([
		{
			label: '',
			options: devices.map((d) => ({
				value: d.id,
				label: d.name,
				meta: [
					...(d.own ? ['this device'] : []),
					`${d.series.length} ${d.series.length === 1 ? 'value' : 'values'}`
				]
			}))
		}
	]);
</script>

<!-- The chosen value stays when the other device has it too. -->
<HistoryView device={device?.id}>
	{#snippet picker()}
		<Select
			bind:value={() => device?.id, (v) => (chosen.value = v ?? '')}
			{groups}
			aria-label="Device"
			class="w-full sm:w-60"
		/>
	{/snippet}
</HistoryView>
