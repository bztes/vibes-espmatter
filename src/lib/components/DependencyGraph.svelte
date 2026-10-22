<!--
	What relies on what: one block per board, dependencies on the left and the features that rely on
	them to the right. Dashed arrows link features of different boards. Hovering a feature
	highlights everything it relies on and everything that relies on it; clicking selects it.
-->
<script lang="ts">
	import { dependencyGraph, type GraphEdge, type GraphNode } from '#lib/device/graph.ts';
	import type { Issue } from '#lib/device/generator.ts';
	import type { FeatureDef, ProjectConfig } from '#lib/device/types.ts';

	let {
		project,
		issues = [],
		onselect
	}: {
		project: ProjectConfig;
		issues?: Issue[];
		onselect?: (chip: string, feature: string) => void;
	} = $props();

	const NODE_W = 172;
	const NODE_H = 40;
	const GAP_X = 64;
	const GAP_Y = 12;
	const HEAD = 36;
	const PAD = 16;
	const BOARD_GAP = 24;
	/** Room right of the boards for the arrows between boards. */
	const LINK_ROOM = 96;
	/** Drawn at this fraction of its natural size, never stretched to fill the panel. */
	const SCALE = 1;

	const CATEGORY: Record<FeatureDef['category'], { label: string; color: string }> = {
		core: { label: 'Core', color: '#94a3b8' },
		network: { label: 'Network', color: '#0ea5e9' },
		thread: { label: 'Thread', color: '#8b5cf6' },
		matter: { label: 'Matter', color: '#6366f1' },
		ui: { label: 'UI', color: '#f59e0b' },
		hardware: { label: 'Hardware', color: '#10b981' }
	};

	const graph = $derived(dependencyGraph(project));

	interface Placed extends GraphNode {
		x: number;
		y: number;
	}

	/** Height of the slot an arrow takes in a column it passes through. */
	const LANE_H = 6;

	const colLeft = (c: number) => PAD + c * (NODE_W + GAP_X);
	const colRight = (c: number) => colLeft(c) + NODE_W;
	const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

	/**
	 * Centres as close to `want` as possible (least squares) while keeping their order and no
	 * closer than their heights plus `GAP_Y` – pool-adjacent-violators.
	 */
	function keepApart(heights: number[], want: number[]) {
		const off = [0];
		for (let i = 1; i < heights.length; i++)
			off.push(off[i - 1] + (heights[i - 1] + heights[i]) / 2 + GAP_Y);
		const blocks: { sum: number; n: number }[] = [];
		want.forEach((w, i) => {
			blocks.push({ sum: w - off[i], n: 1 });
			while (blocks.length > 1) {
				const [p, q] = blocks.slice(-2);
				if (p.sum / p.n <= q.sum / q.n) break;
				blocks.splice(-2, 2, { sum: p.sum + q.sum, n: p.n + q.n });
			}
		});
		return blocks.flatMap((b) => Array<number>(b.n).fill(b.sum / b.n)).map((z, i) => z + off[i]);
	}

	/** Horizontal runs `[xStart, xEnd, y]` joined by S-bends, or by a U-turn at `turn.x`. */
	function route(runs: [number, number, number][], turn?: { after: number; x: number }) {
		let d = `M${runs[0][0]},${runs[0][2]}`;
		runs.forEach(([x0, x1, y], i) => {
			if (i > 0) {
				const [, xp, yp] = runs[i - 1];
				const xm = turn?.after === i - 1 ? turn.x : (xp + x0) / 2;
				d += ` C${xm},${yp} ${xm},${y} ${x0},${y}`;
			}
			if (x1 !== x0) d += ` H${x1}`;
		});
		return d;
	}

	interface Item {
		col: number;
		h: number;
		left: string[];
		right: string[];
	}

	const layout = $derived.by(() => {
		// Built anew on every change – nothing to track inside.
		/* eslint-disable svelte/prefer-svelte-reactivity */
		const placed = new Map<string, Placed>();
		/** Per edge (end), the y of each column it passes through, left to right. */
		const lanes = new Map<string, number[]>();
		const boards: { id: string; name: string; y: number; width: number; height: number }[] = [];
		let top = 0;
		for (const chip of project.chips) {
			const nodes = graph.nodes.filter((n) => n.chip === chip.id);
			const maxDepth = Math.max(0, ...nodes.map((n) => n.depth));

			// Every arrow takes a slot in each column it crosses, so it runs between nodes, not over them.
			const items = new Map<string, Item>();
			const add = (id: string, col: number, h: number) => {
				items.set(id, { col, h, left: [], right: [] });
				return id;
			};
			for (const n of nodes) add(n.key, n.depth, NODE_H);
			const chains = new Map<string, string[]>();
			for (const e of graph.edges) {
				const ek = `${e.from}>${e.to}`;
				if (e.kind === 'requires') {
					const a = items.get(e.from);
					const b = items.get(e.to);
					if (!a || !b || b.col >= a.col) continue;
					const chain = [e.to];
					for (let c = b.col + 1; c < a.col; c++) chain.push(add(`${ek}@${c}`, c, LANE_H));
					chains.set(ek, [...chain, e.from]);
				} else {
					// Links leave their board on the right, past the columns right of the feature.
					for (const end of [e.from, e.to]) {
						const a = items.get(end);
						if (!a) continue;
						const chain = [end];
						for (let c = a.col + 1; c <= maxDepth; c++)
							chain.push(add(`${ek}@${end}@${c}`, c, LANE_H));
						chains.set(`${ek}@${end}`, chain);
					}
				}
			}
			for (const chain of chains.values())
				for (let i = 1; i < chain.length; i++) {
					items.get(chain[i - 1])!.right.push(chain[i]);
					items.get(chain[i])!.left.push(chain[i - 1]);
				}

			// Order the columns to cross as few arrows as possible: barycenter sweeps, keeping the best.
			let columns: string[][] = Array.from({ length: maxDepth + 1 }, () => []);
			for (const [id, it] of items) columns[it.col].push(id);
			const pos = new Map<string, number>();
			const index = () => columns.forEach((col) => col.forEach((id, i) => pos.set(id, i)));
			const crossings = () => {
				let n = 0;
				for (const col of columns) {
					const segs = col.flatMap((id) =>
						items.get(id)!.right.map((r) => [pos.get(id)!, pos.get(r)!])
					);
					for (let i = 0; i < segs.length; i++)
						for (let j = i + 1; j < segs.length; j++)
							if ((segs[i][0] - segs[j][0]) * (segs[i][1] - segs[j][1]) < 0) n++;
				}
				return n;
			};
			index();
			let best = columns.map((c) => [...c]);
			let fewest = crossings();
			for (let pass = 0; pass < 16 && fewest > 0; pass++) {
				const down = pass % 2 === 0;
				for (let k = 1; k <= maxDepth; k++) {
					const c = down ? k : maxDepth - k;
					const side = down ? 'left' : 'right';
					columns[c] = columns[c]
						.map((id) => {
							const ns = items.get(id)![side];
							return { id, at: ns.length ? avg(ns.map((n) => pos.get(n)!)) : pos.get(id)! };
						})
						.sort((x, y) => x.at - y.at)
						.map((x) => x.id);
					columns[c].forEach((id, i) => pos.set(id, i));
				}
				const n = crossings();
				if (n < fewest) {
					fewest = n;
					best = columns.map((c) => [...c]);
				}
			}
			columns = best;

			// Heights: pull everything level with what it connects to, keeping the order.
			const mid = new Map<string, number>();
			for (const col of columns) {
				const hs = col.map((id) => items.get(id)!.h);
				keepApart(hs, Array<number>(col.length).fill(0)).forEach((y, i) => mid.set(col[i], y));
			}
			for (let pass = 0; pass < 8; pass++) {
				for (const col of pass % 2 ? [...columns].reverse() : columns) {
					const want = col.map((id) => {
						const it = items.get(id)!;
						const ns = [...it.left, ...it.right];
						return ns.length ? avg(ns.map((n) => mid.get(n)!)) : mid.get(id)!;
					});
					const ys = keepApart(
						col.map((id) => items.get(id)!.h),
						want
					);
					col.forEach((id, i) => mid.set(id, ys[i]));
				}
			}
			let lo = Infinity;
			let hi = -Infinity;
			for (const [id, it] of items) {
				lo = Math.min(lo, mid.get(id)! - it.h / 2);
				hi = Math.max(hi, mid.get(id)! + it.h / 2);
			}
			const shift = top + HEAD - lo;
			for (const n of nodes)
				placed.set(n.key, { ...n, x: colLeft(n.depth), y: mid.get(n.key)! + shift - NODE_H / 2 });
			for (const [key, chain] of chains) {
				const via = key.includes('@') ? chain.slice(1) : chain.slice(1, -1);
				lanes.set(
					key,
					via.map((id) => mid.get(id)! + shift)
				);
			}

			const height = HEAD + (nodes.length ? hi - lo : 0) + PAD;
			boards.push({
				id: chip.id,
				name: chip.name,
				y: top,
				width: 2 * PAD + (maxDepth + 1) * (NODE_W + GAP_X) - GAP_X,
				height
			});
			top += height + BOARD_GAP;
		}
		/* eslint-enable svelte/prefer-svelte-reactivity */
		const right = Math.max(...boards.map((b) => b.width));
		return {
			placed,
			lanes,
			boards,
			right,
			width: right + LINK_ROOM,
			height: Math.max(top - BOARD_GAP, 0)
		};
	});

	const edges = $derived.by(() => {
		let links = 0;
		return graph.edges.flatMap(
			(e): (GraphEdge & { d: string; labelAt?: { x: number; y: number } })[] => {
				const a = layout.placed.get(e.from);
				const b = layout.placed.get(e.to);
				if (!a || !b) return [];
				const ek = `${e.from}>${e.to}`;
				const ya = a.y + NODE_H / 2;
				const yb = b.y + NODE_H / 2;
				if (e.kind === 'requires') {
					// From the left side of the dependent, through its lanes, to the right side of what it relies on.
					const via = (layout.lanes.get(ek) ?? []).map((y, i): [number, number, number] => [
						colRight(b.depth + 1 + i),
						colLeft(b.depth + 1 + i),
						y
					]);
					return [
						{
							...e,
							d: route([[a.x, a.x, ya], ...via.reverse(), [b.x + NODE_W, b.x + NODE_W, yb]])
						}
					];
				}
				// Between boards: out to the right of both boards and back, each link in a lane of its own.
				const xr = layout.right + 16 + (links++ % 6) * 12;
				const out: [number, number, number][] = [
					[a.x + NODE_W, a.x + NODE_W, ya],
					...(layout.lanes.get(`${ek}@${e.from}`) ?? []).map((y, i): [number, number, number] => [
						colLeft(a.depth + 1 + i),
						colRight(a.depth + 1 + i),
						y
					])
				];
				const back: [number, number, number][] = [
					...(layout.lanes.get(`${ek}@${e.to}`) ?? [])
						.map((y, i): [number, number, number] => [
							colRight(b.depth + 1 + i),
							colLeft(b.depth + 1 + i),
							y
						])
						.reverse(),
					[b.x + NODE_W + 6, b.x + NODE_W + 6, yb]
				];
				out[out.length - 1][1] = layout.right;
				back[0][0] = layout.right;
				return [
					{
						...e,
						d: route([...out, ...back], { after: out.length - 1, x: xr }),
						labelAt: { x: xr - 6, y: (out[out.length - 1][2] + back[0][2]) / 2 }
					}
				];
			}
		);
	});

	let hovered = $state<string | null>(null);

	/** The hovered feature, everything it relies on and everything relying on it. */
	const related = $derived.by(() => {
		if (!hovered) return null;
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const set = new Set([hovered]);
		const walk = (start: string, dir: 'from' | 'to') => {
			const next = dir === 'from' ? 'to' : 'from';
			const stack = [start];
			while (stack.length) {
				const k = stack.pop()!;
				for (const e of graph.edges) {
					if (e[dir] === k && !set.has(e[next])) {
						set.add(e[next]);
						stack.push(e[next]);
					}
				}
			}
		};
		walk(hovered, 'from');
		walk(hovered, 'to');
		return set;
	});

	const dim = (k: string) => related !== null && !related.has(k);
	const hasIssue = (n: GraphNode) =>
		issues.some((i) => i.role === n.chip && i.feature === n.feature.id);

	function tooltip(n: GraphNode) {
		const reliesOn = graph.edges
			.filter((e) => e.from === n.key)
			.map((e) => layout.placed.get(e.to)?.feature.name);
		const neededBy = graph.edges
			.filter((e) => e.to === n.key)
			.map((e) => layout.placed.get(e.from)?.feature.name);
		return [
			n.feature.description,
			reliesOn.length ? `Relies on: ${reliesOn.join(', ')}` : '',
			neededBy.length ? `Needed by: ${neededBy.join(', ')}` : ''
		]
			.filter(Boolean)
			.join('\n');
	}

	const categories = $derived([...new Set(graph.nodes.map((n) => n.feature.category))]);
