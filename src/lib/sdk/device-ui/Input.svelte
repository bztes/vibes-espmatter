<script lang="ts" module>
	import { tv, type VariantProps } from 'tailwind-variants';

	/** Look of text fields; selects extend it. */
	export const input = tv({
		base: 'w-full min-w-0 rounded-lg border bg-surface text-sm text-fg transition-colors outline-none placeholder:text-muted/70 focus:border-accent focus:ring-2 focus:ring-accent/25 disabled:opacity-60',
		variants: {
			size: { sm: 'h-8 px-2.5', md: 'h-9 px-3' },
			invalid: {
				true: 'border-err focus:border-err focus:ring-err/20',
				false: 'border-border-strong'
			},
			mono: { true: 'font-mono' }
		},
		defaultVariants: { size: 'md', invalid: false }
	});
	export type InputVariants = VariantProps<typeof input>;
</script>

<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';

	let {
		value = $bindable(),
		size,
		invalid,
		mono,
		class: className,
		...rest
	}: Omit<HTMLInputAttributes, 'size'> & InputVariants = $props();
</script>

<input bind:value class={input({ size, invalid, mono, class: className as string })} {...rest} />
