<!-- A checkbox with its label text (children) next to it. -->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLInputAttributes } from 'svelte/elements';

	let {
		checked = $bindable(false),
		class: className = '',
		children,
		...rest
	}: Omit<HTMLInputAttributes, 'type' | 'children'> & { children?: Snippet } = $props();
</script>

<label class={['flex items-center gap-1.5', className]}>
	<input type="checkbox" class="m-0 accent-accent" bind:checked {...rest} />
	{@render children?.()}
</label>
