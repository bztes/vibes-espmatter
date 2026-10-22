<script lang="ts">
	import { api, fmtDuration } from '../../web-ui/device-ui/api';
	import { live } from '../../web-ui/device-ui/live.svelte';
	import Panel from '../../web-ui/device-ui/Panel.svelte';
	import { Button, DataList, showConfirm } from '../../../device-ui/ui';
	import type { SystemStatus } from '../../web-ui/device-ui/types';

	const status = live<SystemStatus>('/api/status');
	const kb = (bytes: number) => Math.round(bytes / 1024) + ' KB';
	const mb = (bytes: number) =>
		(bytes / 1024 / 1024).toFixed(bytes % (1024 * 1024) ? 1 : 0) + ' MB';
	const pct = (used: number, total: number) => Math.round((used / total) * 100);

	async function reboot() {
		if (!(await showConfirm('Restart device', 'Restart the device?', { action: 'Restart' })))
			return;
		await api('/api/reboot', { method: 'POST' }).catch(() => {});
		setTimeout(() => location.reload(), 6000);
	}
</script>

{#snippet usage(used: number, total: number, text: string)}
	{@const p = pct(used, total)}
	<dd>
		{text} <span class="text-muted">({p} %)</span>
		<div class="mt-[3px] h-1 overflow-hidden rounded-[2px] bg-border">
			<div class={['h-full', p >= 90 ? 'bg-warn' : 'bg-accent']} style:width="{p}%"></div>
		</div>
	</dd>
{/snippet}

<Panel title="System">
	{#if status.data}
		{@const s = status.data}
		<DataList>
			<dt>Chip</dt>
			<dd>{s.chip} rev {s.chipRevision}</dd>
			<dt>Firmware</dt>
			<dd>{s.firmware} <span class="text-muted font-mono text-xs">{s.buildId}</span></dd>
			<dt>ESP-IDF</dt>
			<dd>{s.idf}</dd>
			<dt>Uptime</dt>
			<dd>{fmtDuration(s.uptime)}</dd>
			<dt>Last reset</dt>
			<dd>{s.resetReason}</dd>
			<dt>Free heap</dt>
			<dd>{kb(s.heapFree)} (min {kb(s.heapMin)})</dd>
			<dt>Free PSRAM</dt>
			<dd>{s.psramFree ? kb(s.psramFree) : '–'}</dd>
			{#if s.flash?.size}
				<dt>Flash</dt>
				<dd>{mb(s.flash.size)}</dd>
			{/if}
			{#if s.flash?.app && s.flash.appPartition}
				<dt>Firmware size</dt>
				{@render usage(
					s.flash.app,
					s.flash.appPartition,
					`${mb(s.flash.app)} of ${mb(s.flash.appPartition)}`
				)}
			{/if}
			{#if s.flash?.nvsUsed !== undefined && s.flash.nvsTotal}
				<dt>Settings (NVS)</dt>
				{@render usage(
					s.flash.nvsUsed,
					s.flash.nvsTotal,
					`${s.flash.nvsUsed} of ${s.flash.nvsTotal} entries`
				)}
			{/if}
		</DataList>
		<div class="mt-3"><Button onclick={reboot}>Restart device</Button></div>
	{:else if status.error}
		<p class="text-err">{status.error}</p>
	{:else}
		<p class="text-muted">Loading…</p>
	{/if}
</Panel>
