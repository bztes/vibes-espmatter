<!-- A row of mutually exclusive options (a radio group styled as joined buttons). -->
<script lang="ts" module>
	import { tv } from 'tailwind-variants/lite';

	const segmented = tv({
		slots: {
			group: 'overflow-hidden rounded-lg border text-sm',
			option:
				'inline-flex min-h-[33px] cursor-pointer items-center justify-center rounded-none border-0 px-3 py-[5px] not-first:border-l'
		},
		variants: {
			/** Full width, options share it equally. */
			stretch: { true: { group: 'flex', option: 'flex-1' }, false: { group: 'inline-flex' } },
			active: {
				true: { option: 'bg-accent text-white' },
				false: { option: 'bg-transparent hover:bg-bg' }
			}
		}
	});
</script>

<script lang="ts" generics="T extends string">
	let {
		options,
		value = $bindable(),
		label,
		stretch = false
	}: {
		/** `[value, label]` pairs. */
		options: readonly (readonly [T, string])[];
		value: T;
		/** Accessible name of the group. */
		label: string;
		/** Full width, options share it equally. */
		stretch?: boolean;
	} = $props();

	const { group, option } = $derived(segmented({ stretch }));
</script>

<div class={group()} role="radiogroup" aria-label={label}>
	{#each options as [id, text] (id)}
		<button
			type="button"
			role="radio"
			aria-checked={value === id}
			class={option({ active: value === id })}
			onclick={() => (value = id)}>{text}</button
		>
	{/each}
</div>
