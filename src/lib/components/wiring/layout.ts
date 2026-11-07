/**
 * Layout of the wiring diagram: the main board in the middle, everything wired to it on the side
 * where most of its wires leave the board, things wired only to those further out.
 */
import type { BoardDef, PinDef, Wire, WireEnd } from '#sdk';
import type { Assembly } from '#lib/core/assemble.ts';

export const ROW = 20;
const HEADER = 44;
const BOARD_W = 190;
const PART_W = 150;
const COL_GAP = 150;
const NODE_GAP = 28;

export interface PinBox {
	pin: PinDef;
	x: number;
	y: number;
	/** -1: anchor on the left edge, 1: on the right edge. */
	dir: -1 | 1;
	used?: string;
}

export interface NodeBox {
	key: string;
	title: string;
	subtitle?: string;
	kind: 'board' | 'part';
	x: number;
	y: number;
	w: number;
	h: number;
	pins: PinBox[];
	note?: string;
}

export interface WirePath {
	wire: Wire;
	d: string;
	color: string;
	from: PinBox;
	to: PinBox;
	fromNode: NodeBox;
	toNode: NodeBox;
}

export interface Layout {
	nodes: NodeBox[];
	wires: WirePath[];
	/** Wire ends that point at nothing (e.g. a 5V pin the board doesn't have). */
	missing: { wire: Wire; end: WireEnd; reason: string }[];
	width: number;
	height: number;
}

interface RawNode {
	key: string;
	title: string;
	subtitle?: string;
	kind: 'board' | 'part';
	left: PinDef[];
	right: PinDef[];
	note?: string;
}

function matches(pin: PinDef, ref: string): boolean {
	if (ref.startsWith('gpio:')) return pin.kind === 'gpio' && pin.gpio === Number(ref.slice(5));
	const want = ref.toUpperCase();
	if (want === 'GND') return pin.kind === 'gnd' || pin.label.toUpperCase() === 'GND';
	return pin.label.toUpperCase() === want || (want === '3V3' && pin.label.toUpperCase() === '3.3V');
}

