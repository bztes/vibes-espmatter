<script lang="ts">
	import { Poll, Row, formatBytes } from '#sdk/device-ui';

	const relay = new Poll<{
		requests: number;
		transfers: number;
		bytes: number;
		lastDevice: string;
		lastError: string;
	}>('/api/v1/relay', 10000);
</script>

{#if relay.current}
	{@const r = relay.current}
	<Row label="Update checks">{r.requests}</Row>
	<Row label="Images relayed">{r.transfers} ({formatBytes(r.bytes)})</Row>
	<Row label="Last device"><span class="font-mono text-xs">{r.lastDevice || '–'}</span></Row>
	{#if r.lastError}<p class="mt-2 text-xs text-err">{r.lastError}</p>{/if}
{/if}
