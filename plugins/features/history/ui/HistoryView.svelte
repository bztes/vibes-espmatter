<!-- History of a device: value picker, stats that fit the kind of value, and the chart. -->
<script lang="ts">
	import Gauge from '@lucide/svelte/icons/gauge';
	import type { Snippet } from 'svelte';
	import {
		Notice,
		Select,
		Spinner,
		Stat,
		Stored,
		api,
		errorText,
		formatDuration,
		cardHeader
	} from '#sdk/device-ui';
	import Chart from './Chart.svelte';
	import RangePicker from './RangePicker.svelte';
	import { increase, span, timeInStates, valueText } from './kinds';
	import { catalog, loadCatalog } from './catalog.svelte';
	import {
		format,
		isDiagnostic,
		metricLabel,
		parse,
		seriesKey,
		type Point,
		type Series
	} from './sources';
	import { isPreset, presetView, viewLabel, type View } from './ranges';

	let {
		device: id,
		picker
	}: {
		/** Device id from the catalog; none: "no values". */
		device?: string;
		/** More controls at the start of the toolbar, e.g. a device picker. */
		picker?: Snippet;
	} = $props();

	$effect(() => {
		void loadCatalog();
		const timer = setInterval(() => void loadCatalog(), 60000);
		return () => clearInterval(timer);
	});

	// The picked value, remembered per device.
	const chosen = $derived(new Stored(`espm.history.value.${id ?? ''}`));
	// Presets are remembered; a stepped, zoomed or custom range only for this visit.
	const preset = new Stored('espm.history.range', 'today', isPreset);
	let view = $state<View>(presetView(preset.value));
	function setView(v: View) {
		if (v.preset) preset.value = v.preset;
		view = v;
	}

	const device = $derived(catalog.current?.devices.find((d) => d.id === id));
	// The card's header shows the device, the selection and the controls.
	cardHeader({ title, actions });
	// A value that no longer exists falls back to the first one (not a diagnostic).
	const series = $derived(
		device?.series.find((s) => seriesKey(s) === chosen.value) ??
			device?.series.find((s) => !isDiagnostic(s)) ??
			device?.series[0]
	);

	// The endpoint only where a value is there twice.
	const label = $derived.by(() => {
		const count: Record<string, number> = {};
		for (const s of device?.series ?? []) count[s.metric] = (count[s.metric] ?? 0) + 1;
		return (s: Series) => {
			const ep = /(?:^|,)endpoint=(\d+)/.exec(s.labels)?.[1];
			return metricLabel(s.metric) + (ep && count[s.metric] > 1 ? ` (endpoint ${ep})` : '');
		};
	});

	const seriesGroups = $derived.by(() => {
		const all = device?.series ?? [];
		// The current reading as a badge in the list.
		const option = (s: Series) => ({
			value: seriesKey(s),
			label: label(s),
			meta: [valueText(s, s.value)]
		});
		return [
			{ label: '', options: all.filter((s) => !isDiagnostic(s)).map(option) },
			{ label: 'Diagnostics', options: all.filter(isDiagnostic).map(option) }
		].filter((g) => g.options.length);
	});

	let loaded = $state<Point[]>([]);
	// What `loaded` was asked for: another value shows nothing until its own points arrive.
	let shown = $state({ from: 0, to: 1, wanted: '' });
	let loading = $state(false);
	let error = $state<string>();

	// A string, so a catalog refresh with the same choice doesn't reload.
	const wanted = $derived(
		device && series
			? String(
					new URLSearchParams({
						device: device.id,
						metric: series.metric,
						labels: series.labels
					})
				)
			: undefined
	);

	// Reloaded on every change; an older answer arriving late is dropped.
	let request = 0;
	$effect(() => {
		const source = catalog.current?.source;
		const query = wanted;
		if (!source || !query) return;
		// A preset reaches up to now again on every load.
		const { from, to } = view.preset ? presetView(view.preset) : view;
		const mine = ++request;
		loading = true;
		api(`/api/v1/history?${query}&from=${from}&to=${to}`)
			.then((raw) => {
				if (mine !== request) return;
				loaded = parse(source, raw);
				shown = { from, to, wanted: query };
				error = undefined;
			})
			.catch((e) => {
				if (mine !== request) return;
				loaded = [];
				error = errorText(e);
			})
			.finally(() => {
				if (mine === request) loading = false;
			});
	});

	const points = $derived(shown.wanted === wanted ? loaded : []);

	// Besides "now": what makes sense for the kind of value.
	const stats = $derived.by((): { label: string; value?: string }[] => {
		if (!series) return [];
		const has = points.length > 0;
		const { from, to } = shown;
		const show = (v: number, ok = true) => (has && ok ? format(v, series.unit) : undefined);
		if (series.kind === 'counter') {
			const inc = increase(points);
			const days = span(points, from, to) / 86400;
			return [
				{ label: 'Increase', value: show(inc) },
				{ label: 'Per day', value: show(inc / days, days > 0) }
			];
		}
		if (series.kind === 'state') {
			const states = timeInStates(points, from, to);
			const total = states.reduce((a, s) => a + s.seconds, 0);
			return states.slice(0, 3).map(({ value, seconds }) => ({
				label: valueText(series, value),
				value: `${formatDuration(seconds)} · ${Math.round((seconds / total) * 100)} %`
			}));
		}
		let min = Infinity;
		let max = -Infinity;
		let sum = 0;
		for (const p of points) {
			min = Math.min(min, p.min);
			max = Math.max(max, p.max);
			sum += p.avg;
		}
		return [
			{ label: 'Minimum', value: show(min) },
			{ label: 'Average', value: show(sum / points.length) },
			{ label: 'Maximum', value: show(max) }
		];
	});