export function layout(a: Assembly): Layout {
	const raw = new Map<string, RawNode>();
	for (const slot of a.resolved.slots) {
		const b: BoardDef = slot.board;
		raw.set(`slot:${slot.id}`, {
			key: `slot:${slot.id}`,
			title: b.name,
			subtitle: `${slot.name} · ${slot.chip.name}`,
			kind: 'board',
			left: b.headers.left,
			right: b.headers.right
		});
	}
	for (const p of a.parts)
		raw.set(`part:${p.id}`, {
			key: `part:${p.id}`,
			title: p.name,
			subtitle: p.subtitle,
			kind: 'part',
			left: p.pins,
			right: p.outer ?? [],
			note: p.note
		});

	// Only draw nodes that are wired (plus the main board).
	const wires = a.wires.filter((w) => raw.has(w.from.node) && raw.has(w.to.node));
	const wired = new Set(['slot:main', ...wires.flatMap((w) => [w.from.node, w.to.node])]);

	// Columns by distance from the main board, side by where the wires leave the parent.
	const main = raw.get('slot:main')!;
	const placement = new Map<string, { col: number; side: -1 | 1 }>([
		['slot:main', { col: 0, side: 1 }]
	]);
	let frontier = ['slot:main'];
	while (frontier.length) {
		const next: string[] = [];
		for (const key of frontier) {
			const here = placement.get(key)!;
			const votes = new Map<string, number>();
			for (const w of wires) {
				const [mine, other] =
					w.from.node === key ? [w.from, w.to] : w.to.node === key ? [w.to, w.from] : [null, null];
				if (!mine || !other || placement.has(other.node)) continue;
				const vote =
					key === 'slot:main'
						? main.left.some((p) => matches(p, mine.pin)) &&
							!main.right.some((p) => p.kind === 'gpio' && matches(p, mine.pin))
							? -1
							: 1
						: here.side;
				if (mine.pin.startsWith('gpio:') || key !== 'slot:main')
					votes.set(other.node, (votes.get(other.node) ?? 0) + vote);
				else votes.set(other.node, votes.get(other.node) ?? 0);
			}
			for (const [node, vote] of votes) {
				placement.set(node, {
					col: here.col + 1,
					side: key === 'slot:main' ? (vote < 0 ? -1 : 1) : here.side
				});
				next.push(node);
			}
		}
		frontier = next;
	}

	// Boxes.
	const boxes = new Map<string, NodeBox>();
	const columns = new Map<string, string[]>();
	for (const key of wired) {
		const p = placement.get(key) ?? { col: 1, side: 1 as const };
		const id = `${p.side}:${p.col}`;
		columns.set(id, [...(columns.get(id) ?? []), key]);
	}
	const maxLeft = Math.max(
		0,
		...[...placement.values()].filter((p) => p.side < 0).map((p) => p.col)
	);
	const mainX = maxLeft * (PART_W + COL_GAP) + 20;
	const colX = (side: number, col: number): number => {
		if (col === 0) return mainX;
		return side > 0
			? mainX + BOARD_W + COL_GAP + (col - 1) * (PART_W + COL_GAP)
			: mainX - col * (PART_W + COL_GAP);
	};
	for (const [id, keys] of columns) {
		const [side, col] = id.split(':').map(Number);
		let y = 20;
		for (const key of keys) {
			const n = raw.get(key)!;
			const w = n.kind === 'board' ? BOARD_W : PART_W;
			const rows = Math.max(n.left.length, n.right.length);
			const h = HEADER + rows * ROW + 10;
			const x = colX(side, col);
			// Parts show their pins on the side that faces the main board.
			const partDir: -1 | 1 = side > 0 ? -1 : 1;
			const pins: PinBox[] =
				n.kind === 'board'
					? [
							...n.left.map((pin, i) => ({
								pin,
								x,
								y: y + HEADER + i * ROW + ROW / 2,
								dir: -1 as const
							})),
							...n.right.map((pin, i) => ({
								pin,
								x: x + w,
								y: y + HEADER + i * ROW + ROW / 2,
								dir: 1 as const
							}))
						]
					: [
							...n.left.map((pin, i) => ({
								pin,
								x: partDir < 0 ? x : x + w,
								y: y + HEADER + i * ROW + ROW / 2,
								dir: partDir
							})),
							...n.right.map((pin, i) => ({
								pin,
								x: partDir < 0 ? x + w : x,
								y: y + HEADER + i * ROW + ROW / 2,
								dir: -partDir as -1 | 1
							}))
						];
			boxes.set(key, {
				key,
				title: n.title,
				subtitle: n.subtitle,
				kind: n.kind,
				x,
				y,
				w,
				h,
				pins,
				note: n.note
			});
			y += h + NODE_GAP;
		}
	}

	// Wires: pick pins, count the lanes needed above the boards, then shift and route.
	const missing: Layout['missing'] = [];
	const pick = (node: NodeBox, ref: string, towards: number): PinBox | undefined => {
		const candidates = node.pins.filter((p) => matches(p.pin, ref));
		return candidates.sort((a, b) => Math.abs(a.x - towards) - Math.abs(b.x - towards))[0];
	};
	const planned: (Omit<WirePath, 'd'> & { lane: number })[] = [];
	let lanes = 0;
	for (const wire of wires) {
		const fromNode = boxes.get(wire.from.node)!;
		const toNode = boxes.get(wire.to.node)!;
		const from = pick(fromNode, wire.from.pin, toNode.x + toNode.w / 2);
		const to = pick(toNode, wire.to.pin, fromNode.x + fromNode.w / 2);
		if (!from || !to) {
			const end = from ? wire.to : wire.from;
			missing.push({
				wire,
				end,
				reason: `${(from ? toNode : fromNode).title} has no ${end.pin.replace('gpio:', 'GPIO')} pin`
			});
			continue;
		}
		const color = wire.color ?? '#94a3b8';
		from.used ??= color;
		to.used ??= color;
		const direct = Math.sign(to.x - from.x) === from.dir && Math.sign(from.x - to.x) === to.dir;
		planned.push({ wire, color, from, to, fromNode, toNode, lane: direct ? 0 : ++lanes });
	}

	const all = [...boxes.values()];
	const dy = lanes * 6 + 10;
	const dx = lanes * 5 + 16;
	for (const n of all) {
		n.y += dy;
		n.x += dx;
		for (const p of n.pins) {
			p.y += dy;
			p.x += dx;
		}
	}
	const out: WirePath[] = planned.map(({ lane, ...w }) => {
		const { from, to } = w;
		if (!lane) {
			const k = Math.max(50, Math.abs(to.x - from.x) / 2);
			return {
				...w,
				d: `M${from.x} ${from.y} C${from.x + from.dir * k} ${from.y}, ${to.x + to.dir * k} ${to.y}, ${to.x} ${to.y}`
			};
		}
		// Around the top of the boards it would cross.
		const top = Math.min(w.fromNode.y, w.toNode.y) - 8 - lane * 6;
		const ox = from.x + from.dir * (12 + lane * 5);
		const tx = to.x + to.dir * (12 + lane * 5);
		return { ...w, d: `M${from.x} ${from.y} H${ox} V${top} H${tx} V${to.y} H${to.x}` };
	});

	const width = Math.max(...all.map((n) => n.x + n.w)) + 24 + lanes * 5;
	const height = Math.max(...all.map((n) => n.y + n.h)) + 20;
	return { nodes: all, wires: out, missing, width, height };
}
