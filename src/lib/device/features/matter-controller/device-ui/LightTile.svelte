<!-- One light or plug: big on/off button, brightness and color temperature, power draw if measured. -->
<script lang="ts">
	import { api, errorMessage, hexId } from '../../web-ui/device-ui/api';
	import { Slider } from '../../../device-ui/ui';
	import {
		COLOR_TEMPERATURE_TYPES,
		DIMMABLE_TYPES,
		DEVICE_TYPES,
		type MatterEndpoint
	} from './matter';

	let {
		nodeId,
		name,
		endpoint,
		power,
		reachable,
		onupdate
	}: {
		nodeId: number;
		name: string;
		endpoint: MatterEndpoint;
		/** Power draw in mW, if the device measures it. */
		power?: number;
		reachable: boolean;
		onupdate: () => Promise<void>;
	} = $props();

	const CLUSTER_ON_OFF = 0x0006;
	const CLUSTER_LEVEL = 0x0008;
	const CLUSTER_COLOR = 0x0300;
	const TRANSITION = 5; // 1/10 s
	const DEFAULT_CT = { min: 153, max: 500 };

	const dimmable = $derived(DIMMABLE_TYPES.includes(endpoint.deviceType));
	const hasCt = $derived(COLOR_TEMPERATURE_TYPES.includes(endpoint.deviceType));
	const ctMin = $derived(endpoint.ctMinMireds ?? DEFAULT_CT.min);
	const ctMax = $derived(endpoint.ctMaxMireds ?? DEFAULT_CT.max);
	const kelvin = (mireds: number) => Math.round(1_000_000 / mireds / 50) * 50;

	// Optimistic state: shown right away, replaced by what the light reports.
	let pendingOn = $state<boolean>();
	const on = $derived(pendingOn ?? endpoint.on ?? false);
	const level = $derived(endpoint.level ?? 254);
	const ct = $derived(endpoint.ctMireds ?? Math.round((ctMin + ctMax) / 2));
	let error = $state('');
	const watts = (mw: number) => (mw / 1000).toFixed(Math.abs(mw) < 10_000 ? 1 : 0);
	const status = $derived(
		[
			on ? 'On' : 'Off',
			on && dimmable && `${Math.round((level / 254) * 100)} %`,
			on && hasCt && endpoint.ctMireds && `${kelvin(ct)} K`
		]
			.filter(Boolean)
			.join(' · ')
	);

	/** Warm (amber) to cool (blue-white), dimmed with the brightness. */
	const glow = $derived.by(() => {
		if (!on) return 'transparent';
		const t = hasCt ? (ct - ctMin) / Math.max(1, ctMax - ctMin) : 0.6; // 1 = warmest
		const warm = [255, 170, 80];
		const cool = [205, 225, 255];
		const rgb = warm.map((w, i) => Math.round(cool[i] + (w - cool[i]) * t));
		const alpha = dimmable ? 0.25 + 0.55 * (level / 254) : 0.6;
		return `rgba(${rgb.join(',')},${alpha.toFixed(2)})`;
	});

	async function invoke(cluster: number, command: number, data?: Record<string, number>) {
		error = '';
		try {
			await api('/api/matter/node', {
				body: {
					id: hexId(nodeId),
					action: 'invoke',
					endpoint: endpoint.id,
					cluster,
					command,
					...(data ? { data: JSON.stringify(data) } : {})
				}
			});
			setTimeout(refresh, TRANSITION * 100 + 700);
		} catch (e) {
			pendingOn = undefined;
			error = errorMessage(e);
		}
	}

	async function refresh() {
		await api('/api/matter/node', { body: { id: hexId(nodeId), action: 'state' } }).catch(() => {});
		setTimeout(async () => {
			await onupdate();
			pendingOn = undefined;
		}, 1500);
	}

	function toggle() {
		pendingOn = !on;
		invoke(CLUSTER_ON_OFF, 0x02);
	}

	function setLevel(ev: Event) {
		const value = Number((ev.currentTarget as HTMLInputElement).value);
		pendingOn = true;
		invoke(CLUSTER_LEVEL, 0x04, { '0:U8': value, '1:U16': TRANSITION, '2:U8': 0, '3:U8': 0 });
	}

	function setKelvin(ev: Event) {
		const k = Number((ev.currentTarget as HTMLInputElement).value);
		const mireds = Math.min(ctMax, Math.max(ctMin, Math.round(1_000_000 / k)));
		invoke(CLUSTER_COLOR, 0x0a, { '0:U16': mireds, '1:U16': TRANSITION, '2:U8': 1, '3:U8': 1 });
	}
</script>

<article
	class="relative grid content-start gap-2.5 rounded-[14px] border px-4 py-3.5 transition-[background] duration-400 [background:linear-gradient(135deg,var(--glow),transparent_75%),var(--color-card)]"
	style:--glow={glow}
>
	<div class="flex items-center gap-3">
		<div class="grid min-w-0 flex-1">
			<strong class="truncate">{name}</strong>
			<span class="text-xs text-muted">
				{#if !reachable}<span class="text-warn">not reachable</span>{:else}{status}{/if}
			</span>
		</div>
		<button
			class={[
				'grid size-[46px] cursor-pointer place-items-center rounded-full border p-0',
				on ? 'border-[#f6b44c] bg-[#f6b44c] text-[#3b2600]' : 'bg-bg text-muted'
			]}
			onclick={toggle}
			aria-pressed={on}
			title={on ? 'Turn off' : 'Turn on'}
			aria-label="{on ? 'Turn off' : 'Turn on'} {name}"
		>
			<svg
				width="22"
				height="22"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2.4"
			>
				<path d="M12 3v9" stroke-linecap="round" />
				<path d="M6.3 6.8a8 8 0 1 0 11.4 0" stroke-linecap="round" />
			</svg>
		</button>
	</div>

	{#if power !== undefined}
		<div class="grid">
			<span class="text-[28px] leading-[1.1] font-semibold tabular-nums"
				>{watts(power)}<small class="ml-0.5 text-base font-medium text-muted">W</small></span
			>
			<span class="text-xs text-muted">Power</span>
		</div>
	{/if}
	{#if dimmable}
		<label class="block">
			<span class="mb-0.5 block text-xs text-muted">Brightness</span>
			<Slider min={1} max={254} value={level} onchange={setLevel} />
		</label>
	{/if}
	{#if hasCt}
		<label class="block">
			<span class="mb-0.5 block text-xs text-muted">Color temperature</span>
			<Slider
				tone="ct"
				min={kelvin(ctMax)}
				max={kelvin(ctMin)}
				step="50"
				value={kelvin(ct)}
				onchange={setKelvin}
			/>
		</label>
	{/if}
	{#if !dimmable && !hasCt && power === undefined}
		<p class="m-0 text-xs text-muted">{DEVICE_TYPES[endpoint.deviceType] ?? 'Switchable device'}</p>
	{/if}
	{#if error}<p class="mt-2 text-sm text-err">{error}</p>{/if}
</article>
