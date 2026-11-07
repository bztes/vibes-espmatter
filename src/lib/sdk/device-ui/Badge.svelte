<script lang="ts" module>
	import { tv, type VariantProps } from 'tailwind-variants';

	export const badge = tv({
		base: 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap',
		variants: {
			tone: {
				neutral: 'bg-surface-2 text-muted',
				accent: 'bg-accent-soft text-accent',
				ok: 'bg-ok-soft text-ok',
				warn: 'bg-warn-soft text-warn',
				err: 'bg-err-soft text-err',
				info: 'bg-info-soft text-info'
			}
		},
		defaultVariants: { tone: 'neutral' }
	});
	export type BadgeTone = NonNullable<VariantProps<typeof badge>['tone']>;
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		tone,
		class: className,
		children
	}: { tone?: BadgeTone; class?: string; children: Snippet } = $props();
</script>

<span class={badge({ tone, class: className })}>{@render children()}</span>
