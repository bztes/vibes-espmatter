<!-- A progress bar; `value` from 0 to 1. -->
<script lang="ts">
	let { value, error = false }: { value: number; error?: boolean } = $props();
</script>

<div
	class="h-2 overflow-hidden rounded-full bg-border"
	role="progressbar"
	aria-valuemin={0}
	aria-valuemax={100}
	aria-valuenow={Math.round(value * 100)}
>
	<div
		class={['h-full rounded-full transition-[width] duration-200', error ? 'bg-err' : 'bg-accent']}
		style:width="{Math.round(value * 100)}%"
	></div>
</div>
