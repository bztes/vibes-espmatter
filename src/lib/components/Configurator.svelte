<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import Check from '@lucide/svelte/icons/check';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import EllipsisVertical from '@lucide/svelte/icons/ellipsis-vertical';
	import Hammer from '@lucide/svelte/icons/hammer';
	import Save from '@lucide/svelte/icons/save';
	import Terminal from '@lucide/svelte/icons/terminal';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import X from '@lucide/svelte/icons/x';
	import { boards } from '#lib/device/registry.ts';
	import {
		MAX_CHIPS,
		addFeature,
		changeBoard,
		chipBoard,
		chipFeatures,
		chipServices,
		featuresDroppedBy,
		generateProject,
		newChip,
		normalizeProject,
		projectHash,
		requiredBy,
		templateName,
		validateProject,
		wiring,
		type Issue
	} from '#lib/device/generator.ts';
	import { configuratorEditors, configuratorTabs } from '#lib/device/features/core/services.ts';
	import type { ChipConfig, ProjectConfig } from '#lib/device/types.ts';
	import {
		deleteProject,
		listProjectBuilds,
		saveProject,
		setDeviceAddress
	} from '#lib/api/projects.remote.ts';
	import { getUser } from '#lib/api/auth.remote.ts';
	import { clearDraft, readDraft, writeDraft } from '#lib/draft.ts';
	import { errorMessage } from '#lib/errors.ts';
	import WiringDiagram from './WiringDiagram.svelte';
	import DependencyGraph from './DependencyGraph.svelte';
	import BuildStatusText from './BuildStatusText.svelte';
	import BuildDialog from './BuildDialog.svelte';
	import SerialMonitor from './SerialMonitor.svelte';
	import {
		Alert,
		Button,
		Dialog,
		Menu,
		Panel,
		Segmented,
		Select,
		showConfirm,
		TitleInput
	} from '#lib/device/device-ui/ui/index.ts';
	import DeviceAddress from './DeviceAddress.svelte';
	import AddFeatureDialog from './AddFeatureDialog.svelte';

	let {
		initial,
		projectId,
		keepDraft = false,
		lastAddress,
		lastSeenAt
	}: {
		initial: ProjectConfig;
		projectId?: string;
		/** Keep the unsaved edits as the draft (new devices only, see `#lib/draft.ts`). */
		keepDraft?: boolean;
		/** Where the device's web interface was last seen. */
		lastAddress?: string | null;
		lastSeenAt?: Date | null;
	} = $props();

	// svelte-ignore state_referenced_locally
	let project = $state(normalizeProject(structuredClone(initial)));
	/** The name before editing, restored if the field is left empty. */
	let lastName = '';
	let draftLoaded = false;

	onMount(() => {
		// A saved device continues with its latest build.
		if (projectId) {
			listProjectBuilds(projectId)
				.then((builds) => (buildId ??= builds[0]?.id ?? null))
				.catch(() => {});
		}
		// Restore an unsaved draft (client only, so SSR and hydration agree).
		if (keepDraft) project = readDraft() ?? project;
		draftLoaded = true;
	});
	// svelte-ignore state_referenced_locally
	let savedJson = $state(JSON.stringify(project));
	/** The firmware build shown in Build & flash (a server job: progress, log, files). */
	let buildId = $state<string | null>(null);
	let buildDialog = $state<ReturnType<typeof BuildDialog>>();
	let serialDialog = $state<ReturnType<typeof Dialog>>();
	/** Compose step: the boards' features as cards, or what relies on what. */
	let composeView = $state<'list' | 'graph'>('list');
	/** The feature tab open on each board (chip id → feature id; the first one if unset). */
	let openFeature = $state<Record<string, string>>({});
	let busy = $state<'save' | null>(null);
	let actionError = $state('');
	let saved = $state(false);

	/** Saving needs an account. */
	const user = $derived(await getUser());
	/** Back here after signing in; a new device's edits are kept as the draft on the start page. */
	const signInHref = $derived(
		`${resolve('/login')}?redirectTo=${encodeURIComponent(projectId ? page.url.pathname + page.url.search : '/')}`
	);

	const issues = $derived(validateProject(project));

	/** A plain copy of the project, shared by everything below that needs one. */
	const snapshot = $derived($state.snapshot(project) as ProjectConfig);
	/** Compared with the build's: tells whether the configuration changed since. */
	/** With the features' defaults applied. */
	const normalized = $derived(normalizeProject(snapshot));
	const currentHash = $derived(projectHash(normalized));
	const generated = $derived(issues.length === 0 ? generateProject(snapshot) : null);
	/** Each chip's services, with what its features registered (settings editors, tabs …), by chip id. */
	const services = $derived(
		Object.fromEntries(normalized.chips.map((c) => [c.id, chipServices(normalized, c.id)]))
	);
	/** The settings editor a feature registered (`configuratorEditors`). */
	const editorOf = (chipId: string, featureId: string) =>
		services[chipId]?.get(configuratorEditors).of(featureId)[0];

	/** Compose, Wire, then the tabs the device's features registered (`configuratorTabs`, e.g. API with the HTTP server). */
	const tabs = $derived.by(() => {
		const added: { id: string; title: string }[] = [];
		for (const chip of normalized.chips)
			for (const v of services[chip.id].get(configuratorTabs).items())
				if (!added.some((t) => t.id === v.id)) added.push({ id: v.id, title: v.title });
		return [{ id: 'compose', title: 'Compose' }, { id: 'wire', title: 'Wire' }, ...added];
	});
	/** The tab is part of the URL (`?view=wire`), so a reload stays on it and Back goes back. */
	const view = $derived.by(() => {
		const id = page.url.searchParams.get('view');
		return tabs.find((t) => t.id === id)?.id ?? 'compose';
	});
	/** Each chip's part of a feature tab: the chips with a feature that registered it. */
	const viewParts = $derived(
		normalized.chips.flatMap((chip) =>
			services[chip.id]
				.get(configuratorTabs)
				.entries()
				.filter((e) => e.item.id === view)
				.map(({ feature, item }) => ({ chip, feature, component: item.component }))
		)
	);
	const wireCount = $derived(wiring(project).length);
	const featureCount = $derived(
		project.chips.reduce((n, c) => n + chipFeatures(c).filter((x) => !x.always).length, 0)
	);
	const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
	const dirty = $derived(JSON.stringify(snapshot) !== savedJson);

	$effect(() => {
		if (keepDraft && draftLoaded) writeDraft(snapshot);
	});

	/** The issues at a feature's settings, by key. */
	function fieldIssues(chip: string, feature: string): Record<string, string> {
		const errors: Record<string, string> = {};
		for (const i of featureIssues(chip, feature)) if (i.field) errors[i.field] ??= i.message;
		return errors;
	}
	const deviceIssues = $derived(issues.filter((i: Issue) => !i.role));
	const featureIssues = (chip: string, feature: string) =>
		issues.filter((i) => i.role === chip && i.feature === feature);

	/** Arrow keys move between a board's feature tabs. */
	function tabKey(e: KeyboardEvent, chip: ChipConfig, features: { id: string }[], index: number) {
		const moves: Record<string, number> = {
			ArrowLeft: index - 1,
			ArrowRight: index + 1,
			Home: 0,
			End: features.length - 1
		};
		if (!(e.key in moves)) return;
		e.preventDefault();
		const next = features[(moves[e.key] + features.length) % features.length];
		openFeature[chip.id] = next.id;
		document.getElementById(`tab-${chip.id}-${next.id}`)?.focus();
	}

	/** Switch the board type; features it doesn't support are removed (after asking). */
	async function selectBoard(chip: ChipConfig, select: HTMLSelectElement) {
		const next = boards.find(select.value);
		if (!next) return;
		const drop = featuresDroppedBy(chip, next);
		if (drop.length) {
			const names = drop.map((f) => f.name).join(', ');
			const ok = await showConfirm(
				'Change board',
				`${next.name} (${next.chip}) doesn’t support: ${names}. Remove them?`,
				{ action: 'Remove', danger: true }
			);
			if (!ok) {
				select.value = chip.board;
				return;
			}
		}
		changeBoard(chip, next);
	}

	/** From the graph to a feature's tab. */
	async function showFeature(chip: string, feature: string) {
		composeView = 'list';
		openFeature[chip] = feature;
		await tick();
		const card = document.getElementById(`card-${chip}-${feature}`);
		card?.scrollIntoView({ behavior: 'smooth', block: 'center' });
		card?.focus({ preventScroll: true });
	}

	const viewQuery = (id: string) => (id === 'compose' ? '' : (`?view=${id}` as const));

	async function go(next: string) {
		if (next === view) return;
		const query = viewQuery(next);
		await goto(
			projectId ? resolve(`/device/[id]${query}`, { id: projectId }) : resolve(`/device${query}`),
			{ reset: false }
		);
	}

	/** Arrow keys move between the view tabs. */
	function viewKey(e: KeyboardEvent, index: number) {
		const moves: Record<string, number> = {
			ArrowLeft: index - 1,
			ArrowRight: index + 1,
			Home: 0,
			End: tabs.length - 1
		};
		if (!(e.key in moves)) return;
		e.preventDefault();
		const next = tabs[(moves[e.key] + tabs.length) % tabs.length];
		go(next.id);
		document.getElementById(`view-${next.id}`)?.focus();
	}

	function openSerial() {
		buildDialog?.close();
		serialDialog?.open();
	}

	/** The device reported its address over serial: remember it on the saved device. */
	function onAddress(url: string) {
		if (projectId) setDeviceAddress({ id: projectId, address: url }).catch(() => {});
	}

	let addDialog = $state<ReturnType<typeof AddFeatureDialog>>();

	function remove(chip: ChipConfig, featureId: string) {
		delete chip.features[featureId];
	}

	function addChip() {
		project.chips.push(newChip(project));
	}

	async function removeChip(chip: ChipConfig) {
		const ok = await showConfirm(
			'Remove board',
			`Remove ${chip.name} and its features from this device?`,
			{
				action: 'Remove',
				danger: true
			}
		);
		if (!ok) return;
		project.chips = project.chips.filter((c) => c !== chip);
	}

	/** Runs an action of the header, showing its error. */
	async function act(kind: typeof busy, action: (config: ProjectConfig) => Promise<void>) {
		actionError = '';
		busy = kind;
		try {
			await action(snapshot);
		} catch (err) {
			actionError = errorMessage(err);
		} finally {
			busy = null;
		}
	}

	const save = () =>
		act('save', async (config) => {
			const { id } = await saveProject({ id: projectId, config });
			savedJson = JSON.stringify(config);
			saved = true;
			setTimeout(() => (saved = false), 2000);
			if (!projectId) {
				if (keepDraft) clearDraft();
				// Stays on the current tab.
				await goto(resolve(`/device/[id]${viewQuery(view)}`, { id }), { reset: false });
			}
		});

	/** The count next to a view's tab. */
	const count = 'min-w-5 rounded-full px-1.5 py-px text-center text-2xs font-semibold';

	async function removeProject() {
		if (!projectId) return;
		const ok = await showConfirm(
			'Delete device',
			`Delete “${project.name}”? Builds stay available via their links.`,
			{ action: 'Delete', danger: true }
		);
		if (!ok) return;
		return act(null, async () => {
			await deleteProject(projectId);
			await goto(resolve('/'));
		});
	}
