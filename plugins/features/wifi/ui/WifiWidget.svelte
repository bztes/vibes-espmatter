<script lang="ts">
	import { Badge, Button, Notice, Poll, Row, api, errorText } from '#sdk/device-ui';

	interface Status {
		connected: boolean;
		ssid?: string;
		rssi?: number;
		channel?: number;
		ip: string;
		mac: string;
	}
	interface Network {
		ssid: string;
		rssi: number;
		channel: number;
		secure: boolean;
	}

	const status = new Poll<Status>('/api/v1/wifi', 5000);
	let networks = $state<Network[]>();
	let scanning = $state(false);
	let target = $state<Network>();
	let password = $state('');
	let message = $state<{ tone: 'ok' | 'err'; text: string }>();

	const bars = (rssi: number) => (rssi > -55 ? 4 : rssi > -67 ? 3 : rssi > -78 ? 2 : 1);

	async function scan() {
		scanning = true;
		try {
			networks = (await api<{ networks: Network[] }>('/api/v1/wifi/scan')).networks;
		} catch (e) {
			message = { tone: 'err', text: errorText(e) };
		} finally {
			scanning = false;
		}
	}

	async function join() {
		if (!target) return;
		try {
			await api('/api/v1/wifi', { body: { ssid: target.ssid, password } });
			message = {
				tone: 'ok',
				text: `Switching to ${target.ssid} – the device is back in a moment.`
			};
			target = undefined;
			password = '';
		} catch (e) {
			message = { tone: 'err', text: errorText(e) };
		}
	}
</script>

{#if status.current}
	{@const s = status.current}
	<Row label="Network">
		{#if s.connected}{s.ssid} <Badge tone="ok">{s.rssi} dBm</Badge>{:else}<Badge tone="err"
				>offline</Badge
			>{/if}
	</Row>
	<Row label="IP address"><span class="font-mono">{s.ip || '–'}</span></Row>
	<Row label="MAC"><span class="font-mono">{s.mac}</span></Row>
{/if}

<div class="mt-3">
	<Button size="sm" disabled={scanning} onclick={scan}
		>{scanning ? 'Scanning…' : 'Change network'}</Button
	>
</div>

{#if networks}
	<ul class="mt-3 grid gap-1">
		{#each networks as n (n.ssid)}
			<li>
				<button
					type="button"
					class={[
						'flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface-2',
						target === n && 'bg-accent-soft'
					]}
					onclick={() => (target = n)}
				>
					<span
						>{n.ssid}
						{#if n.secure}<span class="text-muted">🔒</span>{/if}</span
					>
					<span class="font-mono text-xs text-muted">{'▂▄▆█'.slice(0, bars(n.rssi))}</span>
				</button>
			</li>
		{/each}
	</ul>
{/if}

{#if target}
	<form class="mt-3 flex gap-2" onsubmit={(e) => (e.preventDefault(), join())}>
		{#if target.secure}
			<input
				type="password"
				placeholder="Password for {target.ssid}"
				class="h-8 min-w-0 flex-1 rounded-md border border-border-strong bg-surface px-2 text-sm"
				bind:value={password}
			/>
		{/if}
		<Button size="sm" variant="primary" type="submit">Join</Button>
	</form>
{/if}

{#if message}<div class="mt-3"><Notice tone={message.tone}>{message.text}</Notice></div>{/if}
