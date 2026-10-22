<!--
	Rules that let buttons of Matter switches control lights through the hub (espm_automation.cpp).
	The buttons come from the Matter controller's node list.
-->
<script lang="ts">
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import { api, errorMessage } from '../../web-ui/device-ui/api';
	import { live } from '../../web-ui/device-ui/live.svelte';
	import Panel from '../../web-ui/device-ui/Panel.svelte';
	import { Alert, Button, Select, showAlert } from '../../../device-ui/ui';
	import {
		COLOR_TEMPERATURE_TYPES,
		DIMMABLE_TYPES,
		GENERIC_SWITCH,
		LIGHT_TYPES,
		endpointName,
		matterNodes,
		type MatterNode
	} from '../../matter-controller/device-ui/matter';

	interface Rule {
		id: number;
		mode: string;
		srcNode: number;
		srcEndpoint: number;
		trigger: Trigger;
		action: string;
		dstNode: number;
		dstEndpoint: number;
	}
	type Trigger = 'press' | 'double' | 'hold';

	const TRIGGERS: Record<Trigger, string> = {
		press: 'is pressed',
		double: 'is double-pressed',
		hold: 'is held'
	};
	/** `needs`: what the light must support; `hold`: only while the button is held. */
	const ACTIONS: { id: string; label: string; needs?: 'level' | 'ct'; hold?: boolean }[] = [
		{ id: 'toggle', label: 'Toggle on/off' },
		{ id: 'on', label: 'Turn on' },
		{ id: 'off', label: 'Turn off' },
		{ id: 'brighter', label: 'Brighter (one step)', needs: 'level' },
		{ id: 'darker', label: 'Darker (one step)', needs: 'level' },
		{ id: 'warmer', label: 'Warmer (one step)', needs: 'ct' },
		{ id: 'cooler', label: 'Cooler (one step)', needs: 'ct' },
		{ id: 'dim_up', label: 'Brighter while held', needs: 'level', hold: true },
		{ id: 'dim_down', label: 'Darker while held', needs: 'level', hold: true },
		{ id: 'warmer_hold', label: 'Warmer while held', needs: 'ct', hold: true },
		{ id: 'cooler_hold', label: 'Cooler while held', needs: 'ct', hold: true }
	];
	const MULTI_PRESS = 0x10;

	const nodes = matterNodes();
	const automations = live<{ rules: Rule[] }>('/api/automations');

	const endpoints = (types: number[]) =>
		(nodes.data?.nodes ?? []).flatMap((node) =>
			node.endpoints
				.filter((e) => types.includes(e.deviceType))
				.map((ep) => ({ node, ep, key: `${node.id}:${ep.id}` }))
		);
	const buttons = $derived(endpoints([GENERIC_SWITCH]));
	const lights = $derived(endpoints(LIGHT_TYPES));

	function label(nodeId: number, epId: number, kind: string) {
		const node = nodes.data?.nodes.find((n: MatterNode) => n.id === nodeId);
		const ep = node?.endpoints.find((e) => e.id === epId);
		return node && ep ? endpointName(node, ep, kind) : `Node ${nodeId} / ${epId} (removed)`;
	}

	let button = $state('');
	let trigger = $state<Trigger>('press');
	let light = $state('');
	let picked = $state('toggle');
	let error = $state('');
	let busy = $state(false);

	const target = $derived(lights.find((l) => l.key === light)?.ep);
	const available = $derived(
		ACTIONS.filter(
			(a) =>
				(!a.hold || trigger === 'hold') &&
				(!a.needs ||
					!target ||
					(a.needs === 'level' ? DIMMABLE_TYPES : COLOR_TEMPERATURE_TYPES).includes(
						target.deviceType
					))
		)
	);
	/** The picked action, or the first one available when trigger or light rule it out. */
	const action = $derived(
		available.some((a) => a.id === picked) ? picked : (available[0]?.id ?? 'toggle')
	);
	const doubleUnsupported = $derived.by(() => {
		const features = buttons.find((b) => b.key === button)?.ep.switchFeatures ?? 0;
		return features !== 0 && !(features & MULTI_PRESS);
	});

	async function add(ev: SubmitEvent) {
		ev.preventDefault();
		const [src, srcEndpoint] = button.split(':');
		const [dst, dstEndpoint] = light.split(':');
		busy = true;
		error = '';
		try {
			await api('/api/automations', {
				body: { op: 'add', src, srcEndpoint, trigger, action, dst, dstEndpoint }
			});
			await automations.refresh();
		} catch (e) {
			error = errorMessage(e);
		} finally {
			busy = false;
		}
	}

	async function remove(rule: Rule) {
		try {
			await api('/api/automations', { body: { op: 'delete', id: rule.id } });
			await automations.refresh();
		} catch (e) {
			showAlert('Couldn’t delete the automation', errorMessage(e));
		}
	}

	const actionLabel = (id: string) => ACTIONS.find((a) => a.id === id)?.label ?? id;
</script>

<Panel title="Automations">
	{#if buttons.length === 0}
		<p class="text-muted">Pair a Matter switch or remote first.</p>
	{:else}
		<h3 class="mt-1 mb-1.5 text-sm">Rules</h3>
		{#if automations.data?.rules.length}
			<ul class="mt-0 mb-4 list-none p-0">
				{#each automations.data.rules as rule (rule.id)}
					<li class="flex items-center justify-between gap-2 border-b py-1.5">
						<span>
							When <strong>{label(rule.srcNode, rule.srcEndpoint, 'button')}</strong>
							{TRIGGERS[rule.trigger] ?? rule.trigger} →
							<strong>{label(rule.dstNode, rule.dstEndpoint, 'light')}</strong>:
							{actionLabel(rule.action)}
						</span>
						<Button
							variant="danger"
							icon
							title="Delete rule"
							aria-label="Delete rule"
							onclick={() => remove(rule)}><Trash2 size={16} /></Button
						>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="text-muted">No rules yet.</p>
		{/if}

		<form
			class="flex flex-wrap items-end gap-2 [&>label]:m-0 [&>label]:min-w-[150px] [&>label]:flex-1"
			onsubmit={add}
		>
			<Select label="When" bind:value={button} required>
				<option value="" disabled>Button…</option>
				{#each buttons as b (b.key)}
					<option value={b.key}>{endpointName(b.node, b.ep, 'button')}</option>
				{/each}
			</Select>
			<Select label="&nbsp;" bind:value={trigger}>
				{#each Object.entries(TRIGGERS) as [id, text] (id)}
					<option value={id} disabled={id === 'double' && doubleUnsupported}>{text}</option>
				{/each}
			</Select>
			<Select label="then" bind:value={light} required>
				<option value="" disabled>Light…</option>
				{#each lights as l (l.key)}
					<option value={l.key}>{endpointName(l.node, l.ep, 'light')}</option>
				{/each}
			</Select>
			<Select label="&nbsp;" bind:value={() => action, (id) => (picked = id)}>
				{#each available as a (a.id)}
					<option value={a.id}>{a.label}</option>
				{/each}
			</Select>
			<Button type="submit" variant="primary" disabled={busy || !button || !light}>Add rule</Button>
		</form>
		{#if error}<Alert>{error}</Alert>{/if}
	{/if}
</Panel>
