<!-- A small colored dot for online/offline states; `label` is its text next to it. -->
<script lang="ts" module>
	import { tv } from 'tailwind-variants/lite';

	const dot = tv({
		base: 'size-2 shrink-0 rounded-full',
		variants: {
			tone: { muted: 'bg-border', ok: 'bg-ok', warn: 'bg-warn', err: 'bg-err' }
		}
	});
</script>

<script lang="ts">
	let {
		tone = 'muted',
		label,
		title
	}: { tone?: 'muted' | 'ok' | 'warn' | 'err'; label?: string; title?: string } = $props();
</script>

<span class="inline-flex items-center gap-1.5" {title}
	><span class={dot({ tone })}></span>{label}</span
>
