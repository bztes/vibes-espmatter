<script lang="ts">
	import {
		CheckField,
		Fields,
		GpioField,
		NumberField,
		TextField
	} from '#lib/components/config/index.ts';
	import type { ConfiguratorEditorProps } from '#lib/device/configurator.ts';
	import type { ThreadBrConfig } from '../index.ts';

	let { config = $bindable(), board, errors }: ConfiguratorEditorProps<ThreadBrConfig> = $props();
</script>

<Fields>
	<GpioField
		label="UART RX (from radio TX)"
		{board}
		error={errors.rxGpio}
		bind:value={config.rxGpio}
	/>
	<GpioField
		label="UART TX (to radio RX)"
		{board}
		error={errors.txGpio}
		bind:value={config.txGpio}
	/>
	<CheckField
		label="Form a Thread network automatically"
		help="On first boot a new network with random credentials is created."
		bind:checked={config.autoForm}
	/>
	<TextField
		label="Thread network name"
		maxlength={16}
		error={errors.networkName}
		bind:value={config.networkName}
	/>
	<NumberField
		label="Thread channel"
		help="0 = pick automatically, otherwise 11–26. Prefer 15, 20 or 25 to avoid Wi-Fi overlap."
		min={0}
		max={26}
		error={errors.channel}
		bind:value={config.channel}
	/>
</Fields>
