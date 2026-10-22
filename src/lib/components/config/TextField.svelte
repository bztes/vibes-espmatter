<script lang="ts">
	import { Input, PasswordInput } from '#lib/device/device-ui/ui/index.ts';
	import Field from './Field.svelte';

	let {
		value = $bindable(),
		label,
		help,
		error,
		maxlength,
		placeholder,
		secret = false
	}: {
		value: string;
		label: string;
		help?: string;
		error?: string;
		maxlength?: number;
		placeholder?: string;
		/** A password or token: hidden, not autofilled. */
		secret?: boolean;
	} = $props();
</script>

<Field {label} {help} {error}>
	{#snippet children({ id, invalid })}
		{#if secret}
			<PasswordInput
				{id}
				{maxlength}
				{placeholder}
				autocomplete="new-password"
				aria-invalid={invalid}
				bind:value
			/>
		{:else}
			<Input {id} {maxlength} {placeholder} autocomplete="off" aria-invalid={invalid} bind:value />
		{/if}
	{/snippet}
</Field>
