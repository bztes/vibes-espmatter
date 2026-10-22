<script lang="ts">
	import { Fields, NumberField, TextField } from '#lib/components/config/index.ts';
	import type { ConfiguratorEditorProps } from '#lib/device/configurator.ts';
	import type { HttpServerConfig } from '../index.ts';

	let { config = $bindable(), errors }: ConfiguratorEditorProps<HttpServerConfig> = $props();
</script>

<Fields>
	<TextField
		label="Admin user name"
		maxlength={23}
		error={errors.username}
		bind:value={config.username}
	/>
	<TextField
		label="Initial admin password"
		help="Must be changed at the first login; afterwards passwords are managed on the device. Changing the user name or this password and flashing again resets that admin’s password to it."
		secret
		maxlength={64}
		error={errors.password}
		bind:value={config.password}
	/>
	<NumberField label="HTTP port" min={1} max={65535} error={errors.port} bind:value={config.port} />
</Fields>
