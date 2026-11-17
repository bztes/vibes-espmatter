<!-- Links of a device to others (Matter Bindings); each change applies on its own. -->
<script lang="ts">
	import { Button, Checkbox, Notice, Select, errorText } from '#sdk/device-ui';
	import {
		getLinks,
		linkGroups,
		setLinks,
		targetKey,
		type LinkGroup,
		type LinkState
	} from './links';
	import type { Node } from './matter';

	let { node, nodes }: { node: Node; nodes: Node[] } = $props();

	const groups = $derived.by(() => {
		const eps = node.endpoints.filter((ep) => ep.clientClusters?.length);
		return eps.flatMap((ep) => linkGroups(node, ep, nodes, eps.length > 1));
	});
	const endpoints = $derived([...new Set(groups.map((g) => g.endpoint))]);

	/** Per endpoint: what the device has (missing: still reading). */
	let read = $state<Record<number, LinkState>>({});
	/** Per group: the targets ticked, as `targetKey`s. */
	let picked = $state<Record<string, string[]>>({});
	let saving = $state<string>();
	let errors = $state<Record<string, string>>({});

	const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

	/** Polls until the hub is done with the endpoint (it runs one link job at a time). */
	async function load(endpoint: number, put?: () => Promise<LinkState>) {
		let s = put ? await put() : await getLinks(node.id, endpoint, true);
		for (let i = 0; s.state === 'busy' || (!s.links && !s.error); i++) {
			if (i > 90) throw new Error('The hub did not finish – try again.');
			await wait(1000);
			s = await getLinks(node.id, endpoint);
		}
		read[endpoint] = s;
		for (const g of groups.filter((x) => x.endpoint === endpoint)) picked[g.key] = current(g);
		return s;
	}

	/** Endpoints being read or read: once per dialog. */
	const started: number[] = [];
	$effect(() => {
		for (const ep of endpoints) {
			if (started.includes(ep)) continue;
			started.push(ep);
			load(ep).catch((e) => (read[ep] = { state: 'idle', error: errorText(e) }));
		}
	});

	const current = (g: LinkGroup) =>
		(read[g.endpoint]?.links ?? [])
			.filter((l) => l.cluster === g.cluster)
			.map((l) => targetKey(l.node, l.endpoint));

	const changed = (g: LinkGroup) => {
		const a = [...(picked[g.key] ?? [])].sort();
		const b = current(g).sort();
		return a.length !== b.length || a.some((k, i) => k !== b[i]);
	};

	function toggle(g: LinkGroup, key: string, on: boolean) {
		const list = picked[g.key] ?? [];
		picked[g.key] = on ? [...list, key] : list.filter((k) => k !== key);
	}

	async function apply(g: LinkGroup) {
		saving = g.key;
		delete errors[g.key];
		const targets = g.targets.filter((t) => picked[g.key]?.includes(t.key));
		try {
			const s = await load(g.endpoint, () => setLinks(node.id, g.endpoint, g.cluster, targets));
			if (s.error) errors[g.key] = s.error;
		} catch (e) {
			errors[g.key] = errorText(e);
		} finally {
			saving = undefined;
		}
	}
</script>

{#if groups.length}
	<section class="grid gap-3 text-sm" aria-label="Links">
		<div class="grid gap-0.5">
			<span class="text-muted">Links</span>
			<span class="text-xs text-muted"
				>The devices talk directly – they keep working without the hub.</span
			>
		</div>
		{#each groups as g (g.key)}
			{@const state = read[g.endpoint]}
			<div class="grid gap-2 rounded-lg border border-border bg-surface-2/40 p-3">
				<span class="font-medium">{g.label}</span>
				{#if !state}
					<span class="text-xs text-muted">Reading from the device…</span>
				{:else if state.error && !state.links}
					<Notice tone="err">{state.error}</Notice>
				{:else if g.single}
					<Select
						aria-label={g.label}
						value={picked[g.key]?.[0] ?? ''}
						disabled={!!saving}
						groups={[
							{
								label: '',
								options: [
									{ value: '', label: 'None – its own sensor' },
									...g.targets.map((t) => ({ value: t.key, label: t.label }))
								]
							}
						]}
						onchange={({ currentTarget: { value } }) => (picked[g.key] = value ? [value] : [])}
					/>
				{:else}
					<div class="grid gap-1.5">
						{#each g.targets as t (t.key)}
							<Checkbox
								label={t.label}
								disabled={!!saving}
								bind:checked={
									() => picked[g.key]?.includes(t.key) ?? false, (on) => toggle(g, t.key, on)
								}
							/>
						{/each}
					</div>
				{/if}
				{#if state && changed(g)}
					<div>
						<Button size="sm" variant="primary" disabled={!!saving} onclick={() => apply(g)}
							>{saving === g.key ? 'Linking…' : 'Apply'}</Button
						>
					</div>
				{/if}
				{#if errors[g.key]}<Notice tone="err">{errors[g.key]}</Notice>{/if}
			</div>
		{/each}
	</section>
{/if}
