<script lang="ts">
	import { tv } from 'tailwind-variants';

	let {
		label,
		value,
		unit,
		tone = 'default',
		size = 'md'
	}: {
		label: string;
		value: string | number | undefined;
		unit?: string;
		tone?: 'default' | 'ok' | 'warn' | 'err' | 'accent';
		size?: 'md' | 'lg';
	} = $props();

	const stat = tv({
		slots: {
			root: 'flex flex-col gap-0.5',
			name: 'text-xs text-muted',
			num: 'font-semibold tabular-nums tracking-tight break-words',
			suffix: 'ml-0.5 font-normal text-muted'
		},
		variants: {
			tone: {
				default: {},
				ok: { num: 'text-ok' },
				warn: { num: 'text-warn' },
				err: { num: 'text-err' },
				accent: { num: 'text-accent' }
			},
			size: { md: { num: 'text-xl' }, lg: { num: 'text-4xl', suffix: 'text-xl' } }
		}
	});
	const s = $derived(stat({ tone, size }));
</script>

<div class={s.root()}>
	<span class={s.name()}>{label}</span>
	<span class={s.num()}
		>{value ?? '–'}{#if unit && value !== undefined}<span class={s.suffix()}>{unit}</span
			>{/if}</span
	>
</div>
