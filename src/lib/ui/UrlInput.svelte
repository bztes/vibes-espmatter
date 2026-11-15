<!-- A text field for one part of a URL, the fixed rest shown before and after it. -->
<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';

	let {
		value = $bindable(),
		prefix = '',
		suffix = '',
		invalid = false,
		class: className,
		...rest
	}: Omit<HTMLInputAttributes, 'size' | 'prefix'> & {
		prefix?: string;
		suffix?: string;
		invalid?: boolean;
	} = $props();

	let input: HTMLInputElement;
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div
	class="flex h-9 min-w-0 cursor-text items-center rounded-lg border bg-surface font-mono text-sm transition-colors focus-within:ring-2 {invalid
		? 'border-err focus-within:border-err focus-within:ring-err/20'
		: 'border-border-strong focus-within:border-accent focus-within:ring-accent/25'} {className}"
	onclick={() => input.focus()}
>
	{#if prefix}<span class="shrink-0 pl-3 text-muted select-none">{prefix}</span>{/if}
	<input
		bind:this={input}
		bind:value
		class="h-full w-0 min-w-16 flex-1 bg-transparent px-0.5 text-fg outline-none placeholder:text-muted/70 {prefix
			? ''
			: 'pl-3'} {suffix ? '' : 'pr-3'}"
		spellcheck="false"
		autocapitalize="off"
		autocomplete="off"
		aria-invalid={invalid || undefined}
		{...rest}
	/>
	{#if suffix}<span class="truncate pr-3 text-muted select-none">{suffix}</span>{/if}
</div>
