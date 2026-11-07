<script lang="ts" module>
	import { tv } from 'tailwind-variants';

	export const check = tv({
		slots: {
			root: 'inline-flex items-center gap-2 text-sm has-disabled:opacity-60',
			box: 'size-4 shrink-0 cursor-pointer accent-accent disabled:cursor-default'
		}
	});
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLInputAttributes } from 'svelte/elements';

	let {
		checked = $bindable(false),
		label,
		class: className,
		children,
		...rest
	}: Omit<HTMLInputAttributes, 'type'> & { label?: string; children?: Snippet } = $props();
	const s = check();
</script>

{#if label || children}
	<label class={s.root({ class: className as string })}>
		<input type="checkbox" class={s.box()} bind:checked {...rest} />
		{label}{@render children?.()}
	</label>
{:else}
	<input type="checkbox" class={s.box({ class: className as string })} bind:checked {...rest} />
{/if}
