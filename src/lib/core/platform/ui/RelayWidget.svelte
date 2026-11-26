<script lang="ts">
	import { Poll, Row } from '#sdk/device-ui';

	const relay = new Poll<{
		requests: number;
		forwards: number;
		lastDevice: string;
		lastError: string;
	}>('/api/v1/relay', 10000);
</script>

{#if relay.current}
	{@const r = relay.current}
	<Row label="Reports relayed">{r.requests}</Row>
	<Row label="App requests passed on">{r.forwards}</Row>
	<Row label="Last device"><span class="font-mono text-xs">{r.lastDevice || '–'}</span></Row>
	{#if r.lastError}<p class="mt-2 text-xs text-err">{r.lastError}</p>{/if}
{/if}
