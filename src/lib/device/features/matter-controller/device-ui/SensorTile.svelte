<!-- One sensor device: temperature and humidity as it last reported them. -->
<script lang="ts">
	import { fmtAgo } from '../../web-ui/device-ui/api';
	import type { MatterNode } from './matter';

	let {
		name,
		temperature,
		humidity,
		age,
		battery
	}: {
		name: string;
		/** In 0.01 °C, as the Temperature Measurement cluster reports it. */
		temperature?: number;
		/** In 0.01 %. */
		humidity?: number;
		/** Seconds since the last report. */
		age?: number;
		battery?: MatterNode['battery'];
	} = $props();

	/** Sensors report on change: an hour without one means it is probably gone (or the battery is). */
	const STALE_S = 60 * 60;

	const fmt = (v: number, digits: number) =>
		v.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });

	const stale = $derived(age !== undefined && age > STALE_S);
	const updated = $derived.by(() => {
		if (age === undefined) return 'waiting for a report';
		return age < 60 ? 'just now' : `${fmtAgo(age)} ago`;
	});
	const lowBattery = $derived(battery?.level === 'warning' || battery?.level === 'critical');
</script>

<article class="grid content-start gap-2.5 rounded-[14px] border bg-card px-4 py-3.5">
	<div class="grid min-w-0">
		<strong class="truncate">{name}</strong>
		<span class="text-xs text-muted">
			{#if stale}<span class="text-warn">{updated}</span>{:else}{updated}{/if}
			{#if battery?.percent !== undefined}
				· <span class:text-warn={lowBattery}>battery {battery.percent} %</span>
			{:else if lowBattery}
				· <span class="text-warn">battery low</span>
			{/if}
		</span>
	</div>
	<div class="flex gap-6">
		{#if temperature !== undefined}
			<div class="grid">
				<span
					class={['text-[28px] leading-[1.1] font-semibold tabular-nums', stale && 'text-muted']}
					>{fmt(temperature / 100, 1)}<small class="ml-0.5 text-base font-medium text-muted"
						>°C</small
					></span
				>
				<span class="text-xs text-muted">Temperature</span>
			</div>
		{/if}
		{#if humidity !== undefined}
			<div class="grid">
				<span
					class={['text-[28px] leading-[1.1] font-semibold tabular-nums', stale && 'text-muted']}
					>{fmt(humidity / 100, 0)}<small class="ml-0.5 text-base font-medium text-muted">%</small
					></span
				>
				<span class="text-xs text-muted">Humidity</span>
			</div>
		{/if}
	</div>
</article>
