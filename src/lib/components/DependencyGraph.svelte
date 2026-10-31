<!--
	What relies on what: one block per board, dependencies on the left and the features that rely on
	them to the right. Dotted arrows point to features it works with when they are there (soft
	dependencies, either way); dashed ones link features of different boards. Hovering a feature
	highlights everything it relies on and everything that relies on it; clicking selects it.
	Each arc leaves at a dot and arrives at an arrow, on a point of the side of its own.
	Soft dependencies are hidden unless turned on. Zoom with the buttons or Ctrl + wheel.
	The matrix view shows the same per board as a table: the row relies on the column.
-->
<script lang="ts">
	import { tick } from 'svelte';
	import ZoomIn from '@lucide/svelte/icons/zoom-in';
	import ZoomOut from '@lucide/svelte/icons/zoom-out';
	import { Button, Checkbox, Segmented } from '#lib/device/device-ui/ui/index.ts';
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
	const GAP_X = 112;
	const GAP_Y = 12;
	const HEAD = 36;
	const PAD = 16;
	const BOARD_GAP = 24;
	/** Room right of the boards for the arrows between boards. */
	const LINK_ROOM = 96;
	/** Zoom limits and step (factor per click; a wheel notch is a fraction of it). */
	const ZOOM_MIN = 0.25;
	const ZOOM_MAX = 3;
	const ZOOM_STEP = 1.25;

	const CATEGORY: Record<FeatureDef['category'], { label: string; color: string }> = {
		core: { label: 'Core', color: '#94a3b8' },
		network: { label: 'Network', color: '#0ea5e9' },
		thread: { label: 'Thread', color: '#8b5cf6' },
		matter: { label: 'Matter', color: '#6366f1' },
		ui: { label: 'UI', color: '#f59e0b' },
		hardware: { label: 'Hardware', color: '#10b981' }
	};

	const fullGraph = $derived(dependencyGraph(project));
	let showSoft = $state(false);
	const graph = $derived(
		showSoft ? fullGraph : { ...fullGraph, edges: fullGraph.edges.filter((e) => e.kind !== 'soft') }
	);

	interface Placed extends GraphNode {
		x: number;
		y: number;
		/** Taller with more ports on a side (`nodeHeight`). */
		h: number;
	}

	type Side = 'left' | 'right';

	/** Gap between the ports of a node side and its top and bottom. */
	const PORT_INSET = 7;
	/** Room per port: a node with more ports on a side than fit into `NODE_H` grows. */
	const PORT_GAP = 9;

	/** The sides of its nodes an arc leaves and reaches (as `edges` routes it). */
	function endSides(e: GraphEdge, depth: (key: string) => number | undefined): [Side, Side] {
		if (e.kind === 'link') return ['right', 'right'];
		const da = depth(e.from) ?? 0;
		const db = depth(e.to) ?? 0;
		return db < da ? ['left', 'right'] : db > da ? ['right', 'left'] : ['right', 'right'];
	}

	/** Each node's height: room for the ports on its busier side. */
	const nodeHeight = $derived.by(() => {
		// Built anew on every change – nothing to track inside.
		/* eslint-disable svelte/prefer-svelte-reactivity */
		const depth = new Map(graph.nodes.map((n) => [n.key, n.depth]));
		const count = new Map<string, number>();
		for (const e of graph.edges) {
			const sides = endSides(e, (k) => depth.get(k));
			[e.from, e.to].forEach((k, i) => {
				const side = `${k}|${sides[i]}`;
				count.set(side, (count.get(side) ?? 0) + 1);
			});
		}
		/* eslint-enable svelte/prefer-svelte-reactivity */
		return (key: string) =>
			Math.max(
				NODE_H,
				2 * PORT_INSET +
					PORT_GAP * Math.max(count.get(`${key}|left`) ?? 0, count.get(`${key}|right`) ?? 0)
			);
	});

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
			for (const n of nodes) add(n.key, n.depth, nodeHeight(n.key));
			const chains = new Map<string, string[]>();
			for (const e of graph.edges) {
				const ek = `${e.from}>${e.to}`;
				if (e.kind !== 'link') {
					const a = items.get(e.from);
					const b = items.get(e.to);
					if (!a || !b || b.col === a.col) continue;
					// Left to right: soft dependencies can point either way.
					const [lo, hi] = b.col < a.col ? [e.to, e.from] : [e.from, e.to];
					const chain = [lo];
					for (let c = items.get(lo)!.col + 1; c < items.get(hi)!.col; c++)
						chain.push(add(`${ek}@${c}`, c, LANE_H));
					chains.set(ek, [...chain, hi]);
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
				placed.set(n.key, {
					...n,
					x: colLeft(n.depth),
					y: mid.get(n.key)! + shift - items.get(n.key)!.h / 2,
					h: items.get(n.key)!.h
				});
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

	type Run = [number, number, number];

	/**
	 * Arcs with their ports: each arc leaves and reaches a node at a point of its own on that side,
	 * ordered by where it heads, so they don't cross at the node and it's clear which is which.
	 */
	const edges = $derived.by(() => {
		let links = 0;
		const specs = graph.edges.flatMap((e) => {
			const a = layout.placed.get(e.from);
			const b = layout.placed.get(e.to);
			if (!a || !b) return [];
			const ek = `${e.from}>${e.to}`;
			const ya = a.y + a.h / 2;
			const yb = b.y + b.h / 2;
			const end = (node: Placed, side: Side, toward: number) => ({ node, side, toward });
			if (e.kind !== 'link') {
				const lanes = layout.lanes.get(ek) ?? [];
				if (b.depth < a.depth) {
					// From the left side of the dependent, through its lanes, to the right side of what it relies on.
					const via = lanes
						.map((y, i): Run => [colRight(b.depth + 1 + i), colLeft(b.depth + 1 + i), y])
						.reverse();
					return [
						{
							e,
							ends: [end(a, 'left', via[0]?.[2] ?? yb), end(b, 'right', via.at(-1)?.[2] ?? ya)],
							draw: (pa: number, pb: number) => ({
								d: route([[a.x, a.x, pa], ...via, [b.x + NODE_W, b.x + NODE_W, pb]])
							})
						}
					];
				}
				if (b.depth > a.depth) {
					// A soft dependency further right: from the right side, to the left side of the other.
					const via = lanes.map((y, i): Run => [
						colLeft(a.depth + 1 + i),
						colRight(a.depth + 1 + i),
						y
					]);
					return [
						{
							e,
							ends: [end(a, 'right', via[0]?.[2] ?? yb), end(b, 'left', via.at(-1)?.[2] ?? ya)],
							draw: (pa: number, pb: number) => ({
								d: route([[a.x + NODE_W, a.x + NODE_W, pa], ...via, [b.x, b.x, pb]])
							})
						}
					];
				}
				// A soft dependency in the same column: a U-turn right of it.
				return [
					{
						e,
						ends: [end(a, 'right', yb), end(b, 'right', ya)],
						draw: (pa: number, pb: number) => ({
							d: route(
								[
									[a.x + NODE_W, a.x + NODE_W, pa],
									[b.x + NODE_W, b.x + NODE_W, pb]
								],
								{ after: 0, x: a.x + NODE_W + GAP_X / 3 }
							)
						})
					}
				];
			}
			// Between boards: out to the right of both boards and back, each link in a lane of its own.
			const xr = layout.right + 16 + (links++ % 6) * 12;
			const outVia = (layout.lanes.get(`${ek}@${e.from}`) ?? []).map((y, i): Run => [
				colLeft(a.depth + 1 + i),
				colRight(a.depth + 1 + i),
				y
			]);
			const backVia = (layout.lanes.get(`${ek}@${e.to}`) ?? [])
				.map((y, i): Run => [colRight(b.depth + 1 + i), colLeft(b.depth + 1 + i), y])
				.reverse();
			return [
				{
					e,
					ends: [
						end(a, 'right', outVia[0]?.[2] ?? backVia[0]?.[2] ?? yb),
						end(b, 'right', backVia.at(-1)?.[2] ?? outVia.at(-1)?.[2] ?? ya)
					],
					draw: (pa: number, pb: number) => {
						const out: Run[] = [
							[a.x + NODE_W, a.x + NODE_W, pa],
							...outVia.map((r): Run => [...r])
						];
						const back: Run[] = [
							...backVia.map((r): Run => [...r]),
							[b.x + NODE_W + 6, b.x + NODE_W + 6, pb]
						];
						out[out.length - 1][1] = layout.right;
						back[0][0] = layout.right;
						return {
							d: route([...out, ...back], { after: out.length - 1, x: xr }),
							labelAt: { x: xr - 6, y: (out[out.length - 1][2] + back[0][2]) / 2 }
						};
					}
				}
			];
		});

		// Spread the ends on each node side evenly, in the order of where they head.
		const ports = specs.map((s) => s.ends.map((p) => p.node.y + p.node.h / 2));
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const sides = new Map<string, { spec: number; end: number; toward: number }[]>();
		specs.forEach((s, spec) =>
			s.ends.forEach(({ node, side, toward }, end) => {
				const k = `${node.key}|${side}`;
				sides.set(k, [...(sides.get(k) ?? []), { spec, end, toward }]);
			})
		);
		for (const [k, list] of sides) {
			const node = layout.placed.get(k.slice(0, k.lastIndexOf('|')))!;
			list
				.sort((p, q) => p.toward - q.toward)
				.forEach(({ spec, end }, i) => {
					ports[spec][end] =
						node.y + PORT_INSET + ((node.h - 2 * PORT_INSET) * (i + 0.5)) / list.length;
				});
		}

		return specs.map(
			(
				s,
				i
			): GraphEdge & {
				d: string;
				start: { x: number; y: number };
				labelAt?: { x: number; y: number };
			} => {
				const [pa, pb] = ports[i];
				const a = s.ends[0];
				return {
					...s.e,
					...s.draw(pa, pb),
					start: { x: a.side === 'left' ? a.node.x : a.node.x + NODE_W, y: pa }
				};
			}
		);
	});

	let hovered = $state<string | null>(null);

	/**
	 * The hovered feature, everything it relies on and everything relying on it, and what it works
	 * with directly (soft dependencies aren't followed further).
	 */
	const related = $derived.by(() => {
		if (!hovered) return null;
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const set = new Set([hovered]);
		for (const e of graph.edges) {
			if (e.kind !== 'soft') continue;
			if (e.from === hovered) set.add(e.to);
			if (e.to === hovered) set.add(e.from);
		}
		const walk = (start: string, dir: 'from' | 'to') => {
			const next = dir === 'from' ? 'to' : 'from';
			const stack = [start];
			while (stack.length) {
				const k = stack.pop()!;
				for (const e of graph.edges) {
					if (e.kind !== 'soft' && e[dir] === k && !set.has(e[next])) {
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
	/** The arrow is the hovered node's (arrows between boards are never highlighted). */
	const isHot = (e: Pick<GraphEdge, 'from' | 'to' | 'kind'>) =>
		hovered !== null && e.kind !== 'link' && (e.from === hovered || e.to === hovered);
	const hasIssue = (n: GraphNode) =>
		issues.some((i) => i.role === n.chip && i.feature === n.feature.id);

	function tooltip(n: GraphNode) {
		const names = (soft: boolean, end: 'from' | 'to') =>
			graph.edges
				.filter((e) => (e.kind === 'soft') === soft && e[end] === n.key)
				.map((e) => layout.placed.get(e[end === 'from' ? 'to' : 'from'])?.feature.name);
		const reliesOn = names(false, 'from');
		const neededBy = names(false, 'to');
		const worksWith = names(true, 'from');
		const usedBy = names(true, 'to');
		return [
			n.feature.description,
			reliesOn.length ? `Relies on: ${reliesOn.join(', ')}` : '',
			worksWith.length ? `Works with (when there): ${worksWith.join(', ')}` : '',
			neededBy.length ? `Needed by: ${neededBy.join(', ')}` : '',
			usedBy.length ? `Used by (when there): ${usedBy.join(', ')}` : ''
		]
			.filter(Boolean)
			.join('\n');
	}

	const categories = $derived([...new Set(graph.nodes.map((n) => n.feature.category))]);

	let view = $state<'graph' | 'matrix'>('graph');

	/** Per board, its features: those relying on fewer first. */
	const matrices = $derived(
		project.chips.map((chip) => ({
			id: chip.id,
			name: chip.name,
			nodes: graph.nodes
				.filter((n) => n.chip === chip.id)
				.sort((p, q) => p.depth - q.depth || p.feature.name.localeCompare(q.feature.name))
		}))
	);
	/** `from>to` → how `from` relies on `to` on the same board. */
	const relations = $derived(
		new Map(graph.edges.filter((e) => e.kind !== 'link').map((e) => [`${e.from}>${e.to}`, e.kind]))
	);
	const hasSoft = $derived(graph.edges.some((e) => e.kind === 'soft'));
	const hasLink = $derived(graph.edges.some((e) => e.kind === 'link'));
	const chipName = (id: string) => project.chips.find((c) => c.id === id)?.name ?? id;
	/** The matrix cell under the pointer: its row and column are highlighted. */
	let cross = $state<{ row: string; col: string } | null>(null);

	let viewport = $state<HTMLDivElement>();
	let viewportWidth = $state(0);
	/** `null`: fit the panel (never larger than natural size). */
	let zoom = $state<number | null>(null);
	const naturalWidth = $derived(layout.width + 16);
	/** Fitting: as wide as the panel, but not below 480px (it scrolls then) nor above natural size. */
	const scale = $derived(
		zoom ?? Math.min(1, Math.max(viewportWidth, Math.min(naturalWidth, 480)) / naturalWidth)
	);

	/** Zoom by `factor`, keeping the point at `at` (viewport coordinates) where it is. */
	async function zoomBy(factor: number, at?: { x: number; y: number }) {
		if (!viewport) return;
		const before = scale;
		const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, before * factor));
		if (next === before) return;
		const x = at?.x ?? viewport.clientWidth / 2;
		const y = at?.y ?? viewport.clientHeight / 2;
		const left = ((viewport.scrollLeft + x) * next) / before - x;
		const top = ((viewport.scrollTop + y) * next) / before - y;
		zoom = next;
		await tick();
		viewport.scrollTo(left, top);
	}

	/** Ctrl/⌘ + wheel (and trackpad pinch) zooms; a listener of its own, as it must not be passive. */
	function wheelZoom(node: HTMLDivElement) {
		const onwheel = (ev: WheelEvent) => {
			if (!ev.ctrlKey && !ev.metaKey) return;
			ev.preventDefault();
			const rect = node.getBoundingClientRect();
			void zoomBy(Math.exp(-ev.deltaY * 0.002), {
				x: ev.clientX - rect.left,
				y: ev.clientY - rect.top
			});
		};
		node.addEventListener('wheel', onwheel, { passive: false });
		return () => node.removeEventListener('wheel', onwheel);
	}
</script>

<div class="grid gap-3">
	<div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs">
		<Segmented
			label="Show as"
			options={[
				['graph', 'Graph'],
				['matrix', 'Matrix']
			]}
			bind:value={view}
		/>
		{#if fullGraph.edges.some((e) => e.kind === 'soft')}
			<Checkbox bind:checked={showSoft} class="mr-auto">Soft dependencies</Checkbox>
		{/if}
		<div class={['flex items-center gap-1', view !== 'graph' && 'invisible']}>
			<Button
				icon
				size="sm"
				aria-label="Zoom out"
				disabled={scale <= ZOOM_MIN}
				onclick={() => zoomBy(1 / ZOOM_STEP)}><ZoomOut size={16} /></Button
			>
			<Button
				size="sm"
				class="min-w-14 tabular-nums"
				title="Fit to panel"
				aria-label="Fit to panel"
				disabled={zoom === null}
				onclick={() => (zoom = null)}>{Math.round(scale * 100)}%</Button
			>
			<Button
				icon
				size="sm"
				aria-label="Zoom in"
				disabled={scale >= ZOOM_MAX}
				onclick={() => zoomBy(ZOOM_STEP)}><ZoomIn size={16} /></Button
			>
		</div>
	</div>

	{#if view === 'graph'}
		<div
			class="max-h-[75vh] overflow-auto rounded-lg border bg-bg"
			bind:this={viewport}
			bind:clientWidth={viewportWidth}
			{@attach wheelZoom}
		>
			<svg
				class="block h-auto max-w-none"
				viewBox="-8 -8 {layout.width + 16} {layout.height + 16}"
				style:width="{naturalWidth * scale}px"
				role="img"
				aria-label="Dependency graph"
				font-family="ui-sans-serif, system-ui"
			>
				<defs>
					{#each [['dep-arrow', 'fill-muted'], ['dep-arrow-link', 'fill-accent'], ['dep-arrow-hot', 'fill-fg']] as [id, fill] (id)}
						<marker
							{id}
							viewBox="0 0 10 10"
							refX="9"
							refY="5"
							markerWidth="7"
							markerHeight="7"
							orient="auto-start-reverse"
						>
							<path d="M0,0 L10,5 L0,10 z" class={fill} />
						</marker>
					{/each}
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
					{@const hot = isHot(e)}
					<path
						d={e.d}
						fill="none"
						stroke-width="1.5"
						stroke-dasharray={e.kind === 'link' ? '5 4' : e.kind === 'soft' ? '1.5 3' : undefined}
						stroke-linecap={e.kind === 'soft' ? 'round' : undefined}
						marker-end={e.kind === 'link'
							? 'url(#dep-arrow-link)'
							: hot
								? 'url(#dep-arrow-hot)'
								: 'url(#dep-arrow)'}
						class={[
							'transition-opacity',
							e.kind === 'link' ? 'stroke-accent' : hot ? 'stroke-fg' : 'stroke-muted'
						]}
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
						aria-label="{n.feature.name} ({chipName(n.chip)})"
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
							height={n.h}
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
							height={n.h - 16}
							rx="1.5"
							fill={CATEGORY[n.feature.category].color}
						/>
						<text x={n.x + 14} y={n.y + n.h / 2 - 3} class="fill-fg text-xs font-medium"
							>{n.feature.name}</text
						>
						<text
							x={n.x + 14}
							y={n.y + n.h / 2 + 11}
							class={['text-[10px]', bad ? 'fill-err' : 'fill-muted']}
							>{bad ? 'needs attention' : CATEGORY[n.feature.category].label}</text
						>
					</g>
				{/each}

				<!-- Where each arc leaves, over the node's border. -->
				{#each edges as e (`${e.from}>${e.to}`)}
					<circle
						cx={e.start.x}
						cy={e.start.y}
						r="2.5"
						pointer-events="none"
						class={[
							'transition-opacity',
							e.kind === 'link' ? 'fill-accent' : isHot(e) ? 'fill-fg' : 'fill-muted'
						]}
						opacity={dim(e.from) || dim(e.to) ? 0.15 : 1}
					/>
				{/each}
			</svg>
		</div>
	{:else}
		<div class="grid gap-3">
			{#each matrices as m (m.id)}
				<div class="overflow-x-auto rounded-lg border bg-card p-3">
					<table class="border-collapse text-xs" onmouseleave={() => (cross = null)}>
						<caption class="pb-1 text-left font-semibold text-muted">{m.name}</caption>
						<thead>
							<tr>
								<th class="pr-3 text-left align-bottom font-normal text-muted"> relies on → </th>
								{#each m.nodes as c (c.key)}
									<th
										scope="col"
										class={[
											'w-7 p-0 align-bottom font-medium',
											cross?.col === c.key ? 'text-fg' : 'text-muted'
										]}
									>
										<span
											class="inline-block rotate-180 whitespace-nowrap py-1 [writing-mode:vertical-rl]"
											>{c.feature.name}</span
										>
									</th>
								{/each}
							</tr>
						</thead>
						<tbody>
							{#each m.nodes as r (r.key)}
								{@const bad = hasIssue(r)}
								<tr>
									<th scope="row" class="pr-3 text-left font-medium whitespace-nowrap">
										<button
											type="button"
											title={tooltip(r)}
											class={[
												'inline-flex cursor-pointer items-center gap-2 border-0 bg-transparent p-0 hover:underline',
												bad ? 'text-err' : cross?.row === r.key ? 'text-fg' : 'text-inherit'
											]}
											onclick={() => onselect?.(r.chip, r.feature.id)}
										>
											<span
												class="inline-block h-3 w-[3px] rounded-full"
												style:background={CATEGORY[r.feature.category].color}
											></span>
											{r.feature.name}
										</button>
									</th>
									{#each m.nodes as c (c.key)}
										{@const rel = relations.get(`${r.key}>${c.key}`)}
										<td
											class={[
												'size-7 border p-0 text-center',
												r.key === c.key
													? 'bg-border/50'
													: cross && (cross.row === r.key || cross.col === c.key)
														? 'bg-accent/10'
														: ''
											]}
											title={rel === 'requires'
												? `${r.feature.name} requires ${c.feature.name}`
												: rel === 'soft'
													? `${r.feature.name} works with ${c.feature.name} when it is there`
													: undefined}
											onmouseenter={() => (cross = { row: r.key, col: c.key })}
										>
											{#if rel === 'requires'}
												<span class="inline-block size-2.5 rounded-sm bg-muted align-middle"></span>
											{:else if rel === 'soft'}
												<span
													class="inline-block size-2.5 rounded-full border-[1.5px] border-muted align-middle"
												></span>
											{/if}
										</td>
									{/each}
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/each}
			{#if hasLink}
				<div class="rounded-lg border bg-card p-3 text-xs">
					<div class="pb-1 font-semibold text-muted">Between boards</div>
					<ul class="m-0 grid list-none gap-1 p-0">
						{#each graph.edges.filter((e) => e.kind === 'link') as e (`${e.from}>${e.to}`)}
							{@const a = layout.placed.get(e.from)!}
							{@const b = layout.placed.get(e.to)!}
							<li>
								{a.feature.name} <span class="text-muted">({chipName(a.chip)})</span>
								<span class="text-accent">⇄</span>
								{b.feature.name} <span class="text-muted">({chipName(b.chip)})</span>
								{#if e.label}<span class="text-muted"> – {e.label}</span>{/if}
							</li>
						{/each}
					</ul>
				</div>
			{/if}
		</div>
	{/if}

	<div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
		{#if view === 'matrix'}
			<span class="inline-flex items-center gap-1.5">
				<span class="inline-block size-2.5 rounded-sm bg-muted"></span>
				requires
			</span>
			{#if hasSoft}
				<span class="inline-flex items-center gap-1.5">
					<span class="inline-block size-2.5 rounded-full border-[1.5px] border-muted"></span>
					works with when there
				</span>
			{/if}
		{:else}
			<span class="inline-flex items-center gap-1.5">
				<svg class="block" width="26" height="8" aria-hidden="true"
					><path d="M1,4 H20" class="stroke-muted" stroke-width="1.5" /><path
						d="M19,1 L25,4 L19,7 z"
						class="fill-muted"
					/></svg
				>
				relies on
			</span>
			{#if hasSoft}
				<span class="inline-flex items-center gap-1.5">
					<svg class="block" width="26" height="8" aria-hidden="true"
						><path
							d="M1,4 H20"
							class="stroke-muted"
							stroke-width="1.5"
							stroke-dasharray="1.5 3"
							stroke-linecap="round"
						/><path d="M19,1 L25,4 L19,7 z" class="fill-muted" /></svg
					>
					works with when there
				</span>
			{/if}
			{#if hasLink}
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
