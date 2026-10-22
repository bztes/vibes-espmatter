<script lang="ts">
	import Info from '@lucide/svelte/icons/info';
	import { boardGpios } from '#lib/device/pins.ts';
	import {
		Checkbox,
		Input,
		PasswordInput,
		Select,
		Switch
	} from '#lib/device/device-ui/ui/index.ts';
	import type { BoardDef, FieldDef } from '#lib/device/types.ts';

	let {
		field,
		value = $bindable(),
		board,
		id,
		error,
		variant = 'stacked'
	}: {
		field: FieldDef;
		value: string | number | boolean;
		board: BoardDef;
		id: string;
		error?: string;
		/** `switch`: a boolean as an on/off switch without its label (a box title says it). */
		variant?: 'stacked' | 'switch';
	} = $props();

	const gpios = $derived(field.type === 'gpio' ? boardGpios(board) : []);
</script>

<!-- The help text is a tooltip: the cards stay short. -->
{#snippet help()}
	{#if field.help}<span class="inline-flex cursor-help text-muted" title={field.help}
			><Info size={13} /></span
		>{/if}
{/snippet}

{#if field.type === 'boolean' && variant === 'switch'}
	<div class="flex items-center gap-1.5">
		<Switch
			{id}
			aria-label={field.label}
			title={field.help ?? field.label}
			checked={Boolean(value)}
			onchange={(e) => (value = e.currentTarget.checked)}
		/>
	</div>
{:else if field.type === 'boolean'}
	<div class="flex items-center gap-1.5">
		<Checkbox {id} checked={Boolean(value)} onchange={(e) => (value = e.currentTarget.checked)}
			>{field.label}</Checkbox
		>
		{@render help()}
	</div>
{:else}
	{@const invalid = error ? ('true' as const) : undefined}
	<div>
		<div class="mb-0.5 flex items-center gap-1.5">
			<label for={id}>{field.label}</label>
			{@render help()}
		</div>
		{#if field.type === 'string' && field.secret}
			<PasswordInput
				{id}
				maxlength={field.maxLength}
				placeholder={field.placeholder}
				autocomplete="new-password"
				aria-invalid={invalid}
				value={String(value ?? '')}
				oninput={(e) => (value = e.currentTarget.value)}
			/>
		{:else if field.type === 'string'}
			<Input
				{id}
				maxlength={field.maxLength}
				placeholder={field.placeholder}
				autocomplete="off"
				aria-invalid={invalid}
				value={String(value ?? '')}
				oninput={(e) => (value = e.currentTarget.value)}
			/>
		{:else if field.type === 'number'}
			<Input
				{id}
				type="number"
				min={field.min}
				max={field.max}
				step={field.step ?? 1}
				aria-invalid={invalid}
				value={Number(value)}
				oninput={(e) => (value = e.currentTarget.valueAsNumber)}
			/>
		{:else if field.type === 'select'}
			<Select
				{id}
				value={String(value)}
				onchange={(e) => (value = e.currentTarget.value)}
				aria-invalid={invalid}
			>
				{#each field.options as option (option.value)}
					<option value={option.value}>{option.label}</option>
				{/each}
			</Select>
		{:else if field.type === 'gpio'}
			<Select
				{id}
				value={String(value)}
				onchange={(e) => (value = Number(e.currentTarget.value))}
				aria-invalid={invalid}
			>
				{#if field.optional}<option value="-1">Not connected</option>{/if}
				{#if !gpios.some((p) => p.gpio === Number(value)) && Number(value) >= 0}
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
		{/if}
		{#if error}<p class="mt-1 mb-0 text-xs text-err">{error}</p>{/if}
	</div>
{/if}