</script>

<div class="grid gap-3">
	<div class="overflow-x-auto rounded-lg border bg-bg">
		<svg
			class="block h-auto max-w-full"
			viewBox="-8 -8 {layout.width + 16} {layout.height + 16}"
			style:width="{(layout.width + 16) * SCALE}px"
			style:min-width="{Math.min((layout.width + 16) * SCALE, 480)}px"
			role="img"
			aria-label="Dependency graph"
			font-family="ui-sans-serif, system-ui"
		>
			<defs>
				<marker
					id="dep-arrow"
					viewBox="0 0 10 10"
					refX="9"
					refY="5"
					markerWidth="7"
					markerHeight="7"
					orient="auto-start-reverse"
				>
					<path d="M0,0 L10,5 L0,10 z" class="fill-muted" />
				</marker>
				<marker
					id="dep-arrow-link"
					viewBox="0 0 10 10"
					refX="9"
					refY="5"
					markerWidth="7"
					markerHeight="7"
					orient="auto-start-reverse"
				>
					<path d="M0,0 L10,5 L0,10 z" class="fill-accent" />
				</marker>
			</defs>

			{#each layout.boards as b (b.id)}
				<rect
					x="0"
					y={b.y}
					width={b.width}
					height={b.height}
					rx="10"
					class="fill-card stroke-border"
				/>
				<text x={PAD} y={b.y + 23} class="fill-muted text-xs font-semibold">{b.name}</text>
			{/each}

			{#each edges as e (`${e.from}>${e.to}`)}
				<path
					d={e.d}
					fill="none"
					stroke-width="1.5"
					stroke-dasharray={e.kind === 'link' ? '5 4' : undefined}
					marker-end={e.kind === 'link' ? 'url(#dep-arrow-link)' : 'url(#dep-arrow)'}
					class={['transition-opacity', e.kind === 'link' ? 'stroke-accent' : 'stroke-muted']}
					opacity={dim(e.from) || dim(e.to) ? 0.15 : 1}
				/>
				{#if e.labelAt && e.label}
					<text
						x={e.labelAt.x}
						y={e.labelAt.y + 4}
						text-anchor="end"
						class="fill-accent text-2xs"
						opacity={dim(e.from) || dim(e.to) ? 0.15 : 1}>{e.label}</text
					>
				{/if}
			{/each}

			{#each [...layout.placed.values()] as n (n.key)}
				{@const bad = hasIssue(n)}
				<g
					role="button"
					tabindex="0"
					aria-label="{n.feature.name} ({project.chips.find((c) => c.id === n.chip)?.name})"
					class="group cursor-pointer outline-none transition-opacity"
					opacity={dim(n.key) ? 0.3 : 1}
					onmouseenter={() => (hovered = n.key)}
					onmouseleave={() => (hovered = null)}
					onfocus={() => (hovered = n.key)}
					onblur={() => (hovered = null)}
					onclick={() => onselect?.(n.chip, n.feature.id)}
					onkeydown={(ev) => {
						if (ev.key === 'Enter' || ev.key === ' ') {
							ev.preventDefault();
							onselect?.(n.chip, n.feature.id);
						}
					}}
				>
					<title>{tooltip(n)}</title>
					<rect
						x={n.x}
						y={n.y}
						width={NODE_W}
						height={NODE_H}
						rx="7"
						stroke-width={bad || hovered === n.key ? 2 : 1}
						class={[
							'fill-card',
							bad
								? 'stroke-err'
								: hovered === n.key
									? 'stroke-accent'
									: 'stroke-border group-focus-visible:stroke-accent'
						]}
					/>
					<rect
						x={n.x + 1}
						y={n.y + 8}
						width="3"
						height={NODE_H - 16}
						rx="1.5"
						fill={CATEGORY[n.feature.category].color}
					/>
					<text x={n.x + 14} y={n.y + 17} class="fill-fg text-xs font-medium">{n.feature.name}</text
					>
					<text x={n.x + 14} y={n.y + 31} class={['text-[10px]', bad ? 'fill-err' : 'fill-muted']}
						>{bad ? 'needs attention' : CATEGORY[n.feature.category].label}</text
					>
				</g>
			{/each}
		</svg>
	</div>

	<div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
		<span class="inline-flex items-center gap-1.5">
			<svg class="block" width="26" height="8" aria-hidden="true"
				><path d="M1,4 H20" class="stroke-muted" stroke-width="1.5" /><path
					d="M19,1 L25,4 L19,7 z"
					class="fill-muted"
				/></svg
			>
			relies on
		</span>
		{#if graph.edges.some((e) => e.kind === 'link')}
			<span class="inline-flex items-center gap-1.5">
				<svg class="block" width="26" height="8" aria-hidden="true"
					><path
						d="M1,4 H20"
						class="stroke-accent"
						stroke-width="1.5"
						stroke-dasharray="4 3"
					/><path d="M19,1 L25,4 L19,7 z" class="fill-accent" /></svg
				>
				works with another board
			</span>
		{/if}
		{#each categories as c (c)}
			<span class="inline-flex items-center gap-1.5">
				<svg class="block" width="4" height="12" aria-hidden="true"
					><rect width="3" height="12" rx="1.5" fill={CATEGORY[c].color} /></svg
				>
				{CATEGORY[c].label}
			</span>
		{/each}
	</div>
</div>
