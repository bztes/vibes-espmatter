<!-- Create or edit a timer: light, time and days (or once in X minutes), what to do and how slowly. -->
<script lang="ts">
	import { api, errorMessage, hexId } from '../../web-ui/device-ui/api';
	import {
		Alert,
		Button,
		Checkbox,
		Chip,
		Dialog,
		Input,
		Segmented,
		Select,
		Slider
	} from '../../../device-ui/ui';
	import {
		COLOR_TEMPERATURE_TYPES,
		DIMMABLE_TYPES
	} from '../../matter-controller/device-ui/matter';
	import {
		EVERY_DAY,
		WEEK,
		WEEKDAYS,
		WEEKEND,
		fmtMinute,
		isOnce,
		kelvinToMireds,
		levelToPercent,
		miredsToKelvin,
		percentToLevel,
		type LightChoice,
		type Timer,
		type TimerAction
	} from './timers';

	let {
		lights,
		onsaved
	}: {
		lights: LightChoice[];
		onsaved: () => void;
	} = $props();

	const FADES = [0, 60, 300, 600, 900, 1200, 1800, 2700, 3600];
	/** Quick picks for "in X minutes". */
	const IN_PRESETS = [5, 15, 30, 60, 120];
	const MAX_IN = 24 * 60;
	const DEFAULT_CT = { min: 153, max: 500 };

	/** The form of a new timer. */
	const DEFAULTS = {
		when: 'at' as 'at' | 'in',
		time: '06:30',
		days: EVERY_DAY,
		inMinutes: 30,
		action: 'on' as TimerAction,
		setLevel: true,
		percent: 100,
		setCt: false,
		kelvin: 2700,
		fade: 0,
		fromLevel: false,
		startPercent: 1,
		fromCt: false,
		startKelvin: 2200,
		name: ''
	};

	let dialog = $state<ReturnType<typeof Dialog>>();
	let editing = $state<Timer | null>(null);
	let lightKey = $state('');
	/** At a time of day (recurring) or once in `inMinutes`. */
	let when = $state(DEFAULTS.when);
	let time = $state(DEFAULTS.time);
	let days = $state(DEFAULTS.days);
	let inMinutes = $state(DEFAULTS.inMinutes);
	let action = $state(DEFAULTS.action);
	let setLevel = $state(DEFAULTS.setLevel);
	let percent = $state(DEFAULTS.percent);
	let setCt = $state(DEFAULTS.setCt);
	let kelvin = $state(DEFAULTS.kelvin);
	let fade = $state(DEFAULTS.fade);
	let fromLevel = $state(DEFAULTS.fromLevel);
	let startPercent = $state(DEFAULTS.startPercent);
	let fromCt = $state(DEFAULTS.fromCt);
	let startKelvin = $state(DEFAULTS.startKelvin);
	let name = $state(DEFAULTS.name);
	let error = $state('');
	let busy = $state(false);

	const light = $derived(lights.find((l) => l.key === lightKey));
	const dimmable = $derived(light ? DIMMABLE_TYPES.includes(light.endpoint.deviceType) : false);
	const hasCt = $derived(
		light ? COLOR_TEMPERATURE_TYPES.includes(light.endpoint.deviceType) : false
	);
	// Warm = many mireds = few kelvin.
	const kMin = $derived(miredsToKelvin(light?.endpoint.ctMaxMireds ?? DEFAULT_CT.max));
	const kMax = $derived(miredsToKelvin(light?.endpoint.ctMinMireds ?? DEFAULT_CT.min));

	/** Open for a new timer (optionally for a light) or to edit `timer`. */
	export function open(timer?: Timer, forLight?: string) {
		editing = timer ?? null;
		error = '';
		if (timer) {
			lightKey = `${timer.node}:${timer.endpoint}`;
			when = isOnce(timer) ? 'in' : 'at';
			time = fmtMinute(timer.minute);
			days = isOnce(timer) ? DEFAULTS.days : timer.days;
			inMinutes = isOnce(timer)
				? Math.max(1, Math.ceil((timer.remaining ?? 0) / 60))
				: DEFAULTS.inMinutes;
			action = timer.action;
			setLevel = timer.level > 0;
			percent = timer.level ? levelToPercent(timer.level) : DEFAULTS.percent;
			setCt = timer.mireds > 0;
			kelvin = timer.mireds ? miredsToKelvin(timer.mireds) : DEFAULTS.kelvin;
			fade = timer.fade;
			fromLevel = timer.startLevel > 0;
			startPercent = timer.startLevel ? levelToPercent(timer.startLevel) : DEFAULTS.startPercent;
			fromCt = timer.startMireds > 0;
			startKelvin = timer.startMireds ? miredsToKelvin(timer.startMireds) : DEFAULTS.startKelvin;
			name = timer.name;
		} else {
			lightKey = forLight ?? lights[0]?.key ?? '';
			({
				when,
				time,
				days,
				inMinutes,
				action,
				setLevel,
				percent,
				setCt,
				kelvin,
				fade,
				fromLevel,
				startPercent,
				fromCt,
				startKelvin,
				name
			} = DEFAULTS);
		}
		dialog?.open();
	}

	function toggleDay(bit: number) {
		const next = days ^ (1 << bit);
		if (next) days = next; // at least one day
	}

	async function save(ev: SubmitEvent) {
		ev.preventDefault();
		if (!light) return;
		const [h, m] = time.split(':').map(Number);
		const level = action !== 'off' && dimmable && setLevel ? percentToLevel(percent) : 0;
		const mireds = action !== 'off' && hasCt && setCt ? kelvinToMireds(kelvin) : 0;
		// Start values only for fading on (a light that is already on fades from where it is).
		const fades = action === 'on' && dimmable && fade > 0;
		const startLevel = fades && level && fromLevel ? percentToLevel(startPercent) : 0;
		const startMireds = fades && mireds && fromCt ? kelvinToMireds(startKelvin) : 0;
		if (action === 'adjust' && !level && !mireds) {
			error = 'Pick a brightness or color temperature to change.';
			return;
		}
		busy = true;
		error = '';
		try {
			await api('/api/timers', {
				body: {
					op: editing ? 'set' : 'add',
					id: editing?.id,
					node: hexId(light.node),
					endpoint: light.endpoint.id,
					// Once: the device counts from its own clock (and restarts the countdown on edit).
					...(when === 'in' ? { in: inMinutes } : { minute: h * 60 + m, days }),
					action,
					level,
					mireds,
					startLevel,
					startMireds,
					fade: dimmable ? fade : 0,
					name: name.trim()
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

<Dialog bind:this={dialog} width={440}>
	<form class="grid gap-2.5 [&_label]:m-0" onsubmit={save}>
		<h2 class="m-0 text-md">{editing ? 'Edit timer' : 'New timer'}</h2>

		<Select label="Light" bind:value={lightKey} required>
			{#each lights as l (l.key)}<option value={l.key}>{l.name}</option>{/each}
		</Select>

		<Segmented
			label="When"
			stretch
			options={[
				['at', 'At a time'],
				['in', 'Once, in …']
			]}
			bind:value={when}
		/>

		{#if when === 'at'}
			<div class="flex flex-wrap items-end gap-3 [&_label]:w-[120px]">
				<Input label="Time" type="time" bind:value={time} required />
				<div class="flex flex-wrap gap-1" role="group" aria-label="Days">
					{#each WEEK as d (d.bit)}
						<Chip pressed={Boolean(days & (1 << d.bit))} onclick={() => toggleDay(d.bit)}
							>{d.short}</Chip
						>
					{/each}
				</div>
			</div>
			<div class="-mt-1 flex gap-3 text-xs">
				<Button variant="link" onclick={() => (days = EVERY_DAY)}>Every day</Button>
				<Button variant="link" onclick={() => (days = WEEKDAYS)}>Weekdays</Button>
				<Button variant="link" onclick={() => (days = WEEKEND)}>Weekends</Button>
			</div>
		{:else}
			<div class="flex flex-wrap items-end gap-3 [&_label]:w-[120px]">
				<Input
					label="In (minutes)"
					type="number"
					min={1}
					max={MAX_IN}
					step={1}
					bind:value={inMinutes}
					required
				/>
			</div>
			<div class="-mt-1 flex gap-3 text-xs">
				{#each IN_PRESETS as p (p)}
					<Button variant="link" onclick={() => (inMinutes = p)}
						>{p >= 60 ? `${p / 60} h` : `${p} min`}</Button
					>
				{/each}
			</div>
		{/if}

		<Segmented
			label="Action"
			stretch
			options={[
				['on', 'Turn on'],
				...(dimmable || hasCt ? ([['adjust', 'Adjust']] as const) : []),
				['off', 'Turn off']
			]}
			bind:value={action}
		/>
		{#if action === 'adjust'}<p class="-mt-1.5 mb-0 text-xs text-muted">
				Only if the light is on.
			</p>{/if}

		{#if action !== 'off' && dimmable}
			<div class="grid grid-cols-[1fr_56px] items-center gap-x-2 gap-y-1 [&>label]:col-span-full">
				<Checkbox bind:checked={setLevel}>Brightness</Checkbox>
				{#if setLevel}
					<Slider min={1} max={100} bind:value={percent} aria-label="Brightness" />
					<span class="text-right text-sm">{percent} %</span>
				{/if}
			</div>
		{/if}
		{#if action !== 'off' && hasCt}
			<div class="grid grid-cols-[1fr_56px] items-center gap-x-2 gap-y-1 [&>label]:col-span-full">
				<Checkbox bind:checked={setCt}>Color temperature</Checkbox>
				{#if setCt}
					<Slider
						tone="ct"
						min={kMin}
						max={kMax}
						step="50"
						bind:value={kelvin}
						aria-label="Color temperature"
					/>
					<span class="text-right text-sm">{kelvin} K</span>
				{/if}
			</div>
		{/if}

		{#if dimmable}
			<Select
				label={action === 'on' ? 'Fade in' : action === 'off' ? 'Fade out' : 'Change over'}
				bind:value={fade}
			>
				{#each FADES as s (s)}
					<option value={s}>{s === 0 ? 'Immediately' : `${s / 60} min`}</option>
				{/each}
			</Select>
		{/if}

		{#if action === 'on' && dimmable && fade > 0 && ((setLevel && dimmable) || (setCt && hasCt))}
			<fieldset class="m-0 grid gap-2.5 rounded-[10px] border px-3 pt-2 pb-2.5">
				<legend class="px-1 text-xs text-muted">Start from</legend>
				{#if setLevel}
					<div
						class="grid grid-cols-[1fr_56px] items-center gap-x-2 gap-y-1 [&>label]:col-span-full"
					>
						<Checkbox bind:checked={fromLevel} title="Else the lowest">Brightness</Checkbox>
						{#if fromLevel}
							<Slider min={1} max={100} bind:value={startPercent} aria-label="Start brightness" />
							<span class="text-right text-sm">{startPercent} %</span>
						{/if}
					</div>
				{/if}
				{#if setCt && hasCt}
					<div
						class="grid grid-cols-[1fr_56px] items-center gap-x-2 gap-y-1 [&>label]:col-span-full"
					>
						<Checkbox bind:checked={fromCt} title="Else the last one">Color temperature</Checkbox>
						{#if fromCt}
							<Slider
								tone="ct"
								min={kMin}
								max={kMax}
								step="50"
								bind:value={startKelvin}
								aria-label="Start color temperature"
							/>
							<span class="text-right text-sm">{startKelvin} K</span>
						{/if}
					</div>
				{/if}
			</fieldset>
		{/if}

		<Input label="Name (optional)" bind:value={name} maxlength={23} placeholder="Wake-up light" />

		{#if error}<Alert>{error}</Alert>{/if}
		<div class="flex flex-wrap items-center justify-end gap-2">
			<Button onclick={() => dialog?.close()}>Cancel</Button>
			<Button type="submit" variant="primary" disabled={busy || !light}
				>{busy ? 'Saving…' : 'Save'}</Button
			>
		</div>
	</form>
</Dialog>
