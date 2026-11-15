<script lang="ts">
	import Cpu from '@lucide/svelte/icons/cpu';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Plus from '@lucide/svelte/icons/plus';
	import Router from '@lucide/svelte/icons/router';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { KINDS } from '#lib/core/kinds.ts';
	import { boards } from '#lib/core/registry.ts';
	import { listDevices } from '#lib/remote/devices.remote.ts';
	import { createFirmware, listFirmwares } from '#lib/remote/firmware.remote.ts';
	import { listLocations } from '#lib/remote/locations.remote.ts';
	import LocationDialog from '#lib/components/LocationDialog.svelte';
	import NewDeviceDialog from '#lib/components/NewDeviceDialog.svelte';
	import { Badge, Button, Dialog, Field, Input, relativeTime } from '#lib/ui/index.ts';

	const firmwares = $derived(await listFirmwares());
	const all = $derived(await listDevices());
	const locations = $derived(await listLocations());

	// `?location=<id>`, `?location=none` or nothing (all).
	const selected = $derived.by(() => {
		const id = page.url.searchParams.get('location');
		return id === 'none' || locations.some((l) => l.id === id) ? id : null;
	});
	const current = $derived(locations.find((l) => l.id === selected));
	const devices = $derived(
		selected === null ? all : all.filter((d) => (d.locationId ?? 'none') === selected)
	);
	const homeless = $derived(all.filter((d) => !d.locationId).length);
	const locationTabs = $derived([
		{ id: null, name: 'All', count: all.length },
		...locations.map((l) => ({
			id: l.id,
			name: l.name,
			count: all.filter((d) => d.locationId === l.id).length
		})),
		...(homeless && locations.length ? [{ id: 'none', name: 'No location', count: homeless }] : [])
	]);
	const locationName = (id: string | null) => locations.find((l) => l.id === id)?.name;
	const tabHref = (id: string | null) =>
		id ? `${resolve('/(app)')}?location=${id}` : resolve('/(app)');

	// eslint-disable-next-line svelte/no-navigation-without-resolve -- built with resolve()
	const show = (id: string | null) => goto(tabHref(id));

	const groups = $derived(
		(['hub', 'device'] as const).map((kind) => ({
			title: kind === 'hub' ? 'Hub firmware' : 'Device firmware',
			list: firmwares
				.filter((f) => f.kind === kind)
				.map((f) => ({ ...f, list: devices.filter((d) => d.firmware.id === f.id) }))
		}))
	);

	/** Open location dialog: `new` or the location to edit. */
	let editing = $state<'new' | (typeof locations)[number] | undefined>();
	/** New device of this firmware. */
	let adding = $state<{ kind: 'hub' | 'device'; firmwareId: string }>();

	let creating = $state<'hub' | 'device'>();
	let name = $state('');
	let error = $state('');
	let busy = $state(false);

	const boardName = (id: string) => boards.find(id)?.name ?? id;
	const buildTone = (status?: string) =>
		status === 'success'
			? 'ok'
			: status === 'failed'
				? 'err'
				: status === 'running' || status === 'queued'
					? 'info'
					: 'neutral';
	/** Device firmware state: not installed, outdated, current. */
	const installState = (d: (typeof devices)[number]) =>
		!d.running
			? { tone: 'neutral' as const, text: 'not installed' }
			: d.latest && d.running < d.latest
				? { tone: 'warn' as const, text: `v${d.running} → v${d.latest}` }
				: { tone: 'ok' as const, text: `v${d.running}` };
	const online = (d: (typeof devices)[number]) =>
		d.lastSeenAt && Date.now() - new Date(d.lastSeenAt).getTime() < 3 * 3600_000;

	async function create(e: SubmitEvent) {
		e.preventDefault();
		if (!creating) return;
		busy = true;
		error = '';
		try {
			const { id } = await createFirmware({
				kind: creating,
				name: name.trim() || `${KINDS[creating].name} firmware`
			});
			creating = undefined;
			name = '';
			await goto(resolve('/(app)/firmware/[id]', { id }));
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head><title>Firmware – espmatter studio</title></svelte:head>

<div class="mx-auto max-w-7xl px-4 py-8 sm:px-6">
	<div class="mb-8 flex flex-wrap items-end justify-between gap-4">
		<div>
			<h1 class="m-0 text-2xl font-semibold tracking-tight">Firmware</h1>
			<p class="mt-1 mb-0 text-sm text-muted">
				Build firmware once, install it on any number of devices – each with its own settings.
			</p>
		</div>
		<div class="flex gap-2">
			<Button onclick={() => (creating = 'hub')}><Router size={16} />New hub firmware</Button>
			<Button variant="primary" onclick={() => (creating = 'device')}
				><Plus size={16} />New device firmware</Button
			>
		</div>
	</div>

	{#if all.length || locations.length}
		<div class="mb-2 flex flex-wrap items-center gap-1 border-b border-border">
			{#each locationTabs as tab (tab.id)}
				<!-- eslint-disable svelte/no-navigation-without-resolve -- built with resolve() -->
				<a
					href={tabHref(tab.id)}
					aria-current={tab.id === selected ? 'page' : undefined}
					class={[
						'-mb-px flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium no-underline',
						tab.id === selected
							? 'border-accent text-fg'
							: 'border-transparent text-muted hover:text-fg'
					]}
				>
					{#if tab.id && tab.id !== 'none'}<MapPin size={14} />{/if}
					{tab.name}
					<span class="rounded-full bg-surface-2 px-1.5 text-xs leading-5 text-muted"
						>{tab.count}</span
					>
				</a>
			{/each}
			<div class="ml-auto flex gap-1 pb-1">
				{#if current}
					<Button size="sm" variant="ghost" onclick={() => (editing = current)}
						><Pencil size={14} />Edit {current.name}</Button
					>
				{/if}
				<Button size="sm" variant="ghost" onclick={() => (editing = 'new')}
					><Plus size={14} />Location</Button
				>
			</div>
		</div>
		{#if !locations.length}
			<p class="mt-2 mb-0 text-xs text-muted">
				Devices in several places (home, parents …)? Add a location for each to keep them apart and
				give their new devices the right Wi-Fi.
			</p>
		{/if}
	{/if}

	{#if !firmwares.length}
		<div
			class="grid place-items-center rounded-card border border-dashed border-border-strong px-6 py-16 text-center"
		>
			<div class="mb-3 grid size-12 place-items-center rounded-xl bg-accent-soft text-accent">
				<Cpu size={24} />
			</div>
			<h2 class="m-0 text-base font-semibold">No firmware yet</h2>
			<p class="mx-auto mt-1 mb-5 max-w-md text-sm text-muted">
				Start with a <strong>hub</strong> – it pairs and controls your devices and runs the Thread
				network – or a <strong>device</strong> with peripherals like sensors and switches.
			</p>
			<div class="flex gap-2">
				<Button onclick={() => (creating = 'hub')}>New hub firmware</Button>
				<Button variant="primary" onclick={() => (creating = 'device')}>New device firmware</Button>
			</div>
		</div>
	{/if}

	{#each groups as group (group.title)}
		{#if group.list.length}
			<h2 class="mt-8 mb-3 text-xs font-semibold tracking-wider text-muted uppercase">
				{group.title} <span class="font-normal">· {group.list.length}</span>
			</h2>
			<div class="grid gap-4">
				{#each group.list as f (f.id)}
					<section class="rounded-card border border-border bg-surface shadow-card">
						<div class="grid gap-2 p-4">
							<div class="flex items-center gap-3">
								<a
									href={resolve('/(app)/firmware/[id]', { id: f.id })}
									class="group flex min-w-0 flex-1 items-center gap-3 text-fg no-underline"
								>
									<div
										class={[
											'grid size-10 shrink-0 place-items-center rounded-xl',
											f.kind === 'hub' ? 'bg-accent text-accent-fg' : 'bg-accent-soft text-accent'
										]}
									>
										{#if f.kind === 'hub'}<Router size={20} />{:else}<Cpu size={20} />{/if}
									</div>
									<div class="min-w-0">
										<div class="truncate font-semibold group-hover:text-accent">{f.name}</div>
										<div class="truncate text-xs text-muted">
											{boardName(f.boards.main)}{#if f.boards.radio}
												+ {boardName(f.boards.radio)}{/if} · changed {relativeTime(f.updatedAt)}
										</div>
									</div>
								</a>
								{#if f.errors}<Badge tone="err">{f.errors} error{f.errors > 1 ? 's' : ''}</Badge>
								{:else if f.latestBuild}<Badge tone={buildTone(f.latestBuild.status)}
										>v{f.latestBuild.version} {f.latestBuild.status}</Badge
									>
								{:else}<Badge>not built</Badge>{/if}
								<Button
									size="sm"
									onclick={() => (adding = { kind: f.kind, firmwareId: f.id })}
									aria-label="Add device to {f.name}"><Plus size={14} />Device</Button
								>
							</div>
							<div class="flex flex-wrap gap-1.5 pl-13">
								{#if f.kind === 'device'}
									{#each f.peripherals.slice(0, 4) as s, i (i)}<Badge tone="accent">{s.name}</Badge
										>{/each}
									{#if f.peripherals.length > 4}<Badge>+{f.peripherals.length - 4}</Badge>{/if}
									{#if !f.peripherals.length}<Badge tone="warn">no peripherals</Badge>{/if}
								{/if}
								{#each f.features.filter((x) => f.kind === 'hub' || ['wifi', 'thread'].includes(x)) as x (x)}<Badge
										>{x}</Badge
									>{/each}
							</div>
						</div>

						<div class="border-t border-border bg-bg/50 p-4">
							{#if f.list.length}
								<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
									{#each f.list as d (d.id)}
										<a
											href={resolve('/(app)/devices/[id]', { id: d.id })}
											class="group flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 text-fg no-underline transition hover:border-accent/50 hover:shadow-md"
										>
											<div class="flex items-center justify-between gap-3">
												<div class="truncate font-semibold group-hover:text-accent">{d.name}</div>
												<span
													class={[
														'size-2.5 shrink-0 rounded-full',
														online(d) ? 'bg-ok' : 'bg-border-strong'
													]}
													title={online(d) ? 'Seen recently' : 'Not seen recently'}
												></span>
											</div>
											<div
												class="mt-auto flex flex-wrap items-center justify-between gap-2 text-xs text-muted"
											>
												<span class="flex flex-wrap gap-1.5">
													{#each [installState(d)] as st (st.text)}<Badge tone={st.tone}
															>{st.text}</Badge
														>{/each}
													{#if selected === null && locationName(d.locationId)}<Badge
															><MapPin size={11} />{locationName(d.locationId)}</Badge
														>{/if}
												</span>
												<span
													>{d.lastSeenAt
														? `seen ${relativeTime(d.lastSeenAt)}`
														: 'never seen'}</span
												>
											</div>
										</a>
									{/each}
								</div>
							{:else}
								<p class="m-0 text-sm text-muted">
									No devices {current
										? `in ${current.name}`
										: selected === 'none'
											? 'without a location'
											: ''} yet.
								</p>
							{/if}
						</div>
					</section>
				{/each}
			</div>
		{/if}
	{/each}
</div>

<NewDeviceDialog
	bind:kind={() => adding?.kind, (v) => !v && (adding = undefined)}
	firmwareId={adding?.firmwareId}
	locationId={selected === 'none' ? null : selected}
/>
{#if editing}
	<LocationDialog
		bind:open={() => !!editing, (v) => !v && (editing = undefined)}
		location={editing === 'new' ? undefined : editing}
		onsaved={show}
		ondeleted={() => show(null)}
	/>
{/if}

<Dialog
	bind:open={() => !!creating, (v) => !v && (creating = undefined)}
	title="New {creating === 'hub' ? 'hub' : 'device'} firmware"
>
	<form id="new-firmware" class="grid gap-4" onsubmit={create}>
		<Field
			label="Name"
			id="firmware-name"
			help="E.g. what its devices are: “Room sensor”, “Heat pump”."
			error={error || undefined}
		>
			<!-- svelte-ignore a11y_autofocus -->
			<Input
				id="firmware-name"
				maxlength={48}
				placeholder={creating ? `${KINDS[creating].name} firmware` : ''}
				bind:value={name}
				autofocus
			/>
		</Field>
	</form>
	{#snippet footer()}
		<Button onclick={() => (creating = undefined)}>Cancel</Button>
		<Button variant="primary" type="submit" form="new-firmware" disabled={busy}
			>{busy ? 'Creating…' : 'Create'}</Button
		>
	{/snippet}
</Dialog>
