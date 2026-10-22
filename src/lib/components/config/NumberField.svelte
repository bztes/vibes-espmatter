<script lang="ts">
	import { Input } from '#lib/device/device-ui/ui/index.ts';
	import Field from './Field.svelte';

	let {
		value = $bindable(),
		label,
		help,
		error,
		min,
		max,
		step = 1
	}: {
		value: number;
		label: string;
		help?: string;
		error?: string;
		min?: number;
		max?: number;
		step?: number;
	} = $props();
</script>

<Field {label} {help} {error}>
	{#snippet children({ id, invalid })}
		<Input {id} type="number" {min} {max} {step} aria-invalid={invalid} bind:value />
	{/snippet}
</Field>
