<script lang="ts">
	import Logo from '#lib/components/Logo.svelte';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
</script>

<div class="grid min-h-screen place-items-center bg-bg px-4 py-12">
	<div class="w-full max-w-sm">
		<div class="mb-8 flex justify-center"><Logo size="lg" /></div>
		<div class="rounded-card border border-border bg-surface p-6 shadow-card">
			{@render children()}
		</div>
		<p class="mt-6 text-center text-xs text-muted">
			Configure, build and flash Matter firmware for ESP32 boards.
		</p>
	</div>
</div>
