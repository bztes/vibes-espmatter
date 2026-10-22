<script lang="ts">
	import { Fields, TextField } from '#lib/components/config/index.ts';
	import type { ConfiguratorEditorProps } from '#lib/device/configurator.ts';
	import type { WifiConfig } from '../index.ts';

	let { config = $bindable(), errors }: ConfiguratorEditorProps<WifiConfig> = $props();
</script>

<Fields>
	<TextField
		label="Network name (SSID)"
		maxlength={32}
		error={errors.ssid}
		bind:value={config.ssid}
	/>
	<TextField
		label="Password"
		help="Stored in your saved configuration and baked into the firmware. Can be changed on the device (Network page); flashing a firmware with other credentials here overrides that."
		secret
		maxlength={63}
		error={errors.password}
		bind:value={config.password}
	/>
	<TextField
		label="Hostname"
		help="The device’s name in the network (what your router shows); also host.name in OpenTelemetry. Letters, digits and dashes, not at the start or end. Empty: the project name, e.g. “Heat Pump” → heat-pump."
		maxlength={32}
		placeholder="empty: from the project name"
		error={errors.hostname}
		bind:value={config.hostname}
	/>
</Fields>
