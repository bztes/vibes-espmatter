<!-- Create or edit a scene: its name, and for each endpoint in it on or off, brightness and color temperature. -->
<script lang="ts">
	import { api, errorMessage, hexId } from '../../web-ui/device-ui/api';
	import { Alert, Button, Checkbox, Dialog, Input, Slider, Switch } from '../../../device-ui/ui';
	import {
		COLOR_TEMPERATURE_TYPES,
		DIMMABLE_TYPES
	} from '../../matter-controller/device-ui/matter';
	import {
		kelvinToMireds,
		levelToPercent,
		miredsToKelvin,
		percentToLevel,
		type EndpointChoice,
		type Scene
	} from './scenes';

	let {
		endpoints,
		maxEndpoints,
		onsaved
	}: {
		endpoints: EndpointChoice[];
		maxEndpoints: number;
		onsaved: () => void;
	} = $props();

	const DEFAULT_CT = { min: 153, max: 500 };

	/** How an endpoint should be in the scene. */
	interface Row {
		on: boolean;
		percent: number;
		kelvin: number;
	}

	let dialog = $state<ReturnType<typeof Dialog>>();
	let editing = $state<Scene | null>(null);
	let name = $state('');
	/** The endpoints in the scene, by key; endpoints left out keep their row in case they come back. */
	let rows = $state<Record<string, Row>>({});
	let selected = $state<string[]>([]);
	/** Endpoints of the scene being edited that aren't offered here (no longer controllable): dropped on save. */
	let dropped = $state(0);
	let error = $state('');
	let busy = $state(false);

	const dimmable = (l: EndpointChoice) => DIMMABLE_TYPES.includes(l.endpoint.deviceType);
	const hasCt = (l: EndpointChoice) => COLOR_TEMPERATURE_TYPES.includes(l.endpoint.deviceType);
	// Warm = many mireds = few kelvin.
	const kMin = (l: EndpointChoice) => miredsToKelvin(l.endpoint.ctMaxMireds ?? DEFAULT_CT.max);
	const kMax = (l: EndpointChoice) => miredsToKelvin(l.endpoint.ctMinMireds ?? DEFAULT_CT.min);

	/** The endpoint as it is now (as far as the hub knows). */
	const current = (l: EndpointChoice): Row => ({
		on: l.endpoint.on ?? true,
		percent: l.endpoint.level ? levelToPercent(l.endpoint.level) : 100,
		kelvin: l.endpoint.ctMireds ? miredsToKelvin(l.endpoint.ctMireds) : 2700
	});

	/** Open for a new scene or to edit `scene`. */
	export function open(scene?: Scene) {
		editing = scene ?? null;
		error = '';
		name = scene?.name ?? '';
		rows = Object.fromEntries(endpoints.map((l) => [l.key, current(l)]));
		selected = [];
		dropped = 0;
		for (const sl of scene?.endpoints ?? []) {
			const key = `${sl.node}:${sl.endpoint}`;
			const row = rows[key];
			if (!row) {
				dropped++;
				continue;
			}
			selected.push(key);
			row.on = sl.on;
			if (sl.level) row.percent = levelToPercent(sl.level);
			if (sl.mireds) row.kelvin = miredsToKelvin(sl.mireds);
		}
		dialog?.open();
	}

	function toggle(key: string, on: boolean) {
		selected = on ? [...selected, key] : selected.filter((k) => k !== key);
	}

	/** All endpoints that are on now, as they are. */
	function takeCurrent() {
		const on = endpoints.filter((l) => l.endpoint.on).slice(0, maxEndpoints);
		for (const l of on) rows[l.key] = current(l);
		selected = on.map((l) => l.key);
	}

	async function save(ev: SubmitEvent) {
		ev.preventDefault();
		const list = endpoints
			.filter((l) => selected.includes(l.key))
			.map((l) => {
				const row = rows[l.key];
				const level = row.on && dimmable(l) ? percentToLevel(row.percent) : 0;
				const mireds = row.on && hasCt(l) ? kelvinToMireds(row.kelvin) : 0;
				return [hexId(l.node), l.endpoint.id, row.on ? 1 : 0, level, mireds].join(':');
			});
		busy = true;
		error = '';
		try {
			await api('/api/scenes', {
				body: {
					op: editing ? 'set' : 'add',
					id: editing?.id,
					name: name.trim(),
					endpoints: list.join(',')
				}
			});
			dialog?.close();
			onsaved();
		} catch (e) {
			error = errorMessage(e);
		} finally {
			busy = false;
		}
	}
</script>

<Dialog bind:this={dialog} width={480}>
	<form class="grid gap-2.5 [&_label]:m-0" onsubmit={save}>
		<h2 class="m-0 text-md">{editing ? 'Edit scene' : 'New scene'}</h2>

		<Input
			label="Name"
			bind:value={name}
			maxlength={23}
			placeholder="Movie night"
			required
			autocomplete="off"
		/>

		<div class="flex items-center justify-between text-sm">
			<span class="text-muted">Lights and plugs ({selected.length}/{maxEndpoints})</span>
			<Button variant="link" onclick={takeCurrent}>All that are on now</Button>
		</div>
		<ul class="m-0 grid max-h-[50vh] list-none overflow-y-auto p-0">
			{#each endpoints as l (l.key)}
				{@const row = rows[l.key]}
				{@const inScene = selected.includes(l.key)}
				<li class="grid gap-1.5 border-t py-2">
					<div class="flex items-center justify-between gap-2">
						<Checkbox
							checked={inScene}
							disabled={!inScene && selected.length >= maxEndpoints}
							onchange={(e) => toggle(l.key, e.currentTarget.checked)}>{l.name}</Checkbox
						>
						{#if inScene && row}
							<span class="flex items-center gap-2 text-sm text-muted">
								{row.on ? 'On' : 'Off'}
								<Switch bind:checked={row.on} aria-label="{l.name}: on" />
							</span>
						{/if}
					</div>
					{#if inScene && row?.on}
						{#if dimmable(l)}
							<div class="grid grid-cols-[1fr_64px] items-center gap-2 pl-6">
								<Slider
									min={1}
									max={100}
									bind:value={row.percent}
									aria-label="{l.name}: brightness"
								/>
								<span class="text-right text-sm">{row.percent} %</span>
							</div>
						{/if}
						{#if hasCt(l)}
							<div class="grid grid-cols-[1fr_64px] items-center gap-2 pl-6">
								<Slider
									tone="ct"
									min={kMin(l)}
									max={kMax(l)}
									step="50"
									bind:value={row.kelvin}
									aria-label="{l.name}: color temperature"
								/>
								<span class="text-right text-sm">{row.kelvin} K</span>
							</div>
						{/if}
					{/if}
				</li>
			{/each}
		</ul>
		{#if dropped}
			<p class="m-0 text-xs text-muted">
				{dropped} device{dropped === 1 ? '' : 's'} of this scene you can't control any more will be removed
				from it.
			</p>
		{/if}

		{#if error}<Alert>{error}</Alert>{/if}
		<div class="flex flex-wrap items-center justify-end gap-2">
			<Button onclick={() => dialog?.close()}>Cancel</Button>
			<Button type="submit" variant="primary" disabled={busy || !name.trim()}
				>{busy ? 'Saving…' : 'Save'}</Button
			>
		</div>
	</form>
</Dialog>
