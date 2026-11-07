<!--
  Dashboard slider: a thick rounded track filled up to the value, the value shown while dragging.
  `track` replaces the fill with a background of its own (e.g. warm → cool for color temperature).
-->
<script lang="ts">
	let {
		value,
		min = 0,
		max = 100,
		step = 1,
		label,
		format = (v: number) => String(v),
		track,
		disabled = false,
		onchange
	}: {
		value: number;
		min?: number;
		max?: number;
		step?: number;
		label: string;
		format?: (v: number) => string;
		track?: string;
		disabled?: boolean;
		onchange: (value: number) => void;
	} = $props();

	// Follows the device, but moves with the thumb while dragging.
	let current = $derived(value);
	const percent = $derived(max > min ? ((current - min) / (max - min)) * 100 : 0);
</script>

<label class="grid gap-1.5 text-sm">
	<span class="flex items-baseline justify-between gap-2">
		<span class="min-w-0 truncate text-muted">{label}</span>
		<span class="shrink-0 font-medium tabular-nums">{format(current)}</span>
	</span>
	<input
		type="range"
		class="range"
		style:--p="{percent}%"
		style:--track={track}
		{min}
		{max}
		{step}
		{disabled}
		aria-valuetext={format(current)}
		bind:value={current}
		onchange={() => onchange(current)}
	/>
</label>

<style>
	.range {
		appearance: none;
		width: 100%;
		height: 0.625rem;
		border-radius: 999px;
		background: var(
			--track,
			linear-gradient(to right, var(--color-accent) var(--p), var(--color-border) var(--p))
		);
		cursor: pointer;
		outline: none;
	}
	.range:disabled {
		cursor: default;
		opacity: 0.5;
	}
	.range:focus-visible {
		outline: 2px solid var(--color-accent);
		outline-offset: 4px;
	}
	.range::-webkit-slider-thumb {
		appearance: none;
		width: 1.375rem;
		height: 1.375rem;
		border-radius: 999px;
		background: white;
		border: 1px solid var(--color-border-strong);
		box-shadow: 0 1px 3px oklch(0 0 0 / 0.2);
		transition: transform 0.1s;
	}
	.range:active::-webkit-slider-thumb {
		transform: scale(1.1);
	}
	.range::-moz-range-thumb {
		width: 1.375rem;
		height: 1.375rem;
		border-radius: 999px;
		background: white;
		border: 1px solid var(--color-border-strong);
		box-shadow: 0 1px 3px oklch(0 0 0 / 0.2);
	}
</style>
