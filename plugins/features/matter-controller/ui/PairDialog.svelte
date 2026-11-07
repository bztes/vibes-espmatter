<!-- Pairing a device into the hub's fabric. Keeps going (and its status) when closed meanwhile. -->
<script lang="ts">
	import { api, Button, Dialog, errorText, Input, Notice } from '#sdk/device-ui';

	let { open = $bindable(false), onpaired }: { open?: boolean; onpaired?: () => void } = $props();

	let code = $state('');
	let name = $state('');
	let status = $state<{ tone: 'info' | 'ok' | 'err'; text: string }>();
	let busy = $state(false);

	async function pair() {
		busy = true;
		status = { tone: 'info', text: 'Pairing – keep the device close, this takes up to a minute…' };
		try {
			await api('/api/v1/controller/pair', { body: { code: code.trim(), name: name.trim() } });
			for (let i = 0; i < 60; i++) {
				await new Promise((r) => setTimeout(r, 2000));
				const s = await api<{ state: string; error?: string }>('/api/v1/controller/pair');
				if (s.state === 'done') {
					status = { tone: 'ok', text: `${name.trim() || 'Device'} paired.` };
					code = name = '';
					onpaired?.();
					return;
				}
				if (s.state === 'failed')
					throw new Error(`Pairing failed${s.error ? `: ${s.error}` : ''}.`);
			}
			throw new Error('Pairing timed out.');
		} catch (e) {
			status = { tone: 'err', text: errorText(e) };
		} finally {
			busy = false;
		}
	}
</script>

<Dialog
	bind:open
	title="Pair a device"
	onsubmit={pair}
	onclose={() => !busy && (status = undefined)}
>
	<div class="grid gap-3">
		<label class="grid gap-1 text-sm">
			<span class="text-muted">Pairing code or QR payload</span>
			<Input mono placeholder="3497-011-2332" bind:value={code} disabled={busy} required />
		</label>
		<label class="grid gap-1 text-sm">
			<span class="text-muted">Name</span>
			<Input placeholder="Desk lamp" bind:value={name} disabled={busy} />
		</label>
		{#if status}<Notice tone={status.tone}>{status.text}</Notice>{/if}
	</div>
	{#snippet footer()}
		<Button variant="primary" type="submit" disabled={busy || !code.trim()}
			>{busy ? 'Pairing…' : 'Pair'}</Button
		>
		<Button variant="ghost" onclick={() => (open = false)}
			>{status?.tone === 'ok' ? 'Done' : 'Close'}</Button
		>
	{/snippet}
</Dialog>
