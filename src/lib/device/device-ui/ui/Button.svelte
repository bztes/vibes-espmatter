<!-- A button; with `href` it renders a link that looks like one. -->
<script lang="ts">
	import type { HTMLAnchorAttributes, HTMLButtonAttributes } from 'svelte/elements';
	import { tv } from 'tailwind-variants/lite';

	// No class merging (lite): the classes of the chosen variants must not set the same properties.
	const boxed = ['default', 'primary', 'danger'] as const;
	const button = tv({
		base: 'inline-flex cursor-pointer items-center justify-center gap-1.5 no-underline disabled:cursor-default disabled:opacity-50',
		variants: {
			variant: {
				default: 'bg-bg',
				primary: 'border-accent bg-accent text-white',
				danger: 'bg-bg text-err',
				/** Borderless, e.g. a menu trigger in a bar. */
				ghost: 'min-h-[33px] rounded-lg border-0 bg-transparent px-1.5 py-[5px] hover:bg-bg',
				link: 'border-0 bg-transparent p-0 hover:not-disabled:underline'
			},
			/** Icon-only (lucide icons): square, as high as text buttons. */
			icon: { true: '', false: '' },
			size: { sm: 'text-xs', md: '', lg: '' },
			/** Color of a link: `muted` e.g. for Cancel next to the main action. */
			tone: { accent: '', muted: '', danger: '' }
		},
		compoundVariants: [
			{ variant: [...boxed], class: 'min-h-[33px] rounded-lg border' },
			{ variant: [...boxed], icon: false, size: 'sm', class: 'px-2 py-0.5' },
			{ variant: [...boxed], icon: false, size: 'md', class: 'px-3 py-[5px]' },
			{ variant: [...boxed], icon: false, size: 'lg', class: 'p-[9px]' },
			{ variant: [...boxed], icon: true, class: 'min-w-[33px] p-1' },
			{ variant: 'link', tone: 'accent', class: 'text-accent' },
			{ variant: 'link', tone: 'muted', class: 'text-muted' },
			{ variant: 'link', tone: 'danger', class: 'text-err disabled:text-muted' }
		]
	});

	type Props = {
		variant?: 'default' | 'primary' | 'danger' | 'ghost' | 'link';
		/** Icon-only: square padding. Give it an `aria-label`. */
		icon?: boolean;
		/** `sm`: less padding and smaller text; `lg`: taller, e.g. the submit button of a login form. */
		size?: 'sm' | 'md' | 'lg';
		/** Color of a `link`. */
		tone?: 'accent' | 'muted' | 'danger';
	} & (
		| ({ href: string } & Omit<HTMLAnchorAttributes, 'href'>)
		| ({ href?: undefined } & HTMLButtonAttributes)
	);

	let {
		variant = 'default',
		icon = false,
		size = 'md',
		tone = 'accent',
		class: className = '',
		href,
		children,
		...rest
	}: Props = $props();

	const classes = $derived([button({ variant, icon, size, tone }), className]);
</script>

{#if href !== undefined}
	<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- callers pass resolve()d paths -->
	<a {href} class={classes} {...rest as HTMLAnchorAttributes}>
		{@render children?.()}
	</a>
{:else}
	<button type="button" class={classes} {...rest as HTMLButtonAttributes}
		>{@render children?.()}</button
	>
{/if}
