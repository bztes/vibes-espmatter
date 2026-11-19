<!--
  A panel next to an `anchor` element, on the side with room (preferred `placement` first), above
  everything (top layer). Centered with a backdrop when no side fits; a `Dialog` on phones.
  Closes on a click outside or Escape. Content is only rendered while open.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { MediaQuery } from 'svelte/reactivity';
	import Dialog from './Dialog.svelte';

	type Side = 'bottom' | 'top' | 'left' | 'right';
	type Align = 'start' | 'end';

	let {
		open = $bindable(false),
		anchor,
		title,
		placement = 'bottom-start',
		class: className = '',
		children
	}: {
		open?: boolean;
		anchor: HTMLElement | undefined;
		/** Heading of the phone dialog, label of the panel. */
		title: string;
		placement?: `${Side}-${Align}`;
		class?: string;
		children: Snippet;
	} = $props();

	const GAP = 4;
	const MARGIN = 8;
	const OPPOSITE: Record<Side, Side> = {
		bottom: 'top',
		top: 'bottom',
		left: 'right',
		right: 'left'
	};

	const narrow = new MediaQuery('max-width: 639px');
	let el = $state<HTMLElement>();
	let pos = $state<{ left: number; top: number }>();
	let centered = $state(false);

	/** Where the panel goes: first side with room, aligned as asked if that fits, else kept on screen. */
	function place() {
		if (!el || !anchor) return;
		const a = anchor.getBoundingClientRect();
		const w = el.offsetWidth;
		const h = el.offsetHeight;
		const vw = document.documentElement.clientWidth;
		const vh = window.innerHeight;
		const [side, align] = placement.split('-') as [Side, Align];
		const vertical = side === 'top' || side === 'bottom';
		const cross: Side[] = vertical ? ['right', 'left'] : ['bottom', 'top'];
		const room: Record<Side, number> = {
			bottom: vh - a.bottom - GAP - MARGIN,
			top: a.top - GAP - MARGIN,
			right: vw - a.right - GAP - MARGIN,
			left: a.left - GAP - MARGIN
		};
		const fits = (s: Side) => room[s] >= (s === 'top' || s === 'bottom' ? h : w);
		const chosen = [side, OPPOSITE[side], ...cross].find(fits);
		const clamp = (v: number, size: number, max: number) =>
			Math.min(Math.max(v, MARGIN), max - size - MARGIN);

		centered = !chosen;
		if (!chosen) {
			pos = { left: Math.max(MARGIN, (vw - w) / 2), top: Math.max(MARGIN, (vh - h) / 2) };
		} else if (chosen === 'top' || chosen === 'bottom') {
			const start = a.left;
			const end = a.right - w;
			const want = align === 'end' ? end : start;
			const other = align === 'end' ? start : end;
			const ok = (x: number) => x >= MARGIN && x + w <= vw - MARGIN;
			pos = {
				left: ok(want) ? want : ok(other) ? other : clamp(want, w, vw),
				top: chosen === 'bottom' ? a.bottom + GAP : a.top - GAP - h
			};
		} else {
			pos = {
				left: chosen === 'right' ? a.right + GAP : a.left - GAP - w,
				top: clamp(align === 'end' ? a.bottom - h : a.top, h, vh)
			};
		}
	}

	$effect(() => {
		if (narrow.current || !el) return;
		if (!open) {
			if (el.matches(':popover-open')) el.hidePopover();
			return;
		}
		el.showPopover();
		place();
		const update = () => place();
		const sizes = new ResizeObserver(update);
		sizes.observe(el);
		window.addEventListener('resize', update);
		window.addEventListener('scroll', update, true);
		return () => {
			sizes.disconnect();
			window.removeEventListener('resize', update);
			window.removeEventListener('scroll', update, true);
		};
	});

	// By the pointer's position: a click on the backdrop also targets the panel itself.
	function outside(e: PointerEvent) {
		if (!open || !el || narrow.current) return;
		const r = el.getBoundingClientRect();
		const inPanel =
			e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
		if (!inPanel && !(!centered && anchor?.contains(e.target as Node))) open = false;
	}

	// Before a surrounding dialog sees it, so Escape closes only the panel.
	function key(e: KeyboardEvent) {
		if (!open || narrow.current || e.key !== 'Escape') return;
		e.preventDefault();
		e.stopPropagation();
		open = false;
		anchor?.querySelector<HTMLElement>('[aria-expanded]')?.focus();
	}
</script>

<svelte:window onpointerdowncapture={outside} onkeydowncapture={key} />

{#if narrow.current}
	<Dialog bind:open {title}>{@render children()}</Dialog>
{:else}
	<div
		bind:this={el}
		popover="manual"
		role="dialog"
		aria-label={title}
		class={[
			'fixed inset-auto m-0 max-h-[calc(100dvh-1rem)] max-w-[calc(100vw-1rem)] overflow-auto rounded-card border border-border bg-surface p-3 text-fg shadow-popover',
			centered && 'backdrop:bg-black/40',
			className
		]}
		style:left="{pos?.left ?? 0}px"
		style:top="{pos?.top ?? 0}px"
	>
		{#if open}{@render children()}{/if}
	</div>
{/if}
