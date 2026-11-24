<!-- History of a device: header with the time range, all its values small; one opens large in a popup. -->
<script lang="ts">
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import type { Snippet } from 'svelte';
	import { Dialog, Notice, Spinner } from '#sdk/device-ui';
	import RangePicker from './RangePicker.svelte';
	import SeriesGrid from './SeriesGrid.svelte';
	import ValueHistory from './ValueHistory.svelte';
	import { catalog, loadCatalog } from './catalog.svelte';
	import { Range } from './range.svelte';
	import { isDiagnostic, seriesKey, seriesLabels } from './sources';

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

	// The value shown large.
	let openKey = $state<string>();
	const open = $derived(device?.series.find((s) => seriesKey(s) === openKey));
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
		onopen: (k: string) => (openKey = k)
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

	<!-- Starts at the page's range; changed there only for the popup. -->
	<Dialog
		bind:open={() => !!open, (v) => !v && (openKey = undefined)}
		title={open ? `${device.name} · ${label(open)}` : ''}
		wide
	>
		{#if open}
			<ValueHistory device={device.id} value={seriesKey(open)} view={range.view} />
		{/if}
	</Dialog>
{/if}
