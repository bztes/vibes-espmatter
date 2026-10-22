<script lang="ts">
	import { Select } from '#lib/device/device-ui/ui/index.ts';
	import Field from './Field.svelte';

	let {
		value = $bindable(),
		label,
		help,
		error,
		options
	}: {
		value: string;
		label: string;
		help?: string;
		error?: string;
		options: readonly { value: string; label: string }[];
	} = $props();
</script>

<Field {label} {help} {error}>
	{#snippet children({ id, invalid })}
		<Select {id} aria-invalid={invalid} bind:value>
			{#each options as option (option.value)}
				<option value={option.value}>{option.label}</option>
			{/each}
		</Select>
	{/snippet}
</Field>
