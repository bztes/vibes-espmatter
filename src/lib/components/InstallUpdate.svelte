<!--
	Install a build on its device from here: the board (`app_updates`) or its hub (`matter_ota`, over Matter)
	asks the app every few minutes, fetches it and reports how far it got (`server/updates.ts`).
-->
<script lang="ts">
	import type { FlashProps } from '#lib/device/configurator.ts';
	import { startUpdate, updateState } from '#lib/api/updates.remote.ts';
	import { Button, Progress } from '#lib/device/device-ui/ui/index.ts';
	import { errorMessage } from '#lib/errors.ts';

	let { buildId, roleId, by }: FlashProps & { by: 'device' | 'hub' } = $props();

	const target = $derived({ buildId, role: roleId });
	const update = $derived(await updateState(target));
	const ours = $derived(update?.buildId === buildId ? update : undefined);
	const running = $derived(!!ours && ours.state !== 'done' && ours.state !== 'failed');

	const STEPS = $derived({
		requested:
			by === 'hub'
				? 'Waiting for the hub – it checks every few minutes.'
				: 'Waiting for the device – it checks every few minutes.',
		downloading:
			by === 'hub'
				? 'The device downloads it through the hub – over Thread this takes several minutes.'
				: 'The device downloads it.',
		installing: 'Installed – the device restarts.',
		done: 'The device runs this build.',
		failed: 'The update failed.'
	});
	const PROGRESS = { requested: 0.1, downloading: 0.5, installing: 0.9, done: 1, failed: 1 };

	let error = $state('');

	async function install() {
		error = '';
		try {
			await startUpdate(target);
			await updateState(target).reconnect();
		} catch (err) {
			error = errorMessage(err);
		}
	}
</script>

<div class="grid gap-2.5">
	<p class="text-muted text-sm">
		{by === 'hub'
			? 'The hub the device is paired with installs it over Matter, also over Thread.'
			: 'The device fetches it from this app over the network.'}
		{#if update && !ours}
			Another build was asked for before (version {update.version}, {update.state}).
		{/if}
	</p>
	{#if ours}
		<Progress value={PROGRESS[ours.state]} error={ours.state === 'failed'} />
		<p
			class="text-sm"
			class:text-err={ours.state === 'failed'}
			class:text-ok={ours.state === 'done'}
		>
			{STEPS[ours.state]}{ours.message ? ` ${ours.message}` : ''}
		</p>
	{/if}
	{#if error}<p class="text-err text-sm">{error}</p>{/if}
	<div class="flex">
		<Button variant="primary" onclick={install} disabled={running}>
			{ours?.state === 'failed' ? 'Try again' : running ? 'Installing…' : 'Install on device'}
		</Button>
	</div>
</div>
