<!-- The dashboard page: device header, then the dashboard panels, full width. -->
<script lang="ts">
	import Header from '../../web-ui/device-ui/Header.svelte';
	import type { LayoutProps } from '../../web-ui/device-ui/types';

	let { device, page, panels }: LayoutProps = $props();
</script>

<Header {device} {page} />
<main class="mx-auto grid max-w-[1100px] gap-4 px-4 py-5">
	{#each panels as panel (panel.id)}
		<panel.component {...panel.props} />
	{/each}
</main>
