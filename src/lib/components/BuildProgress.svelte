<!--
	Status and log of a firmware build, and a card per device with its progress; once a device's
	firmware is ready, its card shows `flash`. `done` is shown once the whole build succeeded.
	Without `logButton` the caller opens the log (`BuildLog.svelte`) itself.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { buildState, cancel } from '#lib/api/builds.remote.ts';
	import { boards } from '#lib/device/registry.ts';
	import type { BuildStatus } from '#lib/build-types.ts';
	import { Alert, Badge, Button, Panel, StepNumber } from '#lib/device/device-ui/ui/index.ts';
	import BuildLog from './BuildLog.svelte';

	let {
		buildId,
		logButton = true,
		flash,
		done
	}: {
		buildId: string;
		logButton?: boolean;
		flash?: Snippet<[chipId: string]>;
		done?: Snippet;
	} = $props();

	const build = $derived(await buildState(buildId));
	/** Chips in flash order. */
	const roles = $derived(build.chips);

	let log = $state<ReturnType<typeof BuildLog>>();

	const tone: Record<BuildStatus, 'default' | 'accent' | 'ok' | 'err'> = {
		queued: 'default',
		running: 'accent',
		success: 'ok',
		failed: 'err',
		cancelled: 'default'
	};

	function duration(ms?: number) {
		if (!ms) return '';
		const s = Math.round(ms / 1000);
		return s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`;
	}
</script>

<div class="grid grid-cols-[minmax(0,1fr)] gap-4">
	<div class="flex flex-wrap items-center gap-2">
		<Badge tone={tone[build.status]}>{build.status}</Badge>
		<span class="text-muted">
			Build <code>{build.id.slice(0, 8)}</code> ·
			{build.finishedAt
				? `finished ${build.finishedAt.toLocaleString()}`
				: `started ${build.createdAt.toLocaleString()}`}
		</span>
		{#if build.status === 'queued' && build.queuePosition > 0}
			<span class="text-muted">{build.queuePosition} ahead</span>
		{/if}
		{#if build.status === 'queued' || build.status === 'running'}
			<Button variant="danger" class="ml-auto" onclick={() => cancel(build.id)}>Cancel</Button>
		{/if}
	</div>

	{#if build.error}<Alert>{build.error}</Alert>{/if}

	<ol class="m-0 grid grid-cols-[minmax(0,1fr)] list-none gap-3 p-0">
		{#each roles as role, i (role.id)}
			{@const state = build.roles[role.id]}
			{@const ready = state?.status === 'success' && !!state.artifacts}
			<li>
				<Panel class="grid grid-cols-[minmax(0,1fr)] gap-3">
					<div class="flex items-center gap-3">
						<StepNumber n={i + 1} done={ready} />
						<div class="grid min-w-0 flex-1">
							<strong>{role.name}</strong>
							<span class="m-0 truncate text-xs text-muted"
								>{boards.find(state?.board)?.name} · {state?.target}</span
							>
						</div>
						<Badge tone={tone[state?.status ?? 'queued']}>
							{state?.status === 'running' ? 'compiling…' : state?.status}
							{duration(state?.durationMs)}
						</Badge>
					</div>
					{#if ready && flash}{@render flash(role.id)}{/if}
				</Panel>
			</li>
		{/each}
	</ol>

	{#if logButton || build.status === 'queued' || build.status === 'running'}
		<div class="flex flex-wrap items-center gap-2">
			{#if logButton}
				<Button onclick={() => log?.open()}>Build log</Button>
				<BuildLog bind:this={log} {buildId} />
			{/if}
			{#if build.log.length}
				<span class="min-w-0 flex-1 truncate font-mono text-2xs text-muted">{build.log.at(-1)}</span
				>
			{/if}
		</div>
	{/if}

	{#if build.status === 'success'}{@render done?.()}{/if}
</div>
