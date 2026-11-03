<script module lang="ts">
	export const PORTS = [
		{ value: 'cnt', label: 'CN-CNT (for the CZ-TACG1 Wi-Fi adapter)' },
		{ value: 'wlan', label: 'CN-WLAN (built-in DNSK-P11 Wi-Fi module)' }
	];
</script>

<script lang="ts">
	import { Fields, GpioField, SelectField } from '#lib/components/config/index.ts';
	import type { ConfiguratorEditorProps } from '#lib/device/configurator.ts';
	import type { PanasonicAcConfig } from '../index.ts';

	let {
		config = $bindable(),
		board,
		errors
	}: ConfiguratorEditorProps<PanasonicAcConfig> = $props();
</script>

<Fields>
	<SelectField
		label="Connector on the unit"
		help="Nordic heat pumps like the HZ25ZKE have CN-CNT on the indoor unit’s main board (5-pin connector, where the optional CZ-TACG1 plugs in). Newer units may have CN-WLAN instead."
		options={PORTS}
		error={errors.port}
		bind:value={config.port}
	/>
	<GpioField
		label="UART RX (from the unit’s TX)"
		{board}
		error={errors.rxGpio}
		bind:value={config.rxGpio}
	/>
	<GpioField
		label="UART TX (to the unit’s RX)"
		{board}
		error={errors.txGpio}
		bind:value={config.txGpio}
	/>
</Fields>
