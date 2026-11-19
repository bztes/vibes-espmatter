<!-- History of a device: value picker, stats that fit the kind of value, and the chart. -->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import {
		Notice,
		Select,
		Spinner,
		Stat,
		Stored,
		api,
		errorText,
		formatDuration
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
	import { isPreset, presetView, type View } from './ranges';

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

	let chosen = $state('');
	// Presets are remembered; a stepped, zoomed or custom range only for this visit.
	const preset = new Stored('espm.history.range', 'today', isPreset);
	let view = $state<View>(presetView(preset.value));
	function setView(v: View) {
		if (v.preset) preset.value = v.preset;
		view = v;
	}

	const device = $derived(catalog.current?.devices.find((d) => d.id === id));
	// A value that no longer exists falls back to the first one (not a diagnostic).
	const series = $derived(
		device?.series.find((s) => seriesKey(s) === chosen) ??
			device?.series.find((s) => !isDiagnostic(s)) ??
			device?.series[0]
	);

	const seriesGroups = $derived.by(() => {
		const all = device?.series ?? [];
		const count: Record<string, number> = {};
		for (const s of all) count[s.metric] = (count[s.metric] ?? 0) + 1;
		const label = (s: Series) => {
			const ep = /(?:^|,)endpoint=(\d+)/.exec(s.labels)?.[1];
			const twice = count[s.metric] > 1;
			return metricLabel(s.metric) + (ep && twice ? ` (endpoint ${ep})` : '');
		};
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

{#if catalog.error && !catalog.current}
	<Notice tone="err">{catalog.error}</Notice>
{:else if catalog.current === undefined}
	<div class="flex justify-center py-10"><Spinner /></div>
{:else if !device}
	<Notice>No values to show yet.</Notice>
{:else}
	<div class="mb-4 flex flex-wrap items-center gap-2 sm:flex-nowrap">
		{@render picker?.()}
		<Select
			bind:value={() => series && seriesKey(series), (v) => (chosen = v ?? '')}
			groups={seriesGroups}
			aria-label="Value"
			class="w-full sm:w-0 sm:max-w-60 sm:flex-1"
		/>
		<div class="w-full sm:ml-auto sm:w-auto sm:shrink-0">
			<RangePicker {view} onchange={setView} />
		</div>
	</div>

	{#if series}
		<div class="mb-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
			<Stat label="Now" value={valueText(series, series.value)} />
			{#each stats as s (s.label)}
				<Stat label={s.label} value={s.value} />
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
