<script lang="ts">
	import { pinLabel } from '#lib/device/pins.ts';
	import { Alert } from '#lib/device/device-ui/ui/index.ts';
	import { chipBoard, externalParts, wiring } from '#lib/device/generator.ts';
	import type { BoardDef, PartDef, PinDef, ProjectConfig } from '#lib/device/types.ts';

	let { project }: { project: ProjectConfig } = $props();

	const W = 210; // board width
	const ROW = 20;
	const HEAD = 54;
	const GAP = 220;
	const MARGIN = 110;

	interface PlacedPin extends PinDef {
		x: number;
		y: number;
		side: -1 | 1;
	}
	interface PlacedBoard {
		roleId: string;
		roleName: string;
		/** Chip: its board. External part (level converter, appliance connector): undefined. */
		board?: BoardDef;
		title: string;
		subtitle: string;
		x: number;
		height: number;
		pins: PlacedPin[];
	}

	const wires = $derived(wiring(project));

	const parts = $derived(externalParts(project));

	function place(headers: BoardDef['headers'], i: number) {
		const x = MARGIN + i * (W + GAP);
		const rows = Math.max(headers.left.length, headers.right.length);
		const pins: PlacedPin[] = [
			...headers.left.map((p, r) => ({ ...p, x, y: HEAD + 14 + r * ROW, side: -1 as const })),
			...headers.right.map((p, r) => ({ ...p, x: x + W, y: HEAD + 14 + r * ROW, side: 1 as const }))
		];
		return { x, height: HEAD + rows * ROW + 16, pins };
	}

	// Chips first, then the external parts their wires go to.
	const boards = $derived.by((): PlacedBoard[] => [
		...project.chips.map((chip, i) => {
			const board = chipBoard(chip);
			return {
				roleId: chip.id,
				roleName: chip.name,
				board,
				title: board.name,
				subtitle: `${chip.name} · ${board.chip}`,
				...place(board.headers, i)
			};
		}),
		...parts.map((part: PartDef, i) => ({
			roleId: `part:${part.id}`,
			roleName: part.name,
			title: part.name,
			subtitle: part.subtitle ?? '',
			...place(part.headers, project.chips.length + i)
		}))
	]);

	const bottom = $derived(Math.max(...boards.map((b) => b.height)));
	const width = $derived(MARGIN * 2 + boards.length * W + (boards.length - 1) * GAP);

	function findPin(b: PlacedBoard | undefined, spec: string, other: PlacedBoard | undefined) {
		if (!b) return undefined;
		if (spec.startsWith('gpio:')) {
			const gpio = Number(spec.slice(5));
			return b.pins.find((p) => p.gpio === gpio);
		}
		const candidates = b.pins.filter((p) => p.label === spec);
		const facing = other && other.x > b.x ? 1 : -1;
		return candidates.find((p) => p.side === facing) ?? candidates[0];
	}

	const routed = $derived.by(() => {
		const ends = wires.map((wire) => {
			const fromBoard = boards.find((b) => b.roleId === wire.from.role);
			const toBoard = boards.find((b) => b.roleId === wire.to.role);
			const a = findPin(fromBoard, wire.from.pin, toBoard);
			const b = findPin(toBoard, wire.to.pin, fromBoard);
			// Route from the left end to the right end, whichever way the signal goes.
			const [p, q] = a && b && b.x < a.x ? [b, a] : [a, b];
			const straight = !!p && !!q && p.side === 1 && q.side === -1 && p.x < q.x;
			return { wire, a, b, p, q, straight, fromBoard, toBoard };
		});
		// Each gap between two boards has its own vertical lanes; detours below share a channel.
		const perGap: Record<number, number> = {};
		for (const e of ends) if (e.straight) perGap[e.p!.x] = (perGap[e.p!.x] ?? 0) + 1;
		const laneInGap: Record<number, number> = {};
		let detour = 0;
		return ends.map(({ wire, a, b, p, q, straight, fromBoard, toBoard }) => {
			if (!p || !q || !fromBoard || !toBoard)
				return { wire, a, b, d: '', straight, fromBoard, toBoard };
			let d: string;
			if (straight) {
				const lane = laneInGap[p.x] ?? 0;
				laneInGap[p.x] = lane + 1;
				const xm = p.x + GAP / 2 + (lane - ((perGap[p.x] ?? 1) - 1) / 2) * 16;
				d = `M ${p.x} ${p.y} H ${xm} V ${q.y} H ${q.x}`;
			} else {
				const k = detour++;
				const yb = bottom + 24 + k * 14;
				const xa = p.x + p.side * (20 + k * 10);
				const xb = q.x + q.side * (20 + k * 10);
				d = `M ${p.x} ${p.y} H ${xa} V ${yb} H ${xb} V ${q.y} H ${q.x}`;
			}
			return { wire, a, b, d, straight, fromBoard, toBoard };
		});
	});
	const detours = $derived(routed.filter((r) => r.d && !r.straight).length);

	const usedColor = $derived.by(() => {
		const map: Record<string, string> = {};
		for (const r of routed) {
			if (r.a && r.fromBoard) map[`${r.fromBoard.roleId}:${r.a.side}:${r.a.y}`] = r.wire.color;
			if (r.b && r.toBoard) map[`${r.toBoard.roleId}:${r.b.side}:${r.b.y}`] = r.wire.color;
		}
		return map;
	});

	/** The notes of the pins the wires use, once per board and pin. */
	const pinNotes = $derived.by(() => {
		const notes: Record<string, { key: string; board: string; pin: string; text: string }> = {};
		for (const r of routed) {
			for (const [pin, b] of [
				[r.a, r.fromBoard],
				[r.b, r.toBoard]
			] as const) {
				if (!pin?.note || !b) continue;
				const key = `${b.roleId}:${pin.label}`;
				notes[key] = { key, board: b.roleName, pin: pin.label, text: pin.note };
			}
		}
		return Object.values(notes);
	});

	const height = $derived(bottom + 40 + detours * 14);

	/** Colors of a board (green) or an external part (blue). */
	const LOOK = {
		board: {
			body: 'fill-[#064e3b] stroke-[#022c22]',
			subtitle: 'fill-[#a7f3d0]',
			pin: 'fill-[#d1fae5]'
		},
		part: {
			body: 'fill-[#0c4a6e] stroke-[#082f49]',
			subtitle: 'fill-[#bae6fd]',
			pin: 'fill-[#e0f2fe]'
		}
	};

	function label(p: PinDef) {
		if (p.kind !== 'gpio') return p.label;
		return p.label === String(p.gpio) ? `${p.gpio}` : `${p.label} · ${p.gpio}`;
	}

	function describe(boardRoleId: string, spec: string) {
		const b = boards.find((x) => x.roleId === boardRoleId);
		if (!b?.board) return spec;
		return spec.startsWith('gpio:') ? pinLabel(b.board, Number(spec.slice(5))) : spec;
	}
