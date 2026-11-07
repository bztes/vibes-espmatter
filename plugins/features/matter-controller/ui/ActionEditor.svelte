<!-- One action of an automation: a device command or a scene. -->
<script lang="ts">
	import X from '@lucide/svelte/icons/x';
	import { Segmented, Select } from '#sdk/device-ui';
	import Dial from './Dial.svelte';
	import { deviceGroups } from './automations';
	import type { Lists } from './describe';
	import type { Draft, Resolved } from './drafts';
	import { choice, panel, side, withUnit } from './styles';

	let {
		draft = $bindable(),
		resolved,
		lists,
		label,
		onremove
	}: {
		draft: Draft;
		resolved: Resolved;
		lists: Lists;
		label: string;
		/** Missing: can't be removed (the only one). */
		onremove?: () => void;
	} = $props();

	const targetGroups = $derived(deviceGroups(lists.targets));
	const sceneGroups = $derived([
		{
			label: '',
			options: lists.scenes.map((sc) => ({
				value: String(sc.id),
				label: sc.name,
				description: `${sc.members.length} device${sc.members.length === 1 ? '' : 's'}${sc.mine ? '' : ` · ${sc.owner}`}`
			}))
		}
	]);
	const { ep, available, command, param, arg } = $derived(resolved);
</script>

<div class="grid gap-3" role="group" aria-label={label}>
	{#if (lists.targets.length && lists.scenes.length) || onremove}
		<div class="flex items-center gap-2">
			{#if lists.targets.length && lists.scenes.length}
				<div class="w-40">
					<Segmented
						label="Action"
						bind:value={() => draft.type, (v) => (draft.type = v as Draft['type'])}
						options={[
							{ value: 'endpoint', label: 'Device' },
							{ value: 'scene', label: 'Scene' }
						]}
					/>
				</div>
			{/if}
			{#if onremove}
				<button
					type="button"
					class="ml-auto grid size-8 place-items-center rounded-md text-muted hover:bg-surface hover:text-err"
					aria-label="Remove {label.toLowerCase()}"
					title="Remove"
					onclick={onremove}><X size={16} /></button
				>
			{/if}
		</div>
	{/if}
	{#if draft.type === 'endpoint'}
		<Select
			aria-label="Device"
			placeholder="Device…"
			value={draft.target}
			groups={targetGroups}
			onchange={({ currentTarget: { value: v } }) => (
				(draft.target = v),
				(draft.pickedArg = undefined)
			)}
		/>
		{#if ep}
			<div class={panel}>
				{#if param && arg !== undefined && !param.options}
					<Dial
						bind:value={() => arg, (v) => (draft.pickedArg = v)}
						min={param.min}
						max={param.max}
						step={param.step ?? 1}
						label={param.label}
						format={withUnit(param.unit)}
					/>
				{/if}
				<div class={side}>
					<div class="grid grid-cols-2 gap-1" role="group" aria-label="Command">
						{#each available as c (c.id)}
							<button
								type="button"
								class={choice(command === c.id)}
								aria-pressed={command === c.id}
								title={c.label}
								onclick={() => ((draft.picked = c.id), (draft.pickedArg = undefined))}
								>{c.label}</button
							>
						{/each}
					</div>
					{#if param?.options && arg !== undefined}
						<span class="text-xs font-medium text-muted">{param.label}</span>
						<div class="grid grid-cols-3 gap-1" role="group" aria-label={param.label}>
							{#each param.options as o (o.value)}
								<button
									type="button"
									class={choice(arg === o.value)}
									aria-pressed={arg === o.value}
									onclick={() => (draft.pickedArg = o.value)}>{o.label}</button
								>
							{/each}
						</div>
					{/if}
				</div>
			</div>
		{/if}
	{:else}
		<Select
			aria-label="Scene"
			placeholder="Scene…"
			value={draft.scene}
			groups={sceneGroups}
			onchange={({ currentTarget: { value: v } }) => (draft.scene = v)}
		/>
	{/if}
</div>
