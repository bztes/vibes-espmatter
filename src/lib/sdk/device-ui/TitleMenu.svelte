<!-- A title that opens a menu (`MenuItem`s), e.g. to switch the page; a click on an item closes it. -->
<script lang="ts">
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import type { Snippet } from 'svelte';
	import type { ClassValue } from 'svelte/elements';
	import Popover from './Popover.svelte';

	let {
		label,
		title,
		class: className,
		menuClass = 'w-56',
		children
	}: {
		/** Shown on the button. */
		label: string;
		/** Of the menu, e.g. "Pages". */
		title: string;
		class?: ClassValue;
		menuClass?: string;
		children: Snippet;
	} = $props();

	let open = $state(false);
	let anchor = $state<HTMLElement>();
</script>

<div class={['flex min-w-0', className]} bind:this={anchor}>
	<button
		type="button"
		class={[
			'flex h-9 max-w-full cursor-pointer items-center gap-1.5 rounded-lg px-2.5 font-semibold text-fg hover:bg-surface-2',
			open && 'bg-surface-2'
		]}
		aria-haspopup="menu"
		aria-expanded={open}
		onclick={() => (open = !open)}
	>
		<span class="truncate">{label}</span>
		<ChevronDown size={14} class="shrink-0 text-muted" />
	</button>
</div>
<Popover bind:open {anchor} {title} class={['p-1', menuClass].join(' ')}>
	<!-- Keys on an item click it too. -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div
		role="menu"
		tabindex="-1"
		class="grid gap-0.5"
		onclick={(e) => (e.target as Element).closest('[role=menuitem]') && (open = false)}
	>
		{@render children()}
	</div>
</Popover>
