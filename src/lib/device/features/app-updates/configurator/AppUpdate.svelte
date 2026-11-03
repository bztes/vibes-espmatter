<!-- Install a build from the app: the device fetches it itself (`InstallUpdate`). -->
<script lang="ts">
	import type { FlashProps } from '#lib/device/configurator.ts';
	import InstallUpdate from '#lib/components/InstallUpdate.svelte';

	let props: FlashProps = $props();
</script>

<InstallUpdate {...props} by="device" />
