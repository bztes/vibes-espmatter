<script lang="ts" module>
	import { tv, type VariantProps } from 'tailwind-variants';

	export const button = tv({
		base: 'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium whitespace-nowrap transition-colors select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-50',
		variants: {
			variant: {
				primary: 'bg-accent text-accent-fg hover:bg-accent/90',
				secondary: 'border border-border-strong bg-surface text-fg hover:bg-surface-2',
				ghost: 'text-fg hover:bg-surface-2',
				danger: 'bg-err text-white hover:bg-err/90',
				link: 'text-accent underline underline-offset-2 hover:text-accent/80'
			},
			size: { sm: 'h-7 px-2.5 text-xs', md: 'h-9 px-3.5 text-sm', icon: 'size-8' }
		},
		// Links sit in running text: no box.
		compoundVariants: [{ variant: 'link', class: 'h-auto rounded-sm px-0' }],
		defaultVariants: { variant: 'secondary', size: 'md' }
	});
	export type ButtonVariants = VariantProps<typeof button>;
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';

	let {
		variant,
		size,
		class: className,
		children,
		type = 'button',
		...rest
	}: HTMLButtonAttributes & ButtonVariants & { children?: Snippet } = $props();
</script>

<button {type} class={button({ variant, size, class: className as string })} {...rest}>
	{@render children?.()}
</button>
