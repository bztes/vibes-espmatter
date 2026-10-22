<!-- A card; with `title` it gets a heading (and `badge` next to it). -->
<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		title,
		badge,
		flush = false,
		class: className = '',
		children
	}: {
		title?: string;
		badge?: Snippet;
		/** Without padding: the caller pads the content. */
		flush?: boolean;
		class?: string;
		children: Snippet;
	} = $props();
</script>

<section class={['min-w-0 rounded-xl border bg-card', !flush && 'p-4', className]}>
	{#if title}<h2 class="mt-0 mb-3 flex items-center justify-between text-md">
			{title}
			{@render badge?.()}
		</h2>{/if}
	{@render children()}
</section>
