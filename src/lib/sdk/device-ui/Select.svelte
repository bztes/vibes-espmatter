<!--
  A native select, options as children or as `groups`. Where the browser can style selects
  (customizable select) the list gets the app's look and options show their extras; elsewhere it
  stays the browser's own, with just the labels.
-->
<script lang="ts" module>
	import { tv, type VariantProps } from 'tailwind-variants';
	import { input } from './Input.svelte';

	export interface SelectOption {
		value: string;
		label: string;
		description?: string;
		/** Short facts, shown as small badges. */
		meta?: string[];
		/** Still selectable, but marked; the text says why. */
		warning?: string;
	}
	export interface SelectGroup {
		/** Empty: no header. */
		label: string;
		options: SelectOption[];
	}

	/** Options may contain markup (customizable select). */
	export const richSelect = typeof CSS !== 'undefined' && CSS.supports('appearance', 'base-select');

	export const select = tv({
		extend: input,
		base: [
			'cursor-pointer text-left open:border-accent',
			// The field
			'[appearance:base-select] supports-[appearance:base-select]:flex supports-[appearance:base-select]:items-center [&::picker-icon]:content-none',
			'[&>button]:flex [&>button]:min-w-0 [&>button]:flex-1 [&>button]:items-center [&>button]:gap-2',
			'[&_selectedcontent]:flex [&_selectedcontent]:min-w-0 [&_selectedcontent]:flex-1 [&_selectedcontent]:items-center [&_selectedcontent]:gap-2 [&_selectedcontent]:truncate',
			'[&:has(option[data-placeholder]:checked)_selectedcontent]:text-muted/70',
			// The list
			'[&::picker(select)]:[appearance:base-select] [&::picker(select)]:my-1 [&::picker(select)]:max-h-[min(24rem,60vh)] [&::picker(select)]:max-w-[min(24rem,calc(100vw-1rem))] [&::picker(select)]:min-w-[anchor-size(width)] [&::picker(select)]:rounded-card [&::picker(select)]:border [&::picker(select)]:border-border [&::picker(select)]:bg-surface [&::picker(select)]:p-1 [&::picker(select)]:text-fg [&::picker(select)]:shadow-popover',
			'[&::picker(select)]:[transition:opacity_0.12s_ease-out,translate_0.12s_ease-out,overlay_0.12s_allow-discrete,display_0.12s_allow-discrete] [&::picker(select)]:[translate:0_-4px] [&::picker(select)]:opacity-0 open:[&::picker(select)]:[translate:0_0] open:[&::picker(select)]:opacity-100 starting:open:[&::picker(select)]:[translate:0_-4px] starting:open:[&::picker(select)]:opacity-0',
			// Options and groups, only in the styled list
			'supports-[appearance:base-select]:[&_option]:flex supports-[appearance:base-select]:[&_option]:min-h-8 supports-[appearance:base-select]:[&_option]:cursor-pointer supports-[appearance:base-select]:[&_option]:items-center supports-[appearance:base-select]:[&_option]:gap-2 supports-[appearance:base-select]:[&_option]:rounded-lg supports-[appearance:base-select]:[&_option]:px-2 supports-[appearance:base-select]:[&_option]:py-1.5 supports-[appearance:base-select]:[&_option]:text-sm supports-[appearance:base-select]:[&_option]:font-normal supports-[appearance:base-select]:[&_option]:text-fg supports-[appearance:base-select]:[&_option]:outline-none',
			'supports-[appearance:base-select]:[&_option:hover]:bg-surface-2 supports-[appearance:base-select]:[&_option:focus-visible]:bg-surface-2 supports-[appearance:base-select]:[&_option:checked]:bg-accent-soft/70 supports-[appearance:base-select]:[&_option:checked]:font-medium supports-[appearance:base-select]:[&_option:disabled]:cursor-not-allowed supports-[appearance:base-select]:[&_option:disabled]:opacity-45',
			'[&_option[data-placeholder]]:hidden [&_option::checkmark]:text-accent',
			'supports-[appearance:base-select]:[&_optgroup]:py-1 supports-[appearance:base-select]:[&_optgroup]:text-xs supports-[appearance:base-select]:[&_optgroup]:font-semibold supports-[appearance:base-select]:[&_optgroup]:text-muted supports-[appearance:base-select]:[&_optgroup+optgroup]:mt-1 supports-[appearance:base-select]:[&_optgroup+optgroup]:border-t supports-[appearance:base-select]:[&_optgroup+optgroup]:border-border'
		],
		variants: { size: { sm: 'px-2', md: 'px-2.5' } }
	});
	export type SelectVariants = VariantProps<typeof select>;
</script>

<script lang="ts">
	import ChevronsUpDown from '@lucide/svelte/icons/chevrons-up-down';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import type { Snippet } from 'svelte';
	import type { HTMLSelectAttributes } from 'svelte/elements';
	import Badge from './Badge.svelte';

	let {
		value = $bindable(),
		groups,
		placeholder,
		size,
		invalid,
		mono,
		class: className,
		children,
		...rest
	}: Omit<HTMLSelectAttributes, 'size'> &
		SelectVariants & {
			/** Shown while nothing (or an unknown value) is picked. */
			placeholder?: string;
		} & (
			{ groups: SelectGroup[]; children?: never } | { groups?: never; children: Snippet }
		) = $props();

	const known = $derived(!groups || groups.some((g) => g.options.some((o) => o.value === value)));
</script>

{#snippet item(o: SelectOption)}
	<option value={o.value} title={o.warning}>
		{#if richSelect}
			<span class="grid min-w-0 flex-1">
				<span class="flex min-w-0 items-center gap-1.5">
					<span class="truncate" class:text-muted={!!o.warning}>{o.label}</span>
					{#if o.warning}<TriangleAlert size={13} class="shrink-0 text-warn" />{/if}
				</span>
				{#if o.warning || o.description}
					<span
						class={[
							'truncate text-xs font-normal in-[selectedcontent]:hidden',
							o.warning ? 'text-warn' : 'text-muted'
						]}>{o.warning ?? o.description}</span
					>
				{/if}
			</span>
			{#if o.meta?.length}
				<span class="flex shrink-0 gap-1 in-[selectedcontent]:hidden sm:in-[selectedcontent]:flex">
					{#each o.meta as m (m)}<Badge class="px-1.5 py-px text-[11px] font-normal">{m}</Badge
						>{/each}
				</span>
			{/if}
		{:else}
			{o.label}{o.warning ? ` (${o.warning.toLowerCase()})` : ''}
		{/if}
	</option>
{/snippet}

<select bind:value class={select({ size, invalid, mono, class: className as string })} {...rest}>
	{#if richSelect}
		<button type="button"
			><selectedcontent></selectedcontent><ChevronsUpDown
				size={15}
				class="ml-auto shrink-0 text-muted"
			/></button
		>
	{/if}
	{#if placeholder && !known}
		<!-- Carries the unknown value, so the binding lands here. -->
		<option {value} disabled data-placeholder>{placeholder}</option>
	{:else if placeholder && !groups}
		<option value="" disabled data-placeholder>{placeholder}</option>
	{/if}
	{#if groups}
		{#each groups as g (g.label)}
			{#if g.label}
				<optgroup label={g.label}>
					{#each g.options as o (o.value)}{@render item(o)}{/each}
				</optgroup>
			{:else}
				{#each g.options as o (o.value)}{@render item(o)}{/each}
			{/if}
		{/each}
	{:else}
		{@render children?.()}
	{/if}
</select>
