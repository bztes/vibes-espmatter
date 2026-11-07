<!-- Pick a peripheral to add. Peripherals come from plugins (also external repositories). -->
<script lang="ts">
	import { addPeripheral, type Resolved } from '#lib/core/engine.ts';
	import type { FirmwareConfig } from '#lib/core/model.ts';
	import { peripherals } from '#lib/core/registry.ts';
	import { requirementIssues } from '#lib/core/validate.ts';
	import { Badge, Code, Dialog, PluginIcon } from '#lib/ui/index.ts';
	import { deviceTypeNames } from '#sdk/matter';

	let {
		open = $bindable(false),
		config,
		resolved
	}: { open?: boolean; config: FirmwareConfig; resolved: Resolved } = $props();

	const CATEGORIES: Record<string, string> = {
		sensor: 'Sensors',
		actuator: 'Switches & actuators',
		climate: 'Climate',
		lighting: 'Lighting',
		input: 'Inputs',
		other: 'Other'
	};
	const groups = $derived(
		Object.entries(CATEGORIES)
			.map(([id, title]) => ({
				id,
				title,
				list: peripherals.all().filter((s) => (s.category ?? 'other') === id)
			}))
			.filter((g) => g.list.length)
	);
	const taken = (id: string) =>
		!peripherals.get(id).multiple && config.peripherals.some((s) => s.peripheral === id);
	const blocked = (id: string) =>
		requirementIssues(
			resolved.slot().board,
			peripherals.get(id).requires,
			peripherals.get(id).name
		)[0];

	function add(id: string) {
		addPeripheral(config, id);
		open = false;
		requestAnimationFrame(() =>
			document
				.getElementById(`peripheral:${config.peripherals.at(-1)?.uid}`)
				?.scrollIntoView({ behavior: 'smooth', block: 'center' })
		);
	}
</script>

<Dialog bind:open title="Add a peripheral" wide>
	{#each groups as g (g.id)}
		<h3 class="mt-0 mb-2 text-xs font-semibold tracking-wider text-muted uppercase">{g.title}</h3>
		<div class="mb-6 grid gap-3 sm:grid-cols-2">
			{#each g.list as s (s.id)}
				{@const reason = taken(s.id) ? 'Already added (one per device).' : blocked(s.id)}
				<button
					type="button"
					disabled={!!reason}
					onclick={() => add(s.id)}
					class="flex items-start gap-3 rounded-xl border border-border p-3.5 text-left transition hover:border-accent/60 hover:bg-accent-soft/30 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-border disabled:hover:bg-transparent"
				>
					<span
						class="grid size-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent"
						><PluginIcon name={s.icon} /></span
					>
					<span class="grid min-w-0 gap-1">
						<span class="flex flex-wrap items-center gap-1.5 text-sm font-semibold">
							{s.name}
							{#if s.multiple}<Badge>multiple</Badge>{/if}
							{#if s.dir.startsWith('plugins/external/')}<Badge tone="info">external</Badge>{/if}
						</span>
						<span class="text-xs text-muted">{reason ?? s.description}</span>
						<span class="text-[11px] text-muted/80"
							>{deviceTypeNames(s.matter.endpoints)}{s.version ? ` · v${s.version}` : ''}</span
						>
					</span>
				</button>
			{/each}
		</div>
	{/each}
	<p class="m-0 text-xs text-muted">
		Peripherals are plugins in <Code>plugins/peripherals/&lt;id&gt;</Code> or
		<Code>plugins/external/&lt;repo&gt;/&lt;id&gt;</Code> – see the README to write your own.
	</p>
</Dialog>
