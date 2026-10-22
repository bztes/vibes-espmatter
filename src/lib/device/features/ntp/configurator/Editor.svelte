<script lang="ts">
	import { Fields, TextField } from '#lib/components/config/index.ts';
	import type { ConfiguratorEditorProps } from '#lib/device/configurator.ts';
	import type { NtpConfig } from '../index.ts';

	let { config = $bindable(), errors }: ConfiguratorEditorProps<NtpConfig> = $props();
</script>

<Fields>
	<TextField
		label="Time server"
		help="Host name or IP address of the NTP server, e.g. your router or pool.ntp.org."
		maxlength={64}
		placeholder="pool.ntp.org"
		error={errors.server}
		bind:value={config.server}
	/>
</Fields>
