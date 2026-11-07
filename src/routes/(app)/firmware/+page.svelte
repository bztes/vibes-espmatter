<script lang="ts">
	import Cpu from '@lucide/svelte/icons/cpu';
	import Plus from '@lucide/svelte/icons/plus';
	import Router from '@lucide/svelte/icons/router';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { KINDS } from '#lib/core/kinds.ts';
	import { boards } from '#lib/core/registry.ts';
	import { createFirmware, listFirmwares } from '#lib/remote/firmware.remote.ts';
	import { Badge, Button, Dialog, Field, Input, relativeTime } from '#lib/ui/index.ts';

	const firmwares = $derived(await listFirmwares());
	const hubs = $derived(firmwares.filter((f) => f.kind === 'hub'));
	const nodes = $derived(firmwares.filter((f) => f.kind === 'device'));

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
				Boards, features and peripherals – built once, installed on any number of devices.
			</p>
		</div>
		<div class="flex gap-2">
			<Button onclick={() => (creating = 'hub')}><Router size={16} />New hub firmware</Button>
			<Button variant="primary" onclick={() => (creating = 'device')}
				><Plus size={16} />New device firmware</Button
			>
		</div>
	</div>

	{#if !firmwares.length}
		<div
			class="grid place-items-center rounded-card border border-dashed border-border-strong px-6 py-16 text-center"
		>
			<div class="mb-3 grid size-12 place-items-center rounded-xl bg-accent-soft text-accent">
				<Cpu size={24} />
			</div>
			<h2 class="m-0 text-base font-semibold">No firmware yet</h2>
			<p class="mx-auto mt-1 mb-0 max-w-md text-sm text-muted">
				Create one here, or create a device – it gets a new firmware if you don’t pick one.
			</p>
		</div>
	{/if}

	{#each [{ title: 'Hub firmware', list: hubs }, { title: 'Device firmware', list: nodes }] as group (group.title)}
		{#if group.list.length}
			<h2 class="mt-8 mb-3 text-xs font-semibold tracking-wider text-muted uppercase">
				{group.title} <span class="font-normal">· {group.list.length}</span>
			</h2>
			<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
				{#each group.list as f (f.id)}
					<a
						href={resolve('/(app)/firmware/[id]', { id: f.id })}
						class="group flex flex-col gap-4 rounded-card border border-border bg-surface p-5 text-fg no-underline shadow-card transition hover:border-accent/50 hover:shadow-md"
					>
						<div class="flex min-w-0 items-center gap-3">
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
										+ {boardName(f.boards.radio)}{/if}
								</div>
							</div>
						</div>

						<div class="flex flex-wrap gap-1.5">
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

						<div
							class="mt-auto flex items-center justify-between gap-2 border-t border-border pt-3 text-xs text-muted"
						>
							<span>
								{#if f.errors}<Badge tone="err">{f.errors} error{f.errors > 1 ? 's' : ''}</Badge>
								{:else if f.latestBuild}<Badge tone={buildTone(f.latestBuild.status)}
										>v{f.latestBuild.version} {f.latestBuild.status}</Badge
									>
								{:else}<Badge>not built</Badge>{/if}
							</span>
							<span
								>{f.devices} device{f.devices === 1 ? '' : 's'} · changed {relativeTime(
									f.updatedAt
								)}</span
							>
						</div>
					</a>
				{/each}
			</div>
		{/if}
	{/each}
</div>

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
