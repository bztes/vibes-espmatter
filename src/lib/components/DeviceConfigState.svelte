<!-- Whether the device runs its current settings, and applying them without a new build. -->
<script lang="ts">
	import Download from '@lucide/svelte/icons/download';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import { resolve } from '$app/paths';
	import { applyDeviceConfig, type getDevice } from '#lib/remote/devices.remote.ts';
	import { Badge, Button, button, Card, Code, Notice } from '#lib/ui/index.ts';

	let {
		device,
		blocked,
		dirty
	}: {
		device: Awaited<ReturnType<typeof getDevice>>;
		/** The settings have errors: nothing can be applied. */
		blocked?: string;
		dirty: boolean;
	} = $props();

	let applying = $state(false);
	let applied = $state('');
	let error = $state('');

	const reportedRev = $derived(device.reported.main?.config);
	const configState = $derived(
		!reportedRev ? 'unknown' : reportedRev === device.configRev ? 'current' : 'outdated'
	);
	const pull = $derived(device.settings.updates.pull);

	async function apply() {
		error = '';
		applied = '';
		applying = true;
		try {
			await applyDeviceConfig(device.id);
			applied = 'Asked the device to check – it restarts with its new settings.';
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			applying = false;
		}
	}
</script>

<Card
	title="Settings on the device"
	description="The values on this page live in a partition of their own on the device – changing them needs no new build."
>
	<div class="grid gap-3">
		<div class="flex flex-wrap items-center gap-2 text-sm">
			{#if dirty}<Badge tone="info">saving…</Badge>
			{:else if configState === 'current'}<Badge tone="ok">up to date</Badge>
			{:else if configState === 'outdated'}<Badge tone="warn">changed since</Badge>
			{:else}<Badge>unknown</Badge>{/if}
			<span class="text-muted">
				{#if configState === 'unknown'}The device hasn’t reported yet – flash it over USB first.
				{:else if configState === 'outdated'}The device runs revision <Code>{reportedRev}</Code>,
					the current one is <Code>{device.configRev}</Code>.{#if pull}
						It picks it up at its next update check.{/if}
				{:else}Revision <Code>{device.configRev}</Code>.{/if}
			</span>
		</div>
		{#if blocked}<Notice tone="err">{blocked}</Notice>{/if}
		{#if error}<Notice tone="err">{error}</Notice>{/if}
		{#if applied}<Notice tone="ok">{applied}</Notice>{/if}
		<div class="flex flex-wrap gap-2">
			{#if pull}
				<Button
					size="sm"
					disabled={!!blocked || dirty || applying || !device.connectedSince}
					title={device.connectedSince
						? 'Ask the device to fetch its settings now'
						: 'Not connected to the app (Remote access) – it picks them up at its next check'}
					onclick={apply}><RefreshCw size={15} />{applying ? 'Asking…' : 'Apply now'}</Button
				>
			{/if}
			<a
				class={button({ size: 'sm', variant: 'ghost', class: 'no-underline' })}
				href="{resolve('/devices/[id]/config.bin', { id: device.id })}?download"
				data-sveltekit-reload><Download size={15} />config.bin</a
			>
		</div>
	</div>
</Card>
