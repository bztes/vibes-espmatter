<script module lang="ts">
	export const FLASH_SIZES = [
		{ value: 'board', label: 'Board default' },
		{ value: '4', label: '4 MB' },
		{ value: '8', label: '8 MB' },
		{ value: '16', label: '16 MB' }
	];

	export const PSRAM_MODES = [
		{ value: 'board', label: 'Board default' },
		{ value: 'none', label: 'None' },
		{ value: 'quad', label: 'Quad (R2, 2 MB)' },
		{ value: 'octal', label: 'Octal (R8, 8 MB)' }
	];

	export const CONSOLES = [
		{ value: 'board', label: 'Board default' },
		{ value: 'uart', label: 'UART0 (USB-UART bridge)' },
		{ value: 'usb', label: 'Native USB (USB-Serial-JTAG)' }
	];
</script>

<script lang="ts">
	import { Fields, SelectField } from '#lib/components/config/index.ts';
	import type { ConfiguratorEditorProps } from '#lib/device/configurator.ts';
	import type { DeviceConfig } from '../index.ts';

	let { config = $bindable(), errors }: ConfiguratorEditorProps<DeviceConfig> = $props();
</script>

<Fields>
	<SelectField
		label="Flash size"
		help="Look at the module: N4 = 4 MB, N8 = 8 MB, N16 = 16 MB."
		options={FLASH_SIZES}
		error={errors.flashSize}
		bind:value={config.flashSize}
	/>
	<SelectField
		label="PSRAM"
		help="Module suffix R2 = 2 MB quad PSRAM, R8 = 8 MB octal PSRAM."
		options={PSRAM_MODES}
		error={errors.psram}
		bind:value={config.psram}
	/>
	<SelectField
		label="Log console"
		options={CONSOLES}
		error={errors.console}
		bind:value={config.console}
	/>
</Fields>
