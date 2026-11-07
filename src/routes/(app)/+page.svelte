<script lang="ts">
	import Cpu from '@lucide/svelte/icons/cpu';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Plus from '@lucide/svelte/icons/plus';
	import Router from '@lucide/svelte/icons/router';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { boards, peripherals } from '#lib/core/registry.ts';
	import { listDevices } from '#lib/remote/devices.remote.ts';
	import { listLocations } from '#lib/remote/locations.remote.ts';
	import LocationDialog from '#lib/components/LocationDialog.svelte';
	import NewDeviceDialog from '#lib/components/NewDeviceDialog.svelte';
	import { Badge, Button, PluginIcon, relativeTime } from '#lib/ui/index.ts';

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

	/** Open location dialog: `new` or the location to edit. */
	let editing = $state<'new' | (typeof locations)[number] | undefined>();
	const hubs = $derived(devices.filter((d) => d.kind === 'hub'));
	const nodes = $derived(devices.filter((d) => d.kind === 'device'));
	let creating = $state<'hub' | 'device' | undefined>();

	const boardName = (id: string) => boards.find(id)?.name ?? id;
	/** Device firmware state: errors, not installed, outdated, current. */
	const installState = (d: (typeof devices)[number]) =>
		d.errors
			? { tone: 'err' as const, text: `${d.errors} error${d.errors > 1 ? 's' : ''}` }
			: !d.running
				? { tone: 'neutral' as const, text: 'not installed' }
				: d.latest && d.running < d.latest
					? { tone: 'warn' as const, text: `v${d.running} → v${d.latest}` }
					: d.configOutdated
						? { tone: 'warn' as const, text: 'settings changed' }
						: { tone: 'ok' as const, text: `v${d.running}` };
	const online = (d: (typeof devices)[number]) =>
		d.lastSeenAt && Date.now() - new Date(d.lastSeenAt).getTime() < 3 * 3600_000;
</script>

<svelte:head><title>Devices – espmatter studio</title></svelte:head>

<div class="mx-auto max-w-7xl px-4 py-8 sm:px-6">
	<div class="mb-8 flex flex-wrap items-end justify-between gap-4">
		<div>
			<h1 class="m-0 text-2xl font-semibold tracking-tight">Devices</h1>
			<p class="mt-1 mb-0 text-sm text-muted">
				Build firmware once, install it on any number of hubs and Matter devices – each with its own
				settings.
			</p>
		</div>
		<div class="flex gap-2">
			<Button onclick={() => (creating = 'hub')}><Router size={16} />New hub</Button>
			<Button variant="primary" onclick={() => (creating = 'device')}
				><Plus size={16} />New device</Button
			>
		</div>
	</div>

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
	{#if !locations.length && all.length}
		<p class="mt-2 mb-0 text-xs text-muted">
			Devices in several places (home, parents …)? Add a location for each to keep them apart and
			give their new devices the right Wi-Fi.
		</p>
	{/if}

	{#if !all.length}
		<div
			class="grid place-items-center rounded-card border border-dashed border-border-strong px-6 py-16 text-center"
		>
			<div class="mb-3 grid size-12 place-items-center rounded-xl bg-accent-soft text-accent">
				<Cpu size={24} />
			</div>
			<h2 class="m-0 text-base font-semibold">No devices yet</h2>
			<p class="mx-auto mt-1 mb-5 max-w-md text-sm text-muted">
				Start with a <strong>hub</strong> – it pairs and controls your devices and runs the Thread
				network – or a <strong>device</strong> with peripherals like sensors and switches.
			</p>
			<div class="flex gap-2">
				<Button onclick={() => (creating = 'hub')}>New hub</Button>
				<Button variant="primary" onclick={() => (creating = 'device')}>New device</Button>
			</div>
		</div>
	{/if}

	{#if all.length && !devices.length}
		<div
			class="mt-6 rounded-card border border-dashed border-border-strong px-6 py-10 text-center text-sm text-muted"
		>
			No devices {current ? `in ${current.name}` : 'without a location'} yet.
		</div>
	{/if}

	{#each [{ title: 'Hubs', list: hubs }, { title: 'Matter devices', list: nodes }] as group (group.title)}
		{#if group.list.length}
			<h2 class="mt-8 mb-3 text-xs font-semibold tracking-wider text-muted uppercase">
				{group.title} <span class="font-normal">· {group.list.length}</span>
			</h2>
			<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
				{#each group.list as d (d.id)}
					<a
						href={resolve('/(app)/devices/[id]', { id: d.id })}
						class="group flex flex-col gap-4 rounded-card border border-border bg-surface p-5 text-fg no-underline shadow-card transition hover:border-accent/50 hover:shadow-md"
					>
						<div class="flex items-start justify-between gap-3">
							<div class="flex min-w-0 items-center gap-3">
								<div
									class={[
										'grid size-10 shrink-0 place-items-center rounded-xl',
										d.kind === 'hub' ? 'bg-accent text-accent-fg' : 'bg-accent-soft text-accent'
									]}
								>
									{#if d.kind === 'hub'}<Router size={20} />{:else}<PluginIcon
											name={peripherals.find(d.peripherals[0]?.peripheral ?? '')?.icon}
											size={20}
										/>{/if}
								</div>
								<div class="min-w-0">
									<div class="truncate font-semibold group-hover:text-accent">{d.name}</div>
									<div class="truncate text-xs text-muted">
										{d.firmware.name} · {boardName(d.boards.main)}{#if d.boards.radio}
											+ {boardName(d.boards.radio)}{/if}
									</div>
								</div>
							</div>
							<span
								class={[
									'mt-1.5 size-2.5 shrink-0 rounded-full',
									online(d) ? 'bg-ok' : 'bg-border-strong'
								]}
								title={online(d) ? 'Seen recently' : 'Not seen recently'}
							></span>
						</div>

						<div class="flex flex-wrap gap-1.5">
							{#if selected === null && locationName(d.locationId)}<Badge
									><MapPin size={11} />{locationName(d.locationId)}</Badge
								>{/if}
							{#if d.kind === 'device'}
								{#each d.peripherals.slice(0, 4) as s, i (i)}<Badge tone="accent">{s.name}</Badge
									>{/each}
								{#if d.peripherals.length > 4}<Badge>+{d.peripherals.length - 4}</Badge>{/if}
								{#if !d.peripherals.length}<Badge tone="warn">no peripherals</Badge>{/if}
							{/if}
							{#each d.features.filter((f) => d.kind === 'hub' || ['wifi', 'thread'].includes(f)) as f (f)}<Badge
									>{f}</Badge
								>{/each}
						</div>

						<div
							class="mt-auto flex items-center justify-between gap-2 border-t border-border pt-3 text-xs text-muted"
						>
							<span>
								{#each [installState(d)] as st (st.text)}<Badge tone={st.tone}>{st.text}</Badge
									>{/each}
							</span>
							<span>{d.lastSeenAt ? `seen ${relativeTime(d.lastSeenAt)}` : 'never seen'}</span>
						</div>
					</a>
				{/each}
			</div>
		{/if}
	{/each}
</div>

<NewDeviceDialog bind:kind={creating} locationId={selected === 'none' ? null : selected} />
{#if editing}
	<LocationDialog
		bind:open={() => !!editing, (v) => !v && (editing = undefined)}
		location={editing === 'new' ? undefined : editing}
		onsaved={show}
		ondeleted={() => show(null)}
	/>
{/if}
