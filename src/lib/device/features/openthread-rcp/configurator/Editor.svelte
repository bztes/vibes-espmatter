<script lang="ts">
	import { Fields, GpioField } from '#lib/components/config/index.ts';
	import type { ConfiguratorEditorProps } from '#lib/device/configurator.ts';
	import type { OpenthreadRcpConfig } from '../index.ts';

	let {
		config = $bindable(),
		board,
		errors
	}: ConfiguratorEditorProps<OpenthreadRcpConfig> = $props();
</script>

<Fields>
	<GpioField
		label="UART TX (to host RX)"
		{board}
		error={errors.txGpio}
		bind:value={config.txGpio}
	/>
	<GpioField
		label="UART RX (from host TX)"
		{board}
		error={errors.rxGpio}
		bind:value={config.rxGpio}
	/>
</Fields>
