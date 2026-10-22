<script lang="ts">
	import { Fields } from '#lib/components/config/index.ts';
	import type { ConfiguratorEditorProps } from '#lib/device/configurator.ts';
	import type { AdminDashboardConfig } from '../index.ts';
	import PagePathField from '../../web-ui/configurator/PagePathField.svelte';

	let { config = $bindable(), errors }: ConfiguratorEditorProps<AdminDashboardConfig> = $props();
</script>

<Fields>
	<PagePathField error={errors.path} bind:value={config.path} />
</Fields>
