<script lang="ts">
	import { tv } from 'tailwind-variants';

	let {
		value = $bindable(),
		options,
		label,
		disabled = false,
		onchange
	}: {
		value?: string;
		options: { value: string; label: string }[];
		label: string;
		disabled?: boolean;
		onchange?: (value: string) => void;
	} = $props();

	const item = tv({
		base: 'min-w-fit flex-1 rounded-md px-2.5 py-1 text-sm whitespace-nowrap font-medium transition-colors disabled:opacity-50',
		variants: {
			active: { true: 'bg-surface text-fg shadow-card', false: 'text-muted hover:text-fg' }
		}
	});
</script>

<div
	role="radiogroup"
	aria-label={label}
	class="flex flex-wrap gap-0.5 rounded-lg bg-surface-2 p-0.5"
>
	{#each options as option (option.value)}
		<button
			type="button"
			role="radio"
			aria-checked={value === option.value}
			{disabled}
			class={item({ active: value === option.value })}
			onclick={() => {
				value = option.value;
				onchange?.(option.value);
			}}>{option.label}</button
		>
	{/each}
</div>
