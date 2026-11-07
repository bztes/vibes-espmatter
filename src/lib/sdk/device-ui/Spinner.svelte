<script lang="ts">
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';

	let { size = 14, class: className }: { size?: number; class?: string } = $props();
</script>

<LoaderCircle {size} class={['shrink-0 animate-spin', className]} aria-hidden="true" />
