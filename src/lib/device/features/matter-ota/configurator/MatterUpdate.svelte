<!-- Install a build over Matter: the device's hub fetches and passes it on (`InstallUpdate`). -->
<script lang="ts">
	import type { FlashProps } from '#lib/device/configurator.ts';
	import InstallUpdate from '#lib/components/InstallUpdate.svelte';

	let props: FlashProps = $props();
</script>

<InstallUpdate {...props} by="hub" />
