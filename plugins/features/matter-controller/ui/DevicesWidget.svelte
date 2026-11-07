<!--
  Paired devices (admins): state, last seen, battery, what the device is – rename it, tag it (the
  dashboard can group by tags) or remove it from the hub's fabric. New ones are paired in a dialog.
-->
<script lang="ts">
	import Plus from '@lucide/svelte/icons/plus';
	import {
		api,
		Badge,
		Button,
		Dialog,
		errorText,
		formatDuration,
		Input,
		Notice,
		Poll
	} from '#sdk/device-ui';
	import { visibleEndpoints } from './clusters';
	import { ago, allTags, typeName, updateNode, type Node } from './matter';
	import PairDialog from './PairDialog.svelte';

	const nodes = new Poll<{ nodes: Node[] }>('/api/v1/controller/nodes', 10000);

	interface Draft {
		id: number;
		name: string;
		tags: string[];
		tag: string;
	}
	let draft = $state<Draft>();
	let editOpen = $state(false);
	let pairing = $state(false);
	let confirmDelete = $state<number>();
	let busy = $state(false);
	let status = $state<{ tone: 'ok' | 'err'; text: string }>();
	let filter = $state('');

	const list = $derived(nodes.current?.nodes ?? []);
	const known = $derived(allTags(list));
	const shown = $derived.by(() => {
		const q = filter.trim().toLowerCase();
		if (!q) return list;
		return list.filter((n) =>
			[n.name, n.vendor, n.product, ...(n.tags ?? [])].some((s) => s?.toLowerCase().includes(q))
		);
	});

	function edit(n: Node) {
		draft = { id: n.id, name: n.name, tags: [...(n.tags ?? [])], tag: '' };
		editOpen = true;
		confirmDelete = undefined;
		status = undefined;
	}

	function addTag() {
		if (!draft) return;
		const tag = draft.tag.trim().replaceAll(',', ' ').slice(0, 24);
		if (tag && !draft.tags.some((t) => t.toLowerCase() === tag.toLowerCase())) draft.tags.push(tag);
		draft.tag = '';
	}

	async function run(fn: () => Promise<unknown>, done: string) {
		busy = true;
		status = undefined;
		try {
			await fn();
			status = { tone: 'ok', text: done };
			editOpen = false;
			confirmDelete = undefined;
			await nodes.refresh();
		} catch (e) {
			status = { tone: 'err', text: errorText(e) };
		} finally {
			busy = false;
		}
	}

	function save() {
		const d = draft;
		if (!d) return;
		if (d.tag.trim()) addTag();
		const name = d.name.trim();
		void run(() => updateNode(d.id, { name, tags: d.tags }), `${name} saved.`);
	}

	function remove(n: Node) {
		void run(
			() => api(`/api/v1/controller/nodes/${n.id}`, { method: 'DELETE' }),
			`${n.name} removed. If it was offline, factory-reset it before pairing it again.`
		);
	}

	function seen(n: Node) {
		if (n.state === 'online') return 'Online';
		if (n.lastSeenAgo == null) return 'Not seen since the hub started';
		return `Last seen ${ago(n.lastSeenAgo)}`;
	}

	const batteryTone = (n: Node) =>
		n.batteryLevel === 'critical' || (n.battery != null && n.battery <= 10)
			? 'err'
			: n.batteryLevel === 'warning' || (n.battery != null && n.battery <= 25)
				? 'warn'
				: 'neutral';

	const what = (n: Node) => {
		const types = [...new Set(visibleEndpoints(n).map(typeName).filter(Boolean))].join(', ');
		return [n.vendor && n.product ? `${n.vendor} ${n.product}` : n.product, types]
			.filter(Boolean)
			.join(' · ');
	};
</script>

