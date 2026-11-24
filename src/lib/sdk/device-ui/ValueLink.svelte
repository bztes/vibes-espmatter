<!-- A value on a card: opens what a plugin has for it (`out.valueTarget()`) in a popup; else just shows it. -->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { ClassValue } from 'svelte/elements';
	import Dialog from './Dialog.svelte';
	import { valueTarget, type ValuePopup, type ValueRef } from './values.svelte';

	let {
		ref,
		class: className,
		children
	}: { ref: ValueRef; class?: ClassValue; children: Snippet } = $props();

	const target = $derived(valueTarget(ref));
	// Kept from the click: a target that goes away meanwhile doesn't close it.
	let shown = $state<ValuePopup>();
</script>

{#if target}
	<button
		type="button"
		title={target.title}
		class={[
			'cursor-pointer text-left text-inherit no-underline transition-colors hover:bg-border/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
			className
		]}
		onclick={() => (shown = target.popup)}>{@render children()}</button
	>
{:else}
	<div class={className}>{@render children()}</div>
{/if}
{#if shown}
	<Dialog bind:open={() => true, () => (shown = undefined)} title={shown.title} wide>
		<shown.component {...shown.props} />
	</Dialog>
{/if}
