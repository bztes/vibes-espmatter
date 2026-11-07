<script lang="ts">
	import { Badge, Button, Notice, Poll, api, errorText } from '#sdk/device-ui';

	interface Matter {
		commissioned: boolean;
		fabrics: number;
		windowOpen: boolean;
		qr: string;
		manualCode: string;
	}
	const matter = new Poll<Matter>('/api/v1/matter', 5000);
	let message = $state('');

	const formatted = (code: string) => code.replace(/^(\d{4})(\d{3})(\d+)$/, '$1-$2-$3');

	async function open() {
		try {
			await api('/api/v1/matter/window', { body: { seconds: 300 } });
			message = 'Pairing is open for 5 minutes.';
			await matter.refresh();
		} catch (e) {
			message = errorText(e);
		}
	}
</script>

{#if matter.current}
	{@const m = matter.current}
	<div class="flex items-center justify-between gap-3">
		<div>
			<div class="text-xs text-muted">Manual pairing code</div>
			<div class="font-mono text-2xl font-semibold tracking-wider">{formatted(m.manualCode)}</div>
		</div>
		<Badge tone={m.commissioned ? 'ok' : 'warn'}
			>{m.commissioned ? `${m.fabrics} fabric${m.fabrics === 1 ? '' : 's'}` : 'not paired'}</Badge
		>
	</div>
	<div class="mt-2 truncate font-mono text-xs text-muted" title="QR code payload">{m.qr}</div>
	<div class="mt-3 flex flex-wrap items-center gap-2">
		<Button size="sm" variant="primary" disabled={m.windowOpen} onclick={open}>
			{m.windowOpen ? 'Pairing open' : 'Pair with another app'}
		</Button>
	</div>
	{#if message}<div class="mt-2"><Notice>{message}</Notice></div>{/if}
{:else if matter.error}
	<p class="text-sm text-err">{matter.error}</p>
{/if}
