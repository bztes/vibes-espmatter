<script lang="ts">
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import type { Assembly } from '#lib/core/assemble.ts';
	import { Code } from '#lib/ui/index.ts';
	import { layout, ROW } from './layout';

	let { assembly }: { assembly: Assembly } = $props();

	const l = $derived(layout(assembly));
	let hover = $state<number>();

	/** Pin notes of the boards for pins a wire uses (e.g. "bridge the IN-OUT pads"). */
	const notes = $derived([
		...new Set([
			...l.nodes.flatMap((n) =>
				n.pins
					.filter((p) => p.used && p.pin.note)
					.map((p) => `${n.title}, ${p.pin.label}: ${p.pin.note}`)
			),
			...l.nodes.filter((n) => n.note).map((n) => `${n.title}: ${n.note}`)
		])
	]);
	const pinText = (p: { label: string; gpio?: number }) =>
		p.gpio !== undefined && p.label !== String(p.gpio) ? `${p.label}·${p.gpio}` : p.label;
	const kindColor = {
		power: '#ef4444',
		gnd: '#64748b',
		ctrl: '#a855f7',
		nc: '#94a3b8',
		gpio: 'currentColor'
	};
</script>

{#if !assembly.wires.length}
	<p class="m-0 text-sm text-muted">
		Nothing to wire: no peripheral or feature needs external hardware yet.
	</p>
{:else}
	<div
		class="overflow-x-auto rounded-xl border border-border bg-[radial-gradient(var(--color-border)_1px,transparent_1px)] [background-size:16px_16px]"
	>
		<svg
			viewBox="0 0 {l.width} {l.height}"
			width={l.width}
			height={l.height}
			class="block max-w-none font-sans"
			role="img"
			aria-label="Wiring diagram"
		>
			{#each l.nodes as n (n.key)}
				<g>
					<rect
						x={n.x}
						y={n.y}
						width={n.w}
						height={n.h}
						rx="10"
						class={n.kind === 'board'
							? 'fill-surface stroke-border-strong'
							: 'fill-surface-2 stroke-border-strong'}
						stroke-width="1.5"
					/>
					{#if n.kind === 'board'}<rect
							x={n.x + n.w / 2 - 16}
							y={n.y - 4}
							width="32"
							height="10"
							rx="3"
							class="fill-border-strong"
						/>{/if}
					<text
						x={n.x + n.w / 2}
						y={n.y + 19}
						text-anchor="middle"
						class="fill-fg text-[12px] font-semibold"
						>{n.title.length > 26 ? n.title.slice(0, 25) + '…' : n.title}</text
					>
					{#if n.subtitle}<text
							x={n.x + n.w / 2}
							y={n.y + 33}
							text-anchor="middle"
							class="fill-muted text-[10px]"
							>{n.subtitle.length > 32 ? n.subtitle.slice(0, 31) + '…' : n.subtitle}</text
						>{/if}
					{#each n.pins as p, i (i)}
						{@const inside = p.dir < 0 ? p.x + 8 : p.x - 8}
						<line
							x1={p.x}
							y1={p.y + ROW / 2}
							x2={p.dir < 0 ? p.x + n.w / 2 - 4 : p.x - n.w / 2 + 4}
							y2={p.y + ROW / 2}
							class="stroke-border"
							stroke-width="0.5"
						/>
						<circle
							cx={p.x}
							cy={p.y}
							r={p.used ? 4.5 : 3}
							fill={p.used ?? 'var(--color-surface)'}
							class={p.used ? '' : 'stroke-border-strong'}
							stroke-width="1.2"
						/>
						<text
							x={inside}
							y={p.y + 3.5}
							text-anchor={p.dir < 0 ? 'start' : 'end'}
							class={[
								'font-mono text-[10px]',
								p.used
									? 'fill-fg font-semibold'
									: p.pin.reserved || p.pin.kind === 'nc'
										? 'fill-muted/50'
										: 'fill-muted'
							]}
							style:fill={!p.used && p.pin.kind !== 'gpio' ? kindColor[p.pin.kind] : undefined}
						>
							{pinText(p.pin)}
						</text>
					{/each}
				</g>
			{/each}
			{#each l.wires as w, i (i)}
				<path
					d={w.d}
					fill="none"
					stroke={w.color}
					stroke-width={hover === i ? 4 : 2.5}
					stroke-linecap="round"
					stroke-linejoin="round"
					stroke-dasharray={w.wire.optional ? '6 4' : undefined}
					opacity={hover === undefined || hover === i ? 0.95 : 0.2}
					role="presentation"
					onpointerenter={() => (hover = i)}
					onpointerleave={() => (hover = undefined)}><title>{w.wire.label}</title></path
				>
			{/each}
		</svg>
	</div>

	<div class="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
		<div class="overflow-x-auto">
			<table class="w-full border-collapse text-sm">
				<thead>
					<tr class="text-left text-xs text-muted">
						<th class="py-1.5 pr-3 font-medium">From</th>
						<th class="py-1.5 pr-3 font-medium">To</th>
						<th class="py-1.5 font-medium">Signal</th>
					</tr>
				</thead>
				<tbody>
					{#each l.wires as w, i (i)}
						<tr
							class={['border-t border-border', hover === i && 'bg-surface-2']}
							onpointerenter={() => (hover = i)}
							onpointerleave={() => (hover = undefined)}
						>
							<td class="py-1.5 pr-3"
								><span class="text-muted">{w.fromNode.title}</span>
								<Code class="font-semibold">{pinText(w.from.pin)}</Code></td
							>
							<td class="py-1.5 pr-3"
								><span class="text-muted">{w.toNode.title}</span>
								<Code class="font-semibold">{pinText(w.to.pin)}</Code></td
							>
							<td class="py-1.5"
								><span
									class="mr-2 inline-block h-2 w-5 rounded-full align-middle"
									style:background={w.color}
								></span>{w.wire.label}</td
							>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		<div class="grid content-start gap-2 text-sm">
			{#each l.missing as m, i (i)}
				<p class="m-0 flex gap-2 rounded-lg bg-err-soft px-3 py-2 text-err">
					<TriangleAlert size={16} class="mt-0.5 shrink-0" />{m.wire.label}: {m.reason}.
				</p>
			{/each}
			{#each notes as note (note)}
				<p class="m-0 rounded-lg bg-warn-soft px-3 py-2 text-xs text-fg">{note}</p>
			{/each}
		</div>
	</div>
{/if}
