<!-- A radio button; radios sharing `group` (bindable) and `name` form one choice. -->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLInputAttributes } from 'svelte/elements';
	import { check } from './Checkbox.svelte';

	let {
		group = $bindable(),
		value,
		label,
		class: className,
		children,
		...rest
	}: Omit<HTMLInputAttributes, 'type' | 'value'> & {
		group?: unknown;
		value: unknown;
		label?: string;
		children?: Snippet;
	} = $props();
	const s = check();
</script>

{#snippet radio(cls: string)}
	<input
		type="radio"
		class={cls}
		checked={group === value}
		onchange={() => (group = value)}
		{...rest}
	/>
{/snippet}

{#if label || children}
	<label class={s.root({ class: className as string })}>
		{@render radio(s.box())}{label}{@render children?.()}
	</label>
{:else}
	{@render radio(s.box({ class: className as string }))}
{/if}
