<!-- The Build tab of a firmware: build, watch the log, download the images. -->
<script lang="ts">
	import Download from '@lucide/svelte/icons/download';
	import FileArchive from '@lucide/svelte/icons/file-archive';
	import Hammer from '@lucide/svelte/icons/hammer';
	import Square from '@lucide/svelte/icons/square';
	import { untrack } from 'svelte';
	import { resolve } from '$app/paths';
	import {
		buildState,
		cancelBuild,
		canBuild,
		listBuilds,
		startBuild
	} from '#lib/remote/builds.remote.ts';
	import { Badge, Button, Card, Notice, button, relativeTime } from '#lib/ui/index.ts';
	import BuildLog from './BuildLog.svelte';

	let {
		firmwareId,
		blocked,
		dirty,
		nextVersion
	}: {
		firmwareId: string;
		blocked?: string;
		dirty: boolean;
		nextVersion: number;
	} = $props();

	const builds = $derived(await listBuilds(firmwareId));
	const runnerReady = $derived(await canBuild());
	let picked = $state<string>();
	const selected = $derived(picked ?? builds[0]?.id);
	let error = $state('');
	let starting = $state(false);

	const statusTone = {
		queued: 'info',
		running: 'info',
		success: 'ok',
		failed: 'err',
		cancelled: 'neutral'
	} as const;

	async function build() {
		error = '';
		starting = true;
		try {
			const { id } = await startBuild(firmwareId);
			picked = id;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			starting = false;
		}
	}

	// The history shows the status too: refresh it when the selected build changes state.
	const status = $derived(selected ? buildState(selected).current?.status : undefined);
	$effect(() => {
		if (status) untrack(() => void listBuilds(firmwareId).refresh());
	});

	const why = $derived(
		blocked ??
			(dirty
				? 'Saving the configuration…'
				: !runnerReady
					? 'No build runner is set up – an admin can add one under Admin → Build runners.'
					: undefined)
	);
</script>

<div class="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
	<div class="grid min-w-0 grid-cols-1 content-start gap-6">
		<Card
			title="Build"
			description="Compiles the firmware of every board once, with ESP-IDF and esp-matter on a build runner. Devices get their own settings at install time; update them in the Devices tab."
		>
			{#snippet actions()}
				<div class="flex gap-2">
					<a
						class={button({ size: 'sm', class: 'no-underline' })}
						href={resolve('/firmware/[id]/source.zip', { id: firmwareId })}
						data-sveltekit-reload
						download
						title="The generated ESP-IDF projects, to build yourself"
					>
						<FileArchive size={15} />Sources
					</a>
					<Button size="sm" variant="primary" disabled={!!why || starting} onclick={build}
						><Hammer size={15} />Build version {nextVersion}</Button
					>
				</div>
			{/snippet}
			{#if why}<Notice tone={blocked ? 'err' : 'info'}>{why}</Notice>{/if}
			{#if error}<div class="mt-3"><Notice tone="err">{error}</Notice></div>{/if}

			{#if selected}
				{@const s = await buildState(selected)}
				<div class={['grid grid-cols-1 gap-4', why || error ? 'mt-4' : '']}>
					<div class="flex flex-wrap items-center gap-3">
						<span class="text-base font-semibold">Version {s.version}</span>
						<Badge tone={statusTone[s.status]}
							>{s.status}{s.status === 'queued' && s.queuePosition
								? ` · #${s.queuePosition}`
								: ''}{s.status === 'running' && s.step ? ` · ${s.step}` : ''}</Badge
						>
						<span class="text-xs text-muted"
							>started {relativeTime(s.createdAt)}{s.finishedAt && s.startedAt
								? ` · took ${Math.round((+s.finishedAt - +s.startedAt) / 1000)} s`
								: ''}</span
						>
						{#if s.status === 'running' || s.status === 'queued'}
							<Button size="sm" variant="ghost" class="ml-auto" onclick={() => cancelBuild(s.id)}
								><Square size={14} />Cancel</Button
							>
						{/if}
					</div>
					{#if s.error}<Notice tone="err">{s.error}</Notice>{/if}
					<BuildLog lines={s.log} live={s.status === 'running'} />

					{#each s.slots as a (a.slot)}
						<div
							class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-4"
						>
							<div>
								<div class="font-semibold">
									{a.name}
									{#if a.viaMain}<span
											title="Flash it over USB once – after that the main board installs this firmware over the wires with every update."
											><Badge>updated by the main board</Badge></span
										>{:else if a.flashFirst}<Badge tone="warn">flash first</Badge>{/if}
								</div>
								<div class="text-xs text-muted">
									{a.chip} · {a.flashSize} flash · app {(a.appSize / 1024).toFixed(0)} KB{a.config
										? ' · without device settings'
										: ''}
								</div>
							</div>
							<div class="flex gap-2">
								<a
									class={button({ size: 'sm', variant: 'ghost', class: 'no-underline' })}
									href="{resolve('/api/v1/firmware/[build]/[slot]/[file]', {
										build: s.id,
										slot: a.slot,
										file: a.merged
									})}?download"
									data-sveltekit-reload><Download size={15} />merged.bin</a
								>
								<a
									class={button({ size: 'sm', variant: 'ghost', class: 'no-underline' })}
									href="{resolve('/api/v1/firmware/[build]/[slot]/[file]', {
										build: s.id,
										slot: a.slot,
										file: a.app
									})}?download"
									data-sveltekit-reload><Download size={15} />app.bin</a
								>
							</div>
						</div>
					{/each}
				</div>
			{:else}
				<p class="m-0 text-sm text-muted">No builds yet.</p>
			{/if}
		</Card>
	</div>

	<Card title="History" flush>
		<ul class="m-0 list-none divide-y divide-border p-0">
			{#each builds as b (b.id)}
				<li>
					<button
						type="button"
						onclick={() => (picked = b.id)}
						class={[
							'flex w-full items-center justify-between gap-2 px-5 py-2.5 text-left text-sm hover:bg-surface-2',
							b.id === selected && 'bg-accent-soft/50'
						]}
					>
						<span class="font-medium">Version {b.version}</span>
						<span class="flex items-center gap-2 text-xs text-muted"
							>{relativeTime(b.createdAt)}
							<Badge tone={statusTone[b.status]}>{b.status}</Badge></span
						>
					</button>
				</li>
			{:else}
				<li class="px-5 py-4 text-sm text-muted">No builds yet.</li>
			{/each}
		</ul>
	</Card>
</div>
