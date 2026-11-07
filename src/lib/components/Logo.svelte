<script lang="ts">
	let { size = 'md' }: { size?: 'md' | 'lg' } = $props();
</script>

<span class="inline-flex items-center gap-2 font-semibold tracking-tight text-fg">
	<svg viewBox="0 0 32 32" class={size === 'lg' ? 'size-9' : 'size-7'} aria-hidden="true">
		<rect width="32" height="32" rx="8" class="fill-accent" />
		<path d="M9 10h14M9 16h9M9 22h14" stroke="white" stroke-width="3" stroke-linecap="round" />
		<circle cx="23" cy="16" r="2.5" fill="white" />
	</svg>
	<span class={size === 'lg' ? 'text-xl' : 'text-[15px]'}
		>espmatter <span class="font-normal text-muted">studio</span></span
	>
</span>
