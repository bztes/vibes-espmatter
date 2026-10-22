<!--
	Range input with its own track and knob, so it looks the same in every browser and the knob is
	never clipped (the input is as tall as the knob). `tone="ct"` draws a warm-to-cold track for color
	temperature in kelvin (low = warm).
-->
<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';

	let {
		value = $bindable(),
		tone = 'default',
		min = 0,
		max = 100,
		class: className = '',
		...rest
	}: Omit<HTMLInputAttributes, 'type' | 'value'> & {
		value?: number;
		tone?: 'default' | 'ct';
	} = $props();

	/** How much of the track is filled (default tone). */
	const fill = $derived.by(() => {
		const [lo, hi] = [Number(min), Number(max)];
		return hi > lo ? `${(((value ?? lo) - lo) / (hi - lo)) * 100}%` : '0%';
	});
</script>

<input
	type="range"
	bind:value
	{min}
	{max}
	class={[
		'm-0 block h-5 w-full cursor-pointer appearance-none border-0 bg-transparent p-0 focus-visible:rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-default disabled:opacity-50',
		tone === 'ct' && 'ct',
		className
	]}
	style:--fill={fill}
	{...rest}
/>

<style>
	/* The track and knob (vendor pseudo-elements). */
	input {
		--knob: var(--color-accent);
		--track:
			linear-gradient(var(--color-accent), var(--color-accent)) 0 / var(--fill) 100% no-repeat,
			var(--color-border);
	}
	.ct {
		--knob: #f4b860;
		--track: linear-gradient(to right, #ffb35a, #fff4e6, #cfe3ff);
	}
	input::-webkit-slider-runnable-track {
		height: 6px;
		border-radius: 999px;
		background: var(--track);
	}
	input::-moz-range-track {
		height: 6px;
		border-radius: 999px;
		background: var(--track);
	}
	input::-webkit-slider-thumb {
		appearance: none;
		box-sizing: border-box;
		width: 18px;
		height: 18px;
		margin-top: -6px; /* centered on the 6px track */
		border: 2px solid var(--knob);
		border-radius: 50%;
		background: #fff;
		box-shadow: 0 1px 2px rgb(0 0 0 / 0.25);
	}
	input::-moz-range-thumb {
		box-sizing: border-box;
		width: 18px;
		height: 18px;
		border: 2px solid var(--knob);
		border-radius: 50%;
		background: #fff;
		box-shadow: 0 1px 2px rgb(0 0 0 / 0.25);
	}
</style>
