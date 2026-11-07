<script lang="ts">
	import { tv } from 'tailwind-variants';

	let {
		checked = $bindable(false),
		label,
		disabled = false,
		onchange
	}: {
		checked?: boolean;
		label?: string;
		disabled?: boolean;
		onchange?: (checked: boolean) => void;
	} = $props();

	const toggle = tv({
		slots: {
			track:
				'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50',
			thumb: 'inline-block size-5 rounded-full bg-white shadow transition-transform'
		},
		variants: {
			on: {
				true: { track: 'bg-accent', thumb: 'translate-x-5.5' },
				false: { track: 'bg-border-strong', thumb: 'translate-x-0.5' }
			}
		}
	});
	const s = $derived(toggle({ on: checked }));
</script>

<button
	type="button"
	role="switch"
	aria-checked={checked}
	aria-label={label}
	{disabled}
	class={s.track()}
	onclick={() => {
		checked = !checked;
		onchange?.(checked);
	}}
>
	<span class={s.thumb()}></span>
</button>
