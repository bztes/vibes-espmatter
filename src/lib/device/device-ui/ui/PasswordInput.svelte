<!-- Password input with a show/hide toggle; with `label` it gets the label text above it, like Input. -->
<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';
	import { control } from './control.ts';
	import Field from './Field.svelte';

	let {
		value = $bindable(),
		label,
		class: className,
		...rest
	}: Omit<HTMLInputAttributes, 'type'> & { label?: string } = $props();

	let reveal = $state(false);
</script>

<Field {label}>
	<span class="relative block">
		<!-- `type` after the spread: form helpers pass `type="password"` too. -->
		<input
			class={[control, 'pr-[52px]', className]}
			bind:value
			{...rest}
			type={reveal ? 'text' : 'password'}
		/>
		<button
			type="button"
			class="absolute inset-y-0 right-1 flex cursor-pointer items-center border-0 bg-transparent px-1.5 py-0 text-xs text-muted"
			aria-label={reveal ? 'Hide password' : 'Show password'}
			onclick={() => (reveal = !reveal)}>{reveal ? 'hide' : 'show'}</button
		>
	</span>
</Field>
