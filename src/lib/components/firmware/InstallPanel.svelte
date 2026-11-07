<!-- The Firmware tab of a device: which firmware it runs, and installing its builds – over USB, or released for the device to pull (directly or through its hub) -->
<script lang="ts">
	import Download from '@lucide/svelte/icons/download';
	import Radio from '@lucide/svelte/icons/radio';
	import Usb from '@lucide/svelte/icons/usb';
	import { resolve } from '$app/paths';
	import type { DeployMethod } from '#lib/types.ts';
	import { buildState, listBuilds } from '#lib/remote/builds.remote.ts';
	import { deploy, deployments, cancelDeployment } from '#lib/remote/deploy.remote.ts';
	import { resolve as resolveConfig } from '#lib/core/engine.ts';
	import type { getDevice } from '#lib/remote/devices.remote.ts';
	import { Badge, Button, button, Card, Notice, relativeTime, Select } from '#lib/ui/index.ts';
	import ChangeFirmwareDialog from './ChangeFirmwareDialog.svelte';
	import UsbFlasher from './UsbFlasher.svelte';

	let {
		device,
		blocked,
		dirty
	}: {
		device: Awaited<ReturnType<typeof getDevice>>;
		/** The device's settings have errors: no build with them can be flashed. */
		blocked?: string;
		dirty: boolean;
	} = $props();

	const fw = $derived(resolveConfig(device.firmware.config));
	let changing = $state(false);
	const builds = $derived(
		(await listBuilds(device.firmware.id)).filter((b) => b.status === 'success')
	);
	let picked = $state<string>();
	const selected = $derived(picked ?? builds[0]?.id);
	let error = $state('');
	let usbSlot = $state<string>();

	const running = $derived(device.reported.main?.running);

	const stateTone = {
		pending: 'info',
		downloading: 'info',
		installing: 'info',
		done: 'ok',
		failed: 'err',
		superseded: 'neutral'
	} as const;
	const methodLabel: Record<DeployMethod, string> = {
		usb: 'USB',
		pull: 'over the air',
		hub: 'via hub',
		push: 'push'
	};
	const { updates } = $derived(device.settings);

	async function install(buildId: string, slot: string, method: 'usb' | 'ota') {
		error = '';
		try {
			await deploy({ buildId, deviceId: device.id, slot, method });
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
	}
</script>

<div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
	<div class="grid min-w-0 content-start gap-6">
		{#if error}<Notice tone="err">{error}</Notice>{/if}
		{#if blocked}<Notice tone="err">{blocked}</Notice>{/if}

		<Card title="Firmware" description="What the device runs.">
			{#snippet actions()}
				<Button size="sm" variant="ghost" onclick={() => (changing = true)}>Change…</Button>
			{/snippet}
			<div class="grid gap-3 text-sm">
				<a
					class="text-base font-semibold"
					href={resolve('/(app)/firmware/[id]', { id: device.firmware.id })}
					>{device.firmware.name}</a
				>
				<dl class="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
					<dt class="text-muted">Boards</dt>
					<dd class="m-0">{fw.slots.map((sl) => sl.board.name).join(' + ')}</dd>
					<dt class="text-muted">Features</dt>
					<dd class="m-0">{fw.features.map((f) => f.def.name).join(', ') || 'none'}</dd>
					<dt class="text-muted">Latest build</dt>
					<dd class="m-0">
						{#if builds[0]}Version {builds[0].version} · {relativeTime(
								builds[0].createdAt
							)}{:else}none yet{/if}
					</dd>
					<dt class="text-muted">Running</dt>
					<dd class="m-0">
						{#if running}Version {running}{#if builds[0] && running !== builds[0].version}
								<Badge tone="warn">update available</Badge>{/if}{:else}unknown{/if}
					</dd>
				</dl>
			</div>
		</Card>
		<ChangeFirmwareDialog bind:open={changing} {device} onchange={() => (picked = undefined)} />

		<Card
			title="Install"
			description="Builds of {device.firmware.name}. Build new versions on the firmware’s page."
		>
			{#if !selected}
				<p class="m-0 text-sm text-muted">No finished build of {device.firmware.name} yet.</p>
			{:else}
				{@const s = await buildState(selected)}
				<div class="grid gap-4">
					<div class="flex flex-wrap items-center gap-3">
						<Select
							size="sm"
							class="w-auto"
							aria-label="Build"
							value={selected}
							onchange={(e) => (picked = e.currentTarget.value)}
						>
							{#each builds as b (b.id)}<option value={b.id}
									>Version {b.version} · {relativeTime(b.createdAt)}</option
								>{/each}
						</Select>
						{#if running === s.version}<Badge tone="ok">running</Badge>
						{:else if running}<span class="text-xs text-muted">runs version {running}</span>{/if}
					</div>
					{#each s.slots as a (a.slot)}
						{@const why = !a.ota
							? undefined
							: !updates.pull
								? 'Updates from the app are off for this device.'
								: a.ota === 'hub' && !device.hub
									? 'Assign a hub under Settings.'
									: undefined}
						<div class="rounded-xl border border-border p-4">
							<div class="flex flex-wrap items-center justify-between gap-3">
								<div>
									<div class="font-semibold">
										{a.name}
										{#if a.viaMain}<span
												title="Flash it over USB once – after that the main board installs this firmware over the wires with every update."
												><Badge>updated by the main board</Badge></span
											>{:else if a.flashFirst}<Badge tone="warn">flash first</Badge>{/if}
									</div>
									<div class="text-xs text-muted">
										{a.chip} · {a.flashSize} flash · app {(a.appSize / 1024).toFixed(0)} KB
									</div>
								</div>
								<a
									class={button({ size: 'sm', variant: 'ghost', class: 'no-underline' })}
									href="{resolve('/api/v1/firmware/[build]/[slot]/[file]', {
										build: s.id,
										slot: a.slot,
										file: a.merged
									})}?download{a.config ? `&device=${device.id}` : ''}"
									title={a.config ? 'With this device’s settings' : undefined}
									data-sveltekit-reload><Download size={15} />merged.bin</a
								>
							</div>
							<div class="mt-3 flex flex-wrap items-center gap-2 text-sm">
								<span class="text-muted">Install</span>
								{#if a.ota}
									<Button
										size="sm"
										variant="primary"
										disabled={!!why}
										title={a.ota === 'hub'
											? `Released through ${device.hub?.name ?? 'the hub'}; the device is asked to check now`
											: 'Released for the device; it is asked to check now'}
										onclick={() => install(s.id, a.slot, 'ota')}
										>{#if a.ota === 'hub'}<Radio size={15} />{:else}<Download
												size={15}
											/>{/if}{a.ota === 'hub'
											? `via ${device.hub?.name ?? 'hub'}`
											: 'over the air'}</Button
									>
									<span class="text-muted">or</span>
								{/if}
								<Button
									size="sm"
									variant={usbSlot === a.slot ? 'primary' : 'secondary'}
									onclick={() => (usbSlot = usbSlot === a.slot ? undefined : a.slot)}
									><Usb size={15} />over USB…</Button
								>
							</div>
							{#if why}<p class="m-0 mt-2 text-xs text-muted">Over the air: {why}</p>{/if}
							{#if usbSlot === a.slot}<div class="mt-4 border-t border-border pt-4">
									<UsbFlasher
										buildId={s.id}
										slot={a.slot}
										artifacts={a}
										deviceId={device.id}
										blocked={a.config
											? (blocked ?? (dirty ? 'Saving the settings…' : undefined))
											: undefined}
									/>
								</div>{/if}
						</div>
					{/each}
				</div>
			{/if}
		</Card>
	</div>

	<Card title="Updates" flush>
		{@const list = await deployments(device.id)}
		{#if !list.length}<p class="m-0 px-5 py-4 text-sm text-muted">
				Nothing installed from here yet.
			</p>{/if}
		<ul class="m-0 list-none divide-y divide-border p-0">
			{#each list as d (d.id)}
				<li class="grid gap-1 px-5 py-3 text-sm">
					<div class="flex items-center justify-between gap-2">
						<span class="font-medium"
							>v{d.version}
							<span class="font-normal text-muted">· {d.slot} · {methodLabel[d.method]}</span></span
						>
						<Badge tone={stateTone[d.state]}>{d.state}</Badge>
					</div>
					{#if d.message}<span class="text-xs text-muted">{d.message}</span>{/if}
					<span class="flex items-center justify-between text-xs text-muted">
						{relativeTime(d.updatedAt)}
						{#if ['pending', 'downloading', 'installing'].includes(d.state)}
							<Button
								variant="link"
								size="sm"
								class="text-muted hover:text-fg"
								onclick={() => cancelDeployment(d.id)}>cancel</Button
							>
						{/if}
					</span>
				</li>
			{/each}
		</ul>
	</Card>
</div>
