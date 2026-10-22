<script lang="ts">
	import { Fields, SelectField } from '#lib/components/config/index.ts';
	import type { ConfiguratorEditorProps } from '#lib/device/configurator.ts';
	import { ROLES } from '../roles.ts';

	let { config = $bindable(), errors }: ConfiguratorEditorProps<{ role: string }> = $props();
</script>

<Fields>
	<SelectField label="This board" options={ROLES} error={errors.role} bind:value={config.role} />
</Fields>