</script>

<div class="mx-auto grid max-w-[1280px] grid-cols-[minmax(0,1fr)] gap-4 px-4 py-6">
	<header
		class="flex flex-wrap items-end justify-between gap-x-4 gap-y-3 border-b bg-card px-5 py-4"
	>
		<div class="grid min-w-0 flex-[1_1_320px] gap-0.5">
			<span class="text-sm font-medium text-accent">{templateName(project)}</span>
			<TitleInput
				large
				bind:value={project.name}
				maxlength={48}
				required
				aria-label="Device name"
				title="Device name (also its hostname)"
				onfocus={(e) => (lastName = e.currentTarget.value)}
				onblur={() => {
					// A device always has a name: an emptied field gets the previous one back.
					if (!project.name.trim()) project.name = lastName || 'My device';
				}}
			/>
			{#if projectId}
				<DeviceAddress {projectId} address={lastAddress ?? null} {lastSeenAt} />
			{/if}
		</div>
		<div class="flex flex-wrap items-center gap-2">
			{#if saved}<span class="text-sm text-ok">Saved</span>{/if}
			{#if user}
				<Button onclick={save} disabled={busy !== null || (!!projectId && !dirty)}>
					<Save size={16} />
					{busy === 'save' ? 'Saving…' : 'Save'}
				</Button>
			{:else}
				<Button href={signInHref}>Sign in to save</Button>
			{/if}
			<Button variant="primary" onclick={() => buildDialog?.open()}>
				<Hammer size={16} /> Build &amp; flash
			</Button>
			<Menu
				label="More actions"
				icon
				items={[
					{ label: 'Serial monitor', icon: Terminal, onclick: openSerial },
					...(projectId
						? [{ label: 'Delete project', icon: Trash2, danger: true, onclick: removeProject }]
						: [])
				]}
			>
				{#snippet trigger()}<EllipsisVertical size={18} />{/snippet}
			</Menu>
		</div>
	</header>

	{#if actionError}<Alert>{actionError}</Alert>{/if}

	<!-- Compose · Wire · API -->
	<nav
		class="sticky top-0 z-2 -mx-1 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b bg-bg px-1"
	>
		<div class="flex gap-1" role="tablist" aria-label="Views">
			{#each tabs as tab, i (tab.id)}
				{@const active = tab.id === view}
				<button
					type="button"
					role="tab"
					id="view-{tab.id}"
					aria-selected={active}
					aria-controls="panel-{tab.id}"
					tabindex={active ? 0 : -1}
					class={[
						'-mb-px inline-flex cursor-pointer items-center gap-2 rounded-none border-0 border-b-2 bg-transparent px-3.5 py-2.5 text-base',
						active
							? 'border-accent font-semibold'
							: 'border-transparent font-medium text-muted hover:text-inherit'
					]}
					onclick={() => go(tab.id)}
					onkeydown={(e) => viewKey(e, i)}
				>
					{tab.title}
					{#if tab.id === 'compose'}
						{#if issues.length}
							<span class={[count, 'bg-err/15 text-err']}>{issues.length}</span>
						{:else}
							<span class={[count, 'bg-border text-muted']}>{featureCount}</span>
						{/if}
					{:else if tab.id === 'wire' && wireCount}
						<span class={[count, 'bg-border text-muted']}>{wireCount}</span>
					{/if}
				</button>
			{/each}
		</div>
		<span class="m-0 text-xs text-muted max-sm:hidden">
			{#if issues.length}
				<span class="text-err">{plural(issues.length, 'issue')}</span>
			{:else}
				{plural(project.chips.length, 'board')} · {plural(featureCount, 'feature')}
			{/if}
			{#if buildId}
				·
				<svelte:boundary>
					<BuildStatusText {buildId} {currentHash} />
					{#snippet pending()}…{/snippet}
					{#snippet failed()}–{/snippet}
				</svelte:boundary>
			{/if}
		</span>
	</nav>

	<div
		class="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-4"
		role="tabpanel"
		id="panel-{view}"
		aria-labelledby="view-{view}"
	>
		{#if view === 'compose'}
			{#if deviceIssues.length}
				<Alert>
					<ul>
						{#each deviceIssues as issue (issue.message)}<li>{issue.message}</li>{/each}
					</ul>
				</Alert>
			{/if}

			<div class="flex justify-end">
				<Segmented
					label="Layout"
					options={[
						['list', 'Boards'],
						['graph', 'Dependencies']
					]}
					bind:value={composeView}
				/>
			</div>

			{#if composeView === 'graph'}
				<Panel>
					<DependencyGraph {project} {issues} onselect={showFeature} />
				</Panel>
			{/if}

			{#each composeView === 'list' ? project.chips : [] as chip, chipIndex (chip.id)}
				{@const board = chipBoard(chip)}
				{@const chipIssues = issues.filter((i) => i.role === chip.id && !i.feature)}
				{@const features = chipFeatures(chip).sort((a, b) => a.name.localeCompare(b.name))}
				{@const openId = features.some((f) => f.id === openFeature[chip.id])
					? openFeature[chip.id]
					: features[0]?.id}
				<!-- A board: header, then its features (a list beside the open one's settings). -->
				<Panel flush class="overflow-hidden">
					<header
						class="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 border-b bg-bg px-4 py-3 max-[720px]:grid-cols-[minmax(0,1fr)]"
					>
						<span class="m-0 text-xs text-muted">Board {chipIndex + 1}</span>
						<TitleInput bind:value={chip.name} maxlength={32} aria-label="Board name" />
						<div class="flex items-center gap-2 [&_select]:w-auto [&_select]:max-w-full">
							<Select
								aria-label="Board type"
								title={board.description}
								value={board.id}
								onchange={(e) => selectBoard(chip, e.currentTarget)}
							>
								{#each boards.all() as b (b.id)}
									<option value={b.id}>{b.name} ({b.chip})</option>
								{/each}
							</Select>
							{#if project.chips.length > 1}
								<Button
									variant="danger"
									icon
									title="Remove board"
									aria-label="Remove {chip.name}"
									onclick={() => removeChip(chip)}><Trash2 size={16} /></Button
								>
							{/if}
						</div>
						{#each chipIssues as issue (issue.message)}
							<p class="col-span-full m-0 text-xs text-err">{issue.message}</p>
						{/each}
					</header>

					<div class="grid grid-cols-[220px_minmax(0,1fr)] max-[720px]:grid-cols-[minmax(0,1fr)]">
						<!-- Small screens: one tab per feature, wrapping onto more rows when they don't fit. -->
						<div
							class="flex flex-col gap-0.5 border-r p-2 max-[720px]:flex-row max-[720px]:flex-wrap max-[720px]:border-r-0 max-[720px]:border-b"
							role="tablist"
							aria-label="Features of {chip.name}"
						>
							{#each features as feature, i (feature.id)}
								{@const problems = featureIssues(chip.id, feature.id).length}
								{@const active = feature.id === openId}
								<button
									type="button"
									role="tab"
									id="tab-{chip.id}-{feature.id}"
									aria-selected={active}
									aria-controls="card-{chip.id}-{feature.id}"
									tabindex={active ? 0 : -1}
									class={[
										'flex cursor-pointer items-center gap-2 rounded-lg border-0 px-2.5 py-2 text-left text-sm max-[720px]:shrink-0',
										active
											? 'bg-accent/12 font-semibold'
											: 'bg-transparent text-muted hover:bg-bg hover:text-inherit'
									]}
									title={problems ? plural(problems, 'issue') : 'Complete'}
									onclick={() => (openFeature[chip.id] = feature.id)}
									onkeydown={(e) => tabKey(e, chip, features, i)}
								>
									{#if problems}
										<CircleAlert
											size={14}
											class="text-err"
											aria-label={plural(problems, 'issue')}
										/>
									{:else}
										<Check size={14} class="text-ok" aria-label="Complete" />
									{/if}
									<span class="min-w-0 truncate">{feature.name}</span>
								</button>
							{/each}
							<Button
								variant="link"
								class="mt-1 self-start px-2.5 py-2 text-sm"
								onclick={() => addDialog?.open(chip)}
							>
								+ Add feature
							</Button>
						</div>

						<div class="min-w-0 p-4">
							{#each features.filter((f) => f.id === openId) as feature (feature.id)}
								{@const Editor = editorOf(chip.id, feature.id)}
								{@const neededBy = requiredBy(chip, feature.id)}
								<div
									id="card-{chip.id}-{feature.id}"
									role="tabpanel"
									aria-labelledby="tab-{chip.id}-{feature.id}"
									tabindex="-1"
									class="grid gap-2 outline-none"
								>
									<div class="flex items-baseline gap-3 text-xs">
										<h3 class="m-0 flex-1 text-md">{feature.name}</h3>
										{#if !feature.always}
											<Button
												variant="link"
												tone="danger"
												disabled={neededBy.length > 0}
												title={neededBy.length
													? `Needed by ${neededBy.map((f) => f.name).join(', ')}`
													: undefined}
												onclick={() => remove(chip, feature.id)}>Remove</Button
											>
										{/if}
									</div>
									<p class="m-0 text-xs text-muted">{feature.description}</p>
									{#if Editor}
										<Editor
											bind:config={chip.features[feature.id]}
											{board}
											{chip}
											errors={fieldIssues(chip.id, feature.id)}
										/>
									{/if}
									{#each issues.filter((i) => i.role === chip.id && i.feature === feature.id && !i.field) as issue (issue.message)}
										<p class="m-0 text-xs text-err">{issue.message}</p>
									{/each}
								</div>
							{/each}
						</div>
					</div>
				</Panel>
			{/each}

			{#if composeView === 'list' && project.chips.length < MAX_CHIPS}
				<Button class="w-full border-dashed" onclick={addChip}>+ Add board</Button>
			{/if}

			<AddFeatureDialog
				bind:this={addDialog}
				{project}
				onadd={async (chip, id) => {
					addFeature(chip, id);
					openFeature[chip.id] = id;
					await tick();
					const tab = document.getElementById(`tab-${chip.id}-${id}`);
					tab?.scrollIntoView({ block: 'nearest' });
					tab?.focus({ preventScroll: true });
				}}
			/>
		{:else if view === 'wire'}
			<Panel>
				{#if !wireCount}<p class="m-0 text-muted">Nothing to wire – USB power is enough.</p>{/if}
				<WiringDiagram {project} />
			</Panel>
		{:else}
			{#each viewParts as { chip, feature, component: Tab } (chip.id + feature.id)}
				<svelte:boundary>
					<Tab
						project={normalized}
						{chip}
						config={chip.features[feature.id] ?? {}}
						services={services[chip.id]}
						address={lastAddress}
					/>
					{#snippet failed(error)}
						<Alert>Could not show {chip.name}: {errorMessage(error)}</Alert>
					{/snippet}
				</svelte:boundary>
			{/each}
		{/if}
	</div>
</div>

<BuildDialog
	bind:this={buildDialog}
	bind:buildId
	config={snapshot}
	{projectId}
	{currentHash}
	issueCount={issues.length}
	{generated}
	deviceAddress={lastAddress}
	onfix={() => {
		buildDialog?.close();
		go('compose');
	}}
/>

<Dialog bind:this={serialDialog} width={760}>
	<div class="grid gap-3">
		<header class="flex items-center justify-between">
			<h2 class="m-0 text-lg">Serial monitor</h2>
			<Button variant="link" icon aria-label="Close" onclick={() => serialDialog?.close()}>
				<X size={18} />
			</Button>
		</header>
		<p class="m-0 text-xs text-muted">
			Stays connected when closed. Disconnect before flashing over USB – the flasher needs the port.
		</p>
		<SerialMonitor onaddress={onAddress} />
	</div>
</Dialog>
