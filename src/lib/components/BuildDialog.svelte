<!--
	Build & flash, as a dialog over the configurator: start a build of the configuration being
	edited, watch it, then flash it over USB or OTA. Open with `bind:this={d}` → `d.open()`.
-->
<script lang="ts">
	import X from '@lucide/svelte/icons/x';
	import { startBuild } from '#lib/api/builds.remote.ts';
	import { errorMessage } from '#lib/errors.ts';
	import type { GeneratedProject, ProjectConfig } from '#lib/device/types.ts';
	import { Alert, Button, Dialog } from '#lib/device/device-ui/ui/index.ts';
	import BuildLog from './BuildLog.svelte';
	import BuildOutdated from './BuildOutdated.svelte';
	import BuildProgress from './BuildProgress.svelte';
	import CodeViewer from './CodeViewer.svelte';
	import FlashPanel from './FlashPanel.svelte';

	let {
		config,
		projectId,
		buildId = $bindable(),
		currentHash,
		issueCount,
		generated,
		deviceAddress,
		onfix
	}: {
		/** The configuration being edited (a plain copy). */
		config: ProjectConfig;
		projectId?: string;
		/** The build shown (the latest one of the device, or the one started here). */
		buildId: string | null;
		/** `projectHash` of `config`. */
		currentHash: string;
		/** Issues of the configuration: building needs none. */
		issueCount: number;
		/** The generated code, `null` while there are issues. */
		generated: GeneratedProject[] | null;
		/** Last known address of the device's web interface (pre-fills OTA). */
		deviceAddress?: string | null;
		/** Go fix the issues (closes the dialog). */
		onfix: () => void;
	} = $props();

	let dialog = $state<ReturnType<typeof Dialog>>();
	let starting = $state(false);
	let error = $state('');
	let codeDialog = $state<ReturnType<typeof Dialog>>();
	let logDialog = $state<ReturnType<typeof BuildLog>>();

	export function open() {
		dialog?.open();
	}
	export function close() {
		dialog?.close();
	}

	async function build() {
		error = '';
		starting = true;
		try {
			buildId = (await startBuild({ config, projectId })).id;
		} catch (err) {
			error = errorMessage(err);
		} finally {
			starting = false;
		}
	}

	const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
</script>

{#snippet loadingBuild()}
	<p class="m-0 text-muted">Loading build…</p>
{/snippet}

{#snippet buildLoadFailed(err: unknown, reset: () => void)}
	<Alert>Could not load build: {(err as Error)?.message}</Alert>
	<Button onclick={reset}>Retry</Button>
{/snippet}

<Dialog bind:this={dialog} width={960}>
	<div class="grid grid-cols-[minmax(0,1fr)] gap-4">
		<header class="flex items-center justify-between gap-3">
			<h2 class="m-0 text-lg">Build &amp; flash</h2>
			<Button variant="link" icon aria-label="Close" onclick={close}><X size={18} /></Button>
		</header>

		<div class="flex flex-wrap items-center gap-2">
			<Button variant="primary" onclick={build} disabled={starting || issueCount > 0}>
				{starting ? 'Starting…' : buildId ? 'Run build' : 'Build firmware'}
			</Button>
			{#if issueCount}
				<span class="text-err">
					Fix {plural(issueCount, 'issue')} in
					<Button variant="link" onclick={onfix}>Compose</Button> first.
				</span>
			{/if}
			<span class="ml-auto flex gap-4">
				<Button
					variant="link"
					disabled={!generated}
					title={generated ? undefined : 'Fix the configuration first'}
					onclick={() => codeDialog?.open()}>Generated code</Button
				>
				<Button
					variant="link"
					disabled={!buildId}
					title={buildId ? undefined : 'Build the firmware first'}
					onclick={() => logDialog?.open()}>Build log</Button
				>
			</span>
		</div>
		{#if error}<Alert>{error}</Alert>{/if}

		{#if buildId}
			<svelte:boundary pending={loadingBuild} failed={buildLoadFailed}>
				<BuildOutdated {buildId} {currentHash} />
				<BuildProgress {buildId} logButton={false}>
					{#snippet flash(chipId)}
						<FlashPanel buildId={buildId!} {chipId} {deviceAddress} />
					{/snippet}
				</BuildProgress>
				<BuildLog bind:this={logDialog} {buildId} />
			</svelte:boundary>
		{:else}
			<p class="m-0 text-muted">
				The firmware is compiled on the server, which takes a few minutes. Then flash each device
				over USB right here, or over the air if it already runs the firmware.
			</p>
		{/if}
	</div>
</Dialog>

<!-- Over Build & flash (modal dialogs stack). -->
<Dialog bind:this={codeDialog} width={1100}>
	<div class="grid grid-cols-[minmax(0,1fr)] gap-4">
		<header class="flex items-center justify-between gap-3">
			<h2 class="m-0 text-lg">Generated code</h2>
			<Button variant="link" icon aria-label="Close" onclick={() => codeDialog?.close()}
				><X size={18} /></Button
			>
		</header>
		{#if generated}
			<CodeViewer projects={generated} name={config.name} />
		{:else}
			<p class="m-0 text-muted">Fix the configuration first.</p>
		{/if}
	</div>
</Dialog>
