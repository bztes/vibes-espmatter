<!--
  Scenes of the account and those granted to it (admins: everyone's), set by the hub (espm_scenes.cpp): how several
  endpoints should be, applied at once. Listed, made and edited here; activated from ScenesBar on the dashboard.
  New members start from the endpoint's current state.
-->
<script lang="ts">
	import Plus from '@lucide/svelte/icons/plus';
	import {
		api,
		Badge,
		Button,
		Checkbox,
		Dialog,
		errorText,
		Input,
		Notice,
		Poll,
		Select,
		Toggle
	} from '#sdk/device-ui';
	import { CLUSTER, hasCluster, type Node } from './matter';
	import {
		endpointName,
		levelToPercent,
		percentToLevel,
		splitKey,
		switchables,
		type Member,
		type Scene
	} from './automations';

	const MAX_MEMBERS = 12;

	const scenes = new Poll<{ scenes: Scene[]; max: number }>('/api/v1/controller/scenes', 15000);
	const nodes = new Poll<{ nodes: Node[] }>('/api/v1/controller/nodes', 30000);
	const targets = $derived(switchables(nodes.current?.nodes ?? []));

	/** A member in the form: brightness in %, color in mireds; `undefined`: left as it is. */
	interface Row {
		key: string;
		on: boolean;
		brightness?: number;
		mireds?: number;
	}

	let open = $state(false);
	let editing = $state<Scene>();
	let confirmDelete = $state(false);
	let name = $state('');
	let rows = $state<Row[]>([]);
	let adding = $state('');
	let busy = $state(false);
	let status = $state<{ tone: 'ok' | 'err' | 'info'; text: string }>();

	const epOf = (key: string) => targets.find((t) => t.key === key)?.ep;
	const unused = $derived(targets.filter((t) => !rows.some((r) => r.key === t.key)));

	/** Open the dialog for a new scene, or to edit one. */
	function edit(scene?: Scene) {
		editing = scene;
		name = scene?.name ?? '';
		rows = (scene?.members ?? []).map((m) => ({
			key: `${m.node}:${m.endpoint}`,
			on: m.on,
			brightness: m.level ? levelToPercent(m.level) : undefined,
			mireds: m.colorTemperature
		}));
		adding = '';
		confirmDelete = false;
		status = undefined;
		open = true;
	}

	/** Add an endpoint as it is now. */
	function add(key: string) {
		const ep = epOf(key);
		if (!ep) return;
		rows.push({
			key,
			on: ep.on ?? true,
			brightness: hasCluster(ep, CLUSTER.levelControl)
				? levelToPercent(ep.level ?? 254)
				: undefined,
			mireds: hasCluster(ep, CLUSTER.colorControl) ? (ep.colorTemperature ?? undefined) : undefined
		});
		adding = '';
	}

	function members(): Member[] {
		return rows.map((r) => {
			const [node, endpoint] = splitKey(r.key);
			const m: Member = { node, endpoint, on: r.on };
			if (r.on && r.brightness !== undefined) m.level = percentToLevel(r.brightness);
			if (r.on && r.mireds !== undefined) m.colorTemperature = r.mireds;
			return m;
		});
	}

	const list = $derived(scenes.current?.scenes ?? []);
	const full = $derived(list.length >= (scenes.current?.max ?? 16));

	async function run(fn: () => Promise<unknown>, done?: string) {
		busy = true;
		status = undefined;
		try {
			await fn();
			if (done) status = { tone: 'ok', text: done };
			await scenes.refresh();
		} catch (e) {
			status = { tone: 'err', text: errorText(e) };
		} finally {
			busy = false;
		}
	}

	function save() {
		const id = editing?.id;
		const body = { name: name.trim(), members: members() };
		void run(
			async () => {
				if (id) await api(`/api/v1/controller/scenes/${id}`, { method: 'PUT', body });
				else await api('/api/v1/controller/scenes', { body });
				open = false;
			},
			id ? 'Scene saved.' : 'Scene added.'
		);
	}

	const remove = (scene: Scene) =>
		run(async () => {
			await api(`/api/v1/controller/scenes/${scene.id}`, { method: 'DELETE' });
			open = false;
		}, `${scene.name} deleted.`);
</script>

{#if scenes.current && nodes.current}
	<div class="mb-3 flex items-center gap-2">
		<p class="m-0 flex-1 text-xs text-muted">
			A scene sets several devices at once, e.g. “Movie night”.
		</p>
		{#if targets.length}
			<Button variant="primary" disabled={full} onclick={() => edit()}
				><Plus size={16} /> Add scene</Button
			>
		{/if}
	</div>
	{#if list.length}
		<ul class="grid gap-1.5">
			{#each list as scene (scene.id)}
				<li
					class="flex items-center gap-3 rounded-lg border border-border bg-surface-2/50 px-3 py-2"
				>
					<div class="grid min-w-0 flex-1 gap-0.5 text-sm">
						<span class="truncate font-semibold">{scene.name}</span>
						<span class="truncate text-xs text-muted">
							{scene.members.map((m) => endpointName(targets, m.node, m.endpoint)).join(', ') ||
								'No devices'}
						</span>
					</div>
					{#if !scene.mine}<Badge>{scene.owner}</Badge>{/if}
					{#if scene.active}<Badge>On</Badge>{/if}
					{#if scene.access === 'write'}
						<Button size="sm" variant="ghost" disabled={busy} onclick={() => edit(scene)}
							>Edit</Button
						>
					{/if}
				</li>
			{/each}
		</ul>
	{:else if targets.length}
		<p class="text-sm text-muted">No scenes yet.</p>
	{:else}
		<p class="text-sm text-muted">There are no devices you may control yet.</p>
	{/if}
	{#if status && !open}<div class="mt-3">
			<Notice tone={status.tone}>{status.text}</Notice>
		</div>{/if}
{:else if scenes.error || nodes.error}
	<p class="text-sm text-err">{scenes.error ?? nodes.error}</p>
{/if}

<Dialog bind:open wide title={editing ? 'Edit scene' : 'New scene'} onsubmit={save}>
	<div class="grid gap-3">
		<label class="grid gap-1 text-sm">
			<span class="text-muted">Name</span>
			<Input maxlength={31} bind:value={name} placeholder="e.g. Movie night" required />
		</label>
		{#if editing && !editing.mine}
			<p class="m-0 text-xs text-muted">Belongs to <Badge>{editing.owner}</Badge></p>
		{/if}
		{#each rows as row, i (row.key)}
			{@const ep = epOf(row.key)}
			<div class="grid gap-2 rounded-md border border-border bg-surface p-2 text-sm">
				<div class="flex items-center gap-2">
					<Toggle bind:checked={row.on} label="On" />
					<span class="min-w-0 flex-1 font-medium">
						{endpointName(targets, ...splitKey(row.key))}
						<span class="font-normal text-muted">{row.on ? 'on' : 'off'}</span>
					</span>
					<Button
						size="sm"
						variant="ghost"
						aria-label="Remove from the scene"
						onclick={() => rows.splice(i, 1)}>Remove</Button
					>
				</div>
				{#if row.on && ep && hasCluster(ep, CLUSTER.levelControl)}
					<label class="flex items-center gap-2">
						<Checkbox
							checked={row.brightness !== undefined}
							onchange={(e) => (row.brightness = e.currentTarget.checked ? 80 : undefined)}
						/>
						<span class="w-28 text-muted"
							>Brightness{row.brightness !== undefined ? `: ${row.brightness} %` : ''}</span
						>
						{#if row.brightness !== undefined}
							<input class="flex-1" type="range" min="1" max="100" bind:value={row.brightness} />
						{/if}
					</label>
				{/if}
				{#if row.on && ep && hasCluster(ep, CLUSTER.colorControl)}
					<label class="flex items-center gap-2">
						<Checkbox
							checked={row.mireds !== undefined}
							onchange={(e) =>
								(row.mireds = e.currentTarget.checked ? (ep.colorTemperature ?? 370) : undefined)}
						/>
						<span class="w-28 text-muted"
							>Color{row.mireds !== undefined
								? `: ${Math.round(1_000_000 / row.mireds / 100) * 100} K`
								: ''}</span
						>
						{#if row.mireds !== undefined}
							<!-- Left warm, right cool: mireds fall towards the right. -->
							<input
								class="flex-1"
								type="range"
								min={-(ep.colorTempMax ?? 500)}
								max={-(ep.colorTempMin ?? 153)}
								value={-row.mireds}
								oninput={(e) => (row.mireds = -Number(e.currentTarget.value))}
							/>
						{/if}
					</label>
				{/if}
			</div>
		{/each}

		{#if rows.length < MAX_MEMBERS && unused.length}
			<label class="grid gap-1 text-sm">
				<span class="text-muted">Add a device (starts as it is now)</span>
				<Select placeholder="Device…" bind:value={adding} onchange={() => add(adding)}>
					{#each unused as t (t.key)}
						<option value={t.key}>{t.label}</option>
					{/each}
				</Select>
			</label>
		{/if}

		{#if !rows.length}
			<p class="m-0 text-sm text-muted">Add the devices the scene sets.</p>
		{/if}
		{#if status?.tone === 'err'}<Notice tone="err">{status.text}</Notice>{/if}
	</div>
	{#snippet footer()}
		<Button variant="primary" type="submit" disabled={busy || !rows.length || !name.trim()}
			>{editing ? 'Save' : 'Add scene'}</Button
		>
		<Button variant="ghost" onclick={() => (open = false)}>Cancel</Button>
		{#if editing}
			{@const scene = editing}
			{#if confirmDelete}
				<Button variant="danger" class="ml-auto" disabled={busy} onclick={() => remove(scene)}
					>Delete {scene.name}</Button
				>
			{:else}
				<Button variant="ghost" class="ml-auto text-err" onclick={() => (confirmDelete = true)}
					>Delete…</Button
				>
			{/if}
		{/if}
	{/snippet}
</Dialog>
