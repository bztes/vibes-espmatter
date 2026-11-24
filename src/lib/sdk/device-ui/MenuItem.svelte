<!-- An item of a `TitleMenu`: a link with `href`, else a button. -->
<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		href,
		current = false,
		onclick,
		children
	}: {
		href?: string;
		/** The page or thing shown now. */
		current?: boolean;
		onclick?: () => void;
		children: Snippet;
	} = $props();

	const cls = $derived([
		'flex min-w-0 cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm no-underline',
		current ? 'bg-accent-soft text-accent' : 'text-fg hover:bg-surface-2'
	]);
</script>

{#if href}
	<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- a hash route of the device web interface -->
	<a role="menuitem" {href} aria-current={current ? 'page' : undefined} class={cls} {onclick}
		>{@render children()}</a
	>
{:else}
	<button type="button" role="menuitem" class={cls} {onclick}>{@render children()}</button>
{/if}
