<!-- A GPIO of the board, with what else the pin does. -->
<script lang="ts">
	import { boardGpios } from '#lib/device/pins.ts';
	import { Select } from '#lib/device/device-ui/ui/index.ts';
	import type { BoardDef } from '#lib/device/types.ts';
	import Field from './Field.svelte';

	let {
		value = $bindable(),
		board,
		label,
		help,
		error,
		optional = false
	}: {
		value: number;
		board: BoardDef;
		label: string;
		help?: string;
		error?: string;
		/** Offers "Not connected" (-1). */
		optional?: boolean;
	} = $props();

	const gpios = $derived(boardGpios(board));
</script>

<Field {label} {help} {error}>
	{#snippet children({ id, invalid })}
		<Select
			{id}
			value={String(value)}
			onchange={(e) => (value = Number(e.currentTarget.value))}
			aria-invalid={invalid}
		>
			{#if optional}<option value="-1">Not connected</option>{/if}
			{#if !gpios.some((p) => p.gpio === value) && value >= 0}
				<option value={String(value)}>GPIO{value} (not on this board)</option>
			{/if}
			{#each gpios as pin (pin.gpio)}
				<option value={String(pin.gpio)}>
					GPIO{pin.gpio}{pin.label !== String(pin.gpio) ? ` (${pin.label})` : ''}{pin.reserved
						? ` – ${pin.reserved}`
						: pin.functions?.length
							? ` – ${pin.functions.join(', ')}`
							: ''}
				</option>
			{/each}
		</Select>
	{/snippet}
</Field>
