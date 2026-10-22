<!-- A small round toggle button (e.g. weekdays, Wi-Fi networks); `pressed` highlights it. -->
<script lang="ts">
	import type { HTMLButtonAttributes } from 'svelte/elements';
	import { tv } from 'tailwind-variants/lite';

	const chip = tv({
		base: 'inline-flex min-h-[33px] min-w-9 cursor-pointer items-center justify-center rounded-full border px-2.5 py-1 text-xs disabled:cursor-default disabled:opacity-50',
		variants: {
			pressed: { true: 'border-accent bg-accent text-white', false: 'bg-bg' }
		}
	});

	let {
		pressed = false,
		children,
		...rest
	}: HTMLButtonAttributes & { pressed?: boolean } = $props();
</script>

<button type="button" class={chip({ pressed })} aria-pressed={pressed} {...rest}
	>{@render children?.()}</button
>
