<!-- One value large, for a popup: the time range and current value, the chart with every bucket, its stats and a link to the device's history below. -->
<script lang="ts">
	import ChartLine from '@lucide/svelte/icons/chart-line';
	import { Notice, Spinner, Stat } from '#sdk/device-ui';
	import Chart from './Chart.svelte';
	import RangePicker from './RangePicker.svelte';
	import { catalog, loadCatalog } from './catalog.svelte';
	import { stats, valueText } from './kinds';
	import { Loaded } from './load.svelte';
	import { Range } from './range.svelte';
	import type { View } from './ranges';
	import { parse, seriesKey } from './sources';

	let {
		device: id,
		value,
		view: start,
		pageLink = false
	}: {
		/** Device id from the catalog. */
		device: string;
		/** Series key (`metric|labels`). */
		value: string;
		/** Range to start with; else the remembered preset. */
		view?: View;
		/** A link to the history page of the device. */
		pageLink?: boolean;
	} = $props();

	$effect(() => void loadCatalog());

	// svelte-ignore state_referenced_locally
	const range = new Range(start);
	const source = $derived(catalog.current?.source);
	const series = $derived(
		catalog.current?.devices.find((d) => d.id === id)?.series.find((s) => seriesKey(s) === value)
	);

	const load = new Loaded(() =>
		series && source
			? {
					path: `/api/v1/history?${new URLSearchParams({ device: id, metric: series.metric, labels: series.labels })}`,
					view: range.view,
					parse: (raw: unknown) => parse(source, raw)
				}
			: undefined
	);
	const points = $derived(load.data ?? []);
	const all = $derived(series ? stats(series, points, load.shown.from, load.shown.to) : []);
</script>

{#if catalog.error && !catalog.current}
	<Notice tone="err">{catalog.error}</Notice>
{:else if catalog.current === undefined}
	<div class="flex justify-center py-10"><Spinner /></div>
{:else if !series}
	<Notice>This value has no history.</Notice>
{:else}
	<div class="mb-4 flex items-center gap-3">
		<RangePicker view={range.view} onchange={range.set} />
		<span class="ml-auto truncate text-xl font-semibold tracking-tight tabular-nums" title="Now"
			>{valueText(series, series.value)}</span
		>
	</div>

	{#if load.error}
		<Notice tone="err">{load.error}</Notice>
	{:else if !load.data}
		<div class="flex h-90 items-center justify-center"><Spinner /></div>
	{:else if !points.length}
		<Notice>
			No values in this time range. Check that the collector writes to this database and that the
			device is exported.
		</Notice>
	{:else}
		<div class={['h-90 transition-opacity', load.loading && 'opacity-50']}>
			<Chart {points} {series} from={load.shown.from} to={load.shown.to} onzoom={range.zoom} />
		</div>
	{/if}

	{#if all.length}
		<div
			class="mt-4 grid auto-cols-fr grid-flow-col divide-x divide-border border-t border-border pt-4 *:min-w-0 *:px-2 *:text-center"
		>
			{#each all as s (s.label)}
				<Stat label={s.label} value={s.value} size="sm" />
			{/each}
		</div>
	{/if}

	{#if pageLink}
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- a hash route of the device web interface -->
		<a
			href="#/history?{new URLSearchParams({ device: id })}"
			class="mx-auto mt-4 flex w-fit items-center gap-1.5 text-sm text-accent no-underline hover:underline"
			><ChartLine size={15} class="shrink-0" />All values of this device</a
		>
	{/if}
{/if}
