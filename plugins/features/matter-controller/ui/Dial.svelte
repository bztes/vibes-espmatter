<!--
  A dial for a number, turned with one finger. With `turn` it winds: one turn is `turn`, keep
  turning for more (`wrap`: around, like a clock). Without, a gauge from `min` to `max`.
-->
<script lang="ts">
	import Minus from '@lucide/svelte/icons/minus';
	import Plus from '@lucide/svelte/icons/plus';

	let {
		value = $bindable(0),
		min = 0,
		max = 100,
		step = 1,
		turn,
		wrap,
		label,
		format = (v: number) => [String(v), '']
	}: {
		value?: number;
		min?: number;
		max?: number;
		/** Per value: e.g. single minutes in the first hour, then five. */
		step?: number | ((v: number) => number);
		turn?: number;
		/** The period it wraps around at, e.g. 1440 minutes. */
		wrap?: number;
		label: string;
		/** Big and small line in the middle. */
		format?: (v: number) => [string, string];
	} = $props();

	const SIZE = 168;
	const C = SIZE / 2;
	const R = 64;
	const LENGTH = 2 * Math.PI * R;
	/** Of the circle a gauge covers, open at the bottom. */
	const SPAN = 0.75;
	const START = 1 - SPAN / 2 - 0.25;

	let el = $state<SVGSVGElement>();
	let dragging = $state(false);
	/** Unsnapped while winding. */
	let total = 0;
	let prev = 0;

	const stepAt = (v: number) => (typeof step === 'function' ? step(v) : step);

	function fit(v: number) {
		const s = stepAt(v);
		let x = Math.round(v / s) * s;
		x = wrap ? ((x % wrap) + wrap) % wrap : Math.min(max, Math.max(min, x));
		return Number(x.toFixed(4));
	}

	/** 0 at the top, clockwise to 1. */
	function angleOf(e: PointerEvent) {
		const r = el!.getBoundingClientRect();
		const x = e.clientX - (r.left + r.width / 2);
		const y = e.clientY - (r.top + r.height / 2);
		return (Math.atan2(x, -y) / (2 * Math.PI) + 1) % 1;
	}

	/** Gauge position 0…1 of an angle; in the gap: the nearer end. */
	function along(a: number) {
		const rel = (a - START + 1) % 1;
		return rel <= SPAN ? rel / SPAN : rel < SPAN + (1 - SPAN) / 2 ? 1 : 0;
	}

	function down(e: PointerEvent) {
		el!.setPointerCapture(e.pointerId);
		el!.focus();
		dragging = true;
		prev = angleOf(e);
		if (turn) {
			// Jump to the touch, in whichever turn is nearest.
			const lap = Math.floor(value / turn);
			total = [lap - 1, lap, lap + 1]
				.map((l) => (l + prev) * turn)
				.reduce((a, b) => (Math.abs(b - value) < Math.abs(a - value) ? b : a));
			if (!wrap) total = Math.min(max, Math.max(min, total));
			value = fit(total);
		} else value = fit(min + along(prev) * (max - min));
	}

	function move(e: PointerEvent) {
		if (!dragging) return;
		const a = angleOf(e);
		if (!turn) {
			value = fit(min + along(a) * (max - min));
			return;
		}
		let d = a - prev;
		if (d > 0.5) d -= 1;
		if (d < -0.5) d += 1;
		prev = a;
		total += d * turn;
		if (!wrap) total = Math.min(max, Math.max(min, total));
		value = fit(total);
	}

	const nudge = (dir: 1 | -1) =>
		(value = fit(value + dir * stepAt(dir > 0 ? value : value - 1e-6)));

	function key(e: KeyboardEvent) {
		const k = e.key;
		if (k === 'ArrowUp' || k === 'ArrowRight') nudge(1);
		else if (k === 'ArrowDown' || k === 'ArrowLeft') nudge(-1);
		else if (k === 'PageUp') value = fit(value + 10 * stepAt(value));
		else if (k === 'PageDown') value = fit(value - 10 * stepAt(value));
		else if (k === 'Home') value = min;
		else if (k === 'End') value = max;
		else return;
		e.preventDefault();
	}

	/** Of the arc: the current turn when winding, full on a whole turn. */
	const fraction = $derived.by(() => {
		if (!turn) return max > min ? (value - min) / (max - min) : 0;
		const rest = value % turn;
		return rest === 0 && value > 0 ? 1 : rest / turn;
	});
	const laps = $derived(turn ? Math.floor((value - 1e-9) / turn) : 0);
	const share = $derived(turn ? 1 : SPAN);
	/** Degrees from 3 o'clock to where the arc starts. */
	const rotate = $derived(turn ? -90 : START * 360 - 90);
	const point = (f: number, r: number) => {
		const a = (turn ? f : START + f * SPAN) * 2 * Math.PI;
		return { x: C + r * Math.sin(a), y: C - r * Math.cos(a) };
	};
	const knob = $derived(point(fraction, R));
	const ticks = $derived(
		Array.from({ length: turn ? 12 : 5 }, (_, i) => {
			const f = turn ? i / 12 : i / 4;
			const major = turn ? i % 3 === 0 : true;
			const a = point(f, major ? R - 22 : R - 18);
			const b = point(f, R - 14);
			return { x1: a.x, y1: a.y, x2: b.x, y2: b.y, major };
		})
	);
	const text = $derived(format(value));

	const nudgeButton =
		'grid size-6 shrink-0 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-fg';
