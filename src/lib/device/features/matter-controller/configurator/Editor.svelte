<script module lang="ts">
	export const ATTESTATION = [
		{ value: 'dcl', label: 'CSA DCL (real certified devices, needs internet)' },
		{ value: 'test', label: 'Test PAA only (development devices, e.g. esp-matter examples)' }
	];
</script>

<script lang="ts">
	import { Fields, NumberField, SelectField } from '#lib/components/config/index.ts';
	import type { ConfiguratorEditorProps } from '#lib/device/configurator.ts';
	import type { MatterControllerConfig } from '../index.ts';

	let { config = $bindable(), errors }: ConfiguratorEditorProps<MatterControllerConfig> = $props();
</script>

<Fields>
	<SelectField
		label="Device attestation trust store"
		help="Certified products are verified against the CSA Distributed Compliance Ledger."
		options={ATTESTATION}
		error={errors.attestation}
		bind:value={config.attestation}
	/>
	<NumberField
		label="Fabric ID"
		min={1}
		max={65535}
		error={errors.fabricId}
		bind:value={config.fabricId}
	/>
	<NumberField
		label="Controller node ID"
		min={1}
		max={0xfffffff}
		error={errors.nodeId}
		bind:value={config.nodeId}
	/>
</Fields>
