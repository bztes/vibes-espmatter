<!-- Color Control cluster (0x0300): color temperature slider (tunable white). -->
<script lang="ts">
	import Range from './Range.svelte';
	import { ACTIONS, send } from '../actions';
	import type { ClusterProps } from './types';

	let { node, ep, disabled = false, run }: ClusterProps = $props();

	// Matter speaks mireds (1,000,000 / K); people speak Kelvin. Fewer mireds = cooler.
	const kelvin = (mireds: number) => Math.round(1e6 / mireds / 100) * 100;
	const minK = $derived(kelvin(ep.colorTempMax || 500));
	const maxK = $derived(kelvin(ep.colorTempMin || 153));
	const value = $derived(ep.colorTemperature ? kelvin(ep.colorTemperature) : minK);

	const setKelvin = (k: number) => run(() => send(node, ep.id, ACTIONS.colorTemperature.op(k)));
</script>

<!-- Only for lights that report a color temperature (hue/saturation-only lights don't). -->
{#if ep.colorTemperature !== undefined}
	<Range
		label="Warmth"
		format={(k) => `${k} K`}
		track="linear-gradient(to right, oklch(0.8 0.12 65), oklch(0.97 0.01 90), oklch(0.85 0.06 240))"
		min={minK}
		max={maxK}
		step={100}
		{value}
		{disabled}
		onchange={setKelvin}
	/>
{/if}
