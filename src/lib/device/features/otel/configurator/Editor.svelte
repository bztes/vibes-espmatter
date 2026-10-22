<script module lang="ts">
	export const LOG_LEVELS = [
		{ value: 'error', label: 'Errors' },
		{ value: 'warn', label: 'Warnings and errors' },
		{ value: 'info', label: 'Everything (info)' }
	];
</script>

<script lang="ts">
	import {
		CheckField,
		FieldBox,
		FieldBoxes,
		Fields,
		NumberField,
		SelectField,
		TextField
	} from '#lib/components/config/index.ts';
	import type { ConfiguratorEditorProps } from '#lib/device/configurator.ts';
	import type { OtelConfig } from '../index.ts';

	let { config = $bindable(), errors }: ConfiguratorEditorProps<OtelConfig> = $props();
</script>

<Fields>
	<TextField
		label="OTLP endpoint"
		help="The OTLP/HTTP base URL; /v1/metrics and /v1/logs are added. OpenTelemetry Collector: http://<host>:4318. OpenObserve: http://<host>:5080/api/<organization>. The backend must accept OTLP as JSON – if it only takes protobuf, send to a Collector that forwards to it. With the admin dashboard it can also be set (or changed) on the device."
		maxlength={200}
		placeholder="http://collector.local:4318"
		error={errors.endpoint}
		bind:value={config.endpoint}
	/>
	<TextField
		label="Service name"
		help="Sent as service.name with every metric and log line – what the backend shows and filters by, e.g. “heat-pump-living-room”. Empty: the device’s hostname."
		maxlength={64}
		placeholder="empty: the hostname"
		error={errors.serviceName}
		bind:value={config.serviceName}
	/>
	<TextField
		label="Authorization header"
		help="Sent as the Authorization header, e.g. “Basic …” (OpenObserve shows it on its ingestion page) or “Bearer …”. Leave empty if the endpoint needs no login. Stored in your saved configuration and baked into the firmware. Settings changed on the device stay until a firmware with other values here is flashed."
		secret
		maxlength={256}
		placeholder="Basic …"
		error={errors.authorization}
		bind:value={config.authorization}
	/>
</Fields>
<FieldBoxes>
	<FieldBox
		title="Metrics"
		help="Measurements of the features as OTLP metrics: e.g. the heat pump’s temperatures, or the temperature, humidity, battery and on/off of the devices paired with the Matter controller (matter.*, with the node, endpoint and name as attributes)."
		bind:enabled={config.metrics}
	>
		<NumberField
			label="Every (seconds)"
			min={10}
			max={3600}
			error={errors.interval}
			bind:value={config.interval}
		/>
		<CheckField
			label="Device metrics"
			help="Also sends the device’s uptime, free memory and Wi-Fi signal strength."
			bind:checked={config.system}
		/>
	</FieldBox>
	<FieldBox
		title="Logs"
		help="The device’s log (what the serial console shows) as OTLP logs."
		bind:enabled={config.logs}
	>
		<SelectField
			label="Level"
			help="The lowest level sent. “Everything” includes the Matter stack’s chatty info lines."
			options={LOG_LEVELS}
			error={errors.logLevel}
			bind:value={config.logLevel}
		/>
		<NumberField
			label="Every (seconds, 0 = right away)"
			help="0: each line is sent right away (a burst together, at most once a second). Otherwise collected and sent at this interval – errors still right away."
			min={0}
			max={3600}
			error={errors.logInterval}
			bind:value={config.logInterval}
		/>
	</FieldBox>
</FieldBoxes>
