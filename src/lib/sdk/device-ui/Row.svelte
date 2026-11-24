<script lang="ts">
	import type { Snippet } from 'svelte';
	import ValueLink from './ValueLink.svelte';
	import type { ValueSeries } from './values.svelte';

	let {
		label,
		ref,
		children
	}: {
		label: string;
		/** The value it shows: links to what plugins open for it. */
		ref?: ValueSeries;
		children: Snippet;
	} = $props();
</script>

<div
	class="flex items-baseline justify-between gap-4 border-b border-border py-1.5 text-sm last:border-0"
>
	<span class="text-muted">{label}</span>
	<span class="min-w-0 truncate text-right font-medium">
		{#if ref}
			<ValueLink ref={{ ...ref, label }} class="-mx-1 inline rounded px-1"
				>{@render children()}</ValueLink
			>
		{:else}
			{@render children()}
		{/if}
	</span>
</div>
