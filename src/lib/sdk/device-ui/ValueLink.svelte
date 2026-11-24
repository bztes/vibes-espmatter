<!-- A value on a card: links to what a plugin opens for it (`out.valueTarget()`), else just shows it. -->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { ClassValue } from 'svelte/elements';
	import { valueTarget, type ValueRef } from './values.svelte';

	let {
		ref,
		class: className,
		children
	}: { ref: ValueRef; class?: ClassValue; children: Snippet } = $props();

	const target = $derived(valueTarget(ref));
</script>

{#if target}
	<!-- eslint-disable svelte/no-navigation-without-resolve -- a hash route of the device web interface -->
	<a
		href={target.href}
		title={target.title}
		class={[
			'text-inherit no-underline transition-colors hover:bg-border/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
			className
		]}>{@render children()}</a
	>
	<!-- eslint-enable svelte/no-navigation-without-resolve -->
{:else}
	<div class={className}>{@render children()}</div>
{/if}
