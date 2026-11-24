<!-- History of a device: header with the time range, all its values small; one opens large in a popup. -->
<script lang="ts">
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import type { Snippet } from 'svelte';
	import { Notice, Spinner, openPopup } from '#sdk/device-ui';
	import RangePicker from './RangePicker.svelte';
	import SeriesGrid from './SeriesGrid.svelte';
	import { catalog, loadCatalog } from './catalog.svelte';
	import { Range } from './range.svelte';
	import { isDiagnostic, seriesKey, seriesLabels, type Series } from './sources';
	import { valuePopup } from './value-popup';

	let {
		device: id,
		title
	}: {
		/** Device id from the catalog; none: "no values". */
		device?: string;
		/** In place of the device name, e.g. a device picker. */
		title?: Snippet<[name: string]>;
	} = $props();

	$effect(() => {
		void loadCatalog();
		const timer = setInterval(() => void loadCatalog(), 60000);
		return () => clearInterval(timer);
	});

	const range = new Range();

	// A string: a catalog refresh doesn't reload the charts.
	const source = $derived(catalog.current?.source);
	const device = $derived(catalog.current?.devices.find((d) => d.id === id));
	const values = $derived(device?.series.filter((s) => !isDiagnostic(s)) ?? []);
	const diagnostics = $derived(device?.series.filter(isDiagnostic) ?? []);
	const label = $derived(seriesLabels(device?.series ?? []));
	// Folded away (and not loaded) unless there is nothing else.
	let showDiagnostics = $state(false);

	/** A value large, starting at the page's range. */
	function open(s: Series) {
		if (!device) return;
		const props = { device: device.id, value: seriesKey(s), view: $state.snapshot(range.view) };
		openPopup(valuePopup(device.name, label(s), props));
	}
</script>

{#if catalog.error && !catalog.current}
	<Notice tone="err">{catalog.error}</Notice>
{:else if catalog.current === undefined}
	<div class="flex justify-center py-10"><Spinner /></div>
{:else if !device || !source}
	<Notice>No values to show yet.</Notice>
{:else}
	<div class="mb-4 flex items-center gap-2">
		<div class="min-w-0 flex-1">
			{#if title}
				{@render title(device.name)}
			{:else}
				<span class="block truncate font-semibold" title={device.name}>{device.name}</span>
			{/if}
		</div>
		<RangePicker view={range.view} onchange={range.set} />
	</div>

	{@const grid = {
		device: device.id,
		label,
		source,
		view: range.view,
		onzoom: range.zoom,
		onopen: open
	}}
	{#if values.length}
		<SeriesGrid {...grid} series={values} />
	{/if}
	{#if diagnostics.length}
		{#if values.length}
			<button
				type="button"
				class="mt-6 mb-3 flex cursor-pointer items-center gap-1 text-sm font-semibold text-muted hover:text-fg"
				aria-expanded={showDiagnostics}
				onclick={() => (showDiagnostics = !showDiagnostics)}
			>
				<ChevronDown size={16} class={['transition-transform', !showDiagnostics && '-rotate-90']} />
				Diagnostics
			</button>
		{/if}
		{#if showDiagnostics || !values.length}
			<SeriesGrid {...grid} series={diagnostics} diagnostics />
		{/if}
	{/if}
{/if}
