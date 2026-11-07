<!--
  Automations of the account (admins: everyone's), run by the hub (espm_automations.cpp): a button
  of a Matter switch, a time of day, a one-off time or a sensor value controls devices or scenes.
  Made and edited in AutomationDialog. Only what the account may use is offered.
-->
<script lang="ts">
	import Plus from '@lucide/svelte/icons/plus';
	import {
		api,
		Badge,
		Button,
		errorText,
		Input,
		Notice,
		Poll,
		Segmented,
		Toggle
	} from '#sdk/device-ui';
	import AutomationDialog from './AutomationDialog.svelte';
	import { CLUSTER, type Node } from './matter';
	import { sensors } from './watches';
	import {
		WEEKDAYS,
		controllables,
		endpointsWith,
		timeText,
		type Action,
		type Clock,
		type Rule,
		type Scene
	} from './automations';
	import { KINDS, actionText, whenText, type Kind, type Lists } from './describe';

	const rules = new Poll<{ rules: Rule[]; clock: Clock; max: number }>(
		'/api/v1/controller/automations',
		30000
	);
	const nodes = new Poll<{ nodes: Node[] }>('/api/v1/controller/nodes', 30000);
	const scenes = new Poll<{ scenes: Scene[] }>('/api/v1/controller/scenes', 30000);

	const all = $derived(nodes.current?.nodes ?? []);
	const lists: Lists = $derived({
		buttons: endpointsWith(all, CLUSTER.switch, 'button'),
		targets: controllables(all),
		sensors: sensors(all),
		scenes: scenes.current?.scenes ?? []
	});
	const targets = $derived(lists.targets);
	const sceneList = $derived(lists.scenes);

	/** The open dialog: for a new automation, or the edited one. */
	let dialog = $state<{ rule?: Rule }>();
	let busy = $state(false);
	let status = $state<{ tone: 'ok' | 'err'; text: string }>();

	async function run(fn: () => Promise<unknown>) {
		busy = true;
		status = undefined;
		try {
			await fn();
			await rules.refresh();
		} catch (e) {
			status = { tone: 'err', text: errorText(e) };
		} finally {
			busy = false;
		}
	}

	function saved(text: string) {
		status = { tone: 'ok', text };
		void rules.refresh();
	}

	const setEnabled = (rule: Rule, enabled: boolean) =>
		run(() =>
			api(`/api/v1/controller/automations/${rule.id}`, { method: 'PUT', body: { enabled } })
		);

	/** A one-off counts down only while enabled. */
	const when = (rule: Rule) =>
		whenText(rule.trigger, lists, rule.enabled ? rules.current?.clock.now : undefined);
	const then = (a: Action) => actionText(a, lists);

	// The list: grouped by kind, sorted within, narrowed by search and kind.
	let query = $state('');
	let shownKind = $state<Kind | 'all' | 'problem'>('all');
	const ruleList = $derived(rules.current?.rules ?? []);
	const kindOf = (rule: Rule) => (rule.trigger.type === 'unknown' ? undefined : rule.trigger.type);
	const failing = (rule: Rule) => rule.enabled && !!rule.problem;
	const sortKey = (rule: Rule) => {
		const t = rule.trigger;
		if (t.type === 'time') return t.minute;
		if (t.type === 'once') return t.at;
		return 0;
	};
	const matches = (rule: Rule, q: string) =>
		[rule.name, when(rule), ...rule.actions.map(then), rule.owner].some((s) =>
			s.toLowerCase().includes(q)
		);
	const filterOptions = $derived([
		{ value: 'all', label: `All ${ruleList.length}` },
		...KINDS.map((k) => ({ ...k, n: ruleList.filter((r) => kindOf(r) === k.id).length }))
			.filter((k) => k.n)
			.map((k) => ({ value: k.id, label: `${k.title} ${k.n}` })),
		...(ruleList.some(failing)
			? [{ value: 'problem', label: `Not running ${ruleList.filter(failing).length}` }]
			: [])
	]);
	/** The picked filter, or all when it has nothing left. */
	const only = $derived(
		filterOptions.length > 2 && filterOptions.some((o) => o.value === shownKind) ? shownKind : 'all'
	);
	const groups = $derived.by(() => {
		const q = query.trim().toLowerCase();
		const shown = ruleList.filter(
			(r) =>
				(only === 'all' || (only === 'problem' ? failing(r) : kindOf(r) === only)) &&
				(!q || matches(r, q))
		);
		const order = [...KINDS.map((k) => k.id), undefined];
		return order
			.map((id) => ({
				kind: KINDS.find((k) => k.id === id),
				rules: shown
					.filter((r) => kindOf(r) === id)
					.sort(
						(a, b) =>
							sortKey(a) - sortKey(b) ||
							when(a).localeCompare(when(b)) ||
							a.name.localeCompare(b.name)
					)
			}))
			.filter((g) => g.rules.length);
	});

	const clockText = $derived.by(() => {
		const c = rules.current?.clock;
		if (!c?.synced || c.minute === undefined || c.weekday === undefined) return undefined;
		return `${WEEKDAYS[c.weekday]} ${timeText(c.minute)} ${c.zone ?? ''}`.trim();
	});
</script>

{#if rules.current && nodes.current}
	<div class="mb-3 flex flex-wrap items-center gap-2">
		{#if rules.current.clock.synced}
			<p class="m-0 flex-1 text-xs text-muted">Hub time: {clockText}</p>
		{:else}
			<div class="flex-1">
				<Notice tone="warn"
					>The hub’s clock is not set yet – timed automations start once it is.</Notice
				>
			</div>
		{/if}
		{#if targets.length || sceneList.length}
			<Button
				variant="primary"
				class="ml-auto"
				disabled={rules.current.rules.length >= rules.current.max}
				onclick={() => (dialog = {})}><Plus size={16} /> Add automation</Button
			>
		{/if}
	</div>

	{#if ruleList.length}
		{#if ruleList.length > 4}
			<div class="mb-3 grid gap-2">
				<Input
					type="search"
					placeholder="Search name, device or scene…"
					aria-label="Search automations"
					bind:value={query}
				/>
				{#if filterOptions.length > 2}
					<Segmented
						label="Show"
						bind:value={() => only, (v) => (shownKind = v as typeof shownKind)}
						options={filterOptions}
					/>
				{/if}
			</div>
		{/if}
		{#each groups as group (group.kind?.id ?? 'unknown')}
			<section class="mb-3 grid gap-1.5 last:mb-0">
				<h3
					class="m-0 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted uppercase"
				>
					{#if group.kind}<group.kind.icon size={14} />{/if}
					{group.kind?.title ?? 'Other'}
					<span class="font-normal">{group.rules.length}</span>
				</h3>
				<ul class="grid gap-1.5">
					{#each group.rules as rule (rule.id)}
						<li
							class="flex items-center gap-3 rounded-lg border border-border bg-surface-2/50 px-3 py-2"
						>
							<Toggle
								checked={rule.enabled}
								label="Enabled"
								disabled={busy}
								onchange={(on) => setEnabled(rule, on)}
							/>
							<div class="grid min-w-0 flex-1 gap-0.5 text-sm" class:text-muted={!rule.enabled}>
								<span class="truncate font-semibold">{rule.name || when(rule)}</span>
								<span class="text-xs text-muted">
									{#if rule.name}{when(rule)} →{:else}→{/if}
									{rule.actions.map(then).join(', ')}
								</span>
								{#if failing(rule)}
									<span class="text-xs text-warn">Not running: {rule.problem}</span>
								{/if}
							</div>
							{#if !rule.mine}<Badge>{rule.owner}</Badge>{/if}
							<Button size="sm" variant="ghost" disabled={busy} onclick={() => (dialog = { rule })}
								>Edit</Button
							>
						</li>
					{/each}
				</ul>
			</section>
		{:else}
			<p class="text-sm text-muted">No automation matches.</p>
		{/each}
	{:else if targets.length || sceneList.length}
		<p class="text-sm text-muted">No automations yet.</p>
	{:else}
		<p class="text-sm text-muted">There are no devices you may control yet.</p>
	{/if}
	{#if status && !dialog}<div class="mt-3">
			<Notice tone={status.tone}>{status.text}</Notice>
		</div>{/if}
{:else if rules.error || nodes.error}
	<p class="text-sm text-err">{rules.error ?? nodes.error}</p>
{/if}

{#if dialog}
	<AutomationDialog
		rule={dialog.rule}
		{lists}
		now={rules.current?.clock.now}
		onclose={() => (dialog = undefined)}
		onsaved={saved}
	/>
{/if}
