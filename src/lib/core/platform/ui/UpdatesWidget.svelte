<script lang="ts">
	import { Badge, Button, Poll, Row, api, formatDuration } from '#sdk/device-ui';

	/** `canPull`: the firmware can pull updates; whether this device does is its own setting. */
	let { canPull = false }: { canPull?: boolean } = $props();

	interface Ota {
		version: number;
		/** Revision of the device configuration. */
		config?: string;
		pull?: boolean;
		partition: string;
		state: string;
		/** Unix time; missing before the first check or while the device's clock isn't set. */
		lastCheck?: number;
		/** Seconds since the last check. Missing from older firmware. */
		lastCheckAgo?: number;
		lastError: string;
	}
	const ota = new Poll<Ota>('/api/v1/ota', 4000);
	let checking = $state(false);

	async function check() {
		checking = true;
		await api('/api/v1/ota/check', { method: 'POST' }).catch(() => {});
		setTimeout(() => (checking = false), 3000);
	}
</script>

{#if ota.current}
	{@const o = ota.current}
	<Row label="Version">{o.version}</Row>
	{#if o.config}<Row label="Configuration"><span class="font-mono">{o.config}</span></Row>{/if}
	<Row label="Partition"><span class="font-mono">{o.partition}</span></Row>
	<Row label="State">
		<Badge tone={o.state === 'failed' ? 'err' : o.state === 'idle' ? 'neutral' : 'accent'}
			>{o.state}</Badge
		>
	</Row>
	{#if o.lastError}<p class="mt-2 text-xs text-err">{o.lastError}</p>{/if}
	{#if o.lastCheckAgo != null}
		<Row label="Last check">
			<span title={o.lastCheck ? new Date(o.lastCheck * 1000).toLocaleString() : undefined}
				>{o.lastCheckAgo < 60 ? 'just now' : `${formatDuration(o.lastCheckAgo)} ago`}</span
			>
		</Row>
	{:else if o.lastCheck && o.lastCheck > 1700000000}
		<Row label="Last check">{new Date(o.lastCheck * 1000).toLocaleString()}</Row>
	{/if}
	<p class="mt-2 text-xs text-muted">
		Updates: {canPull && o.pull ? 'from the app' : 'USB only'}.
	</p>
{/if}
{#if canPull && ota.current?.pull}
	<Button size="sm" class="mt-2" disabled={checking} onclick={check}
		>{checking ? 'Checking…' : 'Check for updates'}</Button
	>
{/if}
