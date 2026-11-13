<script lang="ts">
	import { Button, Poll, Row, api, formatBytes, formatDuration, Spot } from '#sdk/device-ui';

	interface System {
		uptime: number;
		resetReason: string;
		heap: { free: number; min: number };
		psram: { free: number };
		network: { ip: string; rssi?: number };
	}

	/** Only a Matter device can identify itself (Identify cluster); a hub can't. */
	let { identify = true }: { identify?: boolean } = $props();

	const system = new Poll<System>('/api/v1/system', 5000);
	let rebooting = $state(false);

	async function reboot() {
		rebooting = true;
		await api('/api/v1/system/reboot', { method: 'POST' }).catch(() => {});
	}
</script>

{#if system.current}
	{@const s = system.current}
	<div class="grid">
		<Row label="Uptime">{formatDuration(s.uptime)}</Row>
		<Row label="Last reset">{s.resetReason}</Row>
		<Row label="Free memory"
			>{formatBytes(s.heap.free)}
			<span class="text-muted">(min {formatBytes(s.heap.min)})</span></Row
		>
		{#if s.psram.free}<Row label="Free PSRAM">{formatBytes(s.psram.free)}</Row>{/if}
		<Row label="IP address"><span class="font-mono">{s.network.ip || '–'}</span></Row>
		{#if s.network.rssi !== undefined}<Row label="Signal">{s.network.rssi} dBm</Row>{/if}
	</div>
{:else if system.error}
	<p class="text-sm text-err">{system.error}</p>
{:else}
	<p class="text-sm text-muted">Loading…</p>
{/if}
<div class="mt-3 flex gap-2">
	{#if identify}
		<Button size="sm" onclick={() => api('/api/v1/system/identify', { body: { seconds: 10 } })}
			>Identify</Button
		>
	{/if}
	<Button size="sm" variant="danger" disabled={rebooting} onclick={reboot}
		>{rebooting ? 'Restarting…' : 'Restart'}</Button
	>
	<div class="ml-auto flex gap-1">
		<Spot name="device-icons" context={{ own: true, name: 'System' }} />
	</div>
</div>
