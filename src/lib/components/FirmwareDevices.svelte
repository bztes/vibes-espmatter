<!-- The devices running a firmware: their update state, updating them over the air, adding one. -->
<script lang="ts">
	import Plus from '@lucide/svelte/icons/plus';
	import Rocket from '@lucide/svelte/icons/rocket';
	import { resolve } from '$app/paths';
	import type { getFirmware } from '#lib/remote/firmware.remote.ts';
	import { firmwareUpdates, rollOut } from '#lib/remote/deploy.remote.ts';
	import { listLocations } from '#lib/remote/locations.remote.ts';
	import { Badge, Button, Card, Notice, relativeTime } from '#lib/ui/index.ts';
	import NewDeviceDialog from './NewDeviceDialog.svelte';

	let { firmware }: { firmware: Awaited<ReturnType<typeof getFirmware>> } = $props();

	const locations = $derived(await listLocations());
	const updates = $derived(firmwareUpdates(firmware.id));
	const latest = $derived(updates.current?.latest);
	let adding = $state<'hub' | 'device'>();
	let busy = $state<string>();
	let error = $state('');
	/** Why a device was skipped by the last update. */
	let skipped = $state<Record<string, string>>({});

	type Update = NonNullable<typeof updates.current>['devices'][number];
	const OPEN = ['pending', 'downloading', 'installing'];

	const stateOf = (id: string) => updates.current?.devices.find((d) => d.id === id);
	const open = (u?: Update) =>
		!!u?.deployment && OPEN.includes(u.deployment.state) && u.running !== u.deployment.version;
	/** Devices an update would reach: not running the newest build, not updating, not blocked. */
	const outdated = $derived(
		(updates.current?.devices ?? []).filter(
			(u) => latest && u.running !== latest.version && !open(u) && !u.blocked
		)
	);

	function status(u?: Update): { tone: 'ok' | 'info' | 'warn' | 'err' | 'neutral'; text: string } {
		if (!u) return { tone: 'neutral', text: '…' };
		const d = u.deployment;
		if (open(u) && d) return { tone: 'info', text: `v${d.version} ${d.state}` };
		if (!latest)
			return { tone: 'neutral', text: u.running ? `runs v${u.running}` : 'no build yet' };
		if (u.running === latest.version) return { tone: 'ok', text: `v${u.running} · up to date` };
		if (d?.state === 'failed' && d.version === latest.version)
			return { tone: 'err', text: `v${d.version} failed` };
		if (!u.running) return { tone: 'neutral', text: 'not installed' };
		return { tone: 'warn', text: `v${u.running} · v${latest.version} available` };
	}

	async function update(deviceIds?: string[]) {
		if (!latest) return;
		error = '';
		busy = deviceIds?.[0] ?? 'all';
		try {
			const results = await rollOut({ buildId: latest.id, deviceIds });
			skipped = Object.fromEntries(
				results.filter((r) => r.skipped).map((r) => [r.deviceId, r.skipped!])
			);
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = undefined;
		}
	}
</script>

<Card
	title="Devices"
	description="Boards running this firmware. Each has its own name, network, Matter codes and per-device settings. Updates go over the air (directly or through the hub); USB flashing is on each device’s page."
	flush
>
	{#snippet actions()}
		<div class="flex gap-2">
			{#if latest && firmware.devices.length}
				<Button
					size="sm"
					disabled={!!busy || !outdated.length}
					title={outdated.length
						? `Install version ${latest.version} on ${outdated.length} device${outdated.length === 1 ? '' : 's'}`
						: 'Every device that can be updated over the air runs the newest build or is updating'}
					onclick={() => update()}
					><Rocket size={15} />{busy === 'all'
						? 'Starting…'
						: `Update all${outdated.length ? ` (${outdated.length})` : ''}`}</Button
				>
			{/if}
			<Button size="sm" variant="primary" onclick={() => (adding = firmware.kind)}
				><Plus size={15} />Add device</Button
			>
		</div>
	{/snippet}
	{#if error}<div class="px-5 pb-3"><Notice tone="err">{error}</Notice></div>{/if}
	<table class="w-full text-sm">
		<tbody>
			{#each firmware.devices as d (d.id)}
				{@const u = stateOf(d.id)}
				{@const s = status(u)}
				{@const message =
					skipped[d.id] ??
					(open(u) || s.tone === 'err'
						? u?.deployment?.message
						: s.tone === 'warn'
							? u?.blocked
							: '')}
				<tr class="border-t border-border align-top first:border-0">
					<td class="py-2.5 pl-5"
						><a class="font-medium" href={resolve('/(app)/devices/[id]', { id: d.id })}>{d.name}</a>
						<div class="text-xs text-muted">
							{locations.find((l) => l.id === d.locationId)?.name ?? ''}
						</div></td
					>
					<td class="py-2.5">
						<Badge tone={s.tone}>{s.text}</Badge>
						{#if message}<div class="mt-1 max-w-sm text-xs text-muted">{message}</div>{/if}
						{#if u?.deployment && !open(u)}<div class="mt-1 text-xs text-muted">
								last update {relativeTime(u.deployment.updatedAt)}
							</div>{/if}
					</td>
					<td class="py-2.5 text-right text-xs text-muted"
						>{d.lastSeenAt ? `seen ${relativeTime(d.lastSeenAt)}` : 'never seen'}</td
					>
					<td class="py-2.5 pr-5 pl-3 text-right">
						{#if latest && u && u.running !== latest.version && !open(u)}
							<Button
								size="sm"
								disabled={!!busy || !!u.blocked}
								title={u.blocked ?? `Install version ${latest.version} over the air`}
								onclick={() => update([d.id])}>{busy === d.id ? 'Starting…' : 'Update'}</Button
							>
						{/if}
					</td>
				</tr>
			{:else}
				<tr>
					<td class="px-5 py-6 text-center text-muted"
						>No devices yet – add one, then flash it over USB from its page.</td
					>
				</tr>
			{/each}
		</tbody>
	</table>
</Card>

<NewDeviceDialog bind:kind={adding} firmwareId={firmware.id} />
