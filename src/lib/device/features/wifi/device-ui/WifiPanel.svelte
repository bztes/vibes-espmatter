<!-- Wi-Fi status, and switching to another network (admins; tried first, see espm_wifi.cpp). -->
<script lang="ts">
	import { api, errorMessage } from '../../web-ui/device-ui/api';
	import { auth } from '../../web-ui/device-ui/auth.svelte';
	import { live } from '../../web-ui/device-ui/live.svelte';
	import Panel from '../../web-ui/device-ui/Panel.svelte';
	import {
		Alert,
		Button,
		Chip,
		DataList,
		Dialog,
		Input,
		PasswordInput,
		showConfirm
	} from '../../../device-ui/ui';
	import type { WifiStatus } from './wifi';

	interface WifiSettings {
		ssid: string;
		connected: boolean;
		/** Last switch from here: `connecting`, `connected` or `reverted` (to the previous network). */
		switch: { ssid: string; state: '' | 'connecting' | 'connected' | 'reverted' };
	}
	interface Network {
		ssid: string;
		rssi: number;
		channel: number;
		auth: string;
	}

	const status = live<WifiStatus>('/api/wifi/status');
	const isAdmin = $derived(auth.session?.role === 'admin');

	let dialog = $state<Dialog>();
	let settings = $state<WifiSettings>();
	let networks = $state<Network[]>([]);
	let scanning = $state(false);
	let ssid = $state('');
	let password = $state('');
	let error = $state('');
	let busy = $state(false);
	/** After saving: the device is trying the new network. */
	let pending = $state<{ ssid: string; timeout: number }>();

	const picked = $derived(networks.find((n) => n.ssid === ssid));
	const open = $derived(picked?.auth === 'open');

	async function edit() {
		dialog?.open();
		error = '';
		password = '';
		try {
			settings = await api<WifiSettings>('/api/wifi');
			ssid = settings.ssid;
		} catch (e) {
			error = errorMessage(e);
		}
		scan();
	}

	async function scan() {
		scanning = true;
		try {
			networks = (await api<{ networks: Network[] }>('/api/wifi/scan')).networks;
		} catch (e) {
			error = errorMessage(e);
		} finally {
			scanning = false;
		}
	}

	async function save(ev: SubmitEvent) {
		ev.preventDefault();
		const what =
			ssid === settings?.ssid
				? `Reconnect to “${ssid}” with this password?`
				: `Switch to “${ssid}”?`;
		const ok = await showConfirm(
			'Change Wi-Fi network',
			`${what} The connection to this page drops for a moment.`,
			{
				action: ssid === settings?.ssid ? 'Reconnect' : 'Switch'
			}
		);
		if (!ok) return;
		busy = true;
		error = '';
		try {
			const res = await api<{ timeout: number }>('/api/wifi', { body: { ssid, password } });
			pending = { ssid, timeout: res.timeout };
			dialog?.close();
		} catch (e) {
			error = errorMessage(e);
		} finally {
			busy = false;
		}
	}

	// While the device tries the new network: ask until it answers again with the outcome (it does
	// when it stays on this network – same network, new password – or went back to the previous one).
	$effect(() => {
		if (!pending) return;
		const timer = setInterval(async () => {
			const now = await api<WifiSettings>('/api/wifi').catch(() => undefined);
			if (now && now.switch.state !== 'connecting') {
				settings = now;
				pending = undefined;
			}
		}, 3000);
		return () => clearInterval(timer);
	});

	const bars = (rssi: number) =>
		rssi >= -55 ? '▂▄▆█' : rssi >= -67 ? '▂▄▆' : rssi >= -78 ? '▂▄' : '▂';
</script>

<Panel title="Wi-Fi">
	{#snippet badge()}
		{#if isAdmin}
			<Button variant="link" onclick={edit}>Change</Button>
		{/if}
	{/snippet}

	{#if pending}
		<Alert tone="info">
			Trying “{pending.ssid}” – the device gets a new address there, or returns within {pending.timeout}
			s.
		</Alert>
	{/if}

	{#if status.data}
		{@const w = status.data}
		<DataList>
			{#if w.connected}
				<dt>Network</dt>
				<dd>{w.ssid}</dd>
				<dt>Signal</dt>
				<dd>{w.rssi} dBm</dd>
				<dt>Channel</dt>
				<dd>{w.channel}</dd>
				<dt>IPv4</dt>
				<dd>{w.ip}</dd>
				<dt>IPv6</dt>
				<dd>
					{#each w.ip6 ?? [] as ip (ip)}<div>{ip}</div>{/each}
				</dd>
			{:else}
				<dt>Status</dt>
				<dd class="text-err">disconnected</dd>
			{/if}
			<dt>MAC</dt>
			<dd>{w.mac}</dd>
		</DataList>
		{#if settings?.switch.state === 'reverted' && !pending}
			<Alert>Couldn’t connect to “{settings.switch.ssid}” – still on the previous network.</Alert>
		{:else if settings?.switch.state === 'connected' && !pending}
			<p class="mt-2 text-sm text-ok">Connected to “{settings.switch.ssid}”.</p>
		{/if}
	{:else if status.error}
		<p class="text-err">{status.error}</p>
	{:else}
		<p class="text-muted">Loading…</p>
	{/if}
</Panel>

<Dialog bind:this={dialog} width={460}>
	<form class="grid gap-2 [&_label]:m-0" onsubmit={save}>
		<h2 class="m-0 text-md">Change Wi-Fi network</h2>
		<Input
			label="Network {scanning ? '(searching…)' : ''}"
			bind:value={ssid}
			list="wifi-networks"
			required
			maxlength={32}
			autocomplete="off"
		/>
		<datalist id="wifi-networks">
			{#each networks as n (n.ssid)}
				<option value={n.ssid}>{bars(n.rssi)} {n.auth} · channel {n.channel}</option>
			{/each}
		</datalist>
		{#if networks.length}
			<div class="flex flex-wrap gap-1.5">
				{#each networks.slice(0, 8) as n (n.ssid)}
					<Chip
						pressed={n.ssid === ssid}
						title="{n.rssi} dBm · {n.auth} · channel {n.channel}"
						onclick={() => (ssid = n.ssid)}
					>
						<span class="text-[10px] tracking-[-1px] opacity-70">{bars(n.rssi)}</span>
						{n.ssid}
					</Chip>
				{/each}
			</div>
		{/if}
		{#if !open}
			<PasswordInput
				label="Password"
				bind:value={password}
				minlength={8}
				maxlength={63}
				required={picked !== undefined}
				autocomplete="new-password"
			/>
		{/if}
		{#if error}<Alert>{error}</Alert>{/if}
		<div class="flex flex-wrap items-center gap-2 justify-end">
			<Button onclick={() => dialog?.close()}>Cancel</Button>
			<Button onclick={scan} disabled={scanning}>Search again</Button>
			<Button type="submit" variant="primary" disabled={busy || !ssid}>Connect</Button>
		</div>
	</form>
</Dialog>
