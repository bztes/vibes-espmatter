<!-- A value on a card: opens what a plugin has for it (`out.valueTarget()`) in the popup; else just shows it. -->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { ClassValue } from 'svelte/elements';
	import { openPopup } from './popup.svelte';
	import { valueTarget, type ValueRef } from './values.svelte';

	let {
		ref,
		class: className,
		children
	}: { ref: ValueRef; class?: ClassValue; children: Snippet } = $props();

	const target = $derived(valueTarget(ref));
</script>

{#if target}
	<button
		type="button"
		title={target.title}
		class={[
			'cursor-pointer text-left text-inherit no-underline transition-colors hover:bg-border/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
			className
		]}
		onclick={() => openPopup(target.popup)}>{@render children()}</button
	>
{:else}
	<div class={className}>{@render children()}</div>
{/if}