</script>

<div class="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-4">
	<div class="overflow-x-auto rounded-lg border bg-bg">
		<svg
			class="block h-auto w-full min-w-[640px]"
			viewBox="0 0 {width} {height}"
			role="img"
			aria-label="Wiring diagram"
			font-family="ui-sans-serif, system-ui"
		>
			{#each boards as b (b.roleId)}
				{@const look = b.board ? LOOK.board : LOOK.part}
				<g>
					<rect
						class={look.body}
						x={b.x}
						y={0}
						width={W}
						height={b.height}
						rx="10"
						stroke-width="1.5"
					/>
					{#if b.board}
						<rect
							class="fill-[#cbd5e1]"
							x={b.x + W / 2 - 22}
							y={-2}
							width="44"
							height="14"
							rx="3"
						/>
					{/if}
					<text class="fill-white text-sm font-semibold" x={b.x + W / 2} y={26} text-anchor="middle"
						>{b.title}</text
					>
					<text class={['text-2xs', look.subtitle]} x={b.x + W / 2} y={42} text-anchor="middle"
						>{b.subtitle}</text
					>
					{#each b.pins as p (`${p.side}:${p.y}`)}
						{@const color = usedColor[`${b.roleId}:${p.side}:${p.y}`]}
						<circle
							cx={p.x}
							cy={p.y}
							r={color ? 5 : 3.5}
							fill={color ??
								(p.kind === 'gnd' ? '#334155' : p.kind === 'power' ? '#b91c1c' : '#d4a72c')}
							stroke={color ? 'white' : 'none'}
							stroke-width="1.5"
						/>
						<text
							class={[
								'text-2xs',
								color ? 'fill-white font-semibold' : p.reserved ? 'fill-[#94a3b8]' : look.pin
							]}
							x={p.x - p.side * 10}
							y={p.y + 4}
							text-anchor={p.side === -1 ? 'start' : 'end'}
							>{label(p)}{!b.board && p.reserved ? ` (${p.reserved})` : ''}</text
						>
					{/each}
				</g>
			{/each}
			{#each routed as r (r.wire.label)}
				{#if r.d}
					<path
						d={r.d}
						fill="none"
						stroke={r.wire.color}
						stroke-width="3"
						stroke-linejoin="round"
						stroke-dasharray={r.wire.optional ? '7 5' : undefined}
					/>
				{/if}
			{/each}
		</svg>
	</div>

	{#if routed.length}
		<ul class="m-0 grid list-none gap-2 p-0">
			{#each routed as r (r.wire.label)}
				<li class="flex flex-wrap items-center gap-2">
					<span class="h-1 w-6 rounded-[2px]" style:background={r.wire.color}></span>
					<strong class="font-medium">{r.fromBoard?.roleName}</strong>
					<code class="rounded bg-bg px-1.5">{describe(r.wire.from.role, r.wire.from.pin)}</code>
					<span class="text-muted">↔</span>
					<strong class="font-medium">{r.toBoard?.roleName}</strong>
					<code class="rounded bg-bg px-1.5">{describe(r.wire.to.role, r.wire.to.pin)}</code>
					<span class="text-muted">– {r.wire.label}{r.wire.optional ? ' (optional)' : ''}</span>
					{#if !r.d}<span class="text-err">pin not found on board</span>{/if}
				</li>
			{/each}
		</ul>
	{/if}
	{#if wires.length && (pinNotes.length || parts.some((p) => p.note))}
		<Alert tone="info">
			<ul>
				{#each pinNotes as note (note.key)}
					<li><strong>{note.board} {note.pin}:</strong> {note.text}</li>
				{/each}
				{#each parts as part (part.id)}
					{#if part.note}<li>{part.note}</li>{/if}
				{/each}
			</ul>
		</Alert>
	{/if}
</div>
