<!-- Wi-Fi connection in the header of the setup page (`status` area). -->
<script lang="ts">
	import Wifi from '@lucide/svelte/icons/wifi';
	import WifiOff from '@lucide/svelte/icons/wifi-off';
	import { live } from '../../web-ui/device-ui/live.svelte';
	import { Badge } from '../../../device-ui/ui';
	import type { WifiStatus } from './wifi';

	const status = live<WifiStatus>('/api/wifi/status');
</script>

{#if status.data}
	{@const w = status.data}
	{@const text = w.connected ? `${w.ssid} · ${w.rssi} dBm` : 'Wi-Fi offline'}
	<Badge tone={w.connected ? 'ok' : 'err'} title={text}>
		{#if w.connected}<Wifi size={13} />{:else}<WifiOff size={13} />{/if}
		<span class="max-sm:hidden">{text}</span>
	</Badge>
{/if}
