<!--
	A button that opens a small dropdown of actions. Closes on pick, outside click, Escape and
	scrolling. Positioned `fixed`, so it isn't clipped by scrolling containers like table wrappers.
-->
<script lang="ts" module>
	import type { Component, Snippet } from 'svelte';

	export interface MenuItem {
		label: string;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		icon?: Component<any>;
		onclick: () => void;
		danger?: boolean;
		disabled?: boolean;
	}
</script>

<script lang="ts">
	import Button from './ui/Button.svelte';

	let {
		items,
		label,
		trigger,
		variant,
		icon = false
	}: {
		items: MenuItem[];
		/** Accessible name of the trigger button. */
		label: string;
		trigger: Snippet;
		/** Of the trigger button. */
		variant?: 'default' | 'ghost';
		/** Icon-only trigger. */
		icon?: boolean;
	} = $props();

	let open = $state(false);
	let root = $state<HTMLElement>();
	let pos = $state({ top: 0, right: 0 });

	function toggle() {
		if (!open && root) {
			const r = root.getBoundingClientRect();
			pos = { top: r.bottom + 4, right: window.innerWidth - r.right };
		}
		open = !open;
	}

	function pick(item: MenuItem) {
		open = false;
		item.onclick();
	}
</script>

<svelte:window
	onclick={(e) => open && !root?.contains(e.target as Node) && (open = false)}
	onkeydown={(e) => e.key === 'Escape' && (open = false)}
	onresize={() => (open = false)}
	onscrollcapture={() => (open = false)}
/>

<div class="relative inline-flex" bind:this={root}>
	<Button
		{variant}
		{icon}
		aria-label={label}
		aria-haspopup="menu"
		aria-expanded={open}
		onclick={toggle}>{@render trigger()}</Button
	>
	{#if open}
		<div
			class="fixed z-20 grid min-w-[180px] rounded-[10px] border bg-card p-1 shadow-[0_8px_24px_rgb(0_0_0/0.15)]"
			role="menu"
			style:top="{pos.top}px"
			style:right="{pos.right}px"
		>
			{#each items as item (item.label)}
				<button
					role="menuitem"
					class={[
						'flex cursor-pointer items-center gap-2 rounded-lg border-0 bg-transparent px-2.5 py-[7px] text-left whitespace-nowrap hover:not-disabled:bg-bg disabled:cursor-default disabled:opacity-50',
						item.danger && 'text-err'
					]}
					disabled={item.disabled}
					onclick={() => pick(item)}
				>
					{#if item.icon}<item.icon size={16} />{/if}
					{item.label}
				</button>
			{/each}
		</div>
	{/if}
</div>
