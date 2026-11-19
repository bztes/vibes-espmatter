<!-- Time range: one button with steps back and forth; presets and a custom range in a popover. -->
<script lang="ts">
	import Calendar from '@lucide/svelte/icons/calendar';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import ZoomOut from '@lucide/svelte/icons/zoom-out';
	import { Button, Input, Popover, button } from '#sdk/device-ui';
	import {
		MAX_RANGE_S,
		PRESET_GROUPS,
		custom,
		fromLocalInput,
		presetView,
		shift,
		zoomOut,
		toLocalInput,
		viewLabel,
		type View
	} from './ranges';

	let { view, onchange }: { view: View; onchange: (v: View) => void } = $props();

	let open = $state(false);
	let root = $state<HTMLElement>();
	let fromText = $state('');
	let toText = $state('');

	const draft = $derived(custom(fromLocalInput(fromText), fromLocalInput(toText)));
	const nowS = () => Math.floor(Date.now() / 1000);
	// Nothing to see after now.
	const atEnd = $derived(view.to >= nowS());

	function toggle() {
		open = !open;
		if (open) {
			fromText = toLocalInput(view.from);
			toText = toLocalInput(Math.min(view.to, nowS()));
		}
	}

	function pick(v: View) {
		open = false;
		onchange(v);
	}
</script>

{#snippet panel()}
	<div class="grid grid-cols-2 gap-x-3 text-sm">
		{#each PRESET_GROUPS as g (g.label)}
			<div class="flex flex-col">
				<div class="mb-1 px-2 text-xs font-semibold text-muted">{g.label}</div>
				{#each g.options as p (p.value)}
					<button
						type="button"
						class={[
							'rounded-lg px-2 py-1.5 text-left hover:bg-surface-2',
							view.preset === p.value && 'bg-accent-soft/70 font-medium'
						]}
						onclick={() => pick(presetView(p.value))}>{p.label}</button
					>
				{/each}
			</div>
		{/each}
	</div>
	<form
		class="mt-3 grid gap-2 border-t border-border pt-3 text-sm"
		onsubmit={(e) => {
			e.preventDefault();
			if (draft) pick(draft);
		}}
	>
		<div class="text-xs font-semibold text-muted">Custom</div>
		<label class="grid grid-cols-[3rem_1fr] items-center gap-2">
			<span class="text-muted">From</span>
			<Input type="datetime-local" size="sm" bind:value={fromText} />
		</label>
		<label class="grid grid-cols-[3rem_1fr] items-center gap-2">
			<span class="text-muted">To</span>
			<Input type="datetime-local" size="sm" bind:value={toText} invalid={!draft} />
		</label>
		<Button type="submit" size="sm" variant="primary" class="justify-self-end" disabled={!draft}
			>Show</Button
		>
	</form>
{/snippet}

<!-- Fixed width, so a longer label doesn't move the layout. -->
<div class="flex items-center rounded-lg bg-surface-2 p-0.5" bind:this={root}>
	<button
		type="button"
		class={button({ variant: 'ghost', size: 'icon', class: 'size-7 text-muted' })}
		aria-label="Earlier"
		onclick={() => onchange(shift(view, -1))}><ChevronLeft size={16} /></button
	>
	<button
		type="button"
		class="flex h-7 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md bg-surface px-2.5 text-sm font-medium whitespace-nowrap shadow-card sm:w-52 sm:flex-none"
		title={viewLabel(view)}
		aria-haspopup="dialog"
		aria-expanded={open}
		onclick={toggle}
		><Calendar size={14} class="shrink-0 text-muted" /><span class="truncate tabular-nums"
			>{viewLabel(view)}</span
		></button
	>
	<button
		type="button"
		class={button({ variant: 'ghost', size: 'icon', class: 'size-7 text-muted' })}
		aria-label="Later"
		disabled={atEnd}
		onclick={() => onchange(shift(view, 1))}><ChevronRight size={16} /></button
	>
	<button
		type="button"
		class={button({ variant: 'ghost', size: 'icon', class: 'size-7 text-muted' })}
		aria-label="Zoom out"
		title="Zoom out"
		disabled={view.to - view.from >= MAX_RANGE_S}
		onclick={() => onchange(zoomOut(view))}><ZoomOut size={16} /></button
	>
</div>

<Popover bind:open anchor={root} title="Time range" placement="bottom-end" class="w-88">
	{@render panel()}
</Popover>
