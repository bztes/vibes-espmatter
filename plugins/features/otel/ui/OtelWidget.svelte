<script lang="ts">
	import { Badge, Poll, Row } from '#sdk/device-ui';

	const otel = new Poll<{
		endpoint: string;
		exports: number;
		failures: number;
		lastStatus: number;
		metrics: boolean;
		logs: boolean;
		logsSent: number;
		logsDropped: number;
	}>('/api/v1/otel', 10000);
</script>

{#if otel.current}
	{@const o = otel.current}
	<Row label="Collector"><span class="font-mono text-xs">{o.endpoint}</span></Row>
	{#if o.metrics}
		<Row label="Exports">{o.exports} <span class="text-muted">/ {o.failures} failed</span></Row>
	{/if}
	<Row label="Last answer">
		<Badge
			tone={o.lastStatus >= 200 && o.lastStatus < 300
				? 'ok'
				: o.lastStatus === 0
					? 'neutral'
					: 'err'}
		>
			{o.lastStatus === -1 ? 'unreachable' : o.lastStatus || 'pending'}
		</Badge>
	</Row>
	{#if o.logs}
		<Row label="Log records">
			{o.logsSent} <span class="text-muted">/ {o.logsDropped} dropped</span>
		</Row>
	{/if}
{/if}
