<script lang="ts" module>
	import { tv, type VariantProps } from 'tailwind-variants';

	/** Preformatted text; `terminal` for logs and shell commands. */
	export const codeBlock = tv({
		base: 'm-0 overflow-auto rounded-lg p-3 font-mono text-xs leading-relaxed',
		variants: {
			tone: {
				plain: 'bg-surface-2 text-fg',
				outline: 'border border-border bg-surface text-fg',
				terminal: 'bg-code-bg text-code-fg'
			},
			wrap: { true: 'break-all whitespace-pre-wrap' }
		},
		defaultVariants: { tone: 'plain' }
	});
	export type CodeBlockVariants = VariantProps<typeof codeBlock>;
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		tone,
		wrap,
		class: className,
		children
	}: CodeBlockVariants & { class?: string; children: Snippet } = $props();
</script>

<pre class={codeBlock({ tone, wrap, class: className })}>{@render children()}</pre>
