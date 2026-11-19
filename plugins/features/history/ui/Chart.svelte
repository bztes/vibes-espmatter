<!-- Line of the averages over a min/max band, gaps left open; hover shows a bucket, dragging zooms. -->
<script lang="ts">
	import { MIN_RANGE_S, timeTicks } from './ranges';
	import { axis, format, segments, type Point } from './sources';

	let {
		points,
		unit,
		from,
		to,
		onzoom
	}: {
		points: Point[];
		unit: string;
		from: number;
		to: number;
		/** A range dragged out with the mouse. */
		onzoom?: (from: number, to: number) => void;
	} = $props();

	const H = 240;
	const PAD = { top: 12, right: 12, bottom: 24, left: 52 };
	let width = $state(600);

	const range = $derived.by(() => {
		let lo = Infinity;
		let hi = -Infinity;
		for (const p of points) {
			lo = Math.min(lo, p.min);
			hi = Math.max(hi, p.max);
		}
		if (!Number.isFinite(lo)) return { lo: 0, hi: 1 };
		if (hi - lo < 1e-9) return { lo: lo - 1, hi: hi + 1 };
		const pad = (hi - lo) * 0.08;
		return { lo: lo - pad, hi: hi + pad };
	});

	const plotW = $derived(Math.max(1, width - PAD.left - PAD.right));
	const x = (t: number) => PAD.left + ((t - from) / (to - from)) * plotW;
	const y = (v: number) =>
		PAD.top + (1 - (v - range.lo) / (range.hi - range.lo)) * (H - PAD.top - PAD.bottom);

	const runs = $derived(segments(points));
	const path = (run: Point[], key: 'avg' | 'min' | 'max') =>
		run.map((p, i) => `${i ? 'L' : 'M'}${x(p.t)},${y(p[key])}`).join('');
	const band = (run: Point[]) =>
		`${path(run, 'max')}${path(run.toReversed(), 'min').replace('M', 'L')}Z`;

	const yTicks = $derived(axis(range.lo, range.hi, unit, 4));
	const xTicks = $derived(timeTicks(from, to, Math.max(2, Math.min(8, Math.floor(width / 90)))));
	const timeFormat = $derived(
		new Intl.DateTimeFormat(
			undefined,
			xTicks.step < 86400
				? { hour: '2-digit', minute: '2-digit' }
				: xTicks.step < 28 * 86400
					? { day: 'numeric', month: 'short' }
					: { month: 'short', year: '2-digit' }
		)
	);
	// Midnight ticks of an hourly axis show the date instead.
	const dayFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
	const tickLabel = (t: number) => {
		const d = new Date(t * 1000);
		const midnight = xTicks.step < 86400 && !d.getHours() && !d.getMinutes() && to - from > 3600;
		return (midnight ? dayFormat : timeFormat).format(d);
	};
	const hoverFormat = new Intl.DateTimeFormat(undefined, {
		dateStyle: 'medium',
		timeStyle: 'short'
	});

	let hover = $state<Point>();
	// Mouse drag: times where it started and where it is now.
	let drag = $state<{ a: number; b: number }>();

	function timeAt(e: PointerEvent) {
		const rect = (e.currentTarget as SVGElement).getBoundingClientRect();
		const t = from + ((e.clientX - rect.left - PAD.left) / plotW) * (to - from);
		return Math.min(to, Math.max(from, t));
	}
	function move(e: PointerEvent) {
		const t = timeAt(e);
		if (drag) drag.b = t;
		let best: Point | undefined;
		for (const p of points) if (!best || Math.abs(p.t - t) < Math.abs(best.t - t)) best = p;
		hover = best;
	}
	function down(e: PointerEvent) {
		if (!onzoom || e.pointerType !== 'mouse' || e.button !== 0) return;
		(e.currentTarget as SVGElement).setPointerCapture(e.pointerId);
		const t = timeAt(e);
		drag = { a: t, b: t };
	}
	function up() {
		if (!drag) return;
		const lo = Math.min(drag.a, drag.b);
		const hi = Math.max(drag.a, drag.b);
		drag = undefined;
		// A click or a tiny drag is no zoom.
		if (x(hi) - x(lo) < 6) return;
		const mid = (lo + hi) / 2;
		const half = Math.max(hi - lo, MIN_RANGE_S) / 2;
		onzoom?.(Math.floor(mid - half), Math.ceil(mid + half));
	}
</script>

<div class="relative" bind:clientWidth={width}>
	<svg
		{width}
		height={H}
		class={['block touch-pan-y select-none', onzoom && 'cursor-crosshair']}
		role="img"
		aria-label="Chart"
		onpointermove={move}
		onpointerdown={down}
		onpointerup={up}
		onpointercancel={() => (drag = undefined)}
		onpointerleave={() => (hover = undefined)}
	>
		{#each yTicks as { v, label } (v)}
			<line x1={PAD.left} x2={width - PAD.right} y1={y(v)} y2={y(v)} class="stroke-border" />
			<text x={PAD.left - 6} y={y(v)} dy="0.32em" text-anchor="end" class="fill-muted text-[11px]"
				>{label}</text
			>
		{/each}
		{#each xTicks.ticks as t (t)}
			<text x={x(t)} y={H - 6} text-anchor="middle" class="fill-muted text-[11px]"
				>{tickLabel(t)}</text
			>
		{/each}
		{#each runs as run (run[0].t)}
			{#if run.length > 1}
				<path d={band(run)} class="fill-accent/15" />
				<path
					d={path(run, 'avg')}
					class="fill-none stroke-accent"
					stroke-width="1.75"
					stroke-linejoin="round"
				/>
			{:else}
				<circle cx={x(run[0].t)} cy={y(run[0].avg)} r="2" class="fill-accent" />
			{/if}
		{/each}
		{#if drag}
			<rect
				x={x(Math.min(drag.a, drag.b))}
				y={PAD.top}
				width={Math.abs(x(drag.b) - x(drag.a))}
				height={H - PAD.top - PAD.bottom}
				class="fill-accent/10 stroke-accent/40"
			/>
		{/if}
		{#if hover}
			<line
				x1={x(hover.t)}
				x2={x(hover.t)}
				y1={PAD.top}
				y2={H - PAD.bottom}
				class="stroke-border-strong"
			/>
			<circle cx={x(hover.t)} cy={y(hover.avg)} r="3.5" class="fill-accent stroke-surface" />
		{/if}
	</svg>
	{#if hover}
		<div
			class="pointer-events-none absolute top-1 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs shadow-popover"
			style:left="{Math.min(Math.max(x(hover.t) - 80, 0), width - 170)}px"
		>
			<div class="text-muted">{hoverFormat.format(hover.t * 1000)}</div>
			<div class="font-semibold tabular-nums">{format(hover.avg, unit)}</div>
			{#if hover.max - hover.min > 1e-9}
				<div class="text-muted tabular-nums">
					{format(hover.min, unit)} – {format(hover.max, unit)}
				</div>
			{/if}
		</div>
	{/if}
</div>