{#if nodes.current}
	<div class="mb-3 flex flex-wrap items-center gap-2">
		{#if list.length > 4}
			<Input
				class="flex-1"
				type="search"
				placeholder="Search name, product or tag…"
				aria-label="Search devices"
				bind:value={filter}
			/>
		{/if}
		<Button variant="primary" class="ml-auto" onclick={() => (pairing = true)}
			><Plus size={16} /> Pair device</Button
		>
	</div>
	<ul class="grid gap-2">
		{#each shown as n (n.id)}
			<li class="grid gap-2 rounded-lg border border-border bg-surface-2/50 px-3 py-2.5">
				<div class="flex flex-wrap items-start gap-x-3 gap-y-1">
					<div class="min-w-0 flex-1">
						<div class="flex flex-wrap items-center gap-2">
							<span class="truncate font-medium">{n.name}</span>
							{#if n.state === 'offline'}<Badge tone="err">offline</Badge>
							{:else if n.state === 'connecting'}<Badge tone="info">connecting</Badge>{/if}
							{#if n.battery != null || n.batteryLevel}
								<Badge tone={batteryTone(n)}
									>Battery {n.battery != null ? `${n.battery} %` : n.batteryLevel}</Badge
								>
							{/if}
						</div>
						<div class="truncate text-xs text-muted">{what(n) || `Node ${n.id}`}</div>
					</div>
					<div class="flex gap-1">
						<Button size="sm" variant="ghost" onclick={() => edit(n)}>Edit</Button>
						{#if confirmDelete === n.id}
							<Button size="sm" variant="danger" disabled={busy} onclick={() => remove(n)}
								>Remove {n.name}</Button
							>
							<Button size="sm" variant="ghost" onclick={() => (confirmDelete = undefined)}
								>Keep</Button
							>
						{:else}
							<Button
								size="sm"
								variant="ghost"
								class="text-err"
								onclick={() => (confirmDelete = n.id)}>Remove…</Button
							>
						{/if}
					</div>
				</div>
				{#if n.tags?.length}
					<div class="flex flex-wrap gap-1">
						{#each n.tags as tag (tag)}
							<span
								class="rounded-full bg-surface px-2 py-0.5 text-xs text-muted ring-1 ring-border"
								>{tag}</span
							>
						{/each}
					</div>
				{/if}
				<dl class="m-0 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted">
					<div title={n.lastSeen ? new Date(n.lastSeen * 1000).toLocaleString() : undefined}>
						{seen(n)}
					</div>
					<div>Node {n.id}</div>
					{#if n.softwareVersion}<div>Firmware {n.softwareVersion}</div>{/if}
					{#if n.diagnostics?.uptime != null}
						<div>Up {formatDuration(n.diagnostics.uptime)}</div>
					{/if}
					{#if n.diagnostics?.rebootCount != null}
						<div>{n.diagnostics.rebootCount} reboots</div>
					{/if}
				</dl>
				{#if confirmDelete === n.id}
					<p class="m-0 text-xs text-muted">
						The hub asks the device to leave its network and forgets it, with its automations and
						the accounts’ access to it.
					</p>
				{/if}
			</li>
		{:else}
			<li class="text-sm text-muted">
				{list.length ? 'No device matches.' : 'No devices yet – pair one.'}
			</li>
		{/each}
	</ul>
	{#if status && !editOpen}<div class="mt-3">
			<Notice tone={status.tone}>{status.text}</Notice>
		</div>{/if}
{:else if nodes.error}
	<p class="text-sm text-err">{nodes.error}</p>
{/if}

<PairDialog bind:open={pairing} onpaired={() => nodes.refresh()} />

<Dialog bind:open={editOpen} title="Edit device" onsubmit={save}>
	{#if draft}
		<div class="grid gap-3">
			<label class="grid gap-1 text-sm">
				<span class="text-muted">Name</span>
				<Input maxlength={31} required bind:value={draft.name} />
			</label>
			<div class="grid gap-1 text-sm">
				<span class="text-muted">Tags – the dashboard can group devices by them</span>
				<div class="flex flex-wrap items-center gap-1.5">
					{#each draft.tags as tag, i (tag)}
						<span
							class="inline-flex items-center gap-1 rounded-full bg-accent-soft py-0.5 pr-1 pl-2.5 text-xs font-medium text-accent"
						>
							{tag}
							<button
								type="button"
								class="grid size-4 place-items-center rounded-full hover:bg-accent/15"
								aria-label="Remove tag {tag}"
								onclick={() => draft?.tags.splice(i, 1)}>×</button
							>
						</span>
					{/each}
					<Input
						size="sm"
						class="w-40"
						list="espm-tags"
						maxlength={24}
						placeholder="Add tag…"
						aria-label="New tag"
						bind:value={draft.tag}
						onkeydown={(e) => {
							if (e.key === 'Enter' || e.key === ',') {
								e.preventDefault();
								addTag();
							}
						}}
					/>
					<datalist id="espm-tags">
						{#each known.filter((t) => !draft?.tags.includes(t)) as t (t)}
							<option value={t}></option>
						{/each}
					</datalist>
				</div>
			</div>
			{#if status?.tone === 'err'}<Notice tone="err">{status.text}</Notice>{/if}
		</div>
	{/if}
	{#snippet footer()}
		<Button variant="primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
		<Button variant="ghost" onclick={() => (editOpen = false)}>Cancel</Button>
	{/snippet}
</Dialog>
