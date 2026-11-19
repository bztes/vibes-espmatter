<!--
	Gauges: line of the averages over a min/max band. Counters: line of the readings. States: steps of
	the readings over the values each bucket went through. Gaps left open; hover shows a bucket,
	dragging zooms.
-->
<script lang="ts">
	import { highShare, valueText } from './kinds';
	import { MIN_RANGE_S, timeTicks } from './ranges';
	import { axis, segments, stepOf, type Point, type Series } from './sources';

	let {
		points,
		series,
		from,
		to,
		onzoom
	}: {
		points: Point[];
		series: Series;
		from: number;
		to: number;
		/** A range dragged out with the mouse. */
		onzoom?: (from: number, to: number) => void;
	} = $props();

	const H = 240;
	const PAD = { top: 12, right: 12, bottom: 24 };
	let width = $state(600);

	const kind = $derived(series.kind);
	const line = $derived(kind === 'gauge' ? 'avg' : 'last');
	const step = $derived(stepOf(points));
	const text = (v: number) => valueText(series, v);

	// States: one tick per value seen (both for 0/1).
	const states = $derived.by(() => {
		if (kind !== 'state') return [];
		let seen = points.flatMap((p) => [p.min, p.max, p.last]);
		if (seen.every((v) => v === 0 || v === 1)) seen = [0, 1];
		return [...new Set(seen)].sort((a, b) => a - b);
	});

	const range = $derived.by(() => {
		const [lk, hk] = kind === 'counter' ? (['last', 'last'] as const) : (['min', 'max'] as const);
		let lo = Infinity;
		let hi = -Infinity;
		for (const p of points) {
			lo = Math.min(lo, p[lk]);
			hi = Math.max(hi, p[hk]);
		}
		if (!Number.isFinite(lo)) return { lo: 0, hi: 1 };
		if (kind === 'state') return { lo: lo - 0.5, hi: hi + 0.5 };
		if (hi - lo < 1e-9) return { lo: lo - 1, hi: hi + 1 };
		const pad = (hi - lo) * 0.08;
		return { lo: lo - pad, hi: hi + pad };
	});

	const yTicks = $derived(
		kind === 'state'
			? states.map((v) => ({ v, label: text(v) }))
			: axis(range.lo, range.hi, series.unit, 4)
	);
	// Room for the longest tick label (state names).
	const padLeft = $derived(Math.max(52, ...yTicks.map((t) => t.label.length * 6 + 12)));

	const plotW = $derived(Math.max(1, width - padLeft - PAD.right));
	const x = (t: number) => padLeft + ((t - from) / (to - from)) * plotW;
	const y = (v: number) =>
		PAD.top + (1 - (v - range.lo) / (range.hi - range.lo)) * (H - PAD.top - PAD.bottom);

	const runs = $derived(segments(points));
	/** Corners of a line through `key`: states hold each value until the bucket ends. */
	const corners = (run: Point[], key: 'avg' | 'min' | 'max' | 'last') =>
		kind === 'state'
			? run.flatMap((p) => [
					[x(p.t), y(p[key])],
					[x(Math.min(p.t + step, to)), y(p[key])]
				])
			: run.map((p) => [x(p.t), y(p[key])]);
	const path = (pts: number[][]) =>
		pts.map(([px, py], i) => `${i ? 'L' : 'M'}${px},${py}`).join('');
	const band = (run: Point[]) =>
		`${path([...corners(run, 'max'), ...corners(run, 'min').toReversed()])}Z`;
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

	let hoverAt = $state<number>();
	const hover = $derived(hoverAt === undefined ? undefined : points[hoverAt]);
	// Mouse drag: times where it started and where it is now.
	let drag = $state<{ a: number; b: number }>();

	function timeAt(e: PointerEvent) {
		const rect = (e.currentTarget as SVGElement).getBoundingClientRect();
		const t = from + ((e.clientX - rect.left - padLeft) / plotW) * (to - from);
		return Math.min(to, Math.max(from, t));
	}
	function move(e: PointerEvent) {
		const t = timeAt(e);
		if (drag) drag.b = t;
		let best: number | undefined;
		points.forEach((p, i) => {
			if (best === undefined || Math.abs(p.t - t) < Math.abs(points[best].t - t)) best = i;
		});
		hoverAt = best;
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
		onpointerleave={() => (hoverAt = undefined)}
	>
		{#each yTicks as { v, label } (v)}
			<line x1={padLeft} x2={width - PAD.right} y1={y(v)} y2={y(v)} class="stroke-border" />
			<text x={padLeft - 6} y={y(v)} dy="0.32em" text-anchor="end" class="fill-muted text-[11px]"
				>{label}</text
			>
		{/each}
		{#each xTicks.ticks as t (t)}
			<text x={x(t)} y={H - 6} text-anchor="middle" class="fill-muted text-[11px]"
				>{tickLabel(t)}</text
			>
		{/each}
		{#each runs as run (run[0].t)}
			{#if run.length > 1 || kind === 'state'}
				{#if kind !== 'counter'}<path d={band(run)} class="fill-accent/15" />{/if}
				<path
					d={path(corners(run, line))}
					class="fill-none stroke-accent"
					stroke-width="1.75"
					stroke-linejoin="round"
				/>
			{:else}
				<circle cx={x(run[0].t)} cy={y(run[0][line])} r="2" class="fill-accent" />
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
			<circle cx={x(hover.t)} cy={y(hover[line])} r="3.5" class="fill-accent stroke-surface" />
		{/if}
	</svg>
	{#if hover}
		<div
			class="pointer-events-none absolute top-1 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs shadow-popover"
			style:left="{Math.min(Math.max(x(hover.t) - 80, 0), width - 170)}px"
		>
			<div class="text-muted">{hoverFormat.format(hover.t * 1000)}</div>
			<div class="font-semibold tabular-nums">{text(hover[line])}</div>
			{#if kind === 'counter'}
				{@const prev = points[hoverAt! - 1]}
				{#if prev && hover.last >= prev.last}
					<div class="text-muted tabular-nums">+{text(hover.last - prev.last)}</div>
				{/if}
			{:else if hover.max - hover.min > 1e-9}
				<div class="text-muted tabular-nums">
					{#if kind === 'state'}
						{@const pct = Math.round(highShare(hover) * 100)}
						{pct} % {text(hover.max)}, {100 - pct} % {text(hover.min)}
					{:else}
						{text(hover.min)} – {text(hover.max)}
					{/if}
				</div>
			{/if}
		</div>
	{/if}
</div>
