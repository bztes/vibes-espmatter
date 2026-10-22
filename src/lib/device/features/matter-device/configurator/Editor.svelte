<script lang="ts">
	import { Fields, GpioField, NumberField, TextField } from '#lib/components/config/index.ts';
	import type { ConfiguratorEditorProps } from '#lib/device/configurator.ts';
	import type { MatterDeviceConfig } from '../index.ts';

	let {
		config = $bindable(),
		board,
		errors
	}: ConfiguratorEditorProps<MatterDeviceConfig> = $props();
</script>

<Fields>
	<NumberField
		label="Setup passcode"
		help="0 = derived from the device and board name. The pairing code is shown on the build page and in the serial log."
		min={0}
		max={99999998}
		error={errors.passcode}
		bind:value={config.passcode}
	/>
	<NumberField
		label="Discriminator"
		help="Tells devices apart while pairing. -1 = derived from the device and board name."
		min={-1}
		max={4095}
		error={errors.discriminator}
		bind:value={config.discriminator}
	/>
	<TextField
		label="Vendor name"
		maxlength={32}
		error={errors.vendorName}
		bind:value={config.vendorName}
	/>
	<GpioField
		label="Factory reset button"
		help="Hold it for 10 s to forget all pairings (e.g. the BOOT button)."
		{board}
		optional
		error={errors.resetGpio}
		bind:value={config.resetGpio}
	/>
</Fields>