</script>

<div class="grid w-30 shrink-0 justify-items-center gap-1">
	<svg
		bind:this={el}
		viewBox="0 0 {SIZE} {SIZE}"
		class="size-30 cursor-grab touch-none rounded-full outline-none select-none focus-visible:ring-2 focus-visible:ring-accent"
		class:cursor-grabbing={dragging}
		role="slider"
		tabindex="0"
		aria-label={label}
		aria-valuemin={min}
		aria-valuemax={max}
		aria-valuenow={value}
		aria-valuetext={text.join(' ').trim()}
		onpointerdown={down}
		onpointermove={move}
		onpointerup={() => (dragging = false)}
		onpointercancel={() => (dragging = false)}
		onkeydown={key}
	>
		<circle
			cx={C}
			cy={C}
			r={R}
			fill="none"
			class={laps > 0 ? 'stroke-accent-soft' : 'stroke-surface-2'}
			stroke-width="12"
			stroke-linecap="round"
			stroke-dasharray="{share * LENGTH} {LENGTH}"
			transform="rotate({rotate} {C} {C})"
		/>
		<circle
			cx={C}
			cy={C}
			r={R}
			fill="none"
			class="stroke-accent"
			stroke-width="12"
			stroke-linecap="round"
			stroke-dasharray="{fraction * share * LENGTH} {LENGTH}"
			transform="rotate({rotate} {C} {C})"
		/>
		{#each ticks as t, i (i)}
			<line
				x1={t.x1}
				y1={t.y1}
				x2={t.x2}
				y2={t.y2}
				class="stroke-border-strong"
				stroke-width={t.major ? 2 : 1}
				stroke-linecap="round"
			/>
		{/each}
		<circle
			cx={knob.x}
			cy={knob.y}
			r={dragging ? 11 : 9}
			class="fill-surface stroke-accent transition-[r]"
			stroke-width="3"
		/>
		<text
			x={C}
			y={text[1] ? C - 6 : C}
			text-anchor="middle"
			dominant-baseline="middle"
			font-size="26"
			class="fill-fg font-semibold tabular-nums">{text[0]}</text
		>
		{#if text[1]}
			<text
				x={C}
				y={C + 18}
				text-anchor="middle"
				dominant-baseline="middle"
				font-size="15"
				class="fill-muted">{text[1]}</text
			>
		{/if}
	</svg>
	<div class="flex w-full items-center gap-0.5">
		<button
			type="button"
			class={nudgeButton}
			aria-label="Less"
			tabindex="-1"
			onclick={() => nudge(-1)}><Minus size={14} /></button
		>
		<span class="min-w-0 flex-1 truncate text-center text-xs text-muted">{label}</span>
		<button
			type="button"
			class={nudgeButton}
			aria-label="More"
			tabindex="-1"
			onclick={() => nudge(1)}><Plus size={14} /></button
		>
	</div>
</div>
