<!-- Small charts of several values of a device, loaded in one request; hovering one shows the time in all. -->
<script lang="ts">
	import { Notice, Spinner } from '#sdk/device-ui';
	import Chart from './Chart.svelte';
	import { stats, valueText } from './kinds';
	import { Loaded } from './load.svelte';
	import { parse, seriesKey, type Series } from './sources';
	import type { View } from './ranges';

	/** Enough buckets for a small chart. */
	const POINTS = 120;

	let {
		device,
		series,
		diagnostics = false,
		label,
		source,
		view,
		onzoom,
		onopen
	}: {
		device: string;
		/** What is shown: the diagnostics or the other values of the device. */
		series: Series[];
		diagnostics?: boolean;
		label: (s: Series) => string;
		source: string;
		view: View;
		onzoom: (from: number, to: number) => void;
		/** A value's chart opened large. */
		onopen: (s: Series) => void;
	} = $props();

	const load = new Loaded(() => ({
		path: `/api/v1/history?${new URLSearchParams({
			device,
			points: String(POINTS),
			diagnostics: diagnostics ? '1' : '0'
		})}`,
		view,
		parse: (raw) => parse(source, raw)
	}));

	let at = $state<number>();
</script>

{#if load.error}
	<Notice tone="err">{load.error}</Notice>
{:else}
	<div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
		{#each series as s (seriesKey(s))}
			{@const key = seriesKey(s)}
			{@const points = load.data?.get(key) ?? []}
			{@const stat = stats(s, points, load.shown.from, load.shown.to).find((x) => x.main)}
			<section class="min-w-0 rounded-card border border-border bg-surface p-3 shadow-card">
				<button
					type="button"
					class="mb-2 flex w-full min-w-0 cursor-pointer items-baseline gap-2 rounded text-left hover:text-accent"
					title="Open {label(s)}"
					onclick={() => onopen(s)}
				>
					<span class="truncate text-sm font-semibold">{label(s)}</span>
					<span class="ml-auto shrink-0 font-semibold tabular-nums">{valueText(s, s.value)}</span>
				</button>
				{#if !load.data}
					<div class="flex h-40 items-center justify-center"><Spinner /></div>
				{:else if !points.length}
					<div class="flex h-40 items-center justify-center text-xs text-muted">
						No values in this time range
					</div>
				{:else}
					<div class={['h-40 transition-opacity', load.loading && 'opacity-50']}>
						<Chart {points} series={s} from={load.shown.from} to={load.shown.to} bind:at {onzoom} />
					</div>
				{/if}
				<div class="mt-2 min-h-6 truncate border-t border-border pt-2 text-xs text-muted">
					{#if stat?.value}{stat.label} {stat.value}{/if}
				</div>
			</section>
		{/each}
	</div>
{/if}