</script>

{#snippet selection()}
	{@const text = `${series ? label(series) : '–'} · ${viewLabel(view)}`}
	<span class="block truncate text-xs text-muted" title={text}>{text}</span>
{/snippet}

<!-- Two rows, cut off where too long. -->
{#snippet title()}
	{#if device}
		<span class="block leading-tight">
			<span class="block truncate text-sm font-semibold" title={device.name}>{device.name}</span>
			{@render selection()}
		</span>
	{/if}
{/snippet}

{#snippet actions()}
	{#if device}
		<div class="flex shrink-0 items-center gap-1">
			{@render picker?.()}
			<Select
				bind:value={() => series && seriesKey(series), (v) => (chosen.value = v ?? '')}
				groups={seriesGroups}
				aria-label="Value"
				title="Value"
			>
				{#snippet icon()}<Gauge size={16} />{/snippet}
			</Select>
			<RangePicker {view} onchange={setView} />
		</div>
	{/if}
{/snippet}

{#if catalog.error && !catalog.current}
	<Notice tone="err">{catalog.error}</Notice>
{:else if catalog.current === undefined}
	<div class="flex justify-center py-10"><Spinner /></div>
{:else if !device}
	<Notice>No values to show yet.</Notice>
{:else}
	{#if series}
		<div class="mb-3 flex flex-wrap gap-x-4 gap-y-2 *:flex-auto *:whitespace-nowrap sm:gap-x-6">
			<Stat label="Now" value={valueText(series, series.value)} size="sm" />
			{#each stats as s (s.label)}
				<Stat label={s.label} value={s.value} size="sm" />
			{/each}
		</div>
	{/if}

	{#if error}
		<Notice tone="err">{error}</Notice>
	{:else if loading && !points.length}
		<div class="flex h-60 items-center justify-center"><Spinner /></div>
	{:else if !points.length}
		<Notice>
			No values in this time range. Check that the collector writes to this database and that the
			device is exported.
		</Notice>
	{:else if series}
		<div class={['transition-opacity', loading && 'opacity-50']}>
			<Chart
				{points}
				{series}
				from={shown.from}
				to={shown.to}
				onzoom={(from, to) => setView({ from, to })}
			/>
		</div>
	{/if}
{/if}
